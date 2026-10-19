import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as steps from '../src/constants/spotlightSteps'
import * as layout from '../src/utils/coachMarkLayout'
import { resolveSpotlightResume } from '../src/utils/spotlightProgress'

function overlay(savedProgress?: string) {
  let cursor = 0
  const slots: any[] = []
  const effects: (() => void)[] = []
  const timers = new Map<number, { run: () => void; delay: number }>()
  let timerId = 0
  let appChange: (state: string) => void = () => {}
  let routeChange = () => {}
  let route = { name: 'PurposeSelection', key: 'purpose-1' }
  let dimensions = { width: 390, height: 844 }
  let insets = { top: 0, bottom: 0, left: 0, right: 0 }
  const targetRects = new Map<string, layout.CoachRect | null>()
  let tour: any
  const storage = new Map<string, string>()
  const events: string[] = []
  let measurements = 0
  const effect = (run: () => unknown, deps: unknown[]) => {
    const index = cursor++
    const previous = slots[index]
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
    const slot = { deps, cleanup: undefined as any }
    slots[index] = slot
    effects.push(() => { previous?.cleanup?.(); slot.cleanup = run() })
  }
  const navigation = {
    getCurrentRoute: () => route,
    addListener: (_event: string, callback: () => void) => { routeChange = callback; return () => { routeChange = () => {} } },
  }
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef: (current: unknown) => { const index = cursor++; return slots[index] ??= { current } },
    useEffect: effect, useLayoutEffect: effect,
    useContext: () => navigation,
    useCallback: (callback: unknown, deps: unknown[]) => {
      const index = cursor++
      const previous = slots[index]
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return previous.callback
      slots[index] = { deps, callback }
      return callback
    },
    useMemo: (make: () => unknown, deps: unknown[]) => {
      const index = cursor++
      const previous = slots[index]
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return previous.value
      const value = make()
      slots[index] = { deps, value }
      return value
    },
  }
  const registry = {
    measureTarget: async (id: string) => {
      measurements++
      if (targetRects.has(id)) return targetRects.get(id)!
      return id === 'setup-footer'
        ? { x: 0, y: dimensions.height - 100, width: dimensions.width, height: 100 }
        : { x: 20, y: 100, width: 300, height: 50 }
    },
    setShown: () => {},
  }
  const jsx = (type: unknown, props: any) => ({ type, props })
  const provider = { exports: {} as any }
  const providerCode = ts.transpileModule(readFileSync('src/context/SpotlightContext.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  runInNewContext(providerCode, { module: provider, exports: provider.exports,
    require: (id: string) => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '@react-native-async-storage/async-storage') return { default: {
        setItem: async (key: string, value: string) => { storage.set(key, value) },
        multiRemove: async (keys: string[]) => { keys.forEach(key => storage.delete(key)) },
      } }
      if (id.endsWith('/spotlightSteps')) return steps
      if (id.endsWith('/coachMarkMeasurement')) return { measureCoachTarget: async () => null }
      if (id.endsWith('/analytics')) return {
        analytics: { track: (event: string) => events.push(event), error: (_name: string, error: unknown) => { throw error } },
        EVENTS: { TUTORIAL_STARTED: 'started', TUTORIAL_STEP_VIEWED: 'viewed', TUTORIAL_COMPLETED: 'completed', TUTORIAL_SKIPPED: 'skipped' },
      }
      throw new Error(`Unexpected dependency: ${id}`)
    },
  })
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync('src/components/organisms/SpotlightOverlay.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  runInNewContext(code, { module, exports: module.exports,
    setTimeout: (run: () => void, delay: number) => { const id = ++timerId; timers.set(id, { run, delay }); return id },
    clearTimeout: (id: number) => { timers.delete(id) },
    require: (id: string) => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
      if (id === '@react-navigation/native') return { NavigationContainerRefContext: {} }
      if (id === 'react-native') return {
        AppState: { addEventListener: (_event: string, callback: typeof appChange) => { appChange = callback; return { remove() { appChange = () => {} } } } },
        InteractionManager: { runAfterInteractions: (run: () => void) => { run(); return { cancel() {} } } },
        StyleSheet: { create: (value: unknown) => value }, View: 'View', useWindowDimensions: () => dimensions,
      }
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => insets }
      if (id === 'react-native-svg') return { default: 'Svg', Defs: 'Defs', Mask: 'Mask', Rect: 'Rect' }
      if (id.endsWith('/TutorialBubble')) return { TutorialBubble: 'TutorialBubble' }
      if (id.endsWith('/AppContext')) return { useApp: () => ({ lang: 'ja', colors: {}, isDark: false }) }
      if (id.endsWith('/SpotlightContext')) return { useSpotlight: () => tour, useSpotlightRegistry: () => registry }
      if (id.endsWith('/spotlightSteps')) return steps
      if (id.endsWith('/coachMarkLayout')) return layout
      if (id.endsWith('/coachMarkMeasurement')) return { measureCoachTarget: async () => null }
      throw new Error(`Unexpected dependency: ${id}`)
    },
  })
  let lastTree: any
  const paint = () => {
    cursor = 0
    tour = provider.exports.SpotlightProvider({ children: null }).props.children.props.value
    const tree = module.exports.SpotlightOverlay()
    lastTree = tree
    effects.splice(0).forEach(run => run())
    return tree
  }
  paint()
  const resume = resolveSpotlightResume(savedProgress ?? null, null)
  tour.startTour(resume.current, resume.completed, resume.acknowledged)
  return {
    async settle() {
      for (let i = 0; i < 5; i++) {
        paint()
        for (const [id, timer] of timers) {
          if (timer.delay > 120) continue
          timers.delete(id); timer.run()
        }
        await new Promise<void>(resolve => setImmediate(resolve))
      }
      return findBubble(paint())
    },
    appState: (state: string) => appChange(state),
    resize: (width = 844, height = 390) => { dimensions = { width, height } },
    insets: (value: typeof insets) => { insets = value },
    target: (id: string, rect: layout.CoachRect | null) => { targetRects.set(id, rect) },
    outline: () => {
      const collect = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(collect)
        : !tree?.props ? [] : [tree, ...collect(tree.props.children)]
      return collect(lastTree).find(node => node.type === 'Rect' && node.props.strokeWidth === 2)?.props
    },
    pollTarget: async () => {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== 250) continue
        timers.delete(id); timer.run()
      }
      await new Promise<void>(resolve => setImmediate(resolve))
    },
    navigate: (name: string, key: string) => { route = { name, key }; routeChange() },
    restart: () => tour.startTour(),
    measurements: () => measurements,
    savedProgress: () => storage.get(provider.exports.SPOTLIGHT_PROGRESS_KEY),
    progress: () => ({ stepIndex: tour.stepIndex, running: tour.running }),
    viewed: () => events.filter(event => event === 'viewed').length,
  }
}

