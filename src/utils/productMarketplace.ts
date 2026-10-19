import type { ProductSuggestion } from './productSuggestions'

export type ProductMarketplace = 'amazon' | 'rakuten'

export function productMarketplace(suggestion: ProductSuggestion): ProductMarketplace | null {
  if (suggestion.shop === 'amazon_jp' || suggestion.shop === 'amazon_us') return 'amazon'
  if (suggestion.shop === 'rakuten_jp') return 'rakuten'
  const url = `${suggestion.affiliateUrl ?? ''} ${suggestion.officialUrl ?? ''}`.toLowerCase()
  if (/amazon\.|amzn\.to/.test(url)) return 'amazon'
  if (/rakuten\.|r10\.to/.test(url)) return 'rakuten'
  return null
}

export function productMarketplaceLabel(
  suggestion: ProductSuggestion,
  lang: 'ja' | 'en',
): string | null {
  const marketplace = productMarketplace(suggestion)
  if (marketplace === 'amazon') return 'Amazon'
  if (marketplace === 'rakuten') return lang === 'ja' ? '楽天市場' : 'Rakuten'
  return null
}
