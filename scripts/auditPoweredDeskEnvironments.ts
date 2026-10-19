/**
 * コンセント・USBを内蔵または固定したデスク10構成 × 10用途を監査する。
 * 実行: npm run audit:powered-desks
 */
import { CATEGORY_PORT_CONFIG } from '../src/constants/portFormConfig'
import { DESK_PRESETS, GadgetPreset } from '../src/constants/gadgetPresets'
import { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { canSelectPowerSource, canSupplyPowerInput } from '../src/utils/gadgetPorts'
import { generateWiring } from '../src/utils/wiringEngine'

interface PowerDeskProfile {
  name: string
  outlets: number
  usbA: number
  usbC: number
  usbCPd?: boolean
}

interface AuditCase {
  profile: PowerDeskProfile
  archetype: string
  gadgets: Gadget[]
  outletCount: number
  validate: (connections: ReturnType<typeof generateWiring>['connections'], warnings: string[]) => string[]
}

let portSeq = 0
let gadgetSeq = 0
const createdAt = '2026-08-30T00:00:00.000Z'
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `powered-desk-port-${++portSeq}`,
  type,
  direction,
  count,
  ...extra,
})
const g = (caseId: string, name: string, category: GadgetCategory, ports: Port[], extra: Partial<Gadget> = {}): Gadget => ({
  id: `${caseId}-g${++gadgetSeq}`,
  name,
  category,
  ports,
  createdAt,
  ...extra,
})
const acIn = () => p('Power', 'input', 1, { label: 'AC入力' })

const profiles: PowerDeskProfile[] = [
  { name: 'サンワサプライ FDM-12060LMAC', outlets: 2, usbA: 1, usbC: 0 },
  { name: 'サンワサプライ FDM-12070LMAC', outlets: 2, usbA: 1, usbC: 0 },
  { name: 'サンワサプライ FDM-14060LMAC', outlets: 2, usbA: 1, usbC: 0 },
  { name: 'サンワサプライ FDM-14070LMAC', outlets: 2, usbA: 1, usbC: 0 },
  { name: 'デスク＋サンワ 100-MR113M', outlets: 2, usbA: 3, usbC: 0 },
  { name: 'デスク＋サンワ 100-MR114M', outlets: 2, usbA: 3, usbC: 0 },
  { name: 'サンワ 100-SHB002GY ワークブース', outlets: 2, usbA: 2, usbC: 0 },
  { name: 'デスク＋イトーキ CZRA-402C', outlets: 4, usbA: 2, usbC: 0 },
  { name: 'デスク＋サンワ TAP-B105UC-3W', outlets: 4, usbA: 1, usbC: 1 },
  { name: 'デスク＋サンワ ACA-PD106', outlets: 0, usbA: 2, usbC: 2, usbCPd: true },
]

const archetypes = [
  'デスク単体',
  '内蔵コンセントからモニター',
  '内蔵コンセントからPC',
  'AC全口使用',
  'AC口数超過',
  'USB-Aスマホ充電',
  'USB-C PDノートPC',
  'AC・USB同時使用',
  '壁コンセントなし',
  'AC入力欠落の異常データ',
] as const

const poweredDesk = (caseId: string, profile: PowerDeskProfile, includeInput = true) => g(caseId, profile.name, 'Desk', [
  ...(includeInput ? [acIn()] : []),
  ...(profile.outlets ? [p('Power', 'output', profile.outlets, { label: '内蔵ACコンセント' })] : []),
  ...(profile.usbA ? [p('USB_A', 'output', profile.usbA, { label: '給電用USB-A' })] : []),
  ...(profile.usbC ? [p('USB_C', 'output', profile.usbC, { label: profile.usbCPd ? 'USB-C PD給電' : '給電用USB-C', supportsPowerDelivery: profile.usbCPd })] : []),
])
const acLoad = (caseId: string, name: string, category: GadgetCategory = 'Monitor') => g(caseId, name, category, [acIn()])
const phone = (caseId: string, deskId: string) => g(caseId, 'スマートフォン', 'Smartphone', [p('USB_C', 'input', 1, { label: '充電' })], {
  powerUsage: 'rechargeable',
  powerSourceGadgetId: deskId,
})
const laptop = (caseId: string, deskId: string) => g(caseId, 'USB-C PDノートPC', 'PC', [p('USB_C', 'input', 1, { label: 'USB-C PD充電' })], {
  pcFormFactor: 'laptop',
  powerUsage: 'rechargeable',
  powerSourceGadgetId: deskId,
})

