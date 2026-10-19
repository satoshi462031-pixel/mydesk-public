import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleProp, ViewProps, ViewStyle } from 'react-native'
import Reanimated, { LinearTransition } from 'react-native-reanimated'
import { useApp } from '../../context/AppContext'

type Props = ViewProps & {
  added: boolean
  active?: boolean
  onEntered: () => void
  contentStyle?: StyleProp<ViewStyle>
  reflow?: boolean
}

export function AdditionMotion({ added, active = true, onEntered, children, contentStyle, reflow = true, ...props }: Props) {
  const { reduceMotion } = useApp()
  const opacity = useRef(new Animated.Value(added && active && !reduceMotion ? 0 : 1)).current
  const entered = useRef(onEntered)
  entered.current = onEntered

  useEffect(() => {
    if (!added || !active || reduceMotion) {
      opacity.setValue(1)
      if (added && active) entered.current()
      return
    }
    opacity.setValue(0)
    const animation = Animated.timing(opacity, {
      toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    })
    animation.start(({ finished }) => { if (finished) entered.current() })
    return () => animation.stop()
  }, [active, added, opacity, reduceMotion])

  return (
    <Reanimated.View {...props} collapsable={false} layout={reduceMotion || !reflow ? undefined : LinearTransition.duration(180)}>
      <Animated.View style={[contentStyle, { opacity }]}>{children}</Animated.View>
    </Reanimated.View>
  )
}
