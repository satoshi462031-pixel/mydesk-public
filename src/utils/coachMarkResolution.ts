import type { CoachStep } from '../hooks/useCoachMarks'
import { coachVisibleRect, type CoachRect, type CoachViewport } from './coachMarkLayout'

export function resolveCoachSteps(steps: CoachStep[], measured: Map<string, CoachRect[]>, viewport: CoachViewport): (CoachStep & { rect: CoachRect | null })[] {
  const visible = (id: string) => (measured.get(id) ?? []).map(rect => coachVisibleRect(rect, viewport)).find(rect => rect !== null)
  const screen = visible('__screen')
  return steps.flatMap<CoachStep & { rect: CoachRect | null }>(step => {
    if (!step.target) return [{ ...step, rect: null }]
    const within = step.within ? visible(step.within) : null
    if (step.within && !within) return []
    const clips = [...(!step.header && screen ? [screen] : []), ...(within ? [within] : [])]
    const occluders = (step.coveredBy ?? []).flatMap(id => visible(id) ? [visible(id)!] : [])
    const rect = (measured.get(step.target) ?? []).map(candidate => coachVisibleRect(candidate, viewport, occluders, clips)).find(candidate => candidate !== null)
    return rect ? [{ ...step, rect }] : []
  })
}
