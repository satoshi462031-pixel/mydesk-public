import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import ts from 'typescript'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { DeskPlan, Gadget, GadgetPlacement, MapConnection } from '../src/types'
import {
  buildAutoDraft,
  computeMapLayout,
  MapLayout,
  MapNode,
} from '../src/utils/connectionMapLayout'

type ComputeMapLayout = typeof computeMapLayout
type Point = { x: number; y: number }
type Scenario = {
  name: string
  gadgets: Gadget[]
  placements: GadgetPlacement[]
  connections: MapConnection[]
  offsets: Record<string, { dx: number; dy: number }>
  sizes: Record<string, { w: number; h: number }>
}
type Metrics = {
  edges: number
  length: number
  bends: number
  crossings: number
  /** 線の端（機器の口）から PORT_ZONE 以内で起きた交差。口のすぐ外を横切る線は、その機器につながって見える */
  portCrossings: number
  overlapLength: number
  nodePenetrations: number
  /** 端点以外の機器の縁から MAP_CLEAR 未満を通る区間（貫通はしないが、縁に沿って機器へ触れて見える） */
  nodeHugs: number
  terminalCollisions: number
  /** 辺を使う線が1本だけなのに、辺の中央から外れている接続点（曲がる線のみ。直線は相手とまっすぐ結ぶため外れてよい） */
  offCenterSingles: number
  /** 辺を2本以上が使い、並びの中心が辺の中央から LANE 半分以上ずれている辺 */
  unbalancedSides: number
}

const loadHeadLayout = (): ComputeMapLayout => {
  const source = execFileSync('git', ['show', 'HEAD:src/utils/connectionMapLayout.ts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: path.resolve('src/utils/connectionMapLayout.ts'),
  }).outputText
  const filename = path.resolve('src/utils/connectionMapLayout.ts')
  const module = { exports: {} as Record<string, unknown> }
  const localRequire = createRequire(filename)
  const run = new Function('exports', 'require', 'module', '__filename', '__dirname', compiled)
  run(module.exports, localRequire, module, filename, path.dirname(filename))
  const baseline = module.exports.computeMapLayout
  if (typeof baseline !== 'function') throw new Error('HEAD版 computeMapLayout を読み込めません')
  return baseline as ComputeMapLayout
}

let randomState = 0x20260816
const random = () => {
  randomState ^= randomState << 13
  randomState ^= randomState >>> 17
  randomState ^= randomState << 5
  return (randomState >>> 0) / 0x100000000
}

const direction = (a: Point, b: Point) =>
  Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? 'h' : 'v'
const routeLength = (points: Point[]) => points.slice(1).reduce(
  (total, point, index) => total + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y),
  0,
)
const routeBends = (points: Point[]) => {
  let bends = 0
  for (let i = 1; i < points.length - 1; i++) {
    if (direction(points[i - 1], points[i]) !== direction(points[i], points[i + 1])) bends++
  }
  return bends
}
const segments = (points: Point[]) => points.slice(1).map((point, index) => ({ a: points[index], b: point }))
const betweenStrict = (value: number, a: number, b: number) => value > Math.min(a, b) + 0.5 && value < Math.max(a, b) - 0.5
const perpendicularCross = (a: { a: Point; b: Point }, b: { a: Point; b: Point }) => {
  const ah = direction(a.a, a.b) === 'h'
  const bh = direction(b.a, b.b) === 'h'
  if (ah === bh) return false
  const h = ah ? a : b
  const v = ah ? b : a
  return betweenStrict(v.a.x, h.a.x, h.b.x) && betweenStrict(h.a.y, v.a.y, v.b.y)
}
const parallelOverlap = (a: { a: Point; b: Point }, b: { a: Point; b: Point }) => {
  const horizontal = direction(a.a, a.b) === 'h'
  if (horizontal !== (direction(b.a, b.b) === 'h')) return 0
  if (horizontal && Math.abs(a.a.y - b.a.y) > 0.5) return 0
  if (!horizontal && Math.abs(a.a.x - b.a.x) > 0.5) return 0
  const [a1, a2] = horizontal ? [a.a.x, a.b.x] : [a.a.y, a.b.y]
  const [b1, b2] = horizontal ? [b.a.x, b.b.x] : [b.a.y, b.b.y]
  return Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)))
}
const PORT_ZONE = 22
const crossingPoint = (a: { a: Point; b: Point }, b: { a: Point; b: Point }): Point =>
  direction(a.a, a.b) === 'h' ? { x: b.a.x, y: a.a.y } : { x: a.a.x, y: b.a.y }
