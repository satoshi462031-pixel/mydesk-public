import { IconCircleButton } from '../atoms/IconCircleButton'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'
import { CoachStep, useCoachOpen } from '../../hooks/useCoachMarks'

// 数字の横の小さな「？」。画面の「？」と同じ吹き出しで、その数字のところだけを指して説明する
export function HelpTipButton({ steps, label }: { steps: CoachStep[]; label: { ja: string; en: string } }) {
  const { colors, lang } = useApp()
  const open = useCoachOpen()
  if (!open) return null
  return (
    <IconCircleButton
      name="help-circle-outline"
      color={colors.textMuted}
      diameter={UI_METRICS.touchMinSize}
      size={18}
      onPress={() => { void open(steps) }}
      accessibilityLabel={label[lang]}
    />
  )
}
