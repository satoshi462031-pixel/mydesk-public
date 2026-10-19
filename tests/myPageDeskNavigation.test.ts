import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { CommonActions, StackRouter } from '@react-navigation/routers'
import ts from 'typescript'
import { backToSetupStep, openGearStep, resumeSetupStep } from '../src/navigation/setupStepNavigation'
import { firstSetupResumeNavigation, type FirstSetupDraft } from '../src/utils/firstSetupResume'

function source(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function evaluate(node: ts.Node, parsed: ts.SourceFile, bindings: Record<string, unknown>) {
  return runInNewContext(ts.transpileModule(node.getText(parsed), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, bindings)
}

function stack(root: 'MyPage' | 'PlanList') {
  const parsed = source('src/navigation/RootNavigator.tsx')
  const tag = root === 'MyPage' ? 'MyPageStack.Screen' : 'PlanStack.Screen'
  const routeNames: string[] = []
  const visit = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(parsed) === tag) {
      for (const prop of node.attributes.properties) {
        if (ts.isJsxAttribute(prop) && prop.name.getText(parsed) === 'name' && prop.initializer && ts.isStringLiteral(prop.initializer)) {
          routeNames.push(prop.initializer.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  const router = StackRouter({ initialRouteName: root })
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} }
  let state = router.getInitialState(options)
  const apply = (action: Parameters<typeof router.getStateForAction>[1]) => {
    const next = router.getStateForAction(state, action, options)
    assert.ok(next, `Unhandled ${action.type} from ${root}`)
    state = router.getRehydratedState(next, options)
  }
  const navigation = {
    isFocused: () => true,
    getState: () => state,
    navigate: (target: { name: string; params?: object }) => apply(CommonActions.navigate(target)),
    reset: (next: Parameters<typeof CommonActions.reset>[0]) => apply(CommonActions.reset(next)),
    goBack: () => apply(CommonActions.goBack()),
  }
  return { navigation, state: () => state, top: () => state.routes[state.index] }
}

const drafts: FirstSetupDraft[] = [
  { screen: 'PurposeSelection', purposes: ['work'] },
  { screen: 'TemplateDetail', templateId: 'sample', purposes: ['work'] },
  ...(['GadgetSelection', 'DeskPlacement', 'PhotoFill', 'WiringResult'] as const)
    .map(screen => ({ screen, planId: 'desk' })),
]

test('マイページの作成途中デスクは全段階から同じ一覧へ戻る', () => {
  const parsed = source('src/screens/PublishedDeskListScreen.tsx')
  let callback: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'resumeSetup'
      && node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  assert.ok(callback)
  for (const draft of drafts) {
    const h = stack('MyPage')
    const rootKey = h.top().key
    const resume = evaluate(callback, parsed, { navigation: h.navigation, firstSetupResumeNavigation }) as (draft: FirstSetupDraft) => void
    resume(draft)
    assert.equal(h.top().name, draft.screen)
    h.navigation.goBack()
    assert.equal(h.top().name, 'MyPage')
    assert.equal(h.top().key, rootKey)
  }
})

test('進捗バーの戻る・用途変更・機材の再開で元の一覧を保持する', () => {
  for (const root of ['MyPage', 'PlanList'] as const) {
    const h = stack(root)
    const rootKey = h.top().key
    h.navigation.navigate({ name: 'PhotoFill', params: { planId: 'desk', fromSetup: true } })
    backToSetupStep(h.navigation as never, 'PurposeSelection', { initialPurposes: ['work'] })
    assert.equal(h.top().name, 'PurposeSelection')
    resumeSetupStep(h.navigation as never, { step: 2, name: 'DeskPlacement', params: { planId: 'desk' } }, { purposes: ['work'] })
    assert.equal(h.top().name, 'DeskPlacement')
    openGearStep(h.navigation as never, { id: 'desk', selectedGadgetIds: [], purposes: ['work'] }, [], 'back')
    assert.equal(h.top().name, 'TemplateDetail')
    h.navigation.goBack()
    assert.equal(h.top().name, root)
    assert.equal(h.top().key, rootKey)
  }
})

test('機材の確定後も作成画面を取り除き、開いた一覧へ戻る', () => {
  for (const file of ['src/screens/TemplateDetailScreen.tsx', 'src/screens/GadgetSelectionScreen.tsx']) {
    const parsed = source(file)
    const resets: ts.CallExpression[] = []
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'navigation.reset') resets.push(node)
      ts.forEachChild(node, visit)
    }
    visit(parsed)
    assert.ok(resets.length > 0)
    for (const reset of resets) for (const root of ['MyPage', 'PlanList'] as const) for (const needsPhotos of [false, true]) {
      const h = stack(root)
      const rootKey = h.top().key
      h.navigation.navigate({ name: 'PurposeSelection' })
      h.navigation.navigate({ name: 'TemplateDetail', params: { templateId: 'sample', purposes: ['work'] } })
      evaluate(reset, parsed, { navigation: h.navigation, root: h.state().routes[0], planId: 'desk', needsPhotos })
      assert.equal(h.state().routes.length, 2)
      assert.ok(['DeskPlacement', 'PhotoFill', 'WiringResult'].includes(h.top().name))
      assert.equal((h.top().params as { planId: string }).planId, 'desk')
      h.navigation.goBack()
      assert.equal(h.top().name, root)
      assert.equal(h.top().key, rootKey)
    }
  }
})
