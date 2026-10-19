import { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { CUSTOM_CATEGORY_COLOR_PRESETS } from '../../constants/colors'
import { CUSTOM_PURPOSE_COLOR_ENABLED } from '../../constants/features'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { normalizeCustomCategoryColor } from '../../utils/customCategory'
import { TextField } from '../atoms/TextField'

interface Props {
  value: string
  onChange: (color: string) => void
}

export function CustomPurposeColorEditor({ value, onChange }: Props) {
  const { colors: C, lang } = useApp()
  const [customOpen, setCustomOpen] = useState(() =>
    !CUSTOM_CATEGORY_COLOR_PRESETS.some((preset) => preset.color === normalizeCustomCategoryColor(value)))
  const chosen = normalizeCustomCategoryColor(value)

  if (!CUSTOM_PURPOSE_COLOR_ENABLED) return null

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text style={[styles.label, { color: C.textSub }]}>{lang === 'ja' ? 'アイコンの色' : 'Icon color'}</Text>
        <TouchableOpacity onPress={() => setCustomOpen((open) => !open)} accessibilityRole="button"
          accessibilityState={{ expanded: customOpen }} style={styles.customButton}>
          <Text style={[styles.label, { color: C.accentText }]}>{lang === 'ja' ? 'カスタム' : 'Custom'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.palette}>
        {CUSTOM_CATEGORY_COLOR_PRESETS.map((preset) => (
          <TouchableOpacity key={preset.color} style={styles.swatchButton}
            onPress={() => onChange(preset.color)} accessibilityRole="radio"
            accessibilityState={{ selected: chosen === preset.color }}
            accessibilityLabel={lang === 'ja' ? preset.ja : preset.en}>
            <View style={[styles.swatch, { backgroundColor: preset.color, borderColor: chosen === preset.color ? C.text : C.border, borderWidth: chosen === preset.color ? 3 : 1 }]} />
          </TouchableOpacity>
        ))}
      </View>
      {customOpen && (
        <TextField value={value} onChangeText={(input) => onChange(input.startsWith('#') ? input : `#${input}`)}
          maxLength={7} autoCapitalize="characters" autoCorrect={false} placeholder="#RRGGBB"
          accessibilityLabel={lang === 'ja' ? '用途アイコンの色（16進数）' : 'Purpose icon color (hex)'} />
      )}
      {!chosen && <Text style={[styles.warning, { color: C.danger }]}>{lang === 'ja' ? '#と6桁の16進数で色を入力してください。' : 'Enter # followed by six hexadecimal digits.'}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { marginTop: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, fontWeight: '600' },
  customButton: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center' },
  palette: { flexDirection: 'row', flexWrap: 'wrap' },
  swatchButton: { width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  warning: { fontSize: 12, marginTop: 4 },
})
