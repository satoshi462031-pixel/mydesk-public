import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { buildGadgetPorts, canSelectPowerSource, canSupplyPowerInput } from '../src/utils/gadgetPorts'
import { generateWiring } from '../src/utils/wiringEngine'

let seq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `standing-desk-port-${++seq}`,
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
  createdAt: '2026-08-30T00:00:00.000Z',
  ...extra,
})
const plan = (gadgets: Gadget[], outletCount = 4): DeskPlan => ({
  id: 'standing-desk-plan',
  name: 'standing desk test',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount,
  outletCountVersion: 2,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
})

describe('electric standing desk connections', () => {
  it('powers an electric desk and warns about cable slack at maximum height', () => {
    const desk = g('electric-desk', 'Desk', [p('Power', 'input')], {
      isHeightAdjustable: true,
      deskLiftType: 'electric',
      deskHeightMin: '62',
      deskHeightMax: '126',
    })
    const result = generateWiring([desk], plan([desk]))

    assert.equal(result.connections.some((item) => item.fromGadgetId === 'wall' && item.toGadgetId === desk.id), true)
    assert.equal(result.warnings.some((warning) => /最高位置|maximum height/.test(warning)), true)
  })

  it('uses powered USB ports built into an electric desk for charging', () => {
    const desk = g('usb-desk', 'Desk', [
      p('Power', 'input'),
      p('USB_C', 'output', 1, { label: '充電用USB-C' }),
    ], { isHeightAdjustable: true, deskLiftType: 'electric' })
    const phone = g('phone', 'Smartphone', [p('USB_C', 'input', 1, { label: '充電' })], {
      powerUsage: 'rechargeable',
      powerSourceGadgetId: desk.id,
    })
    const gadgets = [desk, phone]
    const result = generateWiring(gadgets, plan(gadgets))
    const charging = result.connections.find((item) => item.fromGadgetId === desk.id && item.toGadgetId === phone.id)

    assert.ok(charging)
    assert.equal(charging.chargingOnly, true)
  })

  it('does not add power or cable-slack warnings to a manual standing desk', () => {
    const desk = g('manual-desk', 'Desk', [], { isHeightAdjustable: true, deskLiftType: 'manual' })
    const result = generateWiring([desk], plan([desk]))

    assert.equal(result.connections.some((item) => item.toGadgetId === desk.id), false)
    assert.equal(result.warnings.some((warning) => /最高位置|maximum height/.test(warning)), false)
  })

  it('uses built-in desk outlets as an AC distributor', () => {
    const desk = g('outlet-desk', 'Desk', [
      p('Power', 'input'),
      p('Power', 'output', 2, { label: '内蔵ACコンセント' }),
      p('USB_A', 'output', 1, { label: '給電用USB-A' }),
    ])
    const first = g('monitor-1', 'Monitor', [p('Power', 'input')])
    const second = g('monitor-2', 'Monitor', [p('Power', 'input')])
    const gadgets = [desk, first, second]
    const result = generateWiring(gadgets, plan(gadgets, 1))

    assert.equal(result.connections.filter((item) => item.fromGadgetId === 'wall').length, 1)
    assert.equal(result.connections.some((item) => item.fromGadgetId === 'wall' && item.toGadgetId === desk.id), true)
    assert.equal(result.connections.filter((item) => item.fromGadgetId === desk.id && item.cableType === 'Power').length, 2)
  })

  it('offers a powered desk USB port as a selectable charging source', () => {
    const desk = g('source-desk', 'Desk', [
      p('Power', 'input'),
      p('USB_C', 'output', 1, { label: '充電用USB-C' }),
    ])

    assert.equal(canSelectPowerSource('Smartphone', desk.category), true)
    assert.equal(canSupplyPowerInput(desk, 'from_c'), true)
  })

  it('automatically adds AC input when desk power outputs are configured', () => {
    const ports = buildGadgetPorts({
      category: 'Desk',
      portState: { power_in: false, power_out: 2, usbc_out: 0, usba_out: 1 },
      mouseConnType: 'wireless',
      periConnType: 'wireless',
      powerInput: 'none',
      charge: { usbC: 0, usbA: 0, wirelessCount: 0 },
      strip: { outlets: 0, usbC: 0, usbA: 0, grounded: false },
    })

    assert.equal(ports.some((item) => item.type === 'Power' && item.direction === 'input'), true)
    assert.equal(ports.find((item) => item.type === 'Power' && item.direction === 'output')?.count, 2)
    assert.equal(ports.find((item) => item.type === 'USB_A' && item.direction === 'output')?.count, 1)
  })
})
