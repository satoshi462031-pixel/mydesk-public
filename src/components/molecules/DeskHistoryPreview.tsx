import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { DESK_HISTORY_DEMO_STEPS } from '../../constants/deskHistoryDemo'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { portColor } from '../../constants/portTypes'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'

const AnimatedPath = Animated.createAnimatedComponent(Path)
const STEP_MS = 1900

export function DeskHistoryPreview() {
  const { colors: C, lang, isDark, reduceMotion } = useApp()
  const [step, setStep] = useState(0)
  const [replay, setReplay] = useState(0)
  const progress = useRef(new Animated.Value(0)).current
  const ja = lang === 'ja'

  useEffect(() => {
    progress.setValue(reduceMotion ? 1 : 0)
    if (reduceMotion) return
    const animation = Animated.timing(progress, { toValue: 1, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false })
    animation.start()
    const timer = step < 3 ? setTimeout(() => setStep(previous => previous + 1), STEP_MS) : undefined
    return () => { animation.stop(); if (timer !== undefined) clearTimeout(timer) }
  }, [progress, reduceMotion, replay, step])

  const shownStep = reduceMotion ? 3 : step
  const label = DESK_HISTORY_DEMO_STEPS[shownStep]
  const entering = { opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }] }
  const wire = (d: string, length: number, arriving: boolean, color: string) => <AnimatedPath
    d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round"
    strokeDasharray={`${length} ${length}`}
    strokeDashoffset={arriving ? progress.interpolate({ inputRange: [0, 1], outputRange: [length, 0] }) : 0}
  />

  return (
    <View style={styles.container}>
      <View style={styles.caption}>
        <Text style={[styles.demoLabel, { color: C.textMuted }]}>{ja ? 'デスクの歩み・見本' : 'A desk through time · Demo'}</Text>
        <TouchableOpacity onPress={() => { setStep(0); setReplay(previous => previous + 1) }} style={styles.replay}
          accessibilityRole="button" accessibilityLabel={ja ? '見本をもう一度見る' : 'Replay demo'}>
          <AppIcon name={ICONS.history} size={16} color={C.accentIcon} />
          <Text style={[styles.replayText, { color: C.accentText }]}>{ja ? 'もう一度' : 'Replay'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.diagram} accessible accessibilityLabel={ja
        ? 'ノートPCから始まり、モニターの追加と買い替えを経て、今のデスクへ育つ見本'
        : 'A laptop grows into a desk through adding and upgrading a monitor'}>
        <View style={styles.scene} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg width={300} height={154} style={StyleSheet.absoluteFill}>
            {shownStep >= 1 && wire('M150 76 L150 59', 20, shownStep === 1, portColor('DisplayPort', isDark))}
            {shownStep >= 3 && wire('M116 108 L76 108', 40, step === 3, portColor('Audio3_5mm', isDark))}
            {shownStep >= 3 && wire('M184 108 L226 108', 42, step === 3, portColor('USB_A', isDark))}
          </Svg>
          <Animated.View style={[styles.pc, step === 0 && entering]}>
            <CategoryIcon category="PC" pcFormFactor="laptop" size={68} color={categoryIconColor('PC', isDark)} />
          </Animated.View>
          {shownStep >= 1 && <View style={styles.monitor}>
            {shownStep === 2 && !reduceMotion && <Animated.View style={[styles.oldMonitor, { opacity: progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0, 0] }) }]}>
              <CategoryIcon category="Monitor" size={44} color={categoryIconColor('Monitor', isDark)} />
            </Animated.View>}
            <Animated.View style={shownStep === 1 || shownStep === 2 ? entering : undefined}>
              <CategoryIcon category="Monitor" size={shownStep >= 2 ? 64 : 44} color={categoryIconColor('Monitor', isDark)} />
            </Animated.View>
          </View>}
          {shownStep >= 3 && <>
            <Animated.View style={[styles.headphone, entering]}><CategoryIcon category="Headphone" size={38} color={categoryIconColor('Headphone', isDark)} /></Animated.View>
            <Animated.View style={[styles.mouse, entering]}><CategoryIcon category="Mouse" size={32} color={categoryIconColor('Mouse', isDark)} /></Animated.View>
          </>}
        </View>
      </View>
      <View style={styles.milestone}>
        <Text style={[styles.date, { color: C.accentText }]}>{shownStep === 3 ? (ja ? '現在' : 'Today') : `${label.date.slice(0, 4)} / ${Number(label.date.slice(5, 7))}`}</Text>
        <Text style={[styles.label, { color: C.text }]}>{ja ? label.ja : label.en}</Text>
      </View>
      <View style={styles.steps}>{DESK_HISTORY_DEMO_STEPS.map((item, index) => <View key={item.date} style={[styles.segment, { backgroundColor: index <= shownStep ? C.accentIcon : C.separator }]} />)}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 420, paddingHorizontal: UI_METRICS.screenGutter },
  caption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  demoLabel: { fontSize: 11, fontWeight: '600' },
  replay: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: UI_METRICS.touchMinSize, paddingHorizontal: 8 },
  replayText: { fontSize: 12, fontWeight: '600' },
  diagram: { height: 154, alignItems: 'center', justifyContent: 'center' },
  scene: { width: 300, height: 154, transform: [{ scale: 0.85 }] },
  pc: { position: 'absolute', left: 116, top: 74 },
  monitor: { position: 'absolute', left: 118, top: 0, width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  oldMonitor: { position: 'absolute' },
  headphone: { position: 'absolute', left: 38, top: 89 },
  mouse: { position: 'absolute', left: 226, top: 92 },
  milestone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8, minHeight: 28 },
  date: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  label: { fontSize: 13, fontWeight: '600' },
  steps: { flexDirection: 'row', gap: 6, marginTop: 8 },
  segment: { flex: 1, height: 3, borderRadius: UI_METRICS.pillRadius },
})
