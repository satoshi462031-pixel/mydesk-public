/**
 * カテゴリ別のポート抽出ルール。researchProductPorts.ts がこれを読んで商品名・説明・商品ページから
 * products.ports を組み立てる。
 *
 * 方針は3つ。
 *   1. 根拠が無いものは書かない。誤ったポートは配線図に存在しない線を出すので、空欄のほうが害が小さい
 *   2. 生成する ports は buildGadgetPorts / buildPortsFromState の出力と同じ形にする。
 *      予測変換で選んだ直後にユーザーが保存しても差分が出ないようにするため
 *   3. カテゴリの中身が雑多なもの（KVMにHDMIケーブルが混ざる等）は exclude / require で先に弾く
 */
import { CATEGORY_PORT_CONFIG, initPortState } from '../src/constants/portFormConfig'
import { buildGadgetPorts } from '../src/utils/gadgetPorts'
import type { GadgetCategory, Port, PortDirection, PortType } from '../src/types'

export type MatchedRule = {
  type: PortType
  direction: PortDirection
  count: number
  label?: string
  supportsVideo?: boolean
  supportsPowerDelivery?: boolean
  supportsPoE?: boolean
  directAttach?: boolean
  evidence: string
}

export type PortRule = {
  type: PortType
  direction: PortDirection
  label?: string
  supportsVideo?: boolean
  supportsPowerDelivery?: boolean
  supportsPoE?: boolean
  /** 本数を読み取る。キャプチャした最初の数字を採用する */
  count?: RegExp[]
  /** 表記上の総ポート数から、アップリンク等として別定義した口を差し引く */
  countOffset?: number
  /** 有無だけ見る */
  presence?: RegExp[]
  /** presence が当たったときの本数 */
  presenceCount?: number
  /** 何も当たらなかったときに入れる本数。カテゴリ上ほぼ必ず在る口にだけ使う */
  fallback?: number
  max?: number
}

/** 周辺機器の接続方式（有線 / 2.4GHzレシーバー / Bluetooth）の解決方法 */
export type ConnectionSpec = {
  /** 有線のときに使う口。上から順に照合し、最初に当たったものを採用する */
  wired: Array<{ type: PortType; label?: string; patterns: RegExp[] }>
  /** 有線の根拠はあるが端子が分からないときの既定 */
  wiredFallback?: { type: PortType; label?: string }
  /** 2.4GHzレシーバーを持ちうるカテゴリか */
  dongle?: boolean
}

export type CategorySpec = {
  /** 本体ではない商品を弾く（ケーブル・変換アダプタ・部材など） */
  exclude?: RegExp
  /** これに当たらない商品は本体と見なさない */
  require?: RegExp
  connection?: ConnectionSpec
  rules?: PortRule[]
  /** connection が決まらなかったときだけ適用するルール。カテゴリ上ほぼ確実な既定に使う */
  connectionFallbackRules?: PortRule[]
  /** これ未満のポート数しか決まらなければ未判定にする */
  minPorts?: number
  /**
   * 商品ごとの記述が無くてもカテゴリだけでポートが決まる場合に立てる。
   * プロジェクターのHDMI入力やモニターアームの支持のように、
   * その機器なら必ず持っている口しか使っていないカテゴリに限る
   */
  allowDefaultsOnly?: boolean
  /**
   * 商品名で使うルールを切り替える。同じカテゴリに端子の向きごと違う機器が
   * 混ざっている場合に使う（Mixer にはライブ用ミキサーとDJ機材が同居していて、
   * ライブ用は XLR が入力、DJミキサーは XLR が MASTER 出力と逆になる）。
   * 先にマッチした派生を使い、どれにも当たらなければ本体のルールへ落ちる。
   */
  variants?: Array<{ match: RegExp; spec: CategorySpec }>
}

/** 商品名に応じて実際に使うルールを選ぶ */
export function specFor(specs: Partial<Record<GadgetCategory, CategorySpec>>, category: GadgetCategory, text: string): CategorySpec | undefined {
  const spec = specs[category]
  if (!spec) return undefined
  return spec.variants?.find((variant) => variant.match.test(text))?.spec ?? spec
}

// ─── 共通で使う語 ────────────────────────────────────────────────

/** ケーブル・変換アダプタ・交換部品。どのカテゴリでも本体ではない */
export const NOT_A_DEVICE = /ケーブル(?!\s*(?:内蔵|付属|着脱))|変換アダプタ|変換プラグ|変換コネクタ|コンバーター|延長コード|キャップ|カバー(?!ー)|保護フィルム|交換用|補修|純正部品|取付金具|ダクト|ブレーカ|化粧パイプ|ボルト|プラグ\s*\d型/

const num = (max: number) => new RegExp(`(${Array.from({ length: Math.min(max, 9) }, (_, i) => i + 1).join('|')})`)

/** 「HDMI×2」「2ポートHDMI」「HDMI 2系統」のような本数表記 */
export function countPatterns(token: string, max = 8): RegExp[] {
  const t = token
  return [
    new RegExp(`${t}\\s*(?:端子|ポート|出力|入力)?\\s*[×xX＊*]\\s*${num(max).source}`, 'i'),
    new RegExp(`${num(max).source}\\s*[×xX＊*]\\s*${t}`, 'i'),
    new RegExp(`${num(max).source}\\s*(?:個|基|系統|ポート|口)\\s*(?:の)?\\s*${t}`, 'i'),
    new RegExp(`${t}\\s*(?:を)?\\s*${num(max).source}\\s*(?:個|基|系統|ポート|口)`, 'i'),
  ]
}

const HDMI = 'HDMI'
const DP = '(?:DisplayPort|ディスプレイポート|\\bDP\\b)'
const USB_A = '(?:USB[-\\s]?A|USB\\s*3\\.[012]|USB\\s*2\\.0|USB[-\\s]?Aポート)'
const USB_C = '(?:USB[-\\s]?C|Type[-\\s]?C|タイプC)'
const LAN = '(?:有線LAN|LANポート|Ethernet|イーサネット|RJ[-\\s]?45|ギガビット)'

// ─── DJ機材（Mixer カテゴリの派生）─────────────────────────────
// Mixer には配信・ライブ用のミキサーとDJ機材が同居している。DJ機材は端子の向きが逆で、
// ライブ用ミキサーの XLR がマイク入力なのに対し、DJミキサーの XLR は MASTER 出力になる。
// カテゴリ共通のルールを当てると「スピーカーへ出す口が無い」機器ができてしまう。
// ここに書いてあるのは各機種の取扱説明書で確認できた端子だけで、機種差のあるものは書かない。

/**
 * DJ機材はアクセサリ商品が本体と同じ型番を名前に持つ（「DDJ-FLX4用ダストカバー」等）ため、
 * 本体だと誤認しやすい。保証サービス・ケース・カバー・マットをここで弾く。
 */
const DJ_ACCESSORY = new RegExp([
  'DECKSAVER', 'デックセーバー', 'Magma', 'Euro\\s*Style',
  'Care\\s*Pro', '延長保証', '保証サービス',
  'スリップマット', 'ターンテーブルマット', 'ダストカバー', '防塵', '丸洗い',
  'バッグ', 'Bags', 'WORKSTATION', '収納', 'ケース(?!ード)', 'スタンドのみ',
  '初心者セット', 'スタートセット', '入門セット',
].join('|'), 'i')

/**
 * 音楽機材はケース・スタンド・保護材が本体と同じ型番を名前に持つ。
 * 型番で require を広げるとこれらが本体として判定されるので、先に弾く。
 */
