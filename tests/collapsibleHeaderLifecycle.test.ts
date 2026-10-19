import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as collapse from '../src/utils/collapsibleHeader'

// ネイティブ描画は代替せず、実際のhookへスクロール・寸法・タブ操作を順に渡す。
function deskHeader(reduceMotion = false) {
  const slots: any[] = []
  let cursor = 0
  let effects: (() => void)[] = []
  const reactions: any[] = []
  const options = { tab: 'gadgets' as collapse.CollapsibleTab, editing: false }
  let value: any
  let pauseTiming = false
  let deferJS = false
  const jsQueue: (() => void)[] = []
  let focused = true
  const sharedValues: any[] = []
  const memo = (create: () => any, deps: unknown[]) => {
    const index = cursor++
    if (!slots[index] || deps.some((dep, i) => !Object.is(dep, slots[index].deps[i]))) slots[index] = { deps, value: create() }
    return slots[index].value
  }
  const useRef = (initial: any) => {
    const index = cursor++
    return slots[index] ??= { current: initial }
  }
  const effect = (run: () => void, deps: unknown[]) => { memo(() => { effects.push(run); return null }, deps) }
  const react = {
    useRef,
    useMemo: memo,
    useCallback: (fn: any, deps: unknown[]) => memo(() => fn, deps),
    useEffect: effect,
    useLayoutEffect: effect,
    useState: (initial: any) => {
      const state = useRef(initial)
      return [state.current, (next: any) => { state.current = typeof next === 'function' ? next(state.current) : next }]
    },
  }
  function pan() {
    const callbacks: Record<string, any> = {}
    const gesture: any = { callbacks }
    for (const name of ['enabled', 'activeOffsetY', 'failOffsetX', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) {
      gesture[name] = (callback: any) => { callbacks[name] = callback; return gesture }
    }
    return gesture
  }
  const reanimated = {
    useSharedValue: (initial: number | boolean) => memo(() => {
      let current = initial
      const shared: any = {
        decay: null,
        timing: null,
        get value() { return current },
        set value(next: any) {
          if (next?.decay) shared.decay = next
          else if (next?.timing) shared.timing = next
          else { current = next; shared.timing = null }
        },
      }
      sharedValues.push(shared)
      return shared
    }, []),
    useAnimatedRef: () => useRef({ y: 0, scrollTo(this: any, { y }: any) { this.y = y } }),
    useAnimatedStyle: (read: () => unknown) => read,
    useAnimatedScrollHandler: (handlers: any) => handlers,
    useAnimatedReaction: (prepare: () => unknown, reactTo: any) => {
      const reaction = memo(() => {
        const entry = { prepare, reactTo, previous: null, signature: undefined }
        reactions.push(entry)
        return entry
      }, [])
      reaction.prepare = prepare
      reaction.reactTo = reactTo
    },
    scrollTo: (ref: any, _x: number, y: number) => ref.current.scrollTo({ y }),
    runOnJS: (fn: any) => (...args: any[]) => {
      if (deferJS) jsQueue.push(() => fn(...args))
      else fn(...args)
    },
    withTiming: (target: number) => pauseTiming ? { timing: true, target } : target,
    withDecay: (_config: unknown, done: any) => ({ decay: true, done }),
    cancelAnimation: (shared: any) => { shared.decay?.done(false); shared.decay = null; shared.timing = null },
    Easing: { bezier: () => null },
  }
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync('src/hooks/useCollapsibleHeader.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports, Date,
    require: (id: string) => {
      if (id === 'react') return react
      if (id === '@react-navigation/native') return { useIsFocused: () => focused }
      if (id === 'react-native-reanimated') return reanimated
      if (id === 'react-native-gesture-handler') return { Gesture: { Pan: pan } }
      if (id.endsWith('/AppContext')) return { useApp: () => ({ reduceMotion }) }
      if (id.endsWith('/collapsibleHeader')) return collapse
      throw new Error(id)
    },
  })
  function settle() {
    for (let i = 0; i < 15; i++) {
      cursor = 0
      value = module.exports.useCollapsibleHeader(options)
      const pending = effects
      effects = []
      pending.forEach(run => run())
      let changed = pending.length > 0
      for (const reaction of reactions) {
        const next = reaction.prepare()
        const signature = JSON.stringify(next)
        if (signature === reaction.signature) continue
        const previous = reaction.previous
        reaction.previous = next
        reaction.signature = signature
        reaction.reactTo(next, previous)
        changed = true
      }
      if (!changed) return value
    }
    assert.fail('収納と位置復元が収束しない')
  }
  settle()
  const layout = (height: number) => ({ nativeEvent: { layout: { height } } })
  value.handleCollapsibleLayout(layout(240))
  settle()
  value.onGadgetLayout(layout(600))
  value.onGadgetContentSize(390, 1800)
  settle()
  return {
    get value() { return value }, options, settle, layout,
    focus(next: boolean) { focused = next; settle() },
    drag(y: number, tab = options.tab) {
      const handler = tab === 'gadgets' ? value.handleGadgetScroll : value.handleInfoScroll
      handler.onBeginDrag({ contentOffset: { y } })
      settle()
    },
    scroll(y: number, tab = options.tab) {
      const handler = tab === 'gadgets' ? value.handleGadgetScroll : value.handleInfoScroll
      handler.onScroll({ contentOffset: { y } })
      settle()
    },
    offset() { return -value.headerShiftStyle().transform[0].translateY },
    deferJS() { deferJS = true },
    flushJS() { deferJS = false; jsQueue.splice(0).forEach(run => run()); settle() },
    finishDecays() {
      for (const shared of sharedValues) if (shared.decay) {
        const decay = shared.decay
        shared.decay = null
        decay.done(true)
      }
      settle()
    },
    pauseTimings() { pauseTiming = true },
    advanceTimings(fraction: number) {
      for (const shared of sharedValues) if (shared.timing) {
        const timing = shared.timing
        shared.value += (timing.target - shared.value) * fraction
        shared.timing = timing
      }
      settle()
    },
    finishTimings() {
      for (const shared of sharedValues) if (shared.timing) shared.value = shared.timing.target
      settle()
    },
  }
}

