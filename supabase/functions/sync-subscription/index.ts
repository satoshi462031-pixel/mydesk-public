import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import { fetchProState, parseSandboxAllowlist, sandboxCounts, type ProState } from '../revenuecat-webhook/entitlement.ts'
import { syncDecision } from './decide.ts'

// アプリからの課金状態の取り直し。
//
// tier を書くのは本来 revenuecat-webhook だけだが、Webhook が届かないと直す手段が無い。
// 復元は（別アカウントからの移行でなければ）イベントが出ないし、RENEWAL を取りこぼすと
// tier は pro のまま期限だけ古くなり、is_pro_user の期限ガードで3日後に AI コーチが止まる。
// そこで、アプリが「RevenueCat では Pro なのにサーバーが追いつかない」と気づいたときに呼び、
// Webhook と同じく RevenueCat が計算した今の権利（REST API）を正本にして書き直す。
// 本人の申告は使わないので、呼べるのは自分の行を正しい値に揃えることだけ。
//
// ── デプロイ ──
//   supabase functions deploy sync-subscription
//   （JWT の検証は既定のまま。秘密は revenuecat-webhook と同じものを使う）

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// 連打で RevenueCat の API 枠（Webhook と共用）を食わせない。インスタンスごとの目安でしかないが、
// アプリが呼ぶのは食い違いに気づいたときだけなので、普通の使い方ではまず当たらない
const MIN_INTERVAL_MS = 10_000
const recentCalls = new Map<string, number>()

// 取り直しの時刻をそのまま rc_last_event_at にすると、取り直しの直前に起きて RevenueCat の
// API にまだ出ていなかったイベントの Webhook を stale として捨ててしまう。少し前の時刻で書く
const EVENT_AT_MARGIN_MS = 60_000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const revenueCatSecret = Deno.env.get('REVENUECAT_SECRET_API_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !revenueCatSecret) {
    console.error('sync-subscription environment is incomplete')
    return json({ error: 'server misconfigured' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return json({ error: 'unauthorized' }, 401)
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await authClient.auth.getUser(jwt)
  if (userError || !userData?.user) return json({ error: 'unauthorized' }, 401)
  const { error: accessError } = await authClient.rpc('check_account_access')
    .abortSignal(AbortSignal.timeout(10_000))
  if (accessError) return json({ error: 'account access unavailable' }, accessError.code === 'PT401' ? 401 : 503)
  const userId = userData.user.id

  const now = Date.now()
  const lastCall = recentCalls.get(userId)
  if (lastCall != null && now - lastCall < MIN_INTERVAL_MS) return json({ error: 'too many requests' }, 429)
  recentCalls.set(userId, now)
  for (const [id, at] of recentCalls) if (now - at >= MIN_INTERVAL_MS) recentCalls.delete(id)

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  // RevenueCat の顧客 ID は利用者 ID ではなく本人だけが知る値（107）
  const { data: customer, error: customerError } = await supabase
    .from('profiles').select('rc_customer_id').eq('id', userId).maybeSingle()
  if (customerError) return json({ error: 'failed to read customer' }, 500)
  if (!customer) return json({ error: 'unknown user' }, 404)
  const customerId = customer.rc_customer_id as string

  const allowSandbox = Deno.env.get('REVENUECAT_ALLOW_SANDBOX') === 'true'
  const sandboxAllowlist = parseSandboxAllowlist(Deno.env.get('REVENUECAT_SANDBOX_USER_IDS'))
  let state: ProState
  try {
    state = await fetchProState(customerId, revenueCatSecret, sandboxCounts(userId, allowSandbox, sandboxAllowlist))
  } catch (fetchError) {
    // 推測で書かない。課金済みの人を落とすか、失効した人に配るかのどちらかになる
    console.error('RevenueCat subscriber fetch failed', { userId, error: String(fetchError) })
    return json({ error: 'failed to fetch subscriber' }, 502)
  }

  const [subscriptionResult, profileResult] = await Promise.all([
    supabase.from('subscriptions').select('tier, expires_at').eq('user_id', userId).maybeSingle(),
    supabase.from('profiles').select('tier').eq('id', userId).maybeSingle(),
  ])
  if (subscriptionResult.error || profileResult.error) {
    console.error('sync-subscription read failed', { userId })
    return json({ error: 'failed to read tier' }, 500)
  }
  if (!profileResult.data) return json({ error: 'unknown user' }, 404)

  const decision = syncDecision({
    subscription: subscriptionResult.data,
    profileTier:  profileResult.data.tier ?? null,
  }, state)

  let result: string = decision
  if (decision === 'apply') {
    const eventId = `app-sync:${crypto.randomUUID()}`
    const eventAt = new Date(now - EVENT_AT_MARGIN_MS).toISOString()
    const { data, error } = await supabase.rpc('apply_revenuecat_event', {
      p_user_id:        userId,
      p_tier:           state.tier,
      p_event_id:       eventId,
      p_event_at:       eventAt,
      p_rc_customer_id: customerId,
      p_rc_product_id:  state.productId,
      p_rc_entitlement: 'pro',
      p_expires_at:     state.expiresAt,
    })
    if (error) {
      console.error('apply_revenuecat_event failed', { userId, error: error.message })
      return json({ error: 'failed to apply' }, 500)
    }
    result = String(data)
    if (result !== 'unknown_user') {
      // 管理画面の集計は event_type ごとに数える。APP_SYNC は購入・更新の件数に混ざらない
      const { error: historyError } = await supabase.from('subscription_events').insert({
        event_id:       eventId,
        user_id:        userId,
        event_type:     'APP_SYNC',
        product_id:     state.productId,
        entitlement:    'pro',
        resulting_tier: state.tier,
        expires_at:     state.expiresAt,
        event_at:       eventAt,
        apply_result:   result,
      })
      // 反映は済んでいる。履歴だけの失敗でアプリに失敗を返すと、また呼ばれるだけになる
      if (historyError) console.error('subscription event history failed', { userId, error: historyError.message })
    }
    console.log('subscription synced from app', { userId, tier: state.tier, result })
  }

  const { data: isPro, error: proError } = await supabase.rpc('is_pro_user', { p_user_id: userId })
  if (proError) return json({ ok: true, result, tier: state.tier })
  return json({ ok: true, result, tier: state.tier, is_pro: isPro === true })
})
