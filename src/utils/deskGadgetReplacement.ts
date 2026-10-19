import { DeskGadgetUsage, DeskPlan, Gadget, MapConnection } from '../types'
import { determineCableType, PORT_COMPATIBILITY } from '../constants/portTypes'
import { baseMapNodeId } from './connectionMapLayout'
import { replacementRelationTransfer } from './deskGadgetRelations'
import { updateDeskGadgetSelection } from './deskGadgetUsage'

const connectionTouches = (
  connection: Pick<MapConnection, 'fromGadgetId' | 'toGadgetId'>,
  gadgetId: string,
) => connection.fromGadgetId === gadgetId || connection.toGadgetId === gadgetId

const pairTouches = (pairKey: string, gadgetId: string) => {
  const [pair] = pairKey.split('|', 1)
  return pair?.split('~').includes(gadgetId) ?? false
}

function replaceMapNode<T>(
  values: Record<string, T> | undefined,
  oldGadgetId: string,
  newGadgetId: string,
): Record<string, T> | undefined {
  if (!values) return values
  const next: Record<string, T> = {}
  for (const [nodeId, value] of Object.entries(values)) {
    const baseId = baseMapNodeId(nodeId)
    if (baseId === newGadgetId) continue
    const replacementId = baseId === oldGadgetId
      ? `${newGadgetId}${nodeId.slice(oldGadgetId.length)}`
      : nodeId
    next[replacementId] = value
  }
  return next
}

function markManualDate(
  usage: DeskGadgetUsage | undefined,
  date: string,
  boundary: 'startedAt' | 'endedAt',
): DeskGadgetUsage | undefined {
  if (!usage?.periods) return usage
  const index = usage.periods.findLastIndex((period) => period[boundary] === date)
  if (index < 0) return usage
  const periods = usage.periods.map((period, i) => i === index
    ? {
        ...period,
        ...(boundary === 'startedAt'
          ? { startedAtSource: 'manual' as const }
          : { endedAtSource: 'manual' as const }),
      }
    : period)
  return { ...usage, periods }
}

function manualConnectionFits(
  connection: MapConnection,
  newGadget: Gadget | undefined,
  otherGadget: Gadget | undefined,
  replacingFrom: boolean,
): boolean {
  if (!newGadget || !otherGadget) return false
  const from = replacingFrom ? newGadget : otherGadget
  const to = replacingFrom ? otherGadget : newGadget
  return from.ports.some((fromPort) => fromPort.direction !== 'input' &&
    to.ports.some((toPort) => toPort.direction !== 'output' &&
      (PORT_COMPATIBILITY[fromPort.type] ?? [fromPort.type]).includes(toPort.type) &&
      determineCableType(fromPort.type, toPort.type) === connection.cableType))
}

/**
 * デスク上の1台を別の1台へ交換する。
 *
 * 過去の layoutSnapshots / historyLayout は旧機材の履歴表示に使うため触らず、
 * 現在の配線図に使う位置と大きさだけを新機材へ移す。自動線に加え、交換先でも
 * 物理的に成立する手動線を引き継ぎ、呼び出し側が refreshPlanWiring で作り直す。
 */
