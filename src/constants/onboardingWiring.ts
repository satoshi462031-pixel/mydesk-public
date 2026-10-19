import { MapEdge, MapLayout, MapNode } from '../utils/connectionMapLayout'
import { LAYOUT_VERSION } from '../utils/mapLayoutCache'
import { ONBOARDING_WIRING_JSON, OPENING_WIRING_JSON } from './onboardingWiring.generated'

// オンボーディングとオープニングで見せる配線図。中身は scripts/buildOnboardingWiring.ts が
// 事前計算したもの。起動直後にルーティング計算を走らせないための措置。

interface SerializedEdge {
  conn: MapEdge['conn']
  fromId: string
  toId: string
  points: { x: number; y: number }[]
  isPairLink?: boolean
}

interface SerializedLayout {
  layoutVersion: number
  demoId: string
  width: number
  height: number
  bounds: MapLayout['bounds']
  nodes: MapNode[]
  edges: SerializedEdge[]
}

let cached: MapLayout | null = null
let openingCached: MapLayout | null = null

function parseLayout(json: string, label: string): MapLayout {
  const raw = JSON.parse(json) as SerializedLayout
  if (__DEV__ && raw.layoutVersion !== LAYOUT_VERSION) {
    console.warn(
      `[onboarding] 焼いた${label}が古い（v${raw.layoutVersion} / 現在 v${LAYOUT_VERSION}）。`
      + ' npm run build:onboarding-wiring で作り直す',
    )
  }
  const byId = new Map(raw.nodes.map((node) => [node.id, node]))
  const edges: MapEdge[] = []
  for (const edge of raw.edges) {
    const from = byId.get(edge.fromId)
    const to = byId.get(edge.toId)
    if (!from || !to) continue
    edges.push({ conn: edge.conn, from, to, points: edge.points, ...(edge.isPairLink ? { isPairLink: true } : {}) })
  }
  return { nodes: raw.nodes, edges, width: raw.width, height: raw.height, bounds: raw.bounds }
}

/** 初回呼び出しでだけ JSON を展開する。オンボーディングは1回きりなので使い捨てで良い */
export function getOnboardingWiringLayout(): MapLayout {
  return cached ??= parseLayout(ONBOARDING_WIRING_JSON, '配線図')
}

/** 起動直後のオープニングで組み上げるデスクの配線図 */
export function getOpeningWiringLayout(): MapLayout {
  return openingCached ??= parseLayout(OPENING_WIRING_JSON, 'オープニングの配線図')
}
