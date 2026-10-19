export const UI_METRICS = {
  // 画面の横余白。4系統あるのは中身の幅が違うからで、ここに無い値を画面ごとに決めない
  screenGutter: 16,  // 一覧・詳細・タブの中身
  formGutter: 20,    // 入力フォーム。入力欄が横いっぱいに伸びるので少し広げる
  modalGutter: 24,   // 単独で中央に置く内容（ログイン・プロフィール編集）
  // 下から出るシートの中身。18 / 20 / 22 に割れていたのを揃えた。角丸の大きい面の内側なので一覧より少し広い
  sheetGutter: 20,
  // 1行の入力欄と検索欄の最小の高さ。画面ごとに 37〜46 に割れていたのを揃えた。タップ領域の下限と同じ
  inputHeight: 44,
  // 行の中に並べる小さな入力欄（作成の金額・導入日、利用期間の日付）。主の入力と見分けるため一段低い
  compactInputHeight: 36,
  rowMinHeight: 50,
  // 単独で置く主要 CTA。横並びや補助操作は touchMinSize を使う
  buttonHeight: 50,
  chevronSize: 20,
  headerActionSize: 36,
  headerSlotSize: 44,
  chipRadius: 8,
  controlRadius: 10,
  cardRadius: 14,
  // バー・バナー・通知・画像など、カードより小さい面。
  // controlRadius(10) と cardRadius(14) の間に実態として 30 箇所以上あった
  panelRadius: 12,
  sheetRadius: 20,
  // 高さの半分で丸める pill。高さが変わっても形を保つ
  pillRadius: 980,
  // ボトムシートの下余白。どのシートも safe-area を別に持っていないので、
  // この値がそのままホームインジケータとの距離になる
  sheetBottom: 32,
  touchMinSize: 44,
} as const

// 全体はレイアウト崩れを避けるため1.2倍で止めているが、安全・課金・広告表示は
// 読み飛ばしてよい補足ではない。これらだけは端末の文字設定をより大きく反映する。
export const IMPORTANT_TEXT_MAX_FONT_SIZE_MULTIPLIER = 1.6

// Swipeable は release 時に「移動量 + 0.05 × 速度」で開閉を判定する。
// しきい値を小さめに保つことで、短いスワイプでも勢いがあれば削除ボタンが出る。
export const SWIPE_OPEN_THRESHOLD = 64

export const PRESS_INTERACTION = {
  scale: 0.98,
  pressInDuration: 80,
  pressOutDuration: 120,
  longPressDelay: 500,
} as const

// 公開デスク画面のヘッダーはテーマに追随せず固定色。
// 背景を RootNavigator、中身のアイコンを PublicDeskScreen が指定するため、
// 別々に色を書くと片方だけテーマ色になって（ライトモードで黒地に黒）見えなくなる。
export const PUBLIC_DESK_HEADER_BG = '#232F3E'
export const PUBLIC_DESK_HEADER_TINT = '#FFFFFF'

export const UI_STATUS_COLORS = {
  // warning は黒文字、ほかは白文字を載せる固定背景色。
  success: '#147A3B',
  warning: '#FFD21A',
  danger: '#C44133',
  info: '#0066CC',
} as const

export const UI_STATUS_ON_WARNING = '#0F1111'

/**
 * 導入・撤去（＋／−）、接続の IN / OUT、飾り・使用中の印の塗り。薄く敷くと地の色に沈んで
 * 種類をぱっと見で拾えなかったので、両テーマ同じ塗りに黒文字（text）を載せる。
 */
export const KIND_BADGE_COLORS = {
  in: '#53D17A',
  out: '#FF8178',
  decor: '#8B6CFF',
  active: '#64A8FF',
  text: '#0F1111',
} as const

// typeof UI_STATUS_COLORS だと as const のリテラル型が付いてきて、
// 同じ色しか書けない。キーの取りこぼしだけ止めたいので Record で受ける
const UI_STATUS_TEXT_COLORS_DARK: Record<keyof typeof UI_STATUS_COLORS, string> = {
  success: '#53D17A',
  warning: '#FFD21A',
  danger: '#FF5950',
  info: '#64A8FF',
}

// ライトの警告文字は中立色にし、黄色は印や背景に使う。
const UI_STATUS_TEXT_COLORS_LIGHT: Partial<Record<keyof typeof UI_STATUS_COLORS, string>> = {
  warning: UI_STATUS_ON_WARNING,
}

/** 状態色を文字・記号として面の上へ載せる場合のテーマ対応色。 */
export function statusTextColor(kind: keyof typeof UI_STATUS_COLORS, isDark: boolean): string {
  return isDark ? UI_STATUS_TEXT_COLORS_DARK[kind] : (UI_STATUS_TEXT_COLORS_LIGHT[kind] ?? UI_STATUS_COLORS[kind])
}