const fromDesk = (connections: ReturnType<typeof generateWiring>['connections'], desk: Gadget, target?: Gadget, cable?: string) =>
  connections.filter((item) => item.fromGadgetId === desk.id && (!target || item.toGadgetId === target.id) && (!cable || item.cableType === cable))
const failedFor = (connections: ReturnType<typeof generateWiring>['connections'], target: Gadget) =>
  connections.some((item) => item.fromGadgetId === 'failed-power' && item.toGadgetId === target.id)

function buildCase(profile: PowerDeskProfile, profileIndex: number, archetypeIndex: number): AuditCase {
  const caseId = `powered-f${profileIndex + 1}-a${archetypeIndex + 1}`
  const desk = poweredDesk(caseId, profile, archetypeIndex !== 9)
  const gadgets: Gadget[] = [desk]
  let outletCount = 1
  let validate: AuditCase['validate'] = (connections) =>
    connections.some((item) => item.fromGadgetId === 'wall' && item.toGadgetId === desk.id) ? [] : ['デスクへのAC入力がない']

  if (archetypeIndex === 1 || archetypeIndex === 2) {
    const load = acLoad(caseId, archetypeIndex === 1 ? 'モニター' : 'デスクトップPC', archetypeIndex === 1 ? 'Monitor' : 'PC')
    gadgets.push(load)
    validate = (connections, warnings) => profile.outlets > 0
      ? (fromDesk(connections, desk, load, 'Power').length === 1 ? [] : ['内蔵コンセントから給電されない'])
      : (fromDesk(connections, desk, load).length === 0 && warnings.some((warning) => warning.includes(load.name)) ? [] : ['AC出力なしを検知できない'])
  } else if (archetypeIndex === 3 || archetypeIndex === 4) {
    const overflow = archetypeIndex === 4 ? 1 : 0
    const loadCount = Math.max(1, profile.outlets + overflow)
    const loads = Array.from({ length: loadCount }, (_, index) => acLoad(caseId, `AC機器${index + 1}`))
    gadgets.push(...loads)
    validate = (connections, warnings) => {
      const issues: string[] = []
      if (fromDesk(connections, desk, undefined, 'Power').length !== profile.outlets) issues.push('AC口数と給電数が一致しない')
      const shouldFail = profile.outlets === 0 || overflow === 1
      if (shouldFail && !warnings.some((warning) => /給電できません|コンセント/.test(warning))) issues.push('AC口数超過の警告がない')
      return issues
    }
  } else if (archetypeIndex === 5) {
    const target = phone(caseId, desk.id)
    gadgets.push(target)
    validate = (connections) => fromDesk(connections, desk, target).length === 1 ? [] : ['USB-A充電が成立しない']
  } else if (archetypeIndex === 6) {
    const target = laptop(caseId, desk.id)
    gadgets.push(target)
    validate = (connections) => profile.usbCPd
      ? (fromDesk(connections, desk, target, 'USB_C').length === 1 ? [] : ['USB-C PD給電が成立しない'])
      : (failedFor(connections, target) ? [] : ['非PDポートからノートPCへ給電した'])
  } else if (archetypeIndex === 7) {
    const monitor = acLoad(caseId, 'モニター')
    const target = phone(caseId, desk.id)
    gadgets.push(monitor, target)
    validate = (connections, warnings) => {
      const issues: string[] = []
      if (profile.outlets > 0 && fromDesk(connections, desk, monitor, 'Power').length !== 1) issues.push('AC同時給電が成立しない')
      if (profile.outlets === 0 && (fromDesk(connections, desk, monitor).length > 0 || !warnings.some((warning) => warning.includes(monitor.name)))) issues.push('AC出力なしを検知できない')
      if (fromDesk(connections, desk, target).length !== 1) issues.push('USB同時給電が成立しない')
      return issues
    }
  } else if (archetypeIndex === 8) {
    outletCount = 0
    const target = phone(caseId, desk.id)
    gadgets.push(target)
    validate = (connections, warnings) => {
      const issues: string[] = []
      if (fromDesk(connections, desk).length > 0) issues.push('未通電デスクから給電した')
      if (!warnings.some((warning) => /壁コンセントがないため.*給電できません/.test(warning))) issues.push('壁コンセントなし警告がない')
      return issues
    }
  } else if (archetypeIndex === 9) {
    const monitor = acLoad(caseId, 'モニター')
    const target = phone(caseId, desk.id)
    gadgets.push(monitor, target)
    validate = (connections) => fromDesk(connections, desk).length === 0 ? [] : ['AC入力のないデスクから給電した']
  }

  return { profile, archetype: archetypes[archetypeIndex], gadgets, outletCount, validate }
}

