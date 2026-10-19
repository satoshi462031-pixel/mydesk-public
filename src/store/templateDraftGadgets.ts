import AsyncStorage from '@react-native-async-storage/async-storage'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'

// ─── 作成の「機材」の段で、作成前に作ったガジェット ──────────────────
//
// 枠の編集ボタンは、機材ごとの編集画面（GadgetDetail）で全部の設定を決められるように、
// 保存した時点で枠をガジェットとして先に作る。作成まで進めばデスクに入るが、途中でやめると
// どのデスクにも入らないガジェットが持ち物に残る。入力の控え（templateDetailDraft）は
// メモリにしか無くアプリを落とすと消えるので、作ったガジェットの id だけは端末に書いておき、
// 次に機材の段を新しく始めたとき・作成途中を破棄したときに、デスクに入っていないものを片付ける。
// 編集を開く前にIDを控えるため、保存せずに戻ったIDも含む（機材の登録は詳細画面で保存するとき）。

const KEY = '@template_draft_gadget_ids'

export async function readTemplateDraftGadgetIds(): Promise<string[]> {
  const raw = await withTimeout(AsyncStorage.getItem(KEY), STORAGE_TIMEOUT_MS)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

async function writeIds(ids: string[]): Promise<void> {
  if (ids.length === 0) await withTimeout(AsyncStorage.removeItem(KEY), STORAGE_TIMEOUT_MS)
  else await withTimeout(AsyncStorage.setItem(KEY, JSON.stringify(ids)), STORAGE_TIMEOUT_MS)
}

export async function trackTemplateDraftGadget(id: string): Promise<void> {
  const ids = await readTemplateDraftGadgetIds()
  if (!ids.includes(id)) await writeIds([...ids, id])
}

export async function untrackTemplateDraftGadgets(remove: readonly string[]): Promise<void> {
  if (remove.length === 0) return
  const ids = await readTemplateDraftGadgetIds()
  await writeIds(ids.filter((id) => !remove.includes(id)))
}

/**
 * 控えているガジェットのうち、どのデスクにも入っていないものの id を返し、控えを空にする。
 * 消すのは呼び出し側（useGadgets の removeMany）
 */
export async function takeAbandonedTemplateDraftGadgets(
  plans: readonly { selectedGadgetIds: readonly string[] }[],
  keep: readonly string[] = [],
): Promise<string[]> {
  const ids = await readTemplateDraftGadgetIds()
  if (ids.length === 0) return []
  const inDesk = new Set(plans.flatMap((plan) => plan.selectedGadgetIds))
  await writeIds(ids.filter((id) => keep.includes(id)))
  return ids.filter((id) => !inDesk.has(id) && !keep.includes(id))
}
