import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { POSTHOG_HOST, POSTHOG_KEY } from '../constants/plans'
import {
  attributionProperties,
  parseStoredAttribution,
  parseUtmAttribution,
  UTM_FIELDS,
  UtmAttribution,
} from '../utils/analyticsAttribution'
import { captureCrash } from './crashReporting'
import { deferredAnalyticsAction } from '../utils/analyticsDeferred'
import { sanitizeAnalyticsProperties } from '../utils/analyticsProperties'
import { isAffiliateUrl } from '../utils/url'
import { recordFailure } from '../utils/diagnosticTrail'
import { secureHttpUrl } from '../utils/secureTransport'

const appConfig = require('../../app.json') as { expo?: { version?: string } }

const ANALYTICS_CONSENT_KEY = '@analytics_consent'
// 前回起動したときのアプリバージョン。SDK の Application Installed / Updated を
// 止めた代わりに、初回起動と更新の判定をこれで行う。
const LAST_APP_VERSION_KEY = '@analytics_app_version'
const PENDING_APP_OPENED_KEY = '@analytics_pending:app_opened'
const FIRST_ATTRIBUTION_KEY = '@analytics_attribution:first'
const LAST_ATTRIBUTION_KEY = '@analytics_attribution:last'
const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

let posthog: any = null
let initialization: Promise<void> | null = null
let consent: boolean | null = null
// 直近に identify したユーザー。オプトアウトの reset() で distinct_id が匿名へ
// 戻るため、オプトインし直したときに結び付け直す先として覚えておく。
// AuthContext は userId が変わらないかぎり initAnalytics を呼び直さないので、
// ここで持っていないと同じ人がずっと別人として数えられる。
let lastUserId: string | null = null
let firstAttribution: UtmAttribution | null = null
let lastAttribution: UtmAttribution | null = null
let attributionUpdateQueue: Promise<void> = Promise.resolve()
let appOpenedTracking: Promise<void> | null = null
let commonProperties: Record<string, unknown> = {
  platform: Platform.OS,
  platform_version: String(Platform.Version),
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  environment: __DEV__ ? 'development' : 'production',
  app_version: appConfig.expo?.version ?? 'unknown',
  session_id: sessionId,
}
const pendingCalls: Array<(client: any) => void> = []

function currentAttributionProperties(): Record<string, string> {
  return attributionProperties(firstAttribution, lastAttribution)
}

function updateCommonAttributionProperties(): void {
  commonProperties = Object.fromEntries(
    Object.entries(commonProperties).filter(([key]) => !/^(first|last)_(utm_|attributed_at$)/.test(key)),
  )
  commonProperties = { ...commonProperties, ...currentAttributionProperties() }
}

async function loadStoredAttribution(): Promise<void> {
  const [first, last] = await Promise.all([
    AsyncStorage.getItem(FIRST_ATTRIBUTION_KEY).catch(() => null),
    AsyncStorage.getItem(LAST_ATTRIBUTION_KEY).catch(() => null),
  ])
  // Deep Link処理と初期化は起動時に並行しうる。読み込み中に新しいUTMを受けた場合、
  // ストレージから先に読んだ古い値でメモリ上の最新値を上書きしない。
  firstAttribution ??= parseStoredAttribution(first)
  lastAttribution ??= parseStoredAttribution(last)
  updateCommonAttributionProperties()
}

function identifyWithAttribution(client: any, userId: string, props?: Record<string, unknown>): void {
  const all = currentAttributionProperties()
  const first = Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith('first_')))
  const last: Record<string, unknown> = Object.fromEntries(
    UTM_FIELDS.map((field) => [`last_${field}`, lastAttribution?.[field] ?? null]),
  )
  last.last_attributed_at = lastAttribution?.captured_at ?? null
  client.identify?.(userId, {
    $set: { ...props, ...last },
    $set_once: first,
  })
}

