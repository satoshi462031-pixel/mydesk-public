import { Switch } from 'react-native'
import { useApp } from '../../context/AppContext'

type ToggleColors = {
  accent: string
  text: string
  textSub: string
  textMuted: string
  border: string
  chip: string
}

type Props = {
  value: boolean
  onValueChange: (value: boolean) => void
  colors: ToggleColors
  disabled?: boolean
  accessibilityLabel?: string
}

export function ContrastToggle({ value, onValueChange, colors, disabled = false, accessibilityLabel }: Props) {
  const { isDark } = useApp()
  const offTrack = isDark ? colors.border : colors.textMuted
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: offTrack, true: colors.accent }}
      ios_backgroundColor={offTrack}
      thumbColor="#FFFFFF"
      style={{ opacity: disabled ? 0.5 : 1 }}
      accessibilityLabel={accessibilityLabel}
    />
  )
}
