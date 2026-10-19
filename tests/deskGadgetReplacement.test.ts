import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { replaceDeskGadget } from '../src/utils/deskGadgetReplacement'
import { applyDeskGadgetUsage } from '../src/utils/deskGadgetUsage'
import { DeskPlan, Gadget, MapConnection } from '../src/types'

const gadget = (id: string): Gadget => ({
  id,
  name: id,
  category: 'Monitor',
  ports: [],
  purchasedAt: '2025-01-01',
  createdAt: '2025-01-01T00:00:00.000Z',
})

const connection = (id: string, gadgetId: string, origin: MapConnection['origin']): MapConnection => ({
  id,
  fromGadgetId: 'pc',
  toGadgetId: gadgetId,
  cableType: 'HDMI',
  origin,
  confirmed: true,
  route: { path: 'cable_tray' },
})

function plan(): DeskPlan {
  return {
    id: 'replacement',
    name: 'replacement',
    goal: 'improve_desk',
    selectedGadgetIds: ['pc', 'old'],
    gadgetUsage: {
      old: { periods: [{ mode: 'active', startedAt: '2025-01-01' }] },
    },
    placements: [{ gadgetId: 'old', zone: 'back_left', label: '左奥' }],
    wiredOverrides: ['old'],
    monitorArmAssignments: { old: 'arm' },
    connectionMap: {
      connections: [connection('auto', 'old', 'auto'), connection('manual', 'old', 'manual')],
      dismissedPairs: ['old~pc|HDMI', 'keep~pc|USB_C'],
      nodeOffsets: {
        old: { dx: 12, dy: 8 },
        old__L: { dx: 4, dy: 2 },
      },
      nodeSizes: { old: { w: 170, h: 110 } },
      layoutSnapshots: {
        '2025-01-01': {
          nodeOffsets: { old: { dx: 1, dy: 1 } },
          nodeSizes: { old: { w: 150, h: 100 } },
        },
      },
    },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  }
}

describe('desk gadget replacement', () => {
  it('ends and starts usage on the same manual date while preserving the current position', () => {
    const old = gadget('old')
    const next = gadget('new')
    const updated = replaceDeskGadget(plan(), 'old', 'new', [gadget('pc'), old, next], '2026-09-28')

    assert.deepEqual(updated.selectedGadgetIds, ['pc', 'new'])
    assert.deepEqual(updated.gadgetUsage?.old.periods?.at(-1), {
      mode: 'active',
      startedAt: '2025-01-01',
      endedAt: '2026-09-28',
      endedAtSource: 'manual',
    })
    assert.deepEqual(updated.gadgetUsage?.new.periods?.at(-1), {
      mode: 'active',
      startedAt: '2026-09-28',
      startedAtSource: 'manual',
    })
    assert.deepEqual(updated.placements, [{ gadgetId: 'new', zone: 'back_left', label: '左奥' }])
    assert.deepEqual(updated.connectionMap?.nodeOffsets, {
      new: { dx: 12, dy: 8 },
      new__L: { dx: 4, dy: 2 },
    })
    assert.deepEqual(updated.connectionMap?.nodeSizes, { new: { w: 170, h: 110 } })
    assert.deepEqual(updated.wiredOverrides, ['new'])
    assert.deepEqual(updated.monitorArmAssignments, { new: 'arm' })
  })

  it('keeps historical layouts on the old id and drops an incompatible manual wire', () => {
    const updated = replaceDeskGadget(plan(), 'old', 'new', [gadget('pc'), gadget('old'), gadget('new')], '2026-09-28')

    assert.deepEqual(updated.connectionMap?.layoutSnapshots?.['2025-01-01'].nodeOffsets, {
      old: { dx: 1, dy: 1 },
    })
    assert.deepEqual(updated.connectionMap?.connections, [{
      ...connection('auto', 'old', 'auto'),
      toGadgetId: 'new',
    }])
    assert.deepEqual(updated.connectionMap?.dismissedPairs, ['keep~pc|USB_C'])
  })

  it('carries a compatible manual wire and drops an incompatible one', () => {
    const pc = { ...gadget('pc'), ports: [{ id: 'out', type: 'HDMI' as const, direction: 'output' as const, count: 1 }] }
    const old = { ...gadget('old'), ports: [{ id: 'in', type: 'HDMI' as const, direction: 'input' as const, count: 1 }] }
    const compatible = { ...gadget('new'), ports: [{ id: 'in', type: 'HDMI' as const, direction: 'input' as const, count: 1 }] }
    const incompatible = { ...gadget('other'), ports: [{ id: 'in', type: 'USB_C' as const, direction: 'input' as const, count: 1 }] }
    assert.equal(replaceDeskGadget(plan(), 'old', 'new', [pc, old, compatible], '2026-09-28')
      .connectionMap?.connections.some((item) => item.id === 'manual' && item.toGadgetId === 'new'), true)
    assert.equal(replaceDeskGadget(plan(), 'old', 'other', [pc, old, incompatible], '2026-09-28')
      .connectionMap?.connections.some((item) => item.id === 'manual'), false)
  })

  it('moves mounting, host and power references only inside this desk', () => {
    const before = plan()
    before.selectedGadgetIds.push('attached', 'powered', 'controller')
    const attached = { ...gadget('attached'), mounting: { targetGadgetId: 'old', type: 'attached_to' as const } }
    const powered = { ...gadget('powered'), powerSourceGadgetId: 'old', powerSourcePortId: 'old-port#0' }
    const controller = { ...gadget('controller'), bluetoothTargetGadgetIds: ['old'] }
    const updated = replaceDeskGadget(before, 'old', 'new', [gadget('pc'), gadget('old'), gadget('new'), attached, powered, controller], '2026-09-28')

    assert.deepEqual(updated.gadgetRelationOverrides?.attached?.mounting, { targetGadgetId: 'new', type: 'attached_to' })
    assert.deepEqual(updated.gadgetRelationOverrides?.powered, { powerSourceGadgetId: 'new', powerSourcePortId: null })
    assert.deepEqual(updated.gadgetRelationOverrides?.controller?.bluetoothTargetGadgetIds, ['new'])
    assert.equal(attached.mounting.targetGadgetId, 'old')
    assert.equal(applyDeskGadgetUsage(updated, attached).mounting?.targetGadgetId, 'new')
    assert.equal(applyDeskGadgetUsage({ ...updated, selectedGadgetIds: ['old', 'attached'] }, attached).mounting?.targetGadgetId, 'old')
  })

  it('can explicitly leave the replacement monitor on its stand', () => {
    const updated = replaceDeskGadget(
      plan(),
      'old',
      'new',
      [gadget('pc'), gadget('old'), gadget('new')],
      '2026-09-28',
      { monitorArmAssignment: null },
    )

    assert.deepEqual(updated.monitorArmAssignments, { new: null })
  })

  it('carries or clears a microphone arm assignment explicitly', () => {
    const microphone = (id: string): Gadget => ({ ...gadget(id), category: 'Microphone' })
    const before: DeskPlan = {
      ...plan(),
      micArmAssignments: { old: 'mic-arm' },
    }
    const updated = replaceDeskGadget(
      before,
      'old',
      'new',
      [gadget('pc'), microphone('old'), microphone('new')],
      '2026-09-28',
      { micArmAssignment: null },
    )

    assert.deepEqual(updated.micArmAssignments, { new: null })
  })
})
