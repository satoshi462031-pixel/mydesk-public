import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  baseCompositionPicks,
  CompositionPick,
  compositionFromPlan,
  compositionNames,
  compositionTemplate,
  compositionTemplateId,
  defaultCompositionCategories,
  parseCompositionPicks,
  tutorialCompositionPicks,
} from '../src/utils/deskComposition'
import { applyTemplate, buildTemplateItems, defaultTemplateSpec, needsTemplateSpec, normalizeTemplate } from '../src/services/templateService'
import type { DeskPlan, Gadget } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

describe('desk composition', () => {
  it('用途を選んでいなくても、大半のデスクにあるものに最初からチェックが入る', () => {
    const categories = defaultCompositionCategories([])
    // 並びは配線図と同じ DEFAULT_CATEGORY_ORDER。選んだ順にすると枠の key が押した順で変わる
    assert.deepEqual(categories, ['PC', 'Monitor', 'Charger', 'PowerStrip', 'Mouse', 'Keyboard', 'Desk', 'Chair'])
  })

  it('充電器は既定のチェックで扱い、外したら作成時に足し戻さない', () => {
    const template = normalizeTemplate(
      compositionTemplate([{ category: 'PC', pcFormFactor: 'laptop' }, { category: 'Monitor' }], compositionNames(['work'])),
      { keepHub: true },
    )
    assert.equal(template.slots.some((slot) => slot.category === 'Charger'), false)
  })

  it('ガイドは警告で終わらず配線を試せる最小構成から始める', () => {
    assert.deepEqual(tutorialCompositionPicks(['work']), [
      { category: 'PC', pcFormFactor: 'laptop' },
      { category: 'Monitor' },
      { category: 'PowerStrip' },
    ])
    assert.equal(tutorialCompositionPicks(['gaming'])[0].pcFormFactor, 'desktop')
  })

  it('ガイドの最小構成は電源と映像の配線ができ、警告を出さない', async () => {
    const template = compositionTemplate(tutorialCompositionPicks(['work']), compositionNames(['work']))
    const gadgets: Gadget[] = []
    const plans: DeskPlan[] = []
    await applyTemplate(template, {
      items: buildTemplateItems(template, 'ja'),
      selections: {},
      existingGadgets: [],
      addGadgets: async (created) => { gadgets.push(...created) },
      addPlan: async (plan) => { plans.push(plan) },
      outletCount: 2,
      lang: 'ja',
    })
    const wiring = generateWiring(gadgets, plans[0])
    assert.deepEqual(wiring.warnings, [])
    assert.ok(wiring.connections.some((connection) => connection.cableType === 'Power'))
    assert.ok(wiring.connections.some((connection) => connection.cableType !== 'Power'))
  })

  it('用途ごとの候補を足し、ケーブルは選ばせない', () => {
    const categories = defaultCompositionCategories(['streaming'])
    assert.ok(categories.includes('Webcam'))
    assert.ok(categories.includes('Microphone'))
    assert.ok(categories.includes('Light'))
    assert.ok(!categories.includes('Cable'))
    // 同じジャンルが用途と既定の両方に出ても重複しない
    assert.equal(new Set(categories).size, categories.length)
  })

  it('複数の用途の候補をまとめる', () => {
    const categories = defaultCompositionCategories(['gaming', 'music'])
    assert.ok(categories.includes('GameConsole'))
    assert.ok(categories.includes('AudioInterface'))
  })

  it('選んだ内容が同じなら同じ id、変われば別の id になる（3段目の控えの照合に使う）', () => {
    const a: CompositionPick[] = [{ category: 'PC', pcFormFactor: 'laptop' }, { category: 'Monitor' }]
    const same: CompositionPick[] = [{ category: 'PC', pcFormFactor: 'laptop' }, { category: 'Monitor' }]
    const pcChanged: CompositionPick[] = [{ category: 'PC', pcFormFactor: 'desktop' }, { category: 'Monitor' }]
    const added: CompositionPick[] = [...a, { category: 'Keyboard' }]
    assert.equal(compositionTemplateId(a), compositionTemplateId(same))
    assert.notEqual(compositionTemplateId(a), compositionTemplateId(pcChanged))
    assert.notEqual(compositionTemplateId(a), compositionTemplateId(added))
    assert.match(compositionTemplateId(a), /^composition-[0-9a-f]{8}$/)
  })

  it('選んだジャンルを1台1枠のテンプレートに見立て、初期の置き場所を与える', () => {
    const template = compositionTemplate(
      [{ category: 'PC', pcFormFactor: 'laptop' }, { category: 'Monitor' }, { category: 'Desk' }],
      compositionNames(['work']),
    )
    assert.deepEqual(template.slots.map((slot) => slot.category), ['PC', 'Monitor', 'Desk'])
    // ノートPCは机の上、モニターは奥。机は置き場所を持たない
    assert.equal(template.slots[0].zone, 'back_center')
    assert.equal(template.slots[1].zone, 'back_center')
    assert.equal(template.slots[2].zone, undefined)
    assert.equal(template.nameJa, 'ワークデスク')
  })

  it('デスクトップPCは机の下に置く', () => {
    const template = compositionTemplate([{ category: 'PC', pcFormFactor: 'desktop' }], compositionNames(['gaming']))
    assert.equal(template.slots[0].zone, 'under_desk')
  })

  it('用途「その他」に付けた呼び名をデスク名にする', () => {
    assert.equal(compositionNames(['other'], '読書デスク').nameJa, '読書デスク')
    assert.equal(compositionNames(['other']).nameJa, 'マイデスク')
    assert.equal(compositionNames([]).nameEn, 'My Desk')
  })

  it('壊れた控えからは読み戻さない', () => {
    assert.deepEqual(parseCompositionPicks([{ category: 'PC' }]), [{ category: 'PC' }])
    assert.deepEqual(
      parseCompositionPicks([{ category: 'PC', pcFormFactor: 'mini' }]),
      [{ category: 'PC', pcFormFactor: 'mini' }],
    )
    assert.equal(parseCompositionPicks([{ category: 'NotACategory' }]), null)
    assert.equal(parseCompositionPicks([{ category: 'PC', pcFormFactor: 'tower' }]), null)
    assert.equal(parseCompositionPicks('PC'), null)
    assert.equal(parseCompositionPicks([null]), null)
  })

  it('アームの台数と支持先を中断復帰で保持し、変更すれば別の控えにする', () => {
    const picks: CompositionPick[] = [
      { category: 'Monitor', monitorArmIndex: 0 },
      { category: 'Monitor', monitorArmIndex: 0 },
      { category: 'Monitor', monitorArmIndex: null },
      { category: 'MonitorArm', armHolds: 2 },
    ]
    assert.deepEqual(parseCompositionPicks(JSON.parse(JSON.stringify(picks))), picks)
    assert.notEqual(compositionTemplateId(picks), compositionTemplateId(picks.map((pick, index) => index === 1 ? { ...pick, monitorArmIndex: null } : pick)))
    assert.equal(parseCompositionPicks([{ category: 'Monitor', monitorArmIndex: 1 }]), null)
    assert.equal(parseCompositionPicks([{ category: 'MonitorArm', armHolds: 0 }]), null)
    assert.equal(parseCompositionPicks(picks.map((pick) => pick.category === 'MonitorArm' ? { ...pick, armHolds: 1 } : pick)), null)

    const microphones: CompositionPick[] = [
      { category: 'Microphone', micArmIndex: 0 },
      { category: 'Microphone', micArmIndex: null },
      { category: 'MicArm', armHolds: 1 },
    ]
    assert.deepEqual(parseCompositionPicks(JSON.parse(JSON.stringify(microphones))), microphones)
    assert.notEqual(compositionTemplateId(microphones), compositionTemplateId(microphones.map((pick, index) => index === 0 ? { ...pick, micArmIndex: null } : pick)))
    assert.equal(parseCompositionPicks([{ category: 'Microphone', micArmIndex: 1 }]), null)
  })
})

