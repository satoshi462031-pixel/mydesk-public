import type { CoachRect } from './coachMarkLayout'

export type GuideSide = 'top' | 'right' | 'bottom'
export interface GuidePoint { x: number; y: number }
export interface GuideAnnotation {
  index: number
  side: GuideSide
  label: CoachRect
  target: CoachRect | null
  badge: GuidePoint | null
  points: GuidePoint[]
}
export const GUIDE_BADGE_RADIUS = 8
const LEAD = 24
const CLEARANCE = 6
// 強調枠どうしの間隔。写しは縮小して描くので、線と同じ CLEARANCE を対象に使うと実寸で十数pt離れた
// 隣の部品まで重なり扱いになり、並べて説明できる項目が毎回別ページに分かれる。枠の線（対象の縁に太さ2.5）が
// 触れない間隔だけを求め、親子や同じカードのように本当に重なる対象は引き続き分ける
const TARGET_CLEARANCE = 2.5

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

function pointGap(point: GuidePoint, a: GuidePoint, b: GuidePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1) : 0
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

function segmentGap(a: GuidePoint, b: GuidePoint, c: GuidePoint, d: GuidePoint): number {
  const cross = (p: GuidePoint, q: GuidePoint, r: GuidePoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0
    && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x))
    && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return 0
  return Math.min(pointGap(a, c, d), pointGap(b, c, d), pointGap(c, a, b), pointGap(d, a, b))
}

function segments(points: GuidePoint[]): [GuidePoint, GuidePoint][] {
  return points.slice(1).map((point, i) => [points[i], point])
}

function overlaps(a: CoachRect, b: CoachRect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap
    && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap
}

function hitsRect(a: GuidePoint, b: GuidePoint, rect: CoachRect): boolean {
  const left = rect.x - 2
  const top = rect.y - 2
  const right = rect.x + rect.width + 2
  const bottom = rect.y + rect.height + 2
  const inside = (point: GuidePoint) => point.x >= left && point.x <= right && point.y >= top && point.y <= bottom
  const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
  return inside(a) || inside(b) || corners.some((point, i) => segmentGap(a, b, point, corners[(i + 1) % 4]) < 0.01)
}

/** 線の交差だけでなく、同じ線に見える近接・番号の衝突・別の対象を横切る経路も避ける。 */
export function guideAnnotationsConflict(a: GuideAnnotation, b: GuideAnnotation): boolean {
  if (overlaps(a.label, b.label, CLEARANCE)) return true
  if (a.target && b.target && overlaps(a.target, b.target, TARGET_CLEARANCE)) return true
  if (a.badge && b.badge && Math.hypot(a.badge.x - b.badge.x, a.badge.y - b.badge.y) < GUIDE_BADGE_RADIUS * 2 + CLEARANCE) return true
  const aa = segments(a.points)
  const bb = segments(b.points)
  if (aa.some(([p, q]) => bb.some(([r, s]) => segmentGap(p, q, r, s) < CLEARANCE))) return true
  for (const [line, other] of [[aa, b], [bb, a]] as const) {
    if (line.some(([p, q]) => (other.badge && pointGap(other.badge, p, q) < GUIDE_BADGE_RADIUS + CLEARANCE)
      || (other.target && hitsRect(p, q, other.target)) || hitsRect(p, q, other.label))) return true
  }
  return false
}

/**
 * 欄（card）の中で、説明の札を中身の高さまで縮める。欄いっぱいの札にすると、短い説明の
 * 下に大きな空きができる。札は図の側へ寄せる（上の欄は下端、下の欄は上端、右の欄は指す先の高さ）
 */
function fitLabel(side: GuideSide, card: CoachRect, contentHeight: number | undefined, anchorY: number): CoachRect {
  if (contentHeight === undefined || contentHeight >= card.height) return card
  const height = Math.max(0, contentHeight)
  const y = side === 'top' ? card.y + card.height - height
    : side === 'bottom' ? card.y
      : clamp(anchorY - height / 2, card.y, card.y + card.height - height)
  return { ...card, y, height }
}

function annotation(index: number, side: GuideSide, target: CoachRect | null, card: CoachRect, shot: CoachRect, contentHeight?: number): GuideAnnotation {
  if (!target) return { index, side, target, label: fitLabel(side, card, contentHeight, card.y + card.height / 2), badge: null, points: [] }
  const r = GUIDE_BADGE_RADIUS
  const badge = {
    x: clamp(side === 'right' ? target.x + target.width + r + 2 : target.x + target.width / 2, shot.x + r, shot.x + shot.width - r),
    y: clamp(side === 'top' ? target.y - r - 2 : side === 'bottom' ? target.y + target.height + r + 2 : target.y + target.height / 2, shot.y + r, shot.y + shot.height - r),
  }
  const label = fitLabel(side, card, contentHeight, badge.y)
  // 線は対象の枠の縁から引く。番号は説明の札にだけ出す（線の先にも出すと同じ番号が
  // 2つ並んで見にくい）。badge は線の出どころの位置と、重なりの判定の幅にだけ使う
  if (side === 'right') {
    const start = { x: target.x + target.width, y: badge.y }
    const end = { x: label.x, y: label.y + label.height / 2 }
    const lane = shot.x + shot.width + LEAD / 2
    return { index, side, target, label, badge, points: [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end] }
  }
  const top = side === 'top'
  const start = { x: badge.x, y: top ? target.y : target.y + target.height }
  const end = { x: clamp(badge.x, label.x + r, label.x + label.width - r), y: top ? label.y + label.height : label.y }
  const lane = top ? shot.y - LEAD / 2 : shot.y + shot.height + LEAD / 2
  return { index, side, target, label, badge, points: [start, { x: start.x, y: lane }, { x: end.x, y: lane }, end] }
}

