import type { CableType } from '../types'
import type { MapEdge, MapLayout, MapNode } from './connectionMapLayout'

// オープニングの描画データ。配置は焼いた配線図（onboardingWiring）のものをそのまま使い、
// 枠は描かずアイコンだけを置く。線は枠の縁から、アイコンの少し手前まで引き直す。

export interface OpeningSceneNode {
  key: string
  category: string
  outlet: boolean
  pcFormFactor?: 'laptop'
  cx: number
  cy: number
  size: number
  arrive: number
}

export interface OpeningSceneWire {
  d: string
  length: number
  start: number
  end: number
  cable: CableType
}

export interface OpeningScene {
  width: number
  height: number
  nodes: OpeningSceneNode[]
  wires: OpeningSceneWire[]
}

type Point = { x: number; y: number }

// 枠の短辺に対するアイコンの大きさ
const ICON_RATIO = 0.8
// 機材どうしの間隔を詰める割合（アイコンの大きさは変えない）。枠付きの配線図は枠の分だけ間が空いているので、
// 枠を描かないオープニングでは詰めて、画面いっぱいにアイコンを大きく見せる
const COMPACT = 0.75

// 焼いた配線図の機材と配線を使う。ただしPCはノートPCの絵にして、キーボード（ノートPC自身が持つ）は描かない
const OMITTED = new Set(['opening-keyboard'])
const PC_FORM_FACTOR = 'laptop'
// 配置はPCを中心に置き直す（枠を描かないので、枠に合わせた配置より詰められる）。座標は機材の中心がPC＝(0,0)の位置。
// 線は両端を機材の中心から始めればよく、アイコンの手前までは attach() が削る。
// モニターの電源（電源タップ→モニター）は、他の線に交わらないようヘッドホンの外側を回す。
// 焼いた配線図に機材や配線が増えたときは、ここに無いものがあるので、COMPACT で詰めた元の配置にもどる
const ARRANGEMENT: Record<string, Point> = {
  'opening-pc': { x: 0, y: 0 },
  'opening-monitor': { x: 0, y: -120 },
  'opening-headphone': { x: -115, y: 0 },
  'opening-mouse': { x: 115, y: 0 },
  'opening-strip': { x: 0, y: 105 },
  wall: { x: 0, y: 195 },
}
const ROUTES: Record<string, Point[]> = {
  'opening-pc>opening-monitor': [{ x: 0, y: 0 }, { x: 0, y: -120 }],
  'opening-pc>opening-headphone': [{ x: 0, y: 0 }, { x: -115, y: 0 }],
  'opening-pc>opening-mouse': [{ x: 0, y: 0 }, { x: 115, y: 0 }],
  'wall>opening-strip': [{ x: 0, y: 195 }, { x: 0, y: 105 }],
  'opening-strip>opening-pc': [{ x: 0, y: 105 }, { x: 0, y: 0 }],
  'opening-strip>opening-monitor': [{ x: 0, y: 105 }, { x: -175, y: 105 }, { x: -175, y: -120 }, { x: 0, y: -120 }],
}
const WIRE_GAP = 6
const CORNER = 12
const MARGIN = 16
// 最後の1本を引き終えてから図の縮小（0.76）まで間を置き、完成した配線を見せる。
// 始まりは、コンセントが出きってから約0.4秒（3秒の演出で）コンセントだけを見せてから。
// 出た直後に線を伸ばすと、どこから配線が始まったのかが読めない
const WIRE_START = 0.28
const WIRE_END = 0.7
// 線の尺は長さの0.6乗に比例させる。比例のままだと一番長い1本が全体の半分近くを占める
const DURATION_EXPONENT = 0.6
const ARRIVE_LEAD = 0.04
const MONITOR_ARRIVE_LEAD = 0.12

// 暗い色を、色相を保ったまま明るい側へ寄せる。明るさがこの値以上の色と、緑系は動かさない
// （緑は暗いままでも読めるうえ、明るくすると蛍光色になる）。
// 明るくしただけだと蛍光色になり、白い地では黄色や薄い緑が見えなくなるので、彩度に上限を置く
const BRIGHT_TARGET = 0.55
const BRIGHT_STRENGTH = 0.8
const MAX_SATURATION = 0.85
const GREEN_HUES = { from: 75, to: 175 }

