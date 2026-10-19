import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appendTodayPage, buildTimeline, playbackTimelineSummary, resolveTimelineLayout } from '../src/utils/deskTimeline'
import { historyChangePageCount, isBulkHistoryChange } from '../src/utils/historyPresentation'
import { LruCache } from '../src/utils/lruCache'
import { makeLayoutInputKey } from '../src/utils/mapLayoutCache'
import {
  buildHistoryReplacementLayoutPlan,
  buildHistoryReplacementPairs,
  restoreHistoryReplacementLayout,
} from '../src/utils/historyReplacement'
import { stableHistoryNodeSizes } from '../src/utils/historyLayoutSizes'
import { applyDeskGadgetUsage, updateDeskGadgetSelection } from '../src/utils/deskGadgetUsage'
import { DeskPlan, Gadget, MapConnection } from '../src/types'
import type { MapLayout, MapNode } from '../src/utils/connectionMapLayout'

function gadget(id: string, purchasedAt: string, removedAt?: string): Gadget {
  return {
    id,
    name: id,
    category: 'Plant',
    ports: [],
    purchasedAt,
    removedAt,
    createdAt: `${purchasedAt}T00:00:00.000Z`,
  }
}

function plan(gadgets: Gadget[]): DeskPlan {
  return {
    id: 'history-test',
    name: 'history-test',
    goal: 'improve_desk',
    selectedGadgetIds: gadgets.map((item) => item.id),
    placements: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('desk history edge cases', () => {
  it('fixes only changing nodes to their largest history size', () => {
    const layouts = [
      { nodes: [{ id: 'charger', w: 72, h: 72 }, { id: 'monitor', w: 168, h: 108 }] },
      { nodes: [{ id: 'charger', w: 86, h: 86 }, { id: 'monitor', w: 168, h: 108 }] },
    ]

    assert.deepEqual(stableHistoryNodeSizes(layouts), { charger: { w: 86, h: 86 } })
  })


  // 月・年でまとめると別々の日の導入・撤去が1つの期間に入る。渡した配列の順ではなく上から早い日の順
  it('lists the changes in a month from the earliest day', () => {
    const late = gadget('late', '2024-03-25')
    const early = gadget('early', '2024-03-02', '2024-03-20')
    const middle = gadget('middle', '2024-03-10')
    const gadgets = [late, middle, early]
    const events = buildTimeline(gadgets, plan(gadgets), 'ja', 'month')
    const march = events.find((event) => event.date.startsWith('2024-03'))!

    assert.deepEqual(march.inGadgets.map((item) => item.id), ['early', 'middle', 'late'])
  })

  it('lists removals in a month from the earliest day', () => {
    const base = gadget('base', '2024-01-01')
    const removedLate = gadget('removed-late', '2024-01-01', '2024-04-28')
    const removedEarly = gadget('removed-early', '2024-01-01', '2024-04-03')
    const gadgets = [base, removedLate, removedEarly]
    const events = buildTimeline(gadgets, plan(gadgets), 'ja', 'month')
    const april = events.find((event) => event.date.startsWith('2024-04'))!

    assert.deepEqual(april.outGadgets.map((item) => item.id), ['removed-early', 'removed-late'])
  })

  it('lists an added cable in the history but keeps it off the map', () => {
    const plant = gadget('plant', '2024-03-10')
    const cable: Gadget = { ...gadget('hdmi-cable', '2024-05-01'), category: 'Cable', cableType: 'HDMI', cableCount: 1 }
    const gadgets = [plant, cable]
    const events = buildTimeline(gadgets, plan(gadgets), 'ja', 'day')

    assert.deepEqual(events.map((event) => event.date), ['2024-03-10', '2024-05-01'])
    assert.deepEqual(events[1].inGadgets.map((item) => item.id), ['hdmi-cable'])
    assert.equal(events.some((event) => event.renderGadgets.some((item) => item.category === 'Cable')), false)
    assert.equal(events.some((event) => event.gadgets.some((item) => item.category === 'Cable')), false)
  })

  it('renders a gadget introduced and removed on the same day', () => {
    const gadgets = [gadget('short-lived', '2024-03-10', '2024-03-10')]
    const [event] = buildTimeline(gadgets, plan(gadgets), 'ja', 'day')

    assert.deepEqual(event.gadgets, [])
    assert.deepEqual(event.renderGadgets.map((item) => item.id), ['short-lived'])
    assert.deepEqual(event.inGadgets.map((item) => item.id), ['short-lived'])
    assert.deepEqual(event.outGadgets.map((item) => item.id), ['short-lived'])
  })

  it('renders a gadget introduced and removed within the same month bucket', () => {
    const gadgets = [gadget('monthly', '2024-03-01', '2024-03-20')]
    const [event] = buildTimeline(gadgets, plan(gadgets), 'ja', 'month')

    assert.deepEqual(event.gadgets, [])
    assert.deepEqual(event.renderGadgets.map((item) => item.id), ['monthly'])
  })

  it('keeps removed gadgets out of the active state while rendering the exit state', () => {
    const gadgets = [gadget('removed', '2024-01-01', '2024-02-01')]
    const events = buildTimeline(gadgets, plan(gadgets), 'ja', 'day')

    assert.deepEqual(events[1].gadgets, [])
    assert.deepEqual(events[1].renderGadgets.map((item) => item.id), ['removed'])
  })

  it('produces the same layout key for an active state and its following removal animation', () => {
    const gadgets = Array.from({ length: 20 }, (_, index) =>
      gadget(`bulk-${index}`, '2024-01-01', '2024-02-01'))
    const deskPlan = plan(gadgets)
    const events = buildTimeline(gadgets, deskPlan, 'ja', 'day')
    const keys = events.map((event) => {
      const { nodeOffsets, nodeSizes } = resolveTimelineLayout(deskPlan, event.date, events.at(-1)?.date)
      return makeLayoutInputKey(
        event.renderGadgets,
        event.renderConnections,
        deskPlan.placements,
        nodeOffsets,
        nodeSizes,
        false,
      )
    })

    assert.equal(keys[0], keys[1])
  })

  it('tracks active and decor periods without rewriting the past', () => {
    const item: Gadget = {
      ...gadget('display', '2022-01-01'),
      deskUsagePeriods: [
        { mode: 'active', startedAt: '2022-01-01', endedAt: '2024-04-01' },
        { mode: 'decor', startedAt: '2024-04-01', endedAt: '2025-08-21' },
      ],
    }
    const events = buildTimeline([item], plan([item]), 'ja', 'day')

    assert.deepEqual(events.map((event) => event.date), ['2022-01-01', '2024-04-01', '2025-08-21'])
    assert.equal(events[0].gadgets[0].displayOnly, false)
    assert.deepEqual(events[1].modeChanges.map((change) => change.mode), ['decor'])
    assert.equal(events[1].gadgets[0].displayOnly, true)
    assert.deepEqual(events[2].outGadgets.map((g) => g.id), ['display'])
  })

  it('preserves closed periods when a gadget is added to the desk again', () => {
    const item = gadget('returning', '2022-01-01')
    const deskPlan: DeskPlan = {
      ...plan([]),
      gadgetUsage: {
        returning: {
          periods: [{ mode: 'decor', startedAt: '2022-01-01', endedAt: '2023-01-01' }],
        },
      },
    }
    const updated = updateDeskGadgetSelection(deskPlan, ['returning'], [item], '2025-01-01')
    const applied = applyDeskGadgetUsage(updated, item)

    // 再導入で入る開始日は操作日なので、出所は 'auto'（手入力と区別する）
    assert.deepEqual(applied.deskUsagePeriods, [
      { mode: 'decor', startedAt: '2022-01-01', endedAt: '2023-01-01' },
      { mode: 'active', startedAt: '2025-01-01', startedAtSource: 'auto' },
    ])
  })
})

describe('history change presentation', () => {
  it('shares pages between removals and additions without adding extra playback time', () => {
    assert.equal(historyChangePageCount(1, 1, 4), 1)
    assert.equal(historyChangePageCount(3, 1, 4), 1)
    assert.equal(historyChangePageCount(4, 1, 4), 2)
    assert.equal(historyChangePageCount(5, 1, 4), 2)
    assert.equal(historyChangePageCount(0, 0, 4), 1)
  })

  it('keeps ordinary changes paged and summarizes bulk changes into one page', () => {
    assert.equal(isBulkHistoryChange(8, 4), false)
    assert.equal(historyChangePageCount(8, 4, 4), 3)
    assert.equal(isBulkHistoryChange(9, 4), true)
    assert.equal(historyChangePageCount(100, 100, 4), 1)
  })
})

describe('history LRU cache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<string, number>(2)
    cache.set('old', 1)
    cache.set('kept', 2)
    assert.equal(cache.get('old'), 1)
    cache.set('new', 3)

    assert.equal(cache.get('kept'), undefined)
    assert.equal(cache.get('old'), 1)
    assert.equal(cache.get('new'), 3)
    assert.equal(cache.size, 2)
  })
})

