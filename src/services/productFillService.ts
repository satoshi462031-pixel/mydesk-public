import { Gadget } from '../types'
import { applyProductToGadget } from '../utils/productFill'
import { ProductSuggestion } from '../utils/productSuggestions'

export interface ProductFillSaveEntry {
  gadget: Gadget
  name: string
  suggestion?: ProductSuggestion
}

interface ProductFillSaveDeps {
  resolveUrl: (entry: ProductFillSaveEntry) => Promise<string | null>
  updateMany: (gadgets: Gadget[]) => Promise<unknown>
  clearDraft: () => Promise<unknown>
  trackFirstItem: (count: number) => void | Promise<void>
}

/**
 * URL解決は補助情報なので失敗しても保存を続ける。ガジェット一括更新に失敗した場合だけ
 * rejectし、下書き削除と初回イベントは実行しない。
 */
export async function saveProductFillEntries(
  entries: ProductFillSaveEntry[],
  deps: ProductFillSaveDeps,
): Promise<number> {
  if (entries.length === 0) return 0
  const urls = await Promise.all(entries.map((entry) => deps.resolveUrl(entry).catch(() => null)))
  const updated = entries.map(({ gadget, name, suggestion }, index) =>
    applyProductToGadget(gadget, { name, suggestion, purchaseUrl: urls[index] }),
  )

  await deps.updateMany(updated)
  await deps.clearDraft().catch(() => {})
  await deps.trackFirstItem(entries.length)
  return entries.length
}
