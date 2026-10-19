import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isRecentlyAuthenticated, jwtPayload } from './reauth.ts'

// アカウント本体（auth.users）の削除。App Store ガイドライン 5.1.1(v) で
// アプリ内からのアカウント削除が必須のため用意している。
// auth.users を消せば profiles / desks / backups / ai_usage / bookmarks /
// billing は ON DELETE CASCADE で連鎖削除される。Storage は連鎖しないため、
// この関数内で削除してから auth.users を削除する。

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonError(message: string, status: number) {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
}

const STORAGE_BUCKETS = ['desk-images', 'desk-images-private']
const LIST_PAGE_SIZE = 100
const REMOVE_BATCH_SIZE = 100

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function createAppleClientSecret(): Promise<{ clientId: string; secret: string }> {
  const teamId = Deno.env.get('APPLE_TEAM_ID')
  const keyId = Deno.env.get('APPLE_KEY_ID')
  const clientId = Deno.env.get('APPLE_CLIENT_ID')
  const privateKeyPem = Deno.env.get('APPLE_PRIVATE_KEY')
  if (!teamId || !keyId || !clientId || !privateKeyPem) {
    throw new Error('Apple token revocation is not configured')
  }

  const normalizedPrivateKey = privateKeyPem.replace(/\\n/g, '\n')
  const der = Uint8Array.from(
    atob(normalizedPrivateKey.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')),
    (char) => char.charCodeAt(0),
  )
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  )
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: keyId }))
  const payload = base64Url(JSON.stringify({
    iss: teamId,
    iat: now,
    exp: now + 300,
    aud: 'https://appleid.apple.com',
    sub: clientId,
  }))
  const unsigned = `${header}.${payload}`
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned),
  ))
  return { clientId, secret: `${unsigned}.${base64Url(signature)}` }
}

class AppleAccountMismatchError extends Error {}

async function revokeAppleAuthorization(authorizationCode: string, expectedAppleUserId: string | null): Promise<void> {
  const { clientId, secret } = await createAppleClientSecret()
  const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      code: authorizationCode,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10000),
  })
  const tokenData = await tokenResponse.json().catch(() => ({})) as { refresh_token?: string; id_token?: string }
  if (!tokenResponse.ok || !tokenData.refresh_token) throw new Error('Apple authorization code exchange failed')
  // 別の Apple ID の認可コードでも交換は通る。削除するアカウントの Apple ID かを確かめないと、
  // 持ち出したアクセストークンと自分の Apple ID の組で他人のアカウントを消せる
  const appleUserId = jwtPayload(tokenData.id_token ?? '')?.sub
  if (!expectedAppleUserId || appleUserId !== expectedAppleUserId) throw new AppleAccountMismatchError()

  const revokeResponse = await fetch('https://appleid.apple.com/auth/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      token: tokenData.refresh_token,
      token_type_hint: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10000),
  })
  if (!revokeResponse.ok) throw new Error('Apple token revocation failed')
}

async function deleteRevenueCatCustomer(customerId: string): Promise<void> {
  const secret = Deno.env.get('REVENUECAT_SECRET_API_KEY')
  if (!secret) throw new Error('RevenueCat customer deletion is not configured')
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(customerId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok && response.status !== 404) throw new Error(`RevenueCat customer deletion failed (${response.status})`)
}

