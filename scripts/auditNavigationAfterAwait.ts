/**
 * 待ち終わりの画面遷移の守り漏れを検査する。`npm run audit:nav-after-await`
 *
 * React Navigation 6 の goBack / replace / pop は、呼んだ画面の key（source）しか付けずに送られ、
 * ルーターは target が無いと source を見ずに「その時点で一番上の画面」に効かせる
 * （@react-navigation/routers の StackRouter の POP / REPLACE）。保存や生成を待つ間に利用者が
 * 戻ると、待ち終わりの遷移が別の画面を閉じる・置き換える。実際に、配置の生成中に戻ると
 * マイデスク一覧が配線図に置き換わって一覧へ戻れなくなり、課金画面の復元の OK で見ていた
 * 公開デスクが閉じていた。navigate / reset も、離れた後に作成の続きへ連れ戻す。
 *
 * await の後（await の後に作ったコールバックと .then の中を含む）で画面の navigation を動かす
 * 呼び出しは、isFocused() で囲むか、手前で `if (!navigation.isFocused()) return` する。
 * 離れていても動かすのが正しい遷移（ログアウト後に最初の画面へ戻すなど）は、直前の行に
 * `// nav-after-await-ok: 理由` を書いて外す。理由の無い注記は通さない。
 * アプリ全体の navigationRef（深いリンクや認証の後の遷移）は呼んだ画面を持たないので対象外。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const ROOT = join(__dirname, '..')
const SRC = join(ROOT, 'src')
const NAV_METHODS = new Set(['goBack', 'replace', 'reset', 'navigate', 'push', 'pop', 'popToTop', 'dispatch'])
const PROMISE_CONTINUATIONS = new Set(['then', 'catch', 'finally'])
const OPT_OUT = /nav-after-await-ok:\s*\S/

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const isFunctionLike = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)

const isAsync = (fn: ts.FunctionLikeDeclaration) =>
  !!ts.getModifiers(fn as ts.HasModifiers)?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)

/** 画面の navigation（navigationRef ではない）を、メソッド呼び出しか引数で動かしているか */
function navigationCallKind(call: ts.CallExpression, source: ts.SourceFile): string | null {
  const callee = call.expression
  if (ts.isPropertyAccessExpression(callee) && NAV_METHODS.has(callee.name.text)) {
    const target = callee.expression.getText(source)
    if (/navigation/.test(target) && !/navigationRef/.test(target)) return `${callee.name.text}()`
  }
  // resumeSetupStep(navigation, …) のように navigation を渡して先で遷移させる呼び出し
  if (call.arguments.some((arg) => ts.isIdentifier(arg) && arg.text === 'navigation')) {
    return `${callee.getText(source)}(navigation, …)`
  }
  return null
}

/** fn の本文のうち、入れ子の関数を除いて、位置 before より前に await があるか */
function hasAwaitBefore(fn: ts.FunctionLikeDeclaration, before: number): boolean {
  let found = false
  const visit = (node: ts.Node) => {
    if (found || node.getStart() >= before) return
    if (node !== fn && isFunctionLike(node)) return
    if (ts.isAwaitExpression(node) || (ts.isForOfStatement(node) && node.awaitModifier)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  if (fn.body) visit(fn.body)
  return found
}

const isPromiseContinuation = (fn: ts.Node) => {
  const parent = fn.parent
  return !!parent && ts.isCallExpression(parent) && parent.arguments.includes(fn as ts.Expression) &&
    ts.isPropertyAccessExpression(parent.expression) && PROMISE_CONTINUATIONS.has(parent.expression.name.text)
}

/** 呼び出しが待ち終わりに走るなら、その起点の関数を返す */
function lateBoundary(call: ts.CallExpression): ts.Node | null {
  let point = call.getStart()
  for (let node: ts.Node | undefined = call.parent; node; node = node.parent) {
    if (!isFunctionLike(node)) continue
    if (isPromiseContinuation(node)) return node
    if (isAsync(node) && hasAwaitBefore(node, point)) return node
    // await の後に作ったコールバック（Alert のボタンなど）も待ち終わりに走るので、外側へたどる
    point = node.getStart()
  }
  return null
}

const mentionsFocus = (node: ts.Node, source: ts.SourceFile) => /isFocused\(\)/.test(node.getText(source))

const exitsEarly = (statement: ts.Statement): boolean =>
  ts.isReturnStatement(statement) || ts.isThrowStatement(statement) ||
  (ts.isBlock(statement) && statement.statements.some(exitsEarly))

/** 起点から呼び出しまでの間に isFocused() の守りがあるか */
function guarded(call: ts.CallExpression, boundary: ts.Node, source: ts.SourceFile): boolean {
  let child: ts.Node = call
  for (let node: ts.Node | undefined = call.parent; node && node !== boundary.parent; child = node, node = node.parent) {
    // if (isFocused()) …、cond && isFocused() && …、isFocused() ? … : …
    if (ts.isIfStatement(node) && child === node.thenStatement && mentionsFocus(node.expression, source)) return true
    if (ts.isConditionalExpression(node) && child === node.whenTrue && mentionsFocus(node.condition, source)) return true
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        child === node.right && mentionsFocus(node.left, source)) return true
    // 手前の `if (!navigation.isFocused()) return`
    if (ts.isBlock(node) || ts.isSourceFile(node)) {
      const statements = node.statements as ts.NodeArray<ts.Statement>
      const index = statements.indexOf(child as ts.Statement)
      for (let i = 0; i < index; i++) {
        const statement = statements[i]
        if (ts.isIfStatement(statement) && mentionsFocus(statement.expression, source) && exitsEarly(statement.thenStatement)) return true
      }
    }
  }
  return false
}

function optedOut(call: ts.CallExpression, source: ts.SourceFile, lines: string[]): boolean {
  const line = source.getLineAndCharacterOfPosition(call.getStart()).line
  return lines.slice(Math.max(0, line - 3), line + 1).some((text) => OPT_OUT.test(text))
}

const problems: string[] = []
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8')
  if (!/navigation/.test(text)) continue
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = text.split('\n')
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const kind = navigationCallKind(node, source)
      if (kind) {
        const boundary = lateBoundary(node)
        if (boundary && !guarded(node, boundary, source) && !optedOut(node, source, lines)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
          problems.push(`${relative(ROOT, file).replace(/\\/g, '/')}:${line} 待ち終わりの ${kind} に isFocused() の守りが無い`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error(`\n${problems.length} 件。待つ間に戻ると、別の画面を閉じる・置き換える・離れた画面へ連れ戻す。` +
    '`if (!navigation.isFocused()) return` で守るか、離れていても動かすのが正しいなら `// nav-after-await-ok: 理由` を書く')
  process.exit(1)
}
console.log('navigation after await audit passed')
