import { Alert } from '../utils/alert'
import { NavigationProp, ParamListBase } from '@react-navigation/native'
import { useEffect, useRef } from 'react'

/** 保存していない変更を捨てて進むかを聞く。破棄を選んだときだけ onDiscard を呼ぶ */
export function confirmDiscardChanges(lang: 'ja' | 'en', onDiscard: () => void, onCancel?: () => void): void {
  Alert.alert(
    lang === 'en' ? 'Discard changes?' : '変更を破棄しますか？',
    lang === 'en' ? 'Your unsaved changes will be lost.' : '保存していない内容は失われます。',
    [
      { text: lang === 'en' ? 'Keep editing' : '編集を続ける', style: 'cancel', onPress: onCancel },
      { text: lang === 'en' ? 'Discard' : '破棄する', style: 'destructive', onPress: onDiscard },
    ], { onDismiss: onCancel },
  )
}

/**
 * 保存ボタン方式の入力画面で、保存せずに離れるときに確認を出す。
 * スワイプや戻るボタンで離れると、入力が何も言われずに消えていた（ガジェット追加画面だけ確認があった）。
 *
 * shouldConfirm は離れる瞬間に呼ぶ。保存のために自分で戻るときは false を返すこと
 * （保存中の印を先に立ててから goBack する）。
 */
export function useConfirmDiscard(
  navigation: Pick<NavigationProp<ParamListBase>, 'addListener' | 'dispatch' | 'isFocused'>,
  shouldConfirm: () => boolean,
  lang: 'ja' | 'en',
): void {
  // 入力のたびに購読し直さないよう、最新の判定は ref 経由で読む
  const shouldConfirmRef = useRef(shouldConfirm)
  const pendingRef = useRef<object | null>(null)
  const discardedRef = useRef(false)
  shouldConfirmRef.current = shouldConfirm

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (discardedRef.current || !shouldConfirmRef.current()) return
      event.preventDefault()
      if (pendingRef.current) return
      const ticket = {}
      pendingRef.current = ticket
      confirmDiscardChanges(lang, () => {
        if (pendingRef.current !== ticket) return
        pendingRef.current = null
        if (!navigation.isFocused() || !shouldConfirmRef.current()) return
        discardedRef.current = true
        navigation.dispatch(event.data.action)
      }, () => { if (pendingRef.current === ticket) pendingRef.current = null })
    })
    return () => { pendingRef.current = null; unsubscribe() }
  }, [navigation, lang])
}
