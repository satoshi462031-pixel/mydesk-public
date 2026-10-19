import { GadgetCategory, Port, PortDirection, PortType } from '../types'
import { isPowerFeedPrefixPort, WIRELESS_POWER_PORT_LABEL } from '../utils/portRoles'

export interface PortFormField {
  key: string
  label: string
  kind: 'stepper' | 'toggle'
  portType: PortType
  direction: PortDirection
  max?: number
  supportsVideo?: boolean
  supportsPowerDelivery?: boolean
  supportsPoE?: boolean
  supportsDisplayConversion?: boolean
  portLabel?: string
  acceptUnlabeled?: boolean
  acceptLabelIncludes?: string
  acceptLegacyVideoInput?: boolean
  excludeVideoCapable?: boolean
  excludePowerDelivery?: boolean
  includePowerPort?: boolean
  hidden?: boolean
  locked?: boolean
  /** レガシー・ニッチなポート。フォームでは「その他のポート」に畳んで出す */
  advanced?: boolean
}

export type PortState = Record<string, number | boolean>

/**
 * 大元のガジェット（PC・ゲーム機等）と接続して初めて機能する周辺機器。
 * このカテゴリだけガジェットフォームに「接続先」ピッカーが出て、
 * `Gadget.bluetoothTargetGadgetIds` へ保存される（無線・有線の両方に効く）。
 *
 * PC が複数あるデスクでは、どの PC がその機器のホストなのかを配線エンジンが
 * 知る手立てが無い。キャプチャ・ストレージ・Webカメラ・USBマイクは
 * 「映像はこっちの PC、USB はあっちの PC」という2PC 構成で取り違えが起きるので、
 * ユーザーが指定できるようにしてある（未指定なら従来どおり自動で選ぶ）。
 */
export const NEEDS_HOST_CATEGORIES: GadgetCategory[] = [
  'Keyboard', 'Mouse', 'Speaker', 'Headphone', 'Earphone', 'Controller',
  'Smartphone', 'Tablet', 'Smartwatch', 'Accessory', 'PenTablet', 'HeadphoneAmp',
  'AudioInterface', 'VRGlass',
  'CaptureDevice', 'Storage', 'Webcam', 'Camera', 'SmallDevice', 'Microphone',
  // ディスプレイは「どの PC が映像を出すか」を指定させる。PC が複数あると
  // 登録データからは決められず、配線エンジンの推測任せになるため
  'Monitor', 'TV', 'Projector',
]

const PORT_FORM_LABELS_EN: Record<string, string> = {
  'USB-C 入力 (映像)': 'USB-C input (video)',
  'CFexpress カード': 'CFexpress card',
  'スピーカー端子 (パッシブ)': 'Speaker terminals (passive)',
  '光デジタル入力 (サウンドバー等)': 'Optical digital input (soundbar etc.)',
  '4.4mm バランス (有線接続)': '4.4mm balanced (wired)',
  'XLR 4pin バランス (有線接続)': 'XLR 4-pin balanced (wired)',
  'microUSB (PC 接続)': 'microUSB (PC connection)',
  'CFexpress スロット': 'CFexpress slot',
  'USB-C 電源入力': 'USB-C power input',
  'USB-C 入力 (映像・液タブ)': 'USB-C input (video / pen display)',
  'HDMI 入力 (液タブ)': 'HDMI input (pen display)',
  'DisplayPort 入力 (液タブ)': 'DisplayPort input (pen display)',
  '3.5mm ヘッドホン出力': '3.5mm headphone output',
  '光デジタル出力': 'Optical digital output',
  '同軸デジタル入力': 'Coaxial digital input',
  '4.4mm バランス出力': '4.4mm balanced output',
  'XLR 4pin バランス出力': 'XLR 4-pin balanced output',
  'RCA ライン出力': 'RCA line output',
  'XLR ライン出力': 'XLR line output',
  'スピーカー端子': 'Speaker terminals',
  'RCA プリ出力': 'RCA pre-out',
  'USB-C 入出力兼用': 'USB-C (input / output)',
  'USB-C 出力専用': 'USB-C output only',
  'USB-C 入力専用': 'USB-C input only',
  'Lightning 入力': 'Lightning input',
  'microUSB 入力': 'microUSB input',
  'AC入力（コンセント一体型）': 'AC input (built-in plug)',
  'USB-C 入力 (映像 / PD)': 'USB-C input (video / PD)',
  'HDMI 入力': 'HDMI input',
  'DP 入力': 'DP input',
  'Thunderbolt 入力': 'Thunderbolt input',
  'USB-A ハブ': 'USB-A hub',
  'USB-C ハブ出力': 'USB-C hub output',
  'Ethernet (LANケーブル差込)': 'Ethernet (LAN port)',
  'SD カードスロット': 'SD card slot',
  '3.5mm オーディオ出力': '3.5mm audio output',
  'アームを使用': 'Use monitor arm',
  'Thunderbolt ホスト接続 (入力)': 'Thunderbolt host connection (input)',
  'Thunderbolt ホスト接続 (PD)': 'Thunderbolt host connection (PD)',
  'USB-C ホスト接続 (入力)': 'USB-C host connection (input)',
  'USB-C ホスト接続 (PD)': 'USB-C host connection (PD)',
  'Thunderbolt 出力': 'Thunderbolt output',
  'HDMI 出力': 'HDMI output',
  'DP 出力': 'DP output',
  'USB-A 出力': 'USB-A output',
  'USB-C 出力': 'USB-C output',
  'SD カード': 'SD card',
  'microSD カード': 'microSD card',
  '3.5mm オーディオ': '3.5mm audio',
  'USB-A ハブ出力': 'USB-A hub output',
  'USB-A (有線接続)': 'USB-A (wired)',
  'USB-A (接続)': 'USB-A (connection)',
  '3.5mm オーディオ入力': '3.5mm audio input',
  'USB-A (ドングル / 有線)': 'USB-A (dongle / wired)',
  '3.5mm (有線接続)': '3.5mm (wired)',
  'USB-C (PC 接続)': 'USB-C (PC connection)',
  'USB-A (PC 接続)': 'USB-A (PC connection)',
  '3.5mm ヘッドホンモニター': '3.5mm headphone monitoring',
  'マイクアームを使用': 'Use microphone arm',
  'USB-A 出力 (NAS)': 'USB-A output (NAS)',
  'USB-C 出力 (NAS)': 'USB-C output (NAS)',
  'USB-C (ドック / 充電・映像)': 'USB-C (dock / charging / video)',
  'USB-C 入力 (本体 / PC 接続)': 'USB-C input (console / PC)',
  'Bluetooth (コントローラー接続)': 'Bluetooth (controller)',
  'Xbox Wireless (コントローラー・ヘッドセット)': 'Xbox Wireless (controller / headset)',
  'Xbox ストレージ拡張スロット': 'Xbox storage expansion slot',
  'Xbox ストレージ拡張カード': 'Xbox storage expansion card',
  'Ethernet LAN ポート数': 'Ethernet LAN ports',
  'XLR 入力数': 'XLR inputs',
  'XLR 出力数': 'XLR outputs',
  '3.5mm / TRS 入力': '3.5mm / TRS inputs',
  'ヘッドホン出力': 'Headphone output',
  'XLR / チャンネル数': 'XLR / channels',
  'XLR メイン出力': 'XLR main outputs',
  'USB-C (PC 接続/録音)': 'USB-C (PC / recording)',
  'USB-A (PC 接続/録音)': 'USB-A (PC / recording)',
  'Ethernet (ネットワーク)': 'Ethernet (network)',
  'ワイヤレス給電 (Qi / MagSafe)': 'Wireless charging (Qi / MagSafe)',
  'USB-C (電源 / 接続)': 'USB-C (power / connection)',
  'USB-A (電源)': 'USB-A (power)',
  'スタイラスペン対応': 'Stylus support',
  'USB-C (PC / Mac 接続)': 'USB-C (PC / Mac connection)',
  'USB-A (PC / Mac 接続)': 'USB-A (PC / Mac connection)',
  'ヘッドホン / フォーン出力': 'Headphone / phone output',
  'フォーン入力 (アンプ等)': 'Phone input (amp, etc.)',
  'XLR 出力': 'XLR output',
  '3.5mm オーディオジャック': '3.5mm audio jack',
  'USB-C PD 出力': 'USB-C PD output',
  'Ethernet WAN 入力': 'Ethernet WAN input',
  'Bluetooth (ホスト)': 'Bluetooth (host)',
  'DisplayPort 入力 (映像)': 'DisplayPort input (video)',
  'USB-C 入力 (映像 / データ)': 'USB-C input (video / data)',
  'XLR / TRS 入力': 'XLR / TRS input',
  'USB-C (データ)': 'USB-C (data)',
  'USB-C (映像対応)': 'USB-C (video capable)',
  'Mini DisplayPort 出力': 'Mini DisplayPort output',
  'VGA 出力': 'VGA output',
  'DVI 出力': 'DVI output',
  '3.5mm マイク入力': '3.5mm microphone input',
  'USB-B アップストリーム': 'USB-B upstream',
  'DP デイジーチェーン出力': 'DP daisy-chain output',
  'Thunderbolt デイジーチェーン出力': 'Thunderbolt daisy-chain output',
  'microSD カードスロット': 'microSD card slot',
  'USB-A ホスト接続 (入力)': 'USB-A host connection (input)',
  'USB-C PD ホスト給電': 'USB-C PD host power',
  'Thunderbolt (PC 接続)': 'Thunderbolt (PC connection)',
  'Mini DisplayPort 入力': 'Mini DisplayPort input',
  'VGA 入力': 'VGA input',
  'DVI 入力': 'DVI input',
  'HDMI パススルー出力': 'HDMI passthrough output',
  'DisplayPort 入力': 'DisplayPort input',
  'DisplayPort 出力': 'DisplayPort output',
  'USB-A 周辺機器': 'USB-A peripherals',
  'USB-A データ接続': 'USB-A data connection',
  '専用AC電源': 'Dedicated AC power',
  'USB-C (有線接続)': 'USB-C (wired connection)',
  '3.5mm ヘッドセット端子': '3.5mm headset jack',
  'AC 出力': 'AC outputs',
  'AC 入力': 'AC input',
  'AC入力（デスク電源）': 'AC input (desk power)',
  'AC入力（電源コード）': 'AC input (power cord)',
  '内蔵ACコンセント': 'Built-in AC outlets',
  '充電用USB-C': 'USB-C charging ports',
  '充電用USB-A': 'USB-A charging ports',
  'Bluetooth 制御': 'Bluetooth control',
  'Wi-Fi': 'Wi-Fi',
  'USB-C 入力': 'USB-C input',
  'USB-A 入力': 'USB-A input',
  'USB-C 出力（周辺機器へ）': 'USB-C output (to peripherals)',
  'USB-A 出力（周辺機器へ）': 'USB-A output (to peripherals)',
  'HDMI 出力（周辺機器へ）': 'HDMI output (to peripherals)',
  'DisplayPort 出力（周辺機器へ）': 'DisplayPort output (to peripherals)',
  'USB-C（充電・データ）': 'USB-C (charging / data)',
  'USB-C（映像・データ・充電）': 'USB-C (video / data / charging)',
  'Lightning（充電・データ）': 'Lightning (charging / data)',
  'Apple Pencil ワイヤレス給電': 'Apple Pencil wireless charging',
  'マグネット充電（専用ケーブル）': 'Magnetic charging (dedicated cable)',
  'Qi ワイヤレス充電': 'Qi wireless charging',
  '専用クレードル': 'Dedicated cradle',
  '6.3mm TRS 入力': '6.3mm TRS input',
  '6.3mm TRS モニター出力': '6.3mm TRS monitor outputs',
  '6.3mm ヘッドホン出力': '6.3mm headphone output',
  '6.3mm フォーン出力': '6.3mm phone outputs',
  '6.3mm フォーン入力 (アンプ等)': '6.3mm phone input (amp, etc.)',
  'MIDI IN': 'MIDI IN',
  'MIDI OUT': 'MIDI OUT',
  'MIDI THRU': 'MIDI THRU',
  'XLR 出力（+48V ファンタム対応）': 'XLR output (+48V phantom power)',
  '光デジタル入力': 'Optical digital input',
  'USB-B (PC 接続)': 'USB-B (PC connection)',
  '支持できるモニター数': 'Supported monitor count',
  '支持できるマイク数': 'Supported microphone count',
  'USB-C アップストリーム入力': 'USB-C upstream input',
  'Ethernet PoE 入力': 'Ethernet PoE input',
  'Ethernet PoE 出力': 'Ethernet PoE outputs',
  '6.3mm TS 入力': '6.3mm TS inputs',
  '6.3mm TS 出力': '6.3mm TS outputs',
  'XLR / TRS コンボ入力': 'XLR / TRS combo inputs',
  'XLR 入力': 'XLR inputs',
  'RCA 入力': 'RCA inputs',
  'RCA 出力': 'RCA outputs',
  'DC電源入力': 'DC power input',
  'Thunderbolt 入力 (映像 / PD)': 'Thunderbolt input (video / PD)',
  'Thunderbolt デイジーチェーン出力 (PD)': 'Thunderbolt daisy-chain output (PD)',
  'USB-C (PC接続・充電)': 'USB-C (PC connection / charging)',
  'microUSB (PC接続・充電)': 'microUSB (PC connection / charging)',
  'アップリンク (Ethernet)': 'Uplink (Ethernet)',
  '接続先ポート数（アップリンク除く）': 'Device ports (excluding uplink)',
}

