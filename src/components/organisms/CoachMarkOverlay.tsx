import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, Mask, Rect } from 'react-native-svg'
import { useApp } from '../../context/AppContext'
import { UI_METRICS } from '../../constants/ui'
import { TutorialBubble } from '../molecules/TutorialBubble'
import { measureCoachTarget } from '../../utils/coachMarkMeasurement'
import { coachBubbleFrame, coachBubbleMaxHeight, coachArrowLeft, coachHole, CoachRect, CoachViewport, coachVisibleRect, placeCoachBubble } from '../../utils/coachMarkLayout'

export interface ResolvedCoachStep {
  key: string
  rect: CoachRect | null
  title?: { ja: string; en: string }
  ja: string
  en: string
  pad: number
  radius?: number
  measureRect?: () => Promise<CoachRect | null>
}

const MARGIN = 24
const GAP = 12

export function CoachMarkOverlay({ steps, onClose }: { steps: ResolvedCoachStep[] | null; onClose: () => void }) {
  const { lang, colors, isDark } = useApp()
  const ja = lang === 'ja'
  const { width: W, height: H } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const rootRef = useRef<View>(null)
  const [frame, setFrame] = useState({ x: 0, y: 0, width: W, height: H })
  const [index, setIndex] = useState(0)
  const indexRef = useRef(index)
  const closedRef = useRef(false)
  const [bubbleH, setBubbleH] = useState(150)
  useLayoutEffect(() => {
    indexRef.current = 0
    closedRef.current = false
    if (steps) setIndex(0)
  }, [steps])

  const step = steps?.[index]
  const total = steps?.length ?? 0
  const isLast = index >= total - 1
  const next = () => {
    if (!steps || closedRef.current) return
    if (indexRef.current >= total - 1) {
      closedRef.current = true
      onClose()
    } else {
      indexRef.current += 1
      setIndex(indexRef.current)
    }
  }
  const measureRoot = useCallback(() => {
    void measureCoachTarget(rootRef.current).then((rect) => {
      if (!rect) return
      const { x, y, width, height } = rect
      setFrame((previous) => previous.x === x && previous.y === y && previous.width === width && previous.height === height
        ? previous : { x, y, width, height })
    })
  }, [])

  useEffect(() => {
    if (!step) return
    measureRoot()
    // 背後のスクロール・編集で対象が動いたら、古い位置を指し続けず案内を閉じる。
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      const rect = await step.measureRect?.()
      if (cancelled) return
      if (step.measureRect && (!rect || !step.rect
        || Math.abs(rect.x - step.rect.x) > 2 || Math.abs(rect.y - step.rect.y) > 2
        || Math.abs(rect.width - step.rect.width) > 2 || Math.abs(rect.height - step.rect.height) > 2)) {
        onClose()
        return
      }
      timer = setTimeout(() => { void check() }, 250)
    }
    if (step.measureRect) void check()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [step, W, H, measureRoot, onClose])

  if (!step) return null
  const vp: CoachViewport = {
    width: frame.width, height: frame.height,
    top: Math.max(0, insets.top - frame.y),
    bottom: Math.max(0, insets.bottom - (H - frame.y - frame.height)),
    left: Math.max(0, (insets.left ?? 0) - frame.x),
    right: Math.max(0, (insets.right ?? 0) - (W - frame.x - frame.width)),
  }
  const localRect = step.rect ? { ...step.rect, x: step.rect.x - frame.x, y: step.rect.y - frame.y } : null
  const visibleRect = coachVisibleRect(localRect, vp)
  const hole = visibleRect ? coachHole(visibleRect, step.pad, vp) : null
  const half = hole ? Math.min(hole.w, hole.h) / 2 : 0
  const radius = step.radius ?? (half > 28 ? UI_METRICS.cardRadius : half)
  const maxHeight = coachBubbleMaxHeight(hole, GAP, vp)
  const placement = placeCoachBubble(hole, Math.min(bubbleH, maxHeight), GAP, vp)
  const bubbleFrame = coachBubbleFrame(hole, vp, 360, MARGIN)

  return (
    <View ref={rootRef} style={styles.root} pointerEvents="box-none" onLayout={measureRoot}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={frame.width} height={frame.height} pointerEvents="none">
          <Defs>
            <Mask id="coach-hole">
              <Rect x={0} y={0} width={frame.width} height={frame.height} fill="#fff" />
              {hole && <Rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={radius} ry={radius} fill="#000" />}
            </Mask>
          </Defs>
          <Rect x={0} y={0} width={frame.width} height={frame.height} fill="#000" fillOpacity={isDark ? 0.5 : 0.74} mask="url(#coach-hole)" />
          {hole && <Rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={radius} ry={radius}
            fill="none" stroke={colors.accentIcon} strokeWidth={2} />}
        </Svg>
      </View>
      <View pointerEvents="box-none" style={[
        styles.bubbleWrap,
        bubbleFrame,
        placement.kind === 'below' ? { top: placement.top } : { bottom: placement.bottom },
      ]}>
        <TutorialBubble
          title={step.title ? (ja ? step.title.ja : step.title.en) : undefined}
          body={ja ? step.ja : step.en}
          onConfirm={next}
          onDismiss={onClose}
          progress={total > 1 ? (index + 1) + ' / ' + total : undefined}
          onSkip={isLast ? undefined : onClose}
          skipLabel={ja ? 'ガイドを終了' : 'End guide'}
          arrow={hole && placement.kind !== 'overlay' ? {
            side: placement.kind === 'below' ? 'top' : 'bottom',
            left: coachArrowLeft(hole, bubbleFrame.left, bubbleFrame.width, 14),
          } : undefined}
          maxHeight={maxHeight}
          onLayout={(e) => {
            const height = Math.ceil(e.nativeEvent.layout.height)
            if (Math.abs(height - bubbleH) > 1) setBubbleH(height)
          }}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 100 },
  bubbleWrap: { position: 'absolute' },
})