const MUSIC_ACCESSORY = new RegExp([
  '収納ケース', 'ソフトケース', 'ハードケース', '保護ケース', 'キャリングケース', '専用ケース',
  '互換品', 'Khanka', 'インシュレーター', '防振', 'クリーナー', '譜面台',
  'スタンドのみ', 'スタンドセット(?!.*(?:スピーカー|モニター))', 'ダストカバー',
  // 単体で売られるペダル・椅子。本体に付属する「3本ペダル付」まで弾かないよう語を限定する
  'ダンパーペダル', 'サステインペダル', 'エクスプレッションペダル',
  'ピアノイス', 'ピアノ椅子', '高低自在', 'ピアノベンチ',
].join('|'), 'i')

/**
 * モニタースピーカー（スタジオモニター）と判断できる語・型番。
 * 「スピーカー」と書かず型番だけで売られている商品が多いので、定番ブランドを列挙する。
 */
const STUDIO_MONITOR = new RegExp([
  'スタジオモニター', 'モニタースピーカー', 'モニター\\s*スピーカー', 'リファレンスモニター', 'パワードモニター',
  'HS[3578]\\b', 'MSP\\d', 'ROKIT', 'Eris\\s*E', 'iLoud',
  'ADAM\\s*(?:AUDIO\\s*)?[ADST]\\d', 'Genelec', 'FOCAL\\s*(?:SHAPE|Alpha|Solo)',
  'PreSonus\\s*Eris', 'Mackie\\s*(?:CR|MR)\\d', 'Neumann\\s*KH', 'KRK\\b',
  'Kali\\s*(?:LP|IN)-?\\d', 'Fostex\\s*PM', 'EVE\\s*Audio', 'Dynaudio\\s*(?:BM|LYD)',
  'LP-[68]',
].join('|'), 'i')

/** 電子ピアノ・ステージピアノ・電子ドラム。AC電源で動き、ヘッドホン端子を必ず持つ */
const DIGITAL_PIANO = /電子ピアノ|デジタルピアノ|ステージピアノ|電子ドラム|エレドラ|電子ヴァイオリン/i

const DIGITAL_PIANO_SPEC: CategorySpec = {
  allowDefaultsOnly: true,
  exclude: new RegExp(`${NOT_A_DEVICE.source}|${MUSIC_ACCESSORY.source}`, 'i'),
  rules: [
    // 夜間に弾くための機器なので、ヘッドホン端子を持たない機種は無い
    { type: 'Audio3_5mm', direction: 'output', fallback: 1, label: 'ヘッドホン出力' },
    { type: 'Audio6_3mm', direction: 'output', presence: [/標準ジャック|6\.3|フォーン|LINE\s*OUT|ライン出力/i], label: 'LINE OUT' },
    { type: 'USB_B', direction: 'input', presence: [/USB|MIDI/i], label: 'PC接続' },
    { type: 'MIDI', direction: 'output', presence: [/MIDI\s*(?:OUT|端子)/i] },
    { type: 'Power', direction: 'input', fallback: 1 },
  ],
  minPorts: 2,
}

/** MIDI鍵盤・シンセ。PCとUSBで繋ぐのが前提の電子楽器 */
const MIDI_KEYBOARD = /MIDIキーボード|MIDI\s*コントローラ|シンセサイザー|シンセ\b|Komplete\s*Kontrol|Launchkey|MPK\s*(?:mini|Road)|KeyStep|Keylab|Oxygen\s*Pro|minilogue|microKORG|JUNO-|MODX|MONTAGE|SEABOARD|Launchpad/i

const MIDI_KEYBOARD_SPEC: CategorySpec = {
  allowDefaultsOnly: true,
  exclude: new RegExp(`${NOT_A_DEVICE.source}|${MUSIC_ACCESSORY.source}`, 'i'),
  rules: [
    // PCと繋がないMIDI鍵盤は無い。表記でUSB-CかUSB-Bかを分け、判らなければ主流のUSB-Bにする
    { type: 'USB_C', direction: 'input', presence: [new RegExp(USB_C, 'i')], label: 'PC接続' },
    { type: 'USB_B', direction: 'input', fallback: 1, label: 'PC接続' },
    { type: 'MIDI', direction: 'output', presence: [/MIDI\s*(?:OUT|出力|端子)/i] },
    { type: 'Audio6_3mm', direction: 'output', presence: [/LINE\s*OUT|ライン出力|フォーン|標準ジャック|アウトプット/i], label: 'LINE OUT' },
    { type: 'Audio3_5mm', direction: 'output', presence: [/ヘッドホン|イヤホン/i], label: 'ヘッドホン出力' },
  ],
  minPorts: 1,
}

/** モニタースピーカー（スタジオモニター）。XLR と TRS の両方を備え、AC電源で駆動する */
const STUDIO_MONITOR_SPEC: CategorySpec = {
  allowDefaultsOnly: true,
  exclude: new RegExp(`${NOT_A_DEVICE.source}|${MUSIC_ACCESSORY.source}`, 'i'),
  rules: [
    // どの機種もバランス入力を2系統（XLR と TRS）持つ。片方だけ書くと、
    // RCA/TRS しか出せない機器から音を受けられなくなる
    { type: 'XLR', direction: 'input', fallback: 1, label: 'LINE IN' },
    { type: 'Audio6_3mm', direction: 'input', fallback: 1, label: 'LINE IN' },
    { type: 'RCA', direction: 'input', presence: [/RCA|ピンプラグ|アンバランス/i] },
    { type: 'Power', direction: 'input', fallback: 1 },
  ],
  minPorts: 3,
}

const DJ_MIXER_SPEC: CategorySpec = {
  allowDefaultsOnly: true,
  exclude: new RegExp(`${NOT_A_DEVICE.source}|${DJ_ACCESSORY.source}`, 'i'),
  rules: [
    // DJM-250MK2 / 750MK2 とも MASTER は XLR と RCA の両方を備える
    { type: 'XLR', direction: 'output', fallback: 1, label: 'MASTER OUT' },
    { type: 'RCA', direction: 'output', fallback: 1, label: 'MASTER OUT' },
    // 入力系統はチャンネル数ぶん。表記が無ければ最小構成の2chとみなす
    { type: 'RCA', direction: 'input', count: [/(\d)\s*ch/i], fallback: 2, max: 4, label: 'LINE/PHONO IN' },
    { type: 'Audio6_3mm', direction: 'output', fallback: 1, label: 'ヘッドホン出力' },
    { type: 'Audio6_3mm_TS', direction: 'input', fallback: 1, label: 'MIC IN' },
    { type: 'USB_B', direction: 'input', fallback: 1, label: 'PC接続' },
    { type: 'Power', direction: 'input', fallback: 1 },
  ],
  minPorts: 4,
}

const DJ_CONTROLLER_SPEC: CategorySpec = {
  allowDefaultsOnly: true,
  exclude: new RegExp(`${NOT_A_DEVICE.source}|${DJ_ACCESSORY.source}`, 'i'),
  rules: [
    // DDJ-FLX4 / REV1 とも MASTER は RCA。XLR を持つのは上位機だけなので書かない
    { type: 'RCA', direction: 'output', fallback: 1, label: 'MASTER OUT' },
    { type: 'Audio3_5mm', direction: 'output', fallback: 1, label: 'ヘッドホン出力' },
    { type: 'Audio6_3mm', direction: 'output', presence: [/6\.3|標準ジャック|1\/4/i], label: 'ヘッドホン出力' },
    { type: 'Audio6_3mm_TS', direction: 'input', fallback: 1, label: 'MIC IN' },
    // FLX / REV / GRV 系は USB-C、それ以前の DDJ-400 などは USB-B
    { type: 'USB_C', direction: 'input', presence: [/DDJ-(?:FLX|REV|GRV)|XDJ-AZ/i], label: 'PC接続' },
    { type: 'USB_B', direction: 'input', presence: [/DDJ-(?:400|800|1000|SR|SX)|Mixtrack|Kontrol\s*S/i], label: 'PC接続' },
  ],
  minPorts: 3,
}

