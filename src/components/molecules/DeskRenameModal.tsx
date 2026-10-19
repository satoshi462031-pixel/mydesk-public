// デスク名の変更。タイルを長押しで開く小さな入力。
// タイルの中には入れられない（写真が主役の形なので入力欄を置く場所がない）。
// マイデスクの一覧とマイページのデスクタブで同じ操作にするため共通に置く。
import { useEffect, useState } from 'react'
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { UI_METRICS } from '../../constants/ui'
import { AppColors } from '../../context/AppContext'
import { DeskPlan } from '../../types'
import { DESK_NAME_MAX, isUnwrittenDeskName } from '../../utils/deskAutoName'
import { TextField } from '../atoms/TextField'

export function DeskRenameModal({
  plan, autoName, colors, t, onClose, onCommit,
}: {
  /** 名前を変えるデスク。null の間は閉じている */
  plan: DeskPlan | null
  /** 名前を空にしたときに付く自動の名前。入力欄の案内に出す */
  autoName: string
  colors: AppColors
  t: (key: string) => string
  onClose: () => void
  onCommit: (plan: DeskPlan, text: string) => void
}) {
  const [text, setText] = useState('')
  // 開くたびに、いまの名前（自動の名前のままなら空）から始める
  useEffect(() => {
    if (plan) setText(isUnwrittenDeskName(plan.name, autoName) ? '' : plan.name)
  }, [plan, autoName])

  const commit = () => {
    if (plan) onCommit(plan, text)
    onClose()
  }

  return (
    <Modal visible={!!plan} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.cancel')}
      />
      {/* 欄が自動で選ばれて開いた瞬間にキーボードが出る。画面の中央のままだと、小さい端末ではボタンが裏に入る */}
      <KeyboardAvoidingView
        style={styles.center}
        pointerEvents="box-none"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <Text style={[styles.title, { color: colors.text }]}>{t('a11y.renameDesk')}</Text>
          <TextField
            containerStyle={styles.input}
            value={text}
            onChangeText={setText}
            placeholder={autoName}
            autoFocus
            maxLength={DESK_NAME_MAX}
            returnKeyType="done"
            onSubmitEditing={commit}
          />
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, { borderColor: colors.border }]}
              onPress={onClose}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: colors.textSub }]}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, { backgroundColor: colors.accent }]}
              onPress={commit}
              accessibilityRole="button"
            >
              <Text style={[styles.btnText, { color: colors.onAccent }]}>{t('common.done')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { width: '100%', borderRadius: UI_METRICS.sheetRadius, padding: 20 },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 14 },
  input: { marginBottom: 16 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, paddingVertical: 11, borderRadius: UI_METRICS.controlRadius, borderWidth: 1, alignItems: 'center' },
  btnPrimary: { borderWidth: 0 },
  btnText: { fontSize: 14, fontWeight: '700' },
})
