import assert from 'node:assert/strict'
import test from 'node:test'
import { iconOpticalOffset, iconOpticalTransform } from '../src/utils/iconOptics'
import { ICON_OPTICAL_OFFSETS } from '../src/constants/iconOptics.generated'

// 以前は字形の見出しの外接矩形（xMin / yMin が 0 で壊れている）から表を焼いており、
// 中央にある字形を 2〜4pt 押し出していた。このテストもその値を正解として固定していた
test('左右上下とも中央にある字形は動かさない', () => {
  // 後半はヘッダーのボタン。iOS 26 は 44pt の枠を基準にガラスを敷くので、
  // 字形を動かすとそのままガラスの丸からずれて見える（旧表では「…」が上へ 3.5pt 動いていた）
  for (const name of ['pause', 'plus', 'close', 'minus', 'account', 'arrow-up-down',
    'dots-horizontal', 'cog-outline', 'pencil-outline', 'square-edit-outline', 'account-plus-outline']) {
    const { x, y } = iconOpticalOffset(name, 24)
    assert.ok(Math.abs(x) < 0.2 && Math.abs(y) < 0.2, `${name} が ${x}, ${y} 動いている`)
  }
})

test('戻るの「＜」は輪郭どおり 0.3pt だけ右へ寄せる', () => {
  assert.deepEqual(iconOpticalOffset('chevron-left', 24), { x: 0.28, y: 0 })
})

test('図案が見た目の中心に置いてある再生の三角形は動かさない', () => {
  assert.deepEqual(iconOpticalOffset('play', 24), { x: 0, y: 0 })
})

test('輪郭が下に寄った字形は上へ戻す', () => {
  const { x, y } = iconOpticalOffset('router-network', 24)
  assert.equal(x, 0)
  assert.ok(y < -3, `router-network の y が ${y}`)
})

test('補正は字面の大きさで按分する', () => {
  const base = iconOpticalOffset('router-network', 24)
  const half = iconOpticalOffset('router-network', 12)
  assert.equal(half.x, base.x / 2)
  assert.equal(half.y, base.y / 2)
})

test('表に無いアイコンは動かさない', () => {
  assert.deepEqual(iconOpticalOffset('この名前の字形は無い', 24), { x: 0, y: 0 })
  assert.deepEqual(iconOpticalTransform('この名前の字形は無い', 24), [])
})

test('transform は translateX・translateY の順で返す', () => {
  assert.deepEqual(iconOpticalTransform('chevron-left', 24), [
    { translateX: 0.28 },
    { translateY: 0 },
  ])
})

test('焼いた表は空でない。npm run build:icon-optics を打ち忘れると中心がずれる', () => {
  assert.ok(Object.keys(ICON_OPTICAL_OFFSETS).length > 100)
  // 器の中心からの補正なので、24pt 基準で半分（12pt）を超えるズレは表の作り間違い
  for (const [name, [x, y]] of Object.entries(ICON_OPTICAL_OFFSETS)) {
    assert.ok(Math.abs(x) < 12, `${name} の x 補正が大きすぎる`)
    assert.ok(Math.abs(y) < 12, `${name} の y 補正が大きすぎる`)
  }
})
