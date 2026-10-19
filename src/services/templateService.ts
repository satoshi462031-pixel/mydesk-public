import { v4 as uuidv4 } from 'uuid'
import { isWiredPort } from '../utils/portRoles'
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../constants/categoryLabels'
import { CustomCategory, DeskPlan, Gadget, GadgetCategory, GadgetPlacement, PlanPurpose, Port, PortDirection, PortType } from '../types'
import { DeskTemplate, TemplateSlot } from '../types/template'
import { DEFAULT_CHARGER_USB_A, DEFAULT_CHARGER_USB_C, defaultPowerInputForCategory, defaultPowerUsageForCategory } from '../utils/gadgetPorts'
import { applyProductToGadget } from '../utils/productFill'
import { ProductSuggestion } from '../utils/productSuggestions'
import {
  applyTemplateSpec,
  planSpecArms,
  readTemplateSpecCounts,
  TEMPLATE_SPEC_ARM_FOR,
  TEMPLATE_SPEC_COUNT_FIELDS,
  TEMPLATE_SPEC_SPLIT_CATEGORIES,
  TemplateSpec,
} from '../utils/templateSpec'
import { trimAndTruncate } from '../utils/truncateText'

// ─── テンプレート適用 ────────────────────────────────────────────
//
// テンプレート → 既存のデスク生成処理への「変換」だけを行う。
// プラン生成の形は PurposeSelectionScreen、配線生成は DeskPlacementScreen と同じ
// generateWiring を再利用し、テンプレート専用の配線ロジックは持たない。

