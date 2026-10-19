import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DeskPlan, Gadget } from '../src/types'
import { DESK_TEMPLATES, FROM_SCRATCH_TEMPLATE_ID } from '../src/constants/deskTemplates'
import { getTemplateRepository } from '../src/repositories/templateRepository'
import { applyTemplate, buildTemplateItems, defaultTemplateSpec, deskRegistersAsOwned, needsTemplateSpec, TemplateItem, withSpecArms } from '../src/services/templateService'
import { compositionNames, compositionTemplate } from '../src/utils/deskComposition'
import { generateWiring } from '../src/utils/wiringEngine'
import { refreshPlanWiring } from '../src/utils/planWiring'
import { orderDeskGadgets } from '../src/utils/gadgetAttachments'
import { armMountCategory } from '../src/utils/gadgetPorts'
import { applyProductToGadget } from '../src/utils/productFill'

// 初回画面の「今の配線を整理する」から直接開く枠なしの土台。
// 一覧に混ざると中身の無いカードが並び、getById で引けないと画面が開けない。
describe('from-scratch template', () => {
  it('今日を選んだ場合は商品名を入れた新規機材の空欄だけを補完し、名前の無い枠・入力済み・既存機材の日付を維持する', async () => {
    const template = compositionTemplate([{ category: 'Keyboard' }, { category: 'Mouse' }, { category: 'Monitor' }, { category: 'Desk' }], compositionNames(['work']))
    const existing: Gadget = { id: 'owned', name: 'Owned mouse', category: 'Mouse', ports: [], purchasedAt: '2020-01-01', createdAt: '2020-01-01T00:00:00Z' }
    const created: Gadget[] = []
    await applyTemplate(template, {
      items: buildTemplateItems(template, 'ja'), selections: { '1-0': existing.id }, existingGadgets: [existing],
      products: { '0-0': { name: 'Keyboard', purchasedAt: '2024-05-01' }, '2-0': { name: 'Monitor' } },
      defaultPurchasedAt: '2026-10-03',
      addGadgets: async (gadgets) => { created.push(...gadgets) }, addPlan: async () => {},
      outletCount: 2, lang: 'ja',
    })
    assert.equal(created.length, 3)
    assert.equal(created.find((g) => g.category === 'Keyboard')?.purchasedAt, '2024-05-01')
    assert.equal(created.find((g) => g.category === 'Monitor')?.purchasedAt, '2026-10-03')
    const desk = created.find((g) => g.category === 'Desk')
    assert.equal(desk?.purchasedAt, undefined)
    assert.equal(desk?.introducedAtUnknown, true)
    assert.ok(created.filter((g) => g !== desk).every((g) => g.introducedAtUnknown === undefined))
    assert.equal(existing.purchasedAt, '2020-01-01')
  })
  it('作成済みのデスクを開き直したとき、所有として作ったかを枠の印から読み戻す', async () => {
    const template = compositionTemplate([{ category: 'Keyboard' }, { category: 'Mouse' }], compositionNames(['work']))
    for (const registerAsOwned of [true, false]) {
      const created: Gadget[] = []
      const plans: DeskPlan[] = []
      await applyTemplate(template, {
        items: buildTemplateItems(template, 'ja'), selections: {}, existingGadgets: [],
        registerAsOwned,
        addGadgets: async (gadgets) => { created.push(...gadgets) }, addPlan: async (p) => { plans.push(p) },
        outletCount: 2, lang: 'ja',
      })
      // 商品名を入れずに作った（枠だけの）デスクでも読み戻せる
      assert.ok(created.every((g) => g.isPlaceholder))
      assert.equal(deskRegistersAsOwned(plans[0], created), registerAsOwned)
    }
  })
  it('今日を選んでも、金額だけを入れた名前の無い枠には日付を付けない', async () => {
    const template = compositionTemplate([{ category: 'Keyboard' }], compositionNames(['work']))
    const created: Gadget[] = []
    await applyTemplate(template, {
      items: buildTemplateItems(template, 'ja'), selections: {}, existingGadgets: [],
      products: { '0-0': { name: '', price: 12800 } },
      defaultPurchasedAt: '2026-10-03',
      addGadgets: async (gadgets) => { created.push(...gadgets) }, addPlan: async () => {},
      outletCount: 2, lang: 'ja',
    })
    assert.equal(created[0].isPlaceholder, true)
    assert.equal(created[0].purchasedAt, undefined)
    assert.equal(created[0].introducedAtUnknown, true)
  })
  it('ジャンルで選んだデュアル＋シングル＋スタンドを商品登録・再計算後も保持する', async () => {
    const template = compositionTemplate([
      { category: 'Monitor', monitorArmIndex: 1 },
      { category: 'Monitor', monitorArmIndex: 0 },
      { category: 'Monitor', monitorArmIndex: null },
      { category: 'Monitor', monitorArmIndex: 0 },
      { category: 'MonitorArm', armHolds: 2 },
      { category: 'MonitorArm', armHolds: 1 },
    ], compositionNames(['work']))
    const items = buildTemplateItems(template, 'ja')
    const specItems = items.filter((item) => needsTemplateSpec(item, false))
    assert.equal(specItems.length, 4)
    const specs = Object.fromEntries(specItems.map((item) => [
      item.key,
      defaultTemplateSpec(item, template.defaultConnType, items),
    ]))
    const armed = withSpecArms(items, specs, 'ja')
    assert.equal(armed.items.length, 6)
    const created: Gadget[] = []
    const plans: DeskPlan[] = []
    await applyTemplate(template, {
      items: armed.items, specs: armed.specs, selections: {}, existingGadgets: [],
      products: { '1-0': { name: '商品名を入力したモニター' } },
      addGadgets: async (gs) => { created.push(...gs) }, addPlan: async (p) => { plans.push(p) },
      outletCount: 2, lang: 'ja',
    })
    const [a, b, stand, c, dual, single] = created
    const plan = JSON.parse(JSON.stringify(plans[0])) as DeskPlan
    const supports = generateWiring([...created].reverse(), plan).connections.filter((conn) => conn.cableType === 'MonitorArm')
    assert.deepEqual(new Set(supports.map((conn) => `${conn.fromGadgetId}/${conn.toGadgetId}`)), new Set([
      `${single.id}/${a.id}`, `${dual.id}/${b.id}`, `${dual.id}/${c.id}`,
    ]))
    assert.equal(supports.some((conn) => conn.toGadgetId === stand.id), false)
    const refreshed = refreshPlanWiring(plan, created, 'ja').plan
    const again = refreshPlanWiring(refreshed, created, 'ja').plan
    assert.deepEqual(again.monitorArmAssignments, plan.monitorArmAssignments)
    assert.deepEqual(orderDeskGadgets(created, again.connectionMap!.connections).map((row) => row.gadget.id),
      [a.id, single.id, b.id, c.id, dual.id, stand.id])
  })
  it('マイクアームとスタンドの割り当てを作成後も保持する', async () => {
    const template = compositionTemplate([
      { category: 'Microphone', micArmIndex: null },
      { category: 'Microphone', micArmIndex: 0 },
      { category: 'MicArm', armHolds: 1 },
    ], compositionNames(['music']))
    const items = buildTemplateItems(template, 'ja')
    const created: Gadget[] = []
    const plans: DeskPlan[] = []
    await applyTemplate(template, {
      items,
      selections: {},
      existingGadgets: [],
      addGadgets: async (gadgets) => { created.push(...gadgets) },
      addPlan: async (plan) => { plans.push(plan) },
      outletCount: 2,
      lang: 'ja',
    })
    const [stand, mounted, arm] = created
    assert.deepEqual(plans[0].micArmAssignments, { [stand.id]: null, [mounted.id]: arm.id })
    const supports = generateWiring(created, plans[0]).connections.filter((connection) => connection.cableType === 'MicArm')
    assert.deepEqual(supports.map((connection) => [connection.fromGadgetId, connection.toGadgetId]), [[arm.id, mounted.id]])
    // 受け口は「アームを使用」と装着の印になるので、スタンドのマイクには付けない
    assert.equal(armMountCategory(stand), null)
    assert.equal(armMountCategory(mounted), 'MicArm')
  })
  it('そのまま使う作成済みのモニターには、アームの有無を聞かない', () => {
    const monitor: TemplateItem = { key: 'm', category: 'Monitor', name: 'モニター', source: 'extra' }
    assert.equal(needsTemplateSpec(monitor, true), true)
    assert.equal(needsTemplateSpec(monitor, true, false), false)
    // 口数を聞く枠なら、アームを聞かなくてもページに載る
    assert.equal(needsTemplateSpec(monitor, false, false), true)
  })
  it('商品名が空でも、金額と導入日は枠のまま保存し、あとで商品名を入れても残る', async () => {
    const template = compositionTemplate([{ category: 'Keyboard' }, { category: 'Mouse' }], compositionNames(['work']))
    const created: Gadget[] = []
    await applyTemplate(template, {
      items: buildTemplateItems(template, 'ja'),
      selections: {},
      existingGadgets: [],
      products: { '0-0': { name: '', price: 12800, purchasedAt: '2025-04-01' } },
      addGadgets: async (gadgets) => { created.push(...gadgets) },
      addPlan: async () => {},
      outletCount: 2,
      lang: 'ja',
    })
    const [keyboard, mouse] = created
    assert.equal(keyboard.isPlaceholder, true)
    assert.equal(keyboard.price, 12800)
    assert.equal(keyboard.purchasedAt, '2025-04-01')
    assert.equal(mouse.isPlaceholder, true)
    assert.equal(mouse.price, undefined)
    assert.equal(mouse.purchasedAt, undefined)
    assert.equal(mouse.introducedAtUnknown, true)
    assert.equal(keyboard.introducedAtUnknown, undefined)
    const named = applyProductToGadget(keyboard, { name: 'HHKB Professional' })
    assert.equal(named.isPlaceholder, undefined)
    assert.equal(named.price, 12800)
    assert.equal(named.purchasedAt, '2025-04-01')
    assert.equal(named.isCandidate, true)
  })
  it('アームに載せないモニターには受け口を付けない', async () => {
    const template = compositionTemplate([
      { category: 'Monitor', monitorArmIndex: null },
      { category: 'Monitor', monitorArmIndex: 0 },
      { category: 'MonitorArm', armHolds: 1 },
    ], compositionNames(['work']))
    const created: Gadget[] = []
    await applyTemplate(template, {
      items: buildTemplateItems(template, 'ja'),
      selections: {},
      existingGadgets: [],
      products: { '0-0': { name: '商品名を入れたスタンドのモニター' } },
      addGadgets: async (gadgets) => { created.push(...gadgets) },
      addPlan: async () => {},
      outletCount: 2,
      lang: 'ja',
    })
    const [stand, mounted] = created
    assert.equal(armMountCategory(stand), null)
    assert.equal(armMountCategory(mounted), 'MonitorArm')
  })
  it('carries no slots of its own', () => {
    const template = DESK_TEMPLATES.find((item) => item.id === FROM_SCRATCH_TEMPLATE_ID)
    assert.ok(template, '枠なしの土台が定義されていない')
    assert.equal(template.slots.length, 0)
    // 枠が無い状態で充電器だけが置かれると、何の構成か読めない
    assert.equal(template.autoCharger, false)
  })

  it('stays out of the template list but opens directly', async () => {
    const repository = getTemplateRepository()
    const list = await repository.list()
    assert.equal(
      list.some((item) => item.id === FROM_SCRATCH_TEMPLATE_ID),
      false,
      '枠なしの土台がテンプレート一覧に出ている',
    )
    assert.ok(
      await repository.getById(FROM_SCRATCH_TEMPLATE_ID),
      '枠なしの土台を直接開けない',
    )
  })

  it('produces no items before the user adds any', async () => {
    const template = await getTemplateRepository().getById(FROM_SCRATCH_TEMPLATE_ID)
    assert.ok(template)
    // 用途由来の枠は画面側で足される。土台そのものは何も置かない
    assert.deepEqual(buildTemplateItems(template, 'ja'), [])
  })

  // 枠を持たない土台でデスクを作れること。applyTemplate は deps.items で回るが、
  // template.slots 前提の処理が残っていると、この経路だけ作成に失敗する
  it('creates a desk from user-added items alone', async () => {
    const template = await getTemplateRepository().getById(FROM_SCRATCH_TEMPLATE_ID)
    assert.ok(template)
    const items: TemplateItem[] = [
      { key: 'extra-Monitor', category: 'Monitor', name: 'モニター', source: 'extra' },
      { key: 'extra-PC', category: 'PC', name: 'PC', source: 'extra', pcFormFactor: 'desktop' },
    ]
    let created: Gadget[] = []
    let saved: DeskPlan | null = null
    const planId = await applyTemplate(template, {
      addGadgets: async (incoming) => { created = incoming },
      addPlan: async (plan) => { saved = plan },
      existingGadgets: [],
      items,
      selections: {},
      outletCount: 2,
      // 枠がひとつも入らない用途。ここで落ちると「その他」だけを選んだ人が作成できない
      purposes: ['other'],
      lang: 'ja',
    })
    assert.ok(planId.length > 0, 'デスクが作られていない')
    assert.equal(created.length, 2, '足した枠がガジェットになっていない')
    assert.ok(saved, 'デスクが保存されていない')
    assert.equal((saved as DeskPlan).selectedGadgetIds.length, 2)
  })

  // 作成の「機材」の段で商品名の下に入れた金額・日付。日付は歴史アニメの開始日になるので、
  // 作成日で上書きしない。空欄にした金額に参考価格を入れ直さない
  it('applies the price and date entered under the product name', async () => {
    const template = await getTemplateRepository().getById(FROM_SCRATCH_TEMPLATE_ID)
    assert.ok(template)
    const items: TemplateItem[] = [
      { key: 'a', category: 'Monitor', name: 'モニター', source: 'extra' },
      { key: 'b', category: 'Monitor', name: 'モニター２', source: 'extra' },
      { key: 'c', category: 'Keyboard', name: 'キーボード', source: 'extra' },
    ]
    let created: Gadget[] = []
    await applyTemplate(template, {
      addGadgets: async (incoming) => { created = incoming },
      addPlan: async () => {},
      existingGadgets: [],
      items,
      selections: {},
      products: {
        a: { name: 'Monitor A', suggestion: { name: 'Monitor A', priceJpy: 30000 }, price: 24800, purchasedAt: '2023-04-01' },
        b: { name: 'Monitor B', suggestion: { name: 'Monitor B', priceJpy: 30000 }, price: null },
        c: { name: 'Keyboard C', suggestion: { name: 'Keyboard C', priceJpy: 12000 } },
      },
      outletCount: 2,
      lang: 'ja',
    })
    const byName = new Map(created.map((gadget) => [gadget.name, gadget]))
    assert.equal(byName.get('Monitor A')?.price, 24800)
    assert.equal(byName.get('Monitor A')?.purchasedAt, '2023-04-01')
    assert.equal(byName.get('Monitor B')?.price, undefined)
    assert.equal(byName.get('Monitor B')?.purchasedAt, undefined)
    assert.equal(byName.get('Monitor B')?.introducedAtUnknown, true)
    assert.equal(byName.get('Monitor B')?.isCandidate, true)
    // 欄を持たない呼び出しは今まで通り候補の価格を使う
    assert.equal(byName.get('Keyboard C')?.price, 12000)
    assert.notEqual(byName.get('Keyboard C')?.purchasedAt, '2023-04-01')
  })
  it('所有機材として作成した場合も、空欄の日付を補完せず、既存機材の状態を維持する', async () => {
    const template = compositionTemplate([{ category: 'Keyboard' }, { category: 'Mouse' }], compositionNames(['work']))
    const existing: Gadget = { id: 'owned', name: 'Owned mouse', category: 'Mouse', ports: [], purchasedAt: '2020-01-01', createdAt: '2020-01-01T00:00:00Z' }
    const created: Gadget[] = []
    const plans: DeskPlan[] = []
    await applyTemplate(template, {
      items: buildTemplateItems(template, 'ja'), selections: { '1-0': existing.id }, existingGadgets: [existing],
      registerAsOwned: true, products: { '0-0': { name: 'Owned keyboard' } },
      addGadgets: async (gadgets) => { created.push(...gadgets) }, addPlan: async (plan) => { plans.push(plan) },
      outletCount: 2, lang: 'ja',
    })
    assert.equal(created.length, 1)
    assert.equal(created[0].isCandidate, undefined)
    assert.equal(created[0].isPlaceholder, undefined)
    assert.equal(created[0].purchasedAt, undefined)
    assert.equal(created[0].introducedAtUnknown, true)
    assert.ok(plans[0].selectedGadgetIds.includes(existing.id))
    assert.equal(existing.purchasedAt, '2020-01-01')
  })
})
