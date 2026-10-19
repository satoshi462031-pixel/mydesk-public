// ログインしたとき、端末のデータとアカウントの控えをどう突き合わせるか。
// 印の意味は store/accountDataOwner.ts を参照。

export type ReconcileAction =
  /** すでにこのアカウントと突き合わせ済み。空でも控えは戻さない（本人が全部消した状態を復活させない） */
  | 'in-sync'
  /** 端末が空（再インストール・機種変更・ログアウト後）。アカウントの控えを戻す */
  | 'restore'
  /** 別のアカウントのデータが残っている。混ぜずに、どうするかを本人に聞く */
  | 'foreign'
  /** ログインせずに作ったデータがある。アカウントの控えと ID で合わせる */
  | 'merge'
  /** 印を持つ前の版からログインしたまま使っている。端末のデータを本人のものとして引き取る */
  | 'adopt'

export function decideReconcileAction({ userId, owner, signInPending, localEmpty }: {
  userId: string
  owner: string | null
  signInPending: boolean
  localEmpty: boolean
}): ReconcileAction {
  if (owner === userId) return 'in-sync'
  if (localEmpty) return 'restore'
  if (owner) return 'foreign'
  return signInPending ? 'merge' : 'adopt'
}

/**
 * ID で合わせる。同じ ID は端末側を残す（端末のほうが後から触られている）。
 * 並びはアカウント側を先にして、端末にしか無いものを後ろへ足す。デスクの追加が
 * 末尾へ積む作りなので、ログインせずに作った新しいデスクが後ろに来る。
 */
export function mergeById<T extends { id: string }>(account: readonly T[], local: readonly T[]): T[] {
  const localIds = new Set(local.map((item) => item.id))
  return [...account.filter((item) => !localIds.has(item.id)), ...local]
}