const nearEnd = (points: Point[], p: Point) =>
  Math.min(Math.hypot(points[0].x - p.x, points[0].y - p.y), Math.hypot(points[points.length - 1].x - p.x, points[points.length - 1].y - p.y)) < PORT_ZONE
const HUG_CLEAR = 8.5
const segmentHugs = (segment: { a: Point; b: Point }, node: MapNode) => {
  const x0 = Math.min(segment.a.x, segment.b.x), x1 = Math.max(segment.a.x, segment.b.x)
  const y0 = Math.min(segment.a.y, segment.b.y), y1 = Math.max(segment.a.y, segment.b.y)
  return x1 > node.x - HUG_CLEAR && x0 < node.x + node.w + HUG_CLEAR && y1 > node.y - HUG_CLEAR && y0 < node.y + node.h + HUG_CLEAR
}
const segmentPenetrates = (segment: { a: Point; b: Point }, node: MapNode) => {
  const horizontal = direction(segment.a, segment.b) === 'h'
  if (horizontal) {
    if (segment.a.y <= node.y + 0.5 || segment.a.y >= node.y + node.h - 0.5) return false
    return Math.max(Math.min(segment.a.x, segment.b.x), node.x) < Math.min(Math.max(segment.a.x, segment.b.x), node.x + node.w) - 0.5
  }
  if (segment.a.x <= node.x + 0.5 || segment.a.x >= node.x + node.w - 0.5) return false
  return Math.max(Math.min(segment.a.y, segment.b.y), node.y) < Math.min(Math.max(segment.a.y, segment.b.y), node.y + node.h) - 0.5
}

const measure = (layout: MapLayout): Metrics => {
  const metrics: Metrics = { edges: layout.edges.length, length: 0, bends: 0, crossings: 0, portCrossings: 0, overlapLength: 0, nodePenetrations: 0, nodeHugs: 0, terminalCollisions: 0, offCenterSingles: 0, unbalancedSides: 0 }
  for (const edge of layout.edges) {
    metrics.length += routeLength(edge.points)
    metrics.bends += routeBends(edge.points)
    for (const segment of segments(edge.points)) {
      for (const node of layout.nodes) {
        if (node.id === edge.from.id || node.id === edge.to.id) continue
        if (segmentPenetrates(segment, node)) metrics.nodePenetrations++
        else if (segmentHugs(segment, node)) metrics.nodeHugs++
      }
    }
  }
  for (let i = 0; i < layout.edges.length; i++) {
    for (let j = i + 1; j < layout.edges.length; j++) {
      for (const a of segments(layout.edges[i].points)) {
        for (const b of segments(layout.edges[j].points)) {
          if (perpendicularCross(a, b)) {
            metrics.crossings++
            const p = crossingPoint(a, b)
            if (nearEnd(layout.edges[i].points, p) || nearEnd(layout.edges[j].points, p)) metrics.portCrossings++
          }
          metrics.overlapLength += parallelOverlap(a, b)
        }
      }
    }
  }
  const terminals = new Map<string, Point[]>()
  for (const edge of layout.edges) {
    terminals.set(edge.from.id, [...(terminals.get(edge.from.id) ?? []), edge.points[0]])
    terminals.set(edge.to.id, [...(terminals.get(edge.to.id) ?? []), edge.points[edge.points.length - 1]])
  }
  for (const points of terminals.values()) {
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < 13.5) metrics.terminalCollisions++
    }
  }
  // 辺ごとの接続点。同じ点を共有する分岐の枝は1つに数える
  const sides = new Map<string, { node: MapNode; side: string; coords: number[]; bent: boolean[] }>()
  const sideOf = (node: MapNode, p: Point) =>
    Math.abs(p.y - node.y) < 0.5 ? 'top' : Math.abs(p.y - (node.y + node.h)) < 0.5 ? 'bottom'
      : Math.abs(p.x - node.x) < 0.5 ? 'left' : Math.abs(p.x - (node.x + node.w)) < 0.5 ? 'right' : null
  for (const edge of layout.edges) {
    if (edge.isPairLink || edge.conn.cableType === 'WiFi' || edge.points.length < 2) continue
    for (const [node, p] of [[edge.from, edge.points[0]], [edge.to, edge.points[edge.points.length - 1]]] as const) {
      const side = sideOf(node, p)
      if (!side) continue
      const key = node.id + ':' + side
      const entry = sides.get(key) ?? { node, side, coords: [], bent: [] }
      const coord = side === 'top' || side === 'bottom' ? p.x : p.y
      if (!entry.coords.some((c) => Math.abs(c - coord) < 0.5)) {
        entry.coords.push(coord)
        entry.bent.push(routeBends(edge.points) > 0)
      }
      sides.set(key, entry)
    }
  }
  for (const { node, side, coords, bent } of sides.values()) {
    const center = side === 'top' || side === 'bottom' ? node.x + node.w / 2 : node.y + node.h / 2
    if (coords.length === 1) {
      if (bent[0] && Math.abs(coords[0] - center) > 1) metrics.offCenterSingles++
    } else {
      const mean = coords.reduce((a, b) => a + b, 0) / coords.length
      if (Math.abs(mean - center) > 7) metrics.unbalancedSides++
    }
  }
  return metrics
}

