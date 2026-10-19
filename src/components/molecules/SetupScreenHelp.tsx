import { ReactNode, useCallback, useLayoutEffect } from 'react'
import { useNavigation, useRoute } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { ParamListBase } from '@react-navigation/native'
import { HeaderIconButton } from '../atoms/HeaderIconButton'
import { useApp } from '../../context/AppContext'
import { useSpotlight, useSpotlightRegistry } from '../../context/SpotlightContext'
import { SPOTLIGHT_STEPS, isStepOnRoute, type SpotlightTargetId } from '../../constants/spotlightSteps'
import { setupCoachStepsForRoute } from '../../constants/setupCoachSteps'
import { CoachScope, useCoachMarks } from '../../hooks/useCoachMarks'

export function SetupScreenHelp({ children }: { children?: ReactNode } = {}) {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>()
  const { name } = useRoute()
  const { colors, lang } = useApp()
  const { running, stepIndex, acknowledge } = useSpotlight()
  const { measureTarget } = useSpotlightRegistry()
  const measure = useCallback((id: string) => measureTarget(id as SpotlightTargetId), [measureTarget])
  const coach = useCoachMarks(measure)
  const { open, overlay } = coach
  const openHelp = useCallback(() => {
    // 写しに初回ガイドが重ならないよう、説明を閉じてから撮影する。
    if (running && isStepOnRoute(SPOTLIGHT_STEPS[stepIndex], name)) acknowledge()
    void open(setupCoachStepsForRoute(name))
  }, [running, stepIndex, acknowledge, open, name])
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => (
      <HeaderIconButton name="help-circle-outline" color={colors.text} onPress={openHelp}
        accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'} />
    ) })
  }, [navigation, colors.text, lang, openHelp])
  return <CoachScope coach={coach}>{children}{overlay}</CoachScope>
}
