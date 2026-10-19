// ─── プラン定義 ───────────────────────────────────────────────────
// 全機能制限はここで一元管理。新機能追加時はこのファイルのみ変更する。

import { decodeDeskId, encodeDeskId, isShortDeskId, isUuid } from '../utils/shortDeskId'
import { normalizePublicTag } from '../utils/publicTag'
import { isPublicTagSegment } from './siteRoutes'
import { ICONS } from './icons'

export type PlanTier = 'free' | 'pro'

export const RC_PRODUCT_MONTHLY = process.env.EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID ?? ''
export const RC_PRODUCT_YEARLY  = process.env.EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID ?? ''

// -1 = 無制限
export const PLAN_LIMITS = {
  free: {
    maxPhotosPerDesk:  4,
    maxFileSizeMB:     10,
    maxWiringPlans:    3,   // デスク（プラン）作成数の上限
    maxGrowthRecords:  10,
    maxViewHistory:    100,
    maxSavedCollections: 3,
    highQualityImages: false,  // 将来: 書き出し・アップロード画質の引き上げ
    // AIコーチはPro限定。週間トークン枠の正本はサーバー（supabase/migrations/120_ai_token_only_limit.sql）。
    aiFeatures:        false,
    deskComparison:    false,  // 将来: デスク同士の比較（PlanComparisonTable はプラン比較表で別物）
    customPublicPage:  false,
    deskFork:          false,  // 将来: デスクフォーク
    communityRanking:  false,  // 将来: ランキング
    gameLibrary:       false,
    cloudSync:         false,
    autoBackup:        true,
    mp4Export:         false,
    /** 歴史アニメーションで遡って見られる年数（-1 = 無制限） */
    historyAnimationYears: 1,
  },
  pro: {
    maxPhotosPerDesk:  10,
    maxFileSizeMB:     20,
    maxWiringPlans:    -1,  // 無制限
    maxGrowthRecords:  -1,
    maxViewHistory:    1000,
    maxSavedCollections: -1,
    highQualityImages: true,
    aiFeatures:        true,
    deskComparison:    true,
    customPublicPage:  true,
    deskFork:          true,
    communityRanking:  true,
    gameLibrary:       true,
    cloudSync:         true,
    autoBackup:        true,
    mp4Export:         true,
    historyAnimationYears: -1,
  },
} as const

export type PlanLimitKey = keyof typeof PLAN_LIMITS.free
export type NumericLimitKey = {
  [K in PlanLimitKey]: (typeof PLAN_LIMITS.free)[K] extends number ? K : never
}[PlanLimitKey]
export type BooleanLimitKey = {
  [K in PlanLimitKey]: (typeof PLAN_LIMITS.free)[K] extends boolean ? K : never
}[PlanLimitKey]

// ─── Paywall 価格プラン ──────────────────────────────────────────
// Paywall上部のタブで切り替え、Freeとの比較カードに反映される。
// price は日本のApp Storeの円価格で、ストアから実価格を取れなかったときの
// フォールバックにだけ使う（表示は usePlanPricing().priceOf() を通すこと）。
export interface PaywallPlanDef {
  id: 'pro_monthly' | 'pro_yearly'
  tier: 'pro'   // 比較表で使う機能セット
  nameJa: string
  nameEn: string
  tabJa: string          // 切り替えタブの短い表記
  tabEn: string
  price: string          // ストアから価格が取れないときのフォールバック（日本語UI）
  priceEn: string        // 同・英語UI。円表記のまま海外ユーザーへ出さないため
  periodJa: string       // '/ 月' | '/ 年'
  periodEn: string
  subJa: string          // 価格の補足（月あたり換算・無料体験など）
  subEn: string
  trialJa?: string       // 無料体験の文言（年額のみ）
  trialEn?: string
  badgeJa?: string
  badgeEn?: string
  productId: string
}

export const PAYWALL_PLANS: PaywallPlanDef[] = [
  {
    id: 'pro_monthly', tier: 'pro',
    nameJa: 'Pro', nameEn: 'Pro',
    tabJa: 'Pro 月額', tabEn: 'Pro Monthly',
    price: '¥590', priceEn: '$3.99', periodJa: '/ 月', periodEn: '/ mo',
    subJa: 'デスク無制限・AIコーチ・歴史は全期間',
    subEn: 'Unlimited desks, AI coach, full history',
    badgeJa: 'おすすめ', badgeEn: 'Popular', productId: RC_PRODUCT_MONTHLY,
  },
  {
    id: 'pro_yearly', tier: 'pro',
    nameJa: 'Pro（年額）', nameEn: 'Pro Yearly',
    tabJa: 'Pro 年間', tabEn: 'Pro Yearly',
    price: '¥5,900', priceEn: '$39.99', periodJa: '/ 年', periodEn: '/ yr',
    subJa: '月あたり ¥492（2ヶ月分お得）',
    subEn: '$3.33 / mo — save ~17%',
    badgeJa: 'お得', badgeEn: 'Best value', productId: RC_PRODUCT_YEARLY,
  },
]

