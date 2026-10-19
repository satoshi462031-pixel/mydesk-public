import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '../supabase/client'
import { BackupRow } from '../supabase/types'
import { CustomCategory, DeskPlan, Gadget, GadgetFolder } from '../types'
import { CUSTOM_CATEGORIES_KEY, flushCustomCategoryPersistence, readStoredCustomCategories, reloadCustomCategoriesFromDisk } from '../hooks/useCustomCategories'
import { normalizeCustomCategory } from '../utils/customCategory'
import { clearGadgetsMigrationFlag, loadFolders, loadGadgets, saveFolders, saveGadgets } from '../store/gadgetStore'
import { loadPlans, savePlans } from '../store/planStore'
import { readConversations, replaceConversations, sortConversationsByRecent, StoredConversation, flushConversationPersistence } from '../store/conversationStore'
import { exportPublishLinks, importPublishLinks, restorePublishedPlanLinks } from './publishService'
import { clearGadgetsCache, flushGadgetPersistence, reloadGadgetsFromDisk } from '../hooks/useGadgets'
import { clearPlansCache, flushPlanPersistence, reloadPlansFromDisk } from '../hooks/usePlans'
import { analytics, EVENTS } from './analytics'
import { utf8ByteLength } from '../utils/utf8ByteLength'
import { claimLocalData, getLocalDataOwner, isSignInPending, markSignInPending } from '../store/accountDataOwner'
import { decideReconcileAction, mergeById, ReconcileAction } from '../utils/accountDataReconcile'
import { dropMissingLocalImages } from '../utils/planImages'
import { repairStoredConversations, repairStoredFolders, repairStoredGadgets, repairStoredPlans } from '../utils/storedDataRepair'
import { serializeLocalDataOperation } from '../utils/localDataOperation'
import { AppearancePreferences, readAppearancePreferences, restoreAppearancePreferences, notifyAppearancePreferences, parseAppearancePreferences, flushAppearancePersistence } from '../store/appearanceStore'
import { PUBLISH_TIMEOUT_MS, QUICK_TIMEOUT_MS, STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'
import { BACKUP_REVIEW_KEY, captureRestoreSnapshot, isRestoreSnapshot, RESTORE_JOURNAL_KEY, RESTORE_POINT_KEY, RestoreSnapshot, writeRestoreSnapshot } from '../store/backupRecoveryStore'
import { dropMissingConversationImages } from './ai/imageService'
import { clearFirstSetupDraftCache, flushFirstSetupDraftPersistence, loadFirstSetupDraft } from '../store/firstSetupStore'
import { FirstSetupDraft, parseFirstSetupDraft } from '../utils/firstSetupResume'
import { clearTemplateDetailDraft } from '../store/templateDetailDraft'
import { cancelPendingViewHistoryUpdates, flushViewHistoryPersistence, isViewHistoryEntry, mergeViewHistory, readViewHistoryForBackup, ViewHistoryEntry, VIEW_HISTORY_KEY } from '../utils/viewHistory'

// ─── アカウント・バックアップ ─────────────────────────────────────
//
// デスク・ガジェット・履歴は端末の AsyncStorage にしか無い（サーバーにあるのは
// 公開したデスクのスナップショットだけ）。そのため再インストール・機種変更で
// 記録が丸ごと消える。ログイン中は JSON スナップショットを Supabase へ預け、
// 同じアカウントでログインした空の端末へ自動で復元する。
//
// 写真は対象外。ファイル実体は Storage 側にあり、費用・通信量・削除処理が
// まとめて増えるため、まず JSON だけを対象にする。

/**
 * ペイロードの形式バージョン。
 * 4: publishLinks（公開の対応表）／5: aiConversations（AI相談履歴）／6: appearance（外観設定）
 */
export const BACKUP_SCHEMA_VERSION = 6

/** サーバー側（018_backups.sql のトリガー）が保持する世代数。UI 表示用 */
export const BACKUP_GENERATIONS = 7

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const ACCOUNT_RESTORE_TIMEOUT_MS = 5_000

// jsonb に載せる上限。通常のユーザーは 1MB にも届かないが、
// 極端に大きいデータで毎日の通信とDB容量を食い潰さないための安全弁。
const MAX_BACKUP_BYTES = 4 * 1024 * 1024

const LAST_BACKUP_AT_KEY = '@backup_last_at'
const DEVICE_ID_KEY      = '@backup_device_id'
// この端末が最後に送った・戻した控えの ID と内容のハッシュ（{ id, hash }）。
// 控えは端末ごとの丸ごとの写しなので、比べずに送ると、しばらく開いていなかった古い端末が
// 別の端末の新しい控えを押し流す（Free は1世代しか残らず、そのまま消える）。
// 送る前にサーバーの最新の ID と照らし、知らない控えがあれば自動では送らない。
// pending は送信の直前に置く。応答だけ失われても、その行を自分の控えと見分けられる
const BACKUP_BASE_KEY    = '@backup_base'
const BACKUP_PENDING_KEY = '@backup_pending'
const BACKUP_NOTICE_AT_KEY = '@backup_notice_at'
const BACKUP_NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000
// 送信の失敗は圏外でも起きる。成功がこれより古くなったときだけ知らせる
const BACKUP_STALE_NOTICE_MS = 7 * 24 * 60 * 60 * 1000
// UTF-8 を1バイト1文字で読んで化けた文字列に現れる C1 制御文字。サーバー（102_reject_mojibake.sql）は
// これを1文字でも含む控えを拒否する。送ってから断られると通信の失敗と見分けられない
const GARBLED_TEXT = /[\u0080-\u009F]/

const DESK_HISTORY_PREFIX = '@desk_history'
const isDeskHistoryKey = (key: string) => key === DESK_HISTORY_PREFIX || key.startsWith(`${DESK_HISTORY_PREFIX}:`)

export interface BackupPayload {
  app: 'MyDesk'
  version: number
  exportedAt: string
  gadgets: Gadget[]
  folders: GadgetFolder[]
  plans: DeskPlan[]
  /**
   * 旧形式のバックアップにだけ入っている、デスクのスナップショット。
   * 書き出す側（utils/deskHistory.ts）が一度も呼ばれておらず常に空だったため、
   * 現在は出力しない。過去のバックアップを復元できるよう読み取りだけ残す。
   */
  deskHistories?: Record<string, unknown[]>
  /**
   * 「プラン → 公開デスク」の対応（AsyncStorage のキーと値そのまま）。
   * version 4 から。これが無いと復元後に対応が切れ、同じデスクが公開中と
   * 未公開に二重で並び、再公開すると公開ページが二重にできる。
   * 3 以前のバックアップには入っていないので必須にしない。
   */
  publishLinks?: Record<string, string>
  /**
   * AI相談履歴。version 5 から。本文はユーザーが書いたもので、端末の
   * AsyncStorage にしか無い（サーバーに会話のテーブルは無い）。
   * 4 以前のバックアップには入っていないので必須にしない。
   */
  aiConversations?: StoredConversation[]
  /** version 6 以降。旧バックアップでは端末の外観を維持する */
  appearance?: AppearancePreferences
  /**
   * 自作ジャンルの一覧。version 6 の途中から足した任意の項目（版は上げない。上げると、この項目を
   * 知らない前の版のアプリが新しいバックアップをまるごと読めなくなる）。
   * 持ち物に使っているジャンルは持ち物の写しから戻るが、まだ使っていないジャンルはここにしか無い。
   * 無いバックアップでは端末の一覧を維持する
   */
  customCategories?: CustomCategory[]
  /** 作成の再開位置。旧バックアップではデスク本体から再開先を補う。 */
  firstSetupDraft?: FirstSetupDraft | null
  /** 見たデスクの履歴（保有済みの最大1,000件）。未収録の旧バックアップでは端末の履歴を維持する。 */
  viewHistory?: ViewHistoryEntry[]
}

function packConversations(all: readonly StoredConversation[]): StoredConversation[] {
  // 省いた会話があるのに保存成功としてログアウトすると、その本文を失う。容量判定は全体で行う。
  // 写真の参照は残す。外すと同じ端末へ世代を戻したときに、残っている写真まで相談から外れる。
  // 別の端末では実物が無いので、復元時に dropMissingConversationImages が外す
  return sortConversationsByRecent(all)
}

export interface LocalDataSource {
  gadgets: Gadget[]
  folders: GadgetFolder[]
  plans: DeskPlan[]
}

/**
 * アカウントに保存するペイロードを組み立てる。
 *
 * source を渡すとメモリキャッシュ上の値を使う。省略時はディスクから読み直す。
 * 読み直す前に保存待ちの変更を書き終えさせる。待たないと直前の編集が控えから漏れる
 */
export async function buildBackupPayload(source?: LocalDataSource): Promise<BackupPayload> {
  await flushCustomCategoryPersistence()
  await flushFirstSetupDraftPersistence()
  if (!source) await Promise.all([flushGadgetPersistence(), flushPlanPersistence(), flushConversationPersistence()])
  const [gadgets, folders, plans] = source
    ? [source.gadgets, source.folders, source.plans]
    : await Promise.all([loadGadgets(), loadFolders(), loadPlans()])
  const [publishLinks, conversations, appearance, customCategories, draft, viewHistory] = await Promise.all([
    exportPublishLinks(), readConversations(), readAppearancePreferences(), readStoredCustomCategories(), loadFirstSetupDraft(),
    readViewHistoryForBackup(),
  ])
  const firstSetupDraft = draft && (!('planId' in draft) || plans.some((plan) => !plan.isShared && plan.id === draft.planId)) ? draft : null

  return {
    app: 'MyDesk',
    version: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    gadgets,
    folders,
    plans,
    publishLinks,
    aiConversations: packConversations(conversations),
    appearance,
    customCategories,
    firstSetupDraft,
    viewHistory,
  }
}

/**
 * 中身が空か。空の端末に控えを戻すか（reconcileAccountData）の判定に使う。
 * 保存側は持ち主の印で判断するので、突き合わせ済みなら空でも上げる（uploadPayload）。
 */
export function isPayloadEmpty(payload: BackupPayload): boolean {
  // 相談だけしてデスクをまだ作っていない人がいる。ここで空と判断すると、
  // その人の会話がサーバーへ上がらないまま端末を替えたときに消える。
  // フォルダも同じで、棚だけ作ってガジェットを入れていない端末を空と見ると、
  // ログイン時に控えで全置換されて棚が消える
  return payload.gadgets.length === 0
    && payload.folders.length === 0
    && payload.plans.length === 0
    && (payload.aiConversations?.length ?? 0) === 0
    && (payload.customCategories?.length ?? 0) === 0
    && !payload.firstSetupDraft
    && (payload.viewHistory?.length ?? 0) === 0
}

async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY)
  if (existing) return existing
  const id = uuidv4()
  await AsyncStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

