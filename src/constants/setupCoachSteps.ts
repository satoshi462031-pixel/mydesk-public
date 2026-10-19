import { SPOTLIGHT_STEPS, isStepOnRoute, spotlightBodyForRoute } from './spotlightSteps'
import type { CoachStep } from '../hooks/useCoachMarks'

const SETUP_DETAIL_COACH: Record<string, CoachStep[]> = {
  TemplateDetail: [
    { target: 'setup-owned-add', title: { ja: '登録済みの機材を使う', en: 'Use registered gear' }, ja: '持ち物から、このデスクで使う機材を選びます。選んだ機材の商品名・金額・導入日も、この画面で変更できます。', en: 'Choose owned gear for this desk. You can still edit its name, price, and date added here.' },
    { target: 'setup-gear-row', title: { ja: '入力・削除', en: 'Edit or remove' }, ja: '商品名・金額・導入日は空欄でも進めます。不要な行は左へスワイプして削除できます。登録済みの機材そのものは削除されません。', en: 'Name, price, and date added can stay blank. Swipe a row left to remove it from this setup without deleting your registered gear.' },
    { target: 'setup-gear-detail', title: { ja: '機材の詳細設定', en: 'Gear details' }, ja: '端子・電源・サイズなど、その機材の詳しい設定を開きます。保存すると、この画面の機材に反映されます。', en: 'Open settings such as ports, power, and size. Save to apply them to this gear.' },
    { target: 'setup-category-add', title: { ja: 'ジャンルを追加', en: 'Add a category' }, ja: '足りない種類の機材を追加します。同じジャンルを複数追加することもできます。', en: 'Add any missing kind of gear. You can add more than one item in a category.' },
  ],
  GadgetSelection: [
    { target: 'setup-outlets', title: { ja: '壁コンセントの口数', en: 'Wall outlets' }, ja: 'このデスクで使える壁コンセントの口数です。配線図を作るときの電源の割り当てに使います。', en: 'Set the number of wall outlets available to this desk. This is used when assigning power in the wiring map.' },
    { target: 'setup-select-gear', title: { ja: '使う機材を選択', en: 'Select your gear' }, ja: 'チェックを付けた機材をこのデスクで使います。外しても持ち物の登録は残ります。検索や全選択も使えます。', en: 'Checked gear is used on this desk. Unchecking keeps it in your inventory. Search and Select all are also available.' },
  ],
  PhotoFill: [
    { target: 'setup-photos', title: { ja: '写真の追加・削除', en: 'Add or remove photos' }, ja: '「写真を選ぶ」で追加し、写真の×で削除します。最初の1枚が一覧の表紙です。上限や残り枚数もここで確認できます。', en: 'Use Choose photos to add images and × to remove them. The first image is the cover. Limits and remaining slots are shown here.' },
  ],
}

export function setupCoachStepsForRoute(route: string): CoachStep[] {
  const step = SPOTLIGHT_STEPS.find(candidate => isStepOnRoute(candidate, route))
  if (!step?.targetId) return []
  const overview: CoachStep = {
    target: step.targetId,
    title: step.key === 'pick-purpose' ? { ja: '用途を選ぶ', en: 'Choose purposes' } : step.title,
    ...spotlightBodyForRoute(step, route),
    coveredBy: step.coveredBy,
    pad: 0,
    radius: step.radius,
  }
  return [overview, ...(SETUP_DETAIL_COACH[route] ?? []).map(detail => ({
    ...detail, within: step.targetId, coveredBy: step.coveredBy, pad: 0,
  }))]
}
