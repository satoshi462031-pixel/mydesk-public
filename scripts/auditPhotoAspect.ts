/**
 * デスク写真の縦横比が、表示する面ごとにどれだけ切り落とされるかを測る。
 *
 *   npm run audit:photo-aspect
 *
 * 写真は取り込み時に一切加工していない（planImages.pickPlanPhotos は allowsEditing も
 * ImageManipulator も通さず、選んだファイルをそのままコピーする）。つまり比率は
 * ユーザーが撮ったまま届き、切るのは表示側の resizeMode="cover" だけ。
 * どの比率でどれだけ消えるかは幾何で決まるので、ここで総当たりして閾値を超える組を出す。
 *
 * **枠の比率はスタイル定義から読む。** ここに数値を書き写すと、実装を変えたときに
 * 監査だけが古い値のまま「問題なし」と言う。読み取れない・想定と違う形になっていたら
 * その場で失敗させ、書き写しの手間ではなく気づかない嘘を防ぐ。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', 'src')

interface Surface {
  name: string
  /** 比率を持つスタイル定義の場所 */
  file: string
  styleKey: string
}

const SURFACES: Surface[] = [
  { name: 'デスクのタイル',     file: 'components/molecules/DeskGridTile.tsx',      styleKey: 'photoWrap43' },
  { name: 'タイル(2列)',        file: 'components/molecules/DeskGridTile.tsx',      styleKey: 'compactPhotoWrap' },
  // マイデスクと公開デスクの上部。かつては画面ごとに枠を持っていた（heroPhoto /
  // heroSubCell / photoCell）が、いまは両方ともこの部品を全幅で敷いている
  { name: 'デスク上部の写真',   file: 'components/molecules/DeskPhotoCarousel.tsx', styleKey: 'wrap' },
  { name: '写真を追加する画面', file: 'screens/PhotoFillScreen.tsx',                styleKey: 'cell' },
  { name: '写真ストリップ',     file: 'screens/WiringResultScreen.tsx',             styleKey: 'photoStripThumb' },
]

/** 実際に届く写真の比率。末尾2つはこのリポジトリが同梱しているデモデスクの写真 */
const PHOTOS: { name: string; ratio: number }[] = [
  { name: 'iPhone 標準 横 (4:3)',       ratio: 4 / 3 },
  { name: 'iPhone 標準 縦 (3:4)',       ratio: 3 / 4 },
  { name: '一眼・iPhone 48MP 横 (3:2)', ratio: 3 / 2 },
  { name: '一眼 縦 (2:3)',              ratio: 2 / 3 },
  { name: '動画由来・ワイド (16:9)',    ratio: 16 / 9 },
  { name: 'スクショ縦 (9:19.5)',        ratio: 9 / 19.5 },
  { name: '正方形 (1:1)',               ratio: 1 },
  { name: 'パノラマ (3:1)',             ratio: 3 },
  { name: '同梱デモ写真 (1200x800)',    ratio: 1200 / 800 },
  { name: '同梱デモ写真 (900x562)',     ratio: 900 / 562 },
]

const problems: string[] = []

/** `key: { … }` の中身を、括弧の対応で切り出す（1行の定義も複数行の定義も同じ扱い） */
function styleBody(source: string, key: string): string | null {
  // 正規表現を組み立てると、キー名のエスケープと読みやすさの両方を落とす。
  // スタイル定義は必ず「2スペース + キー + `: {`」で始まるので、素直に文字列で探す
  const marker = `\n  ${key}: {`
  const at = source.indexOf(marker)
  if (at < 0) return null
  const from = at + marker.length - 1
  let depth = 0
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(from + 1, i)
    }
  }
  return null
}

/**
 * スタイル定義から「幅 ÷ 高さ」を求める。読めるのは次の3通りだけ。
 *   aspectRatio: 4 / 3           → そのまま
 *   width: 107, height: 80       → 数値どうしの比
 *   width: X, height: X * 0.75   → 同じ基準に係数を掛ける書き方（heroPhoto / heroSubCell）
 * これ以外の書き方に変わったら読めずに失敗する。黙って古い値を使うよりよい。
 */
