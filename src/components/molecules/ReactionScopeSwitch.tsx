import { StyleSheet } from 'react-native'
import { AppColors } from '../../context/AppContext'
import { SegmentedControl } from '../atoms/SegmentedControl'

interface Props {
  value: 'desks' | 'gadgets'
  onChange: (value: 'desks' | 'gadgets') => void
  colors: AppColors
  lang: 'ja' | 'en'
}

export function ReactionScopeSwitch({ value, onChange, lang }: Props) {
  return (
    <SegmentedControl
      options={[
        { key: 'desks', label: lang === 'ja' ? 'デスク' : 'Desks' },
        { key: 'gadgets', label: lang === 'ja' ? 'ガジェット' : 'Gadgets' },
      ]}
      value={value}
      onChange={onChange}
      style={styles.wrap}
    />
  )
}

const styles = StyleSheet.create({
  // 上はマイページのタブバーに直接接するので、他のタブと同じ 12 を空ける。
  // 下は空けない。続く一覧の gap（とブランド行の paddingTop）が持つので、足すと二重になる
  wrap: { marginHorizontal: 16, marginTop: 12 },
})
