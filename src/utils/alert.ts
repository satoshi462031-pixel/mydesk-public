import { Alert as NativeAlert, AlertButton, AlertOptions, Platform } from 'react-native'

export interface AppAlert {
  id: number
  title: string
  message?: string
  buttons: AlertButton[]
  options?: AlertOptions
}

const queue: AppAlert[] = []
let nextId = 0
const listeners = new Set<() => void>()
const notify = () => { listeners.forEach(listener => listener()) }

export function subscribeAlerts(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function currentAlert(): AppAlert | null {
  return queue[0] ?? null
}

export function finishAlert(alert: AppAlert, index?: number): void {
  if (queue[0] !== alert) return
  queue.shift()
  notify()
  if (index == null) alert.options?.onDismiss?.()
  else alert.buttons[index]?.onPress?.()
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions): void {
    // Androidは4個目以降を切り捨て、WebのAlertは何もしない。
    if (Platform.OS !== 'web' && (buttons?.length ?? 0) <= 3) {
      NativeAlert.alert(title, message, buttons, options)
      return
    }
    queue.push({ id: ++nextId, title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }], options })
    notify()
  },
}