const DJ_PLAYER_SPEC: CategorySpec = {
  allowDefaultsOnly: true,
  exclude: new RegExp(`${NOT_A_DEVICE.source}|${DJ_ACCESSORY.source}`, 'i'),
  rules: [
    { type: 'RCA', direction: 'output', fallback: 1, label: 'AUDIO OUT' },
    { type: 'CoaxialAudio', direction: 'output', fallback: 1, label: 'DIGITAL OUT' },
    // PRO DJ LINK。プレーヤー同士とミキサーをLANで繋いで楽曲とテンポを共有する
    { type: 'Ethernet', direction: 'bidirectional', fallback: 1, label: 'LINK' },
    { type: 'USB_A', direction: 'input', fallback: 1, label: '楽曲USB' },
    { type: 'Power', direction: 'input', fallback: 1 },
  ],
  minPorts: 3,
}

const TURNTABLE_SPEC: CategorySpec = {
  allowDefaultsOnly: true,
  exclude: new RegExp(`${NOT_A_DEVICE.source}|${DJ_ACCESSORY.source}`, 'i'),
  rules: [
    { type: 'RCA', direction: 'output', fallback: 1, label: 'PHONO OUT' },
    { type: 'USB_B', direction: 'output', presence: [/USB/i], label: 'PC録音' },
    { type: 'Power', direction: 'input', fallback: 1 },
  ],
  minPorts: 1,
}

const DJ_GEAR_VARIANTS: NonNullable<CategorySpec['variants']> = [
  { match: /DJM-[A-Z0-9]|Xone[:\s]|RANE\s+(?:MP|SEVENTY|ONE)/i, spec: DJ_MIXER_SPEC },
  { match: /CDJ-[A-Z0-9]|XDJ-(?:1000|700)/i, spec: DJ_PLAYER_SPEC },
  { match: /PLX-[A-Z0-9]|AT-LP\d|SL-1200|ターンテーブル/i, spec: TURNTABLE_SPEC },
  { match: /DDJ-|XDJ-(?:RX|RR|AZ)|Mixtrack|Kontrol\s*S\d|Roland\s*DJ-\d|DJ\s*コントローラ/i, spec: DJ_CONTROLLER_SPEC },
]

// ─── カテゴリ別ルール ────────────────────────────────────────────

