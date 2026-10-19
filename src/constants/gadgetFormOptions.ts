// ガジェットのフォームで選ぶ電源・ケーブルの選択肢。
// 詳細（GadgetDetailScreen）と部品（PowerInputFields）が同じ並びを出す。追加画面にも同じ配列を
// 書いていた頃は、片方にだけ足した選択肢が画面によって出たり出なかったりした。
//
// ポートの口の定義（portFormConfig.ts）とは分ける。あちらに書いた文字列は
// ガジェットに保存されるポートのラベルとして扱われ、英訳の突き合わせ
// （tests/portLabelTranslations.test.ts）の対象になる。ここのラベルは表示だけのもの。
import { CableType, GadgetCategory } from '../types'
import type { PowerInput, PowerUsage } from '../utils/gadgetPorts'
import { MCIconName } from './icons'

/** 電源の取り方。from → to のアイコンで「どこから来るか」を絵で示す */
export const POWER_INPUT_OPTIONS: { key: PowerInput; label: (lang: 'ja' | 'en') => string; from: MCIconName; to: MCIconName | null; arrow: boolean }[] = [
  { key: 'none',     label: (l) => l === 'en' ? 'None' : 'なし',             from: 'cancel',                to: null,            arrow: false },
  { key: 'outlet',   label: (l) => l === 'en' ? 'From Outlet' : 'コンセントから', from: 'power-socket-jp',       to: 'cube-outline',  arrow: true },
  { key: 'dc',       label: (l) => l === 'en' ? 'DC Adapter' : 'DCアダプター',    from: 'power-plug',            to: 'cube-outline',  arrow: true },
  { key: 'from_a',   label: (l) => l === 'en' ? 'From A' : 'Aから',           from: 'usb-port',               to: 'cube-outline',  arrow: true },
  { key: 'from_c',   label: (l) => l === 'en' ? 'From C' : 'Cから',           from: 'usb-c-port',             to: 'cube-outline',  arrow: true },
  { key: 'wireless', label: (l) => l === 'en' ? 'Wireless' : 'ワイヤレス',      from: 'lightning-bolt-circle',  to: 'cube-outline',  arrow: true },
  { key: 'solar',    label: (l) => l === 'en' ? 'Solar Panel' : 'ソーラーパネル', from: 'solar-power',            to: 'cube-outline',  arrow: true },
  { key: 'battery',  label: (l) => l === 'en' ? 'Battery' : '電池・バッテリー',  from: 'battery',                to: 'cube-outline',  arrow: true },
]

/** ワイヤレス給電を選べるカテゴリ（配線図の WIRELESS_CAPABLE と同期）。これ以外では選択肢自体を出さない */
export const WIRELESS_POWER_CAPABLE: GadgetCategory[] = ['Smartphone', 'Tablet', 'Smartwatch', 'Headphone', 'Earphone', 'Mouse', 'SmallDevice', 'Accessory']

export const POWER_USAGE_OPTIONS: { key: PowerUsage; ja: string; en: string; icon: MCIconName }[] = [
  { key: 'continuous', ja: '常時給電', en: 'Always connected', icon: 'power-plug-outline' },
  { key: 'rechargeable', ja: '充電式（内蔵）', en: 'Built-in battery', icon: 'battery-charging-outline' },
  { key: 'replaceable', ja: '電池式（交換）', en: 'Replaceable battery', icon: 'battery-outline' },
]

/**
 * ケーブルの種類の選択肢。表示名は portTypes の cableLabel から引くので、ここは値だけ持つ。
 * 選択肢の側にもラベルを書いていた頃は、2画面で 'Audio 6.3mm' と 'Audio 6.3mm TRS' に
 * 食い違ったまま、どちらも画面には出ない死んだ文字列になっていた
 */
export const CABLE_TYPE_OPTIONS: CableType[] = [
  'USB_C', 'USB_A_to_C', 'USB_A_to_B', 'USB_C_to_B',
  'USB_A_to_microUSB', 'USB_C_to_microUSB', 'USB_A_to_Lightning', 'USB_C_to_Lightning',
  'Thunderbolt', 'HDMI', 'DisplayPort', 'MiniDisplayPort',
  'MiniDisplayPort_to_DisplayPort', 'USB_C_to_DisplayPort', 'USB_C_to_HDMI', 'DisplayPort_to_HDMI',
  'HDMI_to_DisplayPort', 'HDMI_to_DVI', 'DVI', 'VGA',
  'Ethernet', 'Power', 'DCPower', 'Audio3_5mm',
  'Audio6_3mm', 'Audio6_3mm_TS', 'XLR_TRS_Combo', 'RCA',
  'Audio3_5_to_6_3', 'RCA_to_3_5mm', 'RCA_to_6_3mm', 'OpticalAudio',
  'XLR', 'MIDI',
]

