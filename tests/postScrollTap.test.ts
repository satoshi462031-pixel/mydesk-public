import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const nativeSource = ts.createSourceFile('ScrollView.tsx', readFileSync(
  'node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js', 'utf8',
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function nativeMethod(name: string, owner: Record<string, any>, bindings: Record<string, unknown>) {
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isPropertyDeclaration(node) && node.name.getText(nativeSource) === name) expression = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(nativeSource)
  assert.ok(expression)
  return runInNewContext(ts.transpileModule(`(function () { return ${expression.getText(nativeSource)} }).call(owner)`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { owner, __DEV__: false, ...bindings })
}

function responder(props: Record<string, unknown> = {}) {
  let now = 200
  const owner: Record<string, any> = {
    props, _lastMomentumScrollBeginTime: 50, _lastMomentumScrollEndTime: 200,
    _softKeyboardIsDetached: () => false, _keyboardIsDismissible: () => false,
  }
  let threshold: number | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(nativeSource) === 'IS_ANIMATING_TOUCH_START_THRESHOLD_MS') {
      threshold = Number(node.initializer!.getText(nativeSource))
    }
    ts.forEachChild(node, visit)
  }
  visit(nativeSource)
  assert.ok(threshold && Number.isFinite(threshold))
  const bindings = { global: { performance: { now: () => now } }, IS_ANIMATING_TOUCH_START_THRESHOLD_MS: threshold,
    TextInputState: { isTextInput: () => false } }
  owner._isAnimating = nativeMethod('_isAnimating', owner, bindings)
  const capture = nativeMethod('_handleStartShouldSetResponderCapture', owner, bindings)
  return { owner, threshold, at: (time: number) => { now = time; return capture({ target: {} }) } }
}

function scrollProps(file: string, marker: string) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const props: Record<string, unknown>[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && /(?:ScrollView|FlatList)$/.test(node.tagName.getText(source)) && node.getText(source).includes(marker)) {
      const attribute = node.attributes.properties.find((prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop)
        && prop.name.getText(source) === 'keyboardShouldPersistTaps')
      props.push({ keyboardShouldPersistTaps: attribute?.initializer && ts.isStringLiteral(attribute.initializer)
        ? attribute.initializer.text : undefined })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(props.length, `${file}: ${marker}`)
  return props
}

for (const [file, marker, label] of [
  ['src/screens/GadgetLibraryScreen.tsx', 'ref={fallbackScrollRef}', '機材の読み込み中・取得失敗・登録0件'],
  ['src/screens/GadgetLibraryScreen.tsx', 'styles.trashScroll', '最近削除した機材'],
  ['src/screens/AddGadgetScreen.tsx', 'maxHeight: 280', '追加した機材のデスク選択'],
  ['src/screens/TemplateDetailScreen.tsx', 'styles.ownedPickerList', '構成に使う登録済み機材の選択'],
  ['src/screens/DeskFeedScreen.tsx', 'styles.filterBody', 'デスク検索の絞り込み'],
  ['src/screens/WiringResultScreen.tsx', 'styles.photoStripContent', 'プロフィール編集中の写真操作'],
]) {
  test(`${label}はキーボード表示中もボタンへの最初のタップを奪わない`, () => {
    for (const props of scrollProps(file, marker)) {
      const h = responder(props)
      h.owner._keyboardIsDismissible = () => true
      assert.equal(h.at(300), false, '実際のScrollViewのcapture判定で子ボタンへ通す')
    }
  })
}

test('RN標準の一覧は慣性終了直後の16ms未満を停止操作として捕捉し、それ以降はタップを通す', () => {
  const h = responder({ keyboardShouldPersistTaps: 'handled' })
  assert.equal(h.threshold, 16)
  assert.equal(h.at(200), true)
  assert.equal(h.at(215.9), true)
  assert.equal(h.at(216), false)
  assert.equal(h.at(300), false)
  h.owner._lastMomentumScrollBeginTime = 400
  assert.equal(h.at(800), true, '慣性が続いている間は停止操作になる')
  h.owner._lastMomentumScrollEndTime = 800
  assert.equal(h.at(816), false)
})

test('キーボードのタップ設定やpan responderの無効化では、RNの慣性停止判定を回避できない', () => {
  for (const keyboardShouldPersistTaps of ['handled', 'always']) for (const disableScrollViewPanResponder of [false, true]) {
    const h = responder({ keyboardShouldPersistTaps, disableScrollViewPanResponder })
    assert.equal(h.at(201), true)
    assert.equal(h.at(216), false)
  }
})

test('長押しした行からスクロールへ移っても、新しいタップは長押しの抑止を引き継がない', () => {
  const module = { exports: {} as any }
  runInNewContext(ts.transpileModule(readFileSync('src/hooks/useLongPressGuard.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module, exports: module.exports, require: (name: string) => name === 'react'
    ? { useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn }
    : { hapticMedium: () => {} } })
  let presses = 0
  const guard = module.exports.useLongPressGuard(() => { presses++ }, () => {})
  guard.beginPress(); guard.onLongPress({})
  guard.beginPress(); guard.onPress({})
  assert.equal(presses, 1)
  guard.beginPress(); guard.onLongPress({}); guard.onPress({})
  assert.equal(presses, 1, '同じ長押しの指離しだけを抑止する')
})
