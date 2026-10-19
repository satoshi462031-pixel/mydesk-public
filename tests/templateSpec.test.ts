import assert from 'node:assert/strict'
import test from 'node:test'
import { Gadget, Port } from '../src/types'
import { applyTemplateSpec, planSpecArms, readGadgetTemplateSpec, readTemplateSpecCounts, withoutSpecCounts } from '../src/utils/templateSpec'

const gadget = (category: Gadget['category'], ports: Port[]): Gadget => ({
  id: 'g1',
  name: category,
  category,
  ports,
  createdAt: '2026-09-13T00:00:00.000Z',
})

const charger = () => gadget('Charger', [
  { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
  { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
  { id: 'p3', type: 'Power', direction: 'input', count: 1 },
])

test('初期値は枠のポートから読む（触らずに作成すれば従来の図と同じ）', () => {
  assert.deepEqual(readTemplateSpecCounts('Charger', charger().ports), { usbC: 2, usbA: 1, wireless: 0 })
  assert.deepEqual(
    readTemplateSpecCounts('PowerStrip', [
      { id: 'p1', type: 'Power', direction: 'input', count: 1 },
      { id: 'p2', type: 'Power', direction: 'output', count: 10 },
    ]),
    { outlets: 10 },
  )
})

test('初期値のまま当てるとポートは変わらない', () => {
  const before = charger()
  const after = applyTemplateSpec(before, readTemplateSpecCounts('Charger', before.ports))
  assert.deepEqual(after.ports, before.ports)
})

test('充電器の口数を変えると出力だけが増減し、電源入力は残る', () => {
  const after = applyTemplateSpec(charger(), { usbC: 4, usbA: 0, wireless: 1 })
  assert.deepEqual(after.ports.map((p) => [p.type, p.direction, p.count]), [
    ['USB_C', 'output', 4],
    ['Power', 'input', 1],
    ['wirelessCharging', 'output', 1],
  ])
})

test('モニターごとにHDMI・DisplayPort・USB-C映像入力数を変え、他の入力は残す', () => {
  const monitor = gadget('Monitor', [
    { id: 'hdmi', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
    { id: 'dp', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
    { id: 'usb-c', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
    { id: 'power', type: 'Power', direction: 'input', count: 1 },
  ])
  assert.deepEqual(readTemplateSpecCounts('Monitor', monitor.ports), {
    hdmiInput: 2,
    displayPortInput: 1,
    videoUsbCInput: 1,
  })
  const after = applyTemplateSpec(monitor, { hdmiInput: 1, displayPortInput: 2, videoUsbCInput: 2 })
  assert.deepEqual(after.ports.map((p) => [p.type, p.direction, p.count]), [
    ['HDMI', 'input', 1],
    ['DisplayPort', 'input', 2],
    ['USB_C', 'input', 2],
    ['Power', 'input', 1],
  ])
})

test('PCは映像出力を聞かず、USB-C は映像の有無で分けずに数える', () => {
  const pc = gadget('PC', [
    { id: 'hdmi', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true },
    { id: 'usb', type: 'USB_A', direction: 'output', count: 4 },
    { id: 'video-usb-c', type: 'USB_C', direction: 'output', count: 2, supportsVideo: true },
  ])
  assert.deepEqual(readTemplateSpecCounts('PC', pc.ports), { usbA: 4, usbC: 2 })
  const after = applyTemplateSpec(pc, { usbA: 3, usbC: 3 })
  assert.deepEqual(after.ports.map((p) => [p.type, p.direction, p.count, p.supportsVideo === true]), [
    ['HDMI', 'output', 1, true],
    ['USB_A', 'output', 3, false],
    ['USB_C', 'output', 3, true],
  ])
})

test('電源タップの入力（同じ Power 型）を口数として数えない', () => {
  const strip = gadget('PowerStrip', [
    { id: 'p1', type: 'Power', direction: 'input', count: 1 },
    { id: 'p2', type: 'Power', direction: 'output', count: 10 },
  ])
  const after = applyTemplateSpec(strip, { outlets: 3 })
  assert.deepEqual(after.ports.map((p) => [p.id, p.direction, p.count]), [['p1', 'input', 1], ['p2', 'output', 3]])
})

test('ステレオペアを外すと入力側も消す（追加・編集画面の保存形と同じ）', () => {
  const speaker = gadget('Speaker', [{ id: 'p1', type: 'Audio3_5mm', direction: 'input', count: 1 }])
  const paired = applyTemplateSpec(speaker, { stereoPair: true, speakerInputSide: 'L', hasSubwoofer: true })
  assert.equal(paired.stereoPair, true)
  assert.equal(paired.speakerInputSide, 'L')
  assert.equal(paired.hasSubwoofer, true)
  const mono = applyTemplateSpec(paired, { stereoPair: false, hasSubwoofer: false })
  assert.equal(mono.stereoPair, false)
  assert.equal(mono.speakerInputSide, undefined)
  assert.equal(mono.hasSubwoofer, undefined)
})

test('アームに載せるなら受け口の無いポートに足し、載せないと答えても既にある受け口は残す', () => {
  const fromProduct = gadget('Monitor', [{ id: 'p1', type: 'HDMI', direction: 'input', count: 1 }])
  const mounted = applyTemplateSpec(fromProduct, { onArm: true })
  assert.deepEqual(mounted.ports.filter((p) => p.type === 'MonitorArm').map((p) => p.direction), ['input'])
  assert.deepEqual(applyTemplateSpec(mounted, { onArm: true }).ports, mounted.ports)
  assert.deepEqual(applyTemplateSpec(mounted, { onArm: false }).ports, mounted.ports)
  assert.deepEqual(applyTemplateSpec(fromProduct, { onArm: false }).ports, fromProduct.ports)
})

test('アームの支える台数は増やす方向にだけ効く（選んだデュアルアームを1台に減らさない）', () => {
  const dual = gadget('MonitorArm', [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 2 }])
  assert.equal(applyTemplateSpec(dual, { armHolds: 1 }).ports[0].count, 2)
  assert.equal(applyTemplateSpec(dual, { armHolds: 3 }).ports[0].count, 3)
})

test('載せる台数ぶんを支えるアームを1本用意し、既にあればそれを広げる', () => {
  const monitors = [
    { key: 'm1', category: 'Monitor' as const },
    { key: 'm2', category: 'Monitor' as const },
    { key: 'mic', category: 'Microphone' as const },
  ]
  const specs = { m1: { onArm: true }, m2: { onArm: true }, mic: { onArm: false } }
  assert.deepEqual(planSpecArms(monitors, specs), [{ armCategory: 'MonitorArm', holds: 2 }])
  assert.deepEqual(
    planSpecArms([...monitors, { key: 'arm', category: 'MonitorArm' }], specs),
    [{ armCategory: 'MonitorArm', holds: 2, existingKey: 'arm' }],
  )
  assert.deepEqual(planSpecArms(monitors, { m1: { onArm: false } }), [])
})

test('口数を聞かない枠の答えからは口数だけを外す（商品の端子を枠の標準で書き換えない）', () => {
  const spec = { hdmiInput: 2, displayPortInput: 1, videoUsbCInput: 1, onArm: true }
  assert.deepEqual(withoutSpecCounts('Monitor', spec), { onArm: true })
  const product = gadget('Monitor', [
    { id: 'h', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
    { id: 'd', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
  ])
  const after = applyTemplateSpec(product, withoutSpecCounts('Monitor', spec))
  assert.deepEqual(after.ports.filter((p) => p.type !== 'MonitorArm'), product.ports)
})

test('対象外カテゴリの値は無視する', () => {
  const mouse = gadget('Mouse', [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }])
  const after = applyTemplateSpec(mouse, { usbA: 5, splitKeyboard: true, stereoPair: true })
  assert.deepEqual(after, mouse)
})

test('持ち物の枠は、アームの受け口と支える台数から数える', () => {
  const items = [
    { key: 'm1', category: 'Monitor' as const },
    { key: 'm2', category: 'Monitor' as const },
    { key: 'arm', category: 'MonitorArm' as const },
  ]
  const ownedMonitor = gadget('Monitor', [{ id: 'a', type: 'MonitorArm', direction: 'input', count: 1 }])
  const singleArm = gadget('MonitorArm', [{ id: 'o', type: 'MonitorArm', direction: 'output', count: 1 }])
  const dualArm = gadget('MonitorArm', [{ id: 'o', type: 'MonitorArm', direction: 'output', count: 2 }])

  // アームに載っている持ち物のモニター（m1）も台数に入る。持ち物のアームは広げず、足りない分を新しく用意する
  assert.deepEqual(
    planSpecArms(items, { m2: { onArm: true } }, { m1: ownedMonitor, arm: singleArm }),
    [{ armCategory: 'MonitorArm', holds: 1 }],
  )
  // 持ち物のデュアルアームで足りるなら何も足さない
  assert.deepEqual(planSpecArms(items, { m2: { onArm: true } }, { m1: ownedMonitor, arm: dualArm }), [])
  // 受け口の無い持ち物のモニターは載せない扱い
  assert.deepEqual(planSpecArms(items, {}, { m1: gadget('Monitor', []) }), [])
})

test('作成済みのガジェットから前の答えを読み戻す（機材の段へ戻ったときの初期値）', () => {
  const strip = applyTemplateSpec(gadget('PowerStrip', [
    { id: 'p1', type: 'Power', direction: 'input', count: 1 },
    { id: 'p2', type: 'Power', direction: 'output', count: 10 },
  ]), { outlets: 4 })
  assert.deepEqual(readGadgetTemplateSpec(strip), { outlets: 4 })
  const keyboard = applyTemplateSpec(gadget('Keyboard', []), { splitKeyboard: true })
  assert.deepEqual(readGadgetTemplateSpec(keyboard), { splitKeyboard: true })
  const speaker = applyTemplateSpec(gadget('Speaker', []), { stereoPair: true, speakerInputSide: 'L', hasSubwoofer: false })
  assert.deepEqual(readGadgetTemplateSpec(speaker), { stereoPair: true, speakerInputSide: 'L', hasSubwoofer: false })
  // 読み戻した値をそのまま当てても変わらない（答え直さずに作成して何も起きない）
  assert.deepEqual(applyTemplateSpec(strip, readGadgetTemplateSpec(strip)).ports, strip.ports)
})
