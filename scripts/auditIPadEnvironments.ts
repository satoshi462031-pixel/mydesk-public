/**
 * iPad中心のデスク環境を 10機種系統 × 10用途 = 100ケースで監査する。
 *
 * 実行:
 *   npx tsx scripts/auditIPadEnvironments.ts
 *
 * 機種の端子能力と用途は Apple の公開仕様・サポート文書を基準にした。
 * これは実機UIテストではなく、アプリのガジェット/配線モデルが実在構成を
 * 意味どおりに表現できるかを見る決定的な回帰監査である。
 */
import { Connection, DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

type Connector = 'Thunderbolt' | 'USB_C' | 'Lightning'

interface IPadFamily {
  name: string
  connector: Connector
  video: boolean
}

interface ExpectedEdge {
  from: string
  to: string
  cable?: PortType
  label: string
}

interface AuditCase {
  name: string
  family: IPadFamily
  archetype: string
  gadgets: Gadget[]
  expected: ExpectedEdge[]
  outletCount: number
}

interface CaseResult {
  name: string
  family: string
  archetype: string
  connections: number
  warnings: number
  issues: string[]
}

const families: IPadFamily[] = [
  { name: 'iPad Pro 13-inch (M5)', connector: 'Thunderbolt', video: true },
  { name: 'iPad Pro 11-inch (M4)', connector: 'Thunderbolt', video: true },
  { name: 'iPad Pro 12.9-inch (6th generation)', connector: 'Thunderbolt', video: true },
  { name: 'iPad Pro 11-inch (2nd generation)', connector: 'USB_C', video: true },
  { name: 'iPad Air 13-inch (M4)', connector: 'USB_C', video: true },
  { name: 'iPad Air (5th generation)', connector: 'USB_C', video: true },
  { name: 'iPad mini (A17 Pro)', connector: 'USB_C', video: true },
  { name: 'iPad mini (6th generation)', connector: 'USB_C', video: true },
  { name: 'iPad (A16)', connector: 'USB_C', video: true },
  { name: 'iPad (9th generation)', connector: 'Lightning', video: false },
]

let seq = 0
let gadgetSeq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `ipad-audit-port-${++seq}`,
  type,
  direction,
  count,
  ...extra,
})

const g = (
  caseId: string,
  name: string,
  category: GadgetCategory,
  ports: Port[],
  extra: Partial<Gadget> = {},
): Gadget => ({
  // 通し番号を入れる。名前だけだと日本語が '_' に潰れて ID が重なり（「USB充電器」と
  // 「USBオーディオインターフェース」が同じ USB_）、別の機材どうしの線が混ざっていた
  id: `${caseId}-${++gadgetSeq}-${name}`.replace(/[^a-zA-Z0-9_-]+/g, '_'),
  name,
  category,
  ports,
  createdAt: '2026-08-30T00:00:00.000Z',
  ...extra,
})

const acIn = () => p('Power', 'input', 1, { label: '給電 (コンセント)' })
const bt = () => p('Bluetooth', 'bidirectional')

function ipad(caseId: string, family: IPadFamily): Gadget {
  return g(caseId, family.name, 'Tablet', [
    p(family.connector, 'bidirectional', 1, {
      label: '充電・データ・映像',
      supportsVideo: family.video,
      supportsPowerDelivery: family.connector !== 'Lightning',
    }),
    bt(),
  ], { powerUsage: 'rechargeable' })
}

const charger = (caseId: string, connector: Connector) => g(caseId, 'USB充電器', 'Charger', [
  p(connector === 'Lightning' ? 'USB_A' : 'USB_C', 'output', 2),
  acIn(),
])

const strip = (caseId: string) => g(caseId, '電源タップ', 'PowerStrip', [
  p('Power', 'output', 6),
  p('Power', 'input', 1),
])

const bluetoothKeyboard = (caseId: string) => g(caseId, 'Bluetoothキーボード', 'Keyboard', [
  bt(),
  p('USB_C', 'input', 1, { label: '給電 (C)' }),
], { powerUsage: 'rechargeable' })

const bluetoothMouse = (caseId: string) => g(caseId, 'Bluetoothマウス', 'Mouse', [
  bt(),
  p('USB_C', 'input', 1, { label: '給電 (C)' }),
], { powerUsage: 'rechargeable' })

const monitor = (caseId: string, directUsbC: boolean) => g(caseId, directUsbC ? 'USB-C PDモニター' : 'HDMIモニター', 'Monitor', [
  ...(directUsbC ? [p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: '映像 / PD 90W' })] : []),
  p('HDMI', 'input', 1, { supportsVideo: true }),
  acIn(),
])

