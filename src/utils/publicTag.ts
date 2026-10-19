// 公開タグ（@ID）— 人を一意に指す文字列。表示名は重複を許すので、ここだけが名乗り。
//
// 正本はサーバー（060 の set_public_tag）。ここにある形式・予約語は、
// 保存を押す前に理由を返すための写しで、最終判定ではない。
// **片方だけ変えない。** 緩いほうを直し忘れると、通ると思って入力した @ID が
// 保存の瞬間だけ弾かれる（逆だと、入力できないのに他人は持っている状態になる）。

export const PUBLIC_TAG_MIN_LENGTH = 3
export const PUBLIC_TAG_MAX_LENGTH = 20

const PUBLIC_TAG_PATTERN = /^[A-Za-z0-9_]{3,20}$/

// 060 の is_reserved_public_tag と同じ並び。
// tests/publicTag.test.ts がマイグレーションの配列と突き合わせる
export const RESERVED_TAGS = new Set([
  'mydesk', 'my_desk', 'mydeskofficial', 'mydesk_official', 'mydeskjp', 'mydeskapp',
  'official', 'admin', 'administrator', 'moderator', 'staff', 'support', 'help',
  'info', 'contact', 'security', 'billing', 'root', 'system', 'null', 'undefined',
  'api', 'app', 'www', 'u', 'd', 'desk', 'setup', 'settings', 'login', 'signin',
  'signup', 'terms', 'privacy', 'about', 'blog', 'explore', '000000',
])

/**
 * 先頭の印（@ / #）と前後の空白だけを落とす。**大文字小文字は変えない。**
 * 表示は本人が入力したとおりに出す（@MyDesk を別の大小文字表記へ書き換えない）。
 */
export function normalizePublicTag(value?: string | null): string {
  return (value ?? '').trim().replace(/^[#@]/, '')
}

/** 一意性・検索の比較キー。@MyDesk と @mydesk は同じ人として扱う */
export function publicTagKey(value?: string | null): string {
  return normalizePublicTag(value).toLowerCase()
}

/**
 * 公式アカウント（デモデスクの所有者）の @ID か。060 から @MyDesk、それより前（052）は 000000。
 * どちらも予約語で他人は名乗れないので、見た目の特別扱い（アプリのマークのアイコン）に使ってよい。
 * 000000 も見るのは、端末に先読みしてある古い公開デスクの行がまだ持っているため
 */
export function isOfficialPublicTag(value?: string | null): boolean {
  const key = publicTagKey(value)
  return key === 'mydesk' || key === '000000'
}

export type PublicTagIssue = 'invalid' | 'reserved' | 'taken' | 'rate_limited'

/** 入力の形だけを見る。重複（taken）はサーバーしか知らない */
export function findPublicTagIssue(value: string): PublicTagIssue | null {
  const tag = normalizePublicTag(value)
  if (!PUBLIC_TAG_PATTERN.test(tag)) return 'invalid'
  if (RESERVED_TAGS.has(tag.toLowerCase())) return 'reserved'
  return null
}

export function isValidPublicTag(value?: string | null): boolean {
  return PUBLIC_TAG_PATTERN.test(normalizePublicTag(value))
}

/**
 * 使われていた（または予約語だった）@ID の代わりに出す候補。
 *
 * 元の綴りを残す。重なった人はその名前で呼ばれたくて打っているので、無関係な抽選値を
 * 出しても選ばれず、結局打ち直しになる。空いているかはサーバーにしか分からないので、
 * ここは形の通る綴りを並べるだけで、照会は findAvailablePublicTags がする。
 * seed で数字を変えるのは、一度埋まった候補を開き直すたびに出し続けないため。
 */
export function publicTagSuggestions(base: string, name = '', seed = 0): string[] {
  const clean = (value: string) => value.replace(/[^A-Za-z0-9_]/g, '').replace(/^_+|_+$/g, '')
  // いちばん長い接尾辞（_setup の6文字）を足しても上限に収まるよう先に切る
  const stem = (clean(normalizePublicTag(base)) || clean(name) || 'user')
    .slice(0, PUBLIC_TAG_MAX_LENGTH - 6)
  const n = Math.abs(Math.trunc(seed))
  const two = String(10 + (n % 90))
  const three = String(100 + (Math.floor(n / 90) % 900))
  const raw = [`${stem}_desk`, `${stem}_${two}`, `${stem}${three}`, `${stem}_setup`, `${stem}${two}`, `${stem}_${three}`]

  const seen = new Set([publicTagKey(base)])
  const out: string[] = []
  for (const tag of raw) {
    const key = publicTagKey(tag)
    if (seen.has(key) || findPublicTagIssue(tag)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** サーバーが返す合図（PUBLIC_TAG_*）を UI の理由へ寄せる */
export function publicTagIssueFromError(error: unknown): PublicTagIssue | null {
  const message = error && typeof error === 'object' && 'message' in error
    ? String(error.message) : String(error ?? '')
  if (message.includes('PUBLIC_TAG_TAKEN')) return 'taken'
  if (message.includes('PUBLIC_TAG_RESERVED')) return 'reserved'
  if (message.includes('PUBLIC_TAG_INVALID')) return 'invalid'
  if (message.includes('PUBLIC_TAG_RATE_LIMITED')) return 'rate_limited'
  return null
}

export function publicTagIssueMessage(issue: PublicTagIssue, lang: 'ja' | 'en'): string {
  if (issue === 'rate_limited') {
    return lang === 'ja' ? 'IDの変更は7日に1回、90日間に4回までです。期間をあけて変更してください。'
      : 'You can change your ID once every 7 days, up to 4 times in 90 days. Please wait before changing it again.'
  }
  if (issue === 'taken') {
    return lang === 'ja' ? 'このIDは使われています' : 'That ID is already taken'
  }
  if (issue === 'reserved') {
    return lang === 'ja' ? 'このIDは使えません' : 'That ID is not available'
  }
  return lang === 'ja'
    ? `半角英数字と _ で ${PUBLIC_TAG_MIN_LENGTH}〜${PUBLIC_TAG_MAX_LENGTH} 文字`
    : `${PUBLIC_TAG_MIN_LENGTH}–${PUBLIC_TAG_MAX_LENGTH} characters: letters, numbers, and _`
}
