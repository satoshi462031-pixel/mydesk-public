import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { OPENING_DURATION_MS, OPENING_LOGO_HOLD_MS } from '../src/constants/opening'
import { OPENING_WIRING_JSON } from '../src/constants/onboardingWiring.generated'
import type { MapLayout } from '../src/utils/connectionMapLayout'
import { brighten, buildOpeningScene } from '../src/utils/openingScene'

test('オープニングは枠なしの6種類で、指定の曲がり数を保ち、線が機器を横切らない', () => {
  const layout = JSON.parse(OPENING_WIRING_JSON) as {
    nodes: MapLayout['nodes']
    edges: { fromId: string; toId: string; conn: MapLayout['edges'][number]['conn']; points: { x: number; y: number }[] }[]
  }
  assert.equal('regions' in layout, false)
  assert.equal(layout.nodes.filter(n => !n.isWall).length, 6)
  assert.ok(layout.nodes.every(n => n.gadget.category !== 'Charger'))
  const headphone = layout.nodes.find(n => n.id === 'opening-headphone')!
  const pc = layout.nodes.find(n => n.id === 'opening-pc')!
  assert.ok(headphone.x > pc.x + pc.w)
  assert.ok(headphone.cy > pc.cy)
  const audio = layout.edges.find(e => e.toId === headphone.id)!
  assert.equal(audio.fromId, pc.id)
  assert.equal(audio.conn.cableType, 'Audio3_5mm')
  assert.equal(layout.edges.filter(e => e.toId === headphone.id).length, 1)
  const mouse = layout.nodes.find(n => n.id === 'opening-mouse')!
  const keyboard = layout.nodes.find(n => n.id === 'opening-keyboard')!
  assert.ok(mouse.x > keyboard.x + keyboard.w)
  assert.equal(mouse.y, keyboard.y)
  const mouseCable = layout.edges.find(e => e.toId === mouse.id)!
  assert.equal(mouseCable.fromId, pc.id)
  assert.equal(mouseCable.conn.cableType, 'USB_A')
  const turns = (from: string, to: string) => {
    const e = layout.edges.find(e => e.fromId === `opening-${from}` && e.toId === `opening-${to}`)!
    assert.ok(e)
    return e.points.slice(1, -1).filter((p, i) => {
      const before = e.points[i], after = e.points[i + 2]
      return (p.x === before.x) !== (after.x === p.x)
    }).length
  }
  assert.equal(turns('strip', 'monitor'), 2)
  assert.equal(turns('pc', 'headphone'), 0)
  assert.equal(turns('pc', 'mouse'), 1)
  assert.equal(turns('pc', 'monitor'), 2)
  for (const e of layout.edges) {
    for (const id of [e.fromId, e.toId]) {
      const n = layout.nodes.find(n => n.id === id)!
      const p = id === e.fromId ? e.points[0] : e.points.at(-1)!
      assert.ok((p.x === n.x || p.x === n.x + n.w) && p.y >= n.y && p.y <= n.y + n.h
        || (p.y === n.y || p.y === n.y + n.h) && p.x >= n.x && p.x <= n.x + n.w, `${id} に線が接続していない`)
    }
    e.points.slice(1).forEach((p, i) => {
      const q = e.points[i]
      assert.ok((p.x === q.x) !== (p.y === q.y), '線は長さのある水平・垂直区間で描く')
      for (const n of layout.nodes.filter(n => n.id !== e.fromId && n.id !== e.toId)) {
        const intersects = p.x === q.x
          ? p.x > n.x && p.x < n.x + n.w && Math.max(p.y, q.y) > n.y && Math.min(p.y, q.y) < n.y + n.h
          : p.y > n.y && p.y < n.y + n.h && Math.max(p.x, q.x) > n.x && Math.min(p.x, q.x) < n.x + n.w
        assert.equal(intersects, false, `${e.fromId} → ${e.toId} が ${n.id} を横切っている`)
      }
    })
  }
  const segments = layout.edges.flatMap(e => e.points.slice(1).map((p, i) => ({ e, a: e.points[i], b: p })))
  for (let i = 0; i < segments.length; i++) {
    for (const other of segments.slice(i + 1)) {
      const current = segments[i]
      if (current.e === other.e) continue
      const h = current.a.y === current.b.y ? current : other
      const v = h === current ? other : current
      if (h.a.y !== h.b.y || v.a.x !== v.b.x) continue
      const crosses = v.a.x > Math.min(h.a.x, h.b.x) && v.a.x < Math.max(h.a.x, h.b.x)
        && h.a.y > Math.min(v.a.y, v.b.y) && h.a.y < Math.max(v.a.y, v.b.y)
      assert.equal(crosses, false, `${h.e.conn.cableType} と ${v.e.conn.cableType} が交差している`)
    }
  }
})


