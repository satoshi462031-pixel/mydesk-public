import assert from 'node:assert/strict'
import { MOBILE_BATTERY_PRESETS } from '../src/constants/gadgetPresets'
import { CATEGORY_PORT_CONFIG, initPortState } from '../src/constants/portFormConfig'
import { DeskPlan, Gadget, Port, PortType } from '../src/types'
import {
  buildGadgetPorts,
  canSelectPowerSource,
  defaultPowerInputForCategory,
} from '../src/utils/gadgetPorts'
import { generateWiring } from '../src/utils/wiringEngine'

const port = (id: string, type: PortType, direction: Port['direction'], count = 1, label?: string): Port =>
  ({ id, type, direction, count, label })
const gadget = (id: string, category: Gadget['category'], ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category,
  ports,
  createdAt: `2026-08-15T00:00:0${id.length % 10}.000Z`,
  ...extra,
})
const plan = (gadgets: Gadget[], outletCount: number): DeskPlan => ({
  id: 'mobile-battery-audit',
  name: 'mobile-battery-audit',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount,
  outletCountVersion: 2,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
})
const wire = (gadgets: Gadget[], outletCount: number) => generateWiring(gadgets, plan(gadgets, outletCount))

const onePortBattery = gadget('battery', 'MobileBattery', [
  port('battery-c', 'USB_C', 'bidirectional'),
], { powerUsage: 'rechargeable' })
const laptop = gadget('laptop', 'PC', [
  port('laptop-c', 'USB_C', 'input'),
], { pcFormFactor: 'laptop', powerUsage: 'continuous' })
const noOutlet = wire([onePortBattery, laptop], 0)
assert.ok(noOutlet.connections.some((item) => item.fromGadgetId === onePortBattery.id && item.toGadgetId === laptop.id))
assert.ok(!noOutlet.connections.some((item) => item.fromGadgetId === 'failed-power' && item.toGadgetId === laptop.id))

const charger = gadget('charger', 'Charger', [
  port('charger-power', 'Power', 'input'),
  port('charger-c', 'USB_C', 'output', 2),
], { powerUsage: 'continuous' })
const phone = gadget('phone', 'Smartphone', [
  port('phone-c', 'USB_C', 'input'),
], { powerUsage: 'rechargeable', powerSourceGadgetId: 'battery' })

const nonPassThrough = wire([charger, onePortBattery, phone], 2)
assert.ok(nonPassThrough.connections.some((item) => item.toGadgetId === onePortBattery.id))
assert.ok(!nonPassThrough.connections.some((item) => item.fromGadgetId === onePortBattery.id && item.toGadgetId === phone.id))

const passThroughBattery = gadget('battery', 'MobileBattery', [
  port('battery-io', 'USB_C', 'bidirectional'),
  port('battery-out', 'USB_C', 'output'),
], { powerUsage: 'rechargeable', supportsPassThroughCharging: true })
const passThrough = wire([charger, passThroughBattery, phone], 2)
const phoneConnection = passThrough.connections.find((item) => item.fromGadgetId === passThroughBattery.id && item.toGadgetId === phone.id)
assert.ok(phoneConnection, 'パススルー対応機は充電中も給電できる')
assert.equal(phoneConnection.sourcePortId, 'battery-out#0', '本体充電中の入出力兼用ポートを出力にも使わない')

const acPassThroughBattery = gadget('battery', 'MobileBattery', [
  port('battery-power', 'Power', 'input'),
  port('battery-c', 'USB_C', 'output'),
], { powerUsage: 'rechargeable', supportsPassThroughCharging: true })
const acPassThrough = wire([acPassThroughBattery, phone], 2)
assert.ok(acPassThrough.connections.some((item) => item.fromGadgetId === 'wall' && item.toGadgetId === acPassThroughBattery.id))
assert.ok(acPassThrough.connections.some((item) => item.fromGadgetId === acPassThroughBattery.id && item.toGadgetId === phone.id))

const prime = MOBILE_BATTERY_PRESETS.find((item) => item.name.includes('Prime Power Bank 20000'))
const anker733 = MOBILE_BATTERY_PRESETS.find((item) => item.name.includes('Anker 733'))
const apple = MOBILE_BATTERY_PRESETS.find((item) => item.name.includes('Apple MagSafe'))
assert.equal(MOBILE_BATTERY_PRESETS.length, 16)
assert.ok(prime?.ports.some((item) => item.type === 'USB_C' && item.direction === 'bidirectional' && item.count === 2))
assert.equal(anker733?.supportsPassThroughCharging, true)
assert.ok(anker733?.ports.some((item) => item.type === 'Power' && item.direction === 'input'))
assert.ok(apple?.ports.some((item) => item.type === 'Lightning' && item.direction === 'input'))
assert.ok(apple?.ports.some((item) => item.type === 'wirelessCharging' && item.direction === 'output'))
assert.ok(!apple?.ports.some((item) => item.type === 'USB_C' && item.direction !== 'input'))

const fields = CATEGORY_PORT_CONFIG.MobileBattery ?? []
assert.ok(fields.some((item) => item.portType === 'USB_C' && item.direction === 'bidirectional'))
assert.ok(fields.some((item) => item.portType === 'Lightning' && item.direction === 'input'))
assert.ok(fields.some((item) => item.portType === 'microUSB' && item.direction === 'input'))
assert.ok(fields.some((item) => item.portType === 'Power' && item.direction === 'input'))
assert.equal(defaultPowerInputForCategory('MobileBattery'), 'none')

assert.ok(prime)
const rebuiltPrimePorts = buildGadgetPorts({
  category: 'MobileBattery',
  portState: initPortState(prime.ports, fields),
  mouseConnType: 'wireless',
  periConnType: 'wireless',
  powerInput: 'from_c',
  charge: { usbC: 0, usbA: 0, wirelessCount: 0 },
  strip: { outlets: 0, usbC: 0, usbA: 0, grounded: false },
})
assert.deepEqual(
  rebuiltPrimePorts.map(({ type, direction, count }) => ({ type, direction, count })),
  prime.ports.map(({ type, direction, count }) => ({ type, direction, count })),
  'プリセット選択後に入力ポートを重複追加しない',
)

assert.equal(canSelectPowerSource('MobileBattery', 'MobileBattery'), false)
assert.equal(canSelectPowerSource('Smartphone', 'MobileBattery'), true)
assert.equal(canSelectPowerSource('MobileBattery', 'Charger'), true)

console.log('mobile battery audit: ports / pass-through / source selection / no-outlet routing passed')
