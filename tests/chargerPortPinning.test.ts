import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

let seq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `pin-port-${++seq}`,
  type,
  direction,
  count,
  ...extra,
})
const g = (id: string, category: GadgetCategory, ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category,
  ports,
  createdAt: '2026-08-01T00:00:00.000Z',
  ...extra,
})
const plan = (gadgets: Gadget[], extra: Partial<DeskPlan> = {}): DeskPlan => ({
  id: 'charger-pin-plan',
  name: 'charger port pinning',
  goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((item) => item.id),
  placements: [],
  outletCount: 4,
  outletCountVersion: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...extra,
})
/** 常時給電（1口を占有する）のガジェット */
const alwaysOn = (id: string, createdAt: string, extra: Partial<Gadget> = {}) =>
  g(id, 'Accessory', [p('USB_C', 'input', 1, { label: '給電' })], { powerUsage: 'continuous', createdAt, ...extra })

const chargedBy = (result: ReturnType<typeof generateWiring>, targetId: string) =>
  result.connections.find((item) => item.toGadgetId === targetId && item.cableType === 'USB_C')

describe('charger port pinning', () => {
  it('falls back to another slot when the pinned one is already taken', () => {
    // 4口のうち1口目を指名。先着に取られていても、残り3口があるので給電できる
    const charger = g('charger-4port', 'Charger', [p('Power', 'input'), p('USB_C', 'output', 4)], {
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const slotPort = charger.ports[1].id
    const early = alwaysOn('early-lamp', '2026-02-01T00:00:00.000Z')
    const pinned = alwaysOn('pinned-fan', '2026-03-01T00:00:00.000Z', {
      powerSourceGadgetId: charger.id,
      powerSourcePortId: `${slotPort}#0`,
    })
    const gadgets = [charger, early, pinned]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(chargedBy(result, early.id)?.fromGadgetId, charger.id)
    assert.equal(chargedBy(result, pinned.id)?.fromGadgetId, charger.id)
    assert.notEqual(chargedBy(result, pinned.id)?.sourcePortId, chargedBy(result, early.id)?.sourcePortId)
    assert.equal(result.warnings.length, 0)
  })

  it('still honours the pinned slot when it is free', () => {
    const charger = g('charger-2port', 'Charger', [p('Power', 'input'), p('USB_C', 'output', 2)], {
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const slotPort = charger.ports[1].id
    const pinned = alwaysOn('pinned-fan', '2026-03-01T00:00:00.000Z', {
      powerSourceGadgetId: charger.id,
      powerSourcePortId: `${slotPort}#1`,
    })
    const gadgets = [charger, pinned]
    const result = generateWiring(gadgets, plan(gadgets))

    assert.equal(chargedBy(result, pinned.id)?.sourcePortId, `${slotPort}#1`)
  })

  it('does not drop a charger because the remembered slot moved', () => {
    // ユーザーは何も指定していない。前回の配線図に記録された口を新入りに取られただけ
    const charger = g('charger-2port', 'Charger', [p('Power', 'input'), p('USB_C', 'output', 2)], {
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const slotPort = charger.ports[1].id
    const newcomer = alwaysOn('newcomer-lamp', '2026-02-01T00:00:00.000Z')
    const existing = alwaysOn('existing-fan', '2026-03-01T00:00:00.000Z')
    const gadgets = [charger, newcomer, existing]
    const result = generateWiring(gadgets, plan(gadgets, {
      connectionMap: {
        connections: [{
          id: 'saved-1',
          fromGadgetId: charger.id,
          toGadgetId: existing.id,
          cableType: 'USB_C',
          sourcePortId: `${slotPort}#0`,
          origin: 'auto',
          confirmed: true,
        }],
      },
    }))

    assert.equal(chargedBy(result, existing.id)?.fromGadgetId, charger.id)
    assert.equal(result.warnings.length, 0)
  })

  it('lets handheld consoles without powerUsage share a slot instead of starving always-on loads', () => {
    // 登録画面は携帯ゲーム機の powerUsage を保存しない。先に登録した2台が空き口を1つずつ
    // 取ると、4口のうち常時給電の3台目が「口がすべて埋まっています」で浮いていた
    const charger = g('charger-multi', 'Charger', [p('Power', 'input'), p('USB_C', 'output', 4)], {
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const handheld = (id: string, createdAt: string) =>
      g(id, 'GameConsole', [p('USB_C', 'input', 1, { label: '充電' })], { consoleFormFactor: 'handheld', createdAt })
    const consoles = [handheld('handheld-a', '2026-02-01T00:00:00.000Z'), handheld('handheld-b', '2026-02-02T00:00:00.000Z')]
    const loads = ['lamp', 'fan', 'light'].map((id, i) => alwaysOn(id, `2026-03-0${i + 1}T00:00:00.000Z`))
    const gadgets = [charger, ...consoles, ...loads]
    const result = generateWiring(gadgets, plan(gadgets))

    for (const load of loads) assert.equal(chargedBy(result, load.id)?.fromGadgetId, charger.id)
    for (const item of consoles) assert.equal(chargedBy(result, item.id)?.chargingOnly, true)
    assert.equal(chargedBy(result, consoles[0].id)?.sourcePortId, chargedBy(result, consoles[1].id)?.sourcePortId)
    assert.equal(result.warnings.length, 0)
  })
})
