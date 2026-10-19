import assert from 'node:assert/strict'
import test from 'node:test'
import { utf8ByteLength } from '../src/utils/utf8ByteLength'

test('バックアップ容量をUTF-8の実バイト数で計算する', () => {
  assert.equal(utf8ByteLength('desk'), 4)
  assert.equal(utf8ByteLength('デスク'), 9)
  assert.equal(utf8ByteLength('🖥️'), Buffer.byteLength('🖥️', 'utf8'))
})