function findBubble(tree: any): any {
  if (Array.isArray(tree)) return tree.map(findBubble).find(Boolean)
  if (!tree?.props) return undefined
  return tree.type === 'TutorialBubble' ? tree : findBubble(tree.props.children)
}

for (const dismiss of ['onConfirm', 'onDismiss']) {
  test(`${dismiss}: 閉じた案内はコントロールセンター・バックグラウンド・画面サイズ変更から戻っても再表示しない`, async () => {
    const h = overlay()
    const bubble = await h.settle()
    assert.ok(bubble)
    bubble.props[dismiss]()
    assert.equal(await h.settle(), undefined)
    for (const state of ['inactive', 'background']) {
      h.appState(state); await h.settle()
      h.appState('active')
      assert.equal(await h.settle(), undefined)
    }
    h.resize()
    assert.equal(await h.settle(), undefined)
    h.navigate('TemplateDetail', 'gear-1')
    assert.ok(await h.settle(), '次のステップの案内は表示する')
  })
}

test('表示中の案内は復帰時に位置を再計測し、終了後の手動再開も表示できる', async () => {
  const h = overlay()
  assert.ok(await h.settle())
  const before = h.measurements()
  h.appState('inactive'); await h.settle()
  h.appState('active')
  const bubble = await h.settle()
  assert.ok(bubble)
  assert.ok(h.measurements() > before)
  bubble.props.onSkip()
  assert.equal(await h.settle(), undefined)
  h.appState('active')
  assert.equal(await h.settle(), undefined)
  h.restart()
  assert.ok(await h.settle())
})

