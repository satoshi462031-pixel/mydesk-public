import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../../hooks/useToday'
import { ActivityIndicator, Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Reanimated from 'react-native-reanimated'
import Svg, { Circle, G, Path } from 'react-native-svg'
import { AppIcon } from '../atoms/AppIcon'
import { DeskChronicleCard } from './DeskChronicleCard'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { cableLabel, isWirelessPortType, portIconColor, requiresPhysicalCable } from '../../constants/portTypes'
import { AppColors, useApp } from '../../context/AppContext'
import { CustomCategory, Gadget, GadgetCategory, MapConnection } from '../../types'
import { customCategoryOf, gadgetCategoryKey } from '../../utils/customCategory'
import { formatDate, parseLocalDate } from '../../utils/dateFormat'
import { isWirelessPowerPort } from '../../utils/gadgetPorts'
import { countsAsDevice, gadgetFinancialSummary, gadgetQuantity, sumDeviceQuantities, sumGadgetPrices, sumGadgetQuantities, validGadgetPrice } from '../../utils/gadgetStats'
import { UI_METRICS } from '../../constants/ui'
import { localizedGadgetName } from '../../utils/localizedGadgetName'
import { SectionBoundary } from '../molecules/ErrorContainment'
import { niceTicks } from '../../utils/chartTicks'
import { CoachStep, useCoachTarget } from '../../hooks/useCoachMarks'
import { DESK_CONTENT } from '../../constants/deskCoachSteps'

const AnimatedPath = Animated.createAnimatedComponent(Path)
const EMPTY_CONNECTIONS: MapConnection[] = []

function computeDeskAge(startedAt: string, lang: 'ja' | 'en'): string {
  const parts = startedAt.split(/[/-]/)
  const y = parseInt(parts[0])
  const m = parseInt(parts[1])
  if (!y || !m || m < 1 || m > 12) return ''
  const start = new Date(y, m - 1)
  const now = new Date()
  const totalMonths = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (totalMonths < 0) return lang === 'ja' ? '（未来）' : '(future)'
  const years = Math.floor(totalMonths / 12)
  const months = totalMonths % 12
  if (lang === 'en') {
    if (years === 0) return `${months} month${months !== 1 ? 's' : ''}`
    if (months === 0) return `${years} year${years !== 1 ? 's' : ''}`
    return `${years}y ${months}m`
  }
  if (years === 0) return `${months}ヶ月`
  if (months === 0) return `${years}年`
  return `${years}年${months}ヶ月`
}

// ─── ドーナツグラフ ─────────────────────────────────────────────
interface PieSlice { value: number; color: string }

function polarXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function donutSlicePath(
  cx: number, cy: number,
  outerR: number, innerR: number,
  startDeg: number, endDeg: number,
  gapDeg = 2,
) {
  const s = startDeg + gapDeg
  const e = endDeg - gapDeg
  if (e - s < 0.5) return ''
  const os = polarXY(cx, cy, outerR, s)
  const oe = polarXY(cx, cy, outerR, e)
  const is = polarXY(cx, cy, innerR, s)
  const ie = polarXY(cx, cy, innerR, e)
  const large = e - s > 180 ? 1 : 0
  return [
    `M ${os.x} ${os.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${oe.x} ${oe.y}`,
    `L ${ie.x} ${ie.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${is.x} ${is.y}`,
    'Z',
  ].join(' ')
}

interface DonutProps {
  data: PieSlice[]
  size?: number
  total: number
  textColor: string
  mutedColor: string
  centerLabel: string
  formatValue: (value: number) => string
}

function DonutChart({ data, size = 220, total, textColor, mutedColor, centerLabel, formatValue }: DonutProps) {
  const cx = size / 2, cy = size / 2
  const outerR = size / 2 - 6
  const innerR = outerR * 0.54

  if (total === 0 || data.length === 0) {
    const oCircle = `M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy} A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy} Z`
    const iCircle = `M ${cx - innerR} ${cy} A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy} A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy} Z`
    return (
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} style={{ opacity: 0.18 }}>
          <G>
            <Path d={`${oCircle} ${iCircle}`} fill={mutedColor} fillRule="evenodd" />
          </G>
        </Svg>
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ fontSize: 10, color: mutedColor, marginBottom: 2 }}>{centerLabel}</Text>
          <Text style={{ fontSize: 14, fontWeight: '800', color: textColor, letterSpacing: -0.5 }}>{formatValue(0)}</Text>
        </View>
      </View>
    )
  }

  let cur = 0
  const slices = data.map((d) => {
    const start = (cur / total) * 360
    cur += d.value
    const end = (cur / total) * 360
    return { ...d, start, end }
  })

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G>
          {slices.map((s, i) => {
            const visibleEnd = s.end
            if (visibleEnd <= s.start + 0.1) return null
            if (visibleEnd >= 359.9 && s.start <= 0.1) {
              const outerCircle = `M ${cx - outerR} ${cy} A ${outerR} ${outerR} 0 1 1 ${cx + outerR} ${cy} A ${outerR} ${outerR} 0 1 1 ${cx - outerR} ${cy} Z`
              const innerCircle = `M ${cx - innerR} ${cy} A ${innerR} ${innerR} 0 1 0 ${cx + innerR} ${cy} A ${innerR} ${innerR} 0 1 0 ${cx - innerR} ${cy} Z`
              return (
                <Path key={i} d={`${outerCircle} ${innerCircle}`} fill={s.color} fillRule="evenodd" stroke={s.color} strokeWidth={0.5} />
              )
            }
            const path = donutSlicePath(cx, cy, outerR, innerR, s.start, visibleEnd, 0)
            return path ? (
              <Path key={i} d={path} fill={s.color} stroke={s.color} strokeWidth={0.5} />
            ) : null
          })}
        </G>
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ fontSize: 10, color: mutedColor, marginBottom: 2 }}>{centerLabel}</Text>
        <Text style={{ fontSize: 14, fontWeight: '800', color: textColor, letterSpacing: -0.5 }}>
          {formatValue(total)}
        </Text>
      </View>
    </View>
  )
}