// ─── RevenueCat ──────────────────────────────────────────────────
// Dashboard → Project → API Keys からコピーして差し替える
export const RC_API_KEY_IOS     = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? ''
export const RC_API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? ''
export const RC_ENTITLEMENT_PRO = 'pro'

// ─── PostHog ─────────────────────────────────────────────────────
// PostHog Dashboard → Project Settings → Project API Key
export const POSTHOG_KEY  = process.env.EXPO_PUBLIC_POSTHOG_KEY ?? ''
export const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com'

// ─── 公開ページURL ───────────────────────────────────────────────
// 独自ドメインを取得したらここ1箇所を差し替える（app.json の associatedDomains /
// intentFilters、RootNavigator の linking prefixes も同じホストに合わせること）。
export const PUBLIC_URL_BASE = 'https://mydesk.page'
// Paywall からのリンクは審査要件（App Store Review Guideline 3.1.2）。
// 末尾スラッシュ無しだと 308 リダイレクトを挟むため、付けた形で持つ。
export const TERMS_URL   = `${PUBLIC_URL_BASE}/terms/`
export const PRIVACY_URL = `${PUBLIC_URL_BASE}/privacy/`

// App Store Connect のアプリID。レビュー投稿ページを直接開くのに使う。
// ボタンから StoreReview.requestReview() を呼ぶのは規約違反なので、
// 「評価する」導線はこのURLを開く形にしている。
export const APP_STORE_ID = '6798069737'
export const APP_STORE_REVIEW_URL =
  `itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`
export const APP_STORE_REVIEW_URL_WEB =
  `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`
const PUBLIC_URL_PATTERN_BASE = PUBLIC_URL_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const PUBLIC_DESK_URL_PATTERN = new RegExp(
  // ID の後ろは末尾・クエリ・ハッシュ・末尾スラッシュだけ許可する。
  // /<@ID>/<ID>/extra は Worker 側でも共有URLとして扱わないため、貼り付けだけ
  // 成功する状態にしない。
  // 1つ目の段は @ID か、旧形式の setup / d / desk。どちらでもデスクは2つ目の ID だけで引く。
  `${PUBLIC_URL_PATTERN_BASE}/([A-Za-z0-9_]{1,20})/([A-Za-z0-9_-]+)(?=/?(?:$|[?#\\s]))`,
  'i',
)

/** 共有URLの1つ目の段として今も受け付ける旧形式 */
const LEGACY_DESK_PATH_SEGMENTS = new Set(['setup', 'd', 'desk'])

/**
 * 共有URLに載せる @ID。サイト自身のパスと同じ綴りは載せない
 * （/terms/<ID> のような、LP のページと見分けが付かない共有URLになる）。
 */
function publicUrlTag(tag?: string | null): string {
  const clean = normalizePublicTag(tag)
  return isPublicTagSegment(clean) ? clean : ''
}

// UUID をそのまま載せると URL の半分がIDで埋まるため、22文字に短縮して共有する。
//
// 共有URLは `/<@ID>/<22文字>`。末尾を削るとその人のプロフィールに着く形にしてある。
// **デスクは2つ目の ID だけで引く。** @ID は本人が変えられるので（060）、突き合わせると
// 改名した瞬間に配った共有リンクが全部死ぬ。@ID は見て分かるための飾りとして載せる。
// @ID を持たないとき・旧形式（/setup/<uuid>・/d/<22文字>・/desk/<uuid>）も引き続き開ける。
export function buildPublicUrl(deskId: string, ownerTag?: string | null): string {
  const code = encodeDeskId(deskId)
  const tag = publicUrlTag(ownerTag)
  return tag ? `${PUBLIC_URL_BASE}/${tag}/${code}` : `${PUBLIC_URL_BASE}/setup/${code}`
}

/**
 * 公開プロフィール（人単位）のURL。@ID は 049 で全員に振られ、060 から本人が決める。
 * 綴りの大小はそのまま載せる（URL 側の照合は大文字小文字を区別しない）。
 * 旧形式の /u/<@ID> も worker とアプリの両方で引き続き開ける。
 */
export function buildPublicProfileUrl(tag: string): string {
  return `${PUBLIC_URL_BASE}/${encodeURIComponent(normalizePublicTag(tag))}`
}

export function parsePublicDeskUrl(value: string): string | null {
  const match = value.trim().match(PUBLIC_DESK_URL_PATTERN)
  if (!match) return null
  const [, first, id] = match
  // サイト自身のパス（/terms/… など）は共有URLではない。worker の振り分けと同じにする
  if (!LEGACY_DESK_PATH_SEGMENTS.has(first.toLowerCase()) && !isPublicTagSegment(first)) return null
  if (!isUuid(id) && !isShortDeskId(id)) return null
  return decodeDeskId(id)
}