const P = (id: string, type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port =>
  ({ id, type, direction, count, ...extra })

/** プレースホルダーの電源タップに持たせる標準ポート定義用の値。電源容量の判定には使わない。 */
const TEMPLATE_POWER_STRIP_OUTLETS = 10

// プレースホルダーに持たせるカテゴリ標準ポート。
// generateWiring がここから推奨配線構造を自動生成する。
// 未定義カテゴリは ports: []（配線なしノード）になる。
const PLACEHOLDER_PORTS: Partial<Record<GadgetCategory, Port[]>> = {
  // PC は映像・USB の出力元。ここが空だとモニターやハブへ線が1本も引けない
  PC:          [
    P('p1', 'HDMI', 'output', 2, { supportsVideo: true }),
    P('p2', 'DisplayPort', 'output', 1, { supportsVideo: true }),
    P('p3', 'USB_C', 'output', 2, { supportsVideo: true }),
    // テンプレートはハブを持たない（normalizeTemplate が外す）ため、周辺機器はすべて PC 直挿しになる。
    // 2口だとキーボード・マウスで埋まり、Webカメラ・マイク・オーディオIFが挿さらず浮く
    P('p4', 'USB_A', 'output', 4),
    // 前面・背面の2口ぶん。1口だとイヤホンとスピーカーが同居したとき片方が繋げなくなる
    P('p5', 'Audio3_5mm', 'output', 2),
    P('p6', 'Power', 'input'),
  ],
  // アームの受け口は持たせない。受け口は「アームを使用」のトグルと装着の印そのものなので、
  // 全部の枠に付けるとアームの無いデスクのモニターまで載っている扱いになる。
  // 載せる枠にだけ applyTemplateSpec が足す（onArm / 支持先の明示）
  Monitor:     [P('p1', 'HDMI', 'input', 2, { supportsVideo: true }), P('p2', 'DisplayPort', 'input', 1, { supportsVideo: true }), P('p3', 'USB_C', 'input', 1, { supportsVideo: true }), P('p5', 'Power', 'input')],
  TV:          [P('p1', 'HDMI', 'input', 3, { supportsVideo: true }), P('p2', 'Power', 'input')],
  Projector:   [P('p1', 'HDMI', 'input', 2, { supportsVideo: true }), P('p2', 'Power', 'input')],
  Keyboard:    [P('p1', 'USB_A', 'input', 1, { label: '有線接続 (USB-A)' })],
  Mouse:       [P('p1', 'USB_A', 'input', 1, { label: '有線接続 (USB-A)' })],
  Controller:  [P('p1', 'Bluetooth', 'bidirectional')],
  Headphone:   [P('p1', 'Audio3_5mm', 'input')],
  Earphone:    [P('p1', 'Audio3_5mm', 'input')],
  Speaker:     [P('p1', 'Audio3_5mm', 'input'), P('p2', 'Power', 'input')],
  Light:       [P('p1', 'Power', 'input')],
  // バスパワーガジェットの USB 入力は「データ接続」。ラベルがないと applyPowerInput に
  // 電源入力とみなされて剥がされ、ポートが1本もない浮いたノードになる
  Webcam:      [P('p1', 'USB_C', 'input', 1, { label: 'Host' })],
  Printer:     [P('p1', 'WiFi', 'input'), P('p2', 'Power', 'input')],
  Printer3D:   [P('p1', 'WiFi', 'input'), P('p2', 'Power', 'input')],
  PenTablet:   [P('p1', 'USB_C', 'input', 1, { label: 'Host' })],
  SmallDevice: [P('p1', 'USB_C', 'input')],
  // マイクアームの受け口もモニターと同じ理由で持たせない
  Microphone:  [P('p1', 'USB_C', 'input', 1, { label: 'Host' })],
  Storage:     [P('p1', 'USB_C', 'input', 1, { label: 'Host' })],
  Hub:         [P('p1', 'USB_C', 'input', 1, { label: 'Host' }), P('p2', 'USB_A', 'output', 3)],
  Dock:        [P('p1', 'Thunderbolt', 'input', 1, { label: 'Host' }), P('p2', 'HDMI', 'output', 2, { supportsVideo: true }), P('p3', 'USB_A', 'output', 4), P('p4', 'Power', 'input')],
  Charger:     [P('p1', 'USB_C', 'output', 2), P('p2', 'USB_A', 'output', 1), P('p3', 'Power', 'input')],
  MobileBattery: [P('p1', 'USB_C', 'bidirectional', 2, { label: 'USB-C 入出力' }), P('p2', 'USB_A', 'output', 1)],
  PowerStrip:  [P('p1', 'Power', 'input'), P('p2', 'Power', 'output', TEMPLATE_POWER_STRIP_OUTLETS)],
  UPS:         [P('p1', 'Power', 'input'), P('p2', 'Power', 'output', 6)],
  GameConsole: [P('p1', 'HDMI', 'output', 1, { supportsVideo: true }), P('p2', 'Power', 'input')],
  StreamingDevice: [P('p1', 'HDMI', 'output', 1, { supportsVideo: true, directAttach: true }), P('p2', 'USB_C', 'input', 1, { label: '給電 (C)' })],
  // USB は PC へ繋ぐ側（Hub/Dock/オーディオIF と同じ Host 入力）。output だと PC と繋がらず浮く
  CaptureDevice: [P('p1', 'HDMI', 'input', 1, { supportsVideo: true }), P('p2', 'HDMI', 'output', 1, { supportsVideo: true }), P('p3', 'USB_C', 'input', 1, { label: 'Host' })],
  KVM: [P('p1', 'HDMI', 'input', 2, { supportsVideo: true }), P('p2', 'HDMI', 'output', 1, { supportsVideo: true }), P('p3', 'USB_B', 'input', 2), P('p4', 'USB_A', 'output', 2)],
  MonitorArm:  [P('p1', 'MonitorArm', 'output')],
  MicArm:      [P('p1', 'MicArm', 'output')],
  Modem:       [P('p1', 'Ethernet', 'output'), P('p2', 'Power', 'input')],
  // WAN 側の Ethernet 入力はモデムからの受け口。LAN 側の output が無線LANガジェットの接続元になる
  Router:      [P('p1', 'Ethernet', 'input', 1, { label: 'WAN' }), P('p2', 'Ethernet', 'output', 4), P('p3', 'Power', 'input')],
  NetworkSwitch: [P('p1', 'Ethernet', 'input', 1, { label: 'アップリンク' }), P('p2', 'Ethernet', 'output', 4), P('p3', 'Power', 'input')],
  // スタイラスペンを吸着給電できるようにしておく（配線図ではタブレットのカードに内包される）
  Tablet:      [P('p1', 'USB_C', 'input'), P('p2', 'wirelessCharging', 'output')],
  Accessory:   [P('p1', 'wirelessCharging', 'input')],
  Smartphone:  [P('p1', 'USB_C', 'input')],
  AudioInterface: [P('p1', 'USB_C', 'input', 1, { label: 'Host' }), P('p2', 'XLR_TRS_Combo', 'input', 2, { label: 'XLR/TRS コンボ入力' }), P('p3', 'Audio6_3mm', 'output', 2, { label: '6.3mm TRS モニター出力' }), P('p4', 'Audio6_3mm', 'output', 1, { label: '6.3mm ヘッドホン出力' })],
  HeadphoneAmp: [P('p1', 'USB_C', 'input', 1, { label: 'Host' }), P('p2', 'Audio6_3mm', 'output')],
  Mixer:       [P('p1', 'USB_C', 'input', 1, { label: 'Host' }), P('p2', 'XLR', 'input', 4), P('p3', 'XLR', 'output', 2), P('p4', 'Power', 'input')],
  // オーディオIF・ミキサーが無い構成では USB で PC 直結になる（USB/MIDI キーボード等）
  Instrument:  [P('p1', 'Audio6_3mm', 'output'), P('p2', 'USB_C', 'input', 1, { label: 'Host' })],
  // データ兼給電の Link ケーブル。ラベルは配線エンジンの「データポートを持つか」判定にも使われる
  VRGlass:     [P('p1', 'USB_C', 'input', 1, { label: 'データ (Link)' })],
}

/** テンプレート適用時に有線／無線を選べるカテゴリ（構成の詳細で切り替える） */
export const CONN_TYPE_CATEGORIES: GadgetCategory[] = ['Keyboard', 'Mouse', 'Speaker', 'Headphone', 'Earphone']

export type ConnType = 'wired' | 'wireless'

// 無線（Bluetooth）を選んだ場合のプレースホルダーポート。
// 有線ポートを Bluetooth に置き換える。スピーカーだけは電源が別途必要。
const WIRELESS_PLACEHOLDER_PORTS: Partial<Record<GadgetCategory, Port[]>> = {
  Keyboard:  [P('p1', 'Bluetooth', 'bidirectional')],
  Mouse:     [P('p1', 'Bluetooth', 'bidirectional')],
  Speaker:   [P('p1', 'Bluetooth', 'bidirectional'), P('p2', 'Power', 'input')],
  Headphone: [P('p1', 'Bluetooth', 'bidirectional')],
  Earphone:  [P('p1', 'Bluetooth', 'bidirectional')],
}

/** スロットの既定の接続方式。切替不可カテゴリは undefined（トグルを出さない） */
export function defaultConnTypeForSlot(category: GadgetCategory, templateDefault: ConnType = 'wired'): ConnType | undefined {
  if (!CONN_TYPE_CATEGORIES.includes(category)) return undefined
  return templateDefault
}

function placeholderPortsForTemplate(
  category: GadgetCategory,
  connType?: ConnType,
): Port[] {
  const resolved = connType ?? defaultConnTypeForSlot(category)
  if (resolved === 'wireless' && WIRELESS_PLACEHOLDER_PORTS[category]) {
    return WIRELESS_PLACEHOLDER_PORTS[category]!.map((p) => ({ ...p }))
  }
  return PLACEHOLDER_PORTS[category] ?? []
}

/**
 * テンプレートのプレースホルダー限定の給電方法。
 * defaultPowerInputForCategory は「データケーブルが給電も兼ねる」前提でこれらを 'none' と返すが、
 * テンプレートのプレースホルダーはデータ接続の相手を持たないため、そのままだとポートが0本になり
 * 配線図で完全に浮く。充電線だけは引けるように USB 受電を既定にする。
 */
const TEMPLATE_POWER_INPUT: Partial<Record<GadgetCategory, TemplateSlot['powerInput']>> = {
  Smartphone: 'usb_c',
  Tablet: 'usb_c',
  Smartwatch: 'usb_c',
  SmallDevice: 'usb_c',
}

/**
 * スロットの給電方法をポート構成に反映する。
 * 'usb_c' は「コンセントではなく充電器・モバイルバッテリーの USB-C から受電する」の意味。
 * 配線エンジンはラベルに「給電」を含む USB 入力を電源入力として認識する。
 */
function applyPowerInput(
  ports: Port[],
  powerInput: TemplateSlot['powerInput'],
  category: GadgetCategory,
  pcFormFactor?: TemplateSlot['pcFormFactor'],
  hasUsbPowerSource = true,
): Port[] {
  const resolved = powerInput ?? TEMPLATE_POWER_INPUT[category] ?? (() => {
    // ノートPCの既定は USB-C 給電（PD充電器）。形状を渡さないとデスクトップ扱いになり、
    // ノートPCのテンプレートなのにコンセント直結の図になってしまう
    const categoryDefault = defaultPowerInputForCategory(category, pcFormFactor)
    // 充電器もモバイルバッテリーも無い構成では、USB 受電にすると挿す先がなくなる。
    // その場合は AC アダプタ（コンセント）で給電する
    if (categoryDefault === 'from_c') return hasUsbPowerSource ? 'usb_c' : 'outlet'
    if (categoryDefault === 'wireless') return 'wireless'
    if (categoryDefault === 'none') return 'none'
    return 'outlet'
  })()
  // 既存の電源入力を外す（映像用 USB-C や Host 入力は残す）
  const kept = ports.filter((p) => {
    if (p.type === 'Power' && p.direction === 'input') return false
    if (p.type === 'USB_C' && p.direction === 'input' && !p.supportsVideo && !p.label) return false
    return true
  })
  const poweredByWiredConnection =
    (category === 'Mouse' || category === 'Keyboard') &&
    kept.some((p) => p.direction === 'input' && isWiredPort(p))
  if (poweredByWiredConnection) return kept
  if (resolved === 'none') return kept
  if (resolved === 'outlet') return [...kept, P('pw', 'Power', 'input', 1, { label: '給電 (コンセント)' })]
  if (resolved === 'wireless') return [...kept, P('pw', 'wirelessCharging', 'input', 1, { label: 'ワイヤレス給電' })]
  return [...kept, P('pw', 'USB_C', 'input', 1, { label: '給電 (C)' })]
}

/**
 * テンプレートの共通ルールを適用する（データ側に書き忘れても効くよう、ここで一元化）。
 * ・充電器はすべてのテンプレートに1台だけ常備する
 * 一覧・詳細のプレビューと適用結果を一致させるため、Repository が返す時点で通す。
 */
export function normalizeTemplate(
  template: DeskTemplate,
  // 公式テンプレートはハブを持たない前提で組んである（周辺機器は PC 直挿しで足りる）。
  // ただしユーザーが自分でハブを選んだ構成では、黙って外すと選んだものが消える
  options: { keepHub?: boolean } = {},
): DeskTemplate {
  const retainedSlots = template.slots
    .map((slot, originalIndex) => ({ slot, originalIndex }))
    .filter(({ slot }) => options.keepHub || slot.category !== 'Hub')
  const normalizedIndex = new Map(retainedSlots.map(({ originalIndex }, index) => [originalIndex, index]))
  const slots = retainedSlots.map(({ slot }) => slot)
  const wiringHints = template.wiringHints?.flatMap((hint) => {
    const fromSlot = normalizedIndex.get(hint.fromSlot)
    const toSlot = normalizedIndex.get(hint.toSlot)
    return fromSlot === undefined || toSlot === undefined ? [] : [{ ...hint, fromSlot, toSlot }]
  })
  const allowCharger = template.autoCharger !== false
  if (allowCharger) {
    // 必要な口数ぶんの充電器を用意する。
    // ・常時給電のガジェットは1口を占有する（＝台数ぶんの口が要る）
    // ・バッテリー内蔵のガジェットは充電時だけ挿すので口を共有できるが、挿す枠として1口は確保する
    // 判定は applyPowerInput と同じ解決順にする（ここがずれると必要台数が実際と合わない）
    const usbPowered = (slot: TemplateSlot) =>
      (slot.powerInput ?? TEMPLATE_POWER_INPUT[slot.category]
        ?? (defaultPowerInputForCategory(slot.category, slot.pcFormFactor) === 'from_c' ? 'usb_c' : 'outlet')) === 'usb_c'
    let continuousPorts = 0
    let needsChargingSlot = false
    for (const slot of slots) {
      if (slot.category === 'Charger' || !usbPowered(slot)) continue
      const count = slot.count ?? 1
      if (defaultPowerUsageForCategory(slot.category) === 'rechargeable') needsChargingSlot = true
      else continuousPorts += count
    }
    const neededPorts = continuousPorts + (needsChargingSlot ? 1 : 0)
    const portsPerCharger = DEFAULT_CHARGER_USB_C + DEFAULT_CHARGER_USB_A
    const existing = slots.filter((s) => s.category === 'Charger').reduce((n, s) => n + (s.count ?? 1), 0)
    const needed = Math.max(1, Math.ceil(neededPorts / portsPerCharger))
    for (let i = existing; i < needed; i++) slots.push({ category: 'Charger', zone: 'desk_right' })
  }

  return { ...template, slots, wiringHints }
}

/** テンプレートの1枠を、実際に配置する1台ぶんに展開したもの（モニター×2 → 2件） */
export interface TemplateItem {
  /** 選択状態を持つためのキー（スロット位置 + 何台目か） */
  key: string
  category: GadgetCategory
  /** 表示名（カテゴリ名。同カテゴリの2台目以降は連番付き） */
  name: string
  zone?: DeskSlotZone
  powerInput?: TemplateSlot['powerInput']
  pcFormFactor?: TemplateSlot['pcFormFactor']
  monitorArmKey?: string | null
  micArmKey?: string | null
  armHolds?: number
  /** 有線／無線の接続方式。切替不可カテゴリは undefined */
  connType?: ConnType
  source?: 'template' | 'purpose' | 'extra'
  purpose?: PlanPurpose
  /** 自作ジャンルの枠。category は 'Other' で、作るガジェットにこのジャンルを付ける */
  custom?: CustomCategory
}

const explicitArmKey = (item: Pick<TemplateItem, 'category' | 'monitorArmKey' | 'micArmKey'>) =>
  item.category === 'Microphone' ? item.micArmKey : item.monitorArmKey

type DeskSlotZone = NonNullable<TemplateSlot['zone']>

/** テンプレート → 1台ずつの配置アイテムへ展開する（詳細画面の一覧と適用処理で共用） */
export function buildTemplateItems(template: DeskTemplate, lang: 'ja' | 'en'): TemplateItem[] {
  const labels = lang === 'en' ? CATEGORY_LABELS_EN : CATEGORY_LABELS
  const items: TemplateItem[] = []
  // 自作ジャンルは同じ 'Other' でもジャンルごとに数える（「フィギュア２」の連番がずれないように）
  const categoryCounts = new Map<string, number>()
  const monitorArmKeys = template.slots.flatMap((slot, si) => slot.category === 'MonitorArm'
    ? Array.from({ length: slot.count ?? 1 }, (_, i) => `${si}-${i}`) : [])
  const micArmKeys = template.slots.flatMap((slot, si) => slot.category === 'MicArm'
    ? Array.from({ length: slot.count ?? 1 }, (_, i) => `${si}-${i}`) : [])
  template.slots.forEach((slot, si) => {
    const count = slot.count ?? 1
    const base = (slot.category === 'MonitorArm' || slot.category === 'MicArm') && slot.armHolds
      ? (lang === 'ja'
          ? `${slot.armHolds === 2 ? 'デュアル' : slot.armHolds === 1 ? 'シングル' : `${slot.armHolds}${slot.category === 'MicArm' ? '本' : '台'}用`}${slot.category === 'MicArm' ? 'マイクアーム' : 'モニターアーム'}`
          : `${slot.armHolds}-${slot.category === 'MicArm' ? 'microphone' : 'monitor'} arm`)
      : slot.custom?.name ?? labels[slot.category] ?? slot.category
    const countKey = slot.custom ? `custom:${slot.custom.id}` : slot.category
    for (let i = 0; i < count; i++) {
      const categoryCount = (categoryCounts.get(countKey) ?? 0) + 1
      categoryCounts.set(countKey, categoryCount)
      const suffix = categoryCount === 1
        ? ''
        : lang === 'ja'
          ? String(categoryCount).replace(/\d/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0))
          : ` ${categoryCount}`
      items.push({
        key: `${si}-${i}`,
        category: slot.category,
        name: `${base}${suffix}`,
        zone: slot.zone,
        powerInput: slot.powerInput,
        pcFormFactor: slot.pcFormFactor,
        monitorArmKey: slot.monitorArmIndex === null ? null
          : slot.monitorArmIndex === undefined ? undefined : monitorArmKeys[slot.monitorArmIndex],
        micArmKey: slot.micArmIndex === null ? null
          : slot.micArmIndex === undefined ? undefined : micArmKeys[slot.micArmIndex],
        armHolds: slot.armHolds,
        connType: defaultConnTypeForSlot(slot.category, template.defaultConnType),
        source: 'template',
        ...(slot.custom ? { custom: slot.custom } : {}),
      })
    }
  })
  return items
}

