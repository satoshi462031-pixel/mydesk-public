import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs'
import type { CompositeNavigationProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { AICoachChatParams, GadgetStackParamList, MainTabsParamList, MyPageStackParamList, PlanStackParamList, PublicStackParamList, RootStackParamList } from '../types'

// ─── 画面が持つ navigation の型 ───────────────────────────────────
//
// 画面は自分のスタックだけでなく、祖先の画面へも navigate している
// （いいねの空状態から 'FeedTab'、投稿者名から 'PublicProfile' など）。
// React Navigation はこれを伝播で解決するが、型は自分の ParamList しか知らないため、
// そのままでは navigate の引数が通らない。祖先を重ねた型をここで一度だけ組む。
//
// これを用意する前は各画面が `navigation: any` で受けていて、画面名の綴りも
// パラメータも検査されていなかった。

/** 祖先（タブ → ルート）ぶん。どのスタックの画面からも同じものへ行ける */
type AncestorNavigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabsParamList>,
  NativeStackNavigationProp<RootStackParamList>
>

/** マイページのスタックにある画面（設定・統計・埋め込みの4タブを含む） */
export type MyPageNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<MyPageStackParamList>,
  AncestorNavigation
>

/** デスクのスタックにある画面 */
export type PlanNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<PlanStackParamList>,
  AncestorNavigation
>

/**
 * AIコーチ（相談履歴・チャット）。デスク側・マイページ側・ルートの3つのスタックへ
 * 積むため、どの ParamList でも通るように行き先だけを書いた小さな型で受ける
 * （AddGadget / GadgetDetail が GadgetStackParamList でそうしているのと同じ）。
 *
 * ルートに積んだぶん（公開デスクから開いたチャット）では AICoachList と AddGadget が
 * 同じスタックに無い。型では区別できないので、画面側が publicDeskId の有無で
 * その2つへの導線を出さない（AICoachChatScreen の rootMounted）。
 */
type AICoachStackParamList = {
  AICoachChat: AICoachChatParams
  AICoachList: undefined
  AddGadget: GadgetStackParamList['AddGadget']
}

export type AICoachNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<AICoachStackParamList>,
  AncestorNavigation
>

/**
 * 他人のデスク・公開プロフィール・ブランドの商品一覧（PublicStackParamList の注記）。
 * 3つのタブのスタックすべてに積むので、自分の ParamList はその3画面＋公開デスクから
 * 開く AIコーチだけしか名乗れない。課金の案内（Root の Paywall）とタブの切り替えは
 * 祖先にあるため、ここで重ねる。
 */
export type PublicNavigation = CompositeNavigationProp<
  NativeStackNavigationProp<PublicStackParamList & { AICoachChat: AICoachChatParams }>,
  AncestorNavigation
>
