import { useIsFocused, useRoute } from '@react-navigation/native'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SPOTLIGHT_STEPS, isStepOnRoute, spotlightBodyForRoute } from '../../constants/spotlightSteps'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { useSpotlight } from '../../context/SpotlightContext'

export function SetupGuide() {
  const { colors, lang } = useApp()
  const { running, stepIndex, finish } = useSpotlight()
  const { name } = useRoute()
  const focused = useIsFocused()
  const step = SPOTLIGHT_STEPS[stepIndex]

  if (!running || !focused || step.presentation !== 'inline' || !isStepOnRoute(step, name)) return null
  const body = spotlightBodyForRoute(step, name)
  const language = lang === 'en' ? 'en' : 'ja'

  return (
    <View style={styles.guide}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>{step.title[language]}</Text>
        <TouchableOpacity
          onPress={() => finish({ outcome: 'skipped' })}
          style={styles.skip}
          accessibilityRole="button"
          accessibilityLabel={language === 'en' ? 'End the setup guide' : '使い方ガイドを終了'}
        >
          <Text style={[styles.skipText, { color: colors.textMuted }]}>
            {language === 'en' ? 'End guide' : 'ガイドを終了'}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.body, { color: colors.textSub }]}>{body[language]}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  guide: { gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  skip: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center' },
  skipText: { fontSize: 12, lineHeight: 17 },
  body: { fontSize: 12, lineHeight: 18 },
})
