import { isWirelessPortType } from '../constants/portTypes'
import { DeskPlan, DeskZone, Gadget, GadgetCategory, GadgetPlacement, MapConnection, NodeOffset } from '../types'
import { generateWiring } from './wiringEngine'
import { whenLayoutAllowed } from './layoutHold'

// エッジのルーティング・補修は配線本数に比例して重くなる同期処理。1フレーム分(約12ms)
// 経過するごとにイベントループへ制御を戻し、計算中でも他の画面操作（タブ切替など）を
// 処理できるようにする。
const FRAME_BUDGET_MS = 12
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * computeMapLayout の isCancelled が true を返したときに投げる。画面を閉じたあとの裏の計算
 * （公開デスクの歴史の先読み）を、1時点ぶんのレイアウトの途中でも止めるため。
 * 探索の小分け区間と補修候補の間で確かめ、途中の図は返さない。
 */
export class MapLayoutCancelled extends Error {
  constructor() {
    super('map layout cancelled')
    this.name = 'MapLayoutCancelled'
  }
}

// ─── ノード寸法・間隔（content座標系）─────────────────────────────
export const NODE_W = 96
export const NODE_H = 76
const AUTO_NODE_MIN_SIDE = 68

// ノードはアイコンを持たずガジェット名の文字だけで表す（NodeCard/HistoryNode）。
// 省略「…」を極力出さないよう、最小フォントサイズでこの行数までは箱を縦に伸ばす
// （nodeH で高さを逆算する側と、実際に描画する側の両方でこの値を揃えて使う）。
// カテゴリごとの基準寸法：実物のシルエット（縦横比）と存在感を反映し、
// 形と大きさを見ただけで「なんのガジェットか」判別できるようにする（路線図の駅記号の発想）。
// 大型（モニター・PC・デスク）と小物（マウス・充電器・ウォッチ）で面積比 10 倍以上の差をつける。
const CAT_DIMS: Partial<Record<GadgetCategory, { w: number; h: number }>> = {
  Monitor:        { w: 210, h: 118 },  // 最大級・横長ワイド（16:9）
  TV:             { w: 220, h: 124 },
  Projector:      { w: 108, h: 68 },
  VRGlass:        { w: 124, h: 72 },
  Speaker:        { w: 68,  h: 112 },  // 縦長ブックシェルフ
  PC:             { w: 92,  h: 140 },  // 縦長タワー（laptop 形状は LAPTOP_DIMS で横長にする）
  Keyboard:       { w: 190, h: 58 },   // 横長フラット
  Mouse:          { w: 52,  h: 44 },   // 最小級
  Tablet:         { w: 104, h: 128 },  // 縦置きタブレット
  Smartphone:     { w: 58,  h: 104 },  // 縦長スリム
  Smartwatch:     { w: 44,  h: 44 },   // 最小
  Headphone:      { w: 84,  h: 90 },
  Earphone:       { w: 62,  h: 52 },
  Microphone:     { w: 60,  h: 104 },  // 縦長スタンド
  Webcam:         { w: 54,  h: 42 },   // 最小級
  Camera:         { w: 78,  h: 58 },
  Lens:           { w: 48,  h: 62 },
  Tripod:         { w: 62,  h: 104 },
  PenTablet:      { w: 104, h: 64 },
  Light:          { w: 156, h: 48 },   // ライトバーのような横長フラット
  Dock:           { w: 126, h: 54 },   // 横長フラット
  Hub:            { w: 100, h: 48 },
  AudioInterface: { w: 136, h: 66 },
  HeadphoneAmp:   { w: 136, h: 66 },
  Amplifier:      { w: 156, h: 82 },  // ヘッドホンアンプより一回り大きい据置筐体
  Mixer:          { w: 156, h: 70 },
  Storage:        { w: 56,  h: 46 },   // 小型
  Router:         { w: 112, h: 56 },
  NetworkSwitch:  { w: 112, h: 44 },
  Modem:          { w: 112, h: 56 },
  GameConsole:    { w: 136, h: 78 },
  CaptureDevice:  { w: 112, h: 58 },
  KVM:            { w: 126, h: 58 },
  Printer:        { w: 120, h: 92 },
  Printer3D:      { w: 140, h: 140 },  // 大型キューブ
  Charger:        { w: 72,  h: 72 },   // 小型
  MobileBattery:  { w: 58,  h: 50 },   // 小型
  PowerStrip:     { w: 180, h: 50 },   // 横長タップ
  UPS:            { w: 112, h: 92 },
  SmartHome:      { w: 58,  h: 58 },   // 小型
  WallPanel:      { w: 150, h: 92 },
  Accessory:      { w: 54,  h: 48 },   // 小型
  SmallDevice:    { w: 52,  h: 46 },   // 小型
  Desk:           { w: 230, h: 72 },   // 最大幅
  Chair:          { w: 100, h: 116 },
  Controller:     { w: 118, h: 68 },
  MonitorArm:     { w: 82,  h: 112 },
  MicArm:         { w: 82,  h: 112 },
  Instrument:     { w: 72,  h: 122 },
  Other:          { w: 82,  h: 82 },
}

// ノートPC（クラムシェル）はタワーと違い横長のシルエット
const LAPTOP_DIMS = { w: 170, h: 104 }
// ノード間隔は「配線回避のための最小クリアランス(CLEAR)×2」より十分広く取り、
// 複数配線が同じ隙間を通っても重ならない幅（複数レーン分）を確保する。
const COL_GAP = 36
const ROW_GAP = 48   // 直角配線のレーン分の余白を含む
// 配線1本ぶんのレーン幅（ケーシング込み）と、ノードから確保する最小間隔。
// 行間コリドーの必要幅を見積もるために使う（ルーティングの CLEAR・LANE_GAP と同値）。
const LANE_PITCH = 12
const NODE_CLEARANCE = 9
const TEMPLATE_COL_GAP = 24
const TEMPLATE_ROW_GAP = 36
const PAD = 28
const CP_STEP = 24   // 接続点のファンアウト間隔（電源タップ等の複数配線を扇状に分散。配線の実太さ5.5+ケーシング11に合わせて拡大）

export const WALL_ID = 'wall'
// スマートホームガジェットのソーラー／電池給電。wiringEngine が電源ソースとして
// この擬似IDから接続を生やすため、コンセントと同じく擬似ノードを立てる
// （実ガジェットではないので selectedGadgetIds には現れない）。
export const SOLAR_ID = 'solar'
export const BATTERY_ID = 'battery'
export type PowerSourceId = typeof WALL_ID | typeof SOLAR_ID | typeof BATTERY_ID
export const POWER_SOURCE_IDS: ReadonlySet<string> = new Set([WALL_ID, SOLAR_ID, BATTERY_ID])
// 旧レイアウトの飾りまとめ枠を識別するためのID。
export const DECOR_ID = '__decor__'

const NON_WIRING_CATEGORIES: ReadonlySet<GadgetCategory> = new Set([
  'Desk', 'Chair', 'Furniture', 'WallPanel', 'Accessory', 'DeskPad', 'MousePad',
  'Plant', 'Lens', 'Tripod', 'PCPart', 'Other',
])

export function wiringMapGadgets(gadgets: Gadget[], connections: MapConnection[]): Gadget[] {
  const connectedIds = new Set(connections.flatMap((connection) => [connection.fromGadgetId, connection.toGadgetId]))
  return gadgets.filter((gadget) => !gadget.displayOnly && (
    !NON_WIRING_CATEGORIES.has(gadget.category)
    || gadget.ports.some((port) => port.count > 0)
    || connectedIds.has(gadget.id)
  ))
}

/** L/R・ウーファーの仮想ノードIDを、保存元のガジェットIDへ戻す */
export function baseMapNodeId(nodeId: string): string {
  if (nodeId.endsWith('__SUB')) return nodeId.slice(0, -5)
  if (nodeId.endsWith('__L') || nodeId.endsWith('__R')) return nodeId.slice(0, -3)
  return nodeId
}

/** 分割キーボードの反対側にある仮想ノードID。スピーカーなど他のL/Rペアは同期しない */
export function pairedSplitKeyboardNodeId(nodeId: string, category: GadgetCategory): string | undefined {
  if (category !== 'Keyboard') return undefined
  if (nodeId.endsWith('__L')) return `${nodeId.slice(0, -3)}__R`
  if (nodeId.endsWith('__R')) return `${nodeId.slice(0, -3)}__L`
  return undefined
}

// コンセント（壁）の擬似ガジェット
function wallGadget(): Gadget {
  return { id: WALL_ID, name: 'コンセント', category: 'PowerStrip', ports: [], createdAt: '' }
}

// ソーラーパネル・電池の擬似ガジェット（表示名は MapNodeLabel 側で言語別に出す）
function powerSourceGadget(id: PowerSourceId): Gadget {
  return {
    id,
    name: id === SOLAR_ID ? 'ソーラーパネル' : '電池・バッテリー',
    category: 'PowerStrip',
    ports: [],
    createdAt: '',
  }
}

export interface MapNode {
  id: string
  gadget: Gadget
  tier: number
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
  isWall: boolean
  /** ソーラー・電池の擬似ノード（コンセントと同じく実ガジェットを持たない電源ソース） */
  powerSource?: 'solar' | 'battery'
  isDecor?: boolean
  sideLabel?: 'L' | 'R'
  /** スピーカー製品に含まれる独立ウーファーの仮想ノード */
  isSubwoofer?: boolean
  /** このノードに内包したガジェット（タブレットに吸着給電されるペン等）。独立ノードは作らずバッジで示す */
  attached?: Gadget[]
  /**
   * 手で動かす前の、自動配置が決めた位置（NodeOffset.bx/by の元）。ドラッグした時点のこの値を
   * 一緒に保存すると、あとで構成が変わって基準位置が動いても置いた場所に留まる
   */
  baseX?: number
  baseY?: number
}

export interface MapEdge {
  conn: MapConnection
  from: MapNode
  to: MapNode
  points: { x: number; y: number }[]   // 直角配線の折れ点列
  isPairLink?: boolean   // true: 左右スピーカーの対を示す装飾線（常に直線・実配線ではない）
}

export interface MapLayout {
  nodes: MapNode[]
  edges: MapEdge[]
  /** キャンバスの大きさ（帯の予約幅を含むため、実際のノードより広いことがある） */
  width: number
  height: number
  /**
   * 実際にノードが占めている範囲。中央合わせ（fit）はこちらを基準にする。
   * width/height で中央合わせすると、ノードのない予約幅ぶんだけ図が片側に寄り、
   * 反対側に大きな余白ができてしまう。
   */
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}


const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ─── レイアウト優先順位 ──────────────────────────────────────────
// ① 設置場所(zone) → ② ガジェット種類の既定ロール → ③ 左右対称 → ④ グループ化(帯) → ⑤ 接続関係 → ⑥ 配線長
// の順で「行(tier)」と「帯(band: 0=左/1=中央/2=右)」を決定してから配置する（力学レイアウトではなく間取り図的な2段階配置）。
type RowClass = 'camera' | 'display' | 'game' | 'front' | 'generic' | 'pc' | 'charger' | 'strip' | 'wall'
const ROW_TIER: Record<RowClass, number> = {
  camera: 0, display: 1, game: 2, front: 3, generic: 3, pc: 4, charger: 4, strip: 5, wall: 6,
}

// カテゴリの既定ロール（設置場所未指定時の既定の行・帯）
function categoryRole(cat: GadgetCategory): { row: RowClass; band: 0 | 1 | 2 } {
  switch (cat) {
    case 'Webcam':
    case 'Camera':
    case 'Light':
      return { row: 'camera', band: 1 }        // モニター上
    case 'Monitor':
    case 'TV':
    case 'Projector':
    case 'VRGlass':
      return { row: 'display', band: 1 }       // 最上段中央（複数なら横並び）
    case 'Speaker':
      return { row: 'display', band: 1 }       // モニターと同段。ペアは左右対称に振り分け
    case 'Dock':
    case 'Hub':
      return { row: 'front', band: 1 }         // PCと周辺機器の中間（接続の重心へ寄せる）
    case 'Keyboard':
    case 'Mouse':
    case 'Tablet':
    case 'Controller':
      return { row: 'front', band: 1 }         // モニター下（手元で操作するガジェット）
    case 'AudioInterface':
    case 'Mixer':
    case 'Amplifier':
      return { row: 'front', band: 1 }         // スピーカーとPCの中間
    case 'PC':
      return { row: 'pc', band: 2 }            // 充電器と同段・右寄り
    default:
      return { row: 'generic', band: 1 }
  }
}

// 設置場所(zone) → 行クラス／帯のヒント
const ZONE_ROWCLASS: Partial<Record<DeskZone, 'back' | 'front' | 'under'>> = {
  back_left: 'back', back_center: 'back', back_right: 'back',
  front_left: 'front', front_center: 'front', front_right: 'front',
  under_desk: 'under', desk_back: 'back',
  wall_left: 'back', wall_center: 'back', wall_right: 'back', shelf: 'back',
  floor_left: 'under', floor_center: 'under', floor_right: 'under',
  room_left: 'front', room_center: 'front', room_right: 'front', sofa_area: 'front', storage_area: 'under',
}
const ZONE_BAND: Partial<Record<DeskZone, 0 | 1 | 2>> = {
  back_left: 0, back_center: 1, back_right: 2,
  front_left: 0, front_center: 1, front_right: 2,
  desk_left: 0, desk_right: 2,
  under_desk: 1, desk_back: 1,
  wall_left: 0, wall_center: 1, wall_right: 2, shelf: 2,
  floor_left: 0, floor_center: 1, floor_right: 2,
  room_left: 0, room_center: 1, room_right: 2, sofa_area: 0, storage_area: 2,
}

/**
 * 天板・チェアは「ガジェットをつなぐ配線」の主役ではなく構成の土台なので、配線の有無に
 * かかわらず常にコンセントと同じ最下段へ置く（昇降デスクのように電源を引く天板でも
 * 行の途中に割り込ませない）。
 */
function isFoundationRow(cat: GadgetCategory): boolean {
  return cat === 'Desk' || cat === 'Chair'
}

// 行・帯の決定：① 設置場所 > ② カテゴリの既定ロール
function resolveRow(cat: GadgetCategory, isWall: boolean, zone?: DeskZone, isLaptop?: boolean): { tier: number; band: 0 | 1 | 2 } {
  if (isWall) return { tier: ROW_TIER.wall, band: 1 }
  // 天板・チェアは常にコンセント行（isFoundationRow のコメント参照）。帯だけ設置場所で調整可
  if (isFoundationRow(cat)) return { tier: ROW_TIER.wall, band: (zone && ZONE_BAND[zone]) ?? 1 }
  // 充電器・電源タップ・プリンターは常にデスク下の同じ行にまとめる。帯だけ設置場所で調整可。
  // プリンターは配線がなければ後段の「無配線行」判定で最下段へ落ちる。
  if (cat === 'PowerStrip' || cat === 'Charger' || cat === 'Printer3D') return { tier: ROW_TIER.strip, band: (zone && ZONE_BAND[zone]) ?? 1 }
  // モバイルバッテリーは持ち運びのガジェットなので、デスク下へは寄せず手元の行に置く
  if (cat === 'MobileBattery') return { tier: ROW_TIER.charger, band: (zone && ZONE_BAND[zone]) ?? 1 }
  // ノートPCは手元（モバイルバッテリーの行）、それ以外（デスクトップ・未指定）は本体を
  // デスク下に置くのが実態に近いので電源タップ・充電器と同じ行にまとめる。
  // ただし設置場所がモニターと同じ「back」帯（back_center等）に明示指定されている場合は
  // それを優先する（ノートPCテンプレートのように、PC本体をモニター代わりに置く構成のため）。
  if (cat === 'PC' && !(zone !== undefined && ZONE_ROWCLASS[zone] === 'back')) {
    return { tier: isLaptop ? ROW_TIER.charger : ROW_TIER.strip, band: (zone && ZONE_BAND[zone]) ?? 2 }
  }

  const role = categoryRole(cat)
  if (zone !== undefined) {
    const rc = ZONE_ROWCLASS[zone]
    const band = ZONE_BAND[zone] ?? role.band
    if (rc === 'under') return { tier: ROW_TIER.front, band }
    if (rc === 'back')  return { tier: role.row === 'camera' ? ROW_TIER.camera : ROW_TIER.display, band }
    if (rc === 'front') return { tier: ROW_TIER.front, band }
    return { tier: ROW_TIER[role.row], band }   // desk_left/desk_right：行はそのまま、帯だけ強制
  }
  return { tier: ROW_TIER[role.row], band: role.band }
}

// ─── レイアウト計算（決定論的）─────────────────────────────────────
// 手動リサイズの許容範囲
/** ノードから確保する最小間隔（配線の実太さ5.5+ケーシング11に合わせて拡大） */
export const MAP_CLEAR = 9
/**
 * 接続点から辺の外へ出る足の長さ。CLEAR より外にあるので、この足は
 * 自分のノードの回避マージンに触れない。
 */
export const MAP_STUB_OUT = MAP_CLEAR + 4

export const NODE_MIN = 68
export const NODE_MAX = 480

// ノード集合（L/R・ウーファーの展開、内包、電源ソース）と寸法。寸法は接続数とカテゴリだけで決まり、
// 経路探索の結果には左右されない。履歴が全期間の寸法を揃えるときに、経路を引かずに寸法だけを得るため切り出している
function layoutNodeGraph(
  gadgets: Gadget[],
  connections: MapConnection[],
  nodeSizes: Record<string, { w: number; h: number }>,
) {
  // 未接続の機器は残し、配線を持たない家具・小物と飾りだけを除く。
  gadgets = wiringMapGadgets(gadgets, connections)
  // タブレットに吸着給電されるペン等は、単独のノードにすると線1本ぶんの幅を取るだけになるので
  // タブレットのノードへ内包し、カード上のバッジで示す（線も引かない）
  const categoryOf = new Map(gadgets.map((g) => [g.id, g.category]))
  const attachedTo = new Map<string, string>()
  for (const c of connections) {
    // Stylus は「このタブレットで使うペン」の関係（wiringEngine が線の代わりに返す）
    if (c.cableType === 'wirelessCharging' || c.cableType === 'Stylus') {
      const from = categoryOf.get(c.fromGadgetId)
      const to = categoryOf.get(c.toGadgetId)
      if (from === 'Tablet' && to === 'Accessory') attachedTo.set(c.toGadgetId, c.fromGadgetId)
      else if (to === 'Tablet' && from === 'Accessory') attachedTo.set(c.fromGadgetId, c.toGadgetId)
      continue
    }
    // アームは支えているだけで信号も電気も流れない。独立したノードにすると
    // 線1本ぶんの幅を取るだけなので、支えているガジェットのカードへ畳む。
    // デュアルアームは2台を支えるが実体は1つなので、最初の1台に寄せる。
    // バッジは各ガジェットが自分の MonitorArm ポートで判定するため、両方に出る。
    //
    // 畳むのは必ずアーム側。自動生成はアームが from 側だが、配線図で手動接続を
    // 作ったときの向きはタップ順で決まるため、from を無条件にアーム扱いすると
    // モニターの方が畳まれて図から消える（映像も電源の線も一緒に落ちる）。
    if (c.cableType === 'MonitorArm' || c.cableType === 'MicArm') {
      const isArm = (id: string) => {
        const category = categoryOf.get(id)
        return category === 'MonitorArm' || category === 'MicArm'
      }
      const armId = isArm(c.fromGadgetId) ? c.fromGadgetId : isArm(c.toGadgetId) ? c.toGadgetId : null
      if (armId && !attachedTo.has(armId)) {
        attachedTo.set(armId, armId === c.fromGadgetId ? c.toGadgetId : c.fromGadgetId)
      }
    }
  }
  const gadgetIds = new Set(gadgets.map((gadget) => gadget.id))
  for (const gadget of gadgets) {
    const targetId = gadget.mounting?.targetGadgetId
    if (!targetId || targetId === gadget.id || !gadgetIds.has(targetId) || attachedTo.has(gadget.id)) continue
    // 相互参照はどちらか一方だけを内包し、ノードが両方消えるのを防ぐ。
    if (attachedTo.get(targetId) === gadget.id) continue
    attachedTo.set(gadget.id, targetId)
  }
  const wiredGadgets = gadgets.filter((g) => !g.displayOnly && !attachedTo.has(g.id))
  const attachedByHost = new Map<string, Gadget[]>()
  for (const g of gadgets) {
    const hostId = attachedTo.get(g.id)
    if (!hostId) continue
    attachedByHost.set(hostId, [...(attachedByHost.get(hostId) ?? []), g])
  }
  const realIds = new Set(wiredGadgets.map((g) => g.id))
  // 採用する接続：両端が実ガジェット、または片端が電源ソースの擬似ノード
  // （wall＝コンセント／solar＝ソーラーパネル／battery＝電池）
  const edgesRaw0 = connections.filter((c) => {
    const f = realIds.has(c.fromGadgetId) || POWER_SOURCE_IDS.has(c.fromGadgetId)
    const t = realIds.has(c.toGadgetId) || POWER_SOURCE_IDS.has(c.toGadgetId)
    return f && t
  })

  // ノード集合（電源ソースは接続に登場したものだけ擬似ノードを追加）
  const usesSource = (id: string) =>
    edgesRaw0.some((c) => c.fromGadgetId === id || c.toGadgetId === id)
  const usesWall = usesSource(WALL_ID)
  const baseGadgets: Gadget[] = [
    ...wiredGadgets,
    ...(usesWall ? [wallGadget()] : []),
    ...(usesSource(SOLAR_ID) ? [powerSourceGadget(SOLAR_ID)] : []),
    ...(usesSource(BATTERY_ID) ? [powerSourceGadget(BATTERY_ID)] : []),
  ]
  const byId = new Map(baseGadgets.map((g) => [g.id, g]))

  // ── L/R 仮想ノードに展開するガジェット（スピーカー stereo pair / 分割キーボード）──
  // データモデル上 L/R 別ポートを持たないため、スピーカーは選択側、分割キーボードは L 側へ繋ぐ。
  const isSplit = (g: Gadget) =>
    (g.category === 'Speaker' && g.stereoPair === true) ||
    (g.category === 'Keyboard' && !!g.splitKeyboard)
  const splitHalf = new Map<string, 'L' | 'R'>()
  const virtualParent = new Map<string, string>()
  const subwooferNodes = new Set<string>()
  const subwooferNodeOf = new Map<string, string>()
  const layoutIds: string[] = []
  for (const g of baseGadgets) {
    if (isSplit(g)) {
      const leftId = g.id + '__L'
      const rightId = g.id + '__R'
      layoutIds.push(leftId, rightId)
      splitHalf.set(leftId, 'L')
      splitHalf.set(rightId, 'R')
      virtualParent.set(leftId, g.id)
      virtualParent.set(rightId, g.id)
    } else {
      layoutIds.push(g.id)
    }
    if (g.category === 'Speaker' && g.hasSubwoofer) {
      const subwooferId = g.id + '__SUB'
      layoutIds.push(subwooferId)
      virtualParent.set(subwooferId, g.id)
      subwooferNodes.add(subwooferId)
      subwooferNodeOf.set(g.id, subwooferId)
    }
  }
  const gadgetOfNode = (nodeId: string): Gadget => byId.get(virtualParent.get(nodeId) ?? nodeId)!
  const resolveEndpoint = (rawId: string): string => {
    const g = byId.get(rawId)
    if (!g || !isSplit(g)) return rawId
    // スピーカーの入力側は未指定なら R（アンプ・DAC が右に置かれる構成が多い）
    return rawId + (g.category === 'Speaker' ? `__${g.speakerInputSide ?? 'R'}` : '__L')
  }
  const edgesRaw: MapConnection[] = edgesRaw0.flatMap((c) => {
    const mapped: MapConnection = {
      ...c,
      fromGadgetId: resolveEndpoint(c.fromGadgetId),
      toGadgetId: resolveEndpoint(c.toGadgetId),
    }
    const subwooferId = subwooferNodeOf.get(c.toGadgetId)
    const count = (c.cableType === 'Power' || c.cableType === 'DCPower') && byId.get(c.toGadgetId)?.hasSubwoofer
      ? Math.max(c.count ?? 1, 2)
      : c.count ?? 1
    if (!subwooferId || (c.cableType !== 'Power' && c.cableType !== 'DCPower') || count < 2) return [mapped]
    return [
      { ...mapped, count: count > 2 ? count - 1 : undefined },
      {
        ...c,
        id: `subwoofer-power-${c.id}`,
        fromGadgetId: resolveEndpoint(c.fromGadgetId),
        toGadgetId: subwooferId,
        count: undefined,
        countSource: 'subwoofer',
      },
    ]
  })

  // 次数・隣接（展開後のノードID基準）
  const degree = new Map<string, number>()
  const neighbors = new Map<string, string[]>()
  for (const id of layoutIds) { degree.set(id, 0); neighbors.set(id, []) }
  for (const e of edgesRaw) {
    degree.set(e.fromGadgetId, (degree.get(e.fromGadgetId) ?? 0) + 1)
    degree.set(e.toGadgetId, (degree.get(e.toGadgetId) ?? 0) + 1)
    neighbors.get(e.fromGadgetId)?.push(e.toGadgetId)
    neighbors.get(e.toGadgetId)?.push(e.fromGadgetId)
  }

  // ノード寸法：カテゴリの基準シルエット（縦横比）をベースに、
  // 接続が多いほど幅を広げる（電源タップ等で重なり回避）
  const baseDims = (id: string) => {
    if (POWER_SOURCE_IDS.has(id)) return { w: 140, h: 52 }
    const g = gadgetOfNode(id)
    const categoryDims = subwooferNodes.has(id)
      ? { w: 96, h: 88 }
      : g.category === 'PC' && g.pcFormFactor === 'laptop'
      ? LAPTOP_DIMS
      : CAT_DIMS[g.category] ?? { w: NODE_W, h: NODE_H }
    // 分割キーボードは左右の2ノードに分けて描く。片側に1台ぶんの幅を持たせると、
    // 図の上でキーボードが2台あるように見え、前の段が横に間延びする
    const dims = g.category === 'Keyboard' && splitHalf.has(id)
      ? { w: categoryDims.w / 2, h: categoryDims.h }
      : categoryDims
    // 小型・縦長アイコンも片側だけを最小値へ丸めず、元の縦横比を保ったまま拡大する。
    const autoMinSide = AUTO_NODE_MIN_SIDE
    const minSideScale = Math.max(1, autoMinSide / Math.min(dims.w, dims.h))
    let w = dims.w * minSideScale
    let h = dims.h * minSideScale

    // 接続数によるサイズ変化は電源タップのみ（接続点を角へ追いやらず間隔を確保するため）。
    // 充電器は4本以上でわずかに拡大、他カテゴリは接続数でサイズを変えない。
    const connectionCount = degree.get(id) ?? 0
    if (g.category === 'PowerStrip' && connectionCount > 2) {
      const requiredLongSide = 64 + (connectionCount - 1) * CP_STEP
      const connectionScale = Math.max(1, requiredLongSide / Math.max(w, h))
      w *= connectionScale
      h *= connectionScale
    } else if (g.category === 'Charger' && connectionCount >= 4) {
      w *= 1.2
      h *= 1.2
    } else if (connectionCount >= 7) {
      const connectionScale = Math.min(1.5, 1 + (connectionCount - 6) * 0.1)
      w *= connectionScale
      h *= connectionScale
    }
    return {
      w: clamp(Math.round(w), autoMinSide, NODE_MAX),
      h: clamp(Math.round(h), autoMinSide, NODE_MAX),
    }
  }
  const nodeW = (id: string) => {
    const base = baseDims(id).w
    const ov = nodeSizes[id]
    if (ov) return clamp(ov.w, NODE_MIN, NODE_MAX)
    return base
  }

  const nodeH = (id: string) => {
    // 角の長押しドラッグによる手動リサイズが最優先
    const ov = nodeSizes[id]
    if (ov) return clamp(ov.h, NODE_MIN, NODE_MAX)
    return baseDims(id).h
  }
  return { attachedByHost, baseGadgets, degree, edgesRaw, gadgetOfNode, isSplit, layoutIds, neighbors, nodeH, nodeW, splitHalf, subwooferNodeOf, subwooferNodes, usesWall, virtualParent }
}

/**
 * 経路を引かずに、computeMapLayout が返すノードの寸法だけを求める（ノードID → 幅・高さ）。
 * 返すのは computeMapLayout の nodes[].w / h と同じ値（整数に丸めた後の値）
 */
export function computeMapNodeSizes(
  gadgets: Gadget[],
  connections: MapConnection[],
  nodeSizes: Record<string, { w: number; h: number }> = {},
): Map<string, { w: number; h: number }> {
  const { layoutIds, nodeW, nodeH } = layoutNodeGraph(gadgets, connections, nodeSizes)
  return new Map(layoutIds.map((id) => [id, { w: Math.round(nodeW(id)), h: Math.round(nodeH(id)) }]))
}

