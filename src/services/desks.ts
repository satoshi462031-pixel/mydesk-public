import { supabase } from '../supabase/client'
import { UNIQUE_VIOLATION } from '../supabase/postgresErrors'
import { PUSH_NOTIFICATIONS_ENABLED } from '../constants/features'
import {
  Bookmark,
  DbConnection,
  Desk,
  DeskPhoto,
  DeskSnapshot,
  DeskVersion,
  DeskWithDetails,
  Device,
} from '../supabase/types'
import { PlanPurpose } from '../types'
import { ClapRow, ClapState, ClapStates, clapStateOf, clapStates } from '../utils/clapRound'
import { normalizePublicDeskSearch, parsePublicDeskCursor } from '../utils/publicDeskFeed'
import { isValidPublicTag, publicTagKey } from '../utils/publicTag'
import { historyLayoutCache } from '../utils/historyLayoutCache'
import { LAYOUT_VERSION } from '../utils/mapLayoutCache'

// =============================================================
// DESKS
// =============================================================

export async function createDesk(
  userId: string,
  input: { id?: string; title: string; description?: string; visibility?: Desk['visibility']; purposes?: string[]; owner_name?: string; owner_tag?: string; share_snapshot?: unknown }
): Promise<Desk> {
  const { data, error } = await supabase
    .from('desks')
    .insert({ user_id: userId, ...input })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getDesk(deskId: string): Promise<Desk | null> {
  const { data, error } = await supabase
    .from('desks')
    .select('*')
    .eq('id', deskId)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null
    throw error
  }
  return data
}

export async function getDeskWithDetails(deskId: string): Promise<DeskWithDetails | null> {
  const { data, error } = await supabase
    .from('desks')
    .select(`
      *,
      desk_photos ( * ),
      devices ( * ),
      connections ( * )
    `)
    .eq('id', deskId)
    .single()
  if (error) {
    // RLS で読めない＝非公開か、URL限定（083）。URL限定はリンクから開けるので関数で引き直す
    if (error.code === 'PGRST116') return getLinkSharedDesk(deskId)
    throw error
  }
  return data as DeskWithDetails
}

/**
 * URL限定（083）のデスクをリンクから開く。
 * RLS で読めるようにすると visibility=eq.unlisted で全件を列挙できてしまうので、
 * 限定公開は独立した共有ID（101）を指定したときだけ返す。実IDだけでは開けず、非公開なら null
 */
async function getLinkSharedDesk(deskId: string): Promise<DeskWithDetails | null> {
  const { data, error } = await supabase.rpc('get_link_shared_desk', { p_desk_id: deskId })
  if (error) throw error
  return (data as DeskWithDetails | null) ?? null
}