test('OKを押した説明は、同じ画面が別のルートIDで開き直されても再表示しない', async () => {
  const h = overlay()
  const bubble = await h.settle()
  bubble.props.onConfirm()
  assert.equal(await h.settle(), undefined)
  h.navigate('PurposeSelection', 'purpose-2')
  assert.equal(await h.settle(), undefined)
})

test('各段でOKを押した後に前後の画面を行き来しても、未読の段だけ案内する', async () => {
  const h = overlay()
  const purpose = await h.settle()
  purpose.props.onConfirm()
  await h.settle()
  h.navigate('TemplateDetail', 'gear-1')
  const gear = await h.settle()
  assert.ok(gear)
  gear.props.onConfirm()
  await h.settle()
  h.navigate('PurposeSelection', 'purpose-1')
  assert.equal(await h.settle(), undefined)
  h.navigate('TemplateDetail', 'gear-2')
  assert.equal(await h.settle(), undefined)
  h.navigate('DeskPlacement', 'placement-1')
  assert.ok(await h.settle(), '未読の配置ガイドは表示する')
})

test('OKは説明の既読だけを保存し、再起動後も隠したまま実操作で次の段へ進める', async () => {
  const h = overlay()
  const bubble = await h.settle()
  const viewed = h.viewed()
  bubble.props.onConfirm()
  bubble.props.onConfirm()
  assert.equal(await h.settle(), undefined)
  assert.deepEqual(h.progress(), { stepIndex: 0, running: true })
  assert.equal(h.viewed(), viewed, 'OKを押すだけで表示イベントを重複記録しない')
  const saved = h.savedProgress()
  assert.ok(saved)
  assert.deepEqual(JSON.parse(saved), {
    version: 2, current: 'pick-purpose', completed: [], acknowledged: ['pick-purpose'],
  })
  const resumed = overlay(saved)
  assert.equal(await resumed.settle(), undefined)
  resumed.navigate('TemplateDetail', 'gear-1')
  assert.ok(await resumed.settle())
  h.restart()
  assert.ok(await h.settle(), '利用者が手動でガイドを再開した場合は既読の説明も表示する')
})

for (const [route, target] of [
  ['TemplateDetail', 'gear-inputs'], ['GadgetSelection', 'gear-inputs'],
  ['DeskPlacement', 'layout-area'], ['PhotoFill', 'photo-area'],
]) {
  test(`${route}: ボタンではなく説明領域を囲み、固定フッターに隠れた部分を除く`, async () => {
    const h = overlay()
    h.target(target, { x: 0, y: 120, width: 390, height: 800 })
    h.target('setup-footer', { x: 0, y: 700, width: 390, height: 144 })
    h.navigate(route, `${route}-1`)
    assert.ok(await h.settle())
    const outline = h.outline()
    assert.equal(outline.x, 0)
    assert.equal(outline.y, 120)
    assert.equal(outline.width, 390)
    assert.equal(outline.height, 580)
    await h.pollTarget()
    assert.ok(await h.settle(), '切り取った範囲と元の大きさの違いでガイドを閉じない')
  })
}

test('横向きでも領域の枠を左右の安全域と下部バーの内側に収める', async () => {
  const h = overlay()
  h.resize(844, 390)
  h.insets({ top: 0, bottom: 21, left: 47, right: 47 })
  h.target('gear-inputs', { x: -20, y: 80, width: 1000, height: 1000 })
  h.target('setup-footer', { x: 0, y: 300, width: 844, height: 90 })
  h.navigate('TemplateDetail', 'gear-1')
  assert.ok(await h.settle())
  const outline = h.outline()
  assert.equal(outline.x, 47)
  assert.equal(outline.y, 80)
  assert.equal(outline.width, 750)
  assert.equal(outline.height, 220)
})
