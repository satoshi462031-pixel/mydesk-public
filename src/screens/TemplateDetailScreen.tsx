import { UNSTABLE_usePreventRemove as usePreventRemove } from '@react-navigation/native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useHeaderHeight } from '@react-navigation/elements'
import { useIsFocused } from '@react-navigation/native'
import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useToday } from '../hooks/useToday'
import {
  ActivityIndicator,
  Animated,
  Easing,
  findNodeHandle,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SwipeableRow } from '../components/molecules/SwipeableRow'
import { AdditionMotion } from '../components/molecules/AdditionMotion'
import { AppIcon } from '../components/atoms/AppIcon'
import { Button } from '../components/atoms/Button'
import { CategoryIcon } from '../components/atoms/CategoryIcon'
import { IconCircleButton } from '../components/atoms/IconCircleButton'
import { TextField } from '../components/atoms/TextField'
import { BottomSheetModal } from '../components/molecules/BottomSheetModal'
import { MissingIntroductionDateChoice, MissingIntroductionDateSheet } from '../components/molecules/MissingIntroductionDateSheet'
import { NewGearOwnershipSheet } from '../components/molecules/NewGearOwnershipSheet'
import { SetupActionFooter } from '../components/molecules/SetupActionFooter'
import { SetupProgress } from '../components/molecules/SetupProgress'
import { RetryState } from '../components/molecules/RetryState'
import { PRODUCT_NAME_SUGGESTION_MAX_HEIGHT, ProductNameField } from '../components/molecules/ProductNameField'
import { CategorySectionPicker } from '../components/organisms/CategorySectionPicker'
import { ProductPickerModal } from '../components/organisms/ProductPickerModal'
import { TemplateSpecSheet } from '../components/organisms/TemplateSpecSheet'
import { CATEGORY_SELECTION_ORDER } from '../constants/categoryOrder'
import { defaultZoneForCategory } from '../constants/categoryZones'
import { categoryIconColor, ICONS } from '../constants/icons'
import { PRODUCT_BROWSE_ENABLED } from '../constants/features'
import { PURPOSE_GADGETS } from '../constants/purposeGadgets'
import { useApp } from '../context/AppContext'
import { useSpotlightTarget } from '../context/SpotlightContext'
import { SetupScreenHelp } from '../components/molecules/SetupScreenHelp'
import { CoachAnchor } from '../hooks/useCoachMarks'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { backToSetupStep } from '../navigation/setupStepNavigation'
import { getTemplateRepository } from '../repositories/templateRepository'
import { saveFirstSetupDraft } from '../store/firstSetupStore'
import { clearTemplateDetailDraft, readTemplateDetailDraft, saveTemplateDetailDraft } from '../store/templateDetailDraft'
import { takeAbandonedTemplateDraftGadgets, trackTemplateDraftGadget, untrackTemplateDraftGadgets } from '../store/templateDraftGadgets'
import {
  applyTemplate,
  asksArmSpec,
  buildTemplateItemGadget,
  buildTemplateItems,
  defaultConnTypeForSlot,
  defaultTemplateSpec,
  deskRegistersAsOwned,
  needsTemplateSpec,
  normalizeTemplate,
  TemplateItem,
  withSpecArms,
} from '../services/templateService'
import { applyTemplateSpec, readGadgetTemplateSpec, TemplateSpec, withoutSpecCounts } from '../utils/templateSpec'
import { CustomCategory, Gadget, GadgetCategory, PlanStackParamList } from '../types'
import { gadgetCategoryKey, gadgetCategoryLabel } from '../utils/customCategory'
import { DeskTemplate } from '../types/template'
import { ProductSuggestion } from '../utils/productSuggestions'
import { trimAndTruncate, trimInvisible } from '../utils/truncateText'
import { GADGET_NAME_MAX_LENGTH } from '../constants/textLimits'
import { applyProductToGadget } from '../utils/productFill'
import { dateFormatHint, formatStoredDate, parseDateInput } from '../utils/dateFormat'
import { DateField } from '../components/molecules/DateField'
import { sanitizeNumericInput } from '../utils/numericInput'
import { analytics, trackLimitHit } from '../services/analytics'
import { openPaywall } from '../navigation/rootNavigation'
import { useEntitlement } from '../hooks/useEntitlement'
import { SWIPE_OPEN_THRESHOLD, UI_METRICS, UI_STATUS_COLORS } from '../constants/ui'
import { hapticSelection } from '../utils/haptics'
import { SWIPEABLE_ROW_PROPS } from '../utils/swipeableRow'
import { orphanPlaceholders } from '../utils/placeholderCleanup'
import { replacePlanTemplate } from '../utils/planTemplateReplacement'
import { isUnwrittenDeskName } from '../utils/deskAutoName'
import { autoDeskName } from './PurposeSelectionScreen'
import { localizedGadgetName } from '../utils/localizedGadgetName'
import { deskCopyCandidate, deskCopyTemplate } from '../utils/deskCopy'
import { compositionNames, compositionTemplate } from '../utils/deskComposition'
import { isOwnedGadget } from '../utils/gadgetStats'
import { localDateKey } from '../utils/deskTimeline'
import { showMessage } from '../utils/confirmation'
import {
  assignOwnedGadgetsToTemplateItems,
  ownedGadgetCategoriesNeedingSlots,
  retainOwnedAssignments,
} from '../utils/templateOwnedGadgetSelection'

type Props = NativeStackScreenProps<PlanStackParamList, 'TemplateDetail'>
type SetupSheet = 'spec' | 'ownership' | 'date'

