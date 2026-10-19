import { CATEGORY_PORT_CONFIG, PortFormField, PortState, buildPortsFromState, portMatchesField } from '../constants/portFormConfig'
import { isPowerFeedPrefixPort, isChargeLabelPort, isDataBearingPort, isPowerSupplyPort, POWER_SUPPLY_LABEL, RECEIVER_LABEL, WIRED_LABEL, WIRELESS_POWER_LABEL } from './portRoles'
import { Gadget, GadgetCategory, Port, PortType } from '../types'
import { withUniquePortIds } from './portTypeMigration'

// ─── ガジェットのポート構成を組み立てる（追加画面・編集画面の共通ロジック）───
// 画面ごとに実装が分かれていると、片方だけ仕様変更されて保存内容がズレるため
// （実際に編集画面ではマウスの充電ポートと電源タップの極性が失われていた）、
// 入力値 → Port[] の変換はここに一本化する。

export type MouseConnType = 'wired' | 'wireless' | 'dongle'
export type PowerInput = 'none' | 'outlet' | 'dc' | 'from_a' | 'from_c' | 'wireless' | 'solar' | 'battery'
export type PowerUsage = NonNullable<import('../types').Gadget['powerUsage']>

/**
 * 内蔵のコンセント・USB を持ちうる家具。天板のほか、デスクシェルフ（家具）や電源付きの
 * 壁面パネルがある。口を持てるのに配り元として扱わないと、口には一本も線が引かれず、
 * 家具そのものがコンセントを1口ほしがって「給電できません」の警告になっていた
 */
export const BUILT_IN_OUTLET_CATEGORIES: GadgetCategory[] = ['Desk', 'Furniture', 'WallPanel']

export function canSelectPowerSource(targetCategory: GadgetCategory, sourceCategory: GadgetCategory): boolean {
  if (targetCategory === 'MobileBattery' && sourceCategory === 'MobileBattery') return false
  return sourceCategory === 'Charger' || sourceCategory === 'MobileBattery' || sourceCategory === 'PowerStrip' || sourceCategory === 'UPS' ||
    BUILT_IN_OUTLET_CATEGORIES.includes(sourceCategory)
}

export function canSupplyPowerInput(source: Gadget, powerInput: PowerInput): boolean {
  if (powerInput === 'wireless') {
    return source.ports.some((port) => port.direction !== 'input' && isWirelessPowerPort(port))
  }
  const type = powerInput === 'from_c' ? 'USB_C' : powerInput === 'from_a' ? 'USB_A' : null
  if (!type) return false
  return source.ports.some((port) =>
    port.type === type && (port.direction === 'output' || port.direction === 'bidirectional'),
  )
}

const RECHARGEABLE_DEFAULT_CATEGORIES: GadgetCategory[] = [
  'MobileBattery', 'Controller', 'VRGlass', 'Smartphone', 'Tablet', 'Smartwatch',
  'Mouse', 'Keyboard', 'Headphone', 'Earphone', 'SmallDevice',
]

export function defaultPowerUsageForCategory(category: GadgetCategory, consoleFormFactor?: Gadget['consoleFormFactor']): PowerUsage {
  if (category === 'GameConsole' && consoleFormFactor === 'handheld') return 'rechargeable'
  return RECHARGEABLE_DEFAULT_CATEGORIES.includes(category) ? 'rechargeable' : 'continuous'
}

/**
 * 口を配るガジェット。追加画面で数量を増やすと別々の N 台として登録する。配線エンジンは
 * 数量を見ないので、1台として登録すると口が足りない警告になる。複数台は置き場所も充電する
 * 相手も違うのが普通で、配線図でも1台ずつ描くほうが実物に合う
 */
export const SPLIT_QUANTITY_CATEGORIES: GadgetCategory[] = ['Charger', 'PowerStrip', 'MobileBattery']

