import { StyleSheet, Text, View } from 'react-native'
import { useApp } from '../../context/AppContext'
import { AppIcon } from '../atoms/AppIcon'
import { Button } from '../atoms/Button'
import { ICONS } from '../../constants/icons'

export function RetryState({ message, onRetry, disabled = false }: { message: string; onRetry: () => void; disabled?: boolean }) {
  const { colors: C, lang } = useApp()
  return (
    <View style={[styles.wrap, { backgroundColor: C.bgList }]} accessibilityRole="alert">
      <AppIcon name="alert-circle-outline" size={34} color={C.danger} />
      <Text style={[styles.message, { color: C.textSub }]}>{message}</Text>
      <Button
        title={lang === 'ja' ? 'もう一度試す' : 'Try again'}
        size="compact"
        shape="control"
        leading={<AppIcon name={ICONS.retry} size={18} color={C.onAccent} />}
        onPress={onRetry}
        disabled={disabled}
        accessibilityLabel={lang === 'ja' ? 'もう一度試す' : 'Try again'}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
})
