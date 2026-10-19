import { Alert } from '../../utils/alert'
// ─── 欲しいものリスト（保存したガジェット）──────────────────────────
//
// 「いいね」側は作らない（理由は 066 のマイグレーション冒頭）。この一覧は
// 保存専用で、スコープ切替は「デスク / ガジェット」の2つだけ。
//
// 出典のデスクが非公開化・削除されると desk が null になる。行は残すので、
// その場合は出典の行を出さず、タップも無効にする（開く先が無い）。
import { useFocusEffect } from '@react-navigation/native'
import { useScrollToTopOf } from '../../hooks/useScrollToTopOf'
import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { ViewStyle } from 'react-native'
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../../constants/categoryLabels'
import { AppColors, useApp } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { hapticSelection } from '../../utils/haptics'
import { analytics, EVENTS } from '../../services/analytics'
import { followBrand, listBrandFollows, unfollowBrand } from '../../services/brandFollows'
import { useIntentSync } from '../../hooks/useIntentSync'
import { BRANDS_ENABLED } from '../../constants/features'
import type { BrandFollowRow } from '../../services/brandFollows'
import { listGadgetBookmarks, removeGadgetBookmark } from '../../services/gadgetBookmarks'
import type { GadgetBookmarkItem } from '../../supabase/types'
import { GadgetCategory } from '../../types'
import { BRAND_ENTRIES, brandDisplay, brandKey } from '../../utils/brandIdentity'
import { matchesSearchTerms, normalizeGadgetSearch, searchTerms } from '../../utils/gadgetSearch'
import { AppIcon } from '../atoms/AppIcon'
import { TogglePop } from '../atoms/TogglePop'
import { SearchField } from '../atoms/SearchField'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { BrandChip } from '../molecules/BrandChip'
import { SavedSwipeRow } from '../molecules/SavedSwipeRow'
import { animateListChange } from '../molecules/FullSwipeRow'
import { UndoSnackbar } from '../molecules/UndoSnackbar'
import { useUndoSnackbar } from '../../hooks/useUndoSnackbar'
import { restoreAt } from '../../utils/fullSwipe'
import { EmptyState } from '../molecules/EmptyState'
import { ListSkeleton } from '../molecules/ListSkeleton'
import { ReactionScopeSwitch } from '../molecules/ReactionScopeSwitch'
import { RetryState } from '../molecules/RetryState'
import { UI_METRICS } from '../../constants/ui'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { ScrollSyncRequest } from '../../utils/collapsibleTabScroll'
import { useMyPageScrollIndicatorInsets } from '../../hooks/useMyPageScrollIndicator'
import { useScrollSyncRetry } from '../../hooks/useScrollSyncRetry'
import { CoachAnchor, useCoachTarget } from '../../hooks/useCoachMarks'

interface Props {
  navigation: any
  headerSlot?: ReactNode
  active?: boolean
  scrollY?: Animated.Value
  scrollSyncRequest?: ScrollSyncRequest
  minimumContentHeight?: number
  onScrollOffset?: (offset: number) => void
  colors: AppColors
  lang: 'ja' | 'en'
  onShowDesks: () => void
  scope?: 'desks' | 'gadgets'
  contentTransitionStyle?: Animated.WithAnimatedValue<ViewStyle>
  collectionId?: string
  collectionRevision?: number
  collectionHeader?: ReactNode
  collectionAction?: (item: GadgetBookmarkItem) => ReactNode
}

