import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { InteractionManager, Platform } from 'react-native'
import {
  PlanTier,
  RC_API_KEY_ANDROID,
  RC_API_KEY_IOS,
  RC_ENTITLEMENT_PRO,
} from '../constants/plans'
import { analytics, EVENTS } from '../services/analytics'
import { resolveSubscriptionTier } from '../utils/purchasePackages'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'
import { isOfficialPublicTag } from '../utils/publicTag'
import { useApp } from './AppContext'
import { useAuth } from './AuthContext'
import { supabase } from '../supabase/client'
import { ACCENT_COLORS_TEMPORARILY_UNLOCKED } from '../constants/accentColors'

// react-native-purchases の型（インストール後に正しく解決される）
type PurchasesPackage = any
type CustomerInfo = any

interface SubscriptionCtx {
  tier:         PlanTier
  isPro:        boolean
  isLoading:    boolean
  packages:     PurchasesPackage[]
  customerInfo: CustomerInfo | null
  /** 課金の疎通確認用。Paywall で商品が引けないときの原因表示に使う */
  lastError:    string | null
  purchase:     (pkg: PurchasesPackage) => Promise<boolean>
  /** 復元後に Pro になったか。復元対象が無かった場合と区別する */
  restore:      () => Promise<boolean>
  refresh:      () => Promise<void>
  /**
   * サーバーに RevenueCat の今の権利を取り直させる。Webhook の遅れ・不達と、イベントの出ない
   * 復元で、購入済みなのにサーバー判定の機能（AIコーチ）が止まったままになるのを直す
   */
  syncServerTier: () => Promise<void>
}

const SubscriptionContext = createContext<SubscriptionCtx | null>(null)

let purchasesConfigured = false
let purchasesUserId: string | null = null
let purchasesIdentitySync: Promise<void> = Promise.resolve()
// 正式な課金開始までは全機能を開放する。false に戻すと RevenueCat の判定へ復帰する。
const BILLING_UNLOCKED = false

// RevenueCat の顧客 ID。利用者 ID は公開デスクや写真の URL から誰でも拾え、アプリ同梱の公開キーで
// その人の購読状態まで引けてしまうので使わない（107）。profiles は本人しか読めない
async function fetchRevenueCatCustomerId(userId: string): Promise<string> {
  const { data, error } = await supabase.from('profiles').select('rc_customer_id').eq('id', userId).single()
  if (error) throw error
  if (!data?.rc_customer_id) throw new Error('RevenueCat customer id is missing')
  return data.rc_customer_id
}

