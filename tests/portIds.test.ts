import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ALL_PRODUCT_PRESETS } from '../src/constants/gadgetPresets'
import { CATEGORY_PORT_CONFIG, initPortState } from '../src/constants/portFormConfig'
import type { Gadget, GadgetCategory, Port } from '../src/types'
import { buildGadgetPorts, chargerFormStateFromPorts, defaultPowerInputForCategory, inferPowerFromPorts } from '../src/utils/gadgetPorts'
import { normalizePorts } from '../src/utils/portTypeMigration'
import { generateWiring } from '../src/utils/wiringEngine'

// 編集画面で開いて、何も変えずに保存したときのポート
const resave = (category: GadgetCategory, ports: Port[]) => {
  const charger = chargerFormStateFromPorts(ports)
  const wireless = ports.some((p) => p.type === 'Bluetooth')
  return buildGadgetPorts({
    category,
    portState: initPortState(ports, CATEGORY_PORT_CONFIG[category] ?? []),
    mouseConnType: wireless ? 'wireless' : 'wired',
    periConnType: wireless ? 'wireless' : 'wired',
    powerInput: inferPowerFromPorts(category, ports)?.powerInput ?? defaultPowerInputForCategory(category),
    charge: { usbC: charger.usbC, usbA: charger.usbA, wirelessCount: charger.wirelessCount },
    strip: { outlets: 6, usbC: 0, usbA: 0, grounded: true },
    previousPorts: ports,
  })
}
const duplicateIds = (ports: Port[]) =>
  ports.map((p) => p.id).filter((id, i, all) => all.indexOf(id) !== i)
const presetPorts = (name: string) =>
  (ALL_PRODUCT_PRESETS.find((p) => p.name === name) as unknown as { ports: Port[] }).ports

describe('port ids', () => {
  it('keeps port ids unique after re-saving every preset in the edit form', () => {
    const broken = ALL_PRODUCT_PRESETS.flatMap((preset) => {
      const ports = (preset as { ports?: Port[] }).ports
      if (!ports?.length || !preset.category) return []
      const dups = duplicateIds(resave(preset.category, ports))
      return dups.length > 0 ? [`${preset.name}: ${dups.join(',')}`] : []
    })
    assert.deepEqual(broken, [])
  })

  it('keeps the ids of ports the form did not rebuild', () => {
    const ports = presetPorts('MOTU M4')
    const saved = resave('AudioInterface', ports)
    const line = saved.find((p) => p.label === '6.3mm TRS ライン出力 ×4')
    assert.equal(line?.id, ports.find((p) => p.label === '6.3mm TRS ライン出力 ×4')?.id)
  })

  it('repairs duplicate ids left in stored data on load', () => {
    const stored: Port[] = [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 4, label: '6.3mm TRS ライン出力 ×4' },
    ]
    const loaded = normalizePorts(stored)
    assert.deepEqual(duplicateIds(loaded), [])
    assert.deepEqual(loaded.slice(0, 2), stored.slice(0, 2))
  })
})

describe('audio output choice', () => {
  const at = '2026-09-21T00:00:00.000Z'
  const g = (id: string, category: GadgetCategory, ports: Port[], extra: Partial<Gadget> = {}): Gadget =>
    ({ id, name: id, category, ports, createdAt: at, ...extra })
  const wire = (gadgets: Gadget[]) => generateWiring(gadgets, {
    id: 'audio-plan', name: 'audio', goal: 'clean_wiring',
    selectedGadgetIds: gadgets.map((x) => x.id), placements: [], outletCount: 8,
    createdAt: at, updatedAt: at,
  } as never, 'ja')
  const monitorSpeaker = (id: string) =>
    g(id, 'Speaker', [{ id: 'a', type: 'Audio6_3mm', direction: 'input', count: 1 }, { id: 'b', type: 'Power', direction: 'input', count: 1 }])
  const pc = () => g('pc', 'PC', [{ id: 'a', type: 'USB_C', direction: 'output', count: 4 }, { id: 'b', type: 'Power', direction: 'input', count: 1 }], { pcFormFactor: 'desktop' })

  it('feeds 6.3mm monitors from the 6.3mm line outs even when RCA is listed first', () => {
    const iface = g('if', 'AudioInterface', [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'RCA', direction: 'output', count: 4, label: 'RCA ライン出力 ×4' },
      { id: 'p3', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 4, label: '6.3mm TRS ライン出力 ×4' },
    ])
    const result = wire([pc(), iface, monitorSpeaker('L'), monitorSpeaker('R')])
    const toSpeakers = result.connections.filter((c) => c.fromGadgetId === 'if' && (c.toGadgetId === 'L' || c.toGadgetId === 'R'))
    assert.deepEqual(toSpeakers.map((c) => c.cableType), ['Audio6_3mm', 'Audio6_3mm'])
  })

  it('still avoids the headphone out for monitors, even if it matches the jack', () => {
    const iface = g('if', 'AudioInterface', [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p3', type: 'RCA', direction: 'output', count: 2, label: 'RCA ライン出力' },
    ])
    const result = wire([pc(), iface, monitorSpeaker('L')])
    const toSpeaker = result.connections.find((c) => c.fromGadgetId === 'if' && c.toGadgetId === 'L')
    assert.equal(toSpeaker?.sourcePortId, 'p3')
  })
})
