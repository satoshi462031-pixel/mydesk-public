import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Animated, Easing, StyleProp, ViewProps, ViewStyle } from 'react-native'
import Reanimated, { LinearTransition } from 'react-native-reanimated'
import { useApp } from '../../context/AppContext'

export type RemovalMode = 'left' | 'fade'
export type RemovalHandle = {
  exit: (mode: RemovalMode) => Promise<void>
  restore: () => void
  enter?: () => void
}

export const RemovalMotion = forwardRef<RemovalHandle, ViewProps & { collapse?: boolean; contentStyle?: StyleProp<ViewStyle> }>(function RemovalMotion({
  children, style, contentStyle, onLayout, collapse = true, ...props
}, ref) {
  const { reduceMotion } = useApp()
  const [removing, setRemoving] = useState(false)
  const removingRef = useRef(false)
  const mounted = useRef(true)
  const size = useRef({ width: 0, height: 0 })
  const offset = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(1)).current
  const height = useRef(new Animated.Value(0)).current
  const animation = useRef<Animated.CompositeAnimation | null>(null)
  const complete = useRef<(() => void) | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      animation.current?.stop()
      complete.current?.()
    }
  }, [])

  useImperativeHandle(ref, () => ({
    exit: (mode) => {
      if (removingRef.current) return Promise.resolve()
      removingRef.current = true
      if (reduceMotion || size.current.height === 0) return Promise.resolve()
      height.setValue(size.current.height)
      setRemoving(true)
      return new Promise<void>((resolve) => {
        complete.current = resolve
        const steps = [Animated.parallel([
          Animated.timing(offset, {
            toValue: mode === 'left' ? -size.current.width : 0,
            duration: 150,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        ])]
        if (collapse) steps.push(Animated.timing(height, {
          toValue: 0, duration: 100, easing: Easing.inOut(Easing.cubic), useNativeDriver: false,
        }))
        animation.current = Animated.sequence(steps)
        animation.current.start(() => {
          complete.current = null
          resolve()
        })
      })
    },
    restore: () => {
      if (!mounted.current) return
      animation.current?.stop()
      offset.setValue(0)
      height.setValue(size.current.height)
      removingRef.current = false
      setRemoving(false)
      Animated.timing(opacity, { toValue: 1, duration: reduceMotion ? 0 : 120, useNativeDriver: true }).start()
    },
    enter: () => {
      if (reduceMotion) return
      opacity.setValue(0)
      Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start()
    },
  }), [collapse, height, offset, opacity, reduceMotion])

  return (
    <Animated.View
      {...props}
      style={[style, removing && { overflow: 'hidden' }, removing && collapse && { height }]}
      onLayout={(event) => {
        if (!removingRef.current) size.current = event.nativeEvent.layout
        onLayout?.(event)
      }}
      pointerEvents={removing ? 'none' : props.pointerEvents}
      accessibilityElementsHidden={removing || props.accessibilityElementsHidden}
      importantForAccessibility={removing ? 'no-hide-descendants' : props.importantForAccessibility}
    >
      <Animated.View style={[contentStyle, { opacity, transform: [{ translateX: offset }] }]}>{children}</Animated.View>
    </Animated.View>
  )
})

export function useRemovalMotion() {
  const rows = useRef(new Map<string, RemovalHandle>())
  const pending = useRef(new Set<string>())
  const removed = useRef(new Set<string>())
  const setRef = useCallback((id: string, handle: RemovalHandle | null) => {
    if (handle) {
      rows.current.set(id, handle)
      if (removed.current.delete(id)) handle.enter?.()
    }
    else rows.current.delete(id)
  }, [])
  const run = useCallback(async <T,>(ids: string | string[], operation: () => T | Promise<T>, mode: RemovalMode = 'left') => {
    const keys = [...new Set(typeof ids === 'string' ? [ids] : ids)]
    if (keys.some((id) => pending.current.has(id))) return
    keys.forEach((id) => pending.current.add(id))
    const handles = keys.map((id) => rows.current.get(id)).filter((row): row is RemovalHandle => !!row)
    try {
      await Promise.all(handles.map((row) => row.exit(mode)))
      const result = await operation()
      if (result === false) handles.forEach((row) => row.restore())
      else keys.forEach((id) => removed.current.add(id))
      return result
    } catch (error) {
      handles.forEach((row) => row.restore())
      throw error
    } finally {
      keys.forEach((id) => pending.current.delete(id))
    }
  }, [])
  return useMemo(() => ({ setRef, run }), [setRef, run])
}

export function RemovalLayout({ children, ...props }: ViewProps) {
  const { reduceMotion } = useApp()
  return <Reanimated.View {...props} collapsable={false} layout={reduceMotion ? undefined : LinearTransition.duration(120)}>{children}</Reanimated.View>
}
