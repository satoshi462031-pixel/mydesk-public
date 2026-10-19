import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { computeMapLayout, MapLayout } from '../src/utils/connectionMapLayout'
import { refreshPlanWiring } from '../src/utils/planWiring'
import { applyDeskGadgetUsage } from '../src/utils/deskGadgetUsage'
import { buildTimeline, resolveTimelineLayout } from '../src/utils/deskTimeline'
import { DeskPlan, Gadget, NodeOffset } from '../src/types'

const layoutOf = (plan: DeskPlan, gadgets: Gadget[], offsets: Record<string, NodeOffset>) =>
  computeMapLayout(
    gadgets.filter((g) => plan.selectedGadgetIds.includes(g.id)),
    plan.connectionMap?.connections ?? [],
    plan.placements,
    offsets,
    {},
    false,
  )
const posOf = (layout: MapLayout, id: string) => {
  const node = layout.nodes.find((n) => n.id === id)!
  return { x: node.x, y: node.y }
}
/** ConnectionMap がドラッグを保存するときと同じく、動かした時点の基準位置を持たせる */
const dragged = (layout: MapLayout, id: string, dx: number, dy: number): NodeOffset => {
  const node = layout.nodes.find((n) => n.id === id)!
  return { dx, dy, bx: Math.round(node.baseX!), by: Math.round(node.baseY!) }
}
const overlaps = (layout: MapLayout, a: string, b: string) => {
  const p = layout.nodes.find((n) => n.id === a)!
  const q = layout.nodes.find((n) => n.id === b)!
  return p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y
}

// creator デスクに、別のデスクのスピーカーかモニターを1台足す
const setup = () => {
  const [gaming, creator] = buildAllDemoDesks('ja')
  const extra = gaming.gadgets.find((g) => g.category === 'Speaker' || g.category === 'Monitor')!
  const gadgets = [...creator.gadgets, extra]
  const addedPlan = (plan: DeskPlan) =>
    refreshPlanWiring({ ...plan, selectedGadgetIds: [...plan.selectedGadgetIds, extra.id] }, gadgets, 'ja').plan
  return { plan: creator.plan, gadgets, addedPlan }
}