/** 「アームに載せるか」を聞く枠か。支持先を構成で決めてある枠には聞かない */
export function asksArmSpec(item: TemplateItem): boolean {
  return !!TEMPLATE_SPEC_ARM_FOR[item.category] && explicitArmKey(item) === undefined
}

/**
 * 作成直前の「実物に合わせる」ページで聞く枠か。
 * 商品を候補から選んだ枠は口数が商品のポートで決まるので、口数だけは聞かない。
 * askArm: 作成済みのガジェットをそのまま使う枠は、アームの有無を受け口で持っていて
 * planSpecArms もそちらを見るので、ここでは聞かない
 */
export function needsTemplateSpec(item: TemplateItem, productHasPorts: boolean, askArm = true): boolean {
  if (TEMPLATE_SPEC_SPLIT_CATEGORIES.includes(item.category)) return true
  // PC の形は作成済みの機材には当てられない（askArm と同じく、作り直さない枠では聞かない）
  if (item.category === 'PC' && askArm) return true
  if (askArm && asksArmSpec(item)) return true
  return !productHasPorts && !!TEMPLATE_SPEC_COUNT_FIELDS[item.category]
}

/**
 * ページの初期値。枠が実際に持つ標準ポートから読むので、触らずに作成すれば従来と同じ図になる。
 * アームは構成に既にあるときだけ載せる扱いにする（無いのに載せると、触らない人にもアームが増える）
 */
