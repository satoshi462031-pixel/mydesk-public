import type { Gadget, MapConnection } from '../types'
import type { MapLayout, MapNode } from './connectionMapLayout'
import type { TimelineGrain } from './deskTimeline'

export const HISTORY_LAYOUT_CACHE_KEY = '@history_layout_cache:v1'
const MAX_BUCKETS = 6
const MAX_LAYOUTS = 128
const MAX_CHARS = 2 * 1024 * 1024
const MAX_NODES = 100
const MAX_EDGES = 500
const MAX_POINTS = 1000

type Storage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}
type CompactLayout = Omit<MapLayout, 'nodes' | 'edges'> & {
  gadgets: Gadget[]
  nodes: Array<Omit<MapNode, 'gadget' | 'attached'> & { gadget: string; attached?: string[] }>
  edges: Array<Omit<MapLayout['edges'][number], 'from' | 'to'> & { from: string; to: string }>
}
type Bucket = { planId: string; grain: TimelineGrain; layouts: Map<string, MapLayout> }
export type HistoryLayoutSession = {
  get(key: string, gadgets: Gadget[], connections: MapConnection[]): MapLayout | null
  set(key: string, layout: MapLayout): void
  save(): Promise<void>
}

const bucketKey = (planId: string, grain: TimelineGrain) => JSON.stringify([planId, grain])
const record = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// 線ごとに両端のノードと商品情報を繰り返し保存すると、長い履歴が容量枠を使い切る。
export function compactHistoryLayout(layout: MapLayout): CompactLayout {
  const gadgets = new Map<string, Gadget>()
  return {
    width: layout.width, height: layout.height, bounds: layout.bounds,
    nodes: layout.nodes.map(({ gadget, attached, ...node }) => {
      gadgets.set(gadget.id, gadget)
      attached?.forEach((g) => gadgets.set(g.id, g))
      return { ...node, gadget: gadget.id, ...(attached ? { attached: attached.map((g) => g.id) } : {}) }
    }),
    edges: layout.edges.map(({ from, to, ...edge }) => ({ ...edge, from: from.id, to: to.id })),
    gadgets: [...gadgets.values()],
  }
}

