import { Alert } from '../utils/alert'
import { isSignInPending } from '../store/accountDataOwner'
import { CommonActions } from '@react-navigation/native'
import { useScrollSyncRetry } from '../hooks/useScrollSyncRetry'
import { useScrollToTopOf } from '../hooks/useScrollToTopOf'
import React, { useEffect, useRef, useState } from 'react'
import appConfig from '../../app.json'
import { logoutBackupFailure, useAuth } from '../context/AuthContext'
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Modal,
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
import { ContrastToggle } from '../components/atoms/ContrastToggle'
import { TextField } from '../components/atoms/TextField'
import { Toast } from '../components/molecules/Toast'
import { ExploreHelpSheet } from '../components/organisms/ExploreHelpSheet'
import { WorkspaceHelpSheet } from '../components/organisms/WorkspaceHelpSheet'
import { BlockedUsersModal } from '../components/organisms/BlockedUsersModal'
import { usePlanPricing } from '../hooks/usePlanPricing'
import { APP_STORE_REVIEW_URL, APP_STORE_REVIEW_URL_WEB, PAYWALL_PLANS, PRIVACY_URL, TERMS_URL } from '../constants/plans'
import { setProfileDiscoverable } from '../services/profiles'
import { getNotificationPrefs, NotificationPrefs, setNotificationPrefs } from '../services/notificationPrefs'
import { getPushPermissionState, isPushSupported, openPushSettings, PushPermissionState, registerPushToken } from '../services/pushNotifications'
import { ProfileEditSheet } from '../components/organisms/ProfileEditSheet'
import { exportUserData } from '../services/dataExport'
import { changeAccountPassword, deleteAccount, prepareAccountDeletion, reauthenticateForDeletion, requestEmailChange } from '../services/auth'
import { FEEDBACK_MAX_LENGTH, FeedbackCategory, submitFeedback } from '../services/feedbackService'
import { multilineInputText } from '../utils/multilineInputText'
import { ACCENT_COLORS_TEMPORARILY_UNLOCKED, ACCENT_PRESETS, AccentKey } from '../constants/accentColors'
import { ICONS, MCIconName } from '../constants/icons'
import { PUSH_NOTIFICATIONS_ENABLED } from '../constants/features'
import { AppColors, useApp } from '../context/AppContext'
import { useSubscription } from '../context/SubscriptionContext'
import { useSpotlight } from '../context/SpotlightContext'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { useEntitlement } from '../hooks/useEntitlement'
import { openPaywall } from '../navigation/rootNavigation'
import {
  BACKUP_GENERATIONS,
  hasRestorePoint,
  hasPendingBackupRecovery,
  recoverInterruptedRestore,
  confirmBackupRecovery,
  getBackupPreview,
  saveAccountSnapshotNow,
  getLastBackupAt,
  listBackups,
  restoreBackup,
  undoRestore,
} from '../services/backupService'
import { BackupRow } from '../supabase/types'
import { PaywallReason, SettingsSection } from '../types'
import { analytics, errorProperties, EVENTS, getAnalyticsConsent, setAnalyticsConsent, trackLimitHit } from '../services/analytics'
import { promptLogin } from '../utils/promptLogin'
import { navigateInTab } from '../utils/tabNavigation'
import { isPlanActive, subscriptionStatusLabel } from '../utils/purchasePackages'
import { TimelineGrain } from '../utils/deskTimeline'
import { PlaybackSpeedControl } from '../components/molecules/PlaybackSpeedControl'
import { UI_METRICS } from '../constants/ui'
import { hapticSelection } from '../utils/haptics'
import { tidyMultilineText, truncateChars } from '../utils/truncateText'
import { buildStoreReviewUrls, buildSupportEmailUrl, isStoreReviewEnabled } from '../utils/helpLinks'
import { localizedErrorMessage } from '../utils/localizedError'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'
import { debugPushPermissionPrompt } from '../services/pushNotifications'
import { isPasskeySupported } from '../services/passkeyService'
import { PasskeySettingsSheet } from '../components/organisms/PasskeySettingsSheet'
import { PasswordConfirmationModal } from '../components/organisms/PasswordConfirmationModal'

// ─── 定数 ────────────────────────────────────────

const APP_VERSION = appConfig.expo?.version ?? '—'
const ANDROID_PACKAGE = appConfig.expo?.android?.package ?? 'com.ash462031.mydesk'
const SUPPORT_EMAIL = 'mydesk462031@gmail.com'

// ─── 設定のジャンル定義（1ページ目の入口リスト） ───────────
// いいね・保存・公開デスクの管理はマイページのタブが持つ。
// 歴史アニメーションの再生とAI相談履歴も「設定を変える」ではなく「機能を使う」
// 操作なので、デスク一覧とマイページへ入口を移した（ここには残さない）
const SECTION_DEFS: {
  key: SettingsSection
  ja: string
  en: string
  descriptionJa: string
  descriptionEn: string
  icon: MCIconName
}[] = [
  {
    key: 'account', ja: '基本設定', en: 'Basic Settings', icon: ICONS.account,
    descriptionJa: 'プロフィール・メール・パスワード', descriptionEn: 'Profile, email, and password',
  },
  {
    key: 'notifications', ja: '通知', en: 'Notifications', icon: ICONS.bell,
    descriptionJa: 'フォロー中の人の更新・拍手', descriptionEn: 'Updates from people you follow, applause',
  },
  {
    key: 'appearance', ja: '外観・言語', en: 'Appearance & Language', icon: ICONS.palette,
    descriptionJa: 'テーマ・言語・寸法の単位・動きの抑制', descriptionEn: 'Theme, language, units, and motion',
  },
  {
    key: 'history', ja: 'デスクの歴史', en: 'History Animation', icon: ICONS.history,
    descriptionJa: '再生速度・粒度・表示方法', descriptionEn: 'Playback speed, grouping, and display',
  },
  {
    key: 'privacy', ja: '公開とプライバシー', en: 'Sharing & Privacy', icon: 'shield-account-outline',
    descriptionJa: '公開プロフィール・ブロック・計測', descriptionEn: 'Public profile, blocking, and analytics',
  },
  {
    key: 'data', ja: 'データ管理', en: 'Data Management', icon: 'database-outline',
    descriptionJa: '復元・書き出し・削除', descriptionEn: 'Restore, export, and delete',
  },
  {
    key: 'help', ja: 'ヘルプ・使い方', en: 'Help & Guides', icon: 'help-circle-outline',
    descriptionJa: 'よくある質問・操作ガイド・問い合わせ', descriptionEn: 'FAQs, app guides, and support',
  },
  {
    key: 'about', ja: 'アプリについて', en: 'About the App', icon: ICONS.info,
    descriptionJa: 'バージョン・ご意見・規約', descriptionEn: 'Version, feedback, and legal',
  },
]

const SETTINGS_GROUPS: { ja: string; en: string; keys: SettingsSection[] }[] = [
  { ja: 'アカウント・表示', en: 'Account & Display', keys: ['account', 'notifications', 'appearance', 'history'] },
  { ja: '公開とプライバシー', en: 'Sharing & Privacy', keys: ['privacy'] },
  { ja: 'サポート・管理', en: 'Support & Management', keys: ['data', 'help', 'about'] },
]

export function settingsSectionTitle(section: SettingsSection, lang: 'ja' | 'en'): string {
  const def = SECTION_DEFS.find((s) => s.key === section)
  if (!def) return ''
  // 320px 幅では戻るアイコンの領域と重なり、元の英語名が省略される。
  if (section === 'appearance' && lang === 'en') return 'Appearance'
  return lang === 'ja' ? def.ja : def.en
}

// 通知の種類（096）。並び順は届く頻度の高い順
const NOTIFICATION_ROWS: {
  key: keyof NotificationPrefs
  icon: MCIconName
  labelJa: string
  labelEn: string
  subJa: string
  subEn: string
}[] = [
  {
    key: 'followUpdates', icon: 'account-heart-outline',
    labelJa: 'フォロー中の人の更新', labelEn: 'Updates from people you follow',
    subJa: 'デスクの公開・機材や写真の更新を知らせます（同じデスクは12時間に1回まで）', subEn: 'New desks and gear or photo updates (at most every 12 hours per desk)',
  },
  {
    key: 'claps', icon: ICONS.clap,
    labelJa: 'あなたのデスクへの拍手', labelEn: 'Applause on your desks',
    subJa: '拍手が届いたときに知らせます（12時間に1回まで）', subEn: 'When your desk gets applause (at most every 12 hours)',
  },
]

type PlanTier = 'free' | 'pro'

// 価格はここに持たない。表示は usePlanPricing().priceOf() でストアの実価格を引く
// （地域ごとに通貨も金額も違うため、定数に持つと日本のユーザーに $ 表示が出る）。
// プランの色はアクセントに追随させる。ここで固定色を持つと、
// アクセントを変えたユーザーの画面でここだけオレンジが残る
const PLAN_INFO: Record<PlanTier, { label: string; icon: MCIconName }> = {
  free: { label: 'Free', icon: 'crown-outline' },
  pro:  { label: 'Pro',  icon: 'crown-outline' },
}

type Theme    = 'light' | 'dark' | 'system'
type Language = 'ja'    | 'en'

// ─── 多言語文字列 ────────────────────────────────

const STR = {
  ja: {
    profileSection: 'プロフィール',
    accountSection: 'アカウント',
    appSection:     'アプリ設定',
    dataSection:    'データ管理',
    helpSection:    'ヘルプ',
    infoSection:    'アプリ情報',
    email:          'メールアドレス',
    theme:          'テーマ',
    accentColor:    'テーマカラー',
    language:       '言語',
    units:          '寸法の単位',
    aiCoach:        'AIデスクコーチ',
    goalSetup:      'デスクの用途を再設定',
    deleteAccount:  'アカウントを削除',
    faq:            'よくある質問',
    terms:          '利用規約',
    privacy:        'プライバシーポリシー',
    version:        'バージョン',
    edit:           '編集',
    save:           '保存',
    themeLight:     '白',
    themeDark:      '黒',
    themeSystem:    '端末の設定に合わせる',
    // このアプリはログイン前提。user が居ない＝ログアウト済みか、セッションの
    // 読み込みに失敗した状態なので「ゲスト（そういう利用形態）」とは書かない
    signedOut:      '未ログイン',
  },
  en: {
    profileSection: 'Profile',
    accountSection: 'Account',
    appSection:     'App Settings',
    dataSection:    'Data',
    helpSection:    'Help',
    infoSection:    'About',
    email:          'Email Address',
    aiCoach:        'AI Desk Coach',
    goalSetup:      'Reset Usage Goal',
    theme:          'Theme',
    accentColor:    'Accent Color',
    language:       'Language',
    units:          'Dimensions Unit',
    deleteAccount:  'Delete Account',
    faq:            'FAQ',
    terms:          'Terms of Service',
    privacy:        'Privacy Policy',
    version:        'Version',
    edit:           'Edit',
    save:           'Save',
    themeLight:     'Light',
    themeDark:      'Dark',
    themeSystem:    'Use Device Setting',
    signedOut:      'Signed out',
  },
}

// ─── FAQ データ ──────────────────────────────────

const FAQ_JA = [
  {
    q: 'ガジェットを追加するには？',
    a: 'マイページの「機材」タブ右下の「追加」、またはデスク詳細の「機材」タブにある「追加」から登録できます。商品名を入力すると予測変換が表示されます。',
  },
  {
    q: 'マイデスクとは？',
    a: '登録したガジェットを組み合わせて、最適な接続方法（USB-C / HDMI など）を自動で提案する機能です。「マイデスク」タブから作成できます。',
  },
  {
    q: 'ガジェットのポート情報をあとから変更できますか？',
    a: 'マイページの「機材」タブでガジェットをタップし、「編集」を押すとポート構成を変更できます。',
  },
  {
    q: 'アカウントの種類について',
    a: 'Free：マイデスク3件、写真は各デスク4枚、デスクの歴史は直近1年、アカウントバックアップ最新1件。Pro：デスク無制限、写真は各デスク10枚、AIコーチ（文章・写真共通の週間利用枠）、デスクの歴史は全期間、バックアップ履歴7件。AIの利用量は相談の長さや写真によって変わります。AIコーチはPro限定です。現在の価格は購入画面に表示されます。',
  },
]

const FAQ_EN = [
  {
    q: 'How do I add a gadget?',
    a: 'Use Add at the bottom right of the Gear tab on My Page, or Add in a desk’s Gear tab. Type the product name to see autocomplete suggestions.',
  },
  {
    q: 'What is MyDesk?',
    a: 'MyDesk suggests the optimal connections (USB-C, HDMI, etc.) between your registered gadgets. Create one in the MyDesk tab.',
  },
  {
    q: 'Can I edit port information later?',
    a: 'Yes. Tap a gadget in the Gear tab on My Page, then tap Edit to change its port configuration.',
  },
  {
    q: 'About account types',
    a: 'Free includes up to 3 desks, 4 photos per desk, the last year of desk history, and the latest account backup. Pro includes unlimited desks, 10 photos per desk, AI coaching with a shared weekly allowance for text and photos, unlimited history animation, and 7 backup generations. AI usage varies with conversation length and photos. The AI coach is Pro-only. Current pricing is shown on the purchase screen.',
  },
]

// ─── テーマカラー ────────────────────────────────

// 面・線・アイコン・文字はすべて共通トークンをそのまま使う。
// 以前はラベル類だけライト時に '#888' を独自に持っていたが、white 上で 3.54:1 と
// AA を割っていた（他画面の同じ役割の文字とも濃さがずれていた）。
function getC(colors: AppColors) {
  return {
    bg:      colors.bg,
    card:    colors.card,
    text:    colors.text,
    divider: colors.divider,
    chevron: colors.chevron,
    chip:    colors.chip,
    input:   colors.input,
    sub:     colors.textMuted,
    label:   colors.textMuted,
    // value と名付けると、style の中の c.value を Reanimated の Babel プラグインが共有値の .value と
    // 取り違え、開発ビルドで「インラインのスタイルで .value を読んでいる」警告を毎回差し込む
    valueText: colors.textMuted,
  }
}

