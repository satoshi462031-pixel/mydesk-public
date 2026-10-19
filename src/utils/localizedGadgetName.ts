import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../constants/categoryLabels'
import { Gadget, GadgetCategory } from '../types'

type CategoryTerm = readonly [ja: string, en: string]

// 公式サンプルはアプリ管理の固定IDなので、利用者が付けた同名の商品は変更しない。
const OFFICIAL_DEMO_GADGET_NAMES_EN: Readonly<Record<string, string>> = {
  'demo-gaming-arm': 'Ergotron LX Dual Stacking Arm',
  'demo-creator-arm': 'Ergotron LX Single Monitor Arm',
  'demo-dtm-arm': 'FlexiSpot F9L Single Monitor Arm',
  'demo-dtm-desk': 'IKEA KARLBY Worktop + ALEX',
  'demo-dtm-chair': 'ITOKI Salida YL9',

  'demo-gaming-pc': 'Entry-level Gaming PC',
  'demo-gaming-monitor-main': '24-inch 165Hz Monitor',
  'demo-gaming-mouse': 'Wireless Gaming Mouse',
  'demo-gaming-keyboard': 'Compact Mechanical Keyboard',
  'demo-gaming-headset': 'Wired Gaming Headset',
  'demo-gaming-strip': '6-Outlet Power Strip',
  'demo-creator-pc': '14-inch Creator Laptop',
  'demo-creator-monitor': '27-inch USB-C Monitor',
  'demo-creator-keyboard': 'Low-profile Bluetooth Keyboard',
  'demo-creator-mouse': 'Silent Bluetooth Mouse',
  'demo-creator-ssd': 'Portable SSD 1TB',
  'demo-creator-strip': '6-Outlet Power Strip',
  'demo-mobile-pc': '13-inch Lightweight Laptop',
  'demo-mobile-charger': '65W USB-C Charger',
  'demo-mobile-battery': '10000mAh Power Bank',
  'demo-mobile-mouse': 'Low-profile Bluetooth Mouse',
  'demo-mobile-phone': 'Mid-range Smartphone',
  'demo-dtm-pc': 'Compact Production PC',
  'demo-dtm-monitor': '24-inch IPS Monitor',
  'demo-dtm-audio-if': '2-Input Audio Interface',
  'demo-dtm-mic': 'Entry-level Condenser Microphone',
  'demo-dtm-midi-keyboard': '25-key MIDI Keyboard',
  'demo-dtm-headphone': 'Closed-back Monitor Headphones',
  'demo-dtm-strip': '6-Outlet Power Strip',
  'demo-gaming-cable-dp': 'CableMatters DisplayPort 1.4 Cable 1.8m',
  'demo-gaming-cable-hdmi': 'Belkin HDMI 2.1 Cable 2m',
  'demo-creator-cable-tb4': 'Anker Thunderbolt 4 Cable 0.7m',
  'demo-dtm-cable-xlr': 'mogami 2549 XLR Mic Cable 3m',
  'demo-dtm-cable-usbc': 'Anker USB-C to USB-C Cable 1m',
}

/**
 * 商品名の中でカテゴリを説明していると断定できる語だけを英語化する。
 * カテゴリ別に分けることで「マイクロソフト」の「マイク」のような誤変換を避ける。
 */
