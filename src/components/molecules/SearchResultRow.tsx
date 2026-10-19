import { memo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { TogglePop } from '../atoms/TogglePop'
import { brandDisplay } from '../../utils/brandIdentity'
import { AuthorAvatar } from '../atoms/AuthorAvatar'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../../constants/categoryLabels'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { AppColors } from '../../context/AppContext'
import { publicAuthorParts } from '../../utils/publicAuthor'

// 検索結果の「ユーザー」「ガジェット」タブの1行（079）。
//
// どちらも写真を主役にしない。デスクは写真で選ぶものだが、人と機材は
// 名前で当てにいく対象で、2列のタイルにすると1画面に入る数が減るだけになる。
//
// 右端に出す数がこの行の要点。人なら公開しているデスクの数、機材なら
// それを使っているデスクの数で、どちらも「押した先に何件あるか」を先に見せる。

interface BrandProps {
  /** 公開時に焼いた英字表記。表示名とキーはここから引き直す（074 / 075） */
  brand: string
  deskCount: number
  followed: boolean
  colors: AppColors
  lang: 'ja' | 'en'
  /** 押すと商品一覧（BrandProductsScreen）へ */
  onPress: (brand: string) => void
  onToggleFollow: (brand: string) => void
}

// ブランドは機材より一段上の見出しとして出す。押す先が2つある（商品一覧と
// お気に入り）ので、行そのものと★を分けて持たせる
export const BrandResultRow = memo(function BrandResultRow({
  brand, deskCount, followed, colors: C, lang, onPress, onToggleFollow,
}: BrandProps) {
  const ja = lang === 'ja'
  const label = brandDisplay(brand, lang) ?? brand
  const [followPopKey, setFollowPopKey] = useState(0)
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}
      onPress={() => onPress(brand)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={ja ? `${label} の商品一覧を見る` : `Browse ${label} products`}
    >
      <View style={[styles.iconBox, { backgroundColor: C.chip }]}>
        <AppIcon name={ICONS.tag} size={20} color={C.accentText} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>{label}</Text>
        <Text style={[styles.sub, { color: C.textMuted }]} numberOfLines={1}>
          {ja ? `${deskCount}件のデスクで使用` : `Used in ${deskCount} desk${deskCount === 1 ? '' : 's'}`}
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => {
          if (!followed) setFollowPopKey((key) => key + 1)
          onToggleFollow(brand)
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityState={{ selected: followed }}
        accessibilityLabel={followed
          ? (ja ? `${label} をお気に入りから外す` : `Remove ${label} from favorites`)
          : (ja ? `${label} をお気に入りに追加` : `Add ${label} to favorites`)}
      >
        <TogglePop popKey={followPopKey}>
          <AppIcon
            name={followed ? ICONS.starFilled : ICONS.star}
            size={20}
            color={C.favorite}
          />
        </TogglePop>
      </TouchableOpacity>
      <AppIcon name={ICONS.chevronRight} size={16} color={C.textMuted} />
    </TouchableOpacity>
  )
})

interface GearProps {
  name: string
  category: string
  deskCount: number
  colors: AppColors
  isDark: boolean
  lang: 'ja' | 'en'
  onPress: (name: string, category: string) => void
}

export const GearResultRow = memo(function GearResultRow({
  name, category, deskCount, colors: C, isDark, lang, onPress,
}: GearProps) {
  const ja = lang === 'ja'
  const labels = ja ? CATEGORY_LABELS : CATEGORY_LABELS_EN
  const categoryLabel = (labels as Record<string, string>)[category] ?? category
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}
      onPress={() => onPress(name, category)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={ja
        ? `${name}。使っているデスク ${deskCount} 件`
        : `${name}. Used in ${deskCount} desk${deskCount === 1 ? '' : 's'}`}
    >
      <View style={[styles.iconBox, { backgroundColor: C.chip }]}>
        <CategoryIcon category={category} size={20} color={categoryIconColor(category, isDark)} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>{name}</Text>
        <Text style={[styles.sub, { color: C.textMuted }]} numberOfLines={1}>{categoryLabel}</Text>
      </View>
      <Text style={[styles.count, { color: C.textMuted }]} numberOfLines={1}>
        {ja ? `${deskCount}件` : `${deskCount}`}
      </Text>
      <AppIcon name={ICONS.chevronRight} size={16} color={C.textMuted} />
    </TouchableOpacity>
  )
})

interface ProfileProps {
  tag: string
  name?: string | null
  avatarUrl?: string | null
  deskCount: number
  colors: AppColors
  lang: 'ja' | 'en'
  onPress: (tag: string) => void
}

export const ProfileResultRow = memo(function ProfileResultRow({
  tag, name, avatarUrl, deskCount, colors: C, lang, onPress,
}: ProfileProps) {
  const ja = lang === 'ja'
  const parts = publicAuthorParts(name, tag)
  // 名前を決めていない人は @ID しか出せない。両方空にすると、誰の行なのかを
  // 示すものがアイコンの色しか残らない（DeskGridTile と同じ落とし方）
  const label = parts.name || parts.tag
  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}
      onPress={() => onPress(tag)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={ja
        ? `${label} のプロフィール。公開デスク ${deskCount} 件`
        : `${label}'s profile. ${deskCount} public desk${deskCount === 1 ? '' : 's'}`}
    >
      <AuthorAvatar name={name} tag={tag} imageUrl={avatarUrl} size={38} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>{label}</Text>
        {!!parts.name && !!parts.tag && (
          <Text style={[styles.sub, { color: C.textMuted }]} numberOfLines={1}>{parts.tag}</Text>
        )}
      </View>
      <Text style={[styles.count, { color: C.textMuted }]} numberOfLines={1}>
        {ja ? `デスク ${deskCount}件` : `${deskCount} desk${deskCount === 1 ? '' : 's'}`}
      </Text>
      <AppIcon name={ICONS.chevronRight} size={16} color={C.textMuted} />
    </TouchableOpacity>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: UI_METRICS.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
  },
  // 器は幅の約1/4を角丸に（design.md）
  iconBox: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12 },
  count: { fontSize: 12 },
})
