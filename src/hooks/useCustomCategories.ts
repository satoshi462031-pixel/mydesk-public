import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { CustomCategory, Gadget } from '../types'
import { CUSTOM_CATEGORY_NAME_MAX, customCategoryOf, normalizeCustomCategory, normalizeCustomCategoryColor } from '../utils/customCategory'
import { useGadgets } from './useGadgets'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'

// アカウントの持ち物なので、ログアウトで消す（utils/localUserDataKeys.ts に載せてある）
export const CUSTOM_CATEGORIES_KEY = '@custom_categories_v1'

// 全画面で同じ一覧を見る。作成中に作ったジャンルが、同じ操作の中で開く
// 「ジャンルを追加」シートにも出ていないと、作ったはずの物が消えたように見える
let cache: CustomCategory[] | null = null
// 端末から読めなかった（中身が無いのとは違う）。読めない間の空の一覧を保存すると、
// 保存済みのジャンルがその空で上書きされる（usePlans / useGadgets の loadFailed と同じ）
let loadFailed = false
let loadPromise: Promise<void> | null = null
let generation = 0
let mutationQueue: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

/** 保存値の中身が壊れていたら空として扱う。読み込み自体の失敗とは違い、待っても戻らない */
function parseStoredCategories(raw: string | null): CustomCategory[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed)
      ? parsed.map(normalizeCustomCategory).filter((c): c is CustomCategory => !!c)
      : []
  } catch {
    return []
  }
}

function ensureLoaded(): Promise<void> {
  // 失敗したままなら毎回やり直す。画面を開き直すことがそのまま復帰の機会になる
  if (cache && !loadFailed) return Promise.resolve()
  if (loadPromise) return loadPromise
  const loadGeneration = generation
  loadPromise = withTimeout(AsyncStorage.getItem(CUSTOM_CATEGORIES_KEY), STORAGE_TIMEOUT_MS)
    .then((raw) => {
      if (loadGeneration !== generation) return
      loadFailed = false
      cache = parseStoredCategories(raw)
    })
    .catch(() => {
      if (loadGeneration !== generation) return
      loadFailed = true
      if (!cache) cache = []
    })
    .finally(() => {
      if (loadGeneration !== generation) return
      loadPromise = null
      notify()
    })
  return loadPromise
}

async function commit(next: CustomCategory[]): Promise<void> {
  const commitGeneration = generation
  await AsyncStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(next))
  if (commitGeneration !== generation) throw new Error('ACCOUNT_DATA_CHANGED')
  cache = next
  notify()
}

// 保存を待つ間に別の操作が古い一覧を使うと、重複作成や更新の取り落としになる。
function mutate<T>(run: () => Promise<T>): Promise<T> {
  const mutationGeneration = generation
  let cancelled = false
  const result = mutationQueue.then(async () => {
    if (mutationGeneration !== generation) throw new Error('ACCOUNT_DATA_CHANGED')
    await ensureLoaded()
    if (mutationGeneration !== generation) throw new Error('ACCOUNT_DATA_CHANGED')
    if (cancelled) throw new Error('STORAGE_OPERATION_PENDING')
    if (loadFailed) throw new Error('CUSTOM_CATEGORIES_NOT_LOADED')
    return run()
  })
  mutationQueue = result.then(() => {}, () => {})
  return withTimeout(result, STORAGE_TIMEOUT_MS).catch(error => {
    cancelled = true
    if (error instanceof Error && error.message.includes('operation timed out')) throw new Error('STORAGE_OPERATION_PENDING')
    throw error
  })
}

export async function flushCustomCategoryPersistence(): Promise<void> {
  await withTimeout(mutationQueue, STORAGE_TIMEOUT_MS)
}

/**
 * バックアップ用に、端末に保存してある一覧を読む。一度も作っていない・読めないときは undefined。
 * 空の一覧を載せると、復元先の端末で作ってあったジャンルを空で消してしまう
 */
export async function readStoredCustomCategories(): Promise<CustomCategory[] | undefined> {
  await flushCustomCategoryPersistence()
  try {
    const raw = await withTimeout(AsyncStorage.getItem(CUSTOM_CATEGORIES_KEY), STORAGE_TIMEOUT_MS)
    return raw === null ? undefined : parseStoredCategories(raw)
  } catch {
    return undefined
  }
}

