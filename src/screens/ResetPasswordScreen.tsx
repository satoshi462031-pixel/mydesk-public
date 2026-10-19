import { Alert } from '../utils/alert'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { AppIcon } from '../components/atoms/AppIcon'
import { useApp } from '../context/AppContext'
import { supabase } from '../supabase/client'
import { RootStackParamList } from '../types'
import { UI_METRICS } from '../constants/ui'
import { TextField } from '../components/atoms/TextField'
import { localizedErrorMessage } from '../utils/localizedError'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'

type Props = NativeStackScreenProps<RootStackParamList, 'ResetPassword'>

// パスワード再設定メールのリンクから開く画面。この画面に着くまでに
// RootNavigator 側で完了しているセッション確立（completePasswordRecovery）を前提に、
// 新しいパスワードの入力だけを行う。
export function ResetPasswordScreen({ navigation }: Props) {
  const { colors, lang } = useApp()
  const C = colors

  const confirmRef = useRef<TextInput>(null)
  const [newPw, setNewPw]     = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)
  const submitInFlightRef = useRef(false)

  const handleSubmit = async () => {
    if (submitInFlightRef.current || !navigation.isFocused()) return
    if (newPw.length < 6) {
      setError(lang === 'en' ? 'Password must be at least 6 characters' : 'パスワードは6文字以上にしてください')
      return
    }
    if (newPw !== confirmPw) {
      setError(lang === 'en' ? 'Passwords do not match' : 'パスワードが一致しません')
      return
    }
    if (submitInFlightRef.current) return
    submitInFlightRef.current = true
    setError('')
    setSaving(true)
    try {
      const { error: updateError } = await withTimeout(
        supabase.auth.updateUser({ password: newPw }),
        QUICK_TIMEOUT_MS,
      )
      if (updateError) throw updateError
      if (!navigation.isFocused()) return
      Alert.alert(
        lang === 'en' ? 'Password updated' : 'パスワードを変更しました',
        lang === 'en' ? 'You can now use your new password.' : '新しいパスワードでログインできます。',
      )
      // 変更を待つ間に戻っていたら、replace は戻った先の画面を置き換えてしまう
      if (navigation.isFocused()) navigation.replace('MainTabs')
    } catch (e: unknown) {
      setError(localizedErrorMessage(e, lang))
    } finally {
      submitInFlightRef.current = false
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      <KeyboardAvoidingView style={styles.inner} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
          <View style={[styles.logoWrap, { backgroundColor: C.chip }]}>
            <AppIcon name="lock-reset" size={44} color={C.accentIcon} />
          </View>
          <Text style={[styles.title, { color: C.text }]}>
            {lang === 'en' ? 'Set a new password' : '新しいパスワードを設定'}
          </Text>
          <Text style={[styles.subtitle, { color: C.textMuted }]}>
            {lang === 'en' ? 'Use at least 6 characters and enter it twice.' : '6文字以上の同じパスワードを2回入力してください。'}
          </Text>
          </View>

          <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          <Text style={[styles.label, { color: C.textSub }]}>
            {lang === 'en' ? 'New password' : '新しいパスワード'}
          </Text>
          <TextField
            value={newPw}
            onChangeText={setNewPw}
            placeholder={lang === 'en' ? 'At least 6 characters' : '6文字以上'}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            passwordRules="minlength: 6;"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            // blurOnSubmit を切らないと、次の欄へ移す前にキーボードが一度閉じて開き直す
            blurOnSubmit={false}
            onSubmitEditing={() => confirmRef.current?.focus()}
            accessibilityLabel={lang === 'en' ? 'New password' : '新しいパスワード'}
          />

          <Text style={[styles.label, { color: C.textSub, marginTop: 14 }]}>
            {lang === 'en' ? 'Confirm password' : '新しいパスワード（確認）'}
          </Text>
          <TextField
            ref={confirmRef}
            value={confirmPw}
            onChangeText={setConfirmPw}
            secureTextEntry
            textContentType="newPassword"
            autoComplete="new-password"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            accessibilityLabel={lang === 'en' ? 'Confirm password' : '新しいパスワードの確認'}
          />

          {!!error && <Text accessibilityRole="alert" style={[styles.errorText, { color: C.danger }]}>{error}</Text>}

          </View>
        </ScrollView>
        <View style={[styles.actionBar, { backgroundColor: C.card, borderTopColor: C.border }]}>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: C.accent }, saving && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color={C.onAccent} />
              : <Text style={[styles.primaryBtnText, { color: C.onAccent }]}>{lang === 'en' ? 'Change' : '変更する'}</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: UI_METRICS.modalGutter, paddingVertical: 24 },

  header: { alignItems: 'center', marginBottom: 28 },
  // ロゴではなく、chip 地に AppIcon を1つ置くディスク。同じ作りの
  // PaywallScreen.iconWrap（80）・PublicDeskScreen.notFoundIconWrap（80）と同じ円にする
  logoWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6, paddingHorizontal: 12 },

  card: {
    borderRadius: UI_METRICS.cardRadius,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },

  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },

  errorText: { fontSize: 12, marginTop: 10, lineHeight: 18 },

  primaryBtn: {
    borderRadius: UI_METRICS.controlRadius,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700' },
  actionBar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: UI_METRICS.modalGutter, paddingTop: 10, paddingBottom: 10 },
})
