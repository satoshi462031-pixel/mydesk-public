import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { MCIconName } from '../../constants/icons'

type Props = {
  visible: boolean
  message: string
  backgroundColor: string
  textColor: string
  icon?: MCIconName
  bottomOffset?: number
  /** 画面の下端ではなく、操作ボタンの間などに置くときの位置（left / right / bottom の上書き） */
  style?: StyleProp<ViewStyle>
  /** 狭い場所に置くとき用に、文字と余白を詰める */
  compact?: boolean
}

// 完了を伝えるだけの通知。Alert と違い操作を止めないので、
// ユーザーの確認が要らない「〜しました」はこちらで出す
export function Toast({ visible, message, backgroundColor, textColor, icon = 'check-circle-outline', bottomOffset = 90, style, compact }: Props) {
  if (!visible) return null

  return (
    <View
      style={[styles.bar, compact && styles.barCompact, { bottom: bottomOffset, backgroundColor }, style]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      <AppIcon name={icon} size={compact ? 16 : 18} color={textColor} />
      {/* 3行まで。配線図の断り（42文字）が2行では収まらず、後ろの「線をタップして直せます」が切れていた */}
      <Text style={[styles.text, compact && styles.textCompact, { color: textColor }]} numberOfLines={3}>{message}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  // 3行になっても角が丸すぎないよう、角丸は 1 行の高さ（48）の半分のまま
  barCompact: { minHeight: 48, gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  text: { flex: 1, fontSize: 14, fontWeight: '600' },
  textCompact: { fontSize: 12, lineHeight: 16 },
})
