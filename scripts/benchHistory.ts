import assert from 'node:assert/strict'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import type { DeskPlan, Gadget } from '../src/types'
import { appendTodayPage, buildTimeline, localDateKey } from '../src/utils/deskTimeline'
import { HistoryLayoutCache } from '../src/utils/historyLayoutCache'
import { computeHistoryLayouts } from '../src/utils/historyLayouts'

// ストレージに残るJSONだけを引き継いで、新しいキャッシュインスタンスで準備する。
// 実際のAsyncStorageのI/O・React描画・Hermesの速度は含まない。
class MeasuredCache extends HistoryLayoutCache {
  hits = 0
  misses = 0
  override async open(...args: Parameters<HistoryLayoutCache['open']>) {
    const session = await super.open(...args)
    return { ...session, get: (...input: Parameters<typeof session.get>) => {
      const hit = session.get(...input)
      if (hit) this.hits += 1
      else this.misses += 1
      return hit
    } }
  }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
async function measure(plan: DeskPlan, gadgets: Gadget[]) {
  let persisted: string | null = null
  const storage = {
    async getItem() { return persisted },
    async setItem(_key: string, value: string) { persisted = value },
    async removeItem() { persisted = null },
  }
  const prepare = async (cache: MeasuredCache) => {
    const t0 = performance.now()
    const changes = buildTimeline(gadgets, plan, 'ja', 'month')
    const today = localDateKey()
    const last = changes.filter((e) => e.date <= today).at(-1)
    const events = appendTodayPage(changes, today, last)
    const layouts = await computeHistoryLayouts(plan, events, last?.date, 'month', {}, cache)
    const ms = performance.now() - t0
    await cache.flush()
    return { layouts, ms, events: events.length }
  }
  const first = new MeasuredCache(async () => storage)
  const cold = await prepare(first)
  const times: number[] = []
  let hits = 0, misses = 0
  for (let i = 0; i < 5; i++) {
    const restarted = new MeasuredCache(async () => storage)
    const warm = await prepare(restarted)
    assert.deepEqual(JSON.parse(JSON.stringify(warm.layouts)), JSON.parse(JSON.stringify(cold.layouts)))
    times.push(warm.ms)
    hits = restarted.hits; misses = restarted.misses
  }
  return { events: cold.events, cold: cold.ms, warm: median(times), hits, misses, chars: (persisted as string | null)?.length ?? 0 }
}

async function main() {
  const demos = buildAllDemoDesks('ja')
  await measure(demos[0].plan, demos[0].gadgets)
  const count = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4) ?? 27)
  const gadgets = demos.flatMap((d) => d.gadgets).filter((g) => g.category !== 'Cable').slice(0, count).map((g, i) => ({
    ...g, purchasedAt: `${2022 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-10`,
    removedAt: undefined, createdAt: `${2022 + Math.floor(i / 12)}-01-01T00:00:00.000Z`,
  }))
  const merged: DeskPlan = { ...demos[0].plan, id: 'bench-history-merged', name: `合成${gadgets.length}台`,
    selectedGadgetIds: gadgets.map((g) => g.id), placements: demos.flatMap((d) => d.plan.placements), connectionMap: undefined,
  }
  console.log(`Node ${process.version} / ${process.platform} ${process.arch}（コールド1回・再起動模擬5回の中央値）`)
  console.log('| ケース | 時点 | 初回準備 ms | 保存後の準備 ms | 保存ヒット/ミス | 保存 Ki文字 |')
  console.log('|---|---:|---:|---:|---|---:|')
  for (const c of [...demos.map((d) => ({ plan: d.plan, gadgets: d.gadgets })), { plan: merged, gadgets }]) {
    const r = await measure(c.plan, c.gadgets)
    console.log(`| ${c.plan.name} | ${r.events} | ${r.cold.toFixed(1)} | ${r.warm.toFixed(1)} | ${r.hits}/${r.misses} | ${(r.chars / 1024).toFixed(1)} |`)
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
