import { StyleSheet, Text, View } from 'react-native'
import { AppIcon } from './AppIcon'

export function RecommendedGadgetMark({ color, lang }: { color: string; lang: 'ja' | 'en' }) {
  return (
    <View style={styles.mark}>
      <AppIcon name="thumb-up" size={12} color={color} />
      <Text style={[styles.label, { color }]}>{lang === 'ja' ? 'おすすめ' : 'Recommended'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  mark: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  label: { fontSize: 10, fontWeight: '600' },
})
