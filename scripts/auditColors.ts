/**
 * 色トークンのコントラスト監査。`npm run audit:colors`
 *
 * design.md の表を手で計算し直すのは現実的でないので、正本（constants/colors.ts・
 * accentColors.ts・portTypes.ts・ui.ts）から実際の値を読んで WCAG 2.1 の
 * コントラスト比を機械的に検証する。色を足す・変えるときは必ずこれを通す。
 *
 * しきい値:
 *   4.5 本文（12〜15px の文字。このアプリの文字はほぼ全部ここ）
 *   3.0 アイコン・配線・意味を持つ塗り（非テキストUI = WCAG 1.4.11）
 *   1.5 面を分けるヘアライン（design.md が採る基準。1.4.11 の対象外）
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { ACCENT_PRESETS } from '../src/constants/accentColors'
import { accentIconColor, buildColors, CATEGORY_COLORS, categoryIconColor, compositeColor as flatten, CUSTOM_CATEGORY_COLOR_PRESETS, YELLOW_REFERENCE } from '../src/constants/colors'
import { CABLE_SORT_ORDER, portColor, portIconColor } from '../src/constants/portTypes'
import { PURPOSE_COLORS, purposeIconColor } from '../src/constants/purposeColors'
import { PUBLIC_DESK_HEADER_BG, PUBLIC_DESK_HEADER_TINT, statusTextColor, UI_STATUS_COLORS, UI_STATUS_ON_WARNING } from '../src/constants/ui'

const TEXT = 4.5
const UI = 3
const HAIRLINE = 1.5

// ─── accent を敷いた面の濃さ ─────────────────────────────────
// 淡色（accentText を載せてよい面）の上限と、塗り（onAccent を載せる面）の下限。
// この間の濃さは、文字を載せるとどちらの基準も満たさない面になる
const TINT_MAX = 0x18
const FILL_MIN = 0x38

function channels(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`色が #RRGGBB ではない: ${hex}`)
  return [0, 2, 4].map((o) => parseInt(m[1].slice(o, o + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

/**
 * 実装が `C.accent + 'XX'` / `withOpacity(accent, N)` で敷いている面の濃さを集める。
 *
 * 以前は '18' だけを固定で見ていたため、'1E'〜'24' を敷いた面に accentText を
 * 載せた5箇所（公開バッジ・年表チップ・デスク歴・使用中バッジ・Paywall の理由）が
 * 素通りしていた。ライトモードで最小 4.34 で、AA(4.5) を割っていた。
 *
 * withOpacity の第2引数は 0-255 のアルファ（AppContext の実装）。'18' と 24 は同じ濃さ。
 */
