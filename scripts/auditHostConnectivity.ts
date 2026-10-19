import { ALL_PRODUCT_PRESETS, GadgetPreset } from '../src/constants/gadgetPresets'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import { DeskPlan, Gadget, GadgetCategory } from '../src/types'
import { buildTimeline } from '../src/utils/deskTimeline'
import { generateWiring } from '../src/utils/wiringEngine'

const REQUIRED = new Set<GadgetCategory>(['Mouse', 'Keyboard', 'PenTablet', 'Webcam', 'Controller'])
const HOSTS = new Set<GadgetCategory>(['PC', 'GameConsole', 'Smartphone', 'Tablet'])
const NON_SIGNAL = new Set(['Power', 'DCPower', 'wirelessCharging', 'MonitorArm', 'MicArm'])

const hostPc: Gadget = {
  id: 'audit-pc',
  name: 'Audit PC',
  category: 'PC',
  ports: [
    { id: 'usb-a', type: 'USB_A', direction: 'output', count: 64 },
    { id: 'usb-c', type: 'USB_C', direction: 'output', count: 64 },
    { id: 'usb-b', type: 'USB_B', direction: 'output', count: 64 },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
}

const hostConsole: Gadget = {
  id: 'audit-console',
  name: 'Audit Console',
  category: 'GameConsole',
  consoleFormFactor: 'stationary',
  ports: [{ id: 'bt', type: 'Bluetooth', direction: 'bidirectional', count: 16 }],
  createdAt: '2026-01-01T00:00:00.000Z',
}

function planFor(gadgets: Gadget[]): DeskPlan {
  return {
    id: 'audit-plan',
    name: 'Connectivity audit',
    goal: 'first_setup',
    selectedGadgetIds: gadgets.map((gadget) => gadget.id),
    placements: [],
    outletCount: 8,
    outletCountVersion: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function reachesHost(
  gadgetId: string,
  gadgets: Gadget[],
  connections: Array<{ fromGadgetId: string; toGadgetId: string; cableType: string; chargingOnly?: boolean }>,
): boolean {
  const byId = new Map(gadgets.map((gadget) => [gadget.id, gadget]))
  const graph = new Map<string, string[]>()
  for (const connection of connections) {
    if (connection.chargingOnly || NON_SIGNAL.has(connection.cableType) || connection.fromGadgetId.startsWith('failed')) continue
    const from = graph.get(connection.fromGadgetId) ?? []
    from.push(connection.toGadgetId)
    graph.set(connection.fromGadgetId, from)
    const to = graph.get(connection.toGadgetId) ?? []
    to.push(connection.fromGadgetId)
    graph.set(connection.toGadgetId, to)
  }

  const queue = [gadgetId]
  const seen = new Set(queue)
  while (queue.length > 0) {
    const current = queue.shift()!
    const gadget = byId.get(current)
    if (current !== gadgetId && gadget && HOSTS.has(gadget.category)) return true
    for (const next of graph.get(current) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return false
}

const failures: string[] = []
const presets = [...new Map(
  (ALL_PRODUCT_PRESETS as unknown as GadgetPreset[])
    .filter((preset) => REQUIRED.has(preset.category) && Array.isArray(preset.ports))
    .map((preset) => [`${preset.category}|${preset.name}`, preset]),
).values()]

for (const [index, preset] of presets.entries()) {
  const gadget: Gadget = { ...preset, id: `audit-gadget-${index}`, createdAt: '2026-01-01T00:00:00.000Z' }
  const gadgets = [hostPc, hostConsole, gadget]
  const result = generateWiring(gadgets, planFor(gadgets))
  if (!reachesHost(gadget.id, gadgets, result.connections)) {
    failures.push(`preset ${preset.category}: ${preset.name}`)
  }
}

for (const { demo, plan, gadgets } of buildAllDemoDesks()) {
  const active = gadgets.filter((gadget) => !gadget.removedAt)
  for (const gadget of active.filter((item) => REQUIRED.has(item.category))) {
    if (!reachesHost(gadget.id, active, plan.connectionMap?.connections ?? [])) {
      failures.push(`demo ${demo.id}: ${gadget.name}`)
    }
  }
  for (const event of buildTimeline(gadgets, plan)) {
    // 履歴の途中には、まだ PC を買っていない時点がある（キーボードを先に買うのは普通のこと）。
    // 繋ぎ先が存在しない日を「繋がっていない」と数えても直しようがないので飛ばす
    if (!event.gadgets.some((item) => HOSTS.has(item.category))) continue
    for (const gadget of event.gadgets.filter((item) => REQUIRED.has(item.category))) {
      if (!reachesHost(gadget.id, event.gadgets, event.connections)) {
        failures.push(`demo ${demo.id} at ${event.date}: ${gadget.name}`)
      }
    }
  }
  for (const gadget of gadgets) {
    if (gadget.category !== 'Charger' && (gadget.wirelessTargetGadgetIds?.length ?? 0) > 0) {
      failures.push(`demo ${demo.id}: ${gadget.name} uses wirelessTargetGadgetIds outside Charger`)
    }
  }
}

if (failures.length > 0) {
  console.error(`Host connectivity audit failed (${failures.length})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Host connectivity audit passed: ${presets.length} presets / ${buildAllDemoDesks().length} demos`)
}
