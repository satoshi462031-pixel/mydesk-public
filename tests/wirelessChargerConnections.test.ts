import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { chargerFormStateFromPorts } from '../src/utils/gadgetPorts'
import { generateWiring } from '../src/utils/wiringEngine'

let seq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `wireless-port-${++seq}`,
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
  id: 'wireless-plan',
  name: 'wireless charger test',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount,
  outletCountVersion: 2,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
})
const wirelessTarget = (id: string, category: GadgetCategory = 'Smartphone', extra: Partial<Gadget> = {}) =>
  g(id, category, [p('wirelessCharging', 'input', 1, { label: 'ワイヤレス給電' })], { powerUsage: 'rechargeable', ...extra })

describe('wireless charger connections', () => {
  it('does not exceed the physical wireless charging slot count', () => {
    const charger = g('single-pad', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output')])
    const first = wirelessTarget('phone-1')
    const second = wirelessTarget('phone-2')
    const gadgets = [charger, first, second]
    const result = generateWiring(gadgets, plan(gadgets))
    const wireless = result.connections.filter((item) => item.fromGadgetId === charger.id && item.cableType === 'wirelessCharging')

    assert.equal(wireless.length, 1)
    assert.ok(result.warnings.some((warning) => warning.includes('phone-2')))
  })

  it('uses all three slots of a 3-in-1 station', () => {
    const charger = g('three-in-one', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output', 3)])
    const gadgets = [charger, wirelessTarget('phone'), wirelessTarget('watch', 'Smartwatch'), wirelessTarget('earbuds', 'Earphone')]
    const result = generateWiring(gadgets, plan(gadgets))
    const wireless = result.connections.filter((item) => item.fromGadgetId === charger.id && item.cableType === 'wirelessCharging')

    assert.equal(wireless.length, 3)
    assert.equal(new Set(wireless.map((item) => item.sourcePortId)).size, 3)
  })

  it('powers a USB-C input wireless puck through an upstream charger first', () => {
    const adapter = g('usb-adapter', 'Charger', [p('Power', 'input'), p('USB_C', 'output', 1, { supportsPowerDelivery: true })])
    const puck = g('wireless-puck', 'Charger', [
      p('USB_C', 'input', 1, { label: 'USB-C給電' }),
      p('wirelessCharging', 'output'),
    ])
    const target = wirelessTarget('phone')
    const gadgets = [adapter, puck, target]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.ok(result.connections.some((item) => item.fromGadgetId === adapter.id && item.toGadgetId === puck.id && item.cableType === 'USB_C'))
    assert.ok(result.connections.some((item) => item.fromGadgetId === puck.id && item.toGadgetId === target.id && item.cableType === 'wirelessCharging'))
  })

  it('respects slot count for charger-declared wireless targets', () => {
    const first = g('declared-phone-1', 'Smartphone', [p('USB_C', 'input')], { powerUsage: 'rechargeable' })
    const second = g('declared-phone-2', 'Smartphone', [p('USB_C', 'input')], { powerUsage: 'rechargeable' })
    const charger = g('declared-pad', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output')], {
      wirelessTargetGadgetIds: [first.id, second.id],
    })
    const gadgets = [charger, first, second]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(result.connections.filter((item) => item.fromGadgetId === charger.id && item.cableType === 'wirelessCharging').length, 1)
  })

  it('keeps a declared pad for its target even when another gadget is wired first', () => {
    // 専用ドックは宣言先（ウォッチ）のために口を空けておく。導入日の早いスマホに取られない
    const dock = g('watch-dock', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output')], {
      wirelessTargetGadgetIds: ['declared-watch'],
    })
    const phone = wirelessTarget('early-phone', 'Smartphone', { createdAt: '2026-07-01T00:00:00.000Z' })
    const watch = wirelessTarget('declared-watch', 'Smartwatch', { createdAt: '2026-08-10T00:00:00.000Z' })
    const gadgets = [dock, phone, watch]
    const result = generateWiring(gadgets, plan(gadgets))
    const wireless = result.connections.filter((item) => item.cableType === 'wirelessCharging')

    assert.deepEqual(wireless.map((item) => item.toGadgetId), [watch.id])
    assert.ok(result.warnings.some((warning) => warning.includes(phone.id)))
  })

  it('sends the undeclared gadget to the generic pad instead of the declared one', () => {
    const dock = g('watch-dock', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output')], {
      wirelessTargetGadgetIds: ['declared-watch'],
    })
    const pad = g('generic-pad', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output')])
    const phone = wirelessTarget('early-phone', 'Smartphone', { createdAt: '2026-07-01T00:00:00.000Z' })
    const watch = wirelessTarget('declared-watch', 'Smartwatch', { createdAt: '2026-08-10T00:00:00.000Z' })
    const gadgets = [dock, pad, phone, watch]
    const result = generateWiring(gadgets, plan(gadgets))
    const sourceOf = (id: string) => result.connections
      .find((item) => item.toGadgetId === id && item.cableType === 'wirelessCharging')?.fromGadgetId

    assert.equal(sourceOf(watch.id), dock.id)
    assert.equal(sourceOf(phone.id), pad.id)
  })

  it('leaves only the declared slots reserved on a multi-slot station', () => {
    // 3口のうち1口だけ宣言先ぶんを確保し、残り2口は宣言の無いガジェットへ回す
    const station = g('three-in-one', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output', 3)], {
      wirelessTargetGadgetIds: ['declared-watch'],
    })
    const gadgets = [
      station,
      wirelessTarget('phone-a', 'Smartphone', { createdAt: '2026-07-01T00:00:00.000Z' }),
      wirelessTarget('earbuds', 'Earphone', { createdAt: '2026-07-02T00:00:00.000Z' }),
      wirelessTarget('declared-watch', 'Smartwatch', { createdAt: '2026-08-10T00:00:00.000Z' }),
    ]
    const result = generateWiring(gadgets, plan(gadgets))
    const wireless = result.connections.filter((item) => item.cableType === 'wirelessCharging')

    assert.equal(wireless.length, 3)
    assert.ok(wireless.some((item) => item.toGadgetId === 'declared-watch'))
    assert.equal(result.warnings.filter((warning) => warning.includes('ワイヤレス充電器')).length, 0)
  })

  it('does not reserve a slot for a declared target that is not on this desk', () => {
    // 宣言先がデスクに居ないなら予約しない（従来どおり他のガジェットが使える）
    const dock = g('watch-dock', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output')], {
      wirelessTargetGadgetIds: ['watch-left-at-home'],
    })
    const phone = wirelessTarget('phone-only')
    const gadgets = [dock, phone]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.ok(result.connections.some((item) =>
      item.fromGadgetId === dock.id && item.toGadgetId === phone.id && item.cableType === 'wirelessCharging'))
  })

  it('restores charger form counts and input from a selected preset', () => {
    const state = chargerFormStateFromPorts([
      p('USB_C', 'input', 1, { label: 'USB-C給電' }),
      p('USB_A', 'output', 2),
      p('wirelessCharging', 'output', 3),
    ])

    assert.deepEqual(state, { usbC: 0, usbA: 2, wirelessCount: 3, powerInput: 'from_c' })
  })

  it('honours the selected source when two chargers declare the same target', () => {
    const first = g('first-pad', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output')], { wirelessTargetGadgetIds: ['phone'] })
    const chosen = g('chosen-pad', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output')], { wirelessTargetGadgetIds: ['phone'] })
    const phone = wirelessTarget('phone', 'Smartphone', { powerSourceGadgetId: chosen.id })
    const gadgets = [first, chosen, phone]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(result.connections.find(item => item.toGadgetId === phone.id)?.fromGadgetId, chosen.id)
  })

  for (const inputType of ['USB_C', 'Lightning', 'microUSB'] as const) {
    it(`falls back from wireless charging to USB-A with a ${inputType} input`, () => {
      const adapter = g('usb-a-adapter', 'Charger', [p('Power', 'input'), p('USB_A', 'output')])
      const phone = wirelessTarget('phone')
      phone.ports.push(p(inputType, 'input', 1, { label: '充電' }))
      const gadgets = [adapter, phone]
      const result = generateWiring(gadgets, plan(gadgets))
      const connection = result.connections.find(item => item.toGadgetId === phone.id)

      assert.equal(connection?.fromGadgetId, adapter.id)
      assert.equal(connection?.fromPortType, 'USB_A')
      assert.equal(connection?.toPortType, inputType)
      assert.ok(connection?.sourcePortId)
      assert.equal(result.warnings.length, 0)
    })
  }

  it('uses a free USB-A slot when USB-C is occupied by a continuous load', () => {
    const adapter = g('adapter', 'Charger', [p('Power', 'input'), p('USB_C', 'output'), p('USB_A', 'output')])
    const lamp = g('lamp', 'Accessory', [p('USB_C', 'input', 1, { label: '給電' })], { powerUsage: 'continuous' })
    const device = wirelessTarget('later-device', 'SmallDevice', { powerUsage: 'continuous' })
    device.ports.push(p('USB_C', 'input', 1, { label: '給電' }))
    const gadgets = [adapter, lamp, device]
    const result = generateWiring(gadgets, plan(gadgets))
    const connection = result.connections.find(item => item.toGadgetId === device.id)

    assert.equal(connection?.fromPortType, 'USB_A')
    assert.equal(connection?.toPortType, 'USB_C')
    assert.notEqual(connection?.sourcePortId, result.connections.find(item => item.toGadgetId === lamp.id)?.sourcePortId)
    assert.equal(result.warnings.length, 0)
  })

  it('does not use a zero-count USB port during wired fallback', () => {
    const adapter = g('empty-adapter', 'Charger', [p('Power', 'input'), p('USB_C', 'output', 0)])
    const phone = wirelessTarget('phone')
    phone.ports.push(p('USB_C', 'input', 1, { label: '充電' }))
    const gadgets = [adapter, phone]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(result.connections.some(item => item.fromGadgetId === adapter.id && item.toGadgetId === phone.id), false)
    assert.ok(result.warnings.some(warning => warning.includes(phone.id)))
  })

  it('keeps the selected charger and slot during wired fallback', () => {
    const first = g('first-adapter', 'Charger', [p('Power', 'input'), p('USB_C', 'output')])
    const chosen = g('chosen-adapter', 'Charger', [p('Power', 'input'), p('USB_C', 'output', 2)])
    const slot = `${chosen.ports[1].id}#1`
    const phone = wirelessTarget('phone', 'Smartphone', { powerSourceGadgetId: chosen.id, powerSourcePortId: slot })
    phone.ports.push(p('USB_C', 'input', 1, { label: '充電' }))
    const gadgets = [first, chosen, phone]
    const result = generateWiring(gadgets, plan(gadgets))
    const connection = result.connections.find(item => item.toGadgetId === phone.id)

    assert.equal(connection?.fromGadgetId, chosen.id)
    assert.equal(connection?.sourcePortId, slot)
  })

  it('lets rechargeable targets take turns on the same wired fallback slot', () => {
    const adapter = g('adapter', 'Charger', [p('Power', 'input'), p('USB_C', 'output')])
    const phones = ['phone-a', 'phone-b'].map(id => {
      const phone = wirelessTarget(id)
      phone.ports.push(p('USB_C', 'input', 1, { label: '充電' }))
      return phone
    })
    const gadgets = [adapter, ...phones]
    const result = generateWiring(gadgets, plan(gadgets))
    const connections = result.connections.filter(item => phones.some(phone => phone.id === item.toGadgetId))

    assert.equal(connections.length, 2)
    assert.equal(connections[0].sourcePortId, connections[1].sourcePortId)
    assert.equal(result.warnings.length, 0)
  })

  it('prefers the selected USB-A source over an automatic USB-C fallback', () => {
    const first = g('usb-c-adapter', 'Charger', [p('Power', 'input'), p('USB_C', 'output')])
    const chosen = g('usb-a-adapter', 'Charger', [p('Power', 'input'), p('USB_A', 'output')])
    const phone = wirelessTarget('phone', 'Smartphone', { powerSourceGadgetId: chosen.id })
    phone.ports.push(p('USB_C', 'input', 1, { label: '充電' }))
    const gadgets = [first, chosen, phone]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(result.connections.find(item => item.toGadgetId === phone.id)?.fromGadgetId, chosen.id)
  })

  it('never wires a wireless-only watch to a USB adapter', () => {
    const adapter = g('adapter', 'Charger', [p('Power', 'input'), p('USB_C', 'output'), p('USB_A', 'output')])
    const watch = wirelessTarget('watch', 'Smartwatch')
    const gadgets = [adapter, watch]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(result.connections.some(item => item.toGadgetId === watch.id), false)
    assert.ok(result.warnings.some(warning => warning.includes('ワイヤレス充電にしか対応していません')))
  })

  it('does not charge a target from an unpowered USB puck', () => {
    const puck = g('puck', 'Charger', [p('USB_C', 'input', 1, { label: 'USB-C給電' }), p('wirelessCharging', 'output')], { wirelessTargetGadgetIds: ['watch'] })
    const watch = wirelessTarget('watch', 'Smartwatch')
    const gadgets = [puck, watch]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(result.connections.some(item => item.fromGadgetId === puck.id), false)
  })

  it('charges wirelessly from a power bank without a wall outlet', () => {
    const battery = g('battery', 'MobileBattery', [p('USB_C', 'bidirectional'), p('wirelessCharging', 'output')])
    const phone = wirelessTarget('phone')
    const gadgets = [battery, phone]
    const result = generateWiring(gadgets, plan(gadgets, 0))

    assert.ok(result.connections.some(item => item.fromGadgetId === battery.id && item.toGadgetId === phone.id && item.cableType === 'wirelessCharging'))
  })

  for (const supportsPassThroughCharging of [false, true]) {
    it(`respects pass-through support (${supportsPassThroughCharging}) for wireless output`, () => {
      const adapter = g('adapter', 'Charger', [p('Power', 'input'), p('USB_C', 'output')])
      const battery = g('battery', 'MobileBattery', [p('USB_C', 'input', 1, { label: '充電' }), p('wirelessCharging', 'output')], { powerUsage: 'rechargeable', supportsPassThroughCharging })
      const phone = wirelessTarget('phone')
      const gadgets = [adapter, battery, phone]
      const result = generateWiring(gadgets, plan(gadgets))

      assert.ok(result.connections.some(item => item.fromGadgetId === adapter.id && item.toGadgetId === battery.id))
      assert.equal(result.connections.some(item => item.fromGadgetId === battery.id && item.toGadgetId === phone.id), supportsPassThroughCharging)
    })
  }
})
