import AsyncStorage from '@react-native-async-storage/async-storage'
import { randomUUID } from 'expo-crypto'
import { publishedFavoriteGadgetIds } from '../utils/favoriteGadgets'
import * as FileSystem from 'expo-file-system/legacy'
import { Gadget, DeskPlan } from '../types'
import { applyDeskGadgetUsage } from '../utils/deskGadgetUsage'
import { mapSignature } from '../utils/connectionMapLayout'
import { isNetworkError } from '../utils/networkError'
import {
  createDesk,
  updateDesk,
  getDesk,
  getDeskDevices,
  getDeskConnections,
  getDeskPhotos,
  getDeskVersions,
  saveVersion,
  getUserDesks,
  deleteDesk,
  updateDeskPhotoUrl,
} from './desks'
import { uploadDeskImage, deleteDeskImage, deleteDeskImageStrict, deskImageFileUrls, rotateDeskImage, revokeDeskImageUrl } from './storage'
import { analytics, EVENTS } from './analytics'
import { PLAN_LIMITS } from '../constants/plans'
import { PUSH_NOTIFICATIONS_ENABLED } from '../constants/features'
import { assertPublicContentAllowed, collectPublicTexts } from '../utils/publicContentModeration'
import { photoIdentity, publicContentSignature } from '../utils/publicContentSignature'
import { sumGadgetPrices, sumGadgetQuantities } from '../utils/gadgetStats'
import { deskAttributeKeys } from '../utils/deskAttributes'
import { gadgetBrandForPublish } from '../utils/brandIdentity'
import { normalizePlan } from '../utils/portTypeMigration'
import { missingAllSelectedGadgets } from '../utils/planWiring'
import { publishGadgetIssue } from '../utils/publishRequirements'
import { trimAndTruncate } from '../utils/truncateText'
import { CABLE_NAME_MAX_LENGTH } from '../constants/textLimits'
import { replacePlanPhotoUrl } from '../hooks/usePlans'

const PUBLISHED_KEY_PREFIX = '@published_desk_'
const VISIBILITY_KEY_PREFIX = '@published_visibility_'
const SIGNATURE_KEY_PREFIX = '@published_signature_'
const RECOVERY_KEY_PREFIX = '@publication_recovery:'
// withTimeout は呼び出し側の待機だけを打ち切る。元の公開処理は裏で続くため、
// そのまま再試行すると同じデスクの公開が並走する。plan ごとに先行処理へ合流させる
const publishInFlightByPlan = new Map<string, {
  visibility: 'public' | 'unlisted' | undefined
  work: Promise<string>
}>()
const visibilityInFlightByPlan = new Set<string>()
const visibilityInFlightByDesk = new Map<string, { visibility: PublishVisibility; work: Promise<unknown> }>()

function publishedKey(planId: string): string {
  return `${PUBLISHED_KEY_PREFIX}${planId}`
}

function visibilityKey(planId: string): string {
  return `${VISIBILITY_KEY_PREFIX}${planId}`
}

function signatureKey(planId: string): string {
  return `${SIGNATURE_KEY_PREFIX}${planId}`
}

export async function getPublishedDeskId(planId: string): Promise<string | null> {
  return AsyncStorage.getItem(publishedKey(planId))
}

/** 端末の対応表が消えても、サーバーに残る元のプランIDで公開ページと結び直す。 */
export async function restorePublishedPlanLinks(userId: string, planIds: readonly string[], assertCurrent: () => void = () => {}): Promise<void> {
  if (!planIds.length) return
  const desks = await getUserDesks(userId)
  assertCurrent()
  await assertPublicationOwner(userId)
  assertCurrent()
  const owned = desks.filter((desk) => desk.user_id === userId)
  for (const planId of planIds) {
    const storedId = await getPublishedDeskId(planId)
    const desk = owned.find((item) => item.id === storedId) ?? owned.find((item) => {
      const snapshot = item.share_snapshot as { plan?: { id?: unknown } } | null
      return snapshot?.plan?.id === planId
    })
    if (!desk) continue
    await assertPublicationOwner(userId)
    assertCurrent()
    await AsyncStorage.multiSet([[publishedKey(planId), desk.id], [visibilityKey(planId), desk.visibility]])
    if (desk.id !== storedId) await AsyncStorage.removeItem(signatureKey(planId))
  }
}

// ─── 公開の対応表の持ち出し・書き戻し ─────────────────────────────
// 「プラン → 公開デスク」の対応はこの端末の AsyncStorage にしか無い。
// バックアップに載せずに機種変更すると対応が切れ、同じデスクが
// 「公開中（サーバー）」と「未公開（ローカル）」に二重で並ぶうえ、
// もう一度公開すると同じ机の公開ページが2つできる。
//
// 形は「AsyncStorage のキーと値そのまま」にしてある。deskId・公開状態・
// 内容の署名の3種類があり、型を作り直すとどれか1つを載せ忘れたときに
// 気付けないため。

const PUBLISH_KEY_PREFIXES = [PUBLISHED_KEY_PREFIX, VISIBILITY_KEY_PREFIX, SIGNATURE_KEY_PREFIX]

const isPublishKey = (key: string) => PUBLISH_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))

export async function exportPublishLinks(): Promise<Record<string, string>> {
  const keys = (await AsyncStorage.getAllKeys()).filter(isPublishKey)
  if (keys.length === 0) return {}
  const entries = await AsyncStorage.multiGet(keys)
  const out: Record<string, string> = {}
  for (const [key, value] of entries) if (value != null) out[key] = value
  return out
}

/**
 * 全置換で書き戻す。復元は「この端末の状態を丸ごと差し替える」操作なので、マージしない。
 *
 * ただし keepCurrentFor に挙げたデスクは、端末に今ある対応を3キーまとめて残す。公開の対応は
 * デスクの中身ではなくサーバーの状態の写しで、端末に今あるほうが新しい。古い世代の控えで
 * 置き換えると、その世代より後に公開したデスクが「未公開」に戻り、再公開で公開ページが二重にできる
 */
export async function importPublishLinks(
  links: Record<string, string> | undefined,
  { keepCurrentFor = [] }: { keepCurrentFor?: readonly string[] } = {},
): Promise<void> {
  const stale = (await AsyncStorage.getAllKeys()).filter(isPublishKey)
  const current = stale.length ? await AsyncStorage.multiGet(stale) : []
  const linked = new Set(current.filter(([, value]) => value).map(([key]) => key))
  const keptKeys = new Set(keepCurrentFor
    .filter((planId) => linked.has(publishedKey(planId)))
    .flatMap((planId) => [publishedKey(planId), visibilityKey(planId), signatureKey(planId)]))
  const entries = [
    ...Object.entries(links ?? {}).filter(([key]) => isPublishKey(key) && !keptKeys.has(key)),
    ...current.filter((entry): entry is [string, string] => entry[1] !== null && keptKeys.has(entry[0])),
  ]
  if (stale.length) await AsyncStorage.multiRemove(stale)
  if (entries.length) await AsyncStorage.multiSet(entries)
}

