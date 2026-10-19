// みんなのデスクの検索欄の予測と、検索結果の先に続ける「近いジャンル・ブランド」。
//
// 予測は端末の辞書（用途・カテゴリ・ブランド）と、公開デスクでよく使われている
// 機材名から出す。検索本体（search_public_desks）は部分一致しかしないので、
// 「keybord」「ロジクル」のような打ち間違いはサーバーでは1件も当たらない。
// 打ち間違いの吸収はここで近い語を出し、選ばせて正しい語で検索させる形で持つ。
// サーバー側で曖昧一致をすると、短い語ほど無関係なデスクが混ざる。

import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../constants/categoryLabels'
import { BRAND_ENTRIES, brandDisplay, brandKey, brandAliases } from './brandIdentity'

export type SearchSuggestionKind = 'purpose' | 'category' | 'brand' | 'gear'

export interface SearchVocabularyEntry {
  kind: SearchSuggestionKind
  /** 選んだときに検索欄へ入れる語。行の表示もこれ */
  label: string
  /** 当てにいく表記。表示言語でない側の表記・別名も入れる */
  terms: readonly string[]
  /** 用途・カテゴリのキー、ブランドのキー、機材ならそのカテゴリ。絵を引くのに使う */
  key: string
  /** 同じ近さの中での並び。機材は使っているデスクの数 */
  weight: number
}

export interface SearchSuggestion {
  entry: SearchVocabularyEntry
  /** 選んだときに検索欄へ入れる全文（前の語を残して最後の語だけ差し替えた形を含む） */
  query: string
  /** 打った字の続きではなく、打ち間違いとして近い語 */
  corrected: boolean
}

const KIND_RANK: Record<SearchSuggestionKind, number> = { purpose: 0, category: 1, brand: 2, gear: 3 }

// 予測に出しても絞り込みの役に立たない語
const SKIPPED_CATEGORIES = new Set(['Other', 'Cable'])

/**
 * 比較用の形。全角半角・大文字小文字・ひらがなとカタカナの違い、空白や記号を潰す。
 * 「ろじくーる」「ﾛｼﾞｸｰﾙ」と打った人にも「ロジクール」を当てる。
 */
export function foldSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * 打ち間違いとして許す編集の数。短い語で許すと別の語に化ける
 * （英字の3文字で1つ許すと mic が mac になる）。かなは1文字の情報が多いので
 * 英字より短いところから許す。
 */
function allowedEdits(folded: string): number {
  const ascii = /^[a-z0-9]*$/.test(folded)
  const n = [...folded].length
  if (ascii) return n <= 3 ? 0 : n <= 6 ? 1 : 2
  return n <= 2 ? 0 : n <= 5 ? 1 : 2
}

/** 隣り合う2文字の入れ替えも1回と数える編集距離（keybaord → keyboard を1にする） */
function editDistance(a: readonly string[], b: readonly string[], cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1)
      }
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > cap) return cap + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

type Form = { chars: string[]; whole: boolean }

/**
 * 照合する形。語の頭ごとに切り出す（「MX Master 3S」は「master」から打っても当てる）。
 * 空白の無い日本語は全体だけ。
 */
function formsOf(entry: SearchVocabularyEntry): Form[] {
  const out = new Map<string, boolean>()
  for (const term of entry.terms) {
    const words = term.trim().split(/\s+/).filter(Boolean)
    for (let i = 0; i < words.length; i++) {
      const folded = foldSearchText(words.slice(i).join(''))
      if (folded) out.set(folded, (out.get(folded) ?? false) || i === 0)
    }
  }
  return [...out].map(([form, whole]) => ({ chars: [...form], whole }))
}

type Match = { distance: number; exact: boolean }

function matchEntry(needle: readonly string[], forms: readonly Form[], cap: number): Match | null {
  let best: Match | null = null
  for (const { chars: form, whole } of forms) {
    if (needle.length <= form.length && needle.every((c, i) => form[i] === c)) {
      // 語の途中（「Pro」だけ）と一致しても、打った語そのものとは扱わない。
      // 「pro」と打った人には「MacBook Pro」を出す
      if (whole && needle.length === form.length) return { distance: 0, exact: true }
      best = { distance: 0, exact: false }
      continue
    }
    if (cap === 0) continue
    // 打ちかけの語も直せるよう、語の頭から同じくらいの長さで比べる
    for (let k = needle.length - 1; k <= needle.length + 1; k++) {
      if (k < 1 || k > form.length) continue
      const d = editDistance(needle, form.slice(0, k), cap)
      if (d <= cap && (!best || d < best.distance)) best = { distance: d, exact: false }
    }
  }
  return best
}

