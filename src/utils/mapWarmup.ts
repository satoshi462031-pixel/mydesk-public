import AsyncStorage from '@react-native-async-storage/async-storage'
import { InteractionManager } from 'react-native'
import { DeskPlan, Gadget } from '../types'
import { loadGadgets } from '../store/gadgetStore'
import { loadPlans } from '../store/planStore'
import { getOrComputeMapLayout } from './mapLayoutCache'
import { prepareDeskHistory } from '../components/organisms/DeskHistoryAnimationModal'
import { TimelineGrain } from './deskTimeline'
import { DEMO_DESK_LINKS } from '../constants/demoDeskLinks'
import { prefetchDeskDetail } from './deskDetailPrefetch'
import { toPublicDeskModel } from './publicDeskAdapter'
import { isDeletedGadget } from './gadgetTrash'

// ─── 起動時ウォームアップ ─────────────────────────────────────────
// アプリ起動後の空き時間に、配線図レイアウトと歴史アニメーションを事前計算して
// 共有キャッシュを温める。順番は「マイデスク → 共有されたデスク → デモデスク」。
// デスクを1件も持っていない人はデモデスクしか見るものがないので、デモから温める。
//
// computeMapLayout は同期実行で JS スレッドを塞ぐため、
// ・開始は起動直後の操作が落ち着く 5 秒後
// ・1件ごとに間を置き、操作中は次の1件を始めない
// ・ガジェットが多すぎるプランはスキップ（開いたときのローディング表示に任せる）
// として、起動直後のカクつきの原因にならないことを最優先にする。
// 失敗してもアプリの動作には影響させない（すべて握りつぶす）。

const START_DELAY_MS = 5000
// デスクが0件の人向け。ほかに温めるものが無いので少し早く始める
const DEMO_ONLY_DELAY_MS = 3000
const MAX_WARM_GADGETS = 30
// 1件ごとの間隔（通信＋レイアウト計算＋歴史アニメーションで重い）
const STEP_DELAY_MS = 2500

const LAST_OPENED_KEY = '@last_opened_plan_id'

/** マイデスク（WiringResult）を開いたときに呼ぶ。次回起動のウォームアップ優先順に使う */
export function markPlanOpened(planId: string): void {
  AsyncStorage.setItem(LAST_OPENED_KEY, planId).catch(() => {})
}

let started = false

const idle = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(() => InteractionManager.runAfterInteractions(resolve), ms)
  })

/** 1件ぶんの失敗を切り離す（通信断・データ不整合で後続の温めが止まらないように） */
const guard = async (run: () => Promise<void>): Promise<void> => {
  try {
    await run()
  } catch {
    // ウォームアップの失敗は起動・動作に影響させない
  }
}

/**
 * 公開デスク（共有されたデスク・デモデスク）1件を温める。
 * 取得 → 配線図レイアウト → 歴史アニメーションまで、実際に開いたときと同じ順で通す。
 * 画面と同じ導出（toPublicDeskModel）を使うので、キャッシュのキーは開いたときと一致する。
 */
/**
 * 歴史アニメーションの「まとめる単位」。ユーザーが選んでいる単位で温めないと、
 * 開いたときにキャッシュが当たらず読み込み待ちになる（AppContext と同じキーを読む）。
 */
async function historyGrainOf(): Promise<TimelineGrain> {
  const saved = await AsyncStorage.getItem('app_history_grain').catch(() => null)
  return saved === 'day' || saved === 'year' ? saved : 'month'
}

const warmedDeskIds = new Set<string>()
async function warmUpPublicDesk(deskId: string, lang: 'ja' | 'en', label: string): Promise<void> {
  if (warmedDeskIds.has(deskId)) return
  warmedDeskIds.add(deskId)
  const t0 = Date.now()
  const desk = await prefetchDeskDetail(deskId)
  if (!desk) return
  const { plan, historyGadgets, nonCableGadgets } = toPublicDeskModel(desk)
  await getOrComputeMapLayout(
    plan.id,
    nonCableGadgets,
    plan.connectionMap?.connections ?? [],
    plan.placements,
    plan.connectionMap?.nodeOffsets ?? {},
    plan.connectionMap?.nodeSizes ?? {},
    !!plan.templateId,
  )
  const mapDoneAt = Date.now()
  // 公開デスクの歴史は期間制限なし（PublicDeskScreen と同じ yearsLimit）
  await prepareDeskHistory(plan, historyGadgets, lang, -1, await historyGrainOf())
  if (__DEV__) {
    console.log(`[perf] warmup(public) "${label}": map ${mapDoneAt - t0}ms / history ${Date.now() - mapDoneAt}ms`)
  }
}

async function warmUpDemoDesks(lang: 'ja' | 'en'): Promise<void> {
  for (const link of DEMO_DESK_LINKS) {
    await idle(STEP_DELAY_MS)
    await guard(() => warmUpPublicDesk(link.deskId, lang, link.id))
  }
}

/** 最後に開いた（なければ最終更新の）自分のデスク1件を温める */
async function warmUpLastOpenedPlan(ownPlans: DeskPlan[]): Promise<void> {
  const [allGadgets, lastOpenedId] = await Promise.all([
    loadGadgets(),
    AsyncStorage.getItem(LAST_OPENED_KEY),
  ])

  // 最後に開いたプランを最優先。なければ最終更新プラン
  const target =
    ownPlans.find((p) => p.id === lastOpenedId) ??
    [...ownPlans].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]
  if (!target) return

  const sel = new Set(target.selectedGadgetIds)
  const gadgets: Gadget[] = allGadgets.filter((g) => !isDeletedGadget(g) && sel.has(g.id))
  if (gadgets.length < 2) return
  if (gadgets.length > MAX_WARM_GADGETS) {
    if (__DEV__) console.log(`[perf] warmup skipped: ${gadgets.length} gadgets > ${MAX_WARM_GADGETS}`)
    return
  }

  const t0 = Date.now()
  await getOrComputeMapLayout(
    target.id,
    gadgets,
    target.connectionMap?.connections ?? [],
    target.placements,
    target.connectionMap?.nodeOffsets ?? {},
    target.connectionMap?.nodeSizes ?? {},
    !!target.templateId,
  )
  if (__DEV__) console.log(`[perf] warmup "${target.name}" (${gadgets.length} gadgets): ${Date.now() - t0}ms`)
}

export async function warmUpConnectionMaps(lang: 'ja' | 'en' = 'ja'): Promise<void> {
  if (started) return
  started = true
  let plans: DeskPlan[] = []
  try {
    plans = await loadPlans()
  } catch {
    // プランが読めなくてもデモデスクの温めは続ける
  }
  const ownPlans = plans.filter((p) => !p.isShared)
  const demoOnly = ownPlans.length === 0

  await idle(demoOnly ? DEMO_ONLY_DELAY_MS : START_DELAY_MS)
  if (demoOnly) {
    await guard(() => warmUpDemoDesks(lang))
    return
  }
  await guard(() => warmUpLastOpenedPlan(ownPlans))
  await guard(() => warmUpDemoDesks(lang))
}
