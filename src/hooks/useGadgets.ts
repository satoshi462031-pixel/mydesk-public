import { useCallback, useEffect, useState } from 'react'
import { Gadget, GadgetFolder } from '../types'
import { analytics, EVENTS } from '../services/analytics'
import {
  FOLDER_PALETTE,
  loadFolders,
  loadGadgets,
  saveFolders,
  saveGadgets,
} from '../store/gadgetStore'
import { splitGadgetsByTrash } from '../utils/gadgetTrash'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'

const sortDesc = (gs: Gadget[]) => [...gs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

const gadgetAnalyticsProperties = (gadget: Gadget) => ({
  category: gadget.category,
  has_price: gadget.price != null,
  has_product_id: !!gadget.productId,
  has_purchase_url: !!gadget.url,
  has_image: !!gadget.imageUri,
  has_purchased_at: !!gadget.purchasedAt,
  port_count: gadget.ports.reduce((sum, port) => sum + port.count, 0),
})

// ─── モジュール共有のメモリキャッシュ ─────────────────────────────────────
// 全 useGadgets() インスタンスが同じデータを共有する。
// ・マウント時はメモリから即座に表示（AsyncStorage の読み込みを待たない）
// ・更新は先にメモリへ反映して全画面へ通知（楽観的更新）、永続化はバックグラウンド
// ・永続化に失敗したときだけディスクの実状態へロールバックする

let gadgetCache: Gadget[] | null = null
let folderCache: GadgetFolder[] | null = null
// 読めなかったのを「0件」と混同しない。読めていない間の空のメモリを保存すると、
// 登録済みのガジェットが全部消える（usePlans の loadFailed と同じ）
let loadFailed = false
let loadPromise: Promise<void> | null = null
let gadgetPersistQueue: Promise<void> = Promise.resolve()
let folderPersistQueue: Promise<void> = Promise.resolve()
let persistenceGeneration = 0
let gadgetCommitVersion = 0
let folderCommitVersion = 0
// 各種変更操作の「読み取り→計算→commit」をこのキューで直列化する。
// これが無いと、ほぼ同時に呼ばれた2つの変更が互いのcommitを待たずに古いcacheを元に
// 計算してしまい、片方の変更が黙って失われる（lost update）。
let gadgetMutationQueue: Promise<void> = Promise.resolve()
let folderMutationQueue: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

function ensureLoaded(): Promise<void> {
  // 失敗したままなら毎回やり直す。画面のフォーカスや再試行ボタンがそのまま復帰の機会になる
  if (gadgetCache !== null && folderCache !== null && !loadFailed) return Promise.resolve()
  if (loadPromise) return loadPromise
  const recovering = loadFailed
  loadPromise = withTimeout(Promise.all([loadGadgets(), loadFolders()]), STORAGE_TIMEOUT_MS)
    .then(([gs, fs]) => {
      loadFailed = false
      // 読み込み完了前に楽観的更新が入った場合はそちらを優先する。
      // 失敗からの復帰では、読めない間の空のメモリではなく読めた中身を採る
      if (gadgetCache === null || recovering) gadgetCache = sortDesc(gs)
      if (folderCache === null || recovering) folderCache = fs
      notify()
    })
    .catch(() => {
      loadFailed = true
      if (gadgetCache === null) gadgetCache = []
      if (folderCache === null) folderCache = []
      notify()
    })
    .finally(() => { loadPromise = null })
  return loadPromise
}

/** 変更の前に呼ぶ。読めていないなら一度やり直し、それでも駄目なら変更を受け付けない */
async function assertLoaded(): Promise<void> {
  if (loadFailed || gadgetCache === null || folderCache === null) await ensureLoaded()
  if (loadFailed) throw new Error('GADGETS_NOT_LOADED')
}

export function preloadGadgets(): Promise<void> {
  return ensureLoaded()
}

async function currentGadgets(): Promise<Gadget[]> {
  if (gadgetCache !== null) return gadgetCache
  const gs = await withTimeout(loadGadgets(), STORAGE_TIMEOUT_MS)
  if (gadgetCache === null) gadgetCache = sortDesc(gs)
  return gadgetCache
}

async function currentFolders(): Promise<GadgetFolder[]> {
  if (folderCache !== null) return folderCache
  const fs = await withTimeout(loadFolders(), STORAGE_TIMEOUT_MS)
  if (folderCache === null) folderCache = fs
  return folderCache
}

function commitGadgets(next: Gadget[], reportFailure = false): Promise<void> {
  const previous = gadgetCache ?? []
  gadgetCache = sortDesc(next)
  notify()
  const snapshot = gadgetCache
  const generation = persistenceGeneration
  const version = ++gadgetCommitVersion
  const persistence = gadgetPersistQueue
    .catch(() => {})
    .then(() => {
      if (generation !== persistenceGeneration) return
      return saveGadgets(snapshot)
    })
    .catch(async (error) => {
      if (generation === persistenceGeneration && version === gadgetCommitVersion) {
        analytics.error('save_gadgets', error)
        const restored = await withTimeout(loadGadgets(), STORAGE_TIMEOUT_MS).catch(() => previous)
        if (generation === persistenceGeneration && version === gadgetCommitVersion) {
          gadgetCache = sortDesc(restored)
          notify()
        }
      }
      if (reportFailure) throw error
    })
  // 通常の楽観的更新では保存をバックグラウンド継続する。一括登録だけは
  // persistence 自体を await し、失敗を入力画面へ返せるようにする。
  gadgetPersistQueue = persistence.catch(() => {})
  return persistence
}

function commitFolders(next: GadgetFolder[]) {
  folderCache = next
  notify()
  const generation = persistenceGeneration
  const version = ++folderCommitVersion
  folderPersistQueue = folderPersistQueue
    .catch(() => {})
    .then(() => {
      if (generation !== persistenceGeneration) return
      return saveFolders(next)
    })
    .catch(async (error) => {
      if (generation !== persistenceGeneration || version !== folderCommitVersion) return
      analytics.error('save_gadget_folders', error)
      const restored = await withTimeout(loadFolders(), STORAGE_TIMEOUT_MS).catch(() => folderCache ?? [])
      if (generation === persistenceGeneration && version === folderCommitVersion) {
        folderCache = restored
        notify()
      }
    })
}

function mutateGadgets(
  fn: (current: Gadget[]) => Gadget[],
  awaitPersistence = false,
): Promise<Gadget[]> {
  // clearGadgetsCache() が「呼び出し後」に発火したら、このミューテーションは古い世代の
  // ものとして破棄する（そうしないと、削除直前にキューへ入った add/update が
  // 空になったキャッシュへ後から反映され、消したはずのデータが1件だけ復活する）。
  const generationAtStart = persistenceGeneration
  let cancelled = false
  const run = gadgetMutationQueue.catch(() => {}).then(async () => {
    if (persistenceGeneration !== generationAtStart) return gadgetCache ?? []
    await assertLoaded()
    const gadgets = await currentGadgets()
    if (cancelled || persistenceGeneration !== generationAtStart) return gadgetCache ?? []
    const next = fn(gadgets)
    const persistence = commitGadgets(next, awaitPersistence)
    if (awaitPersistence) await persistence
    return next
  })
  gadgetMutationQueue = run.then(() => undefined, () => undefined)
  return withTimeout(run, STORAGE_TIMEOUT_MS).catch(error => {
    cancelled = true
    if (error instanceof Error && error.message.includes('operation timed out')) throw new Error('STORAGE_OPERATION_PENDING')
    throw error
  })
}

function mutateFolders(fn: (current: GadgetFolder[]) => GadgetFolder[]): Promise<GadgetFolder[]> {
  const generationAtStart = persistenceGeneration
  let cancelled = false
  const run = folderMutationQueue.catch(() => {}).then(async () => {
    if (persistenceGeneration !== generationAtStart) return folderCache ?? []
    await assertLoaded()
    const folders = await currentFolders()
    if (cancelled || persistenceGeneration !== generationAtStart) return folderCache ?? []
    const next = fn(folders)
    commitFolders(next)
    return next
  })
  folderMutationQueue = run.then(() => undefined, () => undefined)
  return withTimeout(run, STORAGE_TIMEOUT_MS).catch(error => {
    cancelled = true
    if (error instanceof Error && error.message.includes('operation timed out')) throw new Error('STORAGE_OPERATION_PENDING')
    throw error
  })
}

/** 設定画面の全データ削除時などに、メモリ上のキャッシュも破棄する */
export async function clearGadgetsCache() {
  persistenceGeneration += 1
  gadgetCommitVersion += 1
  folderCommitVersion += 1
  gadgetCache = []
  folderCache = []
  // 明示的な全消去は「空が正しい」と本人が決めた状態なので、保存の停止も解除する
  loadFailed = false
  notify()
  await withTimeout(Promise.all([
    gadgetPersistQueue.catch(() => {}),
    folderPersistQueue.catch(() => {}),
    gadgetMutationQueue.catch(() => {}),
    folderMutationQueue.catch(() => {}),
  ]), STORAGE_TIMEOUT_MS)
}

/** 受け付け済みの変更がディスクへ書き終わるまで待つ（usePlans の flushPlanPersistence と同じ役割） */
export async function flushGadgetPersistence(): Promise<void> {
  await withTimeout((async () => {
    await Promise.all([gadgetMutationQueue.catch(() => {}), folderMutationQueue.catch(() => {})])
    await Promise.all([gadgetPersistQueue.catch(() => {}), folderPersistQueue.catch(() => {})])
  })(), STORAGE_TIMEOUT_MS)
}

/**
 * AsyncStorage を画面の外から直接書き換えたあと（バックアップ復元）に呼ぶ。
 * clearGadgetsCache() で進行中の保存を打ち切ってから使うこと。
 */
export async function reloadGadgetsFromDisk(): Promise<void> {
  try {
    const [gs, fs] = await withTimeout(Promise.all([loadGadgets(), loadFolders()]), STORAGE_TIMEOUT_MS)
    gadgetCache = sortDesc(gs)
    folderCache = fs
    loadFailed = false
  } catch {
    gadgetCache = []
    folderCache = []
    loadFailed = true
  }
  notify()
}

export function useGadgets() {
  const initialSplit = splitGadgetsByTrash(gadgetCache ?? [])
  const [gadgets, setGadgets] = useState<Gadget[]>(initialSplit.active)
  const [deletedGadgets, setDeletedGadgets] = useState<Gadget[]>(initialSplit.deleted)
  const [folders, setFolders] = useState<GadgetFolder[]>(folderCache ?? [])
  const [loading, setLoading] = useState(gadgetCache === null)
  // 「読めなかった」を「0件」と混同して見せないための印。画面は空表示ではなく再試行を出す
  const [loadError, setLoadError] = useState(loadFailed)

  useEffect(() => {
    const listener = () => {
      const split = splitGadgetsByTrash(gadgetCache ?? [])
      setGadgets(split.active)
      setDeletedGadgets(split.deleted)
      setFolders(folderCache ?? [])
      setLoading(false)
      setLoadError(loadFailed)
    }
    listeners.add(listener)
    if (gadgetCache !== null) listener()
    else void ensureLoaded()
    return () => { listeners.delete(listener) }
  }, [])

  // キャッシュ済みなら何もしない（画面フォーカスごとのディスク再読込は不要になった）
  const reload = useCallback(() => { void ensureLoaded() }, [])

  const add = useCallback(async (gadget: Gadget) => {
    await mutateGadgets((cur) => [...cur, gadget])
    analytics.track(EVENTS.GADGET_CREATED, gadgetAnalyticsProperties(gadget))
  }, [])

  // テンプレート適用・共有デスクの複製のように、一度に十数台まとめて入る経路用。
  // add() をループで呼ぶと台数ぶん永続化が走り、gadget_created も台数ぶん飛ぶ
  // （デスク1つ作るのに十数件。イベント数の消費が実態と釣り合わない）。
  const addMany = useCallback(async (incoming: Gadget[]) => {
    if (incoming.length === 0) return
    // 永続化まで待って失敗を呼び出し元へ返す。ここを待たないと、保存に失敗した
    // ぶんがロールバックで静かに消えたまま、それらのIDを持つデスクだけが残り、
    // テンプレートで作ったはずの枠が1台も無いデスクができる。
    await mutateGadgets((cur) => [...cur, ...incoming], true)
    analytics.track(EVENTS.GADGET_CREATED, {
      bulk:          true,
      created_count: incoming.length,
      // カテゴリの内訳は残す。何が一括で入っているかが分からないと、
      // テンプレートの中身を見直す材料が無くなる
      categories:    [...new Set(incoming.map((g) => g.category))],
      with_price:    incoming.filter((g) => g.price != null).length,
      with_product_id: incoming.filter((g) => !!g.productId).length,
    })
  }, [])

  const update = useCallback(async (gadget: Gadget) => {
    await mutateGadgets((cur) => cur.map((g) => (g.id === gadget.id ? gadget : g)))
    analytics.track(EVENTS.GADGET_UPDATED, gadgetAnalyticsProperties(gadget))
  }, [])

  const toggleFavorite = useCallback(async (id: string) => {
    const next = await mutateGadgets((cur) => cur.map((gadget) =>
      gadget.id === id ? { ...gadget, favorite: gadget.favorite ? undefined : true } : gadget), true)
    return next.find((gadget) => gadget.id === id)
  }, [])

  const setFavorite = useCallback(async (id: string, favorite: boolean) => {
    await mutateGadgets((cur) => cur.map((gadget) =>
      gadget.id === id ? { ...gadget, favorite: favorite || undefined } : gadget), true)
  }, [])

  const setDisposedAt = useCallback(async (id: string, disposedAt?: string) => {
    const next = await mutateGadgets((cur) => cur.map((gadget) =>
      gadget.id === id ? { ...gadget, disposedAt } : gadget), true)
    return next.find((gadget) => gadget.id === id)
  }, [])

  const updateMany = useCallback(async (incoming: Gadget[]) => {
    if (incoming.length === 0) return
    const replacements = new Map(incoming.map((gadget) => [gadget.id, gadget]))
    await mutateGadgets(
      (cur) => cur.map((gadget) => replacements.get(gadget.id) ?? gadget),
      true,
    )
    analytics.track(EVENTS.GADGET_UPDATED, {
      bulk: true,
      updated_count: incoming.length,
      categories: [...new Set(incoming.map((gadget) => gadget.category))],
    })
  }, [])

  const replaceAll = useCallback(async (
    incoming: Gadget[],
    options: { awaitPersistence?: boolean; deleted?: Gadget } = {},
  ) => {
    await mutateGadgets(() => incoming, options.awaitPersistence === true)
    if (options.deleted) analytics.track(EVENTS.GADGET_DELETED, gadgetAnalyticsProperties(options.deleted))
  }, [])

  const moveToTrash = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    const deletedAt = new Date().toISOString()
    await mutateGadgets(
      (cur) => cur.map((gadget) => idSet.has(gadget.id) ? { ...gadget, deletedAt } : gadget),
      true,
    )
    analytics.track(EVENTS.GADGET_DELETED, { deleted_count: ids.length, bulk: ids.length > 1, recoverable: true })
  }, [])

  const restoreFromTrash = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    await mutateGadgets(
      (cur) => cur.map((gadget) => {
        if (!idSet.has(gadget.id)) return gadget
        const { deletedAt: _deletedAt, ...rest } = gadget
        return rest
      }),
      true,
    )
  }, [])

  const remove = useCallback(async (id: string) => {
    const existing = (await currentGadgets()).find((g) => g.id === id)
    await mutateGadgets((cur) => cur.filter((g) => g.id !== id))
    analytics.track(EVENTS.GADGET_DELETED, existing ? gadgetAnalyticsProperties(existing) : {})
  }, [])

  /**
   * 削除の取り消し・失敗時の巻き戻し用。add() と違って作成イベントを送らない。
   * add() をループで呼ぶと、削除を1回取り消すたびに台数ぶんの gadget_created が積まれる。
   */
  const restoreMany = useCallback(async (incoming: Gadget[]) => {
    if (incoming.length === 0) return
    await mutateGadgets((cur) => {
      const known = new Set(cur.map((g) => g.id))
      return [...cur, ...incoming.filter((g) => !known.has(g.id))]
    }, true)
  }, [])

  // track: false は「まだ取り消せる削除」用。確定した時点で呼び出し側が送る
  const removeMany = useCallback(async (ids: string[], options: { track?: boolean } = {}) => {
    const idSet = new Set(ids)
    await mutateGadgets((cur) => cur.filter((g) => !idSet.has(g.id)))
    if (options.track === false) return
    analytics.track(EVENTS.GADGET_DELETED, { deleted_count: ids.length, bulk: true })
  }, [])

  // ─── フォルダ操作 ─────────────────────────────────────────────────

  const addFolder = useCallback(async (name: string) => {
    await mutateFolders((cur) => {
      const folder: GadgetFolder = {
        id: `folder_${Date.now()}`,
        name,
        color: FOLDER_PALETTE[cur.length % FOLDER_PALETTE.length],
        sortOrder: cur.length,
        createdAt: new Date().toISOString(),
      }
      return [...cur, folder]
    })
  }, [])

  const renameFolder = useCallback(async (folder: GadgetFolder, newName: string) => {
    await mutateFolders((cur) => cur.map((f) => (f.id === folder.id ? { ...f, name: newName } : f)))
  }, [])

  const removeFolder = useCallback(async (id: string) => {
    await mutateFolders((cur) => cur.filter((f) => f.id !== id))
    await mutateGadgets((cur) => cur.map((g) =>
      g.folderIds?.includes(id) ? { ...g, folderIds: g.folderIds.filter((fid) => fid !== id) } : g,
    ))
  }, [])

  // ガジェットのフォルダ所属を切り替える（複数フォルダ対応）
  const toggleGadgetFolder = useCallback(async (gadget: Gadget, folderId: string) => {
    await mutateGadgets((cur) => cur.map((g) => {
      if (g.id !== gadget.id) return g
      const folderIds = g.folderIds ?? []
      const next = folderIds.includes(folderId)
        ? folderIds.filter((id) => id !== folderId)
        : [...folderIds, folderId]
      return { ...g, folderIds: next }
    }))
  }, [])

  // ガジェットのフォルダを一括上書き
  const setGadgetFolders = useCallback(async (gadget: Gadget, folderIds: string[]) => {
    await mutateGadgets((cur) => cur.map((g) => (g.id === gadget.id ? { ...g, folderIds } : g)))
  }, [])

  return {
    gadgets,
    deletedGadgets,
    folders,
    loading,
    loadError,
    reload,
    add,
    addMany,
    update,
    toggleFavorite,
    setFavorite,
    setDisposedAt,
    updateMany,
    replaceAll,
    moveToTrash,
    restoreFromTrash,
    restoreMany,
    remove,
    removeMany,
    addFolder,
    renameFolder,
    removeFolder,
    toggleGadgetFolder,
    setGadgetFolders,
  }
}
