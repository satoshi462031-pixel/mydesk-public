import { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet } from 'react-native'
import { useApp } from '../../context/AppContext'
import { UI_METRICS } from '../../constants/ui'

interface Props {
  count: number
  index: number
  barWidth: number
  color: string
  inset: number
  gap?: number
  radius?: number
}

export function SegmentHighlight({ count, index, barWidth, color, inset, gap = 0, radius = UI_METRICS.chipRadius }: Props) {
  const { reduceMotion } = useApp()
  const position = useRef(new Animated.Value(index)).current
  const width = (barWidth - inset * 2 - gap * (count - 1)) / count
  const ready = count > 0 && index >= 0 && index < count && width > 0

  useEffect(() => {
    if (!ready) return
    if (reduceMotion) {
      position.setValue(index)
      return
    }
    const animation = Animated.timing(position, {
      toValue: index,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    })
    animation.start()
    return () => animation.stop()
  }, [index, position, reduceMotion, ready])

  if (!ready) return null

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.highlight, {
        backgroundColor: color,
        borderRadius: radius,
        top: inset,
        bottom: inset,
        left: inset,
        width,
        transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, width + gap] }) }],
      }]}
    />
  )
}

const styles = StyleSheet.create({
  highlight: { position: 'absolute' },
})
