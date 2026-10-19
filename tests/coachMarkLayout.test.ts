import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coachArrowLeft, coachBubbleFrame, coachHole, coachVisibleRect, isCoachTargetVisible, placeCoachBubble } from '../src/utils/coachMarkLayout'

const vp = { width: 390, height: 844, top: 47, bottom: 34 }

test('画面外・大きさのない対象は指さない', () => {
  assert.equal(isCoachTargetVisible(null, vp), false)
  assert.equal(isCoachTargetVisible({ x: 0, y: 0, width: 0, height: 0 }, vp), false)
  assert.equal(isCoachTargetVisible({ x: 16, y: 900, width: 358, height: 120 }, vp), false)
  // 下端に少しだけ掛かっている行は指さない
  assert.equal(isCoachTargetVisible({ x: 16, y: 800, width: 358, height: 120 }, vp), false)
  assert.equal(isCoachTargetVisible({ x: 16, y: 300, width: 358, height: 120 }, vp), true)
})

test('小さな要素は全体が見えていれば指す', () => {
  // 検索欄の文字の行（高さ20）や小さな印
  assert.equal(isCoachTargetVisible({ x: 40, y: 120, width: 200, height: 20 }, vp), true)
  assert.equal(isCoachTargetVisible({ x: 40, y: 120, width: 16, height: 16 }, vp), true)
  // 6割見えていなければ指さない（上端の安全域に隠れている）
  assert.equal(isCoachTargetVisible({ x: 40, y: 35, width: 200, height: 20 }, vp), false)
})

test('穴は画面からはみ出す分を削る', () => {
  const hole = coachHole({ x: -10, y: 0, width: 500, height: 2000 }, 6, vp)
  assert.deepEqual(hole, { x: 0, y: 47, w: 390, h: 844 - 34 - 47 })
})

test('上部の対象には下に、下部の対象には上に吹き出しを置く', () => {
  const top = coachHole({ x: 300, y: 60, width: 44, height: 44 }, 6, vp)
  assert.equal(placeCoachBubble(top, 150, 12, vp).kind, 'below')
  const bottom = coachHole({ x: 16, y: 650, width: 358, height: 100 }, 6, vp)
  assert.equal(placeCoachBubble(bottom, 150, 12, vp).kind, 'above')
})

test('画面いっぱいの対象には重ねて置く', () => {
  const big = coachHole({ x: 0, y: 100, width: 390, height: 700 }, 6, vp)
  assert.equal(placeCoachBubble(big, 150, 12, vp).kind, 'overlay')
  assert.equal(placeCoachBubble(null, 150, 12, vp).kind, 'overlay')
})

test('上下どちらにも収まる場合は対象の下を優先する', () => {
  const hole = { x: 180, y: 480, w: 44, h: 44 }
  assert.deepEqual(placeCoachBubble(hole, 150, 12, vp), { kind: 'below', top: 536 })
})

test('対象の中央に揃え、左右の端と横向きの安全域からはみ出さない', () => {
  for (const width of [320, 390, 768, 1024]) {
    for (const inset of [0, 44]) {
      const viewport = { width, left: inset, right: inset }
      for (const maxWidth of [42, 114, 180, 360, 1200]) {
        for (const x of [inset + 8, width / 2 - 20, width - inset - 48]) {
          const hole = { x, y: 80, w: 40, h: 40 }
          const frame = coachBubbleFrame(hole, viewport, maxWidth, 8)
          assert.ok(frame.left >= inset + 8)
          assert.ok(frame.left + frame.width <= width - inset - 8)
          const center = x + 20
          if (center - frame.width / 2 >= inset + 8 && center + frame.width / 2 <= width - inset - 8) {
            assert.equal(frame.left + frame.width / 2, center)
          }
        }
      }
    }
  }
})

test('広い画面のガイドも対象の中央に揃い、矢印がその中央を指す', () => {
  const hole = { x: 580, y: 80, w: 40, h: 40 }
  const frame = coachBubbleFrame(hole, { width: 1024 })
  assert.deepEqual(frame, { left: 420, width: 360 })
  assert.equal(frame.left + coachArrowLeft(hole, frame.left, frame.width, 14) + 7, 600)
  assert.deepEqual(coachBubbleFrame(null, { width: 1024 }), { left: 332, width: 360 })
})

test('角は穴の中心を指し、吹き出しの端からはみ出さない', () => {
  const right = coachHole({ x: 340, y: 60, width: 44, height: 44 }, 0, vp)
  assert.equal(coachArrowLeft(right, 16, 358, 18), 358 - 18 - 16)
  const mid = coachHole({ x: 180, y: 60, width: 30, height: 30 }, 0, vp)
  assert.equal(coachArrowLeft(mid, 16, 358, 18), 195 - 16 - 9)
})

test('一覧の枠の外へスクロールした行は指さない', () => {
  const list = { x: 0, y: 160, width: 390, height: 600 }
  // ヘッダーの裏（一覧より上）に隠れた行
  assert.equal(coachVisibleRect({ x: 16, y: 100, width: 358, height: 50 }, vp, [], [list]), null)
  // 半分だけ一覧に入っている行は、見えている部分だけを指す
  assert.deepEqual(coachVisibleRect({ x: 16, y: 140, width: 358, height: 60 }, vp, [], [list]), { x: 16, y: 160, width: 358, height: 40 })
})

test('固定バーの裏に隠れたボタンは指さない', () => {
  const bar = { x: 0, y: 700, width: 390, height: 60 }
  assert.equal(coachVisibleRect({ x: 16, y: 705, width: 120, height: 36 }, vp, [bar]), null)
  // 下半分がバーに隠れた行は、上の見えている部分を指す
  assert.deepEqual(coachVisibleRect({ x: 16, y: 660, width: 358, height: 80 }, vp, [bar]), { x: 16, y: 660, width: 358, height: 40 })
})
