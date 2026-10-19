import type { CoachRect } from './coachMarkLayout'

// 「？」の案内：撮った画面を縮小して置き、その横に引き出し線で説明を並べる配置の計算。
// 画面に依存しない計算だけを置いてテストする。

export type AnnotationSide = 'left' | 'right'

export interface ScreenGuideFrame {
  /** 縮小した画面を描く位置 */
  shot: CoachRect
  scale: number
  /** 説明を並べる列。狭い画面では右だけ */
  columns: Partial<Record<AnnotationSide, CoachRect>>
}

const LABEL_MIN = 168
const LABEL_MAX = 300
// 画面の縁から説明までの、引き出し線が通る幅
export const ANNOTATION_LEAD = 24

export function screenGuideFrame(area: CoachRect, screen: { width: number; height: number }): ScreenGuideFrame {
  const ratio = screen.height / screen.width
  const fitWidth = Math.min(area.width, area.height / ratio)
  const label = Math.min(LABEL_MAX, Math.max(LABEL_MIN, area.width * 0.22))
  const twoSided = area.width - 2 * (label + ANNOTATION_LEAD)
  // 両脇に説明の列を取っても画面が小さくなりすぎない幅なら中央に置く。電話の縦持ちでは
  // 両脇の列が字の詰まった細い帯になるので、画面を左に寄せて右の1列にまとめる。
  // 写しは半分より大きく取る。半分を切ると写した文字やアイコンが見分けられず、どの部品の説明か分からない
  const both = twoSided >= area.width * 0.35
  const width = both ? Math.min(fitWidth, twoSided) : Math.min(fitWidth, (area.width - ANNOTATION_LEAD) * 0.55)
  const height = width * ratio
  const x = both ? area.x + (area.width - width) / 2 : area.x
  const shot = { x, y: area.y + (area.height - height) / 2, width, height }
  const column = (side: AnnotationSide): CoachRect => {
    const room = side === 'right' ? area.x + area.width - (x + width + ANNOTATION_LEAD) : x - ANNOTATION_LEAD - area.x
    const columnWidth = both ? Math.min(LABEL_MAX + 40, room) : room
    return { x: side === 'right' ? x + width + ANNOTATION_LEAD : x - ANNOTATION_LEAD - columnWidth, y: area.y, width: columnWidth, height: area.height }
  }
  return { shot, scale: width / screen.width, columns: both ? { left: column('left'), right: column('right') } : { right: column('right') } }
}

/** 画面上の座標を、縮小した画面の上の座標へ移す */
export function toShot(rect: CoachRect, frame: ScreenGuideFrame): CoachRect {
  return { x: frame.shot.x + rect.x * frame.scale, y: frame.shot.y + rect.y * frame.scale, width: rect.width * frame.scale, height: rect.height * frame.scale }
}

/** 対象に近い側の列。列が1つならそこ */
export function annotationSide(target: CoachRect | null, frame: ScreenGuideFrame): AnnotationSide {
  if (!frame.columns.left) return 'right'
  if (!target) return 'right'
  return target.x + target.width / 2 < frame.shot.x + frame.shot.width / 2 ? 'left' : 'right'
}

/**
 * 説明を、指す位置の高さになるべく揃えて上から積む。重なれば下へ押し、
 * 列の下端からあふれれば上へ戻す。items は指す位置の高さ順に並べて渡す。
 */
export function stackAnnotations(items: { anchorY: number; height: number }[], top: number, bottom: number, gap: number): number[] {
  const ys = items.map((item) => item.anchorY - item.height / 2)
  for (let i = 0; i < ys.length; i++) ys[i] = Math.max(ys[i], i ? ys[i - 1] + items[i - 1].height + gap : top)
  for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], (i < ys.length - 1 ? ys[i + 1] - gap : bottom) - items[i].height)
  return ys.map((y) => Math.max(y, top))
}

/** 列の高さに収まる分ずつ、案内の順番を崩さずにページへ分ける */
export function paginateAnnotations(items: { side: AnnotationSide; height: number }[], capacity: number, gap: number): number[][] {
  const pages: number[][] = []
  let page: number[] = []
  let used = { left: 0, right: 0 }
  items.forEach((item, index) => {
    const next = used[item.side] + (used[item.side] ? gap : 0) + item.height
    if (page.length && next > capacity) {
      pages.push(page)
      page = []
      used = { left: 0, right: 0 }
    }
    used[item.side] += (used[item.side] ? gap : 0) + item.height
    page.push(index)
  })
  if (page.length) pages.push(page)
  return pages
}

/** 対象の縁から、説明の縁までの引き出し線 */
export function annotationLeader(target: CoachRect, label: CoachRect, side: AnnotationSide, frame: ScreenGuideFrame) {
  const shotEdge = side === 'right' ? frame.shot.x + frame.shot.width : frame.shot.x
  const labelY = label.y + Math.min(label.height / 2, 20)
  const start = {
    x: side === 'right' ? Math.min(target.x + target.width, shotEdge) : Math.max(target.x, shotEdge),
    y: Math.max(frame.shot.y, Math.min(target.y + target.height / 2, frame.shot.y + frame.shot.height)),
  }
  const bend = { x: shotEdge + (side === 'right' ? ANNOTATION_LEAD / 2 : -ANNOTATION_LEAD / 2), y: labelY }
  const end = { x: side === 'right' ? label.x : label.x + label.width, y: labelY }
  return { start, bend, end }
}
