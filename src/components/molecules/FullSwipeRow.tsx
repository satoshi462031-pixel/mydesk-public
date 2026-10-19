import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, LayoutAnimation, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import type { Swipeable } from 'react-native-gesture-handler'
import { SwipeableRow } from './SwipeableRow'
import { MCIconName } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { hapticLight } from '../../utils/haptics'
import { fullSwipeThreshold, nextFullSwipeArmed } from '../../utils/fullSwipe'
import { SWIPEABLE_ROW_PROPS } from '../../utils/swipeableRow'
import { AppIcon } from '../atoms/AppIcon'
import { SwipeDistanceObserver } from './SwipeCommitRow'
import { swipeRevealStyle } from './DeskSwipeActions'
import { UI_METRICS } from '../../constants/ui'

const DEFAULT_ACTION_WIDTH = 88
const FLY_OUT_MS = 200
const FADE_OUT_MS = 180

/**
 * 一覧から項目を外すときに呼ぶ。次の描画で消える行のぶん、下の行（2列なら後ろのタイル）が
 * 詰めて動く。行はもう外へ流れているので、詰める動きが iOS の「高さが縮む」に当たる。
 * 「元に戻す」で戻すときも呼び、空いた場所へ戻ってくるように見せる。
 * 動きを減らす設定では詰める動きもさせない。
 */
export function animateListChange(reduceMotion: boolean): void {
  if (reduceMotion) return
  LayoutAnimation.configureNext(LayoutAnimation.create(240, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity))
}

/**
 * 左へ引いて外す行（iOS のメールの全スワイプ）。
 * ・短く引いて離すと、右端に操作のボタンを出して止まる（押せば外す）
 * ・長い閾値（utils/fullSwipe）を越えると、裏の色が引いた幅いっぱいに広がり、アイコンと文字が
 *   行の端に付いてくる。越えた瞬間と戻した瞬間に軽く振動する。そのまま離すと外す
 * ・外すときは行を画面の外まで流してから onCommit を呼ぶ。呼ぶ側はその場で一覧から外し
 *   （animateListChange で下を詰める）、「元に戻す」を出す
 * ・動きを減らす設定では外へ流さず、薄くしてから外す
 * カードでは裏の面を広げず、独立した角丸ボタンをスワイプ量に合わせて拡大する。
 *
 * 確定は引いた距離だけで決める。勢いだけの短いフリックはボタンを出すところまで（SwipeCommitRow と同じ考え）。
 * onCommit が false を返すか失敗したら、行を元に戻す（呼ぶ側が一覧から外さなかったとき、行が外へ流れたまま残らないように）。
 *
 * 読み上げではスワイプが見つからないので、同じ操作は行の中のボタンか accessibilityActions で別に用意する。
 */
