import { useCallback, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { loadFirstSetupDraft } from '../store/firstSetupStore'
import { Alert } from '../utils/alert'
import { compositionFromPlan, compositionTemplateId } from '../utils/deskComposition'
import { firstSetupResumeNavigation, resolveFirstSetupDraft } from '../utils/firstSetupResume'
import { openInTabFromRoot } from '../utils/tabNavigation'
import { useGadgets } from './useGadgets'
import { usePlans } from './usePlans'

export function useDeskSetupGuard(navigation: Parameters<typeof openInTabFromRoot>[0]) {
  const { lang } = useApp()
  const { plans, loading, loadError } = usePlans()
  const { gadgets } = useGadgets()
  const latest = useRef({ plans, loading, loadError, gadgets })
  latest.current = { plans, loading, loadError, gadgets }
  const checking = useRef(false)

  return useCallback(async (): Promise<boolean> => {
    if (checking.current || !navigation.isFocused()) return false
    checking.current = true
    let awaitingChoice = false
    try {
      const stored = await loadFirstSetupDraft()
      if (!navigation.isFocused()) return false
      const current = latest.current
      if (current.loading || current.loadError) {
        Alert.alert(lang === 'ja' ? 'デスクを読み込めませんでした' : 'Desks are not ready',
          lang === 'ja' ? 'マイデスクで読み込みを確認してから、もう一度お試しください。' : 'Check My Desks and try again after the desks load.')
        return false
      }
      const draft = resolveFirstSetupDraft(stored, current.plans)
      if (!draft) return true
      const plan = 'planId' in draft ? current.plans.find((item) => item.id === draft.planId) : undefined
      const target = firstSetupResumeNavigation(draft)
      const close = () => { checking.current = false }
      const resume = () => {
        close()
        if (target.name === 'GadgetSelection' && plan) {
          const composition = compositionFromPlan(plan, latest.current.gadgets)
          openInTabFromRoot(navigation, 'PlanTab', 'TemplateDetail', {
            templateId: compositionTemplateId(composition), composition, returnPlanId: plan.id,
            purposes: plan.purposes ?? [], otherPurposeLabel: plan.otherPurposeLabel,
            otherPurposeIcon: plan.otherPurposeIcon, otherPurposeColor: plan.otherPurposeColor,
          })
        } else {
          openInTabFromRoot(navigation, 'PlanTab', target.name, target.params)
        }
      }
      awaitingChoice = true
      Alert.alert(
        lang === 'ja' ? '作成途中のデスクがあります' : 'You have an unfinished desk',
        lang === 'ja'
          ? '一度に作成できるデスクは1件です。作成を続けるか、マイデスクで途中のデスクを破棄してから新しく作成してください。'
          : 'Set up one desk at a time. Continue this setup, or discard it in My Desks before creating another desk.',
        [
          { text: lang === 'ja' ? 'キャンセル' : 'Cancel', style: 'cancel', onPress: close },
          { text: lang === 'ja' ? '作成を続ける' : 'Continue setup', onPress: resume },
        ],
        { onDismiss: close },
      )
      return false
    } finally {
      if (!awaitingChoice) checking.current = false
    }
  }, [lang, navigation])
}
