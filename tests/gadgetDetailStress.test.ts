import assert from 'node:assert/strict'
import test from 'node:test'
import { gadgetDetailHarness } from './helpers/gadgetDetailHarness'
import { CONTROL_TEST_SEEDS, seededRandom } from './helpers/seededRandom'
import type { GadgetCategory } from '../src/types'

test('保存完了後の遷移待ちに保存・削除をランダムに連打しても書き込みと戻るは一度だけ', async () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    const h = gadgetDetailHarness('Mouse')
    void h.frame().handleSave()
    assert.equal(h.pending.length, 1)
    await h.settle()
    for (let i = 0; i < 80; i++) {
      const frame = h.paint()
      if (random(2)) void frame.handleSave()
      else void frame.runDelete()
    }
    assert.equal(h.pending.length, 0)
    assert.equal(h.stored.length, 1)
    assert.equal(h.backs(), 1)
  }
})

test('削除とジャンル変更の確認を混ぜて連打してもダイアログを積み重ねない', () => {
  for (const seed of CONTROL_TEST_SEEDS) {
    const random = seededRandom(seed)
    const h = gadgetDetailHarness('PC')
    for (let i = 0; i < 80; i++) {
      if (random(2)) h.frame().confirmDelete()
      else h.frame().requestCategoryChange('Monitor')
    }
    assert.equal(h.confirmations.length, 1)
  }
})

test('確認中の保存とキャンセル済みの削除は実行せず、削除失敗後は再試行できる', async () => {
  const h = gadgetDetailHarness('PC')
  h.frame().confirmDelete()
  const old = h.confirmations[0]
  await h.frame().handleSave()
  assert.equal(h.pending.length, 0)
  old.onCancel()
  h.frame().confirmDelete()
  old.onConfirm()
  assert.equal(h.pending.length, 0)
  const current = h.confirmations[1]
  current.onConfirm()
  current.onConfirm()
  assert.equal(h.pending.length, 1)
  assert.equal(h.pending[0].kind, 'delete')
  await h.frame().handleSave()
  h.frame().requestCategoryChange('Mouse')
  assert.equal(h.confirmations.length, 2)
  await h.settle(true)
  assert.equal(h.paint().values.isDeleting, false)
  h.frame().confirmDelete()
  h.confirmations[2].onConfirm()
  await h.settle()
  assert.equal(h.backs(), 1)
})

test('保存中はジャンル変更・製品候補・削除を受け付けず、追加の再試行も一件だけ登録する', async () => {
  const h = gadgetDetailHarness('Mouse', true)
  void h.frame().handleSave()
  const name = h.frame().values.name
  for (let i = 0; i < 80; i++) {
    h.frame().confirmDelete()
    h.frame().requestCategoryChange('PC')
    h.frame().handleSuggestionSelect({ name: 'Changed', category: 'PC' })
    void h.frame().handleSave()
  }
  assert.equal(h.pending.length, 1)
  assert.equal(h.confirmations.length, 0)
  assert.equal(h.paint().values.name, name)
  assert.equal(h.frame().values.category, 'Mouse')
  await h.settle(true)
  for (let i = 0; i < 80; i++) void h.paint().handleSave()
  assert.equal(h.pending.length, 1)
  assert.equal(h.pending[0].kind, 'add')
  await h.settle()
  assert.equal(h.stored.length, 1)
  assert.equal(h.backs(), 1)
})

test('保存待ちに別タブへ移っても追加で戻らず、戻って再編集・保存できる', async () => {
  const h = gadgetDetailHarness('Mouse')
  h.frame().setters.setName('First edit')
  h.paint()
  assert.equal(h.shouldConfirmDiscard(), true)
  void h.frame().handleSave()
  h.leave()
  await h.settle()
  assert.equal(h.paint().values.isSaving, false)
  assert.equal(h.backs(), 0)
  assert.equal(h.shouldConfirmDiscard(), false)
  h.focus()
  h.frame().setters.setName('Second edit')
  h.paint()
  assert.equal(h.shouldConfirmDiscard(), true)
  void h.frame().handleSave()
  await h.settle()
  assert.deepEqual(h.stored.map(gadget => gadget.name), ['First edit', 'Second edit'])
  assert.equal(h.backs(), 1)
})

test('13ジャンルの設定を再描画前のランダム連打と保存失敗に混ぜても値を取りこぼさない', async () => {
  const categories: GadgetCategory[] = ['PC', 'Desk', 'Mouse', 'Keyboard', 'Charger', 'PowerStrip', 'Speaker', 'GameConsole', 'Cable', 'SmartHome', 'MobileBattery', 'Monitor', 'Accessory']
  for (const seed of CONTROL_TEST_SEEDS) for (const category of categories) {
    const random = seededRandom(seed)
    const h = gadgetDetailHarness(category)
    let modelOpen = h.frame().values.wiringOpen
    let modelCable = h.frame().values.cableType
    const ports: Record<string, number | boolean> = { ...h.frame().values.portState }
    for (let batch = 0; batch < 100; batch++) {
      const toggle = h.button('onPress', 'setWiringOpen')
      const cable = h.button('onPress', 'setCableType', { value: 'HDMI' })
      const port = h.button('onChange', 'setPortState')
      for (let press = 0, n = 1 + random(8); press < n; press++) {
        const action = random(3)
        if (action === 0) { toggle(); modelOpen = !modelOpen }
        else if (action === 1) { cable(); modelCable = modelCable === 'HDMI' ? '' : 'HDMI' }
        else {
          const key = ['usb_a', 'usb_c', 'hdmi'][random(3)]
          const value = random(11)
          port(key, value); ports[key] = value
        }
      }
      const frame = h.paint()
      assert.equal(frame.values.wiringOpen, modelOpen, `${seed}/${category}/${batch}`)
      assert.equal(frame.values.cableType, modelCable)
      assert.deepEqual({ ...frame.values.portState }, ports)
    }
    void h.frame().handleSave()
    assert.equal(h.pending.length, 1)
    await h.settle(true)
    assert.equal(h.paint().values.isSaving, false)
    void h.frame().handleSave()
    assert.equal(h.pending.length, 1)
    await h.settle()
    assert.equal(h.stored.length, 1)
    for (const port of h.stored[0].ports) assert.ok(Number.isInteger(port.count) && port.count > 0)
    assert.equal(h.stored[0].category, category)
  }
})
