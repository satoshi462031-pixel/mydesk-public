import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

let seq = 0
const createdAt = '2026-09-21T00:00:00.000Z'
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `monitor-hub-port-${++seq}`,
  type,
  direction,
  count,
  ...extra,
})
const g = (id: string, category: GadgetCategory, ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category,
  ports,
  createdAt,
  ...extra,
})
const plan = (gadgets: Gadget[]): DeskPlan => ({
  id: 'monitor-hub-plan',
  name: 'monitor hub test',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map(({ id }) => id),
  placements: [],
  outletCount: 8,
  outletCountVersion: 2,
  createdAt,
  updatedAt: createdAt,
})
const hostOf = (gadgets: Gadget[], id: string) =>
  generateWiring(gadgets, plan(gadgets), 'ja').connections.find((c) =>
    c.toGadgetId === id && c.cableType !== 'Power' && !c.chargingOnly)?.fromGadgetId

const pc = () => g('pc', 'PC', [
  p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true }),
  p('USB_A', 'output', 2),
  p('Power', 'input'),
])
const hubMonitor = () => g('monitor', 'Monitor', [
  p('Thunderbolt', 'input', 1, { supportsVideo: true }),
  p('USB_A', 'output', 4),
  p('Power', 'input'),
])

describe('monitor USB hub avoidance', () => {
  it('plugs a MIDI keyboard and an audio interface into the PC, not the monitor hub', () => {
    const gadgets = [
      pc(),
      hubMonitor(),
      g('midi', 'Instrument', [p('USB_C', 'input')]),
      g('audio-if', 'AudioInterface', [p('USB_C', 'input')]),
    ]
    assert.equal(hostOf(gadgets, 'midi'), 'pc')
    assert.equal(hostOf(gadgets, 'audio-if'), 'pc')
  })

  it('still uses a dock before the PC so a laptop keeps its single cable', () => {
    const laptop = g('pc', 'PC', [p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true })], { pcFormFactor: 'laptop' })
    const dock = g('dock', 'Dock', [
      p('Thunderbolt', 'input', 1, { supportsVideo: true }),
      p('USB_A', 'output', 4),
      p('Power', 'input'),
    ])
    const gadgets = [laptop, dock, g('audio-if', 'AudioInterface', [p('USB_C', 'input')])]
    assert.equal(hostOf(gadgets, 'audio-if'), 'dock')
  })

  it('falls back to the monitor hub when the PC has no free port', () => {
    const gadgets = [
      g('pc', 'PC', [p('Thunderbolt', 'bidirectional', 1, { supportsVideo: true }), p('Power', 'input')]),
      hubMonitor(),
      g('audio-if', 'AudioInterface', [p('USB_A', 'input')]),
    ]
    assert.equal(hostOf(gadgets, 'audio-if'), 'monitor')
  })

  it('keeps a laptop on the monitor hub so its USB-C stays free for charging', () => {
    const laptop = g('pc', 'PC', [p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true })], { pcFormFactor: 'laptop' })
    const gadgets = [laptop, hubMonitor(), g('audio-if', 'AudioInterface', [p('USB_A', 'input')])]
    assert.equal(hostOf(gadgets, 'audio-if'), 'monitor')
  })

  it('leaves other wired peripherals such as storage on the monitor hub', () => {
    const gadgets = [pc(), hubMonitor(), g('ssd', 'Storage', [p('USB_A', 'input')])]
    assert.equal(hostOf(gadgets, 'ssd'), 'monitor')
  })
})