// ─── ガジェット統計パネル（全体統計・デスク別統計の両方から共用）───────────
export interface GadgetStatsPanelProps {
  sourceGadgets: Gadget[]
  /** 撤去済みを含む同じデスクの全ガジェット。指定時だけ投資サマリーを表示する */
  financialHistoryGadgets?: Gadget[]
  /** 年表で遡れる年数（-1 = 全期間）。歴史アニメーションと同じ枠を使う */
  chronicleYears?: number
  /** 年表の窓の外に履歴があり、Free でロック行が押されたとき */
  onRequireChroniclePro?: () => void
  connections?: MapConnection[]
  deskStartedAt?: string
  triggerKey: number
  colors: AppColors
  t: (key: string, params?: Record<string, string | number>) => string
  lang: 'ja' | 'en'
  fmtPrice: (n: number | null | undefined) => string
  /** 円 → 表示通貨の数値。グラフの目盛りを表示通貨で刻むために使う */
  displayAmount?: (jpy: number) => number
  loading?: boolean
  onFillPrice?: () => void
  showTotalCard?: boolean
  /** デスク詳細では概要を先に見せ、カテゴリ以下の分析をユーザー操作で展開する */
  collapseDetailsInitially?: boolean
  /**
   * 統計より上に置くカード。ScrollView の外に兄弟として並べると
   * その高さぶんスクロール窓が潰れて統計がほとんど動かせなくなるため、中に入れて一緒に流す
   */
  header?: React.ReactNode
  /**
   * useAnimatedScrollHandler の戻り値も受ける。デスク詳細はヘッダーの収納を UI スレッドで
   * 追従させており、JS を経由すると勢いよく弾いたときにヘッダーが中身から遅れる
   */
  onScroll?: React.ComponentProps<typeof Reanimated.ScrollView>['onScroll']
  onContentSizeChange?: (w: number, h: number) => void
  scrollEventThrottle?: number
  scrollRef?: React.RefObject<Reanimated.ScrollView | null>
  /**
   * 一覧の下に足す余白。収納するヘッダーの下に置くと、スクロール量が収納量に
   * 届かないと末尾が見えないまま止まる（公開デスクの情報タブ）
   */
  contentBottomInset?: number
  /** 収納するヘッダーの下に置くときの、中身の最低の高さ（useCollapsibleHeader の listContentMinHeight） */
  contentMinHeight?: number
  /** 上部の収納と一覧の移動が二重にならないよう、中身だけに適用する。 */
  contentShiftStyle?: React.ComponentProps<typeof Reanimated.View>['style']
}

// ─── デスクの成長（過去12か月の累計）───────────────────────────────
const TREND_MONTHS = 12 // 過去1年 = 12ヶ月
const CHART_H = 150
const CHART_PAD = { top: 14, right: 12, bottom: 22, left: 46 }

interface TrendPoint { key: string; month: number; count: number; total: number; isCurrent: boolean }

/**
 * 購入日が入力されているガジェットを対象に、過去12か月の各月末時点での
 * 累計台数・累計金額を求める。登録日は購入日として代用しない。
 */
function growthTrend(gadgets: Gadget[], now = new Date()): TrendPoint[] {
  const dated = gadgets
    .map((gadget) => ({ gadget, purchased: parseLocalDate(gadget.purchasedAt) }))
    .filter((item): item is { gadget: Gadget; purchased: Date } => !!item.purchased && item.purchased <= now)

  const points: TrendPoint[] = []
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const boundary = i === 0 ? now : new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
    const key = `${date.getFullYear()}-${date.getMonth()}`
    const included = dated.filter((item) => item.purchased <= boundary)
    points.push({
      key,
      month: date.getMonth() + 1,
      // 上の合計と揃える：台数はケーブル抜き、金額はケーブル込み
      count: sumDeviceQuantities(included.map((item) => item.gadget)),
      total: sumGadgetPrices(included.map((item) => item.gadget)),
      isCurrent: i === 0,
    })
  }
  return points
}

/**
 * 縦軸ラベル。値は既に表示通貨（en なら USD）へ換算済みの数値を受け取る。
 * 円のまま刻みを決めてから換算すると $66.67 のような半端な目盛りになり、
 * 幅の狭いラベル領域からもあふれるため、刻みの計算ごと表示通貨で行う。
 */
function fmtAxis(displayValue: number, lang: 'ja' | 'en'): string {
  if (displayValue === 0) return '0'
  if (lang === 'en') {
    if (displayValue >= 1000) return `$${Number((displayValue / 1000).toFixed(1))}k`
    return `$${Math.round(displayValue).toLocaleString('en-US')}`
  }
  if (displayValue >= 10000) return `${Number((displayValue / 10000).toFixed(1))}万`
  return Math.round(displayValue).toLocaleString('ja-JP')
}

const polylineLen = (pts: { x: number; y: number }[]) => {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  return Math.max(1, len)
}

function formatElapsed(date: Date, lang: 'ja' | 'en'): string {
  const now = new Date()
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000))
  if (days < 31) return lang === 'ja' ? `${days}日前` : `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.max(0, (now.getFullYear() - date.getFullYear()) * 12 + now.getMonth() - date.getMonth())
  if (months < 12) return lang === 'ja' ? `${months}ヶ月前` : `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (lang === 'ja') return rest ? `${years}年${rest}ヶ月前` : `${years}年前`
  return rest ? `${years}y ${rest}m ago` : `${years} year${years === 1 ? '' : 's'} ago`
}

function formatMonthKey(key: string, lang: 'ja' | 'en'): string {
  const [year, month] = key.split('-').map(Number)
  if (lang === 'ja') return `${year}年${month + 1}月`
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

/** 過去12か月の累計金額を示す折れ線グラフ。 */
function TrendChart({
  points, width, colors, fmtPrice, displayAmount, lang, triggerKey,
}: {
  points: TrendPoint[]
  width: number
  colors: AppColors
  fmtPrice: (n: number | null | undefined) => string
  displayAmount: (jpy: number) => number
  lang: 'ja' | 'en'
  triggerKey: number
}) {
  const { reduceMotion } = useApp()
  const draw = useRef(new Animated.Value(0)).current
  const previousTrigger = useRef<number | null>(null)
  const ready = width > 0

  const innerW = Math.max(1, width - CHART_PAD.left - CHART_PAD.right)
  const innerH = CHART_H - CHART_PAD.top - CHART_PAD.bottom
  const displayValues = points.map((point) => displayAmount(point.total))
  const { ticks, top } = niceTicks(Math.max(...displayValues))
  const yOf = (displayValue: number) => CHART_PAD.top + innerH - (displayValue / top) * innerH

  const coords = points.map((_p, i) => ({
    x: CHART_PAD.left + (points.length === 1 ? innerW / 2 : (innerW * i) / (points.length - 1)),
    y: yOf(displayValues[i]),
  }))
  const len = polylineLen(coords)
  const d = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

  useEffect(() => {
    if (!ready) return
    const changed = previousTrigger.current !== triggerKey
    previousTrigger.current = triggerKey
    // 数値は先に見せ、傾向を示す線だけを短く引く。
    if (reduceMotion || !changed) {
      draw.setValue(1)
      return
    }
    draw.setValue(0)
    const animation = Animated.timing(draw, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: false, isInteraction: false })
    animation.start()
    return () => animation.stop()
  }, [draw, triggerKey, ready, reduceMotion])

  const dashoffset = draw.interpolate({ inputRange: [0, 1], outputRange: [len, 0] })
  const current = points[points.length - 1]
  const first = points[0]
  const increase = current.total - first.total
  const formatMetric = (value: number) => fmtPrice(value)

  if (width <= 0) return null

  return (
    <View>
      <Svg width={width} height={CHART_H}>
        {/* 縦軸の目盛り線（0 のみ実線） */}
        {ticks.map((v) => (
          <Path
            key={v}
            d={`M ${CHART_PAD.left} ${yOf(v).toFixed(1)} L ${CHART_PAD.left + innerW} ${yOf(v).toFixed(1)}`}
            stroke={colors.border}
            strokeWidth={1}
            strokeDasharray={v === 0 ? undefined : '3 4'}
          />
        ))}
        <AnimatedPath
          d={d}
          stroke={colors.accentIcon}
          strokeWidth={2.5}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray={`${len} ${len}`}
          strokeDashoffset={dashoffset}
        />
        {/* 各月に点を打つ（現在月は少し大きく） */}
        {coords.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={points[i].isCurrent ? 4.5 : 3} fill={colors.accentIcon} />
        ))}
      </Svg>

      {/* 縦軸ラベル：目盛り線の左端に置く */}
      {ticks.map((v) => (
        <Text
          key={v}
          numberOfLines={1}
          style={[styles.trendAxisLabel, { color: colors.textMuted, top: yOf(v) - 6 }]}
        >
          {fmtAxis(v, lang)}
        </Text>
      ))}

      {/* 横軸ラベル。現在時点は強調 */}
      {points.map((p, i) => (
        <Text
          key={p.key}
          style={[
            styles.trendLabel,
            {
              color: p.isCurrent ? colors.accentText : colors.textMuted,
              fontWeight: p.isCurrent ? '800' : '600',
              width: lang === 'ja' ? 28 : 20,
              left: coords[i].x - (lang === 'ja' ? 14 : 10),
              top: CHART_H - 18,
            },
          ]}
        >
          {lang === 'ja' ? `${p.month}月` : p.month}
        </Text>
      ))}

      <View style={styles.trendFooter}>
        <Text style={[styles.trendFooterText, { color: colors.textMuted }]}>
          {lang === 'ja' ? '過去12か月の累計' : 'Cumulative, past 12 months'}
        </Text>
        <Text style={[styles.trendFooterText, { color: colors.textSub }]}>
          {lang === 'ja' ? '現在 ' : 'Now '}
          <Text style={{ color: colors.accentText, fontWeight: '700' }}>{formatMetric(current.total)}</Text>
        </Text>
      </View>
      <Text style={[styles.trendPeriodChange, { color: colors.textSub }]}>
        {lang === 'ja' ? '表示期間で ' : 'During period '}
        <Text style={{ color: colors.accentText, fontWeight: '700' }}>+{formatMetric(increase)}</Text>
      </Text>
    </View>
  )
}