function minimumLength(folded: string): number {
  // 英字1文字では候補が絞れない。漢字・かなは1文字でも語になる（「机」）
  return /^[a-z0-9]*$/.test(folded) ? 2 : 1
}

type Scored = SearchSuggestion & { distance: number }

function compareScored(a: Scored, b: Scored): number {
  if (a.corrected !== b.corrected) return a.corrected ? 1 : -1
  if (a.distance !== b.distance) return a.distance - b.distance
  const kind = KIND_RANK[a.entry.kind] - KIND_RANK[b.entry.kind]
  if (kind !== 0) return kind
  if (a.entry.weight !== b.entry.weight) return b.entry.weight - a.entry.weight
  return [...a.entry.label].length - [...b.entry.label].length
}

function scoreAgainst(
  raw: string,
  vocabulary: readonly SearchVocabularyEntry[],
  forms: ReadonlyMap<SearchVocabularyEntry, Form[]>,
  toQuery: (label: string) => string,
): { scored: Scored[]; exact: boolean } {
  const folded = foldSearchText(raw)
  if ([...folded].length < minimumLength(folded)) return { scored: [], exact: false }
  const needle = [...folded]
  const cap = allowedEdits(folded)
  const scored: Scored[] = []
  let exact = false
  for (const entry of vocabulary) {
    const match = matchEntry(needle, forms.get(entry) ?? [], cap)
    if (!match) continue
    // 打った語そのものは出さない。別名で打った人に正式名へ言い換えさせても、
    // 検索は別名のまま当たるので何も変わらない
    if (match.exact) { exact = true; continue }
    scored.push({ entry, query: toQuery(entry.label), corrected: match.distance > 0, distance: match.distance })
  }
  return { scored, exact }
}

// 1文字打つたびに辞書全体を畳み直さない。語彙の配列が同じ間は使い回す
const formsCache = new WeakMap<readonly SearchVocabularyEntry[], Map<SearchVocabularyEntry, Form[]>>()

function formsMap(vocabulary: readonly SearchVocabularyEntry[]): Map<SearchVocabularyEntry, Form[]> {
  const cached = formsCache.get(vocabulary)
  if (cached) return cached
  const built = new Map(vocabulary.map((entry) => [entry, formsOf(entry)]))
  formsCache.set(vocabulary, built)
  return built
}

/**
 * 検索欄の予測。打ちかけの語の続き（前方一致）を先に、打ち間違いとして近い語を後に並べる。
 * 複数の語を打っているときは、全体で当てたものに加えて、最後の語だけを差し替えた候補も出す
 * （「gaming keybord」→「gaming キーボード」）。
 */
export function suggestSearchTerms(
  input: string,
  vocabulary: readonly SearchVocabularyEntry[],
  limit = 6,
): SearchSuggestion[] {
  const text = input.trim()
  if (!text) return []
  const forms = formsMap(vocabulary)
  const tokens = text.split(/\s+/)
  const whole = scoreAgainst(text, vocabulary, forms, (label) => label).scored.sort(compareScored)
  const last = tokens.length > 1
    ? scoreAgainst(tokens[tokens.length - 1], vocabulary, forms,
      (label) => [...tokens.slice(0, -1), label].join(' ')).scored.sort(compareScored)
    : []
  const seen = new Set<string>([foldSearchText(text)])
  const out: SearchSuggestion[] = []
  for (const item of [...whole, ...last]) {
    const key = foldSearchText(item.query)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ entry: item.entry, query: item.query, corrected: item.corrected })
    if (out.length >= limit) break
  }
  return out
}

/**
 * 0件だったときの「もしかして」。辞書の語と完全には一致せず、打ち間違いとして近い語が
 * ある語だけを差し替える。差し替える語が1つも無ければ null（言い直す先が無い）。
 */
export function correctSearchQuery(
  input: string,
  vocabulary: readonly SearchVocabularyEntry[],
): string | null {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  const forms = formsMap(vocabulary)
  let changed = false
  const corrected = tokens.map((token) => {
    const { scored, exact } = scoreAgainst(token, vocabulary, forms, (label) => label)
    // 辞書の語そのもの、または打ちかけの続きがある語は打ち間違いではない
    if (exact || scored.some((item) => !item.corrected)) return token
    const best = scored.sort(compareScored)[0]
    if (!best) return token
    changed = true
    return best.entry.label
  })
  return changed ? corrected.join(' ') : null
}

