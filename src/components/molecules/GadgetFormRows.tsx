// ガジェットのフォームの行。詳細（GadgetDetailScreen）と、その部品（寸法・PCスペック）が使う。
// 以前は同じ実装を2画面に書いていて、片方だけ直した行（読み上げ・色の渡し方）が食い違っていた。
import { StyleSheet, Text, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { ContrastToggle } from '../atoms/ContrastToggle'
import { NumberStepper } from '../atoms/NumberStepper'
import { MCIconName } from '../../constants/icons'
import { AppColors } from '../../context/AppContext'

/** 口数の増減行。アイコン＋ラベル＋−/値/＋ */
export function PortStepperRow({
  icon, label, value, onChange, min = 0, max = 10, colors, color,
}: {
  icon: MCIconName
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  colors: AppColors
  /** ポート種別のアイコン色。 */
  color?: string
}) {
  return (
    <View style={[styles.stepperRow, { borderBottomColor: colors.separator }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
        <AppIcon name={icon} size={20} color={color ?? colors.textSub} />
        <Text style={[styles.stepperLabel, { color: colors.text, flex: 0 }]}>{label}</Text>
      </View>
      <NumberStepper value={value} onChange={onChange} min={min} max={max} accessibilityLabel={label} />
    </View>
  )
}

/** 増減行と同じ高さのスイッチ行 */
export function ToggleRow({
  label, value, onChange, colors,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  colors: AppColors
}) {
  return (
    <View style={[styles.stepperRow, { borderBottomColor: colors.separator }]}>
      <Text style={[styles.stepperLabel, { color: colors.text }]}>{label}</Text>
      <ContrastToggle value={value} onValueChange={onChange} colors={colors} accessibilityLabel={label} />
    </View>
  )
}

const styles = StyleSheet.create({
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepperLabel: { flex: 1, fontSize: 15 },
})
