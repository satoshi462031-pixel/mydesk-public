import type { MCIconName } from '../constants/icons'
import type { CustomCategory, DeskPlan, Gadget, GadgetCategory, PlanPurpose } from '../types'
import { customCategoryOf, normalizeCustomCategory } from './customCategory'
import type { DeskTemplate, TemplateSlot } from '../types/template'
import type { ProductSuggestion } from './productSuggestions'

// ─── 他人のデスクを参考に作る ─────────────────────────────────────────────
//
// 同じ機材をそろえている人はまずいないので、写すのはジャンルの組み合わせと置き場所だけ。
// 相手の商品は枠に入れず、枠ごとの「候補」として出して、使う物だけ拾ってもらう
// （全部入れて始めると、持っていない物を消す作業になり、総額や履歴にも混ざる）。
//
// 作成の流れはテンプレートと同じ画面（TemplateDetail）を通す。コピー元を1台1枠の
// テンプレートに見立てれば、枠の編集・入力の控え・作成処理をそのまま使える。

export interface DeskCopyItem {
  category: GadgetCategory
  pcFormFactor?: Gadget['pcFormFactor']
  zone?: TemplateSlot['zone']
  /** コピー元の自作ジャンル。名前と絵を写す（枠が「その他」になると何の枠か分からない） */
  custom?: CustomCategory
  /** コピー元の商品。枠の候補として出す。枠のまま（isPlaceholder）だった物は持たない */
  product?: ProductSuggestion
}

export interface DeskCopySource {
  deskId: string
  title: string
  ownerName: string
  purposes: PlanPurpose[]
  items: DeskCopyItem[]
}

const COPY_TEMPLATE_PREFIX = 'copy-'

export function buildDeskCopySource(input: {
  deskId: string
  title: string
  ownerName: string
  plan: DeskPlan
  /** 現役の機材（撤去済みを含めない） */
  gadgets: Gadget[]
}): DeskCopySource {
  const zones = new Map((input.plan.placements ?? []).map((p) => [p.gadgetId, p.zone]))
  const items = input.gadgets
    // ケーブルは枠にしない。配線図が必要な線を引き、本数も数える（テンプレートと同じ扱い）
    .filter((g) => g.category !== 'Cable')
    .map((g): DeskCopyItem => ({
      category: g.category,
      pcFormFactor: g.pcFormFactor,
      zone: zones.get(g.id),
      ...(customCategoryOf(g) ? { custom: customCategoryOf(g) } : {}),
      product: g.isPlaceholder
        ? undefined
        : {
            name: g.name,
            ports: g.ports,
            productId: g.productId,
            pcFormFactor: g.pcFormFactor,
            powerUsage: g.powerUsage,
            // 金額は写さない。同じ商品でも買った値段は人ごとに違う。
            // 購入リンク（url）も写さない。相手が手で入れた任意の URL が、黙って自分の機材の
            // 購入先になる。商品DB由来なら productId から公式の購入リンクが引ける
          },
    }))
  return {
    deskId: input.deskId,
    title: input.title,
    ownerName: input.ownerName,
    purposes: input.plan.purposes ?? [],
    items,
  }
}

export function deskCopyTemplateId(deskId: string): string {
  return `${COPY_TEMPLATE_PREFIX}${deskId}`
}

/** コピー元を1台1枠のテンプレートに見立てる。枠の key は buildTemplateItems の `${枠}-0` になる */
export function deskCopyTemplate(source: DeskCopySource, icon: MCIconName): DeskTemplate {
  return {
    id: deskCopyTemplateId(source.deskId),
    nameJa: source.title,
    nameEn: source.title,
    descJa: '',
    descEn: '',
    icon,
    color: '#888888',
    // 控え（端末に保存した作りかけ）から戻った値もここを通るので、自作ジャンルは形を確かめる
    slots: source.items.map((item) => ({
      category: item.category,
      pcFormFactor: item.pcFormFactor,
      zone: item.zone,
      custom: item.category === 'Other' ? normalizeCustomCategory(item.custom) : undefined,
    })),
    purposes: source.purposes,
    // 充電器が要る構成なら、コピー元にもう入っている。テンプレートの共通ルールで足すと二重になる
    autoCharger: false,
    source: 'user',
  }
}

/** テンプレートの枠 key（`${枠}-${何台目}`）に対応するコピー元の商品 */
export function deskCopyCandidate(source: DeskCopySource, itemKey: string): ProductSuggestion | undefined {
  const match = /^(\d+)-0$/.exec(itemKey)
  if (!match) return undefined
  return source.items[Number(match[1])]?.product
}