export async function getAnalyticsConsent(): Promise<boolean> {
  if (consent != null) return consent
  const stored = await AsyncStorage.getItem(ANALYTICS_CONSENT_KEY).catch(() => null)
  // 未選択の利用者から第三者分析サービスへ送らない。設定画面で明示的に
  // 有効化した場合だけ送信し、主要機能は選択にかかわらず利用できる。
  consent = stored === 'true'
  return consent
}

/** 許可・拒否のどちらかを一度でも選んだか。未選択の人にだけ初回の選択画面を出す */
export async function hasAnalyticsChoice(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(ANALYTICS_CONSENT_KEY).catch(() => null)
  return stored === 'true' || stored === 'false'
}

export async function setAnalyticsConsent(enabled: boolean): Promise<void> {
  const changed = consent !== enabled
  // 何よりも先に倒す。await を1つでも挟むと、その待ち時間のあいだ safe() が
  // 素通しのままになり、裏で起きた画面遷移などがオプトアウト後に送られてしまう。
  consent = enabled

  await AsyncStorage.setItem(ANALYTICS_CONSENT_KEY, String(enabled)).catch(() => {})
  if (enabled && !posthog) await initAnalytics(lastUserId ?? undefined)
  if (posthog) {
    if (enabled) {
      posthog.optIn?.()
      // オプトアウト時の reset() で distinct_id が匿名に戻っている。
      // ログイン中なら結び付け直さないと、同じ人が以後ずっと別人として数えられる。
      if (lastUserId) identifyWithAttribution(posthog, lastUserId)
    } else {
      pendingCalls.splice(0)
      // 順序を入れ替えてはいけない。
      // reset() は keep リスト（InstalledAppBuild / InstalledAppVersion / DeviceId /
      // RemoteConfig / SessionReplay / Surveys / 各キュー）以外の永続プロパティを
      // すべて null にする。OptedOut はその keep リストに入っていないため、
      // optOut() を先に呼ぶと直後の reset() でオプトアウトが取り消される
      // （optedOut の判定が `getPersistedProperty(OptedOut) ?? !defaultOptIn`
      // ＝ null のとき false に落ちる）。
      // safe() が止めるのは自前の track/screen だけで、SDK 内蔵の
      // Application Opened / Backgrounded / Became Active は SDK 側の
      // オプトアウトでしか止まらない。
      posthog.reset?.()
      posthog.optOut?.()
    }
  }
  // オプトインは逆に optIn() の後。先に送ると PostHog 側で破棄される
  if (changed && enabled) analytics.track(EVENTS.ANALYTICS_CONSENT_CHANGED, { consent: true })
  if (enabled) await flushDeferredAnalytics()
}

export async function initAnalytics(userId?: string): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      try {
        await getAnalyticsConsent()
        await loadStoredAttribution()
        const { PostHog } = await import('posthog-react-native')
        if (!POSTHOG_KEY || POSTHOG_KEY.startsWith('phc_REPLACE')) return
        // 上の非同期処理中に設定スイッチが変わりうるため、開始時に読んだ値ではなく
        // SDK生成直前の最新値を使う。この後optIn/optOutまではawaitを挟まない。
        const enabled = consent === true
        posthog = new PostHog(POSTHOG_KEY, {
          host: secureHttpUrl(POSTHOG_HOST).href.replace(/\/$/, ''),
          // SDK 内蔵のライフサイクル記録は使わない。
          // ・Application Opened は自前の app_opened と二重に起動を数えるだけ
          //   （しかも app_opened の方が plan_tier などの共通プロパティを持つ）
          // ・Became Active / Backgrounded はアプリを切り替えるたびに増える割に
          //   読み取れることがほとんど無い
          // ・Installed / Updated の判定は trackAppOpened() が肩代わりする
          // 起動あたりのイベント数がこれで目に見えて減る。
          captureAppLifecycleEvents: false,
          // 現在はFeature Flagsを使っていない。identify時の不要な /flags 通信と
          // フラグ評価イベントを発生させない。
          disableRemoteFeatureFlags: true,
          preloadFeatureFlags: false,
          sendFeatureFlagEvent: false,
          // 国・地域はプロダクト判断に使わないため、IP由来の位置情報を生成しない。
          disableGeoip: true,
          // オプトアウト中の人はコンストラクタの時点で止める。生成後に optOut() を
          // 呼ぶ形だと、初期化の中で送られるものを取りこぼす。defaultOptIn:false なら
          // 永続プロパティが空でもオプトアウト扱いになる。
          ...(enabled ? {} : { defaultOptIn: false }),
        })
        if (enabled) {
          posthog.optIn?.()
          pendingCalls.splice(0).forEach((call) => call(posthog))
        } else {
          pendingCalls.splice(0)
          posthog.optOut?.()
        }
        if (enabled) await flushDeferredAnalytics()
      } catch {
        pendingCalls.splice(0)
        // 端末ストレージ等の一時エラーで初期化が失敗しても、同意切替や次の
        // 認証イベントから再試行できるよう失敗済みPromiseを固定しない。
        initialization = null
      }
    })()
  }

  await initialization
  // オプトアウト中でも覚えておく。オンに戻したときの結び付け先になる
  if (userId) lastUserId = userId
  if (userId && consent !== false && posthog) identifyWithAttribution(posthog, userId)
}

