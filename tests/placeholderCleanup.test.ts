import assert from 'node:assert/strict'
import { it } from 'node:test'
import { Gadget } from '../src/types'
import { orphanPlaceholders } from '../src/utils/placeholderCleanup'

const g = (id: string, extra: Partial<Gadget> = {}): Gadget =>
  ({ id, name: id, category: 'Monitor', ports: [], createdAt: '2026-09-27', ...extra })

it('そのデスクでしか使っていない未設定の枠だけを返す', () => {
  const gadgets = [
    g('slot', { isPlaceholder: true }),
    g('shared-slot', { isPlaceholder: true }),
    g('unnamed', { name: '  ' }),
    g('product'),
    g('other-desk-slot', { isPlaceholder: true }),
  ]
  const plan = { id: 'a', selectedGadgetIds: ['slot', 'shared-slot', 'unnamed', 'product'] }
  const plans = [plan, { id: 'b', selectedGadgetIds: ['shared-slot', 'other-desk-slot'] }]
  assert.deepEqual(orphanPlaceholders(plan, gadgets, plans).map((gadget) => gadget.id), ['slot', 'unnamed'])
})
