import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { SPOTLIGHT_STEPS, isStepOnRoute } from '../src/constants/spotlightSteps'
import { setupCoachStepsForRoute } from '../src/constants/setupCoachSteps'

function help(route: string, running: boolean, stepIndex: number) {
  const ast = ts.createSourceFile('help.tsx', readFileSync('src/components/molecules/SetupScreenHelp.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'SetupScreenHelp')!
  const events: string[] = []
  const measured: string[] = []
  let options: any
  let steps: any
  let measure: (id: string) => Promise<unknown>
  const render = runInNewContext(ts.transpileModule(`(${component.getText(ast).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    require: () => ({ jsx: (type: unknown, props: any) => ({ type, props }), jsxs: (type: unknown, props: any) => ({ type, props }) }), exports: {},
    useNavigation: () => ({ setOptions: (next: unknown) => { options = next } }),
    useRoute: () => ({ name: route }), useApp: () => ({ colors: {}, lang: 'ja' }),
    useSpotlight: () => ({ running, stepIndex, acknowledge: () => events.push('acknowledge') }),
    useSpotlightRegistry: () => ({ measureTarget: async (id: string) => { measured.push(id); return null } }),
    useCallback: (fn: unknown) => fn, useLayoutEffect: (fn: () => void) => fn(),
    useCoachMarks: (external: typeof measure) => {
      measure = external
      return { overlay: 'manual guide', open: async (next: unknown) => { events.push('open'); steps = next } }
    },
    HeaderIconButton: 'HeaderIconButton', CoachScope: 'CoachScope', SPOTLIGHT_STEPS, isStepOnRoute, setupCoachStepsForRoute,
  }) as () => any
  assert.equal(render().props.children[1], 'manual guide')
  return { events, measured, open: () => options.headerRight().props.onPress(), steps: () => steps,
    measure: (id: string) => measure(id) }
}

test('初回ガイドが終了済みでも、各作成画面の？から該当領域の説明を確認できる', async () => {
  for (const [route, target] of [
    ['PurposeSelection', 'purpose-options'], ['TemplateDetail', 'gear-inputs'],
    ['GadgetSelection', 'gear-inputs'], ['DeskPlacement', 'layout-area'], ['PhotoFill', 'photo-area'],
  ]) {
    const state = help(route, false, 0)
    state.open()
    assert.deepEqual(state.events, ['open'], '初回ガイドの進捗を変更せず、手動ガイドだけを開く')
    assert.equal(state.steps()[0].target, target)
    await state.measure(target)
    assert.deepEqual(state.measured, [target], '初回ガイドと同じ対象を測定する')
  }
})

test('初回ガイドの表示待ち中でも、？の撮影前にその画面の説明を閉じる', () => {
  const state = help('TemplateDetail', true, 1)
  state.open()
  assert.deepEqual(state.events, ['acknowledge', 'open'])
  const transitioning = help('TemplateDetail', true, 0)
  transitioning.open()
  assert.deepEqual(transitioning.events, ['open'], '遷移前の別画面の説明を既読にしない')
})