function accentSurfaces(): { tints: string[]; ambiguous: string[]; rawIcons: string[]; unreadableText: string[] } {
  const tints = new Set<string>()
  const ambiguous: string[] = []
  const rawIcons: string[] = []
  const unreadableText = new Set<string>()
  const iconTags = new Set(['AppIcon', 'CategoryIcon', 'ActivityIndicator', 'HeaderIconButton', 'IconCircleButton', 'TabUnderline', 'Path', 'AnimatedPath', 'Circle', 'Line', 'Polyline'])
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!/\.tsx?$/.test(entry.name)) continue
      const source = readFileSync(path, 'utf8')
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, entry.name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
      const bindings = new Map<ts.Node, Map<string, { expression: ts.Expression; token?: string }>>()
      const collect = (node: ts.Node): void => {
        if (ts.isVariableDeclaration(node) && node.initializer) {
          let scope: ts.Node = node.parent
          while (!ts.isBlock(scope) && !ts.isSourceFile(scope)) scope = scope.parent
          const names = bindings.get(scope) ?? new Map()
          bindings.set(scope, names)
          if (ts.isIdentifier(node.name)) names.set(node.name.text, { expression: node.initializer })
          if (ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              if (ts.isIdentifier(element.name)) names.set(element.name.text, {
                expression: node.initializer, token: (element.propertyName ?? element.name).getText(file),
              })
            }
          }
        }
        ts.forEachChild(node, collect)
      }
      collect(file)
      const usesAccentToken = (node: ts.Node, token: 'accent' | 'accentIcon', seen = new Set<ts.Node>()): boolean => {
        if (seen.has(node)) return false
        seen.add(node)
        if (ts.isConditionalExpression(node)) return usesAccentToken(node.whenTrue, token, seen) || usesAccentToken(node.whenFalse, token, seen)
        if (ts.isPropertyAccessExpression(node) && node.name.text === token &&
          ts.isIdentifier(node.expression) && ['C', 'c', 'colors', 'ctxColors'].includes(node.expression.text)) return true
        if (ts.isIdentifier(node)) {
          for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
            const binding = bindings.get(scope)?.get(node.text)
            if (binding) return binding.token === token || usesAccentToken(binding.expression, token, seen)
          }
          return false
        }
        return ts.forEachChild(node, (child) => usesAccentToken(child, token, seen)) === true
      }
      const visit = (node: ts.Node): void => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && iconTags.has(node.tagName.getText(file))) {
          for (const attr of node.attributes.properties) {
            if (ts.isJsxAttribute(attr) && ['color', 'stroke', 'fill'].includes(attr.name.getText(file)) && attr.initializer &&
              ts.isJsxExpression(attr.initializer) && attr.initializer.expression && usesAccentToken(attr.initializer.expression, 'accent')) {
              const line = file.getLineAndCharacterOfPosition(attr.getStart(file)).line + 1
              rawIcons.push(`${path.replace(/.*[\\/]src[\\/]/, 'src/')}:${line} ${attr.getText(file)}`)
            }
          }
        }
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          /^(?:(?:Animated|Reanimated)\.)?Text(?:Input)?$/.test(node.tagName.getText(file))) {
          const inspectColor = (style: ts.Node): void => {
            if (ts.isPropertyAssignment(style) && style.name.getText(file) === 'color' &&
              (usesAccentToken(style.initializer, 'accent') || usesAccentToken(style.initializer, 'accentIcon'))) {
              const line = file.getLineAndCharacterOfPosition(style.getStart(file)).line + 1
              unreadableText.add(`${path.replace(/.*[\\/]src[\\/]/, 'src/')}:${line} ${style.getText(file)}`)
            }
            ts.forEachChild(style, inspectColor)
          }
          for (const attr of node.attributes.properties) {
            if (ts.isJsxAttribute(attr) && attr.name.getText(file) === 'style' && attr.initializer) inspectColor(attr.initializer)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(file)
      const alphas = [
        ...[...source.matchAll(/accent \+ '([0-9A-Fa-f]{2})'/g)].map((m) => m[1].toUpperCase()),
        ...[...source.matchAll(/withOpacity\((?:colors|C)\.accent,\s*(\d+)\)/g)]
          .map((m) => Number(m[1]).toString(16).padStart(2, '0').toUpperCase()),
      ]
      for (const hex of alphas) {
        const value = parseInt(hex, 16)
        if (value <= TINT_MAX) tints.add(hex)
        else if (value < FILL_MIN) {
          ambiguous.push(`${path.replace(/.*[\\/]src[\\/]/, 'src/')} の accent + '${hex}'`)
        }
      }
    }
  }
  walk(join(__dirname, '..', 'src'))
  return { tints: [...tints].sort(), ambiguous, rawIcons, unreadableText: [...unreadableText] }
}

const ACCENT = accentSurfaces()

type Finding = { group: string; what: string; fg: string; bg: string; ratio: number; need: number }
const findings: Finding[] = []
let checked = 0

function check(group: string, what: string, fg: string, bg: string, need: number): void {
  checked++
  const ratio = contrast(fg, bg)
  if (ratio < need) findings.push({ group, what, fg, bg, ratio, need })
}

function checkIcon(group: string, what: string, fg: string, bg: string): void {
  // 黄は明るい地で 3:1 に届かないのを承知で #FFD400 にしている（下の免除の一覧）。暗い地では測る
  if (fg.toUpperCase() === YELLOW_REFERENCE && contrast(fg, bg) < UI && contrast('#FFFFFF', bg) < 1.5) return
  check(group, what, fg, bg, UI)
}

