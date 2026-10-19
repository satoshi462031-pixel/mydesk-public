import { CustomCategory, Gadget, GadgetCategory, Port } from '../types'
import {
  CATEGORY_PORT_CONFIG,
  NEEDS_HOST_CATEGORIES,
  categoryDefaultPortState,
  initPortState,
  isCategoryDefaultPortState,
} from '../constants/portFormConfig'
import {
  buildGadgetPorts,
  chargerFormStateFromPorts,
  defaultPowerInputForCategory,
  defaultPowerUsageForCategory,
  inferPowerFromPorts,
  DEFAULT_CHARGER_USB_A,
  DEFAULT_CHARGER_USB_C,
  MouseConnType,
  PowerInput,
  PowerUsage,
} from './gadgetPorts'
import { isGroundedPort, isReceiverPort } from './portRoles'
import { cableTypeFromName } from './cableTypeFromName'
import { normalizeDimensionInput, orderedRange } from './numericInput'
import { ProductSuggestion } from './productSuggestions'
import { GADGET_NAME_MAX_LENGTH } from '../constants/textLimits'
import { trimAndTruncate } from './truncateText'

// ─── 商品を選んだだけで登録する ─────────────────────────────────
//
// 登録画面は「商品を選ぶ → その場で登録」にした。端子・給電・寸法などは
// 選んだ商品から決まるぶんだけ入れ、残りはあとから詳細画面で直す。
// 以前の入力フォームが商品を選んだときに入れていた値と同じになるよう、
// フォームの既定値 → 商品から読める値 → buildGadgetPorts の順で組む。

export interface GadgetFromProductInput {
  id: string
  name: string
  category: GadgetCategory
  customCategory?: CustomCategory
  /** 商品一覧・予測変換から選んだ候補。名前だけで登録するときは無い */
  suggestion?: ProductSuggestion
  /** 追加先のデスクにある機材。コントローラー等の無線の相手を既定で決める */
  deskGadgets?: Gadget[]
  /** ユーザーが登録時に選んだ導入日。未選択なら未設定 */
  purchasedAt?: string
  now: string
}

// USB-A の入力かつレシーバー、まで見る。共有の判定はラベルだけを見るので合成する
const isReceiverInputPort = (port: Port) =>
  port.type === 'USB_A' && port.direction === 'input' && isReceiverPort(port)

/** 無線でつなぐ相手の既定。以前のフォームがカテゴリを選んだ時点で入れていたもの */
function defaultHostId(category: GadgetCategory, deskGadgets: Gadget[]): string | undefined {
  const host = category === 'Controller' ? 'GameConsole'
    : category === 'Smartwatch' ? 'Smartphone'
    : category === 'Accessory' ? 'Tablet'
    : null
  return host ? deskGadgets.find((g) => g.category === host)?.id : undefined
}