export function portFormFieldLabel(field: PortFormField, lang: 'ja' | 'en'): string {
  return lang === 'en' ? (PORT_FORM_LABELS_EN[field.label] ?? field.label) : field.label
}

export const CATEGORY_PORT_CONFIG: Partial<Record<GadgetCategory, PortFormField[]>> = {
  PC: [
    { key: 'tb',    label: 'Thunderbolt',          kind: 'stepper', portType: 'Thunderbolt',   direction: 'output', max: 4, supportsVideo: true },
    { key: 'usbc',  label: 'USB-C (データ)',       kind: 'stepper', portType: 'USB_C',         direction: 'output', max: 8, supportsVideo: false, portLabel: 'USB-C (データ)', acceptUnlabeled: true },
    { key: 'usbc_video', label: 'USB-C (映像対応)', kind: 'stepper', portType: 'USB_C',         direction: 'output', max: 4, supportsVideo: true, portLabel: 'USB-C (映像対応)' },
    { key: 'usba',  label: 'USB-A',               kind: 'stepper', portType: 'USB_A',         direction: 'output', max: 8 },
    { key: 'hdmi',  label: 'HDMI',                kind: 'stepper', portType: 'HDMI',          direction: 'output', max: 3, supportsVideo: true },
    { key: 'dp',    label: 'DP',                  kind: 'stepper', portType: 'DisplayPort',   direction: 'output', max: 3, supportsVideo: true },
    { key: 'mdp',   label: 'Mini DisplayPort 出力', kind: 'stepper', portType: 'MiniDisplayPort', direction: 'output', max: 2, supportsVideo: true, advanced: true },
    { key: 'vga',   label: 'VGA 出力',             kind: 'stepper', portType: 'VGA',           direction: 'output', max: 2, supportsVideo: true, advanced: true },
    { key: 'dvi',   label: 'DVI 出力',             kind: 'stepper', portType: 'DVI',           direction: 'output', max: 2, supportsVideo: true, advanced: true },
    // 2.5GbE を2口持つミニPC・ワークステーションがある。トグルだと必ず1口になり、
    // 商品DBが2口で持っていても保存で1口に潰れていた
    { key: 'eth',   label: 'Ethernet',            kind: 'stepper', portType: 'Ethernet',      direction: 'input', max: 2 },
    { key: 'audio_in', label: '3.5mm マイク入力', kind: 'toggle', portType: 'Audio3_5mm', direction: 'input' },
    { key: 'bt',    label: 'Bluetooth (ホスト)',  kind: 'toggle',  portType: 'Bluetooth',     direction: 'bidirectional' },
  ],
  Monitor: [
    { key: 'usbc_in',   label: 'USB-C 入力 (映像)', kind: 'stepper', portType: 'USB_C', direction: 'input', max: 2, supportsVideo: true, portLabel: 'USB-C 入力 (映像)', acceptUnlabeled: true, excludePowerDelivery: true },
    { key: 'usbc_pd_in', label: 'USB-C 入力 (映像 / PD)', kind: 'stepper', portType: 'USB_C', direction: 'input', max: 2, supportsVideo: true, supportsPowerDelivery: true, portLabel: 'USB-C 入力 (映像 / PD)', acceptLabelIncludes: 'PD' },
    { key: 'hdmi_in',   label: 'HDMI 入力',              kind: 'stepper', portType: 'HDMI',        direction: 'input',  max: 4, supportsVideo: true },
    { key: 'dp_in',     label: 'DP 入力',                kind: 'stepper', portType: 'DisplayPort', direction: 'input',  max: 3, supportsVideo: true },
    { key: 'tb_pd_in',  label: 'Thunderbolt 入力 (映像 / PD)', kind: 'stepper', portType: 'Thunderbolt', direction: 'input', max: 2, supportsVideo: true, supportsPowerDelivery: true, portLabel: 'Thunderbolt 入力 (映像 / PD)', acceptLabelIncludes: 'PD' },
    { key: 'tb_in',     label: 'Thunderbolt 入力',       kind: 'stepper', portType: 'Thunderbolt', direction: 'input',  max: 2, supportsVideo: true, excludePowerDelivery: true },
    { key: 'usb_b_in',  label: 'USB-B アップストリーム', kind: 'stepper', portType: 'USB_B',       direction: 'input',  max: 2, advanced: true },
    { key: 'mdp_in',    label: 'Mini DisplayPort 入力',   kind: 'stepper', portType: 'MiniDisplayPort', direction: 'input', max: 2, supportsVideo: true, advanced: true },
    { key: 'vga_in',    label: 'VGA 入力',                kind: 'stepper', portType: 'VGA',        direction: 'input', max: 2, supportsVideo: true, advanced: true },
    { key: 'dvi_in',    label: 'DVI 入力',                kind: 'stepper', portType: 'DVI',        direction: 'input', max: 2, supportsVideo: true, advanced: true },
    { key: 'usba_out',  label: 'USB-A ハブ',              kind: 'stepper', portType: 'USB_A',       direction: 'output', max: 6 },
    { key: 'usbc_out',  label: 'USB-C ハブ出力',          kind: 'stepper', portType: 'USB_C',       direction: 'output', max: 4, portLabel: 'USB-C ハブ出力', acceptUnlabeled: true, excludePowerDelivery: true },
    { key: 'usbc_pd_out', label: 'USB-C PD 出力',          kind: 'stepper', portType: 'USB_C',       direction: 'output', max: 2, supportsPowerDelivery: true, portLabel: 'USB-C PD 出力', acceptLabelIncludes: 'PD' },
    { key: 'dp_out',    label: 'DP デイジーチェーン出力', kind: 'stepper', portType: 'DisplayPort', direction: 'output', max: 2, supportsVideo: true, advanced: true },
    { key: 'tb_pd_out', label: 'Thunderbolt デイジーチェーン出力 (PD)', kind: 'stepper', portType: 'Thunderbolt', direction: 'output', max: 2, supportsVideo: true, supportsPowerDelivery: true, portLabel: 'Thunderbolt デイジーチェーン出力 (PD)', acceptLabelIncludes: 'PD', advanced: true },
    { key: 'tb_out',    label: 'Thunderbolt デイジーチェーン出力', kind: 'stepper', portType: 'Thunderbolt', direction: 'output', max: 2, supportsVideo: true, excludePowerDelivery: true, advanced: true },
    { key: 'eth_in',    label: 'Ethernet (LANケーブル差込)', kind: 'toggle',  portType: 'Ethernet',    direction: 'input' },
    { key: 'sd_out',    label: 'SD カードスロット',       kind: 'toggle',  portType: 'SDCard',      direction: 'input', advanced: true },
    { key: 'microsd_in', label: 'microSD カードスロット',  kind: 'toggle',  portType: 'microSDCard', direction: 'input', advanced: true },
    { key: 'audio_out', label: '3.5mm オーディオ出力',   kind: 'toggle',  portType: 'Audio3_5mm',  direction: 'output' },
    { key: 'arm',       label: 'アームを使用',            kind: 'toggle',  portType: 'MonitorArm',  direction: 'input' },
    { key: 'stylus',    label: 'スタイラスペン対応',      kind: 'toggle',  portType: 'Stylus',      direction: 'input', advanced: true },
  ],
  TV: [
    { key: 'hdmi_in', label: 'HDMI 入力', kind: 'stepper', portType: 'HDMI', direction: 'input', max: 6, supportsVideo: true },
    { key: 'usbc_in', label: 'USB-C 入力 (映像)', kind: 'toggle', portType: 'USB_C', direction: 'input', supportsVideo: true },
    { key: 'eth_in', label: 'Ethernet', kind: 'toggle', portType: 'Ethernet', direction: 'input' },
    { key: 'audio_out', label: '3.5mm オーディオ出力', kind: 'toggle', portType: 'Audio3_5mm', direction: 'output' },
  ],
  Projector: [
    { key: 'hdmi_in', label: 'HDMI 入力', kind: 'stepper', portType: 'HDMI', direction: 'input', max: 3, supportsVideo: true },
    { key: 'usbc_in', label: 'USB-C 入力 (映像)', kind: 'toggle', portType: 'USB_C', direction: 'input', supportsVideo: true },
    { key: 'vga_in', label: 'VGA 入力', kind: 'toggle', portType: 'VGA', direction: 'input', supportsVideo: true, advanced: true },
    { key: 'audio_out', label: '3.5mm オーディオ出力', kind: 'toggle', portType: 'Audio3_5mm', direction: 'output' },
  ],
  Dock: [
    { key: 'tb_host',   label: 'Thunderbolt ホスト接続 (入力)', kind: 'stepper', portType: 'Thunderbolt', direction: 'input', max: 2, excludePowerDelivery: true },
    { key: 'tb_pd_host', label: 'Thunderbolt ホスト接続 (PD)', kind: 'stepper', portType: 'Thunderbolt', direction: 'input', max: 2, supportsPowerDelivery: true, portLabel: 'Thunderbolt ホスト接続 (PD)' },
    { key: 'usbc_host', label: 'USB-C ホスト接続 (入力)', kind: 'stepper', portType: 'USB_C', direction: 'input', max: 2, excludePowerDelivery: true },
    { key: 'usbc_pd_host', label: 'USB-C ホスト接続 (PD)', kind: 'stepper', portType: 'USB_C', direction: 'input', max: 2, supportsPowerDelivery: true, portLabel: 'USB-C ホスト接続 (PD)' },
    { key: 'usba_host', label: 'USB-A ホスト接続 (入力)', kind: 'stepper', portType: 'USB_A',      direction: 'input', max: 2, advanced: true },
    { key: 'tb_out',    label: 'Thunderbolt 出力',      kind: 'stepper', portType: 'Thunderbolt', direction: 'output', max: 4, supportsVideo: true },
    { key: 'hdmi_out',  label: 'HDMI 出力',              kind: 'stepper', portType: 'HDMI',         direction: 'output', max: 3, supportsVideo: true },
    { key: 'dp_out',    label: 'DP 出力',                kind: 'stepper', portType: 'DisplayPort',  direction: 'output', max: 3, supportsVideo: true },
    { key: 'mdp_out',   label: 'Mini DisplayPort 出力',  kind: 'stepper', portType: 'MiniDisplayPort', direction: 'output', max: 2, supportsVideo: true, advanced: true },
    { key: 'vga_out',   label: 'VGA 出力',               kind: 'stepper', portType: 'VGA',          direction: 'output', max: 2, supportsVideo: true, advanced: true },
    { key: 'dvi_out',   label: 'DVI 出力',               kind: 'stepper', portType: 'DVI',          direction: 'output', max: 2, supportsVideo: true, advanced: true },
    { key: 'usba_out',  label: 'USB-A 出力',              kind: 'stepper', portType: 'USB_A',        direction: 'output', max: 8 },
    { key: 'usbc_out',  label: 'USB-C 出力',              kind: 'stepper', portType: 'USB_C',        direction: 'output', max: 4, portLabel: 'USB-C 出力', acceptUnlabeled: true },
    { key: 'usbc_pd_out', label: 'USB-C PD ホスト給電',   kind: 'toggle',  portType: 'USB_C',        direction: 'output', portLabel: 'USB-C PD 出力' },
    { key: 'eth',       label: 'Ethernet (LANケーブル差込)', kind: 'toggle',  portType: 'Ethernet',     direction: 'input' },
    { key: 'sd',        label: 'SD カード',                kind: 'toggle',  portType: 'SDCard',       direction: 'input' },
    { key: 'microsd',   label: 'microSD カード',           kind: 'toggle',  portType: 'microSDCard',  direction: 'input', advanced: true },
    { key: 'cfexpress', label: 'CFexpress カード',          kind: 'toggle',  portType: 'CFexpress',    direction: 'input', advanced: true },
    { key: 'audio',     label: '3.5mm オーディオ',         kind: 'toggle',  portType: 'Audio3_5mm',  direction: 'output' },
  ],
  Hub: [
    { key: 'usbc_host', label: 'USB-C ホスト接続 (入力)', kind: 'stepper', portType: 'USB_C',      direction: 'input',  max: 2 },
    { key: 'usba_host', label: 'USB-A ホスト接続 (入力)', kind: 'stepper', portType: 'USB_A',      direction: 'input',  max: 2 },
    { key: 'hdmi_out', label: 'HDMI 出力',        kind: 'stepper', portType: 'HDMI',        direction: 'output', max: 3, supportsVideo: true },
    { key: 'dp_out',   label: 'DP 出力',          kind: 'stepper', portType: 'DisplayPort', direction: 'output', max: 2, supportsVideo: true },
    { key: 'usba_out', label: 'USB-A 出力',        kind: 'stepper', portType: 'USB_A',       direction: 'output', max: 8 },
    { key: 'usbc_out', label: 'USB-C 出力',        kind: 'stepper', portType: 'USB_C',       direction: 'output', max: 4 },
    { key: 'eth',      label: 'Ethernet (LANケーブル差込)', kind: 'toggle',  portType: 'Ethernet',    direction: 'input' },
    { key: 'sd',       label: 'SD カード',          kind: 'toggle',  portType: 'SDCard',      direction: 'input' },
    { key: 'microsd',  label: 'microSD カード',     kind: 'toggle',  portType: 'microSDCard', direction: 'input' },
    { key: 'cfexpress', label: 'CFexpress カード',   kind: 'toggle',  portType: 'CFexpress',   direction: 'input', advanced: true },
    { key: 'audio',    label: '3.5mm オーディオ',   kind: 'toggle',  portType: 'Audio3_5mm', direction: 'output' },
  ],
  Keyboard: [
    { key: 'usba_hub', label: 'USB-A ハブ出力', kind: 'stepper', portType: 'USB_A',     direction: 'output', max: 4 },
    { key: 'bt',       label: 'Bluetooth',      kind: 'toggle',  portType: 'Bluetooth', direction: 'output', hidden: true },
    { key: 'usba',     label: 'USB-A (有線接続)', kind: 'toggle', portType: 'USB_A',   direction: 'input',  hidden: true },
    { key: 'usbc',     label: 'USB-C (有線接続)', kind: 'toggle', portType: 'USB_C',   direction: 'input',  hidden: true },
  ],
  Mouse: [
    { key: 'usba', label: 'USB-A (有線接続)', kind: 'toggle', portType: 'USB_A',     direction: 'input', hidden: true },
    { key: 'bt',   label: 'Bluetooth',        kind: 'toggle', portType: 'Bluetooth', direction: 'output', hidden: true },
  ],
  Speaker: [
    { key: 'usba',     label: 'USB-A (接続)',          kind: 'toggle', portType: 'USB_A',      direction: 'input',  hidden: true },
    { key: 'audio_in', label: '3.5mm オーディオ入力', kind: 'toggle', portType: 'Audio3_5mm', direction: 'input' },
    { key: 'trs_in',   label: '6.3mm TRS 入力',       kind: 'stepper', portType: 'Audio6_3mm', direction: 'input', max: 2, advanced: true },
    { key: 'ts_in',    label: '6.3mm TS 入力',        kind: 'stepper', portType: 'Audio6_3mm_TS', direction: 'input', max: 2, advanced: true },
    { key: 'rca_in',   label: 'RCA 入力',             kind: 'stepper', portType: 'RCA', direction: 'input', max: 2, advanced: true },
    { key: 'xlr_in',   label: 'XLR 入力',              kind: 'stepper', portType: 'XLR',       direction: 'input', max: 2, advanced: true },
    { key: 'combo_in', label: 'XLR / TRS コンボ入力',   kind: 'stepper', portType: 'XLR_TRS_Combo', direction: 'input', max: 2, advanced: true },
    // パッシブスピーカーはアンプからスピーカーケーブルで鳴らす（自分では電源を持たない）
    { key: 'sp_in',    label: 'スピーカー端子 (パッシブ)', kind: 'toggle', portType: 'SpeakerTerminal', direction: 'input' },
    { key: 'optical_in', label: '光デジタル入力 (サウンドバー等)', kind: 'toggle', portType: 'OpticalAudio', direction: 'input', advanced: true },
    { key: 'bt',       label: 'Bluetooth',            kind: 'toggle', portType: 'Bluetooth',  direction: 'output', hidden: true },
  ],
  // ヘッドセットもここ。マイクの有無は配線図に線としては出ないので、
  // 分けても端子構成が違うだけだった。ゲーミングヘッドセットの接続経路
  // （USB-A ドングル・Xbox Wireless）をここに寄せてカテゴリを1本にしている
  Headphone: [
    { key: 'usba',     label: 'USB-A (ドングル / 有線)', kind: 'toggle', portType: 'USB_A',      direction: 'input' },
    { key: 'usbc',     label: 'USB-C (有線接続)',         kind: 'toggle', portType: 'USB_C',      direction: 'input' },
    { key: 'audio_in', label: '3.5mm (有線接続)',        kind: 'toggle', portType: 'Audio3_5mm', direction: 'input' },
    { key: 'audio63_in', label: '6.3mm TRS 入力',         kind: 'toggle', portType: 'Audio6_3mm', direction: 'input' },
    { key: 'bal44_in', label: '4.4mm バランス (有線接続)', kind: 'toggle', portType: 'Audio4_4mm', direction: 'input', advanced: true },
    { key: 'xlr4_in',  label: 'XLR 4pin バランス (有線接続)', kind: 'toggle', portType: 'XLR4pin', direction: 'input', advanced: true },
    { key: 'xbox_wireless', label: 'Xbox Wireless (コントローラー・ヘッドセット)', kind: 'toggle', portType: 'XboxWireless', direction: 'bidirectional', advanced: true },
    { key: 'bt',       label: 'Bluetooth',               kind: 'toggle', portType: 'Bluetooth',  direction: 'output', hidden: true },
  ],
  Earphone: [
    { key: 'usba',     label: 'USB-A (ドングル / 有線)', kind: 'toggle', portType: 'USB_A',      direction: 'input',  hidden: true },
    { key: 'usbc',     label: 'USB-C (有線接続)',         kind: 'toggle', portType: 'USB_C',      direction: 'input' },
    { key: 'audio_in', label: '3.5mm (有線接続)',        kind: 'toggle', portType: 'Audio3_5mm', direction: 'input' },
    { key: 'bal44_in', label: '4.4mm バランス (有線接続)', kind: 'toggle', portType: 'Audio4_4mm', direction: 'input' },
    { key: 'bt',       label: 'Bluetooth',               kind: 'toggle', portType: 'Bluetooth',  direction: 'output', hidden: true },
  ],
  Microphone: [
    { key: 'usbc',      label: 'USB-C (PC 接続)',          kind: 'toggle', portType: 'USB_C',      direction: 'input' },
    { key: 'usba',      label: 'USB-A (PC 接続)',          kind: 'toggle', portType: 'USB_A',      direction: 'input' },
    { key: 'microusb',  label: 'microUSB (PC 接続)',       kind: 'toggle', portType: 'microUSB',   direction: 'input', advanced: true },
    { key: 'xlr',       label: 'XLR 出力（+48V ファンタム対応）', kind: 'toggle', portType: 'XLR', direction: 'output' },
    { key: 'audio_out', label: '3.5mm ヘッドホンモニター', kind: 'toggle', portType: 'Audio3_5mm', direction: 'output' },
    { key: 'audio_jack',label: '3.5mm オーディオジャック', kind: 'toggle', portType: 'Audio3_5mm', direction: 'output', portLabel: '3.5mm オーディオジャック', advanced: true },
    { key: 'bt',        label: 'Bluetooth',               kind: 'toggle', portType: 'Bluetooth',  direction: 'output', advanced: true },
    { key: 'micArm',    label: 'マイクアームを使用',        kind: 'toggle', portType: 'MicArm',     direction: 'input' },
  ],
  Webcam: [
    { key: 'usbc', label: 'USB-C (PC 接続)', kind: 'toggle', portType: 'USB_C',     direction: 'input' },
    { key: 'usba', label: 'USB-A (PC 接続)', kind: 'toggle', portType: 'USB_A',     direction: 'input' },
    { key: 'bt',   label: 'Bluetooth',       kind: 'toggle', portType: 'Bluetooth', direction: 'output', hidden: true },
    { key: 'bt_bi', label: 'Bluetooth',      kind: 'toggle', portType: 'Bluetooth', direction: 'bidirectional', hidden: true },
    { key: 'poe_in', label: 'Ethernet PoE 入力', kind: 'toggle', portType: 'Ethernet', direction: 'input', supportsPoE: true, portLabel: 'Ethernet PoE 入力', advanced: true },
  ],
  Camera: [
    { key: 'hdmi_out', label: 'HDMI 出力', kind: 'toggle', portType: 'HDMI', direction: 'output', supportsVideo: true },
    { key: 'usbc', label: 'USB-C (PC接続・充電)', kind: 'toggle', portType: 'USB_C', direction: 'bidirectional', supportsPowerDelivery: true },
    { key: 'microusb', label: 'microUSB (PC接続・充電)', kind: 'toggle', portType: 'microUSB', direction: 'input', advanced: true },
    { key: 'mic', label: '3.5mm マイク入力', kind: 'toggle', portType: 'Audio3_5mm', direction: 'input', advanced: true },
    { key: 'sd', label: 'SD カード', kind: 'toggle', portType: 'SDCard', direction: 'input' },
    { key: 'cfexpress', label: 'CFexpress カード', kind: 'toggle', portType: 'CFexpress', direction: 'input', advanced: true },
  ],
  Storage: [
    { key: 'xbox_expansion', label: 'Xbox ストレージ拡張カード', kind: 'toggle', portType: 'XboxExpansion', direction: 'input', advanced: true },
    { key: 'tb',       label: 'Thunderbolt (PC 接続)',   kind: 'toggle', portType: 'Thunderbolt', direction: 'input' },
    { key: 'usbc',     label: 'USB-C (PC 接続)',   kind: 'toggle',  portType: 'USB_C',    direction: 'input' },
    { key: 'usba',     label: 'USB-A (PC 接続)',   kind: 'toggle',  portType: 'USB_A',    direction: 'input' },
    { key: 'eth',      label: 'Ethernet (NAS)',    kind: 'stepper', portType: 'Ethernet', direction: 'input', max: 4 },
    { key: 'usba_out', label: 'USB-A 出力 (NAS)',  kind: 'stepper', portType: 'USB_A',    direction: 'output', max: 4, advanced: true },
    { key: 'usbc_out', label: 'USB-C 出力 (NAS)',  kind: 'toggle',  portType: 'USB_C',    direction: 'output', advanced: true },
    { key: 'sd',       label: 'SD カードスロット',      kind: 'toggle',  portType: 'SDCard',      direction: 'input', advanced: true },
    { key: 'microsd',  label: 'microSD カードスロット', kind: 'toggle',  portType: 'microSDCard', direction: 'input', advanced: true },
    { key: 'cfexpress',label: 'CFexpress スロット',     kind: 'toggle',  portType: 'CFexpress',   direction: 'input', advanced: true },
  ],
  GameConsole: [
    { key: 'hdmi_out', label: 'HDMI 出力',          kind: 'stepper', portType: 'HDMI',        direction: 'output', max: 2, supportsVideo: true },
    { key: 'usbc_io',  label: 'USB-C (ドック / 充電・映像)', kind: 'toggle', portType: 'USB_C', direction: 'bidirectional' },
    { key: 'usbc_in',  label: 'USB-C 入力 (本体 / PC 接続)', kind: 'toggle', portType: 'USB_C', direction: 'input' },
    { key: 'usbc_out', label: 'USB-C',               kind: 'stepper', portType: 'USB_C',       direction: 'output', max: 4 },
    { key: 'usba_out', label: 'USB-A',               kind: 'stepper', portType: 'USB_A',       direction: 'output', max: 4 },
    { key: 'eth',      label: 'Ethernet',            kind: 'toggle',  portType: 'Ethernet',    direction: 'input' },
    { key: 'sd',       label: 'SD カード',            kind: 'toggle',  portType: 'SDCard',      direction: 'input', advanced: true },
    { key: 'microsd',  label: 'microSD カード',       kind: 'toggle',  portType: 'microSDCard', direction: 'input' },
    { key: 'audio',    label: '3.5mm オーディオ',    kind: 'toggle',  portType: 'Audio3_5mm',  direction: 'output', advanced: true },
    { key: 'bt',       label: 'Bluetooth (コントローラー接続)', kind: 'toggle', portType: 'Bluetooth', direction: 'output', hidden: true },
    { key: 'xbox_wireless', label: 'Xbox Wireless (コントローラー・ヘッドセット)', kind: 'toggle', portType: 'XboxWireless', direction: 'bidirectional', advanced: true },
    { key: 'xbox_expansion', label: 'Xbox ストレージ拡張スロット', kind: 'toggle', portType: 'XboxExpansion', direction: 'output', advanced: true },
  ],
  CaptureDevice: [
    { key: 'hdmi_in',  label: 'HDMI 入力', kind: 'stepper', portType: 'HDMI', direction: 'input', max: 2, supportsVideo: true },
    { key: 'hdmi_out', label: 'HDMI パススルー出力', kind: 'toggle', portType: 'HDMI', direction: 'output', supportsVideo: true },
    // マイク・Webカメラ・ストレージと同じく「PC 接続」は input。
    // output だと配線エンジンが PC・ハブから線を引けず、キャプチャが HDMI だけ繋がって
    // PC へ映像を渡す線が1本も無い図になる（保存済みデータは gadgetStore の移行で向きを直す）
    { key: 'usbc_out', label: 'USB-C (PC 接続)', kind: 'toggle', portType: 'USB_C', direction: 'input' },
    { key: 'usba_out', label: 'USB-A (PC 接続)', kind: 'toggle', portType: 'USB_A', direction: 'input' },
  ],
  StreamingDevice: [
    { key: 'hdmi_out', label: 'HDMI 出力', kind: 'toggle', portType: 'HDMI', direction: 'output', supportsVideo: true },
    { key: 'usbc', label: 'USB-C 電源入力', kind: 'toggle', portType: 'USB_C', direction: 'input' },
    { key: 'eth', label: 'Ethernet', kind: 'toggle', portType: 'Ethernet', direction: 'input' },
    { key: 'wifi', label: 'Wi-Fi', kind: 'toggle', portType: 'WiFi', direction: 'input' },
  ],
  KVM: [
    { key: 'hdmi_in',  label: 'HDMI 入力', kind: 'stepper', portType: 'HDMI', direction: 'input', max: 4, supportsVideo: true },
    { key: 'hdmi_out', label: 'HDMI 出力', kind: 'stepper', portType: 'HDMI', direction: 'output', max: 2, supportsVideo: true },
    { key: 'dp_in',    label: 'DisplayPort 入力', kind: 'stepper', portType: 'DisplayPort', direction: 'input', max: 4, supportsVideo: true },
    { key: 'dp_out',   label: 'DisplayPort 出力', kind: 'stepper', portType: 'DisplayPort', direction: 'output', max: 2, supportsVideo: true },
    { key: 'usb_in',   label: 'USB-B アップストリーム', kind: 'stepper', portType: 'USB_B', direction: 'input', max: 4 },
    { key: 'usb_out',  label: 'USB-A 周辺機器', kind: 'stepper', portType: 'USB_A', direction: 'output', max: 8 },
  ],
  Light: [
    { key: 'usbc_out', label: 'USB-C 出力', kind: 'stepper', portType: 'USB_C', direction: 'output', max: 4, advanced: true },
    { key: 'usba_out', label: 'USB-A 出力', kind: 'stepper', portType: 'USB_A', direction: 'output', max: 4, advanced: true },
    { key: 'bt', label: 'Bluetooth 制御', kind: 'toggle', portType: 'Bluetooth', direction: 'output' },
    { key: 'wifi', label: 'Wi-Fi', kind: 'toggle', portType: 'WiFi', direction: 'input' },
  ],
  Router: [
    { key: 'eth_wan', label: 'Ethernet WAN 入力',      kind: 'toggle',  portType: 'Ethernet', direction: 'input' },
    { key: 'eth_lan', label: 'Ethernet LAN ポート数', kind: 'stepper', portType: 'Ethernet', direction: 'output', max: 16 },
    { key: 'poe_lan', label: 'Ethernet PoE 出力',      kind: 'stepper', portType: 'Ethernet', direction: 'output', max: 16, supportsPoE: true, portLabel: 'Ethernet PoE 出力', advanced: true },
    { key: 'usba',    label: 'USB-A',                 kind: 'stepper', portType: 'USB_A',    direction: 'output', max: 4 },
    { key: 'wifi',    label: 'Wi-Fi',                 kind: 'toggle', portType: 'WiFi',     direction: 'output' },
    { key: 'power',   label: 'AC 入力',               kind: 'toggle', portType: 'Power',    direction: 'input', advanced: true },
  ],
  NetworkSwitch: [
    // ルーターから1本もらって複数に配る機器。上り1本は必ずあるので locked
    { key: 'eth_uplink', label: 'アップリンク (Ethernet)', kind: 'toggle',  portType: 'Ethernet',    direction: 'input',  locked: true },
    { key: 'eth_lan',    label: '接続先ポート数（アップリンク除く）', kind: 'stepper', portType: 'Ethernet', direction: 'output', max: 23 },
    { key: 'poe_lan',    label: 'Ethernet PoE 出力',        kind: 'stepper', portType: 'Ethernet', direction: 'output', max: 24, supportsPoE: true, portLabel: 'Ethernet PoE 出力', advanced: true },
    { key: 'power',      label: 'AC 入力',                    kind: 'toggle', portType: 'Power', direction: 'input', advanced: true },
  ],
  Printer3D: [
    { key: 'usbc',    label: 'USB-C 入力',        kind: 'toggle', portType: 'USB_C',       direction: 'input' },
    { key: 'usba',    label: 'USB-A (PC 接続)',   kind: 'stepper', portType: 'USB_A',      direction: 'input', max: 2 },
    { key: 'eth',     label: 'Ethernet',          kind: 'toggle', portType: 'Ethernet',    direction: 'input' },
    { key: 'microsd', label: 'microSD カード',    kind: 'toggle', portType: 'microSDCard', direction: 'input' },
    { key: 'wifi',    label: 'Wi-Fi',             kind: 'toggle', portType: 'WiFi',        direction: 'input' },
  ],
  Printer: [
    { key: 'usbc', label: 'USB-C 入力', kind: 'toggle', portType: 'USB_C', direction: 'input' },
    { key: 'usba', label: 'USB-A 入力', kind: 'toggle', portType: 'USB_A', direction: 'input' },
    { key: 'eth', label: 'Ethernet', kind: 'toggle', portType: 'Ethernet', direction: 'input' },
    { key: 'wifi', label: 'Wi-Fi', kind: 'toggle', portType: 'WiFi', direction: 'input' },
    { key: 'power', label: 'AC 入力', kind: 'toggle', portType: 'Power', direction: 'input', locked: true },
  ],
  PenTablet: [
    // 液タブ（Cintiq / Artist 等）は映像を受け取る。板タブの USB-C とは別の口なので
    // 映像対応かどうかで振り分ける（両方のトグルが同じポートを拾わないようにする）
    { key: 'usbc', label: 'USB-C 入力', kind: 'toggle', portType: 'USB_C', direction: 'input', excludeVideoCapable: true },
    { key: 'usba', label: 'USB-A 入力', kind: 'toggle', portType: 'USB_A', direction: 'input' },
    { key: 'usbc_video', label: 'USB-C 入力 (映像・液タブ)', kind: 'toggle', portType: 'USB_C', direction: 'input', supportsVideo: true, portLabel: 'USB-C (映像)', advanced: true },
    { key: 'hdmi_in', label: 'HDMI 入力 (液タブ)', kind: 'toggle', portType: 'HDMI', direction: 'input', supportsVideo: true },
    { key: 'dp_in', label: 'DisplayPort 入力 (液タブ)', kind: 'toggle', portType: 'DisplayPort', direction: 'input', supportsVideo: true, advanced: true },
    { key: 'bt', label: 'Bluetooth', kind: 'toggle', portType: 'Bluetooth', direction: 'output' },
  ],
  AudioInterface: [
    { key: 'usbc',      label: 'USB-C (PC 接続)',  kind: 'toggle',  portType: 'USB_C',      direction: 'input' },
    { key: 'usba',      label: 'USB-A (PC 接続)',  kind: 'toggle',  portType: 'USB_A',      direction: 'input' },
    { key: 'usbb',      label: 'USB-B (PC 接続)',  kind: 'toggle',  portType: 'USB_B',      direction: 'input', advanced: true },
    { key: 'xlr_in',   label: 'XLR 入力数',        kind: 'stepper', portType: 'XLR',        direction: 'input',  max: 8 },
    { key: 'combo_in', label: 'XLR / TRS コンボ入力', kind: 'stepper', portType: 'XLR_TRS_Combo', direction: 'input', max: 8 },
    { key: 'xlr_out',  label: 'XLR 出力数',        kind: 'stepper', portType: 'XLR',        direction: 'output', max: 4 },
    { key: 'audio_in', label: '3.5mm / TRS 入力', kind: 'stepper', portType: 'Audio3_5mm', direction: 'input', max: 4, hidden: true },
    { key: 'audio_out', label: '3.5mm ヘッドホン出力', kind: 'stepper', portType: 'Audio3_5mm', direction: 'output', max: 4, portLabel: '3.5mm ヘッドホン出力', acceptLabelIncludes: 'ヘッドホン' },
    { key: 'trs_in', label: '6.3mm TRS 入力', kind: 'stepper', portType: 'Audio6_3mm', direction: 'input', max: 8 },
    { key: 'ts_in', label: '6.3mm TS 入力', kind: 'stepper', portType: 'Audio6_3mm_TS', direction: 'input', max: 8, advanced: true },
    { key: 'rca_in', label: 'RCA 入力', kind: 'stepper', portType: 'RCA', direction: 'input', max: 8, advanced: true },
    { key: 'rca_out', label: 'RCA 出力', kind: 'stepper', portType: 'RCA', direction: 'output', max: 8, advanced: true },
    { key: 'trs_out', label: '6.3mm TRS モニター出力', kind: 'stepper', portType: 'Audio6_3mm', direction: 'output', max: 8, portLabel: '6.3mm TRS モニター出力', acceptUnlabeled: true, acceptLabelIncludes: 'TRS モニター' },
    { key: 'phones_out', label: '6.3mm ヘッドホン出力', kind: 'stepper', portType: 'Audio6_3mm', direction: 'output', max: 4, portLabel: '6.3mm ヘッドホン出力', acceptLabelIncludes: 'ヘッドホン' },
    { key: 'midi_in', label: 'MIDI IN', kind: 'toggle', portType: 'MIDI', direction: 'input' },
    { key: 'midi_out', label: 'MIDI OUT', kind: 'toggle', portType: 'MIDI', direction: 'output', portLabel: 'MIDI OUT', acceptUnlabeled: true, acceptLabelIncludes: 'OUT' },
    { key: 'optical_in', label: '光デジタル入力', kind: 'toggle', portType: 'OpticalAudio', direction: 'input', advanced: true },
    { key: 'optical_out', label: '光デジタル出力', kind: 'toggle', portType: 'OpticalAudio', direction: 'output', advanced: true },
    { key: 'coax_in', label: '同軸デジタル入力', kind: 'toggle', portType: 'CoaxialAudio', direction: 'input', advanced: true },
    { key: 'midi_trs_in', label: 'MIDI IN (3.5mm TRS)', kind: 'toggle', portType: 'MIDI_TRS', direction: 'input', advanced: true },
    { key: 'midi_trs_out', label: 'MIDI OUT (3.5mm TRS)', kind: 'toggle', portType: 'MIDI_TRS', direction: 'output', advanced: true },
  ],
  HeadphoneAmp: [
    { key: 'usbc', label: 'USB-C (PC 接続)', kind: 'toggle', portType: 'USB_C', direction: 'input' },
    { key: 'usba', label: 'USB-A (PC 接続)', kind: 'toggle', portType: 'USB_A', direction: 'input' },
    { key: 'usbb', label: 'USB-B (PC 接続)', kind: 'toggle', portType: 'USB_B', direction: 'input' },
    { key: 'optical', label: '光デジタル入力', kind: 'toggle', portType: 'OpticalAudio', direction: 'input' },
    { key: 'audio_in', label: '3.5mm オーディオ入力', kind: 'toggle', portType: 'Audio3_5mm', direction: 'input' },
    { key: 'audio_out', label: '3.5mm オーディオ出力', kind: 'toggle', portType: 'Audio3_5mm', direction: 'output' },
    { key: 'coax_in', label: '同軸デジタル入力', kind: 'toggle', portType: 'CoaxialAudio', direction: 'input', advanced: true },
    { key: 'rca_in', label: 'RCA 入力', kind: 'stepper', portType: 'RCA', direction: 'input', max: 2, advanced: true },
    { key: 'phones_out', label: '6.3mm ヘッドホン出力', kind: 'toggle', portType: 'Audio6_3mm', direction: 'output', portLabel: '6.3mm ヘッドホン出力', acceptUnlabeled: true, acceptLabelIncludes: 'ヘッドホン' },
    { key: 'bal44_out', label: '4.4mm バランス出力', kind: 'toggle', portType: 'Audio4_4mm', direction: 'output' },
    { key: 'xlr4_out', label: 'XLR 4pin バランス出力', kind: 'toggle', portType: 'XLR4pin', direction: 'output', advanced: true },
    { key: 'rca_out', label: 'RCA ライン出力', kind: 'stepper', portType: 'RCA', direction: 'output', max: 2 },
    { key: 'xlr_out', label: 'XLR ライン出力', kind: 'stepper', portType: 'XLR', direction: 'output', max: 2, advanced: true },
    { key: 'power', label: 'AC 入力', kind: 'toggle', portType: 'Power', direction: 'input' },
  ],
  // プリメイン／パワーアンプ。パッシブスピーカーへスピーカーケーブルで出力する唯一のカテゴリ
  Amplifier: [
    { key: 'rca_in', label: 'RCA 入力', kind: 'stepper', portType: 'RCA', direction: 'input', max: 4 },
    { key: 'trs_in', label: '6.3mm TRS 入力', kind: 'stepper', portType: 'Audio6_3mm', direction: 'input', max: 2, advanced: true },
    { key: 'xlr_in', label: 'XLR 入力', kind: 'stepper', portType: 'XLR', direction: 'input', max: 2, advanced: true },
    { key: 'audio_in', label: '3.5mm オーディオ入力', kind: 'toggle', portType: 'Audio3_5mm', direction: 'input' },
    // 光・同軸は2系統持つ機種があるのでステッパーにする（PMA-600NE は光2・同軸1）
    { key: 'optical_in', label: '光デジタル入力', kind: 'stepper', portType: 'OpticalAudio', direction: 'input', max: 3 },
    { key: 'coax_in', label: '同軸デジタル入力', kind: 'stepper', portType: 'CoaxialAudio', direction: 'input', max: 2 },
    { key: 'usbb', label: 'USB-B (PC 接続)', kind: 'toggle', portType: 'USB_B', direction: 'input' },
    { key: 'usbc', label: 'USB-C (PC 接続)', kind: 'toggle', portType: 'USB_C', direction: 'input' },
    { key: 'sp_out', label: 'スピーカー端子', kind: 'stepper', portType: 'SpeakerTerminal', direction: 'output', max: 4 },
    { key: 'phones_out', label: '6.3mm ヘッドホン出力', kind: 'toggle', portType: 'Audio6_3mm', direction: 'output', portLabel: '6.3mm ヘッドホン出力', acceptUnlabeled: true, acceptLabelIncludes: 'ヘッドホン' },
    { key: 'bal44_out', label: '4.4mm バランス出力', kind: 'toggle', portType: 'Audio4_4mm', direction: 'output', advanced: true },
    { key: 'rca_out', label: 'RCA プリ出力', kind: 'stepper', portType: 'RCA', direction: 'output', max: 2, advanced: true },
    { key: 'bt', label: 'Bluetooth', kind: 'toggle', portType: 'Bluetooth', direction: 'input' },
  ],
  Mixer: [
    { key: 'xlr_in',   label: 'XLR / チャンネル数',    kind: 'stepper', portType: 'XLR',        direction: 'input',  max: 32 },
    { key: 'combo_in', label: 'XLR / TRS コンボ入力', kind: 'stepper', portType: 'XLR_TRS_Combo', direction: 'input', max: 32 },
    { key: 'xlr_out',  label: 'XLR メイン出力',         kind: 'stepper', portType: 'XLR',        direction: 'output', max: 4 },
    { key: 'usbc',     label: 'USB-C (PC 接続/録音)',   kind: 'toggle',  portType: 'USB_C',      direction: 'input' },
    { key: 'usba',     label: 'USB-A (PC 接続/録音)',   kind: 'toggle',  portType: 'USB_A',      direction: 'input' },
    { key: 'audio_in', label: '3.5mm / TRS 入力', kind: 'stepper', portType: 'Audio3_5mm', direction: 'input', max: 4, hidden: true },
    { key: 'audio_out', label: 'ヘッドホン出力', kind: 'stepper', portType: 'Audio3_5mm', direction: 'output', max: 4, hidden: true },
    { key: 'trs_in', label: '6.3mm TRS 入力', kind: 'stepper', portType: 'Audio6_3mm', direction: 'input', max: 32 },
    { key: 'ts_in', label: '6.3mm TS 入力', kind: 'stepper', portType: 'Audio6_3mm_TS', direction: 'input', max: 32, advanced: true },
    { key: 'rca_in', label: 'RCA 入力', kind: 'stepper', portType: 'RCA', direction: 'input', max: 16, advanced: true },
    { key: 'rca_out', label: 'RCA 出力', kind: 'stepper', portType: 'RCA', direction: 'output', max: 8, advanced: true },
    { key: 'trs_out', label: '6.3mm TRS モニター出力', kind: 'stepper', portType: 'Audio6_3mm', direction: 'output', max: 8, portLabel: '6.3mm TRS モニター出力', acceptUnlabeled: true, acceptLabelIncludes: 'TRS モニター' },
    { key: 'phones_out', label: '6.3mm ヘッドホン出力', kind: 'stepper', portType: 'Audio6_3mm', direction: 'output', max: 4, portLabel: '6.3mm ヘッドホン出力', acceptLabelIncludes: 'ヘッドホン' },
    { key: 'midi_in', label: 'MIDI IN', kind: 'toggle', portType: 'MIDI', direction: 'input' },
    { key: 'midi_out', label: 'MIDI OUT', kind: 'toggle', portType: 'MIDI', direction: 'output', portLabel: 'MIDI OUT', acceptUnlabeled: true, acceptLabelIncludes: 'OUT' },
    { key: 'eth',      label: 'Ethernet (ネットワーク)', kind: 'toggle',  portType: 'Ethernet',   direction: 'input' },
  ],
  // モバイルバッテリーは入出力兼用を含む実物の物理ポートをそのまま定義する。
  MobileBattery: [
    { key: 'usbc_io', label: 'USB-C 入出力兼用', kind: 'stepper', portType: 'USB_C', direction: 'bidirectional', max: 4 },
    { key: 'usbc_out', label: 'USB-C 出力専用', kind: 'stepper', portType: 'USB_C', direction: 'output', max: 4, advanced: true },
    { key: 'usbc_in', label: 'USB-C 入力専用', kind: 'toggle', portType: 'USB_C', direction: 'input', advanced: true },
    { key: 'usba_out', label: 'USB-A 出力', kind: 'stepper', portType: 'USB_A', direction: 'output', max: 4 },
    { key: 'lightning_in', label: 'Lightning 入力', kind: 'toggle', portType: 'Lightning', direction: 'input', advanced: true },
    { key: 'microusb_in', label: 'microUSB 入力', kind: 'toggle', portType: 'microUSB', direction: 'input', advanced: true },
    { key: 'power_in', label: 'AC入力（コンセント一体型）', kind: 'toggle', portType: 'Power', direction: 'input', advanced: true },
    { key: 'qi',       label: 'ワイヤレス給電 (Qi / MagSafe)', kind: 'toggle', portType: 'wirelessCharging', direction: 'output' },
  ],
  Charger: [],
  PowerStrip: [],
  UPS: [
    { key: 'power_out', label: 'AC 出力', kind: 'stepper', portType: 'Power', direction: 'output', max: 12 },
    { key: 'power_in', label: 'AC 入力', kind: 'toggle', portType: 'Power', direction: 'input', locked: true },
    { key: 'usbc_out', label: 'USB-C 出力', kind: 'stepper', portType: 'USB_C', direction: 'output', max: 4, advanced: true },
    { key: 'usba_out', label: 'USB-A 出力', kind: 'stepper', portType: 'USB_A', direction: 'output', max: 4, advanced: true },
  ],
  SmartHome: [
    { key: 'usbc', label: 'USB-C (電源 / 接続)', kind: 'toggle', portType: 'USB_C',     direction: 'input' },
    { key: 'usba', label: 'USB-A (電源)',    kind: 'toggle', portType: 'USB_A',     direction: 'input' },
    { key: 'eth',  label: 'Ethernet',        kind: 'toggle', portType: 'Ethernet',  direction: 'input' },
    { key: 'poe_in', label: 'Ethernet PoE 入力', kind: 'toggle', portType: 'Ethernet', direction: 'input', supportsPoE: true, portLabel: 'Ethernet PoE 入力', advanced: true },
    { key: 'bt',   label: 'Bluetooth',       kind: 'toggle', portType: 'Bluetooth', direction: 'output' },
    { key: 'wifi', label: 'Wi-Fi',           kind: 'toggle', portType: 'WiFi', direction: 'input' },
    { key: 'power_out', label: 'AC 出力', kind: 'stepper', portType: 'Power', direction: 'output', max: 8 },
  ],
  Smartphone: [
    { key: 'usbc_in', label: 'USB-C（充電・データ）', kind: 'toggle', portType: 'USB_C', direction: 'input', acceptUnlabeled: true, excludeVideoCapable: true },
    { key: 'usbc_video', label: 'USB-C（映像・データ・充電）', kind: 'toggle', portType: 'USB_C', direction: 'bidirectional', supportsVideo: true, portLabel: '映像・データ・充電', acceptUnlabeled: true, acceptLegacyVideoInput: true },
    { key: 'lightning', label: 'Lightning（充電・データ）', kind: 'toggle', portType: 'Lightning', direction: 'input', portLabel: '充電・データ', acceptUnlabeled: true },
    { key: 'audio', label: '3.5mm オーディオ', kind: 'toggle', portType: 'Audio3_5mm', direction: 'output' },
    { key: 'bt',    label: 'Bluetooth',        kind: 'toggle', portType: 'Bluetooth',  direction: 'output', hidden: true, locked: true },
  ],
  Tablet: [
    { key: 'usbc_in', label: 'USB-C（充電・データ）', kind: 'toggle', portType: 'USB_C', direction: 'input', acceptUnlabeled: true, excludeVideoCapable: true },
    { key: 'usbc_video', label: 'USB-C（映像・データ・充電）', kind: 'toggle', portType: 'USB_C', direction: 'bidirectional', supportsVideo: true, portLabel: '映像・データ・充電', acceptUnlabeled: true, acceptLegacyVideoInput: true },
    { key: 'lightning', label: 'Lightning（充電・データ）', kind: 'toggle', portType: 'Lightning', direction: 'input', portLabel: '充電・データ', acceptUnlabeled: true },
    { key: 'audio',  label: '3.5mm オーディオ',  kind: 'toggle', portType: 'Audio3_5mm', direction: 'output' },
    { key: 'bt',     label: 'Bluetooth',          kind: 'toggle', portType: 'Bluetooth',  direction: 'output', hidden: true, locked: true },
    { key: 'stylus', label: 'スタイラスペン対応', kind: 'toggle', portType: 'Stylus',     direction: 'input' },
    { key: 'stylus_power', label: 'Apple Pencil ワイヤレス給電', kind: 'toggle', portType: 'wirelessCharging', direction: 'output' },
  ],
  // 電子ピアノ・MIDIキーボード（USB-C接続 + ヘッドホン出力）と
  // ギター・アンプ（フォーン入出力）の両方をカバーする
  Instrument: [
    { key: 'usbc',      label: 'USB-C (PC / Mac 接続)',      kind: 'toggle',  portType: 'USB_C',      direction: 'input' },
    { key: 'usba',      label: 'USB-A (PC / Mac 接続)',      kind: 'toggle',  portType: 'USB_A',      direction: 'input' },
    { key: 'legacy_audio_out', label: 'ヘッドホン / フォーン出力', kind: 'stepper', portType: 'Audio3_5mm', direction: 'output', max: 2, hidden: true },
    { key: 'legacy_audio_in', label: 'フォーン入力 (アンプ等)', kind: 'toggle', portType: 'Audio3_5mm', direction: 'input', hidden: true },
    { key: 'audio_out', label: '6.3mm フォーン出力', kind: 'stepper', portType: 'Audio6_3mm', direction: 'output', max: 2 },
    { key: 'ts_out', label: '6.3mm TS 出力', kind: 'stepper', portType: 'Audio6_3mm_TS', direction: 'output', max: 2, advanced: true },
    { key: 'rca_out', label: 'RCA 出力', kind: 'stepper', portType: 'RCA', direction: 'output', max: 2, advanced: true },
    { key: 'audio_in', label: '6.3mm フォーン入力 (アンプ等)', kind: 'toggle', portType: 'Audio6_3mm', direction: 'input' },
    { key: 'xlr_out',   label: 'XLR 出力',                   kind: 'stepper', portType: 'XLR',        direction: 'output', max: 2, advanced: true },
    { key: 'midi_in', label: 'MIDI IN', kind: 'toggle', portType: 'MIDI', direction: 'input' },
    { key: 'midi_out', label: 'MIDI OUT', kind: 'toggle', portType: 'MIDI', direction: 'output', portLabel: 'MIDI OUT', acceptUnlabeled: true, acceptLabelIncludes: 'OUT' },
    { key: 'midi_thru', label: 'MIDI THRU', kind: 'toggle', portType: 'MIDI', direction: 'output', portLabel: 'MIDI THRU', acceptLabelIncludes: 'THRU', advanced: true },
    { key: 'midi_trs_in', label: 'MIDI IN (3.5mm TRS)', kind: 'toggle', portType: 'MIDI_TRS', direction: 'input', advanced: true },
    { key: 'midi_trs_out', label: 'MIDI OUT (3.5mm TRS)', kind: 'toggle', portType: 'MIDI_TRS', direction: 'output', advanced: true },
    { key: 'bt',        label: 'Bluetooth',                  kind: 'toggle',  portType: 'Bluetooth',  direction: 'output' },
  ],
  Desk: [
    { key: 'power_in', label: 'AC入力（デスク電源）', kind: 'toggle', portType: 'Power', direction: 'input' },
    { key: 'power_out', label: '内蔵ACコンセント', kind: 'stepper', portType: 'Power', direction: 'output', max: 8, portLabel: '内蔵ACコンセント' },
    { key: 'usbc_out', label: '充電用USB-C', kind: 'stepper', portType: 'USB_C', direction: 'output', max: 4, portLabel: '充電用USB-C' },
    { key: 'usba_out', label: '充電用USB-A', kind: 'stepper', portType: 'USB_A', direction: 'output', max: 4, portLabel: '充電用USB-A' },
  ],
  Chair:      [],
  // デスクシェルフ・モニター台には、コンセントや USB を内蔵したものがある（口の無い棚は空のまま）
  Furniture: [
    { key: 'power_in', label: 'AC入力（電源コード）', kind: 'toggle', portType: 'Power', direction: 'input' },
    { key: 'power_out', label: '内蔵ACコンセント', kind: 'stepper', portType: 'Power', direction: 'output', max: 8, portLabel: '内蔵ACコンセント' },
    { key: 'usbc_out', label: '充電用USB-C', kind: 'stepper', portType: 'USB_C', direction: 'output', max: 4, portLabel: '充電用USB-C' },
    { key: 'usba_out', label: '充電用USB-A', kind: 'stepper', portType: 'USB_A', direction: 'output', max: 4, portLabel: '充電用USB-A' },
  ],
  WallPanel: [
    { key: 'power_out', label: 'AC 出力', kind: 'stepper', portType: 'Power', direction: 'output', max: 8 },
    { key: 'usbc_out', label: 'USB-C 出力', kind: 'stepper', portType: 'USB_C', direction: 'output', max: 8 },
    { key: 'usba_out', label: 'USB-A 出力', kind: 'stepper', portType: 'USB_A', direction: 'output', max: 8 },
    { key: 'power_in', label: 'AC 入力', kind: 'toggle', portType: 'Power', direction: 'input' },
  ],
  Accessory:  [
    { key: 'usbc_in', label: 'USB-C（充電・データ）', kind: 'toggle', portType: 'USB_C', direction: 'input', portLabel: '充電・データ', acceptUnlabeled: true },
    // 吸着給電（Apple Pencil 等）は「給電方法：ワイヤレス」で設定する
    { key: 'bt', label: 'Bluetooth', kind: 'toggle', portType: 'Bluetooth', direction: 'output' },
  ],
  Other: [
    { key: 'usbc_in', label: 'USB-C 入力', kind: 'stepper', portType: 'USB_C', direction: 'input', max: 8 },
    { key: 'usba_in', label: 'USB-A 入力', kind: 'stepper', portType: 'USB_A', direction: 'input', max: 8 },
    { key: 'hdmi_in', label: 'HDMI 入力', kind: 'stepper', portType: 'HDMI', direction: 'input', max: 4, supportsVideo: true },
    { key: 'dp_in', label: 'DisplayPort 入力', kind: 'stepper', portType: 'DisplayPort', direction: 'input', max: 3, supportsVideo: true },
    { key: 'usbc', label: 'USB-C 出力（周辺機器へ）', kind: 'stepper', portType: 'USB_C', direction: 'output', max: 8 },
    { key: 'usba', label: 'USB-A 出力（周辺機器へ）', kind: 'stepper', portType: 'USB_A', direction: 'output', max: 8 },
    { key: 'hdmi', label: 'HDMI 出力（周辺機器へ）', kind: 'stepper', portType: 'HDMI', direction: 'output', max: 4, supportsVideo: true },
    { key: 'dp', label: 'DisplayPort 出力（周辺機器へ）', kind: 'stepper', portType: 'DisplayPort', direction: 'output', max: 3, supportsVideo: true },
    { key: 'tb',      label: 'Thunderbolt',   kind: 'stepper', portType: 'Thunderbolt', direction: 'output', max: 4, supportsVideo: true },
    { key: 'eth_in',  label: 'Ethernet WAN 入力', kind: 'toggle', portType: 'Ethernet', direction: 'input', advanced: true },
    { key: 'eth',     label: 'Ethernet',      kind: 'toggle',  portType: 'Ethernet',     direction: 'output' },
    { key: 'poe_in',  label: 'Ethernet PoE 入力', kind: 'toggle', portType: 'Ethernet', direction: 'input', supportsPoE: true, portLabel: 'Ethernet PoE 入力', advanced: true },
    { key: 'poe_out', label: 'Ethernet PoE 出力', kind: 'stepper', portType: 'Ethernet', direction: 'output', max: 16, supportsPoE: true, portLabel: 'Ethernet PoE 出力', advanced: true },
    { key: 'audio',   label: '3.5mm Audio',   kind: 'toggle',  portType: 'Audio3_5mm',   direction: 'output' },
    { key: 'bt',      label: 'Bluetooth',     kind: 'toggle',  portType: 'Bluetooth',    direction: 'output' },
    { key: 'xlr_in',  label: 'XLR In',       kind: 'stepper', portType: 'XLR',          direction: 'input',  max: 8, advanced: true },
    { key: 'xlr_out', label: 'XLR Out',      kind: 'stepper', portType: 'XLR',          direction: 'output', max: 4, advanced: true },
    { key: 'combo_in', label: 'XLR / TRS コンボ入力', kind: 'stepper', portType: 'XLR_TRS_Combo', direction: 'input', max: 16, advanced: true },
    { key: 'ts_in', label: '6.3mm TS 入力', kind: 'stepper', portType: 'Audio6_3mm_TS', direction: 'input', max: 16, advanced: true },
    { key: 'ts_out', label: '6.3mm TS 出力', kind: 'stepper', portType: 'Audio6_3mm_TS', direction: 'output', max: 16, advanced: true },
    { key: 'rca_in', label: 'RCA 入力', kind: 'stepper', portType: 'RCA', direction: 'input', max: 16, advanced: true },
    { key: 'rca_out', label: 'RCA 出力', kind: 'stepper', portType: 'RCA', direction: 'output', max: 16, advanced: true },
    { key: 'sd',      label: 'SD Card',      kind: 'toggle',  portType: 'SDCard',        direction: 'input', advanced: true },
    { key: 'microsd', label: 'microSD',      kind: 'toggle',  portType: 'microSDCard',   direction: 'input', advanced: true },
  ],
  SmallDevice: [
    { key: 'usbc_in', label: 'USB-C 入力', kind: 'toggle', portType: 'USB_C', direction: 'input' },
    { key: 'usba_in', label: 'USB-A 入力', kind: 'toggle', portType: 'USB_A', direction: 'input' },
    { key: 'microusb_in', label: 'microUSB 入力', kind: 'toggle', portType: 'microUSB', direction: 'input', advanced: true },
    { key: 'bt', label: 'Bluetooth', kind: 'toggle', portType: 'Bluetooth', direction: 'output' },
    { key: 'poe_in', label: 'Ethernet PoE 入力', kind: 'toggle', portType: 'Ethernet', direction: 'input', supportsPoE: true, portLabel: 'Ethernet PoE 入力', advanced: true },
  ],
  MonitorArm: [
    { key: 'supports', label: '支持できるモニター数', kind: 'stepper', portType: 'MonitorArm', direction: 'output', max: 6 },
    { key: 'usbc_in', label: 'USB-C アップストリーム入力', kind: 'toggle', portType: 'USB_C', direction: 'input', advanced: true },
    { key: 'usbc_out', label: 'USB-C 出力', kind: 'stepper', portType: 'USB_C', direction: 'output', max: 4, advanced: true },
    { key: 'usba_out', label: 'USB-A 出力', kind: 'stepper', portType: 'USB_A', direction: 'output', max: 4, advanced: true },
  ],
  MicArm: [
    { key: 'supports', label: '支持できるマイク数', kind: 'stepper', portType: 'MicArm', direction: 'output', max: 4 },
    { key: 'usbc_in', label: 'USB-C アップストリーム入力', kind: 'toggle', portType: 'USB_C', direction: 'input', advanced: true },
    { key: 'usbc_out', label: 'USB-C 出力', kind: 'stepper', portType: 'USB_C', direction: 'output', max: 4, advanced: true },
  ],
  Modem: [
    { key: 'eth_out', label: 'Ethernet LAN ポート数', kind: 'stepper', portType: 'Ethernet', direction: 'output', max: 4 },
    { key: 'power_in', label: 'AC 入力', kind: 'toggle', portType: 'Power', direction: 'input' },
  ],
  Cable:      [],
  VRGlass: [
    { key: 'dp_in',   label: 'DisplayPort 入力 (映像)',    kind: 'toggle', portType: 'DisplayPort', direction: 'input', supportsVideo: true },
    { key: 'usbc_in', label: 'USB-C 入力 (映像 / データ)', kind: 'toggle', portType: 'USB_C',       direction: 'input', supportsVideo: true },
    { key: 'usba_in', label: 'USB-A データ接続',           kind: 'toggle', portType: 'USB_A',       direction: 'input', advanced: true },
    { key: 'power_in', label: '専用AC電源',                kind: 'toggle', portType: 'Power',       direction: 'input', advanced: true },
    { key: 'bt',      label: 'Bluetooth',                  kind: 'toggle', portType: 'Bluetooth',  direction: 'output' },
  ],
  Smartwatch: [
    { key: 'magnetic_c', label: 'マグネット充電（専用ケーブル）', kind: 'toggle', portType: 'USB_C', direction: 'input', portLabel: 'マグネット充電（専用ケーブル）', acceptLabelIncludes: 'マグネット充電' },
    { key: 'magnetic_a', label: 'マグネット充電（専用ケーブル）', kind: 'toggle', portType: 'USB_A', direction: 'input', portLabel: 'マグネット充電（専用ケーブル）', acceptLabelIncludes: 'マグネット充電' },
    { key: 'qi', label: 'Qi ワイヤレス充電', kind: 'toggle', portType: 'wirelessCharging', direction: 'input', portLabel: 'Qi ワイヤレス充電', includePowerPort: true, acceptLabelIncludes: 'ワイヤレス' },
    { key: 'cradle_c', label: '専用クレードル', kind: 'toggle', portType: 'USB_C', direction: 'input', portLabel: '専用クレードル', acceptLabelIncludes: 'クレードル', advanced: true },
    { key: 'cradle_a', label: '専用クレードル', kind: 'toggle', portType: 'USB_A', direction: 'input', portLabel: '専用クレードル', acceptLabelIncludes: 'クレードル', advanced: true },
    { key: 'bt', label: 'Bluetooth', kind: 'toggle', portType: 'Bluetooth', direction: 'output', locked: true },
  ],
  Controller: [
    { key: 'bt',   label: 'Bluetooth',       kind: 'toggle', portType: 'Bluetooth', direction: 'output', hidden: true },
    { key: 'xbox_wireless', label: 'Xbox Wireless (コントローラー・ヘッドセット)', kind: 'toggle', portType: 'XboxWireless', direction: 'bidirectional', advanced: true },
    { key: 'usba', label: 'USB-A (有線接続)', kind: 'toggle', portType: 'USB_A',   direction: 'input',  hidden: true },
    { key: 'usbc', label: 'USB-C (有線接続)', kind: 'toggle', portType: 'USB_C', direction: 'input', hidden: true },
    { key: 'audio_out', label: '3.5mm ヘッドセット端子', kind: 'toggle', portType: 'Audio3_5mm', direction: 'output' },
  ],
}

