import type { AlertButton, AlertOptions } from 'react-native'

export interface BrowserDialogs {
  alert: (text: string) => void
  confirm: (text: string) => boolean
  prompt: (text: string, defaultValue?: string) => string | null
}

/**
 * react-native-web の Alert.alert は何もしない。147 か所の確認・お知らせが Web では黙って消え、
 * 削除やログインのように「押した先の onPress で進む」操作はボタンを押しても何も起きなかった。
 * 呼び出し側を書き換えず、ブラウザの alert / confirm / prompt で同じボタンの流れを再現する。
 */
export function webAlert(
  dialogs: BrowserDialogs,
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
): void {
  const text = message ? `${title}\n\n${message}` : title
  const list = buttons ?? []
  const cancel = list.find((button) => button.style === 'cancel')
  const actions = list.filter((button) => button !== cancel)
  const dismiss = () => {
    cancel?.onPress?.()
    options?.onDismiss?.()
  }

  if (actions.length === 0) {
    dialogs.alert(text)
    if (cancel) cancel.onPress?.()
    else options?.onDismiss?.()
    return
  }
  if (actions.length === 1 && !cancel) {
    dialogs.alert(text)
    actions[0].onPress?.()
    return
  }
  if (actions.length === 1) {
    if (dialogs.confirm(`${text}\n\n→ ${actions[0].text ?? 'OK'}`)) actions[0].onPress?.()
    else dismiss()
    return
  }
  // 選択肢が3つ以上ある（ログイン／新規登録など）ときは番号で選ばせる。confirm は2択しか出せない
  const choices = actions.map((button, index) => `${index + 1}. ${button.text ?? ''}`).join('\n')
  const answer = dialogs.prompt(`${text}\n\n${choices}`, '1')
  const picked = answer == null ? undefined : actions[Number(answer.trim()) - 1]
  if (picked) picked.onPress?.()
  else dismiss()
}
