import { Alert } from '../../utils/alert'
import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CATEGORY_COLORS, categoryIconColor, ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { useCustomCategories } from '../../hooks/useCustomCategories'
import { CustomCategory } from '../../types'
import { CUSTOM_CATEGORY_NAME_MAX } from '../../utils/customCategory'
import { AppIcon } from '../atoms/AppIcon'
import { Button } from '../atoms/Button'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { TextField } from '../atoms/TextField'
import { IconSearchGrid } from './IconSearchGrid'
import { CUSTOM_CATEGORY_COLOR_PRESETS } from '../../constants/colors'
import { normalizeCustomCategoryColor } from '../../utils/customCategory'

const DEFAULT_ICON = 'shape-outline'

interface Props {
  visible: boolean
  /** 渡すと編集、無ければ新しく作る */
  editing?: CustomCategory | null
  onClose: () => void
  onSaved: (category: CustomCategory) => void
}

/**
 * 自作ジャンルを作る・直す画面。名前と絵を決める。
 * 絵は同梱フォントの全件から選べる（IconSearchGrid）
 */
export function CustomCategoryEditor({ visible, editing, onClose, onSaved }: Props) {
  const { colors: C, lang, isDark, reduceMotion } = useApp()
  const insets = useSafeAreaInsets()
  const { categories, add, update, remove, usageCount } = useCustomCategories()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(DEFAULT_ICON)
  const [saving, setSaving] = useState(false)
  const operationInFlightRef = useRef(false)
  const [colorInput, setColorInput] = useState(CATEGORY_COLORS.Other)
  const [customColorOpen, setCustomColorOpen] = useState(false)

  // 開くたびに入力を作り直す。閉じたまま前回の入力が残っていると、別のジャンルを
  // 作ろうとして前の名前がそのまま入っている
  useEffect(() => {
    if (!visible) return
    setName(editing?.name ?? '')
    setIcon(editing?.icon ?? DEFAULT_ICON)
    setColorInput(editing?.color ?? CATEGORY_COLORS.Other)
    setCustomColorOpen(!!editing?.color && !CUSTOM_CATEGORY_COLOR_PRESETS.some((preset) => preset.color === editing.color))
  }, [visible, editing])

  const trimmedName = name.trim()
  const duplicate = categories.some((category) => category.name === trimmedName && category.id !== editing?.id)
  const chosenColor = normalizeCustomCategoryColor(colorInput)
  const canSave = trimmedName.length > 0 && !duplicate && !!chosenColor && !saving
  const color = chosenColor ?? CATEGORY_COLORS.Other
  const iconColor = categoryIconColor('Other', isDark, undefined, color)

  const handleSave = async () => {
    if (!canSave || operationInFlightRef.current) return
    operationInFlightRef.current = true
    setSaving(true)
    try {
      const saved = editing ? await update(editing.id, { name: trimmedName, icon, color }) : await add(trimmedName, icon, color)
      onSaved(saved)
    } catch {
      Alert.alert(
        lang === 'ja' ? '保存できませんでした' : 'Could not save',
        lang === 'ja' ? 'もう一度お試しください。' : 'Please try again.',
      )
    } finally {
      operationInFlightRef.current = false
      setSaving(false)
    }
  }

  const handleDelete = () => {
    if (!editing || operationInFlightRef.current) return
    const used = usageCount(editing.id)
    if (used > 0) {
      Alert.alert(
        lang === 'ja' ? '削除できません' : 'Cannot delete',
        lang === 'ja'
          ? `このジャンルの機材が${used}台あります。機材のジャンルを変えるか、機材を削除してから消してください。`
          : `${used} ${used === 1 ? 'item uses' : 'items use'} this category. Change their category or delete them first.`,
      )
      return
    }
    operationInFlightRef.current = true
    const cancelDelete = () => { operationInFlightRef.current = false }
    Alert.alert(
      lang === 'ja' ? `「${editing.name}」を削除しますか？` : `Delete "${editing.name}"?`,
      undefined,
      [
        { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel', onPress: cancelDelete },
        {
          text: lang === 'ja' ? '削除' : 'Delete',
          style: 'destructive',
          onPress: () => {
            setSaving(true)
            void remove(editing.id).then((removed) => {
              if (removed) onClose()
              else Alert.alert(lang === 'ja' ? '削除できません' : 'Cannot delete')
            }).catch(() => {
              Alert.alert(
                lang === 'ja' ? '削除できませんでした' : 'Could not delete',
                lang === 'ja' ? 'もう一度お試しください。' : 'Please try again.',
              )
            }).finally(() => {
              operationInFlightRef.current = false
              setSaving(false)
            })
          },
        },
      ],
      { onDismiss: cancelDelete },
    )
  }

  const handleClose = () => {
    if (!operationInFlightRef.current) onClose()
  }

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={handleClose}>
      <KeyboardAvoidingView style={[styles.container, { backgroundColor: C.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { backgroundColor: C.card, paddingTop: insets.top + 14, borderBottomColor: C.border }]}>
          <Text style={[styles.title, { color: C.text }]}>
            {editing
              ? (lang === 'ja' ? 'ジャンルを編集' : 'Edit category')
              : (lang === 'ja' ? 'ジャンルを作る' : 'New category')}
          </Text>
          <TouchableOpacity onPress={handleClose} disabled={saving} hitSlop={8} accessibilityRole="button" accessibilityLabel={lang === 'ja' ? '閉じる' : 'Close'}>
            <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <IconSearchGrid
          selected={icon}
          onSelect={setIcon}
          tint={iconColor}
          includeDeskIcons
          header={
            <>
              <View style={styles.nameRow}>
                <View style={[styles.preview, { backgroundColor: color + '22' }]}>
                  <CategoryIcon category="Other" customIcon={icon} size={28} color={iconColor} />
                </View>
                <TextField
                  containerStyle={styles.nameInput}
                  value={name}
                  onChangeText={setName}
                  maxLength={CUSTOM_CATEGORY_NAME_MAX}
                  placeholder={lang === 'ja' ? 'ジャンル名（例：フィギュア）' : 'Category name (e.g. Figures)'}
                  returnKeyType="done"
                  accessibilityLabel={lang === 'ja' ? 'ジャンル名' : 'Category name'}
                />
              </View>
              {duplicate && (
                <Text style={[styles.warning, { color: C.danger }]}>
                  {lang === 'ja' ? '同じ名前のジャンルがあります' : 'A category with this name already exists'}
                </Text>
              )}
              <View style={styles.colorHeading}>
                <Text style={[styles.colorTitle, { color: C.textSub }]}>{lang === 'ja' ? '色' : 'Color'}</Text>
                <TouchableOpacity onPress={() => setCustomColorOpen((open) => !open)} accessibilityRole="button">
                  <Text style={[styles.colorAction, { color: C.accentText }]}>{lang === 'ja' ? 'カスタム' : 'Custom'}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.palette}>
                {CUSTOM_CATEGORY_COLOR_PRESETS.map((preset) => (
                  <TouchableOpacity key={preset.color} style={styles.swatchButton}
                    onPress={() => setColorInput(preset.color)} accessibilityRole="radio"
                    accessibilityState={{ selected: color === preset.color }}
                    accessibilityLabel={lang === 'ja' ? preset.ja : preset.en}>
                    <View style={[styles.swatch, { backgroundColor: preset.color, borderColor: color === preset.color ? C.text : C.border, borderWidth: color === preset.color ? 3 : 1 }]} />
                  </TouchableOpacity>
                ))}
              </View>
              {customColorOpen && (
                <TextField value={colorInput} onChangeText={(value) => setColorInput(value.startsWith('#') ? value : `#${value}`)}
                  maxLength={7} autoCapitalize="characters" autoCorrect={false} placeholder="#RRGGBB"
                  accessibilityLabel={lang === 'ja' ? 'カスタム色（16進数）' : 'Custom color (hex)'} />
              )}
              {!chosenColor && <Text style={[styles.warning, { color: C.danger }]}>{lang === 'ja' ? '#と6桁の英数字で色を入力してください。' : 'Enter # followed by six hexadecimal digits.'}</Text>}
            </>
          }
        />

        <View style={[styles.footer, { backgroundColor: C.card, borderTopColor: C.border, paddingBottom: Math.max(insets.bottom, 12) }]}>
          {editing && (
            <TouchableOpacity onPress={handleDelete} disabled={saving} style={styles.deleteBtn} accessibilityRole="button" activeOpacity={0.7}>
              <Text style={[styles.deleteText, { color: C.danger }]}>{lang === 'ja' ? '削除' : 'Delete'}</Text>
            </TouchableOpacity>
          )}
          <Button
            title={editing ? (lang === 'ja' ? '保存' : 'Save') : (lang === 'ja' ? '作成' : 'Create')}
            onPress={() => { void handleSave() }}
            disabled={!canSave}
            loading={saving}
            style={styles.saveBtn}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '700' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  preview: { width: 52, height: 52, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  nameInput: {
    flex: 1,
  },
  warning: { fontSize: 12 },
  colorHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  colorTitle: { fontSize: 13, fontWeight: '600' },
  colorAction: { fontSize: 13, fontWeight: '600', paddingVertical: 4 },
  palette: { flexDirection: 'row', flexWrap: 'wrap' },
  swatchButton: { width: '12.5%', height: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 28, height: 28, borderRadius: 14 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  deleteBtn: { paddingVertical: 12, paddingHorizontal: 8 },
  deleteText: { fontSize: 15, fontWeight: '600' },
  saveBtn: { flex: 1 },
})
