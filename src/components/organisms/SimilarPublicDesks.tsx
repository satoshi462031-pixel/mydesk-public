// 公開デスク画面の機材タブの末尾に置く「このデスクに近いデスク」。
//
// 人のデスクを見終えた人の次の行き先。閲覧者の機材ではなく、今見ているデスクの
// 機材と用途で近さを測る（ログインしていない・自分のデスクがまだ無い人にも効かせる）。
// 順位付けはサーバー（089）。
//
// タイルは GadgetPublicDesks と同じ DeskGridTile の compact を横に流す。
// 更新日の代わりに「なぜ近いか」を出す。理由の無いおすすめは、並べ替えただけの
// 新着一覧と見分けがつかない。
import { useEffect, useMemo, useState } from 'react'
import { useToday } from '../../hooks/useToday'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { AppColors } from '../../context/AppContext'
import { listSimilarPublicDesks, SimilarPublicDeskItem } from '../../services/desks'
import { getBlockedUserIds } from '../../services/moderationService'
import { UI_METRICS } from '../../constants/ui'
import { Gadget, PlanPurpose } from '../../types'
import { localizedDemoDeskName } from '../../utils/localizedDemoDesk'
import { publicDeskUpdateBadge } from '../../utils/publicDeskFeed'
import { DeskGridTile } from '../molecules/DeskGridTile'

/** 横並びのタイル1枚の幅。GadgetPublicDesks と揃える */
const CARD_WIDTH = 148

interface Props {
  deskId: string
  ownerId: string | null
  gadgets: readonly Gadget[]
  purposes?: readonly PlanPurpose[]
  colors: AppColors
  lang: 'ja' | 'en'
  isDark: boolean
  fmtPrice: (n: number | null | undefined) => string
  /** タイルは memo なので、呼び出し側で useCallback したものを渡す */
  onOpenDesk: (deskId: string) => void
}

export function SimilarPublicDesks({
  deskId, ownerId, gadgets, purposes, colors: C, lang, isDark, fmtPrice, onOpenDesk,
}: Props) {
  const ja = lang === 'ja'
  useToday()
  const [items, setItems] = useState<SimilarPublicDeskItem[]>([])

  // 機材の配列は再描画のたびに作り直されうる。中身が同じなら問い合わせ直さない
  const gearKey = useMemo(
    () => gadgets.map((g) => `${g.category}\t${g.name}`).sort().join('\n'),
    [gadgets],
  )
  const purposeKey = (purposes ?? []).join(',')

  useEffect(() => {
    let alive = true
    const pairs = gearKey ? gearKey.split('\n').map((line) => {
      const [category, name] = line.split('\t')
      return { category, name }
    }) : []
    Promise.all([
      listSimilarPublicDesks({
        gadgets: pairs,
        purposes: purposeKey ? purposeKey.split(',') : [],
        excludeDeskId: deskId,
        excludeUserId: ownerId,
      }),
      getBlockedUserIds(),
    ])
      .then(([rows, blockedIds]) => {
        if (alive) setItems(rows.filter((row) => !blockedIds.has(row.user_id)))
      })
      // 089 を当てる前のサーバーでも画面は開ける。段ごと出さないだけにする
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [deskId, ownerId, gearKey, purposeKey])

  // 1件も無いときは見出しごと出さない（GadgetPublicDesks と同じ理由）
  if (items.length === 0) return null

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: C.text }]}>
        {ja ? 'このデスクに近いデスク' : 'Similar desks'}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // 一覧は左右に余白を持つ。横に流す段だけ画面端まで出して、2枚目が途中で切れて見えるようにする
        style={styles.bleed}
        contentContainerStyle={styles.row}
      >
        {items.map((item) => {
          const photo = [...(item.desk_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]
          const reason = item.shared_gadgets > 0
            ? (ja ? `同じ機材 ${item.shared_gadgets}点` : `${item.shared_gadgets} shared ${item.shared_gadgets === 1 ? 'item' : 'items'}`)
            : (ja ? '同じ用途' : 'Same purpose')
          return (
            <View key={item.id} style={styles.card}>
              <DeskGridTile
                compact
                id={item.id}
                title={localizedDemoDeskName(item.id, item.title, lang)}
                photoUri={photo?.image_url}
                purposes={item.purposes as PlanPurpose[] | undefined}
                authorName={item.owner_name}
                authorTag={item.owner_tag}
                authorAvatarUrl={item.owner_avatar_url}
                meta={reason}
                updatedLabel={publicDeskUpdateBadge(item, lang)}
                lang={lang}
                fmtPrice={fmtPrice}
                colors={C}
                isDark={isDark}
                onPress={onOpenDesk}
              />
            </View>
          )
        })}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: 24 },
  title: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  bleed: { marginHorizontal: -UI_METRICS.screenGutter },
  row: { gap: 10, paddingVertical: 2, paddingHorizontal: UI_METRICS.screenGutter },
  // DeskGridTile の compact は flex: 1 で親の幅を埋める作り（2列グリッドの1枠）
  card: { width: CARD_WIDTH, flexDirection: 'row' },
})
