import { normalizePublicTag } from './publicTag'

/**
 * 自分のデスクの共有URLに載せる @ID。公開プロフィールを出していない人は載せない。
 * 103 で、そういう人のデスクには @ID を写さなくなった（@ID から全デスクを集めさせない）。
 * URL にだけ載せると、同じ集約の手がかりを共有のたびに配ることになる
 */
export function ownShareTag(
  profile: { public_tag?: string | null; profile_discoverable?: boolean | null } | null | undefined,
): string | null {
  if (!profile || profile.profile_discoverable === false) return null
  return profile.public_tag ?? null
}

export interface PublicAuthorParts {
  /** 表示名。無ければ空文字 */
  name: string
  /** `@TAG` 形式。無ければ空文字 */
  tag: string
}

/**
 * 表示名とタグを分けて返す。2行に組むとき（公開デスクの投稿者行）に使う。
 * 1行に並べる formatPublicAuthor もこれを通す。
 *
 * 公式アカウント（#000000）の読み替えはここに持たない。以前は英語表示のときだけ
 * 投稿者名を 'MyDesk Official' に差し替えていたが、あれは公式バッジではなく
 * owner_name が日本語であることへの当て物で、表示言語で名前が変わるのは
 * 投稿者名としておかしい。名前そのものを両言語で読める表記にして解いた（056）。
 * なりすまし対策はタグの予約（052）が担っていて、ここには依らない。
 */
export function publicAuthorParts(
  name?: string | null,
  tag?: string | null,
): PublicAuthorParts {
  const cleanName = name?.trim() ?? ''
  // 保存されている値に印は付いていない。旧データや手入力の取りこぼしに備えて
  // # と @ の両方を剥がしてから付け直す（表示は @ に統一・マイページと揃える）。
  // 綴りは触らない。060 で @ID は本人が決めるようになり、大文字小文字も本人の指定
  const cleanTag = normalizePublicTag(tag)
  return { name: cleanName, tag: cleanTag ? `@${cleanTag}` : '' }
}

export function formatPublicAuthor(
  name?: string | null,
  tag?: string | null,
): string {
  const parts = publicAuthorParts(name, tag)
  return [parts.name, parts.tag].filter(Boolean).join(' ')
}
