import { useCallback, useRef } from 'react'
import { hapticMedium } from '../utils/haptics'

/** 長押し成立後の指離しで、通常の onPress まで実行されるのを防ぐ。 */
export function useLongPressGuard<Event>(
  onPress?: (event: Event) => void,
  onLongPress?: (event: Event) => void,
) {
  const handledLongPressRef = useRef(false)

  const beginPress = useCallback(() => {
    handledLongPressRef.current = false
  }, [])

  const handlePress = useCallback((event: Event) => {
    if (handledLongPressRef.current) {
      handledLongPressRef.current = false
      return
    }
    onPress?.(event)
  }, [onPress])

  const handleLongPress = useCallback((event: Event) => {
    handledLongPressRef.current = true
    hapticMedium()
    onLongPress?.(event)
  }, [onLongPress])

  return {
    beginPress,
    onPress: handlePress,
    onLongPress: onLongPress ? handleLongPress : undefined,
  }
}
