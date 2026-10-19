import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { computeMapLayout } from '../src/utils/connectionMapLayout'
import { generateWiring } from '../src/utils/wiringEngine'

// 実在の製品のつなぎ方と突き合わせて見つかった、物理的に成立しない配線の再発防止
let seq = 0
const createdAt = '2026-09-21T00:00:00.000Z'
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `realism-port-${++seq}`,
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
const wire = (gadgets: Gadget[]) => generateWiring(gadgets, {
  id: 'realism-plan',
  name: 'realism test',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map(({ id }) => id),
  placements: [],
  outletCount: 8,
  outletCountVersion: 2,
  createdAt,
  updatedAt: createdAt,
}, 'ja')
const linked = (result: ReturnType<typeof wire>, from: string, to: string) =>
  result.connections.some((c) => c.fromGadgetId === from && c.toGadgetId === to)

const desktop = () => g('desktop', 'PC', [
  p('DisplayPort', 'output', 2, { supportsVideo: true }),
  p('USB_C', 'output', 2),
  p('USB_A', 'output', 4),
  p('Ethernet', 'input'),
  p('Power', 'input'),
], { pcFormFactor: 'desktop' })
const monitor = () => g('monitor', 'Monitor', [
  p('DisplayPort', 'input', 1, { supportsVideo: true }),
  p('HDMI', 'input', 1, { supportsVideo: true }),
  p('Power', 'input'),
])
const router = () => g('router', 'Router', [p('Ethernet', 'input', 1), p('Ethernet', 'output', 4), p('Power', 'input')])
const tbDock = () => g('dock', 'Dock', [
  p('Thunderbolt', 'input', 1, { supportsVideo: true }),
  p('DisplayPort', 'output', 1, { supportsVideo: true }),
  p('USB_A', 'output', 4),
  p('Ethernet', 'input'),
  p('Power', 'input'),
])

