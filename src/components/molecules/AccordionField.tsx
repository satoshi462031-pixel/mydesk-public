import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native'
import { AppColors } from '../../context/AppContext'
import { AppIcon } from '../atoms/AppIcon'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'

interface Props {
  label: string
  /** 閉じているとき見出しの右に出す現在値。選択済みの内容が畳んでも分かる */
  value?: string
  colors: AppColors
  defaultOpen?: boolean
  children: React.ReactNode
  style?: ViewStyle
}

/** 見出しタップで開閉するアコーディオン。選択チップ群を畳んで縦の長さを抑える */
export function AccordionField({ label, value, colors: C, defaultOpen = false, children, style }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <View style={style}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.label, { color: C.textSub }]}>{label}</Text>
        {!open && value ? (
          <Text style={[styles.value, { color: C.textMuted }]} numberOfLines={1}>{value}</Text>
        ) : null}
        <AppIcon name={open ? ICONS.chevronUp : ICONS.chevronDown} size={18} color={C.textMuted} />
      </TouchableOpacity>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { minHeight: UI_METRICS.touchMinSize, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  value: { fontSize: 12, flex: 1, textAlign: 'right' },
  body: { marginBottom: 4 },
})
