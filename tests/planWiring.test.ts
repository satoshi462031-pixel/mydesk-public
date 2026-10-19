import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { connectionsOnDesk, missingAllSelectedGadgets, refreshPlanWiring, resetPlanLayout, saveFreshWiring } from '../src/utils/planWiring'

let seq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `plan-wiring-port-${++seq}`, type, direction, count, ...extra,
})
const g = (id: string, category: GadgetCategory, ports: Port[]): Gadget => ({
  id, name: id, category, ports, createdAt: '2026-08-01T00:00:00.000Z',
})
const pc = () => g('pc', 'PC', [p('Power', 'input'), p('HDMI', 'output', 2, { supportsVideo: true })])
const monitor = (id = 'monitor') => g(id, 'Monitor', [p('HDMI', 'input', 1, { supportsVideo: true }), p('Power', 'input')])
const plan = (selected: string[], extra: Partial<DeskPlan> = {}): DeskPlan => ({
  id: 'plan-wiring', name: 'plan', goal: 'clean_wiring', selectedGadgetIds: selected, placements: [],
  outletCount: 4, outletCountVersion: 2,
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
  ...extra,
})
const touches = (target: DeskPlan, id: string) =>
  (target.connectionMap?.connections ?? []).filter((c) => c.fromGadgetId === id || c.toGadgetId === id)

describe('refreshPlanWiring', () => {
  it('このデスクで飾りにしている機材には線を引かない', () => {
    // 生の gadgets で組むと飾りの機材が口を取り、線まで引かれる（線を消した直後に起きていた）
    const gadgets = [pc(), monitor(), monitor('oldmon')]
    const decor = plan(['pc', 'monitor', 'oldmon'], {
      gadgetUsage: { oldmon: { periods: [{ mode: 'decor', startedAt: '2026-08-01' }] } },
    })
    const { plan: refreshed } = refreshPlanWiring(decor, gadgets, 'ja')
    assert.equal(touches(refreshed, 'oldmon').length, 0)
    assert.ok(touches(refreshed, 'monitor').length > 0)
  })

  it('デスク画面の外で足したガジェットにも線が入る', () => {
    const gadgets = [pc(), monitor(), monitor('second')]
    const first = refreshPlanWiring(plan(['pc', 'monitor']), gadgets, 'ja').plan
    // マイガジェット側で2台目を足した状態（配線は作り直されていない）
    const added = { ...first, selectedGadgetIds: [...first.selectedGadgetIds, 'second'] }
    assert.equal(touches(added, 'second').length, 0)
    assert.ok(touches(refreshPlanWiring(added, gadgets, 'ja').plan, 'second').length > 0)
  })

  it('中身が変わらなければ同じ plan を返す（開いただけで更新日を動かさない）', () => {
    const gadgets = [pc(), monitor()]
    const once = refreshPlanWiring(plan(['pc', 'monitor']), gadgets, 'ja').plan
    assert.equal(refreshPlanWiring(once, gadgets, 'ja').plan, once)
  })

  it('機材を全部外したデスクには自動の線を残さない', () => {
    // 以前は0台のとき線を作り直さず、機材0台なのに統計に HDMI・電源が数えられていた
    const gadgets = [pc(), monitor()]
    const built = refreshPlanWiring(plan(['pc', 'monitor']), gadgets, 'ja').plan
    assert.ok((built.connectionMap?.connections.length ?? 0) > 0)
    const emptied = refreshPlanWiring({ ...built, selectedGadgetIds: [] }, gadgets, 'ja').plan
    assert.equal(emptied.connectionMap?.connections.length, 0)
    assert.equal(emptied.wiringResult?.requiredCables.length, 0)
  })

  it('マイガジェットが0件になったデスクも作り直す', () => {
    const built = refreshPlanWiring(plan(['pc', 'monitor']), [pc(), monitor()], 'ja').plan
    // 最後の1台まで削除した状態（削除はデスクの選択からも外す）
    const emptied = refreshPlanWiring({ ...built, selectedGadgetIds: [] }, [], 'ja').plan
    assert.equal(emptied.connectionMap?.connections.length, 0)
    assert.equal(emptied.wiringResult?.requiredCables.length, 0)
  })

  it('選んでいる機材が1台も手元に無いとき（読めていない）は触らない', () => {
    const built = refreshPlanWiring(plan(['pc', 'monitor']), [pc(), monitor()], 'ja').plan
    assert.equal(refreshPlanWiring(built, [], 'ja').plan, built)
  })

  it('手で引いた線は、外した機材でも持っている限り残す（戻したときに復活させる）', () => {
    const gadgets = [pc(), monitor()]
    const manual = plan([], {
      connectionMap: {
        connections: [{
          id: 'm', fromGadgetId: 'pc', toGadgetId: 'monitor', cableType: 'HDMI', origin: 'manual', confirmed: true,
        }],
      },
    })
    const refreshed = refreshPlanWiring(manual, gadgets, 'ja').plan
    assert.equal(touches(refreshed, 'monitor').length, 1)
  })
})

