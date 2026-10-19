// アカウント削除の直前に本人が認証し直したかの判定。Deno にも node:test にも読めるよう、依存を持たない。
//
// アクセストークンを持っているだけでは本人とみなさない。端末から抜かれたトークンや、
// 貸した端末で開いたままのセッションから、取り消せない削除を実行させないため。

/** ログインし直してから削除までに許す時間 */
export const MAX_REAUTH_AGE_SECONDS = 10 * 60

/** JWT の本体を読む。署名は確かめない（呼び出し側が検証済みの値にだけ使う） */
export function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const value = JSON.parse(new TextDecoder().decode(bytes))
    return value && typeof value === 'object' ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * Supabase のアクセストークンの amr（認証した方法と時刻）から、最後にログインした時刻（秒）。
 * トークンを更新しても amr の時刻は最初にログインしたときのまま残る。iat（発行時刻）は
 * 更新のたびに進むので、認証し直したかの判定には使えない
 */
export function lastAuthenticatedAt(payload: Record<string, unknown> | null): number | null {
  const amr = payload?.amr
  if (!Array.isArray(amr)) return null
  const times = amr
    .map((entry) => (entry && typeof entry === 'object' ? (entry as { timestamp?: unknown }).timestamp : undefined))
    .filter((time): time is number => typeof time === 'number' && Number.isFinite(time))
  return times.length > 0 ? Math.max(...times) : null
}

export function isRecentlyAuthenticated(payload: Record<string, unknown> | null, nowSeconds: number): boolean {
  const at = lastAuthenticatedAt(payload)
  if (at == null) return false
  // 端末の時計ずれで少し未来の時刻が入ることがある。大きく未来のものは壊れた値として通さない
  return at <= nowSeconds + 60 && nowSeconds - at <= MAX_REAUTH_AGE_SECONDS
}
