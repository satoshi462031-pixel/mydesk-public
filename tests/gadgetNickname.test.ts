import assert from 'node:assert/strict'
import test from 'node:test'
import { Gadget } from '../src/types'
import { gadgetGenreLabel, gadgetNickname, gadgetSubNickname, gadgetTitle } from '../src/utils/localizedGadgetName'

const base: Gadget = { id: 'g1', name: 'モニター２', category: 'Monitor', ports: [], createdAt: '2026-09-27' }

test('空白だけの呼び名は付けていない扱い', () => {
  assert.equal(gadgetNickname({ nickname: '  ' }), null)
  assert.equal(gadgetNickname({ nickname: ' サブ ' }), 'サブ')
})

test('商品名が未設定の枠は、見出しが呼び名になり補足には重ねない', () => {
  const slot: Gadget = { ...base, isPlaceholder: true, nickname: 'サブモニター' }
  assert.equal(gadgetTitle(slot, 'ja'), 'サブモニター')
  assert.equal(gadgetSubNickname(slot), null)
})

test('商品名があるものは見出しが商品名のまま、呼び名は補足に出る', () => {
  const product: Gadget = { ...base, name: 'Dell U2723QE', nickname: 'サブモニター' }
  assert.equal(gadgetTitle(product, 'ja'), 'Dell U2723QE')
  assert.equal(gadgetSubNickname(product), 'サブモニター')
})

test('呼び名が無ければ従来の名前', () => {
  assert.equal(gadgetTitle({ ...base, isPlaceholder: true }, 'en'), 'Monitor 2')
  assert.equal(gadgetSubNickname(base), null)
})

// 商品名を入れると見出しが商品名になり、ジャンルが絵だけになる。見出しに添えるジャンル名
test('商品名がある機材にはジャンル名を添える', () => {
  assert.equal(gadgetGenreLabel({ ...base, name: 'Dell U2723QE' }, 'ja'), 'モニター')
  assert.equal(gadgetGenreLabel({ ...base, name: 'Dell U2723QE' }, 'en'), 'Monitor')
})

test('見出しが枠の名前（ジャンル名＋連番）のままなら重ねない', () => {
  assert.equal(gadgetGenreLabel({ ...base, isPlaceholder: true }, 'ja'), null)
  assert.equal(gadgetGenreLabel({ ...base, name: '  ' }, 'ja'), null)
})

test('呼び名が見出しになった枠にはジャンル名を添える', () => {
  assert.equal(gadgetGenreLabel({ ...base, isPlaceholder: true, nickname: 'サブモニター' }, 'ja'), 'モニター')
})

test('自作ジャンルは本人が付けた名前を添える', () => {
  const custom: Gadget = { ...base, category: 'Other', name: 'Elgato Stream Deck', customCategory: { id: 'c1', name: '配信機材', icon: 'shape-outline' } }
  assert.equal(gadgetGenreLabel(custom, 'en'), '配信機材')
})
