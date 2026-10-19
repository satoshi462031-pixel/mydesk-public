import type { DeskPlan, Gadget } from '../types'

export const DESK_HISTORY_DEMO_STEPS = [
  { date: '2022-04-01', ja: '最初の一台', en: 'The first computer' },
  { date: '2024-07-01', ja: 'モニターを追加', en: 'Adding a monitor' },
  { date: '2026-02-01', ja: 'モニターを買い替え', en: 'Upgrading the monitor' },
  { date: '2026-07-01', ja: '今のデスクへ', en: 'The desk today' },
] as const

export const DESK_HISTORY_DEMO_PLAN_ID = 'history-demo'

export function getDeskHistoryDemo(lang: 'ja' | 'en'): { plan: DeskPlan; gadgets: Gadget[] } {
  const ja = lang === 'ja'
  const gadget = (id: string, name: string, category: Gadget['category'], date: string, ports: Gadget['ports'], extra: Partial<Gadget> = {}): Gadget => ({
    id: `history-demo-${id}`, name, category, purchasedAt: date, createdAt: `${date}T00:00:00.000Z`, ports, ...extra,
  })
  const monitorPorts: Gadget['ports'] = [
    { id: 'video', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
    { id: 'power', type: 'Power', direction: 'input', count: 1 },
  ]
  const gadgets = [
    gadget('pc', ja ? 'ノートPC' : 'Laptop', 'PC', DESK_HISTORY_DEMO_STEPS[0].date, [
      { id: 'video', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true },
      { id: 'usb', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'audio', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'power', type: 'Power', direction: 'input', count: 1 },
    ], { pcFormFactor: 'laptop' }),
    gadget('monitor-old', ja ? '最初のモニター' : 'First monitor', 'Monitor', DESK_HISTORY_DEMO_STEPS[1].date, monitorPorts, { removedAt: DESK_HISTORY_DEMO_STEPS[2].date }),
    gadget('monitor', ja ? '新しいモニター' : 'New monitor', 'Monitor', DESK_HISTORY_DEMO_STEPS[2].date, monitorPorts),
    gadget('mouse', ja ? 'マウス' : 'Mouse', 'Mouse', DESK_HISTORY_DEMO_STEPS[3].date, [
      { id: 'usb', type: 'USB_A', direction: 'input', count: 1 },
    ]),
    gadget('headphone', ja ? 'ヘッドホン' : 'Headphones', 'Headphone', DESK_HISTORY_DEMO_STEPS[3].date, [
      { id: 'audio', type: 'Audio3_5mm', direction: 'input', count: 1 },
    ]),
  ]
  return {
    gadgets,
    plan: {
      id: DESK_HISTORY_DEMO_PLAN_ID, name: ja ? 'デスクの歩み（見本）' : 'A desk through time (demo)',
      goal: 'desk_tour', selectedGadgetIds: gadgets.filter(g => !g.removedAt).map(g => g.id),
      placements: [], isShared: true, createdAt: '2022-04-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    },
  }
}
