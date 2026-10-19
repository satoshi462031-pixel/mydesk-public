import { useEffect, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native'
import { useApp } from '../../context/AppContext'
import { Button } from '../atoms/Button'
import { TextField } from '../atoms/TextField'

export function PasswordConfirmationModal({ email, onComplete }: {
  email: string | null
  onComplete: (password: string | null) => void
}) {
  const { colors: C, lang } = useApp()
  const [password, setPassword] = useState('')
  useEffect(() => { setPassword('') }, [email])
  const finish = (value: string | null) => {
    setPassword('')
    onComplete(value)
  }
  const ja = lang === 'ja'
  return (
    <Modal visible={email != null} transparent animationType="none" onRequestClose={() => finish(null)}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.card, { backgroundColor: C.card }]} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={[styles.title, { color: C.text }]}>{ja ? 'パスワードを入力' : 'Enter your password'}</Text>
          <Text style={[styles.message, { color: C.textSub }]}>{ja ? `削除する前に ${email} のパスワードを確認します。` : `Confirm the password for ${email} before deleting.`}</Text>
          <TextField value={password} onChangeText={setPassword} secureTextEntry autoFocus
            autoComplete="current-password" textContentType="password" autoCapitalize="none" autoCorrect={false}
            accessibilityLabel={ja ? 'パスワード' : 'Password'} returnKeyType="done"
            onSubmitEditing={() => { if (password) finish(password) }} />
          <View style={styles.actions}>
            <Button title={ja ? 'キャンセル' : 'Cancel'} variant="ghost" onPress={() => finish(null)} />
            <Button title={ja ? '確認' : 'Confirm'} disabled={!password} onPress={() => finish(password)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)' },
  card: { width: '100%', maxWidth: 420, alignSelf: 'center', borderRadius: 20, padding: 20, gap: 16 },
  title: { fontSize: 18, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
})
