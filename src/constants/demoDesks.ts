import { CableType, DeskPlan, DeskZone, Gadget, GadgetPlacement, NodeOffset, PlanPurpose, Port, PortDirection, PortType, UserGoal } from '../types'
import { reconcileMap } from '../utils/connectionMapLayout'
import { generateWiring } from '../utils/wiringEngine'
import { sumGadgetPrices } from '../utils/gadgetStats'

// ─── 公式デモデスク ──────────────────────────────────────────────
//
// テンプレート（deskTemplates.ts）が「カテゴリだけの骨組み」なのに対して、
// デモデスクは実商品・価格・導入日まで入った完成品のデスク。
// 空のアプリでは絶対に体験できないもの（合計金額・カテゴリ別内訳・
// デスクの歴史アニメーション）を、初回起動の時点で見せるために使う。
//
// アプリに同梱するのではなく、公式アカウントで公開デスクとして出しておき、
// 見本として閲覧だけできるようにする。ローカルには一切入れない
// （入れるとマイガジェットが他人のガジェットで埋まり、無料枠のデスク数も食う）。
//
// 投入は scripts/publishDemoDesks.ts（npm run publish:demo）。
// id と各ガジェットの id は「同じデスクを更新している」判定に使うので変えない。

const P = (id: string, type: PortType, direction: PortDirection, count = 1, extra: Partial<Port> = {}): Port =>
  ({ id, type, direction, count, ...extra })

/** 10口の電源タップ。3デスクで形が同じなので関数にしておく */
const powerStrip = (id: string, name: string, outlets: number, price: number, purchasedAt: string): Gadget => ({
  id,
  name,
  category: 'PowerStrip',
  ports: [P('p1', 'Power', 'input'), P('p2', 'Power', 'output', outlets)],
  price,
  purchasedAt,
  createdAt: `${purchasedAt}T00:00:00.000Z`,
})

// ケーブルは配線図の線とは別に「ケーブル」の一覧に並ぶ持ち物。付属品や本体から直接出ている
// 線（マウス・ヘッドセット）は買い足したものではないので登録しない
const cable = (id: string, name: string, cableType: CableType, price: number, purchasedAt: string): Gadget => ({
  id,
  name,
  category: 'Cable',
  cableType,
  cableCount: 1,
  ports: [],
  price,
  purchasedAt,
  createdAt: `${purchasedAt}T00:00:00.000Z`,
})

export interface DemoDesk {
  /** 公開デスクとの対応キー。scripts/publishDemoDesks.ts が同じデスクを更新するのに使う */
  id: string
  name: string
  nameEn: string
  /** 一覧カードに出す一言。何が見どころのデスクなのか */
  summaryJa: string
  summaryEn: string
  goal: UserGoal
  purposes: PlanPurpose[]
  /** 利用できる壁コンセントの口数 */
  outletCount: number
  gadgets: Gadget[]
  /** 現在の見本として表示する最小構成。ほかは履歴上の撤去済みとして残す */
  activeGadgetIds?: string[]
  placements: GadgetPlacement[]
  /** 公開する配線図で、自動配置から微調整するノード */
  nodeOffsets?: Record<string, NodeOffset>
  /** 写真アセット（assets/demo/ 配下）。公開時に表示用 JPEG へ整形する */
  illustration: string
}

const zone = (gadgetId: string, z: DeskZone): GadgetPlacement => ({ gadgetId, zone: z })

// ================================================================
// 1. ゲーミング｜PC と Nintendo Switch 2 を1台のモニターで共存させる
// ================================================================
// 見どころ：映像の分岐。PC は DisplayPort で2枚、Switch 2 は Dock から
// HDMI でサブモニターへ入る。同じ画面を2つのガジェットで取り合う構成が
// 配線図でどう見えるかが、このデスクの主役。