export async function computeMapLayout(
  gadgets: Gadget[],
  connections: MapConnection[],
  placements: GadgetPlacement[] = [],
  nodeOffsets: Record<string, NodeOffset> = {},
  nodeSizes: Record<string, { w: number; h: number }> = {},
  centerPrimaryDevices = false,
  // 呼び出し元が手を引いたか。true になったら次に制御を返した地点で MapLayoutCancelled を投げる
  isCancelled?: () => boolean,
): Promise<MapLayout> {
  // 実機（Hermes・JIT無し）と開発機（V8・JIT有り）で何倍違うかを掴むための計測。
  // 画面側ではなくここに置く：warmup・履歴アニメも同じ関数を通るので取りこぼさない。
  const startedAt = Date.now()
  let lastYieldAt = startedAt
  let nextYield: Promise<void> | undefined
  const pauseIfNeeded = (): Promise<void> | undefined => {
    if (isCancelled?.()) throw new MapLayoutCancelled()
    // 計算中にタイマーを期限到達させ、区切りごとにタイマーの最小待ち時間を追加しない。
    nextYield ??= yieldToEventLoop()
    if (Date.now() - lastYieldAt < FRAME_BUDGET_MS) return
    const pause = nextYield
    nextYield = undefined
    return pause.then(() => whenLayoutAllowed()).then(() => {
      lastYieldAt = Date.now()
      if (isCancelled?.()) throw new MapLayoutCancelled()
    })
  }
  if (isCancelled?.()) throw new MapLayoutCancelled()
  const zoneOf = new Map(placements.map((p) => [p.gadgetId, p.zone]))
  const { attachedByHost, baseGadgets, degree, edgesRaw, gadgetOfNode, isSplit, layoutIds, neighbors, nodeH, nodeW, splitHalf, subwooferNodeOf, subwooferNodes, usesWall, virtualParent } = layoutNodeGraph(gadgets, connections, nodeSizes)

  // ── ① 設置場所 → ② カテゴリ既定ロールで 行(tier)・帯(band) を決定 ──
  const tierOf = new Map<string, number>()
  const bandOf = new Map<string, 0 | 1 | 2>()
  for (const id of layoutIds) {
    const g = gadgetOfNode(id)
    const isWall = POWER_SOURCE_IDS.has(id)   // 電源ソースはまとめて最下段へ
    const zone = zoneOf.get(virtualParent.get(id) ?? id)
    const isLaptop = g.category === 'PC' && g.pcFormFactor === 'laptop'
    const { tier, band } = resolveRow(g.category, isWall, zone, isLaptop)
    tierOf.set(id, tier)
    bandOf.set(id, band)
  }

  // ウーファーは床置き想定なので、親スピーカーの設置場所にかかわらず電源タップと同じ段へ置く。
  // 左右の指定がある場合は帯だけ引き継ぐ
  for (const id of subwooferNodes) {
    const zone = zoneOf.get(baseMapNodeId(id))
    tierOf.set(id, ROW_TIER.strip)
    bandOf.set(id, (zone && ZONE_BAND[zone]) ?? 1)
  }

  // コンセント（wall）は接続先の電源タップと同じ帯に揃える。
  // wall の帯は既定で中央固定だが、電源タップが desk_left/desk_right など
  // 中央以外の帯に置かれていると、真下へ寄れず側面から回り込むL字配線になってしまう。
  // 複数の電源タップに繋がる場合は、そのうち最初の1台の帯へ揃える。
  if (usesWall) {
    const stripNeighborId = (neighbors.get(WALL_ID) ?? [])
      .find((id) => gadgetOfNode(id).category === 'PowerStrip')
    const stripBand = stripNeighborId ? bandOf.get(stripNeighborId) : undefined
    if (stripBand !== undefined) bandOf.set(WALL_ID, stripBand)
  }

  // ── ③ 左右対称：split デバイスは明示設置場所がなければカテゴリの行の左右に固定 ──
  // Speaker → display 段, Keyboard → front 段
  for (const [id, half] of splitHalf) {
    const origId = id.slice(0, -3)
    if (!zoneOf.has(origId)) {
      const g = gadgetOfNode(id)
      const defaultTier = g.category === 'Keyboard' ? ROW_TIER.front : ROW_TIER.display
      tierOf.set(id, defaultTier)
      bandOf.set(id, half === 'L' ? 0 : 2)
    }
  }

  // スピーカーノードが2個なら、別々に登録された2台でもステレオペアと同様に
  // モニターと同じ行の左右へ配置する。名前→IDで並べ、左右が毎回入れ替わらないようにする。
  const monitorSideSpeakerIds = layoutIds
    .filter((id) => gadgetOfNode(id).category === 'Speaker' && !subwooferNodes.has(id))
    .sort((a, b) => {
      const byName = gadgetOfNode(a).name.localeCompare(gadgetOfNode(b).name)
      return byName !== 0 ? byName : a.localeCompare(b)
    })
  const monitorSideSpeakers = new Set(monitorSideSpeakerIds.length === 2 ? monitorSideSpeakerIds : [])
  if (monitorSideSpeakerIds.length === 2) {
    tierOf.set(monitorSideSpeakerIds[0], ROW_TIER.display)
    tierOf.set(monitorSideSpeakerIds[1], ROW_TIER.display)
    bandOf.set(monitorSideSpeakerIds[0], 0)
    bandOf.set(monitorSideSpeakerIds[1], 2)
  }

  // 関連する操作ガジェットは同じ行・帯へまとめ、カテゴリ順の安定した並びのまま隣接させる。
  const monitorAnchors = layoutIds.filter((id) => gadgetOfNode(id).category === 'Monitor')
  const monitorAnchor = monitorAnchors[0]
  const monitorBand = monitorAnchor ? bandOf.get(monitorAnchor)! : 1
  const gameRowCategories: GadgetCategory[] = ['GameConsole', 'Controller', 'Mixer', 'AudioInterface', 'SmartHome']
  for (const id of layoutIds) {
    const category = gadgetOfNode(id).category
    if (monitorAnchor && category === 'Light') {
        tierOf.set(id, ROW_TIER.camera)
        bandOf.set(id, monitorBand)
    }
    if (gameRowCategories.includes(category)) {
      tierOf.set(id, ROW_TIER.game)
      bandOf.set(id, monitorBand)
    }
  }
  const keyboardAnchors = layoutIds.filter((id) => gadgetOfNode(id).category === 'Keyboard')
  if (keyboardAnchors.length > 0) {
    const keyboardTier = tierOf.get(keyboardAnchors[0])!
    const keyboardBand = 1
    for (const id of layoutIds) {
      const category = gadgetOfNode(id).category
      if (category !== 'Keyboard' && category !== 'Mouse') continue
      tierOf.set(id, keyboardTier)
      bandOf.set(id, keyboardBand)
    }
    // イヤホン・ヘッドホンはキーボードと同じ行の左側にまとめる
    for (const id of layoutIds) {
      const category = gadgetOfNode(id).category
      if (category !== 'Headphone' && category !== 'Earphone') continue
      tierOf.set(id, keyboardTier)
      bandOf.set(id, 0)
    }
  }

  // ── ④ 配線が1本も伸びていないガジェットは、コンセントと同じ行にまとめて並べる ──
  // カテゴリ既定の行に置くと、線の繋がっていないガジェットが配線図の各所に散らばって
  // 「どこにも繋がっていない」ことが読み取りづらくなるため、末尾の行に集める。
  // （コンセントが登場しない構成でも、この行は常に一番下になる）
  for (const id of layoutIds) {
    if (POWER_SOURCE_IDS.has(id)) continue
    // 左右ペアは実配線を L 側だけに集約しているため、R 側の次数は常に 0 になる。
    // 未接続扱いでコンセント行へ落とさず、③で決めた左右共通の行を維持する。
    const category = gadgetOfNode(id).category
    const staysNearRelatedDevice =
      (category === 'GameConsole' && monitorAnchor != null) ||
      (category === 'Light' && monitorAnchor != null) ||
      ((category === 'Keyboard' || category === 'Mouse' || category === 'Headphone' || category === 'Earphone') && keyboardAnchors.length > 0) ||
      gameRowCategories.includes(category) ||
      category === 'PC'
    if (splitHalf.has(id) || subwooferNodes.has(id) || monitorSideSpeakers.has(id) || staysNearRelatedDevice) continue
    if ((degree.get(id) ?? 0) > 0) continue
    tierOf.set(id, ROW_TIER.wall)
    bandOf.set(id, 1)
  }

  // 注：以前は「ワイヤレス充電中のモバイルガジェットを Charger の行へ寄せる」処理があったが、
  // ワイヤレス充電を設定しただけでスマホが充電器の列へ移動し、そこから配置全体が
  // ずれる原因になっていたため撤廃した。モバイルガジェットは常にカテゴリ既定の行に置く。

  const adjacentRank = (category: GadgetCategory) => {
    if (category === 'Keyboard' || category === 'GameConsole') return 0
    if (category === 'Mouse' || category === 'Controller') return 1
    if (category === 'Mixer') return 2
    if (category === 'SmartHome') return 3
    // 充電器は電源タップの隣に置く。同じ段でも間に PC などが挟まると、充電器の給電線が
    // 段を横断して長くなる。段の先頭でこの2つを隣り合わせる（段が分割されても、
    // 元の段に残る先頭のかたまりは3台以上あるので必ず同じ段に収まる）。
    // 末尾ではなく先頭に置くのは、PC を段の外側へ追い出すと配線が伸びるため
    if (category === 'Charger') return 8
    if (category === 'PowerStrip') return 9
    return 10
  }
  const stableNodeSort = (a: string, b: string) => {
    const ga = gadgetOfNode(a), gb = gadgetOfNode(b)
    const rankDiff = adjacentRank(ga.category) - adjacentRank(gb.category)
    if (rankDiff !== 0) return rankDiff
    return ga.category === gb.category
      ? ga.name.localeCompare(gb.name) || a.localeCompare(b)
      : ga.category.localeCompare(gb.category)
  }

  // 1段が6台以上になったら、1段あたり5台までに収まる段数へ分け、台数を均等に振り分ける。
  //   6→3,3 / 7→4,3 / 8→4,4 / 9→5,4 / 10→5,5 / 11→4,4,3
  // 端数を最後の段に押し込むと「5台＋1台」のような不揃いな段ができ、1台だけの段が
  // 浮いて見えるため、段数を先に決めてから均等割りする。5台以下の段はそのまま1段。
  // 小数 tier を使うことで既存の役割順を変えず、隣接する段の間へ補助段を差し込む。
  const MAX_PER_ROW = 5
  const idsByTier = new Map<number, string[]>()
  for (const id of layoutIds) {
    const tier = tierOf.get(id)!
    const ids = idsByTier.get(tier) ?? []
    ids.push(id)
    idsByTier.set(tier, ids)
  }
  const occupiedTiers = new Set(idsByTier.keys())
  for (const [tier, ids] of idsByTier) {
    if (ids.length <= MAX_PER_ROW) continue
    const ordered = [...ids].sort(stableNodeSort)
    const rowCount = Math.ceil(ordered.length / MAX_PER_ROW)
    const base = Math.floor(ordered.length / rowCount)
    const extra = ordered.length % rowCount
    // 端数は前の段から1台ずつ配る（11台なら 4,4,3）。ただし充電器と電源タップは
    // 5台以内なら同じ段に残す。カテゴリ順で単純に切ると、3充電器＋1タップ＋PC2台が
    // 「充電器3台」「タップ＋PC2台」に分かれ、隣接させる後段の処理が届かなくなる。
    let rowSizes = Array.from({ length: rowCount }, (_, row) => base + (row < extra ? 1 : 0))
    const powerClusterSize = ordered.filter((id) => {
      const category = gadgetOfNode(id).category
      return category === 'Charger' || category === 'PowerStrip'
    }).length
    if (powerClusterSize > rowSizes[0] && powerClusterSize <= MAX_PER_ROW) {
      const remaining = ordered.length - powerClusterSize
      const remainingRows = rowCount - 1
      const remainingBase = Math.floor(remaining / remainingRows)
      const remainingExtra = remaining % remainingRows
      rowSizes = [
        powerClusterSize,
        ...Array.from({ length: remainingRows }, (_, row) => remainingBase + (row < remainingExtra ? 1 : 0)),
      ]
    }
    // 先頭の段は元の tier に残し、2段目以降を上下の空き段へ交互に置く
    let start = rowSizes[0]
    for (let row = 1; row < rowCount; row++) {
      const chunkIndex = row - 1
      const level = Math.floor(chunkIndex / 2) + 1
      const direction = chunkIndex % 2 === 0 ? -1 : 1
      let nextTier = tier + direction * level * 0.2
      while (occupiedTiers.has(nextTier)) nextTier += direction * 0.05
      occupiedTiers.add(nextTier)
      const size = rowSizes[row]
      for (const id of ordered.slice(start, start + size)) tierOf.set(id, nextTier)
      start += size
    }
  }

  // ── 電源タップの段：タップを挟んで左右へ振り分ける ──
  // PC の既定は右帯（rowBandOf）なので、タップの段は右にだけ伸び、中央帯にいるはずの
  // タップが図全体では左寄りに見えていた。置き場所を指定していないものを決定論的な順で
  // 右・左・右…と配ると、2台以上あるときタップを中心に左右の重さが揃う。
  // 条件を2つ付けている：タップが居ない段には効かせない（中央帯が空になって今度は
  // 真ん中が抜ける）。充電器も動かさない（adjacentRank が「タップの隣」に置いており、
  // 帯をまたぐと給電線が段を横断して伸びる）。段の分割で tier が変わったあとに見る。
  const idsByFinalTier = new Map<number, string[]>()
  for (const id of layoutIds) {
    const tier = tierOf.get(id)!
    const list = idsByFinalTier.get(tier) ?? []
    list.push(id)
    idsByFinalTier.set(tier, list)
  }
  for (const [, ids] of idsByFinalTier) {
    if (!ids.some((id) => gadgetOfNode(id).category === 'PowerStrip')) continue
    const movable = ids
      .filter((id) => {
        const category = gadgetOfNode(id).category
        return category !== 'PowerStrip' && category !== 'Charger' && !zoneOf.has(id)
      })
      .sort(stableNodeSort)
    movable.forEach((id, index) => bandOf.set(id, index % 2 === 0 ? 2 : 0))
  }

  const tierKeys = [...new Set([...tierOf.values()])].sort((a, b) => a - b)
  const rowOfTier = new Map<number, number>()
  tierKeys.forEach((tk, i) => rowOfTier.set(tk, i))

  // 充電器は同じ段の電源タップと同じ帯に入れる。帯の中の並びは adjacentRank が充電器→電源タップの
  // 順に隣り合わせるが、充電器は既定の置き場所（デスク右）で右の帯、電源タップは中央の帯に入るので、
  // 帯が分かれたままだと中央の帯の PC が間に挟まり、充電器だけ離れて置かれていた
  const stripIdsByTier = new Map<number, string[]>()
  for (const id of layoutIds) {
    if (gadgetOfNode(id).category !== 'PowerStrip') continue
    const tier = tierOf.get(id)!
    const ids = stripIdsByTier.get(tier) ?? []
    ids.push(id)
    stripIdsByTier.set(tier, ids)
  }
  for (const id of layoutIds) {
    if (gadgetOfNode(id).category !== 'Charger') continue
    // 配置画面やテンプレートで左右を指定したものは、その指定を優先する。
    if (zoneOf.has(id)) continue
    const tier = tierOf.get(id)!
    const stripIds = stripIdsByTier.get(tier) ?? []
    const connectedStripId = stripIds.find((stripId) => connections.some((connection) =>
      connection.cableType === 'Power' && (
        (connection.fromGadgetId === id && connection.toGadgetId === stripId) ||
        (connection.toGadgetId === id && connection.fromGadgetId === stripId)
      )))
    // 複数タップがあり接続先も確定していない場合、登録順の先頭へ寄せると配置が
    // 入力順に依存する。接続先が分かるか、同段にタップが1台だけのときだけ寄せる。
    const stripId = connectedStripId ?? (stripIds.length === 1 ? stripIds[0] : undefined)
    if (stripId) bandOf.set(id, bandOf.get(stripId)!)
  }

  // ── ④ グループ化：行×帯のバケツにまとめる（同じ帯＝同じ機能エリア）──
  const bandGroups = new Map<number, [string[], string[], string[]]>()
  for (const id of layoutIds) {
    const rowIdx = rowOfTier.get(tierOf.get(id)!)!
    if (!bandGroups.has(rowIdx)) bandGroups.set(rowIdx, [[], [], []])
    bandGroups.get(rowIdx)![bandOf.get(id)!].push(id)
  }
  for (const [, bands] of bandGroups) {
    for (const arr of bands) {
      arr.sort(stableNodeSort)
    }
  }

  // 置き場所を指定した充電器は上で電源タップの帯へ寄せないので、タップの隣の帯に残る
  // （テンプレート・構成から作ると充電器は「デスク右」、タップは「デスク下」が自動で入る）。
  // 帯の中の並びだけで隣り合わせる：充電器のいる側の端へタップを寄せ、充電器はタップ側の端に置く。
  // タップが帯の先頭のままだと、同じ帯の PC などがタップと充電器の間に挟まっていた
  const isCategory = (category: GadgetCategory) => (id: string) => gadgetOfNode(id).category === category
  for (const [, bands] of bandGroups) {
    for (let s = 0; s < bands.length; s++) {
      const band = bands[s]
      if (!band.some(isCategory('PowerStrip'))) continue
      // 空の帯は幅を持たないので飛ばして、実際に隣に並ぶ帯を見る
      const neighborBand = (step: -1 | 1) => {
        for (let i = s + step; i >= 0 && i < bands.length; i += step) {
          if (bands[i].length > 0) return i
        }
        return -1
      }
      const right = neighborBand(1)
      const left = neighborBand(-1)
      const chargersRight = right >= 0 && bands[right].some(isCategory('Charger'))
      const chargersLeft = left >= 0 && bands[left].some(isCategory('Charger'))
      if (!chargersRight && !chargersLeft) continue
      const strips = band.filter(isCategory('PowerStrip'))
      const sameBandChargers = band.filter(isCategory('Charger'))
      const others = band.filter((id) => !strips.includes(id) && !sameBandChargers.includes(id))
      // 同じ帯の充電器はタップの内側に置き、隣の帯の充電器とでタップを挟む
      if (chargersRight) {
        bands[s] = [...others, ...sameBandChargers, ...strips]
        const neighbor = bands[right]
        bands[right] = [...neighbor.filter(isCategory('Charger')), ...neighbor.filter((id) => !isCategory('Charger')(id))]
      } else {
        bands[s] = [...strips, ...sameBandChargers, ...others]
        const neighbor = bands[left]
        bands[left] = [...neighbor.filter((id) => !isCategory('Charger')(id)), ...neighbor.filter(isCategory('Charger'))]
      }
    }
  }
  const rows = [...bandGroups.keys()].sort((a, b) => a - b)
  const groups = new Map<number, string[]>()
  for (const r of rows) {
    const [b0, b1, b2] = bandGroups.get(r)!
    groups.set(r, [...b0, ...b1, ...b2])
  }

  // 注：以前はここで barycenter スイープ（隣接ノードの位置に寄せて交差を減らす並べ替え）を
  // 行っていたが、並び順が「今どの配線が引かれているか」に依存するため、配線を1本消したり
  // 追加したりするだけで帯の中の順序が入れ替わり、関係のないガジェットまで動いてしまっていた。
  // 位置の安定性を優先し、並び順は「カテゴリ → 名前」の決定的な順序（上の sort）だけで決める。

  // 高次数ノードから出る配線は4辺へ分散する。各辺の最大束幅を先に見積もり、
  // レーン分割後の線が隣のノードへ当たって差し戻されないだけの通路を配置時点で確保する。
  const maxDegree = Math.max(0, ...layoutIds.map((id) => degree.get(id) ?? 0))
  const densityGap = edgesRaw.length >= 24 ? 50 : 0
  const bundleGap = Math.max(18 + Math.max(0, Math.ceil(maxDegree / 4) - 1) * 12, densityGap)
  const colGap = Math.max(centerPrimaryDevices ? TEMPLATE_COL_GAP : COL_GAP, bundleGap)
  const rowGap = Math.max(centerPrimaryDevices ? TEMPLATE_ROW_GAP : ROW_GAP, bundleGap)

  // ── 行間コリドーの必要幅 ──
  // 行の隙間を通る配線は、レーン幅(LANE_PITCH)ずつ横並びにしないと1本に重なって見える。
  // 何本が通るかは接続関係から先に分かるので、足りない行だけ広げる。
  // 一律に広げると小さな構成まで間延びし、狭いまま固定だと大きな構成で配線が重なる。
  const tierIndexOf = new Map(tierKeys.map((t, i) => [t, i]))
  const rowCrossings = new Array(Math.max(0, tierKeys.length - 1)).fill(0)
  for (const e of edgesRaw) {
    const from = tierIndexOf.get(tierOf.get(e.fromGadgetId) ?? NaN)
    const to = tierIndexOf.get(tierOf.get(e.toGadgetId) ?? NaN)
    if (from === undefined || to === undefined) continue
    for (let k = Math.min(from, to); k < Math.max(from, to); k++) rowCrossings[k]++
  }
  // 上限は基準値の2倍。これ以上広げても図全体が間延びするだけで、
  // 残りはレーン分割・重なり補修に任せる。
  const rowGapAt = (index: number) => clamp(
    NODE_CLEARANCE * 2 + Math.max(0, (rowCrossings[index] ?? 0) - 1) * LANE_PITCH,
    rowGap,
    rowGap * 2,
  )

  // 行幅（帯単位・可変幅）
  const rowWidth = (ids: string[]) => ids.reduce((s, id) => s + nodeW(id), 0) + Math.max(0, ids.length - 1) * colGap
  const bandsOfTier = (t: number) => bandGroups.get(rowOfTier.get(t)!) ?? ([[], [], []] as [string[], string[], string[]])

  // ── 帯レイアウト：全行共通の中心線を保ちつつ、各行は実際の帯幅で詰める ──
  const hasSideBands = tierKeys.some((t) => {
    const [left, , right] = bandsOfTier(t)
    return left.length > 0 || right.length > 0
  })
  // 左右帯との間は1レーン分だけ確保する。以前は2レーン分を常に空けていたため、
  // ノートPCのような中央主体の構成で、隣接するガジェットまで不自然に離れていた。
  const sideGap = hasSideBands ? Math.max(colGap, 32) : 0
  const bandMetrics = (t: number) => {
    const [left, center, right] = bandsOfTier(t)
    const leftW = rowWidth(left)
    const centerW = rowWidth(center)
    const rightW = rowWidth(right)
    const leftGap = left.length > 0 && (center.length > 0 || right.length > 0) ? sideGap : 0
    const rightGap = right.length > 0 && (center.length > 0 || left.length > 0) ? sideGap : 0
    return {
      leftW,
      centerW,
      rightW,
      leftGap,
      rightGap,
      leftExtent: centerW / 2 + leftGap + leftW,
      rightExtent: centerW / 2 + rightGap + rightW,
    }
  }
  const maxLeftExtent = Math.max(0, ...tierKeys.map((t) => bandMetrics(t).leftExtent))
  const maxRightExtent = Math.max(0, ...tierKeys.map((t) => bandMetrics(t).rightExtent))
  const centerAxisX = PAD + maxLeftExtent

  const nodes: MapNode[] = []

  // 行の高さは「その行で最も背の高いノード」に合わせ、各ノードは行内で垂直センタリング。
  // カテゴリごとに縦横比が異なるため、固定行高ではなく積み上げで y を決める。
  let rowY = PAD
  tierKeys.forEach((t, tierIndex) => {
    const [b0, b1, b2] = bandsOfTier(t)
    const { leftW, centerW, leftGap, rightGap } = bandMetrics(t)
    const rowIds = [...b0, ...b1, ...b2]
    const maxH = Math.max(...rowIds.map(nodeH))
    const place = (ids: string[], startX: number) => {
      let cursor = startX
      for (const id of ids) {
        const w1 = nodeW(id), h1 = nodeH(id)
        const y = rowY + (maxH - h1) / 2
        nodes.push({
          id, gadget: gadgetOfNode(id), tier: t,
          x: cursor, y, w: w1, h: h1,
          cx: cursor + w1 / 2, cy: y + h1 / 2,
          isWall: id === WALL_ID,
          powerSource: id === SOLAR_ID ? 'solar' : id === BATTERY_ID ? 'battery' : undefined,
          isDecor: id === DECOR_ID,
          sideLabel: splitHalf.get(id),
          isSubwoofer: subwooferNodes.has(id),
          attached: attachedByHost.get(id),
        })
        cursor += w1 + colGap
      }
    }
    place(b0, centerAxisX - centerW / 2 - leftGap - leftW)
    place(b1, centerAxisX - centerW / 2)
    place(b2, centerAxisX + centerW / 2 + rightGap)
    rowY += maxH + rowGapAt(tierIndex)
  })
  const nodeById = new Map(nodes.map((n) => [n.id, n]))

  // ── split デバイスの左右を結ぶ配線（表示・ルーティング専用）──
  const pairLinkConns: MapConnection[] = []
  for (const g of baseGadgets) {
    if (isSplit(g)) {
      const L = nodeById.get(g.id + '__L'), R = nodeById.get(g.id + '__R')
      if (L && R) {
        pairLinkConns.push({
          id: `pair-${g.id}`,
          fromGadgetId: L.id,
          toGadgetId: R.id,
          cableType: g.category === 'Keyboard' ? 'USB_C' : 'Audio3_5mm',
          origin: 'auto',
          confirmed: true,
        })
      }
    }
    if (g.category === 'Speaker' && g.hasSubwoofer) {
      const speakerId = isSplit(g) ? g.id + `__${g.speakerInputSide ?? 'R'}` : g.id
      const subwooferId = subwooferNodeOf.get(g.id)
      if (nodeById.has(speakerId) && subwooferId && nodeById.has(subwooferId)) {
        // 製品固有の端子までは設定させないため、実配線と誤認しない補助線で関係だけ示す
        pairLinkConns.push({
          id: `pair-subwoofer-${g.id}`,
          fromGadgetId: speakerId,
          toGadgetId: subwooferId,
          cableType: 'RCA',
          origin: 'auto',
          confirmed: true,
        })
      }
    }
  }
  // 幻影（phantom-*）はノードの大きさ・位置の安定化専用：次数・隣接・配置計算には
  // 反映済みだが、描画されないため経路計算（ファンアウト・A*・交差補修・レーン分割）からは
  // 除外してコストを掛けない。
  const routableEdges: MapConnection[] = [
    ...edgesRaw.filter((c) => !c.id.startsWith('phantom-')),
    ...pairLinkConns,
  ]

  // ── 単独ノードを接続先の重心 x に寄せる（帯の境界内でのみ調整・接続関係の微調整）──
  for (let pass = 0; pass < 4; pass++) {
    for (const n of nodes) {
      const bands = bandsOfTier(n.tier)
      const band = bandOf.get(n.id) ?? 1
      const bandIds = bands[band]
      if (bandIds.length > 1) continue
      const nbs = (neighbors.get(n.id) ?? []).map((id) => nodeById.get(id)).filter(Boolean) as MapNode[]
      if (nbs.length === 0) continue
      const baryX = nbs.reduce((s, nb) => s + nb.cx, 0) / nbs.length
      const { leftW, centerW, rightW, leftGap, rightGap } = bandMetrics(n.tier)
      const lo = band === 0
        ? centerAxisX - centerW / 2 - leftGap - leftW
        : band === 1
          ? centerAxisX - centerW / 2
          : centerAxisX + centerW / 2 + rightGap
      const hi = band === 0
        ? centerAxisX - centerW / 2 - leftGap
        : band === 1
          ? centerAxisX + centerW / 2
          : centerAxisX + centerW / 2 + rightGap + rightW
      n.x = clamp(baryX - n.w / 2, lo, Math.max(lo, hi - n.w))
      n.cx = n.x + n.w / 2
    }
  }

  // 主役となる1台目のモニターとノートPCを中央軸へ置く。
  // 同じ行のガジェットが重なる場合は、主役を動かさず左右へ詰め直す。
  const centerPrimaryNode = (nodeId?: string) => {
    if (!nodeId) return
    const primary = nodeById.get(nodeId)
    if (!primary) return
    primary.x = centerAxisX - primary.w / 2
    primary.cx = centerAxisX
    const peers = nodes.filter((node) => node.id !== primary.id && node.tier === primary.tier)
    const collides = peers.some((node) =>
      primary.x < node.x + node.w + 8 && primary.x + primary.w > node.x - 8)
    if (!collides) return
    const left = peers.filter((node) => node.cx < centerAxisX).sort((a, b) => a.x - b.x)
    const right = peers.filter((node) => node.cx >= centerAxisX).sort((a, b) => a.x - b.x)
    let leftCursor = primary.x - colGap
    for (let i = left.length - 1; i >= 0; i--) {
      left[i].x = leftCursor - left[i].w
      left[i].cx = left[i].x + left[i].w / 2
      leftCursor = left[i].x - colGap
    }
    let rightCursor = primary.x + primary.w + colGap
    for (const node of right) {
      node.x = rightCursor
      node.cx = node.x + node.w / 2
      rightCursor = node.x + node.w + colGap
    }
  }
  if (centerPrimaryDevices) {
    centerPrimaryNode(monitorAnchor)
    centerPrimaryNode(layoutIds.find((id) => {
      const gadget = gadgetOfNode(id)
      return gadget.category === 'PC' && gadget.pcFormFactor === 'laptop'
    }))
  }

  // ライトとゲーム機は、モニター群の中心に対して真上・真下へ揃える。
  // 複数台ある場合は重ねず、グループ全体をモニター群の中央へ寄せる。
  const monitorNodes = nodes.filter((n) => n.gadget.category === 'Monitor')
  if (monitorNodes.length > 0) {
    const monitorCenterX = monitorNodes.reduce((sum, n) => sum + n.cx, 0) / monitorNodes.length
    const centerGroup = (group: MapNode[]) => {
      if (group.length === 0) return
      const totalW = group.reduce((sum, n) => sum + n.w, 0) + Math.max(0, group.length - 1) * colGap
      const sorted = [...group].sort((a, b) => a.x - b.x)
      let cursor = monitorCenterX - totalW / 2
      const targetX = sorted.map((n) => { const x = cursor; cursor += n.w + colGap; return x })
      // 中央寄せで同じ行の他ノード（Webカメラ等）と重なるなら行わない。
      // ノード同士が重なると、そこへ入る配線もノードを貫通して見えてしまう。
      const groupIds = new Set(sorted.map((n) => n.id))
      const collides = sorted.some((n, i) => nodes.some((o) =>
        !groupIds.has(o.id) && o.tier === n.tier &&
        targetX[i] < o.x + o.w + 8 && targetX[i] + n.w > o.x - 8))
      if (collides) return
      sorted.forEach((n, i) => {
        n.x = targetX[i]
        n.cx = n.x + n.w / 2
      })
    }
    const centerEachTier = (group: MapNode[]) => {
      const groups = new Map<number, MapNode[]>()
      for (const node of group) groups.set(node.tier, [...(groups.get(node.tier) ?? []), node])
      for (const tierGroup of groups.values()) centerGroup(tierGroup)
    }
    centerEachTier(nodes.filter((n) => n.gadget.category === 'Light'))
    centerEachTier(nodes.filter((n) => gameRowCategories.includes(n.gadget.category)))

    // 1台目のライトは、モニター群の中央ではなく1台目のモニターの真上へ固定する。
    const primaryMonitor = nodeById.get(monitorAnchor)
    const primaryLightId = layoutIds.find((id) => gadgetOfNode(id).category === 'Light')
    const primaryLight = primaryLightId ? nodeById.get(primaryLightId) : undefined
    if (primaryMonitor && primaryLight) {
      primaryLight.x = primaryMonitor.cx - primaryLight.w / 2
      primaryLight.cx = primaryMonitor.cx

      const sameTier = nodes.filter((n) => n.id !== primaryLight.id && n.tier === primaryLight.tier)
      const collides = sameTier.some((n) =>
        primaryLight.x < n.x + n.w + 8 && primaryLight.x + primaryLight.w > n.x - 8)
      if (collides) {
        const left = sameTier.filter((n) => n.cx < primaryLight.cx).sort((a, b) => a.x - b.x)
        const right = sameTier.filter((n) => n.cx >= primaryLight.cx).sort((a, b) => a.x - b.x)
        let leftCursor = primaryLight.x - colGap
        for (let i = left.length - 1; i >= 0; i--) {
          left[i].x = leftCursor - left[i].w
          left[i].cx = left[i].x + left[i].w / 2
          leftCursor = left[i].x - colGap
        }
        let rightCursor = primaryLight.x + primaryLight.w + colGap
        for (const node of right) {
          node.x = rightCursor
          node.cx = node.x + node.w / 2
          rightCursor = node.x + node.w + colGap
        }
      }
    }
  }

  // ── 自動配置の仕上げ（コンセントの整列・補助ノードの重なり回避）──
  // ユーザーの手動微調整（ドラッグ）はこのあと最後にまとめて足す。
  // 順番が逆だと「手で動かしたノードは仕上げの対象外」になり、画面に見えている
  // 位置（＝仕上げ済み）と、動かした後に計算される位置（＝仕上げ前＋差分）が
  // 食い違う。動かした瞬間にノードが別の場所へ跳ぶのはこれが原因だった。

  // 電源タップを図の中心へ寄せる。タップは中央帯に置いているが、左右の帯の張り出しは
  // 段ごとに違うため、図全体で見ると中心から外れて見えていた（デモのゲーミングデスクで
  // 100px ほど左）。タップの段だけをまとめて平行移動し、他の段が占める範囲の中心へ
  // タップの中心を合わせる。動かす量は図の幅を広げない範囲に収めるので、寄せても
  // 縮小表示にならない（左右対称の余白を足して中心を作る方式だと、狭い側に大きな空白が
  // できて図が一回り小さくなる）。コンセントはこの直後にタップへ揃えるので追従する。
  {
    const stripNode = nodes.find((n) => !n.isWall && gadgetOfNode(n.id).category === 'PowerStrip')
    const wallTier = nodeById.get(WALL_ID)?.tier
    if (stripNode) {
      const rowNodes = nodes.filter((n) => n.tier === stripNode.tier)
      const others = nodes.filter((n) => n.tier !== stripNode.tier && n.tier !== wallTier)
      if (others.length > 0) {
        const othersMinX = Math.min(...others.map((n) => n.x))
        const othersMaxX = Math.max(...others.map((n) => n.x + n.w))
        const rowMinX = Math.min(...rowNodes.map((n) => n.x))
        const rowMaxX = Math.max(...rowNodes.map((n) => n.x + n.w))
        // タップの段が図の左右端を作っていることがあるので、動かすと中心そのものが動く。
        // 一度で合わせようとすると行き過ぎる（DTM のデモで、寄せたつもりが逆に離れた）。
        // 移動量 → 新しい中心 → 差、を数回まわして釣り合う点を探す。差が縮む向きの
        // 反復なので数回で収まる
        const lo = Math.min(0, othersMinX - rowMinX)
        const hi = Math.max(0, othersMaxX - rowMaxX)
        let shift = 0
        for (let i = 0; i < 4; i++) {
          const minX = Math.min(othersMinX, rowMinX + shift)
          const maxX = Math.max(othersMaxX, rowMaxX + shift)
          const delta = (minX + maxX) / 2 - (stripNode.cx + shift)
          if (Math.abs(delta) < 0.5) break
          shift = clamp(shift + delta, lo, hi)
        }
        if (Math.abs(shift) > 0.5) {
          for (const node of rowNodes) {
            node.x += shift
            node.cx += shift
          }
        }
      }
    }
  }

  // コンセントを電源タップの直下へ揃え、同じ最下段の未接続ノードは左右交互に置く。
  if (usesWall) {
    const wallNode = nodeById.get(WALL_ID)
    const stripId = (neighbors.get(WALL_ID) ?? [])
      .find((id) => gadgetOfNode(id).category === 'PowerStrip')
    const stripNode = stripId ? nodeById.get(stripId) : undefined
    if (wallNode && stripNode) {
      wallNode.x = stripNode.cx - wallNode.w / 2
      wallNode.cx = stripNode.cx

      // 天板・チェアは配線を持っていても左右へ振り分ける。この行に居座らせると
      // 電源タップ → コンセントの幹線がその上を通り、ノードを貫通して見える
      const peers = nodes
        .filter((node) =>
          node.id !== WALL_ID &&
          node.tier === wallNode.tier &&
          ((degree.get(node.id) ?? 0) === 0 || isFoundationRow(gadgetOfNode(node.id).category)))
        .sort((a, b) => {
          // 天板はコンセントの左、後から追加されるチェアは右へ置く。
          // 名前順では Chair が Desk より先になり、チェア追加時に天板が左から右へ
          // 大移動していた。土台カテゴリの左右を固定して既存配置を維持する。
          const foundationRank = (node: MapNode) => {
            const category = gadgetOfNode(node.id).category
            return category === 'Desk' ? 0 : category === 'Chair' ? 1 : 2
          }
          return foundationRank(a) - foundationRank(b) || stableNodeSort(a.id, b.id)
        })
      let leftCursor = wallNode.x - colGap
      let rightCursor = wallNode.x + wallNode.w + colGap
      peers.forEach((node, index) => {
        if (index % 2 === 0) {
          node.x = leftCursor - node.w
          leftCursor = node.x - colGap
        } else {
          node.x = rightCursor
          rightCursor = node.x + node.w + colGap
        }
        node.cx = node.x + node.w / 2
      })
    }
  }

  // wall は上で電源タップ直下へ後移動するため、先に配置済みの電源ソースと重なることがある。
  // 補助ノードだけ同じ行の空きへ送る。
  for (const id of [SOLAR_ID, BATTERY_ID, DECOR_ID]) {
    const node = nodeById.get(id)
    if (!node) continue
    let overlaps = nodes.filter((other) =>
      other.id !== id &&
      node.y < other.y + other.h && node.y + node.h > other.y &&
      node.x < other.x + other.w && node.x + node.w > other.x)
    while (overlaps.length > 0) {
      node.x = Math.max(...overlaps.map((other) => other.x + other.w)) + colGap
      node.cx = node.x + node.w / 2
      overlaps = nodes.filter((other) =>
        other.id !== id &&
        node.y < other.y + other.h && node.y + node.h > other.y &&
        node.x < other.x + other.w && node.x + node.w > other.x)
    }
  }
  // ── ユーザーの手動微調整（ドラッグ）を反映。配線はこの位置を基準に引き直す ──
  // 自動配置の仕上げが全部済んだ後に足す。こうすると、画面に見えている位置に
  // ドラッグ量を足しただけの場所へ必ず落ちる（動かした瞬間に跳ねない）。
  //
  // 基準位置（bx/by）を持つものは、今の自動配置ではなくその基準に足す＝置いた場所に固定する。
  // 今の自動配置に足すと、ガジェットを足す・外すで基準が動くたびに、触っていないカードが
  // 置いた場所からずれていた（NodeOffset の注記）
  const pinnedIds = new Set<string>()
  for (const n of nodes) {
    n.baseX = n.x; n.baseY = n.y
    const off = nodeOffsets[n.id]
    if (!off) continue
    pinnedIds.add(n.id)
    n.x = (off.bx ?? n.x) + off.dx
    n.y = (off.by ?? n.y) + off.dy
    n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2
  }
  // 手で置いたカードは動かさず、自動配置のカードの方をよける。置いたカードは基準位置が
  // 動いても留まるので、あとから足したカードがその真上に自動配置されることがある。
  // 手で置いたカードどうしの重なりは本人が置いた結果なので触らない
  if (pinnedIds.size > 0) {
    const overlapping = (a: MapNode, b: MapNode) =>
      a.y < b.y + b.h && a.y + a.h > b.y && a.x < b.x + b.w && a.x + a.w > b.x
    const pinnedNodes = nodes.filter((n) => pinnedIds.has(n.id))
    const autoNodes = nodes.filter((n) => !pinnedIds.has(n.id)).sort((a, b) => a.x - b.x || stableNodeSort(a.id, b.id))
    for (const node of autoNodes) {
      if (!pinnedNodes.some((pinned) => overlapping(node, pinned))) continue
      // 右へ送るたびに少なくとも1枚ぶん進むので、ノード数を超えては回らない
      let hits = nodes.filter((other) => other !== node && overlapping(node, other))
      while (hits.length > 0) {
        node.x = Math.max(...hits.map((other) => other.x + other.w)) + colGap
        hits = nodes.filter((other) => other !== node && overlapping(node, other))
      }
      node.cx = node.x + node.w / 2
    }
  }

  // オフセットでキャンバス外（負座標）へ出た場合は全体を平行移動して収める
  {
    const minX = Math.min(...nodes.map((n) => n.x))
    const minY = Math.min(...nodes.map((n) => n.y))
    const shiftX = minX < PAD ? PAD - minX : 0
    const shiftY = minY < PAD ? PAD - minY : 0
    if (shiftX || shiftY) {
      for (const n of nodes) {
        n.x += shiftX; n.y += shiftY
        n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2
      }
    }
  }

  // ── ピクセル境界に整列 ──
  // 中央寄せ（÷2）やドラッグ量（÷ズーム倍率）で座標が小数になると、
  // 1px の枠線がサブピクセル描画でにじみ、太さが不均一・斜めに見える。
  // 全ノードの位置と寸法を整数に丸めてから配線を引く。
  for (const n of nodes) {
    n.x = Math.round(n.x); n.y = Math.round(n.y)
    n.w = Math.round(n.w); n.h = Math.round(n.h)
    n.cx = n.x + n.w / 2; n.cy = n.y + n.h / 2
  }

  // ── 辺の選択：4辺すべてを候補に、曲がり回数が最少になる組を選ぶ ──
  // ・x範囲が向かい合って重なる → 上下辺どうしの縦一直線（0曲がり）
  // ・y範囲が向かい合って重なる → 左右辺どうしの横一直線（0曲がり）
  // ・斜め配置 → 遠い軸の辺から出て相手の側面へ入るL字（1曲がり）
  //   （従来は「同じ行=左右・違う行=上下」に固定されており、斜めが必ずコの字=2曲がりだった）
  type Side = 'top' | 'bottom' | 'left' | 'right'
  const CP_SLIDE_MARGIN = 8
  const SIDE_OVL = CP_SLIDE_MARGIN * 2   // 両端の余白を確保したうえで直線を通せる最小幅
  // 接続点をノードの角から離す距離。隣り合う2辺の接続点は角をはさんで斜めに並ぶため、
  // 両辺とも角から m px だと間隔は m√2 にしかならない。同じ辺での最低間隔(MIN_CP_STEP=14)を
  // 角をまたぐ場合にも満たすよう 14/√2 ≒ 9.9 を上回る値にする（ケーシング幅11pxぶんの
  // 見かけの太さが角で1本に融合するのを防ぐ）。
  const CP_CORNER_MARGIN = 11
  const LIGHT_SIDE_OVL = 12
  const hasNodeBelowLight = (light: MapNode, other: MapNode) => nodes.some((n) =>
    n.id !== light.id &&
    n.id !== other.id &&
    n.cy > light.cy &&
    Math.min(light.x + light.w, n.x + n.w) - Math.max(light.x, n.x) >= LIGHT_SIDE_OVL,
  )
  const sidePairOf = (a: MapNode, b: MapNode): [Side, Side] => {
    // 接続データのfrom/toではなく画面上の位置順で評価し、逆向きの接続でも
    // 同じ物理的な辺と経路候補を選ぶ。
    const aFirst = a.cx < b.cx - 0.5 || (
      Math.abs(a.cx - b.cx) <= 0.5 && (
        a.cy < b.cy - 0.5 || (Math.abs(a.cy - b.cy) <= 0.5 && a.id <= b.id)
      )
    )
    if (!aFirst) {
      const [sb, sa] = sidePairOf(b, a)
      return [sa, sb]
    }
    const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
    const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    const dx = b.cx - a.cx, dy = b.cy - a.cy
    if (a.gadget.category === 'Light' && hasNodeBelowLight(a, b)) {
      return [dx >= 0 ? 'right' : 'left', dy >= 0 ? 'top' : 'bottom']
    }
    if (b.gadget.category === 'Light' && hasNodeBelowLight(b, a)) {
      return [dy >= 0 ? 'bottom' : 'top', dx <= 0 ? 'right' : 'left']
    }
    const canV = xOverlap >= SIDE_OVL && Math.abs(dy) > 1   // 縦一直線が可能
    const canH = yOverlap >= SIDE_OVL && Math.abs(dx) > 1   // 横一直線が可能
    if (canV && (!canH || Math.abs(dy) >= Math.abs(dx))) return dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']
    if (canH) return dx > 0 ? ['right', 'left'] : ['left', 'right']
    // 斜め：隙間が広い軸の辺から出発し、相手には横腹（近い側の辺）から入る。
    // 中心間距離で判定すると、電源タップのような横長ノードでは「ほぼ真上」にあるガジェットでも
    // 横方向が遠いと誤判定され、側面の端から相手の上面の端へ刺さるコの字になる。
    // 実際の辺どうしの隙間（重なりの符号反転）で判定すればノードの大きさに左右されない。
    const gapX = -xOverlap
    const gapY = -yOverlap
    if (gapY > gapX || (gapY === gapX && Math.abs(dy) >= Math.abs(dx))) {
      return [dy > 0 ? 'bottom' : 'top', dx > 0 ? 'left' : 'right']
    }
    return [dx > 0 ? 'right' : 'left', dy > 0 ? 'top' : 'bottom']
  }

  // ── 接続点のファンアウト ──
  const cp = new Map<string, { x: number; y: number }>() // edgeId@nodeId
  const incident = new Map<string, { eid: string; other: string; side: Side }[]>()
  for (const n of nodes) incident.set(n.id, [])
  const pairSides = new Map<string, [Side, Side]>()   // conn.id → [from側の辺, to側の辺]
  const edgeNodeIds = new Map<string, [string, string]>()
  routableEdges.forEach((c) => {
    const a = nodeById.get(c.fromGadgetId)!, b = nodeById.get(c.toGadgetId)!
    const [sa, sb] = sidePairOf(a, b)
    pairSides.set(c.id, [sa, sb])
    edgeNodeIds.set(c.id, [a.id, b.id])
    incident.get(a.id)!.push({ eid: c.id, other: b.id, side: sa })
    incident.get(b.id)!.push({ eid: c.id, other: a.id, side: sb })
  })
  // ── 2in1・3in1 ケーブルの枝（branchGroupId）──
  // 同じ物理ケーブルの枝は、分岐元ノードの同じ接続点から出して枝分かれに見せる。
  // 分岐元は「グループ内の全エッジが共有しているノード」から求める。fromGadgetId をそのまま
  // 使わないのは、L/R 分割ノードや電源ソースの擬似ノードで端点IDが読み替わるため。
  const branchTrunkNode = new Map<string, string>()   // branchGroupId → 分岐元ノードID
  const branchOfEdge = new Map<string, string>()      // edgeId → branchGroupId
  {
    const members = new Map<string, MapConnection[]>()
    for (const c of routableEdges) {
      if (!c.branchGroupId) continue
      const list = members.get(c.branchGroupId)
      if (list) list.push(c)
      else members.set(c.branchGroupId, [c])
    }
    for (const [groupId, list] of members) {
      if (list.length < 2) continue
      const shared = list.reduce<string[]>(
        (acc, c) => acc.filter((id) => edgeNodeIds.get(c.id)!.includes(id)),
        [...edgeNodeIds.get(list[0].id)!],
      )
      // 分岐元が一意に決まらない指定（枝どうしが2ノードとも共有／共有なし）は束ねない
      if (shared.length !== 1) continue
      branchTrunkNode.set(groupId, shared[0])
      for (const c of list) branchOfEdge.set(c.id, groupId)
    }
  }
  /** この辺がノード n で枝を束ねる対象なら branchGroupId を返す（分岐元ノード側だけ束ねる） */
  const branchKeyAt = (eid: string, nodeId: string): string | null => {
    const groupId = branchOfEdge.get(eid)
    return groupId !== undefined && branchTrunkNode.get(groupId) === nodeId ? groupId : null
  }
  // 接続点を共有するには、まず同じ辺から出ていなければならない。
  // 枝の行き先が四方に散っている場合は、行き先の重心に一番近い辺へ揃える。
  for (const [groupId, trunkId] of branchTrunkNode) {
    const trunk = nodeById.get(trunkId)
    if (!trunk) continue
    const entries = (incident.get(trunkId) ?? []).filter((e) => branchOfEdge.get(e.eid) === groupId)
    if (entries.length < 2) continue
    const targets = entries.map((e) => nodeById.get(e.other)!)
    const dx = targets.reduce((sum, t) => sum + t.cx, 0) / targets.length - trunk.cx
    const dy = targets.reduce((sum, t) => sum + t.cy, 0) / targets.length - trunk.cy
    const side: Side = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'bottom' : 'top')
    for (const e of entries) {
      e.side = side
      const [fromSide, toSide] = pairSides.get(e.eid)!
      const [fromId] = edgeNodeIds.get(e.eid)!
      pairSides.set(e.eid, fromId === trunkId ? [side, toSide] : [fromSide, side])
    }
  }

  // 大きな束は後段の経路探索に任せて同じ辺へ集中させず、4辺へ容量均等に配る。
  // 高次数側の辺を固定することで、配線ごとに16通りの辺組合せをA*探索する必要もなくなる。
  const balancedFanoutNodes = new Set<string>()
  for (const node of nodes) {
    const entries = incident.get(node.id) ?? []
    if (entries.length < 12) continue
    balancedFanoutNodes.add(node.id)
    const capacity = Math.ceil(entries.length / 4)
    const used = new Map<Side, number>([['top', 0], ['right', 0], ['bottom', 0], ['left', 0]])
    const sides: Side[] = ['top', 'right', 'bottom', 'left']
    const ordered = [...entries].sort((x, y) => {
      const a = nodeById.get(x.other)!, b = nodeById.get(y.other)!
      const angleA = Math.atan2(a.cy - node.cy, a.cx - node.cx)
      const angleB = Math.atan2(b.cy - node.cy, b.cx - node.cx)
      return angleA - angleB || x.eid.localeCompare(y.eid)
    })
    // 同じ物理ケーブルの枝は同じ接続点から出す約束なので、容量均等より先に辺を揃える
    const branchSide = new Map<string, Side>()
    for (const entry of ordered) {
      const other = nodeById.get(entry.other)!
      const dx = other.cx - node.cx, dy = other.cy - node.cy
      const distance = Math.max(1, Math.hypot(dx, dy))
      const alignment = (side: Side) => {
        const [nx, ny] = side === 'top' ? [0, -1] : side === 'right' ? [1, 0] : side === 'bottom' ? [0, 1] : [-1, 0]
        return -(nx * dx + ny * dy) / distance
      }
      const branchId = branchKeyAt(entry.eid, node.id)
      // 枝は既に行き先の重心へ向く辺で揃えてあるので、容量均等より先にその辺を尊重する
      const side = (branchId !== null ? branchSide.get(branchId) ?? entry.side : undefined) ?? sides
        .filter((candidate) => (used.get(candidate) ?? 0) < capacity)
        .sort((a, b) => alignment(a) - alignment(b) || (used.get(a) ?? 0) - (used.get(b) ?? 0) || a.localeCompare(b))[0]
      if (branchId !== null) branchSide.set(branchId, side)
      entry.side = side
      used.set(side, (used.get(side) ?? 0) + 1)
      const [fromSide, toSide] = pairSides.get(entry.eid)!
      const [fromId] = edgeNodeIds.get(entry.eid)!
      pairSides.set(entry.eid, fromId === node.id ? [side, toSide] : [fromSide, side])
    }
  }
  // 同じ辺から出る配線の開始位置は等間隔（最低 MIN_CP_STEP）を優先する。
  // ノード幅に収まらない場合はクランプで詰めず、ノードの外へ均等にはみ出させて
  // 間隔が狭くなりすぎる（≒視認性低下）方を避ける。
  const MIN_CP_STEP = 14   // 配線の実太さ5.5+ケーシング11に合わせて拡大
  const fanoutSlots = new Map<string, { keys: string[]; index: number; horizontal: boolean; side: Side }>()
  for (const n of nodes) {
    for (const side of ['top', 'bottom', 'left', 'right'] as Side[]) {
      const list = incident.get(n.id)!.filter((e) => e.side === side)
      if (list.length === 0) continue
      const horizontal = side === 'top' || side === 'bottom'
      list.sort((p, q) => {
        const op = nodeById.get(p.other)!, oq = nodeById.get(q.other)!
        return horizontal ? op.cx - oq.cx : op.cy - oq.cy
      })
      // 同じ物理ケーブルの枝（2in1・3in1）は1グループにまとめ、同じ接続点を共有させる。
      // 束ねるのは分岐元ノード側だけで、機器側の端点はそれぞれ別のまま。
      const groups: { key: string; members: typeof list }[] = []
      const groupIndex = new Map<string, number>()
      for (const e of list) {
        const branchId = branchKeyAt(e.eid, n.id)
        const merged = branchId !== null ? groupIndex.get(branchId) : undefined
        if (merged !== undefined) { groups[merged].members.push(e); continue }
        if (branchId !== null) groupIndex.set(branchId, groups.length)
        groups.push({ key: e.eid, members: [e] })
      }
      const k = groups.length
      const extent = (horizontal ? n.w : n.h) - CP_CORNER_MARGIN * 2
      // 接続本数が辺の収容力を超えても、接続点を枠外へ押し出さない。
      // 間隔より「端点が実際の辺上にあること」を優先し、必要な場合だけ14px未満へ詰める。
      const step = k > 1 ? Math.min(CP_STEP, extent / (k - 1)) : 0
      const keys = groups.map((g) => g.members[0].eid + '@' + n.id)
      const axisStart = horizontal ? n.x : n.y
      const axisEnd = horizontal ? n.x + n.w : n.y + n.h
      const axisCenter = horizontal ? n.cx : n.cy
      const span = (k - 1) * step
      let edgeLo = axisStart + CP_CORNER_MARGIN
      let edgeHi = axisEnd - CP_CORNER_MARGIN
      if (edgeHi - edgeLo < span) {
        edgeLo = axisCenter - span / 2
        edgeHi = axisCenter + span / 2
      }

      // x[i] - i*step を単調増加にする重み付きPAVA。
      // 直線候補は重みを大きくし、曲がる配線側を先に譲らせながら
      // 順序と最低間隔をO(k)で満たす。
      const zLo = edgeLo
      const zHi = edgeHi - span
      const desired = groups.map((g, i) => {
        const e = g.members[0]
        const other = nodeById.get(e.other)!
        const sides = pairSides.get(e.eid)!
        const ends = edgeNodeIds.get(e.eid)!
        const otherSide = ends[0] === n.id ? sides[1] : sides[0]
        const otherHorizontal = otherSide === 'top' || otherSide === 'bottom'
        const facing = horizontal === otherHorizontal && e.side !== otherSide
        const overlapLo = Math.max(axisStart, horizontal ? other.x : other.y) + CP_SLIDE_MARGIN
        const overlapHi = Math.min(axisEnd, horizontal ? other.x + other.w : other.y + other.h) - CP_SLIDE_MARGIN
        // 束ねた枝は行き先が複数あるので、代表の相手へ真っ直ぐ通す前提は置かない。
        // 接続点は枝の行き先の平均に置き、どの枝も同じくらい素直に伸ばせるようにする。
        const branched = g.members.length > 1
        const straight = !branched && facing && overlapLo <= overlapHi
        const otherCenter = branched
          ? g.members.reduce((sum, m) => {
              const target = nodeById.get(m.other)!
              return sum + (horizontal ? target.cx : target.cy)
            }, 0) / g.members.length
          : horizontal ? other.cx : other.cy
        const ideal = straight
          ? clamp((axisCenter + otherCenter) / 2, overlapLo, overlapHi)
          : k === 1
            ? axisCenter
          : clamp(otherCenter, edgeLo, edgeHi)
        return { z: clamp(ideal - i * step, zLo, zHi), weight: straight ? 1000 : 1 }
      })
      const blocks: { start: number; end: number; weight: number; sum: number; mean: number }[] = []
      desired.forEach((d, i) => {
        blocks.push({ start: i, end: i, weight: d.weight, sum: d.z * d.weight, mean: d.z })
        while (blocks.length >= 2 && blocks[blocks.length - 2].mean > blocks[blocks.length - 1].mean) {
          const right = blocks.pop()!
          const left = blocks.pop()!
          const weight = left.weight + right.weight
          const sum = left.sum + right.sum
          blocks.push({ start: left.start, end: right.end, weight, sum, mean: sum / weight })
        }
      })
      const coords = new Array<number>(k)
      blocks.forEach((block) => {
        for (let i = block.start; i <= block.end; i++) coords[i] = block.mean + i * step
      })
      groups.forEach((g, i) => {
        // 接続点も整数に丸める。PAVAの平均で 0.5px ずれた接続点が残ると、
        // グリッド座標との差ぶんだけ足の途中に 0.5px の段差（斜めの区間）ができる。
        const coord = Math.round(coords[i])
        const point = horizontal
          ? { x: coord, y: side === 'top' ? n.y : n.y + n.h }
          : { x: side === 'left' ? n.x : n.x + n.w, y: coord }
        for (const e of g.members) {
          const key = e.eid + '@' + n.id
          cp.set(key, { ...point })
          fanoutSlots.set(key, { keys, index: i, horizontal, side })
        }
      })
    }
  }

  // 隣の接続点との順序・最低間隔を保ったまま、辺に沿って動かせる範囲。
  // 現在の cp を参照するため、先に動かした配線との間隔も後続配線へ反映される。
  const cpSlideRange = (edgeId: string, n: MapNode, side: Side) => {
    const key = edgeId + '@' + n.id
    const slot = fanoutSlots.get(key)
    const horizontal = side === 'top' || side === 'bottom'
    const current = cp.get(key)
    const currentCoord = horizontal ? (current?.x ?? n.cx) : (current?.y ?? n.cy)
    let lo = (horizontal ? n.x : n.y) + CP_CORNER_MARGIN
    let hi = (horizontal ? n.x + n.w : n.y + n.h) - CP_CORNER_MARGIN
    if (slot && slot.side === side && slot.horizontal === horizontal) {
      const prev = slot.index > 0 ? cp.get(slot.keys[slot.index - 1]) : undefined
      const next = slot.index + 1 < slot.keys.length ? cp.get(slot.keys[slot.index + 1]) : undefined
      if (prev) lo = Math.max(lo, (horizontal ? prev.x : prev.y) + MIN_CP_STEP)
      if (next) hi = Math.min(hi, (horizontal ? next.x : next.y) - MIN_CP_STEP)
    }
    return lo <= hi ? { lo, hi } : { lo: currentCoord, hi: currentCoord }
  }

  // ── グリッド直交ルーティング（障害物回避）──
  // 回避の優先順位・交差との違い・経路が見つからない場合の例外は docs/wiring-routing-rules.md を参照。
  // 各配線をグリッド上でA*探索し、接続対象以外のノードを迂回する。
  // ・曲がり(BEND)にコスト → 直線優先／不要な折れを抑制
  // ・使用済みグリッド辺(REUSE)に高コスト → 重なり・長距離並走を回避
  // ・移動は上下左右のみ → 交差は直角(90°)だけになる
  const sideMap = new Map<string, Side>()
  routableEdges.forEach((c) => {
    const a = nodeById.get(c.fromGadgetId)!, b = nodeById.get(c.toGadgetId)!
    const [sa, sb] = pairSides.get(c.id)!
    sideMap.set(c.id + '@' + a.id, sa)
    sideMap.set(c.id + '@' + b.id, sb)
  })
  // 後段の候補選択・交差補修で接続点が動いても、ポートごとに確保した元の
  // ファンアウト位置へ戻せるよう保持する。
  const reservedFanoutCp = new Map([...cp].map(([key, point]) => [key, { ...point }]))

  const CLEAR = MAP_CLEAR
  const OUT = MAP_STUB_OUT
  const G = maxDegree >= 24 ? 24 : 16 // 大きな束では通路拡張による探索面積の増加を抑える
  // 外周も束の通路として使われる。固定2レーンでは高次数ノードの配線が同じ最外周へ
  // 集中するため、1辺へ割り当てる最大本数に合わせて探索領域を広げる。
  // 探索面積が二次的に増えるため4トラックを上限にする。残りは後段のレーン分割で展開する。
  const perimeterTracks = Math.min(3, Math.max(2, Math.ceil(maxDegree / 4) + 1))
  const gox = Math.min(...nodes.map((n) => n.x)) - G * perimeterTracks
  const goy = Math.min(...nodes.map((n) => n.y)) - G * perimeterTracks
  const gx1 = Math.max(...nodes.map((n) => n.x + n.w)) + G * perimeterTracks
  const gy1 = Math.max(...nodes.map((n) => n.y + n.h)) + G * perimeterTracks
  const cols = Math.max(2, Math.ceil((gx1 - gox) / G) + 1)
  const grows = Math.max(2, Math.ceil((gy1 - goy) / G) + 1)
  const cellX = (i: number) => gox + i * G
  const cellY = (j: number) => goy + j * G
  const gidx = (i: number, j: number) => i * grows + j
  const inB = (i: number, j: number) => i >= 0 && i < cols && j >= 0 && j < grows

  // 通過可能マス（ノード矩形＋余白を障害物とする）。
  // 全マス×全ノードの総当たりだと盤面が広がるほど費用が二次的に増えるので、
  // 「通れる」で埋めてから、各ノードが覆うマスの範囲だけを塗り潰す。
  // 判定式は総当たり版と同じ（cellX(i) = gox + i*G を範囲へ入れた i を求めているだけ）。
  const buildPassable = (clearance: number) => {
    const grid = new Uint8Array(cols * grows).fill(1)
    for (const n of nodes) {
      const i0 = Math.max(0, Math.ceil((n.x - clearance - gox) / G))
      const i1 = Math.min(cols - 1, Math.floor((n.x + n.w + clearance - gox) / G))
      const j0 = Math.max(0, Math.ceil((n.y - clearance - goy) / G))
      const j1 = Math.min(grows - 1, Math.floor((n.y + n.h + clearance - goy) / G))
      for (let i = i0; i <= i1; i++) {
        const base = i * grows
        for (let j = j0; j <= j1; j++) grid[base + j] = 0
      }
    }
    return grid
  }
  const passable = buildPassable(CLEAR)
  // 通常の余白では1本も経路が引けない配線のための予備グリッド。ノードの中は通さないまま
  // 余白だけ詰める。「線を描かない」＝接続が図から消えることの方が誤解を招くため、
  // 通路が無いときはこちらへ落として必ず描く。
  const RESCUE_CLEAR = 2
  let rescuePassable: Uint8Array | null = null
  const rescueGrid = () => (rescuePassable ??= buildPassable(RESCUE_CLEAR))

  const nearestCell = (x: number, y: number, grid: Uint8Array = passable): [number, number] => {
    const bi = clamp(Math.round((x - gox) / G), 0, cols - 1)
    const bj = clamp(Math.round((y - goy) / G), 0, grows - 1)
    if (grid[gidx(bi, bj)]) return [bi, bj]
    for (let r = 1; r < 6; r++)
      for (let di = -r; di <= r; di++)
        for (let dj = -r; dj <= r; dj++) {
          const i = bi + di, j = bj + dj
          if (inB(i, j) && grid[gidx(i, j)]) return [i, j]
        }
    return [bi, bj]
  }

  const cellCount = cols * grows
  // 隣接辺は小さいセル番号と軸で一意に決まる。探索中の数百万回のMap参照を避ける。
  const usedEdge = new Uint8Array(cellCount * 2)
  const nearCell = new Uint8Array(cellCount)
  const ekey = (a: number, b: number) => Math.min(a, b) * 2 + (Math.abs(a - b) === 1 ? 0 : 1)
  const REUSE = 60
  const NEAR_STEP = 12   // nearCell 強度1あたりのA*コスト（並走をグリッド3マス=36px 分離へ誘導）
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 2], [0, -1, 2]] // di,dj,dir(1=横,2=縦)

  // 曲がり1回を「配線長 BEND_UNIT px ぶん」に換算して距離と釣り合わせる。
  // 以前は曲がり回数を距離より無条件に優先していたため、曲がりが1回少ないだけの
  // 「図の外周をぐるりと回る経路」が、中を素直に通る経路に必ず勝っていた
  // （デモ構成では全配線長の半分が外周の大回りだった。外周は本数が集中するので、
  // 同じ色の線が細い間隔で何本も並走して1本に見える）。
  // n回目の曲がりを n*BEND_UNIT にして累進させることで、近道のための1〜2回の
  // 曲がりは許しつつ、階段状に折れ続ける経路は避ける。
  // グリッドの連結成分。通れるマスを1回だけ塗り分けておく。
  // ノードをドラッグで重ねると接続点が他ノードの内側に埋まり、そこからはどのマスへも
  // 出られない＝A*は heap を空にするまで探索して必ず失敗する。多段フォールバックが
  // その空振りを辺の組み合わせぶん繰り返すため、1枚の図で数十秒かかっていた。
  // 別成分と分かった時点で探索を省く（同じ成分なら探索内容は従来どおりなので結果は変わらない）。
  const componentCache = new WeakMap<Uint8Array, Int32Array>()
  const componentsOf = (grid: Uint8Array): Int32Array => {
    const cached = componentCache.get(grid)
    if (cached) return cached
    const comp = new Int32Array(cols * grows).fill(-1)
    const queue = new Int32Array(cols * grows)
    let label = 0
    for (let start = 0; start < comp.length; start++) {
      if (!grid[start] || comp[start] >= 0) continue
      let head = 0, tail = 0
      queue[tail++] = start
      comp[start] = label
      while (head < tail) {
        const cell = queue[head++]
        const ci = Math.floor(cell / grows), cj = cell % grows
        for (const [di, dj] of DIRS) {
          const ni = ci + di, nj = cj + dj
          if (!inB(ni, nj)) continue
          const next = gidx(ni, nj)
          if (!grid[next] || comp[next] >= 0) continue
          comp[next] = label
          queue[tail++] = next
        }
      }
      label++
    }
    componentCache.set(grid, comp)
    return comp
  }

  // 1本の配線を引いている間、盤面（usedEdge / nearCell）は変わらない。同じマスの組を
  // 同じ条件で探索すれば必ず同じ答えになるので、その間だけ結果を覚えておく。
  // 辺の組み合わせを総当たりする救済フェーズでは、接続点が数px違うだけで同じマスへ
  // 丸められた探索が何十回も繰り返されていた。経路が確定して盤面が変わる markUsed で捨てる。
  const searchIds = new WeakMap<object, number>()
  let nextSearchId = 1
  const searchIdOf = (o: object | undefined) => {
    if (!o) return 0
    let id = searchIds.get(o)
    if (id === undefined) { id = nextSearchId++; searchIds.set(o, id) }
    return id
  }
  const routeCache = new Map<string, [number, number][] | null>()

  // 1本の配線に使う探索量（A*が広げたマス）の上限。
  // 実データの構成を写真どおりに詰めた図でも1本あたり最大22万マスで収まる。これを超えるのは
  // ドラッグでノードを重ね、接続点が他ノードの内側に埋まって通路が塞がれた図だけで、
  // そこは探索を続けても通路が現れず、最後は逃げレーンで描くことになる。
  // 実用構成の2倍以上に取ってあるので、通常の図の見た目は変わらない。
  const EDGE_POP_BUDGET = 500_000
  let edgePops = 0

  const BEND_CAP = 6
  const BEND_UNIT = 64
  const AVOID = 80       // 再ルーティング時の回避コスト（通常）
  const AVOID_HIGH = 800 // 同一ガジェット起点の配線が交差しないよう強制（実質禁止）
  // routeCells の枝刈り（曲がりの多い状態を捨てる）は、n 回目の曲がりほど高いことを前提にしている。
  // 減っていく形に変えると、曲がりの多い側が後で追い抜けるようになり、最短を取りこぼす
  const BEND_COST = [0, ...Array.from({ length: BEND_CAP }, (_, i) => BEND_UNIT * (i + 1))]
  const STRIDE = BEND_CAP + 1   // dir付きセル状態ごとに曲がり回数(0..BEND_CAP)を持たせる
  // A* の作業領域。状態（マス×向き×曲がり回数）はマス数の21倍あり、探索のたびに Map と
  // キューの要素オブジェクトを作ると、その確保と参照が配線図の計算時間の大半を占めていた
  // （docs/perf/layout-benchmark.md）。盤面の大きさは変わらず、この計算内の探索は逐次実行するので、
  // 制御を返しても1組を使い回せる。探索ごとに searchStamp を進め、
  // 印が今回のものでない状態は「未訪問」として読む（配列を毎回埋め直さずに済む）。
  // 最初の探索まで確保しない（直線で引ける図では一度も使わない）
  const stateCount = cellCount * 3 * STRIDE
  let stateStamp: Uint32Array | null = null
  let stateDist: Float64Array | null = null
  let statePrev: Int32Array | null = null
  let searchStamp = 0
  // 優先度付きキュー。要素ごとのオブジェクトを作らないよう、推定総コスト・実コスト・状態を別々の配列で持つ。
  // 親子の比較順と同点の並びを保つ（同点の取り出し順が変わると経路が変わる）。
  const heapC: number[] = []
  const heapG: number[] = []
  const heapS: number[] = []
  // 回避領域ごとに盤面を残さず、逐次探索用の1枚だけを使い回す。
  let avoidMask: Uint8Array | undefined
  let maskedAvoidCells: Set<number> | undefined
  // sDir/tDir: 出発辺・到着辺の軸（1=横, 2=縦）。
  // 出発直後の曲がりに正しくコストが乗り、到着も到着辺の軸に沿った直進で終わるよう制約する。
  const routeCells = async (
    s: [number, number], t: [number, number], sDir: 1 | 2, tDir: 1 | 2,
    avoidCells?: Set<number>, avoidCost = AVOID, maxPops = 20000,
    grid: Uint8Array = passable,
  ): Promise<[number, number][] | null> => {
    const pause = pauseIfNeeded()
    if (pause) await pause
    const [si, sj] = s, [ti, tj] = t
    const startId = gidx(si, sj), goalId = gidx(ti, tj)
    const cacheKey = `${startId}|${goalId}|${sDir}|${tDir}|${searchIdOf(avoidCells)}|${avoidCost}|${maxPops}|${searchIdOf(grid)}`
    const cached = routeCache.get(cacheKey)
    if (cached !== undefined) return cached
    // 予算切れ。この配線はもう通路が無いものとして呼び出し側のフォールバックへ委ねる
    if (edgePops > EDGE_POP_BUDGET) return null
    // 到達できない組はここで打ち切る。ゴールが塞がれたマスなら進入そのものができず、
    // 出発点と成分が違えば通路が繋がっていない。どちらも A* の結論は「経路なし」で同じ。
    // 出発点自身は塞がれていても隣のマスへ出られるので、隣接4マスの成分も見る。
    if (startId !== goalId) {
      const comp = componentsOf(grid)
      const goalComp = comp[goalId]
      let reachable = goalComp >= 0 && comp[startId] === goalComp
      if (goalComp >= 0 && !reachable) {
        for (const [di, dj] of DIRS) {
          const ni = si + di, nj = sj + dj
          if (inB(ni, nj) && comp[gidx(ni, nj)] === goalComp) { reachable = true; break }
        }
      }
      if (!reachable) { routeCache.set(cacheKey, null); return null }
    }
    if (!stateStamp) {
      stateStamp = new Uint32Array(stateCount)
      stateDist = new Float64Array(stateCount)
      statePrev = new Int32Array(stateCount)
    }
    const stamp = ++searchStamp
    const seen = stateStamp, dist = stateDist!, prev = statePrev!
    if (avoidCells && maskedAvoidCells !== avoidCells) {
      if (!avoidMask) avoidMask = new Uint8Array(cellCount)
      else avoidMask.fill(0)
      for (const cell of avoidCells) avoidMask[cell] = 1
      maskedAvoidCells = avoidCells
    }
    const avoid = avoidCells ? avoidMask : undefined
    heapC.length = 0; heapG.length = 0; heapS.length = 0
    const push = (st: number, g: number, c: number) => {
      let k = heapC.length
      while (k > 0) {
        const p = (k - 1) >> 1
        if (heapC[p] <= c) break
        heapC[k] = heapC[p]; heapG[k] = heapG[p]; heapS[k] = heapS[p]
        k = p
      }
      heapC[k] = c; heapG[k] = g; heapS[k] = st
    }
    // 取り出した要素の実コストはここへ置く（戻り値を組にするとオブジェクトが要る）
    let poppedG = 0
    const pop = () => {
      const topS = heapS[0]
      poppedG = heapG[0]
      const lastC = heapC.pop()!, lastG = heapG.pop()!, lastS = heapS.pop()!
      const n = heapC.length
      if (n) {
        let k = 0
        for (;;) {
          const l = 2 * k + 1, r = l + 1
          if (l >= n) break
          const m = r < n && heapC[r] < heapC[l] ? r : l
          if (heapC[m] >= lastC) break
          heapC[k] = heapC[m]; heapG[k] = heapG[m]; heapS[k] = heapS[m]
          k = m
        }
        heapC[k] = lastC; heapG[k] = lastG; heapS[k] = lastS
      }
      return topS
    }
    const hf = (i: number, j: number) => (Math.abs(i - ti) + Math.abs(j - tj)) * G
    // 出発方向を初期状態に与える：最初の一歩から曲がりコストが乗り、
    // 「出発直後にタダで曲がる」経路が選ばれなくなる
    const s0 = (startId * 3 + sDir) * STRIDE
    seen[s0] = stamp; dist[s0] = 0; prev[s0] = -1; push(s0, 0, hf(si, sj))
    let found = -1
    let fallback = -1   // 到着方向が合わない到達（他に経路がない場合のみ採用）
    // 探索上限：異常に入り組んだケースで数秒単位の探索が起きないようにする。
    // 上限到達時は経路なしとして簡易フォールバック（呼び出し側）に任せる。
    let pops = 0
    while (heapC.length) {
      if (++pops > maxPops) break
      if ((pops & 127) === 0) {
        const pause = pauseIfNeeded()
        if (pause) await pause
      }
      const st = pop()
      const g = poppedG
      if (g !== dist[st]) continue   // 期限切れエントリ（キューに入った状態は必ず今回の印を持つ）
      const bends = st % STRIDE
      const cellDir = Math.floor(st / STRIDE)
      const cell = Math.floor(cellDir / 3), dir = cellDir % 3
      // キュー投入後に、同じマス・向きへ安く少ない曲がりで到達した状態も捨てる。
      // 投入時だけの枝刈りでは、後から優越された候補の隣接マスまで展開してしまう。
      const base = cellDir * STRIDE
      let dominated = false
      for (let b = 0; b < bends; b++) {
        if (seen[base + b] === stamp && dist[base + b] <= g) { dominated = true; break }
      }
      if (dominated) continue
      if (cell === goalId) {
        // 到着辺の軸に沿って進入した場合のみ確定 → 到着直前の曲がりを排除
        if (dir === tDir) { found = st; break }
        if (fallback < 0) fallback = st
        continue
      }
      const ci = Math.floor(cell / grows), cj = cell % grows
      for (const [di, dj, nd] of DIRS) {
        const ni = ci + di, nj = cj + dj
        if (!inB(ni, nj) || !grid[gidx(ni, nj)]) continue
        const ncell = gidx(ni, nj)
        const isTurn = dir !== 0 && dir !== nd
        const nbends = isTurn ? Math.min(bends + 1, BEND_CAP) : bends
        let step = G
        if (isTurn) step += BEND_COST[nbends]
        if (usedEdge[ekey(cell, ncell)]) step += REUSE
        if (avoid?.[ncell]) step += avoidCost
        step += nearCell[ncell] * NEAR_STEP
        const base = (ncell * 3 + nd) * STRIDE
        const nst = base + nbends
        const ng = g + step
        // 同じマス・同じ向きに、曲がりが同じか少なく、コストも同じか安い状態が既にあれば、
        // この状態から先は必ずそれ以上にかかる（n回目の曲がりほど高いので、曲がりの多い側が
        // 追い抜くことはない）。探さずに捨てる。状態を曲がり回数ごとに分けたぶん（7倍）
        // 同じマスを何度も探していたのが、探索量の大半だった（docs/perf/layout-benchmark.md）
        let dominated = false
        for (let b = 0; b <= nbends; b++) {
          if (seen[base + b] === stamp && dist[base + b] <= ng) { dominated = true; break }
        }
        if (!dominated) {
          seen[nst] = stamp; dist[nst] = ng; prev[nst] = st; push(nst, ng, ng + hf(ni, nj))
        }
      }
    }
    edgePops += pops
    if (found < 0) found = fallback
    if (found < 0) { routeCache.set(cacheKey, null); return null }
    const path: [number, number][] = []
    let st = found
    for (;;) {
      const cell = Math.floor(Math.floor(st / STRIDE) / 3)
      path.push([Math.floor(cell / grows), cell % grows])
      const p = prev[st]
      if (p < 0) break   // 出発状態
      st = p
    }
    const result = path.reverse()
    routeCache.set(cacheKey, result)
    return result
  }

  const nrm = (s: Side): [number, number] =>
    s === 'top' ? [0, -1] : s === 'bottom' ? [0, 1] : s === 'left' ? [-1, 0] : [1, 0]
  const axisOf = (s: Side): 1 | 2 => (s === 'left' || s === 'right' ? 1 : 2)
  const terminalStubsAreUprightForSides = (
    points: { x: number; y: number }[], startSide: Side, endSide: Side,
  ) => {
    if (points.length < 2) return false
    const upright = (
      endpoint: { x: number; y: number }, next: { x: number; y: number }, side: Side,
    ) => {
      const [nx, ny] = nrm(side)
      const dx = next.x - endpoint.x, dy = next.y - endpoint.y
      const along = nx === 0 ? Math.abs(dx) : Math.abs(dy)
      const outward = dx * nx + dy * ny
      return along < 0.5 && outward >= OUT - 0.5
    }
    return upright(points[0], points[1], startSide) &&
      upright(points[points.length - 1], points[points.length - 2], endSide)
  }
  // 接続点からグリッド始点へつなぐ「足」。接続点は枠上にあるので、まず辺に直角へ
  // OUT だけ出てから曲げる。グリッド始点が辺のすぐ横（ほぼ同じ座標）に取られた場合、
  // 1点だけでつなぐと足の長さが0になり、線が枠に張り付いたまま平行に走り出してしまう。
  const stubPts = (p: { x: number; y: number }, s: Side, gp: { x: number; y: number }) => {
    const [nx, ny] = nrm(s)
    if (s === 'top' || s === 'bottom') {
      // グリッド始点が辺より外にあれば従来どおり1点で足を作る（長さは後段で伸ばす）。
      // 同じ座標・内側なら、外へ出てから曲がる角を挟まないと足が消える。
      if (ny > 0 ? gp.y - p.y > 0.5 : p.y - gp.y > 0.5) return [{ x: p.x, y: gp.y }]
      const out = p.y + ny * OUT
      return [{ x: p.x, y: out }, { x: gp.x, y: out }]
    }
    if (nx > 0 ? gp.x - p.x > 0.5 : p.x - gp.x > 0.5) return [{ x: gp.x, y: p.y }]
    const out = p.x + nx * OUT
    return [{ x: out, y: p.y }, { x: out, y: gp.y }]
  }
  const simplify = (pts: { x: number; y: number }[]) => {
    const d: { x: number; y: number }[] = []
    for (const p of pts) { const q = d[d.length - 1]; if (!q || Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5) d.push(p) }
    // 一直線に並んだ点を落とす。吸着で新たに一直線になることがあるので後でもう一度かける。
    const dropCollinear = (src: { x: number; y: number }[]) => {
      const out: { x: number; y: number }[] = []
      for (let i = 0; i < src.length; i++) {
        if (i > 0 && i < src.length - 1) {
          const a = src[i - 1], b = src[i], c = src[i + 1]
          if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) continue
        }
        out.push(src[i])
      }
      return out
    }
    const res = dropCollinear(d)
    // 近接点の間引きは、直角だった 0.5px の段差を「ほぼ同じ点」として片方だけ捨てるため、
    // 段差が浅い斜めへ化ける。0.5px 自体は見えないが、後段の端点分離が足ごと動かすときに
    // 数px の斜めへ拡大する。端点はノード接続点に固定なので、中間の折れ点だけを
    // 直前の点の軸へ吸着させて直角へ戻す（次の区間は直交するので影響しない）。
    // 間引きで生じたズレだけを対象にする。ズレの小さい側が 0 なら既に直角、
    // 0.5px を超えるなら間引きの誤差ではないので、どちらも触らない。
    const slip = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y)
      const off = Math.min(dx, dy)
      return off > 0 && off <= 0.5 ? (dx < dy ? 'x' : 'y') : null
    }
    for (let i = 1; i < res.length - 1; i++) {
      const a = res[i - 1], b = res[i]
      const axis = slip(a, b)
      if (axis === 'x') res[i] = { x: a.x, y: b.y }
      else if (axis === 'y') res[i] = { x: b.x, y: a.y }
    }
    // 最後の区間だけは手前の折れ点を寄せる。その1つ前との直角が保てるときに限る。
    const last = res.length - 1
    if (last >= 2) {
      const a = res[last - 1], b = res[last], prev = res[last - 2]
      const axis = slip(a, b)
      if (axis === 'x' && Math.abs(prev.y - a.y) < 0.5) res[last - 1] = { x: b.x, y: a.y }
      else if (axis === 'y' && Math.abs(prev.x - a.x) < 0.5) res[last - 1] = { x: a.x, y: b.y }
    }
    // 吸着で段差が消えた点は一直線上に残る。放置すると足の先が数px 折り返した形になり、
    // 端点分離がその点を基準に足を動かして、かえって斜めを作る。
    return dropCollinear(res)
  }

  // 軸並行の線分が（ignore 以外の）ノードに触れないか
  const segClear = (
    p: { x: number; y: number }, q: { x: number; y: number }, ignore?: Set<string>, margin = CLEAR,
  ) => {
    const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x)
    const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y)
    for (const n of nodes) {
      if (ignore && ignore.has(n.id)) continue
      if (x1 >= n.x - margin && x0 <= n.x + n.w + margin && y1 >= n.y - margin && y0 <= n.y + n.h + margin) return false
    }
    return true
  }
  // 線分がノード矩形の「内部」（枠上のタッチは除く）を通るか。
  // segClear は配線の両端ノードを ignore して使うことが多いが、その仮定が許されるのは
  // 端点に接する区間だけ。途中の区間が自分の端点ノードを貫通していないかはこれで確かめる。
  const segEntersNode = (p: { x: number; y: number }, q: { x: number; y: number }, n: MapNode) => {
    const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x)
    const y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y)
    return x1 > n.x + 0.5 && x0 < n.x + n.w - 0.5 && y1 > n.y + 0.5 && y0 < n.y + n.h - 0.5
  }
  // 経路全体の自己貫通チェック。接続点は枠上・出入りは枠に垂直なので、正常な経路は
  // どの区間も端点ノードの「内部」には入らない（枠上を触れるだけ）。
  // 端点ノード同士がドラッグで重なっている場合だけは貫通なしの経路が存在しないため対象外。
  const routeSelfPierces = (points: { x: number; y: number }[], na: MapNode, nb: MapNode) => {
    const endpointsOverlap =
      na.x < nb.x + nb.w && na.x + na.w > nb.x && na.y < nb.y + nb.h && na.y + na.h > nb.y
    if (endpointsOverlap) return false
    for (let i = 0; i < points.length - 1; i++) {
      if (segEntersNode(points[i], points[i + 1], na) || segEntersNode(points[i], points[i + 1], nb)) return true
    }
    return false
  }
  const routeClearsNodes = (
    points: { x: number; y: number }[], na: MapNode, nb: MapNode, margin = CLEAR,
  ) => {
    if (routeSelfPierces(points, na, nb)) return false
    for (let i = 0; i < points.length - 1; i++) {
      const ignore = new Set<string>()
      if (i === 0) ignore.add(na.id)
      if (i + 1 === points.length - 1) ignore.add(nb.id)
      if (!segClear(points[i], points[i + 1], ignore, margin)) return false
    }
    return true
  }
  // 辺の端に寄りすぎない余白。ファンアウトと同じ角クリアランスを使い、
  // 経路探索が接続点を辺の上で動かしても隣の辺の接続点と角で融合しないようにする。
  const MARGIN = CP_CORNER_MARGIN
  // 素直な経路（辺で揃えた直線 or L字）を実座標で試す。障害物に当たれば null
  const TERMINAL_BEND_CLEARANCE = OUT + G
  type SlideRange = { lo: number; hi: number }
  // 2つの面の重なり [lo, hi] の中で、間のノードに塞がれていない座標を探す。
  // 中点1点だけを試していた頃は、中点がノードに塞がれていると、脇に十分な通り道が空いていても
  // 直線を諦めて折れた線になっていた（DTM のデモの 電源タップ→モニター）。
  // 空いている区間のうち中点に近いものを選び、区間に余裕があれば障害物からさらに離す
  const alignedFreeCoord = (
    lo: number, hi: number, mid: number, vertical: boolean,
    spanFrom: number, spanTo: number, own: Set<string>,
  ): number | null => {
    const s0 = Math.min(spanFrom, spanTo), s1 = Math.max(spanFrom, spanTo)
    let free: [number, number][] = [[lo, hi]]
    for (const n of nodes) {
      if (own.has(n.id)) continue
      const along0 = vertical ? n.y : n.x, along1 = vertical ? n.y + n.h : n.x + n.w
      if (along1 < s0 - CLEAR || along0 > s1 + CLEAR) continue
      // segClear は境界ちょうどを塞がれたとみなすので、半端を足して外側へ出す
      const cut0 = (vertical ? n.x : n.y) - CLEAR - 0.5
      const cut1 = (vertical ? n.x + n.w : n.y + n.h) + CLEAR + 0.5
      free = free.flatMap(([l, h]): [number, number][] => {
        if (cut1 < l || cut0 > h) return [[l, h]]
        return [...(cut0 > l ? [[l, cut0] as [number, number]] : []), ...(cut1 < h ? [[cut1, h] as [number, number]] : [])]
      })
    }
    let best: number | null = null
    for (const [l, h] of free) {
      const pad = Math.min((h - l) / 2, CLEAR)
      const coord = Math.round(clamp(mid, l + pad, h - pad))
      if (coord < l || coord > h) continue
      if (best === null || Math.abs(coord - mid) < Math.abs(best - mid)) best = coord
    }
    return best
  }
  const routeDirect = (
    pa: { x: number; y: number }, sa: Side, pb: { x: number; y: number }, sb: Side,
    na: MapNode, nb: MapNode,
    slideA?: SlideRange, slideB?: SlideRange,
  ): { x: number; y: number }[] | null => {
    const own = new Set([na.id, nb.id])
    // ① 辺どうしを揃えた直線（上下辺 or 左右辺が重なる範囲があれば曲げない）
    const vert = (sa === 'top' || sa === 'bottom') && (sb === 'top' || sb === 'bottom') && sa !== sb
    const horz = (sa === 'left' || sa === 'right') && (sb === 'left' || sb === 'right') && sa !== sb
    if (vert) {
      const ra = slideA ?? { lo: pa.x, hi: pa.x }
      const rb = slideB ?? { lo: pb.x, hi: pb.x }
      const lo = Math.max(ra.lo, rb.lo)
      const hi = Math.min(ra.hi, rb.hi)
      if (lo <= hi) {
        const x = alignedFreeCoord(lo, hi, (pa.x + pb.x) / 2, true, pa.y, pb.y, own) ?? clamp((pa.x + pb.x) / 2, lo, hi)
        const p1 = { x, y: pa.y }, p2 = { x, y: pb.y }
        // 逆向きの辺の組（例: 相手が上にいるのに bottom→top）だと、直線が
        // 自分のノードの中を突き抜ける。内部を通る直線は不採用にする
        if (segClear(p1, p2, own) && !segEntersNode(p1, p2, na) && !segEntersNode(p1, p2, nb)) return [p1, p2]
      }
    }
    if (horz) {
      const ra = slideA ?? { lo: pa.y, hi: pa.y }
      const rb = slideB ?? { lo: pb.y, hi: pb.y }
      const lo = Math.max(ra.lo, rb.lo)
      const hi = Math.min(ra.hi, rb.hi)
      if (lo <= hi) {
        const y = alignedFreeCoord(lo, hi, (pa.y + pb.y) / 2, false, pa.x, pb.x, own) ?? clamp((pa.y + pb.y) / 2, lo, hi)
        const p1 = { x: pa.x, y }, p2 = { x: pb.x, y }
        if (segClear(p1, p2, own) && !segEntersNode(p1, p2, na) && !segEntersNode(p1, p2, nb)) return [p1, p2]
      }
    }
    // ② 辺の外に少し出して直線／L字／Z字。
    // 候補は「曲がりが少なく、端の直後・直前で曲がらない」ものを優先して採点する。
    // 両端とも端付近で曲がる候補（S字）は不採用：曲がるとしても片端のみとし、
    // もう一方の端は必ず直進で出入りさせる。
    const [ax, ay] = nrm(sa), [bx, by] = nrm(sb)
    const ea = { x: pa.x + ax * OUT, y: pa.y + ay * OUT }
    const eb = { x: pb.x + bx * OUT, y: pb.y + by * OUT }
    const cands: { x: number; y: number }[][] = []
    if (Math.abs(ea.x - eb.x) < 0.5 || Math.abs(ea.y - eb.y) < 0.5) cands.push([ea, eb])
    cands.push([ea, { x: ea.x, y: eb.y }, eb])
    cands.push([ea, { x: eb.x, y: ea.y }, eb])
    let best: { x: number; y: number }[] | null = null
    let bestScore = Infinity
    for (const mid of cands) {
      let ok = true
      for (let i = 0; i < mid.length - 1; i++) if (!segClear(mid[i], mid[i + 1])) { ok = false; break }
      if (!ok) continue
      const pts = simplify([pa, ...mid, pb])
      if (!routeClearsNodes(pts, na, nb)) continue
      const last = pts.length - 1
      let bends = 0, nearStart = false, nearEnd = false
      for (let i = 1; i < last; i++) {
        bends++
        if (Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y) <= TERMINAL_BEND_CLEARANCE) nearStart = true
        if (Math.hypot(pts[i].x - pts[last].x, pts[i].y - pts[last].y) <= TERMINAL_BEND_CLEARANCE) nearEnd = true
      }
      if (nearStart && nearEnd) continue
      const score = bends * 10 + (nearStart || nearEnd ? 1 : 0)
      if (score < bestScore) { bestScore = score; best = pts }
    }
    return best
  }

  const routeBends = (points: { x: number; y: number }[]) => Math.max(0, points.length - 2)
  const routeLength = (points: { x: number; y: number }[]) => {
    let length = 0
    for (let i = 0; i < points.length - 1; i++) {
      length += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y)
    }
    return length
  }
  const routeKey = (points: { x: number; y: number }[]) => {
    const encode = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';')
    const forward = encode(points)
    const reverse = encode([...points].reverse())
    return forward < reverse ? forward : reverse
  }
  type RouteSegment = { x0: number; x1: number; y0: number; y1: number; horiz: boolean }
  const routeSegments = (points: { x: number; y: number }[]): RouteSegment[] => {
    const segments: RouteSegment[] = []
    for (let i = 0; i < points.length - 1; i++) {
      const p = points[i], q = points[i + 1]
      const horiz = Math.abs(p.y - q.y) < 0.5
      segments.push(horiz
        ? { x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), y0: p.y, y1: p.y, horiz: true }
        : { x0: p.x, x1: p.x, y0: Math.min(p.y, q.y), y1: Math.max(p.y, q.y), horiz: false })
    }
    return segments
  }
  const segmentsCross = (horizontal: RouteSegment, vertical: RouteSegment) =>
    vertical.x0 > horizontal.x0 + 1 && vertical.x0 < horizontal.x1 - 1 &&
    horizontal.y0 > vertical.y0 + 1 && horizontal.y0 < vertical.y1 - 1
  const countSegmentCrossings = (a: RouteSegment[], b: RouteSegment[]) => {
    let count = 0
    for (const first of a) for (const second of b) {
      if (first.horiz === second.horiz) continue
      if (segmentsCross(first.horiz ? first : second, first.horiz ? second : first)) count++
    }
    return count
  }
  const overlappingSegmentLength = (a: RouteSegment[], b: RouteSegment[]) => {
    let length = 0
    for (const first of a) for (const second of b) {
      if (first.horiz !== second.horiz) continue
      const sameLane = first.horiz
        ? Math.abs(first.y0 - second.y0) < 0.5
        : Math.abs(first.x0 - second.x0) < 0.5
      if (!sameLane) continue
      const lo = Math.max(first.horiz ? first.x0 : first.y0, second.horiz ? second.x0 : second.y0)
      const hi = Math.min(first.horiz ? first.x1 : first.y1, second.horiz ? second.x1 : second.y1)
      length += Math.max(0, hi - lo)
    }
    return length
  }
  const nearbyParallelSegmentLength = (a: RouteSegment[], b: RouteSegment[], maxLaneGap: number) => {
    let length = 0
    for (const first of a) {
      for (const second of b) {
        if (first.horiz !== second.horiz) continue
        const laneDistance = first.horiz
          ? Math.abs(first.y0 - second.y0)
          : Math.abs(first.x0 - second.x0)
        if (laneDistance >= maxLaneGap) continue
        const lo = Math.max(first.horiz ? first.x0 : first.y0, second.horiz ? second.x0 : second.y0)
        const hi = Math.min(first.horiz ? first.x1 : first.y1, second.horiz ? second.x1 : second.y1)
        length += Math.max(0, hi - lo)
      }
    }
    return length
  }
  const terminalBendPenalty = (points: { x: number; y: number }[]) => {
    if (points.length < 3) return 0
    const first = points[0], last = points[points.length - 1]
    let penalty = 0
    for (let i = 1; i < points.length - 1; i++) {
      const fromStart = Math.abs(points[i].x - first.x) + Math.abs(points[i].y - first.y)
      const fromEnd = Math.abs(points[i].x - last.x) + Math.abs(points[i].y - last.y)
      penalty += Math.max(0, TERMINAL_BEND_CLEARANCE - fromStart)
      penalty += Math.max(0, TERMINAL_BEND_CLEARANCE - fromEnd)
    }
    return penalty
  }
  type RouteReadability = {
    siblingOverlap: number
    wrapPenalty: number
    bends: number
    crossings: number
    /** 別の線の口のすぐ外（portStubSegments）を横切る回数 */
    portCrossings: number
    overlap: number
    terminalPenalty: number
    cornerPenalty: number
    length: number
    key: string
  }
  // 相手と反対側の辺へ出入りする経路（ガジェットを追い越して裏側から刺さる形）のペナルティ。
  // 交差や重なりを1本減らすためにこの形を選ぶと、読み手には遠回りの理由が見えず
  // 「この配線の仕方は変」としか映らない。辺の向きは交差や長さより先に効かせる。
  const wrapAroundPenalty = (n: MapNode, other: MapNode, side: Side) =>
    (side === 'left' ? other.x >= n.x + n.w
      : side === 'right' ? other.x + other.w <= n.x
      : side === 'top' ? other.y >= n.y + n.h
      : other.y + other.h <= n.y) ? 1 : 0
  // 辺の端すれすれに出入りする接続点へのペナルティ。
  // これがないと「幅広ノードの上面の左端に刺さるL字」のような角ハグ経路が、
  // 経路長がわずかに短いだけで側面中央へ素直に入る経路に勝ってしまう。
  const CORNER_HUG_MARGIN = 24
  const cornerHugPenalty = (p: { x: number; y: number }, n: MapNode, side: Side) => {
    const horizontal = side === 'top' || side === 'bottom'
    const lo = horizontal ? n.x : n.y
    const hi = horizontal ? n.x + n.w : n.y + n.h
    const v = horizontal ? p.x : p.y
    // 小さいノードでは辺全体が「端」になってしまうため、辺の長さに応じて緩める
    const margin = Math.min(CORNER_HUG_MARGIN, (hi - lo) / 3)
    return Math.max(0, margin - Math.min(v - lo, hi - v))
  }
  const readabilityOf = (
    points: { x: number; y: number }[],
    existing: RouteSegment[][] = [],
    siblings: RouteSegment[][] = [],
  ): RouteReadability => {
    const segments = routeSegments(points)
    let crossings = 0
    let overlap = 0
    for (const other of existing) {
      crossings += countSegmentCrossings(segments, other)
      overlap += nearbyParallelSegmentLength(segments, other, 12)
    }
    let siblingOverlap = 0
    for (const sibling of siblings) siblingOverlap += nearbyParallelSegmentLength(segments, sibling, 12)
    return {
      siblingOverlap,
      wrapPenalty: 0,
      bends: routeBends(points),
      crossings,
      portCrossings: 0,
      overlap,
      terminalPenalty: terminalBendPenalty(points),
      cornerPenalty: 0,
      length: routeLength(points),
      key: routeKey(points),
    }
  }
  const PORT_CROSSING_COST = 200
  const compareReadability = (a: RouteReadability, b: RouteReadability) => {
    if (Math.abs(a.siblingOverlap - b.siblingOverlap) > 0.5) return a.siblingOverlap - b.siblingOverlap
    // 回り込みは交差や重なりより先に潰す。交差は直交配線として読めるが、ガジェットを追い越して
    // 裏側から刺さる線は読み手に理由が見えず「配線の仕方が変」と受け取られるため。
    if (a.wrapPenalty !== b.wrapPenalty) return a.wrapPenalty - b.wrapPenalty
    if (Math.abs(a.overlap - b.overlap) > 0.5) return a.overlap - b.overlap
    // 交差を1件減らすために、距離や曲がりを無制限に増やさない。
    // 交差・曲がり・長さを同じ尺度へ換算し、視認性と取り回しを両立する。
    // 口のすぐ外での交差は、普通の交差より重く数える。切れ目が口の近くに来ると、
    // 横切った線がその機器へつながって見える（曲がり1つ＋少しの遠回りなら避ける）
    const scoreA = a.crossings * 140 + a.portCrossings * PORT_CROSSING_COST + a.bends * 120 + a.length
    const scoreB = b.crossings * 140 + b.portCrossings * PORT_CROSSING_COST + b.bends * 120 + b.length
    if (Math.abs(scoreA - scoreB) > 0.5) return scoreA - scoreB
    if (Math.abs(a.terminalPenalty - b.terminalPenalty) > 0.5) return a.terminalPenalty - b.terminalPenalty
    if (Math.abs(a.cornerPenalty - b.cornerPenalty) > 0.5) return a.cornerPenalty - b.cornerPenalty
    if (a.crossings !== b.crossings) return a.crossings - b.crossings
    if (a.bends !== b.bends) return a.bends - b.bends
    if (Math.abs(a.length - b.length) > 0.5) return a.length - b.length
    return a.key.localeCompare(b.key)
  }
  // 補修を終えた図での置き換え判定。この段階で残っている 12px 未満の並走は、後段の並走レーン分割が
  // 12.5px 間隔へ広げて解消するので、それを理由に交差や遠回りを増やす経路へ替えない
  // （compareReadability は並走を交差より先に見るため、そのまま使うと、全体で交差が3件・
  // 長さが800px増える置き換えが通っていた）。回り込みと並走を悪くせずに合算点が下がるときだけ替える
  const settledRouteBetter = (a: RouteReadability, b: RouteReadability) => {
    if (a.wrapPenalty > b.wrapPenalty) return false
    if (a.siblingOverlap > b.siblingOverlap + 0.5 || a.overlap > b.overlap + 0.5) return false
    const scoreA = a.crossings * 140 + a.portCrossings * PORT_CROSSING_COST + a.bends * 120 + a.length
    const scoreB = b.crossings * 140 + b.portCrossings * PORT_CROSSING_COST + b.bends * 120 + b.length
    return scoreA < scoreB - 0.5
  }
  const betterRoute = (
    a: { x: number; y: number }[] | null,
    b: { x: number; y: number }[] | null,
  ) => {
    if (!a) return b
    if (!b) return a
    return compareReadability(readabilityOf(a), readabilityOf(b)) <= 0 ? a : b
  }
  const routeDirectBothWays = (
    pa: { x: number; y: number }, sa: Side, pb: { x: number; y: number }, sb: Side,
    na: MapNode, nb: MapNode, slideA?: SlideRange, slideB?: SlideRange,
  ) => {
    const forward = routeDirect(pa, sa, pb, sb, na, nb, slideA, slideB)
    const reverse = routeDirect(pb, sb, pa, sa, nb, na, slideB, slideA)
    return betterRoute(forward, reverse ? [...reverse].reverse() : null)
  }

  // 出発・到着直後の微小な段差（グリッド吸着による ≤1マスのジョグ）を吸収する。
  // 「端点から伸びる直線 → 短い直角ジョグ → 元の軸方向の直線」という形を検出し、
  // ジョグ以降の直線ランを端点の座標へ平行移動して端の曲がりをなくす。
  const absorbJogOneEnd = (p: { x: number; y: number }[], own: Set<string>): { x: number; y: number }[] => {
    if (p.length < 4) return p
    const vert = Math.abs(p[0].x - p[1].x) < 0.5 && Math.abs(p[0].y - p[1].y) > 0.5
    const horz = Math.abs(p[0].y - p[1].y) < 0.5 && Math.abs(p[0].x - p[1].x) > 0.5
    if (!vert && !horz) return p
    const jog = vert ? Math.abs(p[2].x - p[1].x) : Math.abs(p[2].y - p[1].y)
    const perpOk = vert ? Math.abs(p[2].y - p[1].y) < 0.5 : Math.abs(p[2].x - p[1].x) < 0.5
    if (!perpOk || jog < 0.5 || jog > G) return p
    // ジョグの先に続く「元の軸方向の直線ラン」の終端を探す
    let k = 2
    while (k + 1 < p.length && (vert ? Math.abs(p[k + 1].x - p[k].x) < 0.5 : Math.abs(p[k + 1].y - p[k].y) < 0.5)) k++
    if (k >= p.length - 1) return p   // ランが反対側の端点まで届く場合は動かせない
    const q = p.map((pt) => ({ ...pt }))
    for (let i = 2; i <= k; i++) { if (vert) q[i].x = p[0].x; else q[i].y = p[0].y }
    for (let i = 1; i <= k; i++) { if (!segClear(q[i], q[i + 1], own)) return p }
    return simplify(q)
  }
  // 端の足（接続点から最初の折れ点まで）が OUT より短いと、配線が枠に張り付いたように
  // 見える。グリッド始点が辺のすぐ外に取られたときに起きるので、足の先の「辺と平行な区間」を
  // まとめて外側へずらし、足を OUT まで伸ばす（その先の区間が伸縮して吸収する）。
  const stretchStubOneEnd = (
    p: { x: number; y: number }[], own: Set<string>, minLength = OUT,
  ): { x: number; y: number }[] => {
    if (p.length < 4) return p
    const vert = Math.abs(p[0].x - p[1].x) < 0.5 && Math.abs(p[0].y - p[1].y) > 0.5
    const horz = Math.abs(p[0].y - p[1].y) < 0.5 && Math.abs(p[0].x - p[1].x) > 0.5
    if (!vert && !horz) return p
    const axis = (pt: { x: number; y: number }) => (vert ? pt.y : pt.x)
    const stubLength = Math.abs(axis(p[1]) - axis(p[0]))
    if (stubLength >= minLength) return p
    const target = axis(p[0]) + Math.sign(axis(p[1]) - axis(p[0])) * minLength
    let k = 1
    while (k + 1 < p.length && Math.abs(axis(p[k + 1]) - axis(p[k])) < 0.5) k++
    if (k >= p.length - 1) return p   // 反対側の端点まで届く場合は動かせない
    const q = p.map((pt) => ({ ...pt }))
    for (let i = 1; i <= k; i++) { if (vert) q[i].y = target; else q[i].x = target }
    // 反対側の足を潰してしまうなら見送る
    const last = q.length - 1
    if (k + 1 === last && Math.abs(axis(q[last]) - axis(q[last - 1])) < OUT) return p
    for (let i = 0; i <= k; i++) { if (!segClear(q[i], q[i + 1], own)) return p }
    return simplify(q)
  }
  // 平行区間全体を動かすと障害物に当たる場合は、端点のすぐ外だけをOUTまで伸ばし、
  // 元のレーンへ戻る短いドッグレッグを試す。全区間が安全な候補だけを返す。
  const extendStubWithDoglegOneEnd = (p: { x: number; y: number }[], own: Set<string>): { x: number; y: number }[] => {
    if (p.length < 3) return p
    const vert = Math.abs(p[0].x - p[1].x) < 0.5 && Math.abs(p[0].y - p[1].y) > 0.5
    const horz = Math.abs(p[0].y - p[1].y) < 0.5 && Math.abs(p[0].x - p[1].x) > 0.5
    if (!vert && !horz) return p
    const axis = (point: { x: number; y: number }) => vert ? point.y : point.x
    const direction = Math.sign(axis(p[1]) - axis(p[0]))
    if (direction === 0 || Math.abs(axis(p[1]) - axis(p[0])) >= OUT) return p
    const perpendicular = vert
      ? Math.abs(p[1].y - p[2].y) < 0.5 && Math.abs(p[1].x - p[2].x) > 0.5
      : Math.abs(p[1].x - p[2].x) < 0.5 && Math.abs(p[1].y - p[2].y) > 0.5
    if (!perpendicular) return p
    const extended = vert
      ? { x: p[0].x, y: p[0].y + direction * OUT }
      : { x: p[0].x + direction * OUT, y: p[0].y }
    const perpendicularLength = vert
      ? Math.abs(p[2].x - p[1].x)
      : Math.abs(p[2].y - p[1].y)
    if (perpendicularLength < OUT) return p
    const perpendicularDirection = vert
      ? Math.sign(p[2].x - p[1].x)
      : Math.sign(p[2].y - p[1].y)
    const outerCorner = vert
      ? { x: extended.x + perpendicularDirection * OUT, y: extended.y }
      : { x: extended.x, y: extended.y + perpendicularDirection * OUT }
    const returnCorner = vert
      ? { x: outerCorner.x, y: p[1].y }
      : { x: p[1].x, y: outerCorner.y }
    const candidate = simplify([p[0], extended, outerCorner, returnCorner, ...p.slice(2)])
    for (let i = 0; i < candidate.length - 1; i++) {
      if (!segClear(candidate[i], candidate[i + 1], own)) return p
    }
    return candidate
  }
  const absorbTerminalJog = (pts: { x: number; y: number }[], own: Set<string>) => {
    const fixed = absorbJogOneEnd(pts, own)
    const bothEnds = absorbJogOneEnd([...fixed].reverse(), own).reverse()
    const stretched = stretchStubOneEnd(bothEnds, own)
    return stretchStubOneEnd([...stretched].reverse(), own).reverse()
  }
  // 経路をグリッド辺に転写（後続配線の重なり回避用）
  const markUsed = (pts: { x: number; y: number }[]) => {
    routeCache.clear()   // 盤面が変わるので覚えていた経路は捨てる
    edgePops = 0         // 次の1本へ探索予算を戻す
    for (let s = 0; s < pts.length - 1; s++) {
      let i0 = clamp(Math.round((pts[s].x - gox) / G), 0, cols - 1)
      let j0 = clamp(Math.round((pts[s].y - goy) / G), 0, grows - 1)
      const i1 = clamp(Math.round((pts[s + 1].x - gox) / G), 0, cols - 1)
      const j1 = clamp(Math.round((pts[s + 1].y - goy) / G), 0, grows - 1)
      const stepI = Math.sign(i1 - i0), stepJ = Math.sign(j1 - j0)
      let guard = 0
      while ((i0 !== i1 || j0 !== j1) && guard++ < cols + grows) {
        const ni = i0 + stepI, nj = j0 + stepJ
        // フォールバックの斜め区間を、隣接する横辺の使用済み印と混同しない。
        if (ni === i0 || nj === j0) usedEdge[ekey(gidx(i0, j0), gidx(ni, nj))] = 1
        // 並走を防ぐため、進行方向に垂直なセルに間隔ペナルティを記録
        // 強度: 1マス(12px)=3, 2マス(24px)=2, 3マス(36px)=1。
        // 並走N マスで N×ペナルティが累積し、十分な間隔（3マス超）への迂回を促す
        if (stepI !== 0) {            // 横移動 → 上下のセルをマーク
          for (let d = 1; d <= 3; d++) {
            for (const sg of [-1, 1]) {
              const j2 = j0 + d * sg
              if (j2 >= 0 && j2 < grows) {
                const ck = gidx(i0, j2)
                nearCell[ck] = Math.max(nearCell[ck], 4 - d)
              }
            }
          }
        } else if (stepJ !== 0) {    // 縦移動 → 左右のセルをマーク
          for (let d = 1; d <= 3; d++) {
            for (const sg of [-1, 1]) {
              const i2 = i0 + d * sg
              if (i2 >= 0 && i2 < cols) {
                const ck = gidx(i2, j0)
                nearCell[ck] = Math.max(nearCell[ck], 4 - d)
              }
            }
          }
        }
        i0 = ni; j0 = nj
      }
    }
  }

  // ── 直交パス生成 ──
  // 2点間を結ぶ経路を求める共通ヘルパー。交差補修（開始位置の交換の試行）でも再利用する。
  const routeBetween = async (
    cpa: { x: number; y: number }, sa: Side, na: MapNode,
    cpb: { x: number; y: number }, sb: Side, nb: MapNode,
    avoidCells?: Set<number>, maxPops = 20000,
    grid: Uint8Array = passable, clearance = CLEAR,
  ): Promise<{ x: number; y: number }[] | null> => {
    const pause = pauseIfNeeded()
    if (pause) await pause
    // ① 障害物がなければ実座標で直線／L字（グリッド段差を出さない）
    let points = avoidCells ? null : routeDirect(cpa, sa, cpb, sb, na, nb)
    // ② 塞がれている場合のみグリッドA*で迂回
    if (!points) {
      const [ax, ay] = nrm(sa), [bx, by] = nrm(sb)
      const sCell = nearestCell(cpa.x + ax * (clearance + G), cpa.y + ay * (clearance + G), grid)
      const tCell = nearestCell(cpb.x + bx * (clearance + G), cpb.y + by * (clearance + G), grid)
      const cells = await routeCells(sCell, tCell, axisOf(sa), axisOf(sb), avoidCells, AVOID, maxPops, grid)
      if (cells && cells.length) {
        const gp = cells.map(([i, j]) => ({ x: cellX(i), y: cellY(j) }))
        points = absorbTerminalJog(
          simplify([
            cpa, ...stubPts(cpa, sa, gp[0]),
            ...gp,
            ...stubPts(cpb, sb, gp[gp.length - 1]).reverse(), cpb,
          ]),
          new Set([na.id, nb.id]),
        )
      }
    }
    if (points && !routeClearsNodes(points, na, nb, clearance)) return null
    return points
  }

  // 辺の中央の接続点（代替辺で引き直すときに使う）。
  // 幅・高さが奇数のノードでは中心が 0.5px ずれる。そのまま接続点にすると
  // グリッド座標との差で足の途中に 0.5px の段差（斜めの区間）ができるので丸める。
  const centerCpOf = (n: MapNode, s: Side) =>
    s === 'top' ? { x: Math.round(n.cx), y: n.y }
    : s === 'bottom' ? { x: Math.round(n.cx), y: n.y + n.h }
    : s === 'left' ? { x: n.x, y: Math.round(n.cy) }
    : { x: n.x + n.w, y: Math.round(n.cy) }

  const freeSlideRange = (n: MapNode, s: Side): SlideRange =>
    s === 'top' || s === 'bottom'
      ? { lo: n.x + MARGIN, hi: n.x + n.w - MARGIN }
      : { lo: n.y + MARGIN, hi: n.y + n.h - MARGIN }

  const fixedSlideRange = (p: { x: number; y: number }, s: Side): SlideRange => {
    const coord = s === 'top' || s === 'bottom' ? p.x : p.y
    return { lo: coord, hi: coord }
  }

  const refreshFanoutSide = (n: MapNode, side: Side) => {
    const horizontal = side === 'top' || side === 'bottom'
    const entries = (incident.get(n.id) ?? [])
      .filter((entry) => entry.side === side)
      .sort((p, q) => {
        const op = nodeById.get(p.other)!, oq = nodeById.get(q.other)!
        return (horizontal ? op.cx - oq.cx : op.cy - oq.cy) || p.eid.localeCompare(q.eid)
      })
    const keys = entries.map((entry) => entry.eid + '@' + n.id)
    entries.forEach((entry, index) => {
      fanoutSlots.set(entry.eid + '@' + n.id, { keys, index, horizontal, side })
    })
  }

  const refreshFanoutByCoordinate = (n: MapNode, side: Side) => {
    const horizontal = side === 'top' || side === 'bottom'
    const entries = (incident.get(n.id) ?? [])
      .filter((entry) => entry.side === side)
      .sort((p, q) => {
        const pp = cp.get(p.eid + '@' + n.id), pq = cp.get(q.eid + '@' + n.id)
        return ((horizontal ? pp?.x : pp?.y) ?? 0) - ((horizontal ? pq?.x : pq?.y) ?? 0) || p.eid.localeCompare(q.eid)
      })
    const keys = entries.map((entry) => entry.eid + '@' + n.id)
    entries.forEach((entry, index) => {
      fanoutSlots.set(entry.eid + '@' + n.id, { keys, index, horizontal, side })
    })
  }

  const setEndpointSide = (edgeId: string, n: MapNode, previous: Side, next: Side) => {
    const entry = (incident.get(n.id) ?? []).find((candidate) => candidate.eid === edgeId)
    if (entry) entry.side = next
    refreshFanoutSide(n, previous)
    if (next !== previous) refreshFanoutSide(n, next)
  }

  // 主候補の辺で直線/L字が塞がれていたときに試す、別の辺の組み合わせ。
  // 整列配置でも到着辺を横腹へ替え、間の障害物を少ない曲がりで回避できるようにする。
  const altSidePairs = (a: MapNode, b: MapNode, sa: Side, sb: Side): [Side, Side][] => {
    const dx = b.cx - a.cx, dy = b.cy - a.cy
    if (a.gadget.category === 'Light' && hasNodeBelowLight(a, b)) {
      const bSide: Side = dy >= 0 ? 'top' : 'bottom'
      return ([['left', bSide], ['right', bSide]] as [Side, Side][])
        .filter(([s1, s2]) => !(s1 === sa && s2 === sb))
    }
    if (b.gadget.category === 'Light' && hasNodeBelowLight(b, a)) {
      const aSide: Side = dy >= 0 ? 'bottom' : 'top'
      return ([[aSide, 'left'], [aSide, 'right']] as [Side, Side][])
        .filter(([s1, s2]) => !(s1 === sa && s2 === sb))
    }
    if (Math.abs(dx) < 1) {
      return ([
        [sa, 'left'], [sa, 'right'],
        ['left', 'left'], ['right', 'right'],
      ] as [Side, Side][]).filter(([s1, s2]) => !(s1 === sa && s2 === sb))
    }
    if (Math.abs(dy) < 1) {
      return ([
        [sa, 'top'], [sa, 'bottom'],
        ['top', 'top'], ['bottom', 'bottom'],
      ] as [Side, Side][]).filter(([s1, s2]) => !(s1 === sa && s2 === sb))
    }
    const vFirst: [Side, Side] = [dy > 0 ? 'bottom' : 'top', dx > 0 ? 'left' : 'right']
    const hFirst: [Side, Side] = [dx > 0 ? 'right' : 'left', dy > 0 ? 'top' : 'bottom']
    return [vFirst, hFirst].filter(([s1, s2]) => !(s1 === sa && s2 === sb))
  }

  const sideCoord = (n: MapNode, side: Side, coord: number) =>
    side === 'top' ? { x: Math.round(coord), y: n.y }
    : side === 'bottom' ? { x: Math.round(coord), y: n.y + n.h }
    : side === 'left' ? { x: n.x, y: Math.round(coord) }
    : { x: n.x + n.w, y: Math.round(coord) }

  // 代替辺の接続点候補。辺の中央、相手辺の外側と揃う位置、両端寄りだけに限定する。
  // 既存配線との順序・最低間隔を壊す位置は候補から外す。
  const altCpCandidates = (
    edgeId: string, n: MapNode, side: Side, preferred?: number,
  ): { x: number; y: number }[] => {
    const horizontal = side === 'top' || side === 'bottom'
    const range = freeSlideRange(n, side)
    const center = horizontal ? n.cx : n.cy
    const obstacleEdges = nodes
      .filter((other) => other.id !== n.id)
      .flatMap((other) => horizontal
        ? [other.x - CLEAR - OUT, other.x + other.w + CLEAR + OUT]
        : [other.y - CLEAR - OUT, other.y + other.h + CLEAR + OUT])
    const baseCoords = [preferred, center, range.lo, range.hi]
      .filter((v): v is number => v !== undefined)
      .map((v) => clamp(v, range.lo, range.hi))
      .filter((v, i, all) => all.findIndex((x) => Math.abs(x - v) < 0.5) === i)
    const extraCoords = obstacleEdges
      .map((v) => clamp(v, range.lo, range.hi))
      .filter((v, i, all) => all.findIndex((x) => Math.abs(x - v) < 0.5) === i)
      .filter((v) => baseCoords.every((base) => Math.abs(base - v) >= 0.5))
      .sort((a, b) => Math.abs(a - (preferred ?? center)) - Math.abs(b - (preferred ?? center)))
    const coords = [...baseCoords, ...extraCoords].slice(0, 8)
    const ordered = (incident.get(n.id) ?? [])
      .filter((entry) => entry.eid === edgeId || sideMap.get(entry.eid + '@' + n.id) === side)
      .sort((p, q) => {
        const op = nodeById.get(p.other)!, oq = nodeById.get(q.other)!
        return (horizontal ? op.cx - oq.cx : op.cy - oq.cy) || p.eid.localeCompare(q.eid)
      })
    const index = ordered.findIndex((entry) => entry.eid === edgeId)
    const previous = index > 0 ? cp.get(ordered[index - 1].eid + '@' + n.id) : undefined
    const following = index >= 0 && index + 1 < ordered.length ? cp.get(ordered[index + 1].eid + '@' + n.id) : undefined
    const orderedLo = previous ? (horizontal ? previous.x : previous.y) + MIN_CP_STEP : range.lo
    const orderedHi = following ? (horizontal ? following.x : following.y) - MIN_CP_STEP : range.hi
    return coords
      .filter((coord) => coord >= orderedLo && coord <= orderedHi)
      .map((coord) => sideCoord(n, side, coord))
  }

  const outsideCoord = (n: MapNode, side: Side) => {
    const [nx, ny] = nrm(side)
    return side === 'top' || side === 'bottom'
      ? n.y + ny * OUT
      : n.x + nx * OUT
  }

  // 同じ側の辺どうしを、接続区間に重なるノード群の外側に1本だけレーンを置いて結ぶ2曲がり候補。
  // 接続元の辺幅だけでは中央障害物の外へ出られない場合の限定フォールバック。
  // nearOnly は両端ノードのすぐ外にレーンを置く。外周だけだと、両端の間の通路が空いていても
  // 図の外周まで回る候補しか作れず、コの字の組合せは A* の上位候補にも入らないため、
  // 3曲がりで相手の辺の角へ刺さる経路が選ばれていた（ドック→ヘッドセットの上辺どうし）。
  const routeOuterLane = (
    pa: { x: number; y: number }, sa: Side,
    pb: { x: number; y: number }, sb: Side,
    na: MapNode, nb: MapNode, nearOnly = false,
    avoid?: RouteSegment[],
  ): { x: number; y: number }[] | null => {
    if (sa !== sb) return null
    const vertical = sa === 'left' || sa === 'right'
    const corridorLo = vertical ? Math.min(pa.y, pb.y) : Math.min(pa.x, pb.x)
    const corridorHi = vertical ? Math.max(pa.y, pb.y) : Math.max(pa.x, pb.x)
    const relevant = nearOnly ? [na, nb] : nodes.filter((n) => vertical
      ? n.y + n.h + CLEAR >= corridorLo && n.y - CLEAR <= corridorHi
      : n.x + n.w + CLEAR >= corridorLo && n.x - CLEAR <= corridorHi)
    const nodeLane = sa === 'left'
      ? Math.min(...relevant.map((n) => n.x - CLEAR)) - OUT
      : sa === 'right'
        ? Math.max(...relevant.map((n) => n.x + n.w + CLEAR)) + OUT
        : sa === 'top'
          ? Math.min(...relevant.map((n) => n.y - CLEAR)) - OUT
          : Math.max(...relevant.map((n) => n.y + n.h + CLEAR)) + OUT
    // レーンはノードの外形だけで決まるので、先に引いた線が同じ外側を回っていると 12px 未満で並走し、
    // 採点で必ず負ける（1画面テンプレートで、ライトの電源線がスピーカーの電源線と 9px で並び、
    // 側面から出す2曲がりを捨てて下辺から回り込む3曲がりになっていた）。
    // avoid を渡したときは、並走する線の1レーン外側までレーンを送った候補を作る
    let lane = nodeLane
    if (avoid) {
      const outward = sa === 'left' || sa === 'top' ? -1 : 1
      for (let moved = true, guard = 0; moved && guard < 16; guard++) {
        moved = false
        for (const s of avoid) {
          if (s.horiz === vertical) continue
          const coord = vertical ? s.x0 : s.y0
          const lo = vertical ? s.y0 : s.x0
          const hi = vertical ? s.y1 : s.x1
          if (hi <= corridorLo || lo >= corridorHi || Math.abs(coord - lane) >= LANE_PITCH) continue
          lane = coord + outward * LANE_PITCH
          moved = true
        }
      }
      if (Math.abs(lane - nodeLane) < 0.5) return null
    }
    const mid = sa === 'left' || sa === 'right'
      ? [pa, { x: lane, y: pa.y }, { x: lane, y: pb.y }, pb]
      : [pa, { x: pa.x, y: lane }, { x: pb.x, y: lane }, pb]
    // レーンへの出入り区間で無視してよいのは「自分側のノード」だけ。
    // 両端ノードをまとめて無視すると、相手ノードを貫通してから外側レーンへ
    // 回り込む経路（＝配線がノードの中を通って見える）を検出できない。
    for (let i = 0; i < mid.length - 1; i++) {
      const ignore = i === 0 ? new Set([na.id]) : i === mid.length - 2 ? new Set([nb.id]) : undefined
      if (!segClear(mid[i], mid[i + 1], ignore)) return null
    }
    return simplify(mid)
  }

  const sidePairBendLowerBound = (sa: Side, sb: Side) => {
    const aHorizontal = sa === 'top' || sa === 'bottom'
    const bHorizontal = sb === 'top' || sb === 'bottom'
    if (aHorizontal !== bHorizontal) return 1
    return sa !== sb ? 0 : 2
  }

  const endpointPairs = (
    pointsA: { x: number; y: number }[], pointsB: { x: number; y: number }[],
    midpointCompliant: (pa: { x: number; y: number }, pb: { x: number; y: number }) => boolean,
    limit = 12,
  ) => pointsA
    .flatMap((pa) => pointsB.map((pb) => ({
      pa, pb,
      midpointCompliant: midpointCompliant(pa, pb),
      distance: Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y),
    })))
    .sort((a, b) => Number(b.midpointCompliant) - Number(a.midpointCompliant) || a.distance - b.distance)
    .slice(0, limit)

  const sideUseCount = (edgeId: string, n: MapNode, side: Side) =>
    (incident.get(n.id) ?? []).filter((entry) =>
      entry.eid === edgeId || sideMap.get(entry.eid + '@' + n.id) === side).length

  const isSideCenter = (point: { x: number; y: number }, n: MapNode, side: Side) => {
    const center = centerCpOf(n, side)
    return Math.abs(point.x - center.x) < 0.5 && Math.abs(point.y - center.y) < 0.5
  }

  const routedForSelection: {
    nodeIds: Set<string>
    terminals: Map<string, { x: number; y: number }>
    segments: RouteSegment[]
    edgeId: string
  }[] = []
  // 確定済みの配線が、そのノードのこの座標を端点として使っているか。
  // 同じ物理ケーブルの枝どうしは分岐元で同じ点から出るのが正しいので、占有とみなさない。
  const terminalOccupiedAt = (nodeId: string, point: { x: number; y: number }, selfEdgeId?: string) => {
    const ownBranch = selfEdgeId !== undefined ? branchKeyAt(selfEdgeId, nodeId) : null
    for (const routed of routedForSelection) {
      const terminal = routed.terminals.get(nodeId)
      if (!terminal || Math.hypot(terminal.x - point.x, terminal.y - point.y) >= 0.5) continue
      if (ownBranch !== null && branchKeyAt(routed.edgeId, nodeId) === ownBranch) continue
      return true
    }
    return false
  }
  const actualPowerStripId = (nodeId: string): string | null => {
    if (nodeId === WALL_ID || !nodeById.has(nodeId)) return null
    return gadgetOfNode(nodeId).category === 'PowerStrip' ? nodeId : null
  }
  const powerTrunkStripId = (connection: MapConnection): string | null => {
    if (connection.cableType !== 'Power') return null
    if (connection.fromGadgetId === WALL_ID) return actualPowerStripId(connection.toGadgetId)
    if (connection.toGadgetId === WALL_ID) return actualPowerStripId(connection.fromGadgetId)
    return null
  }
  const powerBranchStripId = (connection: MapConnection): string | null => {
    if (connection.cableType !== 'Power' || connection.fromGadgetId === WALL_ID || connection.toGadgetId === WALL_ID) return null
    return actualPowerStripId(connection.fromGadgetId) ?? actualPowerStripId(connection.toGadgetId)
  }
  const protectedPowerTrunks = new Map<string, RouteSegment[]>()
  const protectedTrunkPoints = new Map<string, { x: number; y: number }[]>()
  const protectedBranchPoints = new Map<string, { x: number; y: number }[]>()
  const conflictsWithPowerTrunk = (points: { x: number; y: number }[], trunk: RouteSegment[]) => {
    const segments = routeSegments(points)
    return countSegmentCrossings(segments, trunk) > 0 ||
      overlappingSegmentLength(segments, trunk) > 1
  }
  const protectedCellsNear = (points: { x: number; y: number }[]) => {
    const cells = new Set<number>()
    for (let segment = 0; segment < points.length - 1; segment++) {
      let i = clamp(Math.round((points[segment].x - gox) / G), 0, cols - 1)
      let j = clamp(Math.round((points[segment].y - goy) / G), 0, grows - 1)
      const endI = clamp(Math.round((points[segment + 1].x - gox) / G), 0, cols - 1)
      const endJ = clamp(Math.round((points[segment + 1].y - goy) / G), 0, grows - 1)
      const stepI = Math.sign(endI - i), stepJ = Math.sign(endJ - j)
      let guard = 0
      while (true) {
        cells.add(gidx(i, j))
        if ((i === endI && j === endJ) || guard++ > cols + grows) break
        i += stepI
        j += stepJ
      }
    }
    return cells
  }

  // 口のすぐ外（接続点から PORT_STUB_ZONE まで）の区間。ここを別の線が横切ると、横切った線がその機器へ
  // つながって見える（電源の幹線が機器の縁すれすれを通り、口から出た線を出た直後に横切っていた）。
  // 電源は先に引くので、まだ引いていない線も、割り当て済みの接続点と辺から位置を取る。
  // 自分の両端の機器の口は対象外（同じ機器から出る線どうしは、接続点の並べ替えと交差補修が受け持つ）
  const PORT_STUB_ZONE = OUT + CLEAR
  /** 折れ線の始点から length までの部分 */
  const polylinePrefix = (points: { x: number; y: number }[], length: number) => {
    const prefix = [points[0]]
    let rest = length
    for (let i = 1; i < points.length && rest > 0; i++) {
      const p = points[i - 1], q = points[i]
      const d = Math.abs(q.x - p.x) + Math.abs(q.y - p.y)
      if (d <= rest) { prefix.push(q); rest -= d; continue }
      const t = rest / d
      prefix.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
      rest = 0
    }
    return prefix
  }
  const portStubSegments = (self: MapConnection, own: Set<string>): RouteSegment[] => {
    const stubs: RouteSegment[] = []
    for (const other of routableEdges) {
      if (other.id === self.id || other.id.startsWith('pair-') || other.cableType === 'WiFi') continue
      for (const nodeId of [other.fromGadgetId, other.toGadgetId]) {
        if (own.has(nodeId)) continue
        const p = cp.get(other.id + '@' + nodeId)
        const side = sideMap.get(other.id + '@' + nodeId)
        if (!p || !side) continue
        const q = side === 'top' ? { x: p.x, y: p.y - PORT_STUB_ZONE }
          : side === 'bottom' ? { x: p.x, y: p.y + PORT_STUB_ZONE }
          : side === 'left' ? { x: p.x - PORT_STUB_ZONE, y: p.y }
          : { x: p.x + PORT_STUB_ZONE, y: p.y }
        stubs.push(...routeSegments([p, q]))
      }
    }
    return stubs
  }

  // settled を渡すと、引き終えた経路 settled と外側レーン候補だけを比べる（後処理で使う）。
  // 置き換えないときは settled をそのまま返す
  const routeEdge = async (
    c: MapConnection, settled?: { x: number; y: number }[],
  ): Promise<{ a: MapNode; b: MapNode; points: { x: number; y: number }[] }> => {
    const a = nodeById.get(c.fromGadgetId)!, b = nodeById.get(c.toGadgetId)!
    const foreignStubs = portStubSegments(c, new Set([a.id, b.id]))
    // 逆向きも数える。あとから引く線が、自分の口のすぐ外で引き終えた線を横切る場合
    // （先に引いた電源の幹線を、口から出た直後に横切る）
    const routedAwayFrom = (nodeId: string) => routedForSelection
      .filter((route) => !route.nodeIds.has(nodeId))
      .flatMap((route) => route.segments)
    const routedAwayFromA = routedAwayFrom(a.id)
    const routedAwayFromB = routedAwayFrom(b.id)
    const portCrossingsOf = (points: { x: number; y: number }[]) =>
      (foreignStubs.length ? countSegmentCrossings(routeSegments(points), foreignStubs) : 0) +
      countSegmentCrossings(routeSegments(polylinePrefix(points, PORT_STUB_ZONE)), routedAwayFromA) +
      countSegmentCrossings(routeSegments(polylinePrefix([...points].reverse(), PORT_STUB_ZONE)), routedAwayFromB)
    // 後処理用。portCrossingsOf は同じ機器から出る線どうしを数えず（交差補修が受け持つ）、
    // 短い線では1件の交差を両端の口で2回数える。後処理は交差補修より後なので前者は誰も直さず、
    // 後者は 36px の直線を2曲がりのコの字へ替えていた。交差1件につき、どちらかの線の口から
    // PORT_STUB_ZONE 以内なら1回だけ数える
    const settledPortCrossingsOf = (points: { x: number; y: number }[]) => {
      const ends = [points[0], points[points.length - 1]]
      const nearPort = (p: { x: number; y: number }, terminals: { x: number; y: number }[]) =>
        terminals.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < PORT_STUB_ZONE)
      let count = 0
      for (const route of routedForSelection) {
        const terminals = [...ends, ...route.terminals.values()]
        for (const own of routeSegments(points)) {
          for (const other of route.segments) {
            if (own.horiz === other.horiz) continue
            const h = own.horiz ? own : other, v = own.horiz ? other : own
            if (segmentsCross(h, v) && nearPort({ x: v.x0, y: h.y0 }, terminals)) count++
          }
        }
      }
      return count
    }
    const cpa = cp.get(c.id + '@' + a.id) ?? { x: a.cx, y: a.y + a.h }
    const cpb = cp.get(c.id + '@' + b.id) ?? { x: b.cx, y: b.y + b.h }
    const sa = sideMap.get(c.id + '@' + a.id) ?? 'bottom'
    const sb = sideMap.get(c.id + '@' + b.id) ?? 'top'
    // 枝は分岐元の接続点を共有するのが目的なので、そちら側の端点はスライドさせない
    const pinnedA = balancedFanoutNodes.has(a.id) || branchKeyAt(c.id, a.id) !== null
    const pinnedB = balancedFanoutNodes.has(b.id) || branchKeyAt(c.id, b.id) !== null
    const slideA = pinnedA ? fixedSlideRange(cpa, sa) : cpSlideRange(c.id, a, sa)
    const slideB = pinnedB ? fixedSlideRange(cpb, sb) : cpSlideRange(c.id, b, sb)
    const branchStripId = powerBranchStripId(c)
    const protectedSegments = branchStripId ? protectedPowerTrunks.get(branchStripId) : undefined
    const protectedCells = protectedSegments && branchStripId
      ? protectedCellsNear(protectedTrunkPoints.get(branchStripId) ?? [])
      : undefined
    const crossesProtectedTrunk = (points: { x: number; y: number }[]) =>
      !!protectedSegments && conflictsWithPowerTrunk(points, protectedSegments)
    // ① 主候補の辺で直線／L字
    let primary = settled ? null : routeDirectBothWays(cpa, sa, cpb, sb, a, b, slideA, slideB)
    // 曲がる配線で、その面を使う線が1本だけなら接続点を辺中央へ戻す。
    // 複数線の面だけはファンアウト位置を維持する。
    if (primary && routeBends(primary) > 0) {
      const keyA = c.id + '@' + a.id
      const keyB = c.id + '@' + b.id
      // ファンアウトの本数は初期割り当てのままなので、代替辺の探索で別の配線が
      // 後からこの辺へ移っていることがある。中央が埋まっているなら戻さない。
      const singleA = !pinnedA && fanoutSlots.get(keyA)?.keys.length === 1 &&
        !terminalOccupiedAt(a.id, centerCpOf(a, sa), c.id)
      const singleB = !pinnedB && fanoutSlots.get(keyB)?.keys.length === 1 &&
        !terminalOccupiedAt(b.id, centerCpOf(b, sb), c.id)
      if (singleA || singleB) {
        const midA = singleA ? centerCpOf(a, sa) : cpa
        const midB = singleB ? centerCpOf(b, sb) : cpb
        const centered = routeDirectBothWays(
          midA, sa, midB, sb, a, b,
          singleA ? fixedSlideRange(midA, sa) : slideA,
          singleB ? fixedSlideRange(midB, sb) : slideB,
        )
        // 中央へ寄せた経路が障害物で成立しない場合、既に見つかっている経路を捨てない。
        // null で上書きすると不要な A* 迂回へ進み、配線長と曲がりが増えていた。
        if (centered) primary = centered
      }
    }
    // 0曲がりは改善余地がないため、そのまま確定する。
    // 早期確定でも、別ポートの配線と同じ接続点に重なる経路は採用しない
    // （この分岐は候補探索の重複チェックを通らないため、ここで同じ判定をする）。
    if (primary && routeBends(primary) === 0 && !crossesProtectedTrunk(primary) && portCrossingsOf(primary) === 0 &&
        terminalStubsAreUprightForSides(primary, sa, sb) &&
        !terminalOccupiedAt(a.id, primary[0], c.id) &&
        !terminalOccupiedAt(b.id, primary[primary.length - 1], c.id)) {
      if (!pinnedA) cp.set(c.id + '@' + a.id, { ...primary[0] })
      if (!pinnedB) cp.set(c.id + '@' + b.id, { ...primary[primary.length - 1] })
      return { a, b, points: primary }
    }

    type RouteChoice = {
      points: { x: number; y: number }[]
      sa: Side
      sb: Side
      readability: RouteReadability
      /** 通常条件では経路が引けず、作法を緩めて採用した経路（接続点の固定も解除する） */
      rescue?: boolean
    }
    const bestRef: { current: RouteChoice | null } = { current: null }
    const fallbackRef: { current: RouteChoice | null } = { current: null }
    // 後処理では、同じ機器から出る線との交差を相手ごとに増やさない。同じ機器の線どうしは
    // 交差させない約束で、それを直す交差補修はもう終わっている。合算点だけで比べると、
    // 曲がりと長さが減る代わりに同じ機器の線と交差する経路が通ってしまう
    const settledSiblings = settled
      ? routedForSelection.filter((route) => route.nodeIds.has(a.id) || route.nodeIds.has(b.id))
      : []
    const settledSiblingCrossings = settled
      ? settledSiblings.map((route) => countSegmentCrossings(routeSegments(settled), route.segments))
      : []
    const addsSiblingCrossing = (points: { x: number; y: number }[]) => {
      const segments = routeSegments(points)
      return settledSiblings.some((route, i) => countSegmentCrossings(segments, route.segments) > settledSiblingCrossings[i])
    }
    // rescue: 通常条件では1本も経路が引けなかった配線の最終探索。
    // 「線を描かない」ことだけは避けるため、見た目の作法（接続点を辺中央へ・
    // 電源幹線を跨がない・他配線と接続点を共有しない）は緩めて通路を優先する。
    const consider = (
      points: { x: number; y: number }[] | null, sa2: Side, sb2: Side,
      clearance = CLEAR, rescue = false,
    ) => {
      if (!points) return
      if (!terminalStubsAreUprightForSides(points, sa2, sb2)) {
        const own = new Set([a.id, b.id])
        const startStretched = stretchStubOneEnd(points, own)
        const startExtended = extendStubWithDoglegOneEnd(startStretched, own)
        const endStretched = stretchStubOneEnd([...startExtended].reverse(), own).reverse()
        const stretched = extendStubWithDoglegOneEnd([...endStretched].reverse(), own).reverse()
        if (terminalStubsAreUprightForSides(stretched, sa2, sb2) && routeClearsNodes(stretched, a, b, clearance)) {
          points = stretched
        }
      }
      // 途中区間が自分の端点ノードを貫通する候補は不採用（外側レーン候補などで起こりうる）
      if (!routeClearsNodes(points, a, b, clearance)) return
      if (!rescue && crossesProtectedTrunk(points)) return
      if (settled && addsSiblingCrossing(points)) return
      // 別ポートの配線を候補探索で同じ接続点へ再移動させない。PAVAで確保した
      // ファンアウト間隔がここで失われると、端の足は後段のレーン分割対象外なので重なる。
      if (!rescue && (
        terminalOccupiedAt(a.id, points[0], c.id) ||
        terminalOccupiedAt(b.id, points[points.length - 1], c.id)
      )) return
      if (!rescue && routeBends(points) > 0) {
        // 中央が別ポートに使われている辺では「1本だけなら中央へ」を適用しない
        const singleA = !pinnedA && sideUseCount(c.id, a, sa2) === 1 &&
          !terminalOccupiedAt(a.id, centerCpOf(a, sa2), c.id)
        const singleB = !pinnedB && sideUseCount(c.id, b, sb2) === 1 &&
          !terminalOccupiedAt(b.id, centerCpOf(b, sb2), c.id)
        if ((singleA && !isSideCenter(points[0], a, sa2)) ||
            (singleB && !isSideCenter(points[points.length - 1], b, sb2))) return
      }
      const siblingSegments = routedForSelection
        .filter((route) => route.nodeIds.has(a.id) || route.nodeIds.has(b.id))
        .map((route) => route.segments)
      const readability = readabilityOf(
        points,
        routedForSelection.map((route) => route.segments),
        siblingSegments,
      )
      readability.cornerPenalty =
        cornerHugPenalty(points[0], a, sa2) +
        cornerHugPenalty(points[points.length - 1], b, sb2)
      readability.wrapPenalty = wrapAroundPenalty(a, b, sa2) + wrapAroundPenalty(b, a, sb2)
      readability.portCrossings = settled ? settledPortCrossingsOf(points) : portCrossingsOf(points)
      const target = terminalStubsAreUprightForSides(points, sa2, sb2) ? bestRef : fallbackRef
      const current = target.current
      if (!current || (settled ? settledRouteBetter(readability, current.readability) : compareReadability(readability, current.readability) < 0)) {
        target.current = { points, sa: sa2, sb: sb2, readability, rescue }
      }
    }
    const commitChoice = (best: RouteChoice) => {
      sideMap.set(c.id + '@' + a.id, best.sa)
      sideMap.set(c.id + '@' + b.id, best.sb)
      pairSides.set(c.id, [best.sa, best.sb])
      if (!pinnedA || best.rescue) cp.set(c.id + '@' + a.id, { ...best.points[0] })
      if (!pinnedB || best.rescue) cp.set(c.id + '@' + b.id, { ...best.points[best.points.length - 1] })
      if (best.sa !== sa) setEndpointSide(c.id, a, sa, best.sa)
      if (best.sb !== sb) setEndpointSide(c.id, b, sb, best.sb)
      return { a, b, points: best.points }
    }

    if (settled) {
      // 今の経路が作法の判定を通らないなら、比べる基準が無いので触らない。
      // 12px 未満で並走している線も触らない。後段の並走レーン分割が束ごと広げ、そのついでに
      // 交差も減らすが、先に1本だけ外へ逃がすと束が崩れてそれが働かない（交差が2件残った）
      consider(settled, sa, sb)
      if (bestRef.current?.points !== settled) return { a, b, points: settled }
      if (bestRef.current.readability.overlap > 0.5) return { a, b, points: settled }
      const others = routedForSelection.flatMap((route) => route.segments)
      for (const side of ['top', 'bottom', 'left', 'right'] as Side[]) {
        const pause = pauseIfNeeded()
        if (pause) await pause
        if ((pinnedA && side !== sa) || (pinnedB && side !== sb)) continue
        const pointsA = pinnedA ? [cpa] : altCpCandidates(c.id, a, side)
        const pointsB = pinnedB ? [cpb] : altCpCandidates(c.id, b, side)
        if (side === sa && !pinnedA) pointsA.unshift(cpa)
        if (side === sb && !pinnedB) pointsB.unshift(cpb)
        const singleA = !pinnedA && sideUseCount(c.id, a, side) === 1 &&
          !terminalOccupiedAt(a.id, centerCpOf(a, side), c.id)
        const singleB = !pinnedB && sideUseCount(c.id, b, side) === 1 &&
          !terminalOccupiedAt(b.id, centerCpOf(b, side), c.id)
        const midpointRule = (pa: { x: number; y: number }, pb: { x: number; y: number }) =>
          (!singleA || isSideCenter(pa, a, side)) && (!singleB || isSideCenter(pb, b, side))
        for (const { pa, pb } of endpointPairs(pointsA, pointsB, midpointRule)) {
          consider(routeOuterLane(pa, side, pb, side, a, b, false, others), side, side)
          consider(routeOuterLane(pa, side, pb, side, a, b, true, others), side, side)
        }
      }
      // 今の経路の途中の折れを近道でまとめた形。最後の短絡でも同じ近道を取るが、ここで比べる
      // 候補に入れておかないと、短絡すれば3曲がりになる経路を、4曲がりの別経路に先に
      // 置き換えてしまう（短絡の効かない形になり、曲がりが1つ多いまま残っていた）。
      // 最後の短絡と同じく、交差も口元の交差も1件も増やさない
      const othersForShortcut = routedForSelection.flatMap((route) => route.segments)
      const settledCrossings = countSegmentCrossings(routeSegments(settled), othersForShortcut)
      const settledPorts = settledPortCrossingsOf(settled)
      const considerShortcut = (points: { x: number; y: number }[]) => {
        if (countSegmentCrossings(routeSegments(points), othersForShortcut) > settledCrossings) return
        if (settledPortCrossingsOf(points) > settledPorts) return
        consider(points, sa, sb)
      }
      for (let from = 0; from < settled.length - 2; from++) {
        const pause = pauseIfNeeded()
        if (pause) await pause
        for (let to = from + 2; to < settled.length; to++) {
          const start = settled[from], end = settled[to]
          const bridges: { x: number; y: number }[][] = Math.abs(start.x - end.x) < 0.5 || Math.abs(start.y - end.y) < 0.5
            ? [[]]
            : [[{ x: start.x, y: end.y }], [{ x: end.x, y: start.y }]]
          if (to - from >= 3) {
            const middle = settled.slice(from + 1, to)
            for (const x of new Set([...middle.map((point) => point.x), (start.x + end.x) / 2])) {
              bridges.push([{ x, y: start.y }, { x, y: end.y }])
            }
            for (const y of new Set([...middle.map((point) => point.y), (start.y + end.y) / 2])) {
              bridges.push([{ x: start.x, y }, { x: end.x, y }])
            }
          }
          for (const bridge of bridges) {
            considerShortcut(simplify([...settled.slice(0, from + 1), ...bridge, ...settled.slice(to)]))
          }
        }
      }
      // 機器の辺のすぐ外へ角の向こうから横に滑り込み、その辺に刺さる線（ライトの下辺に入っていた形）。
      // 滑り込む手前の線をそのまま伸ばせば隣の辺へ横から入れて、曲がりが1つ減る。
      // 引いている最中はまだ見えない形なので、引き終えた経路から作る
      for (const atA of [true, false]) {
        const pause = pauseIfNeeded()
        if (pause) await pause
        if (atA ? pinnedA : pinnedB) continue
        const n = atA ? a : b
        const pts = atA ? settled : [...settled].reverse()
        if (pts.length < 4) continue
        const [q0, q1, q2, q3] = pts
        const face = atA ? sa : sb
        const alongX = face === 'top' || face === 'bottom'
        const turnsAtFace = alongX
          ? Math.abs(q1.x - q0.x) < 0.5 && Math.abs(q2.y - q1.y) < 0.5 && Math.abs(q3.x - q2.x) < 0.5
          : Math.abs(q1.y - q0.y) < 0.5 && Math.abs(q2.x - q1.x) < 0.5 && Math.abs(q3.y - q2.y) < 0.5
        if (!turnsAtFace) continue
        const pastCorner = alongX ? q2.x < n.x || q2.x > n.x + n.w : q2.y < n.y || q2.y > n.y + n.h
        const fromOutside = face === 'bottom' ? q3.y > q2.y : face === 'top' ? q3.y < q2.y
          : face === 'left' ? q3.x < q2.x : q3.x > q2.x
        if (!pastCorner || !fromOutside) continue
        const next: Side = alongX ? (q2.x < n.x ? 'left' : 'right') : (q2.y < n.y ? 'top' : 'bottom')
        for (const entry of [centerCpOf(n, next), ...altCpCandidates(c.id, n, next)]) {
          const corner = alongX ? { x: q2.x, y: entry.y } : { x: entry.x, y: q2.y }
          const tail = simplify([entry, corner, ...pts.slice(3)])
          consider(atA ? tail : [...tail].reverse(), atA ? next : sa, atA ? sb : next)
        }
      }
      const chosen = bestRef.current
      return chosen.points === settled ? { a, b, points: settled } : commitChoice(chosen)
    }

    consider(primary, sa, sb)

    // 向かい合う面どうしは、面の全幅で直線を探す。計画上の接続点の並び（fanoutSlots）は初期の
    // 目安でしかなく、それで範囲を狭めると、脇に通り道が空いていても直線を逃して両端で折れる
    // （ゲーミングのデモの 電源タップ→モニター は、真ん中の区間がすでに通り道を通っているのに、
    // モニター下面の計画上の HDMI の位置に押されて両端に小さな折り返しが付いていた）。
    // 最低間隔は、確定済みの配線の端点とだけ取る
    const facingRanges = (n: MapNode, side: Side): SlideRange[] => {
      const horizontal = side === 'top' || side === 'bottom'
      const onFace = (t: { x: number; y: number }) =>
        side === 'top' ? Math.abs(t.y - n.y) < 0.5
        : side === 'bottom' ? Math.abs(t.y - (n.y + n.h)) < 0.5
        : side === 'left' ? Math.abs(t.x - n.x) < 0.5
        : Math.abs(t.x - (n.x + n.w)) < 0.5
      const taken = routedForSelection
        .flatMap((route) => route.edgeId === c.id ? [] : [route.terminals.get(n.id)])
        .filter((t): t is { x: number; y: number } => !!t && onFace(t))
        .map((t) => (horizontal ? t.x : t.y))
      let ranges: SlideRange[] = [{
        lo: (horizontal ? n.x : n.y) + CP_CORNER_MARGIN,
        hi: (horizontal ? n.x + n.w : n.y + n.h) - CP_CORNER_MARGIN,
      }]
      for (const coord of taken) {
        ranges = ranges.flatMap((r) => {
          const cut0 = coord - MIN_CP_STEP, cut1 = coord + MIN_CP_STEP
          if (cut1 < r.lo || cut0 > r.hi) return [r]
          return [...(cut0 > r.lo ? [{ lo: r.lo, hi: cut0 }] : []), ...(cut1 < r.hi ? [{ lo: cut1, hi: r.hi }] : [])]
        })
      }
      return ranges
    }
    const facingPairs: [Side, Side][] = []
    if (a.y + a.h <= b.y) facingPairs.push(['bottom', 'top'])
    if (b.y + b.h <= a.y) facingPairs.push(['top', 'bottom'])
    if (a.x + a.w <= b.x) facingPairs.push(['right', 'left'])
    if (b.x + b.w <= a.x) facingPairs.push(['left', 'right'])
    for (const [sa2, sb2] of facingPairs) {
      if ((pinnedA && sa2 !== sa) || (pinnedB && sb2 !== sb)) continue
      const rangesA = pinnedA ? [fixedSlideRange(cpa, sa2)] : facingRanges(a, sa2)
      const rangesB = pinnedB ? [fixedSlideRange(cpb, sb2)] : facingRanges(b, sb2)
      for (const ra of rangesA) {
        for (const rb of rangesB) {
          const straight = routeDirect(centerCpOf(a, sa2), sa2, centerCpOf(b, sb2), sb2, a, b, ra, rb)
          if (straight && routeBends(straight) === 0) consider(straight, sa2, sb2)
        }
      }
    }

    const allSides: Side[] = ['top', 'bottom', 'left', 'right']
    const sidePairs: [Side, Side][] = []
    const pairKeys = new Set<string>()
    const addPair = ([sa2, sb2]: [Side, Side]) => {
      const key = sa2 + ':' + sb2
      if (pairKeys.has(key)) return
      pairKeys.add(key)
      sidePairs.push([sa2, sb2])
    }
    addPair([sa, sb])
    altSidePairs(a, b, sa, sb).forEach(addPair)
    allSides.forEach((sa2) => allSides.forEach((sb2) => addPair([sa2, sb2])))
    // 高次数ノードは4辺への均等ファンアウトを保つ
    const allowedSidePairs = sidePairs.filter(([sa2, sb2]) =>
      (!pinnedA || sa2 === sa) && (!pinnedB || sb2 === sb))

    const gridJobs: {
      pa: { x: number; y: number }; pb: { x: number; y: number }
      sa: Side; sb: Side; lowerBound: number; distance: number; primary: boolean; midpointCompliant: boolean
    }[] = []

    for (const [sa2, sb2] of allowedSidePairs) {
      const aHorizontal = sa2 === 'top' || sa2 === 'bottom'
      const bHorizontal = sb2 === 'top' || sb2 === 'bottom'
      const preferredA = aHorizontal !== bHorizontal ? outsideCoord(b, sb2) : undefined
      const preferredB = aHorizontal !== bHorizontal ? outsideCoord(a, sa2) : undefined
      const pointsA = pinnedA ? [cpa] : altCpCandidates(c.id, a, sa2, preferredA)
      const pointsB = pinnedB ? [cpb] : altCpCandidates(c.id, b, sb2, preferredB)
      if (sa2 === sa && sb2 === sb) {
        if (!pinnedA) pointsA.unshift(cpa)
        if (!pinnedB) pointsB.unshift(cpb)
      }
      const singleA = !pinnedA && sideUseCount(c.id, a, sa2) === 1 &&
        !terminalOccupiedAt(a.id, centerCpOf(a, sa2), c.id)
      const singleB = !pinnedB && sideUseCount(c.id, b, sb2) === 1 &&
        !terminalOccupiedAt(b.id, centerCpOf(b, sb2), c.id)
      const midpointRule = (pa: { x: number; y: number }, pb: { x: number; y: number }) =>
        (!singleA || isSideCenter(pa, a, sa2)) && (!singleB || isSideCenter(pb, b, sb2))
      for (const { pa, pb, distance, midpointCompliant } of endpointPairs(pointsA, pointsB, midpointRule)) {
        consider(routeDirectBothWays(
          pa, sa2, pb, sb2, a, b,
          fixedSlideRange(pa, sa2), fixedSlideRange(pb, sb2),
        ), sa2, sb2)
        consider(routeOuterLane(pa, sa2, pb, sb2, a, b), sa2, sb2)
        consider(routeOuterLane(pa, sa2, pb, sb2, a, b, true), sa2, sb2)
        gridJobs.push({
          pa, pb, sa: sa2, sb: sb2,
          lowerBound: sidePairBendLowerBound(sa2, sb2), distance,
          primary: sa2 === sa && sb2 === sb && pa === cpa && pb === cpb,
          midpointCompliant,
        })
      }
    }

    // A*は曲がり下限が現在解以下の候補だけに限定し、優先度上位8件を比較する。
    const bestBends = bestRef.current ? routeBends(bestRef.current.points) : Infinity
    const bestGridJobByPair = new Map<string, typeof gridJobs[number]>()
    for (const job of gridJobs) {
      const key = job.sa + ':' + job.sb
      const current = bestGridJobByPair.get(key)
      if (!current ||
          (job.midpointCompliant && !current.midpointCompliant) ||
          (job.midpointCompliant === current.midpointCompliant &&
            (job.primary || (!current.primary && job.distance < current.distance)))) {
        bestGridJobByPair.set(key, job)
      }
    }
    const promising = [...bestGridJobByPair.values()]
      .filter((job) => job.lowerBound <= bestBends)
      .sort((x, y) => x.lowerBound - y.lowerBound ||
        Number(y.midpointCompliant) - Number(x.midpointCompliant) ||
        Number(y.primary) - Number(x.primary) || x.distance - y.distance)
      .slice(0, 8)
    for (const job of promising) {
      consider(await routeBetween(job.pa, job.sa, a, job.pb, job.sb, b, protectedCells), job.sa, job.sb)
    }
    // 通常予算で経路が見つからなかった配線だけ探索上限を緩める。
    if (!bestRef.current) {
      for (const job of promising) {
        consider(await routeBetween(job.pa, job.sa, a, job.pb, job.sb, b, protectedCells, 40000), job.sa, job.sb)
        if (bestRef.current) break
      }
    }
    // 下限評価で落とした辺組合せしか通れない配置もある。未描画にする前に、
    // その配線だけ全候補を探索する（通常ケースの計算量には影響しない）。
    if (!bestRef.current) {
      for (const job of gridJobs) {
        consider(await routeBetween(job.pa, job.sa, a, job.pb, job.sb, b, protectedCells, 40000), job.sa, job.sb)
        if (bestRef.current) break
      }
    }
    // 通常の余白では通路が無い場合（ドラッグでノードが密集した構成など）は、
    // 余白を詰めた予備グリッドで引き直す。ノードの中は通さないので貫通は起きない。
    if (!bestRef.current && !fallbackRef.current) {
      // 接続点の固定（均等ファンアウト）も解除する。固定点が他ノードの内側に
      // 埋まっている場合、そこからはどう引いても貫通するため。
      for (const [sa2, sb2] of sidePairs) {
        const pointsA = [...altCpCandidates(c.id, a, sa2), centerCpOf(a, sa2), cpa]
        const pointsB = [...altCpCandidates(c.id, b, sb2), centerCpOf(b, sb2), cpb]
        for (const { pa, pb } of endpointPairs(pointsA, pointsB, () => true, 6)) {
          consider(
            await routeBetween(pa, sa2, a, pb, sb2, b, undefined, 40000, rescueGrid(), RESCUE_CLEAR),
            sa2, sb2, RESCUE_CLEAR, true,
          )
          if (bestRef.current) break
        }
        if (bestRef.current) break
      }
    }

    const best = bestRef.current ?? fallbackRef.current
    // グリッドA*でも通路が見つからない配線の最終手段。グリッド（16〜24px刻み）は
    // ノードの隙間が刻み幅より狭いと通路を見落とすため、ノードの辺から作った
    // レーン座標の上で直接コの字を組み立てる。貫通しない候補だけを採用する。
    if (!best) {
      const laneOffset = RESCUE_CLEAR + 2
      const xLaneBase = nodes.flatMap((n) => [n.x - laneOffset, n.x + n.w + laneOffset])
      const yLaneBase = nodes.flatMap((n) => [n.y - laneOffset, n.y + n.h + laneOffset])
      type LaneChoice = {
        points: { x: number; y: number }[]
        sa: Side; sb: Side
        pa: { x: number; y: number }; pb: { x: number; y: number }
      }
      // 逃げレーンは相手ノードの反対側へ回ることがある。そのとき割り当て済みの辺だけで
      // 閉じようとすると、最後の足が内向きに折り返し、simplify がそれを1本の直線へ潰して
      // 相手ノードを突き抜けた線になる（＝辺の反対側へ刺さって見える）。
      // 辺の組み合わせも候補に含め、レーンの側にある辺で受けられるようにする。
      const laneSidePairs: [Side, Side][] = []
      const laneSideKeys = new Set<string>()
      const addLanePair = (s1: Side, s2: Side) => {
        if (pinnedA && s1 !== sa) return
        if (pinnedB && s2 !== sb) return
        const key = s1 + ':' + s2
        if (laneSideKeys.has(key)) return
        laneSideKeys.add(key)
        laneSidePairs.push([s1, s2])
      }
      addLanePair(sa, sb)
      allSides.forEach((s1) => allSides.forEach((s2) => addLanePair(s1, s2)))
      const candidates: LaneChoice[] = []
      for (const [sa2, sb2] of laneSidePairs) {
        const pa = sa2 === sa ? cpa : centerCpOf(a, sa2)
        const pb = sb2 === sb ? cpb : centerCpOf(b, sb2)
        const [ax, ay] = nrm(sa2), [bx, by] = nrm(sb2)
        const ea = { x: pa.x + ax * OUT, y: pa.y + ay * OUT }
        const eb = { x: pb.x + bx * OUT, y: pb.y + by * OUT }
        for (const x of [ea.x, eb.x, ...xLaneBase]) {
          candidates.push({ points: simplify([pa, ea, { x, y: ea.y }, { x, y: eb.y }, eb, pb]), sa: sa2, sb: sb2, pa, pb })
        }
        for (const y of [ea.y, eb.y, ...yLaneBase]) {
          candidates.push({ points: simplify([pa, ea, { x: ea.x, y }, { x: eb.x, y }, eb, pb]), sa: sa2, sb: sb2, pa, pb })
        }
      }
      // 元の辺の組み合わせを優先し、同点なら曲がりが少なく短いものを採る
      const laneRank = (choice: LaneChoice) => (choice.sa === sa && choice.sb === sb ? 0 : 1)
      let rescuedChoice: LaneChoice | null = null
      for (const candidate of candidates) {
        if (!routeClearsNodes(candidate.points, a, b, RESCUE_CLEAR)) continue
        if (!terminalStubsAreUprightForSides(candidate.points, candidate.sa, candidate.sb)) continue
        if (!rescuedChoice ||
            laneRank(candidate) < laneRank(rescuedChoice) ||
            (laneRank(candidate) === laneRank(rescuedChoice) &&
              (routeBends(candidate.points) < routeBends(rescuedChoice.points) ||
                (routeBends(candidate.points) === routeBends(rescuedChoice.points) &&
                  routeLength(candidate.points) < routeLength(rescuedChoice.points))))) {
          rescuedChoice = candidate
        }
      }
      let rescued: { x: number; y: number }[] | null = rescuedChoice?.points ?? null
      // 別の辺で受けたときは、接続点・辺の登録も合わせておく。
      // ここを更新しないと後段のレーン分割・ファンアウトが古い辺のまま計算される。
      if (rescuedChoice && (rescuedChoice.sa !== sa || rescuedChoice.sb !== sb)) {
        if (!pinnedA && rescuedChoice.sa !== sa) {
          cp.set(c.id + '@' + a.id, { ...rescued![0] })
          sideMap.set(c.id + '@' + a.id, rescuedChoice.sa)
          setEndpointSide(c.id, a, sa, rescuedChoice.sa)
        }
        if (!pinnedB && rescuedChoice.sb !== sb) {
          cp.set(c.id + '@' + b.id, { ...rescued![rescued!.length - 1] })
          sideMap.set(c.id + '@' + b.id, rescuedChoice.sb)
          setEndpointSide(c.id, b, sb, rescuedChoice.sb)
        }
      }
      // ノード同士が重なっていて隙間が1つも無い構成だけがここへ来る。線を描かないと
      // 「繋がっていない」と読めてしまうため、貫通が最も少ない形で描く。重なった状態では
      // 元の辺の選択（相手と反対を向く辺など）が意味を持たないので、相手の方を向く辺へ付け替える。
      if (!rescued) {
        const piercedNodeCount = (pts: { x: number; y: number }[]) => {
          let count = 0
          for (let i = 0; i < pts.length - 1; i++) {
            for (const n of nodes) if (segEntersNode(pts[i], pts[i + 1], n)) count++
          }
          return count
        }
        const facingSide = (from: MapNode, to: MapNode): Side => {
          const dx = to.cx - from.cx, dy = to.cy - from.cy
          return Math.abs(dx) >= Math.abs(dy)
            ? (dx >= 0 ? 'right' : 'left')
            : (dy >= 0 ? 'bottom' : 'top')
        }
        // 同じ2台を複数のケーブルで結ぶ構成では、どちらもここへ来て同じ辺の中点を取り、
        // 接続点も経路も完全に一致して1本に見える。中点が埋まっていれば辺に沿ってずらす。
        const freeCenterCp = (n: MapNode, s: Side) => {
          const base = centerCpOf(n, s)
          const horizontal = s === 'top' || s === 'bottom'
          const lo = (horizontal ? n.x : n.y) + CP_CORNER_MARGIN
          const hi = (horizontal ? n.x + n.w : n.y + n.h) - CP_CORNER_MARGIN
          for (const delta of [0, 12, -12, 24, -24, 36, -36]) {
            const coord = (horizontal ? base.x : base.y) + delta
            if (coord < lo || coord > hi) continue
            const candidate = horizontal ? { x: coord, y: base.y } : { x: base.x, y: coord }
            if (!terminalOccupiedAt(n.id, candidate)) return candidate
          }
          return base
        }
        const fa = pinnedA ? sa : facingSide(a, b)
        const fb = pinnedB ? sb : facingSide(b, a)
        const pa = pinnedA ? cpa : freeCenterCp(a, fa)
        const pb = pinnedB ? cpb : freeCenterCp(b, fb)
        const [fax, fay] = nrm(fa), [fbx, fby] = nrm(fb)
        const oa = { x: pa.x + fax * OUT, y: pa.y + fay * OUT }
        const ob = { x: pb.x + fbx * OUT, y: pb.y + fby * OUT }
        const facingCandidates: LaneChoice[] = [
          simplify([pa, oa, { x: oa.x, y: ob.y }, ob, pb]),
          simplify([pa, oa, { x: ob.x, y: oa.y }, ob, pb]),
        ].map((points) => ({ points, sa: fa, sb: fb, pa, pb }))
        const chosen = [...facingCandidates, ...candidates].sort((p, q) =>
          piercedNodeCount(p.points) - piercedNodeCount(q.points) ||
          routeBends(p.points) - routeBends(q.points) ||
          routeLength(p.points) - routeLength(q.points))[0]
        rescued = chosen.points
        const start = rescued[0], end = rescued[rescued.length - 1]
        if (!pinnedA && Math.abs(start.x - chosen.pa.x) < 0.5 && Math.abs(start.y - chosen.pa.y) < 0.5) {
          cp.set(c.id + '@' + a.id, { ...chosen.pa })
          sideMap.set(c.id + '@' + a.id, chosen.sa)
          if (chosen.sa !== sa) setEndpointSide(c.id, a, sa, chosen.sa)
        }
        if (!pinnedB && Math.abs(end.x - chosen.pb.x) < 0.5 && Math.abs(end.y - chosen.pb.y) < 0.5) {
          cp.set(c.id + '@' + b.id, { ...chosen.pb })
          sideMap.set(c.id + '@' + b.id, chosen.sb)
          if (chosen.sb !== sb) setEndpointSide(c.id, b, sb, chosen.sb)
        }
      }
      return { a, b, points: rescued }
    }

    return commitChoice(best)
  }

  const routeRank = new Map(routableEdges.map((c) => {
      const [aId, bId] = edgeNodeIds.get(c.id)!
      const a = nodeById.get(aId)!, b = nodeById.get(bId)!
      const [sa, sb] = pairSides.get(c.id)!
      const pa = cp.get(c.id + '@' + a.id) ?? centerCpOf(a, sa)
      const pb = cp.get(c.id + '@' + b.id) ?? centerCpOf(b, sb)
      const direct = routeDirectBothWays(
        pa, sa, pb, sb, a, b,
        cpSlideRange(c.id, a, sa), cpSlideRange(c.id, b, sb),
      )
      return [c.id, direct ? routeBends(direct) : 99] as const
    }))
  const protectionRank = (connection: MapConnection) =>
    powerTrunkStripId(connection) ? 0 : powerBranchStripId(connection) ? 1 : 2
  const routingOrder = [...routableEdges].sort((x, y) =>
    protectionRank(x) - protectionRank(y) ||
    routeRank.get(x.id)! - routeRank.get(y.id)! ||
    x.id.localeCompare(y.id))
  const routedById = new Map<string, MapEdge>()
  for (const c of routingOrder) {
    const { a, b, points } = await routeEdge(c)
    markUsed(points)
    routedForSelection.push({
      nodeIds: new Set([a.id, b.id]),
      terminals: new Map([[a.id, points[0]], [b.id, points[points.length - 1]]]),
      segments: routeSegments(points),
      edgeId: c.id,
    })
    routedById.set(c.id, { conn: c, from: a, to: b, points, isPairLink: c.id.startsWith('pair-') })
    const trunkStripId = powerTrunkStripId(c)
    if (trunkStripId) {
      protectedPowerTrunks.set(trunkStripId, routeSegments(points))
      protectedTrunkPoints.set(trunkStripId, points.map((point) => ({ ...point })))
    } else if (powerBranchStripId(c)) {
      protectedBranchPoints.set(c.id, points.map((point) => ({ ...point })))
    }
    const pause = pauseIfNeeded()
    if (pause) await pause
  }
  const layoutEdges: MapEdge[] = routableEdges.map((c) => routedById.get(c.id)!)
  // ── 同じ配線同士が2回以上交差しないよう補修する ──
  // 90°交差そのものは許可されるが、同じ2本が繰り返し交差するのは経路が
  // 不必要に入り組んでいるサインなので、片方を「相手の経路を避ける」制約付きで再ルーティングする。
  const countCrossings = (ptsA: { x: number; y: number }[], ptsB: { x: number; y: number }[]) =>
    countSegmentCrossings(routeSegments(ptsA), routeSegments(ptsB))
  const overlapAgainstOthers = (target: MapEdge, points: { x: number; y: number }[]) => {
    const segments = routeSegments(points)
    let overlap = 0
    for (const other of layoutEdges) {
      if (other === target || other.isPairLink) continue
      overlap += overlappingSegmentLength(segments, routeSegments(other.points))
    }
    return overlap
  }
  const pairOverlapAgainstOthers = (
    first: MapEdge, firstPoints: { x: number; y: number }[],
    second: MapEdge, secondPoints: { x: number; y: number }[],
  ) => {
    const firstSegments = routeSegments(firstPoints)
    const secondSegments = routeSegments(secondPoints)
    let overlap = overlappingSegmentLength(firstSegments, secondSegments)
    for (const other of layoutEdges) {
      if (other === first || other === second || other.isPairLink) continue
      const otherSegments = routeSegments(other.points)
      overlap += overlappingSegmentLength(firstSegments, otherSegments)
      overlap += overlappingSegmentLength(secondSegments, otherSegments)
    }
    return overlap
  }
  const cellsNear = (pts: { x: number; y: number }[]): Set<number> => {
    const set = new Set<number>()
    for (let s = 0; s < pts.length - 1; s++) {
      let i0 = clamp(Math.round((pts[s].x - gox) / G), 0, cols - 1)
      let j0 = clamp(Math.round((pts[s].y - goy) / G), 0, grows - 1)
      const i1 = clamp(Math.round((pts[s + 1].x - gox) / G), 0, cols - 1)
      const j1 = clamp(Math.round((pts[s + 1].y - goy) / G), 0, grows - 1)
      const stepI = Math.sign(i1 - i0), stepJ = Math.sign(j1 - j0)
      let guard = 0
      while (true) {
        set.add(gidx(i0, j0))
        if ((i0 === i1 && j0 === j1) || guard++ > cols + grows) break
        i0 += stepI; j0 += stepJ
      }
    }
    return set
  }

  // 同じガジェットを端点として共有する配線ペア（共有ノードIDを返す）
  // → そのペアは交差 0 回を目指す（それ以外のペアは 2 回以上で補修対象）
  const sharedNodeId = (e1: MapEdge, e2: MapEdge): string | null => {
    const ids1 = [e1.from.id, e1.to.id], ids2 = new Set([e2.from.id, e2.to.id])
    for (const id of ids1) { if (ids2.has(id)) return id }
    return null
  }

  // ── 補修フェーズの探索予算 ──────────────────────────────────
  // edgePops（routeCells の探索節点数）のリセットは markUsed の中だけにあり、
  // markUsed は「経路を採用したとき」しか呼ばれない。初期ルーティングは全エッジを
  // 採用するので1本ごとに戻るが、補修はほとんどの候補をゲートで却下するため
  // 一度も戻らず、EDGE_POP_BUDGET を超えた時点で routeCells が探索前に null を
  // 返しはじめる（＝そのレイアウトの補修が以降まるごと沈黙する）。
  // 実測ではこれが「経路が見つからない」の87%を占め、到達不能・経路なしは0件だった。
  //   ① 1試行ごとに edgePops を戻し、却下された候補が次の試行の予算を食わないようにする
  //   ② フェーズ単位で予算を持ち、初期ルーティングが使い切った状態を引き継がない
  // 総量は REPAIR_POP_BUDGET で抑えるので、ラッチのような予測不能な停止にはならない。
  const REPAIR_POP_BUDGET = 1_500_000
  let repairPopsSpent = 0
  const beginRepairPhase = () => { repairPopsSpent = 0; edgePops = 0 }
  const beginRepairAttempt = () => {
    if (repairPopsSpent >= REPAIR_POP_BUDGET) return false
    edgePops = 0
    return true
  }
  const endRepairAttempt = () => { repairPopsSpent += edgePops }

  // この配線が「上限を超えて交差している相手」の数。上限はペアごとに決まる
  // （端点を共有するペアは0回、それ以外は1回まで）ので、図全体の交差合計では代用できない。
  // 補修の採否をこれで見ないと、あるペアの交差を消すために別の相手と2回交差する経路が通る。
  const overCrossingPartners = (
    target: MapEdge, points: { x: number; y: number }[], exclude?: MapEdge,
  ) => {
    let count = 0
    for (const other of layoutEdges) {
      if (other === target || other === exclude || other.isPairLink) continue
      const limit = sharedNodeId(target, other) ? 0 : 1
      if (countCrossings(points, other.points) > limit) count++
    }
    return count
  }

  // 指定エッジを「相手の経路周辺を避ける」制約付きで再ルーティングする
  const rerouteAvoiding = async (target: MapEdge, obstacle: MapEdge, forceAvoid: boolean): Promise<{ x: number; y: number }[] | null> => {
    if (!beginRepairAttempt()) return null
    try {
      return await rerouteAvoidingInner(target, obstacle, forceAvoid)
    } finally {
      endRepairAttempt()
    }
  }
  const rerouteAvoidingInner = async (target: MapEdge, obstacle: MapEdge, forceAvoid: boolean): Promise<{ x: number; y: number }[] | null> => {
    const avoid = cellsNear(obstacle.points)
    const sa = sideMap.get(target.conn.id + '@' + target.from.id) ?? 'bottom'
    const sb = sideMap.get(target.conn.id + '@' + target.to.id) ?? 'top'
    const [ax, ay] = nrm(sa), [bx, by] = nrm(sb)
    const cpa = cp.get(target.conn.id + '@' + target.from.id) ?? { x: target.from.cx, y: target.from.y + target.from.h }
    const cpb = cp.get(target.conn.id + '@' + target.to.id) ?? { x: target.to.cx, y: target.to.y + target.to.h }
    const sCell = nearestCell(cpa.x + ax * (CLEAR + G), cpa.y + ay * (CLEAR + G))
    const tCell = nearestCell(cpb.x + bx * (CLEAR + G), cpb.y + by * (CLEAR + G))
    const cells = await routeCells(sCell, tCell, axisOf(sa), axisOf(sb), avoid, forceAvoid ? AVOID_HIGH : AVOID)
    if (!cells || !cells.length) return null
    const gp = cells.map(([gi, gj]) => ({ x: cellX(gi), y: cellY(gj) }))
    const points = absorbTerminalJog(
      simplify([
        cpa, ...stubPts(cpa, sa, gp[0]),
        ...gp,
        ...stubPts(cpb, sb, gp[gp.length - 1]).reverse(), cpb,
      ]),
      new Set([target.from.id, target.to.id]),
    )
    return routeClearsNodes(points, target.from, target.to) ? points : null
  }

  // 他のすべての配線と 12px 未満で並走する長さ。overlapAgainstOthers は同一レーン
  // （0.5px 以内）だけを見るので、辺を替えた線が隣のレーンへ寄って「1本に見える」
  // ケースを取りこぼす。採否の判定には見た目の基準であるこちらを使う。
  const mergedAgainstOthers = (target: MapEdge, points: { x: number; y: number }[]) => {
    const segments = routeSegments(points)
    let merged = 0
    for (const other of layoutEdges) {
      if (other === target || other.isPairLink) continue
      merged += nearbyParallelSegmentLength(segments, routeSegments(other.points), 12)
    }
    return merged
  }
  // この配線が「他のすべての配線」と交差する回数。辺を替えたときに、対象ペアの交差を
  // 消すかわりに別の線と交差し直していないかを見るために使う。
  const crossingsAgainstOthers = (target: MapEdge, points: { x: number; y: number }[]) => {
    const segments = routeSegments(points)
    let total = 0
    for (const other of layoutEdges) {
      if (other === target || other.isPairLink) continue
      total += countSegmentCrossings(segments, routeSegments(other.points))
    }
    return total
  }
  // 同じ軸で「進んで戻ってまた進む」折り返しの回数。障害物を避けた結果でも折り返す線は
  // 読み手に理由が見えないので、補修でこれを増やしてはいけない。曲がりの増加を許す代わりに、
  // 形が崩れていないことをこれで担保する。
  const axisBacktracks = (points: { x: number; y: number }[]) => {
    let total = 0
    for (const horizontal of [true, false]) {
      const signs: number[] = []
      for (let i = 0; i < points.length - 1; i++) {
        const delta = horizontal ? points[i + 1].x - points[i].x : points[i + 1].y - points[i].y
        if (Math.abs(delta) > 0.5) signs.push(Math.sign(delta))
      }
      for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) total++
    }
    return total
  }
  // 替え先の接続点が、同じノード上の他の配線の接続点と最低間隔を保てるか
  const terminalStepFree = (nodeId: string, point: { x: number; y: number }, selfEdgeId: string) => {
    for (const entry of incident.get(nodeId) ?? []) {
      if (entry.eid === selfEdgeId) continue
      const other = cp.get(entry.eid + '@' + nodeId)
      if (!other) continue
      if (Math.hypot(other.x - point.x, other.y - point.y) < MIN_CP_STEP - 0.5) return false
    }
    return true
  }
  // 同じ辺から出る配線は「行き先が右のものほど右から出す」。この順序が崩れると
  // 2本はノードのすぐ外で必ず交差する（端点を共有するペアの交差はこれが原因）。
  const terminalOrderOk = (
    node: MapNode, side: Side, point: { x: number; y: number }, selfEdgeId: string, target: MapNode,
  ) => {
    const horizontal = side === 'top' || side === 'bottom'
    const at = horizontal ? point.x : point.y
    const targetCoord = horizontal ? target.cx : target.cy
    for (const entry of incident.get(node.id) ?? []) {
      if (entry.eid === selfEdgeId) continue
      if (sideMap.get(entry.eid + '@' + node.id) !== side) continue
      const otherCp = cp.get(entry.eid + '@' + node.id)
      const otherNode = nodeById.get(entry.other)
      if (!otherCp || !otherNode) continue
      const otherTargetCoord = horizontal ? otherNode.cx : otherNode.cy
      if (Math.abs(otherTargetCoord - targetCoord) < 0.5) continue
      const otherAt = horizontal ? otherCp.x : otherCp.y
      if (Math.sign(at - otherAt) !== Math.sign(targetCoord - otherTargetCoord)) return false
    }
    return true
  }

  // ── 交差の本当の原因である「出口の辺」を替えて引き直す ──
  // sidePairOf は2ノードだけの幾何（各軸の隙間）で辺を決めており、同じノードから出る
  // 他の配線を見ていない。そのため同じ方向にある2台が別々の辺に振られ、その2本は必ず
  // 交差する。rerouteAvoiding は辺を固定したまま経路をこねるだけなのでこの形は直せず、
  // こねた経路は下のゲート（曲がり・並走）で正しく却下されて交差だけが残っていた。
  // 曲がりは2つまで許すが、折り返し・他線との交差・並走を1つも増やさない場合だけ採用する。
  const SIDE_REPAIR_BEND_ALLOWANCE = 2
  const ALL_SIDES: Side[] = ['top', 'bottom', 'left', 'right']
  let sideRepairBudget = 260
  // 同じ候補の A* を複数パスで引き直さないための memo。routeBetween の結果は
  // ノード位置と通行グリッドだけで決まり、補修中はどちらも変わらないので使い回せる。
  // 失敗する候補（通路が無い＝A* が探索を打ち切るまで回る）が最も重いので効果が大きい。
  const sideRouteMemo = new Map<string, { x: number; y: number }[] | null>()
  // 替え先の接続点候補。辺の中央と既定の代替候補に加え、辺の上を最低間隔で走査して
  // 「中央も代替も既存の接続点で埋まっている」ときに詰まらないようにする。
  const sideCpCandidates = (edgeId: string, node: MapNode, side: Side) => {
    const horizontal = side === 'top' || side === 'bottom'
    const range = freeSlideRange(node, side)
    const all = [centerCpOf(node, side), ...altCpCandidates(edgeId, node, side)]
    for (let coord = range.lo; coord <= range.hi + 0.5; coord += MIN_CP_STEP) {
      all.push(sideCoord(node, side, coord))
    }
    const seen = new Set<string>()
    return all.filter((point) => {
      const key = `${Math.round(horizontal ? point.x : point.y)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 6)
  }
  const trySideRepair = async (target: MapEdge, obstacle: MapEdge, maxAllowed: number): Promise<boolean> => {
    const conn = target.conn
    // 電源系統の幹線は後段で初回探索時の経路へ戻されるので、ここで動かしても無駄になる
    if (powerTrunkStripId(conn) !== null) return false
    const beforeBends = routeBends(target.points)
    const beforeLength = routeLength(target.points)
    const beforeMerged = mergedAgainstOthers(target, target.points)
    const beforeCross = crossingsAgainstOthers(target, target.points)
    const beforeBacktrack = axisBacktracks(target.points)

    // 両端の辺を同時に替えた直線・L字を先に試す。下の片端ずつの付け替えは、残した側の接続点へ
    // 合わせるために端で折り返す（DTM のデモの PC→モニター は、PC 側だけ上面へ替えられ、
    // モニター下面の角へ折り返して刺さっていた。両端を替えれば右側面へ1曲がりで入れる）。
    // A* を使わない判定済みの形だけなので、候補が多くても軽い
    const fixedEnd = (node: MapNode) => balancedFanoutNodes.has(node.id) || branchKeyAt(conn.id, node.id) !== null
    const fromSide = sideMap.get(conn.id + '@' + target.from.id)
    const toSide = sideMap.get(conn.id + '@' + target.to.id)
    const fromCp = cp.get(conn.id + '@' + target.from.id)
    const toCp = cp.get(conn.id + '@' + target.to.id)
    if (fromSide && toSide && fromCp && toCp) {
      let bestDirect: { points: { x: number; y: number }[]; sa: Side; sb: Side; centerPenalty: number } | null = null
      const singleSideOffset = (node: MapNode, side: Side, point: { x: number; y: number }) => {
        if (fixedEnd(node) || sideUseCount(conn.id, node, side) !== 1) return 0
        const center = centerCpOf(node, side)
        if (!terminalStepFree(node.id, center, conn.id)) return 0
        return Math.abs(point.x - center.x) + Math.abs(point.y - center.y)
      }
      const startSides: Side[] = fixedEnd(target.from) ? [fromSide] : ALL_SIDES
      const endSides: Side[] = fixedEnd(target.to) ? [toSide] : ALL_SIDES
      for (const sa2 of startSides) {
        for (const sb2 of endSides) {
          const pause = pauseIfNeeded()
          if (pause) await pause
          if (sa2 === fromSide && sb2 === toSide) continue
          // 各辺4点まで（16辺組 × 4 × 4 = 最大256回の直線・L字判定）。補修は交差ペアごとに呼ばれるので、
          // 6点すべてを組み合わせると大きな構成で1回あたり数msかかる
          const startPoints = fixedEnd(target.from) ? [fromCp] : sideCpCandidates(conn.id, target.from, sa2).slice(0, 4)
          const endPoints = fixedEnd(target.to) ? [toCp] : sideCpCandidates(conn.id, target.to, sb2).slice(0, 4)
          for (const pa of startPoints) {
            if (!terminalStepFree(target.from.id, pa, conn.id)) continue
            for (const pb of endPoints) {
              if (!terminalStepFree(target.to.id, pb, conn.id)) continue
              const points = routeDirectBothWays(pa, sa2, pb, sb2, target.from, target.to)
              if (!points || routeBends(points) > beforeBends) continue
              if (!terminalStubsAreUprightForSides(points, sa2, sb2)) continue
              if (countCrossings(points, obstacle.points) > maxAllowed) continue
              if (axisBacktracks(points) > beforeBacktrack) continue
              if (routeLength(points) > beforeLength + 140) continue
              // 同じ曲がり数なら、1本だけ使う辺の中央を優先する。
              // 距離だけで選ぶと交差補修が接続点を角へ押し戻してしまう。
              const centerPenalty = singleSideOffset(target.from, sa2, points[0]) +
                singleSideOffset(target.to, sb2, points[points.length - 1])
              if (bestDirect && (routeBends(points) > routeBends(bestDirect.points) ||
                (routeBends(points) === routeBends(bestDirect.points) &&
                  (centerPenalty > bestDirect.centerPenalty ||
                    (centerPenalty === bestDirect.centerPenalty && routeLength(points) >= routeLength(bestDirect.points)))))) continue
              // 以下は全エッジ走査で重いので最後に置く
              if (mergedAgainstOthers(target, points) > beforeMerged + 0.5) continue
              if (crossingsAgainstOthers(target, points) > beforeCross) continue
              bestDirect = { points, sa: sa2, sb: sb2, centerPenalty }
            }
          }
        }
      }
      if (bestDirect) {
        const chosen: { points: { x: number; y: number }[]; sa: Side; sb: Side } = bestDirect
        cp.set(conn.id + '@' + target.from.id, { ...chosen.points[0] })
        cp.set(conn.id + '@' + target.to.id, { ...chosen.points[chosen.points.length - 1] })
        sideMap.set(conn.id + '@' + target.from.id, chosen.sa)
        sideMap.set(conn.id + '@' + target.to.id, chosen.sb)
        if (chosen.sa !== fromSide) setEndpointSide(conn.id, target.from, fromSide, chosen.sa)
        if (chosen.sb !== toSide) setEndpointSide(conn.id, target.to, toSide, chosen.sb)
        pairSides.set(conn.id, [chosen.sa, chosen.sb])
        markUsed(chosen.points)
        target.points = chosen.points
        return true
      }
    }

    const ends = [
      { node: target.from, other: target.to, atStart: true },
      { node: target.to, other: target.from, atStart: false },
    ]
    for (const end of ends) {
      const node = end.node
      // 均等ファンアウトのノードと分岐ケーブルの枝は接続点が仕様で固定されている
      if (balancedFanoutNodes.has(node.id) || branchKeyAt(conn.id, node.id) !== null) continue
      const currentSide = sideMap.get(conn.id + '@' + node.id)
      const otherSide = sideMap.get(conn.id + '@' + end.other.id)
      const otherCp = cp.get(conn.id + '@' + end.other.id)
      if (!currentSide || !otherSide || !otherCp) continue
      for (const side of ALL_SIDES) {
        if (side === currentSide) continue
        for (const point of sideCpCandidates(conn.id, node, side)) {
          if (sideRepairBudget <= 0) return false
          if (!terminalStepFree(node.id, point, conn.id)) continue
          if (!terminalOrderOk(node, side, point, conn.id, end.other)) continue
          const memoKey = `${conn.id}|${node.id}|${side}|${point.x},${point.y}`
            + `|${otherSide}|${otherCp.x},${otherCp.y}|${end.atStart ? 1 : 0}`
          let points = sideRouteMemo.get(memoKey)
          if (points === undefined) {
            if (!beginRepairAttempt()) return false
            sideRepairBudget--
            try {
              points = end.atStart
                ? await routeBetween(point, side, node, otherCp, otherSide, end.other)
                : await routeBetween(otherCp, otherSide, end.other, point, side, node)
            } finally {
              endRepairAttempt()
            }
            sideRouteMemo.set(memoKey, points)
          }
          if (!points || points.length < 2) continue
          if (countCrossings(points, obstacle.points) > maxAllowed) continue
          if (routeBends(points) > beforeBends + SIDE_REPAIR_BEND_ALLOWANCE) continue
          // 交差1件は compareReadability の尺度で曲がり1個ぶん強。長さの増分もそこまでに抑える
          if (routeLength(points) > beforeLength + 140) continue
          if (axisBacktracks(points) > beforeBacktrack) continue
          // 以下は全エッジ走査で重いので最後に置く
          if (mergedAgainstOthers(target, points) > beforeMerged + 0.5) continue
          if (crossingsAgainstOthers(target, points) > beforeCross) continue
          cp.set(conn.id + '@' + node.id, end.atStart ? { ...points[0] } : { ...points[points.length - 1] })
          sideMap.set(conn.id + '@' + node.id, side)
          setEndpointSide(conn.id, node, currentSide, side)
          const sides = pairSides.get(conn.id)
          if (sides) pairSides.set(conn.id, end.atStart ? [side, sides[1]] : [sides[0], side])
          markUsed(points)
          target.points = points
          return true
        }
      }
    }
    return false
  }

  // 補修は1回では解消しきれないことがある（再ルーティングが別ペアと新たに交差する等）ため、
  // 「同じ2本が2回以上交差するペア」がなくなるまで複数パス繰り返す。
  // 補修は最も重い処理（ペア総当たり×A*再探索）なので、再ルーティング回数に
  // 全体予算を設けて表示までの時間を確実に抑える。
  let repairBudget = 60
  beginRepairPhase()
  for (let pass = 0; pass < 3 && repairBudget > 0; pass++) {
    // 前パスで置き換えた古い経路のペナルティを残さず、現在の経路だけから再構築する。
    usedEdge.fill(0)
    nearCell.fill(0)
    layoutEdges.forEach((edge) => markUsed(edge.points))
    let changed = false
    for (let i = 0; i < layoutEdges.length && repairBudget > 0; i++) {
      const ei = layoutEdges[i]
      if (ei.isPairLink) continue
      for (let j = i + 1; j < layoutEdges.length && repairBudget > 0; j++) {
        const pause = pauseIfNeeded()
        if (pause) await pause
        const ej = layoutEdges[j]
        if (ej.isPairLink) continue
        const stripId = sharedNodeId(ei, ej)
        const maxAllowed = stripId ? 0 : 1
        const before = countCrossings(ei.points, ej.points)
        if (before <= maxAllowed) continue

        // ① 同じ電源タップが起点なら、まず互いの開始位置（ポート）を交換して
        // 交差が解消するか試す。解消するならその交換を採用して次のペアへ進む。
        if (stripId) {
          const stripNode = nodeById.get(stripId)!
          const eiOtherId = ei.from.id === stripId ? ei.to.id : ei.from.id
          const ejOtherId = ej.from.id === stripId ? ej.to.id : ej.from.id
          const eiStripSide = sideMap.get(ei.conn.id + '@' + stripId)
          const ejStripSide = sideMap.get(ej.conn.id + '@' + stripId)
          const eiStripCp = cp.get(ei.conn.id + '@' + stripId)
          const ejStripCp = cp.get(ej.conn.id + '@' + stripId)
          // 同じ辺から出ているポート同士でなければ、位置の交換自体に意味がないためスキップ
          if (eiStripSide && ejStripSide && eiStripSide === ejStripSide && eiStripCp && ejStripCp) {
            const eiOtherNode = nodeById.get(eiOtherId)!, ejOtherNode = nodeById.get(ejOtherId)!
            const eiOtherCp = cp.get(ei.conn.id + '@' + eiOtherId) ?? { x: eiOtherNode.cx, y: eiOtherNode.y + eiOtherNode.h }
            const ejOtherCp = cp.get(ej.conn.id + '@' + ejOtherId) ?? { x: ejOtherNode.cx, y: ejOtherNode.y + ejOtherNode.h }
            const eiOtherSide = sideMap.get(ei.conn.id + '@' + eiOtherId) ?? 'top'
            const ejOtherSide = sideMap.get(ej.conn.id + '@' + ejOtherId) ?? 'top'
            const eiSwapped = await routeBetween(ejStripCp, ejStripSide, stripNode, eiOtherCp, eiOtherSide, eiOtherNode)
            const ejSwapped = await routeBetween(eiStripCp, eiStripSide, stripNode, ejOtherCp, ejOtherSide, ejOtherNode)
            if (eiSwapped && ejSwapped) {
              const afterSwap = countCrossings(eiSwapped, ejSwapped)
              const bendsBefore = routeBends(ei.points) + routeBends(ej.points)
              const bendsAfter = routeBends(eiSwapped) + routeBends(ejSwapped)
              const overlapBefore = pairOverlapAgainstOthers(ei, ei.points, ej, ej.points)
              const overlapAfter = pairOverlapAgainstOthers(ei, eiSwapped, ej, ejSwapped)
              if (afterSwap <= maxAllowed && afterSwap < before && bendsAfter <= bendsBefore && overlapAfter <= overlapBefore + 0.5) {
                const eiOriented = ei.from.id === stripId ? eiSwapped : [...eiSwapped].reverse()
                const ejOriented = ej.from.id === stripId ? ejSwapped : [...ejSwapped].reverse()
                cp.set(ei.conn.id + '@' + stripId, { ...ejStripCp })
                cp.set(ej.conn.id + '@' + stripId, { ...eiStripCp })
                refreshFanoutByCoordinate(stripNode, eiStripSide)
                markUsed(eiOriented); markUsed(ejOriented)
                ei.points = eiOriented
                ej.points = ejOriented
                changed = true
                continue
              }
            }
          }
        }

        // ②' まず出口の辺そのものを見直す（経路をこねる前に原因を直す）。
        // 1回の付け替えが他のペアの前提を変えるので、後続パスでも試す（予算で総量を抑える）。
        if (await trySideRepair(ei, ej, maxAllowed) || await trySideRepair(ej, ei, maxAllowed)) {
          changed = true
          continue
        }

        // ② ei を ej の経路周辺を避けて再ルーティング → 上限以下になれば採用
        repairBudget--
        const ri = await rerouteAvoiding(ei, ej, !!stripId)
        const ci = ri ? countCrossings(ri, ej.points) : Infinity
        const oiBefore = overlapAgainstOthers(ei, ei.points)
        const oi = ri ? overlapAgainstOthers(ei, ri) : Infinity
        // ej とのペアは ci で見ているので除外し、「第三の線と上限超で交差し直していないか」を見る
        const xiBefore = overCrossingPartners(ei, ei.points, ej)
        const xi = ri ? overCrossingPartners(ei, ri, ej) : Infinity
        if (ri && ci <= maxAllowed && routeBends(ri) <= routeBends(ei.points) &&
            oi <= oiBefore + 0.5 && xi <= xiBefore) {
          markUsed(ri); ei.points = ri
          changed = true
          continue
        }
        // ③ ei 側で解消できなければ ej 側を再ルーティング
        repairBudget--
        const rj = await rerouteAvoiding(ej, ei, !!stripId)
        const cj = rj ? countCrossings(ei.points, rj) : Infinity
        const ojBefore = overlapAgainstOthers(ej, ej.points)
        const oj = rj ? overlapAgainstOthers(ej, rj) : Infinity
        const xjBefore = overCrossingPartners(ej, ej.points, ei)
        const xj = rj ? overCrossingPartners(ej, rj, ei) : Infinity
        if (rj && cj <= maxAllowed && routeBends(rj) <= routeBends(ej.points) &&
            oj <= ojBefore + 0.5 && xj <= xjBefore) {
          markUsed(rj); ej.points = rj
          changed = true
          continue
        }
        // ④ 完全解消できない場合でも、交差数がより減る方を採用して次パスに委ねる
        const riUsable = ri && ci < before && routeBends(ri) <= routeBends(ei.points) &&
          oi <= oiBefore + 0.5 && xi <= xiBefore
        const rjUsable = rj && cj < before && routeBends(rj) <= routeBends(ej.points) &&
          oj <= ojBefore + 0.5 && xj <= xjBefore
        if (riUsable || rjUsable) {
          if (riUsable && (!rjUsable || ci <= cj)) { markUsed(ri); ei.points = ri }
          else if (rjUsable) { markUsed(rj); ej.points = rj }
          changed = true
        }
      }
      const pause = pauseIfNeeded()
      if (pause) await pause
    }
    if (!changed) break
  }
  // コンセント→電源タップは電源系統の幹線。交差補修で動いた幹線をここで確定し、
  // 支線が幹線を横断していれば初回探索時の非交差経路へ戻す。
  // レーン分割より後で戻すと、分割済みの支線だけが旧経路へ戻って重なりが再発する。
  for (const [stripId, trunkPoints] of protectedTrunkPoints) {
    const trunk = layoutEdges.find((edge) => powerTrunkStripId(edge.conn) === stripId)
    if (!trunk) continue
    trunk.points = trunkPoints.map((point) => ({ ...point }))
    const trunkSegments = routeSegments(trunk.points)
    protectedPowerTrunks.set(stripId, trunkSegments)
    for (const branch of layoutEdges) {
      if (powerBranchStripId(branch.conn) !== stripId) continue
      if (!conflictsWithPowerTrunk(branch.points, trunkSegments)) continue
      const fallback = protectedBranchPoints.get(branch.conn.id)
      if (!fallback || conflictsWithPowerTrunk(fallback, trunkSegments)) continue
      branch.points = fallback.map((point) => ({ ...point }))
    }
  }

  // ── 外側レーン候補の後処理 ──
  // 外側レーンは先に引いた線から1レーン外へ送って初めて並走を避けられるが、引いている最中に
  // 選ばせると、まだ引いていない線が通るはずの外周を先に塞ぎ、後の線が大回りになる。
  // 初回の配線直後に置き換えても、続く交差補修の結果が入力の小さな違いで大きく振れ、
  // 置き換えた1本は良くなっているのに図全体では悪くなる構成が多く出た。
  // そのため補修を終えた図に対して1本ずつ、他のすべての線と比べて読みやすいときだけ置き換える。
  // 電源の幹線は枝の経路の前提になっているので動かさない
  routedForSelection.length = 0
  for (const edge of layoutEdges) {
    routedForSelection.push({
      nodeIds: new Set([edge.from.id, edge.to.id]),
      terminals: new Map([[edge.from.id, edge.points[0]], [edge.to.id, edge.points[edge.points.length - 1]]]),
      segments: routeSegments(edge.points),
      edgeId: edge.conn.id,
    })
  }
  for (const c of routingOrder) {
    // 置き換えない線のほうが多いので、置き換えたときだけ区切ると UI を長く止める
    const pause = pauseIfNeeded()
    if (pause) await pause
    if (c.id.startsWith('pair-') || powerTrunkStripId(c)) continue
    const edge = layoutEdges.find((candidate) => candidate.conn.id === c.id)
    const index = routedForSelection.findIndex((route) => route.edgeId === c.id)
    if (!edge || index < 0) continue
    const [own] = routedForSelection.splice(index, 1)
    const { points } = await routeEdge(c, edge.points)
    if (points === edge.points) {
      routedForSelection.splice(index, 0, own)
      continue
    }
    markUsed(points)
    routedForSelection.splice(index, 0, {
      ...own,
      terminals: new Map([[edge.from.id, points[0]], [edge.to.id, points[points.length - 1]]]),
      segments: routeSegments(points),
    })
    edge.points = points
  }

  // 図全体で「1本に見えている」長さ（レーン間隔 VISIBLE_LANE_GAP 未満の並走）。
  // 端の足を動かす後段の補正が、別の場所で新たな重なりを作らないか確かめるのに使う。
  const VISIBLE_LANE_GAP = 12
  const mergedWithOtherEdges = (edge: MapEdge, points: { x: number; y: number }[]) => {
    const segments = routeSegments(points)
    let merged = 0
    for (const other of layoutEdges) {
      if (other === edge) continue
      merged += nearbyParallelSegmentLength(segments, routeSegments(other.points), VISIBLE_LANE_GAP)
    }
    return merged
  }

  // ── 並走レーン分割：同じ場所に重なった区間を路線図のように横並びに展開する ──
  // ほぼ同一座標を通る同方向の区間をまとめ、各配線に垂直方向のオフセット（レーン）を
  // 割り当てて、1本に見えていた重なりを「複数色が並走する束」として描けるようにする。
  // 直交ポリラインは水平・垂直が交互なので、水平区間の y シフトと垂直区間の x シフトは
  // 同じ折れ点に同時に適用しても衝突しない（隣の区間が伸縮して吸収する）。
  {
    const beforeLane = new Map(layoutEdges.map((edge) => [edge, edge.points.map((point) => ({ ...point }))]))
    const LANE_GAP = 12.5       // 浮動小数点誤差を含めても、視認上の最低間隔12pxを下回らせない
    // 同一コリドー扱いとする座標差。ケーシング(11px)が重なる距離までは「1本に見える」ので、
    // 座標が完全に一致していなくてもまとめてレーンへ展開する。
    // 以前は 3px だったため、4〜11px しか離れていない並走（グリッド吸着や足の伸縮で生じる）が
    // 分割対象から漏れ、太い1本の線に見えていた。
    const COORD_TOL = LANE_GAP - 1
    const MIN_OVERLAP = 10      // 「並走」とみなす最小の共有長（角で触れただけは除外）
    type SegRef = { e: MapEdge; si: number; lo: number; hi: number; c: number }
    const shiftOf = new Map<MapEdge, { dx: number[]; dy: number[] }>()
    const getShift = (e: MapEdge) => {
      let s = shiftOf.get(e)
      if (!s) { s = { dx: new Array(e.points.length).fill(0), dy: new Array(e.points.length).fill(0) }; shiftOf.set(e, s) }
      return s
    }
    const collect = (horiz: boolean): SegRef[] => {
      const out: SegRef[] = []
      for (const e of layoutEdges) {
        if (e.isPairLink || powerTrunkStripId(e.conn)) continue
        for (let i = 0; i < e.points.length - 1; i++) {
          // ノード接続点を動かすと cp/sideMap と実経路がずれるため、端の区間は分割しない。
          if (i === 0 || i + 1 === e.points.length - 1) continue
          const p = e.points[i], q = e.points[i + 1]
          const isH = Math.abs(p.y - q.y) < 0.5
          const isV = Math.abs(p.x - q.x) < 0.5
          if (horiz ? !isH : !isV) continue
          const lo = horiz ? Math.min(p.x, q.x) : Math.min(p.y, q.y)
          const hi = horiz ? Math.max(p.x, q.x) : Math.max(p.y, q.y)
          if (hi - lo < MIN_OVERLAP) continue
          out.push({ e, si: i, lo, hi, c: horiz ? p.y : p.x })
        }
      }
      return out
    }
    const assignLanes = (horiz: boolean) => {
      const refs = collect(horiz).sort((a, b) => a.c - b.c)
      let g0 = 0
      for (let i = 1; i <= refs.length; i++) {
        // コリドーは「全員が互いに1本に見える」範囲に限る。隣同士の差だけで連鎖させると
        // 12px 刻みに並んだ区間が芋づる式に1つの帯（幅50px超）にまとまり、平均座標へ
        // まとめて引き寄せられて経路が壊れる（→妥当性検査で差し戻され重なりが残る）。
        if (i < refs.length && refs[i].c - refs[g0].c <= COORD_TOL) continue
        // 同一コリドー（ほぼ同じ座標）内で、区間が実際に重なっているクラスタごとに処理
        const corridor = refs.slice(g0, i).sort((a, b) => a.lo - b.lo)
        let c0 = 0
        let curHi = corridor.length ? corridor[0].hi : 0
        for (let j = 1; j <= corridor.length; j++) {
          if (j < corridor.length && corridor[j].lo < curHi - MIN_OVERLAP) {
            curHi = Math.max(curHi, corridor[j].hi)
            continue
          }
          const cluster = corridor.slice(c0, j)
          const edgesIn = [...new Set(cluster.map((r) => r.e))]
          if (edgesIn.length >= 2) {
            // レーン順は「線がコリドーのどちら側から来て、どちら側へ抜けるか」で決める。
            // 上側から出入りする線は上のレーン、下側は下のレーンに置くことで、
            // 束の出入口で線同士が入れ替わって余計な交差（2回交差）が生まれるのを防ぐ。
            const keyOf = new Map<MapEdge, number>()
            for (const r of cluster) {
              if (keyOf.has(r.e)) continue
              const pts = r.e.points
              const perp = (p: { x: number; y: number }) => (horiz ? p.y : p.x)
              // コリドー区間の前後の折れ点（端点がノード接続点ならノード中心で近似）
              const beforePt = r.si > 0 ? pts[r.si - 1] : { x: r.e.from.cx, y: r.e.from.cy }
              const afterPt = r.si + 2 < pts.length ? pts[r.si + 2] : { x: r.e.to.cx, y: r.e.to.cy }
              keyOf.set(r.e, (perp(beforePt) - r.c) + (perp(afterPt) - r.c))
            }
            edgesIn.sort((a, b) => (keyOf.get(a)! - keyOf.get(b)!) || a.conn.id.localeCompare(b.conn.id))
            const k = edgesIn.length
            let outward = 0
            for (const r of cluster) {
              const sideSign = (node: MapNode, side: Side | undefined) => {
                if (!balancedFanoutNodes.has(node.id) || !side) return 0
                if (horiz) return side === 'top' ? -1 : side === 'bottom' ? 1 : 0
                return side === 'left' ? -1 : side === 'right' ? 1 : 0
              }
              if (r.si === 1) outward += sideSign(r.e.from, sideMap.get(r.e.conn.id + '@' + r.e.from.id))
              if (r.si + 2 === r.e.points.length - 1) outward += sideSign(r.e.to, sideMap.get(r.e.conn.id + '@' + r.e.to.id))
            }
            // 外周コリドーは内側へ広げるとノード列へ当たり、配線ごとの妥当性検査で
            // 一部だけ差し戻される。束全体を外向きへ展開してレーンの穴を作らない。
            const corridorCoord = cluster.reduce((sum, r) => sum + r.c, 0) / k
            const minNodeLane = Math.min(...nodes.map((node) => horiz ? node.y : node.x))
            const maxNodeLane = Math.max(...nodes.map((node) => horiz ? node.y + node.h : node.x + node.w))
            if (corridorCoord < minNodeLane) outward -= 1
            else if (corridorCoord > maxNodeLane) outward += 1
            const bundleBias = Math.sign(outward) * (k - 1) / 2 * LANE_GAP
            // 束をコリドーの中心へ機械的に並べると、端のレーンがノードのクリアランスへ
            // 食い込み、そのレーンだけ妥当性検査で差し戻されて元の座標＝重なりへ戻る。
            // 区間が通る隙間の空き幅を先に求め、束全体が収まる位置へずらしてから配る。
            const span = (k - 1) * LANE_GAP
            const clusterLo = Math.min(...cluster.map((r) => r.lo))
            const clusterHi = Math.max(...cluster.map((r) => r.hi))
            let freeLo = -Infinity
            let freeHi = Infinity
            for (const node of nodes) {
              const alongLo = horiz ? node.x : node.y
              const alongHi = horiz ? node.x + node.w : node.y + node.h
              if (alongHi + CLEAR <= clusterLo || alongLo - CLEAR >= clusterHi) continue
              const perpLo = horiz ? node.y : node.x
              const perpHi = horiz ? node.y + node.h : node.x + node.w
              if (perpHi + CLEAR <= corridorCoord) freeLo = Math.max(freeLo, perpHi + CLEAR)
              else if (perpLo - CLEAR >= corridorCoord) freeHi = Math.min(freeHi, perpLo - CLEAR)
            }
            const idealFirst = corridorCoord - (k - 1) / 2 * LANE_GAP + bundleBias
            // 隙間が束の幅に足りない構成では従来どおり中心から配り、個別の差し戻しに任せる
            const first = freeHi - freeLo >= span
              ? clamp(idealFirst, freeLo, freeHi - span)
              : idealFirst
            for (const r of cluster) {
              // レーン座標はコリドーの中心から割り当てる。区間ごとの元座標を基準にすると、
              // 元から数px ずれている束（COORD_TOL 内）で間隔が LANE_GAP に届かない
              const lane = first + edgesIn.indexOf(r.e) * LANE_GAP
              const off = lane - r.c
              const sh = getShift(r.e)
              if (horiz) { sh.dy[r.si] = off; sh.dy[r.si + 1] = off }
              else { sh.dx[r.si] = off; sh.dx[r.si + 1] = off }
            }
          }
          c0 = j
          if (j < corridor.length) curHi = corridor[j].hi
        }
        g0 = i
      }
    }
    assignLanes(true)
    assignLanes(false)
    for (const [e, sh] of shiftOf) {
      e.points = e.points.map((p, i) => ({ x: p.x + (sh.dx[i] ?? 0), y: p.y + (sh.dy[i] ?? 0) }))
    }

    // 端の区間（接続点から最初／最後の折れ点まで）は、辺に直角へ OUT 以上出ていること。
    // レーン分割は端の「区間」自体は動かさないが、その先の折れ点は動かすため、
    // 足の長さだけが潰れて配線が枠に張り付いて見えることがある。
    const terminalStubsAreUpright = (points: { x: number; y: number }[], edge: MapEdge) => {
      if (points.length < 2) return true
      const upright = (p: { x: number; y: number }, q: { x: number; y: number }, side: Side | undefined) => {
        if (!side) return true
        const horizontalSide = side === 'top' || side === 'bottom'
        const along = horizontalSide ? Math.abs(p.x - q.x) : Math.abs(p.y - q.y)
        const outward = horizontalSide ? Math.abs(p.y - q.y) : Math.abs(p.x - q.x)
        return along < 0.5 && outward >= OUT - 0.5
      }
      return upright(points[0], points[1], sideMap.get(edge.conn.id + '@' + edge.from.id)) &&
        upright(points[points.length - 1], points[points.length - 2], sideMap.get(edge.conn.id + '@' + edge.to.id))
    }

    const laneRouteIsValid = (edge: MapEdge) => {
      const own = new Set([edge.from.id, edge.to.id])
      if (!terminalStubsAreUpright(edge.points, edge) &&
          terminalStubsAreUpright(beforeLane.get(edge)!, edge)) return false
      const expectedStart = cp.get(edge.conn.id + '@' + edge.from.id)
      const expectedEnd = cp.get(edge.conn.id + '@' + edge.to.id)
      const actualStart = edge.points[0]
      const actualEnd = edge.points[edge.points.length - 1]
      if (expectedStart && actualStart && (Math.abs(expectedStart.x - actualStart.x) > 0.5 || Math.abs(expectedStart.y - actualStart.y) > 0.5)) return false
      if (expectedEnd && actualEnd && (Math.abs(expectedEnd.x - actualEnd.x) > 0.5 || Math.abs(expectedEnd.y - actualEnd.y) > 0.5)) return false
      if (routeSelfPierces(edge.points, edge.from, edge.to)) return false
      const branchStripId = powerBranchStripId(edge.conn)
      const protectedTrunk = branchStripId ? protectedPowerTrunks.get(branchStripId) : undefined
      if (protectedTrunk && conflictsWithPowerTrunk(edge.points, protectedTrunk)) return false
      for (let i = 0; i < edge.points.length - 1; i++) {
        const p = edge.points[i], q = edge.points[i + 1]
        const orthogonal = Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5
        if (!orthogonal || !segClear(p, q, own)) return false
      }
      return true
    }
    for (const edge of layoutEdges) {
      if (laneRouteIsValid(edge)) continue
      const before = beforeLane.get(edge)!
      // 12pxではノード余白に触れる場合も、完全に差し戻すと束の中央へ戻って再び重なる。
      // 旧来の11px幅まで縮めた候補が安全なら、視認限界ぎりぎりでも別レーンを維持する。
      const reduced = edge.points.map((point, i) => ({
        x: before[i].x + (point.x - before[i].x) * 11 / 12,
        y: before[i].y + (point.y - before[i].y) * 11 / 12,
      }))
      edge.points = reduced
      if (!laneRouteIsValid(edge)) edge.points = before
    }
    // レーン分割の結果、他の配線との交差が増えることがある（例：片方の配線だけが
    // ノード近接で却下され、もう片方だけレーンがずれた状態になったとき）。
    // ただし交差は路線図のケーシング表現で上下関係が読めるため実害が小さい一方、
    // 重なり（1本に見える状態）は読み取り不能になる。
    // 交差が増える変更でも、その分だけ重なりが解消されているなら差し戻さない。
    // 重なりの判定は座標完全一致ではなく LANE_GAP 未満の並走で見る。完全一致だけを
    // 見ていた頃は、数px しかずれていない並走（＝ケーシングが重なって1本に見える）を
    // 「重なっていない」と評価し、それを解消したレーン分割まで差し戻していた。
    // 判定はこの2本だけでなく図全体の重なりで見る。組ごとに見ると、第三の配線との
    // 重なりを解消したレーン分割を、無関係な組の交差増加を理由に取り消してしまう。
    const mergedAround = (a: MapEdge, b: MapEdge) =>
      mergedWithOtherEdges(a, a.points) + mergedWithOtherEdges(b, b.points)
    for (let i = 0; i < layoutEdges.length; i++) {
      for (let j = i + 1; j < layoutEdges.length; j++) {
        const a = layoutEdges[i], b = layoutEdges[j]
        const beforeA = beforeLane.get(a)!, beforeB = beforeLane.get(b)!
        if (countCrossings(a.points, b.points) <= countCrossings(beforeA, beforeB)) continue
        const mergedNow = mergedAround(a, b)
        const keptA = a.points, keptB = b.points
        a.points = beforeA
        b.points = beforeB
        // 差し戻すと重なりが増えるなら、交差が増えてもレーン分割を維持する
        if (mergedAround(a, b) > mergedNow + 0.5) {
          a.points = keptA
          b.points = keptB
        }
      }
    }
  }
  // 同一レーンに重なって片方が見えなくなった配線の重複区間を横へ逃がす。
  // レーン分割は片側のシフトがノード近接で却下されると重なりが残るため、
  // ガジェットを共有しないペアも含めてここで補修する。
  // 接続点に隣接する区間は動かさず、cp / sideMap と辺中央ルールを維持する。
  {
    const MIN_SHARED_OVERLAP = 8
    const MIN_VISIBLE_LANE_GAP = 12
    const NUDGE_OFFSETS = [12, -12, 24, -24, 36, -36, 48, -48, 60, -60, 72, -72]
    const PAIR_NUDGE_OFFSETS = [12, -12, 24, -24, 36, -36, 48, -48, 60, -60, 72, -72]
    const visualParallelOverlapOf = (a: { x: number; y: number }[], b: { x: number; y: number }[]) => {
      return nearbyParallelSegmentLength(routeSegments(a), routeSegments(b), MIN_VISIBLE_LANE_GAP)
    }
    // nearbyParallelSegmentLength は「しきい値内かどうか」の二値判定なので、
    // 完全に重なる（距離0）候補も、しきい値ぎりぎりで離れている（距離11）候補も
    // 同じ重み（区間長そのもの）で数えてしまう。そのままスコアに使うと、
    // レーン分割で既に11px離せていた配線を、完全一致の座標へ動かす候補の方が
    // 曲がり数や長さで勝って選ばれてしまうことがある（重なりの再発）。
    // 距離が近いほど重く数える重み付けをして、完全一致を明確に最悪と評価する。
    const weightedParallelOverlapOf = (a: { x: number; y: number }[], b: { x: number; y: number }[]) => {
      let weighted = 0
      const segsA = routeSegments(a), segsB = routeSegments(b)
      for (const first of segsA) {
        for (const second of segsB) {
          if (first.horiz !== second.horiz) continue
          const laneDistance = first.horiz ? Math.abs(first.y0 - second.y0) : Math.abs(first.x0 - second.x0)
          if (laneDistance >= MIN_VISIBLE_LANE_GAP) continue
          const lo = Math.max(first.horiz ? first.x0 : first.y0, second.horiz ? second.x0 : second.y0)
          const hi = Math.min(first.horiz ? first.x1 : first.y1, second.horiz ? second.x1 : second.y1)
          const len = Math.max(0, hi - lo)
          weighted += len * (MIN_VISIBLE_LANE_GAP - laneDistance) / MIN_VISIBLE_LANE_GAP
        }
      }
      return weighted
    }
    // 全配線（ペア装飾線を除く）との重なり合計。これが減る候補だけを採用する
    const siblingOverlapOf = (edge: MapEdge, points: { x: number; y: number }[]) => {
      let overlap = 0
      for (const other of layoutEdges) {
        if (other === edge) continue
        overlap += weightedParallelOverlapOf(points, other.points)
      }
      return overlap
    }
    const OVERLAP_OVER_CROSSING = 60
    const crossingsOf = (edge: MapEdge, points: { x: number; y: number }[]) => {
      let crossings = 0
      for (const other of layoutEdges) {
        if (other === edge) continue
        crossings += countCrossings(points, other.points)
      }
      return crossings
    }
    const endpointOnSide = (point: { x: number; y: number }, node: MapNode, side: Side) => {
      if (side === 'top' || side === 'bottom') {
        const boundary = side === 'top' ? node.y : node.y + node.h
        return Math.abs(point.y - boundary) < 0.5 && point.x >= node.x + 9 && point.x <= node.x + node.w - 9
      }
      const boundary = side === 'left' ? node.x : node.x + node.w
      return Math.abs(point.x - boundary) < 0.5 && point.y >= node.y + 9 && point.y <= node.y + node.h - 9
    }
    const routeIsClear = (edge: MapEdge, points: { x: number; y: number }[]) => {
      const startSide = sideMap.get(edge.conn.id + '@' + edge.from.id)
      const endSide = sideMap.get(edge.conn.id + '@' + edge.to.id)
      if (startSide && endSide && !terminalStubsAreUprightForSides(points, startSide, endSide)) return false
      if (startSide && !endpointOnSide(points[0], edge.from, startSide)) return false
      if (endSide && !endpointOnSide(points[points.length - 1], edge.to, endSide)) return false
      if (routeSelfPierces(points, edge.from, edge.to)) return false
      const branchStripId = powerBranchStripId(edge.conn)
      const protectedTrunk = branchStripId ? protectedPowerTrunks.get(branchStripId) : undefined
      if (protectedTrunk && conflictsWithPowerTrunk(points, protectedTrunk)) return false
      const own = new Set([edge.from.id, edge.to.id])
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i], q = points[i + 1]
        if ((Math.abs(p.x - q.x) >= 0.5 && Math.abs(p.y - q.y) >= 0.5) || !segClear(p, q, own)) return false
      }
      return true
    }
    const routeIsTightClear = (edge: MapEdge, points: { x: number; y: number }[]) => {
      const startSide = sideMap.get(edge.conn.id + '@' + edge.from.id)
      const endSide = sideMap.get(edge.conn.id + '@' + edge.to.id)
      if (startSide && endSide && !terminalStubsAreUprightForSides(points, startSide, endSide)) return false
      if (startSide && !endpointOnSide(points[0], edge.from, startSide)) return false
      if (endSide && !endpointOnSide(points[points.length - 1], edge.to, endSide)) return false
      if (routeSelfPierces(points, edge.from, edge.to)) return false
      const branchStripId = powerBranchStripId(edge.conn)
      const protectedTrunk = branchStripId ? protectedPowerTrunks.get(branchStripId) : undefined
      if (protectedTrunk && conflictsWithPowerTrunk(points, protectedTrunk)) return false
      const own = new Set([edge.from.id, edge.to.id])
      for (let i = 0; i < points.length - 1; i++) {
        const p = points[i], q = points[i + 1]
        if (Math.abs(p.x - q.x) >= 0.5 && Math.abs(p.y - q.y) >= 0.5) return false
        for (const node of nodes) {
          if (!own.has(node.id) && segEntersNode(p, q, node)) return false
        }
      }
      return true
    }
    const nudgeSegment = (
      points: { x: number; y: number }[], segmentIndex: number,
      lo: number, hi: number, offset: number,
    ) => {
      const p = points[segmentIndex], q = points[segmentIndex + 1]
      const horizontal = Math.abs(p.y - q.y) < 0.5
      const start = horizontal ? p.x : p.y
      const end = horizontal ? q.x : q.y
      const enterCoord = end >= start ? lo : hi
      const exitCoord = end >= start ? hi : lo
      const fullLo = Math.min(start, end)
      const fullHi = Math.max(start, end)
      const shiftsWholeSegment = Math.abs(lo - fullLo) < 0.5 && Math.abs(hi - fullHi) < 0.5
      if (shiftsWholeSegment && (segmentIndex === 0 || segmentIndex + 1 === points.length - 1)) {
        const shifted = points.map((point) => ({ ...point }))
        const indexes = segmentIndex === 0
          ? [0, 1]
          : [points.length - 2, points.length - 1]
        for (const index of indexes) {
          if (horizontal) shifted[index].y += offset
          else shifted[index].x += offset
        }
        return simplify(shifted)
      }
      // 端の区間でも、接続点から十分離れた一部分だけなら cp を動かさず退避できる。
      // 接続直後／直前で曲げる候補は従来どおり除外する。
      const TERMINAL_GUARD = 24
      if (segmentIndex === 0 && Math.abs(enterCoord - start) < TERMINAL_GUARD) return null
      if (segmentIndex + 1 === points.length - 1 && Math.abs(end - exitCoord) < TERMINAL_GUARD) return null
      const onLane = (coord: number) => horizontal ? { x: coord, y: p.y } : { x: p.x, y: coord }
      const onNudgedLane = (coord: number) => horizontal
        ? { x: coord, y: p.y + offset }
        : { x: p.x + offset, y: coord }
      return simplify([
        ...points.slice(0, segmentIndex),
        p,
        onLane(enterCoord),
        onNudgedLane(enterCoord),
        onNudgedLane(exitCoord),
        onLane(exitCoord),
        q,
        ...points.slice(segmentIndex + 2),
      ])
    }

    const repairParallelOverlaps = async (allowTightCorridors = false) => {
      // 交差補修が使い切った予算を引き継がない（②）。並走解消は別フェーズとして数える
      beginRepairPhase()
      const denseGraph = maxDegree >= 24 || layoutEdges.length >= 24
      let repairBudget = denseGraph ? 64 : 32
    // 1パスで1組だけ直して経路全体を再評価する。複数モニター構成では
    // 3組を超えて束ができるため、3パス固定だと後ろの重なりが残る。
      for (let pass = 0; pass < (denseGraph ? 32 : 12) && repairBudget > 0; pass++) {
      let changed = false
      pairLoop: for (let i = 0; i < layoutEdges.length; i++) {
        const first = layoutEdges[i]
        for (let j = i + 1; j < layoutEdges.length; j++) {
          const pause = pauseIfNeeded()
          if (pause) await pause
          const second = layoutEdges[j]
          if (visualParallelOverlapOf(first.points, second.points) < MIN_SHARED_OVERLAP) continue

          let best: {
            edge: MapEdge
            points: { x: number; y: number }[]
            overlap: number
            crossings: number
            bends: number
            length: number
          } | null = null
          for (const [edge, obstacle] of [[first, second], [second, first]] as const) {
            if (powerTrunkStripId(edge.conn)) continue
            const candidate = await rerouteAvoiding(edge, obstacle, true)
            if (!candidate || (!routeIsClear(edge, candidate) && (!allowTightCorridors || !routeIsTightClear(edge, candidate)))) continue
            const overlap = siblingOverlapOf(edge, candidate)
            const currentOverlap = siblingOverlapOf(edge, edge.points)
            if (overlap >= currentOverlap - 0.5) continue
            // ここは経路を丸ごと引き直す手なので、走りが大きく動いて（実測で縦の走りが
            // 352px 移動した例がある）別の線と2回交差しやすい。この工程は交差補修より
            // 後に走り、後で交差を見直す工程が無いため、上限超を持ち込むと元に戻せない
            // （実測で残存 cross-twice の24%をこの工程が作っていた）。
            // ただし並走の解消そのものは止めない。長く並走した線は「1本に見える」ので
            // 交差より読めず、compareReadability でも並走は交差より上位に置かれている。
            // 実際、無条件に止めると 128px の完全重なりが解消されずに残った。
            // そこで解消できる並走が短いときだけ交差上限を優先する。単位は
            // weightedParallelOverlapOf の実効px（間隔0で全長、11pxで1/12）。
            // 重い判定なので、しきい値の比較を先に置いて呼ぶ回数を抑える。
            if (currentOverlap - overlap < OVERLAP_OVER_CROSSING &&
                overCrossingPartners(edge, candidate) > overCrossingPartners(edge, edge.points)) continue
            // 短い並走のために直線を大回りさせない。相手の区間が機器に挟まれてずらせないと、
            // 候補はこの引き直しだけになり、実効20pxの並走を消すために、直線が4曲がりの
            // コの字になって交差も4件増えていた。曲がりの数だけで止めると、交差を3件減らす
            // 引き直し（途中の2曲がりは最後の短絡で消える）まで止めてしまうので、交差・曲がり・
            // 長さの合算で見て、曲がり1つ分を超えて悪くなる引き直しだけを止める
            if (currentOverlap - overlap < OVERLAP_OVER_CROSSING &&
                (crossingsOf(edge, candidate) - crossingsOf(edge, edge.points)) * 140 +
                (routeBends(candidate) - routeBends(edge.points)) * 120 +
                routeLength(candidate) - routeLength(edge.points) > 120) continue
            const choice = {
              edge,
              points: candidate,
              overlap,
              crossings: crossingsOf(edge, candidate),
              bends: routeBends(candidate),
              length: routeLength(candidate),
            }
            if (!best ||
                choice.overlap < best.overlap - 0.5 ||
                (Math.abs(choice.overlap - best.overlap) <= 0.5 && (
                  choice.crossings < best.crossings ||
                  (choice.crossings === best.crossings && (
                    choice.bends < best.bends ||
                    (choice.bends === best.bends && choice.length < best.length)
                  ))
                ))) best = choice
          }
          const firstSegments = routeSegments(first.points)
          const secondSegments = routeSegments(second.points)
          for (let si = 0; si < firstSegments.length; si++) {
            const a = firstSegments[si]
            for (let sj = 0; sj < secondSegments.length; sj++) {
              const b = secondSegments[sj]
              if (a.horiz !== b.horiz) continue
              const laneDistance = a.horiz ? Math.abs(a.y0 - b.y0) : Math.abs(a.x0 - b.x0)
              if (laneDistance >= MIN_VISIBLE_LANE_GAP) continue
              const lo = Math.max(a.horiz ? a.x0 : a.y0, b.horiz ? b.x0 : b.y0)
              const hi = Math.min(a.horiz ? a.x1 : a.y1, b.horiz ? b.x1 : b.y1)
              if (hi - lo < MIN_SHARED_OVERLAP) continue

              for (const [edge, segmentIndex, segment] of [
                [first, si, a], [second, sj, b],
              ] as const) {
                if (powerTrunkStripId(edge.conn)) continue
                const fullLo = segment.horiz ? segment.x0 : segment.y0
                const fullHi = segment.horiz ? segment.x1 : segment.y1
                for (const [nudgeLo, nudgeHi] of [[fullLo, fullHi], [lo, hi]] as const) {
                  const obstacleSegment = edge === first ? b : a
                  const laneCoord = segment.horiz ? segment.y0 : segment.x0
                  const obstacleCoord = obstacleSegment.horiz ? obstacleSegment.y0 : obstacleSegment.x0
                  const direction = Math.sign(laneCoord - obstacleCoord) || (edge === first ? -1 : 1)
                  const exactSeparation = direction * (MIN_VISIBLE_LANE_GAP + 0.5 - laneDistance)
                  const baseOffsets = first.isPairLink || second.isPairLink ? PAIR_NUDGE_OFFSETS : NUDGE_OFFSETS
                  const offsets = [exactSeparation, ...baseOffsets]
                  for (const offset of offsets) {
                    const candidate = nudgeSegment(edge.points, segmentIndex, nudgeLo, nudgeHi, offset)
                    if (!candidate || (!routeIsClear(edge, candidate) && (!allowTightCorridors || !routeIsTightClear(edge, candidate)))) continue
                    const overlap = siblingOverlapOf(edge, candidate)
                    const currentOverlap = siblingOverlapOf(edge, edge.points)
                    if (overlap >= currentOverlap - 0.5) continue
                    const choice = {
                      edge,
                      points: candidate,
                      overlap,
                      crossings: crossingsOf(edge, candidate),
                      bends: routeBends(candidate),
                      length: routeLength(candidate),
                    }
                    if (!best ||
                        choice.overlap < best.overlap - 0.5 ||
                        (Math.abs(choice.overlap - best.overlap) <= 0.5 && (
                          choice.crossings < best.crossings ||
                          (choice.crossings === best.crossings && (
                            choice.bends < best.bends ||
                            (choice.bends === best.bends && choice.length < best.length)
                          ))
                        ))) best = choice
                  }
                }
              }
            }
          }
          if (best) {
            best.edge.points = best.points
            repairBudget--
            changed = true
            break pairLoop
          }
        }
      }
        if (!changed) break
      }
    }
    await repairParallelOverlaps()

  // 同じ辺から出る足の深さが同じだと、接続点が離れていても足の先で合流する。
  // 足の深さを段違いにし、最初の辺平行区間を12pxずつ別レーンへ送る。
  for (const node of nodes) {
    for (const side of ['top', 'right', 'bottom', 'left'] as Side[]) {
      const pause = pauseIfNeeded()
      if (pause) await pause
      const terminals = layoutEdges.flatMap((edge) => {
        if (powerTrunkStripId(edge.conn)) return []
        if (edge.from.id === node.id && sideMap.get(edge.conn.id + '@' + node.id) === side) return [{ edge, atStart: true }]
        if (edge.to.id === node.id && sideMap.get(edge.conn.id + '@' + node.id) === side) return [{ edge, atStart: false }]
        return []
      })
      const [nx, ny] = nrm(side)
      const depthOf = (points: { x: number; y: number }[]) =>
        (points[1].x - points[0].x) * nx + (points[1].y - points[0].y) * ny
      // 足の先の辺平行区間が辺に沿ってどこからどこまで走るか。深さが同じでも、この範囲が
      // 離れていれば合流しない。深さだけで判定すると、辺の両端から逆向きに出る2本まで
      // 段違いにされ、送られた側が隣の機器の際へ押し付けられる。
      const parallelSpanOf = (points: { x: number; y: number }[]) => {
        const along = (point: { x: number; y: number }) => (nx === 0 ? point.x : point.y)
        const normal = (point: { x: number; y: number }) => (nx === 0 ? point.y : point.x)
        let lo = along(points[1]), hi = lo
        for (let i = 2; i < points.length && Math.abs(normal(points[i]) - normal(points[1])) < 0.5; i++) {
          lo = Math.min(lo, along(points[i]))
          hi = Math.max(hi, along(points[i]))
        }
        return { lo, hi }
      }
      const accepted: { edge: MapEdge; depth: number; span: { lo: number; hi: number } }[] = []
      for (const terminal of terminals) {
        const oriented = terminal.atStart ? terminal.edge.points : [...terminal.edge.points].reverse()
        if (oriented.length < 3) continue
        const currentDepth = depthOf(oriented)
        const span = parallelSpanOf(oriented)
        const conflicts = (depth: number) => accepted.some((other) => Math.abs(other.depth - depth) < 12 &&
          other.span.lo < span.hi + 12 && span.lo < other.span.hi + 12)
        if (!conflicts(currentDepth)) {
          accepted.push({ edge: terminal.edge, depth: currentDepth, span })
          continue
        }
        let replacement: { x: number; y: number }[] | null = null
        // 足を伸ばした先の平行区間は図の反対側まで届くことがある。この辺の同士だけを
        // 見て深さを決めると、離れた場所で別の配線と数px差の並走になり、そこで1本に
        // 見えてしまう（レーン分割はこの補正より前に終わっているので直されない）。
        // 現状より重なりが増えない深さの中から、いちばん重なりが少ないものを選ぶ。
        const mergedNow = mergedWithOtherEdges(terminal.edge, terminal.edge.points)
        let bestMerged = mergedNow + 0.5
        for (const depth of [currentDepth + 12, currentDepth - 12, currentDepth + 24, currentDepth + 36]) {
          if (depth < OUT || conflicts(depth)) continue
          const candidate = oriented.map((point) => ({ ...point }))
          const normalCoord = nx === 0 ? candidate[0].y + ny * depth : candidate[0].x + nx * depth
          let k = 1
          while (k + 1 < candidate.length && Math.abs(
            (nx === 0 ? candidate[k + 1].y : candidate[k + 1].x) -
            (nx === 0 ? candidate[k].y : candidate[k].x),
          ) < 0.5) k++
          if (k >= candidate.length - 1) continue
          for (let i = 1; i <= k; i++) {
            if (nx === 0) candidate[i].y = normalCoord
            else candidate[i].x = normalCoord
          }
          const restored = terminal.atStart ? simplify(candidate) : simplify(candidate).reverse()
          const startSide = sideMap.get(terminal.edge.conn.id + '@' + terminal.edge.from.id)
          const endSide = sideMap.get(terminal.edge.conn.id + '@' + terminal.edge.to.id)
          if (!startSide || !endSide || !terminalStubsAreUprightForSides(restored, startSide, endSide)) continue
          if (!routeClearsNodes(restored, terminal.edge.from, terminal.edge.to) &&
              !routeIsTightClear(terminal.edge, restored)) continue
          const branchStripId = powerBranchStripId(terminal.edge.conn)
          const protectedTrunk = branchStripId ? protectedPowerTrunks.get(branchStripId) : undefined
          if (protectedTrunk && conflictsWithPowerTrunk(restored, protectedTrunk)) continue
          const merged = mergedWithOtherEdges(terminal.edge, restored)
          if (merged >= bestMerged) continue
          bestMerged = merged
          replacement = restored
        }
        if (replacement) terminal.edge.points = replacement
        const finalOriented = terminal.atStart ? terminal.edge.points : [...terminal.edge.points].reverse()
        accepted.push({
          edge: terminal.edge,
          depth: finalOriented.length > 1 ? depthOf(finalOriented) : currentDepth,
          span: finalOriented.length > 2 ? parallelSpanOf(finalOriented) : span,
        })
      }
    }
  }

  const separateTerminalPoints = async () => {
  // 補修や交差回避で別ポートの端点が同じ座標へ移った場合、端の区間は通常の
  // レーン分割対象外なので、ノード辺上の接続点だけを再び12px以上に分ける。
  for (const node of nodes) {
    for (const side of ['top', 'right', 'bottom', 'left'] as Side[]) {
      const pause = pauseIfNeeded()
      if (pause) await pause
      const terminals = layoutEdges.flatMap((edge) => {
        // 電源幹線は経路を保護するため動かさない。ただし除外してしまうと、
        // 幹線と同じ接続点へ寄った支線が「重なっていない」と判定されて残るので、
        // 座標の主張だけはさせる（fixed）。
        // 2in1 ケーブルの枝も同じ扱い。分岐元では同じ接続点から出るのが正しい姿なので、
        // ここで引き離してしまうと束ねた意味がなくなる。
        const fixed = !!powerTrunkStripId(edge.conn) || branchKeyAt(edge.conn.id, node.id) !== null
        if (edge.from.id === node.id && sideMap.get(edge.conn.id + '@' + node.id) === side) {
          return [{ edge, atStart: true, fixed }]
        }
        if (edge.to.id === node.id && sideMap.get(edge.conn.id + '@' + node.id) === side) {
          return [{ edge, atStart: false, fixed }]
        }
        return []
      })
      const horizontalSide = side === 'top' || side === 'bottom'
      const axisOfPoint = (point: { x: number; y: number }) => horizontalSide ? point.x : point.y
      const accepted: { edge: MapEdge; axis: number }[] = []
      terminals.sort((a, b) => {
        if (a.fixed !== b.fixed) return a.fixed ? -1 : 1
        const pa = a.atStart ? a.edge.points[0] : a.edge.points[a.edge.points.length - 1]
        const pb = b.atStart ? b.edge.points[0] : b.edge.points[b.edge.points.length - 1]
        return axisOfPoint(pa) - axisOfPoint(pb) || a.edge.conn.id.localeCompare(b.edge.conn.id)
      })
      for (const terminal of terminals) {
        const oriented = terminal.atStart ? terminal.edge.points : [...terminal.edge.points].reverse()
        if (oriented.length < 2) continue
        const currentAxis = axisOfPoint(oriented[0])
        if (terminal.fixed) {
          accepted.push({ edge: terminal.edge, axis: currentAxis })
          continue
        }
        const lo = (horizontalSide ? node.x : node.y) + 9
        const hi = (horizontalSide ? node.x + node.w : node.y + node.h) - 9
        // 同じ物理ポートを共有する配線も、ノード上では別々の線として識別できるようにする。
        // ポートIDと途中の束ね方は維持し、端点だけを分離する。
        const conflicts = (axis: number) => accepted.some((other) =>
          Math.abs(other.axis - axis) < MIN_CP_STEP)
        if (currentAxis >= lo && currentAxis <= hi && !conflicts(currentAxis)) {
          accepted.push({ edge: terminal.edge, axis: currentAxis })
          continue
        }
        let replacement: { x: number; y: number }[] | null = null
        const reserved = reservedFanoutCp.get(terminal.edge.conn.id + '@' + node.id)
        const reservedAxis = reserved ? axisOfPoint(reserved) : currentAxis
        const clampedAxis = Math.max(lo, Math.min(hi, currentAxis))
        const candidateAxes = [
          reservedAxis,
          clampedAxis,
          lo,
          hi,
          ...accepted.flatMap((other) => [other.axis - MIN_CP_STEP, other.axis + MIN_CP_STEP]),
          currentAxis + MIN_CP_STEP,
          currentAxis - MIN_CP_STEP,
          currentAxis + MIN_CP_STEP * 2,
          currentAxis - MIN_CP_STEP * 2,
          currentAxis + MIN_CP_STEP * 3,
          currentAxis - MIN_CP_STEP * 3,
        ].sort((a, b) => Math.abs(a - currentAxis) - Math.abs(b - currentAxis) || a - b)
        for (const axis of candidateAxes) {
          if (axis < lo || axis > hi || conflicts(axis)) continue
          const direct = oriented.map((point) => ({ ...point }))
          if (horizontalSide) {
            direct[0].x = axis
            direct[1].x = axis
          } else {
            direct[0].y = axis
            direct[1].y = axis
          }
          const endpoint = horizontalSide
            ? { x: axis, y: oriented[0].y }
            : { x: oriented[0].x, y: axis }
          const [nx, ny] = nrm(side)
          const outside = { x: endpoint.x + nx * OUT, y: endpoint.y + ny * OUT }
          const join = horizontalSide
            ? { x: oriented[1].x, y: outside.y }
            : { x: outside.x, y: oriented[1].y }
          const dogleg = simplify([endpoint, outside, join, ...oriented.slice(1)])
          // 2点だけの直線で direct を使うと反対側の端点まで動くため、端点側だけを曲げる。
          const candidates = oriented.length === 2 ? [dogleg] : [simplify(direct), dogleg]
          for (const candidate of candidates) {
            const restored = terminal.atStart ? candidate : [...candidate].reverse()
            if (!routeClearsNodes(restored, terminal.edge.from, terminal.edge.to) &&
                !routeIsTightClear(terminal.edge, restored)) continue
            const startSide = sideMap.get(terminal.edge.conn.id + '@' + terminal.edge.from.id)
            const endSide = sideMap.get(terminal.edge.conn.id + '@' + terminal.edge.to.id)
            if (!startSide || !endSide || !terminalStubsAreUprightForSides(restored, startSide, endSide)) continue
            const branchStripId = powerBranchStripId(terminal.edge.conn)
            const protectedTrunk = branchStripId ? protectedPowerTrunks.get(branchStripId) : undefined
            if (protectedTrunk && conflictsWithPowerTrunk(restored, protectedTrunk)) continue
            replacement = restored
            break
          }
          if (replacement) break
        }
        if (replacement) terminal.edge.points = replacement
        const finalPoints = terminal.edge.points
        const finalPoint = terminal.atStart ? finalPoints[0] : finalPoints[finalPoints.length - 1]
        accepted.push({ edge: terminal.edge, axis: axisOfPoint(finalPoint) })
      }
    }
  }
  }
  await separateTerminalPoints()

  // 左右へ迂回する経路はノード範囲より外へ出る。SVGで切れないよう経路点も含めて
  // 全体を正座標へ移し、線の外側にもケーシング幅を十分に超える余白を残す。
    // 端点間隔の補正で中間レーンが再び近づく場合があるため、確定後の経路を再評価する。
    await repairParallelOverlaps(true)
    for (const edge of layoutEdges) {
      const pause = pauseIfNeeded()
      if (pause) await pause
      const startSide = sideMap.get(edge.conn.id + '@' + edge.from.id)
      const endSide = sideMap.get(edge.conn.id + '@' + edge.to.id)
      if (!startSide || !endSide || terminalStubsAreUprightForSides(edge.points, startSide, endSide)) continue
      const own = new Set([edge.from.id, edge.to.id])
      const absorbed = absorbTerminalJog(edge.points, own)
      const startExtended = extendStubWithDoglegOneEnd(absorbed, own)
      const extended = extendStubWithDoglegOneEnd([...startExtended].reverse(), own).reverse()
      if (terminalStubsAreUprightForSides(extended, startSide, endSide)) edge.points = extended
    }
    await separateTerminalPoints()

    for (const edge of layoutEdges) {
      const pause = pauseIfNeeded()
      if (pause) await pause
      const startSide = sideMap.get(edge.conn.id + '@' + edge.from.id)
      const endSide = sideMap.get(edge.conn.id + '@' + edge.to.id)
      if (!startSide || !endSide) continue
      const endpointsMatchSides =
        endpointOnSide(edge.points[0], edge.from, startSide) &&
        endpointOnSide(edge.points[edge.points.length - 1], edge.to, endSide)
      if (endpointsMatchSides && terminalStubsAreUprightForSides(edge.points, startSide, endSide)) continue

      const sideAtPoint = (point: { x: number; y: number }, node: MapNode) =>
        (['top', 'right', 'bottom', 'left'] as Side[]).find((side) => endpointOnSide(point, node, side))
      const repairedStartSide = endpointOnSide(edge.points[0], edge.from, startSide)
        ? startSide
        : sideAtPoint(edge.points[0], edge.from)
      const repairedEndSide = endpointOnSide(edge.points[edge.points.length - 1], edge.to, endSide)
        ? endSide
        : sideAtPoint(edge.points[edge.points.length - 1], edge.to)
      if (!repairedStartSide || !repairedEndSide) continue
      sideMap.set(edge.conn.id + '@' + edge.from.id, repairedStartSide)
      sideMap.set(edge.conn.id + '@' + edge.to.id, repairedEndSide)

      const start = cp.get(edge.conn.id + '@' + edge.from.id)
      const end = cp.get(edge.conn.id + '@' + edge.to.id)
      const rerouted = start && end
        ? await routeBetween(start, repairedStartSide, edge.from, end, repairedEndSide, edge.to)
        : null
      const addDogleg = (points: { x: number; y: number }[], side: Side, atStart: boolean) => {
        const oriented = atStart ? points : [...points].reverse()
        if (oriented.length < 2) return points
        const [nx, ny] = nrm(side)
        const endpoint = oriented[0]
        const next = oriented[1]
        const out = { x: endpoint.x + nx * OUT, y: endpoint.y + ny * OUT }
        const corner = side === 'top' || side === 'bottom'
          ? { x: next.x, y: out.y }
          : { x: out.x, y: next.y }
        const repaired = simplify([endpoint, out, corner, ...oriented.slice(1)])
        return atStart ? repaired : repaired.reverse()
      }
      const dogleggedEnd = addDogleg(edge.points, repairedEndSide, false)
      const doglegged = addDogleg(dogleggedEnd, repairedStartSide, true)
      let repairedSuccessfully = false
      for (const repaired of [rerouted, doglegged]) {
        if (!repaired || !endpointOnSide(repaired[0], edge.from, repairedStartSide) ||
            !endpointOnSide(repaired[repaired.length - 1], edge.to, repairedEndSide) ||
            !terminalStubsAreUprightForSides(repaired, repairedStartSide, repairedEndSide) ||
            !routeIsClear(edge, repaired)) continue
        edge.points = repaired
        repairedSuccessfully = true
        break
      }
      if (!repairedSuccessfully) {
        sideMap.set(edge.conn.id + '@' + edge.from.id, startSide)
        sideMap.set(edge.conn.id + '@' + edge.to.id, endSide)
      }
    }
    await separateTerminalPoints()

    // 重なり・交差・端点を維持したまま、途中の迂回だけを短絡する。
    // 後段の重なり補修で安全になった経路にも、不要になったコの字・階段状の折れが
    // 残ることがあるため、全補修が終わった時点で初めて圧縮する。
    for (let pass = 0; pass < 2; pass++) {
      let changed = false
      for (const edge of layoutEdges) {
        if (edge.points.length < 4) continue
        const pause = pauseIfNeeded()
        if (pause) await pause
        const currentOverlap = siblingOverlapOf(edge, edge.points)
        const currentCrossings = crossingsOf(edge, edge.points)
        const currentOverCrossing = overCrossingPartners(edge, edge.points)
        // 短絡で交差の総数が変わらなくても、交差点が口のすぐ外へ移ると誤接続に見える。
        // 接続点は補修中に動くため、最初に割り当てた cp ではなく現在の経路から判定する。
        const foreignStubs: RouteSegment[] = []
        const awayFromStart: RouteSegment[] = []
        const awayFromEnd: RouteSegment[] = []
        for (const other of layoutEdges) {
          if (other === edge || other.isPairLink || other.conn.cableType === 'WiFi') continue
          const segments = routeSegments(other.points)
          if (other.from.id !== edge.from.id && other.to.id !== edge.from.id) awayFromStart.push(...segments)
          if (other.from.id !== edge.to.id && other.to.id !== edge.to.id) awayFromEnd.push(...segments)
          if (other.from.id !== edge.from.id && other.from.id !== edge.to.id) {
            foreignStubs.push(...routeSegments(polylinePrefix(other.points, PORT_STUB_ZONE)))
          }
          if (other.to.id !== edge.from.id && other.to.id !== edge.to.id) {
            foreignStubs.push(...routeSegments(polylinePrefix([...other.points].reverse(), PORT_STUB_ZONE)))
          }
        }
        const portCrossingsOf = (points: { x: number; y: number }[]) =>
          countSegmentCrossings(routeSegments(points), foreignStubs) +
          countSegmentCrossings(routeSegments(polylinePrefix(points, PORT_STUB_ZONE)), awayFromStart) +
          countSegmentCrossings(routeSegments(polylinePrefix([...points].reverse(), PORT_STUB_ZONE)), awayFromEnd)
        const currentPortCrossings = portCrossingsOf(edge.points)
        // 曲がりを減らすためだけに、余白を取れている線を機器の縁すれすれへ寄せない。
        // 余白なしの判定（routeIsTightClear）を誰にでも許していた頃は、4回曲がって機器をよけていた線が
        // キーボード・マウスの下の縁の上を走る L 字に短絡され、機器へつながって見えた。
        // もともと狭い通路を通っている線だけは、狭いまま短くしてよい
        const allowTight = !routeIsClear(edge, edge.points)
        let best = edge.points
        let bestBends = routeBends(best)
        let bestLength = routeLength(best)
        for (let from = 0; from < edge.points.length - 2; from++) {
          for (let to = from + 2; to < edge.points.length; to++) {
            const start = edge.points[from]
            const end = edge.points[to]
            const bridges = Math.abs(start.x - end.x) < 0.5 || Math.abs(start.y - end.y) < 0.5
              ? [[]]
              : [[{ x: start.x, y: end.y }], [{ x: end.x, y: start.y }]]
            // L字では両端の足や障害物を避けられない場合も、既存の通路や
            // その間の中央を使う2回曲がりなら、階段状の迂回をまとめられる。
            if (to - from >= 3) {
              const middle = edge.points.slice(from + 1, to)
              for (const x of new Set([...middle.map((point) => point.x), (start.x + end.x) / 2])) {
                bridges.push([{ x, y: start.y }, { x, y: end.y }])
              }
              for (const y of new Set([...middle.map((point) => point.y), (start.y + end.y) / 2])) {
                bridges.push([{ x: start.x, y }, { x: end.x, y }])
              }
            }
            for (const bridge of bridges) {
              const candidate = simplify([
                ...edge.points.slice(0, from + 1),
                ...bridge,
                ...edge.points.slice(to),
              ])
              const bends = routeBends(candidate)
              const length = routeLength(candidate)
              if (bends > bestBends || (bends === bestBends && length >= bestLength - 0.5)) continue
              if (!routeIsClear(edge, candidate) && (!allowTight || !routeIsTightClear(edge, candidate))) continue
              if (siblingOverlapOf(edge, candidate) > currentOverlap + 0.5) continue
              if (crossingsOf(edge, candidate) > currentCrossings) continue
              if (overCrossingPartners(edge, candidate) > currentOverCrossing) continue
              if (portCrossingsOf(candidate) > currentPortCrossings) continue
              best = candidate
              bestBends = bends
              bestLength = length
            }
          }
        }
        if (best !== edge.points) {
          edge.points = best
          changed = true
        }
      }
      if (!changed) break
    }
  }

  // ── 2in1 ケーブルの枝を、最後にもう一度分岐元へ束ね直す ──
  // 交差補修とレーン分割は「重なって見える線は引き離す」方針なので、束ねた枝も離してしまう。
  // 枝は分岐元で1本になっているのが正しい姿なので、全補修が終わった時点で接続点へ戻す。
  for (const [groupId, trunkId] of branchTrunkNode) {
    const members = layoutEdges.filter((edge) =>
      branchKeyAt(edge.conn.id, trunkId) === groupId &&
      (edge.from.id === trunkId || edge.to.id === trunkId))
    if (members.length < 2) continue
    const anchor = cp.get(members[0].conn.id + '@' + trunkId)
    if (!anchor) continue
    for (const edge of members) {
      const atStart = edge.from.id === trunkId
      const index = atStart ? 0 : edge.points.length - 1
      const dx = anchor.x - edge.points[index].x
      const dy = anchor.y - edge.points[index].y
      if (dx === 0 && dy === 0) continue
      if (edge.points.length < 3) {
        // 折れ点のない直線は端点だけ動かすと斜めになる。分岐元から足を立ててL字に組み直す。
        const side = sideMap.get(edge.conn.id + '@' + trunkId)
        if (!side) continue
        const far = edge.points[atStart ? 1 : 0]
        const [nx, ny] = nrm(side)
        const stub = { x: anchor.x + nx * OUT, y: anchor.y + ny * OUT }
        const corner = nx === 0 ? { x: far.x, y: stub.y } : { x: stub.x, y: far.y }
        const rebuilt = simplify([{ ...anchor }, stub, corner, { ...far }])
        edge.points = atStart ? rebuilt : rebuilt.reverse()
        continue
      }
      const neighbor = atStart ? 1 : edge.points.length - 2
      // 足（端点と次の折れ点）を一緒に動かし、辺に対して直角な立ち上がりを保つ
      edge.points[index] = { x: anchor.x, y: anchor.y }
      edge.points[neighbor] = { x: edge.points[neighbor].x + dx, y: edge.points[neighbor].y + dy }
    }

    // 足の深さも揃える。同じ点から出ていても、深さが段違いだと根元のすぐ先で分かれてしまい、
    // 「1本のケーブルが途中で枝分かれした」ようには読めない（段違いは別の線どうしを
    // 見分けるための補正で、同じケーブルの枝には要らない）。
    const side = sideMap.get(members[0].conn.id + '@' + trunkId)
    if (!side) continue
    const [nx, ny] = nrm(side)
    const depthOf = (edge: MapEdge) => {
      const atStart = edge.from.id === trunkId
      const head = atStart ? edge.points[0] : edge.points[edge.points.length - 1]
      const next = atStart ? edge.points[1] : edge.points[edge.points.length - 2]
      return (next.x - head.x) * nx + (next.y - head.y) * ny
    }
    const measurable = members.filter((edge) => edge.points.length >= 3)
    if (measurable.length < 2) continue
    const target = Math.max(...measurable.map(depthOf))
    for (const edge of measurable) {
      const gap = target - depthOf(edge)
      // 足の次が相手の端点しかない経路（折れ点2つ）は、伸ばすと相手側が歪むので触らない
      if (gap <= 0 || edge.points.length < 4) continue
      const atStart = edge.from.id === trunkId
      const neighbor = atStart ? 1 : edge.points.length - 2
      // 足の先だけ動かすと次の区間が斜めになる。足に続く区間ごと法線方向へ平行移動する
      const following = atStart ? neighbor + 1 : neighbor - 1
      const candidate = edge.points.map((point) => ({ ...point }))
      for (const i of [neighbor, following]) {
        candidate[i] = { x: candidate[i].x + nx * gap, y: candidate[i].y + ny * gap }
      }
      // 伸ばした先が他のノードへ食い込むなら、その枝だけ元の深さのままにする
      if (routeClearsNodes(candidate, edge.from, edge.to)) edge.points = simplify(candidate)
    }
  }

  let minExtentX = nodes.length > 0 ? Math.min(...nodes.map((n) => n.x)) : 0
  let minExtentY = nodes.length > 0 ? Math.min(...nodes.map((n) => n.y)) : 0
  let maxExtentX = nodes.length > 0 ? Math.max(...nodes.map((n) => n.x + n.w)) : 0
  let maxExtentY = nodes.length > 0 ? Math.max(...nodes.map((n) => n.y + n.h)) : 0
  for (const edge of layoutEdges) {
    for (const point of edge.points) {
      minExtentX = Math.min(minExtentX, point.x)
      minExtentY = Math.min(minExtentY, point.y)
      maxExtentX = Math.max(maxExtentX, point.x)
      maxExtentY = Math.max(maxExtentY, point.y)
    }
  }
  const routeShiftX = minExtentX < PAD ? PAD - minExtentX : 0
  const routeShiftY = minExtentY < PAD ? PAD - minExtentY : 0
  if (routeShiftX !== 0 || routeShiftY !== 0) {
    for (const node of nodes) {
      node.x += routeShiftX
      node.y += routeShiftY
      node.cx += routeShiftX
      node.cy += routeShiftY
    }
    for (const edge of layoutEdges) {
      edge.points = edge.points.map((point) => ({ x: point.x + routeShiftX, y: point.y + routeShiftY }))
    }
    minExtentX += routeShiftX
    minExtentY += routeShiftY
    maxExtentX += routeShiftX
    maxExtentY += routeShiftY
  }

  const plannedW = centerAxisX + maxRightExtent + routeShiftX
  const contentW = Math.max(plannedW, maxExtentX) + PAD
  const contentH = Math.max(maxExtentY, 0) + PAD
  // 実際にノードが占めている範囲（中央合わせ用）
  const bounds = nodes.length > 0
    ? {
        minX: Math.min(...nodes.map((n) => n.x)),
        minY: Math.min(...nodes.map((n) => n.y)),
        maxX: Math.max(...nodes.map((n) => n.x + n.w)),
        maxY: Math.max(...nodes.map((n) => n.y + n.h)),
      }
    : { minX: 0, minY: 0, maxX: contentW, maxY: contentH }
  // __DEV__ は React Native のグローバル。fuzz スクリプトは Node で動くので存在しない。
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    const moved = Object.keys(nodeOffsets).length
    console.log(`[perf] layout ${gadgets.length}台 ${layoutEdges.length}本`
      + `${moved > 0 ? ` 手動${moved}件` : ''}: ${Date.now() - startedAt}ms`)
  }
  if (isCancelled?.()) throw new MapLayoutCancelled()
  return { nodes, edges: layoutEdges, width: contentW, height: contentH, bounds }
}

// 折れ点列 → 直角SVGパス（鋭角90°）
export function pointsToPath(points: { x: number; y: number }[]): string {
  'worklet'
  if (points.length === 0) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

// 折れ点列 → 角を丸めたSVGパス（鉄道路線図風のカーブ）
// 各折れ点の手前 r で止めて二次ベジェで曲がる。短い区間では r を自動縮小。
export function pointsToRoundedPath(points: { x: number; y: number }[], r = 10): string {
  'worklet'
  if (points.length === 0) return ''
  if (points.length < 3) return pointsToPath(points)
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1]
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y)
    const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    if (d1 < 0.5 || d2 < 0.5) { d += ` L ${p1.x} ${p1.y}`; continue }
    const rr = Math.min(r, d1 / 2, d2 / 2)
    const ax = p1.x - ((p1.x - p0.x) / d1) * rr
    const ay = p1.y - ((p1.y - p0.y) / d1) * rr
    const bx = p1.x + ((p2.x - p1.x) / d2) * rr
    const by = p1.y + ((p2.y - p1.y) / d2) * rr
    d += ` L ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`
  }
  const last = points[points.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

const WAVE_LEN = 16
const WAVE_AMP = 5

// 折れ点列 → 波線SVGパス（ワイヤレス給電）。ケーブルの線と一目で区別するための表現なので、
// 配線図と履歴アニメの両方が同じ波形を使う（片方だけ直線で描くと、履歴では無線が有線に見える）
export function wavyPath(points: { x: number; y: number }[]): string {
  'worklet'
  if (points.length < 2) return ''
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1], p2 = points[i]
    const dx = p2.x - p1.x, dy = p2.y - p1.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < WAVE_LEN || len === 0) {
      d += ` L ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
      continue
    }
    const px = -dy / len, py = dx / len
    const waves = Math.max(1, Math.round(len / WAVE_LEN))
    let dir = 1
    for (let w = 0; w < waves; w++) {
      const tMid = (w + 0.5) / waves
      const tEnd = (w + 1) / waves
      const cx = (p1.x + dx * tMid + px * WAVE_AMP * dir).toFixed(1)
      const cy = (p1.y + dy * tMid + py * WAVE_AMP * dir).toFixed(1)
      const ex = (p1.x + dx * tEnd).toFixed(1)
      const ey = (p1.y + dy * tEnd).toFixed(1)
      d += ` Q ${cx} ${cy} ${ex} ${ey}`
      dir *= -1
    }
  }
  return d
}

