import { Alert } from '../utils/alert'
import { useFocusEffect } from '@react-navigation/native'
import { useHeaderHeight } from '@react-navigation/elements'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../hooks/useToday'
import {
  ActivityIndicator,
  Dimensions,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { Gesture, GestureDetector, Swipeable } from 'react-native-gesture-handler'
import { SwipeableRow } from '../components/molecules/SwipeableRow'
import { SWIPEABLE_ROW_PROPS } from '../utils/swipeableRow'
import { ownShareTag } from '../utils/publicAuthor'
import { hapticError, hapticMedium, hapticSelection, hapticSuccess, hapticWarning } from '../utils/haptics'
import Reanimated from 'react-native-reanimated'
import { PRESS_INTERACTION } from '../constants/ui'
import { CollapsibleTabContent } from '../components/molecules/CollapsibleTabContent'
import { DeskPurposeIcons, PURPOSE_ICONS_INLINE_MAX } from '../components/molecules/DeskPurposeIcons'
import { useCollapsibleHeader } from '../hooks/useCollapsibleHeader'
import { useKeyboardReveal } from '../hooks/useKeyboardReveal'
import { confirmDiscardChanges } from '../hooks/useConfirmDiscard'
import { AppIcon } from '../components/atoms/AppIcon'
import { IconCircleButton } from '../components/atoms/IconCircleButton'
import { HeaderButtonGroup, HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { COACH_SCREEN, CoachScope, useCoachMarks } from '../hooks/useCoachMarks'
import { DESK_GADGETS_COACH, DESK_OWNER_FOOTER_COACH, DESK_OWNER_TOP_COACH, DESK_PHOTO_COACH, DESK_TABS_COACH, DESK_WIRING_COACH } from '../constants/deskCoachSteps'
import { LocalThumb } from '../components/atoms/LocalThumb'
import { CategoryIcon } from '../components/atoms/CategoryIcon'
import { ArmMountIcon } from '../components/atoms/ArmMountIcon'
import { FavoriteGadgetMark } from '../components/atoms/FavoriteGadgetMark'
import { RecommendedGadgetMark } from '../components/atoms/RecommendedGadgetMark'
import { FavoriteSwipeRow } from '../components/molecules/FavoriteSwipeRow'
import { favoriteGadgetIdSet, toggleFavoriteGadget } from '../utils/favoriteGadgets'
import { DeskPhotoPreviewModal } from '../components/organisms/DeskPhotoPreviewModal'
import { DeskPurposeEditSheet } from '../components/organisms/DeskPurposeEditSheet'
import { UndoSnackbar } from '../components/molecules/UndoSnackbar'
import { RetryState } from '../components/molecules/RetryState'
import { ScrollProgressBar } from '../components/molecules/ScrollProgressBar'
import { ConnectionMap, type MapGadgetActions } from '../components/organisms/ConnectionMap'
import { DeskHistoryEntryCard } from '../components/organisms/DeskHistoryEntryCard'
import { GadgetDetailSheet } from '../components/organisms/GadgetDetailSheet'
import { GadgetReplacementModal } from '../components/organisms/GadgetReplacementModal'
import { GADGET_SORT_OPTIONS, GadgetSortKey, GadgetSortSheet } from '../components/organisms/GadgetSortSheet'
import { DeskCableSection } from '../components/organisms/DeskGadgetSections'
import { useDeskGadgetSections } from '../hooks/useDeskGadgetSections'
import { ReorderableGadgetList } from '../components/organisms/ReorderableGadgetList'
import { RemovalLayout, RemovalMotion, useRemovalMotion } from '../components/molecules/RemovalMotion'
import { AdditionMotion } from '../components/molecules/AdditionMotion'
import { mergeGadgetOrder } from '../utils/gadgetOrder'
import { gadgetCategoryKey } from '../utils/customCategory'
import { GadgetStatsPanel, INSIGHTS_COACH } from '../components/organisms/GadgetStatsPanel'
import { PublicNameGateModal } from '../components/organisms/PublicNameGateModal'
import { PublishModal, PublishState } from '../components/organisms/PublishModal'
import { CATEGORY_COLORS, categoryIconColor, DECOR_COLOR, ICONS, MCIconName } from '../constants/icons'
import { SWIPE_OPEN_THRESHOLD, UI_STATUS_COLORS, UI_STATUS_ON_WARNING } from '../constants/ui'
import { Toast } from '../components/molecules/Toast'
import { cableLabel, cableSortRank, PORT_ICONS, portIconColor } from '../constants/portTypes'
import { inputMaxLength, tidyMultilineText, trimAndTruncate, trimInvisible, truncateChars } from '../utils/truncateText'
import { applyDeskGadgetUsage, updateDeskGadgetSelection } from '../utils/deskGadgetUsage'
import { replaceDeskGadget } from '../utils/deskGadgetReplacement'
import { localDateKey } from '../utils/deskTimeline'
import { gadgetSubNickname, gadgetTitle } from '../utils/localizedGadgetName'
import { orderDeskGadgets } from '../utils/gadgetAttachments'
import { markPlanOpened } from '../utils/mapWarmup'
import { TabUnderline } from '../components/atoms/TabUnderline'
import { TextField } from '../components/atoms/TextField'
import { notOwnedBadge, sumDeviceQuantities, sumGadgetPrices, validGadgetPrice } from '../utils/gadgetStats'
import { CableType, ConnectionMap as ConnectionMapData, DeskPlan, Gadget, MapConnection, NodeOffset, PlanPurpose, WiringSuggestion } from '../types'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useSubscription } from '../context/SubscriptionContext'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { usePublicNameGate } from '../hooks/usePublicNameGate'
import { showPhotoPermissionAlert } from '../utils/confirmation'
import { ProfileEditSheet } from '../components/organisms/ProfileEditSheet'
import { useUndoSnackbar } from '../hooks/useUndoSnackbar'
import { PLAN_LIMITS } from '../constants/plans'
import { analytics, EVENTS, trackLimitHit, trackOnce } from '../services/analytics'
import { publishPlan, getPlanPublishState, getPublishedDeskId, getPublishedVisibility, isOutdatedPublishState, isPhotoRevocationIncomplete, recoverPendingPublications, PlanPublishState, publishStateOf, PublishVisibility, setPlanVisibility, unpublishPlan } from '../services/publishService'
import { shareDesk } from '../services/shareService'
import { PlanStackParamList } from '../types'
import { isPersonalizedResult } from '../utils/activation'
import { deletePlanPhoto, pickPlanPhotos, planPhotoSkipMessage } from '../utils/planImages'
import { isPlanReflecting, subscribePlanReflection } from '../utils/planReflection'
import { promptLogin } from '../utils/promptLogin'
import { promptGadgetRequired, promptPhotoRequired } from '../utils/promptPhotoRequired'
import { publishGadgetIssue, PublishGadgetIssue } from '../utils/publishRequirements'
import { PUBLISH_TIMEOUT_MS, QUICK_TIMEOUT_MS, userErrorMessage, withTimeout } from '../utils/networkError'
import { cabledConnectionGroups, countRequiredCables } from '../utils/wiringEngine'
import { baseMapNodeId, mapPairKey, reconcileMap } from '../utils/connectionMapLayout'
import { applyMapLayoutChange, captureMapLayoutChange, type MapLayoutChange } from '../utils/mapLayoutUndo'
import type { MapLayoutRestoreRequest } from '../components/organisms/ConnectionMap'
import { connectionsOnDesk, refreshPlanWiring, resetPlanLayout, saveFreshWiring } from '../utils/planWiring'
import { evictPlanLayoutCache, restorePlanLayoutCache } from '../utils/mapLayoutCache'
import { PURPOSE_DEFS, purposeIcon, purposeIconColor, purposeLabel } from './PurposeSelectionScreen'
import { formatDate, formatStoredDate, parseDateInput } from '../utils/dateFormat'
import { loadWiringNoticeSeen, markWiringNoticeSeen } from '../utils/wiringNoticeSeen'
import { hasSeenDeskCompletionPrompt, markDeskCompletionPromptSeen } from '../utils/deskCompletionPrompt'
import { dismissWiringSuggestions, loadDismissedSuggestions, suggestionKey } from '../utils/wiringSuggestionDismissal'
import { clearFirstSetupDraft, loadFirstSetupDraft } from '../store/firstSetupStore'
import { UI_METRICS } from '../constants/ui'
import { DeskPhotoCarousel } from '../components/molecules/DeskPhotoCarousel'
import { DESK_DESCRIPTION_INPUT_PADDING, DESK_DESCRIPTION_TEXT, DeskDescription } from '../components/molecules/DeskDescription'
import { multilineInputText } from '../utils/multilineInputText'
import { GADGET_LIST_FLOATING_INSET, GadgetListFloatingControls } from '../components/molecules/GadgetListFloatingControls'
import { DESK_DESCRIPTION_MAX_LENGTH, PURPOSE_NAME_MAX_LENGTH } from '../constants/textLimits'
import { useSwipePeekHint } from '../hooks/useSwipePeekHint'
import { getMyDeskReactions } from '../services/deskReactions'
import { DeskReaction, reactionSummary } from '../utils/deskReactions'
import { getPublicNickname } from '../utils/publicNickname'
import { openPaywall } from '../navigation/rootNavigation'
import { ArmAssignmentSnapshot, detachArmAssignments, restoreArmAssignments } from '../utils/monitorArmAssignments'
import { replacementRelationTransfer } from '../utils/deskGadgetRelations'
import { SPOTLIGHT_STEPS } from '../constants/spotlightSteps'
import { useSpotlight, useSpotlightTarget } from '../context/SpotlightContext'


type Props = NativeStackScreenProps<PlanStackParamList, 'WiringResult'>
type Tab = 'gadgets' | 'wiring' | 'info'
const TAB_IDS: Tab[] = ['gadgets', 'wiring', 'info']
const EMPTY_MAP_CONNECTIONS: MapConnection[] = []
// 参照が毎回変わると、提案リンクを引く useEffect が回り続ける
const EMPTY_SUGGESTIONS: WiringSuggestion[] = []
// 配線図の下端には48ptの操作HUDがある。通知は8pt空けてその上へ出す。
const WIRING_HUD_CLEARANCE = 48 + 8

function fmtDate(iso: string, lang: 'ja' | 'en'): string {
  return formatDate(new Date(iso), lang)
}

// 配線図の1手戻し用スナップショット。connectionMap のうち編集で動く分だけを持つ
type MapUndoSnapshot = Pick<ConnectionMapData, 'connections' | 'dismissedPairs'>

const { width: SCREEN_W } = Dimensions.get('window')
// 写真アプリと同じく、写真と写真のあいだに隙間を置く。隣の写真が地続きに見えると
// 「1枚の横長画像をスクロールしている」ように見えて、めくった実感が出ない
export function WiringResultScreen({ route, navigation }: Props) {
  const headerHeight = useHeaderHeight()
  const { planId } = route.params
  const { gadgets, loading: gadgetsLoading, loadError: gadgetsLoadError, reload, removeMany: removeGadgets, update: updateGadget, toggleFavorite: toggleGadgetFavorite, setFavorite } = useGadgets()
  // この画面の保存は必ず updateWith を使う（理由は handleMapChange のコメント）
  const { getById, updateWith, plans, togglePinned } = usePlans()
  const plansRef = useRef(plans)
  plansRef.current = plans
  const { colors, t, lang, isDark, fmtPrice, displayAmount, fmtDimStr, unitLabel, parsePriceToJpy, fmtPriceInput } = useApp()
  const { user, profile } = useAuth()
  const { isPro, isLoading: billingLoading } = useSubscription()
  const wiringTabTargetRef = useSpotlightTarget('wiring-tab')
  const { running: tourRunning, stepIndex: tourStepIndex, next: nextTourStep } = useSpotlight()
  // 課金状態の解決前は Pro の枠で扱う（理由は useEntitlement のコメント）。
  // ここで Free の枠にすると、Pro のユーザーが起動直後に写真を足そうとしただけで
  // 「上限に達しました」→ Paywall になる
  const photoLimits = PLAN_LIMITS[isPro || billingLoading ? 'pro' : 'free']
  const maxPhotos = photoLimits.maxPhotosPerDesk
  const maxFileSizeMB = photoLimits.maxFileSizeMB
  // ═════════════════════════════════════════════════════════════
  // 画面 state（機能グループごと）
  // ═════════════════════════════════════════════════════════════
  // タブ・タブバー
  // 常に機材から。デスクを開き直す目的はたいてい「何を置いているかの確認」で、
  // 配線図は見るのに構えが要る。作成直後もここへ着地する（テンプレート適用直後の
  // 配線図は全部プレースホルダーの絵で、見せ場にならないため）。
  // initialTab は呼び出し側が別のタブを指したいときだけ使う
  const [tab, setTab]               = useState<Tab>(route.params.initialTab ?? 'gadgets')
  // 積んである同じデスクへ navigate で戻ってきたときは、params だけが差し替わる。初期値しか見ないと
  // 「配線を見る」で戻ってきても前のタブのままになる
  const requestedTab = route.params.initialTab
  useEffect(() => { if (requestedTab) setTab(requestedTab) }, [requestedTab])
  const [tabBarWidth, setTabBarWidth] = useState(SCREEN_W)

  // 配線図の事前マウント
  // 配線図：画面表示後の空き時間に「非表示のまま」先にマウントして事前構築しておく。
  // タブタップ時は display 切り替えだけになり、ローディングなしで即表示される。
  const [mapMounted, setMapMounted] = useState(false)
  // ConnectionMap が初回描画準備できたか。準備完了までローディングを被せて一瞬の空白を防ぐ
  const [mapReady, setMapReady] = useState(false)
  // 配線図の断り。常設の1行にすると図が縦に縮むので、タブを開いた直後に出して消す。
  // 出すのはアプリ全体で初回だけ（別のデスクでも同じ注意を繰り返さない）
  const [mapNoticeVisible, setMapNoticeVisible] = useState(false)
  const wiringNoticeShownRef = useRef(false)
  // 初めて配線図を作るときだけ、線を引く前に配置を決めてもらう（ガジェットの四角だけ出す）。
  // 保存はしない：一度きりの入口なので、開き直したときは配線済みの図をそのまま見せる。
  const [placementMode, setPlacementMode] = useState(false)
  const placementOfferedRef = useRef(false)
  const skipOffsetUndoRef = useRef(false)
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

  // 公開（共有）
  const [publishModalVisible, setPublishModalVisible] = useState(false)
  const [publishState, setPublishState] = useState<PublishState>('idle')
  const [publishedDeskId, setPublishedDeskId] = useState<string | null>(null)
  // null = 一度も公開していない / 'private' = 公開を取り消した / 'public' = 公開中
  const [publishedVisibility, setPublishedVisibilityState] = useState<PublishVisibility | null>(null)
  const [publishStatusLoaded, setPublishStatusLoaded] = useState(false)
  const [publishError, setPublishError] = useState('')
  const [isUpdating, setIsUpdating] = useState(false)
  const publishInFlightRef = useRef(false)
  const [savedToast, setSavedToastState] = useState<string | null>(null)
  const savedToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setSavedToast = useCallback((message: string) => {
    setSavedToastState(message)
    if (savedToastTimer.current !== null) clearTimeout(savedToastTimer.current)
    savedToastTimer.current = setTimeout(() => {
      savedToastTimer.current = null
      setSavedToastState(null)
    }, 2400)
  }, [])
  useEffect(() => () => {
    if (savedToastTimer.current !== null) clearTimeout(savedToastTimer.current)
  }, [])
  const [completionPromptVisible, setCompletionPromptVisible] = useState(false)
  const completionPromptCheckRef = useRef<string | null>(null)
  const undoSnackbar = useUndoSnackbar()
  const layoutEditRef = useRef({ gesture: false, saving: 0, restoring: false, revision: 0 })
  const [layoutRestoreRequest, setLayoutRestoreRequest] = useState<MapLayoutRestoreRequest | null>(null)
  const pendingLayoutRestoreRef = useRef<(() => void) | null>(null)
  const layoutScreenMountedRef = useRef(true)
  useEffect(() => {
    layoutScreenMountedRef.current = true
    return () => {
      layoutScreenMountedRef.current = false
      pendingLayoutRestoreRef.current?.()
    }
  }, [])
  const handleLayoutEditStart = useCallback(() => {
    const edit = layoutEditRef.current
    if (edit.gesture || edit.saving || edit.restoring) return false
    edit.gesture = true
    undoSnackbar.setBlocked(true)
    return true
  }, [undoSnackbar])
  const handleLayoutEditEnd = useCallback(() => {
    const edit = layoutEditRef.current
    edit.gesture = false
    undoSnackbar.setBlocked(edit.saving > 0)
  }, [undoSnackbar])
  const [isProfileSaving, setIsProfileSaving] = useState(false)
  const profileSaveInFlightRef = useRef(false)

  // デスク情報（オーナー名）
  const [deskOwnerName, setDeskOwnerName] = useState('')
  const [editingProfile, setEditingProfile] = useState(false)
  // 公開・再公開・公開ページの更新は、名前が決まっていない人にだけ関門を挟む。
  // 通す場所は4か所（フッター・公開シートの公開／更新・共有ボタン）だけ。
  // 決まった名前はこの画面の投稿者行にも即座に効かせる
  const nameGate = usePublicNameGate(setDeskOwnerName)

  // ガジェット一覧タブの表示・並び替え
  const [gadgetSort, setGadgetSort] = useState<GadgetSortKey>(() => getById(planId)?.gadgetOrder?.length ? 'manual' : 'createdAt')
  const [gadgetOrderDraft, setGadgetOrderDraft] = useState<string[] | null>(null)
  const gadgetOrderSaveVersion = useRef(0)
  const gadgetSortInitialized = useRef<string | null>(null)
  const [reorderingGadgets, setReorderingGadgets] = useState(false)
  const gadgetViewportRef = useRef<View>(null)
  const gadgetScrollGesture = useMemo(() => Gesture.Native(), [])
  const [cablesCollapsed, setCablesCollapsed] = useState(false)
  // ケーブル節の「種類」階層。開いた種類だけ個別のケーブルを出す
  const [expandedCableTypes, setExpandedCableTypes] = useState<Set<CableType | '__unknown'>>(new Set())
  const [infoGadget, setInfoGadget] = useState<Gadget | null>(null)
  const [mapGadgetActions, setMapGadgetActions] = useState<{ gadgetId: string; actions: MapGadgetActions } | null>(null)
  const infoMapActions = mapGadgetActions?.gadgetId === infoGadget?.id ? mapGadgetActions?.actions : undefined
  const closeGadgetInfo = useCallback(() => {
    setInfoGadget(null)
    setMapGadgetActions(null)
  }, [])
  const [replacementVisible, setReplacementVisible] = useState(false)
  const [replacementSourceId, setReplacementSourceId] = useState<string | null>(null)
  const [replacementTargetId, setReplacementTargetId] = useState<string | null>(null)
  // 入力欄の表示形（言語ごとの並び）で持つ。保存形式の YYYY-MM-DD を入れると、英語画面で
  // プレースホルダーの MM/DD/YYYY と食い違う
  const [replacementDate, setReplacementDate] = useState(() => formatDate(new Date(), lang))
  const [replacementPrice, setReplacementPrice] = useState('')
  const [replacementInheritSupportArm, setReplacementInheritSupportArm] = useState(true)
  const [replacementInheritRelations, setReplacementInheritRelations] = useState(true)
  const [replacementSaving, setReplacementSaving] = useState(false)
  const replacementKnownIdsRef = useRef<Set<string>>(new Set())
  const replacementAwaitingNewRef = useRef<string | null>(null)
  // ガジェットのシートに並ぶタイルは memo。行ごとに関数を作らない
  // 連打の2回目は捨てる（同じ画面が2枚積まれる。PublicDesk の openAnotherPublicDesk と同じ）
  const openPublicDeskFromGadget = useCallback((deskId: string) => {
    if (!navigation.isFocused()) return
    navigation.push('PublicDesk', { deskId, source: 'gadget_desks' })
  }, [navigation])
  const [gadgetSortExpanded, setGadgetSortExpanded] = useState(false)
  const [pickingPhotos, setPickingPhotos] = useState(false)
  const photoPickerInFlightRef = useRef(false)
  const profileEditModeRef = useRef(false)
  const longPressedPhotoRef = useRef<string | null>(null)

  // 統計タブ
  const [statsAnimVersion, setStatsAnimVersion] = useState(0)

  // プロフィール（ヘッダー）編集
  const [profileEditMode, setProfileEditMode] = useState(false)
  profileEditModeRef.current = profileEditMode
  const profileScrollRef = useRef<ScrollView>(null)
  const revealProfileInput = useKeyboardReveal(profileScrollRef)
  useEffect(() => {
    if (!profileEditMode) profileScrollRef.current?.scrollTo({ y: 0, animated: false })
  }, [profileEditMode])

  // 上部（名前行より下の利用目的・写真）をタブの一覧に合わせて畳む。仕組みは useCollapsibleHeader
  // だけが持つ（デスク詳細と同じものを使う。画面側に書き直すと audit:collapsible-header が止める）。
  // **フックは早期 return より前に置くこと。** 読み込み中（plan / result が未確定で return する）と
  // 読み込み完了とでフックの本数が変わり、「Rendered more hooks than during the previous render」で落ちる。
  // 編集中は上部の入力欄を触るので、開いたままスクロールにも追従させない
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
    gadgetScrollY,
    infoScrollY,
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
  } = useCollapsibleHeader({ tab, editing: profileEditMode })
  const [nameText, setNameText]               = useState('')
  const [descriptionText, setDescriptionText] = useState('')
  // 公開ニックネームは全デスク共通。デスクの編集モード（デスク名・用途）には混ぜない。
  // 混ぜると 1 デスクの編集が全デスクの投稿者名を書き換えることが見えなくなるため、
  // 名前を押したときはマイページと同じプロフィール編集シートを開く
  const [editPurposesVisible, setEditPurposesVisible] = useState(false)
  const descriptionPlaceholder = lang === 'en'
    ? 'e.g. A work and gaming desk with white gear and a wood top.'
    : '例：木目と白で揃えた、仕事とゲーム兼用のデスクです。'
  const [editPurposes, setEditPurposes] = useState<Set<PlanPurpose>>(new Set())
  const [editOtherPurposeLabel, setEditOtherPurposeLabel] = useState('')
  const [editOtherPurposeIcon, setEditOtherPurposeIcon] = useState<MCIconName>(purposeIcon('other'))

  // 写真プレビュー
  const [previewIndex, setPreviewIndex]     = useState<number | null>(null)
  const [previewVisibleIdx, setPreviewVisibleIdx] = useState(0)

  // 右端の現在位置バーの太さを決める寸法（位置は gadgetScrollY / infoScrollY を読む）
  const [gadgetScrollBox, setGadgetScrollBox] = useState({ content: 0, viewport: 0 })
  const [infoScrollBox, setInfoScrollBox]     = useState({ content: 0, viewport: 0 })

  // ═════════════════════════════════════════════════════════════
  // 配線図のマウント effect
  // ═════════════════════════════════════════════════════════════
  // 以前はデスクを開いた 800ms 後に無条件で事前マウントしていたが、ガジェットが増えると
  // レイアウト計算に数百ms〜1秒かかり、その間 JS スレッドが埋まってヘッダーの
  // 戻るを含むタップが取りこぼされていた（PublicDeskScreen と同じ問題）。
  // 開いた直後の操作を優先し、配線タブを開いたときに初めてマウントする。
  // **これは配線図に限った話ではない。** タブの初回マウントを押されたフレームに乗せると、
  // 中身の初回レンダーが終わるまでタブの見た目が変わらない。タブUIを作るときは毎回これをやる
  //（MyPageScreen で同じ抜けが起きた。CLAUDE.md の「タブの初回マウント」を参照）。
  // 一度マウントすれば以降のタブ切替は display の切替だけなので即時のまま。
  // 作成直後は配線タブで開くので、固定待ち時間ではなく画面遷移が終わるのを待つ。
  // 50ms で始めると押し込みアニメーションの最中にレイアウト計算が重なり、
  // 上のコメントにある「戻るが効かない」状態が開いた瞬間に再発する。
  useEffect(() => {
    if (tab !== 'wiring' || mapMounted) return
    const task = InteractionManager.runAfterInteractions(() => setMapMounted(true))
    return () => task.cancel()
  }, [tab, mapMounted])


  // ═════════════════════════════════════════════════════════════
  // プラン・ガジェットの派生値と再計算 effect
  // ═════════════════════════════════════════════════════════════
  const plan = getById(planId)
  const readOnly = !!plan?.isShared
  useEffect(() => {
    if (!plan || gadgetSortInitialized.current === plan.id) return
    gadgetSortInitialized.current = plan.id
    setGadgetSort(plan.gadgetOrder?.length ? 'manual' : 'createdAt')
    setGadgetOrderDraft(null)
  }, [plan])
  const result = plan?.wiringResult
  const [isReflecting, setIsReflecting] = useState(false)
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [recalculationError, setRecalculationError] = useState(false)
  const [recalculationAttempt, setRecalculationAttempt] = useState(0)
  // 配線タブに切り替わって図が出たら断りを出す。図の生成中に出しても読む対象が
  // 無いので mapReady を待つ。閲覧専用は線を直せないので出さない。
  // 既読はこの画面を離れても消えないよう端末に残す。過去版はデスクIDの配列を保存して
  // いたので、1件でもあれば既読として扱えばそのまま移行できる。
  useEffect(() => {
    if (tab !== 'wiring' || readOnly || !mapReady) {
      setMapNoticeVisible(false)
      return
    }
    if (wiringNoticeShownRef.current) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    void loadWiringNoticeSeen().then((seen) => {
      if (!alive || seen.size > 0) return
      wiringNoticeShownRef.current = true
      setMapNoticeVisible(true)
      void markWiringNoticeSeen(planId)
      timer = setTimeout(() => setMapNoticeVisible(false), 6000)
    })
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [tab, readOnly, mapReady, planId])
  // selectedIdsKey は文字列化した「値」なので、plan/gadgets の参照が再レンダーのたびに
  // 変わっても中身が同じなら再計算されない（配線図の重いレイアウト再計算を無駄に誘発しないため）
  const selectedIdsKey = useMemo(
    () => plan?.selectedGadgetIds?.slice()?.sort()?.join(',') ?? '',
    [plan?.selectedGadgetIds],
  )
  const historyGadgets = useMemo(
    () => plan
      ? gadgets
          .filter((g) => plan.selectedGadgetIds.includes(g.id) || plan.gadgetUsage?.[g.id] != null)
          .map((g) => applyDeskGadgetUsage(plan, g))
      : [],
    // plan 全体は入れない。読むのは selectedGadgetIds（＝上の selectedIdsKey）と
    // gadgetUsage だけで、どちらも依存に入っている。参照を入れるとデスク名を変えた
    // だけでも全ガジェットを組み直すことになる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gadgets, selectedIdsKey, plan?.gadgetUsage],
  )
  const selectedGadgets = useMemo(
    () => historyGadgets.filter((g) => plan?.selectedGadgetIds.includes(g.id)),
    // selectedIdsKey は selectedGadgetIds を文字列化した「値」そのもの（上の定義）。
    // 配列の参照ではなく中身で比較したいので、こちらを依存にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyGadgets, selectedIdsKey],
  )
  const replacementSource = useMemo(
    () => selectedGadgets.find((gadget) => gadget.id === replacementSourceId) ?? null,
    [replacementSourceId, selectedGadgets],
  )
  const replacementTarget = useMemo(
    () => historyGadgets.find((gadget) => gadget.id === replacementTargetId)
      ?? gadgets.find((gadget) => gadget.id === replacementTargetId)
      ?? null,
    [gadgets, historyGadgets, replacementTargetId],
  )
  const replacementCandidates = useMemo(() => {
    if (!replacementSource) return []
    const selected = new Set(plan?.selectedGadgetIds ?? [])
    const categoryKey = gadgetCategoryKey(replacementSource)
    return gadgets
      .filter((gadget) => !selected.has(gadget.id) && gadgetCategoryKey(gadget) === categoryKey)
      .sort((a, b) => gadgetTitle(a, lang).localeCompare(gadgetTitle(b, lang), lang))
  }, [gadgets, lang, plan?.selectedGadgetIds, replacementSource])
  const parsedReplacementDate = useMemo(
    () => parseDateInput(replacementDate, lang),
    [lang, replacementDate],
  )
  const parsedReplacementPrice = useMemo(
    () => parsePriceToJpy(replacementPrice),
    [parsePriceToJpy, replacementPrice],
  )
  const replacementPriceError = replacementPrice.trim() && parsedReplacementPrice == null
    ? (lang === 'en' ? 'Enter a number greater than or equal to 0.' : '0以上の金額を入力してください')
    : undefined
  const today = useToday()
  const replacementDateError = useMemo(() => {
    if (!replacementTarget) return undefined
    if (!parsedReplacementDate) return lang === 'en' ? 'Enter a valid date.' : '正しい日付を入力してください'
    if (parsedReplacementDate > localDateKey(today)) return lang === 'en' ? 'Future dates cannot be used.' : '未来の日付は指定できません'
    const currentPeriod = replacementSource?.deskUsagePeriods?.find((period) => !period.endedAt)
    const startedAt = currentPeriod?.startedAt ?? replacementSource?.purchasedAt
    if (startedAt && parsedReplacementDate < startedAt) {
      return lang === 'en' ? `Choose ${formatStoredDate(startedAt, lang)} or later.` : `${formatStoredDate(startedAt, lang)}以降の日付を指定してください`
    }
    const targetLastPeriod = replacementTarget.deskUsagePeriods?.at(-1)
    if (targetLastPeriod && !targetLastPeriod.endedAt) {
      return lang === 'en' ? 'This gadget is already active on this desk.' : 'この商品はすでにこのデスクで使用中です'
    }
    if (targetLastPeriod?.endedAt && parsedReplacementDate < targetLastPeriod.endedAt) {
      return lang === 'en'
        ? `Choose ${formatStoredDate(targetLastPeriod.endedAt, lang)} or later to avoid overlapping usage history.`
        : `利用履歴が重ならないよう、${formatStoredDate(targetLastPeriod.endedAt, lang)}以降を指定してください`
    }
    return undefined
  }, [lang, parsedReplacementDate, replacementSource, replacementTarget, today])

  useEffect(() => {
    const sourceId = replacementAwaitingNewRef.current
    if (!sourceId) return
    const source = selectedGadgets.find((gadget) => gadget.id === sourceId)
    const added = gadgets
      .filter((gadget) => !replacementKnownIdsRef.current.has(gadget.id))
      .find((gadget) => !source || gadget.category === source.category)
    if (!added) return
    replacementAwaitingNewRef.current = null
    setReplacementTargetId(added.id)
    setReplacementPrice(fmtPriceInput(added.price))
    setReplacementVisible(true)
  }, [fmtPriceInput, gadgets, selectedGadgets])
  const allGadgetNamesComplete = selectedGadgets.length > 0
    && selectedGadgets.every((gadget) => !gadget.isPlaceholder && trimInvisible(gadget.name) !== '')
  // 台数はケーブルを除く（ケーブルは上の「ケーブル」欄で本数として別に並ぶ）
  const selectedQuantity = sumDeviceQuantities(selectedGadgets)
  // 統計と機材の詳細シートに渡す線。外した機材との線（戻したときの復活用に保存に残る）は除く。
  // 配線図そのものには生の線を渡す（描画が両端を確かめて落とし、編集の書き戻しも生の線が土台）
  const connectionsForDesk = useMemo(
    () => connectionsOnDesk(plan?.connectionMap?.connections ?? EMPTY_MAP_CONNECTIONS, plan?.selectedGadgetIds ?? []),
    [plan?.connectionMap?.connections, plan?.selectedGadgetIds],
  )
  const replacementSupportArm = useMemo(() => {
    if (!replacementSource || (replacementSource.category !== 'Monitor' && replacementSource.category !== 'Microphone')) return null
    const microphone = replacementSource.category === 'Microphone'
    const armCategory = microphone ? 'MicArm' : 'MonitorArm'
    const cableType = microphone ? 'MicArm' : 'MonitorArm'
    const explicitArmId = microphone
      ? plan?.micArmAssignments?.[replacementSource.id]
      : plan?.monitorArmAssignments?.[replacementSource.id]
    if (typeof explicitArmId === 'string') {
      return selectedGadgets.find((gadget) => gadget.id === explicitArmId && gadget.category === armCategory) ?? null
    }
    if (explicitArmId === null) return null
    const support = connectionsForDesk.find((connection) =>
      connection.cableType === cableType
      && (connection.fromGadgetId === replacementSource.id || connection.toGadgetId === replacementSource.id))
    if (!support) return null
    const armId = support.fromGadgetId === replacementSource.id ? support.toGadgetId : support.fromGadgetId
    return selectedGadgets.find((gadget) => gadget.id === armId && gadget.category === armCategory) ?? null
  }, [connectionsForDesk, plan?.micArmAssignments, plan?.monitorArmAssignments, replacementSource, selectedGadgets])
  const replacementRelationCount = useMemo(() =>
    plan && replacementSource && replacementTarget
      ? replacementRelationTransfer(plan, replacementSource.id, replacementTarget.id, gadgets).count
      : 0,
  [gadgets, plan, replacementSource, replacementTarget])
  // ケーブルは一覧の最下段の
  // 「ケーブル」ジャンルにまとめる。配線図でも「線」であって「ノード」ではないので、
  // ノードとしては描かない
  const nonCableGadgets = useMemo(
    () => selectedGadgets.filter((g) => g.category !== 'Cable'),
    [selectedGadgets],
  )
  const cableGadgets = useMemo(
    () => selectedGadgets.filter((g) => g.category === 'Cable'),
    [selectedGadgets],
  )
  const { sortedGadgets, sortedCableGadgets, cableTypeGroups, cableTotalCount } =
    useDeskGadgetSections(nonCableGadgets, cableGadgets, gadgetSort, lang, gadgetOrderDraft ?? plan?.gadgetOrder)
  const orderedGadgetRows = useMemo(() => gadgetSort === 'manual'
    ? sortedGadgets.map((gadget) => ({ gadget, mounted: false }))
    : orderDeskGadgets(sortedGadgets, connectionsForDesk), [gadgetSort, sortedGadgets, connectionsForDesk])
  // 配線図のシート（つなぐ機材・飾り）に出す順。機材タブと同じにする
  const mapListOrder = useMemo(() => orderedGadgetRows.map(({ gadget }) => gadget.id), [orderedGadgetRows])
  const reorderGadgets = useCallback((ids: string[]) => {
    if (!plan || readOnly) return
    const currentOrder = orderedGadgetRows.map(({ gadget }) => gadget.id)
    currentOrder.push(...sortedCableGadgets.map((g) => g.id))
    const order = mergeGadgetOrder(currentOrder, ids, plan.selectedGadgetIds)
    setGadgetOrderDraft(order)
    setGadgetSort('manual')
    const version = ++gadgetOrderSaveVersion.current
    void updateWith(planId, (prev) => ({ ...prev, gadgetOrder: mergeGadgetOrder(order, ids, prev.selectedGadgetIds), updatedAt: new Date().toISOString() }))
      .catch(() => setSavedToast(lang === 'en' ? 'Could not save the order' : '並び順を保存できませんでした'))
      .finally(() => { if (gadgetOrderSaveVersion.current === version) setGadgetOrderDraft(null) })
  }, [plan, readOnly, orderedGadgetRows, sortedCableGadgets, updateWith, planId, lang, setSavedToast])
  const onGadgetDraggingChange = useCallback((active: boolean) => {
    setReorderingGadgets(active)
    if (active) wiringSwipeRefs.current.forEach((row) => row.close())
  }, [])
  const measureGadgetViewport = useCallback((callback: (top: number, bottom: number) => void) => {
    gadgetViewportRef.current?.measureInWindow((_x, y, _w, height) => callback(y, Math.min(y + height, Dimensions.get('window').height)))
  }, [])
  const scrollGadgetsBy = useCallback((delta: number) => {
    const current = gadgetScrollY.value
    const next = Math.max(0, Math.min(Math.max(0, gadgetScrollBox.content - gadgetScrollBox.viewport), current + delta))
    gadgetScrollRef.current?.scrollTo({ y: next, animated: false })
    gadgetScrollY.value = next
    return next - current
  }, [gadgetScrollY, gadgetScrollBox, gadgetScrollRef])
  const requiredCableGroups = useMemo(() => {
    const rows = result?.requiredCables ?? []
    const rank = (row: { cableType: CableType }) => cableSortRank(row.cableType)
    const pick = (charging: boolean) => rows
      .filter((row) => (row.chargingOnly === true) === charging)
      .slice()
      .sort((a, b) => rank(a) - rank(b))
    return { wired: pick(false), charging: pick(true) }
  }, [result?.requiredCables])
  // つなぎ方の進捗。行の作り方（ケーブルが要らない線を外す・2in1 を1本に束ねる）は
  // 必要本数の集計と同じ実装に任せる。ここで数え方を書き直すと一覧と数が食い違う
  const cableChoiceProgress = useMemo(() => {
    const groups = plan ? cabledConnectionGroups(gadgets, plan) : []
    return { total: groups.length, decided: groups.filter((g) => !!g[0].cableChoice).length }
  }, [gadgets, plan])

  const requiredCableTotal = useMemo(
    () => (result?.requiredCables ?? []).reduce((sum, row) => sum + row.count, 0),
    [result?.requiredCables],
  )

  const [requiredCablesOpen, setRequiredCablesOpen] = useState(false)

  // 口・コンセントが足りないという判定。投稿されるのは出来上がったデスクなので、
  // 本当に足りないより、使っているハブや電源タップを登録していないことのほうが多い。
  // 買う案内ではなく登録漏れの確認として出し、閉じたらそのデスクでは同じものを出さない
  const allSuggestions = result?.suggestions ?? EMPTY_SUGGESTIONS
  const [dismissedSuggestions, setDismissedSuggestions] = useState<ReadonlySet<string> | null>(null)
  useEffect(() => {
    let alive = true
    void loadDismissedSuggestions(planId).then((keys) => { if (alive) setDismissedSuggestions(keys) })
    return () => { alive = false }
  }, [planId])
  // 読み込むまでは出さない。閉じたはずのカードが一瞬出て消える
  const suggestions = useMemo(
    () => (dismissedSuggestions ? allSuggestions.filter((item) => !dismissedSuggestions.has(suggestionKey(item))) : EMPTY_SUGGESTIONS),
    [allSuggestions, dismissedSuggestions],
  )
  const dismissSuggestions = useCallback(() => {
    const keys = suggestions.map(suggestionKey)
    setDismissedSuggestions((prev) => new Set([...(prev ?? []), ...keys]))
    void dismissWiringSuggestions(planId, keys)
  }, [planId, suggestions])


  // タブ切り替えで戻ってきたとき等に最新ガジェットデータを再取得する
  useFocusEffect(useCallback(() => { reload() }, [reload]))
  // 交換用の商品登録を取りやめて戻った場合も、元の交換選択を閉じた状態にしない。
  useFocusEffect(useCallback(() => {
    if (replacementAwaitingNewRef.current) setReplacementVisible(true)
  }, []))
  useFocusEffect(useCallback(() => {
    setIsReflecting(isPlanReflecting(planId))
    return subscribePlanReflection(planId, setIsReflecting)
  }, [planId]))
  // 名前が変わったときだけ入力欄へ流し込む。plan の参照を依存にすると、
  // 配線図の保存など無関係な更新のたびに入力中の文字が上書きされる
  useEffect(() => {
    if (plan) setNameText(plan.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.name])

  useFocusEffect(useCallback(() => {
    let active = true
    getPublicNickname()
      .then((name) => { if (active) setDeskOwnerName(name) })
      .catch(() => { if (active) setDeskOwnerName('') })
    return () => { active = false }
  }, []))

  // 次回起動のウォームアップが「最後に開いたプラン」を最優先できるよう記録する。
  // 共有デスクは自分のデスクの温め対象ではないので記録しない。
  useEffect(() => {
    if (readOnly) return
    markPlanOpened(planId)
  }, [planId, readOnly])

  // 完成したデスクを開いた時点で、そのデスクの作成ドラフトだけを完了扱いにする。
  // 無関係なデスクを開いて、別の作成途中データまで消さない。
  useEffect(() => {
    if (readOnly) return
    void loadFirstSetupDraft().then((draft) => {
      if (draft && 'planId' in draft && draft.planId === planId) {
        return clearFirstSetupDraft()
      }
    }).catch(() => {})
  }, [planId, readOnly])

  // 本人の実機が2台以上ある結果だけをActivationとする。
  // テンプレートの空枠や見本の閲覧は成果に数えない。
  useEffect(() => {
    if (!result || !isPersonalizedResult(selectedGadgets, result)) return
    const properties = {
      gadget_count:     selectedGadgets.length,
      connection_count: result.connections.length,
      warning_count:    result.warnings.length,
      from_template:    !!plan?.templateId,
    }
    void trackOnce(EVENTS.FIRST_RESULT_VIEWED, properties)
    void trackOnce(EVENTS.FIRST_PERSONALIZED_RESULT_VIEWED, properties)
  }, [result, selectedGadgets, plan?.templateId])

  // ガジェットの内容・選択変更時に再計算する（再編集後も反映されるよう selectedIdsKey を dep に含む）
  // generateWiring は同期実行で重いため、画面遷移アニメーションが終わってから走らせる。
  // タップ→画面表示までは保存済みの wiringResult で即座に描画され、結果は直後に差し替わる
  //
  // キーはガジェット全体から作る。エンジンが読む項目（給電元・給電方法・充電の相手・
  // Bluetooth の接続先・カテゴリ・名前・形…）を手で並べると必ず漏れる。以前はポートと
  // 飾りかどうかだけで、GadgetDetail で給電元を変えて戻っても配線が古いままだった
  // （この画面は裏にマウントされたまま残るので、キーが変わらない限り再計算されない）。
  // 保存は差分があるときだけなので、関係ない項目の編集で走っても書き込みは起きない
  const gadgetDataKey = useMemo(
    () => JSON.stringify(selectedGadgets),
    [selectedGadgets],
  )
  useEffect(() => {
    // 待つのは「読み終わったか」で、件数ではない。件数で待つと、最後の1台を消して
    // マイガジェットが0件になったデスクが二度と作り直されず、必要なケーブルが残り続ける
    if (!plan || gadgetsLoading || gadgetsLoadError) return
    let cancelled = false
    setIsRecalculating(true)
    setRecalculationError(false)
    const task = InteractionManager.runAfterInteractions(async () => {
      if (cancelled) return
      try {
        // 計算そのものは重いので先に一度だけ行うが、保存内容の組み立ては updateWith 内で
        // 「保存直前の最新 plan (p)」を基準にする。ここは generateWiring 呼び出しから
        // 実際の保存までに非同期の間があり、その間にユーザーが配線図を手で編集すると
        // （ドラッグ・接続の追加削除など）、閉じ込めた古い plan を丸ごと update すると
        // その手動編集を上書きして消してしまうため。
        if (cancelled) return
        // このデスクで配線図を初めて作ったか（＝配置を先に決めてもらう回か）
        let firstBuild = false
        await updateWith(planId, (p) => {
          const refreshed = refreshPlanWiring(p, gadgets, lang)
          firstBuild = refreshed.firstBuild
          return refreshed.plan
        })
        // 配置を決めてもらう入口はデスクごとに一度きり。ガジェットを足すたびに
        // 線が消えて配置からやり直し、にはしない
        if (!cancelled && firstBuild && !readOnly && !placementOfferedRef.current) {
          placementOfferedRef.current = true
          setPlacementMode(true)
        }
      } catch (error) {
        analytics.error('recalculate_wiring', error)
        if (!cancelled) setRecalculationError(true)
      } finally {
        if (!cancelled) setIsRecalculating(false)
      }
    })
    return () => { cancelled = true; task.cancel(); setIsRecalculating(false) }
    // lang を含めるのは、警告文とケーブルラベルが generateWiring / reconcileMap で
    // ローカライズされるため。含めないと言語を切り替えても旧言語の文言が残る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, gadgetDataKey, selectedIdsKey, lang, recalculationAttempt, gadgetsLoading, gadgetsLoadError])

  const handleMapReady = useCallback(() => setMapReady(true), [])
  // 図が描けなくなったときの「配置と配線をリセット」。機材は残し、位置を捨てて線を作り直す。
  // 古い位置で計算したキャッシュが返らないよう、このデスクの分も捨てる
  const handleResetLayout = useCallback(async () => {
    evictPlanLayoutCache(planId)
    restorePlanLayoutCache(planId)
    await updateWith(planId, (prev) => resetPlanLayout(prev, gadgets, lang))
  }, [gadgets, lang, planId, updateWith])
  // 「配線する」で保存される配置は操作の一部なので、取り消しトーストは出さない
  // （配線図が現れる瞬間に別の通知を重ねない）
  const handleConfirmPlacement = useCallback((rewired: boolean) => {
    if (rewired) skipOffsetUndoRef.current = true
    setPlacementMode(false)
  }, [])
  const handleOpenMapGadget = useCallback((id: string, actions?: MapGadgetActions) => {
    setMapGadgetActions(actions ? { gadgetId: id, actions } : null)
    setInfoGadget(selectedGadgets.find((g) => g.id === id) ?? null)
  }, [selectedGadgets])

  // 配線図：保存（nodeOffsets は温存）
  // 削除された接続は dismissedPairs に記録する。これがないと reconcileMap が
  // エンジン出力から作り直すため、消したはずの線が次に配線図を開いたときに復活する。
  //
  // update() ではなく updateWith() を使う：この画面には配線図のドラッグ移動・リサイズ・
  // 自動再計算など、同じ plan を土台に別々の変更を保存する処理が複数あり、それぞれが
  // 呼び出し時点の（古いかもしれない）plan スナップショットから次の値を組み立てて
  // update() すると、後から解決した方が前の保存を丸ごと上書きしてしまう
  // （＝配線図を編集したのに次回開くと消えている、という lost update の原因になる）。
  // updateWith は保存キュー内で「直前の保存を反映した最新の plan」を受け取って
  // 差分を組み立てるため、この上書きが起きない。
  // ─── 配線図の編集を1手だけ戻す ───────────────────────────────
  // 接続のUndoには接続だけを保持し、位置・サイズのUndoとは復元対象を分ける。

  // 配線図を手で直したら必要なケーブルも数え直す。再計算の effect は配線図の変更では
  // 走らないので、本数を＋にしても線を消しても、開き直すまで古い本数のままになっていた。
  // 配線の生成（generateWiring）までは回し直さず、保存済みの出力から本数だけを数える
  const recountCables = useCallback((p: DeskPlan): DeskPlan => {
    if (!p.wiringResult) return p
    const appliedGadgets = gadgets.map((g) => applyDeskGadgetUsage(p, g))
    return {
      ...p,
      wiringResult: {
        ...p.wiringResult,
        requiredCables: countRequiredCables(appliedGadgets, p, p.wiringResult.connections),
      },
    }
  }, [gadgets])

  const restoreMap = useCallback((snap: MapUndoSnapshot) => {
    return updateWith(planId, (p) => {
      const cm = p.connectionMap ?? { connections: [] }
      return recountCables({
        ...p,
        connectionMap: {
          ...cm,
          connections: snap.connections,
          dismissedPairs: snap.dismissedPairs,
        },
        updatedAt: new Date().toISOString(),
      })
    }, { awaitPersistence: true })
  }, [planId, updateWith, recountCables])

  const showMapUndo = useCallback((snap: MapUndoSnapshot | null, ja: string, en: string, revision: number) => {
    if (!snap || revision !== layoutEditRef.current.revision) return
    undoSnackbar.showUndo({
      message: lang === 'ja' ? ja : en,
      onUndo: async () => {
        if (revision !== layoutEditRef.current.revision) return
        layoutEditRef.current.restoring = true
        try { await restoreMap(snap) } finally { layoutEditRef.current.restoring = false }
      },
    })
  }, [undoSnackbar, lang, restoreMap])

  // 受け取るのは「今の線 → 次の線」の関数。保存キューの中で最新の線に当てる。
  // 以前は配線図がタップ時点の props から作った配列を丸ごと書いていたので、裏の再計算と
  // 重なると（デスクを開いた直後・ガジェットを直して戻った直後）、再計算で作り直した線を
  // 編集前の線で上書きしていた。取り消し用の控えも同じ理由で保存時点の値から取る
  const handleMapChange = useCallback((update: (current: MapConnection[]) => MapConnection[]) => {
    if (!plan || layoutEditRef.current.restoring || layoutEditRef.current.gesture) return
    const revision = ++layoutEditRef.current.revision
    let before: MapUndoSnapshot | null = null
    let delta = 0
    void updateWith(planId, (p) => {
      const cm = p.connectionMap
      const prevConns = cm?.connections ?? []
      before = cm
        ? { connections: prevConns, dismissedPairs: cm.dismissedPairs }
        : null
      const next = update(prevConns)
      delta = next.length - prevConns.length
      const nextIds = new Set(next.map((c) => c.id))
      const dismissed = new Set(p.connectionMap?.dismissedPairs ?? [])
      let deleted = false
      for (const c of prevConns) {
        if (!nextIds.has(c.id)) {
          deleted = true
          dismissed.add(mapPairKey(c.fromGadgetId, c.toGadgetId, c.cableType))
        }
      }
      const nextPlan = {
        ...p,
        connectionMap: { ...p.connectionMap, connections: next, dismissedPairs: [...dismissed] },
      }
      // 再計算（refreshPlanWiring）と同じく、デスクごとの状態を通したガジェットで組む。
      // 生の gadgets だと「このデスクでは飾り」の機材にも線が引かれる
      const connections = deleted
        ? reconcileMap(next, gadgets.map((g) => applyDeskGadgetUsage(nextPlan, g)), nextPlan, lang)
        : next
      return recountCables({
        ...nextPlan,
        connectionMap: { ...nextPlan.connectionMap, connections },
        updatedAt: new Date().toISOString(),
      })
    }).then(() => showMapUndo(
      before,
      delta < 0 ? '配線を削除しました' : delta > 0 ? '配線を追加しました' : '配線を変更しました',
      delta < 0 ? 'Wiring deleted' : delta > 0 ? 'Wiring added' : 'Wiring changed',
      revision,
    ))
  }, [plan, planId, gadgets, lang, updateWith, showMapUndo, recountCables])

  const saveNodeLayout = useCallback(async (
    offsets: Record<string, NodeOffset>,
    ids: readonly string[],
    sizes?: Record<string, { w: number; h: number }>,
    skipUndo = false,
    offsetIds: readonly string[] = sizes ? [] : ids,
  ) => {
    const edit = layoutEditRef.current
    if (edit.restoring) return
    const revision = ++edit.revision
    edit.saving++
    undoSnackbar.setBlocked(true)
    let change: MapLayoutChange | undefined
    try {
      await updateWith(planId, (p) => {
        const cm = p.connectionMap ?? { connections: [] }
        change = captureMapLayoutChange(cm, offsets, offsetIds, sizes, sizes ? ids : [])
        return applyMapLayoutChange({ ...p, connectionMap: cm }, change, localDateKey())
      }, { awaitPersistence: true })
      const snapshot = change
      if (!layoutScreenMountedRef.current || skipUndo || !snapshot || revision !== edit.revision
        || (!Object.keys(snapshot.offsets).length && !Object.keys(snapshot.sizes).length)) return
      const gadget = gadgets.find(g => g.id === baseMapNodeId(ids[0] ?? ''))
      const name = gadget ? gadgetTitle(gadget, lang) : ''
      undoSnackbar.showUndo({
        message: sizes
          ? (lang === 'ja' ? '大きさを変えました' : 'Size changed')
          : (lang === 'ja' ? (name ? `「${name}」を移動しました` : '配置を変更しました') : (name ? `Moved ${name}` : 'Layout changed')),
        onUndo: async () => {
          if (revision !== edit.revision) return
          edit.restoring = true
          try {
            let restored = false
            await updateWith(planId, (p) => {
              if (revision !== edit.revision) return p
              const next = applyMapLayoutChange(p, snapshot, localDateKey(), true)
              restored = next !== p
              return next
            }, { awaitPersistence: true })
            if (restored && layoutScreenMountedRef.current) {
              await withTimeout(new Promise<void>((resolve, reject) => {
                pendingLayoutRestoreRef.current = resolve
                setLayoutRestoreRequest({ nodeIds: ids, onComplete: resolve, onError: reject })
              }), QUICK_TIMEOUT_MS)
            }
          } finally {
            pendingLayoutRestoreRef.current = null
            if (layoutScreenMountedRef.current) setLayoutRestoreRequest(null)
            edit.restoring = false
          }
        },
      })
    } catch (error) {
      analytics.error('save_map_layout', error)
      Alert.alert(lang === 'ja' ? '配置を保存できませんでした' : 'Could not save layout')
    } finally {
      edit.saving--
      if (layoutScreenMountedRef.current) undoSnackbar.setBlocked(edit.gesture || edit.saving > 0)
    }
  }, [gadgets, lang, planId, undoSnackbar, updateWith])

  const handleNodeOffsets = useCallback((offsets: Record<string, NodeOffset>, ids: readonly string[] = Object.keys(offsets)) => {
    const skipUndo = skipOffsetUndoRef.current
    skipOffsetUndoRef.current = false
    return saveNodeLayout(offsets, ids, undefined, skipUndo)
  }, [saveNodeLayout])

  const handleNodeSizes = useCallback((sizes: Record<string, { w: number; h: number }>, offsets: Record<string, NodeOffset>, ids: readonly string[] = Object.keys(sizes), offsetIds: readonly string[] = []) =>
    saveNodeLayout(offsets, ids, sizes, false, offsetIds), [saveNodeLayout])

  // 既存の公開状態をローカルから読むだけ（通信なし）。
  // ここで republish / publish を自動実行してはいけない：
  // ・非公開にしたデスクが、画面を開き直しただけで公開に戻ってしまう
  // ・写真を1枚追加しただけで、本人に断りなく公開URLが生成されてしまう
  // 公開・再公開はユーザーが共有／公開ボタンを押したときだけ行う。
  useEffect(() => {
    let cancelled = false
    setPublishStatusLoaded(false)
    Promise.all([getPublishedDeskId(planId), getPublishedVisibility(planId)])
      .then(([id, visibility]) => {
        if (cancelled) return
        setPublishedDeskId(id)
        setPublishedVisibilityState(visibility)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setPublishStatusLoaded(true) })
    return () => { cancelled = true }
  }, [planId])

  useEffect(() => {
    if (!plan || readOnly || gadgetsLoading || !publishStatusLoaded) return
    if (!allGadgetNamesComplete || publishedDeskId !== null) {
      setCompletionPromptVisible(false)
      if (!allGadgetNamesComplete) completionPromptCheckRef.current = null
      return
    }
    if (completionPromptCheckRef.current === planId) return
    completionPromptCheckRef.current = planId
    let active = true
    void hasSeenDeskCompletionPrompt(planId).then((seen) => {
      if (!active || seen) return
      setCompletionPromptVisible(true)
      void markDeskCompletionPromptSeen(planId)
    })
    return () => { active = false }
  }, [allGadgetNamesComplete, gadgetsLoading, plan, planId, publishStatusLoaded, publishedDeskId, readOnly])

  // 公開中のこのデスクへの反応（086）。持ち主にだけ件数を見せる。
  // 他所でいいね・保存されて戻ってきたときに合わせるので、フォーカスのたびに取り直す
  const [reaction, setReaction] = useState<DeskReaction | undefined>(undefined)
  useFocusEffect(useCallback(() => {
    if (!publishedDeskId || !user || (publishedVisibility !== 'public' && publishedVisibility !== 'unlisted')) {
      setReaction(undefined)
      return
    }
    let active = true
    getMyDeskReactions()
      .then((list) => { if (active) setReaction(list.find((r) => r.deskId === publishedDeskId)) })
      .catch(() => {})
    return () => { active = false }
  }, [publishedDeskId, publishedVisibility, user]))

  // 公開の状態（未公開／公開中／更新あり／非公開）。バッジと公開シートの文言に使う。
  // 内容を変えるたびに読み直したいので、plan.updatedAt が動いたら評価し直す
  const [planPublishState, setPlanPublishState] = useState<PlanPublishState>('none')
  const planPublishKey = plan ? `${plan.id}:${plan.updatedAt}` : ''
  useEffect(() => {
    if (!plan) return
    let cancelled = false
    void getPlanPublishState(plan, gadgets)
      .then((state) => { if (!cancelled) setPlanPublishState(state) })
      .catch(() => {})
    return () => { cancelled = true }
    // plan / gadgets は参照が頻繁に変わるので、値から作った key で必要なときだけ読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planPublishKey, gadgets, publishedDeskId, publishedVisibility])

  // 編集中の名前・説明・用途が保存済みと違うか。離れる瞬間に読むので毎レンダー差し替える
  const profileEditedRef = useRef<() => boolean>(() => false)
  profileEditedRef.current = () => {
    if (!plan) return false
    const savedPurposes = plan.purposes ?? []
    return trimAndTruncate(nameText, 30) !== plan.name
      || truncateChars(tidyMultilineText(descriptionText), DESK_DESCRIPTION_MAX_LENGTH) !== (plan.description ?? '')
      || editPurposes.size !== savedPurposes.length
      || savedPurposes.some((purpose) => !editPurposes.has(purpose))
      || (editPurposes.has('other') && (
        trimAndTruncate(editOtherPurposeLabel, PURPOSE_NAME_MAX_LENGTH) !== (plan.otherPurposeLabel ?? '')
        || editOtherPurposeIcon !== purposeIcon('other', plan.otherPurposeIcon)
      ))
  }
  useEffect(() => {
    let pending: object | null = null
    const unsubscribe = navigation.addListener('beforeRemove', (event: any) => {
      if (!profileEditModeRef.current) return
      if (isProfileSaving) {
        event.preventDefault()
        return
      }
      // 書き換えたまま戻ると、名前・説明・用途は保存されずに消える。機材の詳細画面と同じく確認する
      // （以前は黙って捨てていて、長く書いた説明がスワイプ1回で消えた）
      if (profileEditedRef.current()) {
        event.preventDefault()
        if (pending) return
        const ticket = {}
        pending = ticket
        confirmDiscardChanges(lang, () => {
          if (pending !== ticket) return
          pending = null
          if (!navigation.isFocused()) return
          profileEditModeRef.current = false
          navigation.dispatch(event.data.action)
        }, () => { if (pending === ticket) pending = null })
        return
      }
      profileEditModeRef.current = false
    })
    return () => { pending = null; unsubscribe() }
  }, [navigation, isProfileSaving, lang, planId])

  // ═════════════════════════════════════════════════════════════
  // ハンドラ（公開・更新 → プロフィール編集 → ガジェット操作）
  // ═════════════════════════════════════════════════════════════
  // 公開の4つの入口で同じ確認をする。どれも送り先へ移る前に公開シートを閉じる
  const promptGadgetIssue = useCallback((purpose: 'publish' | 'update', issue: PublishGadgetIssue) => {
    const go = (screen: 'ProductFill' | 'AddGadget') => {
      setPublishModalVisible(false)
      navigation.navigate(screen, { planId })
    }
    promptGadgetRequired(lang, purpose, issue, {
      fillProducts: () => go('ProductFill'),
      addGadget: () => go('AddGadget'),
    })
  }, [lang, navigation, planId])

  const handlePublish = useCallback(async (visibility: 'public' | 'unlisted') => {
    if (publishInFlightRef.current) return
    if (!user) {
      promptLogin(navigation, lang, lang === 'ja' ? '公開するにはログインしてください' : 'Please log in to publish.')
      return
    }
    if (!plan) return
    const gadgetIssue = publishGadgetIssue(plan, gadgets)
    if (gadgetIssue) {
      promptGadgetIssue('publish', gadgetIssue)
      return
    }
    if ((plan.images?.length ?? 0) < 1) {
      promptPhotoRequired(lang, 'publish', () => {
        setPublishModalVisible(false)
        navigation.navigate('PhotoFill', { planId })
      })
      return
    }
    publishInFlightRef.current = true
    setPublishState('loading')
    try {
      // 公開の直前に読む。deskOwnerName はフォーカス時の控えなので、読み込みが
      // 終わる前に公開すると空文字が渡り、投稿者名なしで公開されてしまう
      const ownerName = await getPublicNickname()
      // 裏の再計算より先に押されても、作り直した配線で公開する（saveFreshWiring の注記）
      const target = (await saveFreshWiring(updateWith, planId, gadgets, lang)) ?? plan
      const deskId = await withTimeout(
        publishPlan(target, gadgets, user.id, target.images ?? [], { ownerName, visibility }),
        PUBLISH_TIMEOUT_MS,
      )
      setPublishedDeskId(deskId)
      setPublishedVisibilityState(visibility)
      hapticSuccess()
      setPublishState('done')
    } catch (e: any) {
      const [recovery] = await recoverPendingPublications(planId).catch(() => [])
      if (recovery?.visibility) {
        setPublishedVisibilityState(recovery.visibility)
        setPublishedDeskId(recovery.deskId)
        setPlanPublishState(publishStateOf(recovery.visibility, recovery.status !== 'recovered'))
      }
      if (recovery?.status === 'recovered' && recovery.visibility === visibility) {
        hapticSuccess()
        setPublishState('done')
        return
      }

      setPublishError(userErrorMessage(e, lang, lang === 'ja' ? '公開できませんでした' : 'Could not publish'))
      hapticError()
      setPublishState('error')
    } finally {
      publishInFlightRef.current = false
    }
  }, [user, plan, planId, gadgets, lang, navigation, updateWith, promptGadgetIssue])

  // 公開中のデスクの公開ページを、いまの内容で上書きする。
  // publishPlan は見え方を渡さなければいまの見え方（公開・URL限定）を保つが、公開中でない
  // デスクに対して呼んではいけない（未公開デスクが無断で公開され、非公開に戻したデスクも公開に戻る）。
  // 新規公開・再公開は必ず同意を取る handleShare / handlePublish 経由で行う。
  const canUpdatePublicPage = !!publishedDeskId && (publishedVisibility === 'public' || publishedVisibility === 'unlisted')
  const handleUpdate = useCallback(async () => {
    if (!user || !plan || publishInFlightRef.current) return
    if (!canUpdatePublicPage) return
    const gadgetIssue = publishGadgetIssue(plan, gadgets)
    if (gadgetIssue) {
      promptGadgetIssue('update', gadgetIssue)
      return
    }
    if ((plan.images?.length ?? 0) < 1) {
      promptPhotoRequired(lang, 'update', () => {
        setPublishModalVisible(false)
        navigation.navigate('PhotoFill', { planId })
      })
      return
    }
    publishInFlightRef.current = true
    setIsUpdating(true)
    try {
      const ownerName = await getPublicNickname()
      const target = (await saveFreshWiring(updateWith, planId, gadgets, lang)) ?? plan
      await withTimeout(
        publishPlan(target, gadgets, user.id, target.images ?? [], { ownerName }),
        PUBLISH_TIMEOUT_MS,
      )
      // 反映済みにする。plan.updatedAt は動かないので、状態を読み直す効果は走らない
      setPlanPublishState(publishStateOf(publishedVisibility))
      setSavedToast(lang === 'ja' ? '公開ページを更新しました' : 'Public page updated')
    } catch (e: any) {
      const [recovery] = await recoverPendingPublications(planId).catch(() => [])
      if (recovery?.visibility) {
        setPublishedVisibilityState(recovery.visibility)
        setPublishedDeskId(recovery.deskId)
        setPlanPublishState(publishStateOf(recovery.visibility, recovery.status !== 'recovered'))
      }
      if (recovery?.status === 'recovered') return

      Alert.alert(lang === 'ja' ? 'エラー' : 'Error', userErrorMessage(e, lang, lang === 'ja' ? '公開ページを更新できませんでした' : 'Could not update the public page'))
    } finally {
      publishInFlightRef.current = false
      setIsUpdating(false)
    }
  }, [user, plan, planId, gadgets, lang, canUpdatePublicPage, updateWith, publishedVisibility, navigation, promptGadgetIssue, setSavedToast])

  // 公開中のデスクを「公開」と「URL限定」の間で切り替える。中身は送り直さない
  const [changingVisibility, setChangingVisibility] = useState(false)
  const handleChangeVisibility = useCallback(async (next: 'public' | 'unlisted') => {
    if (publishInFlightRef.current || publishedVisibility === next) return
    publishInFlightRef.current = true
    setChangingVisibility(true)
    try {
      await withTimeout(setPlanVisibility(planId, next), QUICK_TIMEOUT_MS)
      setPublishedVisibilityState(next)
      setPlanPublishState((prev) => publishStateOf(next, isOutdatedPublishState(prev)))
    } catch (e: any) {
      const [recovery] = await recoverPendingPublications(planId).catch(() => [])
      if (recovery?.visibility) {
        setPublishedVisibilityState(recovery.visibility)
        setPublishedDeskId(recovery.deskId)
        setPlanPublishState(publishStateOf(recovery.visibility, recovery.status !== 'recovered'))
      }
      if (recovery?.status === 'recovered' && recovery.visibility === next) return

      Alert.alert(
        lang === 'ja' ? '見え方を変えられませんでした' : 'Could not change visibility',
        userErrorMessage(e, lang, lang === 'ja'
          ? '通信環境を確認して、もう一度お試しください。'
          : 'Check your connection and try again.'),
      )
    } finally {
      publishInFlightRef.current = false
      setChangingVisibility(false)
    }
  }, [planId, publishedVisibility, lang])

  const handleUnpublish = useCallback(async () => {
    if (publishInFlightRef.current) return
    publishInFlightRef.current = true
    try {
      await withTimeout(unpublishPlan(planId), QUICK_TIMEOUT_MS)
      // deskId のマッピングは残す（再公開したときに同じURLを保つため）。
      // 公開状態だけ private にして、リンク表示や自動再公開が起きないようにする
      setPublishedVisibilityState('private')
      setPlanPublishState('private')
      setPublishState('idle')
      setPublishModalVisible(false)
    } catch (e: any) {
      const [recovery] = await recoverPendingPublications(planId).catch(() => [])
      if (recovery?.visibility) {
        setPublishedVisibilityState(recovery.visibility)
        setPublishedDeskId(recovery.deskId)
        setPlanPublishState(publishStateOf(recovery.visibility, recovery.status !== 'recovered'))
      }
      if (recovery?.status === 'recovered' && recovery.visibility === 'private') {
        setPublishState('idle')
        setPublishModalVisible(false)
        return
      }

      if (isPhotoRevocationIncomplete(e)) {
        setPublishedVisibilityState('private')
        setPlanPublishState('private')
        Alert.alert(
          lang === 'ja' ? '写真の公開停止が未完了です' : 'Photo access is not fully revoked',
          userErrorMessage(e, lang, ''),
          [
            { text: lang === 'ja' ? '閉じる' : 'Close', style: 'cancel' },
            { text: lang === 'ja' ? '再試行' : 'Retry', onPress: () => { void handleUnpublish() } },
          ],
        )
        return
      }
      // 失敗を飲み込んで閉じると、公開されたままなのに本人は非公開にしたつもりになる。
      // 公開の取り消しは「できたつもり」がいちばん害が大きいので、成功を装わない
      Alert.alert(
        lang === 'ja' ? '公開を取り消せませんでした' : 'Could not unpublish',
        userErrorMessage(e, lang, lang === 'ja'
          ? '公開状態を確認できませんでした。通信環境を確認して、再試行してください。'
          : 'Could not confirm visibility. Check your connection and retry.'),
        [
          { text: lang === 'ja' ? '閉じる' : 'Close', style: 'cancel' },
          { text: lang === 'ja' ? '再試行' : 'Retry', onPress: () => { void handleUnpublish() } },
        ],
      )
    } finally {
      publishInFlightRef.current = false
    }
  }, [planId, lang])

  const wiringSwipeRefs = useRef<Map<string, Swipeable>>(new Map())
  const gadgetRemoval = useRemovalMotion()
  const photoRemoval = useRemovalMotion()
  const addedPhotoUris = useRef(new Set<string>())
  const purposeRemoval = useRemovalMotion()
  // デスクから外す操作はこの行のスワイプにしか無いので、機材タブを初めて開いたときに見せる
  useSwipePeekHint({
    storageKey: '@desk_gadget_swipe_hint_seen_v1',
    rowId: readOnly || tab !== 'gadgets' ? null
      // 一覧は取り付けたもの・アームを本体の後ろへ並べ直して描く。並べ替えの先頭をそのまま使うと、
      // 先頭がアクセサリのとき本体の後ろ（画面の外のこともある）の行が揺れ、見せないまま既読になる
      : orderedGadgetRows[0]?.gadget.id ?? null,
    rows: wiringSwipeRefs,
    sides: 'right',
  })
  const removingGadgetIdsRef = useRef(new Set<string>())

  const removeGadgetFromPlan = useCallback(async (gadget: Gadget) => {
    if (!plan) return
    let armSnapshot: ArmAssignmentSnapshot = []
    let armAffectedCount = 0
    await updateWith(planId, (p) => {
      const detached = detachArmAssignments(p, gadget, gadgets)
      armSnapshot = detached.snapshot
      if (gadget.category === 'MonitorArm' || gadget.category === 'MicArm') {
        armAffectedCount = detached.affectedTargetIds.length
      } else if (gadget.category === 'Monitor' || gadget.category === 'Microphone') {
        const microphone = gadget.category === 'Microphone'
        const assignments = microphone ? p.micArmAssignments : p.monitorArmAssignments
        const cableType = microphone ? 'MicArm' : 'MonitorArm'
        const explicitlyMounted = typeof assignments?.[gadget.id] === 'string'
        const hasSupportLine = (p.connectionMap?.connections ?? []).some((connection) =>
          connection.cableType === cableType
          && (connection.fromGadgetId === gadget.id || connection.toGadgetId === gadget.id))
        armAffectedCount = explicitlyMounted || hasSupportLine ? 1 : 0
      }
      return {
        ...updateDeskGadgetSelection(
          p,
          p.selectedGadgetIds.filter((id) => id !== gadget.id),
          gadgets,
        ),
        monitorArmAssignments: detached.monitorArmAssignments,
        micArmAssignments: detached.micArmAssignments,
        updatedAt: new Date().toISOString(),
      }
    })
    hapticWarning()
    undoSnackbar.showUndo({
      message: (gadget.category === 'MonitorArm' || gadget.category === 'MicArm') && armAffectedCount > 0
        ? (lang === 'en'
            ? `Removed the arm; ${armAffectedCount} ${gadget.category === 'MicArm' ? 'microphone' : 'monitor'}${armAffectedCount === 1 ? '' : 's'} now use stands`
            : `${gadget.category === 'MicArm' ? 'マイク' : 'モニター'}アームを外し、${gadget.category === 'MicArm' ? 'マイク' : 'モニター'}${armAffectedCount}台をスタンド使用に変更しました`)
        : (gadget.category === 'Monitor' || gadget.category === 'Microphone') && armAffectedCount > 0
          ? (lang === 'en'
              ? `Removed "${gadgetTitle(gadget, lang)}"; the arm remains on this desk`
              : `「${gadgetTitle(gadget, lang)}」を外しました。アームはデスクに残ります`)
          : (lang === 'en'
              ? `Removed "${gadgetTitle(gadget, lang)}" from this desk`
              : `「${gadgetTitle(gadget, lang)}」をデスクから外しました`),
      // Undo までの5秒間に自動再計算が走って配線図を保存し直すため、削除時点の plan を
      // 丸ごと書き戻すとその結果を巻き戻してしまう。戻すのは「このガジェットの選択」と
      // その操作で外したアームの割り当てだけにする
      onUndo: async () => {
        await updateWith(planId, (p) => {
          const restored = restoreArmAssignments(p.monitorArmAssignments, p.micArmAssignments, armSnapshot)
          return {
            ...updateDeskGadgetSelection(
            p,
            [...new Set([...p.selectedGadgetIds, gadget.id])],
            gadgets,
          ),
            ...restored,
            updatedAt: new Date().toISOString(),
          }
        }, { awaitPersistence: true })
      },
      // 商品名未設定の枠は、このデスクのためだけに作ったもの。外したまま確定したら、どのデスクにも
      // 属さない未設定の機材としてマイガジェットに残さず片付ける（デスクの削除と同じ扱い）。
      // 実物の無い枠なので、在籍履歴にも「外した」として残さない
      onExpire: async () => {
        const unnamed = gadget.isPlaceholder || !gadget.name.trim()
        if (!unnamed || plansRef.current.some((p) => p.selectedGadgetIds.includes(gadget.id))) return
        try {
          await updateWith(planId, (p) => {
            if (!p.gadgetUsage?.[gadget.id]) return p
            const { [gadget.id]: _removed, ...gadgetUsage } = p.gadgetUsage
            return { ...p, gadgetUsage }
          })
          await removeGadgets([gadget.id], { track: false })
        } catch (error) {
          analytics.error('remove_detached_placeholder', error)
        }
      },
    })
  }, [gadgets, lang, plan, planId, removeGadgets, undoSnackbar, updateWith])

  const flyOffAndRemoveGadget = useCallback((gadget: Gadget) => {
    if (removingGadgetIdsRef.current.has(gadget.id)) return
    removingGadgetIdsRef.current.add(gadget.id)
    void gadgetRemoval.run(gadget.id, () => removeGadgetFromPlan(gadget))
      .catch(() => Alert.alert(lang === 'ja' ? '機材を外せませんでした' : 'Could not remove gear'))
      .finally(() => removingGadgetIdsRef.current.delete(gadget.id))
  }, [gadgetRemoval, lang, removeGadgetFromPlan])

  // 右端の位置バーの寸法。ScrollView は flex:1 なので、外枠の高さがそのまま表示高になる。
  // 収納側の寸法（上部のドラッグの可動域・作り直した一覧の位置戻し）は useCollapsibleHeader へ渡す
  const handleGadgetScrollLayout = useCallback((e: LayoutChangeEvent) => {
    onGadgetLayout(e)
    const viewport = e.nativeEvent.layout.height
    setGadgetScrollBox((prev) => (Math.abs(prev.viewport - viewport) < 1 ? prev : { ...prev, viewport }))
  }, [onGadgetLayout])
  const handleGadgetContentSize = useCallback((w: number, content: number) => {
    onGadgetContentSize(w, content)
    setGadgetScrollBox((prev) => (Math.abs(prev.content - content) < 1 ? prev : { ...prev, content }))
  }, [onGadgetContentSize])
  const handleInfoScrollLayout = useCallback((e: LayoutChangeEvent) => {
    onInfoLayout(e)
    const viewport = e.nativeEvent.layout.height
    setInfoScrollBox((prev) => (Math.abs(prev.viewport - viewport) < 1 ? prev : { ...prev, viewport }))
  }, [onInfoLayout])
  const handleInfoContentSize = useCallback((w: number, content: number) => {
    onInfoContentSize(w, content)
    setInfoScrollBox((prev) => (Math.abs(prev.content - content) < 1 ? prev : { ...prev, content }))
  }, [onInfoContentSize])

  const saveProfileEdits = async () => {
    if (profileSaveInFlightRef.current) return
    if (!plan) { setProfileEditMode(false); return }
    const newName = trimAndTruncate(nameText, 30)
    if (!newName) {
      Alert.alert(lang === 'en' ? 'Name required' : 'デスクセットアップ名を入力してください')
      return
    }
    const newDescription = truncateChars(tidyMultilineText(descriptionText), DESK_DESCRIPTION_MAX_LENGTH)
    profileSaveInFlightRef.current = true
    setIsProfileSaving(true)
    try {
      await updateWith(planId, (p) => {
        const purposes = Array.from(editPurposes)
        const keepsOther = purposes.includes('other')
        return {
          ...p,
          name: newName,
          purposes,
          description: newDescription || undefined,
          // 「その他」を外したら自由な呼び名と絵も一緒に落とす。purposes だけ書き換えると
          // 画面には出ないまま share_snapshot に載り続け、公開したデスクが
          // 「もう付けていないはずの呼び名」で検索に当たる（しかも完全一致は最上位に出る）
          otherPurposeLabel: keepsOther ? trimAndTruncate(editOtherPurposeLabel, PURPOSE_NAME_MAX_LENGTH) || undefined : undefined,
          otherPurposeIcon: keepsOther ? editOtherPurposeIcon : undefined,
          otherPurposeColor: keepsOther ? p.otherPurposeColor : undefined,
          updatedAt: new Date().toISOString(),
        }
      })
      profileEditModeRef.current = false
      setProfileEditMode(false)
    } finally {
      profileSaveInFlightRef.current = false
      setIsProfileSaving(false)
    }
  }

  const handleProfileEditToggle = useCallback(() => {
    setProfileEditMode(prev => {
      const next = !prev
      profileEditModeRef.current = next
      if (next) {
        setNameText(plan?.name ?? '')
        setDescriptionText(plan?.description ?? '')
        // 用途を設定していないデスクに 'other' を差し込まない。デスク名を直しただけで
        // 「その他」が付き、検索の「その他」「カスタム」に当たるようになっていた
        setEditPurposes(new Set(plan?.purposes ?? []))
        setEditOtherPurposeLabel(truncateChars(plan?.otherPurposeLabel ?? '', PURPOSE_NAME_MAX_LENGTH))
        setEditOtherPurposeIcon(purposeIcon('other', plan?.otherPurposeIcon))
      }
      return next
    })
  }, [plan])

  // saveProfileEdits は入力中の名前を閉じ込めるので毎レンダー作り直される。
  // それを依存に入れると打鍵ごとに headerRight が差し替わり、iOS がバーを取り直してボタンが動いて見える
  const onHeaderEditPressRef = useRef<() => void>(() => {})
  const coach = useCoachMarks()
  const { open: openCoach, target: coachTarget } = coach
  const tabRef = useRef(tab)
  tabRef.current = tab
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const openHelp = useCallback(() => {
    const current = tabRef.current
    const own = !readOnlyRef.current
    void openCoach([
      ...(own ? DESK_OWNER_TOP_COACH : DESK_PHOTO_COACH),
      ...DESK_TABS_COACH,
      ...(current === 'wiring' ? DESK_WIRING_COACH.filter(step => own ? step.target !== 'history-play' : !['map-add', 'map-edit'].includes(step.target ?? '')) : current === 'info' ? INSIGHTS_COACH : DESK_GADGETS_COACH.filter((step) => own || !['desk-gadget-add', 'desk-gadget-row-edit'].includes(step.target ?? ''))),
      ...(own ? DESK_OWNER_FOOTER_COACH : []),
    ])
  }, [openCoach])
  const helpAvailable = !!plan && !!result
  onHeaderEditPressRef.current = () => {
    if (isProfileSaving) return
    profileEditMode ? void saveProfileEdits() : handleProfileEditToggle()
  }

  // useEffect だと描画のあとに走るため、ボタンの無いヘッダーが一度描かれてから customView が挿し込まれる
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderButtonGroup>
        {!readOnly && plan && <HeaderIconButton
          name={plan.favorite ? 'pin' : 'pin-outline'}
          color={plan.favorite ? colors.accentText : colors.text}
          onPress={() => {
            hapticSelection()
            void togglePinned(planId).catch(() => Alert.alert(lang === 'ja' ? 'ピン留めを変更できませんでした' : 'Could not update pin'))
          }}
          accessibilityLabel={t(plan.favorite ? 'a11y.pinOff' : 'a11y.pinOn')}
        />}
        {!readOnly && <HeaderIconButton
          buttonRef={coachTarget('desk-edit')}
          name={profileEditMode ? ICONS.check : ICONS.edit}
          color={profileEditMode ? colors.accentText : colors.text}
          onPress={() => onHeaderEditPressRef.current()}
          accessibilityLabel={profileEditMode
            ? (lang === 'en' ? 'Save desk details' : 'デスク情報を保存')
            : (lang === 'en' ? 'Edit desk details' : 'デスク情報を編集')}
        />}
        {helpAvailable && <HeaderIconButton
          name="help-circle-outline"
          color={colors.text}
          onPress={openHelp}
          accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'}
        />}
        </HeaderButtonGroup>
      ),
    })
  }, [navigation, readOnly, profileEditMode, colors.accentText, colors.text, lang, helpAvailable, openHelp, coachTarget, plan, planId, togglePinned, t])

  useLayoutEffect(() => {
    navigation.setOptions({ title: lang === 'en' ? 'Desk details' : 'デスク詳細' })
  }, [navigation, lang])


  if (plan && !result && recalculationError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgList }]}>
        <RetryState
          message={lang === 'en' ? 'Could not create the wiring map.' : '配線図を作成できませんでした。'}
          onRetry={() => setRecalculationAttempt((value) => value + 1)}
        />
      </SafeAreaView>
    )
  }
  if (!plan || !result) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgList }]}>
        <ActivityIndicator style={{ flex: 1 }} color={colors.accentIcon} />
      </SafeAreaView>
    )
  }

  const openGadgetAdd = () => {
    if (!navigation.isFocused()) return
    navigation.navigate('AddGadget', { planId, showCategoryPicker: true })
  }

  const openReplacement = (gadget: Gadget) => {
    wiringSwipeRefs.current.get(gadget.id)?.close()
    replacementAwaitingNewRef.current = null
    setReplacementSourceId(gadget.id)
    setReplacementTargetId(null)
    setReplacementDate(formatDate(new Date(), lang))
    setReplacementPrice('')
    setReplacementInheritSupportArm(true)
    setReplacementInheritRelations(true)
    setReplacementVisible(true)
    hapticSelection()
  }

  const closeReplacement = () => {
    replacementAwaitingNewRef.current = null
    setReplacementVisible(false)
    setReplacementSourceId(null)
    setReplacementTargetId(null)
    setReplacementPrice('')
    setReplacementInheritSupportArm(true)
    setReplacementInheritRelations(true)
  }

  const registerReplacement = () => {
    if (!replacementSource) return
    replacementKnownIdsRef.current = new Set(gadgets.map((gadget) => gadget.id))
    replacementAwaitingNewRef.current = replacementSource.id
    setReplacementVisible(false)
    navigation.navigate('AddGadget', {
      category: replacementSource.category,
      libraryOnly: true,
      returnAfterAdd: true,
    })
  }

  const confirmReplacement = async () => {
    if (!replacementSource || !replacementTarget || !parsedReplacementDate || replacementDateError || replacementPriceError || replacementSaving) return
    const targetRecord = gadgets.find((gadget) => gadget.id === replacementTarget.id)
    if (!targetRecord) return
    const nextPrice = replacementPrice.trim() ? parsedReplacementPrice : undefined
    const updatedTarget = { ...targetRecord, price: nextPrice }
    const priceChanged = targetRecord.price !== nextPrice
    let priceSaved = false
    setReplacementSaving(true)
    try {
      if (priceChanged) {
        await updateGadget(updatedTarget)
        priceSaved = true
      }
      const replacementGadgets = priceChanged
        ? gadgets.map((gadget) => gadget.id === updatedTarget.id ? updatedTarget : gadget)
        : gadgets
      evictPlanLayoutCache(planId)
      await updateWith(planId, (current) => {
        const replaced = replaceDeskGadget(
          current,
          replacementSource.id,
          replacementTarget.id,
          replacementGadgets,
          parsedReplacementDate,
          replacementSource.category === 'Monitor'
            ? { monitorArmAssignment: replacementSupportArm && replacementInheritSupportArm ? replacementSupportArm.id : null, inheritRelations: replacementInheritRelations }
            : replacementSource.category === 'Microphone'
              ? { micArmAssignment: replacementSupportArm && replacementInheritSupportArm ? replacementSupportArm.id : null, inheritRelations: replacementInheritRelations }
              : { inheritRelations: replacementInheritRelations },
        )
        return refreshPlanWiring({ ...replaced, updatedAt: new Date().toISOString() }, replacementGadgets, lang).plan
      })
      hapticSuccess()
      setSavedToast(lang === 'en'
        ? `Replaced with “${gadgetTitle(replacementTarget, lang)}”`
        : `「${gadgetTitle(replacementTarget, lang)}」に交換しました`)
      closeReplacement()
    } catch {
      if (priceSaved) {
        try {
          await updateGadget(targetRecord)
        } catch (rollbackError) {
          analytics.error('replacement_price_rollback', rollbackError)
        }
      }
      hapticError()
      Alert.alert(
        lang === 'en' ? 'Could not replace gadget' : '商品を交換できませんでした',
        lang === 'en' ? 'Please try again.' : 'もう一度お試しください。',
      )
    } finally {
      setReplacementSaving(false)
    }
  }

  const recommendedIds = favoriteGadgetIdSet(plan)
  const toggleFavorite = (gadget: Gadget) => {
    wiringSwipeRefs.current.get(gadget.id)?.close()
    void toggleGadgetFavorite(gadget.id).then((updated) => {
      if (updated && !updated.favorite) undoSnackbar.showUndo({
        message: lang === 'ja' ? `「${gadgetTitle(updated, lang)}」のお気に入りを解除しました` : `Removed "${gadgetTitle(updated, lang)}" from favorites`,
        onUndo: () => setFavorite(updated.id, true),
      })
    }).catch(() => Alert.alert(lang === 'ja' ? 'お気に入りを変更できませんでした' : 'Could not update favorite'))
  }
  const toggleRecommended = (gadget: Gadget) => {
    void updateWith(planId, (prev) => ({ ...toggleFavoriteGadget(prev, gadget.id), updatedAt: new Date().toISOString() }))
      .catch(() => Alert.alert(lang === 'ja' ? 'おすすめを変更できませんでした' : 'Could not update recommendation'))
  }

  const renderReplacementActions = (gadget: Gadget) => (
    <View style={styles.gadgetSwipeActions}>
      <TouchableOpacity
        style={[styles.gadgetSwipeButton, { backgroundColor: colors.accent }]}
        onPress={() => openReplacement(gadget)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={lang === 'en' ? `Replace ${gadgetTitle(gadget, lang)}` : `${gadgetTitle(gadget, lang)}を交換`}
      >
        <AppIcon name="swap-horizontal" size={20} color={colors.onAccent} />
        <Text style={[styles.gadgetSwipeLabel, { color: colors.onAccent }]}>{lang === 'en' ? 'Replace' : '交換'}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.gadgetSwipeButton, { backgroundColor: UI_STATUS_COLORS.warning }]}
        onPress={() => flyOffAndRemoveGadget(gadget)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={lang === 'en' ? `Remove ${gadgetTitle(gadget, lang)} from this desk` : `${gadgetTitle(gadget, lang)}をこのデスクから外す`}
      >
        <AppIcon name={ICONS.retire} size={20} color={UI_STATUS_ON_WARNING} />
        <Text style={[styles.gadgetSwipeLabel, { color: UI_STATUS_ON_WARNING }]}>{lang === 'en' ? 'Remove' : '外す'}</Text>
      </TouchableOpacity>
    </View>
  )

  const handleShare = async () => {
    if (!user) {
      promptLogin(navigation, lang, lang === 'ja' ? '公開・共有するにはログインしてください' : 'Please log in to publish or share.')
      return
    }
    // 公開中のときだけ、そのままリンクを見せる。
    // 非公開に戻したデスクは URL を開いても見られないので、公開し直す確認から始める
    if (publishedDeskId && (publishedVisibility === 'public' || publishedVisibility === 'unlisted')) {
      setPublishState('done')
      setPublishModalVisible(true)
      return
    }
    if (!plan) return
    const gadgetIssue = publishGadgetIssue(plan, gadgets)
    if (gadgetIssue) {
      promptGadgetIssue('publish', gadgetIssue)
      return
    }
    if ((plan.images?.length ?? 0) < 1) {
      promptPhotoRequired(lang, 'publish', () => navigation.navigate('PhotoFill', { planId }))
      return
    }
    // 公開はURLを知る誰もが閲覧できる状態にする操作なので、必ず本人の同意を取る。
    // 確認は公開シートで取る。Alert で聞いていた頃は、完成時の案内から開くシートと
    // 確認が2通りになり、何が見えるようになるかの説明も食い違っていた
    setPublishError('')
    setPublishState('idle')
    setPublishModalVisible(true)
  }

  // 公開内容が古いときは、更新するか本人が選べる公開シートへ進める。
  // 見え方の切り替え・取り消しはフッターの「公開中・リンクと設定」から公開シートで行う
  const sharePublicLink = () => {
    if (!plan || !publishedDeskId) return
    void shareDesk({
      deskId: publishedDeskId,
      deskName: plan.name,
      ownerTag: ownShareTag(profile),
      totalPrice: sumGadgetPrices(selectedGadgets),
      deviceCount: selectedQuantity,
      photoUris: plan.images,
    }, lang).catch(() => {})
  }
  const handleShareIcon = () => {
    if (canUpdatePublicPage && publishedDeskId && !isOutdatedPublishState(planPublishState)) {
      sharePublicLink()
      return
    }
    void handleShare()
  }

  const finishCompletionPrompt = () => {
    setCompletionPromptVisible(false)
    void markDeskCompletionPromptSeen(planId)
  }

  const openCompletionPublish = () => {
    if (!user) {
      promptLogin(navigation, lang, lang === 'ja' ? '公開するにはログインしてください' : 'Please log in to publish.')
      return
    }
    finishCompletionPrompt()
    // 確認シートの「公開する」を押してから写真不足を知らせると、同意したあとで止められる
    const gadgetIssue = publishGadgetIssue(plan, gadgets)
    if (gadgetIssue) {
      promptGadgetIssue('publish', gadgetIssue)
      return
    }
    if ((plan.images?.length ?? 0) < 1) {
      promptPhotoRequired(lang, 'publish', () => navigation.navigate('PhotoFill', { planId }))
      return
    }
    setPublishError('')
    setPublishState('idle')
    setPublishModalVisible(true)
  }

  /**
   * フッターの主ボタン。編集はすべて即時保存されるので「保存」は要らず、
   * この枠に残る唯一の未了作業は「公開ページが手元の内容と食い違っている」こと。
   *
   * 塗り（tone: 'primary'）にするのは、本人がやりかけて終わっていない作業だけに絞る。
   * 一度も公開していないデスクの「公開」と、自分で止めた非公開デスクの「再公開」は、
   * どちらもこちらから勧める筋合いのものではない（特に再公開は、隠すと決めたものを
   * 一番目立つボタンで戻そうとすることになり、誤タップの結果が公開になる）。
   */
  const publishPrimary: {
    label: string
    icon: MCIconName
    tone: 'primary' | 'secondary'
    enabled: boolean
    busy: boolean
    onPress: () => void
  } =
    isOutdatedPublishState(planPublishState)
      ? {
          label: lang === 'ja' ? '公開ページを更新' : 'Update public page',
          icon: 'cloud-upload-outline',
          tone: 'primary',
          enabled: true,
          busy: isUpdating,
          onPress: () => { nameGate.run(() => { void handleUpdate() }) },
        }
      : planPublishState === 'public' || planPublishState === 'unlisted'
        ? {
            // 内容が一致している間の枠は、押しても何も起きないボタンで潰さずに
            // 公開シート（リンクのコピー・SNS共有・見え方の切り替え・公開の取り消し）の入口にする。
            // 古くなればこの枠が「公開ページを更新」に変わるので、最新であることをここで言う必要はない
            label: planPublishState === 'unlisted'
              ? (lang === 'ja' ? 'URL限定で公開中・リンクと設定' : 'Unlisted · Link & settings')
              : (lang === 'ja' ? '公開中・リンクと設定' : 'Public · Link & settings'),
            icon: planPublishState === 'unlisted' ? ICONS.link : ICONS.publish,
            tone: 'secondary',
            enabled: true,
            busy: publishState === 'loading',
            onPress: () => { void handleShare() },
          }
        : planPublishState === 'private'
          ? {
              label: lang === 'ja' ? 'このデスクを再公開' : 'Re-publish this desk',
              icon: ICONS.publish,
              // 塗り。枠線ボタンの文字（accentText）は白い面の上で茶色に見える
              tone: 'primary',
              enabled: true,
              busy: publishState === 'loading',
              onPress: () => { void handleShare() },
            }
          : {
              label: lang === 'ja' ? 'このデスクを公開' : 'Publish this desk',
              icon: ICONS.publish,
              tone: 'primary',
              enabled: true,
              busy: publishState === 'loading',
              onPress: () => { void handleShare() },
            }

  const images = plan.images ?? []
  // 上限に当たったときの見せ方は無料と Pro で別物。すでに払っている人に
  // 「Proにすると増えます」を出すと、案内ではなく誤作動に見える。
  // 読み込み中を Pro 扱いにするのは maxPhotos と同じ理由
  const photoLimitIsUpsell = !isPro && !billingLoading
  const atPhotoLimit = images.length >= maxPhotos
  // 上限に当たったことは Pro にも伝える。枚数の案内カードとして最後に1枚挟む
  const previewSlides: Array<string | '__photoLimit__'> = atPhotoLimit
    ? [...images, '__photoLimit__']
    : [...images]

  // 払っている人を課金画面へ送らない。代わりに入れ替え方を伝える
  const notifyPhotoLimit = () => {
    Alert.alert(
      lang === 'ja' ? '写真は' + maxPhotos + '枚までです' : 'Up to ' + maxPhotos + ' photos',
      lang === 'ja'
        ? '別の写真を入れるには、いらない写真を削除してください。'
        : 'Delete a photo you no longer need to add a different one.',
    )
  }

  const pickImage = async () => {
    if (photoPickerInFlightRef.current) return
    if (atPhotoLimit) {
      if (!photoLimitIsUpsell) { notifyPhotoLimit(); return }
      trackLimitHit('maxPhotosPerDesk', { current: images.length, max: maxPhotos, placement: 'photo_picker' })
      openPaywall(navigation, 'maxPhotosPerDesk')
      return
    }
    photoPickerInFlightRef.current = true
    setPickingPhotos(true)
    try {
      const result = await pickPlanPhotos({
        planId,
        existing: images,
        limit: maxPhotos - images.length,
        maxFileSizeMB,
      })
      if (result.permissionDenied) {
        showPhotoPermissionAlert(lang)
        return
      }
      if (result.added.length > 0) {
        result.added.forEach((uri) => addedPhotoUris.current.add(uri))
        // 写真ピッカーを開いている間に自動再計算が配線図を保存し直していることがあるため、
        // 撮影時点の plan ではなく保存直前の plan に写真だけを足す
        await updateWith(planId, (p) => ({
          ...p,
          images: [...(p.images ?? []), ...result.added],
          updatedAt: new Date().toISOString(),
        }))
      }
      const skipped = planPhotoSkipMessage(result, maxFileSizeMB, lang)
      if (skipped) {
        Alert.alert(
          lang === 'en' ? 'Some photos were skipped' : '一部の写真を追加できませんでした',
          skipped,
        )
      }
    } catch (error) {
      Alert.alert(
        lang === 'ja' ? '写真を追加できませんでした' : 'Could not add photos',
        userErrorMessage(error, lang, lang === 'ja' ? 'もう一度写真を選んでお試しください。' : 'Please select the photos and try again.'),
      )
    } finally {
      photoPickerInFlightRef.current = false
      setPickingPhotos(false)
    }
  }

  const removeImage = (uri: string) => {
    Alert.alert(
      lang === 'en' ? 'Delete photo permanently?' : '写真を完全に削除しますか？',
      lang === 'en'
        ? 'This photo will be deleted from this device and cannot be restored.'
        : 'この写真は端末から削除され、元に戻せません。',
      [
        { text: lang === 'en' ? 'Cancel' : 'キャンセル', style: 'cancel' },
        {
          text: lang === 'en' ? 'Delete' : '削除',
          style: 'destructive',
          onPress: async () => {
            await photoRemoval.run(uri, async () => {
              await deletePlanPhoto(uri)
              await updateWith(planId, (p) => ({
                ...p,
                images: (p.images ?? []).filter((u) => u !== uri),
                updatedAt: new Date().toISOString(),
              }))
              setPreviewVisibleIdx((current) => Math.max(0, Math.min(current, images.length - 2)))
            }, 'fade').catch(() => Alert.alert(lang === 'ja' ? '写真を削除できませんでした' : 'Could not delete photo'))
          },
        },
      ],
    )
  }

  // 1枚目が表紙（一覧のタイル・公開ページの大写真・共有リンクのプレビューに出る）。
  // 並べ替えの手段が無く、表紙を替えるには消して入れ直すしかなかったので、先頭へ移す口を置く。
  // 保存時点の並びに当てる（写真の追加・削除と重なっても取りこぼさない）
  const setCoverImage = (uri: string) => {
    void updateWith(planId, (p) => {
      const current = p.images ?? []
      if (!current.includes(uri) || current[0] === uri) return p
      return {
        ...p,
        images: [uri, ...current.filter((u) => u !== uri)],
        updatedAt: new Date().toISOString(),
      }
    }).then(() => {
      setPreviewVisibleIdx(0)
      setSavedToast(lang === 'ja' ? '表紙を変更しました' : 'Cover photo updated')
    }).catch((error) => {
      Alert.alert(
        lang === 'ja' ? '表紙を変更できませんでした' : 'Could not change cover photo',
        userErrorMessage(error, lang, lang === 'ja' ? 'もう一度お試しください。' : 'Please try again.'),
      )
    })
  }
  const confirmSetCover = (uri: string) => {
    Alert.alert(
      lang === 'en' ? 'Use as cover photo?' : 'この写真を表紙にしますか？',
      lang === 'en'
        ? 'The cover appears on desk lists and at the top of your public page.'
        : '表紙はデスクの一覧と、公開ページの一番上に出ます。',
      [
        { text: lang === 'en' ? 'Cancel' : 'キャンセル', style: 'cancel' },
        { text: lang === 'en' ? 'Set as cover' : '表紙にする', onPress: () => setCoverImage(uri) },
      ],
    )
  }

  // タブバーの「ガジェット」は所有機材の台帳、こちらはこのデスクの構成品で別物。
  // 同じ語を2階層で使うと区別が付かないため、デスクの中では「機材」と呼ぶ
  const TABS: { id: Tab; ja: string; en: string }[] = [
    { id: 'gadgets',  ja: '機材', en: 'Gear' },
    { id: 'wiring',   ja: '配線', en: 'Wiring' },
    { id: 'info',     ja: '履歴・分析', en: 'Insights' },
  ]

  const C = colors

  // ═════════════════════════════════════════════════════════════
  // 描画（ヘッダー折りたたみアニメーション → JSX）
  // ═════════════════════════════════════════════════════════════
  // 収納は「タブバー以下が上へスライドしてヘッダーの下半分を覆う」形。ずらすのは
  // CollapsibleTabContent の1枚だけで、ペインは収納量ぶん背を高くしておく（paneExtension）
  const shiftedContent = {
    flex: 1,
    backgroundColor: C.card,
    ...paneExtension,
  }

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.container, { backgroundColor: C.card }]}>
    <CoachScope coach={coach}>
      {readOnly && (
        <View style={[styles.readOnlyBanner, { backgroundColor: C.chip, borderBottomColor: C.border }]}>
          <AppIcon name="eye-outline" size={17} color={C.textMuted} />
          <Text style={[styles.readOnlyBannerText, { color: C.textMuted }]}>
            {lang === 'en' ? 'Read only · This shared desk cannot be edited' : '閲覧専用・共有されたデスクは編集できません'}
          </Text>
        </View>
      )}
      {profileEditMode && (
        <View style={[styles.editingBanner, { backgroundColor: C.accent + '18', borderBottomColor: C.accent + '55' }]}>
          <AppIcon name={ICONS.edit} size={16} color={C.accentIcon} />
          <Text style={[styles.editingBannerText, { color: C.accentText }]}>
            {isProfileSaving
              ? (lang === 'en' ? 'Saving changes…' : '変更を保存中…')
              : (lang === 'en' ? 'Editing desk · Tap ✓ to save' : 'デスクを編集中・✓で保存')}
          </Text>
        </View>
      )}
      {recalculationError && (
        <TouchableOpacity
          style={{ minHeight: UI_METRICS.touchMinSize, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderBottomWidth: 1, borderColor: C.danger }}
          onPress={() => setRecalculationAttempt((value) => value + 1)}
          accessibilityRole="button"
          accessibilityLabel={lang === 'en' ? 'Wiring update failed. Try again' : '配線の更新に失敗しました。もう一度試す'}
        >
          <AppIcon name="alert-circle-outline" size={17} color={C.danger} />
          <Text style={[styles.reflectionBannerText, { color: C.danger }]}>
            {lang === 'en' ? 'Could not update wiring · Tap to retry' : '配線を更新できませんでした・タップして再試行'}
          </Text>
        </TouchableOpacity>
      )}
      {(isReflecting || isRecalculating) && (
        <View style={[styles.reflectionBanner, { backgroundColor: C.card, borderColor: C.border }]} pointerEvents="none">
          <ActivityIndicator size="small" color={C.accentIcon} />
          <Text style={[styles.reflectionBannerText, { color: C.textSub }]}>
            {lang === 'en' ? 'Applying changes…' : '変更を反映中…'}
          </Text>
        </View>
      )}
      {/* ─── プロフィールヘッダー ─── */}
      <KeyboardAvoidingView
        style={styles.keyboardArea}
        enabled={profileEditMode}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight}
      >
      <ScrollView
        ref={profileScrollRef}
        style={[styles.profileScroll, { flexShrink: profileEditMode ? 1 : 0 }]}
        scrollEnabled={profileEditMode}
        bounces={profileEditMode}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
      {/* 縦のドラッグは今のタブの一覧へ渡す（headerPan の注記） */}
      <GestureDetector gesture={headerPan}>
      <Pressable
        onPress={handleHeaderDoubleTap}
        // 編集中以外は収納後に残る行が無い。枠の余白を枠に置くと、畳んだときタブの上に
        // 空の帯として残るので、余白は収納ブロック側（下）に持たせる
        style={[styles.summaryCard, { backgroundColor: C.card }, !profileEditMode && styles.summaryCardBare, headerContainerStyle]}
      >
        {/* 編集中の名前の入力欄。通常時の名前は収納ブロックの先頭の見出しが持つ。
            公開の状態はフッターの公開ボタン、更新日は用途アイコンの行の右端に表示する */}
        {profileEditMode && (
          <View style={styles.profilePrimaryRow}>
            <View style={styles.deskTitleColumn}>
              <TextField
                size="title"
                appearance="underline"
                accentColor={C.accent}
                value={nameText}
                onChangeText={setNameText}
                onFocus={() => requestAnimationFrame(revealProfileInput)}
                onSubmitEditing={saveProfileEdits}
                maxLength={30}
                returnKeyType="done"
                placeholder={lang === 'en' ? 'e.g. My work and gaming desk' : '例：仕事とゲームのデスク'}
                autoFocus
                accessibilityLabel={lang === 'en' ? 'Desk setup name' : 'デスクセットアップ名'}
              />
              <View style={styles.profilePurposeRow}>
                {PURPOSE_DEFS.filter((def) => editPurposes.has(def.key)).map((def) => {
                  const purposeColor = purposeIconColor(def.key, isDark, plan.otherPurposeColor)
                  return (
                    <RemovalLayout key={def.key} style={styles.purposeIconWrap}>
                    <RemovalMotion ref={(handle) => purposeRemoval.setRef(def.key, handle)} collapse={false}>
                      <View
                        style={[styles.profilePurposeIcon, { backgroundColor: purposeColor + '20', borderColor: purposeColor + '40' }]}
                        accessible
                        accessibilityLabel={purposeLabel(def.key, lang, editOtherPurposeLabel)}
                      >
                        <AppIcon name={purposeIcon(def.key, editOtherPurposeIcon)} size={20} color={purposeColor} centered />
                      </View>
                      {editPurposes.size > 1 && (
                        <IconCircleButton
                          name={ICONS.close}
                          diameter={16}
                          size={9}
                          color="#fff"
                          background={C.danger}
                          style={styles.purposeIconDelete}
                          onPress={(event) => {
                            event.stopPropagation()
                            void purposeRemoval.run(def.key, () => setEditPurposes((prev) => {
                              const next = new Set(prev)
                              next.delete(def.key)
                              return next
                            }), 'fade')
                          }}
                          hitSlop={14}
                          accessibilityLabel={lang === 'en' ? `Remove ${purposeLabel(def.key, 'en', editOtherPurposeLabel)}` : `${purposeLabel(def.key, 'ja', editOtherPurposeLabel)}を外す`}
                          accessibilityHint={lang === 'en' ? 'Removes this use from the desk' : 'この使い方をデスクから外します'}
                        />
                      )}
                    </RemovalMotion>
                    </RemovalLayout>
                  )
                })}
                <TouchableOpacity
                  style={[styles.profilePurposeAdd, { borderColor: C.border, backgroundColor: C.chip }]}
                  onPress={(event) => {
                    event.stopPropagation()
                    Keyboard.dismiss()
                    setEditPurposesVisible(true)
                  }}
                  activeOpacity={0.7}
                  hitSlop={7}
                  accessibilityRole="button"
                  accessibilityLabel={lang === 'en' ? 'Choose another use' : 'デスクの用途を追加'}
                  accessibilityHint={lang === 'en' ? 'Opens the choices for how this desk is used' : 'このデスクの使い方を選ぶ画面を開きます'}
                >
                  <AppIcon name={ICONS.add} size={18} color={C.textMuted} centered />
                </TouchableOpacity>
                <Text style={[styles.deskUpdatedAt, styles.editUpdatedAt, { color: C.textMuted }]} numberOfLines={1}>
                  {fmtDate(plan.updatedAt, lang)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* ここから下（利用目的・写真）はタブバーが上へスライドして覆い隠す領域。
            覆う量をこのブロックの実測高さに合わせるため、まとめて計測する */}
        <Reanimated.View
          style={[
            styles.headerCollapsible,
            !profileEditMode && { paddingTop: plan.name ? 8 : images.length > 0 ? 0 : 16, paddingBottom: 12 },
            headerParallaxStyle,
          ]}
          onLayout={handleCollapsibleLayout}
        >
          {/* 編集中は上の入力欄が名前を持つので出さない（同じ名前が2段に並ぶ） */}
          {!profileEditMode && (
            <View style={[styles.deskTitleRow, (plan.purposes?.length ?? 0) > PURPOSE_ICONS_INLINE_MAX && styles.deskTitleRowStacked]}>
              <View style={[styles.deskTitleColumn, (plan.purposes?.length ?? 0) > PURPOSE_ICONS_INLINE_MAX && styles.deskTitleColumnStacked]}>
                <Text style={[styles.deskTitle, { color: C.text }]} numberOfLines={2} accessibilityRole="header">
                  {plan.name}
                </Text>
                <Text style={[styles.deskUpdatedAt, { color: C.textMuted }]} numberOfLines={2}>
                  {fmtDate(plan.updatedAt, lang)}
                </Text>
              </View>
              <DeskPurposeIcons plan={plan} colors={C} lang={lang} isDark={isDark} />
            </View>
          )}
          {/* 通常時は配線図と見比べやすい全幅16:9カルーセル。追加・削除は編集時だけ表示する */}
          {!profileEditMode && images.length > 0 && (
            <View ref={coachTarget('desk-photo')} style={styles.photoCarouselFullBleed}>
              <DeskPhotoCarousel
                photos={images}
                addedPhotos={addedPhotoUris.current}
                onPhotoEntered={(uri) => { addedPhotoUris.current.delete(uri) }}
                motionActive={previewIndex === null}
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

          {/* 自分のデスクでは名前・アイコンの段を出さない（どのデスクでも同じ自分が並ぶだけだった）。
              プロフィールの編集は情報タブの名前とマイページから開く */}
          {!readOnly && !profileEditMode && !placementMode && historyGadgets.length > 0 && (
            <View style={[styles.ownerContextRow, images.length > 0 && { marginTop: 10 }]}>
              <View ref={coachTarget('history-play')} collapsable={false}>
                <DeskHistoryEntryCard
                  compact
                  iconOnly
                  plan={plan}
                  gadgets={historyGadgets}
                  colors={C}
                  lang={lang}
                  onRequirePro={() => {
                    trackLimitHit('historyAnimationYears', {
                      max: PLAN_LIMITS[isPro ? 'pro' : 'free'].historyAnimationYears,
                      placement: 'wiring_result_history',
                    })
                    openPaywall(navigation, 'historyAnimation')
                  }}
                  onShare={canUpdatePublicPage && publishedDeskId ? sharePublicLink : undefined}
                />
              </View>
            </View>
          )}
          {profileEditMode && (
            <View>
              <Text style={[styles.editHint, { color: C.textMuted }]}>
                {lang === 'ja' ? `写真 ${images.length} / ${maxPhotos}枚 · 写真の変更はすぐに保存されます` : `Photos ${images.length} / ${maxPhotos} · Photo changes save immediately`}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStripContent} style={styles.photoStrip} keyboardShouldPersistTaps="handled">
                {images.map((uri, index) => (
                  <AdditionMotion key={uri} added={addedPhotoUris.current.has(uri)} active={previewIndex === null} onEntered={() => { addedPhotoUris.current.delete(uri) }} style={styles.photoStripItem}>
                  <RemovalMotion ref={(handle) => photoRemoval.setRef(uri, handle)} collapse={false}>
                  <View style={styles.photoStripCell}>
                  <TouchableOpacity
                    style={styles.photoStripCell}
                    onPressIn={() => { longPressedPhotoRef.current = null }}
                    onPress={(event) => {
                      event.stopPropagation()
                      if (longPressedPhotoRef.current === uri) {
                        longPressedPhotoRef.current = null
                        return
                      }
                      setPreviewVisibleIdx(index)
                      setPreviewIndex(index)
                    }}
                    onLongPress={!readOnly && index > 0 ? () => {
                      longPressedPhotoRef.current = uri
                      hapticMedium()
                      confirmSetCover(uri)
                    } : undefined}
                    delayLongPress={PRESS_INTERACTION.longPressDelay}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={index === 0
                      ? (lang === 'en' ? `Open photo 1 (cover)` : `1枚目（表紙）の写真を開く`)
                      : (lang === 'en' ? `Open photo ${index + 1}` : `${index + 1}枚目の写真を開く`)}
                    accessibilityHint={lang === 'en' ? 'Shows the photo full screen' : '写真を画面いっぱいに表示します'}
                    // 長押しは見つけにくく、VoiceOver からは届かないので操作としても出す
                    accessibilityActions={!readOnly && index > 0 ? [{ name: 'setCover', label: lang === 'en' ? 'Set as cover' : '表紙にする' }] : undefined}
                    onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'setCover') setCoverImage(uri) }}
                  >
                    <LocalThumb uri={uri} style={styles.photoStripThumb} />
                  </TouchableOpacity>
                    {profileEditMode && (
                      <IconCircleButton
                        name={ICONS.close}
                        diameter={36}
                        size={18}
                        color="#fff"
                        background="rgba(0,0,0,0.55)"
                        style={styles.photoStripDelete}
                        onPress={(event) => {
                          event.stopPropagation()
                          removeImage(uri)
                        }}
                        hitSlop={4}
                        accessibilityLabel={lang === 'en' ? `Delete photo ${index + 1}` : `${index + 1}枚目の写真を削除`}
                        accessibilityHint={lang === 'en' ? 'Permanently removes this photo after confirmation' : '確認後、この写真を元に戻せない形で削除します'}
                      />
                    )}
                  </View>
                  {index === 0 ? (
                    <View style={styles.photoCoverAction}>
                      <Text style={[styles.photoActionText, { color: C.textMuted }]}>{lang === 'ja' ? '表紙' : 'Cover'}</Text>
                    </View>
                  ) : !readOnly && (
                    <TouchableOpacity
                      style={styles.photoCoverAction}
                      onPress={() => confirmSetCover(uri)}
                      accessibilityRole="button"
                      accessibilityLabel={lang === 'ja' ? `${index + 1}枚目の写真を表紙にする` : `Use photo ${index + 1} as cover`}
                    >
                      <Text style={[styles.photoActionText, { color: C.accentIcon }]}>{lang === 'ja' ? '表紙にする' : 'Set cover'}</Text>
                    </TouchableOpacity>
                  )}
                  </RemovalMotion>
                  </AdditionMotion>
                ))}
                {/* 追加は写真の右隣。並んでいる写真の続きに置くことで「ここに足される」が
                    そのまま位置で分かる。上限まで入れると横へスクロールしないと届かないが、
                    そのときこの枠は追加ではなく上限の案内に変わる */}
                {images.length < maxPhotos ? (
                  <TouchableOpacity
                    style={[styles.photoStripAdd, { borderColor: C.border, backgroundColor: C.chip, opacity: pickingPhotos ? 0.55 : 1 }]}
                    onPress={(event) => {
                      event.stopPropagation()
                      void pickImage()
                    }}
                    activeOpacity={0.7}
                    disabled={pickingPhotos}
                    accessibilityRole="button"
                    accessibilityLabel={lang === 'en' ? 'Add photos' : '写真を追加'}
                    accessibilityHint={lang === 'en' ? 'Selects one or more photos from your device' : '端末から写真を1枚または複数枚選べます'}
                  >
                    {pickingPhotos
                      ? <ActivityIndicator size="small" color={C.textMuted} />
                      : <AppIcon name={ICONS.photo} size={20} color={C.textMuted} />}
                    <Text style={[styles.photoActionText, { color: C.textMuted }]}>
                      {pickingPhotos ? (lang === 'ja' ? '追加中…' : 'Adding…') : (lang === 'ja' ? '追加' : 'Add')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.photoStripAdd, photoLimitIsUpsell
                      ? { borderColor: C.accentIcon, backgroundColor: C.accent + '18' }
                      : { borderColor: C.border, backgroundColor: C.chip }]}
                    onPress={(event) => {
                      event.stopPropagation()
                      if (!photoLimitIsUpsell) { notifyPhotoLimit(); return }
                      trackLimitHit('maxPhotosPerDesk', { current: images.length, max: maxPhotos, placement: 'photo_strip' })
                      openPaywall(navigation, 'maxPhotosPerDesk')
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={photoLimitIsUpsell
                      ? (lang === 'en' ? 'Add more photos' : 'さらに写真を追加')
                      : (lang === 'en' ? 'Photo limit reached' : '写真は上限まで登録済み')}
                    accessibilityHint={photoLimitIsUpsell
                      ? (lang === 'en' ? 'Shows options that allow more photos' : '写真をさらに登録できるプランを確認します')
                      : (lang === 'en' ? 'Explains how to swap a photo' : '写真を入れ替える方法を説明します')}
                  >
                    <AppIcon
                      name={photoLimitIsUpsell ? 'crown-outline' : ICONS.photos}
                      size={20}
                      color={photoLimitIsUpsell ? C.pro : C.textMuted}
                    />
                  </TouchableOpacity>
                )}
              </ScrollView>
            </View>
          )}

          {/* ひとことは写真・プロフィールの下。公開ページ（PublicDeskScreen）と同じ位置・同じ畳み方 */}
          {profileEditMode ? (
            <View>
              <TextInput
                style={[styles.descriptionInput, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text }]}
                value={descriptionText}
                onChangeText={(text) => setDescriptionText(truncateChars(text, DESK_DESCRIPTION_MAX_LENGTH))}
                onFocus={() => requestAnimationFrame(revealProfileInput)}
                maxLength={inputMaxLength(descriptionText, DESK_DESCRIPTION_MAX_LENGTH)}
                multiline
                textAlignVertical="top"
                placeholder={descriptionPlaceholder}
                placeholderTextColor={C.textMuted}
                editable={!isProfileSaving}
                accessibilityLabel={lang === 'en' ? 'A few words about this desk' : 'デスクのひとこと'}
              />
              <Text style={[styles.descriptionCount, { color: C.textMuted }]}>
                {descriptionText.length}/{DESK_DESCRIPTION_MAX_LENGTH}
              </Text>
            </View>
          ) : !!plan.description?.trim() && (
            <DeskDescription text={plan.description.trim()} lang={lang} colors={C} style={styles.deskDescription} />
          )}

          <View style={styles.profileSecondary}>
            {profileEditMode && (
              <Text style={[styles.editHint, { color: C.textMuted }]}>
                {lang === 'en'
                  ? 'Save name, purposes and notes with ✓. Use Set cover below a photo to change the cover. Notes become public when published.'
                  : '名前・用途・ひとことは✓で保存。写真の下の「表紙にする」で表紙を変更できます。ひとことは公開されます。'}
              </Text>
            )}
          </View>
        </Reanimated.View>
      </Pressable>
      </GestureDetector>
      </ScrollView>

     {/* ─── タブバー ─── */}
      {/* ここから下がヘッダーの収納量ぶん上へスライドし、利用目的・写真を覆って隠す */}
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
            ref={tb.id === 'wiring' ? wiringTabTargetRef : undefined}
            style={styles.tab}
            onPress={() => {
              // 同じタブを押し直したときは鳴らさない（何も起きていないので）
              if (tab !== tb.id) hapticSelection()
              setTab(tb.id)
              if (tb.id === 'info') setStatsAnimVersion((v) => v + 1)
              if (tb.id === 'wiring' && tourRunning && SPOTLIGHT_STEPS[tourStepIndex]?.key === 'view-wiring') {
                nextTourStep()
              }
            }}
            accessibilityRole="tab"
            accessibilityLabel={lang === 'en' ? tb.en : tb.ja}
            accessibilityState={{ selected: tab === tb.id }}
          >
            {/* 選択中は text。下の下線（accent）が選択を示しているので、文字まで
                オレンジにする必要が無い。白い面の上の accentText は 4.5:1 を満たす
                ために暗く、茶色に見える。SearchScopeTabs / ReactionScopeSwitch も text */}
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
      {/* 枠とずらし方は CollapsibleTabContent の注記（デスク詳細と同じ部品） */}
      <CollapsibleTabContent collapseH={collapseH} shiftStyle={headerShiftStyle} captureTouch={captureTouchDuringFling}>
      {/* ConnectionMap がまだマウントされていない間のローディング（マウント後は下の
          オーバーレイが引き継ぐので、切替時に一瞬の空白が生じない）。 */}
      {tab === 'wiring' && !mapMounted && !mapReady && (
        <View style={[shiftedContent, { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bgList }]}>
          <ActivityIndicator size="large" color={C.accentIcon} />
          <Text style={{ color: C.accentText, fontSize: 13, fontWeight: '700' }}>
            {lang === 'en' ? 'Building wiring map…' : '配線図を作成中…'}
          </Text>
        </View>
      )}
      {/* 一度マウントしたら非表示でも保持：タブ切り替えは display の切替だけで即時 */}
      {/* 非アクティブ時は pointerEvents="none"：display:none だけだと gesture-handler の
          ネイティブビューが初回だけ即座に detach されず、全画面フレームのままタッチを奪い、
          他タブの ScrollView がスクロールできなくなる（「一番最初のみ」の症状）のを防ぐ。 */}
      {mapMounted && (
        <View
          style={[shiftedContent, wiringPaneExtension, { display: tab === 'wiring' ? 'flex' : 'none' }]}
          pointerEvents={tab === 'wiring' ? 'auto' : 'none'}
        >
          <ConnectionMap
            active={tab === 'wiring'}
            onReady={handleMapReady}
            gadgets={nonCableGadgets}
            connections={plan.connectionMap?.connections ?? EMPTY_MAP_CONNECTIONS}
            plan={plan}
            readOnly={readOnly}
            onChange={handleMapChange}
            onEditCableChoice={readOnly ? undefined : () => navigation.navigate('ConnectionMethod', { planId })}
            nodeOffsets={plan.connectionMap?.nodeOffsets}
            onNodeOffsetsChange={handleNodeOffsets}
            nodeSizes={plan.connectionMap?.nodeSizes}
            onNodeSizesChange={handleNodeSizes}
            onLayoutEditStart={handleLayoutEditStart}
            onLayoutEditEnd={handleLayoutEditEnd}
            layoutRestoreRequest={layoutRestoreRequest}
            onOpenGadget={handleOpenMapGadget}
            placementMode={placementMode}
            onConfirmPlacement={handleConfirmPlacement}
            listOrder={mapListOrder}
            onResetLayout={readOnly ? undefined : handleResetLayout}
            onFitPress={hideWiringPhotoForFit}
          />
          {/* 準備完了まで配線図の上に被せるローディング（切替時の一瞬の空白を防ぐ）。 */}
          {!mapReady && (
            <View
              style={{ ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bgList }}
              pointerEvents="none"
            >
              <ActivityIndicator size="large" color={C.accentIcon} />
              <Text style={{ color: C.accentText, fontSize: 13, fontWeight: '700' }}>
                {lang === 'en' ? 'Building wiring map…' : '配線図を作成中…'}
              </Text>
            </View>
          )}
          {mapReady && !placementMode && !profileEditMode && images.length > 0 && (
            <TouchableOpacity
              ref={coachTarget('map-photo')}
              style={[styles.wiringPhotoToggle, { backgroundColor: C.card + 'E6', borderColor: C.border }]}
              // 高さ 36 なので上下に足して 44 にする（図の上に浮いていて外すと図が動く）
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={handleWiringPhotoToggle}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={wiringPhotoExpanded
                ? (lang === 'en' ? 'Hide desk photos' : 'デスク写真を隠す')
                : (lang === 'en' ? 'Show desk photos' : 'デスク写真を表示')}
              accessibilityState={{ expanded: wiringPhotoExpanded }}
            >
              <AppIcon name={ICONS.image} size={17} color={C.text} />
              <Text style={[styles.wiringPhotoToggleText, { color: C.text }]}>
                {wiringPhotoExpanded
                  ? (lang === 'en' ? 'Hide photo' : '写真を隠す')
                  : (lang === 'en' ? 'Photo' : '写真')}
              </Text>
            </TouchableOpacity>
          )}
          {/* 取り込んだ共有デスクには本人のプロフィール行を出さないため、配線図に再生ボタンを置く */}
          {readOnly && mapReady && !placementMode && historyGadgets.length > 0 && (
            <View style={[styles.wiringHistoryOverlay, readOnly && styles.wiringHistoryOverlayNoFab]} pointerEvents="box-none">
              <View ref={coachTarget('history-play')} collapsable={false}>
              <DeskHistoryEntryCard
                compact
                plan={plan}
                gadgets={historyGadgets}
                colors={C}
                lang={lang}
                readOnly={readOnly}
                onRequirePro={() => {
                  trackLimitHit('historyAnimationYears', {
                    max: PLAN_LIMITS[isPro ? 'pro' : 'free'].historyAnimationYears,
                    placement: 'wiring_result_history',
                  })
                  openPaywall(navigation, 'historyAnimation')
                }}
                // 公開ページがあるときだけ、公開シートの「SNSで共有」と同じ公開URLを送る。
                // 未公開のデスクで公開の手続きへ進めると、再生の上に公開シートを重ねることになる
                onShare={canUpdatePublicPage && publishedDeskId ? sharePublicLink : undefined}
              />
              </View>
            </View>
          )}
          {/* 配線図の断り。下端の「全体」と＋の間に置く。上に浮かせると図の下側の機材と線を隠していた。
              保存トーストと同時には出ない（保存はユーザー操作の直後で、こちらはタブを開いた直後にしか出ないため） */}
          <Toast
            visible={mapNoticeVisible && !placementMode}
            message={t('wiringResult.mapDisclaimer')}
            backgroundColor={UI_STATUS_COLORS.info}
            textColor="#FFFFFF"
            icon={ICONS.info}
            bottomOffset={16}
            style={styles.wiringNotice}
            compact
          />
        </View>
      )}

      {tab === 'gadgets' && (() => {
        const renderGadgetRow = (g: Gadget, indent = false, dragging = false) => {
          const metaPartsC = [gadgetSubNickname(g), g.isCandidate ? notOwnedBadge(g, lang) : undefined, g.purchasedAt ?? (g.introducedAtUnknown ? (lang === 'ja' ? '導入日未設定' : 'Start date not set') : undefined)].filter(Boolean).join('  ·  ')
          return (
            <RemovalMotion key={g.id} ref={(handle) => gadgetRemoval.setRef(g.id, handle)}>
              <SwipeableRow
                enabled={!dragging}
                ref={(ref) => { if (ref) wiringSwipeRefs.current.set(g.id, ref); else wiringSwipeRefs.current.delete(g.id) }}
                renderRightActions={readOnly ? undefined : () => renderReplacementActions(g)}
                {...SWIPEABLE_ROW_PROPS}
                rightThreshold={SWIPE_OPEN_THRESHOLD}
                overshootRight={false}
              >
                <TouchableOpacity
                  ref={coachTarget(readOnly ? 'desk-gadget-row' : 'desk-gadget-row-edit')}
                  disabled={dragging}
                  style={[styles.gadgetRow, indent && styles.cableItemRow, { borderBottomColor: C.border, backgroundColor: C.card }]}
                  onPress={() => setInfoGadget(g)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`${gadgetTitle(g, lang)}${g.displayOnly ? (lang === 'en' ? ', decor' : '、飾り') : ''}`}
                  accessibilityHint={readOnly ? (lang === 'en' ? 'Opens gadget details' : '機材の詳細を開きます') : (lang === 'en' ? 'Tap for details. Hold and drag to reorder.' : 'タップで詳細。長押しして上下にドラッグで並び替えます')}
                >
                  <View style={styles.gadgetInfo}>
                    <View style={styles.gadgetNameRow}>
                      <Text style={[styles.gadgetName, { color: C.text }]}>{gadgetTitle(g, lang)}{(g.quantity ?? 1) > 1 ? ` ×${g.quantity}` : ''}</Text>
                      {g.displayOnly && (
                        <View style={[styles.decorBadge, { backgroundColor: DECOR_COLOR + '22', borderColor: DECOR_COLOR }]}>
                          <Text style={[styles.decorBadgeText, { color: C.text }]}>{lang === 'en' ? 'Decor' : '飾り'}</Text>
                        </View>
                      )}
                      {g.category === 'Cable' && (g.cableCount ?? 1) > 1 && (
                        <Text style={[styles.cableItemCount, { color: C.textMuted }]}>
                          {lang === 'en' ? `${g.cableCount} pcs` : `${g.cableCount}本`}
                        </Text>
                      )}
                      <ArmMountIcon gadget={g} size={13} isDark={isDark} />
                    </View>
                    {/* 公開デスク（PublicDeskScreen）と同じ並び。左に文字の補足、右端に価格 */}
                    <View style={styles.gadgetMetaRow}>
                      {!!metaPartsC && (
                        <Text style={[styles.gadgetCat, { color: C.textMuted, flex: 1 }]} numberOfLines={1}>
                          {metaPartsC}
                        </Text>
                      )}
                      <Text style={[styles.gadgetPrice, { color: C.textMuted, marginLeft: 'auto' }]}>
                        {validGadgetPrice(g) != null ? fmtPrice((g.price ?? 0) * (g.quantity ?? 1)) : (lang === 'en' ? '$—' : '¥—')}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.gadgetRowAction}>
                    <Text style={[styles.gadgetRowActionText, { color: C.textMuted }]}>{lang === 'ja' ? '詳細' : 'Details'}</Text>
                    <AppIcon name={ICONS.chevronRight} size={18} color={C.textMuted} />
                  </View>
                </TouchableOpacity>
              </SwipeableRow>
            </RemovalMotion>
          )
        }

        const reorderProps = {
          enabled: !readOnly,
          scrollGesture: gadgetScrollGesture,
          onReorder: reorderGadgets,
          onDraggingChange: onGadgetDraggingChange,
          measureViewport: measureGadgetViewport,
          scrollBy: scrollGadgetsBy,
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
            renderRows={(items) => <ReorderableGadgetList {...reorderProps} gadgets={items} renderRow={(g, dragging) => renderGadgetRow(g, true, dragging)} />}
            collapsed={cablesCollapsed}
            onToggleCollapsed={() => setCablesCollapsed((value) => !value)}
            colors={C}
            lang={lang}
            isDark={isDark}
            t={t}
          />
        )

        // 必要ケーブル節：配線から計算した所要本数。登録ケーブル（持ち物）とは別物なので
        // 差分は取らず、隣に並べて本人が見比べられるようにするだけ
        const renderRequiredCableSection = () => {
          const catColor = CATEGORY_COLORS['Cable'] ?? '#888888'
          const renderRow = (row: { cableType: CableType; count: number }) => {
            const type = row.cableType
            const typeColor = portIconColor(type, isDark)
            return (
              <View key={`${type}-${row.count}`} style={[styles.cableTypeRow, { borderBottomColor: C.border }]}>
                <AppIcon
                  name={PORT_ICONS[type] ? PORT_ICONS[type] : 'cable-data'}
                  size={17}
                  color={typeColor}
                />
                <Text style={[styles.cableTypeName, { color: C.text }]} numberOfLines={1}>{cableLabel(type, lang)}</Text>
                <Text style={[styles.cableTypeCount, { color: C.textSub }]}>×{row.count}</Text>
              </View>
            )
          }
          return (
            <View key="required-cables" style={styles.catSection}>
              <TouchableOpacity
                style={[styles.catHeader, { backgroundColor: catColor + '18', borderLeftColor: catColor }]}
                onPress={() => setRequiredCablesOpen((prev) => !prev)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('wiringResult.requiredCables')}
                accessibilityState={{ expanded: requiredCablesOpen }}
              >
                <View style={[styles.catHeaderIcon, { backgroundColor: C.chip }]}>
                  <AppIcon name="cable-data" size={18} color={categoryIconColor('Cable', isDark)} />
                </View>
                <Text style={[styles.catHeaderName, { color: C.text }]}>{t('wiringResult.requiredCables')}</Text>
                <Text style={[styles.catHeaderCount, { color: C.textMuted }]}>
                  {lang === 'en'
                    ? `${requiredCableTotal} ${requiredCableTotal === 1 ? 'cable' : 'cables'}`
                    : `${requiredCableTotal}本`}
                </Text>
                <AppIcon name={requiredCablesOpen ? ICONS.chevronDown : ICONS.chevronRight} size={16} color={C.textMuted} />
              </TouchableOpacity>
              {requiredCablesOpen && (
                <>
                  {requiredCableGroups.wired.map(renderRow)}
                  {requiredCableGroups.charging.length > 0 && (
                    <>
                      {/* 配線図には描かれない線のぶん。常時つなぐケーブルと混ぜると
                          「図に無い線」の本数が紛れ込む */}
                      <Text style={[styles.cableGroupNote, { color: C.textMuted }]}>
                        {t('wiringResult.chargingCables')}
                      </Text>
                      {requiredCableGroups.charging.map(renderRow)}
                    </>
                  )}
                  {/* 「何本要るか」の隣に「実際にどの1本を使っているか」を置く。
                      決めた内容は公開デスクにも出るので、買う判断と同じ場所にまとめる */}
                  {!readOnly && cableChoiceProgress.total > 0 && (
                    <TouchableOpacity
                      style={[styles.cableChoiceRow, { borderTopColor: C.border }]}
                      onPress={() => navigation.navigate('ConnectionMethod', { planId })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={lang === 'en' ? "How it's connected" : 'つなぎ方'}
                    >
                      <AppIcon name="cable-data" size={16} color={C.accentIcon} />
                      <Text style={[styles.cableChoiceLabel, { color: C.accentText }]}>
                        {lang === 'en' ? "How it's connected" : 'つなぎ方を決める'}
                      </Text>
                      <Text style={[styles.cableChoiceCount, { color: C.textMuted }]}>
                        {lang === 'en'
                          ? `${cableChoiceProgress.decided} / ${cableChoiceProgress.total}`
                          : `${cableChoiceProgress.total}本中 ${cableChoiceProgress.decided}本`}
                      </Text>
                      <AppIcon name={ICONS.chevronRight} size={16} color={C.textMuted} />
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          )
        }

        return (
          <View ref={gadgetViewportRef} style={shiftedContent} onLayout={handleGadgetScrollLayout}>
          <GestureDetector gesture={gadgetScrollGesture}>
          <Reanimated.ScrollView
            scrollEnabled={!reorderingGadgets}
            ref={gadgetScrollRef}
            style={styles.tabScroll}
            // 収納用のスクロール距離は末尾に確保し、中身側の移動で相殺する。
            contentContainerStyle={[styles.tabContent, { paddingTop: 0, paddingBottom: 24 + listBottomInset + GADGET_LIST_FLOATING_INSET, minHeight: listContentMinHeight }]}
            showsVerticalScrollIndicator={false}
            onScroll={handleGadgetScroll}
            onContentSizeChange={handleGadgetContentSize}
            scrollEventThrottle={16}
          >
            <Reanimated.View style={listContentStyle}>
            {/* 登録漏れの確認（suggestions の注記）。warnings の文言と同じことを言っているが、
                あちらは表示用の文字列でどのジャンルが足りないか取り出せない */}
            {!readOnly && suggestions.length > 0 && (
              <View style={[styles.suggestionCard, { backgroundColor: C.card, borderColor: C.border }]}>
                {suggestions.map((item, index) => {
                  const categoryName = t('category.' + item.category)
                  const names = item.gadgetIds
                    .map((id) => selectedGadgets.find((g) => g.id === id))
                    .filter((g): g is Gadget => !!g)
                    .map((g) => gadgetTitle(g, lang))
                  const reasonText = item.reason === 'outlet'
                    ? (lang === 'en' ? 'Not enough free outlets' : 'コンセントの空きが足りません')
                    : item.reason === 'charger'
                      ? (lang === 'en' ? 'Some devices cannot be charged' : '充電できていない機器があります')
                      : (lang === 'en' ? 'Not enough USB ports' : 'USBの口が足りません')
                  return (
                    <View
                      key={`${item.category}-${item.reason}`}
                      style={[styles.suggestionRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border }]}
                    >
                      <View style={[styles.suggestionIcon, { backgroundColor: C.chip }]}>
                        <CategoryIcon category={item.category} size={16} color={categoryIconColor(item.category, isDark)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.suggestionTitle, { color: C.text }]}>
                          {names.length > 0 ? `${reasonText}（${names.join(lang === 'en' ? ', ' : '・')}）` : reasonText}
                        </Text>
                        <Text style={[styles.suggestionBody, { color: C.textSub }]}>
                          {lang === 'en'
                            ? `If you use a ${categoryName}, add it to include it in the map.`
                            : `使っている${categoryName}があれば、登録すると配線図に入ります。`}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.suggestionAddButton, { borderColor: C.border }]}
                        onPress={() => navigation.navigate('AddGadget', { planId, category: item.category })}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={lang === 'en' ? `Add ${categoryName}` : `${categoryName}を登録`}
                      >
                        <Text style={[styles.suggestionAddLabel, { color: C.accentText }]} numberOfLines={1}>
                          {lang === 'en' ? 'Add' : '登録'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )
                })}
                <TouchableOpacity
                  style={[styles.suggestionDismiss, { borderTopColor: C.border }]}
                  onPress={dismissSuggestions}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text style={[styles.suggestionDismissLabel, { color: C.textMuted }]}>
                    {lang === 'en' ? "Don't show for this desk" : 'このデスクでは表示しない'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            <ReorderableGadgetList {...reorderProps} gadgets={orderedGadgetRows.map(({ gadget }) => gadget)} renderRow={(g, dragging) => {
                  const mounted = orderedGadgetRows.find(({ gadget }) => gadget.id === g.id)?.mounted
                  const metaParts = [gadgetSubNickname(g), g.isCandidate ? notOwnedBadge(g, lang) : undefined, g.purchasedAt ?? (g.introducedAtUnknown ? (lang === 'ja' ? '導入日未設定' : 'Start date not set') : undefined)].filter(Boolean).join('  ·  ')
                  return (
                    <RemovalMotion key={g.id} ref={(handle) => gadgetRemoval.setRef(g.id, handle)}>
                      <FavoriteSwipeRow
                        enabled={!dragging}
                        favorite={!!g.favorite}
                        label={gadgetTitle(g, lang)}
                        onToggleFavorite={readOnly ? undefined : () => toggleFavorite(g)}
                        onRowRef={(ref) => { if (ref) wiringSwipeRefs.current.set(g.id, ref); else wiringSwipeRefs.current.delete(g.id) }}
                        renderRightActions={readOnly ? undefined : () => renderReplacementActions(g)}
                        rightThreshold={SWIPE_OPEN_THRESHOLD}
                        overshootRight={false}
                      >
                        <TouchableOpacity disabled={dragging} ref={coachTarget(readOnly ? 'desk-gadget-row' : 'desk-gadget-row-edit')} style={[styles.gadgetRow, mounted && styles.cableItemRow, { borderBottomColor: C.border, backgroundColor: C.card }]} onPress={() => setInfoGadget(g)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`${gadgetTitle(g, lang)}${!readOnly && g.favorite ? (lang === 'en' ? ', favorite' : '、お気に入り') : ''}${recommendedIds.has(g.id) ? (lang === 'en' ? ', recommended for this desk' : '、このデスクのおすすめ') : ''}${g.displayOnly ? (lang === 'en' ? ', decor' : '、飾り') : ''}${mounted ? (lang === 'en' ? ', attached to the item above' : '、上の機材に取り付け') : ''}`} accessibilityHint={readOnly ? (lang === 'en' ? 'Opens gadget details' : '機材の詳細を開きます') : (lang === 'en' ? 'Tap for details. Hold and drag to reorder.' : 'タップで詳細。長押しして上下にドラッグで並び替えます')}>
                          <View style={[styles.gadgetCatIcon, { backgroundColor: C.chip }]}>
                            <CategoryIcon category={g.category} pcFormFactor={g.pcFormFactor} customIcon={g.customCategory?.icon} size={16} color={categoryIconColor(g.category, isDark, undefined, g.customCategory?.color)} />
                          </View>
                          <View style={styles.gadgetInfo}>
                            <View style={styles.gadgetNameRow}>
                              <Text style={[styles.gadgetName, { color: C.text }]}>{gadgetTitle(g, lang)}{(g.quantity ?? 1) > 1 ? ` ×${g.quantity}` : ''}</Text>
                              {!readOnly && g.favorite && <FavoriteGadgetMark color={C.favorite} />}
                              {g.displayOnly && (
                                <View style={[styles.decorBadge, { backgroundColor: DECOR_COLOR + '22', borderColor: DECOR_COLOR }]}>
                                  <Text style={[styles.decorBadgeText, { color: C.text }]}>{lang === 'en' ? 'Decor' : '飾り'}</Text>
                                </View>
                              )}
                              <ArmMountIcon gadget={g} size={13} isDark={isDark} />
                            </View>
                            {recommendedIds.has(g.id) && <RecommendedGadgetMark color={C.accentText} lang={lang} />}
                            {/* 公開デスク（PublicDeskScreen）と同じ並び。左に文字の補足、右端に価格 */}
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
                            <Text style={[styles.gadgetRowActionText, { color: C.textMuted }]}>{lang === 'ja' ? '詳細' : 'Details'}</Text>
                            <AppIcon name={ICONS.chevronRight} size={18} color={C.textMuted} />
                          </View>
                        </TouchableOpacity>
                      </FavoriteSwipeRow>
                    </RemovalMotion>
                  )
                }} />
            {sortedCableGadgets.length > 0 && renderCableSection()}
            {requiredCableTotal > 0 && renderRequiredCableSection()}
            <View style={[styles.gadgetTotalRow, { borderTopColor: C.border }]}>
              <Text style={[styles.gadgetTotalLabel, { color: C.textMuted }]}>{t('wiringResult.total')}</Text>
              {/* 金額が主役、台数は付随する数として落とす。価格が1つも無いのに ¥0 と出すと
                  無料の機材に読めるので、行の金額と同じく — にする */}
              <Text style={[styles.gadgetTotalCount, { color: C.text }]}>
                {selectedGadgets.some((g) => validGadgetPrice(g) != null) ? fmtPrice(sumGadgetPrices(selectedGadgets)) : (lang === 'en' ? '$—' : '¥—')}
                <Text style={[styles.gadgetTotalQty, { color: C.textMuted }]}>
                  {'  '}{t('wiringResult.itemCount').replace('{{n}}', String(selectedQuantity))}
                </Text>
              </Text>
            </View>
            </Reanimated.View>
          </Reanimated.ScrollView>
          </GestureDetector>
          <ScrollProgressBar
            offset={gadgetScrollY}
            contentH={gadgetScrollBox.content}
            viewportH={gadgetScrollBox.viewport}
            color={C.textMuted + '66'}
          />
          </View>
        )
      })()}

      <GadgetReplacementModal
        visible={replacementVisible}
        source={replacementSource}
        target={replacementTarget}
        candidates={replacementCandidates}
        exchangeDate={replacementDate}
        dateError={replacementDateError}
        price={replacementPrice}
        priceError={replacementPriceError}
        supportArmName={replacementSupportArm ? gadgetTitle(replacementSupportArm, lang) : undefined}
        supportKind={replacementSource?.category === 'Microphone' ? 'microphone' : 'monitor'}
        inheritSupportArm={replacementInheritSupportArm}
        relatedSettingCount={replacementRelationCount}
        inheritRelatedSettings={replacementInheritRelations}
        saving={replacementSaving}
        colors={C}
        isDark={isDark}
        lang={lang}
        onClose={closeReplacement}
        onSelect={(gadget) => {
          setReplacementTargetId(gadget.id)
          setReplacementDate(formatDate(new Date(), lang))
          setReplacementPrice(fmtPriceInput(gadget.price))
          setReplacementInheritRelations(true)
          hapticSelection()
        }}
        onBack={() => {
          setReplacementTargetId(null)
          setReplacementPrice('')
        }}
        onRegisterNew={registerReplacement}
        onChangeDate={setReplacementDate}
        onChangePrice={setReplacementPrice}
        onChangeInheritSupportArm={(value) => {
          setReplacementInheritSupportArm(value)
          hapticSelection()
        }}
        onChangeInheritRelatedSettings={(value) => {
          setReplacementInheritRelations(value)
          hapticSelection()
        }}
        onConfirm={() => { void confirmReplacement() }}
      />

      <GadgetSortSheet
        allowManual={!readOnly}
        visible={gadgetSortExpanded}
        value={gadgetSort}
        onSelect={setGadgetSort}
        onClose={() => setGadgetSortExpanded(false)}
        colors={C}
        lang={lang}
        t={t}
      />

      {tab === 'info' && !infoMounted && (
        <View style={[shiftedContent, { alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.bgList }]}>
          <ActivityIndicator size="large" color={C.accentIcon} />
          <Text style={{ color: C.accentText, fontSize: 13, fontWeight: '700' }}>
            {lang === 'en' ? 'Building insights…' : '集計中…'}
          </Text>
        </View>
      )}
      {/* 情報：履歴と統計を集約。一度マウントしたら display 切替だけで保持する */}
      {infoMounted && (
        <View
          style={[shiftedContent, { display: tab === 'info' ? 'flex' : 'none' }]}
          onLayout={handleInfoScrollLayout}
        >
          <GadgetStatsPanel
            // 歴史の再生は配線タブ（配線図の上）へ移した。同じ絵の別の時点なので、
            // 図と離れた場所に置くと別機能に見える
            sourceGadgets={selectedGadgets}
            financialHistoryGadgets={historyGadgets}
            chronicleYears={PLAN_LIMITS[isPro || billingLoading ? 'pro' : 'free'].historyAnimationYears}
            onRequireChroniclePro={() => {
              trackLimitHit('historyAnimationYears', {
                max: PLAN_LIMITS[isPro ? 'pro' : 'free'].historyAnimationYears,
                placement: 'wiring_result_chronicle',
              })
              openPaywall(navigation, 'historyAnimation')
            }}
            connections={connectionsForDesk}
            triggerKey={statsAnimVersion}
            colors={C}
            t={t}
            lang={lang}
            fmtPrice={fmtPrice}
            displayAmount={displayAmount}
            // 金額だけをまとめて入れる画面は廃止した。金額は作成の「機材」の段と各機材の詳細で入れるので、
            // 機材タブへ移して1台ずつ開いてもらう（マイページの統計がガジェット一覧へ戻すのと同じ）
            onFillPrice={() => {
              hapticSelection()
              setTab('gadgets')
            }}
            header={<>
              <View style={styles.infoMetaRow}>
                {!!deskOwnerName && (
                  <TouchableOpacity
                    style={styles.profileOwnerButton}
                    onPress={() => setEditingProfile(true)}
                    disabled={readOnly}
                    hitSlop={8}
                    activeOpacity={0.6}
                    accessibilityRole={readOnly ? 'text' : 'button'}
                    accessibilityLabel={readOnly
                      ? deskOwnerName
                      : (lang === 'en' ? `${deskOwnerName}. Edit profile` : `${deskOwnerName}。プロフィールを編集`)}
                  >
                    <Text style={[styles.profileMetaText, { color: C.textMuted }]} numberOfLines={1}>
                      {deskOwnerName}
                    </Text>
                  </TouchableOpacity>
                )}
                {!!reactionSummary(reaction, lang) && (
                  <Text style={[styles.profileMetaText, styles.infoReaction, { color: C.textSub }]} numberOfLines={1}>
                    {reactionSummary(reaction, lang)}
                  </Text>
                )}
              </View>
            </>}
            showTotalCard={false}
            collapseDetailsInitially
            scrollRef={infoScrollRef}
            contentBottomInset={listBottomInset}
            contentMinHeight={listContentMinHeight}
            contentShiftStyle={listContentStyle}
            onScroll={handleInfoScroll}
            onContentSizeChange={handleInfoContentSize}
            scrollEventThrottle={16}
          />
          <ScrollProgressBar
            offset={infoScrollY}
            contentH={infoScrollBox.content}
            viewportH={infoScrollBox.viewport}
            color={C.textMuted + '66'}
          />
        </View>
      )}
      </CollapsibleTabContent>
      </KeyboardAvoidingView>




      {/* ─── 利用目的編集モーダル ─── */}
      <DeskPurposeEditSheet
        visible={editPurposesVisible}
        onClose={() => setEditPurposesVisible(false)}
        selected={editPurposes}
        onChange={setEditPurposes}
        otherLabel={editOtherPurposeLabel}
        onChangeOtherLabel={setEditOtherPurposeLabel}
        otherIcon={editOtherPurposeIcon}
        onChangeOtherIcon={setEditOtherPurposeIcon}
        otherColor={plan.otherPurposeColor}
      />

      {/* ─── 公開モーダル ─── */}
      <PublishModal
        ownerTag={ownShareTag(profile)}
        visible={publishModalVisible}
        onClose={() => setPublishModalVisible(false)}
        state={publishState}
        error={publishError}
        deskId={publishedDeskId}
        visibility={publishedVisibility}
        deskName={plan.name}
        gadgetCount={selectedQuantity}
        totalPrice={sumGadgetPrices(selectedGadgets)}
        photoUris={plan.images}
        colors={C}
        lang={lang}
        fmtPrice={fmtPrice}
        onPublish={(visibility) => { nameGate.run(() => { void handlePublish(visibility) }) }}
        onUnpublish={handleUnpublish}
        onChangeVisibility={(next) => { void handleChangeVisibility(next) }}
        changingVisibility={changingVisibility}
        canUpdate={canUpdatePublicPage}
        outdated={isOutdatedPublishState(planPublishState)}
        updating={isUpdating}
        onUpdate={() => { nameGate.run(() => { void handleUpdate() }) }}
      />

      <PublicNameGateModal {...nameGate.gateProps} colors={C} lang={lang} />

      <ProfileEditSheet
        visible={editingProfile}
        onClose={() => setEditingProfile(false)}
        onSaved={setDeskOwnerName}
        onOpenPublicProfile={(tag) => navigation.isFocused() && navigation.push('PublicProfile', { tag })}
      />

      {/* ─── 画像プレビューカルーセル ─── */}
      <DeskPhotoPreviewModal
        items={previewSlides.map((slide, i) => slide === '__photoLimit__'
          ? {
            key: 'photo-limit',
            thumb: { icon: photoLimitIsUpsell ? 'crown-outline' : 'image-multiple-outline', tint: photoLimitIsUpsell ? C.pro : '#fff' },
            content: photoLimitIsUpsell ? (
              <TouchableOpacity
                style={[styles.previewPaywallCard, { borderColor: C.accentIcon }]}
                onPress={() => {
                  setPreviewIndex(null)
                  trackLimitHit('maxPhotosPerDesk', { current: images.length, max: maxPhotos, placement: 'photo_preview' })
                  openPaywall(navigation, 'maxPhotosPerDesk')
                }}
                activeOpacity={0.88}
                accessibilityRole="button"
                accessibilityLabel={lang === 'ja' ? 'Proで写真を10枚まで追加' : 'Add up to 10 photos with Pro'}
              >
                <AppIcon name="crown-outline" size={56} color={C.pro} />
                <Text style={styles.previewPaywallTitle}>
                  {lang === 'ja' ? 'Proで写真を10枚まで追加' : 'Add up to 10 photos with Pro'}
                </Text>
                <Text style={[styles.previewPaywallDesc, { color: C.accentTextOnDark }]}>
                  {lang === 'ja' ? 'タップしてアップグレード' : 'Tap to upgrade'}
                </Text>
              </TouchableOpacity>
            ) : (
              // Pro はもう払っているので、勧誘ではなく枚数の案内にする。
              // 押しても行き先が無いので、触れないカードにしておく
              <View style={[styles.previewPaywallCard, { borderColor: PREVIEW_DARK_BORDER }]}>
                <AppIcon name={ICONS.photos} size={56} color={PREVIEW_DARK_MUTED} />
                <Text style={styles.previewPaywallTitle}>
                  {lang === 'ja' ? '写真は' + maxPhotos + '枚まで登録済み' : 'All ' + maxPhotos + ' photos added'}
                </Text>
                <Text style={[styles.previewPaywallDesc, { color: PREVIEW_DARK_MUTED }]}>
                  {lang === 'ja'
                    ? '別の写真を入れるには、いらない写真を削除してください'
                    : 'Delete a photo you no longer need to add a different one'}
                </Text>
              </View>
            ),
          }
          : { key: `${slide}-${i}`, uri: slide })}
        openIndex={previewIndex}
        visibleIndex={previewVisibleIdx}
        addedPhotos={addedPhotoUris.current}
        onPhotoEntered={(uri) => { addedPhotoUris.current.delete(uri) }}
        onVisibleIndex={setPreviewVisibleIdx}
        onClose={() => setPreviewIndex(null)}
        lang={lang}
      />

      <GadgetDetailSheet
        visible={infoGadget !== null}
        gadget={gadgets.find((gadget) => gadget.id === infoGadget?.id) ?? infoGadget}
        connections={connectionsForDesk}
        relatedGadgets={selectedGadgets}
        readOnly={readOnly}
        colors={C}
        lang={lang}
        fmtPrice={fmtPrice}
        fmtDimStr={fmtDimStr}
        unitLabel={unitLabel}
        onClose={closeGadgetInfo}
        favorite={!!gadgets.find((gadget) => gadget.id === infoGadget?.id)?.favorite}
        onToggleFavorite={!readOnly && infoGadget ? () => { hapticSelection(); toggleFavorite(infoGadget) } : undefined}
        recommended={!!infoGadget && recommendedIds.has(infoGadget.id)}
        onToggleRecommended={!readOnly && infoGadget && infoGadget.category !== 'Cable' ? () => { hapticSelection(); toggleRecommended(infoGadget) } : undefined}
        undoAction={undoSnackbar.visible ? { message: undoSnackbar.message, undoing: undoSnackbar.undoing, disabled: undoSnackbar.blocked, onUndo: undoSnackbar.undo } : undefined}
        onEdit={(gadget) => {
          closeGadgetInfo()
          navigation.navigate('GadgetDetail', { gadgetId: gadget.id, planId })
        }}
        onEditConnection={infoMapActions ? (connection) => {
          closeGadgetInfo()
          infoMapActions.editConnection(connection)
        } : undefined}
        onDrawConnection={infoMapActions ? () => {
          closeGadgetInfo()
          infoMapActions.drawConnection()
        } : undefined}
        onAddWirelessConnection={infoMapActions?.addWirelessConnection ? () => {
          closeGadgetInfo()
          infoMapActions.addWirelessConnection?.()
        } : undefined}
        onOpenDesk={(deskId) => {
          // シートを閉じてから移る。開いたまま push すると、公開デスクがシートの裏に積まれて見えない
          if (!navigation.isFocused()) return
          closeGadgetInfo()
          openPublicDeskFromGadget(deskId)
        }}
        onOpenBrand={(key, label) => {
          if (!navigation.isFocused()) return
          closeGadgetInfo()
          navigation.push('BrandProducts', { brandKey: key, brandLabel: label })
        }}
      />
      {completionPromptVisible && !readOnly && (
        <View style={[styles.completionPrompt, { backgroundColor: C.card, borderColor: C.success }]}>
          <View style={styles.completionPromptLead}>
            <View style={[styles.completionPromptIcon, { backgroundColor: C.success + '18' }]}>
              <AppIcon name="check-circle-outline" size={22} color={C.success} />
            </View>
            <View style={styles.completionPromptText}>
              <Text style={[styles.completionPromptTitle, { color: C.text }]}>
                {lang === 'ja' ? 'デスクの登録が完了しました' : 'Your desk is ready'}
              </Text>
              <Text style={[styles.completionPromptDescription, { color: C.textMuted }]}>
                {lang === 'ja'
                  ? '公開すると、リンクで共有できます'
                  : 'Publish it to share a link'}
              </Text>
            </View>
          </View>
          <View style={styles.completionPromptActions}>
            <TouchableOpacity
              style={[styles.completionPromptButton, { backgroundColor: C.accent }]}
              onPress={openCompletionPublish}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <AppIcon name={ICONS.publish} size={16} color={C.onAccent} />
              <Text style={[styles.completionPromptButtonText, { color: C.onAccent }]}>
                {lang === 'ja' ? '公開する' : 'Publish'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.completionPromptLater}
              onPress={finishCompletionPrompt}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={[styles.completionPromptLaterText, { color: C.textMuted }]}>
                {lang === 'ja' ? 'あとで' : 'Later'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      {/* ─── フッター（公開・AI相談・共有） ─── */}
      {/* ダークでは影が黒に溶け、一覧の行と同じ色のバーの縁が消えるので、境界線で囲う */}
      <View style={[styles.footer, { backgroundColor: C.card }, styles.footerOutline, { borderColor: C.separator }]}>
        {/* 公開の案内が出ている間はその上に重なるので出さない（案内を閉じれば戻る） */}
        {tab === 'gadgets' && !(completionPromptVisible && !readOnly) && (
          <GadgetListFloatingControls
            sortLabel={t(GADGET_SORT_OPTIONS.find((o) => o.key === gadgetSort)?.labelKey ?? 'wiringResult.sortCreatedAt')}
            sortExpanded={gadgetSortExpanded}
            onSort={() => setGadgetSortExpanded(true)}
            sortRef={coachTarget('desk-gadget-sort')}
            onAdd={readOnly ? undefined : openGadgetAdd}
            addRef={coachTarget('desk-gadget-add')}
          />
        )}
        <View style={styles.footerRow}>
          {/* 主ボタンは公開の状態そのもの。
              編集はすべて即時保存されるので「保存」は押す必要が無く、この場所に置くべき
              未了の作業は「公開ページが手元の内容と食い違っている」ことだけになる。
              内容が一致している間は押せない（押す意味が無いものを押せる形で出さない）*/}
          {!readOnly && (
            <TouchableOpacity
              ref={coachTarget('desk-publish')}
              style={[
                styles.footerPrimaryBtn,
                {
                  backgroundColor: publishPrimary.tone === 'primary' ? C.accent : C.chip,
                  borderWidth: publishPrimary.tone === 'primary' ? 0 : StyleSheet.hairlineWidth,
                  borderColor: C.border,
                  opacity: publishPrimary.busy ? 0.55 : 1,
                },
              ]}
              onPress={publishPrimary.onPress}
              disabled={!publishPrimary.enabled || publishPrimary.busy}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={publishPrimary.label}
              accessibilityState={{ disabled: !publishPrimary.enabled || publishPrimary.busy }}
            >
              {(() => {
                // 塗り＝onAccent、押せる枠線ボタン＝accentText、押せないもの＝textMuted
                const fg = publishPrimary.tone === 'primary'
                  ? C.onAccent
                  : publishPrimary.enabled ? C.accentText : C.textMuted
                return (
                  <>
                    {publishPrimary.busy
                      ? <ActivityIndicator size="small" color={fg} />
                      : <AppIcon name={publishPrimary.icon} size={16} color={fg} />}
                    <Text style={[styles.footerPrimaryText, { color: fg }]}>{publishPrimary.label}</Text>
                  </>
                )
              })()}
            </TouchableOpacity>
          )}
          {/* AIコーチはこのデスクを添付した状態で開く。共有されたデスクは
              自分のマイガジェットにガジェットが無く分析材料にならないので出さない */}
          {!readOnly && (
            <TouchableOpacity
              ref={coachTarget('desk-ai')}
              style={[styles.footerIconBtn, styles.footerLabeledBtn, { backgroundColor: C.chip, borderColor: C.border }]}
              // 課金判定とPaywall表示は会話画面へ集約し、画面を見せる順序をすべての入口で揃える。
              onPress={() => navigation.navigate('AICoachChat', { planId })}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={lang === 'en' ? 'Ask the AI coach' : 'AIコーチに相談'}
              accessibilityHint={lang === 'en' ? 'Opens a chat with this desk attached' : 'このデスクを添付した状態でチャットを開きます'}
            >
              {/* 絵だけでは何のボタンか伝わらない。他人のデスクの下のバーと同じく「AI」と書く */}
              <View style={styles.footerLabeledInner}>
                <AppIcon name={ICONS.robot} size={18} color={C.text} />
                <Text style={[styles.footerLabeledText, { color: C.text }]}>AI</Text>
              </View>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            ref={coachTarget('desk-share')}
            style={[styles.footerIconBtn, { backgroundColor: C.chip, borderColor: C.border }]}
            onPress={handleShareIcon}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.shareDesk')}
            accessibilityHint={canUpdatePublicPage
              ? isOutdatedPublishState(planPublishState)
                ? (lang === 'en' ? 'Opens settings to update the public page before sharing' : '共有前に公開ページを更新する設定を開きます')
                : (lang === 'en' ? 'Shares the link to the public page' : '公開ページのリンクを共有します')
              : (lang === 'en' ? 'Publish this desk to share a link' : 'リンクで共有するために、このデスクを公開します')}
          >
            <AppIcon name={ICONS.share} size={18} color={C.text} />
          </TouchableOpacity>
        </View>
      </View>

      <UndoSnackbar
        visible={undoSnackbar.visible && infoGadget === null}
        message={undoSnackbar.message}
        lang={lang}
        backgroundColor={C.text}
        textColor={C.card}
        accentColor={C.accent}
        onUndo={undoSnackbar.undo}
        undoing={undoSnackbar.undoing}
        disabled={undoSnackbar.blocked}
        bottomOffset={tab === 'wiring' ? 68 + WIRING_HUD_CLEARANCE : 68}
      />

      <Toast
        visible={savedToast !== null}
        message={savedToast ?? ''}
        backgroundColor={UI_STATUS_COLORS.success}
        textColor="#FFFFFF"
        bottomOffset={tab === 'wiring' ? 90 + WIRING_HUD_CLEARANCE : 90}
      />
      {coach.overlay}
    </CoachScope>
    </SafeAreaView>
  )
}

// 写真の全画面表示は明暗のテーマに関係なく黒地。テーマの淡色はライトでは白地向けの濃さで、黒地では沈む
// （ダークテーマの textMuted / border と同じ値）
const PREVIEW_DARK_MUTED = '#A3A3A8'
const PREVIEW_DARK_BORDER = '#48484A'

const styles = StyleSheet.create({
  // タブバー以下は収納量ぶん背を高くして上へずらすため、下端のはみ出しをここで切る
  container: { flex: 1, overflow: 'hidden' },
  keyboardArea: { flex: 1 },
  profileScroll: { flexGrow: 0 },
  // 配線図の下端、接続追加の FAB（ConnectionMap の fab：右16・幅48・下16）の左隣に並べる。
  // 上に積むと下部の操作が2段になり、図の右下を大きく塞いでいた。zIndex はズームバー（30）と揃える
  wiringHistoryOverlay: { position: 'absolute', right: 16 + 48 + 8, bottom: 16, zIndex: 30 },
  // 閲覧専用は FAB を出さないので、その場所まで寄せる
  wiringHistoryOverlayNoFab: { right: 16 },
  // 左は「全体」（ConnectionMap の zoomBar：左12・幅48＋枠2）、右は＋（右16・幅48）の隣。8pt ずつ空ける
  wiringNotice: { left: 12 + 50 + 8, right: 16 + 48 + 8 },
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
  readOnlyBanner: {
    minHeight: 38,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  readOnlyBannerText: { fontSize: 12, fontWeight: '600' },
  editingBanner: {
    minHeight: 38,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editingBannerText: { fontSize: 12, fontWeight: '700' },
  reflectionBanner: {
    position: 'absolute',
    top: 8,
    right: 16,
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reflectionBannerText: { fontSize: 12, fontWeight: '700' },

  summaryCardBare: { paddingTop: 0, paddingBottom: 0 },
  summaryCard: {
    paddingHorizontal: 16,
    // 編集中だけ効く（通常時は summaryCardBare）。名前の欄を編集中の帯に寄せる
    paddingTop: 6,
    paddingBottom: 12,
  },
  profilePrimaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ownerContextRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  profileOwnerButton: { flexShrink: 1 },
  // gap は 8。編集中の削除バッジがチップの右へ 5px はみ出すので、
  // 6 だと隣のアイコンまで 1px しか残らず接して見える
  profilePurposeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10, marginBottom: 6, flexShrink: 0, overflow: 'visible' },
  deskDescription: { marginTop: 10 },
  // ガジェットのメモ欄（GadgetDetailScreen の memoInput）と同じ枠。上部に置くので低めに止める
  // ひとことの字の大きさと左右の余白は、詳細の表示（DeskDescription）と揃える。
  // 詳細では文節に合わせて折り返すので、自動改行の位置は入力中と異なる
  descriptionInput: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    paddingHorizontal: DESK_DESCRIPTION_INPUT_PADDING,
    ...multilineInputText({ ...DESK_DESCRIPTION_TEXT, paddingTop: 10, paddingBottom: 10 }, Platform.OS),
    minHeight: 64,
    maxHeight: 120,
  },
  descriptionCount: { marginTop: 4, fontSize: 12, lineHeight: 17, textAlign: 'right' },
  headerCollapsible: { paddingTop: 7 },
  // 画面見出し（design.md の 20–22）。公開デスク（PublicDeskScreen）の deskTitle と同じ大きさ
  // 下の余白は持たせず、続く写真・ひとことの上で取る。ここで持つと、どちらも無いデスクで下の余白（12）と重なって空く
  deskTitleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 8, zIndex: 5, overflow: 'visible' },
  deskTitleColumn: { flex: 1, minWidth: 0 },
  // 用途が多いときは名前に1行を丸ごと渡し、用途のアイコンを下の段へ折り返す
  deskTitleRowStacked: { flexWrap: 'wrap' },
  deskTitleColumnStacked: { flexBasis: '100%' },
  deskTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  deskUpdatedAt: { marginTop: 2, fontSize: 11, lineHeight: 15, fontWeight: '500', textAlign: 'left' },
  // 編集中は用途アイコンの行の右端に置き、名前の欄の下に日付だけの段を作らない
  editUpdatedAt: { marginTop: 0, marginLeft: 'auto', flexShrink: 1, textAlign: 'right' },
  // 用途は一覧タイル（DeskGridTile）と同じくアイコンだけで見分ける。
  // 文字を付けないと ja/en で幅が変わらず、この行に1段で入る数も言語で変わらない。
  // 用途は全部選べるので、入りきらない分（7つ＋「＋」＋日付）は次の段へ折り返す。
  // 同じ行の右に並ぶ「＋」（profilePurposeAdd）は同じ寸法の点線の枠
  profilePurposeIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 用途を足す空き枠。profilePurposeIcon と同じ寸法で、点線だけが違う（写真の追加枠と同じ語彙）
  profilePurposeAdd: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSecondary: { overflow: 'hidden' },
  // 反応の件数は行の右端。日付・名前（読み飛ばしてよい）より一段濃くする
  infoReaction: { marginLeft: 'auto' },
  infoMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginHorizontal: UI_METRICS.screenGutter, marginTop: 12 },
  profileMetaText: { fontSize: 11, fontWeight: '500', textAlign: 'right' },
  purposeIconWrap: { position: 'relative' as const, overflow: 'visible' as const },
  purposeIconDelete: { position: 'absolute', top: -5, right: -5, zIndex: 2 },
  editHint: { fontSize: 11, lineHeight: 15, marginTop: 6 },
  // 画面の横余白を打ち消して全幅で敷く。数値を書くと screenGutter を
  // 変えたときにここだけ取り残される
  photoCarouselFullBleed: { marginHorizontal: -UI_METRICS.screenGutter, marginTop: 10 },
  photoStrip: { marginTop: 6 },
  photoStripContent: { paddingLeft: 0, paddingRight: 16, gap: 8, flexDirection: 'row' as const, alignItems: 'flex-start' as const, paddingBottom: 2 },
  photoStripItem: { width: 80 },
  photoCoverAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  photoActionText: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  // 正方形。隣の追加ボタン（80x80）と同じ形で一列に並び、どこまでが写真でどこからが
  // 追加なのかが大きさではなく中身で分かる。写真は cover なので中央が切り取られる
  // （全体を確かめるのは写真を開いたとき）
  photoStripCell: { width: 80, height: 80, borderRadius: UI_METRICS.controlRadius },
  photoStripThumb: { width: 80, height: 80, borderRadius: UI_METRICS.controlRadius },
  // 大きさと形は IconCircleButton が持つ。ここは置き場所だけ
  photoStripDelete: { position: 'absolute' as const, top: 4, right: 4 },
  photoStripAdd: {
    width: 80, height: 80, borderRadius: UI_METRICS.controlRadius,
    borderWidth: 1.5, borderStyle: 'dashed' as const,
    alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
  },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  tabText: { fontSize: 12 },
  tabScroll: { flex: 1 },
  // 機材タブの一覧は左右いっぱいに敷く。外枠に余白を取ると、行の中の余白と二重になり
  // 一覧の両脇に地の色の帯が残っていた。文字の位置は各行・見出しの内側の screenGutter でそろえる
  tabContent: { paddingTop: UI_METRICS.screenGutter, paddingBottom: 24 },

  // ─── ガジェット一覧タブ ──────────────────────────────────────
  catSection: { marginBottom: 12 },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingVertical: 8,
    borderLeftWidth: 3,
    marginBottom: 2,
  },
  catHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  catHeaderName: { fontSize: 13, fontWeight: '700', flex: 1 },
  // 件数は見出し名に付随するメタなので textMuted。
  // catHeaderName と同じ濃さだと見出しが2つ並んで見える
  catHeaderCount: { fontSize: 12, fontWeight: '600' },
  // 地の色は呼び出し側で必ず入れる（backgroundColor: C.card）。この行は Swipeable の
  // 中身で、スワイプで出る削除ボタンはこの行の**下**に敷かれる。透明のままだと
  // 赤がそのまま透けて、行の文字（「詳細 ›」）が赤地に重なって見える。
  // 他画面のスワイプ行（AICoachList・GadgetLibrary）はどれも地の色を持っている
  gadgetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: UI_METRICS.screenGutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  gadgetInfo: { flex: 1, minWidth: 0 },
  gadgetNameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  gadgetName: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  decorBadge: { borderRadius: UI_METRICS.chipRadius, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  decorBadgeText: { fontSize: 10, fontWeight: '700' },
  gadgetMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 5 },
  // marginLeft:'auto' で右寄せする側。flexShrink の既定は 0 なので、指定が無いと
  // 文字が長いときに縮まず、行の右にある「詳細 ›」の下へはみ出す。
  gadgetCat: { fontSize: 11, flexShrink: 1, minWidth: 0 },
  gadgetPrice: { fontSize: 11, flexShrink: 0, fontWeight: '500' },
  gadgetRowAction: { flexDirection: 'row', alignItems: 'center', gap: 1, flexShrink: 0 },
  gadgetRowActionText: { fontSize: 11, fontWeight: '600' },
  // ケーブル節の中間階層（ケーブルの種類）と、その配下の個別ケーブル行
  cableTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: UI_METRICS.screenGutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  cableTypeName: { fontSize: 12, fontWeight: '700', flex: 1 },
  cableTypeCount: { fontSize: 12, fontWeight: '800', flexShrink: 0 },
  cableItemRow: { paddingLeft: UI_METRICS.screenGutter + 20 },
  suggestionCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.panelRadius, marginHorizontal: UI_METRICS.screenGutter, marginTop: UI_METRICS.screenGutter, marginBottom: 10, overflow: 'hidden' },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  suggestionIcon: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  suggestionTitle: { fontSize: 13, fontWeight: '700' },
  suggestionBody: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  suggestionAddButton: { borderWidth: 1, borderRadius: UI_METRICS.cardRadius, paddingHorizontal: 12, paddingVertical: 5, flexShrink: 0 },
  suggestionAddLabel: { fontSize: 12, fontWeight: '700' },
  suggestionDismiss: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 9, alignItems: 'center' },
  suggestionDismissLabel: { fontSize: 12, fontWeight: '600' },
  cableGroupNote: { fontSize: 10, lineHeight: 15, paddingHorizontal: UI_METRICS.screenGutter, paddingTop: 8, paddingBottom: 4 },
  cableChoiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: UI_METRICS.screenGutter, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  cableChoiceLabel: { flex: 1, fontSize: 13, fontWeight: '600' },
  cableChoiceCount: { fontSize: 12 },
  cableItemCount: { fontSize: 11, fontWeight: '600', flexShrink: 0 },


  gadgetSwipeActions: { flexDirection: 'row', justifyContent: 'center' },
  // 左が交換、右が外す。デスクから外すだけで商品自体は消えないため、外す側は warning の地を使う。
  gadgetSwipeButton: {
    width: 72,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  gadgetSwipeLabel: { fontSize: 11, fontWeight: '700' },
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
  gadgetTotalCount: { fontSize: 14, fontWeight: '700' },
  gadgetTotalQty: { fontSize: 12, fontWeight: '500' },
  gadgetCatIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },


  completionPrompt: {
    marginHorizontal: UI_METRICS.screenGutter,
    marginBottom: 8,
    borderWidth: 1,
    borderRadius: UI_METRICS.panelRadius,
    padding: 14,
    gap: 12,
  },
  completionPromptLead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  completionPromptIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  completionPromptText: { flex: 1 },
  completionPromptTitle: { fontSize: 15, fontWeight: '800' },
  completionPromptDescription: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  completionPromptActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  completionPromptButton: {
    minHeight: UI_METRICS.touchMinSize,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: UI_METRICS.controlRadius,
    paddingHorizontal: 12,
  },
  completionPromptButtonText: { fontSize: 13, fontWeight: '700' },
  completionPromptLater: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center', paddingHorizontal: 4 },
  completionPromptLaterText: { fontSize: 13, fontWeight: '600' },

  footer: {
    borderTopLeftRadius: UI_METRICS.sheetRadius,
    borderTopRightRadius: UI_METRICS.sheetRadius,
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingVertical: 12,
    zIndex: 40,
  },
  footerOutline: { borderWidth: 1, borderBottomWidth: 0 },
  footerRow: {
    flexDirection: 'row' as const,
    gap: 8,
    alignItems: 'center' as const,
  },
  footerIconBtn: {
    width: UI_METRICS.touchMinSize,
    height: UI_METRICS.touchMinSize,
    borderRadius: UI_METRICS.controlRadius,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // フッターの主ボタン（公開・更新）。画面の中で押すべきものを1つに絞る枠
  // 文字付きのアイコンボタン（AI）。高さは他のアイコンボタンと揃え、幅だけ中身に合わせる
  footerLabeledBtn: { width: undefined, minWidth: UI_METRICS.touchMinSize, paddingHorizontal: 12 },
  footerLabeledInner: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footerLabeledText: { fontSize: 13, fontWeight: '700' },
  footerPrimaryBtn: {
    flex: 1,
    borderRadius: UI_METRICS.controlRadius,
    paddingVertical: 11,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: 6,
  },
  footerPrimaryText: { fontSize: 14, fontWeight: '600' as const },

  previewPaywallCard: {
    width: SCREEN_W * 0.72,
    aspectRatio: 0.85,
    borderRadius: UI_METRICS.sheetRadius,
    backgroundColor: '#1a1a1a',
    borderWidth: 1.5,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 14,
    padding: 24,
  },
  previewPaywallTitle: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: '#fff',
    textAlign: 'center' as const,
  },
  previewPaywallDesc: {
    fontSize: 13,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },

})
