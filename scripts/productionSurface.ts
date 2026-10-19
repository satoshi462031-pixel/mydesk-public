/**
 * 本番の PostgREST が公開しているテーブル・ビュー・RPC の名前と、マイグレーションで作ったものを突き合わせる。
 *
 * これまでの監査（RLS・audit:function-grants）はどれもリポジトリの SQL を正にしていて、
 * ダッシュボードや別のアプリが本番に直接作ったものは視界に入らなかった。2026-10-14 に、
 * どのマイグレーションにも履歴にも無いテーブルが6つ本番に出ていたのが見つかった
 * （公開アプリを解析して接続先を攻撃する A2B 攻撃の注意喚起を受けた点検）。
 * 攻撃者が見るのはリポジトリではなく本番の API なので、そちらから入口を棚卸しする。
 */
import type { SqlFile } from './functionGrants'

export interface SurfaceDiff {
  /** 本番の API に出ているのに、どのマイグレーションでも作っていないもの */
  unknown: string[]
  /** 本番の API に出ているもの（件数の確認用） */
  exposed: { relations: number; rpcs: number }
}

function createdNames(files: SqlFile[]): Set<string> {
  const sql = files.map((file) => file.text.replace(/--[^\n]*/g, '')).join('\n')
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION)\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi
  return new Set([...sql.matchAll(re)].map((m) => m[1].toLowerCase()))
}

/** OpenAPI 定義の paths（'/desks'・'/rpc/get_x' など）から差分を出す */
export function diffSurface(paths: string[], files: SqlFile[], ignore: readonly string[] = []): SurfaceDiff {
  const created = createdNames(files)
  const unknown: string[] = []
  let relations = 0
  let rpcs = 0
  for (const path of paths) {
    if (path === '/') continue
    const isRpc = path.startsWith('/rpc/')
    if (isRpc) rpcs++
    else relations++
    const name = (isRpc ? path.slice('/rpc/'.length) : path.slice(1)).toLowerCase()
    if (!created.has(name) && !ignore.includes(name)) unknown.push(path)
  }
  return { unknown: unknown.sort(), exposed: { relations, rpcs } }
}
