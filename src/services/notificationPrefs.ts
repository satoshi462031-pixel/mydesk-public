// 通知の種類ごとのオン・オフ（096）。送るかを決めるのはサーバー（notify-followers / notify-claps）
// なので、設定は端末ではなくアカウントに持つ。行が無い人は両方オン。
import { supabase } from '../supabase/client'

export interface NotificationPrefs {
  /** フォロー中の人のデスクの公開・更新 */
  followUpdates: boolean
  /** 自分のデスクへの拍手 */
  claps: boolean
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { followUpdates: true, claps: true }

export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('follow_updates, claps')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return DEFAULT_NOTIFICATION_PREFS
  return { followUpdates: data.follow_updates !== false, claps: data.claps !== false }
}

export async function setNotificationPrefs(userId: string, prefs: NotificationPrefs): Promise<void> {
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({
      user_id: userId,
      follow_updates: prefs.followUpdates,
      claps: prefs.claps,
      updated_at: new Date().toISOString(),
    })
  if (error) throw error
}