const PRODUCT_CATEGORY_TERMS: Readonly<Partial<Record<string, readonly CategoryTerm[]>>> = {
  PC: [['デスクトップパソコン', 'Desktop PC'], ['ノートパソコン', 'Laptop'], ['自作PC', 'Custom PC'], ['パソコン', 'PC']],
  Monitor: [['ゲーミングモニター', 'Gaming Monitor'], ['液晶ディスプレイ', 'Display'], ['液晶モニター', 'Monitor'], ['ディスプレイ', 'Display'], ['モニター', 'Monitor']],
  TV: [['有機ELテレビ', 'OLED TV'], ['液晶テレビ', 'LCD TV'], ['テレビ', 'TV']],
  Projector: [['液晶プロジェクター', 'LCD Projector'], ['プロジェクター', 'Projector']],
  Dock: [['ドッキングステーション', 'Docking Station'], ['ドック', 'Dock']],
  Hub: [['USBハブ', 'USB Hub'], ['ハブ', 'Hub']],
  Mouse: [['ゲーミングマウス', 'Gaming Mouse'], ['ワイヤレスマウス', 'Wireless Mouse'], ['無線マウス', 'Wireless Mouse'], ['有線マウス', 'Wired Mouse'], ['マウス', 'Mouse']],
  Keyboard: [['メカニカルキーボード', 'Mechanical Keyboard'], ['ゲーミングキーボード', 'Gaming Keyboard'], ['ワイヤレスキーボード', 'Wireless Keyboard'], ['MIDIキーボード', 'MIDI Keyboard'], ['キーボード', 'Keyboard']],
  Speaker: [['パワードモニタースピーカー', 'Powered Monitor Speaker'], ['モニタースピーカー', 'Monitor Speaker'], ['スマートスピーカー', 'Smart Speaker'], ['サウンドバー', 'Soundbar'], ['スピーカー', 'Speaker']],
  Headphone: [['ワイヤレスヘッドホン', 'Wireless Headphones'], ['ヘッドフォン', 'Headphones'], ['ヘッドホン', 'Headphones']],
  Earphone: [['ワイヤレスイヤホン', 'Wireless Earphones'], ['イヤフォン', 'Earphones'], ['イヤホン', 'Earphones']],
  Light: [['デスクライト', 'Desk Light'], ['ライト', 'Light']],
  Webcam: [['ウェブカメラ', 'Webcam'], ['Webカメラ', 'Webcam']],
  Camera: [['デジタルカメラ', 'Digital Camera'], ['ウェブカメラ', 'Webcam'], ['Webカメラ', 'Webcam'], ['カメラ', 'Camera']],
  Lens: [['レンズ', 'Lens']],
  Tripod: [['三脚・スタンド', 'Tripod / Stand'], ['三脚', 'Tripod']],
  Microphone: [['コンデンサーマイク', 'Condenser Microphone'], ['ダイナミックマイク', 'Dynamic Microphone'], ['マイクロホン', 'Microphone'], ['マイク', 'Microphone']],
  Storage: [['外付けストレージ', 'External Storage'], ['ストレージ', 'Storage']],
  Router: [['無線LANルーター', 'Wi-Fi Router'], ['Wi-Fiルーター', 'Wi-Fi Router'], ['ルーター', 'Router']],
  NetworkSwitch: [['スイッチングハブ', 'Network Switch']],
  Modem: [['光回線終端装置', 'ONU'], ['モデム', 'Modem']],
  GameConsole: [['ゲーム機', 'Game Console']],
  CaptureDevice: [['キャプチャーボード', 'Capture Card'], ['キャプチャーデバイス', 'Capture Device']],
  StreamingDevice: [['ストリーミング端末', 'Streaming Device']],
  KVM: [['KVMスイッチ', 'KVM Switch']],
  Printer3D: [['3Dプリンター', '3D Printer']],
  Printer: [['インクジェットプリンター', 'Inkjet Printer'], ['レーザープリンター', 'Laser Printer'], ['プリンター', 'Printer']],
  PenTablet: [['液晶ペンタブレット', 'Pen Display'], ['ペンタブレット', 'Pen Tablet']],
  Charger: [['ワイヤレス充電器', 'Wireless Charger'], ['急速充電器', 'Fast Charger'], ['充電器', 'Charger'], ['チャージャー', 'Charger']],
  MobileBattery: [['モバイルバッテリー', 'Power Bank']],
  AudioInterface: [['オーディオインターフェース', 'Audio Interface']],
  HeadphoneAmp: [['ヘッドホンアンプ', 'Headphone Amp'], ['DACアンプ', 'DAC / Amp']],
  Amplifier: [['プリメインアンプ', 'Integrated Amplifier']],
  Mixer: [['オーディオミキサー', 'Audio Mixer'], ['ミキサー', 'Mixer']],
  SmartHome: [['スマートホーム', 'Smart Home']],
  Smartphone: [['スマートフォン', 'Smartphone']],
  Tablet: [['タブレット', 'Tablet']],
  PowerStrip: [['電源タップ', 'Power Strip']],
  UPS: [['無停電電源装置', 'UPS']],
  Desk: [['昇降デスク', 'Standing Desk'], ['パソコンデスク', 'Computer Desk']],
  Chair: [['オフィスチェア', 'Office Chair'], ['ゲーミングチェア', 'Gaming Chair'], ['チェア', 'Chair']],
  VRGlass: [['スマートグラス', 'Smart Glasses'], ['VRゴーグル', 'VR Headset']],
  Smartwatch: [['スマートウォッチ', 'Smartwatch']],
  WallPanel: [['ウォールパネル', 'Wall Panel']],
  Accessory: [['小物・家電', 'Accessories / Appliances']],
  DeskPad: [['デスクマット', 'Desk Mat']],
  MousePad: [['マウスパッド', 'Mouse Pad']],
  Furniture: [['家具', 'Furniture']],
  Plant: [['観葉植物', 'Houseplant']],
  SmallDevice: [['小型機器', 'Small Device']],
  PCPart: [['PCパーツ', 'PC Parts'], ['PCケース', 'PC Case']],
  PCPartCPU: [['CPUクーラー', 'CPU Cooler'], ['プロセッサー', 'Processor']],
  PCPartGPU: [['グラフィックボード', 'Graphics Card'], ['ビデオカード', 'Graphics Card']],
  PCPartMemory: [['デスクトップ用メモリ', 'Desktop Memory'], ['ノート用メモリ', 'Laptop Memory'], ['メモリ', 'Memory']],
  PCPartStorage: [['外付けハードディスク', 'External Hard Drive'], ['内蔵ハードディスク', 'Internal Hard Drive'], ['ハードディスク', 'Hard Drive']],
  Controller: [['ゲームコントローラー', 'Game Controller'], ['コントローラー', 'Controller']],
  MonitorArm: [['デュアルモニターアーム', 'Dual Monitor Arm'], ['モニターアーム', 'Monitor Arm']],
  MicArm: [['マイクアーム', 'Microphone Arm']],
  Cable: [['変換ケーブル', 'Adapter Cable'], ['ケーブル', 'Cable']],
  Instrument: [['電子楽器', 'Electronic Instrument'], ['楽器', 'Instrument']],
}

