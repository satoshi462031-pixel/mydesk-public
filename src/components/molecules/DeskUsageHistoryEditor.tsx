import { useRef } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { RemovalMotion, useRemovalMotion } from './RemovalMotion'
import { AppColors } from '../../context/AppContext'
import { DeskGadgetUsageDateSource, DeskGadgetUsageMode, DeskGadgetUsagePeriod } from '../../types'
import { dateFormatHint, formatStoredDate, parseDateInput } from '../../utils/dateFormat'
import { AppIcon } from '../atoms/AppIcon'
import { SegmentedControl } from '../atoms/SegmentedControl'
import { DateField } from './DateField'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'

export interface DeskUsagePeriodDraft {
  mode: DeskGadgetUsageMode
  startedAt: string
  endedAt: string
  /**
   * 読み込んだ時点の値と出所。保存時にこれと突き合わせて、
   * 実際に手で書き換えられた日付だけ 'manual' にする。編集画面を開いて
   * 何も触らず保存しただけで出所が変わると、分析側で区別できなくなる。
   */
  originalStartedAt?: string
  originalEndedAt?: string
  startedAtSource?: DeskGadgetUsageDateSource
  endedAtSource?: DeskGadgetUsageDateSource
}

interface Props {
  value: DeskUsagePeriodDraft[]
  onChange: (value: DeskUsagePeriodDraft[]) => void
  colors: AppColors
  lang: 'ja' | 'en'
  /**
   * 見出しと説明を出すか。デスクごとに何個も並べるときは呼び出し側が
   * デスク名を見出しに持つので、同じ文言が繰り返されないよう畳む。
   */
  showHeading?: boolean
}

export function usagePeriodDrafts(periods: DeskGadgetUsagePeriod[], lang: 'ja' | 'en'): DeskUsagePeriodDraft[] {
  return periods.map((period) => {
    const startedAt = formatStoredDate(period.startedAt, lang)
    const endedAt = formatStoredDate(period.endedAt, lang)
    return {
      mode: period.mode,
      startedAt,
      endedAt,
      originalStartedAt: startedAt,
      originalEndedAt: endedAt,
      startedAtSource: period.startedAtSource,
      endedAtSource: period.endedAtSource,
    }
  })
}

export function parseUsagePeriodDrafts(
  drafts: DeskUsagePeriodDraft[],
  lang: 'ja' | 'en',
): { periods?: DeskGadgetUsagePeriod[]; error?: string } {
  const periods: DeskGadgetUsagePeriod[] = []
  for (const draft of drafts) {
    const startedAt = parseDateInput(draft.startedAt, lang)
    const endedAt = parseDateInput(draft.endedAt, lang)
    if (!startedAt || (draft.endedAt.trim() && !endedAt)) {
      return { error: lang === 'en' ? `Enter valid dates in ${dateFormatHint(lang)} format.` : `実在する日付を ${dateFormatHint(lang)} で入力してください。` }
    }
    if (endedAt && endedAt < startedAt) {
      return { error: lang === 'en' ? 'An end date must be on or after its start date.' : '終了日は開始日以降にしてください。' }
    }
    // 新規行（original が無い）と、読み込み時から変わった日付だけ手入力扱いにする
    const startedSource: DeskGadgetUsageDateSource =
      draft.originalStartedAt === undefined || draft.originalStartedAt !== draft.startedAt
        ? 'manual' : (draft.startedAtSource ?? 'auto')
    const endedSource: DeskGadgetUsageDateSource =
      draft.originalEndedAt === undefined || draft.originalEndedAt !== draft.endedAt
        ? 'manual' : (draft.endedAtSource ?? 'auto')
    periods.push({
      mode: draft.mode,
      startedAt,
      endedAt,
      startedAtSource: startedSource,
      ...(endedAt ? { endedAtSource: endedSource } : {}),
    })
  }
  periods.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  for (let i = 1; i < periods.length; i++) {
    const previous = periods[i - 1]
    if (!previous.endedAt || periods[i].startedAt < previous.endedAt) {
      return { error: lang === 'en' ? 'Usage periods cannot overlap.' : '利用期間が重ならないようにしてください。' }
    }
  }
  return { periods }
}

