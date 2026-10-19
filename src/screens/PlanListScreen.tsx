import { Alert } from '../utils/alert'
import { RemovalMotion, useRemovalMotion } from '../components/molecules/RemovalMotion'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useFocusEffect } from '@react-navigation/native'
import { useScrollSyncRetry } from '../hooks/useScrollSyncRetry'
import { useScrollToTopOf } from '../hooks/useScrollToTopOf'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  Animated,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { SwipeableRow } from '../components/molecules/SwipeableRow'
import { SWIPEABLE_ROW_PROPS } from '../utils/swipeableRow'
import { useSwipePeekHint } from '../hooks/useSwipePeekHint'
import { AppIcon } from '../components/atoms/AppIcon'
import { Skeleton } from '../components/atoms/Skeleton'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { AdBanner } from '../components/molecules/AdBanner'
import { DeskGridTile } from '../components/molecules/DeskGridTile'
import { DeskRenameModal } from '../components/molecules/DeskRenameModal'
import { DESK_TILE_GAP, DeskSwipeLeftActions, DeskSwipeRightActions } from '../components/molecules/DeskSwipeActions'
import { SwipeCommitRow } from '../components/molecules/SwipeCommitRow'
import { EmptyState as EmptyStateView } from '../components/molecules/EmptyState'
import { ListSkeleton } from '../components/molecules/ListSkeleton'
import { RetryState } from '../components/molecules/RetryState'
import { UndoSnackbar } from '../components/molecules/UndoSnackbar'
import { NewDeskFab } from '../components/molecules/NewDeskFab'
import { ICONS, TAB_ICONS } from '../constants/icons'
import { AppColors, useApp } from '../context/AppContext'
import { useEntitlement } from '../hooks/useEntitlement'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { useDeskActions } from '../hooks/useDeskActions'
import { useDeskSharing } from '../hooks/useDeskSharing'
import { COACH_SCREEN, CoachStep, CoachScope, useCoachMarks, useCoachTarget } from '../hooks/useCoachMarks'
import { analytics, EVENTS, trackLimitHit } from '../services/analytics'
import { getPlanPublishStates, PlanPublishState } from '../services/publishService'
import { DeskPlan, PlanStackParamList } from '../types'
import { comparePlansBy, DEFAULT_PLAN_SORT } from '../store/displaySettings'
import { loadPlanOpenedAt, markPlanOpenedAt, PlanOpenedAt } from '../store/planOpenedStore'
import { deletePlanImages } from '../utils/planImages'
import { orphanPlaceholders } from '../utils/placeholderCleanup'
import { clearFirstSetupDraft, clearProductFillDraft, FirstSetupDraft, loadFirstSetupDraft, peekFirstSetupDraft } from '../store/firstSetupStore'
import { firstSetupResumeNavigation, resolveFirstSetupDraft, shouldShowSetupDraft } from '../utils/firstSetupResume'
import { SWIPE_OPEN_THRESHOLD } from '../constants/ui'
import { UI_METRICS } from '../constants/ui'
import { autoDeskName } from './PurposeSelectionScreen'
import { openPaywall } from '../navigation/rootNavigation'
import { openGearStep } from '../navigation/setupStepNavigation'
import { clearTemplateDetailDraft } from '../store/templateDetailDraft'
import { takeAbandonedTemplateDraftGadgets } from '../store/templateDraftGadgets'

const TILE_GAP = DESK_TILE_GAP

type Props = NativeStackScreenProps<PlanStackParamList, 'PlanList'>

// まだデスクになっていない作成途中（用途・テンプレートの段）の行。デスクの id とは衝突しない
const SETUP_DRAFT_ROW_ID = 'first-setup-draft'

type PlanListRow =
  | { kind: 'plan'; plan: DeskPlan }
  | { kind: 'setupDraft'; draft: Exclude<FirstSetupDraft, { planId: string }> }

function planListRowKey(row: PlanListRow): string {
  if (row.kind === 'plan') return row.plan.id
  return SETUP_DRAFT_ROW_ID
}

