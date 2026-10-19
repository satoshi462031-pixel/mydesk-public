/**
 * 1行入力欄が TextField / SearchField を迂回していないかを検査する。
 * `npm run audit:text-fields`
 *
 * 高さ・枠・内部余白・文字サイズを画面側に戻すと、同じ役割の欄がまた割れる。
 * containerStyle は配置専用とし、見た目を変えるプロパティも検出する。
 * TextInput に直接付けた lineHeight も止める（iOS で例文が下へずれるのを繰り返したため）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')
const TEXT_FIELD_FILE = 'src/components/atoms/TextField.tsx'
const CONTROL_STYLE_KEYS = new Set([
  'height', 'minHeight', 'maxHeight',
  'padding', 'paddingHorizontal', 'paddingVertical', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'borderWidth', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'borderColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'backgroundColor', 'color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'gap',
])

function propertyName(node: ts.PropertyName, source: ts.SourceFile): string | null {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  return node.getText(source)
}

// 展開（...x）は中身を追えないので `...x` の形で記録する。multilineInputText の展開だけは中身が分かっている
const MULTILINE_INPUT_TEXT_SPREAD = '...multilineInputText'

function objectKeys(object: ts.ObjectLiteralExpression, source: ts.SourceFile): Set<string> {
  const keys = new Set<string>()
  for (const prop of object.properties) {
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const key = propertyName(prop.name, source)
      if (key) keys.add(key)
    } else if (ts.isSpreadAssignment(prop)) {
      const isHelper = ts.isCallExpression(prop.expression)
        && prop.expression.expression.getText(source) === 'multilineInputText'
      keys.add(isHelper ? MULTILINE_INPUT_TEXT_SPREAD : `...${prop.expression.getText(source)}`)
    }
  }
  return keys
}

function stylesByName(source: ts.SourceFile): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === 'StyleSheet'
      && node.expression.name.text === 'create'
      && node.arguments[0]
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const style of node.arguments[0].properties) {
        if (!ts.isPropertyAssignment(style) || !ts.isObjectLiteralExpression(style.initializer)) continue
        const name = propertyName(style.name, source)
        if (!name) continue
        result.set(name, objectKeys(style.initializer, source))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

function jsxAttribute(node: ts.JsxAttributes, name: string): ts.JsxAttribute | undefined {
  return node.properties.find((prop): prop is ts.JsxAttribute => (
    ts.isJsxAttribute(prop) && prop.name.getText() === name
  ))
}

function isMultiline(attributes: ts.JsxAttributes): boolean {
  const attr = jsxAttribute(attributes, 'multiline')
  if (!attr) return false
  if (!attr.initializer) return true
  if (!ts.isJsxExpression(attr.initializer) || !attr.initializer.expression) return true
  return attr.initializer.expression.kind === ts.SyntaxKind.TrueKeyword
}

function restrictedContainerKeys(
  expression: ts.Expression,
  source: ts.SourceFile,
  styles: Map<string, Set<string>>,
): Set<string> {
  const found = new Set<string>()
  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(node)
      && node.expression.getText(source) === 'styles'
    ) {
      for (const key of styles.get(node.name.text) ?? []) {
        if (CONTROL_STYLE_KEYS.has(key)) found.add(key)
      }
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue
        const key = propertyName(prop.name, source)
        if (key && CONTROL_STYLE_KEYS.has(key)) found.add(key)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(expression)
  return found
}

/**
 * TextInput の style に入る lineHeight を探す。iOS の TextInput は <Text> と違い lineHeight の余りを
 * 字の上に全部足すので、例文（placeholder）や入力した文字が下へずれる（utils/multilineInputText.ts）。
 * 複数行の欄は multilineInputText を通したときだけ許し、1行の欄はそれも許さない。
 */
function inputLineHeightProblems(
  expression: ts.Expression,
  source: ts.SourceFile,
  styles: Map<string, Set<string>>,
  multiline: boolean,
): string[] {
  const found = new Set<string>()
  const check = (keys: Iterable<string>) => {
    for (const key of keys) {
      if (key === 'lineHeight') found.add('lineHeight')
      else if (key === MULTILINE_INPUT_TEXT_SPREAD) { if (!multiline) found.add('multilineInputText') }
      else if (key.startsWith('...')) found.add(key)
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(source) === 'styles') {
      check(styles.get(node.name.text) ?? [])
    } else if (ts.isObjectLiteralExpression(node)) {
      check(objectKeys(node, source))
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(expression)
  return [...found].sort()
}

export function auditTextFieldSource(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const styles = stylesByName(source)
  const problems: string[] = []

  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(source)
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      if (tag === 'TextInput' && file !== TEXT_FIELD_FILE && !isMultiline(node.attributes)) {
        problems.push(`${file}:${line} 1行の TextInput は TextField または SearchField を使う`)
      }
      if (tag === 'TextInput') {
        const attr = jsxAttribute(node.attributes, 'style')
        if (attr?.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          const multiline = isMultiline(node.attributes)
          const found = inputLineHeightProblems(attr.initializer.expression, source, styles, multiline)
          if (found.length > 0) {
            problems.push(multiline
              ? `${file}:${line} 複数行の TextInput の lineHeight は multilineInputText を通す（iOS で字が下へずれる）: ${found.join(', ')}`
              : `${file}:${line} 1行の TextInput に lineHeight を付けない（iOS で例文が下へずれる）: ${found.join(', ')}`)
          }
        }
      }
      if (tag === 'TextField' || tag === 'SearchField') {
        const attr = jsxAttribute(node.attributes, 'containerStyle')
        if (attr?.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          const keys = [...restrictedContainerKeys(attr.initializer.expression, source, styles)].sort()
          if (keys.length > 0) {
            problems.push(`${file}:${line} containerStyle が入力欄の見た目を上書きしている: ${keys.join(', ')}`)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return problems
}

function* tsxFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* tsxFiles(path)
    else if (entry.isFile() && entry.name.endsWith('.tsx')) yield path
  }
}

export function auditTextFieldTree(srcDir = SRC, projectRoot = ROOT): string[] {
  const problems: string[] = []
  for (const path of tsxFiles(srcDir)) {
    const file = relative(projectRoot, path).replace(/\\/g, '/')
    problems.push(...auditTextFieldSource(file, readFileSync(path, 'utf8')))
  }
  return problems
}

if (require.main === module) {
  const files = [...tsxFiles(SRC)]
  const problems = auditTextFieldTree()

  const component = readFileSync(join(ROOT, TEXT_FIELD_FILE), 'utf8')
  if (!component.includes('minHeight: UI_METRICS.inputHeight')) {
    problems.push(`${TEXT_FIELD_FILE} の通常高が UI_METRICS.inputHeight から外れている`)
  }
  if (!component.includes('minHeight: UI_METRICS.compactInputHeight')) {
    problems.push(`${TEXT_FIELD_FILE} の小型高が UI_METRICS.compactInputHeight から外れている`)
  }

  if (problems.length > 0) {
    console.error('入力欄の監査で問題が見つかった:\n')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }
  console.log(`入力欄: 問題なし（${files.length} ファイルを検証）`)
}
