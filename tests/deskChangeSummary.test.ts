import assert from 'node:assert/strict'
import test from 'node:test'
import { deskChangeHeadline, deskUpdateSentence, summarizeDeskChanges } from '../src/utils/deskChangeSummary'
import { DeskGadgetUsage, Gadget, GadgetCategory } from '../src/types'

function gadget(id: string, category: GadgetCategory, name = id): Gadget {
  return { id, name, category, ports: [], createdAt: '2026-01-01T00:00:00.000Z' } as Gadget
}


test('同じ日に同じカテゴリの撤去と追加があれば入れ替えとして扱う', () => {
  const usage: Record<string, DeskGadgetUsage> = {
    old: { periods: [{ mode: 'active', startedAt: '2025-01-10', endedAt: '2026-03-01' }] },
    new: { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
  }
  const summary = summarizeDeskChanges([gadget('old', 'Monitor'), gadget('new', 'Monitor')], usage)

  assert.equal(summary?.date, '2026-03-01')
  assert.equal(summary?.changes.length, 1)
  assert.equal(summary?.changes[0].kind, 'swap')
  assert.equal(summary?.changes[0].gadgetId, 'new')
  assert.equal(summary?.changes[0].fromGadgetId, 'old')
})

test('入れ替えを先頭にして、残りは件数へ送る', () => {
  const usage: Record<string, DeskGadgetUsage> = {
    old:   { periods: [{ mode: 'active', startedAt: '2025-01-10', endedAt: '2026-03-01' }] },
    new:   { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
    mic:   { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
    light: { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
  }
  const summary = summarizeDeskChanges([
    gadget('old', 'Monitor'), gadget('new', 'Monitor'),
    gadget('mic', 'Microphone'), gadget('light', 'Light'),
  ], usage)

  assert.equal(summary?.changes[0].kind, 'swap')
  assert.deepEqual(summary?.changes.slice(1).map((c) => c.kind), ['added', 'added'])
})

test('デスクを作った日（全ガジェットが同じ日に入った）は変化として出さない', () => {
  const usage: Record<string, DeskGadgetUsage> = {
    pc:      { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
    monitor: { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
  }
  const summary = summarizeDeskChanges([gadget('pc', 'PC'), gadget('monitor', 'Monitor')], usage)

  assert.equal(summary, null)
})

test('active から decor への切り替えは撤去でも追加でもない', () => {
  const usage: Record<string, DeskGadgetUsage> = {
    // 同じ日に前の期間が終わって次が始まる = 置き場所の役割が変わっただけ
    speaker: { periods: [
      { mode: 'active', startedAt: '2025-01-10', endedAt: '2026-03-01' },
      { mode: 'decor',  startedAt: '2026-03-01' },
    ] },
    mic: { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
  }
  const summary = summarizeDeskChanges([gadget('speaker', 'Speaker'), gadget('mic', 'Microphone')], usage)

  // スピーカーは在籍したままなので、その日の変化はマイクの追加だけ
  assert.equal(summary?.changes.length, 1)
  assert.equal(summary?.changes[0].kind, 'added')
  assert.equal(summary?.changes[0].gadgetId, 'mic')
})

test('カテゴリが違えば同じ日でも入れ替えにしない', () => {
  const usage: Record<string, DeskGadgetUsage> = {
    monitor: { periods: [{ mode: 'active', startedAt: '2025-01-10', endedAt: '2026-03-01' }] },
    mic:     { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
    pc:      { periods: [{ mode: 'active', startedAt: '2025-01-10' }] },
  }
  const summary = summarizeDeskChanges([
    gadget('monitor', 'Monitor'), gadget('mic', 'Microphone'), gadget('pc', 'PC'),
  ], usage)

  assert.deepEqual(summary?.changes.map((c) => c.kind), ['added', 'removed'])
})

test('利用期間の記録が無ければ何も出さない', () => {
  assert.equal(summarizeDeskChanges([], undefined), null)
})

test('PCの変更には新しい機器の形状が引き継がれる', () => {
  const old = { ...gadget('old', 'PC'), pcFormFactor: 'desktop' as const }
  const current = { ...gadget('current', 'PC'), pcFormFactor: 'mini' as const }
  const usage: Record<string, DeskGadgetUsage> = {
    old: { periods: [{ mode: 'active', startedAt: '2025-01-10', endedAt: '2026-03-01' }] },
    current: { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
  }
  const summary = summarizeDeskChanges([old, current], usage)
  assert.equal(summary?.changes[0].kind, 'swap')
  assert.equal(summary?.changes[0].pcFormFactor, 'mini')
})

test('公開デスク詳細の「最近の変化」は一番強い変化をカテゴリで言い、残りは件数にする', () => {
  const usage: Record<string, DeskGadgetUsage> = {
    old: { periods: [{ mode: 'active', startedAt: '2025-01-10', endedAt: '2026-03-01' }] },
    new: { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
    mic: { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
  }
  const summary = summarizeDeskChanges([gadget('old', 'Monitor'), gadget('new', 'Monitor'), gadget('mic', 'Microphone')], usage)

  assert.equal(deskChangeHeadline(summary, 'ja'), '最近の変化：モニターを入れ替え ほか1件')
  assert.equal(deskChangeHeadline(summary, 'en'), 'Latest: Swapped Monitor (+1 more)')
  assert.equal(deskChangeHeadline(null, 'ja'), null)
})

test('更新一覧の行は、誰が何をしたかを1文で言い、残りの変化は件数だけ別に返す', () => {
  const usage: Record<string, DeskGadgetUsage> = {
    old: { periods: [{ mode: 'active', startedAt: '2025-01-10', endedAt: '2026-03-01' }] },
    new: { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
    mic: { periods: [{ mode: 'active', startedAt: '2026-03-01' }] },
  }
  const changes = summarizeDeskChanges([gadget('old', 'Monitor'), gadget('new', 'Monitor'), gadget('mic', 'Microphone')], usage)?.changes

  assert.deepEqual(
    deskUpdateSentence({ author: 'kota', title: '白デスク', isNew: false, changes }, 'ja'),
    { lead: 'kota', body: 'さんが「白デスク」のモニターを入れ替えました', more: 'ほか1件の変更' },
  )
  assert.deepEqual(
    deskUpdateSentence({ author: 'kota', title: 'White desk', isNew: false, changes }, 'en'),
    { lead: 'kota', body: ' swapped Monitor in “White desk”', more: '+1 more change' },
  )
  // 新しい公開には変化を言わない（公開前の組み替えを今の出来事に見せない）
  assert.deepEqual(
    deskUpdateSentence({ author: 'mina', title: '部屋', isNew: true, changes }, 'ja'),
    { lead: 'mina', body: 'さんが新しいデスク「部屋」を公開しました', more: null },
  )
  assert.deepEqual(
    deskUpdateSentence({ author: '', title: 'Room', isNew: false }, 'en'),
    { lead: '', body: 'Updated “Room”', more: null },
  )
})
