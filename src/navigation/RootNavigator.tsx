import { Alert } from '../utils/alert'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Ionicons from '@expo/vector-icons/Ionicons'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import * as NativeSplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { BottomTabNavigationProp, createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { CommonActions, NavigationContainer, StackActions, createNavigationContainerRef, getStateFromPath as defaultGetStateFromPath } from '@react-navigation/native'
import { RouteProp } from '@react-navigation/native'
import type { PathConfig } from '@react-navigation/native'
import { createNativeStackNavigator, NativeStackHeaderProps } from '@react-navigation/native-stack'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, InteractionManager, Linking, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { BrandSplash } from '../components/molecules/BrandSplash'
import { AlertHost } from '../components/organisms/AlertHost'
import { OnboardingIntro } from '../components/molecules/OnboardingIntro'
import { AppStackHeader } from '../components/molecules/AppStackHeader'
import { withScreenBoundary } from '../components/molecules/ErrorContainment'
import { AppIcon } from '../components/atoms/AppIcon'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { notifyTutorialInteraction } from '../components/molecules/TutorialBubble'
import { SpotlightOverlay } from '../components/organisms/SpotlightOverlay'
import { SPOTLIGHT_DONE_KEY, SPOTLIGHT_PROGRESS_KEY, SPOTLIGHT_STEP_KEY, TUTORIAL_SEEN_KEY, SpotlightProvider, useSpotlight } from '../context/SpotlightContext'
import { ICONS, TAB_ICONS, TAB_ICONS_SELECTED } from '../constants/icons'
import { UI_METRICS } from '../constants/ui'
import { useDeskUpdateBell } from '../hooks/useDeskUpdateBell'
import { PUBLIC_URL_BASE } from '../constants/plans'
import { isParsableLinkPath, isTrustedAppLink, normalizeShareLinkPath } from '../utils/shareLinkPath'
import { buildNavigationTheme } from './navigationTheme'
import { AppProvider, useApp } from '../context/AppContext'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { SubscriptionProvider } from '../context/SubscriptionContext'
import { preloadGadgets } from '../hooks/useGadgets'
import { preloadPlans } from '../hooks/usePlans'
import { BackupNotice, reconcileAccountData, recoverInterruptedRestore, runAutoBackupIfDue, subscribeBackupRecoveryFailure, takeBackupNotice } from '../services/backupService'
import { clearLocalUserData } from '../utils/clearLocalUserData'
import { AddGadgetScreen } from '../screens/AddGadgetScreen'
import { AICoachListScreen } from '../screens/AICoachListScreen'
import { AICoachChatScreen } from '../screens/AICoachChatScreen'
import { GadgetDetailScreen } from '../screens/GadgetDetailScreen'
import { GadgetSelectionScreen } from '../screens/GadgetSelectionScreen'
import { GadgetStatsScreen } from '../screens/GadgetStatsScreen'
import { FollowingListScreen } from '../screens/FollowingListScreen'
import { LoginScreen } from '../screens/LoginScreen'
import { MyPageScreen } from '../screens/MyPageScreen'
import { OnboardingScreen } from '../screens/OnboardingScreen'
import { PublicTagSetupModal } from '../components/organisms/PublicTagSetupModal'
import { PaywallScreen } from '../screens/PaywallScreen'
import { DeskFeedScreen } from '../screens/DeskFeedScreen'
import { DeskUpdatesScreen } from '../screens/DeskUpdatesScreen'
import { DeskPlacementScreen } from '../screens/DeskPlacementScreen'
import { PlanListScreen } from '../screens/PlanListScreen'
import { PhotoFillScreen } from '../screens/PhotoFillScreen'
import { ConnectionMethodScreen } from '../screens/ConnectionMethodScreen'
import { ProductFillScreen } from '../screens/ProductFillScreen'
import { PublicDeskScreen } from '../screens/PublicDeskScreen'
import { BrandProductsScreen } from '../screens/BrandProductsScreen'
import { PublicProfileScreen } from '../screens/PublicProfileScreen'
import { PurposeSelectionScreen } from '../screens/PurposeSelectionScreen'
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen'
import { TemplateDetailScreen } from '../screens/TemplateDetailScreen'
import { SettingsScreen, settingsSectionTitle } from '../screens/SettingsScreen'
import { WiringResultScreen } from '../screens/WiringResultScreen'
import { isOnboardingDone, markOnboardingDone } from '../store/planStore'
import { FeedStackParamList, MainTabsParamList, MyPageStackParamList, PlanStackParamList, RootStackParamList } from '../types'
import { analytics, EVENTS, recordAttributionFromUrl } from '../services/analytics'
import * as Notifications from 'expo-notifications'
import { notificationUrl, registerPushToken } from '../services/pushNotifications'
import { completePasswordRecovery, EMAIL_CHANGE_PATH, isAuthCallback, refreshAfterEmailChange, RESET_PASSWORD_PATH } from '../services/auth'
import { BOOT_DATA_TIMEOUT_MS, isBootReady, MIN_BRAND_SPLASH_MS } from '../utils/bootGate'
import { warmUpConnectionMaps } from '../utils/mapWarmup'
import { parseSpotlightProgress, resolveSpotlightResume } from '../utils/spotlightProgress'
import { loginResumeFrom, type LoginResume } from '../utils/loginResume'
import { withTimeout } from '../utils/networkError'
import { recordScreen } from '../utils/diagnosticTrail'
import { hapticSelection } from '../utils/haptics'

// 画面ごとの描画エラーの境界（components/molecules/ErrorContainment.tsx）。1画面が落ちても
// アプリ全体を巻き込まず、戻る・他のタブを使う道を残す。描画のたびに作り直さないようここで1度だけ包む
const guarded = {
  AICoachChatScreen: withScreenBoundary(AICoachChatScreen, 'AICoachChat'),
  AICoachListScreen: withScreenBoundary(AICoachListScreen, 'AICoachList'),
  AddGadgetScreen: withScreenBoundary(AddGadgetScreen, 'AddGadget'),
  BrandProductsScreen: withScreenBoundary(BrandProductsScreen, 'BrandProducts'),
  ConnectionMethodScreen: withScreenBoundary(ConnectionMethodScreen, 'ConnectionMethod'),
  DeskFeedScreen: withScreenBoundary(DeskFeedScreen, 'DeskFeed'),
  DeskPlacementScreen: withScreenBoundary(DeskPlacementScreen, 'DeskPlacement'),
  DeskUpdatesScreen: withScreenBoundary(DeskUpdatesScreen, 'DeskUpdates'),
  FollowingListScreen: withScreenBoundary(FollowingListScreen, 'FollowingList'),
  GadgetDetailScreen: withScreenBoundary(GadgetDetailScreen, 'GadgetDetail'),
  GadgetSelectionScreen: withScreenBoundary(GadgetSelectionScreen, 'GadgetSelection'),
  GadgetStatsScreen: withScreenBoundary(GadgetStatsScreen, 'GadgetStats'),
  LoginScreen: withScreenBoundary(LoginScreen, 'Login'),
  MyPageScreen: withScreenBoundary(MyPageScreen, 'MyPage'),
  OnboardingScreen: withScreenBoundary(OnboardingScreen, 'Onboarding'),
  PaywallScreen: withScreenBoundary(PaywallScreen, 'Paywall'),
  PhotoFillScreen: withScreenBoundary(PhotoFillScreen, 'PhotoFill'),
  PlanListScreen: withScreenBoundary(PlanListScreen, 'PlanList'),
  ProductFillScreen: withScreenBoundary(ProductFillScreen, 'ProductFill'),
  PublicDeskScreen: withScreenBoundary(PublicDeskScreen, 'PublicDesk'),
  PublicProfileScreen: withScreenBoundary(PublicProfileScreen, 'PublicProfile'),
  PurposeSelectionScreen: withScreenBoundary(PurposeSelectionScreen, 'PurposeSelection'),
  ResetPasswordScreen: withScreenBoundary(ResetPasswordScreen, 'ResetPassword'),
  SettingsScreen: withScreenBoundary(SettingsScreen, 'Settings'),
  TemplateDetailScreen: withScreenBoundary(TemplateDetailScreen, 'TemplateDetail'),
  WiringResultScreen: withScreenBoundary(WiringResultScreen, 'WiringResult'),
}

const Root        = createNativeStackNavigator<RootStackParamList>()
const Tab         = createBottomTabNavigator<MainTabsParamList>()
const PlanStack   = createNativeStackNavigator<PlanStackParamList>()
const FeedStack   = createNativeStackNavigator<FeedStackParamList>()
const MyPageStack = createNativeStackNavigator<MyPageStackParamList>()
const navigationRef = createNavigationContainerRef<RootStackParamList>()
let currentScreenName: string | undefined

if (Platform.OS !== 'web') {
  void NativeSplashScreen.preventAutoHideAsync().catch(() => {})
}

const localizedStackOptions = (colors: ReturnType<typeof useApp>['colors'], lang: 'ja' | 'en', reduceMotion: boolean) =>
  ({ navigation, route }: { navigation: { getState: () => { routes: { key: string }[] }; goBack: () => void; isFocused: () => boolean }; route: { key: string } }) => {
  const hasBackInStack = navigation.getState().routes.findIndex((r) => r.key === route.key) > 0
  return {
    gestureEnabled: true,
    animation: reduceMotion ? 'fade' as const : 'slide_from_right' as const,
    // 関数として渡さず要素として描く。native-stack は header(props) を素の関数として呼ぶので、
    // AppStackHeader の useState が呼び出し側の hook になる。Web では全画面の header を1つの
    // コンポーネントで呼ぶため、画面を積むたびに hook の数が増えて落ちていた
    // （iOS でも headerShown を途中で切り替える画面ができると同じ形で落ちる）
    header: (props: NativeStackHeaderProps) => <AppStackHeader {...props} />,
    headerStyle: { backgroundColor: colors.header },
    headerTintColor: colors.text,
    headerTitleAlign: 'center' as const,
    headerBackTitle: '',
    headerBackTitleVisible: false,
    // canGoBack() は親ナビゲーターまで見るため、タブ先頭でも true になる。
    // このスタック内でこの画面の下に戻り先がある場合だけ表示する。
    // スタックの index（今の最前面）で見ると、上に画面を積んだ瞬間に下の画面のヘッダーにも
    // 戻るが出て、押した直後のタブ先頭（マイページ等）に一瞬ボタンが現れていた。
    // 先頭では headerBackVisible も切り、AppStackHeader が Root の戻り先を引き継いで出すのも止める
    headerBackVisible: hasBackInStack,
    headerLeft: hasBackInStack
      ? () => (
          <HeaderIconButton
            name={ICONS.chevronLeft}
            size={25}
            circular
            color={colors.text}
            onPress={() => { if (navigation.isFocused()) navigation.goBack() }}
            accessibilityLabel={lang === 'ja' ? '戻る' : 'Back'}
          />
        )
      : undefined,
  }
}

/**
 * 他人のデスク・プロフィールは Root ではなく3つのタブのスタックすべてに積む
 * （理由は types の PublicStackParamList の注記）。Navigator ごとに Screen の型が
 * 違うので要素そのものは共通化できない。options だけここに置いて、3箇所で同じものを使う。
 *
 * 戻るボタン・ヘッダーの地色はスタックの screenOptions（localizedStackOptions）が持つ。
 * Root に積んでいた頃は Root.Navigator が headerShown: false だったため、
 * ここで headerShown と戻るの指定を画面ごとに書き足していた。
 */
const publicDeskOptions = (lang: 'ja' | 'en') => ({ title: lang === 'en' ? 'Desk details' : 'デスク詳細' })
const publicProfileOptions = (lang: 'ja' | 'en') => ({ title: lang === 'en' ? 'Profile' : 'プロフィール' })
const brandProductsOptions = { title: '' }

// 最後のナビゲーションの状態。ログインするとナビゲーションごと外れるので、ログイン後に戻す先は
// ここから決める（RootNavigatorInner の resumeAfterLogin）
let lastRootState: ReturnType<typeof navigationRef.getRootState> | undefined
function trackCurrentScreen() {
  lastRootState = navigationRef.getRootState()
  const name = navigationRef.getCurrentRoute()?.name
  if (!name || name === currentScreenName) return
  currentScreenName = name
  recordScreen(name)
  analytics.screen(name)
}

/**
 * すでに開いているタブをもう一度タップしたら、そのタブのスタックを先頭まで戻す。
 * bottom-tabs の既定はフォーカス済みタブの再タップで何もしない（BottomTabBar が
 * `if (!focused)` でしか navigate を投げない）ため、自前で popToTop する。
 * どのタブも同じ挙動にしておかないと「タブを叩けば一覧に戻れる」という予想が外れる。
 */
const popToTopOnTabPress = ({ navigation, route }: {
  navigation: BottomTabNavigationProp<MainTabsParamList>
  route: RouteProp<MainTabsParamList>
}) => ({
  tabPress: (event: { preventDefault: () => void }) => {
    const tabState = navigation.getState()
    const currentTab = tabState.routes[tabState.index]
    if (currentTab?.key !== route.key) {
      // 標準のタブバーは描画時の focused を使うため、再描画前の往復を取りこぼす。
      event.preventDefault()
      hapticSelection()
      navigation.dispatch({ ...CommonActions.navigate({ name: route.name, merge: true }), target: tabState.key })
      return
    }
    // タブ内スタックの状態。まだ描画されていないタブは state を持たない。
    // 復元直後は key を持たない PartialState で来るので、そのときは何もしない
    const stackState = tabState.routes.find((item) => item.key === route.key)?.state
    if (!stackState || !stackState.key || stackState.index === 0) return
    hapticSelection()
    event.preventDefault()
    navigation.dispatch({ ...StackActions.popToTop(), target: stackState.key })
  },
})

// 進捗バーで前の段へ戻ったときは、置き換えでも左から戻ってくる動きにする（setupStepNavigation.ts）
function setupReplaceAnimation(params?: { setupBack?: true }): 'push' | 'pop' {
  return params?.setupBack ? 'pop' : 'push'
}

function PlanNavigator() {
  const { colors, lang, reduceMotion } = useApp()
  return (
    <PlanStack.Navigator
      // デスクづくりは用途 → テンプレート → 配線図と一方向に進む導線なので、
      // 「右から次の画面が来る」ことで進行方向を見せる。
      screenOptions={localizedStackOptions(colors, lang, reduceMotion)}
    >
      {/* 手持ち機材の一覧はマイページの「ガジェット」タブへ移した。ここに入口を残すと
          同じ画面への導線が2つになる（持ち物＝マイページ、に寄せる） */}
      <PlanStack.Screen name="PlanList"        component={guarded.PlanListScreen}
        options={{ title: lang === 'en' ? 'MyDesk' : 'マイデスク' }} />
      <PlanStack.Screen name="PurposeSelection" component={guarded.PurposeSelectionScreen} options={({ route }) => ({ title: lang === 'en' ? 'Purposes' : 'デスクの用途', animationTypeForReplace: setupReplaceAnimation(route.params) })} />
      <PlanStack.Screen name="GadgetSelection" component={guarded.GadgetSelectionScreen} options={({ route }) => ({ title: lang === 'en' ? 'Select Gadgets' : 'ガジェットを選択', animationTypeForReplace: setupReplaceAnimation(route.params) })} />
      <PlanStack.Screen name="DeskPlacement"   component={guarded.DeskPlacementScreen}   options={({ route }) => ({ title: lang === 'en' ? 'Arrange Desk' : '配置を決める', animationTypeForReplace: setupReplaceAnimation(route.params) })} />
      <PlanStack.Screen name="WiringResult"    component={guarded.WiringResultScreen}    options={publicDeskOptions(lang)} />
      <PlanStack.Screen name="GadgetDetail"    component={guarded.GadgetDetailScreen} options={{ title: lang === 'en' ? 'Edit' : '編集' }} />
      {/* デスクづくりの途中からのガジェット登録。ガジェットタブへ飛ばすと保存後の
          goBack がマイガジェット一覧に着地し、作りかけのデスクへ戻れなくなるため、
          GadgetDetail と同じくデスクのスタック内で開く（戻る＝元の画面に戻る） */}
      <PlanStack.Screen name="AddGadget"       component={guarded.AddGadgetScreen}    options={({ route }) => ({ title: route.params?.showCategoryPicker && !route.params?.category ? (lang === 'en' ? 'Choose a category' : 'ジャンルを選択') : (lang === 'en' ? 'Add Gadget' : 'ガジェットを追加') })} />
      <PlanStack.Screen name="PhotoFill"       component={guarded.PhotoFillScreen}       options={{ title: lang === 'en' ? 'Add Photos' : '写真を追加' }} />
      <PlanStack.Screen name="ProductFill"     component={guarded.ProductFillScreen}     options={{ title: lang === 'en' ? 'Add Products' : '商品を登録' }} />
      <PlanStack.Screen name="ConnectionMethod" component={guarded.ConnectionMethodScreen} options={{ title: lang === 'en' ? "How it's connected" : 'つなぎ方' }} />
      <PlanStack.Screen name="TemplateDetail"  component={guarded.TemplateDetailScreen}  options={({ route }) => ({ title: lang === 'en' ? 'Gear Details' : '機材の設定', animationTypeForReplace: setupReplaceAnimation(route.params) })} />
      <PlanStack.Screen name="AICoachChat"     component={guarded.AICoachChatScreen}     options={{ title: lang === 'en' ? 'AI Coach' : 'AIコーチ' }} />
      <PlanStack.Screen name="AICoachList"     component={guarded.AICoachListScreen}     options={{ title: lang === 'en' ? 'Chat History' : '相談履歴' }} />
      {/* 機材から「このガジェットを使っている人のデスク」を開く導線がある */}
      <PlanStack.Screen name="PublicDesk"      component={guarded.PublicDeskScreen}      options={publicDeskOptions(lang)} />
      <PlanStack.Screen name="PublicProfile"   component={guarded.PublicProfileScreen}   options={publicProfileOptions(lang)} />
      <PlanStack.Screen name="BrandProducts"   component={guarded.BrandProductsScreen}   options={brandProductsOptions} />
    </PlanStack.Navigator>
  )
}

/**
 * みんなのデスク。作成の流れ（用途 → テンプレート → 配線図）とは別の「見る」導線で、
 * デスクを持っていてもいなくても同じ位置にあるべきなので独立したタブにしている。
 * 他人のデスク・プロフィールもこのスタックに積む（Root に置くと下のタブバーが消える。
 * types の PublicStackParamList の注記）。
 */
function FeedNavigator() {
  const { colors, lang, reduceMotion } = useApp()
  return (
    <FeedStack.Navigator
      screenOptions={localizedStackOptions(colors, lang, reduceMotion)}
    >
      <FeedStack.Screen name="DeskFeed" component={guarded.DeskFeedScreen}
        // 英語はタブのラベルと同じ語にする（'Desks from everyone' はタブに収まらない）
        options={{ title: lang === 'en' ? 'Explore' : 'みんなのデスク' }} />
      {/* 更新一覧（ベル）。みんなのデスクの上に積む */}
      <FeedStack.Screen name="DeskUpdates" component={guarded.DeskUpdatesScreen}
        options={{ title: lang === 'en' ? 'Updates' : '更新' }} />
      <FeedStack.Screen name="PublicDesk" component={guarded.PublicDeskScreen}
        options={publicDeskOptions(lang)} />
      <FeedStack.Screen name="PublicProfile" component={guarded.PublicProfileScreen}
        options={publicProfileOptions(lang)} />
      <FeedStack.Screen name="BrandProducts" component={guarded.BrandProductsScreen}
        options={brandProductsOptions} />
      {/* 公開デスクから開くAIコーチ。デスクと同じスタックに積まないと、戻るが
          そのタブの先頭画面に着地して見ていたデスクへ帰れない（デスク側・マイページ側と同じ） */}
      <FeedStack.Screen name="AICoachChat" component={guarded.AICoachChatScreen}
        options={{ title: lang === 'en' ? 'AI Coach' : 'AIコーチ' }} />
    </FeedStack.Navigator>
  )
}

function MyPageNavigator() {
  const { colors, lang, reduceMotion } = useApp()
  return (
    <MyPageStack.Navigator
      screenOptions={localizedStackOptions(colors, lang, reduceMotion)}
    >
      {/* 統計は機材タブから開く。画面側でヘルプと設定をまとめたヘッダーに差し替える。 */}
      <MyPageStack.Screen name="MyPage" component={guarded.MyPageScreen}
        options={({ navigation }) => ({
          title: lang === 'en' ? 'My Page' : 'マイページ',
          headerRight: () => (
            <HeaderIconButton
              name={ICONS.settings}
              color={colors.text}
              onPress={() => { if (navigation.isFocused()) navigation.navigate('Settings') }}
              accessibilityLabel={lang === 'en' ? 'Settings' : '設定'}
            />
          ),
        })} />
      <MyPageStack.Screen name="Settings" component={guarded.SettingsScreen}
        options={{ title: lang === 'en' ? 'Settings' : '設定' }} />
      {/* ジャンルごとの設定。SettingsScreen を section パラメータ付きで再利用する */}
      <MyPageStack.Screen
        name="SettingsSection"
        component={guarded.SettingsScreen}
        options={({ route }: any) => ({ title: settingsSectionTitle(route.params.section, lang) })}
      />
      <MyPageStack.Screen name="GadgetStats" component={guarded.GadgetStatsScreen} options={{ title: lang === 'en' ? 'Stats' : '統計' }} />
      <MyPageStack.Screen name="FollowingList" component={guarded.FollowingListScreen} options={{ title: lang === 'en' ? 'Following' : 'フォロー中' }} />
      {/* ガジェットの登録・編集はマイページ側にも積む。デスクのスタックへ飛ばすと
          保存後の戻り先がマイデスクになり、ガジェットタブへ帰ってこられない */}
      <MyPageStack.Screen name="AddGadget" component={guarded.AddGadgetScreen} options={({ route }) => ({ title: route.params?.showCategoryPicker && !route.params?.category ? (lang === 'en' ? 'Choose a category' : 'ジャンルを選択') : (lang === 'en' ? 'Add Gadget' : 'ガジェットを追加') })} />
      <MyPageStack.Screen name="GadgetDetail" component={guarded.GadgetDetailScreen} options={{ title: lang === 'en' ? 'Edit' : '編集' }} />
      {/* AIコーチも両方に積む。設定から開いた相談履歴を別タブへ飛ばしていたため、
          戻るとマイページではなくマイデスク一覧に着地していた */}
      <MyPageStack.Screen name="AICoachList" component={guarded.AICoachListScreen} options={{ title: lang === 'en' ? 'Chat History' : '相談履歴' }} />
      <MyPageStack.Screen name="AICoachChat" component={guarded.AICoachChatScreen} options={{ title: lang === 'en' ? 'AI Coach' : 'AIコーチ' }} />
      {/* いいね・保存・ガジェットのタブから他人のデスクへ飛べる */}
      <MyPageStack.Screen name="PublicDesk" component={guarded.PublicDeskScreen} options={publicDeskOptions(lang)} />
      <MyPageStack.Screen name="PublicProfile" component={guarded.PublicProfileScreen} options={publicProfileOptions(lang)} />
      <MyPageStack.Screen name="BrandProducts" component={guarded.BrandProductsScreen} options={brandProductsOptions} />
      {/* 作成途中の再開も同じスタックに積み、戻り先のマイページを保つ */}
      <MyPageStack.Screen name="PurposeSelection" component={guarded.PurposeSelectionScreen as never} options={({ route }) => ({ title: lang === 'en' ? 'Purposes' : 'デスクの用途', animationTypeForReplace: setupReplaceAnimation(route.params) })} />
      <MyPageStack.Screen name="TemplateDetail" component={guarded.TemplateDetailScreen as never} options={({ route }) => ({ title: lang === 'en' ? 'Gear Details' : '機材の設定', animationTypeForReplace: setupReplaceAnimation(route.params) })} />
      <MyPageStack.Screen name="GadgetSelection" component={guarded.GadgetSelectionScreen as never} options={({ route }) => ({ title: lang === 'en' ? 'Select Gadgets' : 'ガジェットを選択', animationTypeForReplace: setupReplaceAnimation(route.params) })} />
      <MyPageStack.Screen name="DeskPlacement" component={guarded.DeskPlacementScreen as never} options={({ route }) => ({ title: lang === 'en' ? 'Arrange Desk' : '配置を決める', animationTypeForReplace: setupReplaceAnimation(route.params) })} />
      <MyPageStack.Screen name="WiringResult" component={guarded.WiringResultScreen as never} options={publicDeskOptions(lang)} />
      <MyPageStack.Screen name="PhotoFill" component={guarded.PhotoFillScreen as never} options={{ title: lang === 'en' ? 'Add Photos' : '写真を追加' }} />
      <MyPageStack.Screen name="ProductFill" component={guarded.ProductFillScreen as never} options={{ title: lang === 'en' ? 'Add Products' : '商品を登録' }} />
      <MyPageStack.Screen name="ConnectionMethod" component={guarded.ConnectionMethodScreen as never} options={{ title: lang === 'en' ? "How it's connected" : 'つなぎ方' }} />
    </MyPageStack.Navigator>
  )
}

function MainTabs() {
  return (
    <SpotlightProvider>
      <MainTabsInner />
    </SpotlightProvider>
  )
}

/** タブバーのアイコン（26）とラベル（11px＋上2）が収まる高さ。上下の余白は別に足す */
const TAB_BAR_CONTENT_HEIGHT = 47

function MainTabsInner() {
  const { colors, t } = useApp()
  const { startTour } = useSpotlight()
  // 未読の点はタブバーにも出す。みんなのデスクの中だけに出していた頃は、
  // そのタブを開いた人しか気づけなかった（useDeskUpdateBell の注記）
  const { hasUnread } = useDeskUpdateBell()
  const insets = useSafeAreaInsets()
  const tabBarBottomPadding = Math.max(insets.bottom, 5)

  // 作成操作を始めるまでは案内を出さない。ここでは途中で閉じた案内の再開だけを扱う。
  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    Promise.all([
      AsyncStorage.getItem(SPOTLIGHT_DONE_KEY),
      AsyncStorage.getItem(TUTORIAL_SEEN_KEY),
      AsyncStorage.getItem(SPOTLIGHT_PROGRESS_KEY),
      AsyncStorage.getItem(SPOTLIGHT_STEP_KEY),
    ])
      .then(([done, oldSeen, savedProgress, legacyStep]) => {
        // v2進捗は手動で再実行したガイドのものなので、旧ガイドの既読より優先する。
        // 旧進捗だけが残っている場合は、旧ガイド既読なら再開しない。
        if (done || !active || (!savedProgress && (oldSeen || legacyStep === null))) return
        const progress = parseSpotlightProgress(savedProgress)
        const resume = resolveSpotlightResume(savedProgress, legacyStep)
        timer = setTimeout(() => {
          if (!active) return
          startTour(resume.current, resume.completed, resume.acknowledged)
          if (!progress && legacyStep) void AsyncStorage.removeItem(SPOTLIGHT_STEP_KEY)
        }, 900)
      })
      .catch(() => {})
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [startTour])

  // ラベルはどのタブも text。選択中は太くし、アイコンは activeTintColor（accentIcon）と塗りの絵で分ける
  const tabLabel = (text: string) => ({ focused }: { focused: boolean }) => (
    <Text style={[styles.tabLabel, focused && styles.tabLabelSelected, { color: colors.text }]} numberOfLines={1}>
      {text}
    </Text>
  )

  return (
    <View style={{ flex: 1 }} onTouchStart={notifyTutorialInteraction} onPointerDown={notifyTutorialInteraction}>
    <Tab.Navigator
      initialRouteName="PlanTab"
      screenOptions={{
        headerShown: false,
        // 起動時は現在のタブだけをマウントする。みんなのデスクと設定はデータを
        // キャッシュへ先読みし、画面コンポーネント自体は初めて開いた時に作る。
        lazy: true,
        // 生の accent は白い面で 3:1 に届かない色がある。選択中アイコンは
        // accentIcon、ラベルは tabBarLabel で読みやすい text を使う。
        // 選ばれていないタブも灰色にせず白黒で描く。常に出ている移動の入口なので、画面の中の
        // 道具（デスク詳細の保存・共有など）より薄く見えると優先度が逆になる
        tabBarActiveTintColor: colors.accentIcon,
        tabBarInactiveTintColor: colors.text,
        // 下余白はホームバーの高さから決める。固定値で上書きすると、ライブラリが入れる
        // 安全域の余白が消え、ラベルがホームバーに重なる
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          height: TAB_BAR_CONTENT_HEIGHT + 4 + tabBarBottomPadding,
          paddingTop: 4,
          paddingBottom: tabBarBottomPadding,
        },
        tabBarIconStyle: { marginBottom: 0 },
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      {/* デスクを起点にするため、タブバーの先頭はデスク */}
      <Tab.Screen name="PlanTab" component={PlanNavigator}
        listeners={popToTopOnTabPress}
        options={{ tabBarLabel: tabLabel(t('tab.plan')), tabBarIcon: ({ color, focused }) => <AppIcon name={focused ? TAB_ICONS_SELECTED.plan : TAB_ICONS.plan} size={26} color={color} /> }} />
      <Tab.Screen name="FeedTab" component={FeedNavigator}
        listeners={popToTopOnTabPress}
        options={{
          tabBarLabel: tabLabel(t('tab.feed')),
          tabBarIcon: ({ color, focused }) => (
            <View>
              <AppIcon name={focused ? TAB_ICONS_SELECTED.feed : TAB_ICONS.feed} size={26} color={color} />
              {hasUnread && <View style={[styles.tabDot, { backgroundColor: colors.unread, borderColor: colors.tabBar }]} />}
            </View>
          ),
          tabBarAccessibilityLabel: hasUnread
            ? `${t('tab.feed')}・${t('a11y.hasUnreadUpdates')}`
            : t('tab.feed'),
        }} />
      <Tab.Screen name="SettingsTab" component={MyPageNavigator}
        listeners={popToTopOnTabPress}
        options={{ tabBarLabel: tabLabel(t('tab.mypage')), tabBarIcon: ({ color, focused }) => <AppIcon name={focused ? TAB_ICONS_SELECTED.mypage : TAB_ICONS.mypage} size={26} color={color} /> }} />
    </Tab.Navigator>
    <SpotlightOverlay />
    </View>
  )
}

type AppState = 'loading' | 'onboarding' | 'auth' | 'main'

const bootStartTs = Date.now()
function RootNavigatorInner() {
  const { lang, isDark, colors, themeReady, reduceMotion, reduceMotionSystem, reduceMotionSetting } = useApp()
  const navigationTheme = useMemo(() => buildNavigationTheme(colors, isDark), [colors, isDark])
  const { session, profile, loading: authLoading, sessionLikely, authSkipped, signOutKeepingLocalData } = useAuth()
  const [onboarded, setOnboarded] = useState<boolean | null>(null)
  const [minimumSplashElapsed, setMinimumSplashElapsed] = useState(false)
  const [initialDataReady, setInitialDataReady] = useState(false)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const [recoveryFailed, setRecoveryFailed] = useState(false)
  const [accountDataReadyFor, setAccountDataReadyFor] = useState<string | null | undefined>(undefined)
  const [accountDataFailed, setAccountDataFailed] = useState(false)
  const [authWaitFailed, setAuthWaitFailed] = useState(false)
  const [iconFontsReady, setIconFontsReady] = useState(false)
  const nativeSplashHiddenRef = useRef(false)

  const hideNativeSplash = () => {
    if (nativeSplashHiddenRef.current) return
    nativeSplashHiddenRef.current = true
    if (Platform.OS !== 'web') void NativeSplashScreen.hideAsync().catch(() => {})
  }

  useEffect(() => subscribeBackupRecoveryFailure(() => {
    setRecoveryReady(false)
    setRecoveryFailed(true)
    hideNativeSplash()
  }), [])

  useEffect(() => {
    if (!authLoading) { setAuthWaitFailed(false); return }
    const timer = setTimeout(() => {
      setAuthWaitFailed(true)
      hideNativeSplash()
    }, 60_000)
    return () => clearTimeout(timer)
  }, [authLoading, recoveryAttempt])

  useEffect(() => {
    let active = true
    void withTimeout(Promise.all([
      MaterialCommunityIcons.loadFont(),
      Ionicons.loadFont(),
    ]), BOOT_DATA_TIMEOUT_MS).catch(() => {}).then(() => {
      if (active) setIconFontsReady(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    withTimeout(isOnboardingDone(), BOOT_DATA_TIMEOUT_MS)
      .then((value) => { if (active) setOnboarded(value) })
      .catch(() => { if (active) setOnboarded(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setMinimumSplashElapsed(true), MIN_BRAND_SPLASH_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    let active = true
    let timeout: ReturnType<typeof setTimeout> | null = null
    setRecoveryFailed(false)
    setRecoveryReady(false)
    void (async () => {
      // 途中の復元を巻き戻す前にキャッシュを読むと、その状態が編集・バックアップで確定してしまう。
      await withTimeout(recoverInterruptedRestore(), BOOT_DATA_TIMEOUT_MS)
      if (!active) return
      setRecoveryReady(true)
      const fallback = new Promise<void>(resolve => { timeout = setTimeout(resolve, BOOT_DATA_TIMEOUT_MS) })
      await Promise.race([Promise.all([preloadGadgets(), preloadPlans()]), fallback])
      if (timeout) clearTimeout(timeout)
      if (active) setInitialDataReady(true)
    })().catch(error => {
      if (!active) return
      analytics.error('backup_boot_recovery', error)
      setRecoveryFailed(true)
      hideNativeSplash()
    })
    return () => { active = false; if (timeout) clearTimeout(timeout) }
  }, [recoveryAttempt])

  // パスワード再設定メールのリンク（mydesk://auth/reset-password?...）を
  // アプリ起動中（warm）・未起動からの起動（cold start）の両方で受け止める。
  // NavigationContainer がまだ準備できていない間に届いた場合は、onReady 後に処理する。
  const pendingRecoveryRef = useRef(false)
  // リンクの受け口は起動時に1回だけ張るので、言語は ref 越しに読む
  const langRef = useRef(lang)
  langRef.current = lang
  useEffect(() => {
    let cancelled = false
    const processUrl = async (url: string | null, coldStart: boolean) => {
      if (!url || (!isTrustedAppLink(url, PUBLIC_URL_BASE)
        && !isAuthCallback(url, RESET_PASSWORD_PATH) && !isAuthCallback(url, EMAIL_CHANGE_PATH))) return
      await recordAttributionFromUrl(url)
      // 共有リンクがどれだけ流入を生んでいるかを見る。URL 全体は送らず、
      // どの入口かだけを分類して残す（デスクIDや復元トークンは載せない）。
      //
      // 該当しない URL では送らない。Web では getInitialURL() が常に現在の URL を
      // 返すため、記録すると通常起動のたびに1件増えて、ただの起動数と区別が付かない。
      const linkKind = isAuthCallback(url, RESET_PASSWORD_PATH) ? 'reset_password'
        : /\/(setup|desk|d)\//.test(url) ? 'public_desk'
        : null
      if (linkKind) {
        analytics.track(EVENTS.DEEP_LINK_OPENED, { link_kind: linkKind, cold_start: coldStart })
      }
      if (isAuthCallback(url, EMAIL_CHANGE_PATH)) {
        const ja = langRef.current === 'ja'
        // 期限切れ・使用済みのリンクは、Supabase がエラーを URL に載せて戻してくる
        if (/[?&#]error(?:_code|_description)?=/.test(url)) {
          // 「設定から」と言うだけだと、メールアドレスの欄がマイページ → 設定 → 基本設定の
          // 奥にあるのを自分で探すことになる。押せばその画面に着くようにする
          Alert.alert(
            ja ? 'メールアドレスを変更できませんでした' : 'Could not change your email address',
            ja
              ? 'リンクの有効期限が切れているか、すでに使われています。基本設定からもう一度お試しください。'
              : 'This link has expired or has already been used. Try again from Basic Settings.',
            [
              { text: ja ? '閉じる' : 'Close', style: 'cancel' },
              {
                text: ja ? '基本設定を開く' : 'Open Basic Settings',
                onPress: () => {
                  if (!navigationRef.isReady()) return
                  navigationRef.navigate('MainTabs', {
                    screen: 'SettingsTab',
                    params: { screen: 'SettingsSection', params: { section: 'account' }, initial: false },
                  })
                },
              },
            ],
          )
          return
        }
        try {
          const user = await refreshAfterEmailChange()
          if (cancelled || !user) return
          // Secure email change が有効だと、片方のリンクだけでは切り替わらない。
          // 何も言わないと、もう片方のメールを開かずに終わってしまう
          if (user.new_email) {
            Alert.alert(
              ja ? '確認を受け付けました' : 'Confirmation received',
              ja
                ? 'もう一方のアドレスに届いたメールのリンクも開くと、変更が完了します。'
                : 'Open the link in the email sent to your other address to finish the change.',
            )
          } else {
            Alert.alert(
              ja ? 'メールアドレスを変更しました' : 'Email address changed',
              ja
                ? `次回から ${user.email ?? ''} でログインしてください。`
                : `Sign in with ${user.email ?? ''} from now on.`,
            )
          }
        } catch {
          // この端末でログインしていない等。変更自体はサーバー側で済んでいる
        }
        return
      }
      if (!isAuthCallback(url, RESET_PASSWORD_PATH)) return
      try {
        const ok = await completePasswordRecovery(url)
        if (cancelled || !ok) return
        if (navigationRef.isReady()) navigationRef.navigate('ResetPassword')
        else pendingRecoveryRef.current = true
      } catch {
        // 期限切れ・無効なリンク等。何もせずログイン画面に留まる
      }
    }
    Linking.getInitialURL().then((url) => processUrl(url, true)).catch(() => {})
    const subscription = Linking.addEventListener('url', ({ url }) => { void processUrl(url, false).catch(() => {}) })
    return () => { cancelled = true; subscription.remove() }
  }, [])

  // 初回ユーザーはWelcomeを出すのにプラン・ガジェットを必要としない。
  // 読み込みは裏で続け、再訪ユーザーだけ本編表示前のデータ待ちを行う。
  const localReady = isBootReady({ themeReady, authLoading, onboarded, authSkipped, initialDataReady }) && recoveryReady

  // 本編を表示する前に、端末のデータとアカウントの控えを突き合わせる。
  // 空の端末へは控えを戻し、ログインせずに作ったデータは控えと合わせる。
  const [reconcileRun, setReconcileRun] = useState(0)
  // 突き合わせの案内を出した起動では、自動保存が止まっている知らせを重ねない
  const backupAlertShownRef = useRef(false)
  useEffect(() => {
    if (!localReady) return
    setAccountDataFailed(false)
    const userId = session?.user?.id
    if (!userId) {
      setAccountDataReadyFor(null)
      return
    }
    let active = true
    setAccountDataReadyFor(undefined)
    const controller = new AbortController()
    void withTimeout(reconcileAccountData(userId, controller.signal), 60_000).then((result) => {
      if (!active) return
      if (result === 'cancelled' || result === 'failed') throw new Error('Account data reconciliation failed')
      if (result !== 'foreign') {
        if (result === 'needs-review' || result === 'restored' || result === 'merged') {
          backupAlertShownRef.current = true
          Alert.alert(
            lang === 'ja' ? 'バックアップの確認' : 'Check your backup',
            result === 'needs-review'
              ? (lang === 'ja' ? '自動復元を完了できませんでした。設定 → データ → バックアップから復元で、再試行または別の世代を選べます。確認が済むまでバックアップは保存しません。' : 'Automatic restore could not finish. Open Settings → Data → Restore from Backup to retry or choose another backup. Backup saving is paused until you review your data.')
              : result === 'merged'
              ? (lang === 'ja' ? 'ログインする前に作ったデータを、アカウントのデータと合わせました。内容を確認してから、設定 → データ → バックアップから復元で自動保存を再開してください。合わせる前へ戻すこともできます。' : 'Data you created before signing in was combined with your account data. Review it, then resume backup saving in Settings → Data → Restore from Backup. You can also undo it.')
              : (lang === 'ja' ? 'アカウントに保存していたデータを戻しました。写真は含まれません。' : 'Your account data was restored. Photos are not included.'),
          )
        }
        setAccountDataReadyFor(userId)
        return
      }
      // 前のアカウントがログアウトを通らずにセッションだけ切れた端末。混ぜると前の人の
      // デスクがこのアカウントの控えとして上がるので、選んでもらうまで本編へ進めない
      const ja = lang === 'ja'
      Alert.alert(
        ja ? '別のアカウントのデータが残っています' : 'Data from another account',
        ja
          ? 'この端末には、別のアカウントで使っていたデスク・ガジェットが残っています。このアカウントには合わせられません。削除すると元に戻せません。残す場合はログアウトして、前のアカウントでログインし直してください。'
          : 'This device still has desks and gadgets from another account. They cannot be added to this account, and deleting them cannot be undone. To keep them, log out and sign in to the previous account.',
        [
          {
            text: ja ? 'ログアウトする' : 'Log Out',
            style: 'cancel',
            onPress: () => { void signOutKeepingLocalData().catch(() => setReconcileRun((n) => n + 1)) },
          },
          {
            text: ja ? '削除して続ける' : 'Delete and Continue',
            style: 'destructive',
            onPress: () => {
              // 消したデスクの画面へ戻すと、読み込み中のまま止まる
              setResumeAfterLogin(null)
              void withTimeout(clearLocalUserData(), 60_000)
                .then(() => { if (active) setReconcileRun(n => n + 1) })
                .catch(() => { if (active) setAccountDataFailed(true) })
            },
          },
        ],
        { cancelable: false },
      )
    }).catch(error => {
      if (!active) return
      controller.abort()
      try { analytics.error('account_data_reconcile', error) } catch {}
      setAccountDataFailed(true)
      hideNativeSplash()
    })
    return () => { active = false; controller.abort() }
  }, [localReady, session?.user?.id, reconcileRun]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = localReady && accountDataReadyFor === (session?.user.id ?? null)

  useEffect(() => {
    if (!ready || !session || onboarded !== false) return
    // 再インストール後は初回フラグが消えていても、認証が残る端末がある。
    setOnboarded(true)
    void markOnboardingDone().catch(() => {})
  }, [ready, session, onboarded])

  useEffect(() => {
    if (ready) {
      if (__DEV__) console.log(`[perf] ready in ${Date.now() - bootStartTs}ms`)
    }
  }, [ready])

  // アカウント・バックアップ。前回から24時間以上経っていれば1回だけ実行する。
  // バックグラウンド遷移では動かさない（OS が処理の完走を保証しないため、
  // services/backupService.ts のコメント参照）。
  // 起動直後のフレームで JSON 化と送信を始めると初期表示が詰まるので、
  // 操作が落ち着くまで待ってから走らせる。
  //
  // 053 以降は全ログインユーザーが最新の控えを持つ。課金の解決は保存を待たせる理由にならない。
  const autoBackupStartedForRef = useRef<string | null>(null)
  useEffect(() => {
    const userId = session?.user?.id
    if (!ready || !userId) {
      autoBackupStartedForRef.current = null
      return
    }
    if (autoBackupStartedForRef.current === userId) return
    autoBackupStartedForRef.current = userId
    let active = true
    const task = InteractionManager.runAfterInteractions(() => {
      void runAutoBackupIfDue(userId).then(async (result) => {
        // 突き合わせの案内を出した起動では重ねない（同じ理由で止まっている）
        if (!active || backupAlertShownRef.current) return
        const notice = await takeBackupNotice(result)
        if (notice && active) showBackupNotice(notice)
      }).catch(() => {})
    })
    return () => { active = false; task.cancel() }
  }, [ready, session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 自動保存が本人の操作待ちで止まっていることを知らせる。黙っていると、止まったまま使い続けた
  // 編集が控えに入らず、端末を失くしたときに戻らない
  function showBackupNotice(notice: BackupNotice) {
    const ja = lang === 'ja'
    const message = notice === 'conflict'
      ? (ja ? '別の端末で、この端末の内容とは違うバックアップが保存されています。上書きしないよう、この端末からの自動保存を止めています。' : 'Another device saved a different backup. Automatic backups from this device are paused so it is not overwritten.')
      : notice === 'recovery-pending' || notice === 'not-synced'
      ? (ja ? '復元した内容の確認が済んでいないため、自動保存を止めています。' : 'Automatic backups are paused until you review your restored data.')
      : notice === 'too-large'
      ? (ja ? 'データが保存できる上限を超えたため、自動保存できていません。データを書き出して保管してください。' : 'Your data is over the backup size limit, so it is not being backed up. Export your data to keep a copy.')
      : notice === 'garbled-text'
      ? (ja ? '文字化けした文字を含む名前やメモがあるため、自動保存できていません。' : 'Some names or notes contain garbled characters, so your data is not being backed up.')
      : notice === 'invalid-data'
      ? (ja ? '端末の保存データを欠落なく読み取れないため、自動保存できていません。' : 'Some local data could not be read, so it is not being backed up.')
      : (ja ? 'しばらくアカウントへ保存できていません。通信できる場所でアプリを開くと保存します。' : 'Your data has not been saved to your account for a while. Open the app while online to save it.')
    Alert.alert(ja ? 'バックアップが止まっています' : 'Backups are paused', message, [
      { text: ja ? '閉じる' : 'Close', style: 'cancel' },
      {
        text: ja ? 'データ設定を開く' : 'Open Data Settings',
        onPress: () => {
          if (!navigationRef.isReady()) return
          navigationRef.navigate('MainTabs', {
            screen: 'SettingsTab',
            params: { screen: 'SettingsSection', params: { section: 'data' }, initial: false },
          })
        },
      },
    ])
  }

  // 通知の宛先を登録し直す。許可済みの人だけで、ここではダイアログを出さない
  // （聞くのはフォローした直後）。token は再インストールや OS 更新で変わり、
  // 言語を切り替えたら通知の文面も切り替える必要がある
  useEffect(() => {
    if (!ready || !session?.user?.id) return
    const task = InteractionManager.runAfterInteractions(() => {
      void registerPushToken(lang, { prompt: false })
    })
    return () => task.cancel()
  }, [ready, session?.user?.id, lang])

  // 起動後の空き時間に、配線図レイアウトと歴史アニメーションを先に計算しておく。
  // 開始の遅延・多重起動の抑止は warmUpConnectionMaps 側が持つので、ここでは投げるだけ。
  useEffect(() => {
    if (!ready) return
    void warmUpConnectionMaps(lang)
  }, [ready, lang])

  // 初期化中の空の画面からオープニングへ切り替える。
  // 本編は裏で先にマウントし、配線とアイコンの演出が終わるまで覆っておく。
  const [splashOverlayVisible, setSplashOverlayVisible] = useState(true)
  const [openingFinished, setOpeningFinished] = useState(false)
  const splashOpacity = useRef(new Animated.Value(1)).current
  const splashDone = ready && minimumSplashElapsed && iconFontsReady
  const openingVisible = splashDone && !splashOverlayVisible && !openingFinished && !reduceMotion
  // ログイン・ログアウトでは突き合わせの間ナビゲーションごと外れ、戻ったときに次の画面へ
  // 一瞬で切り替わる。起動時はスプラッシュのフェードが受け持つので、2回目以降のマウントだけ動かす。
  // 0 に戻すのは外れている間にしておく（マウント後の effect で戻すと、最初の1フレームが素で見える）
  const navEnter = useRef(new Animated.Value(1)).current
  const navMountedOnceRef = useRef(false)
  const { width: windowWidth } = useWindowDimensions()
  useEffect(() => {
    if (!splashDone) {
      if (navMountedOnceRef.current) navEnter.setValue(reduceMotion ? 1 : 0)
      return
    }
    if (!navMountedOnceRef.current) { navMountedOnceRef.current = true; return }
    if (reduceMotion) { navEnter.setValue(1); return }
    const anim = Animated.timing(navEnter, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    anim.start()
    return () => anim.stop()
  }, [splashDone, reduceMotion, navEnter])

  // ログイン画面からログインしたら、ログインする前の画面へ戻す（Paywall から来たなら開き直す）。
  // ログインすると突き合わせの間ナビゲーションごと外れ、作り直すと本編の最初に戻るので、
  // 外れる前の状態から戻す先を決めておく（utils/loginResume）
  const signedInUserId = session?.user?.id ?? null
  const prevSignedInUserIdRef = useRef(signedInUserId)
  const [resumeAfterLogin, setResumeAfterLogin] = useState<LoginResume | null>(null)
  const [navReady, setNavReady] = useState(false)
  useEffect(() => {
    const prev = prevSignedInUserIdRef.current
    prevSignedInUserIdRef.current = signedInUserId
    if (!signedInUserId) { setResumeAfterLogin(null); return }
    if (prev) return
    setResumeAfterLogin(loginResumeFrom(lastRootState))
  }, [signedInUserId])
  useEffect(() => { if (!splashDone) setNavReady(false) }, [splashDone])
  useEffect(() => {
    if (!resumeAfterLogin || !navReady || !splashDone || !openingFinished) return
    if (resumeAfterLogin.state) {
      navigationRef.resetRoot(resumeAfterLogin.state)
      setResumeAfterLogin(resumeAfterLogin.paywall ? { paywall: resumeAfterLogin.paywall } : null)
      return
    }
    // 登録直後は @ID を決めるモーダル（PublicTagSetupModal）が出る。Paywall を重ねると
    // 片方が表示されないので、決め終わってから開く
    if (!profile || profile.id !== signedInUserId || profile.public_tag_chosen === false) return
    setResumeAfterLogin(null)
    navigationRef.navigate('Paywall', resumeAfterLogin.paywall)
  }, [resumeAfterLogin, navReady, splashDone, openingFinished, profile, signedInUserId])
  const readyTrackedRef = useRef(false)
  useEffect(() => {
    if (!splashDone || readyTrackedRef.current) return
    readyTrackedRef.current = true
    analytics.track(EVENTS.APP_READY, {
      ready_ms: Date.now() - bootStartTs,
      entry_state: onboarded === false ? 'onboarding' : 'returning',
      data_ready: initialDataReady,
    })
  }, [splashDone, onboarded, initialDataReady])
  const interactiveTrackedRef = useRef(false)
  useEffect(() => {
    if (!splashDone || !openingFinished || splashOverlayVisible || !navReady || interactiveTrackedRef.current
      || recoveryFailed || accountDataFailed || authWaitFailed) return
    interactiveTrackedRef.current = true
    analytics.track(EVENTS.APP_INTERACTIVE, {
      interactive_ms: Date.now() - bootStartTs,
      entry_state: onboarded === false ? 'onboarding' : 'returning',
      reduce_motion: reduceMotion,
      reduce_motion_system: reduceMotionSystem,
      reduce_motion_setting: reduceMotionSetting,
    })
  }, [splashDone, openingFinished, splashOverlayVisible, navReady, onboarded, reduceMotion, reduceMotionSystem, reduceMotionSetting, recoveryFailed, accountDataFailed, authWaitFailed])
  useEffect(() => {
    if (!splashDone) return
    if (reduceMotion) {
      splashOpacity.setValue(0)
      setSplashOverlayVisible(false)
      setOpeningFinished(true)
      return
    }
    const anim = Animated.timing(splashOpacity, { toValue: 0, duration: 280, useNativeDriver: true })
    anim.start(({ finished }) => { if (finished) setSplashOverlayVisible(false) })
    return () => anim.stop()
  }, [splashDone, splashOpacity, reduceMotion])

  // sessionLikely: getSession がタイムアウトしたとき、前回セッションがあれば
  // 楽観的にメイン画面へ進める（認証が裏で解決して null 確定ならログインへ切り替わる）
  // authSkipped: 「あとで登録」を選んだ人。デスク作成も配線図も端末内で完結するので、
  // ログインなしで本編に入れる（公開・ブックマーク・購入の時点で初めて求める）
  const appState: AppState =
    !onboarded && session === null    ? 'onboarding'
    : session === null && !sessionLikely && !authSkipped ? 'auth'
    :                                   'main'

  if (recoveryFailed || accountDataFailed || authWaitFailed) return (
    <View style={[styles.root, styles.recovery, { backgroundColor: colors.bg }]}>
      <Text style={[styles.recoveryText, { color: colors.text }]}>
        {authWaitFailed
          ? (lang === 'ja' ? '認証処理が応答していません。改善しない場合はアプリを開き直してください。' : 'Authentication is not responding. If it persists, reopen the app.')
          : accountDataFailed
          ? (lang === 'ja' ? 'アカウントのデータを確認できませんでした。通信環境と端末の空き容量を確認して、再試行してください。' : 'Could not check your account data. Check your connection and device storage, then try again.')
          : (lang === 'ja' ? '復元途中のデータを元に戻せませんでした。端末の空き容量を確認して、再試行してください。' : 'Could not recover an interrupted restore. Check your device storage and try again.')}
      </Text>
      <TouchableOpacity style={styles.recoveryRetry} onPress={() => {
        setAuthWaitFailed(false)
        if (accountDataFailed && !recoveryFailed && !authWaitFailed) { setAccountDataFailed(false); setReconcileRun(n => n + 1) }
        else setRecoveryAttempt(n => n + 1)
      }} accessibilityRole="button">
        <Text style={{ color: colors.accentText }}>{lang === 'ja' ? '再試行' : 'Try again'}</Text>
      </TouchableOpacity>
    </View>
  )

  return (
    // 一番下の地。スプラッシュが消える間とナビゲーションの外に出るものは、これが見える
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
    {splashDone && <Animated.View style={[styles.root, { transform: [{ translateX: navEnter.interpolate({ inputRange: [0, 1], outputRange: [windowWidth, 0] }) }] }]} pointerEvents={openingFinished ? 'auto' : 'none'} aria-hidden={!openingFinished} accessibilityElementsHidden={!openingFinished} importantForAccessibility={openingFinished ? 'auto' : 'no-hide-descendants'}>
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={() => {
        trackCurrentScreen()
        setNavReady(true)
        if (pendingRecoveryRef.current) {
          pendingRecoveryRef.current = false
          navigationRef.navigate('ResetPassword')
        }
      }}
      onStateChange={trackCurrentScreen}
      linking={{
        prefixes: [
          'mydesk://',
          PUBLIC_URL_BASE,
        ],
        config: {
          // 共有URLから起動したとき、PublicDesk の下に1枚敷いておく。
          // これが無いとスタックが PublicDesk 1枚だけになり、ヘッダーの戻るが
          // 描画されず goBack() も効かない（リンクを踏んだ人が行き止まりになる）。
          // 敷く画面は、その時点でアプリが出すべき画面に合わせる。常に MainTabs だと
          // 初回起動の人がリンクを踏んだだけでオンボーディングとログインを飛び越えて
          // 本編に入ってしまい、完了フラグも立たないまま次回また案内が出る。
          initialRouteName:
            appState === 'onboarding' ? 'Onboarding'
            : appState === 'auth'     ? 'Login'
            :                           'MainTabs',
          screens: {
            // 既定の /Login は公開プロフィールの @ID と解釈されるため専用パスにする。
            Login: 'auth/login',
            // 公開デスクはみんなのデスクのタブの中にある。リンクで開いたときも
            // 下のタブバーを残し、戻るでみんなのデスクの一覧に着地させるため、
            // タブ → そのスタック、と入れ子で指す（initialRouteName が各段の「下に敷く1枚」）
            MainTabs: {
              screens: {
                // 3段目（タブの中のスタック）は React Navigation の型では
                // ParamList が any に落ち、initialRouteName が書けなくなる。
                // この1箇所だけ型を名指しする
                FeedTab: {
                  initialRouteName: 'DeskFeed',
                  screens: {
                    PublicDesk: { path: 'setup/:deskId' },
                    // 公開プロフィール。worker 側の /<@ID>・/u/<@ID> とペアで動く
                    PublicProfile: { path: 'u/:tag' },
                  },
                } as PathConfig<FeedStackParamList>,
              },
            },
          },
        },
        // 共有URLは /<@ID>/<22文字>、プロフィールは /<@ID>。画面側は UUID と u/:tag を
        // 前提にしているので、utils/shareLinkPath でそこへ均してから渡す。
        // 旧URL（/setup/<22文字>・/setup/<uuid>・/d/<22文字>・/desk/<uuid>・/u/<@ID>）も同じ画面へ誘導する。
        // 壊れた % 列のリンクは解析させずに捨てる（踏ませるだけでアプリが固まる。isParsableLinkPath 参照）
        getStateFromPath: (path, options) => (
          isParsableLinkPath(path) ? defaultGetStateFromPath(normalizeShareLinkPath(path), options) : undefined
        ),
        // 通知（085）を押して開いたときも、共有リンクと同じ経路でデスクを開く。
        // 未起動から通知で起動した場合は Linking に URL が無いので、最後に押された通知から拾う
        getInitialURL: async () => {
          const url = await Linking.getInitialURL()
          if (url && isTrustedAppLink(url, PUBLIC_URL_BASE)) return url
          const fromNotification = notificationUrl(await Notifications.getLastNotificationResponseAsync().catch(() => null))
          // 消さないと、アップデートの適用などで JS だけ再起動したときに同じデスクがまた開く
          if (fromNotification) {
            void Notifications.clearLastNotificationResponseAsync().catch(() => {})
            analytics.track(EVENTS.PUSH_OPENED, { cold_start: true })
          }
          return fromNotification
        },
        subscribe: (listener) => {
          const linkSub = Linking.addEventListener('url', ({ url }) => { if (isTrustedAppLink(url, PUBLIC_URL_BASE)) listener(url) })
          const notificationSub = Notifications.addNotificationResponseReceivedListener((response) => {
            const url = notificationUrl(response)
            if (!url || !isTrustedAppLink(url, PUBLIC_URL_BASE)) return
            analytics.track(EVENTS.PUSH_OPENED, { cold_start: false })
            listener(url)
          })
          return () => {
            linkSub.remove()
            notificationSub.remove()
          }
        },
      }}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Root.Navigator screenOptions={{ headerShown: false, gestureEnabled: true, animation: reduceMotion ? 'fade' : 'default' }}>
        {appState === 'onboarding' ? (
          <>
            <Root.Screen name="Onboarding">
              {props => <guarded.OnboardingScreen {...props} introFinished={openingFinished} />}
            </Root.Screen>
            <Root.Screen name="Login"         component={guarded.LoginScreen} />
            <Root.Screen name="MainTabs"      component={MainTabs} />
          </>
        ) : appState === 'auth' ? (
          <>
            <Root.Screen name="Login"         component={guarded.LoginScreen} />
            <Root.Screen name="MainTabs"      component={MainTabs} />
          </>
        ) : (
          <>
            <Root.Screen name="MainTabs"      component={MainTabs} />
            <Root.Screen name="Login"         component={guarded.LoginScreen} />
          </>
        )}
        {/* 他人のデスク・プロフィールと、そこから開くAIコーチは Root に置かない。
            Root は MainTabs の上に重なるので、閲覧中ずっと下のタブバーが消える。
            3つのタブのスタックそれぞれに積んである（types の PublicStackParamList の注記） */}
        <Root.Screen name="Paywall" component={guarded.PaywallScreen}
          options={{ presentation: 'modal', headerShown: false, animation: reduceMotion ? 'fade' : 'slide_from_bottom' }} />
        <Root.Screen name="ResetPassword" component={guarded.ResetPasswordScreen} options={{ headerShown: false }} />
      </Root.Navigator>
    </NavigationContainer>
    </Animated.View>}
    {/* 登録直後に @ID を決めてもらう（061）。認証の分岐に依らず profiles が
        出来た直後に一度だけ出るよう、遷移ではなくモーダルで重ねる */}
    {splashDone && openingFinished && appState === 'main' && <PublicTagSetupModal />}
    {/* スプラッシュのフェード中も本編を覆い、演出の前にホームが一瞬見えないようにする */}
    {splashDone && !openingFinished && (
      <View style={[StyleSheet.absoluteFill, splashOverlayVisible && { backgroundColor: colors.bgList }]} accessibilityViewIsModal>
        {openingVisible && <OnboardingIntro onComplete={() => setOpeningFinished(true)} />}
      </View>
    )}
    {splashOverlayVisible && (
      <Animated.View key="brand-splash" style={[StyleSheet.absoluteFill, { opacity: splashOpacity }]} pointerEvents="none">
        <BrandSplash onImageReady={hideNativeSplash} />
      </Animated.View>
    )}
    </View>
  )
}

// タブバーのラベル。色は tabBarLabel 側で選択状態ごとに当てる
const styles = StyleSheet.create({
  root: { flex: 1 },
  recovery: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: UI_METRICS.screenGutter },
  recoveryText: { fontSize: 15, lineHeight: 23, textAlign: 'center' },
  recoveryRetry: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center', marginTop: 16 },
  tabLabel: { fontSize: 11, marginTop: 2 },
  tabLabelSelected: { fontWeight: '700' },
  // 未読の点。アイコンの右上に重ねる（円なので半径は寸法から決める）
  tabDot: {
    position: 'absolute', top: -1, right: -2,
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 2,
  },
})

export function RootNavigator() {
  return (
    <AppProvider>
      <AuthProvider>
        <SubscriptionProvider>
          <RootNavigatorInner />
          <AlertHost />
        </SubscriptionProvider>
      </AuthProvider>
    </AppProvider>
  )
}