const GAMING_GADGETS: Gadget[] = [
  {
    id: 'demo-gaming-pc',
    name: 'GALLERIA XA7C-R47',
    model: 'XA7C-R47',
    category: 'PC',
    pcFormFactor: 'desktop',
    pcOs: 'Windows',
    pcCpu: 'Core i7-14700F',
    pcGpu: 'GeForce RTX 4070',
    pcRam: '32GB',
    pcStorage: '1TB SSD',
    ports: [
      P('p1', 'DisplayPort', 'output', 3, { supportsVideo: true }),
      P('p2', 'HDMI', 'output', 1, { supportsVideo: true }),
      P('p3', 'USB_A', 'output', 6),
      P('p4', 'USB_C', 'output', 1),
      P('p5', 'Audio3_5mm', 'output', 1),
      // 有線LANは使わず Wi-Fi 6E 接続。使っていない口は登録しない
      P('p6', 'Power', 'input', 1),
    ],
    price: 219800,
    purchasedAt: '2023-06-17',
    createdAt: '2023-06-17T00:00:00.000Z',
  },
  // 現行PCより前のモニターだけが履歴に現れないよう、買い替え前のホストも残す。
  {
    id: 'demo-gaming-pc-old',
    name: 'ASUS ROG Strix GA15 (G15DK)',
    model: 'G15DK',
    category: 'PC',
    pcFormFactor: 'desktop',
    pcOs: 'Windows',
    ports: [
      P('p1', 'HDMI', 'output', 1, { supportsVideo: true }),
      P('p2', 'USB_A', 'output', 4),
      P('p3', 'Audio3_5mm', 'output', 1),
      P('p4', 'Power', 'input', 1),
    ],
    purchasedAt: '2022-08-13',
    removedAt: '2023-06-17',
    createdAt: '2022-08-13T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-monitor-main',
    name: 'LG UltraGear 27GR95QE (OLED)',
    model: '27GR95QE',
    category: 'Monitor',
    monitorSizeInches: '27',
    monitorResolution: '2560x1440',
    monitorRefreshRateHz: '240',
    ports: [
      P('p1', 'DisplayPort', 'input', 1, { supportsVideo: true, label: 'DP 1.4' }),
      P('p2', 'HDMI', 'input', 2, { supportsVideo: true, label: 'HDMI 2.0' }),
      P('p3', 'USB_A', 'output', 1),
      P('p4', 'MonitorArm', 'input', 1),
      P('p5', 'Power', 'input', 1),
    ],
    price: 168000,
    purchasedAt: '2025-11-14',
    createdAt: '2025-11-14T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-monitor-sub',
    name: 'Dell U2725QE',
    model: 'U2725QE',
    category: 'Monitor',
    monitorSizeInches: '27',
    monitorResolution: '3840x2160',
    monitorRefreshRateHz: '120',
    ports: [
      P('p1', 'DisplayPort', 'input', 1, { supportsVideo: true }),
      // Switch 2 Dock からの受け口。ここが空いていないと2台目のガジェットを繋げない
      P('p2', 'HDMI', 'input', 2, { supportsVideo: true }),
      P('p3', 'USB_C', 'input', 1, { supportsVideo: true, label: 'USB-C (DP Alt / PD)' }),
      P('p4', 'USB_A', 'output', 3),
      P('p5', 'MonitorArm', 'input', 1),
      P('p6', 'Power', 'input', 1),
    ],
    price: 69800,
    purchasedAt: '2026-03-21',
    createdAt: '2026-03-21T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-switch2',
    name: 'Nintendo Switch 2',
    model: 'Nintendo Switch 2',
    category: 'GameConsole',
    consoleFormFactor: 'stationary',
    ports: [
      // 映像が出るのは下部（ドック接続）だけ。上部は充電・データ専用で映像は出ない
      P('p1', 'USB_C', 'bidirectional', 1, { supportsVideo: true, label: 'USB-C (下部・Dock接続)' }),
      P('p2', 'USB_C', 'input', 1, { label: 'USB-C (上部・充電)' }),
      P('p3', 'Audio3_5mm', 'output', 1),
      P('p4', 'Bluetooth', 'bidirectional', 1),
    ],
    games: ['マリオカート ワールド', 'ゼルダの伝説 ティアーズ オブ ザ キングダム'],
    price: 49980,
    purchasedAt: '2026-06-05',
    createdAt: '2026-06-05T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-switch2-dock',
    name: 'Nintendo Switch 2 Dock',
    model: 'Nintendo Switch 2 Dock',
    category: 'Dock',
    ports: [
      P('p1', 'HDMI', 'output', 1, { supportsVideo: true, label: 'HDMI 2.1' }),
      P('p2', 'USB_A', 'output', 2, { label: 'USB-A (USB 2.0・前面)' }),
      // 本体を挿す専用端子。bidirectional だと出力側が空きポート扱いになり充電先にされる
      P('p3', 'USB_C', 'input', 1, { label: 'USB-C (本体接続)' }),
      // ドックの有線LANは使わず本体の Wi-Fi 接続。使っていない口は登録しない（PC と同じ方針）
      P('p4', 'Power', 'input', 1, { label: 'AC アダプタ' }),
    ],
    // 本体に付属するため単体の価格は持たない（合計金額の二重計上を避ける）
    memo: 'Switch 2 本体に付属',
    purchasedAt: '2026-06-05',
    createdAt: '2026-06-05T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-joycon',
    name: 'Nintendo Switch 2 Joy-Con (L)/(R)',
    category: 'Controller',
    ports: [P('p1', 'Bluetooth', 'bidirectional', 1)],
    // 相手を固定しないと、Bluetooth を持つ他のガジェットと結ばれる可能性がある
    bluetoothTargetGadgetIds: ['demo-gaming-switch2'],
    powerUsage: 'rechargeable',
    memo: 'Switch 2 本体に付属',
    purchasedAt: '2026-06-05',
    createdAt: '2026-06-05T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-mouse',
    name: 'Logicool G Pro X Superlight 2',
    model: 'G Pro X Superlight 2',
    category: 'Mouse',
    ports: [
      P('p1', 'USB_C', 'input', 1, { label: '充電' }),
      P('p2', 'USB_A', 'input', 1, { label: 'LIGHTSPEEDレシーバー', directAttach: true }),
    ],
    powerUsage: 'rechargeable',
    price: 21780,
    purchasedAt: '2023-07-02',
    createdAt: '2023-07-02T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-keyboard',
    name: 'Keychron Q1 Pro',
    model: 'Q1 Pro',
    category: 'Keyboard',
    ports: [P('p1', 'USB_C', 'input', 1, { label: '有線接続 / 充電' })],
    price: 30800,
    purchasedAt: '2023-07-02',
    createdAt: '2023-07-02T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-headset',
    name: 'HyperX Cloud Alpha Wireless',
    category: 'Headphone',
    ports: [
      P('p1', 'USB_A', 'input', 1, { label: 'USBドングル', directAttach: true }),
      P('p2', 'USB_C', 'input', 1, { label: '充電' }),
    ],
    powerUsage: 'rechargeable',
    price: 27800,
    purchasedAt: '2025-09-27',
    createdAt: '2025-09-27T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-audio-if',
    name: 'Focusrite Scarlett 2i2 (4th Gen)',
    category: 'AudioInterface',
    ports: [
      P('p1', 'USB_C', 'input', 1, { label: 'USB-C (PC接続)' }),
      P('p2', 'XLR_TRS_Combo', 'input', 2, { label: 'XLR/TRS コンボ ×2' }),
      P('p3', 'Audio6_3mm', 'output', 1, { label: '6.3mm ヘッドホン出力' }),
      P('p4', 'Audio6_3mm', 'output', 2, { label: '6.3mm TRS モニター出力' }),
    ],
    price: 29800,
    purchasedAt: '2026-02-11',
    createdAt: '2026-02-11T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-speaker',
    name: 'Yamaha HS5 スタジオモニター (R)',
    model: 'HS5',
    category: 'Speaker',
    ports: [P('p1', 'Audio6_3mm', 'input', 1, { label: '6.3mm TRS 入力' }), P('p2', 'XLR', 'input', 1), P('p3', 'Power', 'input', 1)],
    price: 45000,
    purchasedAt: '2026-02-11',
    createdAt: '2026-02-11T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-speaker-left',
    name: 'Yamaha HS5 スタジオモニター (L)',
    model: 'HS5',
    category: 'Speaker',
    ports: [P('p1', 'Audio6_3mm', 'input', 1, { label: '6.3mm TRS 入力' }), P('p2', 'XLR', 'input', 1), P('p3', 'Power', 'input', 1)],
    purchasedAt: '2026-02-11',
    createdAt: '2026-02-11T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-light',
    name: 'BenQ ScreenBar Halo',
    model: 'ScreenBar Halo',
    category: 'Light',
    ports: [P('p1', 'USB_A', 'input', 1, { label: 'USB-A 電源 (モニターから給電可)' })],
    price: 19900,
    purchasedAt: '2025-10-19',
    createdAt: '2025-10-19T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-arm',
    mounting: { type: 'attached_to', targetGadgetId: 'demo-gaming-desk' },
    name: 'Ergotron LX デュアルスタッキングアーム',
    category: 'MonitorArm',
    ports: [P('p1', 'MonitorArm', 'output', 2)],
    price: 33000,
    purchasedAt: '2025-11-14',
    createdAt: '2025-11-14T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-desk',
    name: 'FLEXISPOT E7',
    category: 'Desk',
    ports: [P('p1', 'Power', 'input', 1)],
    isHeightAdjustable: true,
    deskLiftType: 'electric',
    deskHeightMin: '58cm',
    deskHeightMax: '123cm',
    dimensions: '140 × 70 cm',
    price: 58000,
    purchasedAt: '2022-05-21',
    createdAt: '2022-05-21T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-chair',
    name: 'Herman Miller Aeron',
    category: 'Chair',
    ports: [],
    price: 198000,
    purchasedAt: '2022-07-09',
    createdAt: '2022-07-09T00:00:00.000Z',
  },
  powerStrip('demo-gaming-strip', 'サンワサプライ 電源タップ 10口', 10, 3480, '2022-05-21'),
  cable('demo-gaming-cable-dp', 'CableMatters DisplayPort 1.4 ケーブル 1.8m', 'DisplayPort', 1899, '2025-11-14'),
  cable('demo-gaming-cable-hdmi', 'Belkin HDMI 2.1 ケーブル 2m', 'HDMI', 3980, '2026-06-05'),
  {
    id: 'demo-gaming-charger',
    name: 'Anker 735 Charger GaNPrime 65W',
    category: 'Charger',
    ports: [
      P('p1', 'USB_C', 'output', 2),
      P('p2', 'USB_A', 'output', 1),
      P('p3', 'Power', 'input', 1),
    ],
    price: 6990,
    purchasedAt: '2023-07-02',
    createdAt: '2023-07-02T00:00:00.000Z',
  },
  {
    id: 'demo-gaming-phone',
    name: 'iPhone 16 Pro',
    category: 'Smartphone',
    ports: [P('p1', 'USB_C', 'input', 1)],
    powerUsage: 'rechargeable',
    price: 189800,
    purchasedAt: '2024-09-21',
    createdAt: '2024-09-21T00:00:00.000Z',
  },
  // ─── 撤去済み（デスクの歴史にだけ登場する）──────────────────
  {
    id: 'demo-gaming-monitor-old',
    name: 'LG 27UL500-W (27" 4K)',
    model: '27UL500',
    category: 'Monitor',
    monitorSizeInches: '27',
    monitorResolution: '3840x2160',
    ports: [
      P('p1', 'HDMI', 'input', 2, { supportsVideo: true }),
      P('p2', 'DisplayPort', 'input', 1, { supportsVideo: true }),
      P('p3', 'Power', 'input', 1),
    ],
    memo: 'OLED へ買い替えて引退',
    price: 42800,
    purchasedAt: '2022-08-13',
    removedAt: '2025-11-14',
    createdAt: '2022-08-13T00:00:00.000Z',
  },
]

