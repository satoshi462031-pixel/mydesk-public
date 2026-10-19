/**
 * 本番の API に、マイグレーションで作っていないテーブル・RPC が出ていないかを調べる。
 * `npm run audit:prod-surface`（月1回の点検と、ダッシュボードで本番を触った後）
 *
 * 本番が公開している名前の一覧（GET /rest/v1/ の OpenAPI 定義）だけを読み、行データは読まない。
 * Supabase はこの定義を anon キーには返さない（401）ので、service_role キーで取る。
 * 攻撃者も一覧は取れないが、名前を推測して /rest/v1/<名前> を直接叩くことはできるので、
 * 一覧に出るものはすべて持ち主と RLS が分かっている必要がある。判定の中身は productionSurface.ts。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv } from './importRakuten'
import { diffSurface } from './productionSurface'

// マイグレーションの外で作られたと分かっていて、残すと決めたものだけを書く（理由も添える）
const KNOWN_OUTSIDE_MIGRATIONS: string[] = []

async function main(): Promise<number> {
  loadEnv()
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('.env に EXPO_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定する')
    return 1
  }

  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    console.error(`本番の API 定義を取得できなかった（HTTP ${res.status}）`)
    return 1
  }
  const spec = await res.json() as { paths?: Record<string, unknown> }

  const SUPABASE = join(__dirname, '..', 'supabase')
  const files = [
    { name: 'schema.sql', text: readFileSync(join(SUPABASE, 'schema.sql'), 'utf8') },
    ...readdirSync(join(SUPABASE, 'migrations')).filter((name) => name.endsWith('.sql')).sort()
      .map((name) => ({ name, text: readFileSync(join(SUPABASE, 'migrations', name), 'utf8') })),
  ]
  const diff = diffSurface(Object.keys(spec.paths ?? {}), files, KNOWN_OUTSIDE_MIGRATIONS)

  console.log(`本番の API の入口: テーブル・ビュー ${diff.exposed.relations} 件 / RPC ${diff.exposed.rpcs} 件`)
  if (diff.unknown.length > 0) {
    console.error('\nマイグレーションで作っていないのに、本番の API に出ているもの:\n')
    for (const path of diff.unknown) console.error(`  - ${path}`)
    console.error('\nRLS・権限を確かめ、使っていなければマイグレーションで閉じる（残すなら KNOWN_OUTSIDE_MIGRATIONS に理由付きで書く）')
    return 1
  }
  console.log('本番の入口: マイグレーション外のものは無い')
  return 0
}

// process.exit で抜けると、Windows では fetch の後始末と競合して libuv のアサーションが出る
main().then((code) => { process.exitCode = code }, (error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