export function FullSwipeRow({
  actionLabel, actionAccessibilityLabel, actionIcon, actionColor, actionContentColor, actionWidth = DEFAULT_ACTION_WIDTH,
  radius = 0, card = false, enabled = true, onCommit, children,
}: {
  actionLabel: string
  /** ボタンの読み上げ。何を外すのかを含める（省略時は actionLabel） */
  actionAccessibilityLabel?: string
  actionIcon: MCIconName
  /** 裏の面の色 */
  actionColor: string
  /** 裏の面に載るアイコンと文字の色 */
  actionContentColor: string
  actionWidth?: number
  /** 行の角丸。裏の面も同じ角にして、引いている間に角から色がはみ出さないようにする */
  radius?: number
  card?: boolean
  enabled?: boolean
  onCommit: () => void | boolean | Promise<void | boolean>
  children: ReactNode
}) {
  const { reduceMotion } = useApp()
  const rowRef = useRef<Swipeable | null>(null)
  const [rowWidth, setRowWidth] = useState(0)
  const armedRef = useRef(false)
  const committedRef = useRef(false)
  const closingGesture = useRef(false)
  const mountedRef = useRef(true)
  // 1 のとき、アイコンと文字が引いた幅の端（行の端）に付いてくる
  const stick = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(1)).current

  useEffect(() => () => { mountedRef.current = false }, [])

  const setArmed = useCallback((next: boolean, silent = false) => {
    if (armedRef.current === next) return
    armedRef.current = next
    if (!silent) hapticLight()
    if (silent) stick.setValue(next ? 1 : 0)
    else Animated.spring(stick, { toValue: next ? 1 : 0, speed: 28, bounciness: 0, useNativeDriver: true }).start()
  }, [stick])

  const trackDistance = useCallback((translation: number) => {
    // 外へ流している間と、ボタンを出したまま閉じていく間は数えない（振動が鳴ってしまう）
    if (committedRef.current || closingGesture.current || !enabled || rowWidth === 0) return
    setArmed(nextFullSwipeArmed(-translation, fullSwipeThreshold(rowWidth, actionWidth), armedRef.current))
  }, [enabled, rowWidth, actionWidth, setArmed])

  const restore = useCallback(() => {
    if (!mountedRef.current) return
    committedRef.current = false
    setArmed(false, true)
    fade.setValue(1)
    rowRef.current?.close()
  }, [fade, setArmed])

  const finish = useCallback(() => {
    try {
      const result = onCommit()
      if (result === false) restore()
      else if (result && typeof result === 'object') {
        void result.then((accepted) => { if (accepted === false) restore() }, restore)
      }
    } catch {
      restore()
    }
  }, [onCommit, restore])

  const commit = useCallback(() => {
    if (committedRef.current || !enabled) return
    committedRef.current = true
    // RNGH 2.x の Swipeable が持つ行の位置。新しく動かすと、Swipeable が始めた「開く」動きは止まる
    const rowTranslation = (rowRef.current?.state as { rowTranslation?: Animated.Value } | null)?.rowTranslation
    if (reduceMotion || !rowTranslation || rowWidth === 0) {
      Animated.timing(fade, { toValue: 0, duration: FADE_OUT_MS, useNativeDriver: true }).start(finish)
      return
    }
    Animated.timing(rowTranslation, {
      toValue: -rowWidth,
      duration: FLY_OUT_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(finish)
  }, [enabled, reduceMotion, rowWidth, fade, finish])

  const renderRightActions = (progress: Animated.AnimatedInterpolation<number>, translation: Animated.AnimatedInterpolation<number>) => {
    // 行の端に付けるときの移動量。引いた幅がボタン幅を越えたぶんだけ左へ寄せる（越えていなければ動かさない）
    const toEdge = Animated.add(translation, actionWidth).interpolate({
      inputRange: [-1, 0],
      outputRange: [-1, 0],
      extrapolateRight: 'clamp',
    })
    return (
      <SwipeDistanceObserver dragX={translation} onDistance={trackDistance}>
        {card ? (
          <View style={[styles.cardActionSpace, { width: actionWidth }]}>
            <Animated.View style={[styles.cardAction, { backgroundColor: actionColor }, swipeRevealStyle(progress)]}>
              <TouchableOpacity
                style={styles.action}
                onPress={commit}
                disabled={!enabled}
                accessibilityRole="button"
                accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
              >
                <AppIcon name={actionIcon} size={22} color={actionContentColor} />
                <Text style={[styles.label, { color: actionContentColor }]} numberOfLines={1}>{actionLabel}</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        ) : (
          <View style={{ width: actionWidth }}>
            {/* 裏の面は行幅いっぱいに敷き、行の下に隠しておく。引いた幅だけ見える */}
            <View
              pointerEvents="none"
              style={[styles.fill, { width: Math.max(rowWidth, actionWidth), borderRadius: radius, backgroundColor: actionColor }]}
            />
            <TouchableOpacity
              style={styles.action}
              onPress={commit}
              disabled={!enabled}
              accessibilityRole="button"
              accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
            >
              <Animated.View style={[styles.actionContent, { transform: [{ translateX: Animated.multiply(stick, toEdge) }] }]}>
                <AppIcon name={actionIcon} size={22} color={actionContentColor} />
                <Text style={[styles.label, { color: actionContentColor }]} numberOfLines={1}>{actionLabel}</Text>
              </Animated.View>
            </TouchableOpacity>
          </View>
        )}
      </SwipeDistanceObserver>
    )
  }

  return (
    <Animated.View style={{ opacity: fade }} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      <SwipeableRow
        {...SWIPEABLE_ROW_PROPS}
        ref={rowRef}
        containerStyle={card ? { borderRadius: radius } : undefined}
        enabled={enabled}
        overshootRight
        overshootFriction={1}
        rightThreshold={actionWidth / 2}
        renderRightActions={renderRightActions}
        onSwipeableOpenStartDrag={() => {
          closingGesture.current = false
          setArmed(false, true)
          SWIPEABLE_ROW_PROPS.onSwipeableOpenStartDrag()
        }}
        onSwipeableCloseStartDrag={() => {
          closingGesture.current = true
          setArmed(false, true)
        }}
        onSwipeableWillOpen={() => {
          if (!closingGesture.current && armedRef.current) commit()
        }}
        onSwipeableWillClose={() => setArmed(false, true)}
      >
        {children}
      </SwipeableRow>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  cardActionSpace: { paddingLeft: 8 },
  cardAction: { flex: 1, borderRadius: UI_METRICS.controlRadius },
  fill: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionContent: { width: '100%', alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { fontSize: 12, fontWeight: '700' },
})
