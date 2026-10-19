import { Gadget, GadgetCategory } from '../types'
import { isReceiverPort } from '../utils/portRoles'

// ─── 予測変換 = 商品ラインナップ ─────────────────────────────────
// 1行 = 1商品。行に affiliateUrl を書けば、予測変換で選択したとき
// 購入URL欄へ自動入力される。商品を増やしたいときもここに行を足すだけ。
//
// 記入例:
//   { name: 'Logicool MX Master 3S', category: 'Mouse', ports: [...],
//     affiliateUrl: 'https://www.amazon.co.jp/dp/B0B117PZ3S?tag=タグ-22', asin: 'B0B117PZ3S' },
//
// asin / brand は任意。書いておくと将来の Amazon PA-API 移行時にそのまま使える。

/** 購入リンク系の共通フィールド（全プリセット配列で使用可） */
export type PresetLinkFields = {
  affiliateUrl?: string
  officialUrl?: string
  asin?: string
  brand?: string
  /**
   * 候補一覧で先に出したいものの並び順（小さいほど先）。
   * プリセットには id が無く name が唯一の識別子なので、呼び出し側で
   * 名前を突き合わせて並べ替えると、商品名を直した時点で静かに効かなくなる。
   * 順位はプリセット自身に持たせる。
   */
  suggestionPriority?: number
}

export type GadgetPreset = Omit<Gadget, 'id' | 'createdAt'> & PresetLinkFields


const normalizeReceiverPorts = (presets: GadgetPreset[]): GadgetPreset[] => presets.map((preset) => ({
  ...preset,
  ports: preset.ports.map((port) =>
    port.type === 'USB_A' && port.direction === 'input' && isReceiverPort(port)
      ? { ...port, directAttach: true }
      : port),
}))

