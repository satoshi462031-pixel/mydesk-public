import { Gadget, MapConnection } from '../types'
import { baseMapNodeId, wiringMapGadgets } from './connectionMapLayout'
import type { MapEdge, MapLayout, MapNode } from './connectionMapLayout'

const intersectionSize = (a: Set<string>, b: Set<string>) => {
  let count = 0
  for (const value of a) if (b.has(value)) count++
  return count
}

function connectionTokens(gadgetId: string, connections: MapConnection[]): Set<string> {
  const tokens = new Set<string>()
  for (const connection of connections) {
    if (connection.fromGadgetId === gadgetId) {
      tokens.add(`${connection.toGadgetId}|${connection.cableType}`)
    } else if (connection.toGadgetId === gadgetId) {
      tokens.add(`${connection.fromGadgetId}|${connection.cableType}`)
    }
  }
  return tokens
}

const portTokens = (gadget: Gadget) => new Set(
  gadget.ports.map((port) => `${port.type}|${port.direction}`),
)

/**
 * 同じイベントの撤去ガジェットと導入ガジェットを、安全に1対1で対応付ける。
 * 同カテゴリが1組だけなら明確な買い替えとして扱う。複数候補がある場合は、
 * 接続先・ケーブル種別・ポート構成の一致が双方から一意になる組だけ採用する。
 */
