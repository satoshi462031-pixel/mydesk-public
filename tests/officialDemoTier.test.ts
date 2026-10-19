import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const migration = readFileSync('supabase/migrations/090_official_account_flag.sql', 'utf8')
const demoLinks = readFileSync('src/constants/demoDeskLinks.ts', 'utf8')
const currentDemoIds = [...demoLinks.matchAll(/deskId: '([0-9a-f-]{36})'/g)].map((match) => match[1])

// 関数本体だけを取り出す。冒頭の説明コメントや移行用の DO ブロックにデモIDが載るのは正しい
function functionBody(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  assert.ok(start >= 0, `${name} is not defined in 090`)
  const open = migration.indexOf('AS $$', start)
  const close = migration.indexOf('$$;', open + 5)
  return migration.slice(open, close)
}

describe('official account Pro treatment', () => {
  it('moves every current official demo owner onto the flag', () => {
    assert.ok(currentDemoIds.length > 0)
    for (const id of currentDemoIds) assert.match(migration, new RegExp(id))
  })

  it('never grants Pro from owning a desk id, since clients choose desk ids on insert', () => {
    for (const name of ['is_pro_user', 'set_desk_owner_tag', 'sync_desk_owner_tier']) {
      const body = functionBody(name)
      assert.match(body, /is_official/)
      assert.doesNotMatch(body, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
      assert.doesNotMatch(body, /\.id = ANY/)
    }
  })

  it('does not grant the viewer access', () => {
    const body = functionBody('is_pro_user')
    assert.match(body, /p\.id = p_user_id/)
    assert.doesNotMatch(body, /user_id\s*=\s*auth\.uid\(\)/)
  })

  it('keeps the flag out of reach of the profile owner', () => {
    assert.match(migration, /BEFORE INSERT OR UPDATE OF is_official ON public\.profiles/)
    assert.match(functionBody('protect_profile_official'), /app\.bypass_official_protection/)
  })
})
