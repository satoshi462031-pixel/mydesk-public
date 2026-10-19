import { DeskPlan, Gadget } from '../types'
import { baseMapNodeId } from './connectionMapLayout'
import { refreshPlanWiring } from './planWiring'

const connectionTouches = (
  connection: { fromGadgetId: string; toGadgetId: string },
  gadgetId: string,
) => connection.fromGadgetId === gadgetId || connection.toGadgetId === gadgetId

const pairTouches = (pairKey: string, gadgetId: string) => {
  const [pair] = pairKey.split('|', 1)
  return pair?.split('~').includes(gadgetId) ?? false
}

function omitMapNode<T>(values: Record<string, T> | undefined, gadgetId: string): Record<string, T> | undefined {
  if (!values) return values
  return Object.fromEntries(Object.entries(values).filter(([nodeId]) => baseMapNodeId(nodeId) !== gadgetId))
}

export function planReferencesGadget(plan: DeskPlan, gadgetId: string): boolean {
  return plan.selectedGadgetIds.includes(gadgetId)
    || Object.prototype.hasOwnProperty.call(plan.gadgetUsage ?? {}, gadgetId)
    || plan.placements.some((placement) => placement.gadgetId === gadgetId)
    || (plan.wiredOverrides ?? []).includes(gadgetId)
    || Object.entries(plan.monitorArmAssignments ?? {}).some(([id, arm]) => id === gadgetId || arm === gadgetId)
    || Object.entries(plan.micArmAssignments ?? {}).some(([id, arm]) => id === gadgetId || arm === gadgetId)
    || Object.entries(plan.gadgetRelationOverrides ?? {}).some(([id, relation]) =>
      id === gadgetId || relation.mounting?.targetGadgetId === gadgetId
      || relation.powerSourceGadgetId === gadgetId
      || relation.bluetoothTargetGadgetIds?.includes(gadgetId)
      || relation.wirelessTargetGadgetIds?.includes(gadgetId))
    || (plan.wiringResult?.connections ?? []).some((connection) => connectionTouches(connection, gadgetId))
    || (plan.connectionMap?.connections ?? []).some((connection) => connectionTouches(connection, gadgetId))
}

export function removeGadgetReferencesFromGadgets(gadgets: readonly Gadget[], gadgetId: string): Gadget[] {
  return gadgets
    .filter((gadget) => gadget.id !== gadgetId)
    .map((gadget) => {
      let next = gadget
      if (gadget.mounting?.targetGadgetId === gadgetId) {
        const { mounting: _mounting, ...withoutMounting } = next
        next = withoutMounting
      }
      if (next.powerSourceGadgetId === gadgetId) {
        const {
          powerSourceGadgetId: _powerSourceGadgetId,
          powerSourcePortId: _powerSourcePortId,
          ...withoutPowerSource
        } = next
        next = withoutPowerSource
      }
      if (next.wirelessTargetGadgetIds?.includes(gadgetId)) {
        next = { ...next, wirelessTargetGadgetIds: next.wirelessTargetGadgetIds.filter((id) => id !== gadgetId) }
      }
      if (next.bluetoothTargetGadgetIds?.includes(gadgetId)) {
        next = { ...next, bluetoothTargetGadgetIds: next.bluetoothTargetGadgetIds.filter((id) => id !== gadgetId) }
      }
      return next
    })
}

export function removeGadgetReferencesFromPlan(
  plan: DeskPlan,
  gadgetId: string,
  remainingGadgets: readonly Gadget[],
  lang: 'ja' | 'en',
): DeskPlan {
  const { [gadgetId]: _removedUsage, ...gadgetUsage } = plan.gadgetUsage ?? {}
  const connectionMap = plan.connectionMap
    ? {
        ...plan.connectionMap,
        connections: plan.connectionMap.connections.filter((connection) => !connectionTouches(connection, gadgetId)),
        dismissedPairs: plan.connectionMap.dismissedPairs?.filter((pair) => !pairTouches(pair, gadgetId)),
        nodeOffsets: omitMapNode(plan.connectionMap.nodeOffsets, gadgetId),
        nodeSizes: omitMapNode(plan.connectionMap.nodeSizes, gadgetId),
        layoutSnapshots: plan.connectionMap.layoutSnapshots
          ? Object.fromEntries(Object.entries(plan.connectionMap.layoutSnapshots).map(([date, snapshot]) => [date, {
              ...snapshot,
              nodeOffsets: omitMapNode(snapshot.nodeOffsets, gadgetId) ?? {},
              nodeSizes: omitMapNode(snapshot.nodeSizes, gadgetId) ?? {},
            }]))
          : undefined,
        historyLayout: plan.connectionMap.historyLayout
          ? Object.fromEntries(Object.entries(plan.connectionMap.historyLayout).map(([date, snapshot]) => [date, {
              ...snapshot,
              nodeOffsets: omitMapNode(snapshot.nodeOffsets, gadgetId),
              nodeSizes: omitMapNode(snapshot.nodeSizes, gadgetId),
            }]))
          : undefined,
      }
    : undefined
  const withoutReferences: DeskPlan = {
    ...plan,
    selectedGadgetIds: plan.selectedGadgetIds.filter((id) => id !== gadgetId),
    gadgetUsage,
    placements: plan.placements.filter((placement) => placement.gadgetId !== gadgetId),
    wiredOverrides: plan.wiredOverrides?.filter((id) => id !== gadgetId),
    monitorArmAssignments: plan.monitorArmAssignments && Object.fromEntries(
      Object.entries(plan.monitorArmAssignments).filter(([id]) => id !== gadgetId)
        .map(([id, arm]) => [id, arm === gadgetId ? null : arm]),
    ),
    micArmAssignments: plan.micArmAssignments && Object.fromEntries(
      Object.entries(plan.micArmAssignments).filter(([id]) => id !== gadgetId)
        .map(([id, arm]) => [id, arm === gadgetId ? null : arm]),
    ),
    gadgetRelationOverrides: plan.gadgetRelationOverrides && Object.fromEntries(
      Object.entries(plan.gadgetRelationOverrides)
        .filter(([id]) => id !== gadgetId)
        .map(([id, relation]) => [id, {
          ...relation,
          ...(relation.mounting?.targetGadgetId === gadgetId ? { mounting: null } : {}),
          ...(relation.powerSourceGadgetId === gadgetId ? { powerSourceGadgetId: null, powerSourcePortId: null } : {}),
          ...(relation.bluetoothTargetGadgetIds?.includes(gadgetId)
            ? { bluetoothTargetGadgetIds: relation.bluetoothTargetGadgetIds.filter((targetId) => targetId !== gadgetId) }
            : {}),
          ...(relation.wirelessTargetGadgetIds?.includes(gadgetId)
            ? { wirelessTargetGadgetIds: relation.wirelessTargetGadgetIds.filter((targetId) => targetId !== gadgetId) }
            : {}),
        }]),
    ),
    connectionMap,
    updatedAt: new Date().toISOString(),
  }
  return refreshPlanWiring(withoutReferences, remainingGadgets, lang).plan
}