// ─── 自動下書き生成：generateWiring → MapConnection[] ──────────────

export function buildAutoDraft(gadgets: Gadget[], plan: DeskPlan, lang: 'ja' | 'en' = 'ja'): MapConnection[] {
  const result = generateWiring(gadgets, plan, lang)
  const ids = new Set(plan.selectedGadgetIds)
  const ok = (gid: string) => ids.has(gid) || POWER_SOURCE_IDS.has(gid)
  let i = 0
  const out: MapConnection[] = []
  const seen = new Set<string>()
  for (const c of result.connections) {
    // 失敗センチネルは除外。電源ソース（コンセント・ソーラー・電池）は採用
    if (c.fromGadgetId.startsWith('failed') || c.toGadgetId.startsWith('failed')) continue
    if (!ok(c.fromGadgetId) || !ok(c.toGadgetId)) continue
    const key = [c.fromGadgetId, c.toGadgetId, c.cableType].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      id: `map-auto-${i++}`,
      fromGadgetId: c.fromGadgetId,
      toGadgetId: c.toGadgetId,
      cableType: c.cableType,
      chargingOnly: c.chargingOnly,
      sourcePortId: c.sourcePortId,
      count: c.count,
      countSource: c.countSource,
      origin: 'auto',
      // 2in1 はユーザーが宣言するものなので、自動下書きでは付けない（reconcileMap が引き継ぐ）
      confirmed: false,
      wireless: isWirelessPortType(c.cableType) || c.id.startsWith('wireless-power-'),
    })
  }
  return out
}

