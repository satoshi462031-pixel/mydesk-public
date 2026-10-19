import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { hapticLight } from '../../utils/haptics'
import { UI_METRICS } from '../../constants/ui'
import { contrastRatio } from '../../constants/colors'

type Props = {
  visible: boolean
  message: string
  lang: 'ja' | 'en'
  backgroundColor: string
  textColor: string
  accentColor: string
  onUndo: () => void
  undoing?: boolean
  disabled?: boolean
  bottomOffset?: number
}

export function UndoSnackbar({
  visible,
  message,
  lang,
  backgroundColor,
  textColor,
  accentColor,
  onUndo,
  undoing = false,
  disabled = false,
  bottomOffset = 84,
}: Props) {
  if (!visible) return null
  // スナックバーは本文と明暗が逆なので、通常のテーマ色が読めない場合は文字色に揃える。
  const actionColor = contrastRatio(accentColor, backgroundColor) >= 4.5 ? accentColor : textColor

  return (
    <View
      style={[styles.bar, { bottom: bottomOffset, backgroundColor }]}
      accessibilityLiveRegion="polite"
    >
      {/* 文は「『名前』を外しました」の形で、長いのは名前のほう。末尾で切ると何をしたのかが
          消えるので、真ん中（名前の途中）を省く */}
      <Text style={[styles.message, { color: textColor }]} numberOfLines={1} ellipsizeMode="middle">{message}</Text>
      <TouchableOpacity
        onPress={() => { hapticLight(); onUndo() }}
        disabled={undoing || disabled}
        accessibilityState={{ disabled: undoing || disabled, busy: undoing }}
        style={disabled && !undoing ? { opacity: 0.45 } : undefined}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={lang === 'ja' ? '操作を元に戻す' : 'Undo action'}
      >
        {undoing
          ? <ActivityIndicator size="small" color={actionColor} />
          : <Text style={[styles.action, { color: actionColor }]}>{lang === 'ja' ? '元に戻す' : 'Undo'}</Text>}
      </TouchableOpacity>
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
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: UI_METRICS.panelRadius,
  },
  message: { flex: 1, fontSize: 13, fontWeight: '500' },
  action: { fontSize: 14, fontWeight: '700' },
})
