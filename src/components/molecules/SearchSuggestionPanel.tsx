import { memo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { AppColors } from '../../context/AppContext'
import { purposeIcon, purposeIconColor } from '../../screens/PurposeSelectionScreen'
import { PlanPurpose } from '../../types'
import { SearchSuggestion, SearchSuggestionKind } from '../../utils/publicSearchSuggestions'

interface Props {
  suggestions: readonly SearchSuggestion[]
  recentQueries?: readonly string[]
  onClearHistory?: () => void
  colors: AppColors
  isDark: boolean
  lang: 'ja' | 'en'
  onSelect: (query: string) => void
}

const KIND_LABELS: Record<SearchSuggestionKind, { ja: string; en: string }> = {
  purpose: { ja: '用途', en: 'Purpose' },
  category: { ja: 'ジャンル', en: 'Category' },
  brand: { ja: 'ブランド', en: 'Brand' },
  gear: { ja: '機材', en: 'Gear' },
}

/**
 * みんなのデスクの検索欄の下に開く予測。打ちかけの語の続きと、打ち間違いに近い語を並べる。
 * 押すとその語で検索し直す（語を欄に入れるだけにすると、もう一度確定を押させることになる）。
 */
export const SearchSuggestionPanel = memo(function SearchSuggestionPanel({
  suggestions, recentQueries = [], onClearHistory, colors: C, isDark, lang, onSelect,
}: Props) {
  const ja = lang === 'ja'
  return (
    <View style={[styles.panel, { backgroundColor: C.card, borderColor: C.border }]}>
      {recentQueries.length > 0 && <>
        <View style={styles.historyHeader}>
          <Text style={[styles.historyTitle, { color: C.textSub }]}>{ja ? '最近の検索' : 'Recent searches'}</Text>
          {onClearHistory && <TouchableOpacity onPress={onClearHistory} style={styles.clearHistory} accessibilityRole="button" accessibilityLabel={ja ? '検索履歴を消去' : 'Clear search history'}>
            <Text style={[styles.kind, { color: C.accentText }]}>{ja ? '消去' : 'Clear'}</Text>
          </TouchableOpacity>}
        </View>
        {recentQueries.map((query, index) => (
          <TouchableOpacity
            key={query}
            style={[styles.row, (index < recentQueries.length - 1 || suggestions.length > 0) && { borderBottomColor: C.separator, borderBottomWidth: StyleSheet.hairlineWidth }]}
            onPress={() => onSelect(query)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={ja ? query + 'で再検索' : 'Search again for ' + query}
          >
            <View style={styles.iconSlot}><AppIcon name={ICONS.history} size={18} color={C.textMuted} centered /></View>
            <Text style={[styles.label, { color: C.text }]} numberOfLines={1}>{query}</Text>
          </TouchableOpacity>
        ))}
      </>}
      {suggestions.map((suggestion, index) => {
        const { entry } = suggestion
        const kind = ja ? KIND_LABELS[entry.kind].ja : KIND_LABELS[entry.kind].en
        return (
          <TouchableOpacity
            key={suggestion.query}
            style={[
              styles.row,
              index < suggestions.length - 1 && { borderBottomColor: C.separator, borderBottomWidth: StyleSheet.hairlineWidth },
            ]}
            onPress={() => onSelect(suggestion.query)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={ja
              ? `${suggestion.query}（${kind}）で検索`
              : `Search for ${suggestion.query} (${kind})`}
          >
            <View style={styles.iconSlot}>
              {entry.kind === 'purpose' ? (
                <AppIcon
                  name={purposeIcon(entry.key as PlanPurpose)}
                  size={18}
                  color={purposeIconColor(entry.key as PlanPurpose, isDark)}
                  centered
                />
              ) : entry.kind === 'brand' ? (
                <AppIcon name={ICONS.tag} size={18} color={C.accentText} centered />
              ) : (
                <CategoryIcon category={entry.key} size={18} color={categoryIconColor(entry.key, isDark)} />
              )}
            </View>
            <Text style={[styles.label, { color: C.text }]} numberOfLines={1}>{suggestion.query}</Text>
            <Text style={[styles.kind, { color: C.textMuted }]} numberOfLines={1}>{kind}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
})

const styles = StyleSheet.create({
  panel: {
    borderRadius: UI_METRICS.panelRadius,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    minHeight: UI_METRICS.touchMinSize,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  historyHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: 12 },
  historyTitle: { flex: 1, fontSize: 12, fontWeight: '600' },
  clearHistory: { minHeight: UI_METRICS.touchMinSize, minWidth: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  iconSlot: { width: 22, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, minWidth: 0, fontSize: 14 },
  kind: { fontSize: 12 },
})
