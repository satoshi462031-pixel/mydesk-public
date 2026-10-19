// ─── mydesk.page でサイト自身が持っているパス ─────────────────────────
//
// 共有URLは `/<@ID>/<デスクID>`、プロフィールは `/<@ID>`。1段目が人の名乗りか
// サイトのページかを、この一覧だけで切り分ける。
//
// **予約語（utils/publicTag の RESERVED_TAGS）とは別物。** あちらは「誰も名乗れない綴り」で、
// 公式アカウントの @MyDesk・@000000 も含まれる。あれを振り分けに使うと、実在する公式の
// プロフィール（/mydesk）がサイトのページ扱いになって開けなくなる。
//
// LP（landing/app）にページを足したら、そのパスをここにも足すこと。足し忘れると、
// 新しいページが「その綴りを名乗った人のプロフィール」として読まれて LP に届かない。
// tests/siteRoutes.test.ts が landing/app と worker の写しを突き合わせて止める。

export const SITE_PATH_SEGMENTS = [
  // LP（landing/app）
  'terms',
  'privacy',
  'account-deletion',
  'user',
  'explore',
  // 検索ページの旧URL。worker が /explore へ 301 する
  'explore-desks',
  // LP と同じ内容を指す別名。worker が / へ 301 する
  'about',
  // Next.js の配信パスと LP の静的ファイル
  '_next',
  'screens',
  // worker
  'admin',
  'api',
  '.well-known',
  // 共有URL・プロフィールの旧形式
  'setup',
  'desk',
  'd',
  'u',
] as const

const SITE_PATHS = new Set<string>(SITE_PATH_SEGMENTS.map((path) => path.toLowerCase()))

/** @ID として使える綴りの形。utils/publicTag の PUBLIC_TAG_PATTERN と同じ */
const TAG_SHAPE = /^[A-Za-z0-9_]{3,20}$/

/**
 * URL の1段目を人の名乗りとして読んでよいか。
 * 綴りの大小は区別しない（照合は小文字で行い、表示は受け取ったまま使う）。
 */
export function isPublicTagSegment(segment: string): boolean {
  return TAG_SHAPE.test(segment) && !SITE_PATHS.has(segment.toLowerCase())
}
