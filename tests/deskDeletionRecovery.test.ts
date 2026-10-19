import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))

function harness(removeWithMotion?: (id: string, operation: () => Promise<void>) => Promise<unknown>) {
  const plan = { id: 'desk', name: 'desk', images: ['old-photo'], selectedGadgetIds: ['slot'] }
  const gadget = { id: 'slot', isPlaceholder: true }
  let plans = [plan]
  let gadgets = [gadget]
  const state = { failUnpublish: true, failPlan: false, failGadgets: false, gate: Promise.resolve(), planAttempts: 0, gadgetAttempts: 0 }
  const alerts: any[][] = []
  const reports: string[] = []
  const republished: unknown[] = []
  let undo: any
  const exported: any = {}
  const source = ts.transpileModule(readFileSync('src/hooks/useDeskActions.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  runInNewContext(source, { exports: exported, Promise, Error, require: (id: string) => {
    if (id === 'react') return { useCallback: (run: unknown) => run, useRef: (current: unknown) => ({ current }), useEffect: () => {} }
    if (id.endsWith('/alert')) return { Alert: { alert: (...args: any[]) => { alerts.push(args) } } }
    if (id.endsWith('/AppContext')) return { useApp: () => ({ lang: 'ja', t: (key: string) => key }) }
    if (id.endsWith('/analytics')) return { analytics: { error: (operation: string) => { reports.push(operation) }, track: () => {} }, EVENTS: {} }
    if (id.endsWith('/usePlans')) return { usePlans: () => ({
      plans,
      remove: async () => { plans = [] },
      restore: async (value: any) => { state.planAttempts++; await state.gate; if (state.failPlan) throw new Error('plan storage failed'); if (!plans.length) plans = [value] },
    }) }
    if (id.endsWith('/useGadgets')) return { useGadgets: () => ({
      gadgets,
      removeMany: async () => { gadgets = [] },
      restoreMany: async (values: any[]) => { state.gadgetAttempts++; await state.gate; if (state.failGadgets) throw new Error('gadget storage failed'); if (!gadgets.length) gadgets = values },
    }) }
    if (id.endsWith('/useUndoSnackbar')) return { useUndoSnackbar: () => ({ showUndo: (action: any) => { undo = action } }) }
    if (id.endsWith('/useEntitlement')) return { useEntitlement: () => ({}) }
    if (id.endsWith('/useDeskSetupGuard')) return { useDeskSetupGuard: () => async () => true }
    if (id.endsWith('/publishService')) return {
      unpublishPlan: async (_id: string, before: any) => { if (state.failUnpublish) throw new Error('network failed'); before('unlisted', new Map([['old-photo', 'new-photo']])); return true },
      republishPlan: async (...args: unknown[]) => { republished.push(args) },
    }
    if (id.endsWith('/deskDeletionCleanup')) return { queueDeskCleanup: async () => {}, cancelDeskCleanup: async () => {}, runDeskCleanup: async () => {}, resumePendingDeskCleanups: async () => {} }
    if (id.endsWith('/placeholderCleanup')) return { orphanPlaceholders: () => [gadget] }
    if (id.endsWith('/haptics')) return { hapticWarning: () => {} }
    return {}
  } })
  const actions = exported.useDeskActions({ navigation: {}, limitPlacement: 'test', removeWithMotion })
  const start = () => {
    actions.confirmDelete(plan)
    alerts[alerts.length - 1][2][1].onPress()
  }
  return { state, alerts, reports, republished, start, plans: () => plans, gadgets: () => gadgets, undo: () => undo }
}

test('デスクの削除は確認後の退場を待ち、退場だけではデータを消さない', async () => {
  let finish!: () => void
  let animatedId = ''
  const gate = new Promise<void>(resolve => { finish = resolve })
  const h = harness(async (id, operation) => {
    animatedId = id
    await gate
    await operation()
  })
  h.state.failUnpublish = false
  assert.equal(animatedId, '')
  h.start()
  await flush()
  assert.equal(animatedId, 'desk')
  assert.equal(h.plans().length, 1)
  assert.equal(h.undo(), undefined)
  finish()
  await flush()
  assert.equal(h.plans().length, 0)
  assert.ok(h.undo())
})

test('機材またはデスクの巻き戻しが失敗しても両方を復旧しようとし、失敗した復旧を再試行できる', async () => {
  for (const failed of ['failPlan', 'failGadgets'] as const) {
    const h = harness()
    h.state[failed] = true
    h.start()
    await flush()
    assert.equal(h.state.planAttempts, 1)
    assert.equal(h.state.gadgetAttempts, 1)
    assert.equal(h.alerts[1][0], '元に戻せませんでした')
    assert.ok(h.reports.includes('restore_after_delete_failed'))
    assert.equal(h.undo(), undefined)
    h.state[failed] = false
    h.alerts[1][2][1].onPress()
    await flush()
    assert.equal(h.plans().length, 1)
    assert.equal(h.gadgets().length, 1)
    assert.equal(h.alerts.length, 2)
  }
})

test('巻き戻しの再試行を連打しても重複実行せず、再度失敗しても次の再試行を残す', async () => {
  const h = harness()
  h.state.failGadgets = true
  h.start()
  await flush()
  let finish!: () => void
  h.state.gate = new Promise<void>(resolve => { finish = resolve })
  const retry = h.alerts[1][2][1].onPress
  retry(); retry()
  assert.equal(h.state.planAttempts, 2)
  assert.equal(h.state.gadgetAttempts, 2)
  finish()
  await flush()
  assert.equal(h.alerts[2][0], '元に戻せませんでした')
  h.state.failGadgets = false
  h.alerts[2][2][1].onPress()
  await flush()
  assert.equal(h.plans().length, 1)
  assert.equal(h.gadgets().length, 1)
})

test('Undoは機材とデスクの保存失敗を返し、復元後だけ元の公開範囲で再公開する', async () => {
  const h = harness()
  h.state.failUnpublish = false
  h.start()
  await flush()
  h.state.failGadgets = true
  await assert.rejects(h.undo().onUndo(), /gadget storage failed/)
  assert.equal(h.state.planAttempts, 0)
  assert.equal(h.republished.length, 0)
  h.state.failGadgets = false
  h.state.failPlan = true
  await assert.rejects(h.undo().onUndo(), /plan storage failed/)
  assert.equal(h.republished.length, 0)
  h.state.failPlan = false
  await h.undo().onUndo()
  assert.deepEqual(h.republished, [['desk', 'unlisted']])
  assert.deepEqual(h.plans()[0].images, ['new-photo'])
  assert.equal(h.gadgets().length, 1)
})