export function gadgetFromProduct(input: GadgetFromProductInput): Gadget {
  const { category, suggestion: s } = input
  const name = trimAndTruncate(input.name, GADGET_NAME_MAX_LENGTH)
  const productPorts = s?.ports

  let powerInput: PowerInput = defaultPowerInputForCategory(category)
  let powerUsage: PowerUsage = defaultPowerUsageForCategory(category)
  let mouseConnType: MouseConnType = 'wireless'
  let periConnType: MouseConnType = 'wireless'
  let receiverLabel = ''
  let receiverSupportsBluetooth = false
  const charge = { usbC: DEFAULT_CHARGER_USB_C, usbA: DEFAULT_CHARGER_USB_A, wirelessCount: 0 }
  const strip = { outlets: 4, usbC: 0, usbA: 0, grounded: false }
  let consoleFormFactor: Gadget['consoleFormFactor'] = 'stationary'
  const pcFormFactor: NonNullable<Gadget['pcFormFactor']> = s?.pcFormFactor ?? 'desktop'
  const isElectricDesk = category === 'Desk' && s?.isHeightAdjustable === true && s.deskLiftType === 'electric'

  const inferred = productPorts ? inferPowerFromPorts(category, productPorts) : null
  if (inferred) powerInput = inferred.powerInput
  if (s?.powerUsage ?? inferred?.powerUsage) powerUsage = s?.powerUsage ?? inferred!.powerUsage
  if (category === 'Desk' && s?.isHeightAdjustable) powerInput = isElectricDesk ? 'outlet' : 'none'
  if (s?.pcFormFactor) powerInput = defaultPowerInputForCategory('PC', s.pcFormFactor)

  if (productPorts) {
    const receiverPort = productPorts.find(isReceiverInputPort)
    const hasBluetooth = productPorts.some((port) => port.type === 'Bluetooth')
    receiverLabel = receiverPort?.label ?? ''
    receiverSupportsBluetooth = !!receiverPort && hasBluetooth
    const connType: MouseConnType = receiverPort ? 'dongle' : hasBluetooth ? 'wireless' : 'wired'
    if (category === 'Mouse') mouseConnType = connType
    if (category === 'Keyboard') periConnType = connType
    if (category === 'GameConsole') {
      consoleFormFactor = productPorts.some((p) => p.type === 'Power' && p.direction === 'input') ? 'stationary' : 'handheld'
      powerUsage = defaultPowerUsageForCategory('GameConsole', consoleFormFactor)
      powerInput = consoleFormFactor === 'handheld' ? 'none' : 'outlet'
    }
    if (category === 'Charger') {
      const charger = chargerFormStateFromPorts(productPorts)
      charge.usbC = charger.usbC
      charge.usbA = charger.usbA
      charge.wirelessCount = charger.wirelessCount
      powerInput = charger.powerInput
    }
    if (category === 'PowerStrip') {
      const outlet = productPorts.find((port) => port.type === 'Power' && port.direction === 'output')
      strip.outlets = outlet?.count ?? 4
      strip.usbC = productPorts.find((port) => port.type === 'USB_C' && port.direction === 'output')?.count ?? 0
      strip.usbA = productPorts.find((port) => port.type === 'USB_A' && port.direction === 'output')?.count ?? 0
      strip.grounded = !!outlet && isGroundedPort(outlet)
    }
  }

  const portState = productPorts
    ? initPortState(productPorts, CATEGORY_PORT_CONFIG[category] ?? [])
    : categoryDefaultPortState(category)
  const ports = buildGadgetPorts({
    category,
    portState,
    mouseConnType,
    periConnType,
    receiverLabel,
    receiverSupportsBluetooth,
    powerInput,
    charge,
    strip,
    directAttach: false,
    previousPorts: productPorts,
  })
  const hostId = NEEDS_HOST_CATEGORIES.includes(category)
    ? defaultHostId(category, input.deskGadgets ?? [])
    : undefined
  const heightRange = orderedRange(normalizeDimensionInput(s?.deskHeightMin ?? ''), normalizeDimensionInput(s?.deskHeightMax ?? ''))
  const isHeightAdjustable = category === 'Desk' && s?.isHeightAdjustable === true

  return {
    id: input.id,
    name,
    category,
    customCategory: category === 'Other' ? input.customCategory : undefined,
    stereoPair: category === 'Speaker' ? true : undefined,
    speakerInputSide: category === 'Speaker' ? 'L' : undefined,
    ports,
    // 商品DBの端子を持たずカテゴリ既定のままのポートは推定値。図は描けるが実物とは限らない
    portsNeedConfirmation: !productPorts?.length && isCategoryDefaultPortState(category, portState) ? true : undefined,
    productId: s?.productId,
    isHeightAdjustable: category === 'Desk' ? isHeightAdjustable : undefined,
    deskLiftType: isHeightAdjustable ? (isElectricDesk ? 'electric' : 'manual') : undefined,
    deskHeightMin: isHeightAdjustable ? heightRange.min : undefined,
    deskHeightMax: isHeightAdjustable ? heightRange.max : undefined,
    // 商品DBの価格は取り込み時点のスナップショット。払った額ではないが、以前のフォームも
    // 空欄にこの値を入れて保存していたので揃える（詳細画面で直せる）
    price: s?.priceJpy,
    purchasedAt: input.purchasedAt,
    introducedAtUnknown: input.purchasedAt ? undefined : true,
    pcThunderbolt: category === 'PC' ? !!productPorts?.some((p) => p.type === 'Thunderbolt') : undefined,
    pcFormFactor: category === 'PC' ? pcFormFactor : undefined,
    consoleFormFactor: category === 'GameConsole' ? consoleFormFactor : undefined,
    supportsPassThroughCharging: category === 'MobileBattery' ? (s?.supportsPassThroughCharging ?? false) : undefined,
    // 商品DBもプリセットもケーブルの種別を持たないので、商品名から読む
    cableType: category === 'Cable' ? cableTypeFromName(name) ?? undefined : undefined,
    cableCount: category === 'Cable' ? 1 : undefined,
    bluetoothTargetGadgetIds: hostId ? [hostId] : undefined,
    smartHomePowerSource: category === 'SmartHome'
      ? (powerInput === 'solar' ? 'solar' : powerInput === 'battery' ? 'battery' : 'standard')
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
    createdAt: input.now,
  }
}
