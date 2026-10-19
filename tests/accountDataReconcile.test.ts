import assert from 'node:assert/strict'
import test from 'node:test'
import { decideReconcileAction, mergeById } from '../src/utils/accountDataReconcile'

const base = { userId: 'user-a', owner: null, signInPending: false, localEmpty: false }

test('突き合わせ済みの端末は、空でも控えを戻さない（全部消した状態を復活させない）', () => {
  assert.equal(decideReconcileAction({ ...base, owner: 'user-a', localEmpty: true }), 'in-sync')
  assert.equal(decideReconcileAction({ ...base, owner: 'user-a', signInPending: true }), 'in-sync')
})

test('空の端末には控えを戻す（再インストール・ログアウト後・別アカウントの跡）', () => {
  assert.equal(decideReconcileAction({ ...base, localEmpty: true }), 'restore')
  assert.equal(decideReconcileAction({ ...base, localEmpty: true, signInPending: true }), 'restore')
  assert.equal(decideReconcileAction({ ...base, owner: 'user-b', localEmpty: true }), 'restore')
})

test('ログインせずに作ったデータは、アカウントの控えと合わせる', () => {
  assert.equal(decideReconcileAction({ ...base, signInPending: true }), 'merge')
})

test('別のアカウントのデータは、ログインの有無にかかわらず混ぜない', () => {
  assert.equal(decideReconcileAction({ ...base, owner: 'user-b' }), 'foreign')
  assert.equal(decideReconcileAction({ ...base, owner: 'user-b', signInPending: true }), 'foreign')
})

test('印を持つ前の版からログインしたまま使っていた端末は、そのまま引き取る', () => {
  assert.equal(decideReconcileAction(base), 'adopt')
})

test('ID で合わせ、同じ ID は端末側を残し、端末にしか無いものを後ろへ足す', () => {
  const account = [{ id: '1', v: 'account' }, { id: '2', v: 'account' }]
  const local = [{ id: '2', v: 'local' }, { id: '3', v: 'local' }]
  assert.deepEqual(mergeById(account, local), [
    { id: '1', v: 'account' },
    { id: '2', v: 'local' },
    { id: '3', v: 'local' },
  ])
})

test('片方が空なら、もう片方がそのまま残る', () => {
  const items = [{ id: '1' }, { id: '2' }]
  assert.deepEqual(mergeById([], items), items)
  assert.deepEqual(mergeById(items, []), items)
})
