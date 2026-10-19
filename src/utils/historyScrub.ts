// デスクの歴史の再生バー上の位置を、再生の中身（何日目・その日のどこ・どのページ）へ読み替える。
// 再生バーは日ごとに等幅で区切られ、1日の区間はその日の滞在時間（演出＋眺める時間＋ページ送り）に対応する。

/** 再生バー上の位置（0..1）→ 何日目と、その日の滞在時間に対する経過割合（0..1） */
export function scrubPosition(ratio: number, count: number): { index: number; offset: number } {
  if (count <= 0) return { index: 0, offset: 0 }
  const scaled = Math.max(0, Math.min(1, ratio)) * count
  const index = Math.min(count - 1, Math.floor(scaled))
  return { index, offset: Math.max(0, Math.min(1, scaled - index)) }
}

/**
 * その日の経過割合 → 配線図の演出の経過割合（0..1）。
 * 演出は日の頭から始まり、滞在時間より短い尺で終わる（残りは眺める時間・ページ送り）
 */
export function scrubClock(offset: number, stayMs: number, animMs: number): number {
  if (animMs <= 0) return 1
  return Math.max(0, Math.min(1, (offset * stayMs) / animMs))
}

/**
 * その日の経過割合 → 見せている IN/OUT のページ（0 始まり）。
 * 1ページ目は配線図の演出と同じ尺（baseMs）、2ページ目以降は pageMs ずつ
 */
export function scrubPage(offset: number, pages: number, baseMs: number, pageMs: number): number {
  if (pages <= 1) return 0
  const elapsed = Math.max(0, Math.min(1, offset)) * (baseMs + (pages - 1) * pageMs)
  return elapsed < baseMs ? 0 : Math.min(pages - 1, 1 + Math.floor((elapsed - baseMs) / pageMs))
}
