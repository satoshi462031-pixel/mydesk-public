/**
 * 共通ヘッダーと、円・タップ領域・アイコンの固定寸法を検査する。`npm run audit:header-buttons`
 * OS のバーボタン背景へ戻すと、子Viewの正方形を指定しても背景の正円を保証できない。
 * この監査は構成を検査するもので、実機での視覚確認は別途必要。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', 'src')

const problems: string[] = []

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

// headerLeft/headerRight の値（アロー関数）の本文を括弧の対応で切り出す
function optionBody(source: string, from: number): string {
  let depth = 0
  for (let i = from; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return source.slice(from, i + 1)
    }
  }
  return source.slice(from)
}

function checkSources() {
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8')
    const re = /header(?:Left|Right):\s*(?:\(\)\s*=>)?/g
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      const rest = source.slice(match.index + match[0].length)
      // headerRight: undefined（ボタンを消す指定）は対象外
      if (/^\s*undefined/.test(rest)) continue
      const valueStart = match.index + match[0].length
      // 条件演算子で `headerLeft: condition ? () => (...) : undefined` と書く場合、
      // 最初の括弧は condition 内の関数呼び出し。アローの本文から検査する。
      const nearby = source.slice(valueStart, valueStart + 300)
      const arrowOffset = match[0].includes('=>') ? -1 : nearby.indexOf('=>')
      const open = source.indexOf('(', arrowOffset >= 0 ? valueStart + arrowOffset + 2 : valueStart)
      if (open < 0) continue
      const body = optionBody(source, open)
      if (body.includes('HeaderIconButton') || body.includes('HeaderButtonGroup')) continue
      const line = source.slice(0, match.index).split('\n').length
      problems.push(
        `${file.replace(/.*[\\/]src[\\/]/, 'src/')}:${line} ${match[0].trim()} が ` +
        'HeaderIconButton / HeaderButtonGroup を使っていない。' +
        '円の形・中央配置・押下領域は共通部品で管理する',
      )
    }
  }
}

function checkHeaderRendering() {
  const source = readFileSync(join(SRC, 'navigation', 'RootNavigator.tsx'), 'utf8')
  // 関数を直接渡すと AppStackHeader の hook が呼び出し側に数えられるので、要素として描く書き方も通す
  if (!/header:\s*(?:AppStackHeader\b|\([^)]*\)\s*=>\s*<AppStackHeader\b)/.test(source)) {
    problems.push('共通stack optionsが AppStackHeader を使っていない。OS背景に円の形を任せない')
  }
  for (const stack of ['PlanStack', 'FeedStack', 'MyPageStack']) {
    const navigator = source.match(new RegExp(`<${stack}\\.Navigator\\b[\\s\\S]*?>`))
    if (!navigator || !/screenOptions=\{localizedStackOptions\(/.test(navigator[0])) {
      problems.push(`${stack} が共通stack optionsを使っていない`)
    }
  }
}

function checkIconSizing() {
  const file = join(SRC, 'components', 'atoms', 'HeaderIconButton.tsx')
  const source = readFileSync(file, 'utf8')
  const icon = source.match(/<AppIcon[\s\S]*?\/>/)
  if (!icon) {
    problems.push('src/components/atoms/HeaderIconButton.tsx の <AppIcon> が読み取れない')
    return
  }
  for (const prop of ['width', 'height', 'lineHeight']) {
    if (!new RegExp(`${prop}:\\s*size\\s*[,}]`).test(icon[0])) {
      problems.push(
        `HeaderIconButton の <AppIcon> に ${prop}: size が無い。` +
        'ヘッダーのアイコンは外側から内側まで全階層で寸法を数値で固定する',
      )
    }
  }
  // 外側のスロットも中身から幅を決めさせない
  if (!/slot:\s*\{[^}]*width:\s*SLOT\s*,[^}]*height:\s*SLOT\s*,/.test(source)) {
    problems.push('HeaderIconButton の styles.slot が width/height とも SLOT で固定されていない')
  }
  if (!/surface:\s*\{[^}]*width:\s*DIAMETER\s*,[^}]*height:\s*DIAMETER\s*,[^}]*borderRadius:\s*DIAMETER\s*\/\s*2\s*,/.test(source)) {
    problems.push('HeaderIconButton の円が DIAMETER × DIAMETER / 半径 DIAMETER / 2 になっていない')
  }
  if (!/const SLOT = UI_METRICS\.headerSlotSize/.test(source)
    || !/const DIAMETER = UI_METRICS\.headerActionSize/.test(source)) {
    problems.push('HeaderIconButton のタップ領域と見える円が専用トークンを使っていない')
  }
  if (/Platform\.OS|OS_DRAWS_BUTTON_BACKGROUND|hitSlop=/.test(source)) {
    problems.push('HeaderIconButton にOS依存の背景または隣のボタンと重なるhitSlopがある')
  }
}

checkSources()
checkHeaderRendering()
checkIconSizing()

if (problems.length > 0) {
  console.error('ヘッダーボタンの監査で問題が見つかった:\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log('ヘッダーボタン: 問題なし')
