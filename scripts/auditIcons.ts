/**
 * アイコンの選び方が割れていないかを検査する。`npm run audit:icons`
 *
 * 同じ意味に別の絵を当てても型は通るし実機でも動くので、レビューでしか気づけない。
 * 過去に「履歴」が定数（chart-timeline-variant）と実装（history）で食い違ったまま
 * 定数側が誰にも使われずに残っていた。機械的に止める。
 *
 * 見るのは5点。
 *   1. ICONS に同じ絵があるのに名前を直書きしている箇所
 *   2. ICONS / TAB_ICONS にあるのにどこからも使われていないキー（実装とずれた定義）
 *   3. CATEGORY_ICONS で2つ以上のカテゴリが同じ絵を使っている（図の上で区別できない）
 *   4. 重要操作の絵と画面での使用箇所
 *   5. カスタムカテゴリとPC形状が一覧・配線図で同じ描画経路を使うこと
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', 'src')
const ICONS_FILE = join(SRC, 'constants', 'icons.ts')

// カテゴリの絵と役割の絵は同じ名前でも別物なので、直書きを咎めない。
// 例：cable-data は「ケーブルというカテゴリ」と「配線という機能」の両方で使う
const AMBIGUOUS = new Set(['cable-data', 'laptop', 'package-variant-closed', 'magnify'])

// アイコン名を渡す属性。EmptyState の icon= や定義テーブルの icon: も含める
// （以前は含めておらず、ICONS と同じ名前の直書きが7種すり抜けていた）
const ICON_ATTRS = /(?:name|icon|actionIcon|updatedIcon|selectedIcon)=(?:"([a-z0-9-]+)"|\{([^{}]{0,300})\})/g
const ICON_KEYS = /\bicon:\s*'([a-z0-9-]+)'/g

const problems: string[] = []

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function rel(file: string): string {
  return file.replace(/.*[\\/]src[\\/]/, 'src/')
}

/** icons.ts の `export const 名前 = { ... }` を1つ読む */
function table(source: string, name: string): Map<string, string> {
  // CATEGORY_ICONS は `: Record<string, MCIconName>` の型注釈を挟むので開き波括弧から探す
  const declared = source.indexOf(`export const ${name}`)
  if (declared < 0) return new Map()
  const start = source.indexOf('{', declared)
  if (start < 0) return new Map()
  const end = source.indexOf('\n}', start)
  const body = source.slice(start, end)
  const entries = [...body.matchAll(/^ {2}(\w+):\s*'([a-z0-9-]+)'/gm)]
  return new Map(entries.map((m) => [m[1], m[2]]))
}

const iconsSource = readFileSync(ICONS_FILE, 'utf8')
const ICONS = table(iconsSource, 'ICONS')
const TAB_ICONS = table(iconsSource, 'TAB_ICONS')
const CATEGORY_ICONS = table(iconsSource, 'CATEGORY_ICONS')

const expectedIcons = {
  trash: 'trash-can-outline',
  retire: 'archive-arrow-down-outline',
  recentlyDeleted: 'delete-clock-outline',
  restore: 'restore',
  deleteForever: 'delete-forever-outline',
  decor: 'widgets-outline',
}
for (const [key, icon] of Object.entries(expectedIcons)) {
  if (ICONS.get(key) !== icon) problems.push(`ICONS.${key} は ${icon} を使う`)
}
if (CATEGORY_ICONS.get('PC') !== 'desktop-tower') problems.push('PCカテゴリはデスクトップ形状を既定にする')
for (const [category, icon] of Object.entries({
  Furniture: 'sofa-outline',
  Accessory: 'cube-outline',
  SmallDevice: 'devices',
  Charger: 'lightning-bolt',
  PowerStrip: 'power-plug-outline',
})) {
  if (CATEGORY_ICONS.get(category) !== icon) problems.push(`${category} は ${icon} を使う`)
}