function frameRatio(body: string): number | null {
  const aspect = /aspectRatio:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(body)
  if (aspect) return Number(aspect[1]) / Number(aspect[2])

  const width = /width:\s*([^,\n]+)/.exec(body)
  const height = /height:\s*([^,\n]+)/.exec(body)
  if (!width || !height) return null
  const w = width[1].trim()
  const h = height[1].trim()

  if (/^[\d.]+$/.test(w) && /^[\d.]+$/.test(h)) return Number(w) / Number(h)

  // `SCREEN_W` と `SCREEN_W * 0.75` のように、同じ基準に係数を掛けている場合
  const factor = h.startsWith(`${w} * `) ? h.slice(w.length + 3).trim() : null
  if (factor && /^[0-9.]+$/.test(factor)) return 1 / Number(factor)
  return null
}

/** cover で枠に収めたとき、元の写真の何割が見えるか */
function visibleRatio(photo: number, frame: number): { kept: number; cut: 'left-right' | 'top-bottom' | 'none' } {
  if (Math.abs(photo - frame) < 0.001) return { kept: 1, cut: 'none' }
  // 写真のほうが横長なら左右を、縦長なら上下を落とす
  return photo > frame
    ? { kept: frame / photo, cut: 'left-right' }
    : { kept: photo / frame, cut: 'top-bottom' }
}

const WARN = 0.75 // 4分の1より多く落ちる組は名指しする
const label = (cut: string) => (cut === 'left-right' ? '左右' : cut === 'top-bottom' ? '上下' : '—')

const frames = SURFACES.map((surface) => {
  const source = readFileSync(join(SRC, surface.file), 'utf8')
  const body = styleBody(source, surface.styleKey)
  if (body === null) {
    problems.push(`${surface.file} の styles.${surface.styleKey} が見つからない（名前が変わった？）`)
    return { ...surface, ratio: null as number | null }
  }
  // 定義が残っているだけで誰も使っていない枠を測ると、実装と無関係な数字を
  // 「問題なし」と報告してしまう（photoCell が実際にそうなっていた）
  if (!new RegExp(`styles\\.${surface.styleKey}\\b`).test(source)) {
    problems.push(`${surface.file} の styles.${surface.styleKey} はどこからも参照されていない（表示に使われていない枠を測っている）`)
  }
  const ratio = frameRatio(body)
  if (ratio === null) {
    problems.push(`${surface.file} の styles.${surface.styleKey} から比率を読めない: ${body.trim().split('\n')[0]}`)
  }
  return { ...surface, ratio }
})

if (problems.length > 0) {
  console.error('写真の縦横比 監査: スタイル定義を読めなかった\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nスクリプト側の SURFACES を実装に合わせて直すこと。')
  process.exit(1)
}

console.log('写真の縦横比 監査 — 数字は「元の写真のうち画面に残る割合」')
console.log('（枠の比率は各スタイル定義から読み取っている）\n')
console.log(['写真 \\ 枠', ...frames.map((f) => `${f.name}(${f.ratio!.toFixed(2)})`)].join(' | '))

const warnings: string[] = []
for (const photo of PHOTOS) {
  const cells = frames.map((f) => {
    const { kept, cut } = visibleRatio(photo.ratio, f.ratio!)
    if (kept < WARN) {
      warnings.push(`${photo.name} × ${f.name}: ${label(cut)}が${((1 - kept) * 100).toFixed(0)}%落ちる（${f.file} の styles.${f.styleKey}）`)
    }
    return `${(kept * 100).toFixed(0)}%${cut === 'none' ? '' : `(${label(cut)})`}`
  })
  console.log([photo.name, ...cells].join(' | '))
}

console.log(`\n${WARN * 100}% 未満しか残らない組: ${warnings.length}件`)
for (const w of warnings) console.log(`  - ${w}`)
