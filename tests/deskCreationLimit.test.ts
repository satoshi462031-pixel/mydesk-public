import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { PLAN_LIMITS } from '../src/constants/plans'
import type { DeskPlan } from '../src/types'
import { compositionFromPlan, compositionTemplateId } from '../src/utils/deskComposition'
import { firstSetupResumeNavigation, resolveFirstSetupDraft, type FirstSetupDraft } from '../src/utils/firstSetupResume'

const source = ts.transpileModule(readFileSync('src/hooks/useEntitlement.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function entitlement(tier: 'free' | 'pro', isLoading: boolean) {
  const exported: Record<string, any> = {}
  runInNewContext(source, {
    exports: exported,
    require: (id: string) => {
      if (id === 'react') return { useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn() }
      if (id.endsWith('/plans')) return { PLAN_LIMITS }
      if (id.endsWith('/SubscriptionContext')) return { useSubscription: () => ({ tier, isLoading, isPro: tier === 'pro' }) }
      throw new Error(id)
    },
  })
  return exported.useEntitlement()
}

test('課金状態の確認中はPro利用者を誤って購入画面へ送らない暫定表示を保つ', () => {
  const free = entitlement('free', true)
  assert.equal(free.getLimit('maxWiringPlans'), -1)
  assert.equal(free.checkLimit('maxWiringPlans', 3), true)
  const pro = entitlement('pro', true)
  assert.equal(pro.getLimit('maxWiringPlans'), -1)
  assert.equal(pro.checkLimit('maxWiringPlans', 7), true)
  assert.equal(entitlement('free', false).getLimit('maxWiringPlans'), 3)
})

function callback(file: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      found = ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, name)
  return runInNewContext(ts.transpileModule(`(${found.getText(source).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { Error, ...bindings }) as (...args: any[]) => any
}

const plan = (id: string, complete = false): DeskPlan => ({
  id, name: id, goal: 'first_setup', selectedGadgetIds: [], placements: [],
  createdAt: '2026-10-19', updatedAt: '2026-10-19',
  ...(complete ? { wiringResult: { connections: [], requiredCables: [], warnings: [] } } : {}),
})
const noop = () => {}

function guard() {
  const state = { plans: [] as DeskPlan[], draft: null as FirstSetupDraft | null,
    focused: true, loading: false, loadError: false, read: Promise.resolve() }
  const refs: any[] = []
  let cursor = 0
  const alerts: any[][] = []
  const navigations: any[][] = []
  const render = callback('src/hooks/useDeskSetupGuard.ts', 'useDeskSetupGuard', {
    useApp: () => ({ lang: 'ja' }), usePlans: () => state, useGadgets: () => ({ gadgets: [] }),
    useRef: (current: unknown) => { const index = cursor++; return refs[index] ??= { current } },
    useCallback: (run: unknown) => run,
    loadFirstSetupDraft: async () => { await state.read; return state.draft },
    resolveFirstSetupDraft, firstSetupResumeNavigation, compositionFromPlan, compositionTemplateId,
    Alert: { alert: (...args: any[]) => alerts.push(args) },
    openInTabFromRoot: (...args: any[]) => navigations.push(args),
  })
  const navigation = { isFocused: () => state.focused }
  return { state, alerts, navigations, render: () => { cursor = 0; return render(navigation) as () => Promise<boolean> } }
}

test('未完成デスクがあれば複製・参考作成を止め、確認後に同じデスクの機材の段へ戻す', async () => {
  const h = guard()
  h.state.plans = [plan('unfinished')]
  assert.equal(await h.render()(), false)
  assert.equal(h.navigations.length, 0)
  h.alerts[0][2][1].onPress()
  assert.equal(h.navigations[0][2], 'TemplateDetail')
  assert.equal(h.navigations[0][3].returnPlanId, 'unfinished')
})

test('デスク本体がまだない機材入力中の下書きも上書きせず、その段から再開できる', async () => {
  const h = guard()
  h.state.draft = { screen: 'TemplateDetail', templateId: 'composition', purposes: ['work'] }
  assert.equal(await h.render()(), false)
  h.alerts[0][2][1].onPress()
  assert.equal(h.navigations[0][2], 'TemplateDetail')
  assert.equal(h.navigations[0][3].templateId, 'composition')
  assert.equal(h.state.draft.templateId, 'composition')
})

test('完成したデスクと共有デスクだけなら新規作成を許可し、読み込み中・失敗時は止める', async () => {
  const h = guard()
  h.state.plans = [plan('completed', true), { ...plan('shared'), isShared: true }]
  assert.equal(await h.render()(), true)
  for (const key of ['loading', 'loadError'] as const) {
    h.state[key] = true
    assert.equal(await h.render()(), false)
    h.state[key] = false
  }
  assert.equal(h.navigations.length, 0)
})

test('下書きの読込中の連打を止め、読込中に増えた未完成デスクも最新状態で検出する', async () => {
  const h = guard()
  let release!: () => void
  h.state.read = new Promise<void>(resolve => { release = resolve })
  const check = h.render()
  const pending = check()
  assert.equal(await check(), false)
  h.state.plans = [plan('new')]
  h.render()
  release()
  assert.equal(await pending, false)
  assert.equal(h.alerts.length, 1)
})

test('読込中に画面を離れたら、遅い確認や画面遷移を出さない', async () => {
  const h = guard()
  h.state.plans = [plan('unfinished')]
  const pending = h.render()()
  h.state.focused = false
  assert.equal(await pending, false)
  assert.equal(h.alerts.length, 0)
  assert.equal(h.navigations.length, 0)
})

test('確認を閉じるまでは連打でダイアログを重ねず、キャンセル後は再度確認できる', async () => {
  const h = guard()
  h.state.plans = [plan('unfinished')]
  const check = h.render()
  await check()
  await check()
  assert.equal(h.alerts.length, 1)
  h.alerts[0][2][0].onPress()
  await check()
  assert.equal(h.alerts.length, 2)
  h.alerts[1][3].onDismiss()
  h.state.plans = [plan('unfinished', true)]
  h.render()
  assert.equal(await check(), true)
})

test('公開デスクを参考に作成する入口は、途中確認が済むまで下書きと画面を変更しない', async () => {
  for (const allowed of [false, true]) {
    const navigations: any[][] = []
    let builds = 0
    const start = callback('src/screens/PublicDeskScreen.tsx', 'startDeskCopy', {
      desk: { title: '公開デスク', owner_name: '投稿者' }, deskId: 'public',
      model: { plan: {}, selectedGadgets: [] }, myAllPlans: [], lang: 'ja', navigation: { isFocused: () => true },
      ensureNoUnfinishedSetup: async () => allowed, checkLimit: () => true,
      buildDeskCopySource: () => { builds++; return { purposes: ['work'] } },
      openInTabFromRoot: (...args: any[]) => navigations.push(args),
    })
    await start()
    assert.equal(builds, Number(allowed))
    assert.equal(navigations.length, Number(allowed))
    if (allowed) assert.equal(navigations[0][2], 'PurposeSelection')
  }
})

test('複製の途中確認が連打されてもコピーを作らず、完成後は再び複製できる', async () => {
  let allowed = false
  let copies = 0
  const duplicate = callback('src/hooks/useDeskActions.ts', 'duplicate', {
    duplicatingPlanIdsRef: { current: new Set() }, onBeforeAction: noop,
    ensureNoUnfinishedSetup: async () => allowed, checkLimit: () => true, ownPlanCount: 1, navigation: { isFocused: () => true },
    uuidv4: () => 'copy', duplicatePlanSlots: (original: DeskPlan) => ({ plan: original, slots: [] }),
    gadgets: [], lang: 'ja', trimAndTruncate: (name: string) => name,
    duplicatePlanImages: async () => [], add: async (_plan: DeskPlan, beforeAdd: () => Promise<void>) => { await beforeAdd(); copies++ },
    analytics: { error: (_name: string, error: unknown) => { throw error } },
  })
  await Promise.all([duplicate(plan('original', true)), duplicate(plan('original', true))])
  assert.equal(copies, 0)
  allowed = true
  await duplicate(plan('original', true))
  assert.equal(copies, 1)
})

test('旧版の未完成が複数ある場合、1件を破棄しても新規作成せず残りのデスクを案内する', async () => {
  const plans = [plan('legacy-a'), plan('legacy-b'), plan('done', true)]
  const removed: string[] = []
  const resumed: FirstSetupDraft[] = []
  const discard = callback('src/screens/PlanListScreen.tsx', 'discardSetupAndBeginCreate', {
    discardingSetupRef: { current: false }, myPlans: plans, plans, gadgets: [],
    checkLimit: () => true, orphanPlaceholders: () => [],
    remove: async (id: string) => { removed.push(id) }, deletePlanImages: async () => {},
    AsyncStorage: { removeItem: async () => {} }, clearProductFillDraft: async () => {},
    clearTemplateDetailDraft: noop, takeAbandonedTemplateDraftGadgets: async () => [],
    setSetupDraft: noop, clearFirstSetupDraft: async () => {}, resolveFirstSetupDraft,
    resumeFirstSetup: (draft: FirstSetupDraft) => resumed.push(draft),
    navigation: { isFocused: () => true, navigate: () => assert.fail('未完成が残っているのに新しく作り始めた') },
    analytics: { error: (_name: string, error: unknown) => { throw error } },
  })
  await discard({ screen: 'DeskPlacement', planId: 'legacy-a' })
  assert.deepEqual(removed, ['legacy-a'])
  assert.equal(resumed.length, 1)
  assert.equal('planId' in resumed[0] && resumed[0].planId, 'legacy-b')
})
