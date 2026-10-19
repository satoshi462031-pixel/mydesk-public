import { Alert } from '../utils/alert'
// ブックマーク一覧 — 他ユーザーの公開デスクをブックマークしたものを一覧表示する。
// タップで PublicDesk（閲覧専用画面）へ遷移。件数は表示しない（ユーザー個人の保存機能のため）。
// マイページのタブとして埋め込むほか、単独の画面としても開ける。
import { useFocusEffect } from '@react-navigation/native'
import { useScrollToTopOf } from '../hooks/useScrollToTopOf'
import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Easing,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  View,
} from 'react-native'
import { DeskGridTile } from '../components/molecules/DeskGridTile'
import { SavedSwipeRow } from '../components/molecules/SavedSwipeRow'
import { RemovalMotion, useRemovalMotion } from '../components/molecules/RemovalMotion'
import { animateListChange } from '../components/molecules/FullSwipeRow'
import { UndoSnackbar } from '../components/molecules/UndoSnackbar'
import { useUndoSnackbar } from '../hooks/useUndoSnackbar'
import { restoreAt } from '../utils/fullSwipe'
import { EmptyState } from '../components/molecules/EmptyState'
import { CoachAnchor, useCoachTarget } from '../hooks/useCoachMarks'
import { clapButtonLabel, useDeskClaps } from '../hooks/useDeskClaps'
import { ListSkeleton } from '../components/molecules/ListSkeleton'
import { RetryState } from '../components/molecules/RetryState'
import { ReactionScopeSwitch } from '../components/molecules/ReactionScopeSwitch'
import { GadgetBookmarkList } from '../components/organisms/GadgetBookmarkList'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { analytics, EVENTS } from '../services/analytics'
import { BookmarkedDesk, getBookmarkedDeskPage, removeBookmark } from '../services/desks'
import { getBlockedUserIds } from '../services/moderationService'
import { PlanPurpose } from '../types'
import { deskUpdateStamp, hasUpdate, markSeen, SeenMap, syncSeen } from '../utils/bookmarkSeen'
import { toGadgets, toGadgetUsage, toPhotoUrls } from '../utils/publicDeskAdapter'
import { localizedDemoDeskName } from '../utils/localizedDemoDesk'
import { promptLogin } from '../utils/promptLogin'
import { formatListTimestamp } from '../utils/dateFormat'
import { DeskChange, summarizeDeskChanges } from '../utils/deskChangeSummary'
import { MyPageNavigation } from '../navigation/screenProps'
import { ScrollSyncRequest, synchronizedTabOffset } from '../utils/collapsibleTabScroll'
import { UI_METRICS } from '../constants/ui'
import { useMyPageScrollIndicatorInsets } from '../hooks/useMyPageScrollIndicator'
import { useScrollSyncRetry } from '../hooks/useScrollSyncRetry'
import { hapticSelection } from '../utils/haptics'
import { useSavedCollections } from '../hooks/useSavedCollections'

interface Props {
  navigation: MyPageNavigation
  /** マイページに埋め込むときのプロフィール＋タブバー */
  headerSlot?: ReactNode
  embedded?: boolean
  /** マイページのタブとして埋め込んだときに、表示中かどうか。
      隠れている間に読み込むと、タブを開くたび4タブぶんの取得が同時に飛ぶ */
  active?: boolean
  /** マイページの固定タブバーへ渡すスクロール量。埋め込み時のみ */
  scrollY?: Animated.Value
  scrollSyncRequest?: ScrollSyncRequest
  minimumContentHeight?: number
  headerCollapseDistance?: number
}

// 枠だけになってから一覧から消えるまで。押したことが見えて、取り消しが間に合う長さ
const RELEASE_DELAY_MS = 800
// 2列で10段。1件ごとに配線の中身（share_snapshot）が付くので、みんなのデスクより小さく切る
const BOOKMARK_PAGE_SIZE = 20

function withoutId(ids: Set<string>, id: string): Set<string> {
  if (!ids.has(id)) return ids
  const next = new Set(ids)
  next.delete(id)
  return next
}

