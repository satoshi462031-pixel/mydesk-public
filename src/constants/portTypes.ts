import { CableType, PortType } from '../types'
import { MCIconName } from './icons'
import { themeIconColor } from './colors'

export const PORT_LABELS: Record<PortType, string> = {
  USB_C: 'USB-C',
  USB_A: 'USB-A',
  USB_B: 'USB-B',
  USB_A_to_C: 'USB-A ↔ USB-C',
  Lightning: 'Lightning',
  microUSB: 'microUSB',
  Thunderbolt: 'Thunderbolt',
  HDMI: 'HDMI',
  DisplayPort: 'DP',
  MiniDisplayPort: 'mDP',
  VGA: 'VGA',
  DVI: 'DVI',
  Power: '電源',
  Ethernet: 'Ethernet',
  EthernetPoE: 'Ethernet (PoE)',
  Audio3_5mm: '3.5mm Audio',
  Audio6_3mm: '6.3mm TRS',
  Audio6_3mm_TS: '6.3mm TS',
  Audio4_4mm: '4.4mm バランス',
  XLR_TRS_Combo: 'XLR / TRS コンボ',
  XLR4pin: 'XLR 4pin バランス',
  RCA: 'RCA',
  CoaxialAudio: '同軸デジタル',
  Audio3_5_to_6_3: '3.5mm ↔ 6.3mm',
  OpticalAudio: '光デジタル',
  SpeakerTerminal: 'スピーカー端子',
  SDCard: 'SD Card',
  microSDCard: 'microSD',
  CFexpress: 'CFexpress',
  XboxExpansion: 'Xbox ストレージ拡張',
  XLR: 'XLR',
  MIDI: 'MIDI',
  MIDI_TRS: 'MIDI (3.5mm TRS)',
  MonitorArm: 'アーム',
  MicArm: 'マイクアーム',
  Bluetooth: 'Bluetooth',
  XboxWireless: 'Xbox Wireless',
  WiFi: 'Wi-Fi',
  Stylus: 'スタイラスペン',
  wirelessCharging: 'ワイヤレス充電',
  Battery: '電池',
  DCPower: 'DC電源',
}

export const PORT_LABELS_EN: Record<PortType, string> = {
  ...PORT_LABELS,
  Power: 'Power',
  MonitorArm: 'Monitor arm',
  MicArm: 'Microphone arm',
  Stylus: 'Stylus',
  wirelessCharging: 'Wireless charging',
  Battery: 'Battery',
  DCPower: 'DC power',
  OpticalAudio: 'Optical audio',
  Audio6_3mm: '6.3mm TRS',
  Audio4_4mm: '4.4mm balanced',
  Audio3_5_to_6_3: '3.5mm ↔ 6.3mm adapter',
  MIDI: 'MIDI',
  MIDI_TRS: 'MIDI (3.5mm TRS)',
  EthernetPoE: 'Ethernet (PoE)',
  Audio6_3mm_TS: '6.3mm TS',
  XLR_TRS_Combo: 'XLR / TRS combo',
  XLR4pin: 'XLR 4-pin balanced',
  RCA: 'RCA',
  CoaxialAudio: 'Coaxial S/PDIF',
  SpeakerTerminal: 'Speaker terminal',
  CFexpress: 'CFexpress',
  XboxExpansion: 'Xbox storage expansion',
}

export function portLabel(type: PortType, lang: 'ja' | 'en'): string {
  return lang === 'en' ? PORT_LABELS_EN[type] : PORT_LABELS[type]
}

