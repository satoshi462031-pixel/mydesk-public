import { DeskGadgetUsage, Gadget } from '../types'
import { DeskChange, deskChangeHistory } from './deskChangeSummary'

// ─── 人単位の「最近の変化」 ──────────────────────────────────────────
// 公開プロフィールに並ぶタイルは1〜3件で終わり、開くたびに同じ絵になる。
// デスクの数が増えなくても、機材は入れ替わっている。デスクをまたいで
// 変更を日付順に混ぜると、その人がいま動いていることがページに出る。
//
// 材料は各デスクの share_snapshot（撤去済みガジェットを持っているのはこれだけ）。
// 重い JSON なので、呼ぶ側はタイルを描いたあとに取りに行く。

export interface ProfileActivityDesk {
  id: string
  title: string
  gadgets: Gadget[]
  usage?: Record<string, DeskGadgetUsage>
}

export interface ProfileActivityEntry {
  /** 同じ日に2つのデスクが動くので、キーはデスクと日付の組で作る */
  key: string
  deskId: string
  deskTitle: string
  date: string
  /** 高い順。一覧は全部は出せないので、先頭が見出しになる */
  changes: DeskChange[]
}

/**
 * 公開デスクの変更履歴を人単位に畳んで、新しい順に返す。
 *
 * 同じ日に複数のデスクが動いていればデスクごとに1行にする（1行へまとめると
 * どのデスクの話か分からなくなり、タイルへ辿れない）。
 */
export function profileActivity(
  desks: readonly ProfileActivityDesk[],
  limit = 5,
): ProfileActivityEntry[] {
  const entries: ProfileActivityEntry[] = []
  for (const desk of desks) {
    for (const summary of deskChangeHistory(desk.gadgets, desk.usage)) {
      entries.push({
        key: `${desk.id}\n${summary.date}`,
        deskId: desk.id,
        deskTitle: desk.title,
        date: summary.date,
        changes: [...summary.changes].sort((a, b) => (b.price ?? 0) - (a.price ?? 0)),
      })
    }
  }
  // 日付が同じときは渡された順（デスクの更新が新しい順）を保つ
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (a.entry.date === b.entry.date
      ? a.index - b.index
      : b.entry.date.localeCompare(a.entry.date)))
    .slice(0, limit)
    .map((item) => item.entry)
}
