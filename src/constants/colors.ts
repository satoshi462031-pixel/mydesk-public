// UI の面・文字・線の色トークン。アクセントは constants/accentColors.ts が正本で、
// AppContext が塗り・アイコン・文字・塗り上の文字を実行時に上書きする。
//
// React に依存させない：scripts/auditColors.ts がここを直接読んでコントラストを
// 検証するため、AppContext.tsx（AsyncStorage・expo-localization を引く）に
// 置いたままでは Node から import できない。

import type { GadgetCategory } from '../types'
import { normalizeCustomCategoryColor } from '../utils/customCategory'
import { statusTextColor } from './ui'

export interface AppColors {
  bg: string
  bgList: string
  card: string
  text: string
  textSub: string
  textMuted: string
  border: string
  separator: string
  divider: string
  accent: string
  /** 中立背景の上の操作アイコン・選択線。塗りの accent と分けて 3:1 を確保する */
  accentIcon: string
  accentText: string
  /**
   * テーマに関係なく常に黒い面（写真の全画面表示・アイコンの切り抜き）の上の accent の文字。
   * accentText はライトでは白地向けに暗くした色なので、黒地に載せると沈む
   */
  accentTextOnDark: string
  /** accent を塗りにした面（ボタン・チップ）の上に載せる文字・アイコンの色 */
  onAccent: string
  header: string
  input: string
  inputBorder: string
  danger: string
  success: string
  /** 「共有」バッジなど、危険でも成功でもない補足情報。danger と同じくテーマごとに持つ */
  info: string
  /** 新着・更新の表示と更新操作はテーマカラーに依存しない青で揃える */
  update: string
  onUpdate: string
  tabBar: string
  tabBarBorder: string
  chevron: string
  chip: string
  /**
   * 2〜4択の切り替え（atoms/SegmentedControl）の地と、選ばれた側の面。iOS のセグメントと同じく
   * 選択は accent で塗らず、地から一段浮いた中立の面で示す（accent の塗りは「押すと実行」のボタンに残す）
   */
  segmentTrack: string
  segmentSelected: string
  /** 拍手済みの手。両モードとも #FFD400 */
  clap: string
  /** 写真上の暗い面に載る拍手済みの手・タップ時の演出 */
  onClap: string
  /** 拍手済みの黄色い丸（clap の塗り）の上の手。黄色はどちらのモードでも明るいので両モードとも暗い色 */
  onClapFill: string
  /** 保存済みのアイコン（X の青）。テーマカラーで変えない。ライトは白い面で 3:1 を出せる濃さ */
  saved: string
  /** お気に入り済みの星。テーマカラーに依存しない金色 */
  favorite: string
  /** 未読・新着の点。iOS のバッジと同じ赤で、テーマカラーで変えない（赤い点＝新着は端末全体で覚えられている合図） */
  unread: string
  /**
   * Pro の印（王冠）。テーマカラーで変えない（ほかのボタンと同じ色だと「ここから先は Pro」が見分けにくい）。
   * アイコン用。両モードとも #FFD400
   */
  pro: string
}

const ON_CLAP_DEFAULT = '#FFC94A'
const ON_CLAP_FILL = '#0F1111'

// 黄の基準。白い面で 3:1 に届く黄は存在せず（届く明度では金〜からし色になる）、
// 金寄りにしたら「暗い」、縁取りを付けたら「影みたい」と言われた。本人が示した見本の
// #FFD400 を基準に、淡い黄も同じ濃さの鮮やかな黄へ揃え、白に埋もれる淡さだけをなくす。
// コントラストの基準（3:1）は満たさない。監査とテストで例外として明記している
// 色相や明度を系統ごとに残すと、金寄りは淡く（#FFD255）、レモン寄りは緑がかって白に負けたので1色にする
export const YELLOW_REFERENCE = '#FFD400'

