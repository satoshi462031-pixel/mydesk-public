import { Gadget, GadgetCategory, Port } from '../types'
import type { ShopId } from '../types/product'
import { CATEGORY_LABELS } from '../constants/categoryLabels'
import { matchesSearchTerms, normalizeGadgetSearch, searchTerms } from './gadgetSearch'

// gadgetPresets は数千行の商品リスト。トップレベルで import すると、この関数を
// 一度も呼ばない起動でも全プリセットの生成コストがかかる。予測変換が最初に
// 引かれるまで評価を遅らせる（Metro の同期 require なので呼び出し側は同期のまま）。
type PresetsModule = typeof import('../constants/gadgetPresets')
let presetsModule: PresetsModule | null = null
const presets = (): PresetsModule => (presetsModule ??= require('../constants/gadgetPresets'))

export type ProductSuggestion = {
  name: string
  brand?: string
  productName?: string
  /** 商品DBに登録されている一覧用の商品画像 */
  image?: string
  /** 商品DB（products.id）由来の候補ならセットされる。購入リンクの参照に使う */
  productId?: string
  ports?: Port[]
  affiliateUrl?: string
  officialUrl?: string
  /** 商品一覧で取得できた代表ショップ。購入リンクの表示元を明示するために使う。 */
  shop?: ShopId
  /** 商品DB由来の参考価格（円）。取り込み時点のスナップショットなので実売とはズレる */
  priceJpy?: number
  batteryCapacityMah?: string
  batteryCapacityWh?: string
  supportsPassThroughCharging?: boolean
  /** プリセットが明示している給電の使われ方。無ければポート構成から推定する */
  powerUsage?: Gadget['powerUsage']
  pcFormFactor?: Gadget['pcFormFactor']
  isHeightAdjustable?: boolean
  deskLiftType?: Gadget['deskLiftType']
  deskHeightMin?: string
  deskHeightMax?: string
  /** カテゴリを決めずに探したとき（登録画面の検索）に、候補がどのカテゴリの商品か */
  category?: GadgetCategory
}

/** カテゴリを問わずにプリセットを探す。登録画面はカテゴリより先に商品名を打たせる */
export function getProductSuggestionsAnyCategory(
  query: string,
  lang: 'ja' | 'en',
  limit = 5,
): ProductSuggestion[] {
  const q = searchTerms(normalizeGadgetSearch(query)).join(' ')
  if (!q) return []
  const found = (Object.keys(CATEGORY_LABELS) as GadgetCategory[]).flatMap((category) =>
    getProductSuggestions(category, query, lang, limit).map((suggestion) => ({ ...suggestion, category })),
  )
  // カテゴリ順のままだと、打った語で始まる商品が後ろのカテゴリに埋もれる
  const prefix = (s: ProductSuggestion) => (normalizeGadgetSearch(s.name).startsWith(q) ? 0 : 1)
  return found
    .map((suggestion, index) => ({ suggestion, index }))
    .sort((a, b) => prefix(a.suggestion) - prefix(b.suggestion) || a.index - b.index)
    .slice(0, limit)
    .map(({ suggestion }) => suggestion)
}

export function getProductSuggestions(
  category: GadgetCategory,
  query: string,
  lang: 'ja' | 'en',
  limit = 5,
): ProductSuggestion[] {
  if (category === 'Other') return []
  const {
    AUDIO_INTERFACE_PRESETS, CABLE_PRESETS, CHAIR_PRESETS, CHARGER_PRESETS,
    CONTROLLER_PRESETS, DESK_PRESETS, EARPHONE_PRESETS, GADGET_PRESETS,
    HEADPHONE_PRESETS, HEADPHONE_AMP_PRESETS, AMPLIFIER_PRESETS, PASSIVE_SPEAKER_PRESETS,
    INSTRUMENT_PRESETS, MIXER_PRESETS,
    MOBILE_BATTERY_PRESETS, MIC_ARM_PRESETS, MODEM_PRESETS, MONITOR_ARM_PRESETS,
    PC_DESKTOP_SUGGESTIONS, PC_LAPTOP_SUGGESTIONS, SMART_HOME_PRESETS,
    SMARTPHONE_PRESETS, SMARTWATCH_PRESETS, STYLUS_ACCESSORY_PRESETS,
    TABLET_PRESETS, VR_GLASS_PRESETS, WALL_PANEL_PRESETS,
  } = presets()
  const extraPools: Partial<Record<GadgetCategory, ProductSuggestion[]>> = {
    CaptureDevice: GADGET_PRESETS.filter((p) => p.category === 'CaptureDevice'),
    // 並び順はプリセット側の suggestionPriority で決める。ここで商品名を
    // 突き合わせると、名前を直した時点で静かに効かなくなる
    GameConsole: GADGET_PRESETS.filter((p) => p.category === 'GameConsole')
      .sort((a, b) => (a.suggestionPriority ?? Number.MAX_SAFE_INTEGER) - (b.suggestionPriority ?? Number.MAX_SAFE_INTEGER)),
    AudioInterface: AUDIO_INTERFACE_PRESETS,
    Cable: CABLE_PRESETS,
    Chair: CHAIR_PRESETS,
    Charger: CHARGER_PRESETS,
    Controller: CONTROLLER_PRESETS,
    Desk: DESK_PRESETS,
    Headphone: HEADPHONE_PRESETS,
    HeadphoneAmp: HEADPHONE_AMP_PRESETS,
    Amplifier: AMPLIFIER_PRESETS,
    // パッシブスピーカーは商品リストが別なので、アクティブ側の候補と束ねて出す
    Speaker: [...PASSIVE_SPEAKER_PRESETS, ...GADGET_PRESETS.filter((p) => p.category === 'Speaker')],
    Earphone: EARPHONE_PRESETS,
    Instrument: INSTRUMENT_PRESETS,
    Mixer: MIXER_PRESETS,
    MobileBattery: MOBILE_BATTERY_PRESETS,
    MonitorArm: MONITOR_ARM_PRESETS,
    MicArm: MIC_ARM_PRESETS,
    Modem: MODEM_PRESETS,
    PC: [{ name: lang === 'en' ? 'Custom PC' : '自作PC' }, ...PC_LAPTOP_SUGGESTIONS, ...PC_DESKTOP_SUGGESTIONS],
    SmartHome: SMART_HOME_PRESETS,
    Smartphone: SMARTPHONE_PRESETS,
    Smartwatch: SMARTWATCH_PRESETS,
    Accessory: STYLUS_ACCESSORY_PRESETS,
    Tablet: TABLET_PRESETS,
    VRGlass: VR_GLASS_PRESETS,
    WallPanel: WALL_PANEL_PRESETS,
  }
  const pool = extraPools[category] ?? GADGET_PRESETS.filter((p) => p.category === category)
  // 全角英数・空白や改行の混ざり・語の順番を問わず当てる（マイガジェットの検索と同じ）
  const terms = searchTerms(normalizeGadgetSearch(query))
  const customPcName = lang === 'en' ? 'Custom PC' : '自作PC'
  const pinned = pool.filter((p) => p.name === customPcName)
  const rest = pool.filter((p) => p.name !== customPcName)
  const matches = (p: ProductSuggestion) => terms.length === 0 || matchesSearchTerms(normalizeGadgetSearch(p.name), terms)
  return [...pinned.filter(matches), ...rest.filter(matches)].slice(0, limit)
}
