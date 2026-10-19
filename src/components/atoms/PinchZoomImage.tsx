import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Reanimated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import { AppIcon } from './AppIcon'
import { useApp } from '../../context/AppContext'

// 操作の意味は iOS の写真アプリに合わせる。
//  ・1本指タップでは閉じない（あちらではツールバーの表示切替に割り当てられている操作で、
//    拡大して細部を見ているときに一番押しがちな場所。閉じるのは右上の×か下スワイプ）
//  ・ピンチとパンは地続き。指を離さずに広げてそのまま動かせる
//  ・下スワイプは指に追従する。引いた量を dismissY へ書き出すだけで、写真をどう動かすかは
//    それを受け取る側（DeskPhotoPreviewModal）が決める。ここで動かすと viewport の
//    overflow: hidden に切られて、下へ逃げた写真の裾が消える
// ラバーバンド・慣性までは真似ていない（別物として割り切る）。
const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2.5
// 閉じると決まる引き量。ここに届かなければ指を離した時点で戻る
const DISMISS_DISTANCE = 80
const DISMISS_VELOCITY = 900

interface PinchZoomImageProps {
  uri: string
  width: number
  height: number
  active: boolean
  onZoomChange?: (zoomed: boolean) => void
  onPress?: () => void
  /** 下スワイプで引いた量（px）。閉じる操作の途中経過を親へ渡すためだけに使う */
  dismissY?: SharedValue<number>
  accessibilityLabel?: string
  accessibilityHint?: string
  lang?: 'ja' | 'en'
}

