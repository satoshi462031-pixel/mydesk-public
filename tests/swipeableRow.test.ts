import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

class AnimatedNode {
  constructor(readonly read: () => number) {}
  interpolate({ inputRange, outputRange, extrapolate }: { inputRange: number[]; outputRange: number[]; extrapolate?: string }): AnimatedNode {
    return new AnimatedNode(() => {
      let value = this.read()
      if (extrapolate === 'clamp') value = Math.max(inputRange[0], Math.min(inputRange.at(-1)!, value))
      let i = 0
      while (i < inputRange.length - 2 && value > inputRange[i + 1]) i++
      return outputRange[i] + (value - inputRange[i]) / (inputRange[i + 1] - inputRange[i]) * (outputRange[i + 1] - outputRange[i])
    })
  }
}
class Value extends AnimatedNode {
  value: number
  constructor(value: number) { super(() => this.value); this.value = value }
  setValue(value: number) { this.value = value }
}
const read = (value: number | AnimatedNode) => typeof value === 'number' ? value : value.read()

function harness() {
  const springs: any[] = []
  const peeks: { steps: any[]; done?: (result: { finished: boolean }) => void }[] = []
  let stops = 0
  const Animated = {
    Value, View: 'AnimatedView', event: () => () => {},
    add: (a: number | AnimatedNode, b: number | AnimatedNode) => new AnimatedNode(() => read(a) + read(b)),
    multiply: (a: number | AnimatedNode, b: number | AnimatedNode) => new AnimatedNode(() => read(a) * read(b)),
    timing: (value: Value, options: any) => ({ value, options }),
    delay: () => ({}),
    sequence: (steps: any[]) => {
      const peek = { steps, done: undefined as ((result: { finished: boolean }) => void) | undefined }
      return {
        start: (done: (result: { finished: boolean }) => void) => { peek.done = done; peeks.push(peek) },
        stop: () => { stops++; peek.done?.({ finished: false }) },
      }
    },
    spring: (value: Value, options: any) => {
      springs.push({ from: value.value, ...options })
      return { start: (done?: (result: { finished: boolean }) => void) => { value.setValue(options.toValue); done?.({ finished: true }) } }
    },
  }
  class Component {
    state: any
    constructor(readonly props: any) {}
    setState(next: any) { this.state = { ...this.state, ...next } }
  }
  const react = { Component, forwardRef: (render: unknown) => render, useRef: (current: unknown) => ({ current }) }
  const jsx = (type: unknown, props: any) => ({ type, props })
  const native = { Animated, View: 'View', Easing: { inOut: (value: unknown) => value, cubic: 0 }, StyleSheet: { create: (styles: unknown) => styles }, I18nManager: { isRTL: false } }
  const modules: Record<string, any> = { react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native }
  function load(file: string) {
    const exported: any = {}
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
    }).outputText
    runInNewContext(code, { exports: exported, require: (id: string) => {
      if (modules[id]) return modules[id]
      if (id.endsWith('/PanGestureHandler')) return { PanGestureHandler: 'PanGestureHandler' }
      if (id.endsWith('/TapGestureHandler')) return { TapGestureHandler: 'TapGestureHandler' }
      if (id.endsWith('/State')) return { State: { ACTIVE: 4, END: 5 } }
      throw new Error(id)
    } })
    return exported
  }
  const common = load('src/utils/swipeableRow.ts')
  modules['../../utils/swipeableRow'] = common
  const Swipeable = load('node_modules/react-native-gesture-handler/src/components/Swipeable.tsx').default
  modules['react-native-gesture-handler'] = { Swipeable }
  return {
    common, Swipeable, springs, peeks, stops: () => stops,
    finishPeek: () => {
      const peek = peeks.at(-1)!
      peek.steps.forEach((step: any) => step.value?.setValue(step.options.toValue))
      peek.done?.({ finished: true })
    },
    render: load('src/components/molecules/SwipeableRow.tsx').SwipeableRow,
  }
}

test('操作のない側と閉じた位置では、ネイティブの移動処理に頼らずボタンを透明にする', () => {
  const h = harness()
  const progress = new Value(0)
  const row = h.render({ renderRightActions: () => '交換・外す' }, null)
  assert.equal(row.props.renderLeftActions, undefined)
  const action = row.props.renderRightActions(progress, {}, {})
  const opacity = action.props.style[1].opacity
  assert.equal(opacity.read(), 0)
  progress.setValue(-1)
  assert.equal(opacity.read(), 0)
  progress.setValue(0.03)
  assert.equal(opacity.read(), 0)
  progress.setValue(0.2)
  assert.equal(opacity.read(), 1)
  progress.setValue(2)
  assert.equal(opacity.read(), 1)
  assert.equal(action.props.children, '交換・外す')
})