/**
 * Deep Linkから管理対象のUTMだけを保存し、初回流入と直近流入を分けて記録する。
 * URL、desk ID、認証トークン、UTM以外のクエリは保存・送信しない。
 */
export function recordAttributionFromUrl(url: string): Promise<boolean> {
  const attribution = parseUtmAttribution(url)
  if (!attribution) return Promise.resolve(false)

  // getInitialURLとwarm link通知、または短時間の複数リンクが重なっても、first touchの
  // 判定とlast touchの保存順が逆転しないよう、更新処理だけを直列化する。
  const task = attributionUpdateQueue.then(() => recordAttribution(attribution))
  attributionUpdateQueue = task.then(() => undefined, () => undefined)
  return task
}

async function recordAttribution(attribution: UtmAttribution): Promise<boolean> {
  let isFirstTouch = false
  if (!firstAttribution) {
    const stored = await AsyncStorage.getItem(FIRST_ATTRIBUTION_KEY).catch(() => null)
    const parsedStored = parseStoredAttribution(stored)
    firstAttribution = parsedStored ?? attribution
    if (!parsedStored) {
      isFirstTouch = true
      await AsyncStorage.setItem(FIRST_ATTRIBUTION_KEY, JSON.stringify(firstAttribution)).catch(() => {})
    }
  }
  lastAttribution = attribution
  await AsyncStorage.setItem(LAST_ATTRIBUTION_KEY, JSON.stringify(attribution)).catch(() => {})
  updateCommonAttributionProperties()

  analytics.track(EVENTS.ATTRIBUTION_CAPTURED, {
    touch_type: isFirstTouch ? 'first_touch' : 'return_touch',
    ...Object.fromEntries(UTM_FIELDS.map((field) => [field, attribution[field]]).filter(([, value]) => value)),
  })
  if (lastUserId && posthog && consent !== false) identifyWithAttribution(posthog, lastUserId)
  return true
}

/**
 * 起動を1件だけ記録する。SDK の Application Opened / Installed / Updated を
 * 切っている（initAnalytics 参照）ぶん、初回起動とバージョン更新の判定はここで持つ。
 *
 * バージョンの保存はオプトアウト中でも行う。飛ばすと、次にオンへ戻した人の起動が
 * 初回インストール扱いになり、新規ユーザー数が実態より多く出る。
 */
async function trackAppOpenedOnce(): Promise<void> {
  const current = String(commonProperties.app_version ?? 'unknown')
  const previous = await AsyncStorage.getItem(LAST_APP_VERSION_KEY).catch(() => null)
  if (previous !== current) {
    await AsyncStorage.setItem(LAST_APP_VERSION_KEY, current).catch(() => {})
  }
  const props = {
    launch_kind: previous == null ? 'first_launch' : previous === current ? 'normal' : 'update',
    ...(previous && previous !== current ? { previous_version: previous } : {}),
  }
  if (!(await getAnalyticsConsent())) {
    // 初回起動時は未同意が通常なので、同意前に第三者へは送らず、最初の起動区分だけ
    // 端末内へ保留する。後から同意したときに normal へ化けないよう既存値を優先する。
    const pending = await AsyncStorage.getItem(PENDING_APP_OPENED_KEY).catch(() => null)
    if (!pending) {
      await AsyncStorage.setItem(PENDING_APP_OPENED_KEY, JSON.stringify(props)).catch(() => {})
    }
    return
  }
  analytics.track(EVENTS.APP_OPENED, props)
}