/**
 * 公開ニックネームの変更を、profiles と公開済みデスクの owner_name へ反映する。
 * owner_name は公開のたびにコピーされる非正規化値なので、ここを通さないと
 * 名前を変えても・消しても、既に公開したデスクには古い名前が残り続ける。
 *
 * 更新は RPC 側でまとめる（051）。desks を端末から直接書くと、他人のデスクを
 * 弾くのが RLS 頼みになり、名前の検証も端末の実装次第になる。
 */
export async function syncPublicOwnerName(name: string): Promise<void> {
  const { supabase } = await import('../supabase/client')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  const { error } = await supabase.rpc('set_public_owner_name', { p_name: name })
  if (error) throw error
}

/**
 * 公開ページの見え方。unlisted（083）はリンクを知っている人だけが開け、
 * みんなのデスク・検索・公開プロフィールには載らない。
 */
export type PublishVisibility = 'public' | 'unlisted' | 'private'

type PublicationAttempt = {
  ownerId: string
  planId: string | null
  deskId: string
  visibility: PublishVisibility
  attemptId: string
  kind: 'publish' | 'visibility'
}

function recoveryKey(ownerId: string, planId: string | null, deskId: string): string {
  return `${RECOVERY_KEY_PREFIX}${ownerId}:${planId ? `plan:${planId}` : `desk:${deskId}`}`
}

async function currentOwnerId(): Promise<string> {
  const { supabase } = await import('../supabase/client')
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!user) throw new Error('認証が切れました。再ログインしてください。')
  return user.id
}

async function assertPublicationOwner(ownerId: string): Promise<void> {
  if (await currentOwnerId() !== ownerId) throw new Error('PUBLICATION_OWNER_CHANGED')
}

async function readAttempt(key: string): Promise<PublicationAttempt | null> {
  const stored = await AsyncStorage.getItem(key)
  if (!stored) return null
  const value = JSON.parse(stored) as PublicationAttempt
  if (!value.ownerId || !value.deskId || !value.attemptId
    || !['public', 'unlisted', 'private'].includes(value.visibility)
    || !['publish', 'visibility'].includes(value.kind)
    || recoveryKey(value.ownerId, value.planId, value.deskId) !== key) throw new Error('INVALID_PUBLICATION_RECOVERY')
  return value
}

async function saveAttempt(attempt: PublicationAttempt): Promise<void> {
  await AsyncStorage.setItem(recoveryKey(attempt.ownerId, attempt.planId, attempt.deskId), JSON.stringify(attempt))
}

async function clearAttempt(attempt: PublicationAttempt): Promise<void> {
  const key = recoveryKey(attempt.ownerId, attempt.planId, attempt.deskId)
  // 別の試行が始まっている場合は、その復旧記録を消さない。
  if ((await readAttempt(key))?.attemptId === attempt.attemptId) await AsyncStorage.multiRemove([key])
}

function hasAttempt(snapshot: unknown, attemptId: string): boolean {
  return !!snapshot && typeof snapshot === 'object' && 'publicationAttemptId' in snapshot
    && snapshot.publicationAttemptId === attemptId
}

async function updateVisibilityVerified(attempt: PublicationAttempt): Promise<void> {
  try {
    await updateDesk(attempt.deskId, { visibility: attempt.visibility })
  } catch (error) {
    const desk = await getDesk(attempt.deskId).catch(() => null)
    if (!desk || desk.user_id !== attempt.ownerId || desk.visibility !== attempt.visibility) throw error
  }
}

export type PublicationRecovery = {
  deskId: string
  planId: string | null
  visibility: PublishVisibility | null
  status: 'recovered' | 'retry_required' | 'in_flight' | 'unknown'
}

/** 未完了操作を照合する。公開範囲を勝手に広げず、非公開済みの写真失効だけ再開する。 */
export async function recoverPendingPublications(planId?: string): Promise<PublicationRecovery[]> {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(RECOVERY_KEY_PREFIX))
  if (!keys.length) return []
  const ownerId = await currentOwnerId()
  const results: PublicationRecovery[] = []
  for (const key of keys.filter((key) => key.startsWith(`${RECOVERY_KEY_PREFIX}${ownerId}:`))) {
    const attempt = await readAttempt(key)
    if (!attempt || (planId !== undefined && attempt.planId !== planId)) continue
    const result: PublicationRecovery = { deskId: attempt.deskId, planId: attempt.planId, visibility: null, status: 'unknown' }
    if (visibilityInFlightByDesk.has(attempt.deskId)
      || (attempt.planId && (publishInFlightByPlan.has(attempt.planId) || visibilityInFlightByPlan.has(attempt.planId)))) {
      results.push({ ...result, status: 'in_flight' })
      continue
    }
    try {
      await runVisibilityChange(attempt.deskId, attempt.planId, attempt.visibility, async () => {
        const desk = await getDesk(attempt.deskId)
        if (await currentOwnerId() !== ownerId) throw new Error('PUBLICATION_OWNER_CHANGED')
        if (!desk) { result.status = 'retry_required'; return }
        if (desk.user_id !== ownerId) throw new Error('PUBLICATION_OWNER_CHANGED')
        result.visibility = desk.visibility
        if (attempt.planId) {
          await AsyncStorage.setItem(publishedKey(attempt.planId), desk.id)
          await setPublishedVisibility(attempt.planId, desk.visibility)
        }
        if (desk.visibility !== attempt.visibility
          || (attempt.kind === 'publish' && !hasAttempt(desk.share_snapshot, attempt.attemptId))) {
          result.status = 'retry_required'
          return
        }
        if (desk.visibility === 'private') await finishPendingPhotoRevocations(desk.id, attempt.planId, true)
        await clearAttempt(attempt)
        result.status = 'recovered'
      })
    } catch {
      // サーバーが読めないときは、直前の記録と未完了操作を保持する。
    }
    results.push(result)
  }
  return results
}

/**
 * 公開状態をローカルに保持する。
 * 「非公開にしたのに画面を開き直すと再公開される」事故を防ぐため、
 * ユーザーの意思（public / private）はサーバーへ問い合わせずここで判断する。
 * deskId のマッピングは残す（再公開時に同じ公開レコードを使うため）。
 * 限定公開の共有IDは停止時に失効し、再公開時は101のトリガーで新しく発行する。
 */
export async function getPublishedVisibility(planId: string): Promise<PublishVisibility | null> {
  const deskId = await getPublishedDeskId(planId)
  if (!deskId) return null
  const v = await AsyncStorage.getItem(visibilityKey(planId))
  if (v === 'private' || v === 'unlisted') return v
  // 旧バージョンで公開済み（フラグ未保存）のものは公開中として扱う
  return 'public'
}

async function setPublishedVisibility(planId: string, v: PublishVisibility): Promise<void> {
  await AsyncStorage.setItem(visibilityKey(planId), v)
}