const RAW_GADGET_PRESETS: GadgetPreset[] = [

  // =============================================
  // PC
  // =============================================
  {
    name: 'ノートパソコン',
    category: 'PC',
    ports: [],
  },
  {
    name: 'デスクトップPC',
    category: 'PC',
    ports: [],
  },

  // =============================================
  // モニター
  // =============================================
  // Apple のディスプレイは楽天の取り込みに1件も出てこない（正規店以外がほとんど扱わない）。
  // ここに書かないと、Mac + 外部モニターという最も多い構成が配線図に起こせない
  {
    name: 'Apple Studio Display',
    model: 'Studio Display',
    category: 'Monitor',
    brand: 'Apple',
    officialUrl: 'https://www.apple.com/jp/studio-display/',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 3 upstream (PD 96W)' },
      { id: 'p2', type: 'USB_C', direction: 'output', count: 3, label: 'USB-C 10Gb/s downstream' },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Apple Pro Display XDR',
    model: 'Pro Display XDR',
    category: 'Monitor',
    brand: 'Apple',
    officialUrl: 'https://www.apple.com/jp/pro-display-xdr/',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 3 upstream (PD 96W)' },
      { id: 'p2', type: 'USB_C', direction: 'output', count: 3, label: 'USB-C downstream' },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Dell U2725QE',
    model: 'U2725QE',
    category: 'Monitor',
    brand: 'Dell',
    officialUrl: 'https://www.dell.com/ja-jp/shop/dell--27-4k-thunderbolt--u2725qe/apd/210-bqmd/-',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 upstream (PD 140W)' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 downstream (PD 15W)' },
      { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C KVM upstream' },
      { id: 'p4', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p5', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p6', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true, label: 'DP MST out' },
      { id: 'p7', type: 'USB_A', direction: 'output', count: 5 },
      { id: 'p8', type: 'USB_C', direction: 'output', count: 2 },
      { id: 'p9', type: 'Ethernet', direction: 'input', count: 1, label: '2.5GbE RJ-45' },
      { id: 'p10', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p11', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Dell UltraSharp U3225QE',
    model: 'U3225QE',
    category: 'Monitor',
    brand: 'Dell',
    officialUrl: 'https://www.dell.com/ja-jp/shop/dell--32-4k-thunderbolt--u3225qe/apd/210-bqmm/-',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 upstream (PD 140W)' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 downstream (PD 15W)' },
      { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C KVM upstream' },
      { id: 'p4', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p5', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p6', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true, label: 'DP MST out' },
      { id: 'p7', type: 'USB_A', direction: 'output', count: 5 },
      { id: 'p8', type: 'USB_C', direction: 'output', count: 2 },
      { id: 'p9', type: 'Ethernet', direction: 'input', count: 1, label: '2.5GbE RJ-45' },
      { id: 'p10', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p11', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'EIZO FlexScan EV2795',
    model: 'EV2795',
    category: 'Monitor',
    brand: 'EIZO',
    officialUrl: 'https://www.eizo.co.jp/products/lcd/ev2795/',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C upstream (PD 70W)' },
      { id: 'p2', type: 'USB_C', direction: 'output', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C daisy-chain (PD 15W)' },
      { id: 'p3', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p4', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p5', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p6', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p7', type: 'Ethernet', direction: 'input', count: 1, label: '1GbE RJ-45' },
      { id: 'p8', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p9', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'LG UltraGear 27GN850',
    model: '27GN850',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true, label: 'HDMI 2.0' },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true, label: 'DP 1.4' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'LG UltraGear 27GR95QE (OLED)',
    model: '27GR95QE',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true, label: 'HDMI 2.0' },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true, label: 'DP 1.4' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 1 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'LG 27UK850-W',
    model: '27UK850',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'BenQ PD3225U',
    model: 'PD3225U',
    category: 'Monitor',
    brand: 'BenQ',
    officialUrl: 'https://www.benq.com/ja-jp/monitor/creative-pro/pd3225u.html',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 3 upstream (PD 85W)' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 3 daisy-chain (PD 15W)' },
      { id: 'p3', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p4', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p5', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p6', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p7', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p8', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p9', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'ASUS ProArt PA32UCR-K',
    model: 'ProArt PA32UCR-K',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 3, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p5', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p6', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'ASUS ProArt PA279CRV',
    model: 'PA279CRV',
    category: 'Monitor',
    brand: 'ASUS',
    officialUrl: 'https://www.asus.com/jp/displays-desktops/monitors/proart/proart-display-pa279crv/',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C upstream (PD 96W)' },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true, label: 'DP MST out' },
      { id: 'p5', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p6', type: 'USB_C', direction: 'output', count: 1, supportsPowerDelivery: true, label: 'USB-C downstream (PD 15W)' },
      { id: 'p7', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p8', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'LG 34WP65C-B (ウルトラワイド)',
    model: '34WP65C',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true, label: 'USB-C (PD)' },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },

  {
    name: 'Samsung Odyssey G7 32"',
    model: 'C32G75TQSR',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true, label: 'DP 1.4' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'ASUS TUF Gaming VG27AQZ',
    model: 'VG27AQZ',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'iiyama ProLite XUB2792UHSU-B6',
    model: 'XUB2792UHSU-B6',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'BenQ GW2790QT',
    model: 'GW2790QT',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'BenQ EW2880U',
    model: 'EW2880U',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p5', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p6', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Philips 27B1U7903',
    model: '27B1U7903',
    category: 'Monitor',
    brand: 'Philips',
    officialUrl: 'https://www.philips.co.jp/c-p/27B1U7903_93/professional-monitor-4k-uhd-mini-led-thunderbolttm-4-monitor',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 upstream (PD 90W)' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 daisy-chain (PD 15W)' },
      { id: 'p3', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p4', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p5', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p6', type: 'Ethernet', direction: 'input', count: 1, label: '1GbE RJ-45' },
      { id: 'p7', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p8', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'LG 40WP95C-W',
    model: '40WP95C-W',
    category: 'Monitor',
    brand: 'LG',
    officialUrl: 'https://www.lg.com/jp/monitors/21-9-ultra-wide-monitors/40wp95c-w/',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 upstream (PD 96W)' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true, label: 'Thunderbolt 4 daisy-chain' },
      { id: 'p3', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p4', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p5', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p6', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p7', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'ASUS ZenScreen MB16ACV (ポータブル)',
    model: 'ZenScreen MB16ACV',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 2, supportsVideo: true, label: 'USB-C (映像 / 給電)' },
    ],
  },
  {
    name: 'MSI MAG274QRF-QD',
    model: 'MAG274QRF-QD',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Pixio PX279 Prime (27" QHD 165Hz)',
    model: 'PX279 Prime',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Pixio PX248 Prime (24" FHD 165Hz)',
    model: 'PX248 Prime',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Pixio PX329 (32" QHD 165Hz)',
    model: 'PX329',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'KTC H27T22S (27" QHD 165Hz)',
    model: 'H27T22S',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p5', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p6', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'KTC M27T20 (27" 4K 144Hz)',
    model: 'M27T20',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Sony INZONE M9 II (27" 4K 144Hz)',
    model: 'INZONE M9 II',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p4', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Sony INZONE M3 (27" FHD 240Hz)',
    model: 'INZONE M3',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'HP Omen 27q (27" QHD 165Hz)',
    model: 'Omen 27q',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Lenovo ThinkVision P27h-30 (27" QHD)',
    model: 'ThinkVision P27h-30',
    category: 'Monitor',
    brand: 'Lenovo',
    officialUrl: 'https://support.lenovo.com/jp/ja/solutions/pd500600-thinkvision-p27h-30-monitor-overview',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C upstream (PD 100W)' },
      { id: 'p2', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p3', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p5', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true, label: 'DP MST out' },
      { id: 'p6', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p7', type: 'USB_C', direction: 'output', count: 1, supportsPowerDelivery: true, label: 'USB-C downstream (PD 15W)' },
      { id: 'p8', type: 'Ethernet', direction: 'input', count: 1, label: '1GbE RJ-45' },
      { id: 'p9', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p10', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'HP Series 7 Pro 727pu',
    model: '727pu',
    category: 'Monitor',
    brand: 'HP',
    officialUrl: 'https://jp.ext.hp.com/monitors/business/727pu/',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 upstream (PD 100W)' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'Thunderbolt 4 daisy-chain (PD 15W)' },
      { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C KVM upstream' },
      { id: 'p4', type: 'USB_C', direction: 'output', count: 1, supportsPowerDelivery: true, label: 'USB-C downstream (PD 15W)' },
      { id: 'p5', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p6', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p7', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true, label: 'DP MST out' },
      { id: 'p8', type: 'USB_A', direction: 'output', count: 5 },
      { id: 'p9', type: 'Ethernet', direction: 'input', count: 1, label: '1GbE RJ-45' },
      { id: 'p10', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Dell Pro 27 Plus P2725HE',
    model: 'P2725HE',
    category: 'Monitor',
    brand: 'Dell',
    officialUrl: 'https://www.dell.com/ja-jp/shop/dell-pro-27-plus-usb-c--p2725he/apd/210-bmkc/-',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true, supportsPowerDelivery: true, label: 'USB-C upstream (PD 90W)' },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true, label: 'DP MST out' },
      { id: 'p5', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p6', type: 'USB_C', direction: 'output', count: 1, supportsPowerDelivery: true, label: 'USB-C downstream (PD 15W)' },
      { id: 'p7', type: 'Ethernet', direction: 'input', count: 1, label: '1GbE RJ-45' },
      { id: 'p8', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'ASUS ROG Swift OLED PG27AQDM (27" QHD 240Hz OLED)',
    model: 'ROG Swift PG27AQDM',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true, label: 'HDMI 2.0' },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true, label: 'DP 1.4' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Dell Alienware AW2725QF (27" 4K 180Hz)',
    model: 'AW2725QF',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true, label: 'DP 1.4' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p4', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p5', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p6', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Samsung Odyssey OLED G8 (34" UWQHD 175Hz)',
    model: 'Odyssey OLED G8 S34BG85',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p3', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'LG UltraGear 27GX790A (27" FHD 480Hz OLED)',
    model: '27GX790A',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true, label: 'DP 2.1' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Huawei MateView GT 34" (UWQHD 165Hz)',
    model: 'MateView GT 34"',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Dell S2722QC (27" 4K USB-C)',
    model: 'S2722QC',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true, label: 'HDMI 2.0' },
      { id: 'p2', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true, label: 'USB-C (PD)' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'LG 27UL500-W (27" 4K)',
    model: '27UL500',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'LG 32UN880-B Ergo (32" 4K)',
    model: '32UN880',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true, label: 'USB-C (PD)' },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'ASUS ProArt PA248QV (24" QHD)',
    model: 'ProArt PA248QV',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p5', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p6', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'iiyama B2791QSU-B1 (27" QHD)',
    model: 'B2791QSU',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p_up', type: 'USB_B', direction: 'input', count: 1, label: 'USB upstream' },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'AOC Q27V4EA (27" QHD IPS)',
    model: 'Q27V4EA',
    category: 'Monitor',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 2, supportsVideo: true },
      { id: 'p2', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  // =============================================
  // ドッキングステーション
  // =============================================
  {
    name: 'CalDigit TS4',
    model: 'Thunderbolt Station 4',
    category: 'Dock',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, label: 'Host' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_C', direction: 'output', count: 2 },
      { id: 'p5', type: 'USB_A', direction: 'output', count: 5 },
      { id: 'p6', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p7', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p8', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p9', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'CalDigit Element Hub',
    model: 'Element Hub',
    category: 'Dock',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, label: 'Host' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 3 },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Anker Thunderbolt 4 Dock',
    model: 'A8396',
    category: 'Dock',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, label: 'Host (PD)' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p3', type: 'HDMI', direction: 'output', count: 2, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p5', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p6', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p7', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p8', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Belkin Connect Pro TB4 Dock',
    model: 'INC006',
    category: 'Dock',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, label: 'Host' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 3, supportsVideo: true },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 5 },
      { id: 'p4', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p5', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p6', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p7', type: 'Power', direction: 'input', count: 1 },
    ],
  },

  {
    name: 'Kensington SD5780T Thunderbolt 4 Dock',
    model: 'SD5780T',
    category: 'Dock',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, label: 'Host (PD)' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'output', count: 2, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 5 },
      { id: 'p5', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p6', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p7', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p8', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p9', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'UGREEN Revodok Max 213',
    model: 'Revodok Max 213',
    category: 'Dock',
    ports: [
      { id: 'p1', type: 'Thunderbolt', direction: 'input', count: 1, label: 'Host (PD)' },
      { id: 'p2', type: 'Thunderbolt', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p3', type: 'HDMI', direction: 'output', count: 2, supportsVideo: true },
      { id: 'p4', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p5', type: 'USB_A', direction: 'output', count: 5 },
      { id: 'p6', type: 'USB_C', direction: 'output', count: 2 },
      { id: 'p7', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p8', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p9', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p10', type: 'Power', direction: 'input', count: 1 },
    ],
  },

  // =============================================
  // USBハブ
  // =============================================
  {
    name: 'Anker 568 USB-C Hub',
    model: '568 (A8368)',
    category: 'Hub',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'Host' },
      { id: 'p2', type: 'HDMI', direction: 'output', count: 2, supportsVideo: true },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p4', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p5', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p6', type: 'Ethernet', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Satechi USB-C Slim Multiport',
    model: 'Slim Multiport 4K',
    category: 'Hub',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'Host' },
      { id: 'p2', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 4K' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p4', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p5', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p6', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p7', type: 'microSDCard', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'UGREEN Revodok Pro 210',
    model: 'Revodok Pro 210',
    category: 'Hub',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'Host' },
      { id: 'p2', type: 'HDMI', direction: 'output', count: 2, supportsVideo: true },
      { id: 'p3', type: 'DisplayPort', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p4', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p5', type: 'USB_C', direction: 'output', count: 2 },
      { id: 'p6', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p7', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p8', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },

  {
    name: 'Anker 552 USB-C Hub (7-in-1)',
    model: '552 (A8458)',
    category: 'Hub',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'Host' },
      { id: 'p2', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 4K' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p4', type: 'USB_C', direction: 'output', count: 1, label: 'USB-C PD' },
      { id: 'p5', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p6', type: 'microSDCard', direction: 'input', count: 1 },
      { id: 'p7', type: 'Ethernet', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Anker 655 USB-C Hub (8-in-1)',
    model: '655 (A8386)',
    category: 'Hub',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'Host' },
      { id: 'p2', type: 'HDMI', direction: 'output', count: 2, supportsVideo: true },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p4', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p5', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p6', type: 'microSDCard', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'CIO NovaPort QUAD 65W',
    model: 'NovaPort QUAD 65W',
    category: 'Hub',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'Host' },
      { id: 'p2', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p4', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p5', type: 'SDCard', direction: 'input', count: 1 },
    ],
  },

  // =============================================
  // キーボード
  // =============================================
  {
    name: 'HHKB Professional Hybrid',
    model: 'HHKB Professional Hybrid',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線接続 / 充電' },
      { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Keychron K8 Pro',
    model: 'K8 Pro',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線接続 / 充電' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Keychron Q1 Pro',
    model: 'Q1 Pro',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線接続 / 充電' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Logicool MX Keys S',
    model: 'MX Keys S',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Apple Magic Keyboard (Touch ID)',
    model: 'Magic Keyboard Touch ID',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'FILCO Majestouch Convertible 3',
    model: 'Majestouch Convertible 3',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線接続 / 充電' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Logicool G913 TKL',
    model: 'G913 TKL',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電 / 有線' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },

  {
    name: 'REALFORCE R3',
    model: 'REALFORCE R3',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線接続 / 充電' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'REALFORCE R3S TKL',
    model: 'REALFORCE R3S TKL',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線接続 / 充電' },
    ],
  },
  {
    name: 'Keychron K3 Pro',
    model: 'K3 Pro',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線接続 / 充電' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Keychron K2 Pro',
    model: 'K2 Pro',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線接続 / 充電' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'NuPhy Air75 V2',
    model: 'Air75 V2',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線接続 / 充電' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Logicool MX Mechanical Mini',
    model: 'MX Mechanical Mini',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Apple Magic Keyboard (テンキー付き)',
    model: 'Magic Keyboard with Numeric Keypad',
    category: 'Keyboard',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Logicool G515 TKL',
    model: 'G515 TKL',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電 / 有線' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Razer BlackWidow V4 Pro',
    model: 'BlackWidow V4 Pro',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB-A 有線' }],
  },
  {
    name: 'Razer Huntsman V3 Pro TKL',
    model: 'Huntsman V3 Pro TKL',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'Razer Ornata V3 TKL',
    model: 'Ornata V3 TKL',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'HyperX Alloy Origins 65',
    model: 'Alloy Origins 65',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線 / 充電' }],
  },
  {
    name: 'HyperX Alloy Origins Core TKL',
    model: 'Alloy Origins Core',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }],
  },
  {
    name: 'DrunkDeer A75 Pro',
    model: 'A75 Pro',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線 / 充電' }],
  },
  {
    name: 'DrunkDeer G65',
    model: 'G65',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }],
  },
  {
    name: 'Wobkey Roam 75',
    model: 'Roam 75',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }],
  },
  {
    name: 'Monsgeek M1W',
    model: 'M1W',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線 / 充電' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Monsgeek M5',
    model: 'M5',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }],
  },
  {
    name: 'Luminkey65',
    model: 'Luminkey65',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線 / 充電' }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Luminkey80',
    model: 'Luminkey80',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p_bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Sony INZONE K1 (フルサイズ)',
    model: 'INZONE K1',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB-A 有線' }],
  },
  {
    name: 'ELECOM TK-DFP01 (日本語配列)',
    model: 'TK-DFP01',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'Microsoft Designer Compact Keyboard',
    model: 'Designer Compact Keyboard',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Pulsar PCMK TKL',
    model: 'PCMK TKL',
    category: 'Keyboard',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線 / 充電' }],
  },
  { name: 'Logicool K380 Multi-Device', model: 'K380', category: 'Keyboard', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Logicool K380s Multi-Device', model: 'K380s', category: 'Keyboard', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Logicool K780 Multi-Device', model: 'K780', category: 'Keyboard', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'Unifyingレシーバー' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Keychron V1', model: 'V1', category: 'Keyboard', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線' }] },
  { name: 'Keychron V3', model: 'V3', category: 'Keyboard', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '有線' }] },
  { name: 'Logicool K295 静音キーボード', model: 'K295', category: 'Keyboard', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'Unifyingレシーバー' }] },
  { name: 'ELECOM TK-FBP112 Bluetoothキーボード', model: 'TK-FBP112', category: 'Keyboard', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },

  // =============================================
  // マウス
  // =============================================
  {
    name: 'Logicool MX Master 3S',
    model: 'MX Master 3S',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Logicool MX Anywhere 3S',
    model: 'MX Anywhere 3S',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Apple Magic Mouse',
    model: 'Magic Mouse',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Razer DeathAdder V3 Pro',
    model: 'DeathAdder V3 Pro',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'HyperSpeedレシーバー', directAttach: true },
    ],
  },
  {
    name: 'Logicool G Pro X Superlight 2',
    model: 'G Pro X Superlight 2',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'LIGHTSPEEDレシーバー', directAttach: true },
    ],
  },
  {
    name: 'SteelSeries Aerox 9 Wireless',
    model: 'Aerox 9 Wireless',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },

  {
    name: 'Logicool G502 X Plus',
    model: 'G502 X Plus',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'LIGHTSPEEDレシーバー', directAttach: true },
    ],
  },
  {
    name: 'Logicool Signature M650L',
    model: 'Signature M650L',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'ELECOM HUGE トラックボール',
    model: 'M-HT1DRBK',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB接続' },
    ],
  },
  {
    name: 'Kensington Expert Mouse Wireless',
    model: 'Expert Mouse Wireless Trackball',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'レシーバー' },
    ],
  },
  {
    name: 'Microsoft Arc Mouse',
    model: 'Arc Mouse',
    category: 'Mouse',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Apple Magic Trackpad',
    model: 'Magic Trackpad',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Razer Viper V3 Pro',
    model: 'Viper V3 Pro',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'HyperSpeedレシーバー', directAttach: true }],
  },
  {
    name: 'Razer DeathAdder V3 HyperSpeed',
    model: 'DeathAdder V3 HyperSpeed',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB-A レシーバー' }],
  },
  {
    name: 'Razer Cobra Pro',
    model: 'Cobra Pro',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Pulsar X2H',
    model: 'X2H',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: '2.4GHzレシーバー', directAttach: true }],
  },
  {
    name: 'Pulsar X2V2',
    model: 'X2V2',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: '2.4GHzレシーバー', directAttach: true }],
  },
  {
    name: 'Pulsar Xlite V3',
    model: 'Xlite V3',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: '2.4GHzレシーバー', directAttach: true }],
  },
  {
    name: 'Logicool G Pro X Superlight 2 DEX',
    model: 'G Pro X Superlight 2 DEX',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'LIGHTSPEEDレシーバー', directAttach: true }],
  },
  {
    name: 'HyperX Pulsefire Haste 2',
    model: 'Pulsefire Haste 2',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電 / 有線' }],
  },
  {
    name: 'ELECOM EX-G (トラックボール)',
    model: 'M-XT3DRBK',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'レシーバー' }],
  },
  {
    name: 'ASUS ROG Harpe Ace Aim Lab Edition',
    model: 'ROG Harpe Ace',
    category: 'Mouse',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  { name: 'Logicool M750 Signature Slim', model: 'M750', category: 'Mouse', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'Logi Boltレシーバー' }] },
  { name: 'Logicool Signature Plus M750L', model: 'M750L', category: 'Mouse', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'Logi Boltレシーバー' }] },
  { name: 'Logicool G304 LIGHTSPEED', model: 'G304', category: 'Mouse', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'LIGHTSPEEDレシーバー' }] },
  { name: 'Logicool G305 LIGHTSPEED', model: 'G305', category: 'Mouse', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'LIGHTSPEEDレシーバー' }] },
  { name: 'Razer Basilisk V3 Pro', model: 'Basilisk V3 Pro', category: 'Mouse', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'ELECOM DEFT PRO トラックボール', model: 'M-DPT1MRXBK', category: 'Mouse', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USBレシーバー' }] },
  { name: 'SteelSeries Rival 3', model: 'Rival 3', category: 'Mouse', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }] },

  // =============================================
  // スピーカー
  // =============================================
  {
    name: 'Yamaha HS5 スタジオモニター',
    model: 'HS5',
    category: 'Speaker',
    ports: [
      { id: 'p1', type: 'XLR', direction: 'input', count: 1, label: 'XLR バランス入力' },
      { id: 'p3', type: 'Audio6_3mm', direction: 'input', count: 1, label: '6.3mm TRS バランス入力' },
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Sony SRS-XB43',
    model: 'SRS-XB43',
    category: 'Speaker',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 },
      { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'BOSE SoundLink Flex',
    model: 'SoundLink Flex',
    category: 'Speaker',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  { name: 'Sonos Era 100', category: 'Speaker', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Sonos Era 300', category: 'Speaker', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Harman Kardon Aura Studio 4', category: 'Speaker', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p3', type: 'Audio3_5mm', direction: 'input', count: 1 }] },
  { name: 'JBL Charge 5', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'JBL Flip 6', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'JBL Xtreme 4', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Bose SoundLink Mini II Special Edition', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Bose SoundLink Revolve+ II', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Marshall Emberton III', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Marshall Acton III', category: 'Speaker', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'KEF LSX II', category: 'Speaker', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Creative Pebble V3', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'YAMAHA ZS-1000', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'JBL GO 4', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'JBL PartyBox Encore Essential', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_A', direction: 'output', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Anker Soundcore Motion 300', model: 'Soundcore Motion 300', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Anker Soundcore 3', model: 'Soundcore 3', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Sony SRS-XE300', model: 'SRS-XE300', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Logicool Z200 マルチメディアスピーカー', model: 'Z200', category: 'Speaker', ports: [{ id: 'p1', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p2', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Creative Pebble Plus', model: 'Pebble Plus', category: 'Speaker', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }] },

  // =============================================
  // ヘッドホン・イヤホン
  // =============================================
  {
    name: 'Sony WH-1000XM5',
    model: 'WH-1000XM5',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1, label: '有線接続' },
      { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Sony WF-1000XM5',
    model: 'WF-1000XM5',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'ケース充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Bose QuietComfort 45',
    model: 'QuietComfort 45',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1, label: '有線接続' },
      { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Apple AirPods Pro (2nd Gen)',
    model: 'AirPods Pro 2',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'ケース充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Logicool G Pro X Headset',
    model: 'G Pro X',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB-A (本体接続)' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Sony WH-1000XM4',
    model: 'WH-1000XM4',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1, label: '有線接続' },
      { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Bose QuietComfort Ultra Headphones',
    model: 'QuietComfort Ultra',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1, label: '有線接続' },
      { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Audio-Technica ATH-M50xBT2',
    model: 'ATH-M50xBT2',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1, label: '有線接続' },
      { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'JBL Tune 770NC',
    model: 'Tune 770NC',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1, label: '有線接続' },
      { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Jabra Evolve2 55',
    model: 'Evolve2 55',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' },
      { id: 'p2', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Bose QuietComfort Earbuds II',
    model: 'QuietComfort Earbuds II',
    category: 'Headphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'ケース充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'JBL Quantum 910 Wireless',
    model: 'Quantum 910',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }],
  },
  {
    name: 'JBL Quantum 360 Wireless',
    model: 'Quantum 360',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'HyperX Cloud Alpha Wireless',
    model: 'Cloud Alpha Wireless',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }],
  },
  {
    name: 'HyperX Cloud III Wireless',
    model: 'Cloud III Wireless',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }],
  },
  {
    name: 'Razer BlackShark V2 Pro (2023)',
    model: 'BlackShark V2 Pro',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }],
  },
  {
    name: 'Razer Barracuda X (2023)',
    model: 'Barracuda X',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Sony INZONE H9 (ゲーミングヘッドセット)',
    model: 'INZONE H9',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }],
  },
  {
    name: 'Sony INZONE H7 (ゲーミングヘッドセット)',
    model: 'INZONE H7',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }],
  },
  {
    name: 'SHOKZ OpenRun Pro 2',
    model: 'OpenRun Pro 2',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電 (マグネット式)' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'SHOKZ OpenFit Air',
    model: 'OpenFit Air',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'ケース充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'SHOKZ OpenMove',
    model: 'OpenMove',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Nothing Ear (2)',
    model: 'Ear (2)',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'ケース充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Nothing Ear (a)',
    model: 'Ear (a)',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'ケース充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'final ZE3000 SV',
    model: 'ZE3000 SV',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'ケース充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'final A4000',
    model: 'A4000',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'Audio3_5mm', direction: 'input', count: 1 }],
  },
  {
    name: 'ZENAIM STREAM',
    model: 'STREAM',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Audio-Technica ATH-TWX9',
    model: 'ATH-TWX9',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'ケース充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },
  {
    name: 'Logicool G935 (ゲーミングヘッドセット)',
    model: 'G935',
    category: 'Headphone',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル / 充電' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }],
  },

  // =============================================
  // マイク
  // =============================================
  {
    name: 'Blue Yeti X',
    model: 'Yeti X',
    category: 'Microphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1, label: 'ヘッドホン出力' },
    ],
  },
  {
    name: 'RODE NT-USB Mini',
    model: 'NT-USB Mini',
    category: 'Microphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },
  {
    name: 'Elgato Wave:3',
    model: 'Wave:3',
    category: 'Microphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },
  {
    name: 'HyperX QuadCast S',
    model: 'QuadCast S',
    category: 'Microphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB-C)' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },

  {
    name: 'RODE PodMic USB',
    model: 'PodMic USB',
    category: 'Microphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },
  {
    name: 'Shure MV7+',
    model: 'MV7+',
    category: 'Microphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },
  {
    name: 'Audio-Technica AT2020USB-X',
    model: 'AT2020USB-X',
    category: 'Microphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },
  {
    name: 'Sony ECM-S1',
    model: 'ECM-S1',
    category: 'Microphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Elgato Wave:1',
    model: 'Wave:1',
    category: 'Microphone',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },
  { name: 'Blue Snowball iCE', model: 'Snowball iCE', category: 'Microphone', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }] },
  { name: 'Razer Seiren V3 Chroma', model: 'Seiren V3 Chroma', category: 'Microphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' }, { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 }] },
  { name: 'Maono PD400X (USB/XLR)', model: 'PD400X', category: 'Microphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 }] },
  { name: 'RODE Wireless GO II', model: 'Wireless GO II', category: 'Microphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電 / PC接続' }, { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1, label: '受信機出力' }] },
  { name: 'HyperX SoloCast', model: 'SoloCast', category: 'Microphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' }] },

  // =============================================
  // ウェブカメラ
  // =============================================
  {
    name: 'Nintendo Switch 2 カメラ',
    model: 'BEE-019',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'Switch 2 本体 / Dock接続' },
    ],
  },
  {
    name: 'Logicool Brio 4K',
    model: 'Brio 4K (C1000e)',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続 (USB-A)' },
    ],
  },
  {
    name: 'Logicool StreamCam',
    model: 'StreamCam C980',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'OBSBOT Tiny 4K',
    model: 'Tiny 4K',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Elgato Facecam Pro',
    model: 'Facecam Pro',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },

  {
    name: 'Logicool C920n HD Pro',
    model: 'C920n',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Logicool C922n Pro Stream',
    model: 'C922n',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Logicool Brio 500',
    model: 'Brio 500',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Insta360 Link 2',
    model: 'Link 2',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'AVerMedia Live Streamer CAM 513',
    model: 'CAM 513',
    category: 'Webcam',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  { name: 'Logicool C310 HD', model: 'C310', category: 'Webcam', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }] },
  { name: 'Logicool C270 HD', model: 'C270', category: 'Webcam', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }] },
  { name: 'Razer Kiyo Pro', model: 'Kiyo Pro', category: 'Webcam', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }] },
  { name: 'Microsoft Modern Webcam', model: 'Modern Webcam', category: 'Webcam', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }] },
  { name: 'Anker PowerConf C200 ウェブカメラ', model: 'PowerConf C200', category: 'Webcam', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }] },

  // =============================================
  // 配信機材・キャプチャー（カテゴリは Other）
  // =============================================
  {
    name: 'Elgato Stream Deck MK.2',
    model: 'Stream Deck MK.2',
    category: 'SmallDevice',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Elgato Stream Deck +',
    model: 'Stream Deck +',
    category: 'SmallDevice',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Elgato 4K60 Pro MK.2 (キャプチャーボード)',
    model: '4K60 Pro MK.2',
    category: 'CaptureDevice',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true, label: 'HDMI IN (ゲーム機から)' },
      { id: 'p2', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI OUT (パススルー)' },
    ],
  },

  {
    name: 'Elgato Stream Deck XL',
    model: 'Stream Deck XL',
    category: 'SmallDevice',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Elgato Stream Deck Neo',
    model: 'Stream Deck Neo',
    category: 'SmallDevice',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Elgato Stream Deck Mini',
    model: 'Stream Deck Mini',
    category: 'SmallDevice',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'Elgato Stream Deck Pedal',
    model: 'Stream Deck Pedal',
    category: 'SmallDevice',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }],
  },
  {
    name: 'Wacom Intuos Pro',
    model: 'Intuos Pro',
    category: 'PenTablet',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 / 充電' },
      { id: 'p2', type: 'Bluetooth', direction: 'output', count: 1 },
    ],
  },
  {
    name: 'Wacom Intuos',
    model: 'Intuos',
    category: 'PenTablet',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }],
  },
  {
    name: 'One by Wacom',
    model: 'One by Wacom',
    category: 'PenTablet',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続' }],
  },
  {
    name: 'AVerMedia Live Gamer 4K (キャプチャーボード)',
    model: 'Live Gamer 4K GC573',
    category: 'CaptureDevice',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'input', count: 1, supportsVideo: true, label: 'HDMI IN (ゲーム機から)' },
      { id: 'p2', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI OUT (パススルー)' },
    ],
  },

  // =============================================
  // ストレージ（外付け）
  // =============================================
  {
    name: 'Samsung T9 Portable SSD 2TB',
    model: 'T9',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB 3.2 Gen 2x2)' },
    ],
  },
  {
    name: 'Western Digital My Passport 5TB',
    model: 'My Passport 5TB',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'SanDisk Professional PRO-READER CFexpress',
    model: 'SDPR1F8',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB 3.2 Gen 2)' },
      { id: 'p2', type: 'CFexpress', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Lexar CFexpress Type B / SD カードリーダー',
    model: 'LRW550U',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB 3.2 Gen 2)' },
      { id: 'p2', type: 'CFexpress', direction: 'input', count: 1 },
      { id: 'p3', type: 'SDCard', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Synology DiskStation DS223j (NAS)',
    model: 'DiskStation DS223j',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },

  {
    name: 'Samsung T7 Shield 2TB',
    model: 'T7 Shield',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB 3.2 Gen 2)' },
    ],
  },
  {
    name: 'SanDisk Extreme Pro V2 2TB',
    model: 'Extreme Pro Portable V2',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB 3.2 Gen 2x2)' },
    ],
  },
  {
    name: 'Crucial X9 Pro 2TB',
    model: 'X9 Pro',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB 3.2 Gen 2)' },
    ],
  },
  {
    name: 'BUFFALO HD-NRLC3 (外付けHDD)',
    model: 'HD-NRLC3',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続 (USB 3.2)' },
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'IO-DATA HDPX-UTS1K (外付けHDD)',
    model: 'HDPX-UTS1K',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' },
    ],
  },
  {
    name: 'LaCie Rugged Mini SSD 1TB',
    model: 'Rugged Mini SSD',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB 3.2 Gen 2)' },
    ],
  },
  {
    name: 'Synology DiskStation DS423+ (NAS)',
    model: 'DS423+',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 2 },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p3', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'WD Elements Desktop 4TB (外付けHDD)',
    model: 'WD Elements Desktop',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続 (USB 3.0)' },
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Seagate Expansion Portable 2TB',
    model: 'Expansion Portable',
    category: 'Storage',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB 3.0)' },
    ],
  },
  { name: 'BUFFALO SSD-PUT1.0U3-BKA (ポータブルSSD)', category: 'Storage', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'PC接続 (USB 3.2)' }] },
  { name: 'Crucial X9 1TB', model: 'X9', category: 'Storage', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続 (USB 3.2 Gen 2)' }] },
  { name: 'Transcend ESD310C 1TB', model: 'ESD310C', category: 'Storage', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C / USB-A 両挿し' }] },

  // メモリーカード。スロットへ直接挿すのでケーブルは要らない（ports は空）
  { name: 'SanDisk Extreme PRO SDXC 128GB',   model: 'SDSDXXD-128G',   category: 'Storage', ports: [] },
  { name: 'SanDisk Extreme PRO SDXC 256GB',   model: 'SDSDXXD-256G',   category: 'Storage', ports: [] },
  { name: 'SanDisk Extreme microSDXC 256GB',  model: 'SDSQXAV-256G',   category: 'Storage', ports: [] },
  { name: 'Samsung PRO Plus SDXC 256GB',      model: 'MB-SD256S',      category: 'Storage', ports: [] },
  { name: 'Samsung PRO Plus microSDXC 256GB', model: 'MB-MD256S',      category: 'Storage', ports: [] },
  { name: 'Samsung EVO Select microSDXC 128GB', model: 'MB-ME128S',    category: 'Storage', ports: [] },
  { name: 'Lexar Professional 1667x SDXC 128GB', model: 'LSD128',      category: 'Storage', ports: [] },
  { name: 'ProGrade Digital SDXC UHS-II V60 128GB', model: 'PGSD128',  category: 'Storage', ports: [] },
  { name: 'Kingston Canvas Select Plus microSDXC 128GB', model: 'SDCS2', category: 'Storage', ports: [] },
  { name: 'Transcend microSDXC 340S 128GB',   model: 'TS128GUSD340S',  category: 'Storage', ports: [] },
  { name: 'キオクシア EXCERIA PLUS microSDXC 128GB', model: 'KMUH-A128G', category: 'Storage', ports: [] },
  { name: 'Nextorage NX-F2SE SDXC 128GB',     model: 'NX-F2SE128G',    category: 'Storage', ports: [] },

  // =============================================
  // ゲーム機
  // =============================================
  {
    name: 'PlayStation 5',
    model: 'PS5',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p3', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p4', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Nintendo Switch 本体',
    model: 'Nintendo Switch / Nintendo Switch（有機ELモデル）',
    category: 'GameConsole',
    consoleFormFactor: 'handheld',
    powerUsage: 'rechargeable',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, supportsVideo: true, label: 'USB-C (下部・Dock接続・充電)' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Nintendo Switch Dock',
    model: 'Nintendo Switch Dock',
    category: 'Dock',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI' },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 3, label: 'USB-A (USB 2.0)' },
      { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (本体接続)' },
      { id: 'p4', type: 'Power', direction: 'input', count: 1, label: 'AC アダプタ' },
    ],
  },
  {
    name: 'Nintendo Switch OLED Dock',
    model: 'Nintendo Switch（有機ELモデル）Dock',
    category: 'Dock',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI' },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 2, label: 'USB-A (USB 2.0)' },
      { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (本体接続)' },
      { id: 'p4', type: 'Ethernet', direction: 'input', count: 1, label: '有線LAN' },
      { id: 'p5', type: 'Power', direction: 'input', count: 1, label: 'AC アダプタ' },
    ],
  },
  {
    name: 'Nintendo Switch',
    model: 'Switch (有機ELモデル)',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI (Dock経由)' },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 2, label: 'USB-A (Dock)' },
      { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: '充電 / Dock接続' },
      { id: 'p4', type: 'Power', direction: 'input', count: 1, label: 'AC アダプタ (Dock)' },
      // 有機ELモデルのドックは有線LAN端子を内蔵している（通常モデルは別売アダプタ）
      { id: 'p5', type: 'Ethernet', direction: 'input', count: 1, label: '有線LAN (Dock)' },
    ],
  },
  {
    name: 'Xbox Series X',
    model: 'Xbox Series X',
    category: 'GameConsole',
    consoleFormFactor: 'stationary',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p3', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
      { id: 'p5', type: 'XboxWireless', direction: 'bidirectional', count: 1, label: 'Xbox Wireless' },
      { id: 'p6', type: 'XboxExpansion', direction: 'output', count: 1, label: 'ストレージ拡張スロット' },
    ],
  },
  {
    name: 'PlayStation 5 Slim',
    model: 'PS5 Slim',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p3', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p4', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'PlayStation 5 Pro',
    model: 'PS5 Pro (CFI-7000)',
    category: 'GameConsole',
    consoleFormFactor: 'stationary',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p3', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p4', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'PlayStation 4 Pro',
    model: 'PS4 Pro',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p2', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 2.0' },
      { id: 'p3', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p5', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Nintendo Switch 2',
    model: 'Nintendo Switch 2',
    suggestionPriority: 0,
    category: 'GameConsole',
    consoleFormFactor: 'handheld',
    powerUsage: 'rechargeable',
    ports: [
      // 映像が出るのは下部（ドック接続）だけ。上部は充電・データ専用で映像は出ない
      { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, supportsVideo: true, label: 'USB-C (下部・Dock接続)' },
      { id: 'p2', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-C (上部・周辺機器・充電)' },
      { id: 'p3', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p4', type: 'Bluetooth', direction: 'bidirectional', count: 1 },
    ],
  },
  {
    name: 'Nintendo Switch 2 Dock',
    model: 'Nintendo Switch 2 Dock',
    suggestionPriority: 1,
    category: 'Dock',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 2, label: 'USB-A (USB 2.0・前面)' },
      // 本体を挿す専用端子。bidirectional にすると出力側が空きポート扱いになり、
      // コントローラーの充電先に使われてしまう（実機には挿す余地が無い）
      { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (本体接続)' },
      { id: 'p4', type: 'Ethernet', direction: 'input', count: 1, label: '有線LAN' },
      { id: 'p5', type: 'Power', direction: 'input', count: 1, label: 'AC アダプタ' },
    ],
  },
  {
    name: 'Nintendo Switch Lite',
    model: 'Switch Lite',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },
  {
    name: 'Xbox Series S',
    model: 'Xbox Series S',
    category: 'GameConsole',
    consoleFormFactor: 'stationary',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 2.1' },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 3 },
      { id: 'p3', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
      { id: 'p5', type: 'XboxWireless', direction: 'bidirectional', count: 1, label: 'Xbox Wireless' },
      { id: 'p6', type: 'XboxExpansion', direction: 'output', count: 1, label: 'ストレージ拡張スロット' },
    ],
  },
  {
    name: 'Steam Deck OLED',
    model: 'Steam Deck OLED',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, supportsVideo: true, label: 'USB-C (映像出力 / 充電)' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p3', type: 'microSDCard', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'ASUS ROG Ally X',
    model: 'ROG Ally X',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, supportsVideo: true, label: 'USB-C (映像出力 / 充電)' },
      { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p3', type: 'microSDCard', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Lenovo Legion Go',
    model: 'Legion Go',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, supportsVideo: true, label: 'USB-C (映像出力 / 充電)' },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
      { id: 'p3', type: 'Audio3_5mm', direction: 'output', count: 1 },
      { id: 'p4', type: 'microSDCard', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'ニンテンドークラシックミニ ファミリーコンピュータ',
    model: 'CLV-S-HGAJ',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: '電源 (USB)' },
    ],
  },
  {
    name: 'ニンテンドークラシックミニ スーパーファミコン',
    model: 'CLV-S-SNSP',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: '電源 (USB)' },
    ],
  },
  { name: 'Nintendo DS', model: 'NDS', category: 'GameConsole', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Nintendo DS Lite', model: 'DS Lite', category: 'GameConsole', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Nintendo DSi', model: 'DSi', category: 'GameConsole', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Nintendo DSi LL', model: 'DSi LL', category: 'GameConsole', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Nintendo 3DS', model: '3DS', category: 'GameConsole', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Nintendo 3DS LL', model: '3DS LL', category: 'GameConsole', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Nintendo New 3DS', model: 'New 3DS', category: 'GameConsole', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Nintendo New 3DS LL', model: 'New 3DS LL', category: 'GameConsole', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Nintendo 2DS', model: '2DS', category: 'GameConsole', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Nintendo New 2DS LL', model: 'New 2DS LL', category: 'GameConsole', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '充電' }] },
  {
    name: 'Wii',
    model: 'Wii',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p2', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Wii U',
    model: 'Wii U',
    category: 'GameConsole',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true },
      { id: 'p2', type: 'USB_A', direction: 'output', count: 4 },
      { id: 'p3', type: 'SDCard', direction: 'input', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },

  {
    name: 'COFO Desk Pro 1800',
    model: 'Desk Pro 1800',
    category: 'Other',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'output', count: 2, label: 'USB充電ポート' },
      { id: 'p2', type: 'USB_C', direction: 'output', count: 1, label: 'USB-C充電ポート' },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Bauhutte BHD-1400M (昇降デスク)',
    model: 'BHD-1400M',
    category: 'Desk',
    ports: [],
    isHeightAdjustable: true,
    deskLiftType: 'manual',
  },

  // =============================================
  // ストリーミング端末
  // =============================================
  {
    name: 'Apple TV 4K (第3世代)',
    model: 'Apple TV 4K',
    category: 'StreamingDevice',
    brand: 'Apple',
    officialUrl: 'https://www.apple.com/jp/tv-home/',
    ports: [
      { id: 'p1', type: 'HDMI', direction: 'output', count: 1, supportsVideo: true, label: 'HDMI 2.1' },
      // 有線LANは Wi-Fi + Ethernet モデルだけが持つ
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },

  // =============================================
  // 充電器（タップ→詳細フォームへ）
  // =============================================
  {
    name: '充電器を追加',
    category: 'Charger',
    ports: [],
  },

  // =============================================
  // 3Dプリンター
  // =============================================
  {
    name: 'Bambu Lab X1 Carbon',
    model: 'X1 Carbon',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
      { id: 'p4', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Bambu Lab P1S',
    model: 'P1S',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
      { id: 'p4', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Bambu Lab A1 Mini',
    model: 'A1 Mini',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
      { id: 'p4', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Bambu Lab A1',
    model: 'A1',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
      { id: 'p4', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Prusa MK4S',
    model: 'Original Prusa MK4S',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Prusa MINI+',
    model: 'Original Prusa MINI+',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Creality K1 Max',
    model: 'K1 Max',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Creality Ender 3 V3 SE',
    model: 'Ender 3 V3 SE',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'microSDCard', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Anycubic Photon Mono M5S (光造形)',
    model: 'Photon Mono M5S',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Elegoo Saturn 4 Ultra (光造形)',
    model: 'Saturn 4 Ultra',
    category: 'Printer3D',
    ports: [
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },

  // ── 家庭用・複合機プリンター ──
  {
    name: 'EPSON カラリオ EP-885A',
    model: 'EP-885A',
    category: 'Printer',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
      { id: 'p3', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'EPSON カラリオ EP-716A',
    model: 'EP-716A',
    category: 'Printer',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
      { id: 'p3', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Canon PIXUS TS8730',
    model: 'PIXUS TS8730',
    category: 'Printer',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
      { id: 'p3', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Canon PIXUS TS6630',
    model: 'PIXUS TS6630',
    category: 'Printer',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
      { id: 'p3', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Brother MFC-J7100CDW',
    model: 'MFC-J7100CDW',
    category: 'Printer',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
      { id: 'p4', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Brother HL-L2375DW (モノクロレーザー)',
    model: 'HL-L2375DW',
    category: 'Printer',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
      { id: 'p4', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'HP Smart Tank 5810',
    model: 'Smart Tank 5810',
    category: 'Printer',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
      { id: 'p3', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'HP Color Laser 150nw',
    model: 'Color Laser 150nw',
    category: 'Printer',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'PC接続' },
      { id: 'p2', type: 'Power', direction: 'input', count: 1 },
      { id: 'p3', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },

  // =============================================
  // ライト・環境
  // =============================================

  // ── モニターライトバー ──
  {
    name: 'BenQ ScreenBar Halo',
    model: 'ScreenBar Halo',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB-A 電源 (モニターから給電可)' }],
  },
  {
    name: 'BenQ ScreenBar Plus',
    model: 'ScreenBar Plus',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB-A 電源' }],
  },
  {
    name: 'BenQ ScreenBar',
    model: 'ScreenBar',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'QUNTIS モニターライト ScreenLinear',
    model: 'ScreenLinear',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'QUNTIS モニターライト Q8',
    model: 'Q8',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },

  // ── キーライト ──
  {
    name: 'Elgato Key Light',
    model: 'Key Light',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Elgato Key Light Air',
    model: 'Key Light Air',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Elgato Key Light Mini',
    model: 'Key Light Mini',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }],
  },

  // ── スマート照明 ──
  {
    name: 'Philips Hue Play (デスクライト)',
    model: 'Hue Play',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Philips Hue Gradient Lightstrip 55"',
    model: 'Hue Gradient Lightstrip 55"',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Philips Hue Gradient Lightstrip 65"',
    model: 'Hue Gradient Lightstrip 65"',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Nanoleaf Lines',
    model: 'Lines',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Nanoleaf Shapes 三角形',
    model: 'Shapes Triangles',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Nanoleaf Essentials Lightstrip',
    model: 'Essentials Lightstrip',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },

  // ── テープライト ──
  {
    name: 'Govee LED Strip Light M1',
    model: 'LED Strip Light M1',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB電源' }],
  },
  {
    name: 'Govee Neon LED Rope Light 2',
    model: 'Neon Rope Light 2 (H618C)',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Govee TV バックライト RGBIC',
    model: 'TV Backlight 3 Lite',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB電源 (TVから給電可)' }],
  },
  {
    name: 'Govee Immersion TV バックライト',
    model: 'Immersion TV Backlight',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB電源' }],
  },
  {
    name: 'Govee Flow Pro ゲーミングライトバー',
    model: 'Flow Pro',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'Elgato Light Strip',
    model: 'Light Strip',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'SwitchBot LED Strip Light',
    model: 'LED Strip Light',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'SwitchBot カラーバルブ',
    model: 'Color Bulb',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'QUNTIS LED デスクテープライト',
    model: 'LED Desk Strip',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'Razer Chroma LED Strip Kit',
    model: 'Chroma LED Strip',
    category: 'Light',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'Amazon Basics LED テープライト',
    model: 'Smart LED Strip (Wi-Fi)',
    category: 'Light',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },

  // =============================================
  // デスク・昇降デスク
  // =============================================
  {
    name: 'FlexiSpot E7',
    model: 'E7',
    category: 'Other',
    ports: [
      { id: 'p1', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'FlexiSpot E7 Pro',
    model: 'E7 Pro',
    category: 'Other',
    ports: [
      { id: 'p1', type: 'Power', direction: 'input', count: 1 },
    ],
  },

  // =============================================
  // ルーター / ネットワーク
  // =============================================
  {
    name: 'TP-Link Archer AXE75 (Wi-Fi 6E)',
    model: 'Archer AXE75',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: 'WAN' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 4, label: 'LAN' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'ASUS ROG Rapture GT-BE98 (Wi-Fi 7)',
    model: 'ROG Rapture GT-BE98',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: '10G WAN' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 4, label: '2.5G LAN' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 2 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Buffalo WSR-6000AX8S (Wi-Fi 6)',
    model: 'WSR-6000AX8S',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: 'WAN (2.5G)' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 4, label: 'LAN' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'NEC Aterm WX7800T8 (Wi-Fi 6E)',
    model: 'Aterm WX7800T8',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: 'WAN (2.5G)' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 4, label: 'LAN' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'TP-Link Deco XE75 Pro (メッシュWi-Fi)',
    model: 'Deco XE75 Pro',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: 'WAN (2.5G)' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 2, label: 'LAN (2.5G)' },
      { id: 'p3', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'IO-DATA WN-DAX6000XR (Wi-Fi 6E)',
    model: 'WN-DAX6000XR',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: 'WAN (2.5G)' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 4, label: 'LAN' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'TP-Link Archer AX73 (Wi-Fi 6)',
    model: 'Archer AX73',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: 'WAN' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 4, label: 'LAN' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Buffalo WSR-3200AX4S (Wi-Fi 6)',
    model: 'WSR-3200AX4S',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: 'WAN (1G)' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 4, label: 'LAN' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'NEC Aterm WX3600HP (Wi-Fi 6)',
    model: 'Aterm WX3600HP',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: 'WAN (1G)' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 3, label: 'LAN' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'TP-Link Archer AXE5400 (Wi-Fi 6E)',
    model: 'Archer AXE5400',
    category: 'Router',
    ports: [
      { id: 'p1', type: 'Ethernet', direction: 'input', count: 1, label: 'WAN (2.5G)' },
      { id: 'p2', type: 'Ethernet', direction: 'output', count: 4, label: 'LAN' },
      { id: 'p3', type: 'USB_A', direction: 'output', count: 1 },
      { id: 'p4', type: 'Power', direction: 'input', count: 1 },
    ],
  },
]

export const GADGET_PRESETS = normalizeReceiverPorts(RAW_GADGET_PRESETS)

export type NameSuggestion = {
  name: string
  pcFormFactor?: Gadget['pcFormFactor']
} & PresetLinkFields

export const PC_LAPTOP_SUGGESTIONS: NameSuggestion[] = [
  { name: 'MacBook Air 13" M4' },
  { name: 'MacBook Air 15" M4' },
  { name: 'MacBook Pro 14" M4 Pro' },
  { name: 'MacBook Pro 14" M4 Max' },
  { name: 'MacBook Pro 16" M4 Pro', pcFormFactor: 'laptop' },
  { name: 'MacBook Pro 16" M4 Max', pcFormFactor: 'laptop' },
  { name: 'ThinkPad X1 Carbon Gen 13' },
  { name: 'ThinkPad X1 Carbon Gen 12' },
  { name: 'ThinkPad X1 Yoga Gen 9' },
  { name: 'ThinkPad E14 Gen 6' },
  { name: 'Yoga Slim 7 Aura Edition' },
  { name: 'Surface Laptop 7 13.8"' },
  { name: 'Surface Laptop 7 15"' },
  { name: 'Surface Pro 11"' },
  { name: 'XPS 13 9350' },
  { name: 'XPS 15 9560' },
  { name: 'Latitude 5550' },
  { name: 'ZenBook 14 OLED UX3405' },
  { name: 'ZenBook S 14 UX5406' },
  { name: 'Vivobook 16 X1605' },
  { name: 'Spectre x360 14' },
  { name: 'ENVY x360 15' },
  { name: 'EliteBook 840 G11' },
  { name: 'ProBook 450 G11' },
  { name: 'MateBook X Pro' },
  { name: 'MateBook 14s' },
  { name: 'Swift Go 16' },
  { name: 'Aspire 5 A515' },
  { name: 'LIFEBOOK U9413' },
  { name: 'LIFEBOOK U7513' },
  { name: 'LIFEBOOK A5515' },
  { name: 'mouse B5-A10' },
  { name: 'DAIV Z6-I9G90BK-A' },
  { name: 'NEXTGEAR Note i1500' },
  { name: 'NEXTGEAR Note i1560' },
  { name: 'ROG Zephyrus G14 GA403' },
  { name: 'ROG Strix G18 G814' },
  { name: 'GALLERIA GCR2070RGF-QCG-A' },
  { name: 'GALLERIA XA7C-R47' },
  { name: 'Razer Blade 16 (2025)' },
  { name: 'Razer Blade 15 (2025)' },
]

export const PC_DESKTOP_SUGGESTIONS: NameSuggestion[] = [
  { name: 'Mac mini M4' },
  { name: 'Mac mini M4 Pro' },
  { name: 'Mac Studio M4 Max' },
  { name: 'Mac Studio M4 Ultra' },
  { name: 'iMac 24" M4' },
  { name: 'Mac Pro' },
  { name: 'Surface Studio 2+' },
  { name: 'OptiPlex 7010 Plus' },
  { name: 'OptiPlex 3090 Ultra' },
  { name: 'Precision 3260 Compact' },
  { name: 'EliteDesk 800 G9 Mini' },
  { name: 'ProDesk 400 G9 Mini' },
  { name: 'ThinkCentre M75q Gen 5' },
  { name: 'ThinkCentre M70q Gen 5' },
  { name: 'IdeaCentre 5i Gen 9' },
  { name: 'NUC 14 Pro' },
  { name: 'Mini PC PN65' },
  { name: 'Beelink EQi12' },
  { name: 'Beelink SER6 Pro' },
  { name: 'Minisforum UM790 Pro' },
  { name: 'GALLERIA XA7C-R47S' },
  { name: 'GALLERIA ZA9C-R49' },
  { name: 'NEXTGEAR G5 i1640PA1' },
  { name: 'NEXTGEAR G7 i1670SA1' },
  { name: 'DAIV FX-I9G90 デスクトップ' },
  { name: 'mouse Pro P702X' },
  { name: 'Dell G15 デスクトップ (5090)' },
  { name: 'OMEN Desktop PC 45L' },
]

// =============================================
// オーディオインターフェース プリセット
// =============================================
export const AUDIO_INTERFACE_PRESETS: GadgetPreset[] = [
  {
    name: 'Focusrite Scarlett Solo (4th Gen)',
    category: 'AudioInterface',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (PC接続)' },
      { id: 'p2', type: 'XLR', direction: 'input', count: 1, label: 'XLR マイク入力' },
      { id: 'p3', type: 'Audio6_3mm_TS', direction: 'input', count: 1, label: '6.3mm 楽器入力' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p5', type: 'Audio6_3mm', direction: 'output', count: 2, label: '6.3mm TRS モニター出力' },
    ],
  },
  {
    name: 'Focusrite Scarlett 2i2 (4th Gen)',
    category: 'AudioInterface',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'XLR_TRS_Combo', direction: 'input', count: 2, label: 'XLR/TRS コンボ ×2' },
      { id: 'p3', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 2, label: '6.3mm TRS モニター出力' },
    ],
  },
  {
    name: 'Focusrite Scarlett 4i4 (4th Gen)',
    category: 'AudioInterface',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'XLR_TRS_Combo', direction: 'input', count: 2, label: 'XLR/TRS コンボ ×2' },
      { id: 'p3', type: 'Audio6_3mm', direction: 'input', count: 2, label: '6.3mm ライン入力 ×2' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p5', type: 'Audio6_3mm', direction: 'output', count: 4, label: '6.3mm TRS ライン出力 ×4' },
      { id: 'p6', type: 'MIDI', direction: 'input', count: 1, label: 'MIDI IN' },
      { id: 'p7', type: 'MIDI', direction: 'output', count: 1, label: 'MIDI OUT' },
    ],
  },
  {
    name: 'MOTU M2',
    category: 'AudioInterface',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'XLR_TRS_Combo', direction: 'input', count: 2, label: 'XLR/TRS コンボ ×2' },
      { id: 'p3', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 2, label: '6.3mm TRS モニター出力' },
      { id: 'p5', type: 'RCA', direction: 'output', count: 2, label: 'RCA ライン出力' },
      { id: 'p6', type: 'MIDI', direction: 'input', count: 1, label: 'MIDI IN' },
      { id: 'p7', type: 'MIDI', direction: 'output', count: 1, label: 'MIDI OUT' },
    ],
  },
  {
    name: 'MOTU M4',
    category: 'AudioInterface',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'XLR_TRS_Combo', direction: 'input', count: 2, label: 'XLR/TRS コンボ ×2' },
      { id: 'p3', type: 'Audio6_3mm', direction: 'input', count: 2, label: '6.3mm ライン入力 ×2' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p5', type: 'Audio6_3mm', direction: 'output', count: 4, label: '6.3mm TRS ライン出力 ×4' },
      { id: 'p6', type: 'RCA', direction: 'output', count: 4, label: 'RCA ライン出力 ×4' },
      { id: 'p7', type: 'MIDI', direction: 'input', count: 1, label: 'MIDI IN' },
      { id: 'p8', type: 'MIDI', direction: 'output', count: 1, label: 'MIDI OUT' },
    ],
  },
  {
    name: 'Universal Audio Volt 1',
    category: 'AudioInterface',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'XLR_TRS_Combo', direction: 'input', count: 1, label: 'XLR/TRS コンボ' },
      { id: 'p3', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 2, label: '6.3mm TRS モニター出力' },
      { id: 'p5', type: 'MIDI', direction: 'input', count: 1, label: 'MIDI IN' },
      { id: 'p6', type: 'MIDI', direction: 'output', count: 1, label: 'MIDI OUT' },
    ],
  },
  {
    name: 'Universal Audio Volt 2',
    category: 'AudioInterface',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'XLR_TRS_Combo', direction: 'input', count: 2, label: 'XLR/TRS コンボ ×2' },
      { id: 'p3', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 2, label: '6.3mm TRS モニター出力' },
      { id: 'p5', type: 'MIDI', direction: 'input', count: 1, label: 'MIDI IN' },
      { id: 'p6', type: 'MIDI', direction: 'output', count: 1, label: 'MIDI OUT' },
    ],
  },
  {
    name: 'Audient iD4 MkII',
    category: 'AudioInterface',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'XLR_TRS_Combo', direction: 'input', count: 1, label: 'XLR/TRS コンボ' },
      { id: 'p3', type: 'Audio6_3mm_TS', direction: 'input', count: 1, label: 'JFET 楽器入力' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p5', type: 'Audio3_5mm', direction: 'output', count: 1, label: '3.5mm ヘッドホン出力' },
      { id: 'p6', type: 'Audio6_3mm', direction: 'output', count: 2, label: '6.3mm TRS モニター出力' },
    ],
  },
  {
    name: 'RME Babyface Pro FS',
    category: 'AudioInterface',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'USB 2.0 (PC接続)' },
      { id: 'p2', type: 'XLR',   direction: 'input', count: 2 },
      { id: 'p3', type: 'Audio6_3mm_TS', direction: 'input', count: 2, label: '6.3mm ライン / 楽器入力' },
      { id: 'p4', type: 'XLR', direction: 'output', count: 2, label: 'XLR メイン出力' },
      { id: 'p5', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p6', type: 'Audio3_5mm', direction: 'output', count: 1, label: '3.5mm ヘッドホン出力' },
      { id: 'p7', type: 'OpticalAudio', direction: 'bidirectional', count: 1, label: 'ADAT / SPDIF 光入出力' },
      { id: 'p8', type: 'MIDI', direction: 'input', count: 1, label: 'MIDI IN' },
      { id: 'p9', type: 'MIDI', direction: 'output', count: 1, label: 'MIDI OUT' },
    ],
  },
]