export const CATEGORY_SPECS: Partial<Record<GadgetCategory, CategorySpec>> = {
  // ── ホスト側：口数が配線図の分岐点になる ──────────────────────

  Dock: {
    exclude: /eGPU|ドックスタンド|冷却|収納|ケーブル$|電源ケーブル/,
    require: /ドッキングステーション|ドック|dock|ハブ|hub|\d\s*in\s*1/i,
    rules: [
      // ドックはPC側がUSB-CかThunderbolt。両方書かれていればThunderbolt優先
      { type: 'Thunderbolt', direction: 'input', presence: [/thunderbolt|\bTB[34]\b/i], label: 'ホスト接続' },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(USB_C, 'i')], label: 'ホスト接続', fallback: 1 },
      { type: 'HDMI', direction: 'output', supportsVideo: true, count: countPatterns(HDMI, 3), presence: [/HDMI/i] },
      { type: 'DisplayPort', direction: 'output', supportsVideo: true, count: countPatterns(DP, 3), presence: [new RegExp(DP, 'i')] },
      { type: 'USB_A', direction: 'output', count: countPatterns(USB_A, 6), presence: [new RegExp(USB_A, 'i')] },
      { type: 'USB_C', direction: 'output', count: [...countPatterns(`${USB_C}\\s*(?:データ|出力)`, 4), ...countPatterns(USB_C, 4)] },
      { type: 'Ethernet', direction: 'input', presence: [new RegExp(LAN, 'i')] },
      { type: 'SDCard', direction: 'input', presence: [/SD\s*カード|SDスロット|SDリーダー|\bSD\b(?!カードは)/i] },
      { type: 'microSDCard', direction: 'input', presence: [/micro\s*SD/i] },
      { type: 'Audio3_5mm', direction: 'output', presence: [/3\.5\s*mm|オーディオジャック|イヤホンジャック/i] },
      { type: 'USB_C', direction: 'output', supportsPowerDelivery: true, presence: [/PD\s*(?:パススルー|給電|充電)|Power\s*Delivery|\d{2,3}\s*W\s*(?:PD|充電|給電)/i], label: 'PD給電' },
    ],
    minPorts: 2,
  },

  Hub: {
    exclude: /分岐ケーブル|変換ケーブル|USBケーブル|延長/,
    require: /ハブ|hub|\d\s*in\s*1|ドッキング/i,
    rules: [
      { type: 'Thunderbolt', direction: 'input', presence: [/thunderbolt|\bTB[34]\b/i], label: 'ホスト接続' },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(`${USB_C}\\s*(?:ハブ|接続|オス)`, 'i'), /Type[-\s]?C\s*ハブ/i], label: 'ホスト接続' },
      { type: 'USB_A', direction: 'input', presence: [/USB\s*[-\s]?A\s*ハブ|USB\s*3\.0\s*ハブ|USB2\.0\s*ハブ/i], label: 'ホスト接続' },
      // 「4ポートUSBハブ」は USB-A 出力が4口という意味。映像やLANを併記する多機能ハブでは使えない
      { type: 'USB_A', direction: 'output', count: [...countPatterns(USB_A, 7), /(\d)\s*ポート(?![^]{0,12}(?:HDMI|LAN|SD))/i] },
      { type: 'HDMI', direction: 'output', supportsVideo: true, count: countPatterns(HDMI, 3), presence: [/HDMI/i] },
      { type: 'DisplayPort', direction: 'output', supportsVideo: true, presence: [new RegExp(DP, 'i')] },
      { type: 'USB_C', direction: 'output', count: [...countPatterns(`${USB_C}\\s*(?:データ|出力)`, 4), ...countPatterns(USB_C, 4)] },
      { type: 'Ethernet', direction: 'input', presence: [new RegExp(LAN, 'i')] },
      { type: 'SDCard', direction: 'input', presence: [/SD\s*カード|SDスロット/i] },
      { type: 'microSDCard', direction: 'input', presence: [/micro\s*SD/i] },
      { type: 'Audio3_5mm', direction: 'output', presence: [/3\.5\s*mm|オーディオジャック/i] },
    ],
    minPorts: 2,
  },

  KVM: {
    // このカテゴリはHDMIケーブル・変換器の混入が多い。切替器・分配器だけを対象にする。
    // 「HDMIケーブル付属」と書く切替器が多いので、NOT_A_DEVICE はここでは使えない
    exclude: /変換(?:ケーブル|アダプタ|コネクタ|プラグ)|コンバーター|コンポジット|RCA変換|海外用/,
    require: /切替器|切り替え器|セレクター|セレクタ|スプリッター|分配器|KVM|パソコン切替/i,
    rules: [
      { type: 'HDMI', direction: 'input', supportsVideo: true, count: [/(\d)\s*入力/], presence: [/HDMI/i] },
      { type: 'HDMI', direction: 'output', supportsVideo: true, count: [/(\d)\s*出力/], presence: [/HDMI/i] },
      { type: 'DisplayPort', direction: 'input', supportsVideo: true, count: [new RegExp(`${DP}[^]{0,10}(\\d)\\s*入力`, 'i')] },
      { type: 'DisplayPort', direction: 'output', supportsVideo: true, count: [new RegExp(`${DP}[^]{0,10}(\\d)\\s*出力`, 'i')] },
      { type: 'USB_B', direction: 'input', presence: [/パソコン切替|KVM|キーボード\s*マウス/i], label: 'PC接続' },
      { type: 'USB_A', direction: 'output', count: countPatterns('USB', 4), presence: [/パソコン切替|KVM/i] },
    ],
    minPorts: 1,
  },

  CaptureDevice: {
    exclude: /ケーブル$|変換アダプタ$/,
    // 製品名に「キャプチャ」を含まない定番機（Live Gamer / DeckLink / Cam Link）が多い
    require: /キャプチャ|capture|ビデオ入力|録画|ストリーミング|live\s*gamer|\bGC\d{3}|decklink|cam\s*link|elgato/i,
    rules: [
      { type: 'HDMI', direction: 'input', supportsVideo: true, presence: [/HDMI/i] },
      // パススルー出力があるとモニターとPCへ同時に流せる。無い機種と配線が変わる
      { type: 'HDMI', direction: 'output', supportsVideo: true, presence: [/パススルー|スルー出力|pass\s*through/i] },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(USB_C, 'i')], label: 'PC接続' },
      { type: 'USB_A', direction: 'input', presence: [/USB\s*3\.[012]|USB\s*2\.0|USB接続/i], label: 'PC接続' },
    ],
    // 映像入力だけではPCへ映像を渡せない。PC接続端子まで判明した製品だけ登録する
    minPorts: 2,
  },

  Router: {
    // 中継器・LANアダプタ・スイッチングハブは配線の意味が違うので対象外
    exclude: /中継器|中継機|アダプター|アダプタ|スプリッタ|スイッチングハブ|スイッチ\b|変換|ケーブル|SFP|アンテナ$/i,
    require: /ルーター|ルータ|Wi-?Fi|無線LAN親機|ホームゲートウェイ/i,
    rules: [
      { type: 'Ethernet', direction: 'input', presence: [/WAN\s*(?:ポート|側|端子)?/i], label: 'WAN' },
      { type: 'Ethernet', direction: 'output', count: [/LAN\s*(?:ポート)?\s*[×x]?\s*(\d+)/i, /(\d+)\s*LANポート/i], max: 16, label: 'LAN' },
      { type: 'WiFi', direction: 'output', presence: [/Wi-?Fi|無線LAN|11\s*a[cx]|11ax/i] },
      { type: 'USB_A', direction: 'output', presence: [/USB\s*3\.0|USBポート/i] },
    ],
    // Wi-Fiという商品分類だけでは物理端子は確定しない。WAN/LAN等も読めた場合だけ登録する
    minPorts: 2,
  },

  NetworkSwitch: {
    exclude: /変換|ケーブル$|USBハブ|Type-?C\s*ハブ/,
    require: /スイッチングハブ|スイッチング\s*HUB|ギガ(?:ビット)?スイッチ|LANハブ|PoEスイッチ|アンマネージスイッチ/i,
    rules: [
      // アプリでは総ポートのうち1口をアップリンク、残りを接続先として表現する
      { type: 'Ethernet', direction: 'input', fallback: 1, label: 'アップリンク' },
      { type: 'Ethernet', direction: 'output', count: [/(\d+)\s*ポート/], countOffset: -1, max: 23 },
      { type: 'Ethernet', direction: 'output', presence: [/PoE給電|PoE対応|PoEスイッチ/i], supportsPoE: true, label: 'Ethernet PoE 出力' },
      { type: 'Power', direction: 'input', fallback: 1, label: '給電 (コンセント)' },
    ],
    minPorts: 2,
  },

  Modem: {
    allowDefaultsOnly: true,
    exclude: /ダクト|ブレーカ|プラグ|金具|カバー|パイプ|キャップ|配線|ジョイナ/,
    require: /モデム|ONU|回線終端|ホームゲートウェイ|光BBユニット/i,
    rules: [
      { type: 'Ethernet', direction: 'output', fallback: 1 },
      { type: 'Power', direction: 'input', fallback: 1, label: '給電 (コンセント)' },
    ],
    minPorts: 1,
  },

  Charger: {
    // ノートPC用ACアダプタ（丸型DCプラグ）はフォームに表現する口が無いので対象外
    exclude: /ケーブル$|コード$|変換|延長|ワイヤレス充電器?$/,
    require: /USB|Type-?C|PD|GaN|充電器|チャージャー/i,
    rules: [
      // PD・GaN・W数を名乗る充電器は必ず USB-C を持つ。口数が書かれていなくても1口は確実
      { type: 'USB_C', direction: 'output', count: [...countPatterns(USB_C, 4), /(\d)\s*C\s*ポート/i], presence: [new RegExp(USB_C, 'i'), /PD|GaN|Power\s*Delivery|\d{2,3}\s*W/i] },
      { type: 'USB_A', direction: 'output', count: [...countPatterns(USB_A, 4), /(\d)\s*A\s*ポート/i], presence: [new RegExp(USB_A, 'i')] },
      { type: 'Power', direction: 'input', fallback: 1, label: '給電 (コンセント)' },
    ],
    minPorts: 2,
  },

  PowerStrip: {
    exclude: /ケーブル$|変換|延長コード\s*のみ|タップ用|カバー/,
    require: /電源タップ|テーブルタップ|延長コード|コンセント|タップ/i,
    rules: [
      { type: 'Power', direction: 'output', count: [/(\d+)\s*(?:個口|コ口|口)/, /AC\s*差込口\s*(\d+)/], fallback: 4, max: 12 },
      { type: 'USB_C', direction: 'output', count: [...countPatterns(USB_C, 4)], presence: [new RegExp(USB_C, 'i')] },
      { type: 'USB_A', direction: 'output', count: [...countPatterns(USB_A, 4), /USB\s*[×x]\s*(\d)/i], presence: [/USB(?![-\s]?C)/i] },
      { type: 'Power', direction: 'input', fallback: 1 },
    ],
    minPorts: 2,
  },

  Storage: {
    // 内蔵ドライブはPCの部品で、単体では配線図に出ない
    exclude: /ケース単体|変換アダプタ|SDカード$|microSD$|USBメモリ(?!.*外付)|内蔵(?:HDD|SSD|ハードディスク)|[23]\.5インチ内蔵|内蔵型/,
    require: /HDD|SSD|ハードディスク|外付|NAS|ドライブ|ストレージ/i,
    rules: [
      { type: 'Thunderbolt', direction: 'input', presence: [/thunderbolt/i], label: 'PC接続' },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(USB_C, 'i')], label: 'PC接続' },
      { type: 'USB_A', direction: 'input', presence: [/USB\s*3\.[012]|USB\s*2\.0|USB[-\s]?A/i], label: 'PC接続' },
      { type: 'Ethernet', direction: 'input', presence: [/NAS|ネットワーク対応|LAN接続/i] },
    ],
    minPorts: 1,
  },

  Printer: {
    exclude: /インク|トナー|用紙|ドラム|ケーブル|カートリッジ|部品|カバー/,
    require: /プリンター|プリンタ|複合機|ラベルライター|感熱/i,
    rules: [
      { type: 'USB_A', direction: 'input', presence: [/USB\s*(?:接続|2\.[0-9]|3\.[0-9]|ポート|インターフェ)/i], label: 'PC接続' },
      { type: 'WiFi', direction: 'input', presence: [/Wi-?Fi|無線LAN|ワイヤレス/i] },
      { type: 'Ethernet', direction: 'input', presence: [/有線LAN|Ethernet|LANポート/i] },
      { type: 'Power', direction: 'input', presence: [/AC\s*電源|電源コード|消費電力|電源電圧/i], label: '給電 (コンセント)' },
    ],
    minPorts: 2,
  },

  Projector: {
    exclude: /スクリーン|天吊|マウント|ランプ|ケーブル|カバー/,
    require: /プロジェクター|プロジェクタ/i,
    rules: [
      { type: 'HDMI', direction: 'input', supportsVideo: true, count: countPatterns(HDMI, 3), presence: [/HDMI/i] },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(`${USB_C}\\s*(?:入力|映像|接続)`, 'i')] },
      { type: 'Audio3_5mm', direction: 'output', presence: [/3\.5\s*mm|音声出力|イヤホン/i] },
    ],
    minPorts: 1,
  },

  StreamingDevice: {
    allowDefaultsOnly: true,
    exclude: /ケーブル|変換|カバー/,
    require: /Fire\s*TV|Chromecast|Apple\s*TV|ストリーミング|メディアプレーヤー/i,
    rules: [
      { type: 'HDMI', direction: 'output', supportsVideo: true, fallback: 1 },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(USB_C, 'i'), /給電|電源/], fallback: 1, label: '給電 (C)' },
      { type: 'Ethernet', direction: 'input', presence: [/有線LAN|Ethernet/i] },
      { type: 'WiFi', direction: 'input', fallback: 1 },
    ],
    minPorts: 2,
  },

  SmartHome: {
    exclude: NOT_A_DEVICE,
    rules: [
      { type: 'WiFi', direction: 'input', presence: [/Wi-?Fi|無線LAN|スマート|Alexa|Google\s*Home|Matter/i] },
      { type: 'Bluetooth', direction: 'output', presence: [/Bluetooth|ブルートゥース/i] },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(`${USB_C}\\s*(?:給電|電源|充電)`, 'i')], label: '給電 (C)' },
      { type: 'Ethernet', direction: 'input', presence: [/有線LAN|LANポート/i] },
    ],
    minPorts: 1,
  },

  Light: {
    exclude: NOT_A_DEVICE,
    require: /ライト|照明|デスクライト|LED|ランプ/i,
    rules: [
      { type: 'USB_C', direction: 'output', presence: [new RegExp(`${USB_C}\\s*(?:給電|電源|接続)`, 'i')] },
      { type: 'USB_A', direction: 'output', presence: [/USB\s*給電|USB電源|USB接続/i] },
      { type: 'WiFi', direction: 'input', presence: [/Wi-?Fi|スマート|Alexa|Matter/i] },
      { type: 'Bluetooth', direction: 'output', presence: [/Bluetooth/i] },
    ],
    minPorts: 1,
  },

  MonitorArm: {
    allowDefaultsOnly: true,
    exclude: /ケーブル|パーツ|補修|クランプ単体/,
    rules: [
      { type: 'MonitorArm', direction: 'output', count: [/(\d)\s*画面|デュアル()/], fallback: 1, label: 'モニター支持' },
      { type: 'USB_C', direction: 'output', presence: [new RegExp(`${USB_C}\\s*(?:ポート|付)`, 'i')] },
      { type: 'USB_A', direction: 'output', presence: [/USB\s*(?:ポート|付|ハブ)/i] },
    ],
    minPorts: 1,
  },

  MicArm: {
    allowDefaultsOnly: true,
    exclude: /ケーブル|パーツ|補修/,
    rules: [
      { type: 'MicArm', direction: 'output', fallback: 1, label: 'マイク支持' },
    ],
    minPorts: 1,
  },

  // ── 周辺機器：接続方式1本で決まる ─────────────────────────────

  Mouse: {
    exclude: /ソール|フィート|パッド$|グリップテープ|交換用/,
    require: /マウス|mouse|トラックボール/i,
    connection: {
      wired: [{ type: 'USB_A', label: '有線接続 (USB-A)', patterns: [/./] }],
      wiredFallback: { type: 'USB_A', label: '有線接続 (USB-A)' },
      dongle: true,
    },
  },

  Controller: {
    exclude: /グリップ|スティックカバー|保護|充電スタンド$|収納/,
    require: /コントローラー|コントローラ|ゲームパッド|controller|ジョイ/i,
    connection: {
      wired: [
        { type: 'USB_C', label: '有線接続 (USB-C)', patterns: [new RegExp(USB_C, 'i')] },
        { type: 'USB_A', label: '有線接続 (USB-A)', patterns: [/USB/i] },
      ],
      wiredFallback: { type: 'USB_A', label: '有線接続 (USB-A)' },
      dongle: true,
    },
    rules: [
      // 定番機は接続方式を名前に書かない。DualSense / Proコン / Xbox はいずれも
      // Bluetooth 接続で、充電と有線接続を USB-C で兼ねる
      { type: 'Bluetooth', direction: 'bidirectional', presence: [/dual\s*sense|dualshock|joy-?con|switch\s*pro|xbox|8bitdo|プロコン/i] },
      { type: 'USB_C', direction: 'input', label: '有線接続 (USB-C)', presence: [/dual\s*sense|switch\s*pro|xbox\s*(?:series|elite|ワイヤレス)|8bitdo|プロコン/i] },
      { type: 'Audio3_5mm', direction: 'output', presence: [/イヤホンジャック|3\.5\s*mm|ヘッドセット端子/i] },
    ],
  },

  // ヘッドセットもここ。ゲーミングヘッドセットの USB-A 有線・2.4GHz レシーバーと、
  // オーディオ用ヘッドホンのバランス端子を1つのスペックで受ける
  Headphone: {
    exclude: /イヤーパッド|交換用|スタンド$|ケース$|ケーブル$|マイク単体/,
    require: /ヘッドホン|ヘッドフォン|headphone|ヘッドセット|headset/i,
    connection: {
      wired: [
        { type: 'Audio4_4mm', label: '有線接続 (4.4mm)', patterns: [/4\.4\s*mm|バランス接続/i] },
        { type: 'Audio6_3mm', label: '有線接続 (6.3mm)', patterns: [/6\.3\s*mm|標準プラグ|標準ジャック/i] },
        { type: 'USB_C', label: '有線接続 (USB-C)', patterns: [new RegExp(`${USB_C}\\s*(?:接続|有線)`, 'i')] },
        { type: 'USB_A', label: '有線接続 (USB-A)', patterns: [/USB\s*接続|USB\s*有線|USB\s*[-\s]?A/i] },
        { type: 'Audio3_5mm', label: '有線接続 (3.5mm)', patterns: [/3\.5\s*mm|ステレオミニ|ミニプラグ|4極/i] },
      ],
      wiredFallback: { type: 'Audio3_5mm', label: '有線接続 (3.5mm)' },
      // ゲーミングヘッドセットは 2.4GHz レシーバー同梱が主流。false のままだと
      // レシーバーをうたう商品が「別商品の記述を拾った」として丸ごと弾かれる
      dongle: true,
    },
    // 無線を一切名乗らないヘッドホンは有線。Bluetooth 機は名前で必ずうたうので取り違えにくい
    connectionFallbackRules: [
      { type: 'Audio3_5mm', direction: 'input', label: '有線接続 (3.5mm)', presence: [/ヘッドホン|ヘッドフォン|headphone|ヘッドセット|headset/i] },
    ],
  },

  Earphone: {
    exclude: /イヤーピース|交換用|ケース$|ケーブル$|スタンド/,
    require: /イヤホン|イヤフォン|earphone|earbuds|インイヤー/i,
    connection: {
      wired: [
        { type: 'Audio4_4mm', label: '有線接続 (4.4mm)', patterns: [/4\.4\s*mm|バランス/i] },
        { type: 'USB_C', label: '有線接続 (USB-C)', patterns: [new RegExp(`${USB_C}\\s*(?:接続|有線|イヤホン)`, 'i')] },
        { type: 'Audio3_5mm', label: '有線接続 (3.5mm)', patterns: [/3\.5\s*mm|ステレオミニ|ミニプラグ/i] },
      ],
      wiredFallback: { type: 'Audio3_5mm', label: '有線接続 (3.5mm)' },
      dongle: false,
    },
    connectionFallbackRules: [
      { type: 'Audio3_5mm', direction: 'input', label: '有線接続 (3.5mm)', presence: [/イヤホン|イヤフォン|earphone/i] },
    ],
  },

  Speaker: {
    exclude: new RegExp(`スタンド$|インシュレーター|ケーブル$|カバー|グリル|ユニット単体|${MUSIC_ACCESSORY.source}`, 'i'),
    // モニタースピーカーは「スピーカー」と書かず型番だけで売られている商品が多い
    require: new RegExp(`スピーカー|speaker|サウンドバー|${STUDIO_MONITOR.source}`, 'i'),
    variants: [{ match: STUDIO_MONITOR, spec: STUDIO_MONITOR_SPEC }],
    connection: {
      wired: [
        { type: 'Audio3_5mm', label: '有線接続 (3.5mm)', patterns: [/3\.5\s*mm|ステレオミニ|AUX/i] },
        { type: 'USB_A', label: '有線接続 (USB-A)', patterns: [/USB\s*(?:接続|電源|給電)/i] },
      ],
      wiredFallback: { type: 'Audio3_5mm', label: '有線接続 (3.5mm)' },
      dongle: false,
    },
    rules: [
      // パッシブスピーカーはアンプからスピーカーケーブルで鳴らす。自分では音源を受けない
      // 「パッシブ」と明記されたものだけ。ここを緩めると Bluetooth スピーカーにアンプが要る配線が出る
      { type: 'SpeakerTerminal', direction: 'input', presence: [/パッシブスピーカー|パッシブ型|パッシブ\s*スピーカー/i] },
      // 「有線」と書かずに入力端子だけ挙げるスピーカーが多い
      { type: 'Audio3_5mm', direction: 'input', presence: [/AUX|ライン入力|3\.5\s*mm|ステレオミニ/i] },
      { type: 'USB_A', direction: 'input', presence: [/USBオーディオ|USB\s*給電|USB\s*電源/i] },
      { type: 'RCA', direction: 'input', presence: [/RCA|ピンプラグ|赤白/i], max: 2 },
      { type: 'OpticalAudio', direction: 'input', presence: [/光デジタル|オプティカル|TOSLINK/i] },
      { type: 'XLR', direction: 'input', presence: [/XLR|キャノン端子/i], max: 2 },
    ],
  },

  Webcam: {
    exclude: /カバー|マウント|三脚|リングライト$/,
    require: /ウェブカメラ|webカメラ|web\s*cam|カメラ/i,
    connection: {
      wired: [
        { type: 'USB_C', label: '有線接続 (USB-C)', patterns: [new RegExp(USB_C, 'i')] },
        { type: 'USB_A', label: '有線接続 (USB-A)', patterns: [/USB/i] },
      ],
      wiredFallback: { type: 'USB_A', label: '有線接続 (USB-A)' },
      dongle: false,
    },
    rules: [
      // ウェブカメラは事実上すべてUSB接続。無線と書かれていなければ有線として扱ってよい
      { type: 'USB_C', direction: 'input', label: '有線接続 (USB-C)', presence: [new RegExp(`${USB_C}\\s*(?:接続|ケーブル)`, 'i')] },
      { type: 'USB_A', direction: 'input', label: '有線接続 (USB-A)', presence: [/USB/i] },
    ],
  },

  Microphone: {
    exclude: /マイクアーム|ポップガード|ウィンドスクリーン|ショックマウント|スタンド$|ケーブル$/,
    require: /マイク|microphone|コンデンサー|ダイナミックマイク/i,
    rules: [
      // XLRマイクはオーディオインターフェース／ミキサーが要る。USBマイクはPC直結。配線が全く変わる
      { type: 'XLR', direction: 'output', presence: [/XLR|キャノン|ファンタム/i] },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(`${USB_C}`, 'i')], label: 'PC接続' },
      { type: 'USB_A', direction: 'input', presence: [/USB(?![-\s]?C)/i], label: 'PC接続' },
      { type: 'Audio3_5mm', direction: 'output', presence: [/3\.5\s*mm|イヤホンジャック|モニター出力/i] },
    ],
    minPorts: 1,
  },

  PenTablet: {
    exclude: /ペン先|替え芯|保護フィルム|グローブ|スタンド$|ケース$/,
    require: /ペンタブ|液タブ|板タブ|タブレット/i,
    rules: [
      { type: 'HDMI', direction: 'input', supportsVideo: true, presence: [/液晶ペンタブ|液タブ|HDMI/i] },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(USB_C, 'i')], label: 'PC接続' },
      { type: 'USB_A', direction: 'input', presence: [/USB(?![-\s]?C)/i], label: 'PC接続' },
      { type: 'Bluetooth', direction: 'output', presence: [/Bluetooth|ワイヤレス|無線/i] },
    ],
    minPorts: 1,
  },

  // ── 機種が分かれば口も決まるもの ──────────────────────────────

  GameConsole: {
    // このカテゴリはゲームソフトと周辺品が大半を占める。「本体」か型番が無いものは触らない
    exclude: /ソフト|カセット|保護|ケース|収納|グリップ|スタンド|カバー|フィルム|ポーチ|バッグ|修理|パーツ|交換|Joy-?Con|コントローラー|充電|ケーブル|北米版|輸入版|限定版|ダウンロード|amiibo/i,
    require: /(?:本体|console)|CFI-\d|CUH-\d|HEG-|HAD-|HAC-|RRT-\d|Steam\s*Deck|ROG\s*Ally|(?:Switch|Xbox|PS5|PS4)\s*(?:本体|ドック|dock)/i,
    allowDefaultsOnly: true,
    rules: [
      // 据置機はテレビへHDMI、携帯機は本体にHDMIが無い。この差が配線図の形を決める
      { type: 'HDMI', direction: 'output', supportsVideo: true, presence: [/PS5|PS4|プレイステーション|PlayStation|Xbox|ドック|dock/i] },
      { type: 'USB_A', direction: 'output', presenceCount: 3, presence: [/Xbox/i] },
      { type: 'USB_A', direction: 'output', presenceCount: 2, presence: [/PS5|PS4|プレイステーション|PlayStation|ドック|dock/i] },
      { type: 'USB_C', direction: 'bidirectional', presence: [/Switch|スイッチ|Steam\s*Deck|ROG\s*Ally/i], label: '本体USB-C' },
      { type: 'Ethernet', direction: 'input', presence: [/PS5|PS4|プレイステーション|PlayStation|Xbox|ドック|dock/i] },
      { type: 'XboxWireless', direction: 'bidirectional', presence: [/Xbox/i], label: 'Xbox Wireless' },
      { type: 'XboxExpansion', direction: 'output', presence: [/Xbox\s*Series/i], label: 'ストレージ拡張スロット' },
      { type: 'microSDCard', direction: 'input', presence: [/Switch|スイッチ|Steam\s*Deck|ROG\s*Ally/i] },
      // 据置機だけ電源入力を持たせる。登録（gadgetFromProduct）はこの有無で据置／携帯を復元する
      { type: 'Power', direction: 'input', presence: [/PS5|PS4|プレイステーション|PlayStation|Xbox|ドック|dock/i], label: '給電 (コンセント)' },
      { type: 'Bluetooth', direction: 'output', presence: [/PS5|PS4|プレイステーション|PlayStation|Switch|スイッチ|Steam\s*Deck|ROG\s*Ally/i] },
    ],
    minPorts: 2,
  },

  Smartphone: {
    exclude: /ケース|フィルム|カバー|バンパー|リング|ストラップ|充電器|ケーブル|部品|パネル|バッテリー交換/,
    require: /iPhone|Galaxy|Pixel|Xperia|AQUOS|arrows|スマートフォン|スマホ本体|Redmi|OPPO/i,
    allowDefaultsOnly: true,
    rules: [
      // iPhone 15 より前は Lightning。ここを取り違えるとケーブルが丸ごと変わる
      { type: 'Lightning', direction: 'input', presence: [/iPhone\s*(?:SE|X[SR]?|[5-9](?!\d)|1[0-4])/i] },
      { type: 'USB_C', direction: 'input', presence: [/iPhone\s*1[5-9]|Galaxy|Pixel|Xperia|AQUOS|arrows|Redmi|OPPO|USB[-\s]?C|Type[-\s]?C/i] },
      { type: 'Bluetooth', direction: 'output', fallback: 1 },
    ],
    minPorts: 2,
  },

  Tablet: {
    exclude: /ケース|フィルム|カバー|スタンド$|ペン先|キーボードケース|部品/,
    require: /iPad|タブレット|Galaxy\s*Tab|Xperia\s*Tablet|Fire\s*HD|Lenovo\s*Tab/i,
    allowDefaultsOnly: true,
    rules: [
      { type: 'Lightning', direction: 'input', presence: [/iPad(?!\s*(?:Pro|Air|mini\s*[67]|10|11))/i] },
      { type: 'USB_C', direction: 'input', presence: [/iPad\s*(?:Pro|Air|mini\s*[67]|10|11)|Galaxy\s*Tab|Fire\s*Max|Lenovo\s*Tab|Android|タブレット|USB[-\s]?C|Type[-\s]?C/i] },
      { type: 'Bluetooth', direction: 'output', fallback: 1 },
    ],
    minPorts: 2,
  },

  Monitor: {
    exclude: /モニターアーム|アーム|スタンド$|フィルム|カバー|テレビ|チューナー|ケーブル|フード/,
    require: /モニター|ディスプレイ|液晶/i,
    allowDefaultsOnly: true,
    rules: [
      { type: 'HDMI', direction: 'input', supportsVideo: true, count: countPatterns(HDMI, 4), presence: [/HDMI/i], fallback: 1 },
      { type: 'DisplayPort', direction: 'input', supportsVideo: true, count: countPatterns(DP, 3), presence: [new RegExp(DP, 'i')] },
      { type: 'USB_C', direction: 'input', supportsVideo: true, presence: [new RegExp(`${USB_C}\\s*(?:入力|接続|映像|1本|給電)|USB[-\\s]?C\\s*ハブ|Type[-\\s]?C\\s*(?:対応|搭載)`, 'i')] },
      { type: 'USB_A', direction: 'output', count: countPatterns(USB_A, 4), presence: [/USBハブ|USB\s*ハブ/i] },
      { type: 'Audio3_5mm', direction: 'output', presence: [/ヘッドホン端子|イヤホン端子|音声出力/i] },
      { type: 'Power', direction: 'input', fallback: 1, label: '給電 (コンセント)' },
    ],
    minPorts: 2,
  },

  MobileBattery: {
    allowDefaultsOnly: true,
    exclude: /ケース|ケーブル$|交換用|内蔵|ノートPC用バッテリー|純正バッテリー/,
    require: /モバイルバッテリー|power\s*bank|充電バッテリー|ポータブル電源|PowerCore|SmartCoby|cheero|RAVPower|MagGo/i,
    rules: [
      // 入出力兼用のUSB-Cが1口だけ、という構成が今は主流
      { type: 'USB_C', direction: 'bidirectional', presence: [new RegExp(USB_C, 'i')], fallback: 1, label: 'USB-C 入出力' },
      { type: 'USB_A', direction: 'output', count: countPatterns(USB_A, 3), presence: [/USB(?![-\s]?C)/i] },
      { type: 'wirelessCharging', direction: 'output', presence: [/MagSafe|マグネット式|ワイヤレス充電|Qi2?/i], label: 'ワイヤレス出力' },
      { type: 'Lightning', direction: 'input', presence: [/Lightning|ライトニング/i] },
    ],
    minPorts: 1,
  },

  // ── オーディオ機器：入出力の系統数が配線図そのもの ───────────

  AudioInterface: {
    allowDefaultsOnly: true,
    exclude: new RegExp(`${NOT_A_DEVICE.source}|${MUSIC_ACCESSORY.source}`, 'i'),
    // 型番だけで売られている定番機（Scarlett・UR22・Volt など）を本体として拾う
    require: /オーディオインターフェ|audio\s*interface|オーディオI\/F|オーディオIF|Scarlett|\bUR\d{2}\b|Apollo\s*(?:Twin|Solo|X)|Babyface|Clarett|Volt\s*\d|\bAG0[36]\b|MOTU\s*M\d|Duo\s*Capture|Rubix\d/i,
    rules: [
      { type: 'USB_C', direction: 'input', presence: [new RegExp(USB_C, 'i')], label: 'PC接続' },
      { type: 'USB_B', direction: 'input', presence: [/USB\s*[-\s]?B|USB2\.0\s*Type-?B|USB/i], fallback: 1, label: 'PC接続' },
      { type: 'XLR_TRS_Combo', direction: 'input', count: [/(\d)\s*(?:イン|IN|入力|マイク入力)/i], presence: [/コンボ|combo|マイク入力|XLR/i], fallback: 1, max: 8 },
      // ヘッドホン出力もモニター出力も同じ 6.3mm。toPorts は端子型が同じ口をまとめるので、
      // 別々に書かず本数で表す。モニターL/R とヘッドホンで最低3口あり、
      // これを1口にするとスピーカーへ線が引けず「IFはあるのに音の出口が無い」図になる。
      // 「2アウト」のような表記があれば、その本数にヘッドホン分を足す。
      { type: 'Audio6_3mm', direction: 'output', count: [/(\d)\s*(?:アウト|OUT|出力)/i], countOffset: 1, fallback: 3, max: 8, label: 'モニター/ヘッドホン出力' },
      { type: 'MIDI', direction: 'input', presence: [/MIDI/i] },
    ],
    minPorts: 2,
  },

  Mixer: {
    allowDefaultsOnly: true,
    // 型番が本体と同じアクセサリ（機種用ケース等）は派生に落ちないので、本体側でも弾く
    exclude: new RegExp(`${NOT_A_DEVICE.source}|${DJ_ACCESSORY.source}`, 'i'),
    // DJ機材（コントローラー・プレーヤー・ターンテーブル）は名前に「ミキサー」を含まないため、
    // 型番を require に入れないとカテゴリごと素通りしてポートが空のままになる
    require: /ミキサー|mixer|ミキシング|DJ\s*コントローラ|ターンテーブル|CDJ-|DDJ-|XDJ-|DJM-|PLX-/i,
    variants: DJ_GEAR_VARIANTS,
    rules: [
      { type: 'XLR', direction: 'input', count: [/(\d)\s*(?:マイク入力|XLR)/i], presence: [/XLR|マイク入力|コンボ/i], fallback: 2, max: 8 },
      { type: 'USB_C', direction: 'input', presence: [new RegExp(USB_C, 'i')], label: 'PC接続' },
      { type: 'USB_B', direction: 'input', presence: [/USB/i], label: 'PC接続' },
      { type: 'Audio6_3mm', direction: 'output', presence: [/ヘッドホン(?:端子|出力)/i], fallback: 1, label: 'ヘッドホン出力' },
      { type: 'RCA', direction: 'output', presence: [/RCA出力|ライン出力/i], max: 2 },
    ],
    minPorts: 2,
  },

  HeadphoneAmp: {
    exclude: NOT_A_DEVICE,
    require: /ヘッドホンアンプ|DAC|ポタアン|アンプ/i,
    rules: [
      { type: 'USB_C', direction: 'input', presence: [new RegExp(USB_C, 'i')], label: '入力 (USB-C)' },
      { type: 'USB_B', direction: 'input', presence: [/USB\s*[-\s]?B/i], label: '入力 (USB-B)' },
      { type: 'OpticalAudio', direction: 'input', presence: [/光デジタル|オプティカル|TOSLINK/i] },
      { type: 'CoaxialAudio', direction: 'input', presence: [/同軸|コアキシャル/i] },
      { type: 'RCA', direction: 'input', presence: [/RCA入力|ライン入力/i], max: 2 },
      { type: 'Audio6_3mm', direction: 'output', presence: [/6\.3\s*mm|標準ジャック|ヘッドホン出力/i], fallback: 1, label: 'ヘッドホン出力' },
      { type: 'Audio4_4mm', direction: 'output', presence: [/4\.4\s*mm|バランス出力/i] },
    ],
    minPorts: 2,
  },

  Amplifier: {
    exclude: NOT_A_DEVICE,
    require: /プリメインアンプ|パワーアンプ|アンプ|receiver|レシーバー/i,
    rules: [
      // アンプの本体はスピーカー端子。ここが無いとパッシブスピーカーが鳴らせない
      { type: 'SpeakerTerminal', direction: 'output', fallback: 1 },
      { type: 'RCA', direction: 'input', presence: [/RCA|ライン入力|AUX/i], max: 2 },
      { type: 'OpticalAudio', direction: 'input', presence: [/光デジタル|オプティカル/i] },
      { type: 'CoaxialAudio', direction: 'input', presence: [/同軸|コアキシャル/i] },
      { type: 'USB_B', direction: 'input', presence: [/USB\s*DAC|USB\s*[-\s]?B/i] },
      { type: 'Bluetooth', direction: 'input', presence: [/Bluetooth/i] },
      { type: 'Audio6_3mm', direction: 'output', presence: [/ヘッドホン(?:端子|出力)/i], label: 'ヘッドホン出力' },
    ],
    minPorts: 2,
  },

  Instrument: {
    exclude: new RegExp(`ケース|ソフトケース|スタンド$|ストラップ|ピック|弦\\b|クリーナー|譜面台|椅子|カバー|教則|${MUSIC_ACCESSORY.source}`, 'i'),
    require: new RegExp(`MIDIキーボード|シンセ|電子ピアノ|キーボード\\s*\\d{2}鍵|\\d{2}鍵盤|ドラム|ギター|ベース|楽器|MPK|MPC|MIDI|${MIDI_KEYBOARD.source}`, 'i'),
    // 鍵盤・シンセはPC接続が前提。アコースティック楽器と同じ既定値では配線が出ない
    variants: [
      { match: MIDI_KEYBOARD, spec: MIDI_KEYBOARD_SPEC },
      { match: DIGITAL_PIANO, spec: DIGITAL_PIANO_SPEC },
    ],
    rules: [
      { type: 'USB_C', direction: 'input', presence: [new RegExp(`${USB_C}`, 'i')], label: 'PC接続' },
      { type: 'USB_B', direction: 'input', presence: [/USB\s*[-\s]?B|USB\s*MIDI|USB接続|MIDI/i], label: 'PC接続' },
      { type: 'MIDI', direction: 'output', presence: [/MIDI\s*(?:OUT|出力|端子)/i] },
      { type: 'Audio6_3mm', direction: 'output', presence: [/フォーン|標準ジャック|LINE\s*OUT|出力端子|アウトプット/i] },
      { type: 'Audio3_5mm', direction: 'output', presence: [/ヘッドホン端子|イヤホン端子/i] },
      { type: 'Bluetooth', direction: 'output', presence: [/Bluetooth/i] },
    ],
    minPorts: 1,
  },
}