describe('history replacement pairing', () => {
  const monitor = (id: string): Gadget => ({
    ...gadget(id, '2024-01-01'),
    category: 'Monitor',
    ports: [{ id: `${id}-hdmi`, type: 'HDMI', direction: 'input', count: 1 }],
  })
  const connection = (id: string, gadgetId: string, pcId: string): MapConnection => ({
    id,
    fromGadgetId: pcId,
    toGadgetId: gadgetId,
    cableType: 'HDMI',
    confirmed: false,
    origin: 'auto',
  })

  it('pairs an unambiguous same-category replacement', () => {
    const pairs = buildHistoryReplacementPairs([monitor('new')], [monitor('old')], [])
    assert.equal(pairs.get('new'), 'old')
  })

  it('does not pair the same short-lived gadget with itself', () => {
    const item = monitor('same')
    assert.equal(buildHistoryReplacementPairs([item], [item], []).size, 0)
  })

  it('leaves indistinguishable multiple replacements unpaired', () => {
    const pairs = buildHistoryReplacementPairs(
      [monitor('new-a'), monitor('new-b')],
      [monitor('old-a'), monitor('old-b')],
      [],
    )
    assert.equal(pairs.size, 0)
  })

  it('uses matching connection peers to disambiguate multiple replacements', () => {
    const pairs = buildHistoryReplacementPairs(
      [monitor('new-a'), monitor('new-b')],
      [monitor('old-a'), monitor('old-b')],
      [
        connection('old-a-pc-a', 'old-a', 'pc-a'),
        connection('new-a-pc-a', 'new-a', 'pc-a'),
        connection('old-b-pc-b', 'old-b', 'pc-b'),
        connection('new-b-pc-b', 'new-b', 'pc-b'),
      ],
    )
    assert.equal(pairs.get('new-a'), 'old-a')
    assert.equal(pairs.get('new-b'), 'old-b')
  })

  it('lays out a replacement in one slot and reuses the same wire route', () => {
    const oldMonitor = monitor('old')
    const newMonitor = monitor('new')
    const pc: Gadget = { ...gadget('pc', '2024-01-01'), category: 'PC' }
    const active = connection('new-pc', 'new', 'pc')
    const leaving = connection('old-pc', 'old', 'pc')
    const replacementPlan = buildHistoryReplacementLayoutPlan(
      [newMonitor],
      [oldMonitor],
      [active],
      [newMonitor, oldMonitor, pc],
      [active, leaving],
    )

    assert.deepEqual(replacementPlan.gadgets.map((item) => item.id), ['new', 'pc'])
    assert.deepEqual(replacementPlan.connections.map((item) => item.id), ['new-pc'])

    const node = (id: string, item: Gadget, x: number): MapNode => ({
      id,
      gadget: item,
      tier: 0,
      x,
      y: 20,
      w: 100,
      h: 80,
      cx: x + 50,
      cy: 60,
      isWall: false,
    })
    const pcNode = node('pc', pc, 20)
    const newNode = node('new', newMonitor, 220)
    const points = [{ x: 120, y: 60 }, { x: 220, y: 60 }]
    const baseLayout: MapLayout = {
      nodes: [pcNode, newNode],
      edges: [{ conn: active, from: pcNode, to: newNode, points }],
      width: 340,
      height: 120,
      bounds: { minX: 20, minY: 20, maxX: 320, maxY: 100 },
    }

    const restored = restoreHistoryReplacementLayout(baseLayout, replacementPlan)
    const oldNode = restored.nodes.find((item) => item.id === 'old')
    const oldEdge = restored.edges.find((item) => item.conn.id === 'old-pc')

    assert.deepEqual(
      oldNode && { x: oldNode.x, y: oldNode.y, w: oldNode.w, h: oldNode.h },
      { x: newNode.x, y: newNode.y, w: newNode.w, h: newNode.h },
    )
    assert.equal(oldEdge?.from.id, 'pc')
    assert.equal(oldEdge?.to.id, 'old')
    assert.deepEqual(oldEdge?.points, points)
  })
})