/** 復元・復元の取り消しで端末の一覧を書き換えたあとに呼ぶ。開いている画面の一覧も読み直す */
export async function reloadCustomCategoriesFromDisk(): Promise<void> {
  await clearCustomCategoriesCache()
  return ensureLoaded()
}

/** ログアウト時に呼ぶ。古い読み込みを無効にし、保存が終わってから端末のデータを消す */
export async function clearCustomCategoriesCache(): Promise<void> {
  generation += 1
  cache = null
  loadFailed = false
  loadPromise = null
  notify()
  await withTimeout(mutationQueue, STORAGE_TIMEOUT_MS)
}

/**
 * 自作ジャンルの一覧と、作る・直す・消す操作。
 *
 * 一覧は「端末に保存した一覧」と「持ち物が使っているジャンル」を合わせたもの。
 * バックアップから戻したときは持ち物しか戻らないので、持ち物から拾わないと
 * 使っているジャンルが選択肢から消える。
 */
export function useCustomCategories() {
  const { gadgets, deletedGadgets, updateMany } = useGadgets()
  const [stored, setStored] = useState<CustomCategory[]>(cache ?? [])

  useEffect(() => {
    const sync = () => setStored(cache ?? [])
    listeners.add(sync)
    void ensureLoaded().then(sync)
    return () => { listeners.delete(sync) }
  }, [])

  const allGadgets = useMemo(() => [...gadgets, ...deletedGadgets], [gadgets, deletedGadgets])

  const categories = useMemo(() => {
    const byId = new Map(stored.map((category) => [category.id, category]))
    for (const gadget of allGadgets) {
      const custom = customCategoryOf(gadget)
      if (custom && !byId.has(custom.id)) byId.set(custom.id, custom)
    }
    return [...byId.values()]
  }, [stored, allGadgets])

  const usageCount = useCallback(
    (id: string) => allGadgets.filter((gadget) => customCategoryOf(gadget)?.id === id).length,
    [allGadgets],
  )

  const add = useCallback((name: string, icon: string, color?: string): Promise<CustomCategory> => mutate(async () => {
    const trimmed = name.trim().slice(0, CUSTOM_CATEGORY_NAME_MAX)
    // 同じ名前を2つ作ると、一覧で見分けられない札が並ぶ。既存のものを返して選ばせる
    const same = (cache ?? []).find((category) => category.name === trimmed)
      ?? allGadgets.map(customCategoryOf).find((category) => category?.name === trimmed)
    if (same) return same
    const normalizedColor = normalizeCustomCategoryColor(color)
    const created: CustomCategory = { id: uuidv4(), name: trimmed, icon, ...(normalizedColor ? { color: normalizedColor } : {}) }
    await commit([...(cache ?? []), created])
    return created
  }), [allGadgets])

  const update = useCallback((id: string, patch: { name: string; icon: string; color?: string }): Promise<CustomCategory> => mutate(async () => {
    const previous = (cache ?? []).find((category) => category.id === id)
      ?? allGadgets.map(customCategoryOf).find((category) => category?.id === id)
    const color = normalizeCustomCategoryColor(patch.color ?? previous?.color)
    const next: CustomCategory = { id, name: patch.name.trim().slice(0, CUSTOM_CATEGORY_NAME_MAX), icon: patch.icon, ...(color ? { color } : {}) }
    const list = cache ?? []
    await commit(list.some((category) => category.id === id)
      ? list.map((category) => (category.id === id ? next : category))
      : [...list, next])
    // 持ち物は名前と絵の写しを持っているので、ここで一緒に書き換える。
    // 枠（未選択のガジェット）は名前がジャンル名そのものなので、名前も追従させる
    const touched: Gadget[] = allGadgets
      .filter((gadget) => customCategoryOf(gadget)?.id === id)
      .map((gadget) => ({
        ...gadget,
        customCategory: next,
        name: gadget.isPlaceholder && previous && gadget.name.startsWith(previous.name)
          ? next.name + gadget.name.slice(previous.name.length)
          : gadget.name,
      }))
    await updateMany(touched)
    return next
  }), [allGadgets, updateMany])

  /** 使っている持ち物があるものは消さない（呼び出し側で usageCount を見て案内する） */
  const remove = useCallback((id: string): Promise<boolean> => mutate(async () => {
    if (usageCount(id) > 0) return false
    await commit((cache ?? []).filter((category) => category.id !== id))
    return true
  }), [usageCount])

  return { categories, add, update, remove, usageCount }
}
