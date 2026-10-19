import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, it } from 'node:test'
import { diffSurface } from '../scripts/productionSurface'

const migrations = readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()
const repoFiles = [
  { name: 'schema.sql', text: readFileSync('supabase/schema.sql', 'utf8') },
  ...migrations.map((name) => ({ name, text: readFileSync(`supabase/migrations/${name}`, 'utf8') })),
]

describe('本番の入口とマイグレーションの突き合わせ', () => {
  it('マイグレーションで作ったテーブル・RPC は通す', () => {
    const diff = diffSurface(['/', '/desks', '/profiles', '/rpc/publish_desk_snapshot', '/rpc/get_public_desk_page'], repoFiles)
    assert.deepEqual(diff.unknown, [])
    assert.deepEqual(diff.exposed, { relations: 2, rpcs: 2 })
  })

  it('マイグレーションの外で作られたものを出す（2026-10-14 に見つかった形）', () => {
    const diff = diffSurface(['/desks', '/books', '/user_books', '/rpc/made_in_dashboard'], repoFiles)
    assert.deepEqual(diff.unknown, ['/books', '/rpc/made_in_dashboard', '/user_books'])
  })

  it('コメントの中の CREATE は作ったことにしない', () => {
    const files = [{ name: '900_x.sql', text: '-- CREATE TABLE public.ghost (id int);' }]
    assert.deepEqual(diffSurface(['/ghost'], files).unknown, ['/ghost'])
  })

  it('残すと決めたものは除外できる', () => {
    assert.deepEqual(diffSurface(['/books'], repoFiles, ['books']).unknown, [])
  })
})
