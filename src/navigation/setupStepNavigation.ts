import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { DeskPlan, Gadget, PlanPurpose, PlanStackParamList, SetupResume } from '../types'
import { compositionFromPlan, compositionTemplateId } from '../utils/deskComposition'

type SetupNavigation = NativeStackNavigationProp<PlanStackParamList>
type SetupBackRoute = 'PurposeSelection' | 'GadgetSelection' | 'DeskPlacement'

/**
 * デスク作成の進捗バーで、今より前の段へ戻る。
 *
 * push で開くと右から画面が来て「次へ進んだ」ように見えるため、戻る向きの動きにする。
 * 行き先がスタックに残っていれば pop でそこまで戻る（入力途中の選択もそのまま残る）。
 * 配置の段以降は作成時に reset で途中画面を消しているので残っていない。そのときは
 * 今の画面を行き先に置き換え、setupBack を付けて animationTypeForReplace を pop にする
 * （RootNavigator）。今の画面を下に残したまま積むと、戻る動きにはできない。
 */
export function backToSetupStep<R extends SetupBackRoute>(
  navigation: SetupNavigation,
  name: R,
  params: NonNullable<PlanStackParamList[R]>,
): void {
  if (!navigation.isFocused()) return
  const state = navigation.getState()
  // 用途は「戻る前にいた段」を持つ。付けずに戻ったときは前回の値を消す
  const nextParams = name === 'PurposeSelection'
    ? { resume: undefined, ...params }
    : params
  for (let i = state.index - 1; i >= 0; i -= 1) {
    const route = state.routes[i]
    if (route.name === name) {
      // key 指定の navigate はその画面まで pop し、params を差し込む（pop だけだと resume が届かない）
      navigation.navigate({ key: route.key, params: nextParams, merge: true } as never)
      return
    }
  }
  const root = state.routes[0]
  navigation.reset({
    index: 1,
    routes: [
      // 一覧は作り直さない（key を持ったまま渡すとそのまま残る）
      { name: root.name, key: root.key, params: root.params },
      { name, params: { ...nextParams, setupBack: true } },
    ],
  })
}

/**
 * 作成済みのデスクで、機材の段（2段目）を開く。進捗バーで後ろの段から戻るとき（direction: 'back'）と、
 * マイデスク一覧の「作成を続ける」から開くとき（'forward'）の両方で使う。
 *
 * 以前は「ガジェットを選択」（GadgetSelection・持ち物にチェックを付ける画面）を開いていたが、
 * 作成中に見た機材の段（ジャンルごとの枠に商品を入れる画面）と形が違い、別の画面に飛んだように見えた。
 * 同じ TemplateDetail を今のデスクの機材から組み直して開く
 */
export function openGearStep(
  // 一覧（params を持たない画面）からも呼ぶので、使う2つだけを受け取る
  navigation: Pick<SetupNavigation, 'getState' | 'reset' | 'isFocused'>,
  plan: Pick<DeskPlan, 'id' | 'selectedGadgetIds' | 'monitorArmAssignments' | 'micArmAssignments' | 'purposes' | 'otherPurposeLabel' | 'otherPurposeIcon' | 'otherPurposeColor'>,
  gadgets: readonly Gadget[],
  direction: 'back' | 'forward',
): void {
  if (!navigation.isFocused()) return
  const composition = compositionFromPlan(plan, gadgets)
  const choice = {
    purposes: plan.purposes ?? [],
    otherPurposeLabel: plan.otherPurposeLabel,
    otherPurposeIcon: plan.otherPurposeIcon,
    otherPurposeColor: plan.otherPurposeColor,
  }
  const detail = {
    ...choice,
    templateId: compositionTemplateId(composition),
    composition,
    returnPlanId: plan.id,
  }
  const root = navigation.getState().routes[0]
  navigation.reset({
    index: 1,
    routes: [
      { name: root.name, key: root.key, params: root.params },
      { name: 'TemplateDetail', params: direction === 'back' ? { ...detail, setupBack: true as const } : detail },
    ],
  })
}

/**
 * 用途を選び直したあと、戻る前にいた段（resume）へ直接進む。
 *
 * 機材の段へは用途の画面の上に積む（戻るで用途に出られる）。用途の画面の resume は消しておく
 * （戻ってもう一度「次へ」を押したときに、古い機材の段へ飛ばさない）。
 * 作成後の段（配置・写真・機材の選び直し）は reset で途中画面を消して置き換える。
 */
export function resumeSetupStep(
  navigation: SetupNavigation,
  resume: SetupResume,
  choice: { purposes: PlanPurpose[]; otherPurposeLabel?: string; otherPurposeIcon?: string; otherPurposeColor?: string },
): void {
  if (!navigation.isFocused()) return
  const state = navigation.getState()
  if (resume.name === 'TemplateDetail') {
    const detail = { ...resume.params, ...choice }
    // 下に残る用途の resume もすべて消す。今の画面だけ消すと、機材の段から戻って
    // 用途で「次へ」を押したときに、下の画面に残った resume で古い機材の段へ飛ばされる
    const kept = state.routes.slice(0, state.index + 1).map((route) => ({
      key: route.key,
      name: route.name,
      params: route.name === 'PurposeSelection'
        ? { ...(route.params ?? {}), resume: undefined }
        : route.params,
    }))
    navigation.reset({
      index: kept.length,
      routes: [...kept, { name: 'TemplateDetail', params: detail }],
    })
    return
  }
  const root = state.routes[0]
  navigation.reset({
    index: 1,
    routes: [
      { name: root.name, key: root.key, params: root.params },
      { name: resume.name, params: resume.params },
    ],
  })
}
