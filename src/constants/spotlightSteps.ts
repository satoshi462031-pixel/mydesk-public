// OKで説明を閉じたあと、実際の操作・画面遷移に合わせて次の案内を出す。
export type SpotlightTargetId = 'setup-progress' | 'purpose-options' | 'setup-action' | 'setup-footer'
  | 'gear-inputs' | 'layout-area' | 'photo-area' | 'wiring-tab'
export type SpotlightFeatureId =
  | 'pick-purpose'
  | 'assign-gadgets'
  | 'place-gadgets'
  | 'add-photos'
  | 'view-wiring'
  | 'done'

interface Localized {
  ja: string
  en: string
}

export interface SpotlightStep {
  key: SpotlightFeatureId
  presentation?: 'inline'
  /** 光らせる対象。未指定なら解説カードだけ出す */
  targetId?: SpotlightTargetId
  /** 対象の上に重なる領域。固定フッターの裏まで囲まないために使う。 */
  coveredBy?: SpotlightTargetId[]
  /** この案内を出している画面。戻るボタンで前の画面に戻ったとき、案内を巻き戻すために使う */
  screen?: string | string[]
  /** 光らせる対象がないときのカード位置。既定は上部 */
  place?: 'top' | 'bottom'
  /**
   * 上部に置くとき、SetupProgress の高さぶん下げるか。
   * 作成フローの画面はヘッダーの下に進捗バーが居るので、逃がさないと段の表示を隠す
   */
  underSetupProgress?: boolean
  /** 測定した矩形をどれだけ広げて切り抜くか。アイコンだけを ref にしている箇所で使う */
  padding?: { x: number; y: number }
  radius?: number
  /** 暗転させるか。既定は「対象があるとき」または「読ませるだけのステップ」 */
  dim?: boolean
  title: Localized
  body: Localized
  bodyByScreen?: Record<string, Localized>
  /** 画面上で次に行う操作。実操作で進むステップだけ表示する */
  action?: Localized
  /**
   * route: そのルートに到達したら次へ（＝案内どおりに操作できた）。
   *        分岐がある画面では複数指定する
   * signal: 画面内の操作を検知したら次へ
   * button: 解説を読んでボタンで次へ
   */
  advance:
    | { type: 'route'; route: string | string[] }
    | { type: 'signal' }
    | { type: 'button'; label: Localized }
}

export const SPOTLIGHT_STEPS: SpotlightStep[] = [
  {
    key: 'pick-purpose',
    screen: 'PurposeSelection',
    targetId: 'purpose-options',
    coveredBy: ['setup-footer'],
    padding: { x: 0, y: 0 },
    title: { ja: '最初のデスクを作る', en: 'Create your first desk' },
    body: {
      ja: 'デスクの用途を選びましょう。複数選べます。選んだら、画面下の「次へ」で進めます。用途はあとから変更できます。',
      en: 'Choose one or more purposes for your desk, then tap Next at the bottom. You can change them later.',
    },
    // 後ろの段から戻ってきた人は「次へ」でその段（配置・写真）へ直接戻る（resumeSetupStep）。
    // ここに入れておかないと案内が step 0 のまま宙に浮き、完成しても既読が立たない
    advance: { type: 'route', route: ['TemplateDetail', 'GadgetSelection', 'DeskPlacement', 'PhotoFill'] },
  },
  {
    key: 'assign-gadgets',
    screen: ['TemplateDetail', 'GadgetSelection'],
    targetId: 'gear-inputs',
    coveredBy: ['setup-footer'],
    padding: { x: 0, y: 0 },
    title: { ja: '使う機材を選ぶ', en: 'Choose your gear' },
    body: {
      ja: '使う機材と商品名・金額・導入日を設定します。空欄のままでも進めます。画面下の「次へ（配置）」で配置へ進みます。',
      en: 'Choose your gear and enter product names, prices, and dates added. Fields can stay blank. Tap Next: Layout at the bottom to continue.',
    },
    bodyByScreen: {
      GadgetSelection: {
        ja: '登録済みの機材から、このデスクで使うものを選んでください。',
        en: 'Select the registered gadgets you use on this desk.',
      },
    },
    // マイデスクの一覧から作りかけのデスクを開いた機材の画面は、配置を通らずに
    // 写真か配線図へ直行する。DeskPlacement だけだと案内が消えたまま終わらず、
    // 次の起動からもこの段が出続けていた
    advance: { type: 'route', route: ['DeskPlacement', 'PhotoFill', 'WiringResult'] },
  },
  {
    key: 'place-gadgets',
    screen: 'DeskPlacement',
    targetId: 'layout-area',
    coveredBy: ['setup-footer'],
    padding: { x: 0, y: 0 },
    title: { ja: '配置はあとで調整できます', en: 'Layout can wait' },
    body: {
      ja: '機材を長押しして動かし、2本指で図を拡大できます。大きさは作成後の配線図で変更できます。並べ直さず、画面下の「完了」で進んでも大丈夫です。',
      en: 'Hold gear to move it and pinch to zoom the map. Resize gear in the wiring map after setup. You can also tap Done below without rearranging anything.',
    },
    // 写真を持たないデスクは写真の段へ、持っていれば配線図へ直行する
    advance: { type: 'route', route: ['PhotoFill', 'WiringResult'] },
  },
  {
    key: 'add-photos',
    screen: 'PhotoFill',
    targetId: 'photo-area',
    coveredBy: ['setup-footer'],
    padding: { x: 0, y: 0 },
    title: { ja: '写真はあとで大丈夫', en: 'Photos can wait' },
    body: {
      ja: 'デスク名・説明・写真を設定できます。写真はあとからでも大丈夫です。画面下のボタンで進むとデスクが保存されます。',
      en: 'Set the desk name, description, and photos here. Photos can wait. Use the button at the bottom to save and continue.',
    },
    advance: { type: 'route', route: 'WiringResult' },
  },
  {
    key: 'view-wiring',
    screen: 'WiringResult',
    dim: true,
    targetId: 'wiring-tab',
    padding: { x: 5, y: 5 },
    radius: 10,
    title: { ja: '配線図を見てみる', en: 'Open the wiring map' },
    body: {
      ja: '「配線」を開くと、登録した機材のつなぎ方を確認できます。',
      en: 'Open Wiring to see how your registered gear connects.',
    },
    advance: { type: 'signal' },
  },
  {
    key: 'done',
    dim: true,
    screen: 'WiringResult',
    place: 'bottom',
    title: { ja: '最初のデスクが完成しました', en: 'Your first desk is ready' },
    body: {
      ja: 'マイデスクに保存しました。機材や写真はいつでも編集できます。',
      en: 'Saved to My Desks. You can edit the gear and photos anytime.',
    },
    advance: { type: 'button', label: { ja: '完了', en: 'Done' } },
  },
]