const cases = profiles.flatMap((profile, profileIndex) =>
  archetypes.map((_, archetypeIndex) => buildCase(profile, profileIndex, archetypeIndex)))
const planFor = (scenario: AuditCase): DeskPlan => ({
  id: `plan-${scenario.profile.name}-${scenario.archetype}`,
  name: `${scenario.profile.name} / ${scenario.archetype}`,
  goal: 'clean_wiring',
  selectedGadgetIds: scenario.gadgets.map((item) => item.id),
  placements: [],
  outletCount: scenario.outletCount,
  outletCountVersion: 2,
  createdAt,
  updatedAt: createdAt,
})
const results = cases.map((scenario) => {
  const result = generateWiring(scenario.gadgets, planFor(scenario), 'ja')
  return { ...scenario, issues: scenario.validate(result.connections, result.warnings) }
})

const presetIssues: string[] = []
const fdmNames = profiles.slice(0, 4).map((profile) => profile.name)
for (const name of fdmNames) {
  const preset = DESK_PRESETS.find((item): item is GadgetPreset => item.name === name && 'category' in item)
  if (!preset) { presetIssues.push(`${name}: プリセットがない`); continue }
  const count = (type: PortType, direction: PortDirection) => preset.ports
    .filter((port) => port.type === type && port.direction === direction)
    .reduce((sum, port) => sum + port.count, 0)
  if (count('Power', 'input') !== 1 || count('Power', 'output') !== 2 || count('USB_A', 'output') !== 1) {
    presetIssues.push(`${name}: AC入力1・AC出力2・USB-A出力1ではない`)
  }
}
const deskFields = CATEGORY_PORT_CONFIG.Desk ?? []
for (const [type, direction] of [['Power', 'input'], ['Power', 'output'], ['USB_A', 'output'], ['USB_C', 'output']] as const) {
  if (!deskFields.some((field) => field.portType === type && field.direction === direction)) presetIssues.push(`デスクフォームに${type}/${direction}がない`)
}
const sourceDesk = poweredDesk('source-check', profiles[0])
if (!canSelectPowerSource('Smartphone', 'Desk') || !canSupplyPowerInput(sourceDesk, 'from_a')) presetIssues.push('デスクをUSB給電元として選択できない')

const passed = results.filter((result) => result.issues.length === 0)
console.log('コンセント・USB付きデスク環境監査（10構成 × 10用途）')
console.log(`ケース: ${results.length} / 成立: ${passed.length} / 不成立: ${results.length - passed.length}`)
for (const archetype of archetypes) {
  const items = results.filter((result) => result.archetype === archetype)
  console.log(`  ${archetype}: ${items.filter((item) => item.issues.length === 0).length}/${items.length}`)
}
console.log(`フォーム・プリセット監査: ${presetIssues.length === 0 ? 'PASS' : `NG ${presetIssues.length}件`}`)
for (const issue of presetIssues) console.log(`  ${issue}`)
for (const result of results.filter((item) => item.issues.length > 0)) console.log(`NG ${result.profile.name} / ${result.archetype}: ${result.issues.join(', ')}`)

if (cases.length !== 100) throw new Error('コンセント・USB付きデスクケースが100件ではありません')
if (results.some((result) => result.issues.length > 0) || presetIssues.length > 0) throw new Error('コンセント・USB付きデスク監査に失敗しました')
