import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decidePush, ownerThrottled } from './decide.ts'
import { followerNotificationContent } from '../_shared/notificationContent.ts'

// フォロー中の人（084）のデスクが公開・更新されたとき、フォロワーの端末へ通知する（085）。
//
// 呼ぶのはデスクの持ち主のアプリ（公開・更新の直後）。送るかどうかはすべてここで決める。
// クライアントの申告（「更新した」）は信用せず、desks の行とサーバーのトリガが
// 進めた content_updated_at だけを見る。呼ばれ方を偽っても、中身が変わっていなければ
// 何も送らない。

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
const EXPO_BATCH = 100
const IN_BATCH = 500

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

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
    const userId = userData.user.id

    const body = await req.json().catch(() => ({})) as { deskId?: unknown }
    const deskId = typeof body.deskId === 'string' ? body.deskId : ''
    if (!UUID_RE.test(deskId)) return json({ error: 'invalid deskId' }, 400)

    const admin = createClient(supabaseUrl, serviceRoleKey)
    const { data: desk, error: deskErr } = await admin
      .from('desks')
      .select('id, user_id, title, visibility, owner_name, owner_profile_public, created_at, content_updated_at')
      .eq('id', deskId)
      .maybeSingle()
    if (deskErr) throw deskErr
    if (!desk) return json({ error: 'not found' }, 404)
    // 他人のデスクで呼べると、持ち主の名前でフォロワーへ通知を撃てる
    if (desk.user_id !== userId) return json({ error: 'forbidden' }, 403)
    // URL限定はフォロワーにも見えない（みんなのデスク・プロフィールに出ない）。
    // プロフィール非公開ではフォローボタン自体が出ないので、名前を出して知らせない
    if (desk.visibility !== 'public' || desk.owner_profile_public === false) {
      return json({ sent: 0, skipped: 'not_public' })
    }

    const { data: log } = await admin
      .from('desk_push_log')
      .select('last_stamp, last_sent_at')
      .eq('desk_id', deskId)
      .maybeSingle()

    const now = Date.now()
    const decision = decidePush(desk, log, now)
    if (!decision.send) return json({ sent: 0, skipped: decision.reason })
    const { kind, stamp } = decision

    const { data: ownerLog, error: ownerLogErr } = await admin
      .from('follower_push_owner_log')
      .select('last_sent_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (ownerLogErr) throw ownerLogErr
    if (ownerThrottled(ownerLog?.last_sent_at, now)) return json({ sent: 0, skipped: 'throttled' })

    // 送る前に記録を取る。読んだ時点の記録と一致したときだけ書けるようにして、
    // 公開の再試行などで呼び出しが重なっても、送るのは記録を取れた1回だけにする
    const claim = { desk_id: deskId, last_stamp: stamp, last_sent_at: new Date(now).toISOString() }
    if (log) {
      const { data: claimed, error: claimErr } = await admin
        .from('desk_push_log')
        .update(claim)
        .eq('desk_id', deskId)
        .eq('last_sent_at', log.last_sent_at)
        .select('desk_id')
      if (claimErr) throw claimErr
      if (!claimed?.length) return json({ sent: 0, skipped: 'in_progress' })
    } else {
      const { error: claimErr } = await admin.from('desk_push_log').insert(claim)
      // 23505 = 同時に走った別の呼び出しが先に記録した
      if (claimErr?.code === '23505') return json({ sent: 0, skipped: 'in_progress' })
      if (claimErr) throw claimErr
    }
    // 持ち主の記録もデスクと同じく、読んだ時点と一致したときだけ取る。別のデスクの公開と
    // 重なっても、送るのは記録を取れた1回だけにする
    const ownerClaim = { user_id: userId, last_sent_at: claim.last_sent_at }
    if (ownerLog) {
      const { data: claimed, error: claimErr } = await admin
        .from('follower_push_owner_log')
        .update(ownerClaim)
        .eq('user_id', userId)
        .eq('last_sent_at', ownerLog.last_sent_at)
        .select('user_id')
      if (claimErr) throw claimErr
      if (!claimed?.length) return json({ sent: 0, skipped: 'in_progress' })
    } else {
      const { error: claimErr } = await admin.from('follower_push_owner_log').insert(ownerClaim)
      if (claimErr?.code === '23505') return json({ sent: 0, skipped: 'in_progress' })
      if (claimErr) throw claimErr
    }

    const { data: follows, error: followErr } = await admin
      .from('user_follows')
      .select('follower_id')
      .eq('followee_id', userId)
      // この人の通知だけを切った人（096）。フォローは続けていて、更新一覧には出る
      .eq('notify', true)
    if (followErr) throw followErr
    let followerIds = (follows ?? []).map((row) => row.follower_id as string)
    if (followerIds.length === 0) return json({ sent: 0 })

    // どちら向きでもブロックがあれば送らない（ガイドライン 1.2）。
    // フォロワーが持ち主をブロックしている／持ち主がフォロワーをブロックしている
    const { data: blocks, error: blockErr } = await admin
      .from('blocked_users')
      .select('blocker_id, blocked_id')
      .or(`blocked_id.eq.${userId},blocker_id.eq.${userId}`)
    if (blockErr) throw blockErr
    const blocked = new Set((blocks ?? []).map((row) => row.blocker_id === userId ? row.blocked_id : row.blocker_id))
    followerIds = followerIds.filter((id) => !blocked.has(id))

    // フォロー中の人の更新の通知を切った人（096）。行が無い人は既定（オン）なので、切った人だけを引いて除く
    const muted = new Set<string>()
    for (const ids of chunk(followerIds, IN_BATCH)) {
      const { data, error } = await admin
        .from('notification_prefs')
        .select('user_id')
        .in('user_id', ids)
        .eq('follow_updates', false)
      if (error) throw error
      for (const row of data ?? []) muted.add(row.user_id as string)
    }
    followerIds = followerIds.filter((id) => !muted.has(id))
    if (followerIds.length === 0) return json({ sent: 0 })

    const tokens: Array<{ token: string; lang: string }> = []
    for (const ids of chunk(followerIds, IN_BATCH)) {
      const { data, error } = await admin.from('push_tokens').select('token, lang').in('user_id', ids)
      if (error) throw error
      tokens.push(...(data ?? []))
    }
    if (tokens.length === 0) return json({ sent: 0 })

    const messages = tokens.map(({ token, lang }) => ({
      to: token,
      ...followerNotificationContent(desk, kind, lang),
      sound: 'default',
    }))

    const dead: string[] = []
    let sent = 0
    for (const batch of chunk(messages, EXPO_BATCH)) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${EXPO_ACCESS_TOKEN}` } : {}),
        },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10000),
      })
      const result = await res.json().catch(() => null) as
        { data?: Array<{ status: string; details?: { error?: string } }> } | null
      result?.data?.forEach((ticket, i) => {
        if (ticket.status === 'ok') sent += 1
        // アプリを消した・通知を切った端末。残すと送るたびに失敗し続ける
        else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(batch[i].to)
      })
    }
    if (dead.length > 0) await admin.from('push_tokens').delete().in('token', dead)

    return json({ sent })
  } catch (error) {
    console.error('notify-followers failed', error)
    return json({ error: 'internal error' }, 500)
  }
})