export function defaultTemplateSpec(item: TemplateItem, defaultConnType?: ConnType, allItems: TemplateItem[] = []): TemplateSpec {
  const connType = item.connType ?? defaultConnTypeForSlot(item.category, defaultConnType)
  const spec = readTemplateSpecCounts(item.category, placeholderPortsForTemplate(item.category, connType))
  if (item.category === 'Speaker') return { ...spec, stereoPair: false, speakerInputSide: 'R', hasSubwoofer: false }
  if (item.category === 'Keyboard') return { ...spec, splitKeyboard: false }
  if (item.category === 'PC') return { ...spec, pcFormFactor: item.pcFormFactor ?? 'desktop' }
  const armType = TEMPLATE_SPEC_ARM_FOR[item.category]
  if (armType) return {
    ...spec,
    onArm: explicitArmKey(item) !== undefined
      ? explicitArmKey(item) !== null
      : allItems.some((other) => other.category === armType),
  }
  return spec
}

/** 「アームに載せる」の答えに合わせてアームの枠を足し、支える台数を答えに含める */
export function withSpecArms(
  items: TemplateItem[],
  specs: Record<string, TemplateSpec>,
  lang: 'ja' | 'en',
  /** 枠 → 割り当てた持ち物（planSpecArms の説明） */
  owned: Record<string, Gadget> = {},
): { items: TemplateItem[]; specs: Record<string, TemplateSpec> } {
  const labels = lang === 'en' ? CATEGORY_LABELS_EN : CATEGORY_LABELS
  const nextItems = [...items]
  const nextSpecs = { ...specs }
  for (const plan of planSpecArms(items.filter((item) => explicitArmKey(item) === undefined), specs, owned)) {
    const key = plan.existingKey ?? `spec-arm-${plan.armCategory}`
    if (!plan.existingKey) {
      nextItems.push({
        key,
        category: plan.armCategory,
        name: labels[plan.armCategory] ?? plan.armCategory,
        zone: plan.armCategory === 'MonitorArm' ? 'back_center' : 'desk_right',
        source: 'template',
      })
    }
    nextSpecs[key] = { ...nextSpecs[key], armHolds: plan.holds }
  }
  return { items: nextItems, specs: nextSpecs }
}

