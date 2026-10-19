import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampHeaderOffset,
  headerOffsetAfterLayout,
  headerOffsetForScroll,
  headerOffsetOnTabChange,
  headerParallaxOffset,
  maxScrollOffset,
  planScrollRestore,
  scrollOffsetAfterHeaderChange,
} from '../src/utils/collapsibleHeader'

test('小さな操作もその距離だけ収納し、途中で止められる', () => {
  for (const y of [0, 3, 8, 9, 37.5, 120, 239]) assert.equal(headerOffsetForScroll(y, 240), y)
  assert.equal(headerOffsetForScroll(-30, 240), 0)
  assert.equal(headerOffsetForScroll(900, 240), 240)
  assert.equal(headerOffsetForScroll(30, 0), 0)
})

test('一覧途中では収納を維持し、先頭付近へ戻ると連続して開く', () => {
  for (const y of [900, 500, 240]) assert.equal(headerOffsetForScroll(y, 240), 240)
  assert.equal(headerOffsetForScroll(120, 240), 120)
  assert.equal(headerOffsetForScroll(0, 240), 0)
})

test('収納対象は半分の速度で動き、上下から同じ量ずつ切り取られる', () => {
  const height = 240
  for (let scroll = 0; scroll <= height; scroll += 4) {
    const offset = headerOffsetForScroll(scroll, height)
    const imageTop = headerParallaxOffset(offset)
    const imageBottom = height + imageTop
    const viewportBottom = height - offset
    assert.equal(-imageTop, scroll / 2)
    assert.equal(imageBottom - viewportBottom, scroll / 2)
    assert.equal(viewportBottom, height - scroll)
  }
})

test('収納中も収納後も、一覧の各行は指の移動量と同じ距離だけ動く', () => {
  const height = 240
  const tabHeight = 44
  for (const row of [0, 70, 400, 1000]) {
    for (let scroll = 0; scroll <= 600; scroll += 7) {
      const offset = headerOffsetForScroll(scroll, height)
      const paneTop = height + tabHeight - offset
      const contentTranslation = offset
      const rowTop = paneTop - scroll + contentTranslation + row
      assert.equal(rowTop, height + tabHeight + row - scroll)
    }
  }
})

test('収納のための固定余白があっても、末尾へ到達したときに余分な帯を残さない', () => {
  const height = 240
  const viewport = 600
  const content = 1400
  const scrollMax = maxScrollOffset(content + height, viewport)
  const offset = headerOffsetForScroll(scrollMax, height)
  const lastBottom = height - offset + content - scrollMax + offset
  assert.equal(lastBottom, viewport)
  assert.equal(maxScrollOffset(viewport + height, viewport), height, '短い一覧にも全収納できる距離がある')
})

test('手動で開いても読んでいる行を保ち、次の操作で少しずつ収納を再開する', () => {
  const height = 240
  const scroll = 740
  const expandedY = scrollOffsetAfterHeaderChange(scroll, height, 0)
  assert.equal(expandedY, 500)
  const bias = -expandedY
  assert.equal(headerOffsetForScroll(expandedY, height, bias), 0)
  assert.equal(headerOffsetForScroll(expandedY + 12, height, bias), 12)
  assert.equal(headerOffsetForScroll(expandedY - 12, height, bias), 0)
  assert.equal(scrollOffsetAfterHeaderChange(expandedY, 0, height), scroll)
})

test('上部の位置とスクロール上限を範囲内に収める', () => {
  assert.equal(clampHeaderOffset(-40, 200), 0)
  assert.equal(clampHeaderOffset(120, 200), 120)
  assert.equal(clampHeaderOffset(900, 200), 200)
  assert.equal(maxScrollOffset(1200, 500), 700)
  assert.equal(maxScrollOffset(300, 500), 0)
})

test('寸法が揃うまでは位置を戻さず、中身が伸びたら残りも戻す', () => {
  assert.equal(planScrollRestore(300, 0, 500), null)
  assert.equal(planScrollRestore(300, 1200, 0), null)
  assert.deepEqual(planScrollRestore(900, 1200, 500), { y: 700, done: false })
  assert.deepEqual(planScrollRestore(900, 1600, 500), { y: 900, done: true })
})

test('写真読み込み・概要の展開で高さが変わっても収納率を維持する', () => {
  assert.equal(headerOffsetAfterLayout(60, 240, 400), 100)
  assert.equal(headerOffsetAfterLayout(240, 240, 400), 400)
  assert.equal(headerOffsetAfterLayout(0, 240, 400), 0)
  assert.equal(headerOffsetAfterLayout(0, 0, 400), 0)
})

test('配線タブでは写真ボタンの開閉に従う', () => {
  const base = { scrollY: 0, headerOffset: 90, collapseH: 240, tab: 'wiring' as const }
  assert.equal(headerOffsetOnTabChange({ ...base, wiringPhotoExpanded: true }), 0)
  assert.equal(headerOffsetOnTabChange({ ...base, wiringPhotoExpanded: false }), 240)
})

test('別の一覧へ移っても途中の収納量を維持し、位置補正で先頭の行を飛ばさない', () => {
  const base = { tab: 'gadgets' as const, scrollY: 0, headerOffset: 90, collapseH: 240, wiringPhotoExpanded: false }
  assert.equal(headerOffsetOnTabChange(base), 90)
  assert.equal(scrollOffsetAfterHeaderChange(0, 0, 90), 90)
  assert.equal(headerOffsetOnTabChange({ ...base, headerOffset: 240 }), 240)
  assert.equal(headerOffsetOnTabChange({ ...base, tab: 'info', scrollY: 600 }), 240)
  assert.equal(scrollOffsetAfterHeaderChange(600, 240, 240), 600)
})