export function GadgetBookmarkList({
  navigation, headerSlot, active = true, scrollY, scrollSyncRequest, minimumContentHeight,
  onScrollOffset, colors: C, lang, onShowDesks, scope = 'gadgets', contentTransitionStyle,
  collectionId, collectionRevision, collectionHeader, collectionAction,
}: Props) {
  const { user } = useAuth()
  const { isDark, reduceMotion } = useApp()
  const ja = lang === 'ja'
  const scopeTarget = useCoachTarget('saved-scope')
  const emptyTarget = useCoachTarget('saved-gear-empty')
  const [items, setItems] = useState<GadgetBookmarkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const itemsRef = useRef<GadgetBookmarkItem[]>([])
  itemsRef.current = items
  // 外して「元に戻す」の期限を待っている機材。サーバーにはまだ残っているので、その間の読み直しで戻さない
  const pendingReleaseRef = useRef(new Set<string>())
  const undoSnackbar = useUndoSnackbar()
  const [brand, setBrand] = useState<string | null>(null)
  const [follows, setFollows] = useState<BrandFollowRow[]>([])
  // 連打の2回目は再描画より先に届きうる。押した時点の状態は描画を待たずにここから読む
  const followsRef = useRef(follows)
  followsRef.current = follows
  // フォローの行にはブランドの表記も保存する。送る時点ではキーしか渡らないので控えておく
  const brandLabelRef = useRef(new Map<string, string>())
  const applyFollow = useCallback((key: string, followed: boolean) => {
    const toggled = (prev: BrandFollowRow[]) => {
      const rest = prev.filter((f) => f.brand_key !== key)
      if (!followed) return rest
      const raw = brandLabelRef.current.get(key) ?? key
      return [{ id: `optimistic-${key}`, brand_key: key, brand_label: raw, created_at: new Date().toISOString() }, ...rest]
    }
    followsRef.current = toggled(followsRef.current)
    setFollows(toggled)
  }, [])
  const brandSync = useIntentSync<string>({
    send: async (key, followed) => {
      if (!user) throw new Error('signed out')
      if (followed) await followBrand(user.id, brandLabelRef.current.get(key) ?? key)
      else await unfollowBrand(user.id, key)
    },
    onConfirmed: (key, followed) => analytics.track(EVENTS.BRAND_FOLLOW_TOGGLED, { active: followed, brand: key }),
    onFailed: (key, followed) => {
      // 失敗したら戻す。押せたように見えたまま消えるのがいちばん困る
      applyFollow(key, followed)
      const raw = brandLabelRef.current.get(key) ?? key
      const label = brandDisplay(raw, lang) ?? raw
      Alert.alert(lang === 'ja' ? `${label} を更新できませんでした` : `Could not update ${label}`)
    },
  })
  const [brandPickerOpen, setBrandPickerOpen] = useState(false)
  const [brandSearch, setBrandSearch] = useState('')
  const loadedRef = useRef(false)
  const listRef = useRef<Animated.FlatList>(null)
  const scrollIndicatorInsets = useMyPageScrollIndicatorInsets()
  useScrollToTopOf(() => (active ? listRef.current : null))
  const { handlers: scrollSyncHandlers, isActive: scrollActive } = useScrollSyncRetry(scrollSyncRequest, active, (offset) => {
    listRef.current?.scrollToOffset({ offset, animated: false })
  }, scrollY)

  const onScroll = useMemo(
    () => scrollY
      ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            onScrollOffset?.(Math.max(0, event.nativeEvent.contentOffset.y))
          },
        })
      : undefined,
    [onScrollOffset, scrollY],
  )

  // 後から始めた読み直し・解除より前の結果は捨てる（届くと、解除した機材が一覧に戻る）
  const loadRequestRef = useRef(0)
  useLayoutEffect(() => {
    ++loadRequestRef.current
    setItems([])
    setBrand(null)
    setLoading(true)
    loadedRef.current = false
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [collectionId])
  const reload = useCallback(async (refresh = false) => {
    if (!user) { setItems([]); setLoading(false); return }
    const requestId = ++loadRequestRef.current
    setLoadError(false)
    if (refresh) setRefreshing(true)
    else if (!loadedRef.current) setLoading(true)
    try {
      // お気に入りブランドは一覧の一部（先頭の行）なので、同じ往復で取る。
      // 落ちても保存一覧そのものは出す — フォローは付帯機能で、ここで
      // 一覧全体をエラーにすると保存したものが読めなくなる
      const [bookmarks, followed] = await Promise.all([
        listGadgetBookmarks(user.id, collectionId),
        // ブランドの分類を閉じている間は、お気に入りの行を出さないので引かない
        BRANDS_ENABLED ? listBrandFollows(user.id).catch(() => [] as BrandFollowRow[]) : Promise.resolve([] as BrandFollowRow[]),
      ])
      if (requestId !== loadRequestRef.current) return
      setItems(bookmarks.filter((value) => !pendingReleaseRef.current.has(value.id)))
      // 送信中の★は押した後の表示を残す。一覧は送信が届く前の状態で返りうる
      const pending = followsRef.current.filter((f) => brandSync.isBusy(f.brand_key))
      const merged = [
        ...pending,
        ...followed.filter((f) => !brandSync.isBusy(f.brand_key)),
      ]
      followsRef.current = merged
      setFollows(merged)
      loadedRef.current = true
    } catch {
      if (requestId === loadRequestRef.current) setLoadError(true)
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [user, brandSync, collectionId])
  const latestListRef = useRef({ collectionId, reload })
  latestListRef.current = { collectionId, reload }

  useFocusEffect(useCallback(() => {
    if (active) void reload()
    return () => { ++loadRequestRef.current }
  }, [active, reload]))
  const seenCollectionRevision = useRef(collectionRevision)
  useEffect(() => {
    if (seenCollectionRevision.current === collectionRevision) return
    seenCollectionRevision.current = collectionRevision
    if (active) void reload()
  }, [active, reload, collectionRevision])

  const openItem = useCallback((item: GadgetBookmarkItem) => {
    // 出典が非公開・削除済みなら開く先が無い
    if (!item.desk_id) return
    navigation.navigate('PublicDesk', {
      deskId: item.desk_id,
      gadgetId: item.gadget_id ?? undefined,
      source: 'gadget_bookmark',
    })
  }, [navigation])

  // 左へ引ききったときと、行の解除ボタンを押したとき。その場で一覧から外して「元に戻す」を出し、
  // サーバーからは期限が過ぎてから外す（保存したデスクの一覧と同じ）。
  // 先に外すと、戻したときに保存し直しになり、保存した順が先頭へ変わってしまう
  const releaseWithUndo = useCallback((item: GadgetBookmarkItem, label: string) => {
    if (!user) return
    const index = itemsRef.current.findIndex((value) => value.id === item.id)
    if (index < 0) return
    const userId = user.id
    const sameItem = (a: GadgetBookmarkItem, b: GadgetBookmarkItem) => a.id === b.id
    pendingReleaseRef.current.add(item.id)
    hapticSelection()
    animateListChange(reduceMotion)
    setItems((prev) => prev.filter((value) => value.id !== item.id))
    undoSnackbar.showUndo({
      message: ja ? `「${label}」の保存を解除しました` : `Removed "${label}" from Saved`,
      onUndo: () => {
        pendingReleaseRef.current.delete(item.id)
        animateListChange(reduceMotion)
        if (latestListRef.current.collectionId === collectionId) setItems((prev) => restoreAt(prev, item, index, sameItem))
        else void latestListRef.current.reload()
      },
      onExpire: async () => {
        try {
          await removeGadgetBookmark(item.id, userId)
          analytics.track(EVENTS.GADGET_BOOKMARK_TOGGLED, {
            active: false,
            placement: 'bookmark_gadget_list',
            product_id: item.product_id,
          })
        } catch {
          pendingReleaseRef.current.delete(item.id)
          if (latestListRef.current.collectionId === collectionId) setItems((prev) => restoreAt(prev, item, index, sameItem))
          else void latestListRef.current.reload()
          Alert.alert(ja ? '保存を解除できませんでした' : 'Could not remove from Saved')
        } finally {
          pendingReleaseRef.current.delete(item.id)
        }
      },
    })
  }, [ja, user, reduceMotion, undoSnackbar, collectionId])

  const empty = loading ? (
    <ListSkeleton count={4} variant="row" rowSize="image" inset="none" />
  ) : loadError ? (
    <RetryState message={ja ? 'ガジェットを読み込めませんでした。' : 'Could not load gadgets.'} onRetry={() => { void reload() }} />
  ) : user ? (
    <EmptyState
      icon="bookmark-outline"
      title={collectionId ? (ja ? 'このフォルダに機材はありません' : 'No gear in this folder') : (ja ? '保存したガジェットはありません' : 'No saved gadgets yet')}
      description={collectionId ? (ja ? '「すべて」から機材の「整理」を押して、フォルダに追加できます' : 'Select All and use Organize on saved gear to add it to this folder.') : (ja ? '公開デスクで機材を開くと、ここに残せます' : 'Open gear on a public desk to keep it here.')}
      actionLabel={collectionId ? undefined : (ja ? 'みんなのデスクを見る' : 'Go to Explore')}
      onAction={() => navigation.navigate('FeedTab')}
      colors={C}
    />
  ) : (
    <EmptyState
      icon="bookmark-outline"
      title={ja ? 'ログインすると使えます' : 'Sign in to use this feature'}
      description={ja ? '保存したガジェットはアカウントに残ります' : 'Saved gadgets are kept on your account.'}
      colors={C}
    />
  )

  // 保存済みの商品からブランドを数える。products.brand は商品名から機械的に抜いた
  // 文字列で表記ゆれがあるので、brandKey で束ねてから数える（Anker と anker を1件にする）
  const brands = useMemo(() => {
    // brandDisplay は「商品に入っていた表記」を受ける関数なので、キーではなく
    // 最初に出会った raw を持っておいて渡す。キーを渡すと辞書に無いブランドが
    // 潰した小文字（anker）のまま画面に出る
    const count = new Map<string, { n: number; raw: string }>()
    for (const item of items) {
      const raw = item.product?.brand
      const key = brandKey(raw)
      if (!key || !raw) continue
      const current = count.get(key)
      if (current) current.n += 1
      else count.set(key, { n: 1, raw })
    }
    // 多い順。同数なら表示名の辞書順で、並びが読み込みごとに変わらないようにする
    return [...count.entries()]
      .map(([key, { n, raw }]) => ({ key, n, raw, label: brandDisplay(raw, lang) ?? raw }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  }, [items, lang])

  const followedKeys = useMemo(() => new Set(follows.map((f) => f.brand_key)), [follows])
  const brandOptions = useMemo(() => {
    const terms = searchTerms(normalizeGadgetSearch(brandSearch))
    return BRAND_ENTRIES
      .map((entry) => ({ key: entry.id, raw: entry.en, label: brandDisplay(entry.en, lang) ?? entry.en }))
      .filter((entry) => terms.length === 0 || matchesSearchTerms(normalizeGadgetSearch(`${entry.label}\n${entry.raw}`), terms))
      .sort((a, b) => a.label.localeCompare(b.label, lang))
  }, [brandSearch, lang])

  // 楽観更新。押した瞬間に星が変わらないと、通信のたびに固まって見える。
  // 連打しても押すたびに反転し、通信は最後の状態だけを送る（utils/intentSync）
  const toggleFollow = useCallback((key: string, raw: string) => {
    if (!user) return
    brandLabelRef.current.set(key, raw)
    const wasFollowing = followsRef.current.some((f) => f.brand_key === key)
    hapticSelection()
    applyFollow(key, !wasFollowing)
    brandSync.request(key, wasFollowing, !wasFollowing)
  }, [user, applyFollow, brandSync])

  const visibleItems = useMemo(
    () => brand ? items.filter((item) => brandKey(item.product?.brand) === brand) : items,
    [items, brand],
  )

  const selectedBrand = brand ? brands.find((b) => b.key === brand) : undefined
  const following = !!brand && followedKeys.has(brand)
  const [followPopKey, setFollowPopKey] = useState(0)

  // 選んだブランドに対してだけ操作を出す。チップに星を並べると、絞り込みと
  // お気に入りのどちらを押したのか分からなくなる
  const brandActions = selectedBrand ? (
    <CoachAnchor id="saved-brand-actions"><View style={styles.brandActions}>
      <TouchableOpacity
        style={[styles.brandAction, {
          backgroundColor: C.chip,
          borderColor: C.border,
        }]}
        onPress={() => {
          if (user && !following) setFollowPopKey((key) => key + 1)
          void toggleFollow(selectedBrand.key, selectedBrand.raw)
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ selected: following }}
        accessibilityLabel={following
          ? (ja ? `${selectedBrand.label} をお気に入りから外す` : `Remove ${selectedBrand.label} from favorites`)
          : (ja ? `${selectedBrand.label} をお気に入りに追加` : `Add ${selectedBrand.label} to favorites`)}
      >
        <TogglePop popKey={followPopKey}>
          <AppIcon name={following ? ICONS.starFilled : ICONS.star} size={15} color={C.favorite} />
        </TogglePop>
        <Text style={[styles.brandActionText, { color: C.textSub }]}>
          {following ? (ja ? 'お気に入り' : 'Favorite') : (ja ? 'お気に入りに追加' : 'Add to favorites')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.brandAction, { backgroundColor: C.chip, borderColor: C.border }]}
        onPress={() => navigation.navigate('BrandProducts', { brandKey: selectedBrand.key, brandLabel: selectedBrand.label })}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={ja ? `${selectedBrand.label} の商品を見る` : `Browse ${selectedBrand.label} products`}
      >
        <Text style={[styles.brandActionText, { color: C.textSub }]}>
          {ja ? '商品を見る' : 'Browse products'}
        </Text>
        <AppIcon name={ICONS.chevronRight} size={15} color={C.textSub} />
      </TouchableOpacity>
    </View></CoachAnchor>
  ) : null

  // お気に入りは保存の有無と切り離す。保存を消したらブランドへ辿り着けなくなる
  // のでは、登録した意味が無い
  const followRow = user ? (
    <View style={styles.followBlock}>
      <View style={styles.followHeader}>
        <Text style={[styles.followHeading, { color: C.textMuted }]}>
          {ja ? 'お気に入りのブランド' : 'Favorite brands'}
        </Text>
        <CoachAnchor id="saved-brand-add"><TouchableOpacity
          style={styles.addBrandAction}
          onPress={() => setBrandPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={ja ? 'ブランドを追加' : 'Add a brand'}
        >
          <AppIcon name={ICONS.tag} size={16} color={C.accentText} />
          <Text style={[styles.addBrandText, { color: C.accentText }]}>
            {ja ? 'ブランドを追加' : 'Add a brand'}
          </Text>
        </TouchableOpacity></CoachAnchor>
      </View>
      {follows.length > 0 && (
        <CoachAnchor id="saved-brand-favorites"><View><ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.brandRow}
          keyboardShouldPersistTaps="handled"
        >
          {follows.map((f) => {
            const label = brandDisplay(f.brand_label, lang) ?? f.brand_label
            return (
              <TouchableOpacity
                key={f.brand_key}
                style={[styles.brandChip, { backgroundColor: C.chip, borderColor: C.border }]}
                onPress={() => navigation.navigate('BrandProducts', { brandKey: f.brand_key, brandLabel: label })}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={ja ? `${label} の商品を見る` : `Browse ${label} products`}
              >
                <AppIcon name={ICONS.starFilled} size={13} color={C.favorite} />
                <Text style={[styles.brandChipText, { color: C.text }]}>{label}</Text>
              </TouchableOpacity>
            )
          })}
        </ScrollView></View></CoachAnchor>
      )}
    </View>
  ) : null

  // 1ブランドしか無ければ絞る意味が無いので出さない
  const brandRow = brands.length > 1 ? (
    <CoachAnchor id="saved-brand-filter"><View><ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.brandRow}
      keyboardShouldPersistTaps="handled"
    >
      {brands.map(({ key, n, label }) => {
        const selected = brand === key
        return (
          <TouchableOpacity
            key={key}
            style={[styles.brandChip, {
              backgroundColor: selected ? C.accent : C.chip,
              borderColor: selected ? C.accentIcon : C.border,
            }]}
            onPress={() => setBrand((current) => current === key ? null : key)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={ja ? `${label} で絞り込む（${n}件）` : `Filter by ${label} (${n})`}
          >
            <Text style={[styles.brandChipText, { color: selected ? C.onAccent : C.text }]}>{label}</Text>
            <Text style={[styles.brandChipCount, { color: selected ? C.onAccent : C.textMuted }]}>{n}</Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView></View></CoachAnchor>
  ) : null

  const labels = ja ? CATEGORY_LABELS : CATEGORY_LABELS_EN
  const closeBrandPicker = () => {
    setBrandPickerOpen(false)
    setBrandSearch('')
  }

  return (
    <>
      <Animated.FlatList
        scrollIndicatorInsets={scrollIndicatorInsets}
        scrollsToTop={active}
        ref={listRef}
        {...scrollSyncHandlers}
        // 保存したデスクの一覧と scrollY を共有しているので、出ている間だけ書き込む
        onScroll={scrollActive ? (onScroll ?? scrollSyncHandlers.onScroll) : undefined}
        scrollEventThrottle={16}
        data={visibleItems}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void reload(true) }} tintColor={C.textMuted} colors={[C.textMuted]} progressBackgroundColor={C.card} />}
        ListHeaderComponent={<>{headerSlot}<View ref={scopeTarget} collapsable={false}><ReactionScopeSwitch value={scope} onChange={(next) => { if (next === 'desks') onShowDesks() }} colors={C} lang={lang} /></View>{collectionHeader}{BRANDS_ENABLED && <>{followRow}{brandRow}{brandActions}</>}</>}
        ListHeaderComponentStyle={styles.headerBleed}
        contentContainerStyle={[
          visibleItems.length === 0 ? styles.emptyContent : styles.listContent,
          minimumContentHeight ? { minHeight: minimumContentHeight } : undefined,
        ]}
        renderItem={({ item }) => {
          const displayName = item.product?.product_name || item.gadget_name || item.product?.name
          const category = item.gadget_category as GadgetCategory
          const openable = !!item.desk_id && !!item.desk
          return (
            <Animated.View style={contentTransitionStyle}>
            <SavedSwipeRow radius={UI_METRICS.cardRadius} label={displayName ?? (ja ? '機材' : 'Gear')} onRemove={() => releaseWithUndo(item, displayName ?? (ja ? '機材' : 'Gear'))}>
            <CoachAnchor id="saved-gear"><TouchableOpacity
              style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}
              activeOpacity={openable ? 0.75 : 1}
              onPress={() => openItem(item)}
              disabled={!openable}
              accessibilityRole="button"
              accessibilityLabel={displayName}
            >
              {item.product?.image ? (
                <Image source={{ uri: item.product.image }} style={styles.image} resizeMode="contain" />
              ) : (
                <View style={[styles.image, styles.iconWrap, { backgroundColor: C.chip }]}>
                  <CategoryIcon category={category} size={30} color={categoryIconColor(category, isDark)} />
                </View>
              )}
              <View style={styles.body}>
                <Text style={[styles.name, { color: C.text }]} numberOfLines={2}>{displayName}</Text>
                <Text style={[styles.meta, { color: C.textMuted }]} numberOfLines={1}>
                  {/* 出典が読めないときはカテゴリだけ。「· undefined」を出さない */}
                  {openable ? `${labels[category] ?? category} · ${item.desk?.title}` : (labels[category] ?? category)}
                </Text>
                {openable && (
                  <Text style={[styles.author, { color: C.textMuted }]} numberOfLines={1}>
                    {item.desk?.owner_name}
                  </Text>
                )}
                <BrandChip
                  brand={item.product?.brand}
                  colors={C}
                  lang={lang}
                  style={styles.brandSlot}
                  onPress={(key, label) => navigation.navigate('BrandProducts', { brandKey: key, brandLabel: label })}
                />
              </View>
              <CoachAnchor id="saved-gear-remove"><TouchableOpacity
                style={styles.remove}
                onPress={() => releaseWithUndo(item, displayName ?? (ja ? '機材' : 'Gear'))}
                accessibilityRole="button"
                accessibilityLabel={ja ? '保存を解除' : 'Remove from saved'}
              >
                <AppIcon name="bookmark-remove-outline" size={22} color={C.textMuted} />
              </TouchableOpacity></CoachAnchor>
            </TouchableOpacity></CoachAnchor>
            </SavedSwipeRow>
            {collectionAction?.(item)}
            </Animated.View>
          )
        }}
        ListEmptyComponent={<Animated.View style={contentTransitionStyle}><View ref={emptyTarget} collapsable={false}>{empty}</View></Animated.View>}
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
      <BottomSheetModal visible={brandPickerOpen} onDismiss={closeBrandPicker} sheetStyle={styles.pickerSheet} avoidKeyboard>
            <View style={styles.pickerHeader}>
              <Text style={[styles.pickerTitle, { color: C.text }]}>
                {ja ? 'ブランドを追加' : 'Add a brand'}
              </Text>
              <TouchableOpacity
                style={styles.pickerDoneButton}
                onPress={closeBrandPicker}
                accessibilityRole="button"
                accessibilityLabel={ja ? '完了' : 'Done'}
              >
                <Text style={[styles.pickerDoneText, { color: C.accentText }]}>{ja ? '完了' : 'Done'}</Text>
              </TouchableOpacity>
            </View>
            <SearchField
                containerStyle={styles.pickerSearch}
                value={brandSearch}
                onChangeText={setBrandSearch}
                placeholder={ja ? 'ブランド名を検索' : 'Search brands'}
                accessibilityLabel={ja ? 'ブランド名を検索' : 'Search brands'}
            />
            <FlatList
              data={brandOptions}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.pickerListContent}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const followed = followedKeys.has(item.key)
                return (
                  <TouchableOpacity
                    style={[styles.pickerRow, { borderBottomColor: C.border }]}
                    onPress={() => { void toggleFollow(item.key, item.raw) }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: followed }}
                    accessibilityLabel={item.label}
                  >
                    <View style={styles.pickerRowBody}>
                      <Text style={[styles.pickerRowTitle, { color: C.text }]}>{item.label}</Text>
                      {item.label !== item.raw && (
                        <Text style={[styles.pickerRowSub, { color: C.textMuted }]}>{item.raw}</Text>
                      )}
                    </View>
                    <AppIcon
                      name={followed ? ICONS.starFilled : ICONS.star}
                      size={20}
                      color={C.favorite}
                    />
                  </TouchableOpacity>
                )
              }}
              ListEmptyComponent={(
                <Text style={[styles.pickerEmpty, { color: C.textMuted }]}>
                  {ja ? '該当するブランドはありません' : 'No brands found'}
                </Text>
              )}
            />
      </BottomSheetModal>
    </>
  )
}

