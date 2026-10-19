import { Fragment, useMemo, useState } from 'react'
import { Image, Modal, PanResponder, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import type { PanResponderGestureState } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path, Rect } from 'react-native-svg'
import { useApp } from '../../context/AppContext'
import type { CoachStep } from '../../hooks/useCoachMarks'
import type { CoachRect } from '../../utils/coachMarkLayout'
import { layoutGuideAnnotations } from '../../utils/guideAnnotationLayout'
import { UI_METRICS } from '../../constants/ui'
import { Button } from '../atoms/Button'
import { IconCircleButton } from '../atoms/IconCircleButton'
import { ICONS } from '../../constants/icons'
import { coachGuideText, guideLabelHeight } from '../../utils/coachGuideText'

/** 案内を開いた瞬間の画面の写し。uri が無いときは枠だけで描く */
export interface ScreenGuideShot { uri: string | null; width: number; height: number }

const GAP = 12

export function ScreenAnnotationGuide({ steps, shot, onClose }: { steps: (CoachStep & { rect: CoachRect | null })[]; shot: ScreenGuideShot; onClose: () => void }) {
  const { colors: C, lang } = useApp()
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [page, setPage] = useState(0)
  const ja = lang === 'ja'
  const headerBottom = insets.top + 8 + UI_METRICS.touchMinSize
  const footerTop = height - insets.bottom - 12 - UI_METRICS.touchMinSize - 16
  const sideInset = UI_METRICS.touchMinSize + GAP / 2
  const area = {
    x: insets.left + sideInset,
    y: headerBottom + GAP,
    width: width - insets.left - insets.right - sideInset * 2,
    height: Math.max(120, footerTop - GAP - headerBottom - GAP),
  }
  const frame = layoutGuideAnnotations(area, shot, steps.map(step => step.rect),
    (index, labelWidth) => guideLabelHeight({ title: steps[index].title?.[lang], text: steps[index][lang] }, labelWidth))
  const total = Math.max(1, frame.pages.length)
  const currentPage = Math.min(page, total - 1)
  const hasPrevious = currentPage > 0
  const hasNext = currentPage + 1 < total
  const current = useMemo(() => frame.pages[currentPage] ?? [], [frame.pages, currentPage])
  const movePage = (direction: number) => setPage(previous => Math.max(0, Math.min(Math.min(previous, total - 1) + direction, total - 1)))
  const numberOf = (index: number) => index + 1
  const spotlight = current.flatMap(item => item.target ? [item.target] : [])
  const box = frame.shots[currentPage] ?? frame.shot
  const gestures = useMemo(() => {
    let startDx = 0
    let startDy = 0
    let origin: { x: number; y: number } | null = null
    let action: 'page' | 'dismiss' | null = null
    const contains = (rect: CoachRect, x: number, y: number) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
    const arrowTop = area.y + (area.height - UI_METRICS.touchMinSize) / 2
    const blocked = [box, ...current.map(item => item.label),
      { x: width - insets.right - UI_METRICS.screenGutter - UI_METRICS.touchMinSize, y: insets.top + 8, width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize },
      ...(hasPrevious ? [{ x: insets.left, y: arrowTop, width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize }] : []),
      ...(hasNext ? [{ x: width - insets.right - UI_METRICS.touchMinSize, y: arrowTop, width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize }] : []),
    ]
    // 同じ親で方向を判定し、見出しや下部ボタン上からの横スワイプも拾う。
    const shouldCapture = (gesture: PanResponderGestureState) => {
      const start = origin
      if (!start || gesture.numberActiveTouches !== 1) return false
      if (total > 1 && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5) {
        action = 'page'
      } else if (start.y >= insets.top && start.y < footerTop
        && !blocked.some(rect => contains(rect, start.x, start.y))
        && gesture.dy > 12 && gesture.dy > Math.abs(gesture.dx) * 1.5) {
        action = 'dismiss'
      } else return false
      startDx = gesture.dx
      startDy = gesture.dy
      return true
    }
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: event => {
        const touches = event.nativeEvent.touches
        origin = touches.length === 1 ? { x: touches[0].pageX, y: touches[0].pageY } : null
        startDx = 0
        startDy = 0
        action = null
        return false
      },
      onMoveShouldSetPanResponder: (_, gesture) => shouldCapture(gesture),
      onMoveShouldSetPanResponderCapture: (_, gesture) => shouldCapture(gesture),
      onPanResponderStart: (_, gesture) => { if (gesture.numberActiveTouches > 1) origin = null },
      onPanResponderRelease: (_, gesture) => {
        // Responder 取得時にリセットされるため、取得前の移動量を足す。
        const dx = startDx + gesture.dx
        const dy = startDy + gesture.dy
        startDx = 0
        startDy = 0
        const completedAction = origin !== null ? action : null
        origin = null
        action = null
        if (gesture.numberActiveTouches > 1) return
        if (completedAction === 'page') {
          if (Math.abs(dx) <= Math.abs(dy) * 1.5) return
          if (Math.abs(dx) < 40 && !(Math.abs(dx) > 16 && Math.abs(gesture.vx) > 0.4)) return
          setPage(previous => Math.max(0, Math.min(Math.min(previous, total - 1) + (dx < 0 ? 1 : -1), total - 1)))
        } else if (completedAction === 'dismiss' && dy > Math.abs(dx) * 1.5
          && (dy >= 64 || (dy >= 24 && gesture.vy > 0.6))) onClose()
      },
      onPanResponderTerminate: () => { startDx = 0; startDy = 0; origin = null; action = null },
    })
  }, [total, onClose, current, box, width, insets.top, insets.left, insets.right, footerTop, area.y, area.height, hasPrevious, hasNext])

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View accessibilityViewIsModal style={[styles.root, { backgroundColor: C.bgList }]} {...gestures.panHandlers}>
        <View style={StyleSheet.absoluteFill}>

          <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={[styles.shot, { left: box.x, top: box.y, width: box.width, height: box.height, backgroundColor: C.card, borderColor: C.border }]}>
            {shot.uri && <Image source={{ uri: shot.uri }} style={StyleSheet.absoluteFill} resizeMode="stretch" />}
          </View>

          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Svg width={width} height={height}>
              {/* 写しのうち、このページで説明しない所を沈めて、指している部品を浮かせる */}
              <Path fillRule="evenodd" fill={C.bgList} fillOpacity={0.72}
                d={[box, ...spotlight].map((r) => `M ${r.x} ${r.y} h ${r.width} v ${r.height} h ${-r.width} Z`).join(' ')} />
              {current.map(({ index, target, badge, points }) => {
                if (!target || !badge) return null
                const path = points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
                return <Fragment key={index}>
                  {/* 枠は対象の縁に引く。外へ広げると、隣り合う対象を同じページで強調したときに枠がつながる */}
                  <Rect x={target.x} y={target.y} width={target.width} height={target.height}
                    rx={Math.max(2, (steps[index].radius ?? 8) * box.width / shot.width)} fill={C.accentIcon} fillOpacity={0.08} stroke={C.accentIcon} strokeWidth={2.5} />
                  <Path d={path} stroke={C.bgList} strokeWidth={4} fill="none" strokeLinejoin="round" />
                  <Path d={path} stroke={C.accentIcon} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
                </Fragment>
              })}
            </Svg>
          </View>

          {current.map(({ index, label }) => {
            const step = steps[index]
            return <View key={index}
              style={[styles.label, { left: label.x, top: label.y, width: label.width, height: label.height, backgroundColor: C.card, borderColor: C.border }]}>
              <View style={[styles.labelHeading, label.width < 160 && styles.narrowHeading]}>
                <View style={[styles.number, { backgroundColor: C.chip, borderColor: C.accentIcon }]}><Text style={[styles.numberText, { color: C.text }]}>{numberOf(index)}</Text></View>
                {step.title && <Text style={[styles.labelTitle, label.width < 160 && styles.narrowTitle, { color: C.text }]}>{step.title[lang]}</Text>}
              </View>
              {/* 縦にスクロールさせない。札は文章の高さで組んであり、指の上下はページ送りや閉じる操作に使う */}
              <Text style={[styles.body, { color: C.text }]}>
                {coachGuideText(step[lang], step.emphasis?.[lang]).map((part, i) => <Text key={i} style={part.emphasized ? styles.emphasis : undefined}>{part.text}</Text>)}
              </Text>
            </View>
          })}

          {!steps.length && <View pointerEvents="none" style={[styles.empty, { left: area.x, top: area.y, width: area.width, backgroundColor: C.card }]}>
            <Text style={[styles.body, { color: C.text }]}>{ja ? 'いま表示中の範囲に案内できる項目がありません。画面をスクロールして、もう一度「？」を押してください。' : 'No guide items are visible here. Scroll the screen, then open ? again.'}</Text>
          </View>}
        </View>

        {/* 描画領域より手前でタップを受け取り、閉じる操作を遮らせない。 */}
        <View style={[styles.header, { top: insets.top + 8, left: insets.left + UI_METRICS.screenGutter, right: insets.right + UI_METRICS.screenGutter }]}>
          <View style={styles.headerText}>
            {/* いま何ページ目かは上に置く。見出しと一緒に目に入り、下の操作の列を探さずに済む */}
            <View style={styles.titleRow}>
              <Text accessibilityRole="header" style={[styles.title, { color: C.text }]}>{ja ? 'この画面の見方' : 'Screen guide'}</Text>
              <Text accessibilityLiveRegion="polite" style={[styles.pageCount, { color: C.textSub }]}>{currentPage + 1} / {total}</Text>
            </View>
            <Text style={[styles.swipeHint, { color: C.textSub, textAlign: 'left' }]}>{ja ? '見出し・余白を下スワイプで閉じる' : 'Swipe header or margins down to close'}</Text>
          </View>
          <IconCircleButton name={ICONS.close} diameter={UI_METRICS.touchMinSize} background={C.chip} color={C.text} onPress={onClose} accessibilityLabel={ja ? 'ガイドを閉じる' : 'Close guide'} />
        </View>

        {/* 行き先の無い側の矢印は薄く残さず消す。押せない円が残ると、まだ先があるように見える */}
        {total > 1 && <View pointerEvents="box-none" style={[styles.arrows, { top: area.y + (area.height - UI_METRICS.touchMinSize) / 2, left: insets.left, right: insets.right }]}>
          {hasPrevious
            ? <IconCircleButton name={ICONS.chevronLeft} diameter={UI_METRICS.touchMinSize} background={C.chip} color={C.text}
              onPress={() => movePage(-1)} accessibilityLabel={ja ? '前のページ' : 'Previous page'} />
            : <View pointerEvents="none" style={styles.arrowSlot} />}
          {hasNext
            ? <IconCircleButton name={ICONS.chevronRight} diameter={UI_METRICS.touchMinSize} background={C.chip} color={C.text}
              onPress={() => movePage(1)} accessibilityLabel={ja ? '次のページ' : 'Next page'} />
            : <View pointerEvents="none" style={styles.arrowSlot} />}
        </View>}

        <View style={[styles.footer, { bottom: insets.bottom + 12, left: insets.left + UI_METRICS.screenGutter, right: insets.right + UI_METRICS.screenGutter }]}>
          <Button title={ja ? '前へ' : 'Back'} size="compact" variant="neutral" disabled={currentPage === 0} onPress={() => movePage(-1)} />
          <View style={styles.pageStatus}>
            {total > 1 && <Text style={[styles.swipeHint, { color: C.textSub }]}>{ja ? '左右にスワイプ' : 'Swipe left / right'}</Text>}
          </View>
          <Button title={currentPage + 1 >= total ? (ja ? '閉じる' : 'Close') : (ja ? '次へ' : 'Next')} size="compact" onPress={() => currentPage + 1 >= total ? onClose() : movePage(1)} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { position: 'absolute', zIndex: 2, flexDirection: 'row', alignItems: 'center' },
  headerText: { flex: 1, gap: 3 },
  arrows: { position: 'absolute', zIndex: 2, flexDirection: 'row', justifyContent: 'space-between' },
  arrowSlot: { width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { fontSize: 17, fontWeight: '700', userSelect: 'none' },
  pageCount: { fontSize: 15, fontVariant: ['tabular-nums'], userSelect: 'none' },
  shot: { position: 'absolute', borderRadius: UI_METRICS.panelRadius, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  label: { position: 'absolute', borderRadius: UI_METRICS.panelRadius, borderWidth: StyleSheet.hairlineWidth, padding: 10, gap: 6 },
  labelHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  narrowHeading: { flexWrap: 'wrap' },
  narrowTitle: { flexBasis: '100%' },
  number: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  numberText: { fontSize: 11, fontWeight: '700', userSelect: 'none' },
  labelTitle: { flex: 1, fontSize: 13, fontWeight: '700', userSelect: 'none' },
  body: { fontSize: 13, lineHeight: 19, userSelect: 'none' },
  emphasis: { fontWeight: '700' },
  footer: { position: 'absolute', zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pageStatus: { alignItems: 'center', flexShrink: 1, gap: 3 },
  swipeHint: { fontSize: 11, textAlign: 'center', userSelect: 'none' },
  empty: { position: 'absolute', borderRadius: UI_METRICS.panelRadius, padding: 16 },
})