function replaceCategoryTerm(value: string, source: string, target: string): string {
  return value.split(source).join(` ${target} `)
}

/** 英語表示時だけ、商品名に含まれる判定可能なカテゴリ語を英語へ置き換える。 */
export function localizeProductCategoryTerms(
  name: string,
  category: GadgetCategory | string,
  lang: 'ja' | 'en',
): string {
  if (lang !== 'en') return name
  const terms = PRODUCT_CATEGORY_TERMS[category]
  if (!terms) return name
  const localized = terms.reduce(
    (value, [source, target]) => replaceCategoryTerm(value, source, target),
    name,
  )
  return localized.replace(/\s+/g, ' ').trim()
}

const toAsciiDigits = (value: string) => value.replace(/[０-９]/g, (digit) =>
  String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
)
const toFullWidthDigits = (value: string) => value.replace(/\d/g, (digit) =>
  String.fromCharCode(digit.charCodeAt(0) + 0xfee0),
)

// 公式デモのメモ。デモは日本語で1回だけ公開しているので、英語で見る人には名前と同じく
// ID で差し替える（利用者のメモは翻訳しない）。デモにメモを足したらここにも足す
// （tests/demoDeskLocalization.test.ts が漏れを止める）
const OFFICIAL_DEMO_GADGET_MEMOS_EN: Readonly<Record<string, string>> = {
  'demo-gaming-switch2-dock': 'Included with the Switch 2',
  'demo-gaming-joycon': 'Included with the Switch 2',
  'demo-gaming-monitor-old': 'Retired after upgrading to OLED',
  'demo-creator-monitor-old': 'Replaced with a Thunderbolt monitor, which led to the single-cable setup',
  'demo-mobile-charger': 'Splits one café outlet across everything',
  'demo-mobile-battery': 'The power source at seats without an outlet',
  'demo-mobile-battery-old': 'Could not charge the laptop, so upgraded to 20000mAh',
  'demo-dtm-ssd': 'Where the sample libraries live',
  'demo-dtm-audio-if-old': 'The first one; one input was not enough, so moved to a MOTU M4',
}

