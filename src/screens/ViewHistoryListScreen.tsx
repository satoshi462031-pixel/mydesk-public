// 履歴 — マイページの「履歴」タブ。「見た」デスクと「拍手した」デスクを切り替えて、新しい順に日ごとに区切って並べる。
// タイルはみんなのデスクと同じ形（同じデスクがタブによって別のものに見えないように）。
// 見た履歴は端末へ保存し、ログイン中のバックアップにも含める。デスクの中身はその都度サーバーから引き直す。
// 見た履歴はログインしていなくても使える（履歴にアカウントは要らない）。拍手はアカウントに残るので要る。
import { useFocusEffect } from '@react-navigation/native'
import { useScrollToTopOf } from '../hooks/useScrollToTopOf'
import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { HistoryDeskRow } from '../components/molecules/HistoryDeskRow'
import { useEntitlement } from '../hooks/useEntitlement'
import { openPaywall } from '../navigation/rootNavigation'
import { PLAN_LIMITS } from '../constants/plans'
import { SegmentedControl } from '../components/atoms/SegmentedControl'
import { HistoryScope, HistoryScopeSwitch } from '../components/molecules/HistoryScopeSwitch'
import { DeskGridTile } from '../components/molecules/DeskGridTile'
import { EmptyState } from '../components/molecules/EmptyState'
import { CoachAnchor, useCoachTarget } from '../hooks/useCoachMarks'
import { clapButtonLabel, useDeskClaps } from '../hooks/useDeskClaps'
import { ListSkeleton } from '../components/molecules/ListSkeleton'
import { RetryState } from '../components/molecules/RetryState'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import {
  getClappedDeskEntries,
  listPublicDesksByIds,
  PublicDeskListItem,
} from '../services/desks'
import { getBlockedUserIds } from '../services/moderationService'
import { PlanPurpose } from '../types'
import { formatListTimestamp } from '../utils/dateFormat'
import { groupHistoryByDay } from '../utils/historyPeriod'
import { useToday } from '../hooks/useToday'
import { localizedDemoDeskName } from '../utils/localizedDemoDesk'
import { promptLogin } from '../utils/promptLogin'
import { loadViewHistory, VIEW_HISTORY_STORAGE_LIMIT } from '../utils/viewHistory'
import { MyPageNavigation } from '../navigation/screenProps'
import { ScrollSyncRequest } from '../utils/collapsibleTabScroll'
import { ICONS } from '../constants/icons'
import { UI_METRICS } from '../constants/ui'
import { useMyPageScrollIndicatorInsets } from '../hooks/useMyPageScrollIndicator'
import { useScrollSyncRetry } from '../hooks/useScrollSyncRetry'

interface Props {
  navigation: MyPageNavigation
  /** マイページのプロフィール＋タブバー */
  headerSlot?: ReactNode
  /** 表示中のタブか。隠れている間は読み込まない */
  active?: boolean
  scrollY?: Animated.Value
  scrollSyncRequest?: ScrollSyncRequest
  minimumContentHeight?: number
}

type Scope = HistoryScope
/** at は見た日時（viewed）か、最後に拍手した日時（clapped） */
type HistoryItem = { desk: PublicDeskListItem; at: string }
type HistoryEntry = { deskId: string; at: string }
const HISTORY_PAGE_SIZE = 40
const DISPLAY_MODE_KEY = 'history_display_mode'
type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'tiles'; key: string; items: HistoryItem[] }

