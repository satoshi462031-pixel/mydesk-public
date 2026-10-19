import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { HistoryPlayback } from '../src/hooks/useHistoryPlayback'

function runtime() {
  const slots: any[] = []
  const effects = new Map<number, { cleanup: () => void; run: () => void }>()
  const timers = new Map<number, { run: () => void; at: number }>()
  const frames = new Map<number, () => void>()
  let cursor = 0
  let dirty = false
  let now = 0
  let nextId = 1
  const memo = (create: () => any, deps: unknown[]) => {
    const index = cursor++
    const previous = slots[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      slots[index] = { value: create(), deps }
    }
    return slots[index].value
  }
  const react = {
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (update: any) => {
        const next = typeof update === 'function' ? update(slots[index]) : update
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true }
      }]
    },
    useRef: (initial: unknown) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useMemo: memo,
    useCallback: (fn: unknown, deps: unknown[]) => memo(() => fn, deps),
    useEffect: (run: () => any, deps: unknown[]) => {
      const index = cursor++
      const previous = slots[index]
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
      const next = { deps, cleanup: undefined as any }
      slots[index] = next
      effects.set(index, { cleanup: () => previous?.cleanup?.(), run: () => { next.cleanup = run() } })
    },
  }
  return {
    bindings: {
      ...react, exports: {}, require: () => react, __DEV__: false,
      Date: { now: () => now },
      setTimeout: (run: () => void, delay: number) => {
        const id = nextId++; timers.set(id, { run, at: now + delay }); return id
      },
      clearTimeout: (id: number) => timers.delete(id),
      requestAnimationFrame: (run: () => void) => { const id = nextId++; frames.set(id, run); return id },
      cancelAnimationFrame: (id: number) => frames.delete(id),
    },
    render: <T>(render: () => T): T => {
      for (let attempt = 0; attempt < 20; attempt++) {
        cursor = 0; dirty = false
        const result = render()
        const pending = [...effects.values()]; effects.clear()
        pending.forEach(effect => effect.cleanup())
        pending.forEach(effect => effect.run())
        if (!dirty) return result
      }
      assert.fail('再描画が収束しない')
    },
    advance: (ms: number) => {
      now += ms
      for (const [id, task] of [...timers]) {
        if (task.at <= now) { timers.delete(id); task.run() }
      }
      const pending = [...frames.values()]; frames.clear()
      pending.forEach(run => run())
    },
    timerCount: () => timers.size,
    pendingTimer: () => [...timers.values()][0]?.run,
    frameCount: () => frames.size,
    now: () => now,
  }
}

function compile(source: string, bindings: Record<string, unknown>) {
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  return runInNewContext(code, bindings)
}

function declaration(file: string, name: string) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(fn?.body)
  return { source, fn }
}