export const HEADPHONE_AMP_PRESETS: GadgetPreset[] = [
  {
    name: 'FiiO K7',
    category: 'HeadphoneAmp',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'USB-B (PC接続)' },
      { id: 'p2', type: 'OpticalAudio', direction: 'input', count: 1 },
      { id: 'p3', type: 'CoaxialAudio', direction: 'input', count: 1 },
      { id: 'p4', type: 'RCA', direction: 'input', count: 2, label: 'LINE IN' },
      { id: 'p5', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p6', type: 'Audio4_4mm', direction: 'output', count: 1, label: '4.4mm ヘッドホン出力' },
      { id: 'p7', type: 'RCA', direction: 'output', count: 2, label: 'RCA ライン出力' },
      { id: 'p8', type: 'DCPower', direction: 'input', count: 1, powerAdapterIncluded: true },
    ],
  },
  {
    name: 'iFi ZEN DAC V2',
    category: 'HeadphoneAmp',
    ports: [
      { id: 'p1', type: 'USB_B', direction: 'input', count: 1, label: 'USB-B (PC接続)' },
      { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p3', type: 'Audio4_4mm', direction: 'output', count: 1, label: '4.4mm ヘッドホン出力' },
      { id: 'p4', type: 'RCA', direction: 'output', count: 2, label: 'RCA ライン出力' },
    ],
  },
  {
    name: 'SMSL DL200',
    category: 'HeadphoneAmp',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (PC接続)' },
      { id: 'p2', type: 'OpticalAudio', direction: 'input', count: 1 },
      { id: 'p3', type: 'CoaxialAudio', direction: 'input', count: 1 },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p5', type: 'Audio4_4mm', direction: 'output', count: 1, label: '4.4mm ヘッドホン出力' },
      { id: 'p6', type: 'RCA', direction: 'output', count: 2, label: 'RCA ライン出力' },
      { id: 'p7', type: 'Power', direction: 'input', count: 1 },
    ],
  },
]

