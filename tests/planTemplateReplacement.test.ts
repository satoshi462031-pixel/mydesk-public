import assert from 'node:assert/strict'
import { it } from 'node:test'
import { replacePlanTemplate } from '../src/utils/planTemplateReplacement'
import { DeskPlan, Gadget } from '../src/types'

const gadget = (id: string): Gadget => ({
  id,
  name: id,
  category: 'PC',
  ports: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  purchasedAt: '2026-08-01',
})

it('テンプレート変更では同じデスクの写真と名前を保ち、配置と自動の配線結果を入れ替える', () => {
  const previous: DeskPlan = {
    id: 'desk-1',
    name: '自分のデスク',
    goal: 'first_setup',
    purposes: ['gaming'],
    templateId: 'old',
    selectedGadgetIds: ['old-device'],
    placements: [{ gadgetId: 'old-device', zone: 'desk_left' }],
    images: ['photo.jpg'],
    favorite: true,
    wiringResult: { connections: [], requiredCables: [], warnings: [] },
    connectionMap: {
      connections: [{
        id: 'c1', fromGadgetId: 'old-device', toGadgetId: 'monitor', origin: 'auto',
        cableType: 'HDMI', confirmed: true, cableChoice: { kind: 'included' },
      }],
      dismissedPairs: ['a|b|USB_C'],
      nodeOffsets: { 'old-device': { dx: 1, dy: 2 } },
    },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
  const next: DeskPlan = {
    ...previous,
    id: 'different-id',
    name: '新しいテンプレート名',
    templateId: 'new',
    selectedGadgetIds: ['new-device'],
    placements: [{ gadgetId: 'new-device', zone: 'desk_right' }],
    connectionMap: undefined,
    wiringResult: undefined,
  }

  const result = replacePlanTemplate(previous, next, [gadget('old-device'), gadget('new-device')])
  assert.equal(result.id, previous.id)
  assert.equal(result.name, previous.name)
  assert.deepEqual(result.images, previous.images)
  assert.equal(result.favorite, true)
  assert.equal(result.createdAt, previous.createdAt)
  assert.equal(result.templateId, 'new')
  assert.deepEqual(result.selectedGadgetIds, ['new-device'])
  assert.deepEqual(result.placements, next.placements)
  assert.equal(result.wiringResult, undefined)
  // 本人が入れた線の情報（つなぎ方・非表示にした線）は残し、配置の手直しだけ捨てる
  assert.equal(result.connectionMap?.connections[0].cableChoice?.kind, 'included')
  assert.deepEqual(result.connectionMap?.dismissedPairs, ['a|b|USB_C'])
  assert.equal(result.connectionMap?.nodeOffsets, undefined)
  assert.ok(result.gadgetUsage?.['old-device']?.periods?.at(-1)?.endedAt)
  assert.ok(result.gadgetUsage?.['new-device']?.periods?.at(-1)?.startedAt)
})

it('機材の顔ぶれが同じなら、配置の段で手直しした位置と大きさを残す', () => {
  const previous: DeskPlan = {
    id: 'desk-1',
    name: '自分のデスク',
    goal: 'first_setup',
    templateId: 'old',
    selectedGadgetIds: ['pc', 'monitor'],
    placements: [],
    connectionMap: {
      connections: [],
      nodeOffsets: { pc: { dx: 10, dy: -4 } },
      nodeSizes: { monitor: { w: 120, h: 80 } },
    },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
  const next: DeskPlan = { ...previous, templateId: 'new', selectedGadgetIds: ['monitor', 'pc'], connectionMap: undefined }
  const result = replacePlanTemplate(previous, next, [gadget('pc'), gadget('monitor')])
  assert.deepEqual(result.connectionMap?.nodeOffsets, { pc: { dx: 10, dy: -4 } })
  assert.deepEqual(result.connectionMap?.nodeSizes, { monitor: { w: 120, h: 80 } })
})
