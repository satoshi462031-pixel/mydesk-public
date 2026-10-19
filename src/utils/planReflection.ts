type Listener = (active: boolean) => void

const activePlanIds = new Set<string>()
const listeners = new Map<string, Set<Listener>>()
const safetyTimers = new Map<string, ReturnType<typeof setTimeout>>()

function notify(planId: string) {
  const active = activePlanIds.has(planId)
  listeners.get(planId)?.forEach((listener) => listener(active))
}

export function beginPlanReflection(planId: string) {
  activePlanIds.add(planId)
  const previousTimer = safetyTimers.get(planId)
  if (previousTimer) clearTimeout(previousTimer)
  safetyTimers.set(planId, setTimeout(() => endPlanReflection(planId), 20_000))
  notify(planId)
}

export function endPlanReflection(planId: string) {
  activePlanIds.delete(planId)
  const timer = safetyTimers.get(planId)
  if (timer) clearTimeout(timer)
  safetyTimers.delete(planId)
  notify(planId)
}

export function isPlanReflecting(planId: string) {
  return activePlanIds.has(planId)
}

export function subscribePlanReflection(planId: string, listener: Listener) {
  const planListeners = listeners.get(planId) ?? new Set<Listener>()
  planListeners.add(listener)
  listeners.set(planId, planListeners)
  return () => {
    planListeners.delete(listener)
    if (planListeners.size === 0) {
      listeners.delete(planId)
      activePlanIds.delete(planId)
      const timer = safetyTimers.get(planId)
      if (timer) clearTimeout(timer)
      safetyTimers.delete(planId)
    }
  }
}
