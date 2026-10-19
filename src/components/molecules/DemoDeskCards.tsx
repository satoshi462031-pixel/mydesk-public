import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { DEMO_DESK_LINKS, DemoDeskLink } from '../../constants/demoDeskLinks'
import { AppColors } from '../../context/AppContext'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'

// ─── 公式デモデスクのカード ──────────────────────────────────────
//
// 公開デスクの入口。まだ自分のデスクが無い人に、完成形を見本として
// 見せるためのもの。開くだけで、自分のデスクにはならない。
//
// 4本ぶん並ぶので、1件あたりの高さを抑えて横並びの行にしている。
// 大きなサムネイルを縦に積むと、リンク入力欄が画面外へ押し出される。

/**
 * サムネイルの表示サイズ。一覧のタイル・公開デスクの大写真と同じ 4:3 で切る
 * （画像は 3:2。ここだけ別の比率にすると、開いた先の大写真と切り取り方が変わる）。
 * 高さは行を低く保つための値なので、比率は幅で合わせる
 */
const THUMB_H = 65
const THUMB_W = Math.round(THUMB_H * 4 / 3)

interface Props {
  colors: AppColors
  lang: 'ja' | 'en'
  fmtPrice: (value: number) => string
  /** 最初に選んでもらった利用目的。合うデスクを先に出すのに使う */
  /** 公開デスク画面を開く */
  onOpen: (deskId: string) => void
}

export function DemoDeskCards({ colors, lang, fmtPrice, onOpen }: Props) {
  const ja = lang === 'ja'

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <AppIcon name="star-four-points-outline" size={15} color={colors.accentIcon} />
        <Text style={[styles.headTitle, { color: colors.text }]}>
          {ja ? '公式デモデスク' : 'Official demo desks'}
        </Text>
      </View>
      <Text style={[styles.headDesc, { color: colors.textMuted }]}>
        {ja
          ? '実際のガジェットと価格が入ったデスクです。配線図や費用の内訳をそのまま試せます'
          : 'Real gear and prices. Try the wiring map and the cost breakdown right away.'}
      </Text>
      <View style={[styles.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {DEMO_DESK_LINKS.map((demo, index) => (
          <DemoRow
            key={demo.id}
            demo={demo}
            colors={colors}
            ja={ja}
            fmtPrice={fmtPrice}
            last={index === DEMO_DESK_LINKS.length - 1}
            onPress={() => onOpen(demo.deskId)}
          />
        ))}
      </View>
    </View>
  )
}

function DemoRow({
  demo,
  colors,
  ja,
  fmtPrice,
  last,
  onPress,
}: {
  demo: DemoDeskLink
  colors: AppColors
  ja: boolean
  fmtPrice: (value: number) => string
  last: boolean
  onPress: () => void
}) {
  return (
    <TouchableOpacity
      style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={ja ? demo.nameJa : demo.nameEn}
    >
      <Image source={demo.thumbnail} style={styles.thumb} resizeMode="cover" />
      <View style={styles.body}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {ja ? demo.nameJa : demo.nameEn}
        </Text>
        <Text style={[styles.meta, { color: colors.textMuted }]} numberOfLines={1}>
          {ja
            ? `${demo.gadgetCount}台 ・ ${fmtPrice(demo.totalPrice)}`
            : `${demo.gadgetCount} devices ・ ${fmtPrice(demo.totalPrice)}`}
        </Text>
      </View>
      <AppIcon name={ICONS.chevronRight} size={18} color={colors.textMuted} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  headTitle: { fontSize: 14, fontWeight: '700' },
  headDesc: { fontSize: 11, lineHeight: 16, marginBottom: 10 },
  list: { borderRadius: UI_METRICS.panelRadius, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 },
  thumb: { width: THUMB_W, height: THUMB_H, borderRadius: 7 },
  body: { flex: 1 },
  name: { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  meta: { fontSize: 11 },
})
