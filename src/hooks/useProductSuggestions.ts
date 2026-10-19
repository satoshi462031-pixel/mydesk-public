import { useEffect, useMemo, useState } from 'react'
import { getProductRepository, pickShopLinks } from '../repositories/productRepository'
import { GadgetCategory } from '../types'
import { getProductSuggestions, getProductSuggestionsAnyCategory, ProductSuggestion } from '../utils/productSuggestions'
import { CATEGORY_LABELS } from '../constants/categoryLabels'
import { analytics, EVENTS, errorProperties } from '../services/analytics'
import { extractProductModel } from '../utils/productName'
import { localizeProductCategoryTerms } from '../utils/localizedGadgetName'

/** 商品DBへ問い合わせるまでの待ち時間。1文字ごとに投げない */
const DEBOUNCE_MS = 250

/** これより短い入力では商品DBを引かない（候補が多すぎて意味がない） */
const MIN_QUERY_LENGTH = 2

const MAX_SUGGESTIONS = 10
type RemoteSuggestions = {
  key: string
  items: ProductSuggestion[]
  status: 'idle' | 'loading' | 'done' | 'error'
}

export type ProductSuggestionsState = {
  suggestions: ProductSuggestion[]
  loading: boolean
  error: boolean
}

// 「まだ届いていない」を表す空配列。ここで [] を書くと毎レンダー別物になり、
// これを依存に持つ下の useMemo（候補の組み立て）が毎回走る
const NO_REMOTE: ProductSuggestion[] = []

/**
 * 予測変換の候補。ローカルのプリセットを即座に返し、
 * 商品DB（Supabase・1万件超）の結果が届いたら後ろに足す。
 *
 * プリセットを先に出すのは、手書きの正規名の方が読みやすく、
 * 楽天由来の商品名が「ロジクール ワイヤレスマウス M220 無線 マウス 静音…」と
 * 長いため。DB側の並び順はプリセット優先で組んであるが、
 * 表示の即応性のためにローカルを待たずに出す。
 */
