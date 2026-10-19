import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildDemoDesk, DEMO_DESKS } from '../src/constants/demoDesks'
import { computeMapLayout, MapLayoutCancelled } from '../src/utils/connectionMapLayout'
import { holdBackgroundLayout } from '../src/utils/layoutHold'

// 公開デスクの歴史の先読みは、画面を閉じたら1時点ぶんのレイアウトの途中でも止める。
// 止まらないと、次に開いた画面の計算と JS スレッドを取り合う
describe('配線図レイアウトの中断', () => {
  const built = buildDemoDesk(DEMO_DESKS.find((demo) => demo.id === 'demo-gaming')!, 'ja')
  const args = [
    built.activeGadgets.filter((g) => g.category !== 'Cable'),
    built.plan.connectionMap?.connections ?? [],
    built.plan.placements,
    {},
    {},
    false,
  ] as const

  it('手を引いたら MapLayoutCancelled で止まる', async () => {
    await assert.rejects(computeMapLayout(...args, () => true), MapLayoutCancelled)
  })

  it('合図を渡さなければ最後まで計算する', async () => {
    const layout = await computeMapLayout(...args)
    assert.ok(layout.edges.length > 0)
  })

  it('経路探索中もタイマーへ制御を戻して中断できる', async () => {
    let cancelled = false
    let timerRan = false
    const timer = setTimeout(() => { cancelled = true; timerRan = true }, 0)
    try {
      await assert.rejects(computeMapLayout(...args, () => cancelled), MapLayoutCancelled)
      assert.ok(timerRan)
    } finally {
      clearTimeout(timer)
    }
  })

  it('計算が再開してから届く中断も処理できる', async () => {
    let cancelled = false
    let turns = 0
    let timer: ReturnType<typeof setTimeout>
    const onTurn = () => {
      turns++
      if (turns === 2) cancelled = true
      else timer = setTimeout(onTurn, 0)
    }
    timer = setTimeout(onTurn, 0)
    try {
      await assert.rejects(computeMapLayout(...args, () => cancelled), MapLayoutCancelled)
      assert.equal(turns, 2)
    } finally {
      clearTimeout(timer)
    }
  })

  // 歴史の再生中は裏の計算を止める（再生は JS 駆動で、計算とフレームを取り合う）
  const settledWithin = async (promise: Promise<unknown>, ms: number) => {
    let settled = false
    promise.then(() => { settled = true }, () => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, ms))
    return settled
  }

  it('止めている間は進まず、解除すると同じ結果まで計算する', async () => {
    const expected = JSON.stringify(await computeMapLayout(...args))
    const release = holdBackgroundLayout()
    let pending: Promise<unknown> | undefined
    try {
      pending = computeMapLayout(...args)
      assert.equal(await settledWithin(pending, 500), false)
    } finally {
      release()
    }
    assert.equal(JSON.stringify(await pending), expected)
  })

  it('重ねて止めたときは全員が解除するまで待つ', async () => {
    const releaseA = holdBackgroundLayout()
    const releaseB = holdBackgroundLayout()
    let pending: Promise<unknown> | undefined
    try {
      pending = computeMapLayout(...args)
      releaseA()
      releaseA()  // 二重に呼んでも1回分しか解除しない
      assert.equal(await settledWithin(pending, 500), false)
    } finally {
      releaseA()
      releaseB()
    }
    await pending
  })

  it('止めている間に手を引いた計算は、解除後に MapLayoutCancelled で終わる', async () => {
    let cancelled = false
    const release = holdBackgroundLayout()
    const pending = computeMapLayout(...args, () => cancelled)
    await new Promise((resolve) => setTimeout(resolve, 100))
    cancelled = true
    release()
    await assert.rejects(pending, MapLayoutCancelled)
  })
})
