// 「？」の吹き出し案内で、どの対象を指せるか・吹き出しをどこへ置くかを決める。
// 画面に依存しない計算だけを置いてテストする。

export interface CoachRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CoachViewport {
  width: number
  height: number
  top: number
  bottom: number
  left?: number
  right?: number
}

// 対象がこれだけ見えていれば指す。端にわずかに掛かっているだけのもの
// （スクロールで画面外へ出かけた行など）を指すと、吹き出しが何も無い所を指してしまう。
// これより小さい要素（文字の行・小さな印）は、6割見えていればよい
const MIN_VISIBLE = 24
const MIN_VISIBLE_RATIO = 0.6

/**
 * 対象のうち、実際に見えている部分。指し示せるほど見えていなければ null。
 *
 * clips は対象を収めている枠（画面・一覧）。スクロールで枠の外へ出た行も測ると画面上の
 * 座標を返すので、枠で切らないとヘッダーの裏や一覧の外に隠れた行を指してしまう。
 * occluders は上に重なりうるもの（マイページの固定のタブバー・デスク詳細の上へずれてくる一覧など）。
 * 重なりは座標でしか分からないので、どれが上に来るかは呼び出し側が渡す（CoachStep の coveredBy）
 */
export function coachVisibleRect(
  rect: CoachRect | null,
  vp: CoachViewport,
  occluders: CoachRect[] = [],
  clips: CoachRect[] = [],
): CoachRect | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  let left = Math.max(rect.x, vp.left ?? 0)
  let right = Math.min(rect.x + rect.width, vp.width - (vp.right ?? 0))
  let top = Math.max(rect.y, vp.top)
  let bottom = Math.min(rect.y + rect.height, vp.height - vp.bottom)
  for (const c of clips) {
    left = Math.max(left, c.x)
    right = Math.min(right, c.x + c.width)
    top = Math.max(top, c.y)
    bottom = Math.min(bottom, c.y + c.height)
  }
  if (right - left < Math.min(MIN_VISIBLE, rect.width * MIN_VISIBLE_RATIO)) return null
  let segments: [number, number][] = [[top, bottom]]
  for (const o of occluders) {
    const overlapX = Math.min(o.x + o.width, right) - Math.max(o.x, left)
    if (overlapX <= 0) continue
    segments = segments.flatMap(([a, b]): [number, number][] => [
      [a, Math.min(b, o.y)],
      [Math.max(a, o.y + o.height), b],
    ])
  }
  const best = segments.filter(([a, b]) => b > a).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0]
  if (!best || best[1] - best[0] < Math.min(MIN_VISIBLE, rect.height * MIN_VISIBLE_RATIO)) return null
  return { x: left, y: best[0], width: right - left, height: best[1] - best[0] }
}

/** 測った矩形が、指し示せるほど画面内に見えているか */
export function isCoachTargetVisible(rect: CoachRect | null, vp: CoachViewport): rect is CoachRect {
  return coachVisibleRect(rect, vp) !== null
}

export interface CoachHole {
  x: number
  y: number
  w: number
  h: number
}

/** 切り抜く穴。画面からはみ出す分は削る（大きな配線図などは画面いっぱいになる） */
export function coachHole(rect: CoachRect, pad: number, vp: CoachViewport): CoachHole {
  const x = Math.max(rect.x - pad, 0)
  const y = Math.max(rect.y - pad, vp.top)
  const right = Math.min(rect.x + rect.width + pad, vp.width)
  const bottom = Math.min(rect.y + rect.height + pad, vp.height - vp.bottom)
  return { x, y, w: Math.max(right - x, 0), h: Math.max(bottom - y, 0) }
}

export type CoachBubblePlacement =
  | { kind: 'below'; top: number }
  | { kind: 'above'; bottom: number }
  // 穴の上下どちらにも収まらない（対象が画面の大半を占める）とき。穴に重ねて画面下に置き、角は出さない
  | { kind: 'overlay'; bottom: number }

export function placeCoachBubble(hole: CoachHole | null, bubbleHeight: number, gap: number, vp: CoachViewport): CoachBubblePlacement {
  const margin = 12
  if (!hole) return { kind: 'overlay', bottom: vp.bottom + margin * 3 }
  const spaceBelow = vp.height - vp.bottom - (hole.y + hole.h) - gap
  const spaceAbove = hole.y - vp.top - gap
  if (spaceBelow >= bubbleHeight + margin) return { kind: 'below', top: hole.y + hole.h + gap }
  if (spaceAbove >= bubbleHeight + margin) return { kind: 'above', bottom: vp.height - hole.y + gap }
  return { kind: 'overlay', bottom: vp.bottom + margin * 3 }
}

/** 対象の中央に揃え、左右の安全域に当たる場合だけ位置を補正する。 */
export function coachBubbleFrame(
  hole: CoachHole | null,
  vp: Pick<CoachViewport, 'width' | 'left' | 'right'>,
  maxWidth = 360,
  margin = 24,
): { left: number; width: number } {
  const left = (vp.left ?? 0) + margin
  const right = vp.width - (vp.right ?? 0) - margin
  const width = Math.max(0, Math.min(maxWidth, right - left))
  const center = hole ? hole.x + hole.w / 2 : (left + right) / 2
  return { left: Math.max(left, Math.min(center - width / 2, right - width)), width }
}

/** 吹き出しの角の左端。穴の中心を指しつつ、吹き出しの角丸からはみ出さない範囲に収める */
export function coachArrowLeft(hole: CoachHole, bubbleLeft: number, bubbleWidth: number, arrowWidth: number): number {
  const center = hole.x + hole.w / 2 - bubbleLeft - arrowWidth / 2
  return Math.max(16, Math.min(center, bubbleWidth - arrowWidth - 16))
}

/** 小画面では本文をスクロールさせ、対象の上下に収まる高さを優先する。 */
export function coachBubbleMaxHeight(hole: CoachHole | null, gap: number, vp: CoachViewport): number {
  const full = Math.max(88, vp.height - vp.top - vp.bottom - 48)
  if (!hole) return full
  const available = Math.max(hole.y - vp.top - gap, vp.height - vp.bottom - hole.y - hole.h - gap) - 12
  return available >= 88 ? Math.min(full, available) : full
}
