import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function harness(loggingFails = false) {
  const slots: any[] = []
  let cursor = 0
  let lang = 'ja'
  const effects: Array<() => (() => void)> = []
  const memo = (create: () => any, deps: any[]) => {
    const index = cursor++
    const previous = slots[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) slots[index] = { deps, value: create() }
    return slots[index].value
  }
  const react = {
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], (value: any) => { slots[index] = value }]
    },
    useRef: (initial: any) => { const index = cursor++; return slots[index] ??= { current: initial } },
    useMemo: memo,
    useCallback: (callback: any, deps: any[]) => memo(() => callback, deps),
    useEffect: (run: () => (() => void), deps: any[]) => memo(() => { effects.push(run); return undefined }, deps),
  }
  const timers = new Map<number, () => void>()
  let nextTimer = 0
  const alerts: any[][] = []
  const reports: string[] = []
  const exported: any = {}
  const source = ts.transpileModule(readFileSync('src/hooks/useUndoSnackbar.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(source, {
    exports: exported, Promise,
    setTimeout: (run: () => void) => { const id = nextTimer++; timers.set(id, run); return id },
    clearTimeout: (id: number) => { timers.delete(id) },
    require: (id: string) => {
      if (id === 'react') return react
      if (id.endsWith('/alert')) return { Alert: { alert: (...args: any[]) => { alerts.push(args) } } }
      if (id.endsWith('/AppContext')) return { useApp: () => ({ lang }) }
      if (id.endsWith('/analytics')) return { analytics: { error: (operation: string) => { reports.push(operation); if (loggingFails) throw new Error('logger unavailable') } } }
      throw new Error(id)
    },
  })
  const cleanup: (() => void)[] = []
  return {
    timers, alerts, reports,
    render: () => {
      cursor = 0
      const hook = exported.useUndoSnackbar()
      effects.splice(0).forEach(run => { cleanup.push(run()) })
      return hook
    },
    language: (value: string) => { lang = value },
    unmount: () => { cleanup.forEach(run => run()) },
    expire: () => { const [id, run] = [...timers.entries()][0]; timers.delete(id); run() },
  }
}

test('同期・非同期の復旧失敗でもボタンを残し、記録が失敗しても再試行できる', async () => {
  for (const synchronous of [true, false]) {
    const h = harness(true)
    let attempts = 0
    let expired = 0
    h.render().showUndo({
      message: 'deleted', onExpire: () => { expired++ },
      onUndo: () => {
        if (++attempts > 1) return Promise.resolve()
        if (synchronous) throw new Error('storage failed')
        return Promise.reject(new Error('storage failed'))
      },
    })
    await assert.doesNotReject(h.render().undo())
    assert.equal(h.render().visible, true)
    assert.equal(h.render().undoing, false)
    assert.equal(h.timers.size, 0)
    assert.equal(h.alerts.length, 1)
    h.alerts[0][2][1].onPress()
    await flush()
    assert.equal(attempts, 2)
    assert.equal(h.render().visible, false)
    h.unmount()
    await flush()
    assert.equal(expired, 0)
  }
})

test('描画を待たない連続Undoでも一度だけ復旧し、処理中に期限切れや画面離脱で削除を確定しない', async () => {
  const h = harness()
  const gate = deferred()
  let attempts = 0
  let expired = 0
  h.render().showUndo({ message: 'deleted', onUndo: () => { attempts++; return gate.promise }, onExpire: () => { expired++ } })
  const undo = h.render().undo
  const first = undo()
  await undo()
  assert.equal(attempts, 1)
  assert.equal(h.render().visible, true)
  assert.equal(h.render().undoing, true)
  assert.equal(h.timers.size, 0)
  h.unmount()
  await flush()
  assert.equal(expired, 0)
  gate.resolve()
  await first
})

test('以前の復旧の完了や再試行が、後から表示した別のUndoを消さない', async () => {
  for (const fail of [false, true]) {
    const h = harness()
    const gate = deferred()
    let attempts = 0
    let expired = 0
    h.render().showUndo({ message: 'old', onUndo: () => ++attempts === 1 ? gate.promise : Promise.resolve(), onExpire: () => { expired++ } })
    const first = h.render().undo()
    h.render().showUndo({ message: 'new', onUndo: () => {} })
    if (fail) gate.reject(new Error('failed'))
    else gate.resolve()
    await first
    if (fail) { h.alerts[0][2][1].onPress(); await flush() }
    assert.equal(h.render().message, 'new')
    assert.equal(h.render().visible, true)
    assert.equal(h.timers.size, 1)
    assert.equal(expired, 0)
  }
})

