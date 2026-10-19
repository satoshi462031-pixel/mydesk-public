import { Children, ReactNode } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { AppIcon } from './AppIcon'
import { MCIconName } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { iconOpticalOffset } from '../../utils/iconOptics'
import type { CoachTargetRef } from '../../hooks/useCoachMarks'

// AppStackHeader の中で使う。OS のバーボタン背景を使わず、円とアイコンを同じ座標系で描く。

const SLOT = UI_METRICS.headerSlotSize
const DIAMETER = UI_METRICS.headerActionSize
const GROUP_GAP = 6

interface Props {
  name: MCIconName
  color: string
  onPress: () => void
  accessibilityLabel: string
  // 既定は 22。戻るの「＜」だけは大きめにする慣習があるため受け取れるようにしている
  size?: number
  circular?: boolean
  /** 「？」の吹き出しで指すときの登録先。見えている円を指すので円の側に付ける */
  buttonRef?: CoachTargetRef
}

export function HeaderIconButton({
  name,
  color,
  onPress,
  accessibilityLabel,
  size = 22,
  // ヘッダーのアイコンボタンは左右・画面を問わず同じ丸形にする。
  circular = true,
  buttonRef,
}: Props) {
  const { colors } = useApp()
  // 字形の輪郭は em の中央に無い。ずれの量は iconOptics（TTF から焼いた表）が持つ
  const optical = iconOpticalOffset(name, size)

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.slot}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View ref={buttonRef} style={[styles.surface, circular && { backgroundColor: colors.chip }]}>
        <View style={[
          styles.iconBox,
          {
            width: size,
            height: size,
            transform: [
              { translateX: optical.x },
              { translateY: optical.y },
            ],
          },
        ]}>
          {/* Text の行ボックスを固定し、字形補正は iconBox に一度だけ適用する。 */}
          <AppIcon
            name={name}
            size={size}
            color={color === colors.accent ? colors.accentIcon : color}
            style={[styles.icon, { width: size, height: size, lineHeight: size }]}
          />
        </View>
      </View>
    </TouchableOpacity>
  )
}

// ボタンを複数並べるとき用。幅を中身から決めさせず、スロット数から数値で出す
export function HeaderButtonGroup({ children }: { children: ReactNode }) {
  const count = Children.toArray(children).length
  return (
    <View style={[styles.group, { width: SLOT * count + GROUP_GAP * Math.max(0, count - 1) }]}>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  slot:  { width: SLOT, height: SLOT, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  surface: { width: DIAMETER, height: DIAMETER, borderRadius: DIAMETER / 2, alignItems: 'center', justifyContent: 'center' },
  iconBox: { alignItems: 'center', justifyContent: 'center' },
  icon: { padding: 0, margin: 0, textAlign: 'center', includeFontPadding: false },
  group: { height: SLOT, flexDirection: 'row', alignItems: 'center', gap: GROUP_GAP },
})