/**
 * 公開ページに載っている内容の指紋。
 *
 * plan.updatedAt では使えない。配線図を開いただけでレイアウトの保存が走って
 * 日時が動くので、中身が同じでも「更新あり」になってしまう。
 *
 * 逆に、拾い漏らすと「直したのに公開ページが古いまま」に気づけない。
 * 公開されるのは share_snapshot に入る plan そのものなので、下の publishPlan が
 * 実際に送っている導出（applyDeskGadgetUsage を通した値・配線図・配置）と
 * 同じものを並べる。ここがずれると見逃しと誤検知の両方が起きる。
 */
// 指紋の形式。何を比べるかを変えたらここを上げる。
// 上げないと、旧形式で保存された指紋が新形式と一致せず、公開済みのデスクが
// 一斉に「更新あり」になる（実際には何も変えていないのに）
const SIGNATURE_VERSION = 'v4'

/** 公開する範囲のガジェット。撤去済みのものも履歴として公開される */
function publishedHistoryGadgets(plan: DeskPlan, gadgets: Gadget[]): Gadget[] {
  return gadgets
    .filter((g) => plan.selectedGadgetIds.includes(g.id) || plan.gadgetUsage?.[g.id] != null)
    .map((g) => applyDeskGadgetUsage(plan, g))
}

/**
 * share_snapshot に載せるガジェット。公開と指紋の両方がこれを使う。
 * 共有ページのリンクは運営の商品マスタから再解決し、投稿者の任意URLは公開しない。
 */
function sharedGadgetsOf(historyGadgets: Gadget[]) {
  return historyGadgets.map(({ imageUri: _imageUri, folderIds: _folderIds, url: _url, favorite: _favorite, ...gadget }) => gadget)
}

export function publishSignature(plan: DeskPlan, gadgets: Gadget[]): string {
  // 公開するガジェットをそのまま比べる。以前（v2）は id・名前・価格・日付だけを並べていて、
  // ポート・カテゴリ・型番・商品を直しても「更新あり」が出ず、公開ページが古いまま残った。
  // Gadget には保存のたびに動く項目（updatedAt 等）が無いので、中身が同じなら指紋も同じ
  const history = sharedGadgetsOf(publishedHistoryGadgets(plan, gadgets))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((g) => JSON.stringify(g))
  const map = plan.connectionMap
  return `${SIGNATURE_VERSION}|` + JSON.stringify({
    name: plan.name,
    purposes: [...(plan.purposes ?? [])].sort(),
    // 「その他」の呼び名と絵。share_snapshot ごと公開され、公開ページの
    // 用途チップ（DeskAttributeChips）が plan.otherPurposeIcon を読む。
    // purposes だけ並べていた v3 では、絵を変えても「更新あり」が出なかった
    otherPurposeLabel: plan.otherPurposeLabel ?? null,
    otherPurposeIcon: plan.otherPurposeIcon ?? null,
    ...(plan.otherPurposeColor ? { otherPurposeColor: plan.otherPurposeColor } : {}),
    // ひとことは書いたときだけ並べる。常に並べると形式が変わり SIGNATURE_VERSION を上げることになり、
    // 公開済みの全デスクの「更新あり」が次の公開まで判定できなくなる
    ...(plan.description ? { description: plan.description } : {}),
    // お気に入り（推しの一台）も付けたときだけ並べる（理由はひとことと同じ）
    ...(publishedFavoriteGadgetIds(plan).length > 0 ? { favoriteGadgetIds: publishedFavoriteGadgetIds(plan) } : {}),
    photos: plan.images ?? [],
    selected: [...plan.selectedGadgetIds].sort(),
    history,
    // 線そのものの差分。自動再計算が「保存するかどうか」を決めるのと同じ判定を使う
    // （別の基準にすると、保存されない差で「更新あり」が出続ける）
    connections: mapSignature(map?.connections ?? []),
    // ノードの位置・大きさ・部屋の配置も公開ページに出る（connectionMap ごと publish される）
    nodeOffsets: map?.nodeOffsets ?? {},
    nodeSizes: map?.nodeSizes ?? {},
    placements: plan.placements ?? [],
    // 歴史の配置の手直しは公開ページの歴史再生が読む。layoutSnapshots は位置・大きさを
    // 変えたときにだけ書かれ、その変化は上の項目で拾えるので並べない。
    // アームの割り当ても、変えると作り直した線（connections）に出るので並べない
    ...(map?.historyLayout && Object.keys(map.historyLayout).length > 0 ? { historyLayout: map.historyLayout } : {}),
    outletCount: plan.outletCount ?? null,
  })
}

async function savePublishSignature(plan: DeskPlan, gadgets: Gadget[]): Promise<void> {
  await AsyncStorage.setItem(signatureKey(plan.id), publishSignature(plan, gadgets)).catch(() => {})
}

/** 公開まわりの状態。画面はこれだけ見ればよい */
export type PlanPublishState =
  /** 一度も公開していない */
  | 'none'
  /** 公開を取り消した（リンクは残っているが開けない） */
  | 'private'
  /** 公開中で、公開ページはいまの内容と一致している */
  | 'public'
  /** 公開中だが、公開後に中身が変わっている */
  | 'outdated'
  /** URL限定で公開中で、公開ページはいまの内容と一致している */
  | 'unlisted'
  /**
   * URL限定で公開中だが、公開後に中身が変わっている。
   * outdated と分けるのは、「更新あり」に畳むと公開中か URL限定かが一覧から消えるため
   */
  | 'unlisted_outdated'

/** 公開ページを開ける状態（公開中・URL限定）か */
export function isOpenPublishState(state: PlanPublishState): boolean {
  return state !== 'none' && state !== 'private'
}

/** 公開後に中身が変わっていて、公開ページが古いままか */
export function isOutdatedPublishState(state: PlanPublishState): boolean {
  return state === 'outdated' || state === 'unlisted_outdated'
}

/** 見え方と「古いか」から状態を作る。公開ページを更新・切り替えした直後の表示に使う */
export function publishStateOf(visibility: PublishVisibility | null, outdated = false): PlanPublishState {
  if (visibility == null) return 'none'
  if (visibility === 'private') return 'private'
  if (visibility === 'unlisted') return outdated ? 'unlisted_outdated' : 'unlisted'
  return outdated ? 'outdated' : 'public'
}

function resolvePublishState(
  plan: DeskPlan,
  gadgets: Gadget[],
  deskId: string | null,
  visibility: string | null,
  signature: string | null,
): PlanPublishState {
  if (!deskId) return 'none'
  if (visibility === 'private') return 'private'
  const shown: PublishVisibility = visibility === 'unlisted' ? 'unlisted' : 'public'
  // 指紋が無い（指紋を保存する前のバージョンで公開した）ものと、形式が古くて
  // 比べられないものは公開中として扱う。実際に変わっているかは分からないので、
  // 分からないことを理由に「更新あり」を出さない。次に更新すれば新しい指紋が入る
  if (!signature || !signature.startsWith(`${SIGNATURE_VERSION}|`)) return publishStateOf(shown)
  return publishStateOf(shown, signature !== publishSignature(plan, gadgets))
}

