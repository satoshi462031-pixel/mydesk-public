// 投稿者のフォローボタン（084）。公開デスクの投稿者行・公開プロフィール・フォロー中の一覧で共用する。
//
// X（Twitter）と同じ形：文字だけの pill で、未フォローは文字色の塗りに地の色の文字、
// フォロー中は塗りを抜いて枠線だけにする。押す前後で同じ見た目だと、押せたのか・
// 今どちらなのかが文字を読むまで分からない。accent で塗らないのは、SNS で見慣れた
// 白黒の形のほうが「フォローのボタン」だと一目で伝わるから
import { memo } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { UI_METRICS } from '../../constants/ui'
import type { AppColors } from '../../constants/colors'

interface Props {
  following: boolean
  onPress: () => void
  colors: AppColors
  lang: 'ja' | 'en'
  /** 投稿者行のように高さの限られた行に置くとき */
  compact?: boolean
  /** 誰をフォローするのか。VoiceOver が「フォロー」だけを読むと対象が分からない */
  name?: string | null
}

export const FollowButton = memo(function FollowButton({ following, onPress, colors: C, lang, compact, name }: Props) {
  const ja = lang === 'ja'
  const label = following ? (ja ? 'フォロー中' : 'Following') : (ja ? 'フォロー' : 'Follow')
  return (
    <TouchableOpacity
      style={[
        styles.button,
        compact && styles.compact,
        following
          ? { backgroundColor: 'transparent', borderColor: C.border }
          : { backgroundColor: C.text, borderColor: C.text },
      ]}
      onPress={onPress}
      hitSlop={compact ? 8 : 4}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: following }}
      accessibilityLabel={name
        ? (following
          ? (ja ? `${name} をフォロー中。押すと解除` : `Following ${name}. Tap to unfollow`)
          : (ja ? `${name} をフォロー` : `Follow ${name}`))
        : label}
    >
      <Text
        style={[styles.text, compact && styles.compactText, { color: following ? C.text : C.card }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  )
})

const styles = StyleSheet.create({
  // 押せる高さは 36 + hitSlop 4 で 44、compact は 28 + 8 で 44
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: UI_METRICS.pillRadius,
    borderWidth: 1,
  },
  compact: { minHeight: 28, paddingHorizontal: 14 },
  text: { fontSize: 14, fontWeight: '700' },
  compactText: { fontSize: 13 },
})