/** ラベルはフォーム側が付け直すので、口が増えたかの判定には使わない */
function portIdentity(port: Port): string {
  return `${port.type}/${port.direction}/${port.count}/${port.directAttach ? 'direct' : ''}`
}

const isReceiverPort = (port: Port) =>
  port.type === 'USB_A' && port.direction === 'input' &&
  /レシーバー|ドングル|receiver|dongle|Unifying|LIGHTSPEED|Logi Bolt/i.test(port.label ?? '')

/**
 * 予測変換で選んだあと、ユーザーがそのまま保存したら口が増えるか。
 * 増えるということは、フォームが表現できない構成を商品DB側が持っているということで、
 * 図に存在しないケーブルが引かれる。書き込み前と点検の両方でこれを見る。
 */
export function wouldGrowOnSave(category: GadgetCategory, ports: Port[]): boolean {
  const stored = new Set(ports.map(portIdentity))
  return rebuildOnSave(category, ports).some((port) => !stored.has(portIdentity(port)))
}

/** 予測変換で選んだ構成を、フォームがそのまま保存したときの ports を再現する */
export function rebuildOnSave(category: GadgetCategory, ports: Port[]): Port[] {
  const receiver = ports.find(isReceiverPort)
  const connection = receiver ? 'dongle' : ports.some((port) => port.type === 'Bluetooth') ? 'wireless' : 'wired'
  const countOf = (type: PortType, direction: PortDirection) =>
    ports.find((port) => port.type === type && port.direction === direction)?.count ?? 0
  const outlet = ports.find((port) => port.type === 'Power' && port.direction === 'output')
  return buildGadgetPorts({
    category,
    portState: initPortState(ports, CATEGORY_PORT_CONFIG[category] ?? []),
    mouseConnType: connection,
    periConnType: connection,
    receiverLabel: receiver?.label ?? '',
    receiverSupportsBluetooth: !!receiver && ports.some((port) => port.type === 'Bluetooth'),
    powerInput: 'none',
    charge: { usbC: countOf('USB_C', 'output'), usbA: countOf('USB_A', 'output'), wirelessCount: countOf('wirelessCharging', 'output') },
    strip: {
      outlets: outlet?.count ?? 0,
      usbC: countOf('USB_C', 'output'),
      usbA: countOf('USB_A', 'output'),
      grounded: outlet?.label?.includes('アース') ?? false,
    },
  })
}