describe('手で動かしたカードの位置', () => {
  it('ガジェットを足しても、置いた場所（基準位置＋ずらし量）に出る', async () => {
    const { plan, gadgets, addedPlan } = setup()
    const base = await layoutOf(plan, gadgets, {})
    const offset = dragged(base, 'demo-creator-monitor', 140, 60)
    const after = await layoutOf(addedPlan(plan), gadgets, { 'demo-creator-monitor': offset })
    // 最後に全体をまとめて平行移動する（左上がはみ出したときに収める）ぶんは全カード共通で、
    // 見た目の並びには出ないので差し引いて比べる。量は動かしていないカードの最頻値で測る
    // （1枚だけで測ると、置いたカードをよけて押し出されたカードに当たることがある）
    const others = after.nodes.filter((n) => n.id !== 'demo-creator-monitor')
    const mode = (values: number[]) => {
      const counts = new Map<number, number>()
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    }
    const shift = {
      x: mode(others.map((n) => Math.round(n.x - n.baseX!))),
      y: mode(others.map((n) => Math.round(n.y - n.baseY!))),
    }
    const monitor = posOf(after, 'demo-creator-monitor')
    // 以前は、自分の基準位置が動いたぶんだけ（この構成では 181px）右へずれていた
    assert.ok(Math.abs(monitor.x - shift.x - (offset.bx! + offset.dx)) <= 1, JSON.stringify({ monitor, shift, offset }))
    assert.ok(Math.abs(monitor.y - shift.y - (offset.by! + offset.dy)) <= 1, JSON.stringify({ monitor, shift, offset }))
  })

  it('自動配置のカードは、置いたカードに重ならない', async () => {
    const { plan, gadgets, addedPlan } = setup()
    const base = await layoutOf(plan, gadgets, {})
    const offsets = { 'demo-creator-monitor': dragged(base, 'demo-creator-monitor', 140, 60) }
    const after = await layoutOf(addedPlan(plan), gadgets, offsets)
    for (const node of after.nodes) {
      if (node.id === 'demo-creator-monitor') continue
      assert.equal(overlaps(after, node.id, 'demo-creator-monitor'), false, node.id)
    }
  })

  it('デスクから外したカードの位置調整は捨てる（戻すと自動配置）', async () => {
    const { plan, gadgets } = setup()
    const base = await layoutOf(plan, gadgets, {})
    const id = 'demo-creator-monitor'
    const withOffset: DeskPlan = {
      ...plan,
      connectionMap: { ...plan.connectionMap!, nodeOffsets: { [id]: dragged(base, id, 140, 60) } },
    }
    const removed = refreshPlanWiring({ ...withOffset, selectedGadgetIds: plan.selectedGadgetIds.filter((g) => g !== id) }, gadgets, 'ja').plan
    assert.equal(removed.connectionMap?.nodeOffsets?.[id], undefined)
    // 位置調整を捨てただけでは更新日を動かさない
    const noWiringChange = refreshPlanWiring(
      { ...removed, connectionMap: { ...removed.connectionMap!, nodeOffsets: { [id]: { dx: 1, dy: 1 } } } },
      gadgets, 'ja',
    ).plan
    assert.equal(noWiringChange.updatedAt, removed.updatedAt)
  })

  it('履歴アニメでも、スナップショット以降に構成が変わった日に置いた場所に出る', async () => {
    // 履歴はその日以前の layoutSnapshots を当てる（resolveTimelineLayout）。構成の違う日に
    // ずらし量だけを足すと、この構成では y が 166px ずれていた
    const creator = buildAllDemoDesks('ja')[1]
    const gadgets = creator.gadgets.map((g) => applyDeskGadgetUsage(creator.plan, g))
    const events = buildTimeline(gadgets, creator.plan, 'ja', 'day')
    const i = events.findIndex((e, idx) => idx + 1 < events.length && events[idx + 1].inGadgets.length > 0 && e.gadgets.length >= 3)
    assert.ok(i >= 0)
    const [day1, day2] = [events[i], events[i + 1]]
    const id = 'demo-creator-keyboard'
    const first = await computeMapLayout(day1.renderGadgets, day1.renderConnections, creator.plan.placements, {}, {}, false)
    const offset = dragged(first, id, 120, 50)
    const plan: DeskPlan = {
      ...creator.plan,
      connectionMap: { ...creator.plan.connectionMap!, layoutSnapshots: { [day1.date]: { nodeOffsets: { [id]: offset }, nodeSizes: {} } } },
    }
    const on = async (e: typeof day1) => {
      const { nodeOffsets, nodeSizes } = resolveTimelineLayout(plan, e.date, events.at(-1)!.date)
      const layout = await computeMapLayout(e.renderGadgets, e.renderConnections, plan.placements, nodeOffsets, nodeSizes, false)
      // 重なり回避は自動のカードを右へ押すだけなので、平行移動量は押されていないカードの最小値で測る
      const others = layout.nodes.filter((n) => n.id !== id)
      const shiftX = Math.min(...others.map((n) => Math.round(n.x - n.baseX!)))
      const shiftY = Math.min(...others.map((n) => Math.round(n.y - n.baseY!)))
      const node = layout.nodes.find((n) => n.id === id)!
      return { x: node.x - shiftX, y: node.y - shiftY }
    }
    assert.deepEqual(await on(day2), await on(day1))
  })

  it('基準位置を持たない旧データは、今までどおり今の基準位置に足す', async () => {
    const { plan, gadgets } = setup()
    const base = await layoutOf(plan, gadgets, {})
    const legacy = posOf(await layoutOf(plan, gadgets, { 'demo-creator-monitor': { dx: 140, dy: 60 } }), 'demo-creator-monitor')
    const anchored = posOf(await layoutOf(plan, gadgets, { 'demo-creator-monitor': dragged(base, 'demo-creator-monitor', 140, 60) }), 'demo-creator-monitor')
    // 構成が同じなら、旧データも基準位置つきも同じ場所に出る（開いた瞬間に跳ねない）
    assert.deepEqual(legacy, anchored)
  })
})
