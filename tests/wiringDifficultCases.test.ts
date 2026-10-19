import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DeskPlan, Gadget, Port, WiringResult } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'
import { reconcileMap } from '../src/utils/connectionMapLayout'

let seq = 0
const at = '2026-10-11T00:00:00.000Z'
const p = (type: Port['type'], direction: Port['direction'], extra: Partial<Port> = {}): Port => ({
  id: `difficult-${++seq}`, type, direction, count: 1, ...extra,
})
const g = (id: string, category: Gadget['category'], ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id, name: id, category, ports, createdAt: at, ...extra,
})
const planFor = (gadgets: Gadget[], extra: Partial<DeskPlan> = {}): DeskPlan => ({
  id: 'difficult', name: 'difficult', goal: 'clean_wiring', selectedGadgetIds: gadgets.map(({ id }) => id),
  placements: [], outletCount: 8, outletCountVersion: 2, createdAt: at, updatedAt: at, ...extra,
})
const wire = (gadgets: Gadget[], extra: Partial<DeskPlan> = {}) => generateWiring(gadgets, planFor(gadgets, extra))
const linked = (result: WiringResult, from: string, to: string, type?: string) => result.connections.some((c) =>
  c.fromGadgetId === from && c.toGadgetId === to && (!type || c.cableType === type))
const screen = (id: string) => g(id, 'Monitor', [p('USB_C', 'input', { supportsVideo: true }), p('Power', 'input')])

describe('能力が異なる同形状ポートの競合', () => {
  for (const direction of ['output', 'bidirectional'] as const) {
    for (const videoFirst of [true, false]) {
      it(`${direction}・映像対応口が${videoFirst ? '先' : '後'}でも、非対応口を2枚目の映像に使わない`, () => {
        const ports = [p('USB_C', direction, { supportsVideo: true }), p('USB_C', direction, { supportsVideo: false })]
        const pc = g('pc', 'PC', videoFirst ? ports : ports.reverse(), { pcFormFactor: 'desktop' })
        const result = wire([pc, screen('first'), screen('second')])
        assert.equal(linked(result, 'pc', 'first', 'USB_C'), true)
        assert.equal(linked(result, 'pc', 'second', 'USB_C'), false)
        assert.ok(result.warnings.some((w) => w.includes('second')))
      })
    }
  }

  it('count=2の映像対応口は2画面分使える', () => {
    const pc = g('pc', 'PC', [p('USB_C', 'output', { supportsVideo: true, count: 2 }), p('USB_C', 'output')])
    const result = wire([pc, screen('first'), screen('second'), screen('third')])
    assert.equal(linked(result, 'pc', 'first', 'USB_C'), true)
    assert.equal(linked(result, 'pc', 'second', 'USB_C'), true)
    assert.equal(linked(result, 'pc', 'third', 'USB_C'), false)
  })

  it('入力側も映像対応口を使い切ったら別PCの映像を受けない', () => {
    const pc = (id: string) => g(id, 'PC', [p('USB_C', 'output', { supportsVideo: true })])
    const monitor = screen('monitor')
    monitor.ports.unshift(p('USB_C', 'input', { supportsVideo: false }))
    const result = wire([pc('first'), pc('second'), monitor])
    assert.equal(linked(result, 'first', 'monitor', 'USB_C'), true)
    assert.equal(linked(result, 'second', 'monitor', 'USB_C'), false)
  })

  it('2台目のDockへデータが通っても、使い切った映像対応口の能力を流用しない', () => {
    const pc = g('pc', 'PC', [p('USB_C', 'output'), p('USB_C', 'output', { supportsVideo: true })])
    const dock = (id: string) => g(id, 'Dock', [p('USB_C', 'input'), p('DisplayPort', 'output')])
    const monitor = (id: string, target: string) => g(id, 'Monitor', [p('DisplayPort', 'input')], { bluetoothTargetGadgetIds: [target] })
    const result = wire([pc, dock('first'), dock('second'), monitor('m1', 'first'), monitor('m2', 'second')])
    assert.equal(linked(result, 'pc', 'first', 'USB_C'), true)
    assert.equal(linked(result, 'pc', 'second', 'USB_C'), true)
    assert.equal(linked(result, 'first', 'm1', 'DisplayPort'), true)
    assert.equal(linked(result, 'second', 'm2', 'DisplayPort'), false)
  })
})

const matchingDesk = () => [
  g('pc', 'PC', [p('DisplayPort', 'output'), p('HDMI', 'output')], { pcFormFactor: 'desktop' }),
  g('flexible', 'Monitor', [p('DisplayPort', 'input'), p('HDMI', 'input')]),
  g('dp-only', 'Monitor', [p('DisplayPort', 'input')]),
]