test('期限後の同期・非同期エラーを通知し、差し替えや画面離脱が重なっても確定処理を重複させない', async () => {
  for (const synchronous of [true, false]) {
    for (const mode of ['expire', 'replace', 'unmount']) {
      const h = harness(true)
      let attempts = 0
      h.render().showUndo({ message: 'deleted', onUndo: () => {}, onExpire: () => {
        attempts++
        if (synchronous) throw new Error('cleanup failed')
        return Promise.reject(new Error('cleanup failed'))
      } })
      if (mode === 'expire') h.expire()
      if (mode === 'replace') h.render().showUndo({ message: 'new', onUndo: () => {} })
      h.unmount()
      await flush()
      assert.equal(attempts, 1)
      assert.equal(h.alerts.length, 1)
      assert.deepEqual(h.reports, ['undo_expiration'])
      assert.equal(h.timers.size, 0)
    }
  }
})

test('言語を変えても取り消し期限や対象を変えず、失敗通知は変更後の言語になる', async () => {
  const h = harness()
  h.render().showUndo({ message: 'deleted', onUndo: () => {}, onExpire: () => { throw new Error('failed') } })
  h.language('en')
  assert.equal(h.render().visible, true)
  assert.equal(h.timers.size, 1)
  h.expire()
  await flush()
  assert.equal(h.alerts[0][0], 'Could not finish deletion')
})

test('配置編集の開始と同時にUndoと再試行を抑止し、解除後に実行できる', async () => {
  const h = harness()
  let attempts = 0
  h.render().showUndo({ message: 'moved', onUndo: () => { if (++attempts === 1) throw new Error('failed') } })
  const undo = h.render().undo
  h.render().setBlocked(true)
  await undo()
  assert.equal(attempts, 0)
  assert.equal(h.render().blocked, true)
  h.render().setBlocked(false)
  await undo()
  assert.equal(attempts, 1)
  h.render().setBlocked(true)
  h.alerts[0][2][1].onPress()
  await flush()
  assert.equal(attempts, 1)
  assert.equal(h.render().visible, true)
  h.render().setBlocked(false)
  await h.render().undo()
  assert.equal(attempts, 2)
  assert.equal(h.render().visible, false)
})

function screenCallback(file: string, choose: (node: ts.Node) => ts.Expression | undefined, bindings: Record<string, unknown>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression: ts.Expression | undefined
  const visit = (node: ts.Node) => { expression ??= choose(node); if (!expression) ts.forEachChild(node, visit) }
  visit(source)
  assert.ok(expression)
  const code = ts.transpileModule(`(${expression.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return runInNewContext(code, { useCallback: (run: unknown) => run, ...bindings }) as (...args: any[]) => Promise<void>
}

test('配線図・機材の撤去・複数デスクの撤去のUndoは、保存完了を待って保存失敗を呼び出し元へ返す', async () => {
  const wiring = 'src/screens/WiringResultScreen.tsx'
  const library = 'src/screens/GadgetLibraryScreen.tsx'
  for (const kind of ['map', 'gadget', 'library']) {
    const gate = deferred()
    const update = (_id: string, _change: unknown, options?: { awaitPersistence?: boolean }) => options?.awaitPersistence ? gate.promise : Promise.resolve()
    const undo = screenCallback(kind === 'library' ? library : wiring, node => {
      if (kind === 'map') return ts.isVariableDeclaration(node) && node.name.getText() === 'restoreMap' ? node.initializer : undefined
      if (ts.isPropertyAssignment(node) && node.name.getText() === 'onUndo'
        && (kind === 'library' || node.initializer.getText().includes('restoreArmAssignments'))) return node.initializer
      return undefined
    }, {
      planId: 'desk', updateWith: update, updatePlanWith: update,
      localDateKey: () => '2026-10-08', recountCables: (value: unknown) => value,
      gadgets: [], gadget: { id: 'gadget' }, armSnapshot: {}, affectedPlanIds: ['one', 'two'], itemIds: ['gadget'],
    })
    let completed = false
    const result = undo({ connections: [] }).then(() => { completed = true })
    const rejection = assert.rejects(result, /storage failed/)
    await flush()
    assert.equal(completed, false)
    gate.reject(new Error('storage failed'))
    await rejection
  }
})
