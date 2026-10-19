import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { computeMapLayout, computeMapNodeSizes, MapLayout } from '../src/utils/connectionMapLayout'
import { appendTodayPage, buildTimeline, resolveTimelineLayout, TimelineGrain } from '../src/utils/deskTimeline'
import { buildHistoryReplacementLayoutPlan, restoreHistoryReplacementLayout } from '../src/utils/historyReplacement'
import { HistoryLayoutCache } from '../src/utils/historyLayoutCache'
import { historyReplacementAliases, stableHistoryNodeSizes, stableHistoryNodeSizesOf } from '../src/utils/historyLayoutSizes'
import { computeHistoryLayouts, resolveHistoryLayoutInputs } from '../src/utils/historyLayouts'

// 履歴の準備は、全期間で揃える寸法を配線図を引かずに求める（stableHistoryNodeSizesOf）。
// 以前は各日の配線図を一度計算し、その nodes[].w / h から求めていた。両者が食い違うと
// 再生中にノードの大きさが跳ねるので、デモデスクの全期間・全まとめ単位で一致を確かめる。
describe('history node sizes without routing', () => {
  const demos = buildAllDemoDesks('ja')
  const grains: TimelineGrain[] = ['day', 'month', 'year']

  it('matches the sizes of the routed layouts for every demo desk and grain', async () => {
    let withFixed = 0
    let withReplacement = 0
    for (const { plan, gadgets } of demos) {
      for (const grain of grains) {
        const full = buildTimeline(gadgets, plan, 'ja', grain)
        const lastChangeDate = full.at(-1)?.date
        const events = appendTodayPage(full, '2099-01-01', full.at(-1))
        const days = events.map((e) => ({
          replacementPlan: buildHistoryReplacementLayoutPlan(e.inGadgets, e.outGadgets, e.connections, e.renderGadgets, e.renderConnections),
          nodeSizes: resolveTimelineLayout(plan, e.date, lastChangeDate).nodeSizes,
          nodeOffsets: resolveTimelineLayout(plan, e.date, lastChangeDate).nodeOffsets,
        }))
        const routed: MapLayout[] = []
        for (const day of days) {
          const raw = await computeMapLayout(
            day.replacementPlan.gadgets, day.replacementPlan.connections, plan.placements,
            day.nodeOffsets, day.nodeSizes, !!plan.templateId,
          )
          const sizes = computeMapNodeSizes(day.replacementPlan.gadgets, day.replacementPlan.connections, day.nodeSizes)
          assert.deepEqual(
            new Map(raw.nodes.map((n) => [n.id, { w: n.w, h: n.h }])),
            sizes,
            `${plan.name} ${grain}`,
          )
          routed.push(restoreHistoryReplacementLayout(raw, day.replacementPlan))
          if (day.replacementPlan.pairs.size > 0) withReplacement++
        }
        const expected = stableHistoryNodeSizes(routed, historyReplacementAliases(days.map((day) => day.replacementPlan)))
        if (Object.keys(expected).length > 0) withFixed++
        assert.deepEqual(stableHistoryNodeSizesOf(days), expected, `${plan.name} ${grain}`)
      }
    }
    // 揃える寸法がある日・買い替えのある日を実際に通っていること（データが変わって素通りしないように）
    assert.ok(withFixed > 0)
    assert.ok(withReplacement > 0)
  })

  // 交換の日の撤去品は導入品の寸法を写して描く。導入品だけを揃えていた頃は、ゲーミングの見本の
  // 旧 PC が交換の直前に 92×140 から新しい PC の 101×154 へ一瞬で大きくなっていた
  it('keeps a replaced gadget the same size from the day before through the replacement day', async () => {
    let checked = 0
    for (const { plan, gadgets } of demos) {
      const full = buildTimeline(gadgets, plan, 'ja', 'month')
      const events = appendTodayPage(full, '2099-01-01', full.at(-1))
      let stored: string | null = null
      const cache = new HistoryLayoutCache(async () => ({
        async getItem() { return stored },
        async setItem(_key: string, value: string) { stored = value },
        async removeItem() { stored = null },
      }))
      const layouts = (await computeHistoryLayouts(plan, events, full.at(-1)?.date, 'month', {}, cache))!
      events.forEach((event, i) => {
        if (i === 0) return
        const replacementPlan = buildHistoryReplacementLayoutPlan(
          event.inGadgets, event.outGadgets, event.connections, event.renderGadgets, event.renderConnections,
        )
        for (const [newId, oldId] of replacementPlan.pairs) {
          const before = layouts[i - 1].nodes.find((n) => n.id === oldId)
          const exiting = layouts[i].nodes.find((n) => n.id === oldId)
          const entering = layouts[i].nodes.find((n) => n.id === newId)
          if (!before || !exiting || !entering) continue
          assert.deepEqual({ w: exiting.w, h: exiting.h }, { w: before.w, h: before.h }, `${plan.name} ${oldId}`)
          assert.deepEqual({ w: entering.w, h: entering.h }, { w: before.w, h: before.h }, `${plan.name} ${newId}`)
          checked++
        }
      })
    }
    assert.ok(checked > 0)
  })

  // 手で決めた大きさは全期間で一番優先する。最後の変更日より前の日に当てていなかった頃は、
  // 過去の日の自動の大きさで全期間が揃えられ、ゲーミングの見本の PC は縮めても 101×154 のままだった。
  // エディタ（resolveHistoryLayoutInputs の入力で描く）と再生で、どの日も同じ大きさになることも見る
  it('applies manual sizes on every page, ahead of the stabilized sizes', async () => {
    const gaming = demos.find((d) => d.plan.id.includes('gaming'))!
    const manual = { 'demo-gaming-pc': { w: 80, h: 120 }, 'demo-gaming-keyboard': { w: 260, h: 80 } }
    const plan = { ...gaming.plan, connectionMap: { ...gaming.plan.connectionMap!, nodeSizes: manual } }
    for (const grain of grains) {
      const full = buildTimeline(gaming.gadgets, plan, 'ja', grain)
      const events = appendTodayPage(full, '2099-01-01', full.at(-1))
      const cache = new HistoryLayoutCache(async () => ({
        async getItem() { return null },
        async setItem() {},
        async removeItem() {},
      }))
      const layouts = (await computeHistoryLayouts(plan, events, full.at(-1)?.date, grain, {}, cache))!
      const { inputs } = resolveHistoryLayoutInputs(plan, events, full.at(-1)?.date)
      let pcPages = 0
      layouts.forEach((layout, i) => {
        for (const node of layout.nodes) {
          // 旧 PC は買い替えで新しい PC と1台として揃えるので、同じ大きさになる
          const id = node.id === 'demo-gaming-pc-old' ? 'demo-gaming-pc' : node.id
          if (id in manual) {
            assert.deepEqual({ w: node.w, h: node.h }, manual[id as keyof typeof manual], `${grain} ${events[i].date} ${node.id}`)
            if (id === 'demo-gaming-pc') pcPages++
          }
          const drawn = inputs[i].nodeSizes[node.id]
          if (drawn) assert.deepEqual({ w: node.w, h: node.h }, drawn, `${grain} ${events[i].date} ${node.id}`)
        }
      })
      assert.ok(pcPages > 1, grain)
    }
  })

  it('applies manual sizes the same way as the layout (clamped and rounded)', async () => {
    const { plan, activeGadgets } = demos[0]
    const gadgets = activeGadgets.filter((g) => g.category !== 'Cable')
    const connections = plan.connectionMap?.connections ?? []
    const [small, large] = gadgets
    const nodeSizes = { [small.id]: { w: 10.4, h: 90.6 }, [large.id]: { w: 999, h: 120.5 } }
    const layout = await computeMapLayout(gadgets, connections, plan.placements, {}, nodeSizes, !!plan.templateId)
    assert.deepEqual(
      new Map(layout.nodes.map((n) => [n.id, { w: n.w, h: n.h }])),
      computeMapNodeSizes(gadgets, connections, nodeSizes),
    )
  })
})