// 実際に起きる組み合わせだけを見る。総当たりにすると「input の上の border」
// のように存在しない組で埋まり、本物の不足が埋もれる。
//
// 意図して免除しているもの:
//   chevron  行末の「>」。行全体がタップ対象でラベルが意味を運ぶ純粋な装飾で、
//            iOS 標準の淡さ（#C7C7CC）に合わせている。
//   accent の塗り自体 vs 地
//            塗ったボタン・チップは載る文字が onAccent で 5.19:1 以上を確保するため、
//            塗りと地の境界に 3:1 を求めない。
//   黄（#FFD400）vs 明るい地
//            3:1 に届く黄は金〜からし色にしかならず「暗い」、縁取りは「影みたい」と本人が退けた
//            （2026-10-10）。黄のアイコン・配線・星・王冠・拍手は見本の #FFD400 にし、明るい地では測らない。
for (const isDark of [false, true]) {
  const theme = isDark ? 'dark' : 'light'
  const C = buildColors(isDark)

  // 文字が載る面。header / tabBar は card と、bgList は bg と同値
  const textSurfaces: [string, string][] = [['card', C.card], ['bg', C.bg], ['chip', C.chip], ['input', C.input]]

  for (const [name, surface] of textSurfaces) {
    for (const token of ['text', 'textSub', 'textMuted'] as const) {
      check(`${theme}/文字`, `${token} on ${name}`, C[token], surface, TEXT)
    }
  }
  for (const [name, surface] of [['card', C.card], ['bg', C.bg]] as [string, string][]) {
    check(`${theme}/状態色`, `danger on ${name}`, C.danger, surface, TEXT)
    check(`${theme}/状態色`, `info on ${name}`, C.info, surface, TEXT)
    check(`${theme}/境界`, `border on ${name}`, C.border, surface, HAIRLINE)
    for (const cat of Object.keys(CATEGORY_COLORS)) {
      checkIcon(`${theme}/カテゴリ色`, `${cat} on ${name}`, categoryIconColor(cat, isDark), surface)
    }
  }
  // 行の区切り線はカードの中にしか引かない
  check(`${theme}/境界`, 'separator on card', C.separator, C.card, HAIRLINE)
  check(`${theme}/境界`, 'divider on card', C.divider, C.card, HAIRLINE)
  // 入力欄の枠は「どこが入力欄か」を示す部品なので、面の区切り線より厳しい 3:1
  check(`${theme}/境界`, 'inputBorder on input', C.inputBorder, C.input, UI)
  check(`${theme}/境界`, 'inputBorder on card', C.inputBorder, C.card, UI)
  check(`${theme}/境界`, 'inputBorder on bg', C.inputBorder, C.bg, UI)
  check(`${theme}/スイッチ`, 'off thumb on track', '#FFFFFF', isDark ? C.border : C.textMuted, UI)

  // 写真上の半透明黒は、白い写真に重ねた場合が最も明るくなる。
  check(`${theme}/拍手`, 'onClap on photo overlay', C.onClap, flatten('#000000B8', '#FFFFFF'), UI)
  check(`${theme}/拍手`, 'onClapFill on clap', C.onClapFill, C.clap, UI)
  check(`${theme}/更新`, 'onUpdate on update', C.onUpdate, C.update, TEXT)
  // 反応・状態の固定色（テーマカラーで変えない）
  for (const [name, surface] of [['card', C.card], ['bg', C.bg], ['chip', C.chip]] as [string, string][]) {
    checkIcon(`${theme}/拍手`, `clap on ${name}`, C.clap, surface)
    check(`${theme}/固定色`, `saved on ${name}`, C.saved, surface, UI)
    checkIcon(`${theme}/固定色`, `favorite on ${name}`, C.favorite, surface)
    check(`${theme}/状態色`, `success on ${name}`, C.success, surface, TEXT)
    checkIcon(`${theme}/固定色`, `pro on ${name}`, C.pro, surface)
    check(`${theme}/固定色`, `unread on ${name}`, C.unread, surface, UI)
    check(`${theme}/更新`, `update on ${name}`, C.update, surface, TEXT)
  }
  check(`${theme}/状態色`, 'success on success tint', C.success, flatten(C.success + '18', C.card), UI)
  // Pro の王冠は accent を淡く敷いた面（課金画面の器・写真の上限の枠・年表の鍵）にも載る
  for (const preset of ACCENT_PRESETS) {
    for (const tint of ACCENT.tints) {
      for (const [name, surface] of [['card', C.card], ['bg', C.bg]] as [string, string][]) {
        checkIcon(`${theme}/固定色`, `pro on accent(${preset.key})+'${tint}' over ${name}`, C.pro, flatten(preset.color + tint, surface))
      }
    }
  }
  check(`${theme}/境界`, 'tabBarBorder on tabBar', C.tabBarBorder, C.tabBar, HAIRLINE)

  for (const cat of Object.keys(CATEGORY_COLORS)) {
    checkIcon(`${theme}/カテゴリ色`, `${cat} on chip`, categoryIconColor(cat, isDark), C.chip)
    for (const alpha of isDark ? ['22', '38'] : ['22']) {
      checkIcon(`${theme}/カテゴリ色`, `${cat} on category+'${alpha}' over chip`, categoryIconColor(cat, isDark), flatten(CATEGORY_COLORS[cat] + alpha, C.chip))
    }
  }
  for (const color of [...CUSTOM_CATEGORY_COLOR_PRESETS.map((preset) => preset.color), '#000000', '#FFFFFF']) {
    checkIcon(`${theme}/自由カテゴリ色`, `${color} on chip`, categoryIconColor('Other', isDark, undefined, color), C.chip)
    checkIcon(`${theme}/自由カテゴリ色`, `${color} on tinted chip`, categoryIconColor('Other', isDark, undefined, color), flatten(color + (isDark ? '38' : '22'), C.chip))
  }
  for (const purpose of Object.keys(PURPOSE_COLORS) as (keyof typeof PURPOSE_COLORS)[]) {
    for (const otherColor of [undefined, ...CUSTOM_CATEGORY_COLOR_PRESETS.map((preset) => preset.color), '#000000', '#FFFFFF']) {
      const background = purposeIconColor(purpose, isDark, otherColor)
      const foreground = contrast('#FFFFFF', background) >= TEXT ? '#FFFFFF' : '#000000'
      check(`${theme}/用途チェック`, `${purpose}/${otherColor ?? 'default'}`, foreground, background, TEXT)
    }
  }
  check(`${theme}/写真失敗`, 'textMuted on chip', C.textMuted, C.chip, UI)

  // 配線図の地は bgList
  for (const type of CABLE_SORT_ORDER) {
    checkIcon(`${theme}/配線色`, `${type} on bgList`, portColor(type, isDark), C.bgList)
    for (const [name, surface] of textSurfaces) {
      checkIcon(`${theme}/端子アイコン`, `${type} on ${name}`, portIconColor(type, isDark), surface)
    }
  }

  for (const p of ACCENT_PRESETS) {
    const accentText = isDark ? p.textDark : p.textLight
    const accentIcon = accentIconColor(p.color, isDark)
    check(`${theme}/accent`, `onAccent on accent(${p.key})`, p.onAccent, p.color, TEXT)
    for (const [name, surface] of [['card', C.card], ['bg', C.bg], ['chip', C.chip], ['input', C.input]] as [string, string][]) {
      check(`${theme}/accent`, `accentIcon(${p.key}) on ${name}`, accentIcon, surface, UI)
      check(`${theme}/accent`, `accentText(${p.key}) on ${name}`, accentText, surface, TEXT)
      // 選択中チップ・バッジの定番：accent を敷いた上に accentText を載せる。
      // 濃さは固定で書かず、実装が実際に使っているものを全部見る
      for (const tint of ACCENT.tints) {
        check(`${theme}/accent`, `accentIcon(${p.key}) on accent+'${tint}' over ${name}`, accentIcon, flatten(p.color + tint, surface), UI)
        check(`${theme}/accent`, `accentText(${p.key}) on accent+'${tint}' over ${name}`, accentText, flatten(p.color + tint, surface), TEXT)
      }
    }

    // 選択色は card の上に重ねる。リストの地へ直接重ねると日付の文字が 4.5:1 を割る。
    const selectedCard = flatten(p.color + '18', C.card)
    check(`${theme}/選択カード`, `accentIcon(${p.key}) on selectedCard`, accentIcon, selectedCard, UI)
    for (const token of ['text', 'textSub', 'textMuted'] as const) {
      check(`${theme}/選択カード`, `${token} on selectedCard(${p.key})`, C[token], selectedCard, TEXT)
    }
    for (const [category, color] of Object.entries(CATEGORY_COLORS)) {
      check(`${theme}/バッジ`, `text on decor(${category}) over selectedCard(${p.key})`, C.text, flatten(color + '22', selectedCard), TEXT)
    }
  }
  for (const [category, color] of Object.entries(CATEGORY_COLORS)) {
    check(`${theme}/バッジ`, `text on decor(${category}) over card`, C.text, flatten(color + '22', C.card), TEXT)
  }
  for (const kind of Object.keys(UI_STATUS_COLORS) as (keyof typeof UI_STATUS_COLORS)[]) {
    check(`${theme}/バッジ`, `text on ${kind} tint`, C.text, flatten(statusTextColor(kind, isDark) + '24', C.card), TEXT)
  }
}