function harness(reduceMotion = false) {
  const raw = JSON.parse(OPENING_WIRING_JSON)
  const byId = new Map<string, MapLayout['nodes'][number]>(raw.nodes.map((node: MapLayout['nodes'][number]) => [node.id, node]))
  const layout: MapLayout = {
    ...raw,
    edges: raw.edges.map((edge: { fromId: string; toId: string }) => ({
      ...edge, from: byId.get(edge.fromId)!, to: byId.get(edge.toId)!,
    })),
  }
  const slots: any[] = []
  let cursor = 0
  const queued: (() => void)[] = []
  const timers = new Map<number, { run: () => void; ms: number }>()
  let nextTimer = 0
  let completions = 0
  let animationComplete: ((result: { finished: boolean }) => void) | undefined
  let starts = 0
  let stops = 0
  const timings: { duration: number; useNativeDriver: boolean }[] = []
  const nativeValues: Value[] = []
  const react = {
    useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
    useRef: (current: unknown) => { const index = cursor++; return slots[index] ??= { current } },
    useCallback: (run: unknown) => { const index = cursor++; return slots[index] ??= run },
    useEffect: (run: () => any, deps: any[]) => {
      const index = cursor++
      const previous = slots[index]
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
      slots[index] = { deps }
      queued.push(() => { previous?.cleanup?.(); slots[index].cleanup = run() })
    },
  }
  class Value {
    readonly interpolations: any[] = []
    constructor(public current: number) {}
    setValue(value: number) { this.current = value }
    interpolate(config: any) { this.interpolations.push(config); return { config } }
  }
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync('src/components/molecules/OnboardingIntro.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports,
    setTimeout: (run: () => void, ms: number) => { const id = ++nextTimer; timers.set(id, { run, ms }); return id },
    clearTimeout: (id: number) => timers.delete(id),
    require: (id: string) => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return { jsx: (type: unknown, props: any) => ({ type, props }), jsxs: (type: unknown, props: any) => ({ type, props }) }
      if (id === 'react-native') return {
        View: 'View', Image: 'Image', Text: 'Text', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: (styles: any) => styles },
        Easing: { linear: (value: number) => value, bezier: () => (value: number) => value },
        Animated: {
          Value, View: 'AnimatedView', createAnimatedComponent: () => 'AnimatedPath',
          timing: (value: Value, config: typeof timings[number]) => {
            timings.push(config)
            if (config.useNativeDriver) nativeValues.push(value)
            return {}
          },
          parallel: () => ({ start: (callback: typeof animationComplete) => { starts++; animationComplete = callback }, stop: () => { stops++; animationComplete?.({ finished: false }) } }),
        },
      }
      if (id === 'react-native-svg') return { default: 'Svg', Path: 'Path' }
      if (id.endsWith('/icons')) return { categoryIconColor: () => '#FFFFFF', themeIconColor: () => '#FFFFFF' }
      if (id.endsWith('/portTypes')) return { portColor: () => '#FFFFFF' }
      if (id.endsWith('/onboardingWiring')) return { getOpeningWiringLayout: () => layout }
      if (id.endsWith('/openingScene')) return { brighten, buildOpeningScene }
      if (id.endsWith('/opening')) return { OPENING_DURATION_MS, OPENING_LOGO_HOLD_MS }
      if (id.endsWith('/AppIcon')) return { AppIcon: 'AppIcon' }
      if (id.endsWith('/AppContext')) return { useApp: () => ({ colors: {}, isDark: false, lang: 'ja', reduceMotion }) }
      if (id.endsWith('/CategoryIcon')) return { CategoryIcon: 'Icon' }
      if (id.endsWith('.png')) return 'app-icon'
      throw new Error(id)
    },
  })
  const render = () => {
    cursor = 0
    const tree = module.exports.OnboardingIntro({ onComplete: () => { completions++ } })
    queued.splice(0).forEach(run => run())
    return tree
  }
  const tree = render()
  tree.props.onLayout?.({ nativeEvent: { layout: { width: 390, height: 844 } } })
  render()
  return {
    timers, timings, render,
    reduceMotion: (value: boolean) => { reduceMotion = value },
    nativeInterpolationConfigs: () => nativeValues.flatMap(value => value.interpolations),
    get completions() { return completions }, get starts() { return starts }, get stops() { return stops },
    finishAnimation: () => animationComplete?.({ finished: true }),
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  }
}

