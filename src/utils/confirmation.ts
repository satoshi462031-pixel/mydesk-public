import { Alert } from './alert'
import { Linking, Platform } from 'react-native'

interface ConfirmationOptions {
  title: string
  message: string
  cancelLabel: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
  onCancel?: () => void
}

export function showConfirmation({
  title,
  message,
  cancelLabel,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmationOptions): void {
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel', onPress: onCancel },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ], { onDismiss: onCancel })
}

export function showMessage(title: string, message?: string): void {
  Alert.alert(title, message)
}

/**
 * フォトライブラリの許可が無いときの案内。
 *
 * iOS は一度「許可しない」を選ぶとアプリから二度と許可を聞けないので、ここで
 * 本体の設定を開けないと、ユーザーは自分で設定アプリの中からこのアプリを探すことになる。
 * 以前は4画面が別々の文言で「許可してください」と言うだけだった。
 */
export function showPhotoPermissionAlert(lang: 'ja' | 'en'): void {
  const ja = lang === 'ja'
  const title = ja ? '写真へのアクセスが必要です' : 'Photo access required'
  const message = ja
    ? '設定アプリで MyDesk の「写真」を許可すると、写真を選べるようになります。'
    : 'Allow Photos for MyDesk in the Settings app to choose photos.'
  if (Platform.OS === 'web') {
    showMessage(title, message)
    return
  }
  Alert.alert(title, message, [
    { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
    { text: ja ? '設定を開く' : 'Open Settings', onPress: () => { void Linking.openSettings() } },
  ])
}