export async function getPlanPublishState(plan: DeskPlan, gadgets: Gadget[]): Promise<PlanPublishState> {
  await recoverPendingPublications(plan.id).catch(() => {})
  const [deskId, visibility, signature] = await Promise.all([
    AsyncStorage.getItem(publishedKey(plan.id)),
    AsyncStorage.getItem(visibilityKey(plan.id)),
    AsyncStorage.getItem(signatureKey(plan.id)),
  ])
  return resolvePublishState(plan, gadgets, deskId, visibility, signature)
}

/**
 * 一覧用にまとめて読む。
 * 1件ずつ getItem すると、デスクの数 × 3 回の読み込みが編集のたびに走る。
 */
export async function getPlanPublishStates(
  plans: DeskPlan[],
  gadgets: Gadget[],
): Promise<Record<string, PlanPublishState>> {
  if (plans.length === 0) return {}
  await recoverPendingPublications().catch(() => {})
  const keys = plans.flatMap((p) => [publishedKey(p.id), visibilityKey(p.id), signatureKey(p.id)])
  const stored = new Map(await AsyncStorage.multiGet(keys))
  const states: Record<string, PlanPublishState> = {}
  for (const plan of plans) {
    states[plan.id] = resolvePublishState(
      plan,
      gadgets,
      stored.get(publishedKey(plan.id)) ?? null,
      stored.get(visibilityKey(plan.id)) ?? null,
      stored.get(signatureKey(plan.id)) ?? null,
    )
  }
  return states
}

function isLocalUri(uri: string): boolean {
  return uri.startsWith('file://') || (uri.startsWith('/') && !uri.startsWith('//'))
}

/**
 * ローカルプランを Supabase に同期して公開する。
 * 初回は新規作成、2回目以降は既存デスクを更新する。
 * @returns Supabase の desk.id
 */
export function publishPlan(
  plan: DeskPlan,
  gadgets: Gadget[],
  _userId: string,
  photos: string[] = [],
  extra: {
    ownerName?: string
    /**
     * 公開ページの見え方。新規公開・再公開では本人が選んだ値を渡す。
     * 渡さない（公開ページの更新）ときは、いまの見え方を保つ
     */
    visibility?: 'public' | 'unlisted'
  } = {},
): Promise<string> {
  if (visibilityInFlightByPlan.has(plan.id)) return Promise.reject(new Error('PUBLISH_IN_PROGRESS'))
  const existing = publishInFlightByPlan.get(plan.id)
  if (existing) {
    // 先行処理が「公開」なのに、タイムアウト後の別画面で「URL限定」を
    // 選んだ場合は合流させない。合流するとサーバーは公開、端末表示はURL限定に分裂する
    if (existing.visibility !== extra.visibility) return Promise.reject(new Error('PUBLISH_IN_PROGRESS'))
    return existing.work
  }
  const work = publishPlanOnce(plan, gadgets, _userId, photos, extra)
  publishInFlightByPlan.set(plan.id, { visibility: extra.visibility, work })
  void work.finally(() => {
    if (publishInFlightByPlan.get(plan.id)?.work === work) publishInFlightByPlan.delete(plan.id)
  }).catch(() => {})
  return work
}

