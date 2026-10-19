import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

const charger: Gadget = {
  id: 'charger',
  name: 'USB-C充電器',
  category: 'Charger',
  ports: [
    { id: 'ac', type: 'Power', direction: 'input', count: 1 },
    { id: 'c', type: 'USB_C', direction: 'output', count: 1 },
  ],
  createdAt: '2024-01-01T00:00:00.000Z',
}

const laptop: Gadget = {
  id: 'laptop',
  name: 'ノートPC',
  category: 'PC',
  pcFormFactor: 'laptop',
  ports: [{ id: 'c', type: 'USB_C', direction: 'input', count: 1 }],
  createdAt: '2024-01-01T00:00:00.000Z',
}

const mobileBattery: Gadget = {
  id: 'battery',
  name: 'モバイルバッテリー',
  category: 'MobileBattery',
  powerUsage: 'rechargeable',
  ports: [{ id: 'c', type: 'USB_C', direction: 'bidirectional', count: 1 }],
  createdAt: '2024-01-01T00:00:00.000Z',
}

const phone: Gadget = {
  id: 'phone',
  name: 'スマートフォン',
  category: 'Smartphone',
  powerUsage: 'rechargeable',
  ports: [{ id: 'c', type: 'USB_C', direction: 'input', count: 1 }],
  createdAt: '2024-01-01T00:00:00.000Z',
}

function plan(gadgets: Gadget[], outletCount: number): DeskPlan {
  return {
    id: 'mobile-power-test',
    name: 'mobile-power-test',
    goal: 'clean_wiring',
    selectedGadgetIds: gadgets.map((gadget) => gadget.id),
    placements: [],
    outletCount,
    outletCountVersion: 2,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('mobile battery power routing', () => {
  it('reserves the charger port for a laptop before rechargeable devices', () => {
    const gadgets = [laptop, charger, mobileBattery, phone]
    const result = generateWiring(gadgets, plan(gadgets, 1), 'ja')

    assert.ok(result.connections.some((connection) =>
      connection.fromGadgetId === charger.id && connection.toGadgetId === laptop.id))
    assert.ok(result.connections.some((connection) =>
      connection.fromGadgetId === charger.id && connection.toGadgetId === mobileBattery.id &&
      connection.chargingOnly === true))
    assert.equal(result.connections.some((connection) =>
      [connection.fromGadgetId, connection.toGadgetId].includes(laptop.id) &&
      [connection.fromGadgetId, connection.toGadgetId].includes(mobileBattery.id) &&
      connection.chargingOnly !== true), false)
  })

  it('uses a power bank as the charging source when no outlet is available', () => {
    const gadgets = [mobileBattery, phone]
    const result = generateWiring(gadgets, plan(gadgets, 0), 'ja')

    assert.ok(result.connections.some((connection) =>
      connection.fromGadgetId === mobileBattery.id &&
      connection.toGadgetId === phone.id &&
      connection.chargingOnly === true))
  })
})
