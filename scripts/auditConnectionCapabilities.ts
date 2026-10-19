import assert from 'node:assert/strict'
import { CATEGORY_PORT_CONFIG, buildPortsFromState } from '../src/constants/portFormConfig'
import { buildGadgetPorts } from '../src/utils/gadgetPorts'
import { generateWiring } from '../src/utils/wiringEngine'
import { DeskPlan, Gadget, Port } from '../src/types'

const port = (id: string, type: Port['type'], direction: Port['direction'], extra: Partial<Port> = {}): Port =>
  ({ id, type, direction, count: 1, ...extra })

const gadget = (id: string, category: Gadget['category'], ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category,
  ports,
  createdAt: '2026-08-13T00:00:00.000Z',
  ...extra,
})

const plan = (gadgets: Gadget[]): DeskPlan => ({
  id: 'capability-audit',
  name: 'capability-audit',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount: 8,
  outletCountVersion: 2,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
})

const wire = (gadgets: Gadget[]) => generateWiring(gadgets, plan(gadgets), 'ja')
const has = (result: ReturnType<typeof wire>, from: string, to: string, cableType: string) =>
  result.connections.some((connection) =>
    connection.fromGadgetId === from && connection.toGadgetId === to && connection.cableType === cableType,
  )

{
  const items = [
    gadget('instrument', 'Instrument', [port('ts-out', 'Audio6_3mm_TS', 'output')]),
    gadget('interface', 'AudioInterface', [port('combo-in', 'XLR_TRS_Combo', 'input')]),
  ]
  const result = wire(items)
  assert.ok(has(result, 'instrument', 'interface', 'Audio6_3mm_TS'), 'TS → XLR/TRSコンボ入力')
}

{
  const items = [
    gadget('interface', 'AudioInterface', [port('rca-out', 'RCA', 'output')]),
    gadget('speaker', 'Speaker', [port('rca-in', 'RCA', 'input')]),
  ]
  const result = wire(items)
  assert.ok(has(result, 'interface', 'speaker', 'RCA'), 'RCAライン接続')
}

{
  const items = [
    gadget('pc', 'PC', [
      port('video', 'USB_C', 'output', { supportsVideo: true }),
      port('charge', 'USB_C', 'input', { label: '給電 (C)' }),
    ], { pcFormFactor: 'laptop' }),
    gadget('monitor', 'Monitor', [
      port('host', 'USB_C', 'input', { supportsVideo: true, supportsPowerDelivery: true }),
      port('ac', 'Power', 'input'),
    ]),
  ]
  const result = wire(items)
  assert.ok(has(result, 'pc', 'monitor', 'USB_C'), 'USB-C映像接続')
  assert.equal(result.connections.filter((connection) =>
    connection.fromGadgetId === 'monitor' && connection.toGadgetId === 'pc' && connection.cableType === 'USB_C',
  ).length, 0, 'USB-C映像ケーブルとPD給電を二重計上しない')
}

{
  const items = [
    gadget('pc', 'PC', [port('usb-c', 'USB_C', 'output')]),
    gadget('monitor', 'Monitor', [port('usb-c', 'USB_C', 'input', { supportsVideo: true })]),
  ]
  const result = wire(items)
  assert.equal(has(result, 'pc', 'monitor', 'USB_C'), false, '映像能力未確認のUSB-Cは映像接続しない')
}

{
  const items = [
    gadget('pc', 'PC', [port('dp', 'DisplayPort', 'output', { supportsVideo: true })]),
    gadget('monitor', 'Monitor', [port('hdmi', 'HDMI', 'input', { supportsVideo: true })]),
  ]
  assert.equal(has(wire(items), 'pc', 'monitor', 'DisplayPort_to_HDMI'), false, '未確認のDP→HDMI変換は自動提案しない')
  items[0].ports[0].supportsDisplayConversion = true
  assert.ok(has(wire(items), 'pc', 'monitor', 'DisplayPort_to_HDMI'), '確認済みDP→HDMI変換は提案する')
}

{
  const items = [
    gadget('pc', 'PC', [port('dp-out', 'DisplayPort', 'output', { supportsVideo: true })]),
    gadget('monitor-1', 'Monitor', [
      port('dp-in', 'DisplayPort', 'input', { supportsVideo: true }),
      port('dp-out', 'DisplayPort', 'output', { supportsVideo: true }),
    ]),
    gadget('monitor-2', 'Monitor', [port('dp-in', 'DisplayPort', 'input', { supportsVideo: true })]),
  ]
  const result = wire(items)
  assert.ok(has(result, 'pc', 'monitor-1', 'DisplayPort'), 'DPチェーン上流')
  assert.ok(has(result, 'monitor-1', 'monitor-2', 'DisplayPort'), 'DP MSTデイジーチェーン')
}

