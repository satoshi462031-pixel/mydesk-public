import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, it } from 'node:test'
import { auditFunctionGrants, auditUnusedClientFunctions, missingSubmodules, readClientCode } from '../scripts/functionGrants'

const migrations = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()
const repoFiles = [
  { name: 'schema.sql', text: readFileSync('supabase/schema.sql', 'utf8') },
  ...migrations.map((name) => ({ name, text: readFileSync(`supabase/migrations/${name}`, 'utf8') })),
]

const definer = (name: string, body = 'SELECT 1') => `
CREATE OR REPLACE FUNCTION public.${name}(p_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ ${body} $$;
`

describe('SECURITY DEFINER の実行権限', () => {
  it('リポジトリのマイグレーションに取りこぼしが無い', () => {
    assert.deepEqual(auditFunctionGrants(repoFiles), [])
  })

  it('FROM PUBLIC だけの関数を止める（091 の形）', () => {
    const sql = definer('bump', "SELECT auth.uid()") + `
REVOKE ALL ON FUNCTION public.bump(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump(UUID) TO service_role;`
    const problems = auditFunctionGrants([{ name: '900_x.sql', text: sql }])
    assert.equal(problems.length, 1)
    assert.match(problems[0].reason, /anon \/ authenticated/)
  })

  it('後のマイグレーションで外せば通る', () => {
    const problems = auditFunctionGrants([
      { name: '900_x.sql', text: definer('bump') + 'REVOKE ALL ON FUNCTION public.bump(UUID) FROM PUBLIC;' },
      { name: '901_y.sql', text: 'REVOKE ALL ON FUNCTION public.bump(UUID) FROM anon, authenticated;' },
    ])
    assert.deepEqual(problems, [])
  })

  it('意図して anon に渡したものは通す', () => {
    const sql = definer('open_link') + `
REVOKE ALL ON FUNCTION public.open_link(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_link(UUID) TO anon, authenticated;`
    assert.deepEqual(auditFunctionGrants([{ name: '900_x.sql', text: sql }]), [])
  })

  it('作り直すと既定の付与に戻る', () => {
    const problems = auditFunctionGrants([
      { name: '900_x.sql', text: definer('f') + 'REVOKE ALL ON FUNCTION public.f(UUID) FROM PUBLIC, anon, authenticated;' },
      { name: '901_y.sql', text: 'DROP FUNCTION IF EXISTS public.f(UUID);' + definer('f') },
    ])
    assert.equal(problems.length, 1)
  })

  it('search_path の無い定義者関数を止める', () => {
    const sql = `CREATE FUNCTION public.g() RETURNS VOID AS $$ SELECT 1 $$ LANGUAGE sql SECURITY DEFINER;
REVOKE ALL ON FUNCTION public.g() FROM PUBLIC, anon, authenticated;`
    const problems = auditFunctionGrants([{ name: '900_x.sql', text: sql }])
    assert.equal(problems.length, 1)
    assert.match(problems[0].reason, /search_path/)
  })

  it('コメントの中の GRANT は数えない', () => {
    const sql = definer('h') + '-- GRANT EXECUTE ON FUNCTION public.h(UUID) TO anon, authenticated;'
    assert.equal(auditFunctionGrants([{ name: '900_x.sql', text: sql }]).length, 1)
  })
})

describe('クライアントに渡したまま使われていない関数', () => {
  const granted = (name: string) => definer(name) + `
REVOKE ALL ON FUNCTION public.${name}(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.${name}(UUID) TO authenticated;
COMMENT ON FUNCTION public.${name}(UUID) IS 'x';`

  const missing = missingSubmodules('.')

  it('リポジトリに残っていない', { skip: missing.length > 0 && `submodule（${missing.join('・')}）が無い` }, () => {
    assert.deepEqual(auditUnusedClientFunctions(repoFiles, readClientCode('.')), [])
  })

  // submodule の無い CI でも流すため、付与し直す前との差で見る
  it('109 で外した関数に付与し直すと止める', () => {
    const regrant = { name: '999_regrant.sql', text: 'GRANT EXECUTE ON FUNCTION public.replace_desk_photos(UUID, JSONB) TO authenticated;' }
    const before = new Set(auditUnusedClientFunctions(repoFiles, readClientCode('.')).map((p) => p.fn))
    const problems = auditUnusedClientFunctions([...repoFiles, regrant], readClientCode('.'))
    assert.deepEqual(problems.map((p) => p.fn).filter((fn) => !before.has(fn)), ['replace_desk_photos'])
  })

  it('定義・GRANT・COMMENT だけでは使っていることにしない', () => {
    const problems = auditUnusedClientFunctions([{ name: '900_x.sql', text: granted('stale') }], [])
    assert.equal(problems.length, 1)
    assert.match(problems[0].reason, /authenticated/)
  })

  it('rpc 呼び出し・/rpc/ の URL・ポリシーからの呼び出しは使っていると見なす', () => {
    const file = { name: '900_x.sql', text: granted('a') + granted('b') + granted('c')
      + 'CREATE POLICY p ON public.t FOR SELECT USING (public.c(id));' }
    const code = ["await supabase.rpc('a', {})", 'fetch(`${base}/rest/v1/rpc/b`)']
    assert.deepEqual(auditUnusedClientFunctions([file], code), [])
  })

  it('手元スクリプトでしか使わない関数（クライアントに付与していない）は対象外', () => {
    const sql = definer('admin_only') + 'REVOKE ALL ON FUNCTION public.admin_only(UUID) FROM PUBLIC, anon, authenticated;'
    assert.deepEqual(auditUnusedClientFunctions([{ name: '900_x.sql', text: sql }], []), [])
  })
})
