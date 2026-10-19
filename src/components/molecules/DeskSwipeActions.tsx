// デスクのタイルを横にスワイプしたとき出る操作ボタン。
// マイデスクの一覧とマイページのデスクタブで同じ操作・同じ見た目にするため共通に置く。
// 片方にだけ手を入れると、同じデスクの一覧で操作の出方が割れる。
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ICONS } from '../../constants/icons'
import { UI_METRICS, UI_STATUS_COLORS } from '../../constants/ui'
import { AppColors } from '../../context/AppContext'
import { AppIcon } from '../atoms/AppIcon'

// 右スワイプで出す操作ボタン（ピン留め・複製）の寸法
const SWIPE_BUTTON_WIDTH = 72
const SWIPE_BUTTON_GAP = 8
/** タイル同士の間隔。みんなのデスクの一覧の gap と同じ値 */
export const DESK_TILE_GAP = 12

// 指を止めた位置でのボタンの大きさ。0 でも消し切らずに残すのは、押せる場所が
// どこに出るかを最初のひと動かしで見せるため
const SWIPE_REVEAL_MIN_SCALE = 0.45

/**
 * スワイプの進み具合（0〜1）を、ボタンそのものの大きさに写す。LINE のトークリストと同じ出方。
 *
 * 以前は実寸のボタンを横から滑り込ませていた（translateX）。あれは少し動かしただけで
 * 完成した姿のボタンが顔を出すので「もう押せる」ように見えるが、実際は開ききるまで
 * 手を離すと閉じる。大きさで進み具合を出せば、見えている姿と押せるかどうかが一致する。
 *
 * 透明度は大きさより早く上げきる。最後まで薄いままだと、開き終わってから色が乗るぶん
 * 一拍遅れて見える。
 */
export const swipeRevealStyle = (progress: Animated.AnimatedInterpolation<number>) => ({
  opacity: progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0.9, 1],
    extrapolate: 'clamp' as const,
  }),
  transform: [{
    scale: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [SWIPE_REVEAL_MIN_SCALE, 1],
      extrapolate: 'clamp' as const,
    }),
  }],
})

type Progress = Animated.AnimatedInterpolation<number>

// ピン留めは LINE と同じで右スワイプの中に置く。カードに常時出しておくと、
// 押す機会がほとんど無いボタンが一覧の全行を占め続けることになる
export function DeskSwipeLeftActions({
  pinned, onTogglePin, onDuplicate, progress, colors, t,
}: {
  pinned: boolean
  onTogglePin: () => void
  onDuplicate: () => void
  progress: Progress
  colors: AppColors
  t: (key: string) => string
}) {
  return (
    <View style={styles.leftActions}>
      <Animated.View style={[styles.swipeButtonWrap, swipeRevealStyle(progress)]}>
        <TouchableOpacity
          style={[styles.swipeButton, { backgroundColor: colors.accent }]}
          onPress={onTogglePin}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t(pinned ? 'a11y.pinOff' : 'a11y.pinOn')}
        >
          <AppIcon name={pinned ? 'pin-off' : 'pin'} size={22} color={colors.onAccent} />
          <Text style={[styles.swipeLabel, { color: colors.onAccent }]}>
            {t(pinned ? 'planList.unpin' : 'planList.pin')}
          </Text>
        </TouchableOpacity>
      </Animated.View>
      <Animated.View style={[styles.swipeButtonWrap, swipeRevealStyle(progress)]}>
        <TouchableOpacity
          style={[styles.swipeButton, styles.copyButton]}
          onPress={onDuplicate}
          activeOpacity={0.8}
        >
          <AppIcon name={ICONS.copy} size={22} color="#fff" />
          <Text style={[styles.swipeLabel, { color: '#fff' }]}>
            {t('planList.duplicate')}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

export function DeskSwipeRightActions({
  onDelete, progress, t,
}: {
  onDelete: () => void
  progress: Progress
  t: (key: string) => string
}) {
  return (
    <View style={styles.deleteAction}>
      <Animated.View style={[styles.swipeButtonWrap, swipeRevealStyle(progress)]}>
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete} activeOpacity={0.8}>
          <AppIcon name={ICONS.trash} size={22} color="#fff" />
          <Text style={[styles.swipeLabel, { color: '#fff' }]}>{t('common.delete')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  leftActions: {
    marginBottom: DESK_TILE_GAP,
    marginLeft: UI_METRICS.screenGutter,
    flexDirection: 'row',
    gap: SWIPE_BUTTON_GAP,
  },
  // 大きさを動かす器。中のボタンが height:'100%' なので、器は行の高さまで伸ばす
  swipeButtonWrap: { alignSelf: 'stretch' },
  swipeButton: {
    borderRadius: UI_METRICS.controlRadius,
    width: SWIPE_BUTTON_WIDTH,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  copyButton: { backgroundColor: UI_STATUS_COLORS.info },
  swipeLabel: { fontSize: 12, fontWeight: '600' },
  deleteAction: { marginBottom: DESK_TILE_GAP, marginRight: UI_METRICS.screenGutter, justifyContent: 'center' },
  deleteButton: {
    backgroundColor: UI_STATUS_COLORS.danger,
    borderRadius: UI_METRICS.controlRadius,
    width: 80,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
})
