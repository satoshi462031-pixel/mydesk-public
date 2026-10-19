import { DESK_TEMPLATES } from '../constants/deskTemplates'
import { trimAndTruncate } from './truncateText'

// ─── 名前を書かなかったデスクの名前 ───────────────────────────────────
//
// デスク名は任意。書かない人のデスクも、みんなのデスクの一覧では見出しが要る
// （写真と用途アイコンだけだとタイル同士を見分けられない）。そこで用途から名前を作る。
//
// 用途は3つ以上でも2つまでしか入れない。2列のタイルの見出しは10文字前後で切れるので、
// 3つ目は「…」の向こうに消えるだけになる。

/** デスク名の上限。入力欄・名前の変更・保存で同じ値を使う */
export const DESK_NAME_MAX = 30

export function composeDeskName(purposeLabels: readonly string[], lang: 'ja' | 'en'): string {
  const labels = purposeLabels.map((label) => label.trim()).filter(Boolean).slice(0, 2)
  if (labels.length === 0) return lang === 'ja' ? 'わたしのデスク' : 'My desk'
  const name = lang === 'ja' ? `${labels.join('・')}のデスク` : `${labels.join(' & ')} desk`
  return trimAndTruncate(name, DESK_NAME_MAX)
}

// 用途から名前を作る前は、テンプレート名（「手持ちから組む」）がそのままデスク名に入っていた。
// これは作り方の名前で、本人が付けた名前ではない
const TEMPLATE_NAMES = new Set(
  DESK_TEMPLATES.flatMap((t) => [t.nameJa, t.nameEn].map((n) => trimAndTruncate(n, DESK_NAME_MAX))),
)

/**
 * 本人が書いた名前ではないか。入力欄を空にして自動の名前を薄く見せるかどうかに使う。
 * 自動の名前を入力欄に文字として入れておくと、書き換えるべき欄に見えて「任意」が伝わらない
 */
export function isUnwrittenDeskName(name: string, autoName: string): boolean {
  const trimmed = name.trim()
  return !trimmed || trimmed === autoName || TEMPLATE_NAMES.has(trimmed)
}
