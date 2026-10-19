import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { DESK_HISTORY_DEMO_STEPS, getDeskHistoryDemo } from '../src/constants/deskHistoryDemo'
import { appendTodayPage, buildTimeline, localDateKey, playbackTimelineSummary, usagePeriodsOf, yearsAgoDateKey } from '../src/utils/deskTimeline'
import type { Gadget } from '../src/types'

test('見本は最初の一台・追加・買い替え・現在までを実際の歴史再生データで体験できる', () => {
  for (const lang of ['ja', 'en'] as const) {
    const { plan, gadgets } = getDeskHistoryDemo(lang)
    const events = buildTimeline(gadgets, plan, lang, 'month', '2026-10-09')
    assert.deepEqual(events.map(event => event.date), DESK_HISTORY_DEMO_STEPS.map(step => step.date))
    assert.deepEqual(events[0].gadgets.map(gadget => gadget.category), ['PC'])
    assert.equal(events[1].connections.some(connection => connection.toGadgetId === 'history-demo-monitor-old' && connection.fromGadgetId === 'history-demo-pc'), true)
    assert.equal(events[2].outGadgets[0].id, 'history-demo-monitor-old')
    assert.equal(events[2].inGadgets[0].id, 'history-demo-monitor')
    assert.equal(events[2].connections.some(connection => connection.toGadgetId === 'history-demo-monitor' && connection.fromGadgetId === 'history-demo-pc'), true)
    const replay = appendTodayPage(events, '2026-10-09')
    assert.equal(replay.at(-1)?.isTodayPage, true)
    assert.deepEqual(replay.at(-1)?.gadgets.map(gadget => gadget.id).sort(), [...plan.selectedGadgetIds].sort())
    assert.equal(plan.isShared, true)
  }
})

function previewHarness(reduceMotion = false) {
  const slots: any[] = []
  let cursor = 0
  let starts = 0
  let stops = 0
  let timerId = 0
  const timers = new Map<number, () => void>()
  const effects: (() => void)[] = []
  const react = {
    useRef: (current: unknown) => { const index = cursor++; return slots[index] ??= { current } },
    useState: (initial: unknown) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useEffect: (run: () => any, deps: any[]) => {
      const index = cursor++
      const previous = slots[index]
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
      slots[index] = { deps }
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = run() })
    },
  }
  class Value {
    setValue() {}
    interpolate() { return 1 }
  }
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync('src/components/molecules/DeskHistoryPreview.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports,
    setTimeout: (run: () => void) => { timers.set(++timerId, run); return timerId },
    clearTimeout: (id: number) => timers.delete(id),
    require: (id: string) => {
      if (id === 'react') return react
      if (id === 'react/jsx-runtime') return { jsx: (type: unknown, props: any) => ({ type, props }), jsxs: (type: unknown, props: any) => ({ type, props }) }
      if (id === 'react-native') return {
        View: 'View', Text: 'Text', TouchableOpacity: 'Button', StyleSheet: { create: (styles: any) => styles },
        Animated: { Value, View: 'AnimatedView', createAnimatedComponent: (type: unknown) => type, timing: () => ({ start: () => { starts++ }, stop: () => { stops++ } }) },
        Easing: { out: (value: unknown) => value, cubic: 'cubic' },
      }
      if (id === 'react-native-svg') return { default: 'Svg', Path: 'Path' }
      if (id.endsWith('/deskHistoryDemo')) return { DESK_HISTORY_DEMO_STEPS }
      if (id.endsWith('/icons')) return { ICONS: {}, categoryIconColor: () => '' }
      if (id.endsWith('/portTypes')) return { portColor: () => '' }
      if (id.endsWith('/ui')) return { UI_METRICS: {} }
      if (id.endsWith('/AppContext')) return { useApp: () => ({ colors: {}, lang: 'ja', isDark: false, reduceMotion }) }
      const name = id.split('/').at(-1)!
      return { [name]: name }
    },
  })
  const render = () => {
    cursor = 0
    const tree = module.exports.DeskHistoryPreview()
    effects.splice(0).forEach(run => run())
    return tree
  }
  let tree = render()
  return {
    timers,
    get date() { return tree.props.children[2].props.children[0].props.children },
    get starts() { return starts },
    get stops() { return stops },
    next: () => { const [id, run] = [...timers][0]; timers.delete(id); run(); tree = render() },
    replay: () => { tree.props.children[0].props.children[1].props.onPress(); tree = render() },
    reduce: () => { reduceMotion = true; tree = render() },
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
  }
}

