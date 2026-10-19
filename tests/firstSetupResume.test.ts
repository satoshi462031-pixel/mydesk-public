import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DeskPlan } from '../src/types'
import {
  firstSetupResumeNavigation,
  parseFirstSetupDraft,
  parseProductFillDraft,
  shouldShowSetupDraft,
  resolveFirstSetupDraft,
} from '../src/utils/firstSetupResume'

describe('ログイン後の作成再開', () => {
  const plan = (id: string, extra: Partial<DeskPlan> = {}): DeskPlan => ({
    id, name: id, goal: 'first_setup', selectedGadgetIds: [], placements: [],
    createdAt: '2026-10-01', updatedAt: '2026-10-01', ...extra,
  })

  it('再開情報がない復元デスクも新規作成前に検出する', () => {
    const restored = plan('restored')
    assert.deepEqual(resolveFirstSetupDraft(null, [restored]), {
      screen: 'GadgetSelection', planId: 'restored', createdAt: restored.createdAt,
    })
    assert.equal(resolveFirstSetupDraft({ screen: 'PurposeSelection', purposes: ['work'] }, [restored])?.screen, 'GadgetSelection')
  })

  it('既存の再開位置を優先し、削除済みの参照では別の未完成デスクを再開する', () => {
    const draft = { screen: 'PhotoFill' as const, planId: 'saved' }
    const saved = plan('saved', { wiringResult: { connections: [], requiredCables: [], warnings: [] } })
    assert.equal(resolveFirstSetupDraft(draft, [saved, plan('other')]), draft)
    assert.equal((resolveFirstSetupDraft(draft, [plan('other')]) as { planId: string }).planId, 'other')
    assert.equal(resolveFirstSetupDraft(draft, []), null)
  })

  it('完成済み・共有デスクを対象にせず、未完成が複数あれば最後に編集したものを案内する', () => {
    const done = plan('done', { wiringResult: { connections: [], requiredCables: [], warnings: [] } })
    const shared = plan('shared', { isShared: true })
    assert.equal(resolveFirstSetupDraft(null, [done, shared]), null)
    const old = plan('old')
    const recent = plan('recent', { updatedAt: '2026-10-14' })
    assert.equal((resolveFirstSetupDraft(null, [old, done, shared, recent]) as { planId: string }).planId, 'recent')
  })
})

it('用途選択の段階だけは作成途中のデスクとして一覧に表示しない', () => {
  assert.equal(shouldShowSetupDraft({ screen: 'PurposeSelection', purposes: ['work'] }), false)
  assert.equal(shouldShowSetupDraft({ screen: 'TemplateDetail', templateId: 'composition-1', purposes: ['work'] }), true)
  assert.equal(shouldShowSetupDraft({ screen: 'DeskPlacement', planId: 'plan-1' }), true)
  assert.equal(shouldShowSetupDraft(null), false)
})

