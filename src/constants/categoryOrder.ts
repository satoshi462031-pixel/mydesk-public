import AsyncStorage from '@react-native-async-storage/async-storage'
import { GadgetCategory } from '../types'

export const CATEGORY_SECTIONS = [
  { title: 'PC・モニター',      titleEn: 'PC & Monitor',    cats: ['PC', 'Monitor', 'TV', 'Projector', 'MonitorArm', 'Hub', 'Dock', 'Storage', 'PCPart', 'KVM', 'CaptureDevice', 'StreamingDevice'] },
  { title: 'ゲーム・VR',        titleEn: 'Gaming & VR',     cats: ['GameConsole', 'Controller', 'VRGlass'] },
  { title: 'ネットワーク・電源', titleEn: 'Network & Power', cats: ['Router', 'NetworkSwitch', 'Modem', 'Charger', 'MobileBattery', 'PowerStrip', 'UPS', 'Cable'] },
  { title: 'スマートデバイス',  titleEn: 'Smart Devices',   cats: ['Smartphone', 'Tablet', 'Smartwatch'] },
  { title: '周辺機器',          titleEn: 'Peripherals',     cats: ['Mouse', 'MousePad', 'Keyboard', 'PenTablet', 'Webcam', 'Camera', 'Lens', 'Tripod', 'Printer', 'Printer3D'] },
  { title: 'オーディオ',        titleEn: 'Audio',           cats: ['Headphone', 'Earphone', 'Speaker', 'Microphone', 'MicArm', 'AudioInterface', 'HeadphoneAmp', 'Amplifier', 'Mixer', 'Instrument'] },
  { title: 'デスク環境・照明',  titleEn: 'Desk & Lighting', cats: ['Desk', 'Chair', 'Furniture', 'Light', 'WallPanel', 'DeskPad', 'SmartHome'] },
  { title: 'その他',            titleEn: 'Other',           cats: ['SmallDevice', 'Accessory', 'Plant', 'Other'] },
] as const satisfies readonly { title: string; titleEn: string; cats: readonly GadgetCategory[] }[]

export const CATEGORY_SELECTION_ORDER = CATEGORY_SECTIONS.flatMap((section) => section.cats)

// 一般ユーザーが使う頻度が低いカテゴリ。選択モーダルでは既定で「詳細・専門機器」枠に畳む。
// ユーザーが枠の出し入れを編集できるので、これはあくまで初期値。
// 非破壊：登録済みガジェットの category 値には影響しない（表示の折りたたみだけ）。
export const DEFAULT_ADVANCED_CATEGORIES: readonly GadgetCategory[] = [
  'PCPart', 'KVM', 'CaptureDevice',
  'MicArm', 'HeadphoneAmp', 'Amplifier', 'Mixer', 'Instrument',
  'PenTablet', 'Camera', 'Lens', 'Tripod', 'Printer3D',
  'NetworkSwitch', 'Modem', 'UPS',
  'WallPanel', 'DeskPad', 'SmallDevice', 'Plant',
]

export const ADVANCED_CATEGORIES_KEY = '@advanced_categories'
export const ADVANCED_CATEGORIES_VERSION_KEY = '@advanced_categories_version'
export const ADVANCED_CATEGORIES_VERSION = '2'

/** 保存済みの「詳細・専門機器」枠。未保存なら既定。空配列（全部出した状態）も有効な保存値 */
export function parseAdvancedCategories(raw: string | null): GadgetCategory[] {
  if (raw == null) return [...DEFAULT_ADVANCED_CATEGORIES]
  try {
    const saved = JSON.parse(raw) as GadgetCategory[]
    if (!Array.isArray(saved)) return [...DEFAULT_ADVANCED_CATEGORIES]
    return saved.filter((c) => DEFAULT_CATEGORY_ORDER.includes(c))
  } catch {
    return [...DEFAULT_ADVANCED_CATEGORIES]
  }
}

export async function saveAdvancedCategories(cats: Iterable<GadgetCategory>): Promise<void> {
  await AsyncStorage.multiSet([
    [ADVANCED_CATEGORIES_KEY, JSON.stringify([...cats])],
    [ADVANCED_CATEGORIES_VERSION_KEY, ADVANCED_CATEGORIES_VERSION],
  ])
}

type AssertNever<T extends never> = T
type CategoryInSections = typeof CATEGORY_SECTIONS[number]['cats'][number]
export type CategorySectionsMissing = AssertNever<Exclude<GadgetCategory, CategoryInSections>>

// カテゴリの基準となる並び順。
// 以前はユーザーが並び替えて保存できたが、その画面ごと無くなっている
// （@category_order を読み書きする箇所は無い）。今は既定値の定義としてだけ使う。

const DEFAULT_CATEGORY_ORDER_VALUES = [
  'PC', 'Monitor', 'TV', 'Projector', 'MonitorArm', 'Hub', 'Dock', 'Storage', 'PCPart', 'KVM', 'CaptureDevice', 'StreamingDevice',
  'GameConsole', 'Controller', 'VRGlass',
  'Router', 'NetworkSwitch', 'Modem', 'Charger', 'MobileBattery', 'PowerStrip', 'UPS', 'Cable',
  'Smartphone', 'Tablet', 'Smartwatch',
  'Mouse', 'MousePad', 'Keyboard', 'PenTablet', 'Webcam', 'Camera', 'Lens', 'Tripod', 'Printer', 'Printer3D',
  'Headphone', 'Earphone', 'Speaker', 'Microphone', 'MicArm', 'AudioInterface', 'HeadphoneAmp', 'Amplifier', 'Mixer', 'Instrument',
  'Desk', 'Chair', 'Furniture', 'Light', 'WallPanel', 'DeskPad', 'SmartHome',
  'SmallDevice', 'Accessory', 'Plant', 'Other',
] as const satisfies readonly GadgetCategory[]

export type DefaultCategoryOrderMissing = AssertNever<
  Exclude<GadgetCategory, typeof DEFAULT_CATEGORY_ORDER_VALUES[number]>
>
export const DEFAULT_CATEGORY_ORDER: GadgetCategory[] = [...DEFAULT_CATEGORY_ORDER_VALUES]

// カテゴリ表示（配線結果・公開デスク）で畳んでおくジャンル。
// 全デスク共通の好みとして保持し、次にカテゴリ表示を開いたとき同じ畳み方を復元する。
export const COLLAPSED_CATEGORIES_KEY = '@collapsed_categories'

/** 畳んでおくジャンル。未保存なら null（呼び出し側で既定＝全畳みにする） */
export async function loadCollapsedCategories(): Promise<GadgetCategory[] | null> {
  try {
    const raw = await AsyncStorage.getItem(COLLAPSED_CATEGORIES_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as GadgetCategory[]
    return saved.filter((c) => DEFAULT_CATEGORY_ORDER.includes(c))
  } catch {
    return null
  }
}

export async function saveCollapsedCategories(cats: Iterable<GadgetCategory>): Promise<void> {
  await AsyncStorage.setItem(COLLAPSED_CATEGORIES_KEY, JSON.stringify([...cats]))
}
