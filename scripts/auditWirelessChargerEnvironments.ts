/**
 * ワイヤレス充電器10製品 × 10用途の100ケースを監査する。
 * 実行: npm run audit:wireless-chargers
 */
import { CHARGER_PRESETS, GadgetPreset } from '../src/constants/gadgetPresets'
import { DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { chargerFormStateFromPorts, isWirelessPowerPort } from '../src/utils/gadgetPorts'
import { generateWiring } from '../src/utils/wiringEngine'

interface WirelessProfile {
  name: string
  slots: number
  input: 'Power' | 'USB_C'
}

interface AuditCase {
  profile: WirelessProfile
  archetype: string
  gadgets: Gadget[]
  outletCount: number
  primary: Gadget
  validate: (result: ReturnType<typeof generateWiring>) => string[]
}

const profileNames = [
  'Apple MagSafe充電器 (Qi2 25W)',
  'Anker MagGo Wireless Charger (Pad)',
  'Anker MagGo Wireless Charger (2-in-1, Stand)',
  'Anker MagGo Wireless Charging Station (3-in-1, Foldable Pad)',
  'Anker Prime Wireless Charging Station (3-in-1, MagGo, AirCool)',
  'Anker 737 MagGo Charger (3-in-1 Station)',
  'Belkin UltraCharge 3-in-1 Foldable Magnetic Charger Qi2 25W',
  'Belkin BoostCharge Pro Qi2 3-in-1 ワイヤレス充電パッド 15W',
  'Belkin Qi2 3-in-1 Compact Magnetic Charging Stand 15W',
  'Samsung Super Fast Wireless Charger Duo 15W',
] as const

const presetByName = new Map(CHARGER_PRESETS.map((preset) => [preset.name, preset]))
const profiles: WirelessProfile[] = profileNames.map((name) => {
  const preset = presetByName.get(name)
  if (!preset) throw new Error(`${name}: プリセットがありません`)
  const state = chargerFormStateFromPorts(preset.ports)
  return {
    name,
    slots: state.wirelessCount,
    input: state.powerInput === 'outlet' ? 'Power' : 'USB_C',
  }
})

const archetypes = [
  '充電器単体',
  'スマートフォン1台',
  '全スロット同時使用',
  '同時充電上限超過',
  '給電元を明示指定',
  '充電器側から対象指定',
  'スマホ・Watch・イヤホン混在',
  '壁コンセントなし',
  '電源タップ経由',
  'ワイヤレス充電器2台から選択',
] as const

let portSeq = 0
let gadgetSeq = 0
const createdAt = '2026-08-30T00:00:00.000Z'
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `wireless-audit-port-${++portSeq}`,
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
const wirelessTarget = (caseId: string, name: string, category: GadgetCategory = 'Smartphone', extra: Partial<Gadget> = {}) =>
  g(caseId, name, category, [p('wirelessCharging', 'input', 1, { label: 'ワイヤレス給電' })], { powerUsage: 'rechargeable', ...extra })
const usbTarget = (caseId: string, name: string, extra: Partial<Gadget> = {}) =>
  g(caseId, name, 'Smartphone', [p('USB_C', 'input', 1, { label: '充電' })], { powerUsage: 'rechargeable', ...extra })
const adapter = (caseId: string, name = 'USB-C電源アダプター') => g(caseId, name, 'Charger', [
  p('Power', 'input'),
  p('USB_C', 'output', 1, { supportsPowerDelivery: true, label: 'USB-C PD' }),
])
const strip = (caseId: string) => g(caseId, '電源タップ', 'PowerStrip', [p('Power', 'input'), p('Power', 'output', 6)])

function wirelessCharger(caseId: string, profile: WirelessProfile, name = profile.name): Gadget {
  return g(caseId, name, 'Charger', [
    p(profile.input, 'input', 1, { label: profile.input === 'USB_C' ? 'USB-C給電' : 'AC入力' }),
    p('wirelessCharging', 'output', profile.slots, { label: 'ワイヤレス出力' }),
  ])
}

function poweredSet(caseId: string, profile: WirelessProfile): { gadgets: Gadget[]; charger: Gadget; upstream?: Gadget } {
  const charger = wirelessCharger(caseId, profile)
  if (profile.input === 'Power') return { gadgets: [charger], charger }
  const upstream = adapter(caseId)
  return { gadgets: [upstream, charger], charger, upstream }
}

const wirelessFrom = (result: ReturnType<typeof generateWiring>, source: Gadget) => result.connections.filter((connection) =>
  connection.fromGadgetId === source.id && connection.cableType === 'wirelessCharging')

function buildCase(profile: WirelessProfile, profileIndex: number, archetypeIndex: number): AuditCase {
  const caseId = `wireless-f${profileIndex + 1}-a${archetypeIndex + 1}`
  const base = poweredSet(caseId, profile)
  const gadgets = [...base.gadgets]
  let outletCount = 8
  let validate: AuditCase['validate'] = (result) =>
    result.connections.some((connection) => connection.toGadgetId === base.charger.id) ? [] : ['充電器が通電していない']

  if (archetypeIndex === 1) {
    const target = wirelessTarget(caseId, 'スマートフォン')
    gadgets.push(target)
    validate = (result) => wirelessFrom(result, base.charger).length === 1 ? [] : ['スマートフォンを充電できない']
  } else if (archetypeIndex === 2 || archetypeIndex === 3) {
    const overflow = archetypeIndex === 3 ? 1 : 0
    const targets = Array.from({ length: profile.slots + overflow }, (_, index) => wirelessTarget(caseId, `端末${index + 1}`))
    gadgets.push(...targets)
    validate = (result) => {
      const issues: string[] = []
      if (wirelessFrom(result, base.charger).length !== profile.slots) issues.push('ワイヤレス口数と接続数が一致しない')
      if (overflow && !result.warnings.some((warning) => warning.includes(`端末${targets.length}`))) issues.push('上限超過の警告がない')
      return issues
    }
  } else if (archetypeIndex === 4) {
    const target = wirelessTarget(caseId, '給電元指定スマートフォン', 'Smartphone', { powerSourceGadgetId: base.charger.id })
    gadgets.push(target)
    validate = (result) => wirelessFrom(result, base.charger).some((connection) => connection.toGadgetId === target.id) ? [] : ['指定した充電器から給電されない']
  } else if (archetypeIndex === 5) {
    const target = usbTarget(caseId, '充電器側指定スマートフォン')
    base.charger.wirelessTargetGadgetIds = [target.id]
    gadgets.push(target)
    validate = (result) => wirelessFrom(result, base.charger).some((connection) => connection.toGadgetId === target.id) ? [] : ['充電器側の対象指定が反映されない']
  } else if (archetypeIndex === 6) {
    const targets = [
      wirelessTarget(caseId, 'スマートフォン'),
      wirelessTarget(caseId, 'スマートウォッチ', 'Smartwatch'),
      wirelessTarget(caseId, 'ワイヤレスイヤホン', 'Earphone'),
    ]
    gadgets.push(...targets)
    validate = (result) => {
      const expected = Math.min(profile.slots, targets.length)
      const issues: string[] = []
      if (wirelessFrom(result, base.charger).length !== expected) issues.push('混在端末の同時充電数が不正')
      if (profile.slots < targets.length && result.warnings.length === 0) issues.push('混在端末の上限警告がない')
      return issues
    }
  } else if (archetypeIndex === 7) {
    outletCount = 0
    const target = wirelessTarget(caseId, 'スマートフォン')
    gadgets.push(target)
    validate = (result) => {
      const issues: string[] = []
      if (wirelessFrom(result, base.charger).length !== 0) issues.push('未通電の充電器から給電した')
      if (!result.warnings.some((warning) => /壁コンセントがないため|充電器/.test(warning))) issues.push('壁コンセントなし警告がない')
      return issues
    }
  } else if (archetypeIndex === 8) {
    const powerStrip = strip(caseId)
    gadgets.push(powerStrip)
    validate = (result) => {
      const acTarget = base.upstream ?? base.charger
      const issues: string[] = []
      if (!result.connections.some((connection) => connection.fromGadgetId === powerStrip.id && connection.toGadgetId === acTarget.id)) issues.push('電源タップを経由しない')
      if (base.upstream && !result.connections.some((connection) => connection.fromGadgetId === base.upstream!.id && connection.toGadgetId === base.charger.id)) issues.push('USB-C上流給電がない')
      return issues
    }
  } else if (archetypeIndex === 9) {
    const secondary = g(caseId, '予備ワイヤレス充電器', 'Charger', [p('Power', 'input'), p('wirelessCharging', 'output', 3)])
    const target = wirelessTarget(caseId, '指定スマートフォン', 'Smartphone', { powerSourceGadgetId: base.charger.id })
    gadgets.push(secondary, target)
    validate = (result) => wirelessFrom(result, base.charger).some((connection) => connection.toGadgetId === target.id) ? [] : ['2台の充電器から指定元を選べない']
  }

  return { profile, archetype: archetypes[archetypeIndex], gadgets, outletCount, primary: base.charger, validate }
}

const cases = profiles.flatMap((profile, profileIndex) =>
  archetypes.map((_, archetypeIndex) => buildCase(profile, profileIndex, archetypeIndex)))
const planFor = (scenario: AuditCase): DeskPlan => ({
  id: `plan-${scenario.profile.name}-${scenario.archetype}`,
  name: `${scenario.profile.name} / ${scenario.archetype}`,
  goal: 'clean_wiring',
  selectedGadgetIds: scenario.gadgets.map((gadget) => gadget.id),
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
  const preset = presetByName.get(profile.name) as GadgetPreset | undefined
  if (!preset) { presetIssues.push(`${profile.name}: プリセットがない`); continue }
  const wireless = preset.ports.filter((port) => port.direction !== 'input' && isWirelessPowerPort(port))
    .reduce((sum, port) => sum + port.count, 0)
  if (wireless !== profile.slots || wireless < 1 || wireless > 3) presetIssues.push(`${profile.name}: ワイヤレス口数が不正`)
  if (!preset.officialUrl) presetIssues.push(`${profile.name}: 公式URLがない`)
  const form = chargerFormStateFromPorts(preset.ports)
  if (form.wirelessCount !== profile.slots || form.powerInput === 'none') presetIssues.push(`${profile.name}: フォームへ仕様を復元できない`)
}

const passed = results.filter((result) => result.issues.length === 0)
console.log('ワイヤレス充電器環境監査（10製品 × 10用途）')
console.log(`ケース: ${results.length} / 成立: ${passed.length} / 不成立: ${results.length - passed.length}`)
for (const archetype of archetypes) {
  const items = results.filter((result) => result.archetype === archetype)
  console.log(`  ${archetype}: ${items.filter((item) => item.issues.length === 0).length}/${items.length}`)
}
console.log(`プリセット監査: ${presetIssues.length === 0 ? 'PASS' : `NG ${presetIssues.length}件`}`)
for (const issue of presetIssues) console.log(`  ${issue}`)
for (const result of results.filter((item) => item.issues.length > 0)) console.log(`NG ${result.profile.name} / ${result.archetype}: ${result.issues.join(', ')}`)

if (cases.length !== 100) throw new Error('ワイヤレス充電器ケースが100件ではありません')
if (results.some((result) => result.issues.length > 0) || presetIssues.length > 0) throw new Error('ワイヤレス充電器監査に失敗しました')