/**
 * その口をこのフィールドが担当しているか。
 *
 * 同じ type+direction を持つフィールドが複数ある場合（例：マイクの3.5mm出力が
 * 「ヘッドホンモニター」と「オーディオジャック」の2つ）、portLabel で区別する。
 * portLabel 未設定のフィールドは従来通り type+direction 一致のみで判定する。
 */
export function portMatchesField(p: Port, f: PortFormField): boolean {
  const isEthernetField = f.portType === 'Ethernet' || f.portType === 'EthernetPoE'
  const isPoePort = p.type === 'EthernetPoE' || (p.type === 'Ethernet' && p.supportsPoE === true)
  const typeMatches = p.type === f.portType ||
    (f.supportsPoE === true && f.portType === 'Ethernet' && p.type === 'EthernetPoE')
  return Boolean(
    (f.includePowerPort || (!isPowerFeedPrefixPort(p) && p.label !== WIRELESS_POWER_PORT_LABEL)) &&
    typeMatches &&
    (!isEthernetField || (f.supportsPoE === true ? isPoePort : !isPoePort)) &&
    (p.direction === f.direction || (f.acceptLegacyVideoInput && p.direction === 'input' && p.supportsVideo === true)) &&
    (!f.excludeVideoCapable || p.supportsVideo !== true) &&
    (!f.excludePowerDelivery || (p.supportsPowerDelivery !== true && !/PD|給電/i.test(p.label ?? ''))) &&
    (f.portLabel === undefined || p.label === f.portLabel || (f.acceptUnlabeled && !p.label) || (!!f.acceptLabelIncludes && !!p.label?.includes(f.acceptLabelIncludes))),
  )
}