export interface ApplyTemplateDeps {
  /** useGadgets().addMany（テンプレートのガジェットはまとめて入る） */
  addGadgets: (gadgets: Gadget[]) => Promise<unknown>
  /** usePlans().add */
  addPlan: (p: DeskPlan) => Promise<unknown>
  /** 編集時は作成済みデスクの ID を使う */
  planId?: string
  /** 既存の全ガジェット（選択済みガジェットの解決に使う） */
  existingGadgets: Gadget[]
  /** 展開済みのアイテム一覧（詳細画面が表示しているものと同じ） */
  items: TemplateItem[]
  /** アイテムキー → 既に登録済みガジェットの id。選ばれたものは新規登録しない */
  selections: Record<string, string | undefined>
  /**
   * アイテムキー → 下書きで入力した商品。商品名が入っている枠は枠（isPlaceholder）ではなく
   * 実商品として作る。商品名が空で金額・導入日だけの枠は、枠のままその値を持たせる
   * （あとで ProductFill などで商品名を入れても、金額・導入日は applyProductToGadget が残す）
   */
  products?: Record<string, TemplateProductEntry>
  /**
   * アイテムキー → 作成直前に聞いた口数・左右分割・アーム。商品を反映した後に当てる
   * （アームの受け口は商品のポートに無いため）。口数は商品のポートがある枠には聞かないので衝突しない
   */
  specs?: Record<string, TemplateSpec>
  /** 利用できる壁コンセントの口数。0 = なし */
  outletCount: number
  /** 利用目的（未指定ならテンプレートの既定） */
  purposes?: PlanPurpose[]
  /** 用途「その他」にユーザーが付けた呼び名 */
  otherPurposeLabel?: string
  /** 用途「その他」に選んだアイコン */
  otherPurposeIcon?: string
  otherPurposeColor?: string
  /**
   * デスク名。作成画面は用途から作った名前（autoDeskName）を渡す。
   * 省くとテンプレート名になるが、それは作り方の名前でデスクの名前ではない
   */
  name?: string
  registerAsOwned?: boolean
  /** 商品名を入れた新規機材の空欄にだけ適用する、ユーザーが選んだ導入日 */
  defaultPurchasedAt?: string
  lang: 'ja' | 'en'
}

