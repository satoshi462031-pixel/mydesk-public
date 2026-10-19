/**
 * 電動昇降デスクを中心にした10機種 × 10用途の100ケースを監査する。
 * 実行: npm run audit:standing-desks
 */
import { CATEGORY_PORT_CONFIG } from '../src/constants/portFormConfig'
import { DESK_PRESETS, GadgetPreset } from '../src/constants/gadgetPresets'
import { Connection, DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

interface DeskProfile {
  name: string
  min?: string
  max?: string
  usbA?: number
  usbC?: number
}

interface ExpectedEdge {
  from: string
  to: string
  cable?: PortType | 'USB_A_to_C'
  label: string
}

interface AuditCase {
  profile: string
  archetype: string
  name: string
  gadgets: Gadget[]
  expected: ExpectedEdge[]
  outletCount: number
  expectedWarning?: RegExp
}

let portSeq = 0
let gadgetSeq = 0
const createdAt = '2026-08-30T00:00:00.000Z'
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `standing-audit-port-${++portSeq}`,
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
const edge = (from: Gadget | string, to: Gadget | string, label: string, cable?: ExpectedEdge['cable']): ExpectedEdge => ({
  from: typeof from === 'string' ? from : from.id,
  to: typeof to === 'string' ? to : to.id,
  cable,
  label,
})
const acIn = () => p('Power', 'input', 1, { label: '給電 (コンセント)' })

const profiles: DeskProfile[] = [
  { name: 'FLEXISPOT E7', min: '58', max: '123' },
  { name: 'FLEXISPOT E7 Click', min: '63.5', max: '128.5', usbA: 1 },
  { name: 'IKEA MITTZON', min: '62', max: '126' },
  { name: 'IKEA IDASEN', min: '63', max: '127' },
  { name: 'UPLIFT V2', min: '61.7', max: '126.7' },
  { name: 'UPLIFT V2 Commercial', min: '57.4', max: '123.7' },
  { name: 'サンワダイレクト 100-ERD039M', usbA: 1, usbC: 1 },
  { name: 'サンワダイレクト 102-ERD101', usbA: 1, usbC: 1 },
  { name: 'COFO Desk Premium', min: '63', max: '128', usbA: 1 },
  { name: 'オカムラ Swift Nex' },
]

const archetypes = [
  'デスク単体',
  '天板下電源タップ',
  'デスクトップPC＋モニター',
  'USB-C給電ノートPC',
  'デュアルモニター',
  'モニターアーム',
  'ゲーム機＋モニター',
  'PC・ゲーム機KVM共有',
  '操作パネルUSB充電',
  'コンセントなし検知',
] as const

const standingDesk = (caseId: string, profile: DeskProfile) => g(caseId, profile.name, 'Desk', [
  acIn(),
  ...(profile.usbA ? [p('USB_A', 'output', profile.usbA, { label: '充電用USB-A' })] : []),
  ...(profile.usbC ? [p('USB_C', 'output', profile.usbC, { label: '充電用USB-C' })] : []),
], {
  isHeightAdjustable: true,
  deskLiftType: 'electric',
  deskHeightMin: profile.min,
  deskHeightMax: profile.max,
})

const powerStrip = (caseId: string) => g(caseId, '天板下電源タップ', 'PowerStrip', [
  p('Power', 'output', 8),
  acIn(),
])
const monitor = (caseId: string, name = 'モニター', withArm = false) => g(caseId, name, 'Monitor', [
  p('HDMI', 'input', 1, { supportsVideo: true }),
  ...(withArm ? [p('MonitorArm', 'input')] : []),
  acIn(),
])
const desktop = (caseId: string) => g(caseId, 'デスクトップPC', 'PC', [
  p('HDMI', 'output', 2, { supportsVideo: true }),
  p('USB_A', 'output', 4),
  acIn(),
], { pcFormFactor: 'desktop' })
const laptop = (caseId: string) => g(caseId, 'USB-CノートPC', 'PC', [
  p('USB_C', 'input', 1, { label: 'USB-C PD充電' }),
], { pcFormFactor: 'laptop', powerUsage: 'rechargeable' })
const charger = (caseId: string) => g(caseId, 'USB-C PD充電器', 'Charger', [
  p('USB_C', 'output', 2, { supportsPowerDelivery: true, label: 'USB-C PD' }),
  acIn(),
])
const consoleGadget = (caseId: string) => g(caseId, 'ゲーム機', 'GameConsole', [
  p('HDMI', 'output', 1, { supportsVideo: true }),
  acIn(),
], { consoleFormFactor: 'stationary' })

function buildCase(profile: DeskProfile, profileIndex: number, archetypeIndex: number): AuditCase {
  const caseId = `standing-f${profileIndex + 1}-a${archetypeIndex + 1}`
  const desk = standingDesk(caseId, profile)
  const gadgets: Gadget[] = [desk]
  const expected: ExpectedEdge[] = []
  let outletCount = 12
  let expectedWarning: RegExp | undefined = /最高位置/

  if (archetypeIndex !== 9) expected.push(edge('wall', desk, '電動デスクへ給電', 'Power'))

  switch (archetypeIndex) {
    case 1: {
      const strip = powerStrip(caseId)
      gadgets.push(strip)
      expected.splice(0, 1, edge('wall', strip, '電源タップへ給電', 'Power'), edge(strip, desk, '電源タップからデスクへ給電', 'Power'))
      break
    }
    case 2: {
      const computer = desktop(caseId)
      const screen = monitor(caseId)
      gadgets.push(computer, screen)
      expected.push(edge(computer, screen, 'PCからモニター', 'HDMI'))
      break
    }
    case 3: {
      const computer = laptop(caseId)
      const pd = charger(caseId)
      gadgets.push(computer, pd)
      expected.push(edge('wall', pd, 'PD充電器へ給電', 'Power'), edge(pd, computer, 'ノートPCへUSB-C給電', 'USB_C'))
      break
    }
    case 4: {
      const strip = powerStrip(caseId)
      const computer = desktop(caseId)
      const first = monitor(caseId, 'モニター1')
      const second = monitor(caseId, 'モニター2')
      gadgets.push(strip, computer, first, second)
      expected.splice(0, 1, edge('wall', strip, '電源タップへ給電', 'Power'), edge(strip, desk, '電源タップからデスクへ給電', 'Power'))
      expected.push(edge(computer, first, 'PCからモニター1', 'HDMI'), edge(computer, second, 'PCからモニター2', 'HDMI'))
      break
    }
    case 5: {
      const computer = desktop(caseId)
      const screen = monitor(caseId, 'アーム設置モニター', true)
      const arm = g(caseId, 'モニターアーム', 'MonitorArm', [p('MonitorArm', 'output', 1)])
      gadgets.push(computer, screen, arm)
      expected.push(edge(computer, screen, 'PCからモニター', 'HDMI'), edge(arm, screen, 'アームでモニターを支持', 'MonitorArm'))
      break
    }
    case 6: {
      const game = consoleGadget(caseId)
      const screen = monitor(caseId, 'ゲーミングモニター')
      gadgets.push(game, screen)
      expected.push(edge(game, screen, 'ゲーム機からモニター', 'HDMI'))
      break
    }
    case 7: {
      const computer = desktop(caseId)
      const game = consoleGadget(caseId)
      const selector = g(caseId, 'KVM・HDMI切替器', 'KVM', [
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        acIn(),
      ])
      const screen = monitor(caseId, '共有モニター')
      gadgets.push(computer, game, selector, screen)
      expected.push(
        edge(computer, selector, 'PCからKVM', 'HDMI'),
        edge(game, selector, 'ゲーム機からKVM', 'HDMI'),
        edge(selector, screen, 'KVMから共有モニター', 'HDMI'),
      )
      break
    }
    case 8: {
      const phone = g(caseId, 'スマートフォン', 'Smartphone', [p('USB_C', 'input', 1, { label: '充電' })], { powerUsage: 'rechargeable' })
      gadgets.push(phone)
      if (profile.usbC || profile.usbA) {
        phone.powerSourceGadgetId = desk.id
        expected.push(edge(desk, phone, 'デスクのUSBからスマホを充電', profile.usbC ? 'USB_C' : 'USB_A_to_C'))
      } else {
        const usbCharger = charger(caseId)
        phone.powerSourceGadgetId = usbCharger.id
        gadgets.push(usbCharger)
        expected.push(edge('wall', usbCharger, '充電器へ給電', 'Power'), edge(usbCharger, phone, '充電器からスマホを充電', 'USB_C'))
      }
      break
    }
    case 9:
      outletCount = 0
      expectedWarning = /壁コンセントがないため.*給電できません/
      break
  }

  return {
    profile: profile.name,
    archetype: archetypes[archetypeIndex],
    name: `${profile.name} / ${archetypes[archetypeIndex]}`,
    gadgets,
    expected,
    outletCount,
    expectedWarning,
  }
}

const cases = profiles.flatMap((profile, profileIndex) =>
  archetypes.map((_, archetypeIndex) => buildCase(profile, profileIndex, archetypeIndex)))

const planFor = (scenario: AuditCase): DeskPlan => ({
  id: `plan-${scenario.name}`,
  name: scenario.name,
  goal: 'clean_wiring',
  selectedGadgetIds: scenario.gadgets.map((item) => item.id),
  placements: [],
  outletCount: scenario.outletCount,
  outletCountVersion: 2,
  createdAt,
  updatedAt: createdAt,
})

const matchesEdge = (connection: Connection, expected: ExpectedEdge) =>
  connection.fromGadgetId === expected.from &&
  connection.toGadgetId === expected.to &&
  (!expected.cable || connection.cableType === expected.cable)

const results = cases.map((scenario) => {
  const result = generateWiring(scenario.gadgets, planFor(scenario), 'ja')
  const issues: string[] = []
  for (const expected of scenario.expected) {
    if (!result.connections.some((connection) => matchesEdge(connection, expected))) issues.push(`missing:${expected.label}`)
  }
  if (scenario.expectedWarning && !result.warnings.some((warning) => scenario.expectedWarning!.test(warning))) {
    issues.push(`missing-warning:${scenario.expectedWarning}`)
  }
  if (scenario.outletCount > 0 && result.connections.some((connection) => connection.fromGadgetId.startsWith('failed'))) {
    issues.push('failed-sentinel')
  }
  return { ...scenario, connections: result.connections.length, warnings: result.warnings.length, issues }
})

const presetIssues: string[] = []
const electricPresets = DESK_PRESETS.filter((preset): preset is GadgetPreset =>
  'category' in preset && preset.category === 'Desk' && preset.deskLiftType === 'electric')
for (const preset of electricPresets) {
  if (!preset.ports.some((port) => port.type === 'Power' && port.direction === 'input')) {
    presetIssues.push(`${preset.name}: 電源入力がない`)
  }
}
for (const name of ['FLEXISPOT E7', 'IKEA MITTZON 昇降デスク', 'IKEA IDASEN 昇降デスク', 'UPLIFT V2', 'COFO Desk Premium']) {
  const preset = electricPresets.find((item) => item.name === name)
  if (!preset?.deskHeightMin || !preset.deskHeightMax) presetIssues.push(`${name}: 昇降範囲がない`)
}
for (const name of ['Bauhutte BHD-1200M 昇降デスク', 'Bauhutte BHD-W1200M 昇降デスク']) {
  const preset = DESK_PRESETS.find((item) => item.name === name)
  if (!preset || !('deskLiftType' in preset) || preset.deskLiftType !== 'manual' || preset.ports.some((port) => port.type === 'Power')) {
    presetIssues.push(`${name}: 手動昇降として登録されていない`)
  }
}
const deskFields = CATEGORY_PORT_CONFIG.Desk ?? []
if (!deskFields.some((field) => field.portType === 'USB_A' && field.direction === 'output')) presetIssues.push('デスクフォームにUSB-A出力がない')
if (!deskFields.some((field) => field.portType === 'USB_C' && field.direction === 'output')) presetIssues.push('デスクフォームにUSB-C出力がない')

const passed = results.filter((result) => result.issues.length === 0)
console.log('電動昇降デスク環境監査（10機種 × 10用途）')
console.log(`ケース: ${results.length} / 成立: ${passed.length} / 不成立: ${results.length - passed.length}`)
for (const archetype of archetypes) {
  const items = results.filter((result) => result.archetype === archetype)
  console.log(`  ${archetype}: ${items.filter((item) => item.issues.length === 0).length}/${items.length}`)
}
console.log(`プリセット監査: ${presetIssues.length === 0 ? 'PASS' : `NG ${presetIssues.length}件`}`)
for (const issue of presetIssues) console.log(`  ${issue}`)
if (process.env.AUDIT_VERBOSE) {
  for (const result of results.filter((item) => item.issues.length > 0)) console.log(`NG ${result.name}: ${result.issues.join(', ')}`)
}

if (cases.length !== 100) throw new Error('電動昇降デスクケースが100件ではありません')
process.exit(results.some((result) => result.issues.length > 0) || presetIssues.length > 0 ? 1 : 0)