const SAVED_PORT_LABELS_EN: Record<string, string> = {
  'ワイヤレス出力': 'Wireless output',
  'アース付き 3極': 'Grounded 3-prong',
  '2極': '2-prong',
  '給電 (コンセント)': 'Power (outlet)',
  '給電 (DCプラグ)': 'Power (DC plug)',
  '給電 (A)': 'Power (USB-A)',
  '給電 (C)': 'Power (USB-C)',
  'ワイヤレス給電': 'Wireless charging',
  '給電 (ソーラーパネル)': 'Power (solar panel)',
  '給電 (電池・バッテリー)': 'Power (battery)',
  '3.5mm オーディオジャック': '3.5mm audio jack',
  '2.4GHzレシーバー': '2.4GHz receiver',
  '4.4mm ヘッドホン出力': '4.4mm headphone output',
  '6.3mm TRS ライン出力 ×4': '6.3mm TRS line outputs ×4',
  '6.3mm ピックアップ出力': '6.3mm pickup output',
  '6.3mm ライン / 楽器入力': '6.3mm line / instrument input',
  '6.3mm ライン入力 ×2': '6.3mm line inputs ×2',
  '6.3mm 出力': '6.3mm output',
  '6.3mm 楽器入力': '6.3mm instrument input',
  'AC アダプタ': 'AC adapter',
  'AC アダプタ (Dock)': 'AC adapter (dock)',
  'AC入力': 'AC input',
  'AC出力': 'AC output',
  'ADAT / SPDIF 光入出力': 'ADAT / S/PDIF optical I/O',
  'DC出力': 'DC output',
  'GCアダプター経由': 'Via GameCube adapter',
  'HDMI (Dock経由)': 'HDMI (via dock)',
  'HDMI IN (ゲーム機から)': 'HDMI in (from console)',
  'HDMI OUT (パススルー)': 'HDMI out (pass-through)',
  'HyperSpeedレシーバー': 'HyperSpeed receiver',
  'JFET 楽器入力': 'JFET instrument input',
  'LIGHTSPEEDレシーバー': 'LIGHTSPEED receiver',
  'Logi Boltレシーバー': 'Logi Bolt receiver',
  'MagSafe ワイヤレス給電': 'MagSafe wireless charging',
  'PC/Mac接続': 'PC / Mac connection',
  'PC接続': 'PC connection',
  'PC接続 (USB 3.0)': 'PC connection (USB 3.0)',
  'PC接続 (USB 3.2 Gen 2)': 'PC connection (USB 3.2 Gen 2)',
  'PC接続 (USB 3.2 Gen 2x2)': 'PC connection (USB 3.2 Gen 2x2)',
  'PC接続 (USB 3.2)': 'PC connection (USB 3.2)',
  'PC接続 (USB-A)': 'PC connection (USB-A)',
  'PC接続 (USB-C)': 'PC connection (USB-C)',
  'PC接続 / USBメモリ': 'PC connection / USB drive',
  'PC接続 / 充電': 'PC connection / charging',
  'PC録音': 'PC recording',
  'Qi2 ワイヤレス給電': 'Qi2 wireless charging',
  'Qi2スマートフォン＋Qiイヤホン': 'Qi2 phone + Qi earbuds',
  'Qiスマートフォン＋Galaxy Watch / Buds': 'Qi phone + Galaxy Watch / Buds',
  'RCA ライン出力 ×4': 'RCA line outputs ×4',
  'Switch 2 本体 / Dock接続': 'Switch 2 console / dock',
  'TRS バランス入力': 'TRS balanced input',
  'Thunderbolt 3 (映像 / データ / PD 90W給電)': 'Thunderbolt 3 (video / data / 90W PD)',
  'Thunderbolt 4 (映像 / データ / PD 140W給電)': 'Thunderbolt 4 (video / data / 140W PD)',
  'Thunderbolt 4 (映像 / 給電)': 'Thunderbolt 4 (video / power)',
  'USB (PC接続/録音)': 'USB (PC / recording)',
  'USB 2.0 (PC接続)': 'USB 2.0 (PC connection)',
  'USB データ接続': 'USB data connection',
  'USB-A (USB 2.0・前面)': 'USB-A (USB 2.0, front)',
  'USB-A (本体接続)': 'USB-A (main unit)',
  'USB-A レシーバー': 'USB-A receiver',
  'USB-A 有線': 'USB-A wired',
  'USB-A 電源': 'USB-A power',
  'USB-A 電源 (モニターから給電可)': 'USB-A power (can be powered by the monitor)',
  'USB-B (PC接続)': 'USB-B (PC connection)',
  'USB-C (PC接続)': 'USB-C (PC connection)',
  'USB-C (PC接続/録音)': 'USB-C (PC / recording)',
  'USB-C (上部・充電)': 'USB-C (top, charging)',
  'USB-C (上部・周辺機器・充電)': 'USB-C (top, peripherals / charging)',
  'USB-C (下部・Dock接続)': 'USB-C (bottom, dock)',
  'USB-C (下部・Dock接続・充電)': 'USB-C (bottom, dock / charging)',
  'USB-C (映像 / 給電)': 'USB-C (video / power)',
  'USB-C (映像)': 'USB-C (video)',
  'USB-C (映像出力 / 充電)': 'USB-C (video out / charging)',
  'USB-C (本体接続)': 'USB-C (main unit)',
  'USB-C (電源)': 'USB-C (power)',
  'USB-C 入出力': 'USB-C input / output',
  'USB-C1 入出力': 'USB-C1 input / output',
  'USB-C2 出力': 'USB-C2 output',
  'USB-Cポート': 'USB-C port',
  'USB-C充電ポート': 'USB-C charging port',
  'USB-C給電': 'USB-C power',
  'USBドングル': 'USB dongle',
  'USBドングル (PlayStation Link)': 'USB dongle (PlayStation Link)',
  'USBドングル / 充電': 'USB dongle / charging',
  'USBハブ': 'USB hub',
  'USBレシーバー': 'USB receiver',
  'USB充電ポート': 'USB charging port',
  'USB接続': 'USB connection',
  'USB有線': 'USB wired',
  'USB電源': 'USB power',
  'USB電源 (TVから給電可)': 'USB power (can be powered by the TV)',
  'Unifyingレシーバー': 'Unifying receiver',
  'XLR アナログ出力': 'XLR analog output',
  'XLR マイク入力': 'XLR mic input',
  'XLR バランス入力': 'XLR balanced input',
  '6.3mm TRS バランス入力': '6.3mm TRS balanced input',
  'USB-C / USB-A 両挿し': 'USB-C / USB-A dual connector',
  'XLR 出力（ファンタム電源）': 'XLR output (phantom power)',
  'XLR/TRS コンボ': 'XLR / TRS combo',
  'XLR/TRS コンボ ×2': 'XLR / TRS combo ×2',
  'XLR/TRS コンボ入力': 'XLR / TRS combo input',
  'アップリンク': 'Uplink',
  'アナログ入力': 'Analog input',
  'ケース充電': 'Case charging',
  'ストレージ拡張スロット': 'Storage expansion slot',
  'データ (Link)': 'Data (Link)',
  'ヘッドセット': 'Headset',
  'レシーバー': 'Receiver',
  '付属25Wアダプター経由': 'Via bundled 25W adapter',
  '付属45W電源アダプター経由': 'Via bundled 45W power adapter',
  '付属USB PD充電器経由': 'Via bundled USB PD charger',
  '付属電源アダプター経由': 'Via bundled power adapter',
  '充電': 'Charging',
  '充電 (マグネット式)': 'Charging (magnetic)',
  '充電 / Dock接続': 'Charging / dock',
  '充電 / PC接続': 'Charging / PC connection',
  '充電 / 有線': 'Charging / wired',
  '充電・データ': 'Charging / data',
  '充電・有線通信': 'Charging / wired data',
  '内蔵USB-Cコネクター': 'Built-in USB-C connector',
  '受信機出力': 'Receiver output',
  '操作パネルUSB充電': 'Control panel USB charging',
  '映像・データ・充電': 'Video / data / charging',
  '映像・データ接続': 'Video / data connection',
  '有線': 'Wired',
  '有線 / 充電': 'Wired / charging',
  '有線LAN': 'Wired LAN',
  '有線LAN (Dock)': 'Wired LAN (dock)',
  '有線接続': 'Wired connection',
  '有線接続 (USB-A)': 'Wired connection (USB-A)',
  '有線接続 / 充電': 'Wired connection / charging',
  '有線通信': 'Wired data',
  '本体充電': 'Device charging',
  '給電用USB-A': 'USB-A for power',
  '電源 (USB)': 'Power (USB)',
}

