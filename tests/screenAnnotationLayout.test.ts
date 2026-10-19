import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANNOTATION_LEAD, annotationLeader, annotationSide, paginateAnnotations, screenGuideFrame, stackAnnotations, toShot } from '../src/utils/screenAnnotationLayout'

const PHONE = { width: 390, height: 844 }

test('電話の縦持ちでは写しを左に寄せ、右の1列に説明を並べる', () => {
  const area = { x: 16, y: 110, width: 358, height: 600 }
  const frame = screenGuideFrame(area, PHONE)
  assert.equal(frame.columns.left, undefined)
  const right = frame.columns.right!
  assert.ok(right.width >= 150, '説明の列が読める幅を持つ')
  assert.ok(frame.shot.width >= (area.width - ANNOTATION_LEAD) * 0.5, '写しを半分より大きく取る')
  assert.equal(right.x, frame.shot.x + frame.shot.width + ANNOTATION_LEAD)
  assert.ok(right.x + right.width <= area.x + area.width + 0.001)
  assert.ok(frame.shot.y >= area.y && frame.shot.y + frame.shot.height <= area.y + area.height)
  assert.ok(Math.abs(frame.shot.height / frame.shot.width - PHONE.height / PHONE.width) < 0.001, '写しの縦横比を保つ')
})

test('広い画面では写しを中央に置き、両脇に説明の列を取る', () => {
  const area = { x: 24, y: 80, width: 976, height: 1180 }
  const frame = screenGuideFrame(area, { width: 1024, height: 1366 })
  const { left, right } = frame.columns
  assert.ok(left && right)
  assert.ok(left.x >= area.x && left.x + left.width + ANNOTATION_LEAD <= frame.shot.x + 0.001)
  assert.ok(right.x >= frame.shot.x + frame.shot.width && right.x + right.width <= area.x + area.width + 0.001)
  assert.equal(annotationSide(toShot({ x: 20, y: 50, width: 40, height: 40 }, frame), frame), 'left')
  assert.equal(annotationSide(toShot({ x: 960, y: 50, width: 40, height: 40 }, frame), frame), 'right')
})

test('説明は指す高さに寄せつつ、重ねず列からあふれさせない', () => {
  const ys = stackAnnotations([{ anchorY: 100, height: 80 }, { anchorY: 110, height: 80 }, { anchorY: 690, height: 120 }], 60, 700, 12)
  assert.ok(ys[0] >= 60)
  assert.ok(ys[1] >= ys[0] + 80 + 12)
  assert.ok(ys[2] >= ys[1] + 80 + 12)
  assert.ok(ys[2] + 120 <= 700)
})

test('列に収まらない分は次のページへ送り、案内の順番を保つ', () => {
  const pages = paginateAnnotations([
    { side: 'right', height: 200 }, { side: 'right', height: 200 }, { side: 'right', height: 200 }, { side: 'right', height: 100 },
  ], 500, 12)
  assert.deepEqual(pages, [[0, 1], [2, 3]])
  assert.deepEqual(paginateAnnotations([{ side: 'left', height: 400 }, { side: 'right', height: 400 }], 500, 12), [[0, 1]])
})

test('引き出し線は写しの中の対象から、写しの外の説明の縁へつなぐ', () => {
  const frame = screenGuideFrame({ x: 16, y: 110, width: 358, height: 600 }, PHONE)
  const target = toShot({ x: 330, y: 60, width: 44, height: 44 }, frame)
  const label = { ...frame.columns.right!, y: 150, height: 90 }
  const { start, bend, end } = annotationLeader(target, label, 'right', frame)
  assert.ok(start.x <= frame.shot.x + frame.shot.width && start.x >= target.x)
  assert.ok(start.y >= target.y && start.y <= target.y + target.height)
  assert.ok(bend.x > frame.shot.x + frame.shot.width && bend.x < label.x)
  assert.equal(end.x, label.x)
  assert.ok(end.y >= label.y && end.y <= label.y + label.height)
})
