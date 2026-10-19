import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { isPasskeyCancelled, passkeyErrorMessage } from '../src/utils/passkeyErrors'

const code = ts.transpileModule(readFileSync('src/services/passkeyService.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function harness(options: {
  enabled?: boolean; platform?: string; version?: string | number; missingModule?: boolean; supported?: boolean
  rpId?: string; cancel?: boolean; nativeError?: unknown; startError?: unknown; verifyError?: unknown
  accountChanges?: boolean; confirmed?: boolean
} = {}) {
  const calls: string[] = []
  const credential = { id: 'credential', rawId: 'credential', type: 'public-key', response: { clientDataJSON: 'signed-client-data', authenticatorData: 'authenticator-data', signature: 'signature', userHandle: 'user-id', attestationObject: 'attestation' } }
  const session = { access_token: 'session-token', user: { id: 'me' } }
  const metadata = { id: 'key', friendly_name: 'iCloud Keychain', created_at: '2026-10-12T00:00:00Z' }
  let userReads = 0
  let nativeLoads = 0
  let verification: any
  const auth = {
    getUser: async () => {
      calls.push('user')
      return { data: { user: { id: options.accountChanges && ++userReads > 1 ? 'other' : 'me', email_confirmed_at: options.confirmed === false ? null : 'confirmed' } }, error: null }
    },
    passkey: {
      startAuthentication: async () => {
        calls.push('start-login')
        return { data: { challenge_id: 'login-challenge', options: { rpId: options.rpId ?? 'mydesk.page', challenge: 'server-challenge' } }, error: options.startError ?? null }
      },
      startRegistration: async () => {
        calls.push('start-registration')
        return { data: { challenge_id: 'registration-challenge', options: { rp: { id: options.rpId ?? 'mydesk.page', name: 'MyDesk' }, user: { id: 'encoded-user', name: 'me' }, challenge: 'server-challenge' } }, error: options.startError ?? null }
      },
      verifyAuthentication: async (params: unknown) => {
        calls.push('verify-login'); verification = params
        return { data: { session, user: session.user }, error: options.verifyError ?? null }
      },
      verifyRegistration: async (params: unknown) => {
        calls.push('verify-registration'); verification = params
        return { data: metadata, error: options.verifyError ?? null }
      },
      list: async () => ({ data: [metadata], error: null }),
      delete: async ({ passkeyId }: { passkeyId: string }) => { calls.push('remove:' + passkeyId); return { error: null } },
    },
  }
  const ceremony = async (request: any) => {
    calls.push('ceremony')
    assert.equal(request.challenge, 'server-challenge')
    if (options.nativeError) throw options.nativeError
    return options.cancel ? null : credential
  }
  const module = { exports: {} as any }
  runInNewContext(code, {
    module, exports: module.exports,
    process: { env: { EXPO_PUBLIC_PASSKEY_ENABLED: options.enabled === false ? 'false' : 'true' } },
    require: (id: string) => {
      if (id === 'react-native') return { Platform: { OS: options.platform ?? 'ios', Version: options.version ?? (options.platform === 'android' ? 34 : 18) } }
      if (id.endsWith('/supabase/client')) return { supabase: { auth } }
      if (id.endsWith('/accountDataOwner')) return { markSignInPending: async () => { calls.push('pending') } }
      if (id === 'react-native-passkeys') {
        nativeLoads++
        if (options.missingModule) throw new Error('Missing native module')
        return { isSupported: () => options.supported !== false, create: ceremony, get: ceremony }
      }
      throw new Error(id)
    },
  })
  return { service: module.exports, calls, credential, session, metadata, verification: () => verification, nativeLoads: () => nativeLoads }
}

test('未対応OSと公開前はネイティブモジュールをロードせず、旧ビルドでも落ちない', () => {
  for (const options of [{ enabled: false }, { enabled: false, platform: 'android' }, { platform: 'android', version: 27 }, { platform: 'android', version: 'unknown' }, { platform: 'web' }, { version: 15 }, { version: '15.8.4' }, { version: 'unknown' }]) {
    const h = harness(options)
    assert.equal(h.service.isPasskeySupported(), false)
    assert.equal(h.nativeLoads(), 0)
  }
  assert.equal(harness({ missingModule: true }).service.isPasskeySupported(), false)
  assert.equal(harness({ supported: false }).service.isPasskeySupported(), false)
  assert.equal(harness().service.isPasskeySupported(), true)
  assert.equal(harness({ version: '18.0.1' }).service.isPasskeySupported(), true)
  assert.equal(harness({ platform: 'android', version: 28 }).service.isPasskeySupported(), true)
  assert.equal(harness({ platform: 'android', missingModule: true }).service.isPasskeySupported(), false)
})

test('チャレンジと署名を渡し、セッション確立前に端末データの照合を予約する', async () => {
  for (const platform of ['ios', 'android']) {
    const h = harness({ platform })
    assert.equal((await h.service.signInWithPasskey()).session, h.session)
    assert.deepEqual(h.calls, ['start-login', 'ceremony', 'pending', 'verify-login'])
    assert.equal(h.verification().challengeId, 'login-challenge')
    assert.equal(h.verification().credential.response, h.credential.response)
    assert.equal(h.verification().credential.rawId, h.credential.rawId)
  }
})