/** 給電方法の選択UIを持たず、自前でポートを構築するカテゴリ */
export const NO_POWER_INPUT_CATEGORIES: GadgetCategory[] = ['PowerStrip', 'UPS', 'MobileBattery', 'Chair', 'Cable']
/** 給電なし（'none'）を選べる／既定にするカテゴリ */
// バスパワーガジェットは、データ接続と別の給電線を強制しない。
export const NONE_POWER_ALLOWED_CATEGORIES: GadgetCategory[] = [
  'Monitor', 'TV', 'Projector', 'Dock', 'Hub', 'Storage', 'GameConsole', 'VRGlass', 'Smartphone', 'Tablet', 'Smartwatch', 'Webcam', 'Camera', 'SmallDevice', 'PCPart', 'Microphone', 'Instrument', 'AudioInterface', 'HeadphoneAmp',
  'Speaker', 'Mixer', 'Desk', 'Furniture', 'WallPanel', 'MonitorArm', 'MicArm', 'Accessory', 'PenTablet', 'CaptureDevice', 'KVM', 'Lens', 'Tripod', 'Other',
]

const OUTLET_POWER_DEFAULT_CATEGORIES: GadgetCategory[] = [
  'PC', 'Monitor', 'TV', 'Projector', 'Dock', 'GameConsole', 'Charger', 'UPS', 'Printer', 'Printer3D', 'Router', 'NetworkSwitch', 'Modem', 'Speaker', 'Mixer', 'Amplifier',
]
const USB_C_POWER_DEFAULT_CATEGORIES: GadgetCategory[] = [
  'Controller', 'Mouse', 'Keyboard',
  'Headphone', 'Earphone', 'SmartHome', 'Light', 'StreamingDevice',
]

/**
 * USB の口が電源にしか使われないカテゴリ。配線エンジンも Bluetooth 制御の有無に関わらず
 * ライトへはデータ線を引かず、給電だけを処理している。
 * 商品DB・プリセットのライトは口にラベルが無いもの（BenQ ScreenBar・QUNTIS）や
 * 「USB電源」のように給電の語を使わないもの（Govee）があり、ラベルだけで判定すると
 * 給電の口と認識できず、給電方法の既定（USB-C）の口がもう1つ生えていた。
 * USB-A 給電のライトが USB-C の口を取り、充電器の少ない USB-C を1口ふさいでいた
 */
const USB_POWER_ONLY_CATEGORIES: GadgetCategory[] = ['Light']

/** その口が本体へ電気を受ける口か（給電方法セレクタが作る口と同じ役割か） */
export function isPowerReceivingPort(category: GadgetCategory, port: Port): boolean {
  if (port.direction !== 'input' && port.direction !== 'bidirectional') return false
  if (POWER_SUPPLY_LABEL.test(port.label ?? '')) return true
  return USB_POWER_ONLY_CATEGORIES.includes(category) && (port.type === 'USB_C' || port.type === 'USB_A')
}

/**
 * プリセット・商品DBのポート構成から給電方法と使われ方を推定する。
 *
 * カテゴリ既定だけでは、同じカテゴリに据置と携帯が混ざる Speaker・GameConsole・Monitor で
 * バッテリー機が「コンセントから・常時給電」になり、実物に無いコンセント端子が生えていた
 * （Switch Lite・SoundLink Flex・ZenScreen で実際に生えていた）。
 * 内蔵バッテリーかどうかはラベルで割れる。「充電」と書いてある口は内蔵バッテリー、
 * 「給電」と書いてある口は挿さっていないと動かない機器（USB-C 給電のポータブルモニター等）。
 */