// 「？」で順に指す。対象が画面に無い説明（デスクが0件のときのカードなど）は飛ばされる。
// 番号は並べた順に振られるので画面の上から並べる（上限の件数は一覧の見出し、新しいデスクは右下に浮いたボタン）
const PLAN_LIST_COACH: CoachStep[] = [
  { target: 'empty-create', title: { ja: '最初のデスク', en: 'Your first desk' }, pad: 4, ja: 'ここから最初のデスクを作ります。用途を選び、使う機材を登録すると配線図までできあがります。', en: 'Create your first desk here. Choose its purpose and register your gear to build the wiring map.' },
  { target: 'empty-explore', title: { ja: 'デスクを探す', en: 'Explore desks' }, pad: 2, ja: '先に、ほかの人のデスクを見て回ることもできます。', en: 'You can also look around other people’s desks first.' },
  { target: 'plan-limit', title: { ja: 'デスク数の上限', en: 'Desk limit' }, pad: 4, ja: '無料プランで作れるデスクの数です。Pro にすると無制限に作れます。', en: 'How many desks the free plan allows. Pro removes the limit.' },
  { target: 'setup-draft', title: { ja: '作成を再開', en: 'Resume setup' }, emphasis: { ja: ['タップ', '左へスワイプ'], en: ['Tap', 'Swipe left'] }, ja: '作りかけのデスクです。\n・タップ：続きから再開\n・左へスワイプ：破棄', en: 'This desk is unfinished.\n• Tap: continue\n• Swipe left: discard' },
  { target: 'desk-card', title: { ja: 'デスクを開く', en: 'Open a desk' }, ja: 'タップすると、このデスクの機材・配線図・履歴を見られます。', en: 'Tap to see this desk’s gear, wiring map, and history.' },
  { target: 'desk-card', title: { ja: 'スワイプ・長押し', en: 'Swipe and hold' }, emphasis: { ja: ['右へスワイプ', '左へスワイプ', '長押し'], en: ['Swipe right', 'Swipe left', 'Hold'] }, ja: '・右へスワイプ：ピン留め・複製\n・左へスワイプ：削除\n・長押し：名前を変える', en: '• Swipe right: pin or duplicate\n• Swipe left: delete\n• Hold: rename' },
  { target: 'desk-card-publish', title: { ja: '公開の状態', en: 'Visibility' }, emphasis: { ja: ['公開中', 'URL限定', '更新あり'], en: ['Public', 'unlisted', 'Update'] }, pad: 4, ja: '「公開中」はみんなのデスクに載り、「URL限定」はリンクを知っている人だけが開けます。「更新あり」は、編集した内容がまだ公開ページに出ていない印です。', en: 'Public desks appear in Explore; unlisted desks open only with the link. Update means your edits are not on the public page yet.' },
  { target: 'desk-card-action', title: { ja: '公開・共有', en: 'Publish and share' }, pad: 4, ja: 'デスクを公開したり、リンクを共有したりできます。', en: 'Publish or share a link from here.' },
  { target: 'new-desk', title: { ja: 'デスクを作る', en: 'Create a desk' }, pad: 4, ja: '新しいデスクはここから作ります。用途を選び、使う機材を登録すると配線図までできあがります。', en: 'Create a new desk here. Choose its purpose and register your gear to build the wiring map.' },
]