const GAMING_DEMO: DemoDesk = {
  id: 'demo-gaming',
  name: 'ゲーミング',
  nameEn: 'Gaming',
  summaryJa: 'PC と Switch 2 を1つのデスクで共存させる構成。映像がどう分岐しているかを配線図で追える',
  summaryEn: 'A desk where a gaming PC and a Switch 2 live together. Follow how the video paths split.',
  goal: 'desk_tour',
  purposes: ['gaming'],
  outletCount: 4,
  gadgets: GAMING_GADGETS,
  activeGadgetIds: [
    'demo-gaming-desk', 'demo-gaming-chair', 'demo-gaming-arm',
    'demo-gaming-pc', 'demo-gaming-monitor-main', 'demo-gaming-switch2', 'demo-gaming-switch2-dock',
    'demo-gaming-mouse', 'demo-gaming-keyboard', 'demo-gaming-headset', 'demo-gaming-strip',
    'demo-gaming-cable-dp', 'demo-gaming-cable-hdmi',
  ],
  illustration: 'gaming-generated.jpg',
  placements: [
    zone('demo-gaming-pc', 'under_desk'),
    zone('demo-gaming-pc-old', 'under_desk'),
    zone('demo-gaming-monitor-main', 'back_center'),
    zone('demo-gaming-monitor-sub', 'back_right'),
    zone('demo-gaming-switch2', 'desk_right'),
    zone('demo-gaming-switch2-dock', 'desk_right'),
    zone('demo-gaming-joycon', 'front_right'),
    zone('demo-gaming-mouse', 'front_right'),
    zone('demo-gaming-keyboard', 'front_center'),
    zone('demo-gaming-headset', 'desk_left'),
    zone('demo-gaming-speaker', 'back_left'),
    zone('demo-gaming-speaker-left', 'back_right'),
    zone('demo-gaming-audio-if', 'desk_left'),
    zone('demo-gaming-light', 'desk_back'),
    zone('demo-gaming-arm', 'desk_back'),
    zone('demo-gaming-strip', 'under_desk'),
    zone('demo-gaming-charger', 'under_desk'),
    zone('demo-gaming-phone', 'front_left'),
  ],
  // PC→キーボードとPC→ヘッドセットの線が交差しない位置へ微調整する。
  nodeOffsets: { 'demo-gaming-headset': { dx: 0, dy: 40 } },
}

// ================================================================
// 2. クリエイター｜ノートPCから出る線を1本にする
// ================================================================
// 見どころ：Thunderbolt 入力を持つモニターをハブにして、
// MacBook から出る線を「TB ケーブル1本」だけにした構成。
// 映像・USBガジェット・給電140Wがすべてその1本に相乗りする。
//
// MacBook 側のポートを Thunderbolt と 3.5mm だけにしているのは、
// このデスクで実際に使っている口だけを登録しているため。
// HDMI や MagSafe を足すと配線図に「使っていない2本目の線」が生えて、
// 1本化したという構成の意図が読めなくなる。

