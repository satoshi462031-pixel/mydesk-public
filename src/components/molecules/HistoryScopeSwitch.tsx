import { StyleSheet, View } from 'react-native'
import { UI_METRICS } from '../../constants/ui'
import { SegmentedControl } from '../atoms/SegmentedControl'

export type HistoryScope = 'viewed' | 'clapped'

interface Props {
  value: HistoryScope
  onChange: (value: HistoryScope) => void
  lang: 'ja' | 'en'
}

// マイページの履歴タブの「見た／拍手した」。タブを初めて開くときの骨組み（MyPageScreen）にも
// 同じものを出すので部品にしている。別々に書くと、骨組みから本物へ替わる瞬間に位置や文言がずれる
export function HistoryScopeSwitch({ value, onChange, lang }: Props) {
  const ja = lang === 'ja'
  return (
    <View style={styles.wrap}>
      <SegmentedControl
        options={[
          { key: 'viewed', label: ja ? '見た' : 'Viewed' },
          { key: 'clapped', label: ja ? '拍手した' : 'Applauded' },
        ]}
        value={value}
        onChange={onChange}
        accessibilityLabel={ja ? '履歴の種類' : 'History type'}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: UI_METRICS.screenGutter, paddingTop: 12 },
})
