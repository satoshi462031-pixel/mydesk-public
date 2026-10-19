import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Localization from 'expo-localization'
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Appearance, useColorScheme } from 'react-native'
import { ACCENT_PRESETS, AccentKey } from '../constants/accentColors'
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../constants/categoryLabels'
import {
  ADVANCED_CATEGORIES_KEY,
  ADVANCED_CATEGORIES_VERSION,
  ADVANCED_CATEGORIES_VERSION_KEY,
  DEFAULT_ADVANCED_CATEGORIES,
  parseAdvancedCategories,
  saveAdvancedCategories,
} from '../constants/categoryOrder'
import { GadgetCategory } from '../types'
import { saveAppearancePreferences, subscribeAppearancePreferences, ThemeMode, AppearancePreferences } from '../store/appearanceStore'
import { TimelineGrain } from '../utils/deskTimeline'
import { isPlaybackSpeed, PlaybackSpeed } from '../hooks/useHistoryPlayback'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'
import { timeoutFetch } from '../utils/timeoutFetch'

// ─── Exchange Rate ─────────────────────────────────────────────────────────

const RATE_CACHE_KEY = 'exchange_rate_jpy_usd'
const RATE_TTL = 60 * 60 * 1000

// 通信失敗かつキャッシュ皆無のときの最終手段（1 JPY ≒ 0.0064 USD）。
// レートが取れないまま $ 入力を「円」として保存すると 150 倍ずれた金額が
// 永続化されるため、多少古いレートでも必ず換算できる値を用意しておく。
const FALLBACK_USD_RATE = 0.0064

async function fetchUsdRate(): Promise<number | null> {
  let stale: number | null = null
  try {
    const cached = await withTimeout(AsyncStorage.getItem(RATE_CACHE_KEY), STORAGE_TIMEOUT_MS)
    if (cached) {
      const { value, ts } = JSON.parse(cached)
      const validValue = typeof value === 'number' && Number.isFinite(value) && value > 0
      const validTimestamp = typeof ts === 'number' && Number.isFinite(ts)
      if (validValue && validTimestamp && Date.now() - ts < RATE_TTL) return value
      stale = validValue ? value : null   // 期限切れでも通信失敗時のフォールバックに使う
    }
    const res  = await timeoutFetch('https://api.frankfurter.app/latest?from=JPY&to=USD')
    const json = await res.json()
    const r: number = json?.rates?.USD
    if (Number.isFinite(r) && r > 0) {
      await withTimeout(AsyncStorage.setItem(RATE_CACHE_KEY, JSON.stringify({ value: r, ts: Date.now() })), STORAGE_TIMEOUT_MS)
      return r
    }
  } catch {}
  return stale
}

// ─── Color Tokens ────────────────────────────────────────────

// 正本は constants/colors.ts。ここから読んでいた既存の import を壊さないよう再輸出する
import { AppColors, buildColors, accentIconColor } from '../constants/colors'
export { buildColors }
export type { AppColors }

// ─── Translations ──────────────────────────────────────────────────────────

export type Lang = 'ja' | 'en'
export type { ThemeMode } from '../store/appearanceStore'

// カテゴリ名の正本は categoryLabels.ts。ここに書き写すと、同じカテゴリが
// 画面ごとに違う名前で出る（実際に「ライト」「ライト・照明」等がずれていた）。
type CategoryKeys<T> = { [K in Extract<keyof T, string> as `category.${K}`]: string }
const categoryKeys = <T extends Record<string, string>>(labels: T): CategoryKeys<T> =>
  Object.fromEntries(Object.entries(labels).map(([key, label]) => [`category.${key}`, label])) as CategoryKeys<T>