function deviceName(): string {
  const os = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS
  return `${os} ${Platform.Version}`
}

export type AutoBackupResult =
  | 'done'
  | 'not-due'      // 前回から24時間経っていない
  | 'empty'        // 突き合わせ前の端末が空。上げると控えを押し流すので実行しない
  | 'too-large'    // 上限を超えた
  | 'invalid-data' // 端末の保存データを欠落なく読み取れない
  | 'garbled-text' // 文字化けした文字を含む。サーバーが受け付けない
  | 'recovery-pending' // 復元した内容の確認または途中失敗からの復旧待ち
  | 'not-synced'   // 端末のデータがまだこのアカウントの控えと突き合わされていない
  | 'conflict'     // この端末が知らない控え（別の端末が送ったもの）がサーバーの最新にある
  | 'failed'

export type AccountReconcileResult =
  | 'restored'
  | 'merged'       // ログインせずに作ったデータとアカウントの控えを合わせた
  | 'not-needed'   // 突き合わせ済み
  | 'none'         // サーバーに控えが無い
  | 'needs-review' // 一部のデータを除外する復元は自動で進めない
  | 'foreign'      // 別のアカウントのデータが残っている。本人に扱いを聞く
  | 'failed'
  | 'cancelled'   // 通信中にアカウントが変わったか、端末のデータが消去された

type BackupMark = { id: string; hash: string | null }

function parseBackupMark(raw: string | null): BackupMark | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const { id, hash } = value as Record<string, unknown>
    return typeof id === 'string' && id ? { id, hash: typeof hash === 'string' ? hash : null } : null
  } catch {
    return null
  }
}

/** 戻した控えを、以後の突き合わせの基点にする。中身は修復・統合で変わりうるのでハッシュは持たない */
async function markRestoredBackup(id: string | null): Promise<void> {
  if (id) await AsyncStorage.setItem(BACKUP_BASE_KEY, JSON.stringify({ id, hash: null }))
  else await AsyncStorage.removeItem(BACKUP_BASE_KEY)
  await AsyncStorage.removeItem(BACKUP_PENDING_KEY)
}

/** サーバーの最新の控え（中身は引かない）。userId を省くと RLS で本人の分だけになる */
async function fetchBackupHead(userId?: string): Promise<{ id: string; device_id: string | null } | null> {
  let query = supabase.from('backups').select('id, device_id')
  if (userId) query = query.eq('user_id', userId)
  const { data, error } = await withTimeout(Promise.resolve(query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()), QUICK_TIMEOUT_MS)
  if (error) throw error
  return data && typeof data.id === 'string' ? { id: data.id, device_id: data.device_id ?? null } : null
}