const onScreen = (step: SpotlightStep, route: string): boolean =>
  step.screen === undefined
    ? false
    : Array.isArray(step.screen)
      ? step.screen.includes(route)
      : step.screen === route

/**
 * その案内を出してよい画面にいるか。screen を指定していない案内はどこでも出す。
 * 案内は「その画面で操作してもらう」前提なので、別の画面へ移った間は出さない。
 */
/**
 * キーからステップ番号を引く。オンボーディング直後のように、途中の
 * ステップから案内を始めたいときに使う（番号を直に書くと並びを変えたとき壊れる）
 */
export function spotlightStepIndex(key: string): number {
  const index = SPOTLIGHT_STEPS.findIndex((s) => s.key === key)
  return index < 0 ? 0 : index
}

export function isStepOnRoute(step: SpotlightStep, route: string): boolean {
  return step.screen === undefined || onScreen(step, route)
}

export function spotlightBodyForRoute(step: SpotlightStep, route: string): Localized {
  return step.bodyByScreen?.[route] ?? step.body
}

/**
 * デスク作成の流れの画面か（総括の画面＝配線図は除く）。
 * 配線図は一覧から既存のデスクを開いても着くので、そこへの到着で案内を進めるのは
 * この流れの画面から来たときだけにする。見ないと、途中で一覧へ戻った人が別のデスクを
 * 開いただけで総括が出て、作っていないのに案内が終わっていた
 */
export function isSetupFlowRoute(route: string | undefined): boolean {
  if (!route) return false
  return SPOTLIGHT_STEPS.some((step) => step.advance.type === 'route' && onScreen(step, route))
}

/** その到着で案内を進めてよいか。流れの外からも開ける総括の画面だけ、来た画面を見る */
export function canAdvanceOnArrival(route: string, from: string | undefined): boolean {
  const last = SPOTLIGHT_STEPS[SPOTLIGHT_STEPS.length - 1]
  return !onScreen(last, route) || isSetupFlowRoute(from)
}

/**
 * 画面遷移で進んだときの次ステップ。
 * テンプレートを使わない分岐など、途中画面を飛ばした場合は現在の画面に合う案内まで進める。
 */
export function advanceStepIndexForRoute(current: number, route: string): number {
  for (let i = current + 1; i < SPOTLIGHT_STEPS.length; i++) {
    if (onScreen(SPOTLIGHT_STEPS[i], route)) return i
  }
  return Math.min(current + 1, SPOTLIGHT_STEPS.length - 1)
}

/**
 * 戻るボタンで前の画面へ戻ったときに、巻き戻す先の案内を返す（戻す必要がなければ -1）。
 * いまの案内がその画面のものなら何もしない。同じ画面に複数の案内がある場合は
 * 最後のもの（＝その画面でまだやることが残っている案内）へ戻す。
 */
export function rewindStepIndexForRoute(route: string, current: number): number {
  const step = SPOTLIGHT_STEPS[current]
  if (!step || onScreen(step, route)) return -1
  // 最後の総括だけは巻き戻さない。デスクは作り終えているので、案内をやり直させる意味がない
  if (current === SPOTLIGHT_STEPS.length - 1) return -1
  for (let i = Math.min(current, SPOTLIGHT_STEPS.length) - 1; i >= 0; i--) {
    if (onScreen(SPOTLIGHT_STEPS[i], route)) return i
  }
  return -1
}

/** 再起動・段の直接移動でも作成画面に合う案内に復帰する。既存デスクの閲覧では進めない。 */
export function recoverSpotlightStepForRoute(route: string, current: number): number {
  const step = SPOTLIGHT_STEPS[current]
  if (!step || onScreen(step, route) || !isSetupFlowRoute(route)) return -1
  return SPOTLIGHT_STEPS.findIndex((candidate) => onScreen(candidate, route))
}
