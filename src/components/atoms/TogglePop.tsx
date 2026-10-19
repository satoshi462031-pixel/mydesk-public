import { ReactNode, useEffect, useRef } from 'react'
import { Animated, Easing } from 'react-native'
import { useApp } from '../../context/AppContext'

const DURATION_MS = 360

/**
 * 保存・お気に入りを付けた瞬間に、アイコンを一度縮めてから弾ませる。
 * X の保存（ブックマーク）と iOS の SF Symbols の bounce と同じ扱いで、付けたときだけ動かし、外したときは動かさない。
 * 拍手（ClapBurst）ほど大きく見せないのは、保存やお気に入りは相手に届く反応ではなく自分用の印だから。
 *
 * 動かすのは popKey が進んだときだけ。状態の読み込みで印が付いても動かさないよう、
 * 呼び出し側は「付ける操作をした」ときにだけ番号を進める。
 * 動きを減らす設定のときは動かさない。
 */
export function TogglePop({ popKey, children }: {
  /** 付ける操作をしたときだけ進める通し番号。初期値は 0 */
  popKey: number
  children: ReactNode
}) {
  const { reduceMotion } = useApp()
  const p = useRef(new Animated.Value(1)).current
  const prevPopKey = useRef(popKey)

  useEffect(() => {
    const pressed = prevPopKey.current !== popKey
    prevPopKey.current = popKey
    if (!pressed || reduceMotion) return
    p.setValue(0)
    const anim = Animated.timing(p, { toValue: 1, duration: DURATION_MS, easing: Easing.linear, useNativeDriver: true })
    anim.start(() => p.setValue(1))
    return () => {
      anim.stop()
    }
  }, [popKey, reduceMotion, p])

  const scale = p.interpolate({
    inputRange: [0, 0.2, 0.55, 0.8, 1],
    outputRange: [1, 0.78, 1.18, 0.98, 1],
  })

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      {children}
    </Animated.View>
  )
}