export const mapPairKey = (a: string, b: string, t: string) => [a, b].sort().join('~') + '|' + t
const pairKey = mapPairKey
/** ケーブル種別を含まない、ガジェットの組だけのキー（種別が変わっても状態を引き継ぐため） */
const devicePairKey = (a: string, b: string) => [a, b].sort().join('~')

// 自動接続を最新エンジン出力で作り直す（手動追加は温存・確定状態は引き継ぐ）。
// 永続化された古い自動接続が残り続ける問題を根本から解消する。
// 「すべて破棄」済みの下書き（dismissedPairs）は再生成しない。
export function reconcileMap(
  existing: MapConnection[],
  gadgets: Gadget[],
  plan: DeskPlan,
  lang: 'ja' | 'en' = 'ja',
): MapConnection[] {
  // 端のガジェットが手元から消えた手動接続は残さない。描画は edgesRaw0 が両端の
  // 実在を確かめて落とすので図には出ないが、落とさないと保存データに残り続け、
  // 公開時の share_snapshot にもそのまま載る。
  // 判定は selectedGadgetIds ではなく gadgets（所有しているガジェット）で行う。
  // デスクから外しただけの相手で切ると、戻したときに手で引いた線が消える
  const ownedIds = new Set(gadgets.map((g) => g.id))
  const liveEndpoint = (gid: string) => ownedIds.has(gid) || POWER_SOURCE_IDS.has(gid)
  const manual = existing.filter(
    (c) => c.origin === 'manual' && liveEndpoint(c.fromGadgetId) && liveEndpoint(c.toGadgetId),
  )
  const manualPairs = new Set(manual.map((c) => pairKey(c.fromGadgetId, c.toGadgetId, c.cableType)))
  const dismissed = new Set(plan.connectionMap?.dismissedPairs ?? [])
  // 旧接続の確定状態をペアキーで引き継ぐ
  const prevConfirmed = new Map<string, boolean>()
  for (const c of existing) {
    prevConfirmed.set(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType), c.confirmed)
  }
  // ペアキーはケーブル種別を含むため、同じ2台の間で種別だけが変わると（充電器の口が
  // USB-C から USB-A へ移った等）確定状態も「破棄」の記録も外れてしまう。
  // ガジェットの組が同じなら種別が変わっても引き継げるよう、種別を落としたキーでも覚えておく。
  // 同じ2台を複数の種別で結んでいる場合は曖昧になるので、その組は対象外にする。
  const devicePairCount = new Map<string, number>()
  for (const c of existing) {
    const key = devicePairKey(c.fromGadgetId, c.toGadgetId)
    devicePairCount.set(key, (devicePairCount.get(key) ?? 0) + 1)
  }
  const prevConfirmedByDevices = new Map<string, boolean>()
  const dismissedDevicePairs = new Set<string>()
  for (const c of existing) {
    const key = devicePairKey(c.fromGadgetId, c.toGadgetId)
    if (devicePairCount.get(key) !== 1) continue
    prevConfirmedByDevices.set(key, c.confirmed)
    if (dismissed.has(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType))) dismissedDevicePairs.add(key)
  }
  // 2in1 ケーブルの宣言は自動生成では作られない。ここで引き継がないと、
  // ガジェットを1台足しただけで束ねた枝がばらける。確定状態と同じ2段のキーで拾う。
  const prevBranch = new Map<string, string>()
  const prevBranchByDevices = new Map<string, string>()
  const prevRoute = new Map<string, MapConnection['route']>()
  const prevRouteByDevices = new Map<string, MapConnection['route']>()
  // つなぎ方（どの1本を使っているかの申告）も同じ2段のキーで引き継ぐ。
  // 引き継がないと、ガジェットを1台足しただけで自動生成の線に付けた申告が全部消える
  const prevChoice = new Map<string, MapConnection['cableChoice']>()
  // 本数（ステレオの L/R・デュアル電源）も引き継ぐ。自動生成は1本しか引かないので、
  // 引き継がないとガジェットを足すたびに2本目の宣言が消える
  const prevCount = new Map<string, number>()
  for (const c of existing) {
    // 構成から自動追加した本数は、その構成をOFFにしたら消す。ユーザーが指定した本数だけ引き継ぐ
    if ((c.count ?? 1) > 1 && !c.countSource) prevCount.set(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType), c.count ?? 1)
    if (c.cableChoice) prevChoice.set(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType), c.cableChoice)
    if (c.route) {
      prevRoute.set(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType), c.route)
      const routeDeviceKey = devicePairKey(c.fromGadgetId, c.toGadgetId)
      if (devicePairCount.get(routeDeviceKey) === 1) prevRouteByDevices.set(routeDeviceKey, c.route)
    }
    if (!c.branchGroupId) continue
    prevBranch.set(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType), c.branchGroupId)
    const key = devicePairKey(c.fromGadgetId, c.toGadgetId)
    if (devicePairCount.get(key) === 1) prevBranchByDevices.set(key, c.branchGroupId)
  }
  const wasBranchGroup = (c: MapConnection) =>
    prevBranch.get(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType))
      ?? prevBranchByDevices.get(devicePairKey(c.fromGadgetId, c.toGadgetId))
  const previousRoute = (c: MapConnection) =>
    prevRoute.get(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType))
      ?? prevRouteByDevices.get(devicePairKey(c.fromGadgetId, c.toGadgetId))
  // つなぎ方だけは種別を落としたキーで引き継がない。取り回し（route）や確定状態と違い、
  // 「その種別のケーブル1本」を指しているので、DisplayPort が HDMI に変わった線へ
  // 移すと別物のケーブルを申告したことになる
  const previousChoice = (c: MapConnection) =>
    prevChoice.get(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType))
  const previousCount = (c: MapConnection) =>
    prevCount.get(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType))
  const wasConfirmed = (c: MapConnection) =>
    prevConfirmed.get(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType))
      ?? prevConfirmedByDevices.get(devicePairKey(c.fromGadgetId, c.toGadgetId))
  const wasDismissed = (c: MapConnection) =>
    dismissed.has(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType)) ||
    dismissedDevicePairs.has(devicePairKey(c.fromGadgetId, c.toGadgetId))

  const draft = buildAutoDraft(gadgets, plan, lang)
  const auto = draft
    .filter((c) => {
      // 破棄済みの下書きは、確定履歴がない限り復活させない
      return !manualPairs.has(pairKey(c.fromGadgetId, c.toGadgetId, c.cableType)) &&
        (!wasDismissed(c) || wasConfirmed(c) === true)
    })
    .map((c) => ({
      ...c,
      confirmed: wasConfirmed(c) ?? false,
      branchGroupId: wasBranchGroup(c),
      route: previousRoute(c),
      cableChoice: previousChoice(c),
      count: c.count ?? previousCount(c),
      countSource: c.countSource,
    }))

  // 相手の枝が消えて1本だけになった 2in1 の宣言は、もう分岐ではないので落とす
  const branchCount = new Map<string, number>()
  for (const c of [...auto, ...manual]) {
    if (!c.branchGroupId) continue
    branchCount.set(c.branchGroupId, (branchCount.get(c.branchGroupId) ?? 0) + 1)
  }
  return [...auto, ...manual].map((c) =>
    c.branchGroupId && branchCount.get(c.branchGroupId)! < 2
      ? { ...c, branchGroupId: undefined }
      : c,
  )
}

