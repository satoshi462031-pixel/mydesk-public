import AsyncStorage from '@react-native-async-storage/async-storage'
import { Session, User } from '@supabase/supabase-js'
import { AppState } from 'react-native'
import { isAccountAccessRevoked, validateAccountAccess } from '../services/accountAccess'
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { clearLocalSession, signInWithApple, signInWithEmail, signInWithGoogle, signOut, signUpWithEmail } from '../services/auth'
import { analytics, EVENTS, initAnalytics, trackAppOpened } from '../services/analytics'
import { getProfile } from '../services/profiles'
import { supabase } from '../supabase/client'
import { Profile } from '../supabase/types'
import { clearLocalUserData } from '../utils/clearLocalUserData'
import { rememberAuthMethod } from '../utils/lastAuthMethod'
import { seedPublicNickname } from '../utils/publicNickname'
import { saveAccountSnapshotNow } from '../services/backupService'
import { withTimeout } from '../utils/networkError'
import { resumePendingDeskCleanups } from '../services/deskDeletionCleanup'
import { unregisterPushToken } from '../services/pushNotifications'
import { signInWithPasskey } from '../services/passkeyService'

interface AuthContextValue {
  session:  Session | null
  user:     User    | null
  profile:  Profile | null
  loading:  boolean
  /** getSession がタイムアウトしたとき用：前回起動時にセッションがあったか（楽観的な画面振り分けに使う） */
  sessionLikely: boolean
  /** ログインを後回しにしたか。null = まだ読めていない（起動時の画面振り分けを待たせる） */
  authSkipped: boolean | null