export function DeskUsageHistoryEditor({ value, onChange, colors, lang, showHeading = true }: Props) {
  const ja = lang === 'ja'
  const removal = useRemovalMotion()
  const ids = useRef(new WeakMap<DeskUsagePeriodDraft, string>())
  const sequence = useRef(0)
  const latest = useRef(value)
  latest.current = value
  const rowKey = (period: DeskUsagePeriodDraft) => {
    let key = ids.current.get(period)
    if (!key) {
      key = String(++sequence.current)
      ids.current.set(period, key)
    }
    return key
  }
  const update = (index: number, patch: Partial<DeskUsagePeriodDraft>) => {
    onChange(value.map((period, i) => {
      if (i !== index) return period
      const next = { ...period, ...patch }
      ids.current.set(next, rowKey(period))
      return next
    }))
  }

  return (
    // 見出しを畳むときは呼び出し側が間隔を持つので、上の余白も落とす
    <View style={showHeading ? styles.section : undefined}>
      {showHeading && (
        <>
          <Text style={[styles.title, { color: colors.textSub }]}>{ja ? 'デスクでの利用履歴' : 'Desk usage history'}</Text>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            {ja ? '使用中・飾りだった期間を古い順に入力します。終了日が空欄の期間が現在の状態です。' : 'Add active and decor periods in chronological order. Leave the current period end date blank.'}
          </Text>
        </>
      )}
      {value.map((period, index) => {
        const key = rowKey(period)
        return (
        <RemovalMotion key={key} ref={(handle) => removal.setRef(key, handle)}>
        <View style={[styles.card, { backgroundColor: colors.input, borderColor: colors.inputBorder }]}>
          <View style={styles.cardHead}>
            <SegmentedControl
              options={(['active', 'decor'] as const).map((mode) => ({
                key: mode,
                label: mode === 'active' ? (ja ? '使用中' : 'Active') : (ja ? '飾り' : 'Decor'),
              }))}
              value={period.mode}
              onChange={(mode) => update(index, { mode })}
              style={styles.segment}
            />
            <TouchableOpacity
              onPress={() => {
                void removal.run(key, () => {
                  const next = latest.current.filter((item) => rowKey(item) !== key)
                  latest.current = next
                  onChange(next)
                }, 'fade')
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={ja ? 'この期間を削除' : 'Delete this period'}
            >
              <AppIcon name={ICONS.close} size={19} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.dateFields}>
            <View style={styles.dateField}>
              <Text style={[styles.dateLabel, { color: colors.textMuted }]}>{ja ? '開始日' : 'Start'}</Text>
              <DateField
                size="compact"
                value={period.startedAt}
                onChange={(startedAt) => update(index, { startedAt })}
                label={ja ? '開始日' : 'Start date'}
              />
            </View>
            <Text style={[styles.arrow, { color: colors.textMuted }]}>→</Text>
            <View style={styles.dateField}>
              <Text style={[styles.dateLabel, { color: colors.textMuted }]}>{ja ? '終了日（任意）' : 'End (optional)'}</Text>
              <DateField
                size="compact"
                value={period.endedAt}
                onChange={(endedAt) => update(index, { endedAt })}
                label={ja ? '終了日' : 'End date'}
              />
            </View>
          </View>
        </View>
        </RemovalMotion>
      )})}
      <TouchableOpacity
        style={[styles.addButton, { borderColor: colors.inputBorder }]}
        onPress={() => onChange([...value, { mode: 'active', startedAt: '', endedAt: '' }])}
        accessibilityRole="button"
      >
        <AppIcon name={ICONS.add} size={18} color={colors.accentText} />
        <Text style={[styles.addText, { color: colors.accentText }]}>{ja ? '期間を追加' : 'Add period'}</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  section: { marginTop: 16 },
  title: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  hint: { fontSize: 11, lineHeight: 16, marginBottom: 8 },
  card: { borderWidth: 1, borderRadius: UI_METRICS.controlRadius, padding: 10, marginBottom: 8 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  // 2択は文字の幅で足りる。行いっぱいに伸ばすと右の削除ボタンと並ばない
  segment: { width: 160 },
  dateFields: { flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
  dateField: { flex: 1 },
  dateLabel: { fontSize: 10, marginBottom: 4 },
  arrow: { paddingBottom: 9, fontSize: 12 },
  addButton: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 9, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  addText: { fontSize: 13, fontWeight: '700' },
})
