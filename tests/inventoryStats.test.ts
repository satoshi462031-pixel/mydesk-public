import assert from 'node:assert/strict'
import test from 'node:test'
import { Gadget } from '../src/types'
import { buildInventoryStats } from '../src/utils/inventoryStats'
import { isOwnedGadget } from '../src/utils/gadgetStats'

const gadget = (overrides: Partial<Gadget>): Gadget => ({
  id: overrides.id ?? crypto.randomUUID(),
  name: 'Anker Charger',
  category: 'Charger',
  ports: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

test('候補と未登録の枠は価格・日付があっても所有数と全統計から除外する', () => {
  const owned = gadget({ id: 'owned', price: 5000 })
  const candidate = gadget({ id: 'candidate', isCandidate: true, price: 100000, purchasedAt: '2026-01-01' })
  const placeholder = gadget({ id: 'placeholder', isPlaceholder: true, quantity: 3, price: 100000 })
  assert.equal(isOwnedGadget(owned), true)
  assert.equal(isOwnedGadget(candidate), false)
  assert.equal(isOwnedGadget(placeholder), false)
  assert.deepEqual(buildInventoryStats([owned, candidate, placeholder], 'ja'), buildInventoryStats([owned], 'ja'))
  assert.equal(buildInventoryStats([{ ...candidate, isCandidate: undefined }], 'ja').itemCount, 1)
})

test('持ち物全体の点数・金額・価格未入力数を数量込みで集計する', () => {
  const stats = buildInventoryStats([
    gadget({ id: 'priced', quantity: 2, price: 5_000 }),
    gadget({ id: 'unpriced', name: 'Cable', category: 'Cable' }),
  ], 'ja')

  assert.equal(stats.itemCount, 3)
  assert.equal(stats.totalAmount, 10_000)
  assert.equal(stats.pricedCount, 2)
  assert.equal(stats.unpricedCount, 1)
  assert.equal(stats.categories.find((row) => row.key === 'Cable')?.count, 1)
})

test('ブランド表記を束ねて点数と金額を集計する', () => {
  const stats = buildInventoryStats([
    gadget({ id: 'one', name: 'SONY MDR-MV1', price: 50_000 }),
    gadget({ id: 'two', name: 'Sony WH-1000XM6', price: 60_000 }),
  ], 'ja')

  assert.equal(stats.brands.length, 1)
  assert.equal(stats.brands[0].count, 2)
  assert.equal(stats.brands[0].total, 110_000)
})

test('購入年別を古い年から並べ、購入日未入力も数える', () => {
  const stats = buildInventoryStats([
    gadget({ id: 'new', purchasedAt: '2026-03-01', price: 20_000 }),
    gadget({ id: 'old', purchasedAt: '2024-12-31', quantity: 2, price: 10_000 }),
    gadget({ id: 'unknown-date' }),
  ], 'ja')

  assert.deepEqual(stats.purchaseYears.map((row) => ({ year: row.key, count: row.count, total: row.total })), [
    { year: 2024, count: 2, total: 20_000 },
    { year: 2026, count: 1, total: 20_000 },
  ])
  assert.equal(stats.undatedCount, 1)
})
