// みんなのデスク — 公開されているデスクの一覧。
//
// 見本（公式デモデスク）は4件で見終わってしまうので、その先に他のユーザーの
// 公開デスクを置く。タップで PublicDesk（閲覧専用）へ遷移する。
// 通報・ブロックは遷移先の PublicDeskScreen が持つ（ガイドライン 1.2）。
// ブロック済みユーザーのデスクは一覧に出さない。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../hooks/useToday'
import { useFocusEffect, useIsFocused } from '@react-navigation/native'
import { useScrollToTopOf } from '../hooks/useScrollToTopOf'
import { useScrollSyncRetry } from '../hooks/useScrollSyncRetry'
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs'
import { AppIcon } from '../components/atoms/AppIcon'
import { Button } from '../components/atoms/Button'
import { SearchField } from '../components/atoms/SearchField'
import { BottomSheetModal } from '../components/molecules/BottomSheetModal'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { ExploreGuideCard } from '../components/molecules/ExploreGuideCard'
import { COACH_SCREEN, CoachScope, CoachStep, useCoachMarks } from '../hooks/useCoachMarks'
import { DeskGridTile } from '../components/molecules/DeskGridTile'
import { EmptyState } from '../components/molecules/EmptyState'
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../constants/categoryLabels'
import { CATEGORY_SECTIONS } from '../constants/categoryOrder'
import { categoryIconColor, ICONS } from '../constants/icons'
import { CategoryIcon } from '../components/atoms/CategoryIcon'
import { ListSkeleton } from '../components/molecules/ListSkeleton'
import { BrandResultRow, GearResultRow, ProfileResultRow } from '../components/molecules/SearchResultRow'
import { SearchScope, SearchScopeTabs } from '../components/molecules/SearchScopeTabs'
import { RetryState } from '../components/molecules/RetryState'
import { SearchSuggestionPanel } from '../components/molecules/SearchSuggestionPanel'
import { useApp } from '../context/AppContext'
import { clearPublicSearchHistory, loadPublicSearchHistory, recordPublicSearch } from '../store/publicSearchHistoryStore'
import { hapticMedium, hapticSelection } from '../utils/haptics'
import { useAuth } from '../context/AuthContext'
import { useDeskUpdateBell } from '../hooks/useDeskUpdateBell'
import { analytics, EVENTS } from '../services/analytics'
import {
  getDeskLikeCounts,
  getLikedDeskIds,
  listPublicDesks,
  listPublicDesksByGear,
  listPublicDesksWithGadget,
  listSimilarPublicDesks,
  PublicBrandItem,
  PublicDeskListItem,
  PublicGearItem,
  PublicProfileItem,
  searchPublicBrands,
  searchPublicGear,
  searchPublicProfiles,
  setDeskLiked,
} from '../services/desks'
import { useIntentSync } from '../hooks/useIntentSync'
import { BRANDS_ENABLED } from '../constants/features'
import { followBrand, listBrandFollows, unfollowBrand } from '../services/brandFollows'
import { brandDisplay, brandKey } from '../utils/brandIdentity'
import { getBlockedUserIds } from '../services/moderationService'
import { localizedDemoDeskName } from '../utils/localizedDemoDesk'
import { FeedStackParamList, GadgetCategory, MainTabsParamList, PlanPurpose } from '../types'
import { attributeLabelFromKey } from '../utils/deskAttributes'
import { formatListTimestamp } from '../utils/dateFormat'
import { publicDeskBadgeKind } from '../utils/publicDeskBadge'
import { loadPublicDeskViewed, PublicDeskViewedMap } from '../utils/publicDeskViewed'
import { promptLogin } from '../utils/promptLogin'
import {
  filterPublicDiscoveryRows,
  loadVisiblePublicDeskPage,
  normalizePublicDeskSearch,
  PUBLIC_DESK_SEARCH_MAX_LENGTH,
} from '../utils/publicDeskFeed'
import {
  buildSearchVocabulary,
  correctSearchQuery,
  RelatedSearchTerm,
  relatedSearchTerms,
  suggestSearchTerms,
} from '../utils/publicSearchSuggestions'
import { PURPOSE_DEFS, purposeIcon, purposeIconColor, purposeLabel } from './PurposeSelectionScreen'
import { UI_METRICS } from '../constants/ui'

type Props = NativeStackScreenProps<FeedStackParamList, 'DeskFeed'>

/** デスク・機材・ユーザー・見出しを同じ FlatList に積む。 */
type FeedRow =
  | { key: string; type: 'brand'; brand: PublicBrandItem }
  | { key: string; type: 'gear'; gear: PublicGearItem }
  | { key: string; type: 'profile'; profile: PublicProfileItem }
  | { key: string; type: 'lead'; text: string }
  | { key: string; type: 'section'; label: string }
  // デスクは2列に敷く。見出し・機材・ユーザーと同じ FlatList に積んでいるので
  // numColumns は使えず、1行ぶん（最大2件）をまとめて1つの行として持つ
  | { key: string; type: 'desk'; desks: PublicDeskListItem[] }
  // 検索結果と、その先に続ける近いもの・おすすめの境目
  | { key: string; type: 'boundary'; title: string; caption: string }
  | { key: string; type: 'terms'; terms: RelatedSearchTerm[] }
  // 何も当たらなかった検索。下に近いもの・おすすめを続けるので、一覧の空表示ではなく行として出す
  | { key: string; type: 'empty'; correction: string | null }

const PAGE_SIZE = 20
// 用途で絞るチップ。日本語は空白で区切られないので、検索語だけで用途に当てるには
// 表記ゆれの辞書に頼ることになる（070）。押して選べる軸をひとつ出しておけば、
// 「ゲーミング環境」と打つ前に確実に当てられる。
// 'other' は自由記述の受け皿で、絞っても中身が揃わないので出さない
const PURPOSE_FILTERS = PURPOSE_DEFS.map((def) => def.key).filter((key) => key !== 'other')
// 絞り込みに出すジャンル。ケーブル（どのデスクにもある）と「その他」は絞っても結果が意味を持たない
const FILTER_HIDDEN_CATEGORIES: ReadonlySet<GadgetCategory> = new Set<GadgetCategory>(['Cable', 'Other'])
const FILTER_CATEGORY_SECTIONS = CATEGORY_SECTIONS
  .map((section) => ({ ...section, cats: section.cats.filter((cat) => !FILTER_HIDDEN_CATEGORIES.has(cat)) as GadgetCategory[] }))
  .filter((section) => section.cats.length > 0)
// 検索は用途一致を全体から順位付けするため、更新日時カーソルで継ぎ足さず上位50件を一度に読む。
// 順位の異なるページを日時だけで送ると、ページ境界で取りこぼしが起きる。
const SEARCH_RESULT_LIMIT = 50
// 機材で絞ったときの上限。逆引き（listPublicDesksWithGadget）は更新日時カーソルを
// 持たないので、1回で読み切れる数にしてページを継ぎ足さない
const GADGET_FILTER_LIMIT = 40
// 結果の上に出す機材の行。多いと下のデスクが画面から押し出される
const GEAR_HINT_LIMIT = 3
// 「すべて」は各種類の入口なので、ユーザーだけで一覧を埋めない。
// 続きは常時表示している「ユーザー」タブで見せる。
const ALL_PEOPLE_PREVIEW_LIMIT = 3
// 関連（同じブランド・同じ種類）の段に並べる上限
const RELATED_LIMIT = 12
// 予測に混ぜる機材名。使っているデスクの多い順に上から取る（RPC の上限は100）
const SUGGESTION_GEAR_LIMIT = 100
// 検索結果の先の「近いジャンル・ブランド」を集めるために読む、検索語に当たった機材の数
const BEYOND_GEAR_SAMPLE = 30

type BeyondResults = {
  query: string
  terms: RelatedSearchTerm[]
  recommended: PublicDeskListItem[]
  // 近いデスクが1件も無いときは最近のデスクで埋める。見出しを偽らないよう種類を持つ
  recommendedKind: 'similar' | 'recent'
}

