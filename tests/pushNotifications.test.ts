import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { PUSH_NOTIFICATIONS_ENABLED } from '../src/constants/features'
import { clapNotificationContent, followerNotificationContent } from '../supabase/functions/_shared/notificationContent'
import * as followerDecisions from '../supabase/functions/notify-followers/decide'
import * as clapDecisions from '../supabase/functions/notify-claps/decide'

function load(file: string, require: (id: string) => unknown, globals: Record<string, unknown> = {}) {
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  runInNewContext(code, { module, exports: module.exports, require, ...globals })
  return module.exports
}

function pushClient(enabled: boolean, os = 'ios', androidEnabled = false, options: { ask?: boolean; intentFails?: boolean; channelBlocked?: boolean } = {}) {
  const calls: string[] = []
  let handler: any
  const client = load('src/services/pushNotifications.ts', (id) => {
    if (id === 'expo-constants') return { expoConfig: { extra: { eas: { projectId: 'project' } }, android: { package: 'com.ash462031.mydesk' } } }
    if (id === 'react-native') return { Platform: { OS: os }, Linking: {
      sendIntent: async (action: string, extras: { key: string; value: string }[]) => {
        assert.equal(action, 'android.settings.APP_NOTIFICATION_SETTINGS')
        assert.equal(extras[0].key, 'android.provider.extra.APP_PACKAGE')
        assert.equal(extras[0].value, 'com.ash462031.mydesk')
        calls.push('notification-settings')
        if (options.intentFails) throw new Error('Intent unavailable')
      },
      openSettings: async () => { calls.push('app-settings') },
    } }
    if (id.endsWith('/features')) return { PUSH_NOTIFICATIONS_ENABLED: enabled }
    if (id.endsWith('/analytics')) return { analytics: { track: () => calls.push('track') }, EVENTS: {} }
    if (id.endsWith('/supabase/client')) return { supabase: {
      rpc: async (name: string) => { calls.push(name); return { error: null } },
    } }
    if (id === 'expo-notifications') return {
      PermissionStatus: { UNDETERMINED: 'undetermined' },
      AndroidImportance: { DEFAULT: 3, NONE: 0 },
      getNotificationChannelAsync: async () => { calls.push('channel-state'); return { importance: options.channelBlocked ? 0 : 3 } },
      setNotificationChannelAsync: async (id: string, config: { name: string; importance: number }) => {
        assert.equal(id, 'default'); assert.equal(config.name, 'MyDesk'); assert.equal(config.importance, 3)
        calls.push('channel')
      },
      setNotificationHandler: (value: unknown) => { handler = value },
      getPermissionsAsync: async () => { calls.push('permissions'); return { status: options.ask ? 'undetermined' : 'granted', canAskAgain: options.ask ?? false } },
      requestPermissionsAsync: async () => { calls.push('prompt'); return { status: 'granted' } },
      getExpoPushTokenAsync: async () => { calls.push('token'); return { data: 'ExponentPushToken[test]' } },
    }
    throw new Error(`Unexpected import: ${id}`)
  }, { __DEV__: false, process: { env: { EXPO_PUBLIC_ANDROID_PUSH_ENABLED: androidEnabled ? 'true' : 'false' } } })
  return { client, calls, handler }
}

test('公開スイッチは既定でオフ', () => {
  assert.equal(PUSH_NOTIFICATIONS_ENABLED, false)
})

test('非公開時は許可の問い合わせ・ダイアログ・トークン登録・前景表示を止める', async () => {
  const { client, calls, handler } = pushClient(false)
  await client.registerPushToken('ja', { prompt: true })
  await client.registerPushToken('en', { prompt: false })
  assert.equal(await client.getPushPermissionState(), 'unsupported')
  assert.deepEqual(calls, [])
  const presentation = await handler.handleNotification()
  assert.equal(presentation.shouldShowBanner, false)
  assert.equal(presentation.shouldShowList, false)
})

test('非公開時もログアウトでは登録済みの宛先を外せる', async () => {
  const { client, calls } = pushClient(false)
  await client.unregisterPushToken()
  assert.deepEqual(calls, ['permissions', 'token', 'unregister_push_token'])
})

test('AndroidのFCM公開スイッチが未設定ならiOSだけ宛先を登録する', async () => {
  const ios = pushClient(true)
  await ios.client.registerPushToken('ja', { prompt: true })
  assert.deepEqual(ios.calls, ['permissions', 'token', 'register_push_token'])
  const android = pushClient(true, 'android')
  await android.client.registerPushToken('ja', { prompt: true })
  assert.deepEqual(android.calls, [])
})

test('Android通知はチャンネル作成後に許可を聞き、トークンを登録する', async () => {
  const android = pushClient(true, 'android', true, { ask: true })
  await android.client.registerPushToken('ja', { prompt: true })
  assert.deepEqual(android.calls, ['channel', 'permissions', 'prompt', 'track', 'token', 'register_push_token'])
})

