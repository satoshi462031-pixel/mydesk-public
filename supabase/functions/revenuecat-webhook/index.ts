import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.2'
import { fetchProState, parseSandboxAllowlist, sandboxCounts, type ProState } from './entitlement.ts'
import { customerIdCandidates, matchCustomers, transferUsers, type ResolvedCustomer } from './customers.ts'

// RevenueCat Webhook の受け口。
//
// 課金判定の正本はここ。クライアント（SubscriptionContext）が持つ
// CustomerInfo は端末ローカルの状態でしかなく、AI利用枠のように
// サーバーが判断する機能は profiles.tier を見る（useAIUsageLimit）。
// 購入・更新・失効を profiles.tier に反映できるのはこの関数だけ。
//
// ── デプロイ ──
//   supabase secrets set REVENUECAT_WEBHOOK_SECRET='<好きな長いランダム文字列>'
//   supabase functions deploy revenuecat-webhook --no-verify-jwt
//   TestFlight・App Store審査・開発環境のSandbox購入を同じSupabaseへ反映する場合:
//   supabase secrets set REVENUECAT_ALLOW_SANDBOX=true
//   Sandbox の権利を特定のアカウント（審査用のデモアカウント・自分）だけに絞る場合:
//   supabase secrets set REVENUECAT_SANDBOX_USER_IDS='<uuid>,<uuid>'
//   TestFlight の購読は無料なので、絞らないと TestFlight を入れた人は誰でも本番の Pro（AIコーチ）になる
//
//   --no-verify-jwt は必須。RevenueCat は Authorization ヘッダに
//   （JWT ではなく）ダッシュボードで設定した固定の文字列を入れて送るため、
//   Supabase 側の JWT 検証を通すと全リクエストが 401 になる。
//   代わりにこの関数の中で共有シークレットを検証する。
//
// ── RevenueCat 側の設定 ──
//   Dashboard → Project → Integrations → Webhooks
//     URL:                  https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook
//     Authorization header:  上で secrets set した値と同じ文字列
//
// RevenueCat は 2xx が返るまで再送する。こちらの都合で処理しないイベント
// （テスト送信・未知のユーザーなど）も 200 を返して再送を止め、DB エラー
// のように再試行してほしいものだけ 5xx を返す。
//
// ── 権利の決め方 ──
// イベントは「このユーザーの権利が変わったかもしれない」という合図としてだけ使い、
// tier は REST API（GET /v1/subscribers）で取った今のエンタイトルメントから決める
// （entitlement.ts）。以前はイベントの種類と expiration_at_ms から推し量っていたため、
// 支払いの猶予期間中（BILLING_ISSUE・CANCELLATION が届く）と Android の一時停止で、
// まだ使える人を free に落としていた。
//   supabase secrets set REVENUECAT_SECRET_API_KEY='sk_...'
//   （delete-account と同じ v1 のシークレットキー）

const ENTITLEMENT_PRO = 'pro'

// 権利が変わりうるイベント。これ以外（TEST・SUBSCRIBER_ALIAS・INVOICE_ISSUANCE 等）は無視する
const SIGNAL_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'CANCELLATION',
  'BILLING_ISSUE',
  'REFUND_REVERSED',
  'EXPIRATION',
  'SUBSCRIPTION_PAUSED',
  'TRANSFER',
])

interface RCEvent {
  id?:                   string
  type?:                 string
  app_user_id?:          string
  original_app_user_id?: string
  aliases?:              string[]
  product_id?:           string
  entitlement_ids?:      string[] | null
  entitlement_id?:       string | null
  event_timestamp_ms?:   number
  environment?:          string
  transferred_from?:     string[]
  transferred_to?:       string[]
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// 秘密の比較で早期 return すると、一致した文字数が応答時間に漏れる
function secretMatches(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given)
  const b = new TextEncoder().encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return diff === 0
}

