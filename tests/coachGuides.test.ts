import assert from 'node:assert/strict'
import test from 'node:test'
import { coachDefinitions, coachScenarios } from './helpers/coachFixtures'
import { resolveCoachSteps } from '../src/utils/coachMarkResolution'
import { layoutGuideAnnotations, guideAnnotationsConflict } from '../src/utils/guideAnnotationLayout'
import { coachGuideText } from '../src/utils/coachGuideText'
import type { CoachRect } from '../src/utils/coachMarkLayout'

const viewport = { width: 390, height: 844, top: 47, bottom: 34 }

test('全29種類の？は日英の見出しを持ち、アイコンは付けず、強調語が説明と一致する', () => {
  const scenarios = coachScenarios()
  assert.equal(scenarios.length, 29)
  for (const scenario of scenarios) {
    assert.ok(scenario.steps.length > 0, scenario.name)
    for (const step of scenario.steps) {
      assert.ok(step.title?.ja && step.title.en && !('icon' in step), `${scenario.name}: ${step.target}`)
      for (const lang of ['ja', 'en'] as const) {
        for (const phrase of step.emphasis?.[lang] ?? []) assert.ok(step[lang].includes(phrase), `${step.target}: ${phrase}`)
        assert.equal(coachGuideText(step[lang], step.emphasis?.[lang]).map(part => part.text).join(''), step[lang])
      }
    }
  }
})

test('同じ対象の画面外の行が後から登録されても、一覧枠内の行を指す', () => {
  const steps = [{ target: 'row', within: 'list', ja: '行', en: 'Row' }]
  const measured = new Map<string, CoachRect[]>([
    ['__screen', [{ x: 0, y: 100, width: 390, height: 644 }]],
    ['list', [{ x: 0, y: 200, width: 390, height: 544 }]],
    ['row', [{ x: 16, y: 140, width: 358, height: 44 }, { x: 16, y: 300, width: 358, height: 44 }, { x: 16, y: 900, width: 358, height: 44 }]],
  ])
  assert.deepEqual(resolveCoachSteps(steps, measured, viewport)[0].rect, { x: 16, y: 300, width: 358, height: 44 })
})

test('スクロールで隠れた対象・不足した一覧枠を除き、ヘッダーの操作は画面枠から独立する', () => {
  const steps = [
    { target: 'profile', coveredBy: ['tabs'], ja: 'プロフィール', en: 'Profile' },
    { target: 'edit', header: true, ja: '編集', en: 'Edit' },
    { target: 'row', within: 'missing', ja: '行', en: 'Row' },
  ]
  const measured = new Map<string, CoachRect[]>([
    ['__screen', [{ x: 0, y: 100, width: 390, height: 644 }]],
    ['profile', [{ x: 0, y: 100, width: 390, height: 44 }]],
    ['tabs', [{ x: 0, y: 100, width: 390, height: 44 }]],
    ['edit', [{ x: 290, y: 50, width: 36, height: 36 }]],
    ['row', [{ x: 0, y: 200, width: 390, height: 44 }]],
  ])
  assert.deepEqual(resolveCoachSteps(steps, measured, viewport).map(step => step.target), ['edit'])
})

test('横向きの安全域と非表示の測定値を考慮する', () => {
  const result = resolveCoachSteps([{ target: 'row', ja: '行', en: 'Row' }],
    new Map([['row', [{ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 100, width: 844, height: 44 }]]]),
    { width: 844, height: 390, top: 0, bottom: 21, left: 47, right: 47 })
  assert.deepEqual(result[0].rect, { x: 47, y: 100, width: 750, height: 44 })
})

test('各画面の説明を密集・スクロール・0件で解決し、欠落や交差なしで全ページを作る', () => {
  for (const scenario of coachScenarios()) for (const offset of [0, 240, 900]) {
    const measured = new Map<string, CoachRect[]>([
      ['__screen', [{ x: 0, y: 100, width: 390, height: 650 }]],
      ['desk-content', [{ x: 0, y: 200, width: 390, height: 530 }]],
      ['feed-list', [{ x: 0, y: 200, width: 390, height: 530 }]],
      ['gadget-form', [{ x: 0, y: 120, width: 390, height: 600 }]],
      ['ai-messages', [{ x: 0, y: 120, width: 390, height: 500 }]],
    ])
    scenario.steps.forEach((step, i) => {
      if (step.target) measured.set(step.target, [{ x: 16 + (i % 3) * 100, y: (step.header ? 52 : 250 + i * 44 - offset), width: 90, height: 36 }])
    })
    const resolved = resolveCoachSteps(scenario.steps, measured, viewport)
    const result = layoutGuideAnnotations({ x: 50, y: 111, width: 290, height: 599 }, viewport, resolved.map(step => step.rect))
    assert.deepEqual(result.pages.flatMap(page => page.map(item => item.index)), resolved.map((_, i) => i), scenario.name)
    for (const page of result.pages) for (let i = 0; i < page.length; i++) for (let j = i + 1; j < page.length; j++) assert.equal(guideAnnotationsConflict(page[i], page[j]), false, scenario.name)
    assert.equal(resolveCoachSteps(scenario.steps, new Map(), viewport).length, 0)
  }
})

test('閲覧専用・公開デスクは編集操作を案内せず、保存した機材と機材統計にも説明がある', () => {
  for (const scenario of coachScenarios().filter(item => /公開デスク|閲覧専用/.test(item.name))) {
    assert.ok(scenario.steps.every(step => !['desk-edit', 'desk-gadget-add', 'desk-gadget-row-edit', 'map-add', 'map-edit'].includes(step.target ?? '')), scenario.name)
  }
  const tabs = coachDefinitions().MY_PAGE_TAB_COACH as Record<string, { target?: string }[]>
  assert.ok(tabs.favorites.some(step => step.target === 'saved-gear-remove'))
  assert.ok(tabs.gadgets.some(step => step.target === 'gear-stats'))
})

