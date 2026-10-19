export interface PlacementRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export const PLACEMENT_GAP = 12
export const PLACEMENT_PADDING = 28

export function placementOverlaps(a: PlacementRect, b: PlacementRect, gap = 0) {
  'worklet'
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x
    && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

export function overlappingPlacementIds(nodes: PlacementRect[]) {
  const ids = new Set<string>()
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (placementOverlaps(nodes[i], nodes[j])) { ids.add(nodes[i].id); ids.add(nodes[j].id) }
    }
  }
  return ids
}

export function placementMoveBounds(node: PlacementRect, others: PlacementRect[]) {
  'worklet'
  let minX = node.x, maxX = node.x, minY = node.y, maxY = node.y
  for (const peer of others) {
    minX = Math.min(minX, peer.x - 600 - node.w)
    maxX = Math.max(maxX, peer.x + peer.w + 600)
    minY = Math.min(minY, peer.y - 600 - node.h)
    maxY = Math.max(maxY, peer.y + peer.h + 600)
  }
  return {
    minX: Math.max(PLACEMENT_PADDING, others.length ? minX : node.x - 600),
    maxX: others.length ? maxX : node.x + 600,
    minY: Math.max(PLACEMENT_PADDING, others.length ? minY : node.y - 600),
    maxY: others.length ? maxY : node.y + 600,
  }
}

export function nearestPlacement(node: PlacementRect, others: PlacementRect[], x: number, y: number, reach = 96) {
  'worklet'
  const bounds = placementMoveBounds(node, others)
  const free = (px: number, py: number) => {
    'worklet'
    return px >= bounds.minX && px <= bounds.maxX && py >= bounds.minY && py <= bounds.maxY
      && !others.some(peer => placementOverlaps({ ...node, x: px, y: py }, peer, PLACEMENT_GAP))
  }
  x = Math.round(x); y = Math.round(y)
  if (free(x, y)) return { x, y }
  const xs = [x, bounds.minX, bounds.maxX], ys = [y, bounds.minY, bounds.maxY]
  for (const peer of others) {
    xs.push(Math.floor(peer.x - node.w - PLACEMENT_GAP), Math.ceil(peer.x + peer.w + PLACEMENT_GAP))
    ys.push(Math.floor(peer.y - node.h - PLACEMENT_GAP), Math.ceil(peer.y + peer.h + PLACEMENT_GAP))
  }
  let best: { x: number; y: number } | null = null
  let distance = reach * reach + 0.001
  for (const px of xs) {
    if ((px - x) ** 2 > distance) continue
    for (const py of ys) {
      const d = (px - x) ** 2 + (py - y) ** 2
      if (d >= distance || !free(px, py)) continue
      distance = d; best = { x: px, y: py }
    }
  }
  return best
}

export function resolvePlacementResize(nodes: PlacementRect[], ids: readonly string[], w: number, h: number) {
  const targets = nodes.filter(node => ids.includes(node.id))
  const first = targets.find(node => node.id === ids[0])
  if (!first) return { w, h, limited: false }
  const overlapArea = (a: PlacementRect, b: PlacementRect) =>
    Math.max(0, Math.min(a.x + a.w + PLACEMENT_GAP, b.x + b.w + PLACEMENT_GAP) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h + PLACEMENT_GAP, b.y + b.h + PLACEMENT_GAP) - Math.max(a.y, b.y))
  const allowed = (width: number, height: number) => targets.every(target => nodes.every(peer => {
    if (peer.id === target.id) return true
    const nextPeer = ids.includes(peer.id) ? { ...peer, w: width, h: height } : peer
    const nextTarget = { ...target, w: width, h: height }
    if (placementOverlaps(target, peer) && (width > target.w || height > target.h)) return false
    if (!placementOverlaps(target, peer) && placementOverlaps(nextTarget, nextPeer)) return false
    return overlapArea(nextTarget, nextPeer) <= overlapArea(target, peer)
  }))
  if (allowed(w, h)) return { w, h, limited: false }
  const startW = Math.min(...targets.map(node => node.w)), startH = Math.min(...targets.map(node => node.h))
  let lo = 0, hi = 1
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (allowed(startW + (w - startW) * mid, startH + (h - startH) * mid)) lo = mid
    else hi = mid
  }
  const width = startW + (w - startW) * lo, height = startH + (h - startH) * lo
  return { w: Math.floor(width), h: Math.floor(height), limited: true }
}

export function resolvePlacementDrag(node: PlacementRect, others: PlacementRect[], dx: number, dy: number, threshold: number) {
  'worklet'
  const bounds = placementMoveBounds(node, others)
  let x = Math.max(bounds.minX, Math.min(bounds.maxX, node.x + dx))
  let y = Math.max(bounds.minY, Math.min(bounds.maxY, node.y + dy))
  let bestX = threshold, bestY = threshold
  let snapX = x, snapY = y
  let guideX: number | null = null, guideY: number | null = null
  for (const peer of others) {
    for (const fraction of [0, 0.5, 1]) {
      const targetX = peer.x + peer.w * fraction
      const targetY = peer.y + peer.h * fraction
      const candidateX = targetX - node.w * fraction
      const candidateY = targetY - node.h * fraction
      const distanceX = Math.abs(candidateX - x), distanceY = Math.abs(candidateY - y)
      if (distanceX < bestX && candidateX >= bounds.minX && candidateX <= bounds.maxX
        && !others.some(other => placementOverlaps({ ...node, x: candidateX, y }, other, PLACEMENT_GAP))) {
        bestX = distanceX; snapX = candidateX; guideX = targetX
      }
      if (distanceY < bestY && candidateY >= bounds.minY && candidateY <= bounds.maxY
        && !others.some(other => placementOverlaps({ ...node, x: snapX, y: candidateY }, other, PLACEMENT_GAP))) {
        bestY = distanceY; snapY = candidateY; guideY = targetY
      }
    }
  }
  x = Math.round(snapX); y = Math.round(snapY)
  return { dx: x - node.x, dy: y - node.y, guideX, guideY }
}

export function placementEdgeVelocity(position: number, size: number): number {
  'worklet'
  if (size <= 0 || position < 0 || position > size) return 0
  const edge = Math.min(52, size / 4)
  if (position < edge) return 260 * (1 - position / edge) ** 2
  if (position > size - edge) return -260 * (1 - (size - position) / edge) ** 2
  return 0
}

export function boundedPlacementPan(current: number, step: number, min: number, max: number): number {
  'worklet'
  return current + (step > 0 ? Math.min(step, Math.max(0, max - current)) : Math.max(step, Math.min(0, min - current)))
}
