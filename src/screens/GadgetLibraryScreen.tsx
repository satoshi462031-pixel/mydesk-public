import { useFocusEffect } from '@react-navigation/native'
import { useScrollToTopOf } from '../hooks/useScrollToTopOf'
import { ReactNode, RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { AppIcon } from '../components/atoms/AppIcon'
import { SearchField } from '../components/atoms/SearchField'
import { AdBanner } from '../components/molecules/AdBanner'
import { EmptyState as EmptyStateView } from '../components/molecules/EmptyState'
import { CoachAnchor, CoachTargetRef, useCoachTarget } from '../hooks/useCoachMarks'
import { ListSkeleton } from '../components/molecules/ListSkeleton'
import { RetryState } from '../components/molecules/RetryState'
import { GadgetCard } from '../components/molecules/GadgetCard'
import { SegmentedControl } from '../components/atoms/SegmentedControl'
import { buildGadgetLibraryUsage, filterGadgetLibrary, GadgetLibraryFilter, libraryDeskLabel, libraryUsagePeriodLabel } from '../utils/gadgetLibrary'
import { GadgetListChoiceButton } from '../components/molecules/GadgetListFloatingControls'
import { FavoriteSwipeRow } from '../components/molecules/FavoriteSwipeRow'
import { RemovalMotion, useRemovalMotion } from '../components/molecules/RemovalMotion'
import { swipeRevealStyle } from '../components/molecules/DeskSwipeActions'
import { BottomSheetModal } from '../components/molecules/BottomSheetModal'
import { GadgetDetailSheet } from '../components/organisms/GadgetDetailSheet'
import { UndoSnackbar } from '../components/molecules/UndoSnackbar'
import { ICONS } from '../constants/icons'
import { AppColors, useApp } from '../context/AppContext'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { useUndoSnackbar } from '../hooks/useUndoSnackbar'
import { useGadgetDeletion } from '../hooks/useGadgetDeletion'
import { useSwipePeekHint } from '../hooks/useSwipePeekHint'
import { Gadget } from '../types'
import { updateDeskGadgetSelection } from '../utils/deskGadgetUsage'
import { SWIPE_OPEN_THRESHOLD, UI_METRICS, UI_STATUS_COLORS, UI_STATUS_ON_WARNING } from '../constants/ui'
import { buildGadgetSearchIndex, matchesGadgetSearch, normalizeGadgetSearch } from '../utils/gadgetSearch'
import { localizedGadgetName } from '../utils/localizedGadgetName'
import { brandDisplay, brandFromGadgetName, brandKey } from '../utils/brandIdentity'
import { BRANDS_ENABLED } from '../constants/features'
import { MyPageNavigation } from '../navigation/screenProps'
import { showConfirmation, showMessage } from '../utils/confirmation'
import { gadgetTrashDaysRemaining, isGadgetTrashExpired, sortGadgetsByDeletedDesc } from '../utils/gadgetTrash'
import { ScrollSyncRequest } from '../utils/collapsibleTabScroll'
import { hapticSelection, hapticWarning } from '../utils/haptics'
import { isOwnedGadget } from '../utils/gadgetStats'
import { ChoiceSheet, ChoiceSheetOption } from '../components/organisms/ChoiceSheet'
import { useMyPageScrollIndicatorInsets } from '../hooks/useMyPageScrollIndicator'
import { useScrollSyncRetry } from '../hooks/useScrollSyncRetry'

// マイページの「ガジェット」タブとして埋め込むほか、単独の画面としても開ける。
// headerSlot にはマイページのプロフィール＋タブバーが入り、検索欄の上に積まれる
type Props = {
  navigation: MyPageNavigation
  headerSlot?: ReactNode
  embedded?: boolean
  /** マイページのタブとして埋め込んだときに、表示中かどうか */
  active?: boolean
  /** 全デスク横断の統計への入口。一覧の先頭に固定行として出す */
  onOpenStats?: () => void
  /** マイページの固定タブバーへ渡すスクロール量。埋め込み時のみ */
  scrollY?: Animated.Value
  scrollSyncRequest?: ScrollSyncRequest
  minimumContentHeight?: number
}
type GroupMode = 'none' | 'brand'

/** ブランドを名前から引けなかったガジェットの置き場。一覧から消さずに末尾へ集める */
const OTHER_BRAND_KEY = '__other'

/**
 * ブランド別を出しはじめる持ち物の数。
 *
 * ブランドは登録した名前の先頭から引くので、引けないものは全部「その他」に落ちる。
 * 数点しか持っていないうちに切り替えると、1 群しかない一覧になって壊れて見える。
 */
const BRAND_GROUPING_MIN = 8

type ListItem =
  | { _key: string; type: 'brand'; brandKey: string; title: string; subtitle?: string; count: number; expanded: boolean }
  | { _key: string; type: 'gadget'; gadget: Gadget; isLast: boolean }

// ─── Component ───────────────────────────────────────────────────────────────
export function GadgetLibraryScreen({
  navigation, headerSlot, embedded, active = true, onOpenStats, scrollY,
  scrollSyncRequest, minimumContentHeight,
}: Props) {
  const { gadgets, deletedGadgets, loading, loadError, reload, toggleFavorite: toggleGadgetFavorite, setFavorite, setDisposedAt } = useGadgets()
  const { plans, loading: plansLoading, loadError: plansLoadError, reload: reloadPlans, updateWith: updatePlanWith } = usePlans()
  const {
    deleteGadget,
    deleteGadgets,
    deleteGadgetsPermanently,
    restoreGadgets,
  } = useGadgetDeletion()
  const { colors, t, lang, fmtPrice, fmtDimStr, unitLabel } = useApp()
  const ja = lang === 'ja'
  const ownedCount = gadgets.filter(isOwnedGadget).length
  const undoSnackbar = useUndoSnackbar()
  const removal = useRemovalMotion()
  const trashRemoval = useRemovalMotion()

  // ガジェットのシートに並ぶタイルは memo。行ごとに関数を作らない
  const openPublicDeskFromGadget = useCallback((deskId: string) => {
    if (!navigation.isFocused()) return
    navigation.push('PublicDesk', { deskId, source: 'gadget_desks' })
  }, [navigation])

  const [deletingGadgetId, setDeletingGadgetId] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const bulkDeleteInFlightRef = useRef(false)
  const trashOperationInFlightRef = useRef(false)
  const [trashVisible, setTrashVisible] = useState(false)
  const [trashBusyId, setTrashBusyId] = useState<string | null>(null)
  const retiringGadgetIdsRef = useRef(new Set<string>())
  const disposingGadgetIdsRef = useRef(new Set<string>())
  const purgingExpiredRef = useRef('')

  const expiredDeletedGadgets = useMemo(
    () => deletedGadgets.filter((gadget) => isGadgetTrashExpired(gadget)),
    [deletedGadgets],
  )
  const trashListGadgets = useMemo(() => sortGadgetsByDeletedDesc(deletedGadgets), [deletedGadgets])
  useEffect(() => {
    const signature = expiredDeletedGadgets.map((gadget) => gadget.id).sort().join(',')
    if (!signature || purgingExpiredRef.current === signature || trashOperationInFlightRef.current) return
    trashOperationInFlightRef.current = true
    purgingExpiredRef.current = signature
    void deleteGadgetsPermanently(expiredDeletedGadgets).catch(() => {
      purgingExpiredRef.current = ''
    }).finally(() => {
      trashOperationInFlightRef.current = false
    })
  }, [deleteGadgetsPermanently, expiredDeletedGadgets, trashBusyId])

  const usedGadgetIds = useMemo(() => {
    const ids = new Set<string>()
    for (const plan of plans) {
      plan.selectedGadgetIds.forEach((id) => ids.add(id))
    }
    return ids
  }, [plans])

  const libraryUsage = useMemo(() => buildGadgetLibraryUsage(gadgets, plans), [gadgets, plans])
  const [usageFilter, setUsageFilter] = useState<GadgetLibraryFilter>('current')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const usageCounts = useMemo(() => {
    const counts = { current: 0, unused: 0 }
    for (const usage of libraryUsage.values()) counts[usage.status === 'current' ? 'current' : 'unused']++
    return counts
  }, [libraryUsage])

  // ─── 検索 ───────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const searchInputRef = useRef<TextInput>(null)
  const pendingLibraryAddRef = useRef<Set<string> | null>(null)

  // 商品名・メモ・カテゴリ名（表示言語）を畳んだ索引。持ち物が変わったときだけ作る
  const searchIndex = useMemo(
    () => buildGadgetSearchIndex(gadgets, (category) => t('category.' + category)),
    [gadgets, t],
  )

  const filteredGadgets = useMemo(() => {
    const q = normalizeGadgetSearch(search)
    return filterGadgetLibrary(gadgets, libraryUsage, usageFilter, favoritesOnly)
      .filter((gadget) => !q || matchesGadgetSearch(searchIndex, gadget.id, q))
  }, [gadgets, libraryUsage, usageFilter, favoritesOnly, search, searchIndex])

  // ─── 撤去の Undo ────────────────────────────────────────────────────
  // 撤去＝置いていた全デスクから下ろす。持ち物リストにも履歴にも残り、
  // 在籍期間に終了日が入るだけ。「もう使っていない」を記録する非破壊の操作で、
  // 完全に消す削除（ガジェット詳細の一番下）とは別物として分けている
  const retireWithUndo = useCallback(async (items: Gadget[]) => {
    if (items.some((item) => retiringGadgetIdsRef.current.has(item.id))) return
    items.forEach((item) => retiringGadgetIdsRef.current.add(item.id))
    const itemIds = items.map((g) => g.id)
    const itemIdSet = new Set(itemIds)
    // Undo で戻す先を先に控える。実際に置いてあったデスクだけを対象にする
    const affectedPlanIds = plans
      .filter((plan) => plan.selectedGadgetIds.some((id) => itemIdSet.has(id)))
      .map((plan) => plan.id)
    try {
      // updateDeskGadgetSelection を通す。ここで在籍期間に撤去日が入る。
      // selectedGadgetIds だけ削ると、年表に「いつまで使っていたか」が残らない
      await removal.run(usageFilter === 'current' ? itemIds : [], async () => {
        for (const planId of affectedPlanIds) {
          await updatePlanWith(planId, (prev) => ({
            ...updateDeskGadgetSelection(
              prev,
              prev.selectedGadgetIds.filter((id) => !itemIdSet.has(id)),
              gadgets,
            ),
            updatedAt: new Date().toISOString(),
          }))
        }
      }, 'fade')
      hapticWarning()
      undoSnackbar.showUndo({
        message: items.length === 1
          ? (ja ? `「${items[0].name}」を撤去しました` : `Retired "${items[0].name}"`)
          : (ja
            ? `${items.length}件を撤去しました`
            : `Retired ${items.length} ${items.length === 1 ? 'item' : 'items'}`),
        // 撤去日が「今日」のまま戻すので、updateDeskGadgetSelection が期間を
        // 閉じ直さずに再開する（新しい期間を足して年表が2本に割れない）
        onUndo: async () => {
          for (const planId of affectedPlanIds) {
            await updatePlanWith(planId, (prev) => ({
              ...updateDeskGadgetSelection(
                prev,
                [...new Set([...prev.selectedGadgetIds, ...itemIds])],
                gadgets,
              ),
              updatedAt: new Date().toISOString(),
            }), { awaitPersistence: true })
          }
        },
      })
    } finally {
      items.forEach((item) => retiringGadgetIdsRef.current.delete(item.id))
    }
  }, [ja, gadgets, plans, updatePlanWith, undoSnackbar, removal, usageFilter])

  const [groupMode, setGroupMode] = useState<GroupMode>('none')
  const [groupSheetOpen, setGroupSheetOpen] = useState(false)
  // ブランド別へ切り替えた直後は「その他」を含めてすべて閉じる。
  // 見たいブランドだけ開けるよう、開いているものだけを保持する
  const [expandedBrandKeys, setExpandedBrandKeys] = useState<Set<string>>(() => new Set())
  const toggleBrand = useCallback((key: string) => {
    setExpandedBrandKeys((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  // 持ち物が減って切り替えを出さなくなったときも、選択だけ 'brand' で残さない
  // ブランドの分類を閉じている間は「ブランド別」を出さない（constants/features の BRANDS_ENABLED）
  const canGroupByBrand = BRANDS_ENABLED && gadgets.length >= BRAND_GROUPING_MIN
  const effectiveGroupMode: GroupMode = groupMode === 'brand' && !canGroupByBrand ? 'none' : groupMode
  useEffect(() => {
    if (groupMode === 'brand' && !canGroupByBrand) setGroupMode('none')
  }, [canGroupByBrand, groupMode])

  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map())
  const toggleFavorite = useCallback((gadget: Gadget) => {
    swipeableRefs.current.get(gadget.id)?.close()
    void removal.run(favoritesOnly && gadget.favorite ? gadget.id : [], () => toggleGadgetFavorite(gadget.id), 'fade').then((updated) => {
      if (updated && !updated.favorite) undoSnackbar.showUndo({
        message: ja ? `「${localizedGadgetName(updated, lang)}」のお気に入りを解除しました` : `Removed "${localizedGadgetName(updated, lang)}" from favorites`,
        onUndo: () => setFavorite(updated.id, true),
      })
    }).catch(() => showMessage(
      ja ? 'お気に入りを変更できませんでした' : 'Could not update favorite',
      ja ? 'もう一度お試しください。' : 'Please try again.',
    ))
  }, [ja, lang, toggleGadgetFavorite, setFavorite, undoSnackbar, removal, favoritesOnly])
  const listRef       = useRef<Animated.FlatList>(null)
  const scrollIndicatorInsets = useMyPageScrollIndicatorInsets()
  const fallbackScrollRef = useRef<ScrollView>(null)

  // 下のタブバーを押したときに先頭へ戻すのは、**表示中のタブだけ**。
  // マイページは4つの一覧を display で出し分けたまま保持していて、4つとも
  // 登録すると隠れているタブまで先頭へ戻り、「タブごとにスクロール位置を保つ」
  // という作りが崩れる。ref の中身が空なら useScrollToTop は何もしない
  useScrollToTopOf(() => (active ? (listRef.current ?? fallbackScrollRef.current) : null))
  const { handlers: scrollSyncHandlers, rearm: rearmScrollSync, isActive: scrollActive } = useScrollSyncRetry(scrollSyncRequest, active, (offset) => {
    listRef.current?.scrollToOffset({ offset, animated: false })
    fallbackScrollRef.current?.scrollTo({ y: offset, animated: false })
  }, scrollY)
  // 部品が替わると新しい一覧は先頭から始まるが、固定のタブバーは前の位置のまま残る。直前の位置へ戻す
  const lastOffsetRef = useRef(0)
  useEffect(() => {
    if (!scrollY) return
    const id = scrollY.addListener(({ value }) => { lastOffsetRef.current = Math.max(0, value) })
    return () => scrollY.removeListener(id)
  }, [scrollY])
  const libraryLoading = loading || plansLoading
  const libraryLoadError = (loadError && gadgets.length === 0) || plansLoadError
  const listKind = libraryLoading ? 'loading' : libraryLoadError ? 'error' : gadgets.length === 0 && deletedGadgets.length === 0 ? 'empty' : 'list'
  const previousListKindRef = useRef(listKind)
  useEffect(() => {
    if (previousListKindRef.current === listKind) return
    previousListKindRef.current = listKind
    rearmScrollSync(lastOffsetRef.current)
  }, [listKind, rearmScrollSync])

  // マイページに埋め込んだときだけ、上端に貼り付くタブバーへスクロール量を渡す
  const onScroll = useMemo(
    () => (scrollY
      ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })
      : undefined),
    [scrollY],
  )
  useFocusEffect(useCallback(() => { if (active) { reload(); void reloadPlans() } }, [active, reload, reloadPlans]))

  // ─── ブランド別グルーピング ───────────────────────────────────────
  // ガジェットにブランド欄は無いので、登録した名前の先頭から引く。
  // 検索の1打鍵ごとに180件のブランド表を舐め直さないよう、判定は gadgets 単位で持つ
  const otherBrandLabel = ja ? 'その他' : 'Other'
  const brandByGadgetId = useMemo(() => {
    const map = new Map<string, { key: string; label: string; reading?: string }>()
    for (const g of gadgets) {
      const raw = brandFromGadgetName(g.name)
      // 表題は商品に印字されている英字表記にする。日本語表記を主にすると
      // 「Anker」を「アンカー」と出すことになり、持ち物と結びつかない
      const label = brandDisplay(raw, 'en')
      const reading = brandDisplay(raw, 'ja')
      map.set(g.id, {
        key: brandKey(raw) ?? OTHER_BRAND_KEY,
        label: label ?? otherBrandLabel,
        reading: ja && reading && reading !== label ? reading : undefined,
      })
    }
    return map
  }, [gadgets, ja, otherBrandLabel])

  const groupedByBrand = useMemo(() => {
    if (!canGroupByBrand) return []
    const map = new Map<string, { key: string; label: string; reading?: string; gadgets: Gadget[] }>()
    for (const g of filteredGadgets) {
      const brand = brandByGadgetId.get(g.id) ?? { key: OTHER_BRAND_KEY, label: otherBrandLabel, reading: undefined }
      const found = map.get(brand.key)
      if (found) found.gadgets.push(g)
      else map.set(brand.key, { key: brand.key, label: brand.label, reading: brand.reading, gadgets: [g] })
    }
    const groups = [...map.values()]
    // 持っている数の多い順。カテゴリ別と違って決まった並び順がないので数で並べる
    groups.sort((a, b) => {
      if (a.key === OTHER_BRAND_KEY) return 1
      if (b.key === OTHER_BRAND_KEY) return -1
      return b.gadgets.length - a.gadgets.length || a.label.localeCompare(b.label)
    })
    return groups
  }, [filteredGadgets, brandByGadgetId, otherBrandLabel, canGroupByBrand])

  const brandListData = useMemo((): ListItem[] => {
    const items: ListItem[] = []
    for (const group of groupedByBrand) {
      const expanded = expandedBrandKeys.has(group.key)
      items.push({
        _key: `__brand_${group.key}`,
        type: 'brand',
        brandKey: group.key,
        title: group.label,
        subtitle: group.reading,
        count: group.gadgets.length,
        expanded,
      })
      if (!expanded) continue
      group.gadgets.forEach((g, i, arr) => {
        items.push({ _key: `${group.key}_${g.id}`, type: 'gadget', gadget: g, isLast: i === arr.length - 1 })
      })
    }
    return items
  }, [groupedByBrand, expandedBrandKeys])

  const flatListData = useMemo((): ListItem[] => filteredGadgets.map((gadget, index) => ({
    _key: gadget.id, type: 'gadget', gadget, isLast: index === filteredGadgets.length - 1,
  })), [filteredGadgets])
  const listData = effectiveGroupMode === 'brand' ? brandListData : flatListData

  const groupModeOptions: ChoiceSheetOption<GroupMode>[] = [
    { key: 'none', label: groupNoneLabel(ja), help: ja ? 'まとめずに1台ずつ並べる' : 'One row per gadget' },
    ...(canGroupByBrand
      ? [{ key: 'brand' as const, label: ja ? 'ブランド別' : 'By brand', help: ja ? 'どこの製品で揃えているかを見る' : 'See which brands you use' }]
      : []),
  ]
  const currentGroupLabel = groupModeOptions.find((option) => option.key === effectiveGroupMode)?.label ?? groupModeOptions[0].label

  // 撤去・削除はスワイプで出す。持ち物タブを初めて開いたときに先頭の1台で見せる
  const firstListGadget = listData.find((item) => item.type === 'gadget')
  useSwipePeekHint({
    storageKey: '@gadget_library_swipe_hint_seen_v1',
    rowId: !selectionMode && firstListGadget?.type === 'gadget' ? firstListGadget.gadget.id : null,
    rows: swipeableRefs,
    sides: 'right',
    active,
  })

  // ─── ヘッダー ────────────────────────────────────────────────────
  // 配線図の四角と同じ導線に揃える。カードのタップでは編集画面へ直行せず
  // 詳細シートを開き、編集はシート内の鉛筆から入る。
  const [infoGadget, setInfoGadget] = useState<Gadget | null>(null)
  const openGadgetDetail = useCallback((gadget: Gadget) => setInfoGadget(gadget), [])
  const toggleDisposal = useCallback(async (gadget: Gadget) => {
    if (usedGadgetIds.has(gadget.id) || disposingGadgetIdsRef.current.has(gadget.id)) return
    disposingGadgetIdsRef.current.add(gadget.id)
    const previous = gadget.disposedAt
    const disposedAt = previous ? undefined : new Date().toISOString()
    try {
      const updated = await setDisposedAt(gadget.id, disposedAt)
      if (!updated) return
      setInfoGadget((current) => current?.id === gadget.id ? updated : current)
      hapticSelection()
      undoSnackbar.showUndo({
        message: disposedAt
          ? (ja ? `「${localizedGadgetName(gadget, lang)}」を処分済みにしました` : `Marked "${localizedGadgetName(gadget, lang)}" as disposed`)
          : (ja ? '処分済みを取り消しました' : 'Disposal undone'),
        onUndo: async () => {
          const restored = await setDisposedAt(gadget.id, previous)
          if (restored) setInfoGadget((current) => current?.id === gadget.id ? restored : current)
        },
      })
    } catch {
      showMessage(ja ? '処分状態を変更できませんでした' : 'Could not update disposal status', ja ? 'もう一度お試しください。' : 'Please try again.')
    } finally {
      disposingGadgetIdsRef.current.delete(gadget.id)
    }
  }, [ja, lang, setDisposedAt, undoSnackbar, usedGadgetIds])
  const confirmDeleteGadget = useCallback((gadget: Gadget) => {
    const displayName = localizedGadgetName(gadget, lang)
    showConfirmation({
      title: ja ? 'このガジェットを削除しますか？' : 'Delete this gadget?',
      message: ja
        ? `「${displayName}」を「最近削除した項目」へ移します。30日以内ならデスクの履歴ごと復元できます。`
        : `Move "${displayName}" to Recently Deleted? You can restore it with its desk history for 30 days.`,
      cancelLabel: t('common.cancel'),
      confirmLabel: t('common.delete'),
      destructive: true,
      onConfirm: () => {
        setDeletingGadgetId(gadget.id)
        void removal.run(gadget.id, () => deleteGadget(gadget))
          .then(() => setInfoGadget(null))
          .catch(() => showMessage(
            ja ? '削除できませんでした' : 'Could not delete',
            ja ? 'もう一度お試しください。' : 'Please try again.',
          ))
          .finally(() => setDeletingGadgetId(null))
      },
    })
  }, [deleteGadget, ja, lang, t, removal])

  // 左スワイプで、撤去・削除を同じ場所から操作できる。どのデスクに置くかはデスク側の機材で決める
  const renderRightActions = useCallback((gadget: Gadget, progress: Animated.AnimatedInterpolation<number>) => (
    <View style={styles.rightActions}>
      {/* 短いスワイプでも最初に削除が見えるよう、カードに最も近い位置へ置く */}
      <Animated.View style={[styles.swipeButtonWrap, swipeRevealStyle(progress)]}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: UI_STATUS_COLORS.danger }]}
          onPress={() => {
            swipeableRefs.current.get(gadget.id)?.close()
            confirmDeleteGadget(gadget)
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={ja ? '削除' : 'Delete'}
        >
          <AppIcon name={ICONS.trash} size={20} color="#fff" />
          <Text style={styles.actionLabel}>{ja ? '削除' : 'Delete'}</Text>
        </TouchableOpacity>
      </Animated.View>
      {usedGadgetIds.has(gadget.id) && (
        <Animated.View style={[styles.swipeButtonWrap, swipeRevealStyle(progress)]}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: UI_STATUS_COLORS.warning }]}
            onPress={() => {
              swipeableRefs.current.get(gadget.id)?.close()
              void retireWithUndo([gadget])
            }}
            activeOpacity={0.8}
          >
            <AppIcon name={ICONS.retire} size={20} color={UI_STATUS_ON_WARNING} />
            <Text style={[styles.actionLabel, { color: UI_STATUS_ON_WARNING }]}>{ja ? '撤去' : 'Retire'}</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
      {!usedGadgetIds.has(gadget.id) && (
        <Animated.View style={[styles.swipeButtonWrap, swipeRevealStyle(progress)]}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: UI_STATUS_COLORS.warning }]}
            onPress={() => {
              swipeableRefs.current.get(gadget.id)?.close()
              void toggleDisposal(gadget)
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={gadget.disposedAt ? (ja ? '処分済みを取り消す' : 'Undo disposal') : (ja ? '処分' : 'Dispose')}
          >
            <AppIcon name={gadget.disposedAt ? 'undo-variant' : 'package-variant-closed-remove'} size={20} color={UI_STATUS_ON_WARNING} />
            <Text style={[styles.actionLabel, { color: UI_STATUS_ON_WARNING }]}>{gadget.disposedAt ? (ja ? '取消' : 'Undo') : (ja ? '処分' : 'Dispose')}</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  ), [confirmDeleteGadget, ja, retireWithUndo, toggleDisposal, usedGadgetIds])

  const toggleSelected = useCallback((gadget: Gadget) => {
    hapticSelection()
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(gadget.id)) next.delete(gadget.id)
      else next.add(gadget.id)
      return next
    })
  }, [])

  const beginSelectionWith = useCallback((gadget: Gadget) => {
    swipeableRefs.current.get(gadget.id)?.close()
    setSelectionMode(true)
    setSelectedIds(new Set([gadget.id]))
  }, [])

  const leaveSelectionMode = useCallback(() => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }, [])

  const openAddGadget = useCallback(() => {
    if (!navigation.isFocused()) return
    pendingLibraryAddRef.current = new Set(gadgets.map((gadget) => gadget.id))
    navigation.navigate('AddGadget', { showCategoryPicker: true })
  }, [gadgets, navigation])

  useFocusEffect(useCallback(() => {
    if (!active || libraryLoading || libraryLoadError) return
    const known = pendingLibraryAddRef.current
    if (!known) return
    pendingLibraryAddRef.current = null
    const added = gadgets.find((gadget) => !known.has(gadget.id))
    if (!added) return
    swipeableRefs.current.forEach((row) => row.close())
    leaveSelectionMode()
    setUsageFilter(libraryUsage.get(added.id)?.status === 'current' ? 'current' : 'unused')
    setFavoritesOnly(false)
    setSearch('')
    setGroupMode('none')
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
    fallbackScrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [active, gadgets, leaveSelectionMode, libraryLoadError, libraryLoading, libraryUsage]))

  const visibleGadgetIds = useMemo(() => new Set(filteredGadgets.map((gadget) => gadget.id)), [filteredGadgets])
  const selectedGadgetCount = gadgets.filter((gadget) => selectedIds.has(gadget.id)).length
  const hiddenSelectedCount = gadgets.filter((gadget) => selectedIds.has(gadget.id) && !visibleGadgetIds.has(gadget.id)).length

  const confirmBulkDelete = useCallback(() => {
    const targets = gadgets.filter((gadget) => selectedIds.has(gadget.id))
    if (targets.length === 0 || bulkDeleteInFlightRef.current) return
    const hiddenTargets = targets.filter((gadget) => !visibleGadgetIds.has(gadget.id))
    const hiddenNames = hiddenTargets.slice(0, 5).map((gadget) => localizedGadgetName(gadget, lang)).join('、')
    const hiddenNotice = hiddenTargets.length > 0
      ? (ja
        ? `\n\n表示外の${hiddenTargets.length}件も削除対象です：\n${hiddenNames}${hiddenTargets.length > 5 ? ` ほか${hiddenTargets.length - 5}件` : ''}`
        : `\n\nIncludes ${hiddenTargets.length} hidden items:\n${hiddenNames}${hiddenTargets.length > 5 ? ` +${hiddenTargets.length - 5} more` : ''}`)
      : ''
    showConfirmation({
      title: ja ? `${targets.length}件を削除しますか？` : `Delete ${targets.length} items?`,
      message: (ja
        ? '「最近削除した項目」へ移します。30日以内ならデスクの履歴ごと復元できます。'
        : 'They will move to Recently Deleted. You can restore them with their desk history for 30 days.') + hiddenNotice,
      cancelLabel: t('common.cancel'),
      confirmLabel: t('common.delete'),
      destructive: true,
      onConfirm: () => {
        if (bulkDeleteInFlightRef.current) return
        bulkDeleteInFlightRef.current = true
        setBulkDeleting(true)
        void removal.run(targets.map((gadget) => gadget.id), () => deleteGadgets(targets), 'fade')
          .then(leaveSelectionMode)
          .catch(() => showMessage(
            ja ? '削除できませんでした' : 'Could not delete',
            ja ? 'もう一度お試しください。' : 'Please try again.',
          ))
          .finally(() => {
            bulkDeleteInFlightRef.current = false
            setBulkDeleting(false)
          })
      },
    })
  }, [deleteGadgets, gadgets, ja, lang, leaveSelectionMode, selectedIds, t, visibleGadgetIds, removal])
  const allShownSelected = filteredGadgets.length > 0 && filteredGadgets.every((gadget) => selectedIds.has(gadget.id))

  const restoreTrashGadget = useCallback(async (gadget: Gadget) => {
    if (trashOperationInFlightRef.current) return
    trashOperationInFlightRef.current = true
    setTrashBusyId(gadget.id)
    try {
      await trashRemoval.run(gadget.id, () => restoreGadgets([gadget]), 'fade')
    } catch {
      showMessage(ja ? '復元できませんでした' : 'Could not restore', ja ? 'もう一度お試しください。' : 'Please try again.')
    } finally {
      trashOperationInFlightRef.current = false
      setTrashBusyId(null)
    }
  }, [ja, restoreGadgets, trashRemoval])

  const confirmPermanentDelete = useCallback((gadget: Gadget) => {
    if (trashOperationInFlightRef.current) return
    showConfirmation({
      title: ja ? '完全に削除しますか？' : 'Delete permanently?',
      message: ja
        ? `「${localizedGadgetName(gadget, lang)}」とデスクでの履歴を完全に削除します。元に戻せません。`
        : `Permanently delete "${localizedGadgetName(gadget, lang)}" and its desk history? This cannot be undone.`,
      cancelLabel: t('common.cancel'),
      confirmLabel: ja ? '完全に削除' : 'Delete permanently',
      destructive: true,
      onConfirm: () => {
        if (trashOperationInFlightRef.current) return
        trashOperationInFlightRef.current = true
        setTrashBusyId(gadget.id)
        void trashRemoval.run(gadget.id, () => deleteGadgetsPermanently([gadget]), 'fade')
          .catch(() => showMessage(
            ja ? '完全に削除できませんでした' : 'Could not delete permanently',
            ja ? 'もう一度お試しください。' : 'Please try again.',
          ))
          .finally(() => {
            trashOperationInFlightRef.current = false
            setTrashBusyId(null)
          })
      },
    })
  }, [deleteGadgetsPermanently, ja, lang, t, trashRemoval])

  const searchTarget = useCoachTarget('gear-search')
  const statsTarget = useCoachTarget('gear-stats')
  const usageTarget = useCoachTarget('gear-usage')
  const favoritesTarget = useCoachTarget('gear-favorites')
  const groupTarget = useCoachTarget('gear-group')
  const trashTarget = useCoachTarget('gear-trash')
  const addTarget = useCoachTarget('gear-add')

  const ListHeader = (
    <>
      {headerSlot}
        <View style={styles.headerSection}>
        {/* 複数選択と最近削除した項目のボタンはここに置かない。どちらもたまにしか使わないのに、
            開くたびに一覧の前へ一段ぶん割り込んでいた。複数選択はカードの長押しで入り、
            最近削除した項目は一覧の末尾に置く（写真アプリと同じ位置） */}
        {selectionMode && (
          <TouchableOpacity
            style={styles.selectAllButton}
            onPress={() => setSelectedIds(
              allShownSelected
                ? new Set([...selectedIds].filter((id) => !filteredGadgets.some((gadget) => gadget.id === id)))
                : new Set([...selectedIds, ...filteredGadgets.map((gadget) => gadget.id)]),
            )}
            accessibilityRole="button"
          >
            <Text style={[styles.selectAllText, { color: colors.accentText }]}>
              {allShownSelected
                ? (ja ? 'すべて解除' : 'Clear all')
                : (ja ? '表示中をすべて選択' : 'Select all shown')}
            </Text>
          </TouchableOpacity>
        )}
        <GadgetLibraryHeaderControls
          search={search}
          onChangeSearch={setSearch}
          searchInputRef={searchInputRef}
          searchTargetRef={searchTarget}
          statsTargetRef={statsTarget}
          usageTargetRef={usageTarget}
          favoritesTargetRef={favoritesTarget}
          groupTargetRef={groupTarget}
          ownedCount={ownedCount}
          onOpenStats={onOpenStats}
          usageFilter={usageFilter}
          usageCounts={usageCounts}
          onChangeUsage={(value) => {
            setUsageFilter(value)
            if (value === usageFilter) return
            swipeableRefs.current.forEach((row) => row.close())
            leaveSelectionMode()
          }}
          favoritesOnly={favoritesOnly}
          onToggleFavorites={() => {
            hapticSelection()
            swipeableRefs.current.forEach((row) => row.close())
            leaveSelectionMode()
            setFavoritesOnly((value) => !value)
          }}
          showGroup={canGroupByBrand}
          groupLabel={currentGroupLabel}
          groupExpanded={groupSheetOpen}
          onGroupPress={() => setGroupSheetOpen(true)}
        />
      </View>
    </>
  )

  // ─── FlatList renderItem ─────────────────────────────────────────
  const renderItem = useCallback(({ item }: { item: ListItem }) => {
    if (item.type === 'brand') {
      const { brandKey: key, title, subtitle, count, expanded } = item
      return (
        <CoachAnchor id="gear-brand-group"><TouchableOpacity
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => toggleBrand(key)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint={ja ? 'このブランドのガジェットを表示または非表示にします' : 'Shows or hides gadgets from this brand'}
          accessibilityState={{ expanded }}
        >
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: colors.chip }]}>
              <AppIcon name={ICONS.tag} size={22} color={colors.accentIcon} />
            </View>
            <View style={styles.info}>
              <Text style={[styles.catName, { color: colors.text }]} numberOfLines={1}>{title}</Text>
              <Text style={[styles.catSub,  { color: colors.textMuted }]}>
                {subtitle ? `${subtitle} · ${count}点` : (lang === 'en' ? `${count} ${count === 1 ? 'item' : 'items'}` : `${count}点`)}
              </Text>
            </View>
            <AppIcon name={expanded ? ICONS.chevronUp : ICONS.chevronDown} size={18} color={colors.textMuted} />
          </View>
        </TouchableOpacity></CoachAnchor>
      )
    }

    const { gadget, isLast } = item
    const usage = libraryUsage.get(gadget.id)!
    const card = (
      <GadgetCard
        gadget={gadget}
        onPress={selectionMode ? undefined : openGadgetDetail}
        onLongPress={selectionMode ? undefined : beginSelectionWith}
        checked={selectedIds.has(gadget.id)}
        onToggle={selectionMode ? toggleSelected : undefined}
        planLabel={libraryDeskLabel(usage, lang)}
        usagePeriodLabel={usage.status === 'unused'
          ? (gadget.purchasedAt ? `${ja ? '購入：' : 'Bought: '}${gadget.purchasedAt}` : '')
          : libraryUsagePeriodLabel(usage, lang)}
        retired={usage.status === 'past' && !gadget.disposedAt}
        favorite={!!gadget.favorite}
      />
    )
    return (
      <RemovalMotion ref={(handle) => removal.setRef(gadget.id, handle)}>
      <CoachAnchor id="gear-row"><View style={isLast && styles.gadgetLast}>
        {selectionMode ? card : <FavoriteSwipeRow
          insetActions
          favorite={!!gadget.favorite}
          label={localizedGadgetName(gadget, lang)}
          onToggleFavorite={() => toggleFavorite(gadget)}
          onRowRef={(ref) => { if (ref) swipeableRefs.current.set(gadget.id, ref); else swipeableRefs.current.delete(gadget.id) }}
          renderRightActions={(progress) => renderRightActions(gadget, progress)}
          rightThreshold={SWIPE_OPEN_THRESHOLD}
          overshootRight={false}
        >
          {card}
        </FavoriteSwipeRow>}
      </View></CoachAnchor>
      </RemovalMotion>
    )
  }, [colors, lang, ja, openGadgetDetail, beginSelectionWith, selectionMode, selectedIds, toggleSelected,
      renderRightActions, libraryUsage, toggleBrand, toggleFavorite, removal])

  // ─── 通常モード ───────────────────────────────────────────────────
  // 読み込み中・失敗・0件でも、使用状況の切り替えを含むヘッダーを共通で出す。
  const Container = embedded ? View : SafeAreaView

  return (
    <Container style={[styles.container, { backgroundColor: colors.bgList }]}>
      {libraryLoading ? (
        <Animated.ScrollView
          keyboardShouldPersistTaps="handled"
          scrollIndicatorInsets={scrollIndicatorInsets}
          scrollsToTop={active}
          ref={fallbackScrollRef}
          {...scrollSyncHandlers}
          onScroll={scrollActive ? (onScroll ?? scrollSyncHandlers.onScroll) : undefined}
          scrollEventThrottle={16}
          contentContainerStyle={minimumContentHeight ? { minHeight: minimumContentHeight } : undefined}
        >
          {ListHeader}<ListSkeleton count={5} />
        </Animated.ScrollView>
      ) : libraryLoadError ? (
        // 読めなかったのを「まだ1台も無い」と見せない。登録を促すと、読めていないまま
        // 新しく登録しようとして保存に失敗する（読めない間は保存を止めている）
        <Animated.ScrollView
          keyboardShouldPersistTaps="handled"
          scrollIndicatorInsets={scrollIndicatorInsets}
          scrollsToTop={active}
          ref={fallbackScrollRef}
          {...scrollSyncHandlers}
          onScroll={scrollActive ? (onScroll ?? scrollSyncHandlers.onScroll) : undefined}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.fillContent, minimumContentHeight ? { minHeight: minimumContentHeight } : null]}
        >
          {ListHeader}
          <RetryState
            message={plansLoadError
              ? (ja ? '機材の使用履歴を読み込めませんでした。' : 'Could not load gear usage history.')
              : (ja ? 'ガジェットを読み込めませんでした。' : 'Could not load your gadgets.')}
            onRetry={() => { reload(); void reloadPlans() }}
          />
        </Animated.ScrollView>
      ) : gadgets.length === 0 && deletedGadgets.length === 0 ? (
        <Animated.ScrollView
          keyboardShouldPersistTaps="handled"
          scrollIndicatorInsets={scrollIndicatorInsets}
          scrollsToTop={active}
          ref={fallbackScrollRef}
          {...scrollSyncHandlers}
          onScroll={scrollActive ? (onScroll ?? scrollSyncHandlers.onScroll) : undefined}
          scrollEventThrottle={16}
          contentContainerStyle={[styles.fillContent, minimumContentHeight ? { minHeight: minimumContentHeight } : null]}
        >
          {ListHeader}
          <EmptyState onAdd={openAddGadget} colors={colors} t={t} />
        </Animated.ScrollView>
      ) : (
        // 検索で 0 件になった場合は、ヘッダー（検索欄）を残したまま
        // 空メッセージを出す。検索欄ごと消えると入力の修正ができなくなるため
        <Animated.FlatList
          scrollIndicatorInsets={scrollIndicatorInsets}
          scrollsToTop={active}
          ref={listRef}
          {...scrollSyncHandlers}
          onScroll={scrollActive ? (onScroll ?? scrollSyncHandlers.onScroll) : undefined}
          scrollEventThrottle={16}
          data={listData}
          keyExtractor={(item) => item._key}
          renderItem={renderItem}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <View style={styles.folderEmpty}>
              <AppIcon name={search.trim() ? 'magnify-close' : ICONS.package} size={40} color={colors.textMuted} />
              <Text style={[styles.folderEmptyText, { color: colors.textMuted }]}>
                {search.trim()
                  ? t('gadgetLib.noMatch')
                  : favoritesOnly ? (ja ? 'お気に入りの機材はありません' : 'No favorite gear')
                  : usageFilter === 'unused' ? (ja ? '未使用の機材はありません' : 'No unused gear')
                  : (ja ? '使用中の機材はありません' : 'No gear in use')}
              </Text>
              <Text style={[styles.folderEmptyHint, { color: colors.textMuted }]}>
                {search.trim()
                  ? (ja ? '別のキーワードで検索してください' : 'Try a different keyword')
                  : favoritesOnly ? (ja ? '星を付けた機材がここに表示されます' : 'Gear you mark as a favorite appears here')
                  : (ja ? '使用状況を切り替えると、ほかの機材を見られます' : 'Switch usage filters to see your other gear')}
              </Text>
            </View>
          }
          ListFooterComponent={
            <>
              {!selectionMode && deletedGadgets.length > 0 && (
                <TouchableOpacity
                  ref={trashTarget}
                  style={[styles.statsRow, styles.trashRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => setTrashVisible(true)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 4, bottom: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={ja ? `最近削除した項目、${deletedGadgets.length}件` : `Recently Deleted, ${deletedGadgets.length} items`}
                >
                  <AppIcon name={ICONS.recentlyDeleted} size={20} color={colors.textMuted} />
                  <Text style={[styles.statsRowText, { color: colors.text }]}>
                    {ja ? '最近削除した項目' : 'Recently Deleted'}
                  </Text>
                  <Text style={[styles.trashCount, { color: colors.textMuted }]}>{deletedGadgets.length}</Text>
                  <AppIcon name={ICONS.chevronRight} size={18} color={colors.chevron} />
                </TouchableOpacity>
              )}
              {filteredGadgets.length > 0 ? <AdBanner /> : null}
            </>
          }
          contentContainerStyle={[
            styles.list,
            // 中身が0件のときだけ余りを作る。folderEmpty は flex: 1 でそれを吸って中央に来る
            listData.length === 0 ? styles.fillContent : null,
            minimumContentHeight ? { minHeight: minimumContentHeight } : undefined,
          ]}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {!loading && !selectionMode && (gadgets.length > 0 || deletedGadgets.length > 0) && (
        <TouchableOpacity
          ref={addTarget}
          style={[styles.fab, { backgroundColor: colors.accent }]}
          onPress={openAddGadget}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.addGadget')}
        >
          <AppIcon name={ICONS.add} size={22} color={colors.onAccent} />
          <Text style={[styles.fabText, { color: colors.onAccent }]}>{ja ? '追加' : 'Add'}</Text>
        </TouchableOpacity>
      )}

      {selectionMode && (
        <View style={[styles.bulkBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* 上部の「選択を終了」を無くしたので、抜ける操作は選択中に常に見えるこのバーに置く */}
          <TouchableOpacity
            style={styles.bulkCancelButton}
            onPress={leaveSelectionMode}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={[styles.bulkCancelText, { color: colors.accentText }]}>{t('common.cancel')}</Text>
          </TouchableOpacity>
          <Text style={[styles.bulkCount, { color: colors.text }]}>
            {ja
              ? `${selectedGadgetCount}件を選択中${hiddenSelectedCount > 0 ? `（表示外${hiddenSelectedCount}件）` : ''}`
              : `${selectedGadgetCount} selected${hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} hidden)` : ''}`}
          </Text>
          <TouchableOpacity
            style={[styles.bulkDeleteButton, { backgroundColor: selectedIds.size > 0 ? UI_STATUS_COLORS.danger : colors.border }]}
            onPress={confirmBulkDelete}
            disabled={selectedIds.size === 0 || bulkDeleting}
            accessibilityRole="button"
            accessibilityState={{ disabled: selectedIds.size === 0 || bulkDeleting }}
          >
            <AppIcon name={ICONS.trash} size={18} color="#fff" />
            <Text style={styles.bulkDeleteText}>
              {bulkDeleting ? (ja ? '削除中…' : 'Deleting…') : (ja ? '一括削除' : 'Delete')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <UndoSnackbar
        visible={undoSnackbar.visible && infoGadget === null}
        message={undoSnackbar.message}
        lang={lang}
        backgroundColor={colors.text}
        textColor={colors.card}
        accentColor={colors.accent}
        onUndo={undoSnackbar.undo}
        undoing={undoSnackbar.undoing}
      />

      <ChoiceSheet
        visible={groupSheetOpen}
        title={ja ? 'まとめ方' : 'Group by'}
        closeLabel={ja ? 'まとめ方の選択を閉じる' : 'Close grouping choices'}
        options={groupModeOptions}
        value={effectiveGroupMode}
        onSelect={setGroupMode}
        onClose={() => setGroupSheetOpen(false)}
        colors={colors}
      />

      <GadgetDetailSheet
        visible={infoGadget !== null}
        gadget={gadgets.find((gadget) => gadget.id === infoGadget?.id) ?? infoGadget}
        usageHistory={infoGadget ? libraryUsage.get(infoGadget.id)?.desks : undefined}
        readOnly={false}
        colors={colors}
        lang={lang}
        fmtPrice={fmtPrice}
        fmtDimStr={fmtDimStr}
        unitLabel={unitLabel}
        onClose={() => setInfoGadget(null)}
        onEdit={(gadget) => {
          if (!navigation.isFocused()) return
          setInfoGadget(null)
          navigation.navigate('GadgetDetail', { gadgetId: gadget.id })
        }}
        onDelete={confirmDeleteGadget}
        deleting={infoGadget?.id === deletingGadgetId}
        onOpenDesk={(deskId) => {
          // シートを閉じてから移る。開いたまま push すると、公開デスクがシートの裏に積まれて見えない
          if (!navigation.isFocused()) return
          setInfoGadget(null)
          openPublicDeskFromGadget(deskId)
        }}
        favorite={!!gadgets.find((gadget) => gadget.id === infoGadget?.id)?.favorite}
        onToggleFavorite={infoGadget ? () => { hapticSelection(); toggleFavorite(infoGadget) } : undefined}
        undoAction={undoSnackbar.visible ? { message: undoSnackbar.message, undoing: undoSnackbar.undoing, onUndo: undoSnackbar.undo } : undefined}
        onOpenBrand={(key, label) => {
          // シートを閉じてから移る。開いたまま遷移すると、戻ったときに
          // 前のシートが被さって出る
          if (!navigation.isFocused()) return
          setInfoGadget(null)
          navigation.push('BrandProducts', { brandKey: key, brandLabel: label })
        }}
      />

      <TrashSheet
        removal={trashRemoval}
        visible={trashVisible}
        gadgets={trashListGadgets}
        busyId={trashBusyId}
        colors={colors}
        lang={lang}
        onClose={() => setTrashVisible(false)}
        onRestore={(gadget) => { void restoreTrashGadget(gadget) }}
        onDeletePermanently={confirmPermanentDelete}
      />
    </Container>
  )
}

// 「すべて」だと絞り込みのように読めるが、実際はまとめずに1台ずつ並べるだけ
const groupNoneLabel = (ja: boolean) => (ja ? 'ガジェット別' : 'By gadget')

/**
 * 検索欄・統計・使用状況・お気に入り・まとめ方の列。マイページでこのタブを初めて開くときの骨組みと、
 * 読み込み中にも同じものを出す。無いと一覧が出た瞬間に、この列の高さぶん行が下へずれる
 */
function GadgetLibraryHeaderControls({
  search, onChangeSearch, searchInputRef, searchTargetRef, statsTargetRef, usageTargetRef, favoritesTargetRef, groupTargetRef,
  ownedCount, onOpenStats, usageFilter, usageCounts, onChangeUsage, favoritesOnly, onToggleFavorites,
  showGroup, groupLabel, groupExpanded, onGroupPress,
}: {
  search: string
  onChangeSearch: (text: string) => void
  searchInputRef?: RefObject<TextInput | null>
  searchTargetRef?: CoachTargetRef
  statsTargetRef?: CoachTargetRef
  usageTargetRef?: CoachTargetRef
  favoritesTargetRef?: CoachTargetRef
  groupTargetRef?: CoachTargetRef
  ownedCount: number
  onOpenStats?: () => void
  usageFilter: GadgetLibraryFilter
  /** 骨組みでは件数がまだ分からないので省く（文言の幅が変わるだけで、列の高さは変わらない） */
  usageCounts?: { current: number; unused: number }
  onChangeUsage: (value: GadgetLibraryFilter) => void
  favoritesOnly: boolean
  onToggleFavorites: () => void
  showGroup: boolean
  groupLabel: string
  groupExpanded: boolean
  onGroupPress: () => void
}) {
  const { colors, lang, t } = useApp()
  const ja = lang === 'ja'
  const countSuffix = (count: number | undefined) => (count === undefined ? '' : ` ${count}`)
  return (
    <>
      {/* 検索（商品名・メモ・カテゴリ名）と統計。統計は全デスク横断で数えるものが並ぶここに置くが、
          1行を丸ごと使うと一覧の前が重くなるので検索欄の右のアイコンにする。
          ヘッダー右上に統計と設定を2つ並べると iOS 26 のガラス背景で右上が重くなる */}
      <View ref={searchTargetRef as ((node: View | null) => void) | undefined} style={styles.searchRow}>
        <SearchField
          ref={searchInputRef}
          containerStyle={styles.searchBar}
          placeholder={t('common.search')}
          value={search}
          onChangeText={onChangeSearch}
          accessibilityLabel={ja ? '機材を検索' : 'Search your gear'}
          onClear={() => onChangeSearch('')}
          clearAccessibilityLabel={t('a11y.clearSearch')}
        />
        {!!onOpenStats && (
          <TouchableOpacity
            ref={statsTargetRef as ((node: View | null) => void) | undefined}
            style={[styles.statsButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={onOpenStats}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={ja ? `所有機材${ownedCount}点の統計を見る` : `View stats for ${ownedCount} owned gadgets`}
          >
            <AppIcon name={ICONS.stats} size={20} color={colors.accentText} />
          </TouchableOpacity>
        )}
      </View>
      <View ref={usageTargetRef as ((node: View | null) => void) | undefined} style={styles.usageFilterSection} collapsable={false}>
        <Text style={[styles.usageFilterTitle, { color: colors.textSub }]}>{ja ? '使用状況' : 'Usage status'}</Text>
        <SegmentedControl
          options={[
            { key: 'current', label: `${ja ? '使用中' : 'In use'}${countSuffix(usageCounts?.current)}` },
            { key: 'unused', label: `${ja ? '未使用' : 'Unused'}${countSuffix(usageCounts?.unused)}` },
          ]}
          value={usageFilter}
          onChange={onChangeUsage}
          accessibilityLabel={ja ? '機材の使用状況' : 'Gear usage'}
        />
      </View>
      <View style={styles.filterRow}>
        <TouchableOpacity
          ref={favoritesTargetRef as ((node: View | null) => void) | undefined}
          style={[styles.favoriteFilter, { backgroundColor: favoritesOnly ? colors.chip : colors.card, borderColor: favoritesOnly ? colors.favorite : colors.border }]}
          onPress={onToggleFavorites}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={ja ? 'お気に入りのみ表示' : 'Show favorites only'}
          accessibilityState={{ selected: favoritesOnly }}
        >
          <AppIcon name={favoritesOnly ? ICONS.starFilled : ICONS.star} size={17} color={colors.favorite} />
          <Text style={[styles.favoriteFilterLabel, { color: colors.text }]}>{ja ? 'お気に入り' : 'Favorites'}</Text>
        </TouchableOpacity>
        {showGroup && <GadgetListChoiceButton
          targetRef={groupTargetRef}
          icon="format-list-group"
          label={groupLabel}
          expanded={groupExpanded}
          onPress={onGroupPress}
          accessibilityLabel={ja ? `まとめ方：${groupLabel}` : `Group: ${groupLabel}`}
          accessibilityHint={ja ? '機材のまとめ方を選べます' : 'Choose how to group your gear'}
        />}
      </View>
    </>
  )
}

/**
 * マイページでガジェットタブを初めて開くときの骨組み用。開いた直後は必ず「使用中」・お気に入りなし・ガジェット別。
 * 押しても本物が出るまでは何もしない（呼び出し側で pointerEvents を切る）
 */
export function GadgetLibraryHeaderPlaceholder({ ownedCount, showStats }: { ownedCount: number; showStats: boolean }) {
  const { lang } = useApp()
  const noop = () => {}
  return (
    <View style={styles.headerSection}>
      <GadgetLibraryHeaderControls
        search=""
        onChangeSearch={noop}
        ownedCount={ownedCount}
        onOpenStats={showStats ? noop : undefined}
        usageFilter="current"
        onChangeUsage={noop}
        favoritesOnly={false}
        onToggleFavorites={noop}
        showGroup={false}
        groupLabel={groupNoneLabel(lang === 'ja')}
        groupExpanded={false}
        onGroupPress={noop}
      />
    </View>
  )
}

function TrashSheet({ visible, gadgets, busyId, colors, lang, onClose, onRestore, onDeletePermanently, removal }: {
  removal: ReturnType<typeof useRemovalMotion>
  visible: boolean
  gadgets: Gadget[]
  busyId: string | null
  colors: AppColors
  lang: 'ja' | 'en'
  onClose: () => void
  onRestore: (gadget: Gadget) => void
  onDeletePermanently: (gadget: Gadget) => void
}) {
  const ja = lang === 'ja'
  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} sheetStyle={styles.trashSheet}>
        <View style={styles.trashHeader}>
          <View style={styles.trashTitleBlock}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              {ja ? '最近削除した項目' : 'Recently Deleted'}
            </Text>
            <Text style={[styles.trashHelp, { color: colors.textMuted }]}>
              {ja ? '30日後に完全に削除されます' : 'Items are permanently deleted after 30 days'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel={ja ? '閉じる' : 'Close'}>
            <AppIcon name={ICONS.close} size={22} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        {gadgets.length === 0 ? (
          <View style={styles.trashEmpty}>
            <AppIcon name={ICONS.recentlyDeleted} size={36} color={colors.textMuted} />
            <Text style={[styles.trashEmptyText, { color: colors.textMuted }]}>
              {ja ? '削除した項目はありません' : 'No deleted items'}
            </Text>
          </View>
        ) : (
          <ScrollView style={styles.trashScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {gadgets.map((gadget) => {
              const days = gadgetTrashDaysRemaining(gadget)
              const busy = busyId === gadget.id
              return (
                <RemovalMotion key={gadget.id} ref={(handle) => removal.setRef(gadget.id, handle)}>
                <View style={[styles.trashItem, { borderColor: colors.border }]}>
                  <GadgetCard gadget={gadget} interactive={false} />
                  <Text style={[styles.trashDeadline, { color: colors.textMuted }]}>
                    {days === null
                      ? (ja ? '削除期限を確認できません' : 'Deletion date unavailable')
                      : (ja ? `あと${days}日で完全に削除` : `Permanently deleted in ${days} day${days === 1 ? '' : 's'}`)}
                  </Text>
                  <View style={styles.trashActions}>
                    <TouchableOpacity
                      style={[styles.trashActionButton, { borderColor: colors.accentIcon }]}
                      onPress={() => onRestore(gadget)}
                      disabled={busy}
                      accessibilityRole="button"
                    >
                      <AppIcon name={ICONS.restore} size={17} color={colors.accentText} />
                      <Text style={[styles.trashActionText, { color: colors.accentText }]}>
                        {busy ? (ja ? '処理中…' : 'Working…') : (ja ? '復元' : 'Restore')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.trashActionButton, { borderColor: colors.danger }]}
                      onPress={() => onDeletePermanently(gadget)}
                      disabled={busy}
                      accessibilityRole="button"
                    >
                      <AppIcon name={ICONS.deleteForever} size={17} color={colors.danger} />
                      <Text style={[styles.trashActionText, { color: colors.danger }]}>
                        {ja ? '完全に削除' : 'Delete permanently'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
                </RemovalMotion>
              )
            })}
          </ScrollView>
        )}
    </BottomSheetModal>
  )
}

function EmptyState({ onAdd, colors, t }: { onAdd: () => void; colors: AppColors; t: any }) {
  return (
    <EmptyStateView
      icon={ICONS.package}
      title={t('gadgetLib.emptyTitle')}
      description={t('gadgetLib.emptyDesc')}
      actionLabel={t('gadgetLib.addFirst')}
      onAction={onAdd}
      colors={colors}
      coachTarget="gear-empty"
    />
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list:      { paddingBottom: 100 },
  // 1台も無いとき・読めなかったときの表示を画面の縦中央に置くための余り
  fillContent: { flexGrow: 1 },

  // フォルダ空状態
  folderEmpty: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32,
  },
  folderEmptyText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  folderEmptyHint: { fontSize: 12, textAlign: 'center', lineHeight: 18 },

  // ─── ヘッダー ─────────────────────────────────────────────────────
  headerSection: { marginHorizontal: 16, marginTop: 12, marginBottom: 8 },
  usageFilterSection: { gap: 6 },
  usageFilterTitle: { fontSize: 12, fontWeight: '700' },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  favoriteFilter: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: UI_METRICS.touchMinSize, paddingHorizontal: 12, borderWidth: 1, borderRadius: UI_METRICS.controlRadius },
  favoriteFilterLabel: { fontSize: 12, fontWeight: '600' },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: UI_METRICS.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  statsRowText: { flex: 1, fontSize: 14, fontWeight: '700' },
  // 一覧末尾の「最近削除した項目」。統計の行と同じ形で、一覧の横余白に揃える
  trashRow: {
    marginHorizontal: UI_METRICS.screenGutter, marginTop: 8,
    minHeight: UI_METRICS.compactInputHeight, paddingVertical: 6,
  },
  trashCount: { fontSize: 13 },
  selectAllButton: { alignSelf: 'flex-end', minHeight: 36, justifyContent: 'center', paddingHorizontal: 4, marginBottom: 6 },
  selectAllText: { fontSize: 12, fontWeight: '700' },


  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginBottom: 10 },
  searchBar: { flex: 1 },
  // 高さは検索欄に合わせて伸ばす（行の高さを変えない）。幅だけ押せる大きさを確保する
  statsButton: {
    width: UI_METRICS.touchMinSize,
    borderRadius: UI_METRICS.controlRadius,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },



  // ─── カード ───────────────────────────────────────────────────────
  card: {
    borderRadius: UI_METRICS.chipRadius,
    padding: 10,
    marginHorizontal: 16,
    // 枠線付きのカードを 4 で並べると線同士がほぼ接して1枚の表に見える。
    marginBottom: 8,
    borderWidth: 1.5,
  },
  gadgetLast:   { marginBottom: 4 },
  row:        { flexDirection: 'row', alignItems: 'center' },
  iconWrap:   { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 10, flexShrink: 0 },
  info:       { flex: 1 },
  catName:    { fontSize: 15, fontWeight: '700' },
  catSub:     { fontSize: 12, marginTop: 2 },

  // ─── スワイプアクション ────────────────────────────────────────────
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // GadgetCard の下余白（6）と揃える。ずれるとボタンだけカードより長く伸びる
    marginBottom: 6,
    marginRight: 16,
  },
  actionBtn: {
    width: 72,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: UI_METRICS.controlRadius,
    gap: 3,
  },
  actionLabel: { color: '#fff', fontSize: 11, fontWeight: '700' },
  swipeButtonWrap: { alignSelf: 'stretch' },
  // ─── 並び替えバー ─────────────────────────────────────────────────

  // ─── FAB ─────────────────────────────────────────────────────────
  // マイデスクの「新しいデスク」と同じ寸法。タブを移ると同じ役割のボタンの
  // 大きさが変わるのを避ける（位置は right 20 / bottom 32 で元から一致）
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    height: 56,
    paddingHorizontal: 18,
    borderRadius: UI_METRICS.pillRadius,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: { fontSize: 14, fontWeight: '800' },
  bulkBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    minHeight: 64,
    borderWidth: 1,
    borderRadius: UI_METRICS.cardRadius,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bulkCancelButton: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center', paddingRight: 12 },
  bulkCancelText: { fontSize: 14, fontWeight: '600' },
  bulkCount: { flex: 1, fontSize: 14, fontWeight: '700' },
  bulkDeleteButton: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: UI_METRICS.controlRadius,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bulkDeleteText: { color: '#fff', fontSize: 13, fontWeight: '800' },

  sheetTitle:    { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  trashSheet: {
    height: '78%',
  },
  trashHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
  trashTitleBlock: { flex: 1 },
  trashHelp: { fontSize: 12, lineHeight: 18 },
  trashScroll: { flex: 1, marginHorizontal: -2 },
  trashItem: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 10 },
  trashDeadline: { fontSize: 11, marginHorizontal: 16, marginTop: 2 },
  trashActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginHorizontal: 16, marginTop: 8 },
  trashActionButton: {
    minHeight: 38,
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  trashActionText: { fontSize: 12, fontWeight: '700' },
  trashEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  trashEmptyText: { fontSize: 14, fontWeight: '600' },

  // ─── フォルダ名入力モーダル ────────────────────────────────────────

  // ─── 空状態 ───────────────────────────────────────────────────────


})
