/**
 * ドッキング機能付きモニター10製品 × 10用途の100ケースを監査する。
 * 実行: npm run audit:docking-monitors
 */
import { GADGET_PRESETS, GadgetPreset } from '../src/constants/gadgetPresets'
import { CATEGORY_PORT_CONFIG, initPortState } from '../src/constants/portFormConfig'
import type { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

const profileNames = [
  'Dell U2725QE',
  'Dell UltraSharp U3225QE',
  'EIZO FlexScan EV2795',
  'BenQ PD3225U',
  'ASUS ProArt PA279CRV',
  'Philips 27B1U7903',
  'LG 40WP95C-W',
  'Lenovo ThinkVision P27h-30 (27" QHD)',
  'HP Series 7 Pro 727pu',
  'Dell Pro 27 Plus P2725HE',
] as const

const archetypes = [
  'ノートPCを1本接続',
  'キーボード・マウスを内蔵ハブへ接続',
  'Webカメラ・外付けSSDを内蔵ハブへ接続',
  'モニター内蔵LANを使用',
  '2台目モニターをデイジーチェーン',
  'HDMI映像＋USBアップストリーム',
  'ノートPC・デスクトップPCの2入力',
  'USB周辺機器3台を同時使用',
  '電源タップ経由',
  '壁コンセントなし',
] as const

interface Profile {
  preset: GadgetPreset
  hostType: 'USB_C' | 'Thunderbolt'
  daisyType: 'USB_C' | 'Thunderbolt' | 'DisplayPort'
  hasEthernet: boolean
}

interface AuditCase {
  profile: Profile
  archetype: typeof archetypes[number]
  gadgets: Gadget[]
  outletCount: number
  validate: (result: ReturnType<typeof generateWiring>) => string[]
}

const presetByName = new Map(GADGET_PRESETS.map((preset) => [preset.name, preset]))
const profiles: Profile[] = profileNames.map((name) => {
  const preset = presetByName.get(name)
  if (!preset) throw new Error(`${name}: プリセットがありません`)
  const host = preset.ports.find((port) =>
    (port.type === 'USB_C' || port.type === 'Thunderbolt') &&
    port.direction === 'input' && port.supportsVideo && port.supportsPowerDelivery)
  const daisy = preset.ports.find((port) =>
    (port.type === 'USB_C' || port.type === 'Thunderbolt' || port.type === 'DisplayPort') &&
    port.direction === 'output' && port.supportsVideo)
  if (!host || (host.type !== 'USB_C' && host.type !== 'Thunderbolt')) throw new Error(`${name}: PD映像入力がありません`)
  if (!daisy || !['USB_C', 'Thunderbolt', 'DisplayPort'].includes(daisy.type)) throw new Error(`${name}: デイジーチェーン出力がありません`)
  return {
    preset,
    hostType: host.type,
    daisyType: daisy.type as Profile['daisyType'],
    hasEthernet: preset.ports.some((port) => port.type === 'Ethernet' && port.direction === 'input'),
  }
})

let portSeq = 0
let gadgetSeq = 0
const createdAt = '2026-08-30T00:00:00.000Z'
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `docking-audit-port-${++portSeq}`,
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
const monitorFrom = (caseId: string, profile: Profile): Gadget => g(
  caseId,
  profile.preset.name,
  'Monitor',
  profile.preset.ports.map((port) => ({ ...port, id: `${caseId}-${port.id}` })),
  { model: profile.preset.model },
)
const laptopFor = (caseId: string, profile: Profile): Gadget => g(caseId, 'ノートPC', 'PC', [
  p(profile.hostType, 'bidirectional', 1, { supportsVideo: true }),
], { pcFormFactor: 'laptop', powerUsage: 'rechargeable' })
const usbPeripheral = (caseId: string, name: string, category: GadgetCategory): Gadget =>
  g(caseId, name, category, [p('USB_A', 'input')])
const has = (result: ReturnType<typeof generateWiring>, from: Gadget, to: Gadget, cableType?: string) =>
  result.connections.some((connection) =>
    connection.fromGadgetId === from.id && connection.toGadgetId === to.id &&
    (!cableType || connection.cableType === cableType),
  )

function buildCase(profile: Profile, profileIndex: number, archetypeIndex: number): AuditCase {
  const caseId = `docking-f${profileIndex + 1}-a${archetypeIndex + 1}`
  const monitor = monitorFrom(caseId, profile)
  const laptop = laptopFor(caseId, profile)
  const gadgets: Gadget[] = [laptop, monitor]
  let outletCount = 8
  let validate: AuditCase['validate'] = (result) => {
    const links = result.connections.filter((connection) =>
      connection.fromGadgetId === laptop.id && connection.toGadgetId === monitor.id)
    return links.length === 1 && links[0].cableType === profile.hostType
      ? []
      : ['映像・USB・PDを1本に集約できない']
  }

  if (archetypeIndex === 1 || archetypeIndex === 2 || archetypeIndex === 7) {
    const names = archetypeIndex === 1
      ? [['キーボード', 'Keyboard'], ['マウス', 'Mouse']]
      : archetypeIndex === 2
        ? [['Webカメラ', 'Webcam'], ['外付けSSD', 'Storage']]
        : [['キーボード', 'Keyboard'], ['マウス', 'Mouse'], ['Webカメラ', 'Webcam']]
    const peripherals = names.map(([name, category]) => usbPeripheral(caseId, name, category as GadgetCategory))
    gadgets.push(...peripherals)
    validate = (result) => peripherals.every((peripheral) => has(result, monitor, peripheral))
      ? []
      : ['内蔵USBハブへ周辺機器を割り当てられない']
  } else if (archetypeIndex === 3) {
    const router = g(caseId, 'ルーター', 'Router', [p('Ethernet', 'output', 4), p('Power', 'input')])
    gadgets.push(router)
    validate = (result) => profile.hasEthernet
      ? (has(result, router, monitor, 'Ethernet') ? [] : ['内蔵LANへ接続できない'])
      : (has(result, router, monitor, 'Ethernet') ? ['LAN非搭載製品へEthernet線を生成した'] : [])
  } else if (archetypeIndex === 4) {
    const secondary = g(caseId, '2台目モニター', 'Monitor', [
      p(profile.daisyType, 'input', 1, { supportsVideo: true }),
      p('Power', 'input'),
    ])
    gadgets.push(secondary)
    validate = (result) => has(result, monitor, secondary, profile.daisyType)
      ? []
      : ['デイジーチェーン出力を使えない']
  } else if (archetypeIndex === 5) {
    const desktop = g(caseId, 'デスクトップPC', 'PC', [
      p('HDMI', 'output', 1, { supportsVideo: true }),
      p('USB_C', 'output'),
      p('USB_A', 'output'),
      p('Power', 'input'),
    ], { pcFormFactor: 'desktop' })
    const keyboard = usbPeripheral(caseId, 'キーボード', 'Keyboard')
    gadgets.splice(0, 1, desktop)
    gadgets.push(keyboard)
    validate = (result) => {
      const issues: string[] = []
      if (!has(result, desktop, monitor, 'HDMI')) issues.push('HDMI映像線がない')
      if (!result.connections.some((connection) =>
        connection.fromGadgetId === desktop.id && connection.toGadgetId === monitor.id &&
        ['USB_C', 'USB_A_to_C', 'USB_A_to_B', 'USB_C_to_B', 'Thunderbolt'].includes(connection.cableType))) {
        issues.push('USBアップストリーム線がない')
      }
      if (!has(result, monitor, keyboard)) issues.push('HDMI利用時に内蔵ハブが動作しない')
      return issues
    }
  } else if (archetypeIndex === 6) {
    const desktop = g(caseId, 'デスクトップPC', 'PC', [p('HDMI', 'output', 1, { supportsVideo: true }), p('Power', 'input')], { pcFormFactor: 'desktop' })
    gadgets.push(desktop)
    validate = (result) =>
      has(result, laptop, monitor, profile.hostType) && has(result, desktop, monitor, 'HDMI')
        ? []
        : ['2台のPCを別入力へ接続できない']
  } else if (archetypeIndex === 8) {
    const strip = g(caseId, '電源タップ', 'PowerStrip', [p('Power', 'input'), p('Power', 'output', 8)])
    gadgets.push(strip)
    validate = (result) => has(result, strip, monitor, 'Power') ? [] : ['モニターが電源タップを経由しない']
  } else if (archetypeIndex === 9) {
    outletCount = 0
    validate = (result) => {
      const issues: string[] = []
      if (result.connections.some((connection) => connection.toGadgetId === monitor.id && connection.cableType === 'Power')) issues.push('コンセントなしでモニターを通電した')
      if (!result.warnings.some((warning) => warning.includes(monitor.name))) issues.push('未通電警告がない')
      return issues
    }
  }

  return { profile, archetype: archetypes[archetypeIndex], gadgets, outletCount, validate }
}

const cases = profiles.flatMap((profile, profileIndex) =>
  archetypes.map((_, archetypeIndex) => buildCase(profile, profileIndex, archetypeIndex)))
const planFor = (scenario: AuditCase): DeskPlan => ({
  id: `plan-${scenario.profile.preset.name}-${scenario.archetype}`,
  name: `${scenario.profile.preset.name} / ${scenario.archetype}`,
  goal: 'clean_wiring',
  selectedGadgetIds: scenario.gadgets.map(({ id }) => id),
  placements: [],
  outletCount: scenario.outletCount,
  outletCountVersion: 2,
  createdAt,
  updatedAt: createdAt,
})
const results = cases.map((scenario) => {
  const result = generateWiring(scenario.gadgets, planFor(scenario), 'ja')
  return { ...scenario, issues: scenario.validate(result) }
})

const presetIssues: string[] = []
for (const profile of profiles) {
  const { preset } = profile
  if (!preset.officialUrl) presetIssues.push(`${preset.name}: 公式URLがない`)
  if (!preset.ports.some((port) => port.type === 'USB_A' && port.direction === 'output')) presetIssues.push(`${preset.name}: USBハブ出力がない`)
  const state = initPortState(preset.ports, CATEGORY_PORT_CONFIG.Monitor ?? [])
  const pdInputCount = Number(state.usbc_pd_in ?? 0) + Number(state.tb_pd_in ?? 0)
  if (pdInputCount < 1) presetIssues.push(`${preset.name}: フォームへPD映像入力を復元できない`)
}

const passed = results.filter((result) => result.issues.length === 0)
console.log('ドッキング機能付きモニター環境監査（10製品 × 10用途）')
console.log(`ケース: ${results.length} / 成立: ${passed.length} / 不成立: ${results.length - passed.length}`)
for (const archetype of archetypes) {
  const items = results.filter((result) => result.archetype === archetype)
  console.log(`  ${archetype}: ${items.filter((item) => item.issues.length === 0).length}/${items.length}`)
}
console.log(`プリセット監査: ${presetIssues.length === 0 ? 'PASS' : `NG ${presetIssues.length}件`}`)
for (const issue of presetIssues) console.log(`  ${issue}`)
for (const result of results.filter((item) => item.issues.length > 0)) {
  console.log(`NG ${result.profile.preset.name} / ${result.archetype}: ${result.issues.join(', ')}`)
}

if (cases.length !== 100) throw new Error('ドッキングモニターケースが100件ではありません')
if (results.some((result) => result.issues.length > 0) || presetIssues.length > 0) throw new Error('ドッキングモニター監査に失敗しました')