async function publishPlanOnce(
  plan: DeskPlan,
  gadgets: Gadget[],
  _userId: string,
  photos: string[] = [],
  extra: {
    ownerName?: string
    visibility?: 'public' | 'unlisted'
  } = {},
): Promise<string> {
  // ガジェットを読めていないまま進むと、公開ページの機材が0台で上書きされる
  if (missingAllSelectedGadgets(plan, gadgets)) throw new Error('GADGETS_NOT_LOADED')
  // 画面側でも止めているが、一覧からの公開ページの更新など、確認を挟まない経路がある
  if (publishGadgetIssue(plan, gadgets)) throw new Error('NO_PUBLISHABLE_GADGETS')
  const { supabase } = await import('../supabase/client')
  const startedAt = Date.now()

  // JWT を必ずサーバーサイドで検証し、常に最新の auth.uid() と一致する userId を使用する
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) throw new Error('認証が切れました。再ログインしてください。')
  const userId = authUser.id

  const { data: profileRow, error: profileError } = await supabase
    .from('profiles')
    .select('display_name, username, public_tag, tier')
    .eq('id', userId)
    .single()
  // 通信できずに読めなかっただけの場合は、名前が無いものとして公開してはいけない
  // （表示名を設定している人の公開ページから、名前だけが消えることになる）。
  // 行が無い等はこれまで通りフォールバックで進める
  if (profileError && isNetworkError(profileError)) throw profileError
  const safePublicName = (value: string | null | undefined) => {
    const name = value?.trim() ?? ''
    return name.includes('@') ? '' : name
  }
  // 呼び出し側が空文字を渡した場合は「未設定」を尊重する。|| でプロフィールへ
  // フォールバックすると、本人が公開名を消してもOAuth名などが再び公開される。
  const ownerName = extra.ownerName !== undefined
    ? safePublicName(extra.ownerName)
    : safePublicName(profileRow?.display_name) || safePublicName(profileRow?.username)
  // 060 から @ID は本人の指定。綴りを大文字へ揃えない
  const ownerTag = profileRow?.public_tag?.trim() ?? ''

  const historyGadgets = publishedHistoryGadgets(plan, gadgets)
  const selectedGadgets = historyGadgets.filter((g) => plan.selectedGadgetIds.includes(g.id))
  const totalPrice = sumGadgetPrices(selectedGadgets)
  const sharedGadgets = sharedGadgetsOf(historyGadgets)
  const shareSnapshot = {
    version: 3,
    // このスナップショットを作った時刻。継続中の利用期間を分析するとき、
    // 「いつまで観測できていたか」がこれで確定する。desks.updated_at は
    // 非公開化・再公開でも動くので最終 publish 日には使えず、
    // plan.updatedAt は編集していなければ据え置かれるため、どちらも代用にならない。
    snapshotCapturedAt: new Date().toISOString(),
    // お気に入りは、デスクから外した機材の印（戻したとき用に端末には残す）を落として送る
    plan: { ...normalizePlan(plan), images: undefined, favoriteGadgetIds: publishedFavoriteGadgetIds(plan) },
    gadgets: sharedGadgets,
  }

  // 検査する文面は、送る物そのものから拾う。欄を並べる書き方に戻さないこと。
  // 公開する中身は上の sharedGadgets が「落とすものだけ挙げる」方式で決めており、
  // 検査だけを列挙にすると欄を足すたびに素通りが増える（型番・CPU・ゲーム名・
  // 置き場所ラベル、デスクから外して履歴だけ残った機材の名前が実際に漏れていた）。
  // ownerName は snapshot に入らないので別に渡す
  assertPublicContentAllowed({
    title: plan.name,
    ownerName,
    freeTexts: collectPublicTexts(shareSnapshot),
  })

  // 既存デスク ID を確認し、現在のユーザーが所有している場合のみ更新、
  // 存在しない・所有権が異なる（別アカウントで公開されたIDが残っている等）場合は再作成する。
  // updateDesk() の例外発生に頼らず明示的に所有権を検証することで、
  // RLS違反（devices/connections/desk_photos への INSERT拒否）を未然に防ぐ。
  const priorAttempt = await readAttempt(recoveryKey(userId, plan.id, ''))
  let storedId = await getPublishedDeskId(plan.id)
  if (!storedId && !priorAttempt) {
    await restorePublishedPlanLinks(userId, [plan.id])
    storedId = await getPublishedDeskId(plan.id)
  }
  if (!storedId && priorAttempt) {
    const recoveredDesk = await getDesk(priorAttempt.deskId)
    if (recoveredDesk?.user_id === userId) {
      storedId = recoveredDesk.id
      await AsyncStorage.setItem(publishedKey(plan.id), storedId)
      await setPublishedVisibility(plan.id, recoveredDesk.visibility)
    }
  }
  const attempt: PublicationAttempt = {
    ownerId: userId, planId: plan.id, deskId: storedId ?? priorAttempt?.deskId ?? randomUUID(),
    visibility: extra.visibility ?? 'public', attemptId: randomUUID(), kind: 'publish',
  }
  // 既定を 'public' にすると、URL限定のデスクの公開ページを更新しただけで
  // みんなのデスクと検索に載ってしまう
  let previousVisibility = await getPublishedVisibility(plan.id)
  const deskId: string = await (async () => {
    if (storedId) {
      // 通信の失敗は投げ直す。「無い」と同じに扱うと紐付けを消して作り直し、
      // 元の公開ページを残したまま同じデスクの公開ページがもう1つできる
      const existingDesk = await getDesk(storedId)
      if (existingDesk && existingDesk.user_id === userId) {
        if (visibilityInFlightByDesk.has(storedId)) throw new Error('PUBLISH_IN_PROGRESS')
        previousVisibility = existingDesk.visibility
        await assertPublicationOwner(userId)
        await setPublishedVisibility(plan.id, previousVisibility)
        if (extra.visibility === undefined && previousVisibility === 'private') throw new Error('DESK_NOT_PUBLIC')
        // ここでは何も書かない。公開ページは share_snapshot をそのまま描くので、
        // この時点で新しいスナップショットを入れると、写真と devices を置き換える前に
        // 「新しい構成なのに写真は古い」ページが閲覧者に見えてしまう
        // （更新の途中で通信が切れると、その状態のまま残る）。
        // 書き込みは中身を全部入れ替えたあとの最後の updateDesk にまとめる。
        return storedId
      }
      // storedId のデスクが存在しないか所有権が異なる → ローカルの紐付けをリセットして再作成
      await AsyncStorage.multiRemove([publishedKey(plan.id), visibilityKey(plan.id), signatureKey(plan.id)])
      attempt.deskId = randomUUID()
    }
    const insertDesk = async () => {
      await saveAttempt(attempt)
      return createDesk(userId, {
        id: attempt.deskId,
        title:      plan.name,
        visibility: 'private',
        purposes:   plan.purposes ?? [],
        owner_name: ownerName,
        owner_tag:  ownerTag,
        share_snapshot: shareSnapshot,
      })
    }
    try {
      return (await insertDesk()).id
    } catch (error) {
      // 前回の試行で作った行が、その後に消されていた（103 で消えたデスクの ID は二度と使えない）。
      // 同じ ID を握ったままだと公開がずっと失敗するので、新しい ID で作り直す
      if (!(error instanceof Error) || error.message !== 'DESK_ID_RETIRED') throw error
      attempt.deskId = randomUUID()
      return (await insertDesk()).id
    }
  })()
  const visibility = extra.visibility ?? (previousVisibility === 'unlisted' ? 'unlisted' : 'public')
  attempt.deskId = deskId
  attempt.visibility = visibility
  await saveAttempt(attempt)

  // 新規行はまだ private のうちに端末と紐付ける。写真アップロード中に
  // 呼び出し側がタイムアウトしても、次の試行が別の公開行を作らず同じ行を引き継げる
  if (deskId !== storedId) {
    await assertPublicationOwner(userId)
    await AsyncStorage.setItem(publishedKey(plan.id), deskId)
    await setPublishedVisibility(plan.id, 'private')
  }

  const connections = plan.connectionMap?.connections ?? plan.wiringResult?.connections ?? []
  const selectedIds = new Set(selectedGadgets.map((g) => g.id))
  const contentConnections = connections
    .filter((c) => selectedIds.has(c.fromGadgetId) && selectedIds.has(c.toGadgetId))
    .map((c) => {
      const choice = 'cableChoice' in c ? c.cableChoice : undefined
      // 選んだ商品名は DB の CHECK（076 の cable_name 1〜120）に収めて送る。超えると connections の
      // 挿入が弾かれ、機材・写真を含む公開全体が線1本の名前で失敗する。整えて空になる名前は
      // つなぎ方ごと送らない（cable_choice だけ残すと、公開ページで名前の無い商品になる）
      const productName = choice?.kind === 'product' ? trimAndTruncate(choice.name, CABLE_NAME_MAX_LENGTH) : ''
      const sentChoice = choice?.kind === 'product' && !productName ? undefined : choice
      return {
        from_local_id: c.fromGadgetId,
        to_local_id: c.toGadgetId,
        cable_type: c.cableType,
        // 2in1 の枝は共有先でも1本に束ねて描く。DB 側も 64 文字で切るが、送る側でも合わせる。
        // 配線図を一度も開かず wiringResult から公開する場合は枝の宣言そのものが無い
        branch_group_id: 'branchGroupId' in c ? c.branchGroupId?.slice(0, 64) : undefined,
        // 077。同じ組み合わせを何本で繋いでいるか（ステレオの L/R・デュアル電源）。
        // 1本のときは送らない（DB 側の既定値が 1）
        cable_count: 'count' in c && (c.count ?? 1) > 1 ? c.count : undefined,
        // 076。つなぎ方（本体付属 / 選んだ商品）。申告した線にだけ入る。
        // 出さないなら持つ意味が無い列なので、公開ページの表示を消すときは列ごと消す
        cable_choice: sentChoice?.kind,
        cable_name: sentChoice?.kind === 'product' ? productName : undefined,
        cable_product_id: sentChoice?.kind === 'product' ? sentChoice.productId : undefined,
      }
    })

  // devices/connections/photos を単一トランザクションのRPCでまとめて置換する。
  // 別々のRPC呼び出しに分けると、片方だけ成功した中途半端な状態が
  // 公開ページの閲覧者に見えてしまう（TOCTOU）ため注意。
  // 公開する機材。指紋（061）にも同じ配列を使う。公開ページに出ているものと
  // 判定材料がずれると、変えていないのに「機材更新」が出る／その逆になる
  const publishedDevices = selectedGadgets.map((gadget) => ({
    local_id:     gadget.id,
    name:         gadget.name,
    category:     gadget.category,
    price:        gadget.price ?? null,
    ports:        gadget.ports,
    purchased_at: gadget.purchasedAt ?? null,
    removed_at:   gadget.removedAt ?? null,
    // 073。機材から公開デスクを辿るのに使う。予測変換で商品を選んだ機材にだけ入り、
    // 手入力の機材は null のまま（名前での突き合わせは別物が混ざるのでやらない）
    product_id:   gadget.productId ?? null,
    // 075。検索は devices の行しか見ないので、名前から引いたブランドをここで焼く。
    // 焼かないと「ロジクール」でも「Logitech」でも公開デスクに当たらない
    ...gadgetBrandForPublish(gadget.name),
  }))

  // アップロードの前に、ローカルの実ファイルが揃っているかをまとめて見る。
  //
  // 1枚でも読めないと uploadDeskImage の Image.getSize が reject して公開全体が
  // 巻き戻る。それ自体は正しいが、そのまま投げると ja では「エラーが発生しました」
  // だけが出て、原因の写真が分からず何度でも同じところで失敗し続ける。
  // 黙って飛ばすのは選ばない（公開された枚数が減ったことに気づけない）。
  //
  // 起きるのは、公開処理中に別画面で写真を削除した場合（publishPlan は呼び出し
  // 時点の配列を握っている）と、端末側でファイルが失われた場合
  const missingPhotos: string[] = []
  for (const uri of photos) {
    if (!isLocalUri(uri)) continue
    const info = await FileSystem.getInfoAsync(uri).catch(() => null)
    if (!info?.exists) missingPhotos.push(uri)
  }
  if (missingPhotos.length > 0) {
    throw new Error(`PHOTO_FILE_MISSING:${missingPhotos.length}`)
  }

  const rotatedPhotoUrls = await finishPendingPhotoRevocations(deskId, plan.id)
  const existingPhotos = await getDeskPhotos(deskId)
  const existingUrls = new Set(existingPhotos.map((p) => p.image_url))
  const uploadedUrls: string[] = []
  const photoUrls: string[] = []
  // 指紋に渡す「写真の同一性」。photoUrls とは別に持つ必要がある。
  // ローカルの写真は公開のたびに再アップロードされて URL が変わるので、
  // URL を指紋の材料にすると何も変えていない再公開が「機材更新」になる
  const photoKeys: string[] = []
  try {
    for (const sourceUri of photos) {
      const uri = rotatedPhotoUrls.get(sourceUri) ?? sourceUri
      if (!isLocalUri(uri)) {
        // リモートURLは「このデスク自身の既存写真」だけ再利用する。
        // 共有デスクを取り込んだプランを複製すると他人の写真URLが plan.images に
        // 残りうるため、無条件に通すと他人のストレージを自分の公開ページから
        // 直リンクすることになる（相手が消せば自分のページも壊れる）
        if (existingUrls.has(uri)) {
          photoUrls.push(uri)
          photoKeys.push(photoIdentity(sourceUri))
        }
        continue
      }
      const result = await uploadDeskImage(userId, deskId, uri)
      uploadedUrls.push(result.fullUrl)
      photoUrls.push(result.fullUrl)
      // identity はアップロード後の URL ではなく、手元の写真のほう
      photoKeys.push(photoIdentity(uri))
    }
    const { error: snapshotError } = await supabase.rpc('publish_desk_snapshot', {
      p_desk_id: deskId,
      p_devices: publishedDevices,
      p_connections: contentConnections,
      p_image_urls: photoUrls,
    })
    if (snapshotError) throw snapshotError
  } catch (error) {
    // RPCの応答だけ失われた場合、保存済みの写真を消してはいけない。
    const savedPhotos = await getDeskPhotos(deskId).catch(() => null)
    if (savedPhotos) {
      const savedUrls = new Set(savedPhotos.map((photo) => photo.image_url))
      await Promise.all(uploadedUrls.filter((url) => !savedUrls.has(url)).flatMap(deskImageFileUrls).map(deleteDeskImage))
    }
    throw error
  }
  // 今回の公開でも使い続ける写真は消さない。差し替えられた（＝もう参照されない）ものだけ消す。
  // ここで無条件に消すと、再利用したリモートURLの実体を消してしまい、
  // desk_photos に行はあるのにファイルが無い＝公開ページの写真が壊れた状態になる
  try {
    await updateDesk(deskId, {
      title: plan.name,
      // 公開ページのひとこと・共有リンクのプレビュー（worker）・検索がこの列を読む。
      // 消したときに前の文が残らないよう、空は null で上書きする
      description: plan.description?.trim() || null,
      total_price: totalPrice,
      visibility,
      purposes: plan.purposes ?? [],
      owner_name: ownerName,
      owner_tag: ownerTag,
      // 公開プロフィールは devices を引かないので、構成から導く属性（OS・PCの形態）は
      // 閲覧側で計算できない。公開のたびにここで焼いて持たせる（058）。
      // 母数は実際に公開した機材と揃える（撤去済みを含めると使っていない OS が残る）
      attributes: deskAttributeKeys(plan, selectedGadgets),
      // 機材と写真の指紋（061）。閲覧側に出す「機材更新」の日時は、
      // これが前回と変わったときにだけサーバーのトリガが進める
      content_signature: publicContentSignature(publishedDevices, photoKeys),
      share_snapshot: { ...shareSnapshot, publicationAttemptId: attempt.attemptId },
      // 099。desks.created_at は初回公開の日時なので、作った日は別に送る。
      // 壊れた保存データの修復で '' になったデスクは、偽の日付を入れず null にする
      desk_created_at: Number.isNaN(Date.parse(plan.createdAt)) ? null : plan.createdAt,
    })
  } catch (error) {
    // ここまでで desks の行・devices・写真は出来上がっている。紐付けを残さずに投げると、
    // 次の公開で別の行が作られ、前の行と写真が誰からも辿れないまま残る。
    // 紐付けを残し、失敗後もサーバーの公開状態に表示を合わせる。
    await assertPublicationOwner(userId)
    await AsyncStorage.setItem(publishedKey(plan.id), deskId).catch(() => {})
    const serverDesk = await getDesk(deskId).catch(() => null)
    if (serverDesk?.user_id === userId) await setPublishedVisibility(plan.id, serverDesk.visibility).catch(() => {})
    if (!serverDesk || serverDesk.user_id !== userId || serverDesk.visibility !== visibility
      || !hasAttempt(serverDesk.share_snapshot, attempt.attemptId)) throw error
  }
  await assertPublicationOwner(userId)
  await AsyncStorage.setItem(publishedKey(plan.id), deskId)
  await setPublishedVisibility(plan.id, visibility)
  // いま公開した内容を控える。次にこのデスクを編集したとき「更新あり」を出すための基準
  await savePublishSignature(plan, gadgets)
  await clearAttempt(attempt).catch(() => {})
  const keptUrls = new Set(photoUrls)
  await Promise.all(existingPhotos.filter((photo) => !keptUrls.has(photo.image_url))
    .flatMap((photo) => deskImageFileUrls(photo.image_url).map(deleteDeskImage)))
  // フォロワーへの通知（085）。送るかどうか（中身が変わったか・間隔）はサーバーが決めるので、
  // ここでは公開のたびに頼むだけ。失敗しても公開そのものは成立しているので待たない
  if (PUSH_NOTIFICATIONS_ENABLED && visibility === 'public') {
    void supabase.functions.invoke('notify-followers', { body: { deskId } }).catch(() => {})
  }
  analytics.track(EVENTS.VISIBILITY_CHANGED, {
    visibility,
    is_first_publish: previousVisibility == null,
    device_count:     sumGadgetQuantities(selectedGadgets),
    photo_count:      photoUrls.length,
    total_price:      totalPrice,
    duration_ms:      Date.now() - startedAt,
  })

  // ─── 成長記録（desk_versions）─────────────────────────────────
  // 公開・更新のたびに記録し、シェアカードの成長率などに使う。
  // 総額・台数が前回の記録から変わっていないときは追加しない。
  // 失敗しても公開自体は成功として扱い、待ち時間も増やさない（fire-and-forget）。
  //
  // プランごとの保存件数上限（PLAN_LIMITS.maxGrowthRecords）を超えたら記録しない。
  // 判定はクライアントの課金UI設定ではなくサーバーの profiles.tier を使う。
  // 上限が無いと、構成を変えて公開し直すたびに desk_versions が無制限に増える。
  const maxVersions = PLAN_LIMITS[profileRow?.tier === 'pro' ? 'pro' : 'free'].maxGrowthRecords
  void (async () => {
    const [createdDevices, savedConnections] = await Promise.all([getDeskDevices(deskId), getDeskConnections(deskId)])
    const versions = await getDeskVersions(deskId)
    if (maxVersions !== -1 && versions.length >= maxVersions) return
    const latest = versions[0]
    if (latest
      && latest.snapshot.total_price === totalPrice
      && latest.snapshot.devices?.length === createdDevices.length) return
    await saveVersion(deskId, `v${versions.length + 1}`, {
      devices:     createdDevices,
      connections: savedConnections,
      total_price: totalPrice,
    })
    analytics.track(EVENTS.GROWTH_RECORDED, {
      version_index: versions.length + 1,
      device_count:  createdDevices.length,
      total_price:   totalPrice,
      // 前回記録からの差分。デスクが育っているのか作り直されているのかはここで分かる
      price_delta:   latest ? totalPrice - (latest.snapshot.total_price ?? 0) : null,
      device_delta:  latest ? createdDevices.length - (latest.snapshot.devices?.length ?? 0) : null,
    })
  })().catch(() => {})

  return deskId
}