{
  const items = [
    gadget('pc', 'PC', [port('tb-out', 'Thunderbolt', 'output', { supportsVideo: true })]),
    gadget('monitor-1', 'Monitor', [
      port('tb-in', 'Thunderbolt', 'input', { supportsVideo: true }),
      port('tb-out', 'Thunderbolt', 'output', { supportsVideo: true }),
    ]),
    gadget('monitor-2', 'Monitor', [port('tb-in', 'Thunderbolt', 'input', { supportsVideo: true })]),
  ]
  const result = wire(items)
  assert.ok(has(result, 'pc', 'monitor-1', 'Thunderbolt'), 'Thunderboltチェーン上流')
  assert.ok(has(result, 'monitor-1', 'monitor-2', 'Thunderbolt'), 'Thunderboltデイジーチェーン')
}

{
  const items = [
    gadget('router', 'Router', [port('poe-out', 'Ethernet', 'output', { supportsPoE: true }), port('ac', 'Power', 'input')]),
    gadget('camera', 'Webcam', [port('poe-in', 'Ethernet', 'input', { supportsPoE: true }), port('ac', 'Power', 'input')]),
  ]
  const result = wire(items)
  assert.ok(has(result, 'router', 'camera', 'Ethernet'), 'PoE Ethernet接続')
  assert.equal(result.connections.some((connection) => connection.toGadgetId === 'camera' && connection.cableType === 'Power'), false, 'PoE受電時はAC線を追加しない')
}

{
  const items = [
    gadget('router', 'Router', [port('lan-out', 'Ethernet', 'output'), port('ac', 'Power', 'input')]),
    gadget('injector', 'Other', [
      port('lan-in', 'Ethernet', 'input'),
      port('poe-out', 'EthernetPoE', 'output'),
      port('dc-in', 'DCPower', 'input'),
    ]),
    gadget('camera', 'Webcam', [port('poe-in', 'EthernetPoE', 'input', { supportsPowerDelivery: true })]),
  ]
  const result = wire(items)
  assert.ok(has(result, 'router', 'injector', 'Ethernet'), 'PoEインジェクターのアップリンク')
  assert.ok(has(result, 'injector', 'camera', 'Ethernet'), 'PoEインジェクターからの給電・通信')
}

{
  const items = [gadget('router', 'Router', [port('dc-in', 'DCPower', 'input', { powerAdapterIncluded: true })])]
  const result = wire(items)
  assert.ok(has(result, 'wall', 'router', 'DCPower'), 'ACアダプター/DCプラグ給電')
}

{
  const items = [gadget('router', 'Router', [port('dc-in', 'DCPower', 'input')])]
  const result = wire(items)
  assert.equal(has(result, 'wall', 'router', 'DCPower'), false, '仕様不明のDC電源は自動接続しない')
  assert.ok(result.warnings.some((warning) => warning.includes('DC電源仕様が未確認')), 'DC仕様確認の警告')
}

{
  const monitorPorts = buildPortsFromState({ usbc_in: 1 }, CATEGORY_PORT_CONFIG.Monitor ?? [])
  assert.equal(monitorPorts.find((item) => item.type === 'USB_C')?.supportsPowerDelivery, undefined, '通常USB-CへPD能力を付けない')
  const monitorPdPorts = buildPortsFromState({ usbc_pd_in: 1 }, CATEGORY_PORT_CONFIG.Monitor ?? [])
  assert.equal(monitorPdPorts.find((item) => item.type === 'USB_C')?.supportsPowerDelivery, true, '確認済みUSB-C PD入力UI')
  const dcPorts = buildGadgetPorts({
    category: 'Router',
    portState: {},
    mouseConnType: 'wireless',
    periConnType: 'wireless',
    powerInput: 'dc',
    charge: { usbC: 0, usbA: 0, wirelessCount: 0 },
    strip: { outlets: 0, usbC: 0, usbA: 0, grounded: false },
  })
  assert.ok(dcPorts.some((item) => item.type === 'DCPower'), 'DCアダプター入力UI')
  assert.equal(dcPorts.find((item) => item.type === 'DCPower')?.powerAdapterIncluded, true, 'UIで指定したDCアダプターは確認済み')
}

console.log('connection capability audit: 13/13 passed')
