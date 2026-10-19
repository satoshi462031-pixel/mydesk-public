/**
 * 円のアイコンボタンが手書きに戻っていないかを検査する。`npm run audit:icon-buttons`
 *
 * 押せる円（width = height = borderRadius * 2）の中にアイコン1つ、という書き方を画面ごとに
 * 繰り返すと、大きさ・地の色・押せる範囲・読み上げが割れる。さらに字形の輪郭は em の中央に
 * 無いので、flex の中央寄せだけでは絵が円の中心から外れる（src/utils/iconOptics.ts の注記）。
 * 円のアイコンボタンは IconCircleButton、ヘッダーは HeaderIconButton に寄せる。
 *
 * 選択肢の色見本のように「円そのものが中身」のものは対象外（読み上げの役割で見分ける）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', 'src')
// 仕組みそのものを持つ側。ここは素の TouchableOpacity で円を組んでよい
const EXEMPT = [
  join('components', 'atoms', 'IconCircleButton.tsx'),
  join('components', 'atoms', 'HeaderIconButton.tsx'),
]
const PRESSABLES = ['TouchableOpacity', 'TouchableHighlight', 'Pressable']

const problems: string[] = []

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && /\.tsx$/.test(entry.name) ? [path] : []
  })
}

// StyleSheet の中の「完全な円」を拾う
function circleStyles(source: string): string[] {
  const names: string[] = []
  for (const match of source.matchAll(/([A-Za-z0-9_]+):\s*\{([^{}]*)\}/g)) {
    const [, name, body] = match
    const num = (key: string) => {
      const found = body.match(new RegExp(`\\b${key}:\\s*([0-9.]+)`))
      return found ? Number(found[1]) : null
    }
    const width = num('width')
    const height = num('height')
    const radius = num('borderRadius')
    if (width !== null && width === height && radius === width / 2) names.push(name)
  }
  return names
}

// 開きタグの終わり（属性の {} を数えながら探す）
function endOfOpenTag(source: string, from: number): number {
  let depth = 0
  for (let i = from; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return i
  }
  return -1
}

// 同じ名前の入れ子を数えて閉じタグを探す
function endOfElement(source: string, tag: string, from: number): number {
  const open = new RegExp(`<${tag}\\b`, 'g')
  const close = new RegExp(`</${tag}>`, 'g')
  open.lastIndex = from
  close.lastIndex = from
  let depth = 1
  let next = close.exec(source)
  let nested = open.exec(source)
  while (next) {
    while (nested && nested.index < next.index) {
      depth++
      nested = open.exec(source)
    }
    depth--
    if (depth === 0) return next.index
    next = close.exec(source)
  }
  return -1
}

for (const file of walk(SRC)) {
  if (EXEMPT.some((exempt) => file.endsWith(exempt))) continue
  const source = readFileSync(file, 'utf8')
  const circles = circleStyles(source)
  if (circles.length === 0) continue

  for (const tag of PRESSABLES) {
    const opens = new RegExp(`<${tag}\\b`, 'g')
    let match: RegExpExecArray | null
    while ((match = opens.exec(source)) !== null) {
      const attrsEnd = endOfOpenTag(source, match.index)
      if (attrsEnd < 0 || source[attrsEnd - 1] === '/') continue
      const attrs = source.slice(match.index, attrsEnd)
      const circle = circles.find((name) => attrs.includes(`styles.${name}`))
      if (!circle) continue
      // 色見本・チェックボックスなど、円そのものが選択肢のものは別物
      const role = attrs.match(/accessibilityRole=["{]'?([a-z]+)'?/)
      if (role && role[1] !== 'button') continue

      const closeIndex = endOfElement(source, tag, attrsEnd)
      if (closeIndex < 0) continue
      const body = source.slice(attrsEnd + 1, closeIndex).trim()
      // 中身がアイコン1つだけ（条件付きで出し分けているものも含む）
      if (!/^\{?[^<]*<AppIcon\b[^>]*\/>\s*\}?$/s.test(body)) continue

      const line = source.slice(0, match.index).split('\n').length
      problems.push(
        `${file.replace(/.*[\\/]src[\\/]/, 'src/')}:${line} styles.${circle} は押せる円にアイコンを` +
        '手書きしている。IconCircleButton（ヘッダーは HeaderIconButton）を使う',
      )
    }
  }
}

if (problems.length > 0) {
  console.error('円のアイコンボタンの監査で問題が見つかった:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log('円のアイコンボタン: 問題なし')
