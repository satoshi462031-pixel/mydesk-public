// 全スワイプ（行を引ききると操作が確定する。iOS のメールと同じ）の判定。
//
// 閾値は2段。短い閾値（ボタン1つ分）で離すとボタンを出して止まり、長い閾値を越えて離すと確定する。
// 長い閾値は行幅の割合だけで決めると、みんなのデスクの2列のタイル（幅 170 前後）ではボタン幅と
// ほとんど変わらず、ボタンを出すつもりで確定してしまう。ボタン幅に一定の距離を足した値を下限にする。

export const FULL_SWIPE_RATIO = 0.55
export const FULL_SWIPE_MIN_EXTRA = 56
// 閾値の上で指が細かく揺れたとき、確定の可否と振動が行ったり来たりしないための遊び
export const FULL_SWIPE_HYSTERESIS = 12

export function fullSwipeThreshold(rowWidth: number, actionWidth: number): number {
  return Math.max(actionWidth + FULL_SWIPE_MIN_EXTRA, rowWidth * FULL_SWIPE_RATIO)
}

/** 引いた距離から、離したら確定する状態（armed）かを返す。越えたら確定、遊びの分だけ戻したら解除 */
export function nextFullSwipeArmed(distance: number, threshold: number, armed: boolean): boolean {
  if (armed) return distance > threshold - FULL_SWIPE_HYSTERESIS
  return distance >= threshold
}

/**
 * 「元に戻す」で、外した項目を元の位置へ戻す。外したあとに一覧が読み直されて既に戻っていれば
 * 二重にしない。元の位置が一覧の長さを越えていたら末尾に置く
 */
export function restoreAt<T>(list: readonly T[], item: T, index: number, sameItem: (a: T, b: T) => boolean): T[] {
  if (list.some((value) => sameItem(value, item))) return [...list]
  const at = Math.max(0, Math.min(index, list.length))
  return [...list.slice(0, at), item, ...list.slice(at)]
}