// 同じ内容かどうかを見るだけなので、暗号学的な強さは要らない（cyrb53）
function contentHash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${text.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`
}

async function uploadPayload(
  userId: string,
  payload: BackupPayload,
  startedAt: number,
  isCurrent: () => boolean,
  reviewedPoint: string | null,
  overwriteNewer: boolean,
): Promise<Exclude<AutoBackupResult, 'not-due' | 'failed'>> {
  // 突き合わせる前に上げると、アカウントの控えを端末の中身で押し流す。
  // 突き合わせ済みなら空も上げる。上げないと、全部消した状態がアカウントに届かず、
  // ログアウト後の再ログインや別の端末で消したデスク・ガジェットが戻ってくる
  if (await hasPendingBackupRecovery()) return 'recovery-pending'
  if (await isSignInPending() || (await getLocalDataOwner()) !== userId) {
    return isPayloadEmpty(payload) ? 'empty' : 'not-synced'
  }

  if (!isBackupPayload(payload)) throw new Error('backup payload is malformed')
  const serialized = JSON.stringify(payload)
  if (GARBLED_TEXT.test(serialized)) return 'garbled-text'
  const byteSize = utf8ByteLength(serialized)
  if (byteSize > MAX_BACKUP_BYTES) return 'too-large'

  const deviceId = await getDeviceId()
  // 書き出し時刻は毎回変わるので、比べる内容から外す
  const hash = contentHash(JSON.stringify({ ...payload, exportedAt: undefined }))
  const [head, marks] = await Promise.all([
    fetchBackupHead(userId),
    AsyncStorage.multiGet([BACKUP_BASE_KEY, BACKUP_PENDING_KEY]),
  ])
  const [base, pending] = marks.map(([, raw]) => parseBackupMark(raw))
  const known = head ? [base, pending].find(mark => mark?.id === head.id) ?? null : null
  // 基点を持つ前の版から使っている端末は、最新が自分の送ったものかを端末 ID で見る。
  // 端末 ID は iCloud からの移行で複製されうるので、基点があるときは使わない
  const legacyOwn = !base && !pending && head?.device_id === deviceId
  if (head && !known && !legacyOwn && !overwriteNewer) return 'conflict'

  const id = uuidv4()
  if (!isCurrent() || await hasPendingBackupRecovery() || await isSignInPending() || (await getLocalDataOwner()) !== userId) return 'not-synced'
  if (!isCurrent()) return 'not-synced'
  // 最新が同じ内容なら行を足さない。足すと、ログアウトや手動保存を繰り返すだけで
  // Pro の7世代が同じ内容で埋まり、前の日の世代が押し出される
  const unchanged = !!known && known.hash === hash
  if (!unchanged) {
    await AsyncStorage.setItem(BACKUP_PENDING_KEY, JSON.stringify({ id, hash }))
    const { error } = await supabase.from('backups').insert({
      id,
      user_id: userId,
      payload,
      schema_version: payload.version,
      device_id: deviceId,
      device_name: deviceName(),
      byte_size: byteSize,
    })
    if (error) {
      // 22021: 文字化けの拒否（102）。23514: 容量の制約（045）。サーバーは jsonb を空白入りの
      // 文字列にして測るので、手元の判定より少し大きく数えられ、上限の手前でも断られる
      if (error.code === '22021') return 'garbled-text'
      if (error.code === '23514') return 'too-large'
      throw error
    }
  }

  // 遅い送信応答が、新しく始まった復元の退避やログアウト後の保存時刻を書き換えない。
  await serializeLocalDataOperation(async current => {
    if (!current() || !isCurrent() || (await getLocalDataOwner()) !== userId || await hasPendingBackupRecovery()) return
    if (!current() || !isCurrent()) return
    await AsyncStorage.setItem(BACKUP_BASE_KEY, JSON.stringify(unchanged ? known : { id, hash }))
    await AsyncStorage.removeItem(BACKUP_PENDING_KEY)
    await AsyncStorage.setItem(LAST_BACKUP_AT_KEY, new Date().toISOString())
    if (reviewedPoint && await AsyncStorage.getItem(RESTORE_POINT_KEY) === reviewedPoint) await AsyncStorage.removeItem(RESTORE_POINT_KEY)
  })
  if (unchanged) return 'done'
  analytics.track(EVENTS.BACKUP_COMPLETED, {
    byte_size:    byteSize,
    gadget_count: payload.gadgets.length,
    plan_count:   payload.plans.length,
    duration_ms:  Date.now() - startedAt,
  })
  return 'done'
}

/**
 * 起動時に1回だけ呼ぶ。前回から24時間以上経っていればバックアップする。
 *
 * AppState の 'background' 遷移では実行しない。iOS/Android とも遷移後の非同期処理の
 * 完走が保証されず、取りこぼすうえに二重実行の考慮が増えるだけなので、
 * 「起動時に経過時間を見る」1条件に寄せている。
 */
const snapshotSaves = new Map<string, { work: Promise<AutoBackupResult>; automatic: boolean }>()
const manualSnapshotRequests = new Map<string, Promise<AutoBackupResult>>()

async function assertLocalBackupReadable(): Promise<void> {
  const entries = await AsyncStorage.multiGet(['@desk_gadgets', '@gadget_folders', '@desk_plans', '@ai_conversations_v2'])
  for (const [key, raw] of entries) {
    if (raw === null) continue
    let rows: unknown
    try { rows = JSON.parse(raw) } catch { throw new Error('LOCAL_BACKUP_DATA_INVALID') }
    if (!Array.isArray(rows)) throw new Error('LOCAL_BACKUP_DATA_INVALID')
    const ids = new Set<string>()
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || ids.has(row.id)) {
        throw new Error('LOCAL_BACKUP_DATA_INVALID')
      }
      ids.add(row.id)
      if (key === '@ai_conversations_v2' && !Array.isArray(row.messages)) throw new Error('LOCAL_BACKUP_DATA_INVALID')
      if (Array.isArray(row.messages) && row.messages.some((message: unknown) => !message || typeof message !== 'object' || typeof (message as { content?: unknown }).content !== 'string')) {
        throw new Error('LOCAL_BACKUP_DATA_INVALID')
      }
    }
  }
}

function saveSnapshot(userId: string, automatic: boolean, freshAfterPending = false, overwriteNewer = false): Promise<AutoBackupResult> {
  const inFlight = snapshotSaves.get(userId)
  if (inFlight) {
    return inFlight.work.then(result => automatic || (!inFlight.automatic && !freshAfterPending && !overwriteNewer)
      ? result : saveSnapshot(userId, false, false, overwriteNewer))
  }
  const startedAt = Date.now()
  const work = (async (): Promise<AutoBackupResult> => {
    const prepared = await serializeLocalDataOperation(async isCurrent => {
      if (!isCurrent()) return { result: 'not-synced' as const }
      if (await hasPendingBackupRecovery()) return { result: 'recovery-pending' as const }
      if (await isSignInPending() || (await getLocalDataOwner()) !== userId) return { result: 'not-synced' as const }
      if (automatic) {
        const lastAt = await AsyncStorage.getItem(LAST_BACKUP_AT_KEY)
        const elapsed = lastAt ? Date.now() - Date.parse(lastAt) : NaN
        if (elapsed >= 0 && elapsed < AUTO_BACKUP_INTERVAL_MS) return { result: 'not-due' as const }
      }
      await Promise.all([flushGadgetPersistence(), flushPlanPersistence(), flushConversationPersistence(), readAppearancePreferences()])
      await assertLocalBackupReadable()
      const payload = await buildBackupPayload()
      if (!isCurrent()) return { result: 'not-synced' as const }
      return { payload, isCurrent, reviewedPoint: await AsyncStorage.getItem(RESTORE_POINT_KEY) }
    })
    if ('result' in prepared) return prepared.result!
    // 通信待ちでローカルの復旧・消去を塞がない。タイムアウト後の再試行は同じ送信を待つ。
    if (!prepared.isCurrent()) return 'not-synced'
    return uploadPayload(userId, prepared.payload, startedAt, prepared.isCurrent, prepared.reviewedPoint, overwriteNewer)
  })().catch(error => {
    analytics.error('account_backup_save', error, { duration_ms: Date.now() - startedAt })
    return error instanceof Error && error.message === 'LOCAL_BACKUP_DATA_INVALID' ? 'invalid-data' as const : 'failed' as const
  })
  snapshotSaves.set(userId, { work, automatic })
  void work.finally(() => { if (snapshotSaves.get(userId)?.work === work) snapshotSaves.delete(userId) })
  return work
}

export function runAutoBackupIfDue(userId: string): Promise<AutoBackupResult> {
  return withTimeout(saveSnapshot(userId, true), QUICK_TIMEOUT_MS).catch(() => 'failed' as const)
}

/**
 * ログアウト直前など、24時間の間隔を無視して最新状態を保存する。
 * overwriteNewer は、別の端末の新しい控えがあると知ったうえで、この端末の内容で上書きすると本人が選んだときだけ渡す
 */
export function saveAccountSnapshotNow(
  userId: string,
  { freshAfterPending = false, overwriteNewer = false }: { freshAfterPending?: boolean; overwriteNewer?: boolean } = {},
): Promise<AutoBackupResult> {
  const key = `${userId}:${freshAfterPending}:${overwriteNewer}`
  const existing = manualSnapshotRequests.get(key)
  if (existing) return withTimeout(existing, QUICK_TIMEOUT_MS).catch(() => 'failed' as const)
  const work = saveSnapshot(userId, false, freshAfterPending, overwriteNewer)
  manualSnapshotRequests.set(key, work)
  void work.finally(() => {
    if (manualSnapshotRequests.get(key) === work) manualSnapshotRequests.delete(key)
  }).catch(() => {})
  return withTimeout(work, QUICK_TIMEOUT_MS).catch(() => 'failed' as const)
}

/** 最後にアカウントへ保存できた時刻（設定画面に出す） */
export async function getLastBackupAt(): Promise<string | null> {
  return withTimeout(AsyncStorage.getItem(LAST_BACKUP_AT_KEY), STORAGE_TIMEOUT_MS)
}

export type BackupNotice = Exclude<AutoBackupResult, 'done' | 'not-due' | 'empty'>

/**
 * 自動保存の結果のうち、本人が動かないと保存が再開しないものを1日1回まで知らせる。
 * 黙っていると控えが止まったまま使い続け、端末を失くしたときに止まって以降の記録が消える。
 * 送信の失敗は圏外でも起きるので、前回の成功が古くなったときだけ知らせる
 */
export async function takeBackupNotice(result: AutoBackupResult): Promise<BackupNotice | null> {
  if (result === 'done' || result === 'not-due' || result === 'empty') return null
  const [lastAt, noticedAt] = (await AsyncStorage.multiGet([LAST_BACKUP_AT_KEY, BACKUP_NOTICE_AT_KEY]))
    .map(([, value]) => Date.parse(value ?? ''))
  if (result === 'failed' && !(Date.now() - lastAt > BACKUP_STALE_NOTICE_MS)) return null
  if (Date.now() - noticedAt < BACKUP_NOTICE_INTERVAL_MS) return null
  await AsyncStorage.setItem(BACKUP_NOTICE_AT_KEY, new Date().toISOString())
  return result
}

/** 復元画面用。新しい順に最大7件（サーバー側で刈られている） */
export async function listBackups(): Promise<BackupRow[]> {
  const { data, error } = await withTimeout(Promise.resolve(supabase
    .from('backups')
    .select('id, user_id, schema_version, device_id, device_name, byte_size, created_at')
    .order('created_at', { ascending: false })
    .limit(BACKUP_GENERATIONS)), QUICK_TIMEOUT_MS)
  if (error) throw error
  // 一覧では payload を引かない（7世代ぶん転送すると数MBになる）
  return (data ?? []).map((row) => ({ ...row, payload: null })) as BackupRow[]
}

function isBackupPayload(value: unknown): value is BackupPayload {
  const isRecord = (record: unknown): record is Record<string, unknown> => (
    typeof record === 'object' && record !== null && !Array.isArray(record)
  )
  const isRecoverableList = (items: unknown): boolean => (
    Array.isArray(items) && (items.length === 0 || items.some((item) => (
      isRecord(item) && typeof item.id === 'string' && item.id.length > 0
    )))
  )
  if (!isRecord(value)) return false
  const p = value
  // 壊れた付属データを後から検知すると、本体だけ書き換わった状態で復元が止まる。
  // 新しい版も、古いアプリでは全項目を理解できず欠落させるため受け付けない。
  return (
    p.app === 'MyDesk' && typeof p.version === 'number' && Number.isInteger(p.version) &&
    p.version >= 1 && p.version <= BACKUP_SCHEMA_VERSION &&
    isRecoverableList(p.gadgets) && isRecoverableList(p.folders) && isRecoverableList(p.plans) &&
    (p.aiConversations === undefined || isRecoverableList(p.aiConversations)) &&
    (p.deskHistories === undefined || (isRecord(p.deskHistories) && Object.values(p.deskHistories).every(Array.isArray))) &&
    (p.publishLinks === undefined || (isRecord(p.publishLinks) && Object.values(p.publishLinks).every((link) => typeof link === 'string'))) &&
    (p.firstSetupDraft == null || parseFirstSetupDraft(JSON.stringify(p.firstSetupDraft)) !== null) &&
    (p.viewHistory === undefined || (Array.isArray(p.viewHistory) && p.viewHistory.every(isViewHistoryEntry)))
  )
}

export interface BackupPreview {
  gadgets: number
  plans: number
  conversations: number
  removedItems: number
  repairedItems: number
  missingConversations: boolean
  missingPublishLinks: boolean
  missingAppearance: boolean
  damagedRecoveryPoint?: boolean
}

function inspectPayload(value: unknown): { payload: BackupPayload; preview: BackupPreview } {
  const raw = value as BackupPayload
  if (!raw || raw.app !== 'MyDesk' || !Number.isInteger(raw.version) || raw.version < 1 || raw.version > BACKUP_SCHEMA_VERSION
    || !Array.isArray(raw.gadgets) || !Array.isArray(raw.folders) || !Array.isArray(raw.plans)) {
    throw new Error('backup payload is malformed or unsupported')
  }
  const gadgets = repairStoredGadgets(raw.gadgets)
  const folders = repairStoredFolders(raw.folders)
  const plans = repairStoredPlans(raw.plans)
  const rawConversations = Array.isArray(raw.aiConversations) ? raw.aiConversations : []
  const aiConversations = repairStoredConversations<StoredConversation>(rawConversations)
  const record = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object' && !Array.isArray(data)
  const history = record(raw.deskHistories) ? Object.entries(raw.deskHistories) : []
  const links = record(raw.publishLinks) ? Object.entries(raw.publishLinks) : []
  const deskHistories = raw.deskHistories === undefined ? undefined : Object.fromEntries(history.filter(([, data]) => Array.isArray(data)))
  const rawCategories: unknown[] = Array.isArray(raw.customCategories) ? raw.customCategories : []
  const customCategories = raw.customCategories === undefined
    ? undefined
    : rawCategories.map(normalizeCustomCategory).filter((category): category is CustomCategory => !!category)
  const publishLinks = raw.publishLinks === undefined ? undefined : Object.fromEntries(links.filter(([, link]) => typeof link === 'string')) as Record<string, string>
  const firstSetupDraft = raw.firstSetupDraft == null ? raw.firstSetupDraft : parseFirstSetupDraft(JSON.stringify(raw.firstSetupDraft))
  const rawViews: unknown[] = Array.isArray(raw.viewHistory) ? raw.viewHistory : []
  const validViews = rawViews.filter(isViewHistoryEntry)
  const viewHistory = raw.viewHistory === undefined ? undefined : mergeViewHistory([], validViews)
  const damagedSection = (data: unknown, valid: boolean) => data !== undefined && !valid ? 1 : 0
  const seenConversations = new Set<string>()
  const removedMessages = rawConversations.reduce((count, conversation) => {
    if (!conversation || typeof conversation !== 'object' || !Array.isArray(conversation.messages)) return count
    if (seenConversations.has(conversation.id)) return count
    seenConversations.add(conversation.id)
    const repaired = aiConversations.find(saved => saved.id === conversation.id)
    return count + (repaired ? conversation.messages.length - repaired.messages.length : 0)
  }, 0)
  const removedItems = removedMessages + raw.gadgets.length - gadgets.length + raw.folders.length - folders.length + raw.plans.length - plans.length
    + rawConversations.length - aiConversations.length + history.filter(([, data]) => !Array.isArray(data)).length
    + links.filter(([, link]) => typeof link !== 'string').length
    + damagedSection(raw.aiConversations, Array.isArray(raw.aiConversations))
    + damagedSection(raw.deskHistories, record(raw.deskHistories)) + damagedSection(raw.publishLinks, record(raw.publishLinks))
    + rawCategories.length - (customCategories?.length ?? 0) + damagedSection(raw.customCategories, Array.isArray(raw.customCategories))
    + (raw.firstSetupDraft != null && !firstSetupDraft ? 1 : 0)
    + rawViews.length - validViews.length + damagedSection(raw.viewHistory, Array.isArray(raw.viewHistory))
  const changed = (original: readonly unknown[], repaired: readonly unknown[]) => repaired.filter(item => {
    const id = (item as { id: string }).id
    return JSON.stringify(item) !== JSON.stringify(original.find(row => row && typeof row === 'object' && (row as { id?: unknown }).id === id))
  }).length
  return {
    payload: { ...raw, gadgets, folders, plans, aiConversations, deskHistories, publishLinks, customCategories, firstSetupDraft, viewHistory },
    preview: {
      gadgets: gadgets.length, plans: plans.length, conversations: aiConversations.length, removedItems,
      repairedItems: changed(raw.gadgets, gadgets) + changed(raw.plans, plans) + changed(rawConversations, aiConversations),
      missingConversations: raw.aiConversations === undefined,
      missingPublishLinks: raw.publishLinks === undefined,
      missingAppearance: !parseAppearancePreferences(raw.appearance),
    },
  }
}

async function fetchBackupPayload(backupId: string): Promise<unknown> {
  const { data, error } = await withTimeout(Promise.resolve(supabase.from('backups').select('payload').eq('id', backupId).single()), QUICK_TIMEOUT_MS)
  if (error) throw error
  return data?.payload
}

export async function getBackupPreview(backupId: string): Promise<BackupPreview> {
  const preview = inspectPayload(await fetchBackupPayload(backupId)).preview
  const point = await withTimeout(AsyncStorage.getItem(RESTORE_POINT_KEY), STORAGE_TIMEOUT_MS)
  if (point) {
    try {
      const parsed: unknown = JSON.parse(point)
      preview.damagedRecoveryPoint = !isRestoreSnapshot(parsed) && !isBackupPayload(parsed)
    } catch { preview.damagedRecoveryPoint = true }
  }
  return preview
}

export interface RestoreSummary {
  gadgets: number
  plans: number
}

export async function hasRestorePoint(): Promise<boolean> {
  return (await withTimeout(AsyncStorage.getItem(RESTORE_POINT_KEY), STORAGE_TIMEOUT_MS)) !== null
}

export async function hasPendingBackupRecovery(): Promise<boolean> {
  const entries = await withTimeout(AsyncStorage.multiGet([RESTORE_JOURNAL_KEY, BACKUP_REVIEW_KEY]), STORAGE_TIMEOUT_MS)
  return entries.some(([, value]) => value !== null)
}

async function applySnapshot(snapshot: RestoreSnapshot): Promise<void> {
  // 作成途中の下書きも退避に入っている。控えのメモリを捨て、書き戻したディスクから読み直させる
  await Promise.all([clearGadgetsCache(), clearPlansCache(), flushConversationPersistence(), flushAppearancePersistence(), flushCustomCategoryPersistence(), clearFirstSetupDraftCache(), cancelPendingViewHistoryUpdates()])
  await writeRestoreSnapshot(snapshot)
  await reloadCustomCategoriesFromDisk()
  const appearance = Object.fromEntries(snapshot.entries)
  const preferences = parseAppearancePreferences({ themeMode: appearance.app_theme, accentKey: appearance.app_accent })
  notifyAppearancePreferences({ themeMode: preferences?.themeMode ?? 'system', accentKey: preferences?.accentKey ?? 'orange' })
  await Promise.all([reloadGadgetsFromDisk(), reloadPlansFromDisk()])
}

const recoveryFailures = new Set<() => void>()

function waitForRecovery<T>(work: Promise<T>): Promise<T> {
  return withTimeout(work, PUBLISH_TIMEOUT_MS).catch(error => {
    if (/operation timed out/.test(String(error?.message))) {
      // 実際の保存キューは継続し、半端な復元中の編集は起動の復旧画面で止める。
      recoveryFailures.forEach(listener => listener())
    }
    throw error
  })
}

const recoveryRequests = new Map<string, Promise<unknown>>()

function runRecoveryOnce<T>(key: string, task: () => Promise<T>): Promise<T> {
  const existing = recoveryRequests.get(key) as Promise<T> | undefined
  if (existing) return waitForRecovery(existing)
  const work = task()
  recoveryRequests.set(key, work)
  // 呼び出し元の期限が切れても、実際の保存が終わるまで重ねて実行しない。
  void work.finally(() => {
    if (recoveryRequests.get(key) === work) recoveryRequests.delete(key)
  }).catch(() => {})
  return waitForRecovery(work)
}

export function subscribeBackupRecoveryFailure(listener: () => void): () => void {
  recoveryFailures.add(listener)
  return () => { recoveryFailures.delete(listener) }
}

async function recoverJournal(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(RESTORE_JOURNAL_KEY)
  if (!raw) return false
  try {
    const snapshot: unknown = JSON.parse(raw)
    if (!isRestoreSnapshot(snapshot)) throw new Error('RESTORE_RECOVERY_POINT_INVALID')
    await applySnapshot(snapshot)
    await AsyncStorage.removeItem(RESTORE_JOURNAL_KEY)
    return true
  } catch (error) {
    // 起動後の復元でも、半端な状態で編集を再開させない。
    recoveryFailures.forEach(listener => listener())
    throw error
  }
}

export function recoverInterruptedRestore(): Promise<boolean> {
  return serializeLocalDataOperation(async isCurrent => {
    if (!isCurrent()) return false
    return recoverJournal()
  })
}

async function restoreWithRecovery(
  task: () => Promise<RestoreSummary>,
  isCurrent: () => boolean,
  keepUndoPoint = true,
  replaceDamagedPoint = false,
): Promise<RestoreSummary> {
  await Promise.all([flushGadgetPersistence(), flushPlanPersistence(), flushConversationPersistence(), readAppearancePreferences(), flushCustomCategoryPersistence(), flushViewHistoryPersistence()])
  const snapshot = await captureRestoreSnapshot()
  if (!isCurrent()) throw new Error('ACCOUNT_DATA_CHANGED')
  // 別の世代を試しても最初の退避を残す。途中失敗用の記録は毎回の直前状態にする。
  if (keepUndoPoint) {
    const previousPoint = await AsyncStorage.getItem(RESTORE_POINT_KEY)
    if (previousPoint !== null) {
      let previous: unknown
      try { previous = JSON.parse(previousPoint) } catch { previous = null }
      if (!isRestoreSnapshot(previous) && !isBackupPayload(previous)) {
        if (!replaceDamagedPoint) throw new Error('RESTORE_RECOVERY_POINT_INVALID')
        if (!await AsyncStorage.getItem('@backup_damaged_restore_point')) await AsyncStorage.setItem('@backup_damaged_restore_point', previousPoint)
        await AsyncStorage.setItem(RESTORE_POINT_KEY, JSON.stringify(snapshot))
      }
    } else {
      await AsyncStorage.setItem(RESTORE_POINT_KEY, JSON.stringify(snapshot))
    }
  }
  await AsyncStorage.setItem(BACKUP_REVIEW_KEY, '1')
  const journal = JSON.stringify(snapshot)
  await AsyncStorage.setItem(RESTORE_JOURNAL_KEY, journal)
  if (await AsyncStorage.getItem(RESTORE_JOURNAL_KEY) !== journal) throw new Error('RESTORE_RECOVERY_WRITE_FAILED')
  try {
    const summary = await task()
    if (!isCurrent()) throw new Error('ACCOUNT_DATA_CHANGED')
    await AsyncStorage.removeItem(RESTORE_JOURNAL_KEY)
    return summary
  } catch (error) {
    if (isCurrent()) {
      try { await recoverJournal() } catch (recoveryError) { analytics.error('backup_restore_rollback', recoveryError) }
    }
    throw error
  }
}

export function confirmBackupRecovery(userId: string): Promise<void> {
  return runRecoveryOnce(`confirm:${userId}`, () => serializeLocalDataOperation(async isCurrent => {
    if (!isCurrent()) throw new Error('ACCOUNT_DATA_CHANGED')
    if (await AsyncStorage.getItem(RESTORE_JOURNAL_KEY)) throw new Error('RESTORE_RECOVERY_REQUIRED')
    const owner = await getLocalDataOwner()
    if (owner && owner !== userId) throw new Error('ACCOUNT_DATA_CHANGED')
    await claimLocalData(userId)
    // 新しいクラウド保存が成功するまで、確認済みでも退避は残しておく。
    await AsyncStorage.removeItem(BACKUP_REVIEW_KEY)
  }))
}

/**
 * ペイロードをローカルへ全置換で書き戻す。
 * マージはしない（ID衝突の解決規則を決められないため。詳細は復元ダイアログで明示する）。
 */
async function applyPayload(
  payload: BackupPayload,
  assertCurrent: () => void,
  { discardDrafts = false }: { discardDrafts?: boolean } = {},
): Promise<RestoreSummary> {
  // 書き込む中身はメモリを空にする前に作り切る。下の確認が要素の崩れで落ちても、
  // ここなら端末のデータにもメモリにもまだ何も起きていない。
  // 必須配列があっても、旧形式では要素の項目が欠けるので読み込み時と同じ修復を先に通す。
  // 写真はバックアップに含めないので、ログアウトで消えた・別の端末で撮った写真の
  // パスがそのまま戻ってくる。残すと一覧のサムネイルが空になり、「更新して公開」も
  // PHOTO_FILE_MISSING で止まる。控えを作る時点ではなくここで落とすのは、同じ端末へ
  // 世代を戻すときは実物が残っているため
  const gadgets = repairStoredGadgets(payload.gadgets)
  const folders = repairStoredFolders(payload.folders)
  const conversations = await dropMissingConversationImages(repairStoredConversations<StoredConversation>(payload.aiConversations ?? []))
  const plans = await dropMissingLocalImages(repairStoredPlans(payload.plans))
  assertCurrent()

  // 先にメモリキャッシュを破棄して、進行中の楽観的更新の永続化を打ち切る。
  // これをせずにディスクへ書くと、復元の直前にキューへ入っていた保存が
  // あとから流れてきて、復元した内容を元のデータで上書きしてしまう。
  await Promise.all([clearGadgetsCache(), clearPlansCache(), cancelPendingViewHistoryUpdates()])

  try {
    assertCurrent()
    // 1件が失敗しても他の書き込みは続く。全部を待たないと、次の消去の後へ戻ってくる。
    const writes = await Promise.allSettled([
      saveGadgets(gadgets),
      saveFolders(folders),
      savePlans(plans),
      // 復元するペイロードは旧形式のこともあるので、正規化をやり直させる
      clearGadgetsMigrationFlag(),
    ])
    const failure = writes.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason

    // デスクの歴史は「@desk_history」と「@desk_history:<planId>」に分かれている。
    // 復元後に古い端末の履歴が混ざらないよう、既存キーを消してから書き戻す。
    const allKeys = await AsyncStorage.getAllKeys()
    const staleHistoryKeys = allKeys.filter(isDeskHistoryKey)
    if (staleHistoryKeys.length) await AsyncStorage.multiRemove(staleHistoryKeys)

    const historyEntries = Object.entries(payload.deskHistories ?? {})
      .filter(([key]) => isDeskHistoryKey(key))
      .map(([key, value]) => [key, JSON.stringify(value)] as [string, string])
    if (historyEntries.length) await AsyncStorage.multiSet(historyEntries)

    // 公開の対応表。version 3 以前のバックアップには入っていないので、その場合は
    // 空で置き換える（プランごと入れ替わっているのに、前の端末の対応だけ残るほうが危険）。
    // 復元後も残るデスクは、端末に今ある対応を優先する（importPublishLinks のコメント）
    await importPublishLinks(payload.publishLinks, { keepCurrentFor: plans.map((plan) => plan.id) })

    // AI相談履歴。こちらも全置換。version 4 以前なら空にする
    await replaceConversations(conversations)
    if (payload.viewHistory !== undefined) {
      await AsyncStorage.setItem(VIEW_HISTORY_KEY, JSON.stringify(mergeViewHistory([], payload.viewHistory)))
    }
    assertCurrent()
    await restoreAppearancePreferences(payload.appearance)
    if (payload.customCategories !== undefined) {
      await AsyncStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(payload.customCategories))
    }
    if (discardDrafts) {
      // 作成途中のデスク・商品の割り当ての下書きは、置き換える前のガジェットとデスクを指している。
      // 残すと、古い世代を戻したあとに新しい側の入力や、もう無いガジェットへの割り当てが出てくる。
      // 取り消せば退避（backupRecoveryStore）から戻る
      clearTemplateDetailDraft()
      await clearFirstSetupDraftCache()
      const draftKeys = (await AsyncStorage.getAllKeys())
        .filter(key => key === '@first_setup_draft_v1' || key.startsWith('@product_fill_draft_v1:'))
      if (draftKeys.length) await AsyncStorage.multiRemove(draftKeys)
      await clearFirstSetupDraftCache()
    }
    if (payload.firstSetupDraft !== undefined) {
      await clearFirstSetupDraftCache()
      const draft = payload.firstSetupDraft
      if (draft && (!('planId' in draft) || plans.some((plan) => !plan.isShared && plan.id === draft.planId))) {
        await AsyncStorage.setItem('@first_setup_draft_v1', JSON.stringify(draft))
      } else {
        await AsyncStorage.removeItem('@first_setup_draft_v1')
      }
      await clearFirstSetupDraftCache()
    }
  } finally {
    // 画面が参照しているのはメモリキャッシュなので、ディスクを書いただけでは反映されない。
    // 途中で失敗したときも必ず通す。clear*Cache() は「空が正しい」として保存の停止も解いているので、
    // 合わせ直さずに抜けると空のメモリが正のまま残り、次の1回の編集で端末のデスク・ガジェットが
    // その空で上書きされる。ディスクを読めなければ reload 側が保存を止める
    await Promise.all([reloadGadgetsFromDisk(), reloadPlansFromDisk(), reloadCustomCategoriesFromDisk()])
  }

  return { gadgets: gadgets.length, plans: plans.length }
}

async function fetchLatestPayload(userId: string, signal?: AbortSignal): Promise<{ id: string | null; payload: BackupPayload } | null> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = setTimeout(() => controller.abort(), ACCOUNT_RESTORE_TIMEOUT_MS)
  const query = Promise.resolve(
    supabase
      .from('backups')
      .select('id, payload')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .abortSignal(controller.signal)
      .maybeSingle(),
  )
  const { data, error } = await withTimeout(query, ACCOUNT_RESTORE_TIMEOUT_MS).finally(() => {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  })
  if (error) throw error
  if (!data) return null
  if (!isBackupPayload(data.payload)) throw new Error('ACCOUNT_BACKUP_INVALID')
  return { id: typeof data.id === 'string' ? data.id : null, payload: data.payload }
}

/** ログインせずに作ったデータを、アカウントの控えに足す。同じ ID は端末側を残す */
function mergePayloads(local: BackupPayload, account: BackupPayload): BackupPayload {
  return {
    ...local,
    gadgets: mergeById(account.gadgets, local.gadgets),
    folders: mergeById(account.folders, local.folders),
    plans:   mergeById(account.plans, local.plans),
    deskHistories: account.deskHistories,
    appearance: account.appearance ?? local.appearance,
    publishLinks: { ...account.publishLinks, ...local.publishLinks },
    firstSetupDraft: local.firstSetupDraft ?? account.firstSetupDraft,
    viewHistory: account.viewHistory === undefined && local.viewHistory === undefined
      ? undefined : mergeViewHistory(account.viewHistory ?? [], local.viewHistory ?? []),
    aiConversations: mergeById(account.aiConversations ?? [], local.aiConversations ?? []),
    customCategories: account.customCategories === undefined && local.customCategories === undefined
      ? undefined
      : mergeById(account.customCategories ?? [], local.customCategories ?? []),
  }
}

/**
 * ログイン後に、端末のデータとアカウントの控えを突き合わせる。
 * 端末が空なら控えを戻し、ログインせずに作ったデータがあれば控えと合わせる。
 * 別のアカウントのデータが残っていれば 'foreign' を返し、何も書き換えない。
 * 突き合わせが済むまで、このアカウントへの保存（uploadPayload）は止まる。
 */
export async function reconcileAccountData(userId: string, signal?: AbortSignal): Promise<AccountReconcileResult> {
  return serializeLocalDataOperation(async (isCurrent) => {
    const startedAt = Date.now()
    let action: ReconcileAction | null = null
    const assertCurrent = () => { if (!isCurrent()) throw new Error('ACCOUNT_DATA_CHANGED') }
    try {
      assertCurrent()
      await recoverJournal()
      assertCurrent()
      const [current, owner, signInPending] = await Promise.all([
        buildBackupPayload(), getLocalDataOwner(), isSignInPending(),
      ])
      assertCurrent()
      action = decideReconcileAction({
        userId, owner, signInPending, localEmpty: isPayloadEmpty(current),
      })
      if (action === 'foreign') return 'foreign'
      if (action === 'in-sync' || action === 'adopt') {
        await claimLocalData(userId)
        return 'not-needed'
      }

      const latest = await fetchLatestPayload(userId, signal)
      assertCurrent()
      if (!latest) {
        await claimLocalData(userId)
        return 'none'
      }
      const account = latest.payload

      if (inspectPayload(account).preview.removedItems > 0) {
        await markSignInPending()
        return 'needs-review'
      }
      // 通信を待つ間に作成を始めた場合も、そのデータを捨てずに合わせる
      const latestLocal = await buildBackupPayload()
      assertCurrent()
      const merged = !isPayloadEmpty(latestLocal)
      const summary = await restoreWithRecovery(async () => {
        const restored = await applyPayload(merged ? mergePayloads(latestLocal, account) : account, assertCurrent)
        await restorePublishedPlanLinks(userId, (await loadPlans()).filter((plan) => !plan.isShared).map((plan) => plan.id), assertCurrent)
        assertCurrent()
        await AsyncStorage.setItem(LAST_BACKUP_AT_KEY, new Date().toISOString())
        await markRestoredBackup(latest.id)
        assertCurrent()
        await claimLocalData(userId)
        // 空の端末へ欠けなく戻しただけなら、確かめる相手（復元前の内容）が無い。確認待ちにすると
        // 本人が設定で「再開」を押すまで自動保存が止まり、以後の編集が控えに入らない。
        // 欠けがある控えは上の needs-review で止めている。合わせた場合は端末の内容が混ざるので確認を待つ
        if (!merged) await AsyncStorage.removeItem(BACKUP_REVIEW_KEY)
        return restored
      }, isCurrent, merged)
      assertCurrent()
      analytics.track(EVENTS.BACKUP_RESTORED, {
        restore_kind:   merged ? 'account_merge' : 'account_login',
        schema_version: account.version,
        gadget_count:   summary.gadgets,
        plan_count:     summary.plans,
      })
      return merged ? 'merged' : 'restored'
    } catch (error) {
      if (!isCurrent()) return 'cancelled'
      analytics.error('account_backup_restore', error, { duration_ms: Date.now() - startedAt })
      // 控えを取りに行って失敗したまま空の画面で作り始めると、次の起動では
      // 「本人のデータ」に見えてしまう。やり直しの印を残し、済むまで保存を止めておく
      if (action === 'restore' || action === 'merge') await markSignInPending().catch(() => {})
      if (error instanceof Error && error.message === 'ACCOUNT_BACKUP_INVALID') return 'needs-review'
      return 'failed'
    }
  }, signal)
}

/** 指定した世代を復元する。現在の端末のデータはすべて置き換わる */
export async function restoreBackup(backupId: string, options: { allowPartial?: boolean; replaceDamagedPoint?: boolean } = {}): Promise<RestoreSummary> {
  return runRecoveryOnce(`restore:${backupId}:${!!options.allowPartial}:${!!options.replaceDamagedPoint}`, () => serializeLocalDataOperation(async (isCurrent) => {
    const assertCurrent = () => { if (!isCurrent()) throw new Error('ACCOUNT_DATA_CHANGED') }
    assertCurrent()
    await recoverJournal()
    assertCurrent()
    const raw = await fetchBackupPayload(backupId)
    const inspected = inspectPayload(raw)
    if (!options.allowPartial && (!isBackupPayload(raw) || inspected.preview.removedItems > 0)) {
      throw new Error('backup payload is malformed; partial restore needs confirmation')
    }
    const payload = inspected.payload
    // 古い世代を選んでも、サーバーの最新までは見た扱いにする。選んだ世代を基点にすると、
    // 確認して保存を再開するときに、自分で選ばなかった新しい世代と食い違って止まる
    const head = await fetchBackupHead()
    assertCurrent()
    const summary = await restoreWithRecovery(async () => {
      const restored = await applyPayload(payload, assertCurrent, { discardDrafts: true })
      assertCurrent()
      await AsyncStorage.setItem(LAST_BACKUP_AT_KEY, new Date().toISOString())
      await markRestoredBackup(head?.id ?? backupId)
      return restored
    }, isCurrent, true, options.replaceDamagedPoint)
    analytics.track(EVENTS.BACKUP_RESTORED, {
      restore_kind:   'backup',
      schema_version: payload.version,
      gadget_count:   summary.gadgets,
      plan_count:     summary.plans,
    })
    return summary
  }))
}

/** 直前の復元を取り消して、復元前の状態へ戻す */
export async function undoRestore(): Promise<RestoreSummary | null> {
  return runRecoveryOnce('undo', () => serializeLocalDataOperation(async (isCurrent) => {
    const assertCurrent = () => { if (!isCurrent()) throw new Error('ACCOUNT_DATA_CHANGED') }
    assertCurrent()
    await recoverJournal()
    const raw = await AsyncStorage.getItem(RESTORE_POINT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!isRestoreSnapshot(parsed) && !isBackupPayload(parsed)) throw new Error('RESTORE_RECOVERY_POINT_INVALID')
    const summary = await restoreWithRecovery(async () => {
      if (isRestoreSnapshot(parsed)) {
        await applySnapshot(parsed)
        const count = (key: string) => {
          try {
            const rows: unknown = JSON.parse(parsed.entries.find(([saved]) => saved === key)?.[1] ?? '[]')
            return Array.isArray(rows) ? rows.length : 0
          } catch { return 0 }
        }
        return { gadgets: count('@desk_gadgets'), plans: count('@desk_plans') }
      }
      return applyPayload(parsed, assertCurrent)
    }, isCurrent, false)
    assertCurrent()
    await AsyncStorage.multiRemove([RESTORE_POINT_KEY, BACKUP_REVIEW_KEY])
    analytics.track(EVENTS.BACKUP_RESTORED, { restore_kind: 'undo', gadget_count: summary.gadgets, plan_count: summary.plans })
    return summary
  }))
}