export interface PurposeVocabulary {
  key: string
  ja: string
  en: string
}

export interface GearVocabulary {
  name: string
  category: string
  desk_count: number
}

/** 予測に使う語の一覧。表示は閲覧者の言語、照合は日英どちらの表記でも当てる */
export function buildSearchVocabulary(input: {
  lang: 'ja' | 'en'
  purposes: readonly PurposeVocabulary[]
  gear: readonly GearVocabulary[]
}): SearchVocabularyEntry[] {
  const { lang } = input
  const out: SearchVocabularyEntry[] = []
  const labels = new Set<string>()
  const push = (entry: SearchVocabularyEntry) => {
    const folded = foldSearchText(entry.label)
    if (!folded || labels.has(folded)) return
    labels.add(folded)
    out.push(entry)
  }
  for (const purpose of input.purposes) {
    push({
      kind: 'purpose',
      label: lang === 'ja' ? purpose.ja : purpose.en,
      terms: [purpose.ja, purpose.en, purpose.key],
      key: purpose.key,
      weight: 0,
    })
  }
  for (const [key, ja] of Object.entries(CATEGORY_LABELS)) {
    if (SKIPPED_CATEGORIES.has(key)) continue
    const en = (CATEGORY_LABELS_EN as Record<string, string>)[key] ?? key
    push({ kind: 'category', label: lang === 'ja' ? ja : en, terms: [ja, en], key, weight: 0 })
  }
  for (const brand of BRAND_ENTRIES) {
    push({
      kind: 'brand',
      label: lang === 'ja' ? brand.ja ?? brand.en : brand.en,
      terms: [brand.en, ...(brand.ja ? [brand.ja] : []), ...(brand.aliases ?? [])],
      key: brand.id,
      weight: 0,
    })
  }
  for (const gear of input.gear) {
    const name = gear.name.trim()
    if (!name || SKIPPED_CATEGORIES.has(gear.category)) continue
    push({ kind: 'gear', label: name, terms: [name], key: gear.category, weight: gear.desk_count })
  }
  return out
}

export interface RelatedSearchTerm {
  kind: 'category' | 'brand'
  /** カテゴリのキー、またはブランドのキー */
  key: string
  label: string
  /** その語の機材を使っているデスクの数の合計。並びに使う */
  weight: number
}

/**
 * 検索結果の先に出す「近いジャンル・ブランド」。検索語に当たった機材から、
 * それが属するカテゴリとブランドを集める（「Logitech」ならマウス・キーボード、
 * 「キーボード」なら Keychron・Logitech）。検索語そのものを指す語は外す。
 */
export function relatedSearchTerms(
  query: string,
  gear: readonly (GearVocabulary & { brand: string | null })[],
  lang: 'ja' | 'en',
  limit = 8,
): RelatedSearchTerm[] {
  const foldedQuery = foldSearchText(query)
  if (!foldedQuery) return []
  const pointsAtQuery = (surfaces: readonly string[]) => surfaces.some((surface) => {
    const folded = foldSearchText(surface)
    return folded.length >= 2 && (foldedQuery.includes(folded) || folded.includes(foldedQuery))
  })
  const byKey = new Map<string, RelatedSearchTerm>()
  const add = (term: RelatedSearchTerm) => {
    const id = `${term.kind}:${term.key}`
    const current = byKey.get(id)
    if (current) current.weight += term.weight
    else byKey.set(id, { ...term })
  }
  for (const item of gear) {
    if (!SKIPPED_CATEGORIES.has(item.category)) {
      const ja = (CATEGORY_LABELS as Record<string, string>)[item.category]
      const en = (CATEGORY_LABELS_EN as Record<string, string>)[item.category]
      if (ja && en && !pointsAtQuery([ja, en, item.category])) {
        add({ kind: 'category', key: item.category, label: lang === 'ja' ? ja : en, weight: item.desk_count })
      }
    }
    const key = brandKey(item.brand)
    const label = brandDisplay(item.brand, lang)
    if (key && label && !pointsAtQuery([label, item.brand ?? '', ...brandAliases(key)])) {
      add({ kind: 'brand', key, label, weight: item.desk_count })
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    .slice(0, limit)
}
