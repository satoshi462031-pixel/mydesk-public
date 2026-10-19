import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DeskPlan, Gadget, MapConnection, Port } from '../src/types'
import { computeMapLayout, reconcileMap } from '../src/utils/connectionMapLayout'
import { generateWiring } from '../src/utils/wiringEngine'

const port = (id: string, type: Port['type'], direction: Port['direction'], count = 1): Port => ({
  id,
  type,
  direction,
  count,
})

const speaker = (hasSubwoofer: boolean): Gadget => ({
  id: 'speaker',
  name: '2.1ch speaker',
  category: 'Speaker',
  stereoPair: true,
  speakerInputSide: 'R',
  hasSubwoofer: hasSubwoofer || undefined,
  ports: [port('audio-in', 'Audio3_5mm', 'input'), port('ac-in', 'Power', 'input')],
  createdAt: '2026-09-13T00:00:00.000Z',
})

const strip: Gadget = {
  id: 'strip',
  name: 'power strip',
  category: 'PowerStrip',
  ports: [port('ac-in', 'Power', 'input'), port('outlets', 'Power', 'output', 4)],
  createdAt: '2026-09-13T00:00:00.000Z',
}

const makePlan = (saved: MapConnection[] = []): DeskPlan => ({
  id: 'subwoofer-plan',
  name: 'subwoofer plan',
  goal: 'clean_wiring',
  selectedGadgetIds: ['strip', 'speaker'],
  placements: [],
  outletCount: 2,
  outletCountVersion: 2,
  createdAt: '2026-09-13T00:00:00.000Z',
  updatedAt: '2026-09-13T00:00:00.000Z',
  ...(saved.length > 0 ? { connectionMap: { connections: saved } } : {}),
})

describe('ウーファーの配線図', () => {
  it('ONなら電源をもう1口使い、電源タップと同じ列へ別ノードで表示する', async () => {
    const gadgets = [strip, speaker(true)]
    const wiring = generateWiring(gadgets, makePlan())
    const speakerPower = wiring.connections.find((connection) =>
      connection.fromGadgetId === 'strip' && connection.toGadgetId === 'speaker' && connection.cableType === 'Power')

    assert.equal(speakerPower?.count, 2)
    assert.equal(speakerPower?.countSource, 'subwoofer')

    const map = reconcileMap([], gadgets, makePlan())
    const layout = await computeMapLayout(gadgets, map)
    const subwooferNode = layout.nodes.find((node) => node.id === 'speaker__SUB')
    const stripNode = layout.nodes.find((node) => node.id === 'strip')

    assert.ok(subwooferNode)
    assert.equal(subwooferNode.isSubwoofer, true)
    assert.equal(subwooferNode.tier, stripNode?.tier)
    assert.ok(layout.edges.some((edge) => edge.to.id === 'speaker__SUB' && edge.conn.cableType === 'Power'))
    assert.ok(layout.edges.some((edge) => edge.to.id === 'speaker__SUB' && edge.isPairLink))
  })

  it('OFFならウーファーノードと自動追加した電源本数を取り除く', async () => {
    const onGadgets = [strip, speaker(true)]
    const existing = reconcileMap([], onGadgets, makePlan())
    const offGadgets = [strip, speaker(false)]
    const updated = reconcileMap(existing, offGadgets, makePlan(existing))
    const speakerPower = updated.find((connection) => connection.toGadgetId === 'speaker' && connection.cableType === 'Power')
    const layout = await computeMapLayout(offGadgets, updated)

    assert.equal(speakerPower?.count, undefined)
    assert.equal(speakerPower?.countSource, undefined)
    assert.equal(layout.nodes.some((node) => node.id === 'speaker__SUB'), false)
  })
})
