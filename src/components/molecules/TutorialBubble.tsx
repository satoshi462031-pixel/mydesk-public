import { useEffect } from 'react'
import { DeviceEventEmitter, LayoutChangeEvent, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import { useApp } from '../../context/AppContext'
import { UI_METRICS } from '../../constants/ui'

const INTERACTION_EVENT = 'tutorial-screen-interaction'

export function notifyTutorialInteraction() {
  DeviceEventEmitter.emit(INTERACTION_EVENT)
}

type Props = {
  title?: string
  body: string
  onConfirm: () => void
  onDismiss?: () => void
  progress?: string
  onSkip?: () => void
  skipLabel?: string
  arrow?: { side: 'top' | 'bottom'; left: number }
  maxHeight: number
  onLayout?: (event: LayoutChangeEvent) => void
}

const ARROW = 14

// 面はテーマのカード色にする。ダークで明るい面に固定すると、暗幕の上で吹き出しだけが
// 眩しく浮き、画面の他の部分と白黒の度合いが合わない。
// OK は本文の下の行に置く。右に縦の欄を取ると、本文が長いときに欄の上下が空白になる。
export function TutorialBubble({
  title, body, onConfirm, onDismiss, progress, onSkip, skipLabel, arrow, maxHeight, onLayout,
}: Props) {
  const { colors: C } = useApp()
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener(INTERACTION_EVENT, () => onDismiss?.())
    return () => subscription.remove()
  }, [onDismiss])
  return (
    <View style={[styles.bubble, { maxHeight, backgroundColor: C.card, borderColor: C.border }]} onLayout={onLayout} testID="tutorial-bubble"
      onTouchStart={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}>
      {arrow && (
        <View pointerEvents="none" style={[
          styles.arrow, { left: arrow.left, backgroundColor: C.card, borderColor: C.border },
          arrow.side === 'top' ? styles.arrowTop : styles.arrowBottom,
        ]} />
      )}
      <ScrollView style={styles.copy} contentContainerStyle={styles.copyContent} bounces={false}>
        {title && <Text accessibilityRole="header" style={[styles.title, { color: C.text }]}>{title}</Text>}
        <Text style={[styles.body, { color: C.text }]}>{body}</Text>
      </ScrollView>
      <View style={styles.footer}>
        {onSkip && (
          <TouchableOpacity onPress={onSkip} style={styles.skip} accessibilityRole="button">
            <Text style={[styles.skipText, { color: C.textMuted }]}>{skipLabel}</Text>
          </TouchableOpacity>
        )}
        <View style={styles.spacer} />
        {progress && <Text style={[styles.progress, { color: C.textMuted }]}>{progress}</Text>}
        <TouchableOpacity style={styles.confirm} onPress={onConfirm} activeOpacity={0.65}
          accessibilityRole="button" accessibilityLabel="OK">
          <Text style={[styles.confirmText, { color: C.accentText }]}>OK</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: { borderWidth: 1, borderRadius: UI_METRICS.cardRadius },
  arrow: {
    position: 'absolute', width: ARROW, height: ARROW, transform: [{ rotate: '45deg' }],
  },
  arrowTop: { top: -ARROW / 2 - 1, borderTopWidth: 1, borderLeftWidth: 1 },
  arrowBottom: { bottom: -ARROW / 2 - 1, borderBottomWidth: 1, borderRightWidth: 1 },
  // 長い本文はここだけスクロールさせ、OK の行は常に見えるようにする
  copy: { flexGrow: 0, flexShrink: 1 },
  copyContent: { paddingHorizontal: UI_METRICS.screenGutter, paddingTop: 14, gap: 5 },
  title: { fontSize: 16, lineHeight: 23, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: UI_METRICS.screenGutter, paddingRight: 4 },
  spacer: { flex: 1 },
  progress: { fontSize: 13, fontVariant: ['tabular-nums'] },
  skip: { minHeight: 44, justifyContent: 'center', flexShrink: 1 },
  skipText: { fontSize: 13 },
  confirm: { minWidth: 56, minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  confirmText: { fontSize: 17, fontWeight: '600' },
})
