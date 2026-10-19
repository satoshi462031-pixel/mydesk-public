import { useCallback, useEffect, useRef, useState } from 'react'
import { DeskPlan } from '../types'
import { loadPlans, savePlans } from '../store/planStore'
import { evictPlanLayoutCache, restorePlanLayoutCache } from '../utils/mapLayoutCache'
import { analytics, EVENTS } from '../services/analytics'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'
import { useEntitlement } from './useEntitlement'
import { PLAN_LIMITS } from '../constants/plans'

// ─── モジュール共有のメモリキャッシュ ─────────────────────────────────────
// 全 usePlans() インスタンスが同じデータを共有する。
// ・マウント時はメモリから即座に表示（AsyncStorage の読み込みを待たない）
// ・更新は先にメモリへ反映して全画面へ通知（楽観的更新）、永続化はバックグラウンド
// ・永続化に失敗したときだけディスクの実状態へロールバックする

let cache: DeskPlan[] | null = null
// ディスクから読めていないのに空のメモリを書き戻すと、端末内のデスクを全部消してしまう。
// 読み込みが一度でも成功するまでは永続化しない
let loadFailed = false
let loadPromise: Promise<void> | null = null
let persistQueue: Promise<void> = Promise.resolve()
let persistenceGeneration = 0
let commitVersion = 0
// add/update/remove/togglePinned の「読み取り→計算→commit」をこのキューで直列化する。
// これが無いと、ほぼ同時に呼ばれた2つの変更が互いのcommitを待たずに古いcacheを元に
// 計算してしまい、片方の変更が黙って失われる（lost update）。
let mutationQueue: Promise<void> = Promise.resolve()
const listeners = new Set<(plans: DeskPlan[]) => void>()

function notify() {
  const snapshot = cache ?? []
  for (const l of listeners) l(snapshot)
}

// デスクの編集は配線図のドラッグ1回ごとに保存が走るため、保存のたびに送ると
// イベント数が跳ね上がるうえ「何回いじったか」しか分からなくなる。
// デスクごとに間隔を空けて、保存回数ではなく編集セッション数として記録する。
const DESK_EDIT_TRACK_INTERVAL_MS = 5 * 60 * 1000
const lastDeskEditTrackedAt = new Map<string, number>()

function trackDeskEdit(plan: DeskPlan): void {
  const now = Date.now()
  const last = lastDeskEditTrackedAt.get(plan.id) ?? 0
  if (now - last < DESK_EDIT_TRACK_INTERVAL_MS) return
  lastDeskEditTrackedAt.set(plan.id, now)
  analytics.track(EVENTS.DESK_UPDATED, {
    gadget_count: plan.selectedGadgetIds.length,
    photo_count:  plan.images?.length ?? 0,
    has_wiring:   !!plan.wiringResult,
    has_map:      !!plan.connectionMap,
    age_days:     Math.floor((now - new Date(plan.createdAt).getTime()) / 86_400_000),
  })
}

function ensureLoaded(): Promise<void> {
  // 失敗したままなら毎回やり直す。画面のフォーカスや再試行ボタンがそのまま復帰の機会になる
  if (cache !== null && !loadFailed) return Promise.resolve()
  if (loadPromise) return loadPromise
  const recovering = loadFailed
  loadPromise = (async () => {
    try {
      const ps = await withTimeout(loadPlans(), STORAGE_TIMEOUT_MS)
      loadFailed = false
      // 読み込み完了前に楽観的更新が入った場合はそちらを優先する。
      // 失敗からの復帰では、読めない間の空のメモリ（保存されていない）ではなく読めた中身を採る。
      // 採らないと再試行が成功しても0件のまま保存が解禁され、次の変更でデスクが全部消える
      if (cache === null || recovering) { cache = ps }
      notify()
    } catch (e) {
      // 空表示にはするが「0件」とは扱わない。commit() がこのフラグを見て保存を止めるので、
      // 読めていないデスクを空で上書きすることはない
      loadFailed = true
      if (cache === null) { cache = [] }
      notify()
      throw e
    }
  })()
    .catch(() => {})
    .finally(() => { loadPromise = null })
  return loadPromise
}

export function preloadPlans(): Promise<void> {
  return ensureLoaded()
}

async function current(): Promise<DeskPlan[]> {
  if (cache !== null) return cache
  await ensureLoaded()
  return cache ?? []
}

function commit(next: DeskPlan[], reportFailure = false): Promise<void> {
  const previous = cache ?? []
  cache = next
  notify()
  // ディスクを読めていない間は書かない。空のメモリを保存すると、読めなかっただけの
  // デスクが本当に消える。画面側は loadError を見て再試行を促す
  if (loadFailed) {
    const error = new Error('PLANS_NOT_LOADED')
    return reportFailure ? Promise.reject(error) : Promise.resolve()
  }
  const generation = persistenceGeneration
  const version = ++commitVersion
  const persistence = persistQueue
    .catch(() => {})
    .then(() => {
      if (generation !== persistenceGeneration) return
      return savePlans(next)
    })
    .catch(async (error) => {
      if (generation === persistenceGeneration && version === commitVersion) {
        analytics.error('save_plans', error)
        let restored: DeskPlan[]
        try {
          restored = await withTimeout(loadPlans(), STORAGE_TIMEOUT_MS)
        } catch {
          restored = previous
        }
        if (generation === persistenceGeneration && version === commitVersion) {
          cache = restored
          notify()
        }
      }
      if (reportFailure) throw error
    })
  persistQueue = persistence.catch(() => {})
  return persistence
}

