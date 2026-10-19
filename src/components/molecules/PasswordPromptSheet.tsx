import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { Button } from '../atoms/Button'
import { HeaderIconButton } from '../atoms/HeaderIconButton'
import { TextField } from '../atoms/TextField'
import { BottomSheetModal } from './BottomSheetModal'

interface Props {
  visible: boolean
  title: string
  message: string
  confirmLabel: string
  /** 入力した文字列。閉じた・取り消したときは null */
  onSubmit: (password: string | null) => void
}

/**
 * パスワードを1つだけ聞くシート。iOS は Alert.prompt（secure-text）で聞けるが、
 * Android と Web には同じダイアログが無いので、その2つで代わりに使う
 */
export function PasswordPromptSheet({ visible, title, message, confirmLabel, onSubmit }: Props) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  const [password, setPassword] = useState('')
  // 開き直したときに前の入力を残さない
  useEffect(() => { if (visible) setPassword('') }, [visible])

  return (
    <BottomSheetModal visible={visible} onDismiss={() => onSubmit(null)} avoidKeyboard sheetStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: C.text }]} accessibilityRole="header">{title}</Text>
        <HeaderIconButton name={ICONS.close} color={C.textMuted} onPress={() => onSubmit(null)} accessibilityLabel={ja ? 'キャンセル' : 'Cancel'} />
      </View>
      <Text style={[styles.description, { color: C.textSub }]}>{message}</Text>
      <TextField
        value={password}
        onChangeText={setPassword}
        placeholder={ja ? 'パスワード' : 'Password'}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => { if (password) onSubmit(password) }}
        accessibilityLabel={ja ? 'パスワード' : 'Password'}
      />
      <Button title={confirmLabel} onPress={() => onSubmit(password)} disabled={!password} shape="control" />
    </BottomSheetModal>
  )
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700', flex: 1 },
  description: { fontSize: 14, lineHeight: 21 },
})
