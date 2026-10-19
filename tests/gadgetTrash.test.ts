import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Gadget } from '../src/types'
import {
  gadgetTrashDaysRemaining,
  isGadgetTrashExpired,
  sortGadgetsByDeletedDesc,
  splitGadgetsByTrash,
} from '../src/utils/gadgetTrash'

const gadget = (id: string, deletedAt?: string): Gadget => ({
  id,
  name: id,
  category: 'SmallDevice',
  ports: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  deletedAt,
})

describe('持ち物のゴミ箱', () => {
  it('削除済みを通常の持ち物から分離する', () => {
    const result = splitGadgetsByTrash([
      gadget('active'),
      gadget('deleted', '2026-09-01T00:00:00.000Z'),
    ])
    assert.deepEqual(result.active.map((item) => item.id), ['active'])
    assert.deepEqual(result.deleted.map((item) => item.id), ['deleted'])
  })

  it('最近削除した項目は消したのが新しい順に並べる', () => {
    const sorted = sortGadgetsByDeletedDesc([
      gadget('old', '2026-09-01T00:00:00.000Z'),
      gadget('new', '2026-09-20T00:00:00.000Z'),
      gadget('mid', '2026-09-10T00:00:00.000Z'),
    ])
    assert.deepEqual(sorted.map((item) => item.id), ['new', 'mid', 'old'])
  })

  it('30日後に期限切れになる', () => {
    const item = gadget('deleted', '2026-09-01T00:00:00.000Z')
    assert.equal(gadgetTrashDaysRemaining(item, Date.parse('2026-09-15T00:00:00.000Z')), 16)
    assert.equal(isGadgetTrashExpired(item, Date.parse('2026-09-30T23:59:59.999Z')), false)
    assert.equal(isGadgetTrashExpired(item, Date.parse('2026-10-01T00:00:00.000Z')), true)
  })
})