// ─── アンプ（プリメイン・パワー）───────────────────────────────
// パッシブスピーカーを鳴らせるのはこのカテゴリだけ。
// スピーカー端子の count は繋げるスピーカーの本数（L/R で2）
export const AMPLIFIER_PRESETS: GadgetPreset[] = [
  {
    name: 'TOPPING PA5 II',
    model: 'PA5 II',
    category: 'Amplifier',
    ports: [
      { id: 'p1', type: 'Audio6_3mm', direction: 'input', count: 2, label: 'TRS バランス入力' },
      { id: 'p2', type: 'RCA', direction: 'input', count: 2 },
      { id: 'p3', type: 'SpeakerTerminal', direction: 'output', count: 2 },
      { id: 'p4', type: 'DCPower', direction: 'input', count: 1, powerAdapterIncluded: true },
    ],
  },
  {
    name: 'DENON PMA-600NE',
    model: 'PMA-600NE',
    category: 'Amplifier',
    ports: [
      { id: 'p1', type: 'RCA', direction: 'input', count: 4, label: 'アナログ入力' },
      { id: 'p2', type: 'OpticalAudio', direction: 'input', count: 2 },
      { id: 'p3', type: 'CoaxialAudio', direction: 'input', count: 1 },
      { id: 'p4', type: 'Bluetooth', direction: 'input', count: 1 },
      { id: 'p5', type: 'SpeakerTerminal', direction: 'output', count: 2 },
      { id: 'p6', type: 'Power', direction: 'input', count: 1 },
    ],
  },
]