const CREATOR_GADGETS: Gadget[] = [
  {
    id: 'demo-creator-pc',
    name: 'MacBook Pro 16" M4 Max',
    category: 'PC',
    pcFormFactor: 'laptop',
    pcOs: 'macOS',
    pcCpu: 'Apple M4 Max',
    pcRam: '48GB',
    pcStorage: '1TB SSD',
    pcThunderbolt: true,
    ports: [
      P('p1', 'Thunderbolt', 'bidirectional', 3, { supportsVideo: true, label: 'Thunderbolt 5' }),
      P('p2', 'Audio3_5mm', 'output', 1),
    ],
    price: 628800,
    purchasedAt: '2026-01-17',
    createdAt: '2026-01-17T00:00:00.000Z',
  },
  // 周辺機器を引き継いだ買い替え履歴。旧PCを省くと、モニターやキーボードだけの
  // デスクが約3年間続く不自然なタイムラインになる。
  {
    id: 'demo-creator-pc-old',
    name: 'MacBook Pro 14-inch (2021)',
    model: 'MacBook Pro 14-inch (2021)',
    category: 'PC',
    pcFormFactor: 'laptop',
    pcOs: 'macOS',
    pcCpu: 'Apple M1 Pro',
    pcRam: '16GB',
    pcStorage: '512GB SSD',
    pcThunderbolt: true,
    ports: [
      P('p1', 'Thunderbolt', 'bidirectional', 3, { supportsVideo: true, label: 'Thunderbolt 4' }),
      P('p2', 'Audio3_5mm', 'output', 1),
    ],
    purchasedAt: '2022-11-24',
    removedAt: '2026-01-17',
    createdAt: '2022-11-24T00:00:00.000Z',
  },
  {
    id: 'demo-creator-monitor',
    name: 'Dell UltraSharp U3225QE',
    model: 'U3225QE',
    category: 'Monitor',
    monitorSizeInches: '31.5',
    monitorResolution: '3840x2160',
    monitorRefreshRateHz: '120',
    ports: [
      // この1口が構成の要。映像・USBハブ・140W給電をまとめて引き受ける
      P('p1', 'Thunderbolt', 'input', 1, { supportsVideo: true, label: 'Thunderbolt 4 (映像 / データ / PD 140W給電)' }),
      P('p2', 'HDMI', 'input', 1, { supportsVideo: true }),
      P('p3', 'DisplayPort', 'input', 1, { supportsVideo: true }),
      P('p4', 'USB_A', 'output', 4),
      P('p5', 'USB_C', 'output', 2),
      P('p6', 'MonitorArm', 'input', 1),
      P('p7', 'Power', 'input', 1),
    ],
    price: 148000,
    purchasedAt: '2026-02-14',
    createdAt: '2026-02-14T00:00:00.000Z',
  },
  {
    id: 'demo-creator-tablet',
    name: 'Wacom Intuos Pro',
    model: 'Intuos Pro',
    category: 'PenTablet',
    // 無線でも使えるが、遅延を嫌ってこのデスクでは有線で繋いでいる
    ports: [P('p1', 'USB_C', 'input', 1, { label: 'PC接続 / 充電' })],
    price: 52800,
    purchasedAt: '2023-08-19',
    createdAt: '2023-08-19T00:00:00.000Z',
  },
  {
    id: 'demo-creator-audio-if',
    name: 'Focusrite Scarlett 2i2 (4th Gen)',
    category: 'AudioInterface',
    ports: [
      P('p1', 'USB_C', 'input', 1, { label: 'Host' }),
      P('p2', 'XLR_TRS_Combo', 'input', 2, { label: 'XLR/TRS コンボ ×2' }),
      P('p3', 'Audio6_3mm', 'output', 2, { label: '6.3mm TRS モニター出力' }),
      P('p4', 'Audio6_3mm', 'output', 1, { label: '6.3mm ヘッドホン出力' }),
    ],
    price: 29800,
    purchasedAt: '2025-11-22',
    createdAt: '2025-11-22T00:00:00.000Z',
  },
  {
    id: 'demo-creator-mic',
    name: 'Shure MV7+',
    model: 'MV7+',
    category: 'Microphone',
    ports: [
      // USB でも繋がるが、このデスクでは XLR でオーディオIFに入れている
      P('p1', 'XLR', 'output', 1, { label: 'XLR アナログ出力' }),
      P('p2', 'MicArm', 'input', 1),
    ],
    price: 52000,
    purchasedAt: '2025-12-13',
    createdAt: '2025-12-13T00:00:00.000Z',
  },
  {
    id: 'demo-creator-mic-arm',
    name: 'RØDE PSA1+',
    category: 'MicArm',
    ports: [P('p1', 'MicArm', 'output', 1)],
    price: 19800,
    purchasedAt: '2025-12-13',
    createdAt: '2025-12-13T00:00:00.000Z',
  },
  {
    id: 'demo-creator-speaker',
    name: 'Yamaha HS5 スタジオモニター (R)',
    model: 'HS5',
    category: 'Speaker',
    // モニタースピーカーはオーディオIFの TRS 出力から受ける
    ports: [P('p1', 'Audio6_3mm', 'input', 1, { label: '6.3mm TRS 入力' }), P('p2', 'Power', 'input', 1)],
    price: 45000,
    purchasedAt: '2026-04-11',
    createdAt: '2026-04-11T00:00:00.000Z',
  },
  {
    id: 'demo-creator-speaker-left',
    name: 'Yamaha HS5 スタジオモニター (L)',
    model: 'HS5',
    category: 'Speaker',
    ports: [P('p1', 'Audio6_3mm', 'input', 1, { label: '6.3mm TRS 入力' }), P('p2', 'Power', 'input', 1)],
    purchasedAt: '2026-04-11',
    createdAt: '2026-04-11T00:00:00.000Z',
  },
  {
    id: 'demo-creator-keyboard',
    name: 'HHKB Professional Hybrid',
    category: 'Keyboard',
    ports: [P('p1', 'USB_C', 'input', 1, { label: '有線接続 / 充電' })],
    price: 36850,
    purchasedAt: '2022-11-24',
    createdAt: '2022-11-24T00:00:00.000Z',
  },
  {
    id: 'demo-creator-mouse',
    name: 'Logicool MX Master 3S',
    model: 'MX Master 3S',
    category: 'Mouse',
    ports: [P('p1', 'USB_C', 'input', 1, { label: '充電' }), P('p2', 'Bluetooth', 'bidirectional')],
    bluetoothTargetGadgetIds: ['demo-creator-pc'],
    powerUsage: 'rechargeable',
    price: 14850,
    purchasedAt: '2023-02-18',
    createdAt: '2023-02-18T00:00:00.000Z',
  },
  {
    id: 'demo-creator-ssd',
    name: 'Samsung T9 Portable SSD 2TB',
    model: 'T9',
    category: 'Storage',
    storageCapacity: '2TB',
    ports: [P('p1', 'USB_C', 'input', 1, { label: 'Host' })],
    price: 32800,
    purchasedAt: '2026-06-27',
    createdAt: '2026-06-27T00:00:00.000Z',
  },
  {
    id: 'demo-creator-arm',
    mounting: { type: 'attached_to', targetGadgetId: 'demo-creator-desk' },
    name: 'Ergotron LX シングルモニターアーム',
    category: 'MonitorArm',
    ports: [P('p1', 'MonitorArm', 'output', 1)],
    price: 28000,
    purchasedAt: '2026-02-14',
    createdAt: '2026-02-14T00:00:00.000Z',
  },
  {
    id: 'demo-creator-light',
    name: 'BenQ ScreenBar Plus',
    model: 'ScreenBar Plus',
    category: 'Light',
    ports: [P('p1', 'USB_A', 'input', 1, { label: 'USB-A 電源' })],
    price: 17900,
    purchasedAt: '2025-09-06',
    createdAt: '2025-09-06T00:00:00.000Z',
  },
  {
    id: 'demo-creator-desk',
    name: 'FLEXISPOT E7 Pro',
    category: 'Desk',
    ports: [P('p1', 'Power', 'input', 1)],
    isHeightAdjustable: true,
    deskLiftType: 'electric',
    dimensions: '160 × 70 cm',
    price: 69800,
    purchasedAt: '2022-11-24',
    createdAt: '2022-11-24T00:00:00.000Z',
  },
  {
    id: 'demo-creator-chair',
    name: 'OKAMURA Contessa II',
    category: 'Chair',
    ports: [],
    price: 178000,
    purchasedAt: '2023-03-11',
    createdAt: '2023-03-11T00:00:00.000Z',
  },
  powerStrip('demo-creator-strip', 'エレコム 電源タップ 6口', 6, 2780, '2022-11-24'),
  cable('demo-creator-cable-tb4', 'Anker Thunderbolt 4 ケーブル 0.7m', 'Thunderbolt', 3990, '2026-02-14'),
  // ─── 撤去済み ────────────────────────────────────────────────
  {
    id: 'demo-creator-monitor-old',
    name: 'LG 27UK850-W',
    model: '27UK850',
    category: 'Monitor',
    monitorSizeInches: '27',
    monitorResolution: '3840x2160',
    ports: [
      P('p1', 'USB_C', 'input', 1, { supportsVideo: true }),
      P('p2', 'HDMI', 'input', 2, { supportsVideo: true }),
      P('p3', 'USB_A', 'output', 2),
      P('p4', 'Power', 'input', 1),
    ],
    memo: 'Thunderbolt 対応モニターへ買い替え。ケーブル1本化のきっかけ',
    price: 52800,
    purchasedAt: '2022-12-03',
    removedAt: '2026-02-14',
    createdAt: '2022-12-03T00:00:00.000Z',
  },
]

const CREATOR_DEMO: DemoDesk = {
  id: 'demo-creator',
  name: 'クリエイター',
  nameEn: 'Creator',
  summaryJa: 'Thunderbolt モニターをハブにして、ノートPCから出る線をケーブル1本にした構成',
  summaryEn: 'A Thunderbolt monitor acts as the hub, so only one cable leaves the laptop.',
  goal: 'clean_wiring',
  purposes: ['creative', 'work'],
  outletCount: 3,
  gadgets: CREATOR_GADGETS,
  activeGadgetIds: [
    'demo-creator-desk', 'demo-creator-chair', 'demo-creator-arm',
    'demo-creator-pc', 'demo-creator-monitor', 'demo-creator-keyboard',
    'demo-creator-mouse', 'demo-creator-ssd', 'demo-creator-strip',
    'demo-creator-cable-tb4',
  ],
  illustration: 'creator-generated.jpg',
  placements: [
    zone('demo-creator-pc', 'desk_left'),
    zone('demo-creator-pc-old', 'desk_left'),
    zone('demo-creator-monitor', 'back_center'),
    zone('demo-creator-tablet', 'front_center'),
    zone('demo-creator-audio-if', 'desk_right'),
    zone('demo-creator-mic', 'back_left'),
    zone('demo-creator-mic-arm', 'back_left'),
    zone('demo-creator-speaker', 'back_right'),
    zone('demo-creator-speaker-left', 'back_left'),
    zone('demo-creator-keyboard', 'front_center'),
    zone('demo-creator-mouse', 'front_right'),
    zone('demo-creator-ssd', 'desk_right'),
    zone('demo-creator-arm', 'desk_back'),
    zone('demo-creator-light', 'desk_back'),
    zone('demo-creator-strip', 'under_desk'),
  ],
}

