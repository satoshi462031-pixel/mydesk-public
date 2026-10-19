import * as AppleAuthentication from 'expo-apple-authentication'
import { makeRedirectUri } from 'expo-auth-session'
import * as Crypto from 'expo-crypto'
import * as WebBrowser from 'expo-web-browser'
import type { Session } from '@supabase/supabase-js'
import { createEphemeralAuthClient, supabase, supabaseAuthStorageKey } from '../supabase/client'
import { sessionStorage } from '../supabase/sessionStorage'
import { markSignInPending } from '../store/accountDataOwner'
import { seedPublicNickname } from '../utils/publicNickname'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'
import { authCallbackCode, matchesAuthCallback } from '../utils/authCallback'
import { secureHttpUrl } from '../utils/secureTransport'

WebBrowser.maybeCompleteAuthSession()

// 本体のセッションを張る呼び出しの直前には必ず markSignInPending() を挟む。
// 挟み忘れた経路では、ログイン前に作ったデータがアカウントの控えと合わされず、
// 本人のものとしてそのまま上書きで上がる（store/accountDataOwner.ts）。


export async function authenticatedSettingsSession(expectedUserId: string): Promise<Session> {
  const { data: { session }, error } = await withTimeout(supabase.auth.getSession(), QUICK_TIMEOUT_MS)
  if (error) throw error
  if (!session || !expectedUserId || session.user.id !== expectedUserId) throw new Error('AUTH_ACCOUNT_CHANGED')
  const { data: { user }, error: userError } = await withTimeout(supabase.auth.getUser(session.access_token), QUICK_TIMEOUT_MS)
  if (userError) throw userError
  if (!user || user.id !== expectedUserId) throw new Error('AUTH_ACCOUNT_CHANGED')
  const { data: { session: current }, error: currentError } = await withTimeout(supabase.auth.getSession(), QUICK_TIMEOUT_MS)
  if (currentError) throw currentError
  if (current?.user.id !== expectedUserId) throw new Error('AUTH_ACCOUNT_CHANGED')
  return { ...session, user }
}

export async function changeAccountPassword(expectedUserId: string, currentPassword: string, newPassword: string): Promise<void> {
  const initial = await authenticatedSettingsSession(expectedUserId)
  if (!initial.user.email) throw new Error('ログインが必要です')
  const verifier = createEphemeralAuthClient()
  let updater: ReturnType<typeof createEphemeralAuthClient> | undefined
  let verified = false
  try {
    const { data, error } = await withTimeout(verifier.auth.signInWithPassword({
      email: initial.user.email, password: currentPassword,
    }), QUICK_TIMEOUT_MS)
    if (error) throw error
    verified = !!data.session
    if (!data.session || data.session.user.id !== expectedUserId) throw new Error('AUTH_ACCOUNT_CHANGED')
    const session = await authenticatedSettingsSession(expectedUserId)
    // 変更は元のセッションで行い、照合用の別セッションだけを最後に失効させる。
    updater = createEphemeralAuthClient()
    const { error: sessionError } = await withTimeout(updater.auth.setSession({
      access_token: session.access_token, refresh_token: session.refresh_token,
    }), QUICK_TIMEOUT_MS)
    if (sessionError) throw sessionError
    const { error: updateError } = await withTimeout(updater.auth.updateUser({ password: newPassword, current_password: currentPassword }), QUICK_TIMEOUT_MS)
    if (updateError) {
      if (updateError.code === 'reauthentication_needed') throw new Error('PASSWORD_REAUTH_REQUIRED')
      throw updateError
    }
  } finally {
    if (verified) await withTimeout(verifier.auth.signOut({ scope: 'local' }), QUICK_TIMEOUT_MS).catch(() => {})
    await Promise.allSettled([verifier.auth.dispose(), updater?.auth.dispose()])
  }
}

// ─── メール認証 ───────────────────────────────────────────────

