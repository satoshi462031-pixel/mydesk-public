import { CableType, DeskPlan, Gadget, GadgetCategory } from '../types'

type ArmKind = 'monitor' | 'mic'

export type ArmAssignmentSnapshot = Array<{
  kind: ArmKind
  targetId: string
  assignment: string | null | undefined
}>

type DetachResult = {
  monitorArmAssignments: DeskPlan['monitorArmAssignments']
  micArmAssignments: DeskPlan['micArmAssignments']
  snapshot: ArmAssignmentSnapshot
  affectedTargetIds: string[]
}

type ArmConfig = {
  kind: ArmKind
  targetCategory: GadgetCategory
  armCategory: GadgetCategory
  cableType: CableType
  assignments: Record<string, string | null> | undefined
  removingTarget: boolean
}

function armConfig(plan: DeskPlan, gadget: Gadget): ArmConfig | null {
  if (gadget.category === 'Monitor' || gadget.category === 'MonitorArm') {
    return {
      kind: 'monitor',
      targetCategory: 'Monitor',
      armCategory: 'MonitorArm',
      cableType: 'MonitorArm',
      assignments: plan.monitorArmAssignments,
      removingTarget: gadget.category === 'Monitor',
    }
  }
  if (gadget.category === 'Microphone' || gadget.category === 'MicArm') {
    return {
      kind: 'mic',
      targetCategory: 'Microphone',
      armCategory: 'MicArm',
      cableType: 'MicArm',
      assignments: plan.micArmAssignments,
      removingTarget: gadget.category === 'Microphone',
    }
  }
  return null
}

/** モニター／マイクと各アームをデスクから外すとき、支持先だけを安全に切り離す。 */
export function detachArmAssignments(
  plan: DeskPlan,
  gadget: Gadget,
  gadgets: readonly Gadget[],
): DetachResult {
  const config = armConfig(plan, gadget)
  if (!config) {
    return {
      monitorArmAssignments: plan.monitorArmAssignments,
      micArmAssignments: plan.micArmAssignments,
      snapshot: [],
      affectedTargetIds: [],
    }
  }

  const current = config.assignments ?? {}
  const targetIds = new Set(gadgets
    .filter((item) => item.category === config.targetCategory && plan.selectedGadgetIds.includes(item.id))
    .map((item) => item.id))
  const affected = new Set<string>()

  if (config.removingTarget) {
    affected.add(gadget.id)
  } else if (gadget.category === config.armCategory) {
    for (const [targetId, armId] of Object.entries(current)) {
      if (armId === gadget.id && targetIds.has(targetId)) affected.add(targetId)
    }
    for (const connection of plan.connectionMap?.connections ?? []) {
      if (connection.cableType !== config.cableType) continue
      const targetId = connection.fromGadgetId === gadget.id
        ? connection.toGadgetId
        : connection.toGadgetId === gadget.id
          ? connection.fromGadgetId
          : undefined
      if (targetId && targetIds.has(targetId)) affected.add(targetId)
    }
  }

  if (affected.size === 0) {
    return {
      monitorArmAssignments: plan.monitorArmAssignments,
      micArmAssignments: plan.micArmAssignments,
      snapshot: [],
      affectedTargetIds: [],
    }
  }

  const snapshot = [...affected].map((targetId) => ({
    kind: config.kind,
    targetId,
    assignment: Object.prototype.hasOwnProperty.call(current, targetId) ? current[targetId] : undefined,
  }))
  const assignments = { ...current }
  for (const targetId of affected) {
    if (config.removingTarget) delete assignments[targetId]
    else assignments[targetId] = null
  }

  return {
    monitorArmAssignments: config.kind === 'monitor' ? assignments : plan.monitorArmAssignments,
    micArmAssignments: config.kind === 'mic' ? assignments : plan.micArmAssignments,
    snapshot,
    affectedTargetIds: [...affected],
  }
}

/** 「外す」のUndoで、操作前の明示割り当て（未指定を含む）へ戻す。 */
export function restoreArmAssignments(
  monitorArmAssignments: DeskPlan['monitorArmAssignments'],
  micArmAssignments: DeskPlan['micArmAssignments'],
  snapshot: ArmAssignmentSnapshot,
): Pick<DeskPlan, 'monitorArmAssignments' | 'micArmAssignments'> {
  if (snapshot.length === 0) return { monitorArmAssignments, micArmAssignments }
  const monitor = { ...(monitorArmAssignments ?? {}) }
  const mic = { ...(micArmAssignments ?? {}) }
  for (const item of snapshot) {
    const assignments = item.kind === 'monitor' ? monitor : mic
    if (item.assignment === undefined) delete assignments[item.targetId]
    else assignments[item.targetId] = item.assignment
  }
  return { monitorArmAssignments: monitor, micArmAssignments: mic }
}
