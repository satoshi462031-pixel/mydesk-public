import { MutableRefObject, ReactNode, useEffect, useMemo } from 'react'
import { ViewProps, ViewStyle } from 'react-native'
import { Path, PathProps } from 'react-native-svg'
import Reanimated, { cancelAnimation, Easing, Extrapolation, interpolate, makeMutable, ReduceMotion, runOnUI, SharedValue, useAnimatedProps, useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated'

type Range = { inputRange: number[]; outputRange: number[] }
export type HistoryMotionNumber = number | Range
export type HistoryMotionProgress = { value: SharedValue<number>; interpolate: typeof historyRange }

const SAMPLE_COUNT = 128
const SAMPLE_INPUT = Array.from({ length: SAMPLE_COUNT + 1 }, (_, i) => i / SAMPLE_COUNT)

function historyRange({ inputRange, outputRange, easing }: Range & { easing?: (x: number) => number; extrapolate?: 'clamp' }): Range {
  if (!easing) return { inputRange, outputRange }
  // React Native の Easing や呼び出し元の関数を worklet へ持ち込まず、元の曲線を保つ。
  return {
    inputRange: SAMPLE_INPUT.map((x) => inputRange[0] + x * (inputRange[1] - inputRange[0])),
    outputRange: SAMPLE_INPUT.map((x) => outputRange[0] + easing(x) * (outputRange[1] - outputRange[0])),
  }
}

function resolve(value: HistoryMotionNumber, progress: number): number {
  'worklet'
  return typeof value === 'number' ? value : interpolate(progress, value.inputRange, value.outputRange, Extrapolation.CLAMP)
}

export function useHistoryMotionClock({ animKey, startAt, durationMs, frozen, reduceMotion, clockEasing, seekRef }: {
  animKey: string
  startAt: number
  durationMs: number
  frozen: boolean
  reduceMotion: boolean
  clockEasing: (x: number) => number
  seekRef: MutableRefObject<((x: number) => void) | null>
}): HistoryMotionProgress {
  // イベントごとに別の値を使い、最初の描画に前イベントの終点を混ぜない。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const raw = useMemo(() => makeMutable(reduceMotion ? 1 : Math.max(0, Math.min(1, startAt))), [animKey])
  const curve = useMemo(() => SAMPLE_INPUT.map(clockEasing), [clockEasing])
  const eased = useDerivedValue(() => interpolate(raw.value, SAMPLE_INPUT, curve, Extrapolation.CLAMP))
  useEffect(() => {
    runOnUI(() => {
      'worklet'
      cancelAnimation(raw)
      if (reduceMotion) raw.value = 1
      if (!frozen && raw.value < 1) {
        raw.value = withTiming(1, { duration: durationMs * (1 - raw.value), easing: Easing.linear, reduceMotion: ReduceMotion.Never })
      }
    })()
    return () => cancelAnimation(raw)
  }, [raw, durationMs, frozen, reduceMotion])
  useEffect(() => {
    seekRef.current = (x) => { raw.value = reduceMotion ? 1 : x }
    return () => { seekRef.current = null }
  }, [raw, reduceMotion, seekRef])
  return useMemo(() => ({ value: eased, interpolate: historyRange }), [eased])
}

const NativePath = Reanimated.createAnimatedComponent(Path)

export function HistoryMotionPath({ progress, opacity = 1, strokeWidth = 1, strokeDashoffset = 0, ...props }: Omit<PathProps, 'opacity' | 'strokeWidth' | 'strokeDashoffset'> & {
  progress: HistoryMotionProgress
  opacity?: HistoryMotionNumber
  strokeWidth?: HistoryMotionNumber
  strokeDashoffset?: HistoryMotionNumber
}) {
  const dynamic = typeof opacity !== 'number' || typeof strokeWidth !== 'number' || typeof strokeDashoffset !== 'number'
  const clock = dynamic ? progress.value : null
  const animatedProps = useAnimatedProps(() => {
    const t = clock?.value ?? 0
    return { opacity: resolve(opacity, t), strokeWidth: resolve(strokeWidth, t), strokeDashoffset: resolve(strokeDashoffset, t) }
  })
  return <NativePath {...props} animatedProps={animatedProps} />
}

type Transform = { scale: HistoryMotionNumber } | { translateX: HistoryMotionNumber } | { translateY: HistoryMotionNumber }

export function HistoryMotionView({ progress, style, children, ...props }: Omit<ViewProps, 'style'> & {
  progress: HistoryMotionProgress
  style: Omit<ViewStyle, 'opacity' | 'transform'> & { opacity?: HistoryMotionNumber; transform?: Transform[] }
  children?: ReactNode
}) {
  const { opacity = 1, transform = [], ...base } = style
  const dynamic = typeof opacity !== 'number' || transform.some((item) => typeof Object.values(item)[0] !== 'number')
  const clock = dynamic ? progress.value : null
  const animatedStyle = useAnimatedStyle(() => {
    const t = clock?.value ?? 0
    return {
      opacity: resolve(opacity, t),
      transform: transform.map((item) => {
        if ('scale' in item) return { scale: resolve(item.scale, t) }
        if ('translateX' in item) return { translateX: resolve(item.translateX, t) }
        return { translateY: resolve(item.translateY, t) }
      }),
    }
  })
  return <Reanimated.View {...props} style={[base, animatedStyle]}>{children}</Reanimated.View>
}
