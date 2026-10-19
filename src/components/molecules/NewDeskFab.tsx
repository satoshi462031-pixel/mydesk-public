import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import type { CoachTargetRef } from '../../hooks/useCoachMarks'

// 右下の「新しいデスク」。マイデスクとマイページのデスクの両方に置くので、大きさ・文言・
// 上限時の鍵を1か所で持つ（画面ごとに書くと片方だけ変わる）
export function NewDeskFab({ onPress, locked, buttonRef }: {
  onPress: () => void
  /** 無料プランの上限。押すと Pro の案内になるので、押す前から鍵を出す */
  locked: boolean
  buttonRef?: CoachTargetRef
}) {
  const { colors: C, t, lang } = useApp()
  return (
    <TouchableOpacity
      ref={buttonRef as ((node: View | null) => void) | undefined}
      style={[styles.fab, { backgroundColor: C.accent }]}
      onPress={onPress}
      activeOpacity={0.9}
      accessibilityRole="button"
      accessibilityLabel={t('a11y.newDesk')}
    >
      <AppIcon name={locked ? ICONS.lock : ICONS.add} size={locked ? 22 : 28} color={C.onAccent} />
      <Text style={[styles.label, { color: C.onAccent }]}>
        {locked
          ? (lang === 'ja' ? 'Pro で追加' : 'Add with Pro')
          : (lang === 'ja' ? '新しいデスク' : 'New desk')}
      </Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    height: 56,
    borderRadius: UI_METRICS.pillRadius,
    paddingHorizontal: 18,
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '800' },
})
