import type { NavigationProp } from '@react-navigation/native'
import type { PaywallReason, RootStackParamList } from '../types'

// ─── 親（RootStack）の画面を開く ──────────────────────────────────
//
// 画面が持っているのは PlanStack / FeedStack などの子ナビゲーターで、
// Paywall はその親にある。親へ渡るには getParent() を挟むが、
// React Navigation は親の型を推論できないので、行き先の型を明示しないと
// navigate() の引数が any に落ちる。
//
// 以前は呼び出し側で `(navigation as any).getParent()?.navigate('Paywall', …)` と
// 書いていて、17箇所すべてで**画面名の綴りもパラメータも型検査を通っていなかった**
// （'Paywal' と書いてもビルドが通り、実機で無反応になる）。
// 親を解決する型注釈はこのファイル1箇所に閉じ込め、呼び出し側は関数を呼ぶだけにする。

type RootNavigation = NavigationProp<RootStackParamList>

/** getParent() を持つナビゲーター。子スタックの navigation はすべてこれを満たす */
interface HasParent {
  getParent<T = unknown>(): T
}

/** 課金の案内を開く。理由は Paywall 側の見出しと計測に使われる */
export function openPaywall(navigation: HasParent, reason?: PaywallReason, planId?: string): void {
  navigation.getParent<RootNavigation | undefined>()?.navigate('Paywall', { reason, planId })
}
