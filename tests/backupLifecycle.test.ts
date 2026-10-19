import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as reconcile from '../src/utils/accountDataReconcile'
import * as repair from '../src/utils/storedDataRepair'
import { localUserDataKeys } from '../src/utils/localUserDataKeys'
import { utf8ByteLength } from '../src/utils/utf8ByteLength'
import { ACCENT_PRESETS } from '../src/constants/accentColors'
import { withTimeout } from '../src/utils/networkError'
import { sortConversationsByRecent } from '../src/store/conversationStore'
import * as firstSetupResume from '../src/utils/firstSetupResume'
import { generateWiring } from '../src/utils/wiringEngine'
import { reconcileMap } from '../src/utils/connectionMapLayout'
import { applyDeskGadgetUsage, setDeskGadgetUsage, updateDeskGadgetSelection } from '../src/utils/deskGadgetUsage'
import { buildTimeline, resolveTimelineLayout } from '../src/utils/deskTimeline'
import * as portMigration from '../src/utils/portTypeMigration'
import * as portRoles from '../src/utils/portRoles'
import * as gadgetTrash from '../src/utils/gadgetTrash'
import { trimAndTruncate, trimInvisible, tidyMultilineText, truncateChars } from '../src/utils/truncateText'
import { parseDateInput } from '../src/utils/dateFormat'
import { DESK_TEMPLATES } from '../src/constants/deskTemplates'
import { CATEGORY_SELECTION_ORDER } from '../src/constants/categoryOrder'
import { defaultZoneForCategory } from '../src/constants/categoryZones'
import { PURPOSE_GADGETS } from '../src/constants/purposeGadgets'
import { applyTemplate, buildTemplateItems, defaultConnTypeForSlot, defaultTemplateSpec, withSpecArms } from '../src/services/templateService'
import { applyProductToGadget } from '../src/utils/productFill'
import { GADGET_NAME_MAX_LENGTH } from '../src/constants/textLimits'
import { openGearStep } from '../src/navigation/setupStepNavigation'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function payload(id = 'restored'): any {
  return {
    app: 'MyDesk', version: 5, exportedAt: '2026-09-01T00:00:00Z',
    gadgets: [{ id, name: id, category: 'Monitor', ports: [], createdAt: '2026-01-01T00:00:00Z' }],
    folders: [], plans: [], aiConversations: [],
  }
}