export function buildColors(isDark: boolean): AppColors {
  if (isDark) {
    return {
      // 面の段階は「土台 #000 → カード #2C2C2E」の2段のみ。
      // bg / bgList / header / tabBar をすべて #000 に揃え、画面ごとに
      // 真っ黒と灰色が混在しないようにする。
      bg:           '#000000',
      bgList:       '#000000',
      card:         '#2C2C2E',
      text:         '#FFFFFF',
      textSub:      '#C2C2C8',
      textMuted:    '#A3A3A8',
      // 線は card(#2C2C2E) 上でコントラスト 1.5 を確保できる明度まで上げる
      border:       '#48484A',
      separator:    '#48484A',
      divider:      '#48484A',
      accent:       '#F59F40',
      accentIcon:   accentIconColor('#F59F40', true),
      accentText:   '#FFFFFF',   // プリセットで動的に上書きされる
      accentTextOnDark: '#F7B65D', // 同上
      onAccent:     '#0F1111',   // 同上
      header:       '#000000',
      input:        '#3A3A3C',
      inputBorder:  '#848486',
      // 塗りに使う UI_STATUS_COLORS.danger と違い、こちらは card の上に載る「文字」。
      // #FF453A は card(#2C2C2E) 上で 4.09:1 しか出ない
      danger:       '#FF5950',
      success:      statusTextColor('success', true),
      info:         '#64A8FF',   // 暗い card の上で読めるよう明るめ
      update:       '#64A8FF',
      onUpdate:     '#0F1111',
      tabBar:       '#000000',
      tabBarBorder: '#38383A',
      chevron:      '#7C7C80',
      chip:         '#3A3A3C',
      // 地は card(#2C2C2E) より沈め、選ばれた側は iOS の systemGray2 まで浮かせる
      segmentTrack:    '#1C1C1E',
      segmentSelected: '#636366',
      clap:         YELLOW_REFERENCE,
      onClap:       ON_CLAP_DEFAULT,
      onClapFill:   ON_CLAP_FILL,
      saved:        '#1D9BF0',
      favorite:     YELLOW_REFERENCE,
      unread:       '#FF453A',
      pro:          YELLOW_REFERENCE,
    }
  }
  return {
    bg:           '#F2F2F7',
    bgList:       '#F2F2F7',
    card:         '#FFFFFF',
    text:         '#0F1111',
    textSub:      '#555555',
    textMuted:    '#6D6D74',
    // ダーク側と同じく「面の上でコントラスト 1.5」を満たす明度まで下げる。
    // #E0E0E0 は card(#FFF) 上で 1.32、bg(#F2F2F7) 上では 1.18 でほぼ見えない
    border:       '#C7C7C7',
    separator:    '#D0D0D0',
    divider:      '#C7C7C7',
    accent:       '#F59F40',
    accentIcon:   accentIconColor('#F59F40', false),
    accentText:   '#B54900',   // プリセットで動的に上書きされる
    accentTextOnDark: '#F7B65D', // 同上
    onAccent:     '#0F1111',   // 同上
    header:       '#FFFFFF',
    input:        '#FAFAFA',
    // 入力欄の地(#FAFAFA)は card(#FFFFFF) と 1.06:1 しかなく、「ここが入力欄」を
    // 示しているのは枠線だけ。装飾ではなく部品の識別情報なので、面の区切り線の
    // 1.5 ではなく非テキストUIの 3:1（WCAG 1.4.11）で引く
    inputBorder:  '#8B8B8B',
    danger:       '#C44133',   // 文字用。塗りは UI_STATUS_COLORS.danger
    success:      statusTextColor('success', false),
    info:         '#0066CC',   // 白い card の上で読めるよう濃いめ
    update:       '#0066CC',
    onUpdate:     '#FFFFFF',
    tabBar:       '#FFFFFF',
    tabBarBorder: '#D1D1D1',
    chevron:      '#C7C7CC',
    chip:         '#F2F2F2',
    // 地は bg(#F2F2F7) の上でも見える濃さ（iOS の systemGray5）、選ばれた側は白
    segmentTrack:    '#E5E5EA',
    segmentSelected: '#FFFFFF',
    // 写真の上に載る onClap は暗い地なので元の色
    clap:         YELLOW_REFERENCE,
    onClap:       ON_CLAP_DEFAULT,
    onClapFill:   ON_CLAP_FILL,
    // X の #1D9BF0 は白い card でちょうど 3.0、chip の上では 2.68 で割る
    saved:        '#0C7ABF',
    favorite:     YELLOW_REFERENCE,
    unread:       '#FF3B30',
    pro:          YELLOW_REFERENCE,
  }
}