export function inferPowerFromPorts(
  category: GadgetCategory,
  ports: Port[],
): { powerInput: PowerInput; powerUsage: PowerUsage } | null {
  if (NO_POWER_INPUT_CATEGORIES.includes(category)) return null
  const receives = (port: Port) => port.direction === 'input' || port.direction === 'bidirectional'
  // AC / DC で受けるならバッテリー機ではない。既定のままでよい
  if (ports.some((port) => (port.type === 'Power' || port.type === 'DCPower') && receives(port))) return null
  // 給電方法セレクタが作れる口だけを対象にする（microUSB・Lightning は選択肢が無い）
  const supplyType = (['USB_C', 'USB_A', 'wirelessCharging'] as const)
  const supply = ports.find((port) =>
    (supplyType as readonly PortType[]).includes(port.type) &&
    isPowerReceivingPort(category, port))
  if (!supply) return null
  const powerInput: PowerInput =
    supply.type === 'USB_A' ? 'from_a' : supply.type === 'wirelessCharging' ? 'wireless' : 'from_c'
  // 「充電」＝内蔵バッテリー。「給電」だけの口は挿しっぱなしで使う
  const powerUsage: PowerUsage = isChargeLabelPort(supply)
    ? 'rechargeable'
    : defaultPowerUsageForCategory(category)
  return { powerInput, powerUsage }
}

export function defaultPowerInputForCategory(
  category: GadgetCategory,
  pcFormFactor?: Gadget['pcFormFactor'],
): PowerInput {
  if (category === 'PC' && pcFormFactor === 'laptop') return 'from_c'
  if (USB_C_POWER_DEFAULT_CATEGORIES.includes(category)) return 'from_c'
  if (OUTLET_POWER_DEFAULT_CATEGORIES.includes(category)) return 'outlet'
  if (NO_POWER_INPUT_CATEGORIES.includes(category) || NONE_POWER_ALLOWED_CATEGORIES.includes(category)) return 'none'
  return 'outlet'
}

/** 充電器の既定の口数。追加・編集画面のステッパー初期値と、テンプレートのプレースホルダーで共有する */
export const DEFAULT_CHARGER_USB_C = 2
export const DEFAULT_CHARGER_USB_A = 1

export interface UsbPowerPortSlot {
  /** `ポートID#何口目`。Connection.sourcePortId / Gadget.powerSourcePortId と同じ識別子 */
  id: string
  type: PortType
  /** 表示用の口の名前（USB-C 1 / USB-A 1 …） */
  label: string
}

/**
 * 充電器・モバイルバッテリーの USB 出力を「物理ポート1口ずつ」に展開する。
 * 配線エンジンの割り当てと編集画面の選択肢で同じ識別子・同じ並びを使う必要があるため、
 * どちらからも呼べるここに集約する。
 */
export function usbPowerPortSlots(source: Gadget): UsbPowerPortSlot[] {
  const slots: UsbPowerPortSlot[] = []
  const seenPerType = new Map<PortType, number>()
  for (const port of source.ports) {
    if (port.direction !== 'output' && port.direction !== 'bidirectional') continue
    if (port.type !== 'USB_C' && port.type !== 'USB_A') continue
    for (let i = 0; i < (port.count ?? 1); i++) {
      const nth = (seenPerType.get(port.type) ?? 0) + 1
      seenPerType.set(port.type, nth)
      slots.push({
        id: `${port.id}#${i}`,
        type: port.type,
        label: `${port.type === 'USB_C' ? 'USB-C' : 'USB-A'} ${nth}`,
      })
    }
  }
  return slots
}

/** ホストガジェットとの接続方法を選ぶ周辺機器（キーボード等） */
const PERIPHERAL_CATEGORIES: GadgetCategory[] = ['Keyboard', 'Speaker', 'Headphone', 'Earphone', 'Controller']

/** モニターアーム／マイクアームで支えているガジェットか（「アームを使用」トグルの有無） */
export function armMountCategory(gadget: Gadget): 'MonitorArm' | 'MicArm' | null {
  for (const port of gadget.ports) {
    // 出力はアーム本体の「支える側」。装着バッジは支えられる機材だけに出す。
    if (port.direction === 'input' && (port.type === 'MonitorArm' || port.type === 'MicArm')) return port.type
  }
  return null
}