export function ViewHistoryListScreen({
  navigation, headerSlot, active = true, scrollY, scrollSyncRequest, minimumContentHeight,
}: Props) {
  const { colors: C, lang, isDark, fmtPrice } = useApp()
  const { user } = useAuth()
  const { limits, isPro, isLoading: billingLoading } = useEntitlement()
  const ja = lang === 'ja'
  const historyLimit = limits.maxViewHistory
  const [displayMode, setDisplayMode] = useState<'grid' | 'list'>('grid')
  const displayChangedRef = useRef(false)
  useEffect(() => {
    void AsyncStorage.getItem(DISPLAY_MODE_KEY).then((value) => {
      if (!displayChangedRef.current && (value === 'grid' || value === 'list')) setDisplayMode(value)
    }).catch(() => {})
  }, [])
  const changeDisplayMode = (mode: 'grid' | 'list') => {
    displayChangedRef.current = true
    setDisplayMode(mode)
    void AsyncStorage.setItem(DISPLAY_MODE_KEY, mode).catch(() => {})
  }

  const [scope, setScope] = useState<Scope>('viewed')
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [historyCount, setHistoryCount] = useState(0)
  const entriesRef = useRef<HistoryEntry[]>([])
  const cursorRef = useRef(0)
  const moreRequestRef = useRef<number | null>(null)
  const reloadingRef = useRef(false)
  const loadedCountRef = useRef(HISTORY_PAGE_SIZE)
  // 切り替えた直後は前の一覧を出さない（見た履歴が拍手した一覧に見える）
  const loadedScopeRef = useRef<Scope | null>(null)

  // 表示中のタブだけを、下のタブバーの押し直しで先頭へ戻す（BookmarkListScreen と同じ理由）
  const listRef = useRef<Animated.FlatList<Row>>(null)
  const scrollIndicatorInsets = useMyPageScrollIndicatorInsets()
  useScrollToTopOf(() => (active ? listRef.current : null))
  const { handlers: scrollSyncHandlers, isActive: scrollActive } = useScrollSyncRetry(scrollSyncRequest, active, (offset) => {
    listRef.current?.scrollToOffset({ offset, animated: false })
  }, scrollY)

  const onScroll = useMemo(
    () => (scrollY
      ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })
      : undefined),
    [scrollY],
  )

  const fetchPage = useCallback(async (entries: HistoryEntry[], start: number, count: number) => {
    let cursor = start
    const items: HistoryItem[] = []
    // ブロックの一覧は本人しか読めない。ログインしていなければ除く相手もいない
    const blockedIds = user ? await getBlockedUserIds() : new Set<string>()
    while (cursor < entries.length && (cursor < start + count || items.length === 0)) {
      const page = entries.slice(cursor, cursor + HISTORY_PAGE_SIZE)
      const desks = await listPublicDesksByIds(page.map((entry) => entry.deskId))
      const byId = new Map(desks.map((desk) => [desk.id, desk]))
      items.push(...page.flatMap((entry) => {
        const desk = byId.get(entry.deskId)
        if (!desk || blockedIds.has(desk.user_id) || desk.user_id === user?.id) return []
        return [{ desk, at: entry.at }]
      }))
      cursor += page.length
    }
    return { items, cursor }
  }, [user])

  // 後から始めた読み込みより前の結果は捨てる。拍手した側は2往復するので、
  // 見た側へすぐ戻すと拍手した一覧があとから届いて「見た」の下に並んでいた
  const loadRequestRef = useRef(0)
  const load = useCallback(async (target: Scope, mode: 'initial' | 'refresh') => {
    const requestId = ++loadRequestRef.current
    reloadingRef.current = true
    setLoadingMore(false)
    setMoreError(false)
    setLoadError(false)
    if (mode === 'initial' && loadedScopeRef.current !== target) setLoading(true)
    else if (mode === 'refresh') setRefreshing(true)
    try {
      const all = target === 'viewed'
        ? (await loadViewHistory()).map((entry) => ({ deskId: entry.deskId, at: entry.viewedAt }))
        : user
          ? (await getClappedDeskEntries(user.id, VIEW_HISTORY_STORAGE_LIMIT)).map((entry) => ({ deskId: entry.deskId, at: entry.clappedAt }))
          : []
      const entries = target === 'viewed' ? all.slice(0, historyLimit) : all
      const count = loadedScopeRef.current === target ? loadedCountRef.current : HISTORY_PAGE_SIZE
      const next = await fetchPage(entries, 0, count)
      if (requestId !== loadRequestRef.current) return
      entriesRef.current = entries
      cursorRef.current = next.cursor
      loadedCountRef.current = Math.max(HISTORY_PAGE_SIZE, next.cursor)
      setHistoryCount(all.length)
      setHasMore(next.cursor < entries.length)
      setItems(next.items)
      loadedScopeRef.current = target
    } catch {
      if (requestId === loadRequestRef.current) setLoadError(true)
    } finally {
      if (requestId === loadRequestRef.current) {
        reloadingRef.current = false
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [fetchPage, user, historyLimit])

  const loadMore = useCallback(async () => {
    const requestId = loadRequestRef.current
    if (!active || !navigation.isFocused() || !hasMore || reloadingRef.current || moreRequestRef.current === requestId) return
    moreRequestRef.current = requestId
    setLoadingMore(true)
    setMoreError(false)
    try {
      const next = await fetchPage(entriesRef.current, cursorRef.current, HISTORY_PAGE_SIZE)
      if (requestId !== loadRequestRef.current) return
      cursorRef.current = next.cursor
      loadedCountRef.current = next.cursor
      setItems((prev) => [...prev, ...next.items])
      setHasMore(next.cursor < entriesRef.current.length)
    } catch {
      if (requestId === loadRequestRef.current) setMoreError(true)
    } finally {
      if (moreRequestRef.current === requestId) moreRequestRef.current = null
      if (requestId === loadRequestRef.current) setLoadingMore(false)
    }
  }, [fetchPage, hasMore, active, navigation])

  // 見たデスクは詳細を開いた時点で増え、拍手は詳細でも押せるので、タブに戻るたびに引き直す
  useFocusEffect(useCallback(() => {
    if (active) void load(scope, 'initial')
    return () => { ++loadRequestRef.current; reloadingRef.current = false }
  }, [active, load, scope]))

  // ─── 拍手（みんなのデスクのタイルと同じ操作。保存の一覧と共通） ──────
  const promptClapLogin = useCallback(() => {
    promptLogin(navigation, lang, ja ? '拍手するにはログインしてください' : 'Please log in to applaud desks.')
  }, [navigation, lang, ja])
  const deskIds = useMemo(() => items.map((item) => item.desk.id), [items])
  const { likedIds, likeCounts, toggleClap: handleToggleLike } = useDeskClaps(deskIds, user?.id, 'view_history', promptClapLogin)

  const handleOpen = useCallback((deskId: string) => {
    if (!navigation.isFocused()) return
    navigation.navigate('PublicDesk', { deskId, source: 'view_history' })
  }, [navigation])

  const changeScope = useCallback((next: Scope) => {
    // 読み込みは scope が変わって走り直す useFocusEffect に任せる（ここでも呼ぶと2回引く）
    setScope(next)
  }, [])

  useLayoutEffect(() => {
    // 描画前に元の種類へ戻った場合は、取得済みの一覧を消して読み込み待ちにしない。
    loadRequestRef.current++
    setItems([])
    setHasMore(false)
    setLoading(true)
  }, [scope])

  // 日ごとの見出しで区切り、見出しの下は2列で並べる
  const today = useToday()
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = []
    const visible = scope === 'viewed' ? items.slice(0, historyLimit) : items
    for (const group of groupHistoryByDay(visible, (item) => item.at, lang, today)) {
      result.push({ kind: 'header', key: `h-${group.items[0].desk.id}`, label: group.label })
      const columns = displayMode === 'grid' ? 2 : 1
      for (let i = 0; i < group.items.length; i += columns) {
        const pair = group.items.slice(i, i + columns)
        result.push({ kind: 'tiles', key: `t-${pair.map((item) => item.desk.id).join('-')}`, items: pair })
      }
    }
    return result
  }, [items, lang, today, displayMode, scope, historyLimit])

  const listEmpty = loading ? (
    <ListSkeleton count={4} variant="card" columns={2} gap={10} inset="none" />
  ) : loadError ? (
    <RetryState
      message={scope === 'viewed'
        ? (ja ? '見たデスクを読み込めませんでした。' : 'Could not load the desks you viewed.')
        : (ja ? '拍手したデスクを読み込めませんでした。' : 'Could not load the desks you applauded.')}
      onRetry={() => void load(scope, 'initial')}
    />
  ) : scope === 'viewed' ? (
    <EmptyState
      icon={ICONS.history}
      title={ja ? '見たデスクはまだありません' : 'No viewed desks yet'}
      description={ja ? 'みんなのデスクで開いたデスクが、ここに新しい順で残ります' : 'Desks you open in Explore appear here, newest first.'}
      actionLabel={ja ? 'みんなのデスクを見る' : 'Go to Explore'}
      onAction={() => navigation.navigate('FeedTab')}
      colors={C}
      coachTarget="history-empty"
    />
  ) : (
    <EmptyState
      icon={ICONS.clap}
      title={ja ? '拍手したデスクはまだありません' : 'No applauded desks yet'}
      description={user
        ? (ja ? '拍手したデスクが、ここに新しい順で残ります' : 'Desks you applaud appear here, newest first.')
        : (ja ? '拍手はアカウントに残るため、ログインが必要です' : 'Applause is kept on your account, so logging in is required.')}
      actionLabel={ja ? 'みんなのデスクを見る' : 'Go to Explore'}
      onAction={() => navigation.navigate('FeedTab')}
      colors={C}
    />
  )
  const scopeTarget = useCoachTarget('history-scope')

  const renderTile = (item: HistoryItem) => {
    const photo = [...(item.desk.desk_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]
    const liked = likedIds.has(item.desk.id)
    const likeCount = likeCounts.get(item.desk.id)
    if (displayMode === 'list') return (
      <View key={item.desk.id} style={styles.gridCell}><CoachAnchor id="history-card">
        <HistoryDeskRow id={item.desk.id} title={localizedDemoDeskName(item.desk.id, item.desk.title, lang)}
          author={item.desk.owner_name} photoUri={photo?.image_url}
          meta={formatListTimestamp(item.desk.updated_at, lang)} liked={liked}
          onPress={handleOpen} onToggleLike={handleToggleLike} />
      </CoachAnchor></View>
    )
    return (
      <CoachAnchor key={item.desk.id} id="history-card"><View style={styles.gridCell}>
        <DeskGridTile
          coachKey="history-card"
          id={item.desk.id}
          title={localizedDemoDeskName(item.desk.id, item.desk.title, lang)}
          photoUri={photo?.image_url}
          purposes={item.desk.purposes as PlanPurpose[] | undefined}
          authorName={item.desk.owner_name}
          authorAvatarUrl={item.desk.owner_avatar_url}
          authorTag={item.desk.owner_tag}
          // みんなのデスクと同じく、デスクが最後に更新された日。見た日・拍手した日は見出しが持つ
          meta={formatListTimestamp(item.desk.updated_at, lang)}
          lang={lang}
          fmtPrice={fmtPrice}
          colors={C}
          isDark={isDark}
          onPress={handleOpen}
          liked={liked}
          likeCount={likeCount}
          likeLabel={clapButtonLabel(liked, likeCount, ja)}
          onToggleLike={handleToggleLike}
          discoveryOrder
          compact
        />
      </View></CoachAnchor>
    )
  }

  return (
    <View style={[styles.container, { backgroundColor: C.bgList }]}>
      <Animated.FlatList
        scrollIndicatorInsets={scrollIndicatorInsets}
        scrollsToTop={active}
        ref={listRef}
        {...scrollSyncHandlers}
        onScroll={scrollActive ? (onScroll ?? scrollSyncHandlers.onScroll) : undefined}
        scrollEventThrottle={16}
        data={rows}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load(scope, 'refresh')} tintColor={C.textMuted} colors={[C.textMuted]} progressBackgroundColor={C.card} />
        }
        keyExtractor={(row) => row.key}
        ListHeaderComponent={
          <>
            {headerSlot}
            <View ref={scopeTarget} collapsable={false}>
              <HistoryScopeSwitch value={scope} onChange={changeScope} lang={lang} />
            </View>
            <View style={styles.scopeWrap}>
              <SegmentedControl options={[
                { key: 'grid', label: ja ? '写真グリッド' : 'Photo grid' },
                { key: 'list', label: ja ? 'コンパクト一覧' : 'Compact list' },
              ]} value={displayMode} onChange={changeDisplayMode}
                accessibilityLabel={ja ? '履歴の表示形式' : 'History display'} />
            </View>
          </>
        }
        ListHeaderComponentStyle={styles.headerBleed}
        contentContainerStyle={[
          rows.length === 0 ? styles.emptyContent : styles.listContent,
          minimumContentHeight ? { minHeight: minimumContentHeight } : undefined,
        ]}
        renderItem={({ item: row, index }) => row.kind === 'header' ? (
          <Text style={[styles.periodLabel, index === 0 && styles.firstPeriodLabel, { color: C.text }]} accessibilityRole="header">{row.label}</Text>
        ) : (
          // 奇数で余った1件は左に置き、右は空の枠で埋める（みんなのデスクと同じ）
          <View style={styles.gridRow}>
            {row.items.map(renderTile)}
            {displayMode === 'grid' && row.items.length < 2 && <View style={styles.gridCell} />}
          </View>
        )}
        ListEmptyComponent={listEmpty}
        onEndReached={() => { if (!moreError) void loadMore() }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={<View style={styles.footer}>
          {loadingMore && <ActivityIndicator color={C.accentIcon} />}
          {moreError && <TouchableOpacity accessibilityRole="button" onPress={() => void loadMore()}>
            <Text style={{ color: C.accentText }}>{ja ? '続きを再読み込み' : 'Retry loading more'}</Text>
          </TouchableOpacity>}
          {!hasMore && !loading && !loadError && scope === 'viewed' && !isPro && !billingLoading && historyCount >= PLAN_LIMITS.free.maxViewHistory && (
            <TouchableOpacity accessibilityRole="button" onPress={() => { if (navigation.isFocused()) openPaywall(navigation, 'maxViewHistory') }}
              style={[styles.upgrade, { backgroundColor: C.card, borderColor: C.border }]}>
              <Text style={[styles.upgradeTitle, { color: C.accentText }]}>{ja ? 'Proなら最新1,000件まで残せます' : 'Keep your latest 1,000 viewed desks with Pro'}</Text>
              <Text style={{ color: C.textSub, fontSize: 12 }}>{ja ? '無料は最新100件。保存範囲から消えた履歴は復元されません。' : 'Free keeps 100. Previously discarded history cannot be recovered.'}</Text>
            </TouchableOpacity>
          )}
        </View>}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: UI_METRICS.screenGutter, gap: 10 },
  // gap は listContent と同じ値にする（無いと読み込み中の骨組みだけ切り替えに貼り付き、一覧が出た瞬間に 10 下へずれる）
  emptyContent: { flexGrow: 1, padding: UI_METRICS.screenGutter, gap: 10 },
  headerBleed: { marginHorizontal: -UI_METRICS.screenGutter, marginTop: -UI_METRICS.screenGutter, marginBottom: 0 },
  // 表示形式の切り替え。上の「見た／拍手した」（HistoryScopeSwitch）と同じ余白で並べる
  scopeWrap: { paddingHorizontal: UI_METRICS.screenGutter, paddingTop: 12 },
  // 見出しは区切りなので、上の段との間を広めに取る（下のタイルとの間は一覧の gap）
  periodLabel: { fontSize: 15, fontWeight: '700', marginTop: 6 },
  firstPeriodLabel: { marginTop: 0 },
  gridRow: { flexDirection: 'row', gap: 10 },
  gridCell: { flex: 1 },
  footer: { paddingVertical: 12, gap: 12 },
  upgrade: { padding: 16, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  upgradeTitle: { fontSize: 14, fontWeight: '700' },
})