for (const [name, color] of Object.entries(UI_STATUS_COLORS)) {
  check('固定色', `UI_STATUS_COLORS.${name} の文字`, name === 'warning' ? UI_STATUS_ON_WARNING : '#FFFFFF', color, TEXT)
  check('固定色', `statusTextColor(${name}, light)`, statusTextColor(name as keyof typeof UI_STATUS_COLORS, false), buildColors(false).card, TEXT)
  check('固定色', `statusTextColor(${name}, dark)`, statusTextColor(name as keyof typeof UI_STATUS_COLORS, true), buildColors(true).card, TEXT)
}
check('固定色', '公開デスクのヘッダー文字', PUBLIC_DESK_HEADER_TINT, PUBLIC_DESK_HEADER_BG, TEXT)

const byGroup = new Map<string, Finding[]>()
for (const f of findings) byGroup.set(f.group, [...(byGroup.get(f.group) ?? []), f])

console.log(`色コントラスト監査: ${checked} 組を検証、${findings.length} 件が基準未満\n`)
for (const [group, items] of [...byGroup].sort()) {
  console.log(`── ${group} (${items.length}) ` + '─'.repeat(Math.max(0, 40 - group.length)))
  for (const f of items.sort((a, b) => a.ratio - b.ratio)) {
    console.log(`  ${f.ratio.toFixed(2)} / ${f.need.toFixed(1)}  ${f.what}  ${f.fg} on ${f.bg}`)
  }
  console.log()
}

