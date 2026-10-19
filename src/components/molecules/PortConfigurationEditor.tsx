import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { PortFormField, PortState, portFormFieldLabel } from '../../constants/portFormConfig'
import { ICONS } from '../../constants/icons'
// 絵は配線図の凡例と同じ表を読む。ここに別の表を持っていたときは
// HDMI・LAN・電源・電池が画面によって違う絵になっていた
import { PORT_ICONS, portIconColor } from '../../constants/portTypes'
import { AppColors, useApp } from '../../context/AppContext'
import { AppIcon } from '../atoms/AppIcon'
import { NumberStepper } from '../atoms/NumberStepper'

type Props = {
  fields: PortFormField[]
  state: PortState
  onChange: (key: string, value: number | boolean) => void
  colors: AppColors
  lang: 'ja' | 'en'
  title: string
}

function isConfigured(field: PortFormField, state: PortState): boolean {
  const value = state[field.key]
  return field.kind === 'stepper' ? typeof value === 'number' && value > 0 : value === true
}

export function hasConfiguredVisiblePorts(state: PortState, fields: PortFormField[]): boolean {
  return fields.some((field) => !field.hidden && !field.locked && isConfigured(field, state))
}

export function PortConfigurationEditor({ fields, state, onChange, colors, lang, title }: Props) {
  const { isDark } = useApp()
  const latestState = useRef(state)
  latestState.current = state
  const [mainFields, advancedFields] = useMemo(() => {
    const shown = fields.filter((field) => !field.hidden && !field.locked)
    const advanced = shown.filter((field) => field.advanced)
    return [shown.filter((field) => !field.advanced), advanced]
  }, [fields])

  // 設定済みの項目が隠れないよう、値が入っていれば最初から開く
  const hasConfiguredAdvanced = advancedFields.some((field) => isConfigured(field, state))
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const advancedFieldKey = advancedFields.map((field) => field.key).join('|')
  useEffect(() => setManualOpen(null), [advancedFieldKey])
  const open = manualOpen ?? hasConfiguredAdvanced

  if (mainFields.length === 0 && advancedFields.length === 0) return null

  const renderField = (field: PortFormField) => {
    const label = portFormFieldLabel(field, lang)
    const color = portIconColor(field.portType, isDark)
    const icon = PORT_ICONS[field.portType] ?? 'connection'
    const value = state[field.key] ?? (field.kind === 'stepper' ? 0 : false)
    const head = (
      <View style={styles.rowHead}>
        <AppIcon name={icon} size={20} color={color} />
        <Text style={[styles.rowLabel, { color: colors.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {label}
        </Text>
      </View>
    )

    if (field.kind === 'toggle') {
      const active = value === true
      return (
        <TouchableOpacity
          key={field.key}
          style={[styles.row, { borderBottomColor: colors.separator }]}
          onPress={() => {
            const next = latestState.current[field.key] !== true
            latestState.current = { ...latestState.current, [field.key]: next }
            onChange(field.key, next)
          }}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: active }}
        >
          {head}
          <AppIcon name={active ? 'check-circle' : 'circle-outline'} size={24} color={active ? color : colors.textMuted} />
        </TouchableOpacity>
      )
    }

    const count = value as number
    return (
      <View key={field.key} style={[styles.row, { borderBottomColor: colors.separator }]}>
        {head}
        <NumberStepper
          value={count}
          onChange={(next) => onChange(field.key, next)}
          max={field.max ?? 6}
          accessibilityLabel={label}
        />
      </View>
    )
  }

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: colors.textSub }]}>{title}</Text>
      {mainFields.map(renderField)}
      {advancedFields.length > 0 && (
        <>
          <TouchableOpacity
            style={styles.moreHeader}
            onPress={() => setManualOpen(current => !(current ?? hasConfiguredAdvanced))}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
          >
            <Text style={[styles.moreLabel, { color: colors.textSub }]}>
              {lang === 'en' ? 'Other ports' : 'その他のポート'}
              <Text style={{ color: colors.textMuted }}>{` (${advancedFields.length})`}</Text>
            </Text>
            <AppIcon name={open ? ICONS.chevronUp : ICONS.chevronDown} size={18} color={colors.textMuted} />
          </TouchableOpacity>
          {open && advancedFields.map(renderField)}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: 16 },
  title: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  moreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 12 },
  moreLabel: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowHead: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  rowLabel: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600' },
})
