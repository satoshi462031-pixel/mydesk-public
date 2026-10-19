import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EXPLORE_GUIDE_IDS, EXPLORE_GUIDE_KEY, isExploreGuideVisible, parseExploreGuideProgress } from '../src/utils/exploreGuide'
import { localUserDataKeys } from '../src/utils/localUserDataKeys'

test('初回と、終了・部分既読の保存値を区別する', () => {
  assert.deepEqual(parseExploreGuideProgress(null), { seen: [], dismissed: false })
  assert.deepEqual(parseExploreGuideProgress('{"seen":["explore-open-desk"],"dismissed":false}'), { seen: ['explore-open-desk'], dismissed: false })
  assert.deepEqual(parseExploreGuideProgress('{"seen":[],"dismissed":true}'), { seen: [], dismissed: true })
})
test('壊れた保存値を再案内の理由にしない', () => {
  for (const raw of ['', 'null', '{}', '{"seen":null,"dismissed":false}', '{"seen":["unknown"],"dismissed":false}', '{"seen":[],"dismissed":"false"}']) {
    assert.deepEqual(parseExploreGuideProgress(raw), { seen: [...EXPLORE_GUIDE_IDS], dismissed: true })
  }
})
test('閲覧案内はアカウント切り替えで消すデータに含めない', () => {
  assert.deepEqual(localUserDataKeys(['@desk_plans', EXPLORE_GUIDE_KEY]), ['@desk_plans'])
})
test('スクロール枠から外れたカードや僅かな表示を既読にしない', () => {
  const viewport = { x: 0, y: 180, width: 390, height: 480 }
  assert.equal(isExploreGuideVisible({ x: 16, y: 190, width: 358, height: 180 }, viewport), true)
  assert.equal(isExploreGuideVisible({ x: 16, y: 660, width: 358, height: 180 }, viewport), false)
  assert.equal(isExploreGuideVisible({ x: 16, y: 100, width: 358, height: 180 }, viewport), false)
  assert.equal(isExploreGuideVisible({ x: 300, y: 190, width: 358, height: 180 }, viewport), false)
  assert.equal(isExploreGuideVisible({ x: 16, y: 190, width: 358, height: 0 }, viewport), false)
})