/**
 * 公開中に出回った写真URLを失効させる。
 *
 * desk-images は public バケットで、/object/public/... は RLS を通らない。
 * visibility を private にしても URL を知っている人は取得し続けられるため、
 * 公開を取り消した時点でパスを振り直す。
 * 未失効URLはDBに残し、通信断・別端末からの再試行でも辿れるようにする。
 */
async function revokePublishedPhotoUrls(deskId: string, planId: string | null): Promise<Map<string, string>> {
  const photos = await getDeskPhotos(deskId)
  const replacements = new Map<string, string>()
  for (const photo of photos) {
    const newUrl = await revokePhotoUrl(photo, planId)
    replacements.set(photo.image_url, newUrl)
    if (photo.pending_revocation_url) replacements.set(photo.pending_revocation_url, newUrl)
  }
  return replacements
}

async function revokePhotoUrl(photo: Awaited<ReturnType<typeof getDeskPhotos>>[number], planId: string | null): Promise<string> {
  if (photo.pending_revocation_url && photo.pending_revocation_url !== photo.image_url) {
    if (planId) await replacePlanPhotoUrl(planId, photo.pending_revocation_url, photo.image_url)
    await revokeDeskImageUrl(photo.pending_revocation_url)
    await updateDeskPhotoUrl(photo.id, photo.image_url, null, photo.image_url)
    return photo.image_url
  }
  if (!photo.pending_revocation_url) await updateDeskPhotoUrl(photo.id, photo.image_url, photo.image_url, photo.image_url)
  const rotated = await rotateDeskImage(photo.image_url, async (newUrl) => {
    await updateDeskPhotoUrl(photo.id, newUrl, photo.image_url, photo.image_url)
    if (planId) await replacePlanPhotoUrl(planId, photo.image_url, newUrl)
  })
  await updateDeskPhotoUrl(photo.id, rotated, null, rotated)
  return rotated
}

