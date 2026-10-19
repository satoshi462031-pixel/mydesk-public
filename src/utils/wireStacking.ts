import { WIRE_CASING_WIDTH, WIRE_CROSSING_CUT_WIDTH } from '../constants/wiring'
import { CableType } from '../types'

// 交差したときの上下は描く順で決まる（後から描いた線の縁取りが先の線を切る）。
// 接続を作った順のまま描くと、長い電源の幹線が上に来て短い信号線を何か所も途切れさせ、
// つなぎ直しただけで上下が入れ替わる。種類で層を分け、同じ層では長い線ほど下に敷く
// （長い線ほど交差が多いので、下に回すと途切れる線の数が減る）。

// 物理的なケーブルではない線（無線・アーム・スピーカー対の破線）は読み飛ばしてよいので最下層
const UNDERLAY_TYPES = new Set<CableType>([
  'Bluetooth', 'XboxWireless', 'WiFi', 'wirelessCharging', 'Stylus', 'MonitorArm', 'MicArm',
])
const POWER_TYPES = new Set<CableType>(['Power', 'DCPower', 'Battery'])

type StackableEdge = {
  conn: { cableType: CableType }
  points: { x: number; y: number }[]
  isPairLink?: boolean
}

function wireLayer(edge: StackableEdge): number {
  if (edge.isPairLink || UNDERLAY_TYPES.has(edge.conn.cableType)) return 0
  if (POWER_TYPES.has(edge.conn.cableType)) return 1
  return 2
}

function pathLength(points: { x: number; y: number }[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return len
}

/** 描く順（先頭が最下層）に並べ替えた新しい配列を返す。同じ層・同じ長さは元の順を保つ */
export function sortEdgesForDrawing<T extends StackableEdge>(edges: readonly T[]): T[] {
  return edges
    .map((edge, index) => ({ edge, index, layer: wireLayer(edge), length: pathLength(edge.points) }))
    .sort((a, b) => a.layer - b.layer || b.length - a.length || a.index - b.index)
    .map((item) => item.edge)
}

type Point = { x: number; y: number }
type BranchEdge = StackableEdge & {
  conn: { branchGroupId?: string }
  from: { id: string }
  to: { id: string }
}

function firstBranchPoint(a: Point[], b: Point[]): Point | undefined {
  if (!a.length || !b.length || a[0].x !== b[0].x || a[0].y !== b[0].y) return
  let point = a[0]
  let i = 1
  let j = 1
  while (i < a.length && j < b.length) {
    const ax = a[i].x - point.x
    const ay = a[i].y - point.y
    const bx = b[j].x - point.x
    const by = b[j].y - point.y
    const al = Math.hypot(ax, ay)
    const bl = Math.hypot(bx, by)
    if (al === 0) { i++; continue }
    if (bl === 0) { j++; continue }
    if (Math.abs(ax * by - ay * bx) > 0.001 || ax * bx + ay * by <= 0) {
      return point.x !== a[0].x || point.y !== a[0].y ? point : undefined
    }
    point = al <= bl ? a[i++] : b[j++]
    if (al === bl) j++
  }
}

/** 描画順で後の枝に接続点を割り当て、別ケーブルの交差には通常の縁取りを効かせる。 */
export function branchJunctionsForDrawing<T extends BranchEdge>(edges: readonly T[]): Map<T, Point[]> {
  const result = new Map<T, Point[]>()
  const groups = new Map<string, T[]>()
  for (const edge of edges) {
    if (!edge.conn.branchGroupId || wireLayer(edge) === 0) continue
    const group = groups.get(edge.conn.branchGroupId) ?? []
    group.push(edge)
    groups.set(edge.conn.branchGroupId, group)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const shared = [group[0].from.id, group[0].to.id].filter((id) =>
      group.every((edge) => edge.from.id === id || edge.to.id === id))
    if (shared.length !== 1) continue
    const paths = group.map((edge) => edge.from.id === shared[0] ? edge.points : [...edge.points].reverse())
    const seen = new Set<string>()
    // 後の枝を優先すると、3本以上が同じ場所で分かれても丸印が縁取りで欠けない。
    for (let j = group.length - 1; j > 0; j--) {
      for (let i = 0; i < j; i++) {
        const point = firstBranchPoint(paths[i], paths[j])
        if (!point) continue
        const key = `${point.x},${point.y}`
        if (seen.has(key)) continue
        seen.add(key)
        const points = result.get(group[j]) ?? []
        points.push(point)
        result.set(group[j], points)
      }
    }
  }
  return result
}

export type CrossingCut = { x: number; y: number; horizontal: boolean; halfWidth: number }

type CuttableEdge = StackableEdge & { conn: { branchGroupId?: string } }

// 下の線の端（機器の口）にこれより寄せて切らない。切れ目が口まで届くと、線が機器から離れて見える
const CUT_END_MARGIN = 3

/**
 * 交差点ごとに、上の線に沿って背景色を短く敷く位置を返す（キーは上に描く線）。
 * 上の線の縁取りより下の線の切れ目を広げ、つながっていないことを縮小表示でも読めるようにする。
 * 同じ分岐ケーブルの枝どうしと、スピーカー対の破線は対象外
 */
export function crossingCutsForDrawing<T extends CuttableEdge>(edges: readonly T[]): Map<T, CrossingCut[]> {
  const result = new Map<T, CrossingCut[]>()
  const segments = edges.map((edge) => edge.isPairLink ? [] : edge.points.slice(1).flatMap((b, i) => {
    const a = edge.points[i]
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 0.5) return [{ horizontal: true, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) }]
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) >= 0.5) return [{ horizontal: false, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) }]
    return []
  }))
  for (let j = 1; j < edges.length; j++) {
    const upper = edges[j]
    for (let i = 0; i < j; i++) {
      const lower = edges[i]
      if (upper.conn.branchGroupId && upper.conn.branchGroupId === lower.conn.branchGroupId) continue
      const first = lower.points[0], last = lower.points[lower.points.length - 1]
      for (const u of segments[j]) for (const l of segments[i]) {
        if (u.horizontal === l.horizontal) continue
        // 交点が両方の線分の内側にあるときだけ（端どうしが触れるのは交差ではない）
        if (!(l.c > u.lo && l.c < u.hi && u.c > l.lo && u.c < l.hi)) continue
        const x = u.horizontal ? l.c : u.c, y = u.horizontal ? u.c : l.c
        const toEnd = Math.min(Math.hypot(first.x - x, first.y - y), Math.hypot(last.x - x, last.y - y))
        const halfWidth = Math.min(WIRE_CROSSING_CUT_WIDTH / 2, toEnd - CUT_END_MARGIN)
        if (halfWidth <= WIRE_CASING_WIDTH / 2) continue
        const cuts = result.get(upper) ?? []
        cuts.push({ x, y, horizontal: u.horizontal, halfWidth })
        result.set(upper, cuts)
      }
    }
  }
  return result
}

/** 切れ目1か所の SVG パス。上の線に沿った向きで、下の線の太さを覆う長さだけ引く */
export function crossingCutPath(cut: CrossingCut): string {
  const along = WIRE_CASING_WIDTH / 2
  return cut.horizontal
    ? `M${cut.x - along} ${cut.y}H${cut.x + along}`
    : `M${cut.x} ${cut.y - along}V${cut.y + along}`
}
