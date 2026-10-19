/**
 * 数値入力欄の文字列を数字だけに正規化する。
 *
 * iOS の日本語キーボードは keyboardType="numeric" でも変換候補を出すため、
 * 「20」と打つと「20分」「20円」が確定してしまうことがある。そのまま保存すると
 * Number() が NaN になり、入力したのに値が消えるので入力時点で落とす。
 * 全角数字（２０）も IME から入ってくるので半角へ寄せる。
 */

function toHalfWidth(raw: string): string {
  return raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
}

/** 小数を許す欄（価格・寸法など）向け。小数点は最初の1つだけ残す */
export function sanitizeNumericInput(raw: string): string {
  const digitsAndDot = toHalfWidth(raw).replace(/[^0-9.]/g, '')
  const firstDot = digitsAndDot.indexOf('.')
  if (firstDot === -1) return digitsAndDot
  return digitsAndDot.slice(0, firstDot + 1) + digitsAndDot.slice(firstDot + 1).replace(/\./g, '')
}

/**
 * 金額の欄に表示する形。sanitizeNumericInput の結果へ3桁区切りを入れる。
 * 「198000」と「1980000」は打っている最中に見分けられず、1桁の打ち間違いが
 * 合計と統計をそのまま狂わせる。保存する値は変えない（parsePriceToJpy がカンマを落とす）。
 * 「12.」のような打ちかけの形は崩さない
 */
export function groupPriceDraft(draft: string): string {
  const dot = draft.indexOf('.')
  const intPart = dot === -1 ? draft : draft.slice(0, dot)
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dot === -1 ? grouped : grouped + draft.slice(dot)
}

/**
 * 3桁区切りを付けて見せている金額欄の編集を、保存する形（sanitizeNumericInput の結果）へ戻す。
 * `previous` は欄に出していた文字列（groupPriceDraft の結果）、`next` は編集後の欄の文字列。
 *
 * 区切りの直後で Backspace を押すと消えるのは「,」だけなので、付け直すと元の値に戻る。
 * iOS はカーソルを末尾からの距離で保つためカーソルも区切りの直後へ戻り、何度押しても
 * 区切りの前の数字が消せなかった。区切りだけが消えた編集は、その前の数字を消したと読み替える
 */
export function priceDraftAfterEdit(previous: string, next: string): string {
  const draft = sanitizeNumericInput(next)
  if (next.length !== previous.length - 1 || draft !== sanitizeNumericInput(previous)) return draft
  let removed = 0
  while (removed < next.length && next[removed] === previous[removed]) removed++
  if (previous[removed] !== ',' || removed === 0) return draft
  return sanitizeNumericInput(previous.slice(0, removed - 1) + previous.slice(removed + 1))
}

/** 整数だけの欄（日付など）向け */
export function sanitizeDigitsInput(raw: string): string {
  return toHalfWidth(raw).replace(/[^0-9]/g, '')
}

/**
 * 寸法の入力値を保存用に整える。数字の無い値（「.」だけ）と 0 以下は未入力として扱う。
 *
 * sanitizeNumericInput は打っている途中の「12.」を許すので、そのまま保存すると
 * 「.」や「0」が寸法として残る。表示は「.〜. cm」になり、インチ表示では
 * parseFloat('.') が NaN なので「NaN"」と出る。
 */
export function normalizeDimensionInput(raw: string): string | undefined {
  const n = Number(sanitizeNumericInput(raw))
  if (!Number.isFinite(n) || n <= 0) return undefined
  return String(n)
}

/**
 * 最小・最大の組。逆に入っていたら入れ替える。
 * 「最低 120 / 最高 70」は取り違え以外の意味を持たず、そのまま出すと「120〜70 cm」になる
 */
export function orderedRange(min?: string, max?: string): { min?: string; max?: string } {
  if (min === undefined || max === undefined) return { min, max }
  return Number(min) <= Number(max) ? { min, max } : { min: max, max: min }
}
