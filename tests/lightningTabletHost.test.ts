import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

let seq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `lightning-port-${++seq}`,
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
  createdAt: '2026-09-01T00:00:00.000Z',
  ...extra,
})
const plan = (gadgets: Gadget[]): DeskPlan => ({
  id: 'lightning-plan',
  name: 'lightning tablet',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount: 2,
  outletCountVersion: 2,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
})

const lightningPad = () => g('iPad', 'Tablet', [
  p('Lightning', 'bidirectional', 1, { label: '充電・データ' }),
  p('Bluetooth', 'bidirectional'),
], { powerUsage: 'rechargeable' })
const audioInterface = () => g('オーディオIF', 'AudioInterface', [
  p('USB_C', 'input', 1, { label: 'PC接続 / バスパワー' }),
  p('XLR', 'input', 1),
])

// Lightning の iPad はケーブル1本では USB 機器のホストになれない。以前は「つなぐPCがありません」と
// 言っていて、iPad を置いた人には何が足りないのか読めなかった
describe('Lightning の iPad と USB 機器', () => {
  it('アダプタが無ければ線を引かず、カメラアダプタが要ると言う', () => {
    const pad = lightningPad()
    const audio = audioInterface()
    const result = generateWiring([pad, audio], plan([pad, audio]), 'ja')
    assert.ok(!result.connections.some((c) => c.fromGadgetId === pad.id && c.toGadgetId === audio.id))
    assert.ok(result.warnings.some((w) => w.includes('カメラアダプタ')), result.warnings.join('\n'))
    assert.ok(!result.warnings.some((w) => w.includes('つなぐPCがありません')), result.warnings.join('\n'))
  })

  it('カメラアダプタを挟めば iPad → アダプタ → オーディオIF でつながり、充電の警告は Lightning の名前で出す', () => {
    const pad = lightningPad()
    const adapter = g('カメラアダプタ', 'Dock', [p('Lightning', 'input', 1, { label: 'Host' }), p('USB_A', 'output', 1)])
    const audio = audioInterface()
    const result = generateWiring([pad, adapter, audio], plan([pad, adapter, audio]), 'ja')
    assert.ok(result.connections.some((c) => c.fromGadgetId === pad.id && c.toGadgetId === adapter.id))
    assert.ok(result.connections.some((c) => c.fromGadgetId === adapter.id && c.toGadgetId === audio.id))
    assert.ok(!result.warnings.some((w) => w.includes('USB-C の口')), result.warnings.join('\n'))
  })
})