/** ルール1件を本文に当てて、作るポートを決める */
export function applyRule(text: string, rule: PortRule): MatchedRule | null {
  for (const pattern of rule.count ?? []) {
    const match = pattern.exec(text)
    if (!match) continue
    const value = Number(match.slice(1).find((group) => group && /^\d+$/.test(group)))
    if (!Number.isInteger(value) || value <= 0) continue
    const adjusted = value + (rule.countOffset ?? 0)
    if (adjusted <= 0) continue
    const capped = Math.min(adjusted, rule.max ?? 8)
    return { ...toPortShape(rule), count: capped, evidence: match[0].trim() }
  }
  for (const pattern of rule.presence ?? []) {
    const match = pattern.exec(text)
    if (match) return { ...toPortShape(rule), count: rule.presenceCount ?? 1, evidence: match[0].trim() }
  }
  if (rule.fallback) return { ...toPortShape(rule), count: rule.fallback, evidence: '既定値' }
  return null
}

/** 上位機器につなぐ口につけるラベル。1機器に1本しか無い */
function isConnectionLabel(label: string | undefined): boolean {
  return !!label && /^(?:ホスト接続|PC接続|有線接続)/.test(label)
}

function toPortShape(rule: PortRule): Omit<MatchedRule, 'count' | 'evidence'> {
  return {
    type: rule.type,
    direction: rule.direction,
    label: rule.label,
    supportsVideo: rule.supportsVideo,
    supportsPowerDelivery: rule.supportsPowerDelivery,
    supportsPoE: rule.supportsPoE,
  }
}

