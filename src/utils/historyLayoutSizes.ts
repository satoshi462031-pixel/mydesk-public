import { baseMapNodeId, computeMapNodeSizes, MapLayout } from './connectionMapLayout'
import { HistoryReplacementLayoutPlan, restoreHistoryReplacementLayout } from './historyReplacement'

export type HistoryNodeSizes = Record<string, { w: number; h: number }>

type LayoutWithSizedNodes = {
  nodes: ReadonlyArray<{ id: string; w: number; h: number }>
}

/** 買い替えの撤去品 → 導入品（ガジェットID）。交換の日の撤去品は導入品の寸法を写して描かれる */
export function historyReplacementAliases(
  plans: ReadonlyArray<Pick<HistoryReplacementLayoutPlan, 'pairs'>>,
): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const plan of plans) for (const [newId, oldId] of plan.pairs) aliases.set(oldId, newId)
  return aliases
}

/**
 * 履歴内で大きさが変わるノードだけを、期間中の最大サイズへ揃える。
 * 買い替えの前後（aliases）は1台として揃える。交換の日の撤去品は導入品の寸法を写すので、
 * 別々に揃えると、撤去品が交換の直前に導入品の大きさへ一瞬で変わる
 * （ゲーミングの見本の PC は、新しい PC だけが線の増えた後の大きさに固定されていた）。
 * 手で大きさを決めたノード（manualIds）を含む組は、最大ではなくその大きさに揃える。
 * 最大で揃えると、手で縮めた大きさが自動の大きさに負けて再生に出ない。
 */
export function stableHistoryNodeSizes(
  layouts: ReadonlyArray<LayoutWithSizedNodes>,
  aliases: ReadonlyMap<string, string> = new Map(),
  manualIds: ReadonlySet<string> = new Set(),
): HistoryNodeSizes {
  const groupOf = (nodeId: string) => {
    const base = baseMapNodeId(nodeId)
    const suffix = nodeId.slice(base.length)
    let root = base
    // 2回買い替えた（A→B→C）ときも1つにまとめる。循環は来ないが、念のため回数で止める
    for (let i = 0; i < aliases.size && aliases.has(root); i++) root = aliases.get(root)!
    return root + suffix
  }
  const ranges = new Map<string, {
    minW: number; maxW: number; minH: number; maxH: number; ids: Set<string>
    manual?: { id: string; w: number; h: number }
  }>()

  for (const layout of layouts) {
    for (const node of layout.nodes) {
      const group = groupOf(node.id)
      let current = ranges.get(group)
      if (!current) {
        current = { minW: node.w, maxW: node.w, minH: node.h, maxH: node.h, ids: new Set([node.id]) }
        ranges.set(group, current)
      }
      // 買い替えの前後どちらにも手の大きさがあれば、今の機器（組の根）のものを使う。
      // 買い替えると手の大きさは新しい機器へ引き継がれる（replaceMapNode）ので、普通は根にだけある
      if (manualIds.has(node.id) && (!current.manual || (current.manual.id !== group && node.id === group))) {
        current.manual = { id: node.id, w: node.w, h: node.h }
      }
      current.ids.add(node.id)
      current.minW = Math.min(current.minW, node.w)
      current.maxW = Math.max(current.maxW, node.w)
      current.minH = Math.min(current.minH, node.h)
      current.maxH = Math.max(current.maxH, node.h)
    }
  }

  const stableSizes: HistoryNodeSizes = {}
  for (const range of ranges.values()) {
    if (range.manual) {
      const { w, h } = range.manual
      for (const id of range.ids) stableSizes[id] = { w, h }
    } else if (range.minW !== range.maxW || range.minH !== range.maxH) {
      for (const id of range.ids) stableSizes[id] = { w: range.maxW, h: range.maxH }
    }
  }
  return stableSizes
}

/**
 * 各日の配線図を引かずに、stableHistoryNodeSizes と同じ結果を求める。
 * ノードの寸法は接続数とカテゴリだけで決まり経路探索の結果に左右されないので、
 * 寸法を知るためだけに全日の配線図を計算する必要は無い（以前はそうしていて、準備時間が倍になっていた）。
 * 撤去品のノードは導入品の寸法を写して戻すので、配線図と同じ戻し処理を通す。
 */
export function stableHistoryNodeSizesOf(
  days: ReadonlyArray<{ replacementPlan: HistoryReplacementLayoutPlan; nodeSizes: HistoryNodeSizes }>,
  manualIds?: ReadonlySet<string>,
): HistoryNodeSizes {
  return stableHistoryNodeSizes(days.map(({ replacementPlan, nodeSizes }) => {
    const sizes = computeMapNodeSizes(replacementPlan.gadgets, replacementPlan.connections, nodeSizes)
    const nodes = [...sizes].map(([id, size]) => ({ id, ...size }))
    // 戻し処理が読むのは nodes と edges だけ。寸法以外の項目は持たない
    return restoreHistoryReplacementLayout({ nodes, edges: [] } as unknown as MapLayout, replacementPlan)
  }), historyReplacementAliases(days.map((day) => day.replacementPlan)), manualIds)
}
