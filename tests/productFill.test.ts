import assert from 'node:assert/strict'
import test from 'node:test'
import { Gadget, Port } from '../src/types'
import { applyProductToGadget } from '../src/utils/productFill'
import { GADGET_NAME_MAX_LENGTH } from '../src/constants/textLimits'
import { ProductSuggestion } from '../src/utils/productSuggestions'

const placeholder = (category: Gadget['category'], ports: Port[]): Gadget => ({
  id: 'g1',
  name: category,
  category,
  ports,
  isPlaceholder: true,
  createdAt: '2026-09-13T00:00:00.000Z',
})

const suggestion = (ports: Port[]) => ({ name: 'Product', ports }) as unknown as ProductSuggestion

test('商品を割り当てても枠のアーム受け口は残る（後から足したアームの支持線が外れない）', () => {
  const monitor = placeholder('Monitor', [
    { id: 'p1', type: 'HDMI', direction: 'input', count: 2 },
    { id: 'p4', type: 'MonitorArm', direction: 'input', count: 1 },
    { id: 'p5', type: 'Power', direction: 'input', count: 1 },
  ])
  const filled = applyProductToGadget(monitor, {
    name: 'Product',
    suggestion: suggestion([
      { id: 'p1', type: 'DisplayPort', direction: 'input', count: 1 },
      { id: 'p4', type: 'USB_C', direction: 'input', count: 1 },
    ]),
  })
  const arm = filled.ports.filter((p) => p.type === 'MonitorArm')
  assert.equal(arm.length, 1)
  assert.equal(arm[0].direction, 'input')
  assert.equal(new Set(filled.ports.map((p) => p.id)).size, filled.ports.length)
})

test('マイクの受け口も引き継ぎ、商品が受け口を持つなら重ねない', () => {
  const mic = placeholder('Microphone', [
    { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'Host' },
    { id: 'p2', type: 'MicArm', direction: 'input', count: 1 },
  ])
  const carried = applyProductToGadget(mic, {
    name: 'Product',
    suggestion: suggestion([{ id: 'x1', type: 'USB_C', direction: 'input', count: 1, label: 'Host' }]),
  })
  assert.deepEqual(carried.ports.filter((p) => p.type === 'MicArm').map((p) => p.id), ['p2'])

  const own = applyProductToGadget(mic, {
    name: 'Product',
    suggestion: suggestion([{ id: 'x2', type: 'MicArm', direction: 'input', count: 1 }]),
  })
  assert.deepEqual(own.ports.filter((p) => p.type === 'MicArm').map((p) => p.id), ['x2'])
})

test('候補から選んだ長い商品名も、保存する名前は上限で切る（入力欄の上限は打った文字にしか効かない）', () => {
  const filled = applyProductToGadget(placeholder('Monitor', []), {
    name: 'あ'.repeat(GADGET_NAME_MAX_LENGTH + 50),
    suggestion: suggestion([]),
  })
  assert.equal([...filled.name].length, GADGET_NAME_MAX_LENGTH)
})

test('上限の位置に絵文字があっても割らない', () => {
  const name = 'あ'.repeat(GADGET_NAME_MAX_LENGTH - 1) + '😀' + 'いいい'
  const chars = [...applyProductToGadget(placeholder('Monitor', []), { name }).name]
  assert.equal(chars.length, GADGET_NAME_MAX_LENGTH)
  assert.equal(chars[chars.length - 1], '😀')
})

test('名前が見えない文字だけなら枠のまま返す（名前の無い実物のガジェットにしない）', () => {
  const slot = placeholder('Monitor', [])
  const result = applyProductToGadget(slot, { name: '​　' })
  assert.equal(result, slot)
  assert.equal(result.isPlaceholder, true)
})
