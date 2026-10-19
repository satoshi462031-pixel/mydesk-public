/** npx tsx scripts/auditWiringDifficultCases.ts — 不自然な映像接続の最小再現。問題が残る場合は終了コード1。 */
import type { DeskPlan, Gadget, Port, WiringResult } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

let seq = 0
const at = '2026-10-11T00:00:00.000Z'
const port = (type: Port['type'], direction: Port['direction'], count = 1, extra: Partial<Port> = {}): Port => ({
  id: `difficult-port-${++seq}`, type, direction, count, ...extra,
})
const gadget = (id: string, category: Gadget['category'], ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id, name: id, category, ports, createdAt: at, ...extra,
})
const ac = () => port('Power', 'input')
const pc = gadget('pc', 'PC', [port('DisplayPort', 'output'), port('HDMI', 'output'), ac()], { pcFormFactor: 'desktop' })
const flexible = gadget('flexible', 'Monitor', [port('DisplayPort', 'input'), port('HDMI', 'input'), ac()])
const dpOnly = gadget('dp-only', 'Monitor', [port('DisplayPort', 'input'), ac()])
const mixed = gadget('mixed-pc', 'PC', [
  port('USB_C', 'output', 1, { supportsVideo: true }),
  port('USB_C', 'output', 1, { supportsVideo: false }), ac(),
], { pcFormFactor: 'desktop' })
const usbMonitor = (id: string) => gadget(id, 'Monitor', [port('USB_C', 'input', 1, { supportsVideo: true }), ac()])
const dataPc = gadget('data-pc', 'PC', [
  port('USB_C', 'output', 1, { supportsVideo: false }), port('DisplayPort', 'output'), ac(),
], { pcFormFactor: 'desktop' })
const dock = gadget('dock', 'Dock', [
  port('USB_C', 'input', 1, { supportsVideo: true }), port('DisplayPort', 'output'), ac(),
])

type AuditCase = { name: string; gadgets: Gadget[]; inspect: (result: WiringResult) => string[] }
const hasDisplayInput = (result: WiringResult, id: string) => result.connections.some((c) =>
  c.toGadgetId === id && ['HDMI', 'DisplayPort', 'USB_C'].includes(c.toPortType))
const inspectMatching = (result: WiringResult) => [flexible, dpOnly]
  .filter((g) => !hasDisplayInput(result, g.id))
  .map((g) => `${g.id}: DPを専用画面、HDMIを両対応画面へ割り当てれば接続できるが未接続`)
const inspectVideoCapacity = (result: WiringResult) => {
  const count = result.connections.filter((c) => c.fromGadgetId === mixed.id && c.fromPortType === 'USB_C'
    && c.toGadgetId.startsWith('screen-')).length
  return count > 1 ? [`映像対応USB-Cは1口だが、${count}画面へ接続された`] : []
}
const inspectDockFeed = (result: WiringResult) => result.connections.some((c) =>
  c.fromGadgetId === dock.id && c.toGadgetId === dpOnly.id && c.fromPortType === 'DisplayPort')
  ? ['PC→Dockは映像非対応USB-Cなのに、Dock→画面の映像接続が生成された'] : []

const cases: AuditCase[] = [
  { name: 'A: 映像対応/非対応USB-Cが同じ方向で混在', gadgets: [mixed, usbMonitor('screen-1'), usbMonitor('screen-2')], inspect: inspectVideoCapacity },
  { name: 'A対照: 非対応USB-Cを除く', gadgets: [{ ...mixed, ports: mixed.ports.filter((p) => p.supportsVideo !== false) }, usbMonitor('screen-1'), usbMonitor('screen-2')], inspect: inspectVideoCapacity },
  { name: 'B: 両対応画面を先に登録', gadgets: [pc, flexible, dpOnly], inspect: inspectMatching },
  { name: 'B対照: DP専用画面を先に登録', gadgets: [pc, dpOnly, flexible], inspect: inspectMatching },
  { name: 'C: 映像が届かないDockを画面の接続先に指定', gadgets: [dataPc, dock, { ...dpOnly, bluetoothTargetGadgetIds: [dock.id] }], inspect: inspectDockFeed },
  { name: 'C対照: 接続先を自動選択', gadgets: [dataPc, dock, dpOnly], inspect: inspectDockFeed },
]

let issueCount = 0
for (const scenario of cases) {
  const plan: DeskPlan = {
    id: 'difficult-case', name: scenario.name, goal: 'clean_wiring',
    selectedGadgetIds: scenario.gadgets.map((g) => g.id), placements: [],
    outletCount: 8, outletCountVersion: 2, createdAt: at, updatedAt: at,
  }
  const result = generateWiring(scenario.gadgets, plan, 'ja')
  const issues = scenario.inspect(result)
  issueCount += issues.length
  console.log(`${issues.length ? 'NG' : 'OK'} ${scenario.name}`)
  for (const c of result.connections.filter((c) => c.cableType !== 'Power')) {
    console.log(`  ${c.fromGadgetId}:${c.fromPortType} → ${c.toGadgetId}:${c.toPortType}`)
  }
  for (const issue of issues) console.log(`  問題: ${issue}`)
  for (const warning of result.warnings) console.log(`  警告: ${warning}`)
}
console.log(`構成: ${cases.length} / 問題: ${issueCount}`)
process.exitCode = issueCount > 0 ? 1 : 0