/** 作成の「機材」の段で枠に入れた商品。金額と日付は商品名の下の欄から来る */
export interface TemplateProductEntry {
  name: string
  suggestion?: ProductSuggestion
  /**
   * 欄の金額（円）。null は「空欄にした」。欄には選んだ商品の参考価格が先に入るので、
   * 消した人に参考価格を入れ直さない。undefined は欄を持たない呼び出し（候補の価格を使う）
   */
  price?: number | null
  /** 欄の日付（YYYY-MM-DD）。空欄なら未設定 */
  purchasedAt?: string
}

/**
 * 作成済みのデスクの機材の段を開き直したときの「所有機材として登録」の初期値。
 * 作成を始めたボタン（intent）はデスクに残らないので、applyTemplate が枠にも付けた
 * isCandidate から読み戻す。intent を見ると、配置の段や「作成を続ける」から戻るたびにオフに戻り、
 * 手持ちを整理している人が足した機材が黙って候補になっていた
 */
export function deskRegistersAsOwned(
  plan: Pick<DeskPlan, 'selectedGadgetIds'>,
  gadgets: readonly Pick<Gadget, 'id' | 'isCandidate'>[],
): boolean {
  const deskIds = new Set(plan.selectedGadgetIds)
  return gadgets.some((gadget) => deskIds.has(gadget.id) && !gadget.isCandidate)
}