const TRANS = {
  ja: {
    ...categoryKeys(CATEGORY_LABELS),
    // Tabs
    'tab.gadgets': 'ガジェット',
    'tab.plan': 'マイデスク',
    'tab.feed': 'みんなのデスク',
    'tab.mypage': 'マイページ',

    // Common
    'common.cancel': 'キャンセル',
    'common.delete': '削除',
    'common.edit': '編集',
    'common.close': '閉じる',

    // GadgetLibrary
    'gadgetLib.emptyTitle': 'ガジェットがまだありません',
    'gadgetLib.emptyDesc': 'お使いのガジェットを登録して、マイデスクを作りましょう',
    'gadgetLib.addFirst': '＋ 最初のガジェットを追加',
    'gadgetLib.noMatch': '該当なし',

    // AddGadget
    'addGadget.productName': '商品名 *',
    'addGadget.price': '購入金額（円）',
    'addGadget.pricePlaceholder': '例：198000',
    'addGadget.portConfig': 'ポート構成',
    'addGadget.addBtn': '追加する',
    'addGadget.nameRequired': '商品名を入力してください',

    // GadgetDetail
    'gadgetDetail.name': '商品名 *',
    'gadgetDetail.portConfig': 'ポート構成',
    'gadgetDetail.price': '購入金額（円）',
    'gadgetDetail.pricePlaceholder': '例：198000',
    'gadgetDetail.save': '保存',
    'gadgetDetail.nameRequired': '商品名を入力してください',

    // PlanList
    'planList.gadgets': 'ガジェット',
    'planList.cables': 'ケーブル',
    'planList.notGenerated': '未生成',
    'planList.continue': '続きから →',
    'planList.emptyTitle': 'デスクがまだありません',
    'planList.emptyDesc': '今のデスクを登録すると、写真と機材ごと共有できます',
    'planList.createFirst': 'デスクを作る',
    'planList.exploreFirst': 'みんなのデスクを見る',

    // GadgetSelection
    'gadgetSel.hint': '今回使用するガジェットにチェックを付けてください',
    'gadgetSel.selectAll': 'すべてを選択',
    'gadgetSel.deselectAll': 'すべて解除',
    'gadgetSel.emptyText': 'ガジェットがまだ登録されていません。\nこのデスクで使うものを登録してください。',
    'gadgetSel.selectedCount': '{{n}}台選択中',
    'gadgetSel.nextBtn': '配置を決める →',


    // WiringResult
    // デスク詳細のケーブル節。自動計算の「必要本数」ではなく、ユーザーが商品として
    // 登録した本数を出す節なので、デスク一覧のバッジ（planList.cables）と語を分ける
    'wiringResult.registeredCables': '登録ケーブル',
    'wiringResult.requiredCables': '必要なケーブル',
    'wiringResult.chargingCables': '充電のときだけ挿すぶん',
    'wiringResult.findCable': '探す',
    // 配線タブを開いた直後に一度だけ出す断り。自動生成である以上、端子情報が
    // 正しくても実物と食い違うことがある。直せる場所（線のタップ）まで1行で示す。
    // Toast は2行までなので、これより長くすると末尾が切れる
    'wiringResult.mapDisclaimer': 'この配線図は間違っていることがあります。実物と違うところは線をタップして直せます',
    'wiringResult.warnings': '警告',

    // WiringDiagram section headers

    // PlanList
    'planList.duplicate': '複製',
    'planList.rename': '名前を変更',
    'planList.pin': 'ピン留め',
    'planList.unpin': '解除',
    'planList.pinned': 'ピン留め中',
    'planList.tabShared': '共有',
    'planList.urlInvalid': 'URL が正しくありません',
    'planList.urlInvalidMsg': '共有リンクを貼り付けてください。',


    // GadgetSelection
    'gadgetSel.wallOutlet': '壁コンセント口数',

    // GadgetLibrary extra

    // WiringResult sort
    'wiringResult.sortManual': '好きな順番',
    'wiringResult.sortCreatedAt': '登録順',
    'wiringResult.sortPurchasedAt': '購入順',
    'wiringResult.sortName': '商品名順',
    'wiringResult.sortCategory': 'ジャンル順',
    'wiringResult.sortPriceDesc': '高い順',
    'wiringResult.sortPriceAsc': '安い順',

    // WiringResult labels
    'wiringResult.catBreakdown': 'ジャンル別金額',
    'wiringResult.itemCount': '{{n}}台',
    'wiringResult.total': '合計',
    'wiringResult.updatedAt': '更新日：',

    // Settings plan modal

    // Common additions
    'common.done': '完了',
    'common.search': '検索…',

    // アイコンだけのボタンの読み上げラベル（画面に文字が出ないものにだけ付ける）
    'a11y.back': '戻る',
    'a11y.clearInput': '入力をクリア',
    'a11y.clearSearch': '検索をクリア',
    'a11y.clearDate': '日付をクリア',
    'a11y.pickDate': '日付を選ぶ',
    'a11y.decrease': '減らす',
    'a11y.increase': '増やす',
    'a11y.addGadget': 'ガジェットを追加',
    'a11y.newDesk': '新しいデスクを作る',
    'a11y.deskMenu': 'デスクの操作',
    'a11y.hasUnreadUpdates': '未読の更新あり',
    'a11y.renameDesk': 'デスク名を変更',
    'a11y.pinOn': 'ピン留めする',
    'a11y.pinOff': 'ピン留めを外す',
    'a11y.shareDesk': 'デスクを共有',
    'a11y.removeItem': 'この項目を削除',

    // Purpose selection
    'purpose.selectHint': 'デスクの用途を選んでください',
    'purpose.nextBtn': '次へ（{{n}}件選択中）',
    'purpose.gaming': 'ゲーム',
    'purpose.gaming.desc': 'Nintendo Switch 2・PS5・ゲーミングPC',
    'purpose.work': '仕事',
    'purpose.work.desc': 'Web会議・ヘッドセット・集中作業',
    'purpose.dev': '開発・プログラミング',
    'purpose.dev.desc': 'ウルトラワイド・分割キーボード・複数PC',
    'purpose.creative': 'クリエイティブ',
    'purpose.creative.desc': '動画編集・デザイン・液タブ・外付けストレージ',
    'purpose.streaming': '配信・録画',
    'purpose.streaming.desc': 'カメラ・マイク・ライトで配信・録画',
    'purpose.study': '学習・勉強',
    'purpose.study.desc': 'デスクライト・ヘッドホンで集中学習',
    'purpose.music': '音楽・DTM',
    'purpose.music.desc': 'DTM・オーディオIF・マイクで宅録',
    'purpose.other': 'その他',
    'purpose.other.desc': '名前を付けて自由にカスタマイズ',


    // Statistics
    'stats.totalCost': 'デスク環境の総額',
    'stats.aggregated': '{{n}}台分を集計',
    'stats.noPriceNote': '（{{n}}台は金額未登録）',
    'stats.hint': '{{n}}台のガジェットに金額が未登録です',

    // Login



    // Category picker
    'catPicker.advanced': '詳細・専門機器',
    'catPicker.editHint': 'ジャンルをタップすると「詳細・専門機器」へ出し入れできます',
    'catPicker.reset': '既定に戻す',
    'catPicker.resetConfirm': 'ジャンルの振り分けを既定に戻しますか？',

    // Category labels
  },
  en: {
    ...categoryKeys(CATEGORY_LABELS_EN),
    // Tabs
    'tab.gadgets': 'Gadgets',
    'tab.plan': 'MyDesk',
    'tab.feed': 'Explore',
    'tab.mypage': 'My Page',

    // Common
    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.close': 'Close',

    // GadgetLibrary
    'gadgetLib.emptyTitle': 'No gadgets yet',
    'gadgetLib.emptyDesc': 'Register your gadgets to build your desk',
    'gadgetLib.addFirst': '+ Add First Gadget',
    'gadgetLib.noMatch': 'No results',

    // AddGadget
    'addGadget.productName': 'Product Name *',
    'addGadget.price': 'Purchase Price ($)',
    'addGadget.pricePlaceholder': 'e.g. 1299.99',
    'addGadget.portConfig': 'Port Configuration',
    'addGadget.addBtn': 'Add',
    'addGadget.nameRequired': 'Please enter a product name',

    // GadgetDetail
    'gadgetDetail.name': 'Product Name *',
    'gadgetDetail.portConfig': 'Port Configuration',
    'gadgetDetail.price': 'Purchase Price ($)',
    'gadgetDetail.pricePlaceholder': 'e.g. 1299.99',
    'gadgetDetail.save': 'Save',
    'gadgetDetail.nameRequired': 'Please enter a product name',

    // PlanList
    'planList.gadgets': 'Gadgets',
    'planList.cables': 'Cables',
    'planList.notGenerated': 'Not Generated',
    'planList.continue': 'Continue →',
    'planList.emptyTitle': 'No desks yet',
    'planList.emptyDesc': 'Add your current desk to share it with photos and all your gear',
    'planList.createFirst': 'Create a desk',
    'planList.exploreFirst': 'Browse Explore',

    // GadgetSelection
    'gadgetSel.hint': 'Check the gadgets you will use',
    'gadgetSel.selectAll': 'Select All',
    'gadgetSel.deselectAll': 'Deselect All',
    'gadgetSel.emptyText': 'No gadgets registered yet.\nAdd the ones you use on this desk.',
    'gadgetSel.selectedCount': '{{n}} selected',
    'gadgetSel.nextBtn': 'Set Layout →',


    // WiringResult
    'wiringResult.warnings': 'Warnings',

    // WiringDiagram section headers

    // PlanList
    'planList.duplicate': 'Copy',
    'planList.rename': 'Rename',
    'planList.pin': 'Pin',
    'planList.unpin': 'Unpin',
    'planList.pinned': 'Pinned',
    'planList.tabShared': 'Shared',
    'planList.urlInvalid': 'Invalid URL',
    'planList.urlInvalidMsg': 'Please paste a shared link.',


    // GadgetSelection
    'gadgetSel.wallOutlet': 'Wall Outlets',

    // GadgetLibrary extra

    // WiringResult sort
    'wiringResult.sortManual': 'Custom order',
    'wiringResult.sortCreatedAt': 'Added',
    'wiringResult.sortPurchasedAt': 'Purchased',
    'wiringResult.sortName': 'Name',
    'wiringResult.sortCategory': 'Category',
    'wiringResult.sortPriceDesc': 'Price ↓',
    'wiringResult.sortPriceAsc': 'Price ↑',

    // WiringResult labels
    'wiringResult.catBreakdown': 'By Category',
    'wiringResult.itemCount': 'Items: {{n}}',
    'wiringResult.total': 'Total',
    'wiringResult.registeredCables': 'Registered Cables',
    'wiringResult.requiredCables': 'Cables this wiring needs',
    'wiringResult.chargingCables': 'Only while charging',
    'wiringResult.findCable': 'Find',
    'wiringResult.mapDisclaimer': 'This diagram can be wrong. Tap a line to fix it.',
    'wiringResult.updatedAt': 'Updated: ',

    // Settings plan modal

    // Common additions
    'common.done': 'Done',
    'common.search': 'Search...',

    // Screen-reader labels for icon-only buttons
    'a11y.back': 'Back',
    'a11y.clearInput': 'Clear input',
    'a11y.clearSearch': 'Clear search',
    'a11y.clearDate': 'Clear date',
    'a11y.pickDate': 'Pick a date',
    'a11y.decrease': 'Decrease',
    'a11y.increase': 'Increase',
    'a11y.addGadget': 'Add gadget',
    'a11y.newDesk': 'Create a new desk',
    'a11y.deskMenu': 'Desk actions',
    'a11y.hasUnreadUpdates': 'Unread updates',
    'a11y.renameDesk': 'Rename desk',
    'a11y.pinOn': 'Pin desk',
    'a11y.pinOff': 'Unpin desk',
    'a11y.shareDesk': 'Share desk',
    'a11y.removeItem': 'Remove this item',

    // Purpose selection
    'purpose.selectHint': 'Select your purpose(s)',
    'purpose.nextBtn': 'Next ({{n}} selected)',
    'purpose.gaming': 'Gaming',
    'purpose.gaming.desc': 'Nintendo Switch 2, PS5 & gaming PC',
    'purpose.work': 'Remote Work',
    'purpose.work.desc': 'Web meetings, headset & focused work',
    'purpose.dev': 'Development',
    'purpose.dev.desc': 'Ultrawide, split keyboard & multiple PCs',
    'purpose.creative': 'Creative',
    'purpose.creative.desc': 'Video editing, design, pen tablet & storage',
    'purpose.streaming': 'Streaming / Recording',
    'purpose.streaming.desc': 'Camera, mic & lighting for streaming',
    'purpose.study': 'Study',
    'purpose.study.desc': 'Desk light & headphones for focused study',
    'purpose.music': 'Music / DAW',
    'purpose.music.desc': 'DAW, audio interface & home recording',
    'purpose.other': 'Other',
    'purpose.other.desc': 'Name it and customize freely',


    // Statistics
    'stats.totalCost': 'Total Desk Cost',
    'stats.aggregated': 'Items included: {{n}}',
    'stats.noPriceNote': ' ({{n}} without price)',
    'stats.hint': '{{n}} gadget(s) have no price',

    // Login



    // Category picker
    'catPicker.advanced': 'Advanced / Specialized',
    'catPicker.editHint': 'Tap a category to move it in or out of Advanced / Specialized',
    'catPicker.reset': 'Reset to default',
    'catPicker.resetConfirm': 'Reset category grouping to default?',

    // Category labels
  },
} satisfies Record<Lang, Record<string, string>>