function removeCustomerInfoListener(listener: (info: CustomerInfo) => void) {
  try {
    require('react-native-purchases').default.removeCustomerInfoUpdateListener(listener)
  } catch { /* 未インストールなら登録もされていない */ }
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, profile, refreshProfile } = useAuth()
  const { setAccentColorAllowed } = useApp()
  const [tier,         setTier]         = useState<PlanTier>('free')
  const [isLoading,    setIsLoading]    = useState(true)
  const [packages,     setPackages]     = useState<PurchasesPackage[]>([])
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null)
  const [customerInfoUserId, setCustomerInfoUserId] = useState<string | null | undefined>(undefined)
  const [lastError,    setLastError]    = useState<string | null>(null)
  // 食い違い検知は1セッション1回だけ。購入・復元の反映待ちが終わったら waitForServerTier が戻す
  const mismatchHandledRef = useRef(false)
  // 購入・復元から Webhook が profiles.tier を書き換えるまでの間。この間は RevenueCat が Pro・
  // DB が Free で必ず食い違うので、Webhook の不達として数えない
  const [awaitingServerTier, setAwaitingServerTier] = useState(false)
  // addCustomerInfoUpdateListener は何も返さない（解除は同じ関数を removeCustomerInfoUpdateListener へ渡す）
  const listenerRef = useRef<((info: CustomerInfo) => void) | null>(null)
  const setupGenerationRef = useRef(0)
  const currentUserIdRef = useRef(user?.id ?? null)
  currentUserIdRef.current = user?.id ?? null
  // UI のタイムアウトやアカウント切替では、進行中のストア操作を中断できない。
  const storeActionInFlightRef = useRef<{ key: string; generation: number; work: Promise<boolean> } | null>(null)
  // 非同期ループの中から最新の tier を見るための参照（state を閉じ込めると古い値になる）
  const profileTierRef = useRef<string | undefined>(undefined)
  const serverSyncRef = useRef<Promise<void> | null>(null)

  useEffect(() => {
    if (BILLING_UNLOCKED) {
      setIsLoading(false)
      return
    }
    // RevenueCat のネイティブ用キーは Web では使えない。Web で Android キーを
    // 渡すと初期化エラーになるため、課金操作はネイティブだけで有効にする。
    if (Platform.OS === 'web') {
      setTier('free')
      setCustomerInfo(null)
      setPackages([])
      setLastError(null)
      setIsLoading(false)
      return
    }
    const generation = ++setupGenerationRef.current
    mismatchHandledRef.current = false
    setAwaitingServerTier(false)
    // アカウント切替中に前ユーザーの権利を表示しない。
    setTier('free')
    setCustomerInfo(null)
    setPackages([])
    setLastError(null)
    setIsLoading(true)
    // RevenueCat の初期化はネットワークを伴うため、起動直後の描画・操作が
    // 落ち着いてから行う（課金状態が必要になるのは Paywall 等のずっと後）
    let cancelled = false
    const task = InteractionManager.runAfterInteractions(() => {
      if (!cancelled) void setup(generation)
    })
    return () => {
      cancelled = true
      task.cancel()
      if (setupGenerationRef.current === generation) setupGenerationRef.current += 1
      if (listenerRef.current) removeCustomerInfoListener(listenerRef.current)
      listenerRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function setup(generation: number) {
    if (setupGenerationRef.current !== generation || currentUserIdRef.current !== (user?.id ?? null)) return
    if (BILLING_UNLOCKED || Platform.OS === 'web') {
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    try {
      // require() で動的ロード → 未インストール時でもアプリがクラッシュしない
       
      const Purchases = require('react-native-purchases').default

      const apiKey = Platform.OS === 'ios' ? RC_API_KEY_IOS : RC_API_KEY_ANDROID
      // テスト用APIキーの場合はAsyncStorageのローカル設定にフォールバック
      if (!apiKey) {
        setLastError('API key not set')
        setIsLoading(false)
        return
      }

      if (!purchasesConfigured) {
        Purchases.configure({ apiKey })
        purchasesConfigured = true
      }
      if (!await syncPurchasesIdentity(generation)) return

      if (listenerRef.current) removeCustomerInfoListener(listenerRef.current)
      const listener = (info: CustomerInfo) => {
        if (setupGenerationRef.current === generation) handleCustomerInfo(info)
      }
      Purchases.addCustomerInfoUpdateListener(listener)
      if (setupGenerationRef.current !== generation) {
        Purchases.removeCustomerInfoUpdateListener(listener)
        return
      }
      listenerRef.current = listener
      await fetchAll(generation)
    } catch (e: any) {
      // react-native-purchases 未インストール or 設定前はfreeのまま
      if (setupGenerationRef.current !== generation) return
      setLastError(`setup: ${e?.message ?? String(e)}`)
      setIsLoading(false)
    }
  }

  async function syncPurchasesIdentity(generation: number): Promise<boolean> {
    const Purchases = require('react-native-purchases').default
    const targetUserId = user?.id ?? null
    if (currentUserIdRef.current !== targetUserId) return false
    // SDK の切替自体は直列のまま待つ。UI だけ打ち切り、遅い旧 logIn が新しい利用者を巻き戻すのを防ぐ。
    const identityUpdate = purchasesIdentitySync.catch(() => {}).then(async () => {
      if (setupGenerationRef.current !== generation || currentUserIdRef.current !== targetUserId) return
      if (targetUserId && purchasesUserId !== targetUserId) {
        await Purchases.logIn(await fetchRevenueCatCustomerId(targetUserId))
        purchasesUserId = targetUserId
      } else if (!targetUserId && purchasesUserId) {
        await Purchases.logOut()
        purchasesUserId = null
      }
    })
    purchasesIdentitySync = identityUpdate.then(() => {}, () => {})
    await withTimeout(identityUpdate, QUICK_TIMEOUT_MS)
    return setupGenerationRef.current === generation && currentUserIdRef.current === targetUserId && purchasesUserId === targetUserId
  }

  function handleCustomerInfo(info: CustomerInfo) {
    setCustomerInfoUserId(user?.id ?? null)
    setCustomerInfo(info)
    const isPro = info?.entitlements?.active?.[RC_ENTITLEMENT_PRO] != null
    setTier(isPro ? 'pro' : 'free')
  }

  async function fetchAll(generation = setupGenerationRef.current) {
    if (Platform.OS === 'web') {
      setIsLoading(false)
      return
    }
    try {
      if (generation != null && setupGenerationRef.current !== generation) return
      setIsLoading(true)
      if (!await syncPurchasesIdentity(generation)) return
       
      const Purchases = require('react-native-purchases').default
      const [infoResult, offeringsResult] = await Promise.allSettled([
        // SDK 側が返さないと isLoading が永久に立ち、Paywall の購入ボタンも
        // 無効のままになる。権利確認と商品取得は個別に打ち切り、取れた側は活かす
        withTimeout<CustomerInfo>(Purchases.getCustomerInfo(), QUICK_TIMEOUT_MS),
        withTimeout<any>(Purchases.getOfferings(), QUICK_TIMEOUT_MS),
      ])
      if (generation != null && setupGenerationRef.current !== generation) return

      const errors: string[] = []
      if (infoResult.status === 'fulfilled') {
        handleCustomerInfo(infoResult.value)
      } else {
        errors.push(`customerInfo: ${String(infoResult.reason)}`)
      }

      if (offeringsResult.status === 'fulfilled') {
        const offerings = offeringsResult.value
        const pkgs = offerings.current?.availablePackages ?? []
        setPackages(pkgs)
        if (pkgs.length === 0) errors.push(`no packages (current=${offerings.current?.identifier ?? 'null'})`)
      } else {
        setPackages([])
        errors.push(`offerings: ${String(offeringsResult.reason)}`)
      }
      setLastError(errors.length > 0 ? errors.join('; ') : null)
    } catch (e: unknown) {
      if (generation != null && setupGenerationRef.current !== generation) return
      setLastError(`billing refresh: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (generation == null || setupGenerationRef.current === generation) setIsLoading(false)
    }
  }

  // 購入・復元はストアの画面を挟む。その最中に更新リスナーが Pro の CustomerInfo を先に届けるので、
  // 反映待ちの印は呼び出す前に立てておく（あとから立てると、その一瞬で食い違いが数えられる）
  async function runStoreAction(action: () => Promise<CustomerInfo>): Promise<boolean> {
    const generation = setupGenerationRef.current
    setAwaitingServerTier(true)
    let pro = false
    try {
      if (!await syncPurchasesIdentity(generation)) return false
      const info = await action()
      if (setupGenerationRef.current !== generation) return false
      handleCustomerInfo(info)
      pro = info?.entitlements?.active?.[RC_ENTITLEMENT_PRO] != null
    } finally {
      if (setupGenerationRef.current === generation) {
        if (pro) void waitForServerTier(generation)
        else setAwaitingServerTier(false)
      }
    }
    return pro
  }

  function startStoreAction(key: string, action: () => Promise<CustomerInfo>): Promise<boolean> {
    if (Platform.OS === 'web') return Promise.resolve(false)
    const generation = setupGenerationRef.current
    const active = storeActionInFlightRef.current
    if (active) {
      if (active.key === key && active.generation === generation) return active.work
      return Promise.reject(new Error('BILLING_OPERATION_IN_PROGRESS'))
    }
    const work = runStoreAction(action)
    storeActionInFlightRef.current = { key, generation, work }
    void work.finally(() => {
      if (storeActionInFlightRef.current?.work === work) storeActionInFlightRef.current = null
    }).catch(() => {})
    return work
  }

  function purchase(pkg: PurchasesPackage): Promise<boolean> {
    if (Platform.OS === 'web') return Promise.resolve(false)
    const Purchases = require('react-native-purchases').default
    return startStoreAction(`purchase:${pkg.identifier}`, async () => (await Purchases.purchasePackage(pkg)).customerInfo)
  }

  function restore(): Promise<boolean> {
    if (Platform.OS === 'web') return Promise.resolve(false)
    const Purchases = require('react-native-purchases').default
    return startStoreAction('restore', () => Purchases.restorePurchases())
  }

  // 購入が通っても、サーバー判定の機能（AIコーチ・バックアップ世代数）は
  // RevenueCat Webhook が profiles.tier を書き換えるまで Free のまま。
  // 反映は数秒で終わることが多いが、購入直後の1回だけ profile を引き直しても
  // 間に合わないことがあるため、数回に分けて引き直す。
  // useAIUsageLimit は profile.tier の変化で自動的に取り直すので、
  // pro になった時点で画面のロックも外れる。
  async function waitForServerTier(generation: number): Promise<void> {
    try {
      for (const delay of [1500, 3000, 6000, 12000]) {
        await new Promise(resolve => setTimeout(resolve, delay))
        if (setupGenerationRef.current !== generation || profileTierRef.current === 'pro') return
        // Webhook は数秒で届くことが多いので、まず待つ。すぐ取り直させると管理画面の
        // 「アプリからの取り直し」が購入の数だけ増えて、不達の目安にならない
        if (delay === 3000) await syncServerTier()
        else await refreshProfile().catch(() => {})
      }
    } finally {
      // 待ち終わっても食い違っていれば、それは本当の不達。次の評価で1回だけ数えさせる
      if (setupGenerationRef.current === generation) {
        mismatchHandledRef.current = false
        setAwaitingServerTier(false)
      }
    }
  }

  const syncServerTier = useCallback((): Promise<void> => {
    if (BILLING_UNLOCKED || Platform.OS === 'web' || !currentUserIdRef.current) return Promise.resolve()
    if (serverSyncRef.current) return serverSyncRef.current
    const work = (async () => {
      try {
        await withTimeout(supabase.functions.invoke('sync-subscription', { method: 'POST' }), QUICK_TIMEOUT_MS)
      } catch { /* 取り直せなくても、Webhook が届けば次の refreshProfile で揃う */ }
      await refreshProfile().catch(() => {})
    })()
    serverSyncRef.current = work
    void work.finally(() => { if (serverSyncRef.current === work) serverSyncRef.current = null })
    return work
  }, [refreshProfile])
  const refreshProfileOnly = useCallback(() => refreshProfile().catch(() => {}), [refreshProfile])

  // ─── Pro 判定の一本化 ─────────────────────────────────────────
  // Pro かどうかの情報源は2つある。
  //   ・RevenueCat の entitlement（この Context の tier）
  //   ・Supabase の profiles.tier（AI枠・バックアップ世代数のサーバー判定が見る正本）
  // 本来は RevenueCat Webhook が前者を後者へ反映するので一致するが、Webhook が
  // 届いていないと片方だけ 'pro' になる。CustomerInfo取得前だけDBをフォールバックにし、
  // 取得後はRevenueCatを優先する。失効・返金後に古いDB値でProが残るのを防ぐ。
  profileTierRef.current = profile?.id === user?.id ? profile?.tier : undefined

  const serverTier = profile && profile.id === user?.id ? profile.tier : undefined
  const customerInfoCurrent = customerInfoUserId === (user?.id ?? null)
  const effectiveTier: PlanTier =
    BILLING_UNLOCKED
      ? 'pro'
      : resolveSubscriptionTier(customerInfoCurrent ? tier : 'free', customerInfoCurrent && customerInfo != null, serverTier, isOfficialPublicTag(profile?.id === user?.id ? profile?.public_tag : undefined))

  // Free では表示だけ標準色へ戻す。保存値を消すと Pro へ再ログインしても最後の色が戻らない。
  // アカウント切替中の古い CustomerInfo も Free 判定に使わない。
  useEffect(() => {
    if (ACCENT_COLORS_TEMPORARILY_UNLOCKED || BILLING_UNLOCKED || !customerInfoCurrent) {
      setAccentColorAllowed(true)
      return
    }
    if (isLoading || customerInfo == null) return
    setAccentColorAllowed(effectiveTier !== 'free')
  }, [isLoading, customerInfoCurrent, customerInfo, effectiveTier, setAccentColorAllowed])

  // 食い違いは Webhook の不達をほぼ意味する。放置するとサーバー判定の機能だけ
  // Free のままになるので、サーバーに権利を取り直させ、件数を計測へ送る。1セッション1回だけ。
  // 端末から syncPurchases は呼ばない。purchasePackage を使うアプリでは呼ばないよう SDK が
  // 明記している。取り直しはサーバーが RevenueCat の REST API から行う（sync-subscription）
  useEffect(() => {
    if (BILLING_UNLOCKED || isLoading || !user?.id || awaitingServerTier) return
    if (profile == null) return   // profile 未取得のうちは食い違いか判断できない
    // 商品一覧だけ失敗してもCustomerInfoは有効なので、権利の食い違いは検知する。
    if (!customerInfoCurrent || customerInfo == null || profile.id !== user.id) return
    const rcPro = tier === 'pro'
    const dbPro = profile.tier === 'pro'
    if (rcPro === dbPro) { mismatchHandledRef.current = false; return }
    if (mismatchHandledRef.current) return
    mismatchHandledRef.current = true
    analytics.track(EVENTS.TIER_MISMATCH_DETECTED, {
      revenuecat_tier: rcPro ? 'pro' : 'free',
      profile_tier:    dbPro ? 'pro' : 'free',
      platform:        Platform.OS,
    })
    void syncServerTier()
  }, [isLoading, tier, customerInfo, customerInfoCurrent, profile, user?.id, syncServerTier, awaitingServerTier])

  return (
    <SubscriptionContext.Provider value={{
      tier:         effectiveTier,
      isPro:        effectiveTier === 'pro',
      isLoading: isLoading || (customerInfo != null && !customerInfoCurrent),
      packages,
      customerInfo,
      lastError,
      purchase,
      restore,
      refresh:      () => setup(setupGenerationRef.current),
      // 購入・復元の直後は waitForServerTier が Webhook を待ってから取り直す。画面から先に
      // 呼ばせると、届く途中の Webhook まで取り直しとして数えてしまう
      syncServerTier: awaitingServerTier ? refreshProfileOnly : syncServerTier,
    }}>
      {children}
    </SubscriptionContext.Provider>
  )
}

export function useSubscription(): SubscriptionCtx {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) throw new Error('useSubscription must be inside SubscriptionProvider')
  return ctx
}
