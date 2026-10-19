import * as Sentry from '@sentry/react-native'
import * as Updates from 'expo-updates'

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? ''
const enabled = !__DEV__ && dsn.startsWith('https://')

Sentry.init({
  dsn,
  enabled,
  environment: __DEV__ ? 'development' : 'production',
  enableNativeCrashHandling: true,
  enableAutoSessionTracking: true,
  sendDefaultPii: false,
  attachScreenshot: false,
  attachViewHierarchy: false,
  tracesSampleRate: 0,
  beforeSend(event) {
    // 例外メッセージやBreadcrumbのdataには自由入力が混ざりうる。原因箇所の
    // stack traceと固定タグだけを残し、本文・URL・ユーザー識別子は送らない。
    event.user = undefined
    event.request = undefined
    if (event.exception?.values) {
      event.exception.values = event.exception.values.map((value) => ({
        ...value,
        value: value.type ?? 'Error',
      }))
    }
    event.breadcrumbs = event.breadcrumbs?.map(({ message: _message, data: _data, ...breadcrumb }) => breadcrumb)
    return event
  },
})

if (enabled) {
  Sentry.setTag('expo_update_id', Updates.updateId ?? 'embedded')
  Sentry.setTag('expo_is_embedded_update', String(Updates.isEmbeddedLaunch))
  if (Updates.runtimeVersion) Sentry.setTag('expo_runtime_version', Updates.runtimeVersion)
}

export function captureCrash(error: unknown, operation: string): void {
  if (!enabled) return
  // 記録側の失敗で、呼び出し元のエラー通知や復旧処理を止めない。
  try {
    Sentry.withScope((scope) => {
      scope.setTag('operation', operation)
      Sentry.captureException(error)
    })
  } catch {}
}

// フィードバックと Sentry の事象を結ぶ手がかり。beforeSend で利用者の識別子を
// 落としているので、Sentry 側からは誰の事象か辿れない
export function lastCrashEventId(): string | undefined {
  try {
    return enabled ? Sentry.lastEventId() : undefined
  } catch {
    return undefined
  }
}

export { Sentry }
