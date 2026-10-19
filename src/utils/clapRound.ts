// 拍手（旧いいね）は版ごとに送り直せる（095）。自分の拍手の行から「今の版に送ったか」
// 「前の版に送ったことがあるか」を出す。この層は通信を知らない（tests/clapRound.test.ts）。
//
// 版はデスクの clap_round_at、拍手は round_at に持っている。どちらも同じ列型を
// PostgREST が同じ書式で返すので、文字列の一致で比べてよい（Date に直すと
// マイクロ秒が落ちて、別の版を同じと見かねない）。

export interface ClapRow {
  desk_id: string
  round_at: string
  /** 拍手したデスクの今の版。読めないデスク（非公開になった等）では null */
  desk: { clap_round_at: string } | null
}

export interface ClapState {
  clapped: boolean
  /** 前の版に拍手したことがある。今の版に未拍手なら「もう一度拍手」を出す */
  clappedBefore: boolean
}

export interface ClapStates {
  /** 今の版に拍手したデスク */
  current: Set<string>
  /** 前の版に拍手したことがあるデスク */
  before: Set<string>
}

export function clapStates(rows: readonly ClapRow[] | null | undefined): ClapStates {
  const current = new Set<string>()
  const before = new Set<string>()
  for (const row of rows ?? []) {
    if (!row.desk) continue
    if (row.round_at === row.desk.clap_round_at) current.add(row.desk_id)
    else before.add(row.desk_id)
  }
  return { current, before }
}

export function clapStateOf(rows: readonly ClapRow[] | null | undefined, deskId: string): ClapState {
  const { current, before } = clapStates(rows)
  return { clapped: current.has(deskId), clappedBefore: before.has(deskId) }
}
