import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../constants/categoryLabels'
import { DeskGadgetUsage, DeskGadgetUsagePeriod, Gadget, GadgetCategory } from '../types'
import { deskUsagePeriods } from './deskGadgetUsage'

// ─── デスクの「何が変わったか」 ──────────────────────────────────────
// デスクは年に数回しか変わらないので、更新日だけを出しても何が起きたのか伝わらない。
// 「モニターを入れ替え」まで言えると、1台しか動いていなくても出来事になる。
//
// 変化は3種類あって強さが違う。入れ替え（同じカテゴリの撤去と追加が同じ日に起きる）が
// 一番強く、単なる追加がその次、撤去だけはほぼ何も語らない。並べる順もこの通り。
//
// 一覧のタイルが要るのは最後の1回だけだが、公開プロフィールは同じ判定を日付ぶん
// 遡って並べる（人単位の「最近の変化」）。共通なのは日付ごとの突き合わせなので、
// 履歴を返す deskChangeHistory を土台にして、タイル用はその先頭を取る。
//
// いまは絵をカテゴリアイコンで出しているが、商品写真に差し替えられるよう
// gadgetId と name を持たせてある（Amazon API が使えるようになったら描画側だけ変える）。

export type DeskChangeKind = 'swap' | 'added' | 'removed'

export interface DeskChange {
  kind: DeskChangeKind
  gadgetId: string
  name: string
  category: GadgetCategory
  pcFormFactor?: Gadget['pcFormFactor']
  /** 自作ジャンル。タイルの絵をジャンルの絵にする */
  customCategory?: Gadget['customCategory']
  /**
   * 並べ替え用。一覧のタイルは全部は出せないので、高いものから見せる
   * （入れ替えは新しく入れた側の価格で見る。出ていったものの値段は関心が薄い）。
   */
  price?: number
  /** 入れ替えで置き換えられた側 */
  fromGadgetId?: string
  fromName?: string
  fromCategory?: GadgetCategory
}

export interface DeskChangeSummary {
  /** 変更のあった日（YYYY-MM-DD）。同じ日の変更をひとまとまりとして扱う */
  date: string
  /** 強い順に並んだ変更。先頭が見出しになる */
  changes: DeskChange[]
}

interface UsageEvent {
  date: string
  type: 'in' | 'out'
  gadget: Gadget
}

/**
 * mode（active / decor）の切り替わりは在籍の切れ目ではない。
 * 前の期間の終わりと次の始まりが同じ日なら、1本の在籍として繋ぐ。
 */
function presenceIntervals(periods: DeskGadgetUsagePeriod[]): { startedAt: string; endedAt?: string }[] {
  const merged: { startedAt: string; endedAt?: string }[] = []
  for (const period of periods) {
    const last = merged.at(-1)
    if (last && last.endedAt && last.endedAt === period.startedAt) {
      last.endedAt = period.endedAt
      continue
    }
    merged.push({ startedAt: period.startedAt, endedAt: period.endedAt })
  }
  return merged
}

function usageEvents(gadgets: readonly Gadget[], usage?: Record<string, DeskGadgetUsage>): UsageEvent[] {
  const events: UsageEvent[] = []
  for (const gadget of gadgets) {
    const source: DeskGadgetUsage = usage?.[gadget.id]
      ?? { introducedAt: gadget.purchasedAt, removedAt: gadget.removedAt }
    for (const interval of presenceIntervals(deskUsagePeriods(source, gadget))) {
      events.push({ date: interval.startedAt, type: 'in', gadget })
      if (interval.endedAt) events.push({ date: interval.endedAt, type: 'out', gadget })
    }
  }
  return events
}

/** その日に起きたことを、入れ替え → 追加 → 撤去の順に並べる */
function changesOn(events: readonly UsageEvent[], date: string): DeskChange[] {
  const onDate = events.filter((e) => e.date === date)
  const ins = onDate.filter((e) => e.type === 'in').map((e) => e.gadget)
  const outs = onDate.filter((e) => e.type === 'out').map((e) => e.gadget)

  // 同じカテゴリの撤去と追加が同じ日にあれば入れ替え。1件ずつ突き合わせる
  const remainingOuts = [...outs]
  const changes: DeskChange[] = []
  const added: Gadget[] = []
  for (const gadget of ins) {
    const pairIndex = remainingOuts.findIndex((out) => out.category === gadget.category)
    if (pairIndex === -1) {
      added.push(gadget)
      continue
    }
    const [from] = remainingOuts.splice(pairIndex, 1)
    changes.push({
      kind: 'swap',
      gadgetId: gadget.id,
      name: gadget.name,
      category: gadget.category,
      pcFormFactor: gadget.pcFormFactor,
      ...(gadget.customCategory ? { customCategory: gadget.customCategory } : {}),
      price: gadget.price,
      fromGadgetId: from.id,
      fromName: from.name,
      fromCategory: from.category,
    })
  }

  for (const gadget of added) {
    changes.push({ kind: 'added', gadgetId: gadget.id, name: gadget.name, category: gadget.category, pcFormFactor: gadget.pcFormFactor, ...(gadget.customCategory ? { customCategory: gadget.customCategory } : {}), price: gadget.price })
  }
  for (const gadget of remainingOuts) {
    changes.push({ kind: 'removed', gadgetId: gadget.id, name: gadget.name, category: gadget.category, pcFormFactor: gadget.pcFormFactor, ...(gadget.customCategory ? { customCategory: gadget.customCategory } : {}), price: gadget.price })
  }

  return changes
}