// 結果に多い用途を上から2つ。近いデスクを引く軸にする
function commonPurposes(desks: readonly PublicDeskListItem[]): string[] {
  const counts = new Map<string, number>()
  for (const desk of desks) {
    for (const purpose of desk.purposes ?? []) {
      if (purpose !== 'other') counts.set(purpose, (counts.get(purpose) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([purpose]) => purpose)
}

// 「？」で順に指す。カードが無いとき（検索で0件など）はカードの説明が飛ばされる。
// カードは一覧の枠で切り、上へ送ると入り込む「すべて／デスク／ユーザー」の段の裏は見えていないものとする
const inList = (steps: CoachStep[]): CoachStep[] => steps.map((step) => ({ within: 'feed-list', coveredBy: ['feed-scope'], ...step }))
const FEED_COACH: CoachStep[] = [
  { target: 'feed-search', title: { ja: '名前で検索', en: 'Search by name' }, pad: 4, ja: 'デスク・人・機材の名前で探せます。', en: 'Search desks, people, and gear by name.' },
  { target: 'feed-scope', title: { ja: '検索対象を切替', en: 'Search scope' }, pad: 0, ja: '探す対象を、すべて・デスク・ユーザーで切り替えます。', en: 'Choose what to search: everything, desks, or people.' },
  { target: 'feed-filter', title: { ja: '絞り込み', en: 'Filters' }, pad: 2, ja: '用途や機材のジャンルで絞り込めます。点が付いているときは絞り込み中です。', en: 'Filter by purpose or gear category. A dot means a filter is on.' },
  { target: 'feed-bell', title: { ja: '更新のお知らせ', en: 'Updates' }, pad: 2, ja: '保存したデスクやフォロー中の人の更新、自分のデスクへの拍手が届きます。点は新しいお知らせの印です。', en: 'Updates to saved desks and people you follow, plus applause on your desks. A dot means something new.' },
  ...inList([
  { target: 'feed-card', title: { ja: 'デスクを開く', en: 'Open a desk' }, pad: 4, ja: 'タップでデスクを開きます。投稿者名の横の「3日前」などは、そのデスクが最後に更新されてからの時間です。', en: 'Tap to open a desk. The time beside the author, such as “3d ago”, shows when it was last updated.' },
  { target: 'feed-card-update', title: { ja: '新着・更新の印', en: 'New and updated desks' }, pad: 4, ja: '投稿者名の横の「新着」は公開から7日以内でまだ開いていないデスク、「更新」は前に見たあとに変わったデスクの印です。', en: '“New” beside the author marks desks published within 7 days that you have not opened. “Updated” marks desks that changed since you last looked.' },
  { target: 'feed-card-purposes', title: { ja: 'デスクの用途', en: 'Desk purposes' }, pad: 3, ja: '何に使うデスクか（ゲーム・仕事など）を表す印です。', en: 'What the desk is for, such as gaming or work.' },
  { target: 'feed-card-clap', title: { ja: '拍手する', en: 'Applaud' }, pad: 3, ja: '気に入ったら拍手で伝えられます。用途の右の数字は、これまでに届いた拍手の数で、閲覧数ではありません。', en: 'Applaud desks you like. The number beside the purposes is total applause, not views.' },
  ]),
]

export function DeskFeedScreen({ navigation, route }: Props) {
  useToday()
  const { colors: C, t, lang, isDark, fmtPrice } = useApp()
  const { user } = useAuth()
  const ja = lang === 'ja'
  const focused = useIsFocused()
  const coach = useCoachMarks()
  const { open: openCoach, target: coachTarget } = coach
  const helpOpen = coach.active
  const openHelp = useCallback(() => { void openCoach(FEED_COACH) }, [openCoach])
  const [guideClosed, setGuideClosed] = useState(false)
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => (
      <HeaderIconButton name="help-circle-outline" color={C.text} onPress={openHelp} accessibilityLabel={ja ? 'この画面の見方' : 'Understanding this screen'} />
    ) })
  }, [navigation, C.text, ja, openHelp])
  useEffect(() => {
    if (!focused) setGuideClosed(false)
  }, [focused])

  // タブの根なので、タブの再タップで先頭へ戻せるようにする（他のタブと揃える）
  const listRef = useRef<FlatList<FeedRow>>(null)
  const guideViewportRef = useRef<View>(null)
  const getGuideViewport = useCallback(() => guideViewportRef.current, [])
  const peopleListRef = useRef<FlatList<PublicProfileItem>>(null)

  // 更新一覧の入口に点を出すか。中身（何が変わったか）は開いてから読む。
  // 置き場所は検索バーの横。ヘッダー（headerRight）へ足すと、iOS 26 が
  // ボタンごとにガラスの背景を描いて右上が重くなる（設定の歯車・履歴と同じ話）
  const { hasUnread: hasUnreadUpdates } = useDeskUpdateBell()

  const [items,      setItems]      = useState<PublicDeskListItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const historyOwner = user?.id ?? null
  const historyOwnerRef = useRef(historyOwner)
  historyOwnerRef.current = historyOwner
  const [searchHistory, setSearchHistory] = useState<{ owner: string | null; queries: string[] }>({ owner: historyOwner, queries: [] })
  useEffect(() => {
    let active = true
    void loadPublicSearchHistory(historyOwner).then(queries => {
      if (active) setSearchHistory({ owner: historyOwner, queries })
    }).catch(() => {})
    return () => { active = false }
  }, [historyOwner])
  const rememberSearch = useCallback((query: string) => {
    if (historyOwnerRef.current !== historyOwner || !normalizePublicDeskSearch(query)) return
    void recordPublicSearch(query, historyOwner).then(queries => {
      if (historyOwnerRef.current === historyOwner) setSearchHistory({ owner: historyOwner, queries })
    }).catch(() => {})
  }, [historyOwner])
  const clearSearchHistory = useCallback(() => {
    void clearPublicSearchHistory(historyOwner).then(() => {
      if (historyOwnerRef.current === historyOwner) setSearchHistory({ owner: historyOwner, queries: [] })
    }).catch(() => {})
  }, [historyOwner])
  const [purpose, setPurpose] = useState<PlanPurpose | null>(null)
  // 属性で絞る（071）。公開プロフィールの属性行から渡ってくるだけで、
  // この画面から選ぶ手段は置かない（軸が多すぎてチップの行が二段になる）
  const [attribute, setAttribute] = useState<string | null>(null)
  // 検索結果の面（079）。機材は「すべて」の結果とジャンル絞り込みで探す。
  const [scope, setScope] = useState<SearchScope>('all')
  const scopeScrollRequest = useMemo(() => ({ id: ['all', 'desks', 'people'].indexOf(scope), offset: 0 }), [scope])
  const { handlers: deskScrollHandlers } = useScrollSyncRetry(scopeScrollRequest, scope !== 'people', (offset) => {
    listRef.current?.scrollToOffset({ offset, animated: false })
  })
  const { handlers: peopleScrollHandlers } = useScrollSyncRetry(scopeScrollRequest, scope === 'people', (offset) => {
    peopleListRef.current?.scrollToOffset({ offset, animated: false })
  })
  useScrollToTopOf(() => (scope === 'people' ? peopleListRef.current : listRef.current))
  const changeScope = useCallback((next: SearchScope) => {
    setScope(next)
  }, [])
  useEffect(() => {
    const tabs = navigation.getParent<BottomTabNavigationProp<MainTabsParamList>>()
    if (!tabs) return
    // 別のメインタブへ移ったあとも、表示中の「みんなのデスク」を再タップしたときも、
    // 検索対象の入口は「すべて」に戻す。検索語・ジャンルなどの条件は維持する。
    const resetScope = () => setScope('all')
    const unsubscribePress = tabs.addListener('tabPress', resetScope)
    const unsubscribeBlur = tabs.addListener('blur', resetScope)
    return () => {
      unsubscribePress()
      unsubscribeBlur()
    }
  }, [navigation])
  const [people, setPeople] = useState<PublicProfileItem[]>([])
  // 検索語に当たったブランドと機材。結果の上に見出しとして出し、
  // ここから関連（同じブランド・同じ種類のデスク）の軸も決める
  const [brands, setBrands] = useState<PublicBrandItem[]>([])
  const [gearHits, setGearHits] = useState<PublicGearItem[]>([])
  // お気に入りブランド（074）。押せる★の状態
  const [follows, setFollows] = useState<ReadonlySet<string>>(() => new Set())
  const followsRef = useRef<ReadonlySet<string>>(follows)
  followsRef.current = follows
  // フォローの行にはブランドの表記も保存する。送る時点ではキーしか渡らないので控えておく
  const brandLabelRef = useRef(new Map<string, string>())
  const applyFollow = useCallback((key: string, followed: boolean) => {
    const toggled = (prev: ReadonlySet<string>) => {
      const next = new Set(prev)
      if (followed) next.add(key)
      else next.delete(key)
      return next
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
    onFailed: applyFollow,
  })
  // 完全に当たったデスクを出し切ったあとに続ける2段。境界は見出しで見せる
  const [relatedByBrand, setRelatedByBrand] = useState<PublicDeskListItem[]>([])
  const [relatedByCategory, setRelatedByCategory] = useState<PublicDeskListItem[]>([])
  // 検索結果の末尾に続ける近いジャンル・ブランドとおすすめ。どの語のために取ったかを一緒に持つ
  const [beyond, setBeyond] = useState<BeyondResults | null>(null)
  // 予測。欄に触れている間だけ開く
  const searchInputRef = useRef<TextInput>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const searchBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (searchBlurTimerRef.current !== null) clearTimeout(searchBlurTimerRef.current)
  }, [])
  const [suggestionGear, setSuggestionGear] = useState<PublicGearItem[]>([])
  const suggestionGearRequestedRef = useRef(false)
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  // 今の一覧がどの語・どの面のために取ったものか。取得の effect は描画の後に走るので、
  // タブを押した直後の1フレームは読み込み中の印がまだ立っておらず、「0件」の表示が一瞬出ていた。
  // 取った先と今の条件が違う間は、読み込み中として扱う
  const [discoveryLoadedFor, setDiscoveryLoadedFor] = useState<string | null>(null)
  const [discoveryError, setDiscoveryError] = useState(false)
  const [discoveryRetry, setDiscoveryRetry] = useState(0)
  const [scopeLoading, setScopeLoading] = useState(false)
  const [peopleLoadedFor, setPeopleLoadedFor] = useState<string | null>(null)
  const [scopeError, setScopeError] = useState(false)
  // 失敗したときの引き直し。searchQuery も scope も変わらないので、
  // この数を進めることでしか取得の effect を回せない
  const [scopeRetry, setScopeRetry] = useState(0)
  // 検索結果の機材を選んだ完全一致と、絞り込みから選ぶジャンル。
  const [gadgetFilter, setGadgetFilter] = useState<{ name: string; category: string } | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<GadgetCategory | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [draftPurpose, setDraftPurpose] = useState<PlanPurpose | null>(null)
  const [draftCategory, setDraftCategory] = useState<GadgetCategory | null>(null)
  // 絞り込みシートで開いているジャンルの区分。ジャンルを全部並べるとシートが長いスクロールになるので、
  // 区分ごとに畳んでおき、選んであるジャンルの区分だけ開いた状態で出す
  const [openFilterSections, setOpenFilterSections] = useState<ReadonlySet<string>>(new Set())
  const [loadedQuery, setLoadedQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState(false)
  // 取得失敗を「0件」と混同しない。電波が悪いだけの人に「まだ誰も公開していません」とは言わない
  const [loadError,  setLoadError]  = useState(false)
  // 引っぱって更新・続きの取得の失敗。一覧は残したまま伝えるので loadError とは別に持つ。
  // 兼用にすると、更新に失敗しただけで以降の続きの取得まで止まる
  const [notice, setNotice] = useState<'refresh' | 'more' | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reachedEnd,  setReachedEnd]  = useState(false)
  // 表示対象から除外した行も含めた、サーバー上の最終行を次ページの基準にする。
  // items の末尾を使うと、自分やブロック対象の行が間にある場合に同じ範囲を再取得する。
  const [nextBefore, setNextBefore] = useState<string | undefined>(undefined)
  // 続きの取得が二重に走ると同じデスクが並ぶ
  const moreInFlightRef = useRef(false)
  // 検索語やログイン状態が変わったあとの古いレスポンスで一覧を上書きしない。
  const loadRequestRef = useRef(0)
  const hasLoadedSuccessfullyRef = useRef(false)
  // 一覧を取りに行った時点の閲覧者。自分のデスクを除く判定が変わるのは
  // ログイン・ログアウトのときだけなので、そのときだけ取り直す
  const loadedForRef = useRef<string | null | undefined>(undefined)
  const feedKey = `${user?.id ?? ''}\n${searchQuery}\n${purpose ?? ''}\n${categoryFilter ?? ''}\n${gadgetFilter?.category ?? ''}\n${gadgetFilter?.name ?? ''}`

  // ─── 拍手（内部名は旧称の like のまま・095） ─────────────────────────
  // 一覧のまま押せるようにする。詳細を開かないと反応できないと、見ているだけで
  // 終わってしまう。件数（累計）もボタンの横に出す（反応の数が見えるのが SNS の標準で、
  // 見えないと押した手応えも投稿の反響も伝わらない）。
  // likedIds は「今の版に拍手したデスク」。前の版にだけ拍手したデスクは押せる状態に戻る
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  // 前の版に拍手したことがあるデスク。計測の repeat にだけ使う
  const clappedBeforeRef = useRef(new Set<string>())
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(new Map())
  const askedCountIdsRef = useRef(new Set<string>())
  const bumpLikeCount = useCallback((deskId: string, delta: number) => {
    setLikeCounts((prev) => {
      const current = prev.get(deskId)
      if (current === undefined) return prev
      const next = new Map(prev)
      next.set(deskId, Math.max(0, current + delta))
      return next
    })
  }, [])
  // 連打の2回目は再描画より先に届きうる。押した時点の状態は描画を待たずにここから読む
  const likedIdsRef = useRef(likedIds)
  likedIdsRef.current = likedIds
  // 実際に詳細を開いた時点の内容時刻。保存・フォローの監視開始とは分けて持つ。
  const [viewedDesks, setViewedDesks] = useState<PublicDeskViewedMap>({})
  // 問い合わせ済みのID。ページを足すたびに全件を引き直さないための印
  const askedLikeIdsRef = useRef(new Set<string>())
  // 押されたが、いいね済みかをまだ引いている最中のID
  const likeCheckingRef = useRef(new Set<string>())
  const likeReadsRef = useRef(new Map<string, Promise<boolean>>())
  const clapUserRef = useRef(user?.id)
  clapUserRef.current = user?.id
  const applyLiked = useCallback((deskId: string, liked: boolean) => {
    const toggled = (prev: Set<string>) => {
      const next = new Set(prev)
      if (liked) next.add(deskId)
      else next.delete(deskId)
      return next
    }
    likedIdsRef.current = toggled(likedIdsRef.current)
    setLikedIds(toggled)
  }, [])
  // デスクごとに押した回数。読み込みを始めた時点と比べ、その後に押されたデスクは上書きしない
  // （送信中かだけを見ていた頃は、送り終えた後に届いた読み込みが押す前の件数へ戻していた）
  const clapSeqRef = useRef(new Map<string, number>())
  const clapSeq = (deskId: string) => clapSeqRef.current.get(deskId) ?? 0
  // 手元の ±1 は見込みで、正はサーバーの件数。送り終えたら合わせ直す。重ねて送った拍手や、
  // 版が変わった直後の取り消しは、成功で返るのにサーバーの件数が動かない
  const reconcileLikeCount = (deskId: string) => {
    const seq = clapSeq(deskId)
    getDeskLikeCounts([deskId])
      .then((counts) => {
        if (likeSync.isBusy(deskId) || clapSeq(deskId) !== seq) return
        setLikeCounts((prev) => new Map(prev).set(deskId, counts.get(deskId) ?? 0))
      })
      .catch(() => {})
  }
  const likeSync = useIntentSync<string>({
    send: async (deskId, liked) => {
      if (!user) throw new Error('signed out')
      await setDeskLiked(deskId, user.id, liked)
    },
    onConfirmed: (deskId, liked) => {
      analytics.track(EVENTS.LIKE_TOGGLED, {
        liked,
        placement: 'desk_feed',
        repeat: clappedBeforeRef.current.has(deskId),
      })
    },
    onSettled: (deskId) => reconcileLikeCount(deskId),
    onFailed: (deskId, liked) => {
      if (likedIdsRef.current.has(deskId) !== liked) bumpLikeCount(deskId, liked ? 1 : -1)
      applyLiked(deskId, liked)
      reconcileLikeCount(deskId)
    },
  })
  // 表示中のぶんを引き直させるための印。詳細画面で切り替えて戻ったときに上げる
  const [likeRefreshKey, setLikeRefreshKey] = useState(0)

  // ログイン・ログアウトで拍手の持ち主が変わる。前の人の結果を残さない
  useEffect(() => {
    askedLikeIdsRef.current = new Set()
    clappedBeforeRef.current = new Set()
    likeReadsRef.current.clear()
    likeCheckingRef.current.clear()
    likedIdsRef.current = new Set()
    setLikedIds(new Set())
  }, [user?.id])

  useEffect(() => {
    if (!user) return
    const unasked = items.map((d) => d.id).filter((id) => !askedLikeIdsRef.current.has(id))
    if (unasked.length === 0) return
    let active = true
    const startSeq = new Map(unasked.map((id) => [id, clapSeqRef.current.get(id) ?? 0]))
    getLikedDeskIds(user.id, unasked)
      .then(({ current: ids, before }) => {
        if (!active) return
        // 取得中に押されたデスクは handleToggleLike が自分で引き直して反転させている。
        // ここで押す前の値を書くと、赤くしたハートが白に戻り、次に押すと意図と逆に反転する
        const fresh = unasked.filter((id) =>
          !likeCheckingRef.current.has(id) && !likeSync.isBusy(id) && !askedLikeIdsRef.current.has(id)
          && (clapSeqRef.current.get(id) ?? 0) === startSeq.get(id))
        fresh.forEach((id) => {
          askedLikeIdsRef.current.add(id)
          if (before.has(id)) clappedBeforeRef.current.add(id)
          else clappedBeforeRef.current.delete(id)
        })
        setLikedIds((prev) => {
          const next = new Set(prev)
          // 外れたぶんも反映する。増えたぶんだけを足していた頃は、詳細画面で
          // いいねを外して戻ってもハートが赤いまま残っていた
          for (const id of fresh) {
            if (ids.has(id)) next.add(id)
            else next.delete(id)
          }
          return next
        })
      })
      // 取れなかったぶんは askedLikeIdsRef に入れない。白いハートのまま残るが、
      // 押されたときに handleToggleLike が引き直す
      .catch(() => {})
    return () => { active = false }
  }, [items, user, likeRefreshKey, likeSync])

  // 件数はログインしていなくても出す。関連・おすすめの段も同じタイルなので対象に含める
  useEffect(() => {
    if (likeRefreshKey > 0) askedCountIdsRef.current = new Set()
  }, [likeRefreshKey])
  useEffect(() => {
    const shown = [...items, ...relatedByBrand, ...relatedByCategory, ...(beyond?.recommended ?? [])]
    const unasked = [...new Set(shown.map((d) => d.id))].filter((id) => !askedCountIdsRef.current.has(id))
    if (unasked.length === 0) return
    let active = true
    const startSeq = new Map(unasked.map((id) => [id, clapSeqRef.current.get(id) ?? 0]))
    getDeskLikeCounts(unasked)
      .then((counts) => {
        if (!active) return
        // 送信中・取得中に押されたデスクは手元で足し引きした数のほうが新しい。取得前の値で戻さない
        // （押されたデスクは送り終えたときに reconcileLikeCount が合わせ直す）
        const fresh = unasked.filter((id) => !likeSync.isBusy(id) && (clapSeqRef.current.get(id) ?? 0) === startSeq.get(id))
        fresh.forEach((id) => askedCountIdsRef.current.add(id))
        setLikeCounts((prev) => {
          const next = new Map(prev)
          for (const id of fresh) next.set(id, counts.get(id) ?? 0)
          return next
        })
      })
      .catch(() => {})
    return () => { active = false }
  }, [items, relatedByBrand, relatedByCategory, beyond, likeRefreshKey, likeSync])

  const readClap = useCallback((deskId: string): Promise<boolean> => {
    const pending = likeReadsRef.current.get(deskId)
    if (pending) return pending
    if (!user || clapUserRef.current !== user.id) return Promise.resolve(false)
    likeCheckingRef.current.add(deskId)
    const work = getLikedDeskIds(user.id, [deskId]).then(({ current, before }) => {
      if (clapUserRef.current !== user.id) return false
      if (before.has(deskId)) clappedBeforeRef.current.add(deskId)
      else clappedBeforeRef.current.delete(deskId)
      askedLikeIdsRef.current.add(deskId)
      applyLiked(deskId, current.has(deskId))
      return true
    }).catch(() => false).finally(() => {
      if (likeReadsRef.current.get(deskId) !== work) return
      likeReadsRef.current.delete(deskId)
      likeCheckingRef.current.delete(deskId)
    })
    likeReadsRef.current.set(deskId, work)
    return work
  }, [user, applyLiked])

  const handleToggleLike = useCallback(async (deskId: string, onClap: () => void) => {
    if (!user) {
      promptLogin(navigation, lang, ja ? '拍手するにはログインしてください' : 'Please log in to applaud desks.')
      return
    }
    if (clapUserRef.current !== user.id) return
    // いいね済みかを引けていないデスクは、白いハートが「まだ押していない」ではなく
    // 「分からない」を意味している。そのまま反転すると、いいねするつもりの操作が
    // 解除になる。先に引き直す
    if (!askedLikeIdsRef.current.has(deskId) && !likeSync.isBusy(deskId)) {
      if (!await readClap(deskId)) return
    }
    if (clapUserRef.current !== user.id) return
    // 通信中でも押すたびに反転させる。送るのは最後の状態だけ（utils/intentSync）
    const wasLiked = likedIdsRef.current.has(deskId)
    clapSeqRef.current.set(deskId, (clapSeqRef.current.get(deskId) ?? 0) + 1)
    hapticMedium()
    applyLiked(deskId, !wasLiked)
    if (!wasLiked) onClap()
    bumpLikeCount(deskId, wasLiked ? -1 : 1)
    likeSync.request(deskId, wasLiked, !wasLiked)
  }, [user, navigation, lang, ja, applyLiked, bumpLikeCount, likeSync, readClap])

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(normalizePublicDeskSearch(searchText))
    }, 550)
    return () => clearTimeout(timer)
  }, [searchText])

  // 公開プロフィールの属性行から渡ってくる絞り込み。適用したら params から消す。
  // 残したままだと、あとでタブを押し直すだけで同じ絞り込みが復活する
  // （タブ側に残った params は遷移のたびに効き続ける。utils/tabNavigation.ts と同じ話）
  const routeAttribute = route.params?.attribute
  useEffect(() => {
    if (!routeAttribute) return
    navigation.setParams({ attribute: undefined })
    // 用途だけはチップ（purposes 列）で絞る。attributes は 058 以降に公開し直した
    // デスクにしか入っておらず、属性で当てると古いデスクが結果から落ちる
    const asPurpose = routeAttribute.startsWith('purpose:')
      ? routeAttribute.slice('purpose:'.length) as PlanPurpose
      : null
    const chip = PURPOSE_FILTERS.find((key) => key === asPurpose) ?? null
    // 名前を引けないキーは、何で絞っているのかを画面に出せない。絞り込みごと捨てる
    if (!chip && !attributeLabelFromKey(routeAttribute, lang)) return
    setPurpose(chip)
    setAttribute(chip ? null : routeAttribute)
    // 検索語が残っていると、押した軸と関係のない結果になる
    setSearchText('')
  }, [routeAttribute, navigation, lang])

  const clearFilters = useCallback(() => {
    setPurpose(null)
    setAttribute(null)
    setGadgetFilter(null)
    setCategoryFilter(null)
  }, [])

  const openPurposeFilter = useCallback(() => {
    setDraftPurpose(purpose)
    setDraftCategory(categoryFilter)
    setOpenFilterSections(new Set(
      FILTER_CATEGORY_SECTIONS.filter((section) => categoryFilter && section.cats.includes(categoryFilter)).map((section) => section.title),
    ))
    setFilterOpen(true)
  }, [categoryFilter, purpose])

  const applyPurposeFilter = useCallback(() => {
    if (draftPurpose !== purpose || draftCategory !== categoryFilter || scope !== 'desks') hapticSelection()
    setPurpose(draftPurpose)
    setCategoryFilter(draftCategory)
    if (draftCategory) {
      setGadgetFilter(null)
      setSearchText('')
      setSearchQuery('')
    }
    changeScope('desks')
    setFilterOpen(false)
    if (draftPurpose) analytics.track(EVENTS.DESK_FEED_FILTERED, { purpose: draftPurpose })
    if (draftCategory) analytics.track(EVENTS.DESK_FEED_FILTERED, { gadget: draftCategory })
  }, [changeScope, draftCategory, draftPurpose, purpose, categoryFilter, scope])

  // 連打の2回目は、1回目で前面から外れているので捨てる（同じ画面が2枚積まれる。PublicDesk の openAnotherPublicDesk と同じ）
  const openProfile = useCallback((tag: string) => {
    if (!navigation.isFocused()) return
    rememberSearch(searchQuery)
    navigation.push('PublicProfile', { tag })
  }, [navigation, rememberSearch, searchQuery])

  // 機材を1件選んだら、その機材で絞ったデスクの一覧へ戻る。検索語は消す。
  // 語と機材の両方が効いていると、検索欄に残った字面と結果が合わなくなる
  const openGear = useCallback((name: string, category: string) => {
    rememberSearch(searchQuery)
    setGadgetFilter({ name, category })
    setCategoryFilter(null)
    changeScope('desks')
    setSearchText('')
    setSearchQuery('')
    analytics.track(EVENTS.DESK_FEED_FILTERED, { gadget: category })
  }, [changeScope, rememberSearch, searchQuery])

  const openBrand = useCallback((brand: string) => {
    const key = brandKey(brand)
    if (!key || !navigation.isFocused()) return
    rememberSearch(searchQuery)
    navigation.push('BrandProducts', { brandKey: key, brandLabel: brandDisplay(brand, lang) ?? brand })
  }, [navigation, lang, rememberSearch, searchQuery])

  // ★は押した瞬間に反映して、失敗したら戻す。往復を待たせると
  // 「押したのに何も起きない」時間ができる（いいねと同じ扱い）
  const toggleFollow = useCallback((brand: string) => {
    if (!user) {
      promptLogin(navigation, lang, ja
        ? 'お気に入りに入れるにはログインしてください'
        : 'Please log in to save favorite brands.')
      return
    }
    const key = brandKey(brand)
    if (!key) return
    brandLabelRef.current.set(key, brandDisplay(brand, 'en') ?? brand)
    const wasFollowed = followsRef.current.has(key)
    hapticSelection()
    applyFollow(key, !wasFollowed)
    brandSync.request(key, wasFollowed, !wasFollowed)
  }, [user, navigation, lang, ja, applyFollow, brandSync])

  const fetchPage = useCallback(async (before?: string) => {
    const blockedIds = await getBlockedUserIds()
    // 機材で絞っているときは name + category の完全一致で引く（079 の棚と同じ粒度）。
    // pageSize を上限より 1 大きく渡すのは、カーソルの無い問い合わせで
    // 「返り数 < pageSize」を必ず成立させるため（成立しないと同じ範囲を読み続ける）
    if (gadgetFilter) {
      return loadVisiblePublicDeskPage<PublicDeskListItem>({
        pageSize: GADGET_FILTER_LIMIT + 1,
        before,
        userId: user?.id,
        blockedIds,
        loadPage: () => listPublicDesksWithGadget({
          name: gadgetFilter.name,
          category: gadgetFilter.category,
          limit: GADGET_FILTER_LIMIT,
        }).then((result) => result.items),
      })
    }
    if (categoryFilter) {
      return loadVisiblePublicDeskPage<PublicDeskListItem>({
        pageSize: GADGET_FILTER_LIMIT + 1,
        before,
        userId: user?.id,
        blockedIds,
        loadPage: () => listPublicDesksByGear({
          category: categoryFilter,
          limit: GADGET_FILTER_LIMIT,
        }).then((rows) => rows.filter((desk) =>
          (!purpose || desk.purposes?.includes(purpose))
          && (!attribute || desk.attributes?.includes(attribute)))),
      })
    }
    const pageSize = searchQuery ? SEARCH_RESULT_LIMIT : PAGE_SIZE
    return loadVisiblePublicDeskPage<PublicDeskListItem>({
      pageSize,
      before,
      userId: user?.id,
      blockedIds,
      loadPage: (cursor) => listPublicDesks(pageSize, cursor, searchQuery, purpose ?? undefined, attribute ?? undefined),
    })
  }, [searchQuery, purpose, attribute, gadgetFilter, categoryFilter, user])

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    try {
      const { visible, end, nextBefore: cursor } = await fetchPage()
      if (requestId !== loadRequestRef.current) return
      // 引っぱって更新で一覧だけ新しくなり、件数が前回のまま残らないように
      askedCountIdsRef.current = new Set()
      setItems(visible)
      setReachedEnd(end)
      setNextBefore(cursor)
      setLoadedQuery(searchQuery)
      setSearchError(false)
      hasLoadedSuccessfullyRef.current = true
    } catch (error) {
      if (requestId !== loadRequestRef.current) return
      throw error
    }
  }, [fetchPage, searchQuery])

  const reload = useCallback(() => {
    setLoadError(false)
    setNotice(null)
    return load()
      .catch(() => {
        if (hasLoadedSuccessfullyRef.current && loadedQuery !== searchQuery) {
          // 別の検索語で失敗したときに、前の検索結果を新しい結果のように残さない。
          setItems([])
          setLoadedQuery(searchQuery)
          setReachedEnd(true)
          setNextBefore(undefined)
          setSearchError(true)
        } else if (hasLoadedSuccessfullyRef.current) setNotice('refresh')
        else setLoadError(true)
      })
      .finally(() => setLoading(false))
  }, [load, loadedQuery, searchQuery])

  useEffect(() => {
    analytics.track(EVENTS.DESK_FEED_VIEWED)
  }, [])

  // 「すべて」でもユーザーの入口をまとめて出す。個別タブを開いたときだけでなく、
  // 検索前の初期表示でも上位だけ取得する。
  useEffect(() => {
    // 語が無くてもユーザーのタブは出したままなので、そのときは公開デスクの
    // 多い人から並べる（RPC は空の語を「全件」として扱う）。
    // 「すべて」は入口の3件、ユーザータブは一覧として30件まで取得する。
    if (scope !== 'people' && scope !== 'all') return
    let active = true
    setScopeLoading(true)
    setScopeError(false)
    void searchPublicProfiles(searchQuery, scope === 'all' ? ALL_PEOPLE_PREVIEW_LIMIT : undefined)
      .then(async (rows) => {
        // ブロックした相手はデスクの一覧から消えているのに、人のタブには
        // 残っているということが無いようにする
        const blocked = await getBlockedUserIds()
        if (active) setPeople(filterPublicDiscoveryRows(rows, user?.id, blocked))
      })
      .catch(() => { if (active) setScopeError(true) })
      .finally(() => {
        if (!active) return
        setScopeLoading(false)
        setPeopleLoadedFor(searchQuery)
      })
    return () => { active = false }
  }, [searchQuery, scope, scopeRetry, user?.id])

  // ブランドと機材は「すべて」に検索候補として出す。
  useEffect(() => {
    if (!searchQuery && scope !== 'all') {
      setDiscoveryLoading(false)
      setDiscoveryError(false)
      return
    }
    let active = true
    const discoveryKey = searchQuery
    setDiscoveryLoading(true)
    setDiscoveryError(false)
    void Promise.all([
      // ブランドの見出しは語に当たったときだけ。空の語では必ず0件を返す RPC なので引かない
      // ブランドの分類を閉じている間は引かない（constants/features の BRANDS_ENABLED）
      searchQuery && BRANDS_ENABLED ? searchPublicBrands(searchQuery) : Promise.resolve<PublicBrandItem[]>([]),
      searchPublicGear(searchQuery, GEAR_HINT_LIMIT),
    ])
      .then(([brandRows, gearRows]) => {
        if (!active) return
        setBrands(brandRows)
        setGearHits(gearRows)
      })
      .catch(() => {
        if (!active) return
        setBrands([])
        setGearHits([])
        setDiscoveryError(true)
      })
      .finally(() => {
        if (!active) return
        setDiscoveryLoading(false)
        setDiscoveryLoadedFor(discoveryKey)
      })
    return () => { active = false }
  }, [searchQuery, scope, discoveryRetry])

  // お気に入りの★は、ブランドの見出しが出るときだけ必要
  useEffect(() => {
    if (!user || brands.length === 0) return
    let active = true
    void listBrandFollows(user.id)
      .then((rows) => {
        if (!active) return
        // 送信中の★は押した後の表示を残す。読み込みは押す前に出ていて、古い値を返しうる
        const loaded = new Set(rows.map((row) => row.brand_key))
        for (const key of new Set([...loaded, ...followsRef.current])) {
          if (!brandSync.isBusy(key)) continue
          if (followsRef.current.has(key)) loaded.add(key)
          else loaded.delete(key)
        }
        followsRef.current = loaded
        setFollows(loaded)
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [user, brands.length, brandSync])

  // 関連（同じブランド → 同じ種類）。ガジェット名で探したときだけ続ける。
  // ブランドで探したときは検索そのものがそのブランド全体を拾っているので、
  // 同じものを2段目に並べても増えない
  useEffect(() => {
    if (!searchQuery || loadedQuery !== searchQuery || brands.length > 0 || gearHits.length === 0) {
      setRelatedByBrand([])
      setRelatedByCategory([])
      return
    }
    const top = gearHits[0]
    const shown = items.map((desk) => desk.id)
    let active = true
    void (async () => {
      try {
        const [blockedIds, byBrand] = await Promise.all([
          getBlockedUserIds(),
          top.brand && BRANDS_ENABLED
            ? listPublicDesksByGear({ brand: top.brand, excludeDeskIds: shown, limit: RELATED_LIMIT })
            : Promise.resolve<PublicDeskListItem[]>([]),
        ])
        if (!active) return
        setRelatedByBrand(filterPublicDiscoveryRows(byBrand, user?.id, blockedIds))
        const byCategory = await listPublicDesksByGear({
          category: top.category,
          excludeDeskIds: [...shown, ...byBrand.map((desk) => desk.id)],
          limit: RELATED_LIMIT,
        })
        if (active) setRelatedByCategory(filterPublicDiscoveryRows(byCategory, user?.id, blockedIds))
      } catch {
        if (!active) return
        setRelatedByBrand([])
        setRelatedByCategory([])
      }
    })()
    return () => { active = false }
  }, [searchQuery, loadedQuery, brands.length, gearHits, items, user?.id])

  // 検索結果の先に続ける段。末尾に着いてから読むと、そこで待たせるうえ、
  // 短い結果（スクロールできない）では末尾に着いた合図が来ないことがある。
  // 結果が出た時点で裏で読んでおき、描画は結果の後ろに置く
  useEffect(() => {
    if ((scope !== 'all' && scope !== 'desks') || !searchQuery || loadedQuery !== searchQuery) return
    const query = searchQuery
    let active = true
    void (async () => {
      try {
        const [blockedIds, sample] = await Promise.all([
          getBlockedUserIds(),
          searchPublicGear(query, BEYOND_GEAR_SAMPLE).catch(() => [] as PublicGearItem[]),
        ])
        if (!active) return
        const shownIds = new Set(items.map((desk) => desk.id))
        const visible = (rows: PublicDeskListItem[]) =>
          filterPublicDiscoveryRows(rows, user?.id, blockedIds).filter((desk) => !shownIds.has(desk.id))
        let recommendedKind: BeyondResults['recommendedKind'] = 'similar'
        let recommended = visible(await listSimilarPublicDesks({
          gadgets: sample.slice(0, 12),
          purposes: commonPurposes(items),
          limit: 30,
        }).catch(() => []))
        if (recommended.length === 0) {
          recommendedKind = 'recent'
          recommended = visible(await listPublicDesks(PAGE_SIZE))
        }
        if (active) {
          setBeyond({ query, terms: relatedSearchTerms(query, sample, lang), recommended, recommendedKind })
        }
      } catch {
        if (active) setBeyond({ query, terms: [], recommended: [], recommendedKind: 'similar' })
      }
    })()
    return () => { active = false }
  }, [scope, searchQuery, loadedQuery, items, user?.id, lang])

  // 予測に混ぜる機材名は、検索欄に初めて触れたときに1回だけ読む。
  // 画面を開いただけの人（検索しない人）にまで読ませない
  const loadSuggestionGear = useCallback(() => {
    if (suggestionGearRequestedRef.current) return
    suggestionGearRequestedRef.current = true
    void searchPublicGear('', SUGGESTION_GEAR_LIMIT)
      .then(setSuggestionGear)
      // 読めなければ辞書の語だけで予測する。次に触れたときに読み直す
      .catch(() => { suggestionGearRequestedRef.current = false })
  }, [])

  const searchVocabulary = useMemo(() => buildSearchVocabulary({
    lang,
    purposes: PURPOSE_FILTERS.map((key) => ({ key, ja: purposeLabel(key, 'ja'), en: purposeLabel(key, 'en') })),
    gear: suggestionGear,
  // ブランドの分類を閉じている間は「ブランド」の候補も出さない。語そのものは自由入力で探せる
  }).filter((entry) => BRANDS_ENABLED || entry.kind !== 'brand'), [lang, suggestionGear])

  // 検索語が変われば前の語の結果は捨てる。残すと、新しい語で読み込んでいる間だけ
  // 前の結果が出て、一瞬だけ当たったように見える
  useEffect(() => {
    setPeople([])
    setBrands([])
    setGearHits([])
    setRelatedByBrand([])
    setRelatedByCategory([])
    // 語を消してもタブは選ばれたまま。ここで「すべて」へ戻すと、
    // 消した拍子に見ていた面から弾き出される
  }, [searchQuery])

  useFocusEffect(useCallback(() => {
    let active = true
    void loadPublicDeskViewed().then((viewed) => { if (active) setViewedDesks(viewed) })
    return () => { active = false }
  }, []))

  // 詳細画面でユーザーをブロックして戻った場合も、該当デスクを一覧から除外する。
  // ただし取り直さない。ここで読み直すと、読み進めたぶんが1ページ目に巻き戻り、
  // スクロール位置も末尾へ寄って続きの読み込みが走ってしまう。
  useFocusEffect(useCallback(() => {
    if (loadedForRef.current !== feedKey) {
      const firstLoad = loadedForRef.current === undefined
      loadedForRef.current = feedKey
      moreInFlightRef.current = false
      setLoadingMore(false)
      if (!firstLoad) setSearchLoading(true)
      void reload().finally(() => {
        if (loadedForRef.current === feedKey) setSearchLoading(false)
      })
      return
    }
    // 詳細画面でいいねを切り替えて戻ったぶんを取り込む。一覧そのものは上の理由で
    // 取り直さないので、ここで印を落として引き直させないとハートが古いまま残る
    askedLikeIdsRef.current = new Set()
    setLikeRefreshKey((prev) => prev + 1)
    let active = true
    // ここだけは失敗しても黙って諦める。表示中の一覧は取得時点のブロックで
    // すでに絞ってあり、これは「画面を離れている間に増えたぶん」の後追い。
    // 読めなかったことを理由に、絞り込み済みの一覧を消すほうが害が大きい
    void getBlockedUserIds()
      .then((blockedIds) => {
        if (!active || blockedIds.size === 0) return
        setItems((prev) => prev.filter((d) => !blockedIds.has(d.user_id)))
      })
      .catch(() => {})
    return () => { active = false }
  }, [feedKey, reload]))

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setNotice(null)
    try {
      await load()
      setLoadError(false)
    } catch {
      // 読めている一覧は消さない。空にして「まだ誰も公開していません」を出すほうが害が大きい
      setNotice('refresh')
    } finally {
      setRefreshing(false)
    }
  }, [load])

  // 末尾に着いたら続きを足す。更新日の降順なので、最後の1件より古いものを取る
  const handleEndReached = useCallback(async () => {
    if (searchQuery) return
    if (moreInFlightRef.current || reachedEnd || loading || loadedQuery !== searchQuery) return
    if (!nextBefore) return
    moreInFlightRef.current = true
    setLoadingMore(true)
    const requestKey = feedKey
    try {
      const { visible, end, nextBefore: cursor } = await fetchPage(nextBefore)
      if (loadedForRef.current !== requestKey) return
      setItems((prev) => {
        const known = new Set(prev.map((d) => d.id))
        return [...prev, ...visible.filter((d) => !known.has(d.id))]
      })
      setReachedEnd(end)
      setNextBefore(cursor)
      setNotice(null)
    } catch {
      if (loadedForRef.current !== requestKey) return
      // 続きの失敗は一覧ごと消さない。表示だけ出して、そこから読み直させる
      setNotice('more')
    } finally {
      moreInFlightRef.current = false
      if (loadedForRef.current === requestKey) setLoadingMore(false)
    }
  }, [feedKey, fetchPage, nextBefore, reachedEnd, loading, loadedQuery, searchQuery])

  const openDesk = useCallback((deskId: string) => {
    if (!navigation.isFocused()) return
    setGuideClosed(true)
    rememberSearch(searchQuery)
    navigation.push('PublicDesk', { deskId, source: 'desk_feed' })
  }, [navigation, rememberSearch, searchQuery])

  const noticeText =
    notice === 'more'
      ? (ja ? '続きを読み込めませんでした。タップして再試行' : 'Could not load more. Tap to try again.')
      : (ja ? '最新の状態を取得できませんでした。タップして再試行' : 'Could not refresh. Tap to try again.')
  const normalizedInput = normalizePublicDeskSearch(searchText)
  const searchPending = searchLoading || normalizedInput !== searchQuery
  const hasSearch = loadedQuery.length > 0
  const hasActiveSearch = normalizedInput.length > 0 || hasSearch
  const handleSearchTextChange = useCallback((value: string) => {
    setSearchText(value)
  }, [])
  const clearSearch = useCallback(() => {
    setSearchText('')
  }, [])
  // 予測・近いジャンル・「もしかして」から選んだ語で検索し直す。打った語の入力待ち
  // （550ms）を挟まず確定し、結果の先頭から見せる
  const applySearch = useCallback((query: string) => {
    setSearchText(query)
    setSearchQuery(normalizePublicDeskSearch(query))
    rememberSearch(query)
    searchInputRef.current?.blur()
    Keyboard.dismiss()
    listRef.current?.scrollToOffset({ offset: 0, animated: false })
  }, [rememberSearch])
  const recentQueries = searchFocused && !normalizedInput && searchHistory.owner === historyOwner ? searchHistory.queries : []
  const suggestions = useMemo(
    () => (searchFocused ? suggestSearchTerms(searchText, searchVocabulary) : []),
    [searchFocused, searchText, searchVocabulary],
  )
  const correction = useMemo(
    () => (hasSearch ? correctSearchQuery(loadedQuery, searchVocabulary) : null),
    [hasSearch, loadedQuery, searchVocabulary],
  )
  const attributeLabel = attribute ? attributeLabelFromKey(attribute, lang) : null
  // 用途チップと属性は同時に効く（AND）ので、見出しは両方を並べる
  const categoryFilterLabel = categoryFilter
    ? ((ja ? CATEGORY_LABELS : CATEGORY_LABELS_EN) as Record<GadgetCategory, string>)[categoryFilter]
    : null
  const filterLabels = [purpose ? purposeLabel(purpose, lang) : null, attributeLabel, categoryFilterLabel, gadgetFilter?.name ?? null]
    .filter((label): label is string => !!label)
  const purposeSuffix = filterLabels.length > 0
    ? (ja ? `（${filterLabels.join('・')}）` : ` in ${filterLabels.join(', ')}`)
    : ''
  const hasFilter = filterLabels.length > 0
  // デスクの一覧を出す面。ユーザーのタブは、デスクの読み込み・失敗に引きずられない
  const showsDesks = scope === 'all' || scope === 'desks'
  // 人のタブの空・読み込み中・失敗
  const peoplePending = scopeLoading
    || ((scope === 'people' || scope === 'all') && peopleLoadedFor !== searchQuery)
  const discoveryPending = discoveryLoading
    || ((!!searchQuery || scope === 'all') && discoveryLoadedFor !== searchQuery)
  const scopeEmpty = peoplePending ? (
    <ActivityIndicator size="small" color={C.accentIcon} />
  ) : scopeError ? (
    <RetryState
      message={ja ? '検索結果を取得できませんでした。' : 'Could not load search results.'}
      onRetry={() => setScopeRetry((count) => count + 1)}
    />
  ) : searchQuery ? (
    <EmptyState
      icon="magnify-close"
      title={ja ? '一致するユーザーがいません' : 'No matching people'}
      description={ja ? '表示名か @ID で探してください' : 'Try a display name or @ID.'}
      colors={C}
    />
  ) : (
    <EmptyState
      icon="account-group-outline"
      title={ja ? '公開しているユーザーがいません' : 'No public profiles yet'}
      description={ja ? 'デスクが公開されると、その人がここに並びます' : 'People show up here once they publish a desk.'}
      colors={C}
    />
  )
  const resultPending = scope === 'all'
    ? searchPending || discoveryPending || peoplePending
    : searchPending
  const resultError = scope === 'all'
    ? searchError || discoveryError || scopeError
    : searchError
  useEffect(() => {
    if (focused && (searchFocused || hasActiveSearch || hasFilter || filterOpen || scope !== 'all')) setGuideClosed(true)
  }, [focused, searchFocused, hasActiveSearch, hasFilter, filterOpen, scope])

  // 一覧の先頭に出す1行。何で絞った結果を見ているのかを、結果そのものの上で言う
  const leadText = items.length === 0
    ? null
    : hasSearch
    ? (ja ? `「${loadedQuery}」の検索結果${purposeSuffix}` : `Results for “${loadedQuery}”${purposeSuffix}`)
    : gadgetFilter && filterLabels.length === 1
    ? (ja ? `${gadgetFilter.name}を使っているデスク` : `Desks using ${gadgetFilter.name}`)
    : categoryFilter && filterLabels.length === 1
    ? (ja ? `${categoryFilterLabel}があるデスク` : `Desks with ${categoryFilterLabel}`)
    : filterLabels.length > 0
    ? (ja ? `${filterLabels.join('・')}のデスク` : `${filterLabels.join(', ')} desks`)
    : (ja ? '最近更新された公開デスクから表示しています' : 'Showing recently updated public desks first')

  // 関連の軸。ガジェット名で当たったときの、先頭の機材から採る
  const relatedGear = gearHits[0]
  const relatedCategoryLabel = relatedGear
    ? ((ja ? CATEGORY_LABELS : CATEGORY_LABELS_EN) as Record<string, string>)[relatedGear.category] ?? relatedGear.category
    : ''

  const renderTile = useCallback((desk: PublicDeskListItem) => {
    const photo = [...(desk.desk_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]
    const liked = likedIds.has(desk.id)
    const likeCount = likeCounts.get(desk.id)
    const badgeKind = publicDeskBadgeKind(desk, viewedDesks)
    // 変更点はここでは出せない。listPublicDesks は devices も share_snapshot も
    // 引いていないため材料が無い（一覧でスナップショットを引くと巨大な JSON が飛ぶ）
    return (
      <View key={desk.id} ref={coachTarget('feed-card')} style={styles.gridCell}>
        <DeskGridTile
          coachKey="feed-card"
          id={desk.id}
          title={localizedDemoDeskName(desk.id, desk.title, lang)}
          photoUri={photo?.image_url}
          purposes={desk.purposes as PlanPurpose[] | undefined}
          authorName={desk.owner_name}
          authorAvatarUrl={desk.owner_avatar_url}
          authorTag={desk.owner_tag}
          // 総額は出さない。並びは更新順でいいね数も伏せているのに、金額だけ
          // 漏れていると一覧に「高いほうが上」の序列を持ち込むことになる
          meta={formatListTimestamp(desk.updated_at, lang)}
          // 機材の更新マークはここでは出さない。役割はヘッダーのベル（更新一覧）へ
          // 移した。一覧は更新順に並ぶので、条件を付けてもマークが上に溜まって
          // ただの模様になり、写真を見に来た人の邪魔になる
          updatedLabel={badgeKind === 'new'
            ? (ja ? '新着' : 'New')
            : badgeKind === 'updated'
            ? (ja ? '更新' : 'Updated')
            : null}
          updatedIcon={badgeKind === 'new' ? 'star-four-points' : badgeKind === 'updated' ? 'autorenew' : undefined}
          lang={lang}
          fmtPrice={fmtPrice}
          colors={C}
          isDark={isDark}
          onPress={openDesk}
          // 拍手と件数は写真の右下に重ねる。マイページのタイル右上にあるのは「解除」で
          // 役割が逆なので、位置は揃えない
          liked={liked}
          likeCount={likeCount}
          likeLabel={`${liked ? (ja ? '拍手を取り消す' : 'Remove applause') : (ja ? '拍手する' : 'Applaud')}${likeCount === undefined ? '' : ja ? `（${likeCount}件）` : ` (${likeCount})`}`}
          onToggleLike={handleToggleLike}
          discoveryOrder
          compact
        />
      </View>
    )
  }, [likedIds, likeCounts, viewedDesks, lang, ja, fmtPrice, C, isDark, openDesk, handleToggleLike, coachTarget])

  // 奇数で余った1件は左に置き、右は空の枠で埋める。埋めずに1件だけ入れると
  // タイルが行いっぱいに伸びて、上下の段と大きさが食い違う
  const renderDeskRow = useCallback((desks: PublicDeskListItem[]) => (
    <View style={styles.gridRow}>
      {desks.map((desk) => renderTile(desk))}
      {desks.length < 2 && <View style={styles.gridCell} />}
    </View>
  ), [renderTile])

  // 「すべて」では種類ごとにまとめる。個別タブでは対象だけに絞る。
  // 検索したときは、当たったものの後ろに境目を挟んで近いもの・おすすめを続ける。
  const rows = useMemo(() => {
    const out: FeedRow[] = []
    const pushDesks = (list: PublicDeskListItem[], prefix: string) => {
      for (let i = 0; i < list.length; i += 2) {
        const pair = list.slice(i, i + 2)
        out.push({ key: `${prefix}${pair[0].id}`, type: 'desk', desks: pair })
      }
    }
    const pushGear = () => {
      brands.forEach((row) => out.push({ key: `brand:${row.brand}`, type: 'brand', brand: row }))
      gearHits.forEach((row) => out.push({ key: `gear:${row.category}:${row.name}`, type: 'gear', gear: row }))
    }
    const pushRelated = () => {
      if (relatedByBrand.length > 0 && relatedGear?.brand) {
        const label = brandDisplay(relatedGear.brand, lang) ?? relatedGear.brand
        out.push({
          key: 'section:brand',
          type: 'section',
          label: ja ? `ほかに${label}を使っているデスク` : `Other desks using ${label}`,
        })
        pushDesks(relatedByBrand, 'rb:')
      }
      if (relatedByCategory.length > 0 && relatedGear) {
        out.push({
          key: 'section:category',
          type: 'section',
          label: ja ? `ほかに${relatedCategoryLabel}を使っているデスク` : `Other desks with a ${relatedCategoryLabel}`,
        })
        pushDesks(relatedByCategory, 'rc:')
      }
    }
    // 検索結果の先。境目の行を挟んで、結果とそれ以外を取り違えないようにする。
    // 何も当たらなかったときは、0件の行そのものが境目になるので挟まない
    const beyondReady = beyond?.query === loadedQuery
    const beyondTerms = (beyondReady ? beyond.terms : []).filter((term) => BRANDS_ENABLED || term.kind !== 'brand')
    const shownIds = new Set([...items, ...relatedByBrand, ...relatedByCategory].map((desk) => desk.id))
    const recommended = beyondReady
      ? beyond.recommended.filter((desk) => !shownIds.has(desk.id)).slice(0, RELATED_LIMIT)
      : []
    const hasBeyond = beyondTerms.length > 0 || relatedByBrand.length > 0
      || relatedByCategory.length > 0 || recommended.length > 0
    const pushBeyond = (withBoundary: boolean) => {
      if (!hasBeyond) return
      if (withBoundary) {
        out.push({
          key: 'boundary',
          type: 'boundary',
          title: ja ? `「${loadedQuery}」の検索結果はここまで` : `End of results for “${loadedQuery}”`,
          caption: BRANDS_ENABLED
            ? (ja
              ? 'ここから下は、近いジャンル・ブランドとおすすめのデスクです'
              : 'Below are related categories, brands, and desks you might like')
            : (ja
              ? 'ここから下は、近いジャンルとおすすめのデスクです'
              : 'Below are related categories and desks you might like'),
        })
      }
      if (beyondTerms.length > 0) {
        out.push({ key: 'section:terms', type: 'section', label: BRANDS_ENABLED
          ? (ja ? '近いジャンル・ブランド' : 'Related categories & brands')
          : (ja ? '近いジャンル' : 'Related categories') })
        out.push({ key: 'terms', type: 'terms', terms: beyondTerms })
      }
      pushRelated()
      if (recommended.length > 0) {
        out.push({
          key: 'section:recommended',
          type: 'section',
          label: beyond?.recommendedKind === 'recent'
            ? (ja ? '最近更新されたデスク' : 'Recently updated desks')
            : (ja ? 'おすすめのデスク' : 'Desks you might like'),
        })
        pushDesks(recommended, 'rec:')
      }
    }
    const matchedNothing = scope === 'desks'
      ? items.length === 0
      : items.length === 0 && brands.length === 0 && gearHits.length === 0 && people.length === 0
    if (hasSearch && showsDesks && matchedNothing && !resultPending && !resultError) {
      out.push({ key: 'empty', type: 'empty', correction })
      pushBeyond(false)
      return out
    }

    if (!hasSearch && scope === 'all') {
      const featuredDesks = items.slice(0, 4)
      const remainingDesks = items.slice(featuredDesks.length)
      if (featuredDesks.length > 0) {
        out.push({ key: 'section:recent-desks', type: 'section', label: ja ? '最近のデスク' : 'Recent desks' })
        pushDesks(featuredDesks, 'd:')
      }
      if (gearHits.length > 0) {
        out.push({ key: 'section:popular-gear', type: 'section', label: ja ? 'よく使われている機材' : 'Popular gear' })
        pushGear()
      }
      if (people.length > 0) {
        out.push({ key: 'section:public-people', type: 'section', label: ja ? '公開中のユーザー' : 'People sharing desks' })
        people.forEach((profile) => out.push({ key: `profile:${profile.owner_tag}`, type: 'profile', profile }))
      }
      if (remainingDesks.length > 0) {
        out.push({ key: 'section:more-desks', type: 'section', label: ja ? 'ほかのデスク' : 'More desks' })
        pushDesks(remainingDesks, 'd:')
      }
      return out
    }

    if (hasSearch && scope === 'all') {
      if (items.length > 0) {
        out.push({ key: 'section:desks', type: 'section', label: ja ? 'デスク' : 'Desks' })
        pushDesks(items, 'd:')
      }
      if (brands.length > 0 || gearHits.length > 0) {
        out.push({ key: 'section:gear', type: 'section', label: ja ? '機材' : 'Gear' })
        pushGear()
      }
      if (people.length > 0) {
        out.push({ key: 'section:people', type: 'section', label: ja ? 'ユーザー' : 'People' })
        people.forEach((profile) => out.push({ key: `profile:${profile.owner_tag}`, type: 'profile', profile }))
      }
      pushBeyond(true)
      return out
    }

    if (leadText) out.push({ key: 'lead', type: 'lead', text: leadText })
    pushDesks(items, 'd:')
    if (hasSearch && scope === 'desks') pushBeyond(true)
    return out
  }, [hasSearch, scope, loadedQuery, brands, gearHits, people, leadText, items, relatedByBrand, relatedByCategory, relatedGear, relatedCategoryLabel, beyond, showsDesks, resultPending, resultError, correction, lang, ja])

  const renderRow = useCallback(({ item, index }: { item: FeedRow; index: number }) => {
    switch (item.type) {
      case 'brand':
        return (
          <BrandResultRow
            brand={item.brand.brand}
            deskCount={item.brand.desk_count}
            followed={follows.has(brandKey(item.brand.brand) ?? '')}
            colors={C}
            lang={lang}
            onPress={openBrand}
            onToggleFollow={toggleFollow}
          />
        )
      case 'gear':
        return (
          <GearResultRow
            name={item.gear.name}
            category={item.gear.category}
            deskCount={item.gear.desk_count}
            colors={C}
            isDark={isDark}
            lang={lang}
            onPress={openGear}
          />
        )
      case 'profile':
        return (
          <ProfileResultRow
            tag={item.profile.owner_tag}
            name={item.profile.owner_name}
            avatarUrl={item.profile.owner_avatar_url}
            deskCount={item.profile.desk_count}
            colors={C}
            lang={lang}
            onPress={openProfile}
          />
        )
      case 'lead':
        return (
          <View style={styles.listLead}>
            <Text style={[styles.listLeadText, { color: C.textMuted }]}>{item.text}</Text>
          </View>
        )
      case 'section':
        return <Text style={[styles.sectionLabel, index === 0 && styles.firstSectionLabel, { color: C.textSub }]}>{item.label}</Text>
      case 'desk':
        return renderDeskRow(item.desks)
      case 'boundary':
        return (
          <View style={styles.boundary} accessibilityRole="header">
            <View style={styles.boundaryLine}>
              <View style={[styles.boundaryRule, { backgroundColor: C.border }]} />
              <AppIcon name="check-circle-outline" size={16} color={C.textMuted} />
              <View style={[styles.boundaryRule, { backgroundColor: C.border }]} />
            </View>
            <Text style={[styles.boundaryTitle, { color: C.textSub }]}>{item.title}</Text>
            <Text style={[styles.boundaryCaption, { color: C.textMuted }]}>{item.caption}</Text>
          </View>
        )
      case 'terms':
        return (
          <View style={styles.termRow}>
            {item.terms.map((term) => (
              <TouchableOpacity
                key={`${term.kind}:${term.key}`}
                style={[styles.termChip, { backgroundColor: C.chip, borderColor: C.border }]}
                onPress={() => applySearch(term.label)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={ja ? `${term.label}で検索` : `Search for ${term.label}`}
              >
                {term.kind === 'brand' ? (
                  <AppIcon name={ICONS.tag} size={14} color={C.accentText} />
                ) : (
                  <CategoryIcon category={term.key} size={14} color={categoryIconColor(term.key, isDark)} centered={false} />
                )}
                <Text style={[styles.termChipText, { color: C.text }]} numberOfLines={1}>{term.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )
      case 'empty':
        return (
          <EmptyState
            icon="magnify-close"
            title={scope === 'desks'
              ? (ja ? '一致するデスクがありません' : 'No matching desks')
              : (ja ? '一致する結果がありません' : 'No matching results')}
            description={item.correction
              ? (ja ? `「${item.correction}」の打ち間違いではありませんか` : `Did you mean “${item.correction}”?`)
              : hasFilter
              ? (ja ? '絞り込みを外すか、別の軸で探してください' : 'Clear the filter or try another one.')
              : (ja ? '別のデスク名・投稿者・ガジェットで検索してください' : 'Try another desk, person, or piece of gear.')}
            actionLabel={item.correction
              ? (ja ? `「${item.correction}」で検索` : `Search for “${item.correction}”`)
              : hasFilter ? (ja ? '絞り込みを外す' : 'Clear filter') : undefined}
            onAction={item.correction
              ? () => applySearch(item.correction!)
              : hasFilter ? clearFilters : undefined}
            colors={C}
          />
        )
    }
  }, [follows, C, lang, ja, isDark, scope, openBrand, toggleFollow, openGear, openProfile, renderDeskRow, applySearch, hasFilter, clearFilters])

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.container, { backgroundColor: C.bgList }]}>
    <CoachScope coach={coach}>
      <View style={styles.searchWrap}>
        {/* 吹き出しは入力欄の枠を指す。SearchField の ref は内側の文字の行で、枠より小さい */}
        <View ref={coachTarget('feed-search')} style={styles.searchBarFill}>
        <SearchField
            ref={searchInputRef}
            value={searchText}
            onChangeText={handleSearchTextChange}
            onFocus={() => {
              if (searchBlurTimerRef.current !== null) clearTimeout(searchBlurTimerRef.current)
              searchBlurTimerRef.current = null
              setSearchFocused(true)
              loadSuggestionGear()
            }}
            // 予測を押したときより先に閉じないよう、少し遅らせる（ProductNameField と同じ）
            onBlur={() => {
              if (normalizePublicDeskSearch(searchText) === searchQuery) rememberSearch(searchText)
              if (searchBlurTimerRef.current !== null) clearTimeout(searchBlurTimerRef.current)
              searchBlurTimerRef.current = setTimeout(() => {
                searchBlurTimerRef.current = null
                setSearchFocused(false)
              }, 150)
            }}
            placeholder={ja ? 'デスク・人・機材' : 'Desks, people, gear'}
            onSubmitEditing={() => applySearch(searchText)}
            maxLength={PUBLIC_DESK_SEARCH_MAX_LENGTH}
            accessibilityLabel={ja ? '公開デスク、ユーザー、ガジェットを検索' : 'Search public desks, people, and gear'}
            onClear={clearSearch}
            clearAccessibilityLabel={t('a11y.clearSearch')}
            trailing={searchPending ? <ActivityIndicator size="small" color={C.textMuted} /> : undefined}
        />
        </View>
        <TouchableOpacity
          ref={coachTarget('feed-filter')}
          style={[styles.squareBtn, {
            backgroundColor: hasFilter ? C.input : C.bgList,
            borderColor: hasFilter ? C.inputBorder : 'transparent',
          }]}
          onPress={openPurposeFilter}
          accessibilityRole="button"
          accessibilityLabel={hasFilter
            ? (ja ? 'フィルタ、適用中' : 'Filter, active')
            : (ja ? '絞り込む' : 'Filter')}
        >
          {/* ツマミは「調整する」（再生設定など）に使っている。絞り込みは漏斗で分ける */}
          <AppIcon name="filter-variant" size={21} color={C.text} />
          {hasFilter && <View style={[styles.filterDot, { backgroundColor: C.accent, borderColor: C.input }]} />}
        </TouchableOpacity>
        {/* 更新一覧の入口。未読があるときだけ点を出す（件数は出さない。
            数字は消化しないと減らない借金になる）。押せば点は消え、
            中身は個々のデスクを開くまで一覧に残る */}
        <TouchableOpacity
          ref={coachTarget('feed-bell')}
          style={styles.bellBtn}
          onPress={() => navigation.navigate('DeskUpdates')}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={hasUnreadUpdates
            ? (ja ? '新しい更新あり' : 'New updates available')
            : (ja ? '更新' : 'Updates')}
        >
          <AppIcon name={ICONS.bell} size={22} color={C.text} />
          {hasUnreadUpdates && <View style={[styles.bellDot, { backgroundColor: C.unread, borderColor: C.bgList }]} />}
        </TouchableOpacity>
      </View>
      <View ref={coachTarget('feed-list')} style={styles.body}>
      {/* 検索前から対象を選べるよう常時表示する。ユーザーは検索語が無くても
          利用者の多い順で取得し、検索を消しても選択中の面は維持する。 */}
      <View ref={coachTarget('feed-scope')} collapsable={false}>
        <SearchScopeTabs value={scope} onChange={changeScope} colors={C} lang={lang} />
      </View>
      {/* 適用中の軸は結果の上にも出す。押している軸が画面から読めないと、
          みんなのデスクが急に数件になった理由が分からない */}
      {showsDesks && hasFilter && (
        <View style={styles.attributeRow}>
          {!!purpose && (
            <TouchableOpacity
              style={[styles.attributeChip, { backgroundColor: C.accent }]}
              onPress={() => setPurpose(null)}
              accessibilityRole="button"
              accessibilityLabel={ja
                ? `${purposeLabel(purpose, lang)}の絞り込みを外す`
                : `Remove ${purposeLabel(purpose, lang)} filter`}
            >
              <AppIcon name={purposeIcon(purpose)} size={14} color={C.onAccent} />
              <Text style={[styles.attributeChipText, { color: C.onAccent }]} numberOfLines={1}>
                {purposeLabel(purpose, lang)}
              </Text>
              <AppIcon name={ICONS.close} size={13} color={C.onAccent} />
            </TouchableOpacity>
          )}
          {!!gadgetFilter && (
            <TouchableOpacity
              style={[styles.attributeChip, { backgroundColor: C.accent }]}
              onPress={() => setGadgetFilter(null)}
              accessibilityRole="button"
              accessibilityLabel={ja ? `${gadgetFilter.name}の絞り込みを外す` : `Remove ${gadgetFilter.name} filter`}
            >
              <Text style={[styles.attributeChipText, { color: C.onAccent }]} numberOfLines={1}>{gadgetFilter.name}</Text>
              <AppIcon name={ICONS.close} size={13} color={C.onAccent} />
            </TouchableOpacity>
          )}
          {!!categoryFilter && categoryFilterLabel && (
            <TouchableOpacity
              style={[styles.attributeChip, { backgroundColor: C.accent }]}
              onPress={() => setCategoryFilter(null)}
              accessibilityRole="button"
              accessibilityLabel={ja ? `${categoryFilterLabel}の絞り込みを外す` : `Remove ${categoryFilterLabel} filter`}
            >
              <CategoryIcon category={categoryFilter} size={14} color={C.onAccent} />
              <Text style={[styles.attributeChipText, { color: C.onAccent }]} numberOfLines={1}>{categoryFilterLabel}</Text>
              <AppIcon name={ICONS.close} size={13} color={C.onAccent} />
            </TouchableOpacity>
          )}
          {!!attributeLabel && (
          <TouchableOpacity
            style={[styles.attributeChip, { backgroundColor: C.accent }]}
            onPress={() => setAttribute(null)}
            accessibilityRole="button"
            accessibilityLabel={ja ? `${attributeLabel}の絞り込みを外す` : `Remove ${attributeLabel} filter`}
          >
            <Text style={[styles.attributeChipText, { color: C.onAccent }]}>{attributeLabel}</Text>
            <AppIcon name={ICONS.close} size={13} color={C.onAccent} />
          </TouchableOpacity>
          )}
        </View>
      )}
      {/* 読み込み中・読めなかったときも検索欄とベルは出したままにする。画面ごと
          差し替えると、探しに来た人が読み込みの間だけ何も打てなくなり、
          失敗したときは検索という逃げ道ごと消える（マイガジェットと同じ扱い） */}
      {loading && showsDesks ? (
        <ListSkeleton count={4} variant="card" columns={2} discoveryOrder inset="gutter" />
      ) : loadError && items.length === 0 && showsDesks ? (
        <RetryState
          message={ja ? 'デスクを読み込めませんでした。' : 'Could not load desks.'}
          onRetry={() => { setLoading(true); void reload() }}
        />
      ) : scope !== 'people' ? (
        <View ref={guideViewportRef} collapsable={false} style={{ flex: 1 }}>
        {/* 失敗を黙って飲み込むと、古い一覧を最新だと思わせたままになる */}
        {!!notice && showsDesks && (
          <TouchableOpacity
            style={[styles.notice, { backgroundColor: C.chip, borderColor: C.border }]}
            onPress={() => (notice === 'more' ? void handleEndReached() : void handleRefresh())}
            accessibilityRole="button"
            accessibilityLabel={noticeText}
          >
            <AppIcon name="alert-circle-outline" size={14} color={C.textMuted} />
            <Text style={[styles.noticeText, { color: C.textSub }]} numberOfLines={2}>{noticeText}</Text>
          </TouchableOpacity>
        )}
        {/* 2列で敷く。1列の投稿カードは1件で画面の高さを埋めてしまい、探すのに
            何十回もスクロールすることになる。ここは読む場所ではなく写真で選ぶ場所
            （保存のタブと同じ compact のタイルを使う）。投稿者といいねは
            DeskGridTile の discoveryOrder で写真の上に残す */}
        <FlatList
          // 結果の種類と深いスクロール位置を同時に差し替える。描画後に scrollTo(0) すると、
          // 古い位置の1フレームが見えてから先頭へ瞬間移動する。
          key={scope}
          ref={listRef}
          {...deskScrollHandlers}
          scrollEventThrottle={16}
          data={rows}
          keyExtractor={(row) => row.key}
          alwaysBounceVertical
          contentContainerStyle={rows.length === 0 ? styles.emptyContent : styles.listContent}
          refreshControl={(
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
              progressBackgroundColor={C.card}
            />
          )}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={renderRow}
          ItemSeparatorComponent={ListSeparator}
          ListHeaderComponent={<View>
            <ExploreGuideCard
              id="explore-open-desk"
              eligible={!guideClosed && !loading && !refreshing && !resultPending && !resultError && !notice && items.length > 0 && scope === 'all' && !hasActiveSearch && !hasFilter}
              blocked={helpOpen || filterOpen || searchFocused}
              getViewport={getGuideViewport}
              onHelp={openHelp}
            />
          </View>}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color={C.accentIcon} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            resultPending ? (
              <ActivityIndicator size="small" color={C.accentIcon} />
            ) : resultError ? (
              <EmptyState
                icon="alert-circle-outline"
                title={ja ? '検索結果を取得できませんでした' : 'Could not load search results'}
                description={ja ? '通信環境を確認して、もう一度お試しください' : 'Check your connection and try again.'}
                actionLabel={ja ? 'もう一度試す' : 'Try again'}
                onAction={() => {
                  setSearchError(false)
                  setSearchLoading(true)
                  if (scope === 'all') {
                    setDiscoveryRetry((count) => count + 1)
                    setScopeRetry((count) => count + 1)
                  }
                  void reload().finally(() => setSearchLoading(false))
                }}
                colors={C}
              />
            ) : (
              <EmptyState
                icon={hasSearch || hasFilter ? 'magnify-close' : 'account-group-outline'}
                title={hasSearch || hasFilter
                  ? (ja ? '一致する結果がありません' : 'No matching results')
                  : (ja ? '公開されているデスクがありません' : 'No public desks yet')}
                description={hasFilter
                  ? (ja ? '絞り込みを外すか、別の軸で探してください' : 'Clear the filter or try another one.')
                  : hasSearch
                  ? (ja ? '別のデスク名・投稿者・ガジェットで検索してください' : 'Try another desk, person, or piece of gear.')
                  : (ja ? '誰かがデスクを公開すると、ここに並びます' : 'Desks people publish will show up here.')}
                actionLabel={hasFilter ? (ja ? '絞り込みを外す' : 'Clear filter') : undefined}
                onAction={hasFilter ? clearFilters : undefined}
                colors={C}
              />
            )
          }
        />
        </View>
      ) : (
        <FlatList
          ref={peopleListRef}
          {...peopleScrollHandlers}
          scrollEventThrottle={16}
          data={people}
          keyExtractor={(row) => row.owner_tag}
          contentContainerStyle={people.length === 0 ? styles.emptyContent : styles.rowListContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => (
            <ProfileResultRow
              tag={item.owner_tag}
              name={item.owner_name}
              avatarUrl={item.owner_avatar_url}
              deskCount={item.desk_count}
              colors={C}
              lang={lang}
              onPress={openProfile}
            />
          )}
          ListEmptyComponent={scopeEmpty}
        />
      )}
      {/* 予測は一覧の上に重ねる。一覧を押し下げると、打つたびに結果の位置が動く */}
      {(suggestions.length > 0 || recentQueries.length > 0) && (
        <View style={styles.suggestionLayer}>
          <SearchSuggestionPanel
            suggestions={suggestions}
            recentQueries={recentQueries}
            onClearHistory={clearSearchHistory}
            colors={C}
            isDark={isDark}
            lang={lang}
            onSelect={applySearch}
          />
        </View>
      )}
      </View>
      {/* 下から出るシートの土台に寄せる。Modal の slide は暗い背景ごとせり上がり、出るまでがもたついた */}
      {coach.overlay}
      <BottomSheetModal visible={filterOpen} onDismiss={() => setFilterOpen(false)} sheetStyle={styles.filterSheet}>
            <View style={styles.filterHeader}>
              <View style={styles.filterHeaderSide} />
              <Text style={[styles.filterTitle, { color: C.text }]}>
                {ja ? '絞り込み' : 'Filter'}
              </Text>
              {/* シートの中の選択だけを戻す。ここで一覧まで外すと、ほかの選択は「この条件で表示」まで
                  反映されないのにリセットだけ即時に効き、閉じたときに何が適用されているか分からなくなる */}
              <TouchableOpacity
                style={styles.filterHeaderSide}
                onPress={() => {
                  setDraftPurpose(null)
                  setDraftCategory(null)
                }}
                disabled={!draftPurpose && !draftCategory}
                accessibilityRole="button"
                accessibilityLabel={ja ? '選択をリセット' : 'Reset selection'}
                accessibilityState={{ disabled: !draftPurpose && !draftCategory }}
              >
                <Text style={[styles.filterReset, { color: draftPurpose || draftCategory ? C.accentText : C.textMuted }]}>
                  {ja ? 'リセット' : 'Reset'}
                </Text>
              </TouchableOpacity>
            </View>
            {/* 選択肢はチェック付きの行で並べる（iOS の一覧の選択と同じ形）。タイルを敷き詰めると
                ジャンルだけで 29 段の長いスクロールになり、長い名前も省略されていた */}
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.filterBody} keyboardShouldPersistTaps="handled">
              <Text style={[styles.filterLabel, { color: C.textSub }]}>
                {ja ? '用途' : 'Purpose'}
              </Text>
              <View style={[styles.filterGroup, { backgroundColor: C.card }]}>
                {PURPOSE_FILTERS.map((key, index) => {
                  const selected = draftPurpose === key
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[styles.filterRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator }]}
                      onPress={() => setDraftPurpose((current) => current === key ? null : key)}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                    >
                      <AppIcon name={purposeIcon(key)} size={20} color={purposeIconColor(key, isDark)} />
                      <Text style={[styles.filterRowText, { color: C.text }]} numberOfLines={1}>
                        {purposeLabel(key, lang)}
                      </Text>
                      {selected && <AppIcon name={ICONS.check} size={20} color={C.accentIcon} />}
                    </TouchableOpacity>
                  )
                })}
              </View>
              <Text style={[styles.filterLabel, styles.categoryFilterLabel, { color: C.textSub }]}>
                {ja ? '機材のジャンル' : 'Gear category'}
              </Text>
              <View style={[styles.filterGroup, { backgroundColor: C.card }]}>
                {FILTER_CATEGORY_SECTIONS.map((section, sectionIndex) => {
                  const open = openFilterSections.has(section.title)
                  const picked = draftCategory && section.cats.includes(draftCategory) ? draftCategory : null
                  const pickedLabel = picked
                    ? ((ja ? CATEGORY_LABELS : CATEGORY_LABELS_EN) as Record<GadgetCategory, string>)[picked]
                    : null
                  const sectionTitle = ja ? section.title : section.titleEn
                  return (
                    <View key={section.title} style={sectionIndex > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator }}>
                      <TouchableOpacity
                        style={styles.filterRow}
                        onPress={() => setOpenFilterSections((prev) => {
                          const next = new Set(prev)
                          if (next.has(section.title)) next.delete(section.title)
                          else next.add(section.title)
                          return next
                        })}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: open }}
                        accessibilityLabel={pickedLabel
                          ? (ja ? `${sectionTitle}、${pickedLabel}を選択中` : `${sectionTitle}, ${pickedLabel} selected`)
                          : sectionTitle}
                      >
                        <Text style={[styles.filterRowText, styles.filterSectionText, { color: C.text }]} numberOfLines={1}>
                          {sectionTitle}
                        </Text>
                        {/* 畳んだままでも、どの区分で選んでいるかが見えるようにする */}
                        {pickedLabel && (
                          <Text style={[styles.filterPicked, { color: C.accentText }]} numberOfLines={1}>{pickedLabel}</Text>
                        )}
                        <AppIcon name={open ? ICONS.chevronUp : ICONS.chevronDown} size={18} color={C.textMuted} />
                      </TouchableOpacity>
                      {open && section.cats.map((category) => {
                        const selected = draftCategory === category
                        return (
                          <TouchableOpacity
                            key={category}
                            style={[styles.filterRow, styles.filterChildRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator }]}
                            onPress={() => setDraftCategory((current) => current === category ? null : category)}
                            activeOpacity={0.7}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                          >
                            <CategoryIcon category={category} size={18} color={categoryIconColor(category, isDark)} />
                            <Text style={[styles.filterRowText, { color: C.text }]} numberOfLines={1}>
                              {((ja ? CATEGORY_LABELS : CATEGORY_LABELS_EN) as Record<GadgetCategory, string>)[category]}
                            </Text>
                            {selected && <AppIcon name={ICONS.check} size={20} color={C.accentIcon} />}
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  )
                })}
              </View>
            </ScrollView>
            <Button
              title={ja ? 'この条件で表示' : 'Show results'}
              style={styles.applyFilterBtn}
              onPress={applyPurposeFilter}
            />
      </BottomSheetModal>
    </CoachScope>
    </SafeAreaView>
  )
}

