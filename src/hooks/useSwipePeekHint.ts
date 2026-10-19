import AsyncStorage from '@react-native-async-storage/async-storage'
import { useIsFocused } from '@react-navigation/native'
import { MutableRefObject, useEffect } from 'react'
import type { Swipeable } from 'react-native-gesture-handler'
import { useSpotlight } from '../context/SpotlightContext'
import { getSwipeInteractionVersion, peekSwipeableRow, SwipePeekSides } from '../utils/swipeableRow'

// 画面遷移と一覧の初回描画が落ち着いてから動かす
const DELAY_MS = 700
// タブの中身は押された後のフレームでマウントされるので、行がまだ無ければ少し待ち直す
const MAX_ATTEMPTS = 4

/**
 * 横スワイプで出る操作には画面上の入口が無いので、その一覧を初めて見たときに
 * 1行だけ少し揺らして見せる。端末で一度きり。
 *
 * 見せた記録は端末に残し、アカウントを替えても消さない（操作の知識は同じ人に残るので、
 * localUserDataKeys の削除対象には入れない）。ガイドツアーが画面に出ている間は暗幕と重なるので待つ
 * （作成の流れを離れて案内が隠れている間まで待つと、その間どの一覧でも出なくなる）。
 */
export function useSwipePeekHint({ storageKey, rowId, rows, sides = 'both', active = true }: {
  storageKey: string
  /** 揺らす行。null の間は何もしない（一覧が空・見せる条件を満たしていない） */
  rowId: string | null
  rows: MutableRefObject<Map<string, Swipeable>>
  sides?: SwipePeekSides
  /** タブに埋め込まれた一覧で、そのタブが出ているか */
  active?: boolean
}) {
  const isFocused = useIsFocused()
  const { shown: tourShown } = useSpotlight()

  useEffect(() => {
    if (!isFocused || !active || !rowId || tourShown) return
    const interactionVersion = getSwipeInteractionVersion()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopPeek: (() => void) | null = null

    const attempt = (n: number) => {
      timer = setTimeout(() => {
        AsyncStorage.getItem(storageKey).then((seen) => {
          if (seen || cancelled || interactionVersion !== getSwipeInteractionVersion()) return
          const row = rows.current.get(rowId)
          if (!row) {
            if (n + 1 < MAX_ATTEMPTS) attempt(n + 1)
            return
          }
          stopPeek = peekSwipeableRow(row, sides)
          if (stopPeek) void AsyncStorage.setItem(storageKey, '1').catch(() => {})
        }).catch(() => {})
      }, DELAY_MS)
    }
    attempt(0)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      stopPeek?.()
    }
  }, [isFocused, active, rowId, tourShown, storageKey, rows, sides])
}
