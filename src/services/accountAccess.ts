import type { Session } from '@supabase/supabase-js'
import { supabase } from '../supabase/client'
import { withTimeout } from '../utils/networkError'

const REVOKED_CODES = new Set([
  'user_banned', 'user_not_found', 'session_not_found', 'session_expired',
  'refresh_token_not_found', 'refresh_token_already_used',
  // 保存したセッションの user と、そのトークンの持ち主が違う。どちらの本人として
  // 続けても他人のデータを読み書きしうるので、失効と同じく閉じて再ログインさせる
  'session_user_mismatch',
])

export function isAccountAccessRevoked(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return typeof code === 'string' && (
    REVOKED_CODES.has(code) || (code === 'PT401' && message === 'ACCOUNT_ACCESS_REVOKED')
  )
}

export async function validateAccountAccess(session: Session): Promise<void> {
  const { data, error } = await withTimeout(supabase.auth.getUser(session.access_token), 20_000)
  if (error) throw error
  if (data.user?.id !== session.user.id) throw Object.assign(new Error('AUTH_ACCOUNT_CHANGED'), { code: 'session_user_mismatch' })
  const controller = new AbortController()
  try {
    const { error: accessError } = await withTimeout(Promise.resolve(
      supabase.rpc('check_account_access')
        .setHeader('Authorization', `Bearer ${session.access_token}`)
        .abortSignal(controller.signal),
    ), 20_000)
    if (accessError) throw accessError
  } finally {
    controller.abort()
  }
}