/**
 * ワイヤレス給電（Qi 等）のポートか。
 * 専用の wirelessCharging 型と、旧データの「Power 型 + ラベル」表記の両方を認識する。
 * 配線図と統計で判定がずれると、同じガジェットが片方でだけ無線扱いになるためここに集約する。
 */
export function isWirelessPowerPort(port: Port): boolean {
  return port.type === 'wirelessCharging'
    || (port.type === 'Power' && WIRELESS_POWER_LABEL.test(port.label ?? ''))
}

export interface PortBuildInput {
  category: GadgetCategory
  portState: PortState
  mouseConnType: MouseConnType
  periConnType: MouseConnType
  receiverLabel?: string
  receiverSupportsBluetooth?: boolean
  powerInput: PowerInput
  charge: { usbC: number; usbA: number; wirelessCount: number }
  strip: { outlets: number; usbC: number; usbA: number; grounded: boolean }
  /** 本体を差し込み口へ直接挿すガジェット（USBメモリ・HDMIスティック等）。データ側の口が directAttach になる */
  directAttach?: boolean
  /** 保存前のポート。フォームが表現できない口・ラベルを引き継ぐために渡す */
  previousPorts?: Port[]
}

export function chargerFormStateFromPorts(ports: Port[]): {
  usbC: number
  usbA: number
  wirelessCount: number
  powerInput: PowerInput
} {
  const outputCount = (type: PortType) => ports
    .filter((port) => port.type === type && (port.direction === 'output' || port.direction === 'bidirectional'))
    .reduce((sum, port) => sum + Math.max(0, port.count), 0)
  const wirelessCount = ports
    .filter((port) => port.direction !== 'input' && isWirelessPowerPort(port))
    .reduce((sum, port) => sum + Math.max(0, port.count), 0)
  const hasInput = (type: PortType) => ports.some((port) =>
    port.type === type && (port.direction === 'input' || port.direction === 'bidirectional'))
  const powerInput: PowerInput = hasInput('Power')
    ? 'outlet'
    : hasInput('USB_C')
      ? 'from_c'
      : hasInput('USB_A')
        ? 'from_a'
        : 'none'
  return { usbC: outputCount('USB_C'), usbA: outputCount('USB_A'), wirelessCount, powerInput }
}

/** 既存ガジェットから「本体を直接挿す」設定を復元する（専用フィールドは持たずポートから導く） */
export function isDirectAttachGadget(ports: Port[]): boolean {
  return ports.some((port) => port.directAttach)
}

/**
 * 「本体を直接挿す」トグルを出すカテゴリ。USBメモリ・HDMIスティック・USBドングルなど、
 * 本体まるごとが差し込み口に刺さる形のガジェットが入りうるものだけに絞る。
 * マウス／キーボードの 2.4GHz レシーバーは接続方法の選択から自動で付くので、ここには含めない。
 */
export const DIRECT_ATTACH_CATEGORIES: GadgetCategory[] = ['Storage', 'SmallDevice', 'StreamingDevice', 'Accessory', 'SmartHome']

const withIds = (specs: Omit<Port, 'id'>[]): Port[] => specs.map((s, i) => ({ id: `p${i + 1}`, ...s }))

// 充電ポート（USB-C 充電など）は「給電方法」セレクタ側で付くため、ここでは接続方法だけ扱う
function buildMousePorts(input: PortBuildInput): Port[] {
  const specs: Omit<Port, 'id'>[] = []
  if (input.mouseConnType === 'wired') {
    specs.push({ type: 'USB_A', direction: 'input', count: 1, label: '有線接続 (USB-A)' })
  } else if (input.mouseConnType === 'dongle') {
    // レシーバーは PC に直挿しするので、USB-A でもケーブルは1本も要らない
    specs.push({ type: 'USB_A', direction: 'input', count: 1, label: input.receiverLabel || '2.4GHzレシーバー', directAttach: true })
    if (input.receiverSupportsBluetooth) specs.push({ type: 'Bluetooth', direction: 'bidirectional', count: 1 })
  } else {
    specs.push({ type: 'Bluetooth', direction: 'bidirectional', count: 1 })
  }
  return withIds(specs)
}

