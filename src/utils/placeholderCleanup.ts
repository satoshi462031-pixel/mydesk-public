import type { DeskPlan, Gadget } from '../types'

/**
 * デスクから外れると行き場の無くなる「商品名未設定の枠」。
 *
 * テンプレート・ジャンル選択で作った枠はそのデスクのためだけにあり、デスクを消したとき・
 * 作成の途中で機材を選び直したときに残すと、マイガジェットが未設定の機材で埋まっていく。
 * 片付ける経路（デスクの削除・作成途中の破棄・3段目での選び直し）がそれぞれ判定を持つと
 * 1つだけ抜けるので、ここにまとめる。他のデスクでも使っている枠は残す。
 */
export function orphanPlaceholders(
  plan: Pick<DeskPlan, 'id' | 'selectedGadgetIds'>,
  gadgets: readonly Gadget[],
  plans: readonly Pick<DeskPlan, 'id' | 'selectedGadgetIds'>[],
): Gadget[] {
  const selected = new Set(plan.selectedGadgetIds)
  return gadgets.filter((gadget) =>
    (gadget.isPlaceholder || !gadget.name.trim())
    && selected.has(gadget.id)
    && !plans.some((other) => other.id !== plan.id && other.selectedGadgetIds.includes(gadget.id)))
}
