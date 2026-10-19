import { Alert } from './alert'

import { CommonActions, StackActions, TabActions } from '@react-navigation/native'

/**
 * 別タブの中の画面へ移動する。
 *
 * navigate('PlanTab', { screen: 'GadgetLibrary', params }) というネスト指定は、
 * タブ側の route.params に { screen, params } を置いたまま残し、タブ内ナビゲーターは
 * 「前回描画時と params の参照が変わったか」を見て遷移するかどうかを決める
 * （@react-navigation/core の useNavigationBuilder）。
 * このため
 *   1. 遷移の可否がレンダーのタイミングに依存し、往復する導線
 *      （配線図 → 編集 → 戻る → もう一度編集）で 2 回目以降が効かず、
 *      タブの先頭画面（マイガジェット等）で止まることがある
 *   2. 残った params.screen がタブ内スタックの initialRouteName を上書きし続ける
 * という副作用がある。
 *
 * タブの切り替えと、タブ内スタックへの遷移を別々のアクションとして送れば、
 * タブ側に遷移先を残さずに毎回同じ結果になる。
 *
 * なお「行って戻る」を繰り返す導線は、そもそもタブをまたがせない方が安全。
 * 配線図からのガジェット編集は PlanStack の GadgetDetail に移してある。
 */
export function navigateInTab(
  navigation: any,
  tab: string,
  screen: string,
  params?: object,
  options?: TabEntryOptions,
) {
  if (!navigation.isFocused()) return
  const parent = navigation.getParent()
  if (!parent) return
  const tabState = parent.getState().routes.find((route: any) => route.name === tab)?.state
  const targetKey = tabState?.key
  if (!targetKey) {
    // タブ内ナビゲーターがまだ初期化されていない場合のみ、ネスト指定に頼る
    // initial: false でタブの先頭（一覧）を下に敷く。無いと行き先が先頭になり、戻る先が無い。
    // 捨てる作りかけの画面が無いので確認は要らないが、onStart は呼ぶ（共有リンクから起動した回は
    // マイデスクのタブが未初期化のままで、ここを通ると使い方ガイドが始まらなかった）
    if (options?.fresh) options.onStart?.()
    parent.navigate(tab, { screen, params, initial: false })
    return
  }
  // 先にタブ内スタックを目的の画面にしてからタブを切り替える（切り替え後の一瞬のちらつきを防ぐ）。
  // navigate だと同名の画面が下に残っていればそこまで pop し、開いたのに戻るアニメになるうえ、
  // 前の状態（選んだ用途・別デスクのタブ位置）を持った画面に params だけ差し替わる。
  // 一番上に同じ画面が同じ params で出ているときだけ積まずにタブを切り替える
  const top = tabState.routes?.[tabState.index ?? 0]
  if (options?.fresh) {
    confirmDiscardUnfinished(tabState, options, () => {
      parent.dispatch({ ...freshStackAction(tabState, screen, params), target: targetKey })
      parent.navigate(tab)
    }, navigation)
    return
  }
  if (!(top?.name === screen && sameParams(top.params, params))) {
    parent.dispatch({ ...StackActions.push(screen, params), target: targetKey })
  }
  // params なしの navigate はタブ側に残っている { screen, params } も消す。
  parent.navigate(tab)
}

/**
 * 別タブを先頭の画面まで戻し、その画面へ params を渡す。マイページからデスクを作り始めるときに使う
 * （作成の画面はマイデスクのタブにしか無く、作成途中の控え・上限の確認も一覧が持っている）。
 * 作りかけの画面がタブに残っていれば、捨てる前に確かめる
 */
export function navigateToTabRoot(
  navigation: any,
  tab: string,
  screen: string,
  params: object,
  options: TabEntryOptions = {},
) {
  if (!navigation.isFocused()) return
  const parent = navigation.getParent()
  if (!parent) return
  const tabState = parent.getState().routes.find((route: any) => route.name === tab)?.state
  if (!tabState?.key) {
    parent.navigate(tab, { screen, params })
    return
  }
  confirmDiscardUnfinished(tabState, options, () => {
    parent.dispatch({
      ...CommonActions.reset({ index: 0, routes: [{ ...tabState.routes[0], params }] }),
      target: tabState.key,
    })
    parent.navigate(tab)
  }, navigation)
}