function mutate(fn: (current: DeskPlan[]) => DeskPlan[] | Promise<DeskPlan[]>, awaitPersistence = false): Promise<DeskPlan[]> {
  // clearPlansCache() が「呼び出し後」に発火したら、このミューテーションは古い世代の
  // ものとして破棄する（そうしないと、削除直前にキューへ入った add/update が
  // 空になったキャッシュへ後から反映され、消したはずのデータが1件だけ復活する）。
  const generationAtStart = persistenceGeneration
  let cancelled = false
  const run = mutationQueue.catch(() => {}).then(async () => {
    if (persistenceGeneration !== generationAtStart) return cache ?? []
    const plans = await current()
    if (cancelled || persistenceGeneration !== generationAtStart) return cache ?? []
    const next = await fn(plans)
    if (cancelled || persistenceGeneration !== generationAtStart) return cache ?? []
    const persistence = commit(next, awaitPersistence)
    if (awaitPersistence) await persistence
    return next
  })
  mutationQueue = run.then(() => undefined, () => undefined)
  // 待機の期限が切れても、進行中の実際の書き込みを後続が追い越してはいけない。
  return withTimeout(run, STORAGE_TIMEOUT_MS).catch(error => {
    cancelled = true
    if (error instanceof Error && error.message.includes('operation timed out')) throw new Error('STORAGE_OPERATION_PENDING')
    throw error
  })
}

// 写真の失効前に参照も保存し、再起動後に旧URLへ戻らないようにする。
export async function replacePlanPhotoUrl(planId: string, oldUrl: string, newUrl: string): Promise<void> {
  if (!(await current()).some((plan) => plan.id === planId && plan.images?.includes(oldUrl))) return
  await mutate((plans) => plans.map((plan) => plan.id === planId && plan.images?.includes(oldUrl)
    ? { ...plan, images: plan.images.map((uri) => uri === oldUrl ? newUrl : uri) }
    : plan), true)
}

/** 設定画面の全データ削除時などに、メモリ上のキャッシュも破棄する */
export async function clearPlansCache() {
  persistenceGeneration += 1
  commitVersion += 1
  cache = []
  // 明示的な全消去は「空が正しい」と本人が決めた状態なので、保存の停止も解除する
  loadFailed = false
  notify()
  await withTimeout(Promise.all([persistQueue.catch(() => {}), mutationQueue.catch(() => {})]), STORAGE_TIMEOUT_MS)
}

/**
 * 受け付け済みの変更がディスクへ書き終わるまで待つ。ディスクを直接読む処理（バックアップ）の前に呼ぶ。
 * 保存はメモリが先でディスクは後なので、待たずに読むと直前の変更を取りこぼす
 * （ログアウト時の控えは、このあと端末のデータを消すので取りこぼしが戻らない）
 */
export async function flushPlanPersistence(): Promise<void> {
  await withTimeout((async () => {
    await mutationQueue.catch(() => {})
    await persistQueue.catch(() => {})
  })(), STORAGE_TIMEOUT_MS)
}

/**
 * AsyncStorage を画面の外から直接書き換えたあと（バックアップ復元）に呼ぶ。
 * clearPlansCache() で進行中の保存を打ち切ってから使うこと。
 */
export async function reloadPlansFromDisk(): Promise<void> {
  try {
    cache = await withTimeout(loadPlans(), STORAGE_TIMEOUT_MS)
    loadFailed = false
  } catch {
    cache = []
    loadFailed = true
  }
  notify()
}