describe('compositionFromPlan', () => {
  const g = (id: string, category: Gadget['category'], extra: Partial<Gadget> = {}): Gadget =>
    ({ id, name: id, category, ports: [], createdAt: '2026-09-27', ...extra })

  it('作成済みデスクの機材を2段目と同じ並び・形に戻す', () => {
    const custom = { id: 'fig', name: 'フィギュア', icon: 'star' }
    const gadgets = [
      g('mouse', 'Mouse'),
      g('pc', 'PC', { pcFormFactor: 'laptop' }),
      g('arm', 'MonitorArm', { ports: [{ id: 'a', type: 'MonitorArm', direction: 'output', count: 2 }] }),
      g('mon1', 'Monitor'),
      g('mon2', 'Monitor'),
      g('mic-arm', 'MicArm', { ports: [{ id: 'ma', type: 'MicArm', direction: 'output', count: 1 }] }),
      g('mic1', 'Microphone'),
      g('mic2', 'Microphone'),
      g('cable', 'Cable'),
      g('fig', 'Other', { customCategory: custom }),
      g('gone', 'Keyboard', { deletedAt: '2026-09-27' }),
    ]
    const picks = compositionFromPlan({
      selectedGadgetIds: gadgets.map((gadget) => gadget.id),
      monitorArmAssignments: { mon1: 'arm', mon2: null },
      micArmAssignments: { mic1: 'mic-arm', mic2: null },
    }, gadgets)
    assert.deepEqual(picks.find((pick) => pick.category === 'PC'), { category: 'PC', pcFormFactor: 'laptop' })
    assert.deepEqual(picks.filter((pick) => pick.category === 'Monitor'), [
      { category: 'Monitor', monitorArmIndex: 0 },
      { category: 'Monitor', monitorArmIndex: null },
    ])
    assert.deepEqual(picks.find((pick) => pick.category === 'MonitorArm'), { category: 'MonitorArm', armHolds: 2 })
    assert.deepEqual(picks.filter((pick) => pick.category === 'Microphone'), [
      { category: 'Microphone', micArmIndex: 0 },
      { category: 'Microphone', micArmIndex: null },
    ])
    assert.deepEqual(picks.find((pick) => pick.category === 'MicArm'), { category: 'MicArm', armHolds: 1 })
    assert.deepEqual(picks.find((pick) => pick.category === 'Other'), { category: 'Other', custom })
    // ケーブルは2段目で選ばせないので戻さない。ゴミ箱の機材も戻さない
    assert.equal(picks.some((pick) => pick.category === 'Cable' || pick.category === 'Keyboard'), false)
    // 読み戻しの検証（中断復帰と同じ）を通る形になっている
    assert.deepEqual(parseCompositionPicks(picks), picks)
  })

  it('選んだ順ではなく配線図の並び順にそろえる（枠の key が並びで決まるため）', () => {
    const gadgets = [g('mouse', 'Mouse'), g('pc', 'PC')]
    const forward = compositionFromPlan({ selectedGadgetIds: ['mouse', 'pc'] }, gadgets)
    const backward = compositionFromPlan({ selectedGadgetIds: ['pc', 'mouse'] }, gadgets)
    assert.deepEqual(forward, backward)
  })

  it('用途の段から来た土台は用途に関わらず同じで、用途を選び直しても枠の key が変わらない', () => {
    const picks = baseCompositionPicks()
    assert.deepEqual(picks.map((pick) => pick.category), defaultCompositionCategories([]))
    assert.equal(compositionTemplateId(picks), compositionTemplateId(baseCompositionPicks()))
    // アームの有無を決めないので、「実物に合わせる」でアームを聞ける
    assert.equal(picks.find((pick) => pick.category === 'Monitor')?.monitorArmIndex, undefined)
  })

  it('まだ作っていない PC の枠は「実物に合わせる」で形を聞き、既定はデスクトップ', () => {
    const template = compositionTemplate(baseCompositionPicks(), { nameJa: 'テスト', nameEn: 'Test' })
    const pc = buildTemplateItems(template, 'ja').find((item) => item.category === 'PC')
    assert.ok(pc)
    assert.equal(needsTemplateSpec(pc, true), true)
    // 作成済みの機材を使う枠（askArm=false）には当てられないので聞かない
    assert.equal(needsTemplateSpec(pc, true, false), false)
    assert.equal(defaultTemplateSpec(pc).pcFormFactor, 'desktop')
  })
})
