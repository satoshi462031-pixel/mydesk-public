/**
 * 「？」の説明が指す対象 ID が、画面側に登録されているかを検査する。
 * `npm run audit:coach-targets`
 *
 * 説明（CoachStep の target / within / coveredBy）と画面の登録（coachTarget('…') / CoachAnchor id=… など）は
 * 文字列でしかつながっていない。登録が無い説明は、開いても黙って飛ばされるだけで、
 * 型検査にも既存のテストにも掛からない（2026-10 に、手で突き合わせて初めて抜けが見つかった）。
 * 登録は src 全体から拾うので、別の画面に同じ ID があれば通ってしまう。画面ごとの出し分けまでは見ない。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = process.env.AUDIT_ROOT ?? join(__dirname, '..')
const SRC = join(ROOT, 'src')

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

interface Reference { id: string; file: string; line: number }

export function auditCoachTargets(root = SRC): { missing: Reference[]; referenced: number; registered: number } {
  const files = walk(root).map((file) => ({
    file,
    ast: ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
  }))

  // DESK_CONTENT や UNDER_CONTENT のように定数で渡す ID を、宣言までたどるための表
  const constants = new Map<string, ts.Expression>()
  for (const { ast } of files) {
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
        && (node.parent.flags & ts.NodeFlags.Const)) constants.set(node.name.text, node.initializer)
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }

  /** 式が取りうる文字列。`${coachKey}-action` のような組み立ては接尾辞として返す */
  const strings = (expr: ts.Expression | undefined, seen = new Set<string>()): { exact: string[]; suffixes: string[] } => {
    const out = { exact: [] as string[], suffixes: [] as string[] }
    const add = (other: { exact: string[]; suffixes: string[] }) => { out.exact.push(...other.exact); out.suffixes.push(...other.suffixes) }
    if (!expr) return out
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) out.exact.push(expr.text)
    else if (ts.isTemplateExpression(expr) && expr.head.text === '' && expr.templateSpans.length === 1) out.suffixes.push(expr.templateSpans[0].literal.text)
    else if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) add(strings(expr.expression, seen))
    else if (ts.isConditionalExpression(expr)) { add(strings(expr.whenTrue, seen)); add(strings(expr.whenFalse, seen)) }
    else if (ts.isBinaryExpression(expr)) { add(strings(expr.left, seen)); add(strings(expr.right, seen)) }
    else if (ts.isArrayLiteralExpression(expr)) expr.elements.forEach((element) => add(strings(element as ts.Expression, seen)))
    else if (ts.isIdentifier(expr) && !seen.has(expr.text) && constants.has(expr.text)) add(strings(constants.get(expr.text), new Set([...seen, expr.text])))
    return out
  }

  const registered = new Set<string>()
  const coachKeys = new Set<string>()
  const suffixes = new Set<string>()
  const register = (expr: ts.Expression | undefined) => {
    const found = strings(expr)
    found.exact.forEach((id) => registered.add(id))
    found.suffixes.forEach((suffix) => suffixes.add(suffix))
  }
  const references: Reference[] = []
  const STEP_KEYS = new Set(['target', 'within', 'coveredBy', 'targetId'])

  for (const { file, ast } of files) {
    // 説明の定義を持つファイル（CoachStep の配列・SPOTLIGHT_STEPS）だけで、target などの鍵を読む。
    // ほかのファイルの target: は遷移のイベントなど別物
    const definesSteps = /\bCoachStep\b|SPOTLIGHT_STEPS\s*[:=]/.test(ast.text)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && ['coachTarget', 'useCoachTarget', 'useSpotlightTarget'].includes(node.expression.text)) register(node.arguments[0])
      if (ts.isJsxAttribute(node) && node.initializer) {
        const name = node.name.getText(ast)
        const tag = node.parent.parent
        const tagName = ts.isJsxOpeningElement(tag) || ts.isJsxSelfClosingElement(tag) ? tag.tagName.getText(ast) : ''
        const value = ts.isStringLiteral(node.initializer) ? node.initializer
          : ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined
        if (tagName === 'CoachAnchor' && (name === 'id' || name === 'also')) register(value)
        if (name === 'coachTarget') register(value)
        if (name === 'coachKey') strings(value).exact.forEach((key) => { coachKeys.add(key); registered.add(key) })
      }
      if (definesSteps && ts.isPropertyAssignment(node) && STEP_KEYS.has(node.name.getText(ast))) {
        const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
        strings(node.initializer).exact.forEach((id) => references.push({ id, file, line }))
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  for (const key of coachKeys) for (const suffix of suffixes) registered.add(`${key}${suffix}`)

  return { missing: references.filter((ref) => !registered.has(ref.id)), referenced: new Set(references.map((ref) => ref.id)).size, registered: registered.size }
}

if (require.main === module) {
  const { missing, referenced, registered } = auditCoachTargets()
  if (missing.length > 0) {
    console.error(`画面に登録の無い説明の対象が ${missing.length} 件あります（開いても黙って飛ばされます）:`)
    for (const ref of missing) console.error(`  ${relative(ROOT, ref.file)}:${ref.line}  '${ref.id}'`)
    process.exit(1)
  }
  console.log(`OK: 説明が指す ${referenced} 種類の対象は、すべて画面に登録されています（登録 ${registered} 種類）`)
}
