import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync('src/components/molecules/RemovalMotion.tsx', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function harness(reduceMotion = false) {
  let cursor = 0
  const slots: any[] = []
  const cleanups: (() => void)[] = []
  const sequences: { done?: (result: { finished: boolean }) => void }[] = []
  const react = {
    forwardRef: (fn: unknown) => fn,
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useRef: (initial: unknown) => slots[cursor++] ??= { current: initial },
    useState: (initial: unknown) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (next: unknown) => { slots[index] = next }]
    },
    useEffect: (fn: () => (() => void)) => {
      const index = cursor++
      if (!(index in slots)) { slots[index] = true; cleanups.push(fn()) }
    },
    useImperativeHandle: (ref: any, fn: () => unknown) => { ref.current = fn() },
  }
  class Value {
    constructor(public value: number) {}
    setValue(value: number) { this.value = value }
  }
  const Animated = {
    Value, View: 'AnimatedView',
    timing: () => ({ start: () => {}, stop: () => {} }),
    parallel: (steps: unknown[]) => ({ steps }),
    sequence: () => {
      const sequence: typeof sequences[number] = {}
      sequences.push(sequence)
      return {
        start: (done: typeof sequence.done) => { sequence.done = done },
        stop: () => sequence.done?.({ finished: false }),
      }
    },
  }
  const jsx = (type: unknown, props: any) => ({ type, props })
  const module = { exports: {} as any }
  runInNewContext(source, { module, exports: module.exports, require: (id: string) => {
    if (id === 'react') return react
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (id === 'react-native') return { Animated, Easing: { out: () => {}, inOut: () => {}, cubic: {} } }
    if (id === 'react-native-reanimated') return { default: { View: 'LayoutView' }, LinearTransition: { duration: () => ({}) } }
    return { useApp: () => ({ reduceMotion }) }
  } })
  return {
    api: module.exports,
    paint: <T,>(fn: () => T): T => { cursor = 0; return fn() },
    unmount: () => cleanups.forEach(fn => fn()),
    finish: () => sequences.at(-1)!.done!({ finished: true }),
    sequences,
  }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('退場中の同じ行と重複する一括操作を重ねず、別の行は並行して削除できる', async () => {
  const h = harness()
  const motion = h.api.useRemovalMotion()
  const gate = deferred()
  const calls: string[] = []
  motion.setRef('a', { exit: () => gate.promise, restore: () => {} })
  const first = motion.run('a', () => calls.push('a'))
  await motion.run(['a', 'b'], () => calls.push('duplicate'))
  await motion.run('b', () => calls.push('b'))
  assert.deepEqual(calls, ['b'])
  gate.resolve()
  await first
  assert.deepEqual(calls, ['b', 'a'])
})

test('一括削除は表示中の行を同時に退場させ、全行の退場後に一度だけ保存する', async () => {
  const h = harness()
  const motion = h.api.useRemovalMotion()
  const a = deferred(), b = deferred()
  const started: string[] = []
  for (const [id, gate] of [['a', a], ['b', b]] as const) motion.setRef(id, { exit: () => { started.push(id); return gate.promise }, restore: () => {} })
  let writes = 0
  const pending = motion.run(['a', 'b', 'a', 'hidden'], () => { writes++ }, 'fade')
  assert.deepEqual(started, ['a', 'b'])
  a.resolve()
  await Promise.resolve()
  assert.equal(writes, 0)
  b.resolve()
  await pending
  assert.equal(writes, 1)
})

test('保存失敗とキャンセルでは行を戻し、同じ対象を再試行できる', async () => {
  const motion = harness().api.useRemovalMotion()
  let restored = 0
  motion.setRef('a', { exit: async () => {}, restore: () => { restored++ } })
  await assert.rejects(motion.run('a', () => { throw new Error('storage') }), /storage/)
  assert.equal(restored, 1)
  await motion.run('a', () => false)
  assert.equal(restored, 2)
  await motion.run('a', () => true)
  assert.equal(restored, 2)
})

test('取り消しで同じ行が戻ったときだけ再表示のフェードを一度実行する', async () => {
  const motion = harness().api.useRemovalMotion()
  let entering = 0
  const handle = { exit: async () => {}, restore: () => {}, enter: () => { entering++ } }
  motion.setRef('a', handle)
  assert.equal(entering, 0)
  await motion.run('a', () => {})
  motion.setRef('a', null)
  motion.setRef('a', handle)
  motion.setRef('a', handle)
  assert.equal(entering, 1)
})

