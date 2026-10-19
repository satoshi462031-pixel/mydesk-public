import assert from 'node:assert/strict'
import test from 'node:test'
import { localizedErrorMessage } from '../src/utils/localizedError'

test('Supabaseの英語認証エラーを日本語へ変換する', () => {
  assert.equal(
    localizedErrorMessage(new Error('Invalid login credentials'), 'ja'),
    'メールアドレスまたはパスワードが違います。',
  )
})

test('サービスの日本語エラーを英語へ変換する', () => {
  assert.equal(
    localizedErrorMessage(new Error('自分自身はブロックできません'), 'en'),
    'You cannot block yourself.',
  )
})

test('選択言語と違う未知のエラーは画面固有の文言へフォールバックする', () => {
  assert.equal(
    localizedErrorMessage(new Error('内部処理に失敗しました'), 'en', 'Could not save.'),
    'Could not save.',
  )
})

test('選択言語と一致する詳細は維持する', () => {
  assert.equal(
    localizedErrorMessage(new Error('Purchase was cancelled.'), 'en'),
    'Purchase was cancelled.',
  )
})