export function restoreCompactHistoryLayout(value: unknown): MapLayout | null {
  if (!record(value) || !Array.isArray(value.gadgets) || !Array.isArray(value.nodes) || !Array.isArray(value.edges)
    || value.gadgets.length > MAX_NODES * 10 || value.nodes.length > MAX_NODES || value.edges.length > MAX_EDGES
    || !finite(value.width) || value.width < 0 || !finite(value.height) || value.height < 0
    || !record(value.bounds) || !['minX', 'minY', 'maxX', 'maxY'].every((k) => finite((value.bounds as Record<string, unknown>)[k]))) return null
  if (!value.gadgets.every((g) => record(g) && typeof g.id === 'string' && typeof g.name === 'string'
    && typeof g.category === 'string' && Array.isArray(g.ports))) return null
  const gadgets = new Map((value.gadgets as Gadget[]).map((g) => [g.id, g]))
  const nodes: MapNode[] = []
  for (const n of value.nodes) {
    if (!record(n) || typeof n.id !== 'string' || typeof n.gadget !== 'string' || !gadgets.has(n.gadget)
      || !['tier', 'x', 'y', 'w', 'h', 'cx', 'cy'].every((k) => finite(n[k]))
      || typeof n.isWall !== 'boolean' || !['baseX', 'baseY'].every((k) => n[k] === undefined || finite(n[k]))
      || !['isDecor', 'isSubwoofer'].every((k) => n[k] === undefined || typeof n[k] === 'boolean')
      || (n.sideLabel !== undefined && n.sideLabel !== 'L' && n.sideLabel !== 'R')
      || (n.powerSource !== undefined && n.powerSource !== 'solar' && n.powerSource !== 'battery')
      || (n.attached !== undefined && (!Array.isArray(n.attached) || !n.attached.every((id) => typeof id === 'string' && gadgets.has(id))))) return null
    const { gadget, attached, ...node } = n as CompactLayout['nodes'][number]
    nodes.push({ ...node, gadget: gadgets.get(gadget)!, ...(attached ? { attached: attached.map((id) => gadgets.get(id)!) } : {}) })
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  if (byId.size !== nodes.length) return null
  const edges: MapLayout['edges'] = []
  for (const e of value.edges) {
    if (!record(e) || !record(e.conn) || typeof e.conn.id !== 'string' || typeof e.conn.cableType !== 'string'
      || typeof e.conn.fromGadgetId !== 'string' || typeof e.conn.toGadgetId !== 'string'
      || typeof e.from !== 'string' || !byId.has(e.from) || typeof e.to !== 'string' || !byId.has(e.to)
      || (e.isPairLink !== undefined && typeof e.isPairLink !== 'boolean')
      || !Array.isArray(e.points) || e.points.length > MAX_POINTS
      || !e.points.every((p) => record(p) && finite(p.x) && finite(p.y))) return null
    const edge = e as CompactLayout['edges'][number]
    edges.push({ ...edge, from: byId.get(edge.from)!, to: byId.get(edge.to)! })
  }
  return { nodes, edges, width: value.width, height: value.height, bounds: value.bounds as MapLayout['bounds'] }
}

function refreshReferences(layout: MapLayout, gadgets: Gadget[], connections: MapConnection[]): MapLayout {
  const currentGadgets = new Map(gadgets.map((g) => [g.id, g]))
  const currentConnections = new Map(connections.map((c) => [c.id, c]))
  const nodes = layout.nodes.map((n) => ({
    ...n, gadget: currentGadgets.get(n.gadget.id) ?? n.gadget,
    ...(n.attached ? { attached: n.attached.map((g) => currentGadgets.get(g.id) ?? g) } : {}),
  }))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return { ...layout, nodes, edges: layout.edges.map((e) => ({
    ...e, conn: currentConnections.get(e.conn.id) ?? e.conn, from: byId.get(e.from.id)!, to: byId.get(e.to.id)!,
  })) }
}

export class HistoryLayoutCache {
  private buckets = new Map<string, Bucket>()
  private hydration: Promise<void> | null = null
  private queue: Promise<void> = Promise.resolve()
  private deleted = new Set<string>()
  private bookmarked = new Set<string>()
  // 自分のデスク。保存したデスクと同じ優先で残す。保存だけを優先していた頃は、保存したデスクの
  // 履歴で枠が埋まると自分のデスクの図が保存した直後に自分で押し出され、開くたびに計算し直していた
  private own = new Set<string>()
  private bookmarkOverrides = new Map<string, boolean>()
  private bookmarkSnapshotKnown = false
  revision = 0
  bookmarkRevision = 0

  constructor(private readonly storage: () => Promise<Storage>) {}

  async setBookmarked(planId: string, value: boolean, layoutVersion: number): Promise<void> {
    if (this.bookmarkOverrides.get(planId) === value) return this.queue
    const revision = this.revision
    this.bookmarkRevision += 1
    this.bookmarkOverrides.set(planId, value)
    if (value) this.bookmarked.add(planId)
    else this.bookmarked.delete(planId)
    await this.hydrate(layoutVersion)
    if (revision === this.revision) await this.persist(layoutVersion)
  }

  async syncBookmarkedPlans(planIds: string[], layoutVersion: number): Promise<void> {
    const next = new Set(planIds)
    if (this.bookmarkSnapshotKnown && next.size === this.bookmarked.size && [...next].every((id) => this.bookmarked.has(id))) return this.queue
    const revision = this.revision
    this.bookmarkRevision += 1
    this.bookmarkSnapshotKnown = true
    this.bookmarkOverrides.clear()
    this.bookmarked = next
    await this.hydrate(layoutVersion)
    if (revision === this.revision) await this.persist(layoutVersion)
  }

  private pinned(planId: string): boolean {
    return this.bookmarked.has(planId) || this.own.has(planId)
  }

  private oldestBucketId(): string {
    for (const [id, bucket] of this.buckets) if (!this.pinned(bucket.planId)) return id
    return this.buckets.keys().next().value!
  }

  private hydrate(layoutVersion: number): Promise<void> {
    if (this.hydration) return this.hydration
    const revision = this.revision
    this.hydration = (async () => {
      try {
        const raw = await (await this.storage()).getItem(HISTORY_LAYOUT_CACHE_KEY)
        if (revision !== this.revision || !raw || raw.length > MAX_CHARS) return
        const payload: unknown = JSON.parse(raw)
        if (!record(payload) || payload.version !== 1 || payload.layoutVersion !== layoutVersion || !Array.isArray(payload.buckets)) return
        for (const b of payload.buckets.slice(-MAX_BUCKETS)) {
          if (!record(b) || typeof b.planId !== 'string' || b.planId.length > 200 || this.deleted.has(b.planId)
            || (b.grain !== 'day' && b.grain !== 'month' && b.grain !== 'year') || !Array.isArray(b.layouts)) continue
          const bucket: Bucket = { planId: b.planId, grain: b.grain, layouts: new Map() }
          if (b.bookmarked === true && !this.bookmarkSnapshotKnown && !this.bookmarkOverrides.has(b.planId)) this.bookmarked.add(b.planId)
          if (b.own === true) this.own.add(b.planId)
          for (const entry of b.layouts.slice(-MAX_LAYOUTS)) {
            if (!record(entry) || typeof entry.key !== 'string' || !entry.key.startsWith(`${layoutVersion}||`)) continue
            const layout = restoreCompactHistoryLayout(entry.layout)
            if (layout) bucket.layouts.set(entry.key, layout)
          }
          if (bucket.layouts.size > 0) this.buckets.set(bucketKey(bucket.planId, bucket.grain), bucket)
        }
      } catch { /* 保存値が壊れている・ストレージが使えないときは通常計算する。 */ }
    })()
    return this.hydration
  }

  async open(planId: string, grain: TimelineGrain, layoutVersion: number, options: { own?: boolean } = {}): Promise<HistoryLayoutSession> {
    const revision = this.revision
    await this.hydrate(layoutVersion)
    if (options.own && revision === this.revision && !this.deleted.has(planId)) this.own.add(planId)
    const id = bucketKey(planId, grain)
    const bucket = this.buckets.get(id) ?? { planId, grain, layouts: new Map<string, MapLayout>() }
    const current = () => revision === this.revision && !this.deleted.has(planId)
    return {
      get: (key, gadgets, connections) => {
        const layout = current() ? bucket.layouts.get(key) : undefined
        return layout ? refreshReferences(layout, gadgets, connections) : null
      },
      set: (key, layout) => {
        if (!current() || !key.startsWith(`${layoutVersion}||`) || layout.nodes.length > MAX_NODES
          || layout.edges.length > MAX_EDGES || layout.edges.some((e) => e.points.length > MAX_POINTS)) return
        bucket.layouts.delete(key)
        bucket.layouts.set(key, layout)
        while (bucket.layouts.size > MAX_LAYOUTS) bucket.layouts.delete(bucket.layouts.keys().next().value!)
      },
      save: () => {
        if (!current() || bucket.layouts.size === 0) return Promise.resolve()
        this.buckets.delete(id)
        this.buckets.set(id, bucket)
        while (this.buckets.size > MAX_BUCKETS) this.buckets.delete(this.oldestBucketId())
        // ヒットだけの再表示でも利用順を保存し、よく見るデスクを残す。
        return this.persist(layoutVersion)
      },
    }
  }

  private persist(layoutVersion: number): Promise<void> {
    const revision = this.revision
    this.queue = this.queue.then(async () => {
      const storage = await this.storage()
      if (revision !== this.revision) return
      // 同じ優先度では利用順を保ち、件数・容量のどちらでも保存したデスク・自分のデスク以外から落とす。
      const buckets = [...this.buckets.values()].map((b, recency) => ({
        planId: b.planId, grain: b.grain, bookmarked: this.bookmarked.has(b.planId), own: this.own.has(b.planId), recency,
        layouts: [...b.layouts].map(([key, layout]) => {
          const entry = { key, layout: compactHistoryLayout(layout) }
          return { ...entry, chars: JSON.stringify(entry).length }
        }),
      })).sort((a, b) => Number(a.bookmarked || a.own) - Number(b.bookmarked || b.own))
      const bucketChars = (b: typeof buckets[number]) => JSON.stringify({ planId: b.planId, grain: b.grain, bookmarked: b.bookmarked, own: b.own, layouts: [] }).length
        + b.layouts.reduce((sum, e) => sum + e.chars, 0) + Math.max(0, b.layouts.length - 1)
      let chars = JSON.stringify({ version: 1, layoutVersion, buckets: [] }).length
        + buckets.reduce((sum, b) => sum + bucketChars(b), 0) + Math.max(0, buckets.length - 1)
      // 上限を超えた時点を落とすたびに全履歴をJSON化すると、長い履歴ほど保存処理でJSを塞ぐ。
      while (chars > MAX_CHARS && buckets.length > 0) {
        if (buckets.length > 1 || buckets[0].layouts.length <= 1) {
          const removed = buckets.shift()!
          chars -= bucketChars(removed) + (buckets.length > 0 ? 1 : 0)
          this.buckets.delete(bucketKey(removed.planId, removed.grain))
        } else {
          const removed = buckets[0].layouts.shift()!
          chars -= removed.chars + (buckets[0].layouts.length > 0 ? 1 : 0)
          this.buckets.get(bucketKey(buckets[0].planId, buckets[0].grain))?.layouts.delete(removed.key)
        }
      }
      if (buckets.length === 0) await storage.removeItem(HISTORY_LAYOUT_CACHE_KEY)
      else await storage.setItem(HISTORY_LAYOUT_CACHE_KEY, JSON.stringify({ version: 1, layoutVersion,
        buckets: buckets.sort((a, b) => a.recency - b.recency).map((b) => ({ planId: b.planId, grain: b.grain, bookmarked: b.bookmarked, own: b.own, layouts: b.layouts.map(({ key, layout }) => ({ key, layout })) })),
      }))
    }).catch(() => {})
    return this.queue
  }

  evict(planId: string, layoutVersion: number): Promise<void> {
    this.revision += 1
    this.deleted.add(planId)
    this.own.delete(planId)
    for (const [id, bucket] of this.buckets) if (bucket.planId === planId) this.buckets.delete(id)
    this.hydration = null
    return this.hydrate(layoutVersion).then(() => this.persist(layoutVersion))
  }

  restore(planId: string): void {
    this.revision += 1
    this.deleted.delete(planId)
  }

  flush(): Promise<void> { return this.queue }

  async clear(): Promise<void> {
    this.revision += 1
    this.bookmarkRevision += 1
    this.bookmarked.clear()
    this.own.clear()
    this.bookmarkOverrides.clear()
    this.bookmarkSnapshotKnown = false
    this.buckets.clear()
    this.deleted.clear()
    this.hydration = Promise.resolve()
    await this.queue
    try { await (await this.storage()).removeItem(HISTORY_LAYOUT_CACHE_KEY) } catch { /* ログアウトは続行する。 */ }
  }
}

export const historyLayoutCache = new HistoryLayoutCache(async () =>
  (await import('@react-native-async-storage/async-storage')).default,
)
