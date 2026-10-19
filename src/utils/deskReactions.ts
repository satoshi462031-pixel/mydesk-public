// 自分の公開デスクへの反応（086）。拍手（旧いいね・095 で版ごとに送れるようになった）＝いいと思った印で投稿者に届ける、
// 保存＝継続的に見たい印で件数だけ見せる（誰が押したかは出さない）。
// この層は通信も保存も知らない（tests/deskReactions.test.ts が node で確かめる）。

export interface DeskReaction {
  deskId: string
  title: string
  likeCount: number
  bookmarkCount: number
  /** 前にベルで見たあとに付いた拍手 */
  newLikeCount: number
  /** 今の版（最後の更新）への拍手。likeCount は全部の版の延べ */
  roundLikeCount: number
  /** サーバー時刻。既読の基準に使う */
  checkedAt: string
}

interface ReactionRow {
  desk_id: string
  title: string | null
  like_count: number | null
  bookmark_count: number | null
  new_like_count: number | null
  checked_at: string
  /** 095 より前の関数では返らない */
  round_like_count?: number | null
}

export function toDeskReactions(rows: readonly ReactionRow[] | null | undefined): DeskReaction[] {
  return (rows ?? []).map((row) => ({
    deskId: row.desk_id,
    title: row.title ?? '',
    likeCount: Math.max(0, row.like_count ?? 0),
    bookmarkCount: Math.max(0, row.bookmark_count ?? 0),
    newLikeCount: Math.max(0, row.new_like_count ?? 0),
    roundLikeCount: Math.max(0, row.round_like_count ?? 0),
    checkedAt: row.checked_at,
  }))
}

/** ベルに出すもの。1件ずつではなくデスクごとにまとめ、増えた数の多い順 */
export function newLikeReactions(reactions: readonly DeskReaction[]): DeskReaction[] {
  return reactions
    .filter((reaction) => reaction.newLikeCount > 0)
    // 同じ数のデスクはデスク名の順。サーバーの関数は並びを決めていないので、決めないと
    // ベルを開くたびに入れ替わる
    .sort((a, b) => b.newLikeCount - a.newLikeCount || a.title.localeCompare(b.title) || a.deskId.localeCompare(b.deskId))
}

/** 既読の基準にする時刻。行が無ければ基準を動かさない（null） */
export function reactionsCheckedAt(reactions: readonly DeskReaction[]): string | null {
  return reactions[0]?.checkedAt ?? null
}

/**
 * 持ち主にだけ見せる件数の1行。どちらも0なら出さない（「拍手 0」は励みにならない）。
 * 拍手が前の版にもまたがるときだけ、最後の更新へのぶんを添える（全部が今の版なら同じ数を2度言うだけ）
 */
export function reactionSummary(
  reaction: Pick<DeskReaction, 'likeCount' | 'bookmarkCount'> & Partial<Pick<DeskReaction, 'roundLikeCount'>> | undefined,
  lang: 'ja' | 'en',
): string | null {
  if (!reaction || (reaction.likeCount === 0 && reaction.bookmarkCount === 0)) return null
  const round = reaction.roundLikeCount ?? 0
  const showRound = round > 0 && round < reaction.likeCount
  return lang === 'ja'
    ? `拍手 ${reaction.likeCount}${showRound ? `（この更新 ${round}）` : ''} · 保存 ${reaction.bookmarkCount}`
    : `${reaction.likeCount} applause${showRound ? ` (${round} on this update)` : ''} · ${reaction.bookmarkCount} save${reaction.bookmarkCount === 1 ? '' : 's'}`
}
