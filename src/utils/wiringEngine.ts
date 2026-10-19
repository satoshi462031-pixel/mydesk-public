import {
  CableType,
  Connection,
  DeskPlan,
  Gadget,
  GadgetCategory,
  MapConnection,
  Port,
  PortType,
  RequiredCable,
  WiringSuggestion,
  WiringResult,
} from '../types'
import { DATA_BEARING_LABEL, hasPowerDeliveryLabel, isHeadphoneOutputPort, isPowerFeedPort, isReceiverPort, isWiredPort, POWER_SUPPLY_LABEL } from './portRoles'
import {
  DISPLAY_PORT_PRIORITY,
  PORT_COMPATIBILITY,
  UPSTREAM_PORT_PRIORITY,
  cableSortRank,
  determineCableType,
  requiresPhysicalCable,
} from '../constants/portTypes'
import { BUILT_IN_OUTLET_CATEGORIES, isWirelessPowerPort, UsbPowerPortSlot, usbPowerPortSlots } from './gadgetPorts'
import { applyMonitorArmAssignment, isStylusAccessory } from './gadgetAttachments'

// コンセント（壁）の擬似ノードID。connectionMapLayout の WALL_ID と同じ値だが、
// あちらがこのファイルを import しているため、循環参照を避けてここで持つ
const WALL_SOURCE_ID = 'wall'

// 同じ種類・方向でも映像対応などの能力が違うため、残数は登録された口ごとに持つ。
type PortUsageMap = Map<string, { port: Port; remaining: number }[]>

function buildPortUsageMap(gadgets: Gadget[]): PortUsageMap {
  const map: PortUsageMap = new Map()
  for (const g of gadgets) {
    map.set(g.id, g.ports.map((port) => ({ port, remaining: port.count })))
  }
  return map
}

// 指定方向で使える残数。bidirectionalポートはinput/output両方の要求から使える
function getRemaining(usage: PortUsageMap, gadgetId: string, portType: PortType, direction: Port['direction'], filter?: (port: Port) => boolean): number {
  return (usage.get(gadgetId) ?? []).reduce((sum, { port, remaining }) =>
    port.type === portType && (port.direction === direction || port.direction === 'bidirectional')
      && (!filter || filter(port)) ? sum + remaining : sum, 0)
}

function consumePort(usage: PortUsageMap, gadgetId: string, portType: PortType, direction: Port['direction'], filter?: (port: Port) => boolean): Port | undefined {
  const available = (usage.get(gadgetId) ?? []).filter(({ port, remaining }) =>
    remaining > 0 && port.type === portType && (!filter || filter(port)))
  const slot = available.find(({ port }) => port.direction === direction)
    ?? available.find(({ port }) => port.direction === 'bidirectional')
  if (!slot) return undefined
  slot.remaining--
  return slot.port
}

/**
 * 映像が通りうる端子。
 * USB-A / USB-B は種別として映像を通さないので、supportsVideo が未設定というだけで
 * 映像入力の候補にしてはいけない（実際、ゲーム機の USB-C 出力がモニターの
 * USB-B アップストリーム端子へ「映像入力」として繋がっていた）。
 * USB-C / Thunderbolt は端子だけでは映像対応を保証できないため、
 * supportsVideo が明示された口だけを映像候補にする。
 */
const VIDEO_CAPABLE_PORT_TYPES: PortType[] = [
  'HDMI', 'DisplayPort', 'MiniDisplayPort', 'DVI', 'VGA', 'USB_C', 'Thunderbolt',
]

const portCarriesVideo = (port: Port): boolean =>
  VIDEO_CAPABLE_PORT_TYPES.includes(port.type) &&
  ((port.type !== 'USB_C' && port.type !== 'Thunderbolt') || port.supportsVideo === true)

function findAvailablePort(
  usage: PortUsageMap,
  gadget: Gadget,
  candidateTypes: PortType[],
  direction: Port['direction'],
  videoOnly = false,
  portFilter?: (port: Port) => boolean,
): PortType | null {
  for (const type of candidateTypes) {
    const remaining = getRemaining(usage, gadget.id, type, direction,
      (p) =>
        p.type === type &&
        (p.direction === direction || p.direction === 'bidirectional') &&
        (!videoOnly || portCarriesVideo(p)) &&
        (!portFilter || portFilter(p))
    )
    if (remaining > 0) return type
  }
  return null
}

/**
 * 給電専用の入力ポートか（データ接続の相手として使ってはいけない）。
 * プリセットには「PC接続 / 充電」「充電・データ」のように給電と兼用のラベルが多いため、
 * 充電を示す語だけがあり、データ・映像・有線接続を示す語が無いものに限る。
 */
const isChargingOnlyPort = (port: Port) => {
  const label = port.label ?? ''
  if (!POWER_SUPPLY_LABEL.test(label)) return false
  if (port.supportsVideo) return false
  // 語彙は gadgetPorts の DATA_BEARING_LABEL と揃える。片方にだけ語があると、
  // その語を持つ口がどちらの判定からも漏れる
  return !DATA_BEARING_LABEL.test(label)
}

/**
 * 有線データ接続を自動では引かないカテゴリ。
 * 身につけて持ち歩くガジェットは、デスクでは充電と Bluetooth でしか繋がない。
 * USB 端子は「充電・データ」兼用でも実際は充電にしか使わないため、
 * ここに入れて充電線（ステップ4）だけを引く。タブレットはサブディスプレイや
 * ファイル転送で PC と有線接続するので含めない。
 */
const CHARGE_ONLY_CATEGORIES: GadgetCategory[] = ['Smartphone', 'Smartwatch', 'MobileBattery']

/**
 * ガジェット側の入力端子を駆動できるホスト側の出力端子。
 * PORT_COMPATIBILITY は「出力 → 繋げる入力」の向きの表なので、入力側のキーでそのまま引くと
 * 逆向きの組み合わせが混ざる。実際、USB-C 入力しか持たない iPad へハブの HDMI 出力から
 * 「HDMIケーブル」で線が引かれていた（HDMI 出力の行に USB_C が無いので逆は成立しない）。
 * 表を逆引きして「その入力へ挿せる出力」だけを残す。
 * 並びは変換の要らない同一端子を先頭に、以降は表の宣言順（帯域の高い順）で、
 * findAvailablePort の優先順位を兼ねる。
 */
const UPSTREAM_TYPES: Partial<Record<PortType, PortType[]>> = (() => {
  const reverse: Partial<Record<PortType, PortType[]>> = {}
  for (const [outType, inTypes] of Object.entries(PORT_COMPATIBILITY) as [PortType, PortType[]][]) {
    for (const inType of inTypes) {
      const list = reverse[inType] ?? (reverse[inType] = [])
      if (!list.includes(outType)) list.push(outType)
    }
  }
  for (const [inType, list] of Object.entries(reverse) as [PortType, PortType[]][]) {
    reverse[inType] = [...list.filter((t) => t === inType), ...list.filter((t) => t !== inType)]
  }
  return reverse
})()
const USB_HOST_OUTPUTS: PortType[] = ['USB_C', 'USB_A', 'Thunderbolt']
const upstreamTypesFor = (inPort: PortType): PortType[] =>
  inPort === 'microUSB' || inPort === 'Lightning'
    ? USB_HOST_OUTPUTS
    : (UPSTREAM_TYPES[inPort] ?? [inPort])
const REQUIRES_INPUT_HOST = new Set<GadgetCategory>(['Mouse', 'Keyboard', 'PenTablet', 'Webcam', 'Controller'])

/** タブレットがハブ・ドックの上流（USB ホスト）になるときに使う端子。先に見るものから */
const TABLET_HOST_PORT_TYPES: PortType[] = ['Thunderbolt', 'USB_C', 'Lightning']

/** Bluetooth の親になる機材。周辺機器として Bluetooth の線を受ける側にはしない */
const BLUETOOTH_HOST_CATEGORIES = new Set<GadgetCategory>(['Smartphone', 'Tablet'])

/**
 * PC が無くてもそれ自体で使える機材。USB のデータ端子を持っていても、つなぐ PC が1台も
 * 無いデスクでは「ポートが不足」ではなく、繋がないのが正しい（充電・電源はステップ4で引く）
 */
const STANDALONE_WITHOUT_HOST = new Set<GadgetCategory>(['Tablet', 'StreamingDevice', 'Camera', 'Mixer', 'Instrument'])

// USB で繋ぐとき、モニターの USB 口を PC より後に回す機器（理由は使う側のコメント）
const NO_MONITOR_HUB_CATEGORIES = new Set<GadgetCategory>([
  'AudioInterface', 'Mixer', 'Instrument', 'Microphone', 'HeadphoneAmp', 'Amplifier', 'CaptureDevice', 'VRGlass',
])

/**
 * 「両端が同じ端子なら変換せずに繋ぐ」を適用する映像端子（高画質順）。
 * アナログの VGA と旧世代の DVI は入れない。同端子で繋げるからといって
 * VGA 同士を選ぶと、DP→HDMI の変換より画質が落ちてしまう。
 */
const SAME_TYPE_VIDEO_PRIORITY: PortType[] = [
  'Thunderbolt',
  'DisplayPort',
  'MiniDisplayPort',
  'HDMI',
  'USB_C',
]

/** PCは形状に合う一般的な映像端子を先に使い、変換やUSB-C映像はその後に回す。 */
const videoPortPriorityFor = (source: Gadget, fallback: PortType[]): PortType[] => {
  if (source.category !== 'PC') return fallback
  const preferred: PortType[] = source.pcFormFactor === 'laptop' || source.pcFormFactor === 'mini'
    ? ['HDMI', 'DisplayPort']
    : ['DisplayPort', 'HDMI']
  return [...preferred, ...fallback.filter((type) => !preferred.includes(type))]
}

/**
 * その接続に実物のケーブルが要らないか。**必要本数（requiredCables）と
 * つなぎ方の一覧が同じ判定を使うための唯一の実装。** 画面側で書き直さないこと。
 *
 * cables.md の「ケーブルが要らない接続 — 2階建て」がここに集約されている。
 *   1. 種別で決まるもの（NO_CABLE_PORT_TYPES）
 *   2. 口ごとに決まるもの（Port.directAttach。2.4GHzレシーバー・USBメモリ等）
 * さらに 6.3mm 出力へ 3.5mm のヘッドホンを挿す変換プラグも数えない
 * （ケーブル自体はヘッドホンに付属している。スピーカーなら本当にケーブルが要るので数える）。
 *
 * portType が分からない接続（手で引いた線は口を持たない）は 2 を判定できないので、
 * ケーブルが要る側に倒す。ユーザーが自分で引いた線を黙って一覧から消すよりはよい。
 */
export function isNoCableConnection(
  gadgets: readonly Gadget[],
  conn: {
    fromGadgetId: string
    toGadgetId: string
    cableType: CableType
    fromPortType?: PortType
    toPortType?: PortType
  },
): boolean {
  if (!requiresPhysicalCable(conn.cableType)) return true
  const byId = new Map(gadgets.map((g) => [g.id, g]))
  const isDirectAttachEnd = (gadgetId: string, portType?: PortType): boolean =>
    !!portType && (byId.get(gadgetId)?.ports.some((p) => p.type === portType && p.directAttach) ?? false)
  if (isDirectAttachEnd(conn.fromGadgetId, conn.fromPortType)) return true
  if (isDirectAttachEnd(conn.toGadgetId, conn.toPortType)) return true
  const toCategory = byId.get(conn.toGadgetId)?.category
  return conn.cableType === 'Audio3_5_to_6_3' && (toCategory === 'Headphone' || toCategory === 'Earphone')
}

/**
 * つなぎ方の1行 ＝ 物理ケーブル1本。
 *
 * 2in1・3in1 として束ねた枝は1本なので1行にまとめる。まとめないと、1本の
 * ケーブルに違う商品を2つ割り当てられてしまう（必要本数の集計とも食い違う）。
 * 口の種類は wiringResult から引き当てる（MapConnection は口を持たない）。
 */
