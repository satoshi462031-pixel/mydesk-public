import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DeskPlan, Gadget } from '../src/types'
import { duplicatePlanSlots } from '../src/utils/planDuplicate'

const SLOT = '11111111-1111-4111-8111-111111111111'
const REAL = '22222222-2222-4222-8222-222222222222'
const NEW = '33333333-3333-4333-8333-333333333333'

const gadgets: Gadget[] = [
  { id: SLOT, name: 'モニター', category: 'Monitor', ports: [], isPlaceholder: true, createdAt: '' },
  { id: REAL, name: 'GALLERIA', category: 'PC', ports: [], createdAt: '' },
]

const plan = {
  id: 'desk',
  name: 'ゲーミング',
  goal: 'first_setup',
  purposes: [],
  selectedGadgetIds: [REAL, SLOT],
  placements: [{ gadgetId: SLOT, zone: 'back_center' }],
  connectionMap: {
    connections: [{ id: 'c1', fromGadgetId: REAL, toGadgetId: SLOT, cableType: 'HDMI', confirmed: true }],
    nodeOffsets: { [SLOT]: { dx: 10, dy: 0 } },
  },
  createdAt: '',
  updatedAt: '',
} as unknown as DeskPlan

describe('desk duplicate', () => {
  const result = duplicatePlanSlots(plan, gadgets, () => NEW)

  it('gives the copy its own slot and points every reference at it', () => {
    assert.deepEqual(result.slots.map((g) => g.id), [NEW])
    const json = JSON.stringify(result.plan)
    assert.ok(!json.includes(SLOT))
    assert.deepEqual(result.plan.selectedGadgetIds, [REAL, NEW])
    assert.equal(result.plan.placements[0].gadgetId, NEW)
    assert.ok(result.plan.connectionMap?.nodeOffsets?.[NEW])
    assert.equal(result.plan.connectionMap?.connections[0].toGadgetId, NEW)
  })

  it('keeps sharing real gadgets and leaves the original untouched', () => {
    assert.equal(result.plan.connectionMap?.connections[0].fromGadgetId, REAL)
    assert.deepEqual(plan.selectedGadgetIds, [REAL, SLOT])
  })

  it('returns the plan as is when there are no slots', () => {
    const noSlots = duplicatePlanSlots(plan, [gadgets[1]], () => NEW)
    assert.equal(noSlots.plan, plan)
    assert.deepEqual(noSlots.slots, [])
  })
})