// 一覧の行間。描画のたびに新しい関数を渡すと、区切りが毎回作り直される
function ListSeparator() {
  return <View style={styles.listSeparator} />
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  // 検索欄より下。予測を重ねる基準にする
  body: { flex: 1 },
  suggestionLayer: { position: 'absolute', top: 0, left: UI_METRICS.screenGutter, right: UI_METRICS.screenGutter, zIndex: 10 },
  boundary: { alignItems: 'center', gap: 4, marginTop: 20, marginBottom: 4 },
  boundaryLine: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  boundaryRule: { flex: 1, height: StyleSheet.hairlineWidth },
  boundaryTitle: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  boundaryCaption: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  termRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  termChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%',
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: UI_METRICS.pillRadius, borderWidth: StyleSheet.hairlineWidth,
  },
  termChipText: { flexShrink: 1, fontSize: 13, fontWeight: '600' },
  // タイルの余白・間隔はマイデスク一覧と揃える
  listContent:  { padding: UI_METRICS.screenGutter },
  // 人・機材は1列の行。写真で選ぶものではないので、2列にして数を詰めても読めない
  rowListContent: { padding: UI_METRICS.screenGutter, gap: 10 },
  // 段の境目。上に余白を足して、前の段のタイルと続いて見えないようにする
  sectionLabel: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  firstSectionLabel: { marginTop: 0 },
  listSeparator: { height: 12 },
  // 列の間隔は縦の行間と同じにして、格子の目を正方に見せる
  gridRow: { flexDirection: 'row', gap: 12 },
  gridCell: { flex: 1, minWidth: 0 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  // 下の余白は一覧との境目。検索欄は固定で一覧だけがスクロールするので、
  // ここを詰めるとカードが欄の底で断ち切られ、写真の上端や共有ボタンが半分欠ける
  // 上はヘッダーの下線に寄せる。検索欄はヘッダーの続きとして読ませるもので、下のタブと同じ 12 を
  // 空けると、ヘッダーから浮いた別の段に見えていた
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },
  searchBarFill: { flex: 1, minWidth: 0 },
  squareBtn: {
    position: 'relative',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: UI_METRICS.controlRadius,
  },
  filterDot: { position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  // 検索欄と同じ高さの正方形。幅を中身任せにすると、点の有無でボタンが伸び縮みする
  bellBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  // 点は絵の右上。背景色の縁を挟んでベルの線から浮かせる（重なると汚れに見える）
  bellDot: { position: 'absolute', top: 7, right: 7, width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.5 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: UI_METRICS.controlRadius,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17 },
  attributeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  attributeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: UI_METRICS.pillRadius,
  },
  attributeChipText: { fontSize: 13, fontWeight: '600' },
  listLead: { paddingBottom: 2 },
  listLeadText: { fontSize: 12, lineHeight: 17 },
  footerLoading: { paddingVertical: 16, alignItems: 'center' },
  filterSheet: { maxHeight: '88%', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingBottom: 28 },
  filterHeader: { minHeight: UI_METRICS.touchMinSize, flexDirection: 'row', alignItems: 'center' },
  filterHeaderSide: { width: 76, minHeight: UI_METRICS.touchMinSize, justifyContent: 'center', alignItems: 'flex-end' },
  filterTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  filterReset: { fontSize: 14 },
  filterBody: { paddingBottom: 4 },
  filterLabel: { marginTop: 12, marginBottom: 8, marginLeft: 4, fontSize: 13, fontWeight: '600' },
  categoryFilterLabel: { marginTop: 22 },
  filterGroup: { borderRadius: UI_METRICS.cardRadius, overflow: 'hidden' },
  filterRow: { minHeight: UI_METRICS.rowMinHeight, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  // 区分の中のジャンルは一段下げて、どの見出しの中身かを読めるようにする
  filterChildRow: { paddingLeft: 24 },
  filterRowText: { flex: 1, minWidth: 0, fontSize: 15 },
  filterSectionText: { fontWeight: '600' },
  filterPicked: { maxWidth: '45%', fontSize: 14, fontWeight: '600' },
  applyFilterBtn: { marginTop: 18 },
})
