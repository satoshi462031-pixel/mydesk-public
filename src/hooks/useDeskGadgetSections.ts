// 機材タブの一覧の組み立て（並び替え・ケーブルのまとめ）。
// マイデスク（WiringResultScreen）と他人のデスク（PublicDeskScreen）は同じ並びを出すので、
// 計算はここ1か所に置く。2画面に同じ useMemo を手で書いていた頃の食い違いを避ける。
import { useMemo } from 'react'
import { compareGadgets, GadgetSortKey } from '../components/organisms/GadgetSortSheet'
import { cableSortRank } from '../constants/portTypes'
import { CableType, Gadget } from '../types'
import { orderGadgetsByIds } from '../utils/gadgetOrder'

const EMPTY_ORDER: readonly string[] = []

export interface CableTypeGroup {
  type: CableType | '__unknown'
  items: Gadget[]
  /** 本数。1行が複数本を表すことがある（cableCount） */
  count: number
}

export interface DeskGadgetSections {
  sortedGadgets: Gadget[]
  sortedCableGadgets: Gadget[]
  cableTypeGroups: CableTypeGroup[]
  cableTotalCount: number
}

export function useDeskGadgetSections(
  nonCableGadgets: Gadget[],
  cableGadgets: Gadget[],
  gadgetSort: GadgetSortKey,
  lang: 'ja' | 'en',
  manualOrder: readonly string[] = EMPTY_ORDER,
): DeskGadgetSections {
  const sortedGadgets = useMemo(
    () => gadgetSort === 'manual' ? orderGadgetsByIds(nonCableGadgets, manualOrder)
      : [...nonCableGadgets].sort((a, b) => compareGadgets(a, b, gadgetSort, lang)),
    [nonCableGadgets, gadgetSort, lang, manualOrder],
  )
  const sortedCableGadgets = useMemo(
    () => gadgetSort === 'manual' ? orderGadgetsByIds(cableGadgets, manualOrder)
      : [...cableGadgets].sort((a, b) => compareGadgets(a, b, gadgetSort, lang)),
    [cableGadgets, gadgetSort, lang, manualOrder],
  )
  // ケーブル節は「種類 → その種類のケーブル」の2段になる。
  // 種類未設定のものは末尾の「その他」へまとめる（cableType は任意項目のため）
  const cableTypeGroups = useMemo(() => {
    const map = new Map<CableType | '__unknown', Gadget[]>()
    for (const cable of sortedCableGadgets) {
      const key = cable.cableType ?? '__unknown'
      const items = map.get(key)
      if (items) items.push(cable)
      else map.set(key, [cable])
    }
    return [...map.entries()]
      .map(([type, items]) => ({
        type,
        items,
        count: items.reduce((sum, g) => sum + (g.cableCount ?? 1), 0),
      }))
      // 電源など太くて上流のものを先頭に、細い信号線ほど後ろへ。種類未設定は最後
      .sort((a, b) => {
        const rankA = a.type === '__unknown' ? Number.MAX_SAFE_INTEGER : cableSortRank(a.type)
        const rankB = b.type === '__unknown' ? Number.MAX_SAFE_INTEGER : cableSortRank(b.type)
        return rankA - rankB
      })
  }, [sortedCableGadgets])
  const cableTotalCount = useMemo(
    () => cableTypeGroups.reduce((sum, group) => sum + group.count, 0),
    [cableTypeGroups],
  )

  return { sortedGadgets, sortedCableGadgets, cableTypeGroups, cableTotalCount }
}
