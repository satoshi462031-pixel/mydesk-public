import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseSpotlightProgress,
  resolveSpotlightResume,
  spotlightProgressFrom,
} from '../src/utils/spotlightProgress'
import { SPOTLIGHT_STEPS, advanceStepIndexForRoute, canAdvanceOnArrival, isSetupFlowRoute, isStepOnRoute } from '../src/constants/spotlightSteps'

const screensOf = (step: (typeof SPOTLIGHT_STEPS)[number]): string[] =>
  step.screen === undefined ? [] : Array.isArray(step.screen) ? step.screen : [step.screen]

describe('spotlight progress migration', () => {
  it('stores stable feature IDs and completed feature flags', () => {
    assert.deepEqual(spotlightProgressFrom('pick-purpose'), {
      version: 2,
      current: 'pick-purpose',
      completed: [],
    })
  })

  it('migrates every valid v1 numeric position', () => {
    assert.equal(resolveSpotlightResume(null, '0').current, 'pick-purpose')
    assert.equal(resolveSpotlightResume(null, '2').current, 'pick-purpose')
    // 3 はやめたジャンルの段の案内。次の機材の段から続ける
    assert.equal(resolveSpotlightResume(null, '3').current, 'assign-gadgets')
    assert.equal(resolveSpotlightResume(null, '5').current, 'done')
  })

  it('clamps broken legacy positions and prefers valid v2 progress', () => {
    assert.equal(resolveSpotlightResume(null, 'not-a-number').current, 'pick-purpose')
    assert.equal(resolveSpotlightResume(null, '99').current, 'done')

    const v2 = JSON.stringify({ version: 2, current: 'assign-gadgets', completed: ['pick-purpose', 'pick-purpose', 'done', 'invalid'] })
    assert.deepEqual(resolveSpotlightResume(v2, '1'), {
      version: 2,
      current: 'assign-gadgets',
      completed: ['pick-purpose'],
    })
  })

  it('skips guide steps for screens omitted by a creation branch', () => {
    assert.equal(advanceStepIndexForRoute(0, 'TemplateDetail'), 1)
    assert.equal(advanceStepIndexForRoute(0, 'GadgetSelection'), 1)
    // 後ろの段から戻って用途を選び直すと、配置の段へ直接戻る
    assert.equal(SPOTLIGHT_STEPS[advanceStepIndexForRoute(0, 'DeskPlacement')].key, 'place-gadgets')
  })

  it('resumes a saved guide on the retired genre step from the gear step', () => {
    const saved = JSON.stringify({ version: 2, current: 'pick-template', completed: ['pick-purpose'] })
    assert.deepEqual(parseSpotlightProgress(saved), { version: 2, current: 'assign-gadgets', completed: ['pick-purpose'] })
  })

  it('guides the placement and photo steps instead of going quiet', () => {
    // 機材の次は配線図ではなく配置。ここを配線図にしていたせいで、
    // 配置・写真の2画面ぶん案内が黙り、完成しても既読が立たなかった
    assert.equal(SPOTLIGHT_STEPS[advanceStepIndexForRoute(1, 'DeskPlacement')].key, 'place-gadgets')
    assert.equal(SPOTLIGHT_STEPS[advanceStepIndexForRoute(2, 'PhotoFill')].key, 'add-photos')
    assert.equal(SPOTLIGHT_STEPS[advanceStepIndexForRoute(3, 'WiringResult')].key, 'view-wiring')
    // 写真を持つデスクは写真の段を飛ばして配線図へ出る
    assert.equal(SPOTLIGHT_STEPS[advanceStepIndexForRoute(2, 'WiringResult')].key, 'view-wiring')
  })

  it('完成画面では配線タブを実際に開いてから完了する', () => {
    const wiringIndex = SPOTLIGHT_STEPS.findIndex((step) => step.key === 'view-wiring')
    assert.equal(SPOTLIGHT_STEPS[wiringIndex].targetId, 'wiring-tab')
    assert.equal(SPOTLIGHT_STEPS[wiringIndex].advance.type, 'signal')
    assert.equal(SPOTLIGHT_STEPS[wiringIndex + 1].key, 'done')
  })

  it('covers every screen of the setup wizard', () => {
    // SetupProgress の4段（用途・機材・配置・写真）と、配線体験・完成画面。
    // 抜けた画面はそこだけ案内が消えるので、段を足したらここにも足す
    const covered = new Set(SPOTLIGHT_STEPS.flatMap(screensOf))
    for (const screen of [
      'PurposeSelection', 'TemplateDetail',
      'GadgetSelection', 'DeskPlacement', 'PhotoFill', 'WiringResult',
    ]) {
      assert.ok(covered.has(screen), `${screen} に案内が無い`)
    }
  })

  it('never skips the step that comes next', () => {
    // 案内の行き先は、画面側が実際に navigate する先と一致していなければならない。
    // 機材の行き先を WiringResult にしていたせいで配置・写真を飛び越え、その2画面は
    // 案内が出ないまま進んでいた。行き先が直後の段の画面を含むことで飛び越しを禁じる。
    // （画面側の遷移先：機材 → DeskPlacement、配置 → PhotoFill か WiringResult、
    //   写真 → WiringResult）
    SPOTLIGHT_STEPS.forEach((step, index) => {
      if (step.advance.type !== 'route') return
      const next = SPOTLIGHT_STEPS[index + 1]
      if (!next) return
      const goals = Array.isArray(step.advance.route) ? step.advance.route : [step.advance.route]
      assert.ok(
        screensOf(next).some((screen) => goals.includes(screen)),
        `${step.key} の行き先が次の段（${next.key}）の画面を含まず、段を飛ばす`,
      )
    })
  })

  it('hands every route advance to a later step that shows on that screen', () => {
    // 到達先を受け取る案内が無いと、オーバーレイは offScreen のまま黙り、
    // 配線図まで行っても完了が記録されず、次の起動でやり直しになる
    SPOTLIGHT_STEPS.forEach((step, index) => {
      if (step.advance.type !== 'route') return
      const goals = Array.isArray(step.advance.route) ? step.advance.route : [step.advance.route]
      for (const goal of goals) {
        const next = advanceStepIndexForRoute(index, goal)
        assert.ok(next > index, `${step.key} → ${goal} で進まない`)
        assert.ok(
          isStepOnRoute(SPOTLIGHT_STEPS[next], goal),
          `${step.key} → ${goal} を受け取る案内が無い`,
        )
      }
    })
  })

  it('rejects malformed v2 data', () => {
    assert.equal(parseSpotlightProgress('{broken'), null)
    assert.equal(parseSpotlightProgress(JSON.stringify({ version: 2, current: 'missing', completed: [] })), null)
    assert.equal(parseSpotlightProgress(JSON.stringify({ version: 1, current: 'pick-purpose', completed: [] })), null)
  })

  it('OKで読んだ説明は、今の段や前後の段も保存して復元する', () => {
    const saved = JSON.stringify({ version: 2, current: 'assign-gadgets', completed: ['pick-purpose'],
      acknowledged: ['pick-purpose', 'assign-gadgets', 'place-gadgets', 'assign-gadgets', 'invalid', null] })
    assert.deepEqual(parseSpotlightProgress(saved), {
      version: 2, current: 'assign-gadgets', completed: ['pick-purpose'],
      acknowledged: ['pick-purpose', 'assign-gadgets', 'place-gadgets'],
    })
  })
})

