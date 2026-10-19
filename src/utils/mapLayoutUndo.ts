import type { ConnectionMap, DeskPlan, NodeOffset } from '../types'

type Change<T> = { before: T | undefined; after: T | undefined }
type NodeSize = { w: number; h: number }

export interface MapLayoutChange {
  offsets: Record<string, Change<NodeOffset>>
  sizes: Record<string, Change<NodeSize>>
}

function equal<T extends object>(a: T | undefined, b: T | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof T)[])
  return [...keys].every(key => a[key] === b[key])
}

function changes<T extends object>(current: Record<string, T> | undefined, next: Record<string, T>, ids: readonly string[]): Record<string, Change<T>> {
  const result: Record<string, Change<T>> = {}
  for (const id of ids) {
    if (!equal(current?.[id], next[id])) {
      result[id] = { before: current?.[id] && { ...current[id] }, after: next[id] && { ...next[id] } }
    }
  }
  return result
}

export function captureMapLayoutChange(
  map: ConnectionMap,
  offsets: Record<string, NodeOffset>,
  offsetIds: readonly string[],
  sizes?: Record<string, NodeSize>,
  sizeIds: readonly string[] = [],
): MapLayoutChange {
  return {
    offsets: changes(map.nodeOffsets, offsets, offsetIds),
    sizes: sizes ? changes(map.nodeSizes, sizes, sizeIds) : {},
  }
}

function apply<T>(current: Record<string, T> | undefined, delta: Record<string, Change<T>>, undo: boolean): Record<string, T> | undefined {
  if (Object.keys(delta).length === 0) return current
  const next = { ...current }
  for (const [id, change] of Object.entries(delta)) {
    const value = undo ? change.before : change.after
    if (value === undefined) delete next[id]
    else next[id] = value
  }
  return Object.keys(next).length ? next : undefined
}

export function applyMapLayoutChange(plan: DeskPlan, change: MapLayoutChange, day: string, undo = false): DeskPlan {
  const map = plan.connectionMap
  if (!map || (!Object.keys(change.offsets).length && !Object.keys(change.sizes).length)) return plan
  if (undo) {
    // 保存失敗後の再試行は許すが、同じ機材の新しい編集や撤去を巻き戻さない。
    const matches = <T extends object>(values: Record<string, T> | undefined, delta: Record<string, Change<T>>) =>
      Object.entries(delta).every(([id, value]) => equal(values?.[id], value.after) || equal(values?.[id], value.before))
    if (!matches(map.nodeOffsets, change.offsets) || !matches(map.nodeSizes, change.sizes)) return plan
  }
  const nodeOffsets = apply(map.nodeOffsets, change.offsets, undo)
  const nodeSizes = apply(map.nodeSizes, change.sizes, undo)
  return {
    ...plan,
    connectionMap: {
      ...map,
      nodeOffsets,
      nodeSizes,
      layoutSnapshots: { ...map.layoutSnapshots, [day]: { nodeOffsets: nodeOffsets ?? {}, nodeSizes: nodeSizes ?? {} } },
    },
    updatedAt: new Date().toISOString(),
  }
}

export function layoutRestorePan(bounds: { minX: number; maxX: number; minY: number; maxY: number }, viewport: { w: number; h: number }, scale: number, x: number, y: number) {
  const reveal = (min: number, max: number, size: number, pan: number) => {
    const start = min * scale + pan, end = max * scale + pan
    if (end - start > size - 40) return size / 2 - (min + max) * scale / 2
    if (start < 20) return pan + 20 - start
    if (end > size - 20) return pan + size - 20 - end
    return pan
  }
  return { x: reveal(bounds.minX, bounds.maxX, viewport.w, x), y: reveal(bounds.minY, bounds.maxY, viewport.h, y) }
}
