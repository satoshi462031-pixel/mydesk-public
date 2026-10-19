import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useHeaderHeight } from '@react-navigation/elements'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import 'react-native-get-random-values'
import { v4 as uuidv4 } from 'uuid'
import { AppIcon } from '../components/atoms/AppIcon'
import { CategoryIcon } from '../components/atoms/CategoryIcon'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { SearchField } from '../components/atoms/SearchField'
import { Button } from '../components/atoms/Button'
import { BrandChip } from '../components/molecules/BrandChip'
import { BottomSheetModal } from '../components/molecules/BottomSheetModal'
import { MissingIntroductionDateChoice, MissingIntroductionDateSheet } from '../components/molecules/MissingIntroductionDateSheet'
import { CategorySectionPicker } from '../components/organisms/CategorySectionPicker'
import { ICONS } from '../constants/icons'
import { ADD_GADGET_COACH } from '../constants/gadgetCoachSteps'
import { COACH_SCREEN, CoachScope, useCoachMarks } from '../hooks/useCoachMarks'
import { PRODUCT_BROWSE_ENABLED } from '../constants/features'
import { useApp } from '../context/AppContext'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { usePlanOpenedAt } from '../hooks/usePlanOpenedAt'
import { sortPlansLikeMyDesk } from '../store/displaySettings'
import { useProductSuggestionsState } from '../hooks/useProductSuggestions'
import { CustomCategory, Gadget, GadgetCategory, GadgetStackParamList } from '../types'
import { ProductSuggestion } from '../utils/productSuggestions'
import { gadgetFromProduct } from '../utils/gadgetFromProduct'
import { updateDeskGadgetSelection } from '../utils/deskGadgetUsage'
import { localDateKey } from '../utils/deskTimeline'
import { showMessage } from '../utils/confirmation'
import { hapticError, hapticSuccess } from '../utils/haptics'
import { beginPlanReflection, endPlanReflection } from '../utils/planReflection'
import { analytics, EVENTS, trackOnce } from '../services/analytics'
import { UI_METRICS } from '../constants/ui'
import { GADGET_NAME_MAX_LENGTH } from '../constants/textLimits'
import { trimAndTruncate, truncateChars } from '../utils/truncateText'

// この画面は PlanStack と MyPageStack の両方に積まれる。どちらにも GadgetDetail があるので、
// 名前で移動するのはそこだけにして、ホスト側の ParamList には縛られない形にしてある
type Props = {
  route: { params: { presetId?: string; presetName?: string; planId?: string; category?: GadgetCategory; showCategoryPicker?: boolean; libraryOnly?: boolean; returnAfterAdd?: boolean; showWiringOnDone?: boolean } }
  navigation: Pick<
    NativeStackNavigationProp<GadgetStackParamList, 'AddGadget'>,
    'goBack' | 'setOptions' | 'addListener' | 'navigate' | 'isFocused'
  >
}

type CategoryChoice = { category: GadgetCategory; custom?: CustomCategory }

/**
 * カテゴリ選択を開いた理由。
 * filter: ジャンルから機材を追加する（名前はまだ決めていない）
 * assign: 名前だけで登録する／カテゴリの分からない商品を選んだ（登録するカテゴリを決める）
 */
type CategoryPickerPurpose =
  | { kind: 'filter' }
  | { kind: 'assign'; name: string; suggestion?: ProductSuggestion }

const RESULT_LIMIT = 30

/**
 * 機材の登録。商品を選んだ時点で登録が終わる（Buildesk のような手軽さを目指した）。
 * 以前はカテゴリ選択 → 端子・寸法・日付まで並ぶ長いフォームだった。それらは登録後に
 * 詳細画面（GadgetDetail）で直す。デスクを作るときは何台も続けて入れるので、
 * 1件ごとに戻らず、この画面に残って次を探せるようにしている。
 */