export function useProductSuggestionsState(
  /** null はカテゴリを問わず探す（登録画面の検索） */
  category: string | null,
  query: string,
  lang: 'ja' | 'en',
  enabled = true,
  limit = MAX_SUGGESTIONS,
  allowEmptyQuery = false,
  includeLocal = true,
): ProductSuggestionsState {
  const local = useMemo(
    () => !includeLocal ? []
      : category === null ? getProductSuggestionsAnyCategory(query, lang, limit)
      : getProductSuggestions(category as GadgetCategory, query, lang, limit),
    [category, query, lang, limit, includeLocal],
  )
  const requestKey = `${enabled ? '1' : '0'}:${category}:${query.trim()}:${limit}:${allowEmptyQuery ? 'all' : 'typed'}:${includeLocal ? 'local' : 'remote'}:${lang}`
  const [remoteResult, setRemoteResult] = useState<RemoteSuggestions>({ key: '', items: [], status: 'idle' })
  const remote = remoteResult.key === requestKey ? remoteResult.items : NO_REMOTE
  const trimmedQuery = query.trim()
  const shouldFetch = enabled && (allowEmptyQuery || trimmedQuery.length >= MIN_QUERY_LENGTH)
  const loading = shouldFetch && (remoteResult.key !== requestKey || remoteResult.status === 'loading')
  const error = shouldFetch && remoteResult.key === requestKey && remoteResult.status === 'error'

  useEffect(() => {
    const q = trimmedQuery
    if (!enabled || (!allowEmptyQuery && q.length < MIN_QUERY_LENGTH)) {
      return
    }
    let alive = true
    // 同じ一覧を開き直したときは前回結果を残したまま更新する。空表示へ戻すと、
    // キャッシュが見えた直後にローディングだけへ切り替わってちらつく
    setRemoteResult((current) => current.key === requestKey
      ? { ...current, status: 'loading' }
      : { key: requestKey, items: [], status: 'loading' })
    const timer = setTimeout(() => {
      const startedAt = Date.now()
      getProductRepository()
        .search({ query: q, category: category ?? undefined, limit })
        .then((products) => {
          if (!alive) return
          analytics.track(EVENTS.PRODUCT_SEARCH_COMPLETED, {
            category,
            query_length: q.length,
            result_count: products.length,
            local_result_count: local.length,
            duration_ms: Date.now() - startedAt,
          })
          // 検索時に shop_links まで取れているので、購入リンクもここで確定させる。
          // 選択時に getById を待たせると URL 欄が一瞬空のままになる。
          setRemoteResult({
            key: requestKey,
            status: 'done',
            items: products.flatMap((p) => {
              const links = pickShopLinks(p.links, { country: lang === 'en' ? 'US' : 'JP' })
              const link = links[0]
              // 価格は「最初に開くリンク」とは別に拾う。価格を持たない Amazon 行を
              // 足した商品で、楽天行が持っている価格ごと消えてしまうため
              const priced = links.find((l) => l.currency === 'JPY' && l.price != null)
              return p.productName ? [{
                name: p.name,
                brand: p.brand,
                productName: p.productName,
                image: p.image,
                productId: p.id,
                affiliateUrl: link?.affiliateUrl,
                officialUrl: link?.officialUrl,
                shop: link?.shop,
                // 表示通貨への換算は呼び出し側に任せるので、円建てのものだけ通す
                priceJpy: priced?.price,
                ports: p.ports,
                category: p.category && p.category in CATEGORY_LABELS ? p.category as GadgetCategory : undefined,
              }] : []
            }),
          })
        })
        .catch((error) => {
          if (!alive) return
          analytics.track(EVENTS.PRODUCT_SEARCH_FAILED, {
            category,
            query_length: q.length,
            duration_ms: Date.now() - startedAt,
            ...errorProperties(error),
          })
          setRemoteResult({ key: requestKey, items: [], status: 'error' })
        })
    }, DEBOUNCE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [category, trimmedQuery, enabled, requestKey, limit, allowEmptyQuery, local.length, lang])

  const suggestions = useMemo(() => {
    const suggestionKey = (name: string) => {
      const model = extractProductModel(name)
      return model
        ? `model:${model.normalize('NFKC').toLowerCase()}`
        : `name:${name.normalize('NFKC').toLowerCase()}`
    }
    const remoteByName = new Map(remote.map((suggestion) => [suggestionKey(suggestion.name), suggestion]))
    const merged = local.map((suggestion) => {
      const matchingRemote = remoteByName.get(suggestionKey(suggestion.name))
      if (!matchingRemote) return suggestion
      // プリセットが自前で持つリンクを優先。手書きの方が商品ページとして確実。
      return {
        ...suggestion,
        productId: matchingRemote.productId ?? suggestion.productId,
        image: suggestion.image ?? matchingRemote.image,
        affiliateUrl: suggestion.affiliateUrl ?? matchingRemote.affiliateUrl,
        officialUrl: suggestion.officialUrl ?? matchingRemote.officialUrl,
        shop: suggestion.shop ?? matchingRemote.shop,
        priceJpy: suggestion.priceJpy ?? matchingRemote.priceJpy,
        ports: matchingRemote.ports ?? suggestion.ports,
      }
    })
    const seen = new Set(merged.map((s) => suggestionKey(s.name)))
    for (const s of remote) {
      const key = suggestionKey(s.name)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(s)
    }
    return merged.slice(0, limit).map((suggestion) => ({
      ...suggestion,
      name: localizeProductCategoryTerms(suggestion.name, category ?? suggestion.category ?? '', lang),
      productName: suggestion.productName
        ? localizeProductCategoryTerms(suggestion.productName, category ?? suggestion.category ?? '', lang)
        : suggestion.productName,
    }))
  }, [local, remote, limit, category, lang])

  return { suggestions, loading, error }
}

export function useProductSuggestions(
  category: string | null,
  query: string,
  lang: 'ja' | 'en',
  enabled = true,
  limit = MAX_SUGGESTIONS,
  allowEmptyQuery = false,
  includeLocal = true,
): ProductSuggestion[] {
  return useProductSuggestionsState(
    category,
    query,
    lang,
    enabled,
    limit,
    allowEmptyQuery,
    includeLocal,
  ).suggestions
}