const styles = StyleSheet.create({
  listContent: { padding: UI_METRICS.screenGutter, gap: 10 },
  // gap は listContent と同じ値にする（無いと読み込み中の骨組みだけ切り替えに貼り付き、一覧が出た瞬間に 10 下へずれる）
  emptyContent: { flexGrow: 1, padding: UI_METRICS.screenGutter, gap: 10 },
  headerBleed: { marginHorizontal: -UI_METRICS.screenGutter, marginTop: -UI_METRICS.screenGutter, marginBottom: 0 },
  // ヘッダーは -16 で外へ逃がしてあるので、行の左右は自前で 16 を戻す
  brandRow: { flexDirection: 'row', gap: 8, paddingHorizontal: UI_METRICS.screenGutter, paddingTop: 10 },
  brandChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: UI_METRICS.pillRadius, borderWidth: StyleSheet.hairlineWidth,
  },
  brandChipText: { fontSize: 13, fontWeight: '600' },
  brandChipCount: { fontSize: 11, fontWeight: '700' },
  followBlock: { paddingTop: 12, gap: 6 },
  followHeader: {
    minHeight: UI_METRICS.touchMinSize, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: UI_METRICS.screenGutter,
  },
  followHeading: { flex: 1, fontSize: 11, fontWeight: '700' },
  addBrandAction: { minHeight: UI_METRICS.touchMinSize, flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 12 },
  addBrandText: { fontSize: 13, fontWeight: '700' },
  brandActions: { flexDirection: 'row', gap: 8, paddingHorizontal: UI_METRICS.screenGutter, paddingTop: 8 },
  brandAction: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: UI_METRICS.controlRadius, borderWidth: StyleSheet.hairlineWidth,
  },
  brandActionText: { fontSize: 12, fontWeight: '700' },
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.cardRadius, padding: 10, gap: 12 },
  image: { width: 68, height: 68, borderRadius: UI_METRICS.controlRadius, backgroundColor: '#FFFFFF' },
  iconWrap: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  meta: { fontSize: 11, marginTop: 5 },
  author: { fontSize: 10, marginTop: 2 },
  // ブランド枠は本文ブロックの最後。名前とメタの下に少し離して置く
  brandSlot: { marginTop: 6 },
  remove: { padding: 8 },
  pickerSheet: { maxHeight: '78%', paddingHorizontal: 0 },
  pickerHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  pickerTitle: { fontSize: 17, fontWeight: '800' },
  pickerDoneButton: { position: 'absolute', right: 8, minHeight: UI_METRICS.touchMinSize, justifyContent: 'center', paddingHorizontal: 12 },
  pickerDoneText: { fontSize: 14, fontWeight: '700' },
  pickerSearch: {
    marginHorizontal: 16, marginBottom: 8,
  },
  pickerListContent: { paddingHorizontal: UI_METRICS.screenGutter, paddingBottom: 16 },
  pickerRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  pickerRowBody: { flex: 1, minWidth: 0 },
  pickerRowTitle: { fontSize: 15, fontWeight: '700' },
  pickerRowSub: { marginTop: 3, fontSize: 11 },
  pickerEmpty: { paddingVertical: 32, textAlign: 'center', fontSize: 13 },
})
