import { ComponentProps, forwardRef, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { interruptSwipePeek, SWIPEABLE_ROW_PROPS, swipeActionOpacity } from '../../utils/swipeableRow'

export const SwipeableRow = forwardRef<Swipeable, ComponentProps<typeof Swipeable>>(function SwipeableRow(props, ref) {
  const rowRef = useRef<Swipeable | null>(null)
  const leftVisible = useRef(new Animated.Value(1)).current
  const rightVisible = useRef(new Animated.Value(1)).current
  const rowProps = { ...SWIPEABLE_ROW_PROPS, ...props }
  const resetVisibility = () => {
    leftVisible.setValue(1)
    rightVisible.setValue(1)
  }

  return (
    <Swipeable
      {...rowProps}
      ref={(row) => {
        rowRef.current = row
        if (typeof ref === 'function') ref(row)
        else if (ref) ref.current = row
      }}
      onBegan={(event) => {
        if (rowRef.current) interruptSwipePeek(rowRef.current)
        rowProps.onBegan?.(event)
      }}
      renderLeftActions={rowProps.renderLeftActions ? (progress, translation, row) => (
        <Animated.View style={[styles.actions, { opacity: Animated.multiply(leftVisible, swipeActionOpacity(progress)) }]}>
          {rowProps.renderLeftActions!(progress, translation, row)}
        </Animated.View>
      ) : undefined}
      renderRightActions={rowProps.renderRightActions ? (progress, translation, row) => (
        <Animated.View style={[styles.actions, { opacity: Animated.multiply(rightVisible, swipeActionOpacity(progress)) }]}>
          {rowProps.renderRightActions!(progress, translation, row)}
        </Animated.View>
      ) : undefined}
      onSwipeableOpenStartDrag={(direction) => {
        resetVisibility()
        rowProps.onSwipeableOpenStartDrag?.(direction)
      }}
      onSwipeableCloseStartDrag={(direction) => {
        // すでに開いている側を閉じる一筆で、反対側の操作まで露出させない。
        leftVisible.setValue(direction === 'left' ? 1 : 0)
        rightVisible.setValue(direction === 'right' ? 1 : 0)
        rowProps.onSwipeableCloseStartDrag?.(direction)
      }}
      onSwipeableClose={(direction, row) => {
        resetVisibility()
        rowProps.onSwipeableClose?.(direction, row)
      }}
    />
  )
})

const styles = StyleSheet.create({
  actions: { flexDirection: 'row' },
})