export function localizedPortLabel(type: PortType, savedLabel: string | undefined, lang: 'ja' | 'en'): string {
  if (!savedLabel) return portLabel(type, lang)
  return lang === 'en' ? (SAVED_PORT_LABELS_EN[savedLabel] ?? savedLabel) : savedLabel
}

export const PORT_COLORS: Record<PortType, string> = {
  // よく使う配線は色相を離し、白・黒どちらの背景でも区別しやすくする。
  USB_C: '#FFD21A',          // 黄
  USB_A: '#FF4D57',          // 赤
  USB_B: '#E85D68',
  USB_A_to_C: '#FF4D57',     // 表示上はUSB-Aへ統一
  Lightning: '#F59F40',
  microUSB: '#F97316',
  // 旧 TB3/TB4 の琥珀色は USB-C(#FFC400) とほぼ同色で、1本化すると見分けがつかない
  Thunderbolt: '#4C6EF5',    // インディゴ
  HDMI: '#8B6CFF',           // 紫
  DisplayPort: '#24C768',    // 緑
  MiniDisplayPort: '#35D477',
  VGA: '#8A94A3',
  DVI: '#6F7C8C',
  Power: '#000000',
  Ethernet: '#A66BFF',       // バイオレット
  EthernetPoE: '#7C4DFF',
  Audio3_5mm: '#FF4F9A',     // ピンク
  Audio6_3mm: '#D946EF',
  Audio6_3mm_TS: '#C026D3',
  // 6.3mm より一段深い同系色。同じ「フォーン」の仲間だと分かりつつ、隣に並んでも見分けがつく
  Audio4_4mm: '#AE3EC9',
  XLR_TRS_Combo: '#A855F7',
  // XLR(3pin) の明るい兄弟色。DisplayPort と mDP の関係と同じ付け方
  XLR4pin: '#C9764A',
  RCA: '#F43F5E',
  // 光デジタル(#EC4899) と同系の暗い側。どちらもデジタル、RCA のアナログとは別グループに見せる
  CoaxialAudio: '#DB2777',
  Audio3_5_to_6_3: '#C026D3',
  OpticalAudio: '#EC4899',
  // 唯一アンプ→パッシブスピーカー間だけに出る線。他のオーディオ系と混同しないよう色相を空き帯へ離す
  SpeakerTerminal: '#A3E635',
  SDCard: '#FF9E32',
  microSDCard: '#F59F40',
  CFexpress: '#FFAD45',
  XboxExpansion: '#107C10',
  XLR: '#B87352',
  MIDI: '#7C3AED',
  MIDI_TRS: '#9575F0',
  MonitorArm: '#98A1AD',
  MicArm: '#858F9C',
  Bluetooth: '#3393FF',      // Bluetoothは青で固定
  XboxWireless: '#107C10',   // Xboxブランドの緑
  WiFi: '#00A6A6',
  Stylus: '#D06BEE',
  wirelessCharging: '#19C985',
  Battery: '#FFE638',
  DCPower: '#4B5563',
}

// ダークテーマで沈む配線色の差し替え。
// 電源は現実のケーブルに合わせて黒にしているが、黒背景のマップ上では線が
// 完全に消えるため白系へ反転する（他のポート色はどれも #000 上で 3.5:1 以上ある）。
const PORT_COLORS_DARK: Partial<Record<PortType, string>> = {
  Power: '#E9E9EF',
  // 素の #4B5563 は true black の地で 2.78:1 と、線として見えるぎりぎりを割る
  DCPower: '#535B69',
}