describe('spotlight advance covers every way out of a setup screen', () => {
  // 作成フローの各画面から実際に遷移しうる先（戻る以外）。画面の遷移を足したらここにも足す。
  // 進み先に無い画面へ出ると、案内は画面から消えたまま完了もせず、次の起動からも出続ける
  const EXITS: Record<string, string[]> = {
    // resumeSetupStep で後ろの段（機材・配置・写真）へ直接戻る
    PurposeSelection: ['TemplateDetail', 'GadgetSelection', 'DeskPlacement', 'PhotoFill'],
    TemplateDetail: ['DeskPlacement'],
    // wizard なら配置へ、マイデスクの一覧から開いたときは写真か配線図へ直行する
    GadgetSelection: ['DeskPlacement', 'PhotoFill', 'WiringResult'],
    DeskPlacement: ['PhotoFill', 'WiringResult'],
    PhotoFill: ['WiringResult'],
  }

  SPOTLIGHT_STEPS.forEach((step, index) => {
    if (step.advance.type !== 'route') return
    const goals = Array.isArray(step.advance.route) ? step.advance.route : [step.advance.route]
    const later = new Set(SPOTLIGHT_STEPS.slice(index + 1).flatMap(screensOf))
    for (const screen of screensOf(step)) {
      for (const exit of EXITS[screen] ?? []) {
        if (!later.has(exit)) continue
        it(`${step.key}: leaving ${screen} for ${exit} moves the guide to ${exit}`, () => {
          assert.ok(goals.includes(exit), `${exit} is missing from the advance routes`)
          assert.equal(isStepOnRoute(SPOTLIGHT_STEPS[advanceStepIndexForRoute(index, exit)], exit), true)
        })
      }
    }
  })
})

describe('canAdvanceOnArrival', () => {
  it('作成の流れの画面から配線図に着いたときは進める', () => {
    assert.equal(canAdvanceOnArrival('WiringResult', 'DeskPlacement'), true)
    assert.equal(canAdvanceOnArrival('WiringResult', 'PhotoFill'), true)
    assert.equal(canAdvanceOnArrival('WiringResult', 'TemplateDetail'), true)
  })

  it('一覧から既存のデスクを開いただけでは総括へ進めない', () => {
    assert.equal(canAdvanceOnArrival('WiringResult', 'PlanList'), false)
    assert.equal(canAdvanceOnArrival('WiringResult', undefined), false)
  })

  it('流れの中の画面は、どこから来ても従来どおり進める（一覧から作りかけを開いた場合）', () => {
    assert.equal(canAdvanceOnArrival('TemplateDetail', 'PlanList'), true)
    assert.equal(canAdvanceOnArrival('DeskPlacement', 'PlanList'), true)
  })

  it('総括の画面は流れの画面に数えない', () => {
    assert.equal(isSetupFlowRoute('WiringResult'), false)
    assert.equal(isSetupFlowRoute('PurposeSelection'), true)
  })
})