// ─── カテゴリカラー ─────────────────────────────────────────────
// 将来の追加カテゴリに備えて余裕を持たせた色パレット
export const CATEGORY_COLORS: Record<string, string> = {
  // PC・モニター → 赤系
  PC:             '#B71C1C',
  Monitor:        '#C62828',
  TV:             '#CC3030',
  Projector:      '#D43838',
  MonitorArm:     '#D32F2F',
  Hub:            '#E53935',
  Dock:           '#F44336',
  Storage:        '#EF5350',
  KVM:            '#E57373',
  CaptureDevice:  '#EF9A9A',
  StreamingDevice:'#EF6B67',
  PCPart:         '#E85D5D',

  // ゲーム・VR → オレンジ系
  GameConsole:    '#EA6A10',
  Controller:     '#F47A19',
  VRGlass:        '#FC8925',

  // スマートデバイス → 黄緑系
  Smartphone:     '#9DDD32',
  Tablet:         '#A3E635',
  Smartwatch:     '#B5EE4F',

  // 周辺機器 → 緑系
  Mouse:          '#087F4F',
  MousePad:       '#0D8B58',
  Keyboard:       '#129360',
  PenTablet:      '#159D67',
  Webcam:         '#1FA76F',
  Camera:         '#2DB178',
  Lens:           '#3ABD83',
  Tripod:         '#4BC68D',
  Printer:        '#55CC96',
  Printer3D:      '#69D4A5',

  // オーディオ → 青系（900→100 の単調グラデーション）
  Headphone:      '#0D47A1',
  Earphone:       '#1565C0',
  Speaker:        '#1976D2',
  Microphone:     '#1E88E5',
  MicArm:         '#2196F3',
  AudioInterface: '#42A5F5',
  HeadphoneAmp:   '#64B5F6',
  Amplifier:      '#4FA3E3',
  Mixer:          '#90CAF9',
  Instrument:     '#BBDEFB',

  // ネットワーク・電源 → 黄色系
  Router:         '#FFD21A',
  NetworkSwitch:  '#FFDA24',
  Modem:          '#FFE02E',
  Charger:        '#FFE638',
  MobileBattery:  '#FFEA45',
  PowerStrip:     '#FFEE52',
  UPS:            '#FFF164',
  Cable:          '#FFF476',

  // デスク環境・照明 → 紫系（900→500 の単調グラデーション）
  Desk:           '#4A148C',
  Chair:          '#6A1B9A',
  Furniture:      '#70209F',
  Light:          '#7B1FA2',
  WallPanel:      '#8E24AA',
  DeskPad:        '#962AB0',
  SmartHome:      '#9C27B0',

  // その他 → グレー系
  SmallDevice:    '#707070',
  Accessory:      '#818181',
  Plant:          '#909090',
  Other:          '#9E9E9E',
} satisfies Record<GadgetCategory, string>

// ─── コントラスト計算 ───────────────────────────────────────────
// WCAG 2.1 の相対輝度と比。scripts/auditColors.ts もここから引く（計算式を
// 2箇所に持つと、監査が通っているのに実物が違うという状態になる）。

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return 0
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(m[1].slice(offset, offset + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** 黄・金・ライム・明るいオレンジ。色相を保って暗くすると黄土色になるので、黄は #FFD400、ほかはライトで vividWarmColor へ */
export function isBrightWarmColor(color: string): boolean {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return false
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  if (max < 0.8 || delta / max < 0.4) return false
  const hue = max === r ? 60 * ((g - b) / delta) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4)
  return hue >= 30 && hue <= 100
}

/** 各チャンネルを同じ比率で動かす（色相・彩度の関係を保ったまま明暗だけ変える） */
function shiftToward(hex: string, amount: number, toward: 'black' | 'white'): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(m[1].slice(offset, offset + 2), 16)
    const next = toward === 'white' ? value + (255 - value) * amount : value * (1 - amount)
    return Math.round(next).toString(16).padStart(2, '0')
  })
  return `#${channels.join('')}`
}