test('初回の見本は現在で止まり、再生し直せて、画面を閉じるとタイマーを残さない', () => {
  const h = previewHarness()
  assert.equal(h.date, '2022 / 4')
  h.next()
  assert.equal(h.date, '2024 / 7')
  h.next()
  assert.equal(h.date, '2026 / 2')
  h.next()
  assert.equal(h.date, '現在')
  assert.equal(h.timers.size, 0)
  h.replay()
  assert.equal(h.date, '2022 / 4')
  assert.equal(h.timers.size, 1)
  h.unmount()
  assert.equal(h.timers.size, 0)
  assert.equal(h.stops, h.starts)
})

test('動きを減らす設定では現在の見本を静止表示し、途中で設定が変わっても演出を停止する', () => {
  const initial = previewHarness(true)
  assert.equal(initial.date, '現在')
  assert.equal(initial.starts, 0)
  assert.equal(initial.timers.size, 0)
  initial.unmount()
  const running = previewHarness()
  running.reduce()
  assert.equal(running.date, '現在')
  assert.equal(running.timers.size, 0)
  assert.equal(running.stops, running.starts)
  running.unmount()
})

function historyCard(gadgets: Gadget[], onRecordDate: (id?: string) => void, readOnly = false): any[] {
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync('src/components/organisms/DeskHistoryEntryCard.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports, Date,
    require: (id: string) => {
      if (id === 'react') return { useState: () => [false, () => {}], useMemo: (run: () => unknown) => run() }
      if (id === 'react/jsx-runtime') return { jsx: (type: unknown, props: any) => ({ type, props }), jsxs: (type: unknown, props: any) => ({ type, props }) }
      if (id === 'react-native') return { View: 'View', Text: 'Text', TouchableOpacity: 'Button', StyleSheet: { create: (styles: any) => styles } }
      if (id.endsWith('/useToday')) return { useToday: () => new Date(2026, 9, 9) }
      if (id.endsWith('/AppContext')) return { useApp: () => ({ historyGrain: 'month' }) }
      if (id.endsWith('/usePlans')) return { usePlans: () => ({}) }
      if (id.endsWith('/useEntitlement')) return { useEntitlement: () => ({ getLimit: () => 1 }) }
      if (id.endsWith('/plans')) return { PLAN_LIMITS: { free: { historyAnimationYears: 1 } } }
      if (id.endsWith('/deskTimeline')) return { localDateKey, playbackTimelineSummary, usagePeriodsOf, yearsAgoDateKey }
      if (id.endsWith('/icons')) return { ICONS: {} }
      if (id.endsWith('/ui')) return { UI_METRICS: {} }
      const name = id.split('/').at(-1)!
      return { [name]: name }
    },
  })
  const tree = module.exports.DeskHistoryEntryCard({ plan: {}, gadgets, colors: {}, lang: 'ja', readOnly, onRequirePro: () => {}, onRecordDate })
  const nodes: any[] = []
  const walk = (node: any) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (!node?.props) return
    nodes.push(node)
    walk(node.props.children)
  }
  walk(tree)
  return nodes
}

test('日付未設定でも見本と入力へ進めて、他人のデスクには編集を案内しない', () => {
  const undated: Gadget = { id: 'undated', category: 'PC', name: 'PC', ports: [], introducedAtUnknown: true, createdAt: '2026-10-09T00:00:00.000Z' }
  let chosen: string | undefined
  const own = historyCard([undated], id => { chosen = id })
  assert.equal(own.find(node => node.props.accessibilityLabel?.startsWith('このデスクの歩み'))?.props.disabled, true)
  assert.equal(own.some(node => node.props.children === '見本を再生'), true)
  const input = own.find(node => node.type === 'Button' && node.props.children?.props?.children === '導入時期を追加')
  assert.ok(input)
  input.props.onPress()
  assert.equal(chosen, 'undated')
  assert.equal(historyCard([undated], () => {}, true).length, 0)
})

test('無料の表示期間で短く見えるだけの歴史には、導入日の入力を勧めない', () => {
  const { gadgets } = getDeskHistoryDemo('ja')
  const old = gadgets.map(gadget => ({ ...gadget, purchasedAt: gadget.purchasedAt!.replace('2026', '2025'), removedAt: gadget.removedAt?.replace('2026', '2025') }))
  const own = historyCard(old, () => {})
  assert.equal(own.some(node => node.props.children === '導入時期を追加'), false)
  const shared = historyCard(gadgets, () => {}, true)
  assert.equal(shared.some(node => node.props.children === 'このデスクの歩みを再生'), true)
  assert.equal(shared.some(node => node.props.children === '導入時期を追加'), false)
})