// ════════════════════════════════════════════════
// 同じコンポーネントを 2 つのルート（ハブ / 各ジャンル）で使い回す。
// section が未指定なら 1 ページ目（ハブ）、指定されればそのジャンルだけを描画する。
export function SettingsScreen({ navigation, route }: { navigation: any; route?: any }) {
  const requestedSection: SettingsSection | 'hub' = route?.params?.section ?? 'hub'
  const section = requestedSection === 'notifications' && (!PUSH_NOTIFICATIONS_ENABLED || !isPushSupported())
    ? 'hub' : requestedSection
  const isHub = section === 'hub'
  const show = (s: SettingsSection) => section === s

  // ═════════════════════════════════════════════════════════════
  // コンテキスト・共通 ref
  // ═════════════════════════════════════════════════════════════
  const { gadgets, deletedGadgets, folders } = useGadgets()
  const { plans }   = usePlans()
  const { tier: planTier, isLoading: planLoading, restore: restorePurchases } = useSubscription()
  const { startTour } = useSpotlight()
  const { checkLimit, getLimit } = useEntitlement()
  const { user, profile, logOut, finishAccountDeletion, refreshProfile } = useAuth()
  const settingsUserIdRef = useRef(user?.id ?? null)
  settingsUserIdRef.current = user?.id ?? null
  useEffect(() => {
    settingsUserIdRef.current = user?.id ?? null
    return () => { settingsUserIdRef.current = null }
  }, [user])
  const { colors: ctxColors, lang: ctxLang, themeMode: ctxThemeMode, setThemeMode: ctxSetTheme, setLang: ctxSetLang, accentKey, setAccentKey, unitSystem, setUnitSystem, historyGrain, setHistoryGrain, historySpeed, setHistorySpeed, historyShowInOut, setHistoryShowInOut, historyNodeMorph, setHistoryNodeMorph, isDark: ctxIsDark, reduceMotion } = useApp()
  const scrollRef = useRef<ScrollView>(null)
  useScrollToTopOf(() => scrollRef.current)
  const { handlers: scrollHandlers } = useScrollSyncRetry(undefined, true, (offset) => {
    scrollRef.current?.scrollTo({ y: offset, animated: false })
  })

  // ═════════════════════════════════════════════════════════════
  // 設定 state・初期ロード
  // ═════════════════════════════════════════════════════════════
  // 設定ステート
  const [loaded,         setLoaded]         = useState(false)
  const [analyticsConsent, setAnalyticsConsentState] = useState(false)

  // UI ステート
  // 名前・写真・@ID の編集はシート側（ProfileEditSheet）が持つ。マイページからも同じものを開く
  const [editingProfile, setEditingProfile] = useState(false)
  const [editingEmail,   setEditingEmail]   = useState(false)
  const [emailText,      setEmailText]      = useState('')
  const [changingEmail,  setChangingEmail]  = useState(false)

  // パスワード変更モーダル
  const [showPwModal,  setShowPwModal]  = useState(false)
  const [showPasskeys, setShowPasskeys] = useState(false)
  const [passkeyAvailable] = useState(isPasskeySupported)
  const [currentPw,    setCurrentPw]    = useState('')
  const [newPw,        setNewPw]        = useState('')
  const [confirmPw,    setConfirmPw]    = useState('')
  const [deletionEmail, setDeletionEmail] = useState<string | null>(null)
  const deletionPasswordResolver = useRef<((password: string | null) => void) | null>(null)
  useEffect(() => {
    setDeletionEmail(null)
    return () => {
      deletionPasswordResolver.current?.(null)
      deletionPasswordResolver.current = null
    }
  }, [user?.id])
  const newPwRef = useRef<TextInput>(null)
  const confirmPwRef = useRef<TextInput>(null)
  const [pwError,      setPwError]      = useState('')

  // 初期ロード — loaded フラグが立つまでトグルをレンダーしない（アニメーション防止）
  useEffect(() => {
    void (async () => {
      try {
        setAnalyticsConsentState(await getAnalyticsConsent())
      } finally {
        // ここへ到達しないと設定画面がスピナーのまま固まり、
        // 基本設定・外観・データ管理のどれも開けなくなる
        setLoaded(true)
      }
    })()
  }, [])

  // テーマ/言語は context から取得
  const language = ctxLang
  const theme    = ctxThemeMode
  const c = getC(ctxColors)

  // 「〜しました」だけを伝える通知。Alert で止めるほどの内容ではない
  const [toast, setToast] = useState<string | null>(null)
  const [exploreHelpOpen, setExploreHelpOpen] = useState(false)
  const [workspaceHelpOpen, setWorkspaceHelpOpen] = useState(false)
  const [debuggingNotifications, setDebuggingNotifications] = useState(false)
  const notificationDebugInFlightRef = useRef(false)
  const emailSaveInFlightRef = useRef(false)
  const restorePurchasesInFlightRef = useRef(false)
  const notificationSaveInFlightRef = useRef(false)
  const discoverableSaveInFlightRef = useRef(false)
  const exportInFlightRef = useRef(false)
  const accountDeletionInFlightRef = useRef(false)
  const feedbackInFlightRef = useRef(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2400)
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])
  const t = STR[language]

  const runNotificationPermissionDebug = async () => {
    if (notificationDebugInFlightRef.current) return
    notificationDebugInFlightRef.current = true
    setDebuggingNotifications(true)
    try {
      const result = await debugPushPermissionPrompt()
      if (!result.supported) {
        Alert.alert(
          language === 'ja' ? '対応する実機で確認してください' : 'Test on a supported physical device',
          language === 'ja'
            ? 'このビルドでは通知を利用できません。'
            : 'Notifications are unavailable in this build.',
        )
        return
      }

      const status = result.afterStatus === 'granted'
        ? (language === 'ja' ? '許可済み' : 'Granted')
        : result.afterStatus === 'denied'
          ? (language === 'ja' ? '許可しない' : 'Denied')
          : (language === 'ja' ? '未選択' : 'Undetermined')
      const detail = result.prompted
        ? (language === 'ja' ? `OSダイアログを表示しました。現在: ${status}` : `The OS prompt was shown. Current status: ${status}`)
        : result.afterStatus === 'granted'
          ? (language === 'ja' ? 'すでに許可済みのため、OSダイアログは再表示されません。' : 'Permission is already granted, so the OS prompt was not shown again.')
          : !result.canAskAgain
            ? (language === 'ja'
                ? '以前に回答済みのため、OSダイアログは再表示できません。端末の設定で通知を変更するか、アプリを削除して入れ直して確認してください。'
                : 'The OS prompt cannot be shown again because it was answered before. Change Notifications in Settings or reinstall the app to test again.')
            : (language === 'ja' ? `OSダイアログは表示されませんでした。現在: ${status}` : `The OS prompt was not shown. Current status: ${status}`)
      Alert.alert(language === 'ja' ? '通知許可のデバッグ' : 'Notification permission debug', detail)
    } catch (error) {
      Alert.alert(
        language === 'ja' ? '通知許可を確認できませんでした' : 'Could not check notification permission',
        __DEV__ ? String(error) : undefined,
      )
    } finally {
      notificationDebugInFlightRef.current = false
      setDebuggingNotifications(false)
    }
  }

  // ═════════════════════════════════════════════════════════════
  // ハンドラ（保存 → アカウント → プラン → 公開デスク → データ操作）
  // ═════════════════════════════════════════════════════════════
  // Supabase Auth が持つアカウントのメールアドレスを変更する。
  const saveEmail = async () => {
    if (!user || emailSaveInFlightRef.current) return
    const next = emailText.trim()
    if (!next || next.toLowerCase() === (user?.email ?? '').toLowerCase()) {
      setEditingEmail(false)
      return
    }
    const ja = language === 'ja'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      Alert.alert(ja ? 'メールアドレスを確認してください' : 'Check your email address', next)
      return
    }
    emailSaveInFlightRef.current = true
    setChangingEmail(true)
    try {
      await requestEmailChange(next, user.id)
      if (settingsUserIdRef.current !== user.id) return
      setEditingEmail(false)
      Alert.alert(
        ja ? '確認メールを送りました' : 'Confirmation email sent',
        ja
          ? `${next} に届いたメールのリンクを開くと変更が完了します。現在のアドレスにも確認メールが届いた場合は、そちらのリンクも開いてください。`
          : `Open the link in the email sent to ${next} to finish the change. If your current address also receives a confirmation email, open that link too.`,
      )
    } catch (e) {
      if (settingsUserIdRef.current !== user.id) return
      Alert.alert(
        ja ? 'メールアドレスを変更できませんでした' : 'Could not change your email address',
        localizedErrorMessage(e, language, ja
          ? '通信環境を確認して、もう一度お試しください。'
          : 'Check your connection and try again.'),
      )
    } finally {
      emailSaveInFlightRef.current = false
      setChangingEmail(false)
    }
  }

  // Supabase の provider。メール認証のときだけ 'email'（未設定の旧セッションも email 扱い）
  const authProvider = (user?.app_metadata?.provider as string | undefined) ?? 'email'
  const canChangePassword = !!user && authProvider === 'email'

  // ログイン画面へ。ログアウトと同じくルートごと差し替える（Login はヘッダーを
  // 持たないので、上に積むと戻る手段が無い画面になってしまう）
  const goToLogin = (mode: 'signin' | 'signup' = 'signin') => {
    navigation.getParent()?.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'Login', params: { mode } }] })
    )
  }

  useEffect(() => {
    setEditingEmail(false); setEmailText('')
    setShowPwModal(false); setCurrentPw(''); setNewPw(''); setConfirmPw(''); setPwError('')
  }, [user?.id])

  const openPwModal = () => {
    setCurrentPw(''); setNewPw(''); setConfirmPw(''); setPwError('')
    setShowPwModal(true)
  }

  const handleChangePassword = async () => {
    if (!currentPw) { setPwError(language === 'ja' ? '現在のパスワードを入力してください' : 'Enter your current password.'); return }
    if (!newPw)     { setPwError(language === 'ja' ? '新しいパスワードを入力してください' : 'Enter a new password.'); return }
    if (newPw.length < 6) { setPwError(language === 'ja' ? '新しいパスワードは6文字以上にしてください' : 'Use at least 6 characters for the new password.'); return }
    if (newPw !== confirmPw) { setPwError(language === 'ja' ? '新しいパスワードが一致しません' : 'The new passwords do not match.'); return }

    if (!user || passwordInFlightRef.current) return
    passwordInFlightRef.current = true
    setChangingPassword(true)
    try {
      await changeAccountPassword(user.id, currentPw, newPw)
      if (settingsUserIdRef.current !== user.id) return
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      setShowPwModal(false)
      showToast(language === 'ja' ? 'パスワードを変更しました' : 'Password changed')
    } catch (e) {
      if (settingsUserIdRef.current !== user.id) return
      setPwError(localizedErrorMessage(e, language, language === 'ja' ? 'パスワードの変更に失敗しました。' : 'Failed to change password.'))
    } finally {
      passwordInFlightRef.current = false
      setChangingPassword(false)
    }
  }

  const changeTheme = async (v: Theme) => {
    await ctxSetTheme(v)
  }

  const changeLanguage = async (v: Language) => {
    await ctxSetLang(v)
  }

  // ── プラン ──
  // プラン比較は Paywall に一本化してある。ここで別のモーダルを出すと
  // 同じ比較表を2回見せてから購入させることになる
  const openPlans = (reason: PaywallReason) => {
    if (!navigation.isFocused()) return
    if (planTier === 'pro') {
      // 解約・プラン変更はストア側でしか行えない（アプリ内で処理するとリジェクト対象）
      const storeUrl = Platform.OS === 'ios'
        ? 'https://apps.apple.com/account/subscriptions'
        : 'https://play.google.com/store/account/subscriptions'
      Alert.alert(
        language === 'ja' ? 'サブスクリプションの管理' : 'Manage Subscription',
        language === 'ja'
          ? 'プランの変更・解約はストアのサブスクリプション管理から行えます。'
          : 'You can change or cancel your subscription in your store subscription settings.',
        [
          { text: language === 'ja' ? '閉じる' : 'Close', style: 'cancel' },
          { text: language === 'ja' ? '開く' : 'Open', onPress: () => { Linking.openURL(storeUrl).catch(() => {}) } },
        ],
      )
      return
    }
    ;(navigation.getParent?.() ?? navigation).navigate('Paywall', { reason })
  }

  // ── 購入の復元 ──
  // Paywall にも同じ導線があるが、機種変更したあとの人は「買い直す画面」ではなく
  // 設定を探す。審査でも設定に無いと見つけてもらえない。
  // 中身は Paywall の handleRestore と同じ手順にする。ログインの要否・計測・
  // 「見つからない」ときの案内が画面によって違うと、同じ操作の結果が変わってしまう
  const [restoring, setRestoring] = useState(false)
  const runRestorePurchases = async () => {
    if (restorePurchasesInFlightRef.current) return
    // RevenueCat の権利はログイン中のIDに紐づく。未ログインのまま復元すると
    // 匿名IDに付いてしまい、あとでログインしても Pro が戻らない
    if (!user) {
      promptLogin(navigation, language, language === 'ja'
        ? '購入と復元にはアカウントが必要です'
        : 'An account is required to purchase and restore.')
      return
    }
    restorePurchasesInFlightRef.current = true
    setRestoring(true)
    const startedAt = Date.now()
    analytics.track(EVENTS.PURCHASE_RESTORE_STARTED)
    try {
      const restoredPro = await withTimeout(restorePurchases(), QUICK_TIMEOUT_MS)
      analytics.track(
        restoredPro ? EVENTS.PURCHASE_RESTORED : EVENTS.PURCHASE_RESTORE_EMPTY,
        { duration_ms: Date.now() - startedAt, placement: 'settings' },
      )
      Alert.alert(
        restoredPro ? (language === 'ja' ? '復元しました' : 'Restored') : (language === 'ja' ? '購入が見つかりません' : 'Nothing to restore'),
        restoredPro
          ? (language === 'ja' ? '購入履歴を確認しました' : 'Your purchases have been restored.')
          // 買った覚えがあるのに戻らない原因はほぼ Apple ID 違い。ここを書かないと
          // 「復元できない」という問い合わせになる
          : (language === 'ja'
              ? '復元できる購入が見つかりませんでした。購入時と同じ Apple ID でサインインしているかご確認ください。'
              : 'No purchases were found to restore. Check that you are signed in with the same Apple ID used for the purchase.'),
      )
    } catch (e) {
      analytics.track(EVENTS.PURCHASE_RESTORE_FAILED, {
        duration_ms: Date.now() - startedAt,
        placement: 'settings',
        ...errorProperties(e),
      })
      Alert.alert(
        language === 'ja' ? 'エラー' : 'Error',
        localizedErrorMessage(e, language, language === 'ja'
          ? '購入履歴の復元に失敗しました。'
          : 'Restore failed.'),
      )
    } finally {
      restorePurchasesInFlightRef.current = false
      setRestoring(false)
    }
  }

  // ── 公開プロフィール ──
  // profile は起動直後 null のことがあるので、届いてから値を入れる（トグルの初期状態が
  // OFF に見えてしまうと、公開しているのに非公開だと読み違える）
  const [discoverable, setDiscoverable] = useState<boolean | null>(null)
  const [savingDiscoverable, setSavingDiscoverable] = useState(false)
  const discoverableUserIdRef = useRef<string | null>(null)
  useEffect(() => {
    // アカウントが変わったら前のユーザーの値を映さない。
    // profile は取得に失敗しても null になるので、user が居る間は最後に読めた値を保つ
    // （ここで null に戻すと、通信が切れただけでスピナーのまま操作できなくなる）
    if (discoverableUserIdRef.current !== (user?.id ?? null)) {
      discoverableUserIdRef.current = user?.id ?? null
      setDiscoverable(null)
    }
    if (!user) { setDiscoverable(null); return }
    if (profile?.id === user.id) setDiscoverable(profile.profile_discoverable !== false)
  }, [user, profile])

  // ── 通知（096） ──
  // 種類ごとの設定はアカウントに持つ（送るかを決めるのはサーバー）。届くまではスピナーで待たせる。
  // OS の許可は別に見る。許可が無いと設定をオンにしても届かないので、そのことを行で伝える
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs | null>(null)
  const [savingNotif, setSavingNotif] = useState(false)
  const notifPrefsUserIdRef = useRef<string | null>(null)
  const [pushPermission, setPushPermission] = useState<PushPermissionState | null>(null)
  const showNotifications = PUSH_NOTIFICATIONS_ENABLED && isPushSupported() && section === 'notifications'
  useEffect(() => {
    notifPrefsUserIdRef.current = null
    setNotifPrefs(null)
    if (!showNotifications || !user) return
    let active = true
    getNotificationPrefs(user.id)
      .then((prefs) => { if (active) { notifPrefsUserIdRef.current = user.id; setNotifPrefs(prefs) } })
      .catch(() => {})
    return () => { active = false }
  }, [showNotifications, user])
  useEffect(() => {
    if (!showNotifications) return
    const refresh = () => { void getPushPermissionState().then(setPushPermission) }
    refresh()
    // 端末の設定アプリで許可して戻ってきたときに、行を消す
    const sub = AppState.addEventListener('change', (next) => { if (next === 'active') refresh() })
    return () => sub.remove()
  }, [showNotifications])

  const changeNotifPref = async (key: keyof NotificationPrefs, on: boolean) => {
    if (!user || !notifPrefs || notifPrefsUserIdRef.current !== user.id || notificationSaveInFlightRef.current) return
    notificationSaveInFlightRef.current = true
    const previous = notifPrefs
    const next = { ...notifPrefs, [key]: on }
    setNotifPrefs(next)
    setSavingNotif(true)
    try {
      await setNotificationPrefs(user.id, next)
    } catch (e) {
      if (settingsUserIdRef.current !== user.id) return
      setNotifPrefs(previous)
      Alert.alert(
        language === 'ja' ? '変更できませんでした' : 'Could not change this',
        localizedErrorMessage(e, language, language === 'ja'
          ? '通信環境を確認して、もう一度お試しください。'
          : 'Check your connection and try again.'),
      )
    } finally {
      notificationSaveInFlightRef.current = false
      setSavingNotif(false)
    }
  }

  const enablePush = async () => {
    if (notificationDebugInFlightRef.current) return
    // 一度断った人には OS がダイアログを出さない。設定アプリの MyDesk の画面へ送る
    if (pushPermission === 'denied') {
      void openPushSettings().catch(() => {})
      return
    }
    notificationDebugInFlightRef.current = true
    try {
      await registerPushToken(language, { prompt: true })
      setPushPermission(await getPushPermissionState())
    } finally {
      notificationDebugInFlightRef.current = false
    }
  }

  const changeDiscoverable = async (next: boolean) => {
    if (!user || discoverableUserIdRef.current !== user.id || discoverableSaveInFlightRef.current) return
    discoverableSaveInFlightRef.current = true
    const previous = discoverable
    setDiscoverable(next)
    setSavingDiscoverable(true)
    try {
      await setProfileDiscoverable(next, user.id)
      if (settingsUserIdRef.current !== user.id) return
      // 反映済みの値を取り直すだけ。ここで失敗しても設定は変わっているので、
      // 巻き戻して「変わっていない」と見せない
      await refreshProfile().catch(() => {})
    } catch (e) {
      if (settingsUserIdRef.current !== user.id) return
      setDiscoverable(previous)
      Alert.alert(
        language === 'ja' ? '変更できませんでした' : 'Could not change this',
        localizedErrorMessage(e, language, language === 'ja'
          ? '通信環境を確認して、もう一度お試しください。'
          : 'Check your connection and try again.'),
      )
    } finally {
      discoverableSaveInFlightRef.current = false
      setSavingDiscoverable(false)
    }
  }

  // ── 使い方ガイド ──
  // 案内の1歩目（spotlightSteps の 'pick-purpose'）はデスクの用途を選ぶ画面。
  // どの設定画面からでも同じ開始地点に立てるよう、タブごと切り替えて送り出す。
  const startGuidedTour = () => {
    // 案内は新しいデスクを1つ作りながら進むので、一覧の「作成」と同じ上限を通す。
    // 作成の流れの中では上限を見ていないため、ここを素通りすると上限を超えて作れた。
    // 一覧と違って残り件数が見えていない場所なので、課金画面へ飛ばす前に理由を言う
    const ownPlanCount = plans.filter((p) => !p.isShared).length
    if (!checkLimit('maxWiringPlans', ownPlanCount)) {
      const max = getLimit('maxWiringPlans')
      trackLimitHit('maxWiringPlans', { current: ownPlanCount, max, placement: 'settings_guided_tour' })
      Alert.alert(
        language === 'ja' ? 'デスクの上限に達しています' : 'You have reached the desk limit',
        language === 'ja'
          ? `使い方ガイドは新しいデスクを1つ作りながら進みます。無料プランで作れるデスクは${max}件までです。`
          : `The guide walks you through making a new desk. The free plan includes up to ${max} desks.`,
        [
          { text: language === 'ja' ? '閉じる' : 'Close', style: 'cancel' },
          { text: language === 'ja' ? 'Pro を見る' : 'See Pro', onPress: () => openPaywall(navigation, 'maxWiringPlans') },
        ],
      )
      return
    }
    navigateInTab(navigation, 'PlanTab', 'PurposeSelection', { tutorial: true }, {
      fresh: true,
      lang: language,
      // 作成中のデスクを残すと選んだとき（キャンセル）に案内だけ始まらないよう、進むと決まってから始める
      onStart: () => startTour('pick-purpose', []),
    })
  }


  // ── データの書き出し ──
  const [exporting, setExporting] = useState(false)
  const runExport = async () => {
    if (exportInFlightRef.current) return
    exportInFlightRef.current = true
    setExporting(true)
    try {
      // 端末上のキャッシュを正として渡す。ここでディスクから読み直すと、
      // 直前の編集がまだ書き込まれていない場合に古い内容を書き出す
      const result = await exportUserData({ gadgets: [...gadgets, ...deletedGadgets], folders, plans })
      if (result === 'empty') {
        showToast(language === 'ja' ? '書き出せるデータがありません' : 'Nothing to export yet')
      } else if (result === 'unsupported') {
        Alert.alert(
          language === 'ja' ? '書き出せません' : 'Export unavailable',
          language === 'ja'
            ? 'この端末では共有シートを開けません。'
            : 'The share sheet is not available on this device.',
        )
      }
    } catch (e) {
      Alert.alert(
        language === 'ja' ? '書き出せませんでした' : 'Could not export',
        localizedErrorMessage(e, language, language === 'ja'
          ? 'しばらく置いてからもう一度お試しください。'
          : 'Please try again in a moment.'),
      )
    } finally {
      exportInFlightRef.current = false
      setExporting(false)
    }
  }

  // ── ブロック中のユーザー ──
  const [showBlocked, setShowBlocked] = useState(false)

  const [deletingAccount, setDeletingAccount] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  // ── バックアップからの復元 ──
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  // iOS は閉じかけのモーダルの上に Alert を出せず、シートと一緒に消える。復元の案内（自動保存を
  // 再開する手順）が出ないまま自動保存が止まっていたので、シートが閉じ終わってから出す。
  // Modal の onDismiss は iOS にしか来ないので、ほかの OS はすぐ出す
  const restoreNoticeRef = useRef<(() => void) | null>(null)
  const showAfterRestoreModalCloses = (show: () => void) => {
    if (Platform.OS === 'ios') restoreNoticeRef.current = show
    else show()
  }
  const showPendingRestoreNotice = () => {
    const show = restoreNoticeRef.current
    restoreNoticeRef.current = null
    show?.()
  }
  const [backups, setBackups] = useState<BackupRow[] | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [canUndoRestore, setCanUndoRestore] = useState(false)
  const [backupReviewPending, setBackupReviewPending] = useState(false)
  // 自動保存が止まっていても気付けるよう、最後に保存できた時刻を出す
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null)
  const backupOperationRef = useRef(false)
  useEffect(() => {
    let active = true
    void Promise.all([hasPendingBackupRecovery(), isSignInPending()]).then(([pending, signInPending]) => {
      if (active) setBackupReviewPending(pending || signInPending)
    }).catch(() => { if (active) setBackupReviewPending(true) })
    void getLastBackupAt().then((at) => { if (active) setLastBackupAt(at) }).catch(() => {})
    return () => { active = false }
  }, [section, user?.id])
  const passwordInFlightRef = useRef(false)

  // ── データ操作 ──
  const openRestore = async () => {
    if (!user) {
      Alert.alert(
        language === 'ja' ? 'ログインが必要です' : 'Sign in required',
        language === 'ja' ? 'バックアップはアカウントに保存されます。' : 'Backups are saved to your account.',
      )
      return
    }
    setShowRestoreModal(true)
    setBackups(null)
    try {
      await recoverInterruptedRestore()
      const [undoable, pending] = await Promise.all([hasRestorePoint(), hasPendingBackupRecovery()])
      setCanUndoRestore(undoable)
      setBackupReviewPending(pending || await isSignInPending())
      setBackups(await listBackups())
    } catch (e) {
      setBackups([])
      Alert.alert(
        language === 'ja' ? 'バックアップの取得に失敗しました' : 'Could not load backups',
        localizedErrorMessage(e, language, language === 'ja' ? '通信環境を確認して、もう一度お試しください。' : 'Check your connection and try again.'),
      )
    }
  }

  const handleRestore = async (backup: BackupRow) => {
    if (backupOperationRef.current) return
    backupOperationRef.current = true
    setRestoringId(backup.id)
    try {
      const preview = await getBackupPreview(backup.id)
      const ja = language === 'ja'
      const notes = [
        ja ? `デスク${preview.plans}件・ガジェット${preview.gadgets}件・AI相談${preview.conversations}件を復元します。` : `Restore ${preview.plans} desks, ${preview.gadgets} gadgets and ${preview.conversations} AI conversations.`,
        preview.damagedRecoveryPoint ? (ja ? '以前の取り消し用データを読み取れません。原本を保管し、今の端末の状態を新しく退避して復元します。' : 'The previous undo copy is unreadable. It will be preserved while a new undo copy is made from your current data.') : '',
        preview.removedItems > 0 ? (ja ? `読み取れないデータ${preview.removedItems}件は除外します。` : `${preview.removedItems} unreadable items will be excluded.`) : '',
        preview.repairedItems > 0 ? (ja ? '旧形式や欠けた項目を補修します。' : 'Older or incomplete items will be repaired.') : '',
        preview.missingConversations ? (ja ? 'この控えにはAI相談履歴がありません。端末の現在の相談履歴は置き換わります。' : 'This backup has no AI conversations. Current conversations will be replaced.') : '',
        preview.missingPublishLinks ? (ja ? '公開デスクとの対応情報がありません。再公開前に公開済みのデスクを確認してください。' : 'Published desk links are missing. Check your published desks before publishing again.') : '',
        preview.missingAppearance ? (ja ? 'テーマと色は現在の設定を維持します。' : 'Your current theme and color will be kept.') : '',
        ja ? '端末の内容を置き換えます。写真は含まれません。復元前の状態は確認が済むまで残します。' : 'Current data will be replaced. Photos are not included. The original data is kept until you confirm the restore.',
      ].filter(Boolean).join('\n\n')
      Alert.alert(ja ? 'このバックアップから復元' : 'Restore this backup', notes, [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        { text: ja ? '復元する' : 'Restore', style: 'destructive', onPress: () => { void runBackupRestore(backup.id) } },
      ])
    } catch (error) {
      Alert.alert(language === 'ja' ? '復元できません' : 'Cannot restore', localizedErrorMessage(error, language,
        language === 'ja' ? 'このバックアップを読み取れませんでした。再試行するか、別の世代を選んでください。端末のデータは変更していません。' : 'Could not read this backup. Retry or choose another backup. Your data has not changed.'))
    } finally {
      backupOperationRef.current = false
      setRestoringId(null)
    }
  }

  const runBackupRestore = async (backupId: string) => {
    if (backupOperationRef.current) return
    backupOperationRef.current = true
    setRestoringId(backupId)
    try {
      const summary = await restoreBackup(backupId, { allowPartial: true, replaceDamagedPoint: true })
      setCanUndoRestore(true)
      setBackupReviewPending(true)
      showAfterRestoreModalCloses(() => Alert.alert(language === 'ja' ? '復元しました' : 'Restored', language === 'ja'
        ? `デスク${summary.plans}件・ガジェット${summary.gadgets}件を復元しました。内容を確認してから、復元画面の「この内容で自動保存を再開」を押してください。写真は必要に応じて登録し直してください。`
        : `Restored ${summary.plans} desks and ${summary.gadgets} gadgets. Review your data, then resume backup saving from the restore screen. Add photos again if needed.`))
      setShowRestoreModal(false)
    } catch (error) {
      setCanUndoRestore(await hasRestorePoint().catch(() => false))
      setBackupReviewPending(await hasPendingBackupRecovery().catch(() => true) || await isSignInPending().catch(() => true))
      Alert.alert(language === 'ja' ? '復元に失敗しました' : 'Restore failed', localizedErrorMessage(error, language,
        language === 'ja' ? '復元を完了できませんでした。復元前へ戻すか、別の世代を選んでください。自動保存は停止しています。' : 'Restore could not finish. Undo it or choose another backup. Backup saving is paused.'))
    } finally {
      backupOperationRef.current = false
      setRestoringId(null)
    }
  }

  // 別の端末が送った、この端末の知らない控えがサーバーの最新にある。黙って上書きすると、
  // 無料プランではその控えが消える（1世代しか残らない）ので、本人に選ばせる
  const promptBackupConflict = () => {
    const ja = language === 'ja'
    Alert.alert(
      ja ? '別の端末の新しいバックアップがあります' : 'A newer backup exists',
      ja
        ? `別の端末で、この端末の内容とは違うバックアップが保存されています。この端末の内容で上書きすると、アカウントの最新はこの端末の内容になります${planTier === 'pro' ? '（別の端末のバックアップは復元の一覧に残ります）' : '（無料プランでは、別の端末のバックアップは残りません）'}。先に「バックアップから復元」で中身を確かめることもできます。`
        : `Another device saved a backup that differs from this device. Overwriting makes this device's data the latest in your account${planTier === 'pro' ? ' (the other backup stays in the restore list)' : ' (on the free plan, the other backup is not kept)'}. You can check it in Restore from Backup first.`,
      [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        { text: ja ? '復元画面を開く' : 'Open Restore', onPress: () => { void openRestore() } },
        { text: ja ? 'この端末の内容で上書き' : 'Overwrite with This Device', style: 'destructive', onPress: () => { void handleSaveBackup(true) } },
      ],
    )
  }

  const handleSaveBackup = async (overwriteNewer = false) => {
    if (!user || backupOperationRef.current) return
    backupOperationRef.current = true
    setRestoringId('save')
    try {
      const result = await saveAccountSnapshotNow(user.id, { overwriteNewer })
      if (result === 'done') {
        setCanUndoRestore(await hasRestorePoint())
        setLastBackupAt(await getLastBackupAt().catch(() => null))
        showToast(language === 'ja' ? 'バックアップを保存しました' : 'Backup saved.')
        return
      }
      if (result === 'conflict') {
        promptBackupConflict()
        return
      }
      const ja = language === 'ja'
      const message = result === 'too-large'
        ? (ja ? 'データが保存容量の上限を超えています。AI相談の本文を省いて保存することはしません。データを書き出して保管してください。' : 'Data exceeds the backup size limit. AI conversation text was not omitted. Export your data to keep a copy.')
        : result === 'recovery-pending' || result === 'not-synced'
          ? (ja ? '先に「バックアップから復元」で復元した内容を確認するか、別の世代を選んでください。' : 'Review your restored data or select another backup in Restore from Backup first.')
          : result === 'invalid-data'
            ? (ja ? '端末の保存データを欠落なく読み取れません。現在のバックアップは変更していません。データを書き出すか、バックアップから復元してください。' : 'Could not read all local data. Your current backup is unchanged. Export your data or restore a backup.')
          : result === 'garbled-text'
            ? (ja ? '文字化けした文字を含む名前やメモがあり、アカウントが受け付けません。現在のバックアップは変更していません。化けている名前・メモを直すと保存できます。' : 'Some names or notes contain garbled characters, so your account cannot accept them. Your current backup is unchanged. Fix the garbled text to save.')
            : (ja ? '保存を確認できませんでした。端末のデータは残っています。通信環境を確認して再試行してください。' : 'Could not confirm the save. Your data remains on this device. Check your connection and retry.')
      Alert.alert(ja ? 'バックアップを保存できませんでした' : 'Could not save backup', message)
    } finally { backupOperationRef.current = false; setRestoringId(null) }
  }

  const handleConfirmBackup = () => {
    if (!user || backupOperationRef.current) return
    Alert.alert(language === 'ja' ? 'この内容で自動保存を再開' : 'Resume backup saving', language === 'ja'
      ? '現在のデスク・ガジェット・AI相談履歴を正しい内容として保存します。バックアップの保存に成功した後、復元前へ戻すための退避を削除します。'
      : 'Save the current desks, gadgets and AI conversations. The copy used to undo restoration will be removed after the backup is saved.', [
      { text: language === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
      { text: language === 'ja' ? '再開する' : 'Resume', onPress: () => {
        if (backupOperationRef.current) return
        backupOperationRef.current = true
        setRestoringId('confirm')
        void confirmBackupRecovery(user.id).then(async () => {
          setBackupReviewPending(false)
          const result = await saveAccountSnapshotNow(user.id)
          if (result === 'conflict') { promptBackupConflict(); return }
          if (result !== 'done') throw new Error('backup save failed')
          setCanUndoRestore(false)
          setLastBackupAt(await getLastBackupAt().catch(() => null))
          showToast(language === 'ja' ? '保存しました。自動保存を再開します' : 'Saved. Automatic backups resumed.')
        }).catch(error => Alert.alert(language === 'ja' ? '保存できませんでした' : 'Could not save', localizedErrorMessage(error, language,
          language === 'ja' ? '現在のデータは端末に残っています。通信・空き容量を確認して、再試行してください。' : 'Your data is still on this device. Check your connection and storage, then retry.')))
          .finally(() => { backupOperationRef.current = false; setRestoringId(null) })
      } },
    ])
  }

  const handleUndoRestore = () => {
    if (backupOperationRef.current) return
    Alert.alert(
      language === 'ja' ? '復元を取り消す' : 'Undo restore',
      language === 'ja'
        ? '復元する前の状態に戻します。' : 'Your data will go back to the state before the restore.',
      [
        { text: language === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: language === 'ja' ? '元に戻す' : 'Undo',
          onPress: async () => {
            if (backupOperationRef.current) return
            backupOperationRef.current = true
            setRestoringId('undo')
            try {
              const summary = await undoRestore()
              setBackupReviewPending(false)
              setCanUndoRestore(false)
              setShowRestoreModal(false)
              showToast(summary
                ? (language === 'ja' ? '元に戻しました' : 'Restore undone')
                : (language === 'ja' ? '戻せる状態がありません' : 'Nothing to undo'))
            } catch (e) {
              Alert.alert(
                language === 'ja' ? '復元の取り消しに失敗しました' : 'Could not undo restore',
                localizedErrorMessage(e, language, language === 'ja' ? '復元前の状態に戻せませんでした。' : 'Could not return to the pre-restore state.'),
              )
            } finally { backupOperationRef.current = false; setRestoringId(null) }
          },
        },
      ],
    )
  }

  const runLogOut = async (discardUnsaved = false) => {
    try {
      await logOut({ discardUnsaved })
    } catch (e) {
      const ja = language === 'ja'
      const failure = logoutBackupFailure(e)
      if (failure) {
        // 控えが取れないまま消すと、アカウントに無い変更が戻らない。消すかどうかは本人が決める
        const reason = failure === 'invalid-data'
          ? (ja ? '端末のデータを欠落なく保存できませんでした。ログアウトせず、データを書き出すかバックアップから復元してください。' : 'Could not back up all local data. Keep this device signed in and export your data or restore a backup.')
          : failure === 'garbled-text'
          ? (ja ? '文字化けした文字を含む名前やメモがあり、アカウントが受け付けません。化けている名前・メモを直してからログアウトしてください。' : 'Some names or notes contain garbled characters, so your account cannot accept them. Fix the garbled text before logging out.')
          : failure === 'conflict'
          ? (ja ? '別の端末で、この端末の内容とは違うバックアップが保存されています。別の端末の内容はアカウントに残っています。' : 'Another device saved a different backup. That backup remains in your account.')
          : failure === 'recovery-pending'
          ? (ja ? '復元した内容の確認が済んでいません。設定 → データ → バックアップから復元で、内容を確認するか復元を取り消してください。' : 'Review or undo your restore in Settings → Data → Restore from Backup first.')
          : failure === 'too-large'
          ? (ja ? 'データが保存できる上限を超えています。' : 'Your data is over the backup size limit.')
          : failure === 'not-synced'
            ? (ja ? 'この端末のデータを、まだアカウントのデータと合わせられていません。通信できる場所でアプリを開き直すと合わせます。' : 'This device has not been synced with your account yet. Reopen the app while online to sync it.')
            : (ja ? '通信できる場所でもう一度お試しください。' : 'Try again when you are online.')
        Alert.alert(
          ja ? 'アカウントへ保存できませんでした' : 'Could not save to your account',
          reason + (ja
            ? '\nこのままログアウトすると、アカウントに保存されていない変更はこの端末から消え、元に戻せません。'
            : '\nIf you log out now, changes not saved to your account will be removed from this device and cannot be restored.'),
          [
            { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
            {
              text: ja ? '保存せずにログアウト' : 'Log Out Without Saving',
              style: 'destructive',
              onPress: () => { void runLogOut(true) },
            },
          ],
        )
        return
      }
      // 黙って止まると「押しても何も起きない」画面になる
      Alert.alert(
        ja ? 'ログアウトできませんでした' : 'Could not log out',
        localizedErrorMessage(e, language, ja ? 'ログアウトできませんでした。' : 'Could not log out.'),
      )
      return
    }
    // nav-after-await-ok: ログアウトの後は、どの画面にいてもログイン画面から始め直す（スタックごと置き換える reset）
    navigation.getParent()?.dispatch(
      CommonActions.reset({ index: 0, routes: [{ name: 'Login' }] })
    )
  }

  // メールで登録した人の削除前の再認証。どの OS でも PasswordConfirmationModal でパスワードを聞く
  // （Alert.prompt は iOS にしか無く、Android と Web でメール登録の人が削除できなかった）
  const askDeletionPassword = (email: string) => new Promise<string | null>((resolve) => {
    deletionPasswordResolver.current?.(null)
    deletionPasswordResolver.current = resolve
    setDeletionEmail(email)
  })

  // アカウント本体の削除。App Store ガイドライン 5.1.1(v) で必須。
  // auth.users ごと消え、同じメールアドレスで新規登録し直すことになる。
  // 取り違えると復旧できないので確認は2段階。
  const handleDeleteAccount = () => {
    if (!user || accountDeletionInFlightRef.current) return
    const confirmedUserId = user.id
    Alert.alert(
      language === 'ja' ? 'アカウントを削除' : 'Delete Account',
      language === 'ja'
        // 課金の解約はストア側でしかできない。削除＝解約と誤解されると請求が続く
        ? 'アカウントと端末・公開中の全データを削除し、元に戻せません。Proの解約はストアで別途行ってください。'
        : 'Deletes your account and all local and published data. This cannot be undone. Cancel Pro separately in the store.',
      [
        { text: language === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: language === 'ja' ? '次へ' : 'Continue',
          style: 'destructive',
          onPress: () => Alert.alert(
            language === 'ja' ? '本当に削除しますか？' : 'Delete for good?',
            language === 'ja'
              ? '削除後は同じメールアドレスでも過去のデータを引き継げません。'
              : 'Signing up again with the same email will not bring your data back.',
            [
              { text: language === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
              {
                text: language === 'ja' ? '削除する' : 'Delete',
                style: 'destructive',
                onPress: async () => {
                  if (accountDeletionInFlightRef.current) return
                  accountDeletionInFlightRef.current = true
                  setDeletingAccount(true)
                  try {
                    // Apple の再認証はここで失敗しうる。データを消した後に失敗すると
                    // 公開デスクだけ消えてアカウントが残るので、必ず先に済ませる
                    if (settingsUserIdRef.current !== confirmedUserId) throw new Error('AUTH_ACCOUNT_CHANGED')
                    const appleAuthorizationCode = await prepareAccountDeletion(confirmedUserId)
                    // Apple 以外もログインし直す（持ち出したトークンだけで削除させない）。理由は上と同じで先に済ませる
                    const reauthAccessToken = appleAuthorizationCode
                      ? undefined
                      : await reauthenticateForDeletion(askDeletionPassword, confirmedUserId)
                    if (settingsUserIdRef.current !== confirmedUserId) throw new Error('AUTH_ACCOUNT_CHANGED')
                    await deleteAccount(appleAuthorizationCode, reauthAccessToken, confirmedUserId)
                    if (settingsUserIdRef.current !== null && settingsUserIdRef.current !== confirmedUserId) throw new Error('AUTH_ACCOUNT_CHANGED')
                    await finishAccountDeletion()
                    // nav-after-await-ok: アカウントを消した後は、どの画面にいてもログイン画面から始め直す（スタックごと置き換える reset）
                    navigation.getParent()?.dispatch(
                      CommonActions.reset({ index: 0, routes: [{ name: 'Login' }] })
                    )
                  } catch (e) {
                    if (e instanceof Error && e.message === 'REAUTH_CANCELLED') return
                    Alert.alert(
                      language === 'ja' ? '削除に失敗しました' : 'Deletion failed',
                      localizedErrorMessage(e, language, language === 'ja' ? 'アカウントを削除できませんでした。' : 'Could not delete the account.'),
                    )
                  } finally {
                    accountDeletionInFlightRef.current = false
                    setDeletingAccount(false)
                  }
                },
              },
            ],
          ),
        },
      ],
    )
  }

  // 回答は Alert ではなくその場で開く。読んだあと隣の質問へ移りやすい
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  // 規約・ポリシーは公開サイトを正本にする。アプリ内に本文を持つと
  // 改訂のたびに再提出が必要になり、内容がサイト側とずれる。
  const openLegal = async (url: string, title: string) => {
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert(title, language === 'ja' ? 'ページを開けませんでした。' : 'Could not open the page.')
    }
  }

  const showTerms = () => {
    void openLegal(TERMS_URL, language === 'ja' ? '利用規約' : 'Terms of Service')
  }

  const showPrivacy = () => {
    void openLegal(PRIVACY_URL, language === 'ja' ? 'プライバシーポリシー' : 'Privacy Policy')
  }

  const openSupportEmail = async () => {
    try {
      await Linking.openURL(buildSupportEmailUrl(SUPPORT_EMAIL, language))
    } catch {
      Alert.alert(
        language === 'ja' ? 'メールアプリを開けませんでした' : 'Could not open your email app',
        SUPPORT_EMAIL,
      )
    }
  }

  // 「評価する」はストアのレビュー投稿ページを開く。ボタンから
  // StoreReview.requestReview() を呼ぶのは Apple のガイドライン違反にあたる
  const openReview = async () => {
    analytics.track(EVENTS.REVIEW_PROMPT_OPENED, { placement: 'settings' })
    const urls = buildStoreReviewUrls(
      Platform.OS,
      ANDROID_PACKAGE,
      APP_STORE_REVIEW_URL,
      APP_STORE_REVIEW_URL_WEB,
    )
    try {
      await Linking.openURL(urls.native)
    } catch {
      await Linking.openURL(urls.web).catch(() => {
        Alert.alert(
          language === 'ja' ? 'アプリを評価する' : 'Rate the app',
          language === 'ja' ? 'ストアを開けませんでした。' : 'Could not open the store.',
        )
      })
    }
  }

  const reviewEnabled = isStoreReviewEnabled(
    Platform.OS,
    process.env.EXPO_PUBLIC_APP_STORE_REVIEW_ENABLED === 'true',
    process.env.EXPO_PUBLIC_PLAY_STORE_REVIEW_ENABLED === 'true',
  )

  // ── フィードバック ──
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory>('bug')
  const [feedbackBody, setFeedbackBody] = useState('')
  const [feedbackSending, setFeedbackSending] = useState(false)
  const [feedbackAttachTrail, setFeedbackAttachTrail] = useState(true)
  useEffect(() => {
    setFeedbackOpen(false); setFeedbackBody(''); setFeedbackCategory('bug'); setFeedbackAttachTrail(true)
  }, [user?.id])

  const openFeedback = () => {
    if (user) {
      setFeedbackOpen(true)
      return
    }

    Alert.alert(
      language === 'ja' ? 'ログインが必要です' : 'Sign in required',
      language === 'ja'
        ? 'アプリ内フィードバックの送信にはログインが必要です。返信が必要な場合はメールでお問い合わせください。'
        : 'Sign in to send in-app feedback. Contact us by email if you need a reply.',
      [
        { text: language === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
        { text: language === 'ja' ? 'メール' : 'Email', onPress: () => { void openSupportEmail() } },
        { text: language === 'ja' ? 'ログイン' : 'Sign in', onPress: () => goToLogin('signin') },
        { text: language === 'ja' ? '新規登録' : 'Sign up', onPress: () => goToLogin('signup') },
      ],
    )
  }

  const closeFeedback = () => {
    if (feedbackInFlightRef.current) return
    setFeedbackOpen(false)
    setFeedbackBody('')
    setFeedbackCategory('bug')
    setFeedbackAttachTrail(true)
  }

  const sendFeedback = async () => {
    if (feedbackInFlightRef.current || !tidyMultilineText(feedbackBody)) return
    feedbackInFlightRef.current = true
    setFeedbackSending(true)
    try {
      await submitFeedback({
        category: feedbackCategory,
        expectedUserId: user?.id,
        body: tidyMultilineText(feedbackBody),
        attachTrail: feedbackAttachTrail,
        environment: { lang: language, theme: ctxIsDark ? 'dark' : 'light', plan: planTier },
      })
      if (settingsUserIdRef.current !== (user?.id ?? null)) return
      setFeedbackOpen(false)
      setFeedbackBody('')
      setFeedbackCategory('bug')
      setFeedbackAttachTrail(true)
      showToast(language === 'ja' ? '送信しました。ありがとうございます' : 'Sent — thank you')
    } catch (error) {
      if (settingsUserIdRef.current !== (user?.id ?? null)) return
      if (error instanceof Error && error.message === 'AUTH_REQUIRED') {
        Alert.alert(
          language === 'ja' ? 'ログインが必要です' : 'Sign in required',
          language === 'ja'
            ? 'セッションの有効期限が切れました。ログインし直してから送信してください。'
            : 'Your session expired. Sign in again before sending.',
          [
            { text: language === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
            {
              text: language === 'ja' ? 'ログイン' : 'Sign in',
              onPress: () => {
                setFeedbackOpen(false)
                goToLogin()
              },
            },
          ],
        )
      } else {
        Alert.alert(
          language === 'ja' ? '送信できませんでした' : 'Could not send',
          localizedErrorMessage(error, language, language === 'ja'
            ? '通信環境を確認して、もう一度お試しください。'
            : 'Check your connection and try again.'),
        )
      }
    } finally {
      feedbackInFlightRef.current = false
      setFeedbackSending(false)
    }
  }

  const faqItems = language === 'ja' ? FAQ_JA : FAQ_EN

  // ═════════════════════════════════════════════════════════════
  // 描画
  // ═════════════════════════════════════════════════════════════
  if (!loaded) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }, styles.loadingWrap]}>
        <ActivityIndicator size="small" color={c.sub} />
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
      <ScrollView
        ref={scrollRef}
        {...scrollHandlers}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.scroll, !isHub && styles.sectionScroll, section === 'account' && styles.accountSectionScroll]}
        keyboardShouldPersistTaps="handled"
      >

        {isHub && (<>
        {/* ── プラン ── */}
        <PlanCard
          currentTier={planTier}
          onUpgrade={() => openPlans('manual')}
          language={language}
        />

        {/* 購入の復元。Web には課金そのものが無い（RevenueCat のネイティブSDK前提）*/}
        {Platform.OS !== 'web' && (
          <View style={[styles.settingsListGroup, { backgroundColor: c.card, borderColor: c.divider }]}>
            <TouchableOpacity
              style={styles.settingsListRow}
              onPress={() => { void runRestorePurchases() }}
              disabled={restoring}
              activeOpacity={0.65}
              accessibilityRole="button"
            >
              <AppIcon name={ICONS.restore} size={21} color={c.sub} style={styles.settingsListIcon} />
              <View style={styles.settingsListText}>
                <Text style={[styles.settingsListTitle, { color: c.text }]}>
                  {language === 'ja' ? '購入を復元' : 'Restore Purchases'}
                </Text>
                <Text style={[styles.settingsListDescription, { color: c.sub }]}>
                  {language === 'ja'
                    ? '機種変更・再インストール後に Pro を戻す'
                    : 'Bring back Pro after reinstalling or switching devices'}
                </Text>
              </View>
              {restoring
                ? <ActivityIndicator size="small" color={c.sub} />
                : <AppIcon name={ICONS.chevronRight} size={19} color={c.chevron} />}
            </TouchableOpacity>
          </View>
        )}

        {/* AI相談履歴。設定の項目ではないが、溜めたものを見に来る場所という点で
            ここに集める。以前はマイページの「…」メニューから別タブへ飛ばしており、
            戻るとマイページではなくマイデスク一覧に着地していた */}
        <View style={[styles.settingsListGroup, { backgroundColor: c.card, borderColor: c.divider }]}>
          <TouchableOpacity
            style={styles.settingsListRow}
            onPress={() => { if (navigation.isFocused()) navigation.navigate('AICoachList') }}
            activeOpacity={0.65}
            accessibilityRole="button"
          >
            <AppIcon name={ICONS.robot} size={21} color={c.sub} style={styles.settingsListIcon} />
            <View style={styles.settingsListText}>
              <Text style={[styles.settingsListTitle, { color: c.text }]}>
                {language === 'ja' ? 'AI相談履歴' : 'AI Coach History'}
              </Text>
              <Text style={[styles.settingsListDescription, { color: c.sub }]}>
                {language === 'ja' ? '過去の相談を読み返す' : 'Read past conversations'}
              </Text>
            </View>
            <AppIcon name={ICONS.chevronRight} size={19} color={c.chevron} />
          </TouchableOpacity>
        </View>

        {/* ── 設定の入口リスト ── */}
        {SETTINGS_GROUPS.map((group) => {
          const defs = group.keys
            .filter((key) => key !== 'notifications' || (PUSH_NOTIFICATIONS_ENABLED && isPushSupported()))
            .map((key) => SECTION_DEFS.find((def) => def.key === key))
            .filter((def): def is (typeof SECTION_DEFS)[number] => !!def)
          return (
            <View key={group.en}>
              <SectionLabel title={language === 'ja' ? group.ja : group.en} color={c.label} />
              <View style={[styles.settingsListGroup, { backgroundColor: c.card, borderColor: c.divider }]}>
                {defs.map((s, index) => (
                  <TouchableOpacity
                    key={s.key}
                    style={[
                      styles.settingsListRow,
                      index < defs.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider },
                    ]}
                    onPress={() => { if (navigation.isFocused()) navigation.navigate('SettingsSection', { section: s.key }) }}
                    activeOpacity={0.65}
                    accessibilityRole="button"
                  >
                    <AppIcon name={s.icon} size={21} color={c.sub} style={styles.settingsListIcon} />
                    <View style={styles.settingsListText}>
                      <Text style={[styles.settingsListTitle, { color: c.text }]}>
                        {language === 'ja' ? s.ja : s.en}
                      </Text>
                      <Text style={[styles.settingsListDescription, { color: c.sub }]}>
                        {language === 'ja' ? s.descriptionJa : s.descriptionEn}
                      </Text>
                    </View>
                    <AppIcon name={ICONS.chevronRight} size={19} color={c.chevron} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )
        })}

        <Text style={[styles.footerText, { color: c.sub }]}>MyDesk</Text>
        </>)}

        {/* ── アカウント ── */}
        {show('account') && (<>
        <SectionLabel title={language === 'ja' ? 'アカウント' : 'Account'} color={c.label} />
        <View style={[styles.accountGroup, { backgroundColor: c.card, borderColor: c.divider }]}> 
          <TouchableOpacity
            style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
            onPress={() => setEditingProfile(true)}
            activeOpacity={0.65}
          >
            <View style={styles.rowLeft}>
              <View style={[styles.settingsRowIcon, { backgroundColor: c.chip }]}>
                <AppIcon name="account-outline" size={22} color={c.sub} />
              </View>
              <Text style={[styles.rowLabel, { color: c.text }]}>{language === 'ja' ? 'プロフィール編集' : 'Edit profile'}</Text>
            </View>
            <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
          </TouchableOpacity>

          {canChangePassword && (
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
              onPress={openPwModal}
              activeOpacity={0.65}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.settingsRowIcon, { backgroundColor: c.chip }]}>
                  {/* 鍵（ICONS.lock）は Pro 制限の印。パスワードは伏せ字の入力欄で分ける */}
                  <AppIcon name="form-textbox-password" size={22} color={c.sub} />
                </View>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? 'パスワードの設定' : 'Password settings'}
                </Text>
              </View>
              <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
            </TouchableOpacity>
          )}

          {!!user && passkeyAvailable && (
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
              onPress={() => setShowPasskeys(true)}
              activeOpacity={0.65}
              accessibilityRole="button"
              accessibilityLabel={language === 'ja' ? 'パスキーの設定' : 'Passkey settings'}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.settingsRowIcon, { backgroundColor: c.chip }]}>
                  <AppIcon name="key-outline" size={22} color={c.sub} />
                </View>
                <Text style={[styles.rowLabel, { color: c.text }]}>{language === 'ja' ? 'パスキー' : 'Passkeys'}</Text>
              </View>
              <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
            </TouchableOpacity>
          )}

          {!!user && (
            // 他の行と同じく行全体を押せるようにする。以前は右端の「＞」だけが押せて、
            // 行を押しても何も起きなかった。編集中は中の入力欄と保存ボタンに譲る
            // （accessible のままだと、読み上げで入力欄に届かない）
            <TouchableOpacity
              style={styles.row}
              onPress={() => { setEmailText(user.email ?? ''); setEditingEmail(true) }}
              disabled={editingEmail}
              activeOpacity={0.65}
              accessible={!editingEmail}
              accessibilityRole="button"
              accessibilityLabel={language === 'ja'
                ? `メールアドレスを変更、${user.email ?? ''}`
                : `Change email address, ${user.email ?? ''}`}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.settingsRowIcon, { backgroundColor: c.chip }]}>
                  <AppIcon name={ICONS.email} size={22} color={c.sub} />
                </View>
                <View style={styles.rowTextBlock}>
                  <Text style={[styles.rowLabel, { color: c.text }]}>{language === 'ja' ? 'メールアドレス' : 'Email address'}</Text>
                  {editingEmail ? (
                    <TextField
                      appearance="underline"
                      accentColor={ctxColors.accentIcon}
                      containerStyle={styles.emailInput}
                      value={emailText}
                      onChangeText={setEmailText}
                      onSubmitEditing={saveEmail}
                      autoFocus
                      keyboardType="email-address"
                      autoCapitalize="none"
                      returnKeyType="done"
                      placeholder="example@email.com"
                      editable={!changingEmail}
                    />
                  ) : (
                    <>
                      <Text style={[styles.rowSub, { color: c.sub }]} numberOfLines={1}>
                        {user.email ?? ''}
                      </Text>
                      {/* 確認メールを開くまでは切り替わらない。出しておかないと、
                          送ったのに変わっていない＝壊れている、に見える */}
                      {!!user.new_email && (
                        <Text style={[styles.rowSub, { color: c.sub }]} numberOfLines={1}>
                          {language === 'ja' ? `確認待ち：${user.new_email}` : `Pending: ${user.new_email}`}
                        </Text>
                      )}
                    </>
                  )}
                </View>
              </View>
              {editingEmail ? (
                <TouchableOpacity onPress={saveEmail} disabled={changingEmail} hitSlop={12} accessibilityRole="button">
                  <Text style={[styles.saveBtnText, { color: ctxColors.accentText, opacity: changingEmail ? 0.55 : 1 }]}>{t.save}</Text>
                </TouchableOpacity>
              ) : (
                <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
              )}
            </TouchableOpacity>
          )}

          {!user && (
            // 「ログイン」「登録」をそれぞれ押せる文字にし、ログイン画面のそれぞれの面へ送る
            <View style={[styles.row, styles.authRow]}>
              <View style={styles.rowLeft}>
                <View style={[styles.settingsRowIcon, { backgroundColor: c.chip }]}>
                  <AppIcon name="login" size={22} color={c.sub} />
                </View>
                <View style={styles.authLinks}>
                  <TouchableOpacity style={styles.authLink} onPress={() => goToLogin('signin')} activeOpacity={0.65} accessibilityRole="link">
                    <Text style={[styles.rowLabel, styles.authLinkText, { color: ctxColors.accentText }]}>{language === 'ja' ? 'ログイン' : 'Sign in'}</Text>
                  </TouchableOpacity>
                  <Text style={[styles.rowLabel, { color: c.text }]}>{language === 'ja' ? 'または' : ' or '}</Text>
                  <TouchableOpacity style={styles.authLink} onPress={() => goToLogin('signup')} activeOpacity={0.65} accessibilityRole="link">
                    <Text style={[styles.rowLabel, styles.authLinkText, { color: ctxColors.accentText }]}>{language === 'ja' ? '登録' : 'sign up'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>

        </>)}

        {/* ── 外観・表示 ── */}
        {show('appearance') && (<>
        <SettingsGroup
          title={language === 'ja' ? '見た目' : 'Appearance'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>

          {/* テーマ */}
          <View style={[styles.settingBlock, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}>
            <View style={styles.rowLeft}>
              <AppIcon name={ICONS.palette} size={20} color={c.sub} style={styles.rowIconView} />
              <Text style={[styles.rowLabel, { color: c.text }]}>{t.theme}</Text>
            </View>
            <SettingsChoiceList
              value={theme}
              options={([
                { value: 'system', label: t.themeSystem },
                { value: 'light', label: t.themeLight },
                { value: 'dark', label: t.themeDark },
              ] as { value: Theme; label: string }[])}
              onChange={changeTheme}
              colors={c}
              accent={c.sub}
            />
          </View>

          {/* テーマカラー */}
          <View style={[styles.settingBlock, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <AppIcon name={ICONS.palette} size={20} color={c.sub} style={styles.rowIconView} />
              <Text style={[styles.rowLabel, { color: c.text, marginLeft: 12 }]}>{t.accentColor}</Text>
              {!ACCENT_COLORS_TEMPORARILY_UNLOCKED && !planLoading && planTier === 'free' && (
                <View style={[styles.proBadge, { backgroundColor: ctxColors.accent }]}>
                  <Text style={[styles.proBadgeText, { color: ctxColors.onAccent }]}>PRO</Text>
                </View>
              )}
            </View>
            <View style={styles.swatchRow}>
              {ACCENT_PRESETS.map((preset) => {
                const isSelected = accentKey === preset.key
                const locked = !ACCENT_COLORS_TEMPORARILY_UNLOCKED && !planLoading && planTier === 'free' && preset.key !== 'orange'
                return (
                  <TouchableOpacity
                    key={preset.key}
                    hitSlop={5}
                    style={[
                      styles.swatch,
                      { backgroundColor: preset.color, opacity: locked ? 0.35 : 1 },
                      isSelected && [styles.swatchSelected, { borderColor: c.text }],
                    ]}
                    onPress={() => {
                      if (locked) { trackLimitHit('accentColor', { placement: 'settings_accent' }); openPlans('accentColor'); return }
                      if (!isSelected) hapticSelection()
                      void setAccentKey(preset.key as AccentKey)
                    }}
                    activeOpacity={0.75}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={language === 'ja' ? preset.label : preset.labelEn}
                    accessibilityHint={locked
                      ? (language === 'ja' ? 'Proプランの案内を開きます' : 'Opens Pro plan details')
                      : undefined}
                  >
                    {isSelected && <AppIcon name={ICONS.check} size={14} color={ctxColors.onAccent} />}
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        </View>
        </SettingsGroup>

        <SettingsGroup
          title={language === 'ja' ? '言語と単位' : 'Language & units'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          {/* 言語 */}
          <View style={[styles.settingBlock, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}>
            <View style={styles.rowLeft}>
              <AppIcon name={ICONS.language} size={20} color={c.sub} style={styles.rowIconView} />
              <Text style={[styles.rowLabel, { color: c.text }]}>{t.language}</Text>
            </View>
            <SettingsChoiceList
              value={language}
              options={([
                { value: 'ja', label: '日本語' },
                { value: 'en', label: 'English' },
              ] as { value: Language; label: string }[])}
              onChange={changeLanguage}
              colors={c}
              accent={c.sub}
            />
          </View>

          {/* 寸法の単位 */}
          <View style={styles.settingBlock}>
            <View style={styles.rowLeft}>
              <AppIcon name="ruler" size={20} color={c.sub} style={styles.rowIconView} />
              <Text style={[styles.rowLabel, { color: c.text }]}>{t.units}</Text>
            </View>
            <SettingsChoiceList
              value={unitSystem}
              options={[
                { value: 'metric', label: 'cm' },
                { value: 'imperial', label: 'inch' },
              ]}
              onChange={setUnitSystem}
              colors={c}
              accent={c.sub}
            />
          </View>
        </View>
        </SettingsGroup>

        </>)}

        {/* ── 歴史アニメーションの設定 ── */}
        {/* 再生と配置編集の入口はデスク一覧のヘッダーへ移した。ここは設定だけを持つ */}
        {show('history') && (<>
        <SettingsGroup
          title={language === 'ja' ? '再生設定' : 'Playback settings'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          {/* 再生時に導入・撤去をまとめる単位。月・年にするとページ数が減って全体を掴みやすい */}
          <View style={[styles.settingBlock, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}>
            <View style={styles.rowLeft}>
              <AppIcon name={ICONS.calendar} size={20} color={c.sub} style={styles.rowIconView} />
              <Text style={[styles.rowLabel, { color: c.text }]}>
                {language === 'ja' ? 'まとめる単位' : 'Group by'}
              </Text>
            </View>
            <SettingsChoiceList
              value={historyGrain}
              options={([
                {
                  value: 'day',
                  label: language === 'ja' ? '日ごと' : 'Day',
                  help: language === 'ja'
                    ? '変化があった日ごとに1ページ。台数が多いとページが増えて長くなる'
                    : 'One page per day with changes. Longer playback on large desks',
                },
                {
                  value: 'month',
                  label: language === 'ja' ? '月ごと' : 'Month',
                  help: language === 'ja' ? '同じ月の導入・撤去をまとめる' : 'Combine changes in the same month',
                },
                {
                  value: 'year',
                  label: language === 'ja' ? '年ごと' : 'Year',
                  help: language === 'ja' ? '同じ年の導入・撤去をまとめる' : 'Combine changes in the same year',
                },
              ] as { value: TimelineGrain; label: string; help: string }[])}
              onChange={(g) => { void setHistoryGrain(g) }}
              colors={c}
              accent={c.sub}
            />
          </View>

          {/* ここから下は再生中（プレイヤー右下の速度ボタン）でも変えられる項目。
              再生前に決めておけるよう、同じ設定をこちらにも置く */}
          <View style={[styles.settingBlock, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}>
            <View style={styles.rowLeft}>
              <AppIcon name="play-speed" size={20} color={c.sub} style={styles.rowIconView} />
              <Text style={[styles.rowLabel, { color: c.text }]}>
                {language === 'ja' ? '再生速度' : 'Playback speed'}
              </Text>
            </View>
            <PlaybackSpeedControl value={historySpeed} onChange={(s) => { void setHistorySpeed(s) }} />
          </View>

          {/* 導入・撤去（±）の一覧。OFF なら配線図を全画面で見せる */}
          <View style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}>
            <View style={styles.rowLeft}>
              <AppIcon name={ICONS.history} size={20} color={c.sub} style={styles.rowIconView} />
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? '導入・撤去の一覧' : 'Added / removed list'}
                </Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja' ? 'OFFで配線図を全画面表示' : 'Off: show wiring full screen'}
                </Text>
              </View>
            </View>
            <ContrastToggle
              value={historyShowInOut}
              onValueChange={(on) => { void setHistoryShowInOut(on) }}
              colors={{ accent: ctxColors.accent, text: c.text, textSub: c.sub, textMuted: c.sub, border: c.divider, chip: c.chip }}
              accessibilityLabel={language === 'ja' ? '導入・撤去の一覧' : 'Added / removed list'}
            />
          </View>

          {/* ガジェットの滑らか移動。「動きを減らす」ONのときは効かないので触れなくする */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <AppIcon name="transition" size={20} color={c.sub} style={styles.rowIconView} />
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? '機材の滑らか移動' : 'Smooth gadget movement'}
                </Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja' ? 'OFFで各日の配置へ瞬時に切り替え' : 'Off: snap to each day’s layout'}
                </Text>
              </View>
            </View>
            <ContrastToggle
              value={historyNodeMorph}
              onValueChange={(on) => { void setHistoryNodeMorph(on) }}
              colors={{ accent: ctxColors.accent, text: c.text, textSub: c.sub, textMuted: c.sub, border: c.divider, chip: c.chip }}
              disabled={reduceMotion}
              accessibilityLabel={language === 'ja' ? '機材の滑らか移動' : 'Smooth gadget movement'}
            />
          </View>
        </View>
        </SettingsGroup>
        </>)}


        {/* ── ヘルプ ── */}
        {show('help') && (
        <View style={[styles.group, { backgroundColor: c.card }]}>
          {/* 使い方ガイド（実際に操作しながらの案内を最初からやり直す） */}
          <TouchableOpacity
            style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
            onPress={startGuidedTour}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <AppIcon name="gesture-tap" size={20} color={c.sub} style={styles.rowIconView} />
              <View>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? 'デスクを作るガイド' : 'Guide to creating a desk'}
                </Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja' ? '新しいデスクを1つ作りながら、手順を案内します' : 'Walks you through making a new desk'}
                </Text>
              </View>
            </View>
            <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
            onPress={() => setWorkspaceHelpOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <View style={styles.rowLeft}>
              <AppIcon name="help-circle-outline" size={20} color={c.sub} style={styles.rowIconView} />
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>{language === 'ja' ? 'マイデスク・機材の使い方' : 'Using MyDesk and gear'}</Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>{language === 'ja' ? '画面の操作と、配線・履歴・数字の意味' : 'Controls, wiring, history, and what the numbers mean'}</Text>
              </View>
            </View>
            <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
            onPress={() => setExploreHelpOpen(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <View style={styles.rowLeft}>
              <AppIcon name="help-circle-outline" size={20} color={c.sub} style={styles.rowIconView} />
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>{language === 'ja' ? 'みんなのデスクの見方' : 'Explore desks guide'}</Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>{language === 'ja' ? '表示の意味と、公開デスクの使い方' : 'Understand the displays and use public desks'}</Text>
              </View>
            </View>
            <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
          </TouchableOpacity>
          {__DEV__ && (
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
              onPress={() => { void runNotificationPermissionDebug() }}
              disabled={debuggingNotifications}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={language === 'ja' ? '通知許可をデバッグ' : 'Debug notification permission'}
            >
              <View style={styles.rowLeft}>
                <AppIcon name={ICONS.bell} size={20} color={c.sub} style={styles.rowIconView} />
                <View style={styles.rowTextBlock}>
                  <Text style={[styles.rowLabel, { color: c.text }]}>
                    {language === 'ja' ? '通知許可をデバッグ' : 'Debug notification permission'}
                  </Text>
                  <Text style={[styles.rowSub, { color: c.sub }]}>
                    {language === 'ja'
                      ? '未選択ならOSの許可ダイアログを表示'
                      : 'Show the OS prompt if permission is undecided'}
                  </Text>
                </View>
              </View>
              {debuggingNotifications
                ? <ActivityIndicator size="small" color={c.sub} />
                : <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />}
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
            onPress={() => { void openSupportEmail() }}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <AppIcon name={ICONS.email} size={20} color={c.sub} style={styles.rowIconView} />
              <View>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? 'お問い合わせ' : 'Contact support'}
                </Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja' ? 'メールで問い合わせる' : 'Contact us by email'}
                </Text>
              </View>
            </View>
            <AppIcon name={ICONS.openExternal} size={18} color={c.chevron} />
          </TouchableOpacity>
          {faqItems.map((item, i) => {
            const open = openFaq === i
            return (
              <View key={i} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }}>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => {
                    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
                    setOpenFaq(current => current === i ? null : i)
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                >
                  <View style={styles.rowLeft}>
                    <AppIcon name={ICONS.info} size={20} color={c.sub} style={styles.rowIconView} />
                    <Text style={[styles.rowLabel, { color: c.text, flexShrink: 1 }]}>{item.q}</Text>
                  </View>
                  <AppIcon name={open ? ICONS.chevronUp : ICONS.chevronDown} size={20} color={c.chevron} />
                </TouchableOpacity>
                {open && (
                  <Text style={[styles.faqAnswer, { color: c.sub }]}>{item.a}</Text>
                )}
              </View>
            )
          })}
        </View>
        )}

        {/* ── アプリ情報（バージョン・法的事項） ── */}
        {show('about') && (<>
        <SettingsGroup
          title={language === 'ja' ? 'アプリ情報' : 'App info'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <AppIcon name={ICONS.info} size={20} color={c.sub} style={styles.rowIconView} />
              <Text style={[styles.rowLabel, { color: c.text }]}>{t.version}</Text>
            </View>
            <Text style={[styles.rowValue, { color: c.valueText }]}>{APP_VERSION}</Text>
          </View>
        </View>
        </SettingsGroup>

        {/* ── 応援・フィードバック ──
            リリース直後は不具合報告が命綱になるので、法的事項より上に置いて見つけやすくする */}
        <SettingsGroup
          title={reviewEnabled ? (language === 'ja' ? 'ご意見・評価' : 'Feedback & Rating') : (language === 'ja' ? 'ご意見' : 'Feedback')}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          <TouchableOpacity
            style={[styles.row, reviewEnabled && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
            onPress={openFeedback}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <AppIcon name="message-text-outline" size={20} color={c.sub} style={styles.rowIconView} />
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? 'ご意見・不具合を送る' : 'Send feedback'}
                </Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja' ? '返信なし・ログインが必要' : 'No reply · Sign-in required'}
                </Text>
              </View>
            </View>
            <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
          </TouchableOpacity>
          {reviewEnabled && (
            <TouchableOpacity style={styles.row} onPress={openReview} activeOpacity={0.7}>
              <View style={styles.rowLeft}>
                <AppIcon name={ICONS.star} size={20} color={c.sub} style={styles.rowIconView} />
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? 'ストアで評価する' : 'Rate in Store'}
                </Text>
              </View>
              <AppIcon name={ICONS.openExternal} size={18} color={c.chevron} />
            </TouchableOpacity>
          )}
        </View>
        </SettingsGroup>

        <View style={styles.legalLinks}>
          <TouchableOpacity style={styles.legalLink} onPress={showTerms} activeOpacity={0.7}>
            <Text style={[styles.legalLinkText, { color: c.sub }]}>{t.terms}</Text>
          </TouchableOpacity>
          <Text style={[styles.legalSeparator, { color: c.sub }]}>·</Text>
          <TouchableOpacity style={styles.legalLink} onPress={showPrivacy} activeOpacity={0.7}>
            <Text style={[styles.legalLinkText, { color: c.sub }]}>{t.privacy}</Text>
          </TouchableOpacity>
        </View>
        </>)}

        {/* ── 通知（096） ── */}
        {show('notifications') && (<>
        <SettingsGroup
          title={language === 'ja' ? '通知' : 'Notifications'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          {!user ? (
            <View style={styles.row}>
              <Text style={[styles.rowSub, { color: c.sub }]}>
                {language === 'ja' ? 'ログインすると通知を受け取れます' : 'Sign in to receive notifications.'}
              </Text>
            </View>
          ) : (<>
            {(pushPermission === 'undetermined' || pushPermission === 'denied') && (
              <TouchableOpacity
                style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
                onPress={() => { void enablePush() }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <View style={styles.rowLeft}>
                  <AppIcon name={ICONS.bellOff} size={20} color={c.sub} style={styles.rowIconView} />
                  <View style={styles.rowTextBlock}>
                    <Text style={[styles.rowLabel, { color: c.text }]}>
                      {language === 'ja' ? '通知が許可されていません' : 'Notifications are off'}
                    </Text>
                    <Text style={[styles.rowSub, { color: c.sub }]}>
                      {pushPermission === 'denied'
                        ? (language === 'ja' ? '端末の設定で MyDesk の通知を許可してください' : 'Allow notifications for MyDesk in the Settings app.')
                        : (language === 'ja' ? 'タップして通知を許可します' : 'Tap to allow notifications.')}
                    </Text>
                  </View>
                </View>
                <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
              </TouchableOpacity>
            )}
            {NOTIFICATION_ROWS.map((item, i) => (
              <View
                key={item.key}
                style={[styles.row, i < NOTIFICATION_ROWS.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
              >
                <View style={styles.rowLeft}>
                  <AppIcon name={item.icon} size={20} color={c.sub} style={styles.rowIconView} />
                  <View style={styles.rowTextBlock}>
                    <Text style={[styles.rowLabel, { color: c.text }]}>
                      {language === 'ja' ? item.labelJa : item.labelEn}
                    </Text>
                    <Text style={[styles.rowSub, { color: c.sub }]}>
                      {language === 'ja' ? item.subJa : item.subEn}
                    </Text>
                  </View>
                </View>
                {notifPrefs === null
                  ? <ActivityIndicator size="small" color={c.sub} />
                  : (
                    <ContrastToggle
                      value={notifPrefs[item.key]}
                      onValueChange={(on) => { void changeNotifPref(item.key, on) }}
                      disabled={savingNotif}
                      colors={{ accent: ctxColors.accent, text: c.text, textSub: c.sub, textMuted: c.sub, border: c.divider, chip: c.chip }}
                      accessibilityLabel={language === 'ja' ? item.labelJa : item.labelEn}
                    />
                  )}
              </View>
            ))}
          </>)}
        </View>
        </SettingsGroup>
        </>)}

        {/* ── 公開とプライバシー ── */}
        {/* 「誰に何が見えるか」は3か所に散っていた（プロフィール・データ・法的事項）。
            公開プロフィールを足したときに集約の可否を選ぶ場所が無かったのが元の穴 */}
        {show('privacy') && (<>
        <SettingsGroup
          title={language === 'ja' ? '公開プロフィール' : 'Public profile'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          {/* デスクを公開できるのがログイン中だけなので、この設定もログイン前提。
              未ログインで空のトグル枠だけ置くと、壊れているようにしか見えない */}
          {!user ? (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <AppIcon name="account-eye-outline" size={20} color={c.sub} style={styles.rowIconView} />
                <Text style={[styles.rowSub, styles.rowTextBlock, { color: c.sub }]}>
                  {language === 'ja'
                    ? 'ログインすると公開プロフィールの見せ方を選べます'
                    : 'Sign in to choose how your public profile is shown.'}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <AppIcon name="account-eye-outline" size={20} color={c.sub} style={styles.rowIconView} />
                <View style={styles.rowTextBlock}>
                  <Text style={[styles.rowLabel, { color: c.text }]}>
                    {language === 'ja' ? '公開デスクをまとめて見せる' : 'List my published desks together'}
                  </Text>
                  <Text style={[styles.rowSub, { color: c.sub }]}>
                    {language === 'ja'
                      // 103。デスクから @ID は外すが、同じ投稿者のデスクだと機械的に突き合わせる手段（user_id）は残る
                      ? 'OFFにすると@IDの公開一覧を隠し、公開デスクにも@IDを表示しません。デスクごとの公開・共有リンクは残り、同じ投稿者のデスクだと分かる場合があります。'
                      : 'Off hides your @ID public list and removes your @ID from published desks. Individual desk links stay published and may still be recognizable as yours.'}
                  </Text>
                </View>
              </View>
              {/* プロフィールが届く前に OFF のトグルを見せると、公開しているのに
                  非公開だと読み違える。届くまではスピナーで待たせる */}
              {discoverable === null
                ? <ActivityIndicator size="small" color={c.sub} />
                : (
                  <ContrastToggle
                    value={discoverable}
                    onValueChange={(on) => { void changeDiscoverable(on) }}
                    disabled={savingDiscoverable}
                    colors={{ accent: ctxColors.accent, text: c.text, textSub: c.sub, textMuted: c.sub, border: c.divider, chip: c.chip }}
                    accessibilityLabel={language === 'ja' ? '公開デスクをまとめて見せる' : 'List my published desks together'}
                  />
                )}
            </View>
          )}
        </View>
        </SettingsGroup>

        <SettingsGroup
          title={language === 'ja' ? 'みんなのデスク' : 'Public desks'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          {user ? (
            <TouchableOpacity style={styles.row} onPress={() => setShowBlocked(true)} activeOpacity={0.7}>
              <View style={styles.rowLeft}>
                <AppIcon name="account-cancel-outline" size={20} color={c.sub} style={styles.rowIconView} />
                <View style={styles.rowTextBlock}>
                  <Text style={[styles.rowLabel, { color: c.text }]}>
                    {language === 'ja' ? 'ブロック中のユーザー' : 'Blocked Users'}
                  </Text>
                  <Text style={[styles.rowSub, { color: c.sub }]}>
                    {language === 'ja' ? 'ブロックを解除すると公開デスクが再び表示されます' : 'Unblock to see their public desks again'}
                  </Text>
                </View>
              </View>
              <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
            </TouchableOpacity>
          ) : (
            <View style={styles.row}>
              <Text style={[styles.rowSub, { color: c.sub }]}>
                {language === 'ja' ? 'ログインするとブロックの管理ができます' : 'Sign in to manage blocked users.'}
              </Text>
            </View>
          )}
        </View>
        </SettingsGroup>

        <SettingsGroup
          title={language === 'ja' ? '計測' : 'Analytics'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <AppIcon name="chart-line" size={20} color={c.sub} style={styles.rowIconView} />
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? '利用状況データを送信' : 'Share usage analytics'}
                </Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja'
                    ? '操作状況・内部ユーザーID・端末情報を送信（入力内容は除外）'
                    : 'Sends usage, internal user ID, and device info (not entered content)'}
                </Text>
              </View>
            </View>
            {loaded ? (
              <ContrastToggle
                value={analyticsConsent}
                onValueChange={(enabled) => {
                  setAnalyticsConsentState(enabled)
                  void setAnalyticsConsent(enabled)
                }}
                colors={{ accent: ctxColors.accent, text: c.text, textSub: c.sub, textMuted: c.sub, border: c.divider, chip: c.chip }}
                accessibilityLabel={language === 'ja' ? '利用状況データを送信' : 'Share usage analytics'}
              />
            ) : <View style={styles.switchPlaceholder} />}
          </View>
        </View>
        </SettingsGroup>
        </>)}

        {/* ── データ（復元・書き出し・ログアウト・アカウント削除） ── */}
        {show('data') && (<>
        <SettingsGroup
          title={language === 'ja' ? 'データ' : 'Data'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          {/* バックアップから復元 */}
          <TouchableOpacity
            style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
            onPress={openRestore}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <AppIcon name="backup-restore" size={20} color={c.sub} style={styles.rowIconView} />
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? 'バックアップから復元' : 'Restore from Backup'}
                </Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {backupReviewPending
                    ? (language === 'ja' ? '復元した内容の確認待ちです。自動保存を停止しています' : 'Review your restored data. Automatic backups are paused.')
                    : planTier === 'pro'
                    ? (language === 'ja'
                      ? `アカウントへ自動保存。直近${BACKUP_GENERATIONS}件から復元（写真は含みません）`
                      : `Saved to your account. Restore from the last ${BACKUP_GENERATIONS} (photos not included)`)
                    : (language === 'ja'
                      ? 'アカウントへ自動保存。最新1件から復元（写真は含みません）'
                      : 'Saved to your account. Restore the latest backup (photos not included)')}
                </Text>
              </View>
            </View>
            <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />
          </TouchableOpacity>

          {user && (
            <TouchableOpacity style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]} onPress={() => { void handleSaveBackup() }} disabled={restoringId != null} activeOpacity={0.7} accessibilityRole="button">
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>{language === 'ja' ? '今すぐバックアップ' : 'Back up now'}</Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja' ? '現在のデスク・ガジェット・AI相談履歴を保存' : 'Save current desks, gadgets and AI conversations'}
                  {lastBackupAt && !Number.isNaN(Date.parse(lastBackupAt))
                    ? (language === 'ja' ? `（前回 ${new Date(lastBackupAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）` : ` (last: ${new Date(lastBackupAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })})`)
                    : ''}
                </Text>
              </View>
              {restoringId === 'save' && <ActivityIndicator size="small" color={c.sub} />}
            </TouchableOpacity>
          )}

          {/* 手元への書き出し。復元はアカウントの中で閉じており、アプリを消すと何も残らない */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => { void runExport() }}
            disabled={exporting}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <AppIcon name="tray-arrow-down" size={20} color={c.sub} style={styles.rowIconView} />
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? 'データを書き出す' : 'Export my data'}
                </Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja'
                    ? 'ガジェット・デスク・AI相談・閲覧履歴を JSON で保存（写真は含みません）'
                    : 'Save gadgets, desks, AI conversations, and viewing history as JSON (photos not included)'}
                </Text>
              </View>
            </View>
            {exporting
              ? <ActivityIndicator size="small" color={c.sub} />
              : <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />}
          </TouchableOpacity>
        </View>
        </SettingsGroup>

        {/* 取り消せない操作なので、他の設定と同じ並びに紛れ込ませず独立して畳む。
            ログインしていない人には出さない。保存先のアカウントが無いので、
            ログアウトは端末のデータを消すだけの操作になっていた */}
        {user && (
        <SettingsGroup
          title={language === 'ja' ? 'アカウントの操作' : 'Account actions'}
          color={c.label}
        >
        <View style={[styles.group, { backgroundColor: c.card }]}>
          {/* ログアウト */}
          <TouchableOpacity
            style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider }]}
            onPress={() =>
              // ログアウトは clearLocalUserData() でこの端末のデスク・ガジェット・
              // 写真・AI履歴を消す（共有端末で次のアカウントに残さないため）。
              //
              Alert.alert(
                language === 'ja' ? 'ログアウト' : 'Log Out',
                language === 'ja'
                  ? 'ログアウト前にデスク・ガジェットを保存し、端末データを削除します。写真は保存されず、元に戻せません。'
                  : 'Saves desks and gadgets, then clears this device. Photos are not backed up or recoverable.',
                [
                  { text: language === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel' },
                  {
                    text: language === 'ja' ? 'ログアウト' : 'Log Out',
                    style: 'destructive',
                    onPress: () => { void runLogOut() },
                  },
                ]
              )
            }
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <AppIcon name={ICONS.logout} size={20} color={c.sub} style={styles.rowIconView} />
              <Text style={[styles.rowLabel, styles.destructiveText, { color: ctxColors.danger }]}>
                {language === 'ja' ? 'ログアウト' : 'Log Out'}
              </Text>
            </View>
          </TouchableOpacity>

          {/* アカウントを削除 */}
          <TouchableOpacity
            style={[styles.row, { opacity: deletingAccount ? 0.55 : 1 }]}
            onPress={handleDeleteAccount}
            disabled={deletingAccount}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <AppIcon name="account-remove-outline" size={20} color={c.sub} style={styles.rowIconView} />
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, styles.destructiveText, { color: ctxColors.danger }]}>{t.deleteAccount}</Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja'
                    ? 'アカウントごと削除します。元に戻せません'
                    : 'Deletes your account itself. This cannot be undone'}
                </Text>
              </View>
            </View>
            {deletingAccount && <ActivityIndicator size="small" color={c.sub} />}
          </TouchableOpacity>
        </View>
        </SettingsGroup>
        )}
        </>)}
      </ScrollView>

      <ProfileEditSheet
        visible={editingProfile}
        onClose={() => setEditingProfile(false)}
        onOpenPublicProfile={(tag) => { if (navigation.isFocused()) navigation.navigate('PublicProfile', { tag }) }}
      />
      <PasswordConfirmationModal email={deletionEmail} onComplete={(password) => {
        const resolve = deletionPasswordResolver.current
        deletionPasswordResolver.current = null
        setDeletionEmail(null)
        resolve?.(password)
      }} />

      {/* ── バックアップからの復元モーダル ── */}
      <Modal
        visible={showRestoreModal}
        animationType={reduceMotion ? 'fade' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={() => { if (!backupOperationRef.current) setShowRestoreModal(false) }}
        onDismiss={showPendingRestoreNotice}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: c.bg }]}>
          <View style={[styles.modalHeader, { backgroundColor: c.card, borderBottomColor: c.divider }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>
              {language === 'ja' ? 'バックアップから復元' : 'Restore from Backup'}
            </Text>
            <TouchableOpacity disabled={restoringId != null} onPress={() => { if (!backupOperationRef.current) setShowRestoreModal(false) }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={language === 'ja' ? '閉じる' : 'Close'}>
              <AppIcon name={ICONS.close} size={22} color={c.sub} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <Text style={[styles.backupNote, { color: c.sub }]}>
              {planTier === 'pro'
                ? (language === 'ja'
                  ? `アプリを開いたときに1日1回まで、直近${BACKUP_GENERATIONS}件を保存します。復元すると、この端末のデスク・ガジェット・履歴は選んだ内容に置き換わります。写真は含まれません。`
                  : `Backups run at most once a day when you open the app, and the latest ${BACKUP_GENERATIONS} are kept. Restoring replaces desks, gadgets, and history on this device. Photos are not included.`)
                : (language === 'ja'
                  ? 'アプリを開いたときに1日1回まで、最新1件を保存します。復元すると端末のデスク・ガジェット・履歴を置き換えます。写真は含まれません。'
                  : 'Backups run at most once a day when you open the app, and the latest one is kept. Restoring replaces desks, gadgets and history on this device. Photos are excluded.')}
            </Text>
            <Text style={[styles.backupNote, { color: c.sub }]}>
              {language === 'ja'
                ? '閲覧履歴も保存します（無料100件／Pro 1,000件、解約前の保有分も維持）。履歴を含まない古いバックアップでは、端末の閲覧履歴を残します。保存コレクションはアカウントに保存され、バックアップの復元では変更されません。'
                : 'Viewing history is backed up (Free: 100 / Pro: 1,000); previously retained history is preserved after downgrading. Older backups without history keep this device’s history. Saved collections are stored in your account and are not changed by restoring a backup.'}
            </Text>

            {backups === null ? (
              <ActivityIndicator style={styles.backupLoading} color={c.sub} />
            ) : backups.length === 0 ? (
              <Text style={[styles.backupEmpty, { color: c.sub }]}>
                {language === 'ja'
                  ? 'まだバックアップがありません。次回の起動時に作成されます。'
                  : 'No backups yet. One will be created the next time you open the app.'}
              </Text>
            ) : (
              <View style={[styles.group, { backgroundColor: c.card }]}>
                {backups.map((b, i) => (
                  <TouchableOpacity
                    key={b.id}
                    style={[
                      styles.row,
                      i < backups.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.divider },
                      restoringId != null && { opacity: 0.55 },
                    ]}
                    onPress={() => { void handleRestore(b) }}
                    disabled={restoringId != null}
                    activeOpacity={0.7}
                  >
                    <View style={styles.rowLeft}>
                      <AppIcon name="cloud-outline" size={20} color={c.sub} style={styles.rowIconView} />
                      <View style={styles.rowTextBlock}>
                        <Text style={[styles.rowLabel, { color: c.text }]}>
                          {new Date(b.created_at).toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US')}
                        </Text>
                        <Text style={[styles.rowSub, { color: c.sub }]}>
                          {[b.device_name, `${Math.max(1, Math.round(b.byte_size / 1024))} KB`]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                    </View>
                    {restoringId === b.id
                      ? <ActivityIndicator size="small" color={c.sub} />
                      : <AppIcon name={ICONS.chevronRight} size={20} color={c.chevron} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {backupReviewPending && (
              <TouchableOpacity style={[styles.group, styles.row, { backgroundColor: c.card }]} onPress={handleConfirmBackup} disabled={restoringId != null} activeOpacity={0.7} accessibilityRole="button">
                <View style={styles.rowTextBlock}>
                  <Text style={[styles.rowLabel, { color: c.text }]}>{language === 'ja' ? 'この内容で自動保存を再開' : 'Resume backup saving with this data'}</Text>
                  <Text style={[styles.rowSub, { color: c.sub }]}>{language === 'ja' ? '確認が済むまでバックアップを保存しません' : 'Backups remain paused until you confirm your data'}</Text>
                </View>
                {restoringId === 'confirm' && <ActivityIndicator size="small" color={c.sub} />}
              </TouchableOpacity>
            )}
            {canUndoRestore && (
              <TouchableOpacity
                style={[styles.group, styles.row, { backgroundColor: c.card }]}
                onPress={handleUndoRestore}
                disabled={restoringId != null}
                activeOpacity={0.7}
              >
                <View style={styles.rowLeft}>
                  <AppIcon name="undo" size={20} color={c.sub} style={styles.rowIconView} />
                  <View style={styles.rowTextBlock}>
                    <Text style={[styles.rowLabel, { color: c.text }]}>
                      {language === 'ja' ? '復元前の状態に戻す' : 'Undo restoration'}
                    </Text>
                    <Text style={[styles.rowSub, { color: c.sub }]}>
                      {language === 'ja' ? '復元する前の状態に戻します' : 'Go back to the state before the restore'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── フィードバックモーダル ── */}
      <Modal
        visible={feedbackOpen}
        animationType={reduceMotion ? 'fade' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={closeFeedback}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: c.bg }]}>
          <View style={[styles.modalHeader, { backgroundColor: c.card, borderBottomColor: c.divider }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>
              {language === 'ja' ? 'ご意見・不具合を送る' : 'Send feedback'}
            </Text>
            <TouchableOpacity onPress={closeFeedback} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={language === 'ja' ? '閉じる' : 'Close'}>
              <AppIcon name={ICONS.close} size={22} color={c.sub} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={styles.modalBody} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.pwLabel, { color: c.label }]}>
              {language === 'ja' ? '種類' : 'Type'}
            </Text>
            <View style={[styles.feedbackTabs, { backgroundColor: c.chip }]}>
              {([
                { key: 'bug',     ja: '不具合', en: 'Bug' },
                { key: 'request', ja: '要望',   en: 'Request' },
                { key: 'other',   ja: 'その他', en: 'Other' },
              ] as const).map((item) => {
                const on = feedbackCategory === item.key
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.feedbackTab, on && { backgroundColor: ctxColors.accent }]}
                    onPress={() => setFeedbackCategory(item.key)}
                    activeOpacity={0.85}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                  >
                    <Text style={[styles.feedbackTabText, { color: on ? ctxColors.onAccent : c.sub }]}>
                      {language === 'ja' ? item.ja : item.en}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={[styles.pwLabel, { color: c.label, marginTop: 18 }]}>
              {language === 'ja' ? '内容' : 'Details'}
            </Text>
            <TextInput
              style={[styles.feedbackInput, { backgroundColor: c.input, borderColor: ctxColors.inputBorder, color: c.text }]}
              value={feedbackBody}
              onChangeText={(text) => setFeedbackBody(truncateChars(text, FEEDBACK_MAX_LENGTH))}
              multiline
              textAlignVertical="top"
              placeholder={language === 'ja'
                ? {
                  bug: '例：配線図でモニターの線が消える。iPhone 15 Pro で発生します。',
                  request: '例：機材の保証期限も記録できるようにしてほしいです。',
                  other: '例：デスク作成の案内で、次に何をするか分かりにくかったです。',
                }[feedbackCategory]
                : {
                  bug: 'e.g. The monitor cable disappears in the wiring map on iPhone 15 Pro.',
                  request: 'e.g. I would like to track warranty expiry dates for my gear.',
                  other: 'e.g. The desk setup guide did not make the next step clear.',
                }[feedbackCategory]}
              placeholderTextColor={c.valueText}
              maxLength={FEEDBACK_MAX_LENGTH}
            />
            <Text style={[styles.feedbackCount, { color: c.valueText }]}>
              {feedbackBody.length} / {FEEDBACK_MAX_LENGTH}
            </Text>

            {/* 返信できず聞き返せないので、何をしていたかはこれが唯一の手がかりになる。
                ただし利用状況データなので、解析をオフにしている人にも毎回ここで選ばせる */}
            <View style={styles.feedbackAttachRow}>
              <View style={styles.rowTextBlock}>
                <Text style={[styles.rowLabel, { color: c.text }]}>
                  {language === 'ja' ? '直前の操作を添付する' : 'Attach recent activity'}
                </Text>
                <Text style={[styles.rowSub, { color: c.sub }]}>
                  {language === 'ja'
                    ? '直近に開いた画面と、起きたエラーの種類（最大30件）。入力内容は含みません'
                    : 'Screens you opened and error types (up to 30). Never what you typed'}
                </Text>
              </View>
              <ContrastToggle
                value={feedbackAttachTrail}
                onValueChange={setFeedbackAttachTrail}
                colors={{ accent: ctxColors.accent, text: c.text, textSub: c.sub, textMuted: c.sub, border: c.divider, chip: c.chip }}
                accessibilityLabel={language === 'ja' ? '直前の操作を添付する' : 'Attach recent activity'}
              />
            </View>

            <Text style={[styles.feedbackNote, { color: c.valueText }]}>
              {language === 'ja'
                ? '入力内容・不具合の種類・アカウントID・端末とアプリの情報を送ります。氏名・メール・デスク内容は送りません。個別返信はできません。'
                : 'We send your message, issue type, account ID, and device and app info. Name, email and desk data are excluded. We cannot reply individually.'}
            </Text>

          </ScrollView>
          <View style={[styles.modalActionBar, { backgroundColor: c.card, borderTopColor: c.divider }]}>
            <TouchableOpacity
              style={[
                styles.feedbackSend,
                { backgroundColor: ctxColors.accent, opacity: feedbackBody.trim() && !feedbackSending ? 1 : 0.4 },
              ]}
              onPress={sendFeedback}
              disabled={!feedbackBody.trim() || feedbackSending}
              activeOpacity={0.85}
            >
              <Text style={[styles.feedbackSendText, { color: ctxColors.onAccent }]}>
                {feedbackSending
                  ? (language === 'ja' ? '送信中…' : 'Sending…')
                  : (language === 'ja' ? '送信する' : 'Send')}
              </Text>
            </TouchableOpacity>
          </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── パスワード変更モーダル ── */}
      <Modal
        visible={showPwModal}
        animationType={reduceMotion ? 'fade' : 'slide'}
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPwModal(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: c.bg }]}>
          <View style={[styles.modalHeader, { backgroundColor: c.card, borderBottomColor: c.divider }]}>
            <Text style={[styles.modalTitle, { color: c.text }]}>
              {language === 'ja' ? 'パスワードを変更' : 'Change Password'}
            </Text>
            <TouchableOpacity onPress={() => setShowPwModal(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={language === 'ja' ? '閉じる' : 'Close'}>
              <AppIcon name={ICONS.close} size={22} color={c.sub} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={styles.modalBody} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <Text style={[styles.pwLabel, { color: c.label }]}>
              {language === 'ja' ? '現在のパスワード' : 'Current Password'}
            </Text>
            <TextField
              value={currentPw}
              onChangeText={setCurrentPw}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="••••••"
              returnKeyType="next"
              // blurOnSubmit を切らないと、次の欄へ移す前にキーボードが一度閉じて開き直す
              blurOnSubmit={false}
              onSubmitEditing={() => newPwRef.current?.focus()}
            />

            <Text style={[styles.pwLabel, { marginTop: 16, color: c.label }]}>
              {language === 'ja' ? '新しいパスワード（6文字以上）' : 'New Password (min 6 chars)'}
            </Text>
            <TextField
              ref={newPwRef}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              passwordRules="minlength: 6;"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="••••••"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => confirmPwRef.current?.focus()}
            />

            <Text style={[styles.pwLabel, { marginTop: 16, color: c.label }]}>
              {language === 'ja' ? '新しいパスワード（確認）' : 'Confirm New Password'}
            </Text>
            <TextField
              ref={confirmPwRef}
              value={confirmPw}
              onChangeText={setConfirmPw}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="••••••"
              returnKeyType="done"
              onSubmitEditing={handleChangePassword}
            />

            {!!pwError && <Text style={[styles.pwError, { color: ctxColors.danger }]}>{pwError}</Text>}

          </ScrollView>
          <View style={[styles.modalActionBar, { backgroundColor: c.card, borderTopColor: c.divider }]}>
            <TouchableOpacity style={[styles.pwSaveBtn, { backgroundColor: ctxColors.accent, opacity: changingPassword ? 0.55 : 1 }]} onPress={handleChangePassword} disabled={changingPassword} activeOpacity={0.85}>
              {changingPassword
                ? <ActivityIndicator size="small" color={ctxColors.onAccent} />
                : <Text style={[styles.pwSaveBtnText, { color: ctxColors.onAccent }]}>{language === 'ja' ? '変更する' : 'Save'}</Text>}
            </TouchableOpacity>
          </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── ブロック中のユーザー ── */}
      <BlockedUsersModal visible={showBlocked} onClose={() => setShowBlocked(false)} />
      {user && passkeyAvailable && <PasskeySettingsSheet key={user.id} visible={showPasskeys} userId={user.id} onClose={() => setShowPasskeys(false)} />}
      <ExploreHelpSheet visible={exploreHelpOpen} onDismiss={() => setExploreHelpOpen(false)} context="all" />
      <WorkspaceHelpSheet visible={workspaceHelpOpen} onDismiss={() => setWorkspaceHelpOpen(false)} context="all" />

      <Toast
        visible={toast !== null}
        message={toast ?? ''}
        backgroundColor={ctxColors.text}
        textColor={ctxColors.card}
        bottomOffset={40}
      />
    </SafeAreaView>
  )
}

// ─── 共通コンポーネント ──────────────────────────

function SectionLabel({ title, color }: { title: string; color: string }) {
  return <Text style={[styles.sectionLabel, { color }]}>{title}</Text>
}

/**
 * 設定セクションの中の 1 まとまり。
 * ハブでジャンルを分けたあとの 1 画面には数項目しか無く、そこをさらに畳むと
 * 見出しを開く操作が挟まるだけで探す手数が増える（iOS 標準の設定も畳まない）。
 */
function SettingsGroup({ title, color, children }: {
  title: string
  color: string
  children: React.ReactNode
}) {
  return (
    <>
      <SectionLabel title={title} color={color} />
      {children}
    </>
  )
}

function SettingsChoiceList<T extends string | number>({
  value,
  options,
  onChange,
  colors,
  accent,
}: {
  value: T
  options: { value: T; label: string; help?: string }[]
  onChange: (value: T) => void | Promise<void>
  colors: ReturnType<typeof getC>
  accent: string
}) {
  const selectedRef = useRef(value)
  selectedRef.current = value
  return (
    <View style={[styles.choiceList, { backgroundColor: colors.chip }]}>
      {options.map((option, index) => (
        <TouchableOpacity
          key={String(option.value)}
          style={[
            styles.choiceRow,
            option.help && styles.choiceRowWithHelp,
            index < options.length - 1 && {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.divider,
            },
          ]}
          onPress={() => {
            if (selectedRef.current !== option.value) hapticSelection()
            selectedRef.current = option.value
            void onChange(option.value)
          }}
          activeOpacity={0.6}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === option.value }}
          accessibilityHint={option.help}
        >
          <View style={styles.choiceTextWrap}>
            <Text
              style={[styles.choiceLabel, { color: colors.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {option.label}
            </Text>
            {option.help && (
              <Text
                style={[styles.choiceHelp, { color: colors.sub }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
              >
                {option.help}
              </Text>
            )}
          </View>
          {value === option.value && <AppIcon name={ICONS.check} size={20} color={accent} />}
        </TouchableOpacity>
      ))}
    </View>
  )
}

function PlanCard({
  currentTier,
  onUpgrade,
  language,
}: {
  currentTier: PlanTier
  onUpgrade: () => void
  language: Language
}) {
  const { colors: planColors } = useApp()
  const info = PLAN_INFO[currentTier]
  // Pro は accentText（中立背景の上の文字）、Free は控えめに
  const tierColor = currentTier === 'pro' ? planColors.accentText : planColors.textMuted
  const isUpgradable = currentTier === 'free'
  // Pro の表示価格は契約中の商品から引く（月額/年額のどちらか、通貨もストアフロント依存）
  const { customerInfo, packages } = useSubscription()
  const { priceOf } = usePlanPricing()
  const activePlan = PAYWALL_PLANS.find((p) => isPlanActive(customerInfo, p, packages))
  const priceLabel = currentTier === 'free'
    ? (language === 'ja' ? '無料' : 'Free')
    : activePlan
      ? (language === 'ja' ? `${priceOf(activePlan)}${activePlan.periodJa}` : `${priceOf(activePlan)} ${activePlan.periodEn}`)
      : null
  const statusLabel = subscriptionStatusLabel(customerInfo, currentTier, language)

  return (
    <TouchableOpacity
      style={[
        styles.planCard,
        // Free の枠を文字色（textMuted）の 1.5pt で囲むと、灰色の太枠が設定画面でいちばん目立つ面になる
        { borderColor: currentTier === 'pro' ? tierColor : planColors.border, backgroundColor: planColors.card },
      ]}
      onPress={onUpgrade}
      activeOpacity={0.85}
    >
      <View style={styles.planCardLeft}>
        {/* Free の印（空の丸）はラジオボタンに読まれ、押すと切り替わるように見えたので出さない */}
        {currentTier === 'pro' && <AppIcon name={info.icon} size={26} color={planColors.textMuted} />}
        <View style={styles.planCardText}>
          <Text style={[styles.planCardName, { color: tierColor }]}>
            {language === 'ja' ? `${info.label} プラン` : `${info.label} Plan`}
          </Text>
          {priceLabel ? (
            <Text style={[styles.planCardPrice, { color: planColors.textMuted }]}>
              {priceLabel}
            </Text>
          ) : null}
          {statusLabel ? (
            <Text style={[styles.planCardStatus, { color: planColors.textMuted }]}>
              {statusLabel}
            </Text>
          ) : null}
        </View>
      </View>
      {isUpgradable ? (
        // Free の tierColor（textMuted）で描くと無効なボタンに見える。課金への入口なので accent で塗る
        <View style={[styles.upgradeChip, { backgroundColor: planColors.accent, borderColor: planColors.accent }]}>
          <Text style={[styles.upgradeChipText, { color: planColors.onAccent }]}>{language === 'ja' ? 'アップグレード' : 'Upgrade'}</Text>
        </View>
      ) : (
        <View style={[styles.upgradeChip, { backgroundColor: tierColor + '22', borderColor: tierColor }]}>
          <Text style={[styles.upgradeChipText, { color: tierColor }]}>{language === 'ja' ? 'プランを変更' : 'Change plan'}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

// ─── スタイル ────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 48 },
  sectionScroll: { paddingTop: 16 },
  accountSectionScroll: { paddingTop: 0 },

  saveBtnText: { fontSize: 13, fontWeight: '600' },

  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  group: {
    marginHorizontal: 16,
    borderRadius: UI_METRICS.cardRadius,
    overflow: 'hidden',
  },
  accountGroup: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // 行の左の分類アイコンは角丸四角。器の形は行が押せるかとは別で、押せるのは行全体
  settingsRowIcon: { width: 38, height: 38, borderRadius: UI_METRICS.controlRadius, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 16,
    minHeight: UI_METRICS.rowMinHeight,
  },
  settingBlock: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 10,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  rowIconView: { width: 28, alignItems: 'center' },
  rowLabel: { fontSize: 16 },
  // 上下の余白はリンクの押せる高さで取る
  authRow: { paddingVertical: 3 },
  authLinks: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  // 文字だけのリンクでも押せる高さを確保する
  authLink: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center' },
  authLinkText: { fontWeight: '600' },
  rowSub: { fontSize: 12, marginTop: 2 },
  // 2行構成の行で、右端のアイコンに文字を押し出させないための伸縮枠
  rowTextBlock: { flex: 1 },
  backupNote: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  backupLoading: { marginTop: 24 },
  backupEmpty: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 24 },
  destructiveText: { fontSize: 16 },
  rowValue: { fontSize: 15 },

  emailInput: {
    marginTop: 4,
    minWidth: 160,
  },


  choiceList: {
    marginLeft: 40,
    borderRadius: UI_METRICS.controlRadius,
    overflow: 'hidden',
  },
  choiceRow: {
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  choiceRowWithHelp: { minHeight: 54 },
  choiceTextWrap: { flex: 1, minWidth: 0 },
  choiceLabel: { fontSize: 15 },
  // height で固定すると、文字を大きくしている端末で行の高さだけ拡大されて下が切れる
  choiceHelp: { minHeight: 14, lineHeight: 14, fontSize: 11, marginTop: 2 },

  swatchRow: { flexDirection: 'row', gap: 12, marginTop: 10, flexWrap: 'wrap' },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: {
    borderWidth: 2.5,
  },
  proBadge: {
    marginLeft: 8,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  proBadgeText: { fontSize: 10, fontWeight: '700' },

  footerText: { textAlign: 'center', fontSize: 12, marginTop: 32 },
  legalLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  legalLink: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center', paddingHorizontal: 8 },
  legalLinkText: { fontSize: 12, textDecorationLine: 'underline' },
  legalSeparator: { fontSize: 12 },
  switchPlaceholder: { width: 51, height: 31 },

  // ─── 設定の入口リスト ───
  // 画面幅いっぱいに敷く。角丸のカードにすると、上のプロフィール・統計と同じ
  // 「読むもの」に見えてしまい、たどる場所だと分かりにくくなる
  settingsListGroup: {
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingsListRow: {
    minHeight: 64, flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, gap: 12,
  },
  settingsListIcon: { width: 24 },
  settingsListText: { flex: 1, minWidth: 0, gap: 2 },
  settingsListTitle: { fontSize: 15, fontWeight: '600' },
  settingsListDescription: { fontSize: 12, lineHeight: 17 },

  faqAnswer: { fontSize: 13, lineHeight: 20, paddingHorizontal: 16, paddingBottom: 14, marginTop: -4 },

  // ─── プランカード ───
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    borderRadius: UI_METRICS.cardRadius,
    borderWidth: 1.5,
    padding: 14,
    gap: 12,
  },
  // トライアル中・自動更新オフの状態文は長い。縮めないと右の「プランを変更」がカードの外へ押し出される
  planCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  planCardText: { flexShrink: 1 },
  planCardName: { fontSize: 16, fontWeight: '700' },
  planCardPrice: { fontSize: 13, marginTop: 1 },
  planCardStatus: { fontSize: 12, marginTop: 2 },
  upgradeChip: {
    borderWidth: 1,
    borderRadius: UI_METRICS.sheetRadius,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  upgradeChipText: { fontSize: 13, fontWeight: '600' },

  // ─── モーダル ───
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalScroll: { padding: UI_METRICS.screenGutter, paddingBottom: 40 },
  modalBody: { flex: 1 },
  modalActionBar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: UI_METRICS.screenGutter, paddingTop: 10, paddingBottom: 10 },




  pwLabel: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  feedbackTabs: { flexDirection: 'row', borderRadius: UI_METRICS.controlRadius, padding: 4, gap: 4 },
  feedbackTab: { flex: 1, borderRadius: UI_METRICS.chipRadius, paddingVertical: 9, alignItems: 'center' },
  feedbackTabText: { fontSize: 14, fontWeight: '700' },
  feedbackInput: { minHeight: 150, borderWidth: 1, borderRadius: UI_METRICS.controlRadius, paddingHorizontal: 12, ...multilineInputText({ fontSize: 15, lineHeight: 21, paddingTop: 12, paddingBottom: 12 }, Platform.OS) },
  feedbackCount: { fontSize: 11, textAlign: 'right', marginTop: 6 },
  feedbackAttachRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  feedbackNote: { fontSize: 11, lineHeight: 17, marginTop: 14 },
  feedbackSend: { borderRadius: UI_METRICS.controlRadius, paddingVertical: 14, alignItems: 'center' },
  feedbackSendText: { fontSize: 15, fontWeight: '700' },
  pwError: { fontSize: 13, marginTop: 10 },
  pwSaveBtn: {
    borderRadius: UI_METRICS.controlRadius,
    paddingVertical: 14,
    alignItems: 'center',
  },
  pwSaveBtnText: { fontSize: 16, fontWeight: '700' },
})
