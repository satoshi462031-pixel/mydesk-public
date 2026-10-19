import { useRef, useState } from 'react'
import { LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppColors } from '../../context/AppContext'
import { TabUnderline } from '../atoms/TabUnderline'
import { hapticSelection } from '../../utils/haptics'

// 検索結果を種類別に分ける。「すべて」では各種類をまとめて見せ、
// 欲しい対象が決まっている人は個別タブへ移れる。機材は独立した検索対象ではなく、
// デスクのジャンル絞り込みと「すべて」に混ざる検索結果から探す。
export type SearchScope = 'all' | 'desks' | 'people'

const SCOPES: SearchScope[] = ['all', 'desks', 'people']
// 下線は字より狭くして、タブの境目まで伸ばさない
const UNDERLINE_RATIO = 0.56

interface Props {
  value: SearchScope
  onChange: (value: SearchScope) => void
  colors: AppColors
  lang: 'ja' | 'en'
}

export function SearchScopeTabs({ value, onChange, colors: C, lang }: Props) {
  const selectedRef = useRef(value)
  selectedRef.current = value
  const ja = lang === 'ja'
  const labels: Record<SearchScope, string> = {
    all:    ja ? 'すべて' : 'All',
    desks:  ja ? 'デスク' : 'Desks',
    people: ja ? 'ユーザー' : 'People',
  }

  const [barWidth, setBarWidth] = useState(0)

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width
    setBarWidth((prev) => (Math.abs(prev - width) < 0.5 ? prev : width))
  }

  const tabWidth = barWidth / SCOPES.length
  const underlineW = tabWidth * UNDERLINE_RATIO

  return (
    <View
      style={[styles.wrap, { borderBottomColor: C.border }]}
      accessibilityRole="tablist"
      onLayout={handleLayout}
    >
      {SCOPES.map((scope) => {
        const selected = scope === value
        return (
          <TouchableOpacity
            key={scope}
            style={styles.option}
            onPress={() => {
              if (selectedRef.current !== scope) hapticSelection()
              selectedRef.current = scope
              onChange(scope)
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
          >
            <Text style={[styles.label, { color: selected ? C.text : C.textMuted }]} numberOfLines={1}>
              {labels[scope]}
            </Text>
          </TouchableOpacity>
        )
      })}
      <TabUnderline
        count={SCOPES.length}
        index={SCOPES.indexOf(value)}
        barWidth={barWidth}
        color={C.accentIcon}
        width={underlineW}
        bottom={-1}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  option: { flex: 1, alignItems: 'center', paddingVertical: 11 },
  label: { fontSize: 13, fontWeight: '700' },
})