// ─── パッシブスピーカー ────────────────────────────────────────
// 自分では電源を持たず、アンプからスピーカーケーブルで鳴らす
export const PASSIVE_SPEAKER_PRESETS: GadgetPreset[] = [
  {
    name: 'DALI OBERON 1',
    model: 'OBERON 1',
    category: 'Speaker',
    ports: [{ id: 'p1', type: 'SpeakerTerminal', direction: 'input', count: 1 }],
  },
  {
    name: 'YAMAHA NS-BP401',
    model: 'NS-BP401',
    category: 'Speaker',
    ports: [{ id: 'p1', type: 'SpeakerTerminal', direction: 'input', count: 1 }],
  },
]

// =============================================
// ミキサー プリセット
// =============================================
export const MIXER_PRESETS: GadgetPreset[] = [
  {
    name: 'YAMAHA AG06 MK2',
    category: 'Mixer',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (PC接続/録音)' },
      { id: 'p2', type: 'XLR',   direction: 'input', count: 2, label: 'XLR/TRS コンボ ×2' },
      { id: 'p3', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
      { id: 'p4', type: 'Audio6_3mm', direction: 'input', count: 2, label: '6.3mm TRS 入力' },
    ],
  },
  {
    name: 'YAMAHA AG08 MK2',
    category: 'Mixer',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'XLR',   direction: 'input', count: 4 },
      { id: 'p3', type: 'Audio6_3mm', direction: 'output', count: 2, label: '6.3mm TRS モニター出力' },
    ],
  },
  {
    name: 'Roland GO:MIXER PRO-X',
    category: 'Mixer',
    ports: [
      { id: 'p1', type: 'USB_C', direction: 'input', count: 1 },
      { id: 'p2', type: 'XLR',   direction: 'input', count: 1 },
      { id: 'p3', type: 'Audio3_5mm', direction: 'input', count: 3 },
      { id: 'p4', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' },
    ],
  },
  {
    name: 'Mackie ProFX12v3',
    category: 'Mixer',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB (PC接続/録音)' },
      { id: 'p2', type: 'XLR',   direction: 'input', count: 4, label: 'XLR ×4' },
      { id: 'p3', type: 'XLR',   direction: 'output', count: 2, label: 'XLR メイン出力' },
      { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1 },
    ],
  },
]

// =============================================
// スマートホーム プリセット
// =============================================
export const SMART_HOME_PRESETS: GadgetPreset[] = [
  {
    name: 'Echo Show 5',
    category: 'SmartHome',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (電源)' }],
  },
  {
    name: 'Echo Dot (5th Gen)',
    category: 'SmartHome',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (電源)' }],
  },
  {
    name: 'Google Nest Hub (2nd Gen)',
    category: 'SmartHome',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Google Nest Mini',
    category: 'SmartHome',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (電源)' }],
  },
  {
    name: 'SwitchBot Hub 2',
    category: 'SmartHome',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }],
  },
  {
    name: 'SwitchBot Hub Mini',
    category: 'SmartHome',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'Philips Hue Bridge',
    category: 'SmartHome',
    ports: [
      { id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB-A (電源)' },
      { id: 'p2', type: 'Ethernet', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Nature Remo 3',
    category: 'SmartHome',
    ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }],
  },
  {
    name: 'SwitchBot プラグミニ',
    category: 'SmartHome',
    ports: [
      { id: 'p1', type: 'Power', direction: 'input', count: 1, label: 'AC入力' },
      { id: 'p2', type: 'Power', direction: 'output', count: 1, label: 'AC出力' },
      { id: 'p3', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'TP-Link Tapo P105',
    category: 'SmartHome',
    ports: [
      { id: 'p1', type: 'Power', direction: 'input', count: 1, label: 'AC入力' },
      { id: 'p2', type: 'Power', direction: 'output', count: 1, label: 'AC出力' },
      { id: 'p3', type: 'WiFi', direction: 'input', count: 1 },
    ],
  },
  {
    name: 'Apple HomePod (第2世代)',
    category: 'SmartHome',
    brand: 'Apple',
    officialUrl: 'https://www.apple.com/jp/homepod-2nd-generation/',
    ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }],
  },
  {
    name: 'Apple HomePod mini',
    category: 'SmartHome',
    brand: 'Apple',
    officialUrl: 'https://www.apple.com/jp/homepod-mini/',
    ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C (電源)' }],
  },
  {
    // ボタン電池で動き、ケーブルが1本も要らないので ports は空
    name: 'Apple AirTag',
    category: 'SmartHome',
    brand: 'Apple',
    officialUrl: 'https://www.apple.com/jp/airtag/',
    ports: [],
  },
]

// =============================================
// スマートフォン プリセット
// =============================================
export const SMARTPHONE_PRESETS: GadgetPreset[] = [
  { name: 'iPhone 16 Pro Max', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'iPhone 16 Pro', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'iPhone 16 Plus', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'iPhone 16', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'iPhone 15 Pro Max', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'iPhone 15 Pro', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'iPhone 14 Pro Max', category: 'Smartphone', ports: [{ id: 'p1', type: 'Lightning', direction: 'input', count: 1, label: '充電・データ' }] },
  { name: 'iPhone 14 Pro', category: 'Smartphone', ports: [{ id: 'p1', type: 'Lightning', direction: 'input', count: 1, label: '充電・データ' }] },
  { name: 'iPhone 14', category: 'Smartphone', ports: [{ id: 'p1', type: 'Lightning', direction: 'input', count: 1, label: '充電・データ' }] },
  { name: 'iPhone SE (第3世代)', category: 'Smartphone', ports: [{ id: 'p1', type: 'Lightning', direction: 'input', count: 1, label: '充電・データ' }] },
  { name: 'Galaxy S25 Ultra', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Galaxy S25+', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Galaxy S25', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Pixel 9 Pro XL', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Pixel 9 Pro', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Pixel 9', category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Xperia 1 VI',   category: 'Smartphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'output', count: 1 }] },
]

// =============================================
// タブレット プリセット
// =============================================
export const TABLET_PRESETS: GadgetPreset[] = [
  { name: 'iPad Pro 13" M4', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true }, { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1 }] },
  { name: 'iPad Pro 11" M4', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true }, { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1 }] },
  { name: 'iPad Air 13" M3', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1 }] },
  { name: 'iPad Air 11" M3', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1 }] },
  { name: 'iPad mini (7th Gen)', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1 }] },
  { name: 'iPad (11th Gen)', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'iPad (9th Gen)', category: 'Tablet', ports: [{ id: 'p1', type: 'Lightning', direction: 'input', count: 1, label: '充電・データ' }] },
  { name: 'iPad mini (5th Gen)', category: 'Tablet', ports: [{ id: 'p1', type: 'Lightning', direction: 'input', count: 1, label: '充電・データ' }] },
  { name: 'Galaxy Tab S10 Ultra', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true }] },
  { name: 'Galaxy Tab S10+', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Galaxy Tab S10', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Surface Pro 11', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true }] },
  { name: 'Pixel Tablet', category: 'Tablet', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
]

// CATEGORY_ICONS は src/constants/icons.ts の CATEGORY_ICONS に移行済み

