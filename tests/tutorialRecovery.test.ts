import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { measureCoachTarget } from '../src/utils/coachMarkMeasurement'
import { recoverSpotlightStepForRoute } from '../src/constants/spotlightSteps'
import { coachBubbleMaxHeight, placeCoachBubble } from '../src/utils/coachMarkLayout'
import { contrastRatio } from '../src/constants/colors'
import { ACCENT_PRESETS } from '../src/constants/accentColors'

describe('tutorial recovery', () => {
  it('小画面でも吹き出しを対象の上に収め、用途や次へを隠さない', () => {
    const viewport = { width: 320, height: 568, top: 0, bottom: 0 }
    const hole = { x: 12, y: 246, w: 296, h: 114 }
    const height = coachBubbleMaxHeight(hole, 14, viewport)
    assert.equal(height, 220)
    const placement = placeCoachBubble(hole, height, 14, viewport)
    assert.equal(placement.kind, 'above')
    if (placement.kind === 'above') assert.ok(viewport.height - placement.bottom <= hole.y)
  })
  it('復元した進捗より先の作成画面を開いても、その段から案内できる', () => {
    assert.equal(recoverSpotlightStepForRoute('DeskPlacement', 0), 2)
    assert.equal(recoverSpotlightStepForRoute('PhotoFill', 1), 3)
    assert.equal(recoverSpotlightStepForRoute('GadgetSelection', 0), 1)
  })
  it('完成案内から戻って編集しても完了扱いにせず、その段へ戻せる', () => {
    assert.equal(recoverSpotlightStepForRoute('PurposeSelection', 5), 0)
    assert.equal(recoverSpotlightStepForRoute('TemplateDetail', 5), 1)
  })
  it('無関係な画面・既存のデスクを開いただけでは進捗を動かさない', () => {
    for (const route of ['PlanList', 'MyPage', 'Settings', 'WiringResult', 'Unknown']) {
      assert.equal(recoverSpotlightStepForRoute(route, 1), -1)
    }
    assert.equal(recoverSpotlightStepForRoute('PhotoFill', 3), -1)
  })
  it('対象が無い・外れて例外が出る・測定が返らない場合も安全に復帰する', async () => {
    assert.equal(await measureCoachTarget(null), null)
    assert.equal(await measureCoachTarget({ measureInWindow() { throw new Error('unmounted') } }), null)
    assert.equal(await measureCoachTarget({ measureInWindow() {} }, 10), null)
  })
  it('不正な寸法を使わず、タイムアウト後に届く測定を採用しない', async () => {
    for (const dimension of [0, -1, NaN, Infinity]) {
      assert.equal(await measureCoachTarget({ measureInWindow(callback) { callback(0, 0, dimension, 44) } }), null)
    }
    let late: ((x: number, y: number, width: number, height: number) => void) | undefined
    const result = await measureCoachTarget({ measureInWindow(callback) { late = callback } }, 10)
    late?.(1, 2, 44, 44)
    assert.equal(result, null)
    assert.deepEqual(await measureCoachTarget({ measureInWindow(callback) { callback(1, 2, 44, 48) } }),
      { x: 1, y: 2, width: 44, height: 48 })
  })
})

describe('tutorial contrast on the light bubble in both themes', () => {
  it('説明・終了・全テーマ色のOKが4.5:1以上で読める', () => {
    for (const color of ['#17212B', '#59616B', ...ACCENT_PRESETS.map((preset) => preset.textLight)]) {
      assert.ok(contrastRatio(color, '#F4F4F6') >= 4.5, color)
    }
  })
})
