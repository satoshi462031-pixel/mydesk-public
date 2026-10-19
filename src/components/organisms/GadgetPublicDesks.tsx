// ガジェット詳細から「同じものを使っている公開デスク」へ逆引きする。
//
// 配線図はマウス・キーボードのような単体で完結するガジェットには何も言えない。
// 互換性の制約が無く、天板幅も他の機材も関係しないので、ポート不足や構成の近さから
// は出てこない。真似したいかどうかを決めるのは写真とその人なので、この一覧は
// 写真のあるデスクだけを横に並べる（写真の無いデスクは listPublicDesksWithGadget が落とす）。
//
// 並べるのは他の一覧と同じ DeskGridTile の compact。ここだけ別の見た目にすると
// 同じ「デスク1件」に見えなくなる（公開プロフィールと同じ理由）。
//
// 見出しの件数は総数で、並んでいるタイルの数とは一致しないことがある。数のほうが
// 「何人が使っているか」の答えなので、引けた件数に丸めない。
import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextStyle, StyleProp, View, ViewStyle } from 'react-native'
import { AppColors } from '../../context/AppContext'
import { useAuth } from '../../context/AuthContext'
import { listPublicDesksWithGadget, PublicDeskListItem } from '../../services/desks'
import { getBlockedUserIds } from '../../services/moderationService'
import { Gadget, PlanPurpose } from '../../types'
import { formatDate } from '../../utils/dateFormat'
import { localizedDemoDeskName } from '../../utils/localizedDemoDesk'
import { publicDeskUpdateBadge } from '../../utils/publicDeskFeed'
import { useToday } from '../../hooks/useToday'
import { DeskGridTile } from '../molecules/DeskGridTile'

/** 横並びのタイル1枚の幅。2枚目の左端が必ず見えて、横へ流せると分かる幅 */
const CARD_WIDTH = 148

interface Props {
  gadget: Gadget | null
  /** シートが出ているか。閉じている間は問い合わせを走らせない */
  visible: boolean
  /** 今開いているデスク。同じデスクを「他のデスク」として並べない */
  excludeDeskId?: string
  colors: AppColors
  lang: 'ja' | 'en'
  isDark: boolean
  fmtPrice: (n: number | null | undefined) => string
  /**
   * 段そのものの体裁。1件も無いときはこの View ごと出さないので、区切り線や
   * 余白を持つ枠は呼び出し側で巻かずにここへ渡す（巻くと空の帯が残る）
   */
  style?: StyleProp<ViewStyle>
  /** 見出しの字面は開く側のシートに合わせる（シートとモーダルで見出しの流儀が違う） */
  titleStyle?: StyleProp<TextStyle>
  /** タイルは memo なので、呼び出し側で useCallback したものを渡す */
  onOpenDesk: (deskId: string) => void
}

export function GadgetPublicDesks({
  gadget, visible, excludeDeskId, colors: C, lang, isDark, fmtPrice, style, titleStyle, onOpenDesk,
}: Props) {
  const ja = lang === 'ja'
  useToday()
  const { user } = useAuth()
  const [items, setItems] = useState<PublicDeskListItem[]>([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!visible || !gadget) {
      setItems([])
      setTotal(0)
      return
    }
    let alive = true
    Promise.all([
      listPublicDesksWithGadget({
        name: gadget.name,
        category: gadget.category,
        excludeDeskId,
        excludeUserId: user?.id,
      }),
      getBlockedUserIds(),
    ])
      .then(([result, blockedIds]) => {
        if (!alive) return
        // ブロックはサーバー側で結合できないのでここで落とす。総数のほうは
        // 落とした数を引かない（引くと、ブロックした相手が何人いるかが漏れる）
        setItems(result.items.filter((item) => !blockedIds.has(item.user_id)))
        setTotal(result.total)
      })
      .catch(() => {
        if (!alive) return
        setItems([])
        setTotal(0)
      })
    return () => {
      alive = false
    }
  }, [visible, gadget, excludeDeskId, user?.id])

  // 1件も無いときは見出しごと出さない。「0件」と書くと、まだ誰も登録していないのか
  // 引けなかったのかが読めず、シートに空の段が増えるだけになる
  if (items.length === 0) return null

  return (
    <View style={style}>
      <Text style={titleStyle}>
        {ja ? `このガジェットを使っているデスク (${total})` : `Desks using this gadget (${total})`}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((item) => {
          const photo = [...(item.desk_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]
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
                meta={formatDate(new Date(item.updated_at), lang)}
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
  row: { gap: 10, paddingVertical: 2 },
  // DeskGridTile の compact は flex: 1 で親の幅を埋める作り（2列グリッドの1枠）。
  // 横並びでは幅を固定した行として渡す
  card: { width: CARD_WIDTH, flexDirection: 'row' },
})
