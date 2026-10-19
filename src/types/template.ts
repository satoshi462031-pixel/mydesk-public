import { CableType, CustomCategory, DeskZone, GadgetCategory, PlanPurpose } from './index'
import { MCIconName } from '../constants/icons'

// ─── デスクテンプレート（型テンプレート）───────────────────────────
//
// テンプレートは「デスク構成の型」であり、商品情報（商品名・メーカー・価格）
// は一切持たない。持つのはカテゴリ構成・初期レイアウト・推奨配線構造のみ。
// 適用時にカテゴリごとの未選択ガジェット（isPlaceholder）を生成し、
// ユーザーが自分の商品へ置き換えていく。

/** テンプレートの1枠 = 配置するガジェットカテゴリ */
export interface TemplateSlot {
  category: GadgetCategory
  /** 同カテゴリを複数配置する場合（モニター×2 など）。省略時 1 */
  count?: number
  /** 初期レイアウト（配線図・配置の初期ゾーン） */
  zone?: DeskZone
  /** 表示名の上書き（例: メインモニター）。省略時はカテゴリ名 */
  labelJa?: string
  labelEn?: string
  /**
   * このガジェットの給電方法。省略時はカテゴリの既定（多くはコンセント）。
   * 'usb_c' にすると USB-C 給電（充電器・モバイルバッテリーから受電）になる。
   */
  powerInput?: 'outlet' | 'usb_c' | 'wireless' | 'none'
  /** PC スロットの形状。'laptop' なら配線図で横長のシルエットになる */
  pcFormFactor?: 'desktop' | 'laptop' | 'mini'
  monitorArmIndex?: number | null
  micArmIndex?: number | null
  armHolds?: number
  /** 自作ジャンルの枠。category は 'Other' */
  custom?: CustomCategory
}

/**
 * 推奨配線構造。fromSlot / toSlot は slots 配列の index。
 * MVP ではデータとして保持のみ（実際の配線は既存の generateWiring が
 * プレースホルダーの標準ポートから自動生成する）。
 */
export interface TemplateWiringHint {
  fromSlot: number
  toSlot: number
  cableType?: CableType
}

/** 将来拡張: テンプレートの提供元 */
export type TemplateSource = 'official' | 'seasonal' | 'popular' | 'ai' | 'user' | 'creator'

export interface DeskTemplate {
  id: string
  nameJa: string
  nameEn: string
  descJa: string
  descEn: string
  /** サムネイル（MDI アイコン名 + テーマ色。画像アセットは持たない） */
  icon: MCIconName
  color: string
  /** カテゴリ構成 */
  slots: TemplateSlot[]
  /** 推奨配線構造（任意） */
  wiringHints?: TemplateWiringHint[]
  /** 適用時にプランへ設定する利用目的（任意） */
  purposes?: PlanPurpose[]
  /**
   * テンプレートに充電器を1台追加する共通ルールを無効にする。
   * 既定は1台追加し、USB-C / USB-Aポート数は適用時にユーザーが指定する。
   */
  autoCharger?: boolean
  /** 有線／無線を選べるカテゴリの既定値（未指定は 'wired'） */
  defaultConnType?: 'wired' | 'wireless'
  // ─── 将来拡張フィールド ───
  source?: TemplateSource
  /** 季節限定: 表示期間（ISO8601）。省略時は常時表示 */
  availableFrom?: string
  availableTo?: string
  /** 人気テンプレート表示用 */
  popularity?: number
  sortOrder?: number
}
