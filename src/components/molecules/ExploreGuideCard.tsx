import { useIsFocused } from '@react-navigation/native'
import { useHeaderHeight } from '@react-navigation/elements'
import { useEffect, useRef, useState } from 'react'
import { Keyboard, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { useSpotlight } from '../../context/SpotlightContext'
import { endExploreGuide, markExploreGuideSeen, useExploreGuide } from '../../hooks/useExploreGuide'
import { ExploreGuideId, isExploreGuideVisible } from '../../utils/exploreGuide'

type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void }
type Props = {
  id: ExploreGuideId
  eligible: boolean
  blocked: boolean
  getViewport: () => Measurable | null | undefined
  getBottomBoundary?: () => Measurable | null
  onHelp: () => void
}
const copy = {
  'explore-open-desk': {
    ja: ['気になるデスクを開いてみる', 'みんなが公開したデスクを、写真・機材・配線図で見られます。写真かデスク名をタップしてください。'],
    en: ['Open a desk you like', 'Explore desks people have shared, including photos, gear, and wiring maps. Tap a photo or desk name.'],
  },
  'explore-desk-tabs': {
    ja: ['機材とつなぎ方を見る', 'ここには、このデスクで使われている機材が並びます。上の「配線」で、つなぎ方も見られます。'],
    en: ['Explore the gear and wiring', 'These are the gadgets used on this desk. Open Wiring above to see how they connect.'],
  },
}

export function ExploreGuideCard({ id, eligible, blocked, getViewport, getBottomBoundary, onHelp }: Props) {
  const { colors: C, lang } = useApp()
  const { shown } = useSpotlight()
  const focused = useIsFocused()
  const progress = useExploreGuide()
  const [exposedHere, setExposedHere] = useState(false)
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible())
  const ref = useRef<View>(null)
  const { height: screenHeight } = useWindowDimensions()
  const headerHeight = useHeaderHeight()
  const insets = useSafeAreaInsets()
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false))
    return () => { show.remove(); hide.remove() }
  }, [])
  useEffect(() => { if (!focused) setExposedHere(false) }, [focused])
  const allowed = focused && eligible && progress.loaded && !progress.dismissed && (exposedHere || !progress.seen.includes(id))
  const visible = allowed && !blocked && !shown && !keyboardVisible
  useEffect(() => {
    if (!visible || exposedHere) return
    let active = true
    let visibleSince = 0
    const check = () => {
      getViewport()?.measureInWindow((vx, vy, vw, vh) => {
        const measureCard = (bottomLimit: number) => ref.current?.measureInWindow((x, y, width, height) => {
          if (!active) return
          const top = Math.max(vy, headerHeight)
          const bottom = Math.min(vy + vh, screenHeight - insets.bottom, bottomLimit)
          if (!isExploreGuideVisible({ x, y, width, height }, { x: vx, y: top, width: vw, height: bottom - top })) {
            visibleSince = 0
            return
          }
          visibleSince ||= Date.now()
          if (Date.now() - visibleSince < 500) return
          setExposedHere(true)
          markExploreGuideSeen(id)
        })
        const boundary = getBottomBoundary?.()
        if (boundary) boundary.measureInWindow((_x, y) => measureCard(y))
        else measureCard(screenHeight)
      })
    }
    check()
    // スクロールの描画処理を変えず、画面内へ来た案内だけを既読にする。
    const timer = setInterval(check, 300)
    return () => { active = false; clearInterval(timer) }
  }, [visible, exposedHere, id, getViewport, getBottomBoundary, headerHeight, screenHeight, insets.bottom])
  if (!visible && !(allowed && exposedHere)) return null
  const ja = lang === 'ja'
  const [title, body] = copy[id][ja ? 'ja' : 'en']
  return (
    <View ref={ref} collapsable={false} pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'} style={[styles.card, { backgroundColor: C.card, borderColor: C.border, opacity: visible ? 1 : 0 }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: C.text }]}>{title}</Text>
      <Text style={[styles.body, { color: C.textSub }]}>{body}</Text>
      <View style={styles.actions}>
        <TouchableOpacity accessibilityRole="button" onPress={onHelp} style={styles.action}>
          <Text style={[styles.link, { color: C.accentText }]}>{ja ? '表示の意味を詳しく' : 'Learn what’s shown'}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={endExploreGuide} style={styles.action}>
          <Text style={[styles.link, { color: C.textMuted }]}>{ja ? '案内を終了' : 'End guide'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.cardRadius, padding: 14, gap: 6, marginBottom: 12 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 16 },
  action: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center' },
  link: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
})