/** 配線色をテーマ補正込みで引く。PORT_COLORS を直接読まずこちらを使う。 */
const CABLE_BASE_PORT: Partial<Record<CableType, PortType>> = {
  USB_A_to_B: 'USB_A',
  USB_C_to_B: 'USB_C',
  USB_A_to_Lightning: 'Lightning',
  USB_C_to_Lightning: 'Lightning',
  USB_A_to_microUSB: 'microUSB',
  USB_C_to_microUSB: 'microUSB',
  MiniDisplayPort_to_DisplayPort: 'DisplayPort',
  USB_C_to_DisplayPort: 'DisplayPort',
  USB_C_to_HDMI: 'HDMI',
  DisplayPort_to_HDMI: 'HDMI',
  HDMI_to_DisplayPort: 'DisplayPort',
  HDMI_to_DVI: 'DVI',
  RCA_to_3_5mm: 'RCA',
  RCA_to_6_3mm: 'RCA',
}

export function portColor(type: CableType, isDark: boolean): string {
  const base = CABLE_BASE_PORT[type] ?? type as PortType
  const color = (isDark ? PORT_COLORS_DARK[base] : undefined) ?? PORT_COLORS[base]
  // 黄・ライム・明るいオレンジは、ライトでは彩度を上げて 3:1 に届く色へ動かす（themeIconColor）。
  return isDark ? color : themeIconColor(color, false)
}

/** 配線図より明るいカード・入力欄で、端子のアイコンや色見本を見分けられる色。 */
export function portIconColor(type: CableType, isDark: boolean): string {
  return themeIconColor(portColor(type, isDark), isDark)
}

/**
 * ポートの色をチップ・バッジの地に薄く敷くときの色のもと。ライトは暗くする前の色を使う。
 * 3:1 まで暗くした色（portColor）を薄く敷くと、地まで茶色っぽくくすむ。
 * 上に載せる絵・文字は portColor のままで、地が明るくなるぶんコントラストは上がる
 */
export function portTintColor(type: CableType, isDark: boolean): string {
  if (isDark) return portColor(type, true)
  return PORT_COLORS[CABLE_BASE_PORT[type] ?? type as PortType]
}

export const PORT_ICONS: Partial<Record<CableType, MCIconName>> = {
  USB_C:          'usb-c-port',
  USB_A:          'usb-port',
  USB_B:          'usb-port',
  USB_A_to_C:     'usb-port',
  Lightning:      'lightning-bolt',
  microUSB:       'usb-port',
  Thunderbolt:    'lightning-bolt',
  // ポートの絵はカテゴリ（Cable＝cable-data、PowerStrip＝power-plug-outline、
  // NetworkSwitch＝ethernet）と重ねない。ポート入力（PortConfigurationEditor）もこの表を読む
  HDMI:           'video-input-hdmi',
  DisplayPort:    'monitor',
  MiniDisplayPort:'monitor',
  VGA:            'monitor',
  DVI:            'monitor',
  Power:          'power-plug',
  Ethernet:       'ethernet-cable',
  EthernetPoE:    'ethernet-cable',
  Audio3_5mm:     'headphones',
  Audio6_3mm:     'audio-input-stereo-minijack',
  Audio6_3mm_TS:  'audio-input-stereo-minijack',
  Audio4_4mm:     'headphones',
  XLR_TRS_Combo:  'microphone-variant',
  XLR4pin:        'headphones',
  RCA:            'audio-input-stereo-minijack',
  CoaxialAudio:   'audio-input-rca',
  Audio3_5_to_6_3:'swap-horizontal',
  OpticalAudio:   'audio-input-stereo-minijack',
  SpeakerTerminal:'speaker',
  SDCard:         'sd',
  microSDCard:    'micro-sd',
  CFexpress:      'sd',
  XboxExpansion:  'sd',
  XLR:            'microphone-variant',
  MIDI:           'midi-port',
  MIDI_TRS:       'midi-port',
  Bluetooth:         'bluetooth',
  XboxWireless:      'access-point',
  WiFi:              'wifi',
  Stylus:            'pencil-outline',
  wirelessCharging:  'lightning-bolt-circle',
  Battery:           'battery',
  DCPower:           'power-plug',
  MonitorArm:        'monitor-dashboard',
  MicArm:            'microphone-plus',
  USB_A_to_B:        'usb-port',
  USB_C_to_B:        'usb-c-port',
  USB_A_to_Lightning:'lightning-bolt',
  USB_C_to_Lightning:'lightning-bolt',
  USB_A_to_microUSB: 'usb-port',
  USB_C_to_microUSB: 'usb-c-port',
  MiniDisplayPort_to_DisplayPort: 'monitor',
  USB_C_to_DisplayPort: 'monitor',
  USB_C_to_HDMI:     'cable-data',
  DisplayPort_to_HDMI: 'cable-data',
  HDMI_to_DisplayPort: 'monitor',
  HDMI_to_DVI:       'cable-data',
  RCA_to_3_5mm:      'audio-input-stereo-minijack',
  RCA_to_6_3mm:      'audio-input-stereo-minijack',
}

