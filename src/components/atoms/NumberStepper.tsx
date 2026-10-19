import { useRef } from 'react'
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { AppIcon } from './AppIcon'

interface Props {
  value: number
  onChange: (value: number) => void
  accessibilityLabel: string
  min?: number
  max?: number
  size?: 'compact' | 'regular'
  style?: StyleProp<ViewStyle>
}

export function NumberStepper({
  value,
  onChange,
  accessibilityLabel,
  min = 0,
  max = 10,
  size = 'compact',
  style,
}: Props) {
  const { colors: C, t } = useApp()
  const currentValue = useRef(value)
  currentValue.current = value
  const compact = size === 'compact'
  const atMin = value <= min
  const atMax = value >= max

  const button = (direction: -1 | 1) => {
    const disabled = direction < 0 ? atMin : atMax
    return (
      <TouchableOpacity
        style={[
          compact ? styles.compactButton : styles.regularButton,
          compact && { backgroundColor: C.chip },
        ]}
        onPress={() => {
          const next = Math.max(min, Math.min(max, currentValue.current + direction))
          if (next === currentValue.current) return
          currentValue.current = next
          onChange(next)
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel} ${t(direction < 0 ? 'a11y.decrease' : 'a11y.increase')}`}
        accessibilityState={{ disabled }}
      >
        <AppIcon
          name={direction < 0 ? ICONS.subtract : ICONS.add}
          size={18}
          color={disabled ? C.textMuted : C.text}
        />
      </TouchableOpacity>
    )
  }

  return (
    <View
      style={[
        styles.base,
        compact ? styles.compact : [styles.regular, { borderColor: C.border }],
        style,
      ]}
    >
      {button(-1)}
      <Text style={[compact ? styles.compactValue : styles.regularValue, { color: C.text }]}>{value}</Text>
      {button(1)}
    </View>
  )
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center' },
  compact: { gap: 8 },
  compactButton: {
    width: UI_METRICS.touchMinSize,
    height: UI_METRICS.touchMinSize,
    borderRadius: UI_METRICS.controlRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactValue: { width: 28, textAlign: 'center', fontSize: 16, fontWeight: '600' },
  regular: {
    borderWidth: 1,
    borderRadius: UI_METRICS.chipRadius,
    overflow: 'hidden',
  },
  regularButton: { width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center' },
  regularValue: { width: 28, textAlign: 'center', fontSize: 15, fontWeight: '700' },
})