function buildChargerPorts(input: PortBuildInput): Port[] {
  const specs: Omit<Port, 'id'>[] = []
  if (input.charge.usbC > 0) specs.push({ type: 'USB_C', direction: 'output', count: input.charge.usbC })
  if (input.charge.usbA > 0) specs.push({ type: 'USB_A', direction: 'output', count: input.charge.usbA })
  if (input.charge.wirelessCount > 0) specs.push({ type: 'wirelessCharging', direction: 'output', count: input.charge.wirelessCount, label: 'ワイヤレス出力' })
  return withIds(specs)
}

function buildPowerStripPorts(input: PortBuildInput): Port[] {
  const label = input.strip.grounded ? 'アース付き 3極' : '2極'
  const ports: Port[] = [{ id: 'p1', type: 'Power', direction: 'output', count: input.strip.outlets, label }]
  if (input.strip.usbC > 0) ports.push({ id: 'p2', type: 'USB_C', direction: 'output', count: input.strip.usbC })
  if (input.strip.usbA > 0) ports.push({ id: 'p3', type: 'USB_A', direction: 'output', count: input.strip.usbA })
  ports.push({ id: 'p4', type: 'Power', direction: 'input', count: 1 })
  return ports
}

function powerInputPort(powerInput: PowerInput): Port | null {
  const id = `power_in_${Date.now()}`
  switch (powerInput) {
    case 'outlet':   return { id, type: 'Power',            direction: 'input', count: 1, label: '給電 (コンセント)' }
    case 'dc':       return { id, type: 'DCPower',          direction: 'input', count: 1, label: '給電 (DCプラグ)', powerAdapterIncluded: true }
    case 'from_a':   return { id, type: 'USB_A',            direction: 'input', count: 1, label: '給電 (A)' }
    case 'from_c':   return { id, type: 'USB_C',            direction: 'input', count: 1, label: '給電 (C)' }
    case 'wireless': return { id, type: 'wirelessCharging', direction: 'input', count: 1, label: 'ワイヤレス給電' }
    case 'solar':    return { id, type: 'Power',            direction: 'input', count: 1, label: '給電 (ソーラーパネル)' }
    case 'battery':  return { id, type: 'Power',            direction: 'input', count: 1, label: '給電 (電池・バッテリー)' }
    default:         return null
  }
}

