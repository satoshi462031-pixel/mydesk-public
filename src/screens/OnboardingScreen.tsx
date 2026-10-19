import { Alert } from '../utils/alert'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useEffect, useRef, useState } from 'react'
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '../components/atoms/Button'
import { AppIcon } from '../components/atoms/AppIcon'
import { DeskHistoryDemoModal } from '../components/organisms/DeskHistoryDemoModal'
import { AnalyticsConsentModal } from '../components/organisms/AnalyticsConsentModal'
import { UI_METRICS } from '../constants/ui'
import { ICONS } from '../constants/icons'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { analytics, EVENTS, hasAnalyticsChoice, setAnalyticsConsent } from '../services/analytics'
import { markOnboardingDone } from '../store/planStore'
import { RootStackParamList } from '../types'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'> & { introFinished: boolean }

export function OnboardingScreen({ navigation, introFinished }: Props) {
  const { colors, lang } = useApp()
  const { skipAuth } = useAuth()
  const startedAt = useRef(Date.now())
  // 保存を待つ間に二度押しされると replace が二重に走る
  const startInFlightRef = useRef(false)
  // 分析の選択が済んでいるか。読み込み前（null）は未選択として扱い、選択画面を出す
  const hasChoiceRef = useRef<boolean | null>(null)
  const afterChoiceRef = useRef<(() => void) | null>(null)
  const [consentVisible, setConsentVisible] = useState(false)
  const [demoVisible, setDemoVisible] = useState(false)

  useEffect(() => {
    void hasAnalyticsChoice().then((value) => { hasChoiceRef.current = value })
  }, [])

  // どの出口（登録・構成・復元）から出ても一度だけ聞く。ログイン前に聞くのは、
  // ログインしない人にも同じ導線で選んでもらうため
  const afterAnalyticsChoice = (next: () => void) => {
    if (hasChoiceRef.current) { next(); return }
    afterChoiceRef.current = next
    setConsentVisible(true)
  }

  const handleAnalyticsChoice = (enabled: boolean) => {
    setConsentVisible(false)
    hasChoiceRef.current = true
    // 内部の同意状態は呼んだ瞬間に切り替わるので、待たずに進めても
    // 直後の onboarding_intro_completed は選んだ内容どおりに扱われる
    void setAnalyticsConsent(enabled)
    const next = afterChoiceRef.current
    afterChoiceRef.current = null
    next?.()
  }

  const handleStart = async (destination: 'current' | 'explore') => {
    if (startInFlightRef.current || !navigation.isFocused()) return
    startInFlightRef.current = true
    // 同意前の説明閲覧は測れないため、選択後に観測できる入口を明示する。
    analytics.track(EVENTS.ONBOARDING_STARTED, { destination, measurement_start: 'after_consent' })
    analytics.track(EVENTS.ONBOARDING_INTRO_COMPLETED, {
      duration_ms: Date.now() - startedAt.current,
      destination,
    })
    try {
      await withTimeout(
        Promise.all([markOnboardingDone(), skipAuth()]),
        STORAGE_TIMEOUT_MS,
      )
      if (!navigation.isFocused()) {
        startInFlightRef.current = false
        return
      }
      analytics.track(EVENTS.ONBOARDING_COMPLETED, {
        duration_ms: Date.now() - startedAt.current,
        destination,
      })
      // RootStack からタブ内へ進むので、ネストした遷移先を1アクションで渡す。
      // タブ内画面用の navigateInTab は RootStack では親を取得できず動かない。
      // intent は用途のあとの行き先を分ける（整理する人はテンプレート一覧を挟まない）。
      // initial: false で一覧を下に敷く。無いと用途の画面が先頭になり、戻るが出ない
      // （utils/tabNavigation の navigateInTab と同じ）
      // 待つ間にログインなど別の画面へ移っていたら、replace はその画面を置き換えてしまう。
      // 戻ってきたときにもう一度押せるよう、押した印も外す
      if (!navigation.isFocused()) {
        startInFlightRef.current = false
        return
      }
      navigation.replace('MainTabs', destination === 'explore'
        ? { screen: 'FeedTab', params: { screen: 'DeskFeed' } }
        : {
          screen: 'PlanTab',
          params: {
            screen: 'PurposeSelection',
            params: { intent: 'organize', tutorial: true },
            initial: false,
          },
        })
    } catch (error) {
      startInFlightRef.current = false
      analytics.error('onboarding_complete', error)
      Alert.alert(
        lang === 'en' ? 'Could not start' : '開始できませんでした',
        lang === 'en' ? 'Please try again.' : 'もう一度お試しください。',
      )
    }
  }

  // ログインは任意。すでにアカウントを持っている人の入口。戻れば初回案内に戻れるよう積んで開き、
  // 初回案内を終えた記録はログインかスキップを終えたときに付ける（LoginScreen）
  const handleLogin = () => {
    if (startInFlightRef.current) return
    navigation.navigate('Login', { entry: 'onboarding' })
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.card }]}>
      <ScrollView style={styles.welcome} contentContainerStyle={styles.welcomeContent} showsVerticalScrollIndicator={false} pointerEvents={introFinished ? 'auto' : 'none'} aria-hidden={!introFinished} accessibilityElementsHidden={!introFinished} importantForAccessibility={introFinished ? 'auto' : 'no-hide-descendants'}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {lang === 'en' ? 'Your desk.\nIts story, all in one place.' : 'デスクの今と、\nこれまでをひとつに。'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSub }]}>
            {lang === 'en' ? 'Keep track of your gear and connections.\nShare your setup and how it grew.' : '機材と配線を記録。\nデスクの歩みも、そのまま共有。'}
          </Text>
        </View>

        <View style={[styles.stage, { backgroundColor: colors.input, borderColor: colors.separator }]}>
          <Image source={require('../../assets/brand-mark.png')} style={styles.appIcon} accessible={false} fadeDuration={0} />
          <TouchableOpacity disabled={!introFinished} onPress={() => setDemoVisible(true)} style={[styles.historyDemoBtn, { borderTopColor: colors.separator }]} activeOpacity={0.7} accessibilityRole="button">
            <AppIcon name={ICONS.history} size={18} color={colors.accentIcon} />
            <Text style={[styles.historyDemoText, { color: colors.accentText }]}>{lang === 'en' ? 'Try the desk history demo' : 'デスクの歴史を体験する'}</Text>
            <AppIcon name={ICONS.chevronRight} size={18} color={colors.accentIcon} />
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Button title={lang === 'en' ? 'Add my desk' : '自分のデスクを登録する'} disabled={!introFinished} onPress={() => afterAnalyticsChoice(() => { void handleStart('current') })} style={styles.button} />
          <Button
            title={lang === 'en' ? 'Explore desks' : 'みんなのデスクを見る'}
            variant="neutral"
            disabled={!introFinished}
            onPress={() => afterAnalyticsChoice(() => { void handleStart('explore') })}
            style={styles.quickButton}
          />
          <TouchableOpacity disabled={!introFinished} onPress={() => afterAnalyticsChoice(() => { void handleLogin() })} style={styles.loginBtn} activeOpacity={0.7} accessibilityRole="button">
            <Text style={[styles.loginBtnText, { color: colors.textSub }]}>
              {lang === 'en' ? 'Already have an account? ' : 'アカウントをお持ちの方は'}
              <Text style={[styles.loginBtnStrong, { color: colors.accentText }]}>{lang === 'en' ? 'Sign In' : 'ログイン'}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <AnalyticsConsentModal visible={consentVisible} lang={lang === 'en' ? 'en' : 'ja'} colors={colors} onChoose={handleAnalyticsChoice} />
      {demoVisible && <DeskHistoryDemoModal lang={lang === 'en' ? 'en' : 'ja'} onClose={() => setDemoVisible(false)} />}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  welcome: { flex: 1 },
  welcomeContent: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center', justifyContent: 'center', paddingHorizontal: UI_METRICS.modalGutter, paddingTop: 24, paddingBottom: 16, gap: 24 },
  content: { alignItems: 'center', gap: 12 },
  title: { fontSize: 26, lineHeight: 35, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  stage: { alignItems: 'center', borderWidth: 1, borderRadius: UI_METRICS.cardRadius, paddingTop: 4, paddingBottom: 4, overflow: 'hidden' },
  footer: { width: '100%', marginTop: 'auto', paddingTop: 16 },
  appIcon: { width: 120, height: 120, marginTop: 20 },
  historyDemoBtn: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: UI_METRICS.touchMinSize, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 16, marginHorizontal: 16, paddingVertical: 12 },
  historyDemoText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  button: { width: '100%' },
  quickButton: { width: '100%', marginTop: 10 },
  loginBtn: { alignItems: 'center', justifyContent: 'center', minHeight: UI_METRICS.touchMinSize, marginTop: 4, paddingVertical: 10 },
  loginBtnText: { fontSize: 13, fontWeight: '500' },
  loginBtnStrong: { fontWeight: '700' },
})
