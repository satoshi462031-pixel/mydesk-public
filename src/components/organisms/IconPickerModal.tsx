import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { AppIcon } from '../atoms/AppIcon'
import { IconSearchGrid } from './IconSearchGrid'

interface Props {
  visible: boolean
  title: string
  selected: string
  tint?: string
  onClose: () => void
  /** 選んだら閉じる。名前の入力が無いので、確定ボタンを挟むと1手増えるだけになる */
  onSelect: (icon: string) => void
}

/** アイコンを全件から1つ選ぶ画面。名前は呼び出し側の画面で入れる */
export function IconPickerModal({ visible, title, selected, tint, onClose, onSelect }: Props) {
  const { colors: C, lang, reduceMotion } = useApp()
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={onClose}>
      <KeyboardAvoidingView style={[styles.container, { backgroundColor: C.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { backgroundColor: C.card, paddingTop: insets.top + 14, borderBottomColor: C.border }]}>
          <Text style={[styles.title, { color: C.text }]}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={lang === 'ja' ? '閉じる' : 'Close'}>
            <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
          </TouchableOpacity>
        </View>
        {visible && (
          <IconSearchGrid
            selected={selected}
            tint={tint}
            onSelect={(icon) => { onSelect(icon); onClose() }}
          />
        )}
        <View style={{ height: insets.bottom }} />
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
})
