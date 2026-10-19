/**
 * 画面の横余白がトークンから引かれているかを検査する。`npm run audit:spacing`
 *
 * 間隔は色や角丸と違って、行の高さや密度の調整で局所的に変える場面が多い。
 * 全部を揃えると design.md の「情報密度は高め」が壊れるので、
 * ここで見るのは**画面の横余白だけ**にしている。ここだけは画面をまたいで
 * 揃っていないと、タブを移動したときに中身の左端がずれて見える。
 *
 * 見るものは3つ。
 * 1. 一覧の外枠（contentContainerStyle）の padding / paddingHorizontal。
 *    式の中の styles.X をすべて拾う（[件数 === 0 ? styles.empty : styles.list, …] の形も）。
 *    直接書いたオブジェクト（{{ paddingHorizontal: 18 }}）も見る。横スクロールのチップ列は画面の余白ではないので除く
 * 2. 親の余白を打ち消す負の余白（marginHorizontal: -16 など）。親と同じトークンから引かないと、
 *    片方だけ変えたときに上の部分が左右にずれる
 * 3. ボトムシートの横余白。上の2つの角だけを sheetRadius で丸めた面（下から出るシート）の横余白は
 *    sheetGutter から引く。四隅を sheetRadius で丸めた中央のカード・チップはシートではないので見ない
 *
 * 数値を直書きしていたら、UI_METRICS の screenGutter(16) / formGutter(20) / modalGutter(24) /
 * sheetGutter(20) のどれかへ寄せる。足りない場面が出たら、画面側で数値を決めずにトークンを増やす。
 *
 * 以前は screens/ の `contentContainerStyle={styles.X` の形だけを見ていて、一覧の外枠の約4割
 * （条件つきで渡す形）と components/ を素通りしていた。検査の網を変えたら、わざと壊した入力で
 * 1件拾えることを確かめる（scripts/auditSpacing の検査は tests/auditSpacing.test.ts）
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..')
const TARGET_DIRS = ['src/screens', 'src/components/organisms', 'src/components/molecules']
const GUTTERS = ['screenGutter', 'formGutter', 'modalGutter', 'sheetGutter']
// 画面の余白に使う大きさ。これと同じ値の負の余白は、親の余白を打ち消していると読む
const GUTTER_VALUES = new Set(['16', '20', '24'])

/** 開き括弧の位置から、対応する閉じ括弧までを切り出す */
function balanced(source: string, openIndex: number): string | null {
  const open = source[openIndex]
  const close = open === '{' ? '}' : open === '[' ? ']' : ')'
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === open) depth++
    else if (source[i] === close) {
      depth--
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return null
}

/** styles.X の定義本文を切り出す */
function styleBody(source: string, name: string): string | null {
  // テンプレートリテラルに \s と書くと s に潰れる（^s{2}name:s*{ になり何にも当たらない）。
  // 文字列を組み立てるので、正規表現へ渡すバックスラッシュは2つ書く
  const m = new RegExp('^\\s{2}' + name + ':\\s*\\{', 'm').exec(source)
  if (!m) return null
  return balanced(source, m.index + m[0].length - 1)
}

/** StyleSheet.create の中の各スタイルを [名前, 本文] で並べる */
function styleBlocks(source: string): [string, string][] {
  const blocks: [string, string][] = []
  const pattern = /^\s{2}(\w+):\s*\{/gm
  for (const m of source.matchAll(pattern)) {
    const body = balanced(source, (m.index ?? 0) + m[0].length - 1)
    if (body) blocks.push([m[1], body])
  }
  return blocks
}

function horizontalPaddings(body: string): { key: string; value: string }[] {
  return [...body.matchAll(/\b(padding|paddingHorizontal):\s*([^,\n}]+)/g)]
    .map((m) => ({ key: m[1], value: m[2].trim() }))
}

const isToken = (value: string, allowed: string[]) =>
  value === '0' || allowed.some((g) => value.includes(`UI_METRICS.${g}`))

/** 1ファイルぶんの問題を返す。テストからも呼ぶ */
export function auditSpacingSource(file: string, source: string): string[] {
  const problems: string[] = []

  // 1. 一覧の外枠
  for (const m of source.matchAll(/contentContainerStyle=\{/g)) {
    const start = (m.index ?? 0) + m[0].length - 1
    const expression = balanced(source, start)
    if (!expression) continue
    // その要素の属性の範囲（直前の < から、式の後ろの閉じ > まで）に horizontal があれば横スクロール
    const tagStart = source.lastIndexOf('<', m.index)
    const after = source.slice(start + expression.length, start + expression.length + 400)
    const tagEnd = after.search(/\/?>/)
    const tag = source.slice(tagStart, start) + (tagEnd >= 0 ? after.slice(0, tagEnd) : after)
    if (/\bhorizontal\b/.test(tag)) continue

    for (const ref of new Set([...expression.matchAll(/styles\.(\w+)/g)].map((r) => r[1]))) {
      const body = styleBody(source, ref)
      if (!body) continue
      for (const { key, value } of horizontalPaddings(body)) {
        if (isToken(value, GUTTERS)) continue
        problems.push(`${file} の styles.${ref} が ${key}: ${value}。一覧の外枠の横余白は UI_METRICS の ${GUTTERS.join(' / ')} から引く`)
      }
    }
    // 直接書いたオブジェクト。styles.X の参照を外してから読む
    for (const { key, value } of horizontalPaddings(expression.replace(/styles\.\w+/g, ''))) {
      if (isToken(value, GUTTERS)) continue
      problems.push(`${file} の contentContainerStyle に直接 ${key}: ${value}。UI_METRICS の ${GUTTERS.join(' / ')} から引く`)
    }
  }

  for (const [name, body] of styleBlocks(source)) {
    // 2. 親の余白を打ち消す負の余白
    for (const m of body.matchAll(/\b(margin(?:Horizontal|Left|Right)?|marginTop):\s*-(\d+)\b/g)) {
      if (!GUTTER_VALUES.has(m[2])) continue
      problems.push(`${file} の styles.${name} が ${m[1]}: -${m[2]}。親の余白を打ち消すなら -UI_METRICS.<親と同じトークン> で書く`)
    }
    // 3. ボトムシート。常に出ている下の操作バー（名前が footer / Bar で終わる）はシートの形をしていても
    // 中身の左端を画面の一覧とそろえるものなので、screenGutter のままでよい
    if (/borderTopLeftRadius:\s*UI_METRICS\.sheetRadius/.test(body) && !/(footer|Footer|Bar)$/.test(name)) {
      for (const { key, value } of horizontalPaddings(body)) {
        if (isToken(value, ['sheetGutter'])) continue
        problems.push(`${file} の styles.${name}（シート）が ${key}: ${value}。シートの横余白は UI_METRICS.sheetGutter から引く`)
      }
    }
  }
  return [...new Set(problems)]
}

function* tsxFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* tsxFiles(path)
    else if (entry.isFile() && entry.name.endsWith('.tsx')) yield path
  }
}

if (require.main === module) {
  const problems: string[] = []
  let checked = 0
  for (const dir of TARGET_DIRS) {
    for (const path of tsxFiles(join(ROOT, dir))) {
      checked++
      problems.push(...auditSpacingSource(relative(ROOT, path).replace(/\\/g, '/'), readFileSync(path, 'utf8')))
    }
  }
  if (problems.length > 0) {
    console.error('画面の横余白の監査で問題が見つかった:\n')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`画面の横余白: 問題なし（${checked} ファイルを検証）`)
}
