import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Gadget, MapConnection } from '../src/types'
import { applyMonitorArmAssignment, isStylusAccessory, mountedOn, orderDeskGadgets, orderWithMonitorArms, orderWithMounted } from '../src/utils/gadgetAttachments'

const g = (id: string, extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category: 'Accessory',
  ports: [],
  createdAt: '2026-09-21T00:00:00.000Z',
  ...extra,
})
const on = (target: string): Partial<Gadget> => ({ mounting: { targetGadgetId: target, type: 'attached_to' } })
const support = (arm: string, monitor: string): MapConnection => ({
  id: `${arm}-${monitor}`,
  fromGadgetId: arm,
  toGadgetId: monitor,
  cableType: 'MonitorArm',
  origin: 'auto',
  confirmed: true,
})

describe('取り付けているもの', () => {
  it('ケースや保護フィルムはペンと読まない', () => {
    assert.equal(isStylusAccessory(g('case', { name: 'ESR iPad Pro ケース' })), false)
    assert.equal(isStylusAccessory(g('film', { name: 'ペーパーライク 保護フィルム' })), false)
    assert.equal(isStylusAccessory(g('pen', { name: 'Apple Pencil Pro' })), true)
    assert.equal(isStylusAccessory(g('pen2', { name: 'ペン', ports: [{ id: 'p1', type: 'wirelessCharging', direction: 'input', count: 1 }] })), true)
    assert.equal(isStylusAccessory(g('pc', { category: 'PC', name: 'Pencil PC' })), false)
  })

  it('本体へ向いているものだけを集める', () => {
    const list = [g('ipad', { category: 'Tablet' }), g('case', on('ipad')), g('film', on('ipad')), g('other', on('phone')), g('self', on('self'))]
    assert.deepEqual(mountedOn('ipad', list).map((x) => x.id), ['case', 'film'])
    assert.deepEqual(mountedOn('self', list).map((x) => x.id), [])
  })

  it('一覧では本体の直後へ寄せ、並びは保つ', () => {
    const list = [g('film', on('ipad')), g('mouse'), g('ipad', { category: 'Tablet' }), g('case', on('ipad')), g('kb')]
    assert.deepEqual(orderWithMounted(list).map((x) => `${x.gadget.id}${x.mounted ? '*' : ''}`), ['mouse', 'ipad', 'film*', 'case*', 'kb'])
  })

  it('本体が一覧に無いものはその場に残す', () => {
    const list = [g('case', on('phone')), g('kb')]
    assert.deepEqual(orderWithMounted(list).map((x) => `${x.gadget.id}${x.mounted ? '*' : ''}`), ['case', 'kb'])
  })

  it('相互参照・連鎖で行が消えない', () => {
    const mutual = [g('a', on('b')), g('b', on('a'))]
    assert.deepEqual(orderWithMounted(mutual).map((x) => x.gadget.id), ['a', 'b'])
    const chain = [g('case', on('phone')), g('phone', { category: 'Smartphone', ...on('stand') }), g('stand')]
    const out = orderWithMounted(chain)
    assert.equal(out.length, 3)
    assert.deepEqual(out.map((x) => `${x.gadget.id}${x.mounted ? '*' : ''}`), ['case', 'stand', 'phone*'])
  })
})

describe('モニターアームの並び', () => {
  it('デュアルアームは支えている2台のモニターの直後へ置く', () => {
    const list = [
      g('arm', { category: 'MonitorArm' }),
      g('mouse'),
      g('monitor-b', { category: 'Monitor' }),
      g('monitor-a', { category: 'Monitor' }),
    ]
    const connections = [support('arm', 'monitor-a'), support('arm', 'monitor-b')]
    assert.deepEqual(orderWithMonitorArms(list, connections).map((x) => x.id), [
      'monitor-b', 'monitor-a', 'arm', 'mouse',
    ])
  })

  it('複数アームはそれぞれのモニターと別グループにする', () => {
    const list = [
      g('monitor-a', { category: 'Monitor' }),
      g('monitor-b', { category: 'Monitor' }),
      g('monitor-c', { category: 'Monitor' }),
      g('single', { category: 'MonitorArm' }),
      g('dual', { category: 'MonitorArm' }),
    ]
    const connections = [
      support('dual', 'monitor-a'),
      support('dual', 'monitor-b'),
      support('single', 'monitor-c'),
    ]
    assert.deepEqual(orderWithMonitorArms(list, connections).map((x) => x.id), [
      'monitor-a', 'monitor-b', 'dual', 'monitor-c', 'single',
    ])
  })

  it('支持線が無いアームとモニターは元の位置を保つ', () => {
    const list = [g('arm', { category: 'MonitorArm' }), g('monitor', { category: 'Monitor' }), g('mouse')]
    assert.deepEqual(orderWithMonitorArms(list, []).map((x) => x.id), ['arm', 'monitor', 'mouse'])
  })

  it('モニターの取り付け品も消さずに直後へ置く', () => {
    const list = [
      g('arm', { category: 'MonitorArm' }),
      g('light', on('monitor')),
      g('monitor', { category: 'Monitor' }),
    ]
    const out = orderDeskGadgets(list, [support('arm', 'monitor')])
    assert.deepEqual(out.map((x) => `${x.gadget.id}${x.mounted ? '*' : ''}`), ['monitor', 'light*', 'arm'])
  })

  it('マイクとマイクアームも同じグループにする', () => {
    const list = [
      g('mic-arm', { category: 'MicArm' }),
      g('mouse'),
      g('mic', { category: 'Microphone' }),
    ]
    const connection: MapConnection = {
      id: 'mic-support',
      fromGadgetId: 'mic-arm',
      toGadgetId: 'mic',
      cableType: 'MicArm',
      origin: 'auto',
      confirmed: true,
    }
    assert.deepEqual(orderWithMonitorArms(list, [connection]).map((x) => x.id), ['mic', 'mic-arm', 'mouse'])
  })
})

describe('マイクアームの明示割り当て', () => {
  it('引き継ぐ場合は支持口を付け、スタンド指定なら支持口を外す', () => {
    const microphone = g('mic', { category: 'Microphone' })
    const basePlan = {
      id: 'mic-plan', name: 'mic-plan', goal: 'improve_desk' as const,
      selectedGadgetIds: ['mic'], placements: [],
      createdAt: '', updatedAt: '',
    }
    const mounted = applyMonitorArmAssignment(microphone, {
      ...basePlan,
      micArmAssignments: { mic: 'mic-arm' },
    })
    assert.equal(mounted.ports.some((port) => port.type === 'MicArm' && port.direction === 'input'), true)

    const standing = applyMonitorArmAssignment(mounted, {
      ...basePlan,
      micArmAssignments: { mic: null },
    })
    assert.equal(standing.ports.some((port) => port.type === 'MicArm' && port.direction === 'input'), false)
  })
})
