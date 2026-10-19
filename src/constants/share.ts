// ─── SNS共有のハッシュタグ ─────────────────────────────────────
// ブランドタグ（このアプリ発の投稿を集める）＋ 既存コミュニティタグ（人が集まっている
// 場所に乗って発見される）の2階建て。タグを増やしすぎると宣伝臭が出るので3つまで。
//
// ブランドタグは全言語で共通にする。言語ごとに変えるとタグ検索で投稿が分断されるため。
export const BRAND_HASHTAG = '#MyDeskApp'

export const SHARE_HASHTAGS: Record<'ja' | 'en', string> = {
  ja: `${BRAND_HASHTAG} #デスク環境`,
  en: `${BRAND_HASHTAG} #desksetup #battlestation`,
}
