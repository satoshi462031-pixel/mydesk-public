import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Gadget, GadgetCategory, Port } from '../src/types'
import { computeMapLayout } from '../src/utils/connectionMapLayout'
import { generateWiring } from '../src/utils/wiringEngine'

const at = '2026-09-21T00:00:00.000Z'
const g = (id: string, category: GadgetCategory, ports: Port[], extra: Partial<Gadget> = {}): Gadget =>
  ({ id, name: id, category, ports, createdAt: at, ...extra })
const wire = (gadgets: Gadget[], outletCount = 2) => generateWiring(gadgets, {
  id: 'shelf-plan', name: 'shelf', goal: 'clean_wiring',
  selectedGadgetIds: gadgets.map((x) => x.id), placements: [], outletCount,
  createdAt: at, updatedAt: at,
} as never, 'ja')
const layoutOf = async (gadgets: Gadget[]) => {
  const result = wire(gadgets)
  return computeMapLayout(gadgets, result.connections.map((c) => ({ ...c, origin: 'auto' as const, confirmed: true })), [], {}, {}, false)
}

const pc = () => g('pc', 'PC', [{ id: 'a', type: 'USB_C', direction: 'output', count: 2 }, { id: 'b', type: 'Power', direction: 'input', count: 1 }], { pcFormFactor: 'desktop' })
const lamp = () => g('lamp', 'Light', [{ id: 'a', type: 'Power', direction: 'input', count: 1 }])
const phone = () => g('phone', 'Smartphone', [{ id: 'a', type: 'USB_C', direction: 'input', count: 1, label: '充電' }], { powerUsage: 'rechargeable' })
const monitor = (id: string) => g(id, 'Monitor', [{ id: 'a', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true }, { id: 'b', type: 'Power', direction: 'input', count: 1 }])
const withOutlets = (id: string, category: GadgetCategory) => g(id, category, [
  { id: 'p1', type: 'Power', direction: 'input', count: 1 },
  { id: 'p2', type: 'Power', direction: 'output', count: 2, label: '内蔵ACコンセント' },
  { id: 'p3', type: 'USB_C', direction: 'output', count: 1, label: '充電用USB-C' },
])

describe('desk shelves', () => {
  for (const category of ['Furniture', 'WallPanel'] as const) {
    it(`uses the built-in outlets and USB of a ${category}`, () => {
      const result = wire([pc(), lamp(), phone(), withOutlets('shelf', category)])
      const from = (id: string) => result.connections.find((c) => c.toGadgetId === id)?.fromGadgetId
      assert.equal(from('shelf'), 'wall')
      assert.equal(from('pc'), 'shelf')
      assert.equal(from('lamp'), 'shelf')
      assert.equal(from('phone'), 'shelf')
      assert.equal(result.warnings.some((w) => w.includes('shelf に給電できません')), false)
    })
  }

  it('hides a port-less desk shelf even when there is only one monitor', async () => {
    const layout = await layoutOf([pc(), monitor('mon'), g('shelf', 'Furniture', [], { name: 'Grovemade デスクシェルフ' })])
    assert.equal(layout.nodes.some((n) => n.id === 'shelf'), false)
    assert.equal(layout.nodes.some((n) => n.attached?.some((a) => a.id === 'shelf')), false)
  })

  it('hides a port-less shelf when there are multiple monitors', async () => {
    const layout = await layoutOf([pc(), monitor('mon1'), monitor('mon2'), g('shelf', 'Furniture', [], { name: 'デスクシェルフ' })])
    assert.equal(layout.nodes.some((n) => n.id === 'shelf'), false)
  })

  it('hides port-less side shelves and storage furniture', async () => {
    const layout = await layoutOf([pc(), monitor('mon'), g('side', 'Furniture', [], { name: 'デスク横シェルフ' }), g('wagon', 'Furniture', [], { name: '収納ワゴン' })])
    assert.equal(layout.nodes.some((n) => n.id === 'side'), false)
    assert.equal(layout.nodes.some((n) => n.id === 'wagon'), false)
  })

  it('does not show port-less furniture as a mounting badge', async () => {
    const layout = await layoutOf([pc(), monitor('mon1'), monitor('mon2'),
      g('shelf', 'Furniture', [], { name: 'デスクシェルフ', mounting: { targetGadgetId: 'mon2', type: 'mounted_on' } })])
    assert.equal(layout.nodes.some((n) => n.attached?.some((a) => a.id === 'shelf')), false)
  })
})