// 映像出力の優先順位（高画質優先）
// Thunderbolt/USB-C はDisplayPort Altモードで映像出力可能なため含める
export const DISPLAY_PORT_PRIORITY: PortType[] = [
  'Thunderbolt',
  'DisplayPort',
  'MiniDisplayPort',
  'HDMI',
  'USB_C',
  'VGA',
  'DVI',
]

/**
 * ケーブル一覧の並び順。
 * 電源の上流（壁コンセント → タップ → 機器）から順に、下るほど細い信号線になるよう並べる。
 * 太くて取り回しに影響するもの・抜けると全部止まるものを上に置き、
 * 挿し替えが容易で細いもの（オーディオ・カードリーダー類）を後ろへ回す。
 * ここに無い型は末尾に落ちる（CABLE_SORT_ORDER.indexOf が -1 のため要注意）。
 */
export const CABLE_SORT_ORDER: CableType[] = [
  // 電源系：コンセントに最も近く、最も太い。
  // 電池（Battery）はここに入れない。電池はケーブルではなく、電池駆動機器への
  // 給電線は cableType 'Power' で出るため
  'Power',
  'DCPower',
  // ネットワーク：ルーター・モデムなど上流機器
  'Ethernet',
  // PoE も電源を兼ねた LAN ケーブル。ここに無いと順位が付かず、
  // 種類未設定と同じ末尾に落ちる
  'EthernetPoE',
  // 高帯域のデータ＋給電。ドックやモニターの母線になる
  'Thunderbolt',
  'USB_C',
  'USB_A_to_C',
  'USB_A_to_B',
  'USB_C_to_B',
  'USB_A_to_Lightning',
  'USB_C_to_Lightning',
  'USB_A_to_microUSB',
  'USB_C_to_microUSB',
  // 映像
  'DisplayPort',
  'MiniDisplayPort',
  'MiniDisplayPort_to_DisplayPort',
  'USB_C_to_DisplayPort',
  'HDMI',
  'USB_C_to_HDMI',
  'DisplayPort_to_HDMI',
  'HDMI_to_DisplayPort',
  'HDMI_to_DVI',
  'DVI',
  'VGA',
  'OpticalAudio',
  'CoaxialAudio',
  // スピーカーケーブルは音声系で最も太く、一度引いたら動かさない。音声グループの先頭に置く
  'SpeakerTerminal',
  // 周辺機器のデータ線
  'USB_B',
  'USB_A',
  'Lightning',
  'microUSB',
  // 音声・楽器：細く、抜き差しの頻度が高い
  'XLR',
  'XLR4pin',
  'MIDI',
  'MIDI_TRS',
  'Audio6_3mm',
  'Audio6_3mm_TS',
  'Audio4_4mm',
  'XLR_TRS_Combo',
  'RCA',
  'RCA_to_3_5mm',
  'RCA_to_6_3mm',
  'Audio3_5_to_6_3',
  'Audio3_5mm',
  // 記録メディア
  'CFexpress',
  'XboxExpansion',
  'SDCard',
  'microSDCard',
]

/**
 * 無線接続。線の見た目（破線・波線）を決めるのに使う。
 *
 * 「物理ケーブルが要るか」とは別概念なので requiresPhysicalCable と取り違えないこと。
 * アーム類やスタイラスペンは無線ではないが、買うべきケーブルも存在しない。
 */
export const WIRELESS_PORT_TYPES: PortType[] = ['Bluetooth', 'XboxWireless', 'WiFi', 'wirelessCharging']

/**
 * ケーブルを1本用意する必要がない接続。ケーブル集計・在庫チェックの除外に使う。
 * 無線に加えて、線ではない物理的な繋がり（アーム＝支持、スタイラス＝吸着、
 * カード＝スロットへ直接挿す）を含む。
 *
 * ここは「その種別なら常にケーブル不要」という判定。USB-A や HDMI のように
 * 普段はケーブルを使うが特定の口だけ直挿しになるもの（2.4GHzレシーバー、
 * USBメモリ、HDMIスティック）は Port.directAttach で個別に印を付ける。
 */
export const NO_CABLE_PORT_TYPES: PortType[] = [
  ...WIRELESS_PORT_TYPES,
  'MonitorArm',
  'MicArm',
  'Stylus',
  'SDCard',
  'microSDCard',
  'CFexpress',
  'XboxExpansion',
  'Battery',
]

export function isWirelessPortType(type: PortType | string): boolean {
  return (WIRELESS_PORT_TYPES as string[]).includes(type)
}

export function requiresPhysicalCable(type: CableType | string): boolean {
  return !(NO_CABLE_PORT_TYPES as string[]).includes(type)
}

/**
 * 同じ2台を同じ種別で繋ぐ本数（MapConnection.count）の上限。
 * DB の CHECK（077 の cable_count BETWEEN 1 AND 8）と揃える。超えた値はサーバーが黙って
 * 8 に丸めるので、端末で許すとアプリと公開ページで本数が食い違う
 */