export function TemplateDetailScreen({ route, navigation }: Props) {
  const focused = useIsFocused()
  const addedItemKeys = useRef(new Set<string>())
  const headerHeight = useHeaderHeight()
  const gearInputsRef = useSpotlightTarget('gear-inputs')
  const { templateId, purposes, otherPurposeLabel, otherPurposeIcon, otherPurposeColor, returnPlanId, copySource, composition, tutorial } = route.params
  const { colors: C, t, lang, isDark, parsePriceToJpy, fmtPriceInput } = useApp()
  const { gadgets, addMany: addGadgets, updateMany: updateGadgets, removeMany: removeGadgets } = useGadgets()
  const { plans, add: addPlan, updateWith: updatePlanWith } = usePlans()
  const { getLimit } = useEntitlement()
  const existingPlan = returnPlanId ? plans.find((plan) => plan.id === returnPlanId) : undefined

  const [template, setTemplate] = useState<DeskTemplate | null>(null)
  const [loading, setLoading]   = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [createError, setCreateError] = useState(false)
  const [creating, setCreating] = useState(false)
  const [missingDateCount, setMissingDateCount] = useState(0)
  const [ownershipAskCount, setOwnershipAskCount] = useState(0)
  // 導入予定日として1年先まで（機材の詳細画面と同じ上限）。上限が無いと何年も先の日付を選べ、
  // デスクの履歴でその年まで現れない機材ができる
  const today = useToday()
  const maxIntroductionDate = useMemo(() => {
    const date = new Date(today)
    date.setFullYear(date.getFullYear() + 1)
    return date
  }, [today])
  const createInFlightRef = useRef(false)
  const newPlanIdRef = useRef<string | null>(null)
  const pendingApplyRef = useRef<{ sheet: SetupSheet; dateChoice?: MissingIntroductionDateChoice; owned?: boolean } | null>(null)
  // 作成中はこの画面から離れさせない。作成は裏で終わるのに、用途の画面へ戻って「次へ」を押すと
  // 新しい構成の画面からもう一度作成でき、同じデスクが2つできていた。beforeRemove の preventDefault
  // だけでは iOS のスワイプの戻るが止まらないので、ネイティブの戻るも止めるこのフックを使う
  usePreventRemove(creating, () => {})

  // 進捗バーで用途・テンプレートへ戻る前の入力。同じテンプレートを開き直したら引き継ぐ
  const [restored] = useState(() => readTemplateDetailDraft(templateId, returnPlanId) ?? route.params.initialDraft)
  const [registerAsOwned, setRegisterAsOwned] = useState(() => restored?.registerAsOwned
    ?? (existingPlan && !route.params.intent ? deskRegistersAsOwned(existingPlan, gadgets) : route.params.intent === 'organize'))
  // 作成済みのデスクへ戻ってきたときは、そのデスクの壁コンセントの数から始める。
  // 2 から始めると、戻って次へ進んだだけで前に決めた数（デスク画面で直した数も）が 2 に戻っていた
  const [initialOutletCount] = useState(() => existingPlan?.outletCount ?? 2)
  const [outletCount, setOutletCount] = useState(restored?.outletCount ?? initialOutletCount)
  // テンプレートに無いジャンルをユーザーが足したぶん
  const [extraItems, setExtraItems] = useState<TemplateItem[]>(restored?.extraItems ?? [])
  const [catPickerOpen, setCatPickerOpen] = useState(false)
  // テンプレートに元からある枠のうち、ユーザーが外したもの
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(() => new Set(restored?.removedKeys ?? []))
  const [removingKeys, setRemovingKeys] = useState<Set<string>>(() => new Set())
  // 枠ごとの有線／無線の切り替え（未指定の枠は item の既定を使う）
  // 枠に入れる商品。ここで決めた枠は「作成」で実商品として作られ、空欄の枠は枠のまま残る
  const [productNames, setProductNames] = useState<Record<string, string>>(restored?.productNames ?? {})
  const [productPicks, setProductPicks] = useState<Record<string, ProductSuggestion>>(restored?.productPicks ?? {})
  // 商品名の下の金額・導入日。空欄の導入日は登録日と区別して未設定のまま残す。
  const [productPrices, setProductPrices] = useState<Record<string, string>>(restored?.productPrices ?? {})
  const [productDates, setProductDates] = useState<Record<string, string>>(restored?.productDates ?? {})
  const [pickerFor, setPickerFor] = useState<TemplateItem | null>(null)
  const [ownedPickerOpen, setOwnedPickerOpen] = useState(false)
  const [ownedSelections, setOwnedSelections] = useState<Record<string, string>>(restored?.ownedSelections ?? {})
  const [ownedPickerDraftIds, setOwnedPickerDraftIds] = useState<string[]>([])
  const existingSelectionSyncedRef = useRef(!!restored?.ownedSelections)
  // 作成直前の「実物に合わせる」ページ。閉じて戻っても入力は残す
  const [specOpen, setSpecOpen] = useState(false)
  const [specConfirmed, setSpecConfirmed] = useState(false)
  // 枠 → 詳細画面で保存するガジェット。開くだけではストアへ登録しない
  const [draftGadgets, setDraftGadgets] = useState<Record<string, string>>(restored?.draftGadgets ?? {})
  const draftCreatingRef = useRef(false)
  const [newItemDetail, setNewItemDetail] = useState<TemplateItem | null>(null)
  const openNewItemDetailRef = useRef<(item: TemplateItem) => void>(() => {})
  useEffect(() => {
    if (!newItemDetail || catPickerOpen) return
    // 下端シートを閉じてからネイティブの設定画面へ進む。
    const timer = setTimeout(() => {
      openNewItemDetailRef.current(newItemDetail)
      setNewItemDetail(null)
    }, 250)
    return () => clearTimeout(timer)
  }, [newItemDetail, catPickerOpen])
  // 下部バーは絶対配置なので、一覧の下余白を固定値で置くと最後の枠の商品名欄が下に隠れる。
  // 内訳の行が折り返したときと、作成に失敗して警告が1行増えたときに実際に隠れていた
  const [footerH, setFooterH] = useState(0)
  const [specEdits, setSpecEdits] = useState<Record<string, TemplateSpec>>(restored?.specEdits ?? {})
  const scrollRef = useRef<ScrollView>(null)
  const inputRefs = useRef<Map<string, TextInput>>(new Map())
  const [focusedProductKey, setFocusedProductKey] = useState<string | null>(null)

  useEffect(() => {
    if (!focusedProductKey) return
    const timer = setTimeout(() => {
      const input = inputRefs.current.get(focusedProductKey)
      const handle = input ? findNodeHandle(input) : null
      if (handle) {
        scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
          handle,
          PRODUCT_NAME_SUGGESTION_MAX_HEIGHT + 12,
          true,
        )
      }
    }, Platform.OS === 'ios' ? 300 : 100)
    return () => clearTimeout(timer)
  }, [focusedProductKey])

  const setProductName = (key: string, value: string) => {
    setProductNames((prev) => ({ ...prev, [key]: value }))
    // 選んだ商品の参考価格のままなら一緒に外す。残すと別の商品の値段が、払った額のように残る
    if (isReferencePrice(key)) setProductPrices((prev) => ({ ...prev, [key]: '' }))
    // 手で書き換えたら、選んだ候補の紐付け（ポート・購入リンク）は捨てる
    setProductPicks((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }
  // 控えは1回使ったら捨てる。残すと、戻るボタンで一覧に出て同じテンプレートを選び直したとき、
  // この画面で直した後の入力ではなく、控えた時点の古い入力が戻ってくる。
  // （初期化関数の中で消さないのは、開発時の StrictMode が初期化を2回呼ぶため）
  useEffect(() => {
    if (restored) clearTemplateDetailDraft()
  }, [restored])
  // 機材の段を新しく始めたときは、前に途中でやめた回に作ったガジェット（どのデスクにも入っていない）を片付ける。
  // 控えから戻したときはその回の続きなので消さない
  useEffect(() => {
    if (restored) return
    void takeAbandonedTemplateDraftGadgets(plans)
      .then((ids) => (ids.length > 0 ? removeGadgets(ids, { track: false }) : undefined))
      .catch((error) => analytics.error('cleanup_template_draft_gadgets', error))
    // 開いたときに1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pickProduct = (key: string, suggestion: ProductSuggestion) => {
    setProductNames((prev) => ({ ...prev, [key]: suggestion.name }))
    setProductPicks((prev) => ({ ...prev, [key]: suggestion }))
    // 商品DBの価格は取り込み時点の参考値なので、空欄のときだけ埋める（詳細画面と同じ）
    if (suggestion.priceJpy != null) {
      const referencePrice = fmtPriceInput(suggestion.priceJpy)
      setProductPrices((prev) => (prev[key]?.trim() ? prev : { ...prev, [key]: referencePrice }))
    }
  }
  // 参考価格のまま触っていないか。言わないと払った額として保存される
  const isReferencePrice = (key: string) => {
    const pick = productPicks[key]
    return pick?.priceJpy != null && !!productPrices[key] && productPrices[key] === fmtPriceInput(pick.priceJpy)
  }
  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(false)
    // 他人のデスクを参考にするとき・用途の段や作成済みのデスクからジャンルの並びを渡されたときは、その場で
    // 1台1枠のテンプレートに見立てる（取得は不要）
    const load = copySource
      ? Promise.resolve(deskCopyTemplate(copySource, ICONS.copy))
      : composition
        ? Promise.resolve(normalizeTemplate(compositionTemplate(composition, compositionNames(purposes, otherPurposeLabel)), { keepHub: true }))
        : getTemplateRepository().getById(templateId)
    load
      .then((tpl) => {
        if (!active) return
        setTemplate(tpl)
        if (tpl && !restored) setOutletCount(initialOutletCount)
      })
      .catch((error) => {
        analytics.error('load_template_detail', error)
        if (active) setLoadError(true)
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [templateId, loadAttempt, restored, copySource, composition, otherPurposeLabel, purposes, initialOutletCount])

  // 見出しは「構成の詳細設定」ではなく、前の画面で選んだ構成名を出す
  useLayoutEffect(() => {
    if (!template) return
    navigation.setOptions({
      title: copySource
        ? (copySource.ownerName
            ? (lang === 'en' ? `From ${copySource.ownerName}'s desk` : `${copySource.ownerName}さんのデスクから`)
            : (lang === 'en' ? 'From a shared desk' : '公開デスクから'))
        : lang === 'en' ? template.nameEn : template.nameJa,
    })
  }, [navigation, template, lang, copySource])

  const items = useMemo(() => {
    if (!template) return []
    const base = buildTemplateItems(template, lang)
    const includedCategories = new Set(base.map((item) => item.category))
    const purposeItems: TemplateItem[] = []

    // 用途のぶんの枠はここで足す（用途の段から来た土台は用途に関わらない既定のジャンルだけ）。
    // 作成済みのデスクの機材から組み直した並びには足さない。持っていない機材の枠が戻ってくる
    const suggestedPurposes = composition && returnPlanId ? [] : purposes
    suggestedPurposes.forEach((purpose) => {
      PURPOSE_GADGETS[purpose].forEach((definition) => {
        if (includedCategories.has(definition.category)) return
        includedCategories.add(definition.category)
        purposeItems.push({
          key: `purpose-${purpose}-${definition.category}`,
          category: definition.category,
          name: lang === 'ja' ? definition.nameJa : definition.nameEn,
          zone: definition.zone,
          connType: defaultConnTypeForSlot(definition.category, template.defaultConnType),
          source: 'purpose',
          purpose,
        })
      })
    })

    const suggested = [...base, ...purposeItems].filter((item) => !removedKeys.has(item.key))
    const order = new Map(CATEGORY_SELECTION_ORDER.map((category, index) => [category, index]))
    const sorted = suggested
      .map((item, index) => ({ item, index }))
      .sort((a, b) =>
        (order.get(a.item.category) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(b.item.category) ?? Number.MAX_SAFE_INTEGER)
        || a.index - b.index,
      )
      .map(({ item }) => item)
    // 自分で足したジャンルは先頭にまとめて出す
    return [...extraItems, ...sorted].map((item) => {
      // 「実物に合わせる」で選んだ PC の形。給電の口（applyTemplate）と置き場所が形で決まるので枠ごと替える。
      // 置き場所は枠の既定のままのときだけ動かす
      const pcFormFactor = item.category === 'PC' ? specEdits[item.key]?.pcFormFactor : undefined
      if (!pcFormFactor || pcFormFactor === (item.pcFormFactor ?? 'desktop')) return item
      const keepZone = item.zone !== defaultZoneForCategory('PC', item.pcFormFactor)
      return { ...item, pcFormFactor, zone: keepZone ? item.zone : defaultZoneForCategory('PC', pcFormFactor) }
    })
  }, [template, lang, purposes, extraItems, removedKeys, composition, returnPlanId, specEdits])

  /** 枠を構成から外す（テンプレート由来・追加ぶんのどちらも消せる） */
  const removeItem = (key: string) => {
    setRemovingKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    if (key.startsWith('extra-')) setExtraItems((prev) => prev.filter((x) => x.key !== key))
    else setRemovedKeys((prev) => new Set(prev).add(key))
    // 枠と一緒に割り当ても外す。残すと、同じ key の枠が戻ったとき（用途を戻したとき）に黙って復活する
    setOwnedSelections((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    discardDraftGadget(key)
  }

  // 設定ボタンで先に作ったガジェットを枠から外して消す。どのデスクにも入っていないので残す理由が無い
  const discardDraftGadget = (key: string) => {
    const id = draftGadgets[key]
    if (!id) return
    setDraftGadgets((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    void removeGadgets([id], { track: false })
      .then(() => untrackTemplateDraftGadgets([id]))
      .catch((error) => analytics.error('remove_template_draft_gadget', error))
  }

  const addCategory = (cat: GadgetCategory) => {
    setCatPickerOpen(false)
    const item: TemplateItem = {
        key: `extra-${Date.now()}`,
        category: cat,
        name: t('category.' + cat),
        connType: defaultConnTypeForSlot(cat, template?.defaultConnType),
        source: 'extra',
      }
    addedItemKeys.current.add(item.key)
    setExtraItems((prev) => [...prev, item])
    setNewItemDetail(item)
  }

  const addCustomCategory = (custom: CustomCategory) => {
    setCatPickerOpen(false)
    const item: TemplateItem = {
        key: `extra-${Date.now()}`,
        category: 'Other',
        name: custom.name,
        connType: defaultConnTypeForSlot('Other', template?.defaultConnType),
        source: 'extra',
        custom,
      }
    addedItemKeys.current.add(item.key)
    setExtraItems((prev) => [...prev, item])
    setNewItemDetail(item)
  }

  // 有線／無線はカテゴリごとの既定（defaultConnTypeForSlot）に任せる。
  // ここで選ばせても、商品を決める前に答えられる人はほとんどいなかった
  const resolvedItems = items

  // 確定済みの割り当ては有効なものを残すだけで、詰め直さない（retainOwnedAssignments の説明）
  const ownedAssignments = useMemo(
    () => retainOwnedAssignments(items, gadgets, ownedSelections),
    [items, gadgets, ownedSelections],
  )
  const ownedGadgetFor = (key: string) => gadgets.find((gadget) => gadget.id === ownedAssignments[key])
  const itemProductName = (key: string) => productNames[key] ?? ownedGadgetFor(key)?.name ?? ''
  const itemProductPrice = (key: string) => {
    const price = ownedGadgetFor(key)?.price
    return productPrices[key] ?? (price == null ? '' : fmtPriceInput(price))
  }
  const itemProductDate = (key: string) => productDates[key]
    ?? formatStoredDate(ownedGadgetFor(key)?.purchasedAt, lang)
  const clearOwnedProductFields = (key: string) => {
    setProductNames((previous) => { const next = { ...previous }; delete next[key]; return next })
    setProductPrices((previous) => { const next = { ...previous }; delete next[key]; return next })
    setProductDates((previous) => { const next = { ...previous }; delete next[key]; return next })
    setProductPicks((previous) => { const next = { ...previous }; delete next[key]; return next })
  }
  // 編集画面で消されたガジェットは外す（枠は商品名の欄に戻る）
  const liveDraftGadgets = useMemo(() => Object.fromEntries(
    Object.entries(draftGadgets).filter(([key, id]) => !ownedAssignments[key]
      && items.some((item) => item.key === key) && gadgets.some((gadget) => gadget.id === id)),
  ), [draftGadgets, gadgets, items, ownedAssignments])

  // 詳細画面で保存された値だけを取り込む。機材の段で入力中の値は再描画で戻さない。
  const syncedDraftProductsRef = useRef(new Map<string, Gadget>(
    Object.entries(restored?.draftGadgets ?? {}).flatMap(([key, id]) => {
      const gadget = gadgets.find((entry) => entry.id === id)
      return gadget && restored?.productNames[key] !== undefined ? [[key, gadget] as [string, Gadget]] : []
    }),
  ))
  useEffect(() => {
    for (const [key, id] of Object.entries(liveDraftGadgets)) {
      const gadget = gadgets.find((entry) => entry.id === id)
      if (!gadget || syncedDraftProductsRef.current.get(key) === gadget) continue
      syncedDraftProductsRef.current.set(key, gadget)
      setProductNames((prev) => ({ ...prev, [key]: gadget.isPlaceholder ? '' : gadget.name }))
      setProductPrices((prev) => ({ ...prev, [key]: gadget.price == null ? '' : fmtPriceInput(gadget.price) }))
      setProductDates((prev) => ({ ...prev, [key]: formatStoredDate(gadget.purchasedAt, lang) }))
      setProductPicks((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }, [liveDraftGadgets, gadgets, fmtPriceInput, lang])

  // マイデスクのタブをもう一度押すとこの画面は即座に閉じる。
  // その場合も同じテンプレートへ戻したとき、入力済みの商品や外した枠を復元する。
  useEffect(() => {
    const inputs = {
      templateId,
      returnPlanId,
      outletCount,
      extraItems,
      removedKeys: Array.from(removedKeys),
      productNames,
      productPicks,
      productPrices,
      productDates,
      ownedSelections: ownedAssignments,
      draftGadgets,
      registerAsOwned,
      specEdits,
    }
    saveTemplateDetailDraft(inputs)
    if (!returnPlanId && focused && !creating) {
      void saveFirstSetupDraft({
        screen: 'TemplateDetail', templateId, purposes, otherPurposeLabel, otherPurposeIcon, otherPurposeColor,
        copySource, composition, intent: registerAsOwned ? 'organize' : 'plan', inputs,
      }).catch(() => {})
    }
  }, [composition, copySource, creating, draftGadgets, extraItems, focused, otherPurposeColor, otherPurposeIcon, otherPurposeLabel, outletCount, ownedAssignments, productDates, productNames, productPicks, productPrices, purposes, registerAsOwned, removedKeys, returnPlanId, specEdits, templateId])
  const assignedOwnedIds = useMemo(() => new Set(Object.values(ownedAssignments)), [ownedAssignments])
  const nameFieldKeys = items.map((item) => item.key)
  const ownedCandidates = useMemo(() => gadgets.filter(isOwnedGadget), [gadgets])
  const draftSelectedOwnedIds = useMemo(() => new Set(ownedPickerDraftIds), [ownedPickerDraftIds])

  useEffect(() => {
    if (!returnPlanId || !existingPlan || items.length === 0 || existingSelectionSyncedRef.current) return
    existingSelectionSyncedRef.current = true
    const ids = existingPlan.selectedGadgetIds.filter((id) => gadgets.some((gadget) => gadget.id === id && !gadget.isPlaceholder))
    setOwnedSelections(assignOwnedGadgetsToTemplateItems(items, gadgets, ids))
  }, [returnPlanId, existingPlan, gadgets, items])

  const toggleOwnedGadget = (gadgetId: string) => {
    setOwnedPickerDraftIds((previous) => {
      if (previous.includes(gadgetId)) return previous.filter((id) => id !== gadgetId)
      if (!gadgets.some((gadget) => gadget.id === gadgetId && !gadget.isPlaceholder)) return previous
      return [...previous, gadgetId]
    })
  }

  const openOwnedPicker = () => {
    setOwnedPickerDraftIds(Object.values(ownedAssignments))
    setOwnedPickerOpen(true)
  }

  const closeOwnedPicker = () => {
    setOwnedPickerOpen(false)
    setOwnedPickerDraftIds([])
  }

  const confirmOwnedPicker = () => {
    // 入力済みの枠は別の商品として残す。登録済み機材で上書きせず、不足ぶんの枠を足す。
    const assignableItems = items.filter((item) => ownedAssignments[item.key]
      || (!draftGadgets[item.key]
        && !trimInvisible(productNames[item.key] ?? '')
        && !productPrices[item.key]?.trim()
        && !productDates[item.key]?.trim()))
    // 枠の無いカテゴリも持ち物から直接選べるよう、不足ぶんだけ枠を補う。
    // これが無いと「今のデスクを登録する」→「その他」だけの経路では items が0件のため、
    // 登録済み機材があっても選択入口が出ず、同じ機材を新しい枠として作ることになる。
    const missingSlots = ownedGadgetCategoriesNeedingSlots(assignableItems, gadgets, ownedPickerDraftIds)
    const stamp = Date.now()
    const addedItems: TemplateItem[] = missingSlots.map(({ category, custom }, index) => ({
      key: `extra-owned-${stamp}-${index}`,
      category,
      name: custom?.name ?? t(`category.${category}`),
      connType: defaultConnTypeForSlot(category, template?.defaultConnType),
      source: 'extra',
      ...(custom ? { custom } : {}),
    }))
    const expandedItems = [...assignableItems, ...addedItems]
    addedItems.forEach((item) => addedItemKeys.current.add(item.key))
    if (addedItems.length > 0) setExtraItems((previous) => [...previous, ...addedItems])
    const nextAssignments = assignOwnedGadgetsToTemplateItems(expandedItems, gadgets, ownedPickerDraftIds, ownedAssignments)
    for (const key of new Set([...Object.keys(ownedAssignments), ...Object.keys(nextAssignments)])) {
      if (nextAssignments[key] !== ownedAssignments[key]) clearOwnedProductFields(key)
    }
    setOwnedSelections(nextAssignments)
    setOwnedPickerOpen(false)
    setOwnedPickerDraftIds([])
  }

  const clearOwnedAssignment = (itemKey: string) => {
    setOwnedSelections((previous) => {
      if (!previous[itemKey]) return previous
      const next = { ...previous }
      delete next[itemKey]
      return next
    })
    clearOwnedProductFields(itemKey)
  }

  // 作成済みのデスクを開き直したとき（returnPlanId）、そのデスクにある商品名未設定の機材（枠）を
  // 同じジャンルの空いた枠へ当てておく。当てずに作り直すと枠が毎回新しく作られ、行き来するたびに
  // マイガジェットへ未設定の機材が増え、配置の段で動かした位置・付けた呼び名も失われていた
  const existingPlaceholderSlots = useMemo(() => {
    if (!existingPlan) return {}
    const placeholders = existingPlan.selectedGadgetIds
      .map((id) => gadgets.find((gadget) => gadget.id === id))
      .filter((gadget): gadget is NonNullable<typeof gadget> => !!gadget?.isPlaceholder)
    const used = new Set<string>()
    const slots: Record<string, string> = {}
    for (const item of items) {
      if (ownedAssignments[item.key]) continue
      const itemKey = item.custom ? `custom:${item.custom.id}` : item.category
      const match = placeholders.find((gadget) => gadgetCategoryKey(gadget) === itemKey && !used.has(gadget.id))
      if (!match) continue
      slots[item.key] = match.id
      used.add(match.id)
    }
    return slots
  }, [existingPlan, gadgets, items, ownedAssignments])
  // 商品名を入れた枠は新しく商品として作るので、引き継がない
  const keptPlaceholderOf = (item: TemplateItem) =>
    trimInvisible(productNames[item.key] ?? '') ? undefined : existingPlaceholderSlots[item.key]

  // 作成済みのデスクへ戻ってきたとき、枠がそのまま使うこのデスクのガジェット（枠のまま・商品名入り）。
  // 前に「実物に合わせる」で答えた内容はここに入っている。持ち物から新しく選んだ機材は含めない
  const reusedByKey = useMemo(() => {
    const deskIds = new Set(existingPlan?.selectedGadgetIds ?? [])
    const map = new Map<string, Gadget>()
    for (const item of items) {
      const id = ownedAssignments[item.key]
        ?? (trimInvisible(productNames[item.key] ?? '') ? undefined : existingPlaceholderSlots[item.key])
      const gadget = id && deskIds.has(id) ? gadgets.find((g) => g.id === id) : undefined
      if (gadget) map.set(item.key, gadget)
    }
    return map
  }, [existingPlan, items, ownedAssignments, productNames, existingPlaceholderSlots, gadgets])

  // 枠のまま使う行は、保存してある金額・導入日から欄を始める。空で始めると前に入れた値が見えず、
  // そのまま作成すると空で上書きする。1行につき1回だけ入れ、入力中の欄は上書きしない
  // （控えから戻した入力があればそちらを残す）
  const prefilledKeysRef = useRef(new Set<string>())
  useEffect(() => {
    const prices: Record<string, string> = {}
    const dates: Record<string, string> = {}
    reusedByKey.forEach((gadget, key) => {
      if (!gadget.isPlaceholder || prefilledKeysRef.current.has(key)) return
      prefilledKeysRef.current.add(key)
      if (gadget.price != null) prices[key] = fmtPriceInput(gadget.price)
      const date = formatStoredDate(gadget.purchasedAt, lang)
      if (date) dates[key] = date
    })
    if (Object.keys(prices).length > 0) setProductPrices((prev) => ({ ...prices, ...prev }))
    if (Object.keys(dates).length > 0) setProductDates((prev) => ({ ...dates, ...prev }))
  }, [reusedByKey, fmtPriceInput, lang])

  // 商品の端子で口数が決まっている枠。候補から選んだ商品と、商品名の入ったこのデスクの機材
  // （詳細画面で端子を直している場合があり、口数だけで上書きすると同じ種類の口がまとまって消える）
  const countLockedKeys = useMemo(
    () => new Set(items.filter((item) => !!productPicks[item.key]?.ports?.length
      || (reusedByKey.has(item.key) && !reusedByKey.get(item.key)?.isPlaceholder)).map((item) => item.key)),
    [items, productPicks, reusedByKey],
  )
  // 持ち物から新しく選んだ機材は、登録した本人が詳細で決めた端子・左右分割などを正とし、聞かない。
  // このデスクで前に答えた枠・機材は聞き直す。聞かないと、機材の段へ戻って直そうとしても
  // ページが出ず、作成時の答えを変える手段が無かった。アームの有無は受け口で持っているので聞かない
  const specItems = useMemo(
    () => items.filter((item) => {
      if (ownedAssignments[item.key] && !reusedByKey.has(item.key)) return false
      // 編集画面で決めた機材は、そこで決めた端子などを正とする（持ち物から選んだ機材と同じ）
      if (liveDraftGadgets[item.key]) return false
      return needsTemplateSpec(item, countLockedKeys.has(item.key), !reusedByKey.has(item.key))
    }),
    [items, countLockedKeys, liveDraftGadgets, ownedAssignments, reusedByKey],
  )
  const armAskedKeys = useMemo(
    () => new Set(specItems.filter((item) => !reusedByKey.has(item.key) && asksArmSpec(item)).map((item) => item.key)),
    [specItems, reusedByKey],
  )
  const formFactorKeys = useMemo(
    () => new Set(specItems.filter((item) => item.category === 'PC' && !reusedByKey.has(item.key)).map((item) => item.key)),
    [specItems, reusedByKey],
  )
  const specFor = (item: TemplateItem): TemplateSpec => {
    // 前に答えた内容から始める。商品名を入れて作り直す枠も、引き継いでいた枠の答えを読む
    const source = reusedByKey.get(item.key) ?? gadgets.find((g) => g.id === existingPlaceholderSlots[item.key])
    const spec = {
      ...defaultTemplateSpec(item, template?.defaultConnType, items),
      ...(source ? readGadgetTemplateSpec(source) : {}),
      ...specEdits[item.key],
    }
    // モニターはアームを聞くためにページへ載るので、商品を選んで口数を聞かない枠でも答えが作られる
    return countLockedKeys.has(item.key) ? withoutSpecCounts(item.category, spec) : spec
  }
  const withItemProduct = (item: TemplateItem, gadget: Gadget): Gadget => {
    const name = trimAndTruncate(itemProductName(item.key), GADGET_NAME_MAX_LENGTH)
    const purchasedAt = parseDateInput(itemProductDate(item.key), lang)
    return {
      ...applyProductToGadget(gadget, { name, suggestion: productPicks[item.key] }),
      name: name || item.name,
      isPlaceholder: name ? undefined : true,
      price: parsePriceToJpy(itemProductPrice(item.key)),
      purchasedAt,
      introducedAtUnknown: purchasedAt ? undefined : true,
    }
  }

  const existingDetailGadgetId = (item: TemplateItem): string | undefined => {
    const gadgetId = ownedAssignments[item.key] ?? liveDraftGadgets[item.key] ?? keptPlaceholderOf(item)
    return gadgetId && gadgets.some((gadget) => gadget.id === gadgetId) ? gadgetId : undefined
  }
  const openItemDetail = async (item: TemplateItem) => {
    // 連打の2回目は捨てる（同じ機材の編集画面が2枚積まれる・機材が2台できる）。
    // 作成中も開かない（上に積まれた間に作成が終わると、次の段へ進めないまま「作成」がまた押せる）
    if (!navigation.isFocused() || draftCreatingRef.current || createInFlightRef.current) return
    draftCreatingRef.current = true
    try {
      const existingId = existingDetailGadgetId(item)
      if (existingId) {
        const existing = gadgets.find((gadget) => gadget.id === existingId)!
        if (ownedAssignments[item.key] && !trimInvisible(itemProductName(item.key))) {
          showMessage(lang === 'ja' ? '商品名を入力してください' : 'Enter a product name')
          return
        }
        if (liveDraftGadgets[item.key] || ownedAssignments[item.key]) {
          const updated = withItemProduct(item, existing)
          if (JSON.stringify(updated) !== JSON.stringify(existing)) await updateGadgets([updated])
        }
        if (ownedAssignments[item.key]) {
          clearOwnedProductFields(item.key)
        }
        if (navigation.isFocused()) navigation.push('GadgetDetail', { gadgetId: existingId, planId: liveDraftGadgets[item.key] ? undefined : returnPlanId })
        return
      }
      const name = trimInvisible(productNames[item.key] ?? '')
      const price = productPrices[item.key]?.trim()
      const date = productDates[item.key]?.trim()
      const product = {
        name,
        suggestion: productPicks[item.key],
        price: price ? parsePriceToJpy(price) ?? null : null,
        purchasedAt: date ? parseDateInput(date, lang) : undefined,
      }
      const hasProduct = name.length > 0 || product.price != null || !!product.purchasedAt
      const gadget = buildTemplateItemGadget(template ?? {}, item, items, {
        product: hasProduct ? product : undefined,
        spec: specFor(item),
        registerAsOwned,
        now: new Date().toISOString(),
      })
      await trackTemplateDraftGadget(gadget.id).catch((error) => analytics.error('track_template_draft_gadget', error))
      setDraftGadgets((prev) => ({ ...prev, [item.key]: gadget.id }))
      if (navigation.isFocused()) navigation.push('GadgetDetail', { gadgetId: gadget.id, draftGadget: gadget })
    } catch (error) {
      analytics.error('create_template_draft_gadget', error)
      showMessage(lang === 'ja' ? '機材を作れませんでした' : 'Could not create the gadget', lang === 'ja' ? 'もう一度お試しください。' : 'Please try again.')
    } finally {
      draftCreatingRef.current = false
    }
  }
  openNewItemDetailRef.current = (item) => { void openItemDetail(item) }
  const changeSpec = (key: string, patch: TemplateSpec) => {
    setSpecEdits((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  // 登録済みの機材も、この行で編集した値を保存するため同じ検証を通す。
  const purchaseInputError = (): string | null => {
    for (const item of items) {
      if (ownedAssignments[item.key] && !trimInvisible(itemProductName(item.key))) {
        return lang === 'ja' ? `「${item.name}」の商品名を入力してください。` : `Enter a product name for "${item.name}".`
      }
      const price = itemProductPrice(item.key).trim()
      if (price && parsePriceToJpy(price) == null) {
        return lang === 'ja' ? `「${item.name}」の金額には0以上の数値を入力してください。` : `Enter a number of 0 or more for the price of "${item.name}".`
      }
      const date = itemProductDate(item.key).trim()
      if (date && !parseDateInput(date, lang)) {
        return lang === 'ja'
          ? `「${item.name}」の導入日を ${dateFormatHint(lang)} で入力してください。`
          : `Enter the date for "${item.name}" in ${dateFormatHint(lang)} format.`
      }
    }
    return null
  }

  // 壁コンセントはどの構成でも聞くので、機材の答えが無い構成でもページを挟む
  const handleCreatePress = () => {
    if (pendingApplyRef.current || createInFlightRef.current || !navigation.isFocused()) return
    const inputError = purchaseInputError()
    if (inputError) {
      showMessage(lang === 'ja' ? '金額・導入日を確認してください' : 'Check the price and date', inputError)
      return
    }
    setSpecOpen(true)
  }

  const handleApply = async (dateChoice?: MissingIntroductionDateChoice, owned?: boolean) => {
    if (!template || createInFlightRef.current) return
    for (const item of items.filter((item) => (item.category === 'MonitorArm' || item.category === 'MicArm') && item.armHolds !== undefined)) {
      const owned = gadgets.find((g) => g.id === ownedAssignments[item.key])
      const ports = owned?.ports ?? productPicks[item.key]?.ports
      if (!ports?.length) continue
      const capacity = ports.filter((port) => port.type === item.category && port.direction === 'output')
        .reduce((sum, port) => sum + port.count, 0)
      if (capacity >= (item.armHolds ?? 1)) continue
      showMessage(lang === 'ja' ? 'アームの対応台数を確認' : 'Check the arm capacity',
        lang === 'ja' ? `${item.name}には${item.armHolds}${item.category === 'MicArm' ? '本' : '台'}用を指定しています。対応する商品を選ぶか、ジャンルの画面で構成を変更してください。`
          : `${item.name} is set to hold ${item.armHolds} ${item.category === 'MicArm' ? 'microphones' : 'monitors'}. Choose a compatible product or change the setup in Categories.`)
      return
    }
    if (returnPlanId && !existingPlan) {
      setCreateError(true)
      return
    }
    createInFlightRef.current = true
    setCreating(true)
    setCreateError(false)
    // 入力中の欄に打ち続けた分は作成に入らない。キーボードを閉じて、作成に使う値で止める
    Keyboard.dismiss()
    try {
      // そのまま使うガジェットの答えは、作成の後にそのガジェットへ直接当てる（applyTemplate は作り直さない）
      const armed = withSpecArms(
        resolvedItems,
        Object.fromEntries(specItems.filter((item) => !reusedByKey.has(item.key)).map((item) => [item.key, specFor(item)])),
        lang,
        // 持ち物の枠は仕様を聞かないので、アームの台数は持ち物の端子（載っているか・何台支えるか）から数える
        Object.fromEntries(Object.entries({ ...liveDraftGadgets, ...ownedAssignments })
          .map(([key, id]) => [key, gadgets.find((gadget) => gadget.id === id)])
          .filter((entry): entry is [string, (typeof gadgets)[number]] => !!entry[1])),
      )
      const reusable = (existingPlan?.selectedGadgetIds ?? [])
        .map((id) => gadgets.find((gadget) => gadget.id === id))
        .filter((gadget): gadget is NonNullable<typeof gadget> => !!gadget && !gadget.isPlaceholder)
      const selections: Record<string, string> = { ...liveDraftGadgets, ...ownedAssignments }
      for (const item of armed.items) {
        const kept = keptPlaceholderOf(item)
        if (kept && !selections[item.key]) selections[item.key] = kept
      }
      const usedIds = new Set(Object.values(selections))
      for (const item of armed.items) {
        if (selections[item.key]) continue
        if (trimInvisible(productNames[item.key] ?? '')) continue
        const itemKey = item.custom ? `custom:${item.custom.id}` : item.category
        const match = reusable.find((gadget) => gadgetCategoryKey(gadget) === itemKey && !usedIds.has(gadget.id))
        if (!match) continue
        selections[item.key] = match.id
        usedIds.add(match.id)
      }
      const namedNewItems = armed.items.filter((item) => !selections[item.key] && trimInvisible(productNames[item.key] ?? ''))
      // 切り替えを見落として、名前を入れた手持ちが候補のまま残るのを防ぐ。オフのときだけ聞く
      if (owned === undefined && !registerAsOwned && namedNewItems.length > 0) {
        setOwnershipAskCount(namedNewItems.length)
        return
      }
      const asOwned = owned ?? registerAsOwned
      // 候補はまだ買っていない機材なので、導入日を「今日」で埋めるかは聞かない
      if (!returnPlanId && asOwned && dateChoice === undefined) {
        // 「今日」は商品名を入れた機材にだけ当たる（applyTemplate）ので、聞く件数もそれだけを数える
        const missingCount = namedNewItems.filter((item) => !productDates[item.key]?.trim()).length
        if (missingCount > 0) {
          setMissingDateCount(missingCount)
          return
        }
      }
      // 既存機材の保存を先に済ませる。デスク作成後に失敗すると、再試行で別のデスクが増える。
      const askedKeys = new Set(specItems.map((item) => item.key))
      const reusedUpdates = items.flatMap((item) => {
        const gadget = gadgets.find((entry) => entry.id === liveDraftGadgets[item.key])
          ?? reusedByKey.get(item.key) ?? ownedGadgetFor(item.key)
        if (!gadget) return []
        let next = liveDraftGadgets[item.key] || ownedAssignments[item.key]
          ? withItemProduct(item, gadget) : gadget
        // 口数などは触った項目だけ。初期値まで当てると、同じ種類の口を分けて持つ機材が1つにまとまる
        const edits = specEdits[item.key]
        if (edits && askedKeys.has(item.key)) {
          const answers: TemplateSpec = countLockedKeys.has(item.key) ? withoutSpecCounts(item.category, edits) : { ...edits }
          delete answers.onArm
          delete answers.armHolds
          next = applyTemplateSpec(next, answers)
        }
        // 枠のまま使う行の金額・導入日。欄は保存してある値から始まっているので、欄の値をそのまま当てる
        // 空に戻した日付は未設定に戻す。
        if (gadget.isPlaceholder && !liveDraftGadgets[item.key]) {
          const price = productPrices[item.key]?.trim()
          const date = productDates[item.key]?.trim()
          const purchasedAt = date ? parseDateInput(date, lang) : undefined
          next = { ...next, price: price ? parsePriceToJpy(price) ?? undefined : undefined, purchasedAt, introducedAtUnknown: purchasedAt ? undefined : true }
        }
        return JSON.stringify(next) === JSON.stringify(gadget) ? [] : [next]
      })
      if (returnPlanId && reusedUpdates.length > 0) await updateGadgets(reusedUpdates)
      const updatedGadgets = new Map(reusedUpdates.map((gadget) => [gadget.id, gadget]))
      let createdGadgets: typeof gadgets = []
      let orphanedPlaceholderIds: string[] = []
      // 保存の応答が遅れて再試行しても、同じ作成操作のデスクを別IDで追加しない。
      if (!returnPlanId) newPlanIdRef.current ??= uuidv4()
      const planId = await applyTemplate(template, {
        addGadgets: async (incoming) => {
          createdGadgets = incoming
        },
        addPlan: returnPlanId
          ? async (templatePlan) => {
            await addGadgets(createdGadgets)
            return updatePlanWith(returnPlanId, (previous) => {
              // 外れた枠は、このデスクのためだけに作ったもの。他のデスクで使っていなければ
              // 持ち物から片付け、在籍履歴にも「外した」として残さない（作成の途中の出し入れは履歴ではない）
              const nextIds = new Set(templatePlan.selectedGadgetIds)
              orphanedPlaceholderIds = orphanPlaceholders(
                { id: previous.id, selectedGadgetIds: previous.selectedGadgetIds.filter((id) => !nextIds.has(id)) },
                gadgets,
                plans,
              ).map((gadget) => gadget.id)
              const withoutOrphans = {
                ...previous,
                selectedGadgetIds: previous.selectedGadgetIds.filter((id) => !orphanedPlaceholderIds.includes(id)),
                gadgetUsage: previous.gadgetUsage && Object.fromEntries(
                  Object.entries(previous.gadgetUsage).filter(([id]) => !orphanedPlaceholderIds.includes(id))),
              }
              const replaced = replacePlanTemplate(withoutOrphans, templatePlan,
                [...gadgets.map((gadget) => updatedGadgets.get(gadget.id) ?? gadget), ...createdGadgets])
              // 用途を選び直して戻ってきたとき、自動の名前だけは新しい用途で作り直す。
              // 本人が書いた名前は残す
              return isUnwrittenDeskName(previous.name, autoDeskName(previous, lang))
                ? { ...replaced, name: templatePlan.name }
                : replaced
            })
          }
          : async (templatePlan) => addPlan(templatePlan, async () => {
              if (reusedUpdates.length > 0) await updateGadgets(reusedUpdates)
              await addGadgets(createdGadgets)
            }),
        planId: returnPlanId ?? newPlanIdRef.current ?? undefined,
        existingGadgets: gadgets,
        items: armed.items,
        selections,
        products: Object.fromEntries(
          items
            // 見えない文字だけの枠名は未入力として扱う（applyProductToGadget と同じ正規化）
            .map((item) => {
              const price = productPrices[item.key]?.trim()
              const date = productDates[item.key]?.trim()
              return [item.key, {
                name: trimInvisible(productNames[item.key] ?? ''),
                suggestion: productPicks[item.key],
                price: price ? parsePriceToJpy(price) ?? null : null,
                purchasedAt: date ? parseDateInput(date, lang) : undefined,
              }] as const
            })
            // 商品名が空でも、金額か導入日を入れた枠は渡す（枠のまま、その値だけを持たせる）
            .filter(([, entry]) => entry.name.length > 0 || entry.price != null || !!entry.purchasedAt),
        ),
        specs: armed.specs,
        outletCount,
        purposes,
        otherPurposeLabel,
        otherPurposeIcon,
        otherPurposeColor,
        name: autoDeskName({ purposes, otherPurposeLabel }, lang),
        registerAsOwned: asOwned,
        defaultPurchasedAt: asOwned && dateChoice === 'today' ? localDateKey() : undefined,
        lang,
      })
      if (orphanedPlaceholderIds.length > 0) {
        // デスクの更新は済んでいるので、片付けに失敗しても作成は止めない（残るのは未設定の枠だけ）
        await removeGadgets(orphanedPlaceholderIds, { track: false }).catch((error) => {
          analytics.error('remove_replaced_placeholders', error)
        })
      }
      // 先に作ったガジェットはデスクに入ったので、片付けの対象から外す
      await untrackTemplateDraftGadgets(Object.values(liveDraftGadgets)).catch(() => {})
      clearTemplateDetailDraft()
      await saveFirstSetupDraft({ screen: 'DeskPlacement', planId }).catch(() => {})
      // 作成結果を見せる前に配置を決めてもらう。配置完了後に配線を生成し、
      // 写真（スキップ可）を経由してデスク画面へ進む。
      // ウィザードの途中画面（利用目的・構成一覧）を残すと戻るボタンが
      // 構成一覧に戻ってしまうので、開いた一覧の上に積み直す
      // nav-after-await-ok: 呼ぶのは前面にいるときだけ（すぐ下の isFocused() か、戻ってきた focus の通知）
      const goToPlacement = () => {
        const root = navigation.getState().routes[0]
        navigation.reset({
          index: 1,
          routes: [{ name: root.name, key: root.key, params: root.params }, { name: 'DeskPlacement', params: { planId } }],
        })
      }
      // 作成中は離れられないが、上に別の画面が積まれていたら、その画面を消して連れ出さない。
      // この画面に戻ってきた時点で進める（ここに残すと「作成」がまた押せて、同じデスクが2つできる）
      if (!navigation.isFocused()) {
        const unsubscribe = navigation.addListener('focus', () => {
          unsubscribe()
          goToPlacement()
        })
        return
      }
      goToPlacement()
    } catch (error) {
      if (error instanceof Error && error.message === 'DESK_SETUP_IN_PROGRESS') {
        showMessage(lang === 'ja' ? '作成途中のデスクがあります' : 'You have an unfinished desk',
          lang === 'ja' ? 'マイデスクから作成を続けるか、途中のデスクを破棄してください。' : 'Continue or discard the unfinished desk in My Desks.')
        return
      }
      if (error instanceof Error && error.message === 'DESK_ENTITLEMENT_PENDING') {
        showMessage(lang === 'ja' ? 'プランを確認中です' : 'Checking your plan',
          lang === 'ja' ? '確認が終わってから、もう一度お試しください。' : 'Please try again after the check finishes.')
        return
      }
      if (error instanceof Error && error.message === 'DESK_LIMIT_REACHED') {
        trackLimitHit('maxWiringPlans', {
          current: plans.filter((plan) => !plan.isShared).length,
          max: getLimit('maxWiringPlans'),
          placement: 'template_detail_create',
        })
        if (navigation.isFocused()) openPaywall(navigation, 'maxWiringPlans')
        return
      }
      analytics.error('apply_template', error)
      setCreateError(true)
    } finally {
      createInFlightRef.current = false
      setCreating(false)
    }
  }

  // iOS は前の Modal の退場中に次を開けない。確認・保存・画面遷移は退場完了後に始める。
  const closeSheetAndApply = (sheet: SetupSheet, dateChoice?: MissingIntroductionDateChoice, owned?: boolean) => {
    if (pendingApplyRef.current || createInFlightRef.current) return
    pendingApplyRef.current = { sheet, dateChoice, owned }
    if (sheet === 'spec') {
      setSpecConfirmed(true)
      setSpecOpen(false)
    }
    else if (sheet === 'ownership') setOwnershipAskCount(0)
    else setMissingDateCount(0)
  }
  const applyAfterSheetDismiss = (sheet: SetupSheet) => {
    const pending = pendingApplyRef.current
    if (pending?.sheet !== sheet) return
    pendingApplyRef.current = null
    if (!navigation.isFocused()) return
    void handleApply(pending.dateChoice, pending.owned)
  }
  const handleLayoutStepPress = () => {
    if (!specConfirmed) { handleCreatePress(); return }
    if (createInFlightRef.current || !navigation.isFocused() || items.length === 0 || removingKeys.size > 0) return
    const inputError = purchaseInputError()
    if (inputError) {
      showMessage(lang === 'ja' ? '金額・導入日を確認してください' : 'Check the price and date', inputError)
      return
    }
    // 上の「配置」を押せる時点では Modal は閉じている。終了通知が届かなくても、選んだ内容で保存を再開する。
    const pending = pendingApplyRef.current
    pendingApplyRef.current = null
    setOwnershipAskCount(0)
    setMissingDateCount(0)
    void handleApply(pending?.dateChoice ?? 'unset', pending?.owned ?? registerAsOwned)
  }

  if (loading) return (
    <SafeAreaView style={[styles.container, styles.loadingState, { backgroundColor: C.bgList }]}>
      <ActivityIndicator color={C.accentIcon} />
      <Text style={[styles.loadingText, { color: C.textMuted }]}>
        {lang === 'ja' ? '構成を準備しています' : 'Preparing your setup'}
      </Text>
    </SafeAreaView>
  )
  if (loadError) {
    return <RetryState
      message={lang === 'ja' ? '機材の一覧を読み込めませんでした。' : 'Could not load the gear list.'}
      onRetry={() => setLoadAttempt((value) => value + 1)}
    />
  }
  if (!template) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
        <Text style={[styles.notFound, { color: C.textMuted }]}>
          {lang === 'en' ? 'Could not find the gear list' : '機材の一覧が見つかりません'}
        </Text>
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
      <SetupScreenHelp>
      <SetupProgress current={1}
        onStepPress={(step) => {
          if (step === 2 && (returnPlanId || specConfirmed)) {
            handleLayoutStepPress()
            return
          }
          if (step > 0) return
          // 戻るとこの画面は閉じる。用途を選び直して戻ってきたとき入れ直させないよう控える
          saveTemplateDetailDraft({
            templateId,
            returnPlanId,
            outletCount,
            extraItems,
            removedKeys: Array.from(removedKeys),
            productNames,
            productPicks,
            productPrices,
            productDates,
            ownedSelections: ownedAssignments,
            registerAsOwned,
            specEdits,
          })
          const resume = { step: 1, name: 'TemplateDetail', params: route.params } as const
          backToSetupStep(navigation, 'PurposeSelection', {
            initialPurposes: purposes,
            initialOtherPurposeLabel: otherPurposeLabel,
            initialOtherPurposeIcon: otherPurposeIcon,
            initialOtherPurposeColor: otherPurposeColor,
            returnPlanId,
            tutorial,
            resume,
          })
        }}
        // 作成中に用途の段へ戻ると、作成が裏で終わったあと同じデスクをもう一度作れてしまう
        canNavigate={(step) => !creating && (step <= 1 || (step === 2 && (!!returnPlanId || specConfirmed)
          && items.length > 0 && removingKeys.size === 0))}
      />
      <KeyboardAvoidingView
        // 作成中に行の切り替えや入力をしても作成には入らず、入ったように見えるだけになる
        pointerEvents={creating ? 'none' : 'auto'}
        style={styles.keyboardArea}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight}
      >
      <View ref={gearInputsRef} collapsable={false} style={styles.keyboardArea}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: (footerH > 0 ? footerH + 16 : 130) + (focusedProductKey ? PRODUCT_NAME_SUGGESTION_MAX_HEIGHT + 16 : 0) },
        ]}
        // 下部バーは一覧に重ねてあるので、右端のスクロールバーもその上で止める（無いと末尾で裏に潜る）
        scrollIndicatorInsets={{ bottom: footerH }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      >
        <View style={[styles.adjustNotice, { backgroundColor: C.accent + '12', borderColor: C.accent + '44' }]}>
          {/* 機材の行の詳細ボタン（tune-variant）と同じ絵にすると、この帯も押せるボタンに見える */}
          <AppIcon name={ICONS.info} size={19} color={C.accentIcon} />
          {/* 枠なしの土台（手持ちから組む）と、用途に「その他」だけを選んだ場合は
              外すものが無い。「不要なものを外し」から始めると何をする画面か読めない */}
          <Text style={[styles.adjustNoticeText, { color: C.textSub }]}>
            {items.length === 0
              ? (lang === 'ja'
                  ? 'いま使っている機材の種類を足していきます。'
                  : 'Add the kinds of gear you use.')
              : (lang === 'ja'
                  // 行の右の丸ボタンは絵だけで、押すと機材の編集画面へ移る。何が開くか分からないと押されない
                  ? '不要なものを外し、足りないジャンルを追加します。各機材の右のボタンで、端子などの詳細も設定できます。'
                  : 'Remove what you do not need and add any missing categories. Use the button beside each item to set details such as ports.')}
          </Text>
        </View>

        {/* この型で作られる構成（枠ごとにガジェットを割り当てられる）。作成の流れにテンプレートを選ぶ場面は無いので、
            見出しにその語を出さない */}
        <Text style={[styles.sectionLabel, { color: C.textSub }]}>
          {lang === 'ja' ? 'このデスクに置くもの' : 'What goes on this desk'}
        </Text>
        {/* 商品名欄の右側は今後のアフィリエイト検索に使うため、登録済み機材の追加は一覧から独立させる。 */}
        {ownedCandidates.length > 0 && (
          <CoachAnchor id="setup-owned-add"><TouchableOpacity
            style={[styles.ownedAddButton, { backgroundColor: C.card, borderColor: C.accent + '44' }]}
            onPress={openOwnedPicker}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={lang === 'ja' ? '登録済みの機材から追加' : 'Add from your gear'}
          >
            <AppIcon name={ICONS.package} size={18} color={C.accentIcon} />
            <Text style={[styles.ownedAddLabel, { color: C.accentText }]}>
              {lang === 'ja' ? '登録済みから追加' : 'Add from your gear'}
            </Text>
            {assignedOwnedIds.size > 0 && (
              <Text style={[styles.previewSub, { color: C.textMuted }]}>
                {lang === 'ja' ? `${assignedOwnedIds.size}点を使用中` : `${assignedOwnedIds.size} in use`}
              </Text>
            )}
          </TouchableOpacity></CoachAnchor>
        )}
        <View style={[styles.previewCard, { backgroundColor: C.card }]}>
          {/* 枠がひとつも無いと「次へ」が押せない。押せない理由と次の一手を置く */}
          {items.length === 0 && (
            <View style={styles.previewRow}>
              <Text style={[styles.emptyHint, { color: C.textSub }]}>
                {lang === 'ja'
                  ? 'ここから、モニターやPCなど持っているものの種類を足してください。1つ足すと次へ進めます。'
                  : 'Add the kinds of gear you own — monitor, PC and so on. One is enough to continue.'}
              </Text>
            </View>
          )}

          {items.map((item, index) => {
            const ownedGadget = gadgets.find((gadget) => gadget.id === ownedAssignments[item.key])
            return (
              <AdditionMotion
                key={item.key}
                added={addedItemKeys.current.has(item.key)}
                active={focused && !catPickerOpen && !newItemDetail}
                reflow={addedItemKeys.current.size > 0 && removingKeys.size === 0}
                onEntered={() => { addedItemKeys.current.delete(item.key) }}
              >
              <RemovableTemplateItem
                onRemoving={() => setRemovingKeys((prev) => new Set(prev).add(item.key))}
                onRemove={() => removeItem(item.key)}
              >
              {(remove) => (
              <SwipeableRow
                renderRightActions={() => (
                  <View style={styles.deleteAction}>
                    <TouchableOpacity
                      // 先頭と末尾はカードの角に掛かる。角を丸めないと四角い赤がカードの外へはみ出す
                      style={[styles.deleteButton, index === 0 && styles.deleteButtonFirst, index === items.length - 1 && styles.deleteButtonLast]}
                      onPress={remove}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={lang === 'ja' ? `${item.name}を削除` : `Delete ${item.name}`}
                    >
                      <AppIcon name={ICONS.trash} size={20} color="#fff" />
                      <Text style={styles.deleteLabel}>{lang === 'ja' ? '削除' : 'Delete'}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {...SWIPEABLE_ROW_PROPS}
                rightThreshold={SWIPE_OPEN_THRESHOLD}
                overshootRight={false}
              >
              <CoachAnchor id="setup-gear-row"><View style={[styles.itemRow, index === 0 && styles.itemRowFirst, index === items.length - 1 && styles.itemRowLast, { backgroundColor: C.card }]}>
                {/* 区切り線は他の行と同じくカードの内側の幅で引く（行そのものはカードの端まで広げてある） */}
                {index > 0 && <View style={[styles.itemSeparator, { backgroundColor: C.border }]} />}
                {/* アイコンはジャンル名の行に置き、下の入力欄を行の幅いっぱいに使う。
                    左の列に置くと、商品名・金額・導入日の欄がアイコンの幅だけ狭くなる */}
                <View style={styles.itemHead}>
                  <View style={[styles.previewIcon, { backgroundColor: C.chip }]}>
                    <CategoryIcon category={item.category} pcFormFactor={item.pcFormFactor} customIcon={item.custom?.icon} size={16} color={categoryIconColor(item.category, isDark, undefined, item.custom?.color)} />
                  </View>
                  {/* 機材が10台前後並ぶので、ジャンル名は1行に収めて1台ぶんの背を抑える */}
                  <Text style={[styles.previewName, styles.itemHeadName, { color: C.text }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <CoachAnchor id="setup-gear-detail"><View><IconCircleButton
                    name="tune-variant"
                    diameter={30}
                    color={C.textSub}
                    background={C.chip}
                    onPress={() => { void openItemDetail(item) }}
                    hitSlop={6}
                    accessibilityLabel={lang === 'ja' ? `${item.name}の詳細を設定` : `Set up details of ${item.name}`}
                    accessibilityHint={lang === 'ja' ? '機材の編集画面を開きます' : 'Opens the gadget editor'}
                  /></View></CoachAnchor>
                </View>
                <View>
                  {ownedGadget && (
                    <View style={[styles.ownedAssignment, { backgroundColor: C.accent + '12', borderColor: C.accent + '44' }]}>
                      <AppIcon name={ICONS.check} size={16} color={C.accentIcon} />
                      <View style={styles.ownedAssignmentBody}>
                        <Text style={[styles.ownedAssignmentName, { color: C.text }]} numberOfLines={1}>
                          {localizedGadgetName(ownedGadget, lang)}
                        </Text>
                        <Text style={[styles.ownedAssignmentSub, { color: C.textMuted }]}>
                          {lang === 'ja' ? '登録済みの機材' : 'From your gear'}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => clearOwnedAssignment(item.key)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={lang === 'ja' ? `${ownedGadget.name}の選択を解除` : `Remove ${ownedGadget.name}`}
                      >
                        <Text style={[styles.ownedAssignmentClear, { color: C.accentText }]}>
                          {lang === 'ja' ? '解除' : 'Remove'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={styles.nameFieldWrap}>
                    <ProductNameField
                        inlineSuggestions
                        category={item.category}
                        value={itemProductName(item.key)}
                        colors={C}
                        lang={lang}
                        onChangeText={(value) => setProductName(item.key, value)}
                        onSelectSuggestion={(suggestion) => pickProduct(item.key, suggestion)}
                        onOpenPicker={() => setPickerFor(item)}
                        inputRef={(node) => {
                          if (node) inputRefs.current.set(item.key, node)
                          else inputRefs.current.delete(item.key)
                        }}
                        onFocusChange={(focused) => setFocusedProductKey((current) => (
                          focused ? item.key : current === item.key ? null : current
                        ))}
                        isLast={nameFieldKeys[nameFieldKeys.length - 1] === item.key}
                        onSubmitEditing={() => {
                          const next = nameFieldKeys[nameFieldKeys.indexOf(item.key) + 1]
                          if (next) inputRefs.current.get(next)?.focus()
                        }}
                        accessibilityLabel={`${item.name} ${PRODUCT_BROWSE_ENABLED
                          ? (lang === 'ja' ? '商品名を入力、または楽天の商品から選択' : 'Enter a product name or choose from Rakuten')
                          : (lang === 'ja' ? '商品名を入力' : 'Enter a product name')}`}
                    />
                    {/* 商品名が決まっていなくても出す。金額と導入日だけ先に分かっている人もいて、
                        入れた値は枠のまま保存し、あとで商品名を入れたときに引き継ぐ */}
                    <View style={styles.purchaseRow}>
                      <TextField
                        size="compact"
                        containerStyle={styles.purchaseField}
                        leading={<Text style={[styles.purchaseLabel, { color: C.textMuted }]}>{lang === 'en' ? '$' : '¥'}</Text>}
                        value={itemProductPrice(item.key)}
                        onChangeText={(value) => setProductPrices((prev) => ({ ...prev, [item.key]: sanitizeNumericInput(value) }))}
                        placeholder={lang === 'ja' ? '金額' : 'Price'}
                        keyboardType={lang === 'en' ? 'decimal-pad' : 'numeric'}
                        autoCorrect={false}
                        accessibilityLabel={`${item.name} ${lang === 'ja' ? '購入金額' : 'price'}`}
                      />
                      <DateField
                        size="compact"
                        containerStyle={styles.purchaseField}
                        leading={<Text style={[styles.purchaseLabel, { color: C.textMuted }]}>{lang === 'ja' ? '導入日' : 'Added'}</Text>}
                        value={itemProductDate(item.key)}
                        onChange={(value) => setProductDates((prev) => ({ ...prev, [item.key]: value }))}
                        label={`${item.name} ${lang === 'ja' ? '導入日' : 'date added'}`}
                        maximumDate={maxIntroductionDate}
                        showCalendarIcon={false}
                      />
                    </View>
                    {isReferencePrice(item.key) && (
                      <Text style={[styles.purchaseHint, { color: C.textMuted }]}>
                        {lang === 'ja' ? '金額は商品の参考価格です。払った金額に直せます' : 'The price is the listed price. Change it to what you paid.'}
                      </Text>
                    )}
                      {(() => {
                        // コピー元の商品は枠に入れず、押した人だけ拾える候補として出す（utils/deskCopy.ts）
                        const candidate = copySource ? deskCopyCandidate(copySource, item.key) : undefined
                        if (!candidate || ownedGadget || trimInvisible(itemProductName(item.key))) return null
                        return (
                          <TouchableOpacity
                            style={[styles.copyCandidate, { borderColor: C.border }]}
                            onPress={() => pickProduct(item.key, candidate)}
                            hitSlop={{ top: 6, bottom: 6 }}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={lang === 'ja' ? `コピー元の ${candidate.name} を入れる` : `Use ${candidate.name} from the original desk`}
                          >
                            <AppIcon name={ICONS.add} size={14} color={C.accentText} />
                            <Text style={[styles.copyCandidateName, { color: C.accentText }]} numberOfLines={1}>
                              {candidate.name}
                            </Text>
                            <Text style={[styles.copyCandidateSub, { color: C.textMuted }]}>
                              {lang === 'ja' ? 'コピー元' : 'Original'}
                            </Text>
                          </TouchableOpacity>
                        )
                      })()}
                  </View>
                </View>
              </View></CoachAnchor>
              </SwipeableRow>
              )}
              </RemovableTemplateItem>
              </AdditionMotion>
            )
          })}
        </View>

        <CoachAnchor id="setup-category-add"><View><Button
          title={lang === 'ja' ? 'ジャンルを追加' : 'Add a category'}
          variant="ghost"
          size="compact"
          leading={<AppIcon name={ICONS.add} size={18} color={C.accentIcon} />}
          style={styles.addCategoryButton}
          onPress={() => setCatPickerOpen(true)}
        /></View></CoachAnchor>

        <Text style={[styles.note, { color: C.textMuted }]}>
          {returnPlanId
            ? (lang === 'ja'
              ? '構成を入れ替えます。同じジャンルの機材は引き継ぎ、配置と配線は次の画面で決め直します。'
              : 'Replace the setup. Matching registered gear stays; reset placement and wiring next.')
            : lang === 'ja'
            ? '用途に合わせた候補です。商品名が空の項目は、あとからまとめて入力できます。'
            : 'Suggestions for your purposes. Fill empty product names later.'}
        </Text>
      </ScrollView>
      </View>

      {/* このテンプレートを使う */}
      <SetupActionFooter
        showGuide
        absolute
        onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
        title={creating
          ? (lang === 'ja' ? '配置を準備中…' : 'Preparing layout…')
          : (lang === 'ja' ? '次へ（配置）' : 'Next: Layout')}
        onPress={handleCreatePress}
        disabled={items.length === 0 || creating || removingKeys.size > 0}
        loading={creating}
      >
        {createError && (
          <Text style={[styles.createError, { color: C.danger }]} accessibilityRole="alert">
            {returnPlanId
              ? (lang === 'ja' ? '構成を変更できませんでした。設定内容は残っています。' : 'Could not update the setup. Your choices are still here.')
              : (lang === 'ja' ? 'デスクを作成できませんでした。設定内容は残っています。' : 'Could not create the desk. Your setup is still here.')}
          </Text>
        )}
      </SetupActionFooter>
      </KeyboardAvoidingView>

      {/* 下から出るシートの土台に寄せる。Modal の slide は暗い背景ごとせり上がり、出るまでがもたついた */}
      <BottomSheetModal visible={ownedPickerOpen} onDismiss={closeOwnedPicker} sheetStyle={styles.sheet}>
            <View style={[styles.sheetHeader, { borderBottomColor: C.border }]}>
              <View style={styles.ownedPickerTitleWrap}>
                <Text style={[styles.sheetTitle, styles.ownedPickerTitle, { color: C.text }]}>
                  {lang === 'ja' ? '登録済みの機材から選ぶ' : 'Choose from your gear'}
                </Text>
                <Text style={[styles.ownedPickerCount, { color: C.textMuted }]}>
                  {lang === 'ja'
                    ? `${draftSelectedOwnedIds.size}点選択・同じジャンルへ自動割り当て`
                    : `${draftSelectedOwnedIds.size} selected · assigned by category`}
                </Text>
              </View>
              <TouchableOpacity onPress={closeOwnedPicker} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
                <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.ownedPickerList} keyboardShouldPersistTaps="handled">
              {ownedCandidates.length === 0 ? (
                <View style={styles.ownedPickerEmpty}>
                  <AppIcon name={ICONS.package} size={30} color={C.textMuted} />
                  <Text style={[styles.ownedPickerEmptyText, { color: C.textMuted }]}>
                    {lang === 'ja'
                      ? 'この構成に使える登録済み機材はありません。商品を選ぶか、商品名を入力してください。'
                      : 'No saved gear matches this setup. Choose a product or enter its name.'}
                  </Text>
                </View>
              ) : ownedCandidates.map((gadget) => {
                const selected = draftSelectedOwnedIds.has(gadget.id)
                return (
                  <TouchableOpacity
                    key={gadget.id}
                    style={[styles.ownedPickerRow, { borderBottomColor: C.separator }]}
                    onPress={() => toggleOwnedGadget(gadget.id)}
                    activeOpacity={0.7}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <View style={[styles.ownedPickerIcon, { backgroundColor: C.chip }]}>
                      <CategoryIcon category={gadget.category} pcFormFactor={gadget.pcFormFactor} customIcon={gadget.customCategory?.icon} size={18} color={categoryIconColor(gadget.category, isDark, undefined, gadget.customCategory?.color)} />
                    </View>
                    <View style={styles.ownedPickerRowBody}>
                      <Text style={[styles.ownedPickerName, { color: C.text }]} numberOfLines={1}>
                        {localizedGadgetName(gadget, lang)}
                      </Text>
                      <Text style={[styles.ownedPickerCategory, { color: C.textMuted }]}>
                        {gadgetCategoryLabel(gadget, t)}
                      </Text>
                    </View>
                    <AppIcon
                      name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
                      size={22}
                      color={selected ? C.accentIcon : C.textMuted}
                    />
                  </TouchableOpacity>
                )
              })}
            </ScrollView>
            <View style={[styles.ownedPickerFooter, { borderTopColor: C.border }]}>
              <Button
                title={lang === 'ja' ? `選択した${draftSelectedOwnedIds.size}点を使う` : `Use ${draftSelectedOwnedIds.size} selected`}
                onPress={confirmOwnedPicker}
                style={styles.applyBtn}
              />
            </View>
      </BottomSheetModal>

      {/* ジャンル（カテゴリ）追加シート */}
      <BottomSheetModal visible={catPickerOpen} onDismiss={() => setCatPickerOpen(false)} sheetStyle={styles.sheet}>
            <View style={[styles.sheetHeader, { borderBottomColor: C.border }]}>
              <Text style={[styles.sheetTitle, { color: C.text }]}>
                {lang === 'ja' ? 'ジャンルを追加' : 'Add a category'}
              </Text>
              <TouchableOpacity onPress={() => setCatPickerOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
                <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            {catPickerOpen && <CategorySectionPicker layout="list" onSelect={addCategory} onSelectCustom={addCustomCategory} />}
      </BottomSheetModal>

      <ProductPickerModal
        visible={pickerFor !== null}
        category={pickerFor?.category ?? 'Other'}
        categoryLabel={pickerFor?.name}
        title={lang === 'ja' ? '楽天の商品から選ぶ' : 'Choose from Rakuten'}
        marketplaceOnly
        onClose={() => setPickerFor(null)}
        onSelect={(suggestion) => {
          if (pickerFor) pickProduct(pickerFor.key, suggestion)
          setPickerFor(null)
        }}
      />

      <MissingIntroductionDateSheet
        visible={missingDateCount > 0}
        count={missingDateCount}
        leavesUnnamedUnset
        onDismiss={() => setMissingDateCount(0)}
        onDismissed={() => applyAfterSheetDismiss('date')}
        onChoose={(choice) => {
          // この画面は持ち物として登録するときだけ出る（候補は導入日を聞かない）
          closeSheetAndApply('date', choice, true)
        }}
      />
      <NewGearOwnershipSheet
        visible={ownershipAskCount > 0}
        count={ownershipAskCount}
        onDismiss={() => setOwnershipAskCount(0)}
        onDismissed={() => applyAfterSheetDismiss('ownership')}
        onChoose={(owned) => {
          // 切り替えにも写す。日付の画面を閉じて戻ったとき、同じ問いを繰り返さない
          if (owned) setRegisterAsOwned(true)
          closeSheetAndApply('ownership', undefined, owned)
        }}
      />
      <TemplateSpecSheet
        visible={specOpen}
        items={specItems}
        countLockedKeys={countLockedKeys}
        armAskedKeys={armAskedKeys}
        formFactorKeys={formFactorKeys}
        outlet={{
          count: outletCount,
          onChange: (next) => {
            hapticSelection()
            setOutletCount(next)
          },
        }}
        specFor={specFor}
        productNames={productNames}
        onChange={changeSpec}
        onClose={() => setSpecOpen(false)}
        onConfirm={() => closeSheetAndApply('spec')}
        onDismissed={() => applyAfterSheetDismiss('spec')}
      />

      </SetupScreenHelp>
    </SafeAreaView>
  )
}

function RemovableTemplateItem({ children, onRemoving, onRemove }: {
  children: (remove: () => void) => ReactNode
  onRemoving: () => void
  onRemove: () => void
}) {
  const { reduceMotion } = useApp()
  const [removing, setRemoving] = useState(false)
  const removingRef = useRef(false)
  const size = useRef({ width: 0, height: 0 })
  const offset = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(1)).current
  const height = useRef(new Animated.Value(0)).current
  const animation = useRef<Animated.CompositeAnimation | null>(null)

  useEffect(() => () => animation.current?.stop(), [])

  const remove = () => {
    if (removingRef.current) return
    removingRef.current = true
    if (reduceMotion || size.current.height === 0 || size.current.width === 0) {
      onRemove()
      return
    }
    height.setValue(size.current.height)
    setRemoving(true)
    onRemoving()
    animation.current = Animated.sequence([
      Animated.parallel([
        Animated.timing(offset, {
          toValue: -size.current.width,
          duration: 150,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]),
      Animated.timing(height, {
        toValue: 0,
        duration: 100,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }),
    ])
    animation.current.start(({ finished }) => {
      if (finished) onRemove()
    })
  }

  return (
    <Animated.View
      style={[styles.swipeRowContainer, styles.removalClip, removing && { height }]}
      pointerEvents={removing ? 'none' : 'auto'}
      accessibilityElementsHidden={removing}
      importantForAccessibility={removing ? 'no-hide-descendants' : 'auto'}
    >
      <Animated.View
        onLayout={(event) => { if (!removingRef.current) size.current = event.nativeEvent.layout }}
        style={{ opacity, transform: [{ translateX: offset }] }}
      >
        {children(remove)}
      </Animated.View>
    </Animated.View>
  )
}

// 機材のカードの横の内余白。スワイプの行はこの分だけ外へ広げてカードの端に揃える
const CARD_GUTTER = 14

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardArea: { flex: 1 },
  loadingState: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, fontWeight: '600' },
  // 下余白は下部バーの実測（footerH）で上書きする。ここは測れるまでの初期値
  scroll: { padding: UI_METRICS.screenGutter, paddingBottom: 130 },
  notFound: { textAlign: 'center', marginTop: 60, fontSize: 14 },
  adjustNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: UI_METRICS.panelRadius, padding: 12, marginBottom: 18 },
  adjustNoticeText: { flex: 1, fontSize: 12, lineHeight: 18 },

  sectionLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  ownedAddButton: { minHeight: UI_METRICS.touchMinSize, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 1, borderRadius: UI_METRICS.controlRadius, marginBottom: 12 },
  ownedAddLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  addCategoryButton: { marginTop: 4, marginBottom: 14 },
  previewCard: { borderRadius: UI_METRICS.cardRadius, paddingHorizontal: CARD_GUTTER },
  // カードの横の内余白を打ち消して、行（とスワイプで出る削除）をカードの端から端まで広げる。
  // 内余白の内側に置くと、削除ボタンの右にカードの地が細く残っていた。
  // 器のはみ出しは Swipeable の既定（hidden）のままにする。visible にすると、スワイプで左へ動いた行が
  // カードの外へはみ出して見えた。商品名の候補は重ねずに欄の下へ差し込むので、はみ出しは要らない
  swipeRowContainer: { marginHorizontal: -CARD_GUTTER },
  removalClip: { overflow: 'hidden' },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  itemRow: { paddingVertical: 8, paddingHorizontal: CARD_GUTTER },
  // カードの端まで広げた行は、先頭と末尾をカードの角に合わせる
  itemRowFirst: { borderTopLeftRadius: UI_METRICS.cardRadius, borderTopRightRadius: UI_METRICS.cardRadius },
  itemRowLast: { borderBottomLeftRadius: UI_METRICS.cardRadius, borderBottomRightRadius: UI_METRICS.cardRadius },
  itemSeparator: { position: 'absolute', top: 0, left: CARD_GUTTER, right: CARD_GUTTER, height: StyleSheet.hairlineWidth },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 30 },
  itemHeadName: { flex: 1 },
  previewIcon: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  deleteAction: { justifyContent: 'center' },
  deleteButton: {
    width: 72,
    height: '100%',
    minHeight: UI_METRICS.touchMinSize,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: UI_STATUS_COLORS.danger,
  },
  deleteButtonFirst: { borderTopRightRadius: UI_METRICS.cardRadius },
  deleteButtonLast: { borderBottomRightRadius: UI_METRICS.cardRadius },
  deleteLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },
  previewName: { fontSize: 14, fontWeight: '600' },
  emptyHint: { flex: 1, fontSize: 12, lineHeight: 18 },
  previewSub: { fontSize: 11, flexShrink: 10 },
  nameFieldWrap: { marginTop: 6 },
  // 商品名の欄（44）より低くして、主の入力と補助の入力を見分けられるようにする
  purchaseRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  purchaseField: {
    flex: 1,
  },
  purchaseLabel: { fontSize: 12 },
  purchaseHint: { fontSize: 11, marginTop: 4 },
  // 候補の札。入力欄の直下に1行で置き、押せる高さは行全体（minHeight）で確保する
  copyCandidate: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%',
    marginTop: 6, minHeight: 32, paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.chipRadius,
  },
  copyCandidateName: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  copyCandidateSub: { fontSize: 11 },
  ownedAssignment: { minHeight: UI_METRICS.touchMinSize, marginTop: 6, borderWidth: 1, borderRadius: UI_METRICS.controlRadius, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  ownedAssignmentBody: { flex: 1 },
  ownedAssignmentName: { fontSize: 13, fontWeight: '600' },
  ownedAssignmentSub: { fontSize: 10, marginTop: 1 },
  ownedAssignmentClear: { fontSize: 12, fontWeight: '600' },
  note: { fontSize: 12, lineHeight: 18 },
  createError: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginBottom: 8 },

  applyBtn: { width: '100%' },

  // 中の一覧の下余白は 12 しか無く、これが無いと最後の行がホームインジケータに掛かる
  sheet: { maxHeight: '75%', paddingHorizontal: 0, borderTopLeftRadius: UI_METRICS.sheetRadius, borderTopRightRadius: UI_METRICS.sheetRadius, overflow: 'hidden', paddingBottom: UI_METRICS.sheetBottom },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  ownedPickerTitleWrap: { flex: 1 },
  // sheetTitle の flex: 1 は閉じるボタンと横に並べるためのもの。ここでは件数と縦に積むので、
  // 縦方向に効いて見出しの高さが潰れ、上下が切れて件数の行と重なっていた
  ownedPickerTitle: { flex: 0 },
  ownedPickerCount: { fontSize: 11, marginTop: 2 },
  ownedPickerList: { paddingHorizontal: UI_METRICS.screenGutter, paddingBottom: 8 },
  ownedPickerRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9 },
  ownedPickerIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  ownedPickerRowBody: { flex: 1 },
  ownedPickerName: { fontSize: 14, fontWeight: '600' },
  ownedPickerCategory: { fontSize: 11, marginTop: 2 },
  ownedPickerEmpty: { alignItems: 'center', gap: 10, paddingHorizontal: 28, paddingVertical: 32 },
  ownedPickerEmptyText: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
  ownedPickerFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, paddingBottom: UI_METRICS.sheetBottom },
})
