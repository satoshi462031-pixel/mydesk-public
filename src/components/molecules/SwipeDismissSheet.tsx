import { PropsWithChildren, useEffect, useMemo, useRef } from 'react'
import { UI_METRICS } from '../../constants/ui'
import {
  Animated,
  PanResponder,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native'

interface Props extends PropsWithChildren {
  visible: boolean
  onDismiss: () => void
  disabled?: boolean
  handleColor: string
  style?: StyleProp<ViewStyle>
  translateY: Animated.Value
  onDrag: (offset: number, height: number) => void
  onRelease: (velocity: number, height: number) => void
  reduceMotion?: boolean
}

const MIN_DISMISS_DISTANCE = 84
const DISMISS_VELOCITY = 0.9

/**
 * ボトムシート共通のドラッグハンドル。
 * スクロール領域とジェスチャーを競合させないため、ドラッグ開始はハンドルに限定する。
 */
export function SwipeDismissSheet({ visible, onDismiss, disabled = false, handleColor, style, children, translateY, onDrag, onRelease, reduceMotion = false }: Props) {
  const heightRef = useRef(0)
  const startOffset = useRef(0)
  const onDismissRef = useRef(onDismiss)
  const disabledRef = useRef(disabled)
  const onDragRef = useRef(onDrag)
  const onReleaseRef = useRef(onRelease)
  const reduceMotionRef = useRef(reduceMotion)
  const visibleRef = useRef(visible)

  useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])
  onDragRef.current = onDrag
  onReleaseRef.current = onRelease
  disabledRef.current = disabled || !visible
  reduceMotionRef.current = reduceMotion
  visibleRef.current = visible

  const restore = () => {
    if (!visibleRef.current) return
    onDragRef.current(0, heightRef.current)
    if (reduceMotionRef.current) { translateY.setValue(0); return }
    Animated.spring(translateY, {
      toValue: 0,
      damping: 22,
      stiffness: 240,
      mass: 0.8,
      useNativeDriver: true,
    }).start()
  }

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => (
      !disabledRef.current &&
      gesture.dy > 4 &&
      Math.abs(gesture.dy) > Math.abs(gesture.dx)
    ),
    onPanResponderGrant: () => {
      if (disabledRef.current) return
      translateY.stopAnimation((value) => { startOffset.current = value })
    },
    onPanResponderMove: (_event, gesture) => {
      if (disabledRef.current) return
      const offset = Math.max(0, startOffset.current + gesture.dy)
      translateY.setValue(offset)
      onDragRef.current(offset, heightRef.current)
    },
    onPanResponderRelease: (_event, gesture) => {
      const distance = Math.min(MIN_DISMISS_DISTANCE, Math.max(40, heightRef.current * 0.25))
      if (!disabledRef.current && (gesture.dy >= distance || gesture.vy >= DISMISS_VELOCITY)) {
        onReleaseRef.current(gesture.vy, heightRef.current)
        onDismissRef.current()
      }
      else restore()
    },
    onPanResponderTerminate: restore,
  // 最新の props は ref 経由で参照し、ドラッグ中に responder を作り直さない。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [translateY])

  return (
    <Animated.View
      style={[style, { transform: [{ translateY }] }]}
      onLayout={(event) => { heightRef.current = event.nativeEvent.layout.height }}
    >
      <View
        style={styles.dragArea}
        {...panResponder.panHandlers}
        accessible={false}
      >
        <View style={[styles.handle, { backgroundColor: handleColor }]} />
      </View>
      {children}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  dragArea: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 38, height: 4, borderRadius: UI_METRICS.pillRadius },
})