describe('today page when the visible window cuts every change', () => {
  const gadgets = [gadget('pc', '2020-03-04'), gadget('mouse', '2020-05-06')]
  const events = buildTimeline(gadgets, plan(gadgets), 'ja', 'month')

  it('keeps the today page for a desk whose changes are all older than the window', () => {
    // 無料プランの「直近1年」で全イベントが切られた状態
    const pages = appendTodayPage([], '2026-09-01', events[events.length - 1])
    assert.equal(pages.length, 1)
    assert.equal(pages[0].isTodayPage, true)
    assert.equal(pages[0].date, '2026-09-01')
    // 切り落とした期間の増減は載せない（現在の構成だけを見せる）
    assert.deepEqual(pages[0].inGadgets, [])
    assert.deepEqual(pages[0].outGadgets, [])
    assert.deepEqual(pages[0].gadgets.map((g) => g.id), ['pc', 'mouse'])
  })

  it('still returns nothing when there is no history at all', () => {
    assert.deepEqual(appendTodayPage([], '2026-09-01'), [])
  })

  it('ignores the fallback when the window has its own events', () => {
    const pages = appendTodayPage(events, '2026-09-01', events[0])
    assert.equal(pages.length, events.length + 1)
    assert.equal(pages[pages.length - 1].isTodayPage, true)
  })
})

