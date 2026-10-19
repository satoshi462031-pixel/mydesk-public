import { Alert } from '../utils/alert'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useApp } from '../context/AppContext'
import { analytics } from '../services/analytics'

type UndoAction = {
  message: string
  onUndo: () => void | Promise<void>
  /**
   * Undo されずに取り消し期限が過ぎたときに一度だけ呼ばれる。
   * 写真の実ファイル削除のような「Undo できなくなってからでないと実行できない後始末」に使う。
   * 期限切れのほか、次の Undo で上書きされたとき・画面を離れたときにも確定として呼ばれる。
   */
  onExpire?: () => void | Promise<void>
}

export function useUndoSnackbar(durationMs = 5000) {
  const { lang } = useApp()
  const langRef = useRef(lang)
  langRef.current = lang
  const [action, setAction] = useState<UndoAction | null>(null)
  const [undoing, setUndoing] = useState(false)
  const undoingRef = useRef(false)
  const [blocked, setBlockedState] = useState(false)
  const blockedRef = useRef(false)
  const actionRef = useRef<UndoAction | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const setBlocked = useCallback((value: boolean) => {
    blockedRef.current = value
    setBlockedState(value)
  }, [])

  // 保留中のアクションを「Undo されなかった」として確定させる。
  // actionRef を先に空にしてから呼ぶので、二重に発火することはない。
  const settle = useCallback(() => {
    const pending = actionRef.current
    actionRef.current = null
    clearTimer()
    void Promise.resolve().then(() => pending?.onExpire?.()).catch((error: unknown) => {
      try { analytics.error('undo_expiration', error) } catch {}
      Alert.alert(langRef.current === 'ja' ? '削除後の処理を完了できませんでした' : 'Could not finish deletion')
    })
  }, [clearTimer])

  const dismiss = useCallback(() => {
    clearTimer()
    actionRef.current = null
    setAction(null)
  }, [clearTimer])

  const showUndo = useCallback((next: UndoAction) => {
    // 前の削除はもう取り消せない（スナックバーが差し替わる）ので、ここで確定させる
    settle()
    actionRef.current = next
    setAction(next)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      settle()
      setAction(null)
    }, durationMs)
  }, [settle, durationMs])

  const performUndo = useCallback(async function retryUndo(current: UndoAction): Promise<void> {
    if (undoingRef.current || blockedRef.current) return
    undoingRef.current = true
    // 復旧を選んだ後は、保存に失敗しても写真などの削除を確定させない。
    const retryable = { ...current, onExpire: undefined }
    if (actionRef.current === current) {
      clearTimer()
      actionRef.current = retryable
      setAction(retryable)
    }
    setUndoing(true)
    try {
      await current.onUndo()
      if (actionRef.current === retryable) dismiss()
    } catch (error) {
      try { analytics.error('undo_restore', error) } catch {}
      Alert.alert(
        lang === 'ja' ? '元に戻せませんでした' : 'Could not undo',
        lang === 'ja'
          ? '通信環境や端末の空き容量を確認して、もう一度お試しください。'
          : 'Check your connection and available storage, then try again.',
        [
          { text: lang === 'ja' ? '閉じる' : 'Close', style: 'cancel' },
          { text: lang === 'ja' ? 'もう一度試す' : 'Try again', onPress: () => { void retryUndo(retryable) } },
        ],
      )
    } finally {
      undoingRef.current = false
      setUndoing(false)
    }
  }, [clearTimer, dismiss, lang])

  const undo = useCallback(async () => {
    const current = actionRef.current
    if (current) await performUndo(current)
  }, [performUndo])

  // 画面を離れてもタイマーが消えるだけで確定処理が走らないと、後始末が永久に行われない
  useEffect(() => () => settle(), [settle])

  // 戻り値を memo 化する。毎回あたらしいオブジェクトを返すと、これを使う画面側が
  // 依存配列に showUndo だけを書くことになり（オブジェクトを入れると毎レンダー作り直しになる）、
  // exhaustive-deps が満たせない。ここを固定すれば呼ぶ側は素直に書ける。
  // 中身が変わるのはスナックバーの出入りと undo 中だけなので、作り直しは数回で済む
  return useMemo(() => ({
    message: action?.message ?? '',
    visible: action !== null,
    undoing,
    blocked,
    setBlocked,
    showUndo,
    undo,
    dismiss,
  }), [action, undoing, blocked, setBlocked, showUndo, undo, dismiss])
}