  /**
   * 新規登録。戻り値はその場でセッションが確立したか。
   * Supabase の「メール確認」が無効なら登録と同時にログイン済みになり、確認メールは
   * 送られない。有効なら確認するまでセッションは無い。どちらの設定かを画面が推測すると、
   * 設定を変えた瞬間に案内と遷移が食い違うので、実際に返ってきたセッションで見分ける
   */
  signUp:         (email: string, password: string) => Promise<boolean>
  signIn:         (email: string, password: string) => Promise<void>
  signInGoogle:   () => Promise<boolean>   // false = ユーザーがキャンセル
  signInApple:    () => Promise<void>
  signInPasskey:  () => Promise<void>
  /** 「あとで登録」。アカウント固有の機能に触るまではログインを求めない */
  skipAuth:       () => Promise<void>
  /**
   * 控えをアカウントへ保存してから、この端末のデータを消してログアウトする。
   * 保存できなければ消さずに投げる（logoutBackupFailure で理由を取れる）。
   * discardUnsaved は、それを本人が承知したうえで消すときだけ渡す
   */
  logOut:         (options?: { discardUnsaved?: boolean }) => Promise<void>
  /** 端末のデータに触れずにセッションだけ閉じる。別アカウントのデータが残っていたときに使う */
  signOutKeepingLocalData: () => Promise<void>
  finishAccountDeletion: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** ログアウト前の控えが保存できなかった理由 */
export type LogoutBackupFailure = 'failed' | 'too-large' | 'not-synced' | 'recovery-pending' | 'invalid-data' | 'garbled-text' | 'conflict'

export function logoutBackupFailure(error: unknown): LogoutBackupFailure | null {
  if (!(error instanceof Error)) return null
  return (error as Error & { logoutBackup?: LogoutBackupFailure }).logoutBackup ?? null
}

// 前回起動時にセッションがあったかのフラグ。
// getSession はトークン期限切れ時にネットワークのリフレッシュを待つため、
// 低速回線・オフラインではスプラッシュが伸びる。タイムアウト時はこのフラグで
// 楽観的にメイン画面へ進め、認証の解決は裏で継続する。
const HAD_SESSION_KEY = '@auth_had_session'
const SESSION_GATE_TIMEOUT_MS = 1500

// ログインを後回しにした印。デスク作成も配線図も端末内で完結するので、
// 公開・ブックマーク・購入のように「サーバーに残る」操作に触れるまでは
// アカウントを要求しない（App Store のガイドライン 5.1.1(v) にも合わせる）。
const AUTH_SKIPPED_KEY = '@auth_skipped'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession]   = useState<Session | null>(null)
  const [profile, setProfile]   = useState<Profile | null>(null)
  const [loading, setLoading]   = useState(true)
  const [isEndingSession, setIsEndingSession] = useState(false)
  const [sessionLikely, setSessionLikely] = useState(false)
  const [authSkipped, setAuthSkipped] = useState<boolean | null>(null)
  const analyticsUserId = useRef<string | null | undefined>(undefined)
  const profileRequestId = useRef(0)
  const authenticatedSession = useRef(false)
  const currentUserIdRef = useRef<string | null>(null)
  const currentAccessTokenRef = useRef<string | null>(null)
  const sessionEndInFlightRef = useRef(false)

  const loadProfile = useCallback(async (userId: string) => {
    if (currentUserIdRef.current !== userId) return
    const requestId = ++profileRequestId.current
    try {
      const p = await getProfile(userId)
      if (requestId !== profileRequestId.current || currentUserIdRef.current !== userId) return
      setProfile(p)
      // 機種変更・再インストール直後は端末に公開ニックネームが無い。そのまま
      // 「更新して公開」すると desks.owner_name が空で上書きされ、公開ページから
      // 投稿者名が消えるため、サーバーに残っている表示名で埋めておく
      void seedPublicNickname(p?.display_name).catch(() => {})
    } catch {
      if (requestId === profileRequestId.current && currentUserIdRef.current === userId) setProfile(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    withTimeout(AsyncStorage.getItem(AUTH_SKIPPED_KEY), SESSION_GATE_TIMEOUT_MS)
      .then((v) => {
        if (!active) return
        if (authenticatedSession.current) {
          setAuthSkipped(false)
          AsyncStorage.removeItem(AUTH_SKIPPED_KEY).catch(() => {})
        } else {
          setAuthSkipped(v === '1')
        }
      })
      .catch(() => { if (active) setAuthSkipped(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    let settled = false
    let authEventSeen = false
    const sessionLoadStartedAt = Date.now()

    // 一定時間で決着しないときは、前回セッションの有無で楽観的に起動を進める
    const timeout = setTimeout(async () => {
      if (!active || settled) return
      const had = await withTimeout(
        AsyncStorage.getItem(HAD_SESSION_KEY),
        SESSION_GATE_TIMEOUT_MS,
      ).catch(() => null)
      if (!active || settled) return
      if (__DEV__) console.log(`[perf] getSession timed out (${SESSION_GATE_TIMEOUT_MS}ms), hadSession=${had === '1'}`)
      analytics.track(EVENTS.OPERATION_FAILED, {
        operation: 'auth_session_load',
        failure_stage: 'timeout',
        duration_ms: Date.now() - sessionLoadStartedAt,
      })
      setSessionLikely(had === '1')
      setLoading(false)
    }, SESSION_GATE_TIMEOUT_MS)

    // 初期セッション取得
    supabase.auth.getSession().then(({ data: { session: s }, error }) => {
      if (!active) return
      if (error) throw error
      if (authEventSeen) return
      settled = true
      clearTimeout(timeout)
      authenticatedSession.current = s != null
      currentUserIdRef.current = s?.user.id ?? null
      currentAccessTokenRef.current = s?.access_token ?? null
      setSession(s)
      setSessionLikely(s != null)
      AsyncStorage.setItem(HAD_SESSION_KEY, s ? '1' : '0').catch(() => {})
      if (s?.user) {
        setProfile((previous) => previous?.id === s.user.id ? previous : null)
        setAuthSkipped(false)
        AsyncStorage.removeItem(AUTH_SKIPPED_KEY).catch(() => {})
        void loadProfile(s.user.id)
      } else {
        profileRequestId.current += 1
        setProfile(null)
      }
      setLoading(false)
      analytics.track(EVENTS.OPERATION_COMPLETED, {
        operation: 'auth_session_load',
        duration_ms: Date.now() - sessionLoadStartedAt,
        had_session: s != null,
      })
    }).catch(async (error) => {
      if (!active) return
      analytics.error('auth_session_load', error, { duration_ms: Date.now() - sessionLoadStartedAt })
      if (!active || authEventSeen) return
      const had = await withTimeout(
        AsyncStorage.getItem(HAD_SESSION_KEY),
        SESSION_GATE_TIMEOUT_MS,
      ).catch(() => null)
      if (!active || authEventSeen) return
      settled = true
      clearTimeout(timeout)
      const revoked = isAccountAccessRevoked(error)
      setSessionLikely(!revoked && had === '1')
      if (revoked) AsyncStorage.setItem(HAD_SESSION_KEY, '0').catch(() => {})
      setLoading(false)
    })

    // セッション変化を購読
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        // 初期状態は上の getSession で確定する。SecureStore の読取エラー時も
        // Supabase は INITIAL_SESSION(null) を発火するため、ここで処理すると
        // 前回セッションありのフォールバックを誤って消してしまう。
        if (!active || event === 'INITIAL_SESSION') return
        authEventSeen = true
        settled = true
        clearTimeout(timeout)
        authenticatedSession.current = s != null
        currentUserIdRef.current = s?.user.id ?? null
        currentAccessTokenRef.current = s?.access_token ?? null
        setSession(s)
        setSessionLikely(s != null)
        AsyncStorage.setItem(HAD_SESSION_KEY, s ? '1' : '0').catch(() => {})
        if (s?.user) {
          setProfile((previous) => previous?.id === s.user.id ? previous : null)
          setAuthSkipped(false)
          AsyncStorage.removeItem(AUTH_SKIPPED_KEY).catch(() => {})
          void loadProfile(s.user.id)
        } else {
          profileRequestId.current += 1
          setProfile(null)
        }
        setLoading(false)
      }
    )
    return () => {
      active = false
      profileRequestId.current += 1
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [loadProfile])

  useEffect(() => {
    if (!session?.access_token) return
    const expectedUserId = session.user.id
    const expectedToken = session.access_token
    let active = true
    let checking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const isCurrent = () => active && currentUserIdRef.current === expectedUserId
      && currentAccessTokenRef.current === expectedToken

    const check = async () => {
      if (checking || !isCurrent() || sessionEndInFlightRef.current
        || AppState.currentState === 'background' || AppState.currentState === 'inactive') return
      checking = true
      try {
        await validateAccountAccess(session)
      } catch (error) {
        if (!isCurrent() || !isAccountAccessRevoked(error) || sessionEndInFlightRef.current) return
        sessionEndInFlightRef.current = true
        setIsEndingSession(true)
        authenticatedSession.current = false
        currentUserIdRef.current = null
        currentAccessTokenRef.current = null
        profileRequestId.current += 1
        setSession(null)
        setProfile(null)
        setSessionLikely(false)
        AsyncStorage.setItem(HAD_SESSION_KEY, '0').catch(() => {})
        // 通信障害とは区別し、失効した認証だけ閉じる。未同期の端末データは保持する。
        try {
          await clearLocalSession()
        } catch (clearError) {
          analytics.error('revoked_session_cleanup', clearError)
        } finally {
          sessionEndInFlightRef.current = false
          setIsEndingSession(false)
        }
      } finally {
        checking = false
      }
    }
    const tick = () => {
      void check()
      timer = setTimeout(tick, 60_000)
    }
    tick()
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void check()
    })
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      subscription.remove()
    }
  }, [session])

  useEffect(() => {
    if (loading) return

    const nextUserId = session?.user.id ?? null
    analytics.setContext({
      authenticated: nextUserId != null,
      plan_tier: profile?.tier ?? 'guest',
    })
    const previousUserId = analyticsUserId.current
    if (previousUserId === nextUserId) return
    analyticsUserId.current = nextUserId

    void initAnalytics(nextUserId ?? undefined).then(() => {
      if (previousUserId === undefined) {
        void trackAppOpened()
      } else if (nextUserId) {
        analytics.track(EVENTS.AUTH_SIGNED_IN)
      } else {
        analytics.track(EVENTS.AUTH_SIGNED_OUT)
        analytics.reset()
      }
    })
  }, [loading, profile?.tier, session?.user.id])

  // ログイン画面に「前回はこの方法で入った」を出すため、成功した方法だけを端末に控える。
  // 画面側ではなくここに置く（入口が増えても控え漏れが出ない）
  const signUp = useCallback(async (email: string, password: string) => {
    if (sessionEndInFlightRef.current) throw new Error('AUTH_OPERATION_IN_PROGRESS')
    const data = await signUpWithEmail(email, password)
    // 確認メール待ちでも、次に入るときはメールの方法で合っている
    await rememberAuthMethod('email')
    return data.session != null
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    if (sessionEndInFlightRef.current) throw new Error('AUTH_OPERATION_IN_PROGRESS')
    await signInWithEmail(email, password)
    await rememberAuthMethod('email')
  }, [])

  const signInGoogle = useCallback(async () => {
    if (sessionEndInFlightRef.current) throw new Error('AUTH_OPERATION_IN_PROGRESS')
    const res = await signInWithGoogle()
    // キャンセル（res == null）は控えない
    if (res != null) await rememberAuthMethod('google')
    return res != null
  }, [])

  const signInApple = useCallback(async () => {
    if (sessionEndInFlightRef.current) throw new Error('AUTH_OPERATION_IN_PROGRESS')
    await signInWithApple()
    await rememberAuthMethod('apple')
  }, [])

  const skipAuth = useCallback(async () => {
    if (sessionEndInFlightRef.current) throw new Error('AUTH_OPERATION_IN_PROGRESS')
    setAuthSkipped(true)
    await AsyncStorage.setItem(AUTH_SKIPPED_KEY, '1').catch(() => {})
  }, [])

  const signInPasskey = useCallback(async () => {
    if (sessionEndInFlightRef.current) throw new Error('AUTH_OPERATION_IN_PROGRESS')
    await signInWithPasskey()
    await rememberAuthMethod('passkey')
  }, [])

  const logOut = useCallback(async ({ discardUnsaved = false }: { discardUnsaved?: boolean } = {}) => {
    const userId = session?.user.id
    if ((userId ?? null) !== currentUserIdRef.current) throw new Error('AUTH_ACCOUNT_CHANGED')
    if (sessionEndInFlightRef.current) throw new Error('AUTH_OPERATION_IN_PROGRESS')
    sessionEndInFlightRef.current = true
    try {
      if (!discardUnsaved) {
        // このあと端末のデータを消すので、控えが取れたと確かめられたときだけ進む。
        // 圏外で控えが失敗しても消していたため、前回の自動バックアップ以降の変更が
        // 黙って失われていた。止めっぱなしにもしない（圏外でログアウトできなくなる）—
        // 画面が理由を見せて、本人が消すと決めたら discardUnsaved で呼び直す
        let result: Awaited<ReturnType<typeof saveAccountSnapshotNow>> | 'failed' = 'failed'
        if (userId) {
          try {
            result = await saveAccountSnapshotNow(userId, { freshAfterPending: true })
          } catch (error) {
            analytics.error('logout_snapshot', error)
          }
        }
        if (result !== 'done' && result !== 'empty') {
          throw Object.assign(new Error('LOGOUT_BACKUP_FAILED'), { logoutBackup: result })
        }
      }
      if ((userId ?? null) !== currentUserIdRef.current) throw new Error('AUTH_ACCOUNT_CHANGED')
      // SIGNED_OUT は消去より先に届く。完了前に次のログイン画面を出さない。
      setIsEndingSession(true)
      // 消したデスクの後始末（公開データ・写真の削除）が残っていれば、ログインが外れる前に済ませる。
      // このあと端末のデータと一緒に控えも消えるので、残すとサーバーに非公開のデスクと写真が残り続ける
      await withTimeout(resumePendingDeskCleanups(Number.POSITIVE_INFINITY), 10_000).catch(() => {})
      // 圏外で待たせない。外せなくても次にログインした人の登録が token ごと上書きする
      await withTimeout(unregisterPushToken(), 3000).catch(() => {})
      if ((userId ?? null) !== currentUserIdRef.current) throw new Error('AUTH_ACCOUNT_CHANGED')
      await signOut()
      // 印を残したままだとログアウト後もそのまま本編に居座り、ログイン画面に戻れない
      setAuthSkipped(false)
      await AsyncStorage.removeItem(AUTH_SKIPPED_KEY).catch(() => {})
      profileRequestId.current += 1
      authenticatedSession.current = false
      currentUserIdRef.current = null
      setSession(null)
      setSessionLikely(false)
      setProfile(null)
      await AsyncStorage.setItem(HAD_SESSION_KEY, '0').catch(() => {})
      // 共有端末で別アカウントにログインしたとき前のユーザーのデータが
      // 残らないよう、ローカルキャッシュ・AsyncStorageを一掃する
      await clearLocalUserData().catch(() => {})
    } finally {
      sessionEndInFlightRef.current = false
      setIsEndingSession(false)
    }
  }, [session?.user.id])

  const finishAccountDeletion = useCallback(async () => {
    if (currentUserIdRef.current !== null && (session?.user.id ?? null) !== currentUserIdRef.current) throw new Error('AUTH_ACCOUNT_CHANGED')
    if (sessionEndInFlightRef.current) throw new Error('AUTH_OPERATION_IN_PROGRESS')
    sessionEndInFlightRef.current = true
    setIsEndingSession(true)
    try {
      await clearLocalSession()
      if (currentUserIdRef.current !== null && currentUserIdRef.current !== (session?.user.id ?? null)) throw new Error('AUTH_ACCOUNT_CHANGED')
      profileRequestId.current += 1
      authenticatedSession.current = false
      currentUserIdRef.current = null
      setSession(null)
      setSessionLikely(false)
      setProfile(null)
      setAuthSkipped(false)
      await Promise.all([
        AsyncStorage.setItem(HAD_SESSION_KEY, '0').catch(() => {}),
        AsyncStorage.removeItem(AUTH_SKIPPED_KEY).catch(() => {}),
      ])
      await clearLocalUserData().catch(() => {})
    } finally {
      sessionEndInFlightRef.current = false
      setIsEndingSession(false)
    }
  }, [session?.user.id])

  const signOutKeepingLocalData = useCallback(async () => {
    const userId = session?.user.id ?? null
    if (userId !== currentUserIdRef.current) throw new Error('AUTH_ACCOUNT_CHANGED')
    if (sessionEndInFlightRef.current) throw new Error('AUTH_OPERATION_IN_PROGRESS')
    sessionEndInFlightRef.current = true
    try {
      // 圏外で待たせない。外せなくても次にログインした人の登録が token ごと上書きする
      await withTimeout(unregisterPushToken(), 3000).catch(() => {})
      if (userId !== currentUserIdRef.current) throw new Error('AUTH_ACCOUNT_CHANGED')
      await signOut()
      profileRequestId.current += 1
      authenticatedSession.current = false
      currentUserIdRef.current = null
      setSession(null)
      setSessionLikely(false)
      setProfile(null)
      await AsyncStorage.setItem(HAD_SESSION_KEY, '0').catch(() => {})
    } finally {
      sessionEndInFlightRef.current = false
    }
  }, [session?.user.id])

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id)
  }, [session, loadProfile])

  return (
    <AuthContext.Provider value={{
      session,
      user:    session?.user ?? null,
      profile,
      loading: loading || isEndingSession,
      sessionLikely,
      authSkipped,
      skipAuth,
      signUp,
      signIn,
      signInGoogle,
      signInApple,
      signInPasskey,
      logOut,
      signOutKeepingLocalData,
      finishAccountDeletion,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth は AuthProvider の内側で使用してください')
  return ctx
}
