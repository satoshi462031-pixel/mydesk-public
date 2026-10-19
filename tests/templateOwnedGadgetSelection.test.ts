import assert from 'node:assert/strict'
import test from 'node:test'
import type { Gadget } from '../src/types'
import {
  assignOwnedGadgetsToTemplateItems,
  hasOwnedGadgetCapacity,
  ownedGadgetCategoriesNeedingSlots,
  retainOwnedAssignments,
} from '../src/utils/templateOwnedGadgetSelection'

const gadget = (id: string, category: Gadget['category'], isPlaceholder = false): Gadget => ({
  id,
  name: id,
  category,
  ports: [],
  isPlaceholder,
  createdAt: '2026-09-19T00:00:00.000Z',
})

test('同じカテゴリの複数枠へ持ち物を選択順に割り当てる', () => {
  const items = [
    { key: 'monitor-1', category: 'Monitor' as const },
    { key: 'monitor-2', category: 'Monitor' as const },
    { key: 'pc-1', category: 'PC' as const },
  ]
  const gadgets = [gadget('monitor-a', 'Monitor'), gadget('monitor-b', 'Monitor'), gadget('pc-a', 'PC')]

  assert.deepEqual(
    assignOwnedGadgetsToTemplateItems(items, gadgets, ['monitor-b', 'pc-a', 'monitor-a']),
    { 'monitor-1': 'monitor-b', 'pc-1': 'pc-a', 'monitor-2': 'monitor-a' },
  )
})

test('枠がないカテゴリ、重複ID、プレースホルダーは割り当てない', () => {
  const items = [{ key: 'pc-1', category: 'PC' as const }]
  const gadgets = [
    gadget('pc-a', 'PC'),
    gadget('placeholder', 'PC', true),
    gadget('monitor-a', 'Monitor'),
  ]

  assert.deepEqual(
    assignOwnedGadgetsToTemplateItems(items, gadgets, ['placeholder', 'monitor-a', 'pc-a', 'pc-a']),
    { 'pc-1': 'pc-a' },
  )
})

test('カテゴリごとの枠数を超えて選択できない', () => {
  const items = [{ key: 'monitor-1', category: 'Monitor' as const }]
  const gadgets = [gadget('monitor-a', 'Monitor'), gadget('monitor-b', 'Monitor')]

  assert.equal(hasOwnedGadgetCapacity(items, gadgets, [], 'Monitor'), true)
  assert.equal(hasOwnedGadgetCapacity(items, gadgets, ['monitor-a'], 'Monitor'), false)
})

test('枠がないカテゴリの持ち物には不足ぶんの枠を追加する', () => {
  const items = [{ key: 'monitor-1', category: 'Monitor' as const }]
  const gadgets = [
    gadget('monitor-a', 'Monitor'),
    gadget('pc-a', 'PC'),
    gadget('pc-b', 'PC'),
    gadget('placeholder', 'Keyboard', true),
  ]

  assert.deepEqual(
    ownedGadgetCategoriesNeedingSlots(items, gadgets, ['monitor-a', 'pc-a', 'pc-b', 'pc-a', 'placeholder']),
    [{ category: 'PC' }, { category: 'PC' }],
  )
})

test('枠が0件でも登録済みの持ち物を選べるだけの枠を返す', () => {
  const gadgets = [gadget('monitor-a', 'Monitor'), gadget('pc-a', 'PC')]
  assert.deepEqual(
    ownedGadgetCategoriesNeedingSlots([], gadgets, ['monitor-a', 'pc-a']),
    [{ category: 'Monitor' }, { category: 'PC' }],
  )
})

test('同カテゴリの枠を前へ追加しても既存の割り当て先を維持する', () => {
  const gadgets = [gadget('monitor-a', 'Monitor')]
  const previous = { main: 'monitor-a' }
  const items = [
    { key: 'extra', category: 'Monitor' as const },
    { key: 'main', category: 'Monitor' as const },
    { key: 'sub', category: 'Monitor' as const },
  ]

  assert.deepEqual(
    assignOwnedGadgetsToTemplateItems(items, gadgets, ['monitor-a'], previous),
    { main: 'monitor-a' },
  )
})

test('枠を消しても、選んだ機材を同じジャンルの別の枠へ移さない', () => {
  const gadgets = [gadget('monitor-a', 'Monitor')]
  const selections = { main: 'monitor-a' }
  // main を消した後の枠。sub には商品名を入れている想定で、ここへ黙って移ると入力が隠れる
  const items = [{ key: 'sub', category: 'Monitor' as const }]

  assert.deepEqual(retainOwnedAssignments(items, gadgets, selections), {})
})

test('枠が残っている割り当ては、ジャンルが合うものだけを保つ', () => {
  const gadgets = [gadget('monitor-a', 'Monitor'), gadget('pc-a', 'PC')]
  const items = [
    { key: 'extra', category: 'Monitor' as const },
    { key: 'main', category: 'Monitor' as const },
  ]

  assert.deepEqual(
    retainOwnedAssignments(items, gadgets, { main: 'monitor-a', extra: 'pc-a' }),
    { main: 'monitor-a' },
  )
})