export async function signUpWithEmail(email: string, password: string) {
  await markSignInPending()
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function signInWithEmail(email: string, password: string) {
  await markSignInPending()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  // 既定の 'global' は他の端末のセッションまで失効させる。失効させられた端末は
  // ログアウト処理（控えの保存と端末の消去）を通らずにログイン画面へ落ち、
  // データが残ったまま次のアカウントを迎えることになる
  try {
    const { error } = await withTimeout(supabase.auth.signOut({ scope: 'local' }), QUICK_TIMEOUT_MS)
    if (!error) return
  } catch {}
  // supabase 側は 401/403/404 なら保存済みセッションを消してくれるが、圏外・
  // タイムアウト・サーバー障害では消さずにエラーだけ返す。ここで throw すると
  // 呼び出し側のログアウト処理が丸ごと止まり、電波の無い場所では二度とログアウト
  // できなくなるので、サーバーへの失効が通らなくてもこの端末からは必ず出す。
  await clearLocalSession()
}

/**
 * この端末に保存されているセッションだけを消す。サーバーへの失効は行わない。
 * ログアウトの最終手段と、アカウント削除後（失効させる相手が既に居ない）に使う。
 */
export async function clearLocalSession(): Promise<void> {
  await Promise.all([
    sessionStorage.removeItem(supabaseAuthStorageKey),
    sessionStorage.removeItem(`${supabaseAuthStorageKey}-code-verifier`),
  ])
  // 先にトークンを消すと、SDKは失効リクエストを送らずにローカル状態を閉じられる。
  await withTimeout(supabase.auth.signOut({ scope: 'local' }), QUICK_TIMEOUT_MS).catch(() => {})
}

// パスワード再設定メールのリンクが戻ってくる先。RootNavigator の
// ディープリンク受け口（completePasswordRecovery）が同じパスを見て判定する。
export const RESET_PASSWORD_PATH = 'auth/reset-password'

export function isAuthCallback(url: string, path: string): boolean {
  return matchesAuthCallback(url, makeRedirectUri({ scheme: 'mydesk', path }))
    || matchesAuthCallback(url, `mydesk://${path}`)
}

export async function resetPassword(email: string) {
  const redirectUri = makeRedirectUri({ scheme: 'mydesk', path: RESET_PASSWORD_PATH })
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUri })
  if (error) throw error
}

/**
 * パスワード再設定メールの PKCE リンク
 * （mydesk://auth/reset-password?code=...）からセッションを確立する。
 * 成功したら true（呼び出し側は新しいパスワードを入力する画面へ遷移する）。
 * このURLに関係が無い場合（トークンが見つからない）は false。
 *
 * #access_token= を直接 setSession する経路は絶対に足さないこと。mydesk:// は
 * 検証済みの App Links と違い任意のWebページから発火できるため、攻撃者の
 * トークンを載せたリンクを踏ませるだけで被害者を攻撃者のアカウントへ
 * サイレントログインさせられる。?code= は端末ローカルの code_verifier が
 * 要るのでこの攻撃が成立しない。
 */
export async function completePasswordRecovery(url: string): Promise<boolean> {
  const expected = makeRedirectUri({ scheme: 'mydesk', path: RESET_PASSWORD_PATH })
  const code = authCallbackCode(url, expected) ?? authCallbackCode(url, `mydesk://${RESET_PASSWORD_PATH}`)
  if (code) {
    await markSignInPending()
    const { error } = await withTimeout(supabase.auth.exchangeCodeForSession(code), QUICK_TIMEOUT_MS)
    if (error) throw error
    return true
  }
  return false
}

// ─── メールアドレスの変更 ─────────────────────────────────────

// 確認メールのリンクが戻ってくる先。Supabase の Redirect URLs に載っていないと
// Site URL へ飛ぶ（変更自体はリンクを開いた時点でサーバー側で済むので壊れはしない）
export const EMAIL_CHANGE_PATH = 'auth/email-change'

/**
 * ログインに使うメールアドレスの変更を申し込む。この時点では変わらず、
 * 確認メールのリンクを開いたときに Supabase 側で切り替わる
 * （Secure email change が有効なら、今のアドレスと新しいアドレスの両方で確認が要る）。
 */
export async function requestEmailChange(email: string, expectedUserId: string) {
  const session = await authenticatedSettingsSession(expectedUserId)
  const client = createEphemeralAuthClient()
  try {
    const { error: sessionError } = await withTimeout(client.auth.setSession({
      access_token: session.access_token, refresh_token: session.refresh_token,
    }), QUICK_TIMEOUT_MS)
    if (sessionError) throw sessionError
    const redirectUri = makeRedirectUri({ scheme: 'mydesk', path: EMAIL_CHANGE_PATH })
    const { data, error } = await withTimeout(client.auth.updateUser({ email }, { emailRedirectTo: redirectUri }), QUICK_TIMEOUT_MS)
    if (error) throw error
    return data.user
  } finally {
    await client.auth.dispose()
  }
}

/**
 * 確認リンクから戻ってきたときに、変更後のユーザー情報を取り直す。
 * 変更はリンクを開いた時点でサーバー側で済んでいるが、手元のセッションは古い
 * アドレスを持ったままなので、リフレッシュしないと設定画面の表示が変わらない。
 *
 * リンクの ?code= をセッションに交換する経路は取らない。張り直す必要があるのは
 * 今のセッションの中身だけで、別のセッションを張る理由が無い。
 */