async function finishPendingPhotoRevocations(deskId: string, planId: string | null, requireRevocationColumn = false): Promise<Map<string, string>> {
  const photos = await getDeskPhotos(deskId)
  if (requireRevocationColumn && photos.some((photo) => photo.pending_revocation_url === undefined)) {
    throw new Error('PHOTO_REVOCATION_INCOMPLETE')
  }
  const replacements = new Map<string, string>()
  for (const photo of photos) {
    if (!photo.pending_revocation_url) continue
    replacements.set(photo.pending_revocation_url, await revokePhotoUrl(photo, planId))
  }
  return replacements
}

function runVisibilityChange<T>(deskId: string, planId: string | null, visibility: PublishVisibility, work: () => Promise<T>): Promise<T> {
  const existing = visibilityInFlightByDesk.get(deskId)
  if (existing) return existing.visibility === visibility ? existing.work as Promise<T> : Promise.reject(new Error('PUBLISH_IN_PROGRESS'))
  if (planId && (publishInFlightByPlan.has(planId) || visibilityInFlightByPlan.has(planId))) {
    return Promise.reject(new Error('PUBLISH_IN_PROGRESS'))
  }
  if (planId) visibilityInFlightByPlan.add(planId)
  const promise = Promise.resolve().then(work)
  visibilityInFlightByDesk.set(deskId, { visibility, work: promise })
  void promise.finally(() => {
    visibilityInFlightByDesk.delete(deskId)
    if (planId) visibilityInFlightByPlan.delete(planId)
  }).catch(() => {})
  return promise
}

export function isPhotoRevocationIncomplete(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'message' in error && error.message === 'PHOTO_REVOCATION_INCOMPLETE'
}

/**
 * planId → deskId の対応表を逆から引く。
 * 機種変更・再インストールでこの対応表を失うと、サーバー上のデスクは公開のままなのに
 * ローカルからは辿れなくなる。サーバー側から取り消すときに、対応するプランが
 * この端末にも残っているかを調べるために使う。
 */
async function findPlanIdByDeskId(deskId: string): Promise<string | null> {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PUBLISHED_KEY_PREFIX))
  if (keys.length === 0) return null
  const entries = await AsyncStorage.multiGet(keys)
  const hit = entries.find(([, value]) => value === deskId)
  return hit ? hit[0].slice(PUBLISHED_KEY_PREFIX.length) : null
}

/**
 * URL限定のリンクを再発行する。共有IDを変えるだけでは、旧リンクで開いた人が
 * 写真のURL（public バケットで RLS を通らない）を持ち続けるので、非公開化と同じく写真のパスも振り直す。
 * 写真の途中で失敗しても共有IDは変わっている。もう一度呼べば残りの写真も振り直す
 */