// ================================================================
// 3. 外出ワーク｜カフェ・出張先の作業環境
// ================================================================
// 見どころ：コンセントが1口しかない前提。
// 充電器1台とモバイルバッテリーで全ガジェットをまかなうため、
// 「どのガジェットがどの口から給電されているか」が構成のすべてになる。
// デスクも椅子も持たない（＝家具のないデスク）ことも、このデモの見せどころ。

const MOBILE_GADGETS: Gadget[] = [
  {
    id: 'demo-mobile-pc',
    name: 'ThinkPad X1 Carbon Gen 13',
    category: 'PC',
    pcFormFactor: 'laptop',
    pcOs: 'Windows',
    pcCpu: 'Core Ultra 7 258V',
    pcRam: '32GB',
    pcStorage: '1TB SSD',
    pcThunderbolt: true,
    ports: [
      P('p1', 'Thunderbolt', 'bidirectional', 2, { supportsVideo: true, label: 'Thunderbolt 4 (映像 / 給電)' }),
      P('p2', 'USB_A', 'output', 2),
      P('p3', 'Audio3_5mm', 'output', 1),
    ],
    price: 248000,
    purchasedAt: '2024-11-15',
    createdAt: '2024-11-15T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-monitor',
    name: 'ASUS ZenScreen MB16ACV (ポータブル)',
    model: 'ZenScreen MB16ACV',
    category: 'Monitor',
    monitorSizeInches: '15.6',
    monitorResolution: '1920x1080',
    ports: [P('p1', 'USB_C', 'input', 2, { supportsVideo: true, label: 'USB-C (映像 / 給電)' })],
    price: 28800,
    purchasedAt: '2025-11-08',
    createdAt: '2025-11-08T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-charger',
    name: 'CIO NovaPort TRIO 65W',
    category: 'Charger',
    ports: [
      P('p1', 'USB_C', 'output', 2),
      P('p2', 'USB_A', 'output', 1),
      P('p3', 'Power', 'input', 1),
    ],
    memo: 'カフェの1口をこれ1台で分ける',
    price: 6980,
    purchasedAt: '2024-11-15',
    createdAt: '2024-11-15T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-battery',
    name: 'Anker Prime Power Bank 20000mAh (200W)',
    category: 'MobileBattery',
    batteryCapacityMah: '20000',
    ports: [
      P('p1', 'USB_C', 'bidirectional', 2, { label: 'USB-C 入出力' }),
      P('p2', 'USB_A', 'output', 1),
    ],
    powerUsage: 'rechargeable',
    memo: 'コンセントが取れない場所ではこれが電源になる',
    price: 19990,
    purchasedAt: '2026-06-14',
    createdAt: '2026-06-14T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-hub',
    name: 'Anker 552 USB-C Hub (7-in-1)',
    model: '552 (A8458)',
    category: 'Hub',
    ports: [
      P('p1', 'USB_C', 'input', 1, { label: 'Host' }),
      P('p2', 'HDMI', 'output', 1, { supportsVideo: true, label: 'HDMI 4K' }),
      P('p3', 'USB_A', 'output', 2),
      P('p4', 'USB_C', 'output', 1, { label: 'USB-C PD' }),
      P('p5', 'SDCard', 'input', 1),
      // 有線LANの口も付いているが、出先で挿す機会がないので登録していない
    ],
    price: 7990,
    purchasedAt: '2026-03-07',
    createdAt: '2026-03-07T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-ssd',
    name: 'Samsung T7 Shield 2TB',
    model: 'T7 Shield',
    category: 'Storage',
    storageCapacity: '2TB',
    ports: [P('p1', 'USB_C', 'input', 1, { label: 'Host' })],
    price: 24800,
    purchasedAt: '2026-04-25',
    createdAt: '2026-04-25T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-mouse',
    name: 'Logicool MX Anywhere 3S',
    model: 'MX Anywhere 3S',
    category: 'Mouse',
    ports: [P('p1', 'USB_C', 'input', 1, { label: '充電' }), P('p2', 'Bluetooth', 'bidirectional')],
    bluetoothTargetGadgetIds: ['demo-mobile-pc'],
    powerUsage: 'rechargeable',
    price: 13200,
    purchasedAt: '2024-11-15',
    createdAt: '2024-11-15T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-earphone',
    name: 'Sony WF-1000XM5',
    category: 'Earphone',
    ports: [
      P('p1', 'USB_C', 'input', 1, { label: '充電' }),
      P('p2', 'Bluetooth', 'bidirectional', 1),
    ],
    bluetoothTargetGadgetIds: ['demo-mobile-pc'],
    powerUsage: 'rechargeable',
    price: 36000,
    purchasedAt: '2025-09-13',
    createdAt: '2025-09-13T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-phone',
    name: 'iPhone 16 Pro',
    category: 'Smartphone',
    ports: [P('p1', 'USB_C', 'input', 1)],
    powerUsage: 'rechargeable',
    price: 189800,
    purchasedAt: '2024-09-21',
    createdAt: '2024-09-21T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-ipad',
    name: 'iPad mini (7th Gen)',
    category: 'Tablet',
    smartDeviceScreenSize: '8.3',
    smartDeviceStorage: '256GB',
    ports: [P('p1', 'USB_C', 'input', 1)],
    powerUsage: 'rechargeable',
    price: 78800,
    purchasedAt: '2026-01-31',
    createdAt: '2026-01-31T00:00:00.000Z',
  },
  {
    id: 'demo-mobile-watch',
    name: 'Apple Watch Series 10',
    category: 'Smartwatch',
    ports: [P('p1', 'USB_C', 'input', 1, { label: 'マグネット充電（専用ケーブル）' })],
    powerUsage: 'rechargeable',
    price: 59800,
    purchasedAt: '2024-10-04',
    createdAt: '2024-10-04T00:00:00.000Z',
  },
  // ─── 撤去済み ────────────────────────────────────────────────
  {
    id: 'demo-mobile-battery-old',
    name: 'Anker PowerCore 10000',
    category: 'MobileBattery',
    batteryCapacityMah: '10000',
    ports: [P('p1', 'microUSB', 'input', 1, { label: '本体充電' }), P('p2', 'USB_A', 'output', 1)],
    powerUsage: 'rechargeable',
    memo: 'ノートPCを充電できず、20000mAh へ買い替え',
    price: 3990,
    purchasedAt: '2024-11-15',
    removedAt: '2026-06-14',
    createdAt: '2024-11-15T00:00:00.000Z',
  },
]

