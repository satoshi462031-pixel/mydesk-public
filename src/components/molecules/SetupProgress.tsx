import React, { useEffect, useRef } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation, useRoute, type ParamListBase } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Reanimated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated'
import { AppIcon } from '../atoms/AppIcon'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { useSpotlightTarget } from '../../context/SpotlightContext'
import { UI_METRICS } from '../../constants/ui'

const STEPS = [
  { ja: 'デスクの用途', en: 'Purposes' },
  // 2歩目は用途から入った枠を整えて商品名まで入れる画面。デスク詳細の「機材」タブと語を揃える。
  // 間にあったジャンルを選ぶ段はやめた（ジャンルの足し引きはこの画面でもできて、同じことを2回聞いていた）
  { ja: '機材', en: 'Gear' },
  { ja: '配置', en: 'Layout' },
  // 最後に写真を任意登録。ここを通らないと写真ゼロのまま完成し、一覧のタイルが机アイコンだけになる
  { ja: '写真', en: 'Photos' },
] as const

type SetupStep = 0 | 1 | 2 | 3

// 画面の押し込み（約350ms）が終わってから伸ばす。遷移中に伸ばすと横に流れる画面に紛れて見えない。
// 読み込み中を挟んで遷移後にマウントされた画面では transitionEnd が来ないので、待ちを打ち切る
const TRANSITION_FALLBACK_MS = 600

export function SetupProgress({ current, onStepPress, canNavigate }: {
  current: SetupStep
  onStepPress?: (step: SetupStep) => void
  canNavigate?: (step: SetupStep) => boolean
}) {
  const { colors, lang, reduceMotion } = useApp()
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>()
  const route = useRoute()
  // 使い方ガイドのカードがこの帯を隠さないよう、高さを実測させる（光らせる対象ではない）。
  // 作成フローの各画面が同じ id で登録するが、どの画面でもヘッダー直下の同じ位置に出るので、
  // スタックに複数残っていてもどれを測った値でも変わらない
  const spotlightRef = useSpotlightTarget('setup-progress')
  // 後ろの段から戻ってきたときに前から線が伸びると「進んだ」ように見えるので、着いた形で出す
  const comingBack = !!(route.params as { setupBack?: true } | undefined)?.setupBack
  const skipArrival = current === 0 || reduceMotion || comingBack
  const arrivedStep = useRef<SetupStep | null>(skipArrival ? current : null)
  const lineFill = useSharedValue(skipArrival ? 1 : 0)
  const dotScale = useSharedValue(1)

  useEffect(() => {
    if (skipArrival || arrivedStep.current === current) {
      arrivedStep.current = current
      lineFill.value = 1
      dotScale.value = 1
      return
    }
    let started = false
    const start = () => {
      if (started) return
      started = true
      arrivedStep.current = current
      lineFill.value = 0
      lineFill.value = withTiming(1, { duration: 420, easing: Easing.inOut(Easing.cubic) }, (finished) => {
        if (!finished) return
        dotScale.value = withSequence(withTiming(1.18, { duration: 120 }), withTiming(1, { duration: 160 }))
      })
    }
    // Web の native-stack は遷移の動きが無く transitionEnd が来ない
    if (Platform.OS === 'web') {
      start()
      return () => { cancelAnimation(lineFill); cancelAnimation(dotScale) }
    }
    const timer = setTimeout(start, TRANSITION_FALLBACK_MS)
    const unsubscribe = navigation.addListener('transitionEnd', (event) => {
      if (!event.data.closing) start()
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
      cancelAnimation(lineFill)
      cancelAnimation(dotScale)
    }
  }, [skipArrival, navigation, lineFill, dotScale, current])

  const lineFillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: lineFill.value }] }))
  const dotPopStyle = useAnimatedStyle(() => ({ transform: [{ scale: dotScale.value }] }))

  return (
    <View ref={spotlightRef} style={[styles.wrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      {STEPS.map((step, index) => {
        const done = index < current
        const active = index === current
        const stepIndex = index as SetupStep
        const enabled = !!onStepPress && (canNavigate?.(stepIndex) ?? true)
        const color = done || active ? colors.accentIcon : colors.textMuted
        const labelColor = done || active ? colors.accentText : colors.textMuted
        // 線は前後どちらかのステップがチェック済みなら着色してよい（＝手前のステップが完了していれば足りる）
        const lineDone = index < current
        return (
          <React.Fragment key={step.en}>
            {index > 0 && (
              <View style={[styles.line, { backgroundColor: lineDone ? colors.accentIcon : colors.border }]}>
                {index === current && (
                  <Reanimated.View style={[styles.lineFill, { backgroundColor: colors.accentIcon }, lineFillStyle]} />
                )}
              </View>
            )}
            <Pressable
              style={styles.step}
              onPress={enabled ? () => onStepPress?.(stepIndex) : undefined}
              disabled={!enabled}
              accessibilityRole={enabled ? 'button' : undefined}
              accessibilityState={{ selected: active, disabled: !enabled }}
              accessibilityLabel={enabled ? (lang === 'en' ? `Go to ${step.en}` : `${step.ja}へ移動`) : undefined}
            >
              <Reanimated.View style={[styles.dot, { backgroundColor: active ? colors.accent : colors.chip, borderColor: color }, index === current && dotPopStyle]}>
                {done
                  ? <AppIcon name={ICONS.check} size={13} color={color} centered />
                  : <Text style={[styles.dotText, { color: active ? colors.onAccent : colors.textMuted }]}>{index + 1}</Text>}
              </Reanimated.View>
              {/* 段の幅（58）に「デスクの用途」「テンプレート」の6文字がちょうど収まらない。「…」で切らず縮めて出す */}
              <Text style={[styles.label, { color: labelColor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{lang === 'en' ? step.en : step.ja}</Text>
            </Pressable>
          </React.Fragment>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  step: { width: 58, alignItems: 'center', gap: 4 },
  line: { flex: 1, height: 2, marginTop: 12, marginHorizontal: -4 },
  lineFill: { ...StyleSheet.absoluteFillObject, transformOrigin: 'left' },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: { fontSize: 11, fontWeight: '800' },
  label: { fontSize: 10, fontWeight: '600', maxWidth: UI_METRICS.rowMinHeight + 12 },
})
