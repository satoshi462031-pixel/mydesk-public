import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget } from '../src/types'
import { applyDeskGadgetUsage } from '../src/utils/deskGadgetUsage'
import {
  buildChronicle,
  CHRONICLE_PX_PER_YEAR,
  estimateTextWidth,
  formatChronicleDuration,
  layoutChronicleStrip,
} from '../src/utils/gadgetChronicle'

// 「今日」を固定して窓の境界を検証する
const NOW = new Date(2026, 8, 1)  // 2026-09-01

function gadget(id: string, purchasedAt?: string, removedAt?: string): Gadget {
  return {
    id,
    name: id,
    category: 'Monitor',
    ports: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...(purchasedAt ? { purchasedAt } : {}),
    ...(removedAt ? { removedAt } : {}),
  }
}

describe('buildChronicle', () => {
  it('撤去済みのガジェットも行として残り、在籍中と数え分けられる', () => {
    const chronicle = buildChronicle(
      [gadget('old', '2020-01-01', '2023-06-30'), gadget('now', '2024-04-01')],
      { windowYears: -1, now: NOW },
    )
    assert.deepEqual(chronicle.rows.map((r) => r.gadget.id), ['old', 'now'])
    assert.equal(chronicle.activeCount, 1)
    assert.equal(chronicle.retiredCount, 1)
    assert.equal(chronicle.hiddenCount, 0)
  })

  it('Free の1年窓では、それ以前から続く期間が左端で切られる', () => {
    const chronicle = buildChronicle([gadget('long', '2020-01-01')], { windowYears: 1, now: NOW })
    const span = chronicle.rows[0].spans[0]
    assert.equal(span.clippedStart, true)
    assert.equal(span.startMs, chronicle.windowStartMs)
    assert.equal(span.ongoing, true)
    // 在籍日数は窓で切る前の実期間で数える（バーは切れても「6年」と出す）
    assert.ok(chronicle.rows[0].totalDays > 2400)
  })

  it('窓より前に退役したガジェットは行から外れ、hiddenCount に積まれる', () => {
    const chronicle = buildChronicle(
      [gadget('gone', '2019-01-01', '2021-01-01'), gadget('now', '2026-01-01')],
      { windowYears: 1, now: NOW },
    )
    assert.deepEqual(chronicle.rows.map((r) => r.gadget.id), ['now'])
    assert.equal(chronicle.hiddenCount, 1)
    // 全期間の最古は窓の外でも保持する（Pro 誘導の「2019年から」に使う）
    assert.equal(new Date(chronicle.earliestMs ?? 0).getFullYear(), 2019)
  })

  it('全期間なら窓の左端は最古の導入日に揃い、切り欠きも出ない', () => {
    const chronicle = buildChronicle(
      [gadget('gone', '2019-01-01', '2021-01-01'), gadget('now', '2026-01-01')],
      { windowYears: -1, now: NOW },
    )
    assert.equal(chronicle.rows.length, 2)
    assert.equal(chronicle.hiddenCount, 0)
    assert.equal(chronicle.windowStartMs, new Date(2019, 0, 1).getTime())
    assert.ok(chronicle.rows.every((row) => row.spans.every((span) => !span.clippedStart)))
  })

  it('デスク別の利用期間があれば、離れていた区間を分けて持つ', () => {
    const g: Gadget = {
      ...gadget('rejoined'),
      deskUsagePeriods: [
        { mode: 'active', startedAt: '2022-01-01', endedAt: '2023-01-01' },
        { mode: 'active', startedAt: '2025-01-01' },
      ],
    }
    const chronicle = buildChronicle([g], { windowYears: -1, now: NOW })
    assert.equal(chronicle.rows[0].spans.length, 2)
    assert.equal(chronicle.rows[0].ongoing, true)
  })

  it('未来の購入日は軸を伸ばさない', () => {
    const chronicle = buildChronicle([gadget('future', '2030-01-01')], { windowYears: -1, now: NOW })
    assert.equal(chronicle.rows.length, 0)
    assert.equal(chronicle.undatedCount, 1)
    assert.equal(chronicle.earliestMs, null)
  })

  it('未来の撤去日を設定した機材は、その日まで在籍中として数える', () => {
    const item = gadget('scheduled', '2026-01-01', '2026-09-02')
    const chronicle = buildChronicle([item], { windowYears: -1, now: NOW })
    assert.equal(chronicle.activeCount, 1)
    assert.equal(chronicle.retiredCount, 0)
    assert.equal(chronicle.rows[0].ongoing, true)
    assert.equal(chronicle.rows[0].spans[0].ongoing, true)
    assert.equal(chronicle.rows[0].spans[0].endMs, NOW.getTime())

    const afterRemoval = buildChronicle([item], { windowYears: -1, now: new Date(2026, 8, 2) })
    assert.equal(afterRemoval.activeCount, 0)
    assert.equal(afterRemoval.retiredCount, 1)
  })

  it('デスク別の利用期間でも、未来の終了日は在籍中として扱う', () => {
    const item = {
      ...gadget('desk-scheduled'),
      deskUsagePeriods: [{ mode: 'active' as const, startedAt: '2026-01-01', endedAt: '2026-09-02' }],
    }
    const chronicle = buildChronicle([item], { windowYears: -1, now: NOW })
    assert.equal(chronicle.activeCount, 1)
    assert.equal(chronicle.retiredCount, 0)
    assert.equal(chronicle.rows[0].ongoing, true)
  })

  it('購入日が無いガジェットは、登録日で代用せず年表から外す', () => {
    // 5年使っている機材が「登録した日から」のバーになると在籍期間を取り違えるため
    const registeredOnly: Gadget = {
      id: 'x', name: 'x', category: 'Monitor', ports: [], createdAt: '2026-07-01T00:00:00.000Z',
    }
    const chronicle = buildChronicle([registeredOnly, gadget('ok', '2026-01-01')], { windowYears: -1, now: NOW })
    assert.deepEqual(chronicle.rows.map((r) => r.gadget.id), ['ok'])
    assert.equal(chronicle.undatedCount, 1)
  })

  it('デスク詳細から来た機材でも、登録日で代用した期間は年表に載せない', () => {
    // applyDeskGadgetUsage は購入日の無い機材にも登録日の期間を埋めて渡す
    const registeredOnly: Gadget = {
      id: 'x', name: 'x', category: 'Monitor', ports: [], createdAt: '2026-07-01T00:00:00.000Z',
    }
    const desk = {
      id: 'd', name: 'd', goal: 'improve_desk', selectedGadgetIds: ['x', 'ok'], placements: [],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    } as DeskPlan
    const applied = [registeredOnly, gadget('ok', '2026-01-01')].map((g) => applyDeskGadgetUsage(desk, g))
    assert.equal(applied[0].deskUsagePeriods?.length, 1)
    const chronicle = buildChronicle(applied, { windowYears: -1, now: NOW })
    assert.deepEqual(chronicle.rows.map((r) => r.gadget.id), ['ok'])
    assert.equal(chronicle.undatedCount, 1)
  })

  it('デスク別の利用期間があれば、購入日が無くても年表に載せる', () => {
    const g: Gadget = {
      id: 'desk-only', name: 'desk-only', category: 'Monitor', ports: [], createdAt: '2026-07-01T00:00:00.000Z',
      deskUsagePeriods: [{ mode: 'active', startedAt: '2024-05-01' }],
    }
    const chronicle = buildChronicle([g], { windowYears: -1, now: NOW })
    assert.equal(chronicle.rows.length, 1)
    assert.equal(chronicle.undatedCount, 0)
  })

  it('同じガジェットが重複して渡っても1行にまとめる', () => {
    const g = gadget('dup', '2024-01-01')
    const chronicle = buildChronicle([g, { ...g }], { windowYears: -1, now: NOW })
    assert.equal(chronicle.rows.length, 1)
  })
})

