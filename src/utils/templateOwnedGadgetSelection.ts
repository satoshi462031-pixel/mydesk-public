import type { CustomCategory, Gadget, GadgetCategory } from '../types'
import { customCategoryOf, gadgetCategoryKey } from './customCategory'

export interface TemplateOwnedSlot {
  key: string
  category: GadgetCategory
  /** 自作ジャンルの枠。同じ 'Other' でもジャンルが違う持ち物は入れない */
  custom?: CustomCategory
}

/** 枠と持ち物を突き合わせる鍵。自作ジャンルは id で見る（gadgetCategoryKey と同じ形） */
function slotKey(item: TemplateOwnedSlot): string {
  return item.custom ? `custom:${item.custom.id}` : item.category
}

/** 足りない枠1つぶん。自作ジャンルの持ち物には、そのジャンルの枠を足す */
export interface OwnedSlotNeed {
  category: GadgetCategory
  custom?: CustomCategory
}

/** 選択した持ち物を、同じカテゴリの空いている枠へ選択順に割り当てる。 */
export function assignOwnedGadgetsToTemplateItems(
  items: readonly TemplateOwnedSlot[],
  gadgets: readonly Gadget[],
  selectedIds: readonly string[],
  previousSelections: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const gadgetsById = new Map(gadgets.map((gadget) => [gadget.id, gadget]))
  const itemsByKey = new Map(items.map((item) => [item.key, item]))
  const selected = new Set(selectedIds)
  const assignedItemKeys = new Set<string>()
  const assignedGadgetIds = new Set<string>()
  const result: Record<string, string> = {}

  // 既存の枠への割り当てを先に保持する。同カテゴリの枠が前へ追加されても、
  // 選んだ機材が別の配置・配線先へ移動しないようにする。
  for (const [itemKey, gadgetId] of Object.entries(previousSelections)) {
    if (!selected.has(gadgetId) || assignedGadgetIds.has(gadgetId)) continue
    const item = itemsByKey.get(itemKey)
    const gadget = gadgetsById.get(gadgetId)
    if (!item || !gadget || gadget.isPlaceholder || slotKey(item) !== gadgetCategoryKey(gadget)) continue
    result[item.key] = gadget.id
    assignedItemKeys.add(item.key)
    assignedGadgetIds.add(gadget.id)
  }

  for (const gadgetId of selectedIds) {
    if (assignedGadgetIds.has(gadgetId)) continue
    const gadget = gadgetsById.get(gadgetId)
    if (!gadget || gadget.isPlaceholder) continue
    const item = items.find(
      (candidate) => slotKey(candidate) === gadgetCategoryKey(gadget) && !assignedItemKeys.has(candidate.key),
    )
    if (!item) continue
    result[item.key] = gadget.id
    assignedItemKeys.add(item.key)
    assignedGadgetIds.add(gadget.id)
  }

  return result
}

/**
 * 確定済みの割り当て（枠 → 機材）のうち、今も有効なものだけを残す。
 *
 * 足りなくなった分を別の枠へ詰め直すことはしない。枠を消した・用途を変えて枠が無くなった
 * ときに詰め直すと、選んだ機材が本人の知らないうちに別の枠（商品名を入れていた枠など）へ
 * 移る。空いた枠への割り当ては、持ち物の選択モーダルで本人が選んだときだけ行う。
 */
export function retainOwnedAssignments(
  items: readonly TemplateOwnedSlot[],
  gadgets: readonly Gadget[],
  selections: Readonly<Record<string, string>>,
): Record<string, string> {
  const gadgetsById = new Map(gadgets.map((gadget) => [gadget.id, gadget]))
  const itemsByKey = new Map(items.map((item) => [item.key, item]))
  const used = new Set<string>()
  const result: Record<string, string> = {}
  for (const [itemKey, gadgetId] of Object.entries(selections)) {
    const item = itemsByKey.get(itemKey)
    const gadget = gadgetsById.get(gadgetId)
    if (!item || !gadget || gadget.isPlaceholder || slotKey(item) !== gadgetCategoryKey(gadget) || used.has(gadgetId)) continue
    result[itemKey] = gadgetId
    used.add(gadgetId)
  }
  return result
}

export function hasOwnedGadgetCapacity(
  items: readonly TemplateOwnedSlot[],
  gadgets: readonly Gadget[],
  selectedIds: readonly string[],
  category: GadgetCategory,
): boolean {
  const capacity = items.filter((item) => slotKey(item) === category).length
  const selected = new Set(selectedIds)
  const used = gadgets.filter(
    (gadget) => selected.has(gadget.id) && !gadget.isPlaceholder && gadgetCategoryKey(gadget) === category,
  ).length
  return used < capacity
}

/**
 * 選んだ持ち物をすべて割り当てるために追加が必要な枠のカテゴリ。
 * 選択順を保つので、同カテゴリの複数台もその順で追加枠へ入る。
 */
export function ownedGadgetCategoriesNeedingSlots(
  items: readonly TemplateOwnedSlot[],
  gadgets: readonly Gadget[],
  selectedIds: readonly string[],
): OwnedSlotNeed[] {
  const capacity = new Map<string, number>()
  for (const item of items) capacity.set(slotKey(item), (capacity.get(slotKey(item)) ?? 0) + 1)

  const gadgetsById = new Map(gadgets.map((gadget) => [gadget.id, gadget]))
  const selectedCounts = new Map<string, number>()
  const seen = new Set<string>()
  const missing: OwnedSlotNeed[] = []
  for (const id of selectedIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const gadget = gadgetsById.get(id)
    if (!gadget || gadget.isPlaceholder) continue
    const key = gadgetCategoryKey(gadget)
    const nextCount = (selectedCounts.get(key) ?? 0) + 1
    selectedCounts.set(key, nextCount)
    if (nextCount > (capacity.get(key) ?? 0)) {
      const custom = customCategoryOf(gadget)
      missing.push(custom ? { category: gadget.category, custom } : { category: gadget.category })
    }
  }
  return missing
}
