import { useRef } from 'react'
import { createIntentSync, IntentSync, IntentSyncHandlers } from '../utils/intentSync'

/**
 * 画面の寿命のあいだ同じ IntentSync を返す。handlers は毎回の描画で差し替わるので、
 * 送信時点のユーザー・言語を読める（作った時点の値に固定しない）。
 * 画面を閉じても送信は続く。押した結果はサーバーへ届けたい
 */
export function useIntentSync<K>(handlers: IntentSyncHandlers<K>): IntentSync<K> {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const syncRef = useRef<IntentSync<K> | null>(null)
  if (!syncRef.current) {
    syncRef.current = createIntentSync<K>({
      send: (key, value) => handlersRef.current.send(key, value),
      onConfirmed: (key, value) => handlersRef.current.onConfirmed?.(key, value),
      onSettled: (key, value) => handlersRef.current.onSettled?.(key, value),
      onFailed: (key, value) => handlersRef.current.onFailed(key, value),
    })
  }
  return syncRef.current
}
