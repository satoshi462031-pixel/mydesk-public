// RevenueCat の顧客 ID（app_user_id）と、こちらの利用者の対応（107）。Deno にも node:test にも読めるよう、依存を持たない。
//
// アプリは Purchases.logIn(profiles.rc_customer_id) としている。利用者 ID（auth.users.id）は公開されているので
// 顧客 ID には使わない。以前の利用者 ID のままの顧客は対応が無く、誰にも結び付けない。

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface CustomerEvent {
  app_user_id?:          string
  original_app_user_id?: string
  aliases?:              string[]
  transferred_from?:     string[]
  transferred_to?:       string[]
}

export interface CustomerRow {
  id:             string
  rc_customer_id: string
}

export interface ResolvedCustomer {
  userId:     string
  customerId: string
}

/**
 * 顧客 ID になりうる値を優先順に並べる。未ログインで購入した "$RCAnonymousID:..." は
 * ログイン後に RevenueCat がエイリアスを張るので、app_user_id → original_app_user_id → aliases の順に探す。
 * TRANSFER は移行元と移行先の両方の権利を取り直す
 */
export function customerIdCandidates(event: CustomerEvent, isTransfer: boolean): string[] {
  const raw = isTransfer
    ? [...(event.transferred_from ?? []), ...(event.transferred_to ?? [])]
    : [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])]
  const ids = raw.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)).map((id) => id.toLowerCase())
  return [...new Set(ids)]
}

/**
 * TRANSFER の移行元と移行先を、こちらの利用者 ID に直して分けて返す。
 * AI の利用回数を移行先へ持ち越すのに使う（119）。対応の無い顧客（107 より前・削除済み）は落とす
 */
export function transferUsers(event: CustomerEvent, rows: CustomerRow[]): { from: string[]; to: string[] } {
  const byCustomer = new Map(rows.map((row) => [row.rc_customer_id.toLowerCase(), row.id]))
  const resolve = (ids: string[] | undefined) => [...new Set((ids ?? [])
    .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    .map((id) => byCustomer.get(id.toLowerCase()))
    .filter((id): id is string => !!id))]
  const from = resolve(event.transferred_from)
  const to = resolve(event.transferred_to)
  // 同じ人が両側にいるときは持ち越すものが無い
  return { from: from.filter((id) => !to.includes(id)), to: to.filter((id) => !from.includes(id)) }
}

/** TRANSFER 以外は1イベント1人。候補の順で最初に対応が取れた顧客だけを使う */
export function matchCustomers(candidates: string[], rows: CustomerRow[], isTransfer: boolean): ResolvedCustomer[] {
  const byCustomer = new Map(rows.map((row) => [row.rc_customer_id.toLowerCase(), row.id]))
  const matched: ResolvedCustomer[] = []
  for (const customerId of candidates) {
    const userId = byCustomer.get(customerId)
    if (!userId) continue
    matched.push({ userId, customerId })
    if (!isTransfer) break
  }
  return matched
}
