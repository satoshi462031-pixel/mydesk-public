import assert from 'node:assert/strict'
import test from 'node:test'
import type { CoachRect } from '../src/utils/coachMarkLayout'
import { GUIDE_BADGE_RADIUS, guideAnnotationsConflict, layoutGuideAnnotations, type GuideAnnotation } from '../src/utils/guideAnnotationLayout'
import { guideLabelHeight } from '../src/utils/coachGuideText'

const PHONE = { width: 390, height: 844 }
const AREA = { x: 50, y: 111, width: 290, height: 599 }

function check(area: CoachRect, screen: { width: number; height: number }, rects: (CoachRect | null)[]) {
  const result = layoutGuideAnnotations(area, screen, rects)
  assert.deepEqual(result.pages.flatMap(page => page.map(item => item.index)), rects.map((_, i) => i), '対象を欠落・重複・並び替えさせない')
  for (const [pageIndex, page] of result.pages.entries()) {
    const shot = result.shots[pageIndex]
    assert.ok(page.length >= 1 && page.length <= 3)
    assert.equal(new Set(page.map(item => item.side)).size, page.length)
    for (const item of page) {
      assert.ok(item.label.x >= area.x - 0.001 && item.label.y >= area.y - 0.001)
      assert.ok(item.label.x + item.label.width <= area.x + area.width + 0.001)
      assert.ok(item.label.y + item.label.height <= area.y + area.height + 0.001)
      assert.ok(item.label.width > 0 && item.label.height > 0)
      for (const point of item.points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
      if (item.badge) {
        assert.ok(item.badge.x >= shot.x + GUIDE_BADGE_RADIUS - 0.001)
        assert.ok(item.badge.x <= shot.x + shot.width - GUIDE_BADGE_RADIUS + 0.001)
        assert.ok(item.badge.y >= shot.y + GUIDE_BADGE_RADIUS - 0.001)
        assert.ok(item.badge.y <= shot.y + shot.height - GUIDE_BADGE_RADIUS + 0.001)
      }
    }
    for (let i = 0; i < page.length; i++) for (let j = i + 1; j < page.length; j++) {
      assert.equal(guideAnnotationsConflict(page[i], page[j]), false, `同じページの ${page[i].index} と ${page[j].index} が衝突`)
    }
  }
  return result
}

test('離れた対象は上・右・下へ分散し、1ページに収める', () => {
  const result = check(AREA, PHONE, [
    { x: 20, y: 80, width: 100, height: 44 },
    { x: 320, y: 350, width: 44, height: 44 },
    { x: 20, y: 750, width: 100, height: 44 },
  ])
  assert.equal(result.pages.length, 1)
  assert.deepEqual(result.pages[0].map(item => item.side), ['top', 'right', 'bottom'])
})

test('添付写真の検索・フィルター・ベル・検索対象の密集をページ分けで解消する', () => {
  const result = check(AREA, PHONE, [
    { x: 16, y: 96, width: 258, height: 44 },
    { x: 282, y: 96, width: 44, height: 44 },
    { x: 334, y: 96, width: 44, height: 44 },
    { x: 16, y: 148, width: 358, height: 44 },
  ])
  assert.ok(result.pages.length > 1)
  assert.ok(result.shots.some(shot => shot.width > result.shot.width), '単独の説明では空いた領域へ写しを拡大する')
})

test('8pt空けて隣り合う部品は、縮小した写しの上でも同じページで説明する', () => {
  const result = check(AREA, PHONE, [
    { x: 16, y: 250, width: 90, height: 36 },
    { x: 116, y: 294, width: 90, height: 36 },
  ])
  assert.equal(result.pages.length, 1)
})

test('余白が足りれば同じページに入れ、欄に収まらない長い説明だけ次のページへ送る', () => {
  const rects = [
    { x: 16, y: 120, width: 120, height: 44 },
    { x: 320, y: 400, width: 44, height: 44 },
    { x: 16, y: 700, width: 120, height: 44 },
  ]
  const text = (body: string) => (_: number, width: number) => guideLabelHeight({ title: '見出し', text: body }, width)
  const short = check(AREA, PHONE, rects)
  const roomy = layoutGuideAnnotations(AREA, PHONE, rects, text('タップで詳細を開きます。'))
  assert.equal(roomy.pages.length, short.pages.length)
  assert.equal(roomy.pages.length, 1)
  const long = layoutGuideAnnotations(AREA, PHONE, rects, text('線の色は接続の種類です。'.repeat(12)))
  assert.equal(long.pages.length, 3)
  assert.deepEqual(long.pages.flatMap(page => page.map(item => item.index)), [0, 1, 2])
})

test('説明の高さは、狭い欄ほど・長い文ほど高く、改行も行として数える', () => {
  const body = '機材の並び順を切り替えます。'
  const at = (text: string, width: number) => guideLabelHeight({ title: '並び順', text }, width)
  assert.ok(at(body, 130) > at(body, 290))
  assert.ok(at(body.repeat(3), 290) > at(body, 290))
  assert.ok(at('並び順。\n並び順。', 290) > at('並び順。並び順。', 290))
  assert.ok(guideLabelHeight({ text: 'Change the order of the gear list.' }, 290) < guideLabelHeight({ text: 'Change the order of the gear list.' }, 120))
})

test('同じカードの別説明や親子で重なる対象を同時に強調しない', () => {
  const rect = { x: 16, y: 200, width: 358, height: 200 }
  const result = check(AREA, PHONE, [rect, rect, { x: 30, y: 220, width: 44, height: 44 }])
  assert.equal(result.pages.length, 3)
})

test('小さい縦向き端末でも単独の説明は横幅を使い、番号は対象の外に置く', () => {
  const result = check({ x: 50, y: 111, width: 220, height: 339 }, { width: 320, height: 568 }, [{ x: 16, y: 120, width: 240, height: 44 }])
  const item = result.pages[0][0]
  assert.equal(item.label.width, 220)
  assert.equal(item.side, 'top')
  assert.ok(item.badge!.y + GUIDE_BADGE_RADIUS < item.target!.y)
})

test('衝突判定は交差・近接した平行線・番号・別の対象を横切る線を検出する', () => {
  const item = (index: number, points: GuideAnnotation['points']): GuideAnnotation => ({
    index, side: 'right', points, target: null, badge: null,
    label: { x: 300, y: index ? 600 : 300, width: 100, height: 60 },
  })
  const a = item(0, [{ x: 0, y: 0 }, { x: 40, y: 40 }])
  assert.equal(guideAnnotationsConflict(a, item(1, [{ x: 0, y: 40 }, { x: 40, y: 0 }])), true)
  const horizontal = item(0, [{ x: 0, y: 0 }, { x: 40, y: 0 }])
  assert.equal(guideAnnotationsConflict(horizontal, item(1, [{ x: 0, y: 4 }, { x: 40, y: 4 }])), true)
  assert.equal(guideAnnotationsConflict(horizontal, item(1, [{ x: 0, y: 10 }, { x: 40, y: 10 }])), false)
  assert.equal(guideAnnotationsConflict({ ...item(0, []), badge: { x: 0, y: 100 } }, { ...item(1, []), badge: { x: 20, y: 100 } }), true)
  assert.equal(guideAnnotationsConflict(horizontal, { ...item(1, []), target: { x: 10, y: -5, width: 10, height: 10 } }), true)
})

test('対象のない一般説明と0件も扱え、短い横向き画面は読みやすい右列だけを使う', () => {
  assert.equal(check(AREA, PHONE, []).pages.length, 0)
  assert.equal(check(AREA, PHONE, [null, null, null]).pages.length, 1)
  const result = check({ x: 50, y: 70, width: 744, height: 230 }, { width: 844, height: 390 }, [null, null, null])
  assert.equal(result.pages.length, 3)
  assert.ok(result.pages.every(page => page[0].side === 'right'))
})

test('小さい端末・大きい端末・タブレットで密集・端・広い対象を繰り返しても交差しない', () => {
  let seed = 37
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  for (const screen of [{ width: 320, height: 568 }, PHONE, { width: 430, height: 932 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
    const area = { x: 50, y: 105, width: screen.width - 100, height: screen.height - 220 }
    for (let run = 0; run < 40; run++) {
      const rects = Array.from({ length: 12 }, () => {
        const width = 20 + random() * (screen.width * 0.8)
        const height = 20 + random() * (screen.height * 0.25)
        return { x: random() * (screen.width - width), y: random() * (screen.height - height), width, height }
      })
      check(area, screen, rects)
    }
  }
})

test('説明の札は中身の高さまで縮め、図の側に寄せて置く（欄いっぱいの空きを作らない）', () => {
  const rects = [{ x: 16, y: 60, width: 120, height: 44 }, { x: 260, y: 400, width: 100, height: 60 }, { x: 16, y: 760, width: 358, height: 50 }]
  const card = (index: number) => 40 + index
  const result = layoutGuideAnnotations(AREA, PHONE, rects, card)
  for (const item of result.pages.flat()) {
    const area = result.cards[item.side]
    if (card(item.index) >= area.height) continue
    assert.equal(item.label.height, card(item.index))
    if (item.side === 'top') assert.equal(item.label.y + item.label.height, area.y + area.height)
    if (item.side === 'bottom') assert.equal(item.label.y, area.y)
    // 線は札の縁で終わる（札を縮めても宙に浮かない）
    const end = item.points[item.points.length - 1]
    if (item.side === 'top') assert.equal(end.y, item.label.y + item.label.height)
    if (item.side === 'bottom') assert.equal(end.y, item.label.y)
    if (item.side === 'right') assert.ok(end.y >= item.label.y && end.y <= item.label.y + item.label.height)
  }
})

test('線は対象の枠の縁から引く（線の先に番号の丸を置かない）', () => {
  const result = layoutGuideAnnotations(AREA, PHONE, [{ x: 16, y: 60, width: 120, height: 44 }, { x: 260, y: 400, width: 100, height: 60 }])
  for (const item of result.pages.flat()) {
    const start = item.points[0]
    const target = item.target!
    if (item.side === 'top') assert.equal(start.y, target.y)
    if (item.side === 'bottom') assert.equal(start.y, target.y + target.height)
    if (item.side === 'right') assert.equal(start.x, target.x + target.width)
  }
})
