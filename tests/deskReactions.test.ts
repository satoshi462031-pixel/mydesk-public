import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { newLikeReactions, reactionsCheckedAt, reactionSummary, toDeskReactions } from '../src/utils/deskReactions'

const row = (id: string, likes: number, saves: number, fresh: number) => ({
  desk_id: id, title: `desk ${id}`, like_count: likes, bookmark_count: saves, new_like_count: fresh,
  checked_at: '2026-09-20T12:00:00Z',
})

describe('自分のデスクへの反応', () => {
  it('ベルには新しい拍手があるデスクだけを、増えた数の多い順に出す', () => {
    const list = newLikeReactions(toDeskReactions([row('a', 10, 1, 0), row('b', 3, 0, 1), row('c', 20, 2, 5)]))
    assert.deepEqual(list.map((r) => r.deskId), ['c', 'b'])
  })

  it('増えた数が同じデスクはデスク名の順に出す（開くたびに入れ替わらない）', () => {
    const list = newLikeReactions(toDeskReactions([row('z', 1, 0, 2), row('a', 1, 0, 2), row('m', 1, 0, 3)]))
    assert.deepEqual(list.map((r) => r.deskId), ['m', 'a', 'z'])
  })

  it('件数は持ち主向けの1行にまとめ、どちらも0なら出さない', () => {
    assert.equal(reactionSummary({ likeCount: 12, bookmarkCount: 3 }, 'ja'), '拍手 12 · 保存 3')
    assert.equal(reactionSummary({ likeCount: 1, bookmarkCount: 0 }, 'en'), '1 applause · 0 saves')
    assert.equal(reactionSummary({ likeCount: 0, bookmarkCount: 0 }, 'ja'), null)
    assert.equal(reactionSummary(undefined, 'ja'), null)
  })

  it('既読の基準はサーバー時刻。行が無ければ動かさない', () => {
    assert.equal(reactionsCheckedAt(toDeskReactions([row('a', 1, 0, 0)])), '2026-09-20T12:00:00Z')
    assert.equal(reactionsCheckedAt([]), null)
  })

  it('欠けた値や負の値を0に寄せる', () => {
    const [r] = toDeskReactions([{ desk_id: 'x', title: null, like_count: null, bookmark_count: -1, new_like_count: null, checked_at: 't' }])
    assert.deepEqual([r.title, r.likeCount, r.bookmarkCount, r.newLikeCount, r.roundLikeCount], ['', 0, 0, 0, 0])
  })

  it('拍手が前の版にもまたがるときだけ、最後の更新へのぶんを添える', () => {
    assert.equal(reactionSummary({ likeCount: 12, bookmarkCount: 3, roundLikeCount: 4 }, 'ja'), '拍手 12（この更新 4） · 保存 3')
    assert.equal(reactionSummary({ likeCount: 12, bookmarkCount: 3, roundLikeCount: 4 }, 'en'), '12 applause (4 on this update) · 3 saves')
    // 全部が今の版なら同じ数を2度言わない
    assert.equal(reactionSummary({ likeCount: 4, bookmarkCount: 0, roundLikeCount: 4 }, 'ja'), '拍手 4 · 保存 0')
  })
})
