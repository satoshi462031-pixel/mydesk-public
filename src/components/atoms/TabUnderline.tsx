import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet } from 'react-native'
import { useApp } from '../../context/AppContext'

/**
 * タブの下線。押した先へ滑らせる。瞬間移動だと、押した指より先に別の場所へ
 * 印が現れて「どこから来たか」が読めない。
 *
 * マイデスク・他人のデスク・マイページ・みんなのデスクの検索で同じ動きを
 * 4回書いていたので1つに集めた。動きを抑える設定もここだけが見る。
 */
const DURATION = 200

interface Props {
  /** タブの数 */
  count: number
  /** 選択中のタブ（0 始まり）。押された先を渡す（中身のマウントを待たない） */
  index: number
  /** タブバー全体の幅。測れていない間（0）は描かない */
  barWidth: number
  color: string
  /** 下線の幅。省略するとタブ1つぶんいっぱい */
  width?: number
  /** タブバーの下端からの位置。境界線に重ねる画面があるので受け取る */
  bottom?: number
}

export function TabUnderline({ count, index, barWidth, color, width, bottom = 0 }: Props) {
  const { reduceMotion, colors } = useApp()
  // 選択中の位置から始める。0 から始めると、開いた直後に下線が左から滑ってくる
  const anim = useRef(new Animated.Value(index)).current
  const ready = barWidth > 0 && count > 0

  useEffect(() => {
    if (!ready) return
    if (reduceMotion) {
      anim.setValue(index)
      return
    }
    const timing = Animated.timing(anim, {
      toValue: index,
      duration: DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    })
    timing.start()
    return () => timing.stop()
  }, [index, anim, reduceMotion, ready])

  if (!ready) return null

  const tabWidth = barWidth / count
  const underlineW = width ?? tabWidth
  // タブが1つでも interpolate は2点以上を要求する
  const points = Math.max(count, 2)

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.underline, {
        backgroundColor: color === colors.accent ? colors.accentIcon : color,
        bottom,
        width: underlineW,
        left: (tabWidth - underlineW) / 2,
        transform: [{
          translateX: anim.interpolate({
            inputRange: Array.from({ length: points }, (_, i) => i),
            outputRange: Array.from({ length: points }, (_, i) => i * tabWidth),
          }),
        }],
      }]}
    />
  )
}

const styles = StyleSheet.create({
  underline: { position: 'absolute', height: 2, borderRadius: 1 },
})
