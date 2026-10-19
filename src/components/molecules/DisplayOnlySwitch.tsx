import { StyleSheet, Text, View } from 'react-native'
import { AppColors } from '../../context/AppContext'
import { AppIcon } from '../atoms/AppIcon'
import { ContrastToggle } from '../atoms/ContrastToggle'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'

interface Props {
  value: boolean
  onChange: (v: boolean) => void
  colors: AppColors
  lang: 'ja' | 'en'
}

/**
 * 「飾り」トグル。ガジェット追加画面・編集画面で共用する。
 * ON にすると configuration 上は通電も配線もしない扱いになり、
 * 配線図にはノードだけが置かれて線が1本も引かれない。
 */
export function DisplayOnlySwitch({ value, onChange, colors, lang }: Props) {
  const ja = lang === 'ja'
  return (
    <View style={[styles.row, { backgroundColor: colors.input, borderColor: value ? colors.accentIcon : colors.inputBorder }]}>
      <AppIcon
        name={value ? ICONS.decor : 'power-plug-outline'}
        size={22}
        color={value ? colors.accentIcon : colors.textMuted}
      />
      <View style={styles.texts}>
        <Text style={[styles.title, { color: colors.text }]}>
          {ja ? '飾り（使っていない）' : 'Decoration (not in use)'}
        </Text>
        <Text style={[styles.sub, { color: colors.textMuted }]}>
          {value
            ? (ja ? '配線図には出ますが、配線は引かれません' : 'Shown in the wiring map, but no cables')
            : (ja ? '使用中のガジェットとして配線されます' : 'Wired as a gadget in use')}
        </Text>
      </View>
      <ContrastToggle
        value={value}
        onValueChange={onChange}
        colors={colors}
        accessibilityLabel={lang === 'ja' ? '配線なし表示' : 'Display without wiring'}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: UI_METRICS.chipRadius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 16,
  },
  texts: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  sub:   { fontSize: 12, marginTop: 2 },
})