export async function reissueUnlistedLink(
  deskId: string,
  ownerTag?: string | null,
  knownPlanId?: string | null,
): Promise<{ url: string; photoUrls: ReadonlyMap<string, string> }> {
  if (visibilityInFlightByDesk.has(deskId)) throw new Error('PUBLISH_IN_PROGRESS')
  const planId = knownPlanId ?? await findPlanIdByDeskId(deskId).catch(() => null)
  if (planId && (publishInFlightByPlan.has(planId) || visibilityInFlightByPlan.has(planId))) throw new Error('PUBLISH_IN_PROGRESS')
  const recovered = await finishPendingPhotoRevocations(deskId, planId, true)
  const { reissueUnlistedDeskUrl } = await import('./deskShareLinks')
  const url = await reissueUnlistedDeskUrl(deskId, ownerTag)
  try {
    const photoUrls = await revokePublishedPhotoUrls(deskId, planId)
    for (const [oldUrl, recoveredUrl] of recovered) photoUrls.set(oldUrl, photoUrls.get(recoveredUrl) ?? recoveredUrl)
    return { url, photoUrls }
  } catch (cause) {
    throw Object.assign(new Error('LINK_REISSUED_PHOTOS_PENDING'), { cause })
  }
}

/**
 * deskId を直接指定して公開を取り消す。
 * ローカルの対応表を失った端末からでも公開を止められるようにするための経路。
 * 対応するプランがこの端末にもあるなら、その公開状態も private にする
 * （残したままだと次にそのデスクを開いたときに再公開されてしまう）。
 */
export async function unpublishDesk(deskId: string, knownPlanId?: string | null): Promise<ReadonlyMap<string, string>> {
  const planId = knownPlanId ?? await findPlanIdByDeskId(deskId).catch(() => null)
  return runVisibilityChange(deskId, planId, 'private', async () => {
    const ownerId = await currentOwnerId()
    const desk = await getDesk(deskId)
    if (!desk || desk.user_id !== ownerId) throw new Error('PUBLICATION_OWNER_CHANGED')
    const attempt: PublicationAttempt = { ownerId, planId, deskId, visibility: 'private', attemptId: randomUUID(), kind: 'visibility' }
    await saveAttempt(attempt)
    await updateVisibilityVerified(attempt)
    await assertPublicationOwner(ownerId)
    // DBでの公開停止を、写真の処理が失敗した場合も端末へ反映する。
    if (planId) await setPublishedVisibility(planId, 'private').catch(() => {})
    analytics.track(EVENTS.VISIBILITY_CHANGED, { visibility: 'private' })
    let replacements: Map<string, string>
    try {
      replacements = await revokePublishedPhotoUrls(deskId, planId)
    } catch (cause) {
      throw Object.assign(new Error('PHOTO_REVOCATION_INCOMPLETE'), { cause })
    }
    await assertPublicationOwner(ownerId)
    if (planId) await setPublishedVisibility(planId, 'private')
    await clearAttempt(attempt).catch(() => {})
    return replacements
  })
}

/** 公開を取り消す（visibility を private に変更）。直前に公開中だったかを返す。 */
export async function unpublishPlan(
  planId: string,
  onUnpublished?: (previousVisibility: PublishVisibility, photoUrls: ReadonlyMap<string, string>) => void,
): Promise<boolean> {
  const deskId = await getPublishedDeskId(planId)
  if (!deskId) return false
  const { supabase } = await import('../supabase/client')
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('公開済みデスクを削除するにはログインが必要です。')
  const desk = await getDesk(deskId)
  if (!desk) {
    await AsyncStorage.multiRemove([publishedKey(planId), visibilityKey(planId), signatureKey(planId)])
    return false
  }
  const wasPublic = desk.visibility !== 'private'
  const replacements = await unpublishDesk(deskId, planId)
  onUnpublished?.(desk.visibility, replacements)
  return wasPublic
}

/** 再公開する（visibility を public / unlisted に戻す） */
export async function republishPlan(planId: string, visibility: 'public' | 'unlisted' = 'public'): Promise<void> {
  await setPlanVisibility(planId, visibility)
}

export async function setDeskVisibility(deskId: string, visibility: 'public' | 'unlisted', knownPlanId?: string | null): Promise<void> {
  const planId = knownPlanId ?? await findPlanIdByDeskId(deskId).catch(() => null)
  return runVisibilityChange(deskId, planId, visibility, async () => {
    const ownerId = await currentOwnerId()
    const desk = await getDesk(deskId)
    if (!desk || desk.user_id !== ownerId) throw new Error('PUBLICATION_OWNER_CHANGED')
    const attempt: PublicationAttempt = { ownerId, planId, deskId, visibility, attemptId: randomUUID(), kind: 'visibility' }
    await saveAttempt(attempt)
    await finishPendingPhotoRevocations(deskId, planId)
    await updateVisibilityVerified(attempt)
    await assertPublicationOwner(ownerId)
    if (planId) await setPublishedVisibility(planId, visibility)
    await clearAttempt(attempt).catch(() => {})
    analytics.track(EVENTS.VISIBILITY_CHANGED, { visibility, is_switch: true })
  })
}

/**
 * 公開中のデスクを「公開」と「URL限定」の間で切り替える。中身は送り直さない。
 * URL は変わらないので、共有済みのリンクはどちらでも開ける。
 * 写真の URL も振り直さない（URL限定にしても、リンクを持っている人は見られてよい）
 */
export async function setPlanVisibility(planId: string, visibility: 'public' | 'unlisted'): Promise<void> {
  const deskId = await getPublishedDeskId(planId)
  if (!deskId) return
  await setDeskVisibility(deskId, visibility, planId)
}

/** Undo 期限後に、プランへ紐づく公開データと画像を完全に削除する。 */
export async function deletePublishedPlanData(planId: string): Promise<void> {
  const deskId = await getPublishedDeskId(planId)
  if (!deskId) {
    await AsyncStorage.multiRemove([visibilityKey(planId), signatureKey(planId)])
    return
  }

  const photos = await getDeskPhotos(deskId)
  await Promise.all(
    photos.flatMap((photo) => [photo.image_url, photo.pending_revocation_url].filter((url): url is string => !!url).flatMap(deskImageFileUrls).map(deleteDeskImageStrict)),
  )
  // devices / connections / desk_photos / desk_versions / bookmarks / reports は
  // 外部キーの ON DELETE CASCADE で同時に削除される。
  await deleteDesk(deskId)
  await AsyncStorage.multiRemove([publishedKey(planId), visibilityKey(planId), signatureKey(planId)])
}

/** 所有する公開デスクと関連画像を完全に削除する。 */
export async function deleteAllPublishedData(userId: string): Promise<void> {
  const desks = await getUserDesks(userId)
  for (const desk of desks) {
    const photos = await getDeskPhotos(desk.id)
    await Promise.all(photos.flatMap((photo) => [photo.image_url, photo.pending_revocation_url].filter((url): url is string => !!url).flatMap(deskImageFileUrls).map(deleteDeskImage)))
    await deleteDesk(desk.id)
  }
}