async function removeUserStorage(
  adminClient: Pick<ReturnType<typeof createClient>, 'storage'>,
  userId: string,
): Promise<void> {
  const { data: buckets, error: bucketsError } = await adminClient.storage.listBuckets()
  if (bucketsError) throw bucketsError
  const existingBuckets = new Set((buckets ?? []).map((bucket) => bucket.name))

  for (const bucket of STORAGE_BUCKETS) {
    if (!existingBuckets.has(bucket)) continue

    const objectPaths: string[] = []
    const pendingFolders = [userId]

    while (pendingFolders.length > 0) {
      const folder = pendingFolders.pop()!
      let offset = 0

      while (true) {
        const { data, error } = await adminClient.storage.from(bucket).list(folder, {
          limit: LIST_PAGE_SIZE,
          offset,
          sortBy: { column: 'name', order: 'asc' },
        })
        if (error) throw error

        for (const item of data ?? []) {
          const path = `${folder}/${item.name}`
          if (item.id === null) pendingFolders.push(path)
          else objectPaths.push(path)
        }

        if (!data || data.length < LIST_PAGE_SIZE) break
        offset += LIST_PAGE_SIZE
      }
    }

    for (let i = 0; i < objectPaths.length; i += REMOVE_BATCH_SIZE) {
      const { error } = await adminClient.storage
        .from(bucket)
        .remove(objectPaths.slice(i, i + REMOVE_BATCH_SIZE))
      if (error) throw error
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }
  if (req.method !== 'POST') {
    return jsonError('method not allowed', 405)
  }

  try {
    // 削除対象は「呼び出したユーザー自身」に限定する。
    // ユーザーIDをリクエストから受け取ると他人のアカウントを消せてしまうため、
    // JWT から取り出した ID しか使わない。
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return jsonError('ログインが必要です', 401)

    const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
    const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
    if (userErr || !userData?.user) return jsonError('ログインが必要です', 401)
    const { error: accessError } = await authClient.rpc('check_account_access')
      .abortSignal(AbortSignal.timeout(10_000))
    if (accessError) return jsonError('アカウントの利用状態を確認できません', accessError.code === 'PT401' ? 401 : 503)
    const userId = userData.user.id

    const body = await req.json().catch(() => ({})) as { appleAuthorizationCode?: unknown }
    const appleIdentity = userData.user.identities?.find((identity) => identity.provider === 'apple')
    const hasAppleIdentity = !!appleIdentity
    const appleUserId = typeof appleIdentity?.identity_data?.sub === 'string'
      ? appleIdentity.identity_data.sub
      : appleIdentity?.id ?? null
    const appleAuthorizationCode = typeof body.appleAuthorizationCode === 'string'
      ? body.appleAuthorizationCode
      : ''
    if (hasAppleIdentity && !appleAuthorizationCode) {
      return jsonError('Appleで再認証してから削除してください', 400)
    }
    // Apple は上の認可コードで本人を確かめる。それ以外は、削除の直前にログインし直したことを求める
    if (!hasAppleIdentity && !isRecentlyAuthenticated(jwtPayload(jwt), Math.floor(Date.now() / 1000))) {
      return jsonError('REAUTH_REQUIRED', 401)
    }
    const revenueCatConfigured = !!Deno.env.get('REVENUECAT_SECRET_API_KEY')
    const appleConfigured = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY']
      .every((name) => !!Deno.env.get(name))
    if (!revenueCatConfigured || (hasAppleIdentity && !appleConfigured)) {
      console.error('delete-account provider environment is incomplete', {
        revenueCatConfigured,
        appleConfigured: !hasAppleIdentity || appleConfigured,
      })
      return jsonError('アカウント削除の設定が完了していません', 503)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    // 107 以降の顧客 ID と、それより前に顧客 ID にしていた利用者 ID の両方を消す
    const { data: customer, error: customerError } = await adminClient
      .from('profiles').select('rc_customer_id').eq('id', userId).maybeSingle()
    if (customerError) {
      console.error('customer lookup failed', { userId, error: customerError.message })
      return jsonError('アカウントの削除に失敗しました', 500)
    }
    try {
      if (hasAppleIdentity) await revokeAppleAuthorization(appleAuthorizationCode, appleUserId)
      for (const customerId of new Set([customer?.rc_customer_id as string | undefined, userId])) {
        if (customerId) await deleteRevenueCatCustomer(customerId)
      }
    } catch (providerErr) {
      if (providerErr instanceof AppleAccountMismatchError) {
        return jsonError('削除するアカウントのApple IDで認証してください', 403)
      }
      console.error('Failed to remove external account data', {
        userId,
        error: providerErr instanceof Error ? providerErr.message : String(providerErr),
      })
      return jsonError('外部サービス上のアカウントデータ削除に失敗しました', 502)
    }

    try {
      await removeUserStorage(adminClient, userId)
    } catch (storageErr) {
      console.error('Failed to remove user storage', { userId, error: storageErr })
      return jsonError('アカウントデータの削除に失敗しました', 500)
    }

    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId)
    if (deleteErr) {
      console.error('deleteUser failed', { userId, error: deleteErr.message })
      return jsonError('アカウントの削除に失敗しました', 500)
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    // 内部エラーの本文は返さずログにだけ残す
    console.error('delete-account unhandled error', e)
    return jsonError('アカウントの削除に失敗しました', 500)
  }
})
