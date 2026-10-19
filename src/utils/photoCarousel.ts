export function clampPhotoIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.round(index), 0), count - 1)
}

export function photoIndexFromOffset(offset: number, pageWidth: number, count: number): number {
  if (!(pageWidth > 0)) return 0
  return clampPhotoIndex(offset / pageWidth, count)
}
