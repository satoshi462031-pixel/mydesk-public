import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { withTimeout } from '../src/utils/networkError'

describe('withTimeout', () => {
  it('期限内に終わった結果をそのまま返す', async () => {
    await assert.doesNotReject(async () => {
      assert.equal(await withTimeout(Promise.resolve('ok'), 100), 'ok')
    })
  })

  it('返ってこない処理を期限で失敗にする', async () => {
    await assert.rejects(
      withTimeout(new Promise<never>(() => {}), 5),
      /operation timed out after 5ms/,
    )
  })

  it('元処理の失敗をタイムアウトに置き換えない', async () => {
    const original = new Error('original failure')
    await assert.rejects(withTimeout(Promise.reject(original), 100), original)
  })

  it('呼び出し側が中断したら期限を待たず、遅れて元処理が失敗しても未処理の例外を出さない', async () => {
    const controller = new AbortController()
    let fail!: (error: Error) => void
    const pending = new Promise<never>((_, reject) => { fail = reject })
    const result = assert.rejects(withTimeout(pending, 60_000, controller.signal), { name: 'AbortError' })
    controller.abort()
    await result
    fail(new Error('late failure'))
    await new Promise<void>(resolve => setImmediate(resolve))
  })

  it('中断済みのシグナルと期限の理由をそのまま返す', async () => {
    const controller = new AbortController()
    const reason = new Error('deadline exceeded')
    controller.abort(reason)
    await assert.rejects(withTimeout(new Promise<never>(() => {}), 60_000, controller.signal), reason)
  })
})
