import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CustomCategory, Gadget } from '../src/types'
import {
  customCategoryOf,
  gadgetCategoryKey,
  gadgetCategoryLabel,
  groupGadgetsByCategory,
  normalizeCustomCategory,
} from '../src/utils/customCategory'
import { compositionTemplate, compositionTemplateId, parseCompositionPicks } from '../src/utils/deskComposition'
import { buildDeskCopySource, deskCopyTemplate } from '../src/utils/deskCopy'
import {
  assignOwnedGadgetsToTemplateItems,
  ownedGadgetCategoriesNeedingSlots,
} from '../src/utils/templateOwnedGadgetSelection'
import { buildGadgetSearchIndex, matchesGadgetSearch, normalizeGadgetSearch } from '../src/utils/gadgetSearch'

const figure: CustomCategory = { id: 'c-figure', name: 'フィギュア', icon: 'robot-happy-outline' }
const plant: CustomCategory = { id: 'c-plant', name: '盆栽', icon: 'sprout-outline' }

const gadget = (id: string, category: Gadget['category'], customCategory?: CustomCategory): Gadget => ({
  id,
  name: id,
  category,
  ports: [],
  createdAt: '2026-09-24T00:00:00.000Z',
  ...(customCategory ? { customCategory } : {}),
})

const t = (key: string) => ({ 'category.Other': 'その他', 'category.Monitor': 'モニター' } as Record<string, string>)[key] ?? key

describe('自作ジャンル', () => {
  it('公開スナップショットの壊れた値は捨て、長すぎる名前は切る', () => {
    assert.equal(normalizeCustomCategory(null), undefined)
    assert.equal(normalizeCustomCategory({ id: 'x', name: '   ' }), undefined)
    assert.equal(normalizeCustomCategory({ id: 1, name: 'a', icon: 'cat' }), undefined)
    const long = normalizeCustomCategory({ id: 'x', name: 'あ'.repeat(40), icon: 'cat' })
    assert.equal(long?.name.length, 20)
    // アイコン名の形でないもの（スクリプト等）は既定の絵に戻す
    assert.equal(normalizeCustomCategory({ id: 'x', name: 'a', icon: '<script>' })?.icon, 'shape-outline')
  })

  it("'Other' 以外に取り残された自作ジャンルは無視する", () => {
    const changed = gadget('m', 'Monitor', figure)
    assert.equal(customCategoryOf(changed), undefined)
    assert.equal(gadgetCategoryLabel(changed, t), 'モニター')
    assert.equal(gadgetCategoryKey(changed), 'Monitor')
    assert.equal(gadgetCategoryLabel(gadget('f', 'Other', figure), t), 'フィギュア')
  })

  it('新しい絵と色は公開データの読み戻しでも残り、不正な色だけを捨てる', () => {
    const custom = { ...figure, icon: 'desk-monitor-shelf', color: '#e53935' }
    assert.deepEqual(normalizeCustomCategory(custom), { ...custom, color: '#E53935' })
    for (const color of ['red', '#abc', '#12345678', 'url(javascript:alert(1))', 123]) {
      assert.deepEqual(normalizeCustomCategory({ ...figure, color }), figure)
    }
  })

  it('自作ジャンルの色と新しい絵は構成の中断復帰とデスクのコピーに残る', () => {
    const custom = { ...figure, icon: 'desk-laptop-stand', color: '#962AB0' }
    const picks = [{ category: 'Other' as const, custom }]
    assert.deepEqual(parseCompositionPicks(picks), picks)
    assert.deepEqual(compositionTemplate(picks, { nameJa: 'a', nameEn: 'a' }).slots[0].custom, custom)
    const source = buildDeskCopySource({
      deskId: 'd', title: 't', ownerName: 'o',
      plan: { id: 'p', name: 'p', selectedGadgetIds: [], createdAt: '', updatedAt: '' } as never,
      gadgets: [gadget('f', 'Other', custom)],
    })
    assert.deepEqual(deskCopyTemplate(source, 'content-copy').slots[0].custom, custom)
  })

  it('同じ Other でもジャンルごとに別の節へ束ねる', () => {
    const groups = groupGadgetsByCategory([
      gadget('a', 'Other', figure),
      gadget('b', 'Other'),
      gadget('c', 'Other', plant),
      gadget('d', 'Other', figure),
    ])
    assert.deepEqual(groups.map((group) => [group.key, group.gs.map((g) => g.id)]), [
      ['custom:c-figure', ['a', 'd']],
      ['Other', ['b']],
      ['custom:c-plant', ['c']],
    ])
  })

  it('作成の2段目で選んだ自作ジャンルは枠になり、選び直すと控えの id が変わる', () => {
    const picks = [{ category: 'Monitor' as const }, { category: 'Other' as const, custom: figure }]
    const other = [{ category: 'Monitor' as const }, { category: 'Other' as const, custom: plant }]
    assert.notEqual(compositionTemplateId(picks), compositionTemplateId(other))
    const template = compositionTemplate(picks, { nameJa: 'a', nameEn: 'a' })
    assert.deepEqual(template.slots[1].custom, figure)
  })

  it('中断復帰の控えから自作ジャンルの枠を読み戻す。Other 以外に付いたものは控えごと捨てる', () => {
    const restored = parseCompositionPicks(JSON.parse(JSON.stringify([{ category: 'Other', custom: figure }])))
    assert.deepEqual(restored, [{ category: 'Other', custom: figure }])
    assert.equal(parseCompositionPicks([{ category: 'PC', custom: figure }]), null)
  })

  it('持ち物は同じ自作ジャンルの枠にだけ入る', () => {
    const items = [
      { key: 'plant', category: 'Other' as const, custom: plant },
      { key: 'other', category: 'Other' as const },
      { key: 'figure', category: 'Other' as const, custom: figure },
    ]
    const gadgets = [gadget('fig-1', 'Other', figure), gadget('misc', 'Other')]
    assert.deepEqual(assignOwnedGadgetsToTemplateItems(items, gadgets, ['fig-1', 'misc']), { figure: 'fig-1', other: 'misc' })
    // 枠が足りない分は、そのジャンルの枠として足す
    assert.deepEqual(
      ownedGadgetCategoriesNeedingSlots([], gadgets, ['fig-1', 'misc']),
      [{ category: 'Other', custom: figure }, { category: 'Other' }],
    )
  })

  it('他人のデスクを参考にするとき、自作ジャンルの名前と絵を枠へ写す', () => {
    const source = buildDeskCopySource({
      deskId: 'd',
      title: 't',
      ownerName: 'o',
      plan: { id: 'p', name: 'p', selectedGadgetIds: [], createdAt: '', updatedAt: '' } as never,
      gadgets: [gadget('fig', 'Other', figure), gadget('mon', 'Monitor')],
    })
    const template = deskCopyTemplate(source, 'content-copy')
    assert.deepEqual(template.slots.map((slot) => slot.custom), [figure, undefined])
  })

  it('持ち物の検索は自作ジャンルの名前でも当たる', () => {
    const index = buildGadgetSearchIndex([gadget('fig', 'Other', figure)], t)
    assert.ok(matchesGadgetSearch(index, 'fig', normalizeGadgetSearch('フィギュア')))
  })
})
