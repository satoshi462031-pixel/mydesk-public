import { Alert } from '../utils/alert'
// マイページの「デスク」タブ — 自分のデスク全部（未公開を含む）。
// マイページのタブとして埋め込む（headerSlot のプロフィールは一覧と一緒に流れ、
// scrollY を返すとタブバーだけが上端に残る）。いいね・保存・ガジェットの各タブと同じ形。
//
// 以前は公開中のデスクだけを「投稿」として並べていた。投稿はデスクの一部でしかなく、
// プロフィールの数字でも「投稿」と「デスク」を別物のように数えていたので、
// デスクを1つの一覧にして、公開中・URL限定・未公開をバッジで見分ける形にした。
//
// 自分の端末にあるデスクの操作はマイデスクの一覧（PlanListScreen）と同じにしてある：
// 右へスワイプでピン留め・複製、左へスワイプで削除、長押しで名前の変更、右端の共有アイコン。
// 別の端末で公開しただけのデスクは手元に中身が無いので、公開の操作だけを「…」にまとめる。
import { useFocusEffect } from '@react-navigation/native'
import { RemovalMotion, useRemovalMotion } from '../components/molecules/RemovalMotion'
import * as WebBrowser from 'expo-web-browser'
import { useScrollToTopOf } from '../hooks/useScrollToTopOf'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertButton,
  Animated,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { DeskGridTile } from '../components/molecules/DeskGridTile'
import { DeskRenameModal } from '../components/molecules/DeskRenameModal'
import { DESK_TILE_GAP, DeskSwipeLeftActions, DeskSwipeRightActions } from '../components/molecules/DeskSwipeActions'
import { SwipeCommitRow } from '../components/molecules/SwipeCommitRow'
import { EmptyState } from '../components/molecules/EmptyState'
import { CoachAnchor, useCoachTarget } from '../hooks/useCoachMarks'
import { UndoSnackbar } from '../components/molecules/UndoSnackbar'
import { NewDeskFab } from '../components/molecules/NewDeskFab'
import { useEntitlement } from '../hooks/useEntitlement'
import { ListSkeleton } from '../components/molecules/ListSkeleton'
import { UNLISTED_PUBLISH_ENABLED } from '../constants/features'
import { useSwipePeekHint } from '../hooks/useSwipePeekHint'
import { autoDeskName } from './PurposeSelectionScreen'
import { ICONS, TAB_ICONS } from '../constants/icons'
import { getDeskShareUrl } from '../services/deskShareLinks'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { useDeskActions } from '../hooks/useDeskActions'
import { useDeskSharing } from '../hooks/useDeskSharing'
import { useGadgets } from '../hooks/useGadgets'
import { sumDeviceQuantities, sumGadgetPrices } from '../utils/gadgetStats'
import { usePlans } from '../hooks/usePlans'
import { getUserDeskSummaries } from '../services/desks'
import {
  getPlanPublishStates,
  getPublishedDeskId,
  getPublishedVisibility,
  isPhotoRevocationIncomplete,
  recoverPendingPublications,
  PlanPublishState,
  publishStateOf,
  setPlanVisibility,
  setDeskVisibility,
  unpublishDesk,
} from '../services/publishService'
import { copyPublicUrl, shareDesk } from '../services/shareService'
import { DeskPlan, PlanPurpose } from '../types'
import { DeskChange, summarizeDeskChanges } from '../utils/deskChangeSummary'
import { formatDate } from '../utils/dateFormat'
import { QUICK_TIMEOUT_MS, userErrorMessage, withTimeout } from '../utils/networkError'
import { buildOwnDeskRows, OwnDeskRow, sortPinnedFirst } from '../utils/publishedMyDesk'
import { getMyDeskReactions } from '../services/deskReactions'
import { DeskReaction, reactionSummary } from '../utils/deskReactions'
import { navigateToTabRoot } from '../utils/tabNavigation'
import { MyPageNavigation } from '../navigation/screenProps'
import { ScrollSyncRequest } from '../utils/collapsibleTabScroll'
import { SWIPE_OPEN_THRESHOLD, UI_METRICS } from '../constants/ui'
import { FirstSetupDraft, loadFirstSetupDraft } from '../store/firstSetupStore'
import { loadPlanOpenedAt, markPlanOpenedAt, PlanOpenedAt } from '../store/planOpenedStore'
import { planTouchedAt } from '../store/displaySettings'
import { firstSetupResumeNavigation, shouldShowSetupDraft } from '../utils/firstSetupResume'
import { useMyPageScrollIndicatorInsets } from '../hooks/useMyPageScrollIndicator'
import { useScrollSyncRetry } from '../hooks/useScrollSyncRetry'
import { compositionFromPlan, compositionTemplateId } from '../utils/deskComposition'
import { ownShareTag } from '../utils/publicAuthor'

