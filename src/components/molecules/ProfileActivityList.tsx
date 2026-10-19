import { memo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { categoryIconColor, MCIconName } from '../../constants/icons'
import { AppColors } from '../../context/AppContext'
import { UI_METRICS } from '../../constants/ui'
import { DeskChangeKind } from '../../utils/deskChangeSummary'
import { formatStoredDate } from '../../utils/dateFormat'
import { ProfileActivityEntry } from '../../utils/profileActivity'

// ─── 公開プロフィールの「最近の変化」 ────────────────────────────────
// タイルは1〜3件で終わって静止しているが、機材は入れ替わっている。
// デスクをまたいだ変更を日付順に並べて、その人が動いていることを先に見せる。
//
// 1行に出すのは一番高い1件だけ。同じ日に3台動いても行を増やさない（残りは「他N点」）。
// 行を増やすと、デスクが1件しかない人のページが変更ログで埋まってタイルが押し出される。
//
// 絵はタイルの変更ブロックと同じカテゴリアイコン。同じ出来事を2つの見た目で
// 出すと、別のものが起きたように読める。

const CHANGE_MARK: Record<DeskChangeKind, MCIconName> = {
  swap: 'swap-horizontal',
  added: 'plus',
  removed: 'minus',
}

interface Props {
  entries: ProfileActivityEntry[]
  colors: AppColors
  isDark: boolean
  lang: 'ja' | 'en'
  /** デスクを開く。行ごとに関数を作らないよう deskId を受け取る形にする */
  onPress: (deskId: string) => void
}

export const ProfileActivityList = memo(function ProfileActivityList({
  entries, colors: C, isDark, lang, onPress,
}: Props) {
  const ja = lang === 'ja'
  if (entries.length === 0) return null

  return (
    <View style={styles.wrap}>
      <Text style={[styles.heading, { color: C.text }]}>
        {ja ? '最近の変化' : 'Recent changes'}
      </Text>
      {entries.map((entry) => {
        const head = entry.changes[0]
        const rest = entry.changes.length - 1
        const name = head.kind === 'swap' && head.fromName ? `${head.fromName} → ${head.name}` : head.name
        return (
          <TouchableOpacity
            key={entry.key}
            style={[styles.row, { borderTopColor: C.separator }]}
            onPress={() => onPress(entry.deskId)}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <View style={[styles.icon, { borderColor: C.border }]}>
              <CategoryIcon category={head.category} pcFormFactor={head.pcFormFactor} customIcon={head.customCategory?.icon} size={16} color={categoryIconColor(head.category, isDark, undefined, head.customCategory?.color)} />
            </View>
            <View style={styles.body}>
              <View style={styles.nameRow}>
                <AppIcon name={CHANGE_MARK[head.kind]} size={12} color={C.textMuted} />
                <Text style={[styles.name, { color: C.text }]} numberOfLines={1}>{name}</Text>
              </View>
              <Text style={[styles.meta, { color: C.textMuted }]} numberOfLines={1}>
                {[
                  entry.deskTitle,
                  formatStoredDate(entry.date, lang),
                  rest > 0 ? (ja ? `他${rest}点` : `+${rest} more`) : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </TouchableOpacity>
        )
      })}
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: { marginTop: 20 },
  heading: { fontSize: 15, lineHeight: 20, fontWeight: '700', marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  icon: {
    width: 30, height: 30, borderRadius: UI_METRICS.chipRadius, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  meta: { fontSize: 12, lineHeight: 17 },
})