/**
 * 日付ごとの変化を新しい順に返す。
 *
 * デスクを作った日は全ガジェットが同じ日に「追加」されるだけで変化ではないので落とす。
 * 判定は「一番古い日に撤去が1件も無いこと」で見る。追加の件数がガジェット総数に
 * 達したかで見ると、最初に1台だけ置いてあとから足したデスクで作成日が残る。
 */
export function deskChangeHistory(
  gadgets: readonly Gadget[],
  usage?: Record<string, DeskGadgetUsage>,
): DeskChangeSummary[] {
  const events = usageEvents(gadgets, usage)
  if (events.length === 0) return []

  const dates = [...new Set(events.map((e) => e.date))].sort()
  const opened = dates[0]
  const foundingDate = events.some((e) => e.date === opened && e.type === 'out') ? null : opened

  const out: DeskChangeSummary[] = []
  for (const date of dates) {
    if (date === foundingDate) continue
    const changes = changesOn(events, date)
    if (changes.length > 0) out.push({ date, changes })
  }
  return out.reverse()
}

/** 最後に何が変わったか。一覧のタイルが出す1行ぶん */
export function summarizeDeskChanges(
  gadgets: readonly Gadget[],
  usage?: Record<string, DeskGadgetUsage>,
): DeskChangeSummary | null {
  return deskChangeHistory(gadgets, usage)[0] ?? null
}

/**
 * 公開デスク詳細に出す「最近の変化」の1行。拍手は版ごとに送れる（095）ので、
 * 何に拍手しているのかを見せる。名前ではなくカテゴリで言うのは、みんなのデスクの
 * 更新の行（DeskFeedScreen）と揃えるため。商品名は長く、1行に収まらない
 */
export function deskChangeHeadline(summary: DeskChangeSummary | null, lang: 'ja' | 'en'): string | null {
  const first = summary?.changes[0]
  if (!summary || !first) return null
  const labels = (lang === 'ja' ? CATEGORY_LABELS : CATEGORY_LABELS_EN) as Record<string, string>
  const category = first.customCategory?.name ?? labels[first.category] ?? first.category
  const rest = summary.changes.length - 1
  if (lang === 'ja') {
    const verb = first.kind === 'swap' ? 'を入れ替え' : first.kind === 'added' ? 'を追加' : 'を外した'
    return `最近の変化：${category}${verb}${rest > 0 ? ` ほか${rest}件` : ''}`
  }
  const verb = first.kind === 'swap' ? 'Swapped' : first.kind === 'added' ? 'Added' : 'Removed'
  return `Latest: ${verb} ${category}${rest > 0 ? ` (+${rest} more)` : ''}`
}

export interface DeskUpdateSentence {
  /** 太字で出す頭（投稿者名）。名前が無ければ空で、主語を省いた文になる */
  lead: string
  body: string
  /** 2件目以降の変化の数。文に詰め込むと3行に溢れるので、時刻と同じ控えめな行へ回す */
  more: string | null
}

/**
 * 更新一覧（ベル）の1行の文。「名前 / デスクを更新しました: 題 / 最近の変化：…」と
 * 定型の札を積んでいた頃は、ログの出力のように見えた。通知は人が何をしたかを1文で言う
 */
export function deskUpdateSentence(
  input: { author: string; title: string; isNew: boolean; changes?: readonly DeskChange[] },
  lang: 'ja' | 'en',
): DeskUpdateSentence {
  const { author, title, isNew } = input
  const first = isNew ? undefined : input.changes?.[0]
  const rest = isNew ? 0 : Math.max(0, (input.changes?.length ?? 0) - 1)
  const labels = (lang === 'ja' ? CATEGORY_LABELS : CATEGORY_LABELS_EN) as Record<string, string>
  const category = first ? first.customCategory?.name ?? labels[first.category] ?? first.category : ''
  if (lang === 'ja') {
    const subject = author ? 'さんが' : ''
    const action = isNew
      ? `新しいデスク「${title}」を公開しました`
      : first
        ? `「${title}」の${category}${first.kind === 'swap' ? 'を入れ替えました' : first.kind === 'added' ? 'を追加しました' : 'を外しました'}`
        : `「${title}」を更新しました`
    return { lead: author, body: `${subject}${action}`, more: rest > 0 ? `ほか${rest}件の変更` : null }
  }
  const action = isNew
    ? `published a new desk, “${title}”`
    : first
      ? `${first.kind === 'swap' ? 'swapped' : first.kind === 'added' ? 'added' : 'removed'} ${category} ${first.kind === 'added' ? 'to' : first.kind === 'removed' ? 'from' : 'in'} “${title}”`
      : `updated “${title}”`
  return {
    lead: author,
    body: author ? ` ${action}` : action.charAt(0).toUpperCase() + action.slice(1),
    more: rest > 0 ? `+${rest} more change${rest === 1 ? '' : 's'}` : null,
  }
}