export function PinchZoomImage({
  uri,
  width,
  height,
  active,
  onZoomChange,
  onPress,
  dismissY,
  accessibilityLabel,
  accessibilityHint,
  lang = 'ja',
}: PinchZoomImageProps) {
  const { reduceMotion } = useApp()
  const [naturalSize, setNaturalSize] = useState({ width, height })
  const [request, setRequest] = useState({ uri, attempt: 0, status: 'loading' as 'loading' | 'loaded' | 'failed' })
  if (request.uri !== uri) setRequest({ uri, attempt: request.attempt + 1, status: 'loading' })
  const settleRequest = (status: 'loaded' | 'failed') => {
    // 写真を切り替えたり再読み込みした後に、古い読み込み結果を反映しない。
    setRequest(current => current.uri === uri && current.attempt === request.attempt
      ? { ...current, status }
      : current)
  }
  const scale = useSharedValue(1)
  const translateX = useSharedValue(0)
  const translateY = useSharedValue(0)
  const savedScale = useSharedValue(1)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)
  const startScale = useSharedValue(1)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)
  const startFocalX = useSharedValue(0)
  const startFocalY = useSharedValue(0)
  // 起点を取った時点の event.scale。iOS のピンチは指が1本になっても終わらず焦点が残った指へ
  // 飛ぶので、1本の間は動かさず、2本に戻った時点を新しい起点にする
  const startEventScale = useSharedValue(1)
  const pinchNeedsRebase = useSharedValue(false)
  const viewportWidth = useSharedValue(width)
  const viewportHeight = useSharedValue(height)
  const fittedWidth = useSharedValue(width)
  const fittedHeight = useSharedValue(height)
  // 指が全部離れるまでの一続きの操作で、2本以上が同時に触れたか。
  // RNGH のタップは「指が触れた回数」で数え、移動距離の上限も既定で無いので、2本の指が
  // ずれて着地する素早いピンチがダブルタップとして成立する。ピンチで等倍へ戻した直後に
  // それが走り、縮めて指を離したのに 2.5 倍へ拡大していた
  const multiTouchInSequence = useSharedValue(false)
  const dismissRequested = useSharedValue(false)

  useEffect(() => {
    let mounted = true
    Image.getSize(
      uri,
      (imageWidth, imageHeight) => {
        if (mounted) setNaturalSize({ width: imageWidth, height: imageHeight })
      },
      () => {},
    )
    return () => { mounted = false }
  }, [uri, request.attempt])

  const fittedSize = useMemo(() => {
    const ratio = Math.min(width / naturalSize.width, height / naturalSize.height)
    return {
      width: Math.max(1, naturalSize.width * ratio),
      height: Math.max(1, naturalSize.height * ratio),
    }
  }, [height, naturalSize.height, naturalSize.width, width])

  useEffect(() => {
    viewportWidth.value = width
    viewportHeight.value = height
    fittedWidth.value = fittedSize.width
    fittedHeight.value = fittedSize.height
  }, [fittedHeight, fittedSize.height, fittedSize.width, fittedWidth, height, viewportHeight, viewportWidth, width])

  const reportZoom = useCallback((zoomed: boolean) => {
    onZoomChange?.(zoomed)
  }, [onZoomChange])

  useEffect(() => {
    if (active) return
    scale.value = 1
    translateX.value = 0
    translateY.value = 0
    savedScale.value = 1
    savedX.value = 0
    savedY.value = 0
    reportZoom(false)
  }, [active, reportZoom, savedScale, savedX, savedY, scale, translateX, translateY])

  const pinch = useMemo(() => Gesture.Pinch()
    .enabled(active)
    .onStart(() => {
      'worklet'
      multiTouchInSequence.value = true
      pinchNeedsRebase.value = true
      runOnJS(reportZoom)(true)
    })
    .onUpdate((event) => {
      'worklet'
      if (event.numberOfPointers < 2 || !(event.scale > 0)) { pinchNeedsRebase.value = true; return }
      if (pinchNeedsRebase.value) {
        pinchNeedsRebase.value = false
        startScale.value = savedScale.value
        startX.value = savedX.value
        startY.value = savedY.value
        startFocalX.value = event.focalX
        startFocalY.value = event.focalY
        startEventScale.value = event.scale
      }
      const nextScale = Math.min(MAX_SCALE, Math.max(1, startScale.value * event.scale / startEventScale.value))
      const scaleChange = nextScale / startScale.value
      const centerX = viewportWidth.value / 2
      const centerY = viewportHeight.value / 2
      const nextX = event.focalX - centerX - scaleChange * (startFocalX.value - centerX - startX.value)
      const nextY = event.focalY - centerY - scaleChange * (startFocalY.value - centerY - startY.value)
      const maxX = Math.max(0, (fittedWidth.value * nextScale - viewportWidth.value) / 2)
      const maxY = Math.max(0, (fittedHeight.value * nextScale - viewportHeight.value) / 2)

      scale.value = nextScale
      translateX.value = Math.min(maxX, Math.max(-maxX, nextX))
      translateY.value = Math.min(maxY, Math.max(-maxY, nextY))
      savedScale.value = nextScale
      savedX.value = translateX.value
      savedY.value = translateY.value
    })
    .onFinalize(() => {
      'worklet'
      if (savedScale.value <= 1.01) {
        scale.value = withTiming(1, { duration: reduceMotion ? 0 : 300 })
        translateX.value = withTiming(0, { duration: reduceMotion ? 0 : 300 })
        translateY.value = withTiming(0, { duration: reduceMotion ? 0 : 300 })
        savedScale.value = 1
        savedX.value = 0
        savedY.value = 0
        runOnJS(reportZoom)(false)
      } else {
        runOnJS(reportZoom)(true)
      }
    }), [active, fittedHeight, fittedWidth, multiTouchInSequence, pinchNeedsRebase, reduceMotion, reportZoom, savedScale, savedX, savedY, scale, startEventScale, startFocalX, startFocalY, startScale, startX, startY, translateX, translateY, viewportHeight, viewportWidth])

  const pan =useMemo(() => Gesture.Pan()
    .enabled(active)
    .manualActivation(true)
    // 1本だけ触れている＝新しい操作の始まりなので印を戻す。本物のダブルタップは2回とも1本なので立たない
    .onTouchesDown((event) => {
      'worklet'
      multiTouchInSequence.value = event.numberOfTouches >= 2
    })
    // **fail() は呼ばない。** RNGH の FAILED は指が全部離れるまで復帰しないので、
    // 等倍で始まるピンチの1フレーム目に fail すると、広げたあと指を離さずに動かしても
    // もう活性化できない。条件が揃うまで未確定のまま待たせて、揃った瞬間に activate する。
    .onTouchesMove((event, manager) => {
      'worklet'
      // 2本指の間はピンチ側が焦点に合わせて位置も動かしているので、こちらは手を出さない
      if (event.numberOfTouches === 1 && scale.value > 1.01) manager.activate()
    })
    // translationX は「最初に指が触れた点」からの量で、途中で活性化するとその蓄積が
    // いきなり乗って画像が飛ぶ。差分（changeX）を持つ onChange を使って足していく
    .onChange((event) => {
      'worklet'
      const maxX = Math.max(0, (fittedWidth.value * scale.value - viewportWidth.value) / 2)
      const maxY = Math.max(0, (fittedHeight.value * scale.value - viewportHeight.value) / 2)
      translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value + event.changeX))
      translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value + event.changeY))
      // 指を離す前にピンチへ移れるようになったので、savedX/Y は onEnd を待たずに
      // 毎フレーム合わせる。ここが遅れると pinch.onStart が動かす前の位置を
      // 起点に読んで、2本目を置いた瞬間にドラッグぶん飛ぶ
      savedX.value = translateX.value
      savedY.value = translateY.value
    })
    .onEnd(() => {
      'worklet'
      savedX.value = translateX.value
      savedY.value = translateY.value
    }), [active, fittedHeight, fittedWidth, multiTouchInSequence, savedX, savedY, scale, translateX, translateY, viewportHeight, viewportWidth])

  const doubleTap = useMemo(() => Gesture.Tap()
    .enabled(active)
    .numberOfTaps(2)
    .maxDuration(250)
    .onEnd((event, success) => {
      'worklet'
      if (!success || multiTouchInSequence.value) return

      if (savedScale.value > 1.01) {
        scale.value = withTiming(1, { duration: reduceMotion ? 0 : 300 })
        translateX.value = withTiming(0, { duration: reduceMotion ? 0 : 300 })
        translateY.value = withTiming(0, { duration: reduceMotion ? 0 : 300 })
        savedScale.value = 1
        savedX.value = 0
        savedY.value = 0
        runOnJS(reportZoom)(false)
        return
      }

      const nextScale = DOUBLE_TAP_SCALE
      const centerX = viewportWidth.value / 2
      const centerY = viewportHeight.value / 2
      const nextX = event.x - centerX - nextScale * (event.x - centerX)
      const nextY = event.y - centerY - nextScale * (event.y - centerY)
      const maxX = Math.max(0, (fittedWidth.value * nextScale - viewportWidth.value) / 2)
      const maxY = Math.max(0, (fittedHeight.value * nextScale - viewportHeight.value) / 2)
      const clampedX = Math.min(maxX, Math.max(-maxX, nextX))
      const clampedY = Math.min(maxY, Math.max(-maxY, nextY))

      scale.value = withTiming(nextScale, { duration: reduceMotion ? 0 : 300 })
      translateX.value = withTiming(clampedX, { duration: reduceMotion ? 0 : 300 })
      translateY.value = withTiming(clampedY, { duration: reduceMotion ? 0 : 300 })
      savedScale.value = nextScale
      savedX.value = clampedX
      savedY.value = clampedY
      runOnJS(reportZoom)(true)
    }), [active, fittedHeight, fittedWidth, multiTouchInSequence, reduceMotion, reportZoom, savedScale, savedX, savedY, scale, translateX, translateY, viewportHeight, viewportWidth])

  const swipeDown = useMemo(() => Gesture.Pan()
    .enabled(active && onPress != null)
    .maxPointers(1)
    .onBegin(() => {
      'worklet'
      dismissRequested.value = false
      if (dismissY) cancelAnimation(dismissY)
    })
    // 縦と横で同じ距離にして、先に大きく動いた向きを優先させる。横を 24 にしていた頃は、
    // めくろうとして少し下へずれただけで縦 12 に先に届いてこちらが指を取り、
    // 写真がめくれず閉じもしない（閉じるのは縦 80 から）操作になっていた
    .activeOffsetY(12)
    .failOffsetX([-12, 12])
    // 指に付いてこないと、引いても閉じないのか引き足りないのかが分からない。
    // 活性化した時点の蓄積が乗らないよう、パンと同じく差分で足す
    .onChange((event) => {
      'worklet'
      if (!dismissY || savedScale.value > 1.01) return
      dismissY.value = Math.max(0, dismissY.value + event.changeY)
    })
    .onEnd((event, success) => {
      'worklet'
      if (
        onPress
        && success
        && !multiTouchInSequence.value
        && savedScale.value <= 1.01
        && (event.translationY >= DISMISS_DISTANCE || event.velocityY >= DISMISS_VELOCITY)
      ) {
        // 引いた位置のままモーダルのフェードへ渡す。戻してから閉じると一瞬跳ね上がる
        dismissRequested.value = true
        runOnJS(onPress)()
      }
    })
    .onFinalize(() => {
      'worklet'
      // キャンセルでは onEnd が来ない場合もある。閉じる操作が成立したときだけ位置を保持する。
      if (dismissY && !dismissRequested.value) dismissY.value = withTiming(0, { duration: reduceMotion ? 0 : 180 })
    }), [active, dismissRequested, dismissY, multiTouchInSequence, onPress, reduceMotion, savedScale])

  const gestures = useMemo(() => Gesture.Simultaneous(pinch, pan, doubleTap, swipeDown), [doubleTap, pan, pinch, swipeDown])

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }))

  return (
    <GestureDetector gesture={gestures}>
      {/* 写真自体は「閉じるボタン」ではなくなったので、role も onAccessibilityTap も持たせない。
          読み上げ環境で閉じる手段は右上の×（そちらに専用のラベルがある） */}
      <View
        style={[styles.viewport, { width, height }]}
        accessible={request.status === 'loaded'}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
      >
        {request.status === 'failed' ? (
          <View style={styles.feedback}>
            <AppIcon name="image-off-outline" size={40} color="rgba(255,255,255,0.65)" />
            <Text style={styles.feedbackText}>{lang === 'ja' ? '写真を読み込めませんでした' : 'Could not load photo'}</Text>
            <TouchableOpacity
              style={styles.retry}
              onPress={() => setRequest(current => ({ uri, attempt: current.attempt + 1, status: 'loading' }))}
              accessibilityRole="button"
              accessibilityLabel={lang === 'ja' ? '写真を再読み込み' : 'Reload photo'}
            >
              <Text style={styles.retryText}>{lang === 'ja' ? '再読み込み' : 'Try again'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Reanimated.Image
            key={`${uri}:${request.attempt}`}
            source={{ uri }}
            style={[{ width: fittedSize.width, height: fittedSize.height }, imageStyle]}
            resizeMode="contain"
            onLoad={() => settleRequest('loaded')}
            onError={() => settleRequest('failed')}
          />
        )}
        {request.status === 'loading' && (
          <View style={[StyleSheet.absoluteFill, styles.feedback]} pointerEvents="none">
            <ActivityIndicator size="large" color="#fff" accessibilityLabel={lang === 'ja' ? '写真を読み込み中' : 'Loading photo'} />
          </View>
        )}
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  feedback: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  feedbackText: { color: '#fff', fontSize: 14, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.16)' },
  retryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  viewport: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
})