describe('first setup resume', () => {
  it('機材入力の控えが壊れている場合は復元を進めず、画面で落ちる値を渡さない', () => {
    const valid = {
      screen: 'TemplateDetail', templateId: 'composition', purposes: ['work'],
      inputs: { templateId: 'composition', outletCount: 0, extraItems: [], removedKeys: [],
        productNames: {}, productPicks: {}, productPrices: {}, productDates: {}, ownedSelections: {}, draftGadgets: {},
        specEdits: { keyboard: { splitKeyboard: true }, pc: { pcFormFactor: 'laptop', usbC: 2 } } },
    }
    assert.ok(parseFirstSetupDraft(JSON.stringify(valid)))
    const broken = [
      { templateId: 'different' }, { returnPlanId: 'missing-desk' }, { outletCount: -1 },
      { extraItems: [null] }, { extraItems: [{ key: 'item', name: 'item', category: 'Unknown' }] },
      { removedKeys: [1] }, { productNames: { slot: 123 } }, { ownedSelections: [] }, { draftGadgets: { slot: null } },
      { productPicks: { slot: { name: 'item', ports: [null] } } },
      { productPicks: { slot: { name: 'item', ports: [{ id: 'port', type: 'USB_C', direction: 'input', count: -1 }] } } },
      { specEdits: { slot: { splitKeyboard: 'yes' } } }, { specEdits: { slot: { usbC: 1.5 } } },
      { specEdits: { slot: null } },
    ]
    for (const fields of broken) {
      assert.equal(parseFirstSetupDraft(JSON.stringify({ ...valid, inputs: { ...valid.inputs, ...fields } })), null, JSON.stringify(fields))
    }
  })
  it('用途の自由色を保存・再開し、不正な色だけを除外する', () => {
    for (const screen of ['PurposeSelection', 'TemplateDetail'] as const) {
      const draft = parseFirstSetupDraft(JSON.stringify({ screen, templateId: 'test', purposes: ['other'], otherPurposeColor: '#e53935' }))
      assert.ok(draft)
      const target = firstSetupResumeNavigation(draft)
      if (target.name === 'PurposeSelection') assert.equal(target.params.initialOtherPurposeColor, '#E53935')
      else if (target.name === 'TemplateDetail') assert.equal(target.params.otherPurposeColor, '#E53935')
      else assert.fail('用途または機材の段から再開する')
      for (const color of ['red', '#fff', '#12345678', 123, null]) {
        const invalid = parseFirstSetupDraft(JSON.stringify({ screen, templateId: 'test', purposes: ['other'], otherPurposeColor: color }))
        assert.ok(invalid)
        assert.equal('otherPurposeColor' in invalid, false)
      }
    }
  })
  it('機材の所有・検討の意図を再開時に維持する', () => {
    for (const intent of ['organize', 'plan'] as const) {
      const draft = parseFirstSetupDraft(JSON.stringify({ screen: 'TemplateDetail', templateId: 'gaming-basic', purposes: ['gaming'], intent }))
      assert.ok(draft)
      const target = firstSetupResumeNavigation(draft)
      assert.equal(target.name, 'TemplateDetail')
      if (target.name === 'TemplateDetail') assert.equal(target.params.intent, intent)
      const purposeDraft = parseFirstSetupDraft(JSON.stringify({ screen: 'PurposeSelection', purposes: ['work'], intent }))
      assert.ok(purposeDraft)
      const purposeTarget = firstSetupResumeNavigation(purposeDraft)
      assert.equal(purposeTarget.name, 'PurposeSelection')
      if (purposeTarget.name === 'PurposeSelection') assert.equal(purposeTarget.params.intent, intent)
    }
    assert.equal(parseFirstSetupDraft(JSON.stringify({ screen: 'TemplateDetail', templateId: 'gaming-basic', purposes: ['gaming'], intent: 'invalid' })), null)
  })
  it('restores every persisted wizard stage with its parameters', () => {
    const cases = [
      {
        raw: JSON.stringify({
          screen: 'PurposeSelection',
          purposes: ['other'],
          otherPurposeLabel: '読書',
          otherPurposeIcon: 'book-open-page-variant-outline',
        }),
        target: {
          name: 'PurposeSelection',
          params: {
            initialPurposes: ['other'],
            initialOtherPurposeLabel: '読書',
            initialOtherPurposeIcon: 'book-open-page-variant-outline',
          },
        },
      },
      {
        // やめたジャンルの段の控えは、用途を選んだ状態の用途の段から始め直す
        raw: JSON.stringify({ screen: 'TemplateList', purposes: ['gaming', 'streaming'] }),
        target: { name: 'PurposeSelection', params: { initialPurposes: ['gaming', 'streaming'] } },
      },
      {
        raw: JSON.stringify({
          screen: 'TemplateDetail',
          templateId: 'gaming-basic',
          purposes: ['gaming'],
          otherPurposeLabel: '配信部屋',
        }),
        target: {
          name: 'TemplateDetail',
          params: {
            templateId: 'gaming-basic',
            purposes: ['gaming'],
            otherPurposeLabel: '配信部屋',
            otherPurposeIcon: undefined,
            copySource: undefined,
            composition: undefined,
          },
        },
      },
      {
        // 2段目で自分で選んだ構成は、選んだジャンルの並びごと復帰する
        raw: JSON.stringify({
          screen: 'TemplateDetail',
          templateId: 'composition-1a2b3c4d',
          purposes: ['work'],
          composition: [{ category: 'PC', pcFormFactor: 'laptop' }, { category: 'Monitor' }],
        }),
        target: {
          name: 'TemplateDetail',
          params: {
            templateId: 'composition-1a2b3c4d',
            purposes: ['work'],
            otherPurposeLabel: undefined,
            otherPurposeIcon: undefined,
            copySource: undefined,
            composition: [{ category: 'PC', pcFormFactor: 'laptop' }, { category: 'Monitor' }],
          },
        },
      },
      {
        raw: JSON.stringify({ screen: 'GadgetSelection', planId: 'plan-1' }),
        target: { name: 'GadgetSelection', params: { planId: 'plan-1', wizard: true } },
      },
      {
        raw: JSON.stringify({ screen: 'DeskPlacement', planId: 'plan-1' }),
        target: { name: 'DeskPlacement', params: { planId: 'plan-1' } },
      },
      {
        raw: JSON.stringify({ screen: 'PhotoFill', planId: 'plan-1' }),
        target: { name: 'PhotoFill', params: { planId: 'plan-1', fromSetup: true } },
      },
      {
        raw: JSON.stringify({ screen: 'WiringResult', planId: 'plan-2' }),
        // 初回セットアップの再開は、作り終えた配線図から見せる（作成直後の着地と同じ）
        target: { name: 'WiringResult', params: { planId: 'plan-2' } },
      },
    ] as const

    for (const testCase of cases) {
      const draft = parseFirstSetupDraft(testCase.raw)
      assert.ok(draft)
      assert.deepEqual(firstSetupResumeNavigation(draft), testCase.target)
    }
  })

  it('rejects corrupted or unsafe drafts instead of navigating', () => {
    assert.equal(parseFirstSetupDraft(null), null)
    assert.equal(parseFirstSetupDraft('{broken'), null)
    assert.equal(parseFirstSetupDraft(JSON.stringify({ screen: 'TemplateList', purposes: ['unknown'] })), null)
    assert.equal(parseFirstSetupDraft(JSON.stringify({ screen: 'TemplateDetail', templateId: '', purposes: ['work'] })), null)
    assert.equal(parseFirstSetupDraft(JSON.stringify({
      screen: 'TemplateDetail', templateId: 'composition-1', purposes: ['work'], composition: [{ category: 'NotACategory' }],
    })), null)
    assert.equal(parseFirstSetupDraft(JSON.stringify({ screen: 'DeskPlacement', planId: '' })), null)
    assert.equal(parseFirstSetupDraft(JSON.stringify({ screen: 'PhotoFill', planId: '' })), null)
    assert.equal(parseFirstSetupDraft(JSON.stringify({ screen: 'WiringResult', planId: '' })), null)
    assert.equal(parseFirstSetupDraft(JSON.stringify({ screen: 'Settings', planId: 'plan-1' })), null)
  })

  it('reads a legacy ProductFill draft (names only) and keeps only string values', () => {
    assert.deepEqual(
      parseProductFillDraft(JSON.stringify({ slot1: 'Mac mini', slot2: 42, slot3: null })),
      { values: { slot1: 'Mac mini' }, picked: {} },
    )
    assert.deepEqual(parseProductFillDraft('invalid'), { values: {}, picked: {} })
    assert.deepEqual(parseProductFillDraft('[]'), { values: {}, picked: {} })
    assert.deepEqual(parseProductFillDraft(null), { values: {}, picked: {} })
  })

  // 選んだ商品を控えないと、開き直したあとの保存で端子・価格・購入リンクが付かない
  it('restores picked products from a ProductFill draft', () => {
    const picked = { name: 'Mac mini', productId: 'p-1', ports: [], priceJpy: 94800 }
    assert.deepEqual(
      parseProductFillDraft(JSON.stringify({
        values: { slot1: 'Mac mini', slot2: 3 },
        picked: { slot1: picked, slot2: { name: 7 }, slot3: { name: 'x', ports: 'bad' }, slot4: 'str' },
      })),
      { values: { slot1: 'Mac mini' }, picked: { slot1: picked } },
    )
  })
})
