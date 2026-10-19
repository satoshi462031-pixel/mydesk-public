import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { resolveCoachSteps } from '../src/utils/coachMarkResolution'
import { measureCoachTarget } from '../src/utils/coachMarkMeasurement'
import type { CoachStep } from '../src/hooks/useCoachMarks'
import type { CoachRect } from '../src/utils/coachMarkLayout'
import { setupCoachStepsForRoute } from '../src/constants/setupCoachSteps'

function coachHarness(measureExternalTarget?: (id: string) => Promise<CoachRect | null>) {
  const source = ts.createSourceFile('coach.tsx', readFileSync('src/hooks/useCoachMarks.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useCoachMarks')!
  const slots: any[] = []
  let cursor = 0
  let focused = true
  let captures = 0
  let completeCapture: ((shot: any) => void) | undefined
  const released: string[] = []
  const effects: (() => void)[] = []
  const timers: (() => void)[] = []
  const jsx = (type: unknown, props: any) => ({ type, props })
  const render = runInNewContext(ts.transpileModule(`(${declaration.getText(source).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    require: () => ({ jsx, jsxs: jsx }), exports: {}, resolveCoachSteps, measureCoachTarget,
    ScreenAnnotationGuide: 'Guide', COACH_SCREEN: '__screen',
    useIsFocused: () => focused,
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
    useRef: (current: any) => { const i = cursor++; return slots[i] ??= { current } },
    useState: (initial: any) => {
      const i = cursor++
      if (!(i in slots)) slots[i] = initial
      return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next }]
    },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void, dependencies: unknown[]) => {
      const i = cursor++
      const previous = slots[i]
      // close は実際の useCallback では安定している。
      const values = dependencies.filter(value => typeof value !== 'function')
      if (previous && values.length === previous.values.length && values.every((value, j) => Object.is(value, previous.values[j]))) return
      effects.push(() => { previous?.cleanup?.(); slots[i] = { values, cleanup: fn() } })
    },
    Keyboard: { isVisible: () => false, dismiss() {} }, hapticLight() {},
    setTimeout: (fn: () => void) => { timers.push(fn) },
    captureCurrentScreen: () => { captures++; return new Promise(resolve => { completeCapture = resolve }) },
    releaseScreenCapture: async (uri: string) => { released.push(uri) },
  }) as (measure?: typeof measureExternalTarget) => any
  const paint = () => { cursor = 0; return render(measureExternalTarget) }
  const flushEffects = () => { while (effects.length) effects.shift()!() }
  paint(); flushEffects()
  return {
    paint, released, captures: () => captures,
    tick: async () => { while (timers.length) timers.shift()!(); await new Promise(resolve => setImmediate(resolve)) },
    capture: () => completeCapture!({ uri: `shot-${captures}`, width: 390, height: 844 }),
    blur: () => { focused = false; paint(); flushEffects() },
    unmount: () => { for (const slot of slots) slot?.cleanup?.() },
  }
}
const steps: CoachStep[] = [{ target: 'row', ja: '機材', en: 'Gear' }]
const node = (y: number) => ({ measureInWindow(callback: (...rect: number[]) => void) { callback(16, y, 358, 44) } })

test('同じIDの行を複数登録し、非表示の行の解除でも表示中の行を失わない', async () => {
  const state = coachHarness()
  const coach = state.paint()
  const first = coach.target('row')
  const last = coach.target('row')
  first(node(300)); last(node(900)); last(null)
  const opening = coach.open(steps)
  await state.tick(); state.capture(); await opening
  assert.equal(state.paint().overlay.props.steps[0].rect.y, 300)
  state.unmount()
  assert.deepEqual(state.released, ['shot-1'])
})

test('各カードのAnchorは独立して登録し、スクロール後も共通案内と所有者向け案内を表示中のカードへ向ける', async () => {
  const state = coachHarness()
  const ast = ts.createSourceFile('coach.tsx', readFileSync('src/hooks/useCoachMarks.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CoachAnchor')!
  const anchor = runInNewContext(ts.transpileModule(`(${component.getText(ast).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    useCoachTarget: (id?: string) => id ? state.paint().target(id) : undefined,
    useCallback: (fn: unknown) => fn,
    cloneElement: (child: any, props: any) => ({ ...child, props: { ...child.props, ...props } }),
  }) as (props: any) => any
  const first = anchor({ id: 'row', also: 'owned', children: { props: {} } })
  const second = anchor({ id: 'row', also: 'owned', children: { props: {} } })
  first.props.ref(node(900)); second.props.ref(node(300)); first.props.ref(null)
  assert.equal(second.props.collapsable, false)
  const opening = state.paint().open([...steps, { target: 'owned', ja: '自分の機材', en: 'Owned gear' }])
  await state.tick(); state.capture(); await opening
  assert.deepEqual(state.paint().overlay.props.steps.map((step: any) => step.rect.y), [300, 300])
  state.unmount()
})

test('？の連打と表示中の再実行は1回だけ撮影し、閉じて開き直すと再撮影する', async () => {
  const state = coachHarness()
  const coach = state.paint()
  coach.target('row')(node(300))
  const opening = coach.open(steps)
  await coach.open(steps)
  await state.tick(); state.capture(); await opening
  await state.paint().open(steps)
  assert.equal(state.captures(), 1)
  state.paint().close()
  assert.equal(state.paint().overlay, null)
  const reopened = state.paint().open(steps)
  await state.tick(); state.capture(); await reopened
  assert.equal(state.captures(), 2)
  state.paint().close()
  assert.deepEqual(state.released, ['shot-1', 'shot-2'])
})

test('撮影中に閉じる・画面から離れると遅い結果を表示せず、一時画像を解放する', async () => {
  for (const blur of [false, true]) {
    const state = coachHarness()
    const opening = state.paint().open(steps)
    await state.tick()
    if (blur) state.blur()
    else state.paint().close()
    state.capture(); await opening
    assert.equal(state.paint().overlay, null)
    assert.deepEqual(state.released, ['shot-1'])
    if (blur) { await state.paint().open(steps); assert.equal(state.captures(), 1) }
  }
})

test('測定前に画面を離れた場合は撮影せず終了する', async () => {
  const state = coachHarness()
  const opening = state.paint().open(steps)
  state.blur(); await state.tick(); await opening
  assert.equal(state.captures(), 0)
  assert.equal(state.paint().active, false)
})

test('作成画面の？もキーボードを閉じた後に領域とフッターを測り、見えている範囲全体を囲む', async () => {
  for (const [route, target] of [
    ['PurposeSelection', 'purpose-options'], ['TemplateDetail', 'gear-inputs'],
    ['GadgetSelection', 'gear-inputs'], ['DeskPlacement', 'layout-area'], ['PhotoFill', 'photo-area'],
  ]) {
    const measurements: string[] = []
    const state = coachHarness(async id => {
      measurements.push(id)
      return id === target ? { x: 0, y: 120, width: 390, height: 1000 }
        : id === 'setup-footer' ? { x: 0, y: 700, width: 390, height: 144 } : null
    })
    const opening = state.paint().open(setupCoachStepsForRoute(route))
    assert.equal(measurements.length, 0, '画面の安定を待ってから測定する')
    await state.tick(); state.capture(); await opening
    assert.ok(measurements.includes(target) && measurements.includes('setup-footer'))
    const guide = state.paint().overlay
    assert.equal(guide.props.steps.length, 1)
    assert.deepEqual(guide.props.steps[0].rect, { x: 0, y: 120, width: 390, height: 580 }, route)
    state.unmount()
  }
})

test('？の外部対象が未描画なら、無関係な場所を囲まない', async () => {
  const state = coachHarness(async () => null)
  const opening = state.paint().open(setupCoachStepsForRoute('TemplateDetail'))
  await state.tick(); state.capture(); await opening
  assert.equal(state.paint().overlay.props.steps.length, 0)
  state.unmount()
})
