import { Alert } from '../utils/alert'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Ionicons } from '@expo/vector-icons'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { resetPassword } from '../services/auth'
import { markOnboardingDone } from '../store/planStore'
import { analytics, EVENTS, errorProperties } from '../services/analytics'
import { RootStackParamList } from '../types'
import { UI_METRICS } from '../constants/ui'
import { PRIVACY_URL, TERMS_URL } from '../constants/plans'
import { AuthMethod, getLastAuthMethod } from '../utils/lastAuthMethod'
import { localizedErrorMessage } from '../utils/localizedError'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'
import { TextField } from '../components/atoms/TextField'
import { Button } from '../components/atoms/Button'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { ICONS } from '../constants/icons'
import { isPasskeySupported } from '../services/passkeyService'
import { isPasskeyCancelled, passkeyErrorMessage } from '../utils/passkeyErrors'
import { AppIcon } from '../components/atoms/AppIcon'

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>
type Mode = 'signin' | 'signup'

export function LoginScreen({ navigation, route }: Props) {
  const { colors, isDark, lang, t } = useApp()
  // 初回案内から来たときは、戻ると初回案内に戻れるよう積んで開く。ログインやスキップのあとは
  // 初回案内へ戻さず本編へ進める
  const fromOnboarding = route.params?.entry === 'onboarding'
  const { user, signIn, signInApple, signInGoogle, signInPasskey, signUp, skipAuth } = useAuth()
  const C = colors
  const loginFinishedRef = useRef(false)

  /**
   * ログイン後の着地点。オンボーディング直後は戻り先が無いので本編を積み直すが、
   * 本編から（公開・ブックマーク等で）呼ばれたときは元の画面へ戻す。
   * ここで replace すると、公開しようとしていたデスクではなくデスク一覧に着地してしまう
   */
  const finishLogin = useCallback(() => {
    if (loginFinishedRef.current || !navigation.isFocused()) return
    loginFinishedRef.current = true
    // 記録できなくても、次の起動で初回案内がもう一度出るだけなので待たない
    if (fromOnboarding) void markOnboardingDone().catch(() => {})
    if (!fromOnboarding && navigation.canGoBack()) navigation.goBack()
    else navigation.replace('MainTabs')
  }, [navigation, fromOnboarding])

  const handleSkip = async () => {
    if (skipInFlightRef.current || submitInFlightRef.current || socialInFlightRef.current) return
    skipInFlightRef.current = true
    setLoading(true)
    try {
      await skipAuth()
      if (fromOnboarding) await markOnboardingDone().catch(() => {})
      finishLogin()
    } catch (error) {
      setError(localizedErrorMessage(error, lang))
    } finally {
      skipInFlightRef.current = false
      setLoading(false)
    }
  }

  const [mode, setMode]         = useState<Mode>(route.params?.mode ?? 'signin')
  // 開いたままのログイン画面へ、別の面を指すリンクから来たときも合わせる
  const linkedMode = route.params?.mode
  useEffect(() => { if (linkedMode) setMode(linkedMode) }, [linkedMode])
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  // 「確認メールを送った」は失敗ではないので赤で出さない。以前はここを
  // 文言（'確認メール' / 'Confirmation email'）で見分けていたが、文言を
  // 1文字直すと静かに赤へ戻る。種類を state に持たせて表示と切り離す
  const [notice, setNotice]     = useState<{ text: string; kind: 'error' | 'info' }>({ text: '', kind: 'error' })
  const setError = useCallback((text: string) => setNotice({ text, kind: 'error' }), [])
  const setInfo  = useCallback((text: string) => setNotice({ text, kind: 'info' }), [])
  const [loading, setLoading]   = useState(false)
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | 'passkey' | null>(null)
  const [passkeyAvailable] = useState(isPasskeySupported)
  const [appleAvailable, setAppleAvailable] = useState(false)
  const [resetting, setResetting] = useState(false)
  const submitInFlightRef = useRef(false)
  const passwordRef = useRef<TextInput>(null)
  const socialInFlightRef = useRef(false)
  const resetInFlightRef = useRef(false)
  const skipInFlightRef = useRef(false)

  useEffect(() => {
    if (Platform.OS !== 'ios') return
    let active = true
    void AppleAuthentication.isAvailableAsync().then((available) => {
      if (active) setAppleAvailable(available)
    }).catch(() => { if (active) setAppleAvailable(false) })
    return () => { active = false }
  }, [])

  // 前回どれで入ったか。Apple・Google・メールは別のアカウントになるので、
  // 違う方法で入り直すと自分のデスクが無い画面に着く
  const [lastMethod, setLastMethod] = useState<AuthMethod | null>(null)
  useEffect(() => {
    let active = true
    void getLastAuthMethod().then((method) => { if (active) setLastMethod(method) })
    return () => { active = false }
  }, [])
  const lastMethodLabel = lastMethod === 'apple' ? 'Apple'
    : lastMethod === 'google' ? 'Google'
    : lastMethod === 'email' ? (lang === 'en' ? 'your email address' : 'メールアドレス')
    : lastMethod === 'passkey' ? (lang === 'en' ? 'a passkey' : 'パスキー')
    : null
  const lastLoginLabel = lang === 'en' ? 'Last used' : '前回ログイン'

  // UI側の待機を打ち切ったあとでも、認証SDKの処理自体は成功しうる。
  // セッションが届いたら画面を抜け、失敗表示のままログイン画面へ残さない。
  useEffect(() => {
    if (user) finishLogin()
  }, [user, finishLogin])

  const handleSocialSignIn = async (method: 'google' | 'apple' | 'passkey') => {
    if (socialInFlightRef.current || submitInFlightRef.current || skipInFlightRef.current) return
    socialInFlightRef.current = true
    setError('')
    setSocialLoading(method)
    const startedAt = Date.now()
    analytics.track(EVENTS.AUTH_ATTEMPTED, { auth_method: method, auth_mode: 'signin' })
    try {
      if (method === 'google') {
        const completed = await signInGoogle()
        if (!completed) return
      } else if (method === 'apple') {
        await signInApple()
      } else {
        await signInPasskey()
      }
      analytics.track(EVENTS.AUTH_SUCCEEDED, {
        auth_method: method,
        auth_mode: 'signin',
        duration_ms: Date.now() - startedAt,
      })
      finishLogin()
    } catch (e: unknown) {
      if (method === 'apple' && (e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return
      if (method === 'passkey' && isPasskeyCancelled(e)) return
      analytics.track(EVENTS.AUTH_FAILED, {
        auth_method: method,
        auth_mode: 'signin',
        duration_ms: Date.now() - startedAt,
        ...errorProperties(e),
      })
      setError(method === 'passkey' ? passkeyErrorMessage(e, lang)
        : localizedErrorMessage(e, lang, lang === 'en' ? 'Sign in failed.' : 'ログインに失敗しました。'))
    } finally {
      socialInFlightRef.current = false
      setSocialLoading(null)
    }
  }

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError(lang === 'en' ? 'Enter your email address first' : '先にメールアドレスを入力してください')
      return
    }
    if (resetInFlightRef.current) return
    resetInFlightRef.current = true
    setError('')
    setResetting(true)
    try {
      await withTimeout(resetPassword(email.trim()), QUICK_TIMEOUT_MS)
      analytics.track(EVENTS.PASSWORD_RESET_REQUESTED, { auth_method: 'email' })
      Alert.alert(
        lang === 'en' ? 'Email sent' : '送信しました',
        lang === 'en'
          ? 'Check your inbox for a link to reset your password.'
          : 'パスワード再設定用のリンクを記載したメールを送信しました。受信箱を確認してください。',
      )
    } catch (e: unknown) {
      setError(localizedErrorMessage(e, lang))
    } finally {
      resetInFlightRef.current = false
      setResetting(false)
    }
  }

  const handleSubmit = async () => {
    if (!email.trim())  { setError(lang === 'en' ? 'Please enter your email address' : 'メールアドレスを入力してください'); return }
    if (!password)      { setError(lang === 'en' ? 'Please enter your password' : 'パスワードを入力してください'); return }
    if (mode === 'signup' && password.length < 6) {
      setError(lang === 'en' ? 'Password must be at least 6 characters' : 'パスワードは6文字以上にしてください')
      return
    }
    if (submitInFlightRef.current || socialInFlightRef.current || skipInFlightRef.current) return
    submitInFlightRef.current = true
    setError('')
    setLoading(true)
    const startedAt = Date.now()
    analytics.track(EVENTS.AUTH_ATTEMPTED, { auth_method: 'email', auth_mode: mode })
    try {
      if (mode === 'signup') {
        const signedIn = await withTimeout(signUp(email.trim(), password), QUICK_TIMEOUT_MS)
        analytics.track(EVENTS.AUTH_SUCCEEDED, {
          auth_method: 'email', auth_mode: mode, duration_ms: Date.now() - startedAt,
          // 確認メールを挟んだかどうかは Supabase 側の設定で決まる。どちらだったかを残す
          session_established: signedIn,
        })
        // セッションが返ってきた＝メール確認は無効で、もうログイン済み。
        // ここで進めないと、登録できているのに「メールを確認してください」と出たまま
        // ログイン画面に留まる（appState は main になるが、表示中の Login は
        // 画面名が残っている限り差し替わらない）
        if (signedIn) {
          finishLogin()
          return
        }
        setInfo(lang === 'en' ? 'Confirmation email sent. Please check your inbox.' : '確認メールを送信しました。メールを確認してください。')
      } else {
        await withTimeout(signIn(email.trim(), password), QUICK_TIMEOUT_MS)
        analytics.track(EVENTS.AUTH_SUCCEEDED, {
          auth_method: 'email', auth_mode: mode, duration_ms: Date.now() - startedAt,
        })
        finishLogin()
      }
    } catch (e: unknown) {
      analytics.track(EVENTS.AUTH_FAILED, {
        auth_method: 'email', auth_mode: mode, duration_ms: Date.now() - startedAt, ...errorProperties(e),
      })
      setError(localizedErrorMessage(e, lang))
    } finally {
      submitInFlightRef.current = false
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bg }]}>
      {navigation.canGoBack() && (
        <View style={styles.topBar}>
          <HeaderIconButton name={ICONS.chevronLeft} size={25} color={C.text} onPress={() => { if (navigation.isFocused()) navigation.goBack() }} accessibilityLabel={t('a11y.back')} />
        </View>
      )}
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        {/* ロゴ */}
        <View style={styles.header}>
          <Image source={require('../../assets/brand-mark.png')} style={styles.logo} fadeDuration={0} />
          <Text style={[styles.title, { color: C.text }]}>MyDesk</Text>
          <Text style={[styles.subtitle, { color: C.textMuted }]}>
            {lang === 'en' ? 'Save, sync, and share your desk setup' : 'デスク環境を保存・同期・共有'}
          </Text>
        </View>

        {/* フォーム */}
        <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
          {/* モード切替 */}
          <View style={[styles.modeBar, { backgroundColor: C.chip }]}>
            {(['signin', 'signup'] as Mode[]).map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.modeBtn, mode === m && { backgroundColor: C.accent }]}
                onPress={() => { setMode(m); setError('') }}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
              >
                <Text style={[styles.modeBtnText, { color: mode === m ? C.onAccent : C.textSub }]}>
                  {m === 'signin' ? (lang === 'en' ? 'Sign In' : 'ログイン') : (lang === 'en' ? 'Sign Up' : '新規登録')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 前回の方法は本人も忘れるので、押す前に目に入る位置に置く */}
          {mode === 'signin' && lastMethodLabel && (
            <Text style={[styles.lastMethodNote, { color: C.textSub }]}>
              {lang === 'en'
                ? `Last time you signed in with ${lastMethodLabel}`
                : `前回は${lastMethodLabel}でログインしました`}
            </Text>
          )}

          {/* 1回押せば登録まで済む Apple・Google を先に置き、メールはその下にする（SNS のログイン画面と同じ順） */}
          {appleAvailable && (
            <View>
              {lastMethod === 'apple' && (
                <Text style={[styles.lastLoginBadge, { color: C.textSub, backgroundColor: C.chip }]}>{lastLoginLabel}</Text>
              )}
              <View style={socialLoading && styles.socialBtnDisabled} pointerEvents={socialLoading || loading ? 'none' : 'auto'}>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={isDark
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={10}
                  style={styles.appleBtn}
                  onPress={() => handleSocialSignIn('apple')}
                />
                {socialLoading === 'apple' && (
                  <View style={styles.appleLoading} pointerEvents="none">
                    <ActivityIndicator color={isDark ? '#000' : '#fff'} />
                  </View>
                )}
              </View>
            </View>
          )}

          <View style={appleAvailable && styles.socialBtnSpacing}>
            {lastMethod === 'google' && (
              <Text style={[styles.lastLoginBadge, { color: C.textSub, backgroundColor: C.chip }]}>{lastLoginLabel}</Text>
            )}
            <TouchableOpacity
              style={[
                styles.googleBtn,
                { backgroundColor: C.card, borderColor: C.inputBorder },
                socialLoading && styles.socialBtnDisabled,
              ]}
              onPress={() => handleSocialSignIn('google')}
              disabled={socialLoading !== null || loading}
              activeOpacity={0.75}
            >
              {socialLoading === 'google'
                ? <ActivityIndicator color={C.text} />
                : <>
                    {/* Google のマークだけは Ionicons。MaterialCommunityIcons の google は
                        ブランドの配色を持たない単色の絵なので ICONS には乗せない */}
                    <Ionicons name="logo-google" size={20} color="#4285F4" />
                    <Text style={[styles.googleBtnText, { color: C.text }]}>
                      {lang === 'en' ? 'Continue with Google' : 'Googleで続ける'}
                    </Text>
                  </>}
            </TouchableOpacity>
          </View>

          {mode === 'signin' && passkeyAvailable && (
            <TouchableOpacity
              style={[styles.googleBtn, styles.socialBtnSpacing, { backgroundColor: C.card, borderColor: C.inputBorder }, socialLoading && styles.socialBtnDisabled]}
              onPress={() => handleSocialSignIn('passkey')}
              disabled={socialLoading !== null || loading}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={lang === 'en' ? 'Sign in with a passkey' : 'パスキーでログイン'}
            >
              {socialLoading === 'passkey' ? <ActivityIndicator color={C.text} /> : <>
                <AppIcon name="key-outline" size={20} color={C.text} />
                <Text style={[styles.googleBtnText, { color: C.text }]}>
                  {lang === 'en' ? 'Sign in with a passkey' : 'パスキーでログイン'}
                </Text>
              </>}
            </TouchableOpacity>
          )}

          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: C.separator }]} />
            <Text style={[styles.dividerText, { color: C.textMuted }]}>{lang === 'en' ? 'or' : 'または'}</Text>
            <View style={[styles.dividerLine, { backgroundColor: C.separator }]} />
          </View>

          <Text style={[styles.label, { color: C.textSub }]}>{lang === 'en' ? 'Email' : 'メールアドレス'}</Text>
          <TextField
            value={email}
            onChangeText={setEmail}
            placeholder="desk@example.com"
            keyboardType="email-address"
            // キーチェーンの自動入力・保存の対象にする。iOS はログインの識別子を username で受け取る
            textContentType="username"
            autoComplete={Platform.OS === 'android' ? 'username' : 'email'}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            // blurOnSubmit を切らないと、次の欄へ移す前にキーボードが一度閉じて開き直す
            blurOnSubmit={false}
            onSubmitEditing={() => passwordRef.current?.focus()}
            accessibilityLabel={lang === 'en' ? 'Email' : 'メールアドレス'}
          />

          <Text style={[styles.label, { color: C.textSub, marginTop: 14 }]}>{lang === 'en' ? 'Password' : 'パスワード'}</Text>
          <TextField
            ref={passwordRef}
            value={password}
            onChangeText={setPassword}
            placeholder={mode === 'signup' ? (lang === 'en' ? 'At least 6 characters' : '6文字以上') : (lang === 'en' ? 'Password' : 'パスワード')}
            secureTextEntry
            // 登録では「強力なパスワード」を提案させ、ログインでは保存済みのものを出させる
            textContentType={mode === 'signup' ? 'newPassword' : 'password'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            passwordRules="minlength: 6;"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            accessibilityLabel={lang === 'en' ? 'Password' : 'パスワード'}
          />

          {mode === 'signin' && (
            <TouchableOpacity
              style={styles.forgotBtn}
              onPress={handleForgotPassword}
              disabled={resetting}
              activeOpacity={0.7}
            >
              <Text style={[styles.forgotBtnText, { color: C.accentText, opacity: resetting ? 0.6 : 1 }]}>
                {lang === 'en' ? 'Forgot password?' : 'パスワードをお忘れですか？'}
              </Text>
            </TouchableOpacity>
          )}

          {!!notice.text && (
            <Text
              accessibilityRole="alert"
              style={[styles.errorText, { color: notice.kind === 'info' ? C.info : C.danger }]}
            >
              {notice.text}
            </Text>
          )}

          <Button
            title={mode === 'signin' ? (lang === 'en' ? 'Sign In' : 'ログイン') : (lang === 'en' ? 'Sign Up' : '新規登録')}
            shape="control"
            style={styles.primaryBtn}
            onPress={handleSubmit}
            disabled={loading || socialLoading !== null}
            loading={loading}
          />

          {/* Apple・Google はログインでもその場でアカウントを作るので、面を問わず出す */}
          <Text style={[styles.legalNote, { color: C.textMuted }]}>
            {lang === 'en' ? 'By continuing, you agree to the ' : '続けると、'}
            <Text style={[styles.legalLink, { color: C.textSub }]} onPress={() => { void Linking.openURL(TERMS_URL) }} accessibilityRole="link">
              {lang === 'en' ? 'Terms of Use' : '利用規約'}
            </Text>
            {lang === 'en' ? ' and ' : 'と'}
            <Text style={[styles.legalLink, { color: C.textSub }]} onPress={() => { void Linking.openURL(PRIVACY_URL) }} accessibilityRole="link">
              {lang === 'en' ? 'Privacy Policy' : 'プライバシーポリシー'}
            </Text>
            {lang === 'en' ? '.' : 'に同意したものとみなされます。'}
          </Text>

          {/* デスク作成も配線図も端末内で完結するので、ここでアカウントを必須にしない。
              公開・ブックマーク・購入に触れた時点で改めてログインを求める */}
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={handleSkip}
            disabled={socialLoading !== null || loading}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <Text style={[styles.skipBtnText, { color: C.textMuted }]}>
              {lang === 'en' ? 'Continue without an account' : 'アカウントなしで使ってみる'}
            </Text>
          </TouchableOpacity>

        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', paddingHorizontal: UI_METRICS.screenGutter - 6 },
  inner: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: UI_METRICS.modalGutter, paddingVertical: 24 },

  header: { alignItems: 'center', marginBottom: 28 },
  logo: { width: 80, height: 80, marginBottom: 16 },
  title:  { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  subtitle: { fontSize: 13 },

  card: {
    borderRadius: UI_METRICS.cardRadius,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },

  skipBtn: { marginTop: 18, alignItems: 'center', paddingVertical: 6 },
  skipBtnText: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },

  modeBar: { flexDirection: 'row', borderRadius: UI_METRICS.controlRadius, padding: 3, marginBottom: 20 },
  modeBtn: { flex: 1, paddingVertical: 8, borderRadius: UI_METRICS.controlRadius, alignItems: 'center' },
  modeBtnText: { fontSize: 14, fontWeight: '600' },

  lastMethodNote: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  lastLoginBadge: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 3, borderRadius: UI_METRICS.controlRadius, marginBottom: 6 },

  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  forgotBtn: { alignSelf: 'flex-end', marginTop: 10 },
  forgotBtnText: { fontSize: 12, fontWeight: '600' },

  errorText: { fontSize: 12, marginTop: 10, lineHeight: 18 },
  legalNote: { fontSize: 12, lineHeight: 18, marginTop: 16, textAlign: 'center' },
  legalLink: { textDecorationLine: 'underline' },

  primaryBtn: {
    marginTop: 20,
  },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 18 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { marginHorizontal: 12, fontSize: 12 },
  googleBtn: {
    minHeight: UI_METRICS.buttonHeight,
    borderWidth: 1.5,
    borderRadius: UI_METRICS.controlRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleBtnText: { fontSize: 15, fontWeight: '600' },
  appleBtn: { width: '100%', height: UI_METRICS.buttonHeight },
  socialBtnSpacing: { marginTop: 10 },
  appleLoading: {
    position: 'absolute',
    top: 10,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialBtnDisabled: { opacity: 0.6 },

})
