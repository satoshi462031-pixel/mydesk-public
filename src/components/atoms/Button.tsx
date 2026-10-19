import {
  ActivityIndicator,
  Animated,
  GestureResponderEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableOpacityProps,
} from 'react-native'
import { ReactNode, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { PRESS_INTERACTION, UI_METRICS } from '../../constants/ui'
import { useLongPressGuard } from '../../hooks/useLongPressGuard'

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity)

interface Props extends TouchableOpacityProps {
  title: string
  variant?: 'primary' | 'secondary' | 'neutral' | 'ghost'
  loading?: boolean
  leading?: ReactNode
  size?: 'default' | 'compact'
  shape?: 'pill' | 'control'
}

export function Button({
  title,
  variant = 'primary',
  loading,
  leading,
  size = 'default',
  shape = 'pill',
  style,
  disabled,
  accessibilityRole = 'button',
  activeOpacity = 0.85,
  delayLongPress = PRESS_INTERACTION.longPressDelay,
  onPress,
  onPressIn,
  onPressOut,
  onLongPress,
  ...rest
}: Props) {
  const { colors, reduceMotion } = useApp()
  const scale = useRef(new Animated.Value(1)).current
  const guardedPress = useLongPressGuard<GestureResponderEvent>(onPress, onLongPress)

  const animateScale = (toValue: number, duration: number) => {
    if (reduceMotion) {
      scale.setValue(1)
      return
    }
    scale.stopAnimation()
    Animated.timing(scale, { toValue, duration, useNativeDriver: true }).start()
  }

  // secondary/ghost はテーマに追従（ハードコード色はダークモードで破綻するため）
  const variantStyle = variant === 'primary'
    ? { backgroundColor: colors.accent }
    : variant === 'secondary'
    ? { backgroundColor: colors.card, borderColor: colors.accentIcon }
    : variant === 'neutral'
    ? { backgroundColor: colors.chip }
    : {}

  // primary は accent 塗りの上に載るので onAccent。白だとアクセント色によっては
  // コントラストが 2:1 台まで落ちる
  const textColor = variant === 'primary' ? colors.onAccent : variant === 'secondary' ? colors.accentText : colors.text

  return (
    <AnimatedTouchableOpacity
      style={[
        styles.base,
        size === 'compact' && styles.compact,
        shape === 'control' && styles.control,
        styles[variant],
        variantStyle,
        disabled && styles.disabled,
        style,
        { transform: [{ scale }] },
      ]}
      activeOpacity={activeOpacity}
      delayLongPress={delayLongPress}
      onPressIn={(event) => {
        guardedPress.beginPress()
        animateScale(PRESS_INTERACTION.scale, PRESS_INTERACTION.pressInDuration)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        animateScale(1, PRESS_INTERACTION.pressOutDuration)
        onPressOut?.(event)
      }}
      onPress={guardedPress.onPress}
      onLongPress={guardedPress.onLongPress}
      disabled={disabled || loading}
      accessibilityRole={accessibilityRole}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.onAccent : colors.accentIcon} />
      ) : (
        <>
          {leading}
          <Text style={[styles.text, size === 'compact' && styles.compactText, { color: textColor }]}>
            {title}
          </Text>
        </>
      )}
    </AnimatedTouchableOpacity>
  )
}

const styles = StyleSheet.create({
  base: {
    minHeight: UI_METRICS.buttonHeight,
    borderRadius: UI_METRICS.pillRadius,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  compact: { minHeight: UI_METRICS.touchMinSize, paddingVertical: 12, paddingHorizontal: 16 },
  control: { borderRadius: UI_METRICS.controlRadius },
  primary: {},
  secondary: {
    borderWidth: 1.5,
  },
  neutral: {},
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  compactText: { fontSize: 14 },
})