test('Androidも全体の公開スイッチがオフなら許可やチャンネルを変更しない', async () => {
  const android = pushClient(false, 'android', true)
  await android.client.registerPushToken('ja', { prompt: true })
  assert.equal(await android.client.getPushPermissionState(), 'unsupported')
  assert.deepEqual(android.calls, [])
})

test('前景通知はAndroidの公開スイッチも尊重し、Androidだけ通知表示を抑制する音設定を避ける', async () => {
  const ios = await pushClient(true).handler.handleNotification()
  assert.equal(ios.shouldShowBanner, true)
  assert.equal(ios.shouldPlaySound, false)
  const android = await pushClient(true, 'android', true).handler.handleNotification()
  assert.equal(android.shouldShowBanner, true)
  assert.equal(android.shouldPlaySound, true)
  const disabled = await pushClient(true, 'android', false).handler.handleNotification()
  assert.equal(disabled.shouldShowBanner, false)
  assert.equal(disabled.shouldShowList, false)
  assert.equal(disabled.shouldPlaySound, false)
})

test('Androidのチャンネルだけ無効でも設定へ誘導し、iOSではチャンネルAPIを呼ばない', async () => {
  const android = pushClient(true, 'android', true, { channelBlocked: true })
  assert.equal(await android.client.getPushPermissionState(), 'denied')
  assert.deepEqual(android.calls, ['permissions', 'channel-state'])
  const ios = pushClient(true)
  assert.equal(await ios.client.getPushPermissionState(), 'granted')
  assert.deepEqual(ios.calls, ['permissions'])
})

test('Android通知を非公開に戻してもログアウト時には旧トークンの登録を解除する', async () => {
  const android = pushClient(false, 'android', false)
  await android.client.unregisterPushToken()
  assert.deepEqual(android.calls, ['permissions', 'channel', 'token', 'unregister_push_token'])
})

test('Androidでは通知設定を直接開き、未対応の設定画面ではアプリ設定へ戻す', async () => {
  const android = pushClient(true, 'android', true)
  await android.client.openPushSettings()
  assert.deepEqual(android.calls, ['notification-settings'])
  const legacy = pushClient(true, 'android', true, { intentFails: true })
  await legacy.client.openPushSettings()
  assert.deepEqual(legacy.calls, ['notification-settings', 'app-settings'])
})

// notify-claps は本番に配った版から npm: で読む（6619ee6）。どちらの書き方でも差し替える
const isSupabaseJs = (id: string) => id.startsWith('https://esm.sh/@supabase/supabase-js') || id.startsWith('npm:@supabase/supabase-js')

for (const name of ['notify-followers', 'notify-claps']) {
  test(`${name}: サーバースイッチが明示的にtrueになるまでDB・送信を呼ばない`, async () => {
    for (const value of [undefined, 'false', 'TRUE', '1']) {
      let handle!: (req: Request) => Promise<Response>
      const unexpected = () => { throw new Error('DB or network must not be called') }
      load(`supabase/functions/${name}/index.ts`, (id) => {
        if (isSupabaseJs(id)) return { createClient: unexpected }
        if (id === './decide.ts') return name === 'notify-followers' ? followerDecisions : clapDecisions
        if (id.endsWith('/notificationContent.ts')) return { clapNotificationContent, followerNotificationContent }
        throw new Error(`Unexpected import: ${id}`)
      }, {
        Deno: { serve: (fn: typeof handle) => { handle = fn }, env: { get: () => value } },
        Response, console, fetch: unexpected,
      })
      const response = await handle(new Request('https://example.test', { method: 'POST' }))
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { sent: 0, skipped: 'feature_disabled' })
      assert.equal((await handle(new Request('https://example.test', { method: 'GET' }))).status, 405)
      assert.equal((await handle(new Request('https://example.test', { method: 'OPTIONS' }))).status, 200)
    }
  })

  test(`${name}: 公開後も未認証の呼び出しから送信しない`, async () => {
    let handle!: (req: Request) => Promise<Response>
    load(`supabase/functions/${name}/index.ts`, (id) => {
      if (isSupabaseJs(id)) return { createClient: () => { throw new Error('Must authenticate first') } }
      if (id === './decide.ts') return name === 'notify-followers' ? followerDecisions : clapDecisions
      if (id.endsWith('/notificationContent.ts')) return { clapNotificationContent, followerNotificationContent }
      throw new Error(`Unexpected import: ${id}`)
    }, {
      Deno: { serve: (fn: typeof handle) => { handle = fn }, env: { get: () => 'true' } },
      Response, console,
    })
    assert.equal((await handle(new Request('https://example.test', { method: 'POST' }))).status, 401)
  })
}

