import { Gadget } from '../types'

export function isOwnedGadget(gadget: Gadget): boolean {
  return !gadget.isCandidate && !gadget.isPlaceholder
}

/**
 * 持ち物に数えない機材の行に付ける印。名前の無い枠を一律に「候補」と出すと、
 * 手持ちを整理する人が「持ち物として登録」で作った枠まで候補に見える（枠の候補・所有は isCandidate が持つ）
 */
export function notOwnedBadge(gadget: Pick<Gadget, 'isCandidate' | 'isPlaceholder'>, lang: 'ja' | 'en'): string | undefined {
  if (gadget.isCandidate) return lang === 'ja' ? '候補' : 'Candidate'
  if (gadget.isPlaceholder) return lang === 'ja' ? '商品名未設定' : 'No product name'
  return undefined
}

export function validGadgetPrice(gadget: Gadget): number | null {
  const price = gadget.price
  return typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null
}

export function gadgetQuantity(gadget: Gadget): number {
  const quantity = gadget.quantity
  return typeof quantity === 'number' && Number.isFinite(quantity) && quantity >= 1
    ? Math.floor(quantity)
    : 1
}

export function sumGadgetQuantities(gadgets: readonly Gadget[]): number {
  return gadgets.reduce((total, gadget) => total + gadgetQuantity(gadget), 0)
}

/**
 * 「N台」「ガジェット N」と数える対象か。ケーブルは本数で数える持ち物で、一覧でも
 * 「ケーブル」として別に並ぶので台数には入れない（入れると同じ線を二重に数える）。
 * 金額は買った物なのでケーブルも含める（sumGadgetPrices はそのまま）
 */
export function countsAsDevice(gadget: Gadget): boolean {
  return gadget.category !== 'Cable'
}

export function sumDeviceQuantities(gadgets: readonly Gadget[]): number {
  return sumGadgetQuantities(gadgets.filter(countsAsDevice))
}

export function sumGadgetPrices(gadgets: readonly Gadget[]): number {
  return gadgets.reduce((total, gadget) => total + (validGadgetPrice(gadget) ?? 0) * gadgetQuantity(gadget), 0)
}

export function gadgetFinancialSummary(current: readonly Gadget[], history: readonly Gadget[]) {
  const uniqueCurrent = [...new Map(current.map((gadget) => [gadget.id, gadget])).values()]
  const uniqueHistory = [...new Map(history.map((gadget) => [gadget.id, gadget])).values()]
  const currentIds = new Set(uniqueCurrent.map((gadget) => gadget.id))

  return {
    currentTotal: sumGadgetPrices(uniqueCurrent),
    cumulativeTotal: sumGadgetPrices(uniqueHistory),
    outsideTotal: sumGadgetPrices(uniqueHistory.filter((gadget) => !currentIds.has(gadget.id))),
    // 金額はケーブル込み、「X / Y台」の台数はケーブル抜き（統計の他の台数と揃える）
    currentPricedCount: sumDeviceQuantities(uniqueCurrent.filter((gadget) => validGadgetPrice(gadget) != null)),
    currentCount: sumDeviceQuantities(uniqueCurrent),
    historyPricedCount: sumDeviceQuantities(uniqueHistory.filter((gadget) => validGadgetPrice(gadget) != null)),
    historyCount: sumDeviceQuantities(uniqueHistory),
  }
}

// parseLocalDate は utils/dateFormat.ts へ移した（日付ピッカーの初期値でも使うため）。

