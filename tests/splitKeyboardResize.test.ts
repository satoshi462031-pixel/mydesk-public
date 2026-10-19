import assert from 'node:assert/strict'
import test from 'node:test'
import { pairedSplitKeyboardNodeId } from '../src/utils/connectionMapLayout'

test('分割キーボードは反対側のノードIDを返す', () => {
  assert.equal(pairedSplitKeyboardNodeId('keyboard__L', 'Keyboard'), 'keyboard__R')
  assert.equal(pairedSplitKeyboardNodeId('keyboard__R', 'Keyboard'), 'keyboard__L')
})

test('キーボード以外のL/Rペアは同期対象にしない', () => {
  assert.equal(pairedSplitKeyboardNodeId('speaker__L', 'Speaker'), undefined)
  assert.equal(pairedSplitKeyboardNodeId('keyboard', 'Keyboard'), undefined)
})
