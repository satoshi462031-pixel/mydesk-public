import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DeskPlan, Gadget } from '../src/types'
import { buildDeskCopySource, deskCopyCandidate, deskCopyTemplate } from '../src/utils/deskCopy'

const plan: DeskPlan = {
  id: 'desk',
  name: 'ゲーミング環境',
  goal: 'first_setup',
  purposes: ['gaming'],
  selectedGadgetIds: ['pc', 'monitor', 'cable', 'slot'],
  placements: [{ gadgetId: 'monitor', zone: 'back_center' }],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const gadgets: Gadget[] = [
  { id: 'pc', name: 'GALLERIA RM5R', category: 'PC', pcFormFactor: 'desktop', ports: [], price: 70000, productId: 'p-1', createdAt: '' },
  { id: 'monitor', name: 'Philips 241S9A/11', category: 'Monitor', ports: [], price: 20000, createdAt: '' },
  { id: 'cable', name: 'USB-C ケーブル', category: 'Cable', ports: [], createdAt: '' },
  { id: 'slot', name: 'マウス', category: 'Mouse', ports: [], isPlaceholder: true, createdAt: '' },
]

describe('desk copy', () => {
  const source = buildDeskCopySource({ deskId: 'd1', title: 'ゲーミング環境', ownerName: 'ashford', plan, gadgets })

  it('copies one slot per gadget except cables, with the placement zone', () => {
    assert.deepEqual(source.items.map((i) => i.category), ['PC', 'Monitor', 'Mouse'])
    assert.equal(source.items[1].zone, 'back_center')
    assert.equal(source.items[0].pcFormFactor, 'desktop')
    assert.deepEqual(source.purposes, ['gaming'])
  })

  it('offers the original products as candidates but never the price', () => {
    assert.equal(source.items[0].product?.name, 'GALLERIA RM5R')
    assert.equal(source.items[0].product?.productId, 'p-1')
    assert.equal(source.items[0].product?.priceJpy, undefined)
    // 枠のままだった物は候補にしない
    assert.equal(source.items[2].product, undefined)
  })

  it('maps template item keys back to the original products', () => {
    const template = deskCopyTemplate(source, 'content-copy')
    assert.equal(template.slots.length, 3)
    assert.equal(template.autoCharger, false)
    assert.equal(deskCopyCandidate(source, '1-0')?.name, 'Philips 241S9A/11')
    assert.equal(deskCopyCandidate(source, '2-0'), undefined)
    // 用途由来・自分で足した枠には候補が無い
    assert.equal(deskCopyCandidate(source, 'purpose-gaming-Headphone'), undefined)
    assert.equal(deskCopyCandidate(source, 'extra-123'), undefined)
  })
})
