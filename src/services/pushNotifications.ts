// フォロー中の人のデスク更新（085）と、自分のデスクへの拍手（096）を通知で受け取る。
//
// 送るのはサーバー（notify-followers / notify-claps）で、ここは端末の宛先（Expo push token）を
// アカウントに結び付ける・外すだけ。許可のダイアログは、通知が役に立つと分かる
// 瞬間（初めて誰かをフォローした直後・デスクを初めて公開した直後）にだけ出す。起動時に出すと、
// 何の通知かも分からないまま断られ、iOS は二度と聞かせてくれない。
//
// AndroidはFCMを設定したビルドで専用の公開スイッチを有効にする。
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Linking, Platform } from 'react-native'
import { PUSH_NOTIFICATIONS_ENABLED } from '../constants/features'
import { supabase } from '../supabase/client'
import { analytics, EVENTS } from './analytics'

// アプリを開いている最中に届いた通知も出す。出さないと、開いている人ほど更新に気づかない
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: PUSH_NOTIFICATIONS_ENABLED && supported,
    shouldShowList: PUSH_NOTIFICATIONS_ENABLED && supported,
    // Androidはfalseにすると前景の通知アラートも抑制する。音の設定はOSのチャンネルに任せる。
    shouldPlaySound: PUSH_NOTIFICATIONS_ENABLED && supported && Platform.OS === 'android',
    shouldSetBadge: false,
  }),
})

const supported = Platform.OS === 'ios'
  || (Platform.OS === 'android' && process.env.EXPO_PUBLIC_ANDROID_PUSH_ENABLED === 'true')

export function isPushSupported(): boolean {
  return supported
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('default', {
    name: 'MyDesk',
    importance: Notifications.AndroidImportance.DEFAULT,
  })
}

export async function openPushSettings(): Promise<void> {
  const packageName = Constants.expoConfig?.android?.package
  if (Platform.OS === 'android' && packageName) {
    try {
      await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: packageName },
      ])
      return
    } catch {
      // 古いOSやメーカー独自の設定画面ではアプリ設定へ戻す。
    }
  }
  await Linking.openSettings()
}

export type PushPermissionDebugResult = {
  supported: boolean
  beforeStatus: Notifications.PermissionStatus
  afterStatus: Notifications.PermissionStatus
  canAskAgain: boolean
  prompted: boolean
}

async function resolvePermission(prompt: boolean, trackAnswer: boolean): Promise<PushPermissionDebugResult> {
  if (!supported) {
    return {
      supported: false,
      beforeStatus: Notifications.PermissionStatus.UNDETERMINED,
      afterStatus: Notifications.PermissionStatus.UNDETERMINED,
      canAskAgain: false,
      prompted: false,
    }
  }

  await ensureAndroidChannel()
  const before = await Notifications.getPermissionsAsync()
  let after = before
  let prompted = false
  if (before.status !== 'granted' && prompt && before.canAskAgain) {
    prompted = true
    after = await Notifications.requestPermissionsAsync()
    if (trackAnswer) {
      analytics.track(EVENTS.PUSH_PERMISSION_ANSWERED, { granted: after.status === 'granted' })
    }
  }

  return {
    supported: true,
    beforeStatus: before.status,
    afterStatus: after.status,
    canAskAgain: after.canAskAgain,
    prompted,
  }
}

async function currentToken(): Promise<string | null> {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined
  if (!projectId) return null
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
  return data || null
}

/**
 * 許可があれば、この端末をいまのアカウントの宛先として登録する。
 * prompt: まだ聞いていなければ許可のダイアログを出す（フォローした直後だけ true）
 */
export async function registerPushToken(lang: 'ja' | 'en', { prompt }: { prompt: boolean }): Promise<void> {
  if (!PUSH_NOTIFICATIONS_ENABLED || !supported) return
  try {
    const permission = await resolvePermission(prompt, true)
    if (permission.afterStatus !== 'granted') return
    const token = await currentToken()
    if (!token) return
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_lang: lang })
    if (error) throw error
  } catch (error) {
    // シミュレーター・圏外では token が取れない。次の起動で登録し直す
    if (__DEV__) console.warn('[push] registration failed', error)
  }
}

/**
 * 設定画面の「通知が届かない」行に使う。denied は OS が二度と聞かせてくれない状態で、
 * 端末の設定アプリへ送るしかない。undetermined はまだ聞いていないので、その場で聞ける
 */
export type PushPermissionState = 'unsupported' | 'granted' | 'undetermined' | 'denied'

export async function getPushPermissionState(): Promise<PushPermissionState> {
  if (!PUSH_NOTIFICATIONS_ENABLED || !supported) return 'unsupported'
  try {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync()
    if (status === 'granted') {
      if (Platform.OS === 'android') {
        const channel = await Notifications.getNotificationChannelAsync('default')
        if (channel?.importance === Notifications.AndroidImportance.NONE) return 'denied'
      }
      return 'granted'
    }
    return canAskAgain ? 'undetermined' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/** 開発ビルド専用の確認入口。分析やサーバー登録をせず、OSの許可状態とダイアログだけを検査する。 */
export async function debugPushPermissionPrompt(): Promise<PushPermissionDebugResult> {
  return resolvePermission(true, false)
}

/**
 * この端末をいまのアカウントの宛先から外す。ログアウトの前（セッションが生きているうち）に呼ぶ。
 * 外さないと、ログアウトした人のフォロー先の通知が、次にこの端末を使う人へ届き続ける
 */
export async function unregisterPushToken(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return
  try {
    const { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted') return
    await ensureAndroidChannel()
    const token = await currentToken()
    if (!token) return
    await supabase.rpc('unregister_push_token', { p_token: token })
  } catch {
    // 外せなくても、次にこの端末でログインした人の登録が token ごと上書きする
  }
}

/** 通知を押したときに開く URL（共有リンクと同じ mydesk://setup/:deskId） */
export function notificationUrl(response: Notifications.NotificationResponse | null | undefined): string | null {
  const url = response?.notification.request.content.data?.url
  return typeof url === 'string' && url.startsWith('mydesk://') ? url : null
}
