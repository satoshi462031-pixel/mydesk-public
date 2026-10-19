import { useState } from 'react'
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { ICONS, MCIconName } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import type { CoachTargetRef } from '../../hooks/useCoachMarks'

// デスク画面（自分の・他人の）の機材タブで、下のバーのすぐ上に浮かべる並び順と追加。
// 一覧の先頭に置いていた頃は、機材の多いデスクだとスクロールで戻らないと押せなかった。
// 下のバーの子として置き、バーの上端に付けて浮かせる（バーの高さが変わっても追従する）。
// 「このデスクを参考に作る」はここに出さない。一覧を見終えた人の次の一手なので末尾に残す
export function GadgetListFloatingControls({ sortLabel, sortExpanded, onSort, sortRef, onAdd, addRef }: {
  sortLabel: string
  sortExpanded: boolean
  onSort: () => void
  sortRef?: CoachTargetRef
  /** 自分のデスクだけ。他人のデスクでは出さない */
  onAdd?: () => void
  addRef?: CoachTargetRef
}) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  const [rowHeight, setRowHeight] = useState(40)
  return (
    <View
      style={[styles.row, { top: -rowHeight - 12 }]}
      onLayout={event => {
        const height = Math.ceil(event.nativeEvent.layout.height)
        if (height > 0) setRowHeight(height)
      }}
      pointerEvents="box-none"
    >
      <GadgetListChoiceButton
        targetRef={sortRef}
        label={sortLabel}
        expanded={sortExpanded}
        onPress={onSort}
        accessibilityLabel={ja ? '機材の並び順を変更' : 'Change gadget order'}
        accessibilityHint={ja ? 'どの機材を先に表示するか選べます' : 'Opens choices for which gadgets appear first'}
      />
      {onAdd && (
        <TouchableOpacity
          ref={addRef as ((node: View | null) => void) | undefined}
          style={[styles.add, { backgroundColor: C.accent }]}
          onPress={onAdd}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={ja ? '機材を追加' : 'Add Gadget'}
          accessibilityHint={ja ? 'ジャンルを選んでこのデスクに新しい機材を登録します' : 'Choose a category to register a new gadget on this desk'}
        >
          <AppIcon name={ICONS.add} size={20} color={C.onAccent} />
          <Text style={[styles.addLabel, { color: C.onAccent }]}>{ja ? '追加' : 'Add'}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

export function GadgetListChoiceButton({ label, expanded, onPress, icon = 'sort-variant', targetRef, accessibilityLabel, accessibilityHint, style }: {
  label: string
  expanded: boolean
  onPress: () => void
  icon?: MCIconName
  targetRef?: CoachTargetRef
  accessibilityLabel: string
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
}) {
  const { colors: C } = useApp()
  return (
    <TouchableOpacity
      ref={targetRef as ((node: View | null) => void) | undefined}
      style={[styles.sort, { backgroundColor: C.card, borderColor: expanded ? C.accentIcon : C.border }, style]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ expanded }}
    >
      <AppIcon name={icon} size={16} color={expanded ? C.accentIcon : C.textSub} />
      <Text style={[styles.sortLabel, { color: C.text }]} numberOfLines={1}>{label}</Text>
      <AppIcon name={ICONS.chevronUp} size={16} color={C.textMuted} />
    </TouchableOpacity>
  )
}

/** 一覧の末尾に足す余白。浮かせた列の高さ＋上下の間隔ぶん空けないと、最後の行が隠れる */
export const GADGET_LIST_FLOATING_INSET = 60

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: UI_METRICS.screenGutter,
    right: UI_METRICS.screenGutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sort: {
    flexShrink: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: UI_METRICS.pillRadius,
    borderWidth: 1.5,
  },
  sortLabel: { flexShrink: 1, fontSize: 13, fontWeight: '700' },
  add: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 12,
    paddingRight: 16,
    borderRadius: UI_METRICS.pillRadius,
  },
  addLabel: { fontSize: 14, fontWeight: '800' },
})
