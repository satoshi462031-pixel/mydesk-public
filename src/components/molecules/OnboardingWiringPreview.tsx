import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, InteractionManager, LayoutChangeEvent, StyleSheet, View } from 'react-native'
import { getOnboardingWiringLayout } from '../../constants/onboardingWiring'
import { useApp } from '../../context/AppContext'
import { MapLayout } from '../../utils/connectionMapLayout'
import { HistoryWiringCanvas } from '../organisms/HistoryWiringCanvas'

// このアプリの中身は「登録すると配線図が出てくる」ことに尽きるので、初回起動では
// 機能を文章で並べるより、線が引かれていくところをそのまま見せる。
// 履歴アニメと同じ HistoryWiringCanvas に通すため、実際に出てくる図と描き方が揃う。

// 開封のような手触りを狙う。跳ねさせない・急がせない・最後は静かに止める。
// 1本の線が「勢いよく出て、着地でゆっくり止まる」形。跳ね返り（spring）は入れない
const SETTLE = Easing.bezier(0.32, 0.72, 0, 1)
// 進行クロック側は等速にする。履歴アニメ既定の inOut を掛けると、序盤の線が走って
// 終盤が這うという不揃いな進み方になり、1本ずつ丁寧に置かれる感じが消える
const STEADY = (x: number) => x

// 線が伸びるのは 0.12〜0.9 の区間なので、実尺は約3.3秒。残りは引き終えた図を眺める間。
// 押させたいボタンは最初から押せるので、ここを詰める理由はない
const DURATION_MS = 4200
// 図がわずかに引いていく（開けた箱を覗き込む距離感）。動かしすぎると酔うので5%まで
const ZOOM_FROM = 1.05

// 新規登場（IN）は prevLayout が無いことから内部で判定される。撤去は無い
const NO_EXITS: Set<string> = new Set()

export function OnboardingWiringPreview() {
  const { colors, reduceMotion } = useApp()
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [layout, setLayout] = useState<MapLayout | null>(null)
  const mounted = useRef(true)
  const settle = useMemo(() => new Animated.Value(0), [])
  const ready = layout !== null && size.w > 0 && size.h > 0

  // 画面を出すのを配線図の展開より優先する。「はじめる」は最初のフレームから押せる
  useEffect(() => {
    mounted.current = true
    const task = InteractionManager.runAfterInteractions(() => {
      if (!mounted.current) return
      setLayout(getOnboardingWiringLayout())
    })
    return () => {
      mounted.current = false
      task.cancel()
    }
  }, [])

  // 全体の寄り引きとフェード。線の描画とは別クロックでゆっくり効かせる
  useEffect(() => {
    if (!ready) return
    if (reduceMotion) { settle.setValue(1); return }
    const anim = Animated.timing(settle, {
      toValue: 1,
      duration: DURATION_MS,
      easing: SETTLE,
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [ready, reduceMotion, settle])

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width)
    const h = Math.round(e.nativeEvent.layout.height)
    // 2px程度の往復で再レンダーを繰り返すと、JS駆動の登場アニメが途中で止まる
    setSize((prev) => (Math.abs(prev.w - w) <= 2 && Math.abs(prev.h - h) <= 2 ? prev : { w, h }))
  }

  return (
    <View style={styles.container} onLayout={handleLayout} pointerEvents="none">
      {layout && size.w > 0 && size.h > 0 && (
        <Animated.View
          style={{
            opacity: settle.interpolate({ inputRange: [0, 0.12], outputRange: [0, 1], extrapolate: 'clamp' }),
            transform: [{ scale: settle.interpolate({ inputRange: [0, 1], outputRange: [ZOOM_FROM, 1] }) }],
          }}
        >
          <HistoryWiringCanvas
            layout={layout}
            prevLayout={null}
            animKey="onboarding"
            durationMs={DURATION_MS}
            morph={false}
            reduceMotion={reduceMotion}
            width={size.w}
            height={size.h}
            colors={colors}
            exitingNodeIds={NO_EXITS}
            exitingEdgeIds={NO_EXITS}
            clockEasing={STEADY}
            wireEasing={SETTLE}
          />
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', overflow: 'hidden' },
})