test('選択した尺で配線を完成させ、図が消えてからアプリアイコンを表示する', () => {
  const h = harness()
  const tree = h.render()
  const [diagram, logo] = tree.props.children[0].props.children
  const diagramStyle = diagram.props.style[1]
  const logoStyle = logo.props.style[1]
  const wires = diagram.props.children[0].props.children
  const nodes = diagram.props.children[1]
  const duration = h.timings[0].duration
  assert.ok(h.timings.every(timing => timing.duration === duration))
  assert.deepEqual(h.timings.map(timing => timing.useNativeDriver), [true, false])
  assert.equal(diagramStyle.opacity.config.outputRange[0], 0)
  assert.equal(logoStyle.opacity.config.outputRange[0], 0)
  for (const node of nodes) assert.equal(node.props.style[1].opacity.config.outputRange[0], 0)

  const wiringEnd = Math.max(...wires.map((wire: any) => wire.props.strokeDashoffset.config.inputRange.at(-1)))
  const shrinkStart = diagramStyle.transform[0].scale.config.inputRange[1]
  const logoStart = logoStyle.opacity.config.inputRange[0]
  assert.equal(duration, 3000)
  assert.ok(wiringEnd > 0 && wiringEnd < logoStart)
  assert.ok(wiringEnd < shrinkStart, '配線が完成してから縮小する')
  assert.ok(nodes.every((node: any) => node.props.style[1].opacity.config.inputRange.at(-1) <= shrinkStart))
  assert.ok(diagramStyle.opacity.config.inputRange.at(-1) <= logoStart, '図とアプリアイコンを同時に表示しない')
  assert.ok(logoStyle.transform[0].scale.config.inputRange.at(-1) < tree.props.style[1].opacity.config.inputRange[1], 'アイコンを表示してから本編へ移る')
  h.unmount()
})

test('起動演出のネイティブ補間には対応していない easing を渡さない', () => {
  const h = harness()
  const configs = h.nativeInterpolationConfigs()
  assert.ok(configs.length > 0)
  for (const config of configs) {
    assert.equal('easing' in config, false, 'ネイティブ補間に easing を渡すと実機で Console Error が出る')
  }
  h.unmount()
})

test('スキップ・演出終了・待機の打ち切りが重なっても初回案内への切り替えは一度だけ', () => {
  const h = harness()
  assert.equal(h.starts, 1)
  const buttons = (node: any): any[] => !node || typeof node !== 'object' ? []
    : Array.isArray(node) ? node.flatMap(buttons)
    : [...(node.props?.onPress ? [node] : []), ...buttons(node.props?.children)]
  const skip = buttons(h.render())
  assert.equal(skip.length, 1)
  assert.equal(skip[0].props.children.props.children, 'スキップ')
  skip[0].props.onPress()
  h.finishAnimation()
  ;[...h.timers.values()][0].run()
  assert.equal(h.completions, 1)
  h.unmount()
  assert.equal(h.timers.size, 0)
  assert.equal(h.stops, 1)
})

test('演出は3秒に固定し、待機の打ち切りもその長さに合わせる', () => {
  assert.equal(OPENING_DURATION_MS, 3000)
  const h = harness()
  assert.ok(h.timings.every(timing => timing.duration === OPENING_DURATION_MS))
  assert.ok([...h.timers.values()][0].ms > OPENING_DURATION_MS)
  h.unmount()
})

test('コンセントが出きってから、配線を始めるまで0.35秒以上コンセントだけを見せる', () => {
  const h = harness()
  const tree = h.render()
  const [diagram] = tree.props.children[0].props.children
  const wires = diagram.props.children[0].props.children
  const nodes = diagram.props.children[1]
  const outlet = nodes.find((node: any) => node.props.children.type === 'AppIcon')
  const shown = Math.max(outlet.props.style[1].opacity.config.inputRange.at(-1), outlet.props.style[1].transform[0].scale.config.inputRange.at(-1))
  const firstWire = Math.min(...wires.map((wire: any) => wire.props.opacity.config.inputRange[0]))
  const others = nodes.filter((node: any) => node !== outlet).map((node: any) => node.props.style[1].opacity.config.inputRange[0])
  assert.ok((firstWire - shown) * OPENING_DURATION_MS >= 350, `${Math.round((firstWire - shown) * OPENING_DURATION_MS)}ms`)
  assert.ok(others.every((start: number) => start >= firstWire), 'コンセントだけの間に他の機材が出ている')
  h.unmount()
})

