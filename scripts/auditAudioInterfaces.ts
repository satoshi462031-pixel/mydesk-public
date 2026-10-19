import assert from 'node:assert/strict'
import { AUDIO_INTERFACE_PRESETS } from '../src/constants/gadgetPresets'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { CATEGORY_PORT_CONFIG } from '../src/constants/portFormConfig'
import { DeskPlan, Gadget, Port, PortType } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

const port = (id: string, type: PortType, direction: Port['direction'], count = 1, label?: string): Port =>
  ({ id, type, direction, count, label })
const gadget = (id: string, category: Gadget['category'], ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category,
  ports,
  createdAt: '2026-08-15T00:00:00.000Z',
  ...extra,
})
const plan = (gadgets: Gadget[]): DeskPlan => ({
  id: 'audio-interface-audit',
  name: 'audio-interface-audit',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount: 8,
  outletCountVersion: 2,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
})

const requiredPorts: Record<string, Array<[PortType, Port['direction'], number]>> = {
  'Focusrite Scarlett Solo (4th Gen)': [['Audio6_3mm_TS', 'input', 1]],
  'Focusrite Scarlett 2i2 (4th Gen)': [['XLR_TRS_Combo', 'input', 2]],
  'Focusrite Scarlett 4i4 (4th Gen)': [['XLR_TRS_Combo', 'input', 2], ['Audio6_3mm', 'input', 2], ['MIDI', 'input', 1], ['MIDI', 'output', 1]],
  'MOTU M2': [['XLR_TRS_Combo', 'input', 2], ['RCA', 'output', 2], ['MIDI', 'input', 1], ['MIDI', 'output', 1]],
  'MOTU M4': [['XLR_TRS_Combo', 'input', 2], ['Audio6_3mm', 'input', 2], ['RCA', 'output', 4], ['MIDI', 'input', 1], ['MIDI', 'output', 1]],
  'Universal Audio Volt 1': [['XLR_TRS_Combo', 'input', 1], ['MIDI', 'input', 1], ['MIDI', 'output', 1]],
  'Universal Audio Volt 2': [['XLR_TRS_Combo', 'input', 2], ['MIDI', 'input', 1], ['MIDI', 'output', 1]],
  'Audient iD4 MkII': [['XLR_TRS_Combo', 'input', 1], ['Audio6_3mm_TS', 'input', 1], ['Audio3_5mm', 'output', 1]],
  'RME Babyface Pro FS': [['USB_B', 'input', 1], ['Audio6_3mm_TS', 'input', 2], ['XLR', 'output', 2], ['OpticalAudio', 'bidirectional', 1], ['MIDI', 'input', 1], ['MIDI', 'output', 1]],
}

for (const preset of AUDIO_INTERFACE_PRESETS) {
  for (const [type, direction, count] of requiredPorts[preset.name] ?? []) {
    assert.ok(preset.ports.some((item) => item.type === type && item.direction === direction && item.count === count),
      `${preset.name}: ${type} ${direction} x${count}`)
  }
}
assert.equal(AUDIO_INTERFACE_PRESETS.length, Object.keys(requiredPorts).length)

const pc1 = gadget('pc-1', 'PC', [port('usb', 'USB_C', 'output', 4)])
const pc2 = gadget('pc-2', 'PC', [port('usb', 'USB_C', 'output', 4)])
const audioInterface = gadget('interface', 'AudioInterface', [
  port('host', 'USB_C', 'input'),
  port('phones', 'Audio6_3mm', 'output', 1, '6.3mm ヘッドホン出力'),
  port('monitor', 'Audio6_3mm', 'output', 2, '6.3mm TRS モニター出力'),
], { bluetoothTargetGadgetIds: ['pc-2'] })
const headphoneAmp = gadget('headphone-amp', 'HeadphoneAmp', [
  port('host', 'USB_C', 'input'),
  port('phones', 'Audio6_3mm', 'output', 1, '6.3mm ヘッドホン出力'),
])
const speaker = gadget('speaker', 'Speaker', [port('line', 'Audio6_3mm', 'input'), port('power', 'Power', 'input')], { stereoPair: false })
const headphone = gadget('headphone', 'Headphone', [port('phones', 'Audio6_3mm', 'input')])
const gadgets = [pc1, pc2, audioInterface, headphoneAmp, speaker, headphone]
const result = generateWiring(gadgets, plan(gadgets))

const speakerConnection = result.connections.find((item) => item.toGadgetId === speaker.id && item.cableType !== 'Power')
assert.equal(speakerConnection?.fromGadgetId, audioInterface.id, 'スピーカーはオーディオインターフェースのモニター出力へ接続する')
assert.equal(speakerConnection?.sourcePortId, 'monitor', 'スピーカーにヘッドホン出力を割り当てない')
const headphoneConnection = result.connections.find((item) => item.toGadgetId === headphone.id)
assert.equal(headphoneConnection?.fromGadgetId, headphoneAmp.id, 'ヘッドホンはヘッドホンアンプを優先する')
assert.equal(headphoneConnection?.sourcePortId, 'phones', 'ヘッドホン出力を割り当てる')
assert.ok(result.connections.some((item) => item.fromGadgetId === pc2.id && item.toGadgetId === audioInterface.id),
  '指定したPCへオーディオインターフェースを接続する')

const fields = CATEGORY_PORT_CONFIG.AudioInterface ?? []
assert.ok(fields.some((field) => field.portType === 'USB_B' && field.direction === 'input'))
assert.ok(fields.some((field) => field.portType === 'OpticalAudio' && field.direction === 'input'))
assert.ok(fields.some((field) => field.portType === 'Audio3_5mm' && field.direction === 'output' && !field.hidden))

for (const { demo, plan: demoPlan, gadgets: demoGadgets } of buildAllDemoDesks()) {
  const activeStudioMonitors = demoGadgets.filter((item) =>
    !item.removedAt && item.category === 'Speaker' && /スタジオモニター/.test(item.name),
  )
  for (const monitor of activeStudioMonitors) {
    assert.ok(demoPlan.connectionMap?.connections.some((connection) =>
      connection.toGadgetId === monitor.id && connection.cableType !== 'Power'),
      `${demo.id}: ${monitor.name} に音声信号を接続する`)
    assert.ok(demoPlan.connectionMap?.connections.some((connection) =>
      connection.toGadgetId === monitor.id && connection.cableType === 'Power'),
      `${demo.id}: ${monitor.name} に給電する`)
  }
}

console.log(`audio interface audit: ${AUDIO_INTERFACE_PRESETS.length} presets / routing / form / demos passed`)
