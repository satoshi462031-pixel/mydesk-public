import { useEffect, useRef } from 'react'
import { Animated, DimensionValue, StyleProp, ViewStyle } from 'react-native'
import { useApp } from '../../context/AppContext'

interface Props {
  width?:  DimensionValue
  height?: DimensionValue
  radius?: number
  style?:  StyleProp<ViewStyle>
}

// データ取得中に本来のレイアウトの形で見せるプレースホルダー（ゆっくり明滅する）。
// 画面全体のスピナーの代わりに、コンテンツの骨組みを先に描いて待たされ感を減らす。
export function Skeleton({ width = '100%', height = 16, radius = 8, style }: Props) {
  const { colors, reduceMotion } = useApp()
  const opacity = useRef(new Animated.Value(0.45)).current

  useEffect(() => {
    // 抑えるときは明滅させない。骨組みは画面に何枚も並ぶので、止めずに残すと
    // 読み込みのあいだ視界の端でずっと点滅し続けることになる
    if (reduceMotion) {
      opacity.setValue(0.7)
      return
    }
    // ネイティブ駆動が無い環境（Web）では JS で動き、既定で「操作中」として InteractionManager を待たせる。
    // 読み込みの間ずっと回るので、骨組みを消すための処理（runAfterInteractions に送ったタブのマウント）まで止まる
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true, isInteraction: false }),
        Animated.timing(opacity, { toValue: 0.45, duration: 600, useNativeDriver: true, isInteraction: false }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity, reduceMotion])

  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.chip, opacity }, style]}
    />
  )
}