export function initPortState(ports: Port[], fields: PortFormField[]): PortState {
  const state: PortState = {}
  for (const f of fields) {
    const matches = (p: Port) => portMatchesField(p, f)
    if (f.kind === 'stepper') {
      state[f.key] = ports.find(matches)?.count ?? 0
      if (f.supportsVideo === false && ports.some((p) => matches(p) && p.supportsVideo === undefined)) {
        state[`${f.key}__legacyVideo`] = true
      }
    } else if (f.locked) {
      state[f.key] = true
    } else {
      state[f.key] = ports.some(matches)
    }
  }
  return state
}

export function buildPortsFromState(state: PortState, fields: PortFormField[]): Port[] {
  const specs: Omit<Port, 'id'>[] = []
  for (const f of fields) {
    const val = state[f.key]
    const supportsVideo = state[`${f.key}__legacyVideo`] === true ? undefined : f.supportsVideo
    if (f.kind === 'stepper' && typeof val === 'number' && val > 0) {
      specs.push({ type: f.portType, direction: f.direction, count: val, supportsVideo, supportsPowerDelivery: f.supportsPowerDelivery, supportsPoE: f.supportsPoE, supportsDisplayConversion: f.supportsDisplayConversion, label: f.portLabel })
    } else if (f.kind === 'toggle' && val === true) {
      specs.push({ type: f.portType, direction: f.direction, count: 1, supportsVideo, supportsPowerDelivery: f.supportsPowerDelivery, supportsPoE: f.supportsPoE, supportsDisplayConversion: f.supportsDisplayConversion, label: f.portLabel })
    }
  }
  return specs.map((s, i) => ({ id: `p${i + 1}`, ...s }))
}

