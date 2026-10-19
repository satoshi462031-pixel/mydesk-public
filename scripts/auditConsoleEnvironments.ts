/**
 * Nintendo Switch / Switch 2、PlayStation 5、Xbox Series X / Sを中心にした各100ケースを監査する。
 *
 * 実行:
 *   npx tsx scripts/auditConsoleEnvironments.ts
 *   $env:AUDIT_VERBOSE='1'; npx tsx scripts/auditConsoleEnvironments.ts
 */
import { CONTROLLER_PRESETS, GADGET_PRESETS, HEADPHONE_PRESETS, VR_GLASS_PRESETS } from '../src/constants/gadgetPresets'
import { Connection, DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { generateWiring } from '../src/utils/wiringEngine'

interface ExpectedEdge {
  from: string
  to: string
  cable?: PortType | 'USB_A_to_C'
  kind: 'signal' | 'power'
  label: string
}

interface AuditCase {
  platform: 'Nintendo Switch / Switch 2' | 'PS5' | 'Xbox Series X / S'
  generation: 'Switch' | 'Switch 2' | 'PS5' | 'Xbox Series X' | 'Xbox Series S'
  family: string
  archetype: string
  name: string
  gadgets: Gadget[]
  expected: ExpectedEdge[]
  wiredOverrides?: string[]
}

interface CaseResult {
  platform: AuditCase['platform']
  generation: AuditCase['generation']
  family: string
  archetype: string
  name: string
  connections: number
  warnings: number
  issues: string[]
}

let seq = 0
let gadgetSeq = 0
const createdAt = '2026-08-30T00:00:00.000Z'
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port => ({
  id: `console-audit-port-${++seq}`,
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
  id: `${caseId}-g${++gadgetSeq}`,
  name,
  category,
  ports,
  createdAt,
  ...extra,
})
const edge = (
  from: Gadget | string,
  to: Gadget | string,
  label: string,
  cable?: ExpectedEdge['cable'],
  kind: ExpectedEdge['kind'] = (from === 'wall' || cable === 'Power') ? 'power' : 'signal',
): ExpectedEdge => ({
  from: typeof from === 'string' ? from : from.id,
  to: typeof to === 'string' ? to : to.id,
  cable,
  kind,
  label,
})
const acIn = () => p('Power', 'input', 1, { label: '給電 (コンセント)' })
const bt = () => p('Bluetooth', 'bidirectional')

const display = (caseId: string, name: string, category: 'Monitor' | 'TV' | 'Projector', extraPorts: Port[] = []) =>
  g(caseId, name, category, [p('HDMI', 'input', 1, { supportsVideo: true }), ...extraPorts, acIn()])
const router = (caseId: string) => g(caseId, 'ルーター', 'Router', [
  p('Ethernet', 'output', 4),
  p('WiFi', 'bidirectional'),
  acIn(),
])
const pc = (caseId: string) => g(caseId, '配信用PC', 'PC', [
  p('DisplayPort', 'output', 2, { supportsVideo: true }),
  p('HDMI', 'output', 1, { supportsVideo: true }),
  p('USB_C', 'output', 2),
  p('USB_A', 'output', 4),
  acIn(),
], { pcFormFactor: 'desktop', pcOs: 'Windows' })
const capture = (caseId: string) => g(caseId, 'HDMIキャプチャーボード', 'CaptureDevice', [
  p('HDMI', 'input', 1, { supportsVideo: true }),
  p('HDMI', 'output', 1, { supportsVideo: true }),
  p('USB_C', 'input', 1, { label: 'USB-C (PC接続)' }),
])
const hdmiSwitch = (caseId: string) => g(caseId, 'HDMI切替器', 'KVM', [
  p('HDMI', 'input', 2, { supportsVideo: true }),
  p('HDMI', 'output', 1, { supportsVideo: true }),
  acIn(),
])

const switchConsole = (caseId: string) => g(caseId, 'Nintendo Switch 2', 'GameConsole', [
  p('USB_C', 'bidirectional', 1, { supportsVideo: true, label: 'USB-C (下部・Dock接続)' }),
  p('USB_C', 'bidirectional', 1, { label: 'USB-C (上部・周辺機器・充電)' }),
  p('Audio3_5mm', 'output', 1, { label: 'ヘッドホンマイク' }),
  bt(),
], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' })

const switchDock = (caseId: string) => g(caseId, 'Nintendo Switch 2 Dock', 'Dock', [
  p('HDMI', 'output', 1, { supportsVideo: true, label: 'HDMI' }),
  p('USB_A', 'output', 2, { label: 'USB-A (USB 2.0)' }),
  p('USB_C', 'input', 1, { label: 'USB-C (本体接続)' }),
  p('Ethernet', 'input', 1, { label: '有線LAN' }),
  acIn(),
])

const originalSwitchConsole = (caseId: string) => g(caseId, 'Nintendo Switch 本体', 'GameConsole', [
  p('USB_C', 'bidirectional', 1, { supportsVideo: true, label: 'USB-C (下部・Dock接続・充電)' }),
  p('Audio3_5mm', 'output', 1, { label: 'ヘッドホンマイク' }),
  bt(),
], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' })

const originalSwitchDock = (caseId: string, oled: boolean) => g(
  caseId,
  oled ? 'Nintendo Switch OLED Dock' : 'Nintendo Switch Dock',
  'Dock',
  [
    p('HDMI', 'output', 1, { supportsVideo: true, label: 'HDMI' }),
    p('USB_A', 'output', oled ? 2 : 3, { label: 'USB-A (USB 2.0)' }),
    p('USB_C', 'input', 1, { label: 'USB-C (本体接続)' }),
    ...(oled ? [p('Ethernet', 'input', 1, { label: '有線LAN' })] : []),
    acIn(),
  ],
)

interface SwitchDisplayProfile {
  name: string
  generation: 'Switch' | 'Switch 2'
  build: (caseId: string) => { gadgets: Gadget[]; expected: ExpectedEdge[]; dock: Gadget; console: Gadget }
}

const standardSwitchProfile = (
  name: string,
  screenName: string,
  category: 'Monitor' | 'TV' | 'Projector',
  extraPorts: (caseId: string) => Port[] = () => [],
): SwitchDisplayProfile => ({
  name,
  generation: 'Switch 2',
  build: (caseId) => {
    const console = switchConsole(caseId)
    const dock = switchDock(caseId)
    const screen = display(caseId, screenName, category, extraPorts(caseId))
    return {
      console,
      dock,
      gadgets: [console, dock, screen],
      expected: [
        edge(console, dock, '本体からドック'),
        edge(dock, screen, 'ドックから画面', 'HDMI'),
        edge('wall', dock, 'ドックへ給電', 'Power'),
      ],
    }
  },
})

const switchProfiles: SwitchDisplayProfile[] = [
  standardSwitchProfile('4K60テレビ', '4K60テレビ', 'TV'),
  standardSwitchProfile('HDRテレビ', 'HDRテレビ', 'TV'),
  standardSwitchProfile('1440p120モニター', '1440p120モニター', 'Monitor'),
  standardSwitchProfile('1080p120モニター', '1080p120モニター', 'Monitor'),
  standardSwitchProfile('4K60モニター', '4K60モニター', 'Monitor'),
  standardSwitchProfile('1080pプロジェクター', '1080pプロジェクター', 'Projector'),
  {
    name: 'PC共有モニター',
    generation: 'Switch 2',
    build: (caseId) => {
      const console = switchConsole(caseId)
      const dock = switchDock(caseId)
      const computer = pc(caseId)
      const screen = display(caseId, 'PC共有モニター', 'Monitor', [p('DisplayPort', 'input', 1, { supportsVideo: true })])
      return {
        console,
        dock,
        gadgets: [console, dock, computer, screen],
        expected: [
          edge(console, dock, '本体からドック'),
          edge(computer, screen, 'PCから共有画面', 'DisplayPort'),
          edge(dock, screen, 'ドックから共有画面', 'HDMI'),
          edge('wall', dock, 'ドックへ給電', 'Power'),
        ],
      }
    },
  },
  {
    name: 'HDMI切替器共有',
    generation: 'Switch 2',
    build: (caseId) => {
      const console = switchConsole(caseId)
      const dock = switchDock(caseId)
      const computer = pc(caseId)
      const selector = hdmiSwitch(caseId)
      const screen = display(caseId, '共有モニター', 'Monitor')
      return {
        console,
        dock,
        gadgets: [console, dock, computer, selector, screen],
        expected: [
          edge(console, dock, '本体からドック'),
          edge(computer, selector, 'PCからHDMI切替器', 'HDMI'),
          edge(dock, selector, 'ドックからHDMI切替器', 'HDMI'),
          edge(selector, screen, 'HDMI切替器から画面', 'HDMI'),
          edge('wall', dock, 'ドックへ給電', 'Power'),
        ],
      }
    },
  },
  {
    name: 'キャプチャーパススルー',
    generation: 'Switch 2',
    build: (caseId) => {
      const console = switchConsole(caseId)
      const dock = switchDock(caseId)
      const computer = pc(caseId)
      const recorder = capture(caseId)
      const screen = display(caseId, '配信用モニター', 'Monitor')
      return {
        console,
        dock,
        gadgets: [console, dock, recorder, computer, screen],
        expected: [
          edge(console, dock, '本体からドック'),
          edge(dock, recorder, 'ドックからキャプチャー', 'HDMI'),
          edge(recorder, screen, 'キャプチャーから画面', 'HDMI'),
          edge(computer, recorder, 'キャプチャーをPCへ接続'),
          edge('wall', dock, 'ドックへ給電', 'Power'),
        ],
      }
    },
  },
  standardSwitchProfile('リビングTV', 'リビングTV', 'TV'),
]

const originalSwitchProfile = (
  name: string,
  screenName: string,
  category: 'Monitor' | 'TV',
  oled: boolean,
): SwitchDisplayProfile => ({
  name,
  generation: 'Switch',
  build: (caseId) => {
    const console = originalSwitchConsole(caseId)
    const dock = originalSwitchDock(caseId, oled)
    const screen = display(caseId, screenName, category)
    return {
      console,
      dock,
      gadgets: [console, dock, screen],
      expected: [
        edge(console, dock, '本体からドック'),
        edge(dock, screen, 'ドックから画面', 'HDMI'),
        edge('wall', dock, 'ドックへ給電', 'Power'),
      ],
    }
  },
})

const originalSwitchProfiles: SwitchDisplayProfile[] = [
  originalSwitchProfile('Switch通常Dock / TV', '1080pテレビ', 'TV', false),
  originalSwitchProfile('Switch通常Dock / モニター', '1080pモニター', 'Monitor', false),
  originalSwitchProfile('Switch OLED Dock / TV', '1080pテレビ', 'TV', true),
  {
    name: 'Switch OLED Dock / PC共有モニター',
    generation: 'Switch',
    build: (caseId) => {
      const console = originalSwitchConsole(caseId)
      const dock = originalSwitchDock(caseId, true)
      const computer = pc(caseId)
      const screen = display(caseId, 'PC共有モニター', 'Monitor', [p('DisplayPort', 'input', 1, { supportsVideo: true })])
      return {
        console,
        dock,
        gadgets: [console, dock, computer, screen],
        expected: [
          edge(console, dock, '本体からドック'),
          edge(computer, screen, 'PCから共有画面', 'DisplayPort'),
          edge(dock, screen, 'ドックから共有画面', 'HDMI'),
          edge('wall', dock, 'ドックへ給電', 'Power'),
        ],
      }
    },
  },
  {
    name: 'Switch OLED Dock / キャプチャー',
    generation: 'Switch',
    build: (caseId) => {
      const console = originalSwitchConsole(caseId)
      const dock = originalSwitchDock(caseId, true)
      const computer = pc(caseId)
      const recorder = capture(caseId)
      const screen = display(caseId, '配信用モニター', 'Monitor')
      return {
        console,
        dock,
        gadgets: [console, dock, recorder, computer, screen],
        expected: [
          edge(console, dock, '本体からドック'),
          edge(dock, recorder, 'ドックからキャプチャー', 'HDMI'),
          edge(recorder, screen, 'キャプチャーから画面', 'HDMI'),
          edge(computer, recorder, 'キャプチャーをPCへ接続'),
          edge('wall', dock, 'ドックへ給電', 'Power'),
        ],
      }
    },
  },
]

const nintendoProfiles: SwitchDisplayProfile[] = [
  ...originalSwitchProfiles,
  switchProfiles[0],
  switchProfiles[2],
  switchProfiles[6],
  switchProfiles[7],
  switchProfiles[8],
]

const switch2Archetypes = [
  '基本TVモード',
  '有線LAN',
  'Joy-Con 2無線',
  'Proコントローラー無線＋充電',
  'Proコントローラー有線',
  'カメラ本体直結',
  'カメラDock接続',
  'USBマイク',
  '3.5mmヘッドセット',
  'USBヘッドセット',
] as const

const originalSwitchArchetypes = [
  '基本TVモード',
  '有線LAN',
  'Joy-Con無線',
  'Proコントローラー無線＋充電',
  'Proコントローラー有線',
  'USBマイク',
  'USBワイヤレスマイク',
  '3.5mmヘッドセット',
  'USBヘッドセット',
  '複数コントローラー',
] as const

function buildSwitchCase(profile: SwitchDisplayProfile, profileIndex: number, archetypeIndex: number): AuditCase {
  const isOriginal = profile.generation === 'Switch'
  const caseId = `nintendo-f${profileIndex + 1}-a${archetypeIndex + 1}`
  const built = profile.build(caseId)
  const gadgets = [...built.gadgets]
  const expected = [...built.expected]
  const wiredOverrides: string[] = []

  if (isOriginal) {
    switch (archetypeIndex) {
      case 1: {
        const network = router(caseId)
        gadgets.push(network)
        if (built.dock.ports.some((port) => port.type === 'Ethernet')) {
          expected.push(edge(network, built.dock, 'ルーターからOLED Dockへ有線LAN', 'Ethernet'))
        } else {
          const adapter = g(caseId, 'USB有線LANアダプター', 'Accessory', [
            p('USB_A', 'input', 1, { label: 'USB有線接続' }),
            p('Ethernet', 'input', 1, { label: 'LAN' }),
          ], { bluetoothTargetGadgetIds: [built.dock.id] })
          gadgets.push(adapter)
          expected.push(edge(built.dock, adapter, '通常DockからLANアダプターへUSB接続', 'USB_A'))
          expected.push(edge(network, adapter, 'ルーターからLANアダプター', 'Ethernet'))
        }
        break
      }
      case 2: {
        const joyCon = g(caseId, 'Nintendo Switch Joy-Con (L)/(R)', 'Controller', [bt()])
        gadgets.push(joyCon)
        expected.push(edge(built.console, joyCon, 'Joy-Conを無線接続', 'Bluetooth'))
        break
      }
      case 3: {
        const controller = g(caseId, 'Nintendo Switch Proコントローラー', 'Controller', [
          bt(),
          p('USB_C', 'input', 1, { label: '充電・有線通信' }),
        ], { powerUsage: 'rechargeable', bluetoothTargetGadgetIds: [built.console.id], powerSourceGadgetId: built.dock.id })
        gadgets.push(controller)
        expected.push(edge(built.console, controller, 'Proコントローラーを無線接続', 'Bluetooth'))
        expected.push(edge(built.dock, controller, 'ProコントローラーをDockから充電', 'USB_A_to_C', 'power'))
        break
      }
      case 4: {
        const controller = g(caseId, 'Nintendo Switch Proコントローラー（有線）', 'Controller', [
          bt(),
          p('USB_C', 'input', 1, { label: '有線接続' }),
        ], { powerUsage: 'rechargeable', bluetoothTargetGadgetIds: [built.dock.id] })
        gadgets.push(controller)
        wiredOverrides.push(controller.id)
        expected.push(edge(built.dock, controller, 'Proコントローラーを有線接続', 'USB_A_to_C'))
        break
      }
      case 5: {
        const microphone = g(caseId, 'ニンテンドーUSBマイク', 'Microphone', [
          p('USB_A', 'input', 1, { label: 'USB接続' }),
        ], { bluetoothTargetGadgetIds: [built.dock.id] })
        gadgets.push(microphone)
        expected.push(edge(built.dock, microphone, 'USBマイクをDockへ接続', 'USB_A'))
        break
      }
      case 6: {
        const microphone = g(caseId, 'ニンテンドーUSBワイヤレスマイク', 'Microphone', [
          p('USB_A', 'input', 1, { label: 'USBドングル', directAttach: true }),
        ], { bluetoothTargetGadgetIds: [built.dock.id] })
        gadgets.push(microphone)
        expected.push(edge(built.dock, microphone, 'ワイヤレスマイク受信機をDockへ接続', 'USB_A'))
        break
      }
      case 7: {
        const headset = g(caseId, '有線ヘッドセット', 'Headphone', [
          p('Audio3_5mm', 'input', 1, { label: '4極ヘッドセット' }),
        ], { bluetoothTargetGadgetIds: [built.console.id] })
        gadgets.push(headset)
        expected.push(edge(built.console, headset, 'ヘッドセットを本体へ接続', 'Audio3_5mm'))
        break
      }
      case 8: {
        const headset = g(caseId, 'USBワイヤレスヘッドセット', 'Headphone', [
          p('USB_A', 'input', 1, { label: 'USBドングル', directAttach: true }),
        ], { bluetoothTargetGadgetIds: [built.dock.id] })
        gadgets.push(headset)
        expected.push(edge(built.dock, headset, 'USBヘッドセットをDockへ接続', 'USB_A'))
        break
      }
      case 9: {
        const first = g(caseId, 'Joy-Conペア1', 'Controller', [bt()])
        const second = g(caseId, 'Joy-Conペア2', 'Controller', [bt()])
        gadgets.push(first, second)
        expected.push(edge(built.console, first, 'Joy-Conペア1を無線接続', 'Bluetooth'))
        expected.push(edge(built.console, second, 'Joy-Conペア2を無線接続', 'Bluetooth'))
        break
      }
    }

    const archetype = originalSwitchArchetypes[archetypeIndex]
    return {
      platform: 'Nintendo Switch / Switch 2',
      generation: 'Switch',
      family: profile.name,
      archetype,
      name: `${profile.name} / ${archetype}`,
      gadgets,
      expected,
      wiredOverrides,
    }
  }

  switch (archetypeIndex) {
    case 1: {
      const network = router(caseId)
      gadgets.push(network)
      expected.push(edge(network, built.dock, 'ルーターからDockへ有線LAN', 'Ethernet'))
      break
    }
    case 2: {
      const joyCon = g(caseId, 'Nintendo Switch 2 Joy-Con (L)/(R)', 'Controller', [bt()])
      gadgets.push(joyCon)
      expected.push(edge(built.console, joyCon, 'Joy-Con 2を無線接続', 'Bluetooth'))
      break
    }
    case 3: {
      const controller = g(caseId, 'Nintendo Switch 2 Proコントローラー', 'Controller', [
        bt(),
        p('USB_C', 'input', 1, { label: '充電・有線通信' }),
      ], { powerUsage: 'rechargeable', bluetoothTargetGadgetIds: [built.console.id], powerSourceGadgetId: built.dock.id })
      gadgets.push(controller)
      expected.push(edge(built.console, controller, 'Proコントローラーを無線接続', 'Bluetooth'))
      expected.push(edge(built.dock, controller, 'ProコントローラーをDockから充電', 'USB_A_to_C', 'power'))
      break
    }
    case 4: {
      const controller = g(caseId, 'Nintendo Switch 2 Proコントローラー（有線）', 'Controller', [
        bt(),
        p('USB_C', 'input', 1, { label: '有線接続' }),
      ], { powerUsage: 'rechargeable', bluetoothTargetGadgetIds: [built.dock.id] })
      gadgets.push(controller)
      wiredOverrides.push(controller.id)
      expected.push(edge(built.dock, controller, 'Proコントローラーを有線接続', 'USB_A_to_C'))
      break
    }
    case 5: {
      const camera = g(caseId, 'Nintendo Switch 2 カメラ（本体直結）', 'Webcam', [
        p('USB_C', 'input', 1, { label: '本体接続' }),
      ], { bluetoothTargetGadgetIds: [built.console.id] })
      gadgets.push(camera)
      expected.push(edge(built.console, camera, 'カメラを本体上部USB-Cへ接続', 'USB_C'))
      break
    }
    case 6: {
      const camera = g(caseId, 'Nintendo Switch 2 カメラ（Dock接続）', 'Webcam', [
        p('USB_C', 'input', 1, { label: '本体接続' }),
      ], { bluetoothTargetGadgetIds: [built.dock.id] })
      gadgets.push(camera)
      expected.push(edge(built.dock, camera, 'カメラをDockへ接続', 'USB_A_to_C'))
      break
    }
    case 7: {
      const microphone = g(caseId, 'Nintendo USBマイク', 'Microphone', [
        p('USB_A', 'input', 1, { label: 'USB接続' }),
      ], { bluetoothTargetGadgetIds: [built.dock.id] })
      gadgets.push(microphone)
      expected.push(edge(built.dock, microphone, 'USBマイクをDockへ接続', 'USB_A'))
      break
    }
    case 8: {
      const headset = g(caseId, '有線ヘッドセット', 'Headphone', [
        p('Audio3_5mm', 'input', 1, { label: '4極ヘッドセット' }),
      ], { bluetoothTargetGadgetIds: [built.console.id] })
      gadgets.push(headset)
      expected.push(edge(built.console, headset, 'ヘッドセットを本体へ接続', 'Audio3_5mm'))
      break
    }
    case 9: {
      const headset = g(caseId, 'USBワイヤレスヘッドセット', 'Headphone', [
        p('USB_A', 'input', 1, { label: 'USBドングル', directAttach: true }),
      ], { bluetoothTargetGadgetIds: [built.dock.id] })
      gadgets.push(headset)
      expected.push(edge(built.dock, headset, 'USBヘッドセットをDockへ接続', 'USB_A'))
      break
    }
  }

  return {
    platform: 'Nintendo Switch / Switch 2',
    generation: 'Switch 2',
    family: profile.name,
    archetype: switch2Archetypes[archetypeIndex],
    name: `${profile.name} / ${switch2Archetypes[archetypeIndex]}`,
    gadgets,
    expected,
    wiredOverrides,
  }
}

interface PS5Family {
  name: string
  usbA: number
  usbC: number
}

const ps5Families: PS5Family[] = [
  { name: 'PS5 CFI-1000 ディスク / TV', usbA: 3, usbC: 1 },
  { name: 'PS5 CFI-1000 ディスク / モニター', usbA: 3, usbC: 1 },
  { name: 'PS5 CFI-1000 Digital / TV', usbA: 3, usbC: 1 },
  { name: 'PS5 CFI-1000 Digital / モニター', usbA: 3, usbC: 1 },
  { name: 'PS5 CFI-2000 Slim ディスク / TV', usbA: 2, usbC: 2 },
  { name: 'PS5 CFI-2000 Slim ディスク / モニター', usbA: 2, usbC: 2 },
  { name: 'PS5 CFI-2000 Slim Digital / TV', usbA: 2, usbC: 2 },
  { name: 'PS5 CFI-2000 Slim Digital / モニター', usbA: 2, usbC: 2 },
  { name: 'PS5 Pro CFI-7000 / TV', usbA: 2, usbC: 2 },
  { name: 'PS5 Pro CFI-7000 / モニター', usbA: 2, usbC: 2 },
]

const ps5Console = (caseId: string, family: PS5Family) => g(caseId, family.name.split(' / ')[0], 'GameConsole', [
  p('USB_C', 'output', family.usbC, { label: 'USB-C' }),
  p('USB_A', 'output', family.usbA, { label: 'USB-A' }),
  p('HDMI', 'output', 1, { supportsVideo: true, label: 'HDMI OUT' }),
  p('Ethernet', 'input', 1, { label: 'LAN' }),
  acIn(),
], { consoleFormFactor: 'stationary' })

const ps5Archetypes = [
  '基本HDMI',
  '有線LAN',
  'DualSense無線＋充電',
  'DualSense有線',
  'USBワイヤレスヘッドセット',
  'DualSenseへ3.5mmヘッドセット',
  'HDカメラ',
  'USB拡張ストレージ',
  'PlayStation VR2',
  'キャプチャー配信',
] as const

function buildPs5Case(family: PS5Family, familyIndex: number, archetypeIndex: number): AuditCase {
  const caseId = `ps5-f${familyIndex + 1}-a${archetypeIndex + 1}`
  const console = ps5Console(caseId, family)
  const screen = display(caseId, family.name.endsWith('/ TV') ? '4Kテレビ' : 'ゲーミングモニター', family.name.endsWith('/ TV') ? 'TV' : 'Monitor')
  const gadgets: Gadget[] = [console, screen]
  const expected: ExpectedEdge[] = [
    edge(console, screen, 'PS5から画面', 'HDMI'),
    edge('wall', console, 'PS5へ給電', 'Power'),
  ]
  const wiredOverrides: string[] = []

  switch (archetypeIndex) {
    case 1: {
      const network = router(caseId)
      gadgets.push(network)
      expected.push(edge(network, console, 'ルーターからPS5へ有線LAN', 'Ethernet'))
      break
    }
    case 2: {
      const controller = g(caseId, 'DualSense', 'Controller', [
        bt(),
        p('USB_C', 'input', 1, { label: '充電・有線通信' }),
        p('Audio3_5mm', 'output', 1, { label: 'ヘッドセット' }),
      ], { powerUsage: 'rechargeable', bluetoothTargetGadgetIds: [console.id], powerSourceGadgetId: console.id })
      gadgets.push(controller)
      expected.push(edge(console, controller, 'DualSenseを無線接続', 'Bluetooth'))
      expected.push(edge(console, controller, 'DualSenseをPS5から充電', undefined, 'power'))
      break
    }
    case 3: {
      const controller = g(caseId, 'DualSense（有線）', 'Controller', [
        bt(),
        p('USB_C', 'input', 1, { label: '有線接続' }),
        p('Audio3_5mm', 'output', 1, { label: 'ヘッドセット' }),
      ], { powerUsage: 'rechargeable', bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(controller)
      wiredOverrides.push(controller.id)
      expected.push(edge(console, controller, 'DualSenseを有線接続'))
      break
    }
    case 4: {
      const headset = g(caseId, 'PULSE Elite ワイヤレスヘッドセット', 'Headphone', [
        p('USB_A', 'input', 1, { label: 'PlayStation Link USBアダプター', directAttach: true }),
        p('USB_C', 'input', 1, { label: '充電' }),
      ], { powerUsage: 'rechargeable', bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(headset)
      expected.push(edge(console, headset, 'PS LinkアダプターをPS5へ接続', 'USB_A'))
      break
    }
    case 5: {
      const controller = g(caseId, 'DualSense', 'Controller', [
        bt(),
        p('USB_C', 'input', 1, { label: '充電' }),
        p('Audio3_5mm', 'output', 1, { label: 'ヘッドセット' }),
      ], { bluetoothTargetGadgetIds: [console.id] })
      const headset = g(caseId, '3.5mmヘッドセット', 'Headphone', [
        p('Audio3_5mm', 'input', 1, { label: '4極ヘッドセット' }),
      ], { bluetoothTargetGadgetIds: [controller.id] })
      gadgets.push(controller, headset)
      expected.push(edge(console, controller, 'DualSenseを無線接続', 'Bluetooth'))
      expected.push(edge(controller, headset, 'DualSenseへヘッドセット', 'Audio3_5mm'))
      break
    }
    case 6: {
      const camera = g(caseId, 'PS5 HDカメラ', 'Webcam', [
        p('USB_A', 'input', 1, { label: 'SuperSpeed USB接続' }),
      ], { bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(camera)
      expected.push(edge(console, camera, 'HDカメラをPS5へ接続', 'USB_A'))
      break
    }
    case 7: {
      const storage = g(caseId, 'USB拡張ストレージ', 'Storage', [
        p('USB_A', 'input', 1, { label: 'SuperSpeed USB接続' }),
      ], { bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(storage)
      expected.push(edge(console, storage, 'USB拡張ストレージをPS5へ接続', 'USB_A'))
      break
    }
    case 8: {
      const vr = g(caseId, 'PlayStation VR2', 'VRGlass', [
        p('USB_C', 'input', 1, { supportsVideo: true, label: '映像・データ接続' }),
      ], { bluetoothTargetGadgetIds: [console.id] })
      const left = g(caseId, 'PS VR2 Sense (L)', 'Controller', [bt(), p('USB_C', 'input', 1, { label: '充電' })], { bluetoothTargetGadgetIds: [console.id] })
      const right = g(caseId, 'PS VR2 Sense (R)', 'Controller', [bt(), p('USB_C', 'input', 1, { label: '充電' })], { bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(vr, left, right)
      expected.push(edge(console, vr, 'PS VR2を前面USB-Cへ接続', 'USB_C'))
      expected.push(edge(console, left, 'Sense Lを無線接続', 'Bluetooth'))
      expected.push(edge(console, right, 'Sense Rを無線接続', 'Bluetooth'))
      break
    }
    case 9: {
      const computer = pc(caseId)
      const recorder = capture(caseId)
      gadgets.splice(1, 0, recorder, computer)
      expected.splice(0, 1,
        edge(console, recorder, 'PS5からキャプチャー', 'HDMI'),
        edge(recorder, screen, 'キャプチャーから画面', 'HDMI'),
        edge(computer, recorder, 'キャプチャーをPCへ接続'),
      )
      break
    }
  }

  return {
    platform: 'PS5',
    generation: 'PS5',
    family: family.name,
    archetype: ps5Archetypes[archetypeIndex],
    name: `${family.name} / ${ps5Archetypes[archetypeIndex]}`,
    gadgets,
    expected,
    wiredOverrides,
  }
}

interface XboxFamily {
  name: string
  generation: 'Xbox Series X' | 'Xbox Series S'
  route: 'direct' | 'pc-share' | 'switch' | 'capture'
  screenName: string
  screenCategory: 'Monitor' | 'TV' | 'Projector'
}

const xboxFamilies: XboxFamily[] = [
  { name: 'Series X / 4K120テレビ', generation: 'Xbox Series X', route: 'direct', screenName: '4K120テレビ', screenCategory: 'TV' },
  { name: 'Series X / 4K60モニター', generation: 'Xbox Series X', route: 'direct', screenName: '4K60モニター', screenCategory: 'Monitor' },
  { name: 'Series X / 1440p120モニター', generation: 'Xbox Series X', route: 'direct', screenName: '1440p120モニター', screenCategory: 'Monitor' },
  { name: 'Series X / PC共有モニター', generation: 'Xbox Series X', route: 'pc-share', screenName: 'PC共有モニター', screenCategory: 'Monitor' },
  { name: 'Series X / キャプチャーパススルー', generation: 'Xbox Series X', route: 'capture', screenName: '配信用モニター', screenCategory: 'Monitor' },
  { name: 'Series S / 1440p120モニター', generation: 'Xbox Series S', route: 'direct', screenName: '1440p120モニター', screenCategory: 'Monitor' },
  { name: 'Series S / 1080p120モニター', generation: 'Xbox Series S', route: 'direct', screenName: '1080p120モニター', screenCategory: 'Monitor' },
  { name: 'Series S / 4KストリーミングTV', generation: 'Xbox Series S', route: 'direct', screenName: '4Kテレビ', screenCategory: 'TV' },
  { name: 'Series S / HDMI切替器共有', generation: 'Xbox Series S', route: 'switch', screenName: '共有モニター', screenCategory: 'Monitor' },
  { name: 'Series S / キャプチャーパススルー', generation: 'Xbox Series S', route: 'capture', screenName: '配信用モニター', screenCategory: 'Monitor' },
]

const xboxArchetypes = [
  '基本HDMI',
  '有線LAN',
  'コントローラー無線',
  'コントローラー有線',
  'コントローラーへ3.5mmヘッドセット',
  'Xboxワイヤレスヘッドセット',
  'USB外付けストレージ',
  'ストレージ拡張カード',
  'USBキーボード・マウス',
  'USBレーシングホイール',
] as const

const xboxConsole = (caseId: string, generation: XboxFamily['generation']) => g(caseId, generation, 'GameConsole', [
  p('HDMI', 'output', 1, { supportsVideo: true, label: 'HDMI 2.1' }),
  p('USB_A', 'output', 3, { label: 'USB 3.1 Gen 1' }),
  p('Ethernet', 'input', 1, { label: 'Gigabit Ethernet' }),
  p('XboxWireless', 'bidirectional', 1, { label: 'Xbox Wireless' }),
  p('XboxExpansion', 'output', 1, { label: 'ストレージ拡張スロット' }),
  acIn(),
], { consoleFormFactor: 'stationary' })

function buildXboxCase(family: XboxFamily, familyIndex: number, archetypeIndex: number): AuditCase {
  const caseId = `xbox-f${familyIndex + 1}-a${archetypeIndex + 1}`
  const console = xboxConsole(caseId, family.generation)
  const extraScreenPorts = family.route === 'pc-share' ? [p('DisplayPort', 'input', 1, { supportsVideo: true })] : []
  const screen = display(caseId, family.screenName, family.screenCategory, extraScreenPorts)
  const gadgets: Gadget[] = [console, screen]
  const expected: ExpectedEdge[] = [edge('wall', console, 'Xboxへ給電', 'Power')]
  const wiredOverrides: string[] = []

  if (family.route === 'capture') {
    const computer = pc(caseId)
    const recorder = capture(caseId)
    gadgets.splice(1, 0, recorder, computer)
    expected.push(
      edge(console, recorder, 'Xboxからキャプチャー', 'HDMI'),
      edge(recorder, screen, 'キャプチャーから画面', 'HDMI'),
      edge(computer, recorder, 'キャプチャーをPCへ接続'),
    )
  } else if (family.route === 'switch') {
    const computer = pc(caseId)
    const selector = hdmiSwitch(caseId)
    gadgets.splice(1, 0, computer, selector)
    expected.push(
      edge(console, selector, 'XboxからHDMI切替器', 'HDMI'),
      edge(computer, selector, 'PCからHDMI切替器', 'HDMI'),
      edge(selector, screen, 'HDMI切替器から画面', 'HDMI'),
    )
  } else {
    expected.push(edge(console, screen, 'Xboxから画面', 'HDMI'))
    if (family.route === 'pc-share') {
      const computer = pc(caseId)
      gadgets.splice(1, 0, computer)
      expected.push(edge(computer, screen, 'PCから共有画面', 'DisplayPort'))
    }
  }

  switch (archetypeIndex) {
    case 1: {
      const network = router(caseId)
      gadgets.push(network)
      expected.push(edge(network, console, 'ルーターからXboxへ有線LAN', 'Ethernet'))
      break
    }
    case 2: {
      const controller = g(caseId, 'Xbox ワイヤレスコントローラー', 'Controller', [
        p('XboxWireless', 'bidirectional'),
        bt(),
        p('USB_C', 'input', 1, { label: '有線通信' }),
        p('Audio3_5mm', 'output', 1, { label: 'ヘッドセット' }),
      ], { powerUsage: 'replaceable', bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(controller)
      expected.push(edge(console, controller, 'コントローラーをXbox Wireless接続', 'XboxWireless'))
      break
    }
    case 3: {
      const controller = g(caseId, 'Xbox ワイヤレスコントローラー（有線）', 'Controller', [
        p('XboxWireless', 'bidirectional'),
        bt(),
        p('USB_C', 'input', 1, { label: '有線通信' }),
        p('Audio3_5mm', 'output', 1, { label: 'ヘッドセット' }),
      ], { powerUsage: 'replaceable', bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(controller)
      wiredOverrides.push(controller.id)
      expected.push(edge(console, controller, 'コントローラーをUSB有線接続', 'USB_A_to_C'))
      break
    }
    case 4: {
      const controller = g(caseId, 'Xbox ワイヤレスコントローラー', 'Controller', [
        p('XboxWireless', 'bidirectional'),
        bt(),
        p('USB_C', 'input', 1, { label: '有線通信' }),
        p('Audio3_5mm', 'output', 1, { label: 'ヘッドセット' }),
      ], { powerUsage: 'replaceable', bluetoothTargetGadgetIds: [console.id] })
      const headset = g(caseId, 'Xbox ステレオ ヘッドセット', 'Headphone', [
        p('Audio3_5mm', 'input', 1, { label: '4極ヘッドセット' }),
      ], { bluetoothTargetGadgetIds: [controller.id] })
      gadgets.push(controller, headset)
      expected.push(edge(console, controller, 'コントローラーをXbox Wireless接続', 'XboxWireless'))
      expected.push(edge(controller, headset, 'コントローラーへヘッドセット', 'Audio3_5mm'))
      break
    }
    case 5: {
      const headset = g(caseId, 'Xbox ワイヤレス ヘッドセット', 'Headphone', [
        p('XboxWireless', 'bidirectional'),
        bt(),
        p('USB_C', 'input', 1, { label: '充電' }),
      ], { powerUsage: 'rechargeable', bluetoothTargetGadgetIds: [console.id], powerSourceGadgetId: console.id })
      gadgets.push(headset)
      expected.push(edge(console, headset, 'ヘッドセットをXbox Wireless接続', 'XboxWireless'))
      expected.push(edge(console, headset, 'ヘッドセットをXboxから充電', 'USB_A_to_C', 'power'))
      break
    }
    case 6: {
      const storage = g(caseId, 'USB 3.1 外付けHDD', 'Storage', [
        p('USB_A', 'input', 1, { label: 'USB 3.1接続' }),
      ], { bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(storage)
      expected.push(edge(console, storage, 'USB外付けストレージを接続', 'USB_A'))
      break
    }
    case 7: {
      const storage = g(caseId, 'Xbox Series X|S用ストレージ拡張カード', 'Storage', [
        p('XboxExpansion', 'input', 1, { label: '専用スロットへ直挿し', directAttach: true }),
      ], { bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(storage)
      expected.push(edge(console, storage, '専用ストレージ拡張スロットへ装着', 'XboxExpansion'))
      break
    }
    case 8: {
      const keyboard = g(caseId, 'USBキーボード', 'Keyboard', [p('USB_A', 'input', 1, { label: 'USB有線' })], { bluetoothTargetGadgetIds: [console.id] })
      const mouse = g(caseId, 'USBマウス', 'Mouse', [p('USB_A', 'input', 1, { label: 'USB有線' })], { bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(keyboard, mouse)
      expected.push(edge(console, keyboard, 'キーボードをUSB接続', 'USB_A'))
      expected.push(edge(console, mouse, 'マウスをUSB接続', 'USB_A'))
      break
    }
    case 9: {
      const wheel = g(caseId, 'Xbox対応レーシングホイール', 'Controller', [
        p('USB_A', 'input', 1, { label: 'USB有線' }),
        acIn(),
      ], { bluetoothTargetGadgetIds: [console.id] })
      gadgets.push(wheel)
      expected.push(edge(console, wheel, 'レーシングホイールをUSB接続', 'USB_A'))
      expected.push(edge('wall', wheel, 'レーシングホイールへ給電', 'Power'))
      break
    }
  }

  return {
    platform: 'Xbox Series X / S',
    generation: family.generation,
    family: family.name,
    archetype: xboxArchetypes[archetypeIndex],
    name: `${family.name} / ${xboxArchetypes[archetypeIndex]}`,
    gadgets,
    expected,
    wiredOverrides,
  }
}

const cases: AuditCase[] = [
  ...nintendoProfiles.flatMap((profile, familyIndex) =>
    switch2Archetypes.map((_, archetypeIndex) => buildSwitchCase(profile, familyIndex, archetypeIndex))),
  ...ps5Families.flatMap((family, familyIndex) =>
    ps5Archetypes.map((_, archetypeIndex) => buildPs5Case(family, familyIndex, archetypeIndex))),
  ...xboxFamilies.flatMap((family, familyIndex) =>
    xboxArchetypes.map((_, archetypeIndex) => buildXboxCase(family, familyIndex, archetypeIndex))),
]

const planFor = (scenario: AuditCase): DeskPlan => ({
  id: `plan-${scenario.name}`,
  name: scenario.name,
  goal: 'clean_wiring',
  selectedGadgetIds: scenario.gadgets.map((item) => item.id),
  placements: [],
  outletCount: 10,
  outletCountVersion: 2,
  wiredOverrides: scenario.wiredOverrides,
  createdAt,
  updatedAt: createdAt,
})

const matchesEdge = (connection: Connection, expected: ExpectedEdge) =>
  connection.fromGadgetId === expected.from &&
  connection.toGadgetId === expected.to &&
  (!expected.cable || connection.cableType === expected.cable) &&
  (expected.kind === 'power'
    ? connection.chargingOnly === true || connection.id.startsWith('power-') || connection.id.startsWith('pd-power-')
    : connection.chargingOnly !== true && !connection.id.startsWith('power-') && !connection.id.startsWith('pd-power-'))

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

  const physicalPairCounts = new Map<string, number>()
  for (const connection of result.connections) {
    if (['Bluetooth', 'XboxWireless', 'WiFi', 'wirelessCharging', 'Stylus', 'Power', 'XboxExpansion'].includes(connection.cableType)) continue
    if (connection.fromGadgetId === 'wall' || connection.fromGadgetId.startsWith('failed')) continue
    const key = `${connection.fromGadgetId}~${connection.toGadgetId}|${connection.toPortType}`
    physicalPairCounts.set(key, (physicalPairCounts.get(key) ?? 0) + 1)
  }
  if ([...physicalPairCounts.values()].some((count) => count > 1)) issues.push('duplicate-physical-link')

  if (process.env.AUDIT_DUMP && scenario.name.includes(process.env.AUDIT_DUMP)) {
    const nameOf = (id: string) => scenario.gadgets.find((item) => item.id === id)?.name ?? id
    console.log(`DUMP ${scenario.name}`)
    for (const connection of result.connections) {
      console.log(`  ${nameOf(connection.fromGadgetId)} [${connection.fromPortType}] -> ${nameOf(connection.toGadgetId)} [${connection.toPortType}] ${connection.cableType}${connection.chargingOnly ? ' chargingOnly' : ''}`)
    }
    for (const warning of result.warnings) console.log(`  ! ${warning}`)
  }

  return {
    platform: scenario.platform,
    generation: scenario.generation,
    family: scenario.family,
    archetype: scenario.archetype,
    name: scenario.name,
    connections: result.connections.length,
    warnings: result.warnings.length,
    issues: [...new Set(issues)],
  }
}

const portCount = (name: string, type: PortType) =>
  GADGET_PRESETS.find((preset) => preset.name === name)?.ports
    .filter((port) => port.type === type)
    .reduce((sum, port) => sum + port.count, 0) ?? 0
const presetIssues: string[] = []
if (!GADGET_PRESETS.some((preset) => preset.name === 'Nintendo Switch 本体')) presetIssues.push('Nintendo Switch本体の独立プリセットがない')
if (portCount('Nintendo Switch Dock', 'USB_A') !== 3 || portCount('Nintendo Switch Dock', 'Ethernet') !== 0) {
  presetIssues.push('Nintendo Switch通常DockのUSB/LAN構成が不正')
}
if (portCount('Nintendo Switch OLED Dock', 'USB_A') !== 2 || portCount('Nintendo Switch OLED Dock', 'Ethernet') !== 1) {
  presetIssues.push('Nintendo Switch OLED DockのUSB/LAN構成が不正')
}
const switchPreset = GADGET_PRESETS.find((preset) => preset.name === 'Nintendo Switch 2')
if (!switchPreset || portCount('Nintendo Switch 2', 'USB_C') !== 2) presetIssues.push('Switch 2: USB-C 2ポートが未登録')
if (!switchPreset?.ports.some((port) => port.type === 'USB_C' && /上部/.test(port.label ?? '') && port.direction === 'bidirectional')) {
  presetIssues.push('Switch 2: 上部USB-Cの周辺機器接続能力が未登録')
}
if (switchPreset?.consoleFormFactor !== 'handheld' || switchPreset.powerUsage !== 'rechargeable') {
  presetIssues.push('Switch 2: 携帯機・充電式の属性が不正')
}
if (!GADGET_PRESETS.some((preset) => preset.name === 'Nintendo Switch 2 カメラ')) presetIssues.push('Switch 2 カメラのプリセットがない')
if (!CONTROLLER_PRESETS.some((preset) => preset.name === 'Nintendo Switch 2 Proコントローラー')) presetIssues.push('Switch 2 Proコントローラーのプリセットがない')
if (portCount('PlayStation 5', 'USB_A') !== 3 || portCount('PlayStation 5', 'USB_C') !== 1) presetIssues.push('PS5 CFI-1000のUSB構成が不正')
if (portCount('PlayStation 5 Slim', 'USB_A') !== 2 || portCount('PlayStation 5 Slim', 'USB_C') !== 2) presetIssues.push('PS5 SlimのUSB構成が不正')
if (!GADGET_PRESETS.some((preset) => preset.name === 'PlayStation 5 Pro')) presetIssues.push('PS5 Proのプリセットがない')
const vr2Preset = VR_GLASS_PRESETS.find((preset) => preset.name === 'PlayStation VR2')
if (!vr2Preset?.ports.some((port) => port.type === 'USB_C' && port.supportsVideo && /データ|接続/.test(port.label ?? ''))) {
  presetIssues.push('PlayStation VR2のUSB-C映像・データ属性が不足')
}
if (!HEADPHONE_PRESETS.some((preset) => preset.name === 'PULSE Elite ワイヤレスヘッドセット')) {
  presetIssues.push('PULSE Eliteのプリセットがない')
}
for (const name of ['Xbox Series X', 'Xbox Series S']) {
  if (portCount(name, 'USB_A') !== 3) presetIssues.push(`${name}: USB-A 3ポートが未登録`)
  if (portCount(name, 'XboxWireless') !== 1) presetIssues.push(`${name}: Xbox Wirelessが未登録`)
  if (portCount(name, 'XboxExpansion') !== 1) presetIssues.push(`${name}: ストレージ拡張スロットが未登録`)
}
const xboxControllerPreset = CONTROLLER_PRESETS.find((preset) => preset.name === 'Xbox ワイヤレスコントローラー')
if (!xboxControllerPreset?.ports.some((port) => port.type === 'XboxWireless')) {
  presetIssues.push('Xboxワイヤレスコントローラー: Xbox Wirelessが未登録')
}
if (!HEADPHONE_PRESETS.some((preset) => preset.name === 'Xbox ワイヤレス ヘッドセット')) {
  presetIssues.push('Xboxワイヤレスヘッドセットのプリセットがない')
}

const results = cases.map(inspect)
for (const platform of ['Nintendo Switch / Switch 2', 'PS5', 'Xbox Series X / S'] as const) {
  const platformResults = results.filter((result) => result.platform === platform)
  const passed = platformResults.filter((result) => result.issues.length === 0)
  const byArchetype = new Map<string, { total: number; passed: number }>()
  const byIssue = new Map<string, number>()
  for (const result of platformResults) {
    const aggregate = byArchetype.get(result.archetype) ?? { total: 0, passed: 0 }
    aggregate.total++
    if (result.issues.length === 0) aggregate.passed++
    byArchetype.set(result.archetype, aggregate)
    for (const issue of result.issues) byIssue.set(issue, (byIssue.get(issue) ?? 0) + 1)
  }
  console.log(`${platform}環境監査（10構成 × 10用途）`)
  console.log(`ケース: ${platformResults.length} / 成立: ${passed.length} / 不成立: ${platformResults.length - passed.length}`)
  if (platform === 'Nintendo Switch / Switch 2') {
    for (const generation of ['Switch', 'Switch 2'] as const) {
      const generationResults = platformResults.filter((result) => result.generation === generation)
      const generationPassed = generationResults.filter((result) => result.issues.length === 0)
      console.log(`  ${generation}: ${generationPassed.length}/${generationResults.length}`)
    }
  }
  if (platform === 'Xbox Series X / S') {
    for (const generation of ['Xbox Series X', 'Xbox Series S'] as const) {
      const generationResults = platformResults.filter((result) => result.generation === generation)
      const generationPassed = generationResults.filter((result) => result.issues.length === 0)
      console.log(`  ${generation}: ${generationPassed.length}/${generationResults.length}`)
    }
  }
  for (const [archetype, aggregate] of byArchetype) console.log(`  ${archetype}: ${aggregate.passed}/${aggregate.total}`)
  if (byIssue.size > 0) {
    console.log('  問題内訳')
    for (const [issue, count] of [...byIssue.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${count}: ${issue}`)
  }
  console.log('')
}

console.log(`プリセット監査: ${presetIssues.length === 0 ? 'PASS' : `NG ${presetIssues.length}件`}`)
for (const issue of presetIssues) console.log(`  ${issue}`)

if (process.env.AUDIT_VERBOSE) {
  for (const result of results.filter((result) => result.issues.length > 0)) {
    console.log(`NG ${result.name}: ${result.issues.join(', ')}`)
  }
}

if (cases.filter((scenario) => scenario.platform === 'Nintendo Switch / Switch 2').length !== 100) throw new Error('Nintendo Switch / Switch 2ケースが100件ではありません')
if (cases.filter((scenario) => scenario.platform === 'PS5').length !== 100) throw new Error('PS5ケースが100件ではありません')
if (cases.filter((scenario) => scenario.platform === 'Xbox Series X / S').length !== 100) throw new Error('Xbox Series X / Sケースが100件ではありません')
process.exit(results.some((result) => result.issues.length > 0) || presetIssues.length > 0 ? 1 : 0)