export function PlanListScreen({ navigation, route }: Props) {
  const { plans, loading: plansLoading, loadError: plansLoadError, remove, reload } = usePlans()
  const { colors, t, lang, fmtPrice, isDark } = useApp()
  const coach = useCoachMarks()
  const { open: openCoach, target: coachTarget } = coach
  const openHelp = useCallback(() => { void openCoach(PLAN_LIST_COACH) }, [openCoach])
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => (
      <HeaderIconButton name="help-circle-outline" color={colors.text} onPress={openHelp} accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'} />
    ) })
  }, [navigation, colors.text, lang, openHelp])
  const { gadgets, removeMany: removeGadgets } = useGadgets()
  const { checkLimit, getLimit } = useEntitlement()
  const listRef = useRef<FlatList>(null)
  const { handlers: scrollHandlers } = useScrollSyncRetry(undefined, true, (offset) => {
    listRef.current?.scrollToOffset({ offset, animated: false })
  })
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map())
  const removal = useRemovalMotion()
  const discardingSetupRef = useRef(false)
  const [storedSetupDraft, setSetupDraft] = useState<FirstSetupDraft | null>(null)
  const { duplicate: handleDuplicate, togglePin, rename, confirmDelete, confirmDiscardSetup, undoSnackbar } = useDeskActions({
    navigation,
    limitPlacement: 'plan_list_create',
    removeWithMotion: removal.run,
    onBeforeAction: useCallback((planId: string) => swipeableRefs.current.get(planId)?.close(), []),
    onDeleted: useCallback((planId: string) => {
      swipeableRefs.current.delete(planId)
    }, []),
    onSetupDraftCleared: useCallback(() => setSetupDraft(null), []),
  })
  const [planOpenedAt, setPlanOpenedAt] = useState<PlanOpenedAt>({})
  useScrollToTopOf(() => listRef.current)
  useFocusEffect(useCallback(() => { void reload() }, [reload]))
  useFocusEffect(useCallback(() => {
    let active = true
    // 読み込みを待つ間、空にも前回の値にもしない。空にすると、作成を続けるデスクを開いてすぐ
    // 閉じたときに「作成途中」の行が一瞬消える（デスクは完成側へ跳ぶ）。前回の値のままだと、
    // 完成・破棄した控えが一瞬また出る。メモリの控えがあれば今の値をそのまま出す
    const cached = peekFirstSetupDraft()
    if (cached !== undefined) setSetupDraft(shouldShowSetupDraft(cached) ? cached : null)
    void loadFirstSetupDraft().then((draft) => {
      if (active) setSetupDraft(shouldShowSetupDraft(draft) ? draft : null)
    })
    // 開いた時点ではなく戻ってきた時点で並びに反映する。押した瞬間に並べ替えると、
    // 画面が切り替わる途中で一覧が入れ替わって見える
    void loadPlanOpenedAt().then((openedAt) => {
      if (active) setPlanOpenedAt(openedAt)
    })
    return () => { active = false }
  }, []))

  const myPlans     = plans.filter((p) => !p.isShared)
  const setupDraft = plansLoading || plansLoadError
    ? storedSetupDraft
    : resolveFirstSetupDraft(storedSetupDraft, myPlans)

  // デスクの歴史（再生・配置編集）の入口はデスク画面の配線タブへ移した。
  // 歴史アニメは配線図と同じ絵の別の時点なので、図の隣に置かないと別機能に見える。
  // ここに置いていた右上の2ボタンは、iOS 26 がボタンごとにガラス背景を描いて
  // ヘッダーを重くしていた（対象のデスクも、押してから選ぶ形だった）

  // 上限は「自分で作ったデスク」だけで数える。plans 全体で数えると、共有デスクを
  // 取り込んだぶんだけ自分のデスクを作れなくなる
  // 押してから Paywall に飛ばされるまで上限を知らせないと「壊れた」と読まれる。
  // 残数は一覧の見出しに常時出し、上限に達したら作成ボタン側にも鍵を出す
  const planLimit = getLimit('maxWiringPlans')
  const atPlanLimit = !checkLimit('maxWiringPlans', myPlans.length)
  // 作成の useCallback から呼ぶので、これらも上限・台数が変わったら作り直す。素の関数のままだと
  // 作成側が最初の描画のものを握り続け、Pro にした直後でも上限の案内が出る
  const openPlanPaywall = useCallback((placement: string) => {
    trackLimitHit('maxWiringPlans', { current: myPlans.length, max: planLimit, placement })
    openPaywall(navigation, 'maxWiringPlans')
  }, [myPlans.length, planLimit, navigation])

  const ensurePlanSlot = useCallback((): boolean => {
    if (!atPlanLimit) return true
    openPlanPaywall('plan_list_create')
    return false
  }, [atPlanLimit, openPlanPaywall])

  // 公開の状態をカードに出すために先に読む。端末内の記録だけなので通信は起きない。
  // plan.updatedAt が動いたら読み直す（＝中身が変わりうるのはそのときだけ）
  const [publishStates, setPublishStates] = useState<Record<string, PlanPublishState>>({})
  const publishStateKey = plans.map((p) => `${p.id}:${p.updatedAt}`).join('|')
  useEffect(() => {
    let alive = true
    void getPlanPublishStates(plans, gadgets)
      .then((states) => { if (alive) setPublishStates(states) })
      .catch(() => {})
    return () => { alive = false }
    // plans / gadgets は参照が頻繁に変わるので、値から作った key で必要なときだけ読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishStateKey, gadgets])

  // 配線図がまだ無いデスクの続きは、作成中と同じ機材の段で開く。
  // 以前は「ガジェットを選択」（持ち物にチェックを付ける別の画面）を開いていて、
  // 同じ段なのに入口によって画面が違っていた
  const gadgetsRef = useRef(gadgets)
  gadgetsRef.current = gadgets
  const openGearStepById = useCallback((planId: string) => {
    const plan = plansRef.current.find((p) => p.id === planId)
    if (plan) openGearStep(navigation, plan, gadgetsRef.current, 'forward')
  }, [navigation])

  const resumeFirstSetup = useCallback((draft: FirstSetupDraft) => {
    const target = firstSetupResumeNavigation(draft)
    switch (target.name) {
      case 'PurposeSelection':
        navigation.navigate(target.name, target.params)
        break
      case 'TemplateDetail':
        navigation.navigate(target.name, target.params)
        break
      case 'GadgetSelection':
        // 旧版の作成画面で中断した控え。今の機材の段で開く
        openGearStepById(target.params.planId)
        break
      case 'DeskPlacement':
        navigation.navigate(target.name, target.params)
        break
      case 'PhotoFill':
        navigation.navigate(target.name, target.params)
        break
      case 'WiringResult':
        navigation.navigate(target.name, target.params)
        break
    }
  }, [navigation, openGearStepById])

  const discardSetupAndBeginCreate = useCallback(async (draft: FirstSetupDraft) => {
    if (discardingSetupRef.current) return

    const planId = 'planId' in draft ? draft.planId : null
    const draftPlan = planId ? myPlans.find((plan) => plan.id === planId) : null
    const planCountAfterDiscard = myPlans.length - (draftPlan ? 1 : 0)

    // 下書きだけの段階では、破棄してもデスク枠は空かない。先に上限を確認し、
    // 新規作成できないのに作成途中の内容だけを失う状態を防ぐ。
    if (!checkLimit('maxWiringPlans', planCountAfterDiscard)) {
      openPlanPaywall('plan_list_replace_draft')
      return
    }

    discardingSetupRef.current = true
    try {
      if (draftPlan) {
        // 保存完了を待ってから写真を消す。登録済みガジェットは削除しない。
        // ただしこのデスクのために作った商品名未設定の枠は片付ける（デスクの削除と同じ）。
        // 残すと、作り直すたびにマイガジェットへ未設定の機材が溜まる
        const placeholders = orphanPlaceholders(draftPlan, gadgets, plans).map((gadget) => gadget.id)
        await remove(draftPlan.id, { awaitPersistence: true })
        // 本体の削除が保存できた後の付随データ掃除は best effort。
        // ここだけ失敗しても、消えたデスクの再開画面にユーザーを留めない。
        await Promise.all([
          deletePlanImages(draftPlan.id, draftPlan.images ?? []),
          AsyncStorage.removeItem(`@desk_history:${draftPlan.id}`),
          clearProductFillDraft(draftPlan.id),
          ...(placeholders.length > 0 ? [removeGadgets(placeholders, { track: false })] : []),
        ].map((task) => task.catch((error) => {
          analytics.error('cleanup_discarded_setup', error)
        })))
      }
      clearTemplateDetailDraft()
      // 機材の段の設定ボタンで先に作ったガジェットのうち、デスクに入らなかったもの
      await takeAbandonedTemplateDraftGadgets(plans)
        .then((ids) => (ids.length > 0 ? removeGadgets(ids, { track: false }) : undefined))
        .catch((error) => analytics.error('cleanup_template_draft_gadgets', error))
      setSetupDraft(null)
      await clearFirstSetupDraft().catch((error) => {
        // 次の PurposeSelection が新しい下書きを上書きするため、ここでは作成を止めない。
        analytics.error('clear_discarded_setup_draft', error)
      })
      // 旧版から未完成が複数残っている場合、1件の破棄だけでさらに作り始めない。
      const remaining = resolveFirstSetupDraft(null, myPlans.filter((plan) => plan.id !== draftPlan?.id))
      if (remaining) setSetupDraft(remaining)
      // 破棄を待つ間に別のデスクや画面へ移っていたら、新しい作成を勝手に始めない
      if (!navigation.isFocused()) return
      if (remaining) {
        resumeFirstSetup(remaining)
        return
      }
      navigation.navigate('PurposeSelection', {})
    } catch (error) {
      analytics.error('discard_setup_before_new_desk', error)
      Alert.alert(
        lang === 'ja' ? '作成途中のデスクを破棄できませんでした' : 'Could not discard the unfinished desk',
        lang === 'ja' ? 'もう一度お試しください。' : 'Please try again.',
      )
    } finally {
      discardingSetupRef.current = false
    }
  }, [checkLimit, gadgets, lang, myPlans, navigation, openPlanPaywall, plans, remove, removeGadgets, resumeFirstSetup])

  const beginCreate = useCallback(() => {
    const draft = setupDraft
    if (!draft) {
      if (!ensurePlanSlot()) return
      navigation.navigate('PurposeSelection', {})
      return
    }

    const planId = 'planId' in draft ? draft.planId : null
    const draftPlan = planId ? myPlans.find((plan) => plan.id === planId) : null
    Alert.alert(
      lang === 'ja' ? '作成途中のデスクがあります' : 'You have an unfinished desk',
      lang === 'ja'
        ? (draftPlan
            ? `「${draftPlan.name}」の作成を続けるか、破棄して新しく作成します。`
            : '作成を続けるか、途中の内容を破棄して新しく作成します。')
        : (draftPlan
            ? `Continue setting up “${draftPlan.name}”, or discard it and create a new desk.`
            : 'Continue your setup, or discard it and create a new desk.'),
      [
        { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: lang === 'ja' ? '作成を続ける' : 'Continue setup',
          onPress: () => resumeFirstSetup(draft),
        },
        {
          text: lang === 'ja' ? '破棄して新しく作る' : 'Discard and create new',
          style: 'destructive',
          onPress: () => { void discardSetupAndBeginCreate(draft) },
        },
      ],
    )
  }, [discardSetupAndBeginCreate, ensurePlanSlot, lang, myPlans, navigation, resumeFirstSetup, setupDraft])
  const startFromTemplate = beginCreate

  // マイページの「新しいデスク」から来たとき。作成の画面はこのタブにしか無く、作成途中の控えと
  // 上限の確認もここが持つので、ここの作成ボタンと同じ流れを始める。控えはフォーカス時の読み込みを
  // 待たずに読み直す（待たずに始めると、作成途中があるのに確認なしで新しく作り始めてしまう）
  const createRequest = route.params?.createRequest
  const [pendingCreate, setPendingCreate] = useState(false)
  useEffect(() => {
    if (!createRequest) return
    navigation.setParams({ createRequest: undefined })
    void loadFirstSetupDraft().then((draft) => {
      setSetupDraft(shouldShowSetupDraft(draft) ? draft : null)
      setPendingCreate(true)
    })
  }, [createRequest, navigation])
  useEffect(() => {
    if (!pendingCreate || plansLoading) return
    setPendingCreate(false)
    beginCreate()
  }, [pendingCreate, plansLoading, beginCreate])

  // デスクの削除（useDeskActions.confirmDelete）と同じく、確認 → 一覧から消す → 5秒の Undo。
  // 同じ一覧の中で、作成途中の行だけ確認のみ・取り消し不可だと、消し方が行ごとに違って見える
  const discardSetupDraft = useCallback(() => {
    swipeableRefs.current.get(SETUP_DRAFT_ROW_ID)?.close()
    if (setupDraft) confirmDiscardSetup(setupDraft, setSetupDraft)
  }, [setupDraft, confirmDiscardSetup])

  const recordPlanOpened = (planId: string) => {
    void markPlanOpenedAt(planId, plansRef.current.map((p) => p.id)).catch(() => {})
  }

  const handlePlanPress = (plan: DeskPlan) => {
    if (!navigation.isFocused()) return
    recordPlanOpened(plan.id)
    if (setupDraft && 'planId' in setupDraft && setupDraft.planId === plan.id) {
      resumeFirstSetup(setupDraft)
      return
    }
    // 作ったデスクを何回開き直すかがアプリの継続価値そのものなので、
    // 開く経路が分かれる前にまとめて記録する。
    analytics.track(EVENTS.DESK_OPENED, {
      is_shared:    plan.isShared === true,
      has_wiring:   !!plan.wiringResult,
      gadget_count: plan.selectedGadgetIds.length,
      photo_count:  plan.images?.length ?? 0,
      age_days:     Math.floor((Date.now() - new Date(plan.createdAt).getTime()) / 86_400_000),
    })
    if (plan.wiringResult) {
      // タブの指定なし＝機材から開く。開き直す目的はたいてい「何を置いているか」の確認で、
      // 配線図は見るのに構えが要る
      navigation.navigate('WiringResult', { planId: plan.id })
    } else {
      openGearStepById(plan.id)
    }
  }

  const renderLeftActions = (plan: DeskPlan, progress: Animated.AnimatedInterpolation<number>, commit: () => void) => (
    <DeskSwipeLeftActions
      pinned={!!plan.favorite}
      onTogglePin={commit}
      onDuplicate={() => handleDuplicate(plan)}
      progress={progress}
      colors={colors}
      t={t}
    />
  )

  // 作成途中の行（まだデスクになっていない下書き）も同じ削除ボタンを使う
  const renderRightActions = (onDelete: () => void, progress: Animated.AnimatedInterpolation<number>) => (
    <DeskSwipeRightActions onDelete={onDelete} progress={progress} t={t} />
  )

  const sharing = useDeskSharing({ navigation, publishStates, setPublishStates })
  const { handleShare } = sharing

  // ピン留めしたデスクは常に先頭。その中は最後に触った順（displaySettings 参照）
  const compare = comparePlansBy(DEFAULT_PLAN_SORT, planOpenedAt)
  const sortedPlans = [...myPlans].sort((a, b) => {
    if (a.favorite && !b.favorite) return -1
    if (!a.favorite && b.favorite) return 1
    return compare(a, b)
  })

  // 作成途中のデスクは一覧の先頭にまとめる。完成したデスクと混ぜて並べると、
  // 開き直したいデスクの間に「作成を続ける」の行が挟まって探しにくい。
  // 見出し（ListHeaderComponent）より上には置かない。一覧の外の別物に見える
  const setupDraftWithoutPlan = setupDraft && !('planId' in setupDraft) ? setupDraft : null
  const setupDraftPlanId = setupDraft && 'planId' in setupDraft ? setupDraft.planId : null
  // 配線図がまだ無いデスクは、開くだけでは進められない（開くと機材の選択から再開する）
  const isInProgress = (plan: DeskPlan) => plan.id === setupDraftPlanId || !plan.wiringResult
  const completedPlans = sortedPlans.filter((p) => !isInProgress(p))
  const inProgressPlans = sortedPlans.filter(isInProgress)
  const rows: PlanListRow[] = [
    ...(setupDraftWithoutPlan ? [{ kind: 'setupDraft', draft: setupDraftWithoutPlan } as const] : []),
    ...inProgressPlans.map((plan): PlanListRow => ({ kind: 'plan', plan })),
    ...completedPlans.map((plan): PlanListRow => ({ kind: 'plan', plan })),
  ]


  // 配線図まで作り終えた最初の来訪で、先頭のカードを揺らして見せる
  useSwipePeekHint({
    storageKey: '@plan_list_swipe_hint_seen_v1',
    rowId: completedPlans[0]?.id ?? null,
    rows: swipeableRefs,
  })

  // 以下はタイル（DeskGridTile）へ渡す材料。
  //
  // タイルは memo なので、行ごとに新しい関数を渡すと1件動いただけで全件描き直される。
  // ハンドラは id を受け取る形に固定し、デスクの実体は ref から引く
  const plansRef = useRef<DeskPlan[]>([])
  plansRef.current = myPlans

  const handlePlanPressRef = useRef(handlePlanPress)
  handlePlanPressRef.current = handlePlanPress
  const recordPlanOpenedRef = useRef(recordPlanOpened)
  recordPlanOpenedRef.current = recordPlanOpened
  const setupDraftRef = useRef(setupDraft)
  setupDraftRef.current = setupDraft
  const handleShareRef = useRef(handleShare)
  handleShareRef.current = handleShare

  const openPlanById = useCallback((planId: string) => {
    const plan = plansRef.current.find((p) => p.id === planId)
    if (plan) handlePlanPressRef.current(plan)
  }, [])

  const continueById = useCallback((planId: string) => {
    recordPlanOpenedRef.current(planId)
    const draft = setupDraftRef.current
    if (draft && 'planId' in draft && draft.planId === planId) {
      resumeFirstSetup(draft)
      return
    }
    openGearStepById(planId)
  }, [openGearStepById, resumeFirstSetup])

  const resumeDraftById = useCallback((_draftId: string) => {
    const draft = setupDraftRef.current
    if (draft && !('planId' in draft)) resumeFirstSetup(draft)
  }, [resumeFirstSetup])

  const shareById = useCallback((planId: string) => {
    const plan = plansRef.current.find((p) => p.id === planId)
    if (plan) void handleShareRef.current(plan)
  }, [])

  // 長押しで名前を変える。共有デスクは自分のものではないので変えられない
  const [renamingPlan, setRenamingPlan] = useState<DeskPlan | null>(null)
  const startRename = useCallback((planId: string) => {
    const plan = plansRef.current.find((p) => p.id === planId)
    if (plan && !plan.isShared) setRenamingPlan(plan)
  }, [])

  // 読めなかったのを「まだ1件も作っていない」と見せない。ここで見本カードを出すと、
  // 既にデスクを持っている人が新規作成に進み、空のまま保存されたと誤解する
  if (plansLoadError && sortedPlans.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgList }]}>
        <RetryState
          message={lang === 'ja' ? 'デスクを読み込めませんでした。' : 'Could not load your desks.'}
          onRetry={() => { void reload() }}
        />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.container, { backgroundColor: colors.bgList }]}>
      {coach.overlay}
      <CoachScope coach={coach}>
      <FlatList
        ref={listRef}
        {...scrollHandlers}
        scrollEventThrottle={16}
        data={rows}
        keyExtractor={planListRowKey}
        ListHeaderComponent={rows.length > 0 ? (
          <View style={styles.listHeader}>
            <View style={styles.planCountRow}>
              <Text style={[styles.listHeaderTitle, { color: colors.text }]}>
                {lang === 'ja' ? 'デスク一覧' : 'Your desks'}
              </Text>
              {/* 無制限（Pro）のときは分母が無いので出さない */}
              {planLimit > 0 && (
                <TouchableOpacity
                  ref={coachTarget('plan-limit')}
                  style={styles.planLimitBadge}
                  onPress={() => openPlanPaywall('plan_list_badge')}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={lang === 'ja'
                    ? `作成したデスク ${myPlans.length}件 / 上限${planLimit}件。Pro の案内を開きます`
                    : `${myPlans.length} of ${planLimit} desks used. Opens Pro details`}
                >
                  <Text style={[styles.planLimitCount, { color: atPlanLimit ? colors.accentText : colors.textMuted }]}>
                    {myPlans.length} / {planLimit}
                  </Text>
                  {atPlanLimit && <AppIcon name={ICONS.lock} size={13} color={colors.accentText} />}
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.listHeaderMeta, { color: atPlanLimit ? colors.accentText : colors.textMuted }]}>
              {atPlanLimit
                ? (lang === 'ja'
                  ? `無料プランはデスク${planLimit}件まで。Pro にすると無制限に作れます`
                  : `The free plan is limited to ${planLimit} desks. Go Pro for unlimited desks.`)
                : (lang === 'ja'
                  ? `${sortedPlans.length}件・作成途中とピン留めを優先して更新順に表示`
                  : `${sortedPlans.length} ${sortedPlans.length === 1 ? 'desk' : 'desks'} · Unfinished and pinned first, then recently updated`)}
            </Text>
          </View>
        ) : plansLoading ? (
          // 読み込み中も見出しの場所を取る。無いと骨組みが上に詰まり、一覧が出た瞬間に見出しの高さぶん下へずれる
          <View style={styles.listHeader}>
            <View style={styles.planCountRow}>
              <Text style={[styles.listHeaderTitle, { color: colors.text }]}>
                {lang === 'ja' ? 'デスク一覧' : 'Your desks'}
              </Text>
            </View>
            <Skeleton width="62%" height={styles.listHeaderMeta.fontSize * 1.2} radius={4} />
          </View>
        ) : null}
        renderItem={({ item: row }) => {
          if (row.kind === 'setupDraft') {
            const draft = row.draft
            return (
              <RemovalMotion ref={(handle) => removal.setRef(SETUP_DRAFT_ROW_ID, handle)}>
              <SwipeableRow
                ref={(ref) => {
                  if (ref) swipeableRefs.current.set(SETUP_DRAFT_ROW_ID, ref)
                  else swipeableRefs.current.delete(SETUP_DRAFT_ROW_ID)
                }}
                // まだデスクになっていないので、ピン留め・複製は出さない
                renderRightActions={(progress) => renderRightActions(discardSetupDraft, progress)}
                {...SWIPEABLE_ROW_PROPS}
                rightThreshold={SWIPE_OPEN_THRESHOLD}
                overshootRight={false}
              >
                <View ref={coachTarget('setup-draft')} style={styles.tileWrap}>
                <DeskGridTile
                  id={SETUP_DRAFT_ROW_ID}
                  title={lang === 'ja' ? '新しいデスク' : 'New desk'}
                  widePhoto
                  purposes={draft.purposes}
                  lang={lang}
                  fmtPrice={fmtPrice}
                  colors={colors}
                  isDark={isDark}
                  onPress={resumeDraftById}
                  footerLabel={lang === 'ja' ? '作成を続ける' : 'Continue setup'}
                  onFooter={resumeDraftById}
                />
                </View>
              </SwipeableRow>
              </RemovalMotion>
            )
          }

          const item = row.plan
          return (
          <RemovalMotion ref={(handle) => removal.setRef(item.id, handle)}>
          <SwipeCommitRow
            onRowRef={(ref) => {
              if (ref) swipeableRefs.current.set(item.id, ref)
              else swipeableRefs.current.delete(item.id)
            }}
            commitDistance={144}
            closeOnShortSwipe={false}
            onCommit={() => togglePin(item)}
            renderCommitActions={(progress, commit) => renderLeftActions(item, progress, commit)}
            renderRightActions={(progress) => renderRightActions(() => confirmDelete(item), progress)}
            leftThreshold={40}
            rightThreshold={SWIPE_OPEN_THRESHOLD}
            overshootLeft={false}
            overshootRight={false}
          >
            {/* 余白はスワイプの内側に置く（スワイプで出るボタンは、この余白の中に並ぶ前提で位置を決めている）。
                旧カードから DeskGridTile へ替えたときにこの余白ごと落ち、タイルが画面の端まで広がって上下もくっついていた */}
            {/* 案内の対象はすべての行に付ける。先頭の1件だけだと、スクロールで先頭が隠れたとき
                ほかのカードが見えていても説明ごと飛ばされる。測るときは見えている行が選ばれる */}
            <View ref={coachTarget(isInProgress(item) ? 'setup-draft' : 'desk-card')} style={styles.tileWrap}>
            <DeskGridTile
              id={item.id}
              coachKey={isInProgress(item) ? undefined : 'desk-card'}
              title={item.name}
              photoUri={item.images?.[0]}
              widePhoto
              purposes={item.purposes}
              publishState={publishStates[item.id] ?? 'none'}
              // ピン留めは並び順にしか出ていなかった。写真の左上は他の一覧で
              // 更新マークが座っている場所なので、同じ枠を使う
              updatedLabel={item.favorite ? t('planList.pinned') : null}
              updatedIcon="pin"
              updatedIconOnly
              lang={lang}
              fmtPrice={fmtPrice}
              colors={colors}
              isDark={isDark}
              onPress={openPlanById}
              onLongPress={item.isShared ? undefined : startRename}
              // 共有リンクから取り込んだデスクは自分のものではないので公開させない
              actionIcon={item.isShared ? undefined : ICONS.share}
              actionLabel={t('a11y.shareDesk')}
              onAction={item.isShared ? undefined : shareById}
              footerLabel={isInProgress(item) ? (lang === 'ja' ? '作成を続ける' : 'Continue setup') : undefined}
              onFooter={continueById}
            />
            </View>
          </SwipeCommitRow>
          </RemovalMotion>
          )
        }}
        ListEmptyComponent={plansLoading ? (
          <ListSkeleton count={3} variant="card" widePhoto inset="horizontal" />
        ) : (
          <EmptyState
            onCreate={startFromTemplate}
            onExplore={() => navigation.getParent()?.navigate('FeedTab')}
            colors={colors}
            t={t}
          />
        )}
        ListFooterComponent={<AdBanner />}
        contentContainerStyle={rows.length === 0 ? styles.emptyContent : styles.list}
        // 入力中でもボタンが1タップで反応するようにする（キーボードを閉じるだけで
        // タップが消費されると「読み込む」が2回押しになる）
        keyboardShouldPersistTaps="handled"
      />
      </CoachScope>

      {/* 右下の丸ボタン：デスク作成の主導線。まず利用目的を選ぶ画面へ進む。
          空状態は中央の「デスクを作る」が主導線なので出さない。並べると同じ操作の
          入口が2つになる */}
      {(rows.length > 0 || setupDraft !== null) && (
      <NewDeskFab onPress={startFromTemplate} locked={atPlanLimit} buttonRef={coachTarget('new-desk')} />
      )}

      <UndoSnackbar
        visible={undoSnackbar.visible}
        message={undoSnackbar.message}
        lang={lang}
        backgroundColor={colors.text}
        textColor={colors.card}
        accentColor={colors.accent}
        onUndo={undoSnackbar.undo}
        undoing={undoSnackbar.undoing}
      />

      {sharing.modals}

      <DeskRenameModal
        plan={renamingPlan}
        autoName={renamingPlan ? autoDeskName(renamingPlan, lang) : ''}
        colors={colors}
        t={t}
        onClose={() => setRenamingPlan(null)}
        onCommit={(plan, text) => rename(plan, text, autoDeskName(plan, lang))}
      />
    </SafeAreaView>
  )
}