export function trackAppOpened(): Promise<void> {
  appOpenedTracking ??= trackAppOpenedOnce()
  return appOpenedTracking
}

function safe(fn: (client: any) => void) {
  if (consent === false) return
  try {
    if (posthog) fn(posthog)
    else if (POSTHOG_KEY && pendingCalls.length < 100) pendingCalls.push(fn)
  } catch { /* analytics must never break the app */ }
}

function eventProperties(props?: Record<string, unknown>) {
  return sanitizeAnalyticsProperties({ ...commonProperties, ...props })
}

export function errorProperties(error: unknown): Record<string, unknown> {
  // メッセージ本文はユーザーの入力値やURLが混ざりうるので送らない。
  // 一方でコードは固定の識別子なので、これが無いと課金の失敗理由を特定できない
  const e = error as { code?: unknown; userCancelled?: unknown; userInfo?: { readableErrorCode?: unknown } }
  const code = e?.userInfo?.readableErrorCode ?? e?.code
  return {
    error_name: error instanceof Error ? error.name : typeof error,
    ...(code != null ? { error_code: String(code) } : {}),
    ...(e?.userCancelled != null ? { user_cancelled: !!e.userCancelled } : {}),
  }
}

export function linkProperties(url: string): Record<string, unknown> {
  try {
    const parsed = new URL(url)
    const affiliate = isAffiliateUrl(url)
    // 商品マスタにリンクが無くて検索結果へ逃がした分。実リンクと混ぜると
    // 「解決できている」ように見えてデータの穴に気づけない
    const search = parsed.hostname === 'search.rakuten.co.jp'
      || (parsed.hostname.includes('amazon.') && parsed.pathname === '/s')
    return {
      link_host: parsed.hostname,
      link_type: search ? 'search_fallback' : affiliate ? 'affiliate' : 'official_or_direct',
    }
  } catch {
    return { link_host: 'invalid', link_type: 'invalid' }
  }
}

export const analytics = {
  track(event: AnalyticsEventName, props?: Record<string, unknown>) {
    // 同意の有無に関係なく端末内にだけ残す。送るのはフィードバックで本人が添付を選んだときだけ
    if (event.endsWith('_failed')) recordFailure(event, props)
    safe((client) => client.capture(event, eventProperties(props)))
  },
  identify(userId: string, props?: Record<string, unknown>) {
    safe((client) => identifyWithAttribution(client, userId, props))
  },
  screen(name: string, props?: Record<string, unknown>) {
    safe((client) => client.screen(name, eventProperties(props)))
  },
  setContext(props: Record<string, unknown>) {
    commonProperties = { ...commonProperties, ...props }
  },
  error(operation: string, error: unknown, props?: Record<string, unknown>) {
    this.track(EVENTS.OPERATION_FAILED, { operation, ...errorProperties(error), ...props })
    captureCrash(error, operation)
  },
  reset() {
    // サインアウト。次にオプトインしても前の人に結び付けない
    lastUserId = null
    safe((client) => client.reset())
  },
}

// ─── 初回だけ記録するイベント ────────────────────────────────────
//
// 「最初の1台を登録した」「最初の配線図を見た」は、何回起きたかではなく
// そこへ到達したかを見たい。毎回送ると2回目以降のほうが多くなり、
// 初回導線の通過率が読めなくなるので、端末に印を残して1回に絞る。
//
// 印はアカウントではなく端末に持つ（ログイン前に到達しうるため）。
// clearLocalUserData では消さない ── ログアウトのたびに「初回」が復活すると
// 通過率が水増しされる。
const ONCE_KEY_PREFIX = '@analytics_once:'
const PENDING_ONCE_KEY_PREFIX = '@analytics_pending_once:'
const sentOnce = new Set<string>()
const onceInFlight = new Map<AnalyticsEventName, Promise<void>>()

