import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { categoryIconColor, themeIconColor } from '../../constants/icons'
import { getOpeningWiringLayout } from '../../constants/onboardingWiring'
import { portColor } from '../../constants/portTypes'
import { OPENING_DURATION_MS, OPENING_LOGO_HOLD_MS } from '../../constants/opening'
import { useApp } from '../../context/AppContext'
import { brighten, buildOpeningScene, OpeningScene } from '../../utils/openingScene'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'

const AnimatedPath = Animated.createAnimatedComponent(Path)
// 配線図のコンセント（MapNodeLabel の壁）と同じ絵と色
const OUTLET_COLOR = '#555555'
// 図の座標系（焼いた配線図と同じ）での線の太さ。画面では縮小されて約2.5ptになる
const WIRE_WIDTH = 4
// 図を画面いっぱいに広げず、小さくまとめる上限（図の座標系での大きさに対する倍率）
const MAX_SCALE = 0.7
const LOGO_FADE_IN_MS = 200
const FADE_OUT_MS = 150

// 配置は焼いた配線図そのまま。起動のたびに組み直さない
let openingScene: OpeningScene | null = null
const getOpeningScene = () => openingScene ??= buildOpeningScene(getOpeningWiringLayout())

interface Props {
  onComplete: () => void
}

export function OnboardingIntro({ onComplete }: Props) {
  const { colors, isDark, lang, reduceMotion } = useApp()
  const skipAnimation = reduceMotion
  const durationMs = OPENING_DURATION_MS
  const diagram = getOpeningScene()
  const logoStart = (durationMs - OPENING_LOGO_HOLD_MS - LOGO_FADE_IN_MS - FADE_OUT_MS) / durationMs
  const logoReady = logoStart + LOGO_FADE_IN_MS / durationMs
  const fadeStart = 1 - FADE_OUT_MS / durationMs
  const diagramTime = (time: number) => time * logoStart / 0.84
  // 明るい地では、黒や濃い色の線・アイコンを明るい側へ寄せる。暗い地の色はすでに明るい
  const tone = (color: string) => (isDark ? color : brighten(color))
  const [size, setSize] = useState({ width: 0, height: 0 })
  const scene = useRef(new Animated.Value(0)).current
  const wiring = useRef(new Animated.Value(0)).current
  const completed = useRef(false)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const finish = useCallback(() => {
    if (completed.current) return
    completed.current = true
    onCompleteRef.current()
  }, [])

  useEffect(() => {
    if (completed.current) return
    if (skipAnimation) { finish(); return }
    if (!size.width || !size.height) return
    const animation = Animated.parallel([
      Animated.timing(scene, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true }),
      // SVG の線の長さだけ JS で更新し、全体の縮小・フェードはネイティブ側で動かす。
      Animated.timing(wiring, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: false }),
    ])
    animation.start(({ finished }) => { if (finished) finish() })
    const timeout = setTimeout(finish, durationMs + 1000)
    return () => { clearTimeout(timeout); animation.stop() }
  }, [durationMs, finish, scene, size.height, size.width, skipAnimation, wiring])

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setSize(previous => Math.abs(previous.width - width) < 2 && Math.abs(previous.height - height) < 2
      ? previous : { width, height })
  }
  const scale = Math.max(0.1, Math.min(MAX_SCALE, (size.width - 32) / diagram.width, (size.height - 120) / diagram.height))

  if (skipAnimation) return <View style={[styles.container, styles.center, { backgroundColor: colors.bgList }]}>
    <Image source={require('../../../assets/brand-mark.png')} style={styles.logo} fadeDuration={0} accessibilityLabel="MyDesk" />
  </View>

  return (
    <Animated.View
      onLayout={onLayout}
      style={[styles.container, { backgroundColor: colors.bgList, opacity: scene.interpolate({ inputRange: [0, fadeStart, 1], outputRange: [1, 1, 0], extrapolate: 'clamp' }) }]}
    >
      <View style={styles.center} pointerEvents="none" accessible accessibilityLabel={lang === 'ja'
        ? '機材のアイコンが配線でつながり、MyDeskのアイコンになります'
        : 'Gear icons connect into a wiring diagram, then become the MyDesk icon'}>
        <Animated.View style={[{ width: diagram.width, height: diagram.height }, {
          opacity: scene.interpolate({ inputRange: [0, diagramTime(0.04), diagramTime(0.76), logoStart], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
          transform: [{ scale: scene.interpolate({ inputRange: [0, diagramTime(0.76), logoStart, 1], outputRange: [scale, scale, scale * 0.18, scale * 0.18], extrapolate: 'clamp' }) }],
        }]} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg width={diagram.width} height={diagram.height} style={StyleSheet.absoluteFill}>
            {diagram.wires.map(wire => (
              <AnimatedPath
                key={wire.d}
                d={wire.d}
                fill="none"
                stroke={tone(portColor(wire.cable, isDark))}
                strokeWidth={WIRE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={`${wire.length} ${wire.length}`}
                strokeDashoffset={wiring.interpolate({ inputRange: [diagramTime(wire.start), diagramTime(wire.end)], outputRange: [wire.length, 0], extrapolate: 'clamp' })}
                opacity={wiring.interpolate({ inputRange: [diagramTime(wire.start), diagramTime(wire.start + 0.01)], outputRange: [0, 1], extrapolate: 'clamp' })}
              />
            ))}
          </Svg>
          {diagram.nodes.map(node => (
            <Animated.View key={node.key} style={[styles.node, {
              left: node.cx - node.size / 2, top: node.cy - node.size / 2, width: node.size, height: node.size,
              opacity: scene.interpolate({ inputRange: [diagramTime(node.arrive), diagramTime(node.arrive + 0.06)], outputRange: [0, 1], extrapolate: 'clamp' }),
              transform: [{ scale: scene.interpolate({ inputRange: [diagramTime(node.arrive), diagramTime(node.arrive + 0.08)], outputRange: [0.88, 1], extrapolate: 'clamp' }) }],
            }]}>
              {node.outlet
                ? <AppIcon name="power-socket-jp" size={node.size} color={tone(themeIconColor(OUTLET_COLOR, isDark))} />
                : <CategoryIcon category={node.category} pcFormFactor={node.pcFormFactor} size={node.size} color={tone(categoryIconColor(node.category, isDark))} />}
            </Animated.View>
          ))}
        </Animated.View>
        <Animated.View style={[styles.logoWrap, {
          opacity: scene.interpolate({ inputRange: [logoStart, logoReady], outputRange: [0, 1], extrapolate: 'clamp' }),
          transform: [{ scale: scene.interpolate({ inputRange: [logoStart, logoReady], outputRange: [0.82, 1], extrapolate: 'clamp' }) }],
        }]} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Image source={require('../../../assets/brand-mark.png')} style={styles.logo} fadeDuration={0} />
        </Animated.View>
      </View>
      <TouchableOpacity onPress={finish} style={styles.skip} accessibilityRole="button">
        <Text style={{ color: colors.text }}>{lang === 'ja' ? 'スキップ' : 'Skip'}</Text>
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  node: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  logoWrap: { position: 'absolute', width: 136, height: 136, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 136, height: 136 },
  skip: { minWidth: 100, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 40 },
})