// =============================================
// ヘッドホン / イヤホン プリセット
// =============================================
const RAW_AUDIO_WEAR_PRESETS: GadgetPreset[] = [
  // ── Sony ──────────────────────────────────
  { name: 'PULSE Elite ワイヤレスヘッドセット', category: 'Headphone', powerUsage: 'rechargeable', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル (PlayStation Link)' }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1, label: '充電' }, { id: 'p3', type: 'Audio3_5mm', direction: 'input', count: 1, label: '有線接続' }] },
  { name: 'Xbox ワイヤレス ヘッドセット', category: 'Headphone', powerUsage: 'rechargeable', ports: [{ id: 'p1', type: 'XboxWireless', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: '充電' }] },
  { name: 'Sony WH-1000XM5', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Sony WH-1000XM4', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Sony WF-1000XM5', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Sony WF-1000XM4', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Sony INZONE H9', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }] },
  { name: 'Sony INZONE H7', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }] },
  { name: 'Sony INZONE Buds', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  // ── Bose ──────────────────────────────────
  { name: 'Bose QuietComfort Ultra Headphones', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Bose QuietComfort 45', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Bose QuietComfort Earbuds II', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Bose Sport Earbuds', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  // ── Apple ─────────────────────────────────
  { name: 'Apple AirPods Pro (2nd Gen)', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Apple AirPods 4', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Apple AirPods Max (USB-C)', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  // ── Audio-Technica ────────────────────────
  { name: 'Audio-Technica ATH-M50xBT2', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Audio-Technica ATH-TWX9', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Audio-Technica ATH-M50x', category: 'Headphone', ports: [{ id: 'p1', type: 'Audio3_5mm', direction: 'input', count: 1 }] },
  // ── JBL ───────────────────────────────────
  { name: 'JBL Tune 770NC', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'JBL Quantum 910 Wireless', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }] },
  { name: 'JBL Quantum 360 Wireless', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  // ── HyperX ────────────────────────────────
  { name: 'HyperX Cloud Alpha Wireless', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }] },
  { name: 'HyperX Cloud III Wireless', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }] },
  { name: 'HyperX Cloud III', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }] },
  // ── Razer ─────────────────────────────────
  { name: 'Razer BlackShark V2 Pro (2023)', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }] },
  { name: 'Razer Barracuda X (2023)', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Razer Kraken V3 HyperSense', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }] },
  // ── Logicool ──────────────────────────────
  { name: 'Logicool G Pro X Headset', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }] },
  { name: 'Logicool G935', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Logicool Zone Vibe 125', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  // ── SHOKZ ─────────────────────────────────
  { name: 'SHOKZ OpenRun Pro 2', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'SHOKZ OpenFit Air', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'SHOKZ OpenMove', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  // ── Nothing / Jabra / その他 ──────────────
  { name: 'Nothing Ear (2)', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Nothing Ear (a)', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Jabra Evolve2 55', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USBドングル' }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Jabra Elite 10', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'final ZE3000 SV', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'final A4000', category: 'Headphone', ports: [{ id: 'p1', type: 'Audio3_5mm', direction: 'input', count: 1 }] },
  { name: 'ZENAIM STREAM', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Sennheiser Momentum 4', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Sennheiser IE 300', category: 'Headphone', ports: [{ id: 'p1', type: 'Audio3_5mm', direction: 'input', count: 1 }] },
  { name: 'Anker Soundcore Liberty 4 NC', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Anker Soundcore Q45', category: 'Headphone', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio3_5mm', direction: 'input', count: 1 }, { id: 'p3', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'OneOdio Monitor 60', category: 'Headphone', ports: [{ id: 'p1', type: 'Audio3_5mm', direction: 'input', count: 1 }] },
]

// =============================================
// 充電器プリセット
// =============================================
const EARPHONE_PRESET_NAMES = [
  'WF-', 'Buds', 'Earbuds', 'AirPods Pro', 'AirPods 4', 'ATH-TWX', 'OpenRun', 'OpenFit', 'OpenMove',
  'Nothing Ear', 'Jabra Elite', 'final ', 'ZE3000', 'A4000', 'ZENAIM', 'IE 300', 'Liberty',
]

const isEarphonePreset = (name: string) => EARPHONE_PRESET_NAMES.some((marker) => name.includes(marker))

const AUDIO_WEAR_PRESETS = normalizeReceiverPorts(RAW_AUDIO_WEAR_PRESETS)
export const HEADPHONE_PRESETS = AUDIO_WEAR_PRESETS.filter((preset) => !isEarphonePreset(preset.name))
export const EARPHONE_PRESETS = AUDIO_WEAR_PRESETS
  .filter((preset) => isEarphonePreset(preset.name))
  .map((preset) => ({ ...preset, category: 'Earphone' as const }))

export const CHARGER_PRESETS: GadgetPreset[] = [
  // ── ワイヤレス充電器 ────────────────────
  { name: 'Apple MagSafe充電器 (Qi2 25W)', brand: 'Apple', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C給電' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1, label: 'Qi2 25W / MagSafe' },
  ], officialUrl: 'https://www.apple.com/jp/shop/product/mgd74am/a/magsafe%E5%85%85%E9%9B%BB%E5%99%A81-m' },
  { name: 'Anker MagGo Wireless Charger (Pad)', brand: 'Anker', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C給電' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1, label: 'Qi2 15W' },
  ], officialUrl: 'https://www.ankerjapan.com/products/a25m0' },
  { name: 'Anker MagGo Wireless Charger (2-in-1, Stand)', brand: 'Anker', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C給電' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 2, label: 'Qi2スマートフォン＋Qiイヤホン' },
  ], officialUrl: 'https://www.ankerjapan.com/products/a2544' },
  { name: 'Anker MagGo Wireless Charging Station (3-in-1, Foldable Pad)', brand: 'Anker', category: 'Charger', ports: [
    { id: 'p1', type: 'Power', direction: 'input', count: 1, label: '付属USB PD充電器経由' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 3, label: 'Qi2＋Apple Watch＋Qi' },
  ], officialUrl: 'https://www.ankerjapan.com/products/b25m8' },
  { name: 'Anker Prime Wireless Charging Station (3-in-1, MagGo, AirCool)', brand: 'Anker', category: 'Charger', ports: [
    { id: 'p1', type: 'Power', direction: 'input', count: 1, label: '付属電源アダプター経由' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 3, label: 'Qi2 25W＋Apple Watch＋Qi' },
  ], officialUrl: 'https://www.ankerjapan.com/products/b25x7' },
  { name: 'Anker 737 MagGo Charger (3-in-1 Station)', brand: 'Anker', category: 'Charger', ports: [
    { id: 'p1', type: 'Power', direction: 'input', count: 1, label: '付属電源アダプター経由' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 3, label: 'MagSafe＋Apple Watch＋Qi' },
  ], officialUrl: 'https://www.ankerjapan.com/products/b2599' },
  { name: 'Belkin UltraCharge 3-in-1 Foldable Magnetic Charger Qi2 25W', brand: 'Belkin', category: 'Charger', ports: [
    { id: 'p1', type: 'Power', direction: 'input', count: 1, label: '付属45W電源アダプター経由' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 3, label: 'Qi2 25W＋Apple Watch＋Qi' },
  ], officialUrl: 'https://www.belkin.com/jp/p/3-in-1-foldable-magnetic-charger-with-qi2-25w/P-WIZ036.html' },
  { name: 'Belkin BoostCharge Pro Qi2 3-in-1 ワイヤレス充電パッド 15W', brand: 'Belkin', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C給電' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 3, label: 'Qi2＋Apple Watch＋Qi' },
  ], officialUrl: 'https://www.belkin.com/jp/p/qi2-3-in-1-%E3%83%AF%E3%82%A4%E3%83%A4%E3%83%AC%E3%82%B9%E5%85%85%E9%9B%BB%E3%83%91%E3%83%83%E3%83%89-15w/WIZ022qcWH.html' },
  { name: 'Belkin Qi2 3-in-1 Compact Magnetic Charging Stand 15W', brand: 'Belkin', category: 'Charger', ports: [
    { id: 'p1', type: 'Power', direction: 'input', count: 1, label: '付属電源アダプター経由' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 3, label: 'Qi2＋Apple Watch＋Qi' },
  ], officialUrl: 'https://www.belkin.com/jp/p/%E3%82%B3%E3%83%B3%E3%83%91%E3%82%AF%E3%83%88%E3%81%AA3-in-1%E3%83%9E%E3%82%B0%E3%83%8D%E3%83%83%E3%83%88%E5%BC%8F%E5%85%85%E9%9B%BB%E3%82%B9%E3%82%BF%E3%83%B3%E3%83%89/WIZ034dqBK.html' },
  { name: 'Samsung Super Fast Wireless Charger Duo 15W', brand: 'Samsung', category: 'Charger', ports: [
    { id: 'p1', type: 'Power', direction: 'input', count: 1, label: '付属25Wアダプター経由' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 2, label: 'Qiスマートフォン＋Galaxy Watch / Buds' },
  ], officialUrl: 'https://www.samsung.com/jp/mobile-accessories/super-fast-wireless-charger-duo-white-ep-p5400twjgjp/' },
  // ── Anker ──────────────────────────────
  { name: 'Anker Nano Travel Adapter (5-in-1, 20W)', brand: 'Anker', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ],
    affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/g00rr09n.vmi33b9e.g00rr09n.vmi34ec1/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fanker%2Fa9215%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fanker%2Fi%2F10002530%2F&rafcid=wsc_i_is_a72cbb79-71bc-44f3-88d2-f3f0d7c6488c',
    officialUrl: 'https://www.ankerjapan.com/products/a9215',
  },
  { name: 'dretec AD-102 海外用USBアダプター', brand: 'dretec', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ],
    affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/g00upn2n.vmi331b7.g00upn2n.vmi34151/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fdretec%2Fad-102ec%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fdretec%2Fi%2F10000131%2F&rafcid=wsc_i_is_a72cbb79-71bc-44f3-88d2-f3f0d7c6488c',
    officialUrl: 'https://www.dretec.co.jp/life_style/household_goods/ad-102/lang-ja',
  },
  { name: 'ROAD WARRIOR ゴーコンα USB PD30W RWG134', brand: 'ROAD WARRIOR', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ],
    affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/g00tcuvn.vmi33110.g00tcuvn.vmi34401/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fshiroshita-direct%2Frwg134%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fshiroshita-direct%2Fi%2F10000561%2F&rafcid=wsc_i_is_a72cbb79-71bc-44f3-88d2-f3f0d7c6488c',
    officialUrl: 'https://www.warrior.jp/product/rwg134/',
  },
  { name: 'MOMAX 1-World 70W GaN Travel Adapter UA8D', brand: 'MOMAX', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ],
    affiliateUrl: 'https://hb.afl.rakuten.co.jp/hgc/g00uoe3n.vmi3381a.g00uoe3n.vmi34add/?pc=https%3A%2F%2Fitem.rakuten.co.jp%2Fmobilemax%2Fua8d%2F&m=http%3A%2F%2Fm.rakuten.co.jp%2Fmobilemax%2Fi%2F10000000%2F&rafcid=wsc_i_is_a72cbb79-71bc-44f3-88d2-f3f0d7c6488c',
  },
  { name: 'Anker Nano 20W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker Nano 30W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker Nano II 45W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker Nano II 65W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker 521 Charger (Nano Pro 40W)', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker 523 Charger 47W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker 735 Charger GaNPrime 65W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker 736 Charger GaNPrime 100W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker 737 Charger GaNPrime 120W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker 747 Charger GaNPrime 150W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker 763 Charging Station 120W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker PowerPort III 65W Pod', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker 511 Nano 30W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker PowerPort Atom III Slim 65W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Anker 543 Charger 45W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── CIO ────────────────────────────────
  { name: 'CIO LilNob 20W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'CIO LilNob 45W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'CIO NovaPort DUO 45W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'CIO NovaPort TRIO 65W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'CIO NovaPort QUAD 100W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'CIO FULL SPEED MAX 140W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'CIO OWLSOME 45W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'CIO SMARTCOBY Pro PLUG 30W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Apple ──────────────────────────────
  { name: 'Apple 20W USB-C Power Adapter', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Apple 30W USB-C Power Adapter', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Apple 35W Dual USB-C Power Adapter', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Apple 67W USB-C Power Adapter', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Apple 96W USB-C Power Adapter', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Apple 140W USB-C Power Adapter', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Belkin ─────────────────────────────
  { name: 'Belkin 20W USB-C PD Wall Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Belkin 25W USB-C PPS Wall Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Belkin 30W USB-C GaN Wall Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Belkin 65W GaN USB-C Dual Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Belkin BoostCharge Pro 108W 4-Port', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── UGREEN ─────────────────────────────
  { name: 'UGREEN Nexode 20W USB-C Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'UGREEN Nexode 45W USB-C Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'UGREEN Nexode 65W 3-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'UGREEN Nexode 100W 4-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'UGREEN Nexode 140W 4-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'UGREEN Nexode Pro 65W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'UGREEN Nexode Pro 160W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Baseus ─────────────────────────────
  { name: 'Baseus GaN 30W Mini Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Baseus GaN 65W 2-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Baseus GaN 100W 4-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Baseus GaN 120W Desktop Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Baseus GaN 140W 4-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Satechi ────────────────────────────
  { name: 'Satechi 30W Nano GaN Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Satechi 65W USB-C PD GaN Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Satechi 40W Dual USB-C GaN Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Satechi 108W Pro Desktop Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Satechi 200W USB-C PD GaN Desktop', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 4 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Samsung ────────────────────────────
  { name: 'Samsung 25W USB-C Power Adapter', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Samsung 45W USB-C Power Adapter', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Samsung 65W GaN 3-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Spigen ─────────────────────────────
  { name: 'Spigen ArcStation Essential 20W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Spigen ArcStation Pro GaN 45W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Spigen ArcStation Pro GaN 100W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── AUKEY ──────────────────────────────
  { name: 'AUKEY Omnia II 65W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'AUKEY PA-B4 Omnia 100W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'AUKEY Swift 20W USB-C Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Xiaomi ─────────────────────────────
  { name: 'Xiaomi 33W Wall Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Xiaomi 67W GaN Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Xiaomi 120W GaN Dual-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Xiaomi 65W GaN Multi-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Zendure ────────────────────────────
  { name: 'Zendure SuperPort S4 100W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Zendure SuperPort 4 Slim 96W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Shargeek ───────────────────────────
  { name: 'Shargeek Storm 2 100W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Shargeek RETRO 35W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── mophie ─────────────────────────────
  { name: 'mophie 30W USB-C Wall Adapter', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'mophie 72W 4-Port Wall Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── ESR ────────────────────────────────
  { name: 'ESR 20W USB-C Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'ESR GaN 65W 3-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Voltme ─────────────────────────────
  { name: 'Voltme Revo 65 GaN Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Voltme Revo 120 GaN Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Native Union ───────────────────────
  { name: 'Native Union Smart Charger 65W GaN', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'Native Union Smart Charger 45W GaN', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── ZMI ────────────────────────────────
  { name: 'ZMI 65W GaN USB-C Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'ZMI 100W GaN 4-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── TORRAS ─────────────────────────────
  { name: 'TORRAS 30W GaN Nano Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'TORRAS 65W GaN 3-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── OnePlus ────────────────────────────
  { name: 'OnePlus SUPERVOOC 80W Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── InfinityLab ────────────────────────
  { name: 'InfinityLab InstantStation 100W', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 3 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Nimble ─────────────────────────────
  { name: 'Nimble Wally 67W GaN Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 3 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── ELECOM (日本メーカー) ──────────────
  { name: 'ELECOM 20W USB-C充電器', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 1 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
  { name: 'ELECOM 65W GaN USB-C充電器', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Hyphen-X ───────────────────────────
  { name: 'Hyphen-X 100W GaN 4-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── RAVPower ───────────────────────────
  { name: 'RAVPower 90W GaN 4-Port Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── CHOETECH ───────────────────────────
  { name: 'CHOETECH 100W GaN USB-C Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 2 },
    { id: 'p3', type: 'Power', direction: 'input', count: 1 },
  ]},

  // ── Lepow ──────────────────────────────
  { name: 'Lepow 65W GaN USB-C Charger', category: 'Charger', ports: [
    { id: 'p1', type: 'USB_C', direction: 'output', count: 2 },
    { id: 'p2', type: 'Power', direction: 'input', count: 1 },
  ]},
]

// =============================================
// デスク
// =============================================
export const DESK_PRESETS: (NameSuggestion | GadgetPreset)[] = [
  // 昇降デスク
  { name: 'サンワダイレクト パソコンデスク' },
  { name: 'FLEXISPOT E7', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric', deskHeightMin: '58', deskHeightMax: '123' },
  { name: 'FLEXISPOT E7 Click', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'output', count: 1, label: '操作パネルUSB充電' }], isHeightAdjustable: true, deskLiftType: 'electric', deskHeightMin: '63.5', deskHeightMax: '128.5' },
  { name: 'FLEXISPOT E7 Pro', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric' },
  { name: 'FLEXISPOT EG8', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric' },
  { name: 'UPLIFT V2', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric', deskHeightMin: '61.7', deskHeightMax: '126.7' },
  { name: 'UPLIFT V2 Commercial', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric', deskHeightMin: '57.4', deskHeightMax: '123.7' },
  { name: 'Bauhutte BHD-1200M 昇降デスク', category: 'Desk', ports: [], isHeightAdjustable: true, deskLiftType: 'manual' },
  { name: 'Bauhutte BHD-W1200M 昇降デスク', category: 'Desk', ports: [], isHeightAdjustable: true, deskLiftType: 'manual' },
  { name: 'IKEA BEKANT 昇降デスク', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric' },
  { name: 'IKEA MITTZON 昇降デスク', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric', deskHeightMin: '62', deskHeightMax: '126' },
  { name: 'IKEA IDASEN 昇降デスク', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric', deskHeightMin: '63', deskHeightMax: '127' },
  { name: 'サンワダイレクト 100-ERD039M', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'output', count: 1, label: '充電用USB-C' }, { id: 'p3', type: 'USB_A', direction: 'output', count: 1, label: '充電用USB-A' }], isHeightAdjustable: true, deskLiftType: 'electric' },
  { name: 'サンワダイレクト 102-ERD101', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'output', count: 1, label: '充電用USB-C' }, { id: 'p3', type: 'USB_A', direction: 'output', count: 1, label: '充電用USB-A' }], isHeightAdjustable: true, deskLiftType: 'electric' },
  { name: 'COFO Desk Premium', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'output', count: 1, label: '操作パネルUSB充電' }], isHeightAdjustable: true, deskLiftType: 'electric', deskHeightMin: '63', deskHeightMax: '128' },
  { name: 'オカムラ Swift Nex', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric' },
  { name: 'MotionGrey Standing Desk', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }], isHeightAdjustable: true, deskLiftType: 'electric' },
  { name: 'サンワダイレクト 昇降デスク 100-ERD030BK', category: 'Desk', isHeightAdjustable: true, deskLiftType: 'manual' },
  // 固定高デスク
  { name: 'サンワサプライ FDM-12060LMAC', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'Power', direction: 'output', count: 2, label: '内蔵ACコンセント' }, { id: 'p3', type: 'USB_A', direction: 'output', count: 1, label: '給電用USB-A' }] },
  { name: 'サンワサプライ FDM-12070LMAC', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'Power', direction: 'output', count: 2, label: '内蔵ACコンセント' }, { id: 'p3', type: 'USB_A', direction: 'output', count: 1, label: '給電用USB-A' }] },
  { name: 'サンワサプライ FDM-14060LMAC', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'Power', direction: 'output', count: 2, label: '内蔵ACコンセント' }, { id: 'p3', type: 'USB_A', direction: 'output', count: 1, label: '給電用USB-A' }] },
  { name: 'サンワサプライ FDM-14070LMAC', category: 'Desk', ports: [{ id: 'p1', type: 'Power', direction: 'input', count: 1 }, { id: 'p2', type: 'Power', direction: 'output', count: 2, label: '内蔵ACコンセント' }, { id: 'p3', type: 'USB_A', direction: 'output', count: 1, label: '給電用USB-A' }] },
  { name: 'IKEA LINNMON / ALEX' },
  { name: 'IKEA MICKE デスク' },
  { name: 'IKEA FREDDE ゲーミングデスク' },
  { name: 'IKEA TROTTEN デスク' },
  { name: 'IKEA KARLBY ワークトップ + ALEX' },
  { name: 'Bauhutte BHD-1800M ゲーミングデスク' },
  { name: 'Bauhutte BHD-K120 ゲーミングデスク' },
  { name: 'Bauhutte BHD-670H L字デスク' },
  { name: 'サンワダイレクト ワークデスク 100-DESK077W' },
  { name: '山善 デスク YST-1257N' },
  { name: '山善 ゲーミングデスク GDK-1260' },
  { name: 'コクヨ レクトライン デスク' },
  { name: 'LOWYA L字デスク' },
  { name: 'LOWYA ゲーミングデスク' },
]

// =============================================
// モバイルバッテリー
// =============================================
const PB = (name: string, ports: GadgetPreset['ports'], supportsPassThroughCharging = false): GadgetPreset => {
  const capacityMah = name.match(/(\d{4,})mAh/i)?.[1]
  return {
    name,
    category: 'MobileBattery',
    batteryCapacityMah: capacityMah,
    ports,
    supportsPassThroughCharging,
  }
}

export const MOBILE_BATTERY_PRESETS: GadgetPreset[] = [
  PB('Anker PowerCore 10000', [
    { id: 'p1', type: 'microUSB', direction: 'input', count: 1, label: '本体充電' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
  ]),
  PB('Anker Prime Power Bank 20000mAh (200W)', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 2, label: 'USB-C 入出力' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
  ]),
  PB('Anker 733 Power Bank (GaNPrime)', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-C1 入出力' },
    { id: 'p2', type: 'USB_C', direction: 'output', count: 1, label: 'USB-C2 出力' },
    { id: 'p3', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p4', type: 'Power', direction: 'input', count: 1, label: 'AC入力' },
  ], true),
  PB('Anker MagGo Power Bank 10000 (MagSafe)', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-C 入出力' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1, label: 'Qi2 ワイヤレス給電' },
  ]),
  PB('Anker Nano Power Bank (USB-C 一体型)', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, label: '内蔵USB-Cコネクター' },
    { id: 'p2', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-Cポート' },
  ]),
  PB('CIO SMARTCOBY Pro 30W', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 2, label: 'USB-C 入出力' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
  ]),
  PB('CIO SMARTCOBY TRIO 65W', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 2, label: 'USB-C 入出力' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
  ]),
  PB('CIO MagSafe対応 モバイルバッテリー', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-C 入出力' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1, label: 'ワイヤレス給電' },
  ]),
  PB('cheero Power Plus 5 Stick 5000mAh', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-C 入出力' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
  ]),
  PB('AUKEY Basix Pro Mini', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-C 入出力' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'microUSB', direction: 'input', count: 1, label: '本体充電' },
    { id: 'p4', type: 'wirelessCharging', direction: 'output', count: 1, label: 'ワイヤレス給電' },
  ]),
  PB('Belkin BoostCharge Magnetic Power Bank', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-C 入出力' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1, label: 'ワイヤレス給電' },
  ]),
  PB('Apple MagSafe バッテリーパック', [
    { id: 'p1', type: 'Lightning', direction: 'input', count: 1, label: '本体充電' },
    { id: 'p2', type: 'wirelessCharging', direction: 'output', count: 1, label: 'MagSafe ワイヤレス給電' },
  ]),
  PB('UGREEN Nexode Power Bank 20000mAh', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 2, label: 'USB-C 入出力' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
  ]),
  PB('Baseus Blade 2 ノートPC対応 20000mAh', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 2, label: 'USB-C 入出力' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
  ]),
  PB('ELECOM モバイルバッテリー 10000mAh', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-C 入出力' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
  ]),
  PB('RAVPower 26800mAh 大容量', [
    { id: 'p1', type: 'USB_C', direction: 'bidirectional', count: 1, label: 'USB-C 入出力' },
    { id: 'p2', type: 'USB_A', direction: 'output', count: 1 },
    { id: 'p3', type: 'DCPower', direction: 'output', count: 1, label: 'DC出力' },
  ]),
]

// =============================================
// チェア
// =============================================
export const CHAIR_PRESETS: NameSuggestion[] = [
  { name: 'Herman Miller Aeron' },
  { name: 'Herman Miller Embody' },
  { name: 'Herman Miller Mirra 2' },
  { name: 'OKAMURA Sylphy' },
  { name: 'OKAMURA Contessa II' },
  { name: 'コクヨ ingLIFE' },
  { name: 'コクヨ デュオラ' },
  { name: 'AKRacing 11D Premium' },
  { name: 'AKRacing Pro-X V2' },
  { name: 'Secretlab TITAN Evo' },
  { name: 'DXRacer Formula Series' },
  { name: 'DXRacer Air Series' },
  { name: 'Bauhutte ゲーミングチェア GX-550' },
  { name: 'イトーキ サリダ YL9' },
  { name: 'WORKAHOLIC KOKUYO INGLIFE' },
]

// =============================================
// モニターアーム
// =============================================
export const MONITOR_ARM_PRESETS: GadgetPreset[] = [
  { name: 'Ergotron LX シングルモニターアーム', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 1 }] },
  { name: 'Ergotron LX デュアルスタッキングアーム', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 2 }] },
  { name: 'Ergotron LX デュアルサイドバイサイドアーム', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 2 }] },
  { name: 'Ergotron HX', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 1 }] },
  { name: 'Ergotron MX Mini デスクマウント', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 1 }] },
  { name: 'FlexiSpot F9L シングルモニターアーム', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 1 }] },
  { name: 'FlexiSpot MA3 デュアルモニターアーム', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 2 }] },
  { name: 'HUANUO シングルモニターアーム HNSS9', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 1 }] },
  { name: 'HUANUO デュアルモニターアーム HN-D10', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 2 }] },
  { name: 'Amazon Basics 液晶モニターアーム', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'output', count: 2 }, { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: 'USB-C アップストリーム入力' }] },
  { name: 'North Bayou F80 モニターアーム', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 1 }] },
  { name: 'エレコム モニターアーム DPA-SL01BK', category: 'MonitorArm', ports: [{ id: 'p1', type: 'MonitorArm', direction: 'output', count: 1 }] },
]

