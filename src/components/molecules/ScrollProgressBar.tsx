import { StyleSheet } from 'react-native'
import Reanimated, { Extrapolation, interpolate, SharedValue, useAnimatedStyle } from 'react-native-reanimated'

interface Props {
  /**
   * スクロール量。スクロールハンドラ（UI スレッド）から書き込む。
   * JS を経由すると、重い画面（デスク詳細）で勢いよく弾いたときにバーが中身から遅れる
   */
  offset: SharedValue<number>
  /** スクロールの中身の高さ */
  contentH: number
  /** ScrollView 自身の高さ */
  viewportH: number
  color: string
  top?: number
  bottom?: number
}

const MIN_THUMB_H = 28
/** これ未満のはみ出しは指1本ぶんも動かないので、バーを出す意味がない */
const MIN_SCROLLABLE = 12

/**
 * 右端に出す現在位置バー。iOS 標準のインジケータはスクロール中しか出ず、
 * 長い一覧のどこを見ているかが分からないため、常時表示のものを重ねる。
 */
export function ScrollProgressBar({ offset, contentH, viewportH, color, top = 8, bottom = 8 }: Props) {
  const trackH = viewportH - top - bottom
  const scrollable = contentH - viewportH
  const visible = trackH > MIN_THUMB_H && scrollable > MIN_SCROLLABLE
  const thumbH = visible ? Math.max(MIN_THUMB_H, trackH * (viewportH / contentH)) : 0

  // フックなので早期 return より前に置く。出さないときも範囲が壊れないよう visible で止める
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{
      translateY: visible
        ? interpolate(offset.value, [0, scrollable], [0, trackH - thumbH], Extrapolation.CLAMP)
        : 0,
    }],
  }))

  if (!visible) return null

  return (
    <Reanimated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.thumb, { top, height: thumbH, backgroundColor: color }, thumbStyle]}
    />
  )
}

const styles = StyleSheet.create({
  thumb: { position: 'absolute', right: 3, width: 3, borderRadius: 1.5 },
})