describe('missingAllSelectedGadgets', () => {
  it('選んでいる ID があるのに1台も見つからないときだけ真', () => {
    assert.equal(missingAllSelectedGadgets(plan(['pc']), []), true)
    assert.equal(missingAllSelectedGadgets(plan(['pc', 'gone']), [pc()]), false)
    assert.equal(missingAllSelectedGadgets(plan([]), []), false)
  })
})

describe('connectionsOnDesk', () => {
  it('両端がデスクに載っている機材か電源の線だけを残す', () => {
    const conns = [
      { id: 'a', fromGadgetId: 'pc', toGadgetId: 'monitor' },
      { id: 'b', fromGadgetId: 'wall', toGadgetId: 'pc' },
      { id: 'c', fromGadgetId: 'pc', toGadgetId: 'removed' },
    ]
    assert.deepEqual(connectionsOnDesk(conns, ['pc', 'monitor']).map((c) => c.id), ['a', 'b'])
    assert.deepEqual(connectionsOnDesk(conns, []), [])
  })
})

describe('saveFreshWiring', () => {
  it('作り直した plan を保存し、それを返す', async () => {
    const gadgets = [pc(), monitor()]
    let stored = plan(['pc', 'monitor'])
    const updateWith = async (id: string, fn: (prev: DeskPlan) => DeskPlan) => {
      if (id === stored.id) stored = fn(stored)
    }
    const returned = await saveFreshWiring(updateWith, stored.id, gadgets, 'ja')
    assert.equal(returned, stored)
    assert.ok((stored.connectionMap?.connections.length ?? 0) > 0)
  })

  it('デスクが無ければ null', async () => {
    const updateWith = async () => {}
    assert.equal(await saveFreshWiring(updateWith, 'missing', [], 'ja'), null)
  })
})

describe('resetPlanLayout', () => {
  it('機材は残し、手で動かした位置と壊れた線を捨てて、つなぎ方は引き継いで作り直す', () => {
    const gadgets = [pc(), monitor()]
    const built = refreshPlanWiring(plan(['pc', 'monitor']), gadgets, 'ja').plan
    const video = built.connectionMap!.connections.find((c) => c.cableType === 'HDMI')!
    const broken = {
      ...built,
      connectionMap: {
        ...built.connectionMap!,
        connections: [
          { ...video, cableChoice: { kind: 'included' as const } },
          // 形の崩れた線（ID も端も無い）
          { cableType: 'HDMI' } as unknown as (typeof video),
        ],
        nodeOffsets: { pc: { dx: 99999, dy: -99999 } },
        nodeSizes: { pc: { w: -1, h: 0 } },
      },
    }
    const reset = resetPlanLayout(broken, gadgets, 'ja')
    assert.deepEqual(reset.selectedGadgetIds, ['pc', 'monitor'])
    assert.equal(reset.connectionMap?.nodeOffsets, undefined)
    assert.equal(reset.connectionMap?.nodeSizes, undefined)
    assert.ok(reset.connectionMap!.connections.every((c) => typeof c.id === 'string' && typeof c.fromGadgetId === 'string'))
    const kept = reset.connectionMap!.connections.find((c) => c.fromGadgetId === video.fromGadgetId && c.toGadgetId === video.toGadgetId && c.cableType === 'HDMI')
    assert.equal(kept?.cableChoice?.kind, 'included')
    assert.ok(reset.wiringResult)
  })
})
