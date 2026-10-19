import assert from 'node:assert/strict'
import { DeskPlan, Gadget, Port, PortType } from '../src/types'
import { buildGadgetPorts, canSelectPowerSource, canSupplyPowerInput } from '../src/utils/gadgetPorts'
import { generateWiring } from '../src/utils/wiringEngine'

const port = (id: string, type: PortType, direction: Port['direction'], count = 1, label?: string): Port =>
  ({ id, type, direction, count, label })
const gadget = (id: string, category: Gadget['category'], ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category,
  ports,
  createdAt: `2026-08-16T00:00:0${id.length % 10}.000Z`,
  ...extra,
})
const strip = (id: string, outlets: number, usbC = 0, usbA = 0): Gadget => gadget(id, 'PowerStrip', [
  port(`${id}-ac`, 'Power', 'output', outlets, '2極'),
  ...(usbC > 0 ? [port(`${id}-c`, 'USB_C', 'output', usbC)] : []),
  ...(usbA > 0 ? [port(`${id}-a`, 'USB_A', 'output', usbA)] : []),
  port(`${id}-in`, 'Power', 'input'),
])
const acLoad = (id: string, sourceId?: string): Gadget => gadget(id, 'Monitor', [
  port(`${id}-in`, 'Power', 'input'),
], { powerUsage: 'continuous', powerSourceGadgetId: sourceId })
const plan = (gadgets: Gadget[], outletCount: number): DeskPlan => ({
  id: 'power-strip-audit',
  name: 'power-strip-audit',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount,
  outletCountVersion: 2,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
})
const wire = (gadgets: Gadget[], outletCount: number) => generateWiring(gadgets, plan(gadgets, outletCount))

const twoOutletStrip = strip('strip', 2)
const acLoads = [acLoad('monitor-1'), acLoad('monitor-2'), acLoad('monitor-3')]
const capacityResult = wire([twoOutletStrip, ...acLoads], 1)
assert.equal(capacityResult.connections.filter((item) => item.fromGadgetId === 'wall').length, 1)
assert.equal(capacityResult.connections.filter((item) => item.fromGadgetId === twoOutletStrip.id && item.cableType === 'Power').length, 2)
assert.ok(capacityResult.warnings.some((warning) => warning.includes('monitor-3')))

const usbStrip = strip('usb-strip', 2, 1)
const phone = gadget('phone', 'Smartphone', [port('phone-c', 'USB_C', 'input')], {
  powerUsage: 'rechargeable',
  powerSourceGadgetId: usbStrip.id,
})
const usbResult = wire([usbStrip, phone], 1)
const phoneConnection = usbResult.connections.find((item) => item.fromGadgetId === usbStrip.id && item.toGadgetId === phone.id)
assert.equal(phoneConnection?.sourcePortId, 'usb-strip-c#0')
assert.ok(!usbResult.connections.some((item) => item.fromGadgetId === 'failed-power' && item.toGadgetId === phone.id))

const noOutletResult = wire([usbStrip, phone], 0)
assert.ok(!noOutletResult.connections.some((item) => item.fromGadgetId === usbStrip.id))
assert.ok(noOutletResult.connections.some((item) => item.fromGadgetId === 'failed-power' && item.toGadgetId === phone.id))
assert.ok(noOutletResult.warnings.some((warning) => warning.includes(usbStrip.name)))

const usbPoweredCharger = gadget('usb-charger', 'Charger', [
  port('charger-in', 'USB_C', 'input', 1, '給電'),
  port('charger-wireless', 'wirelessCharging', 'output'),
], { powerUsage: 'continuous' })
const continuousUsbLoad = gadget('continuous-load', 'Light', [port('load-c', 'USB_C', 'input')], {
  powerUsage: 'continuous',
  powerSourceGadgetId: usbStrip.id,
  powerSourcePortId: 'usb-strip-c#0',
})
const exclusiveResult = wire([usbStrip, usbPoweredCharger, continuousUsbLoad], 1)
const stripUsbConnections = exclusiveResult.connections.filter((item) =>
  item.fromGadgetId === usbStrip.id && item.fromPortType === 'USB_C')
assert.equal(stripUsbConnections.length, 1, 'USB-C 1口へ常時給電機器を二重接続しない')
assert.equal(stripUsbConnections[0].toGadgetId, usbPoweredCharger.id)
assert.equal(stripUsbConnections[0].sourcePortId, 'usb-strip-c#0')
assert.ok(exclusiveResult.connections.some((item) => item.fromGadgetId === 'failed-power' && item.toGadgetId === continuousUsbLoad.id))

const ups = gadget('ups', 'UPS', [
  port('ups-out', 'Power', 'output'),
  port('ups-in', 'Power', 'input'),
])
const protectedStrip = strip('protected-strip', 2)
const protectedLoad = acLoad('protected-load')
const upsResult = wire([ups, protectedStrip, protectedLoad], 1)
assert.ok(upsResult.connections.some((item) => item.fromGadgetId === 'wall' && item.toGadgetId === ups.id))
assert.ok(upsResult.connections.some((item) => item.fromGadgetId === ups.id && item.toGadgetId === protectedStrip.id))
assert.ok(upsResult.connections.some((item) => item.fromGadgetId === protectedStrip.id && item.toGadgetId === protectedLoad.id))

const stripA = strip('strip-a', 1)
const stripB = strip('strip-b', 1)
const pinnedLoad = acLoad('pinned-load', stripA.id)
const pinnedResult = wire([stripA, stripB, pinnedLoad], 2)
assert.ok(pinnedResult.connections.some((item) => item.fromGadgetId === stripA.id && item.toGadgetId === pinnedLoad.id))

const groundedPorts = buildGadgetPorts({
  category: 'PowerStrip',
  portState: {},
  mouseConnType: 'wireless',
  periConnType: 'wireless',
  powerInput: 'none',
  charge: { usbC: 0, usbA: 0, wirelessCount: 0 },
  strip: { outlets: 6, usbC: 2, usbA: 1, grounded: true },
})
assert.ok(groundedPorts.some((item) => item.type === 'Power' && item.direction === 'output' && item.count === 6 && item.label?.includes('アース')))
assert.equal(groundedPorts.filter((item) => item.type === 'Power' && item.direction === 'input').length, 1)
assert.equal(groundedPorts.find((item) => item.type === 'USB_C')?.count, 2)
assert.equal(groundedPorts.find((item) => item.type === 'USB_A')?.count, 1)

assert.equal(canSelectPowerSource('Monitor', 'PowerStrip'), true)
assert.equal(canSelectPowerSource('Smartphone', 'PowerStrip'), true)
assert.equal(canSelectPowerSource('MobileBattery', 'PowerStrip'), true)
assert.equal(canSupplyPowerInput(usbStrip, 'from_c'), true)
assert.equal(canSupplyPowerInput(twoOutletStrip, 'from_c'), false)
assert.equal(canSupplyPowerInput(usbStrip, 'wireless'), false)

console.log('power strip audit: outlets / USB slots / UPS chain / source selection / grounded form passed')