// GadgetCategory を足したとき ja / en どちらかのラベルを入れ忘れると
// ここで型エラーになる（欠けたまま出荷すると英語UIに日本語が出る）。
// categoryOrder.ts の CategorySectionsMissing と同じ番人。
type AssertNever<T extends never> = T
export type TranslationKeysMissingInEnglish =
  AssertNever<Exclude<keyof typeof TRANS['ja'], keyof typeof TRANS['en']>>
export type TranslationKeysMissingInJapanese =
  AssertNever<Exclude<keyof typeof TRANS['en'], keyof typeof TRANS['ja']>>
type TranslatedCategoryKey = keyof typeof TRANS['ja'] & keyof typeof TRANS['en']
export type CategoryTranslationsMissing =
  AssertNever<Exclude<`category.${GadgetCategory}`, TranslatedCategoryKey>>

// ─── Context ───────────────────────────────────────────────────────────────

export type UnitSystem = 'metric' | 'imperial'

interface AppContextValue {
  isDark: boolean
  colors: AppColors
  lang: Lang
  themeMode: ThemeMode
  themeReady: boolean
  setThemeMode: (mode: ThemeMode) => Promise<void>
  setLang: (lang: Lang) => Promise<void>
  t: (key: string, vars?: Record<string, string | number>) => string
  accentKey: AccentKey
  setAccentKey: (key: AccentKey) => Promise<void>
  setAccentColorAllowed: (allowed: boolean) => void
  usdRate: number | null
  fmtPrice: (jpy: number | null | undefined) => string
  /** 保存済みの「円」を表示通貨の数値へ変換する（グラフの目盛り計算用） */
  displayAmount: (jpy: number) => number
  fmtPlanPrice: (jpyMonthly: number) => string
  /** 価格入力欄の文字列を保存用の「円」に変換する。空・不正値は undefined */
  parsePriceToJpy: (raw: string) => number | undefined
  /** 保存済みの「円」を価格入力欄に表示する文字列へ変換する（parsePriceToJpy の逆） */
  fmtPriceInput: (jpy: number | null | undefined) => string
  unitSystem: UnitSystem
  unitLabel: string
  setUnitSystem: (u: UnitSystem) => Promise<void>
  fmtDim: (cm: number) => string
  fmtDimStr: (dimStr: string | null | undefined) => string
  /**
   * 動きを抑えるか。端末の設定（iOS の「視差効果を減らす」）とアプリの設定の
   * どちらかが ON なら true。演出を出す側はこれだけを見る
   */
  reduceMotion: boolean
  /** アプリの設定そのもの。トグルの値に使う（端末側の ON でトグルが勝手に動かないように） */
  reduceMotionSetting: boolean
  /** 端末の設定が ON か。アプリ側が OFF でも動きが減っている理由を伝えるために出す */
  reduceMotionSystem: boolean
  setReduceMotion: (on: boolean) => Promise<void>
  /** 歴史アニメーションでガジェットを前日位置から当日位置へ滑らかに動かすか（OFF なら瞬時に配置） */
  historyNodeMorph: boolean
  setHistoryNodeMorph: (on: boolean) => Promise<void>
  /** 歴史アニメーションで導入・撤去をまとめる単位（日ごと／月ごと／年ごと） */
  historyGrain: TimelineGrain
  setHistoryGrain: (grain: TimelineGrain) => Promise<void>
  /** 歴史アニメーションの再生速度。プレイヤーを閉じても選んだ速度を保つ */
  historySpeed: PlaybackSpeed
  setHistorySpeed: (speed: PlaybackSpeed) => Promise<void>
  /** 歴史アニメーションで導入・撤去（±）の一覧を出すか。OFF なら配線図を全画面で見せる */
  historyShowInOut: boolean
  setHistoryShowInOut: (on: boolean) => Promise<void>
  /** 色に不透明度を付与（hex + opacity: 0-255） */
  withOpacity: (hexColor: string, opacity: number) => string
  /** カテゴリ選択で「詳細・専門機器」枠に畳むジャンル（ユーザーが編集できる） */
  advancedCategories: GadgetCategory[]
  isAdvancedCategory: (cat: GadgetCategory) => boolean
  toggleAdvancedCategory: (cat: GadgetCategory) => Promise<void>
  resetAdvancedCategories: () => Promise<void>
}

