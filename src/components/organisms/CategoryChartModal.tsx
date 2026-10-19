import React, { useEffect, useRef, useState } from 'react'
import { Animated, Easing, InteractionManager, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { AppColors, useApp } from '../../context/AppContext'
import { Gadget } from '../../types'
import { validGadgetPrice } from '../../utils/gadgetStats'
import { AppIcon } from '../atoms/AppIcon'
import { UI_METRICS } from '../../constants/ui'

const PIE_SIZE = 260
const MAX_PIE_SEGS = 15

function partialPiePath(cx: number, cy: number, r: number, a1: number, a2: number, currentAngle: number): string | null {
  const end = Math.min(a2, currentAngle)
  const sweep = end - a1
  if (sweep < 0.001) return null
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
  const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end)
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`
}

interface Props {
  visible: boolean
  onClose: () => void
  selectedGadgets: Gadget[]
  colors: AppColors
  t: (key: string) => string
  animKey: string
  fmtPrice: (n: number | null | undefined) => string
}

export function CategoryChartModal({ visible, onClose, selectedGadgets, colors: C, t, animKey, fmtPrice }: Props) {
  const { isDark, reduceMotion } = useApp()
  const animatedPlansRef = useRef(new Set<string>()).current
  const cx = PIE_SIZE / 2, cy = PIE_SIZE / 2, r = PIE_SIZE / 2 - 24
  const start = -Math.PI / 2
  const catPrices = new Map<string, number>()
  for (const g of selectedGadgets) {
    const price = validGadgetPrice(g)
    if (price != null) catPrices.set(g.category, (catPrices.get(g.category) ?? 0) + price)
  }
  const totalPrice = [...catPrices.values()].reduce((sum, value) => sum + value, 0)
  const sortedCats = [...catPrices.entries()].filter(([, price]) => price > 0).sort((a, b) => b[1] - a[1])
  const hasOther = sortedCats.length > MAX_PIE_SEGS
  const segments = hasOther
    ? [
        ...sortedCats.slice(0, MAX_PIE_SEGS - 1).map(([cat, price]) => ({ cat, price, color: categoryIconColor(cat, isDark) })),
        { cat: '__other__', price: sortedCats.slice(MAX_PIE_SEGS - 1).reduce((sum, [, price]) => sum + price, 0), color: '#9E9E9E' },
      ]
    : sortedCats.map(([cat, price]) => ({ cat, price, color: categoryIconColor(cat, isDark) }))
  const legend = segments
  const segmentTotal = segments.reduce((sum, segment) => sum + segment.price, 0)
  // 表示上の合計を必ず100%にする（最大剰余法）。各行を独立に四捨五入すると
  // 端数の積み上がりで合計が101%や102%になり、内訳として辻褄が合わなくなる。
  // 1%に満たない項目は 0% ではなく "<1%" と出す
  const percents = (() => {
    if (segmentTotal <= 0) return segments.map(() => 0)
    const exact = segments.map((s) => (s.price / segmentTotal) * 100)
    const out = exact.map((v) => Math.floor(v))
    let rest = 100 - out.reduce((sum, v) => sum + v, 0)
    const byFraction = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i)
    for (const { i } of byFraction) {
      if (rest <= 0) break
      out[i] += 1
      rest -= 1
    }
    return out
  })()
  let cumulative = 0
  const angles = segments.map((segment, index) => {
    const a1 = start + (cumulative / segmentTotal) * Math.PI * 2
    cumulative += segment.price
    const a2 = index === segments.length - 1 ? start + Math.PI * 2 : start + (cumulative / segmentTotal) * Math.PI * 2
    return { a1, a2 }
  })

  const mounted = useRef(true)
  const sweep = useRef(new Animated.Value(0)).current
  const [sweepValue, setSweepValue] = useState(0)

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    sweep.removeAllListeners()
    if (!visible || segments.length === 0) { if (mounted.current) setSweepValue(0); return }
    if (animatedPlansRef.has(animKey)) {
      sweep.setValue(1); setSweepValue(1)
      return
    }
    if (reduceMotion) {
      animatedPlansRef.add(animKey)
      sweep.setValue(1); setSweepValue(1)
      return
    }
    sweep.setValue(0); setSweepValue(0)
    let sweepAnimation: Animated.CompositeAnimation | null = null
    let cancelled = false
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled || !mounted.current) return
      animatedPlansRef.add(animKey)
      const listener = sweep.addListener(({ value }) => { if (mounted.current) setSweepValue(value) })
      sweepAnimation = Animated.timing(sweep, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: false, isInteraction: false })
      sweepAnimation.start(() => {
        sweep.removeListener(listener)
      })
    })
    return () => {
      cancelled = true
      task.cancel()
      sweepAnimation?.stop()
      sweep.removeAllListeners()
    }
  }, [visible, animKey, reduceMotion, segments.length, sweep, animatedPlansRef])

  if (totalPrice === 0 || segments.length === 0) return null
  const currentAngle = start + sweepValue * Math.PI * 2

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: C.card }]} onPress={(event) => event.stopPropagation()}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: C.text }]}>{t('wiringResult.catBreakdown')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}><AppIcon name={ICONS.close} size={22} color={C.textMuted} /></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            <View style={styles.chart}>
              <Svg width={PIE_SIZE} height={PIE_SIZE}>
                {segments.length === 1
                  ? sweepValue > 0.001 && (sweepValue >= 0.9999
                    ? <Circle cx={cx} cy={cy} r={r} fill={segments[0].color} opacity={0.9} />
                    : (() => {
                        const end = start + sweepValue * Math.PI * 2
                        const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start)
                        const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end)
                        return <Path d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${sweepValue > 0.5 ? 1 : 0} 1 ${x2} ${y2} Z`} fill={segments[0].color} opacity={0.9} />
                      })())
                  : angles.map(({ a1, a2 }, index) => {
                      const path = partialPiePath(cx, cy, r, a1, a2, currentAngle)
                      return path ? <Path key={segments[index].cat} d={path} fill={segments[index].color} opacity={0.9} stroke={C.card} strokeWidth={1.5} /> : null
                    })}
                <Circle cx={cx} cy={cy} r={r * 0.52} fill={C.card} />
              </Svg>
              <View style={styles.center}>
                <Text style={[styles.centerText, { color: C.textMuted }]}>{t('wiringResult.itemCount').replace('{{n}}', String(selectedGadgets.length))}</Text>
                <Text style={[styles.centerPrice, { color: C.text }]}>{fmtPrice(totalPrice)}</Text>
              </View>
            </View>
            <View style={styles.legend}>
              {legend.map(({ cat, price, color }, index) => (
                <React.Fragment key={cat}>
                  {hasOther && cat === '__other__' && <View style={[styles.divider, { borderTopColor: C.border }]} />}
                  <View style={styles.legendRow}>
                    <View style={[styles.dot, { backgroundColor: color }]} />
                    <Text style={[styles.legendName, { color: C.text }]} numberOfLines={1}>
                      {cat === '__other__' ? t('category.Other') : t(`category.${cat}`)}
                    </Text>
                    <Text style={[styles.legendValue, { color: C.textMuted }]}>{fmtPrice(price)}<Text style={{ color: C.separator }}>  |  </Text>{percents[index] === 0 ? '<1%' : `${percents[index]}%`}</Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00000088', padding: 20 },
  sheet: { width: '100%', maxWidth: 420, maxHeight: '88%', borderRadius: UI_METRICS.sheetRadius, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  title: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  chart: { alignSelf: 'center', width: PIE_SIZE, height: PIE_SIZE },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 2 },
  centerText: { fontSize: 12, fontWeight: '700' },
  centerPrice: { fontSize: 15, fontWeight: '700' },
  legend: { marginTop: 16, gap: 6 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  legendName: { flex: 1, fontSize: 13 },
  legendValue: { minWidth: 110, fontSize: 13, fontWeight: '600', textAlign: 'right' },
})
