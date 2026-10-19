import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOwnDeskRows, sortPinnedFirst } from '../src/utils/publishedMyDesk'

const plans = [
  { planId: 'plan-1', name: '公開中', updatedAt: '2026-09-10T00:00:00.000Z' },
  { planId: 'plan-2', name: '取り消し済み', updatedAt: '2026-09-09T00:00:00.000Z' },
  { planId: 'plan-3', name: '作りかけ', updatedAt: '2026-09-08T00:00:00.000Z' },
  { planId: 'plan-4', name: 'URL限定', updatedAt: '2026-09-07T00:00:00.000Z' },
]
const localPublished = [
  { planId: 'plan-1', deskId: 'desk-1', visibility: 'public' },
  { planId: 'plan-2', deskId: 'desk-2', visibility: 'private' },
  { planId: 'plan-4', deskId: 'desk-4', visibility: 'unlisted' },
]

test('未公開のデスクも並べる（デスクタブは全デスク）', () => {
  const rows = buildOwnDeskRows(plans, localPublished, null)
  assert.deepEqual(rows.map((row) => row.name), ['公開中', '取り消し済み', '作りかけ', 'URL限定'])
  const draft = rows.find((row) => row.planId === 'plan-3')
  assert.equal(draft?.visibility, null)
  assert.equal(draft?.deskId, null)
})

test('公開中と URL限定を見分ける', () => {
  const rows = buildOwnDeskRows(plans, localPublished, null)
  assert.equal(rows.find((row) => row.planId === 'plan-1')?.visibility, 'public')
  assert.equal(rows.find((row) => row.planId === 'plan-4')?.visibility, 'unlisted')
  assert.equal(rows.find((row) => row.planId === 'plan-2')?.visibility, 'private')
})

test('サーバーを読めたらサーバーの公開状態を正とする', () => {
  const rows = buildOwnDeskRows(plans, localPublished, [
    { id: 'desk-1', title: 'サーバー側', visibility: 'unlisted', updated_at: '2026-09-11T00:00:00.000Z' },
    { id: 'desk-4', title: 'URL限定', visibility: 'private' },
  ])
  const first = rows.find((row) => row.planId === 'plan-1')
  assert.equal(first?.visibility, 'unlisted')
  // 名前は端末のもの、日付は公開ページの更新日
  assert.equal(first?.name, '公開中')
  assert.equal(first?.updatedAt, '2026-09-11T00:00:00.000Z')
  assert.equal(rows.find((row) => row.planId === 'plan-4')?.visibility, 'private')
})

test('サーバーから消えたデスクは公開していない扱いにする', () => {
  const rows = buildOwnDeskRows(plans, localPublished, [])
  const first = rows.find((row) => row.planId === 'plan-1')
  assert.equal(first?.visibility, null)
  assert.equal(first?.deskId, null)
})

test('別の端末で公開したデスクも並べ、取り消したものは並べない', () => {
  const rows = buildOwnDeskRows([], [], [
    { id: 'desk-9', title: '別端末・公開中', visibility: 'public' },
    { id: 'desk-8', title: '別端末・URL限定', visibility: 'unlisted' },
    { id: 'desk-7', title: '別端末・取り消し', visibility: 'private' },
  ])
  assert.deepEqual(rows.map((row) => [row.name, row.visibility, row.onThisDevice]), [
    ['別端末・公開中', 'public', false],
    ['別端末・URL限定', 'unlisted', false],
  ])
})

test('新しい順に並べる', () => {
  const rows = buildOwnDeskRows(plans, localPublished, [
    { id: 'desk-4', title: 'URL限定', visibility: 'unlisted', updated_at: '2026-09-12T00:00:00.000Z' },
  ])
  assert.equal(rows[0].planId, 'plan-4')
})

test('ピン留めしたデスクは更新日に関係なく先頭（マイデスクの一覧と同じ）', () => {
  const rows = sortPinnedFirst(buildOwnDeskRows(plans, localPublished, null), new Set(['plan-3']))
  assert.deepEqual(rows.map((row) => row.planId), ['plan-3', 'plan-1', 'plan-2', 'plan-4'])
})