export function defaultPortState(fields: PortFormField[]): PortState {
  const state: PortState = {}
  for (const f of fields) {
    state[f.key] = f.kind === 'stepper' ? 0 : (f.locked ? true : false)
  }
  return state
}

/**
 * 商品を特定できないまま「ジャンルだけ」決まったときに置く、よくある構成。
 *
 * defaultPortState は全フィールドを 0 / false で返すので、そのまま保存すると
 * 口を1つも持たないガジェットになり、配線が1本も引けない図しか出せない。
 *
 * 実物より少なめに倒している。足りないぶんは詳細設定で足せるが、実在しない口を
 * 勝手に生やすと配線エンジンがあり得ない線を引き、しかもユーザーには
 * 「アプリが間違えた」ようにしか見えない。
 *
 * 有線・無線が分かれる周辺機器（Keyboard / Speaker / Headphone / Earphone /
 * Controller / Mouse）はここに書かない。接続方式のピッカーが口を決めるので、
 * 既定値を置くと二重になる。充電器・電源タップも専用フォーム側に既定がある。
 *
 * Ethernet 入力も置かない。ルーターを登録していないデスクで
 * 「ルーターが見つかりません」が出てしまい、推定値が自分で警告を作ることになる。
 * LAN ケーブルを引いている人は詳細設定で足せる。
 */
