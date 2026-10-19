import AsyncStorage from '@react-native-async-storage/async-storage'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'

// 端末のデスク・ガジェットが「どのアカウントの控えと突き合わせ済みか」の印。
//
// これが無いと、ログインせずに作ったデータ・前のアカウントが残したデータ・
// 自分のデータを見分けられない。見分けられないまま端末側を正としてアカウントへ
// 上げると、無料プランは控えを1件しか持たない（053）ので、アカウントのデータが
// サーバーから消える。印が本人のものになるまでは、アカウントへ上げない。
export const LOCAL_DATA_OWNER_KEY = '@local_data_owner'

// これからログインする操作が始まった印。値はユーザーを問わない（ログインが済むまで
// 誰になるか分からない）。これが立っていれば、ログインせずに作ったデータとして
// アカウントの控えと合わせる。立っていないのに印の無いデータがあるのは、印を持つ前の
// 版からログインしたまま使い続けている人で、そのデータは本人のものとして引き取る。
export const SIGN_IN_PENDING_KEY = '@account_sign_in_pending'

export async function getLocalDataOwner(): Promise<string | null> {
  return withTimeout(AsyncStorage.getItem(LOCAL_DATA_OWNER_KEY), STORAGE_TIMEOUT_MS)
}

export async function isSignInPending(): Promise<boolean> {
  return (await withTimeout(AsyncStorage.getItem(SIGN_IN_PENDING_KEY), STORAGE_TIMEOUT_MS)) !== null
}

/**
 * セッションが張られる前に呼ぶ。張られた瞬間に onAuthStateChange から突き合わせが
 * 走るので、ログインの完了を待ってから立てると間に合わない。
 * 書けなかったらログインも止める（印が無いまま進むと、ログイン前のデータを本人の
 * ものとして上げてしまう）。
 */
export async function markSignInPending(): Promise<void> {
  await withTimeout(AsyncStorage.setItem(SIGN_IN_PENDING_KEY, '1'), STORAGE_TIMEOUT_MS)
}

/** 突き合わせが済んだ。以後このアカウントへの保存を許す */
export async function claimLocalData(userId: string): Promise<void> {
  await AsyncStorage.setItem(LOCAL_DATA_OWNER_KEY, userId)
  await AsyncStorage.removeItem(SIGN_IN_PENDING_KEY)
}
