import { useRef, useState } from 'react'
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native'
import { useApp } from '../../context/AppContext'
import { UI_METRICS } from '../../constants/ui'
import { SegmentHighlight } from './SegmentHighlight'
import { hapticSelection } from '../../utils/haptics'

export interface SegmentOption<K extends string | number> {
  key: K
  label: string
  /** 読み上げで label だけでは足りないとき（「L」→「入力側 L」など） */
  accessibilityLabel?: string
}

interface Props<K extends string | number> {
  options: readonly SegmentOption<K>[]
  value: K
  onChange: (key: K) => void
  /** 幅・余白・配置だけを渡す。地の色や角丸は部品が持つ */
  style?: StyleProp<ViewStyle>
  compact?: boolean
  accessibilityLabel?: string
}

// 2〜4択を1つ選ぶ切り替え。iOS のセグメントと同じ見た目（中立の地＋選ばれた側が浮く）にそろえる。
// 以前は画面ごとに、枠付きのチップ・accent 塗り・浮いた面と選択の見せ方が割れていて、
// 同じ「1つ選ぶ」が画面によって別の部品に見えた
export function SegmentedControl<K extends string | number>({ options, value, onChange, style, compact = false, accessibilityLabel }: Props<K>) {
  const { colors: C } = useApp()
  const selectedRef = useRef(value)
  selectedRef.current = value
  const [barWidth, setBarWidth] = useState(0)
  return (
    <View
      style={[styles.track, { backgroundColor: C.segmentTrack }, style]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      onLayout={(event) => {
        const width = event.nativeEvent.layout.width
        setBarWidth((previous) => Math.abs(previous - width) < 0.5 ? previous : width)
      }}
    >
      <SegmentHighlight
        count={options.length}
        index={options.findIndex((option) => option.key === value)}
        barWidth={barWidth}
        color={C.segmentSelected}
        inset={2}
      />
      {options.map((option) => {
        const selected = option.key === value
        return (
          <TouchableOpacity
            key={String(option.key)}
            style={[styles.segment, compact && styles.compactSegment]}
            onPress={() => {
              if (selectedRef.current !== option.key) hapticSelection()
              selectedRef.current = option.key
              onChange(option.key)
            }}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
          >
            <Text
              style={[styles.label, compact && styles.compactLabel, { color: selected ? C.text : C.textSub, fontWeight: selected ? '700' : '500' }]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: UI_METRICS.controlRadius, padding: 2 },
  segment: {
    flex: 1, minHeight: 32, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 8, borderRadius: UI_METRICS.chipRadius,
  },
  compactSegment: { paddingHorizontal: 2 },
  label: { fontSize: 13 },
  compactLabel: { fontSize: 12 },
})