/**
 * 上・右・下を使い、同時に安全に指せない項目は次のページへ送る。
 * contentHeight を渡すと、説明が欄に収まらない置き方も避ける（ひとりで1ページにすれば欄が広がる）。
 */
export function layoutGuideAnnotations(area: CoachRect, screen: { width: number; height: number }, rects: (CoachRect | null)[],
  contentHeight?: (index: number, width: number) => number) {
  const stacked = area.height >= 380 || (area.height >= 280 && screen.height > screen.width * 1.3)
  const band = stacked ? Math.min(150, area.height * 0.22) : 0
  const middleHeight = Math.max(1, area.height - band * 2 - (stacked ? LEAD * 2 : 0))
  const shotWidth = Math.min((area.width - LEAD) * 0.55, middleHeight * screen.width / screen.height)
  const shotHeight = shotWidth * screen.height / screen.width
  const rightWidth = Math.min(300, area.width - shotWidth - LEAD)
  const groupWidth = shotWidth + LEAD + rightWidth
  const x = area.x + (area.width - groupWidth) / 2
  const middleY = area.y + band + (stacked ? LEAD : 0)
  const shot = { x, y: middleY + (middleHeight - shotHeight) / 2, width: shotWidth, height: shotHeight }
  const scale = shotWidth / screen.width
  const cards: Record<GuideSide, CoachRect> = {
    top: { x, y: area.y, width: groupWidth, height: band },
    right: { x: x + shotWidth + LEAD, y: middleY, width: rightWidth, height: middleHeight },
    bottom: { x, y: area.y + area.height - band, width: groupWidth, height: band },
  }
  const targets = rects.map(rect => rect ? { x: shot.x + rect.x * scale, y: shot.y + rect.y * scale, width: rect.width * scale, height: rect.height * scale } : null)
  const sides: GuideSide[] = stacked ? ['top', 'right', 'bottom'] : ['right']
  const fit = (indexes: number[], roomy = !!contentHeight): GuideAnnotation[] | null => {
    let best: GuideAnnotation[] | null = null
    let bestCost = Infinity
    const place = (placed: GuideAnnotation[]) => {
      if (placed.length === indexes.length) {
        const cost = placed.reduce((sum, item) => sum + segments(item.points).reduce((length, [a, b]) => length + Math.hypot(a.x - b.x, a.y - b.y), 0), 0)
        if (cost < bestCost) { best = placed; bestCost = cost }
        return
      }
      const index = indexes[placed.length]
      for (const side of sides) {
        if (placed.some(item => item.side === side)) continue
        if (roomy && contentHeight!(index, cards[side].width) > cards[side].height) continue
        const item = annotation(index, side, targets[index], cards[side], shot, contentHeight?.(index, cards[side].width))
        if (placed.some(other => guideAnnotationsConflict(item, other))) continue
        place([...placed, item])
      }
    }
    place([])
    return best
  }
  const pages: GuideAnnotation[][] = []
  let indexes: number[] = []
  let page: GuideAnnotation[] = []
  rects.forEach((_, index) => {
    const candidate = indexes.length < sides.length ? fit([...indexes, index]) : null
    if (candidate) { indexes.push(index); page = candidate }
    // どの欄にも収まらない長い説明は、ひとりのページにする。単独のページは欄を広げて描き直す
    else { if (page.length) pages.push(page); indexes = [index]; page = fit(indexes) ?? fit(indexes, false)! }
  })
  if (page.length) pages.push(page)
  const shots = pages.map((items, pageIndex) => {
    if (items.length !== 1) return shot
    const item = items[0]
    let box: CoachRect
    let label: CoachRect
    if (item.side === 'right') {
      const width = Math.min(shotWidth, area.height * screen.width / screen.height)
      const height = width * screen.height / screen.width
      box = { x, y: area.y + (area.height - height) / 2, width, height }
      label = { ...cards.right, y: area.y, height: area.height }
    } else {
      const labelHeight = Math.min(150, area.height * 0.35)
      const availableHeight = area.height - labelHeight - LEAD
      const width = Math.min(area.width, availableHeight * screen.width / screen.height)
      const height = width * screen.height / screen.width
      const top = item.side === 'top'
      box = { x: area.x + (area.width - width) / 2, y: area.y + (top ? labelHeight + LEAD : 0) + (availableHeight - height) / 2, width, height }
      label = { x: area.x, y: top ? area.y : area.y + area.height - labelHeight, width: area.width, height: labelHeight }
    }
    const source = rects[item.index]
    const zoom = box.width / screen.width
    const target = source ? { x: box.x + source.x * zoom, y: box.y + source.y * zoom, width: source.width * zoom, height: source.height * zoom } : null
    pages[pageIndex] = [annotation(item.index, item.side, target, label, box, contentHeight?.(item.index, label.width))]
    return box
  })
  return { shot, shots, scale, cards, pages }
}
