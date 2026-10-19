import { DeskGadgetUsagePeriod, DeskPlan, Gadget } from '../types'
import { deskUsagePeriods, getDeskGadgetUsage, mergeUsagePeriods } from './deskGadgetUsage'

export type GadgetLibraryStatus = 'current' | 'past' | 'unused'
export type GadgetLibraryFilter = 'current' | 'unused'

export interface GadgetLibraryDeskUsage {
  deskId: string
  deskName: string
  current: boolean
  periods: DeskGadgetUsagePeriod[]
  introducedAt?: string
  removedAt?: string
}

export interface GadgetLibraryUsage {
  status: GadgetLibraryStatus
  desks: GadgetLibraryDeskUsage[]
  periods: DeskGadgetUsagePeriod[]
  removedAt?: string
}

export function buildGadgetLibraryUsage(gadgets: readonly Gadget[], plans: readonly DeskPlan[]): Map<string, GadgetLibraryUsage> {
  const byGadget = new Map<string, GadgetLibraryUsage>()
  for (const gadget of gadgets) {
    const desks: GadgetLibraryDeskUsage[] = []
    for (const plan of plans) {
      const current = plan.selectedGadgetIds.includes(gadget.id)
      const stored = plan.gadgetUsage?.[gadget.id]
      // 購入日だけある未配置の機材に、デスクでの使用履歴を作らない。
      if (!current && !stored) continue
      const periods = deskUsagePeriods(getDeskGadgetUsage(plan, gadget), gadget)
      desks.push({
        deskId: plan.id,
        deskName: plan.name,
        current,
        periods,
        introducedAt: stored?.introducedAt,
        removedAt: stored?.removedAt,
      })
    }
    desks.sort((a, b) => Number(b.current) - Number(a.current)
      || (b.periods.at(-1)?.endedAt ?? b.removedAt ?? '').localeCompare(a.periods.at(-1)?.endedAt ?? a.removedAt ?? ''))
    byGadget.set(gadget.id, {
      status: desks.some((desk) => desk.current) ? 'current' : desks.length > 0 || !!gadget.removedAt ? 'past' : 'unused',
      desks,
      periods: mergeUsagePeriods(desks.flatMap((desk) => desk.periods)),
      removedAt: gadget.removedAt,
    })
  }
  return byGadget
}

export function filterGadgetLibrary(gadgets: readonly Gadget[], usage: ReadonlyMap<string, GadgetLibraryUsage>, status: GadgetLibraryFilter, favoritesOnly: boolean): Gadget[] {
  return gadgets.filter((gadget) => {
    const currentStatus = usage.get(gadget.id)?.status
    return currentStatus !== undefined && (status === 'current' ? currentStatus === 'current' : currentStatus !== 'current')
      && (!favoritesOnly || gadget.favorite)
  })
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite))
}

export function libraryPeriodLabel(period: DeskGadgetUsagePeriod, lang: 'ja' | 'en', compact = false, current = true): string {
  const date = (value: string) => {
    const parts = value.split('-').map(Number)
    return `${parts[0]}/${parts[1]}${compact ? '' : `/${parts[2]}`}`
  }
  const start = period.startedAtSource === 'registered' ? '?' : date(period.startedAt)
  return `${start}〜${period.endedAt ? date(period.endedAt) : current ? (lang === 'ja' ? '現在' : 'Present') : '?'}`
}

export function libraryUsagePeriodLabel(usage: GadgetLibraryUsage, lang: 'ja' | 'en'): string {
  const periods = usage.status === 'current'
    ? mergeUsagePeriods(usage.desks.filter((desk) => desk.current).flatMap((desk) => desk.periods))
    : usage.periods
  const last = periods.at(-1)
  if (last) {
    const label = libraryPeriodLabel(last, lang, true, usage.status === 'current')
    return periods.length > 1 ? `${lang === 'ja' ? '最終：' : 'Last: '}${label}` : label
  }
  if (usage.status === 'current') return lang === 'ja' ? '期間未設定' : 'Dates not set'
  const endedAt = usage.desks.map((desk) => desk.removedAt).filter((date): date is string => !!date).sort().at(-1) ?? usage.removedAt
  if (endedAt) return `?〜${endedAt.slice(0, 7).replace('-', '/')}`
  return lang === 'ja' ? '期間未設定' : 'Dates not set'
}

export function libraryDeskLabel(usage: GadgetLibraryUsage, lang: 'ja' | 'en'): string {
  const desks = usage.status === 'current' ? usage.desks.filter((desk) => desk.current) : usage.desks
  const first = desks[0]
  if (!first) return lang === 'ja' ? (usage.status === 'past' ? '使用デスク不明' : 'デスク未使用') : (usage.status === 'past' ? 'Desk unknown' : 'Not used in a desk')
  const name = first.deskName.trim() || (lang === 'ja' ? '名称未設定のデスク' : 'Untitled desk')
  return desks.length > 1 ? `${name}${lang === 'ja' ? ` ＋ほか${desks.length - 1}件` : ` +${desks.length - 1}`}` : name
}
