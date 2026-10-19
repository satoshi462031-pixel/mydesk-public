const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
const MULTIPLE_URLS_PATTERN = /(?:https?:\/\/|www\.)[^\s]+[\s\S]*(?:https?:\/\/|www\.)[^\s]+/i
const PROHIBITED_CONTENT_PATTERN = /児童ポルノ|児童性的|性的搾取|殺害予告|自殺方法|child\s*(?:porn|sexual)|sexual\s*exploitation|kill\s+yourself/i

export type PublicContentIssue = 'personal_information' | 'spam' | 'prohibited_content'

export interface PublicContentInput {
  title: string
  ownerName?: string
  gadgetNames?: string[]
  /**
   * 公開スナップショットに載る文字列。デスクの公開では欄を列挙せず、
   * 送る物そのものから collectPublicTexts() で拾って渡す（理由はその関数の注釈）。
   */
  freeTexts?: string[]
}

/**
 * 公開する値そのものから、検査に回す文字列を全部拾う。
 *
 * 欄の名前を並べる方式を取らないのは、公開する中身が「落とすものだけ挙げる」
 * 方式（publishService の sharedGadgets）で決まっているため。片方が除外リスト、
 * 片方が列挙だと、欄を足すたびに検査だけが漏れる。実際に型番・CPU・ゲーム名・
 * 置き場所ラベルと、デスクから外して履歴だけ残った機材の名前が素通りしていた。
 * 送る物から導けば、欄が増えても勝手に載る。
 *
 * 深さで打ち切るのは、壊れた保存データで再帰が止まらなくなる場合の保険。
 * スナップショットの実際の深さ（plan → connectionMap → connections → 各項目）
 * には十分な余裕がある。
 */
export function collectPublicTexts(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return value ? [value] : []
  if (depth >= 12 || value === null || typeof value !== 'object') return []
  const children: unknown[] = Array.isArray(value) ? value : Object.values(value)
  return children.flatMap((child) => collectPublicTexts(child, depth + 1))
}

export function findPublicContentIssue(input: PublicContentInput): PublicContentIssue | null {
  const freeTexts = (input.freeTexts ?? []).filter((text) => !!text)
  // メールアドレスと外部リンクの羅列は、名前だけでなく自由記入欄でも止める。
  // 名前に書けないものがメモになら書ける、という抜け道を残さない
  const identityText = [input.title, input.ownerName ?? '', ...freeTexts].join('\n')
  if (EMAIL_PATTERN.test(identityText)) return 'personal_information'
  if (MULTIPLE_URLS_PATTERN.test(identityText)) return 'spam'

  const publicText = [input.title, input.ownerName ?? '', ...(input.gadgetNames ?? []), ...freeTexts].join('\n')
  if (PROHIBITED_CONTENT_PATTERN.test(publicText)) return 'prohibited_content'
  return null
}

export function assertPublicContentAllowed(input: PublicContentInput): void {
  const issue = findPublicContentIssue(input)
  // 文面で入力欄を名指ししすぎないのは、この関数を公開名の入力（PublicNameGateModal・
  // 設定）とデスクの公開の両方が使うため。どちらでも意味が通る言い方にする
  if (issue === 'personal_information') {
    throw new Error('公開される内容にメールアドレスを含めることはできません。デスク名・公開名・ひとこと・メモを確認してください。')
  }
  if (issue === 'spam') {
    throw new Error('公開される内容に複数の外部リンクを含めることはできません。デスク名・公開名・ひとこと・メモを確認してください。')
  }
  if (issue === 'prohibited_content') {
    throw new Error('公開できない内容が含まれています。内容を修正してください。')
  }
}

