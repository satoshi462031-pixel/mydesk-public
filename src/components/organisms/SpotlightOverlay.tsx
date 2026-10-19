import { NavigationContainerRefContext } from '@react-navigation/native'
import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AppState, InteractionManager, StyleSheet, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Defs, Mask, Rect } from 'react-native-svg'
import { TutorialBubble } from '../molecules/TutorialBubble'
import { advanceStepIndexForRoute, canAdvanceOnArrival, SPOTLIGHT_STEPS, spotlightBodyForRoute, isStepOnRoute, recoverSpotlightStepForRoute } from '../../constants/spotlightSteps'
import { useApp } from '../../context/AppContext'
import { SpotlightRect, useSpotlight, useSpotlightRegistry } from '../../context/SpotlightContext'
import { measureCoachTarget } from '../../utils/coachMarkMeasurement'
import { coachBubbleFrame, coachBubbleMaxHeight, coachArrowLeft, coachHole, coachVisibleRect, placeCoachBubble } from '../../utils/coachMarkLayout'

const CARD_GAP = 14
const CARD_MARGIN = 24

export function SpotlightOverlay() {
  const { lang, colors, isDark } = useApp()
  const { running, stepIndex, acknowledged, acknowledge, next, goTo, finish } = useSpotlight()
  const { measureTarget, setShown } = useSpotlightRegistry()
  const { width: W, height: H } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const navigation = useContext(NavigationContainerRefContext)
  const [route, setRoute] = useState<{ name: string; key: string }>()
  const routeName = route?.name
  useEffect(() => {
    // 親スタックのstateには子タブの現在画面が入らないことがある。
    const update = () => {
      const current = navigation?.getCurrentRoute()
      setRoute((previous) => previous?.key === current?.key ? previous : current ? { name: current.name, key: current.key } : undefined)
    }
    const unsubscribe = navigation?.addListener('state', update)
    update()
    return unsubscribe
  }, [navigation])

  const step = SPOTLIGHT_STEPS[stepIndex]
  const isLast = stepIndex === SPOTLIGHT_STEPS.length - 1
  const language = lang === 'en' ? 'en' : 'ja'
  const bodyText = spotlightBodyForRoute(step, routeName ?? '')[language]
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [bubbleH, setBubbleH] = useState(180)
  const guideKey = stepIndex + ':' + route?.key
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    setDismissed(null)
    setRefresh((value) => value + 1)
  }, [route?.key])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        // 復帰時は位置だけ測り直し、OKや画面操作で閉じた案内は再表示しない。
        setRefresh((value) => value + 1)
      }
    })
    return () => subscription.remove()
  }, [])
  useEffect(() => { if (!running) setDismissed(null) }, [running])

  // 案内の対象画面から離れている間は何も出さない。出したままにすると、
  // 見つからない対象を探しに行って画面が暗転したうえ、関係のない画面に
  // 「右下の＋ボタンから」といった解説が残り続けてしまう。戻れば再開する。
  const offScreen = !routeName || !isStepOnRoute(step, routeName)
  const shown = running && !!step && !offScreen && !acknowledged.includes(step.key) && dismissed !== guideKey


  const rootRef = useRef<View>(null)
  // 対象を測れない間は暗幕・吹き出しを表示せず、操作を続けられるようにする。
  // origin: このオーバーレイ自身のウィンドウ内での位置。対象の座標から引いて穴の位置を出す
  const [probe, setProbe] = useState<{ searching: boolean; rect: SpotlightRect | null; origin: SpotlightRect }>({
    searching: false,
    rect: null,
    origin: { x: 0, y: 0, width: W, height: H },
  })
  const rect = probe.rect
  const visible = shown && (!step.targetId || !!rect) && !probe.searching
  useEffect(() => { setShown(visible) }, [visible, setShown])

  // ステップ開始時のルートを控えておき、そこから移動したときだけ次へ進める。
  // （最初から目的のルートにいる場合に即座に進んでしまうのを防ぐ）
  const routeRef = useRef(routeName)
  // いまの画面の1つ前にいた画面。到着で進めてよいかを、どこから来たかで判断するのに使う
  const fromRouteRef = useRef<string | undefined>(undefined)
  if (routeRef.current !== routeName) fromRouteRef.current = routeRef.current
  routeRef.current = routeName
  const entryRoute = useRef<string | undefined>(undefined)
  // 同じステップから二重に進まないための番人（state 反映前に再実行されても安全にする）
  const advancedFrom = useRef(-1)
  useEffect(() => {
    entryRoute.current = routeRef.current
    advancedFrom.current = -1
  }, [stepIndex, running])

  useEffect(() => {
    if (!running || step.advance.type !== 'route') return
    const goals = Array.isArray(step.advance.route) ? step.advance.route : [step.advance.route]
    if (!routeName || !goals.includes(routeName) || routeName === entryRoute.current) return
    if (!canAdvanceOnArrival(routeName, fromRouteRef.current)) return
    if (advancedFrom.current === stepIndex) return
    advancedFrom.current = stepIndex
    if (isLast) finish()
    else goTo(advanceStepIndexForRoute(stepIndex, routeName))
  }, [running, routeName, stepIndex, step, isLast, goTo, finish])

  // 保存の遅れや段の直接移動があっても、いまの作成画面に案内を合わせる。
  useEffect(() => {
    if (!running || !routeName) return
    const recovered = recoverSpotlightStepForRoute(routeName, stepIndex)
    if (recovered >= 0) goTo(recovered)
  }, [running, routeName, stepIndex, goTo])

  // このオーバーレイ自身のウィンドウ内での位置。対象の座標から引いて穴やカードの位置を出す
  const measureRoot = useCallback(async () => {
    const frame = await measureCoachTarget(rootRef.current)
    return frame ?? { x: 0, y: 0, width: W, height: H }
  }, [W, H])

  // 対象とオーバーレイ自身の位置を毎ステップ同時に測る。片方だけ古いと穴がずれ、
  // 囲いが対象からはみ出してしまうため、必ず同じタイミングの値で組にする。
  const targetId = step.targetId
  const measureStepTarget = useCallback(async () => {
    if (!targetId) return null
    const [measured, ...covered] = await Promise.all([
      measureTarget(targetId),
      ...(step.coveredBy ?? []).map((id) => measureTarget(id)),
    ])
    return coachVisibleRect(measured, {
      width: W, height: H, top: insets.top, bottom: insets.bottom, left: insets.left, right: insets.right,
    }, covered.filter((rect): rect is SpotlightRect => rect !== null))
  }, [targetId, step.coveredBy, measureTarget, W, H, insets.top, insets.bottom, insets.left, insets.right])
  useLayoutEffect(() => {
    if (!running || offScreen) {
      setProbe((p) => (p.rect === null && !p.searching ? p : { searching: false, rect: null, origin: p.origin }))
      return
    }
    // 新しい案内に前の対象の穴を一瞬重ねない。座標が揃うまでは表示を止める。
    setProbe((p) => ({ searching: true, rect: null, origin: p.origin }))
    if (!targetId) {
      let cancelled = false
      void measureRoot().then((origin) => {
        if (!cancelled) setProbe({ searching: false, rect: null, origin })
      })
      return () => { cancelled = true }
    }
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = () => {
      void Promise.all([measureStepTarget(), measureRoot()]).then(([r, o]) => {
        if (cancelled) return
        if (!r && attempts++ < 15) {
          timer = setTimeout(tick, 150)
          return
        }
        setProbe({ searching: false, rect: r, origin: o })
        // 未描画・一時的な非表示なら暗転せず待ち、対象が戻ったら再測定する。
        if (!r) timer = setTimeout(tick, 1000)
      })
    }
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(tick, 120)
    })
    return () => {
      cancelled = true
      task.cancel()
      if (timer) clearTimeout(timer)
    }
  }, [running, targetId, offScreen, stepIndex, route?.key, refresh, measureStepTarget, measureRoot])

  useEffect(() => {
    if (!visible || !targetId || !rect) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      const current = await measureStepTarget()
      if (cancelled) return
      if (!current) {
        setProbe((previous) => ({ ...previous, searching: true, rect: null }))
        setRefresh((value) => value + 1)
        return
      }
      if (Math.abs(current.x - rect.x) > 2 || Math.abs(current.y - rect.y) > 2
        || Math.abs(current.width - rect.width) > 2 || Math.abs(current.height - rect.height) > 2) {
        setDismissed(guideKey)
        return
      }
      timer = setTimeout(() => { void check() }, 250)
    }
    timer = setTimeout(() => { void check() }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [visible, targetId, rect, guideKey, measureStepTarget])

  if (!shown) return null

  const vp = {
    width: probe.origin.width, height: probe.origin.height,
    top: Math.max(0, insets.top - probe.origin.y),
    bottom: Math.max(0, insets.bottom - (H - probe.origin.y - probe.origin.height)),
    left: Math.max(0, (insets.left ?? 0) - probe.origin.x),
    right: Math.max(0, (insets.right ?? 0) - (W - probe.origin.x - probe.origin.width)),
  }
  const hole = rect ? coachHole({
    ...rect, x: rect.x - probe.origin.x, y: rect.y - probe.origin.y,
  }, step.padding?.x ?? 4, vp) : null
  const maxHeight = coachBubbleMaxHeight(hole, CARD_GAP, vp)
  const placement = placeCoachBubble(hole, Math.min(bubbleH, maxHeight), CARD_GAP, vp)
  const bubbleFrame = coachBubbleFrame(hole, vp, 360, CARD_MARGIN)
  const cardPos = !hole
    ? { top: Math.max(vp.top + CARD_GAP, (vp.height - Math.min(bubbleH, maxHeight)) / 2) }
    : placement.kind === 'below' ? { top: placement.top } : { bottom: placement.bottom }
  const arrow = hole && placement.kind !== 'overlay'
    ? {
        side: placement.kind === 'below' ? 'top' as const : 'bottom' as const,
        left: coachArrowLeft(hole, bubbleFrame.left, bubbleFrame.width, 14),
      }
    : undefined
  const confirm = () => {
    // OKは説明の既読。画面を進める実操作まで完了扱いにしない。
    acknowledge()
    if (step.advance.type === 'button') {
      if (isLast) finish()
      else next()
    }
  }

  return (
    <View ref={rootRef} style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 100 }]}
      pointerEvents="box-none">
      {visible && <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={vp.width} height={vp.height} pointerEvents="none">
          <Defs>
            <Mask id="spotlight-hole">
              <Rect x={0} y={0} width={vp.width} height={vp.height} fill="#fff" />
              {hole && <Rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={step.radius ?? 12} fill="#000" />}
            </Mask>
          </Defs>
          <Rect x={0} y={0} width={vp.width} height={vp.height} fill="#000" fillOpacity={isDark ? 0.5 : 0.74} mask="url(#spotlight-hole)" />
          {hole && <Rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={step.radius ?? 12}
            fill="none" stroke={colors.accentIcon} strokeWidth={2} />}
        </Svg>
      </View>}
      {visible && <View style={[styles.cardWrap, bubbleFrame, cardPos]} pointerEvents="box-none">
        <TutorialBubble title={step.title[language]} body={bodyText} onConfirm={confirm}
          onDismiss={() => setDismissed(guideKey)}
          progress={(stepIndex + 1) + ' / ' + SPOTLIGHT_STEPS.length}
          onSkip={isLast ? undefined : () => finish({ outcome: 'skipped' })}
          skipLabel={language === 'ja' ? 'ガイドを終了' : 'End guide'}
          arrow={arrow} maxHeight={maxHeight}
          onLayout={(e) => {
            const height = Math.ceil(e.nativeEvent.layout.height)
            if (Math.abs(height - bubbleH) > 1) setBubbleH(height)
          }}
        />
      </View>}
    </View>
  )
}

const styles = StyleSheet.create({
  cardWrap: { position: 'absolute' },
})