export const LEGACY_MOBILE_DEMO: DemoDesk = {
  id: 'demo-mobile',
  name: '外出ワーク',
  nameEn: 'Mobile Work',
  summaryJa: 'コンセント1口だけで組む持ち出し用の作業環境。どの機材がどこから給電されているかを追える',
  summaryEn: 'A carry-anywhere setup built around a single wall outlet. See where every device draws power.',
  goal: 'first_setup',
  purposes: ['work'],
  // カフェの席で使える口は1つ。ここが構成のすべての制約になる
  outletCount: 1,
  gadgets: MOBILE_GADGETS,
  activeGadgetIds: [
    'demo-mobile-pc', 'demo-mobile-charger', 'demo-mobile-battery',
    'demo-mobile-mouse', 'demo-mobile-phone',
  ],
  illustration: 'mobile-generated.jpg',
  placements: [
    zone('demo-mobile-pc', 'desk_left'),
    zone('demo-mobile-monitor', 'back_center'),
    zone('demo-mobile-charger', 'desk_right'),
    zone('demo-mobile-battery', 'desk_left'),
    zone('demo-mobile-hub', 'desk_left'),
    zone('demo-mobile-ssd', 'desk_left'),
    zone('demo-mobile-mouse', 'front_right'),
    zone('demo-mobile-earphone', 'desk_right'),
    zone('demo-mobile-phone', 'front_left'),
    zone('demo-mobile-ipad', 'desk_right'),
    zone('demo-mobile-watch', 'front_left'),
  ],
}

// ================================================================
// 4. 音楽・DTM｜宅録スタジオ
// ================================================================
// 見どころ：他の3本に出てこない「音の経路」。
// マイク・ギター・シンセがそれぞれ XLR / 6.3mm でオーディオIFに集まり、
// IF のモニター出力からスピーカーとヘッドホンへ返る。
// USB とコンセントだけで説明できない配線があることを、この1本で見せる。

const DTM_GADGETS: Gadget[] = [
  {
    id: 'demo-dtm-pc',
    name: 'Mac mini M4 Pro',
    category: 'PC',
    pcFormFactor: 'mini',
    pcOs: 'macOS',
    pcCpu: 'Apple M4 Pro',
    pcRam: '48GB',
    pcStorage: '1TB SSD',
    pcThunderbolt: true,
    ports: [
      P('p1', 'Thunderbolt', 'bidirectional', 3, { supportsVideo: true, label: 'Thunderbolt 5' }),
      P('p2', 'USB_A', 'output', 2),
      P('p3', 'Audio3_5mm', 'output', 1),
      P('p4', 'Power', 'input', 1),
    ],
    price: 248800,
    purchasedAt: '2024-11-08',
    createdAt: '2024-11-08T00:00:00.000Z',
  },
  // 旧オーディオIFがPC不在で登場しないよう、Mac mini買い替え前のホストを残す。
  {
    id: 'demo-dtm-pc-old',
    name: 'Mac mini (M1, 2020)',
    model: 'Mac mini (M1, 2020)',
    category: 'PC',
    pcFormFactor: 'mini',
    pcOs: 'macOS',
    pcCpu: 'Apple M1',
    pcRam: '16GB',
    pcStorage: '512GB SSD',
    pcThunderbolt: true,
    ports: [
      P('p1', 'Thunderbolt', 'bidirectional', 2, { supportsVideo: true, label: 'Thunderbolt / USB 4' }),
      P('p2', 'USB_A', 'output', 2),
      P('p3', 'HDMI', 'output', 1, { supportsVideo: true }),
      P('p4', 'Audio3_5mm', 'output', 1),
      P('p5', 'Power', 'input', 1),
    ],
    purchasedAt: '2021-05-08',
    removedAt: '2024-11-08',
    createdAt: '2021-05-08T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-monitor',
    name: 'BenQ PD3225U',
    model: 'PD3225U',
    category: 'Monitor',
    monitorSizeInches: '31.5',
    monitorResolution: '3840x2160',
    ports: [
      P('p1', 'Thunderbolt', 'input', 1, { supportsVideo: true, label: 'Thunderbolt 3 (映像 / データ / PD 90W給電)' }),
      P('p2', 'HDMI', 'input', 2, { supportsVideo: true }),
      P('p3', 'DisplayPort', 'input', 1, { supportsVideo: true }),
      P('p4', 'USB_A', 'output', 4),
      P('p5', 'MonitorArm', 'input', 1),
      P('p6', 'Power', 'input', 1),
    ],
    price: 138000,
    purchasedAt: '2024-11-08',
    createdAt: '2024-11-08T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-audio-if',
    name: 'MOTU M4',
    category: 'AudioInterface',
    // コンボジャックはマイクの XLR も楽器の 6.3mm も受ける。
    // XLR だけで登録すると、ギターやシンセのフォーン出力が繋ぎ先を失って図に浮く
    ports: [
      P('p1', 'USB_C', 'input', 1, { label: 'Host' }),
      P('p2', 'XLR_TRS_Combo', 'input', 2, { label: 'XLR/TRS コンボ ×2' }),
      P('p3', 'Audio6_3mm', 'input', 2, { label: '6.3mm ライン / 楽器入力' }),
      P('p4', 'Audio6_3mm', 'output', 2, { label: '6.3mm TRS モニター出力' }),
      P('p5', 'Audio6_3mm', 'output', 1, { label: '6.3mm ヘッドホン出力' }),
    ],
    price: 42900,
    purchasedAt: '2026-02-21',
    createdAt: '2026-02-21T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-mic',
    name: 'Audio-Technica AT4040',
    model: 'AT4040',
    category: 'Microphone',
    ports: [
      P('p1', 'XLR', 'output', 1, { label: 'XLR 出力（ファンタム電源）' }),
      P('p2', 'MicArm', 'input', 1),
    ],
    price: 42000,
    purchasedAt: '2026-02-21',
    createdAt: '2026-02-21T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-mic-arm',
    name: 'Blue Compass',
    category: 'MicArm',
    ports: [P('p1', 'MicArm', 'output', 1)],
    price: 16500,
    purchasedAt: '2026-03-14',
    createdAt: '2026-03-14T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-midi-keyboard',
    name: 'Arturia KeyLab Essential 88 MK3',
    category: 'Instrument',
    // 音は出さず MIDI だけを送る鍵盤。USB バスパワーなので USB 1本で PC と繋がり、電源線は要らない
    ports: [
      P('p1', 'USB_C', 'input', 1, { label: 'Host' }),
    ],
    price: 64900,
    purchasedAt: '2026-01-10',
    createdAt: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-synth',
    name: 'Korg Minilogue XD',
    category: 'Instrument',
    ports: [
      P('p1', 'Audio6_3mm', 'output', 1, { label: '6.3mm 出力' }),
      P('p2', 'USB_C', 'input', 1, { label: 'Host' }),
      P('p3', 'MIDI', 'output', 1, { label: 'MIDI OUT' }),
      P('p4', 'MIDI', 'input', 1, { label: 'MIDI IN' }),
      P('p5', 'Power', 'input', 1),
    ],
    price: 88000,
    purchasedAt: '2026-05-16',
    createdAt: '2026-05-16T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-guitar',
    name: 'Fender Stratocaster',
    category: 'Instrument',
    ports: [P('p1', 'Audio6_3mm', 'output', 1, { label: '6.3mm フォーン出力' })],
    price: 148000,
    purchasedAt: '2022-06-12',
    createdAt: '2022-06-12T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-speaker',
    name: 'Yamaha HS7 スタジオモニター (R)',
    model: 'HS7',
    category: 'Speaker',
    ports: [P('p1', 'Audio6_3mm', 'input', 1, { label: '6.3mm TRS 入力' }), P('p2', 'Power', 'input', 1)],
    price: 66000,
    purchasedAt: '2025-10-25',
    createdAt: '2025-10-25T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-speaker-left',
    name: 'Yamaha HS7 スタジオモニター (L)',
    model: 'HS7',
    category: 'Speaker',
    ports: [P('p1', 'Audio6_3mm', 'input', 1, { label: '6.3mm TRS 入力' }), P('p2', 'Power', 'input', 1)],
    purchasedAt: '2025-10-25',
    createdAt: '2025-10-25T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-headphone',
    name: 'Audio-Technica ATH-M50x',
    category: 'Headphone',
    // オーディオIF のヘッドホン出力（6.3mm）から鳴らすので、変換を挟む線になる
    ports: [P('p1', 'Audio3_5mm', 'input', 1)],
    price: 19800,
    purchasedAt: '2022-08-01',
    createdAt: '2022-08-01T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-keyboard',
    name: 'Apple Magic Keyboard (Touch ID)',
    model: 'Magic Keyboard Touch ID',
    category: 'Keyboard',
    ports: [P('p1', 'USB_C', 'input', 1, { label: '充電' }), P('p2', 'Bluetooth', 'bidirectional')],
    bluetoothTargetGadgetIds: ['demo-dtm-pc'],
    powerUsage: 'rechargeable',
    price: 19800,
    purchasedAt: '2024-11-08',
    createdAt: '2024-11-08T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-trackpad',
    name: 'Apple Magic Trackpad',
    model: 'Magic Trackpad',
    category: 'Mouse',
    ports: [P('p1', 'USB_C', 'input', 1, { label: '充電' }), P('p2', 'Bluetooth', 'bidirectional')],
    bluetoothTargetGadgetIds: ['demo-dtm-pc'],
    powerUsage: 'rechargeable',
    price: 19800,
    purchasedAt: '2024-11-08',
    createdAt: '2024-11-08T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-ssd',
    name: 'LaCie Rugged Mini SSD 1TB',
    category: 'Storage',
    storageCapacity: '1TB',
    memo: 'サンプルライブラリ置き場',
    ports: [P('p1', 'USB_C', 'input', 1, { label: 'Host' })],
    price: 24800,
    purchasedAt: '2025-12-13',
    createdAt: '2025-12-13T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-arm',
    mounting: { type: 'attached_to', targetGadgetId: 'demo-dtm-desk' },
    name: 'FlexiSpot F9L シングルモニターアーム',
    category: 'MonitorArm',
    ports: [P('p1', 'MonitorArm', 'output', 1)],
    price: 12800,
    purchasedAt: '2024-11-08',
    createdAt: '2024-11-08T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-desk',
    name: 'IKEA KARLBY ワークトップ + ALEX',
    category: 'Desk',
    ports: [],
    dimensions: '186 × 65 cm',
    price: 42000,
    purchasedAt: '2022-06-12',
    createdAt: '2022-06-12T00:00:00.000Z',
  },
  {
    id: 'demo-dtm-chair',
    name: 'イトーキ サリダ YL9',
    category: 'Chair',
    ports: [],
    price: 42900,
    purchasedAt: '2023-01-15',
    createdAt: '2023-01-15T00:00:00.000Z',
  },
  powerStrip('demo-dtm-strip', 'サンワサプライ 電源タップ 8口', 8, 3280, '2022-06-12'),
  cable('demo-dtm-cable-xlr', 'mogami 2549 XLR マイクケーブル 3m', 'XLR', 3480, '2026-02-21'),
  cable('demo-dtm-cable-usbc', 'Anker USB-C & USB-C ケーブル 1m', 'USB_C', 1290, '2026-02-21'),
  // ─── 撤去済み ────────────────────────────────────────────────
  {
    id: 'demo-dtm-audio-if-old',
    name: 'Focusrite Scarlett Solo (4th Gen)',
    category: 'AudioInterface',
    ports: [
      P('p1', 'USB_C', 'input', 1, { label: 'USB-C (PC接続)' }),
      P('p2', 'XLR', 'input', 1, { label: 'XLR マイク入力' }),
      P('p3', 'Audio6_3mm_TS', 'input', 1, { label: '6.3mm 楽器入力' }),
      P('p4', 'Audio6_3mm', 'output', 1, { label: '6.3mm ヘッドホン出力' }),
      P('p5', 'Audio6_3mm', 'output', 2, { label: '6.3mm TRS モニター出力' }),
    ],
    memo: '入力1系統では足りなくなり MOTU M4 へ。最初の1台',
    price: 17800,
    purchasedAt: '2021-05-08',
    removedAt: '2026-02-21',
    createdAt: '2021-05-08T00:00:00.000Z',
  },
]