export function cabledConnectionGroups(gadgets: readonly Gadget[], plan: DeskPlan): MapConnection[][] {
  const portTypes = new Map<string, { fromPortType: PortType; toPortType: PortType }>()
  for (const c of plan.wiringResult?.connections ?? []) {
    portTypes.set(`${c.fromGadgetId}|${c.toGadgetId}|${c.cableType}`, {
      fromPortType: c.fromPortType,
      toPortType: c.toPortType,
    })
  }
  const groups = new Map<string, MapConnection[]>()
  for (const c of plan.connectionMap?.connections ?? []) {
    if (c.wireless) continue
    const ports = portTypes.get(`${c.fromGadgetId}|${c.toGadgetId}|${c.cableType}`)
    if (isNoCableConnection(gadgets, { ...c, ...ports })) continue
    const key = c.branchGroupId ? `branch:${c.branchGroupId}` : `conn:${c.id}`
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  // 並びは必要なケーブルの一覧と同じにする（常時つなぐ線 → 充電のときだけ挿す線、それぞれ種類の順）。
  // 保存された線の順のままだと、同じケーブルが2つの一覧で別の位置に出ていた。
  // 同じ種類の中は保存された順（sort は安定）
  const rank = (group: MapConnection[]) =>
    (group[0].chargingOnly === true ? CHARGING_ONLY_RANK_OFFSET : 0) + cableSortRank(group[0].cableType)
  return [...groups.values()].sort((a, b) => rank(a) - rank(b))
}
// 充電のときだけ挿す線を、どの種類の常時の線よりも後ろへ送るための下駄
const CHARGING_ONLY_RANK_OFFSET = 10_000

// =============================
// メインのエントリポイント
// =============================
export function generateWiring(allGadgets: Gadget[], plan: DeskPlan, lang: 'ja' | 'en' = 'ja'): WiringResult {
  // 飾り（displayOnly）は通電も配線もしないので、配線の対象から外す。
  // 配線図のノード自体は別経路（computeMapLayout）で描かれるため、線だけが引かれなくなる
  //
  // 並びは allGadgets の配列順に任せず、登録が古い順に固定する。
  // 各ステップは残ポートを先着順に消費していくので、配列順に任せると
  // 呼び出し元ごとに違う結果になり（マイガジェットは createdAt 降順、テンプレート適用は
  // 既存＋新規の連結、公開デスクは DB の順）、ガジェットを1台足して並びがずれただけで
  // 無関係なガジェットの挿し口・ケーブル種別まで入れ替わっていた。配線図のペアキーは
  // ケーブル種別を含むため、入れ替わると確定状態や「破棄」の記録もキーごと外れて失われる。
  // 古い順に固定すれば、後から足したガジェットが既に割り当て済みの口を奪うことはない。
  // 同着（テンプレート適用・共有デスクの取り込みは、その回の全ガジェットへ同じ createdAt を
  // 入れる）はデスクへ入れた順で割る。ここを id で割ると UUID の並びという無意味な順序に
  // なり、テンプレートの意図した並びが毎回崩れる
  const selectionIndex = new Map(plan.selectedGadgetIds.map((id, index) => [id, index]))
  const wiringOrder = (a: Gadget, b: Gadget) =>
    (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    || (selectionIndex.get(a.id) ?? 0) - (selectionIndex.get(b.id) ?? 0)
    || a.id.localeCompare(b.id)
  const planGadgets = allGadgets
    .filter((g) => selectionIndex.has(g.id) && !g.displayOnly)
    .map((g) => applyMonitorArmAssignment(g, plan))
    .sort(wiringOrder)
  const selected = planGadgets.filter((g) => g.category !== 'Cable')
  const selectedById = new Map(selected.map((gadget) => [gadget.id, gadget]))
  const usage = buildPortUsageMap(selected)
  const wiredOverrides = plan.wiredOverrides ?? []
  const dismissedPairs = new Set(plan.connectionMap?.dismissedPairs ?? [])
  const isDismissed = (fromId: string, toId: string, cableType: CableType) =>
    dismissedPairs.has([fromId, toId].sort().join('~') + '|' + cableType)
  const isSmartHomeGadget = (g: Gadget) => g.category === 'SmartHome'

  // 前回このガジェットがどの給電元のどの口に挿さっていたか。
  // 配線図のペアキーはケーブル種別を含む（USB-C の口と USB-A の口では種別が変わる）ため、
  // ガジェットを1台足し引きしただけで口が入れ替わると、確定状態や「破棄」の記録が
  // キーから外れて失われる。前回と同じ口を優先して割り当ててこれを防ぐ。
  const savedChargeKey = (targetId: string, sourceId: string) => `${targetId}|${sourceId}`
  const savedChargePortId = new Map<string, string>()
  for (const saved of plan.connectionMap?.connections ?? []) {
    if (!saved.sourcePortId) continue
    savedChargePortId.set(savedChargeKey(saved.toGadgetId, saved.fromGadgetId), saved.sourcePortId)
  }

  // 同じ2台を同じ種別で複数本繋ぐ宣言（配線図の count。ステレオの L/R・デュアル電源）。
  // 以前は必要本数の集計でしか読んでおらず、口は1本ぶんしか消費していなかった。
  // デュアル電源の PC とモニターを2口タップに挿すと実際は3口要るのに、足りている扱いになっていた
  const declaredCountByPair = new Map<string, number>()
  // コンセント・タップから複数口取る宣言。宣言した給電元を優先するため、受電側で引く
  const declaredAcSource = new Map<string, { sourceId: string; cableType: CableType; count: number }>()
  for (const saved of plan.connectionMap?.connections ?? []) {
    // ウーファーをOFFにした直後は、前回の自動追加分をユーザー指定の本数として引き継がない
    const count = saved.countSource === 'subwoofer' && !selectedById.get(saved.toGadgetId)?.hasSubwoofer
      ? 1
      : saved.count ?? 1
    if (count <= 1 || saved.wireless || !requiresPhysicalCable(saved.cableType)) continue
    declaredCountByPair.set([saved.fromGadgetId, saved.toGadgetId].sort().join('~') + '|' + saved.cableType, count)
    if (saved.cableType === 'Power' || saved.cableType === 'DCPower') {
      declaredAcSource.set(saved.toGadgetId, { sourceId: saved.fromGadgetId, cableType: saved.cableType, count })
    }
  }
  const declaredCountOf = (a: string, b: string, cableType: CableType) => {
    const saved = declaredCountByPair.get([a, b].sort().join('~') + '|' + cableType) ?? 1
    // 独立ウーファーはスピーカー本体とは別に1口を使う。音声入力の本数には影響させない
    const derived = (cableType === 'Power' || cableType === 'DCPower') && selectedById.get(b)?.hasSubwoofer
      ? 2
      : 1
    return Math.max(saved, derived)
  }

  const connections: Connection[] = []
  const warnings: string[] = []
  // 同じ種類の不足は1件にまとめる。モニター3枚が同時に給電できないとき
  // 「電源タップを追加」を3回並べても、やることは1つしかない
  const suggestionMap = new Map<string, WiringSuggestion>()
  const suggest = (category: GadgetCategory, reason: WiringSuggestion['reason'], gadgetId?: string) => {
    const key = `${category}|${reason}`
    const existing = suggestionMap.get(key)
    if (!existing) {
      suggestionMap.set(key, { category, reason, gadgetIds: gadgetId ? [gadgetId] : [] })
      return
    }
    if (gadgetId && !existing.gadgetIds.includes(gadgetId)) existing.gadgetIds.push(gadgetId)
  }
  const poweredByDataCable = new Set<string>()

  // ガジェットをカテゴリで分類
  const computers = selected.filter((g) => g.category === 'PC')
  const monitors = selected.filter((g) => g.category === 'Monitor' || g.category === 'TV' || g.category === 'Projector')
  const tabletDisplays = selected.filter((g) =>
    g.category === 'Tablet' &&
    g.ports.some((p) => p.supportsVideo === true && (p.direction === 'input' || p.direction === 'bidirectional')),
  )
  const tabletVideoSources = selected.filter((g) =>
    g.category === 'Tablet' &&
    g.ports.some((p) => p.supportsVideo === true && (p.direction === 'output' || p.direction === 'bidirectional')),
  )
  // 液タブ（Cintiq / Artist 等）は HDMI・DP・USB-C で映像を受け取るので、
  // モニターと同じく映像の送り先として扱う。板タブ（映像入力なし）は対象外
  const penDisplays = selected.filter((g) =>
    g.category === 'PenTablet' &&
    g.ports.some((p) => p.supportsVideo === true && (p.direction === 'input' || p.direction === 'bidirectional')),
  )
  const displayTargets = [...monitors, ...tabletDisplays, ...penDisplays]
  const gameConsoles = selected.filter((g) => g.category === 'GameConsole')
  const videoAppliances = [...gameConsoles, ...selected.filter((g) => g.category === 'StreamingDevice')]
  const captureDevices = selected.filter((g) => g.category === 'CaptureDevice')
  const cameras = selected.filter((g) => g.category === 'Camera')
  const kvms = selected.filter((g) => g.category === 'KVM')
  // ゲーム機のドックは、その本体専用の映像・USB の出口であってデスク全体のハブではない。
  // デスクのハブとして扱うと、モニターの映像ソースが PC ではなくドックになり、
  // PC が2枚目のモニターを持てなくなる（キーボードやスマホの充電先にもされてしまう）。
  const isConsoleDock = (g: Gadget) =>
    g.category === 'Dock' && /Switch/i.test(`${g.name} ${g.model ?? ''}`)
  const isSwitchConsole = (g: Gadget) =>
    g.category === 'GameConsole' && /Switch/i.test(`${g.name} ${g.model ?? ''}`)
  const upstreamDevices = selected
    .filter((g) => g.category === 'Dock' || g.category === 'Hub')
    .sort((a, b) => Number(a.category === 'Hub') - Number(b.category === 'Hub'))
  const primaryHub = upstreamDevices.find((g) => !isConsoleDock(g))
  const hasUsbOutput = (g: Gadget) => g.ports.some((p) =>
    (p.type === 'USB_A' || p.type === 'USB_C') &&
    (p.direction === 'output' || p.direction === 'bidirectional'),
  )
  const peripherals = selected.filter(
    (g) =>
      g.category !== 'Dock' &&
      g.category !== 'Hub' &&
      g.category !== 'PC' &&
      g.category !== 'Monitor' &&
      g.category !== 'TV' &&
      g.category !== 'Projector'
  )

  let connIndex = 0
  const videoConnectionIds = new Set<string>()
  const addConn = (
    from: Gadget,
    fromPort: PortType,
    to: Gadget,
    toPort: PortType,
    mode?: 'video' | 'upstream',
  ) => {
    const cableType = determineCableType(fromPort, toPort)
    if (isDismissed(from.id, to.id, cableType)) return false
    const sourceFilter = mode === 'video' || (mode === 'upstream' && findAvailablePort(usage, from, [fromPort], 'output', true))
      ? portCarriesVideo : undefined
    const targetFilter = mode === 'video' ? portCarriesVideo : undefined
    if (mode === 'video' && (!findAvailablePort(usage, from, [fromPort], 'output', true)
      || !findAvailablePort(usage, to, [toPort], 'input', true))) return false
    const usedSource = consumePort(usage, from.id, fromPort, 'output', sourceFilter)
    consumePort(usage, to.id, toPort, 'input', targetFilter)
    // 複数本の宣言（ステレオの L/R 等）は2本目以降の口も押さえる。空いているぶんだけで、
    // 足りなくても警告しない：左右ペアを1台として入力1口で登録する人がいて、誤報になる
    for (let extra = declaredCountOf(from.id, to.id, cableType) - 1; extra > 0; extra--) {
      if (!consumePort(usage, from.id, fromPort, 'output', sourceFilter)) break
      consumePort(usage, to.id, toPort, 'input', targetFilter)
    }
    connections.push({
      id: `conn-${connIndex++}`,
      fromGadgetId: from.id,
      fromPortType: fromPort,
      toGadgetId: to.id,
      toPortType: toPort,
      cableType,
    })
    if (mode === 'video' || (mode === 'upstream' && usedSource && portCarriesVideo(usedSource)
      && (toPort === 'USB_C' || toPort === 'Thunderbolt'))) {
      videoConnectionIds.add(connections[connections.length - 1].id)
    }
    if ((to.category === 'Mouse' || to.category === 'Keyboard') && toPort === 'USB_C') {
      poweredByDataCable.add(to.id)
    }
    return true
  }

  // PC の無いデスクで、タブレットの USB-C（充電の口として入力で登録されている）を USB ホストとして使う線。
  // addConn は出力の口を消費するので、ここでは入力の口を消費する
  const tabletHostPortFor = (tablet: Gadget, accepts: (type: PortType) => boolean): PortType | undefined =>
    TABLET_HOST_PORT_TYPES.find((type) => accepts(type) && !!findAvailablePort(usage, tablet, [type], 'input'))
  const addTabletHostConn = (tablet: Gadget, hostType: PortType, to: Gadget, toPort: PortType): boolean => {
    const cableType = determineCableType(hostType, toPort)
    if (isDismissed(tablet.id, to.id, cableType)) return false
    const usedSource = consumePort(usage, tablet.id, hostType, 'input')
    consumePort(usage, to.id, toPort, 'input')
    connections.push({
      id: `conn-${connIndex++}`,
      fromGadgetId: tablet.id,
      fromPortType: hostType,
      toGadgetId: to.id,
      toPortType: toPort,
      cableType,
    })
    if (usedSource && portCarriesVideo(usedSource) && (toPort === 'USB_C' || toPort === 'Thunderbolt')) {
      videoConnectionIds.add(connections[connections.length - 1].id)
    }
    return true
  }

  type AudioOutputRole = 'monitor' | 'headphone'
  const audioOutputRemaining = new Map<string, number>()
  for (const gadget of selected) {
    for (const port of gadget.ports) {
      if (port.direction !== 'output' && port.direction !== 'bidirectional') continue
      if (!['XLR', 'XLR4pin', 'XLR_TRS_Combo', 'Audio6_3mm', 'Audio6_3mm_TS', 'Audio4_4mm', 'RCA', 'Audio3_5mm', 'SpeakerTerminal'].includes(port.type)) continue
      audioOutputRemaining.set(`${gadget.id}|${port.id}`, port.count)
    }
  }
  const isHeadphoneOutput = (port: Port) => isHeadphoneOutputPort(port)
  const findAudioOutput = (gadget: Gadget, compatibleTypes: PortType[], role: AudioOutputRole): Port | null => {
    const available = gadget.ports.filter((port) =>
      compatibleTypes.includes(port.type) &&
      (port.direction === 'output' || port.direction === 'bidirectional') &&
      (audioOutputRemaining.get(`${gadget.id}|${port.id}`) ?? 0) > 0,
    )
    if (available.length === 0) return null
    // 選ぶ順は互換表（受け側と同じ端子が先頭）に従う。口の並び順で選ぶと、RCA が先に
    // 書かれた機種や、編集画面で保存して口が並び替わった機種で、6.3mm 同士で直結できるのに
    // RCA→6.3mm の変換ケーブルになっていた。役割（モニター用にヘッドホン出力を使わない）は
    // 端子の一致より優先する
    const byCompatibility = (ports: Port[]) =>
      compatibleTypes.map((type) => ports.find((port) => port.type === type)).find((port) => port !== undefined)
    const preferred = byCompatibility(available.filter((port) =>
      role === 'headphone' ? isHeadphoneOutput(port) : !isHeadphoneOutput(port)))
    return preferred ?? byCompatibility(available) ?? available[0]
  }
  const addAudioConn = (from: Gadget, fromPort: Port, to: Gadget, toPort: PortType) => {
    if (!addConn(from, fromPort.type, to, toPort)) return false
    const key = `${from.id}|${fromPort.id}`
    const remaining = audioOutputRemaining.get(key) ?? 1
    // 音声出力は口ごとの残数をこちらでも持っている。ステレオの L/R（×2）は2口ぶん減らさないと、
    // 残りの1口が別のヘッドホン・スピーカーへ割り当てられる（addConn と同じく空いているぶんだけ）
    const taken = Math.min(declaredCountOf(from.id, to.id, determineCableType(fromPort.type, toPort)), Math.max(1, remaining))
    audioOutputRemaining.set(key, remaining - taken)
    connections[connections.length - 1].sourcePortId = fromPort.id
    return true
  }

  // アームは信号ケーブルではなく、ガジェットを支える関係として専用の線種で結ぶ。
  for (const arm of selected.filter((g) => g.category === 'MonitorArm' || g.category === 'MicArm')) {
    const supportType: PortType = arm.category === 'MonitorArm' ? 'MonitorArm' : 'MicArm'
    const targetCategory: GadgetCategory = arm.category === 'MonitorArm' ? 'Monitor' : 'Microphone'
    const armAssignments = supportType === 'MonitorArm' ? plan.monitorArmAssignments : plan.micArmAssignments
    let mounted = false
    // 明示した支持先の口を先に確保し、後から追加した未指定の機材に奪わせない。
    const targets = selected.filter((g) => g.category === targetCategory).sort((a, b) =>
      Number(armAssignments?.[b.id] === arm.id) - Number(armAssignments?.[a.id] === arm.id))
    for (const target of targets) {
      const assigned = armAssignments?.[target.id]
      if (assigned !== undefined && assigned !== arm.id) continue
      if (!findAvailablePort(usage, arm, [supportType], 'output')) break
      if (!findAvailablePort(usage, target, [supportType], 'input')) continue
      if (addConn(arm, supportType, target, supportType)) mounted = true
    }
    // 支える相手がいないアームは線が1本も引かれず、警告もないまま図に浮いてしまう
    if (!mounted) {
      const targetLabel = arm.category === 'MonitorArm'
        ? (lang === 'en' ? 'monitor' : 'モニター')
        : (lang === 'en' ? 'microphone' : 'マイク')
      // 相手はいるが「アームを使用」が入っていないだけ、というのが実際にはほとんど。
      // 「モニターがありません」と言うと、モニターを登録済みのユーザーには意味が通らない
      const hasTarget = selected.some((g) => g.category === targetCategory)
      warnings.push(hasTarget
        ? (lang === 'en'
            ? `${arm.name}: Turn on "Use arm" for the ${targetLabel} you want to mount`
            : `${arm.name}: 取り付ける${targetLabel}側で「アームを使用」を有効にしてください`)
        : (lang === 'en'
            ? `${arm.name}: No ${targetLabel} to mount`
            : `${arm.name}: 取り付ける${targetLabel}がありません`))
    }
  }

  // === ステップ1: PC → ドック/ハブ（データのみ）===
  // Dock → Hub の順で各ガジェットを1本ずつ上流へ接続する。PCの空きを先に使い、
  // 空きがなければ既に接続済みのDock/Hub出力へ回すため、2台目以降も浮かない。
  const connectedUpstreamDevices: Gadget[] = []
  // 上流の線が映像を通せるドック・ハブ。デスクトップPCの USB-C（DP Alt Mode なし）から
  // 繋いだドックの HDMI/DP は何も映さないので、映像ソースにしてはいけない
  const videoLinkedUpstreamIds = new Set<string>()
  // USB-C 1本で映像・給電を受けるモニターがあるとき、ノートPCの映像の出る口をその分だけ残す。
  // ハブを先に繋ぐと口を使い切り、モニターへはハブの HDMI、充電線は挿す口が無い、という図になる。
  // ドックがあればドックが映像と給電を受け持つのが定番の形で、据置PCがあればモニターはそちらの
  // ものなので、どちらも無い「ノートPCとバスパワーのハブだけ」の構成に限る
  const isUsbCVideoPort = (port: Port) =>
    (port.type === 'USB_C' || port.type === 'Thunderbolt') && portCarriesVideo(port)
  const laptopOnlyWithoutDock = computers.length > 0 &&
    computers.every((pc) => pc.pcFormFactor === 'laptop') &&
    !upstreamDevices.some((g) => g.category === 'Dock')
  const oneCableMonitorCount = laptopOnlyWithoutDock
    ? monitors.filter((monitor) =>
        monitor.ports.some((port) => port.direction !== 'output' && isUsbCVideoPort(port))).length
    : 0
  const reservedVideoPorts = new Map<string, { types: PortType[]; count: number }>()
  let monitorsToReserve = oneCableMonitorCount
  for (const pc of computers.filter((g) => g.pcFormFactor === 'laptop')) {
    if (monitorsToReserve <= 0) break
    const videoPorts = pc.ports.filter((port) => port.direction !== 'input' && isUsbCVideoPort(port))
    const count = Math.min(monitorsToReserve, videoPorts.reduce((sum, port) => sum + (port.count ?? 1), 0))
    if (count <= 0) continue
    reservedVideoPorts.set(pc.id, { types: [...new Set(videoPorts.map((port) => port.type))], count })
    monitorsToReserve -= count
  }
  const upstreamOutPortFor = (source: Gadget): PortType | null => {
    const reserved = reservedVideoPorts.get(source.id)
    return UPSTREAM_PORT_PRIORITY.find((type) => {
      if (!findAvailablePort(usage, source, [type], 'output')) return false
      if (!reserved || !reserved.types.includes(type)) return true
      const left = reserved.types.reduce((sum, t) => sum + getRemaining(usage, source.id, t, 'output'), 0)
      return left > reserved.count
    }) ?? null
  }
  for (const target of upstreamDevices) {
    const switchConsoleSources = isConsoleDock(target) ? gameConsoles.filter(isSwitchConsole) : []
    // 映像出力を持つドックはノートPCへ画面を足すための機材。登録順で先に来たデスクトップの
    // 映像の出ない USB-C に繋ぐと、ドックの画面が1枚も映らない図になる
    const targetOutputsVideo = target.ports.some((port) => port.direction !== 'input' && portCarriesVideo(port))
    const feedsVideoUpstream = (pc: Gadget) => pc.ports.some((port) =>
      UPSTREAM_PORT_PRIORITY.includes(port.type) && port.direction !== 'input' && portCarriesVideo(port))
    const orderedComputers = targetOutputsVideo
      ? [...computers].sort((a, b) => Number(feedsVideoUpstream(b)) - Number(feedsVideoUpstream(a)))
      : computers
    const sources = [...switchConsoleSources, ...orderedComputers, ...connectedUpstreamDevices].filter((source) => source.id !== target.id)
    let connected = false
    for (const source of sources) {
      const outPort = upstreamOutPortFor(source)
      if (!outPort) continue
      const inPort = findAvailablePort(usage, target, PORT_COMPATIBILITY[outPort] ?? [outPort], 'input')
      if (!inPort) continue
      if (!addConn(source, outPort, target, inPort, 'upstream')) continue
      const linkCarriesVideo = videoConnectionIds.has(connections[connections.length - 1].id)
      if (linkCarriesVideo && (!upstreamDevices.some((hub) => hub.id === source.id) || videoLinkedUpstreamIds.has(source.id))) {
        videoLinkedUpstreamIds.add(target.id)
      }
      if (switchConsoleSources.some((console) => console.id === source.id)) poweredByDataCable.add(source.id)
      connected = true
      connectedUpstreamDevices.push(target)
      break
    }
    // PC の無いデスクでは、iPad などのタブレットがハブ・ドックの上流（USB ホスト）になる。
    // タブレットの USB-C は入力として登録されている（充電の口）ので、上の出力の探索には掛からない
    if (!connected && computers.length === 0 && !isConsoleDock(target)) {
      for (const tablet of selected.filter((g) => g.category === 'Tablet')) {
        const hostType = tabletHostPortFor(tablet, (type) =>
          !!findAvailablePort(usage, target, PORT_COMPATIBILITY[type] ?? [type], 'input'))
        if (!hostType) continue
        const inPort = findAvailablePort(usage, target, PORT_COMPATIBILITY[hostType] ?? [hostType], 'input')
        if (!inPort || !addTabletHostConn(tablet, hostType, target, inPort)) continue
        if (videoConnectionIds.has(connections[connections.length - 1].id)) {
          videoLinkedUpstreamIds.add(target.id)
        }
        connected = true
        connectedUpstreamDevices.push(target)
        break
      }
    }
    if (!connected) {
      warnings.push(lang === 'en'
        ? `${target.name}: No upstream connection is available`
        : `${target.name}: 上流へ接続できるポートがありません`)
    }
  }

  // === ステップ2: 映像ソース → モニター ===
  /**
   * 映像の出力・入力ポートの組み合わせを選ぶ。
   * 両端に共通する端子（変換なしのケーブル1本で繋がる）を先に探し、
   * 無いときだけ出力側の優先度順に変換ケーブルを選ぶ。
   * 出力側だけを優先度で決め打ちすると、HDMI 同士で繋げる相手にも
   * DP→HDMI の変換ケーブルを要求してしまい、現実の配線とかけ離れる。
   * 同端子を優先するのはデジタル端子だけにする（VGA 同士より DP→HDMI の方が良い）。
   */
  const allowsAutomaticVideoConversion = (source: Gadget, outPort: PortType, inPort: PortType): boolean => {
    if (outPort === inPort) return true
    const pair = new Set<PortType>([outPort, inPort])
    if (pair.has('MiniDisplayPort') && pair.has('DisplayPort')) return true
    if (pair.has('HDMI') && pair.has('DVI')) return true
    // USB-C/TBからの映像出力は、supportsVideo=trueがDP Alt Mode等の確認済みを表す。
    if (outPort === 'USB_C' || outPort === 'Thunderbolt') return true
    // DP↔HDMI、DP→USB-C等は方向性・アクティブ変換の要否が製品依存。
    // 出力側で明示確認した場合に限り自動提案する。
    return source.ports.some((port) =>
      port.type === outPort &&
      (port.direction === 'output' || port.direction === 'bidirectional') &&
      port.supportsDisplayConversion === true,
    )
  }

  const findVideoPair = (source: Gadget, target: Gadget, excludedOutput?: PortType): { outPort: PortType; inPort: PortType } | null => {
    if (upstreamDevices.some((hub) => hub.id === source.id) && !videoLinkedUpstreamIds.has(source.id)
      && computers.length > 0) return null
    for (const type of videoPortPriorityFor(source, SAME_TYPE_VIDEO_PRIORITY)) {
      if (type === excludedOutput) continue
      if (!findAvailablePort(usage, source, [type], 'output', true)) continue
      if (findAvailablePort(usage, target, [type], 'input', true)) return { outPort: type, inPort: type }
    }
    for (const outPort of videoPortPriorityFor(source, DISPLAY_PORT_PRIORITY)) {
      if (outPort === excludedOutput) continue
      if (!findAvailablePort(usage, source, [outPort], 'output', true)) continue
      for (const inPort of PORT_COMPATIBILITY[outPort] ?? [outPort]) {
        if (!findAvailablePort(usage, target, [inPort], 'input', true)) continue
        if (allowsAutomaticVideoConversion(source, outPort, inPort)) return { outPort, inPort }
      }
    }
    return null
  }

  const blockedVideoReason = (source: Gadget, target: Gadget): 'usb-c' | 'conversion' | null => {
    const targetHasVideoInput = target.ports.some((port) =>
      (port.direction === 'input' || port.direction === 'bidirectional') && portCarriesVideo(port),
    )
    if (!targetHasVideoInput) return null
    if (source.ports.some((port) =>
      (port.type === 'USB_C' || port.type === 'Thunderbolt') &&
      (port.direction === 'output' || port.direction === 'bidirectional') &&
      port.supportsVideo !== true,
    )) return 'usb-c'
    for (const from of source.ports) {
      if ((from.direction !== 'output' && from.direction !== 'bidirectional') || !portCarriesVideo(from)) continue
      for (const to of target.ports) {
        if ((to.direction !== 'input' && to.direction !== 'bidirectional') || !portCarriesVideo(to)) continue
        if ((PORT_COMPATIBILITY[from.type] ?? []).includes(to.type) &&
            !allowsAutomaticVideoConversion(source, from.type, to.type)) return 'conversion'
      }
    }
    return null
  }

  for (const kvm of kvms) {
    for (const computer of computers) {
      const pair = findVideoPair(computer, kvm)
      if (pair) addConn(computer, pair.outPort, kvm, pair.inPort, 'video')
    }
  }
  // メインモニターの映像入力を、キャプチャ経由のゲーム機のために空けておくかどうか。
  // 判定は「映像を出せるゲーム機がいるか」で行う。台数だけで判断すると、映像出力を
  // 持たない携帯機（DS・3DS 等）を1台登録しただけでここを飛ばしてしまい、
  // ステップ2b でも繋がらないためモニターが1本も映像を受け取らないまま終わる
  // （警告も出ないので、図から線が消えたようにしか見えない）。
  const consoleVideoSource = (gameConsole: Gadget): Gadget => connections
    .filter((connection) => connection.fromGadgetId === gameConsole.id)
    .map((connection) => selected.find((g) => g.id === connection.toGadgetId))
    .find((g): g is Gadget => g !== undefined && isConsoleDock(g)) ?? gameConsole
  // Switch 本体の USB-C はドック接続専用の端子で、モニターへ直挿ししても映像は出ない。
  // ドックが登録されていて映像がドックから出るときは、この制限は関係ない。
  const consoleVideoPriority = (gameConsole: Gadget, videoSource: Gadget): PortType[] =>
    videoSource.id === gameConsole.id && isSwitchConsole(gameConsole)
      ? DISPLAY_PORT_PRIORITY.filter((type) => type !== 'USB_C')
      : DISPLAY_PORT_PRIORITY
  const hasVideoOutConsole = videoAppliances.some((gameConsole) => {
    const videoSource = consoleVideoSource(gameConsole)
    return !!findAvailablePort(usage, videoSource, consoleVideoPriority(gameConsole, videoSource), 'output', true)
  })

  // 映像が繋がらなかったモニターと、その理由。
  // ここで即 warnings へ積むと、ステップ2b（ゲーム機・キャプチャ）で後から
  // 繋がるモニターにも警告が出てしまう。逆に「ゲーム機がいるから」と警告を
  // 抑えるだけだと、2b でも繋がらなかったときに何も出ないまま線だけが消える。
  // 判定は 2b の後にまとめて行い、そのとき本当に映像が来ていないものだけ警告する。
  const pendingVideoWarning = new Map<string, string>()
  const noVideoSourceMessage = (monitor: Gadget) => lang === 'en'
    ? `${monitor.name}: No video source found`
    : `${monitor.name}: 映像ソースが見つかりません`

  // 内蔵画面を持たない PC が複数あるとき、1台目が空いているモニターを全部取ると
  // 2台目以降が画面を1枚も持てない（2PC 配信や Mac 2台の編集デスクがこれに当たる）。
  // 台数分だけ後ろのモニターを空けておき、下の computers.slice(1) のループへ回す。
  // KVM がある構成は切替器が画面を共有する前提なので対象外
  const captureReservedDisplayId = captureDevices.length > 0 && hasVideoOutConsole
    ? monitors[0]?.id
    : undefined
  const connectedDisplaySources: Gadget[] = []

  // ガジェットの「接続先」で映像元を指定されたディスプレイを先に結ぶ。
  // どの PC がどの画面を持つかは登録データから決められる情報ではないので、
  // 指定があればそれが答えになる（確保ルールも自動選択も後回しにする）。
  // 指定した相手と噛み合う端子が無いときは結ばず、従来どおり自動選択へ落とす
  const VIDEO_HOST_CATEGORIES: GadgetCategory[] = ['PC', 'Dock', 'Hub', 'KVM']
  const pinnedDisplayIds = new Set<string>()
  const pinnedVideoSourceOf = (display: Gadget): Gadget | undefined => {
    const targetId = display.bluetoothTargetGadgetIds?.[0]
    if (!targetId) return undefined
    return selected.find((g) => g.id === targetId && VIDEO_HOST_CATEGORIES.includes(g.category))
  }
  for (const display of displayTargets) {
    const source = pinnedVideoSourceOf(display)
    if (!source || source.id === display.id) continue
    const pair = findVideoPair(source, display)
    if (!pair) continue
    if (addConn(source, pair.outPort, display, pair.inPort, 'video')) {
      pinnedDisplayIds.add(display.id)
      connectedDisplaySources.push(display)
    }
  }
  // 指定で既に画面を持った PC は、もう1枚確保してやる必要がない
  const pcsWithPinnedDisplay = new Set(
    connections
      .filter((connection) => pinnedDisplayIds.has(connection.toGadgetId))
      .map((connection) => connection.fromGadgetId),
  )
  const deskComputers = computers.filter((g) =>
    g.pcFormFactor !== 'laptop' && !pcsWithPinnedDisplay.has(g.id))
  // 液タブはペン入力とセットでメインの PC に繋ぐ機材で、2台目へ回すものではない。
  // 確保の対象に入れると、映像だけ別の PC から来てデータ線は1台目、という
  // 実機では成立しない図になる
  const isPenDisplay = (g: Gadget) => penDisplays.some((pen) => pen.id === g.id)
  const assignableDisplays = displayTargets.filter((g) =>
    g.id !== captureReservedDisplayId && !isPenDisplay(g) && !pinnedDisplayIds.has(g.id))
  const reservedDisplayIds = new Set<string>(
    kvms.length === 0 && deskComputers.length > 1 && assignableDisplays.length >= deskComputers.length
      ? assignableDisplays.slice(-(deskComputers.length - 1)).map((g) => g.id)
      : [],
  )

  for (const monitor of displayTargets) {
    if (pinnedDisplayIds.has(monitor.id)) continue
    if (reservedDisplayIds.has(monitor.id)) continue
    // 映像を受けられるタブレットは自分の画面を持つ。サブ画面にするかは使い方しだいなので、
    // 映像元が無くても警告しない。自分がモニターへ映像を出している（端子を使った）なら受け側にしない
    const optionalDisplay = monitor.category === 'Tablet'
    if (optionalDisplay && connections.some((connection) =>
      connection.fromGadgetId === monitor.id && connection.cableType !== 'Bluetooth')) continue
    if (captureDevices.length > 0 && hasVideoOutConsole && monitor.id === monitors[0]?.id) {
      // 2b でキャプチャ経由の映像が来る前提で空けておくが、来なかった場合に備えて控えておく
      pendingVideoWarning.set(monitor.id, noVideoSourceMessage(monitor))
      continue
    }
    // 上流に繋がらなかったドック・ハブからは映像も出ない。その場合はPC直結にする
    // （PCが1台も無い構成では、従来どおりドックを映像ソースとして扱う）
    const videoHub = primaryHub && videoLinkedUpstreamIds.has(primaryHub.id)
      ? primaryHub
      : undefined
    // 口を残しておいたノートPCは、ハブを経由せず USB-C 1本で直接繋ぐ
    const oneCableLaptop = computers.find((pc) =>
      reservedVideoPorts.has(pc.id) &&
      monitor.ports.some((port) => port.direction !== 'output' && isUsbCVideoPort(port)) &&
      !!findVideoPair(pc, monitor))
    const videoSources = [
      kvms[0], oneCableLaptop, videoHub, computers[0], computers.length === 0 ? primaryHub : undefined,
      tabletVideoSources.find((tablet) => tablet.id !== monitor.id),
      ...connectedDisplaySources,
    ].filter((source, index, all): source is Gadget =>
      !!source && source.id !== monitor.id && all.findIndex((candidate) => candidate?.id === source.id) === index,
    )
    if (videoSources.length === 0) {
      if (!optionalDisplay) pendingVideoWarning.set(monitor.id, noVideoSourceMessage(monitor))
      continue
    }

    let connected = false
    for (const videoSource of videoSources) {
      let pair = findVideoPair(videoSource, monitor)
      if (!pair) continue
      // 新規の単一PC構成だけ、専用画面が必要とする最後の口を両対応画面で使い切らない。
      // 既存の確定線・複数PCの担当画面・指定先・変換の優先度は組み替えない。
      const hasSavedChoice = plan.connectionMap?.connections.some((c) => c.fromGadgetId === videoSource.id
        && (c.confirmed || c.origin === 'manual') && displayTargets.some((display) => display.id === c.toGadgetId))
      const savedChoice = plan.connectionMap?.connections.find((c) => c.fromGadgetId === videoSource.id
        && c.toGadgetId === monitor.id && (c.confirmed || c.origin === 'manual'))
      const savedType = SAME_TYPE_VIDEO_PRIORITY.find((type) => determineCableType(type, type) === savedChoice?.cableType)
      if (computers.length === 1 && videoSource.id === computers[0].id && savedType
        && findAvailablePort(usage, videoSource, [savedType], 'output', true)
        && findAvailablePort(usage, monitor, [savedType], 'input', true)) {
        pair = { outPort: savedType, inPort: savedType }
      }
      if (computers.length === 1 && videoSource.id === computers[0].id && !hasSavedChoice
        && pair.outPort === pair.inPort) {
        const alternative = findVideoPair(videoSource, monitor, pair.outPort)
        if (alternative && alternative.outPort === alternative.inPort) {
          const pending = displayTargets.filter((display) => display.id !== monitor.id
            && display.id !== captureReservedDisplayId && !pinnedDisplayIds.has(display.id)
            && !pinnedVideoSourceOf(display) && !reservedDisplayIds.has(display.id)
            && !connectedDisplaySources.some((connectedDisplay) => connectedDisplay.id === display.id))
          const blockedByTaking = (type: PortType) => {
            const needs = pending.filter((display) => findVideoPair(videoSource, display)?.outPort === type
              && !findVideoPair(videoSource, display, type)).length
            return Math.max(0, needs - (getRemaining(usage, videoSource.id, type, 'output', portCarriesVideo) - 1))
          }
          if (blockedByTaking(alternative.outPort) < blockedByTaking(pair.outPort)
            && !isDismissed(videoSource.id, monitor.id, determineCableType(pair.outPort, pair.inPort))) pair = alternative
        }
      }
      connected = addConn(videoSource, pair.outPort, monitor, pair.inPort, 'video')
      // 破棄済みの線を別経路で復活させない。候補が見つかった時点で探索を終える。
      if (connected) connectedDisplaySources.push(monitor)
      break
    }
    if (!connected && !optionalDisplay && !videoSources.some((source) => !!findVideoPair(source, monitor))) {
      const block = videoSources.map((source) => blockedVideoReason(source, monitor)).find(Boolean)
      pendingVideoWarning.set(monitor.id, block === 'usb-c'
        ? (lang === 'en'
          ? `${monitor.name}: USB-C/Thunderbolt video support is unconfirmed. Check DisplayPort Alt Mode or Thunderbolt support.`
          : `${monitor.name}: USB-C/Thunderboltの映像対応が未確認です。DisplayPort Alt ModeまたはThunderbolt対応を確認してください。`)
        : block === 'conversion'
          ? (lang === 'en'
            ? `${monitor.name}: A directional or active display adapter is required. Confirm the conversion direction before connecting.`
            : `${monitor.name}: 方向性またはアクティブ映像変換が必要です。変換方向を確認してください。`)
          : (lang === 'en'
            ? `${monitor.name}: Could not establish video connection. Please check compatible ports.`
            : `${monitor.name}: 映像接続ができませんでした。対応ポートを確認してください。`))
    }
  }

  // 2台目以降のPCは、空き入力を持つモニターへ1本ずつ直接接続する。
  // 1台構成には追加処理が入らないため、既存のPC→Dock→Monitor経路は変わらない。
  // 上で空けておいたモニターから先に見る。ここを順番どおりに探すと、
  // 1台目が使い残した別のモニターを先に取ってしまい、確保した意味が無くなる
  // 映像元を指定済みのディスプレイは、指定していない PC が横から取らないよう候補から外す
  const secondaryDisplayOrder = [
    ...displayTargets.filter((g) => reservedDisplayIds.has(g.id)),
    ...displayTargets.filter((g) =>
      !reservedDisplayIds.has(g.id) && !isPenDisplay(g) && !pinnedDisplayIds.has(g.id)),
  ]
  for (const computer of computers.slice(1)) {
    for (const candidate of secondaryDisplayOrder) {
      const pair = findVideoPair(computer, candidate)
      if (!pair) continue
      addConn(computer, pair.outPort, candidate, pair.inPort, 'video')
      break
    }
  }

  // === ステップ2b: ゲーム機のHDMI出力をモニターに接続 ===
  for (const gameConsole of videoAppliances) {
    // ドックに載せている場合、映像は本体ではなくドックの HDMI から出る。
    // 映像ソースをドックに差し替えて、その先はドック無しのときと同じ経路をたどる。
    const consoleDock = connections
      .filter((connection) => connection.fromGadgetId === gameConsole.id)
      .map((connection) => selected.find((g) => g.id === connection.toGadgetId))
      .find((g): g is Gadget => g !== undefined && isConsoleDock(g))
    const videoSource = consoleDock ?? gameConsole
    if (monitors.length === 0) continue
    const videoPriority = consoleVideoPriority(gameConsole, videoSource)
    const outPort = findAvailablePort(usage, videoSource, videoPriority, 'output', true)
    // ドック未登録でも HDMI を持つ Switch（有機ELモデル等）は「ドック経由の1本」として引けるが、
    // USB-C しか持たない Switch 2 は引ける線が無い。黙って消えると図から映像が消えたようにしか
    // 見えないので、ドックを登録すれば繋がることを伝える
    if (!outPort) {
      if (!consoleDock && isSwitchConsole(gameConsole)) {
        warnings.push(lang === 'en'
          ? `${gameConsole.name}: Add the dock to send video to a monitor`
          : `${gameConsole.name}: モニターへ映像を出すにはドックを登録してください`)
      }
      continue
    }
    let connected = false
    let sentToCapture = false
    const capture = captureDevices.find((candidate) =>
      findAvailablePort(usage, candidate, PORT_COMPATIBILITY[outPort] ?? [outPort], 'input', true),
    )
    if (capture) {
      const captureIn = findAvailablePort(usage, capture, PORT_COMPATIBILITY[outPort] ?? [outPort], 'input', true)!
      if (addConn(videoSource, outPort, capture, captureIn, 'video')) {
        sentToCapture = true
        const captureOut = findAvailablePort(usage, capture, DISPLAY_PORT_PRIORITY, 'output', true)
        const monitor = captureOut
          ? monitors.find((candidate) => findAvailablePort(usage, candidate, PORT_COMPATIBILITY[captureOut] ?? [captureOut], 'input', true))
          : undefined
        if (captureOut && monitor) {
          const monitorIn = findAvailablePort(usage, monitor, PORT_COMPATIBILITY[captureOut] ?? [captureOut], 'input', true)!
          addConn(capture, captureOut, monitor, monitorIn, 'video')
          connected = true
        }
      }
    }
    if (connected) continue
    // PCとゲーム機で1台の画面を共有する場合、KVM/HDMI切替器の空き入力を使う。
    // 切替器から画面への出力はステップ2aで先に確保されている。
    if (!sentToCapture) {
      const videoSwitcher = kvms.find((candidate) =>
        findAvailablePort(usage, candidate, PORT_COMPATIBILITY[outPort] ?? [outPort], 'input', true),
      )
      if (videoSwitcher) {
        const switcherIn = findAvailablePort(
          usage,
          videoSwitcher,
          PORT_COMPATIBILITY[outPort] ?? [outPort],
          'input',
          true,
        )!
        addConn(videoSource, outPort, videoSwitcher, switcherIn, 'video')
        continue
      }
    }
    // キャプチャへ挿した時点で映像出力を1本使っている。パススルーの無いキャプチャでは
    // 本体からモニターへもう1本は出せないので、残っている出力を取り直す。
    // ここで outPort を使い回すと、HDMI 出力1つのゲーム機から2本の線が出てしまう
    const monitorOutPort = sentToCapture
      ? findAvailablePort(usage, videoSource, videoPriority, 'output', true)
      : outPort
    for (const monitor of monitorOutPort ? monitors : []) {
      const compatInputs = PORT_COMPATIBILITY[monitorOutPort!] ?? [monitorOutPort!]
      const inPort = findAvailablePort(usage, monitor, compatInputs, 'input', true)
      if (inPort) {
        // 線を引かずに false が返るのは「ユーザーがこの線を消した」場合だけ。
        // その場合は別のモニターへ繋ぎ直さず、警告も出さずに終える（消した意図を尊重する）。
        // ドック経由の USB-C 入力も、線が引かれていない以上は消費しない。
        if (addConn(videoSource, monitorOutPort!, monitor, inPort, 'video')) {
          // ドックを登録していない場合でも、実際はドック経由でHDMI出力するため
          // 本体のUSB-C入力を1ポート消費する（ドックを登録済みならステップ1で消費済み）
          if (!consoleDock && findAvailablePort(usage, gameConsole, ['USB_C'], 'input')) {
            consumePort(usage, gameConsole.id, 'USB_C', 'input')
          }
        }
        connected = true
        break
      }
    }
    // キャプチャへ映像を送れているなら、モニターへ直結できなくても配線としては成立している
    // （パススルー無しのキャプチャでは実機もそうなる）
    if (!connected && !sentToCapture) {
      warnings.push(lang === 'en' ? `${videoSource.name}: Could not connect to monitor. Please check the monitor's HDMI inputs.` : `${videoSource.name}: モニターへの映像接続ができませんでした。モニターのHDMI入力数を確認してください。`)
    }
  }

  // === ステップ2b-2: カメラ → キャプチャ ===
  // USB Webカメラとは別に、ミラーレス等のHDMI映像をキャプチャへ渡す。
  for (const camera of cameras) {
    const outPort = findAvailablePort(usage, camera, DISPLAY_PORT_PRIORITY, 'output', true)
    if (!outPort) continue
    const capture = captureDevices.find((candidate) =>
      !!findAvailablePort(usage, candidate, PORT_COMPATIBILITY[outPort] ?? [outPort], 'input', true))
    if (!capture) continue
    const inPort = findAvailablePort(usage, capture, PORT_COMPATIBILITY[outPort] ?? [outPort], 'input', true)
    if (inPort) addConn(camera, outPort, capture, inPort, 'video')
  }

  // === ステップ2b-3: ゲーム用PCの映像 → キャプチャ（2PC 配信）===
  // PC が2台以上ある構成では、片方の画面をキャプチャへ入れてもう片方で録る。
  // ここが無いと、キャプチャの映像ソースがゲーム機だけになり、
  // 2PC 配信の要である「ゲーム用PC → キャプチャ → 配信用PC」が一度も引かれない。
  // モニターへの割り当ては 2a・2b で終わっているので、ここで使うのは余った映像出力だけ
  if (computers.length > 1) {
    const hasVideoIn = (capture: Gadget) => connections.some((connection) =>
      connection.toGadgetId === capture.id && DISPLAY_PORT_PRIORITY.includes(connection.toPortType))
    for (const capture of captureDevices) {
      if (hasVideoIn(capture)) continue
      for (const computer of computers) {
        const outPort = findAvailablePort(usage, computer, DISPLAY_PORT_PRIORITY, 'output', true)
        if (!outPort) continue
        const inPort = findAvailablePort(usage, capture, PORT_COMPATIBILITY[outPort] ?? [outPort], 'input', true)
        if (!inPort) continue
        if (addConn(computer, outPort, capture, inPort, 'video')) break
      }
    }
  }

  // ステップ2a で保留した映像の警告を、2b の結果を見てから出す。
  // 2b で繋がったモニターの警告は取り下げ、結局1本も映像が来なかったものだけ残す
  for (const [monitorId, message] of pendingVideoWarning) {
    const fed = connections.some((connection) =>
      connection.toGadgetId === monitorId &&
      !connection.id.startsWith('failed') &&
      DISPLAY_PORT_PRIORITY.includes(connection.toPortType),
    )
    if (!fed) warnings.push(message)
  }

  // 「映像を通せる端子の種類」（DISPLAY_PORT_PRIORITY）と「実際に映像が出ている」は別物。
  // USB-C や Thunderbolt はデータだけの接続にも使うので、端子の種類だけで判定すると
  // モニターが1枚も無くても USB ハブに繋がっているだけで「画面への接続がありません」が消える。
  // 相手が画面そのものか、画面へ映像を中継できる機器のときだけ映像経路とみなす。
  const VIDEO_RELAY_CATEGORIES: GadgetCategory[] = ['Dock', 'Hub', 'KVM', 'Monitor', 'TV']
  const feedsDisplay = (sourceId: string, depth = 0): boolean => connections.some((connection) => {
    if (connection.fromGadgetId !== sourceId) return false
    if (!videoConnectionIds.has(connection.id)) return false
    if (displayTargets.some((display) => display.id === connection.toGadgetId)) return true
    // キャプチャへ送る映像は、警告文が案内している「キャプチャ経路」そのものなので画面扱いにする
    const target = selected.find((item) => item.id === connection.toGadgetId)
    if (!target) return false
    if (target.category === 'CaptureDevice') return true
    if (depth >= 3) return false
    return VIDEO_RELAY_CATEGORIES.includes(target.category) && feedsDisplay(target.id, depth + 1)
  })

  // ステップ2a でキャプチャ経路のためにメインモニターを空けたまま、2b で埋まらなかった
  // 入力が残ることがある。モニター1枚に PS5 + キャプチャ + ゲーミングPC という構成では、
  // モニターの DisplayPort が空いているのに PC だけ画面を1枚も持てずに終わっていた
  // （空けるのは「キャプチャ用の入力を1つ確保する」ためで、その画面ごと PC から
  // 取り上げる意図ではない）。2b まで終えてなお映像の無い PC を、空き入力へ拾い上げる。
  for (const computer of computers.filter((item) => item.pcFormFactor !== 'laptop')) {
    // 判定は下の警告と同じにする。ドック経由で画面を持つ PC まで拾うと、
    // 既にドックから映像が出ている構成にモニター直結の2本目が生えてしまう
    if (feedsDisplay(computer.id)) continue
    for (const candidate of displayTargets) {
      const pair = findVideoPair(computer, candidate)
      if (!pair) continue
      if (addConn(computer, pair.outPort, candidate, pair.inPort, 'video')) break
    }
  }

  // デスクトップ／ミニPCは本体だけでは画面を表示できない。モニターを登録し忘れた
  // 最小構成を「警告なし」にすると、成立していないデスクを完成形に見せてしまう。
  for (const computer of computers.filter((item) => item.pcFormFactor !== 'laptop')) {
    if (!feedsDisplay(computer.id)) {
      warnings.push(lang === 'en'
        ? `${computer.name}: No display connection. Add a monitor, TV, projector, or capture path.`
        : `${computer.name}: 画面への接続がありません。モニター・テレビ・プロジェクター・キャプチャ経路を追加してください。`)
    }
  }

  // === ステップ2c: ルーターのLANポート → Ethernetで受電するガジェット ===
  // Ethernet は「ルーター（LAN=output）から配る → 受け側（input）」という、
  // PC/ハブが周辺機器へ配る他のポート（USB等）とは逆向きの一方向配線。
  // 以降のステップ3（PC/ハブを起点に周辺機器へ配る設計）では起点にできないため、
  // ここで専用に処理する。ルーター自身は対象から除く（WAN側の Ethernet input は
  // 回線側からの受電用で、デスク内の他機器と繋ぐものではない）。
  const isPoePort = (port: Port): boolean =>
    port.type === 'EthernetPoE' || (port.type === 'Ethernet' && port.supportsPoE === true)
  const findEthernetPort = (
    gadget: Gadget,
    direction: Port['direction'],
    requirePoe = false,
  ): PortType | null => findAvailablePort(
    usage,
    gadget,
    ['Ethernet', 'EthernetPoE'],
    direction,
    false,
    (port) => !requirePoe || isPoePort(port),
  )
  const routers = selected.filter((g) => g.category === 'Router')
  const modems = selected.filter((g) => g.category === 'Modem')
  for (const router of routers) {
    const wanPort = findAvailablePort(usage, router, ['Ethernet'], 'input')
    if (!wanPort) continue
    const modem = modems.find((candidate) => findAvailablePort(usage, candidate, ['Ethernet'], 'output'))
    if (modem) {
      addConn(modem, 'Ethernet', router, wanPort)
      continue
    }
    // ONU・モデムは「あるけど登録していない」のが普通なので、1台も無いときは何も言わない。
    // 登録済みなのに繋げないのは出力の空き不足で、ユーザーが直せる問題なので知らせる。
    if (modems.length > 0) {
      warnings.push(lang === 'en'
        ? `${router.name}: No free port on the modem for the WAN connection`
        : `${router.name}: モデムの空きポートがなく WAN 側を接続できません`)
    }
  }
  // スイッチングハブはルーターから上りを1本もらってからでないと、他機器へ配れない。
  // 先に上りを繋いでおき、繋がったものだけを配る側の候補に入れる
  const switches = selected.filter((g) => g.category === 'NetworkSwitch')
  const connectedSwitches: Gadget[] = []
  for (const networkSwitch of switches) {
    const uplinkPort = findEthernetPort(networkSwitch, 'input')
    if (!uplinkPort) continue
    const router = routers.find((candidate) => findEthernetPort(candidate, 'output') !== null)
    if (!router) {
      if (routers.length > 0) {
        warnings.push(lang === 'en'
          ? `${networkSwitch.name}: Router has no free LAN ports for the uplink`
          : `${networkSwitch.name}: ルーターのLANポートに空きがなく上りを接続できません`)
      }
      continue
    }
    const outPort = findEthernetPort(router, 'output')!
    if (addConn(router, outPort, networkSwitch, uplinkPort)) connectedSwitches.push(networkSwitch)
  }

  // PoEスイッチ／インジェクターは「その他」等のカテゴリでも登録できる。
  // 先にルーターへアップリンクし、以降のPoE受電ガジェットではルーターより優先して使う。
  const poeDistributors = selected.filter((g) =>
    g.category !== 'Router' &&
    g.category !== 'NetworkSwitch' &&
    g.ports.some((p) => isPoePort(p) && (p.direction === 'output' || p.direction === 'bidirectional')),
  )
  const connectedPoeDistributors: Gadget[] = []
  for (const distributor of poeDistributors) {
    const inPort = findEthernetPort(distributor, 'input')
    if (!inPort) continue
    const router = routers.find((candidate) => findEthernetPort(candidate, 'output') !== null)
    if (!router) continue
    const outPort = findEthernetPort(router, 'output')!
    if (addConn(router, outPort, distributor, inPort)) connectedPoeDistributors.push(distributor)
  }
  // === スピーカー間接続（主 → 従）===
  // 左右ペアのアクティブスピーカーは、入力を持つ主側から従側へ1本だけ結ぶ。
  // KEF LSX のように従側が「スピーカー間接続」専用の Ethernet しか持たない機種があり、
  // ルーターへ配る対象に混ぜると、LANケーブルが従側スピーカーまで伸びる図になる。
  // アンプ内蔵側からスピーカー端子で鳴らす HS3/HS4 型のペアも同じ関係
  const SPEAKER_LINK_PRIORITY: PortType[] = ['SpeakerTerminal', 'Ethernet']
  const pairedSpeakerIds = new Set<string>()
  const stereoSpeakers = selected.filter((g) => g.category === 'Speaker' && g.stereoPair)
  for (const follower of stereoSpeakers) {
    for (const linkType of SPEAKER_LINK_PRIORITY) {
      const inPort = findAvailablePort(usage, follower, [linkType], 'input')
      if (!inPort) continue
      // 既に従側になっているスピーカーを主側にすると、左右が互いを指すループになる
      const leader = stereoSpeakers.find((candidate) =>
        candidate.id !== follower.id &&
        !pairedSpeakerIds.has(candidate.id) &&
        !!findAvailablePort(usage, candidate, [linkType], 'output'))
      if (!leader) continue
      const outPort = findAvailablePort(usage, leader, [linkType], 'output')!
      // スピーカー端子はオーディオ出力の残数管理に載っているので、そちら経由で消費する
      const audioOut = findAudioOutput(leader, [linkType], 'monitor')
      const linked = audioOut
        ? addAudioConn(leader, audioOut, follower, inPort)
        : addConn(leader, outPort, follower, inPort)
      if (linked) pairedSpeakerIds.add(follower.id)
      break
    }
  }

  const ethernetTargets = selected.filter(
    (g) =>
      g.category !== 'Router' &&
      g.category !== 'Modem' &&
      g.category !== 'NetworkSwitch' &&
      !poeDistributors.some((source) => source.id === g.id) &&
      // スピーカー間接続で主側から受けている従側は、ルーターにぶら下げるものではない
      !pairedSpeakerIds.has(g.id) &&
      (!isSmartHomeGadget(g) || g.ports.some((p) => isPoePort(p) && p.direction !== 'output')) &&
      (wiredOverrides.includes(g.id) || !g.ports.some((p) => p.type === 'WiFi' && p.direction !== 'output')) &&
      // 双方向のみの Ethernet は機器同士を直結する LINK 端子（DJプレーヤーの LINK など）。
      // ルーターにぶら下げるものではないので、ネットワーク接続の対象から外す。
      g.ports.some((p) => (p.type === 'Ethernet' || p.type === 'EthernetPoE') && p.direction === 'input')
  )
  const poweredByPoeIds = new Set<string>()
  // ドック・ハブ・モニターの LAN 端子は、LAN 端子を持たないノートPCのための USB 経由の口。
  // PC が全台自前の LAN 端子を持つなら、そちらに挿すのが普通で、両方に引くと LAN が二重になる
  const everyPcHasOwnLan = computers.length > 0 && computers.every((pc) =>
    pc.ports.some((port) => (port.type === 'Ethernet' || port.type === 'EthernetPoE') && port.direction !== 'output'))
  const USB_LAN_CATEGORIES: GadgetCategory[] = ['Dock', 'Hub', 'Monitor', 'KVM']
  for (const target of ethernetTargets) {
    // ゲーム機のドック（Switch）の LAN はゲーム機のためのもので、PC とは関係ない
    if (everyPcHasOwnLan && USB_LAN_CATEGORIES.includes(target.category) && !isConsoleDock(target) && !wiredOverrides.includes(target.id)) continue
    // Ethernet input は以降のステップ3では扱わない（起点になれるガジェットがルーターだけの
    // 一方向配線のため）。ここで消費しておかないと、ルーター不足時に Step3 側でも
    // 「入力ポートが不足」という無関係な警告が重複して出てしまう。
    const poeInPort = findEthernetPort(target, 'input', true)
    const inPort = poeInPort ?? findEthernetPort(target, 'input')
    if (!inPort) continue
    const requiresPoe = poeInPort !== null
    const networkSources = requiresPoe
      ? [...connectedPoeDistributors, ...routers, ...connectedSwitches]
      : [...routers, ...connectedSwitches]
    const source = networkSources.find((candidate) => findEthernetPort(candidate, 'output', requiresPoe) !== null)
    if (!source) {
      consumePort(usage, target.id, inPort, 'input')
      warnings.push(
        routers.length === 0
          ? (lang === 'en' ? `${target.name}: No router found` : `${target.name}: ルーターが見つかりません`)
          : connectedSwitches.length > 0
            ? (lang === 'en'
              ? `${target.name}: No free LAN ports on the router or switch`
              : `${target.name}: ルーターとスイッチングハブのLANポートに空きがありません`)
            : (lang === 'en' ? `${target.name}: Router has no free LAN ports` : `${target.name}: ルーターのLANポートに空きがありません`)
      )
      continue
    }
    const outPort = findEthernetPort(source, 'output', requiresPoe)!
    if (addConn(source, outPort, target, inPort) && requiresPoe) poweredByPoeIds.add(target.id)
  }

  // 常時多数接続されるIoTガジェットはWi-Fiポートのバッジだけを表示する。
  // 操作対象として配線経路が有用なプリンターのみ、ルーターとの点線を生成する。
  const wifiTargets = selected.filter((g) =>
    (g.category === 'Printer' || g.category === 'Printer3D') &&
    g.ports.some((p) => p.type === 'WiFi' && (p.direction === 'input' || p.direction === 'bidirectional')),
  )
  for (const target of wifiTargets) {
    const router = routers[0]
    if (!router) {
      warnings.push(lang === 'en' ? `${target.name}: No Wi-Fi router found` : `${target.name}: Wi-Fiルーターが見つかりません`)
      continue
    }
    if (isDismissed(router.id, target.id, 'WiFi')) continue
    connections.push({
      id: `wifi-${connIndex++}`,
      fromGadgetId: router.id,
      fromPortType: 'WiFi',
      toGadgetId: target.id,
      toPortType: 'WiFi',
      cableType: 'WiFi',
    })
  }

  const hasBluetoothOut = (g: Gadget) =>
    g.ports.some((p) => p.type === 'Bluetooth' && (p.direction === 'output' || p.direction === 'bidirectional'))
  const hasReceiverInput = (g: Gadget) =>
    g.ports.some((p) =>
      p.type === 'USB_A' &&
      p.direction === 'input' &&
      isReceiverPort(p),
    )
  // Bluetooth トランスミッター（aptX LL の送信機など）。有線で音を受けて BT で送り出す機器で、
  // BT の口は出力しか無い。他のワイヤレス機器と同じ扱いにすると PC から BT の線が引かれ、
  // 送り先のヘッドホンはトランスミッターを素通りしてスマホや PC と直接繋がってしまう。
  // ライト・ゲーム機の「BT 制御」も出力だけなので、音の入口を持つことを条件に切り分ける
  const TRANSMITTER_AUDIO_INPUTS: PortType[] = ['Audio3_5mm', 'RCA', 'OpticalAudio', 'Audio6_3mm']
  const isBluetoothTransmitter = (g: Gadget) =>
    g.category !== 'Light' && g.category !== 'GameConsole' && g.category !== 'SmartHome' &&
    g.ports.some((p) => p.type === 'Bluetooth' && p.direction === 'output') &&
    !g.ports.some((p) => p.type === 'Bluetooth' && p.direction !== 'output') &&
    g.ports.some((p) => TRANSMITTER_AUDIO_INPUTS.includes(p.type) &&
      (p.direction === 'input' || p.direction === 'bidirectional'))
  // タブレット用のペン（Apple Pencil 等）。ペアリングも充電もタブレットとの間で完結するので
  // 線は引かず、使うタブレットのカードへ内包する（ステップ3の手前）。スマホ・Watch と同じ扱いに
  // すると Qi 充電器で充電され、タブレットが無い構成では PC とペアリングする図になっていた
  const isTabletPen = isStylusAccessory
  // ドック・ハブはジャンルとしては Bluetooth を持たない。持つ製品は口の判定（下の行）で拾う
  const canHostBluetooth = (g: Gadget) =>
    ['PC', 'GameConsole', 'Smartphone', 'Tablet'].includes(g.category) ||
    g.ports.some((p) => p.type === 'Bluetooth' && (p.direction === 'input' || p.direction === 'bidirectional')) ||
    isBluetoothTransmitter(g)
  // 無線で繋がるガジェットは有線を引かない（wiredOverrides で有線を強制したガジェットは除く）
  const prefersWireless = (g: Gadget) =>
    hasBluetoothOut(g) && !hasReceiverInput(g) && !isBluetoothTransmitter(g) && !wiredOverrides.includes(g.id)

  // === ステップ2d: オーディオ経路（XLR・ライン入出力）===
  // XLR やフォーン出力は「マイク・楽器（output）→ オーディオIF・ミキサー（input）」、
  // 「オーディオIF・ミキサー（output）→ モニタースピーカー（input）」という一方向の配線で、
  // PC/ハブを起点に周辺機器へ配る Step3 では起点にできない。Ethernet（ステップ2c）と同じく
  // ここで専用に処理する。これがないと XLR マイクやライン入力のスピーカーが、
  // 警告も出ないまま一本も線が引かれずに図へ浮いてしまう。
  const audioHubs = selected.filter((g) => g.category === 'AudioInterface' || g.category === 'Mixer')
  // プリメイン／パワーアンプ。パッシブスピーカーを鳴らせるのはこれだけ
  const amplifiers = selected.filter((g) => g.category === 'Amplifier')
  // 音の集まる先はミキサーを優先する（マイクはミキサーへ集め、ミキサーの出力がオーディオIFへ、という流れ）
  const audioSinks = [...audioHubs].sort(
    (a, b) => Number(b.category === 'Mixer') - Number(a.category === 'Mixer'),
  )
  // 逆に音を出す側はオーディオIFを優先する（スピーカー・ヘッドホンはIFのモニター出力から鳴らす）
  // スピーカーを鳴らす側。パッシブスピーカーはアンプからしか鳴らせないので、
  // アンプを候補の先頭に置く（パワードスピーカーは従来どおり IF・ミキサーから）
  // PCとUSBで繋ぎ、ライン出力とヘッドホン出力を併せ持つ機器は、カテゴリが何であれ
  // オーディオインターフェースとして働く（DJコントローラー・一部のシンセがこれに当たる）。
  // 音源をカテゴリだけで決めていたため、DJコントローラーを「コントローラー」で登録すると
  // スピーカーの音源候補から外れ、PCのイヤホン端子から直結する図になっていた。
  const actsAsAudioInterface = (g: Gadget): boolean => {
    const has = (types: PortType[], direction: 'input' | 'output') =>
      g.ports.some((port) => types.includes(port.type) &&
        (port.direction === direction || port.direction === 'bidirectional'))
    return has(['USB_C', 'USB_B', 'USB_A', 'Thunderbolt'], 'input') &&
      has(['XLR', 'Audio6_3mm', 'Audio6_3mm_TS', 'RCA'], 'output') &&
      has(['Audio6_3mm', 'Audio3_5mm'], 'output')
  }
  // 専用機（IF・ミキサー・アンプ）を先に並べ、ポートから判定した機器は後ろへ回す。
  // オーディオIFがある構成でシンセが音源に選ばれると、実物と違う配線になる。
  const AUDIO_SOURCE_CATEGORIES: GadgetCategory[] = ['Amplifier', 'AudioInterface', 'Mixer']
  const monitorAudioSources = [
    ...selected.filter((g) => AUDIO_SOURCE_CATEGORIES.includes(g.category)),
    ...selected.filter((g) => !AUDIO_SOURCE_CATEGORIES.includes(g.category) && actsAsAudioInterface(g)),
  ]
  const HEADPHONE_SOURCE_ORDER: GadgetCategory[] = ['HeadphoneAmp', 'Amplifier', 'AudioInterface', 'Mixer']
  const headphoneAudioSources = [
    ...selected
      .filter((g) => HEADPHONE_SOURCE_ORDER.includes(g.category))
      .sort((a, b) => HEADPHONE_SOURCE_ORDER.indexOf(a.category) - HEADPHONE_SOURCE_ORDER.indexOf(b.category)),
    ...selected.filter((g) => !HEADPHONE_SOURCE_ORDER.includes(g.category) && actsAsAudioInterface(g)),
  ]

  // ① マイク・楽器・ミキサー → オーディオIF・ミキサー
  // マイク／ミキサーの 3.5mm 出力はヘッドホンモニター用なので送り出しには使わない（XLR のみ）
  const senderOutPriority = (g: Gadget): PortType[] =>
    g.category === 'Instrument' ? ['XLR', 'Audio6_3mm', 'Audio6_3mm_TS', 'RCA', 'Audio3_5mm'] : ['XLR', 'Audio6_3mm', 'Audio6_3mm_TS', 'RCA']
  // XLR の途中に挟まる機器（インラインプリアンプ・マイクスプリッター等）。専用カテゴリが
  // 無いので「その他」で登録されるが、同じ端子が入って出るだけなのでマイクと
  // オーディオIF の間へ直列に挟む。挟まないと SM7B → FetHead → スプリッター → M2 が
  // SM7B → M2 の1本になり、間の機器が線も警告も無いまま図に浮く
  const INLINE_AUDIO_EXCLUDED: GadgetCategory[] = [
    'AudioInterface', 'Mixer', 'Amplifier', 'HeadphoneAmp', 'Speaker', 'Microphone', 'Headphone', 'Instrument',
  ]
  const hasXlr = (g: Gadget, direction: 'input' | 'output') =>
    g.ports.some((port) => port.type === 'XLR' && (port.direction === direction || port.direction === 'bidirectional'))
  const inlineAudioDevices = selected.filter((g) =>
    !INLINE_AUDIO_EXCLUDED.includes(g.category) && hasXlr(g, 'input') && hasXlr(g, 'output'))
  const usedInlineIds = new Set<string>()
  for (const sender of selected) {
    const isMicOrInstrument = sender.category === 'Microphone' || sender.category === 'Instrument'
    const isMixer = sender.category === 'Mixer'
    if (!isMicOrInstrument && !isMixer) continue
    if (prefersWireless(sender)) continue
    const mixerOutputPort = isMixer ? findAudioOutput(sender, senderOutPriority(sender), 'monitor') : null
    const outPort = mixerOutputPort?.type ?? findAvailablePort(usage, sender, senderOutPriority(sender), 'output')
    if (!outPort) continue
    // インライン機器がある分だけ経由させてから、最後の送り先を探す。
    // 直列に何台挟まっていても、出てくる端子は XLR のまま変わらない
    let chainFrom: Gadget = sender
    let chainOutPort: PortType = outPort
    if (isMicOrInstrument && outPort === 'XLR') {
      for (;;) {
        const inline = inlineAudioDevices.find((device) =>
          !usedInlineIds.has(device.id) &&
          device.id !== chainFrom.id &&
          !!findAvailablePort(usage, device, ['XLR'], 'input') &&
          !!findAvailablePort(usage, device, ['XLR'], 'output'))
        if (!inline) break
        const inlineIn = findAvailablePort(usage, inline, ['XLR'], 'input')!
        if (!addConn(chainFrom, chainOutPort, inline, inlineIn)) break
        usedInlineIds.add(inline.id)
        chainFrom = inline
        chainOutPort = 'XLR'
      }
    }
    const compatIn = PORT_COMPATIBILITY[outPort] ?? [outPort]
    // ミキサーのメイン出力はオーディオIFへ送る。送り先をIFに限ることで、
    // ミキサー同士が互いの入力へ繋がり合うループを避ける。
    // ただしDJプレーヤーのように音の出口しか持たない機器も同じカテゴリに入っており、
    // IFだけに限るとDJミキサーへ送る線が引けず、図から音の流れが消える。
    // 入力を持たない＝受け手になりえない側だけ、ミキサーへの送り出しを許す（ループは起きない）。
    const sendsOnly = isMixer && !sender.ports.some((port) =>
      (port.type === 'RCA' || port.type === 'XLR' || port.type === 'Audio6_3mm' || port.type === 'Audio6_3mm_TS') &&
      (port.direction === 'input' || port.direction === 'bidirectional'))
    const candidates = isMixer
      ? audioSinks.filter((h) => h.category === 'AudioInterface' || (sendsOnly && h.category === 'Mixer'))
      : audioSinks
    const sink = candidates.find((h) =>
      h.id !== sender.id && h.id !== chainFrom.id && findAvailablePort(usage, h, compatIn, 'input'))
    if (!sink) {
      // ミキサーは USB で PC と直結できるので、送り先が無くても警告しない。
      // USB でも PC に繋がるガジェット（USBマイク等）も Step3 の通常経路に任せる。
      // XLR しか出口がないガジェットだけ、繋ぎ先が無いことを警告する
      // USB-B は電子ピアノ・MIDI鍵盤・USBマイクの「PC接続」端子として今も現役で、
      // ステップ3では USB-B もデータ線として繋がる（usbPriority に入っている）。
      // ここから漏らすと、PC と USB で繋がっているガジェットにまで
      // 「オーディオインターフェースがありません」と出る
      // 判定は usbPriority（ステップ3が繋ぐ USB 端子）と揃える。microUSB を落としていたので、
      // micro-USB でホストへ繋がる USB マイク（SHURE MV7 等）にだけ警告が残っていた
      const hasUsbFallback = sender.ports.some(
        (p) => (p.type === 'USB_C' || p.type === 'USB_A' || p.type === 'USB_B' || p.type === 'microUSB') &&
          p.direction === 'input')
      if (!isMixer && !hasUsbFallback) {
        warnings.push(audioHubs.length === 0
          ? (lang === 'en'
              ? `${sender.name}: No audio interface or mixer to connect to`
              : `${sender.name}: 接続先のオーディオインターフェース・ミキサーがありません`)
          : (lang === 'en'
              ? `${sender.name}: No free input on the audio interface / mixer`
              : `${sender.name}: オーディオインターフェース・ミキサーの入力に空きがありません`))
      }
      continue
    }
    const inPort = findAvailablePort(usage, sink, compatIn, 'input')!
    if (mixerOutputPort) addAudioConn(sender, mixerOutputPort, sink, inPort)
    else addConn(chainFrom, chainOutPort, sink, inPort)
  }

  // ①-a' 3.5mm プラグのマイク（ピンマイク・卓上マイク）は PC のマイク端子へ挿す。
  // オーディオIF の入力は XLR・フォーンなので、上の送り先探しでは相手が見つからず線が消えていた
  // USB マイクの 3.5mm はヘッドホンを挿す口なので対象外（USB は Step3 で PC へ繋がる）
  const MIC_HOST_INPUTS: PortType[] = ['USB_C', 'USB_A', 'USB_B', 'microUSB', 'Lightning']
  for (const mic of selected.filter((g) => g.category === 'Microphone')) {
    if (connections.some((c) => c.fromGadgetId === mic.id && c.cableType !== 'MicArm')) continue
    if (mic.ports.some((p) => MIC_HOST_INPUTS.includes(p.type) && p.direction !== 'output')) continue
    const plug = mic.ports.find((p) => p.type === 'Audio3_5mm' && p.direction !== 'input')
    if (!plug || /ヘッドホン|イヤホン|headphone|monitor/i.test(plug.label ?? '')) continue
    if (!findAvailablePort(usage, mic, ['Audio3_5mm'], 'output')) continue
    const host = computers.find((pc) => !!findAvailablePort(usage, pc, ['Audio3_5mm'], 'input'))
    if (host) addConn(mic, 'Audio3_5mm', host, 'Audio3_5mm')
  }

  // ①-b オーディオIF・ミキサー・DAC・PC → アンプ
  // スピーカーへ配る前にアンプ側の入力を決める。ここを後回しにすると、
  // アンプが繋がっていないのにパッシブスピーカーだけが鳴っている図になる
  const AMP_INPUT_PRIORITY: PortType[] = ['XLR', 'Audio6_3mm', 'RCA', 'CoaxialAudio', 'OpticalAudio', 'Audio3_5mm']
  for (const amplifier of amplifiers) {
    const feeders = [
      ...selected.filter((g) => g.category === 'AudioInterface' || g.category === 'Mixer' || g.category === 'HeadphoneAmp'),
      ...computers,
    ]
    let fed = false
    for (const inPort of AMP_INPUT_PRIORITY) {
      if (!findAvailablePort(usage, amplifier, [inPort], 'input')) continue
      const compatOut = PORT_COMPATIBILITY[inPort] ?? [inPort]
      const source = feeders.find((candidate) =>
        candidate.id !== amplifier.id && !!findAvailablePort(usage, candidate, compatOut, 'output'))
      if (!source) continue
      const outPort = findAvailablePort(usage, source, compatOut, 'output')!
      const sourcePort = findAudioOutput(source, compatOut, 'monitor')
      fed = sourcePort ? addAudioConn(source, sourcePort, amplifier, inPort) : addConn(source, outPort, amplifier, inPort)
      if (fed) break
    }
    // Bluetooth で音を受けるアンプ（小型デジタルアンプに多い）は、有線の音源が無ければ
    // PC・スマホから Bluetooth で鳴らす。受けの口しか無いので Step3 の無線接続では拾われない
    if (!fed && amplifier.ports.some((p) => p.type === 'Bluetooth' && p.direction !== 'output')) {
      const btFeeder = [...computers, ...selected.filter((g) => g.category === 'Smartphone' || g.category === 'Tablet')]
        .find((g) => g.id !== amplifier.id && !isDismissed(g.id, amplifier.id, 'Bluetooth'))
      if (btFeeder) {
        connections.push({
          id: `bt-${connIndex++}`,
          fromGadgetId: btFeeder.id,
          fromPortType: 'Bluetooth',
          toGadgetId: amplifier.id,
          toPortType: 'Bluetooth',
          cableType: 'Bluetooth',
        })
        fed = true
      }
    }
    // USB で PC と直結できるアンプは Step3 の通常経路に任せる
    const hasUsbFallback = amplifier.ports.some(
      (p) => (p.type === 'USB_C' || p.type === 'USB_A' || p.type === 'USB_B') && p.direction === 'input')
    if (!fed && !hasUsbFallback) {
      warnings.push(lang === 'en'
        ? `${amplifier.name}: No audio source to feed the amplifier`
        : `${amplifier.name}: アンプへ音を送るガジェットがありません`)
    }
  }

  // ② アンプ・オーディオIF・ミキサー → スピーカー
  // パッシブスピーカーはスピーカー端子しか持たないので最優先で見る
  const SPEAKER_INPUT_PRIORITY: PortType[] = ['SpeakerTerminal', 'XLR', 'XLR_TRS_Combo', 'Audio6_3mm', 'Audio6_3mm_TS', 'RCA', 'Audio3_5mm']
  // 片方だけにアンプが入っているパワードスピーカー（YAMAHA HS3/HS4・Kanto・Eris 等）。
  // 相方はスピーカー端子しか持たないので、アンプ内蔵側から鳴らすのが実物の繋ぎ方になる。
  // 音源をアンプ・オーディオIF・ミキサーだけに限ると、目の前に出口があるのに
  // 「アンプが必要です」と言われて線が1本も引かれない
  const poweredSpeakerHosts = selected.filter((g) =>
    g.category === 'Speaker' &&
    g.ports.some((port) => port.type === 'SpeakerTerminal' &&
      (port.direction === 'output' || port.direction === 'bidirectional')),
  )
  for (const speaker of selected) {
    if (speaker.category !== 'Speaker') continue
    if (prefersWireless(speaker)) continue
    // 主側から結び終えた従側は、音源を別に探すと2本目が生えてしまう
    if (pairedSpeakerIds.has(speaker.id)) continue
    // 入力端子を1つ選んで諦めると、XLR と 6.3mm の両方を持つモニタースピーカーが
    // 「XLR に繋げる相手がいない」だけで信号線ゼロになる。繋がる組み合わせが
    // 見つかるまで入力側の候補を順に試す
    let paired: { inPort: PortType; src: Gadget; outPort: PortType } | null = null
    let hasXlrInput = false
    for (const inPort of SPEAKER_INPUT_PRIORITY) {
      if (!findAvailablePort(usage, speaker, [inPort], 'input')) continue
      if (inPort === 'XLR') hasXlrInput = true
      const compatOut = PORT_COMPATIBILITY[inPort] ?? [inPort]
      // スピーカー端子で受けるときだけ、アンプ内蔵の相方も音源候補に入れる
      const candidates = inPort === 'SpeakerTerminal'
        ? [...monitorAudioSources, ...poweredSpeakerHosts]
        : monitorAudioSources
      const src = candidates.find((source) =>
        source.id !== speaker.id && !!findAudioOutput(source, compatOut, 'monitor'))
      if (!src) continue
      paired = { inPort, src, outPort: findAudioOutput(src, compatOut, 'monitor')!.type }
      break
    }
    if (!paired) {
      // 3.5mm・6.3mm（変換ケーブル）入力なら Step3 で PC・ハブから鳴らせる。XLR 入力しか
      // 持たないスピーカーは繋げる相手がオーディオIF・ミキサーしかないため、ここが最後の機会になる
      const hasLineLevelFallback = speaker.ports.some((port) =>
        (port.type === 'Audio3_5mm' || port.type === 'RCA' || port.type === 'Audio6_3mm' || port.type === 'Audio6_3mm_TS') &&
        (port.direction === 'input' || port.direction === 'bidirectional'),
      )
      // パッシブスピーカーはアンプ以外に繋ぎ先が無い。線が引けなかった理由を明示する
      const isPassive = speaker.ports.some((port) =>
        port.type === 'SpeakerTerminal' && (port.direction === 'input' || port.direction === 'bidirectional'))
      if (isPassive) {
        const hasDriver = amplifiers.length > 0 ||
          poweredSpeakerHosts.some((host) => host.id !== speaker.id)
        warnings.push(!hasDriver
          ? (lang === 'en'
              ? `${speaker.name}: Passive speakers need an amplifier`
              : `${speaker.name}: パッシブスピーカーを鳴らすにはアンプが必要です`)
          : (lang === 'en'
              ? `${speaker.name}: No free speaker terminal on the amplifier`
              : `${speaker.name}: アンプのスピーカー端子に空きがありません`))
        continue
      }
      if (hasXlrInput && !hasLineLevelFallback) {
        warnings.push(lang === 'en'
          ? `${speaker.name}: XLR input requires an audio interface or mixer`
          : `${speaker.name}: XLR入力のスピーカーにはオーディオインターフェース・ミキサーが必要です`)
      }
      continue
    }
    const sourcePort = findAudioOutput(paired.src, PORT_COMPATIBILITY[paired.inPort] ?? [paired.inPort], 'monitor')
    if (sourcePort) addAudioConn(paired.src, sourcePort, speaker, paired.inPort)
  }

  // ③ MIDI OUT / THRU → MIDI IN
  // 5pin DIN と 3.5mm TRS は変換ケーブルが要る別端子なので、同じ型どうしでのみ繋ぐ
  for (const midiType of ['MIDI', 'MIDI_TRS'] as PortType[]) {
    for (const sender of selected) {
      if (sender.category !== 'Instrument' && sender.category !== 'AudioInterface' && sender.category !== 'Mixer') continue
      const outPort = findAvailablePort(usage, sender, [midiType], 'output')
      if (!outPort) continue
      const targetCategories: GadgetCategory[] = sender.category === 'Instrument'
        ? ['AudioInterface', 'Mixer', 'Instrument']
        : ['Instrument']
      const target = selected.find((candidate) =>
        candidate.id !== sender.id &&
        targetCategories.includes(candidate.category) &&
        !!findAvailablePort(usage, candidate, [midiType], 'input'),
      )
      if (target) addConn(sender, midiType, target, midiType)
    }
  }

  // === ステップ2e: モニターのUSBハブを上流へ繋ぐ ===
  // モニターのUSB出力は、PCとUSBで繋がっていて初めて使える。
  // USB-C / Thunderbolt の映像ケーブル1本ならUSBも一緒に通るが、HDMI・DPだけで
  // 繋いだモニターは USB-B アップストリームのケーブルが別に要る。
  // ここを繋がないままハブ扱いすると、PCと繋がっていないハブに周辺機器が
  // ぶら下がる図になってしまう（実際には1台も動かない配線）。
  const carriesUsbData = (cableType: CableType) =>
    cableType === 'USB_C' || cableType === 'Thunderbolt' || cableType === 'USB_A_to_C' ||
    cableType === 'USB_A_to_B' || cableType === 'USB_C_to_B'
  const isUsbLinkedToUpstream = (g: Gadget) => connections.some((connection) =>
    connection.toGadgetId === g.id &&
    connection.fromGadgetId !== 'failed' &&
    carriesUsbData(connection.cableType),
  )
  for (const monitor of monitors) {
    if (!hasUsbOutput(monitor) || isUsbLinkedToUpstream(monitor)) continue
    // USB-Bだけでなく、KVM用のデータ専用USB-C/TBアップストリームも使う。
    // HDMI/DP表示中に空いているフル機能USB-Cをデータ上流として使える製品もあるため、
    // 専用端子を先にしつつ、未使用の映像兼用端子も最後の候補へ残す。
    const usbUpstreamPorts = monitor.ports
      .filter((port) =>
        (port.direction === 'input' || port.direction === 'bidirectional') &&
        (port.type === 'USB_B' || port.type === 'USB_C' || port.type === 'Thunderbolt') &&
        !isChargingOnlyPort(port),
      )
      .sort((a, b) => Number(a.supportsVideo === true) - Number(b.supportsVideo === true))
    const upstreamInputTypes = [...new Set(usbUpstreamPorts.map((port) => port.type))]
    let linked = false
    for (const inPort of upstreamInputTypes) {
      if (!findAvailablePort(usage, monitor, [inPort], 'input')) continue
      const source = [...computers, ...connectedUpstreamDevices].find((candidate) =>
        USB_HOST_OUTPUTS.some((outPort) =>
          (PORT_COMPATIBILITY[outPort] ?? [outPort]).includes(inPort) &&
          !!findAvailablePort(usage, candidate, [outPort], 'output'),
        ),
      )
      if (!source) continue
      const outPort = USB_HOST_OUTPUTS.find((type) =>
        (PORT_COMPATIBILITY[type] ?? [type]).includes(inPort) &&
        !!findAvailablePort(usage, source, [type], 'output'),
      )
      if (outPort && addConn(source, outPort, monitor, inPort)) {
        linked = true
        break
      }
    }
    if (linked) continue
  }

  // 周辺機器への割り当ては従来の優先順位（Dock → Hub → PC）を保ち、
  // USB出力を持つMonitorをその後へ加える。同カテゴリ内は選択順で、満杯なら次候補へ送る。
  // モニターは上流とUSBで繋がったものだけ。繋がっていないハブに周辺機器を割り当てない。
  // ゲーム機のドックを PC のいるデスクで分配元にすると、PC の周辺機器まで吸われてしまう。
  // ただし PC がいないデスク（Switch だけの構成）では、ドックの USB-A が周辺機器の
  // 唯一の繋ぎ先になる。除外したままだと繋ぎ先ゼロで「ポートが不足」と言うことになる
  const usbDistributionSources = selected
    .filter((g) =>
      (g.category === 'Dock' || g.category === 'Hub' || g.category === 'Monitor' || g.category === 'KVM') &&
      (!isConsoleDock(g) || computers.length === 0) &&
      hasUsbOutput(g) &&
      (g.category !== 'Monitor' || isUsbLinkedToUpstream(g)),
    )
    .sort((a, b) =>
      ['Dock', 'Hub', 'Monitor', 'KVM'].indexOf(a.category) -
      ['Dock', 'Hub', 'Monitor', 'KVM'].indexOf(b.category),
    )

  // === ステップ3: ペリフェラル接続 ===
  // Bluetooth対応ガジェットはケーブルなしのワイヤレス接続を優先する
  // wiredOverrides に含まれるガジェットは強制的に有線接続
  // micro-USB は USB マイク・小型機器の「PC接続」端子として現役。ここから漏らすと
  // データ線が引かれず、ステップ4で充電線として充電器へ繋がれてしまう
  // Lightning は PC と有線で繋ぐ Lightning の iPad（サブ画面・ファイル転送）のため。スマホ・Watch は
  // CHARGE_ONLY_CATEGORIES で先に抜け、Bluetooth で繋がる機器も手前で抜けるので、ここで拾うのはタブレットだけ
  const usbPriority: PortType[] = ['USB_C', 'USB_A', 'USB_B', 'microUSB', 'Lightning']
  // Bluetooth の親。PC が無ければタブレット、次にスマホ。ハブ・ドックは Bluetooth を持たないので
  // 親にしない（以前は PC が無いとハブを選び、持っていない口から線が出ていた）
  const btSource = computers[0] ??
    selected.find((g) => g.category === 'Tablet') ??
    selected.find((g) => g.category === 'Smartphone')

  // タブレット用のペンは線で結ばず、使うタブレットのカードへ内包して示す（吸着＝Stylus）。
  // ペアリングも充電もそのタブレットとの間で完結するので、Bluetooth や充電の線を引くと
  // 線1本ぶんの幅を取るだけで、ペンが何に付くのかはかえって読み取りにくくなる
  const attachedPenIds = new Set<string>()
  const tablets = selected.filter((g) => g.category === 'Tablet')
  for (const pen of selected.filter((g) => isTabletPen(g) && !wiredOverrides.includes(g.id))) {
    attachedPenIds.add(pen.id)
    const chosen = tablets.find((g) => g.id === pen.bluetoothTargetGadgetIds?.[0])
    // 指定が無ければ、そのペンを充電できるタブレット→ペン対応のタブレット→先頭の順に選ぶ
    const host = chosen ??
      tablets.find((g) => g.ports.some((p) => p.type === 'wirelessCharging' && p.direction === 'output')) ??
      tablets.find((g) => g.ports.some((p) => p.type === 'Stylus')) ??
      tablets[0]
    if (!host) {
      warnings.push(lang === 'en'
        ? `${pen.name}: No tablet to use it with. Add the tablet this pen is used with.`
        : `${pen.name}: 使うタブレットがありません。このペンを使うタブレットを追加してください。`)
      continue
    }
    if (isDismissed(host.id, pen.id, 'Stylus')) continue
    connections.push({
      id: `stylus-${connIndex++}`,
      fromGadgetId: host.id,
      fromPortType: 'Stylus',
      toGadgetId: pen.id,
      toPortType: 'Stylus',
      cableType: 'Stylus',
    })
  }
  for (const accessory of selected.filter((g) => g.category === 'Accessory' && !attachedPenIds.has(g.id))) {
    const tablet = selected.find((g) =>
      g.category === 'Tablet' &&
      findAvailablePort(usage, g, ['wirelessCharging'], 'output'),
    )
    const accessoryPort = findAvailablePort(usage, accessory, ['wirelessCharging'], 'input')
    if (tablet && accessoryPort) addConn(tablet, 'wirelessCharging', accessory, accessoryPort)
  }
  for (const peripheral of peripherals) {
    // スマートホームガジェットは通信経路を表示せず、Step4の電源・給電だけを処理する。
    if (isSmartHomeGadget(peripheral)) continue
    // ライト・HDMI映像出力ありのゲーム機はデータ接続不要 → Step4 で電源のみ処理
    if (peripheral.category === 'Light' && !hasBluetoothOut(peripheral)) continue
    if (
      peripheral.category === 'GameConsole' &&
      peripheral.ports.some(
        (p) => (p.type === 'HDMI' || p.type === 'DisplayPort') && p.direction === 'output'
      )
    ) continue
    if (peripheral.category === 'GameConsole') continue
    if (
      !wiredOverrides.includes(peripheral.id) &&
      connections.some((connection) =>
        connection.toGadgetId === peripheral.id && connection.cableType === 'WiFi',
      )
    ) continue
    if (
      peripheral.category === 'Tablet' &&
      connections.some((connection) =>
        (connection.toGadgetId === peripheral.id &&
          connection.toPortType === 'USB_C' &&
          connection.fromGadgetId !== 'failed') ||
        // PC の無いデスクでハブ・ドックの上流になった・モニターへ映像を出したタブレットは、
        // その1本で端子を使っている。周辺機器としてもう1本引かない
        (connection.fromGadgetId === peripheral.id && connection.cableType !== 'Bluetooth' &&
          connection.cableType !== 'wirelessCharging' && connection.cableType !== 'Stylus'),
      )
    ) continue
    // ステップ2d-② で信号線を引いたスピーカーには、空いている別の入力端子へもう1本引かない。
    // XLR と 6.3mm TRS を両方持つモニタースピーカーが2本受けになり、しかも
    // オーディオIF の出力が尽きた側だけ PC のヘッドホン端子に繋がって左右が別音源になっていた
    if (
      peripheral.category === 'Speaker' &&
      connections.some((connection) =>
        connection.toGadgetId === peripheral.id &&
        SPEAKER_INPUT_PRIORITY.includes(connection.toPortType),
      )
    ) continue

    // 「接続先」が明示指定されている場合はそれを優先する（コントローラー・イヤホン等）
    const explicitTarget = peripheral.bluetoothTargetGadgetIds?.[0]
      ? selected.find((g) => g.id === peripheral.bluetoothTargetGadgetIds![0])
      : undefined
    const defaultControllerTarget = peripheral.category === 'Controller'
      ? selected.find((g) => g.category === 'GameConsole')
      : undefined
    const defaultSmartwatchTarget = peripheral.category === 'Smartwatch'
      ? selected.find((g) => g.category === 'Smartphone')
      : undefined
    const defaultAccessoryTarget = peripheral.category === 'Accessory'
      ? selected.find((g) => g.category === 'Tablet')
      : undefined
    // トランスミッターがある構成では、それを買った理由がまさに「ここへ飛ばすため」なので
    // スマホより先に見る
    const defaultSmartAudioTarget = peripheral.category === 'Headphone' || peripheral.category === 'Earphone'
      ? selected.find((g) => isBluetoothTransmitter(g)) ?? selected.find((g) => g.category === 'Smartphone')
      : undefined
    const defaultVrTarget = peripheral.category === 'VRGlass'
      ? selected.find((g) => g.category === 'Smartphone' || g.category === 'Tablet')
      : undefined
    // PS VR2はPC向けVRと違い、PS5本体がUSB-Cのデータホストになる。
    const defaultVrDataTarget = peripheral.category === 'VRGlass' && /PlayStation\s*VR2/i.test(peripheral.name)
      ? selected.find((g) => g.category === 'GameConsole' && /PlayStation\s*5|PS5/i.test(`${g.name} ${g.model ?? ''}`))
      : undefined
    const defaultXboxExpansionTarget = peripheral.ports.some((port) => port.type === 'XboxExpansion')
      ? selected.find((g) => g.category === 'GameConsole' && /Xbox\s*Series/i.test(`${g.name} ${g.model ?? ''}`))
      : undefined
    const wiredTarget = explicitTarget ?? defaultVrDataTarget ?? defaultXboxExpansionTarget

    // Xbox本体と対応アクセサリの接続はBluetoothではなくXbox Wirelessを使う。
    // コントローラー自体はPC・スマホ用Bluetoothも持つため、Xboxがある場合だけ先に専用無線を選ぶ。
    const xboxWirelessPort = peripheral.ports.find((port) =>
      port.type === 'XboxWireless' && (port.direction === 'input' || port.direction === 'bidirectional'))
    const xboxWirelessTarget = explicitTarget?.ports.some((port) =>
      port.type === 'XboxWireless' && (port.direction === 'output' || port.direction === 'bidirectional'))
      ? explicitTarget
      : selected.find((g) =>
          g.category === 'GameConsole' &&
          /Xbox\s*Series/i.test(`${g.name} ${g.model ?? ''}`) &&
          g.ports.some((port) => port.type === 'XboxWireless' && (port.direction === 'output' || port.direction === 'bidirectional')))
    if (xboxWirelessPort && xboxWirelessTarget && !wiredOverrides.includes(peripheral.id)) {
      if (!isDismissed(xboxWirelessTarget.id, peripheral.id, 'XboxWireless')) {
        connections.push({
          id: `xbox-wireless-${connIndex++}`,
          fromGadgetId: xboxWirelessTarget.id,
          fromPortType: 'XboxWireless',
          toGadgetId: peripheral.id,
          toPortType: 'XboxWireless',
          cableType: 'XboxWireless',
        })
      }
      continue
    }

    // Bluetooth接続できるか確認（充電器・電源タップは除外）
    const hasBluetooth =
      peripheral.category !== 'Charger' &&
      peripheral.category !== 'MobileBattery' &&
      peripheral.category !== 'PowerStrip' &&
      hasBluetoothOut(peripheral) &&
      !hasReceiverInput(peripheral) &&
      // トランスミッターは送り手。ここで受け手にすると有線の入口が使われない
      !isBluetoothTransmitter(peripheral) &&
      // スマホ・タブレットはキーボードやイヤホンを受ける親の側。Bluetooth の口を持つからと
      // 周辺機器にすると、PC からスマホ・iPad へ Bluetooth の線が引かれていた（接続先の指定は尊重する）
      (!BLUETOOTH_HOST_CATEGORIES.has(peripheral.category) || !!explicitTarget)
    const useBluetooth = hasBluetooth && !wiredOverrides.includes(peripheral.id)

    // タブレット用のペンは上でタブレットへ内包済み。PC とのペアリングや USB のデータ線は引かない
    if (attachedPenIds.has(peripheral.id)) continue

    if (useBluetooth) {
      const btTarget = explicitTarget ?? defaultControllerTarget ?? defaultSmartwatchTarget ?? defaultAccessoryTarget ?? defaultSmartAudioTarget ?? defaultVrTarget ?? btSource
      if (btTarget && !isDismissed(btTarget.id, peripheral.id, 'Bluetooth')) {
        if (canHostBluetooth(btTarget)) {
          // ワイヤレス接続（ケーブルなし）
          connections.push({
            id: `bt-${connIndex++}`,
            fromGadgetId: btTarget.id,
            fromPortType: 'Bluetooth',
            toGadgetId: peripheral.id,
            toPortType: 'Bluetooth',
            cableType: 'Bluetooth',
          })
          // USB入力ポートはケーブル接続しない（Step4で充電として処理）
          continue
        }
      }
      if (btTarget) continue
    }

    // 身につけて持ち歩くガジェットは充電と Bluetooth で使うもので、PC へ挿しっぱなしにはしない。
    // 「充電・データ」兼用の端子（Lightning・USB-C）や専用クレードルの口をデータ線として拾うと、
    // テンプレートを適用しただけで PC と有線接続されているように見える。
    // 有線を明示した場合を除いてデータ線は引かず、充電線だけをステップ4に任せる。
    if (CHARGE_ONLY_CATEGORIES.includes(peripheral.category) && !wiredOverrides.includes(peripheral.id)) continue

    // Ethernet はステップ2c（ルーター起点の一方向配線）で扱い済みなのでここでは対象外
    // イヤホン・ヘッドホン・スピーカーは有線なら3.5mmオーディオ端子を優先する。
    // スピーカーは特に、音声端子を先に使ってUSB/Power入力を給電用に残す必要がある
    // （USBを先にデータ接続へ割り当てると、有線スピーカーの給電線が生成できなくなる）。
    const isAudioPeripheral = peripheral.category === 'Speaker' || peripheral.category === 'Headphone' || peripheral.category === 'Earphone'

    // 有線データ接続
    // PCからの給電はせず、ハブ/ドック（壁給電）を優先する。接続先が明示指定されていればそれを優先。
    // ヘッドホン・スピーカーは、オーディオIF・ミキサーがあればその出力から鳴らす（実機の繋ぎ方に合わせる）
    const wiredPcPeripheral = peripheral.category === 'Mouse' || peripheral.category === 'Keyboard'
    // 2.4GHzレシーバーだけは PC 直挿しを優先する。モニターやハブのUSB口に回すと
    // 遅延・途切れの原因になり、実際にそう挿す人はいない。
    const preferDirectPc = hasReceiverInput(peripheral) || (wiredPcPeripheral && upstreamDevices.length > 0)
    // 音声・MIDI・キャプチャ・VR はモニターの USB 口を最後に回す。モニターを消すと
    // ハブごと電源が落ちる機種が多く、録音・配信の途中で機器が DAW や配信ソフトから消える。
    // ドック・ハブは自前の電源で動くので従来どおり先に使う（ノートPCのケーブル1本の構成を崩さない）。
    // ノートPCはモニターのハブがドック代わりで、本体の USB-C は充電・映像に要るので対象外
    const avoidMonitorHub = !preferDirectPc && NO_MONITOR_HUB_CATEGORIES.has(peripheral.category) &&
      computers.length > 0 && computers.every((pc) => pc.pcFormFactor !== 'laptop')
    const audioOutputRole: AudioOutputRole = peripheral.category === 'Speaker' ? 'monitor' : 'headphone'
    const audioSourceCandidates = peripheral.category === 'Speaker' ? monitorAudioSources : headphoneAudioSources
    // バランス出力しか持たないヘッドホンアンプもあるので、探す出力に 4.4mm / XLR 4pin を含める
    const HEADPHONE_OUT_TYPES: PortType[] = ['Audio6_3mm', 'Audio4_4mm', 'XLR4pin', 'Audio3_5mm']
    const audioHubSource = isAudioPeripheral
      ? audioSourceCandidates.find((source) =>
          source.id !== peripheral.id && !!findAudioOutput(source, HEADPHONE_OUT_TYPES, audioOutputRole),
        )
      : undefined
    const inputPriority = hasReceiverInput(peripheral)
      ? (['USB_A', 'USB_C', 'Audio6_3mm', 'Audio3_5mm'] as PortType[])
      : isAudioPeripheral
      ? (['Audio4_4mm', 'XLR4pin', 'Audio6_3mm', 'Audio3_5mm', ...usbPriority] as PortType[])
      // アンプのライン入力はステップ2d-①bで決めている。ここでも探すと、
      // DAC から受けているアンプに PC のヘッドホン端子からもう1本引かれて二重入力になる
      : peripheral.category === 'Amplifier'
      ? ([...usbPriority] as PortType[])
      : (['XboxExpansion', ...usbPriority, 'Audio6_3mm', 'Audio3_5mm'] as PortType[])
    // 給電専用ポート（充電器から受電するための口）はデータ接続に使わない。
    // ここで拾ってしまうと、スマホ・タブレット等が充電線ではなく PC からのデータ線になり、
    // ステップ4の給電が「データケーブルが給電兼用」と判断してスキップされる
    // ただし有線を強制したガジェットは除く（充電ケーブルを挿して有線で使う、という指定を尊重する）
    // 入力端子は「ガジェットが持っている最優先の1つ」ではなく、
    // 「繋げる相手がいる最優先の1つ」を選ぶ。1つ選んで諦めると、4.4mm と 3.5mm の
    // 両方を持つヘッドホンが「4.4mm の相手がいない」だけで1本も繋がらなくなる
    // （スピーカーのステップ2d-②が同じ理由で候補を順に試している）。
    const portFilter = wiredOverrides.includes(peripheral.id)
      ? undefined
      : (p: Port) => !isChargingOnlyPort(p)
    // キャプチャは、映像を入れている PC 以外が USB で受け取る。同じ PC が映像を出して
    // 同じ PC が録る配線は 2PC 配信では成立せず、配信用PCに映像が1本も届かない図になる。
    // PC が1台しかない構成では候補が変わらないので、従来の配線のまま
    const videoFeederId = peripheral.category === 'CaptureDevice'
      ? connections.find((connection) =>
          connection.toGadgetId === peripheral.id &&
          DISPLAY_PORT_PRIORITY.includes(connection.toPortType) &&
          computers.some((pc) => pc.id === connection.fromGadgetId))?.fromGadgetId
      : undefined
    const hostComputers = videoFeederId
      ? [...computers.filter((g) => g.id !== videoFeederId), ...computers.filter((g) => g.id === videoFeederId)]
      : computers
    // ハブ・ドックは上流の PC の延長でしかない。映像元 PC にぶら下がるハブを候補の先頭に
    // 残すと、PC 直結を避けてもハブ経由で同じ PC に戻り、自己ループが素通りしてしまう
    const upstreamPcIdOf = (device: Gadget): string | undefined => {
      const seen = new Set<string>()
      let currentId: string | undefined = device.id
      while (currentId && !seen.has(currentId)) {
        seen.add(currentId)
        const fromPc = connections.find((connection) =>
          connection.toGadgetId === currentId && computers.some((pc) => pc.id === connection.fromGadgetId))
        if (fromPc) return fromPc.fromGadgetId
        currentId = connections.find((connection) =>
          connection.toGadgetId === currentId &&
          upstreamDevices.some((up) => up.id === connection.fromGadgetId))?.fromGadgetId
      }
      return undefined
    }
    // 映像元にぶら下がるハブは、他の PC よりも後ろへ置く。ハブ内部の並べ替えだけだと
    // 他のハブが埋まった時点でそこへ落ちてしまい、結局同じ PC へ戻る
    const feederDistributionSources = videoFeederId
      ? usbDistributionSources.filter((g) => upstreamPcIdOf(g) === videoFeederId)
      : []
    const hostDistributionSources = videoFeederId
      ? usbDistributionSources.filter((g) => upstreamPcIdOf(g) !== videoFeederId)
      : usbDistributionSources
    const earlyDistributionSources = avoidMonitorHub
      ? hostDistributionSources.filter((g) => g.category !== 'Monitor')
      : hostDistributionSources
    const lateMonitorSources = avoidMonitorHub
      ? hostDistributionSources.filter((g) => g.category === 'Monitor')
      : []
    const sourceCandidatesFor = (candidateIn: PortType) => {
      const compat = upstreamTypesFor(candidateIn)
      return (preferDirectPc
        ? [
            ...(wiredTarget ? [wiredTarget] : []),
            ...hostComputers,
            ...hostDistributionSources,
            ...feederDistributionSources,
          ]
        : [
            ...(wiredTarget ? [wiredTarget] : []),
            ...(audioHubSource ? [audioHubSource] : []),
            ...earlyDistributionSources,
            ...hostComputers,
            ...lateMonitorSources,
            ...feederDistributionSources,
          ]).filter((candidate, index, list) =>
            candidate.id !== peripheral.id &&
            list.findIndex((item) => item.id === candidate.id) === index)
        .find((candidate) => !!findAvailablePort(usage, candidate, compat, 'output'))
    }
    const available = inputPriority.filter((type) =>
      !!findAvailablePort(usage, peripheral, [type], 'input', false, portFilter))
    // 相手が見つかる端子を優先し、1つも無ければ従来どおり最優先の端子で警告を出す
    const inPort = available.find((type) => !!sourceCandidatesFor(type)) ?? available[0] ?? null
    const vrHasDataPort = peripheral.category !== 'VRGlass' || peripheral.ports.some((port) =>
      (port.type === 'USB_C' || port.type === 'USB_A' || port.type === 'DisplayPort') &&
      (port.direction === 'input' || port.direction === 'bidirectional') &&
      (port.supportsVideo === true || /データ|Link|接続/i.test(port.label ?? '')) &&
      !POWER_SUPPLY_LABEL.test(port.label ?? ''),
    )
    if (!vrHasDataPort) continue
    if (peripheral.category === 'VRGlass' && computers.length === 0 && upstreamDevices.length === 0 && !wiredTarget) continue
    if (!inPort) {
      // USB-C 1本で映像もデータも受ける機器（液タブ・モバイルモニター）は、
      // ステップ2a で唯一の入力を使い切っている。空きが無いのは「繋がっているから」で、
      // ここで警告を出すと繋がっている機器に「接続できません」と言うことになる。
      // 給電だけの線は host とみなさない（充電しかされていない機器は従来どおり警告する）
      const alreadyHosted = connections.some((connection) =>
        connection.toGadgetId === peripheral.id &&
        !connection.chargingOnly &&
        !connection.id.startsWith('failed') &&
        connection.fromGadgetId !== 'wall' &&
        connection.cableType !== 'Power' &&
        connection.cableType !== 'DCPower' &&
        connection.cableType !== 'wirelessCharging')
      if (REQUIRES_INPUT_HOST.has(peripheral.category) && !alreadyHosted) {
        warnings.push(lang === 'en'
          ? `${peripheral.name}: No input connection to a PC or other host. Add Bluetooth, a USB receiver, or a wired data port.`
          : `${peripheral.name}: PCなどの操作先へ接続できません。Bluetooth・USBレシーバー・有線データ端子のいずれかを設定してください。`)
      }
      continue // 電源のみのガジェット（ライト等）はスキップ
    }

    const compatOut = upstreamTypesFor(inPort)
    const sourceCandidates = preferDirectPc
      ? [
          ...(wiredTarget ? [wiredTarget] : []),
          ...hostComputers,
          ...hostDistributionSources,
          ...feederDistributionSources,
        ]
      : [
          ...(wiredTarget ? [wiredTarget] : []),
          ...(audioHubSource ? [audioHubSource] : []),
          ...earlyDistributionSources,
          ...hostComputers,
          ...lateMonitorSources,
          ...feederDistributionSources,
        ]
    const source = sourceCandidatesFor(inPort)
    if (!source) {
      // バランス端子は同じ端子どうしでしか繋がらない。「ポートが不足」だけだと
      // 何を買えばいいのか読み取れないので、必要な出力を名指しする
      const balancedLabel = inPort === 'Audio4_4mm' ? '4.4mm バランス'
        : inPort === 'XLR4pin' ? 'XLR 4pin バランス'
        : null
      if (balancedLabel) {
        warnings.push(lang === 'en'
          ? `${peripheral.name}: Needs a headphone amp or DAC with a ${inPort === 'Audio4_4mm' ? '4.4mm balanced' : 'XLR 4-pin balanced'} output.`
          : `${peripheral.name}: ${balancedLabel}出力を持つヘッドホンアンプ・DACが必要です。`)
        connections.push({
          id: `failed-${connIndex++}`,
          fromGadgetId: 'failed',
          fromPortType: inPort,
          toGadgetId: peripheral.id,
          toPortType: inPort,
          cableType: inPort,
        })
        continue
      }
      // PC の無いデスクでは、タブレットが USB 機器（オーディオIF・SSD 等）を直接つなぐホストになる
      if (computers.length === 0 && !wiredTarget && peripheral.category !== 'Tablet') {
        const hostTablet = selected.find((g) => g.category === 'Tablet' &&
          !!tabletHostPortFor(g, (type) => upstreamTypesFor(inPort).includes(type)))
        const hostType = hostTablet && tabletHostPortFor(hostTablet, (type) => upstreamTypesFor(inPort).includes(type))
        if (hostTablet && hostType && addTabletHostConn(hostTablet, hostType, peripheral, inPort)) continue
      }
      // それ自体で使える機材（タブレット・ストリーミング端末 等）は、PC の無いデスクでは繋がないのが正しい
      if (STANDALONE_WITHOUT_HOST.has(peripheral.category) && computers.length === 0 && !wiredTarget) continue
      // 候補の一覧は自分自身（KVM・ハブ）を含みうる。自分の名前でポート不足と言わないよう外す
      const otherCandidates = sourceCandidates.filter((candidate) => candidate.id !== peripheral.id)
      // Lightning の iPad はケーブル1本では USB 機器のホストになれない（実機でも Lightning - USB
      // カメラアダプタを挟む）。ここで「つなぐPCがありません」と言うと、iPad を置いた人には意味が通らない
      const lightningTablet = otherCandidates.length === 0 && computers.length === 0 && !wiredTarget &&
        ['USB_C', 'USB_A', 'USB_B', 'microUSB', 'Thunderbolt'].includes(inPort)
        ? selected.find((g) => g.category === 'Tablet' && g.ports.some((port) => port.type === 'Lightning'))
        : undefined
      if (lightningTablet) {
        warnings.push(lang === 'en'
          ? `${peripheral.name}: ${lightningTablet.name} needs a Lightning to USB camera adapter to use USB devices.`
          : `${peripheral.name}: ${lightningTablet.name}で USB 機器を使うには、Lightning - USB カメラアダプタが必要です。`)
      } else if (otherCandidates.length === 0) {
        // 繋ぐ先が1台も無い。以前は「Webカメラ: Webカメラ用のポートが不足しています」と自分の名前で
        // ポート不足を言い、ハブを勧めていた。足りないのはポートではなく PC
        warnings.push(lang === 'en'
          ? `${peripheral.name}: There is no PC to connect to. Add a PC or choose where it connects.`
          : `${peripheral.name}: つなぐPCがありません。PCを追加するか、接続先を指定してください。`)
      } else {
        warnings.push(lang === 'en'
          ? `${otherCandidates[0].name}: Not enough ports for ${peripheral.name}`
          : `${otherCandidates[0].name}: ${peripheral.name}用のポートが不足しています`)
        suggest('Hub', 'usbPort', peripheral.id)
      }
      connections.push({
        id: `failed-${connIndex++}`,
        fromGadgetId: 'failed',
        fromPortType: inPort,
        toGadgetId: peripheral.id,
        toPortType: inPort,
        cableType: inPort,
      })
      continue
    }
    const audioSourcePort = audioHubSource && source.id === audioHubSource.id
      ? findAudioOutput(source, compatOut, audioOutputRole)
      : null
    const outPort = audioSourcePort?.type ?? findAvailablePort(usage, source, compatOut, 'output')
    if (!outPort) continue
    if (audioSourcePort) addAudioConn(source, audioSourcePort, peripheral, inPort)
    else addConn(source, outPort, peripheral, inPort)
  }

  // === ステップ4: 電源接続 ===
  // ルール:
  //   電源タップ → コンセント（直接）
  //   充電器 → 電源タップ（あれば）、なければコンセント
  //   ACガジェット → 電源タップ（あれば）、なければコンセント
  //   USBガジェット → 充電器のUSBポート（ポート数上限あり）、なければ警告
  //   PCからは給電しない

  // 壁コンセントは実際の口数まで使用する。0 のときは wall（コンセント）ノードを
  // 一切作らず、電源はモバイルバッテリーからの USB 給電だけで賄う。
  const outletCount = Math.max(0, Math.floor(plan.outletCount ?? 2))
  const noOutlet = outletCount <= 0
  let wallOutletUse = 0
  const isAcDistributor = (gadget: Gadget) =>
    gadget.category === 'PowerStrip' ||
    gadget.category === 'UPS' ||
    (BUILT_IN_OUTLET_CATEGORIES.includes(gadget.category) &&
      gadget.ports.some((port) =>
        port.type === 'Power' && (port.direction === 'input' || port.direction === 'bidirectional')) &&
      gadget.ports.some((port) =>
        port.type === 'Power' && (port.direction === 'output' || port.direction === 'bidirectional'))) ||
    (gadget.category === 'SmartHome' && gadget.ports.some((port) =>
      port.type === 'Power' && (port.direction === 'output' || port.direction === 'bidirectional'),
    ))

  // USB 給電の供給元。モバイルバッテリーも充電器と同じ扱いにする
  // （USB 出力を持ち、他機器へ給電できる。自身の充電はコンセント/USB入力の有無で決まる）。
  // コンセントがない環境では充電器自体を挿せないので、供給元はモバイルバッテリーだけになる。
  const mobileBatteries = selected.filter((g) => g.category === 'MobileBattery')
  const acChargers = noOutlet ? [] : selected.filter((g) => g.category === 'Charger' || g.category === 'UPS')
  const chargers = [...acChargers, ...mobileBatteries]
  // 電源タップを取得（ACガジェット・充電器の差込口として使う）。コンセントがなければ使えない
  const powerStrips = noOutlet ? [] : selected.filter(isAcDistributor)
  const upsUnits = noOutlet ? [] : selected.filter((g) => g.category === 'UPS')
  // USB で給電できる供給元。Dock/Hub/Monitorは、バスパワーガジェットからの過剰給電を
  // 避けるため、自身にAC入力がありコンセントを使える場合だけ候補にする。
  // タップの USB 口を除くと、「USB付きタップ + スマホ」だけの構成で給電先が見つからず、
  // タップがあるのに「電源タップを追加してください」と警告が出てしまう
  const pdCapableDevices = selected.filter((source) =>
    (source.category === 'Dock' || source.category === 'Monitor') &&
    source.ports.some((port) =>
      (port.type === 'USB_C' || port.type === 'Thunderbolt') &&
      (port.supportsPowerDelivery || hasPowerDeliveryLabel(port)),
    ),
  )
  // USB バスパワーのスピーカー・ライト・ファンは、実物では PC の USB 口から取るのが普通。
  // ここに PC がいないと、消去法でゲーム機やドックから給電される図になっていた。
  // ノートPC は自分が給電される側なので入れない（周辺機器を養う前提の図にしない）。
  const usbPowerComputers = selected.filter((source) =>
    source.category === 'PC' &&
    source.pcFormFactor !== 'laptop' &&
    source.ports.some((port) =>
      (port.type === 'USB_A' || port.type === 'USB_C') &&
      (port.direction === 'output' || port.direction === 'bidirectional')),
  )
  // PC併設時はゲーム機Dockを一般のUSB分配元から外すが、ユーザーが給電元として
  // 明示した場合には使えるよう、給電候補へだけ戻す。
  const poweredUsbDistributors = noOutlet ? [] : [...new Map(
    [
      ...usbDistributionSources,
      ...upstreamDevices.filter(isConsoleDock),
      ...pdCapableDevices,
      // ゲーム機より先に見る。PC がいるのにゲーム機からスピーカーを給電する図にしない
      ...usbPowerComputers,
      ...gameConsoles,
      ...selected.filter((source) =>
        BUILT_IN_OUTLET_CATEGORIES.includes(source.category) &&
        source.ports.some((port) =>
          (port.type === 'USB_A' || port.type === 'USB_C') &&
          (port.direction === 'output' || port.direction === 'bidirectional'))),
    ].map((source) => [source.id, source]),
  ).values()].filter((source) =>
    source.ports.some((p) =>
      p.type === 'Power' && (p.direction === 'input' || p.direction === 'bidirectional'),
    ),
  )
  const usbPowerSources = [...new Map(
    [...acChargers, ...powerStrips, ...poweredUsbDistributors, ...mobileBatteries]
      .map((source) => [source.id, source]),
  ).values()]
  // モバイルバッテリーは蓄電済みの供給元として扱う。それ以外は上流から実際に給電された後だけ使う。
  const poweredSourceIds = new Set(mobileBatteries.map((source) => source.id))
  const powerEdges = new Map<string, Set<string>>()
  const wouldCreatePowerCycle = (fromId: string, toId: string): boolean => {
    const stack = [toId]
    const visited = new Set<string>()
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current === fromId) return true
      if (visited.has(current)) continue
      visited.add(current)
      for (const next of powerEdges.get(current) ?? []) stack.push(next)
    }
    return false
  }
  const pushPowerConnection = (connection: Connection) => {
    const count = declaredCountOf(connection.fromGadgetId, connection.toGadgetId, connection.cableType)
    connections.push(count > 1
      ? {
          ...connection,
          count,
          countSource: selectedById.get(connection.toGadgetId)?.hasSubwoofer ? 'subwoofer' : undefined,
        }
      : connection)
    if (!['wall', 'solar', 'battery', 'failed-power'].includes(connection.fromGadgetId)) {
      const targets = powerEdges.get(connection.fromGadgetId) ?? new Set<string>()
      targets.add(connection.toGadgetId)
      powerEdges.set(connection.fromGadgetId, targets)
    }
    poweredSourceIds.add(connection.toGadgetId)
  }
  const isMobileBatteryRecharging = (source: Gadget) =>
    source.category === 'MobileBattery' && connections.some((connection) =>
      connection.toGadgetId === source.id &&
      connection.fromGadgetId !== 'failed-power' &&
      (connection.chargingOnly === true || connection.id.startsWith('power-')),
    )
  const isPoweredSource = (source: Gadget) =>
    poweredSourceIds.has(source.id) &&
    !(isMobileBatteryRecharging(source) && source.supportsPassThroughCharging !== true)

  // 充電器側で宣言された「ワイヤレス充電できるガジェット」（wirelessTargetGadgetIds）。
  // ガジェット側の受電ポートから給電元を探す通常経路と違い、こちらは充電器から相手を指す。
  // 指定用ピッカーはカテゴリで選ばせるため、給電方法を「Cから」で登録したスマホも選べる。
  // ポートだけを見ていると、その宣言が図に一切出ないまま
  // 「電源供給元が不足しています」の警告だけが残る。
  const declaredWirelessChargers = new Map<string, Gadget[]>()
  for (const charger of chargers) {
    // 宣言だけあってワイヤレス出力の口が0本の充電器は、実物として給電できない
    if (!charger.ports.some((p) => p.direction === 'output' && isWirelessPowerPort(p))) continue
    for (const targetId of charger.wirelessTargetGadgetIds ?? []) {
      declaredWirelessChargers.set(targetId, [...(declaredWirelessChargers.get(targetId) ?? []), charger])
    }
  }
  const wirelessOutputUse = new Map<string, number>()
  const wirelessOutputKey = (source: Gadget, port: Port) => `${source.id}:${port.id}`
  // 宣言先がこのデスクに居るあいだは、その台数ぶんの口を宣言先のために空けておく。
  // 予約しないと、先に処理されたガジェット（導入日の早いスマホなど）が専用パッドの口を
  // 先取りし、名指しされた相手が「ワイヤレス充電器を追加してください」で浮く
  // ＝ユーザーが指定した給電先が無視される。宣言先がデスクに居なければ予約は0本で、
  // 従来どおりどのガジェットからでも使える。
  const declaredTargetsOnDesk = (source: Gadget) =>
    (source.wirelessTargetGadgetIds ?? []).filter((id) => {
      const target = selected.find((g) => g.id === id)
      return target !== undefined &&
        target.powerUsage !== 'replaceable' &&
        !isDismissed(source.id, id, 'wirelessCharging')
    })
  const freeWirelessOutputs = (source: Gadget) => source.ports.reduce((sum, port) =>
    port.direction !== 'input' && isWirelessPowerPort(port)
      ? sum + Math.max(0, Math.max(0, port.count) - (wirelessOutputUse.get(wirelessOutputKey(source, port)) ?? 0))
      : sum, 0)
  /** 宣言されていないガジェットが、その充電器の空き口を使ってよいか（予約ぶんを残せるか） */
  const canTakeWirelessOutput = (source: Gadget, forGadget: Gadget) => {
    const reserved = declaredTargetsOnDesk(source).filter((id) =>
      id !== forGadget.id &&
      !connections.some((c) => c.toGadgetId === id && c.cableType === 'wirelessCharging')).length
    return freeWirelessOutputs(source) - reserved > 0
  }
  const availableWirelessOutput = (source: Gadget): Port | null => source.ports.find((port) =>
    port.direction !== 'input' &&
    isWirelessPowerPort(port) &&
    (wirelessOutputUse.get(wirelessOutputKey(source, port)) ?? 0) < Math.max(0, port.count)) ?? null
  const takeWirelessOutput = (source: Gadget): Port | null => {
    const port = availableWirelessOutput(source)
    if (!port) return null
    const key = wirelessOutputKey(source, port)
    wirelessOutputUse.set(key, (wirelessOutputUse.get(key) ?? 0) + 1)
    return port
  }

  // ─── 給電元の物理ポート割り当て ───────────────────────────────
  // 充電器の USB 出力を「1口ずつ」に展開し、給電の接続へ順に割り当てる。
  // 空きが尽きたら使用数の少ない口を共有する（バッテリー内蔵ガジェットは同時に充電しない前提。
  // 共有した口は残数計算の上で使い回すだけで、配線図では別々の線として描く）。
  // これがないと全ガジェットが同じ型の口を指名し、USB-A が余ったまま USB-C だけに線が集中していた。
  const usbPortSlots = new Map<string, UsbPowerPortSlot[]>()
  const slotsOf = (source: Gadget): UsbPowerPortSlot[] => {
    const cached = usbPortSlots.get(source.id)
    if (cached) return cached
    const slots = usbPowerPortSlots(source)
    usbPortSlots.set(source.id, slots)
    return slots
  }
  const outputSlotsOf = (source: Gadget, target?: Gadget): UsbPowerPortSlot[] => {
    // 同形状でも通常のUSB口とPD対応口は別物。空き判定と実際の確保で同じ候補を使う。
    const needsPd = target?.category === 'PC' && target.pcFormFactor === 'laptop' &&
      poweredUsbDistributors.some((distributor) => distributor.id === source.id)
    const slots = slotsOf(source).filter((slot) => !needsPd || source.ports.some((port) =>
      port.id === slot.id.slice(0, slot.id.lastIndexOf('#')) &&
      (port.supportsPowerDelivery || hasPowerDeliveryLabel(port))))
    if (source.category !== 'MobileBattery' || !isMobileBatteryRecharging(source)) return slots
    const incoming = connections.find((connection) =>
      connection.toGadgetId === source.id &&
      connection.fromGadgetId !== 'failed-power' &&
      (connection.chargingOnly === true || connection.id.startsWith('power-')),
    )
    if (!incoming) return slots
    const sharedInput = source.ports.find((port) =>
      port.type === incoming.toPortType && port.direction === 'bidirectional',
    )
    return sharedInput ? slots.filter((slot) => slot.id !== `${sharedInput.id}#0`) : slots
  }
  const slotUseCount = new Map<string, number>()
  // 常時給電のガジェットが占有した口。使用中は他のガジェットを挿せないので共有できない。
  const exclusiveSlots = new Set<string>()
  const slotKey = (sourceId: string, slotId: string) => `${sourceId}|${slotId}`
  const isExclusive = (sourceId: string, slotId: string) => exclusiveSlots.has(slotKey(sourceId, slotId))

  /**
   * 抜き差しして口を使い回す給電元。充電器・電源タップ・モバイルバッテリーの USB 口は、
   * 挿しっぱなしにしないガジェットどうしで共有してよい（cables.md の方針）。
   * ドック・ハブ・モニターの USB 口は SSD やキーボードが挿さったままなので共有できない。
   */
  const SHARED_SLOT_CATEGORIES: GadgetCategory[] = ['Charger', 'MobileBattery', 'PowerStrip', 'UPS']

  // ステップ1〜3 のデータ接続で既に埋まっている口を先に押さえる。
  // ドック・ハブ・モニターの USB 口はデータと給電で同じ物理ポートを使うため、
  // ここで消し込まないと「USB-C 3口のドックに5台がぶら下がる」配線図になる。
  for (const source of usbPowerSources) {
    if (SHARED_SLOT_CATEGORIES.includes(source.category)) continue
    // 種類ごとの総本数では、映像対応口などを選んで使った位置が失われる。
    // データ配線が実際に消費した物理ポートを、そのまま給電の占有へ引き継ぐ。
    for (const { port, remaining } of usage.get(source.id) ?? []) {
      if (port.direction === 'input' || (port.type !== 'USB_C' && port.type !== 'USB_A')) continue
      for (let i = 0; i < port.count - remaining; i++) {
        const key = slotKey(source.id, `${port.id}#${i}`)
        slotUseCount.set(key, (slotUseCount.get(key) ?? 0) + 1)
        exclusiveSlots.add(key)
      }
    }
  }

  /**
   * 充電のときだけ挿すガジェットか。携帯ゲーム機は登録時に給電方法が「なし」になり
   * powerUsage が保存されないので、未設定なら形状から充電式とみなす。
   * 処理順・充電用の口の確保・線の種別でこの判定を揃える。処理順だけが
   * powerUsage === 'rechargeable' を見ていた頃は、携帯ゲーム機が常時給電の機器と同じ順で
   * 空いている口を1つずつ取り、後から来た常時給電の機器が「口がすべて埋まっています」で浮いた
   */
  const isChargingOnly = (gadget: Gadget): boolean => {
    if (gadget.powerUsage !== undefined) return gadget.powerUsage === 'rechargeable'
    return gadget.category === 'GameConsole' &&
      (gadget.consoleFormFactor === 'handheld' ||
        (!gadget.consoleFormFactor && !gadget.ports.some((p) => p.type === 'Power' && (p.direction === 'input' || p.direction === 'bidirectional'))))
  }

  /** バッテリー内蔵ガジェットの充電用に、口を最低1つ空けておく必要があるか */
  const reserveChargingSlot = selected.some((g) =>
    isChargingOnly(g) &&
    g.category !== 'Charger' &&
    g.category !== 'PowerStrip' &&
    g.category !== 'MobileBattery')
  /** 常時給電に取られていない口の総数（給電元をまたいで数える） */
  const openSlotTotal = () => usbPowerSources.reduce(
    (total, source) => total + outputSlotsOf(source).filter((slot) => !isExclusive(source.id, slot.id)).length, 0)
  /**
   * その型の口をこのガジェットに割り当てられるか。
   * shareOccupied: 空きが1つもなくても、常時給電が使っている口へ相乗りさせる。
   * 充電時のみ給電のガジェットは同時に挿しっぱなしにしないので、口が尽きたときの
   * 最後の手段として使う（配線図ではその口から分岐した1対複数の線になる）。
   */
  const hasSlotRoom = (source: Gadget, type: PortType, target: Gadget, exclusive: boolean, shareOccupied = false): boolean => {
    const slots = outputSlotsOf(source, target).filter((slot) => slot.type === type)
    if (slots.length === 0) return false
    // ユーザー指定・前回と同じ口が使えるなら即決する。ただし常時給電で占有済みの
    // 物理ポートは再利用しない。
    // 使えないときはここで打ち切らず、下の通常判定（他に空いている口があるか）へ落とす。
    // 打ち切ると、4口のうち3口空いていても給電元ごと候補から外れ、
    // 「充電器の口がすべて埋まっています」の誤警告になる。実際に口を取る takeSlot は
    // 埋まっていれば別の口へフォールバックするので、判定側だけが規則を違えていた。
    // 指定していないユーザーでも、preferredPortId は前回の配線図に記録された口
    // （savedChargePortId）を返すため、ガジェットを1台足しただけで踏みうる。
    const wanted = preferredPortId(target, source.id)
    const wantedSlot = wanted ? slots.find((slot) => slot.id === wanted) : undefined
    if (
      wantedSlot &&
      !isExclusive(source.id, wantedSlot.id) &&
      (!exclusive || (slotUseCount.get(slotKey(source.id, wantedSlot.id)) ?? 0) === 0)
    ) return true
    const open = slots.filter((slot) => !isExclusive(source.id, slot.id))
    // 相乗りできるのは抜き差しする給電元だけ。ドックの口は塞がったままなので相乗りさせない
    if (open.length === 0) return shareOccupied && !exclusive && SHARED_SLOT_CATEGORIES.includes(source.category)
    if (!exclusive) return true
    // 常時給電は1口を占有するので、誰も使っていない口が要る
    if (!open.some((slot) => (slotUseCount.get(slotKey(source.id, slot.id)) ?? 0) === 0)) return false
    // バッテリーガジェットの接続枠を最低1つ残す
    return !reserveChargingSlot || openSlotTotal() > 1
  }
  /** その型の口のうち、いま最も使われていない1口の使用数（型の選択に使う） */
  const freestSlotUse = (source: Gadget, type: PortType, shareOccupied = false, target?: Gadget): number | null => {
    const slots = outputSlotsOf(source, target).filter((slot) => slot.type === type && (shareOccupied || !isExclusive(source.id, slot.id)))
    if (slots.length === 0) return null
    return Math.min(...slots.map((slot) => slotUseCount.get(slotKey(source.id, slot.id)) ?? 0))
  }
  /** 使いたい口：ユーザーが編集画面で指定した口 → 前回と同じ口 の順 */
  const preferredPortId = (target: Gadget, sourceId: string): string | undefined =>
    target.powerSourcePortId ?? savedChargePortId.get(savedChargeKey(target.id, sourceId))
  /** 実際に1口を確保する */
  const takeSlot = (source: Gadget, target: Gadget, type: PortType, exclusive = false): string | undefined => {
    const all = outputSlotsOf(source, target).filter((slot) => slot.type === type)
    if (all.length === 0) return undefined
    const wanted = preferredPortId(target, source.id)
    const pinned = wanted ? all.find((slot) =>
      slot.id === wanted &&
      !isExclusive(source.id, slot.id) &&
      (!exclusive || (slotUseCount.get(slotKey(source.id, slot.id)) ?? 0) === 0),
    ) : undefined
    // 常時給電は空いている口だけ、充電は常時給電に占有されていない口だけを対象にする
    const open = all.filter((slot) => !isExclusive(source.id, slot.id))
    const usable = exclusive
      ? open.filter((slot) => (slotUseCount.get(slotKey(source.id, slot.id)) ?? 0) === 0)
      : open
    const pool = usable.length > 0 ? usable : open.length > 0 ? open : all
    const chosen = pinned ?? pool.reduce((best, slot) =>
      (slotUseCount.get(slotKey(source.id, slot.id)) ?? 0) < (slotUseCount.get(slotKey(source.id, best.id)) ?? 0)
        ? slot : best, pool[0])
    const key = slotKey(source.id, chosen.id)
    slotUseCount.set(key, (slotUseCount.get(key) ?? 0) + 1)
    if (exclusive) exclusiveSlots.add(key)
    return chosen.id
  }

  const selectUsbPowerSource = (
    candidates: Gadget[],
    outputType: PortType,
    target: Gadget,
    cableType: CableType,
    exclusive = false,
    shareOccupied = false,
    // 充電時のみ挿すガジェット（スマホ・イヤホン等）は従来どおり充電器・タップから充電する。
    // PC の USB 口を充電に使う図にすると、充電器を持っているデスクでも線が PC へ寄る
    allowComputers = true,
  ): Gadget | undefined => {
    const usable = (source: Gadget, computersAllowed = allowComputers) => {
      if (!computersAllowed && source.category === 'PC') return false
      if (source.id === target.id || !isPoweredSource(source) || wouldCreatePowerCycle(source.id, target.id)) return false
      if (target.category === 'MobileBattery' && source.category === 'MobileBattery') return false
      if (!hasSlotRoom(source, outputType, target, exclusive, shareOccupied)) return false
      if (isDismissed(source.id, target.id, cableType)) return false
      // USB-A は端子の仕様として PD を通せないので、ノートPC の給電元にはなれない。
      // 充電器・電源タップでも同じで、ここを許すと実物では充電できない線が引かれる
      if (target.category === 'PC' && target.pcFormFactor === 'laptop' && outputType === 'USB_A') return false
      return true
    }
    // ユーザーが給電元を指定していれば、互換性と通電状態を確認して優先する
    const pinned = target.powerSourceGadgetId
      ? candidates.find((source) => source.id === target.powerSourceGadgetId && usable(source, true))
      : undefined
    if (pinned) return pinned
    // モニターのUSB口はハブとして周辺機器を挿すためのもので、スマホや
    // スマートウォッチの充電に常用する構成は一般的でない。充電器・タップ・
    // モバイルバッテリーを先に当たり、他に給電元が無いときだけモニターを使う。
    if (CHARGE_ONLY_CATEGORIES.includes(target.category)) {
      const nonMonitor = candidates.find((source) => source.category !== 'Monitor' && usable(source))
      if (nonMonitor) return nonMonitor
    }
    return candidates.find((source) => usable(source))
  }

  // 複数口の宣言（デュアル電源 ×2 等）ぶん、同じ給電元の口を追加で押さえる。押さえられた数を返す。
  // コンセント・タップの口数は数え違えようがないので、足りなければ警告で知らせる
  const takeExtraOutlets = (sourceId: string, targetId: string, cableType: CableType, free: number): number => {
    const extra = declaredCountOf(sourceId, targetId, cableType) - 1
    if (extra <= 0) return 0
    const taken = Math.min(extra, Math.max(0, free))
    if (taken < extra) {
      const targetName = selected.find((g) => g.id === targetId)?.name ?? targetId
      const sourceName = sourceId === WALL_SOURCE_ID
        ? (lang === 'en' ? 'the wall outlet' : '壁コンセント')
        : selected.find((g) => g.id === sourceId)?.name ?? sourceId
      warnings.push(lang === 'en'
        ? `${targetName}: Set to use ${extra + 1} plugs on ${sourceName}, but only ${taken + 1} ${taken === 0 ? 'is' : 'are'} free.`
        : `${targetName}: ${sourceName}の口を${extra + 1}つ使う設定ですが、空きが${taken + 1}つしかありません。`)
    }
    return taken
  }

  const useWallOutlet = (targetId: string, cableType: CableType): boolean => {
    if (isDismissed(WALL_SOURCE_ID, targetId, cableType)) return false
    if (wallOutletUse >= outletCount) return false
    wallOutletUse++
    wallOutletUse += takeExtraOutlets(WALL_SOURCE_ID, targetId, cableType, outletCount - wallOutletUse)
    return true
  }

  // AC 電源が要るのに壁・タップの空きがないガジェット。まとめて1件の警告にする
  const unpoweredAcNames: string[] = []
  const markUnpoweredAc = (gadget: Gadget) => {
    if (!unpoweredAcNames.includes(gadget.name)) unpoweredAcNames.push(gadget.name)
  }

  const stripOutletUse = new Map<string, number>()
  const stripOutletCapacity = (strip: Gadget) => strip.ports.reduce(
    (total, port) => total + (
      port.type === 'Power' && (port.direction === 'output' || port.direction === 'bidirectional')
        ? Math.max(0, port.count)
        : 0
    ),
    0,
  )
  const findStripOutlet = (target: Gadget, cableType: CableType): string | null => {
    const usable = (strip: Gadget) =>
      strip.id !== target.id &&
      isPoweredSource(strip) &&
      !isDismissed(strip.id, target.id, cableType) &&
      (stripOutletUse.get(strip.id) ?? 0) < stripOutletCapacity(strip)
    const pinned = target.powerSourceGadgetId
      ? powerStrips.find((strip) => strip.id === target.powerSourceGadgetId && usable(strip))
      : undefined
    // 複数口を取る宣言があれば、宣言した給電元を優先する。別の給電元へ回すと
    // 組み合わせ（ペアキー）が変わり、本数の宣言が黙って外れる
    const declared = declaredAcSource.get(target.id)
    const declaredHere = declared && declared.cableType === cableType ? declared : undefined
    if (!pinned && declaredHere?.sourceId === WALL_SOURCE_ID &&
        wallOutletUse < outletCount && !isDismissed(WALL_SOURCE_ID, target.id, cableType)) {
      return null // 呼び元が壁コンセント（useWallOutlet）へ回す
    }
    const preferred = pinned
      ?? (declaredHere ? powerStrips.find((strip) => strip.id === declaredHere.sourceId && usable(strip)) : undefined)
    // UPS の口は停電時に守りたいガジェットのために空けておく。まず電源タップを探す
    const candidates = [...powerStrips].reverse()
    const strip = preferred
      ?? candidates.find((s) => s.category !== 'UPS' && usable(s))
      ?? candidates.find(usable)
    if (!strip) return null
    const use = (stripOutletUse.get(strip.id) ?? 0) + 1
    stripOutletUse.set(strip.id, use + takeExtraOutlets(strip.id, target.id, cableType, stripOutletCapacity(strip) - use))
    return strip.id
  }

  /** UPS の空き口を1つ確保する（壁 → UPS → 電源タップ の直列にするため） */
  const takeUpsOutlet = (target: Gadget): string | null => {
    const ups = upsUnits.find((unit) =>
      unit.id !== target.id &&
      isPoweredSource(unit) &&
      !wouldCreatePowerCycle(unit.id, target.id) &&
      !isDismissed(unit.id, target.id, 'Power') &&
      (stripOutletUse.get(unit.id) ?? 0) < stripOutletCapacity(unit),
    )
    if (!ups) return null
    const use = (stripOutletUse.get(ups.id) ?? 0) + 1
    stripOutletUse.set(ups.id, use + takeExtraOutlets(ups.id, target.id, 'Power', stripOutletCapacity(ups) - use))
    return ups.id
  }

  // USB から受電する充電器（MagSafe パック等）。コンセント直結の充電器より後に処理する
  const isUsbPoweredCharger = (gadget: Gadget) =>
    gadget.category === 'Charger' &&
    gadget.ports.some((port) =>
      (port.type === 'USB_C' || port.type === 'USB_A') && port.direction === 'input' && isPowerFeedPort(port))
  const powerPriority = (gadget: Gadget) => {
    // UPS は電源タップより先に通電させる（壁 → UPS → タップ の順に線を引くため）
    if (gadget.category === 'UPS') return 0
    if (isAcDistributor(gadget)) return 10
    // USB 受電の充電器は、供給元が通電してからでないと給電元を見つけられない
    // （先に処理すると「USB給電元が見つかりません」で浮く）。コンセント側の充電器だけでなく
    // ドック・ハブ・モニターの USB 口からも取るので、それらより後（30 の後）に回す。
    if (gadget.category === 'Charger') return isUsbPoweredCharger(gadget) ? 32 : 20
    // ノートPCは外出構成の主役で、USB-C PDを常時占有する。モバイルバッテリーや
    // 充電時だけ挿す機器より先に割り当てないと、充電器の口が埋まり本体が無給電になる。
    if (gadget.category === 'PC' && gadget.pcFormFactor === 'laptop') return 34
    // PC は USB の分配元だが、AC を取る順番は従来どおり（40）にしておく。
    // 30 に上げると UPS やタップの口の割り当て順まで変わり、UPS が守る相手が入れ替わる
    if (gadget.category !== 'PC' && poweredUsbDistributors.some((source) => source.id === gadget.id)) return 30
    // 先に本体の充電状態を確定し、パススルー非対応機から後続ガジェットへ給電しない。
    if (gadget.category === 'MobileBattery') return 35
    if (isChargingOnly(gadget)) return 50
    return 40
  }
  // 同じ優先度の中は wiringOrder（導入日→デスクへ入れた順）で処理する。配列の並び
  // （＝ガジェットストアの順序）に依存させると、無関係なガジェットを1台足し引きしただけで
  // 充電ポートの割り当てがずれてしまう。
  // ここを id で割ると、テンプレート適用のように全ガジェットの createdAt が同着の構成では
  // UUID の並びで順序が決まり、同じ構成を作り直すたびに充電ポートの割り当てと配線図が
  // 変わってしまう（wiringOrder のコメントと同じ理由。こちらだけ id 比較が残っていた）。
  // 同じ優先度の中では、複数口を取る宣言のあるガジェットを先にする。後に回すと、先に来た
  // ガジェットがタップの口を取り、宣言した本数を挿す空きが無いまま「足りている」扱いになる
  const declaresExtraOutlets = (gadget: Gadget) => declaredAcSource.has(gadget.id) || gadget.hasSubwoofer ? 0 : 1
  const powerDevices = [...selected].sort((a, b) =>
    powerPriority(a) - powerPriority(b) || declaresExtraOutlets(a) - declaresExtraOutlets(b) || wiringOrder(a, b))
  for (const gadget of powerDevices) {
    if (gadget.powerUsage === 'replaceable') continue
    // タブレットに内包したペンは、充電もタブレットへ吸着・挿して済ませる前提で線を引かない
    if (attachedPenIds.has(gadget.id)) continue
    const chargingOnly = isChargingOnly(gadget)
    const isWiredPcPeripheral =
      (gadget.category === 'Mouse' || gadget.category === 'Keyboard') &&
      gadget.ports.some((p) =>
        (p.type === 'USB_A' || p.type === 'USB_C') &&
        p.direction === 'input' &&
        isWiredPort(p) &&
        !isReceiverPort(p),
      )
    if (poweredByDataCable.has(gadget.id) || isWiredPcPeripheral) continue
    if (gadget.smartHomePowerSource === 'solar' || gadget.smartHomePowerSource === 'battery') {
      const sourceId = gadget.smartHomePowerSource
      if (isDismissed(sourceId, gadget.id, 'Power')) continue
      pushPowerConnection({
        id: `${sourceId}-power-${gadget.id}`,
        fromGadgetId: sourceId,
        fromPortType: 'Power',
        toGadgetId: gadget.id,
        toPortType: 'Power',
        cableType: 'Power',
        chargingOnly,
      })
      continue
    }
    // 電源タップ自身はコンセントに直接差し込む。
    // UPS があれば 壁 → UPS → 電源タップ の直列にする。タップを UPS の下に置かないと、
    // UPS を買ったのに配下のガジェットが1台も守られない（＝図の上でUPSが遊ぶ）ことになる。
    if (isAcDistributor(gadget)) {
      const upsId = gadget.category === 'UPS' ? null : takeUpsOutlet(gadget)
      if (upsId) {
        pushPowerConnection({
          id: `power-${gadget.id}`,
          fromGadgetId: upsId,
          fromPortType: 'Power',
          toGadgetId: gadget.id,
          toPortType: 'Power',
          cableType: 'Power',
        })
        continue
      }
      if (noOutlet || !useWallOutlet(gadget.id, 'Power')) { markUnpoweredAc(gadget); continue }
      pushPowerConnection({
        id: `power-${gadget.id}`,
        fromGadgetId: 'wall',
        fromPortType: 'Power',
        toGadgetId: gadget.id,
        toPortType: 'Power',
        cableType: 'Power',
      })
      continue
    }

    // コンセントなしではモバイルバッテリーは蓄電済みの供給元。自身を充電対象にはしない。
    if (noOutlet && gadget.category === 'MobileBattery') continue

    // 充電器側で指定されたワイヤレス給電先は、ガジェット側の受電ポートより優先する。
    // ユーザーが「この充電器はこれを充電する」と明示したものなので、
    // 受電ポートを持たない登録内容でもその宣言どおりに線を引く。
    const declaredChargers = declaredWirelessChargers.get(gadget.id)
    if (declaredChargers) {
      // タブレットからの吸着給電など、すでに無線で給電されているなら二重に引かない
      if (connections.some((c) => c.toGadgetId === gadget.id && c.cableType === 'wirelessCharging')) continue
      const declaredOrder = gadget.powerSourceGadgetId
        ? [...declaredChargers].sort((a, b) => Number(b.id === gadget.powerSourceGadgetId) - Number(a.id === gadget.powerSourceGadgetId))
        : declaredChargers
      const declaredCharger = declaredOrder.find((charger) =>
        isPoweredSource(charger) &&
        availableWirelessOutput(charger) !== null &&
        !wouldCreatePowerCycle(charger.id, gadget.id) &&
        !isDismissed(charger.id, gadget.id, 'wirelessCharging'),
      )
      if (declaredCharger) {
        const wirelessPort = takeWirelessOutput(declaredCharger)!
        pushPowerConnection({
          id: `wireless-power-${gadget.id}`,
          fromGadgetId: declaredCharger.id,
          fromPortType: 'wirelessCharging',
          toGadgetId: gadget.id,
          toPortType: 'wirelessCharging',
          cableType: 'wirelessCharging',
          chargingOnly,
          sourcePortId: `${wirelessPort.id}#${wirelessOutputUse.get(wirelessOutputKey(declaredCharger, wirelessPort))! - 1}`,
        })
        continue
      }
    }

    // 充電器の給電
    if (gadget.category === 'Charger') {
      // 給電方法が USB (A/C) 指定なら、コンセントではなく USB 電源から給電する
      // （電源タップの USB ポート → 他の充電器の USB 出力 の順で探す）
      const usbPowerIn = gadget.ports.find(
        (p) => (p.type === 'USB_C' || p.type === 'USB_A') && p.direction === 'input' && isPowerFeedPort(p)
      )
      if (usbPowerIn) {
        const usbSource = selectUsbPowerSource(
          usbPowerSources,
          usbPowerIn.type,
          gadget,
          usbPowerIn.type,
        )
        if (usbSource) {
          pushPowerConnection({
            id: `power-${gadget.id}`,
            fromGadgetId: usbSource.id,
            fromPortType: usbPowerIn.type,
            toGadgetId: gadget.id,
            toPortType: usbPowerIn.type,
            cableType: usbPowerIn.type,
            chargingOnly,
            sourcePortId: takeSlot(usbSource, gadget, usbPowerIn.type, true),
          })
        } else {
          warnings.push(lang === 'en'
            ? `${gadget.name}: No USB power source (${usbPowerIn.type === 'USB_C' ? 'USB-C' : 'USB-A'}) available.`
            : `${gadget.name}: USB給電元（${usbPowerIn.type === 'USB_C' ? 'USB-C' : 'USB-A'}）が見つかりません。`)
        }
        continue
      }
      // AC 給電（従来どおり）：電源タップに差し込む（なければコンセント）
      if (noOutlet) { markUnpoweredAc(gadget); continue }
      const stripId = findStripOutlet(gadget, 'Power')
      if (!stripId && !useWallOutlet(gadget.id, 'Power')) { markUnpoweredAc(gadget); continue }
      pushPowerConnection({
        id: `power-${gadget.id}`,
        fromGadgetId: stripId ?? 'wall',
        fromPortType: 'Power',
        toGadgetId: gadget.id,
        toPortType: 'Power',
        cableType: 'Power',
        chargingOnly,
      })
      continue
    }

    // ノートPCとPD対応Dock/MonitorがUSB-C系で接続済みなら、その1本が映像・データ・給電を兼ねる。
    // 逆方向の給電線を追加すると、同じ物理ケーブルを2本として集計してしまう。
    if (gadget.category === 'PC' && gadget.pcFormFactor === 'laptop') {
      const sameCablePdSource = poweredUsbDistributors.find((source) => {
        if (!isPoweredSource(source)) return false
        const dataConnection = connections.find((connection) =>
          connection.fromGadgetId === gadget.id &&
          connection.toGadgetId === source.id &&
          (connection.cableType === 'USB_C' || connection.cableType === 'Thunderbolt'),
        )
        if (!dataConnection) return false
        return source.ports.some((port) =>
          port.type === dataConnection.toPortType &&
          (port.direction === 'input' || port.direction === 'bidirectional') &&
          (port.supportsPowerDelivery || hasPowerDeliveryLabel(port)),
        )
      })
      if (sameCablePdSource) continue

      const pdSource = poweredUsbDistributors.find((source) => {
        if (gadget.powerSourceGadgetId && gadget.powerSourceGadgetId !== source.id) return false
        if (!isPoweredSource(source) || wouldCreatePowerCycle(source.id, gadget.id)) return false
        if (!hasSlotRoom(source, 'USB_C', gadget, true)) return false
        const pdPort = source.ports.find((p) =>
          p.type === 'USB_C' &&
          (p.direction === 'output' || p.direction === 'bidirectional') &&
          (p.supportsPowerDelivery || hasPowerDeliveryLabel(p)),
        )
        if (!pdPort) return false
        return connections.some((connection) =>
          (connection.fromGadgetId === gadget.id && connection.toGadgetId === source.id) ||
          (connection.fromGadgetId === source.id && connection.toGadgetId === gadget.id),
        )
      })
      if (
        pdSource &&
        findAvailablePort(usage, gadget, ['USB_C'], 'input') &&
        !isDismissed(pdSource.id, gadget.id, 'USB_C')
      ) {
        pushPowerConnection({
          id: `pd-power-${gadget.id}`,
          fromGadgetId: pdSource.id,
          fromPortType: 'USB_C',
          toGadgetId: gadget.id,
          toPortType: 'USB_C',
          cableType: 'USB_C',
          chargingOnly: true,
          sourcePortId: takeSlot(pdSource, gadget, 'USB_C', true),
        })
        continue
      }
    }

    // ワイヤレス給電（Qi）はコンセント直結ではないため AC 入力から除外する
    // （判定は gadgetPorts の isWirelessPowerPort に集約：統計側と基準を揃える）
    // PoE入力はLANケーブル1本で通信と給電を兼ねる。別のAC/DC線は追加しない。
    const poweredByPoe = poweredByPoeIds.has(gadget.id)
    if (poweredByPoe) {
      poweredSourceIds.add(gadget.id)
      continue
    }
    const hasAcInput = gadget.ports.some(
      (p) => p.type === 'Power' && (p.direction === 'input' || p.direction === 'bidirectional') && !isWirelessPowerPort(p)
    )
    const dcInput = gadget.ports.find(
      (p) => p.type === 'DCPower' && (p.direction === 'input' || p.direction === 'bidirectional')
    )
    const hasDcInput = dcInput !== undefined
    const chargeInputPriority: PortType[] = ['USB_C', 'Thunderbolt', 'Lightning', 'microUSB', 'USB_A']
    // ワイヤレス受電するガジェット：ワイヤレス充電器へ無線接続（コンセントには繋がない）
    const hasWirelessInput = gadget.ports.some(
      (p) => p.direction === 'input' && isWirelessPowerPort(p)
    )
    if (hasWirelessInput && !hasAcInput) {
      // タブレットからの吸着給電など、すでに無線で給電されているガジェットは二重に引かない
      if (connections.some((c) => c.toGadgetId === gadget.id && c.cableType === 'wirelessCharging')) continue
      // 充電器側のワイヤレス給電能力は「出力(output)」ポートとして持つ。
      // isWirelessPowerPort で wirelessCharging 型または Power 型（ラベル: Qi/ワイヤレス）を確認するが、
      // 実際のポート型はガジェットによって異なる（プリセットの MagSafe モバイルバッテリー等は
      // 専用の wirelessCharging 型、AddGadget フォームで作った充電器は旧来の Power 型 + ラベル）。
      // 'Power' 固定で残数を見ると前者のポートが常に0本扱いになり給電元として拾えないため、
      // 一致したポート自身の type を使って残数を確認・消費する
      let wCharger: Gadget | null = null
      let wChargerPort: Port | null = null
      // ユーザーが給電元を指定していれば、その充電器を先に見る
      const wirelessOrder = gadget.powerSourceGadgetId
        ? [...chargers].sort((a, b) => Number(b.id === gadget.powerSourceGadgetId) - Number(a.id === gadget.powerSourceGadgetId))
        : chargers
      for (const c of wirelessOrder) {
        if (!isPoweredSource(c) || wouldCreatePowerCycle(c.id, gadget.id)) continue
        const port = availableWirelessOutput(c)
        if (!port) continue
        if (!canTakeWirelessOutput(c, gadget)) continue
        if (isDismissed(c.id, gadget.id, 'wirelessCharging')) continue
        wCharger = c
        wChargerPort = port
        break
      }
      if (wCharger && wChargerPort) {
        const wirelessPort = takeWirelessOutput(wCharger)!
        pushPowerConnection({
          id: `wireless-power-${gadget.id}`,
          fromGadgetId: wCharger.id,
          fromPortType: 'wirelessCharging',
          toGadgetId: gadget.id,
          toPortType: 'wirelessCharging',
          cableType: 'wirelessCharging', // 無線給電（配線図・配線図とも波線/専用色で表示）
          chargingOnly,
          sourcePortId: `${wirelessPort.id}#${wirelessOutputUse.get(wirelessOutputKey(wCharger, wirelessPort))! - 1}`,
        })
        continue
      }

      // 有線へ切り替える場合も、通常の充電経路で変換ケーブル・空き口・充電元の指定を判定する。
      // Watch など有線入力のない機材には USB の線を引けない。
      const hasWiredChargeInput = gadget.ports.some((port) =>
        chargeInputPriority.includes(port.type) && (port.direction === 'input' || port.direction === 'bidirectional'))
      if (!hasWiredChargeInput) {
        warnings.push(lang === 'en'
          ? `${gadget.name}: Charges wirelessly only. Please add a wireless charger.`
          : `${gadget.name}: ワイヤレス充電にしか対応していません。ワイヤレス充電器を追加してください。`)
        suggest('Charger', 'charger', gadget.id)
        continue
      }
    }
    // AC電源が必要なデバイスは電源タップ（なければコンセント）へ
    if (hasAcInput || hasDcInput) {
      if (!hasAcInput && dcInput?.powerAdapterIncluded !== true) {
        warnings.push(lang === 'en'
          ? `${gadget.name}: DC power specifications are unknown. Confirm the specified adapter, voltage, polarity, and plug before connecting.`
          : `${gadget.name}: DC電源仕様が未確認です。指定アダプター・電圧・極性・プラグを確認してください。`)
        continue
      }
      const cableType: CableType = hasAcInput ? 'Power' : 'DCPower'
      const targetPort: PortType = hasAcInput ? 'Power' : 'DCPower'
      if (noOutlet) { markUnpoweredAc(gadget); continue }
      const stripId = findStripOutlet(gadget, cableType)
      if (!stripId && !useWallOutlet(gadget.id, cableType)) { markUnpoweredAc(gadget); continue }
      pushPowerConnection({
        id: `power-${gadget.id}`,
        fromGadgetId: stripId ?? 'wall',
        fromPortType: 'Power',
        toGadgetId: gadget.id,
        toPortType: targetPort,
        cableType,
        chargingOnly,
      })
      continue
    }

    // データ接続済みのUSBケーブルは給電も兼ねるため、別の電源線を追加しない。
    // Lightning / microUSB も充電器側の端子との組み合わせを保持する。
    // 入出力兼用の口（携帯ゲーム機の USB-C 等）が映像出力などで埋まっていたら、同じ口には
    // 充電線を挿せない。入ってくる線しか見ていないと、1口に2本挿さった図になる
    // 入力の口から出ていく線もある（PC の無いデスクでタブレットの充電口をハブ・USB 機器のホストに使ったとき）。
    // 以前は入力の口を持つ機材を対象外にしていて、ホストに使った iPad の口へ充電線がもう1本挿さっていた
    const sharedPortFullByOutput = (inputType: PortType): boolean => {
      const receiving = gadget.ports.filter((port) =>
        port.type === inputType && (port.direction === 'input' || port.direction === 'bidirectional'))
      if (gadget.ports.some((port) => port.type === inputType && port.direction === 'output')) return false
      const capacity = receiving.reduce((sum, port) => sum + (port.count ?? 1), 0)
      const outbound = connections.filter((connection) =>
        connection.fromGadgetId === gadget.id && connection.fromPortType === inputType).length
      return capacity > 0 && outbound >= capacity
    }
    const chargeInput = chargeInputPriority.find((inputType) => {
      const alreadyConnected = connections.some((connection) =>
        connection.toGadgetId === gadget.id &&
        connection.fromGadgetId !== 'failed' &&
        connection.toPortType === inputType,
      )
      return !alreadyConnected && !sharedPortFullByOutput(inputType) && gadget.ports.some((port) =>
        port.type === inputType && (port.direction === 'input' || port.direction === 'bidirectional'),
      )
    })

    if (!chargeInput) {
      // 出力に使った口の相手が PD で給電し返す口（USB-C のモニター・ドック）なら、その1本で充電されている。
      // iPad から PD 対応モニターへ映像を出すと、充電できないと警告していた
      const chargedBackOverOutput = connections.some((connection) => {
        if (connection.fromGadgetId !== gadget.id || !sharedPortFullByOutput(connection.fromPortType)) return false
        const target = selected.find((g) => g.id === connection.toGadgetId)
        return !!target?.ports.some((port) =>
          port.type === connection.toPortType &&
          (port.direction === 'input' || port.direction === 'bidirectional') &&
          (port.supportsPowerDelivery === true || hasPowerDeliveryLabel(port)))
      })
      if (chargedBackOverOutput) continue
      const fullChargeType = chargeInputPriority.find(sharedPortFullByOutput)
      // Lightning の口は PD で給電し返すモニター・ドックが無い。USB-C の文言のままだと、
      // 持っていない端子の名前と、使えない解決策を案内することになる
      if (fullChargeType === 'Lightning') {
        warnings.push(lang === 'en'
          ? `${gadget.name}: The Lightning port is in use, so there is none left for charging. An adapter with a charging port (such as the Lightning to USB 3 Camera Adapter) lets it charge at the same time.`
          : `${gadget.name}: Lightning の口が使われていて充電線を挿せません。充電用の口が付いたアダプタ（Lightning - USB 3カメラアダプタ等）なら、使いながら充電できます。`)
      } else if (fullChargeType) {
        warnings.push(lang === 'en'
          ? `${gadget.name}: All USB-C ports are in use, so there is none left for charging. A monitor, dock, or hub with PD can carry video or data and charging over one cable.`
          : `${gadget.name}: USB-C の口がすべて使われていて充電線を挿せません。PD 対応のモニター・ドック・ハブなら1本で映像やデータと充電を兼ねられます。`)
      }
      continue
    }

    // 出力ポートは空いている口から使い切る。USB-C が埋まっていれば USB-A へ回し、
    // どちらも埋まっていれば使用数の少ない口を共有する（挿し替えて使う前提）。
    // 常時給電のガジェットは1口を占有する（バッテリー内蔵ガジェットのように口を共有できない）
    const occupiesPort = !chargingOnly
    const buildChargeCandidates = (shareOccupied: boolean, allowComputers: boolean) => (['USB_C', 'USB_A'] as const).flatMap((sourceType) => {
      const cableType = determineCableType(sourceType, chargeInput)
      const charger = selectUsbPowerSource(
        usbPowerSources, sourceType, gadget, cableType, occupiesPort, shareOccupied, allowComputers)
      if (!charger) return []
      const use = freestSlotUse(charger, sourceType, shareOccupied, gadget)
      return [{ sourceType, cableType, charger, use: use ?? 0 }]
    })
    // 口が足りなくても、充電時のみ給電のガジェットは既に使われている口へ相乗りさせる。
    // 挿しっぱなしにはしないので実際に困らない（同時に挿さっているわけではないため、
    // 配線図では点線の別々の線として描く）。
    const chargeCandidates = (() => {
      const strict = buildChargeCandidates(false, !chargingOnly)
      if (strict.length > 0 || !chargingOnly) return strict
      const shared = buildChargeCandidates(true, false)
      if (shared.length > 0) return shared
      // 充電器・タップ・ドックが1口も無いときの最後の手段として PC の USB 口を使う。
      // 実物でもマウスやキーボードは PC に挿して充電する。ここが無いと
      // 「電源供給元が不足しています」と言いながら PC の USB が丸ごと余る
      return buildChargeCandidates(true, true)
    })()
    // 型ごとの候補選びだけでは、指定した USB-A 充電器より別の USB-C 充電器が優先される。
    const pinnedCandidates = chargeCandidates.filter(({ charger }) => charger.id === gadget.powerSourceGadgetId)
    const candidates = pinnedCandidates.length > 0 ? pinnedCandidates : chargeCandidates
    // 使いたい口（ユーザー指定 or 前回と同じ口）があれば、その口を持つ型を優先する
    const preferredCandidate = candidates.find(({ charger, sourceType }) => {
      const wanted = preferredPortId(gadget, charger.id)
      return !!wanted && outputSlotsOf(charger, gadget).some((slot) => slot.id === wanted && slot.type === sourceType)
    })
    // 同じ空き具合なら、ガジェット側と同じ端子の口を選ぶ。
    // USB-A 給電のライトに USB-C の口を割り当てると、USB-A が余っているのに
    // 変換ケーブルを要求することになる
    const chosen = preferredCandidate ?? candidates.reduce<typeof chargeCandidates[number] | null>(
      (best, candidate) => {
        if (best === null || candidate.use < best.use) return candidate
        if (candidate.use > best.use) return best
        return candidate.sourceType === chargeInput && best.sourceType !== chargeInput ? candidate : best
      },
      null)
    if (chosen) {
      pushPowerConnection({
        id: `power-${gadget.id}`,
        fromGadgetId: chosen.charger.id,
        fromPortType: chosen.sourceType,
        toGadgetId: gadget.id,
        toPortType: chargeInput,
        cableType: chosen.cableType,
        chargingOnly,
        sourcePortId: takeSlot(chosen.charger, gadget, chosen.sourceType, occupiesPort),
      })
      continue
    }

    // 充電器が不足している場合は警告（PCからは給電しない）
    if (chargeInput) {
      // 給電元自体はあるのに挿せない＝口が埋まっている。原因が分かるよう文言を分ける。
      // USB の口を1つも持たない電源タップだけの構成では「口が埋まっている」ではなく
      // 「充電器が無い」が正しいので、実際に口を持つ給電元の有無で判定する
      const outOfPorts = !noOutlet && usbPowerSources.some((source) => outputSlotsOf(source).length > 0)
      // ノートPCはハブ・ドックの通常の USB 口では充電できない（PD 対応の口が要る）。
      // ここを「口が埋まっている」と言うと、空いている口を指して直せと言うことになる
      const roomySources = usbPowerSources.filter((source) =>
        hasSlotRoom(source, 'USB_C', gadget, occupiesPort, false) ||
        hasSlotRoom(source, 'USB_A', gadget, occupiesPort, false))
      // ノートPC が充電できる口は「PD を通せる USB-C / Thunderbolt」だけ。
      // USB-A しか空いていない場合も、ハブ・ドックの通常の USB-C しか無い場合も、
      // 「口が埋まっている」ではなく「PD 対応の充電器が要る」が正しい。
      // 給電元のカテゴリではなく端子で見る（タップの USB-A で判定を外していた）
      const hasPdCapableRoom = roomySources.some((source) =>
        source.ports.some((port) =>
          (port.type === 'USB_C' || port.type === 'Thunderbolt') &&
          (port.direction === 'output' || port.direction === 'bidirectional') &&
          hasSlotRoom(source, port.type, gadget, occupiesPort, false) &&
          (!poweredUsbDistributors.some((distributor) => distributor.id === source.id) ||
            port.supportsPowerDelivery === true || hasPowerDeliveryLabel(port))))
      const needsPdCharger = !noOutlet &&
        gadget.category === 'PC' && gadget.pcFormFactor === 'laptop' &&
        roomySources.length > 0 && !hasPdCapableRoom
      // コンセントのない環境では充電器・電源タップを足しても挿す先がないので、案内を変える
      warnings.push(noOutlet
        ? (lang === 'en'
            ? `${gadget.name}: Cannot be charged — there is no outlet and no free power bank port.`
            : `${gadget.name}: コンセントも、モバイルバッテリーの空きもないため充電できません。`)
        : needsPdCharger
        ? (lang === 'en'
            ? `${gadget.name}: Needs a USB-C PD charger. USB-A ports, and a hub or dock's regular USB ports, cannot charge a laptop.`
            : `${gadget.name}: PD対応の充電器が必要です。USB-A や、ハブ・ドックの通常のUSB口ではノートPCを充電できません。`)
        : outOfPorts
        ? (lang === 'en'
            ? `${gadget.name}: All charger ports are in use. Please add a charger.`
            : `${gadget.name}: 充電器の口がすべて埋まっています。充電器を追加してください。`)
        : (lang === 'en'
            ? `${gadget.name}: No power source available. Please add a charger or power strip.`
            : `${gadget.name}: 電源供給元が不足しています。充電器または電源タップを追加してください。`))
      suggest('Charger', 'charger', gadget.id)
      // 口が埋まっているだけなら充電器を足せば済む。供給元そのものが無いときは
      // 壁から取る手（電源タップ）も要るので両方を勧める
      if (!outOfPorts) suggest('PowerStrip', 'outlet', gadget.id)
      const failedPort = chargeInput
      connections.push({
        id: `failed-power-${connIndex++}`,
        fromGadgetId: 'failed-power',
        fromPortType: failedPort,
        toGadgetId: gadget.id,
        toPortType: failedPort,
        cableType: failedPort,
        chargingOnly,
      })
    }
  }

  // 壁コンセントまたは電源タップの空き不足
  if (unpoweredAcNames.length > 0) {
    warnings.push(noOutlet
      ? (lang === 'en'
          ? `No wall outlet available: ${unpoweredAcNames.join(', ')} cannot be powered. Use a power bank, or increase the outlet count.`
          : `壁コンセントがないため、${unpoweredAcNames.join('・')} に給電できません。モバイルバッテリーを使うか、壁コンセント口数を増やしてください。`)
      : (lang === 'en'
          ? `No free wall or power-strip outlet for: ${unpoweredAcNames.join(', ')}. Increase the wall outlet count or add a power strip.`
          : `壁コンセントと電源タップの空きがないため、${unpoweredAcNames.join('・')} に給電できません。壁コンセント口数を増やすか、電源タップを追加してください。`))
    // 壁コンセントが1口も無い構成では電源タップを足しても挿す先が無い。
    // 勧めるのは「空きが足りない」ときだけ
    if (!noOutlet) suggest('PowerStrip', 'outlet')
  }
  for (const desk of selected.filter((gadget) =>
    gadget.category === 'Desk' && gadget.isHeightAdjustable && gadget.deskLiftType === 'electric')) {
    warnings.push(lang === 'en'
      ? `${desk.name}: Leave enough cable slack for the desk's maximum height, or mount the power strip under the moving desktop.`
      : `${desk.name}: 最高位置まで昇降してもケーブルが張らない余長を確保するか、電源タップを昇降する天板下へ固定してください。`)
  }
  const requiredCables = countRequiredCables(selected, plan, connections)
  return { connections, requiredCables, warnings, suggestions: [...suggestionMap.values()] }
}