export async function refreshAfterEmailChange() {
  const { data, error } = await supabase.auth.refreshSession()
  if (error) throw error
  return data.user
}

// ─── Google OAuth ─────────────────────────────────────────────
// 必要な設定:
//   1. Supabase Dashboard > Authentication > Providers > Google を有効化
//   2. Google Cloud Console で OAuth クライアントを作成
//   3. 承認済みリダイレクトURIに Supabase のコールバックURLを追加
//   4. app.json の "scheme" が "mydesk" であること

// 戻り値: セッション（成功）／null（ユーザーがブラウザを閉じた等のキャンセル）
export async function signInWithGoogle() {
  const redirectUri = makeRedirectUri({
    scheme: 'mydesk',
    path:   'auth/callback',
  })

  const { data, error } = await withTimeout(supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo:         redirectUri,
      skipBrowserRedirect: true,
    },
  }), QUICK_TIMEOUT_MS)
  if (error) throw error
  if (!data.url) throw new Error('OAuth URL を取得できませんでした')

  const result = await WebBrowser.openAuthSessionAsync(secureHttpUrl(data.url).href, redirectUri)
  if (result.type !== 'success') return null
  const url = result.url

  // PKCE フロー: リダイレクトの ?code= をセッションに交換
  if (!matchesAuthCallback(url, redirectUri)) throw new Error('Invalid authentication callback')
  const code = authCallbackCode(url, redirectUri)
  if (code) {
    await markSignInPending()
    const { data: session, error: exchangeError } =
      await withTimeout(supabase.auth.exchangeCodeForSession(code), QUICK_TIMEOUT_MS)
    if (exchangeError) throw exchangeError
    return session
  }

  // リダイレクトにエラーが載っている場合は握りつぶさず表示する
  const errDesc = url.match(/[?&#]error_description=([^&#]+)/)?.[1]
  if (errDesc) throw new Error(decodeURIComponent(errDesc.replace(/\+/g, ' ')))
  return null
}

// ─── Apple Sign In ────────────────────────────────────────────
// 必要な設定:
//   1. Supabase Dashboard > Authentication > Providers > Apple を有効化
//   2. Apple Developer で Sign In with Apple capability を有効化
//   3. app.json の plugins に "expo-apple-authentication" を追加（entitlement 自動付与）

export async function signInWithApple() {
  const rawNonce = Crypto.randomUUID()
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  )

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  })

  if (!credential.identityToken) throw new Error('Apple の認証トークンを取得できませんでした')

  await markSignInPending()
  const { data, error } = await withTimeout(supabase.auth.signInWithIdToken({
    provider: 'apple',
    token:    credential.identityToken,
    nonce:    rawNonce,
  }), QUICK_TIMEOUT_MS)
  if (error) throw error

  // 名前は identityToken に載らない（Apple が返すのはこの credential の側だけ）。
  // しかも返るのは**その Apple ID で初めてこのアプリを承認したときの一度きり**なので、
  // ここで拾わないと二度と取れない。Google では handle_new_user が
  // raw_user_meta_data から display_name を入れるのに、Apple だけ空で始まっていた。
  //
  // 置き先は端末（publicNickname）。名前の正本は端末側で、公開名として使うのは
  // 登録直後のモーダルで本人が確認してからになる（勝手にサーバーへ本名を送らない）。
  // 既に値があれば seedPublicNickname は書かない。
  //
  // givenName だけを使うのは並び順のため。ja は姓→名、en は名→姓で、ここに
  // 言語は渡ってこない。どちらの言語でも読める側だけを下書きにする
  const appleName = credential.fullName?.givenName?.trim() || credential.fullName?.nickname?.trim()
  if (appleName) await seedPublicNickname(appleName).catch(() => {})

  return data
}

// ─── アカウント削除 ───────────────────────────────────────────

/**
 * Apple 連携アカウントの削除に必要な authorization code を取り直す。
 * Apple のダイアログが出るため失敗（キャンセル・期限切れ）しうる。取り消せない
 * データ削除を始めた後にここで失敗すると、公開データだけ消えてアカウントが
 * 残る復旧不能な状態になるので、必ず削除処理の一番最初に呼ぶこと。
 * Apple 以外のアカウントでは undefined を返す。
 */
