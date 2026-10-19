import { RefObject, useCallback, useEffect, useRef } from 'react'
import { HostInstance, Keyboard, ScrollView, TextInput } from 'react-native'
import { keyboardRevealDelta } from '../utils/keyboardReveal'

const MARGIN = 12

/**
 * キーボードが開いたとき、押した入力欄がその裏に入っていたら見える位置まで送る。
 *
 * RN は ScrollView の中の欄を自動では送らない（automaticallyAdjustKeyboardInsets は
 * KeyboardAvoidingView と併用すると余白が二重になる）。欄ごとに onFocus を足すと付け忘れるので、
 * キーボードが開いた時点で選ばれている欄を拾う。キーボードが開いたまま別の欄を押したときは
 * 押せた時点で見えているので、ここで扱うのは開いた瞬間だけでよい。
 * bottomInset はスクロール領域の下端に重なる絶対配置の下部バーの高さ
 */
export function useKeyboardReveal(scrollRef: RefObject<ScrollView | null>, bottomInset = 0) {
  const insetRef = useRef(bottomInset)
  insetRef.current = bottomInset

  const reveal = useCallback(() => {
    const scroll = scrollRef.current
    const field = TextInput.State.currentlyFocusedInput()
    // getInnerViewRef は実行時にはあるが型に載っていない。getInnerViewNode の番号では Fabric の measureLayout が測れない
    const inner = (scroll as (ScrollView & { getInnerViewRef?: () => HostInstance | null }) | null)?.getInnerViewRef?.()
    const keyboard = Keyboard.metrics()
    if (!scroll || !field || !inner || !keyboard) return
    // 別のモーダルの欄が選ばれているときは、この一覧の子ではないので測れずに終わる
    field.measureLayout(inner, () => {
      field.measureInWindow((_fx, fieldY, _fw, fieldHeight) => {
        scroll.getNativeScrollRef()?.measureInWindow((_sx, scrollY, _sw, scrollHeight) => {
          inner.measureInWindow((_ix, innerY) => {
            const delta = keyboardRevealDelta({
              fieldY, fieldHeight, scrollY, scrollHeight,
              keyboardY: keyboard.screenY,
              bottomInset: insetRef.current,
              margin: MARGIN,
            })
            if (delta > 0) scroll.scrollTo({ y: scrollY - innerY + delta, animated: true })
          })
        })
      })
    }, () => {})
  }, [scrollRef])

  useEffect(() => {
    let frame: number | null = null
    // didShow の時点では KeyboardAvoidingView が縮めた高さの反映が1フレーム遅れることがある
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (frame != null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { frame = null; reveal() })
    })
    return () => {
      sub.remove()
      if (frame != null) cancelAnimationFrame(frame)
    }
  }, [reveal])

  return reveal
}