test('キャンセル時はセッションを検証せず、照合予約も作らない', async () => {
  for (const options of [{ cancel: true }, { nativeError: Object.assign(new Error('cancel'), { code: 'ERR_USER_CANCELLED' }) }, { platform: 'android', nativeError: Object.assign(new Error('UserCancelled'), { code: 'Passkey Get' }) }]) {
    const h = harness(options)
    await assert.rejects(h.service.signInWithPasskey(), error => isPasskeyCancelled(error))
    assert.deepEqual(h.calls, ['start-login', 'ceremony'])
  }
})

test('RP不一致と開始失敗は、端末の認証を開く前に停止する', async () => {
  const wrongRp = harness({ rpId: 'other.example' })
  await assert.rejects(wrongRp.service.signInWithPasskey(), /PASSKEY_CONFIGURATION_ERROR/)
  assert.deepEqual(wrongRp.calls, ['start-login'])
  const failed = harness({ startError: new Error('offline') })
  await assert.rejects(failed.service.signInWithPasskey(), /offline/)
  assert.deepEqual(failed.calls, ['start-login'])
})

test('サーバーが署名を拒否したらログイン成功を返さない', async () => {
  const h = harness({ verifyError: new Error('invalid signature') })
  await assert.rejects(h.service.signInWithPasskey(), /invalid signature/)
})

test('登録は確認済みの本人に結び付き、登録用チャレンジを検証する', async () => {
  for (const platform of ['ios', 'android']) {
    const h = harness({ platform })
    assert.equal(await h.service.registerPasskey('me'), h.metadata)
    assert.deepEqual(h.calls, ['user', 'start-registration', 'ceremony', 'user', 'verify-registration'])
    assert.equal(h.verification().challengeId, 'registration-challenge')
    assert.equal(h.verification().credential.response.attestationObject, 'attestation')
  }
})

test('アカウント切替と未確認アカウントではパスキーを登録しない', async () => {
  const changed = harness({ accountChanges: true })
  await assert.rejects(changed.service.registerPasskey('me'), /AUTH_ACCOUNT_CHANGED/)
  assert.equal(changed.calls.includes('verify-registration'), false)
  const unconfirmed = harness({ confirmed: false })
  await assert.rejects(unconfirmed.service.registerPasskey('me'), /PASSKEY_ACCOUNT_UNCONFIRMED/)
  assert.deepEqual(unconfirmed.calls, ['user'])
})

test('登録のキャンセルと別RPの登録は検証しない', async () => {
  const cancelled = harness({ cancel: true })
  await assert.rejects(cancelled.service.registerPasskey('me'), /PASSKEY_CANCELLED/)
  assert.equal(cancelled.calls.includes('verify-registration'), false)
  const wrongRp = harness({ rpId: 'other.example' })
  await assert.rejects(wrongRp.service.registerPasskey('me'), /PASSKEY_CONFIGURATION_ERROR/)
  assert.equal(wrongRp.calls.includes('ceremony'), false)
})

test('一覧と解除は表示中の本人を確認してから行う', async () => {
  const h = harness()
  assert.deepEqual(await h.service.listPasskeys('me'), [h.metadata])
  await h.service.removePasskey('me', 'key')
  assert.equal(h.calls.includes('remove:key'), true)
  const other = harness()
  await assert.rejects(other.service.removePasskey('other', 'key'), /AUTH_ACCOUNT_CHANGED/)
  assert.equal(other.calls.some(value => value.startsWith('remove:')), false)
})

test('エラーは表示言語に合わせ、取消と認証失敗を区別する', () => {
  assert.match(passkeyErrorMessage({ code: 'passkey_disabled' }, 'ja'), /別の方法/)
  assert.match(passkeyErrorMessage({ code: 'webauthn_credential_exists' }, 'en'), /already registered/)
  assert.equal(isPasskeyCancelled({ code: 'ERR_PASSKEY_REQUEST_FAILED' }), false)
  assert.equal(isPasskeyCancelled(null), false)
})

test('Androidの登録キャンセルもセッション検証へ進めない', async () => {
  const h = harness({ platform: 'android', nativeError: Object.assign(new Error('UserCancelled'), { code: 'Passkey Create' }) })
  await assert.rejects(h.service.registerPasskey('me'), error => isPasskeyCancelled(error))
  assert.equal(h.calls.includes('verify-registration'), false)
})

test('Androidの未登録と設定不足をキャンセルと混同せず、OSの内部エラーを直接表示しない', () => {
  const noCredentials = { code: 'Passkey Get', message: 'NoCredentials' }
  assert.equal(isPasskeyCancelled(noCredentials), false)
  assert.match(passkeyErrorMessage(noCredentials, 'ja'), /見つかりません/)
  assert.match(passkeyErrorMessage({ code: 'Passkey Create', message: 'NotConfigured' }, 'ja'), /パスワード管理サービス/)
  assert.match(passkeyErrorMessage({ code: 'Passkey Get', message: 'Interrupted' }, 'en'), /interrupted/)
  assert.match(passkeyErrorMessage({ code: 'Passkey Get', message: 'DomError: SecurityError - internal detail' }, 'en'), /Could not use a passkey/)
  assert.equal(isPasskeyCancelled({ code: 'some-server-code', message: 'UserCancelled' }), false)
})