const DTM_DEMO: DemoDesk = {
  id: 'demo-dtm',
  name: '音楽・DTM',
  nameEn: 'Music & DTM',
  summaryJa: 'マイクとMIDIキーボードを小型オーディオIFにつなぐ、最小限の宅録構成',
  summaryEn: 'A minimal home-recording setup with a mic, MIDI keyboard, and compact audio interface.',
  goal: 'desk_tour',
  purposes: ['music', 'creative'],
  outletCount: 3,
  gadgets: DTM_GADGETS,
  activeGadgetIds: [
    'demo-dtm-desk', 'demo-dtm-chair', 'demo-dtm-arm',
    'demo-dtm-pc', 'demo-dtm-monitor', 'demo-dtm-audio-if', 'demo-dtm-mic',
    'demo-dtm-midi-keyboard', 'demo-dtm-headphone', 'demo-dtm-strip',
    'demo-dtm-cable-xlr', 'demo-dtm-cable-usbc',
  ],
  illustration: 'dtm-generated.jpg',
  placements: [
    zone('demo-dtm-pc', 'desk_right'),
    zone('demo-dtm-pc-old', 'desk_right'),
    zone('demo-dtm-monitor', 'back_center'),
    zone('demo-dtm-audio-if', 'desk_right'),
    zone('demo-dtm-mic', 'back_left'),
    zone('demo-dtm-mic-arm', 'back_left'),
    zone('demo-dtm-midi-keyboard', 'front_center'),
    zone('demo-dtm-synth', 'desk_left'),
    zone('demo-dtm-guitar', 'desk_left'),
    zone('demo-dtm-speaker', 'back_right'),
    zone('demo-dtm-speaker-left', 'back_left'),
    zone('demo-dtm-headphone', 'desk_left'),
    zone('demo-dtm-keyboard', 'front_center'),
    zone('demo-dtm-trackpad', 'front_right'),
    zone('demo-dtm-ssd', 'desk_right'),
    zone('demo-dtm-arm', 'desk_back'),
    zone('demo-dtm-strip', 'under_desk'),
  ],
}

export const DEMO_DESKS: DemoDesk[] = [GAMING_DEMO, CREATOR_DEMO, DTM_DEMO]