export function replaceDeskGadget(
  plan: DeskPlan,
  oldGadgetId: string,
  newGadgetId: string,
  gadgets: readonly Gadget[],
  changedAt: string,
  options: {
    monitorArmAssignment?: string | null
    micArmAssignment?: string | null
    inheritRelations?: boolean
  } = {},
): DeskPlan {
  if (oldGadgetId === newGadgetId || !plan.selectedGadgetIds.includes(oldGadgetId)) return plan

  const selectedGadgetIds = [...new Set(
    plan.selectedGadgetIds.map((id) => id === oldGadgetId ? newGadgetId : id),
  )]
  // このデスクで一度も使っていない商品は、商品本体の購入日を在籍開始日として
  // フォールバックさせず、ユーザーが指定した交換日から新しい期間を始める。
  const planWithTargetUsage = plan.gadgetUsage?.[newGadgetId]
    ? plan
    : {
        ...plan,
        gadgetUsage: {
          ...(plan.gadgetUsage ?? {}),
          [newGadgetId]: { periods: [] },
        },
      }
  const selectionUpdated = updateDeskGadgetSelection(
    planWithTargetUsage,
    selectedGadgetIds,
    [...gadgets],
    changedAt,
  )
  const gadgetUsage = { ...(selectionUpdated.gadgetUsage ?? {}) }
  gadgetUsage[oldGadgetId] = markManualDate(gadgetUsage[oldGadgetId], changedAt, 'endedAt') ?? {}
  gadgetUsage[newGadgetId] = markManualDate(gadgetUsage[newGadgetId], changedAt, 'startedAt') ?? {}

  const oldPlacement = plan.placements.find((placement) => placement.gadgetId === oldGadgetId)
  const placements = plan.placements
    .filter((placement) => placement.gadgetId !== oldGadgetId && placement.gadgetId !== newGadgetId)
  if (oldPlacement) placements.push({ ...oldPlacement, gadgetId: newGadgetId })

  const previousConnections = plan.connectionMap?.connections ?? []
  const connections = previousConnections.flatMap((connection) => {
    const touchesOld = connectionTouches(connection, oldGadgetId)
    const touchesNew = connectionTouches(connection, newGadgetId)
    if (touchesNew) return []
    if (!touchesOld) return [connection]
    const replacingFrom = connection.fromGadgetId === oldGadgetId
    const otherId = replacingFrom ? connection.toGadgetId : connection.fromGadgetId
    if (connection.origin === 'manual' && !manualConnectionFits(
      connection,
      gadgets.find((gadget) => gadget.id === newGadgetId),
      gadgets.find((gadget) => gadget.id === otherId),
      replacingFrom,
    )) return []
    const replaced = {
      ...connection,
      fromGadgetId: connection.fromGadgetId === oldGadgetId ? newGadgetId : connection.fromGadgetId,
      toGadgetId: connection.toGadgetId === oldGadgetId ? newGadgetId : connection.toGadgetId,
    }
    const duplicate = previousConnections.some((candidate) => candidate !== connection &&
      candidate.fromGadgetId === replaced.fromGadgetId &&
      candidate.toGadgetId === replaced.toGadgetId &&
      candidate.cableType === replaced.cableType)
    return duplicate ? [] : [replaced]
  })

  let monitorArmAssignments = plan.monitorArmAssignments
    ? Object.fromEntries(Object.entries(plan.monitorArmAssignments).map(([gadgetId, armId]) => [
        gadgetId === oldGadgetId ? newGadgetId : gadgetId,
        armId === oldGadgetId ? newGadgetId : armId,
      ]))
    : undefined
  if (Object.prototype.hasOwnProperty.call(options, 'monitorArmAssignment')) {
    monitorArmAssignments = {
      ...(monitorArmAssignments ?? {}),
      [newGadgetId]: options.monitorArmAssignment ?? null,
    }
  }
  let micArmAssignments = plan.micArmAssignments
    ? Object.fromEntries(Object.entries(plan.micArmAssignments).map(([gadgetId, armId]) => [
        gadgetId === oldGadgetId ? newGadgetId : gadgetId,
        armId === oldGadgetId ? newGadgetId : armId,
      ]))
    : undefined
  if (Object.prototype.hasOwnProperty.call(options, 'micArmAssignment')) {
    micArmAssignments = {
      ...(micArmAssignments ?? {}),
      [newGadgetId]: options.micArmAssignment ?? null,
    }
  }
  const gadgetRelationOverrides = options.inheritRelations === false
    ? plan.gadgetRelationOverrides
    : replacementRelationTransfer(plan, oldGadgetId, newGadgetId, gadgets).overrides

  return {
    ...selectionUpdated,
    gadgetUsage,
    placements,
    wiredOverrides: plan.wiredOverrides
      ? [...new Set(plan.wiredOverrides.map((id) => id === oldGadgetId ? newGadgetId : id))]
      : undefined,
    monitorArmAssignments,
    micArmAssignments,
    gadgetRelationOverrides,
    connectionMap: plan.connectionMap
      ? {
          ...plan.connectionMap,
          connections,
          dismissedPairs: plan.connectionMap.dismissedPairs?.filter((pair) =>
            !pairTouches(pair, oldGadgetId) && !pairTouches(pair, newGadgetId)),
          nodeOffsets: replaceMapNode(plan.connectionMap.nodeOffsets, oldGadgetId, newGadgetId),
          nodeSizes: replaceMapNode(plan.connectionMap.nodeSizes, oldGadgetId, newGadgetId),
        }
      : undefined,
  }
}
