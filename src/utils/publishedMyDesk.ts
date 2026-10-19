// マイページの「デスク」タブの行。
//
// 並べるのは自分のデスク全部（未公開を含む）。公開したかどうかは行のバッジで見分ける。
// 以前は公開中のデスクだけを「投稿」として並べていたが、投稿はデスクの一部でしかなく、
// 「投稿 3・デスク 5」と別物のように数えていた。

export type OwnDeskVisibility = 'public' | 'unlisted' | 'private'

export interface LocalPlanSummary {
  planId: string
  name: string
  /** 端末側の最終編集日。サーバーを読めないとき・公開していないデスクの日付 */
  updatedAt?: string | null
}

export interface LocalPublishedDesk {
  planId: string
  deskId: string
  visibility: string | null
}

export interface OwnedDeskSummary {
  id: string
  title: string
  visibility: OwnDeskVisibility
  updated_at?: string | null
}

export interface OwnDeskRow {
  key: string
  /** この端末にあるデスク。別の端末で公開しただけのデスクは null */
  planId: string | null
  name: string
  deskId: string | null
  /** 公開ページの見え方。一度も公開していなければ null */
  visibility: OwnDeskVisibility | null
  onThisDevice: boolean
  /** 公開していればみんなのデスクと同じ公開ページの更新日、していなければ端末の編集日 */
  updatedAt: string | null
}

function localVisibility(value: string | null): OwnDeskVisibility {
  if (value === 'private' || value === 'unlisted') return value
  // 旧バージョンで公開済み（フラグ未保存）のものは公開中（publishService と同じ扱い）
  return 'public'
}

/**
 * 端末のデスクと、サーバー上の自分の公開デスクを1本の一覧にする。
 * サーバーを読めたときは公開状態をサーバーで決める（別の端末で取り消した等を拾う）。
 * 読めなかったときだけ端末の記録で代える。
 */
export function buildOwnDeskRows(
  plans: readonly LocalPlanSummary[],
  localPublished: readonly LocalPublishedDesk[],
  serverDesks: readonly OwnedDeskSummary[] | null,
): OwnDeskRow[] {
  const publishedByPlan = new Map(localPublished.map((desk) => [desk.planId, desk]))
  const serverById = serverDesks ? new Map(serverDesks.map((desk) => [desk.id, desk])) : null
  const claimedDeskIds = new Set<string>()

  const rows: OwnDeskRow[] = plans.map((plan) => {
    const local = publishedByPlan.get(plan.planId)
    const deskId = local?.deskId ?? null
    if (deskId) claimedDeskIds.add(deskId)
    let visibility: OwnDeskVisibility | null = null
    let updatedAt = plan.updatedAt ?? null
    if (deskId) {
      if (serverById) {
        const server = serverById.get(deskId)
        // サーバーに無い＝削除済み。端末の紐付けが残っていても公開ページは無い
        visibility = server?.visibility ?? null
        if (server?.updated_at) updatedAt = server.updated_at
      } else {
        visibility = localVisibility(local?.visibility ?? null)
      }
    }
    return {
      key: `plan-${plan.planId}`,
      planId: plan.planId,
      name: plan.name,
      deskId: visibility ? deskId : null,
      visibility,
      onThisDevice: true,
      updatedAt,
    }
  })

  // 別の端末で公開したデスク。取り消したものは開けないので並べない
  for (const desk of serverDesks ?? []) {
    if (claimedDeskIds.has(desk.id) || desk.visibility === 'private') continue
    rows.push({
      key: `desk-${desk.id}`,
      planId: null,
      name: desk.title,
      deskId: desk.id,
      visibility: desk.visibility,
      onThisDevice: false,
      updatedAt: desk.updated_at ?? null,
    })
  }

  return rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

/**
 * ピン留めしたデスクを先頭へ寄せる（マイデスクの一覧と同じ）。それぞれの中の順は保つ。
 * buildOwnDeskRows に混ぜないのは、ピン留めの切り替えで行の元データが変わったことにすると
 * 公開状態の読み直しが走り、そのあいだ公開中のバッジが一瞬「未公開」に戻るため。
 */
export function sortPinnedFirst(rows: readonly OwnDeskRow[], pinnedPlanIds: ReadonlySet<string>): OwnDeskRow[] {
  const isPinned = (row: OwnDeskRow) => row.planId != null && pinnedPlanIds.has(row.planId)
  return [...rows.filter(isPinned), ...rows.filter((row) => !isPinned(row))]
}
