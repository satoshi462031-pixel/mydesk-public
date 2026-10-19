import assert from 'node:assert/strict'
import test from 'node:test'
import { localUserDataKeys } from '../src/utils/localUserDataKeys'

test('ユーザーデータだけを削除し、認証セッションと端末設定は残す', () => {
  const keys = [
    '@desk_plans',
    '@desk_gadgets',
    '@public_desk_viewed_v1',
    '@desk_history:desk-1',
    '@published_desk_desk-1',
    '@publication_recovery:user:plan:desk-1',
    '@backup_restore_point',
    '@backup_last_at',
    '@local_data_owner',
    '@account_sign_in_pending',
    '@desk_completion_prompt_seen_v1',
    'public_nickname',
    'desk_name',
    '@backup_device_id',
    'sb-project-auth-token',
    '@auth_had_session',
    '@auth_skipped',
    'app_theme',
    'app_language',
  ]

  assert.deepEqual(localUserDataKeys(keys), [
    '@desk_plans',
    '@desk_gadgets',
    '@public_desk_viewed_v1',
    '@desk_history:desk-1',
    '@published_desk_desk-1',
    '@publication_recovery:user:plan:desk-1',
    '@backup_restore_point',
    '@backup_last_at',
    '@local_data_owner',
    '@account_sign_in_pending',
    '@desk_completion_prompt_seen_v1',
    'public_nickname',
    'desk_name',
  ])
})