/** 黒や濃い赤・緑・青などの暗い色を明るくする。#RRGGBB 以外はそのまま返す */
export function brighten(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (l >= BRIGHT_TARGET) return hex
  const d = max - min
  const s = d === 0 ? 0 : Math.min(MAX_SATURATION, d / (1 - Math.abs(2 * l - 1)))
  let h = 0
  if (d !== 0) {
    h = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60
    if (h < 0) h += 360
    if (h >= GREEN_HUES.from && h <= GREEN_HUES.to) return hex
  }
  const l2 = l + (BRIGHT_TARGET - l) * BRIGHT_STRENGTH
  const c = (1 - Math.abs(2 * l2 - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const base = l2 - c / 2
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  const byte = (v: number) => Math.round((v + base) * 255).toString(16).padStart(2, '0')
  return `#${byte(r1)}${byte(g1)}${byte(b1)}`
}

const polylineLength = (points: Point[]) =>
  points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0)

// 角を丸めた直角配線。曲がり角で半径が隣の線分の半分を超えないようにする
function roundedPath(points: Point[]): string {
  const f = (n: number) => Math.round(n * 10) / 10
  let d = `M${f(points[0].x)} ${f(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], at = points[i], next = points[i + 1]
    const inLen = Math.hypot(at.x - prev.x, at.y - prev.y)
    const outLen = Math.hypot(next.x - at.x, next.y - at.y)
    const r = Math.min(CORNER, inLen / 2, outLen / 2)
    const a = { x: at.x - (at.x - prev.x) / inLen * r, y: at.y - (at.y - prev.y) / inLen * r }
    const b = { x: at.x + (next.x - at.x) / outLen * r, y: at.y + (next.y - at.y) / outLen * r }
    d += `L${f(a.x)} ${f(a.y)}Q${f(at.x)} ${f(at.y)} ${f(b.x)} ${f(b.y)}`
  }
  const last = points[points.length - 1]
  return `${d}L${f(last.x)} ${f(last.y)}`
}

interface IconBox { left: number; right: number; top: number; bottom: number }

const iconBox = (n: MapNode, c: Point): IconBox => {
  const half = Math.min(n.w, n.h) * ICON_RATIO / 2
  return { left: c.x - half, right: c.x + half, top: c.y - half, bottom: c.y + half }
}

// 枠の縁にある線の端を、アイコンの手前まで動かす。向きは「枠から隣の点へ向かう方向」で決める。
// 線がアイコンの幅（高さ）から外れて着いているときは、動かさない
function attach(end: Point, neighbor: Point, box: IconBox): Point {
  if (end.y === neighbor.y && end.y >= box.top && end.y <= box.bottom) {
    return { x: neighbor.x > end.x ? box.right + WIRE_GAP : box.left - WIRE_GAP, y: end.y }
  }
  if (end.x === neighbor.x && end.x >= box.left && end.x <= box.right) {
    return { x: end.x, y: neighbor.y > end.y ? box.bottom + WIRE_GAP : box.top - WIRE_GAP }
  }
  return end
}

/**
 * コンセントから近い（短い）線の順に、すでに出ている機材から次の機材へ線を伸ばす。電源は出どころが同じものを同時に伸ばす。
 * どの機材にも着いたあとに残る線（輪になる映像線など）は、最後にまとめて通して締める。
 */
export function buildOpeningScene(layout: MapLayout): OpeningScene {
  const nodes = layout.nodes.filter(n => !OMITTED.has(n.id))
  const layoutEdges = layout.edges.filter(e => !OMITTED.has(e.from.id) && !OMITTED.has(e.to.id))
  const root = nodes.find(n => n.isWall) ?? nodes[0]
  const routeKey = (edge: MapEdge) => `${edge.from.id}>${edge.to.id}`
  const arranged = nodes.every(n => ARRANGEMENT[n.id]) && layoutEdges.every(e => ROUTES[routeKey(e)])
  // 置き直せないときは、図の中心に向けて間隔を詰める。線は直角のまま、機材の中心と同じ変換で動かす
  const mid = { x: (layout.bounds.minX + layout.bounds.maxX) / 2, y: (layout.bounds.minY + layout.bounds.maxY) / 2 }
  const compact = (p: Point): Point => ({ x: mid.x + (p.x - mid.x) * COMPACT, y: mid.y + (p.y - mid.y) * COMPACT })
  const centers = new Map(nodes.map(n => [n.id, arranged ? ARRANGEMENT[n.id] : compact({ x: n.cx, y: n.cy })]))
  const boxes = new Map(nodes.map(n => [n.id, iconBox(n, centers.get(n.id)!)]))
  const edges = layoutEdges.map((edge, index) => {
    const from = boxes.get(edge.from.id)!, to = boxes.get(edge.to.id)!
    const points = (arranged ? ROUTES[routeKey(edge)] : edge.points).map(p => arranged ? { ...p } : compact(p))
    points[0] = attach(points[0], points[1], from)
    points[points.length - 1] = attach(points[points.length - 1], points[points.length - 2], to)
    return { edge, index, points, length: polylineLength(points) }
  })

  // 時刻はまず線の重みの単位で積み、最後に WIRE_START〜WIRE_END へ縮める
  const weight = (e: (typeof edges)[number]) => Math.pow(e.length, DURATION_EXPONENT)
  const seen = new Set([root.id])
  const drawn = new Set<number>()
  const reached = new Map<string, number>([[root.id, 0]])
  const order: { index: number; points: Point[]; length: number; arriving: string | null; start: number; end: number; alongside?: boolean }[] = []
  let cursor = 0
  while (seen.size < nodes.length) {
    let next: (typeof edges)[number] | undefined
    for (const e of edges) {
      if (drawn.has(e.index) || seen.has(e.edge.from.id) === seen.has(e.edge.to.id)) continue
      if (!next || e.length < next.length) next = e
    }
    if (!next) break
    const source = seen.has(next.edge.from.id) ? next.edge.from.id : next.edge.to.id
    // 電源タップが出たら、そこから出る電源はまとめて同時に伸ばす（モニターの電源をPCの後回しにしない）。
    // 一緒に伸ばした線は順番を進めず、着いた機材はその線を引き終えたときに出る
    const group = next.edge.conn.cableType !== 'Power' ? [next] : [next, ...edges.filter(e => e !== next && !drawn.has(e.index)
      && e.edge.conn.cableType === 'Power' && (e.edge.from.id === source ? !seen.has(e.edge.to.id) : e.edge.to.id === source && !seen.has(e.edge.from.id)))]
    const start = cursor
    for (const e of group) {
      drawn.add(e.index)
      const reverse = e.edge.from.id !== source
      const arriving = reverse ? e.edge.from.id : e.edge.to.id
      seen.add(arriving)
      const end = start + weight(e)
      reached.set(arriving, end)
      order.push({ index: e.index, points: reverse ? e.points.slice().reverse() : e.points, length: e.length, arriving, start, end, alongside: e !== next })
    }
    cursor = start + weight(next)
  }
  // 一緒に伸ばした長い線（モニターの電源は外側を回るので他の数倍ある）は、他の線を引き終えるまでに着かせる。
  // 重みのまま引くと、ほかの機材がそろってから長い線だけが伸び続ける間ができる
  for (const o of order) {
    if (!o.alongside || o.end <= cursor) continue
    o.end = cursor
    reached.set(o.arriving!, cursor)
  }
  // 輪になる線は、両端の機材が出てから通す
  const closing: { ends: string[]; end: number }[] = []
  edges.filter(e => !drawn.has(e.index)).sort((a, b) => a.length - b.length).forEach(e => {
    const start = Math.max(cursor, reached.get(e.edge.from.id) ?? 0, reached.get(e.edge.to.id) ?? 0)
    cursor = start + weight(e)
    order.push({ index: e.index, points: e.points, length: e.length, arriving: null, start, end: cursor })
    closing.push({ ends: [e.edge.from.id, e.edge.to.id], end: cursor })
  })
  // 一緒に伸ばした線の着く機材へ、輪になる線もあとから着くときは、両方を同時に着かせる。
  // 先に電源だけ着いて映像線を待つ間ができるので、電源の線をゆっくり伸ばして映像線に合わせる
  for (const o of order) {
    if (!o.alongside) continue
    const together = closing.filter(c => c.ends.includes(o.arriving!)).map(c => c.end)
    if (together.length) o.end = Math.max(o.end, ...together)
  }

  const total = Math.max(...order.map(o => o.end))
  const toTime = (t: number) => WIRE_START + (WIRE_END - WIRE_START) * t / total
  const arrive = new Map<string, number>([[root.id, 0]])
  const timing = order.map(o => {
    const start = toTime(o.start), end = toTime(o.end)
    if (o.arriving) {
      // モニターは最後の映像線まで待つため、少し先に出して図の完成を見せる。
      const lead = nodes.find(n => n.id === o.arriving)?.gadget.category === 'Monitor' ? MONITOR_ARRIVE_LEAD : ARRIVE_LEAD
      arrive.set(o.arriving, Math.max(start, end - lead))
    }
    return { length: Math.ceil(o.length) + 8, start, end, cable: edges[o.index].edge.conn.cableType }
  })

  const xs: number[] = [], ys: number[] = []
  for (const b of boxes.values()) { xs.push(b.left, b.right); ys.push(b.top, b.bottom) }
  for (const e of edges) for (const p of e.points) { xs.push(p.x); ys.push(p.y) }
  // 置き直したときはPCが図の真ん中になるよう、遠い側に合わせて左右・上下とも同じだけ余白をとる
  const halfW = Math.max(...xs.map(Math.abs)) + MARGIN, halfH = Math.max(...ys.map(Math.abs)) + MARGIN
  const minX = arranged ? -halfW : Math.min(...xs) - MARGIN
  const minY = arranged ? -halfH : Math.min(...ys) - MARGIN
  const shift = (p: Point): Point => ({ x: p.x - minX, y: p.y - minY })

  return {
    width: Math.ceil(arranged ? halfW * 2 : Math.max(...xs) - minX + MARGIN),
    height: Math.ceil(arranged ? halfH * 2 : Math.max(...ys) - minY + MARGIN),
    nodes: nodes.map(n => {
      const c = shift(centers.get(n.id)!)
      return {
        key: n.id,
        category: n.gadget.category,
        outlet: n.isWall,
        ...(n.gadget.category === 'PC' ? { pcFormFactor: PC_FORM_FACTOR } : {}),
        cx: c.x,
        cy: c.y,
        size: Math.min(n.w, n.h) * ICON_RATIO,
        arrive: arrive.get(n.id) ?? 0,
      }
    }),
    wires: order.map((o, i) => ({ d: roundedPath(o.points.map(shift)), ...timing[i] })),
  }
}
