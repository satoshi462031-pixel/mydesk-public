import { Gadget, GadgetPlacement, MapConnection } from '../types'
import { computeMapLayout, MapLayout, MapLayoutCancelled } from './connectionMapLayout'
import { historyLayoutCache } from './historyLayoutCache'

// ─── 配線図レイアウトの共有キャッシュ ─────────────────────────────
// ConnectionMap（表示）から使う。計算結果はメモリとAsyncStorageの両方へ保存し、
// 再起動後も同じ入力なら重いルーティング計算を行わない。
// planId ごとに複数エントリ（既定表示・電源ON・全削除・再構成など）を保持し、
// トグルやボタン操作で入力が切り替わっても直前の結果が生き続けるようにする。
const MAX_PER_PLAN = 6
const MAX_PERSISTED_ENTRIES = 8
// JS文字数。日本語がUTF-8で最大3byteになる前提でも、保存値を約6MB以内に抑える。
const MAX_PERSISTED_CHARS = 2 * 1024 * 1024
const MAX_PERSISTED_NODES = 100
const MAX_PERSISTED_EDGES = 500
const MAX_EDGE_POINTS = 1000
// オンボーディングに焼いた配線図（onboardingWiring.generated.ts）が
// どの版で作られたかを照合するため公開している
export const LAYOUT_VERSION = 73
const PERSISTENCE_VERSION = 1
const PERSISTENCE_KEY = `@map_layout_cache:v${LAYOUT_VERSION}`
const cache = new Map<string, Map<string, MapLayout>>()
const persisted = new Map<string, PersistedLayoutEntry>()
type PendingLayout = { promise: Promise<MapLayout>; consumers: Set<symbol> }
const inFlight = new Map<string, PendingLayout>()
const evictedPlanIds = new Set<string>()
let hydration: Promise<void> | null = null
let persistQueue: Promise<void> = Promise.resolve()
let persistenceGeneration = 0

export interface PersistedLayoutEntry {
  planId: string
  key: string
  layout: MapLayout
  usedAt: number
}

interface PersistedLayoutPayload {
  version: number
  entries: PersistedLayoutEntry[]
}

const entryId = (planId: string, key: string) => `${planId}\u0000${key}`
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const record = (value: unknown): value is Record<string, unknown> => value != null && typeof value === 'object' && !Array.isArray(value)

function validNode(value: unknown): boolean {
  if (!record(value) || !record(value.gadget)) return false
  return typeof value.id === 'string'
    && typeof value.gadget.id === 'string'
    && typeof value.gadget.name === 'string'
    && typeof value.gadget.category === 'string'
    && finite(value.tier) && finite(value.x) && finite(value.y)
    && finite(value.w) && finite(value.h) && finite(value.cx) && finite(value.cy)
    && typeof value.isWall === 'boolean'
}