const AFFORDABLE_DEMO_OVERRIDES: Record<string, Partial<Gadget>> = {
  'demo-gaming-pc': { name: 'エントリー ゲーミングPC', model: 'RTX 4060', pcCpu: 'Core i5', pcGpu: 'GeForce RTX 4060', pcRam: '16GB', price: 129800 },
  'demo-gaming-monitor-main': { name: '24インチ 165Hz モニター', model: 'FHD 165Hz', monitorSizeInches: '24', monitorResolution: '1920x1080', monitorRefreshRateHz: '165', price: 19800 },
  'demo-gaming-mouse': { name: 'ワイヤレス ゲーミングマウス', price: 3980 },
  'demo-gaming-keyboard': { name: 'コンパクト メカニカルキーボード', price: 5980 },
  'demo-gaming-headset': { name: '有線ゲーミングヘッドセット', price: 5980 },
  'demo-gaming-strip': { name: '電源タップ 6口', price: 2180 },
  'demo-creator-pc': { name: '14インチ クリエイターノート', model: '16GB / 512GB', price: 148000 },
  'demo-creator-monitor': { name: '27インチ USB-C モニター', model: 'WQHD USB-C', price: 39800 },
  'demo-creator-keyboard': { name: '薄型Bluetoothキーボード', price: 4980 },
  'demo-creator-mouse': { name: '静音Bluetoothマウス', price: 3980 },
  'demo-creator-ssd': { name: 'ポータブルSSD 1TB', price: 9980 },
  'demo-creator-strip': { name: '電源タップ 6口', price: 2180 },
  'demo-mobile-pc': { name: '13インチ 軽量ノートPC', model: '16GB / 512GB', price: 99800 },
  'demo-mobile-charger': { name: '65W USB-C充電器', price: 4980 },
  'demo-mobile-battery': { name: '10000mAh モバイルバッテリー', price: 7980 },
  'demo-mobile-mouse': { name: '薄型Bluetoothマウス', price: 3980 },
  'demo-mobile-phone': { name: 'ミドルレンジ スマートフォン', price: 59800 },
  'demo-dtm-pc': { name: 'コンパクト制作PC', model: '16GB / 512GB', price: 84800 },
  'demo-dtm-monitor': { name: '24インチ IPSモニター', model: 'FHD IPS', price: 19800 },
  'demo-dtm-audio-if': { name: '2入力 オーディオインターフェース', price: 16800 },
  'demo-dtm-mic': { name: '入門コンデンサーマイク', price: 8980 },
  'demo-dtm-midi-keyboard': { name: '25鍵 MIDIキーボード', price: 12980 },
  'demo-dtm-headphone': { name: '密閉型モニターヘッドホン', price: 5980 },
  'demo-dtm-strip': { name: '電源タップ 6口', price: 2180 },
}

/**
 * 歴史機能の見本は各デスク「買い替えを見せる周辺機器1件 + 当時のホスト」に絞り、
 * 現在構成の理解を邪魔しないようにする。
 * 旧ホストを外すと、その期間はPC不在になってマウス・キーボードが繋ぐ相手を失い、
 * 履歴再生で線の無いガジェットが浮く（creator では約3年ぶん続いていた）。
 */
const DEMO_HISTORY_GADGET_IDS: Record<string, string[]> = {
  'demo-gaming': ['demo-gaming-monitor-old', 'demo-gaming-pc-old'],
  'demo-creator': ['demo-creator-monitor-old', 'demo-creator-pc-old'],
  'demo-mobile': ['demo-mobile-battery-old'],
  'demo-dtm': ['demo-dtm-audio-if-old', 'demo-dtm-pc-old'],
}

// ─── デモ定義 → 実際の DeskPlan ──────────────────────────────────

export interface BuiltDemoDesk {
  demo: DemoDesk
  plan: DeskPlan
  /** 撤去済みを含む全ガジェット（歴史アニメーションが過去のイベントを描くのに要る） */
  gadgets: Gadget[]
  /** 現役のガジェットだけ。台数・合計金額はこちらで数える */
  activeGadgets: Gadget[]
  totalPrice: number
}

/**
 * デモ定義から、アプリが読むのと同じ形の DeskPlan を組み立てる。
 *
 * 配線と配線図は手書きせず generateWiring / reconcileMap に通す。
 * 手書きすると配線エンジンを直したときにデモだけ古い線が残り、
 * 「アプリが引く線」と「デモに写っている線」が食い違う。
 */
/** 全デモデスクをまとめて構築する。scripts/publishDemoDesks.ts から使う */
export function buildAllDemoDesks(lang: 'ja' | 'en' = 'ja'): BuiltDemoDesk[] {
  return DEMO_DESKS.map((demo) => buildDemoDesk(demo, lang))
}

export function buildDemoDesk(demo: DemoDesk, lang: 'ja' | 'en' = 'ja'): BuiltDemoDesk {
  const activeIds = demo.activeGadgetIds ? new Set(demo.activeGadgetIds) : null
  const includedIds = activeIds
    ? new Set([...activeIds, ...(DEMO_HISTORY_GADGET_IDS[demo.id] ?? [])])
    : null
  const included = demo.gadgets.filter((gadget) => !includedIds || includedIds.has(gadget.id))
  // アーム本体を見本から外したデスクでは、支えられる側の「アームを使用」も外す。
  // アームの絵（ArmMountIcon）はモニター・マイク自身のこの印だけで出るので、残すと
  // 機材一覧に無いアームがモニターに付いて見える
  const armTypes = new Set(included
    .filter((g) => !g.removedAt && (g.category === 'MonitorArm' || g.category === 'MicArm'))
    .map((g) => g.category))
  const gadgets = included.map((gadget) => ({
    ...gadget,
    ...(AFFORDABLE_DEMO_OVERRIDES[gadget.id] ?? {}),
    ports: gadget.ports.filter((port) =>
      !(port.direction === 'input' && (port.type === 'MonitorArm' || port.type === 'MicArm') && !armTypes.has(port.type))),
  }))
  const activeGadgets = gadgets.filter((g) => !g.removedAt)
  const selectedGadgetIds = activeGadgets.map((g) => g.id)

  // 撤去済みも含めて全ガジェットの使用期間を持たせる。
  // これが無いと公開時に撤去済みのガジェットが落ち、デスクの歴史が「増える一方」になる
  const gadgetUsage = Object.fromEntries(
    gadgets.map((g) => [g.id, { introducedAt: g.purchasedAt, removedAt: g.removedAt }]),
  )

  const createdAt = gadgets
    .map((g) => g.createdAt)
    .reduce((oldest, at) => (at < oldest ? at : oldest), gadgets[0].createdAt)

  const base: DeskPlan = {
    id: demo.id,
    name: demo.name,
    goal: demo.goal,
    purposes: demo.purposes,
    selectedGadgetIds,
    gadgetUsage,
    placements: demo.placements,
    outletCount: demo.outletCount,
    outletCountVersion: 2,
    createdAt,
    updatedAt: new Date().toISOString(),
  }

  const wiringResult = generateWiring(gadgets, base, lang)
  // デモは「完成しているデスク」なので、自動下書きのままの破線ではなく確定済みの実線で見せる
  const connections = reconcileMap([], gadgets, base, lang).map((c) => ({ ...c, confirmed: true }))

  const plan: DeskPlan = {
    ...base,
    wiringResult,
    connectionMap: { connections, nodeOffsets: demo.nodeOffsets },
  }
  const totalPrice = sumGadgetPrices(activeGadgets)

  return { demo, plan, gadgets, activeGadgets, totalPrice }
}
