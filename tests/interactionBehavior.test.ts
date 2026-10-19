import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { immediateRemoval } from './helpers/removalMotion'

function extract(file: string, predicate: (node: ts.Node, source: ts.SourceFile) => boolean): string {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => { if (predicate(node, source)) found = node; ts.forEachChild(node, visit) }
  visit(source)
  assert.ok(found, file)
  return found.getText(source)
}
function evaluate(code: string, bindings: Record<string, any>): any {
  const exported: any = {}
  runInNewContext(ts.transpileModule(`exports.value = (${code})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: exported, removal: immediateRemoval, ...bindings })
  return exported.value
}
function handler(file: string, name: string, bindings: Record<string, any>) {
  const declaration = extract(file, (node, source) => ts.isVariableDeclaration(node) && node.name.getText(source) === name)
  return evaluate(declaration.slice(declaration.indexOf('=') + 1), { useCallback: (fn: any) => fn, ...bindings })
}

test('他タブの登録・復元は自動選択せず、このデスクへ追加された機材だけを選ぶ', () => {
  const effect = extract('src/screens/GadgetSelectionScreen.tsx', node => ts.isCallExpression(node)
    && node.expression.getText() === 'useEffect' && node.getText().includes('const added = plan.selectedGadgetIds'))
  let selected = new Set<string>()
  const bindings: Record<string, any> = {
    useEffect: (run: () => void) => run(), knownPlanGadgetIdsRef: { current: new Set(['existing']) },
    plan: { selectedGadgetIds: ['existing'] }, gLoading: false, gLoadError: false,
    gadgets: [{ id: 'existing' }, { id: 'other-tab' }, { id: 'restored' }],
    setSelected: (update: (prev: Set<string>) => Set<string>) => { selected = update(selected) },
  }
  const run = () => evaluate(`() => ${effect}`, bindings)()
  run()
  assert.equal(selected.size, 0, '既存機材を手動で外した選択も維持する')
  bindings.plan = { selectedGadgetIds: ['existing', 'for-this-desk'] }
  run()
  assert.equal(selected.size, 0)
  bindings.gadgets.push({ id: 'for-this-desk' })
  run()
  assert.deepEqual([...selected], ['for-this-desk'])
})

for (const [file, setter, timerRef] of [
  ['src/screens/GadgetDetailScreen.tsx', 'setNameFocused', 'nameBlurTimerRef'],
  ['src/screens/DeskFeedScreen.tsx', 'setSearchFocused', 'searchBlurTimerRef'],
]) {
  test(`${setter}: 再フォーカスで古い閉じ予約を取り消し、離れたままなら候補を閉じる`, () => {
    let focused = true
    let nextTimer = 0
    const timers = new Map<number, () => void>()
    const bindings = {
      [setter]: (value: boolean) => { focused = value }, [timerRef]: { current: null },
      setTimeout: (run: () => void) => { const id = ++nextTimer; timers.set(id, run); return id },
      clearTimeout: (id: number) => timers.delete(id),
      searchText: '', searchQuery: '', normalizePublicDeskSearch: (text: string) => text, rememberSearch() {}, loadSuggestionGear() {},
    }
    const callback = (name: string) => {
      const attribute = extract(file, node => ts.isJsxAttribute(node) && node.name.getText() === name
        && !!node.initializer?.getText().includes(setter))
      return evaluate(attribute.slice(attribute.indexOf('{') + 1, -1), bindings)
    }
    const blur = callback('onBlur')
    const focus = callback('onFocus')
    blur()
    focus()
    assert.equal(timers.size, 0)
    assert.equal(focused, true)
    blur()
    blur()
    assert.equal(timers.size, 1)
    timers.forEach(run => run())
    timers.clear()
    assert.equal(focused, false)
    blur()
    const cleanupEffect = extract(file, node => ts.isCallExpression(node) && node.expression.getText() === 'useEffect'
      && node.getText().includes(`clearTimeout(${timerRef}.current)`))
    evaluate(`() => ${cleanupEffect}`, { ...bindings, useEffect: (run: () => () => void) => run()() })()
    assert.equal(timers.size, 0)
  })
}

test('追加後は対象の使用状況へ移り、お気に入り・検索で新しい機材を隠さない', () => {
  const effect = extract('src/screens/GadgetLibraryScreen.tsx', node => ts.isCallExpression(node)
    && node.expression.getText() === 'useFocusEffect' && node.getText().includes('pendingLibraryAddRef.current'))
  for (const status of ['current', 'unused']) {
    const changes: any[] = []
    const bindings: Record<string, any> = {
      useFocusEffect: (run: () => void) => run(), useCallback: (run: () => void) => run,
      active: true, libraryLoading: false, libraryLoadError: false,
      pendingLibraryAddRef: { current: new Set(['old']) }, gadgets: [{ id: 'new' }, { id: 'old' }],
      libraryUsage: new Map([['new', { status }]]), swipeableRefs: { current: new Map() },
      leaveSelectionMode: () => changes.push('leaveSelection'), setUsageFilter: (value: string) => changes.push(value),
      setFavoritesOnly: (value: boolean) => changes.push(value), setSearch: (value: string) => changes.push(value),
      setGroupMode: (value: string) => changes.push(value), listRef: { current: { scrollToOffset: () => changes.push('scroll') } },
      fallbackScrollRef: { current: null },
    }
    const run = () => evaluate(`() => ${effect}`, bindings)()
    bindings.libraryLoading = true
    run()
    assert.equal(changes.length, 0)
    assert.ok(bindings.pendingLibraryAddRef.current)
    bindings.libraryLoading = false
    run()
    assert.deepEqual(changes, ['leaveSelection', status, false, '', 'none', 'scroll'])
    assert.equal(bindings.pendingLibraryAddRef.current, null)
    changes.length = 0
    run()
    assert.equal(changes.length, 0, '別タブで登録しただけの場合は現在の絞り込みを変えない')
    bindings.pendingLibraryAddRef.current = new Set(['old', 'new'])
    run()
    assert.equal(changes.length, 0, '登録をキャンセルして戻った場合も現在の絞り込みを保つ')
  }
})

test('表示外の削除対象は名前・件数を確認に表示し、確認前には削除しない', async () => {
  for (const ja of [true, false]) {
    const dialogs: any[] = []
    const deleted: string[][] = []
    const run = handler('src/screens/GadgetLibraryScreen.tsx', 'confirmBulkDelete', {
      gadgets: [{ id: 'shown', name: '表示中' }, { id: 'hidden', name: '非表示の機材' }],
      selectedIds: new Set(['shown', 'hidden']), visibleGadgetIds: new Set(['shown']),
      bulkDeleteInFlightRef: { current: false }, ja, lang: ja ? 'ja' : 'en',
      localizedGadgetName: (gadget: { name: string }) => gadget.name,
      t: String, showConfirmation: (dialog: any) => dialogs.push(dialog),
      deleteGadgets: async (gadgets: { id: string }[]) => { deleted.push(gadgets.map(g => g.id)) },
      leaveSelectionMode() {}, setBulkDeleting() {}, showMessage() {},
    })
    run()
    assert.equal(deleted.length, 0)
    assert.match(dialogs[0].message, ja ? /表示外の1件/ : /1 hidden items/)
    assert.match(dialogs[0].message, /非表示の機材/)
    dialogs[0].onConfirm()
    await Promise.resolve()
    assert.deepEqual(Array.from(deleted[0]), ['shown', 'hidden'])
  }
})

test('一覧のピン留めは保存失敗を通知して確定扱いにせず、成功時だけ受け付ける', async () => {
  const alerts: string[] = []
  const bindings = {
    onBeforeAction() {}, lang: 'ja', togglePinned: async (): Promise<void> => { throw new Error('disk full') },
    Alert: { alert: (message: string) => alerts.push(message) },
  }
  const run = () => handler('src/hooks/useDeskActions.ts', 'togglePin', bindings)({ id: 'desk' })
  assert.equal(await run(), false)
  assert.deepEqual(alerts, ['ピン留めを変更できませんでした'])
  bindings.togglePinned = async () => {}
  assert.equal(await run(), true)
  assert.equal(alerts.length, 1)
})

test('案内の待機中や既読確認中に手動操作したら、遅れて自動案内を始めない', async () => {
  const source = extract('src/hooks/useSwipePeekHint.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'useSwipePeekHint')
    .replace(/^export\s+/, '')
  for (const phase of ['beforeTimer', 'duringRead']) {
    let version = 0
    let peeks = 0
    let timer!: () => void
    let resolveRead!: () => void
    const gate = new Promise<void>(resolve => { resolveRead = resolve })
    const useHint = evaluate(source, {
      useIsFocused: () => true, useSpotlight: () => ({ shown: false }),
      useEffect: (run: () => void) => run(), getSwipeInteractionVersion: () => version,
      peekSwipeableRow: () => { peeks++; return () => {} },
      AsyncStorage: { getItem: async () => { await gate; return null }, setItem: async () => {} },
      DELAY_MS: 700, MAX_ATTEMPTS: 4,
      setTimeout: (run: () => void) => { timer = run; return 1 }, clearTimeout() {},
    })
    useHint({ storageKey: 'hint', rowId: 'row', rows: { current: new Map([['row', {}]]) } })
    if (phase === 'beforeTimer') version++
    timer()
    if (phase === 'duringRead') version++
    resolveRead()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(peeks, 0)
  }
})
