import { useFocusEffect } from '@react-navigation/native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useLayoutEffect } from 'react'
import { SafeAreaView, StyleSheet } from 'react-native'
import { INVENTORY_STATS_COACH, InventoryStatsPanel } from '../components/organisms/InventoryStatsPanel'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { COACH_SCREEN, CoachScope, useCoachMarks } from '../hooks/useCoachMarks'
import { useApp } from '../context/AppContext'
import { useGadgets } from '../hooks/useGadgets'
import { MyPageStackParamList } from '../types'

type Props = NativeStackScreenProps<MyPageStackParamList, 'GadgetStats'>

// マイページの持ち物全体を、デスクの構成とは切り離して集計する
export function GadgetStatsScreen({ navigation }: Props) {
  const { gadgets, loading, reload } = useGadgets()
  const { colors, t, lang, fmtPrice } = useApp()
  const coach = useCoachMarks()
  const { open: openCoach, target: coachTarget } = coach
  const openHelp = useCallback(() => { void openCoach(INVENTORY_STATS_COACH) }, [openCoach])
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => (
      <HeaderIconButton name="help-circle-outline" color={colors.text} onPress={openHelp} accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'} />
    ) })
  }, [navigation, colors.text, lang, openHelp])

  useFocusEffect(useCallback(() => {
    reload()
  }, [reload]))

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.container, { backgroundColor: colors.bgList }]}>
      <CoachScope coach={coach}>
      <InventoryStatsPanel
        gadgets={gadgets}
        colors={colors}
        t={t}
        lang={lang}
        fmtPrice={fmtPrice}
        loading={loading}
        onFillPrice={() => { if (navigation.isFocused()) navigation.goBack() }}
      />
      </CoachScope>
      {coach.overlay}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
})
