import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useIsFocused } from '@react-navigation/native'
import type { Animated, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import type { ScrollSyncRequest } from '../utils/collapsibleTabScroll'

/**
 * マイページのタブを替えたときの位置合わせ（scrollSyncRequest）を、一覧の高さが出揃うまで当て直す。
 *
 * 各一覧は要求を受けたその場で scrollToOffset するが、初めて開いたタブ・読み込み中の仮の一覧から
 * 本物の一覧へ替わった直後は中身の高さがまだ無く、移動が届かずに先頭のまま残る。固定のタブバーは
 * 要求した位置へ先に動いているので一覧とずれ、最初にスクロールした瞬間にタブバーが跳んでいた。
 * 中身と枠の高さが分かるたびに当て直し、届く高さになったら（または指で動かしたら）やめる
 *
 * タブを隠す・別画面へ移るときは、一覧の慣性をその時点の位置で止める。スクロールの勢いが残ったまま
 * タブを押すと、隠れた一覧（透明にしているだけ）は流れ続ける。行き先の位置は押した瞬間の値で
 * 揃えてあるので、切り替えの1フレームだけ流れた先の値で描かれた固定タブバーが跳び、行き先も
 * 途中の位置（ヘッダーが半端に畳まれた状態）で止まって見えていた
 */
export function useScrollSyncRetry(
  request: ScrollSyncRequest | undefined,
  active: boolean,
  scrollTo: (offset: number) => void,
  scrollY?: Animated.Value,
) {
  const focused = useIsFocused()
  const isActive = active && focused
  const pendingRef = useRef<number | null>(null)
  const viewportRef = useRef(0)
  const contentRef = useRef(0)
  const scrollToRef = useRef(scrollTo)
  scrollToRef.current = scrollTo
  // 隠れている一覧は動かさない。保存タブのデスク・ガジェットは固定タブバーの位置（scrollY）を共有していて、
  // 隠れた側が動くと出ている側のタブバーが跳ぶ
  const activeRef = useRef(isActive)
  activeRef.current = isActive

  // 出ている間に届いた位置だけを覚える。隠れたあとに流れた分と、共有の scrollY に
  // 別の一覧（保存タブのデスク／ガジェット）や行き先の合わせ込みが書いた値は拾わない
  const lastOffsetRef = useRef<number | null>(null)
  useEffect(() => {
    if (!scrollY) return
    const id = scrollY.addListener(({ value }) => { if (activeRef.current) lastOffsetRef.current = value })
    return () => scrollY.removeListener(id)
  }, [scrollY])
  const wasActiveRef = useRef(isActive)
  const consumedRequestRef = useRef<ScrollSyncRequest | undefined>(undefined)

  const settle = useCallback(() => {
    const offset = pendingRef.current
    if (offset === null || viewportRef.current <= 0 || !activeRef.current) return
    scrollToRef.current(offset)
    if (contentRef.current - viewportRef.current >= offset - 0.5) pendingRef.current = null
  }, [])

  useLayoutEffect(() => {
    const was = wasActiveRef.current
    wasActiveRef.current = isActive
    if (!isActive) {
      pendingRef.current = null
      // 同じ位置へ動かすと、iOS は残っている慣性を止める。
      if (was && lastOffsetRef.current !== null) scrollToRef.current(lastOffsetRef.current)
      return
    }
    if (request && request !== consumedRequestRef.current) {
      consumedRequestRef.current = request
      pendingRef.current = request.offset
      lastOffsetRef.current = request.offset
    } else if (!was && lastOffsetRef.current !== null) {
      // 詳細から戻ったときは、タブを替えた当時の要求より直前に読んでいた位置を優先する。
      pendingRef.current ??= lastOffsetRef.current
      scrollY?.setValue(pendingRef.current)
    }
    settle()
  }, [isActive, request, scrollY, settle])

  /** 一覧の部品が差し替わったとき（読み込み中 → 本物）に、直前の位置を当て直す */
  const rearm = useCallback((offset: number) => {
    if (offset <= 0) return
    pendingRef.current = offset
    contentRef.current = 0
    settle()
  }, [settle])

  const noteScrollBoundary = useCallback((event?: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!activeRef.current || !event) return
    const y = Math.max(0, event.nativeEvent.contentOffset.y)
    lastOffsetRef.current = y
    scrollY?.setValue(y)
  }, [scrollY])

  const handlers = useMemo(() => ({
    onLayout: (event: LayoutChangeEvent) => {
      viewportRef.current = event.nativeEvent.layout.height
      settle()
    },
    onContentSizeChange: (_width: number, height: number) => {
      contentRef.current = height
      settle()
    },
    onScrollBeginDrag: (event?: NativeSyntheticEvent<NativeScrollEvent>) => {
      pendingRef.current = null
      noteScrollBoundary(event)
    },
    onScrollEndDrag: noteScrollBoundary,
    onMomentumScrollEnd: noteScrollBoundary,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (activeRef.current) lastOffsetRef.current = Math.max(0, event.nativeEvent.contentOffset.y)
    },
  }), [noteScrollBoundary, settle])

  return { handlers, rearm, isActive }
}