/** メモの表示用。公式デモだけ英語へ差し替え、それ以外は書かれたまま返す */
export function localizedGadgetMemo(gadget: Pick<Gadget, 'id' | 'memo'>, lang: 'ja' | 'en'): string | undefined {
  if (lang === 'en' && gadget.memo && OFFICIAL_DEMO_GADGET_MEMOS_EN[gadget.id]) {
    return OFFICIAL_DEMO_GADGET_MEMOS_EN[gadget.id]
  }
  return gadget.memo
}

/** 本人が付けた呼び名。空白だけのものは付けていない扱い */
export function gadgetNickname(gadget: Pick<Gadget, 'nickname'>): string | null {
  return gadget.nickname?.trim() || null
}

/**
 * 一覧の行・詳細の見出しに出す名前。商品名が未設定の枠（名前はジャンル名＋連番）は
 * 呼び名を優先する。「モニター２」を「サブモニター」と呼び直したのに見出しが元のままだと、
 * 直したことが伝わらない
 */
export function gadgetTitle(gadget: Gadget, lang: 'ja' | 'en'): string {
  const nickname = gadgetNickname(gadget)
  if (nickname && (gadget.isPlaceholder || !gadget.name.trim())) return nickname
  return localizedGadgetName(gadget, lang)
}

/**
 * 見出し（gadgetTitle）に添えるジャンル名。商品名を入れると見出しが商品名になり、ジャンルが
 * 絵だけになる（「Dell U2723QE」だけではモニターかどうか読めない）。
 * 見出しが枠の名前（ジャンル名＋連番）のまま・見出しとジャンル名が同じときは重ねない
 */
export function gadgetGenreLabel(gadget: Gadget, lang: 'ja' | 'en'): string | null {
  const unnamed = gadget.isPlaceholder || !gadget.name.trim()
  if (unnamed && !gadgetNickname(gadget)) return null
  const genre = (gadget.category === 'Other' ? gadget.customCategory?.name : undefined)
    ?? (lang === 'en' ? CATEGORY_LABELS_EN : CATEGORY_LABELS)[gadget.category]
  if (!genre) return null
  const normalize = (value: string) => value.replace(/[\s・/]/g, '').toLowerCase()
  return normalize(gadgetTitle(gadget, lang)) === normalize(genre) ? null : genre
}

/** 見出しとは別に添える呼び名。見出しが呼び名になっているときは重ねない */
export function gadgetSubNickname(gadget: Gadget): string | null {
  const nickname = gadgetNickname(gadget)
  return nickname && !gadget.isPlaceholder && gadget.name.trim() ? nickname : null
}

export function localizedGadgetName(gadget: Gadget, lang: 'ja' | 'en'): string {
  if (lang === 'en' && OFFICIAL_DEMO_GADGET_NAMES_EN[gadget.id]) {
    return OFFICIAL_DEMO_GADGET_NAMES_EN[gadget.id]
  }
  // 自作ジャンルの名前はユーザーが付けたもので、訳すべき語ではない（「その他」と読み替えない）
  if (gadget.category === 'Other' && gadget.customCategory) return gadget.name
  const ja = CATEGORY_LABELS[gadget.category]
  const en = CATEGORY_LABELS_EN[gadget.category]
  const target = lang === 'en' ? en : ja
  if (!target) return gadget.name

  for (const source of [ja, en].filter(Boolean)) {
    if (!gadget.name.startsWith(source)) continue
    const suffix = toAsciiDigits(gadget.name.slice(source.length).trim())
    if (suffix !== '' && !/^\d+$/.test(suffix)) continue
    if (!suffix) return target
    return lang === 'en' ? `${target} ${suffix}` : `${target}${toFullWidthDigits(suffix)}`
  }
  return localizeProductCategoryTerms(gadget.name, gadget.category, lang)
}
