/**
 * 角丸がトークンから引かれているかを検査する。`npm run audit:radius`
 *
 * design.md の「角丸は UI_METRICS から引く。画面ごとに数値を決めない」を機械的に守らせる。
 * 調べた時点では 385 箇所のうちトークン経由は 29% しかなく、
 * controlRadius と同じ 10 を直接書いた場所が 50 箇所以上あった。
 *
 * ただし2種類だけは数値のままが正しい。
 *   - 円：`borderRadius >= 幅/2` で、形が寸法で決まる
 *   - アイコンの器：21→6 / 26→7 / 30→8 / 36→10 / 42→13 / 56→14 と
 *     「幅の約1/4」の比率で書かれている。トークン1つに寄せると大小で見え方が崩れる
 * この2つは除外する。除外の条件を緩めると器がトークンに吸われるので触らないこと。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', 'src')
const UI = join(SRC, 'constants', 'ui.ts')

const problems: string[] = []

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

// UI_METRICS の中から角丸トークンだけを拾う（*Radius という名前で揃えてある）
const tokens = new Map<number, string>()
for (const m of readFileSync(UI, 'utf8').matchAll(/^\s{2}(\w*Radius):\s*(\d+)/gm)) {
  tokens.set(Number(m[2]), m[1])
}

/** スタイル本文から数値プロパティを読む。式や定数参照は対象外（null） */
const FIELD_RE = { width: /(?:^|[,{\s])width:\s*([^,\n}]+)/, height: /(?:^|[,{\s])height:\s*([^,\n}]+)/ }
function field(body: string, key: 'width' | 'height'): number | null {
  const m = FIELD_RE[key].exec(body)
  if (!m) return null
  const raw = m[1].trim().replace(/,$/, '')
  return /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : null
}

for (const file of walk(SRC)) {
  if (file === UI) continue
  const source = readFileSync(file, 'utf8')
  for (const m of source.matchAll(/^(\s+)([A-Za-z0-9_]+):\s*\{/gm)) {
    let depth = 0
    let end = m.index + m[0].length - 1
    for (let i = end; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    const body = source.slice(m.index + m[0].length - 1, end + 1)
    const rm = /\bborderRadius:\s*(\d+(?:\.\d+)?)\s*(?:,|\n|})/.exec(body)
    if (!rm) continue
    const value = Number(rm[1])
    const token = tokens.get(value)
    if (!token) continue

    const w = field(body, 'width')
    const h = field(body, 'height')
    const square = w !== null && h !== null && Math.abs(w - h) < 0.01
    if (square && value >= w! / 2 - 0.01) continue          // 円
    if (square && value / w! >= 0.2 && value / w! <= 0.35) continue  // 器（比率で決める）

    const line = source.slice(0, m.index).split('\n').length
    problems.push(
      `${file.replace(/.*[\\/]src[\\/]/, 'src/')}:${line} styles.${m[2]} が ` +
      `borderRadius: ${value}。UI_METRICS.${token} と同じ値なのでそちらから引く`,
    )
  }
}

if (problems.length > 0) {
  console.error('角丸の監査で問題が見つかった:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`角丸: 問題なし（トークン ${[...tokens.values()].join(' / ')} を検証）`)
