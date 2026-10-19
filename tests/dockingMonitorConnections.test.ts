import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GADGET_PRESETS } from '../src/constants/gadgetPresets'
import { buildPortsFromState, CATEGORY_PORT_CONFIG, initPortState } from '../src/constants/portFormConfig'
import type { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

let seq = 0
const createdAt = '2026-08-30T00:00:00.000Z'
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `docking-monitor-port-${++seq}`,
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
  id: 'docking-monitor-plan',
  name: 'docking monitor test',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map(({ id }) => id),
  placements: [],
  outletCount: 8,
  outletCountVersion: 2,
  createdAt,
  updatedAt: createdAt,
})
const wire = (gadgets: Gadget[]) => generateWiring(gadgets, plan(gadgets), 'ja')
const has = (result: ReturnType<typeof wire>, from: string, to: string, cableType: string) =>
  result.connections.some((connection) =>
    connection.fromGadgetId === from && connection.toGadgetId === to && connection.cableType === cableType,
  )
const dockingMonitor = (id = 'monitor') => g(id, 'Monitor', [
  p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt upstream (PD 100W)' }),
  p('Thunderbolt', 'output', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt daisy-chain (PD 15W)' }),
  p('USB_A', 'output', 2),
  p('Ethernet', 'input'),
  p('Power', 'input'),
])

describe('docking monitor connections', () => {
  it('uses one Thunderbolt cable for laptop video, USB data, and PD', () => {
    const laptop = g('laptop', 'PC', [p('Thunderbolt', 'bidirectional', 1, { supportsVideo: true })], { pcFormFactor: 'laptop' })
    const monitor = dockingMonitor()
    const result = wire([laptop, monitor])

    assert.equal(has(result, laptop.id, monitor.id, 'Thunderbolt'), true)
    assert.equal(result.connections.filter((connection) =>
      connection.fromGadgetId === monitor.id && connection.toGadgetId === laptop.id).length, 0)
    assert.equal(result.connections.filter((connection) =>
      connection.fromGadgetId === laptop.id && connection.toGadgetId === monitor.id).length, 1)
  })

  it('routes USB peripherals through a monitor only after its upstream link is active', () => {
    const laptop = g('laptop', 'PC', [p('Thunderbolt', 'bidirectional', 1, { supportsVideo: true })], { pcFormFactor: 'laptop' })
    const monitor = dockingMonitor()
    const keyboard = g('keyboard', 'Keyboard', [p('USB_A', 'input')])
    const result = wire([laptop, monitor, keyboard])

    assert.equal(has(result, monitor.id, keyboard.id, 'USB_A'), true)
  })

  it('adds a separate USB upstream cable when desktop video uses HDMI', () => {
    const desktop = g('desktop', 'PC', [
      p('HDMI', 'output', 1, { supportsVideo: true }),
      p('USB_A', 'output'),
      p('Power', 'input'),
    ], { pcFormFactor: 'desktop' })
    const monitor = g('monitor', 'Monitor', [
      p('HDMI', 'input', 1, { supportsVideo: true }),
      p('USB_B', 'input'),
      p('USB_A', 'output'),
      p('Power', 'input'),
    ])
    const mouse = g('mouse', 'Mouse', [p('USB_A', 'input')])
    const result = wire([desktop, monitor, mouse])

    assert.equal(has(result, desktop.id, monitor.id, 'HDMI'), true)
    assert.equal(has(result, desktop.id, monitor.id, 'USB_A_to_B'), true)
    assert.equal(has(result, monitor.id, mouse.id, 'USB_A'), true)
  })

  it('uses a data-only USB-C KVM upstream while desktop video uses HDMI', () => {
    const desktop = g('desktop', 'PC', [
      p('HDMI', 'output', 1, { supportsVideo: true }),
      p('USB_C', 'output'),
      p('Power', 'input'),
    ], { pcFormFactor: 'desktop' })
    const monitor = g('monitor', 'Monitor', [
      p('HDMI', 'input', 1, { supportsVideo: true }),
      p('USB_C', 'input', 1, { label: 'USB-C KVM upstream' }),
      p('USB_A', 'output'),
      p('Power', 'input'),
    ])
    const keyboard = g('keyboard', 'Keyboard', [p('USB_A', 'input')])
    const result = wire([desktop, monitor, keyboard])

    assert.equal(has(result, desktop.id, monitor.id, 'HDMI'), true)
    assert.equal(has(result, desktop.id, monitor.id, 'USB_C'), true)
    assert.equal(has(result, monitor.id, keyboard.id, 'USB_A'), true)
  })

  it('connects the router to the monitor Ethernet dock', () => {
    const laptop = g('laptop', 'PC', [p('Thunderbolt', 'bidirectional', 1, { supportsVideo: true })], { pcFormFactor: 'laptop' })
    const monitor = dockingMonitor()
    const router = g('router', 'Router', [p('Ethernet', 'output', 4), p('Power', 'input')])
    const result = wire([laptop, monitor, router])

    assert.equal(has(result, router.id, monitor.id, 'Ethernet'), true)
  })

  it('uses the first monitor Thunderbolt output for a second display', () => {
    const laptop = g('laptop', 'PC', [p('Thunderbolt', 'bidirectional', 1, { supportsVideo: true })], { pcFormFactor: 'laptop' })
    const primary = dockingMonitor('primary')
    const secondary = g('secondary', 'Monitor', [p('Thunderbolt', 'input', 1, { supportsVideo: true }), p('Power', 'input')])
    const result = wire([laptop, primary, secondary])

    assert.equal(has(result, laptop.id, primary.id, 'Thunderbolt'), true)
    assert.equal(has(result, primary.id, secondary.id, 'Thunderbolt'), true)
  })

  it('restores monitor PD capabilities in the port editor', () => {
    const fields = CATEGORY_PORT_CONFIG.Monitor ?? []
    const original = [
      p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C upstream (PD 96W)' }),
      p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 upstream (PD 140W)' }),
      p('Thunderbolt', 'output', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 downstream (PD 15W)' }),
    ]
    const state = initPortState(original, fields)
    const rebuilt = buildPortsFromState(state, fields)

    assert.equal(state.usbc_pd_in, 1)
    assert.equal(state.tb_pd_in, 1)
    assert.equal(state.tb_pd_out, 1)
    assert.equal(rebuilt.filter((port) => port.supportsPowerDelivery).length, 3)
  })

  const hdmiLaptop = (id = 'laptop') => g(id, 'PC', [
    p('HDMI', 'output'), p('USB_C', 'bidirectional', 2), p('USB_A', 'output', 2),
  ], { pcFormFactor: 'laptop' })
  const hdmiPdMonitor = () => g('monitor', 'Monitor', [
    p('HDMI', 'input', 2), p('USB_B', 'input'),
    p('USB_C', 'output', 1, { supportsPowerDelivery: true }), p('Power', 'input'),
  ])

  it('does not reuse the monitor PD output occupied by an SSD to charge a laptop', () => {
    const monitor = hdmiPdMonitor()
    const result = wire([hdmiLaptop(), monitor, g('ssd', 'Storage', [p('USB_C', 'input')])])
    assert.equal(has(result, monitor.id, 'ssd', 'USB_C'), true)
    assert.equal(has(result, monitor.id, 'laptop', 'USB_C'), false)
    assert.ok(result.warnings.some((warning) => warning.includes('laptop')))
  })

  it('reserves a separate monitor PD output for each laptop', () => {
    const monitor = hdmiPdMonitor()
    const result = wire([hdmiLaptop('work'), hdmiLaptop('personal'), monitor])
    const power = result.connections.filter((connection) =>
      connection.fromGadgetId === monitor.id && connection.fromPortType === 'USB_C')
    assert.equal(power.length, 1)
    assert.ok(power[0].sourcePortId)
    assert.ok(result.warnings.some((warning) => warning.includes('personal')))
  })

  it('does not add a monitor charging cable to a laptop port occupied by a hub', () => {
    const laptop = hdmiLaptop()
    laptop.ports.find((port) => port.type === 'USB_C')!.count = 1
    const monitor = hdmiPdMonitor()
    const hub = g('hub', 'Hub', [p('USB_C', 'input'), p('USB_A', 'output', 3)])
    const result = wire([laptop, monitor, hub])
    assert.equal(has(result, laptop.id, hub.id, 'USB_C'), true)
    assert.equal(has(result, monitor.id, laptop.id, 'USB_C'), false)
    assert.ok(result.warnings.some((warning) => warning.includes('laptop')))
  })

  it('honors a separate charger selected for an HDMI-connected laptop', () => {
    const laptop = { ...hdmiLaptop(), powerSourceGadgetId: 'charger' }
    const charger = g('charger', 'Charger', [p('USB_C', 'output'), p('Power', 'input')])
    const result = wire([laptop, hdmiPdMonitor(), charger])
    assert.equal(has(result, 'charger', laptop.id, 'USB_C'), true)
    assert.equal(has(result, 'monitor', laptop.id, 'USB_C'), false)
  })

  it('records the selected monitor PD socket so a light cannot reuse it', () => {
    const monitor = hdmiPdMonitor()
    const laptop = hdmiLaptop()
    const light = g('light', 'Light', [p('USB_C', 'input', 1, { label: '給電' })])
    const result = wire([laptop, monitor, light])
    const power = result.connections.filter((connection) =>
      connection.fromGadgetId === monitor.id && connection.fromPortType === 'USB_C')
    assert.equal(power.length, 1)
    assert.equal(power[0].toGadgetId, laptop.id)
    assert.ok(power[0].sourcePortId)
    assert.ok(result.warnings.some((warning) => warning.includes('light')))
  })

  for (const pdFirst of [true, false]) {
    it(`uses the physical PD socket when it is listed ${pdFirst ? 'first' : 'last'}`, () => {
      const monitor = hdmiPdMonitor()
      const pd = monitor.ports.find((port) => port.type === 'USB_C')!
      const regular = p('USB_C', 'output')
      monitor.ports = [...monitor.ports.filter((port) => port.type !== 'USB_C'),
        ...(pdFirst ? [pd, regular] : [regular, pd])]
      const result = wire([hdmiLaptop(), monitor])
      const power = result.connections.find((connection) =>
        connection.fromGadgetId === monitor.id && connection.toGadgetId === 'laptop')
      assert.equal(power?.sourcePortId, `${pd.id}#0`)
    })

    it(`does not substitute a regular USB-C output for occupied PD (${pdFirst ? 'PD first' : 'PD last'})`, () => {
      const monitor = hdmiPdMonitor()
      const pd = monitor.ports.find((port) => port.type === 'USB_C')!
      const regular = p('USB_C', 'output')
      monitor.ports = [...monitor.ports.filter((port) => port.type !== 'USB_C'),
        ...(pdFirst ? [pd, regular] : [regular, pd])]
      const result = wire([hdmiLaptop('work'), hdmiLaptop('personal'), monitor])
      const power = result.connections.filter((connection) =>
        connection.fromGadgetId === monitor.id && connection.fromPortType === 'USB_C')
      assert.equal(power.length, 1)
      assert.equal(power[0].sourcePortId, `${pd.id}#0`)
      assert.ok(result.warnings.some((warning) => warning.includes('personal')))
    })
  }

  it('keeps the PD socket occupied by a downstream USB-C display', () => {
    const monitor = hdmiPdMonitor()
    const pd = monitor.ports.find((port) => port.type === 'USB_C')!
    pd.supportsVideo = true
    monitor.ports = [p('USB_C', 'output'), ...monitor.ports]
    const secondary = g('secondary', 'Monitor', [p('USB_C', 'input', 1, { supportsVideo: true }), p('Power', 'input')])
    const result = wire([hdmiLaptop(), monitor, secondary])
    assert.equal(has(result, monitor.id, secondary.id, 'USB_C'), true)
    assert.equal(has(result, monitor.id, 'laptop', 'USB_C'), false)
    assert.ok(result.warnings.some((warning) => warning.includes('laptop')))
  })

  it('uses the PD socket of a mixed-output dock even without a data connection to that dock', () => {
    const regular = p('USB_C', 'output')
    const pd = p('USB_C', 'output', 1, { supportsPowerDelivery: true })
    const dock = g('dock', 'Dock', [regular, pd, p('Power', 'input')])
    const result = wire([hdmiLaptop(), dock])
    const power = result.connections.find((connection) =>
      connection.fromGadgetId === dock.id && connection.toGadgetId === 'laptop')
    assert.equal(power?.sourcePortId, `${pd.id}#0`)
    assert.equal(result.warnings.some((warning) => /laptop.*(?:充電|給電|PD)/.test(warning)), false)
  })

  it('provides ten verified docking-monitor presets', () => {
    const names = [
      'Dell U2725QE',
      'Dell UltraSharp U3225QE',
      'EIZO FlexScan EV2795',
      'BenQ PD3225U',
      'ASUS ProArt PA279CRV',
      'Philips 27B1U7903',
      'LG 40WP95C-W',
      'Lenovo ThinkVision P27h-30 (27" QHD)',
      'HP Series 7 Pro 727pu',
      'Dell Pro 27 Plus P2725HE',
    ]
    const presets = names.map((name) => GADGET_PRESETS.find((preset) => preset.name === name))

    assert.equal(presets.filter(Boolean).length, 10)
    for (const preset of presets) {
      assert.ok(preset?.officialUrl)
      assert.ok(preset.ports.some((port) => port.supportsVideo && port.supportsPowerDelivery))
      assert.ok(preset.ports.some((port) => port.type === 'USB_A' && port.direction === 'output'))
    }
  })
})
