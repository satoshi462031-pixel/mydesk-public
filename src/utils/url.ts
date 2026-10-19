import type { PurchaseLink, ShopId } from '../types/product'

/**
 * 購入リンクのショップ名。楽天のアフィリエイトURLは
 * hb.afl.rakuten.co.jp/hgc/<ID>/?pc=<エンコード済み商品URL> の形式で 200 文字を超え、
 * 入力欄にそのまま出すと読めない。URL の代わりにこの名前をボタンに出す。
 */
export function isAffiliateUrl(value: string): boolean {
  return withoutAffiliateUrl(value) !== value
}

/**
 * 成果報酬の印を外した URL。外せない形（中身の見えない短縮URL・商品URLを取り出せない
 * 楽天の中継URL）は null を返し、呼び出し側はそのリンクを出さない。
 *
 * URL / URLSearchParams は使わない。React Native の実装は searchParams の操作が
 * 未実装のことがあり、例外で素通りすると報酬付きのまま出る。
 */
export function withoutAffiliateUrl(value: string): string | null {
  const match = /^(https?:\/\/)([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(value)
  if (!match) return value
  const [, scheme, authority, path, search = '', hash = ''] = match
  const host = authority.toLowerCase().replace(/:\d+$/, '')

  if (host === 'hb.afl.rakuten.co.jp') {
    const pc = /[?&]pc=([^&]+)/.exec(search)?.[1]
    let inner: string | null = null
    try {
      inner = pc ? decodeURIComponent(pc) : null
    } catch {
      inner = null
    }
    return inner && /^https?:\/\//i.test(inner) ? withoutAffiliateUrl(inner) : null
  }
  if (host === 'amzn.to') return null

  const isAffiliateParam = (key: string) =>
    key === 'affiliate_id'
    || (key === 'rafcid' && host.includes('rakuten'))
    || (key === 'tag' && host.includes('amazon.'))
  const pairs = search.slice(1).split('&')
  const kept = pairs.filter((pair) => !isAffiliateParam(pair.split('=')[0].toLowerCase()))
  // 外すものが無ければ元の文字列のまま返す（isAffiliateUrl が「変わったか」で判定する）
  if (kept.length === pairs.length) return value
  const query = kept.filter(Boolean).join('&')
  return `${scheme}${authority}${path}${query ? `?${query}` : ''}${hash}`
}

export function shopLabelForUrl(value: string, lang: 'ja' | 'en'): string {
  let host = ''
  try {
    host = new URL(value).hostname.toLowerCase()
  } catch {
    return lang === 'en' ? 'Product page' : '商品ページ'
  }
  const label = host.includes('rakuten')
    ? (lang === 'en' ? 'Rakuten product page' : '楽天の商品ページ')
    : host.includes('amazon') || host.includes('amzn')
      ? (lang === 'en' ? 'Amazon product page' : 'Amazonの商品ページ')
      : host.includes('yahoo')
        ? (lang === 'en' ? 'Yahoo! Shopping page' : 'Yahoo!ショッピングの商品ページ')
        : (lang === 'en' ? 'Product page' : '商品ページ')
  return isAffiliateUrl(value) ? `${label}${lang === 'en' ? ' (Ad)' : '（広告）'}` : label
}

export function normalizeHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const parsed = new URL(candidate)
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      || !parsed.hostname
      || parsed.username
      || parsed.password
    ) return null
    return parsed.toString()
  } catch {
    return null
  }
}

/**
 * リンクの下に出す広告表記。
 *
 * 景表法のステマ規制で「一般消費者が広告と判別できる表示」が要るため、
 * 規約ページではなくリンクを見る場所に出す。Amazon アソシエイト運営規約は
 * これに加えて「適格販売により収入を得ている」旨の掲示を求めるので、
 * Amazon のリンクを出している画面にだけその一文を足す。
 *
 * 報酬の付いたリンクが1本も無ければ null（出さない）。報酬を付けていない間に
 * 「広告が含まれます」と書くと、事実と違う表示になる。
 */
export function affiliateDisclosure(links: PurchaseLink[], lang: 'ja' | 'en'): string | null {
  const affiliate = links.filter((link) => isAffiliateUrl(link.url))
  if (affiliate.length === 0) return null
  const general = lang === 'en'
    ? 'Links may be affiliate links, and we may earn a commission from purchases.'
    : 'リンクにはアフィリエイト広告が含まれ、購入により当方が報酬を得る場合があります。'
  const hasAmazon = affiliate.some((link) => link.shop === 'amazon_jp' || link.shop === 'amazon_us')
  if (!hasAmazon) return general

  const amazon = lang === 'en'
    ? 'As an Amazon Associate, we earn from qualifying purchases.'
    : 'Amazonのアソシエイトとして、当方は適格販売により収入を得ています。'
  return lang === 'en' ? `${amazon} ${general}` : `${amazon}${general}`
}

/**
 * 購入ボタンに出す文言。Amazon と楽天を並べて出すので、
 * 「購入ページを開く」ではどちらのボタンか区別が付かない。
 */
export function purchaseLinkLabel(link: PurchaseLink, lang: 'ja' | 'en'): string {
  const ad = isAffiliateUrl(link.url) ? (lang === 'en' ? ' (Ad)' : '（広告）') : ''
  if (link.shop === 'own') return (lang === 'en' ? 'Open store' : '購入ページを開く') + ad

  const shop = SHOP_SHORT_LABEL[link.shop][lang]
  // 検索結果へ逃がしたリンクを「◯◯で購入」と書くと、商品ページだと思って開くことになる
  if (link.kind === 'search') return (lang === 'en' ? `Search on ${shop}` : `${shop}で検索`) + ad
  return (lang === 'en' ? `Buy on ${shop}` : `${shop}で購入`) + ad
}

const SHOP_SHORT_LABEL: Record<ShopId, Record<'ja' | 'en', string>> = {
  amazon_jp: { ja: 'Amazon', en: 'Amazon' },
  amazon_us: { ja: 'Amazon', en: 'Amazon' },
  rakuten_jp: { ja: '楽天', en: 'Rakuten' },
  yahoo_jp: { ja: 'Yahoo!', en: 'Yahoo!' },
  official: { ja: '公式サイト', en: 'Official site' },
}
