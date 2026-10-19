import { DeskGadgetUsage, DeskGadgetUsageMode, DeskGadgetUsagePeriod, DeskPlan, Gadget } from '../types'
import { calendarDateOf, localDateKey } from './deskTimeline'
import { applyMonitorArmAssignment } from './gadgetAttachments'
import { applyDeskGadgetRelations } from './deskGadgetRelations'

function legacyPeriod(usage: DeskGadgetUsage, gadget: Gadget): DeskGadgetUsagePeriod[] {
  const introducedAt = usage.introducedAt ?? gadget.purchasedAt
  const startedAt = introducedAt
    ?? (gadget.introducedAtUnknown || gadget.isCandidate ? null : calendarDateOf(gadget.createdAt))
  if (!startedAt) return []
  return [{
    mode: gadget.displayOnly ? 'decor' : 'active',
    startedAt,
    endedAt: usage.removedAt,
    // 登録日で代用したことを残す。デスク詳細は必ずここを通るので、印が無いと年表が代用を見分けられない
    ...(introducedAt ? {} : { startedAtSource: 'registered' as const }),
  }]
}

export function deskUsagePeriods(usage: DeskGadgetUsage, gadget: Gadget): DeskGadgetUsagePeriod[] {
  const source = usage.periods !== undefined ? usage.periods : legacyPeriod(usage, gadget)
  return source
    .filter((period) => !!period.startedAt)
    .map((period) => ({ ...period }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function usageModeAt(
  periods: DeskGadgetUsagePeriod[],
  date = localDateKey(),
): DeskGadgetUsageMode | null {
  const period = [...periods]
    .reverse()
    .find((item) => item.startedAt <= date && (!item.endedAt || item.endedAt > date))
  return period?.mode ?? null
}

export function hasCurrentDeskUsage(periods: DeskGadgetUsagePeriod[], date = localDateKey()): boolean {
  return usageModeAt(periods, date) !== null
}

function syncedUsage(periods: DeskGadgetUsagePeriod[]): DeskGadgetUsage {
  const sorted = [...periods].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const last = sorted.at(-1)
  return {
    introducedAt: sorted[0]?.startedAt,
    removedAt: last?.endedAt,
    periods: sorted,
  }
}

export function getDeskGadgetUsage(plan: DeskPlan, gadget: Gadget): DeskGadgetUsage {
  const usage = plan.gadgetUsage?.[gadget.id] ?? {
    introducedAt: gadget.purchasedAt,
    removedAt: gadget.removedAt,
  }
  return syncedUsage(deskUsagePeriods(usage, gadget))
}

export function hasCurrentDeskUsageAfterEdit(plan: DeskPlan, gadget: Gadget, periods: DeskGadgetUsagePeriod[]): boolean {
  if (periods.length > 0) return !periods.at(-1)?.endedAt
  // 日付をまだ入れていない機材の編集で、現在のデスクから外れてしまわないようにする。
  return plan.selectedGadgetIds.includes(gadget.id)
    && deskUsagePeriods(getDeskGadgetUsage(plan, gadget), gadget).length === 0
}

export function applyDeskGadgetUsage(plan: DeskPlan, gadget: Gadget): Gadget {
  const usage = getDeskGadgetUsage(plan, gadget)
  const periods = deskUsagePeriods(usage, gadget)
  const currentMode = usageModeAt(periods)
  return {
    ...applyMonitorArmAssignment(applyDeskGadgetRelations(plan, gadget), plan),
    purchasedAt: usage.introducedAt,
    removedAt: usage.removedAt,
    displayOnly: currentMode ? currentMode === 'decor' : gadget.displayOnly,
    deskUsagePeriods: periods,
  }
}

export function setDeskGadgetUsage(
  plan: DeskPlan,
  gadgetId: string,
  usage: DeskGadgetUsage,
): DeskPlan {
  const normalized = usage.periods !== undefined ? syncedUsage(usage.periods) : usage
  return {
    ...plan,
    gadgetUsage: {
      ...(plan.gadgetUsage ?? {}),
      [gadgetId]: normalized,
    },
  }
}

export function updateDeskGadgetSelection(
  plan: DeskPlan,
  selectedGadgetIds: string[],
  gadgets: Gadget[],
  // 端末の暦日。ここだけ UTC（toISOString().slice(0, 10)）を使っていたため、
  // JST の朝 00:00〜09:00 にガジェットを出し入れすると前日として記録されていた。
  // このモジュールの他の「今日」（usageModeAt・hasCurrentDeskUsage）は localDateKey
  changedAt = localDateKey(),
): DeskPlan {
  const previousIds = new Set(plan.selectedGadgetIds)
  const nextIds = new Set(selectedGadgetIds)
  const gadgetsById = new Map(gadgets.map((gadget) => [gadget.id, gadget]))
  const gadgetUsage = { ...(plan.gadgetUsage ?? {}) }

  for (const id of previousIds) {
    if (nextIds.has(id)) continue
    const gadget = gadgetsById.get(id)
    if (!gadget) continue
    const previous = getDeskGadgetUsage({ ...plan, gadgetUsage }, gadget)
    const periods = deskUsagePeriods(previous, gadget).map((period) =>
      // ここで入る endedAt は「デスクから外した操作日」。実際の撤去日ではない
      !period.endedAt ? { ...period, endedAt: changedAt, endedAtSource: 'auto' as const } : period,
    )
    gadgetUsage[id] = syncedUsage(periods)
  }

  for (const id of nextIds) {
    if (previousIds.has(id)) continue
    const gadget = gadgetsById.get(id)
    if (!gadget) continue
    const previous = getDeskGadgetUsage({ ...plan, gadgetUsage }, gadget)
    const periods = deskUsagePeriods(previous, gadget)
    if ((gadget.introducedAtUnknown || gadget.isCandidate) && periods.length === 0 && !gadget.purchasedAt) continue
    const last = periods.at(-1)
    if (last?.endedAt === changedAt) {
      periods[periods.length - 1] = { ...last, endedAt: undefined }
    } else if (!hasCurrentDeskUsage(periods, changedAt)) {
      periods.push({
        mode: gadget.displayOnly ? 'decor' : 'active',
        startedAt: changedAt,
        startedAtSource: 'auto',
      })
    }
    gadgetUsage[id] = syncedUsage(periods)
  }

  return { ...plan, selectedGadgetIds, gadgetUsage }
}

// ─── ライブラリ横断（全デスク）の在籍期間 ─────────────────────────────
// 導入日はガジェット本体ではなく plan.gadgetUsage が持つ。デスクを跨いで統計を
// 出す画面はプランを1つに決められないので、各デスクの期間を先に和集合へ畳む。

/** endedAt 未設定（継続中）を比較で「一番後ろ」として扱うための番兵 */
const OPEN_ENDED = '9999-12-31'

/**
 * 重なる／隣接する期間を1本にまとめる。同じ1台を2つのデスクに置いている場合、
 * デスクごとに別の行として並べても「どれだけ一緒にいたか」は読めないため。
 */
export function mergeUsagePeriods(periods: readonly DeskGadgetUsagePeriod[]): DeskGadgetUsagePeriod[] {
  const sorted = [...periods]
    .filter((period) => !!period.startedAt)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const merged: DeskGadgetUsagePeriod[] = []
  for (const period of sorted) {
    const last = merged[merged.length - 1]
    // 隣接（前の終了日＝次の開始日）も繋げる。デスクを移しただけで年表が
    // 2本に割れると、使い続けていることが見えなくなる
    if (!last || period.startedAt > (last.endedAt ?? OPEN_ENDED)) {
      merged.push({ ...period })
      continue
    }
    merged[merged.length - 1] = {
      ...last,
      // 実働と飾りが重なる期間は実働として残す
      mode: last.mode === 'active' || period.mode === 'active' ? 'active' : last.mode,
      endedAt: last.endedAt && period.endedAt
        ? (period.endedAt > last.endedAt ? period.endedAt : last.endedAt)
        : undefined,
    }
  }
  return merged
}

/**
 * ライブラリのガジェットに、全デスクを畳んだ在籍期間を載せる。
 * デスク詳細の `applyDeskGadgetUsage` と対になる、全デスク横断版。
 *
 * どのデスクにも置かれていないガジェットは何も足さずに返す。在籍期間を
 * 知らないものに登録日を代入すると、年表が「いつから一緒にいたか」を取り違える。
 */
export function applyLibraryUsage(gadget: Gadget, plans: readonly DeskPlan[]): Gadget {
  const owning = plans.filter((plan) =>
    plan.gadgetUsage?.[gadget.id] != null || plan.selectedGadgetIds.includes(gadget.id),
  )
  if (owning.length === 0) return gadget
  const periods = mergeUsagePeriods(
    owning.flatMap((plan) => deskUsagePeriods(getDeskGadgetUsage(plan, gadget), gadget)),
  )
  if (periods.length === 0) return gadget
  const currentMode = usageModeAt(periods)
  return {
    ...gadget,
    purchasedAt: periods[0].startedAt,
    removedAt: periods[periods.length - 1].endedAt,
    displayOnly: currentMode ? currentMode === 'decor' : gadget.displayOnly,
    deskUsagePeriods: periods,
  }
}
