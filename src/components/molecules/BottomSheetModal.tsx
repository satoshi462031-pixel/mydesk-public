import { PropsWithChildren, useEffect, useRef, useState } from 'react'
import {
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  ViewStyle,
} from 'react-native'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { SwipeDismissSheet } from './SwipeDismissSheet'

// 出す・しまう動きは自前で持ち、Modal の animationType は使わない。
// iOS の Modal の slide は画面全体の標準の遷移で、暗い背景ごと下からせり上がるうえ尺も長く、
// 共有ボタンなどを押してからシートが出るまでがもたついて見えた。
// 背景は薄く重ねるだけ、シートだけを短く滑らせる（iOS のアクションシートと同じ分け方）
const ENTER_MS = 240
const EXIT_MS = 180

interface Props extends PropsWithChildren {
  visible: boolean
  onDismiss: () => void
  onDismissed?: () => void
  dismissDisabled?: boolean
  avoidKeyboard?: boolean
  sheetStyle?: StyleProp<ViewStyle>
  backdropStyle?: StyleProp<ViewStyle>
}

/** 下端シートの土台。内容固有の見出し・スクロール領域だけを children で受け取る。 */
export function BottomSheetModal({
  visible,
  onDismiss,
  onDismissed,
  dismissDisabled = false,
  avoidKeyboard = false,
  sheetStyle,
  backdropStyle,
  children,
}: Props) {
  const { colors: C, reduceMotion } = useApp()
  const backdrop = useRef(new Animated.Value(0)).current
  const offset = useRef(new Animated.Value(Dimensions.get('window').height)).current
  const reduceMotionRef = useRef(reduceMotion)
  reduceMotionRef.current = reduceMotion
  const release = useRef({ velocity: 0, height: 0, offset: 0 })
  const opening = useRef(false)

  // 閉じる動きのあいだも Modal を出したままにする。visible が false になったレンダーで
  // すぐ外すと、しまう動きを見せる前に消える
  const [exiting, setExiting] = useState(false)
  const [presented, setPresented] = useState(false)
  const prevVisible = useRef(visible)
  const modalVisible = visible || exiting
  const wasModalVisible = useRef(modalVisible)
  useEffect(() => {
    const closed = wasModalVisible.current && !modalVisible
    wasModalVisible.current = modalVisible
    if (closed && Platform.OS !== 'ios') onDismissed?.()
  }, [modalVisible, onDismissed])
  if (prevVisible.current !== visible) {
    prevVisible.current = visible
    if (!visible && presented) setExiting(true)
    else if (exiting) setExiting(false)
  }

  useEffect(() => {
    if (!visible && !exiting) { setPresented(false); return }
    // Modal の表示前に始めると、初回のネイティブ表示が遅れたぶん登場演出を取りこぼす。
    if (!presented) return
    const height = Dimensions.get('window').height
    if (visible) {
      if (!opening.current) {
        backdrop.setValue(0)
        offset.setValue(reduceMotionRef.current ? 0 : height)
      }
      opening.current = true
      release.current = { velocity: 0, height: 0, offset: 0 }
      const anim = Animated.parallel([
        Animated.timing(backdrop, { toValue: 1, duration: ENTER_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(offset, { toValue: 0, duration: ENTER_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ])
      anim.start()
      return () => anim.stop()
    }
    if (!exiting) return
    const target = release.current.height > 0 ? release.current.height + 48 : height
    const remaining = Math.max(0, target - release.current.offset)
    const duration = release.current.velocity > 0
      ? Math.max(80, Math.min(EXIT_MS, remaining / release.current.velocity))
      : EXIT_MS
    const anim = Animated.parallel([
      Animated.timing(backdrop, { toValue: 0, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(offset, { toValue: reduceMotionRef.current ? 0 : target, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ])
    anim.start(({ finished }) => {
      if (finished) { opening.current = false; setExiting(false) }
    })
    return () => anim.stop()
  }, [visible, exiting, presented, backdrop, offset])

  const close = () => {
    if (!dismissDisabled) onDismiss()
  }
  return (
    <Modal visible={modalVisible} transparent animationType="none" onRequestClose={close} onShow={() => setPresented(true)} onDismiss={onDismissed}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={avoidKeyboard && Platform.OS === 'ios' ? 'padding' : undefined}
        enabled={avoidKeyboard}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle, { opacity: backdrop }]} pointerEvents="none" />
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessible={false} />
        {/* 画面の高さいっぱいに取って、シートの maxHeight（呼び出し側の '86%' など）の基準を
            外側の面と同じに保つ。空いている所の指は下の背景（閉じる）へ通す */}
        <Animated.View
          pointerEvents="box-none"
          style={[styles.sheetSlot, { opacity: reduceMotion ? backdrop : 1 }]}
        >
          <SwipeDismissSheet
            visible={visible}
            onDismiss={close}
            disabled={dismissDisabled}
            handleColor={C.border}
            style={[styles.sheet, { backgroundColor: C.card }, sheetStyle]}
            translateY={offset}
            reduceMotion={reduceMotion}
            onDrag={(distance, height) => {
              release.current.offset = distance
              const opacity = Math.max(0, 1 - distance / Math.max(1, height))
              if (distance === 0) Animated.timing(backdrop, { toValue: 1, duration: 160, useNativeDriver: true }).start()
              else backdrop.setValue(opacity)
            }}
            onRelease={(velocity, height) => { release.current = { ...release.current, velocity, height } }}
          >
            {presented ? children : null}
          </SwipeDismissSheet>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheetSlot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: UI_METRICS.sheetRadius,
    borderTopRightRadius: UI_METRICS.sheetRadius,
    paddingHorizontal: UI_METRICS.sheetGutter,
    paddingBottom: UI_METRICS.sheetBottom,
  },
})
