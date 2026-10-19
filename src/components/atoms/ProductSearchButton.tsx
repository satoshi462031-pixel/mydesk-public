import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { PRODUCT_BROWSE_ENABLED } from '../../constants/features'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { AppIcon } from './AppIcon'

export function ProductSearchButton({ onPress }: { onPress: () => void }) {
  const { colors: C, lang } = useApp()
  if (!PRODUCT_BROWSE_ENABLED) return null

  return (
    <TouchableOpacity
      style={[styles.button, { borderLeftColor: C.inputBorder }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={lang === 'en' ? 'Search products' : '商品を探す'}
      accessibilityHint={lang === 'en' ? 'Opens product search for this field' : 'この入力欄の商品を探します'}
    >
      <AppIcon name={ICONS.search} size={18} color={C.accentIcon} />
      <Text style={[styles.label, { color: C.accentText }]}>{lang === 'en' ? 'Find' : '探す'}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  // TextField の右内余白を打ち消し、入力欄の枠の内側に揃える。
  button: {
    alignSelf: 'stretch',
    marginRight: -12,
    minWidth: UI_METRICS.touchMinSize,
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
})