export const MAX_CABLE_COUNT = 8

/**
 * ケーブルとして表示するときの両端表記。
 * ポート名は端子単体を表すため portLabel のままにし、商品・配線の表示だけこちらを使う。
 */
export function cableLabel(type: CableType, lang: 'ja' | 'en'): string {
  if (!requiresPhysicalCable(type)) return portLabel(type as PortType, lang)
  if (type === 'USB_A_to_C') return 'USB-A ↔ USB-C'
  if (type === 'USB_A_to_B') return 'USB-A ↔ USB-B'
  if (type === 'USB_C_to_B') return 'USB-C ↔ USB-B'
  if (type === 'USB_A_to_Lightning') return 'USB-A ↔ Lightning'
  if (type === 'USB_C_to_Lightning') return 'USB-C ↔ Lightning'
  if (type === 'USB_A_to_microUSB') return 'USB-A ↔ microUSB'
  if (type === 'USB_C_to_microUSB') return 'USB-C ↔ microUSB'
  if (type === 'MiniDisplayPort_to_DisplayPort') return 'mDP ↔ DP'
  if (type === 'USB_C_to_DisplayPort') return 'USB-C ↔ DP'
  if (type === 'USB_C_to_HDMI') return 'USB-C ↔ HDMI'
  if (type === 'DisplayPort_to_HDMI') return 'DP ↔ HDMI'
  if (type === 'HDMI_to_DisplayPort') return 'HDMI ↔ DP'
  if (type === 'HDMI_to_DVI') return 'HDMI ↔ DVI-D'
  if (type === 'Audio3_5_to_6_3') return '3.5mm ↔ 6.3mm'
  if (type === 'RCA_to_3_5mm') return 'RCA ↔ 3.5mm'
  if (type === 'RCA_to_6_3mm') return 'RCA ↔ 6.3mm'
  // 両端が同じ端子でも「◯◯ ↔ ◯◯」より商品名で呼ぶほうが通じるもの
  if (type === 'SpeakerTerminal') return lang === 'ja' ? 'スピーカーケーブル' : 'Speaker cable'
  if (type === 'CoaxialAudio') return lang === 'ja' ? '同軸デジタルケーブル' : 'Coaxial S/PDIF cable'
  if (type === 'Audio4_4mm') return lang === 'ja' ? '4.4mm バランスケーブル' : '4.4mm balanced cable'
  if (type === 'XLR4pin') return lang === 'ja' ? 'XLR 4pin バランスケーブル' : 'XLR 4-pin balanced cable'
  if (type === 'MIDI_TRS') return lang === 'ja' ? 'MIDI (3.5mm TRS) ケーブル' : 'MIDI (3.5mm TRS) cable'
  if (type === 'DCPower') return lang === 'ja' ? 'ACアダプター ↔ DCプラグ' : 'AC adapter ↔ DC plug'
  // 旧データは片側端子を保存していない。存在しない同端子ケーブルを捏造せず曖昧さを明示する。
  if (type === 'USB_A') return lang === 'ja' ? 'USB-A ↔ 機器' : 'USB-A ↔ Device'
  if (type === 'USB_B') return 'USB-A/C ↔ USB-B'
  if (type === 'Lightning') return 'USB-A/C ↔ Lightning'
  if (type === 'microUSB') return 'USB-A/C ↔ microUSB'
  if (type === 'Power') return lang === 'ja' ? 'コンセント ↔ 機器' : 'Outlet ↔ Device'
  const endpoint = portLabel(type, lang)
  return `${endpoint} ↔ ${endpoint}`
}

/**
 * ショップ検索に投げる語。cableLabel は画面用の表記なので、「USB-C ↔ HDMI」や
 * 「コンセント ↔ 機器」をそのまま検索すると1件も出ない。両端を繋ぐ記号と、
 * 片側が不明なときの穴埋め語を落として、商品として呼ばれている語に寄せる。
 */