test('最後のアイコンを完全表示してから1秒保持する', () => {
  {
    const ms = OPENING_DURATION_MS
    const h = harness()
    const tree = h.render()
    const [diagram, logo] = tree.props.children[0].props.children
    const fadeStart = tree.props.style[1].opacity.config.inputRange[1]
    const [logoStart, logoReady] = logo.props.style[1].opacity.config.inputRange
    const scaleReady = logo.props.style[1].transform[0].scale.config.inputRange.at(-1)
    assert.ok(Math.abs((fadeStart - Math.max(logoReady, scaleReady)) * ms - 1000) < 0.001)
    assert.ok(Math.abs((logoReady - logoStart) * ms - 200) < 0.001)
    assert.ok(Math.abs((1 - fadeStart) * ms - 150) < 0.001)
    assert.ok(diagram.props.style[1].opacity.config.inputRange.at(-1) <= logoStart)
    assert.ok(h.timings.every(timing => timing.duration === ms))
    h.unmount()
  }
})

test('描画サイズの同じ再通知では演出を再起動せず、終了を遅らせない', () => {
  const h = harness()
  const tree = h.render()
  tree.props.onLayout({ nativeEvent: { layout: { width: 390, height: 844 } } })
  h.render()
  assert.equal(h.starts, 1)
  h.unmount()
})

test('アニメーション完了通知が来なくても待機を打ち切って案内へ進む', () => {
  const h = harness()
  const timer = [...h.timers.values()][0]
  assert.ok(timer.ms < 10_000)
  timer.run()
  h.finishAnimation()
  assert.equal(h.completions, 1)
  h.unmount()
})

test('動きを減らす設定では、サイズの計測や演出を待たずに進む', () => {
  {
    const h = harness(true)
    assert.equal(h.starts, 0)
    assert.equal(h.timings.length, 0)
    assert.equal(h.timers.size, 0)
    assert.equal(h.completions, 1)
    h.render()
    assert.equal(h.completions, 1)
    h.unmount()
  }
})

test('起動演出の途中で動きを減らすと直ちに停止し、遅い完了通知でも二重に進まない', () => {
  const h = harness()
  h.reduceMotion(true)
  h.render()
  assert.equal(h.stops, 1)
  assert.equal(h.timers.size, 0)
  assert.equal(h.completions, 1)
  h.finishAnimation()
  assert.equal(h.completions, 1)
  h.unmount()
})

test('画面を閉じたときは演出とタイマーを停止し、案内の切り替えを起こさない', () => {
  const h = harness()
  h.unmount()
  assert.equal(h.stops, 1)
  assert.equal(h.timers.size, 0)
  assert.equal(h.completions, 0)
})

