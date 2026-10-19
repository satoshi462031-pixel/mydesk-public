import assert from 'node:assert/strict'
import test from 'node:test'
import { DeskPlan, Gadget } from '../src/types'
import { updateDeskGadgetSelection } from '../src/utils/deskGadgetUsage'
import { buildGadgetLibraryUsage, filterGadgetLibrary, libraryDeskLabel, libraryUsagePeriodLabel } from '../src/utils/gadgetLibrary'

const gadget = (id: string, extra: Partial<Gadget> = {}): Gadget => ({
  id, name: id, category: 'Monitor', ports: [], createdAt: '2026-01-01T00:00:00.000Z', ...extra,
})
const desk = (id: string, selectedGadgetIds: string[] = [], gadgetUsage?: DeskPlan['gadgetUsage']): DeskPlan => ({
  id, name: id, goal: 'improve_desk', selectedGadgetIds, gadgetUsage, placements: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})

test('購入日のある未配置機材と過去に使った機材を分け、別デスクで使用中なら使用中を優先する', () => {
  const items = [gadget('spare', { purchasedAt: '2025-01-01' }), gadget('old'), gadget('moved')]
  const usage = buildGadgetLibraryUsage(items, [
    desk('oldDesk', [], {
      old: { periods: [{ mode: 'active', startedAt: '2024-01-01', endedAt: '2025-01-01' }] },
      moved: { periods: [{ mode: 'active', startedAt: '2024-01-01', endedAt: '2025-01-01' }] },
    }),
    desk('newDesk', ['moved']),
  ])
  assert.equal(usage.get('spare')?.status, 'unused')
  assert.equal(usage.get('old')?.status, 'past')
  assert.equal(usage.get('moved')?.status, 'current')
  assert.equal(libraryDeskLabel(usage.get('moved')!, 'ja'), 'newDesk')
  assert.equal(usage.get('moved')?.desks.length, 2)
})

test('日付不明で使っていた機材も、撤去後は過去に使用へ移り、再配置すると使用中へ戻る', () => {
  const item = gadget('unknown', { introducedAtUnknown: true, favorite: true })
  const initial = desk('desk', ['unknown'])
  const removed = updateDeskGadgetSelection(initial, [], [item], '2026-10-15')
  const past = buildGadgetLibraryUsage([item], [removed]).get(item.id)!
  assert.equal(past.status, 'past')
  assert.equal(libraryUsagePeriodLabel(past, 'ja'), '期間未設定')
  assert.equal(libraryDeskLabel(past, 'ja'), 'desk')
  const restored = updateDeskGadgetSelection(removed, [item.id], [item], '2026-10-15')
  const current = buildGadgetLibraryUsage([item], [restored]).get(item.id)!
  assert.equal(current.status, 'current')
  assert.equal(libraryUsagePeriodLabel(current, 'ja'), '期間未設定')
  assert.equal(item.favorite, true)
})

test('期間が重なる複数デスクはまとめ、間が空いた再使用は最終期間だけをカードに表示する', () => {
  const item = gadget('monitor')
  const usage = buildGadgetLibraryUsage([item], [
    desk('A', [], { monitor: { periods: [
      { mode: 'active', startedAt: '2023-01-01', endedAt: '2024-01-01' },
      { mode: 'active', startedAt: '2025-04-01', endedAt: '2026-03-01' },
    ] } }),
    desk('B', [], { monitor: { periods: [{ mode: 'decor', startedAt: '2025-05-01', endedAt: '2026-02-01' }] } }),
  ]).get(item.id)!
  assert.equal(usage.periods.length, 2)
  assert.equal(libraryUsagePeriodLabel(usage, 'ja'), '最終：2025/4〜2026/3')
  assert.equal(libraryUsagePeriodLabel(usage, 'en'), 'Last: 2025/4〜2026/3')
  assert.equal(libraryDeskLabel(usage, 'ja'), 'A ＋ほか1件')
  assert.equal(usage.desks.flatMap((entry) => entry.periods).length, 3)
})

test('旧データの登録日を実際の使用開始日として表示しない', () => {
  const item = gadget('legacy')
  const usage = buildGadgetLibraryUsage([item], [desk('old', [], { legacy: { removedAt: '2026-10-01' } })]).get(item.id)!
  assert.equal(usage.status, 'past')
  assert.equal(libraryUsagePeriodLabel(usage, 'ja'), '?〜2026/10')
})

test('撤去日だけ残る旧機材も過去に使用に表示し、デスク名を捏造しない', () => {
  const item = gadget('orphan', { removedAt: '2025-02-01', introducedAtUnknown: true })
  const usage = buildGadgetLibraryUsage([item], []).get(item.id)!
  assert.equal(usage.status, 'past')
  assert.equal(libraryDeskLabel(usage, 'ja'), '使用デスク不明')
  assert.equal(libraryUsagePeriodLabel(usage, 'ja'), '?〜2025/02')
})

test('使用中の日付が不明なとき、過去のデスクの終了日で現在の使用期間を代用しない', () => {
  const item = gadget('reused', { introducedAtUnknown: true })
  const usage = buildGadgetLibraryUsage([item], [
    desk('old', [], { reused: { periods: [{ mode: 'active', startedAt: '2022-01-01', endedAt: '2023-01-01' }] } }),
    desk('new', ['reused']),
  ]).get(item.id)!
  assert.equal(libraryUsagePeriodLabel(usage, 'ja'), '期間未設定')
  assert.equal(libraryDeskLabel(usage, 'ja'), 'new')
})

test('使用状況とお気に入りは独立して絞り込み、星を先頭にしつつ元の登録順を保つ', () => {
  const items = [gadget('normal'), gadget('favorite1', { favorite: true }), gadget('favorite2', { favorite: true }), gadget('past', { favorite: true, removedAt: '2025-01-01' }), gadget('spare', { favorite: true })]
  const usage = buildGadgetLibraryUsage(items, [desk('desk', ['normal', 'favorite1', 'favorite2'])])
  const ids = (status: 'current' | 'unused', only: boolean) => filterGadgetLibrary(items, usage, status, only).map((item) => item.id)
  assert.deepEqual(ids('current', false), ['favorite1', 'favorite2', 'normal'])
  assert.deepEqual(ids('current', true), ['favorite1', 'favorite2'])
  assert.deepEqual(ids('unused', true), ['past', 'spare'])
  assert.deepEqual(items.map((item) => item.id), ['normal', 'favorite1', 'favorite2', 'past', 'spare'])
})

test('以前使った機材と処分済みの機材は未使用にまとまり、デスクの履歴は残る', () => {
  const items = [gadget('old'), gadget('disposed', { disposedAt: '2026-10-17T01:00:00.000Z' }), gadget('spare')]
  const usage = buildGadgetLibraryUsage(items, [desk('oldDesk', [], {
    old: { periods: [{ mode: 'active', startedAt: '2024-01-01', endedAt: '2025-01-01' }] },
    disposed: { periods: [{ mode: 'active', startedAt: '2024-01-01', endedAt: '2026-01-01' }] },
  })])
  assert.deepEqual(filterGadgetLibrary(items, usage, 'unused', false).map((item) => item.id), ['old', 'disposed', 'spare'])
  assert.equal(libraryDeskLabel(usage.get('disposed')!, 'ja'), 'oldDesk')
  assert.equal(libraryUsagePeriodLabel(usage.get('disposed')!, 'ja'), '2024/1〜2026/1')
})