export async function prepareAccountDeletion(expectedUserId: string): Promise<string | undefined> {
  const { user } = await authenticatedSettingsSession(expectedUserId)

  const appleIdentity = user.identities?.find((identity) => identity.provider === 'apple')
  if (!appleIdentity) return undefined

  const appleUserId = typeof appleIdentity.identity_data?.sub === 'string'
    ? appleIdentity.identity_data.sub
    : appleIdentity.id
  const credential = await AppleAuthentication.refreshAsync({ user: appleUserId })
  if (!credential.authorizationCode) {
    throw new Error('Apple認証を確認できませんでした。もう一度お試しください')
  }
  return credential.authorizationCode
}

/**
 * Apple 以外のアカウントを削除する直前に、本人がログインし直す。delete-account は
 * アクセストークンの amr（最後にログインした時刻）が10分以内であることを求める。
 * 使い捨てのクライアントで認証し、本体のセッションは変えない。返したトークンは削除にだけ使う。
 * prepareAccountDeletion と同じく、データを消し始める前に呼ぶこと。
 */
export async function reauthenticateForDeletion(
  askPassword: (email: string) => Promise<string | null>,
  expectedUserId: string,
): Promise<string> {
  const { user } = await authenticatedSettingsSession(expectedUserId)
  const client = createEphemeralAuthClient()
  const providers = new Set((user.identities ?? []).map((identity) => identity.provider))

  let session: Session | null = null
  if (providers.has('google')) {
    const redirectUri = makeRedirectUri({ scheme: 'mydesk', path: 'auth/callback' })
    const { data, error } = await withTimeout(client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectUri, skipBrowserRedirect: true },
    }), QUICK_TIMEOUT_MS)
    if (error) throw error
    if (!data.url) throw new Error('OAuth URL を取得できませんでした')
    const result = await WebBrowser.openAuthSessionAsync(secureHttpUrl(data.url).href, redirectUri)
    if (result.type !== 'success') throw new Error('REAUTH_CANCELLED')
    const code = authCallbackCode(result.url, redirectUri)
    if (!code) throw new Error('REAUTH_CANCELLED')
    const exchanged = await withTimeout(client.auth.exchangeCodeForSession(code), QUICK_TIMEOUT_MS)
    if (exchanged.error) throw exchanged.error
    session = exchanged.data.session
  } else if (user.email) {
    const password = await askPassword(user.email)
    if (password == null) throw new Error('REAUTH_CANCELLED')
    const { data, error } = await withTimeout(client.auth.signInWithPassword({ email: user.email, password }), QUICK_TIMEOUT_MS)
    if (error) throw error
    session = data.session
  } else {
    throw new Error('REAUTH_UNAVAILABLE')
  }

  if (!session) throw new Error('REAUTH_CANCELLED')
  if (session.user.id !== user.id) {
    // 別の Google アカウントを選んだ。そのセッションは使わずに閉じる（scope: local はこのセッションだけ失効させる）
    await client.auth.signOut({ scope: 'local' }).catch(() => {})
    throw new Error('REAUTH_ACCOUNT_MISMATCH')
  }
  return session.access_token
}

/**
 * アカウント（auth.users）を削除する。クライアントの権限では auth.users を
 * 消せないため、service_role を持つ Edge Function 経由で行う。
 * 関連データとStorageの画像は、本人確認を済ませたEdge Functionが削除する。
 * Apple 以外は reauthenticateForDeletion のトークンを渡す。
 */
export async function deleteAccount(appleAuthorizationCode: string | undefined, reauthAccessToken: string | undefined, expectedUserId: string): Promise<void> {
  const session = await authenticatedSettingsSession(expectedUserId)
  const token = reauthAccessToken ?? session.access_token
  if (reauthAccessToken) {
    const { data: { user }, error } = await withTimeout(supabase.auth.getUser(token), QUICK_TIMEOUT_MS)
    if (error) throw error
    if (user?.id !== expectedUserId) throw new Error('AUTH_ACCOUNT_CHANGED')
  }
  const { data, error } = await withTimeout(supabase.functions.invoke('delete-account', {
    body: { appleAuthorizationCode },
    headers: { Authorization: `Bearer ${token}` },
  }), QUICK_TIMEOUT_MS)
  if (error) {
    // 2xx 以外では本文の理由（再認証が要る・別の Apple ID など）が error.context に入る
    const body = await (error as { context?: { json?: () => Promise<unknown> } }).context?.json?.().catch(() => null) as { error?: unknown } | null
    throw typeof body?.error === 'string' ? new Error(body.error) : error
  }
  if (data?.error) throw new Error(data.error)
  if (data?.ok !== true) throw new Error('ACCOUNT_DELETION_UNCONFIRMED')
}

// ─── セッション取得 ───────────────────────────────────────────

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}