export function usePlans() {
  const { getLimit, isLoading } = useEntitlement()
  const maxWiringPlansRef = useRef(getLimit('maxWiringPlans'))
  maxWiringPlansRef.current = getLimit('maxWiringPlans')
  const entitlementLoadingRef = useRef(isLoading)
  entitlementLoadingRef.current = isLoading
  const [plans, setPlans] = useState<DeskPlan[]>(cache ?? [])
  const [loading, setLoading] = useState(cache === null)
  // 「読めなかった」を「0件」と混同して見せないための印。画面は空表示ではなく再試行を出す
  const [loadError, setLoadError] = useState(loadFailed)

  useEffect(() => {
    const listener = (ps: DeskPlan[]) => { setPlans(ps); setLoading(false); setLoadError(loadFailed) }
    listeners.add(listener)
    if (cache !== null) listener(cache)
    else void ensureLoaded()
    return () => { listeners.delete(listener) }
  }, [])

  const add = useCallback(async (plan: DeskPlan, beforeAdd?: () => Promise<unknown>) => {
    let added = false
    let saved = plan
    await mutate(async (cur) => {
      if (loadFailed) throw new Error('PLANS_NOT_LOADED')
      const existing = cur.find((item) => item.id === plan.id)
      if (existing) {
        saved = existing
        return cur
      }
      // 入口の確認だけでは、別画面の作成・複製が同時に走ると未完成デスクが増える。
      if (!plan.isShared && !plan.wiringResult && cur.some((item) => !item.isShared && !item.wiringResult)) {
        throw new Error('DESK_SETUP_IN_PROGRESS')
      }
      const count = cur.filter((item) => !item.isShared).length
      if (!plan.isShared && entitlementLoadingRef.current && count >= PLAN_LIMITS.free.maxWiringPlans) {
        throw new Error('DESK_ENTITLEMENT_PENDING')
      }
      const max = maxWiringPlansRef.current
      if (!plan.isShared && max !== -1 && count >= max) throw new Error('DESK_LIMIT_REACHED')
      await beforeAdd?.()
      added = true
      return [...cur, plan]
    }, true)
    if (!added) return saved
    analytics.track(EVENTS.DESK_CREATED, {
      goal: plan.goal,
      purpose_count: plan.purposes?.length ?? 0,
      has_template: !!plan.templateId,
      creation_source: plan.templateId ? 'template' : 'manual',
      gadget_count: plan.selectedGadgetIds.length,
    })
    return plan
  }, [])

  const update = useCallback(async (plan: DeskPlan) => {
    await mutate((cur) => cur.map((p) => (p.id === plan.id ? plan : p)))
    trackDeskEdit(plan)
  }, [])

  // update() は呼び出し側が組み立てた完成形の plan で丸ごと上書きする。
  // ほぼ同時に発火する複数の保存（配線図のドラッグ・配線追加削除・自動再計算など）が
  // それぞれ古い plan スナップショットから次の値を組み立てて update() を呼ぶと、
  // 後から解決した方が前の変更ごと上書きしてしまい、片方の編集が消える（lost update）。
  // updateWith は mutate() のキュー内で「今まさにコミットされている最新の plan」を
  // 引数に fn を呼ぶため、直前の保存を踏まえた差分更新になり、この種の上書きが起きない。
  const updateWith = useCallback(async (id: string, fn: (prev: DeskPlan) => DeskPlan, options: { awaitPersistence?: boolean } = {}) => {
    let edited: DeskPlan | null = null
    await mutate((cur) => cur.map((p) => {
      if (p.id !== id) return p
      edited = fn(p)
      return edited
    }), options.awaitPersistence === true)
    if (edited) trackDeskEdit(edited)
  }, [])

  const updateManyWith = useCallback(async (
    ids: readonly string[],
    fn: (prev: DeskPlan) => DeskPlan,
    options: { awaitPersistence?: boolean; track?: boolean } = {},
  ) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const edited: DeskPlan[] = []
    await mutate((cur) => cur.map((plan) => {
      if (!idSet.has(plan.id)) return plan
      const next = fn(plan)
      edited.push(next)
      return next
    }), options.awaitPersistence === true)
    if (options.track !== false) edited.forEach(trackDeskEdit)
  }, [])

  /**
   * 削除の取り消し・失敗時の巻き戻し用。add() と違って作成イベントを送らない。
   * ここを add() で代用すると、削除を1回取り消すたびに desk_created が積まれ、
   * 作成数の集計が水増しされる。
   */
  const restore = useCallback(async (plan: DeskPlan) => {
    // mutate の前に外す。commit の notify で画面が配線図を計算し直すので、
    // 印が残っているとその結果がキャッシュへ載らないまま捨てられる
    restorePlanLayoutCache(plan.id)
    await mutate((cur) => (cur.some((p) => p.id === plan.id) ? cur : [...cur, plan]), true)
  }, [])

  // 削除イベントは送らない。5秒間は取り消せるので、ここではまだ「消えた」と言えない。
  // 確定した時点（呼び出し側の onExpire）で送る
  const remove = useCallback(async (id: string, options: { awaitPersistence?: boolean } = {}) => {
    await mutate(
      (cur) => cur.filter((p) => p.id !== id),
      options.awaitPersistence === true,
    )
    evictPlanLayoutCache(id)
  }, [])

  const getById = useCallback(
    (id: string) => plans.find((p) => p.id === id) ?? null,
    [plans]
  )

  // キャッシュ済みなら何もしない（画面フォーカスごとのディスク再読込は不要になった）
  const reload = useCallback(async () => { void ensureLoaded() }, [])

  const togglePinned = useCallback(async (id: string) => {
    await mutate((cur) => cur.map((p) => (p.id === id ? { ...p, favorite: !p.favorite } : p)), true)
  }, [])

  return { plans, loading, loadError, add, update, updateWith, updateManyWith, restore, remove, getById, reload, togglePinned }
}