const edgeMetricMap = (layout: MapLayout) => new Map(layout.edges.map((edge) => [
  edge.conn.id,
  { length: routeLength(edge.points), bends: routeBends(edge.points) },
]))

const sum = (values: Metrics[]): Metrics => values.reduce<Metrics>((total, value) => ({
  edges: total.edges + value.edges,
  length: total.length + value.length,
  bends: total.bends + value.bends,
  crossings: total.crossings + value.crossings,
  portCrossings: total.portCrossings + value.portCrossings,
  overlapLength: total.overlapLength + value.overlapLength,
  nodePenetrations: total.nodePenetrations + value.nodePenetrations,
  nodeHugs: total.nodeHugs + value.nodeHugs,
  terminalCollisions: total.terminalCollisions + value.terminalCollisions,
  offCenterSingles: total.offCenterSingles + value.offCenterSingles,
  unbalancedSides: total.unbalancedSides + value.unbalancedSides,
}), { edges: 0, length: 0, bends: 0, crossings: 0, portCrossings: 0, overlapLength: 0, nodePenetrations: 0, nodeHugs: 0, terminalCollisions: 0, offCenterSingles: 0, unbalancedSides: 0 })

const buildScenarios = (): Scenario[] => {
  const scenarios: Scenario[] = []
  for (const { demo, plan, activeGadgets } of buildAllDemoDesks('ja')) {
    const selected = new Set(activeGadgets.map((gadget) => gadget.id))
    scenarios.push({
      name: `demo:${demo.id}`,
      gadgets: activeGadgets,
      placements: plan.placements.filter((placement) => selected.has(placement.gadgetId)),
      connections: plan.connectionMap?.connections ?? buildAutoDraft(activeGadgets, plan, 'ja'),
      offsets: {},
      sizes: {},
    })
    for (let variant = 0; variant < 9; variant++) {
      const ratio = 0.55 + random() * 0.4
      const gadgets = activeGadgets.filter((gadget) => gadget.category === 'PC' || gadget.category === 'PowerStrip' || random() < ratio)
      const ids = new Set(gadgets.map((gadget) => gadget.id))
      const placements = plan.placements.filter((placement) => ids.has(placement.gadgetId))
      const variantPlan: DeskPlan = { ...plan, selectedGadgetIds: [...ids], placements, connectionMap: undefined }
      const offsets: Scenario['offsets'] = {}
      const sizes: Scenario['sizes'] = {}
      if (variant >= 6) {
        for (const gadget of gadgets) {
          if (random() < 0.25) offsets[gadget.id] = { dx: Math.round((random() - 0.5) * 100), dy: Math.round((random() - 0.5) * 80) }
          if (random() < 0.2) sizes[gadget.id] = { w: 68 + Math.round(random() * 180), h: 68 + Math.round(random() * 130) }
        }
      }
      scenarios.push({
        name: `variant:${demo.id}:${variant}`,
        gadgets,
        placements,
        connections: buildAutoDraft(gadgets, variantPlan, 'ja'),
        offsets,
        sizes,
      })
    }
  }
  return scenarios
}

