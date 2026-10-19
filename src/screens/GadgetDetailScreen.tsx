import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useHeaderHeight } from '@react-navigation/elements'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Keyboard,
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
import { AppIcon } from '../components/atoms/AppIcon'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { COACH_SCREEN, CoachAnchor, CoachScope, useCoachMarks } from '../hooks/useCoachMarks'
import { GADGET_DETAIL_COACH } from '../constants/gadgetCoachSteps'
import { CopyProductNameButton } from '../components/atoms/CopyProductNameButton'
import { Button } from '../components/atoms/Button'
import { CategoryIcon } from '../components/atoms/CategoryIcon'
import { TextField } from '../components/atoms/TextField'
import { ProductSearchButton } from '../components/atoms/ProductSearchButton'
import { AccordionField } from '../components/molecules/AccordionField'
import { SelectField } from '../components/molecules/SelectField'
import { DESK_TOP_COLOR_OPTIONS } from '../utils/deskTopColor'
import { DisplayOnlySwitch } from '../components/molecules/DisplayOnlySwitch'
import { ContrastToggle } from '../components/atoms/ContrastToggle'
import {
  DeskUsageHistoryEditor,
  DeskUsagePeriodDraft,
  parseUsagePeriodDrafts,
  usagePeriodDrafts,
} from '../components/molecules/DeskUsageHistoryEditor'
import { DateField } from '../components/molecules/DateField'
import { localizedGadgetName } from '../utils/localizedGadgetName'
import { DeskDimensionFields } from '../components/molecules/DeskDimensionFields'
import { PowerInputFields } from '../components/molecules/PowerInputFields'
import { PcSpecFields } from '../components/molecules/PcSpecFields'
import { PortStepperRow, ToggleRow } from '../components/molecules/GadgetFormRows'
import { ConnectTargetPicker, WirelessGadgetPicker } from '../components/organisms/GadgetTargetPickers'
import { MountingType, parseOperationModes } from '../components/molecules/GadgetMetadataEditor'
import { currentUsageMode, withCurrentUsageMode } from '../utils/usageModeToggle'
import { hasConfiguredVisiblePorts, PortConfigurationEditor } from '../components/molecules/PortConfigurationEditor'
import { isGroundedPort, isPowerFeedPort, isReceiverPort, isWiredPort } from '../utils/portRoles'
import { CategorySectionPicker } from '../components/organisms/CategorySectionPicker'
import { ProductPickerModal } from '../components/organisms/ProductPickerModal'
import { categoryIconColor, ICONS, categoryBaseColor } from '../constants/icons'
import { CABLE_TYPE_OPTIONS } from '../constants/gadgetFormOptions'
import {
  CATEGORY_PORT_CONFIG,
  NEEDS_HOST_CATEGORIES,
  PortState,
  categoryDefaultPortState,
  initPortState,
  isCategoryDefaultPortState,
} from '../constants/portFormConfig'
import { cableLabel, portIconColor } from '../constants/portTypes'
import { useApp } from '../context/AppContext'
import { useGadgets } from '../hooks/useGadgets'
import { useCustomCategories } from '../hooks/useCustomCategories'
import { usePlans } from '../hooks/usePlans'
import { usePlanOpenedAt } from '../hooks/usePlanOpenedAt'
import { sortPlansLikeMyDesk } from '../store/displaySettings'
import { useGadgetDeletion } from '../hooks/useGadgetDeletion'
import { useConfirmDiscard } from '../hooks/useConfirmDiscard'
import { useKeyboardReveal } from '../hooks/useKeyboardReveal'
import { useToday } from '../hooks/useToday'
import { CableType, CustomCategory, DeskGadgetUsagePeriod, DeskTopColor, DeskZone, Gadget, GadgetCategory, GadgetStackParamList, Port } from '../types'
import { customCategoryOf } from '../utils/customCategory'
import {
  buildGadgetPorts,
  chargerFormStateFromPorts,
  canSelectPowerSource,
  canSupplyPowerInput,
  defaultPowerInputForCategory,
  defaultPowerUsageForCategory,
  inferPowerFromPorts,
  DEFAULT_CHARGER_USB_A,
  DEFAULT_CHARGER_USB_C,
  DIRECT_ATTACH_CATEGORIES,
  isDirectAttachGadget,
  isPowerReceivingPort,
  isWirelessPowerPort,
  MouseConnType,
  NO_POWER_INPUT_CATEGORIES,
  PowerInput,
  PowerUsage,
  usbPowerPortSlots,
} from '../utils/gadgetPorts'
import { useProductSuggestions } from '../hooks/useProductSuggestions'
import { cableTypeFromName } from '../utils/cableTypeFromName'
import { ProductSuggestion } from '../utils/productSuggestions'
import { deskUsagePeriods, getDeskGadgetUsage, hasCurrentDeskUsageAfterEdit, setDeskGadgetUsage, usageModeAt } from '../utils/deskGadgetUsage'
import { beginPlanReflection, endPlanReflection } from '../utils/planReflection'
import { localDateKey } from '../utils/deskTimeline'
import { normalizeHttpUrl } from '../utils/url'
import { normalizeDimensionInput, orderedRange, sanitizeNumericInput } from '../utils/numericInput'
import { showConfirmation, showMessage } from '../utils/confirmation'
import { hapticError, hapticSuccess } from '../utils/haptics'
import { dateFormatHint, formatStoredDate, parseDateInput } from '../utils/dateFormat'
import { analytics, EVENTS } from '../services/analytics'
import { statusTextColor, UI_METRICS } from '../constants/ui'
import { GADGET_MEMO_MAX_LENGTH, GADGET_NAME_MAX_LENGTH, GADGET_NICKNAME_MAX_LENGTH } from '../constants/textLimits'
import { inputMaxLength, tidyMultilineText, trimAndTruncate, trimInvisible, truncateChars } from '../utils/truncateText'

// この画面は PlanStack と MyPageStack の両方に積まれる。どちらでも goBack しかせず、
// 名前で他の画面へ移動しないので、ホスト側の ParamList に縛られる必要がない。
// GadgetStackParamList で型を付けると登録時に as any が要る（積む先の
// ParamList と一致しないため）ので、使う機能だけを要求する形にしてある
type Props = {
  route: { params: GadgetStackParamList['GadgetDetail'] }
  navigation: Pick<
    NativeStackNavigationProp<GadgetStackParamList, 'GadgetDetail'>,
    'goBack' | 'setOptions' | 'addListener' | 'dispatch' | 'isFocused'
  >
}

// ═══════════════════════════════════════════════════════════════
// 定数・モジュールレベルヘルパー
// ═══════════════════════════════════════════════════════════════

const detectPowerInput = (category: GadgetCategory, ports: Port[]): PowerInput => {
  // 給電用のUSB入力を優先（A/Cから）。なければPower入力＝コンセントから
  // ラベルの無いライトの USB 口も給電の口として読む。読めないと「なし」で開き、
  // 保存し直すと給電方法の既定の口が足される（登録時の inferPowerFromPorts と同じ判定）
  const feeds = (p: Port) => isPowerFeedPort(p) || isPowerReceivingPort(category, p)
  if (ports.some((p) => p.type === 'wirelessCharging' && p.direction === 'input')) return 'wireless'
  if (ports.some((p) => p.type === 'USB_A' && p.direction === 'input' && feeds(p))) return 'from_a'
  if (ports.some((p) => p.type === 'USB_C' && p.direction === 'input' && feeds(p))) return 'from_c'
  if (ports.some((p) => p.type === 'DCPower' && p.direction === 'input')) return 'dc'
  if (ports.some((p) => p.type === 'Power' && p.direction === 'input')) return 'outlet'
  return 'none'
}

const detectMouseConnType = (ports: Port[]): MouseConnType => {
  if (ports.some((p) => p.type === 'USB_A' && p.direction === 'input' && isReceiverPort(p))) return 'dongle'
  const hasBt = ports.some(
    (p) => p.type === 'Bluetooth' && (p.direction === 'output' || p.direction === 'bidirectional'),
  )
  return hasBt ? 'wireless' : 'wired'
}

const detectPeriConnType = (ports: Port[]): MouseConnType => {
  if (ports.some((p) => p.type === 'USB_A' && p.direction === 'input' && isReceiverPort(p))) return 'dongle'
  if (ports.some((p) => p.direction === 'input' && isWiredPort(p))) return 'wired'
  const hasBt = ports.some(
    (p) => p.type === 'Bluetooth' && (p.direction === 'output' || p.direction === 'bidirectional'),
  )
  return hasBt ? 'wireless' : 'wired'
}

const PC_FORM_FACTOR_OPTIONS = [
  { key: 'desktop', ja: 'デスクトップ', en: 'Desktop' },
  { key: 'laptop', ja: 'ノートPC', en: 'Laptop' },
  { key: 'mini', ja: 'ミニPC', en: 'Mini PC' },
] as const

const CONSOLE_FORM_FACTOR_OPTIONS = [
  { key: 'stationary', ja: '据え置き', en: 'Stationary' },
  { key: 'handheld', ja: '携帯機', en: 'Handheld' },
] as const

