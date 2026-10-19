import { Alert } from '../utils/alert'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import React, { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { AppIcon } from '../components/atoms/AppIcon'
import { PlanComparisonTable } from '../components/organisms/PlanComparisonTable'
import { PAYWALL_PLANS, PLAN_LIMITS, PaywallPlanDef, PRIVACY_URL, TERMS_URL } from '../constants/plans'
import { useApp } from '../context/AppContext'
import { IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER, UI_METRICS } from '../constants/ui'
import { useAuth } from '../context/AuthContext'
import { useSubscription } from '../context/SubscriptionContext'
import { usePlanPricing } from '../hooks/usePlanPricing'
import { analytics, EVENTS, errorProperties } from '../services/analytics'
import { PaywallReason, RootStackParamList } from '../types'
import { promptLogin } from '../utils/promptLogin'
import { findPackageForPlan } from '../utils/purchasePackages'
import { hapticSuccess } from '../utils/haptics'
import { localizedErrorMessage } from '../utils/localizedError'
import { ICONS } from '../constants/icons'
import { QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'

type Props = NativeStackScreenProps<RootStackParamList, 'Paywall'>

const PAYWALL_INTRO: Record<PaywallReason, { ja: [string, string]; en: [string, string] }> = {
  maxViewHistory: {
    ja: ['前に見たデスクを、\nもっと先まで。', '閲覧履歴が最新100件から1,000件に。\nすでに保存範囲から消えた履歴は復元されません。'],
    en: ['Find desks you saw\nfurther back.', 'Keep 1,000 viewed desks instead of 100.\nHistory already discarded cannot be recovered.'],
  },
  maxSavedCollections: {
    ja: ['参考も、欲しいものも、\n自分らしく整理。', '保存コレクションが3フォルダから無制限に。\n保存したデスクや機材を用途別にまとめられます。'],
    en: ['Organize your ideas\nand your wish list.', 'Go from three saved collections to unlimited.\nGroup saved desks and gear your way.'],
  },
  manual: {
    ja: ['理想のデスクを、\n次の一歩へ。', '何を変えるか相談する。新しい構成を試す。\nこだわりの積み重ねを、Proでもっと。'],
    en: ['Your next step toward\na desk you love.', 'Find your next upgrade, explore new setups,\nand look back on how far you’ve come.'],
  },
  aiFeatures: {
    ja: ['次の改善が、\nひとりで悩まず決まる。', '機材や配線をもとに、AIコーチに相談。\nあなたのデスクに合う改善案を見つけよう。'],
    en: ['Find your next upgrade\nwith an AI coach.', 'Get ideas based on your gear and wiring,\nand find what works for your desk.'],
  },
  maxWiringPlans: {
    ja: ['今のデスクも、\n次のアイデアも。', 'デスクを消さずに、新しい構成を保存。\n仕事用も趣味用も、数を気にせず試せます。'],
    en: ['Keep your setup.\nMake room for new ideas.', 'Save another desk without deleting a favorite.\nExplore setups for work, play, and what’s next.'],
  },
  maxPhotosPerDesk: {
    ja: ['こだわりは、\n細部まで残そう。', `デスクごとの写真が${PLAN_LIMITS.free.maxPhotosPerDesk}枚から${PLAN_LIMITS.pro.maxPhotosPerDesk}枚に。\n全景も配線も、お気に入りの機材も記録できます。`],
    en: ['Capture the details\nthat make it yours.', `Go from ${PLAN_LIMITS.free.maxPhotosPerDesk} to ${PLAN_LIMITS.pro.maxPhotosPerDesk} photos per desk.\nKeep the full view, the wiring, and your favorite gear.`],
  },
  maxGrowthRecords: {
    ja: ['小さな進化を、\nひとつも逃さず。', '成長記録の件数が無制限に。\n機材の入れ替えも模様替えも、続けて残せます。'],
    en: ['Keep every step\nof your desk’s journey.', 'Unlock unlimited growth records.\nKeep documenting every upgrade and rearrangement.'],
  },
  historyAnimation: {
    ja: ['最初のデスクから、\n今のこだわりまで。', '自分のデスクの歴史を、全期間再生。\n1年以上前の構成も振り返れます。'],
    en: ['From your first setup\nto the desk you love.', 'Replay your own desk’s full history,\nincluding setups from more than a year ago.'],
  },
  autoBackup: {
    ja: ['試行錯誤に、\n戻れる安心を。', 'アカウントバックアップを直近7件まで保存。\n変更前の状態を選んで戻せます。'],
    en: ['More room to try.\nMore ways to go back.', 'Keep your latest seven account backups\nand choose an earlier version to restore.'],
  },
  accentColor: {
    ja: ['毎日のデスクづくりを、\nもっと自分らしく。', 'AIへの相談も、デスクの記録も。\nこだわりを育てる機能が揃います。'],
    en: ['Make your desk journey\nyour own.', 'From AI advice to your desk’s story,\nget more ways to develop your setup.'],
  },
}

export function PaywallScreen({ navigation, route }: Props) {
  const reason = route.params?.reason
  const planId = route.params?.planId
  const { colors, lang } = useApp()
  const accent = colors.accent
  const { packages, purchase, restore, isLoading, tier } = useSubscription()
  const { user } = useAuth()
  const { priceOf, subOf } = usePlanPricing()
  const isWeb = Platform.OS === 'web'
  const [purchasing, setPurchasing] = useState(false)
  const [restoring,  setRestoring]  = useState(false)
  const billingInFlightRef = useRef(false)
  // Paywall はモーダルなので、上にログイン画面を積むと裏に回って見えない。閉じてから開き、
  // ログインできたら同じ理由で開き直す（ログイン後はナビゲーションが作り直されるので RootNavigator が開く）
  const openLoginFromPaywall = (mode: 'signin' | 'signup') => {
    if (billingInFlightRef.current || !navigation.isFocused()) return
    navigation.replace('Login', { mode, resumePaywall: { reason, planId } })
  }
  const [selectedId, setSelectedId] = useState<PaywallPlanDef['id']>('pro_monthly')
  const [showComparison, setShowComparison] = useState(false)
  const selectedPlan = PAYWALL_PLANS.find((p) => p.id === selectedId) ?? PAYWALL_PLANS[0]

  const C = colors
  const ja = lang === 'ja'
  const [headline, introduction] = PAYWALL_INTRO[reason ?? 'manual'][ja ? 'ja' : 'en']
  const benefits = [
    {
      icon: ICONS.robot,
      title: ja ? '次に買うもの、配線の悩みに答えを' : 'Find your next upgrade or wiring fix',
      detail: ja ? '機材や写真をもとにAIコーチへ相談。文章・写真共通の週間利用枠があり、相談の長さや写真によって利用量が変わります。' : 'Ask the AI coach about your gear and photos. Text and photos share a weekly allowance; usage varies with conversation length and photos.',
    },
    {
      icon: 'layers-triple-outline' as const,
      title: ja ? '消さずに残して、新しい構成を試す' : 'Explore more setups. Keep your favorites.',
      detail: ja ? `デスク数は${PLAN_LIMITS.free.maxWiringPlans}件から無制限に。写真も1デスク${PLAN_LIMITS.pro.maxPhotosPerDesk}枚まで保存。` : `Go from ${PLAN_LIMITS.free.maxWiringPlans} desks to unlimited, with up to ${PLAN_LIMITS.pro.maxPhotosPerDesk} photos per desk.`,
    },
    {
      icon: 'motion-play-outline' as const,
      title: ja ? 'こだわりが育つ過程を、いつでも' : 'Revisit every stage of your desk',
      detail: ja ? '自分のデスクの歴史を全期間再生。1年以上前の変化も振り返れます。' : 'Replay your own desk’s entire history, beyond the free plan’s one-year window.',
    },
  ]

  // ペイウォールが開いたことをトラッキング。
  // ここで screen() を呼ばないこと。画面遷移は RootNavigator がルート名 'Paywall' で
  // 自動記録しており、'PaywallScreen' を足すと同じ表示が2つの名前で二重に数えられる。
  // 流入元は paywall_viewed の reason で見る。
  React.useEffect(() => {
    // 表示価格も一緒に送る。ストアが返す価格と実際の請求額がずれていても、
    // 端末を手元で見ない限り気づけない（審査で落ちる類の不一致）
    const monthly = findPackageForPlan(packages, PAYWALL_PLANS[0])?.product
    analytics.track(EVENTS.PAYWALL_VIEWED, {
      reason,
      package_count: packages.length,
      ...(monthly ? {
        product: monthly.identifier,
        price_string: monthly.priceString,
        currency: monthly.currencyCode,
      } : {}),
    })
  }, [reason, packages])

  const handlePurchase = async () => {
    if (billingInFlightRef.current || !navigation.isFocused()) return
    // Pro かどうかの正本はサーバーの profile。ゲストのまま買うと機種変で復元できない
    if (!user) {
      promptLogin(navigation, lang, ja ? '購入と復元にはアカウントが必要です' : 'An account is required to purchase and restore.', openLoginFromPaywall)
      return
    }
    const pkg = findPackageForPlan(packages, selectedPlan)
    if (!pkg) {
      analytics.track(EVENTS.PURCHASE_FAILED, {
        reason,
        plan_id: selectedId,
        failure_stage: 'package_unavailable',
      })
      Alert.alert(
        ja ? '購入できません' : 'Unable to purchase',
        ja ? '選択したプランは現在利用できません。時間をおいて再試行してください。' : 'The selected plan is currently unavailable. Please try again later.',
      )
      return
    }
    billingInFlightRef.current = true
    const startedAt = Date.now()
    analytics.track(EVENTS.PURCHASE_STARTED, {
      reason,
      plan_id: selectedId,
      product: pkg.product?.identifier,
    })
    try {
      setPurchasing(true)
      const success = await purchase(pkg)
      if (success) {
        hapticSuccess()
        analytics.track(EVENTS.PAYWALL_PURCHASED, {
          reason,
          plan_id: selectedId,
          product: pkg.product?.identifier,
          duration_ms: Date.now() - startedAt,
        })
        const continueAfterPurchase = () => {
          if (!navigation.isFocused()) return
          if (!planId) {
            // 購入を待つ間に下へ引いて閉じていたら、ここで戻ると前の画面まで閉じる
            if (navigation.isFocused()) navigation.goBack()
            return
          }
          // nav-after-await-ok: 本人が「AIコーチを開く」を押したときだけ走り、行き先を名前で指すので、課金画面を閉じていても同じ場所へ着く
          navigation.navigate('MainTabs', {
            screen: 'PlanTab',
            params: { screen: 'AICoachChat', params: { planId }, initial: false },
          })
        }
        Alert.alert(
          ja ? 'Proにアップグレードしました' : 'Upgraded to Pro!',
          planId
            // 呼び名は入口（「AI」ボタン）・プラン表・画面の表題と同じ「AIコーチ」に揃える。
            // 「Proデスク診断」と別の名前で呼ぶと、買ったものが別の機能に見える
            ? (ja
                ? 'このデスクを添付しました。送信内容を確認して、AIコーチに相談できます。'
                : 'This desk is attached. Review what will be sent, then ask the AI coach.')
            : (ja ? 'すべての機能が利用可能になりました' : 'All Pro features are now unlocked.'),
          [{ text: planId ? (ja ? 'AIコーチを開く' : 'Open AI coach') : 'OK', onPress: continueAfterPurchase }],
        )
      } else {
        // 決済は通ったが entitlement が付かなかった。無言で終わると「押しても
        // 何も起きない」ように見えるので、必ず知らせる
        analytics.track(EVENTS.PURCHASE_ENTITLEMENT_MISSING, {
          reason,
          plan_id: selectedId,
          product: pkg.product?.identifier,
          duration_ms: Date.now() - startedAt,
        })
        Alert.alert(
          ja ? '反映に時間がかかっています' : 'Purchase is still processing',
          ja
            ? '購入は完了しましたが、まだ Pro が有効になっていません。しばらくしてから「購入を復元」をお試しください。'
            : 'Your purchase went through, but Pro is not active yet. Please try “Restore purchases” in a moment.',
        )
      }
    } catch (e: any) {
      // ユーザーが自分で閉じた場合は失敗として数えない
      if (e?.userCancelled) {
        analytics.track(EVENTS.PURCHASE_CANCELLED, {
          reason,
          plan_id: selectedId,
          product: pkg.product?.identifier,
          duration_ms: Date.now() - startedAt,
        })
      } else if (e?.code === '20') {
        // PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR（承認と購入のリクエスト・支払いの確認待ち）。
        // 失敗と出すと買い直されて承認の依頼が重なる。承認されれば Webhook で Pro が付く
        // （SDK が無い環境ではモックに差し替わり定数が無いので、import せず値で見る）
        analytics.track(EVENTS.PURCHASE_FAILED, {
          reason,
          plan_id: selectedId,
          failure_stage: 'payment_pending',
          duration_ms: Date.now() - startedAt,
        })
        Alert.alert(
          ja ? '承認を待っています' : 'Waiting for approval',
          ja
            ? '購入は承認待ちです。承認されると Pro が有効になります。'
            : 'Your purchase is pending approval. Pro will be activated once it is approved.',
        )
      } else {
        analytics.track(EVENTS.PURCHASE_FAILED, {
          reason,
          plan_id: selectedId,
          failure_stage: 'purchase',
          duration_ms: Date.now() - startedAt,
          ...errorProperties(e),
        })
        Alert.alert(ja ? 'エラー' : 'Error', localizedErrorMessage(e, lang, ja ? '購入に失敗しました。' : 'Purchase failed.'))
      }
    } finally {
      billingInFlightRef.current = false
      setPurchasing(false)
    }
  }

  const handleRestore = async () => {
    if (billingInFlightRef.current || !navigation.isFocused()) return
    if (!user) {
      promptLogin(navigation, lang, ja ? '購入と復元にはアカウントが必要です' : 'An account is required to purchase and restore.', openLoginFromPaywall)
      return
    }
    billingInFlightRef.current = true
    const startedAt = Date.now()
    analytics.track(EVENTS.PURCHASE_RESTORE_STARTED)
    try {
      setRestoring(true)
      // 復元はストア画面を出さないため、SDK が返さないと画面上の
      // すべての操作が無効のままになる。購入と違い再実行しても二重課金にはならない
      const restoredPro = await withTimeout(restore(), QUICK_TIMEOUT_MS)
      // 復元処理が通ったことと、実際に権利が戻ったことは別物。混ぜると
      // 「復元できた」件数が実態より多く見える
      analytics.track(
        restoredPro ? EVENTS.PURCHASE_RESTORED : EVENTS.PURCHASE_RESTORE_EMPTY,
        { duration_ms: Date.now() - startedAt },
      )
      Alert.alert(
        restoredPro ? (ja ? '復元しました' : 'Restored') : (ja ? '購入が見つかりません' : 'Nothing to restore'),
        restoredPro
          ? (ja ? '購入履歴を確認しました' : 'Your purchases have been restored.')
          : (ja
              ? '復元できる購入が見つかりませんでした。購入時と同じ Apple ID でサインインしているかご確認ください。'
              : 'No purchases were found to restore. Check that you are signed in with the same Apple ID used for the purchase.'),
        // 復元を待つ間に下へ引いて閉じていたら、ここで戻ると開いた元の画面まで閉じる（購入と同じ）
        [{ text: 'OK', onPress: () => { if (restoredPro && navigation.isFocused()) navigation.goBack() } }],
      )
    } catch (e: any) {
      analytics.track(EVENTS.PURCHASE_RESTORE_FAILED, {
        duration_ms: Date.now() - startedAt,
        ...errorProperties(e),
      })
      Alert.alert(ja ? 'エラー' : 'Error', localizedErrorMessage(e, lang, ja ? '購入履歴の復元に失敗しました。' : 'Restore failed.'))
    } finally {
      billingInFlightRef.current = false
      setRestoring(false)
    }
  }

  const handleDismiss = () => {
    if (billingInFlightRef.current || !navigation.isFocused()) return
    analytics.track(EVENTS.PAYWALL_DISMISSED, { reason })
    navigation.goBack()
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <AppIcon name="crown-outline" size={22} color={C.pro} />
          <Text style={[styles.brandText, { color: C.text }]}>MyDesk Pro</Text>
        </View>
        <TouchableOpacity style={[styles.closeBtn, { backgroundColor: C.chip }]} onPress={handleDismiss} disabled={purchasing || restoring} accessibilityRole="button" accessibilityLabel={ja ? '閉じる' : 'Close'}>
          <AppIcon name={ICONS.close} size={22} color={C.textSub} centered />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <Text style={[styles.title, { color: C.text }]}>
            {headline}
          </Text>
          <Text style={[styles.subtitle, { color: C.textSub }]}>
            {introduction}
          </Text>
        </View>

        <View style={[styles.benefits, { backgroundColor: C.card }]}>
          {benefits.map((benefit, index) => (
            <View key={benefit.icon} style={[styles.benefitRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator }]}>
              <View style={[styles.benefitIcon, { backgroundColor: accent + '18' }]}>
                <AppIcon name={benefit.icon} size={23} color={C.accentIcon} centered />
              </View>
              <View style={styles.benefitBody}>
                <Text style={[styles.benefitTitle, { color: C.text }]}>{benefit.title}</Text>
                <Text style={[styles.benefitDetail, { color: C.textSub }]}>{benefit.detail}</Text>
              </View>
            </View>
          ))}
        </View>

        {(!reason || reason === 'manual' || reason === 'aiFeatures') && (
          <View style={[styles.coachExample, { borderColor: C.border }]}>
            <Text style={[styles.exampleLabel, { color: C.accentText }]}>{ja ? 'たとえば、AIコーチにこんな相談' : 'A question for your AI coach'}</Text>
            <Text style={[styles.exampleText, { color: C.text }]}>{ja ? '「予算3万円。今のデスク、どこから変える？」' : '“With $200, what would you change about my desk?”'}</Text>
            <Text style={[styles.benefitDetail, { color: C.textSub }]}>
              {planId
                ? (ja ? '購入後は、このデスクを添付して相談を始められます。' : 'After upgrading, start a conversation with this desk attached.')
                : (ja ? 'デスクの機材や配線を添えて、具体的に相談できます。' : 'Attach your desk’s gear and wiring for advice that fits your setup.')}
            </Text>
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: C.text }]}>{ja ? 'あなたのペースで、Proを始める' : 'Choose your pace. Get every Pro feature.'}</Text>
        <Text style={[styles.sectionNote, { color: C.textSub }]}>{ja ? 'どちらのプランも、すべてのPro機能が使えます。' : 'Monthly or yearly, the same Pro features are included.'}</Text>
        <View
          style={styles.planOptions}
          accessibilityRole="radiogroup"
          accessibilityLabel={ja ? 'お支払い期間' : 'Billing period'}
        >
          {PAYWALL_PLANS.map((p) => {
            const on = selectedId === p.id
            const yearly = p.id === 'pro_yearly'
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.planOption, { backgroundColor: on ? accent + '18' : C.card, borderColor: on ? C.accentIcon : C.border }]}
                onPress={() => {
                  setSelectedId(p.id)
                  analytics.track(EVENTS.PAYWALL_PLAN_SELECTED, { reason, plan_id: p.id })
                }}
                disabled={purchasing || restoring}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: purchasing || restoring }}
              >
                <AppIcon name={on ? 'radiobox-marked' : 'radiobox-blank'} size={23} color={on ? C.accentIcon : C.textMuted} />
                <View style={styles.benefitBody}>
                  <View style={styles.planHeading}>
                    <Text style={[styles.planName, { color: C.text }]}>{yearly ? (ja ? '年額プラン' : 'Yearly') : (ja ? '月額プラン' : 'Monthly')}</Text>
                    <Text style={[styles.planTag, { color: C.textSub }]}>{yearly ? (ja ? 'じっくり続けるなら' : 'For the long run') : (ja ? 'まずは1か月から' : 'One month at a time')}</Text>
                  </View>
                  <Text style={[styles.planPrice, { color: C.text }]} maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}>
                    {priceOf(p)}<Text style={styles.planPeriod}>{ja ? p.periodJa : p.periodEn}</Text>
                  </Text>
                  {yearly && !!subOf(p) && <Text style={[styles.planSaving, { color: C.accentText }]} maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}>{subOf(p)}</Text>}
                </View>
              </TouchableOpacity>
            )
          })}
        </View>

        <TouchableOpacity style={styles.comparisonToggle} onPress={() => setShowComparison(current => !current)} accessibilityRole="button" accessibilityState={{ expanded: showComparison }}>
          <Text style={[styles.comparisonLabel, { color: C.textSub }]}>{ja ? 'FreeとProの全機能を比較' : 'Compare all Free and Pro features'}</Text>
          <AppIcon name={showComparison ? 'chevron-up' : 'chevron-down'} size={20} color={C.textSub} />
        </TouchableOpacity>
        {showComparison && <View style={styles.comparison}><PlanComparisonTable paidPlan={selectedPlan} currentTier={tier} /></View>}

        {/* ─── 購入復元 ─── */}
        <TouchableOpacity onPress={handleRestore} disabled={purchasing || restoring || isWeb} style={[styles.restoreBtn, isWeb && styles.purchaseBtnDisabled]} accessibilityRole="button">
          {restoring
            ? <ActivityIndicator size="small" color={C.textMuted} />
            : <Text style={[styles.restoreText, { color: C.textMuted }]}>
                {isWeb ? (ja ? 'モバイルアプリで購入を復元' : 'Restore in the mobile app') : (ja ? '購入を復元' : 'Restore Purchases')}
              </Text>
          }
        </TouchableOpacity>

        {/* 法的注記 */}
        <Text
          style={[styles.legal, { color: C.textSub }]}
          maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        >
          {isWeb
            ? (ja ? 'サブスクリプションはiOS・Androidアプリで管理できます。' : 'Manage your subscription in the iOS or Android app.')
            : ja
            ? Platform.OS === 'ios'
              ? 'App Storeアカウントに請求されます。サブスクリプションは期間終了の24時間前までに解約しない限り自動更新されます。解約はApp Storeのアカウント設定からいつでも行えます。'
              : 'Google Playアカウントに請求されます。Google Playの定期購入画面で解約しない限り自動更新されます。定期購入はGoogle Playからいつでも管理できます。'
            : Platform.OS === 'ios'
              ? 'Payment will be charged to your App Store account. Subscriptions renew automatically unless canceled at least 24 hours before the end of the current period. Manage or cancel anytime in your account settings.'
              : 'Payment will be charged to your Google Play account. The subscription renews automatically unless canceled in Google Play. You can manage it anytime from Google Play subscriptions.'
          }
        </Text>

        {/* 利用規約・プライバシーポリシー（審査要件） */}
        <View style={styles.legalLinks}>
          <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)} accessibilityRole="link">
            <Text style={[styles.legalLink, { color: C.textSub }]} maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}>
              {ja ? '利用規約' : 'Terms of Use'}
            </Text>
          </TouchableOpacity>
          <Text style={[styles.legal, { color: C.textMuted }]}>・</Text>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_URL)} accessibilityRole="link">
            <Text style={[styles.legalLink, { color: C.textSub }]} maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}>
              {ja ? 'プライバシーポリシー' : 'Privacy Policy'}
            </Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* 比較表が長くても、開いた直後から購入操作を見失わないよう下端に固定する。 */}
      <View style={[styles.purchaseDock, { backgroundColor: C.card, borderTopColor: C.border }]}>
        <Text style={[styles.billingSummary, { color: C.text }]} maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}>
          {selectedPlan.id === 'pro_yearly'
            ? (ja ? `年額 ${priceOf(selectedPlan)}・年1回の一括払い` : `${priceOf(selectedPlan)} per year · billed annually`)
            : (ja ? `月額 ${priceOf(selectedPlan)}・毎月のお支払い` : `${priceOf(selectedPlan)} per month · billed monthly`)}
        </Text>
        <TouchableOpacity
          style={[styles.purchaseBtn, { backgroundColor: accent }, (purchasing || restoring || isLoading || isWeb) && styles.purchaseBtnDisabled]}
          onPress={handlePurchase}
          disabled={purchasing || restoring || isLoading || isWeb}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityState={{ disabled: purchasing || restoring || isLoading || isWeb, busy: purchasing || isLoading }}
        >
          {purchasing || isLoading ? (
            <ActivityIndicator color={C.onAccent} />
          ) : (
            <Text style={[styles.purchaseBtnText, { color: C.onAccent }]}>
              {isWeb
                ? (ja ? 'iOS・Androidアプリから購入できます' : 'Purchase in the iOS or Android app')
                : reason === 'aiFeatures'
                  ? (ja ? 'ProでAIコーチに相談する' : 'Unlock your AI coach with Pro')
                  : (ja ? 'Proで理想のデスクに近づく' : 'Build your next desk with Pro')}
            </Text>
          )}
        </TouchableOpacity>

        <Text
          style={[styles.purchaseNote, { color: C.textSub }]}
          maxFontSizeMultiplier={IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER}
        >
          {isWeb
            ? (ja ? '購入と復元はモバイルアプリで利用できます。' : 'Purchases and restores are available in the mobile app.')
            : (ja ? '自動更新・ストアの設定からいつでも解約できます' : 'Auto-renews. Cancel anytime in your store settings.')}
        </Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: UI_METRICS.formGutter, paddingVertical: 8 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { fontSize: 16, fontWeight: '800' },
  closeBtn: { width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize, borderRadius: UI_METRICS.pillRadius, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: UI_METRICS.formGutter, paddingTop: 16, paddingBottom: 24, width: '100%', maxWidth: 600, alignSelf: 'center' },
  header: { marginBottom: 24 },
  title: { fontSize: 29, lineHeight: 39, fontWeight: '800', letterSpacing: -0.5, marginBottom: 12 },
  subtitle: { fontSize: 14, lineHeight: 23 },
  benefits: { borderRadius: UI_METRICS.cardRadius, paddingHorizontal: 16, marginBottom: 16 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 16 },
  benefitIcon: { width: 42, height: 42, borderRadius: UI_METRICS.controlRadius, alignItems: 'center', justifyContent: 'center' },
  benefitBody: { flex: 1, minWidth: 0 },
  benefitTitle: { fontSize: 15, fontWeight: '700', lineHeight: 22, marginBottom: 4 },
  benefitDetail: { fontSize: 13, lineHeight: 20 },
  coachExample: { borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.cardRadius, padding: 16, gap: 8, marginBottom: 24 },
  exampleLabel: { fontSize: 12, fontWeight: '700', lineHeight: 18 },
  exampleText: { fontSize: 15, fontWeight: '600', lineHeight: 23 },
  sectionTitle: { fontSize: 17, fontWeight: '800', lineHeight: 25, marginTop: 8, marginBottom: 4 },
  sectionNote: { fontSize: 12, lineHeight: 18, marginBottom: 14 },
  planOptions: { gap: 10 },
  planOption: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderRadius: UI_METRICS.cardRadius, padding: 16, gap: 12 },
  planHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 10, rowGap: 4, marginBottom: 8 },
  planName: { fontSize: 15, fontWeight: '800', lineHeight: 21 },
  planTag: { fontSize: 12, lineHeight: 18 },
  planPrice: { fontSize: 24, fontWeight: '800', lineHeight: 32 },
  planPeriod: { fontSize: 14, fontWeight: '500' },
  planSaving: { fontSize: 13, fontWeight: '700', lineHeight: 20, marginTop: 4 },
  comparisonToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: UI_METRICS.touchMinSize, marginTop: 12 },
  comparisonLabel: { fontSize: 13, lineHeight: 20, flexShrink: 1 },
  comparison: { marginTop: 12, marginBottom: 16 },
  billingSummary: { fontSize: 13, fontWeight: '600', lineHeight: 20, textAlign: 'center', marginBottom: 8 },
  purchaseNote: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8, paddingHorizontal: 8 },

  purchaseBtn: {
    borderRadius: UI_METRICS.cardRadius,
    minHeight: UI_METRICS.buttonHeight,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  purchaseBtnDisabled: { opacity: 0.6 },
  purchaseBtnText: { fontSize: 15, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
  purchaseDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: UI_METRICS.formGutter,
    paddingTop: 10,
    paddingBottom: 8,
  },

  restoreBtn:  { alignItems: 'center', paddingVertical: 12, marginBottom: 8 },
  restoreText: { fontSize: 13 },

  legal: { fontSize: 12, textAlign: 'center', lineHeight: 18 },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 4, marginTop: 10 },
  legalLink: { fontSize: 12, lineHeight: 18, textDecorationLine: 'underline', paddingVertical: 12 },
})
