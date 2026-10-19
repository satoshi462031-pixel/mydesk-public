/**
 * App Store Connect 用スクリーンショットのリサイズ。
 *
 *   npm run screenshots            # screenshots/src → screenshots/out（6.7インチ枠）
 *   npm run screenshots -- --size 6.9
 *   npm run screenshots -- --in path/to/src --out path/to/out
 *
 * 実機（iPhone 13/14/15 の非Pro）は 1170x2532 で撮れるが、ASC の枠は
 * 1284x2778 を要求する。縦横比は 0.4621 対 0.4622 でほぼ同じなので、
 * 拡大して中央を切るだけで歪みは出ない（切り落ちは1px未満）。
 *
 * アルファチャンネルが残っていると ASC のアップロードで弾かれるため、
 * 必ず flatten して RGB で書き出す。
 */
import { existsSync, mkdirSync, readdirSync } from 'fs'
import { basename, extname, join, resolve } from 'path'
import sharp from 'sharp'

// ASC の受け付けるサイズ。キーは表示上のインチ表記
const SIZES = {
  '6.9': { w: 1290, h: 2796, label: '6.9インチ（iPhone 16 Pro Max）' },
  '6.7': { w: 1284, h: 2778, label: '6.7インチ（iPhone 14/15 Pro Max）' },
  '6.5': { w: 1242, h: 2688, label: '6.5インチ（iPhone 11 Pro Max）' },
  '5.5': { w: 1242, h: 2208, label: '5.5インチ（iPhone 8 Plus）' },
} as const

type SizeKey = keyof typeof SIZES

const MAX_SCREENSHOTS = 10
const INPUT_EXT = ['.png', '.jpg', '.jpeg']

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

async function main() {
  const sizeKey = arg('size', '6.7') as SizeKey
  const target = SIZES[sizeKey]
  if (!target) {
    throw new Error(`未対応のサイズ: ${sizeKey}（${Object.keys(SIZES).join(' / ')}）`)
  }

  const inDir = resolve(arg('in', 'screenshots/src'))
  const outDir = resolve(arg('out', 'screenshots/out'))

  if (!existsSync(inDir)) {
    throw new Error(`入力フォルダがない: ${inDir}\n実機のスクショをここに置いてから実行する。`)
  }
  mkdirSync(outDir, { recursive: true })

  // ASC は並び順を保持しないので、ファイル名の昇順＝表示順になるよう
  // 出力側に 01_ 02_ … を振る。撮影時に 1.png, 2.png… としておけばよい
  const files = readdirSync(inDir)
    .filter((f) => INPUT_EXT.includes(extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

  if (files.length === 0) {
    throw new Error(`${inDir} に画像がない（対応拡張子: ${INPUT_EXT.join(', ')}）`)
  }

  console.log(`出力サイズ: ${target.w}x${target.h}  ${target.label}`)
  console.log(`入力: ${inDir}`)
  console.log(`出力: ${outDir}\n`)

  const targetRatio = target.w / target.h

  for (const [i, file] of files.entries()) {
    const src = join(inDir, file)
    const meta = await sharp(src).metadata()
    const { width, height } = meta
    if (!width || !height) throw new Error(`サイズを読めない: ${file}`)

    if (height <= width) {
      throw new Error(`横向きの画像が混ざっている: ${file}（${width}x${height}）`)
    }

    // 縦横比が大きく違うと中央切りで内容が欠ける。5%を超えたら止める
    const ratio = width / height
    const drift = Math.abs(ratio - targetRatio) / targetRatio
    if (drift > 0.05) {
      throw new Error(
        `縦横比が合わない: ${file}（${width}x${height}）。` +
        `${(drift * 100).toFixed(1)}% ずれていて中央切りだと内容が欠ける。`,
      )
    }

    const name = `${String(i + 1).padStart(2, '0')}_${basename(file, extname(file))}.png`
    const dest = join(outDir, name)

    await sharp(src)
      .resize(target.w, target.h, { fit: 'cover', position: 'center', kernel: 'lanczos3' })
      // ASC はアルファ付き PNG を受け付けない
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 9 })
      .toFile(dest)

    const upscale = target.w / width
    console.log(
      `  ${name}  ← ${file} (${width}x${height}, ${upscale >= 1 ? '拡大' : '縮小'} ${(upscale * 100).toFixed(1)}%)`,
    )
  }

  console.log(`\n${files.length} 枚を書き出した。`)
  if (files.length > MAX_SCREENSHOTS) {
    console.warn(`ASC にアップロードできるのは ${MAX_SCREENSHOTS} 枚まで。上位 ${MAX_SCREENSHOTS} 枚を選ぶこと。`)
  }
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
