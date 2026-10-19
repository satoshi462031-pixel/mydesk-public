import { Gadget, GadgetCategory } from '../types'
import { brandDisplay, brandFromGadgetName, brandKey } from './brandIdentity'
import { parseLocalDate } from './dateFormat'
import { gadgetQuantity, isOwnedGadget, validGadgetPrice } from './gadgetStats'

export interface InventoryBreakdownRow<T> {
  key: T
  label: string
  count: number
  total: number
}

export interface InventoryStats {
  itemCount: number
  totalAmount: number
  pricedCount: number
  unpricedCount: number
  categories: InventoryBreakdownRow<GadgetCategory>[]
  brands: InventoryBreakdownRow<string>[]
  purchaseYears: InventoryBreakdownRow<number>[]
  undatedCount: number
}

type MutableRow = { label: string; count: number; total: number }

function addToMap<T>(map: Map<T, MutableRow>, key: T, label: string, gadget: Gadget) {
  const quantity = gadgetQuantity(gadget)
  const amount = (validGadgetPrice(gadget) ?? 0) * quantity
  const current = map.get(key) ?? { label, count: 0, total: 0 }
  map.set(key, {
    label: current.label,
    count: current.count + quantity,
    total: current.total + amount,
  })
}

export function buildInventoryStats(gadgets: Gadget[], lang: 'ja' | 'en'): InventoryStats {
  const categories = new Map<GadgetCategory, MutableRow>()
  const brands = new Map<string, MutableRow>()
  const purchaseYears = new Map<number, MutableRow>()
  let itemCount = 0
  let totalAmount = 0
  let pricedCount = 0
  let undatedCount = 0

  for (const gadget of gadgets) {
    if (!isOwnedGadget(gadget)) continue
    const quantity = gadgetQuantity(gadget)
    const price = validGadgetPrice(gadget)
    itemCount += quantity
    totalAmount += (price ?? 0) * quantity
    if (price != null) pricedCount += quantity

    addToMap(categories, gadget.category, gadget.category, gadget)

    const rawBrand = brandFromGadgetName(gadget.name)
    const brandId = rawBrand ? (brandKey(rawBrand) ?? rawBrand.trim().toLocaleLowerCase()) : '__unknown__'
    const brandLabel = rawBrand
      ? (brandDisplay(rawBrand, lang) ?? rawBrand)
      : (lang === 'ja' ? 'ブランド未判定' : 'Unknown brand')
    addToMap(brands, brandId, brandLabel, gadget)

    const purchased = parseLocalDate(gadget.purchasedAt)
    if (purchased) {
      const year = purchased.getFullYear()
      addToMap(purchaseYears, year, String(year), gadget)
    } else {
      undatedCount += quantity
    }
  }

  const toRows = <T,>(map: Map<T, MutableRow>): InventoryBreakdownRow<T>[] =>
    [...map.entries()].map(([key, value]) => ({ key, ...value }))

  return {
    itemCount,
    totalAmount,
    pricedCount,
    unpricedCount: itemCount - pricedCount,
    categories: toRows(categories).sort((a, b) => b.count - a.count || b.total - a.total),
    brands: toRows(brands).sort((a, b) => b.count - a.count || b.total - a.total || a.label.localeCompare(b.label)),
    purchaseYears: toRows(purchaseYears).sort((a, b) => a.key - b.key),
    undatedCount,
  }
}