const main = async () => {
  const baselineCompute = loadHeadLayout()
  const scenarios = buildScenarios()
  const baselineMetrics: Metrics[] = []
  const currentMetrics: Metrics[] = []
  let commonEdges = 0
  let baselineCommonLength = 0
  let currentCommonLength = 0
  let baselineCommonBends = 0
  let currentCommonBends = 0
  let removedEdges = 0
  let addedEdges = 0
  const changes: Array<{ name: string; baseline: Metrics; current: Metrics }> = []
  for (const scenario of scenarios) {
    const baselineLayout = await baselineCompute(scenario.gadgets, scenario.connections, scenario.placements, scenario.offsets, scenario.sizes)
    const currentLayout = await computeMapLayout(scenario.gadgets, scenario.connections, scenario.placements, scenario.offsets, scenario.sizes)
    const baseline = measure(baselineLayout)
    const current = measure(currentLayout)
    const baselineEdges = edgeMetricMap(baselineLayout)
    const currentEdges = edgeMetricMap(currentLayout)
    for (const [key, value] of baselineEdges) {
      const next = currentEdges.get(key)
      if (!next) { removedEdges++; continue }
      commonEdges++
      baselineCommonLength += value.length
      currentCommonLength += next.length
      baselineCommonBends += value.bends
      currentCommonBends += next.bends
    }
    for (const key of currentEdges.keys()) if (!baselineEdges.has(key)) addedEdges++
    baselineMetrics.push(baseline)
    currentMetrics.push(current)
    changes.push({ name: scenario.name, baseline, current })
  }
  const baseline = sum(baselineMetrics)
  const current = sum(currentMetrics)
  const delta = Object.fromEntries(Object.keys(baseline).map((key) => {
    const metric = key as keyof Metrics
    return [key, current[metric] - baseline[metric]]
  }))
  const percent = (before: number, after: number) => before === 0 ? null : Number((((before - after) / before) * 100).toFixed(1))
  const reductionPercent = Object.fromEntries(Object.keys(baseline).map((key) => {
    const metric = key as keyof Metrics
    return [key, percent(baseline[metric], current[metric])]
  }))
  const worst = [...changes].sort((a, b) =>
    (b.current.bends - b.baseline.bends) - (a.current.bends - a.baseline.bends) ||
    (b.current.length - b.baseline.length) - (a.current.length - a.baseline.length),
  ).slice(0, 8).map((item) => ({
    name: item.name,
    bends: [item.baseline.bends, item.current.bends],
    length: [Math.round(item.baseline.length), Math.round(item.current.length)],
    crossings: [item.baseline.crossings, item.current.crossings],
    portCrossings: [item.baseline.portCrossings, item.current.portCrossings],
  }))
  const common = {
    edges: commonEdges,
    removedEdges,
    addedEdges,
    baselineLength: baselineCommonLength,
    currentLength: currentCommonLength,
    lengthReduction: baselineCommonLength - currentCommonLength,
    lengthReductionPercent: percent(baselineCommonLength, currentCommonLength),
    baselineBends: baselineCommonBends,
    currentBends: currentCommonBends,
    bendReduction: baselineCommonBends - currentCommonBends,
    bendReductionPercent: percent(baselineCommonBends, currentCommonBends),
  }
  const demoChanges = changes.filter((item) => item.name.startsWith('demo:'))
  const demoBaseline = sum(demoChanges.map((item) => item.baseline))
  const demoCurrent = sum(demoChanges.map((item) => item.current))
  const demos = {
    scenarioCount: demoChanges.length,
    baseline: demoBaseline,
    current: demoCurrent,
    lengthReduction: demoBaseline.length - demoCurrent.length,
    lengthReductionPercent: percent(demoBaseline.length, demoCurrent.length),
    bendReduction: demoBaseline.bends - demoCurrent.bends,
    bendReductionPercent: percent(demoBaseline.bends, demoCurrent.bends),
  }
  console.log(JSON.stringify({ scenarioCount: scenarios.length, baseline, current, delta, reductionPercent, common, demos, worst }, null, 2))
}

void main()