describe('wiring realism', () => {
  it('does not drive a monitor from a dock hanging off a desktop USB-C port without video', () => {
    const result = wire([desktop(), monitor(), tbDock()])
    assert.equal(linked(result, 'dock', 'monitor'), false)
    assert.equal(linked(result, 'desktop', 'monitor'), true)
  })

  it('hooks a video dock to the laptop rather than a desktop that cannot feed it', () => {
    const laptop = g('laptop', 'PC', [p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true })], { pcFormFactor: 'laptop' })
    const result = wire([desktop(), laptop, tbDock(), monitor()])
    assert.equal(linked(result, 'laptop', 'dock'), true)
    assert.equal(linked(result, 'desktop', 'dock'), false)
  })

  it('runs LAN to the desktop only, not also to its dock', () => {
    const result = wire([desktop(), monitor(), tbDock(), router()])
    assert.equal(linked(result, 'router', 'desktop'), true)
    assert.equal(linked(result, 'router', 'dock'), false)
  })

  it('still runs LAN to a Switch dock next to a desktop', () => {
    const switchDock = g('Nintendo Switch 2 Dock', 'Dock', [
      p('USB_C', 'input', 1), p('HDMI', 'output', 1, { supportsVideo: true }), p('USB_A', 'output', 2),
      p('Ethernet', 'input'), p('Power', 'input'),
    ])
    const console = g('Nintendo Switch 2', 'GameConsole', [p('USB_C', 'bidirectional', 1)], { consoleFormFactor: 'handheld' })
    const result = wire([desktop(), monitor(), router(), switchDock, console])
    assert.equal(linked(result, 'router', 'Nintendo Switch 2 Dock'), true)
  })

  it('does not charge a handheld through the one USB-C port already sending video', () => {
    const deck = g('deck', 'GameConsole', [p('USB_C', 'bidirectional', 1, { supportsVideo: true })], {
      consoleFormFactor: 'handheld',
      powerUsage: 'rechargeable',
    })
    const charger = g('charger', 'Charger', [p('USB_C', 'output', 2), p('Power', 'input')])
    const result = wire([monitor(), deck, charger])
    const intoDeckPort = result.connections.filter((c) => c.toGadgetId === 'deck' && c.toPortType === 'USB_C')
    const outOfDeckPort = result.connections.filter((c) => c.fromGadgetId === 'deck' && c.fromPortType === 'USB_C')
    assert.equal(outOfDeckPort.length, 1)
    assert.equal(intoDeckPort.length, 0)
  })

  it('keeps a laptop port for the USB-C monitor instead of letting bus-powered hubs take both', () => {
    const laptop = g('laptop', 'PC', [
      p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true, supportsPowerDelivery: true }),
    ], { pcFormFactor: 'laptop' })
    const usbCMonitor = g('usbc-monitor', 'Monitor', [
      p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
      p('HDMI', 'input', 1, { supportsVideo: true }),
      p('USB_A', 'output', 2),
      p('Power', 'input'),
    ])
    const hubA = g('hub-a', 'Hub', [p('USB_C', 'input', 1), p('USB_A', 'output', 3), p('HDMI', 'output', 1, { supportsVideo: true })])
    const hubB = g('hub-b', 'Hub', [p('USB_A', 'input', 1), p('USB_A', 'output', 4)])
    const result = wire([laptop, usbCMonitor, hubA, hubB])
    assert.equal(linked(result, 'laptop', 'usbc-monitor'), true)
    assert.equal(linked(result, 'hub-a', 'usbc-monitor'), false)
  })

  it('plays a Bluetooth-input amplifier from the PC over Bluetooth', () => {
    const pc = g('pc', 'PC', [p('Bluetooth', 'bidirectional'), p('Power', 'input')], { pcFormFactor: 'desktop' })
    const amp = g('amp', 'Amplifier', [p('SpeakerTerminal', 'output', 2), p('Bluetooth', 'input'), p('Power', 'input')])
    const result = wire([pc, amp, g('speaker', 'Speaker', [p('SpeakerTerminal', 'input')])])
    assert.equal(result.connections.some((c) => c.fromGadgetId === 'pc' && c.toGadgetId === 'amp' && c.cableType === 'Bluetooth'), true)
  })

  it('plugs a 3.5mm mic into the PC mic jack, but not the headphone jack of a USB mic', () => {
    const pc = () => g('pc', 'PC', [p('USB_A', 'output', 2), p('Audio3_5mm', 'input', 1, { label: 'マイク入力' }), p('Power', 'input')], { pcFormFactor: 'desktop' })
    const clipMic = g('clip-mic', 'Microphone', [p('Audio3_5mm', 'output')])
    assert.equal(linked(wire([pc(), clipMic]), 'clip-mic', 'pc'), true)
    const usbMic = g('usb-mic', 'Microphone', [p('USB_A', 'input'), p('Audio3_5mm', 'output')])
    const result = wire([pc(), usbMic])
    assert.equal(result.connections.some((c) => c.fromGadgetId === 'usb-mic' && c.fromPortType === 'Audio3_5mm'), false)
    assert.equal(linked(result, 'pc', 'usb-mic'), true)
  })

  describe('tablet pens', () => {
    const pc = () => g('pc', 'PC', [p('USB_C', 'output', 2), p('Bluetooth', 'bidirectional'), p('Power', 'input')], { pcFormFactor: 'desktop' })
    const strip = () => g('strip', 'PowerStrip', [p('Power', 'input'), p('Power', 'output', 6)])
    const qi = () => g('qi', 'Charger', [p('wirelessCharging', 'output', 3, { label: 'ワイヤレス出力' }), p('Power', 'input')])
    const usbCharger = () => g('usb-charger', 'Charger', [p('USB_C', 'output', 2), p('Power', 'input')])
    const pencilPro = () => g('pencil', 'Accessory', [p('wirelessCharging', 'input'), p('Bluetooth', 'output')], { name: 'Apple Pencil Pro', powerUsage: 'rechargeable' })
    const ipad = (penPower: boolean) => g('ipad', 'Tablet', [
      p('USB_C', 'input'), p('Bluetooth', 'output'), ...(penPower ? [p('wirelessCharging', 'output')] : []),
    ], { powerUsage: 'rechargeable' })

    // ペンは線で結ばず、使うタブレットとの「Stylus」の関係1本だけにする（配線図ではタブレットのカードに畳む）
    const penLinks = (result: ReturnType<typeof wire>) =>
      result.connections.filter((c) => c.fromGadgetId === 'pencil' || c.toGadgetId === 'pencil')

    it('attaches a magnetic pen to the tablet instead of wiring it', () => {
      const result = wire([pc(), strip(), qi(), ipad(true), pencilPro()])
      const links = penLinks(result)
      assert.equal(links.length, 1)
      assert.equal(links[0].fromGadgetId, 'ipad')
      assert.equal(links[0].cableType, 'Stylus')
    })

    it('attaches the pen even when the tablet cannot charge it, with no Qi pad or warning', () => {
      const result = wire([pc(), strip(), qi(), ipad(false), pencilPro()])
      assert.deepEqual(penLinks(result).map((c) => [c.fromGadgetId, c.cableType]), [['ipad', 'Stylus']])
      assert.equal(result.warnings.some((w) => w.includes('Apple Pencil Pro')), false)
    })

    it('uses the tablet chosen as the pen target', () => {
      const other = g('ipad-2', 'Tablet', [p('USB_C', 'input'), p('wirelessCharging', 'output')], { powerUsage: 'rechargeable' })
      const pen = { ...pencilPro(), bluetoothTargetGadgetIds: ['ipad'] }
      const result = wire([pc(), strip(), other, ipad(false), pen])
      assert.deepEqual(penLinks(result).map((c) => c.fromGadgetId), ['ipad'])
    })

    it('does not wire a pen anywhere when there is no tablet, and says so', () => {
      const result = wire([pc(), strip(), qi(), pencilPro()])
      assert.equal(penLinks(result).length, 0)
      assert.equal(result.warnings.some((w) => w.includes('使うタブレット')), true)
    })

    it('does not run a charging or data cable to a USB-C pen', () => {
      const pencilUsbC = g('pencil', 'Accessory', [p('USB_C', 'input', 1, { label: '充電・データ' }), p('Bluetooth', 'output')], { name: 'Apple Pencil (USB-C)', powerUsage: 'rechargeable' })
      const result = wire([pc(), strip(), usbCharger(), ipad(false), pencilUsbC])
      assert.deepEqual(penLinks(result).map((c) => [c.fromGadgetId, c.cableType]), [['ipad', 'Stylus']])
    })

    it('folds the pen into the tablet card on the map', async () => {
      const gadgets = [pc(), strip(), ipad(false), pencilPro()]
      const result = wire(gadgets)
      const layout = await computeMapLayout(gadgets, result.connections.map((c) => ({ ...c, origin: 'auto' as const, confirmed: true })), [], {}, {}, false)
      assert.equal(layout.nodes.some((n) => n.id === 'pencil'), false)
      assert.deepEqual(layout.nodes.find((n) => n.id === 'ipad')?.attached?.map((a) => a.id), ['pencil'])
      assert.equal(layout.edges.some((e) => e.conn.fromGadgetId === 'pencil' || e.conn.toGadgetId === 'pencil'), false)
    })
  })

  it('treats a 6.3mm input as enough to play an XLR studio monitor from the PC', () => {
    const pc = g('pc', 'PC', [p('Audio3_5mm', 'output', 1), p('Power', 'input')], { pcFormFactor: 'desktop' })
    const speaker = g('HS5', 'Speaker', [p('XLR', 'input'), p('Audio6_3mm', 'input'), p('Power', 'input')])
    const result = wire([pc, speaker])
    assert.equal(linked(result, 'pc', 'HS5'), true)
    assert.equal(result.warnings.some((w) => w.includes('XLR')), false)
  })
})
