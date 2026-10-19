import { GestureResponderEvent, Insets, StyleProp, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native'
import { AppIcon } from './AppIcon'
import { MCIconName } from '../../constants/icons'
import { iconOpticalTransform } from '../../utils/iconOptics'
import type { CoachTargetRef } from '../../hooks/useCoachMarks'

// ヘッダー以外の円ボタンで使う、器に対する字面の比。
const ICON_RATIO = 0.56

interface Props {
  name: MCIconName
  color: string
  /** 円の直径 */
  diameter: number
  /** 字面。省略時は直径から比で決める */
  size?: number
  /** 円の地。省略すると透明（写真の上に白いアイコンだけを置く場合など） */
  background?: string
  borderColor?: string
  /** 省略時は hairline。写真の上で輪郭を立てたいときだけ太くする */
  borderWidth?: number
  onPress?: (event: GestureResponderEvent) => void
  disabled?: boolean
  hitSlop?: number | Insets
  /** 置き場所（absolute での位置決めなど）だけを外から渡す。大きさと形は中で決める */
  style?: StyleProp<ViewStyle>
  // 省略可にはしない。読み上げの文言を持たない呼び出し元にも、
  // 「持っていない」と書かせる（undefined を明示させる）
  accessibilityLabel: string | undefined
  accessibilityHint?: string
  testID?: string
  /** 「？」の吹き出しで指すときの登録先 */
  buttonRef?: CoachTargetRef
}

/**
 * 円のアイコンボタン。ヘッダーの戻る（HeaderIconButton）と同じ作りを、ヘッダーの外にも配る。
 *
 * 字形の輪郭は em の中央に無いので、flex の中央寄せだけでは円の中心から外れて見える
 * （片寄った図案の字形がある）。ずれの量は iconOptics が持つ。
 *
 * ヘッダーには HeaderIconButton を使う。見える円36ptと押下領域44ptを別に管理する
 * 役目があり、ヘッダーの寸法はそちらに揃える（npm run audit:header-buttons）。
 */
export function IconCircleButton({
  name,
  color,
  diameter,
  size = Math.round(diameter * ICON_RATIO),
  background,
  borderColor,
  borderWidth = StyleSheet.hairlineWidth,
  onPress,
  disabled,
  hitSlop,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
  buttonRef,
}: Props) {
  return (
    <TouchableOpacity
      ref={buttonRef}
      style={[
        {
          width: diameter,
          height: diameter,
          borderRadius: diameter / 2,
          alignItems: 'center',
          justifyContent: 'center',
          ...(background ? { backgroundColor: background } : null),
          ...(borderColor ? { borderWidth, borderColor } : null),
        },
        style,
      ]}
      onPress={onPress}
      disabled={disabled ?? !onPress}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={disabled ? { disabled: true } : undefined}
      testID={testID}
    >
      {/* width / height / lineHeight を数値で固定する。アイコンの実体は <Text> で、
          iOS で高さを決めるのはフォントのメトリクスなので、書かないと再レンダリングの
          前後で高さが変わり、中央寄せの結果としてアイコンが下へずれる */}
      <AppIcon
        name={name}
        size={size}
        color={color}
        style={{
          width: size,
          height: size,
          lineHeight: size,
          textAlign: 'center',
          includeFontPadding: false,
          padding: 0,
          margin: 0,
          transform: iconOpticalTransform(name, size),
        }}
      />
    </TouchableOpacity>
  )
}