function nativeHistoryClock() {
  const state = runtime()
  let nativeNow = 0
  const timings: Array<{ duration: number }> = []
  const makeMutable = (initial: number) => {
    let current = initial
    let animation: { from: number; to: number; at: number; duration: number } | undefined
    return {
      get value() {
        if (!animation) return current
        const fraction = Math.min(1, (nativeNow - animation.at) / animation.duration)
        return animation.from + (animation.to - animation.from) * fraction
      },
      set value(next: any) {
        if (typeof next === 'number') { current = next; animation = undefined }
        else animation = { from: this.value, to: next.to, at: nativeNow, duration: next.duration }
      },
    }
  }
  const interpolate = (value: number, input: number[], output: number[]) => {
    let index = 0
    while (index < input.length - 2 && value > input[index + 1]) index++
    const fraction = Math.max(0, Math.min(1, (value - input[index]) / (input[index + 1] - input[index])))
    return output[index] + (output[index + 1] - output[index]) * fraction
  }
  const reanimated = {
    createAnimatedComponent: () => 'NativePath', makeMutable, interpolate, Extrapolation: { CLAMP: 'clamp' },
    Easing: { linear: (x: number) => x }, ReduceMotion: { Never: 'never' },
    cancelAnimation: (value: { value: number }) => { const current = value.value; value.value = current },
    runOnUI: (fn: () => void) => fn,
    withTiming: (to: number, config: { duration: number }) => { timings.push(config); return { to, ...config } },
    useDerivedValue: (fn: () => number) => ({ get value() { return fn() } }),
  }
  const code = ts.transpileModule(readFileSync('src/components/molecules/HistoryMotion.tsx', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const module = runInNewContext(`${code}\nexports`, {
    exports: {}, require: (name: string) => name === 'react' ? state.bindings : name === 'react-native-reanimated' ? reanimated : {},
  })
  const seekRef = { current: null as ((x: number) => void) | null }
  const easing = (x: number) => x
  const defaults = { animKey: '0-1', startAt: 0, durationMs: 5000, frozen: false, reduceMotion: false, clockEasing: easing, seekRef }
  return {
    timings, seekRef,
    advance: (ms: number) => { nativeNow += ms },
    update: (overrides: Partial<typeof defaults> = {}) => state.render(() => module.useHistoryMotionClock({ ...defaults, ...overrides })),
  }
}

test('履歴の描画クロックはJSのフレーム通知なしで進み、停止・速度変更もUI上の現在位置を保つ', () => {
  const clock = nativeHistoryClock()
  let progress = clock.update()
  clock.advance(1000)
  assert.equal(progress.value.value, 0.2)
  progress = clock.update({ frozen: true })
  clock.advance(3000)
  assert.equal(progress.value.value, 0.2)
  progress = clock.update({ durationMs: 2500 })
  assert.equal(clock.timings.at(-1)!.duration, 2000)
  clock.advance(500)
  assert.equal(progress.value.value, 0.4)
  progress = clock.update({ frozen: true, durationMs: 2500 })
  clock.seekRef.current!(0.8)
  assert.equal(progress.value.value, 0.8)
  clock.seekRef.current!(0.1)
  assert.equal(progress.value.value, 0.1)
  progress = clock.update({ durationMs: 2500 })
  clock.advance(2250)
  assert.equal(progress.value.value, 1)
})

test('履歴のUIクロックは演出曲線と途中位置を保ち、次のイベント・動きを減らす設定を反映する', () => {
  const clock = nativeHistoryClock()
  let progress = clock.update({ frozen: true, startAt: 0.5, clockEasing: (x) => x * x })
  assert.equal(progress.value.value, 0.25)
  progress = clock.update({ animKey: '1-2', frozen: true, startAt: 0.25 })
  assert.equal(progress.value.value, 0.25)
  progress = clock.update({ animKey: '1-2', frozen: true, reduceMotion: true })
  assert.equal(progress.value.value, 1)
  progress = clock.update({ animKey: '1-2', frozen: true })
  assert.equal(progress.value.value, 1, '設定を戻しても演出を巻き戻さない')
})

class ProgressValue {
  value: number
  constructor(value: number) { this.value = value }
  setValue(value: number) { this.value = value }
  stopAnimation() {}
  interpolate() { return this }
}

function progressBar() {
  const state = runtime()
  const { source, fn } = declaration('src/components/organisms/DeskHistoryAnimationModal.tsx', 'ProgressBar')
  const jsx = (type: unknown, props: any) => ({ type, props })
  const render = compile(`(${fn.getText(source)})`, {
    ...state.bindings, require: () => ({ jsx, jsxs: jsx }),
    PanResponder: { create: (panHandlers: unknown) => ({ panHandlers }) },
    View: 'View', Text: 'Text', Animated: { View: 'AnimatedView' },
    styles: {}, SEEK_BUBBLE_W: 100, MAX_SEGMENTED_EVENTS: 24, StyleSheet: { absoluteFill: {} },
  })
  const value = new ProgressValue(0.4)
  const previews: number[] = []
  const commits: Array<{ ratio: number; resume: boolean }> = []
  let starts = 0
  const props = {
    progress: value, count: 4, index: 1, labelOf: String, detailOf: (i: number) => `Change ${i}`, milestones: [0, 1, 2],
    onScrubStart: () => { starts++; return true },
    onScrub: (ratio: number) => previews.push(ratio),
    onScrubEnd: (ratio: number, resume: boolean) => commits.push({ ratio, resume }),
  }
  return {
    ...state, value, previews, commits, props,
    starts: () => starts,
    update: () => state.render(() => render(props)),
    touch: (x: number) => ({ nativeEvent: { locationX: x } }),
  }
}

function progressPlayback() {
  const state = runtime()
  const hook = compile(`${readFileSync('src/hooks/useHistoryPlayback.ts', 'utf8')}\nexports`, state.bindings)
  const scrub = compile(`${readFileSync('src/utils/historyScrub.ts', 'utf8')}\nexports`, { exports: {} })
  const { source, fn } = declaration('src/components/organisms/DeskHistoryAnimationModal.tsx', 'DeskHistoryAnimationModal')
  const statements = fn.body!.statements
  const variable = (node: ts.Statement, name: string) => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(decl => decl.name.getText(source) === name)
  const start = statements.findIndex(node => variable(node, 'progress'))
  const end = statements.findIndex(node => variable(node, 'layout'))
  assert.ok(start >= 0 && end > start)
  const holds = [0, 2 * hook.PAGE_MS, 0]
  const globals = {
    ...state.bindings, ...scrub,
    visible: true, prepared: {} as object | null, extraHoldMs: holds, EVENT_MS: hook.EVENT_MS, PAGE_MS: hook.PAGE_MS,
    eventStayMs: hook.eventStayMs,
    setQuickSpeedOpen: () => {},
    baseMsOf: () => hook.EVENT_MS, pageCountOf: (i: number) => i === 1 ? 3 : 1,
    clockAt: (i: number, f: number) => scrub.scrubClock(f, hook.eventStayMs(holds[i]), hook.EVENT_ANIM_MS),
    Easing: { linear: (x: number) => x },
    Animated: { Value: ProgressValue, timing: () => ({ start: () => {}, stop: () => {} }) },
  }
  const render = compile(`(pb => {
    const { index, event, playing, speed, count, nonce, offset } = pb
    ${statements.slice(start, end).map(node => node.getText(source)).join('\n')}
    return { pb, progress, readProgress, startScrub, scrubTo, finishScrub, page, canvasSeek, scrubbing }
  })`, globals)
  const events = [{}, {}, {}]
  return {
    ...state,
    visible: (next: boolean) => { globals.visible = next; globals.prepared = next ? {} : null },
    update: () => state.render(() => render(hook.useHistoryPlayback(events, globals.visible, 1, () => {}, holds))),
  }
}

function playback(count = 2) {
  const state = runtime()
  const code = ts.transpileModule(readFileSync('src/hooks/useHistoryPlayback.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const module = runInNewContext(`${code}\nexports`, state.bindings)
  const events = Array.from({ length: count }, () => ({}))
  let enabled = true
  let speed = 1
  return {
    ...state,
    update: (): HistoryPlayback => state.render(() => module.useHistoryPlayback(events, enabled, speed, () => {})),
    enable: (value: boolean) => { enabled = value },
    speed: (value: number) => { speed = value },
    eventMs: module.EVENT_MS as number,
  }
}

test('履歴は再生時間を延ばさず、完成図を1秒保ってから次のイベントへ進む', () => {
  const state = runtime()
  const config = compile(`${readFileSync('src/hooks/useHistoryPlayback.ts', 'utf8')}\nexports`, state.bindings)
  assert.equal(config.EVENT_MS - config.EVENT_ANIM_MS, 1000)
  assert.equal(config.QUIET_EVENT_MS - config.QUIET_EVENT_ANIM_MS, 1000)
  const player = playback()
  player.update()
  player.advance(config.EVENT_ANIM_MS)
  assert.equal(player.update().index, 0)
  player.advance(999)
  assert.equal(player.update().index, 0)
  player.advance(1)
  assert.equal(player.update().index, 1)
})

function playbackButtons() {
  const file = 'src/components/organisms/DeskHistoryAnimationModal.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let controls: ts.JsxElement | undefined
  let styles: ts.ObjectLiteralExpression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute =>
      ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'ref' && attribute.initializer?.getText(source).includes("coachTarget('pb-controls')"))) {
      controls = node
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'styles' && node.initializer && ts.isCallExpression(node.initializer)) {
      const argument = node.initializer.arguments[0]
      if (ts.isObjectLiteralExpression(argument)) styles = argument
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(controls)
  assert.ok(styles)
  const buttonStyles = styles.properties.filter(property =>
    ts.isPropertyAssignment(property) && ['controlMain', 'stepBtn', 'playBtn'].includes(property.name.getText(source)))
  const code = ts.transpileModule(`
    const styles = { ${buttonStyles.map(property => property.getText(source)).join(',')} };
    (pb => {
      const { index, playing, finished, count } = pb
      const ja = true
      const colors = { text: 'text', textMuted: 'muted', accent: 'accent', onAccent: 'onAccent' }
      const coachTarget = () => undefined
      const handleStep = delta => pb.step(delta)
      const handleToggle = () => pb.toggle()
      return (${controls.getText(source)})
    })
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText
  const jsx = (type: unknown, props: any) => ({ type, props })
  return runInNewContext(code, {
    exports: {}, require: () => ({ jsx, jsxs: jsx }), View: 'View', TouchableOpacity: 'TouchableOpacity', AppIcon: 'AppIcon', IconCircleButton: 'IconCircleButton',
  }) as (pb: HistoryPlayback) => any
}

test('再描画前に再生ボタンを連打しても、押すたびに再生と停止が切り替わる', () => {
  const player = playback()
  let controls = player.update()
  assert.equal(controls.playing, true)
  for (const presses of [3, 2, 4, 1]) {
    const expected: boolean = presses % 2 === 0 ? controls.playing : !controls.playing
    for (let i = 0; i < presses; i++) controls.toggle()
    controls = player.update()
    assert.equal(controls.playing, expected)
    assert.equal(player.timerCount(), expected ? 1 : 0)
  }
})

test('停止操作の直後に進行タイマーが発火しても、次のイベントの再生を始めない', () => {
  const player = playback()
  const controls = player.update()
  controls.pause()
  player.advance(player.eventMs)
  const paused = player.update()
  assert.equal(paused.playing, false)
  assert.equal(paused.index, 0)
  assert.equal(paused.finished, false)
})

test('停止と再開を繰り返しても、停止時間を進行に含めず残り時間から再開する', () => {
  const player = playback()
  let controls = player.update()
  for (let i = 0; i < 3; i++) {
    player.advance(500)
    controls.pause(); controls = player.update()
    player.advance(10_000)
    assert.equal(player.update().index, 0)
    controls.play(); controls = player.update()
  }
  player.speed(2); controls = player.update()
  player.advance((player.eventMs - 1500) / 2 - 1)
  assert.equal(player.update().index, 0)
  player.advance(1)
  assert.equal(player.update().index, 1)
})

test('末尾からの再生を連打しても、再生を重ねず最後の停止操作を保つ', () => {
  const player = playback(1)
  player.update()
  player.advance(player.eventMs)
  const completed = player.update()
  assert.equal(completed.finished, true)
  completed.toggle(); completed.toggle(); completed.toggle(); completed.toggle()
  const paused = player.update()
  assert.equal(paused.playing, false)
  assert.equal(paused.finished, false)
  assert.equal(paused.nonce, completed.nonce + 1)
  assert.equal(player.timerCount(), 0)
  paused.play(); player.update()
  player.enable(false)
  assert.equal(player.update().playing, false)
  assert.equal(player.timerCount(), 0)
})

test('停止直後の前後移動も停止状態を保ち、選んだ日の完成した図を表示する', () => {
  const player = playback(3)
  const controls = player.update()
  controls.pause(); controls.step(1)
  const next = player.update()
  assert.equal(next.playing, false)
  assert.equal(next.index, 1)
  assert.equal(next.offset, 1)
  assert.equal(player.timerCount(), 0)
  next.step(-1)
  const previous = player.update()
  assert.equal(previous.index, 0)
  assert.equal(previous.offset, 1)
  previous.play(); player.update()
  player.advance(0)
  assert.equal(player.update().index, 1)
})

test('再描画前のスキップ連打と前後の切り替えは、操作順に位置へ反映する', () => {
  const player = playback(5)
  const controls = player.update()
  controls.step(1); controls.step(1); controls.step(1)
  assert.equal(player.update().index, 3)
  controls.step(-1); controls.step(1); controls.step(-1)
  assert.equal(player.update().index, 2)
  for (let i = 0; i < 10; i++) controls.step(1)
  assert.equal(player.update().index, 4)
  for (let i = 0; i < 10; i++) controls.step(-1)
  assert.equal(player.update().index, 0)
  assert.equal(player.timerCount(), 1)
})

test('シーク・スキップ前のタイマー通知が遅れて届いても移動先を上書きしない', () => {
  const player = playback(5)
  const controls = player.update()
  const staleTimer = player.pendingTimer()!
  player.advance(player.eventMs - 1)
  controls.seek(3, true)
  player.advance(1)
  assert.equal(player.update().index, 3)
  staleTimer()
  assert.equal(player.update().index, 3)
  const beforeSkip = player.pendingTimer()!
  controls.step(-1)
  beforeSkip()
  assert.equal(player.update().index, 2)
  player.advance(player.eventMs - 1)
  assert.equal(player.update().index, 2)
  player.advance(1)
  assert.equal(player.update().index, 3)
})

test('再描画前に停止・再開してもタイマーを失わず、停止中の時間を除いて進む', () => {
  const player = playback()
  const controls = player.update()
  player.advance(500)
  controls.pause()
  player.advance(10_000)
  controls.play()
  const resumed = player.update()
  assert.equal(resumed.playing, true)
  assert.equal(resumed.index, 0)
  assert.equal(player.timerCount(), 1)
  player.advance(player.eventMs - 501)
  assert.equal(player.update().index, 0)
  player.advance(1)
  assert.equal(player.update().index, 1)
})

test('停止して最後の日へスキップした後は、再生を1回押すと先頭から再開する', () => {
  const player = playback(2)
  const controls = player.update()
  controls.pause(); controls.step(1)
  const end = player.update()
  assert.equal(end.offset, 1)
  assert.equal(end.finished, true)
  end.toggle()
  const replay = player.update()
  assert.equal(replay.index, 0)
  assert.equal(replay.offset, 0)
  assert.equal(replay.playing, true)
  assert.equal(replay.finished, false)
})

test('閉じた履歴や空の履歴は、再生・スキップ・リプレイ操作で再開しない', () => {
  for (const count of [0, 3]) {
    const player = playback(count)
    const controls = player.update()
    player.enable(false)
    player.update()
    for (const action of [controls.play, () => controls.step(1), () => controls.seek(1, true), controls.restart, controls.replayEvent, controls.toggle]) {
      action()
      const closed = player.update()
      assert.equal(closed.playing, false)
      assert.equal(closed.index, 0)
      assert.equal(player.timerCount(), 0)
    }
  }
})

test('この変化をもう一度は途中からでも先頭へ戻り、同じイベントの完成位置で停止する', () => {
  const player = playback(3)
  let controls = player.update()
  controls.seek(1, false, 0.6); controls = player.update()
  const previousNonce = controls.nonce
  controls.replayEvent(); controls = player.update()
  assert.equal(controls.index, 1)
  assert.equal(controls.offset, 0)
  assert.ok(controls.nonce > previousNonce)
  assert.equal(controls.playing, true)
  player.advance(player.eventMs)
  controls = player.update()
  assert.equal(controls.index, 1)
  assert.equal(controls.offset, 1)
  assert.equal(controls.playing, false)
  assert.equal(controls.finished, false)
  assert.equal(player.timerCount(), 0)
  player.advance(player.eventMs * 3)
  assert.equal(player.update().index, 1)
})

test('区間リプレイ中の停止・速度変更は残り時間を保ち、手動シークで通常再生へ戻る', () => {
  const player = playback(3)
  let controls = player.update()
  controls.replayEvent(); controls = player.update()
  player.advance(1000)
  controls.pause(); controls = player.update()
  player.advance(5000)
  player.speed(2)
  controls.play(); controls = player.update()
  player.advance((player.eventMs - 1000) / 2)
  controls = player.update()
  assert.equal(controls.index, 0)
  assert.equal(controls.playing, false)
  controls.replayEvent(); controls = player.update()
  controls.seek(1, true); controls = player.update()
  player.advance(player.eventMs / 2)
  assert.equal(player.update().index, 2)
})

test('区間リプレイの連打と古いタイマー通知で次の日へ進まず、最終イベントも終了画面へ飛ばない', () => {
  const player = playback(2)
  let controls = player.update()
  const stale = player.pendingTimer()!
  controls.seek(1, false, 1); controls = player.update()
  controls.replayEvent(); controls.replayEvent(); controls = player.update()
  stale()
  assert.equal(player.update().index, 1)
  player.advance(player.eventMs)
  controls = player.update()
  assert.equal(controls.index, 1)
  assert.equal(controls.offset, 1)
  assert.equal(controls.playing, false)
  assert.equal(controls.finished, false)
})

test('実際の再生・スキップボタンは、停止・末尾の表示と操作先を一致させる', () => {
  const player = playback(3)
  const render = playbackButtons()
  let row = render(player.update())
  let [previous, play, next] = row.props.children
  assert.equal(previous.props.disabled, true)
  assert.equal(next.props.disabled, false)
  assert.equal(play.props.name, 'pause')
  assert.equal(play.props.accessibilityLabel, '一時停止')
  next.props.onPress(); next.props.onPress()
  row = render(player.update())
  ;[previous, play, next] = row.props.children
  assert.equal(previous.props.disabled, false)
  assert.equal(next.props.disabled, true)
  play.props.onPress()
  row = render(player.update())
  assert.equal(row.props.children[1].props.name, 'play')
  row.props.children[0].props.onPress()
  row = render(player.update())
  row.props.children[2].props.onPress()
  row = render(player.update())
  assert.equal(row.props.children[1].props.name, 'replay')
  assert.equal(row.props.children[1].props.accessibilityLabel, '最初から再生')
  row.props.children[1].props.onPress()
  row = render(player.update())
  assert.equal(row.props.children[0].props.disabled, true)
  assert.equal(row.props.children[1].props.name, 'pause')
})

test('再生・スキップのタップ範囲は44以上を確保し、隣のボタンと重ならない', () => {
  const row = playbackButtons()(playback(3).update())
  let cursor = 0
  let previousRight = -Infinity
  for (const button of row.props.children) {
    const style = button.props.style
    const width = button.props.diameter ?? style.width
    const height = button.props.diameter ?? style.height
    const slop = button.props.hitSlop
    const inset = (side: string) => typeof slop === 'number' ? slop : slop?.[side] ?? 0
    const margin = style.marginHorizontal ?? 0
    const left = cursor + margin - inset('left')
    const right = cursor + margin + width + inset('right')
    assert.ok(right - left >= 44)
    assert.ok(height + inset('top') + inset('bottom') >= 44)
    assert.ok(previousRight <= left, '隣接ボタンのタップ範囲が重なっている')
    previousRight = right
    cursor += width + margin * 2 + row.props.style.gap
  }
})

test('バーのドラッグ通知はフレームごとにまとめ、指を離した最後の位置を1回確定する', () => {
  const bar = progressBar()
  const view = bar.update()
  view.props.onLayout({ nativeEvent: { layout: { width: 200 } } })
  view.props.onPanResponderGrant(bar.touch(20))
  view.props.onPanResponderMove(bar.touch(80))
  view.props.onPanResponderMove(bar.touch(140))
  assert.equal(bar.value.value, 0.7)
  assert.equal(bar.frameCount(), 1)
  bar.advance(16)
  assert.deepEqual(bar.previews, [0.7])
  view.props.onPanResponderMove(bar.touch(160))
  view.props.onPanResponderRelease(bar.touch(180))
  assert.deepEqual(bar.commits, [{ ratio: 0.9, resume: true }])
  assert.equal(bar.frameCount(), 0)
  bar.advance(16)
  assert.deepEqual(bar.previews, [0.7])
})

test('バーの外までドラッグしても端に留まり、中断時は最後の位置を確定する', () => {
  const bar = progressBar()
  const view = bar.update()
  view.props.onLayout({ nativeEvent: { layout: { width: 200 } } })
  view.props.onPanResponderGrant(bar.touch(-50))
  assert.equal(bar.value.value, 0)
  view.props.onPanResponderMove(bar.touch(250))
  assert.equal(bar.value.value, 1)
  view.props.onPanResponderTerminate()
  assert.deepEqual(bar.commits, [{ ratio: 1, resume: true }])
  assert.equal(bar.frameCount(), 0)
})

test('未計測・空のバーはタッチを受けず、停止や先頭へのシークを発生させない', () => {
  const bar = progressBar()
  let view = bar.update()
  assert.equal(view.props.onStartShouldSetPanResponder(), false)
  view.props.onPanResponderGrant(bar.touch(100))
  view.props.onPanResponderRelease(bar.touch(100))
  assert.equal(bar.starts(), 0)
  assert.deepEqual(bar.commits, [])
  view.props.onLayout({ nativeEvent: { layout: { width: 200 } } })
  bar.props.count = 0
  view = bar.update()
  assert.equal(view.props.onStartShouldSetPanResponder(), false)
  assert.equal(view.props.onMoveShouldSetPanResponder(), false)
})

test('ドラッグで日をまたいでも、後から届く描画が最新のバー位置を巻き戻さない', () => {
  const player = progressPlayback()
  let controls = player.update()
  controls.startScrub(); controls = player.update()
  controls.scrubTo(0.4)
  controls.scrubTo(0.5)
  controls = player.update()
  assert.equal(controls.pb.index, 1)
  assert.equal(controls.pb.playing, false)
  assert.equal(controls.progress.value, 0.5)
  assert.equal(controls.readProgress(), 0.5)
  controls.finishScrub(0.5, true)
  controls = player.update()
  assert.equal(controls.pb.offset, 0.5)
  assert.equal(controls.readProgress(), 0.5)
  player.advance(1000)
  assert.ok(controls.readProgress() > 0.5)
})

test('同じ日のシーク中もバー・ページの読み取り位置が一致し、停止状態で離せる', () => {
  const player = progressPlayback()
  let controls = player.update()
  controls.pb.seek(1, false, 0.1); controls = player.update()
  assert.equal(controls.startScrub(), false)
  controls = player.update()
  controls.scrubTo(0.65)
  controls = player.update()
  assert.equal(controls.readProgress(), 0.65)
  assert.equal(controls.page, 2)
  controls.finishScrub(0.65, false)
  controls = player.update()
  assert.equal(controls.pb.playing, false)
  assert.ok(Math.abs(controls.pb.offset - 0.95) < 0.000001)
  assert.equal(player.timerCount(), 0)
})

test('再生中にバーの右端で離すと、即座に終了状態になり1回でリプレイできる', () => {
  const player = progressPlayback()
  let controls = player.update()
  const resume = controls.startScrub()
  controls.finishScrub(1, resume)
  controls = player.update()
  assert.equal(controls.pb.playing, false)
  assert.equal(controls.pb.finished, true)
  assert.equal(controls.readProgress(), 1)
  assert.equal(player.timerCount(), 0)
  controls.pb.toggle()
  controls = player.update()
  assert.equal(controls.pb.index, 0)
  assert.equal(controls.pb.playing, true)
  assert.equal(controls.readProgress(), 0)
})

test('日の終わりの直前へシークしても、バーは進行タイマーと同時に区切りへ到達する', () => {
  const player = progressPlayback()
  let controls = player.update()
  controls.pb.seek(0, true, 0.999); controls = player.update()
  player.advance(5333 * (1 - 0.999))
  assert.ok(Math.abs(controls.readProgress() - 1 / 3) < 0.000001)
  assert.equal(player.update().pb.index, 1)
})

test('ドラッグ中に閉じて開き直しても、ドラッグ状態が残って図やバーを凍結しない', () => {
  const player = progressPlayback()
  let controls = player.update()
  controls.startScrub(); controls.scrubTo(0.4)
  assert.equal(player.update().scrubbing, true)
  player.visible(false); player.update()
  player.visible(true); controls = player.update()
  assert.equal(controls.scrubbing, false)
  assert.equal(controls.pb.playing, true)
  assert.equal(controls.readProgress(), 0)
})

test('途中へシークした状態で配線図が初めてマウントされても、指定位置から表示・再開する', () => {
  const { source, fn } = declaration('src/components/organisms/HistoryWiringCanvas.tsx', 'HistoryWiringCanvasInner')
  const clockSource = fn.getText(source).split('// ─── カメラ補間')[0]
  const state = runtime()
  const canvas = compile(`(${clockSource} return () => ({ clock: xRef.current, phase: tRef.current })\n})`, {
    ...state.bindings, NO_GLOW: new Set(), EASE: (x: number) => x, Animated: { Value: ProgressValue },
  })
  const seekRef = { current: null as ((x: number) => void) | null }
  const props = { layout: {}, animKey: '1-4', durationMs: 5000, startAt: 0.6, seekRef }
  const update = (frozen: boolean) => state.render(() => canvas({ ...props, frozen }))
  let progress = update(true)
  assert.equal(progress().clock, 0.6)
  assert.equal(progress().phase, 0.6)
  assert.equal(state.frameCount(), 0)
  progress = update(false)
  state.advance(500)
  assert.ok(Math.abs(progress().clock - 0.7) < 0.000001)
  update(true)
  seekRef.current!(0.2)
  progress = update(false)
  state.advance(500)
  assert.ok(Math.abs(progress().clock - 0.3) < 0.000001)
})

test('再生ボタンで止めた配線図は静止し、繰り返し再開しても現在の位置から進む', () => {
  const file = 'src/components/organisms/HistoryWiringCanvas.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'HistoryWiringCanvasInner')
  assert.ok(declaration)
  // 描画を動かす実際のクロックを、SVG・カメラの描画部分から切り離して実行する。
  const clockSource = declaration.getText(source).split('// ─── カメラ補間')[0]
  const state = runtime()
  const code = ts.transpileModule(`(${clockSource} return () => xRef.current\n})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const canvas = runInNewContext(code, {
    ...state.bindings, NO_GLOW: new Set(), EASE: (x: number) => x,
    Animated: { Value: class { constructor(_initial: number) {} setValue() {} } },
  })
  const modal = ts.createSourceFile('modal.tsx', readFileSync('src/components/organisms/DeskHistoryAnimationModal.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let freezeExpression: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(modal) === 'frozen' && node.initializer && ts.isJsxExpression(node.initializer)) {
      freezeExpression = node.initializer.expression
    }
    ts.forEachChild(node, visit)
  }
  visit(modal)
  assert.ok(freezeExpression)
  const frozen = runInNewContext(`(playing, scrubbing, heldAtScrub = false) => ${freezeExpression.getText(modal)}`)
  const props = { layout: {}, animKey: '0-1', durationMs: 5000, startAt: 0 }
  const update = (playing: boolean, scrubbing = false): (() => number) => state.render(() => canvas({ ...props, frozen: frozen(playing, scrubbing) }))
  let progress = update(true)
  for (let i = 0; i < 3; i++) {
    state.advance(500)
    const atPause = progress()
    progress = update(false)
    assert.equal(state.frameCount(), 0)
    state.advance(5000)
    assert.equal(progress(), atPause)
    progress = update(true)
    assert.equal(state.frameCount(), 1)
  }
  assert.ok(Math.abs(progress() - 0.3) < 0.000001)
  update(true, true)
  assert.equal(state.frameCount(), 0)
})

test('描画前に別の日から元の日へ戻ってさらに動かしても、最新の位置を描画する', () => {
  const player = progressPlayback()
  let controls = player.update()
  controls.startScrub(); controls = player.update()
  controls.scrubTo(0.4)
  controls.scrubTo(0.1)
  controls.scrubTo(0.2)
  controls = player.update()
  assert.equal(controls.pb.index, 0)
  assert.ok(Math.abs(controls.pb.offset - 0.6) < 0.000001)
  assert.equal(controls.readProgress(), 0.2)
})

test('ドラッグ終了直後に描画を待たず再び掴んでも、操作直前の再生状態を保つ', () => {
  const player = progressPlayback()
  let controls = player.update()
  const firstResume = controls.startScrub()
  controls = player.update()
  controls.finishScrub(0.4, firstResume)
  const secondResume = controls.startScrub()
  assert.equal(secondResume, true)
  controls.finishScrub(0.5, secondResume)
  assert.equal(player.update().pb.playing, true)
})

test('3倍速で演出の終盤へシークしても、残りの演出尺で最後まで描く', () => {
  const { source, fn } = declaration('src/components/organisms/HistoryWiringCanvas.tsx', 'HistoryWiringCanvasInner')
  const clockSource = fn.getText(source).split('// ─── カメラ補間')[0]
  const state = runtime()
  const canvas = compile(`(${clockSource} return () => xRef.current\n})`, {
    ...state.bindings, NO_GLOW: new Set(), EASE: (x: number) => x, Animated: { Value: ProgressValue },
  })
  const durationMs = 5180 / 3
  const progress = state.render(() => canvas({ layout: {}, animKey: '0-1', durationMs, startAt: 0.99 }))
  state.advance(durationMs * 0.01 + 1)
  assert.equal(progress(), 1)
  assert.equal(state.frameCount(), 0)
})

test('画面終了後に遅れたドラッグ通知が届いても、開き直した再生を凍結しない', () => {
  const player = progressPlayback()
  let controls = player.update()
  controls.startScrub(); controls.scrubTo(0.4)
  const stale = controls
  player.visible(false); player.update()
  stale.scrubTo(0.8)
  player.visible(true); controls = player.update()
  assert.equal(controls.scrubbing, false)
  assert.equal(controls.pb.playing, true)
  assert.equal(controls.readProgress(), 0)
  player.advance(100)
  assert.ok(controls.readProgress() > 0)
})

test('日境界の往復・端への飛び・停止を100回混ぜても、最後の位置と再生状態を保つ', () => {
  const player = progressPlayback()
  let controls = player.update()
  let seed = 12345
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let gesture = 0; gesture < 100; gesture++) {
    if (gesture % 3 === 0) { controls.pb.toggle(); controls = player.update() }
    const wasPlaying = controls.pb.playing
    const resume = controls.startScrub()
    assert.equal(resume, wasPlaying)
    for (let move = 0; move < 10; move++) {
      controls.scrubTo(random())
      if (random() < 0.3) controls = player.update()
    }
    const ratio = gesture % 5 === 0 ? 1 : gesture % 7 === 0 ? 0 : random()
    controls.finishScrub(ratio, resume)
    controls = player.update()
    const index = Math.min(2, Math.floor(ratio * 3))
    assert.equal(controls.pb.index, index)
    assert.ok(Math.abs(controls.pb.offset - (ratio * 3 - index)) < 0.000001)
    assert.ok(Math.abs(controls.readProgress() - ratio) < 0.000001)
    assert.equal(controls.pb.playing, wasPlaying && ratio < 1)
    assert.equal(controls.pb.finished, ratio === 1)
    assert.equal(controls.scrubbing, false)
    if (!controls.pb.playing) assert.equal(player.timerCount(), 0)
    player.advance(10)
    controls = player.update()
  }
})