test('退場中は行の操作と読み上げを止め、失敗後は両方戻す', async () => {
  const h = harness()
  const ref = { current: null as any }
  const paint = () => h.paint(() => h.api.RemovalMotion({ children: 'row' }, ref))
  let tree = paint()
  tree.props.onLayout({ nativeEvent: { layout: { width: 300, height: 80 } } })
  const exiting = ref.current.exit('left')
  tree = paint()
  assert.equal(tree.props.pointerEvents, 'none')
  assert.equal(tree.props.importantForAccessibility, 'no-hide-descendants')
  h.finish()
  await exiting
  ref.current.restore()
  tree = paint()
  assert.notEqual(tree.props.pointerEvents, 'none')
  assert.notEqual(tree.props.importantForAccessibility, 'no-hide-descendants')
})

test('動きを減らす設定では演出を待たずに更新する', async () => {
  const h = harness(true)
  const ref = { current: null as any }
  const tree = h.paint(() => h.api.RemovalMotion({ children: 'row' }, ref))
  tree.props.onLayout({ nativeEvent: { layout: { width: 300, height: 80 } } })
  await ref.current.exit('left')
  assert.equal(h.sequences.length, 0)
})

test('退場中に画面を離れても、確定済みの操作を待ち続けたり二重に保存したりしない', async () => {
  const h = harness()
  const ref = { current: null as any }
  const tree = h.paint(() => h.api.RemovalMotion({ children: 'row' }, ref))
  tree.props.onLayout({ nativeEvent: { layout: { width: 300, height: 80 } } })
  const motion = h.api.useRemovalMotion()
  motion.setRef('a', ref.current)
  let writes = 0
  const pending = motion.run('a', () => { writes++ })
  h.unmount()
  await pending
  assert.equal(writes, 1)
})

function extract(file: string, name: string, bindings: Record<string, unknown>) {
  const parsed = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === name) found = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.ok(found)
  const code = ts.transpileModule(`(${found.getText(parsed).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const jsx = (type: unknown, props: any) => ({ type, props })
  return runInNewContext(code, { exports: {}, require: () => ({ jsx, jsxs: jsx }), ...bindings }) as (...args: any[]) => any
}

test('利用期間を2件続けて削除しても、同じ描画の値から削除済みの期間を復活させない', () => {
  const pending: (() => void)[] = []
  const render = extract('src/components/molecules/DeskUsageHistoryEditor.tsx', 'DeskUsageHistoryEditor', {
    useRef: (current: unknown) => ({ current }),
    useRemovalMotion: () => ({ run: (_key: string, operation: () => void) => { pending.push(operation) } }),
    ...Object.fromEntries(['View', 'Text', 'TouchableOpacity', 'SegmentedControl', 'DateField', 'AppIcon', 'RemovalMotion'].map(name => [name, name])),
    styles: {}, ICONS: {},
  })
  let periods = [{ mode: 'active', startedAt: '2026/01/01' }, { mode: 'decor', startedAt: '2026/02/01' }]
  const tree = render({ value: periods, onChange: (next: typeof periods) => { periods = next }, colors: {}, lang: 'ja' })
  const nodes = (value: any): any[] => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []
  const buttons = nodes(tree).filter(node => node.props.accessibilityLabel === 'この期間を削除')
  buttons.forEach(button => button.props.onPress())
  assert.equal(periods.length, 2)
  pending.forEach(operation => operation())
  assert.equal(periods.length, 0)
})

test('配線は編集シートを閉じてから退場を待ち、連打でも接続を一度だけ削除する', () => {
  const removingConnections = { current: new Set<string>() }
  const removalOpacities = { current: new Map([['wire', {}]]) }
  let closed = 0, writes = 0
  const callbacks: (() => void)[] = []
  const request = extract('src/components/organisms/ConnectionMap.tsx', 'requestDeleteConn', {
    removingConnections, removalOpacities, reduceMotion: false,
    setEdgeEdit: () => { closed++ }, connectionOpacity: () => ({}), deleteConn: () => { writes++ },
    NativeAnimated: { delay: () => ({}), timing: () => ({}), sequence: () => ({ start: (done: () => void) => { callbacks.push(done) } }) },
  })
  request({ id: 'wire' })
  request({ id: 'wire' })
  assert.equal(closed, 1)
  assert.equal(writes, 0)
  callbacks[0]()
  assert.equal(writes, 1)
  assert.equal(removingConnections.current.size, 0)
  assert.equal(removalOpacities.current.size, 0)
})