test('機材設定の詳細ガイドは入力領域内の表示中の行を選び、隠れた操作を案内しない', () => {
  const steps = coachScenarios().find(item => item.name === '作成・TemplateDetail')!.steps
  const measured = new Map<string, CoachRect[]>([
    ['gear-inputs', [{ x: 0, y: 120, width: 390, height: 900 }]],
    ['setup-footer', [{ x: 0, y: 700, width: 390, height: 144 }]],
    ['setup-gear-row', [{ x: 16, y: -200, width: 358, height: 150 }, { x: 16, y: 300, width: 358, height: 150 }]],
    ['setup-gear-detail', [{ x: 328, y: 310, width: 30, height: 30 }]],
    ['setup-category-add', [{ x: 16, y: 900, width: 358, height: 44 }]],
  ])
  const resolved = resolveCoachSteps(steps, measured, viewport)
  assert.deepEqual(resolved.map(step => step.target), ['gear-inputs', 'setup-gear-row', 'setup-gear-detail'])
  assert.equal(resolved[0].rect!.height, 580)
  assert.equal(resolved[1].rect!.y, 300)
})

test('機材詳細は保存ボタンとスクロール中の項目を指し、閉じた配線設定や新規機材の削除は案内しない', () => {
  const steps = coachScenarios().find(item => item.name === '機材詳細')!.steps
  const measured = new Map<string, CoachRect[]>([
    ['gadget-form', [{ x: 0, y: 100, width: 390, height: 600 }]],
    ['gadget-wiring-toggle', [{ x: 16, y: 80, width: 358, height: 60 }]],
    ['gadget-price', [{ x: 16, y: 300, width: 358, height: 44 }]],
    ['gadget-save', [{ x: 0, y: 700, width: 390, height: 80 }]],
  ])
  const resolved = resolveCoachSteps(steps, measured, viewport)
  assert.deepEqual(resolved.map(step => step.target), ['gadget-wiring-toggle', 'gadget-price', 'gadget-save'])
  assert.equal(resolved[0].rect!.y, 100, '入力枠からはみ出た部分を指さない')
  assert.equal(resolved[0].rect!.height, 40)
})

test('強調は繰り返す語や重なる語を扱い、説明文を変更しない', () => {
  assert.deepEqual(coachGuideText('タップして長押し、タップ', ['タップ', '長押し', '押し', '']), [
    { text: 'タップ', emphasized: true }, { text: 'して', emphasized: false }, { text: '長押し', emphasized: true },
    { text: '、', emphasized: false }, { text: 'タップ', emphasized: true },
  ])
  assert.deepEqual(coachGuideText('', ['タップ']), [])
})

test('投稿者とフォローは別の対象として案内し、フォローが無い画面ではその説明を出さない', () => {
  const definitions = coachDefinitions().PUBLIC_DESK_TOP_COACH
  assert.ok(Array.isArray(definitions))
  const author = { x: 16, y: 100, width: 200, height: 44 }
  const follow = { x: 240, y: 100, width: 100, height: 44 }
  const measured = new Map<string, CoachRect[]>([['desk-author', [author]]])
  const resolved = resolveCoachSteps(definitions, measured, viewport)
  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].ja.includes('フォロー'), false)
  measured.set('desk-follow', [follow])
  const both = resolveCoachSteps(definitions, measured, viewport)
  assert.deepEqual(both.map(step => step.rect), [author, follow])
})

// 番号は渡した順に振られる。画面の上から（同じ高さは左から）の並びと一致させる
test('マイデスクとデスク詳細の？は、画面の上から順に指す', () => {
  const scenarios = coachScenarios()
  const targets = (name: string) => scenarios.find(item => item.name === name)!.steps.map(step => step.target)
  assert.deepEqual(targets('マイデスク一覧'), ['empty-create', 'empty-explore', 'plan-limit', 'setup-draft', 'desk-card', 'desk-card', 'desk-card-publish', 'desk-card-action', 'new-desk'])
  const ownerFooter = ['desk-publish', 'desk-ai', 'desk-share']
  const publicFooter = ['desk-clap', 'desk-clap-own', 'desk-save', 'desk-ai', 'desk-share']
  const publicTop = ['desk-report', 'desk-photo', 'desk-author', 'desk-follow', 'history-play', 'desk-tabs']
  assert.deepEqual(targets('自分のデスク・gadgets'), ['desk-edit', 'desk-photo', 'history-play', 'desk-tabs', 'desk-gadget-row-edit', 'desk-gadget-row', 'desk-copy', 'desk-gadget-sort', 'desk-gadget-add', ...ownerFooter])
  assert.deepEqual(targets('自分のデスク・wiring'), ['desk-edit', 'desk-photo', 'history-play', 'desk-tabs', 'map', 'map-edit', 'map-legend', 'map-photo', 'map-fit', 'map-add', ...ownerFooter])
  assert.deepEqual(targets('閲覧専用デスク・wiring'), ['desk-photo', 'desk-tabs', 'map', 'map-legend', 'map-photo', 'map-fit', 'history-play'])
  assert.deepEqual(targets('公開デスク・gadgets'), [...publicTop, 'desk-gadget-row', 'desk-copy', 'desk-gadget-sort', ...publicFooter])
  assert.deepEqual(targets('公開デスク・wiring'), [...publicTop, 'map', 'map-legend', 'map-photo', 'map-fit', ...publicFooter])
  assert.equal(targets('自分のデスク・info').indexOf('desk-tabs'), 3)
  assert.equal(targets('自分のデスク・info').at(-1), 'desk-share')
})