function validLayout(value: unknown): value is MapLayout {
  if (!record(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !record(value.bounds)) return false
  if (value.nodes.length > MAX_PERSISTED_NODES || value.edges.length > MAX_PERSISTED_EDGES) return false
  if (!finite(value.width) || !finite(value.height) || value.width < 0 || value.height < 0) return false
  if (!finite(value.bounds.minX) || !finite(value.bounds.minY) || !finite(value.bounds.maxX) || !finite(value.bounds.maxY)) return false
  if (!value.nodes.every(validNode)) return false
  const nodeIds = new Set(value.nodes.map((node) => (node as { id: string }).id))
  return value.edges.every((edge) => {
    if (!record(edge) || !record(edge.conn) || !record(edge.from) || !record(edge.to) || !Array.isArray(edge.points)) return false
    return typeof edge.conn.id === 'string'
      && typeof edge.conn.cableType === 'string'
      && typeof edge.from.id === 'string' && nodeIds.has(edge.from.id)
      && typeof edge.to.id === 'string' && nodeIds.has(edge.to.id)
      && edge.points.length <= MAX_EDGE_POINTS
      && edge.points.every((point) => record(point) && finite(point.x) && finite(point.y))
  })
}

/** 壊れた値や旧アルゴリズムの値を一件単位で捨て、安全なレイアウトだけを返す。 */
export function parsePersistedLayoutCache(raw: string | null): PersistedLayoutEntry[] {
  if (!raw || raw.length > MAX_PERSISTED_CHARS) return []
  try {
    const payload = JSON.parse(raw) as PersistedLayoutPayload
    if (payload?.version !== PERSISTENCE_VERSION || !Array.isArray(payload.entries)) return []
    const unique = new Map<string, PersistedLayoutEntry>()
    for (const entry of payload.entries.slice(-MAX_PERSISTED_ENTRIES)) {
      if (!record(entry)
        || typeof entry.planId !== 'string' || entry.planId.length === 0 || entry.planId.length > 200
        || typeof entry.key !== 'string' || !entry.key.startsWith(`${LAYOUT_VERSION}||`)
        || !finite(entry.usedAt) || !validLayout(entry.layout)) continue
      unique.set(entryId(entry.planId, entry.key), entry as unknown as PersistedLayoutEntry)
    }
    return [...unique.values()]
  } catch {
    return []
  }
}

function putInMemory(planId: string, key: string, layout: MapLayout): void {
  let perPlan = cache.get(planId)
  if (!perPlan) {
    perPlan = new Map()
    cache.set(planId, perPlan)
  }
  perPlan.delete(key)
  perPlan.set(key, layout)
  while (perPlan.size > MAX_PER_PLAN) {
    const oldest = perPlan.keys().next().value
    if (oldest === undefined) break
    perPlan.delete(oldest)
  }
}

function touchPersisted(entry: PersistedLayoutEntry): void {
  const id = entryId(entry.planId, entry.key)
  persisted.delete(id)
  persisted.set(id, entry)
  while (persisted.size > MAX_PERSISTED_ENTRIES) {
    const oldest = persisted.keys().next().value
    if (oldest === undefined) break
    persisted.delete(oldest)
  }
}

async function storage() {
  return (await import('@react-native-async-storage/async-storage')).default
}

async function hydratePersistentCache(): Promise<void> {
  if (hydration) return hydration
  const generation = persistenceGeneration
  hydration = (async () => {
    try {
      const asyncStorage = await storage()
      const entries = parsePersistedLayoutCache(await asyncStorage.getItem(PERSISTENCE_KEY))
      if (generation !== persistenceGeneration) return
      for (const entry of entries) {
        putInMemory(entry.planId, entry.key, entry.layout)
        touchPersisted(entry)
      }
    } catch {
      // 永続キャッシュが読めなくても、画面側で通常計算へフォールバックする。
    }
  })()
  return hydration
}

function queuePersistence(): void {
  const generation = persistenceGeneration
  persistQueue = persistQueue.then(async () => {
    if (generation !== persistenceGeneration) return
    const asyncStorage = await storage()
    const entries = [...persisted.values()]
    let raw = JSON.stringify({ version: PERSISTENCE_VERSION, entries } satisfies PersistedLayoutPayload)
    while (raw.length > MAX_PERSISTED_CHARS && entries.length > 0) {
      const removed = entries.shift()
      if (removed) persisted.delete(entryId(removed.planId, removed.key))
      raw = JSON.stringify({ version: PERSISTENCE_VERSION, entries } satisfies PersistedLayoutPayload)
    }
    if (entries.length === 0) await asyncStorage.removeItem(PERSISTENCE_KEY)
    else await asyncStorage.setItem(PERSISTENCE_KEY, raw)
  }).catch(() => {})
}

export function makeLayoutInputKey(
  gadgets: Gadget[],
  connections: MapConnection[],
  placements: GadgetPlacement[],
  nodeOffsets: Record<string, { dx: number; dy: number }>,
  nodeSizes: Record<string, { w: number; h: number }>,
  centerPrimaryDevices = false,
): string {
  // 呼び名は配置に効かないが、キャッシュした結果のノードがガジェットを抱えて描かれるので、
  // 入れないと呼び名を変えても図だけ古い名前のまま残る。付けたときだけ足し、既存のキーを崩さない
  const g = gadgets.map((x) => JSON.stringify([x.id, x.name, x.category, x.ports, x.stereoPair, x.speakerInputSide, x.hasSubwoofer, x.splitKeyboard, x.pcThunderbolt, x.pcFormFactor, x.displayOnly, x.quantity, x.mounting, ...(x.nickname ? [x.nickname] : [])])).join()
  const c = connections.map((x) => JSON.stringify([
    x.id,
    x.fromGadgetId,
    x.toGadgetId,
    x.cableType,
    x.confirmed,
    x.wireless,
    x.chargingOnly,
    x.origin,
    x.sourcePortId,
    x.branchGroupId,
  ])).join()
  const p = placements.map((x) => `${x.gadgetId}:${x.zone}:${x.label ?? ''}`).join()
  return `${LAYOUT_VERSION}||${centerPrimaryDevices ? 1 : 0}||${g}||${c}||${p}||${JSON.stringify(nodeOffsets)}||${JSON.stringify(nodeSizes)}`
}

/** キャッシュヒット時のみ返す（計算しない）。ミスは null */
export function tryGetCachedLayout(
  planId: string,
  gadgets: Gadget[],
  connections: MapConnection[],
  placements: GadgetPlacement[],
  nodeOffsets: Record<string, { dx: number; dy: number }> = {},
  nodeSizes: Record<string, { w: number; h: number }> = {},
  centerPrimaryDevices = false,
): MapLayout | null {
  const key = makeLayoutInputKey(gadgets, connections, placements, nodeOffsets, nodeSizes, centerPrimaryDevices)
  return cache.get(planId)?.get(key) ?? null
}

/** プラン削除時に呼ぶ。呼ばないとセッション中ずっとエントリが残り続ける */
export function evictPlanLayoutCache(planId: string): void {
  void historyLayoutCache.evict(planId, LAYOUT_VERSION)
  evictedPlanIds.add(planId)
  cache.delete(planId)
  void hydratePersistentCache().then(() => {
    for (const [id, entry] of persisted) {
      if (entry.planId === planId) persisted.delete(id)
    }
    queuePersistence()
  })
}

/**
 * 削除を取り消したときに呼ぶ。evict の印を外さないと、そのプランの計算結果は
 * セッション中ずっとキャッシュへ載らず（下の getOrComputeMapLayout が捨てる）、
 * 復元したデスクを開くたびにレイアウトを丸ごと計算し直すことになる。
 */
export function restorePlanLayoutCache(planId: string): void {
  historyLayoutCache.restore(planId)
  evictedPlanIds.delete(planId)
}

/** ログアウト時に、前アカウントのガジェット名を含むメモリ・永続キャッシュを消す。 */
export async function clearMapLayoutCache(): Promise<void> {
  const historyCleared = historyLayoutCache.clear()
  persistenceGeneration += 1
  cache.clear()
  persisted.clear()
  inFlight.clear()
  evictedPlanIds.clear()
  hydration = Promise.resolve()
  await Promise.all([persistQueue, historyCleared])
  try {
    const asyncStorage = await storage()
    await asyncStorage.removeItem(PERSISTENCE_KEY)
  } catch {
    // ログアウト自体はキャッシュ削除失敗で止めない。
  }
}

export async function loadCachedMapLayout(
  planId: string,
  gadgets: Gadget[],
  connections: MapConnection[],
  placements: GadgetPlacement[],
  nodeOffsets: Record<string, { dx: number; dy: number }> = {},
  nodeSizes: Record<string, { w: number; h: number }> = {},
  centerPrimaryDevices = false,
): Promise<MapLayout | null> {
  const key = makeLayoutInputKey(gadgets, connections, placements, nodeOffsets, nodeSizes, centerPrimaryDevices)
  const memoryHit = cache.get(planId)?.get(key)
  if (memoryHit) return memoryHit
  await hydratePersistentCache()
  return cache.get(planId)?.get(key) ?? null
}

export async function getOrComputeMapLayout(
  planId: string,
  gadgets: Gadget[],
  connections: MapConnection[],
  placements: GadgetPlacement[],
  nodeOffsets: Record<string, { dx: number; dy: number }> = {},
  nodeSizes: Record<string, { w: number; h: number }> = {},
  centerPrimaryDevices = false,
  signal?: AbortSignal,
): Promise<MapLayout> {
  if (signal?.aborted) throw new MapLayoutCancelled()
  const key = makeLayoutInputKey(gadgets, connections, placements, nodeOffsets, nodeSizes, centerPrimaryDevices)
  const hit = await loadCachedMapLayout(planId, gadgets, connections, placements, nodeOffsets, nodeSizes, centerPrimaryDevices)
  if (signal?.aborted) throw new MapLayoutCancelled()
  if (hit) return hit
  const id = entryId(planId, key)
  const consumer = Symbol()
  let pending = inFlight.get(id)
  if (pending) {
    pending.consumers.add(consumer)
  } else {
    const generation = persistenceGeneration
    const consumers = new Set([consumer])
    const computation = computeMapLayout(
      gadgets, connections, placements, nodeOffsets, nodeSizes, centerPrimaryDevices,
      () => consumers.size === 0 || generation !== persistenceGeneration || evictedPlanIds.has(planId),
    ).then((result) => {
      if (generation !== persistenceGeneration || evictedPlanIds.has(planId) || consumers.size === 0) return result
      putInMemory(planId, key, result)
      touchPersisted({ planId, key, layout: result, usedAt: Date.now() })
      queuePersistence()
      return result
    })
    pending = { promise: computation, consumers }
    inFlight.set(id, pending)
  }
  const shared = pending
  const release = () => {
    shared.consumers.delete(consumer)
    // 中断した計算の終了待ち中でも、同じ入力の再表示は新しい計算を開始できる。
    if (shared.consumers.size === 0 && inFlight.get(id) === shared) inFlight.delete(id)
  }
  return new Promise<MapLayout>((resolve, reject) => {
    const abort = () => { release(); reject(new MapLayoutCancelled()) }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    shared.promise.then(resolve, reject).finally(() => {
      signal?.removeEventListener('abort', abort)
      release()
    })
  })
}
