import assert from 'node:assert/strict'
import test from 'node:test'
import { Gadget } from '../src/types'
import { gadgetFromProduct } from '../src/utils/gadgetFromProduct'
import { ProductSuggestion } from '../src/utils/productSuggestions'
import { GADGET_NAME_MAX_LENGTH } from '../src/constants/textLimits'

const base = { id: 'g1', now: '2026-09-26T00:00:00.000Z' }

test('ユーザーが指定した導入日を保存し、登録日時では上書きしない', () => {
  const gadget = gadgetFromProduct({ ...base, name: 'Monitor', category: 'Monitor', purchasedAt: '2026-10-03' })
  assert.equal(gadget.purchasedAt, '2026-10-03')
  assert.equal(gadget.introducedAtUnknown, undefined)
  assert.equal(gadget.createdAt, base.now)
})

test('名前だけで登録した機材は、端子がカテゴリ既定の推定値だと印を付ける', () => {
  const gadget = gadgetFromProduct({ ...base, name: 'よく分からないモニター', category: 'Monitor' })
  assert.equal(gadget.productId, undefined)
  assert.equal(gadget.purchasedAt, undefined)
  assert.equal(gadget.introducedAtUnknown, true)
  assert.equal(gadget.portsNeedConfirmation, true)
  assert.ok(gadget.ports.length > 0)
})

test('商品の端子をそのまま使い、推定の印は付けない', () => {
  const suggestion: ProductSuggestion = {
    name: 'Monitor X',
    productId: 'p1',
    priceJpy: 30000,
    ports: [
      { id: 'h', type: 'HDMI', direction: 'input', count: 2 },
      { id: 'pw', type: 'Power', direction: 'input', count: 1 },
    ],
  }
  const gadget = gadgetFromProduct({ ...base, name: suggestion.name, category: 'Monitor', suggestion })
  assert.equal(gadget.productId, 'p1')
  assert.equal(gadget.price, 30000)
  assert.equal(gadget.portsNeedConfirmation, undefined)
  assert.ok(gadget.ports.some((p) => p.type === 'HDMI' && p.direction === 'input' && p.count === 2))
})

test('レシーバーを持つマウスは、レシーバーを直挿しの口として残す', () => {
  const suggestion: ProductSuggestion = {
    name: 'Mouse X',
    ports: [{ id: 'r', type: 'USB_A', direction: 'input', count: 1, label: 'Logi Bolt レシーバー' }],
  }
  const gadget = gadgetFromProduct({ ...base, name: suggestion.name, category: 'Mouse', suggestion })
  const receiver = gadget.ports.find((p) => p.type === 'USB_A' && p.direction === 'input')
  assert.ok(receiver)
  assert.equal(receiver.directAttach, true)
})

test('コントローラーは、デスクにあるゲーム機を無線の相手に選んでおく', () => {
  const console: Gadget = { id: 'c1', name: 'Switch', category: 'GameConsole', ports: [], createdAt: base.now }
  const gadget = gadgetFromProduct({ ...base, name: 'Pro Controller', category: 'Controller', deskGadgets: [console] })
  assert.deepEqual(gadget.bluetoothTargetGadgetIds, ['c1'])
})

test('長い商品名は上限で切る（商品DBの名前は長いまま入っている）', () => {
  const gadget = gadgetFromProduct({ ...base, name: 'あ'.repeat(GADGET_NAME_MAX_LENGTH + 20), category: 'Mouse' })
  assert.equal([...gadget.name].length, GADGET_NAME_MAX_LENGTH)
})

test('カテゴリを決めずに探すと、候補にカテゴリが付いてくる', async () => {
  const { getProductSuggestionsAnyCategory } = await import('../src/utils/productSuggestions')
  const [first] = getProductSuggestionsAnyCategory('MX Master', 'ja', 5)
  assert.equal(first?.category, 'Mouse')
  assert.deepEqual(getProductSuggestionsAnyCategory('  ', 'ja', 5), [])
})

test('USB給電のライトは、ラベルの無い口を給電の口とみなし、既定の USB-C を足さない', () => {
  // BenQ ScreenBar・Govee のように「給電」の語が無い口しか持たないライトに、
  // 実物に無い「給電 (C)」が生え、USB-A 給電なのに充電器の USB-C を取っていた
  for (const label of [undefined, 'USB電源']) {
    const suggestion: ProductSuggestion = {
      name: 'Monitor Light X',
      ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, ...(label ? { label } : {}) }],
    }
    const gadget = gadgetFromProduct({ ...base, name: suggestion.name, category: 'Light', suggestion })
    const inputs = gadget.ports.filter((p) => p.direction === 'input')
    assert.deepEqual(inputs.map((p) => p.type), ['USB_A'], `label=${label}`)
    assert.equal(gadget.powerUsage, 'continuous')
  }
})