function screenValue(screen: string, name: string, bindings: Record<string, any>) {
  const file = `src/screens/${screen}Screen.tsx`
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      const init = node.initializer
      found = ts.isCallExpression(init) && ['useMemo', 'useCallback'].includes(init.expression.getText(ast)) ? init.arguments[0] : init
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && (
      (name === 'saveInputs' && node.arguments[0]?.getText(ast).includes('saveTemplateDetailDraft('))
      || (name === 'savePurpose' && node.arguments[0]?.getText(ast).includes('void saveFirstSetupDraft('))
      || (name === 'clearSetup' && node.arguments[0]?.getText(ast).includes('return clearFirstSetupDraft()'))
    )) found = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found, `${screen}: ${name}`)
  return runInNewContext(ts.transpileModule(`(${found.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, { Date, ...bindings }) as any
}

async function completeRestoredPlan(h: ReturnType<typeof harness>, planId: string) {
  const readPlans = () => JSON.parse(h.store.get('@desk_plans') ?? '[]')
  const getPlan = () => readPlans().find((plan: any) => plan.id === planId)
  const destinations: any[][] = []
  const noop = () => {}
  const updateWith = async (_id: string, update: (previous: any) => any) => {
    h.store.set('@desk_plans', JSON.stringify(readPlans().map((plan: any) => plan.id === planId ? update(plan) : plan)))
  }
  const bindings: any = {
    planId, plan: getPlan(), gadgets: JSON.parse(h.store.get('@desk_gadgets') ?? '[]'), lang: 'ja', ja: true,
    navigation: { isFocused: () => true, replace: (...args: any[]) => destinations.push(args) },
    nodeOffsets: getPlan().connectionMap?.nodeOffsets ?? {}, generationInFlightRef: { current: false },
    setGenerating: noop, setGenerationError: (failed: boolean) => assert.equal(failed, false), setGenerationStep: noop,
    pauseForPaint: async () => {}, generateWiring, reconcileMap, applyDeskGadgetUsage, updateWith,
    saveFirstSetupDraft: h.setup.saveFirstSetupDraft, analytics: { track: noop }, EVENTS: {},
    hapticSuccess: noop, errorProperties: () => ({}),
  }
  await screenValue('DeskPlacement', 'finishPlacement', bindings)()
  assert.equal(destinations.at(-1)?.[0], 'PhotoFill')
  assert.ok(getPlan().wiringResult)
  assert.deepEqual(getPlan().connectionMap.nodeOffsets, bindings.nodeOffsets)
  Object.assign(bindings, {
    deskName: '復元して完成したデスク', description: '再インストール後も編集できた',
    getById: getPlan, trimAndTruncate, tidyMultilineText, truncateChars,
    DESK_NAME_MAX: 30, DESK_DESCRIPTION_MAX_LENGTH: 300, setDeskName: noop, setDescription: noop,
    fromSetup: true, finishInFlightRef: { current: false }, setFinishing: noop,
    Alert: { alert: () => assert.fail('復元後の完了に失敗した') },
  })
  bindings.persistDeskDetails = screenValue('PhotoFill', 'persistDeskDetails', bindings)
  bindings.saveDeskDetails = screenValue('PhotoFill', 'saveDeskDetails', bindings)
  await screenValue('PhotoFill', 'finish', bindings)()
  assert.equal(destinations.at(-1)?.[0], 'WiringResult')
  assert.equal(getPlan().name, bindings.deskName)
  screenValue('WiringResult', 'clearSetup', {
    readOnly: false, planId, loadFirstSetupDraft: h.setup.loadFirstSetupDraft, clearFirstSetupDraft: h.setup.clearFirstSetupDraft,
  })()
  await new Promise<void>(resolve => setImmediate(resolve))
  await h.setup.flushFirstSetupDraftPersistence()
  assert.equal(await h.setup.loadFirstSetupDraft(), null)
  assert.equal(firstSetupResume.resolveFirstSetupDraft(null, readPlans()), null)
}

function resumeDestination(h: ReturnType<typeof harness>, draft: any) {
  let destination: { name: string; params: any } | undefined
  const plans = JSON.parse(h.store.get('@desk_plans') ?? '[]')
  const gadgets = JSON.parse(h.store.get('@desk_gadgets') ?? '[]')
  const navigation = {
    isFocused: () => true, getState: () => ({ routes: [{ name: 'PlanList', key: 'list' }] }),
    navigate: (name: string, params: unknown) => { destination = { name, params } },
    reset: (state: any) => { destination = state.routes[state.index] },
  }
  screenValue('PlanList', 'resumeFirstSetup', {
    firstSetupResumeNavigation: firstSetupResume.firstSetupResumeNavigation, navigation,
    openGearStepById: (id: string) => openGearStep(navigation as any, plans.find((plan: any) => plan.id === id), gadgets, 'forward'),
  })(draft)
  assert.ok(destination)
  return destination
}

function harness(options: { realCollections?: boolean; store?: Map<string, string>; write?: (key: string, value: string) => Promise<void>; upload?: (row: any) => Promise<any>; restoreTimeoutMs?: number; query?: (userId: string) => Promise<any>; savePlans?: () => Promise<void>; saveGadgets?: () => Promise<void>; saveAppearance?: () => Promise<void>; restorePublishLinks?: (userId: string, planIds: string[]) => Promise<void> } = {}) {
  const store = options.store ?? new Map<string, string>()
  const writes: string[] = []
  const uploads: any[] = []
  const storage = {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { await options.write?.(key, value); writes.push(key); store.set(key, value) },
    removeItem: async (key: string) => { store.delete(key) },
    getAllKeys: async () => [...store.keys()],
    multiGet: async (keys: string[]) => keys.map(key => [key, store.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { if (entries.some(([key]) => key.startsWith('app_'))) await options.saveAppearance?.(); for (const [key, value] of entries) await storage.setItem(key, value) },
    multiRemove: async (keys: string[]) => { for (const key of keys) store.delete(key) },
  }
  const load = (key: string) => JSON.parse(store.get(key) ?? '[]')
  const noop = async () => {}
  let remote = payload()
  let remoteId: string | undefined
  // サーバーの最新の控え（id と送った端末）。送信が成功すると、その行が最新になる
  let head: { id: string; device_id: string | null } | null = null
  let uuid = 0
  const modules = new Map<string, any>()
  const requireMock = (id: string): any => {
    if (id === '@react-native-async-storage/async-storage') return storage
    if (id === 'react') return {
      useCallback: (fn: unknown) => fn,
      useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
    }
    if (id === 'expo-file-system/legacy') return { documentDirectory: 'file:///new-install/Documents/' }
    if (options.realCollections && id.endsWith('/gadgetStore')) return loadModule('src/store/gadgetStore.ts')
    if (options.realCollections && id.endsWith('/planStore')) return loadModule('src/store/planStore.ts')
    if (options.realCollections && id.endsWith('/conversationStore')) return loadModule('src/store/conversationStore.ts')
    if (options.realCollections && id.endsWith('/useGadgets')) return loadModule('src/hooks/useGadgets.ts')
    if (id.endsWith('/portTypeMigration')) return portMigration
    if (id.endsWith('/portRoles')) return portRoles
    if (id.endsWith('/gadgetTrash')) return gadgetTrash
    if (id.endsWith('/planImageRefs')) return loadModule('src/utils/planImageRefs.ts')
    if (id.endsWith('/truncateText')) return { truncateChars }
    if (id === 'react-native') return { Platform: { OS: 'ios', Version: 'test' } }
    if (id === 'uuid') return { v4: () => `uuid-${++uuid}` }
    if (id.endsWith('/supabase/client')) return { supabase: { from: () => {
      let userId = ''
      let columns = ''
      const query: any = {
        insert: async (row: any) => {
          uploads.push(row)
          const result = options.upload ? await options.upload(row) : { error: null }
          if (!result?.error) head = { id: row.id, device_id: row.device_id }
          return result
        },
        select: (selected?: string) => { columns = selected ?? ''; return query },
        order: () => query, limit: () => query, abortSignal: () => query,
        eq: (key: string, value: string) => { if (key === 'user_id') userId = value; return query },
        maybeSingle: async () => columns === 'id, device_id'
          ? { data: head, error: null }
          : !options.query && remote === null ? { data: null, error: null }
          : { data: { id: remoteId, payload: options.query ? await options.query(userId) : remote }, error: null },
        single: async () => ({ data: { payload: remote }, error: null }),
      }
      return query
    } } }
    if (id.endsWith('/gadgetStore')) return {
      loadGadgets: async () => load('@desk_gadgets'), loadFolders: async () => load('@gadget_folders'),
      saveGadgets: async (value: any) => {
        await options.saveGadgets?.()
        await storage.setItem('@desk_gadgets', JSON.stringify(value))
      },
      saveFolders: (value: any) => storage.setItem('@gadget_folders', JSON.stringify(value)), clearGadgetsMigrationFlag: noop,
    }
    if (id.endsWith('/planStore')) return {
      loadPlans: async () => load('@desk_plans'), savePlans: async (value: any) => {
        await options.savePlans?.()
        await storage.setItem('@desk_plans', JSON.stringify(value))
      },
    }
    if (id.endsWith('/conversationStore')) return {
      readConversations: async () => load('@ai_conversations_v2'), sortConversationsByRecent, flushConversationPersistence: noop,
      replaceConversations: async (value: any) => storage.setItem('@ai_conversations_v2', JSON.stringify(sortConversationsByRecent(value))),
    }
    if (id.endsWith('/publishService')) return {
      exportPublishLinks: async () => ({}), importPublishLinks: noop, restorePublishedPlanLinks: options.restorePublishLinks ?? noop,
    }
    if (id.endsWith('/useGadgets')) return { clearGadgetsCache: noop, flushGadgetPersistence: noop, reloadGadgetsFromDisk: noop }
    if (id.endsWith('/usePlans')) return { clearPlansCache: noop, flushPlanPersistence: noop, reloadPlansFromDisk: noop }
    if (id.endsWith('/analytics')) return { analytics: { track: () => {}, error: () => {} }, EVENTS: {} }
    if (id.endsWith('/networkError')) return { QUICK_TIMEOUT_MS: 20000, PUBLISH_TIMEOUT_MS: 60000, STORAGE_TIMEOUT_MS: 5000, withTimeout: <T>(work: Promise<T>, ms: number) => withTimeout(work, options.restoreTimeoutMs ?? ms) }
    if (id.endsWith('/accountDataReconcile')) return reconcile
    if (id.endsWith('/storedDataRepair')) return repair
    if (id.endsWith('/utf8ByteLength')) return { utf8ByteLength }
    if (id.endsWith('/planImages')) return { dropMissingLocalImages: async (value: any) => value, deleteAllPlanImages: noop }
    if (id.endsWith('/localUserDataKeys')) return { localUserDataKeys }
    if (id.endsWith('/useCustomCategories')) return {
      clearCustomCategoriesCache: () => {},
      flushCustomCategoryPersistence: noop,
      CUSTOM_CATEGORIES_KEY: '@custom_categories_v1',
      // 端末に一覧が無いときは、旧バックアップと同じく項目を持たない（未使用のジャンルが無いだけの端末）
      readStoredCustomCategories: async () => (store.has('@custom_categories_v1') ? load('@custom_categories_v1') : undefined),
      reloadCustomCategoriesFromDisk: noop,
    }
    if (id.endsWith('/customCategory')) return loadModule('src/utils/customCategory.ts')
    if (id.endsWith('/bookmarkSeen')) return { clearSeenCache: noop }
    if (id.endsWith('/mapLayoutCache')) return { clearMapLayoutCache: noop }
    if (id.endsWith('/deskDetailPrefetch')) return { clearPrefetchedDesks: () => {} }
    if (id.endsWith('/ai/imageService')) return { deleteAllAIConversationImages: noop, dropMissingConversationImages: async (value: any) => value }
    if (id.endsWith('/templateDetailDraft')) return { clearTemplateDetailDraft: () => {} }
    if (id.endsWith('/firstSetupStore')) return loadModule('src/store/firstSetupStore.ts')
    if (id.endsWith('/viewHistory')) return loadModule('src/utils/viewHistory.ts')
    if (id.endsWith('/firstSetupResume')) return firstSetupResume
    if (id.endsWith('/accentColors')) return { ACCENT_PRESETS }
    if (id.endsWith('/backupRecoveryStore')) return loadModule('src/store/backupRecoveryStore.ts')
    if (id.endsWith('/appearanceStore')) return loadModule('src/store/appearanceStore.ts')
    if (id.endsWith('/accountDataOwner')) return loadModule('src/store/accountDataOwner.ts')
    if (id.endsWith('/localDataOperation')) return loadModule('src/utils/localDataOperation.ts')
    throw new Error(`Unexpected module: ${id}`)
  }
  function loadModule(file: string): any {
    if (modules.has(file)) return modules.get(file)
    const module = { exports: {} as any }
    modules.set(file, module.exports)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    runInNewContext(code, { exports: module.exports, module, require: requireMock, setTimeout, clearTimeout, AbortController, Date, Error })
    return module.exports
  }
  return {
    backup: loadModule('src/services/backupService.ts'), clear: () => loadModule('src/utils/clearLocalUserData.ts').clearLocalUserData(),
    setup: loadModule('src/store/firstSetupStore.ts'),
    history: loadModule('src/utils/viewHistory.ts'),
    appearance: loadModule('src/store/appearanceStore.ts'), recovery: loadModule('src/store/backupRecoveryStore.ts'),
    collections: () => ({
      gadgets: loadModule('src/hooks/useGadgets.ts'), plans: loadModule('src/store/planStore.ts'),
      conversations: loadModule('src/store/conversationStore.ts'),
    }),
    store, writes, uploads, setRemote: (value: any, id?: string) => { remote = value; remoteId = id },
    setHead: (value: typeof head) => { head = value },
  }
}

test('再インストール: 閲覧履歴だけでも保存し、同じ順序で復元して記録・削除・再保存できる', async () => {
  const before = harness()
  before.store.set('@local_data_owner', 'me')
  void before.history.recordDeskView('a', '2026-10-01T00:00:00Z')
  void before.history.recordDeskView('b', '2026-10-02T00:00:00Z')
  assert.equal(await before.backup.saveAccountSnapshotNow('me'), 'done')
  assert.deepEqual(JSON.parse(JSON.stringify(before.uploads[0].payload.viewHistory)), [
    { deskId: 'b', viewedAt: '2026-10-02T00:00:00Z' }, { deskId: 'a', viewedAt: '2026-10-01T00:00:00Z' },
  ])
  const after = harness()
  after.setRemote(before.uploads[0].payload)
  assert.equal(await after.backup.reconcileAccountData('me'), 'restored')
  assert.equal(after.backup.isPayloadEmpty(await after.backup.buildBackupPayload()), false)
  assert.deepEqual([...(await after.history.loadViewHistory()).map((entry: any) => entry.deskId)], ['b', 'a'])
  await after.history.recordDeskView('a', '2026-10-03T00:00:00Z')
  await after.history.removeFromViewHistory('b')
  assert.equal(await after.backup.saveAccountSnapshotNow('me'), 'done')
  const again = harness()
  again.setRemote(after.uploads.at(-1).payload)
  assert.equal(await again.backup.reconcileAccountData('me'), 'restored')
  assert.deepEqual(JSON.parse(JSON.stringify(await again.history.loadViewHistory())), [{ deskId: 'a', viewedAt: '2026-10-03T00:00:00Z' }])
  await again.history.clearViewHistory()
  assert.equal(await again.backup.saveAccountSnapshotNow('me'), 'done')
  assert.deepEqual([...again.uploads.at(-1).payload.viewHistory], [])
})

test('ログイン前の閲覧履歴を控えと統合し、同じデスクは新しい閲覧時刻を残して最大1,000件にする', async () => {
  const h = harness()
  h.store.set('@account_sign_in_pending', '1')
  const remote = { ...payload(), viewHistory: Array.from({ length: 1000 }, (_, i) => ({ deskId: `remote-${i}`, viewedAt: new Date(Date.UTC(2020, 0, i + 1)).toISOString() })) }
  remote.viewHistory.push({ deskId: 'same', viewedAt: '2026-10-02T00:00:00Z' })
  await h.history.recordDeskView('same', '2026-10-01T00:00:00Z')
  await h.history.recordDeskView('local', '2026-10-03T00:00:00Z')
  h.setRemote(remote)
  assert.equal(await h.backup.reconcileAccountData('me'), 'merged')
  const history = await h.history.loadViewHistory()
  assert.equal(history.length, 1000)
  assert.deepEqual([...history.slice(0, 2).map((entry: any) => entry.deskId)], ['local', 'same'])
  assert.equal(history[1].viewedAt, '2026-10-02T00:00:00Z')
  assert.equal(history.filter((entry: any) => entry.deskId === 'same').length, 1)
})

for (const present of [false, true]) {
  test(`閲覧履歴の復元を取り消すと元の${present ? '履歴' : 'キーなしの状態'}へ戻る`, async () => {
    const h = harness()
    if (present) await h.history.recordDeskView('local', '2026-10-01T00:00:00Z')
    const original = h.store.get('@desk_view_history_v1')
    h.setRemote({ ...payload(), viewHistory: [{ deskId: 'account', viewedAt: '2026-10-02T00:00:00Z' }] })
    await h.backup.restoreBackup('backup')
    assert.equal((await h.history.loadViewHistory())[0].deskId, 'account')
    await h.backup.undoRestore()
    assert.equal(h.store.get('@desk_view_history_v1'), original)
  })
}

test('閲覧履歴を持たない旧バックアップは端末にある履歴を維持する', async () => {
  const h = harness()
  await h.history.recordDeskView('local', '2026-10-01T00:00:00Z')
  h.setRemote(payload())
  await h.backup.restoreBackup('backup')
  assert.equal((await h.history.loadViewHistory())[0].deskId, 'local')
})

for (const viewHistory of [{}, [null], [{ deskId: 'x', viewedAt: 'broken' }], [{ deskId: '', viewedAt: '2026-10-01' }]]) {
  test(`壊れた閲覧履歴は端末へ自動復元しない: ${JSON.stringify(viewHistory)}`, async () => {
    const h = harness()
    h.setRemote({ ...payload(), viewHistory })
    assert.equal(await h.backup.reconcileAccountData('me'), 'needs-review')
    assert.equal(h.store.has('@desk_view_history_v1'), false)
    assert.equal(h.store.has('@desk_gadgets'), false)
  })
}

test('端末の閲覧履歴が壊れていると空の履歴でバックアップを上書きしない', async () => {
  for (const raw of ['{broken', '{}', '[null]']) {
    const h = harness()
    h.store.set('@local_data_owner', 'me')
    h.store.set('@desk_view_history_v1', raw)
    assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'invalid-data')
    assert.equal(h.uploads.length, 0)
    assert.equal(h.store.get('@desk_view_history_v1'), raw)
  }
})

test('閲覧履歴の保存待ちをバックアップが待ち、直前の記録を取りこぼさない', async () => {
  const writing = deferred<void>()
  const release = deferred<void>()
  const h = harness({ write: async key => {
    if (key === '@desk_view_history_v1') { writing.resolve(); await release.promise }
  } })
  h.store.set('@local_data_owner', 'me')
  const recording = h.history.recordDeskView('latest', '2026-10-19T00:00:00Z')
  await writing.promise
  const saving = h.backup.saveAccountSnapshotNow('me')
  assert.equal(h.uploads.length, 0)
  release.resolve()
  await recording
  assert.equal(await saving, 'done')
  assert.equal(h.uploads[0].payload.viewHistory[0].deskId, 'latest')
})

test('ログアウトの消去後に保存待ちだった閲覧履歴を復活させず、次の利用者は空から記録する', async () => {
  const writing = deferred<void>()
  const release = deferred<void>()
  const h = harness({ write: async key => {
    if (key === '@desk_view_history_v1') { writing.resolve(); await release.promise }
  } })
  const first = h.history.recordDeskView('previous-user', '2026-10-01T00:00:00Z')
  await writing.promise
  const queued = h.history.recordDeskView('queued-previous-user', '2026-10-02T00:00:00Z')
  const clearing = h.clear()
  await new Promise(resolve => setImmediate(resolve))
  release.resolve()
  await Promise.all([first, queued, clearing])
  assert.equal(h.store.has('@desk_view_history_v1'), false)
  await h.history.recordDeskView('new-user', '2026-10-03T00:00:00Z')
  assert.deepEqual([...(await h.history.loadViewHistory()).map((entry: any) => entry.deskId)], ['new-user'])
})

test('閲覧履歴を書いた後で復元に失敗しても、元の履歴へ戻して操作を続けられる', async () => {
  let failOnce = true
  const h = harness({ saveAppearance: async () => {
    if (failOnce) { failOnce = false; throw new Error('appearance failure') }
  } })
  await h.history.recordDeskView('original', '2026-10-01T00:00:00Z')
  h.setRemote({ ...payload(), viewHistory: [{ deskId: 'account', viewedAt: '2026-10-02T00:00:00Z' }], appearance: { themeMode: 'dark', accentKey: 'teal' } })
  await assert.rejects(h.backup.restoreBackup('backup'), /appearance failure/)
  assert.equal((await h.history.loadViewHistory())[0].deskId, 'original')
  await h.history.recordDeskView('after-failure', '2026-10-03T00:00:00Z')
  assert.deepEqual([...(await h.history.loadViewHistory()).map((entry: any) => entry.deskId)], ['after-failure', 'original'])
})

test('閲覧履歴の壊れた項目はプレビューで数え、明示的な部分復元でだけ除外する', async () => {
  const h = harness()
  await h.history.recordDeskView('original', '2026-10-01T00:00:00Z')
  h.setRemote({ ...payload(), viewHistory: [null, { deskId: 'valid', viewedAt: '2026-10-02T00:00:00Z' }] })
  assert.equal((await h.backup.getBackupPreview('backup')).removedItems, 1)
  await assert.rejects(h.backup.restoreBackup('backup'))
  assert.equal((await h.history.loadViewHistory())[0].deskId, 'original')
  await h.backup.restoreBackup('backup', { allowPartial: true })
  assert.deepEqual([...(await h.history.loadViewHistory()).map((entry: any) => entry.deskId)], ['valid'])
  await h.backup.undoRestore()
  assert.equal((await h.history.loadViewHistory())[0].deskId, 'original')
})

test('再インストール: 持ち物・複数デスクの歴史・お気に入り・削除履歴を復元し、編集して再保存できる', async () => {
  const before = harness({ realCollections: true })
  before.store.set('@local_data_owner', 'me')
  const { gadgets: originalGear, plans: originalPlans, conversations: originalChats } = before.collections()
  const base = payload('monitor').gadgets[0]
  const gear = [
    { ...base, favorite: true, price: 45000, purchasedAt: '2024-01-01', memo: '残すメモ', folderIds: ['shelf'] },
    { ...base, id: 'retired', category: 'Keyboard', name: '前のキーボード', purchasedAt: '2023-02-01', removedAt: '2025-02-01', disposedAt: '2025-03-01', favorite: true },
    { ...base, id: 'cable', category: 'Cable', cableType: 'USB-C', cableCount: 1, name: '使っていないケーブル', folderIds: ['shelf'] },
    { ...base, id: 'candidate', category: 'Other', name: '購入候補', isCandidate: true, introducedAtUnknown: true },
    { ...base, id: 'trash', name: '削除から戻す機材', deletedAt: new Date().toISOString(), purchasedAt: '2024-03-01', favorite: true },
  ]
  await originalGear.useGadgets().addMany(gear)
  await originalGear.useGadgets().addFolder('棚')
  const shelf = originalGear.useGadgets().folders[0]
  await originalGear.useGadgets().renameFolder(shelf, '復元する棚')
  await originalGear.useGadgets().setGadgetFolders(gear[0], [shelf.id])
  await originalGear.flushGadgetPersistence()
  const periods = [
    { mode: 'active', startedAt: '2024-01-01', endedAt: '2024-08-01' },
    { mode: 'decor', startedAt: '2024-08-01', endedAt: '2025-01-01' },
    { mode: 'active', startedAt: '2025-03-01' },
  ]
  const first = {
    id: 'desk-a', name: 'メイン', selectedGadgetIds: ['monitor'], placements: [],
    createdAt: '2023-01-01', updatedAt: '2026-10-19', favorite: true, favoriteGadgetIds: ['monitor'],
    gadgetUsage: {
      monitor: { periods }, retired: { periods: [{ mode: 'active', startedAt: '2023-02-01', endedAt: '2025-02-01' }] },
      trash: { periods: [{ mode: 'active', startedAt: '2024-03-01', endedAt: '2024-06-01' }] },
    },
    connectionMap: {
      connections: [], nodeOffsets: { monitor: { dx: 20, dy: 30 } },
      layoutSnapshots: { '2024-01-01': { nodeOffsets: { monitor: { dx: 5, dy: 6 } }, nodeSizes: {} } },
      historyLayout: { '2024-08-01': { nodeOffsets: { monitor: { dx: 50, dy: 60 } }, nodeSizes: { monitor: { w: 100, h: 80 } } } },
    },
  }
  const second = { ...first, id: 'desk-b', name: '別のデスク', gadgetUsage: { monitor: { periods: [{ mode: 'active', startedAt: '2026-01-01' }] } } }
  await originalPlans.savePlans([first, second])
  await originalChats.saveConversation({
    id: 'chat', title: '相談の履歴', planId: first.id, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    messages: [{ id: 'msg', role: 'user', content: '以前の質問', timestamp: '2026-01-01' }],
  })
  const history = (plan: any, gadgets: any[]) => {
    const historical = screenValue('WiringResult', 'historyGadgets', { plan, gadgets, applyDeskGadgetUsage })()
    return JSON.parse(JSON.stringify(buildTimeline(historical, plan, 'ja', 'day', '2026-10-19')))
  }
  const priorTimeline = history(first, originalGear.useGadgets().gadgets)
  assert.ok(priorTimeline.length > 3)
  assert.equal(await before.backup.saveAccountSnapshotNow('me'), 'done')

  const after = harness({ realCollections: true })
  after.setRemote(before.uploads[0].payload, before.uploads[0].id)
  assert.equal(await after.backup.reconcileAccountData('me'), 'restored')
  const { gadgets, plans, conversations } = after.collections()
  const restoredGear = gadgets.useGadgets()
  const restoredPlans = await plans.loadPlans()
  assert.deepEqual(JSON.parse(JSON.stringify(restoredGear.gadgets)), JSON.parse(JSON.stringify(originalGear.useGadgets().gadgets)))
  assert.deepEqual(JSON.parse(JSON.stringify(restoredGear.deletedGadgets)), JSON.parse(JSON.stringify(originalGear.useGadgets().deletedGadgets)))
  assert.deepEqual(JSON.parse(JSON.stringify(restoredGear.folders)), JSON.parse(JSON.stringify(originalGear.useGadgets().folders)))
  for (const plan of restoredPlans) {
    const original = plan.id === first.id ? first : second
    assert.deepEqual(history(plan, restoredGear.gadgets), history(original, originalGear.useGadgets().gadgets))
  }
  assert.deepEqual(JSON.parse(JSON.stringify(resolveTimelineLayout(restoredPlans[0], '2024-08-01'))), resolveTimelineLayout(first as any, '2024-08-01'))
  assert.equal((await conversations.getConversation('chat')).messages[0].content, '以前の質問')
  await conversations.saveConversation({ ...(await conversations.getConversation('chat')), updatedAt: '2026-10-19', messages: [
    ...(await conversations.getConversation('chat')).messages, { id: 'reply', role: 'assistant', content: '復元後の返答', timestamp: '2026-10-19' },
  ] })
  await conversations.saveConversation({ id: 'remove-chat', title: '', createdAt: '', updatedAt: '', messages: [] })
  await conversations.deleteConversation('remove-chat')
  await restoredGear.toggleFavorite('monitor')
  await restoredGear.setDisposedAt('retired', undefined)
  await restoredGear.update({ ...gadgets.useGadgets().gadgets.find((item: any) => item.id === 'monitor'), name: '復元後の名前', price: 42000 })
  await restoredGear.moveToTrash(['monitor'])
  assert.equal(gadgets.useGadgets().gadgets.some((item: any) => item.id === 'monitor'), false)
  await restoredGear.restoreFromTrash(['monitor', 'trash'])
  const current = gadgets.useGadgets()
  assert.equal(current.deletedGadgets.length, 0)
  assert.equal(current.gadgets.find((item: any) => item.id === 'trash').favorite, true)
  assert.equal(history(restoredPlans[0], current.gadgets).some((event: any) => event.inGadgets.some((item: any) => item.id === 'trash')), true)
  let edited = updateDeskGadgetSelection(restoredPlans[0], [], current.gadgets, '2026-10-18')
  edited = updateDeskGadgetSelection(edited, ['monitor'], current.gadgets, '2026-10-19')
  edited = setDeskGadgetUsage(edited, 'retired', { periods: [{ mode: 'decor', startedAt: '2026-10-19' }] })
  await plans.updatePlan(edited)
  assert.deepEqual((await plans.getPlanById('desk-b')).gadgetUsage, restoredPlans[1].gadgetUsage)
  await current.removeFolder(shelf.id)
  await gadgets.flushGadgetPersistence()
  assert.equal(gadgets.useGadgets().folders.length, 0)
  assert.deepEqual([...gadgets.useGadgets().gadgets.find((item: any) => item.id === 'monitor').folderIds], [])
  assert.equal(await after.backup.saveAccountSnapshotNow('me'), 'done')
  const again = harness({ realCollections: true })
  again.setRemote(after.uploads.at(-1).payload)
  assert.equal(await again.backup.reconcileAccountData('me'), 'restored')
  const saved = again.collections()
  assert.equal(saved.gadgets.useGadgets().gadgets.find((item: any) => item.id === 'monitor').name, '復元後の名前')
  assert.equal(saved.gadgets.useGadgets().gadgets.find((item: any) => item.id === 'monitor').favorite, undefined)
  assert.equal((await saved.conversations.getConversation('chat')).messages.length, 2)
  assert.equal(await saved.conversations.getConversation('remove-chat'), null)
  assert.deepEqual(history(await saved.plans.getPlanById('desk-a'), saved.gadgets.useGadgets().gadgets), history(edited, gadgets.useGadgets().gadgets))
})

for (const version of [1, 2, 3, 4, 5, 6]) {
  test(`再インストール: version ${version}の導入日・撤去日から歴史を戻し、再導入を追記できる`, async () => {
    const h = harness({ realCollections: true })
    const remote = payload()
    remote.version = version
    remote.gadgets[0] = { ...remote.gadgets[0], purchasedAt: '2020-01-01', removedAt: '2025-01-01', favorite: true }
    remote.plans = [{
      id: 'legacy-desk', name: '旧デスク', selectedGadgetIds: [], placements: [], createdAt: '2020-01-01', updatedAt: '2025-01-01',
      gadgetUsage: { restored: { introducedAt: '2021-02-01', removedAt: '2024-03-01' } },
    }]
    h.setRemote(remote)
    assert.equal(await h.backup.reconcileAccountData('me'), 'restored')
    const { gadgets, plans } = h.collections()
    const gadget = gadgets.useGadgets().gadgets[0]
    const plan = await plans.getPlanById('legacy-desk')
    const historical = applyDeskGadgetUsage(plan, gadget)
    const timeline = buildTimeline([historical], plan, 'ja', 'day', '2026-10-19')
    assert.deepEqual(timeline.map(event => event.date), ['2021-02-01', '2024-03-01'])
    assert.equal(gadget.purchasedAt, '2020-01-01')
    assert.equal(gadget.favorite, true)
    await plans.updatePlan(updateDeskGadgetSelection(plan, [gadget.id], [gadget], '2026-10-19'))
    const updated = applyDeskGadgetUsage(await plans.getPlanById(plan.id), gadget)
    assert.deepEqual(JSON.parse(JSON.stringify(updated.deskUsagePeriods)), [
      { mode: 'active', startedAt: '2021-02-01', endedAt: '2024-03-01' },
      { mode: 'active', startedAt: '2026-10-19', startedAtSource: 'auto' },
    ])
    assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  })
}

for (const section of ['gadgets', 'folders', 'aiConversations', 'customCategories'] as const) {
  test(`再インストール: ${section}だけでも空と誤判定せず復元する`, async () => {
    const before = harness({ realCollections: true })
    before.store.set('@local_data_owner', 'me')
    const values = {
      gadgets: { key: '@desk_gadgets', data: [{ ...payload().gadgets[0], deletedAt: new Date().toISOString(), favorite: true }] },
      folders: { key: '@gadget_folders', data: [{ id: 'empty-shelf', name: '空の棚', color: '#123456', sortOrder: 0, createdAt: '' }] },
      aiConversations: { key: '@ai_conversations_v2', data: [{ id: 'only-chat', title: '', messages: [{ role: 'user', content: '会話だけ' }], createdAt: '', updatedAt: '' }] },
      customCategories: { key: '@custom_categories_v1', data: [{ id: 'unused', name: '未使用ジャンル', icon: 'star' }] },
    }
    const { key, data } = values[section]
    before.store.set(key, JSON.stringify(data))
    assert.equal(before.backup.isPayloadEmpty(await before.backup.buildBackupPayload()), false)
    assert.equal(await before.backup.saveAccountSnapshotNow('me'), 'done')
    const after = harness({ realCollections: true })
    after.setRemote(before.uploads[0].payload)
    assert.equal(await after.backup.reconcileAccountData('me'), 'restored')
    assert.deepEqual(JSON.parse(after.store.get(key)!), data)
  })
}

test('持ち物の復元途中で保存に失敗しても、歴史・お気に入り・削除済み・フォルダを元へ戻す', async () => {
  let failOnce = false
  const h = harness({ realCollections: true, write: async key => {
    if (failOnce && key === '@ai_conversations_v2') { failOnce = false; throw new Error('disk failure') }
  } })
  h.store.set('@local_data_owner', 'me')
  h.store.set('@desk_gadgets', JSON.stringify([{ ...payload('before').gadgets[0], favorite: true, deletedAt: new Date().toISOString(), folderIds: ['old-shelf'] }]))
  h.store.set('@gadget_folders', JSON.stringify([{ id: 'old-shelf', name: '元の棚' }]))
  h.store.set('@desk_plans', JSON.stringify([{
    id: 'before-desk', name: '元の歴史', selectedGadgetIds: [], placements: [], createdAt: '', updatedAt: '',
    gadgetUsage: { before: { periods: [{ mode: 'active', startedAt: '2024-01-01', endedAt: '2025-01-01' }] } },
  }]))
  const { gadgets, plans } = h.collections()
  await gadgets.preloadGadgets()
  const previousGear = JSON.stringify(gadgets.useGadgets().deletedGadgets)
  const previousFolders = JSON.stringify(gadgets.useGadgets().folders)
  const previousPlans = JSON.stringify(await plans.loadPlans())
  failOnce = true
  await assert.rejects(h.backup.restoreBackup('backup'), /disk failure/)
  assert.equal(JSON.stringify(gadgets.useGadgets().deletedGadgets), previousGear)
  assert.equal(JSON.stringify(gadgets.useGadgets().folders), previousFolders)
  assert.equal(JSON.stringify(await plans.loadPlans()), previousPlans)
  assert.equal(h.store.has('@backup_restore_journal'), false)
  await gadgets.useGadgets().restoreFromTrash(['before'])
  await gadgets.useGadgets().toggleFavorite('before')
  assert.equal(gadgets.useGadgets().gadgets[0].favorite, undefined)
})

for (const screen of ['PurposeSelection', 'TemplateDetail', 'GadgetSelection', 'DeskPlacement', 'PhotoFill', 'WiringResult', 'completed'] as const) {
  test(`再インストール: ${screen}で保存した状態を空の端末へ戻し、同じデスクと再開位置を維持する`, async () => {
    const before = harness()
    before.store.set('@local_data_owner', 'me')
    const data = payload('gadget')
    data.version = 6
    const hasPlan = screen !== 'PurposeSelection' && screen !== 'TemplateDetail'
    if (!hasPlan) data.gadgets = []
    data.plans = hasPlan ? [{
      id: 'desk-plan', name: '編集中のデスク', goal: 'first_setup', purposes: ['work'],
      selectedGadgetIds: ['gadget'], placements: [{ gadgetId: 'gadget', zone: 'back_center' }],
      createdAt: '2026-10-01', updatedAt: '2026-10-14',
      ...(screen === 'PhotoFill' || screen === 'WiringResult' || screen === 'completed'
        ? { wiringResult: { connections: [], requiredCables: [], warnings: [] },
            connectionMap: { connections: [], nodeOffsets: { gadget: { dx: 10, dy: 20 } } } }
        : {}),
    }] : []
    before.store.set('@desk_plans', JSON.stringify(data.plans))
    before.store.set('@desk_gadgets', JSON.stringify(data.gadgets))
    const draft = screen === 'completed' ? null
      : screen === 'PurposeSelection' ? { screen, purposes: ['work'] }
      : screen === 'TemplateDetail' ? { screen, templateId: 'from-scratch', purposes: ['work'], composition: [{ category: 'Monitor' }] }
      : { screen, planId: 'desk-plan' }
    if (draft) await before.setup.saveFirstSetupDraft(draft)
    assert.equal(await before.backup.saveAccountSnapshotNow('me'), 'done')
    const uploaded = before.uploads[0]
    const after = harness()
    assert.equal(after.store.size, 0)
    after.setRemote(uploaded.payload, uploaded.id)
    after.setHead({ id: uploaded.id, device_id: uploaded.device_id })
    assert.equal(await after.backup.reconcileAccountData('me'), 'restored')
    assert.deepEqual(JSON.parse(after.store.get('@desk_plans') ?? '[]'), data.plans)
    assert.deepEqual(JSON.parse(after.store.get('@desk_gadgets') ?? '[]'), data.gadgets)
    assert.deepEqual(JSON.parse(JSON.stringify(await after.setup.loadFirstSetupDraft())), JSON.parse(JSON.stringify(uploaded.payload.firstSetupDraft)))
    if (draft) {
      const destination = resumeDestination(after, await after.setup.loadFirstSetupDraft())
      assert.equal(destination.name, screen === 'GadgetSelection' ? 'TemplateDetail' : screen)
    }
    assert.equal(await after.backup.hasPendingBackupRecovery(), false)
    assert.equal(await after.backup.reconcileAccountData('me'), 'not-needed')
    assert.equal(await after.backup.saveAccountSnapshotNow('me'), 'done')
    assert.equal(after.uploads.length, 1)
    if (hasPlan) await completeRestoredPlan(after, 'desk-plan')
  })
}

test('再インストール: デスク本体の作成前でも機材の入力・追加削除・商品選択・仕様を戻して再開する', async () => {
  const before = harness()
  before.store.set('@local_data_owner', 'me')
  const noop = () => {}
  const inputs = {
    templateId: 'from-scratch', outletCount: 0,
    extraItems: [
      { key: 'extra-mouse', category: 'Mouse', name: 'マウス', source: 'extra' },
      { key: 'extra-keyboard', category: 'Keyboard', name: 'キーボード', source: 'extra' },
    ],
    removedKeys: ['purpose-work-Webcam'],
    productNames: { 'extra-mouse': '復元するマウス', 'extra-keyboard': '詳細で保存したキーボード' },
    productPicks: { 'extra-mouse': { name: '復元するマウス', productId: 'product', ports: [], priceJpy: 5000 } },
    productPrices: { 'extra-mouse': '4500', 'extra-keyboard': '12000' },
    productDates: { 'extra-mouse': '2026/10/01', 'extra-keyboard': '2026/09/01' },
    ownedSelections: {}, draftGadgets: { 'extra-keyboard': 'detail-before-reinstall' }, registerAsOwned: true,
    specEdits: { 'extra-mouse': { usbC: 1 } },
  }
  before.store.set('@desk_gadgets', JSON.stringify([{
    id: inputs.draftGadgets['extra-keyboard'], name: inputs.productNames['extra-keyboard'],
    category: 'Keyboard', ports: [], price: 12000, purchasedAt: '2026-09-01', createdAt: '2026-10-19',
  }]))
  screenValue('TemplateDetail', 'saveInputs', {
    ...inputs, removedKeys: new Set(inputs.removedKeys), ownedAssignments: {}, returnPlanId: undefined,
    focused: true, creating: false, purposes: ['work'], otherPurposeLabel: undefined, otherPurposeIcon: undefined,
    otherPurposeColor: undefined, copySource: undefined, composition: undefined,
    saveTemplateDetailDraft: noop, saveFirstSetupDraft: before.setup.saveFirstSetupDraft,
  })()
  assert.equal(await before.backup.saveAccountSnapshotNow('me'), 'done')
  const after = harness()
  assert.equal(after.store.size, 0)
  after.setRemote(before.uploads[0].payload, before.uploads[0].id)
  assert.equal(await after.backup.reconcileAccountData('me'), 'restored')
  const restored = await after.setup.loadFirstSetupDraft()
  assert.ok(restored.inputs, '機材設定の入力も復元する')
  assert.deepEqual(JSON.parse(JSON.stringify(restored.inputs)), inputs)
  const target = firstSetupResume.firstSetupResumeNavigation(restored)
  assert.equal(target.name, 'TemplateDetail')
  assert.deepEqual(JSON.parse(JSON.stringify((target.params as any).initialDraft)), inputs)
  assert.deepEqual(JSON.parse(JSON.stringify(resumeDestination(after, restored).params.initialDraft)), inputs)
  const [restoredInputs] = screenValue('TemplateDetail', '[restored]', {
    useState: (initialize: () => unknown) => [initialize()], readTemplateDetailDraft: () => null,
    templateId: inputs.templateId, returnPlanId: undefined, route: { params: target.params },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(restoredInputs)), inputs)
  const template = DESK_TEMPLATES.find(item => item.id === inputs.templateId)!
  const items = screenValue('TemplateDetail', 'items', {
    ...restoredInputs, removedKeys: new Set(restoredInputs.removedKeys), template, lang: 'ja', purposes: ['work'],
    composition: undefined, returnPlanId: undefined, buildTemplateItems, defaultConnTypeForSlot,
    CATEGORY_SELECTION_ORDER, PURPOSE_GADGETS, defaultZoneForCategory,
  })()
  assert.equal(items.some((item: any) => item.key === 'purpose-work-Webcam'), false)
  assert.equal(items[0].key, 'extra-mouse')
  const existingGadgets = JSON.parse(after.store.get('@desk_gadgets') ?? '[]')
  const saveGadgets = async (incoming: any[]) => {
    const all = new Map(JSON.parse(after.store.get('@desk_gadgets') ?? '[]').map((item: any) => [item.id, item]))
    incoming.forEach(item => all.set(item.id, item))
    after.store.set('@desk_gadgets', JSON.stringify([...all.values()]))
  }
  const bindings: any = {
    ...restoredInputs, template, items, resolvedItems: items, specItems: items,
    specFor: (item: any) => restoredInputs.specEdits[item.key] ?? defaultTemplateSpec(item),
    reusedByKey: new Map(), gadgets: existingGadgets, ownedAssignments: {},
    liveDraftGadgets: screenValue('TemplateDetail', 'liveDraftGadgets', {
      draftGadgets: restoredInputs.draftGadgets, ownedAssignments: {}, items, gadgets: existingGadgets,
    })(),
    existingPlan: undefined, returnPlanId: undefined, purposes: ['work'], lang: 'ja',
    otherPurposeLabel: undefined, otherPurposeIcon: undefined, otherPurposeColor: undefined,
    createInFlightRef: { current: false }, newPlanIdRef: { current: null },
    setCreating: noop, setCreateError: (failed: boolean) => assert.equal(failed, false),
    withSpecArms, keptPlaceholderOf: () => undefined, ownedGadgetFor: () => undefined, trimInvisible, uuidv4: () => 'resumed-desk',
    parseDateInput, parsePriceToJpy: Number, autoDeskName: () => '復元したデスク', applyTemplate,
    addGadgets: saveGadgets, updateGadgets: saveGadgets,
    addPlan: async (plan: unknown, prepare: () => Promise<void>) => { await prepare(); after.store.set('@desk_plans', JSON.stringify([plan])) },
    untrackTemplateDraftGadgets: async () => {}, clearTemplateDetailDraft: noop, Keyboard: { dismiss: noop },
    saveFirstSetupDraft: after.setup.saveFirstSetupDraft, analytics: { error: (_name: string, error: unknown) => { throw error } },
    navigation: { isFocused: () => true, getState: () => ({ routes: [{ name: 'PlanList', key: 'list' }] }),
      reset: (state: any) => assert.equal(state.routes[1].name, 'DeskPlacement') },
  }
  bindings.withItemProduct = screenValue('TemplateDetail', 'withItemProduct', {
    ...bindings, trimAndTruncate, GADGET_NAME_MAX_LENGTH, applyProductToGadget,
    itemProductName: (key: string) => restoredInputs.productNames[key] ?? '',
    itemProductDate: (key: string) => restoredInputs.productDates[key] ?? '',
    itemProductPrice: (key: string) => restoredInputs.productPrices[key] ?? '',
  })
  await screenValue('TemplateDetail', 'handleApply', bindings)('unset', true)
  const gadgets = JSON.parse(after.store.get('@desk_gadgets') ?? '[]')
  const mouse = gadgets.find((item: any) => item.name === '復元するマウス')
  assert.ok(mouse)
  assert.equal(mouse.price, 4500)
  assert.equal(mouse.purchasedAt, '2026-10-01')
  assert.equal(gadgets.filter((item: any) => item.category === 'Keyboard').length, 1)
  assert.equal(gadgets.find((item: any) => item.category === 'Keyboard').id, 'detail-before-reinstall')
  await completeRestoredPlan(after, 'resumed-desk')
})

test('再インストール後のゲストの作成途中を統合しても、アカウント側の再開位置で上書きしない', async () => {
  const h = harness()
  h.store.set('@account_sign_in_pending', '1')
  await h.setup.saveFirstSetupDraft({ screen: 'TemplateDetail', templateId: 'guest-template', purposes: ['work'] })
  const remote = payload('account')
  remote.firstSetupDraft = { screen: 'TemplateDetail', templateId: 'account-template', purposes: ['gaming'] }
  h.setRemote(remote)
  assert.equal(await h.backup.reconcileAccountData('me'), 'merged')
  assert.equal((await h.setup.loadFirstSetupDraft()).templateId, 'guest-template')
})

test('機材から用途へ戻った状態で再インストールしても、機材の入力を失わず変更後の用途で再開する', async () => {
  const before = harness()
  before.store.set('@local_data_owner', 'me')
  const inputs = {
    templateId: 'from-scratch', outletCount: 2, extraItems: [], removedKeys: [],
    productNames: { webcam: '残す商品名' }, productPicks: {}, productPrices: {}, productDates: {}, specEdits: {},
  }
  screenValue('PurposeSelection', 'savePurpose', {
    returnPlanId: undefined, intent: 'organize', selected: new Set(['work', 'study']),
    otherLabel: '', otherIcon: '', otherColor: undefined,
    resume: { name: 'TemplateDetail', step: 1, params: { templateId: inputs.templateId, purposes: ['work'] } },
    readTemplateDetailDraft: () => inputs, saveFirstSetupDraft: before.setup.saveFirstSetupDraft,
  })()
  assert.equal(await before.backup.saveAccountSnapshotNow('me'), 'done')
  const after = harness()
  after.setRemote(before.uploads[0].payload)
  assert.equal(await after.backup.reconcileAccountData('me'), 'restored')
  const restored = await after.setup.loadFirstSetupDraft()
  assert.equal(restored.screen, 'TemplateDetail')
  assert.deepEqual([...restored.purposes], ['work', 'study'])
  assert.equal(restored.inputs.productNames.webcam, '残す商品名')
})

test('再インストール: クラウドに控えがなければ端末だけにあった作成途中は復元できない', async () => {
  const before = harness()
  await before.setup.saveFirstSetupDraft({ screen: 'TemplateDetail', templateId: 'from-scratch', purposes: ['work'] })
  assert.equal(before.uploads.length, 0)
  const after = harness()
  after.setRemote(null)
  assert.equal(await after.backup.reconcileAccountData('me'), 'none')
  assert.equal(await after.setup.loadFirstSetupDraft(), null)
  assert.equal(after.store.has('@desk_plans'), false)
})

test('再インストール: 再開位置を持たない旧バックアップの未完成デスクも機材設定から完成できる', async () => {
  const remote = payload('monitor')
  remote.plans = [{ id: 'legacy-desk', name: '旧版の途中デスク', goal: 'first_setup',
    selectedGadgetIds: ['monitor'], placements: [], createdAt: '2026-01-01', updatedAt: '2026-10-19' }]
  const after = harness()
  after.setRemote(remote)
  assert.equal(await after.backup.reconcileAccountData('me'), 'restored')
  const plans = JSON.parse(after.store.get('@desk_plans') ?? '[]')
  const draft = firstSetupResume.resolveFirstSetupDraft(await after.setup.loadFirstSetupDraft(), plans)
  const destination = resumeDestination(after, draft)
  assert.equal(destination.name, 'TemplateDetail')
  assert.equal(destination.params.returnPlanId, 'legacy-desk')
  assert.equal(destination.params.composition.length, 1)
  await completeRestoredPlan(after, 'legacy-desk')
})

test('再インストール: 24時間の自動保存間隔内の未送信変更は戻らず、最後に送った作成状態だけを復元する', async () => {
  const before = harness()
  before.store.set('@local_data_owner', 'me')
  await before.setup.saveFirstSetupDraft({ screen: 'TemplateDetail', templateId: 'from-scratch', purposes: ['work'] })
  assert.equal(await before.backup.saveAccountSnapshotNow('me'), 'done')
  await before.setup.saveFirstSetupDraft({ screen: 'TemplateDetail', templateId: 'from-scratch', purposes: ['study'] })
  assert.equal(await before.backup.runAutoBackupIfDue('me'), 'not-due')
  assert.equal(before.uploads.length, 1)
  const after = harness()
  after.setRemote(before.uploads[0].payload)
  assert.equal(await after.backup.reconcileAccountData('me'), 'restored')
  assert.deepEqual([...(await after.setup.loadFirstSetupDraft()).purposes], ['work'])
})

test('再インストール後に自作ジャンルだけ作ってからログインしても、空扱いで上書きしない', async () => {
  const h = harness()
  h.store.set('@account_sign_in_pending', '1')
  const category = { id: 'guest-category', label: '本', icon: 'book-open-page-variant-outline', color: '#E53935' }
  h.store.set('@custom_categories_v1', JSON.stringify([category]))
  const remote = payload()
  remote.customCategories = []
  h.setRemote(remote)
  assert.equal(await h.backup.reconcileAccountData('me'), 'merged')
  assert.equal(JSON.parse(h.store.get('@custom_categories_v1') ?? '[]')[0].id, 'guest-category')
})

test('壊れた再開位置や消したデスクへの参照で、再インストール後に開けない画面へ進めない', async () => {
  const damaged = harness()
  const invalid = payload()
  invalid.firstSetupDraft = { screen: 'PhotoFill', planId: 123 }
  damaged.setRemote(invalid)
  assert.equal(await damaged.backup.reconcileAccountData('me'), 'needs-review')
  assert.equal(damaged.store.has('@desk_gadgets'), false)
  const missing = harness()
  const absent = payload()
  absent.firstSetupDraft = { screen: 'PhotoFill', planId: 'deleted-plan' }
  missing.setRemote(absent)
  assert.equal(await missing.backup.reconcileAccountData('me'), 'restored')
  assert.equal(await missing.setup.loadFirstSetupDraft(), null)
})

test('ログイン復元は公開先の照合を済ませてから同期完了にし、照合失敗なら本体と再開位置を巻き戻す', async () => {
  const remote = payload()
  remote.plans = [{ id: 'plan', name: 'desk', goal: 'first_setup', selectedGadgetIds: ['restored'], placements: [], createdAt: '2026-10-01', updatedAt: '2026-10-14' }]
  remote.firstSetupDraft = { screen: 'DeskPlacement', planId: 'plan' }
  for (const fail of [false, true]) {
    let reads = 0
    const h = harness({ restorePublishLinks: async (userId, planIds) => {
      reads++
      assert.equal(userId, 'me')
      assert.deepEqual([...planIds], ['plan'])
      assert.equal(h.store.has('@local_data_owner'), false)
      assert.equal((await h.setup.loadFirstSetupDraft()).screen, 'DeskPlacement')
      if (fail) throw new Error('offline')
      h.store.set('@published_desk_plan', 'existing-page')
      h.store.set('@published_visibility_plan', 'unlisted')
    } })
    h.setRemote(remote)
    assert.equal(await h.backup.reconcileAccountData('me'), fail ? 'failed' : 'restored')
    assert.equal(reads, 1)
    if (fail) {
      assert.equal(h.store.has('@local_data_owner'), false)
      assert.equal(h.store.has('@desk_plans'), false)
      assert.equal(await h.setup.loadFirstSetupDraft(), null)
    } else {
      assert.equal(h.store.get('@published_desk_plan'), 'existing-page')
      assert.equal(h.store.get('@published_visibility_plan'), 'unlisted')
      assert.equal(h.store.get('@local_data_owner'), 'me')
    }
  }
})

test('バックアップ送信の応答を失ってから再インストールしても、サーバーへ届いた最新状態を復元する', async () => {
  let committed: any
  const before = harness({ upload: async row => { committed = row; throw new Error('response lost') } })
  before.store.set('@local_data_owner', 'me')
  before.store.set('@desk_gadgets', JSON.stringify(payload('latest-gadget').gadgets))
  await before.setup.saveFirstSetupDraft({ screen: 'TemplateDetail', templateId: 'latest-template', purposes: ['work'] })
  assert.equal(await before.backup.saveAccountSnapshotNow('me'), 'failed')
  const after = harness()
  after.setRemote(committed.payload, committed.id)
  assert.equal(await after.backup.reconcileAccountData('me'), 'restored')
  assert.equal((await after.setup.loadFirstSetupDraft()).templateId, 'latest-template')
  assert.deepEqual(JSON.parse(after.store.get('@desk_gadgets') ?? '[]').map((item: any) => item.id), ['latest-gadget'])
})

test('復元の通信中にアカウントが変わったら、前のデータや持ち主の印を書き戻さない', async () => {
  const requested = deferred<void>()
  const response = deferred<any>()
  const h = harness({ query: async () => { requested.resolve(); return response.promise } })
  const controller = new AbortController()
  const run = h.backup.reconcileAccountData('old-user', controller.signal)
  await requested.promise
  controller.abort()
  response.resolve(payload())
  assert.equal(await run, 'cancelled')
  assert.equal(h.writes.length, 0)
})

test('書き込み途中の復元を終えてからログアウトの消去を行い、後からデータを復活させない', async () => {
  const writing = deferred<void>()
  const finishWrite = deferred<void>()
  const h = harness({ savePlans: async () => { writing.resolve(); await finishWrite.promise } })
  const controller = new AbortController()
  const run = h.backup.reconcileAccountData('old-user', controller.signal)
  await writing.promise
  controller.abort()
  const clearing = h.clear()
  finishWrite.resolve()
  await Promise.all([run, clearing])
  assert.deepEqual([...h.store.keys()], [])
})

test('アカウント切り替え後の復元は、取り消した前の復元と混ざらない', async () => {
  const requested = deferred<void>()
  const response = deferred<any>()
  const h = harness({ query: async (userId) => {
    if (userId === 'old-user') { requested.resolve(); return response.promise }
    return payload('new-data')
  } })
  const controller = new AbortController()
  const old = h.backup.reconcileAccountData('old-user', controller.signal)
  await requested.promise
  controller.abort()
  const current = h.backup.reconcileAccountData('new-user')
  response.resolve(payload('old-data'))
  await Promise.all([old, current])
  assert.equal(h.store.get('@local_data_owner'), 'new-user')
  assert.deepEqual(JSON.parse(h.store.get('@desk_gadgets') ?? '[]').map((item: any) => item.id), ['new-data'])
})

test('復元するAI相談に日時の欠けやnullの行があっても、デスクだけ書き換えて失敗しない', async () => {
  const h = harness()
  const remote = payload()
  remote.aiConversations = [null, { id: 'missing-date', messages: [{ content: '相談' }] }, { id: 'valid', updatedAt: '2026-09-01', messages: [] }]
  h.setRemote(remote)
  await h.backup.restoreBackup('backup', { allowPartial: true })
  const saved = JSON.parse(h.store.get('@ai_conversations_v2') ?? '[]')
  assert.equal(saved.length, 2)
  assert.equal(saved.find((item: any) => item.id === 'missing-date').messages[0].content, '相談')
})

test('大きなAI相談も小さな相談も本文を省かずバックアップへ残す', async () => {
  const h = harness()
  h.store.set('@ai_conversations_v2', JSON.stringify([
    { id: 'huge', updatedAt: '2026-09-02', messages: [{ content: 'x'.repeat(1024 * 1024) }] },
    { id: 'small', updatedAt: '2026-09-01', messages: [{ content: '相談' }] },
  ]))
  const backup = await h.backup.buildBackupPayload()
  assert.equal(backup.aiConversations.length, 2)
  assert.equal(backup.aiConversations[0].id, 'huge')
  assert.equal(backup.aiConversations[1].id, 'small')
})

test('復元を取り消すと、同じ端末に残るAI相談の写真と大きな相談も戻る', async () => {
  const h = harness()
  const original = [{ id: 'original', title: '相談', createdAt: '2026-09-01', updatedAt: '2026-09-01', messages: [{ content: 'x'.repeat(1024 * 1024), imageUri: 'file:///saved-photo.jpg' }] }]
  h.store.set('@ai_conversations_v2', JSON.stringify(original))
  await h.backup.restoreBackup('backup')
  await h.backup.undoRestore()
  assert.deepEqual(JSON.parse(h.store.get('@ai_conversations_v2') ?? '[]'), original)
})

test('AI相談が配列でない控えは、端末のデータを書き換える前に拒否する', async () => {
  const h = harness()
  const remote = payload()
  remote.aiConversations = { broken: true }
  h.setRemote(remote)
  await assert.rejects(h.backup.restoreBackup('backup'), /malformed/)
  assert.equal(h.writes.length, 0)
})

test('控えの取得に失敗したときだけ再試行の印を残し、持ち主の印を進めない', async () => {
  const h = harness({ query: async () => { throw new Error('offline') } })
  assert.equal(await h.backup.reconcileAccountData('user'), 'failed')
  assert.equal(h.store.get('@account_sign_in_pending'), '1')
  assert.equal(h.store.has('@local_data_owner'), false)
})

test('復元処理が失敗しても、次の復元を止めず、別アカウントのデータは混ぜない', async () => {
  const h = harness()
  const invalid = payload()
  invalid.plans = null
  h.setRemote(invalid)
  await assert.rejects(h.backup.restoreBackup('backup'), /malformed/)
  h.setRemote(payload())
  await h.backup.reconcileAccountData('owner')
  assert.equal(await h.backup.reconcileAccountData('other'), 'foreign')
  assert.equal(h.store.get('@local_data_owner'), 'owner')
})

test('端末のデータ消去だけでも、通信待ちの復元を無効にする', async () => {
  const requested = deferred<void>()
  const response = deferred<any>()
  const h = harness({ query: async () => { requested.resolve(); return response.promise } })
  const run = h.backup.reconcileAccountData('old-user')
  await requested.promise
  const clearing = h.clear()
  response.resolve(payload())
  const [result] = await Promise.all([run, clearing])
  assert.equal(result, 'cancelled')
  assert.deepEqual([...h.store.keys()], [])
})

test('復元の一部の書き込みが失敗しても、残りを終えるまで消去を待たせる', async () => {
  const writing = deferred<void>()
  const finishWrite = deferred<void>()
  const h = harness({
    saveGadgets: async () => { throw new Error('disk failure') },
    savePlans: async () => { writing.resolve(); await finishWrite.promise },
  })
  const restoring = h.backup.restoreBackup('backup').catch((error: any) => error)
  await writing.promise
  let cleared = false
  const clearing = h.clear().then(() => { cleared = true })
  await new Promise<void>((resolve) => setImmediate(resolve))
  const clearedBeforeWriteFinished = cleared
  finishWrite.resolve()
  const [error] = await Promise.all([restoring, clearing])
  assert.match(error.message, /disk failure/)
  assert.equal(clearedBeforeWriteFinished, false)
  assert.deepEqual([...h.store.keys()], [])
})

test('Proの最後の外観をログアウト直前の控えへ保存し、別の色を使った端末への再ログインでも戻す', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'pro-user')
  h.store.set('app_theme', 'dark')
  h.store.set('app_accent', 'purple')
  assert.equal(await h.backup.saveAccountSnapshotNow('pro-user'), 'done')
  const saved = h.uploads[0].payload
  assert.equal(saved.version, 6)
  assert.equal(saved.appearance.themeMode, 'dark')
  assert.equal(saved.appearance.accentKey, 'purple')
  await h.clear()
  h.store.set('app_theme', 'light')
  h.store.set('app_accent', 'green')
  h.setRemote(saved)
  assert.equal(await h.backup.reconcileAccountData('pro-user'), 'restored')
  assert.equal(h.store.get('app_theme'), 'dark')
  assert.equal(h.store.get('app_accent'), 'purple')
})

test('ゲストの持ち物を合わせる再ログインでも、外観はアカウントに保存した色を優先する', async () => {
  const h = harness()
  h.store.set('@desk_gadgets', JSON.stringify(payload('guest-data').gadgets))
  h.store.set('@account_sign_in_pending', '1')
  h.store.set('app_accent', 'orange')
  h.setRemote({ ...payload('account-data'), appearance: { themeMode: 'dark', accentKey: 'blue' } })
  assert.equal(await h.backup.reconcileAccountData('pro-user'), 'merged')
  assert.equal(h.store.get('app_accent'), 'blue')
  assert.deepEqual(JSON.parse(h.store.get('@desk_gadgets') ?? '[]').map((item: any) => item.id), ['account-data', 'guest-data'])
})

test('別アカウントのデータが残っている場合は、テーマも勝手に復元しない', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'old-user')
  h.store.set('@desk_gadgets', JSON.stringify(payload().gadgets))
  h.store.set('app_accent', 'green')
  h.setRemote({ ...payload(), appearance: { accentKey: 'blue' } })
  assert.equal(await h.backup.reconcileAccountData('new-user'), 'foreign')
  assert.equal(h.store.get('app_accent'), 'green')
})

test('外観を持たない旧バックアップや壊れた設定は端末の設定を上書きしない', async () => {
  for (const appearance of [undefined, { themeMode: 'broken', accentKey: 'broken' }, ['dark']]) {
    const h = harness()
    h.store.set('app_theme', 'dark')
    h.store.set('app_accent', 'teal')
    h.setRemote({ ...payload(), appearance })
    await h.backup.reconcileAccountData('user')
    assert.equal(h.store.get('app_theme'), 'dark')
    assert.equal(h.store.get('app_accent'), 'teal')
  }
})

test('バックアップの復元を取り消すと、復元前のテーマカラーも戻る', async () => {
  const h = harness()
  h.store.set('app_theme', 'dark')
  h.store.set('app_accent', 'purple')
  h.setRemote({ ...payload(), appearance: { themeMode: 'light', accentKey: 'green' } })
  await h.backup.restoreBackup('backup')
  assert.equal(h.store.get('app_accent'), 'green')
  await h.backup.undoRestore()
  assert.equal(h.store.get('app_theme'), 'dark')
  assert.equal(h.store.get('app_accent'), 'purple')
})

test('自作ジャンルの一覧をバックアップに含め、復元と取り消しで戻す', async () => {
  const h = harness()
  const before = [{ id: 'cat-before', name: '前のジャンル', icon: 'star' }]
  h.store.set('@custom_categories_v1', JSON.stringify(before))
  assert.deepEqual((await h.backup.buildBackupPayload()).customCategories, before)

  const restored = [{ id: 'cat-unused', name: 'まだ使っていないジャンル', icon: 'tag' }]
  h.setRemote({ ...payload(), customCategories: [...restored, { id: '', name: '壊れた行' }] })
  await h.backup.restoreBackup('backup', { allowPartial: true })
  assert.deepEqual(JSON.parse(h.store.get('@custom_categories_v1')!), restored)
  await h.backup.undoRestore()
  assert.deepEqual(JSON.parse(h.store.get('@custom_categories_v1')!), before)
})

test('自作ジャンルを持たないバックアップを復元しても、端末の一覧を消さない', async () => {
  const h = harness()
  const local = [{ id: 'cat-local', name: '端末のジャンル', icon: 'star' }]
  h.store.set('@custom_categories_v1', JSON.stringify(local))
  h.setRemote(payload())
  await h.backup.restoreBackup('backup')
  assert.deepEqual(JSON.parse(h.store.get('@custom_categories_v1')!), local)
})

test('色を変えた直後にバックアップしても、設定の保存を待って最後の色を含める', async () => {
  const writing = deferred<void>()
  const finishWrite = deferred<void>()
  const h = harness({ saveAppearance: async () => { writing.resolve(); await finishWrite.promise } })
  const saving = h.appearance.saveAppearancePreferences({ accentKey: 'pink' })
  await writing.promise
  let backedUp = false
  const backup = h.backup.buildBackupPayload().then((value: any) => { backedUp = true; return value })
  await new Promise<void>(resolve => setImmediate(resolve))
  const finishedEarly = backedUp
  finishWrite.resolve()
  await saving
  assert.equal(finishedEarly, false)
  assert.equal((await backup).appearance.accentKey, 'pink')
})
test('バージョン1〜5の正常な旧バックアップを復元しても端末のダークテーマと色を消さない', async () => {
  for (const version of [1, 2, 3, 4, 5]) {
    const h = harness()
    h.store.set('app_theme', 'dark')
    h.store.set('app_accent', 'purple')
    const old = { ...payload(), version, deskHistories: { '@desk_history:old': [] } }
    if (version < 5) delete old.aiConversations
    h.setRemote(old)
    assert.equal(await h.backup.reconcileAccountData('user'), 'restored')
    assert.equal(h.store.get('app_theme'), 'dark')
    assert.equal(h.store.get('app_accent'), 'purple')
  }
})

test('別アプリ・未対応の版・壊れた公開対応表や履歴は端末を書き換える前に拒否する', async () => {
  for (const patch of [
    { app: 'OtherApp' }, { version: 0 }, { version: 7 }, { version: '3' }, { version: undefined },
    { publishLinks: { '@published_desk_old': 123 } }, { publishLinks: [] },
    { deskHistories: { '@desk_history:old': 'broken' } }, { deskHistories: [] },
    { gadgets: [null, {}] }, { plans: [{ name: 'missing id' }] },
  ]) {
    const h = harness()
    h.store.set('@desk_gadgets', JSON.stringify(payload('current').gadgets))
    h.store.set('app_accent', 'purple')
    h.setRemote({ ...payload('old'), ...patch })
    await assert.rejects(h.backup.restoreBackup('old'), /malformed/)
    assert.equal(h.writes.length, 0)
    assert.equal(JSON.parse(h.store.get('@desk_gadgets') ?? '[]')[0].id, 'current')
    assert.equal(h.store.get('app_accent'), 'purple')
  }
})

test('古いガジェットのポートにnullが混ざっていても復元後の詳細画面を落とさない', async () => {
  const h = harness()
  const old = payload()
  old.version = 3
  old.gadgets[0].ports = [null, { id: 'hdmi', type: 'HDMI', direction: 'input', count: 1 }]
  h.setRemote(old)
  await h.backup.restoreBackup('old')
  const gadget = JSON.parse(h.store.get('@desk_gadgets') ?? '[]')[0]
  assert.doesNotThrow(() => gadget.ports.some((port: any) => port.type === 'HDMI'))
  assert.equal(gadget.ports.length, 1)
})

test('旧デスクの配置・必要ケーブル・警告・解除した接続の欠けを復元前に補う', async () => {
  const h = harness()
  const old = payload()
  old.version = 3
  old.plans = [{
    id: 'old', name: 'old', createdAt: '', updatedAt: '', selectedGadgetIds: ['restored'],
    placements: [null, { gadgetId: 'restored', zone: 'center' }],
    wiringResult: { connections: [], warnings: null },
    connectionMap: { connections: [], dismissedPairs: [null, 'a::b'] },
  }]
  h.setRemote(old)
  await h.backup.restoreBackup('old')
  const plan = JSON.parse(h.store.get('@desk_plans') ?? '[]')[0]
  assert.doesNotThrow(() => plan.placements.map((placement: any) => placement.gadgetId))
  assert.deepEqual(plan.wiringResult.requiredCables, [])
  assert.deepEqual(plan.wiringResult.warnings, [])
  assert.deepEqual(plan.connectionMap.dismissedPairs, ['a::b'])
})

test('同じ本人の端末データがすでに同期済みなら古いバックアップを取り直さない', async () => {
  const h = harness({ query: async () => { throw new Error('should not fetch old backup') } })
  h.store.set('@local_data_owner', 'user')
  h.store.set('@desk_gadgets', JSON.stringify(payload('current').gadgets))
  h.store.set('app_accent', 'purple')
  assert.equal(await h.backup.reconcileAccountData('user'), 'not-needed')
  assert.equal(JSON.parse(h.store.get('@desk_gadgets') ?? '[]')[0].id, 'current')
  assert.equal(h.store.get('app_accent'), 'purple')
})
test('古いバックアップを復元してから取り消しても、元の端末に残る旧形式の履歴を消さない', async () => {
  const h = harness()
  const original = [{ timestamp: '2026-08-01T00:00:00Z', planName: 'original desk' }]
  h.store.set('@desk_history:original', JSON.stringify(original))
  h.setRemote({ ...payload(), version: 3, deskHistories: { '@desk_history:old': [] } })
  await h.backup.restoreBackup('old')
  assert.equal(h.store.has('@desk_history:old'), true)
  await h.backup.undoRestore()
  assert.deepEqual(JSON.parse(h.store.get('@desk_history:original') ?? '[]'), original)
  assert.equal(h.store.has('@desk_history:old'), false)
})
test('再ログインの控え取得が中断に反応しなくても失敗へ戻り、次のログイン操作を塞がない', async () => {
  const old = deferred<any>()
  const h = harness({ restoreTimeoutMs: 10, query: async user => user === 'old' ? old.promise : payload('new-data') })
  assert.equal(await h.backup.reconcileAccountData('old'), 'failed')
  assert.equal(h.store.has('@local_data_owner'), false)
  assert.equal(h.store.has('@desk_gadgets'), false)
  assert.equal(await h.backup.reconcileAccountData('new'), 'restored')
  old.resolve(payload('old-data'))
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(h.store.get('@local_data_owner'), 'new')
  assert.deepEqual(JSON.parse(h.store.get('@desk_gadgets') ?? '[]').map((item: any) => item.id), ['new-data'])
})

test('復元の一部の書き込みが失敗したら、内容・外観・公開対応・履歴を復元前へ巻き戻す', async () => {
  let fail = true
  const h = harness({ savePlans: async () => { if (fail) { fail = false; throw new Error('disk failure') } } })
  h.store.set('@local_data_owner', 'me')
  h.store.set('@desk_gadgets', JSON.stringify(payload('original').gadgets))
  h.store.set('@desk_plans', '[]')
  h.store.set('@ai_conversations_v2', '[]')
  h.store.set('@published_desk_original', 'published')
  h.store.set('@desk_history:original', '[{"original":true}]')
  h.store.set('app_theme', 'dark')
  h.store.set('app_accent', 'purple')
  const original = new Map(h.store)
  await assert.rejects(h.backup.restoreBackup('backup'), /disk failure/)
  for (const [key, value] of original) assert.equal(h.store.get(key), value, key)
  assert.equal(h.store.has('@backup_restore_journal'), false)
  assert.equal(await h.backup.hasRestorePoint(), true)
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'recovery-pending')
  assert.equal(h.uploads.length, 0)
})

test('巻き戻しも失敗した記録は残し、再起動で退避内容へ戻してから一覧を使える', async () => {
  const h = harness({ write: async (key, value) => {
    if (key === '@ai_conversations_v2') throw new Error('disk failure')
    if (key === '@desk_gadgets' && value.includes('original')) throw new Error('rollback failure')
  } })
  h.store.set('@local_data_owner', 'me')
  h.store.set('@desk_gadgets', JSON.stringify(payload('original').gadgets))
  h.store.set('@desk_plans', '[]')
  h.store.set('@ai_conversations_v2', '[]')
  await assert.rejects(h.backup.restoreBackup('backup'), /disk failure/)
  assert.equal(h.store.has('@backup_restore_journal'), true)
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'recovery-pending')
  const reboot = harness({ store: h.store })
  assert.equal(await reboot.backup.recoverInterruptedRestore(), true)
  assert.equal(reboot.store.has('@backup_restore_journal'), false)
  assert.deepEqual(JSON.parse(reboot.store.get('@desk_gadgets')!).map((row: any) => row.id), ['original'])
  assert.equal(await reboot.backup.recoverInterruptedRestore(), false)
  assert.equal(await reboot.backup.saveAccountSnapshotNow('me'), 'recovery-pending')
})

test('復旧記録を保存できなければ、本体への復元書き込みを始めない', async () => {
  const h = harness({ write: async key => { if (key === '@backup_restore_journal') throw new Error('no space') } })
  h.store.set('@desk_gadgets', JSON.stringify(payload('original').gadgets))
  await assert.rejects(h.backup.restoreBackup('backup'), /no space/)
  assert.deepEqual(JSON.parse(h.store.get('@desk_gadgets')!).map((row: any) => row.id), ['original'])
  assert.equal(h.writes.includes('@desk_gadgets'), false)
})

test('壊れた退避・不正な復旧キーは消さずに止め、認証情報へ書き戻さない', async () => {
  const h = harness()
  h.store.set('@backup_restore_point', '{broken')
  await assert.rejects(h.backup.undoRestore())
  assert.equal(h.store.get('@backup_restore_point'), '{broken')
  const snapshot = await h.recovery.captureRestoreSnapshot()
  snapshot.entries.push(['auth_token', 'unsafe'])
  h.store.set('@backup_restore_journal', JSON.stringify(snapshot))
  await assert.rejects(h.backup.recoverInterruptedRestore(), /INVALID/)
  assert.equal(h.store.has('auth_token'), false)
  assert.equal(h.store.has('@backup_restore_journal'), true)
})

test('別の世代を続けて試しても、取り消すと最初の復元前へ戻る', async () => {
  const h = harness()
  h.store.set('@desk_gadgets', JSON.stringify(payload('original').gadgets))
  await h.backup.restoreBackup('first')
  const point = h.store.get('@backup_restore_point')
  h.setRemote(payload('second'))
  await h.backup.restoreBackup('second')
  assert.equal(h.store.get('@backup_restore_point'), point)
  await h.backup.undoRestore()
  assert.deepEqual(JSON.parse(h.store.get('@desk_gadgets')!).map((row: any) => row.id), ['original'])
  assert.equal(await h.backup.hasPendingBackupRecovery(), false)
})

test('元の履歴JSONが壊れていても加工せず退避し、復元取り消しで原本を保つ', async () => {
  const h = harness()
  h.store.set('@desk_gadgets', JSON.stringify(payload('original').gadgets))
  h.store.set('@desk_history:original', '{broken-history')
  await h.backup.restoreBackup('backup')
  await h.backup.undoRestore()
  assert.equal(h.store.get('@desk_history:original'), '{broken-history')
})

test('自動復元は壊れた行を黙って省かず、手動で確認して部分復元できる', async () => {
  const h = harness()
  const damaged = payload()
  damaged.gadgets.push(null)
  damaged.aiConversations = [{ id: 'chat', messages: [{ content: '残す本文' }, null] }]
  h.setRemote(damaged)
  assert.equal(await h.backup.reconcileAccountData('me'), 'needs-review')
  assert.equal(h.store.has('@desk_gadgets'), false)
  assert.equal(h.store.has('@local_data_owner'), false)
  const preview = await h.backup.getBackupPreview('backup')
  assert.equal(preview.removedItems, 2)
  assert.equal(preview.gadgets, 1)
  await assert.rejects(h.backup.restoreBackup('backup'), /confirmation/)
  await h.backup.restoreBackup('backup', { allowPartial: true })
  assert.equal(JSON.parse(h.store.get('@ai_conversations_v2')!)[0].messages[0].content, '残す本文')
})

test('旧形式の壊れた付属データは確認後に除外し、正常な本体を救出できる', async () => {
  const h = harness()
  h.setRemote({ ...payload(), aiConversations: { broken: true }, publishLinks: { bad: 123 }, deskHistories: { '@desk_history:bad': 'bad' } })
  const preview = await h.backup.getBackupPreview('backup')
  assert.equal(preview.removedItems, 3)
  await h.backup.restoreBackup('backup', { allowPartial: true })
  assert.equal(JSON.parse(h.store.get('@desk_gadgets')!).length, 1)
  assert.equal(h.store.has('@desk_history:bad'), false)
  assert.equal(await h.backup.hasPendingBackupRecovery(), true)
})

test('確認するまで新しい保存を止め、明示的な確認で退避を解除して保存を再開する', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  await h.backup.restoreBackup('backup')
  assert.equal(await h.backup.runAutoBackupIfDue('me'), 'recovery-pending')
  await h.backup.confirmBackupRecovery('me')
  assert.equal(await h.backup.hasRestorePoint(), true)
  assert.equal(await h.backup.hasPendingBackupRecovery(), false)
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  assert.equal(await h.backup.hasRestorePoint(), false)
  assert.equal(h.uploads.length, 1)
})

test('途中復元が残る間や本人以外のアカウントからは、確認を確定しない', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'old')
  h.store.set('@backup_recovery_pending', '1')
  await assert.rejects(h.backup.confirmBackupRecovery('new'), /ACCOUNT_DATA_CHANGED/)
  const snapshot = await h.recovery.captureRestoreSnapshot()
  h.store.set('@backup_restore_journal', JSON.stringify(snapshot))
  await assert.rejects(h.backup.confirmBackupRecovery('old'), /RECOVERY_REQUIRED/)
  assert.equal(h.store.get('@backup_recovery_pending'), '1')
})

test('新しいバックアップでは1MBを超えるAI相談も省かず、写真の参照も残して保存する', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  const text = 'x'.repeat(1100 * 1024)
  h.store.set('@ai_conversations_v2', JSON.stringify([
    { id: 'large', updatedAt: '2026-10-04', messages: [{ content: text, imageUri: 'file:///local.jpg' }] },
    { id: 'small', updatedAt: '2026-10-03', messages: [{ content: '残す本文' }] },
  ]))
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  assert.equal(h.uploads[0].payload.aiConversations.length, 2)
  assert.equal(h.uploads[0].payload.aiConversations[0].messages[0].content, text)
  // 同じ端末へ世代を戻したときに残っている写真を外さない。別の端末では復元時に外す
  assert.equal(h.uploads[0].payload.aiConversations[0].messages[0].imageUri, 'file:///local.jpg')
})

test('新しい保存が容量超過ならAI本文を削らず、正常なクラウド世代・保存時刻を変更しない', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  h.store.set('@backup_last_at', '2026-01-01T00:00:00Z')
  h.store.set('@ai_conversations_v2', JSON.stringify([{ id: 'large', messages: [{ content: 'あ'.repeat(1500000) }] }]))
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'too-large')
  assert.equal(h.uploads.length, 0)
  assert.equal(h.store.get('@backup_last_at'), '2026-01-01T00:00:00Z')
  assert.equal(JSON.parse(h.store.get('@ai_conversations_v2')!)[0].messages[0].content.length, 1500000)
})

test('壊れた端末データを修復読み込みで省いたまま、新しいバックアップとして上書きしない', async () => {
  for (const [key, value] of [
    ['@desk_gadgets', '{broken'], ['@desk_plans', JSON.stringify([null])],
    ['@desk_gadgets', JSON.stringify([{ id: 'same' }, { id: 'same' }])],
    ['@ai_conversations_v2', JSON.stringify([{ id: 'chat', messages: [null] }])],
    ['@ai_conversations_v2', JSON.stringify([{ id: 'chat', messages: 'broken' }])],
  ]) {
    const h = harness()
    h.store.set('@local_data_owner', 'me')
    h.store.set(key, value)
    assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'invalid-data', key)
    assert.equal(h.uploads.length, 0)
    assert.equal(h.store.has('@backup_last_at'), false)
    assert.equal(h.store.get(key), value)
  }
})

test('ログイン時の突き合わせが失敗した本人の端末からも、自動で新しい控えを保存しない', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  h.store.set('@account_sign_in_pending', '1')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'not-synced')
  assert.equal(h.uploads.length, 0)
})

test('送信エラー後は保存時刻を進めず、次の保存で再試行する', async () => {
  let failing = true
  const h = harness({ upload: async () => ({ error: failing ? new Error('offline') : null }) })
  h.store.set('@local_data_owner', 'me')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'failed')
  assert.equal(h.store.has('@backup_last_at'), false)
  failing = false
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  assert.equal(h.uploads.length, 2)
  assert.equal(h.store.has('@backup_last_at'), true)
})

test('送信が返らなくてもUIの待機を解き、再試行で同じ自動保存を二重送信しない', async () => {
  const response = deferred<any>()
  const h = harness({ restoreTimeoutMs: 10, upload: () => response.promise })
  h.store.set('@local_data_owner', 'me')
  assert.equal(await h.backup.runAutoBackupIfDue('me'), 'failed')
  assert.equal(await h.backup.runAutoBackupIfDue('me'), 'failed')
  assert.equal(h.uploads.length, 1)
  response.resolve({ error: null })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(await h.backup.runAutoBackupIfDue('me'), 'not-due')
})

test('送信待ちの自動保存をログアウトの控えに使い回さず、直前の編集を取り直して保存する', async () => {
  const started = deferred<void>()
  const response = deferred<any>()
  let uploads = 0
  const h = harness({ upload: async () => { uploads++; if (uploads === 1) { started.resolve(); return response.promise }; return { error: null } } })
  h.store.set('@local_data_owner', 'me')
  h.store.set('@desk_gadgets', JSON.stringify(payload('before').gadgets))
  const automatic = h.backup.runAutoBackupIfDue('me')
  await started.promise
  h.store.set('@desk_gadgets', JSON.stringify(payload('latest').gadgets))
  const logoutSnapshot = h.backup.saveAccountSnapshotNow('me')
  response.resolve({ error: null })
  assert.deepEqual(await Promise.all([automatic, logoutSnapshot]), ['done', 'done'])
  assert.equal(h.uploads.length, 2)
  assert.equal(h.uploads[1].payload.gadgets[0].id, 'latest')
})

test('同時の手動バックアップは同じ送信を共有し、自動保存待ちでも最新の手動送信を一度だけ追加する', async () => {
  for (const automatic of [false, true]) {
    const started = deferred<void>()
    const response = deferred<any>()
    let calls = 0
    const h = harness({ upload: async () => { if (++calls === 1) { started.resolve(); return response.promise }; return { error: null } } })
    h.store.set('@local_data_owner', 'me')
    h.store.set('@desk_gadgets', JSON.stringify(payload('before').gadgets))
    const first = automatic ? h.backup.runAutoBackupIfDue('me') : h.backup.saveAccountSnapshotNow('me')
    await started.promise
    h.store.set('@desk_gadgets', JSON.stringify(payload('latest').gadgets))
    const burst = Array.from({ length: 5 }, () => h.backup.saveAccountSnapshotNow('me'))
    response.resolve({ error: null })
    assert.deepEqual(await Promise.all([first, ...burst]), Array(6).fill('done'))
    assert.equal(h.uploads.length, automatic ? 2 : 1)
    if (automatic) assert.equal(h.uploads[1].payload.gadgets[0].id, 'latest')
  }
})

test('同じ復元の連打とUIタイムアウト後の再試行で実際の書き込みを重ねない', async () => {
  const started = deferred<void>()
  const finish = deferred<void>()
  let applies = 0
  const h = harness({ restoreTimeoutMs: 10, savePlans: async () => { applies++; started.resolve(); await finish.promise } })
  h.store.set('@local_data_owner', 'me')
  const first = h.backup.restoreBackup('backup')
  const firstResult = assert.rejects(first, /timed out/)
  await started.promise
  await firstResult
  await assert.rejects(h.backup.restoreBackup('backup'), /timed out/)
  assert.equal(applies, 1)
  finish.resolve()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(applies, 1)
  assert.equal(h.store.has('@backup_restore_point'), true)
})

test('手動バックアップがタイムアウトした後の再試行でも、進行中の送信を一度だけ実行する', async () => {
  const response = deferred<any>()
  const h = harness({ restoreTimeoutMs: 10, upload: () => response.promise })
  h.store.set('@local_data_owner', 'me')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'failed')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'failed')
  assert.equal(h.uploads.length, 1)
  response.resolve({ error: null })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(h.uploads.length, 1)
  assert.equal(h.store.has('@backup_last_at'), true)
})

test('手動バックアップの送信中にログアウトした場合も、最新の編集を改めて保存する', async () => {
  const started = deferred<void>()
  const response = deferred<any>()
  let calls = 0
  const h = harness({ upload: async () => { if (++calls === 1) { started.resolve(); return response.promise }; return { error: null } } })
  h.store.set('@local_data_owner', 'me')
  h.store.set('@desk_gadgets', JSON.stringify(payload('before').gadgets))
  const first = h.backup.saveAccountSnapshotNow('me')
  await started.promise
  h.store.set('@desk_gadgets', JSON.stringify(payload('latest').gadgets))
  const logout = h.backup.saveAccountSnapshotNow('me', { freshAfterPending: true })
  const repeated = h.backup.saveAccountSnapshotNow('me', { freshAfterPending: true })
  response.resolve({ error: null })
  assert.deepEqual(await Promise.all([first, logout, repeated]), ['done', 'done', 'done'])
  assert.equal(h.uploads.length, 2)
  assert.equal(h.uploads[1].payload.gadgets[0].id, 'latest')
})

test('同じ取り消しを同時に実行しても退避データを一度だけ適用する', async () => {
  let block = false
  let applies = 0
  const started = deferred<void>()
  const finish = deferred<void>()
  const h = harness({ write: async key => { if (block && key === '@desk_plans') { applies++; started.resolve(); await finish.promise } } })
  h.store.set('@local_data_owner', 'me')
  h.store.set('@desk_gadgets', JSON.stringify(payload('original').gadgets))
  h.store.set('@desk_plans', '[]')
  await h.backup.restoreBackup('backup')
  block = true
  const first = h.backup.undoRestore()
  await started.promise
  const second = h.backup.undoRestore()
  finish.resolve()
  await Promise.all([first, second])
  assert.equal(applies, 1)
  assert.equal(JSON.parse(h.store.get('@desk_gadgets')!)[0].id, 'original')
})

test('バックアップ通信待ちは復元やログアウト消去を塞がず、遅い旧応答は新しい利用者の保存時刻を書かない', async () => {
  const started = deferred<void>()
  const response = deferred<any>()
  const h = harness({ upload: async () => { started.resolve(); return response.promise } })
  h.store.set('@local_data_owner', 'old')
  const saving = h.backup.saveAccountSnapshotNow('old')
  await started.promise
  await h.clear()
  h.store.set('@local_data_owner', 'new')
  response.resolve({ error: null })
  await saving
  assert.equal(h.store.has('@backup_last_at'), false)
  assert.equal(h.store.get('@local_data_owner'), 'new')
})

test('復元中に自動保存を要求しても、書き込み途中や確認前の内容を送信しない', async () => {
  const started = deferred<void>()
  const finish = deferred<void>()
  const h = harness({ savePlans: async () => { started.resolve(); await finish.promise } })
  h.store.set('@local_data_owner', 'me')
  const restoring = h.backup.restoreBackup('backup')
  await started.promise
  const saving = h.backup.runAutoBackupIfDue('me')
  finish.resolve()
  await restoring
  assert.equal(await saving, 'recovery-pending')
  assert.equal(h.uploads.length, 0)
})

test('確認後のクラウド保存が失敗しても退避を残し、再保存に成功してから片付ける', async () => {
  let failure = true
  const h = harness({ upload: async () => ({ error: failure ? new Error('offline') : null }) })
  h.store.set('@local_data_owner', 'me')
  h.store.set('@desk_gadgets', JSON.stringify(payload('original').gadgets))
  await h.backup.restoreBackup('backup')
  const point = h.store.get('@backup_restore_point')
  await h.backup.confirmBackupRecovery('me')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'failed')
  assert.equal(h.store.get('@backup_restore_point'), point)
  failure = false
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  assert.equal(await h.backup.hasRestorePoint(), false)
})

test('テーマ保存の失敗も巻き戻し、失敗した設定キューで以後のバックアップを止めない', async () => {
  let failure = true
  const h = harness({ saveAppearance: async () => { if (failure) { failure = false; throw new Error('theme write failed') } } })
  h.store.set('@local_data_owner', 'me')
  h.store.set('app_theme', 'dark')
  h.store.set('app_accent', 'purple')
  h.setRemote({ ...payload(), appearance: { themeMode: 'light', accentKey: 'blue' } })
  await assert.rejects(h.backup.restoreBackup('backup'), /theme write failed/)
  const preferences = await h.appearance.readAppearancePreferences()
  assert.equal(preferences.themeMode, 'dark')
  assert.equal(preferences.accentKey, 'purple')
  await h.backup.confirmBackupRecovery('me')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
})

test('取り消し用の退避が壊れていても、明示確認後は原本を保管して別のバックアップを復元できる', async () => {
  const h = harness()
  h.store.set('@backup_restore_point', '{broken-original')
  h.store.set('@desk_gadgets', JSON.stringify(payload('current').gadgets))
  assert.equal((await h.backup.getBackupPreview('backup')).damagedRecoveryPoint, true)
  await assert.rejects(h.backup.restoreBackup('backup'), /INVALID/)
  assert.equal(h.store.has('@backup_damaged_restore_point'), false)
  await h.backup.restoreBackup('backup', { replaceDamagedPoint: true })
  assert.equal(h.store.get('@backup_damaged_restore_point'), '{broken-original')
  await h.backup.undoRestore()
  assert.deepEqual(JSON.parse(h.store.get('@desk_gadgets')!).map((row: any) => row.id), ['current'])
  assert.equal(h.store.get('@backup_damaged_restore_point'), '{broken-original')
  await h.clear()
  assert.equal(h.store.has('@backup_damaged_restore_point'), false)
})

test('起動後でも巻き戻しに失敗したら、編集を再開させないため復旧画面への通知を発火する', async () => {
  const h = harness({ write: async key => { if (key === '@desk_plans') throw new Error('disk failure') } })
  h.store.set('@desk_plans', '[]')
  let blocked = 0
  const unsubscribe = h.backup.subscribeBackupRecoveryFailure(() => { blocked++ })
  await assert.rejects(h.backup.restoreBackup('backup'), /disk failure/)
  assert.equal(blocked, 1)
  assert.equal(h.store.has('@backup_restore_journal'), true)
  unsubscribe()
})

test('確認済みの控えの遅い送信完了が、次の復元の途中で退避を削除しない', async () => {
  const response = deferred<any>()
  const sent = deferred<void>()
  const restoring = deferred<void>()
  const finishRestore = deferred<void>()
  let waitRestore = false
  const h = harness({
    upload: async () => { sent.resolve(); return response.promise },
    savePlans: async () => { if (waitRestore) { restoring.resolve(); await finishRestore.promise } },
  })
  h.store.set('@local_data_owner', 'me')
  h.store.set('@desk_gadgets', JSON.stringify(payload('original').gadgets))
  await h.backup.restoreBackup('first')
  await h.backup.confirmBackupRecovery('me')
  const point = h.store.get('@backup_restore_point')
  const saving = h.backup.saveAccountSnapshotNow('me')
  await sent.promise
  waitRestore = true
  h.setRemote(payload('second'))
  const restore = h.backup.restoreBackup('second')
  await restoring.promise
  response.resolve({ error: null })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(h.store.get('@backup_restore_point'), point)
  finishRestore.resolve()
  await Promise.all([saving, restore])
  assert.equal(h.store.get('@backup_restore_point'), point)
  assert.equal(await h.backup.hasPendingBackupRecovery(), true)
  await h.backup.undoRestore()
  assert.equal(JSON.parse(h.store.get('@desk_gadgets')!)[0].id, 'original')
})

test('重複IDの短い相談があっても除外件数を相殺せず、自動復元で本文を黙って落とさない', async () => {
  const h = harness()
  h.setRemote({ ...payload(), aiConversations: [
    { id: 'same', messages: [{ content: 'first' }, { content: 'second' }, { content: 'third' }] },
    { id: 'same', messages: [{ content: 'duplicate' }] },
  ] })
  assert.equal((await h.backup.getBackupPreview('backup')).removedItems, 1)
  assert.equal(await h.backup.reconcileAccountData('me'), 'needs-review')
  assert.equal(h.store.has('@ai_conversations_v2'), false)
  await h.backup.restoreBackup('backup', { allowPartial: true })
  assert.equal(JSON.parse(h.store.get('@ai_conversations_v2')!)[0].messages.length, 3)
})

test('復元の保存が停止したら待機を解除して編集停止を通知し、実際の保存と巻き戻しは直列にする', async () => {
  const gate = deferred<void>()
  const h = harness({ restoreTimeoutMs: 10, saveGadgets: () => gate.promise })
  h.store.set('@desk_gadgets', JSON.stringify(payload('original').gadgets))
  let blocked = 0
  h.backup.subscribeBackupRecoveryFailure(() => { blocked++ })
  await assert.rejects(h.backup.restoreBackup('backup'), /timed out/)
  assert.equal(blocked, 1)
  assert.equal(h.store.has('@backup_restore_journal'), true)
  const undo = h.backup.undoRestore()
  gate.resolve()
  await undo
  assert.deepEqual(JSON.parse(h.store.get('@desk_gadgets')!).map((row: any) => row.id), ['original'])
  assert.equal(h.store.has('@backup_restore_journal'), false)
})

test('別の端末が送った新しい控えがあれば自動では上書きせず、本人が選んだときだけ上書きする', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  h.store.set('@backup_base', JSON.stringify({ id: 'mine', hash: null }))
  h.setHead({ id: 'from-ipad', device_id: 'ipad' })
  assert.equal(await h.backup.runAutoBackupIfDue('me'), 'conflict')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'conflict')
  assert.equal(h.uploads.length, 0)
  assert.equal(h.store.has('@backup_last_at'), false)
  assert.equal(await h.backup.saveAccountSnapshotNow('me', { overwriteNewer: true }), 'done')
  assert.equal(h.uploads.length, 1)
  assert.equal(JSON.parse(h.store.get('@backup_base')!).id, h.uploads[0].id)
})

test('送信の応答だけ失われた控えは自分のものとして扱い、別の端末の控えと取り違えない', async () => {
  const h = harness({ upload: async () => ({ error: new Error('response lost') }) })
  h.store.set('@local_data_owner', 'me')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'failed')
  // 実際には行が入っていた
  h.setHead({ id: h.uploads[0].id, device_id: h.uploads[0].device_id })
  const ok = harness({ store: h.store })
  ok.setHead({ id: h.uploads[0].id, device_id: 'cloned-device' })
  assert.equal(await ok.backup.saveAccountSnapshotNow('me'), 'done')
})

test('基点を持つ前の端末は、最新の控えが自分の端末のものなら送り、別の端末のものなら止まる', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  h.store.set('@backup_device_id', 'this-phone')
  h.setHead({ id: 'old', device_id: 'this-phone' })
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  const other = harness()
  other.store.set('@local_data_owner', 'me')
  other.store.set('@backup_device_id', 'this-phone')
  other.setHead({ id: 'old', device_id: 'other-phone' })
  assert.equal(await other.backup.saveAccountSnapshotNow('me'), 'conflict')
})

test('最新の控えと同じ内容なら行を足さず、Pro の世代を同じ内容で埋めない', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  assert.equal(h.uploads.length, 1)
  h.store.set('@desk_gadgets', JSON.stringify([{ id: 'new', name: 'new', category: 'Monitor', ports: [], createdAt: '2026-10-01' }]))
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  assert.equal(h.uploads.length, 2)
})

test('文字化けした文字を含む控えは送らず、サーバーの拒否も理由のわかる結果にする', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  h.store.set('@desk_gadgets', JSON.stringify([{ id: 'g', name: 'ã\u0081\u0082', category: 'Monitor', ports: [], createdAt: '2026-10-01' }]))
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'garbled-text')
  assert.equal(h.uploads.length, 0)
  const rejected = harness({ upload: async () => ({ error: { code: '22021', message: 'mojibake_detected' } }) })
  rejected.store.set('@local_data_owner', 'me')
  assert.equal(await rejected.backup.saveAccountSnapshotNow('me'), 'garbled-text')
  const tooLarge = harness({ upload: async () => ({ error: { code: '23514', message: 'backups_payload_max_bytes' } }) })
  tooLarge.store.set('@local_data_owner', 'me')
  assert.equal(await tooLarge.backup.saveAccountSnapshotNow('me'), 'too-large')
})

test('空の端末へ欠けなく戻したら確認待ちにせず、戻した控えを基点に保存を続ける', async () => {
  const h = harness()
  h.setRemote(payload('account'), 'account-backup')
  h.setHead({ id: 'account-backup', device_id: 'old-phone' })
  assert.equal(await h.backup.reconcileAccountData('me'), 'restored')
  assert.equal(await h.backup.hasPendingBackupRecovery(), false)
  assert.equal(await h.backup.hasRestorePoint(), false)
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
  assert.equal(h.uploads.length, 1)
})

test('ログイン前のデータと合わせた場合は、確認が済むまで保存を止める', async () => {
  const h = harness()
  h.store.set('@account_sign_in_pending', '1')
  h.store.set('@desk_gadgets', JSON.stringify([{ id: 'guest', name: 'guest', category: 'Monitor', ports: [], createdAt: '2026-10-01' }]))
  h.setRemote(payload('account'), 'account-backup')
  assert.equal(await h.backup.reconcileAccountData('me'), 'merged')
  assert.equal(await h.backup.runAutoBackupIfDue('me'), 'recovery-pending')
})

test('古い世代を選んで戻しても、確認後の保存はサーバーの最新を基点にして止まらない', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  h.setHead({ id: 'newest', device_id: 'this-phone' })
  await h.backup.restoreBackup('older')
  await h.backup.confirmBackupRecovery('me')
  assert.equal(await h.backup.saveAccountSnapshotNow('me'), 'done')
})

test('世代を戻すと作成途中の下書きを捨て、取り消すと下書きも戻る', async () => {
  const h = harness()
  h.store.set('@local_data_owner', 'me')
  h.store.set('@first_setup_draft_v1', '{"step":"gear"}')
  h.store.set('@product_fill_draft_v1:plan', '{"values":{}}')
  await h.backup.restoreBackup('backup')
  assert.equal(h.store.has('@first_setup_draft_v1'), false)
  assert.equal(h.store.has('@product_fill_draft_v1:plan'), false)
  await h.backup.undoRestore()
  assert.equal(h.store.get('@first_setup_draft_v1'), '{"step":"gear"}')
  assert.equal(h.store.get('@product_fill_draft_v1:plan'), '{"values":{}}')
})

test('ログイン時の突き合わせではログイン前の作成途中の下書きを捨てない', async () => {
  const h = harness()
  h.store.set('@account_sign_in_pending', '1')
  h.store.set('@first_setup_draft_v1', '{"step":"gear"}')
  assert.equal(await h.backup.reconcileAccountData('me'), 'restored')
  assert.equal(h.store.get('@first_setup_draft_v1'), '{"step":"gear"}')
})

test('止まった自動保存は1日1回まで知らせ、圏外の失敗は前回の保存が古いときだけ知らせる', async () => {
  const h = harness()
  assert.equal(await h.backup.takeBackupNotice('done'), null)
  assert.equal(await h.backup.takeBackupNotice('conflict'), 'conflict')
  assert.equal(await h.backup.takeBackupNotice('recovery-pending'), null)
  h.store.delete('@backup_notice_at')
  h.store.set('@backup_last_at', new Date().toISOString())
  assert.equal(await h.backup.takeBackupNotice('failed'), null)
  h.store.set('@backup_last_at', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString())
  assert.equal(await h.backup.takeBackupNotice('failed'), 'failed')
})