test('演出中は開始ボタンを操作できず、終了後に登録や同意を勝手に実行せず案内を開く', () => {
  const slots: any[] = []
  let cursor = 0
  let sideEffects = 0
  const react = {
    useRef: (current: unknown) => { const index = cursor++; return slots[index] ??= { current } },
    useState: (initial: unknown) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: any) => { slots[index] = value }] },
    useEffect: (run: () => void) => { const index = cursor++; if (!slots[index]) { slots[index] = true; run() } },
  }
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync('src/screens/OnboardingScreen.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports,
    require: (id: string) => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return { jsx: (type: unknown, props: any) => ({ type, props }), jsxs: (type: unknown, props: any) => ({ type, props }) }
      if (id === 'react-native') return { View: 'View', Image: 'Image', Text: 'Text', TouchableOpacity: 'TouchableOpacity', SafeAreaView: 'SafeAreaView', StyleSheet: { create: (styles: any) => styles }, Alert: {} }
      if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' }
      if (id.endsWith('/AppContext')) return { useApp: () => ({ colors: {}, lang: 'ja' }) }
      if (id.endsWith('/AuthContext')) return { useAuth: () => ({ skipAuth: () => { sideEffects++ } }) }
      if (id.endsWith('/analytics')) return { analytics: { track: () => {} }, EVENTS: {}, hasAnalyticsChoice: async () => false, setAnalyticsConsent: () => { sideEffects++ } }
      if (id.endsWith('/planStore')) return { markOnboardingDone: () => { sideEffects++ } }
      if (id.endsWith('/ui')) return { UI_METRICS: {} }
      if (id.endsWith('/icons')) return { ICONS: { history: 'history' } }
      if (id.endsWith('/networkError')) return {}
      if (id.endsWith('.png')) return 'icon'
      const name = id.split('/').at(-1)!
      return { [name]: name }
    },
  })
  const render = (introFinished: boolean) => { cursor = 0; return module.exports.OnboardingScreen({ navigation: { replace: () => { sideEffects++ } }, introFinished }) }
  const buttons = (node: any): any[] => {
    if (Array.isArray(node)) return node.flatMap(buttons)
    if (!node?.props) return []
    return [...(node.type === 'Button' || node.type === 'TouchableOpacity' ? [node] : []), ...buttons(node.props.children)]
  }
  const first = render(false)
  const welcome = first.props.children[0]
  assert.equal(welcome.props.pointerEvents, 'none')
  assert.equal(welcome.props.importantForAccessibility, 'no-hide-descendants')
  assert.equal(welcome.props['aria-hidden'], true)
  assert.equal(buttons(welcome).length, 4)
  for (const button of buttons(welcome)) assert.equal(button.props.disabled, true)
  const second = render(true)
  assert.equal(second.props.children[0].props.pointerEvents, 'auto')
  assert.equal(second.props.children[0].props.accessibilityElementsHidden, false)
  for (const button of buttons(second.props.children[0])) assert.equal(button.props.disabled, false)
  assert.deepEqual(buttons(second.props.children[0]).filter((b: any) => b.type === 'Button').map((b: any) => b.props.title),
    ['自分のデスクを登録する', 'みんなのデスクを見る'])
  assert.equal(second.props.children.some((child: any) => child?.type === 'OnboardingIntro'), false)
  assert.equal(sideEffects, 0)
})

test('初回・通常・ログイン前とも、動きを許可した場合だけオープニングを再生する', () => {
  const file = 'src/navigation/RootNavigator.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'openingVisible') expression = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression)
  const code = ts.transpileModule(expression.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  for (const appState of ['onboarding', 'auth', 'main']) {
    const state = { appState, onboarded: appState !== 'onboarding', splashDone: true, splashOverlayVisible: false, openingFinished: false, reduceMotion: false }
    assert.equal(runInNewContext(code, state), true)
    assert.equal(runInNewContext(code, { ...state, splashDone: false }), false)
    assert.equal(runInNewContext(code, { ...state, splashOverlayVisible: true }), false)
    assert.equal(runInNewContext(code, { ...state, openingFinished: true }), false)
    assert.equal(runInNewContext(code, { ...state, reduceMotion: true }), false)
  }
})

test('操作可能時間は画面準備・演出・ナビゲーションが揃うまで送らず、1回だけ計測する', () => {
  const file = 'src/navigation/RootNavigator.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let effect: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
      && node.arguments[0]?.getText(source).includes('EVENTS.APP_INTERACTIVE')) effect = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(effect)
  const code = ts.transpileModule(`(${effect.getText(source)})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const events: any[] = []
  const context = {
    splashDone: true, openingFinished: true, splashOverlayVisible: false, navReady: true,
    recoveryFailed: false, accountDataFailed: false, authWaitFailed: false,
    interactiveTrackedRef: { current: false }, bootStartTs: 100, Date: { now: () => 4100 },
    onboarded: true, reduceMotion: true, reduceMotionSystem: false, reduceMotionSetting: true,
    analytics: { track: (event: string, properties: unknown) => events.push({ event, properties }) },
    EVENTS: { APP_INTERACTIVE: 'app_interactive' },
  }
  for (const gate of [
    { splashDone: false }, { openingFinished: false }, { splashOverlayVisible: true }, { navReady: false },
    { recoveryFailed: true }, { accountDataFailed: true }, { authWaitFailed: true },
  ]) runInNewContext(code, { ...context, ...gate })
  assert.equal(events.length, 0)
  runInNewContext(code, context)
  runInNewContext(code, context)
  assert.equal(events.length, 1)
  assert.equal(events[0].properties.interactive_ms, 4000)
  assert.equal(events[0].properties.reduce_motion_setting, true)
  assert.equal(events[0].properties.reduce_motion_system, false)
})