const SETUP_DRAFT_ROW_KEY = 'first-setup-draft'

function setupDraftRowKey(draft: FirstSetupDraft): string {
  return 'planId' in draft ? `plan-${draft.planId}` : SETUP_DRAFT_ROW_KEY
}

function isOpenRow(row: OwnDeskRow): boolean {
  return !!row.deskId && (row.visibility === 'public' || row.visibility === 'unlisted')
}

export function PublishedDeskListScreen({
  navigation, headerSlot, userId, active, scrollY, scrollSyncRequest, minimumContentHeight, onDeskCountChange, onCountChange,
}: {
  navigation: MyPageNavigation
  headerSlot: React.ReactNode
  userId: string | null
  active: boolean
  /** マイページの固定タブバーへ渡すスクロール量。埋め込み時のみ */
  scrollY?: Animated.Value
  scrollSyncRequest?: ScrollSyncRequest
  minimumContentHeight?: number
  /** この端末にある作成途中を含むデスク数。プロフィールの「デスク」に出す */
  onDeskCountChange?: (count: number) => void
  /** 公開ページを開けるデスク（公開中・URL限定）の数。プロフィールの「公開」に出す */
  onCountChange?: (count: number) => void
}) {
  const { colors: C, t, lang, isDark, fmtPrice } = useApp()
  // 自分のデスクの一覧なので、共有URLに載せる @ID は自分のもの
  const { profile } = useAuth()
  const ownerTag = ownShareTag(profile)
  const { plans } = usePlans()
  const { gadgets } = useGadgets()
  const [setupDraft, setSetupDraft] = useState<FirstSetupDraft | null>(null)
  const ja = lang === 'ja'
  // スワイプで開いた行は、操作の直前と削除のあとに閉じる・片付ける（マイデスクの一覧と同じ）
  const swipeableRefs = useRef<Map<string, Swipeable>>(new Map())
  const removal = useRemovalMotion()
  const deskActions = useDeskActions({
    navigation,
    limitPlacement: 'my_page_desks',
    removeWithMotion: useCallback((id: string, operation: () => Promise<void>) =>
      removal.run(id === SETUP_DRAFT_ROW_KEY ? id : `plan-${id}`, operation), [removal]),
    onBeforeAction: useCallback((planId: string) => swipeableRefs.current.get(`plan-${planId}`)?.close(), []),
    onDeleted: useCallback((planId: string) => { swipeableRefs.current.delete(`plan-${planId}`) }, []),
    onSetupDraftCleared: useCallback(() => setSetupDraft(null), []),
  })
  const [renamingPlan, setRenamingPlan] = useState<DeskPlan | null>(null)

  // マイデスクのデータは既に端末内にあるため、公開状態の読み込みを待たず最初の描画から出す。
  // userId と内容もキーに含め、別ユーザーや編集前の非同期結果を一瞬表示しないようにする。
  // 公開デスクから組み立てた読み取り専用のデスク（isShared）はマイデスクの一覧に出さないので、ここでも外す
  const ownPlans = useMemo(() => plans.filter((p) => !p.isShared), [plans])
  // 上限の数え方はマイデスクの一覧と同じ（自分で作ったデスクだけ）
  const { checkLimit } = useEntitlement()
  const atPlanLimit = !checkLimit('maxWiringPlans', ownPlans.length)
  const newDeskTarget = useCoachTarget('mypage-new-desk')
  // 作成はマイデスクのタブで進む。作成途中の控え・上限の確認もそこの一覧が持つので、一覧へ頼む
  const startCreate = useCallback(() => {
    navigateToTabRoot(navigation, 'PlanTab', 'PlanList', { createRequest: Date.now() }, { lang })
  }, [navigation, lang])
  const localSummaries = useMemo(
    () => ownPlans.map((p) => ({ planId: p.id, name: p.name, updatedAt: p.updatedAt })),
    [ownPlans],
  )
  const localRows = useMemo(
    () => buildOwnDeskRows(localSummaries, [], null),
    [localSummaries],
  )
  const rowSourceKey = useMemo(
    () => JSON.stringify([userId, localSummaries]),
    [userId, localSummaries],
  )
  const [rows, setRows] = useState<OwnDeskRow[]>([])
  const [loadedRowSourceKey, setLoadedRowSourceKey] = useState<string | null>(null)
  const pinnedPlanIds = useMemo(() => new Set(plans.filter((p) => p.favorite).map((p) => p.id)), [plans])
  const [planOpenedAt, setPlanOpenedAt] = useState<PlanOpenedAt>({})
  const loadedRows = loadedRowSourceKey === rowSourceKey ? rows : localRows
  const visibleRows = useMemo(() => {
    // マイデスクのタブと同じ並び（作成途中 → ピン留め → 最後に触った順）。公開中のデスクを
    // サーバーの公開日時で並べていて、開いただけのデスクも上がらず、同じデスクが2つの一覧で
    // 違う位置に出ていた。他の端末で公開したデスク（この端末に無い）は公開日時で並べる
    const planById = new Map(ownPlans.map((p) => [p.id, p]))
    const planOf = (row: OwnDeskRow) => (row.planId ? planById.get(row.planId) : undefined)
    const touchedAt = (row: OwnDeskRow) => {
      const plan = planOf(row)
      return plan ? planTouchedAt(plan, planOpenedAt) : row.updatedAt ?? ''
    }
    const inProgress = (row: OwnDeskRow) => {
      const plan = planOf(row)
      return !!plan && (!plan.wiringResult || (setupDraft && 'planId' in setupDraft && setupDraft.planId === plan.id))
    }
    const byTouched = [...loadedRows].sort((a, b) => touchedAt(b).localeCompare(touchedAt(a)))
    const sorted = sortPinnedFirst(byTouched, pinnedPlanIds)
      .sort((a, b) => Number(inProgress(b)) - Number(inProgress(a)))
    if (!setupDraft) return sorted

    const draftKey = setupDraftRowKey(setupDraft)
    const savedRow = sorted.find((row) => row.key === draftKey)
    if (savedRow) return sorted
    // 指すデスクが無い控え（削除の「元に戻す」の間にアプリを閉じた等）は行を作らない。
    // 作ると開けない「新しいデスク」が並び、デスク数も1つ多くなる（マイデスクの一覧と同じ扱い）
    if ('planId' in setupDraft) return sorted

    return [{
      key: draftKey,
      planId: null,
      name: ja ? '新しいデスク' : 'New desk',
      deskId: null,
      visibility: null,
      onThisDevice: true,
      updatedAt: null,
    }, ...sorted]
  }, [ja, loadedRows, pinnedPlanIds, setupDraft, ownPlans, planOpenedAt])
  const openCount = visibleRows.filter(isOpenRow).length
  const localCount = visibleRows.filter((row) => row.onThisDevice).length
  useEffect(() => {
    onDeskCountChange?.(localCount)
  }, [localCount, onDeskCountChange])
  useEffect(() => {
    onCountChange?.(openCount)
  }, [onCountChange, openCount])
  // 「公開中だが公開後に中身が変わっている」を出すために先に読む。端末内の記録だけなので
  // 通信は起きない。デスク一覧・デスク画面と同じ判定を使う
  const [publishStates, setPublishStates] = useState<Record<string, PlanPublishState>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  // 公開中のデスクへの反応（086）。件数は持ち主にだけ見せる（誰が押したかは出さない）
  const [reactionByDeskId, setReactionByDeskId] = useState<Map<string, DeskReaction>>(new Map())
  // 2回目以降はスピナーへ戻さないための印。読み込み済みかどうかだけを見るので
  // state にせず ref に持つ（これで再描画は起きない）
  const loadedRef = useRef(false)

  // 奥まで見たあとプロフィールへ戻る手段が要る。ステータスバーのタップで先頭へ戻す
  const listRef = useRef<Animated.FlatList>(null)
  const scrollIndicatorInsets = useMyPageScrollIndicatorInsets()
  // 下のタブバーを押したときに先頭へ戻すのは、**表示中のタブだけ**。
  // マイページは一覧を display で出し分けたまま保持していて、全部登録すると
  // 隠れているタブまで先頭へ戻り、「タブごとにスクロール位置を保つ」作りが崩れる
  useScrollToTopOf(() => (active ? listRef.current : null))
  const { handlers: scrollSyncHandlers, isActive: scrollActive } = useScrollSyncRetry(scrollSyncRequest, active, (offset) => {
    listRef.current?.scrollToOffset({ offset, animated: false })
  }, scrollY)

  // マイページに埋め込んだときだけ、上端に貼り付くタブバーへスクロール量を渡す
  const onScroll = useMemo(
    () => (scrollY
      ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })
      : undefined),
    [scrollY],
  )

  // deskId のマッピングは公開を取り消したあとも残る（再公開で同じURLを保つため）。
  // 見え方はサーバーが読めたときはサーバーを正とする（別の端末で切り替えた等を拾う）
  const load = useCallback(async () => {
    await recoverPendingPublications().catch(() => {})
    const localPublished = (await Promise.all(localSummaries.map(async (p) => {
      try {
        const [deskId, visibility] = await Promise.all([
          getPublishedDeskId(p.planId),
          getPublishedVisibility(p.planId),
        ])
        return deskId ? { planId: p.planId, deskId, visibility } : null
      } catch {
        return null
      }
    }))).filter((desk) => desk != null)

    if (!userId) return buildOwnDeskRows(localSummaries, localPublished, null)
    try {
      return buildOwnDeskRows(localSummaries, localPublished, await getUserDeskSummaries(userId))
    } catch {
      return buildOwnDeskRows(localSummaries, localPublished, null)
    }
  }, [localSummaries, userId])

  // タブを移動している間に公開・非公開が変わるため、戻るたび読み直す。
  // 隠れているタブでは走らせない（タブぶんの取得が同時に飛ぶ）
  useFocusEffect(useCallback(() => {
    if (!active) return
    let cancelled = false
    // 2回目以降は前回の一覧を出したまま裏で取り直す。毎回スピナーに戻すと
    // タブを行き来するだけで一覧がいったん消えて見える
    if (!loadedRef.current) setLoading(true)
    load()
      .then((next) => {
        if (!cancelled) {
          setRows(next)
          setLoadedRowSourceKey(rowSourceKey)
          loadedRef.current = true
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    // 件数は一覧とは別に取る。取れなくても一覧は出す
    if (userId) {
      getMyDeskReactions()
        .then((list) => { if (!cancelled) setReactionByDeskId(new Map(list.map((r) => [r.deskId, r]))) })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [load, rowSourceKey, active, userId]))

  useFocusEffect(useCallback(() => {
    if (!active) return
    let alive = true
    // マイデスクの一覧と同じ判定で出す。通さずにいたので、用途を選んだだけの下書きが
    // こちらにだけ「新しいデスク」として並び、プロフィールのデスク数にも1つ多く数えられていた
    void loadFirstSetupDraft()
      .then((draft) => { if (alive) setSetupDraft(shouldShowSetupDraft(draft) ? draft : null) })
      .catch(() => { if (alive) setSetupDraft(null) })
    void loadPlanOpenedAt().then((openedAt) => { if (alive) setPlanOpenedAt(openedAt) })
    return () => { alive = false }
  }, [active]))

  // plan.updatedAt が動いたら読み直す（＝中身が変わりうるのはそのときだけ）
  const publishStateKey = plans.map((p) => `${p.id}:${p.updatedAt}`).join('|')
  useEffect(() => {
    if (!active) return
    let alive = true
    void getPlanPublishStates(plans, gadgets)
      .then((states) => { if (alive) setPublishStates(states) })
      .catch(() => {})
    return () => { alive = false }
    // plans / gadgets は参照が頻繁に変わるので、値から作った key で必要なときだけ読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishStateKey, gadgets, active])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setRows(await load())
      setLoadedRowSourceKey(rowSourceKey)
    } catch {
      // 失敗しても前回の一覧を残す。空にすると公開を取り消したように見える
    } finally {
      setRefreshing(false)
    }
  }, [load, rowSourceKey])

  const sharing = useDeskSharing({ navigation, publishStates, setPublishStates })
  const { sharePlan, publishedDeskId, publishedVisibility } = sharing
  useEffect(() => {
    if (!sharePlan || !publishedVisibility) return
    setRows((prev) => prev.map((row) => row.planId === sharePlan.id
      ? { ...row, deskId: publishedDeskId, visibility: publishedVisibility }
      : row))
  }, [sharePlan, publishedDeskId, publishedVisibility])

  const copyUrl = async (deskId: string) => {
    try {
      await copyPublicUrl(deskId, ownerTag)
    } catch (error) {
      Alert.alert(
        ja ? 'リンクをコピーできませんでした' : 'Could not copy link',
        userErrorMessage(error, lang, ja ? 'もう一度お試しください。' : 'Please try again.'),
      )
    }
  }

  const openUrl = async (deskId: string) => {
    try {
      await WebBrowser.openBrowserAsync(await getDeskShareUrl(deskId, ownerTag))
    } catch (error) {
      Alert.alert(
        ja ? '公開ページを開けませんでした' : 'Could not open public page',
        userErrorMessage(error, lang, ja ? 'もう一度お試しください。' : 'Please try again.'),
      )
    }
  }

  const changeVisibility = async (row: OwnDeskRow, next: 'public' | 'unlisted') => {
    if (!row.deskId || busyKey) return
    setBusyKey(row.key)
    try {
      // 端末にあるデスクは端末の記録も合わせる。合わせないと次にデスク画面を開いたとき
      // 前の見え方のバッジが出る
      const deskId = row.deskId
      await withTimeout(
        row.planId
          ? setPlanVisibility(row.planId, next)
          : setDeskVisibility(deskId, next),
        QUICK_TIMEOUT_MS,
      )
      setRows((prev) => prev.map((r) => (r.key === row.key ? { ...r, visibility: next } : r)))
    } catch (e) {
      const recoveries = await recoverPendingPublications().catch(() => [])
      const recovery = recoveries.find((item) => item.deskId === row.deskId)
      if (recovery?.visibility) {
        const visibility = recovery.visibility
        setRows((prev) => prev.map((r) => r.key === row.key ? { ...r, visibility } : r))
      }
      if (recovery?.status === 'recovered' && recovery.visibility === next) return

      Alert.alert(
        ja ? '見え方を変えられませんでした' : 'Could not change visibility',
        userErrorMessage(e, lang, ja ? '通信環境を確認して、もう一度お試しください。' : 'Check your connection and try again.'),
      )
    } finally {
      setBusyKey(null)
    }
  }

  const confirmUnpublish = (row: OwnDeskRow) => {
    if (busyKey || !row.deskId) return
    const deskId = row.deskId
    Alert.alert(
      row.visibility === 'private'
        ? (ja ? '公開停止を再試行しますか？' : 'Retry unpublishing?')
        : (ja ? '公開を取り消しますか？' : 'Unpublish this desk?'),
      row.visibility === 'private'
        ? (ja ? '写真の公開停止を再試行します。デスクは非公開のままです。' : 'Retry revoking photo access. The desk stays private.')
        : ja
        ? `「${row.name}」の公開ページが見られなくなり、共有したリンクも開けなくなります。`
        : `The public page for "${row.name}" will stop working, including links you shared.`,
      [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: ja ? '公開を取り消す' : 'Unpublish',
          style: 'destructive',
          onPress: async () => {
            setBusyKey(row.key)
            try {
              await withTimeout(unpublishDesk(deskId, row.planId), QUICK_TIMEOUT_MS)
              // 端末にあるデスクは「非公開」として残す。別の端末で公開しただけのデスクは
              // 手元に中身が無く、開いても何もできないので一覧から外す
              setRows((prev) => (row.planId
                ? prev.map((r) => (r.key === row.key ? { ...r, visibility: 'private' as const } : r))
                : prev.filter((r) => r.key !== row.key)))
            } catch (e) {
              const recoveries = await recoverPendingPublications().catch(() => [])
              const recovery = recoveries.find((item) => item.deskId === row.deskId)
              if (recovery?.visibility) {
                const visibility = recovery.visibility
                setRows((prev) => prev.map((r) => r.key === row.key ? { ...r, visibility } : r))
              }
              if (recovery?.status === 'recovered' && recovery.visibility === 'private') return

              if (isPhotoRevocationIncomplete(e)) {
                setRows((prev) => prev.map((r) => r.key === row.key ? { ...r, visibility: 'private' as const } : r))
                Alert.alert(
                  ja ? '写真の公開停止が未完了です' : 'Photo access is not fully revoked',
                  userErrorMessage(e, lang, ''),
                  [
                    { text: ja ? '閉じる' : 'Close', style: 'cancel' },
                    { text: ja ? '再試行' : 'Retry', onPress: () => confirmUnpublish({ ...row, visibility: 'private' }) },
                  ],
                )
                return
              }
              Alert.alert(
                ja ? '公開を取り消せませんでした' : 'Could not unpublish',
                userErrorMessage(e, lang, ja
                  ? '公開状態を確認できませんでした。通信環境を確認して、再試行してください。'
                  : 'Could not confirm visibility. Check your connection and retry.'),
              )
            } finally {
              setBusyKey(null)
            }
          },
        },
      ],
    )
  }

  // タイルは memo なので、行ごとに新しい関数を渡すと1件動いただけで全件描き直される。
  // ハンドラは key を受け取る形にして参照を固定し、行の実体と最新の openActions は ref から引く
  const rowsRef = useRef<OwnDeskRow[]>([])
  rowsRef.current = visibleRows
  const setupDraftRef = useRef(setupDraft)
  setupDraftRef.current = setupDraft

  const resumeSetup = useCallback((draft: FirstSetupDraft) => {
    const target = firstSetupResumeNavigation(draft)
    navigation.navigate(target as never)
  }, [navigation])

  // 端末にあるデスクはマイデスクのデスク画面で開く（編集も公開の操作もそこにある）。
  // 別の端末で公開しただけのデスクは手元に中身が無いので、公開ページを開く
  const openDesk = useCallback((key: string) => {
    if (!navigation.isFocused()) return
    const row = rowsRef.current.find((r) => r.key === key)
    if (!row) return
    if (row.planId) void markPlanOpenedAt(row.planId, plansRef.current.map((p) => p.id)).catch(() => {})
    const draft = setupDraftRef.current
    if (draft && setupDraftRowKey(draft) === key) {
      resumeSetup(draft)
      return
    }
    if (row.planId) {
      const plan = plansRef.current.find((p) => p.id === row.planId)
      if (plan && !plan.wiringResult) {
        const composition = compositionFromPlan(plan, gadgetsRef.current)
        navigation.navigate('TemplateDetail', {
          templateId: compositionTemplateId(composition),
          composition,
          returnPlanId: plan.id,
          purposes: plan.purposes ?? [],
          otherPurposeLabel: plan.otherPurposeLabel,
          otherPurposeIcon: plan.otherPurposeIcon,
          otherPurposeColor: plan.otherPurposeColor,
        })
        return
      }
      // マイページのスタックに積む。マイデスクのタブへ移すと、閉じたときにマイデスクの一覧へ戻る
      navigation.navigate('WiringResult', { planId: row.planId })
    } else if (row.deskId) {
      navigation.navigate('PublicDesk', { deskId: row.deskId, source: 'my_page' })
    }
  }, [navigation, resumeSetup])

  // 端末に中身が無い（別の端末で公開した）デスクの公開操作。端末にあるデスクの操作はスワイプ・長押しで行う
  const openActions = (row: OwnDeskRow) => {
    const deskId = row.deskId
    if (!deskId) return
    if (row.visibility === 'private') {
      Alert.alert(row.name, ja ? '非公開' : 'Private', [
        { text: ja ? '公開停止を再試行' : 'Retry unpublishing', onPress: () => confirmUnpublish(row) },
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
      ])
      return
    }
    const switchTo = row.visibility === 'unlisted' ? 'public' : 'unlisted'
    const buttons: AlertButton[] = [
      { text: ja ? 'リンクをコピー' : 'Copy link', onPress: () => { void copyUrl(deskId) } },
      { text: ja ? 'ブラウザで開く' : 'Open in browser', onPress: () => { void openUrl(deskId) } },
    ]
    if (UNLISTED_PUBLISH_ENABLED) {
      buttons.push({
        text: switchTo === 'unlisted'
          ? (ja ? 'URL限定にする' : 'Make unlisted')
          : (ja ? 'みんなのデスクに公開する' : 'Make public'),
        onPress: () => { void changeVisibility(row, switchTo) },
      })
    }
    buttons.push(
      { text: ja ? '公開を取り消す' : 'Unpublish', style: 'destructive', onPress: () => confirmUnpublish(row) },
      { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
    )
    Alert.alert(row.name, row.visibility === 'unlisted'
      ? (ja ? 'URL限定で公開中' : 'Unlisted')
      : (ja ? '公開中' : 'Public'), buttons)
  }

  const openActionsRef = useRef(openActions)
  openActionsRef.current = openActions

  const handleActions = useCallback((key: string) => {
    const row = rowsRef.current.find((r) => r.key === key)
    if (row) openActionsRef.current(row)
  }, [])

  // 名前の変更は長押し。共有リンクから取り込んだデスクは自分のものではないので変えられない
  const startRename = useCallback((key: string) => {
    const row = rowsRef.current.find((r) => r.key === key)
    const plan = row?.planId ? plansRef.current.find((p) => p.id === row.planId) : undefined
    if (plan && !plan.isShared) setRenamingPlan(plan)
  }, [])

  // 公開URLを共有シートへ（マイデスクの共有アイコン・公開プロフィールのタイルと同じ）
  const plansRef = useRef(plans)
  plansRef.current = plans
  const gadgetsRef = useRef(gadgets)
  gadgetsRef.current = gadgets
  const handleShareRef = useRef(sharing.handleShare)
  handleShareRef.current = sharing.handleShare
  const shareByKey = useCallback((key: string) => {
    const row = rowsRef.current.find((r) => r.key === key)
    if (!row) return
    const plan = row.planId ? plansRef.current.find((p) => p.id === row.planId) : undefined
    if (plan && !plan.isShared) {
      swipeableRefs.current.get(row.key)?.close()
      void handleShareRef.current(plan)
      return
    }
    if (!row.deskId || !isOpenRow(row)) return
    // 総額・台数はこの端末にあるデスクでだけ分かる。別の端末で公開したデスクは省く
    const deskGadgets = plan ? gadgetsRef.current.filter((g) => plan.selectedGadgetIds.includes(g.id)) : null
    void shareDesk({
      deskId: row.deskId,
      deskName: row.name,
      ownerTag,
      totalPrice: deskGadgets ? sumGadgetPrices(deskGadgets) : undefined,
      deviceCount: deskGadgets ? sumDeviceQuantities(deskGadgets) : undefined,
      // 写真もこの端末にあるデスクでだけ付けられる
      photoUris: plan?.images,
    }, lang).catch(() => {})
  }, [lang, ownerTag])

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans])
  // ピン留め・複製・削除ができるのは端末にある自分のデスクだけ。共有リンクから取り込んだ
  // デスクはマイデスクでも操作させていない
  const ownPlanOf = (row: OwnDeskRow): DeskPlan | undefined => {
    const plan = row.planId ? planById.get(row.planId) : undefined
    return plan && !plan.isShared ? plan : undefined
  }

  // 配線図まで作り終えた最初の来訪で、先頭のタイルを揺らして見せる（マイデスクの一覧と同じ記録を使う）
  const peekRow = visibleRows.find((row) => {
    const plan = ownPlanOf(row)
    return !!plan?.wiringResult
  })
  useSwipePeekHint({
    storageKey: '@plan_list_swipe_hint_seen_v1',
    rowId: peekRow?.key ?? null,
    rows: swipeableRefs,
    active,
  })

  // 撤去したガジェットは selectedGadgetIds から外れるが、入れ替えを見るには
  // 外した側も要る。gadgetUsage に記録が残っているものまで拾う
  const changeByPlanId = useMemo(() => {
    const map = new Map<string, DeskChange[]>()
    for (const plan of plans) {
      const ids = new Set([...plan.selectedGadgetIds, ...Object.keys(plan.gadgetUsage ?? {})])
      const summary = summarizeDeskChanges(gadgets.filter((g) => ids.has(g.id)), plan.gadgetUsage)
      if (summary) map.set(plan.id, summary.changes)
    }
    return map
  }, [plans, gadgets])

  return (
    <>
    <Animated.FlatList
      scrollIndicatorInsets={scrollIndicatorInsets}
      scrollsToTop={active}
      style={{ backgroundColor: C.bgList }}
      ref={listRef}
      {...scrollSyncHandlers}
      onScroll={scrollActive ? (onScroll ?? scrollSyncHandlers.onScroll) : undefined}
      scrollEventThrottle={16}
      data={visibleRows}
      keyExtractor={(row) => row.key}
      ListHeaderComponent={<>{headerSlot}</>}
      ListHeaderComponentStyle={visibleRows.length === 0 ? styles.headerBleed : styles.headerBleedList}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.textMuted} colors={[C.textMuted]} progressBackgroundColor={C.card} />}
      contentContainerStyle={[
        visibleRows.length === 0 ? styles.emptyContent : styles.listContent,
        minimumContentHeight ? { minHeight: minimumContentHeight } : undefined,
      ]}
      renderItem={({ item: row }) => {
        const coachKey = 'mypage-desk'
        const plan = row.planId ? planById.get(row.planId) : undefined
        const own = ownPlanOf(row)
        const draft = setupDraft && setupDraftRowKey(setupDraft) === row.key ? setupDraft : null
        const localState = row.planId ? publishStates[row.planId] : undefined
        const open = isOpenRow(row)
        const inProgress = !!draft || (!!own && !own.wiringResult)
        const canShare = !!own || open
        // 公開の操作の「…」は、手元に中身が無いデスクにだけ出す。端末にあるデスクはスワイプ・長押しで操作する
        const hasMenu = !!row.deskId && !plan
        const tile = (
          <DeskGridTile
            id={row.key}
            title={row.name}
            photoUri={plan?.images?.[0]}
            // マイデスクと同じ自分のデスクの一覧なので、タイルの形（写真 16:9・操作は本文側）も揃える。
            // 4:3 のままだと、同じデスクがタブによって違う切り取りで出ていた
            widePhoto
            purposes={(draft && !('planId' in draft) ? draft.purposes : plan?.purposes) as PlanPurpose[] | undefined}
            // 手元にあるデスクはマイデスクと同じ更新日を使う。
            updatedAt={plan?.updatedAt}
            meta={plan || draft ? null : [
              row.onThisDevice ? null : (ja ? '他の端末で作成' : 'From another device'),
              row.updatedAt ? formatDate(new Date(row.updatedAt), lang) : null,
              open && row.deskId ? reactionSummary(reactionByDeskId.get(row.deskId), lang) : null,
            ].filter(Boolean).join(ja ? '・' : ' · ') || null}
            // 手元にあるデスクはマイデスクと同じ公開状態、それ以外はサーバーの状態を使う。
            publishState={plan ? localState ?? publishStateOf(row.visibility) : draft ? undefined : publishStateOf(row.visibility)}
            // マイデスクの一覧と同じ場所・同じ絵（アイコンだけ）でピン留めを見せる
            updatedLabel={plan?.favorite ? t('planList.pinned') : null}
            updatedIcon="pin"
            updatedIconOnly
            change={row.planId ? changeByPlanId.get(row.planId) : undefined}
            lang={lang}
            fmtPrice={fmtPrice}
            colors={C}
            isDark={isDark}
            onPress={openDesk}
            onLongPress={own ? startRename : hasMenu ? handleActions : undefined}
            menuLabel={hasMenu ? t('a11y.deskMenu') : undefined}
            onMenu={hasMenu ? handleActions : undefined}
            actionIcon={canShare ? ICONS.share : undefined}
            actionLabel={canShare ? t('a11y.shareDesk') : undefined}
            actionDisabled={busyKey === row.key}
            onAction={canShare ? shareByKey : undefined}
            footerLabel={inProgress ? (ja ? '作成を続ける' : 'Continue setup') : undefined}
            onFooter={inProgress ? openDesk : undefined}
            coachKey={coachKey}
          />
        )
        // 余白はスワイプの内側に置く（スワイプで出るボタンは、この余白の中に並ぶ前提で位置を決めている）
        if (!own && !draft) return <CoachAnchor id="mypage-desk"><View style={styles.tileWrap}>{tile}</View></CoachAnchor>
        return (
          <RemovalMotion ref={(handle) => removal.setRef(row.key, handle)}>
          <SwipeCommitRow
            onRowRef={(ref) => {
              if (ref) swipeableRefs.current.set(row.key, ref)
              else swipeableRefs.current.delete(row.key)
            }}
            commitDistance={144}
            closeOnShortSwipe={false}
            onCommit={own ? () => deskActions.togglePin(own) : undefined}
            renderCommitActions={(progress, commit) => own ? (
              <DeskSwipeLeftActions
                pinned={!!own.favorite}
                onTogglePin={commit}
                onDuplicate={() => { void deskActions.duplicate(own) }}
                progress={progress}
                colors={C}
                t={t}
              />
            ) : null}
            renderRightActions={(progress) => (
              <DeskSwipeRightActions onDelete={() => {
                if (own) deskActions.confirmDelete(own)
                else if (draft) {
                  swipeableRefs.current.get(row.key)?.close()
                  deskActions.confirmDiscardSetup(draft, setSetupDraft)
                }
              }} progress={progress} t={t} />
            )}
            leftThreshold={40}
            rightThreshold={SWIPE_OPEN_THRESHOLD}
            overshootLeft={false}
            overshootRight={false}
          >
            <CoachAnchor id="mypage-desk" also={draft ? undefined : 'mypage-desk-own'}><View style={styles.tileWrap}>{tile}</View></CoachAnchor>
          </SwipeCommitRow>
          </RemovalMotion>
        )
      }}
      ListEmptyComponent={loading || loadedRowSourceKey !== rowSourceKey ? (
        <ListSkeleton count={2} variant="card" widePhoto inset="none" />
      ) : (
        <EmptyState
          // マイデスクのタブと同じ絵（空のときに「どこで作るか」と結び付くように）
          icon={TAB_ICONS.plan}
          title={t('planList.emptyTitle')}
          description={t('planList.emptyDesc')}
          actionLabel={t('planList.createFirst')}
          onAction={startCreate}
          colors={C}
          coachTarget="mypage-desk-empty"
        >
          <TouchableOpacity
            style={styles.emptyExplore}
            onPress={() => navigation.navigate('FeedTab')}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.emptyExploreText, { color: C.accentText }]}>{t('planList.exploreFirst')}</Text>
          </TouchableOpacity>
        </EmptyState>
      )}
    />
    {sharing.modals}
    <DeskRenameModal
      plan={renamingPlan}
      autoName={renamingPlan ? autoDeskName(renamingPlan, lang) : ''}
      colors={C}
      t={t}
      onClose={() => setRenamingPlan(null)}
      onCommit={(target, text) => deskActions.rename(target, text, autoDeskName(target, lang))}
    />
    {/* マイデスクと同じく、空のときは中央の案内が入口なので出さない */}
    {visibleRows.length > 0 && <NewDeskFab onPress={startCreate} locked={atPlanLimit} buttonRef={newDeskTarget} />}
    {/* 削除の取り消し。右下の作成ボタンに重ならない既定の高さに出す（マイデスクと同じ） */}
    <UndoSnackbar
      visible={deskActions.undoSnackbar.visible}
      message={deskActions.undoSnackbar.message}
      lang={lang}
      backgroundColor={C.text}
      textColor={C.card}
      accentColor={C.accent}
      onUndo={deskActions.undoSnackbar.undo}
      undoing={deskActions.undoSnackbar.undoing}
    />
    </>
  )
}

const styles = StyleSheet.create({
  // タイルの横余白は tileWrap が持つ（スワイプのボタンがその余白の中に並ぶため）
  // 下は右下の作成ボタンの分を空ける（マイデスクの一覧と同じ）
  listContent: { paddingTop: UI_METRICS.screenGutter, paddingBottom: 100 },
  emptyContent: { flexGrow: 1, padding: UI_METRICS.screenGutter },
  // 0件・読み込み中も、タブバーから最初のタイル（骨組み）までを一覧と同じ 12 にする。
  // 0 だった頃は読み込み中の骨組みがタブバーに貼り付き、一覧が出た瞬間に 12 下へずれた
  headerBleed: { marginHorizontal: -UI_METRICS.screenGutter, marginTop: -UI_METRICS.screenGutter, marginBottom: DESK_TILE_GAP },
  headerBleedList: { marginTop: -UI_METRICS.screenGutter, marginBottom: DESK_TILE_GAP },
  tileWrap: { marginHorizontal: UI_METRICS.screenGutter, marginBottom: DESK_TILE_GAP },
  emptyExplore: { marginTop: 14, paddingVertical: 8, paddingHorizontal: 12 },
  emptyExploreText: { fontSize: 14, fontWeight: '600' },
})
