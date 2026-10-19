import { Alert } from '../utils/alert'
// 公開デスクページ — 共有リンク（mydesk://setup/[deskId]）から開く。
//   写真（全幅カルーセル）＋ デスクの概要 ＋ 3タブ（機材 / 配線 / 情報）
// 編集系（名前変更・写真の追加削除・ガジェット削除・購入日設定・金額入力導線・
// 配線図の編集・公開更新）は取り除き、閲覧とブックマーク・シェアのみ行える。
//
// 表示構成は「マイデスク」(WiringResultScreen) と揃え、公開画面固有の差は
// 投稿者情報・閲覧専用操作・リアクションだけに留める。
import { useIsFocused } from '@react-navigation/native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { PublicNavigation } from '../navigation/screenProps'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Dimensions,
  InteractionManager,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { GestureDetector } from 'react-native-gesture-handler'
import Reanimated from 'react-native-reanimated'
import { CollapsibleTabContent } from '../components/molecules/CollapsibleTabContent'
import { DeskPurposeIcons, PURPOSE_ICONS_INLINE_MAX } from '../components/molecules/DeskPurposeIcons'
import { useCollapsibleHeader } from '../hooks/useCollapsibleHeader'
import 'react-native-get-random-values'
import { AppIcon } from '../components/atoms/AppIcon'
import { ClapBurst } from '../components/atoms/ClapBurst'
import { ClapMark } from '../components/atoms/ClapMark'
import { RollingCount } from '../components/atoms/RollingCount'
import { TogglePop } from '../components/atoms/TogglePop'
import { AuthorAvatar } from '../components/atoms/AuthorAvatar'
import { FollowButton } from '../components/atoms/FollowButton'
import { useUserFollow } from '../hooks/useUserFollow'
import { CategoryIcon } from '../components/atoms/CategoryIcon'
import { ArmMountIcon } from '../components/atoms/ArmMountIcon'
import { RecommendedGadgetMark } from '../components/atoms/RecommendedGadgetMark'
import { favoriteGadgetIdSet } from '../utils/favoriteGadgets'
import { HeaderButtonGroup, HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { DeskPhotoPreviewModal } from '../components/organisms/DeskPhotoPreviewModal'
import { Skeleton } from '../components/atoms/Skeleton'
import { TabUnderline } from '../components/atoms/TabUnderline'
import { ConnectionMap } from '../components/organisms/ConnectionMap'
import { DeskHistoryEntryCard } from '../components/organisms/DeskHistoryEntryCard'
import { prepareDeskHistory } from '../components/organisms/DeskHistoryAnimationModal'
import { GadgetStatsPanel, INSIGHTS_COACH } from '../components/organisms/GadgetStatsPanel'
import { GADGET_SORT_OPTIONS, GadgetSortKey, GadgetSortSheet } from '../components/organisms/GadgetSortSheet'
import { DeskCableSection } from '../components/organisms/DeskGadgetSections'
import { useDeskGadgetSections } from '../hooks/useDeskGadgetSections'
import { SharedGadgetDetailModal } from '../components/organisms/SharedGadgetDetailModal'
import { SimilarPublicDesks } from '../components/organisms/SimilarPublicDesks'
import { BottomSheetModal } from '../components/molecules/BottomSheetModal'
import { ExploreGuideCard } from '../components/molecules/ExploreGuideCard'
import { COACH_SCREEN, CoachScope, useCoachMarks } from '../hooks/useCoachMarks'
import { DESK_GADGETS_COACH, DESK_TABS_COACH, DESK_WIRING_COACH, PUBLIC_DESK_FOOTER_COACH, PUBLIC_DESK_TOP_COACH } from '../constants/deskCoachSteps'
import { DeskPhotoCarousel } from '../components/molecules/DeskPhotoCarousel'
import { DeskDescription } from '../components/molecules/DeskDescription'
import { GADGET_LIST_FLOATING_INSET, GadgetListFloatingControls } from '../components/molecules/GadgetListFloatingControls'
import { categoryIconColor, DECOR_COLOR, ICONS } from '../constants/icons'
import { useDeskShareUrl } from '../hooks/useDeskShareUrl'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useDeskDetail } from '../hooks/useDesk'
import { usePlans } from '../hooks/usePlans'
import { useEntitlement } from '../hooks/useEntitlement'
import { useDeskSetupGuard } from '../hooks/useDeskSetupGuard'
import { openPaywall } from '../navigation/rootNavigation'
import { buildDeskCopySource } from '../utils/deskCopy'
import { openInTabFromRoot } from '../utils/tabNavigation'
import { analytics, EVENTS, trackLimitHit, trackOnce } from '../services/analytics'
import { recordDeskTraffic } from '../services/deskTraffic'
import { getDeskClapState, getDeskLikeCounts, isBookmarkedByUser, setDeskBookmarked, setDeskLiked } from '../services/desks'
import { useIntentSync } from '../hooks/useIntentSync'
import { blockUser, isUserBlocked, reportDesk, ReportReason, unblockUser } from '../services/moderationService'
import { localizedErrorMessage } from '../utils/localizedError'
import { deskUpdateStamp, markSeen } from '../utils/bookmarkSeen'
import { localizedDemoDeskName } from '../utils/localizedDemoDesk'
import { markPublicDeskViewed } from '../utils/publicDeskViewed'
import { recordDeskView } from '../utils/viewHistory'
import { PLAN_LIMITS } from '../constants/plans'
import { deskChangeHeadline, summarizeDeskChanges } from '../utils/deskChangeSummary'
import { copyPublicUrl, shareDesk } from '../services/shareService'
import { hapticMedium, hapticSelection } from '../utils/haptics'
import { AICoachChatParams, CableType, Gadget, MapConnection, PublicStackParamList } from '../types'
import { gadgetSubNickname, gadgetTitle } from '../utils/localizedGadgetName'
import { orderDeskGadgets } from '../utils/gadgetAttachments'
import { sumDeviceQuantities, sumGadgetPrices, validGadgetPrice } from '../utils/gadgetStats'
import { toPhotoUrls, toPublicDeskModel } from '../utils/publicDeskAdapter'
import { connectionsOnDesk } from '../utils/planWiring'
import { openLoginScreen, promptLogin } from '../utils/promptLogin'
import { formatDate } from '../utils/dateFormat'
import { UI_METRICS } from '../constants/ui'
import { formatPublicAuthor, publicAuthorParts } from '../utils/publicAuthor'

type PublicDeskNavigatorParamList = PublicStackParamList & { AICoachChat: AICoachChatParams }
// navigation は祖先（タブ → Root）を重ねた型で受ける。この画面はタブの中に積むので、
// 自分のスタックだけの型だと課金の案内（Root の Paywall）へ行けない（screenProps.ts）
type Props = Omit<NativeStackScreenProps<PublicDeskNavigatorParamList, 'PublicDesk'>, 'navigation'> & {
  navigation: PublicNavigation
}

const { width: SCREEN_W } = Dimensions.get('window')
// 写真アプリと同じく、写真と写真のあいだに隙間を置く。隣の写真が地続きに見えると
// 「1枚の横長画像をスクロールしている」ように見えて、めくった実感が出ない


type Tab = 'gadgets' | 'wiring' | 'info'
const TAB_IDS: Tab[] = ['gadgets', 'wiring', 'info']
const EMPTY_MAP_CONNECTIONS: MapConnection[] = []
const EMPTY_GADGETS: Gadget[] = []
// 歴史の先読みを始めるまでの待ち。開いた直後のスクロール・タブ操作と計算を重ねない
const HISTORY_PREFETCH_DELAY_MS = 1200

function fmtDate(iso: string, lang: 'ja' | 'en'): string {
  return formatDate(new Date(iso), lang)
}