const DEFERRED_MILESTONE_EVENTS = [
  'first_item_added',
  'first_result_viewed',
  'first_personalized_result_viewed',
  'first_public_desk_viewed',
] as const

async function flushDeferredAnalytics(): Promise<void> {
  if (consent !== true || !posthog) return

  const pendingAppOpened = await AsyncStorage.getItem(PENDING_APP_OPENED_KEY).catch(() => null)
  if (pendingAppOpened) {
    try {
      const props = JSON.parse(pendingAppOpened) as Record<string, unknown>
      analytics.track(EVENTS.APP_OPENED, { ...props, deferred_until_consent: true })
      await AsyncStorage.removeItem(PENDING_APP_OPENED_KEY).catch(() => {})
    } catch {
      await AsyncStorage.removeItem(PENDING_APP_OPENED_KEY).catch(() => {})
    }
  }

  for (const event of DEFERRED_MILESTONE_EVENTS) {
    const sentKey = ONCE_KEY_PREFIX + event
    const pendingKey = PENDING_ONCE_KEY_PREFIX + event
    const [alreadySent, pending] = await Promise.all([
      AsyncStorage.getItem(sentKey).catch(() => null),
      AsyncStorage.getItem(pendingKey).catch(() => null),
    ])
    if (alreadySent || !pending) {
      if (alreadySent && pending) await AsyncStorage.removeItem(pendingKey).catch(() => {})
      continue
    }
    try {
      const props = JSON.parse(pending) as Record<string, unknown>
      await AsyncStorage.setItem(sentKey, '1')
      sentOnce.add(event)
      analytics.track(event, { ...props, deferred_until_consent: true })
      await AsyncStorage.removeItem(pendingKey).catch(() => {})
    } catch {
      // 壊れた保留値は送らず、次回以降も詰まらないよう破棄する。
      await AsyncStorage.removeItem(pendingKey).catch(() => {})
    }
  }
}

async function trackOnceInternal(event: AnalyticsEventName, props?: Record<string, unknown>): Promise<void> {
  if (sentOnce.has(event)) return
  const enabled = await getAnalyticsConsent()
  try {
    const key = ONCE_KEY_PREFIX + event
    const action = deferredAnalyticsAction(enabled, !!(await AsyncStorage.getItem(key)))
    if (action === 'ignore') return
    if (action === 'defer') {
      // 同意前に送信済みフラグを消費すると、後から同意してもActivationが永久に
      // 欠落する。第三者送信はせず、初回到達の最小プロパティだけ端末内へ保留する。
      await AsyncStorage.setItem(PENDING_ONCE_KEY_PREFIX + event, JSON.stringify(props ?? {}))
      return
    }
    await AsyncStorage.setItem(key, '1')
  } catch {
    // 読めない・書けないときは記録を優先する（重複はダッシュボード側で丸められる）
  }
  sentOnce.add(event)
  analytics.track(event, props)
}

export function trackOnce(event: AnalyticsEventName, props?: Record<string, unknown>): Promise<void> {
  const existing = onceInFlight.get(event)
  if (existing) return existing
  const task = trackOnceInternal(event, props).finally(() => {
    if (onceInFlight.get(event) === task) onceInFlight.delete(event)
  })
  onceInFlight.set(event, task)
  return task
}

/**
 * プラン上限で操作が実際に止まった瞬間に記録する。
 *
 * paywall_viewed だけでは「自分から料金を見に来た人」と「壁にぶつかった人」を
 * 区別できず、どの上限が何個目で効いているかも残らない。判定に使った現在値と
 * 上限値をここで一緒に送る。
 *
 * レンダー中の条件分岐（ボタンを出すか否かの判定）からは呼ばないこと。
 * 再描画のたびに送られて件数が意味を失う。
 */
