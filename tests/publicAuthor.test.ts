import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPublicAuthor } from '../src/utils/publicAuthor'

test('ニックネームとタグを並べて表示する', () => {
  assert.equal(formatPublicAuthor('Alice', 'A1B2C3'), 'Alice @A1B2C3')
})

// 060 から @ID は本人が決める。綴りの大小まで本人の指定なので勝手に揃えない
test('タグの綴りを書き換えない', () => {
  assert.equal(formatPublicAuthor('Alice', 'MyDesk'), 'Alice @MyDesk')
})

test('ニックネームが未設定ならタグだけを表示する', () => {
  assert.equal(formatPublicAuthor('', 'A1B2C3'), '@A1B2C3')
})

test('タグがなければニックネームだけを表示する', () => {
  assert.equal(formatPublicAuthor('Alice', ''), 'Alice')
})

// 保存されている値に印は付いていないが、旧データ（表示が # だった頃）や
// 手入力の取りこぼしが来ても二重にならないことを確かめる
test('先頭の印を重ねない', () => {
  assert.equal(formatPublicAuthor('Alice', '#a1b2c3'), 'Alice @a1b2c3')
  assert.equal(formatPublicAuthor('Alice', '@a1b2c3'), 'Alice @a1b2c3')
})