describe('playback stops at today', () => {
  // 同じ月に予定の撤去（未来日）があると、その月の代表日が未来になって月ごと再生から落ちていた
  it('keeps the changes of this month when a removal is scheduled later in the month', () => {
    const lamp = gadget('lamp', '2026-10-02')
    const old = gadget('old', '2026-01-10', '2026-10-25')
    const events = appendTodayPage(buildTimeline([lamp, old], plan([lamp, old]), 'ja', 'month', '2026-10-08'), '2026-10-08')
    const october = events.find((event) => event.date.startsWith('2026-10') && !event.isTodayPage)
    assert.deepEqual(october?.inGadgets.map((g) => g.id), ['lamp'])
    assert.deepEqual(october?.outGadgets, [])
    assert.deepEqual(events.at(-1)?.gadgets.map((g) => g.id).sort(), ['lamp', 'old'])
  })
})

describe('history card summary', () => {
  const gadgets = ['2026-01-03', '2026-01-10', '2026-01-20', '2026-02-05'].map((date, i) => gadget(`g${i}`, date))

  // カードの件数は、開いたときのページ数（「今日」込み）と同じ単位で数える
  it('counts the pages of the chosen grain', () => {
    assert.equal(playbackTimelineSummary(gadgets, 'day', null, '2026-10-08').pageCount, 5)
    assert.equal(playbackTimelineSummary(gadgets, 'month', null, '2026-10-08').pageCount, 3)
    assert.equal(playbackTimelineSummary(gadgets, 'year', null, '2026-10-08').pageCount, 2)
    const month = appendTodayPage(buildTimeline(gadgets, plan(gadgets), 'ja', 'month', '2026-10-08'), '2026-10-08')
    assert.equal(month.length, 3)
  })

  it('cuts a period by its first change, like the player', () => {
    const summary = playbackTimelineSummary(gadgets, 'month', '2026-01-05', '2026-10-08')
    assert.equal(summary.pageCount, 2)
    assert.equal(summary.firstChangeDate, '2026-02-05')
  })

  // 制限より前にしか変更が無いデスクは「今日」だけを再生する。カードもそれと分かる形にする
  it('reports no visible change when every change is older than the limit', () => {
    const summary = playbackTimelineSummary([gadget('old', '2023-01-01')], 'month', '2025-10-08', '2026-10-08')
    assert.deepEqual(summary, { pageCount: 1, firstChangeDate: null })
  })

  it('has no pages without any dated change up to today', () => {
    assert.equal(playbackTimelineSummary([gadget('future', '2027-01-01')], 'month', null, '2026-10-08').pageCount, 0)
  })
})