// ─── 端末ロケールからの初期値 ───────────────────────────────────
// 未設定のときだけ使う。設定画面で選ばれた値は app_language / app_unit に
// 入るので、そちらが読めた時点で上書きされる（端末の言語を変えても、
// ユーザーが明示的に選んだ設定を勝手に戻さないため）。

function deviceLang(): Lang {
  return Localization.getLocales()[0]?.languageCode === 'ja' ? 'ja' : 'en'
}

function deviceUnitSystem(): UnitSystem {
  return Localization.getLocales()[0]?.measurementSystem === 'us' ? 'imperial' : 'metric'
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme()
  const [themeMode, setThemeModeState]     = useState<ThemeMode>('system')
  const [themeReady, setThemeReady] = useState(false)
  const restoredAppearanceRef = useRef<AppearancePreferences>({})
  // 初期値は端末ロケール。保存済みの設定があれば下の useEffect が上書きする
  const [lang, setLangState]               = useState<Lang>(deviceLang)
  const [accentKey, setAccentKeyState]     = useState<AccentKey>('orange')
  const [accentColorAllowed, setAccentColorAllowed] = useState(true)
  const [unitSystem, setUnitSystemState]   = useState<UnitSystem>(deviceUnitSystem)
  const [usdRate, setUsdRate]              = useState<number | null>(null)
  const [reduceMotionSetting, setReduceMotionState] = useState<boolean>(false)
  // 端末設定が届く前に、抑止したい人へ起動演出を見せない。
  const [reduceMotionSystemValue, setReduceMotionSystem] = useState<boolean | null>(null)
  const [historyNodeMorph, setHistoryNodeMorphState] = useState<boolean>(true)
  // 既定は月ごと。日ごとは購入日が散るほどページが細切れになり、全体の変化を掴みにくい
  const [historyGrain, setHistoryGrainState] = useState<TimelineGrain>('month')
  const [historySpeed, setHistorySpeedState] = useState<PlaybackSpeed>(1)
  const [historyShowInOut, setHistoryShowInOutState] = useState<boolean>(true)
  const [advancedCategories, setAdvancedCategoriesState] = useState<GadgetCategory[]>(
    () => [...DEFAULT_ADVANCED_CATEGORIES],
  )
  const advancedCategoriesRef = useRef(advancedCategories)
  const advancedCategoriesSavedRef = useRef(advancedCategories)
  const advancedCategoriesWriteRef = useRef(Promise.resolve())
  const persistAdvancedCategories = useCallback((next: GadgetCategory[]) => {
    advancedCategoriesRef.current = next
    setAdvancedCategoriesState(next)
    const saving = advancedCategoriesWriteRef.current.then(async () => {
      await saveAdvancedCategories(next)
      advancedCategoriesSavedRef.current = next
    })
    advancedCategoriesWriteRef.current = saving.catch(() => {})
    return saving.catch((error: unknown) => {
      if (advancedCategoriesRef.current === next) {
        advancedCategoriesRef.current = advancedCategoriesSavedRef.current
        setAdvancedCategoriesState(advancedCategoriesSavedRef.current)
      }
      throw error
    })
  }, [])
  // 端末の「視差効果を減らす」。起動時に読み、以後は購読で追う（設定アプリで
  // 切り替えて戻った直後から効かせるため）。アプリ側の設定と OR で使うので、
  // 端末で切っている人はアプリ側を触らなくても演出が止まる
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (active) setReduceMotionSystem(on) })
      .catch(() => { if (active) setReduceMotionSystem(false) })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotionSystem)
    return () => { active = false; sub.remove() }
  }, [])

  useEffect(() => {
    const initialAdvanced = advancedCategoriesRef.current
    void (async () => {
      // ネイティブへの往復1回で全設定をまとめて読む（起動時間の短縮）
      const entries = await withTimeout(AsyncStorage.multiGet([
        'app_theme', 'app_language', 'app_accent', 'app_unit', 'app_reduce_motion', 'app_history_node_morph',
        'app_history_grain', 'app_history_speed', 'app_history_show_inout', ADVANCED_CATEGORIES_KEY,
        ADVANCED_CATEGORIES_VERSION_KEY,
      ]), STORAGE_TIMEOUT_MS)
      const [th, lg, ak, un, rm, hnm, hg, hs, hsi, adv, advVersion] = entries.map(([, v]) => v)
      const parsedAdvanced = parseAdvancedCategories(adv ?? null)
      const advanced = advVersion === ADVANCED_CATEGORIES_VERSION || parsedAdvanced.includes('DeskPad')
        ? parsedAdvanced
        : [...parsedAdvanced, 'DeskPad' as const]
      if (advancedCategoriesRef.current === initialAdvanced) {
        advancedCategoriesRef.current = advanced
        advancedCategoriesSavedRef.current = advanced
        setAdvancedCategoriesState(advanced)
        if (advVersion !== ADVANCED_CATEGORIES_VERSION) void persistAdvancedCategories(advanced).catch(() => {})
      }
      if (!restoredAppearanceRef.current.themeMode && (th === 'light' || th === 'dark' || th === 'system')) setThemeModeState(th)
      if (lg === 'ja' || lg === 'en') setLangState(lg)
      if (!restoredAppearanceRef.current.accentKey && ak && ACCENT_PRESETS.some(p => p.key === ak)) setAccentKeyState(ak as AccentKey)
      if (un === 'metric' || un === 'imperial') setUnitSystemState(un)
      if (rm === 'true' || rm === 'false') setReduceMotionState(rm === 'true')
      if (hnm === 'true' || hnm === 'false') setHistoryNodeMorphState(hnm === 'true')
      if (hg === 'day' || hg === 'month' || hg === 'year') setHistoryGrainState(hg)
      // プリセット以外の微調整した速度も復元する。
      const parsedSpeed = hs === null ? null : Number(hs)
      if (isPlaybackSpeed(parsedSpeed)) setHistorySpeedState(parsedSpeed)
      if (hsi === 'true' || hsi === 'false') setHistoryShowInOutState(hsi === 'true')
      // 為替レートは英語UI（$表示）でしか使わないため、日本語UIでは起動時に取得しない。
      // app_language は設定画面で選んだときにしか入らないので、未設定なら端末ロケールで判定する。
      // ここを保存値だけで見ると、英語端末の初回起動でレートを取りに行かず、
      // 固定レートのまま $ 入力を円へ換算して保存してしまう
      const effectiveLang: Lang = lg === 'ja' || lg === 'en' ? lg : deviceLang()
      if (effectiveLang === 'en') void fetchUsdRate().then(setUsdRate)
    })().catch(() => {}).finally(() => setThemeReady(true))
  }, [persistAdvancedCategories])

  useEffect(() => subscribeAppearancePreferences((preferences) => {
    // 起動時の読み取りより復旧が先に終わっても、遅い旧応答でテーマを巻き戻さない。
    restoredAppearanceRef.current = { ...restoredAppearanceRef.current, ...preferences }
    if (preferences.themeMode) setThemeModeState(preferences.themeMode)
    if (preferences.accentKey) setAccentKeyState(preferences.accentKey)
  }), [])

  const isDark  = themeMode === 'system' ? systemScheme === 'dark' : themeMode === 'dark'

  // アプリ内のテーマ設定を端末側の外観にも伝える。
  // ヘッダーとタブバーは JS ではなくネイティブが描いており、その明暗は端末の外観から決まる。
  // ここを合わせないと、端末がライトでアプリをダークにしている人の画面で、
  // 本文だけ黒くヘッダーが白い（iOS 26 ではガラスが明るいまま残る）状態になる。
  // 'system' のときは null を渡して端末の設定へ戻す
  useLayoutEffect(() => {
    // 保存値が未確定の間に端末の外観へ戻すと、再起動時にライト表示が混ざる。
    if (!themeReady) return
    // react-native-web の Appearance には無い。Web は動作確認にしか使わないが、無いと起動時に落ちる
    Appearance.setColorScheme?.(themeMode === 'system' ? null : themeMode)
  }, [themeMode, themeReady])

  const colors  = useMemo<AppColors>(() => {
    const preset = ACCENT_PRESETS.find(p => p.key === (accentColorAllowed ? accentKey : 'orange')) ?? ACCENT_PRESETS[0]
    return {
      ...buildColors(isDark),
      accent:     preset.color,
      accentIcon: accentIconColor(preset.color, isDark),
      accentText: isDark ? preset.textDark : preset.textLight,
      accentTextOnDark: preset.textDark,
      onAccent:   preset.onAccent,
    }
  }, [isDark, accentKey, accentColorAllowed])

  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode)
    await saveAppearancePreferences({ themeMode: mode })
  }, [])

  const setAccentKey = useCallback(async (key: AccentKey) => {
    setAccentKeyState(key)
    await saveAppearancePreferences({ accentKey: key })
  }, [])

  const fmtPrice = useCallback((jpy: number | null | undefined): string => {
    if (jpy == null || !Number.isFinite(jpy)) return '—'
    if (lang === 'en') {
      const usd = jpy * (usdRate ?? FALLBACK_USD_RATE)
      return usd >= 100
        ? `$${Math.round(usd).toLocaleString('en-US')}`
        : `$${usd.toFixed(2)}`
    }
    return `¥${jpy.toLocaleString('ja-JP')}`
  }, [lang, usdRate])

  // 保存済みの「円」を表示通貨の数値へ変換する。グラフの目盛りのように
  // 「文字列ではなく数値のまま表示通貨で扱いたい」箇所で使う（円のまま刻みを
  // 決めてから換算すると、$66.67 のような半端な目盛りになってしまう）
  const displayAmount = useCallback((jpy: number): number => (
    lang === 'en' ? jpy * (usdRate ?? FALLBACK_USD_RATE) : jpy
  ), [lang, usdRate])

  const fmtPlanPrice = useCallback((jpyMonthly: number): string => {
    if (lang === 'en') {
      return `$${(jpyMonthly * (usdRate ?? FALLBACK_USD_RATE)).toFixed(2)} / mo`
    }
    return `¥${jpyMonthly.toLocaleString('ja-JP')} / 月`
  }, [lang, usdRate])

  // 入力欄の値は表示中の通貨（ja=円 / en=ドル）。保存は常に円なので必ずここを通す。
  // 英語UIでレート未取得のときに素通しすると $1,299 が ¥1,299 として保存され、
  // 150倍ずれた金額が永続化されてしまうため、フォールバックレートで必ず換算する。
  const parsePriceToJpy = useCallback((raw: string): number | undefined => {
    const cleaned = raw.replace(/,/g, '').trim()
    if (cleaned === '') return undefined
    const n = Number(cleaned)
    if (!Number.isFinite(n) || n < 0) return undefined
    if (lang !== 'en') return Math.round(n)
    return Math.round(n / (usdRate ?? FALLBACK_USD_RATE))
  }, [lang, usdRate])

  // 入力欄の初期値。parsePriceToJpy と同じレートを使わないと、
  // 表示された値をそのまま保存し直しただけで金額が変わってしまう
  const fmtPriceInput = useCallback((jpy: number | null | undefined): string => {
    if (jpy == null || !Number.isFinite(jpy)) return ''
    if (lang !== 'en') return String(jpy)
    return (jpy * (usdRate ?? FALLBACK_USD_RATE)).toFixed(2)
  }, [lang, usdRate])

  const setUnitSystem = useCallback(async (u: UnitSystem) => {
    setUnitSystemState(u)
    await AsyncStorage.setItem('app_unit', u)
  }, [])

  const setReduceMotion = useCallback(async (on: boolean) => {
    setReduceMotionState(on)
    await AsyncStorage.setItem('app_reduce_motion', String(on))
  }, [])

  const setHistoryNodeMorph = useCallback(async (on: boolean) => {
    setHistoryNodeMorphState(on)
    await AsyncStorage.setItem('app_history_node_morph', String(on))
  }, [])

  const setHistorySpeed = useCallback(async (speed: PlaybackSpeed) => {
    setHistorySpeedState(speed)
    await AsyncStorage.setItem('app_history_speed', String(speed))
  }, [])

  const setHistoryShowInOut = useCallback(async (on: boolean) => {
    setHistoryShowInOutState(on)
    await AsyncStorage.setItem('app_history_show_inout', String(on))
  }, [])

  const setHistoryGrain = useCallback(async (grain: TimelineGrain) => {
    setHistoryGrainState(grain)
    await AsyncStorage.setItem('app_history_grain', grain)
  }, [])

  const withOpacity = useCallback((hexColor: string, opacity: number): string => {
    // #RRGGBB 以外（8桁hex・rgba()・名前付き色・undefined）に付け足すと
    // "undefined80" のような無効な色文字列になり、その要素が描画されなくなる。
    // 付けられないときは元の色をそのまま返す
    if (!/^#[0-9a-f]{6}$/i.test(hexColor)) return hexColor
    const clipped = Math.max(0, Math.min(255, Math.round(opacity)))
    const hex = clipped.toString(16).padStart(2, '0').toUpperCase()
    return hexColor + hex
  }, [])

  const isAdvancedCategory = useCallback(
    (cat: GadgetCategory): boolean => advancedCategories.includes(cat),
    [advancedCategories],
  )

  const toggleAdvancedCategory = useCallback(async (cat: GadgetCategory) => {
    const current = advancedCategoriesRef.current
    const next = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat]
    await persistAdvancedCategories(next)
  }, [persistAdvancedCategories])

  const resetAdvancedCategories = useCallback(async () => {
    const next = [...DEFAULT_ADVANCED_CATEGORIES]
    await persistAdvancedCategories(next)
  }, [persistAdvancedCategories])

  const unitLabel = unitSystem === 'imperial' ? 'in' : 'cm'

  const fmtDim = useCallback((cm: number): string => {
    if (unitSystem === 'imperial') {
      return `${Math.round(cm / 2.54 * 10) / 10}"`
    }
    return `${cm} cm`
  }, [unitSystem])

  // "120 × 60" や "70〜80" などの文字列を現在の単位に変換して返す
  const fmtDimStr = useCallback((dimStr: string | null | undefined): string => {
    if (!dimStr) return ''
    if (unitSystem === 'metric') return dimStr
    // 数値をすべてインチに変換（× や 〜 区切りを保持）
    return dimStr.replace(/[\d.]+/g, (n) => {
      const inches = Math.round(parseFloat(n) / 2.54 * 10) / 10
      return String(inches)
    })
  }, [unitSystem])

  const setLang = useCallback(async (l: Lang) => {
    setLangState(l)
    // $表示に切り替えた時点でレートを用意する（起動時取得をやめた分の遅延取得。1時間キャッシュ済み）
    if (l === 'en') void fetchUsdRate().then(setUsdRate)
    await AsyncStorage.setItem('app_language', l)
  }, [])

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const table: Record<string, string> = TRANS[lang] ?? TRANS.ja
    const str = table[key] ?? (TRANS.ja as Record<string, string>)[key] ?? key
    if (!vars) return str
    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))
  }, [lang])

  // 端末とアプリのどちらかが ON なら動きを抑える
  const reduceMotionSystem = reduceMotionSystemValue === true
  const reduceMotion = reduceMotionSetting || (reduceMotionSystemValue ?? true)

  const value = useMemo<AppContextValue>(
    () => ({ isDark, colors, lang, themeMode, themeReady, setThemeMode, setLang, t, accentKey: accentColorAllowed ? accentKey : 'orange', setAccentKey, setAccentColorAllowed, usdRate, fmtPrice, displayAmount, fmtPlanPrice, parsePriceToJpy, fmtPriceInput, unitSystem, unitLabel, setUnitSystem, fmtDim, fmtDimStr, reduceMotion, reduceMotionSetting, reduceMotionSystem, setReduceMotion, historyNodeMorph, setHistoryNodeMorph, historyGrain, setHistoryGrain, historySpeed, setHistorySpeed, historyShowInOut, setHistoryShowInOut, withOpacity, advancedCategories, isAdvancedCategory, toggleAdvancedCategory, resetAdvancedCategories }),
    [isDark, colors, lang, themeMode, themeReady, setThemeMode, setLang, t, accentKey, accentColorAllowed, setAccentKey, setAccentColorAllowed, usdRate, fmtPrice, displayAmount, fmtPlanPrice, parsePriceToJpy, fmtPriceInput, unitSystem, unitLabel, setUnitSystem, fmtDim, fmtDimStr, reduceMotion, reduceMotionSetting, reduceMotionSystem, setReduceMotion, historyNodeMorph, setHistoryNodeMorph, historyGrain, setHistoryGrain, historySpeed, setHistorySpeed, historyShowInOut, setHistoryShowInOut, withOpacity, advancedCategories, isAdvancedCategory, toggleAdvancedCategory, resetAdvancedCategories],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
