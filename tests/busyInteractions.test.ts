import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// 操作の多い画面で、処理中の別の操作・閉じかけのシートと Alert が重なったときの振る舞いを、
// 画面のソースから関数を切り出して確かめる（categorySettingsNavigation.test.ts と同じ書き方）
function callback(file: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `Missing callback ${name}`)
  const code = ts.transpileModule(`(${expression.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return runInNewContext(code, bindings) as (...args: any[]) => any
}

test('デスクの作成中は、構成の画面から機材の設定を開かない', async () => {
  // 開くと作成が上の画面の裏で終わり、戻ったとき「作成」がまた押せて同じデスクが2つできていた
  const pushes: unknown[] = []
  const open = callback('src/screens/TemplateDetailScreen.tsx', 'openItemDetail', {
    navigation: { isFocused: () => true, push: (...args: unknown[]) => pushes.push(args) },
    draftCreatingRef: { current: false },
    createInFlightRef: { current: true },
  })
  await open({ key: 'monitor', category: 'Monitor' })
  assert.equal(pushes.length, 0)
})

test('作成中は構成の画面から離れさせず、進捗バーからも戻らせない', () => {
  const source = readFileSync('src/screens/TemplateDetailScreen.tsx', 'utf8')
  // iOS のスワイプの戻るまで止めるには、beforeRemove ではなくこのフックが要る
  assert.match(source, /usePreventRemove\(creating,/)
  assert.match(source, /canNavigate=\{\(step\) => !creating &&/)
  assert.match(source, /pointerEvents=\{creating \? 'none' : 'auto'\}/)
})

for (const os of ['ios', 'android'] as const) {
  test(`バックアップの復元の案内は、復元のシートが閉じ終わってから出す（${os}）`, () => {
    // iOS は閉じかけのシートの上に Alert を出せず、自動保存を再開する手順の案内がシートと一緒に消えていた
    const shown: string[] = []
    const restoreNoticeRef = { current: null as (() => void) | null }
    const bindings = { Platform: { OS: os }, restoreNoticeRef }
    const showAfter = callback('src/screens/SettingsScreen.tsx', 'showAfterRestoreModalCloses', bindings)
    const onDismiss = callback('src/screens/SettingsScreen.tsx', 'showPendingRestoreNotice', bindings)
    showAfter(() => shown.push('restored'))
    if (os === 'ios') {
      assert.deepEqual(shown, [])
      onDismiss()
    }
    assert.deepEqual(shown, ['restored'])
    // シートの閉じ終わりが2回来ても2度出さない
    onDismiss()
    assert.deepEqual(shown, ['restored'])
  })
}

test('デスクの歴史を再生できなかったとき、シートは Alert の OK のあとに閉じる', () => {
  // 先に閉じると、シートの上に出した Alert が iOS ではシートと一緒に閉じられていた
  const source = readFileSync('src/components/organisms/DeskHistoryAnimationModal.tsx', 'utf8')
  const start = source.indexOf("analytics.error('desk_history_prepare', error)")
  assert.ok(start > 0)
  const block = source.slice(start, source.indexOf('})', source.indexOf('Alert.alert(', start)) + 2)
  assert.match(block, /\{ text: 'OK', onPress: \(\) => onCloseRef\.current\(\) \}/)
  // Alert の外で閉じていない
  assert.doesNotMatch(block.replace(/onPress: \(\) => onCloseRef\.current\(\)/, ''), /onCloseRef\.current\(\)/)
})
