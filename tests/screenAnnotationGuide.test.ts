import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as layout from '../src/utils/guideAnnotationLayout'
import { UI_METRICS } from '../src/constants/ui'
import { coachGuideText, guideLabelHeight } from '../src/utils/coachGuideText'

function guide(count = 8) {
  const file = 'src/components/organisms/ScreenAnnotationGuide.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'ScreenAnnotationGuide')!
  const styles = source.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations[0].name.getText(source) === 'styles')!
  const code = ts.transpileModule(`${styles.getText(source)};\n(${declaration.getText(source).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const values: any[] = []
  let cursor = 0
  let closed = 0
  const jsx = (type: unknown, props: any) => ({ type, props })
  const render = runInNewContext(code, {
    ...layout, coachGuideText, guideLabelHeight, AppIcon: 'AppIcon', UI_METRICS, GAP: 12, BADGE: 8, Fragment: 'Fragment',
    StyleSheet: { create: (value: unknown) => value, absoluteFill: { position: 'absolute' }, hairlineWidth: 1 },
    require: () => ({ jsx, jsxs: jsx }), exports: {},
    useApp: () => ({ colors: {}, lang: 'ja' }),
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
    useMemo: (create: () => unknown) => create(),
    useState: (initial: unknown) => {
      const index = cursor++
      if (!(index in values)) values[index] = initial
      return [values[index], (next: any) => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
    },
    PanResponder: { create: (handlers: unknown) => ({ panHandlers: handlers }) },
    View: 'View', Text: 'Text', Modal: 'Modal', Image: 'Image', Svg: 'Svg', ScrollView: 'ScrollView',
    Circle: 'Circle', Path: 'Path', Rect: 'Rect', SvgText: 'SvgText', Button: 'Button', IconCircleButton: 'IconCircleButton',
    ICONS: { close: 'close', chevronLeft: 'left', chevronRight: 'right' },
  }) as (props: any) => any
  const steps = Array.from({ length: count }, (_, index) => ({ ja: `説明${index}`, en: `Guide ${index}`, rect: null }))
  const paint = () => {
    cursor = 0
    return render({ steps, shot: { uri: null, width: 390, height: 844 }, onClose: () => { closed++ } })
  }
  return { paint, closed: () => closed }
}

function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  return value?.props ? [value, ...nodes(value.props.children)] : []
}
const button = (tree: any, label: string) => nodes(tree).find(node => node.props.accessibilityLabel === label)!
const page = (tree: any) => nodes(tree).find(node => node.props.accessibilityLiveRegion === 'polite')!.props.children.join('')
const swipe = (tree: any) => nodes(tree).find(node => node.props.onMoveShouldSetPanResponder)!.props
const dismiss = (tree: any) => tree.props.children.props
const down = { x0: 100, y0: 70, dx: 0, dy: 70, vy: 0.2, numberActiveTouches: 1 }
const captureDismiss = (handlers: any, gesture: typeof down) => {
  const touches = Array.from({ length: gesture.numberActiveTouches }, () => ({ pageX: gesture.x0, pageY: gesture.y0 }))
  assert.equal(handlers.onStartShouldSetPanResponderCapture({ nativeEvent: { touches } }), false)
  return handlers.onMoveShouldSetPanResponderCapture(null, { ...gesture, x0: 0, y0: 0 })
}
const captureSwipe = (handlers: any, dx: number, dy = 0, x = 195, y = 780) => {
  assert.equal(handlers.onStartShouldSetPanResponderCapture({ nativeEvent: { touches: [{ pageX: x, pageY: y }] } }), false)
  return handlers.onMoveShouldSetPanResponderCapture(null, { dx, dy, numberActiveTouches: 1 })
}
const releaseSwipe = (handlers: any, dx: number, dy = 0, vx = 0.2) => {
  const captured = captureSwipe(handlers, dx, dy)
  if (captured) handlers.onPanResponderRelease(null, { dx: 0, dy: 0, vx, numberActiveTouches: 0 })
  return captured
}

test('見出しと余白から下スワイプで閉じ、左右・上方向・短い移動・複数指では閉じない', () => {
  for (const count of [0, 1, 8]) {
    const state = guide(count)
    const handlers = dismiss(state.paint())
    for (const gesture of [
      { ...down, dy: -80 },
      { ...down, dy: 4 }, { ...down, numberActiveTouches: 2 },
    ]) assert.equal(captureDismiss(handlers, gesture), false)
    assert.equal(captureDismiss(handlers, { ...down, dx: 80, dy: 20 }), count === 8)
    assert.equal(state.closed(), 0)
    assert.equal(captureDismiss(handlers, down), true)
    handlers.onPanResponderRelease(null, { ...down, dx: 0, dy: 0, numberActiveTouches: 0 })
    assert.equal(state.closed(), 1)
    assert.equal(page(state.paint()), count === 8 ? '1 / 3' : '1 / 1')
  }
  const state = guide()
  const handlers = dismiss(state.paint())
  const margin = { ...down, x0: 15, y0: 200, dy: 30 }
  assert.equal(captureDismiss(handlers, margin), true)
  handlers.onPanResponderRelease(null, { ...margin, dx: 0, dy: 0, vy: 0.8, numberActiveTouches: 0 })
  assert.equal(state.closed(), 1)
})

test('説明カード・写し・各ボタンからの縦移動を奪わず、キャンセルや指のぶれでは閉じない', () => {
  const state = guide()
  const tree = state.paint()
  const handlers = dismiss(tree)
  const regions = nodes(tree).flatMap(node => {
    const styles = Array.isArray(node.props.style) ? node.props.style : []
    return styles.filter((style: any) => style?.left !== undefined && style?.width !== undefined && style?.height !== undefined)
  })
  for (const region of regions) assert.equal(captureDismiss(handlers, {
    ...down, x0: region.left + region.width / 2, y0: region.top + region.height / 2,
  }), false)
  for (const [x0, y0] of [[350, 70], [370, 422], [180, 780]]) {
    assert.equal(captureDismiss(handlers, { ...down, x0, y0 }), false)
  }
  // 1ページ目には前へ戻る矢印が無いので、その場所はただの余白として閉じられる
  assert.equal(captureDismiss(handlers, { ...down, x0: 20, y0: 422 }), true)
  handlers.onPanResponderTerminate()
  assert.equal(captureDismiss(handlers, { ...down, dy: 20 }), true)
  handlers.onPanResponderRelease(null, { ...down, dy: 0, vy: 0 })
  assert.equal(state.closed(), 0)
  assert.equal(captureDismiss(handlers, down), true)
  handlers.onPanResponderTerminate()
  handlers.onPanResponderRelease(null, { ...down, dy: 0, vy: 0 })
  assert.equal(state.closed(), 0)
  assert.equal(captureDismiss(handlers, down), true)
  handlers.onPanResponderStart(null, { numberActiveTouches: 2 })
  handlers.onPanResponderRelease(null, { ...down, dy: 80, numberActiveTouches: 0 })
  assert.equal(state.closed(), 0)
})

test('ガイドの矢印とスワイプは同じページを切り替え、最初と最後を越えない', () => {
  const state = guide()
  let tree = state.paint()
  assert.equal(page(tree), '1 / 3')
  // 行き先の無い側の矢印は薄くせず出さない
  assert.equal(button(tree, '前のページ'), undefined)
  button(tree, '次のページ').props.onPress()
  tree = state.paint()
  assert.equal(page(tree), '2 / 3')
  assert.equal(releaseSwipe(swipe(tree), -80, 5), true)
  tree = state.paint()
  assert.equal(page(tree), '3 / 3')
  assert.equal(button(tree, '次のページ'), undefined)
  releaseSwipe(swipe(tree), -80, 0, -1)
  assert.equal(page(state.paint()), '3 / 3')
  assert.equal(state.closed(), 0)
  releaseSwipe(swipe(tree), 22, 0, 0.8)
  tree = state.paint()
  assert.equal(page(tree), '2 / 3')
  button(tree, '前のページ').props.onPress()
  tree = state.paint()
  releaseSwipe(swipe(tree), 80, 0, 1)
  assert.equal(page(state.paint()), '1 / 3')
})

test('縦移動や短い指のぶれでページを変えず、1ページではスワイプを奪わない', () => {
  const state = guide()
  const handlers = swipe(state.paint())
  assert.equal(captureSwipe(handlers, 1), false)
  assert.equal(captureSwipe(handlers, 20, 50), false)
  assert.equal(captureSwipe(handlers, 3, -50), false)
  assert.equal(captureSwipe(handlers, -30, 3), true)
  handlers.onPanResponderRelease(null, { dx: -50, dy: 100, vx: -1, numberActiveTouches: 0 })
  releaseSwipe(handlers, -18, 0, -0.1)
  assert.equal(page(state.paint()), '1 / 3')
  assert.equal(captureSwipe(swipe(guide(1).paint()), -80), false)
})

test('素早いスワイプの取得前の移動を含め、キャンセル後は移動量を持ち越さない', () => {
  const state = guide()
  const handlers = swipe(state.paint())
  assert.equal(captureSwipe(handlers, -90, 2), true)
  handlers.onPanResponderRelease(null, { dx: 0, dy: 0, vx: 0 })
  assert.equal(page(state.paint()), '2 / 3')
  assert.equal(captureSwipe(handlers, 80), true)
  handlers.onPanResponderTerminate()
  handlers.onPanResponderRelease(null, { dx: 0, dy: 0, vx: 0 })
  assert.equal(page(state.paint()), '2 / 3')
})

test('見出し・説明・下部のスワイプ案内を含む同じ親で左右移動を受ける', () => {
  const state = guide()
  for (const [x, y] of [[100, 70], [195, 350], [195, 780]]) {
    const tree = state.paint()
    const handlers = swipe(tree)
    assert.equal(handlers, tree.props.children.props)
    assert.equal(captureSwipe(handlers, -80, 0, x, y), true)
    handlers.onPanResponderRelease(null, { dx: 0, dy: 0, vx: 0, numberActiveTouches: 0 })
    assert.equal(page(state.paint()), '2 / 3')
    releaseSwipe(swipe(state.paint()), 80)
    assert.equal(page(state.paint()), '1 / 3')
    assert.equal(state.closed(), 0)
  }
})

test('複数指の横移動や中断ではページを変えず、次の通常スワイプは動く', () => {
  const state = guide()
  const handlers = swipe(state.paint())
  assert.equal(captureSwipe(handlers, -80), true)
  handlers.onPanResponderStart(null, { numberActiveTouches: 2 })
  handlers.onPanResponderRelease(null, { dx: -80, dy: 0, vx: -1, numberActiveTouches: 0 })
  assert.equal(page(state.paint()), '1 / 3')
  assert.equal(captureSwipe(handlers, -80), true)
  handlers.onPanResponderTerminate()
  handlers.onPanResponderRelease(null, { dx: -80, dy: 0, vx: -1, numberActiveTouches: 0 })
  assert.equal(page(state.paint()), '1 / 3')
  releaseSwipe(swipe(state.paint()), -80)
  assert.equal(page(state.paint()), '2 / 3')
})

test('×は描画領域の手前にあり、途中のページでもタップで閉じられる', () => {
  const state = guide()
  let tree = state.paint()
  button(tree, '次のページ').props.onPress()
  tree = state.paint()
  const root = tree.props.children
  const content = root.props.children[0]
  const header = root.props.children[1]
  assert.equal(header.props.onMoveShouldSetPanResponder, undefined)
  assert.equal(header.props.style[0].zIndex, 2)
  const svg = nodes(content).find(node => node.type === 'Svg')!
  assert.ok(nodes(content).some(node => node.props.pointerEvents === 'none' && node.props.children === svg))
  button(tree, 'ガイドを閉じる').props.onPress()
  assert.equal(state.closed(), 1)
  tree.props.onRequestClose()
  assert.equal(state.closed(), 2)
})

test('最後のページの下部ボタンと、案内が0件の場合の×で閉じられる', () => {
  const state = guide()
  button(state.paint(), '次のページ').props.onPress()
  button(state.paint(), '次のページ').props.onPress()
  const close = nodes(state.paint()).find(node => node.type === 'Button' && node.props.title === '閉じる')!
  close.props.onPress()
  assert.equal(state.closed(), 1)
  const empty = guide(0)
  assert.equal(page(empty.paint()), '1 / 1')
  assert.equal(nodes(empty.paint()).filter(node => ['前のページ', '次のページ'].includes(node.props.accessibilityLabel)).length, 0)
  button(empty.paint(), 'ガイドを閉じる').props.onPress()
  assert.equal(empty.closed(), 1)
})

test('説明文は縦にスクロールさせず、見出しにアイコンを出さない', () => {
  const tree = guide().paint()
  assert.equal(nodes(tree).some(node => node.type === 'ScrollView'), false)
  assert.equal(nodes(tree).some(node => node.type === 'AppIcon'), false)
})