/**
 * ルート直下の画面（他人のデスクなど、タブの上に重ねて開くもの）から、タブの中の画面へ移る。
 *
 * 行き先はタブのスタックに先に積んでおき、タブを切り替えてから上に重ねていた画面を閉じる。
 * 閉じた下から行き先が現れるので、「閉じたら元の一覧に戻って、そこから開き直す」2段の
 * 動きにならない。ルートの先頭はログイン状態によって Login のこともあるため、popToTop ではなく
 * MainTabs まで戻す。
 */
export function openInTabFromRoot(
  navigation: any,
  tab: string,
  screen: string,
  params?: object,
  options?: TabEntryOptions,
) {
  if (!navigation.isFocused()) return
  const tabsState = navigation.getState().routes.find((route: any) => route.name === 'MainTabs')?.state
  const stackState = tabsState?.routes?.find((route: any) => route.name === tab)?.state
  const stackKey = stackState?.key
  if (!tabsState?.key || !stackKey) {
    // navigateInTab の同じ分岐と揃える
    if (options?.fresh) options.onStart?.()
    navigation.navigate('MainTabs', { screen: tab, params: { screen, params, initial: false } })
    return
  }
  const go = () => {
    navigation.dispatch({
      ...(options?.fresh ? freshStackAction(stackState, screen, params) : StackActions.push(screen, params)),
      target: stackKey,
    })
    navigation.dispatch({ ...TabActions.jumpTo(tab), target: tabsState.key })
    navigation.navigate('MainTabs')
  }
  if (options?.fresh) confirmDiscardUnfinished(stackState, options, go, navigation)
  else go()
}

export interface TabEntryOptions {
  /**
   * タブのスタックを「先頭の画面 → 行き先」の2枚に組み直す。デスク作成のように、途中の段を
   * スタックの中で探して戻る流れ（navigation/setupStepNavigation.ts）を始めるときに使う。
   * 作りかけの別の流れの上に積むと、前の段を探したときに古い流れの画面へ戻ってしまう
   */
  fresh?: boolean
  /** fresh で作りかけの画面を捨てるときの確認の言語 */
  lang?: 'ja' | 'en'
  /** 確認でキャンセルされなかったときだけ、遷移の直前に呼ぶ（案内の開始など） */
  onStart?: () => void
}

// デスクを作る前の段。ここにいる間の入力（用途・商品名など）は画面の中にしか無く、
// スタックを組み直すと戻せない。作成後の段（配置・写真）はデスクが保存済みなので含めない
const UNFINISHED_SETUP_SCREENS = new Set(['PurposeSelection', 'TemplateDetail'])
const pendingTabEntries = new WeakMap<object, object>()

function confirmDiscardUnfinished(stackState: any, options: TabEntryOptions, proceed: () => void, navigation: any) {
  const unfinished = (stackState?.routes ?? []).some((route: any) => UNFINISHED_SETUP_SCREENS.has(route.name))
  const start = () => {
    if (!navigation.isFocused()) return
    options.onStart?.()
    proceed()
  }
  if (!unfinished) {
    start()
    return
  }
  if (pendingTabEntries.has(navigation)) return
  const ticket = {}
  pendingTabEntries.set(navigation, ticket)
  const cancel = () => { if (pendingTabEntries.get(navigation) === ticket) pendingTabEntries.delete(navigation) }
  const ja = options.lang !== 'en'
  Alert.alert(
    ja ? '作成中のデスクがあります' : 'You have a desk in progress',
    ja ? '入力中の内容を破棄して、新しく作り始めますか？' : 'Discard what you entered and start a new desk?',
    [
      { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel', onPress: cancel },
      { text: ja ? '破棄して始める' : 'Discard and start', style: 'destructive', onPress: () => {
        if (pendingTabEntries.get(navigation) !== ticket) return
        cancel()
        start()
      } },
    ], { onDismiss: cancel },
  )
}

function freshStackAction(stackState: any, screen: string, params?: object) {
  return CommonActions.reset({
    index: 1,
    // 先頭（一覧）は key ごと渡して作り直さない
    routes: [stackState.routes[0], { name: screen, params }],
  })
}

function sameParams(a?: object, b?: object): boolean {
  const left = (a ?? {}) as Record<string, unknown>
  const right = (b ?? {}) as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (left[key] !== right[key]) return false
  }
  return true
}
