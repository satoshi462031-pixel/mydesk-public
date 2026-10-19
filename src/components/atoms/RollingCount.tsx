import { useLayoutEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleProp, TextStyle, View } from 'react-native'
import { useApp } from '../../context/AppContext'

const DURATION_MS = 260

/**
 * 件数が変わるとき、増えたら上へ・減ったら下へ数字を送る（X のいいね数と同じ動き）。
 * 手の演出だけでは、自分の1件が数に加わったことが伝わらないため。
 *
 * 最初の表示では動かさない。動きを減らす設定のときは差し替えるだけにする。
 * 読み上げは押すボタン側の名前が件数を持つので、ここでは出て行く数字を読ませない。
 */
export function RollingCount({ value, style }: {
  value: number
  style?: StyleProp<TextStyle>
}) {
  const { reduceMotion } = useApp()
  const [shown, setShown] = useState(value)
  const [roll, setRoll] = useState<{ from: number; dir: 1 | -1 } | null>(null)
  const [height, setHeight] = useState(0)
  const p = useRef(new Animated.Value(1)).current

  // 描画中に前の値との差を取る。effect で取ると、新しい数字が送られる前の位置に1フレーム出る
  if (shown !== value) {
    setShown(value)
    setRoll(reduceMotion || height === 0 ? null : { from: shown, dir: value > shown ? 1 : -1 })
  }

  useLayoutEffect(() => {
    if (!roll) return
    p.setValue(0)
    const anim = Animated.timing(p, { toValue: 1, duration: DURATION_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    anim.start(({ finished }) => {
      if (finished) setRoll(null)
    })
    return () => anim.stop()
  }, [roll, p])

  const distance = height * 0.8
  return (
    <View style={{ overflow: 'hidden' }} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}>
      <Animated.Text
        style={[style, roll && {
          opacity: p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] }),
          transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [roll.dir * distance, 0] }) }],
        }]}
        numberOfLines={1}
      >
        {value}
      </Animated.Text>
      {roll && (
        <Animated.Text
          style={[style, {
            position: 'absolute', left: 0, top: 0,
            opacity: p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0, 0] }),
            transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, -roll.dir * distance] }) }],
          }]}
          numberOfLines={1}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {roll.from}
        </Animated.Text>
      )}
    </View>
  )
}
