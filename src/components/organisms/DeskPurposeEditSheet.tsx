import { useRef, useState } from 'react'
import { Keyboard, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { contrastRatio } from '../../constants/colors'
import { isIconName } from '../../constants/customCategoryIcons'
import { ICONS, MCIconName } from '../../constants/icons'
import { PURPOSE_NAME_MAX_LENGTH } from '../../constants/textLimits'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { useKeyboardReveal } from '../../hooks/useKeyboardReveal'
import { OTHER_PURPOSE_ICONS, PURPOSE_DEFS, purposeIconColor, purposeTintColor } from '../../screens/PurposeSelectionScreen'
import { PlanPurpose } from '../../types'
import { hapticSelection } from '../../utils/haptics'
import { truncateChars } from '../../utils/truncateText'
import { AppIcon } from '../atoms/AppIcon'
import { HeaderIconButton } from '../atoms/HeaderIconButton'
import { TextField } from '../atoms/TextField'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { IconPickerModal } from './IconPickerModal'

interface Props {
  visible: boolean
  onClose: () => void
  selected: Set<PlanPurpose>
  onChange: (purposes: Set<PlanPurpose>) => void
  otherLabel: string
  onChangeOtherLabel: (label: string) => void
  otherIcon: MCIconName
  onChangeOtherIcon: (icon: MCIconName) => void
  otherColor?: string
}

export function DeskPurposeEditSheet({
  visible, onClose, selected, onChange, otherLabel, onChangeOtherLabel, otherIcon, onChangeOtherIcon, otherColor,
}: Props) {
  const { colors: C, lang, isDark, t } = useApp()
  const scrollRef = useRef<ScrollView>(null)
  const revealInput = useKeyboardReveal(scrollRef)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const disabled = (key: PlanPurpose) => selected.has(key) && selected.size <= 1
  const toggle = (key: PlanPurpose) => {
    if (disabled(key)) return
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    hapticSelection()
    onChange(next)
  }
  const close = () => {
    Keyboard.dismiss()
    setIconPickerOpen(false)
    onClose()
  }
  const otherSelected = selected.has('other')
  const otherIconColor = purposeIconColor('other', isDark, otherColor)
  const otherTint = purposeTintColor('other', isDark, otherColor)
  const purposes = PURPOSE_DEFS.filter(purpose => purpose.key !== 'other')

  return (
    <BottomSheetModal visible={visible} onDismiss={close} sheetStyle={styles.sheet} avoidKeyboard>
      <View style={[styles.header, { borderBottomColor: C.border }]}>
        <Text style={[styles.title, { color: C.text }]}>{lang === 'en' ? 'Desk purposes' : 'デスクの用途'}</Text>
        <HeaderIconButton name={ICONS.check} color={C.accentIcon} onPress={close}
          accessibilityLabel={lang === 'en' ? 'Finish choosing uses' : 'デスクの用途の選択を完了'} />
      </View>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
        <Text style={[styles.hint, { color: C.textMuted }]}>
          {lang === 'en' ? 'Select all that apply. Save your changes with ✓ on the desk.' : '当てはまるものをすべて選べます。変更はデスク画面の✓で保存します。'}
        </Text>
        {[0, 2, 4].map(start => (
          <View key={start} style={styles.row}>
            {purposes.slice(start, start + 2).map(purpose => {
              const checked = selected.has(purpose.key)
              const pc = purposeIconColor(purpose.key, isDark)
              return (
                <TouchableOpacity key={purpose.key} onPress={() => toggle(purpose.key)}
                  disabled={disabled(purpose.key)} activeOpacity={0.82}
                  style={[styles.tile, { backgroundColor: C.card, borderColor: checked ? pc : C.border }, disabled(purpose.key) && !checked && styles.disabled]}
                  accessibilityRole="checkbox" accessibilityLabel={t(`purpose.${purpose.key}`)}
                  accessibilityState={{ checked, disabled: disabled(purpose.key) }}>
                  {checked && <View style={[styles.check, { backgroundColor: pc }]}>
                    <AppIcon name={ICONS.check} size={12} color={contrastRatio('#FFFFFF', pc) >= 4.5 ? '#FFFFFF' : '#000000'} centered />
                  </View>}
                  <View style={styles.tileHead}>
                    <View style={[styles.icon, { backgroundColor: purposeTintColor(purpose.key, isDark) + '22' }]}>
                      <AppIcon name={purpose.icon} size={22} color={pc} centered />
                    </View>
                    <Text style={[styles.label, styles.tileLabel, { color: C.text }]} numberOfLines={lang === 'ja' ? 1 : 2}
                      adjustsFontSizeToFit minimumFontScale={0.8}>{t(`purpose.${purpose.key}`)}</Text>
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        ))}
        <View style={[styles.customTile, { backgroundColor: C.card, borderColor: otherSelected ? otherIconColor : C.border }]}>
          <TouchableOpacity onPress={() => toggle('other')} disabled={disabled('other')} activeOpacity={0.82}
            style={[styles.customHead, disabled('other') && !otherSelected && styles.disabled]}
            accessibilityRole="checkbox" accessibilityLabel={t('purpose.other')}
            accessibilityState={{ checked: otherSelected, disabled: disabled('other') }}>
            <View style={[styles.icon, { backgroundColor: otherTint + '22' }]}>
              <AppIcon name={otherSelected ? otherIcon : OTHER_PURPOSE_ICONS[0]} size={22} color={otherIconColor} centered />
            </View>
            <View style={styles.customText}>
              <Text style={[styles.label, { color: C.text }]}>{t('purpose.other')}</Text>
            </View>
            {otherSelected && <AppIcon name={ICONS.check} size={20} color={otherIconColor} />}
          </TouchableOpacity>
          {otherSelected && <View style={styles.customEditor}>
            <TextField appearance="underline" accentColor={otherIconColor} value={otherLabel}
              onChangeText={value => onChangeOtherLabel(truncateChars(value, PURPOSE_NAME_MAX_LENGTH))}
              maxLength={PURPOSE_NAME_MAX_LENGTH} returnKeyType="done"
              onFocus={() => requestAnimationFrame(revealInput)}
              placeholder={lang === 'en' ? 'Name this purpose (e.g. Crafting)' : '用途に名前を付ける（例：工作）'}
              accessibilityLabel={lang === 'en' ? 'Name for this purpose' : 'この用途の名前'} />
            <View style={styles.iconChoices}>
              {(OTHER_PURPOSE_ICONS.includes(otherIcon) ? OTHER_PURPOSE_ICONS : [otherIcon, ...OTHER_PURPOSE_ICONS]).map(icon => (
                <TouchableOpacity key={icon} style={[styles.iconChoice, { borderColor: icon === otherIcon ? otherIconColor : C.border,
                  backgroundColor: icon === otherIcon ? otherTint + '22' : 'transparent' }]}
                  onPress={() => { if (icon !== otherIcon) { hapticSelection(); onChangeOtherIcon(icon) } }} activeOpacity={0.7}
                  accessibilityRole="radio" accessibilityState={{ selected: icon === otherIcon }}
                  accessibilityLabel={lang === 'en' ? `Icon ${icon}` : `アイコン ${icon}`}>
                  <AppIcon name={icon} size={19} color={icon === otherIcon ? otherIconColor : C.textMuted} centered />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={[styles.more, { borderColor: C.border }]}
                onPress={() => { Keyboard.dismiss(); setIconPickerOpen(true) }} activeOpacity={0.7}
                accessibilityRole="button" accessibilityLabel={lang === 'en' ? 'More icons' : 'ほかのアイコンから選ぶ'}>
                <AppIcon name="view-grid-plus-outline" size={17} color={C.accentText} />
                <Text style={[styles.moreText, { color: C.accentText }]}>{lang === 'en' ? 'More' : 'もっと見る'}</Text>
              </TouchableOpacity>
            </View>
          </View>}
        </View>
      </ScrollView>
      <IconPickerModal visible={visible && iconPickerOpen} title={lang === 'en' ? 'Choose an icon' : 'アイコンを選ぶ'}
        selected={otherIcon} tint={otherIconColor} onClose={() => setIconPickerOpen(false)}
        onSelect={icon => { if (isIconName(icon) && icon !== otherIcon) { hapticSelection(); onChangeOtherIcon(icon) } }} />
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: { maxHeight: '86%', paddingHorizontal: 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: '700' },
  content: { padding: UI_METRICS.screenGutter, gap: 12 },
  hint: { fontSize: 12, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, padding: 12, borderWidth: 2, borderRadius: UI_METRICS.cardRadius },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 18 },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, fontWeight: '700', lineHeight: 18 },
  tileLabel: { flex: 1 },
  check: { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.35 },
  customTile: { borderWidth: 2, borderRadius: UI_METRICS.cardRadius, padding: 12 },
  customHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: UI_METRICS.touchMinSize },
  customText: { flex: 1 },
  customEditor: { marginTop: 8, gap: 10 },
  iconChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconChoice: { width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize, borderRadius: UI_METRICS.controlRadius, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  more: { minHeight: UI_METRICS.touchMinSize, borderRadius: UI_METRICS.controlRadius, borderWidth: 1.5, borderStyle: 'dashed', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 4 },
  moreText: { fontSize: 12, fontWeight: '700' },
})
