// ─── 手持ちガジェットの絞り込み ──────────────────────────────────
//
// マイガジェットとガジェット選択で同じ絞り込みをしている。どちらも
// `trim().toLowerCase()` だけで NFKC を通しておらず、日本語入力で普通に混ざる
// 全角英数（ＨＨＫＢ）や半角カナ（ｷｰﾎﾞｰﾄﾞ）が当たらなかった。
// 公開デスク検索（normalizePublicDeskSearch）は最初から NFKC を通している。
//
// **検索語と対象の両方を正規化しないと意味がない。** 片方だけ揃えても
// 「ＨＨＫＢ」で登録した名前は半角の検索語に当たらないままになる。

/** 検索語の正規化。全角と半角、大文字と小文字の違いを吸う */
export function normalizeGadgetSearch(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase()
}

/**
 * 正規化した検索語を空白で区切った語。全角の空白は NFKC で半角になり、改行・タブも区切りとして扱う。
 * 語の並びや空白の数を問わず、すべての語を含むものを当たりにする（AND）。
 * 1本の文字列のまま部分一致させていた頃は「MX  Keys」（空白2つ）「Keys MX」、貼り付けで混ざった改行で
 * 何も当たらなかった
 */
export function searchTerms(normalizedQuery: string): string[] {
  return normalizedQuery.split(/\s+/).filter(Boolean)
}

/** 正規化済みの対象が、語をすべて含むか */
export function matchesSearchTerms(normalizedText: string, terms: readonly string[]): boolean {
  return terms.every((term) => normalizedText.includes(term))
}

export interface SearchableGadget {
  id: string
  name: string
  memo?: string
  category: string
  /** 自作ジャンル。その名前でも引けるようにする（カテゴリ名は 'Other' の「その他」になるため） */
  customCategory?: { name: string }
}

/**
 * ガジェット id → 検索対象文字列。
 *
 * 名前・メモ・カテゴリ表示名を1本に畳んで正規化しておく。入力のたびに全件を
 * 正規化すると持ち物が増えるほど重くなるので、正規化は持ち物が変わったときだけ。
 *
 * `categoryLabel` は表示言語のカテゴリ名を返す関数（画面の `t` を渡す）。
 * 言語を切り替えたら索引も作り直す必要がある。
 */
export function buildGadgetSearchIndex(
  gadgets: readonly SearchableGadget[],
  categoryLabel: (category: string) => string,
): Map<string, string> {
  const index = new Map<string, string>()
  for (const gadget of gadgets) {
    index.set(
      gadget.id,
      normalizeGadgetSearch([gadget.name, gadget.memo ?? '', categoryLabel(gadget.category), gadget.customCategory?.name ?? ''].join('\n')),
    )
  }
  return index
}

/** 索引に対して1件が検索語に当たるか */
export function matchesGadgetSearch(
  index: Map<string, string>,
  gadgetId: string,
  normalizedQuery: string,
): boolean {
  const terms = searchTerms(normalizedQuery)
  if (terms.length === 0) return true
  const text = index.get(gadgetId)
  return text !== undefined && matchesSearchTerms(text, terms)
}
