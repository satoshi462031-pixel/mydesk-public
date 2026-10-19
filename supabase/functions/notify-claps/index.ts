import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { clapNotificationContent } from '../_shared/notificationContent.ts'

// 自分のデスクに拍手（095）が届いたことを、持ち主の端末へ通知する（096）。
//
// 呼ぶのは拍手したアプリ（拍手が通った直後）。送るかどうかはすべてここで決める。
// 呼ばれ方は信用せず、likes の行と持ち主の設定・送信記録だけを見る。誰が何度呼んでも、
// 新しい拍手が無いか、前の通知から間が空いていなければ何も送らない。
// 誰が拍手したかは文面に出さない（拍手の行は本人にしか読めない・054 と同じ扱い）。

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
// Expo の「プッシュ通知の強化セキュリティ」を有効にすると、このトークン無しの送信は拒否される。
// 有効にしないと、push_tokens の値が漏れただけで誰でも利用者の端末へ通知を送れる
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN')

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  // 古いアプリや直接呼び出しからも送れてしまうため、サーバーでも公開まで止める。
  if (Deno.env.get('PUSH_NOTIFICATIONS_ENABLED') !== 'true') return json({ sent: 0, skipped: 'feature_disabled' })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: 'unauthorized' }, 401)

    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
    const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401)
    const { error: accessError } = await authClient.rpc('check_account_access')
      .abortSignal(AbortSignal.timeout(10_000))
    if (accessError) return json({ error: 'account access unavailable' }, accessError.code === 'PT401' ? 401 : 503)

    const body = await req.json().catch(() => ({})) as { deskId?: unknown }
    const deskId = typeof body.deskId === 'string' ? body.deskId : ''
    if (!UUID_RE.test(deskId)) return json({ error: 'invalid deskId' }, 400)

    const admin = createClient(supabaseUrl, serviceRoleKey)
    // 通知済みの反応と持ち主ごとの間隔を、1つのDBトランザクションで確保する。
    const { data: claim, error: claimErr } = await admin.rpc('claim_desk_clap_notification', { p_desk_id: deskId })
      .abortSignal(AbortSignal.timeout(10_000))
    if (claimErr) throw claimErr
    if (!claim) return json({ sent: 0, skipped: 'no_pending' })
    const { desk, fresh } = claim as { desk: { id: string; user_id: string; title: string | null }; fresh: number }
    const ownerId = desk.user_id

    const { data: tokens, error: tokenErr } = await admin
      .from('push_tokens')
      .select('token, lang')
      .eq('user_id', ownerId)
    if (tokenErr) throw tokenErr
    if (!tokens?.length) return json({ sent: 0 })

    const messages = tokens.map(({ token, lang }) => ({
      to: token,
      ...clapNotificationContent(desk, fresh, lang),
      sound: 'default',
    }))

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10000),
    })
    const result = await res.json().catch(() => null) as
      { data?: Array<{ status: string; details?: { error?: string } }> } | null
    const dead: string[] = []
    let sent = 0
    result?.data?.forEach((ticket, i) => {
      if (ticket.status === 'ok') sent += 1
      // アプリを消した・通知を切った端末。残すと送るたびに失敗し続ける
      else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(messages[i].to)
    })
    if (dead.length > 0) await admin.from('push_tokens').delete().in('token', dead)

    return json({ sent })
  } catch (error) {
    console.error('notify-claps failed', error)
    return json({ error: 'internal error' }, 500)
  }
})
