import { StyleSheet, Text, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { ICONS, MCIconName } from '../../constants/icons'
import { AppColors } from '../../context/AppContext'
import { isOutdatedPublishState, PlanPublishState } from '../../services/publishService'

// ─── 公開の状態バッジ ────────────────────────────────────────────
//
// 「更新あり」だけ塗りにして一段強くする。公開中は事実の表示で行動を求めないが、
// 更新ありは「押さないと公開ページが古いまま」という未了の状態だから。
// 一度も公開していないデスクには既定で何も出さない（大半がそれで、印だらけになる）。
// マイページの「デスク」タブは公開中・URL限定・未公開が同じ一覧に混ざるので、
// showNone で未公開にも印を付ける。そこでは「出ていない＝未公開」が読み取れない。
//
// 公開中と URL限定は、色だけでなく絵と文字で分ける。地球（みんなに見える）と
// 鎖（リンクを持っている人だけ）。「更新あり」でも URL限定であることは消さない。
//
// デスク画面では出さない。そこではフッターの公開ボタンの文言が同じ状態を示している。

const CONFIG: Record<PlanPublishState, { icon: MCIconName; ja: string; en: string }> = {
  outdated:          { icon: 'cloud-upload-outline', ja: '更新あり',          en: 'Update' },
  unlisted_outdated: { icon: 'cloud-upload-outline', ja: 'URL限定・更新あり', en: 'Unlisted · Update' },
  public:            { icon: ICONS.publish,          ja: '公開中',            en: 'Public' },
  unlisted:          { icon: ICONS.link,             ja: 'URL限定',           en: 'Unlisted' },
  private:           { icon: 'earth-off',            ja: '非公開',            en: 'Private' },
  // lock-outline は Pro 制限の印なので使わない。「まだ誰にも見えていない」を表す
  none:              { icon: 'eye-off-outline',      ja: '未公開',            en: 'Not public' },
}

export function PublishBadge({
  state,
  colors,
  lang,
  showNone = false,
}: {
  state: PlanPublishState
  colors: AppColors
  lang: 'ja' | 'en'
  /** 一度も公開していないデスクにも「未公開」を出す */
  showNone?: boolean
}) {
  if (state === 'none' && !showNone) return null
  const config = CONFIG[state]
  const filled = isOutdatedPublishState(state)
  const bg = filled ? colors.update : colors.chip
  const fg = filled ? colors.onUpdate
    // URL限定は見えている状態なので、非公開・未公開（読み飛ばしてよい）より濃くする
    : state === 'public' || state === 'unlisted' ? colors.textSub
    : colors.textMuted
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <AppIcon name={config.icon} size={11} color={fg} />
      <Text style={[styles.text, { color: fg }]}>{lang === 'ja' ? config.ja : config.en}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  // 共有バッジと同じ形。並んだときに大きさが揃うようにする
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  text: { fontSize: 11, fontWeight: '600' },
})
