import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createIntentSync } from '../src/utils/intentSync'

type Call = { key: string; value: boolean; resolve: () => void; reject: (e: Error) => void }

const setup = () => {
  const calls: Call[] = []
  const confirmed: [string, boolean][] = []
  const failed: [string, boolean][] = []
  const settled: [string, boolean][] = []
  let inFlight = 0
  let maxInFlight = 0
  const sync = createIntentSync<string>({
    send: (key, value) => new Promise<void>((resolve, reject) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      calls.push({
        key,
        value,
        resolve: () => { inFlight--; resolve() },
        reject: (e) => { inFlight--; reject(e) },
      })
    }),
    onConfirmed: (key, value) => confirmed.push([key, value]),
    onSettled: (key, value) => {
      assert.equal(sync.isBusy(key), false)
      settled.push([key, value])
    },
    onFailed: (key, value) => failed.push([key, value]),
  })
  const flush = () => new Promise<void>((r) => setImmediate(r))
  return { sync, calls, confirmed, failed, settled, flush, maxInFlight: () => maxInFlight }
}

describe('intentSync（連打しても最後の状態だけを1本ずつ送る）', () => {
  it('連打の途中の確認では読み直さず、最後の送信が完了してから一度だけ通知する', async () => {
    const t = setup()
    t.sync.request('d', false, true)
    t.sync.request('d', true, false)
    t.calls[0].resolve()
    await t.flush()
    assert.deepEqual(t.settled, [])
    t.calls[1].resolve()
    await t.flush()
    assert.deepEqual(t.settled, [['d', false]])
  })
  it('通信中の2回目は捨てず、1本目が返ってから最後の状態を送る', async () => {
    const t = setup()
    t.sync.request('d', false, true)   // いいね
    t.sync.request('d', true, false)   // すぐ外す
    assert.deepEqual(t.calls.map((c) => c.value), [true])
    t.calls[0].resolve()
    await t.flush()
    assert.deepEqual(t.calls.map((c) => c.value), [true, false])
    t.calls[1].resolve()
    await t.flush()
    assert.deepEqual(t.confirmed, [['d', true], ['d', false]])
    assert.equal(t.sync.isBusy('d'), false)
  })

  it('同じ相手へは同時に2本送らない（届く順の入れ替わりが起きない）', async () => {
    const t = setup()
    for (let i = 0; i < 7; i++) t.sync.request('d', i % 2 === 1, i % 2 === 0)
    while (t.sync.isBusy('d')) {
      t.calls[t.calls.length - 1].resolve()
      await t.flush()
    }
    assert.equal(t.maxInFlight(), 1)
    // 7回押した＝奇数回なので、最後は「いいね」
    assert.equal(t.calls[t.calls.length - 1].value, true)
  })

  it('往復のあいだに偶数回押して元に戻ったら、2本目は送らない', async () => {
    const t = setup()
    t.sync.request('d', false, true)
    t.sync.request('d', true, false)
    t.sync.request('d', false, true)
    t.calls[0].resolve()
    await t.flush()
    assert.equal(t.calls.length, 1)
    assert.equal(t.sync.isBusy('d'), false)
  })

  it('失敗したらサーバーの状態へ戻し、次に押したらまた送れる', async () => {
    const t = setup()
    t.sync.request('d', false, true)
    t.sync.request('d', true, false)
    t.calls[0].reject(new Error('offline'))
    await t.flush()
    assert.deepEqual(t.failed, [['d', false]])
    assert.equal(t.calls.length, 1)
    t.sync.request('d', false, true)
    assert.equal(t.calls.length, 2)
  })

  it('別の相手は待たずに送る', () => {
    const t = setup()
    t.sync.request('a', false, true)
    t.sync.request('b', false, true)
    assert.deepEqual(t.calls.map((c) => c.key), ['a', 'b'])
  })
})
