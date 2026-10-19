// アカウント固有のローカルデータを保持しているキー。
// テーマ・言語・認証セッション等の端末設定は削除対象に含めない。
const STATIC_KEYS = [
  // 本体データ。キャッシュ破棄だけでは再起動時にディスクから復活するため削除する。
  '@desk_plans',
  '@desk_gadgets',
  '@desk_gadgets_migration',
  '@gadget_folders',
  // 自作ジャンルの一覧（hooks/useCustomCategories.ts）。持ち物と同じくアカウントの内容
  '@custom_categories_v1',
  '@ai_conversations_v2',
  '@ai_data_consent',
  '@desk_history',
  // 共有端末で次のアカウントへ既読位置を引き継がない。
  '@bookmark_seen',
  // みんなのデスクで実際に開いた内容時刻。「新着／更新」表示を次のアカウントへ渡さない。
  '@public_desk_viewed_v1',
  // マイページの「履歴」タブ（utils/viewHistory.ts）。誰のデスクを見たかを次のアカウントへ見せない
  '@desk_view_history_v1',
  // ベル（更新一覧をどこまで見たか）。@bookmark_seen と同じ既読で、置き場所が
  // 別なだけ。片方だけ消すと、次のアカウントで出るはずの点が出ない
  '@desk_updates_seen_at',
  // 自分のデスクへのいいねをベルでどこまで見たか（086）。残すと次のアカウントの基準がずれる
  '@desk_reactions_seen_at',
  // 前回の同期で追っていたフォロー相手。残すと、次のアカウントが同じ人をフォローした
  // 直後に、その人の既存デスクが全部「新しいデスク」として並ぶ
  '@followed_users_seen',
  // 作りかけのデスクは端末設定ではなく本人の「内容」。既読位置と同じ理由で、
  // 次のアカウントへ引き継がない（@product_fill_draft_v1: は下の接頭辞側で拾う）
  '@first_setup_draft_v1',
  // 作成途中に先に作ったガジェットの ID（store/templateDraftGadgets.ts）。ガジェットと一緒に消す
  '@template_draft_gadget_ids',
  // 前アカウントの復元ポイントを残すと、次のアカウントのデータを全置換できてしまう。
  '@backup_restore_point',
  '@backup_damaged_restore_point',
  '@backup_restore_journal',
  '@backup_recovery_pending',
  // 新しいアカウントの初回バックアップを最大24時間遅らせない。
  // 端末識別用の @backup_device_id はアカウントを跨いで維持する。
  '@backup_last_at',
  // 控えの突き合わせの基点（services/backupService.ts）。前のアカウントの控えの ID を残すと、
  // 次のアカウントで「別の端末の新しい控えがある」と誤って止まる
  '@backup_base',
  '@backup_pending',
  '@backup_notice_at',
  '@last_opened_plan_id',
  // マイデスク一覧の並び（store/planOpenedStore.ts）。デスクIDごとの記録なので、デスクと一緒に消す
  '@plan_opened_at_v1',
  // 端末のデータがどのアカウントと突き合わせ済みか（store/accountDataOwner.ts）。
  // データと一緒に消さないと、空になった端末が前のアカウントの持ち物のまま残る
  '@local_data_owner',
  '@account_sign_in_pending',
  // デスクごとに1回だけ出す配線図の断り。デスク自体が消える以上、記録も残さない
  '@wiring_notice_seen',
  // 全商品名を入れ終えたときの公開・共有案内。デスクと一緒に記録も消す
  '@desk_completion_prompt_seen_v1',
  // 配線の登録漏れの確認を閉じた記録。デスクと一緒に消す
  '@wiring_suggestion_dismissed_v1',
  // デスク削除の後始末の控え（services/deskDeletionCleanup.ts）。公開デスクの対応表と一緒に
  // 消えるので、次のアカウントでは何もできない。残すと次の人の一覧を開くたびに読むだけになる
  '@pending_desk_cleanups_v1',
  // 参照の無い写真を見つけた時刻（services/planImageSweep.ts）。写真と一緒に消える
  '@plan_image_sweep_candidates_v1',
  'public_nickname',
  // 旧バージョンからの移行前に残っている場合も、アカウント切替時に消す。
  'desk_name',
  'account_email',
]

// 公開状態の3キー（ID・公開範囲・署名）は publishService が常にセットで書き消しする。
// ここで署名だけ残すと、前のアカウントのゴミが端末に残り続ける
const DYNAMIC_PREFIXES = [
  // 検索語を次のアカウントへ引き継がない。
  '@public_search_history_v1:',
  '@desk_history:', '@published_desk_', '@published_visibility_', '@published_signature_',
  '@publication_recovery:',
  // デスクごとの商品割り当ての下書き（@product_fill_draft_v1:<planId>）
  '@product_fill_draft_v1:',
  '@history_layout_cache:',
]

export function localUserDataKeys(allKeys: readonly string[]): string[] {
  return allKeys.filter(
    (key) => STATIC_KEYS.includes(key) || DYNAMIC_PREFIXES.some((prefix) => key.startsWith(prefix)),
  )
}