export const MIC_ARM_PRESETS: GadgetPreset[] = [
  { name: 'Elgato Wave Mic Arm LP', category: 'MicArm', ports: [{ id: 'p1', type: 'MicArm', direction: 'output', count: 1 }] },
  { name: 'RØDE PSA1+', category: 'MicArm', ports: [{ id: 'p1', type: 'MicArm', direction: 'output', count: 1 }] },
  { name: 'Blue Compass', category: 'MicArm', ports: [{ id: 'p1', type: 'MicArm', direction: 'output', count: 1 }] },
]

export const MODEM_PRESETS: GadgetPreset[] = [
  { name: 'ONU（光回線終端装置）', category: 'Modem', ports: [{ id: 'p1', type: 'Ethernet', direction: 'output', count: 1 }, { id: 'p2', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'ケーブルモデム', category: 'Modem', ports: [{ id: 'p1', type: 'Ethernet', direction: 'output', count: 1 }, { id: 'p2', type: 'Power', direction: 'input', count: 1 }] },
]

// =============================================
// ウォールパネル
// =============================================
export const WALL_PANEL_PRESETS: NameSuggestion[] = [
  { name: 'Nanoleaf Shapes Hexagons スターターキット' },
  { name: 'Nanoleaf Shapes Triangle スターターキット' },
  { name: 'Nanoleaf Lines' },
  { name: 'Nanoleaf Canvas' },
  { name: 'Govee Hexa Light Panels' },
  { name: 'Govee Glide RGBIC ウォールライト' },
  { name: 'Govee ネオン LED ライト' },
  { name: 'Twinkly Squares' },
  { name: 'Twinkly Lines' },
  { name: 'Philips Hue Play グラジエント ライトストリップ' },
  { name: 'LIFX Beam' },
]

// =============================================
// コントローラー
// =============================================
export const CONTROLLER_PRESETS: GadgetPreset[] = [
  { name: 'DualSense', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p3', type: 'Audio3_5mm', direction: 'output', count: 1, label: 'ヘッドセット' }] },
  { name: 'DualSense Edge', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p3', type: 'Audio3_5mm', direction: 'output', count: 1, label: 'ヘッドセット' }] },
  { name: 'DualShock 4', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1 }] },
  { name: 'Xbox ワイヤレスコントローラー', category: 'Controller', powerUsage: 'replaceable', ports: [{ id: 'p1', type: 'XboxWireless', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: '有線通信' }, { id: 'p4', type: 'Audio3_5mm', direction: 'output', count: 1, label: 'ヘッドセット' }] },
  { name: 'Xbox Elite ワイヤレスコントローラー Series 2', category: 'Controller', powerUsage: 'rechargeable', ports: [{ id: 'p1', type: 'XboxWireless', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p3', type: 'USB_C', direction: 'input', count: 1, label: '充電・有線通信' }] },
  { name: 'Nintendo Switch Proコントローラー', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Nintendo Switch 2 Proコントローラー', category: 'Controller', powerUsage: 'rechargeable', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1, label: '充電・有線通信' }] },
  { name: 'Nintendo Switch Joy-Con (L)/(R)', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Nintendo Switch 2 Joy-Con (L)/(R)', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Nintendo GameCube コントローラー', category: 'Controller', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'GCアダプター経由' }] },
  { name: 'Nintendo 64 コントローラー (Nintendo Switch Online)', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'スーパーファミコン コントローラー (Nintendo Switch Online)', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'ファミリーコンピュータ コントローラー (Nintendo Switch Online)', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: '8BitDo Pro 2', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: '8BitDo Ultimate 2C', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'SteelSeries Stratus Duo', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1 }] },
  { name: 'Razer Wolverine V2 Pro', category: 'Controller', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Backbone One', category: 'Controller', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  // アーケードコントローラー
  { name: 'HORI Real Arcade Pro N (PS5/PS4)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB有線' }] },
  { name: 'HORI Real Arcade Pro V Hayabusa (Xbox)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB有線' }] },
  { name: 'HORI Fighting Stick α (PS5/PS4)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }] },
  { name: 'QANBA Drone 2 (PS5/PC)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'USB有線' }] },
  { name: 'QANBA Diamond 4 (PS5/PS4/PC)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'QANBA Crystal 2 (PS4/PC)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }] },
  { name: 'Victrix Pro FS (PS5)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: '8BitDo Arcade Stick (Xbox/PC)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
  { name: 'Mad Catz EGO Arcade Stick', category: 'Controller', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Razer Panthera Evo (PS4)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1 }] },
  { name: 'アーケードコントローラー (汎用)', category: 'Controller', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'USB有線' }] },
]

// =============================================
// VR・スマートグラス
// =============================================
export const VR_GLASS_PRESETS: GadgetPreset[] = [
  { name: 'Meta Quest 3', category: 'VRGlass', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Meta Quest 3S', category: 'VRGlass', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Meta Quest 2', category: 'VRGlass', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Apple Vision Pro', category: 'VRGlass', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'PlayStation VR2', category: 'VRGlass', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, supportsVideo: true, label: '映像・データ接続' }] },
  { name: 'Valve Index', category: 'VRGlass', ports: [{ id: 'p1', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USB データ接続' }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'HTC VIVE Pro 2', category: 'VRGlass', ports: [{ id: 'p1', type: 'DisplayPort', direction: 'input', count: 1, supportsVideo: true }, { id: 'p2', type: 'USB_A', direction: 'input', count: 1, label: 'USB データ接続' }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'HTC VIVE XR Elite', category: 'VRGlass', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'XREAL Air 2 Pro', category: 'VRGlass', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Ray-Ban Meta スマートグラス', category: 'VRGlass', ports: [{ id: 'p1', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] },
]

// =============================================
// スマートウォッチ
// =============================================
export const SMARTWATCH_PRESETS: GadgetPreset[] = [
  { name: 'Apple Watch Series 10', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'マグネット充電（専用ケーブル）' }] },
  { name: 'Apple Watch Ultra 2', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'マグネット充電（専用ケーブル）' }] },
  { name: 'Apple Watch SE (第2世代)', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: 'マグネット充電（専用ケーブル）' }] },
  { name: 'GARMIN Fenix 7X', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '専用クレードル' }] },
  { name: 'GARMIN Forerunner 965', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '専用クレードル' }] },
  { name: 'GARMIN Forerunner 265', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '専用クレードル' }] },
  { name: 'GARMIN Venu 3', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '専用クレードル' }] },
  { name: 'Samsung Galaxy Watch 7', category: 'Smartwatch', ports: [{ id: 'p1', type: 'wirelessCharging', direction: 'input', count: 1, label: 'Qi ワイヤレス充電' }] },
  { name: 'Samsung Galaxy Watch Ultra', category: 'Smartwatch', ports: [{ id: 'p1', type: 'wirelessCharging', direction: 'input', count: 1, label: 'Qi ワイヤレス充電' }] },
  { name: 'Google Pixel Watch 3', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '専用クレードル' }] },
  { name: 'Suunto Race', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '専用クレードル' }] },
  { name: 'COROS APEX 2 Pro', category: 'Smartwatch', ports: [{ id: 'p1', type: 'USB_A', direction: 'input', count: 1, label: '専用クレードル' }] },
]

export const STYLUS_ACCESSORY_PRESETS: GadgetPreset[] = [
  { name: 'Apple Pencil Pro', category: 'Accessory', ports: [{ id: 'p1', type: 'wirelessCharging', direction: 'input', count: 1, label: 'ワイヤレス給電' }, { id: 'p2', type: 'Bluetooth', direction: 'output', count: 1 }] },
  { name: 'Apple Pencil (USB-C)', category: 'Accessory', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: '充電・データ' }, { id: 'p2', type: 'Bluetooth', direction: 'output', count: 1 }] },
]

// =============================================
// ケーブル
// =============================================
export const CABLE_PRESETS: NameSuggestion[] = [
  { name: 'Anker USB-C & USB-C ケーブル 1m' },
  { name: 'Anker USB-C & USB-C ケーブル 2m' },
  { name: 'Anker USB-C & USB-A ケーブル 0.9m' },
  { name: 'Anker Thunderbolt 4 ケーブル 0.7m' },
  { name: 'Anker Thunderbolt 4 ケーブル 1.8m' },
  { name: 'Apple USB-C – MagSafe 3 ケーブル 2m' },
  { name: 'Apple Thunderbolt 4 Pro ケーブル 1.8m' },
  { name: 'Belkin HDMI 2.1 ケーブル 2m' },
  { name: 'CableMatters DisplayPort 1.4 ケーブル 1.8m' },
  { name: 'Ugreen HDMI 2.1 8K ケーブル 2m' },
  { name: 'Ugreen USB-C & USB-C 100W ケーブル 1.5m' },
  { name: 'ELECOM スリム LAN ケーブル Cat6A 1m' },
  { name: 'ELECOM スリム LAN ケーブル Cat6A 3m' },
  { name: 'YAMAHA XLR ケーブル 3m' },
  { name: 'mogami 2549 XLR マイクケーブル 3m' },
  { name: 'SYNCWIRE USB-C & USB-C ナイロン ケーブル 2m' },
  { name: 'Baseus HDMI 2.0 4K ケーブル 1m' },
  { name: 'Club3D DisplayPort 1.4 HBR3 ケーブル 3m' },
  { name: 'Plugable Thunderbolt 3 アクティブケーブル 2m' },
  { name: 'Audioquest HDMI Carbon 1m' },
]

