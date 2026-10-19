import type { DeskPlan, Gadget } from '../types'

/**
 * デスクの複製で、テンプレートの枠（isPlaceholder）だけを別の機材として作り直す。
 *
 * 持っている実物の機材は複数のデスクで共有してよい（同じ1台を別の机で使う）。一方で枠は
 * 「このデスクの空き」であり、共有したままだと、複製先で商品を埋めた（productFill が機材を
 * そのまま書き換える）瞬間に複製元の枠まで同じ商品になる。
 *
 * デスクの中の機材ID（選択・配置・配線・利用期間・手動の位置など）は形がさまざまなので、
 * 個別に書き換えず、JSON 上で旧IDを新IDへ置き換える。ID は UUID で、他の値と偶然一致しない。
 */
export function duplicatePlanSlots(
  plan: DeskPlan,
  gadgets: readonly Gadget[],
  newId: () => string,
): { plan: DeskPlan; slots: Gadget[] } {
  const selected = new Set(plan.selectedGadgetIds)
  const placeholders = gadgets.filter((gadget) => gadget.isPlaceholder && selected.has(gadget.id))
  if (placeholders.length === 0) return { plan, slots: [] }

  const idMap = new Map(placeholders.map((gadget) => [gadget.id, newId()]))
  const remap = <T>(value: T): T => {
    let json = JSON.stringify(value)
    for (const [from, to] of idMap) {
      json = json.split(`"${from}"`).join(`"${to}"`)
      for (const suffix of ['L', 'R', 'SUB']) json = json.split(`"${from}__${suffix}"`).join(`"${to}__${suffix}"`)
    }
    // オブジェクトのキー（nodeOffsets など）も "id" の形で出るので、上の置き換えで一緒に変わる
    return JSON.parse(json) as T
  }
  return {
    plan: remap(plan),
    slots: placeholders.map((gadget) => remap(gadget)),
  }
}
