import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DeskPlan, Gadget, Port } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'
import { normalizePorts } from '../src/utils/portTypeMigration'

const port = (id: string, type: Port['type'], direction: Port['direction'], extra: Partial<Port> = {}): Port =>
  ({ id, type, direction, count: 1, ...extra })

const gadget = (id: string, category: Gadget['category'], ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category,
  ports,
  createdAt: '2026-08-24T00:00:00.000Z',
  ...extra,
})

const wire = (gadgets: Gadget[]) => generateWiring(gadgets, {
  id: 'standards-test',
  name: 'standards-test',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map(({ id }) => id),
  placements: [],
  outletCount: 8,
  outletCountVersion: 2,
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
} satisfies DeskPlan, 'ja')

const has = (result: ReturnType<typeof wire>, from: string, to: string, cableType: string) =>
  result.connections.some((connection) =>
    connection.fromGadgetId === from && connection.toGadgetId === to && connection.cableType === cableType,
  )

describe('connection standards', () => {
  it('connects an HDMI camera to a capture device', () => {
    const result = wire([
      gadget('camera', 'Camera', [port('hdmi-out', 'HDMI', 'output', { supportsVideo: true })]),
      gadget('capture', 'CaptureDevice', [port('hdmi-in', 'HDMI', 'input', { supportsVideo: true })]),
    ])
    assert.equal(has(result, 'camera', 'capture', 'HDMI'), true)
  })

  it('warns when a desktop PC has no display path', () => {
    const result = wire([gadget('desktop', 'PC', [port('usb', 'USB_A', 'output')], { pcFormFactor: 'desktop' })])
    assert.equal(result.warnings.some((warning) => warning.includes('画面への接続がありません')), true)
  })

  it('does not treat an unspecified USB-C port as a video output', () => {
    const result = wire([
      gadget('pc', 'PC', [port('usb-c', 'USB_C', 'output')]),
      gadget('monitor', 'Monitor', [port('usb-c', 'USB_C', 'input', { supportsVideo: true })]),
    ])
    assert.equal(has(result, 'pc', 'monitor', 'USB_C'), false)
    assert.equal(result.warnings.some((warning) => warning.includes('映像対応が未確認')), true)
  })

  it('requires an explicit capability for DP to HDMI conversion', () => {
    const monitor = gadget('monitor', 'Monitor', [port('hdmi', 'HDMI', 'input', { supportsVideo: true })])
    const unknown = gadget('unknown', 'PC', [port('dp', 'DisplayPort', 'output', { supportsVideo: true })])
    const verified = gadget('verified', 'PC', [port('dp', 'DisplayPort', 'output', {
      supportsVideo: true,
      supportsDisplayConversion: true,
    })])
    const blocked = wire([unknown, monitor])
    assert.equal(has(blocked, 'unknown', 'monitor', 'DisplayPort_to_HDMI'), false)
    assert.equal(blocked.warnings.some((warning) => warning.includes('アクティブ映像変換')), true)
    assert.equal(has(wire([verified, monitor]), 'verified', 'monitor', 'DisplayPort_to_HDMI'), true)
  })

  it('uses HDMI first for laptops and mini PCs, and DisplayPort first for desktops', () => {
    const computer = (id: string, pcFormFactor: NonNullable<Gadget['pcFormFactor']>) => gadget(id, 'PC', [
      port(`${id}-hdmi`, 'HDMI', 'output', { supportsVideo: true }),
      port(`${id}-dp`, 'DisplayPort', 'output', { supportsVideo: true }),
    ], { pcFormFactor })
    const monitor = () => gadget('monitor', 'Monitor', [
      port('monitor-hdmi', 'HDMI', 'input', { supportsVideo: true }),
      port('monitor-dp', 'DisplayPort', 'input', { supportsVideo: true }),
    ])

    assert.equal(has(wire([computer('laptop', 'laptop'), monitor()]), 'laptop', 'monitor', 'HDMI'), true)
    assert.equal(has(wire([computer('mini', 'mini'), monitor()]), 'mini', 'monitor', 'HDMI'), true)
    assert.equal(has(wire([computer('desktop', 'desktop'), monitor()]), 'desktop', 'monitor', 'DisplayPort'), true)
  })

  it('models PoE as an Ethernet port capability and one Ethernet cable', () => {
    const result = wire([
      gadget('switch', 'Router', [
        port('poe-out', 'Ethernet', 'output', { supportsPoE: true }),
        port('power', 'Power', 'input'),
      ]),
      gadget('camera', 'Webcam', [
        port('poe-in', 'Ethernet', 'input', { supportsPoE: true }),
        port('power', 'Power', 'input'),
      ]),
    ])
    assert.equal(has(result, 'switch', 'camera', 'Ethernet'), true)
    assert.equal(result.connections.some((connection) =>
      connection.toGadgetId === 'camera' && connection.cableType === 'Power'), false)
  })

  it('does not connect an unverified DC input', () => {
    const result = wire([gadget('router', 'Router', [port('dc', 'DCPower', 'input')])])
    assert.equal(has(result, 'wall', 'router', 'DCPower'), false)
    assert.equal(result.warnings.some((warning) => warning.includes('DC電源仕様が未確認')), true)
  })

  it('normalizes the legacy EthernetPoE type to an Ethernet capability', () => {
    const normalized = normalizePorts([port('poe', 'EthernetPoE', 'output')])
    assert.equal(normalized[0].type, 'Ethernet')
    assert.equal(normalized[0].supportsPoE, true)
  })
})
