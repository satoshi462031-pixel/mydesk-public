import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AppColors } from '../../context/AppContext'
import type { DeskPlan, PlanPurpose } from '../../types'
import { purposeIcon, purposeIconColor, purposeLabel } from '../../screens/PurposeSelectionScreen'
import { AppIcon } from '../atoms/AppIcon'
import { coachBubbleFrame } from '../../utils/coachMarkLayout'

// デスク名の右に並べてよい数。44 の枠を4つ以上並べると名前の幅が潰れるので、
// 超えたら画面側で名前の下の段へ回す（DeskPurposeIcons 自体も幅に合わせて折り返す）
export const PURPOSE_ICONS_INLINE_MAX = 3

interface Props {
  plan: Pick<DeskPlan, 'purposes' | 'otherPurposeLabel' | 'otherPurposeIcon' | 'otherPurposeColor'>
  colors: AppColors
  lang: 'ja' | 'en'
  isDark: boolean
}

export function DeskPurposeIcons({ plan, colors: C, lang, isDark }: Props) {
  const { width: windowWidth } = useWindowDimensions()
  const { left: insetLeft, right: insetRight } = useSafeAreaInsets()
  const anchors = useRef<Partial<Record<PlanPurpose, View | null>>>({})
  const [visiblePurpose, setVisiblePurpose] = useState<{ purpose: PlanPurpose; x: number } | null>(null)
  const [tipWidth, setTipWidth] = useState(0)
  const tipReady = tipWidth > 0
  useEffect(() => setVisiblePurpose(null), [windowWidth, insetLeft, insetRight])
  useEffect(() => {
    if (!visiblePurpose || !tipReady) return
    const timer = setTimeout(() => setVisiblePurpose(null), 3000)
    return () => clearTimeout(timer)
  }, [visiblePurpose, tipReady])

  return (
    <View style={styles.row}>
      {(plan.purposes ?? []).map((purpose) => {
        const color = purposeIconColor(purpose, isDark, plan.otherPurposeColor)
        const label = purposeLabel(purpose, lang, plan.otherPurposeLabel)
        const expanded = visiblePurpose?.purpose === purpose
        const viewport = { width: windowWidth, left: insetLeft, right: insetRight }
        const hostFrame = coachBubbleFrame(null, viewport, windowWidth, 8)
        const tipLeft = expanded
          ? coachBubbleFrame({ x: visiblePurpose.x + 4, y: 0, w: 40, h: 40 }, viewport, tipWidth, 8).left - visiblePurpose.x
          : 0
        return (
          <View key={purpose} ref={(view) => { anchors.current[purpose] = view }} collapsable={false} style={[styles.wrap, expanded && styles.active]}>
            <TouchableOpacity
              style={styles.button}
              onPress={(event) => {
                event.stopPropagation()
                if (expanded) {
                  setVisiblePurpose(null)
                } else {
                  anchors.current[purpose]?.measureInWindow((x) => {
                    setTipWidth(0)
                    setVisiblePurpose({ purpose, x })
                  })
                }
              }}
              activeOpacity={0.7}
              hitSlop={2}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityHint={lang === 'en' ? 'Shows the purpose name' : '用途名を表示します'}
              accessibilityState={{ expanded }}
            >
              <View style={[styles.icon, { backgroundColor: color + '20', borderColor: color + '40' }]}>
                <AppIcon name={purposeIcon(purpose, plan.otherPurposeIcon)} size={24} color={color} centered />
              </View>
            </TouchableOpacity>
            {expanded && (
              <View style={[styles.tipHost, { left: hostFrame.left - visiblePurpose.x, width: hostFrame.width }]} pointerEvents="none">
                <View
                  style={[styles.tip, { backgroundColor: C.text, opacity: tipWidth > 0 ? 1 : 0, transform: [{ translateX: tipLeft - hostFrame.left + visiblePurpose.x }] }]}
                  onLayout={(event) => setTipWidth(event.nativeEvent.layout.width)}
                >
                  <View style={[styles.arrow, { borderBottomColor: C.text, left: 24 - tipLeft - 5 }]} />
                  <Text style={[styles.tipText, { color: C.card }]} numberOfLines={1} accessibilityLiveRegion="polite">
                    {label}
                  </Text>
                </View>
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flexShrink: 1, overflow: 'visible' },
  wrap: { position: 'relative', flexDirection: 'row', overflow: 'visible' },
  active: { zIndex: 4 },
  button: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  icon: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // アイコン幅に制限されず用途名を測り、画面端でだけ中央位置を補正する。
  tipHost: { position: 'absolute', top: 50, flexDirection: 'row', zIndex: 5 },
  tip: { flexShrink: 1, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 6 },
  arrow: { position: 'absolute', top: -5, width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 5, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  tipText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
})
