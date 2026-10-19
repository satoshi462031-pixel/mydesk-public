import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { ReactNode, useState } from 'react'
import { Platform, Pressable, StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { TextField } from '../atoms/TextField'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { useToday } from '../../hooks/useToday'
import { datePlaceholder, formatDate, formatDateInput, parseDateInput, parseLocalDate } from '../../utils/dateFormat'
import { BottomSheetModal } from './BottomSheetModal'

interface Props {
  /** 画面の表示形（formatDate の並び）。空は未入力 */
  value: string
  onChange: (value: string) => void
  /** 読み上げとダイヤルの見出しに使う短い名前 */
  label: string
  size?: 'default' | 'compact'
  invalid?: boolean
  /** 空に戻せるか。必須の日付では false にする */
  clearable?: boolean
  minimumDate?: Date
  maximumDate?: Date
  leading?: ReactNode
  /** 幅・余白・配置だけに使う（TextField と同じ） */
  containerStyle?: StyleProp<ViewStyle>
  /** ネイティブの幅の狭い欄では外す。Webでは選択の入口として残す */
  showCalendarIcon?: boolean
}

function clampDate(date: Date, min?: Date, max?: Date): Date {
  if (min && date < min) return min
  if (max && date > max) return max
  return date
}

/**
 * 日付の欄。ネイティブは日付ピッカー、Webは手入力とブラウザの日付選択を使う。
 *
 * 数字キーボードで打たせていた頃は、区切りの位置・月日の順（英語は MM/DD/YYYY）を
 * 覚えて打つ必要があり、実在しない日付もエラーになるまで分からなかった。
 * 値は今までと同じ表示形の文字列で受け渡すので、保存側（parseDateInput）は変えない。
 */
export function DateField({
  value, onChange, label, size = 'default', invalid = false, clearable = true,
  minimumDate, maximumDate, leading, containerStyle, showCalendarIcon = true,
}: Props) {
  const { colors: C, lang, isDark } = useApp()
  const ja = lang === 'ja'
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => new Date())
  const [pickerValid, setPickerValid] = useState(true)
  const today = useToday()

  const openPicker = () => {
    // 日付だけの文字列を new Date() に渡すと UTC 00:00 になり、UTC より西の端末では
    // 前日が選ばれた状態で開く。ローカルの暦日として読む
    const stored = value ? parseDateInput(value, lang) : undefined
    setDraft(clampDate((stored && parseLocalDate(stored)) || new Date(), minimumDate, maximumDate))
    setPickerValid(true)
    setOpen(true)
  }
  const commit = (date: Date) => {
    if (!pickerValid) return
    setOpen(false)
    onChange(formatDate(date, lang))
  }
  const canClear = clearable && !!value
  const clearDate = () => {
    setOpen(false)
    onChange('')
  }

  const pickerSheet = (
    <BottomSheetModal visible={open} onDismiss={() => setOpen(false)}>
      <View style={styles.sheetHeader}>
        <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.sheetButton, { color: C.textSub }]}>{ja ? 'キャンセル' : 'Cancel'}</Text>
        </TouchableOpacity>
        <Text style={[styles.sheetTitle, { color: C.text }]} numberOfLines={1}>{label}</Text>
        <TouchableOpacity onPress={() => commit(draft)} disabled={!pickerValid} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.sheetButton, styles.sheetDone, { color: pickerValid ? C.accentText : C.textMuted }]}>{ja ? '完了' : 'Done'}</Text>
        </TouchableOpacity>
      </View>
      {Platform.OS === 'web' ? (
        <input type="date" aria-label={label} required
          value={formatDate(draft, 'ja').replace(/\//g, '-')}
          min={minimumDate && formatDate(minimumDate, 'ja').replace(/\//g, '-')}
          max={maximumDate && formatDate(maximumDate, 'ja').replace(/\//g, '-')}
          onChange={(event) => {
            const stored = parseDateInput(event.currentTarget.value, 'ja')
            const date = stored && parseLocalDate(stored)
            setPickerValid(!!date)
            if (date) setDraft(clampDate(date, minimumDate, maximumDate))
          }}
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 48, marginTop: 16, marginBottom: 16, fontSize: 18, color: C.text, backgroundColor: C.input, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, colorScheme: isDark ? 'dark' : 'light' }}
        />
      ) : (
        <DateTimePicker value={draft} mode="date" display="spinner" locale={ja ? 'ja-JP' : 'en-US'}
          textColor={C.text} themeVariant={isDark ? 'dark' : 'light'} minimumDate={minimumDate} maximumDate={maximumDate}
          onChange={(_: DateTimePickerEvent, date?: Date) => { if (date) setDraft(date) }} style={styles.spinner} />
      )}
      {open && canClear && (
        <TouchableOpacity onPress={clearDate} style={styles.sheetClear} accessibilityRole="button"
          accessibilityLabel={ja ? `${label}を消す` : `Clear ${label}`}>
          <AppIcon name={ICONS.clear} size={18} color={C.textMuted} />
          <Text style={[styles.sheetButton, { color: C.textSub }]}>{ja ? `${label}を消す` : `Clear ${label}`}</Text>
        </TouchableOpacity>
      )}
    </BottomSheetModal>
  )

  if (Platform.OS === 'web') {
    return (
      <>
      <TextField
        size={size}
        invalid={invalid}
        value={value}
        onChangeText={(text) => {
          const formatted = formatDateInput(text, lang)
          const stored = parseDateInput(formatted, lang)
          const date = stored && parseLocalDate(stored)
          onChange(date ? formatDate(clampDate(date, minimumDate, maximumDate), lang) : formatted)
        }}
        placeholder={datePlaceholder(lang, today)}
        accessibilityLabel={label}
        keyboardType="numeric"
        maxLength={10}
        leading={leading}
        containerStyle={containerStyle}
        onClear={clearable ? () => onChange('') : undefined}
        clearAccessibilityLabel={ja ? `${label}を消す` : `Clear ${label}`}
        trailing={
          <TouchableOpacity onPress={openPicker} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={ja ? `${label}を選ぶ` : `Choose ${label}`}>
            <AppIcon name={ICONS.calendar} size={size === 'compact' ? 16 : 20} color={C.accentIcon} />
          </TouchableOpacity>
        }
      />
      {pickerSheet}
      </>
    )
  }

  return (
    <>
      <Pressable
        style={containerStyle}
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value || (ja ? '未入力' : 'Not set') }}
        accessibilityHint={ja ? 'ダイヤルで日付を選びます' : 'Opens a date picker'}
      >
        <TextField
          size={size}
          invalid={invalid}
          value={value}
          placeholder={datePlaceholder(lang, today)}
          // 欄そのものは入力を受けない。押した場所が文字の上でも外側の Pressable に届くよう、
          // 入力部分のタッチを素通しにする。
          editable={false}
          pointerEvents="none"
          accessible={false}
          leading={leading}
          trailing={showCalendarIcon ? <AppIcon name={ICONS.calendar} size={size === 'compact' ? 16 : 20} color={C.accentIcon} /> : undefined}
        />
      </Pressable>

      {open && Platform.OS === 'android' && (
        <DateTimePicker
          value={draft}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          neutralButton={canClear ? { label: ja ? '日付を消す' : 'Clear date', textColor: C.textMuted } : undefined}
          onChange={(event: DateTimePickerEvent, date?: Date) => {
            if (event.type === 'neutralButtonPressed' && canClear) clearDate()
            else if (event.type === 'set' && date) commit(date)
            else setOpen(false)
          }}
        />
      )}
      {Platform.OS !== 'android' && pickerSheet}
    </>
  )
}

const styles = StyleSheet.create({
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 4,
  },
  sheetTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '600' },
  sheetButton: { fontSize: 15, fontWeight: '600' },
  sheetDone: { fontWeight: '700' },
  sheetClear: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 },
  spinner: { height: 216 },
})
