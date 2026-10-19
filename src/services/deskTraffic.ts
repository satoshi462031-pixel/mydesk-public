// 公開デスクの閲覧・購入リンクを開いた数（091）。
// 渡すのはデスクIDと種別だけ。サーバーが短時間の重複を抑えて集計する。
// 持ち主自身の閲覧はサーバー側で除く。
import { supabase } from '../supabase/client'

export type DeskTrafficKind = 'app_view' | 'shop_open'

export function recordDeskTraffic(deskId: string, kind: DeskTrafficKind): void {
  // 数え損ねても画面の動作には関係しない。待たせず、失敗も表に出さない
  void Promise.resolve(supabase.rpc('record_desk_app_traffic', { p_desk_id: deskId, p_kind: kind }))
    .catch(() => {})
}