/**
 * 同じ type / direction の重複を落として Port[] にする（先に決まったものを優先）。
 * ラベル違いを別の口として残すと、3モード対応マウスの「レシーバー」と「有線接続」のように
 * 実際には排他の口が2本並んでしまう。
 */
export function toPorts(matched: MatchedRule[]): Port[] {
  const seen = new Set<string>()
  const ports: Port[] = []
  for (const rule of matched) {
    const key = `${rule.type}/${rule.direction}`
    if (seen.has(key)) continue
    // 上位機器へつなぐ口は1本しかない。ドックのホスト側やストレージのPC接続で
    // USB-C と USB-A の両方が書かれていても、先に当たったほうだけを採る
    if (isConnectionLabel(rule.label) && ports.some((port) => isConnectionLabel(port.label))) continue
    seen.add(key)
    ports.push({
      id: `p${ports.length + 1}`,
      type: rule.type,
      direction: rule.direction,
      count: rule.count,
      ...(rule.label ? { label: rule.label } : {}),
      ...(rule.supportsVideo ? { supportsVideo: true } : {}),
      ...(rule.supportsPowerDelivery ? { supportsPowerDelivery: true } : {}),
      ...(rule.supportsPoE ? { supportsPoE: true } : {}),
      ...(rule.directAttach ? { directAttach: true } : {}),
    })
  }
  return ports
}
