import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { composeDeskName, DESK_NAME_MAX, isUnwrittenDeskName } from '../src/utils/deskAutoName'

describe('composeDeskName', () => {
  it('用途から名前を作る', () => {
    assert.equal(composeDeskName(['ゲーム', '仕事'], 'ja'), 'ゲーム・仕事のデスク')
    assert.equal(composeDeskName(['Gaming', 'Remote Work'], 'en'), 'Gaming & Remote Work desk')
  })

  it('用途は2つまでしか入れない（2列のタイルでは3つ目が見えない）', () => {
    assert.equal(composeDeskName(['ゲーム', '仕事', '開発'], 'ja'), 'ゲーム・仕事のデスク')
  })

  it('用途が無いときも空にしない', () => {
    assert.equal(composeDeskName([], 'ja'), 'わたしのデスク')
    assert.equal(composeDeskName(['  '], 'en'), 'My desk')
  })

  it('「その他」に付けた長い名前でも上限を越えない', () => {
    const name = composeDeskName(['あ'.repeat(40)], 'ja')
    assert.ok([...name].length <= DESK_NAME_MAX)
  })
})

describe('isUnwrittenDeskName', () => {
  const auto = 'ゲーム・仕事のデスク'

  it('空・自動の名前・テンプレート名は本人が書いた名前ではない', () => {
    assert.equal(isUnwrittenDeskName('', auto), true)
    assert.equal(isUnwrittenDeskName('  ', auto), true)
    assert.equal(isUnwrittenDeskName(auto, auto), true)
    assert.equal(isUnwrittenDeskName('手持ちから組む', auto), true)
    assert.equal(isUnwrittenDeskName('Start from what you own', auto), true)
  })

  it('本人が書いた名前はそのまま扱う', () => {
    assert.equal(isUnwrittenDeskName('White Desk 2026', auto), false)
    // 用途を変える前の自動の名前は、今の用途の自動の名前とは一致しない
    assert.equal(isUnwrittenDeskName('ゲームのデスク', auto), false)
  })
})