for (const side of ['left', 'right'] as const) {
  test(`${side}: 閉じる一筆が中央を越えても反対側を表示せず、次の操作では開ける`, () => {
    const h = harness()
    const callbacks: string[] = []
    const ref = { current: null }
    const row = h.render({
      renderLeftActions: () => 'お気に入り', renderRightActions: () => '交換・外す',
      onSwipeableCloseStartDrag: (direction: string) => callbacks.push(direction),
      onSwipeableClose: () => callbacks.push('closed'),
      onSwipeableOpenStartDrag: () => callbacks.push('new gesture'),
    }, ref)
    const instance = { state: { rowState: 0 } }
    row.props.ref(instance)
    assert.equal(ref.current, instance)
    const leftProgress = new Value(side === 'left' ? 1 : 0)
    const rightProgress = new Value(side === 'right' ? 1 : 0)
    const leftOpacity = row.props.renderLeftActions(leftProgress, {}, {}).props.style[1].opacity
    const rightOpacity = row.props.renderRightActions(rightProgress, {}, {}).props.style[1].opacity
    const otherOpacity = side === 'left' ? rightOpacity : leftOpacity
    const otherProgress = side === 'left' ? rightProgress : leftProgress
    row.props.onSwipeableCloseStartDrag(side)
    leftProgress.setValue(1)
    rightProgress.setValue(1)
    assert.equal(otherOpacity.read(), 0)
    leftProgress.setValue(0)
    rightProgress.setValue(0)
    row.props.onSwipeableClose(side, {})
    assert.equal(leftOpacity.read(), 0)
    assert.equal(rightOpacity.read(), 0)
    row.props.onSwipeableOpenStartDrag(side === 'left' ? 'right' : 'left')
    otherProgress.setValue(1)
    assert.equal(otherOpacity.read(), 1)
    assert.deepEqual(callbacks, [side, 'closed', 'new gesture'])
  })

  test(`${side}: 実際のSwipeableへ速い閉じ操作を渡しても、閉じる先は中央で速度を持ち越さない`, () => {
    for (const distance of [20, 100, 240]) {
      const h = harness()
      let opened = 0
      let closed = 0
      const props = h.render({ onSwipeableOpen: () => { opened++ }, onSwipeableClose: () => { closed++ } }, null).props
      const row = new h.Swipeable({ ...h.Swipeable.defaultProps, ...props })
      row.state = { ...row.state, leftWidth: 88, rowWidth: 360, rightOffset: 184, rowState: side === 'left' ? 1 : -1 }
      const direction = side === 'left' ? -1 : 1
      row.render().props.onHandlerStateChange({ nativeEvent: { oldState: 4, state: 5, translationX: distance * direction, velocityX: 8000 * direction } })
      assert.equal(h.springs.at(-1).toValue, 0)
      assert.equal(h.springs.at(-1).velocity, 0)
      assert.equal(h.springs.at(-1).overshootClamping, true)
      assert.equal(opened, 0)
      assert.equal(closed, 1)
    }
  })
}

test('手動操作済み・開いている・無効な行では自動案内を始めない', () => {
  for (const kind of ['touched', 'open', 'disabled']) {
    const h = harness()
    const instance = { state: { rowState: kind === 'open' ? 1 : 0, rowTranslation: new Value(0) }, props: { enabled: kind !== 'disabled' }, reset() {} }
    const row = h.render({}, null)
    row.props.ref(instance)
    if (kind === 'touched') row.props.onBegan({})
    assert.equal(h.common.peekSwipeableRow(instance), null)
    assert.equal(h.peeks.length, 0)
  }
})

test('案内の途中で触れたら一度だけ止め、後の後始末でユーザーが開いた行を閉じない', () => {
  const h = harness()
  let resets = 0
  const instance = {
    state: { rowState: 0, rowTranslation: new Value(0) }, props: { enabled: true },
    reset() { resets++; this.state.rowState = 0; this.state.rowTranslation.setValue(0) },
  }
  const row = h.render({}, null)
  row.props.ref(instance)
  const stop = h.common.peekSwipeableRow(instance)
  instance.state.rowTranslation.setValue(30)
  row.props.onBegan({})
  assert.equal(h.stops(), 1)
  assert.equal(resets, 1)
  assert.equal(instance.state.rowTranslation.read(), 0)
  instance.state.rowState = 1
  instance.state.rowTranslation.setValue(88)
  stop()
  assert.equal(instance.state.rowState, 1)
  assert.equal(instance.state.rowTranslation.read(), 88)
  assert.equal(resets, 1)
  assert.equal(h.common.peekSwipeableRow(instance), null)
})

test('案内が完了してから行を開いた場合も、画面離脱の後始末はその行をリセットしない', () => {
  const h = harness()
  let resets = 0
  const instance = { state: { rowState: 0, rowTranslation: new Value(0) }, props: {}, reset() { resets++ } }
  const stop = h.common.peekSwipeableRow(instance)
  assert.equal(h.common.peekSwipeableRow(instance), null)
  h.finishPeek()
  instance.state.rowState = 1
  instance.state.rowTranslation.setValue(88)
  stop()
  assert.equal(resets, 0)
  assert.equal(instance.state.rowTranslation.read(), 88)
})

test('別の行への手動操作でも、実行中の自動案内を中断する', () => {
  const h = harness()
  let resets = 0
  const hinted = { state: { rowState: 0, rowTranslation: new Value(0) }, props: {}, reset() { resets++ } }
  const touched = { state: { rowState: 0, rowTranslation: new Value(0) }, props: {}, reset() {} }
  h.common.peekSwipeableRow(hinted)
  const row = h.render({}, null)
  row.props.ref(touched)
  row.props.onBegan({})
  assert.equal(resets, 1)
  assert.equal(h.stops(), 1)
})