function isOurEntitlement(event: RCEvent): boolean {
  const ids = event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : null)
  // entitlement 情報が無いイベントもある。エンタイトルメントは pro 1種類だけなので
  // 判別できない場合は自分たちのものとして扱う。
  if (!ids || ids.length === 0) return true
  return ids.includes(ENTITLEMENT_PRO)
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const expectedSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')
  if (!expectedSecret) {
    // 未設定のまま公開すると誰でも tier を書き換えられるので、必ず落とす
    console.error('REVENUECAT_WEBHOOK_SECRET is not set')
    return json({ error: 'server misconfigured' }, 500)
  }

  const given = req.headers.get('Authorization') ?? ''
  if (!secretMatches(given, expectedSecret)) return json({ error: 'unauthorized' }, 401)

  let event: RCEvent
  try {
    const body = await req.json() as { event?: RCEvent }
    if (!body?.event) return json({ error: 'missing event' }, 400)
    event = body.event
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  const type = event.type ?? ''

  // TEST / SUBSCRIBER_ALIAS / INVOICE_ISSUANCE など、tier に影響しないもの
  const isTransfer = type === 'TRANSFER'
  if (!SIGNAL_TYPES.has(type)) {
    return json({ ok: true, ignored: 'event_type', type })
  }

  // Sandbox の購入を反映するかは明示的に選ぶ。本番でも true にしておく — App Store の
  // 審査員は Sandbox で購入するので、弾くと審査中に AIコーチが解放されない
  // （Sandbox で買えるのは TestFlight・審査・開発ビルドだけ。revenuecat-setup.md 参照）
  const allowSandbox = Deno.env.get('REVENUECAT_ALLOW_SANDBOX') === 'true'
  const sandboxAllowlist = parseSandboxAllowlist(Deno.env.get('REVENUECAT_SANDBOX_USER_IDS'))
  if (event.environment === 'SANDBOX' && !allowSandbox && sandboxAllowlist.size === 0) {
    return json({ ok: true, ignored: 'sandbox' })
  }

  if (!isTransfer && !isOurEntitlement(event)) {
    return json({ ok: true, ignored: 'entitlement' })
  }

  // idと発生時刻はRevenueCatの全イベントで必須。同じ値が再送でも維持されるため、
  // 欠落時にランダム値や受信時刻へ置き換えると冪等性・順序判定が壊れる。
  if (typeof event.id !== 'string' || !event.id || event.id.length > 255) {
    return json({ error: 'invalid event id' }, 400)
  }
  if (!Number.isSafeInteger(event.event_timestamp_ms) || event.event_timestamp_ms! <= 0) {
    return json({ error: 'invalid event timestamp' }, 400)
  }

  const eventId = event.id
  const eventAt = new Date(event.event_timestamp_ms!).toISOString()

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const revenueCatSecret = Deno.env.get('REVENUECAT_SECRET_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !revenueCatSecret) {
    console.error('revenuecat-webhook environment is incomplete', {
      hasUrl: !!supabaseUrl,
      hasServiceRoleKey: !!serviceRoleKey,
      hasRevenueCatSecret: !!revenueCatSecret,
    })
    return json({ error: 'server misconfigured' }, 500)
  }

  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey,
  )

  // 権利を取り直す相手。1イベントで複数ユーザーを動かすのは TRANSFER（移行元と移行先）だけ
  const candidates = customerIdCandidates(event, isTransfer)
  if (candidates.length === 0) {
    return json({ ok: true, ignored: isTransfer ? 'no_resolvable_user' : 'anonymous_app_user_id' })
  }
  const { data: customerRows, error: customerError } = await supabase
    .from('profiles')
    .select('id, rc_customer_id')
    .in('rc_customer_id', candidates)
  if (customerError) {
    console.error('customer lookup failed', { type, error: customerError.message })
    return json({ error: 'failed to resolve customer' }, 500)
  }
  const customers: ResolvedCustomer[] = matchCustomers(candidates, customerRows ?? [], isTransfer)
  // 107 より前の、利用者 ID のままの顧客もここに来る。誰にも結び付けない
  if (customers.length === 0) return json({ ok: true, ignored: 'unknown_customer' })

  const updates: Array<ResolvedCustomer & ProState> = []
  for (const { userId, customerId } of customers) {
    try {
      const sandboxOk = sandboxCounts(userId, allowSandbox, sandboxAllowlist)
      updates.push({ userId, customerId, ...await fetchProState(customerId, revenueCatSecret, sandboxOk) })
    } catch (fetchError) {
      // 5xx を返して RevenueCat に再送させる。推測で tier を書くと、課金済みの人を落とすか
      // 失効した人に配るかのどちらかになる
      console.error('RevenueCat subscriber fetch failed', { type, userId, error: String(fetchError) })
      return json({ error: 'failed to fetch subscriber' }, 502)
    }
  }

  const results: Record<string, string> = {}
  for (const update of updates) {
    const { data, error } = await supabase.rpc('apply_revenuecat_event', {
      p_user_id:        update.userId,
      p_tier:           update.tier,
      p_event_id:       eventId,
      p_event_at:       eventAt,
      p_rc_customer_id: update.customerId,
      p_rc_product_id:  update.productId ?? event.product_id ?? null,
      p_rc_entitlement: ENTITLEMENT_PRO,
      p_expires_at:     update.expiresAt,
    })

    if (error) {
      // 5xx を返して RevenueCat に再送させる。ここで握り潰すと課金済みの
      // ユーザーが free のまま取り残される。
      console.error('apply_revenuecat_event failed', { type, userId: update.userId, error: error.message })
      return json({ error: 'failed to apply event' }, 500)
    }
    const applyResult = String(data)
    if (applyResult === 'unknown_user') {
      results[update.userId] = applyResult
      continue
    }

    const { error: historyError } = await supabase.from('subscription_events').upsert({
      event_id:       eventId,
      user_id:        update.userId,
      event_type:     type,
      environment:    event.environment ?? null,
      product_id:     event.product_id ?? null,
      entitlement:    ENTITLEMENT_PRO,
      resulting_tier: update.tier,
      expires_at:     update.expiresAt,
      event_at:       eventAt,
      apply_result:   applyResult,
    }, { onConflict: 'event_id,user_id' })

    if (historyError) {
      console.error('subscription event history failed', { type, userId: update.userId, error: historyError.message })
      return json({ error: 'failed to record event history' }, 500)
    }
    results[update.userId] = applyResult
  }

  // 購読を移したら、その週の AI の利用回数も移し先へ持ち越す（119）。持ち越さないと、
  // 購入の復元でアカウントの間を行き来させるだけで、週の枠をアカウントの数だけ使えた。
  // イベントごとに一度だけ足すので、失敗して再送されても二重には足さない
  if (isTransfer) {
    const { from, to } = transferUsers(event, customerRows ?? [])
    for (const fromUser of from) {
      for (const toUser of to) {
        const { error: carryError } = await supabase.rpc('carry_ai_usage_on_transfer', {
          p_event_id: eventId,
          p_from:     fromUser,
          p_to:       toUser,
        })
        if (carryError) {
          console.error('carry_ai_usage_on_transfer failed', { eventId, error: carryError.message })
          return json({ error: 'failed to carry ai usage' }, 500)
        }
      }
    }
  }

  console.log('revenuecat webhook applied', { type, eventId, environment: event.environment, results })
  return json({ ok: true, type, results })
})
