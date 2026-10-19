import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { attributeLabelFromKey, deskAttributeKeys, deskAttributes, profileAttributes } from '../src/utils/deskAttributes'
import { normalizePlan, normalizePurposes } from '../src/utils/portTypeMigration'
import { DeskPlan, Gadget, GadgetCategory } from '../src/types'

const g = (id: string, category: GadgetCategory, extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category,
  ports: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  ...extra,
})

const keys = (list: { key: string }[]) => list.map((item) => item.key)

describe('desk attributes', () => {
  it('derives os, form factor and standing desk from the gadgets', () => {
    const gadgets = [
      g('pc', 'PC', { pcOs: 'macOS', pcFormFactor: 'laptop' }),
      g('desk', 'Desk', { isHeightAdjustable: true, dimensions: '140 × 70 cm' }),
    ]
    const attrs = deskAttributes({}, gadgets, 'ja')
    assert.deepEqual(keys(attrs), ['os:macOS', 'form:laptop', 'desk:standing'])
  })

  it('shows macOS as Mac while keeping the saved value in the key', () => {
    const attrs = deskAttributes({}, [g('pc', 'PC', { pcOs: 'macOS' })], 'ja')
    assert.deepEqual(attrs, [{ key: 'os:macOS', group: 'os', label: 'Mac' }])
  })

  it('keeps the key stable across languages so filtering never reads the label', () => {
    const gadgets = [g('desk', 'Desk', { isHeightAdjustable: true }), g('pc', 'PC', { pcOs: 'Windows' })]
    const ja = deskAttributes({}, gadgets, 'ja')
    const en = deskAttributes({}, gadgets, 'en')
    assert.deepEqual(keys(ja), keys(en))
    assert.equal(ja.find((a) => a.key === 'desk:standing')?.label, '昇降デスク')
    assert.equal(en.find((a) => a.key === 'desk:standing')?.label, 'Standing desk')
  })

  it('puts the hand-entered purpose first, with the custom name honored', () => {
    const attrs = deskAttributes(
      { purposes: ['gaming', 'other'], otherPurposeLabel: '配信検証' },
      [],
      'ja',
    )
    assert.deepEqual(keys(attrs), ['purpose:gaming', 'purpose:other'])
    assert.equal(attrs[1].label, '配信検証')
  })

  it('still reads the purpose of desks saved before 開発 was removed from the choices', () => {
    const attrs = deskAttributes({ purposes: ['dev'] }, [], 'ja')
    assert.deepEqual(attrs, [{ key: 'purpose:dev', group: 'purpose', label: '開発' }])
  })

  it('does not report a desktop form factor, which every desk would carry', () => {
    const attrs = deskAttributes({}, [g('pc', 'PC', { pcFormFactor: 'desktop', pcOs: 'Windows' })], 'ja')
    assert.deepEqual(keys(attrs), ['os:Windows'])
  })

  it('lists each os once even when several machines share it', () => {
    const gadgets = [
      g('pc1', 'PC', { pcOs: 'macOS' }),
      g('pc2', 'PC', { pcOs: 'macOS' }),
      g('pc3', 'PC', { pcOs: 'Windows' }),
    ]
    assert.deepEqual(keys(deskAttributes({}, gadgets, 'ja')), ['os:macOS', 'os:Windows'])
  })

  it('leaves out the desk width and the monitor count', () => {
    const gadgets = [
      g('monitor', 'Monitor', { quantity: 3 }),
      g('desk', 'Desk', { dimensions: '140 × 70 cm' }),
    ]
    assert.deepEqual(deskAttributes({}, gadgets, 'ja'), [])
  })
})

describe('profile attributes (058)', () => {
  it('stores keys only, so the viewer can read a desk published in the other language', () => {
    const stored = deskAttributeKeys(
      { purposes: ['gaming'] },
      [g('pc', 'PC', { pcOs: 'macOS', pcFormFactor: 'laptop' })],
    )
    assert.deepEqual(stored, ['purpose:gaming', 'os:macOS', 'form:laptop'])
    assert.deepEqual(profileAttributes([stored], 'ja').map((a) => a.label), ['ゲーム', 'Mac', 'ノートPC'])
    assert.deepEqual(profileAttributes([stored], 'en').map((a) => a.label), ['Gaming', 'Mac', 'Laptop'])
  })

  it('folds the same attribute across desks and orders by group, not by desk', () => {
    const attrs = profileAttributes([
      ['os:macOS', 'purpose:work'],
      ['os:macOS', 'purpose:gaming', 'desk:standing'],
    ], 'ja')
    assert.deepEqual(attrs.map((a) => a.key), ['purpose:work', 'purpose:gaming', 'os:macOS', 'desk:standing'])
  })

  it('drops keys it does not know, so a newer client cannot print raw values', () => {
    assert.equal(attributeLabelFromKey('theme:wood', 'ja'), null)
    assert.equal(attributeLabelFromKey('purpose:teleport', 'ja'), null)
    assert.equal(attributeLabelFromKey('nonsense', 'ja'), null)
    assert.deepEqual(profileAttributes([['theme:wood', 'purpose:work']], 'ja').map((a) => a.key), ['purpose:work'])
  })

  it('treats desks published before 058 as having nothing to show', () => {
    assert.deepEqual(profileAttributes([undefined, []], 'ja'), [])
  })

  it('falls back to the generic name for a custom purpose, which is not stored', () => {
    const stored = deskAttributeKeys({ purposes: ['other'], otherPurposeLabel: '配信検証' }, [])
    assert.deepEqual(stored, ['purpose:other'])
    assert.equal(profileAttributes([stored], 'ja')[0].label, 'その他')
  })
})

describe('retired desk themes', () => {
  it('removes legacy theme fields while loading a saved plan', () => {
    const legacyPlan = {
      id: 'legacy-theme',
      name: 'Legacy desk',
      goal: 'improve_desk',
      selectedGadgetIds: [],
      placements: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      themes: ['wood'],
      otherThemeLabel: '和室',
    } as DeskPlan & { themes: string[]; otherThemeLabel: string }

    const normalized = normalizePlan(legacyPlan) as DeskPlan & Record<string, unknown>
    assert.equal('themes' in normalized, false)
    assert.equal('otherThemeLabel' in normalized, false)
  })
})

describe('retired desk purposes', () => {
  const saved = (purposes: string[]): DeskPlan => ({
    id: 'legacy-purpose',
    name: 'Legacy desk',
    goal: 'improve_desk',
    selectedGadgetIds: [],
    placements: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    purposes,
  } as unknown as DeskPlan)

  it('drops トレード while loading a desk saved before it was removed', () => {
    assert.deepEqual(normalizePlan(saved(['gaming', 'trading'])).purposes, ['gaming'])
  })

  it('keeps 開発, retired from the choices but still readable', () => {
    assert.deepEqual(normalizePlan(saved(['dev'])).purposes, ['dev'])
  })

  it('leaves a desk without purposes alone instead of writing an empty list', () => {
    const plan = saved([])
    delete plan.purposes
    assert.equal(normalizePlan(plan).purposes, undefined)
  })

  // 公開デスクの purposes は他人の端末が書いた JSON をそのまま読んでいる
  it('returns an empty list for anything that is not an array of strings', () => {
    assert.deepEqual(normalizePurposes('trading'), [])
    assert.deepEqual(normalizePurposes(undefined), [])
    assert.deepEqual(normalizePurposes(['gaming', 42, null]), ['gaming'])
  })
})