test('写真の慣性が終了していれば、JS側の終了通知が遅れても直後のタップを奪わない', () => {
  const desk = deskHeader()
  desk.value.headerPan.callbacks.onStart()
  desk.value.headerPan.callbacks.onUpdate({ translationY: -100 })
  desk.value.headerPan.callbacks.onEnd({ velocityY: -600 })
  desk.value.headerPan.callbacks.onFinalize()
  desk.deferJS()
  desk.finishDecays()
  assert.equal(desk.value.captureTouchDuringFling(), false)
  desk.flushJS()
  assert.equal(desk.value.captureTouchDuringFling(), false)
})

test('写真が実際に慣性中なら、JS側の開始通知を待たず停止し、次のタップを通す', () => {
  const desk = deskHeader()
  desk.value.headerPan.callbacks.onStart()
  desk.value.headerPan.callbacks.onUpdate({ translationY: -100 })
  desk.deferJS()
  desk.value.headerPan.callbacks.onEnd({ velocityY: -600 })
  desk.value.headerPan.callbacks.onFinalize()
  assert.equal(desk.value.captureTouchDuringFling(), true)
  assert.equal(desk.value.captureTouchDuringFling(), false)
  desk.flushJS()
  assert.equal(desk.value.captureTouchDuringFling(), false)
})

test('写真上の慣性中に別画面へ移ると停止し、戻った後の最初のタップを奪わない', () => {
  const desk = deskHeader()
  desk.value.headerPan.callbacks.onStart()
  desk.value.headerPan.callbacks.onUpdate({ translationY: -120 })
  desk.value.headerPan.callbacks.onEnd({ velocityY: -800 })
  desk.value.headerPan.callbacks.onFinalize()
  desk.settle()
  desk.focus(false)
  desk.scroll(500)
  assert.equal(desk.value.gadgetScrollY.value, 120)
  assert.equal(desk.offset(), 120)
  desk.focus(true)
  assert.equal(desk.value.captureTouchDuringFling(), false)
  assert.equal(desk.offset(), 120)
  desk.drag(120)
  desk.scroll(160)
  assert.equal(desk.offset(), 160)
})

test('通常の慣性スクロールも非表示中の通知を捨て、戻ると同じ本文位置を復元する', () => {
  const desk = deskHeader()
  desk.drag(0)
  desk.scroll(620)
  desk.focus(false)
  desk.scroll(800)
  assert.equal(desk.value.gadgetScrollY.value, 620)
  desk.focus(true)
  assert.equal(desk.value.gadgetScrollRef.current.y, 620)
  assert.equal(desk.offset(), 240)
})

test('写真の開閉アニメーション途中で移動しても、裏で完了せず戻った位置から操作を再開する', () => {
  const desk = deskHeader()
  desk.pauseTimings()
  desk.value.handleHeaderDoubleTap()
  desk.value.handleHeaderDoubleTap()
  desk.advanceTimings(0.5)
  assert.equal(desk.offset(), 120)
  desk.focus(false)
  desk.finishTimings()
  assert.equal(desk.offset(), 120)
  desk.focus(true)
  assert.equal(desk.value.gadgetScrollRef.current.y, 120)
  desk.drag(120)
  desk.scroll(150)
  assert.equal(desk.offset(), 150)
})

test('実際のスクロール通知で小さく収納し、戻す途中でも自動で全展開しない', () => {
  const desk = deskHeader()
  desk.drag(0)
  desk.scroll(12)
  assert.equal(desk.offset(), 12)
  assert.equal(desk.value.headerParallaxStyle().transform[0].translateY, -6)
  assert.equal(desk.value.listContentStyle().transform[0].translateY, 12)
  desk.scroll(80)
  desk.scroll(40)
  assert.equal(desk.offset(), 40)
  desk.scroll(600)
  assert.equal(desk.offset(), 240)
  desk.scroll(400)
  assert.equal(desk.offset(), 240)
  desk.scroll(90)
  assert.equal(desk.offset(), 90)
})