export function buildHistoryReplacementPairs(
  entering: Gadget[],
  exiting: Gadget[],
  connections: MapConnection[],
): Map<string, string> {
  const pairs = new Map<string, string>()
  const categories = new Set(entering.map((gadget) => gadget.category))

  for (const category of categories) {
    const ins = entering.filter((gadget) => gadget.category === category)
    const outs = exiting.filter((gadget) => gadget.category === category)
    if (ins.length === 0 || outs.length === 0) continue

    if (ins.length === 1 && outs.length === 1 && ins[0].id !== outs[0].id) {
      pairs.set(ins[0].id, outs[0].id)
      continue
    }

    const score = (inn: Gadget, out: Gadget) => {
      if (inn.id === out.id) return -1
      const sharedConnections = intersectionSize(
        connectionTokens(inn.id, connections),
        connectionTokens(out.id, connections),
      )
      const sharedPorts = intersectionSize(portTokens(inn), portTokens(out))
      return sharedConnections * 100 + sharedPorts
    }

    for (const inn of ins) {
      const rankedOuts = outs
        .map((out) => ({ out, score: score(inn, out) }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.out.id.localeCompare(b.out.id))
      if (rankedOuts.length === 0 || rankedOuts[0].score === rankedOuts[1]?.score) continue

      const chosen = rankedOuts[0]
      const rankedIns = ins
        .map((candidate) => ({ candidate, score: score(candidate, chosen.out) }))
        .filter((candidate) => candidate.score > 0)
        .sort((a, b) => b.score - a.score || a.candidate.id.localeCompare(b.candidate.id))
      if (rankedIns[0]?.candidate.id !== inn.id || rankedIns[0].score === rankedIns[1]?.score) continue
      pairs.set(inn.id, chosen.out.id)
    }
  }

  return pairs
}

export interface HistoryReplacementLayoutPlan {
  gadgets: Gadget[]
  connections: MapConnection[]
  pairs: ReadonlyMap<string, string>
  originalConnections: ReadonlyMap<string, MapConnection>
  omittedExitingConnections: ReadonlyMap<string, string>
  exitingGadgets: ReadonlyMap<string, Gadget>
}

const remapConnection = (connection: MapConnection, oldToNew: ReadonlyMap<string, string>): MapConnection => ({
  ...connection,
  fromGadgetId: oldToNew.get(connection.fromGadgetId) ?? connection.fromGadgetId,
  toGadgetId: oldToNew.get(connection.toGadgetId) ?? connection.toGadgetId,
})

const connectionSlotKey = (connection: MapConnection) =>
  `${connection.fromGadgetId}>${connection.toGadgetId}|${connection.cableType}`

/**
 * 交換前後の商品を同時に自動配置へ渡すと、別々の障害物として互いを押し退ける。
 * 撤去品を導入品のIDへ畳み、同じ接続は1本だけルーティングするための入力を作る。
 */
export function buildHistoryReplacementLayoutPlan(
  entering: Gadget[],
  exiting: Gadget[],
  activeConnections: MapConnection[],
  renderGadgets: Gadget[],
  renderConnections: MapConnection[],
): HistoryReplacementLayoutPlan {
  const visibleIds = new Set(wiringMapGadgets(renderGadgets, renderConnections).map((gadget) => gadget.id))
  const pairs = buildHistoryReplacementPairs(
    entering.filter((gadget) => visibleIds.has(gadget.id)),
    exiting.filter((gadget) => visibleIds.has(gadget.id)),
    renderConnections,
  )
  const oldToNew = new Map([...pairs].map(([newId, oldId]) => [oldId, newId]))
  const originalConnections = new Map(renderConnections.map((connection) => [connection.id, connection]))
  const exitingGadgets = new Map(exiting.map((gadget) => [gadget.id, gadget]))

  if (pairs.size === 0) {
    return {
      gadgets: renderGadgets,
      connections: renderConnections,
      pairs,
      originalConnections,
      omittedExitingConnections: new Map(),
      exitingGadgets,
    }
  }

  const activeIds = new Set(activeConnections.map((connection) => connection.id))
  const activeBySlot = new Map<string, string[]>()
  for (const connection of activeConnections) {
    const remapped = remapConnection(connection, oldToNew)
    const key = connectionSlotKey(remapped)
    activeBySlot.set(key, [...(activeBySlot.get(key) ?? []), connection.id])
  }

  const usedActiveIds = new Set<string>()
  const omittedExitingConnections = new Map<string, string>()
  const connections: MapConnection[] = []
  for (const original of renderConnections) {
    const remapped = remapConnection(original, oldToNew)
    const touchesReplacement = oldToNew.has(original.fromGadgetId) || oldToNew.has(original.toGadgetId)
    if (!activeIds.has(original.id) && touchesReplacement) {
      const matchingActiveId = (activeBySlot.get(connectionSlotKey(remapped)) ?? [])
        .find((id) => !usedActiveIds.has(id))
      if (matchingActiveId) {
        usedActiveIds.add(matchingActiveId)
        omittedExitingConnections.set(original.id, matchingActiveId)
        continue
      }
    }
    connections.push(remapped)
  }

  return {
    gadgets: renderGadgets.filter((gadget) => !oldToNew.has(gadget.id)),
    connections,
    pairs,
    originalConnections,
    omittedExitingConnections,
    exitingGadgets,
  }
}

const nodeSuffix = (nodeId: string, baseId: string) =>
  nodeId === baseId ? '' : nodeId.startsWith(`${baseId}__`) ? nodeId.slice(baseId.length) : null

/**
 * 畳んで計算したレイアウトへ撤去品を同じ座標で戻す。
 * 同じ接続スロットの旧配線は新配線の経路を共有するため、互いを迂回しない。
 */
export function restoreHistoryReplacementLayout(
  layout: MapLayout,
  plan: HistoryReplacementLayoutPlan,
): MapLayout {
  if (plan.pairs.size === 0) return layout

  const oldToNew = new Map([...plan.pairs].map(([newId, oldId]) => [oldId, newId]))
  const syntheticNodes: MapNode[] = []
  const syntheticById = new Map<string, MapNode>()
  for (const [newId, oldId] of plan.pairs) {
    const oldGadget = plan.exitingGadgets.get(oldId)
    if (!oldGadget) continue
    for (const node of layout.nodes) {
      const suffix = nodeSuffix(node.id, newId)
      if (suffix === null) continue
      const cloned: MapNode = {
        ...node,
        id: oldId + suffix,
        gadget: oldGadget,
        attached: undefined,
      }
      syntheticNodes.push(cloned)
      syntheticById.set(cloned.id, cloned)
    }
  }

  const restoreEndpoint = (node: MapNode, originalGadgetId: string): MapNode => {
    const newId = oldToNew.get(originalGadgetId)
    if (!newId || baseMapNodeId(node.id) !== newId) return node
    const suffix = nodeSuffix(node.id, newId) ?? ''
    return syntheticById.get(originalGadgetId + suffix) ??
      syntheticNodes.find((candidate) => baseMapNodeId(candidate.id) === originalGadgetId) ??
      node
  }

  const restoredEdges: MapEdge[] = layout.edges.map((edge) => {
    const original = plan.originalConnections.get(edge.conn.id)
    if (!original) return edge
    return {
      ...edge,
      conn: original,
      from: restoreEndpoint(edge.from, original.fromGadgetId),
      to: restoreEndpoint(edge.to, original.toGadgetId),
    }
  })
  const edgeById = new Map(restoredEdges.map((edge) => [edge.conn.id, edge]))

  for (const [oldConnectionId, activeConnectionId] of plan.omittedExitingConnections) {
    const original = plan.originalConnections.get(oldConnectionId)
    const source = edgeById.get(activeConnectionId)
    if (!original || !source) continue
    restoredEdges.push({
      ...source,
      conn: original,
      from: restoreEndpoint(source.from, original.fromGadgetId),
      to: restoreEndpoint(source.to, original.toGadgetId),
      points: source.points.map((point) => ({ ...point })),
      isPairLink: false,
    })
  }

  // split機器やサブウーファーの補助線も、交換前後で同じ場所・同じ経路を共有する。
  for (const [newId, oldId] of plan.pairs) {
    for (const edge of layout.edges) {
      if (!edge.isPairLink || baseMapNodeId(edge.from.id) !== newId || baseMapNodeId(edge.to.id) !== newId) continue
      const from = syntheticById.get(oldId + (nodeSuffix(edge.from.id, newId) ?? ''))
      const to = syntheticById.get(oldId + (nodeSuffix(edge.to.id, newId) ?? ''))
      if (!from || !to) continue
      restoredEdges.push({
        ...edge,
        conn: {
          ...edge.conn,
          id: edge.conn.id.replace(newId, oldId),
          fromGadgetId: from.id,
          toGadgetId: to.id,
        },
        from,
        to,
        points: edge.points.map((point) => ({ ...point })),
      })
    }
  }

  return {
    ...layout,
    nodes: [...layout.nodes, ...syntheticNodes],
    edges: restoredEdges,
  }
}