const categoryIconSource = readFileSync(join(SRC, 'components', 'atoms', 'CategoryIcon.tsx'), 'utf8')
const mapNodeSource = readFileSync(join(SRC, 'components', 'atoms', 'MapNodeLabel.tsx'), 'utf8')
const librarySource = readFileSync(join(SRC, 'screens', 'GadgetLibraryScreen.tsx'), 'utf8')
for (const category of [
  'MonitorArm', 'MicArm', 'Tripod', 'HeadphoneAmp',
  'Dock', 'Hub', 'KVM', 'NetworkSwitch', 'MousePad', 'DeskPad',
]) {
  if (!categoryIconSource.includes(`category === '${category}'`)) {
    problems.push(`${category} のカスタムSVGが CategoryIcon から使われていない`)
  }
}
if (!categoryIconSource.includes('pcFormFactor === \'mini\'')
  || !categoryIconSource.includes('pcFormFactor === \'laptop\'')
  || !categoryIconSource.includes("'desktop-tower'")) {
  problems.push('CategoryIcon のPC形状別アイコンが揃っていない')
}
if (!mapNodeSource.includes('pcFormFactor={gadget.pcFormFactor}')
  || !mapNodeSource.includes('<CategoryIcon category={category} pcFormFactor={pcFormFactor}')) {
  problems.push('配線図のPCアイコンに形状が渡されていない')
}
for (const key of ['recentlyDeleted', 'restore', 'deleteForever']) {
  if (!librarySource.includes(`ICONS.${key}`)) problems.push(`GadgetLibraryScreen で ICONS.${key} を使っていない`)
}
for (const file of [
  join(SRC, 'components', 'organisms', 'ConnectionMap.tsx'),
  join(SRC, 'screens', 'PublicDeskScreen.tsx'),
  join(SRC, 'screens', 'WiringResultScreen.tsx'),
]) {
  if (!readFileSync(file, 'utf8').includes('<ArmMountIcon gadget={g}')) {
    problems.push(`${rel(file)} がアーム種別に応じたアイコンを使っていない`)
  }
}

const keysByValue = new Map<string, string[]>()
for (const [key, value] of ICONS) {
  keysByValue.set(value, [...(keysByValue.get(value) ?? []), key])
}

const usedKeys = new Set<string>()

for (const file of walk(SRC)) {
  if (file === ICONS_FILE) continue
  const source = readFileSync(file, 'utf8')

  if (/\bCATEGORY_ICONS\.(?:MonitorArm|MicArm|Tripod|HeadphoneAmp|Dock|Hub|KVM|NetworkSwitch|MousePad|DeskPad)\b/.test(source)) {
    problems.push(`${rel(file)} がカスタムSVGのカテゴリを定数から直接描いている`)
  }

  for (const m of source.matchAll(/\b(?:ICONS|TAB_ICONS)\.(\w+)/g)) usedKeys.add(m[1])

  const found: { index: number; literals: string[] }[] = [
    ...[...source.matchAll(ICON_ATTRS)].map((m) => ({
      index: m.index ?? 0,
      literals: m[1] ? [m[1]] : [...(m[2] ?? '').matchAll(/'([a-z0-9-]+)'/g)].map((x) => x[1]),
    })),
    ...[...source.matchAll(ICON_KEYS)].map((m) => ({ index: m.index ?? 0, literals: [m[1]] })),
  ]
  for (const m of found) {
    for (const value of m.literals) {
      if (AMBIGUOUS.has(value)) continue
      const keys = keysByValue.get(value)
      if (!keys) continue
      const line = source.slice(0, m.index).split('\n').length
      problems.push(
        `${rel(file)}:${line} "${value}" を直書きしている。ICONS.${keys[0]} が同じ絵を持つ`,
      )
    }
  }
}

for (const [key, value] of [...ICONS, ...TAB_ICONS]) {
  if (!usedKeys.has(key)) {
    problems.push(
      `src/constants/icons.ts の ${key}（${value}）がどこからも使われていない。` +
      '実装が別の絵を使っている可能性がある',
    )
  }
}

const categoriesByValue = new Map<string, string[]>()
for (const [category, value] of CATEGORY_ICONS) {
  categoriesByValue.set(value, [...(categoriesByValue.get(value) ?? []), category])
}
for (const [value, categories] of categoriesByValue) {
  if (categories.length > 1) {
    problems.push(
      `CATEGORY_ICONS で ${categories.join(' と ')} が同じ ${value} を使っている。` +
      'カテゴリは絵だけで見分けるので、配線図と一覧タイルで区別できなくなる',
    )
  }
}

if (problems.length > 0) {
  console.error('アイコンの監査で問題が見つかった:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log(`アイコン: 問題なし（ICONS ${ICONS.size} / カテゴリ ${CATEGORY_ICONS.size} を検証）`)
