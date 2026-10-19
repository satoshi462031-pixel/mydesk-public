// ─── 商品のブランド枠（074）──────────────────────────────────────
//
// 商品を出すところに共通で置く。押すとそのブランドの商品一覧へ行く。
//
// 表示名は brandDisplay に「商品に入っていた表記」を渡して作る。brandKey が返す
// キーを渡すと、辞書に無いブランドが潰した小文字（ugreen）のまま画面に出る。
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native'
import { BRANDS_ENABLED } from '../../constants/features'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { AppColors } from '../../context/AppContext'
import { brandDisplay, brandKey } from '../../utils/brandIdentity'
import { AppIcon } from '../atoms/AppIcon'

interface Props {
  /** products.brand の値。表記ゆれを含んだままでよい */
  brand: string | null | undefined
  colors: AppColors
  lang: 'ja' | 'en'
  /** 省略すると押せない表示だけの枠になる（商品を選ぶ画面など、遷移すると操作を壊す場所） */
  onPress?: (key: string, label: string) => void
  /**
   * 置き場所ごとの余白。ここで受けるのは、ブランドが無い商品では枠ごと消える必要が
   * あるため。呼び側で View に包んで余白を付けると、消えたあとも余白だけ残る
   */
  style?: StyleProp<ViewStyle>
}

export function BrandChip({ brand, colors: C, lang, onPress, style }: Props) {
  if (!BRANDS_ENABLED) return null
  const key = brandKey(brand)
  const label = brandDisplay(brand, lang)
  // 「ノーブランド品」などは brandKey が弾く。枠だけ残ると意味不明なので出さない
  if (!key || !label) return null

  const body = (
    <>
      <AppIcon name={ICONS.tag} size={12} color={C.textSub} />
      <Text style={[styles.label, { color: C.textSub }]} numberOfLines={1}>{label}</Text>
      {!!onPress && <AppIcon name={ICONS.chevronRight} size={13} color={C.textMuted} />}
    </>
  )

  if (!onPress) {
    return <View style={[styles.chip, { backgroundColor: C.chip, borderColor: C.border }, style]}>{body}</View>
  }
  return (
    <TouchableOpacity
      style={[styles.chip, { backgroundColor: C.chip, borderColor: C.border }, style]}
      onPress={() => onPress(key, label)}
      activeOpacity={0.7}
      // 親のカードも押せることが多いので、枠の外まで当たり判定を広げない
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={lang === 'en' ? `Browse ${label} products` : `${label} の商品を見る`}
    >
      {body}
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 180,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: UI_METRICS.chipRadius,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 11, fontWeight: '700', flexShrink: 1 },
})