/**
 * テンプレートの枠1つぶんの新しいガジェット。applyTemplate と、作成前に枠を機材にして
 * 編集画面で設定したいとき（TemplateDetailScreen）が同じ形で作る
 */
export function buildTemplateItemGadget(
  template: Pick<DeskTemplate, 'defaultConnType'>,
  item: TemplateItem,
  items: readonly TemplateItem[],
  options: {
    product?: TemplateProductEntry
    spec?: TemplateSpec
    registerAsOwned?: boolean
    defaultPurchasedAt?: string
    now: string
  },
): Gadget {
  const connType = item.connType ?? defaultConnTypeForSlot(item.category, template.defaultConnType)
  // USB 受電を既定にしてよいのは、挿す先（充電器・モバイルバッテリー）がある構成だけ
  const hasUsbPowerSource = items.some(
    (other) => other.category === 'Charger' || other.category === 'MobileBattery',
  )
  const basePorts = placeholderPortsForTemplate(item.category, connType)
  const gadget: Gadget = {
    id: uuidv4(),
    name: item.name,
    category: item.category,
    customCategory: item.category === 'Other' ? item.custom : undefined,
    ports: applyPowerInput(basePorts, item.powerInput, item.category, item.pcFormFactor, hasUsbPowerSource)
      .map((p) => ({ ...p })),
    pcFormFactor: item.pcFormFactor,
    // バッテリー内蔵のガジェットは充電時だけ給電ポートを使う（常時1口を占有させない）
    powerUsage: defaultPowerUsageForCategory(item.category),
    isPlaceholder: true,
    isCandidate: options.registerAsOwned ? undefined : true,
    introducedAtUnknown: true,
    createdAt: options.now,
  }
  const product = options.product
  // 商品名が入っている枠はここで実商品にする。ポート・購入リンク・価格は候補から引き継ぐ
  const withProduct = product ? applyProductToGadget(gadget, product) : gadget
  // 「今日」は商品名を入れた機材にだけ当てる。名前の無い枠はまだ手元に無いことが多く、
  // 今日の日付を付けると買ってもいない機材の導入履歴がまとめてできる
  const purchasedAt = product?.purchasedAt ?? (product?.name ? options.defaultPurchasedAt : undefined)
  const withPurchase: Gadget = product
    ? {
        ...withProduct,
        ...(product.price !== undefined ? { price: product.price ?? undefined } : {}),
        purchasedAt,
        introducedAtUnknown: purchasedAt ? undefined : true,
      }
    : withProduct
  return applyTemplateSpec(withPurchase, {
    ...options.spec,
    ...(item.armHolds !== undefined ? { armHolds: item.armHolds } : {}),
    ...(explicitArmKey(item) != null ? { onArm: true } : {}),
  })
}

