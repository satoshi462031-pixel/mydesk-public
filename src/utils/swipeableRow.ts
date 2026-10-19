import { Animated, Easing } from 'react-native'
import type { Swipeable } from 'react-native-gesture-handler'

// 一覧の Swipeable 行に共通で渡す設定。
//
// 縦に動いたら行の操作をやめる。RNGH の iOS 実装はネイティブのスクロールと同時に動けないので、
// これが無いと縦スクロール中に指が横へ 10px ずれただけで行が掴まれ、指を離すまで一覧が止まっていた
// （離すときは「移動量 + 0.05 × 速度」で開閉を決めるので、小さく速い動きでも操作ボタンが開いた）。
//
// 開いている行は画面をまたいで1つだけにする。開いたまま残った行をタップすると閉じる操作に
// 吸われてカードが開かず、別の行を開いても前の行が開いたままだった。
let openRow: Swipeable | null = null
const interactedRows = new WeakSet<Swipeable>()
const activePeeks = new Map<Swipeable, () => void>()
let swipeInteractionVersion = 0

export function getSwipeInteractionVersion(): number {
  return swipeInteractionVersion
}

export function interruptSwipePeek(row: Swipeable): void {
  interactedRows.add(row)
  swipeInteractionVersion++
  for (const stop of activePeeks.values()) stop()
}

export const SWIPEABLE_ROW_PROPS = {
  failOffsetY: [-10, 10] as [number, number],
  // 開閉先は Swipeable が決める。離した速度をばねへ持ち越すと、閉じる途中で反対側まで抜ける。
  animationOptions: { velocity: 0, overshootClamping: true },
  // iPad のトラックパッドの二本指スワイプでも開けるようにする（既定ではクリックしたままのドラッグだけ）
  enableTrackpadTwoFingerGesture: true,
  // 閉じている行を開き始めたときだけ呼ばれる（開いている行を動かすと CloseStartDrag になる）
  onSwipeableOpenStartDrag: () => {
    openRow?.close()
    openRow = null
  },
  onSwipeableOpen: (_direction: 'left' | 'right', row: Swipeable) => {
    openRow = row
  },
  onSwipeableClose: (_direction: 'left' | 'right', row: Swipeable) => {
    if (openRow === row) openRow = null
  },
}

export function swipeActionOpacity(progress: Animated.AnimatedInterpolation<number>) {
  return progress.interpolate({
    inputRange: [0, 0.05, 0.2, 1],
    outputRange: [0, 0, 1, 1],
    extrapolate: 'clamp',
  })
}

const PEEK_DISTANCE = 60

/** 見せる操作の側。'right' は右側（左へスワイプして出る）の操作だけ */
export type SwipePeekSides = 'both' | 'right'

/**
 * 行を少しだけ横に動かし、横スワイプで操作が出ることを見せる。止める関数を返す。
 *
 * openLeft / openRight は開ききるまで動かすので「チラ見せ」にならない。行の位置を持つ
 * 内部の rowTranslation を直接動かす（RNGH 2.x の Swipeable の実装に依存。取れなければ何もしない）。
 * useNativeDriver は Swipeable 自身の開閉アニメ（useNativeAnimations の既定 true）と揃える。
 * 片側にしか操作が無い行で両側へ動かすと、動かない側のぶん何も起きない間が空く。
 */
export function peekSwipeableRow(row: Swipeable, sides: SwipePeekSides = 'both'): (() => void) | null {
  const state = row.state as { rowTranslation?: Animated.Value; rowState?: number } | null
  const rowTranslation = state?.rowTranslation
  if (!rowTranslation || openRow || interactedRows.has(row) || activePeeks.size > 0 || (state?.rowState ?? 0) !== 0 || row.props.enabled === false) return null
  const move = (toValue: number, duration: number) => Animated.timing(rowTranslation, {
    toValue,
    duration,
    easing: Easing.inOut(Easing.cubic),
    useNativeDriver: true,
  })
  const revealRight = [move(-PEEK_DISTANCE, 280), Animated.delay(360), move(0, 240)]
  const anim = Animated.sequence(sides === 'right' ? revealRight : [
    move(PEEK_DISTANCE, 280), Animated.delay(360), move(0, 240),
    Animated.delay(180),
    ...revealRight,
  ])
  let running = true
  const stop = () => {
    if (!running) return
    running = false
    activePeeks.delete(row)
    anim.stop()
    row.reset()
  }
  activePeeks.set(row, stop)
  anim.start(({ finished }) => {
    if (!finished) return
    running = false
    activePeeks.delete(row)
  })
  return stop
}
