import { ReactNode, useMemo, useState } from 'react'
import { Dimensions, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { ICON_CHOICE_GROUPS, isIconName, searchIconNames } from '../../constants/customCategoryIcons'
import { categoryIconColor } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { hapticSelection } from '../../utils/haptics'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { DESK_CATEGORY_ICONS, deskCategoryIcon } from '../../constants/deskCategoryIcons'
import { SearchField } from '../atoms/SearchField'

const COLUMNS = 6
const CELL = Math.floor((Dimensions.get('window').width - UI_METRICS.screenGutter * 2) / COLUMNS)

interface Props {
  selected: string
  onSelect: (icon: string) => void
  /** 選んだ枠の色。既定は accent。用途のように色で見分けるものはその色を渡す */
  tint?: string
  /** 検索欄の上に置く内容（名前の入力欄など）。検索欄と同じ面に載る */
  header?: ReactNode
  includeDeskIcons?: boolean
}

interface IconSection {
  key: string
  title: string
  data: string[][]
}

function chunk(names: readonly string[]): string[][] {
  const rows: string[][] = []
  for (let i = 0; i < names.length; i += COLUMNS) rows.push(names.slice(i, i + COLUMNS))
  return rows
}

/**
 * 同梱フォントの全アイコンから1つ選ぶ一覧。自作ジャンルとデスクの用途（その他）が使う。
 * 検索欄が空のときは分類済みの候補、打つと全件から探す（constants/customCategoryIcons.ts）
 */
export function IconSearchGrid({ selected, onSelect, tint, header, includeDeskIcons = false }: Props) {
  const { colors: C, lang, isDark } = useApp()
  const [query, setQuery] = useState('')
  const on = tint ? categoryIconColor('Other', isDark, undefined, tint) : C.accentIcon

  const sections = useMemo<IconSection[]>(() => {
    const trimmed = query.trim()
    if (trimmed) {
      const hits = searchIconNames(trimmed, includeDeskIcons)
      return [{
        key: 'search',
        title: lang === 'ja' ? `${hits.length}件` : `${hits.length} ${hits.length === 1 ? 'icon' : 'icons'}`,
        data: chunk(hits),
      }]
    }
    const groups = includeDeskIcons ? [{
      titleJa: 'デスク環境', titleEn: 'Desk accessories',
      icons: [...DESK_CATEGORY_ICONS.map((icon) => icon.name), 'clock-outline', 'fan', 'air-humidifier', 'led-strip-variant', 'tray-full', 'pen'],
    }, ...ICON_CHOICE_GROUPS] : ICON_CHOICE_GROUPS
    return groups.map((group) => ({
      key: group.titleEn,
      title: lang === 'ja' ? group.titleJa : group.titleEn,
      data: chunk(group.icons),
    }))
  }, [query, lang, includeDeskIcons])

  return (
    <View style={styles.container}>
      <View style={[styles.form, { backgroundColor: C.card, borderBottomColor: C.border }]}>
        {header}
        <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder={lang === 'ja' ? 'アイコンを探す（例：ギター、cat）' : 'Search icons (e.g. guitar)'}
            accessibilityLabel={lang === 'ja' ? 'アイコンを探す' : 'Search icons'}
            onClear={() => setQuery('')}
            clearAccessibilityLabel={lang === 'ja' ? '検索を消す' : 'Clear search'}
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(row) => row[0]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        initialNumToRender={12}
        contentContainerStyle={styles.list}
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionTitle, { color: C.textSub }]}>{section.title}</Text>
        )}
        renderSectionFooter={({ section }) => section.key === 'search' && section.data.length === 0 ? (
          <Text style={[styles.empty, { color: C.textMuted }]}>
            {lang === 'ja'
              ? '見つかりませんでした。英語の単語（guitar、cat など）でも探せます。'
              : 'No icons found. Try another English word.'}
          </Text>
        ) : null}
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map((iconName) => {
              const isOn = iconName === selected
              const deskIcon = includeDeskIcons ? deskCategoryIcon(iconName) : undefined
              if (!deskIcon && !isIconName(iconName)) return null
              return (
                <TouchableOpacity
                  key={iconName}
                  style={styles.cell}
                  onPress={() => { hapticSelection(); onSelect(iconName) }}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isOn }}
                  accessibilityLabel={deskIcon ? (lang === 'ja' ? deskIcon.titleJa : deskIcon.titleEn) : iconName}
                >
                  <View style={[styles.cellInner, { borderColor: isOn ? on : 'transparent', backgroundColor: isOn ? on + '18' : 'transparent' }]}>
                    <CategoryIcon category="Other" customIcon={iconName} size={24} color={isOn ? on : C.text} />
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  form: {
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  list: { paddingHorizontal: UI_METRICS.screenGutter, paddingBottom: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 6, marginLeft: 2 },
  empty: { fontSize: 13, lineHeight: 19, marginTop: 8 },
  row: { flexDirection: 'row' },
  cell: { width: CELL, height: CELL, padding: 3 },
  cellInner: { flex: 1, borderRadius: UI_METRICS.controlRadius, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
})
