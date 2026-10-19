import assert from 'node:assert/strict'
import test from 'node:test'
import { deskChangeHistory } from '../src/utils/deskChangeSummary'
import { profileActivity } from '../src/utils/profileActivity'
import { DeskGadgetUsage, Gadget, GadgetCategory } from '../src/types'

function gadget(id: string, category: GadgetCategory, price?: number): Gadget {
  return { id, name: id, category, price, ports: [], createdAt: '2026-01-01T00:00:00.000Z' } as Gadget
}

test('作成日のあとに足した日だけを、新しい順で履歴に出す', () => {
  const usage: Record<string, DeskGadgetUsage> = {
    pc:      { periods: [{ mode: 'active', startedAt: '2026-01-05' }] },
    monitor: { periods: [{ mode: 'active', startedAt: '2026-01-05' }] },
    mic:     { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
    light:   { periods: [{ mode: 'active', startedAt: '2026-05-20' }] },
  }
  const history = deskChangeHistory(
    [gadget('pc', 'PC'), gadget('monitor', 'Monitor'), gadget('mic', 'Microphone'), gadget('light', 'Light')],
    usage,
  )

  assert.deepEqual(history.map((h) => h.date), ['2026-05-20', '2026-03-01'])
})

test('最初に1台だけ置いてあとから足したデスクでも、作成日は変化にしない', () => {
  // 件数（追加がガジェット総数に達したか）で見ると、この形で作成日が残る
  const usage: Record<string, DeskGadgetUsage> = {
    pc:      { periods: [{ mode: 'active', startedAt: '2026-01-05' }] },
    monitor: { periods: [{ mode: 'active', startedAt: '2026-02-10' }] },
  }
  const history = deskChangeHistory([gadget('pc', 'PC'), gadget('monitor', 'Monitor')], usage)

  assert.deepEqual(history.map((h) => h.date), ['2026-02-10'])
})

test('複数のデスクの変更を日付順に混ぜ、同じ日は渡された順を保つ', () => {
  const entries = profileActivity([
    {
      id: 'desk-new',
      title: '新しいデスク',
      gadgets: [gadget('pc', 'PC'), gadget('mic', 'Microphone')],
      usage: {
        pc:  { periods: [{ mode: 'active', startedAt: '2026-01-05' }] },
        mic: { periods: [{ mode: 'active', startedAt: '2026-06-01' }] },
      },
    },
    {
      id: 'desk-old',
      title: '古いデスク',
      gadgets: [gadget('desk', 'Desk'), gadget('light', 'Light')],
      usage: {
        desk:  { periods: [{ mode: 'active', startedAt: '2025-01-05' }] },
        light: { periods: [{ mode: 'active', startedAt: '2026-06-01' }] },
      },
    },
  ])

  assert.deepEqual(entries.map((e) => [e.deskId, e.date]), [
    ['desk-new', '2026-06-01'],
    ['desk-old', '2026-06-01'],
  ])
})

test('同じ日の変更は高い順に並べ、先頭を見出しにする', () => {
  const entries = profileActivity([
    {
      id: 'desk',
      title: 'デスク',
      gadgets: [
        gadget('pc', 'PC'),
        gadget('mic', 'Microphone', 12000),
        gadget('monitor', 'Monitor', 80000),
      ],
      usage: {
        pc:      { periods: [{ mode: 'active', startedAt: '2026-01-05' }] },
        mic:     { periods: [{ mode: 'active', startedAt: '2026-06-01' }] },
        monitor: { periods: [{ mode: 'active', startedAt: '2026-06-01' }] },
      },
    },
  ])

  assert.equal(entries.length, 1)
  assert.equal(entries[0].changes[0].gadgetId, 'monitor')
  assert.equal(entries[0].changes.length, 2)
})

test('件数の上限を超えたぶんは落とす', () => {
  const usage: Record<string, DeskGadgetUsage> = {
    pc: { periods: [{ mode: 'active', startedAt: '2026-01-01' }] },
  }
  const gadgets = [gadget('pc', 'PC')]
  for (let i = 1; i <= 8; i += 1) {
    const id = `g${i}`
    gadgets.push(gadget(id, 'Light'))
    usage[id] = { periods: [{ mode: 'active', startedAt: `2026-02-0${i}` }] }
  }
  const entries = profileActivity([{ id: 'desk', title: 'デスク', gadgets, usage }], 5)

  assert.equal(entries.length, 5)
  assert.equal(entries[0].date, '2026-02-08')
})