// 2つの接続集合が実質同じか（無駄な保存・再描画を避ける）
export function mapSignature(conns: MapConnection[]): string {
  return conns
    .map((c) => [
      pairKey(c.fromGadgetId, c.toGadgetId, c.cableType),
      c.confirmed ? '1' : '0',
      c.chargingOnly ? 'c' : '',
      // 無線かどうか・自動／手動の別も差分に含める。これらだけが変わった場合に
      // 「変更なし」と判定されると、線の見た目や再生成の扱いが保存されないまま残る
      c.wireless ? 'w' : '',
      c.origin ?? 'auto',
      // 挿す口が変わった場合も接続情報の変更として扱う
      c.sourcePortId ?? '',
      // 2in1 のまとめ方が変われば線の出方が変わるので、こちらも差分に含める
      c.branchGroupId ?? '',
      c.route?.lengthCm ?? '',
      c.route?.visibility ?? '',
      c.route?.path ?? '',
      c.route?.note ?? '',
      // つなぎ方が引き継がれたかどうかも差分に入れる。入れないと、引き継ぎが
      // 壊れて申告が消えた状態が「実質同じ」と判定され、保存の可否で気づけない
      c.cableChoice?.kind ?? '',
      c.cableChoice?.kind === 'product' ? c.cableChoice.name : '',
      c.count ?? '',
      c.countSource ?? '',
    ].join('|'))
    .sort()
    .join(';')
}