// 淡色と塗りの間の濃さは、文字を載せるとどちらの基準も満たさない面になる。
// 淡色は '18' 以下、塗りは '38' 以上に寄せる
if (ACCENT.ambiguous.length > 0) {
  console.log(`── accent の面の濃さ (${ACCENT.ambiguous.length}) ` + '─'.repeat(18))
  for (const where of ACCENT.ambiguous) {
    console.log(`  ${where} は淡色('18'以下)と塗り('38'以上)の間。文字を載せるとどちらの基準も満たさない`)
  }
  console.log()
}
if (ACCENT.rawIcons.length > 0) {
  console.log(`── アイコン・選択線に未補正の accent (${ACCENT.rawIcons.length})`)
  for (const where of ACCENT.rawIcons) console.log(`  ${where}`)
}
if (ACCENT.unreadableText.length > 0) {
  console.log(`── 文字に塗り・アイコン用の accent (${ACCENT.unreadableText.length})`)
  for (const where of ACCENT.unreadableText) console.log(`  ${where}`)
}

console.log(`accent を敷いた面の濃さ: ${ACCENT.tints.map((t) => `'${t}'`).join(' ') || 'なし'}`)

if (findings.length > 0 || ACCENT.ambiguous.length > 0 || ACCENT.rawIcons.length > 0 || ACCENT.unreadableText.length > 0) process.exitCode = 1
