import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'

type Feedback = 'selection' | 'light' | 'medium' | 'success' | 'warning' | 'error'
const lastFeedback: Partial<Record<Feedback, number>> = {}

function feedback(kind: Feedback, android: Haptics.AndroidHaptics, ios: () => Promise<void>, interval = 70): void {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return
  const now = Date.now()
  // 並べ替えやスライダーの連続更新を間引く。種類を分けて、直後の確定・失敗は落とさない。
  const previous = lastFeedback[kind]
  if (previous !== undefined && now - previous < interval) return
  lastFeedback[kind] = now
  try {
    // Segment_Tick は API 34、Confirm / Reject は API 30 から使える。
    const version = Number(Platform.Version)
    if (version < 34 && android === Haptics.AndroidHaptics.Segment_Tick) android = Haptics.AndroidHaptics.Clock_Tick
    if (version < 30 && android === Haptics.AndroidHaptics.Confirm) android = Haptics.AndroidHaptics.Context_Click
    if (version < 30 && android === Haptics.AndroidHaptics.Reject) android = Haptics.AndroidHaptics.Long_Press
    const work = Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(android) : ios()
    void work.catch(() => {})
  } catch {
    // 触覚を提供しない端末でも操作は成立させる。
  }
}

/** コピー・スワイプの確定距離など、軽い一度の手応え */
export function hapticLight(): void {
  feedback('light', Haptics.AndroidHaptics.Context_Click, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light))
}

/**
 * 並んだ選択肢の中で選びが変わった瞬間（タブ・札・ステッパー）。
 * impact より弱く、連続して打っても耳障りにならない。
 * **値が実際に変わったときだけ呼ぶ。** 同じタブを押し直したとき・上限で止まったときに
 * 鳴らすと「押せた」と誤解させる（何も起きていないことが伝わらなくなる）。
 */
export function hapticSelection(): void {
  feedback('selection', Haptics.AndroidHaptics.Segment_Tick, () => Haptics.selectionAsync(), 50)
}

/** ドラッグ開始など、状態が切り替わったことを知らせる操作 */
export function hapticMedium(): void {
  feedback('medium', Haptics.AndroidHaptics.Long_Press, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium))
}

/** 作成・購入の完了 */
export function hapticSuccess(): void {
  feedback('success', Haptics.AndroidHaptics.Confirm, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 300)
}

/** 削除など、取り消しの効く破壊操作 */
export function hapticWarning(): void {
  // Undo できる削除に通知パターンを使うと長すぎるため、短い一発にする。
  feedback('warning', Haptics.AndroidHaptics.Long_Press, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), 150)
}

/**
 * 頼んだことができなかったとき（公開の失敗など）。
 * 入力の形が違うといった「押す前から分かる」ものには使わない。
 * 打ちながら鳴ると、直している最中ずっと叱られ続けることになる。
 */
export function hapticError(): void {
  feedback('error', Haptics.AndroidHaptics.Reject, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error), 300)
}