describe('formatChronicleDuration', () => {
  it('年・月・日の粒度で丸める', () => {
    assert.equal(formatChronicleDuration(1200, 'ja'), '3年3ヶ月')
    assert.equal(formatChronicleDuration(365, 'ja'), '1年')
    assert.equal(formatChronicleDuration(70, 'ja'), '2ヶ月')
    assert.equal(formatChronicleDuration(3, 'ja'), '3日')
    assert.equal(formatChronicleDuration(0, 'ja'), '1日')
    assert.equal(formatChronicleDuration(1200, 'en'), '3y 3m')
  })
})

describe('layoutChronicleStrip', () => {
  const labelWidthOf = () => 60

  it('1年を一定の幅にして横へ伸ばし、右端を今にする', () => {
    const chronicle = buildChronicle([gadget('long', '2020-09-01')], { windowYears: -1, now: NOW })
    const strip = layoutChronicleStrip(chronicle, { minWidth: 320, labelWidthOf })
    assert.ok(Math.abs(strip.timelineWidth - CHRONICLE_PX_PER_YEAR * 6) < 2)
    const band = strip.bands[0]
    assert.equal(band.barLeft, 0)
    assert.ok(Math.abs(band.barRight - strip.timelineWidth) < 0.001)
  })

  it('窓が短くて見えている幅に足りないときは、見えている幅まで伸ばす', () => {
    const chronicle = buildChronicle([gadget('new', '2026-03-01')], { windowYears: -1, now: NOW })
    const strip = layoutChronicleStrip(chronicle, { minWidth: 320, labelWidthOf })
    assert.equal(strip.timelineWidth, 320)
  })

  it('期間が重ならない機材は同じ段に詰め、重なる機材は次の段へ送る', () => {
    const chronicle = buildChronicle(
      [
        gadget('first', '2020-01-01', '2021-01-01'),
        gadget('overlap', '2020-06-01'),
        gadget('next', '2022-01-01'),
      ],
      { windowYears: -1, now: NOW },
    )
    const strip = layoutChronicleStrip(chronicle, { minWidth: 320, labelWidthOf })
    const laneOf = (id: string) => strip.bands.find((band) => band.row.gadget.id === id)?.lane
    assert.equal(laneOf('first'), 0)
    assert.equal(laneOf('overlap'), 1)
    assert.equal(laneOf('next'), 0)
    assert.equal(strip.laneCount, 2)
  })

  // 帯が短くても名前は帯の外へ伸びて書かれる。名前の分まで段を空けないと隣の帯の名前と重なる
  it('名前が帯より長いときは、名前の分まで段を占める', () => {
    const chronicle = buildChronicle(
      [gadget('short', '2024-01-01', '2024-02-01'), gadget('after', '2024-03-01')],
      { windowYears: -1, now: NOW },
    )
    const strip = layoutChronicleStrip(chronicle, { minWidth: 320, labelWidthOf: () => 120 })
    assert.equal(strip.bands[0].right, strip.bands[0].labelX + 120)
    assert.equal(strip.bands[1].lane, 1)
  })

  it('今の線の近くで始まった帯の名前は、右へはみ出さずに左へ寄せる', () => {
    const chronicle = buildChronicle(
      [gadget('old', '2020-09-01'), gadget('recent', '2026-08-20')],
      { windowYears: -1, now: NOW },
    )
    const strip = layoutChronicleStrip(chronicle, { minWidth: 320, labelWidthOf: () => 90 })
    const recent = strip.bands.find((band) => band.row.gadget.id === 'recent')!
    assert.ok(Math.abs(recent.labelX + recent.labelWidth - strip.timelineWidth) < 0.001)
    assert.ok(strip.contentWidth - strip.timelineWidth < 0.001)
  })

  it('目盛りは1月に年、その間に月を置き、左から順に並ぶ', () => {
    const chronicle = buildChronicle([gadget('long', '2022-09-01')], { windowYears: -1, now: NOW })
    const strip = layoutChronicleStrip(chronicle, { minWidth: 320, labelWidthOf })
    const years = strip.ticks.filter((tick) => tick.grain === 'year').map((tick) => tick.date.getFullYear())
    assert.deepEqual(years, [2022, 2023, 2024, 2025, 2026])
    assert.ok(strip.ticks.every((tick, i) => i === 0 || tick.x > strip.ticks[i - 1].x))
    // 1年180px では月は半年刻み（間隔が詰まりすぎないように）
    assert.ok(strip.ticks.filter((tick) => tick.grain === 'month').every((tick) => tick.date.getMonth() === 6))
  })

  it('窓が1月をまたがなくても、左端にどの年かを出す', () => {
    const chronicle = buildChronicle([gadget('new', '2026-03-01')], { windowYears: -1, now: NOW })
    const strip = layoutChronicleStrip(chronicle, { minWidth: 320, labelWidthOf })
    assert.equal(strip.ticks[0].grain, 'year')
    assert.equal(strip.ticks[0].x, 0)
    assert.equal(strip.ticks[0].date.getFullYear(), 2026)
  })
})

describe('estimateTextWidth', () => {
  it('全角は字の大きさ、半角はその6割で数える', () => {
    assert.equal(estimateTextWidth('机', 10), 10)
    assert.equal(estimateTextWidth('ab', 10), 12)
  })
})
