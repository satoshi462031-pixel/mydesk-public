import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { UI_METRICS } from '../../constants/ui'
import { AppColors } from '../../context/AppContext'
import { AppIcon } from '../atoms/AppIcon'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { ICONS } from '../../constants/icons'

export interface ChoiceSheetOption<K extends string> {
  key: K
  label: string
  help?: string
}

interface Props<K extends string> {
  visible: boolean
  title: string
  closeLabel: string
  options: readonly ChoiceSheetOption<K>[]
  value: K
  onSelect: (key: K) => void
  onClose: () => void
  colors: AppColors
}

// 1つだけ選ぶ設定（並び順・まとめ方など）を、押した場所から出すシート。
// iOS のポップアップボタンが開くメニューと同じく「今の値の行に印、押せば閉じて反映」。
// 画面にチップを並べて切り替えると、選択肢の数だけ横幅を食い、どれが今の値かも枠の色でしか読めない
export function ChoiceSheet<K extends string>({ visible, title, closeLabel, options, value, onSelect, onClose, colors: C }: Props<K>) {
  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} sheetStyle={styles.sheet}>
      <View style={[styles.header, { borderBottomColor: C.border }]}>
        <Text style={[styles.title, { color: C.text }]}>{title}</Text>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
        >
          <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
        </TouchableOpacity>
      </View>
      {/* 機材の一覧など選択肢が多いときはシートの中で流す。並び順のように数行なら中身の高さで止まる */}
      <ScrollView style={styles.list} bounces={false} showsVerticalScrollIndicator={options.length > 8}>
      {options.map((option, index) => {
        const active = value === option.key
        return (
          <TouchableOpacity
            key={option.key}
            style={[
              styles.row,
              { borderBottomColor: C.separator },
              index === options.length - 1 && { borderBottomWidth: 0 },
              active && { backgroundColor: C.accent + '14' },
            ]}
            onPress={() => {
              onClose()
              onSelect(option.key)
            }}
            activeOpacity={0.75}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityHint={option.help}
          >
            <AppIcon name={active ? 'radiobox-marked' : 'radiobox-blank'} size={16} color={active ? C.accentIcon : C.textMuted} style={styles.radio} />
            <View style={styles.text}>
              <Text style={[styles.label, { color: active ? C.accentText : C.text }]} numberOfLines={1}>{option.label}</Text>
              {!!option.help && (
                <Text style={[styles.help, { color: C.textMuted }]} numberOfLines={2} ellipsizeMode="tail">
                  {option.help}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        )
      })}
      </ScrollView>
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: { overflow: 'hidden', paddingHorizontal: 0, maxHeight: '80%' },
  list: { flexGrow: 0 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingLeft: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 16, fontWeight: '700' },
  closeButton: { width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  row: { minHeight: UI_METRICS.rowMinHeight, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  radio: { marginRight: 10 },
  text: { flex: 1, minWidth: 0 },
  label: { fontSize: 14, fontWeight: '600' },
  // height で固定すると、文字を大きくしている端末で行の高さだけ拡大されて下が切れる
  help: { minHeight: 14, lineHeight: 14, fontSize: 11, marginTop: 2 },
})