// ─── OKLCH ──────────────────────────────────────────────────────
// ライトで色を暗くするとき、色相と彩度を保ったまま明度だけを動かすために使う。
// RGB の3チャンネルを同じ比率で黒へ寄せる方式（shiftToward）だと、淡い色ほど彩度が抜けて
// 灰色に寄り、黄色はオリーブ色に濁る（Cable #FFD54F が #a48937、Instrument #BBDEFB が #768d9e）。

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/** 16進の色を OKLCH へ。L は明度（0〜1）、C は彩度、H は色相（ラジアン） */
export function hexToOklch(hex: string): { L: number; C: number; H: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return { L: 0, C: 0, H: 0 }
  const [r, g, b] = [0, 2, 4].map((offset) => srgbToLinear(parseInt(m[1].slice(offset, offset + 2), 16) / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s
  return {
    L: 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
    C: Math.hypot(A, B),
    H: Math.atan2(B, A),
  }
}

/** OKLCH から16進へ。sRGB の色域に収まらなければ null */
function oklchToHex(L: number, C: number, H: number): string | null {
  const A = C * Math.cos(H)
  const B = C * Math.sin(H)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  if (rgb.some((v) => v < -1e-4 || v > 1 + 1e-4)) return null
  return '#' + rgb
    .map((v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255).toString(16).padStart(2, '0'))
    .join('')
}

/** 明度 L・色相 H で、色域に収まる範囲でできるだけ C に近い彩度の色を返す */
function fitChroma(L: number, C: number, H: number): string {
  const exact = oklchToHex(L, C, H)
  if (exact) return exact
  let lo = 0
  let hi = C
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    if (oklchToHex(L, mid, H)) lo = mid
    else hi = mid
  }
  return oklchToHex(L, lo, H) ?? '#000000'
}

/**
 * 色相と彩度を保ったまま、背景 bg の上で target のコントラストに届く最小限だけ明度を下げる。
 * 色域に収まらなくなったぶんだけ彩度を削る。すでに届いていればそのまま返す。
 * 返す色は 16進に丸めたあとの値で target を満たすことを確かめてある
 */
function darkenKeepChroma(hex: string, bg: string, target: number): string {
  if (contrastRatio(hex, bg) >= target) return hex
  const o = hexToOklch(hex)
  let lo = 0          // 届く側（黒）
  let hi = o.L        // 届かない側（元の色）
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (contrastRatio(fitChroma(mid, o.C, o.H), bg) >= target) lo = mid
    else hi = mid
  }
  return fitChroma(lo, o.C, o.H)
}

const warmIconCache = new Map<string, string>()

const oklchHueDeg = (hex: string) => (hexToOklch(hex).H * 180) / Math.PI

/** 黄色の系統（金・レモンを含む）。オレンジ・ライムは含まない */
export function isYellowColor(color: string): boolean {
  if (!isBrightWarmColor(color)) return false
  const hue = oklchHueDeg(color)
  return hue >= 75 && hue <= 115
}

/**
 * オレンジ・ライムを、白い面で 3:1 に届く色へ動かす（黄は YELLOW_REFERENCE）。
 * 色相を保ったまま暗くすると黄土色・オリーブ色に濁るので、届く明度で彩度を最大まで上げる。
 * オレンジは 10° だけ赤へ寄せる。20° 寄せると microUSB（#F97316）と同じ朱色になり、配線で
 * 見分けられない。ライムは寄せるとかえってオリーブ色になるので寄せない。
 * 以前は色を変えず濃色の縁取りで 3:1 を取っていたが、縁が影に見えて違和感があった
 */
function vividWarmColor(hex: string, bg: string): string {
  const key = `${hex}|${bg}`
  const cached = warmIconCache.get(key)
  if (cached !== undefined) return cached
  if (contrastRatio(hex, bg) >= ICON_MIN_CONTRAST) return hex
  const o = hexToOklch(hex)
  const rotate = oklchHueDeg(hex) > 115 ? 0 : 10
  const H = o.H - (rotate * Math.PI) / 180
  let lo = 0
  let hi = o.L
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (contrastRatio(fitChroma(mid, 0.4, H), bg) >= ICON_MIN_CONTRAST) lo = mid
    else hi = mid
  }
  const result = fitChroma(lo, 0.4, H)
  warmIconCache.set(key, result)
  return result
}

// 補正の判定に使う面。補正はライトなら暗く・ダークなら明るく動かすので、
// 効きがいちばん悪いのは「ライト＝最も暗い面」「ダーク＝最も明るい面」。
// ここを満たせば card・bg・配線図の地でも足りる。
const ICON_BG_LIGHT = '#F2F2F2'   // chip
const ICON_BG_DARK = '#3A3A3C'    // chip / input
// 意味を持つ非テキストUI（WCAG 1.4.11）
const ICON_MIN_CONTRAST = 3

