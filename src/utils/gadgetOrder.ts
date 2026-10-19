export function orderGadgetsByIds<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const ranks = new Map(order.map((id, index) => [id, index]))
  return [...items].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity))
}

/** ジャンル・ケーブル種類内の移動でも、他の節の位置と直前に追加された機材を保つ。 */
export function mergeGadgetOrder(current: readonly string[], reordered: readonly string[], selected: readonly string[]): string[] {
  const selectedIds = new Set(selected)
  const base = [...new Set([...current, ...selected])].filter((id) => selectedIds.has(id))
  const moving = [...new Set(reordered)].filter((id) => selectedIds.has(id))
  const movingIds = new Set(moving)
  let index = 0
  return base.map((id) => movingIds.has(id) ? moving[index++] : id)
}

export function moveGadgetId(order: readonly string[], from: number, to: number): string[] {
  const next = [...order]
  const [id] = next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}
