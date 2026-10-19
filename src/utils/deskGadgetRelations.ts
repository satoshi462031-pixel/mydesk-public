import type { DeskGadgetRelationOverride, DeskPlan, Gadget } from '../types'

const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key)

export function applyDeskGadgetRelations(plan: DeskPlan, gadget: Gadget): Gadget {
  const override = plan.gadgetRelationOverrides?.[gadget.id]
  if (!override) return gadget
  const selected = new Set(plan.selectedGadgetIds)
  const mountingApplies = hasOwn(override, 'mounting') && (
    override.mounting === null || !!override.mounting && selected.has(override.mounting.targetGadgetId)
  )
  const bluetoothApplies = hasOwn(override, 'bluetoothTargetGadgetIds') && (
    override.bluetoothTargetGadgetIds?.length === 0 || override.bluetoothTargetGadgetIds?.every((id) => selected.has(id))
  )
  const wirelessApplies = hasOwn(override, 'wirelessTargetGadgetIds') && (
    override.wirelessTargetGadgetIds?.length === 0 || override.wirelessTargetGadgetIds?.every((id) => selected.has(id))
  )
  const powerApplies = hasOwn(override, 'powerSourceGadgetId') && (
    override.powerSourceGadgetId === null || !!override.powerSourceGadgetId && selected.has(override.powerSourceGadgetId)
  )
  return {
    ...gadget,
    ...(mountingApplies ? { mounting: override.mounting ?? undefined } : {}),
    ...(bluetoothApplies ? { bluetoothTargetGadgetIds: override.bluetoothTargetGadgetIds } : {}),
    ...(wirelessApplies ? { wirelessTargetGadgetIds: override.wirelessTargetGadgetIds } : {}),
    ...(powerApplies ? { powerSourceGadgetId: override.powerSourceGadgetId ?? undefined } : {}),
    ...(powerApplies && hasOwn(override, 'powerSourcePortId') ? { powerSourcePortId: override.powerSourcePortId ?? undefined } : {}),
  }
}

const replaceId = (ids: readonly string[] | undefined, oldId: string, newId: string) =>
  ids?.includes(oldId) ? [...new Set(ids.map((id) => id === oldId ? newId : id))] : undefined

const withOverride = (
  overrides: Record<string, DeskGadgetRelationOverride>,
  gadgetId: string,
  patch: DeskGadgetRelationOverride,
) => {
  overrides[gadgetId] = { ...(overrides[gadgetId] ?? {}), ...patch }
}

export interface ReplacementRelationTransfer {
  overrides: DeskPlan['gadgetRelationOverrides']
  count: number
}

/** 交換前の固定先・接続先・給電元を、このデスクだけ交換後の機材へ付け替える。 */
export function replacementRelationTransfer(
  plan: DeskPlan,
  oldGadgetId: string,
  newGadgetId: string,
  gadgets: readonly Gadget[],
): ReplacementRelationTransfer {
  const overrides: Record<string, DeskGadgetRelationOverride> = Object.fromEntries(
    Object.entries(plan.gadgetRelationOverrides ?? {}).map(([id, value]) => [id, { ...value }]),
  )
  const effective = gadgets.map((gadget) => applyDeskGadgetRelations(plan, gadget))
  const selectedIds = new Set(plan.selectedGadgetIds)
  const source = effective.find((gadget) => gadget.id === oldGadgetId)
  const target = effective.find((gadget) => gadget.id === newGadgetId)
  if (!source || !target) return { overrides: plan.gadgetRelationOverrides, count: 0 }

  let count = 0
  const targetPatch: DeskGadgetRelationOverride = {}
  if (source.mounting && selectedIds.has(source.mounting.targetGadgetId)) {
    targetPatch.mounting = { ...source.mounting }
    count++
  }
  const sourceBluetoothTargets = source.bluetoothTargetGadgetIds?.filter((id) => selectedIds.has(id))
  if (sourceBluetoothTargets?.length) {
    targetPatch.bluetoothTargetGadgetIds = sourceBluetoothTargets
    count++
  }
  const sourceWirelessTargets = source.wirelessTargetGadgetIds?.filter((id) => selectedIds.has(id))
  if (sourceWirelessTargets?.length) {
    targetPatch.wirelessTargetGadgetIds = sourceWirelessTargets
    count++
  }
  if (source.powerSourceGadgetId && selectedIds.has(source.powerSourceGadgetId)) {
    targetPatch.powerSourceGadgetId = source.powerSourceGadgetId
    targetPatch.powerSourcePortId = source.powerSourcePortId ?? null
    count++
  }
  if (Object.keys(targetPatch).length > 0) withOverride(overrides, newGadgetId, targetPatch)

  for (const gadget of effective) {
    if (!selectedIds.has(gadget.id) || gadget.id === oldGadgetId || gadget.id === newGadgetId) continue
    const patch: DeskGadgetRelationOverride = {}
    if (gadget.mounting?.targetGadgetId === oldGadgetId) {
      patch.mounting = { ...gadget.mounting, targetGadgetId: newGadgetId }
      count++
    }
    if (gadget.powerSourceGadgetId === oldGadgetId) {
      patch.powerSourceGadgetId = newGadgetId
      // 接続先商品のポートIDなので、別商品へは持ち越さない。
      patch.powerSourcePortId = null
      count++
    }
    const bluetoothTargets = replaceId(gadget.bluetoothTargetGadgetIds, oldGadgetId, newGadgetId)
    if (bluetoothTargets) {
      patch.bluetoothTargetGadgetIds = bluetoothTargets
      count++
    }
    const wirelessTargets = replaceId(gadget.wirelessTargetGadgetIds, oldGadgetId, newGadgetId)
    if (wirelessTargets) {
      patch.wirelessTargetGadgetIds = wirelessTargets
      count++
    }
    if (Object.keys(patch).length > 0) withOverride(overrides, gadget.id, patch)
  }

  return { overrides: count > 0 ? overrides : plan.gadgetRelationOverrides, count }
}