/**
 * テンプレートを適用して新しいデスク（プラン）を作成する。
 * ・ユーザーが既存ガジェットを選んだ枠 → そのガジェットをそのまま使う（ライブラリに追加しない）
 * ・選ばなかった枠 → カテゴリだけの未選択ガジェット（isPlaceholder）を作ってライブラリへ追加する
 * 配線は配置確認後に生成するため、ここではガジェットとプランの下書きだけを保存する。
 * @returns 作成したプランの id
 */
export async function applyTemplate(template: DeskTemplate, deps: ApplyTemplateDeps): Promise<string> {
  const now = new Date().toISOString()
  const byId = new Map(deps.existingGadgets.map((g) => [g.id, g]))

  const newGadgets: Gadget[] = []
  const placements: GadgetPlacement[] = []
  const selectedIds: string[] = []
  const idsByKey = new Map<string, string>()
  // 有線指定した枠のガジェットIDを集める（BT対応でも有線接続を強制する wiredOverrides 用）
  const wiredGadgetIds: string[] = []

  for (const item of deps.items) {
    const connType = item.connType ?? defaultConnTypeForSlot(item.category, template.defaultConnType)
    const chosenId = deps.selections[item.key]
    const chosen = chosenId ? byId.get(chosenId) : undefined
    if (chosen) {
      idsByKey.set(item.key, chosen.id)
      // 既に登録済みのガジェットを使う。同じ1台を2枠に割り当てても重複させない
      if (!selectedIds.includes(chosen.id)) selectedIds.push(chosen.id)
      if (item.zone) placements.push({ gadgetId: chosen.id, zone: item.zone })
      if (connType === 'wired') wiredGadgetIds.push(chosen.id)
      continue
    }
    const gadget = buildTemplateItemGadget(template, item, deps.items, {
      product: deps.products?.[item.key],
      spec: deps.specs?.[item.key],
      registerAsOwned: deps.registerAsOwned,
      defaultPurchasedAt: deps.defaultPurchasedAt,
      now,
    })
    newGadgets.push(gadget)
    idsByKey.set(item.key, gadget.id)
    selectedIds.push(gadget.id)
    if (item.zone) placements.push({ gadgetId: gadget.id, zone: item.zone })
    if (connType === 'wired') wiredGadgetIds.push(gadget.id)
  }
  await deps.addGadgets(newGadgets)

  const plan: DeskPlan = {
    id: deps.planId ?? uuidv4(),
    name: trimAndTruncate(deps.name ?? (deps.lang === 'en' ? template.nameEn : template.nameJa), 30),
    goal: 'first_setup',
    purposes: deps.purposes ?? template.purposes,
    otherPurposeLabel: deps.otherPurposeLabel,
    otherPurposeIcon: deps.otherPurposeIcon,
    otherPurposeColor: deps.otherPurposeColor,
    templateId: template.id,
    selectedGadgetIds: selectedIds,
    monitorArmAssignments: Object.fromEntries(deps.items.flatMap((item) => {
      const id = idsByKey.get(item.key)
      if (!id || item.monitorArmKey === undefined) return []
      return [[id, item.monitorArmKey === null ? null : idsByKey.get(item.monitorArmKey) ?? null]]
    })),
    micArmAssignments: Object.fromEntries(deps.items.flatMap((item) => {
      const id = idsByKey.get(item.key)
      if (!id || item.micArmKey === undefined) return []
      return [[id, item.micArmKey === null ? null : idsByKey.get(item.micArmKey) ?? null]]
    })),
    // 有線指定の Keyboard/Mouse のみ有線を強制する（無線指定は Bluetooth ポートで無線接続になる）
    wiredOverrides: wiredGadgetIds.filter((id) => {
      const g = newGadgets.find((x) => x.id === id) ?? byId.get(id)
      return g?.category === 'Keyboard' || g?.category === 'Mouse'
    }),
    placements,
    outletCount: deps.outletCount,
    outletCountVersion: 2,
    createdAt: now,
    updatedAt: now,
  }
  // ケーブルはガジェット（商品）として起こさない。
  // 付属品や家にあったものを使い回すのが普通で、それを1商品としてマイガジェットに
  // 並べるとノイズにしかならない。線は配線図が自動で引き、本数は requiredCables が持つ。
  // こだわって買った1本（コイルケーブル等）だけ、ユーザーが自分で商品登録する。
  await deps.addPlan({
    ...plan,
    selectedGadgetIds: selectedIds,
  })
  return plan.id
}