export function trackLimitHit(
  limitKey: string,
  props: { current?: number; max?: number; placement: string },
): void {
  analytics.track(EVENTS.LIMIT_HIT, { limit_key: limitKey, ...props })
}

export const EVENTS = {
  APP_OPENED:                    'app_opened',
  APP_READY:                     'app_ready',
  APP_INTERACTIVE:               'app_interactive',
  AUTH_SIGNED_IN:                'auth_signed_in',
  AUTH_SIGNED_OUT:               'auth_signed_out',
  AUTH_ATTEMPTED:                'auth_attempted',
  AUTH_SUCCEEDED:                'auth_succeeded',
  AUTH_FAILED:                   'auth_failed',
  PASSWORD_RESET_REQUESTED:      'password_reset_requested',
  // 登録直後の名乗り（061）。飛ばせない画面なので、ここで何人が止まるかを見る
  PROFILE_SETUP_SHOWN:           'profile_setup_shown',
  PROFILE_SETUP_COMPLETED:       'profile_setup_completed',
  PROFILE_SETUP_FAILED:          'profile_setup_failed',
  ONBOARDING_STARTED:            'onboarding_started',
  ONBOARDING_INTRO_COMPLETED:    'onboarding_intro_completed',
  ONBOARDING_COMPLETED:          'onboarding_completed',
  TUTORIAL_STARTED:              'tutorial_started',
  TUTORIAL_STEP_VIEWED:          'tutorial_step_viewed',
  TUTORIAL_COMPLETED:            'tutorial_completed',
  TUTORIAL_SKIPPED:              'tutorial_skipped',
  // 初回だけ記録する到達点。画面表示数ではなく「最初の成果」を見るため
  FIRST_ITEM_ADDED:              'first_item_added',
  FIRST_RESULT_VIEWED:           'first_result_viewed',
  FIRST_PERSONALIZED_RESULT_VIEWED: 'first_personalized_result_viewed',
  FIRST_PUBLIC_DESK_VIEWED:      'first_public_desk_viewed',
  PRODUCT_SEARCH_COMPLETED:      'product_search_completed',
  PRODUCT_SEARCH_FAILED:         'product_search_failed',
  PRODUCT_SUGGESTION_SELECTED:   'product_suggestion_selected',
  AFFILIATE_URL_RESOLVED:        'affiliate_url_resolved',
  AFFILIATE_URL_RESOLUTION_FAILED:'affiliate_url_resolution_failed',
  AFFILIATE_LINK_DISPLAYED:      'affiliate_link_displayed',
  AFFILIATE_LINK_OPENED:         'affiliate_link_opened',
  AFFILIATE_LINK_OPEN_FAILED:    'affiliate_link_open_failed',
  GADGET_CREATED:                'gadget_created',
  GADGET_UPDATED:                'gadget_updated',
  GADGET_DELETED:                'gadget_deleted',
  PAYWALL_VIEWED:                'paywall_viewed',
  PAYWALL_PLAN_SELECTED:         'paywall_plan_selected',
  PURCHASE_STARTED:              'purchase_started',
  PAYWALL_PURCHASED:             'paywall_purchased',
  PURCHASE_FAILED:               'purchase_failed',
  PURCHASE_CANCELLED:            'purchase_cancelled',
  // 決済は成立したのに entitlement が付かなかった場合。RevenueCat の設定漏れ
  // （サンドボックス許可リスト・entitlement への商品未紐づけ）で起きる
  PURCHASE_ENTITLEMENT_MISSING:  'purchase_entitlement_missing',
  // RevenueCat の entitlement と profiles.tier が食い違っている。
  // ほぼ確実に RevenueCat Webhook（supabase/functions/revenuecat-webhook）が
  // 届いていないことを意味する。サーバー判定の機能（AI枠・自動バックアップ）だけ
  // Free のままになるため、件数が出たら Webhook の設定を疑う
  TIER_MISMATCH_DETECTED:        'tier_mismatch_detected',
  PAYWALL_DISMISSED:             'paywall_dismissed',
  FEEDBACK_SUBMITTED:            'feedback_submitted',
  FEEDBACK_FAILED:               'feedback_failed',
  REVIEW_PROMPT_OPENED:          'review_prompt_opened',
  PURCHASE_RESTORE_STARTED:      'purchase_restore_started',
  PURCHASE_RESTORED:             'purchase_restored',
  // 復元は成功したが、復元できる購入が無かった。成功と混ぜると
  // 「復元できた」件数が水増しされる
  PURCHASE_RESTORE_EMPTY:        'purchase_restore_empty',
  PURCHASE_RESTORE_FAILED:       'purchase_restore_failed',
  DESK_CREATED:                  'desk_created',
  DESK_UPDATED:                  'desk_updated',
  DESK_DELETED:                  'desk_deleted',
  WIRING_GENERATION_COMPLETED:   'wiring_generation_completed',
  WIRING_GENERATION_FAILED:      'wiring_generation_failed',
  DESK_SHARED:                   'desk_shared',
  SHARE_CARD_COPIED:             'share_card_url_copied',
  // source 付き。「他人のデスクを見る」需要が作成につながっているかは、
  // 入口別の閲覧数と、そこから下の CREATE_STARTED / FIRST_RESULT_VIEWED の
  // 落ち方を並べないと判断できない
  PUBLIC_PAGE_VIEWED:            'public_page_viewed',
  // 公開デスクの「同じ用途で自分のデスクを作る」を押した
  PUBLIC_DESK_CREATE_STARTED:    'public_desk_create_started',
  // みんなのデスク（公開デスク一覧）を開いた
  DESK_FEED_VIEWED:              'desk_feed_viewed',
  // 用途チップで絞り込んだ。押されないなら、探す軸が用途ではないということ
  DESK_FEED_FILTERED:            'desk_feed_filtered',
  // 更新一覧（ベル）を開いた。unread_count 付き。0 が続くなら、
  // 点が出ていないのにベルを押されている＝ベルの位置が誤解されている
  DESK_UPDATES_VIEWED:           'desk_updates_viewed',
  VISIBILITY_CHANGED:            'desk_visibility_changed',
  GROWTH_RECORDED:               'growth_recorded',
  LIMIT_HIT:                     'plan_limit_hit',
  AI_FEATURE_USED:               'ai_feature_used',
  OPERATION_COMPLETED:           'operation_completed',
  OPERATION_FAILED:              'operation_failed',
  DESK_OPENED:                   'desk_opened',
  GADGET_ENTRY_STARTED:          'gadget_entry_started',
  GADGET_ENTRY_ABANDONED:        'gadget_entry_abandoned',
  BOOKMARK_TOGGLED:              'bookmark_toggled',
  LIKE_TOGGLED:                  'like_toggled',
  GADGET_BOOKMARK_TOGGLED:       'gadget_bookmark_toggled',
  BRAND_FOLLOW_TOGGLED:          'brand_follow_toggled',
  // 投稿者のフォロー（084）。followed と placement（どこで押したか）付き
  USER_FOLLOW_TOGGLED:           'user_follow_toggled',
  BACKUP_COMPLETED:              'backup_completed',
  BACKUP_RESTORED:               'backup_restored',
  DATA_EXPORTED:                 'data_exported',
  ANALYTICS_CONSENT_CHANGED:     'analytics_consent_changed',
  DEEP_LINK_OPENED:              'deep_link_opened',
  // 通知（085）の許可ダイアログの結果。granted 付き。断られる率が高いなら聞くタイミングを見直す
  PUSH_PERMISSION_ANSWERED:      'push_permission_answered',
  // 通知を押してアプリを開いた。cold_start 付き。そのあとのデスク閲覧は public_page_viewed の source: 'push'
  PUSH_OPENED:                   'push_opened',
  ATTRIBUTION_CAPTURED:          'attribution_captured',
} as const

export type AnalyticsEventName = typeof EVENTS[keyof typeof EVENTS]
