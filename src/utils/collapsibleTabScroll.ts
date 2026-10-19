export interface ScrollSyncRequest {
  id: number
  offset: number
}

/**
 * タブ固有の本文位置は残し、共有ヘッダーが見えている範囲だけ揃える。
 * ヘッダーが畳まれているときは、遷移先が既に奥ならその位置を維持する。
 */
export function synchronizedTabOffset(
  activeOffset: number,
  targetOffset: number,
  collapseDistance: number,
): number {
  const active = Math.max(0, activeOffset)
  const target = Math.max(0, targetOffset)
  const collapse = Math.max(0, collapseDistance)
  if (collapse === 0) return target
  if (active < collapse) return active
  return Math.max(target, collapse)
}
