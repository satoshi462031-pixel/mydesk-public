import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '../tmp/collections-db-check/node_modules/@electric-sql/pglite/dist/index.js'

const db = new PGlite()
await db.exec(`
  create schema auth;
  create role anon;
  create role authenticated;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to authenticated;
  create table auth.users(id uuid primary key);
  create table public.profiles(id uuid primary key references auth.users(id), tier text);
  create table public.bookmarks(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);
  create table public.gadget_bookmarks(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);
`)
await db.exec(readFileSync('supabase/migrations/121_saved_collections.sql', 'utf8'))
const me = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
await db.query('insert into auth.users values ($1),($2)', [me, other])
await db.query("insert into profiles values ($1,'free'),($2,'pro')", [me, other])
const bookmark = (await db.query('insert into bookmarks(user_id) values ($1) returning id', [me])).rows[0].id
const foreignBookmark = (await db.query('insert into bookmarks(user_id) values ($1) returning id', [other])).rows[0].id
const gadget = (await db.query('insert into gadget_bookmarks(user_id) values ($1) returning id', [me])).rows[0].id
const asUser = async (id) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); await db.exec('set role authenticated') }
const folder = async (name) => (await db.query('insert into saved_collections(name) values ($1) returning id', [name])).rows[0].id
await asUser(me)
const ids = []
for (let i = 0; i < 3; i++) ids.push(await folder(`folder-${i}`))
await assert.rejects(folder('fourth'), /SAVED_COLLECTION_LIMIT/)
await assert.rejects(db.query('insert into saved_collection_items(collection_id, bookmark_id) values ($1,$2)', [ids[0], foreignBookmark]), /COLLECTION_OWNER_MISMATCH/)
await db.query('insert into saved_collection_items(collection_id, bookmark_id) values ($1,$2)', [ids[0], bookmark])
await db.query('insert into saved_collection_items(collection_id, gadget_bookmark_id) values ($1,$2)', [ids[0], gadget])
await assert.rejects(db.query('insert into saved_collection_items(collection_id, bookmark_id) values ($1,$2)', [ids[0], bookmark]), /unique/)
await asUser(other)
assert.equal((await db.query('select * from saved_collections')).rows.length, 0)
assert.equal((await db.query('select * from saved_collection_items')).rows.length, 0)
await assert.rejects(db.query('insert into saved_collection_items(collection_id, bookmark_id) values ($1,$2)', [ids[0], foreignBookmark]), /COLLECTION_OWNER_MISMATCH/)
await assert.rejects(db.query('insert into saved_collections(user_id,name) values ($1,$2)', [me, 'spoofed']), /COLLECTION_OWNER_MISMATCH/)
for (let i = 0; i < 5; i++) await folder(`pro-${i}`)
await db.exec('reset role')
await db.query("update profiles set tier='pro' where id=$1", [me])
await asUser(me)
ids.push(await folder('pro fourth'))
await db.exec('reset role')
await db.query("update profiles set tier='free' where id=$1", [me])
await asUser(me)
assert.equal((await db.query('select * from saved_collections')).rows.length, 4)
assert.equal((await db.query('select * from saved_collection_items')).rows.length, 2)
await db.query("update saved_collections set name='renamed' where id=$1", [ids[3]])
await assert.rejects(folder('fifth'), /SAVED_COLLECTION_LIMIT/)
await assert.rejects(db.query('update saved_collections set user_id=$1 where id=$2', [other, ids[0]]), /permission denied/)
await db.query('delete from saved_collections where id=$1', [ids[0]])
assert.equal((await db.query('select * from saved_collection_items')).rows.length, 0)
await db.exec('reset role')
assert.equal((await db.query('select * from bookmarks where id=$1', [bookmark])).rows.length, 1)
assert.equal((await db.query('select * from gadget_bookmarks where id=$1', [gadget])).rows.length, 1)
await asUser(me)
await db.query('insert into saved_collection_items(collection_id, bookmark_id) values ($1,$2)', [ids[1], bookmark])
await db.exec('reset role')
await db.query('delete from bookmarks where id=$1', [bookmark])
assert.equal((await db.query('select * from saved_collection_items where user_id=$1', [me])).rows.length, 0)
await db.query('delete from profiles where id=$1', [me])
await db.query('delete from auth.users where id=$1', [me])
assert.equal((await db.query('select * from saved_collections where user_id=$1', [me])).rows.length, 0)
await db.close()
console.log('PASS: free/pro limits, downgrade retention, ownership, RLS, restricted updates, deduplication, folder/bookmark/account deletion cascades')