export function PublicDeskScreen({ route, navigation }: Props) {
  const { deskId, source, gadgetId } = route.params
  // 共有ページの「アプリで配線図を見る」などから、開くタブを指して来る（?tab=wiring）。
  // クエリは文字列のまま届くので、知らない値は捨てて既定の機材にする
  const linkedTab: Tab | null = TAB_IDS.includes(route.params.tab as Tab) ? route.params.tab as Tab : null
  const { colors: C, t, lang, isDark, fmtPrice, displayAmount, historyGrain } = useApp()
  const { user } = useAuth()
  const { desk, loading, error, reload } = useDeskDetail(deskId)

  // 同じ画面へ移るので navigate ではなく push。navigate だと同名ルートの
  // パラメータだけが差し替わり、戻ると元のデスクではなく一覧まで戻ってしまう。
  // タイルは memo なので、行ごとに関数を作らない
  // 連打すると push が2回通り、同じデスクが2枚積まれる。1回目で前面から外れるので2回目を捨てる
  const openAnotherPublicDesk = useCallback((nextDeskId: string) => {
    if (!navigation.isFocused()) return
    navigation.push('PublicDesk', { deskId: nextDeskId, source: 'gadget_desks' })
  }, [navigation])
  const openSimilarDesk = useCallback((nextDeskId: string) => {
    if (!navigation.isFocused()) return
    navigation.push('PublicDesk', { deskId: nextDeskId, source: 'similar_desks' })
  }, [navigation])

  const [showShare,   setShowShare]   = useState(false)
  const coach = useCoachMarks()
  const { open: openCoach, target: coachTarget } = coach
  const helpOpen = coach.active
  const guideBottomRef = useRef<View>(null)
  const getGuideBottom = useCallback(() => guideBottomRef.current, [])
  const [sharing,     setSharing]     = useState(false)
  const [bookmarked,       setBookmarked]       = useState(false)
  // 連打の2回目は再描画より先に届きうる。押した時点の状態は描画を待たずにここから読む
  const bookmarkedRef = useRef(false)
  // 押されたが、保存済みかをまだ引いている最中
  const bookmarkCheckingRef = useRef(false)
  const bookmarkKnownRef = useRef(false)
  // 押すたびに進める。開いた直後の状態取得が押す前に出ていたら、返ってきた古い値で
  // 押した結果を上書きしない（上書きすると表示とサーバーが逆になり、次に押すと意図と逆に反転する）
  const likeGenRef = useRef(0)
  const bookmarkGenRef = useRef(0)
  // 拍手（内部名は旧称の like のまま・095）。liked は「今の版に拍手したか」
  const [liked, setLiked] = useState(false)
  const likedRef = useRef(false)
  const [clapBurstKey, setClapBurstKey] = useState(0)
  const [savePopKey, setSavePopKey] = useState(0)
  // 前の版に拍手したことがあるか。今の版に未拍手なら「もう一度拍手」を出す
  const [clappedBefore, setClappedBefore] = useState(false)
  const clappedBeforeRef = useRef(false)
  const applyClappedBefore = useCallback((value: boolean) => {
    clappedBeforeRef.current = value
    setClappedBefore(value)
  }, [])
  const [likeCount, setLikeCount] = useState(0)
  const likeCheckingRef = useRef(false)
  const likeReadRef = useRef<{ key: string; work: Promise<boolean> } | null>(null)
  const clapContext = `${user?.id ?? ''}:${deskId}`
  const clapContextRef = useRef(clapContext)
  clapContextRef.current = clapContext
  // いいね済みかを引けたか。引けていない間の liked=false は「押していない」ではなく
  // 「分からない」で、そのまま切り替えると意図と逆に倒れる
  const likeKnownRef = useRef(false)
  // 件数は表示中のいいねと一緒に動かす。押すたび・失敗して戻すたびに ±1 する
  const applyLiked = useCallback((value: boolean) => {
    if (likedRef.current === value) return
    likedRef.current = value
    setLiked(value)
    setLikeCount((count) => Math.max(0, count + (value ? 1 : -1)))
  }, [])
  const applyBookmarked = useCallback((value: boolean) => {
    bookmarkedRef.current = value
    setBookmarked(value)
  }, [])
  // 押すたびに表示を反転し、通信は最後の状態だけを送る（utils/intentSync）
  const likeSync = useIntentSync<string>({
    send: async (id, value) => {
      if (!user) throw new Error('signed out')
      await setDeskLiked(id, user.id, value)
    },
    onConfirmed: (_, value) => {
      analytics.track(EVENTS.LIKE_TOGGLED, {
        liked: value,
        placement: 'public_desk',
        repeat: clappedBeforeRef.current,
      })
    },
    onSettled: (id) => reconcileLikeCount(id),
    onFailed: (id, value) => {
      applyLiked(value)
      reconcileLikeCount(id)
    },
  })
  // 手元の ±1 は見込みで、正はサーバーの件数。送り終えたら合わせ直す。
  // 開き直したデスクは前回の控えの件数をまず出すので、裏の読み直しが届く前に押すと
  // 「古い件数 +1」のまま残っていた（送信中に届いた読み直しの件数は捨てるため）。
  // 重ねて送った拍手や、版が変わった直後の取り消しも、成功で返るのに件数が動かない
  const reconcileLikeCount = useCallback((id: string) => {
    const likeGen = likeGenRef.current
    getDeskLikeCounts([id])
      .then((counts) => {
        if (likeSync.isBusy(id) || likeGenRef.current !== likeGen) return
        setLikeCount(counts.get(id) ?? 0)
      })
      .catch(() => {})
  }, [likeSync])
  const bookmarkSync = useIntentSync<string>({
    send: async (id, value) => {
      if (!user) throw new Error('signed out')
      await setDeskBookmarked(id, user.id, value)
    },
    onConfirmed: (_, value) => analytics.track(EVENTS.BOOKMARK_TOGGLED, { bookmarked: value, placement: 'public_desk' }),
    onFailed: (_, value) => applyBookmarked(value),
  })
  const shareInFlightRef = useRef(false)

  // 既定は機材。自分のデスクも公開デスクも、開いたときに最初に出るタブを揃える
  // （画面ごとに違うと、同じ形の画面なのに指の行き先が変わる）。
  // 配線図はタブ1つ隣で、写真ストリップはタブより上にあるのでどちらでも見える
  const [tab,         setTab]         = useState<Tab>(linkedTab ?? 'gadgets')
  // 開いている画面へ別のタブ指定のリンクが来たら合わせる（同じデスクのリンクは画面を積み直さない）
  useEffect(() => { if (linkedTab) setTab(linkedTab) }, [linkedTab])
  const [tabBarWidth, setTabBarWidth] = useState(SCREEN_W)
  const [mapReady,    setMapReady]    = useState(false)
  const [mapMounted,  setMapMounted]  = useState(false)
  // 情報タブ（履歴・統計）も一度マウントしたら保持する。都度アンマウントすると
  // 開くたびに統計の再集計とグラフの再構築が走り、タブを開いた瞬間に固まって見える。
  const [infoMounted, setInfoMounted] = useState(false)
  // 初回のマウントは押されたフレームから外す（配線タブと同じ）。同じコミットで統計を組むと、
  // 集計が終わるまで下線もタブの下も止まり、空白のまま固まって見えていた。
  // マウントまでの間は下の「集計中」を出す
  useEffect(() => {
    if (tab !== 'info' || infoMounted) return
    const task = InteractionManager.runAfterInteractions(() => setInfoMounted(true))
    return () => task.cancel()
  }, [tab, infoMounted])

  // ── 既読の記録 ──
  // **既読は「開いた画面」で書く。** 一覧側（保存タブ・更新一覧・みんなのデスク）だけに
  // 置いていたため、いいねしただけのデスクを開いても既読にならず、読み終えたデスクが
  // 更新一覧に残り続けていた。共有リンク・公開プロフィール経由も同じ。
  // 比較に使う値（deskUpdateStamp）で記録する — 片方だけ updated_at にすると
  // 「更新あり」が二度と出なくなる
  const seenStamp = desk ? deskUpdateStamp(desk) : null
  useEffect(() => {
    if (!seenStamp) return
    void markSeen(deskId, seenStamp)
    void markPublicDeskViewed(deskId, seenStamp)
  }, [deskId, seenStamp])

  // 統計タブ
  const [statsAnimVersion, setStatsAnimVersion] = useState(0)

  const [gadgetSort,         setGadgetSort]         = useState<GadgetSortKey>('createdAt')
  const [gadgetSortExpanded, setGadgetSortExpanded] = useState(false)
  const [cablesCollapsed, setCablesCollapsed] = useState(false)
  // ケーブル節の「種類」階層。開いた種類だけ個別のケーブルを出す
  const [expandedCableTypes, setExpandedCableTypes] = useState<Set<CableType | '__unknown'>>(new Set())
  const [detailGadget,       setDetailGadget]       = useState<Gadget | null>(null)

  const [previewIndex,      setPreviewIndex]      = useState<number | null>(null)
  const [previewVisibleIdx, setPreviewVisibleIdx] = useState(0)

  // 上部（写真・概要）をタブの一覧に合わせて畳む。仕組みは useCollapsibleHeader だけが持つ
  // （自分のデスクと同じものを使う。画面側に書き直すと audit:collapsible-header が止める）
  const {
    collapseH,
    headerShiftStyle,
    headerParallaxStyle,
    headerContainerStyle,
    listContentStyle,
    handleCollapsibleLayout,
    handleHeaderDoubleTap,
    headerPan,
    captureTouchDuringFling,
    wiringPhotoExpanded,
    handleWiringPhotoToggle,
    gadgetScrollRef,
    infoScrollRef,
    handleGadgetScroll,
    handleInfoScroll,
    onGadgetLayout,
    onGadgetContentSize,
    onInfoLayout,
    onInfoContentSize,
    paneExtension,
    wiringPaneExtension,
    listBottomInset,
    listContentMinHeight,
    hideWiringPhotoForFit,
  } = useCollapsibleHeader({ tab })
  const getGuideViewport = useCallback(() => gadgetScrollRef.current?.getNativeScrollRef(), [gadgetScrollRef])

  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try { await reload(true) } finally { setRefreshing(false) }
  }, [reload])

  const ja = lang === 'ja'
  const displayDeskTitle = localizedDemoDeskName(deskId, desk?.title ?? '', lang)

  useEffect(() => {
    if (!desk) return
    let active = true
    const likeGen = likeGenRef.current
    const bookmarkGen = bookmarkGenRef.current
    // 引っ張って更新しても desk が変わる。送信中の表示は消さない
    if (!bookmarkCheckingRef.current && !bookmarkSync.isBusy(deskId)) {
      applyBookmarked(false)
      bookmarkKnownRef.current = false
    }
    if (!likeCheckingRef.current && !likeSync.isBusy(deskId)) {
      likedRef.current = false
      setLiked(false)
      applyClappedBefore(false)
      likeKnownRef.current = false
      setLikeCount(desk.like_count ?? 0)
      // この画面で押したあとに届いたデスクは、押す前に引いた件数かもしれない。引き直す
      if (likeGen > 0) reconcileLikeCount(deskId)
    }
    if (user) {
      Promise.all([
        isBookmarkedByUser(deskId, user.id),
        getDeskClapState(deskId, user.id),
      ]).then(([bookmarkValue, clapState]) => {
        if (!active) return
        if (bookmarkGenRef.current === bookmarkGen && !bookmarkSync.isBusy(deskId)) {
          applyBookmarked(bookmarkValue)
          bookmarkKnownRef.current = true
        }
        if (likeGenRef.current === likeGen && !likeSync.isBusy(deskId)) {
          // 件数（desk.like_count）は自分の拍手を含んだ値なので、ここでは動かさない
          likedRef.current = clapState.clapped
          setLiked(clapState.clapped)
          applyClappedBefore(clapState.clappedBefore)
          likeKnownRef.current = true
        }
      }).catch(() => {})
    }
    return () => { active = false }
  }, [desk, user, deskId, applyBookmarked, applyClappedBefore, bookmarkSync, likeSync, reconcileLikeCount])

  // ─── リモートデータ → アプリ内モデル（マイデスクと同じ部品で描画するため）───
  // ケーブルは一覧の最下段の
  // 「ケーブル」ジャンルにまとめる。配線図でも「線」であって「ノード」ではないので、
  // ノードとしては描かない。
  // 導出は起動時のウォームアップと共通（toPublicDeskModel）。別々に組むと配線図
  // キャッシュのキーがずれ、温めたレイアウトが使われない
  const model = useMemo(() => (desk ? toPublicDeskModel(desk) : null), [desk])

  // このデスクを参考に自分のデスクを作る。写すのはジャンルの組み合わせと置き場所で、
  // 商品は作成画面で候補として出すだけ（utils/deskCopy.ts）。作成はマイデスクのタブで進める
  const { plans: myAllPlans } = usePlans()
  const recommendedIds = favoriteGadgetIdSet(model?.plan)
  const { checkLimit, getLimit, tier: subscriptionTier = 'free', isLoading: billingLoading } = useEntitlement()
  const ensureNoUnfinishedSetup = useDeskSetupGuard(navigation)
  const startDeskCopy = useCallback(async () => {
    if (!desk || !model) return
    if (!await ensureNoUnfinishedSetup()) return
    // 確認を待つ間にこのデスクから離れていたら、課金画面や作成へ連れ出さない
    if (!navigation.isFocused()) return
    const ownPlanCount = myAllPlans.filter((p) => !p.isShared).length
    if (!checkLimit('maxWiringPlans', ownPlanCount)) {
      trackLimitHit('maxWiringPlans', { current: ownPlanCount, max: getLimit('maxWiringPlans'), placement: 'public_desk_copy' })
      navigation.navigate('Paywall', { reason: 'maxWiringPlans' })
      return
    }
    const copySource = buildDeskCopySource({
      deskId,
      title: desk.title,
      ownerName: desk.owner_name,
      plan: model.plan,
      gadgets: model.selectedGadgets,
    })
    openInTabFromRoot(navigation, 'PlanTab', 'PurposeSelection', {
      initialPurposes: copySource.purposes,
      initialOtherPurposeLabel: model.plan.otherPurposeLabel,
      initialOtherPurposeIcon: model.plan.otherPurposeIcon,
      initialOtherPurposeColor: model.plan.otherPurposeColor,
      copySource,
    }, { fresh: true, lang })
  }, [checkLimit, desk, deskId, ensureNoUnfinishedSetup, getLimit, lang, model, myAllPlans, navigation])
  const plan = useMemo(
    () => model ? { ...model.plan, name: displayDeskTitle } : null,
    [model, displayDeskTitle],
  )
  const historyGadgets  = model?.historyGadgets ?? EMPTY_GADGETS
  // 拍手は版ごとに送れる（095）ので、何が変わったかを添える。機材か写真が一度も
  // 変わっていないデスク（content_updated_at が無い）では、作った日の追加しか無いので出さない
  const latestChangeText = useMemo(
    () => desk?.content_updated_at && plan
      ? deskChangeHeadline(summarizeDeskChanges(historyGadgets, plan.gadgetUsage), lang)
      : null,
    [desk?.content_updated_at, plan, historyGadgets, lang],
  )
  const selectedGadgets = model?.selectedGadgets ?? EMPTY_GADGETS
  // 統計に渡す線。公開時の share_snapshot には外した機材との線も残っているので、ここで絞る
  const statsConnections = useMemo(
    () => connectionsOnDesk(plan?.connectionMap?.connections ?? EMPTY_MAP_CONNECTIONS, plan?.selectedGadgetIds ?? []),
    [plan],
  )
  const openedRouteGadgetRef = useRef<string | null>(null)
  useEffect(() => {
    if (!gadgetId) return
    const key = `${deskId}:${gadgetId}`
    if (openedRouteGadgetRef.current === key) return
    const target = selectedGadgets.find((g) => g.id === gadgetId)
    if (!target) return
    openedRouteGadgetRef.current = key
    setDetailGadget(target)
  }, [deskId, gadgetId, selectedGadgets])
  // 台数はケーブルを除く（ケーブルは上の「ケーブル」欄で本数として別に並ぶ）
  const selectedQuantity = sumDeviceQuantities(selectedGadgets)
  const nonCableGadgets = model?.nonCableGadgets ?? EMPTY_GADGETS
  const cableGadgets = useMemo(
    () => selectedGadgets.filter((g) => g.category === 'Cable'),
    [selectedGadgets],
  )
  const photos  = useMemo(() => (desk ? toPhotoUrls(desk) : []), [desk])
  // 引っぱって更新で写真が減ったとき、サムネ列が実在しない位置を指したままにしない
  useEffect(() => {
    setPreviewVisibleIdx((prev) => (prev < photos.length ? prev : 0))
  }, [photos.length])

  // 「デスク歴」タイル用。公開デスクは持ち主が設定した開始日を持たないので、
  // 最も古い導入日（撤去済みを含む）をデスクの始まりとして扱う
  const deskStartedAt = useMemo(() => {
    const dates = historyGadgets.map((g) => g.purchasedAt).filter((d): d is string => !!d)
    return dates.length > 0 ? dates.reduce((oldest, d) => (d < oldest ? d : oldest)) : undefined
  }, [historyGadgets])

  const totalPrice = useMemo(() => sumGadgetPrices(selectedGadgets), [selectedGadgets])

  const { sortedGadgets, sortedCableGadgets, cableTypeGroups, cableTotalCount } =
    useDeskGadgetSections(nonCableGadgets, cableGadgets, gadgetSort, lang)
  // 配線図のシート（つなぐ機材・飾り）に出す順。機材タブと同じにする
  const mapListOrder = useMemo(
    () => orderDeskGadgets(sortedGadgets, statsConnections).map(({ gadget }) => gadget.id),
    [sortedGadgets, statsConnections],
  )

  // 配線図（ConnectionMap）は一度マウントしたら display 切替だけでタブ間を
  // 移動させる（都度アンマウント→再マウントすると、その度に重いレイアウト
  // 計算が走り直して「配線」タブを開いた瞬間に固まって見える）。
  //
  // 以前はデータ取得の 800ms 後に事前マウントしていたが、17台・21本規模の
  // 公開デスクだとレイアウト計算に数百ms〜1秒かかり、その間 JS スレッドが
  // 埋まってヘッダーの戻るを含むタップが取りこぼされていた。
  // 開いた直後の操作を優先し、配線タブを開いたときに初めてマウントする。
  // 初回だけローディングが出るが、それ以降はタブ切替が即時なのは変わらない。
  const planReady = !!plan
  // 配線タブが既定になったため、固定待ち時間ではなく画面遷移が終わるのを待つ。
  // 先読み済みのデモデスクは取得を待たずに planReady になるので、50ms では
  // 押し込みアニメーションの最中にレイアウト計算が重なる。
  useEffect(() => {
    if (tab !== 'wiring' || mapMounted || !planReady) return
    const task = InteractionManager.runAfterInteractions(() => setMapMounted(true))
    return () => task.cancel()
  }, [tab, mapMounted, planReady])

  // ── 歴史の先読み ──
  // 再生画面を開いてから各時点の配線図を組むと「準備中」で待たされる。開いているタブの読み込み
  // （機材の一覧・情報タブの集計・配線図の計算）が落ち着いてから裏で計算しておき、再生画面は
  // その結果か、計算中の仕事に相乗りする（prepareDeskHistory が同じ計算をまとめる）。
  // 画面を閉じたとき・上に別のデスクを重ねて見えなくなったときは止め、途中の結果は捨てる。
  // 残すと、次に開いた画面の計算と JS スレッドを取り合う。
  // 期間の上限とまとめる単位は再生カード（DeskHistoryEntryCard）と同じ値にする。
  // ずれると計算結果の指紋が合わず、先読みが使われない
  const isFocused = useIsFocused()
  // 他人のデスクは全期間、自分の公開デスクは自分の契約の範囲（103 で owner_tier をやめた）
  const viewerOwnsDesk = !!user && !!desk && desk.user_id === user.id
  const historyYearsLimit = viewerOwnsDesk ? getLimit('historyAnimationYears') : -1
  const tabSettled = tab === 'gadgets' || (tab === 'info' && infoMounted) || (tab === 'wiring' && mapReady)
  const historyPrefetchRef = useRef<{ key: string; cancel: () => void } | null>(null)
  useEffect(() => {
    if (!isFocused) {
      historyPrefetchRef.current?.cancel()
      historyPrefetchRef.current = null
      return
    }
    if (!plan || historyGadgets.length === 0 || !tabSettled) return
    const key = `${plan.id}#${historyGrain}#${historyYearsLimit}#${lang}`
    // 一度始めたら、タブを替えただけでは止めない（止めると最初からやり直しになる）
    if (historyPrefetchRef.current?.key === key) return
    historyPrefetchRef.current?.cancel()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        if (cancelled) return
        prepareDeskHistory(plan, historyGadgets, lang, historyYearsLimit, historyGrain, {
          cancelled: () => cancelled,
        }).catch(() => {
          // 先読みの失敗は画面に出さない。再生画面を開いたときに計算し直し、そこで伝える
        })
      }, HISTORY_PREFETCH_DELAY_MS)
    })
    historyPrefetchRef.current = {
      key,
      cancel: () => {
        cancelled = true
        task.cancel()
        if (timer) clearTimeout(timer)
      },
    }
  }, [isFocused, plan, historyGadgets, tabSettled, historyGrain, historyYearsLimit, lang])
  useEffect(() => () => historyPrefetchRef.current?.cancel(), [])

  const handleToggleBookmark = useCallback(async () => {
    if (!user) {
      promptLogin(navigation, lang, ja ? '保存するにはログインしてください' : 'Please log in to save desks.')
      return
    }
    // 保存済みかを引いている間の連打は捨てる。引けるまで何を反転すればよいか分からない
    if (bookmarkCheckingRef.current) return
    bookmarkGenRef.current += 1
    // いいねと同じ理由で、分からないまま押されたら先に引く（保存済みのデスクで押すと外れていた）
    if (!bookmarkKnownRef.current && !bookmarkSync.isBusy(deskId)) {
      bookmarkCheckingRef.current = true
      try {
        applyBookmarked(await isBookmarkedByUser(deskId, user.id))
        bookmarkKnownRef.current = true
      } catch {
        return
      } finally {
        bookmarkCheckingRef.current = false
      }
    }
    const current = bookmarkedRef.current
    hapticSelection()
    if (!current) setSavePopKey((key) => key + 1)
    applyBookmarked(!current)
    bookmarkSync.request(deskId, current, !current)
  }, [user, deskId, ja, lang, navigation, applyBookmarked, bookmarkSync])

  const readClap = useCallback((): Promise<boolean> => {
    if (likeReadRef.current?.key === clapContext) return likeReadRef.current.work
    if (!user || clapContextRef.current !== clapContext) return Promise.resolve(false)
    likeCheckingRef.current = true
    const work = getDeskClapState(deskId, user.id).then((state) => {
      if (clapContextRef.current !== clapContext) return false
      likedRef.current = state.clapped
      setLiked(state.clapped)
      applyClappedBefore(state.clappedBefore)
      likeKnownRef.current = true
      return true
    }).catch(() => false).finally(() => {
      if (likeReadRef.current?.work !== work) return
      likeReadRef.current = null
      likeCheckingRef.current = false
    })
    likeReadRef.current = { key: clapContext, work }
    return work
  }, [user, deskId, clapContext, applyClappedBefore])

  const handleToggleLike = useCallback(async () => {
    if (!user) {
      promptLogin(navigation, lang, ja ? '拍手するにはログインしてください' : 'Please log in to applaud desks.')
      return
    }
    if (clapContextRef.current !== clapContext) return
    likeGenRef.current += 1
    // 状態を引けていなければ先に引く。分からないまま反転すると
    // 「拍手する」が既存の拍手の取り消しになる
    if (!likeKnownRef.current && !likeSync.isBusy(deskId)) {
      if (!await readClap()) return
    }
    if (clapContextRef.current !== clapContext) return
    const current = likedRef.current
    hapticMedium()
    applyLiked(!current)
    if (!current) setClapBurstKey((key) => key + 1)
    likeSync.request(deskId, current, !current)
  }, [user, navigation, lang, ja, deskId, applyLiked, likeSync, readClap, clapContext])

  // ─── 通報・ブロック（App Store ガイドライン 1.2）───────────────
  // 他人の公開デスクを閲覧できるアプリでは、通報手段とブロック機能が必須。
  const ownerId  = desk?.user_id ?? null
  const ownerName = desk?.owner_name ?? null
  const ownerTag  = desk?.owner_tag ?? null
  // 所有者が公開プロフィールを非公開にしていたら、投稿者から人単位の一覧へ飛ばさない。
  // そういう人のデスクはサーバーが @ID を空で返す（103）ので、タグが無いことでも判定できる
  const profileOpenable = !!ownerTag && desk?.owner_profile_public !== false
  const isOwnDesk = !!user && !!ownerId && user.id === ownerId
  // ブロックの確認が済むまで中身を出さない。初期値を「ブロックなし」にすると、確認が返るまでの間と
  // 通信に失敗したときに、ブロックした相手のデスクが表示される（一覧側は失敗を「なし」で代用しない）
  const [blockCheck, setBlockCheck] = useState<{ ownerId: string; result: 'blocked' | 'clear' | 'failed' } | null>(null)
  const [blockCheckRetry, setBlockCheckRetry] = useState(0)
  const needsBlockCheck = !!user && !!ownerId && !isOwnDesk
  const blockResult = !needsBlockCheck ? 'clear' : blockCheck?.ownerId === ownerId ? blockCheck.result : 'pending'
  const blocked = blockResult === 'blocked'
  const setBlocked = useCallback((value: boolean) => {
    if (ownerId) setBlockCheck({ ownerId, result: value ? 'blocked' : 'clear' })
  }, [ownerId])

  useEffect(() => {
    if (!user || !ownerId || isOwnDesk) return
    let active = true
    isUserBlocked(ownerId)
      .then((value) => { if (active) setBlockCheck({ ownerId, result: value ? 'blocked' : 'clear' }) })
      .catch(() => { if (active) setBlockCheck({ ownerId, result: 'failed' }) })
    return () => { active = false }
  }, [user, ownerId, isOwnDesk, blockCheckRetry])

  // プロフィールを非公開にした人は、人単位の集約であるフォローの対象にもしない（057）
  const canFollow = !!ownerId && profileOpenable && !isOwnDesk && !blocked
  const { following, toggle: toggleFollow } = useUserFollow(canFollow ? ownerId : null, navigation, 'public_desk')

  // 公開ページの閲覧数。共有機能に価値があるかはこれが無いと判断できない。
  // deskId ごとに1回だけ送る（タブ切り替えや再描画では送らない）。
  const viewTrackedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!desk || viewTrackedRef.current === deskId) return
    viewTrackedRef.current = deskId
    // PostHog は同意した人の分しか届かない。件数だけは同意と無関係に数える（091）
    if (!isOwnDesk) recordDeskTraffic(desk.id, 'app_view')
    if (!isOwnDesk) void trackOnce(EVENTS.FIRST_PUBLIC_DESK_VIEWED, { source: source ?? 'deep_link' })
    analytics.track(EVENTS.PUBLIC_PAGE_VIEWED, {
      is_own_desk:  isOwnDesk,
      authenticated: !!user,
      device_count: selectedQuantity,
      photo_count:  desk.desk_photos?.length ?? 0,
      // どの入口から見に来たか。指定が無いのは共有URLからの起動（通知は URL に source=push を載せる）
      source: source ?? 'deep_link',
    })
  }, [desk, deskId, isOwnDesk, user, selectedQuantity, source])

  const recordedHistoryRef = useRef<string | null>(null)
  useEffect(() => {
    // URL限定は一覧から引き直せない。権利確認前に記録するとProの履歴を無料枠で切ってしまう。
    if (!desk || isOwnDesk || desk.visibility !== 'public' || billingLoading) return
    const key = `${user?.id ?? 'guest'}:${desk.id}`
    if (recordedHistoryRef.current === key) return
    recordedHistoryRef.current = key
    void recordDeskView(desk.id, undefined, PLAN_LIMITS[subscriptionTier].maxViewHistory)
  }, [desk, isOwnDesk, user?.id, billingLoading, subscriptionTier])

  /**
   * 戻る。共有URLから直接開いた場合はこの画面がスタックの1枚目になりうるため、
   * goBack() が何も起きずに終わる。戻り先が無いときはデスク一覧へ送って、
   * リンクを踏んだ人がアプリ内に入れるようにする。
   */
  const goBackOrHome = useCallback(() => {
    // 自前の戻るボタンなので連打で goBack が2回通り、1画面余計に戻る。1回目で前面から外れる
    if (!navigation.isFocused()) return
    if (navigation.canGoBack()) navigation.goBack()
    else navigation.navigate('MainTabs')
  }, [navigation])

  const reportInFlightRef = useRef(false)
  const submitReport = useCallback(async (reason: ReportReason) => {
    if (!desk || reportInFlightRef.current) return
    reportInFlightRef.current = true
    try {
      await reportDesk(desk.id, reason)
      Alert.alert(
        ja ? '報告しました' : 'Report sent',
        ja ? '内容を確認します。ご協力ありがとうございます。' : 'Thanks — we will review this content.',
      )
    } catch (e: any) {
      Alert.alert(ja ? 'エラー' : 'Error', localizedErrorMessage(e, lang, ja ? '報告できませんでした。' : 'Could not send report.'))
    } finally {
      reportInFlightRef.current = false
    }
  }, [desk, ja, lang])

  const handleReport = useCallback(() => {
    if (!user) {
      promptLogin(navigation, lang, ja ? '報告するにはログインしてください' : 'Please log in to report content.')
      return
    }
    Alert.alert(
      ja ? 'このデスクを報告' : 'Report this desk',
      ja ? '報告の理由を選んでください' : 'Choose a reason',
      [
        { text: ja ? '不適切な内容' : 'Inappropriate content', onPress: () => void submitReport('inappropriate') },
        { text: ja ? 'スパム・宣伝'   : 'Spam or advertising',   onPress: () => void submitReport('spam') },
        { text: ja ? '権利侵害'       : 'Rights infringement',   onPress: () => void submitReport('infringement') },
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
      ],
    )
  }, [user, ja, lang, submitReport, navigation])

  const handleBlock = useCallback(() => {
    if (!user || !ownerId) {
      promptLogin(navigation, lang, ja ? 'ブロックするにはログインしてください' : 'Please log in to block users.')
      return
    }
    if (blocked) {
      unblockUser(ownerId)
        .then(() => setBlocked(false))
        .catch((e: unknown) => Alert.alert(ja ? 'エラー' : 'Error', localizedErrorMessage(e, lang, ja ? '解除できませんでした。' : 'Could not unblock.')))
      return
    }
    Alert.alert(
      ja ? 'このユーザーをブロック' : 'Block this user',
      ja ? 'ブロックすると、この人が公開したデスクは表示されなくなります。' : 'You will no longer see desks published by this user.',
      [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: ja ? 'ブロック' : 'Block',
          style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(ownerId, formatPublicAuthor(desk?.owner_name, desk?.owner_tag) || null)
              setBlocked(true)
              goBackOrHome()
            } catch (e: any) {
              Alert.alert(ja ? 'エラー' : 'Error', localizedErrorMessage(e, lang, ja ? 'ブロックできませんでした。' : 'Could not block this user.'))
            }
          },
        },
      ],
    )
  }, [user, ownerId, blocked, setBlocked, ja, lang, desk?.owner_name, desk?.owner_tag, goBackOrHome, navigation])

  const openModerationMenu = useCallback(() => {
    Alert.alert(
      ja ? 'このデスクについて' : 'About this desk',
      undefined,
      [
        { text: ja ? '報告する' : 'Report', onPress: handleReport },
        {
          text:  blocked ? (ja ? 'ブロックを解除' : 'Unblock') : (ja ? 'ユーザーをブロック' : 'Block user'),
          style: blocked ? 'default' : 'destructive',
          onPress: handleBlock,
        },
        { text: ja ? '閉じる' : 'Close', style: 'cancel' },
      ],
    )
  }, [ja, blocked, handleReport, handleBlock])

  const followName = publicAuthorParts(ownerName, ownerTag).name

  const tabRef = useRef(tab)
  tabRef.current = tab
  const openHelp = useCallback(() => {
    const current = tabRef.current
    void openCoach([
      ...PUBLIC_DESK_TOP_COACH,
      ...DESK_TABS_COACH,
      ...(current === 'wiring' ? DESK_WIRING_COACH.filter(step => !['history-play', 'map-add', 'map-edit'].includes(step.target ?? '')) : current === 'info' ? INSIGHTS_COACH : DESK_GADGETS_COACH.filter((step) => !['desk-gadget-add', 'desk-gadget-row-edit'].includes(step.target ?? ''))),
      ...PUBLIC_DESK_FOOTER_COACH,
    ])
  }, [openCoach])

  // useEffect だと描画のあとに走るため、ボタンの無いヘッダーが一度描かれてから
  // customView が挿し込まれる。描画前に確定させる
  useLayoutEffect(() => {
    navigation.setOptions({
      // 戻るは標準のヘッダーボタンに任せず自前で描く。
      // 標準ボタンは戻り先が無いと描画されず（共有URLから直接開いた場合）、
      // 押しても反応しないという報告があったため、押せる範囲を広げたうえで
      // goBackOrHome() を必ず通す。
      headerLeft: () => (
        <HeaderIconButton
          name={ICONS.chevronLeft}
          size={25}
          circular
          color={C.text}
          onPress={goBackOrHome}
          accessibilityLabel={t('a11y.back')}
        />
      ),
      headerRight: !loading && !error && desk && plan && (!blocked || isOwnDesk) ? () => (
        <HeaderButtonGroup>
          {!isOwnDesk && <HeaderIconButton
            name="dots-horizontal"
            color={C.text}
            onPress={openModerationMenu}
            buttonRef={coachTarget('desk-report')}
            accessibilityLabel={ja ? 'このデスクについて' : 'About this desk'}
          />}
          <HeaderIconButton name="help-circle-outline" color={C.text} onPress={openHelp} accessibilityLabel={ja ? 'この画面の見方' : 'Understanding this screen'} />
        </HeaderButtonGroup>
      ) : undefined,
    })
  }, [navigation, t, goBackOrHome, C.text, ja, loading, error, desk, plan, blocked, isOwnDesk, openHelp, openModerationMenu, coachTarget])

  useLayoutEffect(() => {
    navigation.setOptions({ title: ja ? 'デスク詳細' : 'Desk details' })
  }, [navigation, ja])

  const handleShare = useCallback(async () => {
    if (!desk || shareInFlightRef.current) return
    shareInFlightRef.current = true
    setSharing(true)
    try {
      await shareDesk(
        { deskId, deskName: displayDeskTitle, totalPrice, deviceCount: selectedQuantity, ownerTag },
        lang,
      )
    } catch {
      // ユーザーがシェアシートをキャンセルした場合も含まれるため、エラー表示はしない
    } finally {
      shareInFlightRef.current = false
      setSharing(false)
    }
  }, [desk, deskId, displayDeskTitle, totalPrice, selectedQuantity, ownerTag, lang])

  const shareUrl = useDeskShareUrl(deskId, desk?.visibility, ownerTag, showShare)
  const handleCopyUrl = useCallback(async () => {
    const copiedUrl = await copyPublicUrl(deskId, ownerTag)
    Alert.alert(ja ? 'コピーしました' : 'Copied', copiedUrl)
  }, [deskId, ownerTag, ja])

  // ─── ローディング ───────────────────────────────────────────────
  if (loading || blockResult === 'pending') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.card }]}>
        <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 7 }}>
          <Skeleton width="62%" height={22} />
          <Skeleton width="40%" height={13} />
        </View>
        {/* DeskPhotoCarousel と同じ 16:9 */}
        <Skeleton width={SCREEN_W} height={SCREEN_W * 9 / 16} radius={0} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12 }}>
          <Skeleton width={32} height={32} radius={16} />
          <Skeleton width="34%" height={14} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} width={64} height={16} />
          ))}
        </View>
      </SafeAreaView>
    )
  }

  // ブロックしたユーザーのデスクは中身を出さない。ブロックは一覧から消えるだけでなく
  // 「その人の投稿が見えなくなる」ことまで満たす必要がある（ブックマーク一覧は
  // BookmarkListScreen 側で除外済み。URL を直接開く経路がここ）
  if (blocked && !isOwnDesk) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bgList }]}>
        <View style={[styles.notFoundIconWrap, { backgroundColor: C.chip }]}>
          <AppIcon name="account-cancel-outline" size={40} color={C.textMuted} centered />
        </View>
        <Text style={[styles.notFoundTitle, { color: C.text }]}>
          {ja ? 'ブロック中のユーザーです' : 'You blocked this user'}
        </Text>
        <Text style={[styles.notFoundSub, { color: C.textMuted }]}>
          {ja ? 'このユーザーが公開したデスクは表示されません' : 'Desks published by this user are hidden.'}
        </Text>
        <TouchableOpacity style={[styles.notFoundBtn, { backgroundColor: C.chip }]} onPress={handleBlock}>
          <Text style={[styles.notFoundBtnText, { color: C.textSub }]}>{ja ? 'ブロックを解除' : 'Unblock'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.notFoundBtn, { backgroundColor: C.chip, marginTop: 10 }]} onPress={goBackOrHome}>
          <Text style={[styles.notFoundBtnText, { color: C.textSub }]}>{ja ? '戻る' : 'Go back'}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  if (error || blockResult === 'failed') {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bgList }]}>
        <View style={[styles.notFoundIconWrap, { backgroundColor: C.chip }]}>
          <AppIcon name="wifi-off" size={40} color={C.textMuted} centered />
        </View>
        <Text style={[styles.notFoundTitle, { color: C.text }]}>{ja ? 'デスクを読み込めませんでした' : 'Could not load this desk'}</Text>
        <Text style={[styles.notFoundSub, { color: C.textMuted }]}>
          {ja ? '通信環境を確認して、もう一度お試しください' : 'Check your connection and try again.'}
        </Text>
        <TouchableOpacity
          style={[styles.notFoundBtn, { backgroundColor: C.accent }]}
          onPress={() => {
            if (error) { void reload(); return }
            setBlockCheck(null)
            setBlockCheckRetry((n) => n + 1)
          }}
        >
          <Text style={[styles.notFoundBtnText, { color: C.onAccent }]}>{ja ? 'もう一度試す' : 'Try again'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.notFoundBtn, { backgroundColor: C.chip, marginTop: 10 }]} onPress={goBackOrHome}>
          <Text style={[styles.notFoundBtnText, { color: C.textSub }]}>{ja ? '戻る' : 'Go back'}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  if (!desk || !plan) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: C.bgList }]}>
        <View style={[styles.notFoundIconWrap, { backgroundColor: C.chip }]}>
          <AppIcon name="desk" size={40} color={C.textMuted} centered />
        </View>
        <Text style={[styles.notFoundTitle, { color: C.text }]}>{ja ? 'デスクが見つかりません' : 'Desk not found'}</Text>
        <Text style={[styles.notFoundSub, { color: C.textMuted }]}>
          {ja ? 'URLが正しいか確認してください' : 'Check that the URL is correct'}
        </Text>
        <TouchableOpacity style={[styles.notFoundBtn, { backgroundColor: C.chip }]} onPress={goBackOrHome}>
          <Text style={[styles.notFoundBtnText, { color: C.textSub }]}>{ja ? '戻る' : 'Go back'}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    )
  }

  // タブバーの「ガジェット」は所有機材の台帳、こちらはこのデスクの構成品で別物。
  // 同じ語を2階層で使うと区別が付かないため、デスクの中では「機材」と呼ぶ
  const TABS: { id: Tab; ja: string; en: string }[] = [
    { id: 'gadgets',  ja: '機材', en: 'Gear' },
    { id: 'wiring',   ja: '配線', en: 'Wiring' },
    // 自分のデスク（WiringResultScreen）と同じ名前にする。中身も履歴と統計で同じ
    { id: 'info',     ja: '履歴・分析', en: 'Insights' },
  ]

  // 収納は「タブバー以下が上へスライドして写真ストリップを覆う」形。ずらすのは
  // CollapsibleTabContent の1枚だけで、ペインは収納量ぶん背を高くしておく（paneExtension）
  const contentPane = {
    flex: 1,
    backgroundColor: C.card,
    ...paneExtension,
  }

  const author = publicAuthorParts(ownerName, ownerTag)

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.container, { backgroundColor: C.card }]}>
    <CoachScope coach={coach}>
      {/* ─── 写真とデスクの概要 ─── */}
      {/* 縦のドラッグは今のタブの一覧へ渡す（headerPan の注記） */}
      <GestureDetector gesture={headerPan}>
      <Pressable
        onPress={handleHeaderDoubleTap}
        style={[styles.summaryCard, { backgroundColor: C.card }, headerContainerStyle]}
      >
        <Reanimated.View
          style={[styles.headerCollapsible, headerParallaxStyle]}
          onLayout={handleCollapsibleLayout}
        >
          <View style={[styles.deskTitleRow, (plan.purposes?.length ?? 0) > PURPOSE_ICONS_INLINE_MAX && styles.deskTitleRowStacked]}>
            <View style={[styles.deskTitleColumn, (plan.purposes?.length ?? 0) > PURPOSE_ICONS_INLINE_MAX && styles.deskTitleColumnStacked]}>
              <Text style={[styles.deskTitle, { color: C.text }]} numberOfLines={2} accessibilityRole="header">
                {displayDeskTitle}
              </Text>
              <Text style={[styles.deskUpdatedAt, { color: C.textMuted }]} numberOfLines={2}>
                {fmtDate(desk.content_updated_at ?? desk.updated_at, lang)}
              </Text>
            </View>
            <DeskPurposeIcons plan={plan} colors={C} lang={lang} isDark={isDark} />
          </View>
          {photos.length > 0 && (
            <View ref={coachTarget('desk-photo')} style={styles.photoCarouselFullBleed}>
              <DeskPhotoCarousel
                photos={photos}
                activeIndex={previewVisibleIdx}
                onIndexChange={setPreviewVisibleIdx}
                onOpen={(index) => {
                  setPreviewVisibleIdx(index)
                  setPreviewIndex(index)
                }}
                lang={lang}
                backgroundColor={C.chip}
              />
            </View>
          )}
          <View style={[styles.publicContextRow, photos.length > 0 && styles.publicContextRowUnderPhoto]}>
            {!!author.name && (
              <TouchableOpacity
                ref={profileOpenable ? coachTarget('desk-author') : undefined}
                style={styles.publicAuthorButton}
                onPress={() => profileOpenable && navigation.isFocused() && navigation.push('PublicProfile', { tag: ownerTag })}
                disabled={!profileOpenable}
                activeOpacity={0.7}
                accessibilityRole={profileOpenable ? 'button' : 'text'}
                accessibilityLabel={profileOpenable
                  ? (ja ? `${author.name} のプロフィールを見る` : `View ${author.name}'s profile`)
                  : author.name}
              >
                <AuthorAvatar name={author.name} tag={author.tag} imageUrl={desk.owner_avatar_url} size={32} />
                <View style={styles.publicAuthorText}>
                  <Text style={[styles.publicAuthorName, { color: C.text }]} numberOfLines={1}>
                    {author.name}
                  </Text>
                  {!!author.tag && (
                    <Text style={[styles.publicAuthorTag, { color: C.textMuted }]} numberOfLines={1}>
                      {author.tag}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
            {canFollow && !!followName ? (
              <View ref={coachTarget('desk-follow')} collapsable={false}>
                <FollowButton following={following} onPress={toggleFollow} colors={C} lang={lang} compact name={followName} />
              </View>
            ) : (
              <View style={[styles.readOnlyChip, { backgroundColor: C.chip }]} accessible accessibilityLabel={ja ? '閲覧専用' : 'Read only'}>
                <AppIcon name="eye-outline" size={13} color={C.textMuted} />
                <Text style={[styles.readOnlyChipText, { color: C.textMuted }]}>{ja ? '閲覧専用' : 'Read only'}</Text>
              </View>
            )}
            {historyGadgets.length > 0 && (
              <View ref={coachTarget('history-play')} collapsable={false}>
                <DeskHistoryEntryCard
                  compact
                  iconOnly
                  plan={plan}
                  gadgets={historyGadgets}
                  colors={C}
                  lang={lang}
                  readOnly
                  ownDesk={viewerOwnsDesk}
                  onRequirePro={() => openPaywall(navigation, 'historyAnimation')}
                  onShare={() => { void handleShare() }}
                />
              </View>
            )}
          </View>
          {!!latestChangeText && (
            <Text style={[styles.latestChange, { color: C.textSub }]} numberOfLines={1}>
              {latestChangeText}
            </Text>
          )}
          {/* share_snapshot の plan.description ではなく列を読む。スナップショットは端末が書いた
              任意の JSON だが、列は長さの CHECK と公開内容のフィルタ（038/083）を通っている */}
          {!!desk.description?.trim() && (
            <DeskDescription text={desk.description.trim()} lang={lang} colors={C} style={styles.deskDescription} />
          )}
        </Reanimated.View>
      </Pressable>
      </GestureDetector>

      {/* ─── タブバー ─── */}
      {/* ここから下がヘッダーの収納量ぶん上へスライドし、写真ストリップを覆って隠す */}
      <Reanimated.View
        ref={coachTarget('desk-tabs') as (node: View | null) => void}
        style={[styles.tabBar, {
          borderTopColor: C.border,
          borderBottomColor: C.border,
          backgroundColor: C.card,
        }, headerShiftStyle]}
        onLayout={(e) => {
          const width = e.nativeEvent.layout.width
          setTabBarWidth((prev) => Math.abs(prev - width) < 0.5 ? prev : width)
        }}
      >
        {TABS.map((tb) => (
          <TouchableOpacity
            key={tb.id}
            style={styles.tab}
            onPress={() => {
              // 同じタブを押し直したときは鳴らさない（何も起きていないので）
              if (tab !== tb.id) hapticSelection()
              setTab(tb.id)
              if (tb.id === 'info') setStatsAnimVersion((v) => v + 1)
            }}
            accessibilityRole="tab"
            accessibilityLabel={lang === 'en' ? tb.en : tb.ja}
            accessibilityState={{ selected: tab === tb.id }}
          >
            <Text style={[styles.tabText, { color: tab === tb.id ? C.text : C.textMuted }]}>
              {lang === 'en' ? tb.en : tb.ja}
            </Text>
          </TouchableOpacity>
        ))}
        <TabUnderline
          count={TAB_IDS.length}
          index={TAB_IDS.indexOf(tab)}
          barWidth={tabBarWidth}
          color={C.accentIcon}
        />
      </Reanimated.View>

      {/* ─── タブコンテンツ ─── */}
      {/* 収納ぶん下へはみ出す領域を切る。切らないと、下端の固定バーの外側 — SafeAreaView が
          空ける下端の余白 — へ一覧の続きが覗く（枠の付け方は CollapsibleTabContent の注記） */}
      <CollapsibleTabContent collapseH={collapseH} shiftStyle={headerShiftStyle} captureTouch={captureTouchDuringFling}>
      {/* ConnectionMap がまだマウントされていない間のローディング（マウント後は下の
          オーバーレイが引き継ぐので、切替時に一瞬の空白が生じない）。 */}
      {tab === 'wiring' && !mapMounted && !mapReady && (
        <View style={[contentPane, { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bgList }]}>
          <ActivityIndicator size="large" color={C.accentIcon} />
          <Text style={{ color: C.accentText, fontSize: 13, fontWeight: '700' }}>
            {ja ? '配線図を作成中…' : 'Building wiring map…'}
          </Text>
        </View>
      )}
      {/* 一度マウントしたら非表示でも保持：タブ切り替えは display の切替だけで即時 */}
      {mapMounted && (
        <View
          style={[contentPane, wiringPaneExtension, { display: tab === 'wiring' ? 'flex' : 'none' }]}
          pointerEvents={tab === 'wiring' ? 'auto' : 'none'}
        >
          <ConnectionMap
            readOnly
            active={tab === 'wiring'}
            onReady={() => setMapReady(true)}
            gadgets={nonCableGadgets}
            connections={plan.connectionMap?.connections ?? EMPTY_MAP_CONNECTIONS}
            plan={plan}
            nodeOffsets={plan.connectionMap?.nodeOffsets}
            nodeSizes={plan.connectionMap?.nodeSizes}
            onOpenGadget={(id) => setDetailGadget(selectedGadgets.find((g) => g.id === id) ?? null)}
            listOrder={mapListOrder}
            onFitPress={hideWiringPhotoForFit}
          />
          {!mapReady && (
            <View
              style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bgList }}
              pointerEvents="none"
            >
              <ActivityIndicator size="large" color={C.accentIcon} />
              <Text style={{ color: C.accentText, fontSize: 13, fontWeight: '700' }}>
                {ja ? '配線図を作成中…' : 'Building wiring map…'}
              </Text>
            </View>
          )}
          {mapReady && photos.length > 0 && (
            <TouchableOpacity
              ref={coachTarget('map-photo')}
              style={[styles.wiringPhotoToggle, { backgroundColor: C.card + 'E6', borderColor: C.border }]}
              // 高さ 36 なので上下に足して 44 にする（図の上に浮いていて外すと図が動く）
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={handleWiringPhotoToggle}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={wiringPhotoExpanded
                ? (ja ? 'デスク写真を隠す' : 'Hide desk photos')
                : (ja ? 'デスク写真を表示' : 'Show desk photos')}
              accessibilityState={{ expanded: wiringPhotoExpanded }}
            >
              <AppIcon name={ICONS.image} size={17} color={C.text} />
              <Text style={[styles.wiringPhotoToggleText, { color: C.text }]}>
                {wiringPhotoExpanded
                  ? (ja ? '写真を隠す' : 'Hide photo')
                  : (ja ? '写真' : 'Photo')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {tab === 'gadgets' && (() => {
        const renderGadgetRow = (g: Gadget, indent = false) => {
          const metaPartsC = [gadgetSubNickname(g), g.purchasedAt].filter(Boolean).join('  ·  ')
          return (
            <TouchableOpacity
              key={g.id}
              ref={coachTarget('desk-gadget-row')}
              style={[styles.gadgetRow, indent && styles.cableItemRow, { borderBottomColor: C.border }]}
              onPress={() => setDetailGadget(g)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={gadgetTitle(g, lang)}
              accessibilityHint={ja ? '機材の詳細を開きます' : 'Opens gadget details'}
            >
              <View style={styles.gadgetInfo}>
                <View style={styles.gadgetNameRow}>
                  <Text style={[styles.gadgetName, { color: C.text }]}>{gadgetTitle(g, lang)}{(g.quantity ?? 1) > 1 ? ` ×${g.quantity}` : ''}</Text>
                  {g.category === 'Cable' && (g.cableCount ?? 1) > 1 && (
                    <Text style={[styles.cableItemCount, { color: C.textMuted }]}>
                      {lang === 'en' ? `${g.cableCount} pcs` : `${g.cableCount}本`}
                    </Text>
                  )}
                  <ArmMountIcon gadget={g} size={13} isDark={isDark} />
                </View>
                <View style={styles.gadgetMetaRow}>
                  <Text style={[styles.gadgetCat, { color: C.textMuted, flex: 1 }]} numberOfLines={1}>
                    {metaPartsC}
                  </Text>
                  <Text style={[styles.gadgetPrice, { color: C.textMuted }]}>
                    {validGadgetPrice(g) != null ? fmtPrice((g.price ?? 0) * (g.quantity ?? 1)) : (lang === 'en' ? '$—' : '¥—')}
                  </Text>
                </View>
              </View>
              <View style={styles.gadgetRowAction}>
                <Text style={[styles.gadgetRowActionText, { color: C.textMuted }]}>{ja ? '詳細' : 'Details'}</Text>
                <AppIcon name={ICONS.chevronRight} size={18} color={C.textMuted} />
              </View>
            </TouchableOpacity>
          )
        }

        const toggleCableType = (type: CableType | '__unknown') => setExpandedCableTypes((prev) => {
          const next = new Set(prev)
          next.has(type) ? next.delete(type) : next.add(type)
          return next
        })

        // ケーブル節：ジャンル「ケーブル」→ ケーブルの種類 → 個別ケーブル（詳細へ）の3段
        const renderCableSection = () => (
          <DeskCableSection
            groups={cableTypeGroups}
            totalCount={cableTotalCount}
            expandedTypes={expandedCableTypes}
            onToggleType={toggleCableType}
            renderRow={(g) => renderGadgetRow(g, true)}
            collapsed={cablesCollapsed}
            onToggleCollapsed={() => setCablesCollapsed((value) => !value)}
            colors={C}
            lang={lang}
            isDark={isDark}
            t={t}
          />
        )

        return (
          <Reanimated.ScrollView
            ref={gadgetScrollRef}
            style={contentPane}
            // 収納用のスクロール距離は末尾に確保し、中身側の移動で相殺する。
            contentContainerStyle={[styles.tabContent, { paddingTop: 0, paddingBottom: 24 + listBottomInset + GADGET_LIST_FLOATING_INSET, minHeight: listContentMinHeight }]}
            onScroll={handleGadgetScroll}
            onLayout={onGadgetLayout}
            onContentSizeChange={onGadgetContentSize}
            scrollEventThrottle={16}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.textMuted} colors={[C.textMuted]} progressBackgroundColor={C.card} />}
          >
            <Reanimated.View style={listContentStyle}>
            <ExploreGuideCard
              id="explore-desk-tabs"
              eligible={!loading && !error && !refreshing && !isOwnDesk && !blocked && desk.visibility === 'public' && selectedGadgets.length > 0}
              blocked={helpOpen || showShare || sharing || previewIndex !== null || detailGadget !== null || gadgetSortExpanded}
              getViewport={getGuideViewport}
              getBottomBoundary={getGuideBottom}
              onHelp={openHelp}
            />
            {orderDeskGadgets(sortedGadgets, statsConnections).map(({ gadget: g, mounted }) => {
                  const metaParts = [gadgetSubNickname(g), g.purchasedAt].filter(Boolean).join('  ·  ')
                  return (
                    <TouchableOpacity key={g.id} ref={coachTarget('desk-gadget-row')} style={[styles.gadgetRow, mounted && styles.cableItemRow, { borderBottomColor: C.border }]} onPress={() => setDetailGadget(g)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`${gadgetTitle(g, lang)}${recommendedIds.has(g.id) ? (ja ? '、このデスクのおすすめ' : ', recommended for this desk') : ''}${g.displayOnly ? (ja ? '、飾り' : ', decor') : ''}${mounted ? (ja ? '、上の機材に取り付け' : ', attached to the item above') : ''}`} accessibilityHint={ja ? '機材の詳細を開きます' : 'Opens gadget details'}>
                      <View style={[styles.gadgetCatIcon, { backgroundColor: C.chip }]}>
                        <CategoryIcon category={g.category} pcFormFactor={g.pcFormFactor} customIcon={g.customCategory?.icon} size={16} color={categoryIconColor(g.category, isDark, undefined, g.customCategory?.color)} />
                      </View>
                      <View style={styles.gadgetInfo}>
                        <View style={styles.gadgetNameRow}>
                          <Text style={[styles.gadgetName, { color: C.text }]}>{gadgetTitle(g, lang)}{(g.quantity ?? 1) > 1 ? ` ×${g.quantity}` : ''}</Text>
                          {g.displayOnly && (
                            <View style={[styles.decorBadge, { backgroundColor: DECOR_COLOR + '22', borderColor: DECOR_COLOR }]}>
                              <Text style={[styles.decorBadgeText, { color: C.text }]}>{ja ? '飾り' : 'Decor'}</Text>
                            </View>
                          )}
                          <ArmMountIcon gadget={g} size={13} isDark={isDark} />
                        </View>
                        {recommendedIds.has(g.id) && <RecommendedGadgetMark color={C.accentText} lang={lang} />}
                        <View style={styles.gadgetMetaRow}>
                          {!!metaParts && (
                            <Text style={[styles.gadgetCat, { color: C.textMuted, flex: 1 }]} numberOfLines={1}>
                              {metaParts}
                            </Text>
                          )}
                          <Text style={[styles.gadgetPrice, { color: C.textMuted, marginLeft: 'auto' }]}>
                            {validGadgetPrice(g) != null ? fmtPrice((g.price ?? 0) * (g.quantity ?? 1)) : (lang === 'en' ? '$—' : '¥—')}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.gadgetRowAction}>
                        <Text style={[styles.gadgetRowActionText, { color: C.textMuted }]}>{ja ? '詳細' : 'Details'}</Text>
                        <AppIcon name={ICONS.chevronRight} size={18} color={C.textMuted} />
                      </View>
                    </TouchableOpacity>
                  )
                })}
            {sortedCableGadgets.length > 0 && renderCableSection()}
            <View style={[styles.gadgetTotalRow, { borderTopColor: C.border }]}>
              <Text style={[styles.gadgetTotalLabel, { color: C.textMuted }]}>{t('wiringResult.total')}</Text>
              {/* 金額が主役、台数は付随する数として落とす。価格が1つも無いのに ¥0 と出すと
                  無料の機材に読めるので、行の金額と同じく — にする */}
              <Text style={[styles.gadgetTotalCount, { color: C.text }]}>
                {selectedGadgets.some((g) => validGadgetPrice(g) != null) ? fmtPrice(totalPrice) : (lang === 'en' ? '$—' : '¥—')}
                <Text style={[styles.gadgetTotalQty, { color: C.textMuted }]}>
                  {'  '}{t('wiringResult.itemCount').replace('{{n}}', String(selectedQuantity))}
                </Text>
              </Text>
            </View>
            {/* 機材を一通り見た人の次の一手として、一覧の末尾に置く。下の固定バーには足さない
                （常時の高さで写真と一覧を狭める。以前の「この用途で作る」を外した理由と同じ） */}
            {!isOwnDesk && nonCableGadgets.length > 0 && (
              <TouchableOpacity
                ref={coachTarget('desk-copy')}
                style={[styles.copyDeskRow, { backgroundColor: C.card, borderColor: C.border }]}
                onPress={startDeskCopy}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={ja ? 'このデスクを参考に自分のデスクを作る' : 'Create your own desk based on this one'}
              >
                <AppIcon name={ICONS.copy} size={20} color={C.accentText} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.copyDeskTitle, { color: C.accentText }]}>
                    {ja ? 'このデスクを参考に作る' : 'Use this desk as a starting point'}
                  </Text>
                  <Text style={[styles.copyDeskSub, { color: C.textMuted }]}>
                    {ja ? 'ジャンルの組み合わせを写して、自分の機材で作ります' : 'Copies the categories, then you add your own gear'}
                  </Text>
                </View>
                <AppIcon name={ICONS.chevronRight} size={18} color={C.textMuted} />
              </TouchableOpacity>
            )}
            <View style={styles.similarDesksGutter}>
              <SimilarPublicDesks
                deskId={deskId}
                ownerId={ownerId}
                gadgets={nonCableGadgets}
                purposes={plan.purposes}
                colors={C}
                lang={lang}
                isDark={isDark}
                fmtPrice={fmtPrice}
                onOpenDesk={openSimilarDesk}
              />
            </View>
            </Reanimated.View>
          </Reanimated.ScrollView>
        )
      })()}

      <GadgetSortSheet
        visible={gadgetSortExpanded}
        value={gadgetSort}
        onSelect={setGadgetSort}
        onClose={() => setGadgetSortExpanded(false)}
        colors={C}
        lang={lang}
        t={t}
      />

      {tab === 'info' && !infoMounted && (
        <View style={[contentPane, { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bgList }]}>
          <ActivityIndicator size="large" color={C.accentIcon} />
          <Text style={{ color: C.accentText, fontSize: 13, fontWeight: '700' }}>
            {ja ? '集計中…' : 'Building insights…'}
          </Text>
        </View>
      )}
      {/* 情報：履歴と統計を集約。一度マウントしたら display 切替だけで保持する */}
      {infoMounted && (
        <View style={[contentPane, { display: tab === 'info' ? 'flex' : 'none' }]} onLayout={onInfoLayout}>
          <GadgetStatsPanel
            sourceGadgets={selectedGadgets}
            connections={statsConnections}
            deskStartedAt={deskStartedAt}
            triggerKey={statsAnimVersion}
            colors={C}
            t={t}
            lang={lang}
            fmtPrice={fmtPrice}
            displayAmount={displayAmount}
            showTotalCard={false}
            scrollRef={infoScrollRef}
            contentBottomInset={listBottomInset}
            contentMinHeight={listContentMinHeight}
            contentShiftStyle={listContentStyle}
            onScroll={handleInfoScroll}
            onContentSizeChange={onInfoContentSize}
            scrollEventThrottle={16}
          />
        </View>
      )}
      </CollapsibleTabContent>

      {/* 拍手・保存・共有は概要カードの中に置くと、スクロールで隠れて押せなくなる。
          写真を見ている最中こそ押したくなるので、下に固定して常に出しておく。
          「この用途で自分のデスクを作る」はここに置いていたが、他人のデスクを見て
          そのまま作り始める人が少なく、常時2段ぶんの高さを取って写真と一覧を
          狭めるほうの損が大きいので外した */}
      {/* ダークでは影が黒に溶け、一覧の行と同じ色のバーの縁が消えるので、境界線で囲う */}
      <View ref={guideBottomRef} collapsable={false} style={[styles.createBar, { backgroundColor: C.card }, styles.barOutline, { borderColor: C.separator }]}>
        {tab === 'gadgets' && (
          <GadgetListFloatingControls
            sortLabel={t(GADGET_SORT_OPTIONS.find((o) => o.key === gadgetSort)?.labelKey ?? 'wiringResult.sortCreatedAt')}
            sortExpanded={gadgetSortExpanded}
            onSort={() => setGadgetSortExpanded(true)}
            sortRef={coachTarget('desk-gadget-sort')}
          />
        )}
        <View style={styles.bottomActions}>
          {/* URL限定（083）のデスクは見るだけ。拍手・保存はサーバー側が公開中のデスクにしか
              通さず、保存一覧も RLS 越しに読むので URL限定を並べられない。押せる形で出すと
              押すたびに失敗する */}
          {(isOwnDesk || desk?.visibility !== 'unlisted') && (
          <TouchableOpacity
            ref={coachTarget(isOwnDesk ? 'desk-clap-own' : 'desk-clap')}
            style={styles.bottomLikeAction}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            onPress={() => {
              if (isOwnDesk) return
              void handleToggleLike()
            }}
            disabled={isOwnDesk}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: liked }}
            accessibilityLabel={isOwnDesk
              ? (ja ? `拍手 ${likeCount}件` : `${likeCount} applause`)
              : liked
              ? (ja ? '拍手を取り消す' : 'Remove applause')
              : clappedBefore
              ? (ja ? 'デスクが更新されました。もう一度拍手する' : 'This desk was updated. Applaud again')
              : (ja ? '拍手する' : 'Applaud this desk')}
          >
            <ClapBurst clapped={liked} burstKey={clapBurstKey} size={34}>
              <ClapMark clapped={liked} diameter={34} color={C.textMuted} />
            </ClapBurst>
            <View style={styles.bottomLikeLabel}>
              <Text style={[styles.bottomActionText, styles.bottomLikeText, { color: C.textSub }]} numberOfLines={1}>
                {isOwnDesk
                  ? (ja ? '拍手' : 'Applause')
                  : !liked && clappedBefore
                  ? (ja ? 'もう一度拍手' : 'Applaud again')
                  : (ja ? '拍手' : 'Applaud')}
              </Text>
              {likeCount > 0 && (
                <RollingCount value={likeCount} style={[styles.bottomActionText, styles.bottomLikeCount, { color: C.textSub }]} />
              )}
            </View>
          </TouchableOpacity>
          )}

          {/* 保存・AI・共有は拍手と同じ灰色にする。黒（text）にしていた頃は、常に出ている下のタブより
              この画面の道具のほうが濃く見えて優先度が逆だった。反応と道具は左右の位置で分かれている */}
          <View style={styles.bottomActionGroup}>
          {!isOwnDesk && desk?.visibility !== 'unlisted' && (
            <TouchableOpacity
              ref={coachTarget('desk-save')}
              style={styles.bottomAction}
              hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
              onPress={() => void handleToggleBookmark()}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={bookmarked
                ? (ja ? '保存を解除' : 'Remove from saved')
                : (ja ? 'このデスクを保存' : 'Save this desk')}
            >
              <TogglePop popKey={savePopKey}>
                <AppIcon name={bookmarked ? 'bookmark' : 'bookmark-outline'} size={24} color={bookmarked ? C.saved : C.textMuted} />
              </TogglePop>
              <Text style={[styles.bottomActionText, { color: C.textSub }]} numberOfLines={1}>
                {ja ? '保存' : 'Save'}
              </Text>
            </TouchableOpacity>
          )}

          {/* AIコーチへ。このデスクを添付した状態で開く（送信は向こうで押す）。
              バーは1段のまま保つ：ここに幅いっぱいのボタンを足すと、かつて外した
              「この用途で自分のデスクを作る」と同じく写真と一覧を常時圧迫する */}
          <TouchableOpacity
            ref={coachTarget('desk-ai')}
            style={styles.bottomAction}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            onPress={() => navigation.navigate('AICoachChat', { publicDeskId: deskId })}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={ja ? 'このデスクについてAIに聞く' : 'Ask AI about this desk'}
          >
            <AppIcon name={ICONS.robot} size={24} color={C.textMuted} />
            <Text style={[styles.bottomActionText, { color: C.textSub }]} numberOfLines={1}>
              AI
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            ref={coachTarget('desk-share')}
            style={styles.bottomAction}
            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
            onPress={() => setShowShare(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.shareDesk')}
          >
            <AppIcon name={ICONS.share} size={24} color={C.textMuted} />
            <Text style={[styles.bottomActionText, { color: C.textSub }]} numberOfLines={1}>
              {ja ? '共有' : 'Share'}
            </Text>
          </TouchableOpacity>
          </View>
        </View>
      </View>

      {coach.overlay}
      <SharedGadgetDetailModal
        gadget={detailGadget}
        recommended={!!detailGadget && recommendedIds.has(detailGadget.id)}
        gadgets={selectedGadgets}
        colors={C}
        lang={lang}
        isDark={isDark}
        fmtPrice={fmtPrice}
        deskId={deskId}
        userId={user?.id}
        isOwnDesk={isOwnDesk}
        onRequireLogin={() => promptLogin(
          navigation,
          lang,
          ja ? '欲しいものに入れるにはログインしてください' : 'Please log in to save gadgets to your wishlist.',
          // シート（RN の Modal）を開いたままだと、ログイン画面がその裏に積まれて見えない
          (mode) => { setDetailGadget(null); openLoginScreen(navigation, mode) },
        )}
        onClose={() => setDetailGadget(null)}
        onOpenBrand={(key, label) => {
          setDetailGadget(null)
          navigation.navigate('BrandProducts', { brandKey: key, brandLabel: label })
        }}
        onOpenDesk={(nextDeskId) => {
          // シートを閉じてから移る。開いたまま push すると、公開デスクがシートの裏に積まれて見えない
          if (!navigation.isFocused()) return
          setDetailGadget(null)
          openAnotherPublicDesk(nextDeskId)
        }}
      />

      {/* ─── 画像プレビューカルーセル ─── */}
      <DeskPhotoPreviewModal
        items={photos.map((uri, index) => ({ key: `${uri}-${index}`, uri }))}
        openIndex={previewIndex}
        visibleIndex={previewVisibleIdx}
        onVisibleIndex={setPreviewVisibleIdx}
        onClose={() => setPreviewIndex(null)}
        lang={lang}
      />

      {/* ─── Share モーダル ─── */}
      <BottomSheetModal visible={showShare} onDismiss={() => setShowShare(false)} sheetStyle={styles.shareSheet}>
            <Text style={[styles.sheetTitle, { color: C.text }]}>{ja ? 'デスクを共有' : 'Share Desk'}</Text>

            <View style={[styles.urlRow, { backgroundColor: C.bgList }]}>
              <AppIcon name={ICONS.link} size={14} color={C.textMuted} />
              <Text style={[styles.urlText, { color: C.textSub }]} numberOfLines={1}>{shareUrl}</Text>
            </View>

            <View style={styles.sheetActions}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: C.accent, opacity: sharing ? 0.55 : 1 }]}
                onPress={handleShare}
                disabled={sharing}
                accessibilityRole="button"
                accessibilityLabel={ja ? 'SNSで共有' : 'Share'}
              >
                {sharing ? (
                  <ActivityIndicator color={C.onAccent} size="small" />
                ) : (
                  <>
                    <AppIcon name={ICONS.share} size={18} color={C.onAccent} />
                    <Text style={[styles.actionBtnText, { color: C.onAccent }]}>{ja ? 'SNSで共有' : 'Share'}</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: C.chip }]}
                onPress={handleCopyUrl}
                accessibilityRole="button"
                accessibilityLabel={ja ? 'URLをコピー' : 'Copy URL'}
              >
                <AppIcon name={ICONS.copy} size={18} color={C.text} />
                <Text style={[styles.actionBtnText, { color: C.text }]}>{ja ? 'URLをコピー' : 'Copy URL'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => setShowShare(false)} style={styles.sheetCancel} accessibilityRole="button">
              <Text style={[styles.sheetCancelText, { color: C.textMuted }]}>{ja ? 'キャンセル' : 'Cancel'}</Text>
            </TouchableOpacity>
      </BottomSheetModal>
    </CoachScope>
    </SafeAreaView>
  )
}