const desk = { id: 'desk-id', title: '仕事のデスク', owner_name: 'さとし' }

test('拍手通知はDBで確保した件数を使い、通知枠がなければ送信しない', async () => {
  let handle!: (req: Request) => Promise<Response>
  let claim: unknown = { desk: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', user_id: 'owner', title: 'Desk' }, fresh: 2 }
  const calls: string[] = []
  load('supabase/functions/notify-claps/index.ts', (id) => {
    if (id === 'npm:@supabase/supabase-js@2.108.2') return { createClient: () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }) },
      rpc: (name: string) => ({ abortSignal: async () => {
        calls.push(name)
        return { data: name === 'claim_desk_clap_notification' ? claim : null, error: null }
      } }),
      from: (table: string) => {
        assert.equal(table, 'push_tokens')
        return { select: () => ({ eq: async () => ({ data: [{ token: 'ExpoPushToken[test]', lang: 'ja' }], error: null }) }) }
      },
    }) }
    if (id.endsWith('/notificationContent.ts')) return { clapNotificationContent }
    throw new Error(`Unexpected import: ${id}`)
  }, {
    Deno: { serve: (fn: typeof handle) => { handle = fn }, env: { get: (name: string) => name === 'PUSH_NOTIFICATIONS_ENABLED' ? 'true' : 'test' } },
    Response, console, AbortSignal,
    fetch: async (_url: string, init: RequestInit) => {
      calls.push('push')
      assert.match(JSON.parse(String(init.body))[0].body, /2件/)
      return Response.json({ data: [{ status: 'ok' }] })
    },
  })
  const request = () => new Request('https://example.invalid', { method: 'POST',
    headers: { Authorization: 'Bearer token' }, body: JSON.stringify({ deskId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }),
  })
  assert.deepEqual(await (await handle(request())).json(), { sent: 1 })
  assert.deepEqual(calls, ['check_account_access', 'claim_desk_clap_notification', 'push'])
  claim = null
  calls.length = 0
  assert.deepEqual(await (await handle(request())).json(), { sent: 0, skipped: 'no_pending' })
  assert.deepEqual(calls, ['check_account_access', 'claim_desk_clap_notification'])
})

test('公開・更新の文面を日英で分け、通知から対象デスクを開く', () => {
  const published = followerNotificationContent(desk, 'new', 'ja')
  assert.equal(published.title, 'さとし')
  assert.equal(published.body, '新しいデスク「仕事のデスク」を公開しました')
  assert.equal(published.data.url, 'mydesk://setup/desk-id?source=push')
  assert.equal(followerNotificationContent(desk, 'updated', 'ja').body, '「仕事のデスク」を更新しました')
  assert.equal(followerNotificationContent(desk, 'new', 'en').body, 'Published a new desk: 仕事のデスク')
  assert.equal(followerNotificationContent(desk, 'updated', 'en').body, 'Updated 仕事のデスク')
})

test('拍手は新着件数を出し、拍手した人の名前を含めない', () => {
  const content = clapNotificationContent(desk, 3, 'ja')
  assert.equal(content.title, '拍手が届きました')
  assert.equal(content.body, '「仕事のデスク」に新しい拍手が3件届きました')
  assert.equal(content.data.url, 'mydesk://setup/desk-id?source=push')
  assert.equal(clapNotificationContent(desk, 1, 'en').body, '1 new applause on 仕事のデスク')
})

test('名前未設定の代替文面と長い絵文字を含む名前の省略', () => {
  assert.equal(followerNotificationContent({ ...desk, owner_name: null }, 'new', 'ja').title, 'フォロー中の人')
  assert.equal(followerNotificationContent({ ...desk, owner_name: null }, 'new', 'en').title, 'Someone you follow')
  const content = followerNotificationContent({ ...desk, title: '🪑'.repeat(50), owner_name: '👤'.repeat(40) }, 'new', 'ja')
  assert.equal(content.title, `${'👤'.repeat(29)}…`)
  assert.equal(content.body, `新しいデスク「${'🪑'.repeat(39)}…」を公開しました`)
})

test('フォロワー通知は、デスクを作り直しても持ち主ごとの間隔を空ける', () => {
  const now = Date.parse('2026-10-13T12:00:00Z')
  const { OWNER_MIN_INTERVAL_MS, ownerThrottled } = followerDecisions
  assert.equal(ownerThrottled(null, now), false)
  assert.equal(ownerThrottled(undefined, now), false)
  assert.equal(ownerThrottled(new Date(now - OWNER_MIN_INTERVAL_MS + 1).toISOString(), now), true)
  assert.equal(ownerThrottled(new Date(now - OWNER_MIN_INTERVAL_MS).toISOString(), now), false)
})
