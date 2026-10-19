/**
 * YouTube のデスクツアーで実際に紹介されている構成を再現し、
 * 配線エンジン（generateWiring）の不整合を洗い出す監査スクリプト。
 *
 *   npx tsx scripts/auditDeskTourWiring.ts
 *
 * レイアウト（線の重なり）は auditMapLayout.ts、端子の成立性は
 * auditConnectionCapabilities.ts が見る。ここは「どの機器がどこへ繋がったか」だけを見る。
 */
import { Connection, DeskPlan, Gadget, GadgetCategory, Port, PortDirection, PortType } from '../src/types'
import { isWirelessPortType, requiresPhysicalCable } from '../src/constants/portTypes'
import { generateWiring } from '../src/utils/wiringEngine'

// ─── ガジェット定義のヘルパー ─────────────────────────────────
let seq = 0
const p = (type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port =>
  ({ id: `p${++seq}`, type, direction, count, ...extra })

const g = (
  name: string,
  category: GadgetCategory,
  ports: Port[],
  extra: Partial<Gadget> = {},
): Gadget => ({
  id: `${category}-${name}`.replace(/\s+/g, '_'),
  name,
  category,
  ports,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
})

// よく出る機器のショートハンド（実機の端子構成に合わせる）
const acIn = () => p('Power', 'input', 1, { label: '給電 (コンセント)' })
const usbCPowerIn = () => p('USB_C', 'input', 1, { label: '給電 (C)' })
const usbAPowerIn = () => p('USB_A', 'input', 1, { label: '給電 (A)' })
const bt = () => p('Bluetooth', 'bidirectional')

const btMouse = (name: string) => g(name, 'Mouse', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' })
const dongleMouse = (name: string) => g(name, 'Mouse', [
  p('USB_A', 'input', 1, { label: '2.4GHzレシーバー', directAttach: true }),
  usbCPowerIn(),
], { powerUsage: 'rechargeable' })
const btKeyboard = (name: string) => g(name, 'Keyboard', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' })
const wiredKeyboard = (name: string) => g(name, 'Keyboard', [
  p('USB_C', 'input', 1, { label: '有線接続 (USB-C)' }),
])
const powerStrip = (name: string, outlets: number, usbC = 0, usbA = 0) => g(name, 'PowerStrip', [
  p('Power', 'output', outlets, { label: 'アース付き 3極' }),
  ...(usbC > 0 ? [p('USB_C', 'output', usbC)] : []),
  ...(usbA > 0 ? [p('USB_A', 'output', usbA)] : []),
  p('Power', 'input'),
])
// buildChargerPorts + defaultPowerInputForCategory('Charger') = 'outlet' 相当
const charger = (name: string, usbC: number, usbA = 0, wireless = 0) => g(name, 'Charger', [
  ...(usbC > 0 ? [p('USB_C', 'output', usbC)] : []),
  ...(usbA > 0 ? [p('USB_A', 'output', usbA)] : []),
  ...(wireless > 0 ? [p('wirelessCharging', 'output', wireless, { label: 'ワイヤレス出力' })] : []),
  acIn(),
])
const iphone = (name = 'iPhone 16 Pro') => g(name, 'Smartphone', [
  p('USB_C', 'bidirectional', 1, { label: '充電・データ' }),
  p('wirelessCharging', 'input', 1, { label: 'ワイヤレス給電' }),
  bt(),
], { powerUsage: 'rechargeable' })
const appleWatch = () => g('Apple Watch Series 10', 'Smartwatch', [
  p('wirelessCharging', 'input', 1, { label: 'ワイヤレス給電' }),
  bt(),
], { powerUsage: 'rechargeable' })
const airpods = () => g('AirPods Pro 2', 'Earphone', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' })
const routerWith = (lan: number) => g('WiFi 7 ルーター', 'Router', [
  p('Ethernet', 'input', 1, { label: 'WAN' }),
  p('Ethernet', 'output', lan, { label: 'LAN' }),
  p('WiFi', 'bidirectional'),
  acIn(),
])
const macbookPro = (name: string) => g(name, 'PC', [
  p('Thunderbolt', 'bidirectional', 3, { supportsVideo: true, supportsPowerDelivery: true }),
  p('HDMI', 'output', 1, { supportsVideo: true }),
  p('SDCard', 'input', 1),
  p('Audio3_5mm', 'output', 1),
], { pcFormFactor: 'laptop', pcOs: 'macOS', pcThunderbolt: true })
const caldigitTs4 = () => g('CalDigit TS4', 'Dock', [
  p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Host / PD 98W' }),
  p('Thunderbolt', 'output', 1, { supportsVideo: true }),
  p('DisplayPort', 'output', 1, { supportsVideo: true }),
  p('USB_C', 'output', 3),
  p('USB_A', 'output', 5),
  p('Ethernet', 'input', 1),
  p('SDCard', 'input', 1),
  p('Audio3_5mm', 'output', 1),
  p('Audio3_5mm', 'input', 1),
  acIn(),
])
const desk = () => g('FlexiSpot E7H', 'Desk', [acIn()], { isHeightAdjustable: true, deskLiftType: 'electric' })
const chair = () => g('Steelcase Gesture', 'Chair', [])

// ─── シナリオ（出典: 実在するデスクツアー記事・動画の機材リスト）───────
interface Scenario {
  name: string
  source: string
  /** 機材リストを写した記事の URL（再確認できるようにする） */
  sourceUrl?: string
  outletCount: number
  gadgets: Gadget[]
  /**
   * ユーザー設定をプラン側へ入れるための上書き。`wiredOverrides`（有線を強制）や
   * `connectionMap.dismissedPairs`（消した線を復活させない）は配線の各所を分岐させるのに、
   * 設定しているシナリオが1つも無く検査できていなかった
   */
  planOverrides?: Partial<DeskPlan>
}

export const scenarios = (): Scenario[] => {
  seq = 0
  const list: Scenario[] = []

  // 1. Ross Jukes / 写真・動画編集デスク（UK）
  list.push({
    name: '写真・動画編集（MacBook Pro + TS4 + 32インチOLED）',
    source: 'rossjukesphoto.co.uk / My Photo & Video Editing Desk Setup',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 16 M2 Max'),
      caldigitTs4(),
      g('ASUS ProArt PA32UCDM', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C (DP Alt / PD 96W)' }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 2),
        acIn(),
      ]),
      g('Focusrite Scarlett Solo', 'AudioInterface', [
        p('XLR', 'input', 1),
        p('Audio6_3mm_TS', 'input', 1, { label: 'Instrument' }),
        p('Audio6_3mm', 'output', 2, { label: 'Monitor Out' }),
        p('Audio3_5mm', 'output', 1, { label: 'Headphone' }),
        p('USB_C', 'input', 1, { label: 'PC接続 / バスパワー' }),
      ]),
      g('コンデンサーマイク', 'Microphone', [p('XLR', 'output', 1)]),
      g('Adam Audio A4V (L)', 'Speaker', [p('XLR', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'L' }),
      g('Adam Audio A4V (R)', 'Speaker', [p('XLR', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'R' }),
      g('Topping DX3 Pro+', 'HeadphoneAmp', [
        p('USB_B', 'input', 1),
        p('OpticalAudio', 'input', 1),
        p('RCA', 'output', 2),
        p('Audio6_3mm', 'output', 1),
        acIn(),
      ]),
      g('Beyerdynamic DT 770 PRO', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      btKeyboard('Logitech MX Keys S'),
      btMouse('Logitech MX Master 4'),
      g('BenQ ScreenBar', 'Light', [usbAPowerIn()]),
      g('Elgato Key Light', 'Light', [p('WiFi', 'bidirectional'), acIn()]),
      g('TourBox Lite', 'SmallDevice', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('iPad mini 6', 'Tablet', [p('USB_C', 'bidirectional', 1, { label: '充電・データ' }), bt()], { powerUsage: 'rechargeable' }),
      g('Sabrent HDDドッキングステーション', 'Storage', [p('USB_C', 'input', 1), acIn()]),
      g('QNAP NAS', 'Storage', [p('Ethernet', 'input', 1), acIn()]),
      routerWith(4),
      powerStrip('エレコム 10口タップ', 10, 0, 2),
      desk(),
      chair(),
    ],
  })

  // 2. tech-you.jp / 3畳書斎（JP）
  list.push({
    name: '3畳書斎（ウルトラワイド Thunderbolt ハブモニター）',
    source: 'tech-you.jp デスクツアー 2025',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 14 M1 Max'),
      g('Dell U3425WE', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'TB (映像 / PD 90W)' }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'output', 3),
        p('USB_C', 'output', 1),
        p('Ethernet', 'input', 1),
        acIn(),
      ]),
      g('MOTU M2', 'AudioInterface', [
        p('XLR_TRS_Combo', 'input', 2),
        p('Audio6_3mm', 'output', 2, { label: 'Monitor Out' }),
        p('RCA', 'output', 2),
        p('Audio6_3mm', 'output', 1, { label: 'Headphone' }),
        p('MIDI', 'input', 1),
        p('MIDI', 'output', 1),
        p('USB_C', 'input', 1, { label: 'PC接続 / バスパワー' }),
      ]),
      g('SHURE SM7B', 'Microphone', [p('XLR', 'output', 1)]),
      g('Elgato Wave Mic Arm LP', 'MicArm', [p('MicArm', 'output', 1)]),
      g('EDIFIER MR5 (L)', 'Speaker', [p('Audio6_3mm', 'input', 1), p('RCA', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'L' }),
      g('Audio Technica ATH-R70x', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      g('HHKB Professional HYBRID Type-S', 'Keyboard', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      btMouse('Logicool MX Ergo S'),
      g('EPOMAKER EK21 テンキー', 'Keyboard', [p('USB_C', 'input', 1, { label: '有線接続 (USB-C)' })]),
      g('TourBox Elite', 'SmallDevice', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('BenQ ScreenBar Halo 2', 'Light', [usbAPowerIn()]),
      charger('UGREEN Nexode 100W 4ポート', 3, 1),
      g('Apple MagSafe充電器', 'Charger', [
        p('wirelessCharging', 'output', 1, { label: 'ワイヤレス出力' }),
        usbCPowerIn(),
      ]),
      iphone(),
      appleWatch(),
      airpods(),
      g('iPad mini 6', 'Tablet', [p('USB_C', 'bidirectional', 1, { label: '充電・データ' }), bt()], { powerUsage: 'rechargeable' }),
      powerStrip('エレコム 10口タップ ECT-0102BK', 10),
      desk(),
      chair(),
    ],
  })

  // 3. 配信者（SM7B + GoXLR）
  list.push({
    name: '配信デスク（SM7B + GoXLR + デュアルモニター）',
    source: 'YouTube: SM7B & GoXLR Setup Guide 2025 系デスクツアー',
    outletCount: 2,
    gadgets: [
      g('自作ゲーミングPC', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 6),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('LG 27GP950 (メイン)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 2),
        acIn(),
      ]),
      g('Dell S2721DGF (サブ)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        acIn(),
      ]),
      g('TC-Helicon GoXLR', 'Mixer', [
        p('XLR', 'input', 1),
        p('Audio6_3mm', 'output', 1, { label: 'Headphone' }),
        p('Audio3_5mm', 'output', 1, { label: 'Line Out' }),
        p('USB_B', 'input', 1),
        acIn(),
      ]),
      g('SHURE SM7B', 'Microphone', [p('XLR', 'output', 1)]),
      g('Rode PSA1+', 'MicArm', [p('MicArm', 'output', 1)]),
      g('Elgato Stream Deck MK.2', 'SmallDevice', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('Elgato Cam Link 4K', 'CaptureDevice', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'input', 1, { label: '有線接続', directAttach: true }),
      ]),
      g('Sony ZV-E10', 'Webcam', [p('HDMI', 'output', 1, { supportsVideo: true }), usbCPowerIn()]),
      g('Elgato Key Light Air (L)', 'Light', [p('WiFi', 'bidirectional'), acIn()]),
      g('Elgato Key Light Air (R)', 'Light', [p('WiFi', 'bidirectional'), acIn()]),
      g('Beyerdynamic DT 770 PRO', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      dongleMouse('Logitech G Pro X Superlight 2'),
      wiredKeyboard('Wooting 60HE'),
      g('PlayStation 5', 'GameConsole', [
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('Ethernet', 'input', 1),
        p('USB_A', 'output', 2),
        p('USB_C', 'output', 1),
        acIn(),
      ], { consoleFormFactor: 'stationary' }),
      g('DualSense', 'Controller', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      routerWith(4),
      powerStrip('サンワサプライ 電源タップ', 8),
      desk(),
    ],
  })

  // 4. ミニマル Mac（Apple Studio Display）
  list.push({
    name: 'ミニマル Mac（Studio Display 1枚）',
    source: 'workspaces.xyz 頻出構成（Studio Display / Magic Keyboard / Magic Trackpad）',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Air M4'),
      g('Apple Studio Display', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Host / PD 96W' }),
        p('USB_C', 'output', 3),
        acIn(),
      ]),
      btKeyboard('Apple Magic Keyboard'),
      g('Apple Magic Trackpad', 'Mouse', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      airpods(),
      iphone(),
      charger('Anker 733 MagGo', 2, 1, 1),
      powerStrip('無印良品 電源タップ', 4),
    ],
  })

  // 5. 開発者トリプルモニター（Windows / 有線LAN）
  list.push({
    name: '開発者トリプルモニター（Windows デスクトップ）',
    source: 'workspaces.xyz Developer タグ構成 / Dell UltraSharp 3枚',
    outletCount: 2,
    gadgets: [
      g('Ryzen 自作PC', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 8),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('Dell U2723QE (左)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 4),
        p('Ethernet', 'input', 1),
        acIn(),
      ]),
      g('Dell U2723QE (中央)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('USB_A', 'output', 4),
        acIn(),
      ]),
      g('Dell U2723QE (右)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        acIn(),
      ]),
      g('エルゴトロン LX (中央)', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      wiredKeyboard('Keychron Q1'),
      dongleMouse('Logitech MX Master 3S'),
      g('Logicool BRIO', 'Webcam', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('Audioengine A2+ (L)', 'Speaker', [p('Audio3_5mm', 'input', 1), p('RCA', 'input', 1), p('USB_B', 'input', 1), acIn()]),
      g('CyberPower UPS', 'UPS', [p('Power', 'output', 6), p('Power', 'input', 1)]),
      routerWith(4),
      powerStrip('電源タップ', 6),
      desk(),
      chair(),
    ],
  })

  // 6. デュアル PC + KVM
  list.push({
    name: 'デュアル PC + KVM 切替',
    source: 'YouTube デスクツアー頻出（仕事用 Mac / 個人用 Windows を KVM で共有）',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 14 (仕事用)'),
      g('Windows デスクトップ (個人用)', 'PC', [
        p('DisplayPort', 'output', 2, { supportsVideo: true }),
        p('USB_A', 'output', 6),
        p('Ethernet', 'input', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('TESmart 2x1 KVM', 'KVM', [
        p('DisplayPort', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'output', 1, { supportsVideo: true }),
        p('USB_B', 'input', 2),
        p('USB_A', 'output', 4),
        acIn(),
      ]),
      g('LG 34WN80C', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        acIn(),
      ]),
      wiredKeyboard('HHKB (有線)'),
      dongleMouse('Logitech MX Master 3S'),
      g('Audio-Technica ATH-M50x', 'Headphone', [p('Audio3_5mm', 'input', 1)]),
      routerWith(4),
      powerStrip('電源タップ', 6),
    ],
  })

  // 7. DTM 宅録
  list.push({
    name: 'DTM 宅録（オーディオIF + ミキサー + MIDI）',
    source: 'YouTube【デスクツアー2025】音楽クリエイターの自宅スタジオ',
    outletCount: 2,
    gadgets: [
      g('Mac Studio', 'PC', [
        p('Thunderbolt', 'bidirectional', 4, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('Ethernet', 'input', 1),
        p('SDCard', 'input', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'macOS' }),
      g('LG 32UN880 (メイン)', 'Monitor', [
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        acIn(),
      ]),
      g('EIZO EV2360 (サブ)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        acIn(),
      ]),
      g('MOTU M4', 'AudioInterface', [
        p('XLR_TRS_Combo', 'input', 2),
        p('Audio6_3mm_TS', 'input', 2, { label: 'Line In' }),
        p('Audio6_3mm', 'output', 4, { label: 'Monitor Out' }),
        p('Audio6_3mm', 'output', 1, { label: 'Headphone' }),
        p('MIDI', 'input', 1),
        p('MIDI', 'output', 1),
        p('USB_C', 'input', 1, { label: 'PC接続' }),
      ]),
      g('Yamaha MG10XU', 'Mixer', [
        p('XLR_TRS_Combo', 'input', 4),
        p('Audio6_3mm', 'output', 2, { label: 'Main Out' }),
        p('RCA', 'output', 2),
        p('USB_B', 'input', 1),
        acIn(),
      ]),
      g('Neumann TLM 103', 'Microphone', [p('XLR', 'output', 1)]),
      g('SHURE SM58', 'Microphone', [p('XLR', 'output', 1)]),
      g('Rode PSA1+', 'MicArm', [p('MicArm', 'output', 2)]),
      g('Roland A-49 MIDIキーボード', 'Instrument', [
        p('MIDI', 'output', 1),
        p('USB_B', 'input', 1),
      ]),
      g('Fender Stratocaster', 'Instrument', [p('Audio6_3mm_TS', 'output', 1)]),
      g('YAMAHA HS5 (L)', 'Speaker', [p('XLR', 'input', 1), p('Audio6_3mm', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'L' }),
      g('YAMAHA HS5 (R)', 'Speaker', [p('XLR', 'input', 1), p('Audio6_3mm', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'R' }),
      g('SONY MDR-CD900ST', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      btKeyboard('Apple Magic Keyboard'),
      g('Apple Magic Trackpad', 'Mouse', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      routerWith(4),
      powerStrip('CLASSIC PRO 電源タップ', 8),
      desk(),
      chair(),
    ],
  })

  // 8. コンソールゲーミング（PS5 + Switch ドック）
  list.push({
    name: 'コンソールゲーミング（PS5 + Switch ドック + キャプチャ）',
    source: 'YouTube ゲーミングデスクツアー頻出構成',
    outletCount: 2,
    gadgets: [
      g('PlayStation 5', 'GameConsole', [
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('Ethernet', 'input', 1),
        p('USB_A', 'output', 2),
        p('USB_C', 'output', 1),
        acIn(),
      ], { consoleFormFactor: 'stationary' }),
      g('Nintendo Switch 2', 'GameConsole', [
        p('USB_C', 'bidirectional', 1, { label: '充電・データ' }),
        p('Audio3_5mm', 'output', 1),
        bt(),
      ], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' }),
      g('Nintendo Switch 2 ドック', 'Dock', [
        // プリセット「Nintendo Switch 2 Dock」に合わせて本体接続は bidirectional
        p('USB_C', 'bidirectional', 1, { label: 'USB-C (本体接続)' }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        p('Ethernet', 'input', 1),
        acIn(),
      ]),
      g('BenQ MOBIUZ EX2710U', 'Monitor', [
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 2),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ]),
      // CATEGORY_PORT_CONFIG.CaptureDevice のとおり「USB-C (PC 接続)」は direction: 'output'
      g('AVerMedia GC553', 'CaptureDevice', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { label: 'USB-C (PC 接続)' }),
      ]),
      g('ゲーミングPC', 'PC', [
        p('DisplayPort', 'output', 2, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 6),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('DualSense Edge', 'Controller', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('Proコントローラー', 'Controller', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('Creative Pebble V3 (L)', 'Speaker', [p('Audio3_5mm', 'input', 1), usbCPowerIn(), bt()]),
      routerWith(4),
      powerStrip('電源タップ', 8),
    ],
  })

  // 9. ホームラボ（PoE スイッチ + NAS + プリンター）
  list.push({
    name: 'ホームラボ（PoE スイッチ + NAS + ネットワークカメラ）',
    source: 'YouTube home lab desk tour 系構成',
    outletCount: 2,
    gadgets: [
      routerWith(4),
      g('ONU / モデム', 'Modem', [p('Ethernet', 'output', 1), acIn()]),
      g('TP-Link PoEスイッチ 8ポート', 'Other', [
        p('Ethernet', 'input', 1, { label: 'アップリンク' }),
        p('EthernetPoE', 'output', 8),
        acIn(),
      ]),
      g('Synology DS923+', 'Storage', [p('Ethernet', 'input', 2), acIn()]),
      g('UniFi ネットワークカメラ', 'SmartHome', [p('EthernetPoE', 'input', 1)]),
      g('Brother プリンター', 'Printer', [p('WiFi', 'bidirectional'), p('USB_B', 'input', 1), acIn()]),
      g('Bambu Lab P1S', 'Printer3D', [p('WiFi', 'bidirectional'), p('microSDCard', 'input', 1), acIn()]),
      g('Mac mini M4', 'PC', [
        p('Thunderbolt', 'bidirectional', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'mini', pcOs: 'macOS' }),
      g('Dell U2723QE', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('USB_A', 'output', 4),
        acIn(),
      ]),
      g('APC UPS', 'UPS', [p('Power', 'output', 6), p('Power', 'input', 1)]),
      powerStrip('電源タップ', 6),
    ],
  })

  // 10. 充電ステーション主体
  list.push({
    name: '充電ステーション主体（Apple 一式）',
    source: 'YouTube「充電ステーション」デスクツアー頻出構成',
    outletCount: 1,
    gadgets: [
      macbookPro('MacBook Pro 14 M4'),
      iphone(),
      appleWatch(),
      airpods(),
      // Apple Pencil Pro を吸着して充電する（M4 世代）
      g('iPad Pro 11', 'Tablet', [p('USB_C', 'bidirectional', 1, { label: '充電・データ' }), bt(), p('wirelessCharging', 'output', 1)], { powerUsage: 'rechargeable' }),
      g('Apple Pencil Pro', 'Accessory', [p('wirelessCharging', 'input', 1, { label: 'ワイヤレス給電' })], { powerUsage: 'rechargeable' }),
      g('Kindle Paperwhite', 'SmallDevice', [usbCPowerIn()], { powerUsage: 'rechargeable' }),
      charger('Anker Prime 250W 6ポート', 4, 2),
      g('Belkin BoostCharge Pro 3-in-1', 'Charger', [
        p('wirelessCharging', 'output', 3, { label: 'ワイヤレス出力' }),
        acIn(),
      ]),
      g('Anker MagGo Power Bank', 'MobileBattery', [
        p('USB_C', 'bidirectional', 1),
        p('wirelessCharging', 'output', 1, { label: 'ワイヤレス出力' }),
      ], { powerUsage: 'rechargeable' }),
      powerStrip('電源タップ', 4, 1, 1),
    ],
  })

  // 11. コンセント無し（モバイルバッテリー運用）
  list.push({
    name: 'コンセント無し（モバイルバッテリー運用）',
    source: 'YouTube ミニマル / ノマドデスクツアー',
    outletCount: 0,
    gadgets: [
      macbookPro('MacBook Air M4'),
      g('モバイルモニター 15.6', 'Monitor', [
        p('USB_C', 'input', 2, { supportsVideo: true, supportsPowerDelivery: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
      ]),
      iphone(),
      airpods(),
      g('Anker 737 Power Bank', 'MobileBattery', [
        p('USB_C', 'output', 2),
        p('USB_A', 'output', 1),
        p('USB_C', 'input', 1, { label: '給電 (C)' }),
      ], { powerUsage: 'rechargeable' }),
      btKeyboard('Keychron K3'),
      btMouse('Logitech MX Anywhere 3S'),
    ],
  })

  // 12. ウルトラワイド 1枚（Mac + ドック）
  list.push({
    name: 'ウルトラワイド1枚（MacBook + ドック + サウンドバー）',
    source: 'workspaces.xyz Ultrawide タグ構成',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 16 M4 Max'),
      caldigitTs4(),
      g('LG 45GR95QE (45インチ ウルトラワイド)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 2),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ]),
      btKeyboard('Apple Magic Keyboard'),
      btMouse('Logitech MX Master 3S'),
      g('SHURE MV7+', 'Microphone', [
        p('XLR', 'output', 1),
        p('USB_C', 'input', 1, { label: 'PC接続' }),
        p('Audio3_5mm', 'output', 1, { label: 'Headphone' }),
      ]),
      g('Elgato Wave Mic Arm', 'MicArm', [p('MicArm', 'output', 1)]),
      g('Sonos Ray サウンドバー', 'Speaker', [p('OpticalAudio', 'input', 1), p('WiFi', 'bidirectional'), acIn()]),
      g('エルゴトロン LX', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      charger('Anker 727 充電ステーション', 2, 2),
      iphone(),
      powerStrip('電源タップ', 6),
      desk(),
      chair(),
    ],
  })

  // 13. VTuber / 配信（VR トラッキング含む）
  list.push({
    name: 'VTuber 配信（キャプチャ + VR + オーディオIF）',
    source: 'YouTube 個人VTuber デスクツアー',
    outletCount: 2,
    gadgets: [
      g('配信用PC', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('USB_A', 'output', 8),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('メインモニター 27', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        acIn(),
      ]),
      g('サブモニター 24', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        acIn(),
      ]),
      g('縦置きモニター 24', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        acIn(),
      ]),
      g('Meta Quest 3', 'VRGlass', [
        p('USB_C', 'input', 1, { label: 'Link / データ' }),
        p('USB_C', 'input', 1, { label: '給電 (C)' }),
        bt(),
      ], { powerUsage: 'rechargeable' }),
      g('RODE NT1 5th', 'Microphone', [p('XLR', 'output', 1), p('USB_C', 'input', 1, { label: 'PC接続' })]),
      g('Universal Audio Volt 2', 'AudioInterface', [
        p('XLR_TRS_Combo', 'input', 2),
        p('Audio6_3mm', 'output', 2, { label: 'Monitor Out' }),
        p('Audio6_3mm', 'output', 1, { label: 'Headphone' }),
        p('USB_C', 'input', 1, { label: 'PC接続' }),
      ]),
      g('IK Multimedia iLoud Micro (L)', 'Speaker', [p('RCA', 'input', 2), p('Audio3_5mm', 'input', 1), acIn()]),
      g('SONY MDR-M1ST', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      g('Elgato HD60 X', 'CaptureDevice', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { label: 'USB-C (PC 接続)' }),
      ]),
      g('Elgato Stream Deck XL', 'SmallDevice', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('Logicool BRIO 4K', 'Webcam', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('リングライト', 'Light', [acIn()]),
      wiredKeyboard('REALFORCE R3'),
      dongleMouse('Razer Viper V3 Pro'),
      g('Nintendo Switch 2', 'GameConsole', [
        p('USB_C', 'bidirectional', 1, { label: '充電・データ' }),
        bt(),
      ], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' }),
      routerWith(4),
      powerStrip('電源タップ 10口', 10, 0, 2),
      desk(),
      chair(),
    ],
  })

  // 14. 全部盛り（30台超）
  list.push({
    name: 'デスク全部盛り（30台超）',
    source: '複数のデスクツアーの合成（高密度の回帰ケース）',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 16 M4 Max'),
      g('自作PC', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 8),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      caldigitTs4(),
      g('Anker USB-Cハブ', 'Hub', [
        p('USB_C', 'input', 1, { label: 'Host' }),
        p('USB_A', 'output', 4),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('SDCard', 'input', 1),
      ]),
      g('Dell U3225QE', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'output', 3),
        p('USB_C', 'output', 1),
        p('Ethernet', 'input', 1),
        acIn(),
      ]),
      g('LG 27UP850 (縦)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        acIn(),
      ]),
      g('エルゴトロン LX (2本)', 'MonitorArm', [p('MonitorArm', 'output', 2)]),
      g('RODE PodMic', 'Microphone', [p('XLR', 'output', 1)]),
      g('RODECaster Duo', 'Mixer', [
        p('XLR_TRS_Combo', 'input', 2),
        p('Audio6_3mm', 'output', 4, { label: 'Headphone' }),
        p('Audio6_3mm', 'output', 2, { label: 'Main Out' }),
        p('USB_C', 'input', 1, { label: 'PC接続' }),
        acIn(),
      ]),
      g('Elgato Wave Mic Arm LP', 'MicArm', [p('MicArm', 'output', 1)]),
      g('YAMAHA HS5 (L)', 'Speaker', [p('XLR', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'L' }),
      g('YAMAHA HS5 (R)', 'Speaker', [p('XLR', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'R' }),
      g('Beyerdynamic DT 900 PRO X', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      airpods(),
      btKeyboard('Keychron Q1 HE'),
      btMouse('Logitech MX Master 4'),
      g('Wacom Intuos Pro', 'PenTablet', [p('USB_C', 'input', 1, { label: '有線接続' }), bt()], { powerUsage: 'rechargeable' }),
      g('Logicool MX Creative Console', 'SmallDevice', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('Elgato Stream Deck +', 'SmallDevice', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('Logicool BRIO', 'Webcam', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('SanDisk SSD 2TB', 'Storage', [p('USB_C', 'input', 1)]),
      g('Synology NAS', 'Storage', [p('Ethernet', 'input', 1), acIn()]),
      g('BenQ ScreenBar Halo', 'Light', [usbAPowerIn()]),
      g('Nanoleaf ライトパネル', 'Light', [p('WiFi', 'bidirectional'), acIn()]),
      g('Philips Hue ブリッジ', 'SmartHome', [p('Ethernet', 'input', 1), acIn()]),
      g('SwitchBot ハブ2', 'SmartHome', [p('WiFi', 'bidirectional'), usbCPowerIn()]),
      iphone(),
      appleWatch(),
      // Apple Pencil Pro を吸着して充電する（M4 世代）
      g('iPad Pro 13', 'Tablet', [p('USB_C', 'bidirectional', 1, { label: '充電・データ' }), bt(), p('wirelessCharging', 'output', 1)], { powerUsage: 'rechargeable' }),
      g('Apple Pencil Pro', 'Accessory', [p('wirelessCharging', 'input', 1, { label: 'ワイヤレス給電' })], { powerUsage: 'rechargeable' }),
      charger('Anker Prime 250W', 4, 2),
      g('Belkin 3-in-1', 'Charger', [p('wirelessCharging', 'output', 3, { label: 'ワイヤレス出力' }), acIn()]),
      g('PlayStation 5', 'GameConsole', [
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('Ethernet', 'input', 1),
        p('USB_A', 'output', 2),
        acIn(),
      ], { consoleFormFactor: 'stationary' }),
      g('DualSense', 'Controller', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      routerWith(4),
      g('APC UPS', 'UPS', [p('Power', 'output', 6), p('Power', 'input', 1)]),
      powerStrip('10口タップ', 10, 1, 2),
      desk(),
      chair(),
      g('デスクマット', 'DeskPad', []),
      g('観葉植物', 'Plant', []),
    ],
  })

  // ═══════════════════════════════════════════════════════════
  // 日本のガジェット系デスクツアーから写した構成。
  // 上の 1〜14 は海外記事と「よくある構成」が中心で、日本のデスクツアーに
  // 特有の形（ノートPC のクラムシェル運用・USB-C 1本給電のモニター・
  // 複数PC を切替器で共有・充電ステーション主体）が手薄だった。
  // ═══════════════════════════════════════════════════════════

  // 15. むらお / Mac 2台と Windows 1台
  list.push({
    name: 'Mac2台+Windows1台（TS3 Plus 差し替え + USB切替ハブ）',
    source: 'note むらお「2025年デスクツアー！(Mac2台とWindows1台)」',
    sourceUrl: 'https://note.com/ymurao4/n/n8dc05ca0ad7f',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro (仕事用・クラムシェル)'),
      g('Mac Studio M1 Max', 'PC', [
        p('Thunderbolt', 'bidirectional', 4, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('Ethernet', 'input', 1),
        p('SDCard', 'input', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'macOS' }),
      g('自作ゲーミングPC (Windows)', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 6),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('CalDigit TS3 Plus', 'Dock', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Host / PD 87W' }),
        p('Thunderbolt', 'output', 1, { supportsVideo: true }),
        p('DisplayPort', 'output', 1, { supportsVideo: true }),
        p('USB_C', 'output', 1),
        p('USB_A', 'output', 5),
        p('Ethernet', 'input', 1),
        p('SDCard', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ]),
      // 2台のPCで周辺機器を共有する USB 切替器。ホスト側は USB-B が2口
      g('UGREEN USB3.0 スイッチングハブ', 'Hub', [
        p('USB_B', 'input', 2, { label: 'Host (PC切替)' }),
        p('USB_A', 'output', 4),
      ]),
      g('LG 40WP95C-W (39.7型 5K2K)', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'TB (映像 / PD 96W)' }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 3),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { monitorSizeInches: '40' }),
      g('Dell P3421W (34型 上段)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 4),
        acIn(),
      ]),
      g('Dell G2524H (24.5型 下段)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        acIn(),
      ]),
      g('Ergotron LX デュアル', 'MonitorArm', [p('MonitorArm', 'output', 2)]),
      g('YAMAHA AG03', 'Mixer', [
        p('XLR_TRS_Combo', 'input', 1),
        p('Audio6_3mm_TS', 'input', 1, { label: 'Guitar In' }),
        p('Audio6_3mm', 'output', 2, { label: 'Monitor Out' }),
        p('Audio6_3mm', 'output', 1, { label: 'Headphone' }),
        p('USB_C', 'input', 1, { label: 'PC接続' }),
        acIn(),
      ]),
      g('SHURE SM7dB', 'Microphone', [p('XLR', 'output', 1)]),
      g('Elgato Wave Mic Arm LP', 'MicArm', [p('MicArm', 'output', 1)]),
      g('SONY MDR-MV1', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      g('Audioengine A2+ (L)', 'Speaker', [
        p('Audio3_5mm', 'input', 1),
        p('RCA', 'input', 1),
        p('USB_B', 'input', 1),
        acIn(),
      ], { stereoPair: true, speakerInputSide: 'L' }),
      g('Elgato Stream Deck MK.2', 'SmallDevice', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('BenQ ScreenBar Halo', 'Light', [usbAPowerIn()]),
      g('Anker PowerConf C300', 'Webcam', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('REALFORCE GX1', 'Keyboard', [p('USB_C', 'input', 1, { label: '有線接続 (USB-C)' })]),
      dongleMouse('Logicool G PRO X SUPERLIGHT'),
      g('Magic Trackpad 2', 'Mouse', [bt(), p('Lightning', 'input', 1, { label: '充電' })], { powerUsage: 'rechargeable' }),
      g('Nintendo Switch', 'GameConsole', [
        p('USB_C', 'bidirectional', 1, { label: '充電・データ' }),
        p('Audio3_5mm', 'output', 1),
        bt(),
      ], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' }),
      powerStrip('エレコム 10口タップ ECT-1530BK', 10),
      g('FLEXISPOT E7', 'Desk', [acIn()], { isHeightAdjustable: true, deskLiftType: 'electric' }),
      g('エルゴヒューマン2', 'Chair', []),
    ],
  })

  // 16. デジスタ / クラムシェル + 5K 1枚 + TS4
  list.push({
    name: 'クラムシェル運用（MacBook Air + 5K 1枚 + TS4）',
    source: 'デジスタ「2025年版 デスクツアー！デスクシェルフと3Dプリントで進化した快適ワークスペース」',
    sourceUrl: 'https://digital-style.jp/desk-tour-2025',
    outletCount: 2,
    gadgets: [
      g('MacBook Air M3', 'PC', [
        p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true, supportsPowerDelivery: true }),
        p('Audio3_5mm', 'output', 1),
      ], { pcFormFactor: 'laptop', pcOs: 'macOS', pcThunderbolt: true }),
      caldigitTs4(),
      g('ASUS ProArt PA27JCV (27型 5K)', 'Monitor', [
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C (DP Alt / PD 96W)' }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        acIn(),
      ]),
      g('Logicool MX KEYS mini for Mac', 'Keyboard', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      // ERGO M575S は Logi Bolt レシーバー + 単三電池1本
      g('Logicool ERGO M575S', 'Mouse', [
        p('USB_A', 'input', 1, { label: 'Logi Bolt レシーバー', directAttach: true }),
        bt(),
        p('Battery', 'input', 1),
      ], { powerUsage: 'replaceable' }),
      g('Master&Dynamic MH40 Wireless', 'Headphone', [bt(), p('Audio3_5mm', 'input', 1), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      // micro-USB のUSBマイク。USB-C 全盛の構成に1台だけ古い端子が混じるケース
      g('EARTHWORKS ICON', 'Microphone', [p('microUSB', 'input', 1, { label: 'PC接続' })]),
      g('BenQ ScreenBar Halo 2', 'Light', [usbAPowerIn()]),
      // Qi2 でマグカップを温める台。AC で動き、ワイヤレス給電を出す
      g('CIO マグウォーマー2 (Qi2)', 'Other', [
        p('wirelessCharging', 'output', 1, { label: 'ワイヤレス出力' }),
        acIn(),
      ]),
      iphone(),
      powerStrip('電源タップ', 6),
      g('JSF COMPASS LEG DESK', 'Desk', []),
      g('コクヨ PALLO', 'Chair', []),
    ],
  })

  // 17. 25歳の壁 / ウルトラワイド + モバイルモニター + iPad 2台 + キーボード5台
  list.push({
    name: 'ノート1台の沼デスク（UW + モバイルモニター + キーボード5台）',
    source: '25歳の壁「デスクツアー2024｜ガジェット系YouTuberの超快適なデスク周り」',
    sourceUrl: 'https://25wall.com/2024/08/10/2024-desk-tour/',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 14 M1 Pro'),
      g('LG 38WP85C-W (37.5型 UW)', 'Monitor', [
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C (DP Alt / PD 90W)' }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 2),
        acIn(),
      ]),
      // モバイルモニターは USB-C 1本で映像も給電も受ける（AC 入力を持たない）
      g('Dell C1422H (14型 モバイル)', 'Monitor', [
        p('USB_C', 'input', 2, { supportsVideo: true, supportsPowerDelivery: true }),
      ]),
      g('エルゴトロン LX', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      g('SUNON モニターアーム', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      g('iPad Pro 11 (2018)', 'Tablet', [p('USB_C', 'bidirectional', 1, { label: '充電・データ' }), bt()], { powerUsage: 'rechargeable' }),
      g('iPad mini 6', 'Tablet', [p('USB_C', 'bidirectional', 1, { label: '充電・データ' }), bt()], { powerUsage: 'rechargeable' }),
      btKeyboard('Lofree FLOW スペースグレイ'),
      btKeyboard('Lofree FLOW シルバーホワイト'),
      btKeyboard('Logicool MX MECHANICAL MINI'),
      btKeyboard('HHKB Professional HYBRID Type-S 墨'),
      btKeyboard('Apple Magic Keyboard'),
      g('Apple Magic Mouse', 'Mouse', [bt(), p('Lightning', 'input', 1, { label: '充電' })], { powerUsage: 'rechargeable' }),
      g('Apple Magic Trackpad', 'Mouse', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('SHURE MV7', 'Microphone', [
        p('XLR', 'output', 1),
        p('microUSB', 'input', 1, { label: 'PC接続' }),
        p('Audio3_5mm', 'output', 1, { label: 'Headphone' }),
      ]),
      g('Alterzone マイクアーム', 'MicArm', [p('MicArm', 'output', 1)]),
      g('BenQ ScreenBar Halo', 'Light', [usbAPowerIn()]),
      charger('KOVOL 120W 4ポート充電器', 3, 1),
      g('Belkin 3-in-1 ワイヤレス充電スタンド', 'Charger', [
        p('wirelessCharging', 'output', 3, { label: 'ワイヤレス出力' }),
        acIn(),
      ]),
      iphone(),
      appleWatch(),
      powerStrip('Fargo スチール電源タップ', 4),
      g('FlexiSpot E7', 'Desk', [acIn()], { isHeightAdjustable: true, deskLiftType: 'electric' }),
      g('オカムラ シルフィー', 'Chair', []),
    ],
  })

  // 18. りさ / 自作PC + Mac 2台 + トリプル + プロジェクター
  list.push({
    name: 'エンジニア3PC（自作 + Mac2台 / トリプル + プロジェクター）',
    source: 'note りさ「【デスクツアー】2025年最新版｜愛用ガジェット全公開！エンジニア歴3年目のデスク環境」',
    sourceUrl: 'https://note.com/isi_r/n/n6e0b94e36dda',
    outletCount: 2,
    gadgets: [
      g('自作PC (i7-14700K / RTX 4070 Ti)', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 8),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('MacBook Air M4', 'PC', [
        p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true, supportsPowerDelivery: true }),
        p('Audio3_5mm', 'output', 1),
      ], { pcFormFactor: 'laptop', pcOs: 'macOS', pcThunderbolt: true }),
      macbookPro('MacBook Pro 14 M4 Pro (会社貸与)'),
      // 3画面出力する MST 対応ドック。ノートPC への給電も兼ねる
      g('GIISSMO 14-IN-2 ドッキングステーション', 'Dock', [
        p('USB_C', 'input', 2, { supportsVideo: true, supportsPowerDelivery: true, label: 'Host / PD 100W' }),
        p('HDMI', 'output', 2, { supportsVideo: true }),
        p('DisplayPort', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 4),
        p('USB_C', 'output', 1),
        p('Ethernet', 'input', 1),
        p('SDCard', 'input', 1),
        acIn(),
      ]),
      g('MSI Pro MP341CQW (34型 UWQHD)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        acIn(),
      ]),
      g('MSI MAG 274QRFW (27型 QHD)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true }),
        acIn(),
      ]),
      g('MSI MAG 274QRFW (27型 QHD 2枚目)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        acIn(),
      ]),
      // プロジェクターも「映像を受けて映す機器」なのでモニター扱いで登録する
      g('XGIMI Halo+ (プロジェクター)', 'Monitor', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('WiFi', 'bidirectional'),
        acIn(),
      ]),
      g('ERGOTRON LX (ウルトラワイド用)', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      g('ERGOTRON LX (デュアル用)', 'MonitorArm', [p('MonitorArm', 'output', 2)]),
      g('BenQ ScreenBar Pro', 'Light', [usbAPowerIn()]),
      btKeyboard('HHKB Professional HYBRID Type-S'),
      btKeyboard('Logicool MX KEYS mini'),
      btMouse('Logicool MX MASTER 3S (デスクトップ用)'),
      btMouse('Logicool MX MASTER 3S (MacBook用)'),
      btMouse('Logicool MX MASTER 3S (会社用)'),
      // サウンドバーは光デジタル / HDMI ARC。3.5mm を持たない
      g('SONY HT-S200F (サウンドバー)', 'Speaker', [
        p('OpticalAudio', 'input', 1),
        p('HDMI', 'input', 1),
        bt(),
        acIn(),
      ]),
      g('Razer Seiren V3 Mini', 'Microphone', [p('USB_C', 'input', 1, { label: 'PC接続' })]),
      g('Elgato Wave Mic Arm LP', 'MicArm', [p('MicArm', 'output', 1)]),
      g('Elgato Stream Deck +', 'SmallDevice', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('SwitchBot CO2センサー', 'SmartHome', [p('WiFi', 'bidirectional'), usbCPowerIn()]),
      routerWith(4),
      powerStrip('電源タップ 10口', 10, 0, 2),
      g('Flexispot E7 Pro', 'Desk', [acIn()], { isHeightAdjustable: true, deskLiftType: 'electric' }),
      g('Herman Miller アーロンチェア', 'Chair', []),
    ],
  })

  // 19. 4.5room / USB-C 1本のモニター + ハブ2段 + USB/XLR 兼用マイク
  list.push({
    name: 'ミニマル在宅（USB-C 1本モニター + ハブ2段）',
    source: 'note 4.5room「【デスクツアー】ガジェットに囲まれつつもミニマルに抑えたい社会人のデスクツアー｜2025版」',
    sourceUrl: 'https://note.com/4_5room/n/n7e4b09295971',
    outletCount: 2,
    gadgets: [
      g('MacBook Air', 'PC', [
        p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true, supportsPowerDelivery: true }),
        p('Audio3_5mm', 'output', 1),
      ], { pcFormFactor: 'laptop', pcOs: 'macOS', pcThunderbolt: true }),
      g('BenQ GW2785TC (27型 USB-C 60W)', 'Monitor', [
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C (DP Alt / PD 60W)' }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ]),
      g('エルゴトロン LX', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      g('UGREEN Revodok 105 (USB-C 5-in-1)', 'Hub', [
        p('USB_C', 'input', 1, { label: 'Host' }),
        p('USB_A', 'output', 3),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('SDCard', 'input', 1),
      ]),
      // ハブにさらにハブを挿す2段構成。上流が埋まったときの割り当てを見る
      g('ICZI USB3.0 4ポートハブ', 'Hub', [
        p('USB_A', 'input', 1, { label: 'Host' }),
        p('USB_A', 'output', 4),
      ]),
      g('UGREEN カードリーダー', 'Storage', [p('USB_A', 'input', 1, { label: 'PC接続' })]),
      g('EPOMAKER x Aula F75', 'Keyboard', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      btMouse('Logicool MX ERGO S'),
      // 左手デバイス（Bluetooth 接続のショートカットパッド）
      g('XP-Pen ACK05', 'SmallDevice', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      // USB でも XLR でも使えるマイク。オーディオIF が無いので USB で PC へ繋がるはず
      g('MAONO PD200X', 'Microphone', [
        p('XLR', 'output', 1),
        p('USB_C', 'input', 1, { label: 'PC接続' }),
        p('Audio3_5mm', 'output', 1, { label: 'Headphone' }),
      ]),
      g('MAONO BA92 マイクアーム', 'MicArm', [p('MicArm', 'output', 1)]),
      g('QCY H3PRO', 'Headphone', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('RORRY 4in1 充電ステーション', 'Charger', [
        p('wirelessCharging', 'output', 3, { label: 'ワイヤレス出力' }),
        p('USB_A', 'output', 1),
        acIn(),
      ]),
      iphone(),
      appleWatch(),
      powerStrip('エレコム ECT-1530BK (10口)', 10),
      g('Maidesite 電動昇降デスク', 'Desk', [acIn()], { isHeightAdjustable: true, deskLiftType: 'electric' }),
      g('SIHOO C300 Pro', 'Chair', []),
    ],
  })

  // 20. ドリキン / Thunderbolt オーディオIF + パワードモニタースピーカー
  list.push({
    name: '動画編集（Thunderbolt オーディオIF + Genelec）',
    source: 'note ドリキン「【随時更新】ドリキンYouTube機材紹介」',
    sourceUrl: 'https://note.com/drikin/n/n213d57184c72',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 16'),
      g('Dell UltraSharp UP2516D', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('MiniDisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 4),
        acIn(),
      ]),
      // Apollo Twin は Thunderbolt 接続。USB 接続のIFとは上流の取り方が変わる
      g('Universal Audio Apollo Twin', 'AudioInterface', [
        p('XLR_TRS_Combo', 'input', 2),
        p('Audio6_3mm_TS', 'input', 1, { label: 'Hi-Z' }),
        p('Audio6_3mm', 'output', 2, { label: 'Monitor Out' }),
        p('Audio6_3mm', 'output', 1, { label: 'Headphone' }),
        p('Thunderbolt', 'input', 1, { label: 'PC接続' }),
        acIn(),
      ]),
      g('Aston Microphones ORIGIN', 'Microphone', [p('XLR', 'output', 1)]),
      g('Sennheiser MKE 600', 'Microphone', [p('XLR', 'output', 1), p('Battery', 'input', 1)], { powerUsage: 'replaceable' }),
      g('Genelec G One (L)', 'Speaker', [p('RCA', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'L' }),
      g('Genelec G One (R)', 'Speaker', [p('RCA', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'R' }),
      g('Audio-Technica ATH-R70x', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      g('Neumann NDH 20', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      g('LaCie Rugged 5TB', 'Storage', [p('USB_C', 'input', 1)]),
      g('ProGrade Digital カードリーダー', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続' })]),
      g('Aputure 120D Mark 2', 'Light', [acIn()]),
      btKeyboard('Apple Magic Keyboard'),
      btMouse('Logicool MX Master'),
      powerStrip('電源タップ', 6),
      desk(),
      chair(),
    ],
  })

  // 21. DTM 入門（オーディオIF を買う前）
  // 電子ピアノ・MIDI鍵盤の PC 接続は今も USB-B が多い。オーディオIF を持たない
  // この段階で「PC と USB で繋がっているのにオーディオIF が無いと警告される」ことがあった
  list.push({
    name: 'DTM入門（電子ピアノ + PC のみ・オーディオIF なし）',
    source: '「DTM 始めました」系デスクツアーの初期構成（オーディオIF を買う前）',
    outletCount: 2,
    gadgets: [
      g('自作PC', 'PC', [
        p('DisplayPort', 'output', 2, { supportsVideo: true }),
        p('USB_A', 'output', 6),
        p('USB_C', 'output', 2),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('27型モニター', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        acIn(),
      ]),
      g('YAMAHA 電子ピアノ (LINE OUT + USB-B)', 'Instrument', [
        p('MIDI', 'output', 1),
        p('Audio6_3mm', 'output', 2, { label: 'LINE OUT' }),
        p('USB_B', 'input', 1, { label: 'PC接続' }),
        acIn(),
      ]),
      g('Roland A-49 MIDIキーボード', 'Instrument', [
        p('MIDI', 'output', 1),
        p('USB_B', 'input', 1, { label: 'PC接続' }),
      ]),
      g('SONY MDR-CD900ST', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      wiredKeyboard('Keychron K8'),
      btMouse('Logicool MX Master 3S'),
      powerStrip('電源タップ', 6),
      desk(),
      chair(),
    ],
  })

  // 22. デスクトップオーディオ（DAC + アンプ + パッシブスピーカー）
  // 追加した端子（同軸デジタル・4.4mm バランス・スピーカー端子）が正しい相手にしか
  // 繋がらないことを見る。互換表を緩めると、同軸がアナログRCAへ、4.4mm が
  // 6.3mm のヘッドホンへ繋がるようになるのでここが落ちる
  list.push({
    name: 'デスクトップオーディオ（DAC + アンプ + パッシブスピーカー）',
    source: 'FiiO 公式FAQ「K7の信号入力・出力方法」ほか、据置DAC＋パッシブSP の定番構成',
    sourceUrl: 'https://fiio.jp/faq/k7-input-output/',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 14'),
      g('FiiO K7', 'HeadphoneAmp', [
        p('USB_B', 'input', 1, { label: 'USB-B (PC接続)' }),
        p('OpticalAudio', 'input', 1),
        p('CoaxialAudio', 'input', 1),
        p('RCA', 'input', 2, { label: 'LINE IN' }),
        p('Audio6_3mm', 'output', 1, { label: '6.3mm ヘッドホン出力' }),
        p('Audio4_4mm', 'output', 1, { label: '4.4mm ヘッドホン出力' }),
        p('RCA', 'output', 2, { label: 'RCA ライン出力' }),
        p('DCPower', 'input', 1),
      ]),
      g('TOPPING PA5 II', 'Amplifier', [
        p('Audio6_3mm', 'input', 2, { label: 'TRS バランス入力' }),
        p('RCA', 'input', 2),
        p('SpeakerTerminal', 'output', 2),
        p('DCPower', 'input', 1),
      ]),
      g('DALI OBERON 1 (L)', 'Speaker', [p('SpeakerTerminal', 'input', 1)], { stereoPair: true, speakerInputSide: 'L' }),
      g('DALI OBERON 1 (R)', 'Speaker', [p('SpeakerTerminal', 'input', 1)], { stereoPair: true, speakerInputSide: 'R' }),
      // 4.4mm バランスのヘッドホン。6.3mm の口には物理的に挿さらない
      g('SENNHEISER HD 660S2 (4.4mm)', 'Headphone', [p('Audio4_4mm', 'input', 1)]),
      g('SONY MDR-CD900ST', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      btKeyboard('HHKB Professional HYBRID Type-S'),
      btMouse('Logicool MX Master 3S'),
      charger('Anker 735 Charger 65W', 2, 1),
      powerStrip('電源タップ', 6),
      desk(),
    ],
  })

  // 23. 液タブ・カードリーダー・TRS MIDI・micro-USB マイク
  // フォームで作れるようになった端子が、配線としても成立することを見る
  list.push({
    name: 'イラスト・映像（液タブ + CFexpress + TRS MIDI + micro-USB マイク）',
    source: 'イラスト／映像編集デスクツアーの頻出機材（液タブ・CFexpress リーダー・AIRA Compact）',
    outletCount: 2,
    gadgets: [
      g('自作PC', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 6),
        p('USB_C', 'output', 2),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('Dell U2723QE', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        acIn(),
      ]),
      // 液タブ：映像とペン入力の両方を PC から受ける
      g('Wacom Cintiq 16', 'PenTablet', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'input', 1, { label: 'PC接続' }),
        acIn(),
      ]),
      g('SanDisk Professional PRO-READER CFexpress', 'Storage', [
        p('USB_C', 'input', 1, { label: 'PC接続 (USB 3.2 Gen 2)' }),
        p('CFexpress', 'input', 1),
      ]),
      // micro-USB で PC に繋がる USB マイク
      g('EARTHWORKS ICON', 'Microphone', [p('microUSB', 'input', 1, { label: 'PC接続' })]),
      g('Elgato Wave Mic Arm LP', 'MicArm', [p('MicArm', 'output', 1)]),
      // 3.5mm TRS MIDI（Type A）で繋ぐ現行のシンセ
      g('Roland AIRA Compact T-8', 'Instrument', [
        p('MIDI_TRS', 'output', 1),
        p('Audio3_5mm', 'output', 1, { label: 'MIX OUT' }),
        usbCPowerIn(),
      ], { powerUsage: 'rechargeable' }),
      g('MOTU M2', 'AudioInterface', [
        p('XLR_TRS_Combo', 'input', 2),
        p('Audio6_3mm', 'output', 2, { label: 'Monitor Out' }),
        p('Audio6_3mm', 'output', 1, { label: 'Headphone' }),
        p('MIDI_TRS', 'input', 1),
        p('USB_C', 'input', 1, { label: 'PC接続' }),
      ]),
      g('YAMAHA HS5 (L)', 'Speaker', [p('XLR', 'input', 1), p('Audio6_3mm', 'input', 1), acIn()], { stereoPair: true, speakerInputSide: 'L' }),
      // リケーブルで 4.4mm と 6.3mm の両方が使えるヘッドホン。
      // 入力端子を優先度の1つ目で決め打ちすると「4.4mm の相手がいない」だけで
      // 1本も線が引かれなくなるので、6.3mm へ落ちることを確かめる
      g('SENNHEISER HD 660S2 (4.4mm / 6.3mm)', 'Headphone', [
        p('Audio4_4mm', 'input', 1),
        p('Audio6_3mm', 'input', 1),
      ]),
      wiredKeyboard('Keychron Q1'),
      btMouse('Logicool MX Master 3S'),
      charger('Anker 735 Charger 65W', 2, 1),
      powerStrip('電源タップ', 8),
      desk(),
    ],
  })


  // 24. HikakinGames のゲーミングデスク（ゲーム用と配信用の2PC）
  // ゲーム用PC の映像がキャプチャを通って配信用PC とモニターの両方へ届くかを見る。
  // キャプチャは HDMI が入って出る中継機なので、映像の源が足りないときに
  // 黙って浮くのではなく警告として出ることも合わせて確かめる
  list.push({
    name: 'ゲーミング2PC配信（キャプチャ4台 + 4K240 モニター3枚）',
    source: 'HikakinTV「動画作りに課金しすぎた男の末路」ゲーミングデスク',
    sourceUrl: 'https://www.youtube.com/watch?v=0dz-e5UtO5o',
    outletCount: 2,
    gadgets: [
      g('Alienware Aurora (ゲーム用)', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 8),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows', pcCpu: 'Core Ultra 9 285K', pcGpu: 'GeForce RTX 5090' }),
      g('GALLERIA (配信用)', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 8),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows', pcCpu: 'Core Ultra 9 285K', pcGpu: 'GeForce RTX 5090' }),
      g('Alienware AW2725Q (左)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        acIn(),
      ]),
      g('Alienware AW2725Q (中央)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        acIn(),
      ]),
      g('Alienware AW2725Q (右)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        acIn(),
      ]),
      g('AVerMedia Live Gamer 4K (1)', 'CaptureDevice', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { label: 'USB-C (PC 接続)' }),
      ]),
      g('AVerMedia Live Gamer 4K (2)', 'CaptureDevice', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { label: 'USB-C (PC 接続)' }),
      ]),
      g('AVerMedia Live Gamer 4K (3)', 'CaptureDevice', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { label: 'USB-C (PC 接続)' }),
      ]),
      g('AVerMedia Live Gamer 4K (4)', 'CaptureDevice', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { label: 'USB-C (PC 接続)' }),
      ]),
      // ガンマイク。3.5mm も持つが、コンボジャックのある AG03 へは XLR で入るのが正解
      g('Sennheiser MKE 600', 'Microphone', [
        p('XLR', 'output', 1),
        p('Audio3_5mm', 'output', 1),
      ]),
      g('YAMAHA AG03MK2', 'AudioInterface', [
        p('XLR_TRS_Combo', 'input', 1),
        p('Audio6_3mm', 'input', 1, { label: 'LINE / GUITAR' }),
        p('Audio3_5mm', 'input', 1, { label: 'AUX' }),
        p('Audio6_3mm', 'output', 2, { label: 'MONITOR OUT' }),
        p('Audio6_3mm', 'output', 1, { label: 'PHONES' }),
        p('USB_C', 'input', 1, { label: 'PC接続' }),
      ]),
      wiredKeyboard('SteelSeries Apex Pro'),
      g('超軽量有線マウス', 'Mouse', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('Logicool ゲーミングマウスパッド', 'MousePad', []),
      g('Nintendo Switch 2', 'GameConsole', [
        p('USB_C', 'bidirectional', 1, { label: '充電・データ' }),
        bt(),
      ], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' }),
      g('Nintendo Switch 2 ドック', 'Dock', [
        p('USB_C', 'bidirectional', 1, { label: 'USB-C (本体接続)' }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        p('Ethernet', 'input', 1),
        acIn(),
      ]),
      g('Switch 2 Proコントローラー', 'Controller', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('Nintendo Switch 2 カメラ', 'Webcam', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('Philips Hue ブリッジ', 'SmartHome', [p('Ethernet', 'input', 1), acIn()]),
      g('Bauhutte ダブルモニターアーム', 'MonitorArm', [p('MonitorArm', 'output', 2)]),
      g('Google Pixel 10 Pro', 'Smartphone', [
        p('USB_C', 'bidirectional', 1, { label: '充電・データ' }),
        p('wirelessCharging', 'input', 1, { label: 'ワイヤレス給電' }),
        bt(),
      ], { powerUsage: 'rechargeable' }),
      g('iPad mini (コメント確認用)', 'Tablet', [
        p('USB_C', 'bidirectional', 1, { label: '充電・データ' }),
        bt(),
      ], { powerUsage: 'rechargeable' }),
      routerWith(4),
      powerStrip('電源タップ 10口', 10, 0, 2),
      desk(),
      chair(),
    ],
  })

  // 25. 同じ動画の動画編集デスク（Mac Studio 2台 + XDR / Studio Display）
  // ホストが2台あって外部ディスプレイが2枚しかない構成で、どちらの Mac が
  // どの画面を取るか。ポータブル SSD をまとめて挿すハブの口の食い合いも見る。
  // HS4 は左だけがアンプを持ち、右はスピーカーケーブルで左からもらう形
  list.push({
    name: 'Mac Studio 2台の動画編集デスク（XDR + Studio Display）',
    source: 'HikakinTV「動画作りに課金しすぎた男の末路」動画編集デスク',
    sourceUrl: 'https://www.youtube.com/watch?v=0dz-e5UtO5o',
    outletCount: 2,
    gadgets: [
      g('Mac Studio M3 Ultra (1)', 'PC', [
        p('Thunderbolt', 'bidirectional', 6, { supportsVideo: true, supportsPowerDelivery: true }),
        p('USB_A', 'output', 2),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('Ethernet', 'input', 1),
        p('SDCard', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'macOS', pcThunderbolt: true, pcRam: '512GB', pcStorage: '16TB SSD' }),
      g('Mac Studio M3 Ultra (2)', 'PC', [
        p('Thunderbolt', 'bidirectional', 6, { supportsVideo: true, supportsPowerDelivery: true }),
        p('USB_A', 'output', 2),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('Ethernet', 'input', 1),
        p('SDCard', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'macOS', pcThunderbolt: true, pcRam: '512GB', pcStorage: '16TB SSD' }),
      g('MacBook Air 15', 'PC', [
        p('Thunderbolt', 'bidirectional', 2, { supportsVideo: true, supportsPowerDelivery: true }),
        p('Audio3_5mm', 'output', 1),
      ], { pcFormFactor: 'laptop', pcOs: 'macOS', pcThunderbolt: true }),
      g('Apple Pro Display XDR', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Host / PD 96W' }),
        p('USB_C', 'output', 3),
        acIn(),
      ]),
      g('Apple Studio Display', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Host / PD 96W' }),
        p('USB_C', 'output', 3),
        acIn(),
      ]),
      btKeyboard('Magic Keyboard (Touch ID)'),
      btMouse('Magic Mouse'),
      g('Magic Trackpad', 'Mouse', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      // HS4 は左にアンプが入っていて、右へはスピーカーケーブルで送る
      g('YAMAHA HS4 (L)', 'Speaker', [
        p('RCA', 'input', 2),
        p('Audio6_3mm', 'input', 2, { label: 'TRS' }),
        p('SpeakerTerminal', 'output', 1),
        acIn(),
      ], { stereoPair: true, speakerInputSide: 'L' }),
      g('YAMAHA HS4 (R)', 'Speaker', [
        p('SpeakerTerminal', 'input', 1),
      ], { stereoPair: true, speakerInputSide: 'R' }),
      g('Shure MV6 (USB-C マイク)', 'Microphone', [
        p('USB_C', 'input', 1, { label: 'PC接続' }),
        p('Audio3_5mm', 'output', 1, { label: 'モニター出力' }),
      ]),
      g('L字マイクアーム', 'MicArm', [p('MicArm', 'output', 1)]),
      g('Anker USB-C ドッキングステーション', 'Dock', [
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Host / PD 85W' }),
        p('HDMI', 'output', 2, { supportsVideo: true }),
        p('USB_C', 'output', 2),
        p('USB_A', 'output', 5),
        p('Ethernet', 'input', 1),
        p('SDCard', 'input', 1),
        p('microSDCard', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ]),
      g('SanDisk ポータブルSSD 4TB (1)', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続' })]),
      g('SanDisk ポータブルSSD 4TB (2)', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続' })]),
      g('SanDisk ポータブルSSD 4TB (3)', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続' })]),
      g('SanDisk ポータブルSSD 8TB (4)', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続' })]),
      g('SanDisk ポータブルSSD 8TB (5)', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続' })]),
      g('SanDisk ポータブルSSD 8TB (6)', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続' })]),
      iphone('iPhone 17 Pro Max'),
      g('AirPods Pro 3', 'Earphone', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('EarPods (USB-C)', 'Earphone', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('Sony α7V', 'Webcam', [p('HDMI', 'output', 1, { supportsVideo: true }), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('DJI Mic 3', 'Microphone', [p('Audio3_5mm', 'output', 1), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('Insta360 X5', 'SmallDevice', [usbCPowerIn()], { powerUsage: 'rechargeable' }),
      charger('Anker 3-in-1 充電器', 2, 1, 1),
      g('Anker PowerBank 25000mAh', 'MobileBattery', [
        p('USB_C', 'output', 2),
        p('USB_A', 'output', 1),
        p('USB_C', 'input', 1, { label: '給電 (C)' }),
      ], { powerUsage: 'rechargeable' }),
      g('De’Longhi エレッタ エクスプロア', 'Other', [acIn()]),
      routerWith(4),
      powerStrip('電源タップ 10口', 10, 0, 2),
      desk(),
      g('Herman Miller アーロンチェア', 'Chair', []),
    ],
  })

  // 26. 3畳書斎の2025年版（XLR インライン機器 + ネットワークスピーカー）
  // #2 と同じデスクの別バージョン。見どころは2つで、どちらも母集団に無かった形。
  //   ・SM7B → FetHead（インラインプリアンプ）→ スプリッター → M2 という XLR の直列
  //   ・KEF LSX II LT のように、オーディオIF の出口（RCA・6.3mm）と噛み合わない
  //     入力しか持たないアクティブスピーカー。左右はスピーカー間ケーブルで結ぶ
  list.push({
    name: '3畳書斎 2025（XLR インライン機器 + ネットワークスピーカー）',
    source: 'YouTube【2025年】３畳書斎デスクツアー！愛用中のデスク周りガジェット・収納など',
    sourceUrl: 'https://www.youtube.com/watch?v=PIhcwBZV5BE',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 14 M1 Max'),
      g('Dell U4021QW (40型 ウルトラワイド)', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'TB (映像 / PD 90W)' }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'output', 5),
        p('USB_C', 'output', 1),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1, { label: 'ライン出力' }),
        acIn(),
      ]),
      g('COFO 無重力モニターアーム', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      g('tech デック PCスタンド', 'Accessory', []),
      // ── マイクの直列。SM7B は出力が小さいので、インラインプリアンプで持ち上げてから
      //    スプリッターで2系統に分け、片方が M2 へ入る
      g('SHURE SM7B', 'Microphone', [p('XLR', 'output', 1)]),
      g('Triton Audio FetHead (インラインプリアンプ)', 'Other', [
        p('XLR', 'input', 1),
        p('XLR', 'output', 1),
      ]),
      g('ART マイクスプリッター', 'Other', [
        p('XLR', 'input', 1),
        p('XLR', 'output', 2),
      ]),
      g('Elgato Wave Mic Arm LP', 'MicArm', [p('MicArm', 'output', 1)]),
      g('MOTU M2', 'AudioInterface', [
        p('XLR_TRS_Combo', 'input', 2),
        p('Audio6_3mm', 'output', 2, { label: 'Monitor Out' }),
        p('RCA', 'output', 2),
        p('Audio6_3mm', 'output', 1, { label: 'Headphone' }),
        p('MIDI', 'input', 1),
        p('MIDI', 'output', 1),
        p('USB_C', 'input', 1, { label: 'PC接続 / バスパワー' }),
      ]),
      // KEF LSX II LT は USB-C・光・HDMI ARC・Ethernet で受ける。RCA も 6.3mm も無いので、
      // オーディオIF の出口とは噛み合わず PC 側から鳴らすことになる。
      // 左右はスピーカー間の Ethernet ケーブルで結ぶ（主側だけが入力を持つ）
      g('KEF LSX II LT (L / 主)', 'Speaker', [
        p('USB_C', 'input', 1, { label: 'PC接続' }),
        p('OpticalAudio', 'input', 1),
        p('HDMI', 'input', 1, { label: 'HDMI ARC' }),
        p('Ethernet', 'input', 1),
        p('Ethernet', 'output', 1, { label: 'スピーカー間接続' }),
        acIn(),
      ], { stereoPair: true, speakerInputSide: 'L' }),
      g('KEF LSX II LT (R / 従)', 'Speaker', [
        p('Ethernet', 'input', 1, { label: 'スピーカー間接続' }),
        acIn(),
      ], { stereoPair: true, speakerInputSide: 'R' }),
      g('CLASSIC PRO MST3 スピーカースタンド', 'Furniture', []),
      g('audio-technica ATH-R70x', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      g('Shure AONIC 50 Gen 2', 'Headphone', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('audio-technica ATH-HL7BT', 'Headphone', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('HHKB Professional HYBRID Type-S (US)', 'Keyboard', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('Grovemade リストレスト', 'Accessory', []),
      btMouse('Logicool MX ERGO S'),
      g('EPOMAKER EK21 テンキー', 'Keyboard', [p('USB_C', 'input', 1, { label: '有線接続 (USB-C)' })]),
      g('TourBox Elite', 'SmallDevice', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('目線が合う Webカメラ', 'Webcam', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('BenQ ScreenBar Halo', 'Light', [usbAPowerIn()]),
      g('Grovemade デスクシェルフ', 'Furniture', []),
      // ── 壁面・収納側。電池駆動のセンサーは配線を持たない
      g('スチール有効ボード 80x150', 'WallPanel', []),
      g('山崎実業 ウォールラック', 'Furniture', []),
      g('SwitchBot 人感センサー', 'SmartHome', [bt()], { powerUsage: 'replaceable' }),
      g('SwitchBot CO2センサー (温湿度計)', 'SmartHome', [bt()], { powerUsage: 'replaceable' }),
      g('SwitchBot 開閉センサー', 'SmartHome', [bt()], { powerUsage: 'replaceable' }),
      g('SwitchBot 電球', 'Light', [p('WiFi', 'input', 1)]),
      g('充電式 人感センサーライト', 'Light', [usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('HOKUTO 防湿庫', 'Other', [acIn()]),
      g('EPSON プリンター', 'Printer', [
        p('WiFi', 'input', 1),
        p('USB_B', 'input', 1),
        acIn(),
      ]),
      g('Ulanzi エアダスター', 'SmallDevice', [usbCPowerIn()], { powerUsage: 'rechargeable' }),
      charger('UGREEN 100W 薄型充電器', 2, 1),
      iphone(),
      g('快適ワーク フットレスト', 'Furniture', []),
      routerWith(4),
      powerStrip('デスク下 電源タップ', 8),
      powerStrip('FARGO 見せる電源タップ (ロッカー)', 6),
      desk(),
      chair(),
    ],
  })

  // 27. 効率最優先の「カオス作業環境」（左手デバイス多数 + 電源タップ4台）
  // 見どころは3つ。
  //   ・Bluetooth トランスミッター（BT の送り出しを持つのが PC・ハブ以外）
  //   ・簡易NAS として置いてあるミニPC。画面を持たない2台目の PC が
  //     モニターを1枚取ってしまわないか（PC台数分の確保を入れた直後の回帰）
  //   ・ハブ・電源タップが多段になる高密度構成
  list.push({
    name: 'カオス作業環境（液タブ + 左手デバイス多数 + 電源タップ4台）',
    source: 'YouTube【地獄のデスクツアー2025】おしゃれさ全捨て、効率最優先の「カオス作業環境」',
    sourceUrl: 'https://www.youtube.com/watch?v=r6V86-BGIt4',
    outletCount: 4,
    gadgets: [
      g('自作メインPC (i9 / RTX 4090)', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 8),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows', pcCpu: 'Core i9', pcGpu: 'GeForce RTX 4090' }),
      // 簡易NAS。画面もキーボードも繋がない使い方をしている
      g('Lenovo IdeaCentre Mini Gen 8 (簡易NAS)', 'PC', [
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('DisplayPort', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 4),
        p('USB_C', 'output', 1),
        p('Ethernet', 'input', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      g('Kuycon G27X (27型 5K)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('USB_A', 'output', 2),
        acIn(),
      ]),
      g('Dell U2723QE (27型 4K)', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('USB_B', 'input', 1),
        p('USB_A', 'output', 4),
        p('Ethernet', 'input', 1),
        acIn(),
      ]),
      g('iiKUN 27T1U (27型 4K)', 'Monitor', [
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        acIn(),
      ]),
      g('HUION Kamvas Pro 24 (4K 液タブ)', 'PenTablet', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'input', 1, { label: 'PC接続' }),
        acIn(),
      ]),
      g('エルゴトロン LX', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      g('HUANUO HNDS8 (2台)', 'MonitorArm', [p('MonitorArm', 'output', 2)]),
      // ── 音まわり。スピーカーは無く、据置アンプ有線とワイヤレスの2系統
      g('FiiO K9 Pro ESS', 'HeadphoneAmp', [
        p('USB_B', 'input', 1, { label: 'USB-B (PC接続)' }),
        p('OpticalAudio', 'input', 1),
        p('CoaxialAudio', 'input', 1),
        p('RCA', 'input', 2, { label: 'LINE IN' }),
        p('Audio6_3mm', 'output', 1, { label: '6.3mm ヘッドホン出力' }),
        p('Audio4_4mm', 'output', 1, { label: '4.4mm ヘッドホン出力' }),
        p('XLR4pin', 'output', 1, { label: 'XLR 4pin ヘッドホン出力' }),
        p('RCA', 'output', 2, { label: 'RCA ライン出力' }),
        acIn(),
      ]),
      g('Sony MDR-CD900ST', 'Headphone', [p('Audio6_3mm', 'input', 1)]),
      // aptX LL のトランスミッター。Bluetooth を送り出すのが PC でもハブでもない
      g('Sennheiser BTT100 (BTトランスミッター)', 'Other', [
        p('Audio3_5mm', 'input', 1),
        p('USB_C', 'input', 1, { label: 'PC接続 / 給電' }),
        p('Bluetooth', 'output', 1),
      ]),
      g('Sennheiser HD 350BT', 'Headphone', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      // ── 入力デバイス
      wiredKeyboard('Razer Huntsman Mini'),
      wiredKeyboard('yo-ID42 (40%)'),
      g('Keykobo KIKU 90 (テンキーパッド)', 'Keyboard', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('Razer Naga Left-Handed Edition', 'Mouse', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('FILCO ウッドリストレスト S', 'Accessory', []),
      g('DaVinci Resolve Speed Editor', 'SmallDevice', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('XP-Pen ACK05', 'SmallDevice', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('Behringer X-TOUCH MINI', 'Controller', [p('USB_B', 'input', 1, { label: 'PC接続' })]),
      g('Elgato Stream Deck XL', 'SmallDevice', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      g('富士通 QUADERNO A4 Gen 2', 'Tablet', [
        p('USB_C', 'bidirectional', 1, { label: '充電・データ' }),
        bt(),
      ], { powerUsage: 'rechargeable' }),
      // ── ハブ・ストレージ・キャプチャ
      g('UGREEN 7ポート USBハブ', 'Hub', [
        p('USB_A', 'input', 1, { label: 'PC接続' }),
        p('USB_A', 'output', 7),
      ]),
      g('ORICO セルフパワーUSBハブ (PD 65W)', 'Hub', [
        p('USB_C', 'input', 1, { label: 'PC接続' }),
        p('USB_A', 'output', 4),
        p('USB_C', 'output', 2, { supportsPowerDelivery: true }),
        acIn(),
      ]),
      g('ORICO 5台用 HDDドッキングステーション', 'Storage', [
        p('USB_C', 'input', 1, { label: 'PC接続' }),
        acIn(),
      ]),
      g('SanDisk ポータブルSSD 4TB', 'Storage', [p('USB_C', 'input', 1, { label: 'PC接続' })]),
      g('Elgato Cam Link 4K', 'CaptureDevice', [
        p('HDMI', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'input', 1, { label: 'USB-A (PC 接続)', directAttach: true }),
      ]),
      g('iPhone 6 (映り込み確認用)', 'Smartphone', [
        p('Lightning', 'bidirectional', 1, { label: '充電・データ' }),
        bt(),
      ], { powerUsage: 'rechargeable' }),
      // ── ネットワーク・スマートホーム・照明
      g('TP-Link Archer BE900', 'Router', [
        p('Ethernet', 'input', 1, { label: 'WAN' }),
        p('Ethernet', 'output', 4, { label: 'LAN' }),
        p('WiFi', 'bidirectional'),
        acIn(),
      ]),
      g('SwitchBot ハブ2', 'SmartHome', [p('WiFi', 'bidirectional'), usbCPowerIn()]),
      g('SwitchBot CO2センサー', 'SmartHome', [bt()], { powerUsage: 'replaceable' }),
      g('SwitchBot ボット', 'SmartHome', [bt()], { powerUsage: 'replaceable' }),
      g('REVEX XPN4000 受信機', 'SmallDevice', [acIn()]),
      g('BenQ ScreenBar Pro', 'Light', [usbAPowerIn()]),
      g('NEEWER 120c (120W ライト)', 'Light', [acIn()]),
      g('ELPA スポットライト CR40BK', 'Light', [acIn()]),
      g('パナソニック パネルヒーター', 'Other', [acIn()]),
      // ── 電源。タップが4台あり、卓上充電器もぶら下がる
      charger('Anker Prime Charger 250W 6ポート', 4, 2),
      powerStrip('エレコム 10個口タップ (1)', 10),
      powerStrip('エレコム 10個口タップ (2)', 10),
      powerStrip('コクヨ エナジーライン', 6),
      powerStrip('TOROTSUKU ハードコアボックス', 4),
      g('無印良品 キャビネット', 'Furniture', []),
      g('山崎実業 マグネットティッシュケース', 'Accessory', []),
      g('FlexiSpot E7Q', 'Desk', [acIn()], { isHeightAdjustable: true, deskLiftType: 'electric' }),
      g('内田洋行 ETOS CRSG-1600N', 'Chair', []),
    ],
  })

  // 28. Grovemade Desk のミニマル書斎（ノートPC2台 + iPad を3枚目の画面にする）
  // 見どころは3つ。
  //   ・iPad を Duet Display でサブサブモニターにする（Tablet が周辺機器と
  //     映像の送り先を兼ねる。二重に線が引かれないか）
  //   ・PC が2台とも内蔵画面を持つノート。画面の確保ルールが発火しないことの回帰
  //   ・トラックボール内蔵の無線分割キーボードだけで、マウスが1台も無い
  list.push({
    name: 'Grovemade Desk のミニマル書斎（ノート2台 + iPad をサブ画面）',
    source: 'YouTube 理想の書斎づくり「【Grovemade Desk】書斎づくり歴5年の末路（デスクツアー）」',
    sourceUrl: 'https://youtu.be/wJ4eIvSzQlA',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 14 M1 Max'),
      g('GPD Pocket 4', 'PC', [
        p('USB_C', 'bidirectional', 2, { supportsVideo: true, supportsPowerDelivery: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 1),
      ], { pcFormFactor: 'laptop', pcOs: 'Windows' }),
      // Duet Display で3枚目の画面にする。映像を受けられる USB-C を持つので
      // 映像の送り先（tabletDisplays）にも周辺機器にもなりうる
      g('M4 iPad Pro 11', 'Tablet', [
        p('USB_C', 'bidirectional', 1, { supportsVideo: true, label: '充電・データ・映像' }),
        bt(),
      ], { powerUsage: 'rechargeable' }),
      g('Apple Studio Display (Nano-texture)', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Host / PD 96W' }),
        p('USB_C', 'output', 3),
        acIn(),
      ]),
      g('16インチ 4K 有機EL モバイルディスプレイ (縦置き)', 'Monitor', [
        p('USB_C', 'input', 2, { supportsVideo: true, supportsPowerDelivery: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
      ]),
      caldigitTs4(),
      // 無線分割キーボード。トラックボール内蔵なのでマウスは1台も無い
      g('MO-NA2 (無線分割・トラックボール付き)', 'Keyboard', [
        bt(),
        usbCPowerIn(),
      ], { splitKeyboard: true, powerUsage: 'rechargeable' }),
      g('エルゴトロン 長芯ポール (58cm)', 'MonitorArm', [p('MonitorArm', 'output', 2)]),
      g('Artemide Tolomeo', 'Light', [acIn()]),
      // Tolomeo に入れているスマート電球。ソケット給電なので自前の電源線は持たない
      g('Philips Hue スマート電球', 'Light', [p('Bluetooth', 'output', 1)]),
      g('Herman Miller エンボディチェア', 'Chair', []),
      g('Atlas ヘッドレスト', 'Accessory', []),
      // 天板と収納。電動昇降ではないので電源を持たない
      g('Grovemade Desk', 'Desk', [], { isHeightAdjustable: false }),
      g('メガリドロワー', 'Furniture', []),
      g('ケーブルトラフ', 'Accessory', []),
      g('Grovemade Studio Pad', 'DeskPad', []),
      g('ケーブルプーリー (自作)', 'Accessory', []),
      powerStrip('電源タップ', 6),
    ],
  })

  // 29. デスクトップPC + Thunderbolt ドック（配線本数を絞る構成）
  // これまでのドック構成はすべてノートPC だった。デスクトップは自前で AC を取るので
  // ドックからの PD 給電が要らず、ノートとは前提が違う。
  // 映像もメインモニターだけ PC 直結の DP で、残りはドック経由という2系統に分かれる。
  // 電源タップはモニター裏（VESA プレート）とデスク裏の2台に分散している
  list.push({
    name: 'デスクトップPC + TB4 ドック（配線2本に集約）',
    source: 'YouTube アライ「【配線整理】2026年になる前にデスク周りを綺麗にしよう！」',
    sourceUrl: 'https://youtu.be/PwVgnAVOfgI',
    outletCount: 2,
    gadgets: [
      g('WindowsデスクトップPC (シェルフ内)', 'PC', [
        p('Thunderbolt', 'bidirectional', 1, { supportsVideo: true }),
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 6),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows', pcThunderbolt: true }),
      g('UGREEN Revodok Max 213 (TB4 ドック)', 'Dock', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Host / PD 96W' }),
        p('Thunderbolt', 'output', 1, { supportsVideo: true }),
        p('DisplayPort', 'output', 1, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_C', 'output', 2),
        p('USB_A', 'output', 3),
        p('Ethernet', 'input', 1),
        p('SDCard', 'input', 1),
        p('microSDCard', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ]),
      g('27インチ メインモニター', 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_C', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('USB_A', 'output', 2),
        acIn(),
      ]),
      // モバイルモニターは AC を持たず、USB-C 1本で映像も給電も受ける
      g('16インチ モバイルモニター', 'Monitor', [
        p('USB_C', 'input', 2, { supportsVideo: true, supportsPowerDelivery: true }),
        p('HDMI', 'input', 1, { supportsVideo: true }),
      ]),
      g('14インチ 液タブ', 'PenTablet', [
        p('USB_C', 'input', 1, { supportsVideo: true, label: 'USB-C (映像・データ・給電)' }),
      ]),
      g('エルゴトロン LX Pro', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      g('長尾製作所 VESAプレート', 'Accessory', []),
      // 無線に寄せた入力デバイス。有線は1本も出さない
      g('左右分割キーボード', 'Keyboard', [bt(), usbCPowerIn()], { splitKeyboard: true, powerUsage: 'rechargeable' }),
      btMouse('トラックボール'),
      g('左手デバイス', 'SmallDevice', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      iphone(),
      // タップ2台。1台はモニター裏の VESA プレートに、1台はデスク裏に貼り付けている
      powerStrip('エレコム コンパクト電源タップ (モニター裏)', 4),
      powerStrip('Anker Nano Charging Station 6-in-1 67W', 2, 3, 1),
      g('Mavica マグネットケーブルクリップ', 'Accessory', []),
      g('ケーブルスリーブ (3Dプリント自作)', 'Accessory', []),
      g('デスク横シェルフ', 'Furniture', []),
      desk(),
      chair(),
    ],
  })

  // 30. クラムシェル＋ハブモニター1枚（充電器が無く、給電はモニターの PD だけ）
  // #2 と同じデスクの別バージョン。機材はほぼ重なるが、この構成にだけある条件が
  // 「充電器も USB 付きタップも無く、ノートPC の給電元がモニターの PD 90W しかない」。
  // 第20項でノートPC の給電判定と警告文を触ったので、その回帰として残す
  list.push({
    name: 'クラムシェル＋ハブモニター（給電はモニターの PD のみ）',
    source: 'YouTube ツヨシ|techyou「【デスクツアー】37歳フリーランスのデスク周りとおすすめガジェット紹介！」',
    sourceUrl: 'https://youtu.be/VKVruZPzVs8',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 14 M1 Max'),
      // ドックを使わず、このモニターがハブと給電を兼ねる
      g('Dell U4021QW (40型 5K2K)', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'TB (映像 / PD 90W)' }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('USB_A', 'output', 5),
        p('USB_C', 'output', 1),
        p('Ethernet', 'input', 1),
        p('SDCard', 'input', 1),
        p('Audio3_5mm', 'output', 1, { label: 'ライン出力' }),
        acIn(),
      ]),
      g('エルゴトロン HX', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      g('techyou デスク＆PCスタンド', 'Accessory', []),
      g('HHKB Professional HYBRID Type-S (US)', 'Keyboard', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      btMouse('ロジクール MX ERGO'),
      g('TourBox Elite', 'SmallDevice', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('Skyloong テンキー', 'Keyboard', [p('USB_C', 'input', 1, { label: '有線接続 (USB-C)' })]),
      g('ウールデスクマット', 'DeskPad', []),
      g('BenQ ScreenBar Halo', 'Light', [usbAPowerIn()]),
      g('Anker PowerConf C200', 'Webcam', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('SHURE SM7B', 'Microphone', [p('XLR', 'output', 1)]),
      g('MOTU M2', 'AudioInterface', [
        p('XLR_TRS_Combo', 'input', 2),
        p('Audio6_3mm', 'output', 2, { label: 'Monitor Out' }),
        p('RCA', 'output', 2),
        p('Audio6_3mm', 'output', 1, { label: 'Headphone' }),
        p('USB_C', 'input', 1, { label: 'PC接続 / バスパワー' }),
      ]),
      g('Elgato Wave Mic Arm LP', 'MicArm', [p('MicArm', 'output', 1)]),
      // 充電器も USB 付きタップも無い。ノートPC の給電元はモニターの PD だけ
      powerStrip('電源タップ', 6),
      desk(),
      g('COFO Chair Premium', 'Chair', []),
    ],
  })

  // 31. 森のなかの作業部屋（飾りのレトロゲーム機 + サイネージ1枚）
  // 母集団で初めて `displayOnly`（飾り）を使う構成。通電も配線もしない置物として
  // レトロゲーム機を並べている。エンジンは配線対象から外し、レイアウトは
  // 個別ノードではなく「飾り」枠へまとめる実装があるのに、監査で一度も踏んでいなかった。
  // 飾りに線も警告も付かないこと、飾りでない同種の機器は従来どおり充電されることを見る
  list.push({
    name: '森のなかの作業部屋（飾りのレトロゲーム機 + サイネージ1枚）',
    source: 'YouTube トバログ「【ルームツアー】森のなかの作業部屋。映像作家のデスク周りと仕事道具たち」',
    sourceUrl: 'https://www.youtube.com/watch?v=qDYNcFzYV68',
    outletCount: 2,
    gadgets: [
      g('自作タワーPC (CG用 / RTX 2080 Ti)', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 6),
        p('USB_C', 'output', 1),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows', pcGpu: 'GeForce RTX 2080 Ti', pcRam: '128GB' }),
      // 持ち運び用。デスクではリモートデスクトップで母艦に入るので有線では繋がない
      macbookPro('MacBook Pro (持ち運び用)'),
      g('ソニー 大型サイネージディスプレイ', 'Monitor', [
        p('HDMI', 'input', 4, { supportsVideo: true }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        acIn(),
      ]),
      wiredKeyboard('Keychron フルサイズ (自宅用)'),
      g('Keychron フルサイズ (持ち出し用)', 'Keyboard', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      btMouse('ワイヤレスマウス'),
      g('TourBox Elite', 'SmallDevice', [bt(), usbCPowerIn()], { powerUsage: 'rechargeable' }),
      // 実際に遊ぶ携帯機。飾りではないので充電の線が引かれる
      g('Analogue Pocket', 'GameConsole', [
        p('USB_C', 'bidirectional', 1, { label: '充電・データ' }),
      ], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable' }),
      // ここから下は飾り。端子は持っているが通電も配線もしない
      g('ゲームボーイカラー (飾り)', 'GameConsole', [
        p('USB_C', 'input', 1, { label: '充電' }),
      ], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable', displayOnly: true }),
      g('Game & Watch (飾り)', 'GameConsole', [
        p('USB_C', 'input', 1, { label: '充電' }),
      ], { consoleFormFactor: 'handheld', powerUsage: 'rechargeable', displayOnly: true }),
      g('レトロゲーム機コレクション (飾り)', 'GameConsole', [
        p('HDMI', 'output', 1, { supportsVideo: true }),
        acIn(),
      ], { consoleFormFactor: 'stationary', displayOnly: true }),
      routerWith(4),
      charger('USB充電器', 2, 1),
      powerStrip('電源タップ', 6),
      // 壁付けの自作デスク。電動昇降ではないので端子を持たない
      g('自作壁付けデスク', 'Desk', [], { isHeightAdjustable: false }),
      g('エルゴヒューマン エンジョイ', 'Chair', []),
    ],
  })

  // 32. ユーザー設定の回帰（合成）
  // 実在のデスクではなく、「ユーザーが手で指定した設定」を配線エンジンが尊重するかだけを見る。
  // ここまでの31構成はどれも設定を一切持たず、エンジン側に分岐があるのに
  // 検査できていなかった（wiredOverrides は9箇所、powerSourceGadgetId は6箇所で分岐する）。
  // 自動選択の結果と必ず違う指定を選んであり、指定が無視されれば落ちる
  const settingsPc = g('メインPC', 'PC', [
    p('DisplayPort', 'output', 2, { supportsVideo: true }),
    p('HDMI', 'output', 1, { supportsVideo: true }),
    p('USB_A', 'output', 4),
    p('USB_C', 'output', 1),
    acIn(),
  ], { pcFormFactor: 'desktop', pcOs: 'Windows' })
  const settingsSubPc = g('サブPC', 'PC', [
    p('DisplayPort', 'output', 2, { supportsVideo: true }),
    p('USB_A', 'output', 4),
    p('USB_C', 'output', 1),
    acIn(),
  ], { pcFormFactor: 'desktop', pcOs: 'Windows' })
  const settingsMonitorA = g('モニターA (左)', 'Monitor', [
    p('DisplayPort', 'input', 1, { supportsVideo: true }),
    p('HDMI', 'input', 1, { supportsVideo: true }),
    acIn(),
  ])
  const settingsMonitorB = g('モニターB (右)', 'Monitor', [
    p('DisplayPort', 'input', 1, { supportsVideo: true }),
    p('HDMI', 'input', 1, { supportsVideo: true }),
    acIn(),
  ])
  const settingsCapture = g('キャプチャボード', 'CaptureDevice', [
    p('HDMI', 'input', 1, { supportsVideo: true }),
    p('HDMI', 'output', 1, { supportsVideo: true }),
    p('USB_C', 'input', 1, { label: 'USB-C (PC 接続)' }),
  ])
  const settingsCharger1 = charger('充電器1 (左)', 1, 1)
  const settingsCharger2 = charger('充電器2 (中央)', 1, 1)
  const settingsCharger3 = charger('充電器3 (右)', 1, 1)
  const settingsKeyboard = btKeyboard('ワイヤレスキーボード')
  const settingsMouse = btMouse('ワイヤレスマウス')
  const settingsPhone = iphone()

  list.push({
    name: 'ユーザー設定の回帰（接続先・給電元・有線強制・消した線）',
    source: '合成（実在デスクではなく、指定を尊重するかの検査）',
    outletCount: 2,
    planOverrides: {
      // 無線で繋がるキーボードを、あえて有線で使う指定
      wiredOverrides: [settingsKeyboard.id],
      connectionMap: {
        connections: [],
        // マウスの Bluetooth 線をユーザーが消した。復活させてはいけない
        dismissedPairs: [[settingsPc.id, settingsMouse.id].sort().join('~') + '|Bluetooth'],
      },
    },
    gadgets: [
      settingsPc,
      settingsSubPc,
      // 自動なら1台目のメインPCが取るモニターを、サブPCへ指定する
      { ...settingsMonitorA, bluetoothTargetGadgetIds: [settingsSubPc.id] },
      settingsMonitorB,
      // 自動なら映像元と別のPCが受け持つ（第19項）。あえて映像元と同じPCを指定する
      { ...settingsCapture, bluetoothTargetGadgetIds: [settingsPc.id] },
      settingsCharger1,
      settingsCharger2,
      // 自動なら先着の充電器1が使われる。3台目を名指しする。
      // 指定より後ろに置いてあるのは、登録順に左右されないことも兼ねて見るため
      { ...settingsPhone, powerSourceGadgetId: settingsCharger3.id },
      settingsCharger3,
      settingsKeyboard,
      settingsMouse,
      powerStrip('電源タップ', 8),
      desk(),
    ],
  })

  // 33. PC 5台のゲーミングルーム（デスクトップ1 + ノート4 / トリプルモニター）
  // 母集団の最大は3台で、5台は初めて。画面の確保ルール（第12項）と
  // 2台目以降のループが、モニターより PC が多い状況で破綻しないかを見る。
  // 照明も多く、電源だけを取る機器が大量にぶら下がる構成
  list.push({
    name: 'PC5台のゲーミングルーム（ノート4台 + トリプルモニター）',
    source: 'YouTube SeikinTV「【総額約300万円】夢のゲーミングルーム作り！」',
    sourceUrl: 'https://www.youtube.com/watch?v=BQ_Jja9qEpA',
    outletCount: 4,
    gadgets: [
      g('Alienware デスクトップPC', 'PC', [
        p('DisplayPort', 'output', 3, { supportsVideo: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 8),
        p('USB_C', 'output', 2),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1),
        acIn(),
      ], { pcFormFactor: 'desktop', pcOs: 'Windows' }),
      ...[1, 2, 3, 4].map((n) => g(`Alienware ゲーミングノート ${n}`, 'PC', [
        p('Thunderbolt', 'bidirectional', 1, { supportsVideo: true, supportsPowerDelivery: true }),
        p('HDMI', 'output', 1, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        p('Ethernet', 'input', 1),
      ], { pcFormFactor: 'laptop', pcOs: 'Windows' })),
      ...['左', '中央', '右'].map((pos) => g(`Alienware モニター (${pos})`, 'Monitor', [
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_A', 'output', 2),
        acIn(),
      ])),
      wiredKeyboard('Alienware ゲーミングキーボード'),
      g('Alienware ゲーミングマウス', 'Mouse', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      g('Alienware ゲーミングヘッドセット', 'Headphone', [p('USB_A', 'input', 1, { label: '有線接続' })]),
      // 照明。電源だけを取る機器が大量にぶら下がる
      g('LEDテープライト (デスク)', 'Light', [usbAPowerIn()]),
      g('LEDテープライト (床)', 'Light', [acIn()]),
      g('ネオン風ライト', 'Light', [acIn()]),
      g('スマートライトパネル', 'Light', [p('WiFi', 'input', 1), acIn()]),
      // シーリングライトは天井のソケットから給電するので端子を持たない
      g('シーリングライト', 'Light', []),
      routerWith(4),
      charger('USB充電器', 2, 2),
      powerStrip('電源タップ (1)', 10),
      powerStrip('電源タップ (2)', 10),
      desk(),
      chair(),
    ],
  })

  // 34. 電源の特殊ケース（ソーラー・電池・パススルー充電・挿す口の指定）
  // シナリオ32 で潰しきれなかった残り3つの設定を押さえる合成構成。
  //   ・smartHomePowerSource … ソーラー／電池のスマートホーム機器は
  //     コンセントではなく専用の給電元（sentinel）から線が出る
  //   ・supportsPassThroughCharging … 充電中のモバイルバッテリーは、
  //     パススルー対応でなければ他機器へ給電できない
  //   ・powerSourcePortId … 給電元の「どの口に挿すか」まで指定する
  const powerPc = g('PC', 'PC', [
    p('USB_A', 'output', 2),
    p('DisplayPort', 'output', 1, { supportsVideo: true }),
    acIn(),
  ], { pcFormFactor: 'desktop', pcOs: 'Windows' })
  // 口を3つ持ち、2番目を名指しで指定される充電器
  const portPinCharger = g('充電器 (USB-C 3口)', 'Charger', [
    p('USB_C', 'output', 3),
    acIn(),
  ])
  const portPinnedPhone = {
    ...iphone('iPhone (口まで指定)'),
    powerSourceGadgetId: portPinCharger.id,
    // buildChargerPorts と同じ規則で「ポートID#何口目」を作る
    powerSourcePortId: `${portPinCharger.ports[0].id}#2`,
  }
  // 充電中のモバイルバッテリー2台。パススルー対応の方だけが他機器へ給電できる
  const passThroughBattery = g('モバイルバッテリー (パススルー対応)', 'MobileBattery', [
    p('USB_C', 'output', 2),
    p('USB_C', 'input', 1, { label: '給電 (C)' }),
  ], { powerUsage: 'rechargeable', supportsPassThroughCharging: true })
  const plainBattery = g('モバイルバッテリー (パススルー非対応)', 'MobileBattery', [
    p('USB_C', 'output', 2),
    p('USB_C', 'input', 1, { label: '給電 (C)' }),
  ], { powerUsage: 'rechargeable' })

  list.push({
    name: '電源の特殊ケース（ソーラー・電池・パススルー・口の指定）',
    source: '合成（実在デスクではなく、給電まわりの設定を尊重するかの検査）',
    outletCount: 2,
    gadgets: [
      powerPc,
      g('モニター', 'Monitor', [p('DisplayPort', 'input', 1, { supportsVideo: true }), acIn()]),
      // ソーラーパネル駆動。コンセントからは引かない
      g('屋外カメラ (ソーラー)', 'SmartHome', [
        p('WiFi', 'bidirectional'),
        acIn(),
      ], { smartHomePowerSource: 'solar' }),
      // 内蔵電池駆動。こちらもコンセントからは引かない
      g('スマートセンサー (電池)', 'SmartHome', [
        p('WiFi', 'bidirectional'),
        acIn(),
      ], { smartHomePowerSource: 'battery' }),
      portPinCharger,
      portPinnedPhone,
      passThroughBattery,
      plainBattery,
      // 常時給電の機器。USB の口を奪い合わせると「指定した口が空いていない」という
      // 別の話になってしまうので、この検査ではコンセントから取らせる
      g('デスクライト', 'Light', [acIn()]),
      powerStrip('電源タップ', 6),
      desk(),
    ],
  })
  // 35. misclog / インダストリアル・クラムシェル（TS4 1台に全部集約）
  // 見どころは3つ。
  //   ・USB DAC 内蔵のパワードスピーカー。USB-B が「映像入力」でも「モニターの上流」でも
  //     なく音の入力として使われるか（第3項の逆パターン）
  //   ・オーディオIF を持たない構成の XLR / USB 兼用マイク。XLR 側の相手がいないので
  //     micro-USB でホストへ落ちるべき
  //   ・USB-C 受電のワイヤレス充電スタンド（AC ではなくドックから電気を取る）
  list.push({
    name: 'インダストリアル・クラムシェル（40インチ 5K2K + TS4）',
    source: 'YouTube オガワコウ / misclog「【デスクツアー】超絶快適なIT系自営業のテレワークデスク環境を紹介！」',
    sourceUrl: 'https://www.youtube.com/watch?v=bJVZgWwWNMU',
    outletCount: 2,
    gadgets: [
      macbookPro('MacBook Pro 14 M1 Max'),
      caldigitTs4(),
      // U4021QW は Thunderbolt の上流・下流に加えて KVM 用の USB-B 上流も持つ
      g('Dell U4021QW (40インチ 5K2K)', 'Monitor', [
        p('Thunderbolt', 'input', 1, { supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 3 上流 / PD 90W' }),
        p('Thunderbolt', 'output', 1, { supportsVideo: true, label: 'Thunderbolt 3 下流' }),
        p('DisplayPort', 'input', 1, { supportsVideo: true }),
        p('HDMI', 'input', 2, { supportsVideo: true }),
        p('USB_B', 'input', 1, { label: 'KVM 用 上流' }),
        p('USB_A', 'output', 4),
        p('Ethernet', 'input', 1),
        p('Audio3_5mm', 'output', 1, { label: 'ライン出力' }),
        // 「アームを使用」を入れた状態。35構成のどれもこの口を持っておらず、
        // アームの取り付け経路（ステップ0）が一度も踏まれていなかった
        p('MonitorArm', 'input', 1, { label: 'アームを使用' }),
        acIn(),
      ]),
      g('エルゴトロン HX (マットブラック)', 'MonitorArm', [p('MonitorArm', 'output', 1)]),
      g('Grovemade Vertical Laptop Stand', 'Accessory', []),
      g('BenQ ScreenBar Halo', 'Light', [usbAPowerIn()]),
      btKeyboard('Apple Magic Keyboard (Touch ID)'),
      g('Apple Magic Mouse', 'Mouse', [bt(), p('Lightning', 'input', 1, { label: '充電' })], { powerUsage: 'rechargeable' }),
      g('Apple Magic Trackpad', 'Mouse', [bt(), p('Lightning', 'input', 1, { label: '充電' })], { powerUsage: 'rechargeable' }),
      g('Loupedeck Live', 'SmallDevice', [p('USB_C', 'input', 1, { label: '有線接続' })]),
      // A2+ Wireless は左が主。USB DAC を内蔵し、右へはスピーカーケーブルで送る
      g('Audioengine A2+ Wireless (L / 主)', 'Speaker', [
        p('USB_B', 'input', 1, { label: 'USB DAC 入力' }),
        p('RCA', 'input', 1),
        p('Audio3_5mm', 'input', 1),
        p('SpeakerTerminal', 'output', 1),
        bt(),
        acIn(),
      ], { stereoPair: true, speakerInputSide: 'L' }),
      g('Audioengine A2+ Wireless (R)', 'Speaker', [
        p('SpeakerTerminal', 'input', 1),
      ], { stereoPair: true, speakerInputSide: 'R' }),
      g('Kanto スピーカースタンド', 'Furniture', []),
      // MV7 は XLR と micro-USB の両対応。この構成にはオーディオIF が無い
      g('SHURE MV7', 'Microphone', [
        p('XLR', 'output', 1),
        p('microUSB', 'input', 1, { label: 'PC接続' }),
        p('Audio3_5mm', 'output', 1, { label: 'ヘッドホン出力' }),
        p('MicArm', 'input', 1, { label: 'アームを使用' }),
      ]),
      g('Blue Compass マイクアーム', 'MicArm', [p('MicArm', 'output', 1)]),
      // MagSafe パックを載せる木製スタンド。AC ではなく USB-C から電気を取る
      g('Grovemade Walnut MagSafe Stand', 'Charger', [
        p('wirelessCharging', 'output', 1, { label: 'ワイヤレス出力' }),
        usbCPowerIn(),
      ]),
      iphone(),
      g('Philips Hue Play ライトバー', 'Light', [p('Bluetooth', 'output', 1), acIn()]),
      g('Barebones ランタン', 'Light', [usbCPowerIn()], { powerUsage: 'rechargeable' }),
      g('Grovemade フェルトデスクマット', 'DeskPad', []),
      g('Grovemade ウォールナットトレイ', 'Accessory', []),
      g('Grovemade リストレスト', 'Accessory', []),
      g('Grovemade プランター (フェイクグリーン)', 'Plant', []),
      g('サンワサプライ ケーブルトレー', 'Furniture', []),
      powerStrip('電源タップ', 6),
      g('FlexiSpot E7J2 + dicotomic 杉古材天板', 'Desk', [acIn()], { isHeightAdjustable: true, deskLiftType: 'electric' }),
      g('エルゴヒューマン プロ', 'Chair', []),
    ],
  })

  return list
}

// ─── 検査 ─────────────────────────────────────────────────────
const SENTINELS = new Set(['wall', 'solar', 'battery', 'failed', 'failed-power'])
/** 通電も配線もしない備品。線が1本もなくても正常 */
const PASSIVE_CATEGORIES: GadgetCategory[] = ['Chair', 'DeskPad', 'MousePad', 'Plant', 'Furniture', 'Cable', 'WallPanel']
/** 充電器・タップの給電口は仕様として共有する（cables.md 参照）ので溢れ検査から外す */
const SLOT_SHARING_CATEGORIES: GadgetCategory[] = ['Charger', 'MobileBattery', 'PowerStrip', 'UPS']

interface Issue { kind: string; detail: string }

const portsOf = (gadget: Gadget, type: PortType, role: 'output' | 'input') =>
  gadget.ports
    .filter((port) => port.type === type && (port.direction === role || port.direction === 'bidirectional'))
    .reduce((total, port) => total + Math.max(0, port.count), 0)

function inspect(scenario: Scenario, result: ReturnType<typeof generateWiring>): Issue[] {
  const issues: Issue[] = []
  const add = (kind: string, detail: string) => issues.push({ kind, detail })
  const byId = new Map(scenario.gadgets.map((item) => [item.id, item]))
  const { connections, warnings, requiredCables } = result

  // 端点の妥当性
  const seen = new Set<string>()
  const usedOut = new Map<string, number>()
  const usedIn = new Map<string, number>()
  for (const conn of connections) {
    if (conn.fromGadgetId === conn.toGadgetId) add('self-loop', `${conn.fromGadgetId} (${conn.cableType})`)
    for (const [id, side] of [[conn.fromGadgetId, 'from'], [conn.toGadgetId, 'to']] as const) {
      if (!SENTINELS.has(id) && !byId.has(id)) add('unknown-endpoint', `${side}=${id} (${conn.cableType})`)
    }
    const key = [conn.fromGadgetId, conn.fromPortType, conn.toGadgetId, conn.toPortType, conn.cableType].join('|')
    if (seen.has(key)) add('duplicate-edge', key)
    seen.add(key)

    if (isWirelessPortType(conn.cableType)) continue
    // Stylus は「このタブレットで使うペン」の関係で、どちらの口も使わない
    if (conn.cableType === 'Stylus') continue
    const from = byId.get(conn.fromGadgetId)
    const to = byId.get(conn.toGadgetId)
    // 壁・タップからの電源線は fromPortType='Power' 固定なので出力側の実在検査から外す
    if (from && !SENTINELS.has(conn.fromGadgetId)) {
      if (portsOf(from, conn.fromPortType, 'output') === 0) {
        add('missing-output-port', `${from.name} に ${conn.fromPortType} 出力がない (→ ${to?.name})`)
      }
      // 充電時のみ挿す機器は口を共有してよい（cables.md / hasSlotRoom の設計）。
      // 挿しっぱなしになる接続だけが物理ポート数に収まっている必要がある
      if (!conn.chargingOnly) {
        const k = `${from.id}|${conn.fromPortType}`
        usedOut.set(k, (usedOut.get(k) ?? 0) + 1)
      }
    }
    if (to) {
      if (portsOf(to, conn.toPortType, 'input') === 0) {
        add('missing-input-port', `${to.name} に ${conn.toPortType} 入力がない (← ${from?.name ?? conn.fromGadgetId})`)
      }
      const k = `${to.id}|${conn.toPortType}`
      usedIn.set(k, (usedIn.get(k) ?? 0) + 1)
    }
  }

  // 同じ端子どうしでしか繋がらない型が、別の端子へ繋がっていないか。
  // 互換表（PORT_COMPATIBILITY）を緩めると、同軸デジタルがアナログRCAへ、
  // 4.4mm が 6.3mm のヘッドホンへ、TRS MIDI がイヤホンへ繋がるようになる
  const STRICT_SAME_TYPE: PortType[] = [
    'CoaxialAudio', 'Audio4_4mm', 'XLR4pin', 'MIDI_TRS', 'SpeakerTerminal', 'CFexpress',
  ]
  for (const conn of connections) {
    for (const type of STRICT_SAME_TYPE) {
      if (conn.fromPortType !== type && conn.toPortType !== type) continue
      if (conn.fromPortType === conn.toPortType) continue
      add('incompatible-pair', `${conn.fromPortType} → ${conn.toPortType} (${byId.get(conn.fromGadgetId)?.name} → ${byId.get(conn.toGadgetId)?.name})`)
    }
  }

  // ポート数の超過
  for (const [key, count] of usedOut) {
    const [id, type] = key.split('|') as [string, PortType]
    const gadget = byId.get(id)!
    if (SLOT_SHARING_CATEGORIES.includes(gadget.category)) continue
    const capacity = portsOf(gadget, type, 'output')
    if (count > capacity) add('output-overflow', `${gadget.name} ${type} 出力 ${count}/${capacity}`)
  }
  for (const [key, count] of usedIn) {
    const [id, type] = key.split('|') as [string, PortType]
    const gadget = byId.get(id)!
    const capacity = portsOf(gadget, type, 'input')
    if (count > capacity) add('input-overflow', `${gadget.name} ${type} 入力 ${count}/${capacity}`)
  }

  // 電源ループ（wouldCreatePowerCycle が守る範囲＝給電の線だけを見る。
  // 映像とUSBハブが行き来する「モニター ⇄ キャプチャ」のような往復は正常）
  const powerNext = new Map<string, string[]>()
  for (const conn of connections) {
    if (SENTINELS.has(conn.fromGadgetId)) continue
    const isPowerEdge = conn.chargingOnly === true ||
      conn.cableType === 'Power' || conn.cableType === 'DCPower' || conn.cableType === 'wirelessCharging'
    if (!isPowerEdge) continue
    const list = powerNext.get(conn.fromGadgetId) ?? []
    list.push(conn.toGadgetId)
    powerNext.set(conn.fromGadgetId, list)
  }
  const state = new Map<string, number>()
  const walk = (id: string): boolean => {
    if (state.get(id) === 1) return true
    if (state.get(id) === 2) return false
    state.set(id, 1)
    for (const next of powerNext.get(id) ?? []) if (walk(next)) return true
    state.set(id, 2)
    return false
  }
  for (const id of powerNext.keys()) if (walk(id)) { add('connection-cycle', id); break }

  // 壁コンセント・電源タップの口数
  const wallUse = connections.filter((conn) => conn.fromGadgetId === 'wall').length
  if (wallUse > scenario.outletCount) add('wall-overuse', `壁 ${wallUse}/${scenario.outletCount}`)
  for (const strip of scenario.gadgets.filter((item) => item.category === 'PowerStrip' || item.category === 'UPS')) {
    const capacity = portsOf(strip, 'Power', 'output')
    const used = connections.filter((conn) =>
      conn.fromGadgetId === strip.id && (conn.cableType === 'Power' || conn.cableType === 'DCPower')).length
    if (used > capacity) add('strip-overuse', `${strip.name} ${used}/${capacity}`)
  }

  // 給電の重複（常時給電の機器が2本以上の電源を受けていないか）
  const powerIn = new Map<string, Connection[]>()
  for (const conn of connections) {
    if (conn.cableType !== 'Power' && conn.cableType !== 'DCPower' && conn.cableType !== 'wirelessCharging') continue
    const list = powerIn.get(conn.toGadgetId) ?? []
    list.push(conn)
    powerIn.set(conn.toGadgetId, list)
  }
  for (const [id, list] of powerIn) {
    if (list.length > 1) add('double-power', `${byId.get(id)?.name ?? id} に電源線 ${list.length} 本`)
  }

  // 孤立ノード（線が1本もなく、警告にも名前が出ない）
  const touched = new Set<string>()
  for (const conn of connections) { touched.add(conn.fromGadgetId); touched.add(conn.toGadgetId) }
  for (const gadget of scenario.gadgets) {
    if (gadget.displayOnly) continue
    if (PASSIVE_CATEGORIES.includes(gadget.category)) continue
    // 端子を1つも持たない機器（手動昇降デスク・置き台など）は繋ぐ先が無いので浮いて正常
    if (gadget.ports.length === 0) continue
    // 交換式電池で動くセンサー類は電源線も通信線も持たない（配線図はバッジだけ出す設計）
    if (gadget.powerUsage === 'replaceable') continue
    // Wi-Fi の点線を引くのはプリンターだけ、というのが wiringEngine の設計。
    // それ以外の Wi-Fi 専用機器（スマート電球など）は線が1本も無くて正常
    if (gadget.ports.every((port) => port.type === 'WiFi') &&
      gadget.category !== 'Printer' && gadget.category !== 'Printer3D') continue
    if (touched.has(gadget.id)) continue
    if (warnings.some((warning) => warning.includes(gadget.name))) continue
    add('silent-orphan', gadget.name)
  }

  // ソーラー・電池のスマートホーム機器は、コンセントではなく専用の給電元から線が出る。
  // ここを見ていないと、太陽光で動く屋外カメラに電源タップから線が伸びる図を見逃す
  for (const gadget of scenario.gadgets) {
    const source = gadget.smartHomePowerSource
    if (source !== 'solar' && source !== 'battery') continue
    const power = connections.filter((conn) =>
      conn.toGadgetId === gadget.id && ['Power', 'DCPower'].includes(conn.cableType))
    if (power.some((conn) => conn.fromGadgetId !== source)) {
      add('smart-home-power-source-ignored',
        `${gadget.name} は ${source} 駆動なのに ${power.map((c) => c.fromGadgetId).join('・')} から給電されている`)
    }
  }
  // 充電中のモバイルバッテリーは、パススルー対応でなければ他機器へ給電できない
  for (const battery of scenario.gadgets.filter((item) => item.category === 'MobileBattery')) {
    const recharging = connections.some((conn) =>
      conn.toGadgetId === battery.id && conn.fromGadgetId !== 'failed-power' &&
      (conn.chargingOnly === true || conn.id.startsWith('power-')))
    if (!recharging || battery.supportsPassThroughCharging === true) continue
    const supplying = connections.filter((conn) =>
      conn.fromGadgetId === battery.id && conn.id.startsWith('power-'))
    if (supplying.length > 0) {
      add('passthrough-not-supported',
        `${battery.name} は充電中でパススルー非対応なのに ${supplying.length} 台へ給電している`)
    }
  }
  // 挿す口まで指定されているなら、その口が使われていなければならない
  for (const gadget of scenario.gadgets) {
    if (!gadget.powerSourcePortId) continue
    const power = connections.find((conn) =>
      conn.toGadgetId === gadget.id && conn.id.startsWith('power-') &&
      conn.fromGadgetId === gadget.powerSourceGadgetId)
    if (power && power.sourcePortId !== gadget.powerSourcePortId) {
      add('pinned-port-ignored',
        `${gadget.name} は ${gadget.powerSourcePortId} 指定なのに ${power.sourcePortId ?? '(未記録)'} が使われている`)
    }
  }

  // USB-A は端子の仕様として PD を通せない。ノートPC の給電元になっていたら、
  // 実物では充電できない線を引いていることになる
  for (const conn of connections) {
    if (!conn.id.startsWith('power-') || conn.fromPortType !== 'USB_A') continue
    const target = byId.get(conn.toGadgetId)
    if (target?.category === 'PC' && target.pcFormFactor === 'laptop') {
      add('laptop-charged-over-usb-a', `${target.name} が ${byId.get(conn.fromGadgetId)?.name ?? conn.fromGadgetId} の USB-A から給電されている`)
    }
  }

  // ユーザーが手で指定した設定は、自動選択より優先されなければならない。
  // 指定を無視しても「もっともらしい配線」にはなるので、ここで名指しして確かめる
  const nameOf = (id: string) => byId.get(id)?.name ?? id
  for (const gadget of scenario.gadgets) {
    // 接続先（映像元・USBホスト）
    const pinnedHostId = gadget.bluetoothTargetGadgetIds?.[0]
    if (pinnedHostId) {
      const incoming = connections.filter((conn) =>
        conn.toGadgetId === gadget.id && !conn.id.startsWith('failed') && !conn.id.startsWith('power-'))
      if (incoming.length > 0 && !incoming.some((conn) => conn.fromGadgetId === pinnedHostId)) {
        add('pinned-host-ignored',
          `${gadget.name} の接続先は ${nameOf(pinnedHostId)} 指定なのに ${incoming.map((c) => nameOf(c.fromGadgetId)).join('・')} から来ている`)
      }
    }
    // 給電元
    if (gadget.powerSourceGadgetId) {
      const power = connections.filter((conn) =>
        conn.toGadgetId === gadget.id &&
        ['Power', 'DCPower', 'wirelessCharging', 'USB_C', 'USB_A', 'USB_A_to_C', 'USB_C_to_Lightning', 'USB_A_to_Lightning'].includes(conn.cableType) &&
        conn.id.startsWith('power-'))
      if (power.length > 0 && !power.some((conn) => conn.fromGadgetId === gadget.powerSourceGadgetId)) {
        add('pinned-power-ignored',
          `${gadget.name} の給電元は ${nameOf(gadget.powerSourceGadgetId)} 指定なのに ${power.map((c) => nameOf(c.fromGadgetId)).join('・')} から来ている`)
      }
    }
  }
  // 有線を強制したガジェットに Bluetooth で繋いでいないか
  for (const id of scenario.planOverrides?.wiredOverrides ?? []) {
    const forced = byId.get(id)
    if (!forced) continue
    const wireless = connections.some((conn) => conn.toGadgetId === id && conn.cableType === 'Bluetooth')
    const wired = connections.some((conn) =>
      conn.toGadgetId === id && conn.cableType !== 'Bluetooth' && !conn.id.startsWith('failed'))
    if (wireless) add('wired-override-ignored', `${forced.name} は有線指定なのに Bluetooth で繋がっている`)
    if (!wired) add('wired-override-unwired', `${forced.name} は有線指定なのに線が1本も無い`)
  }
  // ユーザーが消した線を復活させていないか
  for (const key of scenario.planOverrides?.connectionMap?.dismissedPairs ?? []) {
    const [pair, cableType] = key.split('|')
    const [a, b] = pair.split('~')
    if (connections.some((conn) =>
      conn.cableType === cableType &&
      [conn.fromGadgetId, conn.toGadgetId].sort().join('~') === pair)) {
      add('dismissed-pair-revived', `${nameOf(a)} ↔ ${nameOf(b)} (${cableType}) は消されているのに復活している`)
    }
  }

  // 飾り（displayOnly）は通電も配線もしない置物。端子を持っていても線は1本も引かれず、
  // 「繋がっていない」という警告も出てはいけない（ユーザーが意図してそう設定している）
  for (const decor of scenario.gadgets.filter((item) => item.displayOnly)) {
    const wired = connections.filter((conn) =>
      conn.fromGadgetId === decor.id || conn.toGadgetId === decor.id)
    if (wired.length > 0) {
      add('decor-wired', `${decor.name} に線が ${wired.length} 本引かれている (${wired.map((c) => c.cableType).join('・')})`)
    }
    if (warnings.some((warning) => warning.startsWith(`${decor.name}:`))) {
      add('decor-warned', `${decor.name} は飾りなのに警告が出ている`)
    }
  }

  // キャプチャデバイスは PC・ハブへの USB データ線が要る（HDMI だけでは映像が録れない）
  for (const capture of scenario.gadgets.filter((item) => item.category === 'CaptureDevice')) {
    // 内蔵カード（PCIe）は USB を持たないので対象外
    const hasUsb = capture.ports.some((port) => port.type === 'USB_C' || port.type === 'USB_A')
    const linked = connections.some((conn) =>
      (conn.toGadgetId === capture.id || conn.fromGadgetId === capture.id) &&
      ['USB_C', 'USB_A', 'USB_A_to_C', 'Thunderbolt'].includes(conn.cableType))
    if (hasUsb && !linked && !warnings.some((warning) => warning.includes(capture.name))) {
      add('capture-not-hosted', `${capture.name} が PC・ハブへ USB 接続されていない`)
    }
  }

  // 警告と実際の接続の食い違い
  for (const warning of warnings) {
    const owner = scenario.gadgets.find((item) => warning.startsWith(`${item.name}:`))
    if (!owner) continue
    if (/映像|video/i.test(warning) && connections.some((conn) =>
      conn.toGadgetId === owner.id && ['HDMI', 'DisplayPort', 'Thunderbolt', 'USB_C', 'USB_C_to_HDMI', 'DisplayPort_to_HDMI', 'USB_C_to_DisplayPort', 'MiniDisplayPort_to_DisplayPort', 'HDMI_to_DisplayPort'].includes(conn.cableType))) {
      add('false-warning', warning)
    }
    if (/ルーター|Router|LAN/i.test(warning) && connections.some((conn) =>
      conn.toGadgetId === owner.id && (conn.toPortType === 'Ethernet' || conn.toPortType === 'EthernetPoE'))) {
      add('false-warning', warning)
    }
    // 「オーディオIF がありません」は、音の行き先が既にある場合だけでなく、
    // PC へ USB で繋がっている（＝IF 無しでも音が録れる／鳴らせる）場合も誤警告。
    // 警告側の意図がまさに「USB で PC に繋がる機器は Step3 に任せる」なので、
    // USB データ線が引かれているのにこの文言が出たら実装漏れとみなす
    if (/オーディオインターフェース|audio interface|XLR/i.test(warning) && connections.some((conn) =>
      conn.toGadgetId === owner.id &&
      !conn.chargingOnly &&
      [
        'XLR', 'Audio6_3mm', 'Audio6_3mm_TS', 'RCA', 'Audio3_5mm', 'Audio3_5_to_6_3', 'RCA_to_3_5mm', 'RCA_to_6_3mm',
        'USB_C', 'USB_A', 'USB_A_to_B', 'USB_C_to_B', 'USB_A_to_C', 'Thunderbolt',
      ].includes(conn.cableType))) {
      add('false-warning', warning)
    }
    // 「操作先へ接続できません」は、データ・映像の線が既に来ているなら誤警告。
    // USB-C 1本で映像もデータも受ける液タブ・モバイルモニターがこれに当たる。
    // ステップ4で引かれる給電線（id が power- で始まる）は host ではないので除く
    if (/操作先へ接続できません|No input connection to a PC/i.test(warning) && connections.some((conn) =>
      conn.toGadgetId === owner.id &&
      !conn.chargingOnly &&
      !conn.id.startsWith('failed') &&
      !conn.id.startsWith('power-') &&
      conn.fromGadgetId !== 'wall' &&
      !['Power', 'DCPower', 'wirelessCharging'].includes(conn.cableType))) {
      add('false-warning', warning)
    }
    if (/アーム|arm|mount/i.test(warning) && connections.some((conn) =>
      conn.fromGadgetId === owner.id && (conn.cableType === 'MonitorArm' || conn.cableType === 'MicArm'))) {
      add('false-warning', warning)
    }
    if (/充電|給電|power|charg/i.test(warning) && connections.some((conn) =>
      conn.toGadgetId === owner.id && conn.fromGadgetId !== 'failed-power' &&
      ['Power', 'DCPower', 'wirelessCharging', 'USB_C', 'USB_A', 'USB_A_to_C', 'USB_C_to_Lightning', 'USB_A_to_Lightning'].includes(conn.cableType))) {
      add('false-warning', warning)
    }
  }

  // ケーブル集計
  const physical = connections.filter((conn) =>
    requiresPhysicalCable(conn.cableType) &&
    conn.fromGadgetId !== 'failed' && conn.fromGadgetId !== 'failed-power' &&
    !byId.get(conn.fromGadgetId)?.ports.some((port) => port.type === conn.fromPortType && port.directAttach) &&
    !byId.get(conn.toGadgetId)?.ports.some((port) => port.type === conn.toPortType && port.directAttach) &&
    !(conn.cableType === 'Audio3_5_to_6_3' &&
      ['Headphone', 'Earphone'].includes(byId.get(conn.toGadgetId)?.category ?? '')),
  ).length
  const counted = requiredCables.reduce((total, item) => total + item.count, 0)
  if (counted !== physical) add('cable-count-mismatch', `requiredCables=${counted} / 実配線=${physical}`)

  // 線が1本も引かれずに図へ浮くガジェット。並び順で浮き沈みする分は
  // order-dependent-orphan が見ているが、両方の並びで浮いたままのものは誰も見ていなかった
  for (const gadget of scenario.gadgets) {
    if (gadget.displayOnly || gadget.ports.length === 0) continue
    if (PASSIVE_CATEGORIES.includes(gadget.category)) continue
    // スマートホーム機器と Wi-Fi だけの IoT は、通信経路を描かず口のバッジだけ出す設計
    if (gadget.category === 'SmartHome') continue
    if (gadget.ports.every((port) => port.type === 'WiFi')) continue
    // 「アームを使用」が入っていないアームは、支える相手が居ないのが正しい（警告は出る）
    if (gadget.category === 'MonitorArm' || gadget.category === 'MicArm') {
      const supportType: PortType = gadget.category === 'MonitorArm' ? 'MonitorArm' : 'MicArm'
      const mountable = scenario.gadgets.some((other) =>
        other.id !== gadget.id && portsOf(other, supportType, 'input') > 0)
      if (!mountable) continue
    }
    if (connections.some((conn) => conn.fromGadgetId === gadget.id || conn.toGadgetId === gadget.id)) continue
    add('orphan', `${gadget.name} (${gadget.category}) に線が1本も引かれていない`)
  }

  return issues
}

const planFor = (scenario: Scenario): DeskPlan => ({
  id: 'audit',
  name: scenario.name,
  goal: 'clean_wiring',
  selectedGadgetIds: scenario.gadgets.map((item) => item.id),
  placements: [],
  outletCount: scenario.outletCount,
  outletCountVersion: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...scenario.planOverrides,
})

const signature = (result: ReturnType<typeof generateWiring>) =>
  result.connections
    .map((conn) => [conn.fromGadgetId, conn.fromPortType, conn.toGadgetId, conn.toPortType, conn.cableType].join('>'))
    .sort()
    .join('\n')

// ─── 実行 ─────────────────────────────────────────────────────
// シナリオだけを他のスクリプトから使えるよう、直接起動したときだけ監査を走らせる
const RUN_AUDIT = !process.env.DESK_TOUR_IMPORT_ONLY
if (RUN_AUDIT) {
let totalIssues = 0
let totalConnections = 0
const byKind = new Map<string, number>()

for (const scenario of scenarios()) {
  const plan = planFor(scenario)
  const result = generateWiring(scenario.gadgets, plan, 'ja')
  const issues = inspect(scenario, result)
  totalConnections += result.connections.length

  // 決定性：同じ入力を2回
  if (signature(generateWiring(scenario.gadgets, plan, 'ja')) !== signature(result)) {
    issues.push({ kind: 'nondeterministic', detail: '同じ入力で結果が変わる' })
  }
  // 並び順非依存：ガジェット配列を逆順にしても同じ配線になるべき
  const reversed = [...scenario.gadgets].reverse()
  const reversedResult = generateWiring(reversed, { ...plan, selectedGadgetIds: reversed.map((item) => item.id) }, 'ja')
  // どの口・どのPCを起点にするかが選択順で変わるのは仕様（同カテゴリ内は選択順）。
  // 本数も、空き入力の残り方で正当に増減する。順序で「機器が浮く」ことだけを問題にする。
  const connectedIds = (out: ReturnType<typeof generateWiring>) => {
    const ids = new Set<string>()
    for (const conn of out.connections) { ids.add(conn.fromGadgetId); ids.add(conn.toGadgetId) }
    return ids
  }
  const normalIds = connectedIds(result)
  const reversedIds = connectedIds(reversedResult)
  const floated = scenario.gadgets.filter((item) =>
    !item.displayOnly && !PASSIVE_CATEGORIES.includes(item.category) &&
    normalIds.has(item.id) !== reversedIds.has(item.id))
  if (floated.length > 0) {
    issues.push({
      kind: 'order-dependent-orphan',
      detail: `並び順で線が付いたり消えたりする: ${floated.map((item) => item.name).join('・')}`,
    })
  }

  totalIssues += issues.length
  for (const issue of issues) byKind.set(issue.kind, (byKind.get(issue.kind) ?? 0) + 1)

  if (process.env.AUDIT_DUMP && scenario.name.includes(process.env.AUDIT_DUMP)) {
    const nameOf = (id: string) => scenario.gadgets.find((item) => item.id === id)?.name ?? id
    for (const conn of result.connections) {
      console.log(`    · ${nameOf(conn.fromGadgetId)} [${conn.fromPortType}] → ${nameOf(conn.toGadgetId)} [${conn.toPortType}]  ${conn.cableType}${conn.chargingOnly ? ' (充電時のみ)' : ''}`)
    }
    for (const warning of result.warnings) console.log(`    ! ${warning}`)
  }

  const status = issues.length === 0 ? 'OK ' : 'NG '
  console.log(`${status} ${scenario.name}  [${scenario.gadgets.length}台 / ${result.connections.length}本 / 警告${result.warnings.length}件]`)
  console.log(`    出典: ${scenario.source}`)
  for (const issue of issues) console.log(`    ✗ ${issue.kind}: ${issue.detail}`)
  if (process.env.AUDIT_VERBOSE && result.warnings.length > 0) {
    for (const warning of result.warnings) console.log(`    ! ${warning}`)
  }
}

console.log('')
console.log(`シナリオ: ${scenarios().length}  総配線: ${totalConnections}  問題: ${totalIssues}`)
for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind}: ${count}`)
}
process.exit(totalIssues > 0 ? 1 : 0)
}
