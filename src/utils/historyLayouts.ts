import type { DeskPlan } from '../types'
import { baseMapNodeId, computeMapLayout, MapLayout } from './connectionMapLayout'
import { resolveTimelineLayout, TimelineEvent, TimelineGrain } from './deskTimeline'
import { buildHistoryReplacementLayoutPlan, restoreHistoryReplacementLayout } from './historyReplacement'
import { stableHistoryNodeSizesOf } from './historyLayoutSizes'
import { historyLayoutCache, HistoryLayoutCache } from './historyLayoutCache'
import { LAYOUT_VERSION, makeLayoutInputKey, tryGetCachedLayout } from './mapLayoutCache'
import { DESK_HISTORY_DEMO_PLAN_ID } from '../constants/deskHistoryDemo'

/**
 * 各日の配置入力（ずらし量と、全期間で揃えた大きさ）。再生と歴史の配置エディタで共有する。
 * エディタが揃える前の大きさで描いていた頃は、図の組み方が再生と変わり、直した位置が再生でずれた
 */
export function resolveHistoryLayoutInputs(
  plan: DeskPlan,
  events: TimelineEvent[],
  lastChangeDate: string | undefined,
) {
  const replacementPlans = events.map((e) => buildHistoryReplacementLayoutPlan(
    e.inGadgets, e.outGadgets, e.connections, e.renderGadgets, e.renderConnections,
  ))
  const resolved = events.map((e) => resolveTimelineLayout(plan, e.date, lastChangeDate))
  const fixedNodeSizes = stableHistoryNodeSizesOf(events.map((_, i) => ({
    replacementPlan: replacementPlans[i], nodeSizes: resolved[i].nodeSizes,
  })), new Set(Object.keys(plan.connectionMap?.nodeSizes ?? {})))
  const inputs = resolved.map(({ nodeOffsets, nodeSizes }) => ({
    nodeOffsets, nodeSizes: { ...nodeSizes, ...fixedNodeSizes },
  }))
  return { replacementPlans, inputs }
}

/**
 * 前の日の図から、その日に撤去したガジェット・配線を除く。「今日」ページは前の日の演出を
 * 見終えた状態をそのまま引いて見せるので、配線図を組み直さない。組み直すと位置が少し変わり、
 * 動いたガジェットにつながる線だけが消えて出直し、残りの線は据え置かれて、消える線と消えない線が混ざる
 */
export function withoutExited(layout: MapLayout, event: TimelineEvent): MapLayout {
  const keptGadgets = new Set(event.gadgets.map((g) => g.id))
  const keptConnections = new Set(event.connections.map((c) => c.id))
  const exitedGadgets = new Set(event.renderGadgets.filter((g) => !keptGadgets.has(g.id)).map((g) => g.id))
  const exitedConnections = new Set(event.renderConnections.filter((c) => !keptConnections.has(c.id)).map((c) => c.id))
  if (exitedGadgets.size === 0 && exitedConnections.size === 0) return layout
  const nodes = new Map(layout.nodes
    .filter((n) => !exitedGadgets.has(baseMapNodeId(n.id)))
    .map((n) => [n.id, n.attached?.some((g) => exitedGadgets.has(g.id))
      ? { ...n, attached: n.attached.filter((g) => !exitedGadgets.has(g.id)) }
      : n]))
  const edges = layout.edges
    .filter((e) => !exitedConnections.has(e.conn.id) && nodes.has(e.from.id) && nodes.has(e.to.id))
    .map((e) => (nodes.get(e.from.id) === e.from && nodes.get(e.to.id) === e.to
      ? e
      : { ...e, from: nodes.get(e.from.id)!, to: nodes.get(e.to.id)! }))
  return { ...layout, nodes: [...nodes.values()], edges }
}

// モーダルと計測で同じ準備処理を使う。再生・描画には依存しない。
export async function computeHistoryLayouts(
  plan: DeskPlan,
  events: TimelineEvent[],
  lastChangeDate: string | undefined,
  grain: TimelineGrain,
  hooks: { cancelled?: () => boolean; onProgress?: (ratio: number) => void } = {},
  cache: HistoryLayoutCache = historyLayoutCache,
): Promise<MapLayout[] | null> {
  if (hooks.cancelled?.()) return null
  const { replacementPlans, inputs } = resolveHistoryLayoutInputs(plan, events, lastChangeDate)
  // 共有で受け取ったデスク（公開デスクの閲覧を含む）と見本は、自分のデスクとして優先しない
  const own = !plan.isShared && plan.id !== DESK_HISTORY_DEMO_PLAN_ID
  const savedLayouts = await cache.open(plan.id, grain, LAYOUT_VERSION, { own })
  const layouts: MapLayout[] = []
  const layoutsByInput = new Map<string, MapLayout>()
  let lastYieldAt = Date.now()
  for (let i = 0; i < events.length; i++) {
    if (hooks.cancelled?.()) return null
    const e = events[i]
    const prev = events[i - 1]
    // 「今日」は直前の図から撤去したものを除いて使う（配置の入力が同じとき）。
    const reusePrev = e.isTodayPage === true && prev !== undefined &&
      JSON.stringify(inputs[i]) === JSON.stringify(inputs[i - 1])
    if (reusePrev) {
      layouts.push(withoutExited(layouts[i - 1], prev))
      hooks.onProgress?.((i + 1) / Math.max(1, events.length))
      continue
    }
    const { nodeOffsets, nodeSizes } = inputs[i]
    const rp = replacementPlans[i]
    const baseInputKey = makeLayoutInputKey(rp.gadgets, rp.connections, plan.placements, nodeOffsets, nodeSizes, !!plan.templateId)
    const inputKey = [
      baseInputKey,
      [...rp.pairs].sort().map(([newId, oldId]) => `${newId}<-${oldId}`).join(','),
      [...rp.omittedExitingConnections].sort().map(([oldId, activeId]) => `${oldId}->${activeId}`).join(','),
    ].join('||history-replacements:')
    const inMemory = layoutsByInput.get(inputKey)
    const saved = inMemory ? null : savedLayouts.get(inputKey, e.renderGadgets, e.renderConnections)
    const cached = inMemory || saved ? null : tryGetCachedLayout(
      plan.id, rp.gadgets, rp.connections, plan.placements, nodeOffsets, nodeSizes, !!plan.templateId,
    )
    const nextLayout = inMemory ?? saved ?? restoreHistoryReplacementLayout(cached ?? await computeMapLayout(
      rp.gadgets, rp.connections, plan.placements, nodeOffsets, nodeSizes, !!plan.templateId, hooks.cancelled,
    ), rp)
    layouts.push(nextLayout)
    layoutsByInput.set(inputKey, nextLayout)
    savedLayouts.set(inputKey, nextLayout)
    hooks.onProgress?.((i + 1) / Math.max(1, events.length))
    // 保存済みの全日を読むだけのときに、日数ぶんタイマー待ちを積み上げない。
    if ((!inMemory && !saved && !cached) || Date.now() - lastYieldAt >= 12) {
      await new Promise((r) => setTimeout(r, 0))
      lastYieldAt = Date.now()
    }
  }
  if (hooks.cancelled?.()) return null
  void savedLayouts.save()
  return layouts
}