// 重なった点と一直線に並んだ点を畳む（connectionMapLayout の simplify と同じ役割）
function tidyPoints(pts: { x: number; y: number }[]) {
  'worklet'
  const d: { x: number; y: number }[] = []
  for (const p of pts) {
    const q = d[d.length - 1]
    if (!q || Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5) d.push(p)
  }
  return d.filter((p, i) => {
    if (i === 0 || i === d.length - 1) return true
    const a = d[i - 1], c = d[i + 1]
    return !((Math.abs(a.x - p.x) < 0.5 && Math.abs(p.x - c.x) < 0.5)
      || (Math.abs(a.y - p.y) < 0.5 && Math.abs(p.y - c.y) < 0.5))
  })
}

// 動かしたノード側の足（接続点と最初の折れ点）をノードごと平行移動し、
// その先の折れ点までを直角で繋ぎ直す。反対側の端点は相手ノードの接続点なので動かさない。
function relegEnd(
  points: { x: number; y: number }[], atStart: boolean, dx: number, dy: number,
): { x: number; y: number }[] | null {
  'worklet'
  const pts = atStart ? points : [...points].reverse()
  if (pts.length < 2) return null
  const legX = pts[1].x - pts[0].x
  const legY = pts[1].y - pts[0].y
  const horizontal = Math.abs(legY) < 0.5
  if (!horizontal && Math.abs(legX) >= 0.5) return null
  const head = { x: pts[0].x + dx, y: pts[0].y + dy }
  // 折れ点が無い直線は反対側の端点を動かせないので、足だけ立て直してからL字で繋ぐ
  const stub = pts.length >= 3
    ? { x: pts[1].x + dx, y: pts[1].y + dy }
    : {
        x: head.x + (horizontal ? Math.sign(legX) * MAP_STUB_OUT : 0),
        y: head.y + (horizontal ? 0 : Math.sign(legY) * MAP_STUB_OUT),
      }
  const rest = pts.slice(pts.length >= 3 ? 2 : 1)
  const far = rest[0]
  const corner = horizontal ? { x: stub.x, y: far.y } : { x: far.x, y: stub.y }
  const rebuilt = tidyPoints([head, stub, corner, ...rest])
  // 畳んだ結果として相手側の端点まで動いてしまう形は使わない
  const tail = rebuilt[rebuilt.length - 1]
  if (Math.abs(tail.x - pts[pts.length - 1].x) > 0.5 || Math.abs(tail.y - pts[pts.length - 1].y) > 0.5) return null
  return atStart ? rebuilt : rebuilt.reverse()
}

