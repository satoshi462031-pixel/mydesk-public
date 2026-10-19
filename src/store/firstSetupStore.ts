import AsyncStorage from '@react-native-async-storage/async-storage'
import { FirstSetupDraft, parseFirstSetupDraft, parseProductFillDraft, ProductFillDraft } from '../utils/firstSetupResume'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'

export type { FirstSetupDraft } from '../utils/firstSetupResume'

const FIRST_SETUP_DRAFT_KEY = '@first_setup_draft_v1'
const PRODUCT_FILL_DRAFT_PREFIX = '@product_fill_draft_v1:'

// 再開位置のメモリの控え（undefined はまだディスクから読んでいない）。
// 一覧はフォーカスのたびにディスクを読み直していて、読み終わるまで「作成途中」の行が消えていた。
// 書き込みはすべてここを通るので、読んだあとはこちらを正とする
let draftCache: FirstSetupDraft | null | undefined
let draftGeneration = 0
let draftPersistence: Promise<void> = Promise.resolve()

function persistDraft(operation: () => Promise<void>): Promise<void> {
  const saving = draftPersistence.then(operation)
  draftPersistence = saving.catch(() => {})
  return saving
}

/** 読み込みを待たずに今の再開位置を返す。まだ一度も読んでいなければ undefined */
export function peekFirstSetupDraft(): FirstSetupDraft | null | undefined {
  return draftCache
}

export function flushFirstSetupDraftPersistence(): Promise<void> {
  return withTimeout(draftPersistence, STORAGE_TIMEOUT_MS)
}

export async function saveFirstSetupDraft(draft: FirstSetupDraft): Promise<void> {
  const generation = draftGeneration
  const known = draftCache
  // 控えへは読み込みを待たずに置く。待つと、その間に読み終えた一覧が古い再開位置を出す
  const pending: FirstSetupDraft = { ...draft, ...(known?.createdAt && !draft.createdAt ? { createdAt: known.createdAt } : {}) }
  draftCache = pending
  await withTimeout(persistDraft(async () => {
    if (generation !== draftGeneration) return
    const previous = known?.createdAt
      ? known
      : parseFirstSetupDraft(await withTimeout(AsyncStorage.getItem(FIRST_SETUP_DRAFT_KEY), STORAGE_TIMEOUT_MS).catch(() => null))
    if (generation !== draftGeneration) return
    const createdAt = draft.createdAt ?? previous?.createdAt ?? new Date().toISOString()
    const next = { ...draft, createdAt }
    if (draftCache === pending) draftCache = next
    await AsyncStorage.setItem(FIRST_SETUP_DRAFT_KEY, JSON.stringify(next))
  }), STORAGE_TIMEOUT_MS)
}

export async function loadFirstSetupDraft(): Promise<FirstSetupDraft | null> {
  if (draftCache !== undefined) return draftCache
  const generation = draftGeneration
  try {
    const draft = parseFirstSetupDraft(await withTimeout(AsyncStorage.getItem(FIRST_SETUP_DRAFT_KEY), STORAGE_TIMEOUT_MS))
    if (generation !== draftGeneration) return draftCache ?? null
    // 読んでいる間に保存・破棄があれば、そちらが新しい
    if (draftCache !== undefined) return draftCache
    if (!draft || draft.createdAt) {
      draftCache = draft
      return draft
    }
    const migrated = { ...draft, createdAt: new Date().toISOString() }
    draftCache = migrated
    await withTimeout(persistDraft(async () => {
      if (generation !== draftGeneration || draftCache !== migrated) return
      await AsyncStorage.setItem(FIRST_SETUP_DRAFT_KEY, JSON.stringify(migrated))
    }), STORAGE_TIMEOUT_MS).catch(() => {})
    return draftCache ?? null
  } catch {
    return draftCache ?? null
  }
}

/** ログアウト・アカウント削除で控えを無効化し、実行中の保存完了を待つ。 */
export function clearFirstSetupDraftCache(): Promise<void> {
  draftGeneration += 1
  draftCache = undefined
  return withTimeout(draftPersistence, STORAGE_TIMEOUT_MS)
}

export async function clearFirstSetupDraft(): Promise<void> {
  draftGeneration += 1
  draftCache = null
  await withTimeout(persistDraft(() => AsyncStorage.removeItem(FIRST_SETUP_DRAFT_KEY)), STORAGE_TIMEOUT_MS)
}

export async function loadProductFillDraft(planId: string): Promise<ProductFillDraft> {
  try {
    const raw = await withTimeout(AsyncStorage.getItem(PRODUCT_FILL_DRAFT_PREFIX + planId), STORAGE_TIMEOUT_MS)
    return parseProductFillDraft(raw)
  } catch {
    return { values: {}, picked: {} }
  }
}

export async function saveProductFillDraft(planId: string, draft: ProductFillDraft): Promise<void> {
  await withTimeout(AsyncStorage.setItem(PRODUCT_FILL_DRAFT_PREFIX + planId, JSON.stringify(draft)), STORAGE_TIMEOUT_MS)
}

export async function clearProductFillDraft(planId: string): Promise<void> {
  await withTimeout(AsyncStorage.removeItem(PRODUCT_FILL_DRAFT_PREFIX + planId), STORAGE_TIMEOUT_MS)
}
