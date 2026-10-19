import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { requiresPhysicalCable } from '../src/constants/portTypes'
import { generateWiring } from '../src/utils/wiringEngine'

let seq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `console-test-port-${++seq}`,
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
const plan = (gadgets: Gadget[], wiredOverrides: string[] = []): DeskPlan => ({
  id: 'console-test-plan',
  name: 'console test',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount: 10,
  outletCountVersion: 2,
  wiredOverrides,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
})
const hasEdge = (result: ReturnType<typeof generateWiring>, from: string, to: string) =>
  result.connections.some((connection) => connection.fromGadgetId === from && connection.toGadgetId === to)

describe('console desk connections', () => {
  it('routes a console through an HDMI switch shared with a PC', () => {
    const console = g('ps5', 'GameConsole', [p('HDMI', 'output', 1, { supportsVideo: true }), p('Power', 'input')])
    const computer = g('pc', 'PC', [p('HDMI', 'output', 1, { supportsVideo: true }), p('Power', 'input')], { pcFormFactor: 'desktop' })
    const selector = g('selector', 'KVM', [p('HDMI', 'input', 2, { supportsVideo: true }), p('HDMI', 'output', 1, { supportsVideo: true }), p('Power', 'input')])
    const monitor = g('monitor', 'Monitor', [p('HDMI', 'input', 1, { supportsVideo: true }), p('Power', 'input')])
    const result = generateWiring([console, computer, selector, monitor], plan([console, computer, selector, monitor]))

    assert.equal(hasEdge(result, 'pc', 'selector'), true)
    assert.equal(hasEdge(result, 'ps5', 'selector'), true)
    assert.equal(hasEdge(result, 'selector', 'monitor'), true)
  })

  it('honors a console dock as the explicit USB receiver target even when a PC exists', () => {
    const console = g('switch2', 'GameConsole', [p('USB_C', 'bidirectional', 2), p('Bluetooth', 'bidirectional')], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' })
    const dock = g('switch2-dock', 'Dock', [p('USB_C', 'input'), p('USB_A', 'output', 2), p('Power', 'input')])
    const computer = g('pc', 'PC', [p('USB_A', 'output', 4), p('Power', 'input')], { pcFormFactor: 'desktop' })
    const headset = g('headset', 'Headphone', [p('USB_A', 'input', 1, { label: 'USBドングル', directAttach: true })], { bluetoothTargetGadgetIds: [dock.id] })
    const gadgets = [console, dock, computer, headset]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(hasEdge(result, 'switch2-dock', 'headset'), true)
    assert.equal(hasEdge(result, 'pc', 'headset'), false)
  })

  it('connects PlayStation VR2 to PS5 as a data link, not a charging-only link', () => {
    const console = g('ps5', 'GameConsole', [p('USB_C', 'output', 1), p('HDMI', 'output', 1, { supportsVideo: true }), p('Power', 'input')])
    const vr = g('psvr2', 'VRGlass', [p('USB_C', 'input', 1, { supportsVideo: true, label: '映像・データ接続' })], { bluetoothTargetGadgetIds: [console.id] })
    const gadgets = [console, vr]
    const result = generateWiring(gadgets, plan(gadgets))
    const connection = result.connections.find((item) => item.fromGadgetId === console.id && item.toGadgetId === vr.id)

    assert.ok(connection)
    assert.equal(connection.chargingOnly, undefined)
    assert.equal(connection.id.startsWith('power-'), false)
  })

  it('keeps a Switch 2 dock available as an explicitly selected controller charger beside a PC', () => {
    const console = g('switch2', 'GameConsole', [p('USB_C', 'bidirectional', 2), p('Bluetooth', 'bidirectional')], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' })
    const dock = g('switch2-dock', 'Dock', [p('USB_C', 'input'), p('USB_A', 'output', 2), p('Power', 'input')])
    const computer = g('pc', 'PC', [p('USB_A', 'output', 4), p('Power', 'input')], { pcFormFactor: 'desktop' })
    const controller = g('switch2-pro', 'Controller', [p('Bluetooth', 'bidirectional'), p('USB_C', 'input')], {
      powerUsage: 'rechargeable',
      bluetoothTargetGadgetIds: [console.id],
      powerSourceGadgetId: dock.id,
    })
    const gadgets = [console, dock, computer, controller]
    const result = generateWiring(gadgets, plan(gadgets))
    const charging = result.connections.find((item) => item.fromGadgetId === dock.id && item.toGadgetId === controller.id)

    assert.ok(charging)
    assert.equal(charging.chargingOnly, true)
  })

  it('routes a standard Switch dock through a USB LAN adapter', () => {
    const console = g('switch', 'GameConsole', [p('USB_C', 'bidirectional', 1, { supportsVideo: true }), p('Bluetooth', 'bidirectional')], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' })
    const dock = g('switch-dock', 'Dock', [p('USB_C', 'input'), p('USB_A', 'output', 3), p('HDMI', 'output', 1, { supportsVideo: true }), p('Power', 'input')])
    const adapter = g('usb-lan', 'Accessory', [p('USB_A', 'input'), p('Ethernet', 'input')], { bluetoothTargetGadgetIds: [dock.id] })
    const router = g('router', 'Router', [p('Ethernet', 'output', 4), p('Power', 'input')])
    const gadgets = [console, dock, adapter, router]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(hasEdge(result, 'switch-dock', 'usb-lan'), true)
    assert.equal(hasEdge(result, 'router', 'usb-lan'), true)
    assert.equal(hasEdge(result, 'router', 'switch-dock'), false)
  })

  it('uses Xbox Wireless instead of Bluetooth between an Xbox and its controller', () => {
    const console = g('xbox', 'GameConsole', [p('XboxWireless', 'bidirectional'), p('USB_A', 'output', 3), p('Power', 'input')], { consoleFormFactor: 'stationary' })
    const controller = g('xbox-controller', 'Controller', [p('XboxWireless', 'bidirectional'), p('Bluetooth', 'bidirectional'), p('USB_C', 'input')], { bluetoothTargetGadgetIds: [console.id], powerUsage: 'replaceable' })
    const gadgets = [console, controller]
    const result = generateWiring(gadgets, plan(gadgets))
    const connection = result.connections.find((item) => item.fromGadgetId === console.id && item.toGadgetId === controller.id)

    assert.ok(connection)
    assert.equal(connection.cableType, 'XboxWireless')
    assert.equal(result.connections.some((item) => item.cableType === 'Bluetooth'), false)
  })

  it('attaches an Xbox storage expansion card without counting a cable', () => {
    const console = g('xbox', 'GameConsole', [p('XboxExpansion', 'output'), p('Power', 'input')], { consoleFormFactor: 'stationary' })
    const storage = g('xbox-expansion', 'Storage', [p('XboxExpansion', 'input', 1, { directAttach: true })], { bluetoothTargetGadgetIds: [console.id] })
    const gadgets = [console, storage]
    const result = generateWiring(gadgets, plan(gadgets))
    const connection = result.connections.find((item) => item.fromGadgetId === console.id && item.toGadgetId === storage.id)

    assert.ok(connection)
    assert.equal(connection.cableType, 'XboxExpansion')
    assert.equal(requiresPhysicalCable(connection.cableType), false)
  })
})