export function cableSearchKeyword(type: CableType, lang: 'ja' | 'en'): string {
  if (type === 'Power') return lang === 'ja' ? '電源ケーブル' : 'power cable'
  const cable = lang === 'ja' ? 'ケーブル' : 'cable'
  const words = cableLabel(type, lang)
    .replace(/↔/g, ' ')
    .replace(/機器|Device/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  // 両端が同じ端子のケーブルは「HDMI ↔ HDMI」と表記される。そのまま繋ぐと
  // 「HDMI HDMI ケーブル」になり、検索の当たりが悪くなる
  const label = words.filter((word, index) => word !== words[index - 1]).join(' ')
  return label.includes(cable) ? label : `${label} ${cable}`
}

/** CABLE_SORT_ORDER の順位。未定義の型は末尾に寄せる */
export function cableSortRank(type: CableType): number {
  const index = CABLE_SORT_ORDER.indexOf(type)
  return index < 0 ? CABLE_SORT_ORDER.length : index
}

// データ/アップストリームの優先順位（高帯域幅優先）
export const UPSTREAM_PORT_PRIORITY: PortType[] = [
  'Thunderbolt',
  'USB_C',
  'USB_A',
]

// ポートの互換性マップ（出力ポートタイプ → 接続可能な入力ポートタイプ）
export const PORT_COMPATIBILITY: Partial<Record<PortType, PortType[]>> = {
  Thunderbolt: ['Thunderbolt', 'USB_C', 'USB_A', 'USB_B', 'Lightning', 'microUSB', 'DisplayPort', 'HDMI'],
  USB_C: ['Thunderbolt', 'USB_C', 'USB_A', 'USB_B', 'Lightning', 'microUSB', 'DisplayPort', 'HDMI'],
  // Thunderbolt を入れない。ドックの Thunderbolt 入力は帯域も給電も専用で、
  // USB-A 側から繋いでも映像は出ず、実際にその繋ぎ方は成立しない。
  // （逆向きの Thunderbolt 出力 → USB-A 機器は変換ケーブルで繋がるので残す）
  USB_A: ['USB_A', 'USB_B', 'USB_C', 'Lightning', 'microUSB'],
  // Thunderbolt を含める。USB-A を持たない MacBook でも USB-C ↔ USB-B ケーブル1本で繋がる
  USB_B: ['USB_A', 'USB_B', 'USB_C', 'Thunderbolt'],
  USB_A_to_C: ['USB_C', 'Thunderbolt'],
  Lightning: ['Lightning'],
  microUSB: ['microUSB'],
  DisplayPort: ['DisplayPort', 'MiniDisplayPort', 'HDMI', 'USB_C'],
  MiniDisplayPort: ['MiniDisplayPort', 'DisplayPort'],
  HDMI: ['HDMI', 'DisplayPort', 'DVI'],
  VGA: ['VGA'],
  DVI: ['DVI', 'HDMI'],
  Power: ['Power'],
  Ethernet: ['Ethernet', 'EthernetPoE'],
  EthernetPoE: ['EthernetPoE', 'Ethernet'],
  Audio3_5mm: ['Audio3_5mm', 'Audio6_3mm', 'XLR_TRS_Combo', 'RCA'],
  // 6.3mm TRS ↔ XLR は、オーディオIF のモニター出力をモニタースピーカーの XLR 入力へ繋ぐ
  // 定番の1本。これが無いと Scarlett → ADAM / MOTU → HS5 のような最も一般的な構成で
  // 「オーディオインターフェースが必要です」と誤警告が出て、スピーカーに信号線が引かれない
  Audio6_3mm: ['Audio6_3mm', 'Audio6_3mm_TS', 'Audio3_5mm', 'XLR_TRS_Combo', 'RCA', 'XLR'],
  Audio6_3mm_TS: ['Audio6_3mm_TS', 'Audio6_3mm', 'XLR_TRS_Combo', 'RCA'],
  XLR_TRS_Combo: ['XLR', 'Audio6_3mm', 'Audio6_3mm_TS', 'XLR_TRS_Combo'],
  RCA: ['RCA', 'Audio3_5mm', 'Audio6_3mm', 'Audio6_3mm_TS'],
  Audio3_5_to_6_3: ['Audio3_5_to_6_3'],
  OpticalAudio: ['OpticalAudio'],
  // ここから下は「同じ端子どうしでしか繋がらない」端子。互換先を足すと、
  // 見た目が似ているだけの別物（同軸デジタルとアナログRCA、4.4mmと6.3mm、
  // MIDIのミニジャックとイヤホン）が繋がってしまう。安易に広げないこと。
  CoaxialAudio: ['CoaxialAudio'],
  Audio4_4mm: ['Audio4_4mm'],
  XLR4pin: ['XLR4pin'],
  MIDI_TRS: ['MIDI_TRS'],
  SpeakerTerminal: ['SpeakerTerminal'],
  SDCard: ['SDCard'],
  microSDCard: ['microSDCard'],
  CFexpress: ['CFexpress'],
  XboxExpansion: ['XboxExpansion'],
  XLR: ['XLR', 'XLR_TRS_Combo', 'Audio6_3mm'],
  MIDI: ['MIDI'],
  Bluetooth: ['Bluetooth'],
  XboxWireless: ['XboxWireless'],
  WiFi: ['WiFi'],
  wirelessCharging: ['wirelessCharging'],
  Battery: ['Battery'],
  DCPower: ['DCPower', 'Power'],
}

/**
 * その要求を満たせるケーブルの型（上位互換を含む）。
 * Thunderbolt ケーブルは USB-C 機器にもそのまま使えるので USB-C の要求を満たすが、
 * 逆は帯域が足りないため成立しない。
 */
export function determineCableType(from: PortType, to: PortType): CableType {
  const isUsbCStyle = (type: PortType) =>
    type === 'USB_C' || type === 'Thunderbolt'
  if ((from === 'USB_A' && to === 'USB_B') || (from === 'USB_B' && to === 'USB_A')) return 'USB_A_to_B'
  if ((isUsbCStyle(from) && to === 'USB_B') || (from === 'USB_B' && isUsbCStyle(to))) return 'USB_C_to_B'
  if (
    (from === 'USB_A' && isUsbCStyle(to)) ||
    (isUsbCStyle(from) && to === 'USB_A')
  ) return 'USB_A_to_C'
  if (from === 'Lightning' || to === 'Lightning') {
    const other = from === 'Lightning' ? to : from
    if (isUsbCStyle(other)) return 'USB_C_to_Lightning'
    if (other === 'USB_A') return 'USB_A_to_Lightning'
    return 'Lightning'
  }
  if (from === 'microUSB' || to === 'microUSB') {
    const other = from === 'microUSB' ? to : from
    if (isUsbCStyle(other)) return 'USB_C_to_microUSB'
    if (other === 'USB_A') return 'USB_A_to_microUSB'
    return 'microUSB'
  }
  if (from === 'OpticalAudio' || to === 'OpticalAudio') return 'OpticalAudio'
  // 同じ端子でしか繋がらない型は、下の「6.3mm 同士」「XLR 混在」などの一般判定より
  // 先に確定させる。後ろに置くと 4.4mm が 6.3mm ケーブル扱いになる
  if (from === 'SpeakerTerminal' || to === 'SpeakerTerminal') return 'SpeakerTerminal'
  if (from === 'CoaxialAudio' || to === 'CoaxialAudio') return 'CoaxialAudio'
  if (from === 'Audio4_4mm' || to === 'Audio4_4mm') return 'Audio4_4mm'
  if (from === 'XLR4pin' || to === 'XLR4pin') return 'XLR4pin'
  if (from === 'MIDI_TRS' || to === 'MIDI_TRS') return 'MIDI_TRS'
  if (from === 'CFexpress' || to === 'CFexpress') return 'CFexpress'
  if (from === 'EthernetPoE' || to === 'EthernetPoE') return 'Ethernet'
  if (from === 'DCPower' || to === 'DCPower') return 'DCPower'
  if (from === 'RCA' || to === 'RCA') {
    const other = from === 'RCA' ? to : from
    if (other === 'Audio3_5mm') return 'RCA_to_3_5mm'
    if (other === 'Audio6_3mm' || other === 'Audio6_3mm_TS' || other === 'XLR_TRS_Combo') return 'RCA_to_6_3mm'
    return 'RCA'
  }
  if (from === 'XLR_TRS_Combo' || to === 'XLR_TRS_Combo') {
    const other = from === 'XLR_TRS_Combo' ? to : from
    if (other === 'XLR' || other === 'XLR_TRS_Combo') return 'XLR'
    if (other === 'Audio3_5mm') return 'Audio3_5_to_6_3'
    return other === 'Audio6_3mm_TS' ? 'Audio6_3mm_TS' : 'Audio6_3mm'
  }
  // 6.3mm TRS ↔ XLR は XLR ケーブルの一種として売られている（TRS-XLR）。
  // 6.3mm 同士の判定より先に見ないと「6.3mm ↔ 6.3mm」と誤表示される
  if (
    (from === 'XLR' && (to === 'Audio6_3mm' || to === 'Audio6_3mm_TS')) ||
    ((from === 'Audio6_3mm' || from === 'Audio6_3mm_TS') && to === 'XLR')
  ) return 'XLR'
  if (
    (from === 'Audio3_5mm' && to === 'Audio6_3mm') ||
    (from === 'Audio6_3mm' && to === 'Audio3_5mm')
  ) return 'Audio3_5_to_6_3'
  if (from === 'Audio6_3mm_TS' || to === 'Audio6_3mm_TS') return 'Audio6_3mm_TS'
  if (from === 'Audio6_3mm' || to === 'Audio6_3mm') return 'Audio6_3mm'
  // 映像系。変換方向があるものは from（出力）→ to（入力）を保持する。
  if (isUsbCStyle(from) && to === 'HDMI') return 'USB_C_to_HDMI'
  if (from === 'DisplayPort' && to === 'HDMI') return 'DisplayPort_to_HDMI'
  if (from === 'HDMI' && to === 'DisplayPort') return 'HDMI_to_DisplayPort'
  if ((from === 'HDMI' && to === 'DVI') || (from === 'DVI' && to === 'HDMI')) return 'HDMI_to_DVI'
  if ((from === 'MiniDisplayPort' && to === 'DisplayPort') || (from === 'DisplayPort' && to === 'MiniDisplayPort')) return 'MiniDisplayPort_to_DisplayPort'
  if ((isUsbCStyle(from) && to === 'DisplayPort') || (from === 'DisplayPort' && isUsbCStyle(to))) return 'USB_C_to_DisplayPort'
  if (from === 'DisplayPort' || to === 'DisplayPort') return 'DisplayPort'
  if (from === 'HDMI' || to === 'HDMI') return 'HDMI'
  if (from === 'DVI' || to === 'DVI') return 'DVI'
  // データ系
  // 両端が Thunderbolt のときだけ Thunderbolt ケーブルが要る。
  // 片側が USB-C の機器なら USB-C ケーブルで繋がるので USB_C のままにする。
  if (from === 'Thunderbolt' && to === 'Thunderbolt') return 'Thunderbolt'
  if (
    from === 'USB_C' || to === 'USB_C' ||
    from === 'Thunderbolt' || to === 'Thunderbolt'
  ) return 'USB_C'
  if (from === 'USB_A' || to === 'USB_A') return 'USB_A'
  if (from === 'USB_B' || to === 'USB_B') return 'USB_A'
  return from
}