export function BookmarkListScreen({
  navigation, headerSlot, embedded, active = true, scrollY, scrollSyncRequest,
  minimumContentHeight, headerCollapseDistance = 0,
}: Props) {
  const { colors: C, lang, isDark, fmtPrice, reduceMotion } = useApp()
  const { user } = useAuth()
  const collections = useSavedCollections(navigation, active)
  const { collectionId, revision: collectionRevision } = collections
  const ja = lang === 'ja'

  const [items,   setItems]   = useState<BookmarkedDesk[]>([])
  const [seen,    setSeen]    = useState<SeenMap>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // 取得に失敗したことを「0件」と混同しない。失敗を空表示にすると、
  // 電波が悪いだけの人に「ブックマークはありません」と言うことになる
  const [loadError, setLoadError] = useState(false)
  // 解除を送っている途中のデスク。1件ずつ止める（全部止めると、続けて外したときに2件目の操作が黙って捨てられる）
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  // 青いブックマークを押して枠だけになり、一覧から消えるのを待っているデスク
  const [releasingIds, setReleasingIds] = useState<Set<string>>(new Set())
  const removal = useRemovalMotion()
  const releaseTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [scope, setScope] = useState<'desks' | 'gadgets'>('desks')
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const scopeProgress = useRef(new Animated.Value(1)).current
  const previousScope = useRef(scope)
  useLayoutEffect(() => {
    const changed = previousScope.current !== scope
    previousScope.current = scope
    if (reduceMotion || !changed) { scopeProgress.setValue(1); return }
    scopeProgress.setValue(0)
    const animation = Animated.timing(scopeProgress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    })
    animation.start()
    return () => animation.stop()
  }, [scope, reduceMotion, scopeProgress])
  const scopeContentStyle = useMemo(() => ({
    opacity: scopeProgress,
    transform: [{ translateX: scopeProgress.interpolate({ inputRange: [0, 1], outputRange: [scope === 'gadgets' ? 14 : -14, 0] }) }],
  }), [scope, scopeProgress])
  const scopeOffsetsRef = useRef({ desks: 0, gadgets: 0 })
  const scopeRequestIdRef = useRef(0)
  const [effectiveScrollRequest, setEffectiveScrollRequest] = useState<ScrollSyncRequest | undefined>(scrollSyncRequest)
  const consumedExternalRequestRef = useRef<ScrollSyncRequest | undefined>(undefined)
  const pendingExternalRequest = scrollSyncRequest !== consumedExternalRequestRef.current
    ? scrollSyncRequest
    : undefined
  const currentScrollRequest = pendingExternalRequest ?? effectiveScrollRequest
  const removeInFlightRef = useRef(new Set<string>())

  // タブバーは一覧と一緒にスクロールで隠れるので、奥まで見たあとタブを替えるには
  // 先頭へ戻る手段が要る。ステータスバーのタップで戻れるようにしておく
  const listRef = useRef<Animated.FlatList>(null)
  const scrollIndicatorInsets = useMyPageScrollIndicatorInsets()
  // 下のタブバーを押したときに先頭へ戻すのは、**表示中のタブだけ**。
  // マイページは4つの一覧を display で出し分けたまま保持していて、4つとも
  // 登録すると隠れているタブまで先頭へ戻り、「タブごとにスクロール位置を保つ」
  // という作りが崩れる。ref の中身が空なら useScrollToTop は何もしない
  useScrollToTopOf(() => (active && scope === 'desks' ? listRef.current : null))
  useLayoutEffect(() => {
    if (pendingExternalRequest) {
      consumedExternalRequestRef.current = pendingExternalRequest
      setEffectiveScrollRequest(pendingExternalRequest)
    }
  }, [pendingExternalRequest])
  const { handlers: scrollSyncHandlers, isActive: scrollActive } = useScrollSyncRetry(currentScrollRequest, active && scope === 'desks', (offset) => {
    listRef.current?.scrollToOffset({ offset, animated: false })
  }, scrollY)

  const changeScope = useCallback((next: 'desks' | 'gadgets') => {
    const previous = scopeRef.current
    if (next === previous) return
    scopeRef.current = next
    const offset = synchronizedTabOffset(
      scopeOffsetsRef.current[previous],
      scopeOffsetsRef.current[next],
      headerCollapseDistance,
    )
    scopeOffsetsRef.current[next] = offset
    scrollY?.setValue(offset)
    setEffectiveScrollRequest({ id: ++scopeRequestIdRef.current, offset })
    setScope(next)
  }, [headerCollapseDistance, scrollY])
  const noteGadgetOffset = useCallback((offset: number) => {
    scopeOffsetsRef.current.gadgets = offset
  }, [])

  // マイページに埋め込んだときだけ、上端に貼り付くタブバーへスクロール量を渡す
  const onScroll = useMemo(
    () => (scrollY
      ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            scopeOffsetsRef.current.desks = Math.max(0, event.nativeEvent.contentOffset.y)
          },
        })
      : undefined),
    [scrollY],
  )

  // 2回目以降はスピナーへ戻さないための印。読み込み済みかどうかしか見ないので
  // state にせず ref に持つ
  const loadedRef = useRef(false)

  // 読み直し・続きの読み込みは、後から始めた読み直しより前の結果を捨てる
  const requestRef = useRef(0)
  const reloadingRef = useRef(false)
  // 解除が届いた順番。解除より前に始まった読み込みは解除前の一覧を返すので、
  // その結果から解除したデスクを抜く（抜かないと、消したタイルが塗りの印のまま戻る）
  const removalSeqRef = useRef(0)
  const removedAtRef = useRef(new Map<string, number>())
  // 左へ引ききって外し、「元に戻す」の期限を待っているデスク。サーバーにはまだ残っているので、
  // その間の読み直しで戻ってこないように抜く
  const pendingReleaseRef = useRef(new Set<string>())
  const withoutRemovedSince = useCallback((bookmarks: BookmarkedDesk[], since: number) =>
    bookmarks.filter((b) => (removedAtRef.current.get(b.desk_id) ?? 0) <= since && !pendingReleaseRef.current.has(b.desk_id)), [])
  const undoSnackbar = useUndoSnackbar()
  // 読み直すときは、続きまで読んで見えている範囲をまとめて引き直す（先頭の1ページに縮めると位置が飛ぶ）
  const loadedRowsRef = useRef(0)
  const cursorRef = useRef<string | undefined>(undefined)
  const [reachedEnd, setReachedEnd] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadingMoreRef = useRef(false)

  useLayoutEffect(() => {
    ++requestRef.current
    setItems([])
    loadedRowsRef.current = 0
    cursorRef.current = undefined
    loadedRef.current = false
    setReachedEnd(false)
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [collectionId])

  const fetchPage = useCallback(async (userId: string, limit: number, before?: string) => {
    // ブロックしたユーザーのデスクは一覧に出さない（ガイドライン 1.2）。
    // ブックマーク自体は消さないので、解除すればまた出てくる。
    const [page, blockedIds] = await Promise.all([
      getBookmarkedDeskPage(userId, limit, before, collectionId),
      getBlockedUserIds(),
    ])
    return { ...page, items: page.items.filter((b) => !blockedIds.has(b.desk.user_id)) }
  }, [collectionId])

  // 比較に使う値（deskUpdateStamp）で記録する。片方だけ updated_at にすると
  // 「更新あり」が二度と出なくなる。既読はフォロー中の人のデスク（084）も共有していて、
  // この一覧はその一部しか持っていないので掃除しない（掃除は更新一覧とベルがやる）
  const syncSeenOf = useCallback((bookmarks: BookmarkedDesk[]) => syncSeen(
    bookmarks.map((b) => ({ deskId: b.desk_id, updatedAt: deskUpdateStamp(b.desk) })),
    { prune: false },
  ), [])

  const load = useCallback(async (refresh: boolean) => {
    if (!user) { setItems([]); setLoading(false); return }
    const requestId = ++requestRef.current
    const since = removalSeqRef.current
    reloadingRef.current = true
    setLoadError(false)
    // 前回の一覧を出したまま裏で取り直す。毎回スピナーへ戻すと、
    // マイページのタブを行き来するだけで一覧がいったん消えて見える
    if (refresh) setRefreshing(true)
    else if (!loadedRef.current) setLoading(true)
    try {
      const page = await fetchPage(user.id, Math.max(BOOKMARK_PAGE_SIZE, loadedRowsRef.current))
      if (requestId !== requestRef.current) return
      const visible = withoutRemovedSince(page.items, since)
      setItems(visible)
      loadedRowsRef.current = page.rowCount
      cursorRef.current = page.nextBefore
      setReachedEnd(page.end)
      loadedRef.current = true
      const nextSeen = await syncSeenOf(visible)
      if (requestId === requestRef.current) setSeen(nextSeen)
    } catch {
      if (requestId === requestRef.current) setLoadError(true)
    } finally {
      if (requestId === requestRef.current) {
        reloadingRef.current = false
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [user, fetchPage, withoutRemovedSince, syncSeenOf])

  const reload = useCallback(() => { void load(false) }, [load])
  const latestListRef = useRef({ collectionId, reload })
  latestListRef.current = { collectionId, reload }
  useFocusEffect(useCallback(() => {
    if (active) reload()
    return () => { ++requestRef.current; reloadingRef.current = false }
  }, [active, reload]))
  const seenCollectionRevision = useRef(collectionRevision)
  useEffect(() => {
    if (seenCollectionRevision.current === collectionRevision) return
    seenCollectionRevision.current = collectionRevision
    if (active) reload()
  }, [active, reload, collectionRevision])

  // 引っぱって更新。一覧はサーバー取得なので、画面を出入りせずに取り直せるようにする
  const handleRefresh = useCallback(() => { void load(true) }, [load])

  // 末尾に着いたら続きを足す。読み直しの途中は、読み直しが範囲ごと取り直すので待つ
  const handleEndReached = useCallback(async () => {
    if (!user || reachedEnd || loadingMoreRef.current || reloadingRef.current || !cursorRef.current) return
    const requestId = requestRef.current
    const since = removalSeqRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const page = await fetchPage(user.id, BOOKMARK_PAGE_SIZE, cursorRef.current)
      if (requestId !== requestRef.current) return
      const more = withoutRemovedSince(page.items, since)
      setItems((prev) => {
        const known = new Set(prev.map((b) => b.id))
        return [...prev, ...more.filter((b) => !known.has(b.id))]
      })
      loadedRowsRef.current += page.rowCount
      cursorRef.current = page.nextBefore
      setReachedEnd(page.end)
      const nextSeen = await syncSeenOf(more)
      if (requestId === requestRef.current) setSeen(nextSeen)
    } catch {
      // 続きの失敗は一覧ごと消さない。末尾まで来たときにもう一度読む
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [user, reachedEnd, fetchPage, withoutRemovedSince, syncSeenOf])

  // タイルは memo なので、行ごとに新しい関数を渡すと毎回描き直される。
  // 既読の記録に updated_at が要るが、items を deps に入れると一覧が動くたびに
  // 参照が変わってしまうので ref から引いて関数を固定する
  const itemsRef = useRef<BookmarkedDesk[]>([])
  itemsRef.current = items

  const handleOpen = useCallback((deskId: string) => {
    if (!navigation.isFocused()) return
    const desk = itemsRef.current.find((b) => b.desk_id === deskId)?.desk
    const updatedAt = desk ? deskUpdateStamp(desk) : ''
    setSeen((prev) => ({ ...prev, [deskId]: updatedAt }))
    void markSeen(deskId, updatedAt)
    navigation.navigate('PublicDesk', { deskId, source: 'bookmark' })
  }, [navigation])

  const handleRemove = useCallback(async (deskId: string) => {
    if (!user || removeInFlightRef.current.has(deskId)) return
    removeInFlightRef.current.add(deskId)
    setRemovingIds((prev) => new Set(prev).add(deskId))
    try {
      await removeBookmark(deskId, user.id)
      removedAtRef.current.set(deskId, ++removalSeqRef.current)
      hapticSelection()
      await removal.run(deskId, () => {
        animateListChange(reduceMotion)
        setItems((prev) => prev.filter((b) => b.desk_id !== deskId))
      }, 'fade')
      analytics.track(EVENTS.BOOKMARK_TOGGLED, { bookmarked: false, placement: 'bookmark_list' })
    } catch {
      Alert.alert(ja ? '削除に失敗しました' : 'Failed to remove', '', [{ text: ja ? '閉じる' : 'Close' }])
    } finally {
      removeInFlightRef.current.delete(deskId)
      setRemovingIds((prev) => withoutId(prev, deskId))
      setReleasingIds((prev) => withoutId(prev, deskId))
    }
  }, [user, ja, removal, reduceMotion])

  // ブックマークを押すとまず枠だけに変え、少し置いてから一覧から外す。消えるまでにもう一度押せば取り消せる
  // （押した瞬間にタイルが消えると、どれを外したのか、押し間違えたのかを確かめられない）
  const toggleRelease = useCallback((deskId: string) => {
    const timers = releaseTimersRef.current
    const pending = timers.get(deskId)
    hapticSelection()
    if (pending) {
      clearTimeout(pending)
      timers.delete(deskId)
      setReleasingIds((prev) => withoutId(prev, deskId))
      return
    }
    setReleasingIds((prev) => new Set(prev).add(deskId))
    timers.set(deskId, setTimeout(() => {
      timers.delete(deskId)
      void handleRemove(deskId)
    }, RELEASE_DELAY_MS))
  }, [handleRemove])

  // 左へ引ききったとき。その場で一覧から外して「元に戻す」を出し、サーバーからは期限が過ぎてから外す。
  // 先に外すと、戻したときに保存し直しになり、保存した順が先頭へ変わってしまう
  const releaseWithUndo = useCallback((deskId: string) => {
    if (!user) return
    const index = itemsRef.current.findIndex((b) => b.desk_id === deskId)
    if (index < 0) return
    const item = itemsRef.current[index]
    const userId = user.id
    const sameDesk = (a: BookmarkedDesk, b: BookmarkedDesk) => a.desk_id === b.desk_id
    const tapTimer = releaseTimersRef.current.get(deskId)
    if (tapTimer) {
      clearTimeout(tapTimer)
      releaseTimersRef.current.delete(deskId)
      setReleasingIds((prev) => withoutId(prev, deskId))
    }
    pendingReleaseRef.current.add(deskId)
    hapticSelection()
    animateListChange(reduceMotion)
    setItems((prev) => prev.filter((b) => b.desk_id !== deskId))
    const title = localizedDemoDeskName(deskId, item.desk.title, lang)
    undoSnackbar.showUndo({
      message: ja ? `「${title}」の保存を解除しました` : `Removed "${title}" from Saved`,
      onUndo: () => {
        pendingReleaseRef.current.delete(deskId)
        animateListChange(reduceMotion)
        if (latestListRef.current.collectionId === collectionId) setItems((prev) => restoreAt(prev, item, index, sameDesk))
        else latestListRef.current.reload()
      },
      onExpire: async () => {
        try {
          await removeBookmark(deskId, userId)
          removedAtRef.current.set(deskId, ++removalSeqRef.current)
          analytics.track(EVENTS.BOOKMARK_TOGGLED, { bookmarked: false, placement: 'bookmark_list' })
        } catch {
          pendingReleaseRef.current.delete(deskId)
          if (latestListRef.current.collectionId === collectionId) setItems((prev) => restoreAt(prev, item, index, sameDesk))
          else latestListRef.current.reload()
          Alert.alert(ja ? '保存を解除できませんでした' : 'Could not remove from Saved')
        } finally {
          pendingReleaseRef.current.delete(deskId)
        }
      },
    })
  }, [user, ja, lang, reduceMotion, undoSnackbar, collectionId])

  // 読み込み中・失敗もヘッダーの下に出す。埋め込み時にここで早期 return すると、
  // プロフィールとタブバーごと消えて別画面に飛んだように見える
  const listEmpty = loading ? (
    <ListSkeleton count={4} variant="card" columns={2} gap={10} inset="none" />
  ) : loadError ? (
    <RetryState
      message={ja ? '保存したデスクを読み込めませんでした。' : 'Could not load your saved desks.'}
      onRetry={reload}
    />
  ) : user ? (
    // ブックマークはサーバーに残るのでアカウントが要る。ゲストには
    // 「保存できます」ではなく、なぜ空なのかを出す
    <EmptyState
      icon="bookmark-outline"
      title={collectionId ? (ja ? 'このフォルダにデスクはありません' : 'No desks in this folder') : (ja ? '保存したデスクはありません' : 'No saved desks yet')}
      description={collectionId ? (ja ? '「すべて」からデスクの「整理」を押して、フォルダに追加できます' : 'Select All and use Organize on a saved desk to add it to this folder.') : (ja ? '公開デスクの「保存」から、あとで見たいデスクを残せます' : 'Use Save on a public desk to keep it for later.')}
      actionLabel={collectionId ? undefined : (ja ? 'みんなのデスクを見る' : 'Go to Explore')}
      onAction={() => navigation.navigate('FeedTab')}
      colors={C}
      coachTarget="saved-empty"
    />
  ) : (
    <EmptyState
      icon="bookmark-outline"
      title={ja ? 'ログインすると使えます' : 'Sign in to save desks'}
      description={ja ? '保存したデスクはアカウントに残るため、ログインが必要です' : 'Saved desks are kept on your account, so logging in is required.'}
      colors={C}
    />
  )

  // 未読ドットは「更新があった」しか言えない。何が変わったかまで出す
  const changeByDeskId = useMemo(() => {
    const map = new Map<string, DeskChange[]>()
    for (const bookmark of items) {
      const summary = summarizeDeskChanges(toGadgets(bookmark.desk), toGadgetUsage(bookmark.desk))
      if (summary) map.set(bookmark.desk_id, summary.changes)
    }
    return map
  }, [items])

  // 履歴の一覧と同じタイルにするので、拍手も同じように押せるようにする
  const promptClapLogin = useCallback(() => {
    promptLogin(navigation, lang, ja ? '拍手するにはログインしてください' : 'Please log in to applaud desks.')
  }, [navigation, lang, ja])
  const deskIds = useMemo(() => items.map((item) => item.desk_id), [items])
  const { likedIds, likeCounts, toggleClap } = useDeskClaps(deskIds, user?.id, 'bookmarks', promptClapLogin)

  const Container = embedded ? View : SafeAreaView
  const scopeTarget = useCoachTarget('saved-scope')

  return (
    <Container style={[styles.container, { backgroundColor: C.bgList }]}>
      <View style={[styles.pane, scope !== 'desks' && styles.paneHidden]}>
      <Animated.FlatList
        scrollIndicatorInsets={scrollIndicatorInsets}
        scrollsToTop={active}
        ref={listRef}
        {...scrollSyncHandlers}
        // ガジェットの一覧と scrollY を共有しているので、隠れている間は書き込ませない
        // （隠れた一覧の位置が詰まったときなどに、出ている側の固定タブバーが跳んでいた）
        onScroll={scrollActive ? (onScroll ?? scrollSyncHandlers.onScroll) : undefined}
        scrollEventThrottle={16}
        data={items}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.textMuted} colors={[C.textMuted]} progressBackgroundColor={C.card} />
        }
        keyExtractor={(b) => b.id}
        ListHeaderComponent={<>{headerSlot}<View ref={scopeTarget} collapsable={false}><ReactionScopeSwitch value={scope} onChange={changeScope} colors={C} lang={lang} /></View>{collections.toolbar}</>}
        ListHeaderComponentStyle={styles.headerBleed}
        contentContainerStyle={[
          items.length === 0 ? styles.emptyContent : styles.listContent,
          minimumContentHeight ? { minHeight: minimumContentHeight } : undefined,
        ]}
        renderItem={({ item }) => (
          <Animated.View style={[styles.gridCell, scopeContentStyle]}>
          <RemovalMotion ref={(handle) => removal.setRef(item.desk_id, handle)} collapse={false}>
          <CoachAnchor id="saved-card"><View collapsable={false}>
          <SavedSwipeRow
            label={localizedDemoDeskName(item.desk_id, item.desk.title, lang)}
            disabled={removingIds.has(item.desk_id)}
            onRemove={() => releaseWithUndo(item.desk_id)}
          >
          <DeskGridTile
            coachKey="saved-card"
            id={item.desk_id}
            title={localizedDemoDeskName(item.desk_id, item.desk.title, lang)}
            photoUri={toPhotoUrls(item.desk)[0]}
            purposes={item.desk.purposes as PlanPurpose[] | undefined}
            authorName={item.desk.owner_name}
            authorAvatarUrl={item.desk.owner_avatar_url}
            authorTag={item.desk.owner_tag}
            meta={formatListTimestamp(item.desk.updated_at, lang)}
            // 中身が変わったときだけ出す。updated_at はタイトルの直しや再公開でも
            // 進み、保存しただけの人に「更新された」と嘘をつく。
            // ここは既読を持っているので期限ではなく「前に見たあとに変わったか」で判定する
            updatedLabel={hasUpdate(seen, item.desk_id, deskUpdateStamp(item.desk))
              ? (ja ? '更新' : 'Updated')
              : null}
            change={changeByDeskId.get(item.desk_id)}
            lang={lang}
            fmtPrice={fmtPrice}
            colors={C}
            isDark={isDark}
            liked={likedIds.has(item.desk_id)}
            likeCount={likeCounts.get(item.desk_id)}
            likeLabel={clapButtonLabel(likedIds.has(item.desk_id), likeCounts.get(item.desk_id), ja)}
            onToggleLike={toggleClap}
            discoveryOrder
            compact
            onPress={handleOpen}
            actionIcon={releasingIds.has(item.desk_id) ? 'bookmark-outline' : 'bookmark'}
            actionTone="saved"
            actionLabel={releasingIds.has(item.desk_id)
              ? (ja ? '保存し直す' : 'Save again')
              : (ja ? '保存を解除' : 'Remove from saved')}
            actionDisabled={removingIds.has(item.desk_id)}
            onAction={toggleRelease}
          />
          </SavedSwipeRow>
          {collections.assignmentButton('desk', item.id, localizedDemoDeskName(item.desk_id, item.desk.title, lang))}
          </View></CoachAnchor>
          </RemovalMotion>
          </Animated.View>
        )}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? (
          <View style={styles.footerLoading}>
            <ActivityIndicator size="small" color={C.accentIcon} />
          </View>
        ) : null}
        ListEmptyComponent={<Animated.View style={scopeContentStyle}>{listEmpty}</Animated.View>}
      />
      <UndoSnackbar
        visible={undoSnackbar.visible}
        message={undoSnackbar.message}
        lang={lang}
        backgroundColor={C.text}
        textColor={C.card}
        accentColor={C.accent}
        onUndo={undoSnackbar.undo}
        undoing={undoSnackbar.undoing}
      />
      </View>
      <View style={[styles.pane, scope !== 'gadgets' && styles.paneHidden]}>
        <GadgetBookmarkList
          scope={scope}
          contentTransitionStyle={scopeContentStyle}
          navigation={navigation}
          headerSlot={headerSlot}
          active={active && scope === 'gadgets'}
          scrollY={scrollY}
          scrollSyncRequest={currentScrollRequest}
          minimumContentHeight={minimumContentHeight}
          onScrollOffset={noteGadgetOffset}
          colors={C}
          lang={lang}
          onShowDesks={() => changeScope('desks')}
          collectionId={collectionId}
          collectionRevision={collectionRevision}
          collectionHeader={collections.toolbar}
          collectionAction={(item) => collections.assignmentButton('gadget', item.id, item.product?.product_name || item.gadget_name || item.product?.name || (ja ? '機材' : 'Gear'))}
        />
      </View>
      {collections.modal}
    </Container>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  pane:         { flex: 1 },
  paneHidden:   { display: 'none' },
  listContent:  { padding: UI_METRICS.screenGutter, gap: 10 },
  // 空表示のときもヘッダー（プロフィール・タブバー）は上に残す。gap は listContent と同じ値にする
  // （無いと読み込み中の骨組みだけ切り替えに貼り付き、一覧が出た瞬間に 10 下へずれる）
  emptyContent: { flexGrow: 1, padding: UI_METRICS.screenGutter, gap: 10 },
  // 下は空けない。切り替えと最初のタイルの間は listContent の gap が持つ
  headerBleed: { marginHorizontal: -UI_METRICS.screenGutter, marginTop: -UI_METRICS.screenGutter, marginBottom: 0 },
  gridRow: { gap: 10 },
  gridCell: { flex: 1, maxWidth: '48.5%' },
  footerLoading: { paddingVertical: 16, alignItems: 'center' },
})