/** 半透明の背景を、背後の面に重ねたときの実際の色。 */
export function compositeColor(color: string, background: string): string {
  const alpha = parseInt(color.slice(7, 9), 16) / 255
  return '#' + [1, 3, 5].map((offset) => {
    const foreground = parseInt(color.slice(offset, offset + 2), 16)
    const behind = parseInt(background.slice(offset, offset + 2), 16)
    return Math.round(foreground * alpha + behind * (1 - alpha)).toString(16).padStart(2, '0')
  }).join('')
}

/** 選択色を薄く敷いた chip 上でも、操作アイコン・選択線を見分けられる色。 */
export function accentIconColor(color: string, isDark: boolean): string {
  // 色相を保ったまま暗くすると黄土色（#C37500）に濁るので、赤へ寄せて彩度を残した値を使う
  if (!isDark && color.toUpperCase() === '#F59F40') return '#E35E00'
  const background = compositeColor(color + '18', isDark ? ICON_BG_DARK : ICON_BG_LIGHT)
  if (!isDark) return darkenKeepChroma(color, background, ICON_MIN_CONTRAST)
  let adjusted = color
  for (let step = 0; step < 100 && contrastRatio(adjusted, background) < ICON_MIN_CONTRAST; step++) {
    adjusted = shiftToward(adjusted, 0.02, 'white')
  }
  return adjusted
}

const iconColorCache = new Map<string, string>()

/**
 * カテゴリ色・テンプレート色を、テーマの面の上で見える明度に補正する。
 *
 * CATEGORY_COLORS は「赤系=PC / 青系=オーディオ」のように系統で意味を持たせ、
 * 系統の中は 900→100 のグラデーションになっている。一律に暗く（明るく）すると
 * この段階が丸ごと潰れるので、**3:1 に足りない色だけ、届く最小量だけ**動かす。
 * 黄は両モードとも #FFD400（YELLOW_REFERENCE）。ライム・明るいオレンジは、ライトでは彩度を上げて 3:1 に届く色へ動かす（vividWarmColor）。
 * ライトは OKLCH で明度だけを下げ、色相と彩度を保つ（色域に収まらないぶんだけ彩度を削る）。
 * RGB を黒へ寄せる方式だと、淡い色が灰色に、黄色がオリーブ色に濁って、
 * ダークと並べたときに「ライトだけ暗くてくすんでいる」と見えた。ダークは従来どおり白へ寄せる。
 *
 * 以前はダーク時に一律 28% 白へ寄せるだけで、ライト時は何もしていなかった。
 * そのため各系統の淡い側（Instrument #BBDEFB で白い card 上 1.40:1）が
 * ライトモードでほぼ見えなかった。28% の底上げは今の見た目の基準なので残す。
 */
export function themeIconColor(color: string, isDark: boolean): string {
  if (isYellowColor(color)) return YELLOW_REFERENCE
  if (isBrightWarmColor(color)) return isDark ? color : vividWarmColor(color, ICON_BG_LIGHT)
  const cacheKey = `${color}|${isDark}`
  const cached = iconColorCache.get(cacheKey)
  if (cached !== undefined) return cached
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color

  let adjusted: string
  if (isDark) {
    adjusted = shiftToward(color, 0.28, 'white')
    for (let step = 0; step < 100 && contrastRatio(adjusted, ICON_BG_DARK) < ICON_MIN_CONTRAST; step++) {
      adjusted = shiftToward(adjusted, 0.02, 'white')
    }
  } else {
    adjusted = darkenKeepChroma(color, ICON_BG_LIGHT, ICON_MIN_CONTRAST)
  }

  iconColorCache.set(cacheKey, adjusted)
  return adjusted
}

/**
 * 器・チップ・札の地に薄く敷く色のもと。ライトは補正前の色、ダークは補正後（明るく持ち上げた色）。
 * ライトで補正後の色（3:1 まで暗くした色）を薄く敷くと、地まで茶色や灰色にくすんで
 * 「ライトだけ暗い」と見える。上に載せる絵・文字は themeIconColor のままで、地が明るくなるぶん
 * コントラストは上がる。
 */