export const CATEGORY_DEFAULT_PORT_STATE: Partial<Record<GadgetCategory, PortState>> = {
  PC:              { usbc_video: 1, usba: 2, hdmi: 1, bt: true },
  Monitor:         { hdmi_in: 2, dp_in: 1 },
  TV:              { hdmi_in: 3 },
  Projector:       { hdmi_in: 1 },
  Dock:            { usbc_pd_host: 1, hdmi_out: 1, usba_out: 3, usbc_out: 1, sd: true },
  Hub:             { usbc_host: 1, usba_out: 3, hdmi_out: 1 },
  Microphone:      { usbc: true },
  Webcam:          { usba: true },
  Camera:          { hdmi_out: true, usbc: true, sd: true },
  Storage:         { usbc: true },
  GameConsole:     { hdmi_out: 1, usba_out: 2, bt: true },
  CaptureDevice:   { hdmi_in: 1, hdmi_out: true, usbc_out: true },
  StreamingDevice: { hdmi_out: true, usbc: true, wifi: true },
  KVM:             { hdmi_in: 2, hdmi_out: 1, usb_in: 2, usb_out: 4 },
  Router:          { eth_wan: true, eth_lan: 4, wifi: true },
  NetworkSwitch:   { eth_lan: 4 },
  Printer:         { wifi: true },
  Printer3D:       { microsd: true },
  PenTablet:       { usbc: true },
  AudioInterface:  { usbc: true, combo_in: 2, trs_out: 2, phones_out: 1 },
  HeadphoneAmp:    { usbc: true, phones_out: true, rca_out: 1 },
  Amplifier:       { rca_in: 2, sp_out: 2, optical_in: 1 },
  Mixer:           { combo_in: 4, xlr_out: 2, usbc: true, phones_out: 1 },
  MobileBattery:   { usbc_io: 1, usba_out: 1 },
  UPS:             { power_out: 6 },
  SmartHome:       { wifi: true },
  Smartphone:      { usbc_in: true },
  Tablet:          { usbc_in: true, stylus: true },
  Instrument:      { usbc: true, audio_out: 1 },
  SmallDevice:     { usbc_in: true },
  MonitorArm:      { supports: 1 },
  MicArm:          { supports: 1 },
  Modem:           { eth_out: 1 },
  VRGlass:         { usbc_in: true },
  Smartwatch:      { magnetic_c: true },
}

/** ジャンルだけ決まった状態のポートフォーム初期値 */
export function categoryDefaultPortState(category: GadgetCategory): PortState {
  const state = defaultPortState(CATEGORY_PORT_CONFIG[category] ?? [])
  const defaults = CATEGORY_DEFAULT_PORT_STATE[category]
  if (!defaults) return state
  for (const [key, value] of Object.entries(defaults)) {
    if (key in state) state[key] = value
  }
  return state
}

/**
 * ポート構成がカテゴリ既定のままか。商品DBの端子でも手入力でもない推定値の判定に使う。
 * 推定のまま保存されたガジェットは portsNeedConfirmation を立てて、
 * 実物と違う配線図がそのまま共有されないようにする。
 */
export function isCategoryDefaultPortState(category: GadgetCategory, state: PortState): boolean {
  const defaults = CATEGORY_DEFAULT_PORT_STATE[category]
  if (!defaults) return false
  const base = categoryDefaultPortState(category)
  return Object.keys(base).every((key) => state[key] === base[key])
}