export function GadgetDetailScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets()
  // キーボードを避ける量はウィンドウの上端から測られる。渡さないと、入力欄の下端が
  // ヘッダーの高さぶんキーボードに隠れる
  const headerHeight = useHeaderHeight()
  const { gadgetId, planId } = route.params
  const { gadgets, update, add } = useGadgets()
  const { plans, getById: getPlanById, updateWith: updatePlanWith } = usePlans()
  const { deleteGadget } = useGadgetDeletion()
  const { categories: customCategories } = useCustomCategories()
  const { colors, t, lang, isDark, unitLabel, parsePriceToJpy, fmtPriceInput, reduceMotion } = useApp()
  const gadget = route.params.draftGadget ?? gadgets.find((g) => g.id === gadgetId)
  const coach = useCoachMarks()
  const { target: coachTarget, open: openCoach } = coach
  const openHelp = useCallback(() => { void openCoach(GADGET_DETAIL_COACH) }, [openCoach])
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: gadget ? () => (
      <HeaderIconButton name="help-circle-outline" color={colors.text} onPress={openHelp}
        accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'} />
    ) : undefined })
  }, [navigation, colors.text, lang, openHelp, gadget])
  const isDraft = !!route.params.draftGadget
  const draftSavedRef = useRef(false)
  // useEffect だと、画面が入る間は既定の表題が描かれてから差し替わる
  useLayoutEffect(() => {
    if (isDraft) navigation.setOptions({ title: lang === 'ja' ? '機材の詳細設定' : 'Gear settings' })
  }, [isDraft, navigation, lang])
  const deskPlan = planId ? getPlanById(planId) : null
  const C = colors

  // ═════════════════════════════════════════════════════════════
  // フォーム state（機能グループごと）
  // ═════════════════════════════════════════════════════════════
  // 基本情報
  const [name,         setName]         = useState('')
  // 呼び名の入力欄は廃止。既存データ（配線図の見出しに出る）を保存で消さないため読み書きだけ残す
  const [nickname,     setNickname]     = useState('')
  const [nameFocused,  setNameFocused]  = useState(false)
  const nameBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (nameBlurTimerRef.current !== null) clearTimeout(nameBlurTimerRef.current)
  }, [])
  const [category,     setCategory]     = useState<GadgetCategory>('Other')
  // 自作ジャンル。category は 'Other' のまま、名前と絵だけをこれで上書きする
  const [customCategory, setCustomCategory] = useState<CustomCategory | undefined>(undefined)
  // 名前と絵は選んだ時点の写しではなく、いまの一覧から id で引く。この画面のカテゴリ選択の中で
  // ジャンル名を直せるので、写しのまま保存すると改名がこの機材だけ元に戻る
  const liveCustomCategory = customCategory
    ? (customCategories.find((item) => item.id === customCategory.id) ?? customCategory)
    : undefined
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showProductPicker, setShowProductPicker] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const saveInFlightRef = useRef(false)
  const deleteInFlightRef = useRef(false)
  const confirmationRef = useRef<object | null>(null)
  // 入力欄は廃止したが、既に url を持つガジェットの値を保存時に消さないため state は残す
  const [url,               setUrl]               = useState('')
  const suggestionSelectedRef = useRef(false)
  // 商品を選び直したら引き継ぎ元も新しい商品に移す。
  // 元のガジェットのままだと、前の機種にしか無い口が混ざる
  const suggestionPortsRef = useRef<Port[] | undefined>(undefined)
  /** 予測変換で選んだ商品への参照。購入リンクはここから都度引く */
  const [productId,         setProductId]         = useState<string | undefined>(undefined)

  // 接続・電源
  const [portState,    setPortState]    = useState<PortState>({})
  const [mouseConnType,      setMouseConnType]      = useState<MouseConnType>('wireless')
  const [periConnType,       setPeriConnType]       = useState<MouseConnType>('wireless')
  const [receiverLabel,      setReceiverLabel]      = useState('')
  const [receiverSupportsBluetooth, setReceiverSupportsBluetooth] = useState(false)
  const [connectedToId,      setConnectedToId]      = useState<string | null>(null)
  // 給電元に指定した充電器（null = 自動選択）
  const [powerSourceId,      setPowerSourceId]      = useState<string | null>(null)
  const [powerSourcePortId,  setPowerSourcePortId]  = useState<string | null>(null)
  const [powerInput,    setPowerInput]    = useState<PowerInput>('none')
  const [powerUsage,    setPowerUsage]    = useState<PowerUsage>('continuous')

  // 充電器
  // 充電器の既定の口数（USB-C 2口 + USB-A 1口）。テンプレートのプレースホルダーと揃える
  const [chargeUsbC,          setChargeUsbC]          = useState(DEFAULT_CHARGER_USB_C)
  const [chargeUsbA,          setChargeUsbA]          = useState(DEFAULT_CHARGER_USB_A)
  const [chargeWirelessCount, setChargeWirelessCount] = useState(0)
  const [wirelessTargetIds,   setWirelessTargetIds]   = useState<string[]>([])
  // 容量の入力欄は廃止。既存データを保存で消さないため読み書きだけ残す
  const [batteryCapacityMah, setBatteryCapacityMah] = useState('')
  const [batteryCapacityWh, setBatteryCapacityWh] = useState('')
  const [supportsPassThroughCharging, setSupportsPassThroughCharging] = useState(false)

  // 電源タップ
  const [stripOutlets,       setStripOutlets]       = useState(4)
  const [stripUsbC,          setStripUsbC]          = useState(0)
  const [stripUsbA,          setStripUsbA]          = useState(0)
  const [stripGrounded,      setStripGrounded]      = useState(false)

  // デスク・寸法
  const [deskWidth,          setDeskWidth]          = useState('')
  const [deskDepth,          setDeskDepth]          = useState('')
  const [deskHeight,         setDeskHeight]         = useState('')
  const [deskHeightMin,      setDeskHeightMin]      = useState('')
  const [deskHeightMax,      setDeskHeightMax]      = useState('')
  const [isHeightAdjustable, setIsHeightAdjustable] = useState(false)
  const [isElectricDesk,     setIsElectricDesk]     = useState(false)
  const [dimensions,         setDimensions]         = useState('')
  const [deskTopColor,       setDeskTopColor]       = useState<DeskTopColor | undefined>(undefined)

  // その他属性
  const [memo,               setMemo]               = useState('')
  // 数量・設置／固定関係・デスクでの位置・運用モードの入力欄は廃止。
  // 既存データ（数量は金額の合計に効く）を保存で消さないため読み書きだけ残す
  const [quantity,           setQuantity]           = useState('1')
  const [mountingType,       setMountingType]       = useState<MountingType>('mounted_on')
  const [mountingTargetId,   setMountingTargetId]   = useState<string | null>(null)
  const [mountingNote,       setMountingNote]       = useState('')
  const [operationModes,     setOperationModes]     = useState('')
  const [activeOperationMode, setActiveOperationMode] = useState('')
  const [softwareSettings,   setSoftwareSettings]   = useState('')
  const [placementZone,      setPlacementZone]      = useState<DeskZone>('back_center')
  const [placementLabel,     setPlacementLabel]     = useState('')
  // 飾り（通電・配線なし）。ON にすると配線図にノードだけ出て線は引かれない
  const [displayOnly,       setDisplayOnly]       = useState(false)
  const [registerAsOwned, setRegisterAsOwned] = useState(false)
  const [cableType,         setCableType]         = useState<CableType | ''>('')
  const [cableCount,        setCableCount]        = useState(1)

  // カテゴリ固有フラグ・ゲーム
  const [stereoPair,         setStereoPair]         = useState(false)
  const [speakerInputSide,   setSpeakerInputSide]   = useState<'L' | 'R'>('R')
  const [hasSubwoofer,       setHasSubwoofer]       = useState(false)
  const [splitKeyboard,      setSplitKeyboard]      = useState(false)
  const [directAttach,       setDirectAttach]       = useState(false)
  // よく使うアプリの入力欄は廃止。既存データを保存で消さないため読み書きだけ残す
  const [games,              setGames]              = useState<string[]>([])

  // PC 構成
  const [pcCpu,         setPcCpu]         = useState('')
  const [pcCpuProductId, setPcCpuProductId] = useState<string | undefined>()
  const [pcGpu,         setPcGpu]         = useState('')
  const [pcGpuProductId, setPcGpuProductId] = useState<string | undefined>()
  const [pcRam,         setPcRam]         = useState('')
  const [pcRamProductId, setPcRamProductId] = useState<string | undefined>()
  const [pcStorage,     setPcStorage]     = useState('')
  const [pcStorageProductId, setPcStorageProductId] = useState<string | undefined>()
  const [pcThunderbolt, setPcThunderbolt] = useState(false)
  const [pcFormFactor,   setPcFormFactor]   = useState<'desktop' | 'laptop' | 'mini'>('desktop')
  const [pcShowDetails, setPcShowDetails] = useState(false)
  // 配線の詳細（端子・接続・給電）の開閉。商品を選べば端子は入るので既定は閉じる
  const [wiringOpen, setWiringOpen] = useState(false)
  const [consoleFormFactor, setConsoleFormFactor] = useState<'stationary' | 'handheld'>('stationary')
  // モニターのサイズ・解像度・リフレッシュレートは入力欄を廃止した。
  // 既存データ（過去に入力した値・デモデスク）を保存で消さないため読み書きだけ残す
  const [monitorSizeInches, setMonitorSizeInches] = useState('')
  const [monitorResolution, setMonitorResolution] = useState('')
  const [monitorRefreshRateHz, setMonitorRefreshRateHz] = useState('')
  // 容量・画面サイズの入力欄は廃止。既存データを保存で消さないため読み書きだけ残す
  const [storageCapacity, setStorageCapacity] = useState('')
  const [smartDeviceScreenSize, setSmartDeviceScreenSize] = useState('')
  const [smartDeviceStorage, setSmartDeviceStorage] = useState('')

  // 購入情報・日付
  const [price,        setPrice]        = useState('')
  // 予測変換が入れた商品DBの価格のままか。「購入金額」の欄に入っているので、
  // 言わないと払った額として保存される（セール・中古で買った人ほどずれる）
  const [priceIsReference, setPriceIsReference] = useState(false)
  const [purchasedAt,       setPurchasedAt]       = useState('')
  const [removedAt,         setRemovedAt]         = useState('')
  const [usagePeriods,      setUsagePeriods]      = useState<DeskUsagePeriodDraft[]>([])
  // ライブラリから開いたときに編集した、デスクごとの在籍期間。触ったデスクだけ入る。
  // 初期値を state へ流し込むと保存のたびに再初期化が要るので、未編集のデスクは
  // 描画時に保存済みデータから作って渡す
  const [editedDeskUsage, setEditedDeskUsage] = useState<Record<string, DeskUsagePeriodDraft[]>>({})
  // 保存済みの値を入力欄へ流し込むたびに増やす。流し込んだ値が描画に乗ったあとで
  // 「変更なし」の基準を控えるための合図（同じ回の state 更新と一緒に反映される）
  const [formBaselineToken, setFormBaselineToken] = useState(0)
  // 導入予定日として1年先まで選べる（以前のダイヤルと同じ上限）
  const today = useToday()
  const maxGadgetDate = useMemo(() => {
    const date = new Date(today)
    date.setFullYear(date.getFullYear() + 1)
    return date
  }, [today])

  const detailScrollRef = useRef<ScrollView>(null)
  const usageFocusedRef = useRef(false)
  // 型番・仕様・金額・URL など中ほどから下の欄は、押すとキーボードの裏に入ったままになっていた
  useKeyboardReveal(detailScrollRef)

  // ═════════════════════════════════════════════════════════════
  // 派生値
  // ═════════════════════════════════════════════════════════════
  const isFutureDate = useMemo(() => {
    const parsed = parseDateInput(purchasedAt, lang)
    if (!parsed) return false
    return parsed > localDateKey(today)
  }, [purchasedAt, lang, today])

  // ローカルのプリセットを即座に出しつつ、商品DB（1万件超）の結果を後ろに足す
  const suggestions = useProductSuggestions(category, name, lang)
  // 欄を選んだだけではプリセットを開かない（ProductNameField と同じ）
  const showSuggestions = nameFocused && trimInvisible(name) !== '' && suggestions.length > 0
  // デスクごとの期間はマイデスクと同じ並びで出す（作った順のままだと位置が違う）。
  // 並びは開いた時点で決めて保つ。最後に触った順は裏の保存でも動くので、期間を打っている
  // 最中に行が入れ替わらないようにする。あとから増えたデスクは後ろへ
  const planOpenedAt = usePlanOpenedAt()
  const [deskRowRank, setDeskRowRank] = useState<Map<string, number> | null>(null)
  useEffect(() => {
    if (deskRowRank || !planOpenedAt) return
    setDeskRowRank(new Map(sortPlansLikeMyDesk(plans, planOpenedAt).map((plan, index) => [plan.id, index])))
  }, [deskRowRank, planOpenedAt, plans])
  const relatedPlanUsages = useMemo(() => {
    if (!gadget) return []
    return plans
      .filter((plan) =>
        plan.selectedGadgetIds.includes(gadget.id) ||
        Object.prototype.hasOwnProperty.call(plan.gadgetUsage ?? {}, gadget.id),
      )
      .sort((a, b) => deskRowRank ? (deskRowRank.get(a.id) ?? Infinity) - (deskRowRank.get(b.id) ?? Infinity) : 0)
      .map((plan) => ({ plan, usage: getDeskGadgetUsage(plan, gadget) }))
  }, [gadget, plans, deskRowRank])
  const bluetoothCandidateGadgets = useMemo(() => {
    const relatedPlans = deskPlan
      ? [deskPlan]
      : plans.filter((plan) => plan.selectedGadgetIds.includes(gadgetId))
    const selectedIds = new Set(relatedPlans.flatMap((plan) => plan.selectedGadgetIds))
    return gadgets.filter((item) => item.id !== gadgetId && selectedIds.has(item.id))
  }, [deskPlan, gadgetId, gadgets, plans])

  const powerSourceCandidates = useMemo(
    () => bluetoothCandidateGadgets.filter((item) =>
      canSelectPowerSource(category, item.category) && canSupplyPowerInput(item, powerInput)),
    [bluetoothCandidateGadgets, category, powerInput],
  )

  // 充電元を指定したときだけ、そのガジェットのどの口に挿すかを選べるようにする。
  // 未指定（自動）のままだと挿す先の口が決まらないため選択肢を出さない。
  const powerSourcePortOptions = useMemo(() => {
    const source = powerSourceId ? powerSourceCandidates.find((item) => item.id === powerSourceId) : undefined
    return source ? usbPowerPortSlots(source) : []
  }, [powerSourceId, powerSourceCandidates])

  // ═════════════════════════════════════════════════════════════
  // 保存済み gadget → フォームへの反映
  // ═════════════════════════════════════════════════════════════
  // 空欄や「その他」の初期値を一度表示してから保存値へ切り替えない。
  useLayoutEffect(() => {
    if (!gadget) return
    const p = gadget.ports
    setName(gadget.isPlaceholder ? '' : gadget.name)
    setRegisterAsOwned(!gadget.isCandidate && !gadget.isPlaceholder)
    setNickname(gadget.nickname ?? '')
    setPowerSourceId(gadget.powerSourceGadgetId ?? null)
    setPowerSourcePortId(gadget.powerSourcePortId ?? null)
    setCategory(gadget.category)
    setCustomCategory(customCategoryOf(gadget))
    setUrl(gadget.url ?? '')
    setProductId(gadget.productId)
    setPrice(fmtPriceInput(gadget.price))
    const usage = deskPlan ? getDeskGadgetUsage(deskPlan, gadget) : { introducedAt: gadget.purchasedAt, removedAt: gadget.removedAt }
    setPurchasedAt(formatStoredDate(usage.introducedAt, lang))
    setRemovedAt(formatStoredDate(usage.removedAt, lang))
    setUsagePeriods(deskPlan ? usagePeriodDrafts(deskUsagePeriods(usage, gadget), lang) : [])
    const fields = CATEGORY_PORT_CONFIG[gadget.category] ?? []
    setPortState(initPortState(p, fields))
    const detectedMouseConnType = gadget.category === 'Mouse' ? detectMouseConnType(p) : 'wireless'
    const detectedPeriConnType = detectPeriConnType(p)
    const receiverPort = p.find((port) =>
      port.type === 'USB_A' && port.direction === 'input' &&
      isReceiverPort(port),
    )
    setReceiverLabel(receiverPort?.label ?? '')
    setReceiverSupportsBluetooth(!!receiverPort && p.some((port) => port.type === 'Bluetooth'))
    if (gadget.category === 'Mouse') {
      setMouseConnType(detectedMouseConnType)
    }
    if (['Keyboard', 'Speaker', 'Headphone', 'Earphone', 'Controller'].includes(gadget.category)) {
      setPeriConnType(detectedPeriConnType)
    }
    if (NEEDS_HOST_CATEGORIES.includes(gadget.category)) {
      const pcConnectedKeyboardOrMouse =
        (gadget.category === 'Mouse' && detectedMouseConnType !== 'wireless') ||
        (gadget.category === 'Keyboard' && detectedPeriConnType !== 'wireless')
      const fallbackCategory = gadget.category === 'Controller'
        ? 'GameConsole'
        : gadget.category === 'Smartwatch'
          ? 'Smartphone'
          : gadget.category === 'Accessory'
            ? 'Tablet'
            : pcConnectedKeyboardOrMouse
              ? 'PC'
              : undefined
      setConnectedToId(
        bluetoothCandidateGadgets.find((g) => g.id === gadget.bluetoothTargetGadgetIds?.[0])?.id ??
        (fallbackCategory
          ? (bluetoothCandidateGadgets.find((g) => g.category === fallbackCategory)?.id ?? null)
          : null),
      )
    }
    if (gadget.category === 'Speaker') {
      setStereoPair(gadget.stereoPair ?? false)
      setSpeakerInputSide(gadget.speakerInputSide ?? 'R')
      setHasSubwoofer(gadget.hasSubwoofer ?? false)
    }
    if (gadget.category === 'Keyboard') {
      setSplitKeyboard(gadget.splitKeyboard ?? false)
    }
    // 専用フィールドは持たず、ポートに立った印から復元する
    setDirectAttach(isDirectAttachGadget(p))
    if (gadget.category === 'Charger') {
      const usbCPort = p.find((x) => x.type === 'USB_C' && x.direction === 'output')
      setChargeUsbC(usbCPort?.count ?? 0)
      setChargeUsbA(p.find((x) => x.type === 'USB_A' && x.direction === 'output')?.count ?? 0)
      const wirelessPorts = p.filter(isWirelessPowerPort)
      setChargeWirelessCount(wirelessPorts.reduce((n, x) => n + (x.count ?? 1), 0))
      setWirelessTargetIds(gadget.wirelessTargetGadgetIds ?? [])
    }
    if (gadget.category === 'PowerStrip') {
      const outPort = p.find((x) => x.type === 'Power' && x.direction === 'output')
      setStripOutlets(outPort?.count ?? 4)
      setStripUsbC(p.find((x) => x.type === 'USB_C' && x.direction === 'output')?.count ?? 0)
      setStripUsbA(p.find((x) => x.type === 'USB_A' && x.direction === 'output')?.count ?? 0)
      setStripGrounded(!!outPort && isGroundedPort(outPort))
    }
    if ((gadget.category === 'Desk' || gadget.category === 'Accessory') && gadget.dimensions) {
      const parts = gadget.dimensions.replace(' cm', '').split(' × ')
      setDeskWidth(parts[0] ?? '')
      setDeskDepth(parts[1] ?? '')
    }
    setIsHeightAdjustable(gadget.isHeightAdjustable ?? false)
    setIsElectricDesk(gadget.deskLiftType === 'electric')
    setDeskTopColor(gadget.deskTopColor)
    setDeskHeight(gadget.deskHeight ?? '')
    setDeskHeightMin(gadget.deskHeightMin ?? '')
    setDeskHeightMax(gadget.deskHeightMax ?? '')
    setDimensions(gadget.category === 'Other' ? (gadget.dimensions ?? '') : '')
    setMemo(gadget.memo ?? '')
    setQuantity(String(gadget.quantity ?? 1))
    setMountingType(gadget.mounting?.type ?? 'mounted_on')
    setMountingTargetId(gadget.mounting?.targetGadgetId ?? null)
    setMountingNote(gadget.mounting?.note ?? '')
    setOperationModes(gadget.operationModes?.join('\n') ?? '')
    setActiveOperationMode(gadget.activeOperationMode ?? '')
    setSoftwareSettings(gadget.softwareSettings ?? '')
    const placement = deskPlan?.placements.find((item) => item.gadgetId === gadget.id)
    setPlacementZone(placement?.zone ?? 'back_center')
    setPlacementLabel(placement?.label ?? '')
    setGames(gadget.games ?? [])
    setPcCpu(gadget.pcCpu ?? '')
    setPcCpuProductId(gadget.pcCpuProductId)
    setPcGpu(gadget.pcGpu ?? '')
    setPcGpuProductId(gadget.pcGpuProductId)
    setPcRam(gadget.pcRam ?? '')
    setPcRamProductId(gadget.pcRamProductId)
    setPcStorage(gadget.pcStorage ?? '')
    setPcStorageProductId(gadget.pcStorageProductId)
    setPcThunderbolt(gadget.pcThunderbolt ?? p.some((x) => x.type === 'Thunderbolt'))
    setPcFormFactor(gadget.pcFormFactor ?? 'desktop')
    setBatteryCapacityMah(gadget.batteryCapacityMah ?? '')
    setBatteryCapacityWh(gadget.batteryCapacityWh ?? '')
    setSupportsPassThroughCharging(gadget.supportsPassThroughCharging ?? false)
    setCableCount(gadget.cableCount ?? 1)
    setCableType(gadget.cableType ?? '')
    setConsoleFormFactor(gadget.consoleFormFactor ?? (p.some((x) => x.type === 'Power' && x.direction === 'input') ? 'stationary' : 'handheld'))
    setMonitorSizeInches(gadget.monitorSizeInches ?? '')
    setMonitorResolution(gadget.monitorResolution ?? '')
    setMonitorRefreshRateHz(gadget.monitorRefreshRateHz ?? '')
    setStorageCapacity(gadget.storageCapacity ?? '')
    setSmartDeviceScreenSize(gadget.smartDeviceScreenSize ?? '')
    setSmartDeviceStorage(gadget.smartDeviceStorage ?? '')
    const hasPcDetails = !!(gadget.pcCpu || gadget.pcGpu || gadget.pcRam || gadget.pcStorage)
    setPcShowDetails(hasPcDetails)
    if (gadget.category !== 'PowerStrip') {
      const poweredByWiredConnection =
        (gadget.category === 'Mouse' && detectedMouseConnType === 'wired') ||
        (gadget.category === 'Keyboard' && detectedPeriConnType === 'wired')
      setPowerInput(poweredByWiredConnection ? 'none' : gadget.category === 'SmartHome' && gadget.smartHomePowerSource !== 'standard'
        ? (gadget.smartHomePowerSource ?? detectPowerInput(gadget.category, gadget.ports))
        : detectPowerInput(gadget.category, gadget.ports))
    }
    setPowerUsage(gadget.powerUsage ?? defaultPowerUsageForCategory(gadget.category, gadget.consoleFormFactor ?? (p.some((x) => x.type === 'Power' && x.direction === 'input') ? 'stationary' : 'handheld')))
    setDisplayOnly(gadget.displayOnly ?? false)
    // 流し込んだ値を「変更なし」の基準として控え直す（下の useConfirmDiscard）
    setFormBaselineToken((n) => n + 1)
    // 入力欄への流し込みは「ガジェットが読めたとき」と「デスクが読めたとき」だけ。
    // gadget や deskPlan の参照を依存にすると、保存のたびに再初期化が走り、
    // 入力中の値が書き戻されて消える。deskPlan.gadgetUsage も同じで、デスクの別の機材が
    // 書き換わるたびに作り直される（外した枠の後始末が裏で走ると、入力中の全項目が戻っていた）。
    // 開いている間この機材の在籍期間を書くのはこの画面だけなので、入れ直す必要はない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gadget?.id, deskPlan?.id])

  // ═════════════════════════════════════════════════════════════
  // ハンドラ（カテゴリ変更 → 保存）
  // ═════════════════════════════════════════════════════════════
  const handleCategoryChange = useCallback((cat: GadgetCategory) => {
    setCategory(cat)
    // 商品名はカテゴリに依らないので残す。名前だけで登録した機材のカテゴリを直すと、
    // 以前はここで名前まで消え、確認の文言（ポート構成のリセット）にも出ていなかった
    suggestionPortsRef.current = undefined
    setProductId(undefined)
    suggestionSelectedRef.current = false
    setPortState(categoryDefaultPortState(cat))
    setMouseConnType('wireless')
    setPeriConnType('wireless')
    setReceiverLabel('')
    setReceiverSupportsBluetooth(false)
    setConnectedToId(
      cat === 'Controller'
        ? (bluetoothCandidateGadgets.find((g) => g.category === 'GameConsole')?.id ?? null)
        : cat === 'Smartwatch'
          ? (bluetoothCandidateGadgets.find((g) => g.category === 'Smartphone')?.id ?? null)
          : cat === 'Accessory'
            ? (bluetoothCandidateGadgets.find((g) => g.category === 'Tablet')?.id ?? null)
            : null,
    )
    setChargeUsbC(DEFAULT_CHARGER_USB_C); setChargeUsbA(DEFAULT_CHARGER_USB_A); setChargeWirelessCount(0); setWirelessTargetIds([])
    setBatteryCapacityMah(''); setBatteryCapacityWh(''); setSupportsPassThroughCharging(false)
    setStripOutlets(4); setStripUsbC(0); setStripUsbA(0); setStripGrounded(false)
    setDeskWidth(''); setDeskDepth(''); setDeskHeight(''); setDeskHeightMin(''); setDeskHeightMax(''); setIsHeightAdjustable(false); setIsElectricDesk(false)
    setPcCpu(''); setPcCpuProductId(undefined); setPcGpu(''); setPcGpuProductId(undefined); setPcRam(''); setPcRamProductId(undefined); setPcStorage(''); setPcStorageProductId(undefined); setPcThunderbolt(false); setPcFormFactor('desktop'); setPcShowDetails(false)
    setConsoleFormFactor('stationary'); setMonitorSizeInches(''); setMonitorResolution(''); setMonitorRefreshRateHz(''); setStorageCapacity('')
    setSmartDeviceScreenSize(''); setSmartDeviceStorage('')
    setPowerInput(defaultPowerInputForCategory(cat))
    setPowerUsage(defaultPowerUsageForCategory(cat))
    setStereoPair(cat === 'Speaker')
    setSpeakerInputSide('L')
    setCableType(''); setCableCount(1)
    setDirectAttach(false)
  }, [bluetoothCandidateGadgets])

  const requestCategoryChange = useCallback((cat: GadgetCategory, custom?: CustomCategory) => {
    if (saveInFlightRef.current || deleteInFlightRef.current || confirmationRef.current) return
    const applyChange = () => {
      handleCategoryChange(cat)
      setCustomCategory(custom)
      setShowCategoryModal(false)
    }
    // 「その他」と自作ジャンルの行き来は端子の既定が同じなので、名前と絵だけ差し替える
    if (cat === category) {
      setCustomCategory(custom)
      setShowCategoryModal(false)
      return
    }
    if (!hasConfiguredVisiblePorts(portState, CATEGORY_PORT_CONFIG[category] ?? [])) {
      applyChange()
      return
    }
    const ticket = {}
    confirmationRef.current = ticket
    showConfirmation({
      title: lang === 'en' ? 'Change category?' : 'ジャンルを変更しますか？',
      message: lang === 'en'
        ? 'Your configured ports will be reset.'
        : '設定済みのポート構成はリセットされます。',
      cancelLabel: lang === 'en' ? 'Cancel' : 'キャンセル',
      confirmLabel: lang === 'en' ? 'Change' : '変更する',
      destructive: true,
      onCancel: () => { if (confirmationRef.current === ticket) confirmationRef.current = null },
      onConfirm: () => {
        if (confirmationRef.current !== ticket) return
        confirmationRef.current = null
        if (!saveInFlightRef.current && !deleteInFlightRef.current && navigation.isFocused()) applyChange()
      },
    })
  }, [category, handleCategoryChange, lang, navigation, portState])

  const handleSuggestionSelect = (suggestion: ProductSuggestion, position?: number, selectionSource = 'picker') => {
    if (saveInFlightRef.current || deleteInFlightRef.current) return
    analytics.track(EVENTS.PRODUCT_SUGGESTION_SELECTED, {
      category,
      has_product_id: !!suggestion.productId,
      product_id: suggestion.productId,
      position,
      selection_source: selectionSource,
      placement: 'gadget_detail',
    })
    suggestionSelectedRef.current = true
    setName(suggestion.name)
    // 登録（utils/gadgetFromProduct.ts）と同じ推定。片方だけだと、登録時と編集時で保存内容がズレる
    const inferredPower = suggestion.ports ? inferPowerFromPorts(category, suggestion.ports) : null
    if (inferredPower) setPowerInput(inferredPower.powerInput)
    if (suggestion.powerUsage ?? inferredPower?.powerUsage) {
      setPowerUsage(suggestion.powerUsage ?? inferredPower!.powerUsage)
    }
    if (category === 'Desk' && suggestion.isHeightAdjustable) {
      setIsHeightAdjustable(true)
      setIsElectricDesk(suggestion.deskLiftType === 'electric')
      setPowerInput(suggestion.deskLiftType === 'electric' ? 'outlet' : 'none')
      setDeskHeightMin(suggestion.deskHeightMin ?? '')
      setDeskHeightMax(suggestion.deskHeightMax ?? '')
    }
    setBatteryCapacityMah(suggestion.batteryCapacityMah ?? '')
    setBatteryCapacityWh(suggestion.batteryCapacityWh ?? '')
    setSupportsPassThroughCharging(suggestion.supportsPassThroughCharging ?? false)
    // 商品DBの価格は取り込み時点のスナップショットで実売とズレるため、
    // 空欄のときだけ埋める。ユーザーが入れた金額は上書きしない
    if (suggestion.priceJpy != null && price.trim() === '') {
      setPrice(fmtPriceInput(suggestion.priceJpy))
      setPriceIsReference(true)
    }
    if (suggestion.pcFormFactor) {
      setPcFormFactor(suggestion.pcFormFactor)
      setPowerInput(defaultPowerInputForCategory('PC', suggestion.pcFormFactor))
    }
    // 追加画面と同じ扱い。片方だけだと、追加時と編集時で保存内容がズレる
    if (category === 'Cable' && !cableType) {
      const inferred = cableTypeFromName(suggestion.name)
      if (inferred) setCableType(inferred)
    }
    setProductId(suggestion.productId)
    suggestionPortsRef.current = suggestion.ports
    if (suggestion.ports) {
      setPortState(initPortState(suggestion.ports, CATEGORY_PORT_CONFIG[category] ?? []))
      const receiverPort = suggestion.ports.find((port) =>
        port.type === 'USB_A' && port.direction === 'input' &&
        isReceiverPort(port),
      )
      setReceiverLabel(receiverPort?.label ?? '')
      setReceiverSupportsBluetooth(!!receiverPort && suggestion.ports.some((port) => port.type === 'Bluetooth'))
      if (category === 'Mouse') setMouseConnType(detectMouseConnType(suggestion.ports))
      if (category === 'Keyboard') setPeriConnType(detectPeriConnType(suggestion.ports))
      if (category === 'PC') {
        setPcThunderbolt(suggestion.ports.some((p) => p.type === 'Thunderbolt'))
      }
      if (category === 'GameConsole') {
        const formFactor = suggestion.ports.some((p) => p.type === 'Power' && p.direction === 'input') ? 'stationary' : 'handheld'
        setConsoleFormFactor(formFactor)
        setPowerUsage(defaultPowerUsageForCategory('GameConsole', formFactor))
        setPowerInput(formFactor === 'handheld' ? 'none' : 'outlet')
      }
      if (category === 'Charger') {
        const charger = chargerFormStateFromPorts(suggestion.ports)
        setChargeUsbC(charger.usbC)
        setChargeUsbA(charger.usbA)
        setChargeWirelessCount(charger.wirelessCount)
        setPowerInput(charger.powerInput)
      }
      if (category === 'PowerStrip') {
        const outlet = suggestion.ports.find((port) => port.type === 'Power' && port.direction === 'output')
        setStripOutlets(outlet?.count ?? 4)
        setStripUsbC(suggestion.ports.find((port) => port.type === 'USB_C' && port.direction === 'output')?.count ?? 0)
        setStripUsbA(suggestion.ports.find((port) => port.type === 'USB_A' && port.direction === 'output')?.count ?? 0)
        setStripGrounded(!!outlet && isGroundedPort(outlet))
      }
    }
    // 欄を選んだまま候補だけ閉じると、次に onFocus が来ないので打ち直しても候補が出ない
    Keyboard.dismiss()
    setNameFocused(false)
  }

  // 保存せずに離れるときの確認。以前は確認が無く、スワイプで戻ると入力が黙って消えていた。
  // 入力欄が約60あるので項目を並べては比べない（並べると必ず漏れる）。保存用に組み立てた
  // ガジェットそのもの（＋在籍期間・置き場所）を、流し込んだ直後に控えた値と比べる
  const formSnapshotRef = useRef<(() => string) | null>(null)
  const formBaselineRef = useRef<string | null>(null)
  // 保存・削除のあとに自分で戻るときは確認しない
  const leavingOnPurposeRef = useRef(false)
  useEffect(() => {
    formBaselineRef.current = formSnapshotRef.current?.() ?? null
  }, [formBaselineToken])
  useConfirmDiscard(navigation, () => {
    // 保存中にネイティブの戻る・左端のスワイプで離れたときは、保存は続いて変更は残るので聞かない。
    // 聞くと、確認を出している間に保存が終わって画面が閉じ、確認だけが前の画面に残っていた
    if (saveInFlightRef.current) return false
    if (leavingOnPurposeRef.current || formBaselineRef.current === null || !formSnapshotRef.current) return false
    return formSnapshotRef.current() !== formBaselineRef.current
  }, lang)

  if (!gadget) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.card }]}>
        <Text style={[styles.notFound, { color: C.textMuted }]}>
          {lang === 'en' ? 'Gadget not found' : 'ガジェットが見つかりません'}
        </Text>
      </SafeAreaView>
    )
  }

  // 削除は30日間のゴミ箱へ移す。デスク履歴は復元のため残し、完全削除時だけ消す
  const runDelete = async () => {
    if (deleteInFlightRef.current || saveInFlightRef.current) return
    deleteInFlightRef.current = true
    setIsDeleting(true)
    // 消した時点でガジェットが無くなり、入力との比較が意味を失う。消し始めた時点で立てる
    leavingOnPurposeRef.current = true
    try {
      await deleteGadget(gadget)
      if (navigation.isFocused()) navigation.goBack()
    } catch {
      deleteInFlightRef.current = false
      leavingOnPurposeRef.current = false
      setIsDeleting(false)
      showMessage(
        lang === 'en' ? 'Could not delete' : '削除できませんでした',
        lang === 'en' ? 'Please try again.' : 'もう一度お試しください。',
      )
    }
  }

  const confirmDelete = () => {
    if (saveInFlightRef.current || deleteInFlightRef.current || confirmationRef.current) return
    const ticket = {}
    confirmationRef.current = ticket
    const displayName = localizedGadgetName(gadget, lang)
    showConfirmation({
      title: lang === 'en' ? 'Delete this gadget?' : 'このガジェットを削除しますか？',
      message: lang === 'en'
        ? `Move "${displayName}" to Recently Deleted? You can restore it with its desk history for 30 days.`
        : `「${displayName}」を「最近削除した項目」へ移します。30日以内ならデスクの履歴ごと復元できます。`,
      cancelLabel: t('common.cancel'),
      confirmLabel: t('common.delete'),
      destructive: true,
      onCancel: () => { if (confirmationRef.current === ticket) confirmationRef.current = null },
      onConfirm: () => {
        if (confirmationRef.current !== ticket) return
        confirmationRef.current = null
        if (navigation.isFocused()) void runDelete()
      },
    })
  }

  // 保存するガジェットを組み立てる。検証はしない（handleSave が先に済ませる）。
  // 「変更あり」の判定（formSnapshotRef）にも同じものを使うので、副作用を持たせないこと
  // 商品名が未設定の枠は、商品名を空のまま保存してよい（呼び名や端子だけ直したい場合がある）。
  // 以前は商品名が必須で、枠のままでは何も保存できなかった
  const keepsPlaceholder = () => !!gadget?.isPlaceholder && !trimAndTruncate(name, GADGET_NAME_MAX_LENGTH)

  const buildUpdatedGadget = (): Gadget => {
    const introducedAt = parseDateInput(purchasedAt, lang)
    const retiredAt = parseDateInput(removedAt, lang)
    const parsedPrice = parsePriceToJpy(price)
    const normalizedUrl = url.trim() ? (normalizeHttpUrl(url) ?? undefined) : undefined
    const parsedQuantity = Math.max(1, Math.min(999, Number.parseInt(quantity, 10) || 1))
    const ports = buildGadgetPorts({
      category,
      portState,
      mouseConnType,
      periConnType,
      receiverLabel,
      receiverSupportsBluetooth,
      powerInput,
      charge: { usbC: chargeUsbC, usbA: chargeUsbA, wirelessCount: chargeWirelessCount },
      strip:  { outlets: stripOutlets, usbC: stripUsbC, usbA: stripUsbA, grounded: stripGrounded },
      directAttach,
      previousPorts: suggestionPortsRef.current ?? gadget.ports,
    })
    const hasDeskDims = category === 'Desk' || category === 'Accessory'
    // 寸法は保存の境界で数値として整える。入力欄は打っている途中の「12.」を許すので、
    // そのままだと「.」や「0」が寸法として残る（normalizeDimensionInput の注記）。
    // 変更検知もこの関数の結果を読み込み直後の控えと比べるので、ここで整えても
    // 触っていないのに「変更あり」にはならない
    const deskWidthCm = normalizeDimensionInput(deskWidth)
    const deskDepthCm = normalizeDimensionInput(deskDepth)
    const deskDims = hasDeskDims && (deskWidthCm || deskDepthCm)
      ? [deskWidthCm, deskDepthCm].filter(Boolean).join(' × ') + ' cm'
      : undefined
    const heightRange = orderedRange(normalizeDimensionInput(deskHeightMin), normalizeDimensionInput(deskHeightMax))
    const keepPlaceholder = keepsPlaceholder()
    return {
      ...gadget,
      // 保存の境界でも切る。欄の上限は打った文字にしか効かず、予測変換・一覧から選んだ
      // 商品名（商品DBの名前は長いまま入っている）は素通りして入ってくる。
      // 商品名を入れずに保存した枠は、枠の名前（ジャンル名＋連番）のまま残す
      name: keepPlaceholder ? gadget.name : trimAndTruncate(name, GADGET_NAME_MAX_LENGTH),
      nickname: trimAndTruncate(nickname, GADGET_NICKNAME_MAX_LENGTH) || undefined,
      category,
      customCategory: category === 'Other' ? liveCustomCategory : undefined,
      quantity: parsedQuantity > 1 ? parsedQuantity : undefined,
      mounting: mountingTargetId && gadgets.some((item) => item.id === mountingTargetId && item.id !== gadget.id)
        ? { targetGadgetId: mountingTargetId, type: mountingType, note: tidyMultilineText(mountingNote) || undefined }
        : undefined,
      operationModes: parseOperationModes(operationModes),
      activeOperationMode: parseOperationModes(operationModes)?.includes(activeOperationMode) ? activeOperationMode : undefined,
      softwareSettings: tidyMultilineText(softwareSettings) || undefined,
      isPlaceholder: keepPlaceholder ? true : undefined,
      isCandidate: registerAsOwned && !keepPlaceholder ? undefined : true,
      stereoPair:    category === 'Speaker' ? stereoPair : undefined,
      speakerInputSide: category === 'Speaker' && stereoPair ? speakerInputSide : undefined,
      hasSubwoofer:  category === 'Speaker' && hasSubwoofer ? true : undefined,
      splitKeyboard: category === 'Keyboard' ? (splitKeyboard ? true : undefined) : undefined,
      // デスクでの飾りは期間の向きが持つ。期間が無い（導入日を入れていない）ときだけ本体の印で持つ
      displayOnly:   deskPlan && currentUsageMode(usagePeriods) ? gadget.displayOnly : (displayOnly ? true : undefined),
      ports,
      // 端子を直すか商品を選び直せば推定でなくなる。保存のたびに引き直して印を落とす
      portsNeedConfirmation: portsAreEstimated ? true : undefined,
      url: normalizedUrl,
      productId,
      memo: tidyMultilineText(memo) || undefined,
      dimensions: deskDims ?? (
        category === 'Other'
          ? (trimInvisible(dimensions) || undefined)
          : category === gadget.category
            ? gadget.dimensions
            : undefined
      ),
      isHeightAdjustable: category === 'Desk' ? isHeightAdjustable : undefined,
      deskLiftType: category === 'Desk' && isHeightAdjustable ? (isElectricDesk ? 'electric' : 'manual') : undefined,
      deskTopColor: category === 'Desk' ? deskTopColor : undefined,
      deskHeight:    hasDeskDims ? normalizeDimensionInput(deskHeight) : undefined,
      deskHeightMin: category === 'Desk' && isHeightAdjustable ? heightRange.min : undefined,
      deskHeightMax: category === 'Desk' && isHeightAdjustable ? heightRange.max : undefined,
      price: parsedPrice,
      // デスクを開いているときは plan.gadgetUsage が正なので本体の日付は触らない
      // （デスクAでの導入日を直したらデスクBの年表も動く、という混乱を避ける）
      purchasedAt: deskPlan ? gadget.purchasedAt : introducedAt,
      introducedAtUnknown: deskPlan
        ? (usagePeriods.some((period) => period.startedAt.trim()) ? undefined : true)
        : (introducedAt ? undefined : true),
      removedAt:   deskPlan ? gadget.removedAt : retiredAt,
      games: ['PC', 'Smartphone', 'Tablet', 'GameConsole'].includes(category) && games.length > 0 ? games : undefined,
      pcCpu:         category === 'PC' ? (trimInvisible(pcCpu) || undefined) : undefined,
      pcCpuProductId: category === 'PC' ? pcCpuProductId : undefined,
      pcGpu:         category === 'PC' ? (trimInvisible(pcGpu) || undefined) : undefined,
      pcGpuProductId: category === 'PC' ? pcGpuProductId : undefined,
      pcRam:         category === 'PC' ? (trimInvisible(pcRam) || undefined) : undefined,
      pcRamProductId: category === 'PC' ? pcRamProductId : undefined,
      pcStorage:     category === 'PC' ? (trimInvisible(pcStorage) || undefined) : undefined,
      pcStorageProductId: category === 'PC' ? pcStorageProductId : undefined,
      pcThunderbolt: category === 'PC' ? pcThunderbolt : undefined,
      pcFormFactor:  category === 'PC' ? pcFormFactor : undefined,
      consoleFormFactor: category === 'GameConsole' ? consoleFormFactor : undefined,
      monitorSizeInches: category === 'Monitor' ? (trimInvisible(monitorSizeInches) || undefined) : undefined,
      monitorResolution: category === 'Monitor' ? (trimInvisible(monitorResolution) || undefined) : undefined,
      monitorRefreshRateHz: category === 'Monitor' ? (trimInvisible(monitorRefreshRateHz) || undefined) : undefined,
      storageCapacity: category === 'Storage' ? (trimInvisible(storageCapacity) || undefined) : undefined,
      smartDeviceScreenSize: ['Smartphone', 'Tablet', 'Smartwatch'].includes(category) ? (trimInvisible(smartDeviceScreenSize) || undefined) : undefined,
      smartDeviceStorage: ['Smartphone', 'Tablet'].includes(category) ? (trimInvisible(smartDeviceStorage) || undefined) : undefined,
      batteryCapacityMah: category === 'MobileBattery' ? (trimInvisible(batteryCapacityMah) || undefined) : undefined,
      batteryCapacityWh: category === 'MobileBattery' ? (trimInvisible(batteryCapacityWh) || undefined) : undefined,
      supportsPassThroughCharging: category === 'MobileBattery' ? supportsPassThroughCharging : undefined,
      cableType: category === 'Cable' && cableType ? cableType : undefined,
      cableCount: category === 'Cable' ? cableCount : undefined,
      wirelessTargetGadgetIds: category === 'Charger' && wirelessTargetIds.length > 0 ? wirelessTargetIds : undefined,
      bluetoothTargetGadgetIds: NEEDS_HOST_CATEGORIES.includes(category) && connectedToId && bluetoothCandidateGadgets.some((g) => g.id === connectedToId) ? [connectedToId] : undefined,
      smartHomePowerSource: category === 'SmartHome'
        ? (powerInput === 'solar' ? 'solar' : powerInput === 'battery' ? 'battery' : 'standard')
        : undefined,
      powerSourceGadgetId: powerSourceId && powerSourceCandidates.some((g) => g.id === powerSourceId)
        ? powerSourceId
        : undefined,
      powerSourcePortId: powerSourcePortId && powerSourcePortOptions.some((slot) => slot.id === powerSourcePortId)
        ? powerSourcePortId
        : undefined,
      powerUsage: category === 'MobileBattery'
        ? 'rechargeable'
        : ['Smartphone', 'Tablet', 'Smartwatch'].includes(category)
        ? powerUsage
        : category === 'Accessory' && ports.some((port) =>
            (port.type === 'USB_C' || port.type === 'wirelessCharging') && port.direction === 'input',
          )
          ? 'rechargeable'
          : powerInput === 'none' ? undefined : powerUsage,
    }
  }
  formSnapshotRef.current = () => {
    // ポートの id は組み立てるたびに時刻から振り直される（buildGadgetPorts）。
    // 入れたまま比べると、何も触っていなくても毎回「変更あり」になる
    const { ports, customCategory: builtCustomCategory, ...rest } = buildUpdatedGadget()
    const portsWithoutIds = ports.map(({ id: _id, ...port }) => port)
    // 自作ジャンルは id で比べる。改名はその場で持ち物へ保存済みなので、名前の違いを「変更あり」にしない
    return JSON.stringify([rest, builtCustomCategory?.id, portsWithoutIds, usagePeriods, editedDeskUsage, placementZone, placementLabel])
  }

  const handleSave = async () => {
    if (saveInFlightRef.current || deleteInFlightRef.current || confirmationRef.current) return
    // 保存（trimAndTruncate）と同じ正規化で判定する。trim() だけで見ると、見えない文字だけの
    // 名前が「入力あり」を通り、保存時に空になって名前の無いガジェットができる
    if (!keepsPlaceholder() && !trimAndTruncate(name, GADGET_NAME_MAX_LENGTH)) {
      showMessage(t('gadgetDetail.nameRequired'))
      return
    }
    const introducedAt = parseDateInput(purchasedAt, lang)
    const retiredAt = parseDateInput(removedAt, lang)
    const parsedUsage = deskPlan ? parseUsagePeriodDrafts(usagePeriods, lang) : undefined
    if (parsedUsage?.error) {
      showMessage(lang === 'en' ? 'Check the usage history' : '利用履歴を確認してください', parsedUsage.error)
      return
    }
    // ライブラリから開いた場合は、デスクごとの在籍期間をこの画面で直せる。
    // 撤去したときに入るのは「操作した日」なので、実際に外した日と違うことがある
    const parsedDeskUsage: { planId: string; periods: DeskGadgetUsagePeriod[] }[] = []
    if (!deskPlan) {
      for (const [editedPlanId, drafts] of Object.entries(editedDeskUsage)) {
        const parsed = parseUsagePeriodDrafts(drafts, lang)
        if (parsed.error) {
          const deskName = plans.find((item) => item.id === editedPlanId)?.name
          showMessage(
            lang === 'en' ? 'Check the usage history' : '利用履歴を確認してください',
            deskName ? `${deskName}: ${parsed.error}` : parsed.error,
          )
          return
        }
        parsedDeskUsage.push({ planId: editedPlanId, periods: parsed.periods ?? [] })
      }
    }
    // 日付を直接入力できるのはデスクを開いていないときだけ（デスク側は
    // DeskUsageHistoryEditor が受け持ち、そちらは parseUsagePeriodDrafts が検証する）
    if (!deskPlan && ((purchasedAt.trim() && !introducedAt) || (removedAt.trim() && !retiredAt))) {
      showMessage(
        lang === 'en' ? 'Check the dates' : '日付を確認してください',
        lang === 'en' ? `Enter valid dates in ${dateFormatHint(lang)} format.` : `実在する日付を ${dateFormatHint(lang)} で入力してください。`,
      )
      return
    }
    if (!deskPlan && introducedAt && retiredAt && retiredAt < introducedAt) {
      showMessage(
        lang === 'en' ? 'Check the dates' : '日付を確認してください',
        lang === 'en' ? 'The removed date must be on or after the introduced date.' : '撤去日は導入日以降にしてください。',
      )
      return
    }
    const parsedPrice = parsePriceToJpy(price)
    if (price.trim() && parsedPrice == null) {
      showMessage(
        lang === 'en' ? 'Check the price' : '金額を確認してください',
        lang === 'en' ? 'Enter a number greater than or equal to 0.' : '0以上の数値を入力してください。',
      )
      return
    }
    const normalizedUrl = url.trim() ? (normalizeHttpUrl(url) ?? undefined) : undefined
    if (url.trim() && !normalizedUrl) {
      showMessage(
        lang === 'en' ? 'Check the URL' : 'URLを確認してください',
        lang === 'en' ? 'Enter a valid http:// or https:// URL.' : 'http:// または https:// のURLを入力してください。',
      )
      return
    }
    saveInFlightRef.current = true
    setIsSaving(true)
    const built = buildUpdatedGadget()
    // 新しく登録する機材は、導入日を入れなければ保存時の今日を導入日にする。
    // 下書きを日付またぎで編集した場合も、欄の今日表示と揃える。名前の無い枠と候補には当てない。
    // updateDeskGadgetSelection も日付の無い候補には期間を足さない。撤去日だけ入れたときも
    // 今日が撤去日より後になりうるので当てない
    const autoIntroducedAt = isDraft && !built.isPlaceholder && !built.isCandidate
      ? localDateKey()
      : undefined
    const autoDesk = !!autoIntroducedAt && !!deskPlan && (parsedUsage?.periods ?? []).length === 0
    const autoLibrary = !!autoIntroducedAt && !deskPlan && !introducedAt && !retiredAt
    const updated: Gadget = autoDesk || autoLibrary
      ? { ...built, purchasedAt: autoIntroducedAt, introducedAtUnknown: undefined }
      : built
    const deskPeriods: DeskGadgetUsagePeriod[] = autoDesk
      ? [{ mode: updated.displayOnly ? 'decor' : 'active', startedAt: autoIntroducedAt!, startedAtSource: 'auto' }]
      : (parsedUsage?.periods ?? [])
    const reflectionPlanId = planId && deskPlan ? planId : undefined
    if (reflectionPlanId) beginPlanReflection(reflectionPlanId)
    try {
      if (isDraft && !draftSavedRef.current) {
        await add(updated)
        draftSavedRef.current = true
      } else await update(updated)
      if (deskPlan) {
        // update() ではなく updateWith() を使う：WiringResultScreen は同じ PlanStack に
        // 積まれたまま裏に残ることがあり、その自動再計算effectが
        // ガジェットの変更（直前の update(updated)）で発火して同じplanへ非同期に
        // 保存する。ここで古い deskPlan スナップショットを丸ごと update() すると、
        // タイミング次第でどちらかの保存が後勝ちで消えてしまう（lost update）。
        await updatePlanWith(deskPlan.id, (prev) => {
          const periods = deskPeriods
          const withUsage = setDeskGadgetUsage(prev, gadget.id, { periods })
          const shouldBeCurrent = (isDraft && periods.length === 0) || hasCurrentDeskUsageAfterEdit(prev, gadget, periods)
          return {
            ...withUsage,
            selectedGadgetIds: shouldBeCurrent
              ? [...new Set([...prev.selectedGadgetIds, gadget.id])]
              : prev.selectedGadgetIds.filter((id) => id !== gadget.id),
            placements: [
              ...prev.placements.filter((placement) => placement.gadgetId !== gadget.id),
              { gadgetId: gadget.id, zone: placementZone, label: trimInvisible(placementLabel) || undefined },
            ],
            updatedAt: new Date().toISOString(),
          }
        })
      }
      // 終了日を空にすればそのデスクへ戻る。デスク側で編集したときと同じ判定にする
      for (const { planId: editedPlanId, periods } of parsedDeskUsage) {
        await updatePlanWith(editedPlanId, (prev) => {
          const withUsage = setDeskGadgetUsage(prev, gadget.id, { periods })
          const shouldBeCurrent = hasCurrentDeskUsageAfterEdit(prev, gadget, periods)
          return {
            ...withUsage,
            selectedGadgetIds: shouldBeCurrent
              ? [...new Set([...prev.selectedGadgetIds, gadget.id])]
              : prev.selectedGadgetIds.filter((id) => id !== gadget.id),
            updatedAt: new Date().toISOString(),
          }
        })
      }
      hapticSuccess()
      // 保存中に戻る操作で既に閉じていたら、もう一度戻ると前の画面まで閉じてしまう
      if (navigation.isFocused()) {
        leavingOnPurposeRef.current = true
        navigation.goBack()
      } else {
        formBaselineRef.current = formSnapshotRef.current?.() ?? null
      }
    } catch {
      hapticError()
      showMessage(
        lang === 'en' ? 'Could not save' : '保存できませんでした',
        lang === 'en' ? 'Please try again.' : 'もう一度お試しください。',
      )
    } finally {
      if (reflectionPlanId) endPlanReflection(reflectionPlanId)
      if (!leavingOnPurposeRef.current) {
        saveInFlightRef.current = false
        setIsSaving(false)
      }
    }
  }

  const portFields = CATEGORY_PORT_CONFIG[category] ?? []
  // 商品DBの端子でも手入力でもない、カテゴリ既定のままの推定値か。
  // 端子を1つでも直すか商品を選び直せば false になり、注意書きも保存する印も消える
  const portsAreEstimated = !suggestionPortsRef.current?.length && isCategoryDefaultPortState(category, portState)
  const showsPowerInput = !NO_POWER_INPUT_CATEGORIES.includes(category) &&
    !(category === 'Mouse' && mouseConnType === 'wired') &&
    !(category === 'Keyboard' && periConnType === 'wired')
  // 中身が1つも無いカテゴリ（椅子・ケーブル等）に空の見出しを出さない。下の JSX の出し分けと同じ条件
  const hasWiringFields = showsPowerInput ||
    DIRECT_ATTACH_CATEGORIES.includes(category) ||
    (['Charger', 'MobileBattery', 'PowerStrip', 'PC', 'GameConsole', 'Mouse', 'Keyboard', 'Speaker', 'Headphone', 'Earphone', 'Controller',
      'Smartphone', 'Tablet', 'Smartwatch', 'Accessory', 'PenTablet', 'HeadphoneAmp', 'CaptureDevice', 'Storage', 'Webcam',
      'Camera', 'SmallDevice', 'Microphone', 'Monitor', 'TV', 'Projector', 'AudioInterface', 'VRGlass'] as GadgetCategory[]).includes(category) ||
    portFields.some((f) => !f.hidden && !f.locked)
  const selectDefaultPcTarget = () => {
    setConnectedToId(bluetoothCandidateGadgets.find((g) => g.category === 'PC')?.id ?? null)
  }
  const catColor = categoryBaseColor(category, liveCustomCategory?.color, '#757575')
  // handleSave の自動の導入日と同じ条件（候補・名前の無い枠には当てない）
  const autoDateHint = isDraft && registerAsOwned && !keepsPlaceholder() ? (
    <Text style={[styles.fieldHint, { color: C.textMuted }]}>
      {lang === 'ja' ? '未入力なら登録した日が入ります' : 'If left empty, the date you add it is used.'}
    </Text>
  ) : null

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.container, { backgroundColor: C.card }]}>
      <CoachScope coach={coach}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerHeight}>
      <View ref={coachTarget('gadget-form')} collapsable={false} style={{ flex: 1 }}>
      <ScrollView ref={detailScrollRef} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled"
        pointerEvents={isSaving || isDeleting ? 'none' : 'auto'}
        accessibilityElementsHidden={isSaving || isDeleting}
        importantForAccessibility={isSaving || isDeleting ? 'no-hide-descendants' : 'auto'}>

        <CoachAnchor id="gadget-owned"><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontWeight: '600' }}>{lang === 'ja' ? '所有機材として登録' : 'Register as owned'}</Text>
            <Text style={[styles.formHint, { color: C.textMuted }]}>{lang === 'ja' ? '候補は所有数・購入総額に含めません。商品名を入力して所有機材にできます。' : 'Candidates are excluded from owned counts and purchase totals. Enter a product name to register as owned.'}</Text>
          </View>
          <ContrastToggle value={registerAsOwned} onValueChange={setRegisterAsOwned} colors={C} accessibilityLabel={lang === 'ja' ? '所有機材として登録' : 'Register as owned'} />
        </View></CoachAnchor>

        <Text style={[styles.formHint, { color: C.textMuted }]}>
          {lang === 'ja' ? '商品情報と接続方法を編集します。変更は画面下の「保存」で確定します。' : 'Edit product and connection details. Changes apply when you tap Save below.'}
        </Text>

        {/* ─── カテゴリ ─── */}
        <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Category' : 'ジャンル'}</Text>
        <CoachAnchor id="gadget-category"><TouchableOpacity
          style={[styles.categorySelectBtn, { borderColor: C.inputBorder, backgroundColor: C.input }]}
          onPress={() => setShowCategoryModal(true)}
          activeOpacity={0.7}
        >
          <View style={[styles.categorySelectIconWrap, { backgroundColor: catColor + '22' }]}>
            <CategoryIcon category={category} pcFormFactor={pcFormFactor} customIcon={liveCustomCategory?.icon} size={18} color={categoryIconColor(category, isDark, undefined, liveCustomCategory?.color)} />
          </View>
          <Text style={[styles.categorySelectLabel, { color: C.text }]}>
            {liveCustomCategory?.name ?? t('category.' + category)}
          </Text>
          <AppIcon name={ICONS.chevronDown} size={18} color={C.textMuted} />
        </TouchableOpacity></CoachAnchor>

        <Modal
          visible={showCategoryModal}
          transparent={false}
          animationType={reduceMotion ? 'fade' : 'slide'}
          onRequestClose={() => setShowCategoryModal(false)}
        >
          <View style={[styles.catModalFull, { backgroundColor: C.bg }]}>
            <View style={[styles.catModalHeader, { backgroundColor: C.card, paddingTop: insets.top + 14, borderBottomColor: C.border }]}>
              <Text style={[styles.catModalTitle, { color: C.text }]}>{lang === 'en' ? 'Select Category' : 'ジャンルを選択'}</Text>
              <TouchableOpacity onPress={() => setShowCategoryModal(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
                <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            <View style={{ backgroundColor: C.bg, flex: 1 }}>
            {showCategoryModal && (
              <CategorySectionPicker
                layout="grid"
                selected={customCategory ? undefined : category}
                selectedCustomId={customCategory?.id}
                onSelect={(cat) => requestCategoryChange(cat)}
                onSelectCustom={(custom) => requestCategoryChange('Other', custom)}
              />
            )}
            </View>
          </View>
        </Modal>

        {/* ─── 商品名 ─── */}
        <Text style={[styles.label, { color: C.textSub }]}>{t('gadgetDetail.name')}</Text>
        <CopyProductNameButton name={name} colors={C} lang={lang} />
        <CoachAnchor id="gadget-product"><View style={styles.autocompleteWrap}>
          <TextField
            suggestionsOpen={showSuggestions}
            value={name}
            onChangeText={(text) => {
              setName(truncateChars(text, GADGET_NAME_MAX_LENGTH))
              setProductId(undefined)
            }}
            maxLength={GADGET_NAME_MAX_LENGTH}
            placeholder={lang === 'en' ? 'Enter product name' : '商品名を入力'}
            autoCorrect
            onFocus={() => {
              if (nameBlurTimerRef.current !== null) clearTimeout(nameBlurTimerRef.current)
              nameBlurTimerRef.current = null
              setNameFocused(true)
            }}
            onBlur={() => {
              if (nameBlurTimerRef.current !== null) clearTimeout(nameBlurTimerRef.current)
              nameBlurTimerRef.current = setTimeout(() => {
                nameBlurTimerRef.current = null
                setNameFocused(false)
              }, 150)
            }}
            trailing={<ProductSearchButton onPress={() => setShowProductPicker(true)} />}
          />
          {showSuggestions && (
            <View style={[styles.suggestionBox, { backgroundColor: C.card, borderColor: C.inputBorder }]}>
              {suggestions.map((suggestion, index) => (
                <TouchableOpacity
                  key={`${suggestion.name}-${index}`}
                  style={[
                    styles.suggestionRow,
                    index < suggestions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.separator },
                  ]}
                  onPress={() => handleSuggestionSelect(suggestion, index, 'inline')}
                >
                  <Text style={[styles.suggestionName, { color: C.text }]}>{suggestion.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View></CoachAnchor>

        {/* 端子を推定で埋めたままのガジェットは、配線図が実物と違っていてもユーザーに
            それと分からない。共有した先には誤情報として伝わるので、ここで一度知らせる */}
        {portsAreEstimated && (
          <View style={[styles.estimateNotice, { backgroundColor: C.info + '14', borderColor: C.info + '40' }]}>
            <AppIcon name={ICONS.info} size={18} color={C.info} />
            <Text style={[styles.estimateNoticeText, { color: C.textSub }]}>
              {lang === 'en'
                ? 'Ports are placeholders for this category. Correct them under Wiring details if needed.'
                : '端子は一般的な構成の仮設定です。実物と違う場合は「配線の詳細」で直せます。'}
            </Text>
          </View>
        )}


        <ProductPickerModal
          visible={showProductPicker}
          category={category}
          onClose={() => setShowProductPicker(false)}
          onSelect={handleSuggestionSelect}
        />


        <CoachAnchor id="gadget-specs"><View>
        {category === 'PC' && (
          <>
            <PcSpecFields
              expanded={pcShowDetails}
              onExpanded={setPcShowDetails}
              thunderbolt={pcThunderbolt}
              onThunderbolt={setPcThunderbolt}
              cpu={pcCpu} cpuProductId={pcCpuProductId} onCpu={setPcCpu} onCpuProductId={setPcCpuProductId}
              gpu={pcGpu} gpuProductId={pcGpuProductId} onGpu={setPcGpu} onGpuProductId={setPcGpuProductId}
              ram={pcRam} ramProductId={pcRamProductId} onRam={setPcRam} onRamProductId={setPcRamProductId}
              storage={pcStorage} storageProductId={pcStorageProductId} onStorage={setPcStorage} onStorageProductId={setPcStorageProductId}
              colors={C}
              lang={lang}
            >
              {/* マウスの接続方式・ケーブルの種類と同じ折りたたみにする。畳んでも今の形は見出しの右に出る */}
              <AccordionField
                label={lang === 'en' ? 'Form factor' : 'PCタイプ'}
                value={PC_FORM_FACTOR_OPTIONS.find((option) => option.key === pcFormFactor)?.[lang === 'en' ? 'en' : 'ja']}
                colors={C}
              >
                <View style={styles.methodRow}>
                  {PC_FORM_FACTOR_OPTIONS.map((option) => {
                    const active = pcFormFactor === option.key
                    const label = lang === 'en' ? option.en : option.ja
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.methodChip, styles.pcFormFactorChip, { borderColor: active ? C.accentIcon : C.border }, active && { backgroundColor: C.accent + '18' }]}
                        onPress={() => {
                          setPcFormFactor(option.key)
                          setPowerInput(defaultPowerInputForCategory('PC', option.key))
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={label}
                      >
                        <CategoryIcon category="PC" pcFormFactor={option.key} size={18} color={active ? C.accentText : C.textSub} />
                        <Text style={[styles.methodChipText, { color: active ? C.accentText : C.textSub }]}>{label}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </View>
              </AccordionField>
            </PcSpecFields>
          </>
        )}

        {/* ─── デスク ─── */}
        {category === 'Desk' && (
          <>
            <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Dimensions' : '寸法'}</Text>
            <DeskDimensionFields
              width={deskWidth} depth={deskDepth} height={deskHeight}
              heightMin={deskHeightMin} heightMax={deskHeightMax}
              adjustable={isHeightAdjustable} electric={isElectricDesk}
              onWidth={setDeskWidth} onDepth={setDeskDepth} onHeight={setDeskHeight}
              onHeightMin={setDeskHeightMin} onHeightMax={setDeskHeightMax}
              onAdjustable={setIsHeightAdjustable} onElectric={setIsElectricDesk}
              onPowerInput={setPowerInput}
              colors={C}
              lang={lang}
              unitLabel={unitLabel}
            />
            <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Desktop color' : '天板の色'}</Text>
            <SelectField
              title={lang === 'en' ? 'Desktop color' : '天板の色'}
              options={[
                { key: '', label: lang === 'en' ? 'Not set' : '未設定' },
                ...DESK_TOP_COLOR_OPTIONS.map((option) => ({ key: option.key, label: option[lang] })),
              ]}
              value={deskTopColor ?? ''}
              onChange={(key) => setDeskTopColor(key || undefined)}
            />
          </>
        )}

        {/* ─── 小物・家具 ─── */}
        {category === 'Accessory' && (
          <>
            <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Dimensions (optional)' : '寸法（任意）'}</Text>
            <DeskDimensionFields
              width={deskWidth} depth={deskDepth} height={deskHeight}
              heightMin={deskHeightMin} heightMax={deskHeightMax}
              adjustable={false} electric={false}
              onWidth={setDeskWidth} onDepth={setDeskDepth} onHeight={setDeskHeight}
              onHeightMin={setDeskHeightMin} onHeightMax={setDeskHeightMax}
              onAdjustable={setIsHeightAdjustable} onElectric={setIsElectricDesk}
              onPowerInput={setPowerInput}
              colors={C}
              lang={lang}
              unitLabel={unitLabel}
              showAdjustable={false}
            />
          </>
        )}

        {/* ─── Other ─── */}
        {category === 'Other' && (
          <>
            <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Dimensions' : '寸法'}</Text>
            <TextField
              placeholder="e.g. 120 × 60 × 75 cm"
              value={dimensions}
              onChangeText={setDimensions}
            />
          </>
        )}

        {/* ─── Cable ─── */}
        {category === 'Cable' && (
          <>
            <AccordionField
              label={lang === 'en' ? 'Cable Type' : 'ケーブルの種類'}
              value={cableType ? cableLabel(cableType, lang) : undefined}
              colors={C}
              defaultOpen={!cableType}
            >
              <View style={[styles.methodRow, { flexWrap: 'wrap' }]}>
                {CABLE_TYPE_OPTIONS.map((value) => (
                  <TouchableOpacity
                    key={value}
                    style={[styles.methodChip, { borderColor: cableType === value ? C.accentIcon : C.border }, cableType === value && { backgroundColor: C.accent + '18' }]}
                    onPress={() => setCableType((current) => current === value ? '' : value)}
                  >
                    <Text style={[styles.methodChipText, { color: cableType === value ? C.accentText : C.textSub }]}>{cableLabel(value, lang)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </AccordionField>
            <PortStepperRow icon="numeric" label={lang === 'en' ? 'Count' : '本数'} value={cableCount} onChange={(value) => setCableCount(Math.max(1, value))} min={1} max={99} colors={C} />
          </>
        )}

        </View></CoachAnchor>
        {/* 配線図のための項目。商品を選べば端子は入るので、普段は畳んで画面を短くする */}
        {hasWiringFields && (
          <CoachAnchor id="gadget-wiring-toggle"><TouchableOpacity
            style={[styles.wiringToggle, { borderTopColor: C.separator }]}
            onPress={() => setWiringOpen((open) => !open)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: wiringOpen }}
          >
            <View style={styles.wiringToggleBody}>
              <Text style={[styles.wiringToggleTitle, { color: C.text }]}>{lang === 'en' ? 'Wiring details' : '配線の詳細'}</Text>
              <Text style={[styles.wiringToggleHint, { color: C.textMuted }]}>
                {lang === 'en' ? 'Ports, connections and power. Used for the wiring diagram.' : '端子・接続・給電。配線図に使います'}
              </Text>
            </View>
            <AppIcon name={wiringOpen ? ICONS.chevronUp : ICONS.chevronDown} size={20} color={C.textMuted} />
          </TouchableOpacity></CoachAnchor>
        )}
        {hasWiringFields && wiringOpen && (<CoachAnchor id="gadget-wiring-fields"><View>
        {/* ゲーム機タイプは給電の既定と消費電力を決めるだけなので、PCタイプと同じく奥に置く */}
        {category === 'GameConsole' && (
          <>
            {/* PCタイプと同じ折りたたみ。畳んでも今のタイプは見出しの右に出る */}
            <AccordionField
              label={lang === 'en' ? 'Console type' : 'ゲーム機タイプ'}
              value={CONSOLE_FORM_FACTOR_OPTIONS.find((option) => option.key === consoleFormFactor)?.[lang === 'en' ? 'en' : 'ja']}
              colors={C}
            >
              <View style={styles.methodRow}>
                {CONSOLE_FORM_FACTOR_OPTIONS.map((option) => {
                  const active = consoleFormFactor === option.key
                  const label = lang === 'en' ? option.en : option.ja
                  return (
                    <TouchableOpacity
                      key={option.key}
                      style={[styles.methodChip, styles.pcFormFactorChip, { borderColor: active ? C.accentIcon : C.border }, active && { backgroundColor: C.accent + '18' }]}
                      onPress={() => {
                        setConsoleFormFactor(option.key)
                        setPowerUsage(defaultPowerUsageForCategory('GameConsole', option.key))
                        setPowerInput(option.key === 'handheld' ? 'none' : 'outlet')
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={label}
                    >
                      <Text style={[styles.methodChipText, { color: active ? C.accentText : C.textSub }]}>{label}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </AccordionField>
          </>
        )}
        {/* ─── 充電器 ─── */}
        {category === 'Charger' && (
          <>
            <Text style={[styles.label, { color: C.textSub }]}>{t('addGadget.portConfig')}</Text>
            <PortStepperRow icon="usb-c-port" label="C"        value={chargeUsbC}          onChange={setChargeUsbC}          max={10} colors={C} />
            <PortStepperRow icon="usb-port"   label="A"        value={chargeUsbA}          onChange={setChargeUsbA}          max={10} colors={C} />
            <PortStepperRow icon="lightning-bolt-circle" label={lang === 'en' ? 'Wireless' : 'ワイヤレス'} value={chargeWirelessCount} onChange={setChargeWirelessCount} max={10} colors={C} />
            {chargeWirelessCount > 0 && (
              <>
                <Text style={[styles.label, { color: C.textSub }]}>
                  {lang === 'en' ? 'Chargeable gadget types' : 'ワイヤレス充電できるガジェット'}
                </Text>
                <WirelessGadgetPicker allGadgets={gadgets} value={wirelessTargetIds} onChange={setWirelessTargetIds} maxCount={chargeWirelessCount} colors={C} lang={lang} />
              </>
            )}
          </>
        )}

        {category === 'MobileBattery' && (
          <ToggleRow label={lang === 'en' ? 'Power devices while recharging' : '本体の充電中も他機器へ給電できる'} value={supportsPassThroughCharging} onChange={setSupportsPassThroughCharging} colors={C} />
        )}

        {/* ─── 電源タップ ─── */}
        {category === 'PowerStrip' && (
          <>
            <Text style={[styles.label, { color: C.textSub }]}>{t('addGadget.portConfig')}</Text>
            <PortStepperRow icon="power-plug" label={lang === 'en' ? 'Outlet' : 'コンセント'} color={portIconColor('Power', isDark)} value={stripOutlets} onChange={(v) => setStripOutlets(Math.max(1, v))} min={1} max={20} colors={C} />
            <PortStepperRow icon="usb-c-port" label="USB-C" color={portIconColor('USB_C', isDark)} value={stripUsbC} onChange={setStripUsbC} max={10} colors={C} />
            <PortStepperRow icon="usb-port"   label="USB-A" color={portIconColor('USB_A', isDark)} value={stripUsbA} onChange={setStripUsbA} max={10} colors={C} />
            <ToggleRow label={lang === 'en' ? 'Grounded (3-prong)' : 'アース付き（3極）'} value={stripGrounded} onChange={setStripGrounded} colors={C} />
          </>
        )}

        {category === 'PC' && (
          <PortConfigurationEditor
            fields={portFields}
            state={portState}
            onChange={(key, value) => setPortState((prev) => ({ ...prev, [key]: value }))}
            colors={C}
            lang={lang}
            title={t('gadgetDetail.portConfig')}
          />
        )}

        {/* ─── マウス ─── */}
        {category === 'Mouse' && (
          <>
            <AccordionField
              label={lang === 'en' ? 'Connection' : '接続方式'}
              value={mouseConnType === 'wired' ? (lang === 'en' ? 'Wired' : '有線') : mouseConnType === 'dongle' ? (lang === 'en' ? '2.4 GHz receiver' : '2.4GHz レシーバー') : (lang === 'en' ? 'Wireless' : '無線')}
              colors={C}
            >
              <View style={styles.methodRow}>
                {([
                  { key: 'wired',    label: lang === 'en' ? 'Wired' : '有線', icon: 'usb-port' },
                  { key: 'dongle',   label: lang === 'en' ? '2.4 GHz receiver' : '2.4GHz レシーバー', icon: 'access-point' },
                  { key: 'wireless', label: lang === 'en' ? 'Wireless' : '無線', icon: 'bluetooth' },
                ] as const).map(({ key, label, icon }) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.methodChip, { borderColor: mouseConnType === key ? C.accentIcon : C.border, gap: 6 }, mouseConnType === key && { backgroundColor: C.accent + '18' }]}
                    onPress={() => {
                      setMouseConnType(key)
                      setPowerInput(key === 'wired' ? 'none' : defaultPowerInputForCategory('Mouse'))
                      if (key === 'wired') selectDefaultPcTarget()
                    }}
                  >
                    <AppIcon name={icon} size={18} color={mouseConnType === key ? C.accentText : C.textSub} />
                    <Text style={[styles.methodChipText, { color: mouseConnType === key ? C.accentText : C.textSub }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </AccordionField>
            <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Connects To' : '接続先'}</Text>
            <ConnectTargetPicker allGadgets={bluetoothCandidateGadgets} excludeId={gadget.id} value={connectedToId} onChange={setConnectedToId} colors={C} lang={lang} />
          </>
        )}

        {(['Smartphone', 'Tablet', 'Smartwatch', 'Accessory', 'PenTablet', 'HeadphoneAmp',
          // 有線の USB 機器。PC が複数あるデスクでどちらにぶら下がるかを指定させる
          'CaptureDevice', 'Storage', 'Webcam', 'Camera', 'SmallDevice', 'Microphone',
          // ディスプレイは映像元の PC を指定させる
          'Monitor', 'TV', 'Projector',
          // 定数には入っていたのにピッカーが出ておらず、保存済みの値を編集できなかった
          'AudioInterface', 'VRGlass'] as const).includes(category as any) && (
          <>
            <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Connects To' : '接続先'}</Text>
            <ConnectTargetPicker allGadgets={bluetoothCandidateGadgets} excludeId={gadget.id} value={connectedToId} onChange={setConnectedToId} colors={C} lang={lang} />
          </>
        )}

        {/* ─── Keyboard/Speaker/Headphone/Controller ─── */}
        {(['Keyboard', 'Speaker', 'Headphone', 'Earphone', 'Controller'] as const).includes(category as any) && (
          <>
            <AccordionField
              label={lang === 'en' ? 'Connection' : '接続方式'}
              value={periConnType === 'wired' ? (lang === 'en' ? 'Wired' : '有線') : periConnType === 'dongle' ? (lang === 'en' ? '2.4 GHz receiver' : '2.4GHz レシーバー') : (lang === 'en' ? 'Wireless' : '無線')}
              colors={C}
            >
              <View style={styles.methodRow}>
                {([
                  { key: 'wired',    label: lang === 'en' ? 'Wired' : '有線', icon: 'usb-port' },
                  { key: 'dongle',   label: lang === 'en' ? '2.4 GHz receiver' : '2.4GHz レシーバー', icon: 'access-point' },
                  { key: 'wireless', label: lang === 'en' ? 'Wireless' : '無線', icon: 'bluetooth' },
                ] as const).map(({ key, label, icon }) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.methodChip, { borderColor: periConnType === key ? C.accentIcon : C.border, gap: 6 }, periConnType === key && { backgroundColor: C.accent + '18' }]}
                    onPress={() => {
                      setPeriConnType(key)
                      if (category === 'Keyboard' || category === 'Controller') {
                        setPowerInput(key === 'wired' ? 'none' : defaultPowerInputForCategory(category))
                      }
                      if (category === 'Keyboard' && key === 'wired') selectDefaultPcTarget()
                  }}
                >
                    <AppIcon name={icon} size={18} color={periConnType === key ? C.accentText : C.textSub} />
                    <Text style={[styles.methodChipText, { color: periConnType === key ? C.accentText : C.textSub }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </AccordionField>
            <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Connects To' : '接続先'}</Text>
            <ConnectTargetPicker allGadgets={bluetoothCandidateGadgets} excludeId={gadget.id} value={connectedToId} onChange={setConnectedToId} colors={C} lang={lang} />
            {category === 'Speaker' && (
              <>
                <ToggleRow
                  label={lang === 'en' ? '2-unit stereo pair (L/R)' : '2台セット（L/R）'}
                  value={stereoPair}
                  onChange={setStereoPair}
                  colors={C}
                />
                {stereoPair && (
                  <>
                    <AccordionField
                      label={lang === 'en' ? 'Input connection side' : '入力機器を接続する側'}
                      value={speakerInputSide}
                      colors={C}
                    >
                      <View style={styles.methodRow}>
                        {(['L', 'R'] as const).map((side) => {
                          const active = speakerInputSide === side
                          return (
                            <TouchableOpacity
                              key={side}
                              style={[styles.methodChip, { borderColor: active ? C.accentIcon : C.border }, active && { backgroundColor: C.accent + '18' }]}
                              onPress={() => setSpeakerInputSide(side)}
                            >
                              <Text style={[styles.methodChipText, { color: active ? C.accentText : C.textSub }]}>{side}</Text>
                            </TouchableOpacity>
                          )
                        })}
                      </View>
                    </AccordionField>
                  </>
                )}
                <ToggleRow
                  label={lang === 'en' ? 'Includes a subwoofer' : 'ウーファーあり'}
                  value={hasSubwoofer}
                  onChange={setHasSubwoofer}
                  colors={C}
                />
              </>
            )}
            {category === 'Keyboard' && (
              <ToggleRow
                label={lang === 'en' ? 'Split keyboard (L/R)' : '左右分割キーボード（L/R）'}
                value={splitKeyboard}
                onChange={setSplitKeyboard}
                colors={C}
              />
            )}
            {category !== 'Keyboard' && portFields.filter(f => !f.hidden && !f.locked).length > 0 && (
              <PortConfigurationEditor
                fields={portFields}
                state={portState}
                onChange={(key, value) => setPortState((prev) => ({ ...prev, [key]: value }))}
                colors={C}
                lang={lang}
                title={t('gadgetDetail.portConfig')}
              />
            )}
          </>
        )}

        {/* ─── 汎用ポート構成 ─── */}
        {!(['Mouse','Charger','PowerStrip','Cable','PC','Keyboard','Speaker','Headphone','Earphone','Controller'] as const).includes(category as any) && portFields.some(f => !f.hidden && !f.locked) && (
          <PortConfigurationEditor
            fields={portFields}
            state={portState}
            onChange={(key, value) => setPortState((prev) => ({ ...prev, [key]: value }))}
            colors={C}
            lang={lang}
            title={t('gadgetDetail.portConfig')}
          />
        )}

        {/* 本体を直接挿すガジェット（USBメモリ・HDMIスティック等）。必要ケーブルから外す */}
        {DIRECT_ATTACH_CATEGORIES.includes(category) && (
          <ToggleRow
            label={lang === 'en' ? 'Plugs in directly (no cable)' : '本体を直接挿す（ケーブル不要）'}
            value={directAttach}
            onChange={setDirectAttach}
            colors={C}
          />
        )}

        {/* ─── 給電方法 ─── */}
        {showsPowerInput && (
          <>
            <PowerInputFields
              category={category}
              powerInput={powerInput}
              onPowerInput={setPowerInput}
              powerUsage={powerUsage}
              onPowerUsage={setPowerUsage}
              colors={C}
              lang={lang}
            >
              {/* どの充電器から給電するか。未指定なら配線エンジンが空いている供給元を選ぶ */}
            {(['from_a', 'from_c', 'wireless'] as const).includes(powerInput as any) && powerSourceCandidates.length > 0 && (
              <>
                <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Charged By' : '充電元'}</Text>
                <ConnectTargetPicker
                  allGadgets={powerSourceCandidates}
                  excludeId={gadget.id}
                  value={powerSourceId}
                  onChange={(id) => { setPowerSourceId(id); setPowerSourcePortId(null) }}
                  colors={C}
                  lang={lang}
                />
              </>
            )}
            {/* どの口に挿すか。同じ口を選んだガジェットどうしは、その口を挿し替えて使い回す */}
            {(['from_a', 'from_c'] as const).includes(powerInput as any) && powerSourcePortOptions.length > 0 && (
              <AccordionField
                label={lang === 'en' ? 'Charging Port' : '挿す口'}
                value={powerSourcePortId === null
                  ? (lang === 'en' ? 'Auto' : '自動')
                  : powerSourcePortOptions.find(({ id }) => id === powerSourcePortId)?.label}
                colors={C}
              >
                <View style={styles.powerMethodGrid}>
                  {[{ id: null as string | null, label: lang === 'en' ? 'Auto' : '自動' }, ...powerSourcePortOptions]
                    .map(({ id, label }) => {
                      const active = powerSourcePortId === id
                      return (
                        <TouchableOpacity
                          key={id ?? 'auto'}
                          style={[styles.methodChip, styles.powerMethodChip, { borderColor: active ? C.accentIcon : C.border }]}
                          onPress={() => setPowerSourcePortId(id)}
                        >
                          <Text
                            style={[styles.methodChipText, styles.powerMethodChipText, { color: active ? C.accentText : C.textMuted }]}
                            numberOfLines={2}
                          >
                            {label}
                          </Text>
                        </TouchableOpacity>
                      )
                    })}
                </View>
                <Text style={[styles.powerPreview, { color: C.textMuted }]}>
                  {lang === 'en'
                    ? 'Gadgets sharing a port take turns using it while charging.'
                    : '同じ口を選んだガジェットは、充電のたびに挿し替えて使い回します'}
                </Text>
              </AccordionField>
            )}
            </PowerInputFields>
          </>
        )}
        </View></CoachAnchor>)}


        {/* ─── 価格 ─── */}

        {/* 台数が2以上なら欄の名前で1台あたりと言う。補足が台数の欄にしか無いと、
            合計額を入れて2倍に計上される */}
        <Text style={[styles.label, { color: C.textSub }]}>
          {(Number.parseInt(quantity, 10) || 1) > 1
            ? (lang === 'ja' ? '1台あたりの購入金額（円）' : 'Price per Unit ($)')
            : t('gadgetDetail.price')}
        </Text>
        <CoachAnchor id="gadget-price"><View><TextField
            leading={<Text style={[styles.currencyPrefix, { color: C.textSub }]}>{lang === 'en' ? '$' : '¥'}</Text>}
            placeholder={t('gadgetDetail.pricePlaceholder')}
            value={price}
            onChangeText={(v) => {
              setPrice(sanitizeNumericInput(v))
              setPriceIsReference(false)
            }}
            keyboardType={lang === 'en' ? 'decimal-pad' : 'numeric'}
            autoCorrect={false}
        /></View></CoachAnchor>
        {priceIsReference && (
          <Text style={[styles.fieldHint, { color: C.textSub }]}>
            {lang === 'ja'
              ? '商品の参考価格を入れました。実際に払った金額に直せます'
              : 'Filled in with the listed price. Change it to what you actually paid.'}
          </Text>
        )}

        {/* ─── デスクでの利用期間 ─── */}
        {/* デスクを開いていなくても導入日は編集できる。ここを planId で閉じていたため、
            マイガジェットから開くと導入日を入れる場所がどこにも無く、統計の
            成長グラフ・年表が永久に空のままになっていた */}
        <CoachAnchor id="gadget-usage"><View onLayout={(event) => {
          if (!route.params.focusUsage || usageFocusedRef.current) return
          usageFocusedRef.current = true
          detailScrollRef.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - 12), animated: false })
        }}>
        {deskPlan ? (
          <>
          <DeskUsageHistoryEditor value={usagePeriods} onChange={setUsagePeriods} colors={C} lang={lang} />
          {autoDateHint}
          </>
        ) : <>
        <Text style={[styles.label, { color: C.textSub }]}>{isFutureDate ? (lang === 'en' ? 'Planned Start Date' : '導入予定日') : (lang === 'en' ? 'Added' : '導入日')}</Text>
        <DateField
          value={purchasedAt}
          onChange={setPurchasedAt}
          label={isFutureDate ? (lang === 'en' ? 'Planned start date' : '導入予定日') : (lang === 'en' ? 'Date added' : '導入日')}
          maximumDate={maxGadgetDate}
        />
        {autoDateHint}

        {/* ─── 撤去日（歴史アニメーションの OUT イベント） ─── */}
        {/* デスクに置いている機材は、下のデスクごとの在籍履歴の終了日が撤去を表す。
            こちらも出すと入れ場所が2つになり、ここを直しても年表は動かない */}
        {relatedPlanUsages.length === 0 && (<>
        <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Removed Date (optional)' : '撤去日（任意）'}</Text>
        <DateField
          value={removedAt}
          onChange={setRemovedAt}
          label={lang === 'en' ? 'Removed date' : '撤去日'}
          maximumDate={maxGadgetDate}
        />
        </>)}
        </>}

        {!deskPlan && relatedPlanUsages.length > 0 && (
          <>
            <Text style={[styles.label, { color: C.textSub }]}>
              {lang === 'en' ? 'Desk history' : 'デスクごとの在籍履歴'}
            </Text>
            <Text style={[styles.planUsageHint, { color: C.textMuted }]}>
              {lang === 'en'
                ? "Retiring uses today's date. Correct it here if needed. Clear the end date to restore it to the desk."
                : '撤去日は操作した日になります。違う場合は直してください。終了日を消すとデスクへ戻ります。'}
            </Text>
            <View style={[styles.planUsageCard, { backgroundColor: C.input, borderColor: C.inputBorder }]}>
              {relatedPlanUsages.map(({ plan: relatedPlan, usage }, index) => {
                const periods = deskUsagePeriods(usage, gadget)
                const currentMode = usageModeAt(periods)
                return (
                  <View
                    key={relatedPlan.id}
                    style={[styles.planUsageRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator }]}
                  >
                    <View style={styles.planUsageHeader}>
                      <Text style={[styles.planUsageName, { color: C.text }]} numberOfLines={1}>{relatedPlan.name}</Text>
                      {currentMode && (
                        /* 面は '18'。これより濃いと中の accentText が AA を割る */
                        <View style={[styles.planUsageActiveBadge, { backgroundColor: C.accent + '18' }]}>
                          <Text style={[styles.planUsageActiveText, { color: C.accentText }]}>
                            {currentMode === 'decor' ? (lang === 'en' ? 'Decor' : '飾り') : (lang === 'en' ? 'Active' : '使用中')}
                          </Text>
                        </View>
                      )}
                    </View>
                    <DeskUsageHistoryEditor
                      value={editedDeskUsage[relatedPlan.id] ?? usagePeriodDrafts(periods, lang)}
                      onChange={(next) => setEditedDeskUsage((prev) => ({ ...prev, [relatedPlan.id]: next }))}
                      colors={C}
                      lang={lang}
                      showHeading={false}
                    />
                  </View>
                )
              })}
            </View>
          </>
        )}
        </View></CoachAnchor>

        {/* デスクから開いたときは、このデスクでの今の期間の向きを切り替える（上の期間の欄と同じ値）。
            期間はあるのに今のものが無い＝このデスクから外した機材なので出さない */}
        <CoachAnchor id="gadget-display-only"><View>{deskPlan ? (() => {
          const currentMode = currentUsageMode(usagePeriods)
          if (!currentMode && usagePeriods.length > 0) return null
          return (
            <DisplayOnlySwitch
              value={currentMode ? currentMode === 'decor' : displayOnly}
              onChange={(decor) => {
                if (currentMode) setUsagePeriods((prev) => withCurrentUsageMode(prev, decor ? 'decor' : 'active', lang))
                else setDisplayOnly(decor)
              }}
              colors={C}
              lang={lang}
            />
          )
        })() : <DisplayOnlySwitch value={displayOnly} onChange={setDisplayOnly} colors={C} lang={lang} />}</View></CoachAnchor>

        {/* ─── メモ ─── */}
        <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Notes' : 'メモ'}</Text>
        <CoachAnchor id="gadget-notes"><View><TextInput
          style={[styles.input, styles.memoInput, { backgroundColor: C.input, borderColor: C.inputBorder, color: C.text }]}
          placeholder={lang === 'en' ? 'e.g. USB-C for work, HDMI for gaming.' : '例：仕事はUSB-C、ゲームはHDMIで接続。'}
          accessibilityLabel={lang === 'en' ? 'Gadget notes' : '機材のメモ'}
          placeholderTextColor={C.textMuted}
          value={memo}
          onChangeText={(text) => setMemo(truncateChars(text, GADGET_MEMO_MAX_LENGTH))}
          multiline
          numberOfLines={3}
          maxLength={inputMaxLength(memo, GADGET_MEMO_MAX_LENGTH)}
          textAlignVertical="top"
          onFocus={() => setTimeout(() => detailScrollRef.current?.scrollToEnd({ animated: true }), 150)}
        />
        {/* 公開デスクのガジェット詳細にそのまま出る欄なので、書く前に知らせる */}
        <Text style={[styles.fieldHint, { color: C.textMuted }]}>
          {lang === 'ja' ? 'デスクを公開すると、このメモも公開ページに表示されます' : 'If you publish this desk, these notes appear on the public page.'}
        </Text></View></CoachAnchor>

        {/* 削除は固定した保存ボタンと離し、スクロール領域のいちばん奥に置く */}
        {!isDraft && <><CoachAnchor id="gadget-delete"><TouchableOpacity
          style={styles.deleteRow}
          onPress={confirmDelete}
          disabled={isSaving || isDeleting}
          activeOpacity={0.7}
          accessibilityRole="button"
        >
          <AppIcon name={ICONS.trash} size={17} color={statusTextColor('danger', isDark)} />
          <Text style={[styles.deleteRowText, { color: statusTextColor('danger', isDark) }]}>
            {isDeleting
              ? (lang === 'en' ? 'Deleting…' : '削除中…')
              : (lang === 'en' ? 'Delete this gadget' : 'このガジェットを削除')}
          </Text>
        </TouchableOpacity></CoachAnchor>
        <Text style={[styles.deleteRowHint, { color: C.textMuted }]}>
          {lang === 'en'
            ? 'Deletes it and its desk history. If you only stopped using it, retire it from the list instead.'
            : '機材一覧と在籍履歴から削除します。使わなくなっただけなら、一覧で「撤去」してください。'}
        </Text></>}
      </ScrollView>
      </View>
      <CoachAnchor id="gadget-save"><View style={[styles.saveBar, { backgroundColor: C.card, borderTopColor: C.border }]}>
        <Button
          title={isSaving ? (lang === 'en' ? 'Saving…' : '保存中…') : t('gadgetDetail.save')}
          onPress={handleSave}
          loading={isSaving}
          disabled={isSaving || isDeleting}
          style={styles.saveBtn}
        />
      </View></CoachAnchor>
      </KeyboardAvoidingView>
      </CoachScope>
      {coach.overlay}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: { padding: UI_METRICS.formGutter, paddingTop: 8, paddingBottom: UI_METRICS.formGutter },
  wiringToggle: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  wiringToggleBody: { flex: 1, gap: 2 },
  wiringToggleTitle: { fontSize: 15, fontWeight: '600' },
  wiringToggleHint: { fontSize: 12, lineHeight: 17 },
  estimateNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: UI_METRICS.panelRadius, padding: 12, marginTop: 16 },
  estimateNoticeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  formHint: { fontSize: 12, lineHeight: 18, marginBottom: 2 },
  notFound: { textAlign: 'center', marginTop: 80 },

  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2, marginTop: 16, marginBottom: 8 },
  input: {
    minHeight: UI_METRICS.inputHeight,
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    padding: 12,
    fontSize: 15,
  },
  autocompleteWrap: {},
  // 下角は入力欄（controlRadius）と同じにする。ここだけ小さいと、
  // 入力欄にぶら下がっているのに輪郭が途中でずれる
  suggestionBox: { borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: UI_METRICS.controlRadius, borderBottomRightRadius: UI_METRICS.controlRadius, overflow: 'hidden' },
  suggestionRow: { paddingHorizontal: 14, paddingVertical: 11 },
  suggestionName: { fontSize: 14, fontWeight: '500' },
  currencyPrefix: { fontSize: 16, fontWeight: '500', marginRight: 4 },

  methodRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  methodChip: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: UI_METRICS.controlRadius,
    borderWidth: 1,
    alignItems: 'center',
    minWidth: 72,
  },
  powerMethodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  powerMethodChip: { flexBasis: '31%', flexGrow: 1, maxWidth: '31.8%', height: 78, justifyContent: 'center' },
  powerMethodChipText: { textAlign: 'center', lineHeight: 14 },
  powerPreview: { fontSize: 11, marginTop: 8, lineHeight: 15 },
  methodChipText: { fontSize: 11, fontWeight: '500' },
  // 3つを同じ幅に並べる。名前の長さで札の幅が揃わないと、選べる数が一目で読めない
  pcFormFactorChip: { flex: 1, gap: 6 },
  fieldHint: { fontSize: 11, lineHeight: 16, marginTop: 6 },

  planUsageCard: { borderWidth: 1, borderRadius: UI_METRICS.controlRadius, overflow: 'hidden' },
  planUsageRow: { paddingHorizontal: 12, paddingVertical: 11, gap: 8 },
  planUsageHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planUsageName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' },
  planUsageActiveBadge: { borderRadius: UI_METRICS.controlRadius, paddingHorizontal: 8, paddingVertical: 3 },
  planUsageActiveText: { fontSize: 10, fontWeight: '700' },
  planUsageHint: { fontSize: 11, lineHeight: 16, marginTop: -4, marginBottom: 8 },

  // 伸びる上限。付けないと、書いた行数ぶん欄が伸びて保存ボタンが画面の外へ出る
  memoInput: { minHeight: 80, maxHeight: 160, paddingTop: 12 },
  saveBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: UI_METRICS.formGutter,
    paddingTop: 10,
    paddingBottom: 10,
  },
  saveBtn: { marginTop: 0 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 28, paddingVertical: 10 },
  deleteRowText: { fontSize: 15, fontWeight: '600' },
  deleteRowHint: { fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 8 },

  categorySelectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  categorySelectIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categorySelectLabel: {
    flex: 1,
    fontSize: 15,
  },
  catModalFull: { flex: 1 },
  catModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catModalTitle: { fontSize: 17, fontWeight: '700' },

})