// デスク本体は WiringResultScreen と揃え、公開ページ固有の投稿者情報と操作だけを追加する。
const styles = StyleSheet.create({
  // タブバー以下は収納量ぶん背を高くして上へずらすため、下端のはみ出しをここで切る
  container: { flex: 1, overflow: 'hidden' },

  // 歴史の再生カード。自分のデスク（WiringResultScreen）の閲覧専用と同じく、左下のズームバーと
  // 同じ下端の行に置く（他人のデスクには接続追加の FAB が無い）
  wiringPhotoToggle: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 30,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: UI_METRICS.controlRadius,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  wiringPhotoToggleText: { fontSize: 12, fontWeight: '700' },

  // いいね・保存・AI・共有の固定バー。影は使わず、上辺の境界線でコンテンツと分ける。
  // 重ねると配線図やスクロール末尾を隠すので、絶対配置ではなく最下段の行として場所を取る
  createBar: {
    borderTopLeftRadius: UI_METRICS.sheetRadius,
    borderTopRightRadius: UI_METRICS.sheetRadius,
    zIndex: 40,
  },
  barOutline: { borderWidth: 1, borderBottomWidth: 0 },
  bottomActions: {
    minHeight: 68,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bottomLikeAction: {
    minWidth: 0,
    minHeight: 56,
    paddingHorizontal: 8,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  bottomActionGroup: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bottomAction: {
    width: 58,
    minHeight: 56,
    paddingHorizontal: 2,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  bottomActionText: { fontSize: 12, fontWeight: '700' },
  // 件数は別の部品で送るので、ラベルと横に並べる。縮むのはラベル側だけ（件数が欠けると意味が変わる）
  bottomLikeLabel: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  bottomLikeText: { flexShrink: 1 },
  bottomLikeCount: { fontVariant: ['tabular-nums'] },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },

  // ヘッダーの共有ボタン。iOS 26 はバーボタンの frame に丸い背景を自前で描くので、
  // padding/margin で中身だけを寄せると円の中心とアイコンがずれる。位置は箱で決める

  // 空状態のディスクは円。PaywallScreen の iconWrap（80）と
  // DeskHistoryAnimationModal の emptyIcon（64）が先にこの形をしている
  notFoundIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  notFoundTitle:    { fontSize: 18, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  notFoundSub:      { fontSize: 13, textAlign: 'center', lineHeight: 18, marginBottom: 24 },
  notFoundBtn:      { borderRadius: UI_METRICS.controlRadius, paddingHorizontal: 24, paddingVertical: 10 },
  notFoundBtnText:  { fontSize: 14, fontWeight: '600' },

  // ヘッダー
  summaryCard: {
    paddingHorizontal: 16,
  },
  publicContextRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  publicContextRowUnderPhoto: { marginTop: 10 },
  publicAuthorButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // 名前と @ID は1組の表示なので間を空けない（行の高さの余白だけで足りる）
  publicAuthorText: { flex: 1, minWidth: 0 },
  publicAuthorName: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  publicAuthorTag: { fontSize: 11, lineHeight: 15, fontWeight: '500' },
  readOnlyChip: {
    minHeight: 28,
    paddingHorizontal: 8,
    borderRadius: UI_METRICS.cardRadius,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  readOnlyChipText: { fontSize: 11, fontWeight: '600' },
  headerCollapsible: { paddingTop: 10, paddingBottom: 12 },
  // 画面見出し（design.md の 20–22）。ヘッダーの表題（17）より目立たせ、写真の前に何のデスクかを読ませる
  deskTitleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8, zIndex: 5, overflow: 'visible' },
  deskTitleColumn: { flex: 1, minWidth: 0 },
  // 用途が多いときは名前に1行を丸ごと渡し、用途のアイコンを下の段へ折り返す
  deskTitleRowStacked: { flexWrap: 'wrap' },
  deskTitleColumnStacked: { flexBasis: '100%' },
  deskTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  deskUpdatedAt: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '500', textAlign: 'left' },
  deskDescription: { marginTop: 8 },
  latestChange: { marginTop: 6, fontSize: 13 },
  // 画面の横余白を打ち消して全幅で敷く。数値を書くと screenGutter を
  // 変えたときにここだけ取り残される
  photoCarouselFullBleed: { marginHorizontal: -UI_METRICS.screenGutter, marginTop: 10 },

  // タブ
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: 1 },
  // 収納で下へはみ出すぶんの切り取り枠。中身は flex:1 のまま重ならずに並ぶ
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  tabText: { fontSize: 12 },
  // 機材タブの一覧は左右いっぱいに敷く。外枠に余白を取ると、行の中の余白と二重になり
  // 一覧の両脇に地の色の帯が残っていた。文字の位置は各行・見出しの内側の screenGutter でそろえる
  tabContent: { paddingTop: UI_METRICS.screenGutter, paddingBottom: 24 },

  // ─── ガジェット一覧タブ ──────────────────────────────────────
  gadgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: UI_METRICS.screenGutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  gadgetCatIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  gadgetInfo: { flex: 1, minWidth: 0 },
  gadgetNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gadgetName: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  gadgetMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 5 },
  gadgetCat: { fontSize: 11 },
  // マイデスク（WiringResultScreen）の同名スタイルと揃える
  decorBadge: { borderRadius: UI_METRICS.chipRadius, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  decorBadgeText: { fontSize: 10, fontWeight: '700' },
  gadgetPrice: { fontSize: 11, flexShrink: 0, fontWeight: '500' },
  gadgetRowAction: { flexDirection: 'row', alignItems: 'center', gap: 1, flexShrink: 0 },
  gadgetRowActionText: { fontSize: 11, fontWeight: '600' },
  cableItemRow: { paddingLeft: UI_METRICS.screenGutter + 20 },
  cableItemCount: { fontSize: 11, fontWeight: '600', flexShrink: 0 },


  gadgetTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  gadgetTotalLabel: { fontSize: 12 },
  similarDesksGutter: { paddingHorizontal: UI_METRICS.screenGutter },
  copyDeskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    marginHorizontal: UI_METRICS.screenGutter,
    minHeight: UI_METRICS.rowMinHeight,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: UI_METRICS.cardRadius,
  },
  copyDeskTitle: { fontSize: 15, fontWeight: '600' },
  copyDeskSub: { fontSize: 12, marginTop: 2 },
  gadgetTotalCount: { fontSize: 14, fontWeight: '700' },
  gadgetTotalQty: { fontSize: 12, fontWeight: '500' },


  // Share モーダル
  shareSheet:   { gap: 12 },
  sheetTitle:   { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  urlRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: UI_METRICS.chipRadius, padding: 10 },
  urlText: { flex: 1, fontSize: 12 },
  sheetActions: { flexDirection: 'row', gap: 10 },
  actionBtn:     { minHeight: UI_METRICS.touchMinSize, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: UI_METRICS.controlRadius },
  actionBtnText: { fontWeight: '700', fontSize: 14 },
  sheetCancel:     { minHeight: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center' },
  sheetCancelText: { fontSize: 14 },
})