/** フォームの入力値からガジェットのポート構成を組み立てる */
export function buildGadgetPorts(input: PortBuildInput): Port[] {
  const { category } = input
  let ports: Port[]

  if (category === 'Charger')          ports = buildChargerPorts(input)
  else if (category === 'Mouse')       ports = buildMousePorts(input)
  else if (category === 'PowerStrip')  ports = buildPowerStripPorts(input)
  else {
    const fields = CATEGORY_PORT_CONFIG[category] ?? []
    ports = buildPortsFromState(input.portState, fields)
    if (PERIPHERAL_CATEGORIES.includes(category)) {
      const hiddenFields = fields.filter((field) => field.hidden)
      ports = ports.filter((port) => !hiddenFields.some(
        (field) => field.portType === port.type && field.direction === port.direction,
      ))
      const pid = `conn_${Date.now()}`
      const connectionPorts: Port[] = []
      if (input.periConnType === 'wired') {
        const usesConfiguredConnectionInput =
          ((category === 'Headphone' || category === 'Earphone') &&
            (input.portState.audio_in === true || input.portState.audio63_in === true || input.portState.usbc === true)) ||
          // パッシブ・ライン入力のスピーカーは音を受ける口を既に持っている。
          // Bluetooth が無いだけで「有線＝USB」と決めつけると、アンプが要る旨の警告と
          // 一緒にモニターのUSBハブから線が引かれ、あり得ない配線が図に出る
          (category === 'Speaker' && ports.some(isAudioInputPort))
        const connType =
          ((category === 'Controller' || category === 'Keyboard' || category === 'Headphone' || category === 'Earphone') &&
          input.portState.usbc === true) ? 'USB_C' as const : 'USB_A' as const
        const label = category === 'Keyboard'
          ? `有線接続 (${connType === 'USB_C' ? 'USB-C' : 'USB-A'})`
          : category === 'Controller' && connType === 'USB_A'
            ? 'USB-A (ドングル / 有線)'
            : '有線接続'
        if (!usesConfiguredConnectionInput) {
          connectionPorts.push({ id: pid, type: connType, direction: 'input', count: 1, label })
        }
      } else if (input.periConnType === 'dongle') {
        // レシーバーは PC に直挿しするので、USB-A でもケーブルは1本も要らない
        connectionPorts.push({ id: pid, type: 'USB_A', direction: 'input', count: 1, label: input.receiverLabel || '2.4GHzレシーバー', directAttach: true })
        if (input.receiverSupportsBluetooth) {
          connectionPorts.push({ id: `${pid}_bt`, type: 'Bluetooth', direction: 'bidirectional', count: 1 })
        }
      } else {
        connectionPorts.push({ id: pid, type: 'Bluetooth', direction: 'bidirectional', count: 1 })
      }
      // ヘッドセットのようにフォーム側にも USB-A の口を持つカテゴリでは、接続方式セレクタが
      // 作る口と二重になる。両方残すと、レシーバー直挿しの構成なのにUSBケーブルがもう1本引かれる
      ports = [
        ...ports.filter((port) => !connectionPorts.some(
          (connection) => connection.type === port.type && connection.direction === port.direction,
        )),
        ...connectionPorts,
      ]
    }
  }

  // PC は常に 3.5mm オーディオ出力を持つ
  if (category === 'PC') {
    ports = [...ports, { id: 'p_audio', type: 'Audio3_5mm', direction: 'output', count: 1 }]
  }

  if (input.previousPorts?.length) {
    const conn = category === 'Mouse' ? input.mouseConnType : input.periConnType
    const previous = input.previousPorts
    // 引き継いだ口は元の ID のまま残し、フォームが p1… で振った口のほうをずらす
    ports = withUniquePortIds(
      carryOverUnmanagedPorts(ports, previous, category, conn === 'wired'),
      (port) => previous.some((p) => p.id === port.id && p.type === port.type && p.direction === port.direction),
    )
  }

  // デスク内蔵のAC・USB出力はデスク本体の電源コードから受電する。
  // 出力を設定したのにAC入力だけ付け忘れた保存データを作らない。
  if (BUILT_IN_OUTLET_CATEGORIES.includes(category) &&
      ports.some((port) =>
        (port.type === 'Power' || port.type === 'USB_A' || port.type === 'USB_C') &&
        (port.direction === 'output' || port.direction === 'bidirectional')) &&
      !ports.some((port) => port.type === 'Power' && (port.direction === 'input' || port.direction === 'bidirectional'))) {
    ports = [...ports, { id: `desk_power_in_${Date.now()}`, type: 'Power', direction: 'input', count: 1, label: '給電 (コンセント)' }]
  }

  // 給電ポート（PowerStrip 等、自前でポートを構築するカテゴリは対象外）
  const poweredByWiredConnection =
    (category === 'Mouse' && input.mouseConnType === 'wired') ||
    (PERIPHERAL_CATEGORIES.includes(category) && input.periConnType === 'wired') ||
    ((category === 'MonitorArm' || category === 'MicArm') &&
      ports.some((port) => (port.type === 'USB_C' || port.type === 'USB_A') && port.direction === 'input'))
  if (input.powerInput !== 'none' && !NO_POWER_INPUT_CATEGORIES.includes(category) && !poweredByWiredConnection
      && !ports.some((port) => port.type === 'Power' && port.direction === 'input')) {
    const p = powerInputPort(input.powerInput)
    // 同じ端子で電気を受ける口が既にあるなら足さない。プリセットの「充電」や
    // 「USB-C (映像 / 給電)」の隣に「給電 (C)」が生えて、実物に無い2口目になっていた。
    // 語彙は wiringEngine の isChargingOnlyPort と揃える（英語は商品DB・プリセットに1件も無い）
    const alreadySupplied = !!p && ports.some((port) =>
      port.type === p.type && isPowerReceivingPort(category, port))
    if (p && !alreadySupplied) ports = [...ports, p]
  }

  // 「本体を直接挿す」ガジェット（USBメモリ・HDMIスティック等）は、データ側の口にケーブルが要らない。
  // 給電の口は対象外：HDMIスティックのように、本体は直挿しでも電源ケーブルは別に要るガジェットがある
  if (input.directAttach) {
    ports = ports.map((port) =>
      isDataInputPort(port) ? { ...port, directAttach: true } : port,
    )
  }

  return ports
}

