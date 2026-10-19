import { ReactNode, useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'
import { useApp } from '../../context/AppContext'

const DURATION_MS = 800
const GROUPS = 7
// 泡の外寸は中身の 1.8 倍。X は 2.25 倍だが、一覧のタイルでは写真の角を越えて切られる
const BUBBLE_RATIO = 1.8

/**
 * 拍手した瞬間の演出。X のいいねの時間割に倣う（全体 0.8 秒）。
 *   0〜17.5%   手が消えている
 *   0〜15%     塗りの泡が広がる → 15〜30% で中が抜けて輪になり消える
 *   17.5%〜    手が行き過ぎてから戻る
 *   25%〜      2粒ずつ7組の粒が泡の縁から外へ散りながら縮む
 * 手は押した時点で拍手済みの見た目に替わっているので、消えてから出てくることで替わった瞬間を見せる。
 * 粒の色は X の虹色にせず拍手の黄2色にする（反応の色は拍手の黄だけ、という配色の約束のため）。
 * 拍手を取り消したときは何もしない。
 *
 * 演出は拍手を追加する操作の通し番号が進んだときだけ。拍手済みの状態取得・再取得では
 * 番号を進めないため、画面を開いたり戻ったりしても演出を繰り返さない。
 *
 * 大きさは size（中身の外寸）で、レイアウト上はこの四角しか取らない。泡と粒は外へはみ出して描く。
 * 動きを減らす設定のときは演出しない。
 */
export function ClapBurst({ clapped, burstKey, size, children }: {
  clapped: boolean
  /** このボタンから拍手を追加するときだけ進める通し番号。初期値は 0 */
  burstKey: number
  size: number
  children: ReactNode
}) {
  const { colors: C, reduceMotion } = useApp()
  // 1 が静止。手と粒はネイティブ側で回す
  const p = useRef(new Animated.Value(1)).current
  // 泡の中が抜ける動きは枠の太さでしか描けず、枠の太さはネイティブ側で動かせないので別の値で JS 側で回す
  const b = useRef(new Animated.Value(1)).current
  const [bursting, setBursting] = useState(false)
  const prevBurstKey = useRef(burstKey)

  useEffect(() => {
    const newClap = prevBurstKey.current !== burstKey
    prevBurstKey.current = burstKey
    if (!newClap || !clapped || reduceMotion) return
    p.setValue(0)
    b.setValue(0)
    setBursting(true)
    const main = Animated.timing(p, { toValue: 1, duration: DURATION_MS, easing: Easing.linear, useNativeDriver: true })
    const bubble = Animated.timing(b, { toValue: 1, duration: DURATION_MS, easing: Easing.linear, useNativeDriver: false })
    const anim = Animated.parallel([main, bubble])
    anim.start(() => {
      p.setValue(1)
      setBursting(false)
    })
    return () => {
      anim.stop()
    }
  }, [burstKey, clapped, reduceMotion, p, b])

  // X は cubic-bezier(.17, .89, .32, 1.49) で行き過ぎて戻る。区切りの点で近い形を取る
  const scale = p.interpolate({
    inputRange: [0, 0.175, 0.42, 0.6, 0.8, 1],
    outputRange: [0.01, 0.01, 1.15, 0.96, 1.01, 1],
  })

  const bubbleSize = Math.round(size * BUBBLE_RATIO)
  const bubbleR = bubbleSize / 2
  const bubbleScale = b.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.01, 1, 1], extrapolate: 'clamp' })
  const bubbleBorder = b.interpolate({
    inputRange: [0, 0.15, 0.2, 0.25, 0.3, 1],
    outputRange: [bubbleR, bubbleR, bubbleR * 0.45, bubbleR * 0.15, 0, 0],
    extrapolate: 'clamp',
  })

  const dotSize = Math.max(3, Math.round(size * 0.18))
  const dotOpacity = p.interpolate({ inputRange: [0, 0.249, 0.25, 1], outputRange: [0, 0, 1, 1] })
  const dotScale = p.interpolate({ inputRange: [0.25, 1], outputRange: [1, 0], extrapolate: 'clamp' })
  const orbit = p.interpolate({ inputRange: [0.25, 1], outputRange: [bubbleR, bubbleR * 1.25], extrapolate: 'clamp' })
  // 組の2粒は少し角度をずらし、後ろの粒を内側・小さめに置いて流れて見せる
  const dots = Array.from({ length: GROUPS }, (_, i) => {
    const base = -Math.PI / 2 + (i / GROUPS) * Math.PI * 2
    return [
      { angle: base - 0.12, reach: 1, ratio: 1, color: C.clap },
      { angle: base + 0.22, reach: 0.82, ratio: 0.75, color: C.onClap },
    ]
  }).flat()

  return (
    <View style={{ width: size, height: size }}>
      {bursting && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.View
            style={{
              position: 'absolute',
              left: size / 2 - bubbleR, top: size / 2 - bubbleR,
              width: bubbleSize, height: bubbleSize, borderRadius: bubbleR,
              borderWidth: bubbleBorder, borderColor: C.clap,
              transform: [{ scale: bubbleScale }],
            }}
          />
          {dots.map((d, i) => {
            const s = Math.max(2, Math.round(dotSize * d.ratio))
            const distance = Animated.multiply(orbit, d.reach)
            return (
              <Animated.View
                key={i}
                style={{
                  position: 'absolute',
                  left: size / 2 - s / 2, top: size / 2 - s / 2,
                  width: s, height: s, borderRadius: s / 2,
                  backgroundColor: d.color,
                  opacity: dotOpacity,
                  transform: [
                    { translateX: Animated.multiply(distance, Math.cos(d.angle)) },
                    { translateY: Animated.multiply(distance, Math.sin(d.angle)) },
                    { scale: dotScale },
                  ],
                }}
              />
            )
          })}
        </View>
      )}
      <Animated.View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ scale }] }}>
        {children}
      </Animated.View>
    </View>
  )
}