export function themeTintBase(color: string, isDark: boolean): string {
  return isDark ? themeIconColor(color, true) : color
}

/** カテゴリ色をテーマ補正込みで引く（アイコンの実描画色に使う） */
export function categoryBaseColor(category: string, customColor?: string, fallback = '#888888'): string {
  const custom = category === 'Other' ? normalizeCustomCategoryColor(customColor) : undefined
  // 保存済みの旧プリセットも、データを書き換えずに新しい色で表示する。
  if (custom === '#ECC600') return '#FFD21A'
  if (custom === '#96B82A') return '#A3E635'
  return custom ?? CATEGORY_COLORS[category] ?? fallback
}

export const CUSTOM_CATEGORY_COLOR_PRESETS = [
  { color: '#E53935', ja: '赤', en: 'Red' },
  { color: '#F47A19', ja: 'オレンジ', en: 'Orange' },
  { color: '#FFD21A', ja: '黄', en: 'Yellow' },
  { color: '#A3E635', ja: '黄緑', en: 'Lime' },
  { color: '#159D67', ja: '緑', en: 'Green' },
  { color: '#2196F3', ja: '青', en: 'Blue' },
  { color: '#962AB0', ja: '紫', en: 'Purple' },
  { color: '#9E9E9E', ja: '灰色', en: 'Gray' },
] as const

export function categoryIconColor(category: string, isDark: boolean, fallback = '#888888', customColor?: string): string {
  const base = categoryBaseColor(category, customColor, fallback)
  if (!CATEGORY_COLORS[category] && !normalizeCustomCategoryColor(customColor)) return themeIconColor(fallback, isDark)
  if (isYellowColor(base)) return YELLOW_REFERENCE
  if (isBrightWarmColor(base)) {
    if (isDark) return base
    // 色を薄く敷いた器と chip の暗いほうで合わせれば、どちらに載っても 3:1 に届く
    const tint = compositeColor(base + '22', ICON_BG_LIGHT)
    return vividWarmColor(base, relativeLuminance(tint) < relativeLuminance(ICON_BG_LIGHT) ? tint : ICON_BG_LIGHT)
  }
  const custom = category === 'Other' && !!normalizeCustomCategoryColor(customColor)
  const cacheKey = `category|${category}|${base}|${isDark}|${custom}`
  const cached = iconColorCache.get(cacheKey)
  if (cached !== undefined) return cached
  // 両モードで同じ色を基本にする。ダークの白寄せで淡くなる差をなくし、
  // 暗いジャンルだけ、黒い面でも見える最小限の明度まで持ち上げる。
  // 既定色・自由色とも、色を薄く敷いた器の上で埋もれないようにする。
  const lightTint = compositeColor(base + '22', ICON_BG_LIGHT)
  const darkTint = compositeColor(base + '38', ICON_BG_DARK)
  const lightBackground = relativeLuminance(lightTint) < relativeLuminance(ICON_BG_LIGHT) ? lightTint : ICON_BG_LIGHT
  const darkBackground = relativeLuminance(darkTint) > relativeLuminance(ICON_BG_DARK) ? darkTint : ICON_BG_DARK
  let adjusted = darkenKeepChroma(base, lightBackground, ICON_MIN_CONTRAST)
  if (isDark && contrastRatio(adjusted, darkBackground) < ICON_MIN_CONTRAST) {
    const { L, C, H } = hexToOklch(adjusted)
    let lo = L
    let hi = 1
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (contrastRatio(fitChroma(mid, C, H), darkBackground) >= ICON_MIN_CONTRAST) hi = mid
      else lo = mid
    }
    adjusted = fitChroma(hi, C, H)
  }
  iconColorCache.set(cacheKey, adjusted)
  return adjusted
}

/**
 * 飾り（配線しない機材）を示す紫。配線図のノード・履歴再生・機材一覧のバッジで
 * 同じ色を使うので、ここが正本。以前は5ファイルに同じ 16進数を書き写していた。
 *
 * **文字に使わない。** 淡い器（`+ '22'`）の上でも 3.17:1 しかなく AA を割る。
 * バッジの文字は text で書き、色は器と枠だけで示す。
 */
export const DECOR_COLOR = '#8B6CFF'
