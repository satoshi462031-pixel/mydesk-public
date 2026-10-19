import { StyleSheet, View } from 'react-native'
import { Skeleton } from '../atoms/Skeleton'
import { useApp } from '../../context/AppContext'
import { UI_METRICS } from '../../constants/ui'

interface Props {
  /** 並べる枚数。実際に出る件数に近い数を渡す */
  count?: number
  /** カードの角丸。呼び出し元のカードに合わせる */
  radius?: number
  /**
   * 骨組みの形。実際に出るカードと合わせること。
   * `row` は小さいサムネ＋2行のリスト、`card` は写真が幅いっぱいのデスクカード
   * （DeskGridTile）。ここがずれると、読み込みが終わった瞬間に高さが跳ねて
   * 待ち時間を短く感じさせるという目的そのものが消える。
   */
  variant?: 'row' | 'card'
  /** 2列グリッドの一覧（みんなのデスク）用。1件ぶんの幅を半分にして2列で敷く */
  columns?: 1 | 2
  /** 写真を 16:9 で出す一覧（DeskGridTile の widePhoto。マイデスク・マイページのデスク）用 */
  widePhoto?: boolean
  /** みんなのデスクでは、本文に投稿者と更新日を並べる */
  discoveryOrder?: boolean
  /**
   * 親の一覧が余白を持つときは重ねない。
   * `gutter` は contentContainer が `padding: screenGutter` の一覧（上も 16 空く）の代わりに出すとき
   */
  inset?: 'all' | 'gutter' | 'horizontal' | 'none'
  /** 2列の行間・列間 */
  gap?: number
  /** 商品写真を使う行は、ジャンルのアイコン行より大きい */
  rowSize?: 'icon' | 'image'
}

// 一覧の読み込み中に、カードの形のまま骨組みを出す。
// 件数も形も事前に分かっている一覧では、中央のスピナーより待ち時間が短く感じられる。
export function ListSkeleton({
  count = 4, radius = UI_METRICS.cardRadius, variant = 'row', columns = 1,
  widePhoto = false, discoveryOrder = false, inset = 'all', gap = 12, rowSize = 'icon',
}: Props) {
  const { colors } = useApp()
  const grid = columns === 2
  const cards = Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            variant === 'card' ? styles.deskCard : styles.card,
            grid && styles.gridCell,
            grid && styles.gridCard,
            variant === 'row' && rowSize === 'image' && styles.imageRowCard,
            { backgroundColor: colors.card, borderColor: colors.border, borderRadius: grid ? UI_METRICS.controlRadius : radius },
          ]}
        >
          {variant === 'card' ? (
            <>
              {/* DeskGridTile の写真枠と同じ比率で場所を取る */}
              <Skeleton width="100%" height="auto" radius={0} style={widePhoto ? styles.deskPhotoWide : styles.deskPhoto} />
              <View style={[styles.deskBody, grid && styles.compactDeskBody, widePhoto && styles.wideDeskBody, discoveryOrder && styles.discoveryDeskBody]}>
                <Skeleton width={widePhoto ? '68%' : '72%'} height={grid ? 14 : widePhoto ? 21 : 18} />
                <View style={styles.purposeRow}>
                  <Skeleton width={grid ? (discoveryOrder ? 26 : 21) : 26} height={grid ? (discoveryOrder ? 26 : 21) : 26} radius={7} />
                  {widePhoto && <Skeleton width="40%" height={11} />}
                </View>
                {!widePhoto && (discoveryOrder ? (
                  <View style={styles.authorRow}>
                    <Skeleton width={16} height={16} radius={8} />
                    <Skeleton width="36%" height={10} />
                    <Skeleton width="22%" height={9} />
                  </View>
                ) : <Skeleton width="38%" height={grid ? 10 : 12} />)}
              </View>
            </>
          ) : (
            <>
              <Skeleton width={rowSize === 'image' ? 68 : 30} height={rowSize === 'image' ? 68 : 30} radius={rowSize === 'image' ? 10 : 8} />
              <View style={styles.body}>
                <Skeleton width="58%" height={15} />
                <Skeleton width="34%" height={12} />
              </View>
            </>
          )}
        </View>
  ))
  return (
    <View style={[styles.wrap, inset === 'gutter' && styles.gutterInset, inset === 'horizontal' && styles.horizontalInset, inset === 'none' && styles.noInset, grid && { gap }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {grid
        // 幅を % で決めると端数のぶん右列が内側に寄り、右の余白だけ screenGutter より広くなる。
        // 実物の一覧と同じく、行の中で flex: 1 の2枚に gap を挟んで割る
        ? Array.from({ length: Math.ceil(count / 2) }, (_, row) => (
          <View key={row} style={[styles.gridRow, { gap }]}>
            {cards[row * 2]}
            {cards[row * 2 + 1] ?? <View style={styles.gridCell} />}
          </View>
        ))
        : cards}
    </View>
  )
}

const styles = StyleSheet.create({
  // 上の 12 はマイページのタブ・マイガジェットの「タブバーから最初の行まで」に合わせた値
  wrap: { paddingHorizontal: UI_METRICS.screenGutter, paddingTop: 12 },
  gutterInset: { paddingTop: UI_METRICS.screenGutter },
  horizontalInset: { paddingTop: 0 },
  noInset: { paddingHorizontal: 0, paddingTop: 0 },
  gridRow: { flexDirection: 'row' },
  // 行と列の間隔は gap が持つので、カード側の marginBottom は打ち消す
  gridCell: { flex: 1, minWidth: 0, marginBottom: 0 },
  gridCard: { alignSelf: 'flex-start' },
  // アイコン行はマイガジェットの GadgetCard（アイコン 30・行間 6）に合わせる
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  imageRowCard: { gap: 12, marginBottom: 10 },
  body: { flex: 1, gap: 8 },

  deskCard: {
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  deskPhoto: { width: '100%', aspectRatio: 4 / 3 },
  deskPhotoWide: { width: '100%', aspectRatio: 16 / 9 },
  deskBody: { paddingHorizontal: 14, paddingVertical: 12, gap: 5 },
  compactDeskBody: { paddingHorizontal: 9, paddingVertical: 9, gap: 4 },
  wideDeskBody: { paddingHorizontal: 12, paddingVertical: 10 },
  discoveryDeskBody: { minHeight: 76 },
  purposeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
})