import type { PaywallReason } from '../types'
export type { PaywallReason }

// ─── Paywallを開く理由ラベル ────────────────────────────────────
export const PAYWALL_REASON_LABEL: Record<PaywallReason, string> = {
  maxViewHistory: 'Proなら閲覧履歴を最新1,000件まで残せます',
  maxSavedCollections: 'Proなら保存コレクションを無制限に作れます',
  maxPhotosPerDesk: '写真の上限（4枚）に達しました',
  maxWiringPlans:   'デスク作成数の上限（3件）に達しました',
  maxGrowthRecords: '成長記録の上限（10件）に達しました',
  aiFeatures:       'AIコーチはProプランで使えます',
  accentColor:      'テーマカラーの変更はProプランで利用できます',
  autoBackup:       'バックアップの履歴7件はProプランで利用できます',
  // 082 から、遡れる範囲は投稿者の契約で決まる。閲覧者が課金しても他人のデスクの
  // 公開範囲は変わらないので、「見られます」ではなく自分のデスクの話として書く
  historyAnimation: 'デスクの歴史を全期間さかのぼれます（無料は直近1年）',
  manual:           'Proプランでもっと便利に',
}

export const PAYWALL_REASON_LABEL_EN: Record<PaywallReason, string> = {
  maxViewHistory: 'Keep your latest 1,000 viewed desks with Pro',
  maxSavedCollections: 'Create unlimited saved collections with Pro',
  maxPhotosPerDesk: 'You have reached the 4-photo limit',
  maxWiringPlans:   'You have reached the 3-desk limit',
  maxGrowthRecords: 'You have reached the 10-record limit',
  aiFeatures:       'The AI coach is available on Pro',
  accentColor:      'Custom theme colors are available on Pro',
  autoBackup:       'Seven backup generations are available on Pro',
  historyAnimation: 'Replay your full desk history (free plan: last 1 year)',
  manual:           'Get more out of MyDesk with Pro',
}

// ─── Free vs 有料プラン 比較表（Paywall/設定の表示用） ──────────
// free/pro: 文字列 = そのまま表示、true = ✓、false = −
export type PlanCompareValue = { ja: string; en: string } | boolean

export interface PlanCompareRow {
  icon: string
  ja: string
  en: string
  free: PlanCompareValue
  pro:  PlanCompareValue
}

export const PLAN_COMPARE_ROWS: PlanCompareRow[] = [
  { icon: 'history', ja: '閲覧履歴', en: 'Viewing history',
    free: { ja: '100件', en: '100' }, pro: { ja: '1,000件', en: '1,000' } },
  { icon: 'folder-outline', ja: '保存コレクション', en: 'Saved collections',
    free: { ja: '3フォルダ', en: '3 folders' }, pro: { ja: '無制限', en: 'Unlimited' } },
  { icon: 'layers-triple-outline',  ja: 'デスク数',           en: 'Desks',
    free: { ja: '3件', en: '3' },   pro: { ja: '無制限', en: 'Unlimited' } },
  { icon: ICONS.photos,             ja: '写真（デスクごと）', en: 'Photos per desk',
    free: { ja: '4枚', en: '4' },   pro: { ja: '10枚', en: '10' } },
  { icon: ICONS.robot,              ja: 'AIコーチ（チャット）', en: 'AI coach (chat)',
    free: false, pro: { ja: '週間利用枠', en: 'Weekly allowance' } },
  { icon: 'image-search-outline',   ja: 'AI写真解析',         en: 'AI photo analysis',
    free: false, pro: { ja: 'チャットと共通枠', en: 'Shared with chat' } },
  { icon: ICONS.palette,            ja: 'テーマカラー',       en: 'Theme colors',
    free: { ja: '基本色', en: 'Default' }, pro: { ja: '全カラー', en: 'All colors' } },
  { icon: 'backup-restore',         ja: 'アカウントバックアップ', en: 'Account backup',
    free: { ja: '最新1件', en: 'Latest 1' }, pro: { ja: '直近7件', en: 'Latest 7' } },
  // 公開ページで他人に見せられる範囲も同じ値で決まる（082）。表の1行に両方は書けないので、
  // 数字だけ揃えてある（説明は Paywall の理由ラベル側）
  { icon: 'motion-play-outline',    ja: 'デスクの歴史', en: 'Desk history animation',
    free: { ja: '直近1年', en: 'Last 1 yr' }, pro: { ja: '無制限', en: 'Unlimited' } },
  // 「広告非表示」は載せない。アプリ内広告そのものが未実装で、
  // 実在しない特典を有料プランの売りにすることになるため（審査・景表法）。
]
