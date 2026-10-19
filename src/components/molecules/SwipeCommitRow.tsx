import { ComponentProps, ReactNode, useCallback, useEffect, useRef } from 'react'
import { Animated } from 'react-native'
import type { Swipeable } from 'react-native-gesture-handler'
import { SwipeableRow } from './SwipeableRow'
import { hapticLight, hapticSelection } from '../../utils/haptics'
import { SWIPEABLE_ROW_PROPS } from '../../utils/swipeableRow'

type Props = Omit<ComponentProps<typeof Swipeable>, 'onSwipeableOpen' | 'onSwipeableOpenStartDrag' | 'onSwipeableCloseStartDrag'> & {
  commitDirection?: 'left' | 'right'
  commitDistance?: number
  closeOnShortSwipe?: boolean
  hapticOnCommit?: boolean
  onCommit?: () => void | boolean | Promise<void | boolean>
  renderCommitActions: (progress: Animated.AnimatedInterpolation<number>, commit: () => void) => ReactNode
  onRowRef?: (row: Swipeable | null) => void
}

export function SwipeCommitRow({
  commitDirection = 'left', commitDistance = 72, closeOnShortSwipe = false, hapticOnCommit = true,
  onCommit, renderCommitActions, onRowRef, children, ...rowProps
}: Props) {
  const rowRef = useRef<Swipeable | null>(null)
  const reachedDistance = useRef(false)
  const committed = useRef(false)
  const closingGesture = useRef(false)
  const trackDistance = useCallback((distance: number) => {
    if (rowProps.enabled === false || committed.current || closingGesture.current) return
    const directed = commitDirection === 'left' ? distance : -distance
    if (directed >= commitDistance && !reachedDistance.current) {
      reachedDistance.current = true
      hapticLight()
    }
  }, [commitDirection, commitDistance, rowProps.enabled])
  const reset = () => { reachedDistance.current = false; committed.current = false }
  const commit = () => {
    if (rowProps.enabled === false || !onCommit || committed.current) return
    committed.current = true
    rowRef.current?.close()
    const result = onCommit()
    if (!hapticOnCommit) return
    if (result && typeof result === 'object') {
      void result.then((accepted) => { if (accepted !== false) hapticSelection() }).catch(() => {})
    } else if (result !== false) hapticSelection()
  }
  const actions = onCommit ? (progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => (
    <SwipeDistanceObserver dragX={dragX} onDistance={trackDistance}>
      {renderCommitActions(progress, commit)}
    </SwipeDistanceObserver>
  ) : undefined

  return (
    <SwipeableRow
      {...SWIPEABLE_ROW_PROPS}
      leftThreshold={commitDirection === 'left' ? commitDistance : undefined}
      rightThreshold={commitDirection === 'right' ? commitDistance : undefined}
      overshootLeft={false}
      overshootRight={false}
      {...rowProps}
      ref={(row) => { rowRef.current = row; onRowRef?.(row) }}
      onSwipeableOpenStartDrag={() => { closingGesture.current = false; reset(); SWIPEABLE_ROW_PROPS.onSwipeableOpenStartDrag() }}
      onSwipeableCloseStartDrag={() => { closingGesture.current = true; reset() }}
      onSwipeableOpen={(direction, row) => {
        if (!closingGesture.current && direction === commitDirection && onCommit) {
          // Swipeable は速度でも開くため、短いフリックでは操作を確定しない。
          if (reachedDistance.current) { commit(); return }
          if (closeOnShortSwipe) { row.close(); return }
        }
        SWIPEABLE_ROW_PROPS.onSwipeableOpen(direction, row)
      }}
      renderLeftActions={commitDirection === 'left' ? actions : rowProps.renderLeftActions}
      renderRightActions={commitDirection === 'right' ? actions : rowProps.renderRightActions}
    >
      {children}
    </SwipeableRow>
  )
}

export function SwipeDistanceObserver({ dragX, onDistance, children }: {
  dragX: Animated.AnimatedInterpolation<number>
  onDistance: (distance: number) => void
  children: ReactNode
}) {
  useEffect(() => {
    const listener = dragX.addListener(({ value }) => onDistance(value))
    return () => dragX.removeListener(listener)
  }, [dragX, onDistance])
  return <>{children}</>
}
