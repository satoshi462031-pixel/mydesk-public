import type { DeskPlan, Gadget } from '../types'
import { trimInvisible } from './truncateText'

// ─── 公開できる機材がそろっているか ───────────────────────────────────
//
// 作るときは商品名が無くてよい。配線図はジャンルの標準的な端子で描けるし、
// これから買う人もデスクを作れる。自分だけが見ているデスクは下書きでよい。
//
// 公開するときは、デスクの機材すべてに商品名が入っていることを求める。
// 用途から自動で置かれる枠（isPlaceholder）は「ディスプレイ」のようなジャンル名が
// 並ぶだけで、その人が何を使っているかを何も伝えない。機材リストで共有するアプリで、
// 見る側にとって意味の無い行を出さない。
//
// 公開ページから枠だけを外して通す案は採らない。配線図からも枠と線が消え、
// 枠のハブを経由していた機材がどこにもつながっていない図になる。

/**
 * 商品名がまだ入っていない枠か。「商品をまとめて登録」（ProductFillScreen）が並べる
 * 対象と同じ判定にする。ずれると、公開で止められて送られた先に直す行が無い
 */
export function isUnfilledSlot(gadget: Gadget): boolean {
  return !!gadget.isPlaceholder || trimInvisible(gadget.name) === ''
}

export type PublishGadgetIssue =
  /** 商品名の入っていない枠が残っている */
  | { kind: 'unfilled'; count: number }
  /** 機材が1台も無い（ケーブルしか無いものも含む） */
  | { kind: 'empty' }

export function publishGadgetIssue(
  plan: Pick<DeskPlan, 'selectedGadgetIds'>,
  gadgets: readonly Gadget[],
): PublishGadgetIssue | null {
  const byId = new Map(gadgets.map((g) => [g.id, g]))
  const selected = plan.selectedGadgetIds
    .map((id) => byId.get(id))
    .filter((g): g is Gadget => !!g && !g.removedAt)
  const unfilled = selected.filter(isUnfilledSlot).length
  if (unfilled > 0) return { kind: 'unfilled', count: unfilled }
  // ケーブル1本だけのデスクは、機材リストとして読めない
  if (!selected.some((g) => g.category !== 'Cable')) return { kind: 'empty' }
  return null
}
