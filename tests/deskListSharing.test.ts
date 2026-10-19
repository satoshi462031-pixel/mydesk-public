import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { DeskPlan, Gadget } from '../src/types'
import { publishGadgetIssue } from '../src/utils/publishRequirements'
import { sumDeviceQuantities, sumGadgetPrices } from '../src/utils/gadgetStats'
import { compositionFromPlan, compositionTemplateId } from '../src/utils/deskComposition'
import { ownShareTag } from '../src/utils/publicAuthor'
import { immediateRemoval } from './helpers/removalMotion'

function expression(file: string, name: string, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) {
      found = ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source) === 'useCallback'
        ? node.initializer.arguments[0] : node.initializer
    }
    if (name === 'renderItem' && ts.isJsxAttribute(node) && node.name.getText(source) === name
      && node.initializer && ts.isJsxExpression(node.initializer)) found = node.initializer.expression
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, name)
  const code = ts.transpileModule(`(${found.getText(source).replace(/^export\s+/, '')})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText
  const jsx = (type: unknown, props: any) => ({ type, props })
  return runInNewContext(code, { exports: {}, require: () => ({ jsx, jsxs: jsx }), removal: immediateRemoval, RemovalMotion: 'RemovalMotion', removeWithMotion: undefined, ...bindings }) as (...args: any[]) => any
}

function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value?.props) return []
  return [value, ...nodes(value.props.children)]
}

const plan = {
  id: 'plan-1', name: 'デスク', selectedGadgetIds: ['monitor', 'missing'],
  images: ['photo.jpg'], purposes: ['work'], createdAt: '2026-10-01', updatedAt: '2026-10-10',
} as DeskPlan
const gadgets: Gadget[] = [{
  id: 'monitor', name: 'Monitor', category: 'Monitor', ports: [],
  price: 10000, quantity: 2, createdAt: '2026-10-01',
}]
const noop = () => {}

function sharing(options: { visibility?: string | null; guest?: boolean; photos?: string[] } = {}) {
  const slots: any[] = []
  let cursor = 0
  const calls: Record<string, any[]> = { share: [], publish: [], wiring: [], login: [], photo: [], gadget: [], navigate: [] }
  const currentPlan = { ...plan, images: options.photos ?? plan.images }
  let publishStates: Record<string, string> = {}
  const visibility = options.visibility ?? null
  const run = expression('src/hooks/useDeskSharing.tsx', 'useDeskSharing', {
    useState: (initial: unknown) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef: (initial: unknown) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback: (fn: unknown) => fn,
    useApp: () => ({ colors: {}, lang: 'ja', fmtPrice: String }),
    useAuth: () => ({ user: options.guest ? null : { id: 'me' }, profile: { public_tag: 'owner' } }),
    usePlans: () => ({ plans: [currentPlan], updateWith: noop }),
    useGadgets: () => ({ gadgets }),
    usePublicNameGate: () => ({ run: (fn: () => void) => fn(), gateProps: {} }),
    PublishModal: 'PublishModal', PublicNameGateModal: 'PublicNameGateModal',
    getPublishedDeskId: async () => visibility ? 'desk-1' : null,
    getPublishedVisibility: async () => visibility,
    publishStateOf: (value: string) => value,
    isOutdatedPublishState: () => false,
    shareDesk: async (...args: any[]) => { calls.share.push(args) },
    publishPlan: async (...args: any[]) => { calls.publish.push(args); return 'desk-1' },
    saveFreshWiring: async (...args: any[]) => {
      calls.wiring.push(args)
      return { ...currentPlan, wiringResult: { connections: [], requiredCables: [], warnings: [] } }
    },
    getPublicNickname: async () => '投稿者',
    ownShareTag,
    publishGadgetIssue, sumDeviceQuantities, sumGadgetPrices,
    promptLogin: (...args: any[]) => calls.login.push(args),
    promptPhotoRequired: (...args: any[]) => calls.photo.push(args),
    promptGadgetRequired: (...args: any[]) => calls.gadget.push(args),
    hapticSuccess: noop, hapticError: noop,
    withTimeout: (work: Promise<unknown>) => work, PUBLISH_TIMEOUT_MS: 1000,
    Alert: { alert: noop },
  })
  const navigation = { isFocused: () => true, navigate: (...args: any[]) => calls.navigate.push(args) }
  const render = () => {
    cursor = 0
    return run({ navigation, publishStates, setPublishStates: (next: any) => { publishStates = next(publishStates) } })
  }
  const modal = () => nodes(render().modals).find((node) => node.type === 'PublishModal').props
  return { calls, render, modal, plan: currentPlan, states: () => publishStates }
}

test('未公開デスクの共有は確認を出し、承認後に最新の配線で公開する', async () => {
  const flow = sharing()
  await flow.render().handleShare(flow.plan)
  assert.equal(flow.modal().visible, true)
  assert.equal(flow.calls.publish.length, 0)
  assert.equal(flow.modal().gadgetCount, 2)
  assert.equal(flow.modal().totalPrice, sumGadgetPrices(gadgets))
  flow.modal().onPublish('unlisted')
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(flow.calls.wiring.length, 1)
  assert.equal(flow.calls.publish.length, 1)
  assert.ok(flow.calls.publish[0][0].wiringResult)
  assert.equal(flow.calls.publish[0][4].visibility, 'unlisted')
  assert.equal(flow.states()['plan-1'], 'unlisted')
  assert.equal(flow.modal().state, 'done')
})

test('公開済み・URL限定デスクは公開し直さずリンクと写真を共有する', async () => {
  for (const visibility of ['public', 'unlisted']) {
    const flow = sharing({ visibility })
    await flow.render().handleShare(flow.plan)
    assert.equal(flow.calls.publish.length, 0)
    assert.equal(flow.modal().visible, false)
    assert.equal(flow.calls.share.length, 1)
    const payload = flow.calls.share[0][0]
    assert.equal(payload.deskId, 'desk-1')
    assert.equal(payload.ownerTag, 'owner')
    assert.equal(payload.deviceCount, 2)
    assert.deepEqual(payload.photoUris, ['photo.jpg'])
  }
})

test('共有の連打で共有シートを重ねず、非公開のデスクは公開確認へ進む', async () => {
  const flow = sharing({ visibility: 'public' })
  const controller = flow.render()
  await Promise.all([controller.handleShare(flow.plan), controller.handleShare(flow.plan)])
  assert.equal(flow.calls.share.length, 1)
  const privateFlow = sharing({ visibility: 'private' })
  await privateFlow.render().handleShare(privateFlow.plan)
  assert.equal(privateFlow.modal().visible, true)
  assert.equal(privateFlow.calls.share.length, 0)
})

test('ゲスト・写真不足・未記入の機材は公開せず必要な入力へ案内する', async () => {
  const guest = sharing({ guest: true })
  await guest.render().handleShare(guest.plan)
  assert.equal(guest.calls.login.length, 1)
  assert.equal(guest.modal().visible, false)
  const missingPhoto = sharing({ photos: [] })
  await missingPhoto.render().handleShare(missingPhoto.plan)
  assert.equal(missingPhoto.calls.photo.length, 1)
  missingPhoto.calls.photo[0][2]()
  assert.equal(missingPhoto.calls.navigate[0][0], 'PhotoFill')
  assert.equal(missingPhoto.calls.navigate[0][1].planId, 'plan-1')
  const missingGear = sharing()
  await missingGear.render().handleShare({ ...missingGear.plan, selectedGadgetIds: [] })
  assert.equal(missingGear.calls.gadget.length, 1)
  assert.equal(missingGear.calls.publish.length, 0)
})

test('マイページの未公開デスクにも共有と再開を出し、別端末の非公開デスクには出さない', () => {
  const screen = 'src/screens/PublishedDeskListScreen.tsx'
  const shareByKey = noop
  const openDesk = noop
  const render = expression(screen, 'renderItem', {
    planById: new Map([[plan.id, plan]]), ownPlanOf: (row: any) => row.planId === plan.id ? plan : undefined,
    setupDraft: null, setupDraftRowKey: noop, publishStates: { 'plan-1': 'none' },
    isOpenRow: (row: any) => !!row.deskId && ['public', 'unlisted'].includes(row.visibility),
    publishStateOf: (visibility: string | null) => visibility ?? 'none',
    DeskGridTile: 'DeskGridTile', CoachAnchor: 'CoachAnchor', SwipeableRow: 'Swipeable', SwipeCommitRow: 'SwipeCommitRow', View: 'View',
    ICONS: { share: 'share' }, lang: 'ja', ja: true, t: String, fmtPrice: String, C: {}, isDark: false,
    styles: {}, changeByPlanId: new Map(), reactionByDeskId: new Map(), reactionSummary: noop,
    busyKey: null, openDesk, startRename: noop, handleActions: noop, shareByKey,
    cardTarget: noop, firstOwnCardTarget: noop, swipeableRefs: { current: new Map() },
    deskActions: {}, SWIPEABLE_ROW_PROPS: {}, SWIPE_OPEN_THRESHOLD: 40, formatDate: String,
  })
  const row = { key: 'plan-plan-1', planId: plan.id, name: plan.name, deskId: null, visibility: null }
  const local = nodes(render({ item: row, index: 0 })).find((node) => node.type === 'DeskGridTile')!.props
  assert.equal(local.actionIcon, 'share')
  assert.equal(local.onAction, shareByKey)
  assert.equal(local.footerLabel, '作成を続ける')
  assert.equal(local.onFooter, openDesk)
  assert.equal(local.updatedAt, plan.updatedAt)
  const second = nodes(render({ item: row, index: 2 })).find(node => node.type === 'CoachAnchor')
  assert.equal(second?.props.id, 'mypage-desk')
  assert.equal(second?.props.also, 'mypage-desk-own', '先頭以外の手元のデスクにもスワイプの説明を付ける')
  const remote = nodes(render({ item: { ...row, planId: null, deskId: 'remote', visibility: 'private' }, index: 1 }))
    .find((node) => node.type === 'DeskGridTile')!.props
  assert.equal(remote.onAction, undefined)
  assert.equal(typeof remote.onMenu, 'function')
})

test('マイページから未完成デスクを開くと機材の段へ進み、完成済みなら詳細を開く', () => {
  const edited = { ...plan }
  const calls: any[][] = []
  const opened: any[][] = []
  const run = expression('src/screens/PublishedDeskListScreen.tsx', 'openDesk', {
    lang: 'ja',
    rowsRef: { current: [{ key: 'plan-plan-1', planId: 'plan-1' }] },
    setupDraftRef: { current: null }, plansRef: { current: [edited] }, gadgetsRef: { current: gadgets },
    markPlanOpenedAt: async (...args: any[]) => { opened.push(args) },
    navigation: { isFocused: () => true, navigate: (...args: any[]) => calls.push(args) },
    compositionFromPlan, compositionTemplateId,
  })
  run('plan-plan-1')
  assert.equal(calls[0][0], 'TemplateDetail')
  assert.equal(calls[0][1].returnPlanId, plan.id)
  assert.equal(calls[0][1].composition.length, 1)
  assert.equal(calls[0][1].composition[0].category, 'Monitor')
  assert.equal(opened[0][0], plan.id)
  edited.wiringResult = { connections: [], requiredCables: [], warnings: [] }
  run('plan-plan-1')
  assert.equal(calls[1][0], 'WiringResult')
  assert.equal(calls[1][1].planId, plan.id)
})

test('マイページの共有ボタンは未公開のローカルデスクを共通フローへ渡す', async () => {
  const requests: unknown[] = []
  let closed = 0
  const run = expression('src/screens/PublishedDeskListScreen.tsx', 'shareByKey', {
    rowsRef: { current: [{ key: 'plan-plan-1', planId: plan.id, deskId: null }] },
    plansRef: { current: [plan] }, gadgetsRef: { current: gadgets },
    swipeableRefs: { current: new Map([['plan-plan-1', { close: () => { closed++ } }]]) },
    handleShareRef: { current: async (value: unknown) => { requests.push(value) } },
  })
  run('plan-plan-1')
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(requests[0], plan)
  assert.equal(closed, 1)
})

test('作成途中の破棄は確認後に行い、Undoで再開位置と機材の下書きを戻す', async () => {
  const draft = { screen: 'TemplateDetail', templateId: 'sample', purposes: ['work'] }
  const templateDraft = { templateId: 'sample', slots: [] }
  let buttons: any[] = []
  let undo: any
  const changes: unknown[] = []
  const saved: unknown[] = []
  let cleared = 0
  const run = expression('src/hooks/useDeskActions.ts', 'confirmDiscardSetup', {
    lang: 'ja', Alert: { alert: (_title: string, _message: string, options: any[]) => { buttons = options } },
    peekTemplateDetailDraft: () => templateDraft,
    clearTemplateDetailDraft: () => { cleared++ },
    clearFirstSetupDraft: async () => { cleared++ },
    saveTemplateDetailDraft: (value: unknown) => saved.push(value),
    saveFirstSetupDraft: async (value: unknown) => { saved.push(value) },
    hapticWarning: noop, undoSnackbar: { showUndo: (value: unknown) => { undo = value } },
  })
  run(draft, (value: unknown) => changes.push(value))
  assert.equal(cleared, 0)
  buttons.find((button) => button.style === 'destructive').onPress()
  assert.equal(cleared, 2)
  assert.equal(changes[0], null)
  await undo.onUndo()
  assert.equal(saved[0], templateDraft)
  assert.equal(saved[1], draft)
  assert.equal(changes[1], draft)
})