/**
 * 必要なケーブル（requiredCables）の集計。
 *
 * ケーブルの在庫や購入要否は扱わない。これはデスク環境を共有するアプリであって
 * ケーブルの管理ツールではない。requiredCables は配線図に線が何本あるかの目安。
 * 無線接続は足さない。「用意すべきケーブルの本数」であって接続の本数ではないので、
 * 混ぜるとケーブルが1本もないデスクにも本数が出る。
 *
 * generateWiring から切り出してあるのは、配線図を手で直したとき（本数・線の追加削除）に
 * 配線全体を作り直さずに本数だけ更新するため（WiringResultScreen の handleMapChange）。
 * engineConnections は generateWiring の出力。保存済みの wiringResult.connections でもよい。
 */
export function countRequiredCables(
  gadgets: readonly Gadget[],
  plan: DeskPlan,
  engineConnections: readonly Connection[],
): RequiredCable[] {
  // generateWiring と同じ対象（デスク上の、飾りでもケーブルでもない機材）で判定する
  const selectedIds = new Set(plan.selectedGadgetIds)
  const selected = gadgets.filter((g) => selectedIds.has(g.id) && !g.displayOnly && g.category !== 'Cable')
  const liveIds = new Set(selected.map((g) => g.id))
  // 手で引ける電源ノードはコンセントだけ（ConnectionMap の給電元の変更）。
  // ソーラー・電池のノードからは線を引けない
  const onDesk = (id: string) => liveIds.has(id) || id === WALL_SOURCE_ID
  // 配線図の線は向きを持たない（手で逆向きに引いた線とエンジンの線は同じ1本）
  const pairKey = (a: string, b: string, cableType: CableType) => [a, b].sort().join('~') + '|' + cableType

  const saved = plan.connectionMap?.connections ?? []
  const dismissed = new Set(plan.connectionMap?.dismissedPairs ?? [])
  const savedByPair = new Map(saved.map((c) => [pairKey(c.fromGadgetId, c.toGadgetId, c.cableType), c]))

  type Entry = {
    conn: { fromGadgetId: string; toGadgetId: string; cableType: CableType; fromPortType?: PortType; toPortType?: PortType }
    chargingOnly: boolean
    /** 2in1・3in1 の枝の宣言。配線図側にしかない */
    branchGroupId?: string
    /** 同じ2台を同じ種別で繋いでいる本数（ステレオの L/R・デュアル電源）。配線図側にしかない */
    count: number
  }
  const entries: Entry[] = []
  const engineKeys = new Set<string>()
  for (const conn of engineConnections) {
    if (conn.fromGadgetId === 'failed' || conn.fromGadgetId === 'failed-power') continue
    const key = pairKey(conn.fromGadgetId, conn.toGadgetId, conn.cableType)
    const line = savedByPair.get(key)
    // 配線図で消された線。作り直せばエンジン自身が引かない（isDismissed）が、
    // 手で直した直後は保存済みの出力から数えるのでここでも外す
    if (dismissed.has(key) && !line) continue
    engineKeys.add(key)
    entries.push({
      conn,
      // 充電時のみの線を手で引き直すと常時の線になる（ConnectionMap の addConnection）。
      // 自動の線はエンジンの値を使う：ここで読む配線図は作り直す前の保存値で、
      // ガジェットの給電方法を変えた直後は1回分古い
      chargingOnly: (line?.origin === 'manual' ? line.chargingOnly : conn.chargingOnly) === true,
      branchGroupId: line?.branchGroupId,
      count: line?.count ?? conn.count ?? 1,
    })
  }
  // エンジンが引かない組み合わせを手で引いた線。数えないと、つなぎ方の一覧には行が出るのに
  // 必要なケーブルには入らない（手で引くステレオの L/R はほぼこれにあたる）
  for (const line of saved) {
    if (line.origin !== 'manual' || line.wireless) continue
    if (!onDesk(line.fromGadgetId) || !onDesk(line.toGadgetId)) continue
    if (engineKeys.has(pairKey(line.fromGadgetId, line.toGadgetId, line.cableType))) continue
    entries.push({
      conn: line,
      chargingOnly: line.chargingOnly === true,
      branchGroupId: line.branchGroupId,
      count: line.count ?? 1,
    })
  }

  const countedBranchGroups = new Set<string>()
  const cableMap = new Map<CableType, number>()
  const chargingCableMap = new Map<CableType, number>()
  for (const entry of entries) {
    // 直挿し・変換プラグの判定は枝の「数えた」印より先に済ませる。逆にすると、束ねた枝の
    // 1本目が直挿し（レシーバー等）だったときに印だけ付いて本数は増えず、2本目以降の
    // 実物のケーブルが「もう数えた」扱いで丸ごと落ちる（必要本数が1本少なくなる）。
    if (isNoCableConnection(selected, entry.conn)) continue
    if (entry.branchGroupId !== undefined) {
      if (countedBranchGroups.has(entry.branchGroupId)) continue
      countedBranchGroups.add(entry.branchGroupId)
    }
    const target = entry.chargingOnly ? chargingCableMap : cableMap
    // 束ねた枝は何本挿さっていても1本。複数本の宣言（L/R）はその本数を足す
    const count = entry.branchGroupId !== undefined ? 1 : entry.count
    target.set(entry.conn.cableType, (target.get(entry.conn.cableType) ?? 0) + count)
  }

  return [
    ...Array.from(cableMap.entries()).map(([cableType, count]) => ({ cableType, count })),
    ...Array.from(chargingCableMap.entries()).map(([cableType, count]) => ({ cableType, count, chargingOnly: true })),
  ]
}