const identityAmount = (jpy: number) => jpy

function GadgetStatsPanelInner({ sourceGadgets, financialHistoryGadgets, chronicleYears = -1, onRequireChroniclePro, connections = EMPTY_CONNECTIONS, deskStartedAt, triggerKey, colors, t, lang, fmtPrice, displayAmount = identityAmount, loading = false, onFillPrice, showTotalCard = true, collapseDetailsInitially = false, header, onScroll, onContentSizeChange, scrollEventThrottle, scrollRef, contentBottomInset, contentMinHeight, contentShiftStyle }: GadgetStatsPanelProps) {
  const { isDark } = useApp()
  const today = useToday()
  const [detailsExpanded, setDetailsExpanded] = useState(!collapseDetailsInitially)
  // 台数・金額はすべて数量（quantity）込みで数える。共有カード・公開デスク・
  // ガジェット一覧の合計が sumGadgetPrices / sumGadgetQuantities を通しているので、
  // ここだけ1台=1件で数えると同じ画面の中で数字が食い違う
  // 合計金額はケーブルも含める。台数・平均・分布・割合はケーブルを除いた機材で数える
  // （安いケーブルが平均を下げ、端子の無いケーブルが無線の割合の分母に入るため）
  const priced        = useMemo(() => sourceGadgets.filter((g) => validGadgetPrice(g) != null), [sourceGadgets])
  const total         = useMemo(() => sumGadgetPrices(priced), [priced])
  const devices       = useMemo(() => sourceGadgets.filter(countsAsDevice), [sourceGadgets])
  const pricedDevices = useMemo(() => priced.filter(countsAsDevice), [priced])
  const totalQuantity = useMemo(() => sumGadgetQuantities(devices), [devices])
  const pricedCount   = useMemo(() => sumGadgetQuantities(pricedDevices), [pricedDevices])
  const unpricedCount = totalQuantity - pricedCount

  const financialSummary = useMemo(() => {
    if (!financialHistoryGadgets) return null
    return gadgetFinancialSummary(sourceGadgets, financialHistoryGadgets)
  }, [financialHistoryGadgets, sourceGadgets])

  const trendPoints = useMemo(() => growthTrend(sourceGadgets, today), [sourceGadgets, today])
  const [trendWidth, setTrendWidth] = useState(0)

  // 自作ジャンルは同じ 'Other' でも別の行にする（マイガジェットのジャンル別と同じ束ね方）。
  // まとめると、自分で分けたジャンルが全部「その他」1行に潰れる
  const byCategory = useMemo(() => {
    const map = new Map<string, { cat: GadgetCategory; custom?: CustomCategory; count: number; total: number }>()
    for (const g of sourceGadgets) {
      const key = gadgetCategoryKey(g)
      const cur = map.get(key) ?? { cat: g.category, custom: customCategoryOf(g), count: 0, total: 0 }
      const qty = gadgetQuantity(g)
      map.set(key, { ...cur, count: cur.count + qty, total: cur.total + (validGadgetPrice(g) ?? 0) * qty })
    }
    return [...map.entries()]
      .map(([key, v]) => ({ key, ...v }))
  }, [sourceGadgets])
  const categoryRowLabel = (row: { cat: GadgetCategory; custom?: CustomCategory }) => row.custom?.name ?? t('category.' + row.cat)

  const categoryRows = useMemo(
    () => [...byCategory].sort((a, b) => b.total - a.total),
    [byCategory],
  )
  const categoryTotal = total
  const pieData: PieSlice[] = useMemo(
    () => categoryRows
      .map((row) => ({ value: row.total, color: categoryIconColor(row.cat, isDark, '#757575', row.custom?.color) }))
      .filter((slice) => slice.value > 0),
    [categoryRows, isDark],
  )

  const detail = useMemo(() => {
    const now = today
    const top5 = [...pricedDevices]
      .sort((a, b) => (validGadgetPrice(b) ?? 0) - (validGadgetPrice(a) ?? 0))
      .slice(0, 5)

    const dated = devices
      .map((gadget) => ({ gadget, date: parseLocalDate(gadget.purchasedAt) }))
      .filter((item): item is { gadget: Gadget; date: Date } => !!item.date && item.date <= now)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
    const thisYear = dated.filter((item) => item.date.getFullYear() === now.getFullYear())
    const thisYearTotal = sumGadgetPrices(thisYear.map((item) => item.gadget))

    const purchaseMonths = new Map<string, { count: number; total: number }>()
    for (const item of dated) {
      const key = `${item.date.getFullYear()}-${String(item.date.getMonth()).padStart(2, '0')}`
      const current = purchaseMonths.get(key) ?? { count: 0, total: 0 }
      const qty = gadgetQuantity(item.gadget)
      purchaseMonths.set(key, {
        count: current.count + qty,
        total: current.total + (validGadgetPrice(item.gadget) ?? 0) * qty,
      })
    }
    const busiestMonth = [...purchaseMonths.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count || b.total - a.total || b.key.localeCompare(a.key))[0] ?? null

    const displayCount = sumGadgetQuantities(devices.filter((g) => g.displayOnly))
    const totalPorts = devices.reduce((sum, gadget) => sum + gadgetQuantity(gadget) * gadget.ports.reduce((portSum, port) => {
      if (isWirelessPortType(port.type) || isWirelessPowerPort(port)) return portSum
      return portSum + (Number.isFinite(port.count) && port.count > 0 ? Math.floor(port.count) : 0)
    }, 0), 0)

    const connectionTotals = new Map<MapConnection['cableType'], number>()
    for (const connection of connections) {
      if (!requiresPhysicalCable(connection.cableType)) continue
      connectionTotals.set(connection.cableType, (connectionTotals.get(connection.cableType) ?? 0) + 1)
    }
    const wiring = [...connectionTotals.entries()].sort((a, b) => b[1] - a[1])

    const priceBuckets = [
      { key: 'under10k', min: 0, max: 10_000, count: 0 },
      { key: '10to50k', min: 10_000, max: 50_000, count: 0 },
      { key: '50to100k', min: 50_000, max: 100_000, count: 0 },
      { key: 'over100k', min: 100_000, max: Number.POSITIVE_INFINITY, count: 0 },
    ]
    for (const gadget of pricedDevices) {
      const price = validGadgetPrice(gadget) ?? 0
      const bucket = priceBuckets.find((item) => price >= item.min && price < item.max)
      if (bucket) bucket.count += gadgetQuantity(gadget)
    }

    return {
      top5,
      averagePrice: pricedCount > 0 ? Math.round(sumGadgetPrices(pricedDevices) / pricedCount) : null,
      datedCount: sumGadgetQuantities(dated.map((item) => item.gadget)),
      oldest: dated[0] ?? null,
      newest: dated[dated.length - 1] ?? null,
      thisYearCount: sumGadgetQuantities(thisYear.map((item) => item.gadget)),
      thisYearTotal,
      busiestMonth,
      displayCount,
      totalPorts,
      wiring,
      wiringTotal: wiring.reduce((sum, [, count]) => sum + count, 0),
      priceBuckets,
    }
  }, [devices, connections, pricedDevices, pricedCount, today])

  const currentTarget = useCoachTarget('insight-current')
  const cumulativeTarget = useCoachTarget('insight-cumulative')
  const totalTarget = useCoachTarget('insight-total')
  const totalStatsTarget = useCoachTarget('insight-total-stats')
  const growthTarget = useCoachTarget('insight-growth')
  const chronicleTarget = useCoachTarget('insight-chronicle')
  const yearTarget = useCoachTarget('insight-year')
  const detailsTarget = useCoachTarget('insight-details')

  // 「最多 · N台」はケーブル（本数で数える）を候補にしない
  const mostByCount = useMemo(
    () => [...byCategory].filter((row) => row.cat !== 'Cable').sort((a, b) => b.count - a.count)[0] ?? null,
    [byCategory],
  )
  const mostByValue = useMemo(() => {
    const first = [...byCategory].sort((a, b) => b.total - a.total)[0]
    return first && first.total > 0 ? first : null
  }, [byCategory])

  if (loading && sourceGadgets.length === 0) {
    return (
      <ScrollView contentContainerStyle={[styles.scroll, styles.loadingBox]} showsVerticalScrollIndicator={false}>
        <ActivityIndicator color={colors.accentIcon} />
      </ScrollView>
    )
  }

  return (
    <Reanimated.ScrollView
      ref={scrollRef}
      contentContainerStyle={[styles.scroll, !!contentBottomInset && { paddingBottom: 60 + contentBottomInset }, !!contentMinHeight && { minHeight: contentMinHeight }]}
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      onContentSizeChange={onContentSizeChange}
      scrollEventThrottle={scrollEventThrottle}
    >
      <Reanimated.View style={contentShiftStyle}>
      {/* header のカードは自前で横マージン16を持つ。ここの padding と二重になるので打ち消す */}
      {header != null && <View style={styles.headerSlot}>{header}</View>}
      {financialSummary && (
        <View style={[styles.investmentCard, { backgroundColor: colors.card }]}>
          <View style={styles.helpHeading}>
            <Text style={[styles.pieSectionTitle, { color: colors.textSub, marginBottom: 0, flex: 1 }]}>
              {lang === 'ja' ? 'デスクへの投資' : 'Desk investment'}
            </Text>
          </View>
          <View ref={currentTarget} style={[styles.currentInvestment, { backgroundColor: colors.accent + '18' }]}>
            <Text style={[styles.investmentLabel, { color: colors.textMuted }]}>
              {lang === 'ja' ? '現在の構成金額' : 'Current setup value'}
            </Text>
            {/* 主役の数値は text。同じカードの「これまでの累計」「現在構成外」も text で、
                ここだけ accentText だと役割が同じなのに色が割れる。どこが主役かは
                面の色（accent + '18'）が示している */}
            <Text style={[styles.currentInvestmentValue, { color: colors.text }]}>{fmtPrice(financialSummary.currentTotal)}</Text>
            <Text style={[styles.investmentCoverage, { color: colors.textMuted }]}>
              {lang === 'ja'
                ? `価格入力済み ${financialSummary.currentPricedCount} / ${financialSummary.currentCount}台`
                : `Prices entered for ${financialSummary.currentPricedCount} / ${financialSummary.currentCount}`}
            </Text>
          </View>
          <View
            ref={cumulativeTarget}
            style={[styles.investmentProArea, { borderTopColor: colors.separator }]}
          >
            <View style={styles.investmentProRow}>
              <View style={styles.investmentProMetric}>
                <Text style={[styles.investmentLabel, { color: colors.textMuted }]}>{lang === 'ja' ? 'これまでの累計' : 'Cumulative'}</Text>
                <Text style={[styles.investmentProValue, { color: colors.text }]}>
                  {fmtPrice(financialSummary.cumulativeTotal)}
                </Text>
              </View>
              <View style={[styles.investmentProMetric, { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth }]}>
                <Text style={[styles.investmentLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '現在構成外' : 'Outside setup'}</Text>
                <Text style={[styles.investmentProValue, { color: colors.text }]}>
                  {fmtPrice(financialSummary.outsideTotal)}
                </Text>
              </View>
            </View>
            <Text style={[styles.investmentCoverage, { color: colors.textMuted }]}>
              {lang === 'ja'
                ? `累計は価格入力済み ${financialSummary.historyPricedCount} / ${financialSummary.historyCount}台から算出`
                : `Cumulative value uses ${financialSummary.historyPricedCount} / ${financialSummary.historyCount} priced gadgets`}
            </Text>
          </View>
        </View>
      )}

      {/* デスクの概要 */}
      {showTotalCard && (
        <View style={[styles.totalCard, { backgroundColor: colors.accent + '18' }]}>
          {deskStartedAt ? (
            /* 親（totalCard）が accent + '18' なので、ここに accent を重ねると
               合成でさらに濃くなり、上の accentText が AA を割る。白い面で浮かせる */
            <View style={[styles.deskAgeBadge, { backgroundColor: colors.card }]}>
              <AppIcon name={ICONS.calendar} size={13} color={colors.accentText} />
              <Text style={[styles.deskAgeText, { color: colors.accentText }]}>
                {lang === 'ja' ? 'デスク歴 ' : 'Desk age '}{computeDeskAge(deskStartedAt, lang)}
              </Text>
            </View>
          ) : null}
          <View style={styles.helpHeading}>
            <Text style={[styles.totalLabel, { color: colors.textSub }]}>{t('stats.totalCost')}</Text>
          </View>
          {/* 同じ理由で text。白い card の上の accentText は #B04D00 まで暗くしないと
              4.5:1 に届かず、40px の数字では茶色の塊になる */}
          <Text ref={totalTarget} style={[styles.totalAmount, { color: colors.text }]}>{fmtPrice(total)}</Text>
          <Text style={[styles.totalSub, { color: colors.textMuted }]}>
            {t('stats.aggregated', { n: pricedCount })}
            {unpricedCount > 0 ? t('stats.noPriceNote', { n: unpricedCount }) : ''}
          </Text>
          <View ref={totalStatsTarget} style={styles.heroStatRow}>
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: colors.text }]}>{totalQuantity}</Text>
              <Text style={[styles.heroStatLabel, { color: colors.textMuted }]}>{lang === 'ja' ? 'ガジェット' : 'Gadgets'}</Text>
            </View>
            <View style={[styles.heroStat, { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[styles.heroStatValue, { color: colors.text }]}>{detail.averagePrice == null ? '—' : fmtPrice(detail.averagePrice)}</Text>
              <Text style={[styles.heroStatLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '平均価格' : 'Average'}</Text>
            </View>
            <View style={[styles.heroStat, { borderLeftColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[styles.heroStatValue, { color: colors.text }]}>{byCategory.length}</Text>
              <Text style={[styles.heroStatLabel, { color: colors.textMuted }]}>{lang === 'ja' ? 'ジャンル別' : 'By category'}</Text>
            </View>
          </View>
        </View>
      )}

      {/* デスクの成長 */}
      <View
        ref={growthTarget}
        style={[styles.trendCard, { backgroundColor: colors.card }]}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width - 32   // 左右パディングぶん
          setTrendWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w))
        }}
      >
        <View style={styles.sectionHead}>
          <Text style={[styles.pieSectionTitle, { color: colors.textSub, marginBottom: 0 }]}>
            {lang === 'ja' ? 'デスクの成長' : 'Desk Growth'}
          </Text>
        </View>
        {/* 線は金額の累計なので、購入日だけ入っていて価格が1件も無いと ¥0 の平らな線と大きな空白になる。
            そのときは価格を入れれば見られることを案内する */}
        {detail.datedCount > 0 && trendPoints.some((p) => p.total > 0) ? (
          <>
            <View style={styles.trendMetricHead}>
              <Text style={[styles.trendLabelTitle, { color: colors.textMuted }]}>{lang === 'ja' ? '現在' : 'Current'}</Text>
              <Text style={[styles.trendTotal, { color: colors.text }]}>
                {fmtPrice(trendPoints[trendPoints.length - 1].total)}
              </Text>
            </View>
            <TrendChart
              points={trendPoints}
              width={trendWidth}
              colors={colors}
              fmtPrice={fmtPrice}
              displayAmount={displayAmount}
              lang={lang}
              triggerKey={triggerKey}
            />
            <Text style={[styles.dataCoverage, { color: colors.textMuted }]}>
              {lang === 'ja'
                ? `購入日入力済み ${detail.datedCount} / ${totalQuantity}台`
                : `Purchase date entered for ${detail.datedCount} / ${totalQuantity}`}
            </Text>
          </>
        ) : (
          <Text style={[styles.emptyMetric, { color: colors.textMuted }]}>
            {detail.datedCount > 0
              ? (lang === 'ja' ? '価格を入力すると成長を振り返れます' : 'Add prices to see your desk grow')
              : (lang === 'ja' ? '購入日を入力すると成長を振り返れます' : 'Add purchase dates to see your desk grow')}
          </Text>
        )}
      </View>

      {/* デスク年表：在籍期間。撤去済みを渡せるデスク詳細では退役分も並ぶ */}
      <View ref={chronicleTarget} collapsable={false}>
      <DeskChronicleCard
        gadgets={financialHistoryGadgets ?? sourceGadgets}
        colors={colors}
        lang={lang}
        isDark={isDark}
        windowYears={chronicleYears}
        onRequirePro={onRequireChroniclePro}
      />
      </View>

      {/* 今年と購入ピーク */}
      <View ref={yearTarget} style={[styles.pieCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.pieSectionTitle, { color: colors.textSub }]}>
          {lang === 'ja' ? `${today.getFullYear()}年のデスク` : `Your Desk in ${today.getFullYear()}`}
        </Text>
        <View style={styles.statTileRow}>
          <View style={[styles.statTile, { backgroundColor: colors.chip }]}>
            <Text style={[styles.statTileValue, { color: colors.text }]}>{fmtPrice(detail.thisYearTotal)}</Text>
            <Text style={[styles.statTileLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '増えた金額' : 'Value added'}</Text>
          </View>
        </View>
        <View style={[styles.storyCallout, { backgroundColor: colors.accent + '12' }]}>
          <AppIcon name="calendar-star" size={22} color={colors.accentText} />
          <View style={styles.storyCalloutBody}>
            <Text style={[styles.storyCalloutLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '購入が多かった月' : 'Busiest purchase month'}</Text>
            <Text style={[styles.storyCalloutValue, { color: colors.text }]}>
              {detail.busiestMonth
                ? `${formatMonthKey(detail.busiestMonth.key, lang)} · ${detail.busiestMonth.count}${lang === 'ja' ? '台' : ' items'}`
                : '—'}
            </Text>
          </View>
          {detail.busiestMonth ? <Text style={[styles.storyCalloutSide, { color: colors.accentText }]}>{fmtPrice(detail.busiestMonth.total)}</Text> : null}
        </View>
      </View>

      {collapseDetailsInitially && (
        <TouchableOpacity
          ref={detailsTarget}
          style={[styles.detailsToggle, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => setDetailsExpanded((expanded) => !expanded)}
          activeOpacity={0.78}
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsExpanded }}
          accessibilityLabel={detailsExpanded
            ? (lang === 'ja' ? '詳しい分析を閉じる' : 'Hide detailed analysis')
            : (lang === 'ja' ? '詳しい分析を見る' : 'Show detailed analysis')}
        >
          <View style={[styles.detailsToggleIcon, { backgroundColor: colors.accent + '18' }]}>
            <AppIcon name={ICONS.stats} size={21} color={colors.accentText} />
          </View>
          <View style={styles.detailsToggleBody}>
            <Text style={[styles.detailsToggleTitle, { color: colors.text }]}>
              {detailsExpanded
                ? (lang === 'ja' ? '詳しい分析を閉じる' : 'Hide detailed analysis')
                : (lang === 'ja' ? '詳しい分析を見る' : 'View detailed analysis')}
            </Text>
            <Text style={[styles.detailsToggleText, { color: colors.textMuted }]}>
              {lang === 'ja'
                ? 'ジャンル・デスクの時間・構成・配線・価格帯'
                : 'Categories, timeline, setup, wiring, and price ranges'}
            </Text>
          </View>
          <AppIcon name={detailsExpanded ? ICONS.chevronUp : ICONS.chevronDown} size={21} color={colors.accentText} />
        </TouchableOpacity>
      )}

      {detailsExpanded && (
      <>
      {/* カテゴリ構成 */}
      <View style={[styles.pieCard, { backgroundColor: colors.card }]}>
        <View style={styles.sectionHead}>
          <Text style={[styles.pieSectionTitle, { color: colors.textSub, marginBottom: 0 }]}>
            {lang === 'ja' ? 'ジャンル構成' : 'Categories'}
          </Text>
        </View>
        {mostByCount ? (
          <View style={styles.statTileRow}>
            <View style={[styles.statTile, { backgroundColor: colors.chip }]}>
              <Text style={[styles.statTileValue, { color: colors.text }]} numberOfLines={1}>{categoryRowLabel(mostByCount)}</Text>
              <Text style={[styles.statTileLabel, { color: colors.textMuted }]}>{lang === 'ja' ? `最多 · ${mostByCount.count}台` : `Most · ${mostByCount.count}`}</Text>
            </View>
            <View style={[styles.statTile, { backgroundColor: colors.chip }]}>
              <Text style={[styles.statTileValue, { color: colors.text }]} numberOfLines={1}>{mostByValue ? categoryRowLabel(mostByValue) : '—'}</Text>
              <Text style={[styles.statTileLabel, { color: colors.textMuted }]}>{lang === 'ja' ? `最高額 · ${fmtPrice(mostByValue?.total ?? 0)}` : `Highest value · ${fmtPrice(mostByValue?.total ?? 0)}`}</Text>
            </View>
          </View>
        ) : null}
        <View style={styles.pieCenter}>
          <DonutChart
            data={pieData}
            size={220}
            total={categoryTotal}
            textColor={colors.text}
            mutedColor={colors.textMuted}
            centerLabel={lang === 'ja' ? '合計' : 'Total'}
            formatValue={(value) => fmtPrice(value)}
          />
        </View>
        {pieData.length > 0 && (
          <View style={styles.legendGrid}>
            {categoryRows
              .filter((row) => row.total > 0)
              .map((row) => {
                const { key, cat, total: catTotal } = row
                const pct = categoryTotal > 0 ? Math.round((catTotal / categoryTotal) * 100) : 0
                const catColor = categoryIconColor(cat, isDark, '#757575', row.custom?.color)
                return (
                  <View key={key} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: catColor }]} />
                    <Text style={[styles.legendCat, { color: colors.text }]} numberOfLines={1}>
                      {categoryRowLabel(row)}
                    </Text>
                    <Text style={[styles.legendPct, { color: colors.textSub }]}>
                      {pct}% · {fmtPrice(catTotal)}
                    </Text>
                  </View>
                )
              })}
          </View>
        )}
      </View>

      {/* 高額ガジェット TOP5 */}
      {detail.top5.length > 0 && (
        <View style={[styles.pieCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.pieSectionTitle, { color: colors.textSub }]}>
            {lang === 'ja' ? '高額ガジェット TOP5' : 'Top 5 Most Expensive'}
          </Text>
          {detail.top5.map((g, i) => {
            const catColor = categoryIconColor(g.category, isDark, '#757575', g.customCategory?.color)
            return (
              <View
                key={g.id}
                style={[styles.topRow, i < detail.top5.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator }]}
              >
                <Text style={[styles.topRank, { color: colors.textSub }]}>{i + 1}</Text>
                <CategoryIcon category={g.category} pcFormFactor={g.pcFormFactor} customIcon={g.customCategory?.icon} size={18} color={catColor} />
                <Text style={[styles.topName, { color: colors.text }]} numberOfLines={1}>{localizedGadgetName(g, lang)}</Text>
                <View style={styles.topRight}>
                  <Text style={[styles.topPrice, { color: colors.text }]}>{fmtPrice(g.price)}</Text>
                </View>
              </View>
            )
          })}
        </View>
      )}

      {/* 最古と最新 */}
      <View style={[styles.pieCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.pieSectionTitle, { color: colors.textSub }]}>
          {lang === 'ja' ? 'デスクの時間' : 'Desk Timeline'}
        </Text>
        {detail.oldest && detail.newest ? (
          <>
            {[
              { key: 'oldest', label: lang === 'ja' ? '最古の相棒' : 'Oldest companion', item: detail.oldest, icon: ICONS.history },
              { key: 'newest', label: lang === 'ja' ? '最新ガジェット' : 'Newest addition', item: detail.newest, icon: 'new-box' },
            ].map(({ key, label, item, icon }, index) => (
              <View key={key} style={[styles.timelineRow, index === 0 && { borderBottomColor: colors.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}>
                <View style={[styles.timelineIcon, { backgroundColor: colors.accent + '18' }]}>
                  <AppIcon name={icon === ICONS.history ? ICONS.history : 'new-box'} size={21} color={colors.accentText} />
                </View>
                <View style={styles.timelineBody}>
                  <Text style={[styles.timelineLabel, { color: colors.textMuted }]}>{label}</Text>
                  <Text style={[styles.timelineName, { color: colors.text }]} numberOfLines={1}>{localizedGadgetName(item.gadget, lang)}</Text>
                  <Text style={[styles.timelineDate, { color: colors.textMuted }]}>{formatDate(item.date, lang)}</Text>
                </View>
                <Text style={[styles.timelineElapsed, { color: colors.accentText }]}>{formatElapsed(item.date, lang)}</Text>
              </View>
            ))}
          </>
        ) : (
          <Text style={[styles.emptyMetric, { color: colors.textMuted }]}>
            {lang === 'ja' ? '購入日を入力すると最古・最新のガジェットを表示します' : 'Add purchase dates to see your oldest and newest gadgets'}
          </Text>
        )}
      </View>

      {/* 構成の内訳 */}
      {sourceGadgets.length > 0 && (
        <View style={[styles.pieCard, { backgroundColor: colors.card }]}>
          <Text style={[styles.pieSectionTitle, { color: colors.textSub }]}>
            {lang === 'ja' ? '構成の内訳' : 'Setup Breakdown'}
          </Text>
          <View style={styles.statTileRow}>
            <View style={[styles.statTile, { backgroundColor: colors.chip }]}>
              <Text style={[styles.statTileValue, { color: colors.text }]}>{totalQuantity - detail.displayCount}</Text>
              <Text style={[styles.statTileLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '使用中' : 'In use'}</Text>
            </View>
            <View style={[styles.statTile, { backgroundColor: colors.chip }]}>
              <Text style={[styles.statTileValue, { color: colors.text }]}>{detail.displayCount}</Text>
              <Text style={[styles.statTileLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '飾り' : 'Decor'}</Text>
            </View>
            <View style={[styles.statTile, { backgroundColor: colors.chip }]}>
              <Text style={[styles.statTileValue, { color: colors.text }]}>{detail.totalPorts}</Text>
              <Text style={[styles.statTileLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '総ポート数' : 'Total ports'}</Text>
            </View>
          </View>
        </View>
      )}

      {/* 配線 */}
      <View style={[styles.pieCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.pieSectionTitle, { color: colors.textSub }]}>
          {lang === 'ja' ? '配線コレクション' : 'Cable Collection'}
        </Text>
        <View style={[styles.wiringHero, { backgroundColor: colors.chip }]}>
          <Text style={[styles.wiringHeroValue, { color: colors.text }]}>{detail.wiringTotal}</Text>
          <Text style={[styles.wiringHeroLabel, { color: colors.textMuted }]}>{lang === 'ja' ? '登録されている配線' : 'Registered cables'}</Text>
        </View>
        <Text style={[styles.portSectionLabel, { color: colors.textMuted }]}>{lang === 'ja' ? 'よく使う規格 TOP3' : 'Top 3 cable standards'}</Text>
        {detail.wiring.length > 0 ? (
          <View style={styles.portChipWrap}>
            {detail.wiring.slice(0, 3).map(([type, count]) => {
              const pc = portIconColor(type, isDark)
              return (
                <View key={type} style={[styles.portChip, { backgroundColor: colors.chip }]}>
                  <View style={[styles.portChipDot, { backgroundColor: pc }]} />
                  <Text style={[styles.portChipText, { color: colors.text }]}>{cableLabel(type, lang)} ×{count}</Text>
                </View>
              )
            })}
          </View>
        ) : (
          <Text style={[styles.emptyMetric, { color: colors.textMuted }]}>{lang === 'ja' ? '配線はまだ登録されていません' : 'No cables registered yet'}</Text>
        )}
      </View>

      {/* 価格帯 */}
      <View style={[styles.pieCard, { backgroundColor: colors.card }]}>
        <Text style={[styles.pieSectionTitle, { color: colors.textSub }]}>{lang === 'ja' ? '価格帯の分布' : 'Price Distribution'}</Text>
        {pricedCount > 0 ? detail.priceBuckets.map((bucket) => {
          const pct = Math.round((bucket.count / pricedCount) * 100)
          const label = bucket.key === 'under10k'
            ? `< ${fmtPrice(10_000)}`
            : bucket.key === '10to50k'
              ? `${fmtPrice(10_000)} – ${fmtPrice(50_000)}`
              : bucket.key === '50to100k'
                ? `${fmtPrice(50_000)} – ${fmtPrice(100_000)}`
                : `${fmtPrice(100_000)} +`
          return (
            <View key={bucket.key} style={styles.priceBandRow}>
              <View style={styles.priceBandHead}>
                <Text style={[styles.priceBandLabel, { color: colors.text }]}>{label}</Text>
                <Text style={[styles.priceBandCount, { color: colors.textMuted }]}>{bucket.count}{lang === 'ja' ? '台' : ''} · {pct}%</Text>
              </View>
              <View style={[styles.priceBandTrack, { backgroundColor: colors.chip }]}>
                <View style={[styles.priceBandFill, { backgroundColor: colors.accent, width: `${pct}%` }]} />
              </View>
            </View>
          )
        }) : (
          <Text style={[styles.emptyMetric, { color: colors.textMuted }]}>{lang === 'ja' ? '価格を入力すると分布を表示します' : 'Add prices to see the distribution'}</Text>
        )}
      </View>
      </>
      )}

      {unpricedCount > 0 && onFillPrice && (
        <TouchableOpacity
          style={styles.hintRow}
          onPress={onFillPrice}
          activeOpacity={0.7}
        >
          <Text style={[styles.hint, { color: colors.textMuted, flex: 1 }]}>
            {t('stats.hint', { n: unpricedCount })}
          </Text>
          <Text style={[styles.hintAction, { color: colors.accentText }]}>
            {lang === 'ja' ? '入力する' : 'Fill in'}
          </Text>
        </TouchableOpacity>
      )}
      </Reanimated.View>
    </Reanimated.ScrollView>
  )
}

// 金額の横の「？」。その金額のところだけを指す。どれもデスク詳細のタブの中身にある
const inContent = (steps: CoachStep[]): CoachStep[] => steps.map((step) => ({ within: DESK_CONTENT, ...step }))
const INVESTMENT_COACH: CoachStep[] = inContent([
  { target: 'insight-current', title: { ja: '現在の構成金額', en: 'Current setup value' }, emphasis: { ja: ['登録価格 × 数量', '価格を入れていない物'], en: ['registered price × quantity', 'Items without a price'] }, ja: 'いまこのデスクにある機材の「登録価格 × 数量」の合計です。ケーブルも含み、価格を入れていない物は足していません。', en: 'Adds registered price × quantity for the gear on this desk now, including cables. Items without a price are not counted.' },
  { target: 'insight-cumulative', title: { ja: 'これまでの累計', en: 'Cumulative value' }, ja: '履歴に残る機材を重複なく足した金額です。「現在構成外」は、そのうち今はデスクから外れている機材の分です。', en: 'Adds every item in the desk’s history once. Outside setup is the part no longer on the desk.' },
])

const TOTAL_COACH: CoachStep[] = inContent([
  { target: 'insight-total', title: { ja: '構成の合計金額', en: 'Setup total' }, emphasis: { ja: ['登録価格 × 数量', '価格が入っていない物'], en: ['Registered price × quantity', 'Items without a price'] }, pad: 6, ja: 'このデスクの機材の「登録価格 × 数量」の合計です。価格が入っていない物は足していません。', en: 'Registered price × quantity for this desk’s gear. Items without a price are not counted.' },
  { target: 'insight-total-stats', title: { ja: '台数と平均価格', en: 'Counts and average price' }, pad: 4, ja: '台数はケーブルを除いて数えます。平均価格は、価格が入っている機材の平均です。', en: 'Gadget counts exclude cables. Average uses gadgets that have a price.' },
])

// 「履歴・分析」タブの「？」で、上から順に指す
export const INSIGHTS_COACH: CoachStep[] = [
  ...INVESTMENT_COACH,
  ...TOTAL_COACH,
  ...inContent([
  { target: 'insight-growth', title: { ja: '金額の推移', en: 'Value over time' }, ja: '購入日と価格を入れた機材から、デスクの金額がどう増えてきたかを線で表します。', en: 'How the desk’s value grew, from gear with purchase dates and prices.' },
  { target: 'insight-chronicle', title: { ja: '機材の年表', en: 'Gear timeline' }, ja: '機材ごとに、デスクで使っていた期間を並べた年表です。導入日・撤去日の記録から作ります。', en: 'A timeline of how long each item has been on the desk, from install and removal dates.' },
  { target: 'insight-year', title: { ja: '今年の購入', en: 'This year\'s purchases' }, ja: '今年増えた金額と、購入が多かった月です。', en: 'Value added this year and your busiest purchase month.' },
  { target: 'insight-details', title: { ja: '内訳を見る', en: 'View breakdowns' }, pad: 4, ja: '開くと、ジャンル構成・価格帯・配線の内訳などを見られます。', en: 'Open for breakdowns by category, price range, wiring, and more.' },
  ]),
]

const styles = StyleSheet.create({
  scroll: { padding: UI_METRICS.screenGutter, paddingBottom: 60 },
  headerSlot: { marginHorizontal: -UI_METRICS.screenGutter, marginTop: -UI_METRICS.screenGutter, marginBottom: 4 },
  loadingBox: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },

  helpHeading: { flexDirection: 'row', alignItems: 'center' },
  investmentCard: { borderRadius: UI_METRICS.cardRadius, padding: 14, marginBottom: 20 },
  // 外側の investmentCard が既に左右 14 を取っている。中の面でも 14 取ると二重になり、金額の行が狭くなっていた
  currentInvestment: { borderRadius: UI_METRICS.panelRadius, paddingVertical: 16, paddingHorizontal: 8, alignItems: 'center' },
  investmentLabel: { fontSize: 11, fontWeight: '600' },
  currentInvestmentValue: { fontSize: 30, fontWeight: '800', letterSpacing: -0.8, marginTop: 3 },
  investmentCoverage: { fontSize: 10, textAlign: 'center', marginTop: 6 },
  investmentProArea: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 12 },
  investmentProRow: { flexDirection: 'row' },
  investmentProMetric: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  investmentProValue: { fontSize: 18, fontWeight: '800', marginTop: 4 },
  detailsToggle: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: UI_METRICS.cardRadius, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 20 },
  detailsToggleIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  detailsToggleBody: { flex: 1, minWidth: 0 },
  detailsToggleTitle: { fontSize: 14, fontWeight: '800' },
  detailsToggleText: { fontSize: 11, lineHeight: 16, marginTop: 3 },

  // 合計カード
  // 左右は他のカードと同じ幅に揃える。24 取ると下の3つの数値（heroStat）の欄が狭まり、桁の多い金額が詰まる
  totalCard: {
    borderRadius: UI_METRICS.cardRadius,
    paddingVertical: 24,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 16,
  },
  deskAgeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: UI_METRICS.panelRadius,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  deskAgeText: { fontSize: 13, fontWeight: '700' },
  totalLabel: { fontSize: 13, marginBottom: 6 },
  totalAmount: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  totalSub: { fontSize: 12, marginTop: 6 },
  heroStatRow: { flexDirection: 'row', width: '100%', marginTop: 20 },
  heroStat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  heroStatValue: { fontSize: 15, fontWeight: '800' },
  heroStatLabel: { fontSize: 10, fontWeight: '600', marginTop: 3 },

  // ドーナツグラフカード
  // 合計額 + 月別支出グラフ
  trendCard: {
    borderRadius: UI_METRICS.cardRadius,
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  trendLabelTitle:   { fontSize: 11, fontWeight: '600' },
  trendTotal:        { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  trendMetricHead:   { marginTop: 12, marginBottom: 4 },
  trendLabel:        { position: 'absolute', width: 20, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  trendAxisLabel:    { position: 'absolute', left: 0, width: CHART_PAD.left - 8, fontSize: 10, fontWeight: '600', textAlign: 'right' },
  trendFooter:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  trendFooterText:   { fontSize: 11, fontWeight: '600' },
  trendPeriodChange: { fontSize: 11, fontWeight: '600', textAlign: 'right', marginTop: 2 },
  dataCoverage:      { fontSize: 10, textAlign: 'center', marginTop: 8 },

  pieCard: {
    borderRadius: UI_METRICS.cardRadius,
    paddingTop: 14,
    paddingBottom: 8,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  pieSectionTitle: { fontSize: 12, fontWeight: '700', marginBottom: 10, letterSpacing: 0.3 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 },
  emptyMetric: { fontSize: 12, lineHeight: 18, textAlign: 'center', paddingVertical: 20 },

  // 数値タイル
  statTileRow:   { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statTile:      { flex: 1, borderRadius: UI_METRICS.controlRadius, paddingVertical: 12, alignItems: 'center', gap: 3 },
  statTileValue: { fontSize: 15, fontWeight: '800', letterSpacing: -0.3 },
  statTileLabel: { fontSize: 10, fontWeight: '600' },

  storyCallout: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: UI_METRICS.controlRadius, padding: 12, marginBottom: 10 },
  storyCalloutBody: { flex: 1, minWidth: 0 },
  storyCalloutLabel: { fontSize: 10, fontWeight: '600' },
  storyCalloutValue: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  storyCalloutSide: { fontSize: 12, fontWeight: '700' },

  // 高額TOP5
  topRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9 },
  topRank:   { width: 20, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  topName:   { flex: 1, fontSize: 13, fontWeight: '600' },
  topRight:  { alignItems: 'flex-end' },
  topPrice:  { fontSize: 13, fontWeight: '700' },

  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  timelineIcon: { width: 38, height: 38, borderRadius: UI_METRICS.controlRadius, alignItems: 'center', justifyContent: 'center' },
  timelineBody: { flex: 1, minWidth: 0 },
  timelineLabel: { fontSize: 10, fontWeight: '600' },
  timelineName: { fontSize: 13, fontWeight: '700', marginTop: 1 },
  timelineDate: { fontSize: 10, marginTop: 2 },
  timelineElapsed: { fontSize: 11, fontWeight: '700', textAlign: 'right' },

  // 配線チップ
  portSectionLabel: { fontSize: 10, fontWeight: '600', marginBottom: 6 },
  portChipWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 8 },
  portChip:         { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: UI_METRICS.panelRadius, paddingHorizontal: 9, paddingVertical: 4 },
  portChipDot:      { width: 7, height: 7, borderRadius: 3.5 },
  portChipText:     { fontSize: 11, fontWeight: '600' },
  wiringHero: { borderRadius: UI_METRICS.controlRadius, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  wiringHeroValue: { fontSize: 28, fontWeight: '800' },
  wiringHeroLabel: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  pieCenter: { alignItems: 'center', marginBottom: 14 },
  legendGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  legendItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingRight: 8,
    gap: 5,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  legendCat: { flex: 1, fontSize: 11, fontWeight: '500' },
  legendPct: { fontSize: 11, fontWeight: '700' },

  priceBandRow: { marginBottom: 13 },
  priceBandHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  priceBandLabel: { fontSize: 11, fontWeight: '600' },
  priceBandCount: { fontSize: 10, fontWeight: '600' },
  priceBandTrack: { height: 7, borderRadius: UI_METRICS.pillRadius, overflow: 'hidden' },
  priceBandFill: { height: '100%', borderRadius: 4 },

  hint: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 4 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 4 },
  hintAction: { fontSize: 13, fontWeight: '700' },
})

// 統計は価格・日付などの自由入力から集計する。落ちても履歴・分析タブ以外は使えるようにする
export function GadgetStatsPanel(props: GadgetStatsPanelProps) {
  return <SectionBoundary name="gadget_stats"><GadgetStatsPanelInner {...props} /></SectionBoundary>
}
