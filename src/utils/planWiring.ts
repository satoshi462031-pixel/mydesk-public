import { DeskPlan, Gadget, NodeOffset } from '../types'
import { baseMapNodeId, DECOR_ID, mapSignature, POWER_SOURCE_IDS, reconcileMap } from './connectionMapLayout'
import { applyDeskGadgetUsage } from './deskGadgetUsage'
import { generateWiring } from './wiringEngine'

/**
 * 配線図にカードが出なくなったガジェット（デスクから外した・このデスクでは飾りにした）の
 * 位置調整を捨てる。残すと、戻したときに外す前のずらし量・置き場所で出る
 * （外している間に構成が変わっていれば、どこでもない場所に出る）。
 * 変わらなければ同じオブジェクトを返す
 */
function offsetsOnMap(
  offsets: Record<string, NodeOffset> | undefined,
  appliedGadgets: readonly Gadget[],
  selectedIds: readonly string[],
): Record<string, NodeOffset> | undefined {
  if (!offsets) return offsets
  const selected = new Set(selectedIds)
  const shown = new Set(appliedGadgets.filter((g) => selected.has(g.id) && !g.displayOnly).map((g) => g.id))
  const entries = Object.entries(offsets)
  const kept = entries.filter(([nodeId]) => {
    // スピーカーの左右・分割キーボード・ウーファーは、元ガジェットIDに接尾辞を付けたカードになる
    const gadgetId = baseMapNodeId(nodeId)
    return shown.has(gadgetId) || POWER_SOURCE_IDS.has(gadgetId) || gadgetId === DECOR_ID
  })
  return kept.length === entries.length ? offsets : Object.fromEntries(kept)
}

/**
 * 両端がこのデスクに載っている機材（か電源）の線だけを返す。
 * 手で引いた線は、デスクから外した機材の分も保存に残す（reconcileMap。戻したときに復活させるため）。
 * 配線図の描画は両端の実在を確かめて落としているが、数える・送る側も絞らないと、
 * 外した機材との線が統計や AI への送信に入る
 */
export function connectionsOnDesk<T extends { fromGadgetId: string; toGadgetId: string }>(
  connections: readonly T[],
  selectedGadgetIds: readonly string[],
): T[] {
  const ids = new Set(selectedGadgetIds)
  const onDesk = (id: string) => ids.has(id) || POWER_SOURCE_IDS.has(id)
  return connections.filter((c) => onDesk(c.fromGadgetId) && onDesk(c.toGadgetId))
}

/**
 * デスクで選んでいる機材が1台も手元に見つからないか。ガジェットをまだ（または読めずに）
 * 持っていないときに起きる。本当に0台のデスク（ID が空）は含まない。
 * これを「0台」として作り直す・公開すると、線も機材も空で保存・公開される
 */
export function missingAllSelectedGadgets(plan: DeskPlan, gadgets: readonly Gadget[]): boolean {
  if (plan.selectedGadgetIds.length === 0) return false
  const ownedIds = new Set(gadgets.map((g) => g.id))
  return !plan.selectedGadgetIds.some((id) => ownedIds.has(id))
}

/**
 * デスクの配線（wiringResult と配線図の線）を今のガジェットで作り直す。
 *
 * 作り直しはデスク画面を開いたときにしか走らないので、デスク画面の外で構成やガジェットを
 * 変えたあとの plan は古い配線を持っている。公開・AI への送信のように plan を外へ出す前にも
 * これを通す（通さないと、足したガジェットに線が無いまま公開される）。
 *
 * 中身が変わらなければ同じ plan をそのまま返す。無条件に作り直した plan を保存すると、
 * 開いただけで updatedAt が動き、一覧の更新順と編集日が閲覧日にすり替わる。
 */
