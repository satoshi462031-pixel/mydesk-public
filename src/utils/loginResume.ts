import type { NavigationState } from '@react-navigation/native'
import type { RootStackParamList } from '../types'

// ログインできたあと、ログインする前の画面へ戻すための判定。
//
// ログインするとアカウントのデータを突き合わせる間ナビゲーションごと外れ、作り直すと本編の
// 最初に戻る。公開・拍手・保存などでログインを求めた人が、元の画面で続きをできるよう、
// 外れる前の並びからログイン画面を除いて戻す。作り直した画面は新しいアカウントで読み直される。

export interface LoginResume {
  /** ログイン画面の下にあった画面の並び。本編（MainTabs）から入ったときだけ */
  state?: NavigationState
  /** Paywall から入ったとき、開き直す Paywall の引数 */
  paywall?: RootStackParamList['Paywall']
}

/** 外れる直前のルートの状態から、ログイン後に戻す先を決める。戻す先が無ければ null */
export function loginResumeFrom(state: NavigationState | undefined): LoginResume | null {
  const top = state?.routes[state.index]
  if (!state || top?.name !== 'Login') return null
  const params = top.params as RootStackParamList['Login']
  const below = state.routes.slice(0, state.index)
  // 初回案内やログイン画面だけの起動から入ったときは、戻す先が無い（本編の最初へ進める）
  const restorable = below.length > 0 && below[0].name === 'MainTabs' && below.every((route) => route.name !== 'Login')
  const restored = restorable ? { ...state, index: below.length - 1, routes: below } : undefined
  if (!restored && !params?.resumePaywall) return null
  return { state: restored, paywall: params?.resumePaywall }
}
