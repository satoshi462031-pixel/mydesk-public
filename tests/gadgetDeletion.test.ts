import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DeskPlan, Gadget } from '../src/types'
import {
  planReferencesGadget,
  removeGadgetReferencesFromGadgets,
  removeGadgetReferencesFromPlan,
} from '../src/utils/gadgetDeletion'

const gadget = (id: string, extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category: 'SmallDevice',
  ports: [],
  createdAt: '2026-09-15T00:00:00.000Z',
  ...extra,
})

describe('持ち物の完全削除', () => {
  it('他の持ち物に残る給電・固定・接続先の参照も外す', () => {
    const result = removeGadgetReferencesFromGadgets([
      gadget('deleted'),
      gadget('remaining', {
        mounting: { targetGadgetId: 'deleted', type: 'attached_to' },
        powerSourceGadgetId: 'deleted',
        powerSourcePortId: 'port#1',
        wirelessTargetGadgetIds: ['deleted', 'other'],
        bluetoothTargetGadgetIds: ['deleted'],
      }),
    ], 'deleted')

    assert.equal(result.length, 1)
    assert.equal(result[0].mounting, undefined)
    assert.equal(result[0].powerSourceGadgetId, undefined)
    assert.equal(result[0].powerSourcePortId, undefined)
    assert.deepEqual(result[0].wirelessTargetGadgetIds, ['other'])
    assert.deepEqual(result[0].bluetoothTargetGadgetIds, [])
  })

  it('デスクの履歴・配置・配線・レイアウトに削除対象を残さない', () => {
    const plan: DeskPlan = {
      id: 'desk',
      name: 'desk',
      goal: 'clean_wiring',
      selectedGadgetIds: ['deleted', 'remaining'],
      gadgetUsage: {
        deleted: { periods: [{ mode: 'active', startedAt: '2026-09-01' }] },
      },
      placements: [{ gadgetId: 'deleted', zone: 'front_left' }],
      wiredOverrides: ['deleted'],
      gadgetRelationOverrides: {
        deleted: { powerSourceGadgetId: 'remaining' },
        remaining: {
          mounting: { targetGadgetId: 'deleted', type: 'attached_to' },
          powerSourceGadgetId: 'deleted',
          bluetoothTargetGadgetIds: ['deleted'],
        },
      },
      wiringResult: {
        connections: [{
          id: 'wire',
          fromGadgetId: 'deleted',
          fromPortType: 'USB_C',
          toGadgetId: 'remaining',
          toPortType: 'USB_C',
          cableType: 'USB_C',
        }],
        requiredCables: [{ cableType: 'USB_C', count: 1 }],
        warnings: [],
      },
      connectionMap: {
        connections: [{
          id: 'map',
          fromGadgetId: 'deleted',
          toGadgetId: 'remaining',
          cableType: 'USB_C',
          origin: 'manual',
          confirmed: true,
        }],
        dismissedPairs: ['deleted~remaining|USB_C'],
        nodeOffsets: { deleted: { dx: 1, dy: 1 }, remaining: { dx: 2, dy: 2 } },
        nodeSizes: { deleted: { w: 10, h: 10 }, remaining: { w: 20, h: 20 } },
        layoutSnapshots: {
          '2026-09-01': {
            nodeOffsets: { deleted: { dx: 1, dy: 1 } },
            nodeSizes: { deleted: { w: 10, h: 10 } },
          },
        },
        historyLayout: {
          '2026-09-01': {
            nodeOffsets: { deleted: { dx: 1, dy: 1 } },
            nodeSizes: { deleted: { w: 10, h: 10 } },
          },
        },
      },
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }

    const result = removeGadgetReferencesFromPlan(plan, 'deleted', [gadget('remaining')], 'ja')

    assert.equal(planReferencesGadget(result, 'deleted'), false)
    assert.equal(result.gadgetUsage?.deleted, undefined)
    assert.equal(result.connectionMap?.dismissedPairs?.length, 0)
    assert.equal(result.connectionMap?.nodeOffsets?.deleted, undefined)
    assert.equal(result.connectionMap?.nodeSizes?.deleted, undefined)
    assert.equal(result.connectionMap?.layoutSnapshots?.['2026-09-01'].nodeOffsets.deleted, undefined)
    assert.equal(result.connectionMap?.historyLayout?.['2026-09-01'].nodeSizes?.deleted, undefined)
    assert.equal(result.gadgetRelationOverrides?.deleted, undefined)
    assert.deepEqual(result.gadgetRelationOverrides?.remaining, {
      mounting: null,
      powerSourceGadgetId: null,
      powerSourcePortId: null,
      bluetoothTargetGadgetIds: [],
    })
  })
})
