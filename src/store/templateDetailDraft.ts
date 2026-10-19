import type { TemplateItem } from '../services/templateService'
import type { ProductSuggestion } from '../utils/productSuggestions'
import type { TemplateSpec } from '../utils/templateSpec'

// ─── テンプレート詳細（作成の機材の段）の入力の控え ──────────────────
//
// 進捗バーで用途・テンプレートの段へ戻ると、この画面はスタックから外れて入力が消える。
// 用途を選び直しただけで商品名・金額・日付・外した枠・足したジャンルを入れ直させないよう、
// 戻る直前に控えておき、同じテンプレート（同じデスク宛て）を開き直したときに戻す。
// 新規作成の入力は firstSetupStore にも控え、再起動・バックアップ復元時は画面の initialDraft で戻す。

export interface TemplateDetailDraft {
  templateId: string
  returnPlanId?: string
  outletCount: number
  extraItems: TemplateItem[]
  removedKeys: string[]
  productNames: Record<string, string>
  productPicks: Record<string, ProductSuggestion>
  /** 商品名の下の金額・導入日の欄（入力したままの文字列） */
  productPrices: Record<string, string>
  productDates: Record<string, string>
  ownedSelections?: Record<string, string>
  /** 枠 → 編集ボタンで作成前に作ったガジェット（store/templateDraftGadgets） */
  draftGadgets?: Record<string, string>
  registerAsOwned?: boolean
  specEdits: Record<string, TemplateSpec>
}

let draft: TemplateDetailDraft | null = null

export function saveTemplateDetailDraft(next: TemplateDetailDraft): void {
  draft = next
}

export function readTemplateDetailDraft(templateId: string, returnPlanId?: string): TemplateDetailDraft | null {
  if (!draft || draft.templateId !== templateId || draft.returnPlanId !== returnPlanId) return null
  return draft
}

// 作成途中の破棄を Undo で戻すときに、消す前の控えを取っておくためのもの
export function peekTemplateDetailDraft(): TemplateDetailDraft | null {
  return draft
}

export function clearTemplateDetailDraft(): void {
  draft = null
}