const dock = (caseId: string, connector: Connector) => g(caseId, connector === 'Lightning' ? 'Lightning Digital AVアダプタ' : 'USB-Cドック', 'Dock', [
  p(connector, 'input', 1, { supportsVideo: connector !== 'Lightning', supportsPowerDelivery: connector !== 'Lightning', label: 'Host' }),
  p('HDMI', 'output', 1, { supportsVideo: true }),
  p('USB_C', 'output', 2),
  p('USB_A', 'output', 3),
  p('Ethernet', 'input', 1),
  acIn(),
])

const edge = (from: Gadget, to: Gadget, label: string, cable?: PortType): ExpectedEdge => ({
  from: from.id,
  to: to.id,
  cable,
  label,
})

function buildCase(family: IPadFamily, archetypeIndex: number, familyIndex: number): AuditCase {
  const caseId = `f${familyIndex + 1}-a${archetypeIndex + 1}`
  const pad = ipad(caseId, family)
  const power = charger(caseId, family.connector)
  const powerStrip = strip(caseId)

  switch (archetypeIndex) {
    case 0:
      return {
        name: `${family.name} / 充電のみ`, family, archetype: '充電のみ', outletCount: 1,
        gadgets: [pad, power], expected: [edge(power, pad, '充電器からiPadへ給電')],
      }
    case 1: {
      const keyboard = bluetoothKeyboard(caseId)
      const mouse = bluetoothMouse(caseId)
      return {
        name: `${family.name} / Bluetooth入力`, family, archetype: 'Bluetooth入力', outletCount: 2,
        gadgets: [pad, keyboard, mouse, power, powerStrip],
        expected: [
          edge(pad, keyboard, 'iPadがBluetoothキーボードをホスト', 'Bluetooth'),
          edge(pad, mouse, 'iPadがBluetoothマウスをホスト', 'Bluetooth'),
        ],
      }
    }
    case 2: {
      const hub = dock(caseId, family.connector)
      const keyboard = g(caseId, 'USBキーボード', 'Keyboard', [p('USB_A', 'input', 1, { label: '有線接続' })])
      const mouse = g(caseId, 'USBマウス', 'Mouse', [p('USB_A', 'input', 1, { label: '有線接続' })])
      return {
        name: `${family.name} / 有線入力＋ハブ`, family, archetype: '有線入力＋ハブ', outletCount: 2,
        gadgets: [pad, hub, keyboard, mouse, powerStrip],
        expected: [
          edge(pad, hub, 'iPadがハブの上流ホスト'),
          edge(hub, keyboard, 'ハブからUSBキーボード'),
          edge(hub, mouse, 'ハブからUSBマウス'),
        ],
      }
    }
    case 3: {
      const display = monitor(caseId, family.connector !== 'Lightning')
      if (family.connector === 'Lightning') {
        const adapter = dock(caseId, family.connector)
        return {
          name: `${family.name} / 外部ディスプレイ`, family, archetype: '外部ディスプレイ', outletCount: 2,
          gadgets: [pad, adapter, display, powerStrip],
          expected: [edge(pad, adapter, 'iPadから映像アダプタ'), edge(adapter, display, 'アダプタからHDMI表示', 'HDMI')],
        }
      }
      return {
        name: `${family.name} / 外部ディスプレイ`, family, archetype: '外部ディスプレイ', outletCount: 2,
        gadgets: [pad, display, powerStrip], expected: [edge(pad, display, 'iPadからUSB-C映像')],
      }
    }
    case 4: {
      const hub = dock(caseId, family.connector)
      const display = monitor(caseId, false)
      return {
        name: `${family.name} / HDMIドック`, family, archetype: 'HDMIドック', outletCount: 2,
        gadgets: [pad, hub, display, powerStrip],
        expected: [edge(pad, hub, 'iPadがドックの上流ホスト'), edge(hub, display, 'ドックからHDMI表示', 'HDMI')],
      }
    }
    case 5: {
      const hub = dock(caseId, family.connector)
      const storage = g(caseId, '外付けSSD', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続 / バスパワー' })])
      const router = g(caseId, 'Wi-Fiルーター', 'Router', [p('Ethernet', 'output', 4), p('WiFi', 'bidirectional'), acIn()])
      return {
        name: `${family.name} / ドック＋SSD＋Ethernet`, family, archetype: 'ドック＋SSD＋Ethernet', outletCount: 2,
        gadgets: [pad, hub, storage, router, powerStrip],
        expected: [
          edge(pad, hub, 'iPadがドックの上流ホスト'),
          edge(hub, storage, 'ドックから外付けSSD'),
          edge(router, hub, 'ルーターからドックへEthernet', 'Ethernet'),
        ],
      }
    }
    case 6: {
      const audio = g(caseId, 'USBオーディオインターフェース', 'AudioInterface', [
        p('USB_C', 'input', 1, { label: 'PC接続 / バスパワー' }),
        p('XLR', 'input', 1),
        p('Audio6_3mm', 'output', 2, { label: 'Monitor Out' }),
      ])
      const microphone = g(caseId, 'XLRマイク', 'Microphone', [p('XLR', 'output', 1)])
      const speaker = g(caseId, 'モニタースピーカー', 'Speaker', [p('Audio6_3mm', 'input', 1), acIn()])
      // Lightning の iPad はケーブル1本では USB 機器のホストになれない。実機と同じくカメラアダプタを挟む
      // （外部ディスプレイで映像アダプタを挟むのと同じ扱い）。以前は ID の重なりで偶然通っていた
      if (family.connector === 'Lightning') {
        const adapter = g(caseId, 'Lightning - USB 3カメラアダプタ', 'Dock', [
          p('Lightning', 'input', 1, { label: 'Host' }),
          p('USB_A', 'output', 1),
        ])
        return {
          name: `${family.name} / 音楽制作`, family, archetype: '音楽制作', outletCount: 2,
          gadgets: [pad, adapter, audio, microphone, speaker, power, powerStrip],
          expected: [
            edge(pad, adapter, 'iPadからカメラアダプタ'),
            edge(adapter, audio, 'カメラアダプタからUSBオーディオIF'),
            edge(microphone, audio, 'マイクからオーディオIF', 'XLR'),
            edge(audio, speaker, 'オーディオIFからスピーカー', 'Audio6_3mm'),
          ],
        }
      }
      return {
        name: `${family.name} / 音楽制作`, family, archetype: '音楽制作', outletCount: 2,
        gadgets: [pad, audio, microphone, speaker, power, powerStrip],
        expected: [
          edge(pad, audio, 'iPadからUSBオーディオIF'),
          edge(microphone, audio, 'マイクからオーディオIF', 'XLR'),
          edge(audio, speaker, 'オーディオIFからスピーカー', 'Audio6_3mm'),
        ],
      }
    }
    case 7: {
      const hub = dock(caseId, family.connector)
      const reader = g(caseId, 'SDカードリーダー', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続 / バスパワー' }), p('SDCard', 'input', 1)])
      const storage = g(caseId, '写真バックアップSSD', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続 / バスパワー' })])
      return {
        name: `${family.name} / 写真取込＋保存`, family, archetype: '写真取込＋保存', outletCount: 2,
        gadgets: [pad, hub, reader, storage, powerStrip],
        expected: [edge(pad, hub, 'iPadがハブの上流ホスト'), edge(hub, reader, 'ハブからカードリーダー'), edge(hub, storage, 'ハブからSSD')],
      }
    }
    case 8: {
      const mac = g(caseId, 'MacBook', 'PC', [
        p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true, supportsPowerDelivery: true }),
      ], { pcFormFactor: 'laptop', pcOs: 'macOS' })
      return {
        name: `${family.name} / Macのサブディスプレイ`, family, archetype: 'Macのサブディスプレイ', outletCount: 2,
        // Mac は PD の USB-C 充電器で給電する。Lightning の系統の USB-A 充電器を渡すと、
        // ノートPCを充電できないという正しい警告が「不成立」に数えられていた
        gadgets: [mac, pad, charger(caseId, 'USB_C')], expected: [edge(mac, pad, 'MacからiPadへSidecar相当の接続')],
      }
    }
    default: {
      const battery = g(caseId, 'モバイルバッテリー', 'MobileBattery', [
        p(family.connector === 'Lightning' ? 'USB_A' : 'USB_C', 'output', 2),
      ])
      const earbuds = g(caseId, 'Bluetoothイヤホン', 'Earphone', [bt(), p('USB_C', 'input', 1, { label: '給電 (C)' })], { powerUsage: 'rechargeable' })
      return {
        name: `${family.name} / モバイル運用`, family, archetype: 'モバイル運用', outletCount: 0,
        gadgets: [pad, battery, earbuds],
        expected: [edge(battery, pad, 'モバイルバッテリーからiPadへ給電'), edge(pad, earbuds, 'iPadからBluetoothイヤホン', 'Bluetooth')],
      }
    }
  }
}

const cases: AuditCase[] = families.flatMap((family, familyIndex) =>
  Array.from({ length: 10 }, (_, archetypeIndex) => buildCase(family, archetypeIndex, familyIndex)),
)

const planFor = (scenario: AuditCase): DeskPlan => ({
  id: `plan-${scenario.name}`,
  name: scenario.name,
  goal: 'clean_wiring',
  selectedGadgetIds: scenario.gadgets.map((item) => item.id),
  placements: [],
  outletCount: scenario.outletCount,
  outletCountVersion: 2,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
})

const matchesEdge = (connection: Connection, expected: ExpectedEdge) =>
  connection.fromGadgetId === expected.from &&
  connection.toGadgetId === expected.to &&
  (!expected.cable || connection.cableType === expected.cable)

function inspect(scenario: AuditCase): CaseResult {
  const result = generateWiring(scenario.gadgets, planFor(scenario), 'ja')
  const issues: string[] = []

  for (const expected of scenario.expected) {
    if (!result.connections.some((connection) => matchesEdge(connection, expected))) {
      issues.push(`missing:${expected.label}`)
    }
  }

  if (result.connections.some((connection) => connection.fromGadgetId === 'failed' || connection.fromGadgetId === 'failed-power')) {
    issues.push('failed-sentinel')
  }

  const pad = scenario.gadgets.find((item) => item.category === 'Tablet')!
  const physicalPadConnections = result.connections.filter((connection) =>
    (connection.fromGadgetId === pad.id || connection.toGadgetId === pad.id) &&
    !['Bluetooth', 'WiFi', 'wirelessCharging', 'Stylus'].includes(connection.cableType),
  )
  const duplicatePairs = new Set<string>()
  for (const connection of physicalPadConnections) {
    const other = connection.fromGadgetId === pad.id ? connection.toGadgetId : connection.fromGadgetId
    if (physicalPadConnections.filter((candidate) =>
      (candidate.fromGadgetId === pad.id && candidate.toGadgetId === other) ||
      (candidate.toGadgetId === pad.id && candidate.fromGadgetId === other),
    ).length > 1) duplicatePairs.add(other)
  }
  if (duplicatePairs.size > 0) issues.push('duplicate-physical-link-to-iPad')

  if (process.env.AUDIT_DUMP && scenario.name.includes(process.env.AUDIT_DUMP)) {
    const nameOf = (id: string) => scenario.gadgets.find((item) => item.id === id)?.name ?? id
    console.log(`DUMP ${scenario.name}`)
    for (const connection of result.connections) {
      console.log(`  ${nameOf(connection.fromGadgetId)} [${connection.fromPortType}] -> ${nameOf(connection.toGadgetId)} [${connection.toPortType}] ${connection.cableType}${connection.chargingOnly ? ' chargingOnly' : ''}`)
    }
    for (const warning of result.warnings) console.log(`  ! ${warning}`)
  }

  return {
    name: scenario.name,
    family: scenario.family.name,
    archetype: scenario.archetype,
    connections: result.connections.length,
    warnings: result.warnings.length,
    issues,
  }
}

const results = cases.map(inspect)
const passed = results.filter((result) => result.issues.length === 0)
const failed = results.filter((result) => result.issues.length > 0)
const byArchetype = new Map<string, { total: number; passed: number }>()
const byIssue = new Map<string, number>()

for (const result of results) {
  const aggregate = byArchetype.get(result.archetype) ?? { total: 0, passed: 0 }
  aggregate.total++
  if (result.issues.length === 0) aggregate.passed++
  byArchetype.set(result.archetype, aggregate)
  for (const issue of result.issues) byIssue.set(issue, (byIssue.get(issue) ?? 0) + 1)
}

console.log('iPad環境監査（10機種系統 × 10用途）')
console.log(`ケース: ${results.length} / 成立: ${passed.length} / 不成立: ${failed.length}`)
console.log('')
for (const [archetype, aggregate] of byArchetype) {
  console.log(`${archetype}: ${aggregate.passed}/${aggregate.total}`)
}
console.log('')
console.log('問題内訳')
for (const [issue, count] of [...byIssue.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count}: ${issue}`)
}

if (process.env.AUDIT_VERBOSE) {
  console.log('')
  for (const result of failed) console.log(`NG ${result.name}: ${result.issues.join(', ')}`)
}

process.exit(failed.length > 0 ? 1 : 0)