export async function getUserDesks(userId: string): Promise<Desk[]> {
  const { data, error } = await supabase
    .from('desks')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** 公開デスク管理用。大きい share_snapshot を一覧取得へ含めない。 */
export async function getUserDeskSummaries(
  userId: string,
): Promise<Array<Pick<Desk, 'id' | 'title' | 'visibility' | 'updated_at'>>> {
  const { data, error } = await supabase
    .from('desks')
    .select('id, title, visibility, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function updateDesk(
  deskId: string,
  updates: Partial<Pick<Desk, 'title' | 'description' | 'visibility' | 'total_price' | 'purposes' | 'owner_name' | 'owner_tag' | 'share_snapshot' | 'attributes' | 'content_signature' | 'desk_created_at'>>
): Promise<Desk> {
  const { data, error } = await supabase
    .from('desks')
    .update(updates)
    .eq('id', deskId)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteDesk(deskId: string): Promise<void> {
  const { error } = await supabase.from('desks').delete().eq('id', deskId)
  if (error) throw error
}

// =============================================================
// ブックマーク
// =============================================================

/**
 * 保存する／外す。何度送っても同じ結果になる（utils/intentSync の前提）。
 * 「行があれば消す・無ければ足す」の反転だと、連打で2本が重なったときに打ち消し合う
 */
export async function setDeskBookmarked(deskId: string, userId: string, bookmarked: boolean): Promise<void> {
  const cacheRevision = historyLayoutCache.revision
  const { error } = bookmarked
    ? await supabase.from('bookmarks').insert({ desk_id: deskId, user_id: userId })
    : await supabase.from('bookmarks').delete().eq('desk_id', deskId).eq('user_id', userId)
  if (error && error.code !== UNIQUE_VIOLATION) throw error
  if (cacheRevision === historyLayoutCache.revision) void historyLayoutCache.setBookmarked(deskId, bookmarked, LAYOUT_VERSION)
}

export async function isBookmarkedByUser(deskId: string, userId: string): Promise<boolean> {
  const cacheRevision = historyLayoutCache.revision
  const bookmarkRevision = historyLayoutCache.bookmarkRevision
  const { data, error } = await supabase
    .from('bookmarks')
    .select('id')
    .eq('desk_id', deskId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (cacheRevision === historyLayoutCache.revision && bookmarkRevision === historyLayoutCache.bookmarkRevision) {
    void historyLayoutCache.setBookmarked(deskId, !!data, LAYOUT_VERSION)
  }
  return !!data
}

/** 一覧からの削除用。現在の状態にかかわらず、削除後は必ず未保存にする。 */
export async function removeBookmark(deskId: string, userId: string): Promise<void> {
  return setDeskBookmarked(deskId, userId, false)
}

export interface BookmarkedDesk extends Bookmark {
  desk: DeskWithDetails
}

export async function getBookmarkedDesks(userId: string): Promise<BookmarkedDesk[]> {
  const cacheRevision = historyLayoutCache.revision
  const bookmarkRevision = historyLayoutCache.bookmarkRevision
  const { data, error } = await supabase
    .from('bookmarks')
    .select(`
      *,
      desk:desks ( *, desk_photos ( id, image_url, sort_order ) )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const bookmarks = (data ?? []).filter((b: any) => b.desk) as BookmarkedDesk[]
  if (cacheRevision === historyLayoutCache.revision && bookmarkRevision === historyLayoutCache.bookmarkRevision) {
    void historyLayoutCache.syncBookmarkedPlans(bookmarks.map((b) => b.desk_id), LAYOUT_VERSION)
  }
  return bookmarks
}

export interface BookmarkedDeskPage {
  /** 非公開になったデスクを除いたもの */
  items: BookmarkedDesk[]
  /** 読んだ保存の行数（除いたものも含む）。読み直すときに同じ範囲を引くのに使う */
  rowCount: number
  /** 次のページはこれより前に保存したもの */
  nextBefore?: string
  end: boolean
}

/**
 * マイページの保存の一覧用。新しく保存した順に limit 件ずつ。
 * 1件ごとに share_snapshot（「最近の変化」の材料）が付くので、全件を引くと保存が増えるほど
 * タブへ戻るたびの取得が大きくなる。全件が要る更新一覧は getBookmarkedDesks を使う。
 * 優先の同期（syncBookmarkedPlans）は全件を知っているときしか行えないので、ここでは呼ばない
 */
export async function getBookmarkedDeskPage(userId: string, limit: number, before?: string, collectionId?: string): Promise<BookmarkedDeskPage> {
  let query = supabase
    .from('bookmarks')
    .select(`
      *,
      desk:desks ( *, desk_photos ( id, image_url, sort_order ) )
      ${collectionId ? ', saved_collection_items!inner(collection_id)' : ''}
    `)
    .eq('user_id', userId)
  if (before) query = query.lt('created_at', before)
  if (collectionId) query = query.eq('saved_collection_items.collection_id', collectionId)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = (data ?? []) as unknown as BookmarkedDesk[]
  return {
    items: rows.filter((b) => b.desk),
    rowCount: rows.length,
    nextBefore: rows.at(-1)?.created_at,
    end: rows.length < limit,
  }
}

// =============================================================
// 拍手（UI の名前。テーブルと列は likes / like_count のまま・095）
// =============================================================

// 拍手の行と、そのデスクの今の版を1回で引く。版を別に引くと、その間に更新された
// デスクで「今の版」が食い違う
const CLAP_ROW_COLUMNS = 'desk_id, round_at, desk:desks(clap_round_at)'

/**
 * 今の版に拍手する／取り消す。何度送っても同じ結果になる（setDeskBookmarked と同じ理由）。
 * 版はサーバーが埋め、取り消しも RLS が今の版の行だけに絞る（095）。
 */
export async function setDeskLiked(deskId: string, userId: string, liked: boolean): Promise<void> {
  const { error } = liked
    ? await supabase.from('likes').insert({ desk_id: deskId, user_id: userId })
    : await supabase.from('likes').delete().eq('desk_id', deskId).eq('user_id', userId)
  if (error && error.code !== UNIQUE_VIOLATION) throw error
  // 持ち主への通知（096）。送るかどうか（新しい拍手か・間隔・持ち主の設定）はサーバーが決めるので、
  // ここでは拍手が新しく入ったたびに頼むだけ。失敗しても拍手そのものは成立しているので待たない
  if (PUSH_NOTIFICATIONS_ENABLED && liked && !error) {
    void supabase.functions.invoke('notify-claps', { body: { deskId } }).catch(() => {})
  }
}

export async function getDeskClapState(deskId: string, userId: string): Promise<ClapState> {
  const { data, error } = await supabase
    .from('likes')
    .select(CLAP_ROW_COLUMNS)
    .eq('desk_id', deskId)
    .eq('user_id', userId)
  if (error) throw error
  return clapStateOf(data as unknown as ClapRow[] | null, deskId)
}

const CLAPPED_PAGE_ROWS = 200
const CLAPPED_MAX_PAGES = 5

/**
 * 自分が拍手したデスクを、最後に拍手した日時の新しい順で（マイページの履歴の「拍手した」）。
 * 版ごとに行があるので、同じデスクは一番新しい拍手だけを残す。取り消した拍手は行ごと消えるので出ない。
 *
 * 上限は行ではなくデスクの数で数え、見た履歴（VIEW_HISTORY_LIMIT）と揃える。行で切ると、
 * 同じデスクに版ごとに拍手した人ほど並ぶデスクが減り、古いものが予告なく抜けていた
 */
export async function getClappedDeskEntries(userId: string, limit: number): Promise<{ deskId: string; clappedAt: string }[]> {
  const seen = new Set<string>()
  const entries: { deskId: string; clappedAt: string }[] = []
  // 1人が1デスクに送れる拍手は版の数だけで、通常は数行。読み続ける上限は念のための歯止め
  for (let page = 0; page < CLAPPED_MAX_PAGES && entries.length < limit; page++) {
    const from = page * CLAPPED_PAGE_ROWS
    const { data, error } = await supabase
      .from('likes')
      .select('desk_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + CLAPPED_PAGE_ROWS - 1)
    if (error) throw error
    const rows = (data ?? []) as { desk_id: string; created_at: string }[]
    for (const row of rows) {
      if (seen.has(row.desk_id)) continue
      seen.add(row.desk_id)
      entries.push({ deskId: row.desk_id, clappedAt: row.created_at })
      if (entries.length >= limit) break
    }
    if (rows.length < CLAPPED_PAGE_ROWS) break
  }
  return entries
}

/**
 * 一覧のどのデスクに、自分が今の版で拍手しているか（と、前の版に拍手したことがあるか）。
 *
 * カードごとに getDeskClapState を呼ぶと1画面で20往復する。表示中のIDをまとめて
 * 1回で引く。他人の拍手は RLS で読めないので、ここで取れるのは自分のぶんだけ。
 */
export async function getLikedDeskIds(userId: string, deskIds: string[]): Promise<ClapStates> {
  if (deskIds.length === 0) return { current: new Set(), before: new Set() }
  const { data, error } = await supabase
    .from('likes')
    .select(CLAP_ROW_COLUMNS)
    .eq('user_id', userId)
    .in('desk_id', deskIds)
  if (error) throw error
  return clapStates(data as unknown as ClapRow[] | null)
}

/**
 * 一覧タイルに出すいいね数。一覧の出どころは直接 select と複数の RPC に割れていて、
 * RPC の戻り列に like_count を足すには関数ごと作り直しになるので、表示中の ID で後から引く。
 */
export async function getDeskLikeCounts(deskIds: string[]): Promise<Map<string, number>> {
  if (deskIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('desks')
    .select('id, like_count')
    .in('id', deskIds)
  if (error) throw error
  return new Map((data ?? []).map((row: { id: string; like_count: number | null }) => [row.id, Math.max(0, row.like_count ?? 0)]))
}

export async function removeLike(deskId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('likes')
    .delete()
    .eq('desk_id', deskId)
    .eq('user_id', userId)
  if (error) throw error
}

/**
 * ベルの点を出すためだけの軽い問い合わせ。
 * 保存したデスクの更新時刻だけを引く。getBookmarkedDesks は share_snapshot
 * （配線の中身）まで持ってくるので、一覧を開くたびに走らせられない。
 *
 * いいねは対象にしない。理由は services/deskUpdates.ts の頭に書いてある
 * （更新一覧と点で対象がずれると、点が出ているのに一覧が空になる）。
 */
export interface WatchedDeskStamp {
  id: string
  /** ブロックした相手のデスクを落とすために引く。ベルの点と更新一覧で対象を揃える */
  user_id: string
  updated_at: string
  content_updated_at: string | null
  visibility: 'public' | 'private'
}

export async function listWatchedDeskStamps(userId: string): Promise<WatchedDeskStamp[]> {
  const cacheRevision = historyLayoutCache.revision
  const bookmarkRevision = historyLayoutCache.bookmarkRevision
  const columns = 'desk:desks ( id, user_id, updated_at, content_updated_at, visibility )'
  const bookmarks = await supabase.from('bookmarks').select(columns).eq('user_id', userId)
  if (bookmarks.error) throw bookmarks.error
  const rows = (bookmarks.data ?? []) as unknown as Array<{ desk: WatchedDeskStamp | null }>
  if (cacheRevision === historyLayoutCache.revision && bookmarkRevision === historyLayoutCache.bookmarkRevision) {
    void historyLayoutCache.syncBookmarkedPlans(rows.flatMap((row) => row.desk ? [row.desk.id] : []), LAYOUT_VERSION)
  }
  const byId = new Map<string, WatchedDeskStamp>()
  for (const row of rows) {
    // 公開を取り消されたデスクは更新を伝えない（開いても見られない）
    if (row.desk && row.desk.visibility === 'public') byId.set(row.desk.id, row.desk)
  }
  return [...byId.values()]
}

/**
 * みんなのデスク（公開デスクの一覧）。
 *
 * RLS の desks_select_public が「visibility = 'public' か自分のデスク」を許すので、
 * 追加のマイグレーションなしで読める。ここでは一覧カードに要るぶんだけを取り、
 * share_snapshot（配線の中身）は開いたときに取る。
 *
 * ブロック済みユーザーの除外はここではやらない。blocked_users は本人しか読めず、
 * サーバー側で結合できないため、呼び出し側で除外する（BookmarkListScreen と同じ）。
 *
 * before に前ページ末尾の updated_at を渡すと続きを返す。search があれば
 * タイトル・投稿者・用途・登録ガジェットを横断検索する。件数が増えても全件を持ってこない。
 */
export interface PublicDeskListItem {
  id: string
  user_id: string
  title: string
  owner_name: string
  owner_tag: string
  /** 059。検索（055 の RPC）の戻り列にも 065 で足した */
  owner_avatar_url?: string | null
  purposes: string[]
  total_price: number
  /** 最初に公開された日時。「新着」を公開から7日間だけ出す判定に使う */
  created_at?: string | null
  updated_at: string
  /**
   * 061。機材か写真が変わった最後の日時。一度も変わっていなければ null。
   * 検索（055 の RPC）の戻り列にも 065 で足した
   */
  content_updated_at?: string | null
  desk_photos: { id: string; image_url: string; sort_order: number }[]
  /**
   * 058。検索は search_public_desks（055）を通る。戻り列は 065 で揃えたが、
   * 一度も公開し直していない古いデスクは空なので、使う側で空配列に落とす
   */
  attributes?: string[]
}

/** RPC の旧戻り列に created_at が無いため、検索結果だけ1回の問い合わせで補う。 */
async function withDeskCreatedAt(items: PublicDeskListItem[]): Promise<PublicDeskListItem[]> {
  const missingIds = items.filter((item) => !item.created_at).map((item) => item.id)
  if (missingIds.length === 0) return items
  const { data, error } = await supabase.from('desks').select('id, created_at').in('id', missingIds)
  if (error) return items
  const createdById = new Map((data ?? []).map((row) => [row.id, row.created_at]))
  return items.map((item) => ({ ...item, created_at: item.created_at ?? createdById.get(item.id) ?? null }))
}

/**
 * 前ページの末尾より後ろの行。並びと同じ（日時 → id）の2段で比べる。
 * 値は or() の予約文字（, . : ( )）を含むので二重引用符で囲む。位置は前に読んだ行から作る値だが、
 * 形が違えば絞り込みを組まず日時だけで比べる（文字列をそのまま式へ埋めない）
 */
function publicDeskBeforeFilter(cursor: { updatedAt: string; id?: string }): string {
  if (Number.isNaN(Date.parse(cursor.updatedAt))) throw new Error('invalid public desk cursor')
  const at = `"${cursor.updatedAt}"`
  if (!cursor.id || !/^[0-9a-f-]{36}$/i.test(cursor.id)) return `updated_at.lt.${at}`
  return `updated_at.lt.${at},and(updated_at.eq.${at},id.lt.${cursor.id})`
}

/**
 * 公開デスクの一覧。用途チップ（purpose）は検索語と違って表記ゆれを解釈させず、
 * 保存値そのもので絞る（070 の p_purpose）。語で当てにいく検索と混ぜない。
 *
 * attribute は 058 の属性キー（'purpose:gaming' / 'os:macOS' など）で絞る（071）。
 * 公開プロフィールの属性行から横断してくる導線がこれを使う。用途はここへ渡さない
 * ——attributes は 058 以降に公開し直したデスクにしか入っておらず、purposes 列を
 * 見る purpose のほうが古いデスクまで当たる。
 */
export async function listPublicDesks(
  limit = 20,
  before?: string,
  search = '',
  purpose?: PlanPurpose,
  attribute?: string,
): Promise<PublicDeskListItem[]> {
  const normalizedSearch = normalizePublicDeskSearch(search)
  const cursor = before ? parsePublicDeskCursor(before) : null
  if (normalizedSearch || purpose || attribute) {
    const { data, error } = await supabase.rpc('search_public_desks', {
      p_query: normalizedSearch,
      p_limit: limit,
      // 075 の関数は日時しか受け取らない（同じ日時の境目は id で割れない）
      p_before: cursor?.updatedAt ?? null,
      p_purpose: purpose ?? null,
      // 071 を当てる前のサーバーには無い引数。名前で渡す RPC は、知らない引数が
      // 1つ混じるだけで関数ごと見つからない扱いになる（PGRST202）。null でも送ると
      // 検索と用途チップまで巻き添えで死ぬので、使うときだけ足す
      ...(attribute ? { p_attribute: attribute } : {}),
    })
    if (error) throw error
    return withDeskCreatedAt((data ?? []) as PublicDeskListItem[])
  }

  let query = supabase
    .from('desks')
    .select('id, user_id, title, owner_name, owner_tag, owner_avatar_url, purposes, total_price, created_at, updated_at, content_updated_at, desk_photos ( id, image_url, sort_order )')
    .eq('visibility', 'public')
    .order('updated_at', { ascending: false })
    // 同じ日時のデスクの並びを決める。決めないと、ページの境目で同じ日時の残りが飛ぶ
    .order('id', { ascending: false })
    .limit(limit)
  if (cursor) query = query.or(publicDeskBeforeFilter(cursor))
  const { data, error } = await query
  if (error) throw error
  return withDeskCreatedAt((data ?? []) as PublicDeskListItem[])
}

/**
 * その商品を使っている公開デスク（073）。機材から辿る導線。
 *
 * 突き合わせは devices.product_id で、名前は見ない（表記ゆれで別物が混ざる）。
 * 073 より前に公開されたデスクは product_id を持たないので出てこない。
 * 戻る列は listPublicDesks と揃えてあり、同じタイルへそのまま流せる。
 */
export async function listPublicDesksUsingProduct(
  productId: string,
  limit = 20,
): Promise<PublicDeskListItem[]> {
  const { data, error } = await supabase.rpc('public_desks_using_product', {
    p_product_id: productId,
    p_limit: limit,
  })
  if (error) throw error
  return withDeskCreatedAt((data ?? []) as PublicDeskListItem[])
}

/**
 * ID を指定して公開デスクを引く。マイページの「履歴」タブ用（履歴は端末にだけあり、ID しか持たない）。
 * 列は listPublicDesks と揃える。見たあとで非公開・URL限定に変えられたデスクは返らないので、
 * 並びは呼び出し側が履歴の順に組み直し、返らなかった ID は黙って落とす。
 */
export async function listPublicDesksByIds(ids: string[]): Promise<PublicDeskListItem[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('desks')
    .select('id, user_id, title, owner_name, owner_tag, owner_avatar_url, purposes, total_price, created_at, updated_at, content_updated_at, desk_photos ( id, image_url, sort_order )')
    .eq('visibility', 'public')
    .in('id', ids)
  if (error) throw error
  return (data ?? []) as PublicDeskListItem[]
}

/**
 * 投稿者タグで公開デスクを引く。公開プロフィール（/u/:tag）用。
 *
 * owner_tag は publishService がコピーした非正規化値で、profiles を読まなくても
 * 引ける（046 で profiles は本人しか読めないため、閲覧側から join はできない）。
 * 列は listPublicDesks と揃える。share_snapshot と devices は含めない
 * （一覧で引くと1ページぶんの巨大な JSON が飛ぶ）。
 */
export async function listPublicDesksByTag(tag: string, limit = 40): Promise<PublicDeskListItem[]> {
  // 060 で @ID は本人が決める。URL に打たれた綴りの大小は当てにできないので、
  // 引くのは小文字の生成列（owner_tag_lower）。表示はヒットした行の owner_tag を使う
  const key = publicTagKey(tag)
  if (!isValidPublicTag(key)) return []
  const { data, error } = await supabase
    .from('desks')
    .select('id, user_id, title, owner_name, owner_tag, owner_avatar_url, purposes, total_price, created_at, updated_at, content_updated_at, attributes, desk_photos ( id, image_url, sort_order )')
    .eq('visibility', 'public')
    // 公開プロフィールを非公開にした人は、人単位の集約だけ止める（057）。
    // デスク 1 件ごとの公開・共有リンク・みんなのデスクへの掲載はそのまま。
    .eq('owner_profile_public', true)
    .eq('owner_tag_lower', key)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as PublicDeskListItem[]
}

/**
 * 公開プロフィールの「最近の変化」用。その人の公開デスクを share_snapshot ごと引く。
 *
 * 撤去されたガジェットは devices に載らない（publishService が書くのは現役ぶんだけ）。
 * 入れ替え・撤去まで言うには履歴を持っている share_snapshot が要る。JSON は重いので
 * 件数を絞り、呼び出し側はタイルを描いたあとで取りに行く。
 *
 * 絞り込みは listPublicDesksByTag と同じ（公開・プロフィール公開・タグ一致）。
 * devices / connections は引いていないので空で返す。この行から作るのは変化の一覧だけで、
 * 配線図は描かない。
 */
export async function listPublicDeskSnapshotsByTag(tag: string, limit = 8): Promise<DeskWithDetails[]> {
  const key = publicTagKey(tag)
  if (!isValidPublicTag(key)) return []
  const { data, error } = await supabase
    .from('desks')
    .select('id, title, updated_at, share_snapshot')
    .eq('visibility', 'public')
    .eq('owner_profile_public', true)
    .eq('owner_tag_lower', key)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((row) => ({ ...row, devices: [], connections: [] })) as unknown as DeskWithDetails[]
}

/**
 * 同じガジェットを使っている公開デスクを引く。ガジェット詳細からの逆引き用。
 *
 * 照合は name + category の完全一致。devices に商品 ID の列が無く（009 の
 * atomic publish が書くのは name / category / price / ports / 日付だけ）、
 * productId は share_snapshot の JSON の中にしかないため、一覧では使えない。
 * プリセット由来の名前は誰が登録しても同じ文字列になるので、実用上はこれで拾える。
 * 索引は 067 の devices_name_category_idx。
 *
 * 大文字小文字を無視する ilike は使わない。name は本人の自由入力で、% や _ が
 * 混じっているとワイルドカードとして効き、無関係な公開デスクまで一致する。
 *
 * 写真のあるデスクだけ返す（desk_photos!inner）。このセクションは「同じものを
 * 使っている人のデスクを見て真似する」ためだけにあり、写真の無いタイルを混ぜると
 * 目的そのものが果たせない。
 *
 * ブロック済みユーザーの除外は呼び出し側でやる（blocked_users は本人しか読めず
 * サーバー側で結合できない。listPublicDesks と同じ）。
 */
export async function listPublicDesksWithGadget(input: {
  name: string
  category: string
  /** 今見ているデスク。自分自身を「他のデスク」として並べない */
  excludeDeskId?: string
  /** 自分の公開デスク。真似する先としては意味が無いので総数からも外す */
  excludeUserId?: string
  limit?: number
}): Promise<{ items: PublicDeskListItem[]; total: number }> {
  const name = input.name.trim()
  if (!name) return { items: [], total: 0 }

  let query = supabase
    .from('desks')
    .select(
      'id, user_id, title, owner_name, owner_tag, owner_avatar_url, purposes, total_price, created_at, updated_at, content_updated_at, attributes, desk_photos!inner ( id, image_url, sort_order ), devices!inner ( id )',
      { count: 'exact' },
    )
    .eq('visibility', 'public')
    .eq('devices.name', name)
    .eq('devices.category', input.category)
    .order('updated_at', { ascending: false })
    .limit(input.limit ?? 12)
  if (input.excludeDeskId) query = query.neq('id', input.excludeDeskId)
  if (input.excludeUserId) query = query.neq('user_id', input.excludeUserId)

  const { data, error, count } = await query
  if (error) throw error
  const items = (data ?? []) as PublicDeskListItem[]
  // 件数は limit を越えても正しい値が返る。並べられるのは limit までなので、
  // 表示側は「総数」と「並んでいる数」が食い違いうることを前提にする
  return { items, total: count ?? items.length }
}

/** 検索結果の「ガジェット」タブ1行。公開デスクに載っている機材を name + category で束ねたもの */
export interface PublicGearItem {
  name: string
  category: string
  /** その機材が載っている公開デスクの数。台数ではなくデスクの数（079） */
  desk_count: number
  /** 予測変換から選ばれた機材だけ埋まる。商品ページへ繋ぐときの鍵 */
  product_id: string | null
  /** 公開時に焼いた英字表記（075）。キーと表示名は brandIdentity で引き直す */
  brand: string | null
}

/** 検索語に当たったブランド。見出しに出して、お気に入り・商品一覧へ繋ぐ */
export interface PublicBrandItem {
  brand: string
  desk_count: number
}

/** 検索結果の「ユーザー」タブ1行。公開デスクに焼いてある owner_* を tag で束ねたもの */
export interface PublicProfileItem {
  owner_tag: string
  user_id: string
  owner_name: string | null
  owner_avatar_url: string | null
  desk_count: number
  updated_at: string
}

/**
 * 検索語に当たる機材を、使っているデスクの多い順に返す（079）。
 *
 * 公開デスクの一覧は devices を引いていない（1ページぶんで巨大な JSON になる）ので、
 * 同じ集計を端末側では作れない。当て方は search_public_desks と同じ語彙で、
 * ブランドの別名・カテゴリの別名も通る。
 */
export async function searchPublicGear(query = '', limit = 40): Promise<PublicGearItem[]> {
  const { data, error } = await supabase.rpc('search_public_gear', {
    p_query: normalizePublicDeskSearch(query),
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as PublicGearItem[]
}

/**
 * 検索語に当たるブランドを、使っているデスクの多い順に返す（079）。
 * ブランドの語そのものが当たったときだけ返る（機材名の一部に当たっただけでは出ない）。
 */
export async function searchPublicBrands(query = '', limit = 5): Promise<PublicBrandItem[]> {
  const { data, error } = await supabase.rpc('search_public_brands', {
    p_query: normalizePublicDeskSearch(query),
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as PublicBrandItem[]
}

/**
 * 同じブランド・同じ種類の機材を使っている公開デスク（079）。
 * 検索に完全に当たったぶんを出し切ったあと、その続きとして並べる。
 * 軸（brand / category）は最低1つ渡す。
 */
export async function listPublicDesksByGear(input: {
  brand?: string | null
  category?: string | null
  excludeDeskIds?: string[]
  limit?: number
}): Promise<PublicDeskListItem[]> {
  if (!input.brand && !input.category) return []
  const { data, error } = await supabase.rpc('list_public_desks_by_gear', {
    p_brand: input.brand ?? null,
    p_category: input.category ?? null,
    p_exclude: input.excludeDeskIds?.length ? input.excludeDeskIds : null,
    p_limit: input.limit ?? 12,
  })
  if (error) throw error
  return withDeskCreatedAt((data ?? []) as PublicDeskListItem[])
}

/** 近いデスクの1件。shared_gadgets は元のデスクと同じ機材（ケーブル除く）の数 */
export type SimilarPublicDeskItem = PublicDeskListItem & { shared_gadgets: number }

/**
 * 今見ているデスクに近い公開デスク（089）。同じ機材が多い順、次に同じ用途。
 * 元のデスクの機材は ID ではなく中身で渡す（URL限定のデスクは RLS で devices が
 * 読めないため。理由の詳細は 089 の注記）。
 * ブロック済みユーザーの除外は呼び出し側でやる（listPublicDesksWithGadget と同じ）。
 */
export async function listSimilarPublicDesks(input: {
  gadgets: readonly { name: string; category: string }[]
  purposes?: readonly string[]
  excludeDeskId?: string
  /** 元のデスクの持ち主。同じ人の別デスクで上位が埋まるのを避ける */
  excludeUserId?: string | null
  limit?: number
}): Promise<SimilarPublicDeskItem[]> {
  const gadgets = input.gadgets.filter((g) => g.category !== 'Cable' && g.name.trim())
  const purposes = input.purposes?.length ? [...input.purposes] : null
  if (gadgets.length === 0 && !purposes) return []
  const { data, error } = await supabase.rpc('list_similar_public_desks', {
    p_names: gadgets.map((g) => g.name),
    p_categories: gadgets.map((g) => g.category),
    p_purposes: purposes,
    p_exclude_desk: input.excludeDeskId ?? null,
    p_exclude_user: input.excludeUserId ?? null,
    p_limit: input.limit ?? 12,
  })
  if (error) throw error
  return (data ?? []) as SimilarPublicDeskItem[]
}

/**
 * 検索語に当たる公開プロフィールを、公開デスクの多い順に返す（079）。
 * 開く先は PublicProfileScreen（/u/:tag）なので、タグの無いデスクの人は出てこない。
 */
export async function searchPublicProfiles(query = '', limit = 30): Promise<PublicProfileItem[]> {
  const { data, error } = await supabase.rpc('search_public_profiles', {
    p_query: normalizePublicDeskSearch(query),
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as PublicProfileItem[]
}

// =============================================================
// DEVICES
// =============================================================

export async function getDeskDevices(deskId: string): Promise<Device[]> {
  const { data, error } = await supabase
    .from('devices')
    .select('*')
    .eq('desk_id', deskId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

// =============================================================
// CONNECTIONS (配線図 JSON)
// =============================================================

export async function addConnection(
  deskId: string,
  input: {
    from_device_id: string
    to_device_id: string
    cable_type: string
    label?: string
  }
): Promise<DbConnection> {
  const { data, error } = await supabase
    .from('connections')
    .insert({ desk_id: deskId, ...input })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getDeskConnections(deskId: string): Promise<DbConnection[]> {
  const { data, error } = await supabase
    .from('connections')
    .select('*')
    .eq('desk_id', deskId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

// =============================================================
// DESK VERSIONS (スナップショット)
// =============================================================

export async function saveVersion(
  deskId: string,
  versionName: string,
  snapshot: DeskSnapshot
): Promise<DeskVersion> {
  const { data, error } = await supabase
    .from('desk_versions')
    .insert({ desk_id: deskId, version_name: versionName, snapshot })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function getDeskVersions(deskId: string): Promise<DeskVersion[]> {
  const { data, error } = await supabase
    .from('desk_versions')
    .select('*')
    .eq('desk_id', deskId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// =============================================================
// DESK PHOTOS
// =============================================================

export async function getDeskPhotos(deskId: string): Promise<DeskPhoto[]> {
  const { data, error } = await supabase
    .from('desk_photos')
    .select('*')
    .eq('desk_id', deskId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** デスクごとの先頭の写真。更新一覧の拍手の行が、自分のデスクを写真で見分けるのに使う */
export async function getDeskCoverPhotos(deskIds: readonly string[]): Promise<Record<string, string>> {
  if (deskIds.length === 0) return {}
  const { data, error } = await supabase
    .from('desk_photos')
    .select('desk_id, image_url, sort_order')
    .in('desk_id', [...deskIds])
    .order('sort_order', { ascending: true })
  if (error) throw error
  const covers: Record<string, string> = {}
  for (const photo of data ?? []) {
    if (!covers[photo.desk_id]) covers[photo.desk_id] = photo.image_url
  }
  return covers
}

/** 公開取り消し時に写真のパスを振り直す用（services/storage.ts の rotateDeskImage と対） */
export async function updateDeskPhotoUrl(photoId: string, imageUrl: string, pendingRevocationUrl?: string | null, expectedImageUrl?: string): Promise<void> {
  let query = supabase
    .from('desk_photos')
    .update({ image_url: imageUrl, ...(pendingRevocationUrl !== undefined ? { pending_revocation_url: pendingRevocationUrl } : {}) })
    .eq('id', photoId)
  if (expectedImageUrl !== undefined) query = query.eq('image_url', expectedImageUrl)
  const { error } = await query
    .select('id')
    .single()
  if (error) throw error
}