/**
 * 保存前のポートのうち、フォームが表現できないものを引き継ぐ。
 *
 * ポート編集フォームは type × direction × 決められた label しか扱えない。
 * プリセット由来の口（モニターの「USB-C (DP Alt / PD)」など）はどのフィールドにも
 * 一致しないため、開いて保存しただけで口ごと消え、映像対応の印まで落ちていた。
 * 名前を直しただけで配線図が変わるのはこれが原因。
 */
function carryOverUnmanagedPorts(ports: Port[], previous: Port[], category: GadgetCategory, wiredConnection: boolean): Port[] {
  const fields = CATEGORY_PORT_CONFIG[category] ?? []
  const result = [...ports]

  // ラベルと映像対応はフォームで指定できないので、同じ口が残っていれば元の値を戻す
  const consumed = new Set<Port>()
  for (let i = 0; i < result.length; i++) {
    const port = result[i]
    if (port.label !== undefined && port.supportsVideo !== undefined && port.supportsPowerDelivery !== undefined) continue
    const source = previous.find(
      (p) => !consumed.has(p) && p.type === port.type && p.direction === port.direction,
    )
    if (!source) continue
    consumed.add(source)
    result[i] = {
      ...port,
      // 同じ口なら ID も引き継ぐ。給電の挿し口・音声出力の割り当ては口の ID で覚えている
      id: source.id,
      label: port.label ?? source.label,
      supportsVideo: port.supportsVideo ?? source.supportsVideo,
      supportsPowerDelivery: port.supportsPowerDelivery ?? source.supportsPowerDelivery,
      supportsPoE: port.supportsPoE ?? source.supportsPoE,
      supportsDisplayConversion: port.supportsDisplayConversion ?? source.supportsDisplayConversion,
      powerAdapterIncluded: port.powerAdapterIncluded ?? source.powerAdapterIncluded,
    }
  }

  // 充電器・電源タップはフォームの数値がそのまま口数になる。
  // ここで足すと口数を 0 にしても減らせなくなる
  if (DEDICATED_PORT_BUILDER_CATEGORIES.includes(category)) return result

  // フォームが担当していない口は、フォームで外したのではなく表現できないだけなので残す。
  // ラベルまで一致する口が既にあるときだけ二重と見なす（オーディオIFの
  // 「ヘッドホン出力」と「TRS ライン出力」のように、同じ端子でも別物の口がある）
  for (const port of previous) {
    if (!shouldCarryOver(port, fields, category, wiredConnection)) continue
    if (result.some((p) =>
      p.type === port.type && p.direction === port.direction && (p.label ?? '') === (port.label ?? '')
    )) continue
    result.push(port)
  }
  return result
}