export function AddGadgetScreen({ route, navigation }: Props) {
  const headerHeight = useHeaderHeight()
  const insets = useSafeAreaInsets()
  const { add, gadgets: libraryGadgets } = useGadgets()
  const { plans, updateWith: updatePlanWith } = usePlans()
  // 「デスクにも追加」の一覧はマイデスクと同じ並びにする（作った順のままだと位置が違う）
  const planOpenedAt = usePlanOpenedAt()
  const pickerPlans = useMemo(() => sortPlansLikeMyDesk(plans, planOpenedAt), [plans, planOpenedAt])
  const { colors: C, t, lang, reduceMotion } = useApp()
  const planId = route.params?.planId
  const libraryOnly = route.params?.libraryOnly === true
  const returnAfterAdd = route.params?.returnAfterAdd === true
  const directCategorySelection = !!route.params?.showCategoryPicker && !route.params?.category

  const [query, setQuery] = useState(route.params?.presetName ?? '')
  const [filter, setFilter] = useState<CategoryChoice | null>(
    route.params?.category ? { category: route.params.category } : null,
  )
  const [pickerPurpose, setPickerPurpose] = useState<CategoryPickerPurpose | null>(null)
  const searchRef = useRef<TextInput>(null)
  const draftRegistrationIdRef = useRef<string | null>(null)
  const pendingDetailRef = useRef<Gadget | null>(null)
  const detailOpeningRef = useRef(false)
  const leavingRef = useRef(false)
  const pickerPurposeRef = useRef<CategoryPickerPurpose | null>(null)
  // キーボードは画面遷移の後に出す。ジャンル選択は画面内に直接描画し、中間画面を挟まない。
  const focusOnEnter = PRODUCT_BROWSE_ENABLED && !route.params?.category && !directCategorySelection
  useEffect(() => {
    let entered = false
    const enter = () => {
      if (entered) return
      entered = true
      if (focusOnEnter) searchRef.current?.focus()
    }
    // Web の native-stack は遷移の動きが無く transitionEnd が来ない
    if (Platform.OS === 'web') { enter(); return }
    return navigation.addListener('transitionEnd', (event) => {
      if (!event.data.closing) enter()
    })
    // 開いた時点の params で1回だけ決める
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation])
  const [added, setAdded] = useState<Gadget[]>([])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const introductionDateChoiceRef = useRef<MissingIntroductionDateChoice | null>(null)
  type PendingRegistration = { choice: CategoryChoice; name: string; suggestion?: ProductSuggestion }
  const [pendingRegistration, setPendingRegistration] = useState<PendingRegistration | null>(null)
  // 押した瞬間に判定するので state ではなく ref で持つ（state は次の描画まで前の値のまま）
  const pendingRegistrationRef = useRef<PendingRegistration | null>(null)

  // 登録後に「どのデスクにも入れるか」を選ぶシート（デスクの外から開いたときだけ）
  const [planPickerVisible, setPlanPickerVisible] = useState(false)
  const [selectedPlanIds, setSelectedPlanIds] = useState<Set<string>>(new Set())
  const finishPlanPickerInFlightRef = useRef(false)

  const openCategoryPicker = (purpose: CategoryPickerPurpose) => {
    if (detailOpeningRef.current || leavingRef.current || savingRef.current || !navigation.isFocused()) return
    pickerPurposeRef.current = purpose
    setPickerPurpose(purpose)
  }

  const goBackOnce = useCallback(() => {
    if (detailOpeningRef.current || leavingRef.current || !navigation.isFocused()) return
    leavingRef.current = true
    navigation.goBack()
  }, [navigation])

  const deskGadgets = useMemo(() => {
    const plan = planId ? plans.find((item) => item.id === planId) : undefined
    if (!plan) return []
    const ids = new Set(plan.selectedGadgetIds)
    return libraryGadgets.filter((gadget) => ids.has(gadget.id))
  }, [libraryGadgets, plans, planId])

  // 検索欄の語はそのまま「名前だけで登録」の名前になる。貼り付けで混ざった改行・タブ・連続した空白は1つの空白にする
  const trimmedQuery = query.trim().replace(/\s+/g, ' ')
  // カテゴリを決めて一覧で探しているときは、打つ前から全件を並べる。一覧から選ぶ操作を閉じている間は、
  // カテゴリ付きで開いても（配線図の「登録」・機材の交換）打った語をそのカテゴリで探すだけにする
  const browsing = PRODUCT_BROWSE_ENABLED && filter !== null
  const { suggestions, loading: suggestionsLoading, error: suggestionsError } = useProductSuggestionsState(
    filter?.category ?? null,
    query,
    lang,
    PRODUCT_BROWSE_ENABLED && !directCategorySelection,
    RESULT_LIMIT,
    browsing,
  )

  // 登録はこのアプリの主要導線なので、開始と「1件も入れずに去った」を見る
  const entrySource = route.params?.presetName ? 'preset' : route.params?.category ? 'category' : 'manual'
  const entryStartedAtRef = useRef(Date.now())
  useEffect(() => {
    analytics.track(EVENTS.GADGET_ENTRY_STARTED, { entry: entrySource, in_plan: !!planId })
    // 画面ごとに1回。route.params が変わっても再送しない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const addedCountRef = useRef(0)
  addedCountRef.current = added.length
  const queryRef = useRef(query)
  queryRef.current = query
  useEffect(() => navigation.addListener('beforeRemove', () => {
    leavingRef.current = true
    pendingDetailRef.current = null
    if (addedCountRef.current > 0) return
    analytics.track(EVENTS.GADGET_ENTRY_ABANDONED, {
      entry: entrySource,
      had_input: queryRef.current.trim().length > 0,
      duration_ms: Date.now() - entryStartedAtRef.current,
    })
  }), [navigation, entrySource])

  const coach = useCoachMarks()
  const { target: coachTarget, open: openCoach } = coach
  const openHelp = useCallback(() => { void openCoach(ADD_GADGET_COACH) }, [openCoach])
  // useEffect だと描画のあとに走るため、ボタンの無いヘッダーが一度描かれてから
  // customView が挿し込まれ、iOS がバーのレイアウトを取り直すぶんボタンが動いて見える
  useLayoutEffect(() => {
    navigation.setOptions({
      ...(returnAfterAdd ? { title: lang === 'en' ? 'Register replacement' : '交換する商品を登録' } : {}),
      headerRight: () => (
        <HeaderIconButton name="help-circle-outline" color={C.text} onPress={openHelp}
          accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'} />
      ),
      headerLeft: () => (
        <HeaderIconButton
          name={ICONS.chevronLeft}
          size={25}
          circular
          color={C.text}
          onPress={goBackOnce}
          accessibilityLabel={t('a11y.back')}
        />
      ),
    })
  }, [navigation, C.text, lang, returnAfterAdd, t, goBackOnce, openHelp])

  const register = useCallback(async (choice: CategoryChoice, name: string, suggestion?: ProductSuggestion) => {
    if (savingRef.current) return
    if (!trimAndTruncate(name, GADGET_NAME_MAX_LENGTH)) return
    if (introductionDateChoiceRef.current === null) {
      // 導入日のシートで答えるまでは、最初の1件だけを待たせる。シートが出るまでの間に次を押すと
      // 待ちが上書きされ、先に押した商品が黙って捨てられていた。続けて押すのは同じ商品の
      // 押し直しであることが多いので、列にはせず後から押した方を受けない（保存中の押下と同じ扱い）
      if (pendingRegistrationRef.current) return
      pendingRegistrationRef.current = { choice, name, suggestion }
      setPendingRegistration(pendingRegistrationRef.current)
      return
    }
    savingRef.current = true
    setSaving(true)
    const gadget = gadgetFromProduct({
      id: uuidv4(),
      name,
      category: choice.category,
      customCategory: choice.custom,
      suggestion,
      deskGadgets,
      purchasedAt: introductionDateChoiceRef.current === 'today' ? localDateKey() : undefined,
      now: new Date().toISOString(),
    })
    try {
      if (planId) beginPlanReflection(planId)
      await add(gadget)
      if (planId) {
        // update() ではなく updateWith() を使う：このデスクの WiringResultScreen が裏に
        // 残っていると、selectedGadgetIds の変更を検知した再計算が同じ plan を保存し直す。
        // 古いスナップショットを丸ごと書くと、その保存と後勝ちで衝突しうる
        await updatePlanWith(planId, (prev) => {
          if (prev.selectedGadgetIds.includes(gadget.id)) return prev
          const next = updateDeskGadgetSelection(
            prev,
            [...prev.selectedGadgetIds, gadget.id],
            [...libraryGadgets, gadget],
          )
          return {
            ...next,
            placements: [
              ...prev.placements.filter((placement) => placement.gadgetId !== gadget.id),
              { gadgetId: gadget.id, zone: 'back_center' },
            ],
            updatedAt: new Date().toISOString(),
          }
        })
      }
      void trackOnce(EVENTS.FIRST_ITEM_ADDED, { source: 'add_gadget', category: gadget.category })
      addedCountRef.current += 1
      hapticSuccess()
      setAdded((prev) => [...prev, gadget])
      setQuery('')
      // 保存を待つ間に戻る操作で閉じていたら、ここで戻ると前の画面まで閉じる
      // （goBack は呼んだ画面ではなく、その時点で一番上の画面を閉じる）
      if (returnAfterAdd && navigation.isFocused()) navigation.goBack()
    } catch {
      hapticError()
      showMessage(
        lang === 'en' ? 'Could not save' : '保存できませんでした',
        lang === 'en' ? 'Please try again.' : 'もう一度お試しください。',
      )
    } finally {
      if (planId) endPlanReflection(planId)
      savingRef.current = false
      setSaving(false)
    }
  }, [add, deskGadgets, lang, libraryGadgets, navigation, planId, returnAfterAdd, updatePlanWith])

  const dismissPendingRegistration = () => {
    pendingRegistrationRef.current = null
    setPendingRegistration(null)
  }

  const choosePendingIntroductionDate = (dateChoice: MissingIntroductionDateChoice) => {
    const pending = pendingRegistrationRef.current
    if (!pending) return
    introductionDateChoiceRef.current = dateChoice
    pendingRegistrationRef.current = null
    setPendingRegistration(null)
    void register(pending.choice, pending.name, pending.suggestion)
  }

  const selectSuggestion = (suggestion: ProductSuggestion, position: number) => {
    const category = filter?.category ?? suggestion.category
    analytics.track(EVENTS.PRODUCT_SUGGESTION_SELECTED, {
      category: category ?? null,
      has_product_id: !!suggestion.productId,
      product_id: suggestion.productId,
      position,
      selection_source: filter ? 'category_list' : 'search',
      placement: 'add_gadget',
    })
    // 商品DBにカテゴリの無い行がある。推測で入れると配線図の形まで変わるので聞く
    if (!category) {
      openCategoryPicker({ kind: 'assign', name: suggestion.name, suggestion })
      return
    }
    void register({ category, custom: filter?.custom }, suggestion.name, suggestion)
  }

  const registerByName = () => {
    if (!trimmedQuery) return
    if (filter) {
      void register(filter, trimmedQuery)
      return
    }
    openCategoryPicker({ kind: 'assign', name: trimmedQuery })
  }

  const closePicker = () => {
    if (detailOpeningRef.current) return
    pickerPurposeRef.current = null
    setPickerPurpose(null)
  }

  const chooseCategory = (category: GadgetCategory, custom?: CustomCategory) => {
    if (detailOpeningRef.current || leavingRef.current || savingRef.current || !navigation.isFocused()) return
    if (!directCategorySelection && pickerPurposeRef.current !== pickerPurpose) return
    const purpose = pickerPurposeRef.current ?? (directCategorySelection ? { kind: 'filter' as const } : null)
    if (!purpose) return
    detailOpeningRef.current = true
    pickerPurposeRef.current = null
    setPickerPurpose(null)
    const draft = prepareDraft(category, custom, purpose)
    if (directCategorySelection) openPendingDetail()
    else if (Platform.OS !== 'ios') setTimeout(() => {
      if (pendingDetailRef.current === draft) openPendingDetail()
    }, 350)
  }

  const prepareDraft = (category: GadgetCategory, custom: CustomCategory | undefined, purpose: CategoryPickerPurpose) => {
    const draft = gadgetFromProduct({
      id: uuidv4(),
      name: purpose.kind === 'assign' ? purpose.name : trimmedQuery,
      category,
      customCategory: custom,
      suggestion: purpose.kind === 'assign' ? purpose.suggestion : undefined,
      deskGadgets,
      now: new Date().toISOString(),
    })
    pendingDetailRef.current = draft
    return draft
  }

  // 配線図の「○○を登録」・交換の登録はジャンルを渡して開く。選び直させると、
  // 交換で元と違うジャンルを選べてしまう
  const registerInFilter = () => {
    if (!filter || detailOpeningRef.current || leavingRef.current || savingRef.current || !navigation.isFocused()) return
    detailOpeningRef.current = true
    prepareDraft(filter.category, filter.custom, { kind: 'filter' })
    openPendingDetail()
  }

  const openPendingDetail = () => {
    const draft = pendingDetailRef.current
    pendingDetailRef.current = null
    if (!draft) return
    if (leavingRef.current || !navigation.isFocused()) {
      detailOpeningRef.current = false
      return
    }
    // 登録の数え先は、実際に詳細設定を開いた下書きにだけ移す。下書きを作った時点で移すと、
    // ジャンルを続けて2度押したとき、開かなかった2つ目に移って、開いた1つ目を保存しても
    // 「追加しました」が出ず、入っていないと思ってもう一度登録されていた
    draftRegistrationIdRef.current = draft.id
    navigation.navigate('GadgetDetail', { gadgetId: draft.id, planId, draftGadget: draft })
  }

  useEffect(() => {
    const draftId = draftRegistrationIdRef.current
    if (!draftId) return
    const saved = libraryGadgets.find((gadget) => gadget.id === draftId)
    if (!saved) return
    draftRegistrationIdRef.current = null
    // 登録は詳細設定の保存で終わるので、register() を通らないこの道でも数える
    void trackOnce(EVENTS.FIRST_ITEM_ADDED, { source: 'add_gadget', category: saved.category })
    addedCountRef.current += 1
    setAdded((previous) => [...previous, saved])
    setQuery('')
  }, [libraryGadgets])

  useEffect(() => navigation.addListener('focus', () => {
    detailOpeningRef.current = false
    leavingRef.current = false
    if (returnAfterAdd && addedCountRef.current > 0) navigation.goBack()
  }), [navigation, returnAfterAdd])

  const finish = () => {
    if (!planId && !libraryOnly && added.length > 0 && plans.length > 0) {
      setSelectedPlanIds(new Set())
      setPlanPickerVisible(true)
      return
    }
    // 「このデスクに追加して配線を見る」から来たときは、足した結果の配線図を開く。
    // 積んである同じデスクがあればそこまで戻り（navigate）、配線タブに切り替える
    if (route.params?.showWiringOnDone && planId && added.length > 0) {
      ;(navigation.navigate as (name: string, params: object) => void)('WiringResult', { planId, initialTab: 'wiring' })
      return
    }
    navigation.goBack()
  }

  const togglePlanSelection = (id: string) => {
    setSelectedPlanIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const finishPlanPicker = async (addToPlans: boolean) => {
    if (finishPlanPickerInFlightRef.current) return
    finishPlanPickerInFlightRef.current = true
    try {
      if (addToPlans && added.length > 0) {
        const addedIds = added.map((gadget) => gadget.id)
        const known = [...libraryGadgets.filter((gadget) => !addedIds.includes(gadget.id)), ...added]
        const now = new Date().toISOString()
        for (const id of selectedPlanIds) {
          if (!plans.some((plan) => plan.id === id)) continue
          await updatePlanWith(id, (prev) => {
            const newIds = addedIds.filter((gadgetId) => !prev.selectedGadgetIds.includes(gadgetId))
            if (newIds.length === 0) return prev
            return {
              ...updateDeskGadgetSelection(prev, [...prev.selectedGadgetIds, ...newIds], known),
              updatedAt: now,
            }
          })
        }
      }
      setPlanPickerVisible(false)
      if (navigation.isFocused()) navigation.goBack()
    } catch {
      // 失敗を受け止めないと、押しても何も起きずにシートが残るだけになる。シートは開いたままにして
      // 押し直せるようにする。デスクごとに入っていない機材だけを足すので、途中まで書けていても重複しない
      hapticError()
      showMessage(
        lang === 'en' ? 'Could not add to desks' : 'デスクに追加できませんでした',
        lang === 'en' ? 'Please try again.' : 'もう一度お試しください。',
      )
    } finally {
      setTimeout(() => { finishPlanPickerInFlightRef.current = false }, 500)
    }
  }

  const lastAdded = added.at(-1)
  const filterLabel = filter ? (filter.custom?.name ?? t(`category.${filter.category}`)) : null
  const showResults = PRODUCT_BROWSE_ENABLED && (browsing || trimmedQuery.length >= 2)

  const nameOnlyRow = PRODUCT_BROWSE_ENABLED && trimmedQuery ? (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: C.card, borderBottomColor: C.separator }]}
      onPress={registerByName}
      disabled={saving}
      accessibilityRole="button"
    >
      <AppIcon name={ICONS.add} size={20} color={C.accentIcon} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowName, { color: C.accentText }]} numberOfLines={2}>
          {lang === 'en' ? `Add "${trimmedQuery}" by name` : `「${trimmedQuery}」を名前だけで登録`}
        </Text>
        <Text style={[styles.rowMeta, { color: C.textMuted }]}>
          {lang === 'en' ? 'For items not in the list' : '一覧に無いときはこちら'}
        </Text>
      </View>
    </TouchableOpacity>
  ) : null

  const emptyGuide = (
    <View style={styles.guide}>
      <Text style={[styles.guideText, { color: C.textSub }]}>
        {filterLabel
          ? (lang === 'en'
            ? `Enter the product name and details of the ${filterLabel}.`
            : `${filterLabel}の商品名や機材の情報を詳細設定で入力します。`)
          : (lang === 'en'
            ? 'Choose a category, then enter the product name and details.'
            : 'ジャンルを選び、詳細設定で商品名や機材の情報を入力します。')}
      </Text>
      <TouchableOpacity
        ref={coachTarget('add-gadget-start')}
        style={[styles.browseButton, { backgroundColor: C.chip, borderColor: C.inputBorder }]}
        onPress={filter ? registerInFilter : () => openCategoryPicker({ kind: 'filter' })}
        accessibilityRole="button"
      >
        <AppIcon name={filter ? ICONS.add : 'format-list-bulleted'} size={16} color={C.accentIcon} />
        <Text style={[styles.browseButtonText, { color: C.accentText }]}>
          {filterLabel
            ? (lang === 'en' ? `Add ${filterLabel}` : `${filterLabel}を登録`)
            : (lang === 'en' ? 'Choose a category' : 'ジャンルを選択')}
        </Text>
      </TouchableOpacity>
    </View>
  )

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.container, { backgroundColor: C.bg }]}>
      <CoachScope coach={coach}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight}
      >
        {directCategorySelection ? (
          <CategorySectionPicker
            layout="grid"
            onSelect={(category) => chooseCategory(category)}
            onSelectCustom={(custom) => chooseCategory('Other', custom)}
          />
        ) : (
        <>
        {PRODUCT_BROWSE_ENABLED && <SearchField
            ref={searchRef}
            containerStyle={styles.searchWrap}
            value={query}
            onChangeText={(text) => setQuery(truncateChars(text, GADGET_NAME_MAX_LENGTH))}
            placeholder={lang === 'en' ? 'Search by product name' : '商品名で探す'}
            maxLength={GADGET_NAME_MAX_LENGTH}
            accessibilityLabel={lang === 'en' ? 'Search by product name' : '商品名で探す'}
            onClear={() => setQuery('')}
        />}

        {PRODUCT_BROWSE_ENABLED && filter && (
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterChip, { backgroundColor: C.chip, borderColor: C.inputBorder }]}
              onPress={() => setFilter(null)}
              accessibilityRole="button"
              accessibilityLabel={lang === 'en' ? `Clear category ${filterLabel}` : `ジャンル「${filterLabel}」を外す`}
            >
              <Text style={[styles.filterChipText, { color: C.text }]}>{filterLabel}</Text>
              <AppIcon name={ICONS.close} size={14} color={C.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        {showResults ? (
          <FlatList
            data={suggestions}
            keyExtractor={(item, index) => `${item.productId ?? item.name.normalize('NFKC').toLowerCase()}-${index}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => {
              const category = filter?.category ?? item.category
              return (
                <TouchableOpacity
                  style={[styles.row, { backgroundColor: C.card, borderBottomColor: C.separator }]}
                  onPress={() => selectSuggestion(item, index)}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel={item.name}
                  accessibilityHint={lang === 'en' ? 'Adds this product' : 'この商品を登録します'}
                >
                  <View style={[styles.productImage, { backgroundColor: C.chip, borderColor: C.border }]}>
                    {item.image ? (
                      <Image source={{ uri: item.image }} style={styles.productImageContent} resizeMode="contain" />
                    ) : (
                      <CategoryIcon category={category ?? 'Other'} size={22} color={C.accentIcon} />
                    )}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowName, { color: C.text }]} numberOfLines={2}>{item.name}</Text>
                    <View style={styles.rowMetaLine}>
                      <BrandChip brand={item.brand} colors={C} lang={lang} />
                      {!filter && category && (
                        <Text style={[styles.rowMeta, { color: C.textMuted }]}>{t(`category.${category}`)}</Text>
                      )}
                    </View>
                  </View>
                  <AppIcon name={ICONS.add} size={20} color={C.accentIcon} />
                </TouchableOpacity>
              )
            }}
            ListFooterComponent={nameOnlyRow}
            ListEmptyComponent={suggestionsLoading ? (
              <View style={styles.resultState}>
                <ActivityIndicator color={C.accentIcon} />
                <Text style={[styles.resultStateText, { color: C.textSub }]}>
                  {lang === 'en' ? 'Loading products…' : '商品を読み込んでいます…'}
                </Text>
              </View>
            ) : suggestionsError ? (
              <View style={styles.resultState}>
                <Text style={[styles.resultStateText, { color: C.textSub }]}>
                  {lang === 'en' ? 'Could not load products' : '商品を読み込めませんでした'}
                </Text>
              </View>
            ) : (
              <View style={styles.resultState}>
                <Text style={[styles.resultStateText, { color: C.textSub }]}>
                  {lang === 'en' ? 'No matching products' : '該当する商品がありません'}
                </Text>
              </View>
            )}
          />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled">
            {nameOnlyRow}
            {emptyGuide}
          </ScrollView>
        )}

        </>
        )}

        {lastAdded && (
          <View ref={coachTarget('add-gadget-added')} style={[styles.addedBar, { backgroundColor: C.card, borderTopColor: C.border }]}>
            <AppIcon name="check-circle" size={20} color={C.success} />
            <Text style={[styles.addedText, { color: C.text }]} numberOfLines={1}>
              {lang === 'en' ? `Added ${lastAdded.name}` : `「${lastAdded.name}」を追加しました`}
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('GadgetDetail', { gadgetId: lastAdded.id, planId })}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={lang === 'en' ? `Edit details of ${lastAdded.name}` : `「${lastAdded.name}」の詳細を決める`}
            >
              <Text style={[styles.addedEdit, { color: C.accentText }]}>{lang === 'en' ? 'Details' : '詳細'}</Text>
            </TouchableOpacity>
          </View>
        )}
        {added.length > 0 && (
          <View ref={coachTarget('add-gadget-done')} style={[styles.doneBar, { backgroundColor: C.card, paddingBottom: Math.max(insets.bottom, 12) }]}>
            <Button
              title={lang === 'en' ? `Done (${added.length})` : `完了（${added.length}件）`}
              onPress={finish}
              disabled={saving}
            />
          </View>
        )}
      </KeyboardAvoidingView>
      </CoachScope>
      {coach.overlay}

      <Modal
        visible={!directCategorySelection && pickerPurpose !== null}
        transparent={false}
        animationType={reduceMotion ? 'fade' : 'slide'}
        onRequestClose={closePicker}
        onDismiss={openPendingDetail}
      >
        <View style={[styles.container, { backgroundColor: C.bg }]}>
          <View style={[styles.catModalHeader, { backgroundColor: C.card, paddingTop: insets.top + 14, borderBottomColor: C.border }]}>
            <View style={styles.rowBody}>
              <Text style={[styles.catModalTitle, { color: C.text }]}>
                {lang === 'en' ? 'Choose a category' : 'ジャンルを選択'}
              </Text>
              {pickerPurpose?.kind === 'assign' && (
                <Text style={[styles.catModalSub, { color: C.textSub }]} numberOfLines={1}>{pickerPurpose.name}</Text>
              )}
            </View>
            <TouchableOpacity onPress={closePicker} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
              <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
            </TouchableOpacity>
          </View>
          {!directCategorySelection && pickerPurpose !== null && (
            <CategorySectionPicker
              layout="grid"
              onSelect={(category) => chooseCategory(category)}
              onSelectCustom={(custom) => chooseCategory('Other', custom)}
            />
          )}
        </View>
      </Modal>

      {/* ── 登録後：デスクへ追加するか選択 ── */}
      <MissingIntroductionDateSheet
        visible={pendingRegistration !== null}
        count={1}
        continuousAddition={!returnAfterAdd}
        onDismiss={dismissPendingRegistration}
        onChoose={choosePendingIntroductionDate}
      />
      <BottomSheetModal visible={planPickerVisible} onDismiss={() => finishPlanPicker(false)}>
          <View style={styles.planSheetHead}>
            <AppIcon name="check-circle" size={22} color={C.success} />
            <Text style={[styles.planSheetTitle, { color: C.text }]}>
              {lang === 'en' ? 'Added to library' : 'ガジェットを追加しました'}
            </Text>
          </View>
          <Text style={[styles.planSheetSub, { color: C.textSub }]}>
            {lang === 'en' ? 'Add them to a desk too?' : 'デスクにも追加しますか？'}
          </Text>
          <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {pickerPlans.map((p) => {
              const on = selectedPlanIds.has(p.id)
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.planRow, { borderBottomColor: C.separator }]}
                  onPress={() => togglePlanSelection(p.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.planRowIcon, { backgroundColor: C.accent + '18' }]}>
                    <AppIcon name="desk" size={18} color={C.accentIcon} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.planRowName, { color: C.text }]} numberOfLines={1}>{p.name}</Text>
                    <Text style={[styles.planRowSub, { color: C.textMuted }]}>
                      {lang === 'en'
                        ? `${p.selectedGadgetIds.length} ${p.selectedGadgetIds.length === 1 ? 'gadget' : 'gadgets'}`
                        : `ガジェット ${p.selectedGadgetIds.length}個`}
                    </Text>
                  </View>
                  <AppIcon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={on ? C.accentIcon : C.textMuted} />
                </TouchableOpacity>
              )
            })}
          </ScrollView>
          <Button
            title={selectedPlanIds.size > 0
              ? (lang === 'en' ? `Add to ${selectedPlanIds.size} desk${selectedPlanIds.size > 1 ? 's' : ''}` : `${selectedPlanIds.size}個のデスクに追加`)
              : (lang === 'en' ? 'Select a desk' : 'デスクを選択してください')}
            shape="control"
            style={styles.planSheetPrimary}
            disabled={selectedPlanIds.size === 0}
            onPress={() => finishPlanPicker(true)}
          />
          <TouchableOpacity style={styles.planSheetSkip} onPress={() => finishPlanPicker(false)}>
            <Text style={[styles.planSheetSkipText, { color: C.textMuted }]}>{lang === 'en' ? 'Not now' : '今は追加しない'}</Text>
          </TouchableOpacity>
      </BottomSheetModal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  searchWrap: {
    marginHorizontal: UI_METRICS.formGutter,
    marginTop: 12,
    marginBottom: 8,
  },
  filterRow: { flexDirection: 'row', paddingHorizontal: UI_METRICS.formGutter, marginBottom: 8 },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: UI_METRICS.pillRadius,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipText: { fontSize: 13, fontWeight: '600' },

  row: {
    minHeight: 56,
    paddingHorizontal: UI_METRICS.formGutter,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  productImage: {
    width: 44,
    height: 44,
    flexShrink: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: UI_METRICS.chipRadius,
  },
  productImageContent: { width: '100%', height: '100%', backgroundColor: '#FFFFFF' },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 14, lineHeight: 18 },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  rowMeta: { fontSize: 12 },
  resultState: { alignItems: 'center', gap: 10, paddingHorizontal: UI_METRICS.formGutter, paddingVertical: 36 },
  resultStateText: { fontSize: 13, textAlign: 'center' },

  guide: { paddingHorizontal: UI_METRICS.formGutter, paddingTop: 16, gap: 14 },
  guideText: { fontSize: 13, lineHeight: 19 },
  browseButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  browseButtonText: { fontSize: 14, fontWeight: '600' },

  addedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: UI_METRICS.formGutter,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addedText: { flex: 1, fontSize: 14, fontWeight: '500' },
  addedEdit: { fontSize: 14, fontWeight: '700' },
  doneBar: { paddingHorizontal: UI_METRICS.formGutter, paddingTop: 4 },

  catModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catModalTitle: { fontSize: 17, fontWeight: '700' },
  catModalSub: { fontSize: 12 },

  // 登録後のデスク選択シート
  planSheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  planSheetTitle: { fontSize: 17, fontWeight: '700' },
  planSheetSub: { fontSize: 13, marginBottom: 12 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  planRowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  planRowName: { fontSize: 15, fontWeight: '600' },
  planRowSub: { fontSize: 12, marginTop: 1 },
  planSheetPrimary: { marginTop: 16 },
  planSheetSkip: { alignItems: 'center', paddingVertical: 14 },
  planSheetSkipText: { fontSize: 14, fontWeight: '500' },
})
