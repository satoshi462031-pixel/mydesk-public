// Supabase データベース TypeScript 型定義（Row 型を手動で管理している）。
//
// かつては createClient に渡す Database 型もここに持っていたが、どこからも
// 参照されないまま ai_usage・blocks・reports などの後発テーブルが追加されて
// 実スキーマから離れ、付けた瞬間に全クエリが never に落ちる状態だった。
// クライアントに型を付けたくなったら supabase gen types typescript で
// 生成し直すこと。手書きで足すと同じことになる。

// ─── Row 型 ───────────────────────────────────────────────────

/** アカウントバックアップ1世代分。payload の中身は services/backupService.ts の BackupPayload */
export interface BackupRow {
  id: string
  user_id: string
  payload: unknown
  schema_version: number
  device_id: string | null
  device_name: string | null
  byte_size: number
  created_at: string
}

export interface Profile {
  id: string
  username: string | null
  /** 人を一意に指す名乗り。049 で全員に振られ、060 から本人が決められる */
  public_tag: string
  /**
   * 本人が @ID を決めたか（061）。抽選値と本人が選んだ値は形が同じで区別できないので、
   * 登録直後に一度だけ聞く画面を出すかの判断はこの列で持つ
   */
  public_tag_chosen: boolean
  display_name: string | null
  /** サインイン情報から自動で入る。本人が選んだものとは限らないので公開には使わない（059） */
  avatar_url: string | null
  /** 本人がこのアプリで選んだ公開アイコン。未設定なら文字アイコン（059） */
  public_avatar_url: string | null
  bio: string | null
  tier: 'free' | 'pro'
  tier_updated_at: string | null
  /** 公開プロフィール /u/<tag> に自分の公開デスクをまとめて出すか（057） */
  profile_discoverable: boolean
  created_at: string
}

export interface Subscription {
  id: string
  user_id: string
  tier: 'free' | 'pro'
  rc_customer_id: string | null
  rc_product_id: string | null
  rc_entitlement: string | null
  status: 'active' | 'expired' | 'cancelled' | 'grace_period'
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface Desk {
  id: string
  user_id: string
  title: string
  description: string | null
  /** unlisted（083）はリンクを知っている人だけが開ける。みんなのデスク・検索・公開プロフィールには載らない */
  visibility: 'public' | 'unlisted' | 'private'
  total_price: number
  purposes: string[]
  owner_name: string
  owner_tag: string
  /** 所有者が公開プロフィールをまとめて見せる設定か（057・profiles からの非正規化コピー） */
  owner_profile_public: boolean
  /** 公開時に端末が計算した属性キー（058・utils/deskAttributes.ts の形式） */
  attributes: string[]
  /** 投稿者が選んだアイコン（059・profiles.public_avatar_url からの非正規化コピー） */
  owner_avatar_url: string | null
  share_snapshot: unknown
  /** 061。公開している機材と写真の指紋。中身が変わったかの判定にだけ使う */
  content_signature: string | null
  /** 061。機材か写真が最後に変わった日時。一度も変わっていなければ null */
  content_updated_at: string | null
  like_count: number
  /** 拍手を受け付ける今の版の開始日時（095） */
  clap_round_at: string
  /** 初めて公開した日時。デスクを作った日ではない（それは desk_created_at） */
  created_at: string
  /** 099。デスクを作った日時（端末の DeskPlan.createdAt）。099 以降に公開していない行は null */
  desk_created_at: string | null
  updated_at: string
}

export interface Bookmark {
  id: string
  desk_id: string
  user_id: string
  created_at: string
}

export interface Like {
  id: string
  desk_id: string
  user_id: string
  /** 拍手した版（desks.clap_round_at・095） */
  round_at: string
  created_at: string
}

/** 欲しいものリスト1件（066）。同一性は商品側で、desk は「どこで見つけたか」 */
export interface GadgetBookmarkItem {
  id: string
  /**
   * 出典のデスク。非公開化・削除で NULL になる（066 は SET NULL）。
   * 自分の持ち物から保存したものは最初から NULL
   */
  desk_id: string | null
  gadget_id: string | null
  product_id: string | null
  gadget_name: string
  gadget_category: string
  user_id: string
  created_at: string
  product: Pick<ProductRow, 'id' | 'name' | 'brand' | 'product_name' | 'image'> | null
  /** 出典が非公開になると RLS で読めなくなるので null になる。行そのものは残る */
  desk: Pick<Desk, 'id' | 'title' | 'owner_name' | 'owner_tag' | 'visibility'> | null
}

export interface DeskPhoto {
  id: string
  desk_id: string
  image_url: string
  pending_revocation_url?: string | null
  sort_order: number
  created_at: string
}

export interface Device {
  id: string
  desk_id: string
  name: string
  category: string
  price: number | null
  ports: unknown[]
  /** 導入日 YYYY-MM-DD。未設定なら created_at を導入日とみなす */
  purchased_at: string | null
  /** 撤去日 YYYY-MM-DD。歴史アニメーションの OUT イベント */
  removed_at: string | null
  created_at: string
}

export interface DbConnection {
  id: string
  desk_id: string
  from_device_id: string
  to_device_id: string
  cable_type: string
  label: string | null
  /** 2in1・3in1 ケーブルの枝。同じ値どうしが1本の物理ケーブル（列が無い旧データは null） */
  branch_group_id: string | null
  /** 同じ組み合わせを何本で繋いでいるか（077）。ステレオの L/R・デュアル電源。既定は1 */
  cable_count: number | null
  /** つなぎ方（076）。'included' は本体付属、'product' は選んだ商品。申告が無い線は null */
  cable_choice: 'included' | 'product' | null
  /** cable_choice='product' のときの商品名。公開ページはこの文字列をそのまま出す */
  cable_name: string | null
  cable_product_id: string | null
  created_at: string
}

export interface DeskVersion {
  id: string
  desk_id: string
  version_name: string
  snapshot: DeskSnapshot
  note: string | null
  cover_url: string | null
  created_at: string
}

// 配線図スナップショット構造 (JSON として保存 / 将来の SVG・PNG 出力対応)
export interface DeskSnapshot {
  devices: Device[]
  connections: DbConnection[]
  total_price?: number
}

// 商品マスタ（migrations/007_products.sql）。アプリ側の共通型は types/product.ts
export interface ProductRow {
  id: string
  asin: string | null
  name: string
  brand: string | null
  product_name: string | null
  category: string | null
  subcategory: string | null
  image: string | null
  description: string | null
  /** 'preset'（gadgetPresets.ts 由来の正規名）/ 'rakuten'（ジャンル取り込み） */
  source: string
  is_suggestable: boolean
  ports: unknown | null
  specs_source_url: string | null
  specs_verified_at: string | null
  created_at: string
}

export interface ShopLinkRow {
  id: string
  product_id: string
  shop: string
  country: string
  affiliate_url: string | null
  official_url: string | null
  price: number | null
  currency: string | null
  in_stock: boolean | null
  /** 楽天のレビュー件数。検索結果の並び順に使う */
  review_count: number | null
  last_updated: string
}

// ─── 結合クエリ用 ────────────────────────────────────────────

export interface DeskWithDetails extends Desk {
  desk_photos: DeskPhoto[]
  devices: Device[]
  connections: DbConnection[]
  versions?: DeskVersion[]
}
