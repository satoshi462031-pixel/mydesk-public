import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType, WiringSuggestion } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

let seq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port =>
  ({ id: `sugg-port-${++seq}`, type, direction, count, ...extra })
const g = (id: string, category: GadgetCategory, ports: Port[], extra: Partial<Gadget> = {}): Gadget =>
  ({ id, name: id, category, ports, createdAt: '2026-08-01T00:00:00.000Z', ...extra })
const plan = (gadgets: Gadget[], outletCount = 1): DeskPlan => ({
  id: 'suggestion-plan',
  name: 'suggestions',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount,
  outletCountVersion: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
})
const find = (list: WiringSuggestion[] | undefined, category: GadgetCategory) =>
  (list ?? []).find((item) => item.category === category)

const desktop = (id = 'pc', ports: Port[] = []) =>
  g(id, 'PC', [p('Power', 'input'), ...ports], { pcFormFactor: 'desktop' })
const monitor = (id: string) =>
  g(id, 'Monitor', [p('HDMI', 'input', 1, { supportsVideo: true }), p('Power', 'input')])
const wirelessMouse = (id: string) => g(id, 'Mouse', [
  p('Bluetooth', 'bidirectional'),
  p('USB_C', 'input', 1, { label: '給電 (C)' }),
], { powerUsage: 'rechargeable' })

describe('wiring suggestions', () => {
  it('壁コンセントの空きが足りなければ電源タップを勧める', () => {
    const gadgets = [desktop('pc', [p('HDMI', 'output', 2, { supportsVideo: true })]), monitor('m1'), monitor('m2')]
    const result = generateWiring(gadgets, plan(gadgets, 1))

    assert.equal(find(result.suggestions, 'PowerStrip')?.reason, 'outlet')
  })

  // 壁コンセントが1口も無い構成では、電源タップを足しても挿す先が無い
  it('壁コンセントが0口なら電源タップを勧めない', () => {
    const gadgets = [desktop('pc', [p('HDMI', 'output', 2, { supportsVideo: true })]), monitor('m1')]
    const result = generateWiring(gadgets, plan(gadgets, 0))

    assert.equal(find(result.suggestions, 'PowerStrip'), undefined)
  })

  it('充電が要る機器に供給元が無ければ充電器を勧める', () => {
    const gadgets = [desktop(), wirelessMouse('m')]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(find(result.suggestions, 'Charger')?.reason, 'charger')
  })

  it('同じ不足は1件にまとめ、きっかけのガジェットを並べる', () => {
    const gadgets = [desktop(), wirelessMouse('m1'), wirelessMouse('m2')]
    const result = generateWiring(gadgets, plan(gadgets))
    const charger = find(result.suggestions, 'Charger')

    assert.equal((result.suggestions ?? []).filter((s) => s.category === 'Charger').length, 1)
    assert.deepEqual(charger?.gadgetIds, ['m1', 'm2'])
  })

  it('周辺機器を挿す USB の口が足りなければハブを勧める', () => {
    const gadgets = [
      desktop('pc', [p('USB_A', 'output', 1)]),
      g('k', 'Keyboard', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('w', 'Webcam', [p('USB_A', 'input', 1)]),
    ]
    const result = generateWiring(gadgets, plan(gadgets))
    const hub = find(result.suggestions, 'Hub')

    assert.equal(hub?.reason, 'usbPort')
    assert.ok((hub?.gadgetIds.length ?? 0) > 0)
  })

  it('不足が無ければ何も勧めない', () => {
    const gadgets = [desktop('pc', [p('HDMI', 'output', 1, { supportsVideo: true })]), monitor('m1')]
    const result = generateWiring(gadgets, plan(gadgets, 4))

    assert.deepEqual(result.suggestions, [])
  })
})