function shouldCarryOver(port: Port, fields: PortFormField[], category: GadgetCategory, wiredConnection: boolean): boolean {
  // 給電の口はフィールドではなく powerInput が担当している。ここで戻すと
  // 「給電なし」に変えてもコンセントの口が消えなくなる
  if (isPowerSupplyInputPort(port)) return false
  // 有線接続を選んでいるときはフォームが作った口が充電も兼ねる。ここで戻すと
  // 「有線接続」と「充電 / 有線」の口が二重に生える
  if (!wiredConnection && isPeripheralChargePort(port, category)) return true
  return !fields.some((field) => portMatchesField(port, field))
}

/**
 * 周辺機器の充電用 USB 入力か。
 *
 * 接続方式フォーム（有線 / 無線 / ドングル）が扱えるのは「有線接続」の口とレシーバーだけで、
 * Bluetooth ガジェットが別に持つ充電端子を表現できない。フィールドの type だけで見ると
 * 有線接続の口と区別が付かず、無線のまま保存しただけで充電端子が消えていた。
 */
function isPeripheralChargePort(port: Port, category: GadgetCategory): boolean {
  if (category !== 'Mouse' && !PERIPHERAL_CATEGORIES.includes(category)) return false
  if (port.direction !== 'input') return false
  if (port.type !== 'USB_C' && port.type !== 'USB_A' && port.type !== 'microUSB') return false
  const label = port.label ?? ''
  return !WIRED_LABEL.test(label) && !RECEIVER_LABEL.test(label)
}

/** AddGadget / GadgetDetail / gadgetStore のレシーバー判定と同じ語彙。ここを変えるならあちらも合わせる */

/** 音を受ける口か（スピーカーが USB 接続のガジェットかを見分ける） */
const AUDIO_INPUT_TYPES: PortType[] = [
  'SpeakerTerminal', 'XLR', 'XLR_TRS_Combo', 'Audio6_3mm', 'Audio6_3mm_TS',
  'RCA', 'Audio3_5mm', 'OpticalAudio',
]
function isAudioInputPort(port: Port): boolean {
  return port.direction === 'input' && AUDIO_INPUT_TYPES.includes(port.type)
}

/**
 * 口数まで含めてフォームが完全に表現できるカテゴリ。
 * charge / strip の入力から全ポートを組み立てるので、引き継ぎで足す口は無い。
 * マウスは接続方式しか持てず充電口を表現できないため、ここには入れない
 */
const DEDICATED_PORT_BUILDER_CATEGORIES: GadgetCategory[] = ['Charger', 'PowerStrip']

/** powerInput のフォームが作る給電の口か */
function isPowerSupplyInputPort(port: Port): boolean {
  if (port.direction !== 'input') return false
  if (port.type === 'Power' || port.type === 'DCPower') return true
  if (isWirelessPowerPort(port)) return true
  return (port.type === 'USB_A' || port.type === 'USB_C') && isPowerFeedPrefixPort(port)
}

/**
 * データを受ける口か（給電専用の口を直挿し扱いしないための判定）
 *
 * 「充電の語があってもデータも通す口」を見分ける語彙は wiringEngine の isChargingOnlyPort と
 * 同じもの。片方にだけドングル・レシーバー・ドックの語が入っていたため、
 * Logicool G935 の「USBドングル / 充電」が**どちらの判定からも漏れて**いた。
 * 語を足すときは両方に足す。
 */

function isDataInputPort(port: Port): boolean {
  if (port.direction === 'output') return false
  if (port.type === 'Power' || port.type === 'DCPower') return false
  if (isWirelessPowerPort(port)) return false
  return !isPowerSupplyPort(port) || isDataBearingPort(port)
}