function EmptyState({ onCreate, onExplore, colors, t }: { onCreate: () => void; onExplore: () => void; colors: AppColors; t: any }) {
  const exploreTarget = useCoachTarget('empty-explore')
  return (
    <EmptyStateView
      icon={TAB_ICONS.plan}
      title={t('planList.emptyTitle')}
      description={t('planList.emptyDesc')}
      actionLabel={t('planList.createFirst')}
      onAction={onCreate}
      colors={colors}
      coachTarget="empty-create"
    >
      {/* 作る前に人のデスクを見たい人もいる。共有のもう半分への入口をここにも置く */}
      <TouchableOpacity
        ref={exploreTarget}
        style={styles.emptyExplore}
        onPress={onExplore}
        activeOpacity={0.7}
        accessibilityRole="button"
      >
        <Text style={[styles.emptyExploreText, { color: colors.accentText }]}>{t('planList.exploreFirst')}</Text>
      </TouchableOpacity>
    </EmptyStateView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingTop: 12, paddingBottom: 100 },
  // 空状態を画面の縦中央に置くための余り。EmptyState 側が flex: 1 で吸う
  emptyContent: { flexGrow: 1, paddingTop: 12, paddingBottom: 100 },
  emptyExplore: { marginTop: 14, paddingVertical: 8, paddingHorizontal: 12 },
  emptyExploreText: { fontSize: 14, fontWeight: '600' },
  listHeader: { marginHorizontal: 16, marginBottom: 10 },
  listHeaderTitle: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  listHeaderMeta: { fontSize: 12 },
  planCountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  planLimitBadge: { flexDirection: 'row', alignItems: 'center' },
  planLimitCount: { fontSize: 13, fontWeight: '700' },
  // 色は colors.info（テーマごとに明度が違う）で上書きする。ここで固定色にすると
  // ダークモードでカードだけ明るい水色に浮く


  // 投稿・みんなのデスクの一覧と同じ横余白・間隔
  tileWrap: { marginHorizontal: UI_METRICS.screenGutter, marginBottom: TILE_GAP },


})
