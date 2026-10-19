// 商品システム共通型定義
//
// 商品情報（Product）とショップ情報（ShopLink）を分離して管理する。
// 取得元（Supabase 商品DB / Amazon PA-API / 楽天API / Yahooショッピング）が
// 変わってもこの型は変えない。UI はこの型だけに依存すること。

import type { Port } from './index'

/** ショップ識別子。ショップ追加時はここに追記する */
export type ShopId =
  | 'amazon_jp'
  | 'amazon_us'
  | 'rakuten_jp'
  | 'yahoo_jp'
  | 'official'

export type CountryCode = 'JP' | 'US'

/** 商品マスタ。どのショップで売っているかとは独立した情報 */
export interface Product {
  id: string
  /** Amazon ASIN。PA-API 移行後に商品同定キーとして使う */
  asin?: string
  name: string
  brand?: string
  /** ブランドを含まない正規製品名。name は互換用の結合表示名。 */
  productName?: string
  /** 検索・監査用の元出品タイトル。画面には出さない。 */
  rawName?: string
  /** GadgetCategory と同じ文字列を入れる（'Monitor' など）。外部API由来の場合は変換して格納 */
  category?: string
  /** カテゴリ内の表示・絞り込み用区分（例: gaming / numpad / soundbar） */
  subcategory?: string
  /** 商品画像URL */
  image?: string
  description?: string
  /**
   * 'preset' = gadgetPresets.ts 由来の正規名 / 'rakuten' = 楽天ジャンル取り込み。
   * 検索結果でプリセットを優先表示するために使う。
   */
  source?: string
  /** false の商品は予測候補に出さない */
  isSuggestable?: boolean
  /** 型番を確認できた商品の実ポート構成 */
  ports?: Port[]
  /** ポート仕様の確認元 */
  specsSourceUrl?: string
  specsVerifiedAt?: string
}

/** ショップごとの購入リンク・価格情報。1商品に複数ぶら下がる */
export interface ShopLink {
  id: string
  productId: string
  shop: ShopId
  country: CountryCode
  /** アフィリエイトURL。あればこちらを優先して開く */
  affiliateUrl?: string
  /** 通常の商品ページURL */
  officialUrl?: string
  /** 将来: 価格比較用。PA-API の Offers.Listings.Price に対応 */
  price?: number
  currency?: string
  /** 将来: 在庫取得用 */
  inStock?: boolean
  /** レビュー件数。検索結果の並び順に使う */
  reviewCount?: number
  /** ISO8601。自動更新時に鮮度判定に使う */
  lastUpdated: string
}

export interface ProductWithLinks extends Product {
  links: ShopLink[]
}

export interface ProductSearchParams {
  query: string
  /** GadgetCategory 文字列で絞り込み（任意） */
  category?: string
  subcategory?: string
  limit?: number
  country?: CountryCode
}

/**
 * 画面に出す購入リンク1本。ショップごとに並べて出すため、
 * 「どのショップの・どんな種類のリンクか」を URL と一緒に持ち回る。
 */
export interface PurchaseLink {
  /** ユーザーが自分で入力した URL は 'own'（ショップを判別できない） */
  shop: ShopId | 'own'
  url: string
  /** 'search' は商品マスタにリンクが無くて検索結果へ逃がしたもの */
  kind: 'product' | 'search'
}
