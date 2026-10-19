import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EVENT_ANIM_MS, EVENT_MS, PAGE_MS, eventStayMs } from '../src/hooks/useHistoryPlayback'
import { scrubClock, scrubPage, scrubPosition } from '../src/utils/historyScrub'

// 再生バーを指で動かしたとき、バー上の位置を「何日目・その日のどこ・どのページ」へ読み替える。
// 読み替えが再生中の進み方とずれると、指を離した瞬間に図・ページ・バーが跳ぶ
describe('再生バーの位置の読み替え', () => {
  it('バーを日数で等分し、区間内の位置をその日の経過割合にする', () => {
    assert.deepEqual(scrubPosition(0, 4), { index: 0, offset: 0 })
    assert.deepEqual(scrubPosition(0.375, 4), { index: 1, offset: 0.5 })
    // 区切りちょうどは次の日の頭
    assert.deepEqual(scrubPosition(0.5, 4), { index: 2, offset: 0 })
    // 右端は最後の日の終わり（日数を超えない）
    assert.deepEqual(scrubPosition(1, 4), { index: 3, offset: 1 })
    // 指がバーの外へ出ても端に留める
    assert.deepEqual(scrubPosition(-0.2, 4), { index: 0, offset: 0 })
    assert.deepEqual(scrubPosition(1.3, 4), { index: 3, offset: 1 })
    assert.deepEqual(scrubPosition(0.5, 0), { index: 0, offset: 0 })
  })

  it('演出は日の頭から演出尺で進み、眺める時間に入ったら終わったまま', () => {
    const stay = eventStayMs(0)
    assert.equal(stay, EVENT_MS)
    assert.equal(scrubClock(0, stay, EVENT_ANIM_MS), 0)
    // 再生中と同じ時刻の対応：経過 = 割合 × 滞在時間、演出の進み = 経過 / 演出尺
    assert.equal(scrubClock(0.5, stay, EVENT_ANIM_MS), (0.5 * EVENT_MS) / EVENT_ANIM_MS)
    assert.equal(scrubClock(EVENT_ANIM_MS / EVENT_MS, stay, EVENT_ANIM_MS), 1)
    assert.equal(scrubClock(1, stay, EVENT_ANIM_MS), 1)
    // ページ送りで滞在が延びた日は、演出が日の前半で終わる
    const paged = eventStayMs(2 * PAGE_MS)
    assert.ok(scrubClock((EVENT_ANIM_MS - 1) / paged, paged, EVENT_ANIM_MS) < 1)
    assert.equal(scrubClock(EVENT_ANIM_MS / paged, paged, EVENT_ANIM_MS), 1)
    assert.equal(scrubClock(0.7, paged, EVENT_ANIM_MS), 1)
  })

  it('前の日の終わりと次の日の頭がつながる（日をまたいでも図が飛ばない）', () => {
    // 前の日の終わり＝演出を終えた図、次の日の頭＝演出前（前日の図と同じ状態）
    assert.equal(scrubClock(scrubPosition(0.4999, 2).offset, EVENT_MS, EVENT_ANIM_MS), 1)
    assert.equal(scrubClock(scrubPosition(0.5, 2).offset, EVENT_MS, EVENT_ANIM_MS), 0)
  })

  it('ページは1ページ目を演出尺だけ見せ、以降は1枚ずつ送る', () => {
    const base = EVENT_MS
    const pages = 3
    const total = base + (pages - 1) * PAGE_MS
    assert.equal(scrubPage(0, pages, base, PAGE_MS), 0)
    assert.equal(scrubPage((base - 1) / total, pages, base, PAGE_MS), 0)
    assert.equal(scrubPage(base / total, pages, base, PAGE_MS), 1)
    assert.equal(scrubPage((base + PAGE_MS) / total, pages, base, PAGE_MS), 2)
    assert.equal(scrubPage(1, pages, base, PAGE_MS), 2)
    assert.equal(scrubPage(0.9, 1, base, PAGE_MS), 0)
  })
})