// ── ドラッグ直後にその場で作る暫定レイアウト ──
// フル再計算は台数が増えると重い（22台・線26本の構成で1操作あたり実測3.6〜4.8秒）。
// 指を離してからそれだけ待たせないよう、先に手元で作れる図を見せる。
//
// 線が1本も繋がっていないノードは動かしても他の経路に影響しないので確定として扱う。
// 線が繋がっているノードは足だけ引き直した近似なので、見せておいて裏でフル再計算し、
// 終わり次第そちらへ差し替える（provisional）。
export function patchLayoutNodeMove(
  current: MapLayout,
  nodeId: string,
  dx: number,
  dy: number,
): { layout: MapLayout; provisional: boolean } | null {
  const node = current.nodes.find((item) => item.id === nodeId)
  if (!node) return null

  type Rect = { x: number; y: number; w: number; h: number }
  const clearance = 12
  const oldRect: Rect = { x: node.x - clearance, y: node.y - clearance, w: node.w + clearance * 2, h: node.h + clearance * 2 }
  const nextRect: Rect = { x: node.x + dx - clearance, y: node.y + dy - clearance, w: node.w + clearance * 2, h: node.h + clearance * 2 }
  if (nextRect.x < 0 || nextRect.y < 0) return null

  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  const segmentHitsRect = (a: { x: number; y: number }, b: { x: number; y: number }, rect: Rect) =>
    Math.min(a.x, b.x) < rect.x + rect.w && Math.max(a.x, b.x) > rect.x
    && Math.min(a.y, b.y) < rect.y + rect.h && Math.max(a.y, b.y) > rect.y

  const attached = new Set(current.edges.filter((edge) => edge.from.id === nodeId || edge.to.id === nodeId))
  const provisional = attached.size > 0
  const body: Rect = { x: node.x + dx, y: node.y + dy, w: node.w, h: node.h }

  // 重なった位置では足だけの補正で安全な経路を保証できないため、全体再計算へ任せる。
  for (const other of current.nodes) {
    if (other.id === nodeId) continue
    if (overlaps(provisional ? body : nextRect, { x: other.x, y: other.y, w: other.w, h: other.h })) return null
  }
  for (const edge of current.edges) {
    if (attached.has(edge)) continue
    for (let i = 1; i < edge.points.length; i++) {
      // 動かした先を他の配線が通っていると、線がノードを貫いて見える
      if (segmentHitsRect(edge.points[i - 1], edge.points[i], provisional ? body : nextRect)) return null
      // 元の位置が経路選択へ影響していた場合、空いた跡地に短絡経路が生まれうる。
      // 暫定版は後でフル再計算に差し替わるので、確定扱いのときだけ弾く。
      if (!provisional && segmentHitsRect(edge.points[i - 1], edge.points[i], oldRect)) return null
    }
  }

  const movedNodes = current.nodes.map((item) => item.id === nodeId
    ? { ...item, x: item.x + dx, y: item.y + dy, cx: item.cx + dx, cy: item.cy + dy }
    : item)
  const movedById = new Map(movedNodes.map((item) => [item.id, item]))

  let edges = current.edges
  if (attached.size > 0) {
    const relegged = new Map<MapEdge, MapEdge>()
    for (const edge of attached) {
      // L/R に割れたノードなど、同じ配線の両端が動く場合もあるので両方を見る
      const ends: boolean[] = []
      if (edge.from.id === nodeId) ends.push(true)
      if (edge.to.id === nodeId) ends.push(false)
      let points = edge.points
      for (const atStart of ends) {
        const next = relegEnd(points, atStart, dx, dy)
        if (!next) return null
        points = next
      }
      // 接続先も検査する。移動で位置関係が逆転すると、足が相手の内部へ折り返す。
      for (let i = 1; i < points.length; i++) {
        for (const other of movedNodes) {
          const margin = other.id === edge.from.id || other.id === edge.to.id ? 0 : MAP_CLEAR
          if (segmentHitsRect(points[i - 1], points[i], {
            x: other.x - margin, y: other.y - margin,
            w: other.w + margin * 2, h: other.h + margin * 2,
          })) return null
        }
      }
      relegged.set(edge, {
        ...edge,
        points,
        from: movedById.get(edge.from.id) ?? edge.from,
        to: movedById.get(edge.to.id) ?? edge.to,
      })
    }
    edges = current.edges.map((edge) => relegged.get(edge) ?? edge)

    // 足だけの補正で別の線へ並走すると、描画の縁取りに隠れて1本に見える。
    // 直交する交差は許し、レーン間隔を確保できない並走は全体再計算へ任せる。
    for (const edge of relegged.values()) {
      if (edge.isPairLink) continue
      for (const other of edges) {
        if (other === edge || other.isPairLink) continue
        for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1], b = edge.points[i]
          const horizontal = Math.abs(a.y - b.y) < 0.5
          for (let j = 1; j < other.points.length; j++) {
            const c = other.points[j - 1], d = other.points[j]
            if (horizontal !== (Math.abs(c.y - d.y) < 0.5)) continue
            const gap = horizontal ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x)
            if (gap >= LANE_PITCH) continue
            const overlap = horizontal
              ? Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
              : Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
            if (overlap > 1) return null
          }
        }
      }
    }
  }

  const bounds = {
    minX: Math.min(...movedNodes.map((item) => item.x)),
    minY: Math.min(...movedNodes.map((item) => item.y)),
    maxX: Math.max(...movedNodes.map((item) => item.x + item.w)),
    maxY: Math.max(...movedNodes.map((item) => item.y + item.h)),
  }
  // 機材より外側へ伸びた足もSVGの描画範囲に含める。負座標の経路は全体再計算で収める。
  let maxRouteX = bounds.maxX
  let maxRouteY = bounds.maxY
  for (const edge of edges) {
    for (const point of edge.points) {
      if (point.x < 0 || point.y < 0) return null
      maxRouteX = Math.max(maxRouteX, point.x)
      maxRouteY = Math.max(maxRouteY, point.y)
    }
  }
  return {
    layout: {
      ...current,
      nodes: movedNodes,
      edges,
      width: Math.max(current.width, maxRouteX + PAD),
      height: Math.max(current.height, maxRouteY + PAD),
      bounds,
    },
    provisional,
  }
}

export function dragEdgePoints(points: { x: number; y: number }[], from: boolean, to: boolean, pairLink: boolean, dx: number, dy: number): { x: number; y: number }[] {
  'worklet'
  if ((!from && !to) || (dx === 0 && dy === 0)) return points
  if (from && to) return points.map(p => ({ x: p.x + dx, y: p.y + dy }))
  if (!pairLink) {
    const relegged = relegEnd(points, from, dx, dy)
    if (relegged) return relegged
  }
  return points.map((p, i) => (from && i === 0) || (to && i === points.length - 1)
    ? { x: p.x + dx, y: p.y + dy } : p)
}