test('写真上のドラッグはネイティブ通知が遅れても指と同じ距離だけ進める', () => {
  const desk = deskHeader()
  desk.value.headerPan.callbacks.onStart()
  desk.value.headerPan.callbacks.onUpdate({ translationY: -100 })
  desk.settle()
  assert.equal(desk.offset(), 100)
  assert.equal(desk.value.gadgetScrollY.value, 100)
  desk.scroll(20)
  assert.equal(desk.offset(), 100, '古いscrollTo通知で写真を引き戻さない')
  desk.value.headerPan.callbacks.onEnd({ velocityY: -500 })
  desk.value.headerPan.callbacks.onFinalize()
  desk.settle()
  assert.equal(desk.value.captureTouchDuringFling(), true)
  assert.equal(desk.value.captureTouchDuringFling(), false)
})

test('途中の収納を機材・履歴間で保ち、隠れた一覧の通知を無視する', () => {
  const desk = deskHeader()
  desk.drag(0)
  desk.scroll(90)
  desk.options.tab = 'info'
  desk.settle()
  desk.value.onInfoLayout(desk.layout(600))
  desk.value.onInfoContentSize(390, 1800)
  desk.settle()
  assert.equal(desk.offset(), 90)
  assert.equal(desk.value.infoScrollRef.current.y, 90)
  desk.scroll(900, 'gadgets')
  assert.equal(desk.offset(), 90)
  assert.equal(desk.value.gadgetScrollY.value, 90)
  desk.options.tab = 'gadgets'
  desk.settle()
  desk.value.onGadgetLayout(desk.layout(600))
  desk.value.onGadgetContentSize(390, 1800)
  desk.settle()
  assert.equal(desk.value.gadgetScrollRef.current.y, 90)
})

test('編集中は上部を開き、編集を終えたら途中の収納率と一覧位置を戻す', () => {
  const desk = deskHeader()
  desk.drag(0)
  desk.scroll(90)
  desk.options.editing = true
  desk.settle()
  assert.equal(desk.offset(), 0)
  assert.equal(desk.value.gadgetScrollRef.current.y, 0)
  desk.value.handleCollapsibleLayout(desk.layout(480))
  desk.settle()
  desk.options.editing = false
  desk.settle()
  desk.value.handleCollapsibleLayout(desk.layout(240))
  desk.settle()
  assert.equal(desk.offset(), 90)
  assert.equal(desk.value.gadgetScrollRef.current.y, 90)
})

test('配線の写真ボタンは全収納・全展開し、一覧へ戻ると読んでいた行へ戻す', () => {
  const desk = deskHeader()
  desk.drag(0)
  desk.scroll(600)
  desk.options.tab = 'wiring'
  desk.settle()
  assert.equal(desk.offset(), 240)
  desk.value.handleWiringPhotoToggle()
  desk.settle()
  assert.equal(desk.offset(), 0)
  assert.equal(desk.value.wiringPhotoExpanded, true)
  desk.options.tab = 'gadgets'
  desk.settle()
  desk.value.onGadgetLayout(desk.layout(600))
  desk.value.onGadgetContentSize(390, 1800)
  desk.settle()
  assert.equal(desk.offset(), 240)
  assert.equal(desk.value.gadgetScrollRef.current.y, 600)
})

test('動きを減らす設定では視差を抑えても収納量と一覧位置は変わらない', () => {
  const desk = deskHeader(true)
  desk.drag(0)
  desk.scroll(80)
  assert.equal(desk.offset(), 80)
  assert.equal(desk.value.headerParallaxStyle().transform[0].translateY, -80)
  assert.equal(desk.value.listContentStyle().transform[0].translateY, 80)
})

test('手動開閉のアニメ中にもう一度ダブルタップすると行き先を反転する', () => {
  const desk = deskHeader()
  desk.pauseTimings()
  desk.value.handleHeaderDoubleTap()
  desk.value.handleHeaderDoubleTap()
  desk.settle()
  assert.equal(desk.offset(), 0, '閉じるアニメーションがまだ動き出していない')
  desk.value.handleHeaderDoubleTap()
  desk.value.handleHeaderDoubleTap()
  desk.settle()
  desk.finishTimings()
  assert.equal(desk.offset(), 0, '現在位置でなく、行き先を見て開く操作に反転する')
})

test('写真上のドラッグ後に寸法が変わっても途中の収納率と位置を保つ', () => {
  const desk = deskHeader()
  desk.drag(0)
  desk.scroll(80)
  desk.value.handleCollapsibleLayout(desk.layout(0))
  desk.settle()
  assert.equal(desk.offset(), 80, '一時的な非表示の寸法で収納状態を失わない')
  desk.value.handleCollapsibleLayout(desk.layout(480))
  desk.settle()
  assert.equal(desk.offset(), 160)
  assert.equal(desk.value.gadgetScrollRef.current.y, 160)
  desk.value.onGadgetContentSize(390, 2040)
  desk.settle()
  assert.equal(desk.value.gadgetScrollRef.current.y, 160)
})
