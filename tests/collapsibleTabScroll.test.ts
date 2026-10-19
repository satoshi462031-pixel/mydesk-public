import assert from 'node:assert/strict'
import test from 'node:test'
import { synchronizedTabOffset } from '../src/utils/collapsibleTabScroll'

test('開いているヘッダーの高さを遷移先へ引き継ぐ', () => {
  assert.equal(synchronizedTabOffset(48, 420, 180), 48)
})

test('畳んだヘッダーは先頭のタブへ移っても畳んだままにする', () => {
  assert.equal(synchronizedTabOffset(420, 0, 180), 180)
})

test('両方ともヘッダーより奥なら遷移先の本文位置を保つ', () => {
  assert.equal(synchronizedTabOffset(420, 260, 180), 260)
})