describe('画面の候補競合', () => {
  it('両対応画面を先に処理しても専用画面の端子を残す', () => {
    const result = wire(matchingDesk())
    assert.equal(linked(result, 'pc', 'flexible', 'HDMI'), true)
    assert.equal(linked(result, 'pc', 'dp-only', 'DisplayPort'), true)
    assert.deepEqual(result.warnings, [])
  })

  it('DPが足りているときは従来のDP優先を保つ', () => {
    const gadgets = matchingDesk()
    gadgets[0].ports[0].count = 2
    const result = wire(gadgets)
    assert.equal(linked(result, 'pc', 'flexible', 'DisplayPort'), true)
    assert.equal(linked(result, 'pc', 'dp-only', 'DisplayPort'), true)
  })

  it('確定済みのDP選択を組み替えず、手動線も突き合わせ後に維持する', () => {
    const gadgets = matchingDesk()
    const saved = { id: 'saved', fromGadgetId: 'pc', toGadgetId: 'flexible', cableType: 'DisplayPort' as const, origin: 'manual' as const, confirmed: true }
    const plan = planFor(gadgets, { connectionMap: { connections: [saved] } })
    assert.equal(linked(generateWiring(gadgets, plan), 'pc', 'flexible', 'DisplayPort'), true)
    assert.deepEqual(reconcileMap([saved], gadgets, plan).find((c) => c.id === saved.id), saved)
  })

  it('画面の接続先指定を優先する', () => {
    const gadgets = matchingDesk()
    gadgets[1].bluetoothTargetGadgetIds = ['pc']
    assert.equal(linked(wire(gadgets), 'pc', 'flexible', 'DisplayPort'), true)
  })

  it('生成されたHDMI接続を確定した後もDPへ戻らない', () => {
    const gadgets = matchingDesk()
    const first = wire(gadgets)
    const saved = first.connections.map((c) => ({ ...c, origin: 'auto' as const, confirmed: true }))
    const second = wire(gadgets, { connectionMap: { connections: saved } })
    assert.equal(linked(second, 'pc', 'flexible', 'HDMI'), true)
    assert.equal(linked(second, 'pc', 'dp-only', 'DisplayPort'), true)
    assert.deepEqual(second.warnings, [])
  })

  it('破棄したDP接続をHDMIへ付け替えて復活させない', () => {
    const result = wire(matchingDesk(), { connectionMap: { connections: [], dismissedPairs: ['flexible~pc|DisplayPort'] } })
    assert.equal(linked(result, 'pc', 'flexible'), false)
    assert.equal(linked(result, 'pc', 'dp-only', 'DisplayPort'), true)
  })
})

const dockDesk = (video: boolean) => [
  g('pc', 'PC', [p('USB_C', 'output', { supportsVideo: video }), p('DisplayPort', 'output')], { pcFormFactor: 'desktop' }),
  g('dock', 'Dock', [p('USB_C', 'input'), p('DisplayPort', 'output')]),
  g('monitor', 'Monitor', [p('DisplayPort', 'input')], { bluetoothTargetGadgetIds: ['dock'] }),
]

describe('指定したDockの映像経路', () => {
  it('上流が映像非対応なら既存の指定不成立時の動作に従いPC直結へ戻す', () => {
    const result = wire(dockDesk(false))
    assert.equal(linked(result, 'dock', 'monitor', 'DisplayPort'), false)
    assert.equal(linked(result, 'pc', 'monitor', 'DisplayPort'), true)
  })

  it('映像を送れるDockの指定は維持する', () => {
    const result = wire(dockDesk(true))
    assert.equal(linked(result, 'dock', 'monitor', 'DisplayPort'), true)
    assert.equal(linked(result, 'pc', 'monitor', 'DisplayPort'), false)
    assert.deepEqual(result.warnings, [])
  })

  it('上流の線を破棄したDockを接続済み扱いにしない', () => {
    const result = wire(dockDesk(true), { connectionMap: { connections: [], dismissedPairs: ['dock~pc|USB_C'] } })
    assert.equal(linked(result, 'pc', 'dock'), false)
    assert.equal(linked(result, 'dock', 'monitor', 'DisplayPort'), false)
    assert.equal(linked(result, 'pc', 'monitor', 'DisplayPort'), true)
  })

  it('PC未登録のDock単独構成を映像源として扱う既存仕様は保つ', () => {
    assert.equal(linked(wire(dockDesk(false).slice(1)), 'dock', 'monitor', 'DisplayPort'), true)
  })
})
