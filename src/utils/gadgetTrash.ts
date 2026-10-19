import { Gadget } from '../types'

export const GADGET_TRASH_RETENTION_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export function isDeletedGadget(gadget: Gadget): boolean {
  return typeof gadget.deletedAt === 'string' && gadget.deletedAt.length > 0
}

export function splitGadgetsByTrash(gadgets: Gadget[]): {
  active: Gadget[]
  deleted: Gadget[]
} {
  const active: Gadget[] = []
  const deleted: Gadget[] = []
  for (const gadget of gadgets) {
    if (isDeletedGadget(gadget)) deleted.push(gadget)
    else active.push(gadget)
  }
  return { active, deleted }
}

export function gadgetTrashDeadline(gadget: Gadget): number | null {
  if (!gadget.deletedAt) return null
  const deletedAt = Date.parse(gadget.deletedAt)
  if (!Number.isFinite(deletedAt)) return null
  return deletedAt + GADGET_TRASH_RETENTION_DAYS * DAY_MS
}

export function isGadgetTrashExpired(gadget: Gadget, now = Date.now()): boolean {
  const deadline = gadgetTrashDeadline(gadget)
  return deadline !== null && deadline <= now
}

export function gadgetTrashDaysRemaining(gadget: Gadget, now = Date.now()): number | null {
  const deadline = gadgetTrashDeadline(gadget)
  if (deadline === null) return null
  return Math.max(0, Math.ceil((deadline - now) / DAY_MS))
}

/**
 * 最近削除した項目の並び。消したのが新しい順（直前に消したものを戻す場面がいちばん多い）。
 * 機材の一覧と同じ登録の新しい順のままだと、いま消したものが一覧のどこにあるか分からなかった
 */
export function sortGadgetsByDeletedDesc(gadgets: readonly Gadget[]): Gadget[] {
  return [...gadgets].sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
}
