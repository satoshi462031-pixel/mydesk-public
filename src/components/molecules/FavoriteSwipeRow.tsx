import { ComponentProps } from 'react'
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { useApp } from '../../context/AppContext'
import { ICONS } from '../../constants/icons'
import { AppIcon } from '../atoms/AppIcon'
import { SwipeCommitRow } from './SwipeCommitRow'
import { swipeRevealStyle } from './DeskSwipeActions'
import { UI_METRICS } from '../../constants/ui'

type Props = Omit<ComponentProps<typeof Swipeable>, 'renderLeftActions' | 'onSwipeableOpen' | 'onSwipeableOpenStartDrag'> & {
  favorite: boolean
  label: string
  onToggleFavorite?: () => void
  onRowRef: (row: Swipeable | null) => void
  insetActions?: boolean
}

export function FavoriteSwipeRow({ favorite, label, onToggleFavorite, onRowRef, insetActions = false, children, ...rowProps }: Props) {
  return (
    <SwipeCommitRow
      {...rowProps}
      leftThreshold={44}
      // ボタン幅（88）まで引く操作と、お気に入りの確定を分ける。
      commitDistance={144}
      overshootLeft
      overshootFriction={1}
      onRowRef={onRowRef}
      onCommit={onToggleFavorite}
      renderCommitActions={(progress, commit) => insetActions ? (
        <View style={styles.insetActions}>
          <Animated.View style={[styles.buttonWrap, swipeRevealStyle(progress)]}>
            <FavoriteSwipeAction favorite={favorite} label={label} onPress={commit} inset />
          </Animated.View>
        </View>
      ) : <FavoriteSwipeAction favorite={favorite} label={label} onPress={commit} />}
    >
      {children}
    </SwipeCommitRow>
  )
}

export function FavoriteSwipeAction({ favorite, label, onPress, inset = false }: {
  favorite: boolean
  label: string
  onPress: () => void
  inset?: boolean
}) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  return (
    <TouchableOpacity
      style={[inset ? styles.insetButton : styles.action, { backgroundColor: C.chip }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={favorite
        ? (ja ? `${label}のお気に入りを外す` : `Remove ${label} from favorites`)
        : (ja ? `${label}をお気に入りにする` : `Add ${label} to favorites`)}
    >
      <AppIcon name={favorite ? ICONS.star : ICONS.starFilled} size={20} color={C.favorite} />
      <Text style={[styles.label, { color: C.text }]}>{favorite ? (ja ? '解除' : 'Unfavorite') : (ja ? 'お気に入り' : 'Favorite')}</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  insetActions: { flexDirection: 'row', marginLeft: UI_METRICS.screenGutter, marginBottom: 6 },
  buttonWrap: { alignSelf: 'stretch' },
  insetButton: {
    width: 72,
    height: '100%',
    borderRadius: UI_METRICS.controlRadius,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  action: { width: 88, alignItems: 'center', justifyContent: 'center', gap: 6 },
  label: { fontSize: 12, fontWeight: '600' },
})