export function refreshPlanWiring(
  plan: DeskPlan,
  gadgets: readonly Gadget[],
  lang: 'ja' | 'en',
): { plan: DeskPlan; firstBuild: boolean } {
  // 読めていないのと本当に0台なのを分けて扱う。以前は「0台なら線をそのまま残す」で
  // 読めていない場合を代用していたため、全部外した・全部撤去したデスクに古い線が残り、
  // 統計や AI への送信に機材0台の配線が出ていた
  if (missingAllSelectedGadgets(plan, gadgets)) return { plan, firstBuild: false }
  // 「このデスクでは飾り」などデスクごとの状態を通す。生の gadgets で組むと飾りにも線が引かれる
  const appliedGadgets = gadgets.map((g) => applyDeskGadgetUsage(plan, g))
  const freshResult = generateWiring(appliedGadgets, plan, lang)
  const existing = plan.connectionMap?.connections ?? []
  const freshMap = reconcileMap(existing, appliedGadgets, plan, lang)
  const wiringChanged = JSON.stringify(freshResult) !== JSON.stringify(plan.wiringResult)
  const mapChanged = mapSignature(freshMap) !== mapSignature(existing)
  const firstBuild = existing.length === 0 && freshMap.length > 0
  const nodeOffsets = offsetsOnMap(plan.connectionMap?.nodeOffsets, appliedGadgets, plan.selectedGadgetIds)
  const offsetsPruned = nodeOffsets !== plan.connectionMap?.nodeOffsets
  if (!wiringChanged && !mapChanged && !offsetsPruned) return { plan, firstBuild }
  return {
    plan: {
      ...plan,
      wiringResult: freshResult,
      connectionMap: {
        ...plan.connectionMap,
        connections: freshMap,
        ...(offsetsPruned ? { nodeOffsets } : {}),
      },
      // 使われなくなった位置調整を捨てただけなら更新日は動かさない（本人は何も編集していない）
      updatedAt: wiringChanged || mapChanged ? new Date().toISOString() : plan.updatedAt,
    },
    firstBuild,
  }
}

/**
 * 公開の直前に呼ぶ。配線を作り直して保存し、保存した plan を返す（デスクが無ければ null）。
 *
 * 保存までするのは、公開した内容と端末の plan を揃えるため。作り直した plan を公開するだけだと、
 * 端末側が古いまま残り、公開した直後に「更新あり」が出る。デスクを開いた直後に公開した場合
 * （裏の再計算より先に押した場合）も同じことが起きていた
 */
export async function saveFreshWiring(
  updateWith: (id: string, fn: (prev: DeskPlan) => DeskPlan) => Promise<void>,
  planId: string,
  gadgets: readonly Gadget[],
  lang: 'ja' | 'en',
): Promise<DeskPlan | null> {
  let latest: DeskPlan | null = null
  await updateWith(planId, (prev) => {
    const refreshed = refreshPlanWiring(prev, gadgets, lang).plan
    latest = refreshed
    return refreshed
  })
  return latest
}

/**
 * 配線図が描けなくなったデスクを、機材を消さずに描ける状態へ戻す（配線図の「配置と配線をリセット」）。
 *
 * 図の失敗はほぼ、保存された位置（nodeOffsets / nodeSizes）か線のデータから来る。
 * 位置と大きさは捨て、形の壊れた線だけを外してから、通常と同じ再計算（refreshPlanWiring）で
 * 線を作り直す。つなぎ方・手で引いた線・非表示にした線は、形が正しければ組で引き継がれる。
 * 歴史用の配置（layoutSnapshots / historyLayouts）は通常の図の失敗とは別なので触らない。
 */
export function resetPlanLayout(plan: DeskPlan, gadgets: readonly Gadget[], lang: 'ja' | 'en'): DeskPlan {
  const connections = (plan.connectionMap?.connections ?? []).filter((c) =>
    !!c && typeof c === 'object'
    && typeof c.id === 'string'
    && typeof c.fromGadgetId === 'string'
    && typeof c.toGadgetId === 'string'
    && typeof c.cableType === 'string')
  const cleared: DeskPlan = {
    ...plan,
    wiringResult: undefined,
    connectionMap: {
      ...plan.connectionMap,
      connections,
      nodeOffsets: undefined,
      nodeSizes: undefined,
    },
    updatedAt: new Date().toISOString(),
  }
  return refreshPlanWiring(cleared, gadgets, lang).plan
}
