import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget } from '../src/types'
import { detachArmAssignments, restoreArmAssignments } from '../src/utils/monitorArmAssignments'
import { generateWiring } from '../src/utils/wiringEngine'

const gadget = (id: string, category: Gadget['category']): Gadget => ({
  id,
  name: id,
  category,
  ports: [],
  createdAt: '2026-01-01T00:00:00.000Z',
})

const monitor = gadget('monitor', 'Monitor')
const secondMonitor = gadget('monitor-2', 'Monitor')
const arm = gadget('arm', 'MonitorArm')

function plan(assignments?: DeskPlan['monitorArmAssignments']): DeskPlan {
  return {
    id: 'arm-removal',
    name: 'arm-removal',
    goal: 'improve_desk',
    selectedGadgetIds: ['monitor', 'monitor-2', 'arm'],
    placements: [],
    monitorArmAssignments: assignments,
    connectionMap: {
      connections: [{
        id: 'arm-monitor',
        fromGadgetId: 'arm',
        toGadgetId: 'monitor',
        cableType: 'MonitorArm',
        origin: 'auto',
        confirmed: false,
      }],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('monitor arm assignments on removal', () => {
  it('clears a removed monitor assignment and restores it on undo', () => {
    const detached = detachArmAssignments(plan({ monitor: 'arm' }), monitor, [monitor, secondMonitor, arm])
    assert.deepEqual(detached.monitorArmAssignments, {})
    assert.deepEqual(detached.affectedTargetIds, ['monitor'])
    assert.deepEqual(
      restoreArmAssignments(detached.monitorArmAssignments, detached.micArmAssignments, detached.snapshot),
      { monitorArmAssignments: { monitor: 'arm' }, micArmAssignments: {} },
    )
  })

  it('puts monitors supported by a removed arm onto stands, including automatic connections', () => {
    const detached = detachArmAssignments(
      plan({ 'monitor-2': 'arm' }),
      arm,
      [monitor, secondMonitor, arm],
    )
    assert.deepEqual(detached.monitorArmAssignments, { monitor: null, 'monitor-2': null })
    assert.deepEqual(new Set(detached.affectedTargetIds), new Set(['monitor', 'monitor-2']))
    assert.deepEqual(
      restoreArmAssignments(detached.monitorArmAssignments, detached.micArmAssignments, detached.snapshot),
      { monitorArmAssignments: { 'monitor-2': 'arm' }, micArmAssignments: {} },
    )
  })

  it('applies the same detach and undo behavior to microphones and mic arms', () => {
    const microphone = gadget('mic', 'Microphone')
    const micArm = gadget('mic-arm', 'MicArm')
    const micPlan: DeskPlan = {
      ...plan(),
      selectedGadgetIds: ['mic', 'mic-arm'],
      micArmAssignments: { mic: 'mic-arm' },
      connectionMap: {
        connections: [{
          id: 'mic-arm-line',
          fromGadgetId: 'mic-arm',
          toGadgetId: 'mic',
          cableType: 'MicArm',
          origin: 'auto',
          confirmed: false,
        }],
      },
    }
    const detached = detachArmAssignments(micPlan, micArm, [microphone, micArm])

    assert.deepEqual(detached.micArmAssignments, { mic: null })
    assert.deepEqual(detached.affectedTargetIds, ['mic'])
    assert.deepEqual(
      restoreArmAssignments(detached.monitorArmAssignments, detached.micArmAssignments, detached.snapshot),
      { monitorArmAssignments: {}, micArmAssignments: { mic: 'mic-arm' } },
    )
  })

  it('respects an explicit microphone arm and does not remount a stand microphone', () => {
    const standing: Gadget = {
      ...gadget('standing-mic', 'Microphone'),
      ports: [{ id: 'stand-in', type: 'MicArm', direction: 'input', count: 1 }],
    }
    const mounted: Gadget = {
      ...gadget('mounted-mic', 'Microphone'),
      ports: [{ id: 'mounted-in', type: 'MicArm', direction: 'input', count: 1 }],
    }
    const micArm: Gadget = {
      ...gadget('mic-arm', 'MicArm'),
      ports: [{ id: 'arm-out', type: 'MicArm', direction: 'output', count: 1 }],
    }
    const micPlan: DeskPlan = {
      ...plan(),
      selectedGadgetIds: [standing.id, mounted.id, micArm.id],
      micArmAssignments: { [standing.id]: null, [mounted.id]: micArm.id },
      connectionMap: undefined,
    }

    const supports = generateWiring([standing, mounted, micArm], micPlan).connections
      .filter((connection) => connection.cableType === 'MicArm')
    assert.deepEqual(supports.map((connection) => connection.toGadgetId), [mounted.id])
  })
})
