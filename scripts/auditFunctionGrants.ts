/**
 * SECURITY DEFINER 関数の実行権限の取りこぼしと、クライアントに渡したまま使われていない関数を検査する。
 * `npm run audit:function-grants`
 * 判定の中身と理由は functionGrants.ts。テスト（tests/functionGrants.test.ts）からも同じ判定を回す。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { auditFunctionGrants, auditUnusedClientFunctions, missingSubmodules, readClientCode } from './functionGrants'

const SUPABASE = join(__dirname, '..', 'supabase')
const migrations = readdirSync(join(SUPABASE, 'migrations')).filter((name) => name.endsWith('.sql')).sort()
const files = [
  { name: 'schema.sql', text: readFileSync(join(SUPABASE, 'schema.sql'), 'utf8') },
  ...migrations.map((name) => ({ name, text: readFileSync(join(SUPABASE, 'migrations', name), 'utf8') })),
]

const root = join(__dirname, '..')
const missing = missingSubmodules(root)
if (missing.length > 0) {
  console.warn(`submodule（${missing.join('・')}）が無いので、使われていない関数の検査は飛ばす（git submodule update --init で取得）\n`)
}
const problems = [
  ...auditFunctionGrants(files),
  ...(missing.length > 0 ? [] : auditUnusedClientFunctions(files, readClientCode(root))),
]
if (problems.length > 0) {
  console.error('関数の実行権限の監査で問題が見つかった:\n')
  for (const p of problems) console.error(`  - ${p.fn}（${p.file}）: ${p.reason}`)
  process.exit(1)
}

console.log('関数の実行権限: 問題なし')