// =============================================
// 楽器
// =============================================
export const INSTRUMENT_PRESETS: GadgetPreset[] = [
  // デジタルピアノ
  { name: 'Yamaha P-125a', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC/Mac接続' }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ヘッドホン出力' }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Roland FP-30X', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC/Mac接続' }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 2, label: '6.3mm ヘッドホン出力' }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Kawai ES120', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC/Mac接続' }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 2 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'KORG B2', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC/Mac接続' }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 2 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Roland RD-88', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Yamaha P-515', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 2 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Casio PX-S1100', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Nord Piano 4', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  // MIDIコントローラー
  { name: 'Akai MPK mini MK3', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC/Mac接続' }] },
  { name: 'Arturia KeyLab Essential 88 MK3', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Native Instruments Komplete Kontrol A25', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Roland A-49', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Donner MIDI Keyboard 25鍵', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  // シンセサイザー
  { name: 'Roland JUNO-DS61', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }, { id: 'p4', type: 'MIDI', direction: 'input', count: 1, label: 'MIDI IN' }, { id: 'p5', type: 'MIDI', direction: 'output', count: 1, label: 'MIDI OUT' }] },
  { name: 'Korg Minilogue XD', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }, { id: 'p4', type: 'MIDI', direction: 'input', count: 1, label: 'MIDI IN' }, { id: 'p5', type: 'MIDI', direction: 'output', count: 1, label: 'MIDI OUT' }] },
  { name: 'Arturia MiniFreak', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Roland JD-Xi', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Moog Grandmother', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  // MIDIパッドコントローラー
  { name: 'Akai MPC One+', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Native Instruments Maschine Mikro MK3', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  { name: 'Akai MPD226', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }] },
  // 電子ドラム
  { name: 'Roland V-Drums TD-17KVX', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Yamaha DTX452K', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Alesis Nitro Mesh', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Roland SPD-SX', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Audio6_3mm', direction: 'output', count: 1 }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  // エレキギター
  { name: 'Fender Stratocaster', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Fender Telecaster', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Gibson Les Paul', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Gibson SG Standard', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'PRS SE Custom 24', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Epiphone Les Paul Standard', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Squier Stratocaster', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Yamaha Pacifica 112V', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Ibanez RG450DX', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'ESP Eclipse-I CTM', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  // アコースティックギター
  { name: 'Martin D-28', category: 'Instrument', ports: [] },
  { name: 'Taylor 214ce', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm ピックアップ出力' }] },
  { name: 'Yamaha FG800', category: 'Instrument', ports: [] },
  { name: 'Gibson J-45 Standard', category: 'Instrument', ports: [] },
  // ベースギター
  { name: 'Fender Precision Bass', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Fender Jazz Bass', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Music Man StingRay', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  { name: 'Ibanez SR300E', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'output', count: 1, label: '6.3mm フォーン出力' }] },
  // ギターアンプ
  { name: 'Fender Blues Junior IV', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'input', count: 1, label: '6.3mm Input' }, { id: 'p2', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Marshall DSL20CR', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'input', count: 1, label: '6.3mm Input' }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1, label: 'PC録音' }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'VOX AC15C1', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'input', count: 1, label: '6.3mm Input' }, { id: 'p2', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Boss Katana 50 MK II', category: 'Instrument', ports: [{ id: 'p1', type: 'Audio6_3mm', direction: 'input', count: 1 }, { id: 'p2', type: 'USB_C', direction: 'input', count: 1, label: 'PC録音' }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  // エフェクター
  { name: 'Line 6 HX Stomp', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1, label: 'PC接続' }, { id: 'p2', type: 'Audio6_3mm', direction: 'input', count: 1, label: '6.3mm Guitar In' }, { id: 'p3', type: 'Power', direction: 'input', count: 1 }] },
  { name: 'Boss GT-1000CORE', category: 'Instrument', ports: [{ id: 'p1', type: 'USB_C', direction: 'input', count: 1 }, { id: 'p2', type: 'Power', direction: 'input', count: 1 }] },
  // ウクレレ
  { name: 'Kamaka HF-1 ソプラノウクレレ', category: 'Instrument', ports: [] },
  { name: 'Kala KA-C コンサートウクレレ', category: 'Instrument', ports: [] },
  { name: 'Yamaha GL1 コンサートウクレレ', category: 'Instrument', ports: [] },
  // バイオリン
  { name: 'Yamaha V3SKA バイオリンセット', category: 'Instrument', ports: [] },
  { name: 'Stentor Student II バイオリン', category: 'Instrument', ports: [] },
]

// =============================================
// ゲームタイトルサジェスト（世界1000万本以上）
// =============================================
export const PC_GAME_SUGGESTIONS: string[] = [
  'Minecraft (Java Edition)',
  'Grand Theft Auto V',
  'Counter-Strike 2',
  'PUBG: Battlegrounds',
  'Red Dead Redemption 2',
  'The Witcher 3: Wild Hunt',
  'Terraria',
  'Cyberpunk 2077',
  'Elden Ring',
  'Palworld',
  'Hogwarts Legacy',
  'Stardew Valley',
  'Valheim',
  'Baldur\'s Gate 3',
  'Monster Hunter: World',
  'Monster Hunter Rise',
  'Dark Souls III',
  'Sekiro: Shadows Die Twice',
  'Forza Horizon 5',
  'Diablo IV',
  'The Sims 4',
  'Apex Legends',
  'Fortnite',
  'VALORANT',
  'League of Legends',
  'Path of Exile',
  'Dota 2',
  'Half-Life 2',
  'Portal 2',
  'Destiny 2',
]

export const CONSOLE_GAME_SUGGESTIONS: string[] = [
  // Nintendo Switch
  'Mario Kart 8 Deluxe',
  'Animal Crossing: New Horizons',
  'Super Smash Bros. Ultimate',
  'The Legend of Zelda: Breath of the Wild',
  'The Legend of Zelda: Tears of the Kingdom',
  'Pokémon スカーレット / バイオレット',
  'Pokémon ソード / シールド',
  'Super Mario Odyssey',
  'Super Mario Bros. Wonder',
  'Super Mario Party',
  'Ring Fit Adventure',
  'New Super Mario Bros. U Deluxe',
  'Splatoon 3',
  'Splatoon 2',
  'Luigi\'s Mansion 3',
  'Kirby and the Forgotten Land',
  'Metroid Dread',
  'Xenoblade Chronicles 3',
  'Fire Emblem Engage',
  // PlayStation
  'Marvel\'s Spider-Man',
  'Marvel\'s Spider-Man 2',
  'God of War (2018)',
  'God of War: Ragnarök',
  'Horizon Zero Dawn',
  'Horizon Forbidden West',
  'The Last of Us Part II',
  'Gran Turismo 7',
  'Uncharted 4',
  'Ratchet & Clank: Rift Apart',
  // Xbox
  'Forza Horizon 5',
  'Forza Horizon 4',
  'Halo Infinite',
  'Sea of Thieves',
  // クロスプラットフォーム
  'Minecraft',
  'Grand Theft Auto V',
  'Red Dead Redemption 2',
  'Elden Ring',
  'Cyberpunk 2077',
  'The Witcher 3: Wild Hunt',
  'Hogwarts Legacy',
  'Monster Hunter: World',
  'Monster Hunter Rise',
  'Diablo IV',
  'EA SPORTS FC 24',
  'FIFA 23',
  'Call of Duty: Modern Warfare III',
  'Call of Duty: Black Ops 6',
  'Apex Legends',
  'Fortnite',
  'Overwatch 2',
]

// 全プリセットの統合リスト。ProductRepository（モック実装）の検索母集団。
// 新しいプリセット配列を追加したらここにも足すこと。
/**
 * 商品マスタ（Supabase products）へ投入する全プリセット。
 *
 * カテゴリは「どの配列に入っているか」で決まるので、平坦に連結すると失われる。
 * category が空のまま投入されると、予測変換の商品DB検索（カテゴリで絞る）に
 * 引っかからず、その商品だけ購入リンクが引けなくなる。ここで明示的に付け直す。
 */
const withCategory = <T extends NameSuggestion>(list: T[], category: GadgetCategory) =>
  list.map((preset) => ({ ...preset, category }))

/**
 * 実在のデスクツアー・デスク周りのまとめ記事でよく使われているのに、商品DBに無かった定番（2026年9月）。
 * 楽天の売れ筋上位だけを取り込む仕組みでは、高価格帯の定番や、親ジャンルに埋もれた子ジャンルの商品が
 * 入らない。いずれも楽天で本体の販売を確かめている。端子は調べていないので名前だけの候補にしてあり、
 * 選ぶとカテゴリ既定の端子（推定）になる
 */
const DESK_TOUR_STAPLE_SUGGESTIONS: (NameSuggestion & { category: GadgetCategory })[] = [
  { name: 'Dell U3425WE', brand: 'Dell', category: 'Monitor' },
  { name: 'Dell U4025QW', brand: 'Dell', category: 'Monitor' },
  { name: 'ASUS ProArt PA27JCV', brand: 'ASUS', category: 'Monitor' },
  { name: 'ASUS ProArt PA32UCDM', brand: 'ASUS', category: 'Monitor' },
  { name: 'LG 34WN80C-B', brand: 'LG', category: 'Monitor' },
  { name: 'LG 27UP850-W', brand: 'LG', category: 'Monitor' },
  { name: 'EIZO FlexScan EV2360', brand: 'EIZO', category: 'Monitor' },
  { name: 'MSI MAG 274QRFW', brand: 'MSI', category: 'Monitor' },
  { name: 'MSI PRO MP341CQW', brand: 'MSI', category: 'Monitor' },
  { name: 'Steelcase Gesture', brand: 'Steelcase', category: 'Chair' },
  { name: 'KOKUYO pallo', brand: 'KOKUYO', category: 'Chair' },
  { name: 'エルゴヒューマン2', brand: 'Ergohuman', category: 'Chair' },
  { name: 'エルゴヒューマン エンジョイ', brand: 'Ergohuman', category: 'Chair' },
  { name: 'COFO Chair Premium', brand: 'COFO', category: 'Chair' },
  { name: 'COFO 無重力モニターアーム', brand: 'COFO', category: 'MonitorArm' },
  { name: 'COFO 無重力モニターアーム Pro', brand: 'COFO', category: 'MonitorArm' },
  { name: 'HUANUO HNDS8', brand: 'HUANUO', category: 'MonitorArm' },
  { name: 'Ergotron LX Pro モニターアーム', brand: 'Ergotron', category: 'MonitorArm' },
  { name: 'SHURE SM7B', brand: 'SHURE', category: 'Microphone' },
  { name: 'RODE NT1 5th Generation', brand: 'RODE', category: 'Microphone' },
  { name: 'Neumann TLM 103', brand: 'Neumann', category: 'Microphone' },
  { name: 'MAONO PD200X', brand: 'MAONO', category: 'Microphone' },
  { name: 'Razer Seiren V3 Mini', brand: 'Razer', category: 'Microphone' },
  { name: 'Aston Microphones Origin', brand: 'Aston Microphones', category: 'Microphone' },
  { name: 'Earthworks ICON', brand: 'Earthworks', category: 'Microphone' },
  { name: 'RODECaster Duo', brand: 'RODE', category: 'Mixer' },
  { name: 'TC-Helicon GoXLR', brand: 'TC-Helicon', category: 'Mixer' },
  { name: 'Universal Audio Apollo Twin', brand: 'Universal Audio', category: 'AudioInterface' },
  { name: 'beyerdynamic DT 770 PRO', brand: 'beyerdynamic', category: 'Headphone' },
  { name: 'SONY MDR-MV1', brand: 'SONY', category: 'Headphone' },
  { name: 'SONY MDR-M1ST', brand: 'SONY', category: 'Headphone' },
  { name: 'Sennheiser HD 660S2', brand: 'Sennheiser', category: 'Headphone' },
  { name: 'Neumann NDH 20', brand: 'Neumann', category: 'Headphone' },
  { name: 'audio-technica ATH-HL7BT', brand: 'audio-technica', category: 'Headphone' },
  { name: 'Topping DX3 Pro+', brand: 'Topping', category: 'HeadphoneAmp' },
  { name: 'ADAM Audio A4V', brand: 'ADAM Audio', category: 'Speaker' },
  { name: 'Sonos Ray', brand: 'Sonos', category: 'Speaker' },
  { name: 'Roland AIRA Compact T-8', brand: 'Roland', category: 'Instrument' },
  { name: 'Behringer X-TOUCH MINI', brand: 'Behringer', category: 'Instrument' },
  { name: 'Keychron B11 Pro', brand: 'Keychron', category: 'Keyboard' },
  { name: 'Logicool MX KEYS mini for Mac', brand: 'Logicool', category: 'Keyboard' },
  // 左手デバイスは商品DBの既存の置き場（TourBox は PenTablet、Stream Deck は Keyboard）に揃える
  { name: 'TourBox Elite', brand: 'TourBox', category: 'PenTablet' },
  { name: 'Logicool MX Creative Console', brand: 'Logicool', category: 'Keyboard' },
  { name: 'Blackmagic DaVinci Resolve Speed Editor', brand: 'Blackmagic Design', category: 'Keyboard' },
  { name: 'Philips Hue Play ライトバー', brand: 'Philips Hue', category: 'Light' },
  { name: 'Artemide Tolomeo', brand: 'Artemide', category: 'Light' },
  { name: 'Philips Hue ブリッジ', brand: 'Philips Hue', category: 'SmartHome' },
  { name: 'Anker 737 Power Bank (PowerCore 24000)', brand: 'Anker', category: 'MobileBattery' },
  { name: 'エレコム ECT-0102BK', brand: 'ELECOM', category: 'PowerStrip' },
  { name: 'サンワダイレクト 700-TAP083', brand: 'サンワダイレクト', category: 'PowerStrip' },
  { name: 'TP-Link TL-SG1008P', brand: 'TP-Link', category: 'NetworkSwitch' },
  { name: 'LaCie Rugged USB-C 5TB', brand: 'LaCie', category: 'Storage' },
  { name: 'Google Pixel 10 Pro', brand: 'Google', category: 'Smartphone' },
  { name: 'MIWAX The Desk Mat', brand: 'MIWAX', category: 'DeskPad' },
  { name: 'Satechi ヴィーガンレザーデスクマット', brand: 'Satechi', category: 'DeskPad' },
  { name: 'MOFT スマートデスクマット', brand: 'MOFT', category: 'DeskPad' },
  { name: 'Grovemade ウールフェルトデスクパッド', brand: 'Grovemade', category: 'DeskPad' },
  { name: 'amesoba デスクシェルフ', brand: 'amesoba', category: 'Furniture' },
  { name: '山善 デスクサイドワゴン MWT-60', brand: '山善', category: 'Furniture' },
  { name: 'CLASSIC PRO MST5 スピーカースタンド', brand: 'CLASSIC PRO', category: 'Furniture' },
  { name: 'Kanto スピーカースタンド', brand: 'Kanto', category: 'Furniture' },
  { name: 'サンワサプライ メッシュケーブルトレー CB-CT5', brand: 'サンワサプライ', category: 'Accessory' },
  { name: 'MYGRAPHY パンチングボード', brand: 'MYGRAPHY', category: 'Accessory' },
  { name: 'Anker Magnetic Cable Holder', brand: 'Anker', category: 'Accessory' },
  { name: 'DELTAHUB Carpio 2.0', brand: 'DELTAHUB', category: 'Accessory' },
]

export const ALL_PRODUCT_PRESETS: (NameSuggestion & { category?: GadgetCategory })[] = [
  // 同名の商品は先に来たものが商品DBのカテゴリになる（importRakuten の collectPresets）。
  // GADGET_PRESETS にはイヤホンが Headphone のまま入っていて、EARPHONE_PRESETS の
  // Earphone より先に当たり、AirPods Pro や WF-1000XM5 が商品DBでヘッドホンになっていた
  ...GADGET_PRESETS.map((preset) =>
    preset.category === 'Headphone' && isEarphonePreset(preset.name) ? { ...preset, category: 'Earphone' as const } : preset),
  ...withCategory(PC_LAPTOP_SUGGESTIONS, 'PC'),
  ...withCategory(PC_DESKTOP_SUGGESTIONS, 'PC'),
  ...withCategory(AUDIO_INTERFACE_PRESETS, 'AudioInterface'),
  ...withCategory(HEADPHONE_AMP_PRESETS, 'HeadphoneAmp'),
  ...withCategory(AMPLIFIER_PRESETS, 'Amplifier'),
  ...withCategory(PASSIVE_SPEAKER_PRESETS, 'Speaker'),
  ...withCategory(MIXER_PRESETS, 'Mixer'),
  ...withCategory(SMART_HOME_PRESETS, 'SmartHome'),
  ...withCategory(SMARTPHONE_PRESETS, 'Smartphone'),
  ...withCategory(TABLET_PRESETS, 'Tablet'),
  ...withCategory(HEADPHONE_PRESETS, 'Headphone'),
  ...withCategory(EARPHONE_PRESETS, 'Earphone'),
  ...withCategory(CHARGER_PRESETS, 'Charger'),
  ...withCategory(MOBILE_BATTERY_PRESETS, 'MobileBattery'),
  ...withCategory(DESK_PRESETS, 'Desk'),
  ...withCategory(CHAIR_PRESETS, 'Chair'),
  ...withCategory(MONITOR_ARM_PRESETS, 'MonitorArm'),
  ...withCategory(MIC_ARM_PRESETS, 'MicArm'),
  ...withCategory(MODEM_PRESETS, 'Modem'),
  ...withCategory(WALL_PANEL_PRESETS, 'WallPanel'),
  ...withCategory(CONTROLLER_PRESETS, 'Controller'),
  ...withCategory(VR_GLASS_PRESETS, 'VRGlass'),
  ...withCategory(CABLE_PRESETS, 'Cable'),
  ...withCategory(INSTRUMENT_PRESETS, 'Instrument'),
  ...withCategory(SMARTWATCH_PRESETS, 'Smartwatch'),
  ...withCategory(STYLUS_ACCESSORY_PRESETS, 'Accessory'),
  ...DESK_TOUR_STAPLE_SUGGESTIONS,
]
