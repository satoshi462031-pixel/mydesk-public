import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PGlite as DefaultPGlite } from '@electric-sql/pglite';

const { PGlite } = process.argv[2] ? await import(pathToFileURL(resolve(process.argv[2])).href) : { PGlite: DefaultPGlite };
const db = new PGlite();
const owner = '11111111-2222-3333-4444-555555555555';
const desk = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
const old = `https://zewoyfbbhchvbmrzlosj.supabase.co/storage/v1/object/public/desk-images/${owner}/${desk}/old.jpg`;
let checks = 0;
// 失効は Storage に実体がある画像だけを積むので、本物の保存（Edge Function のコピーを含む）を模して登録する
const stored = (url) => db.query("INSERT INTO storage.objects (bucket_id,name) VALUES ('desk-images',$1)", [url.split('/desk-images/')[1]]);
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA account_security;
    GRANT USAGE ON SCHEMA public, auth, account_security TO anon, authenticated, service_role;
    CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role', true) $$;
    CREATE FUNCTION account_security.session_active() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.session', true) IS DISTINCT FROM 'inactive' $$;
    CREATE TABLE desks (id uuid PRIMARY KEY, user_id uuid, visibility text, title text, description text, share_snapshot jsonb, content_signature text, future_secret text);
    CREATE TABLE desk_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), desk_id uuid REFERENCES desks(id) ON DELETE CASCADE, image_url text, sort_order int, created_at timestamptz DEFAULT now());
    CREATE TABLE devices (id uuid, desk_id uuid, name text, future_secret text);
    CREATE TABLE connections (id uuid, desk_id uuid, cable_type text, future_secret text);
    CREATE FUNCTION public.is_own_public_image_url(p_url text, p_uid uuid, p_folder text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
      SELECT coalesce(p_url, '') ~ ('^https://zewoyfbbhchvbmrzlosj\\.supabase\\.co/storage/v1/object/public/desk-images/' || p_uid::text || '/' || p_folder || '/[A-Za-z0-9._-]+$') $$;
  `);
  for (const filename of ['101_unlisted_share_links.sql', '100_photo_revocation_retry.sql', '110_public_api_gateway.sql', '111_public_response_fields.sql', '112_server_photo_revocations.sql']) {
    await db.exec(await readFile(resolve('supabase/migrations', filename), 'utf8'));
  }
  await db.query('INSERT INTO desks (id,user_id,visibility,title,share_snapshot,content_signature,future_secret) VALUES ($1,$2,$3,$4,$5,$6,$7)', [desk, owner, 'public', 'Desk', { plan: { images: [old], nested: { thumb: old.replace('.jpg', '_thumb.jpg') } } }, 'internal-signature', 'secret']);
  await db.query('INSERT INTO desk_photos (desk_id,image_url,sort_order) VALUES ($1,$2,0)', [desk, old]);
  await stored(old);
  await db.query('INSERT INTO devices VALUES (gen_random_uuid(),$1,$2,$3)', [desk, 'PC', 'secret-device']);
  await db.query('INSERT INTO connections VALUES (gen_random_uuid(),$1,$2,$3)', [desk, 'USB', 'secret-connection']);

  await db.exec(`SET ROLE service_role`);
  await db.query('SELECT configure_public_api_gateway($1)', ['gateway-secret-of-at-least-32-characters']);
  await db.exec(`RESET ROLE; SET test.role = 'anon'; SET ROLE anon`);
  await assert.rejects(db.query('SELECT check_account_access()'), /PUBLIC_API_GATEWAY_REQUIRED/); checks++;
  await db.query("SELECT set_config('request.headers',$1,false)", [JSON.stringify({ 'x-public-api-secret': 'wrong' })]);
  await assert.rejects(db.query('SELECT check_account_access()'), /PUBLIC_API_GATEWAY_REQUIRED/); checks++;
  await db.query("SELECT set_config('request.headers',$1,false)", [JSON.stringify({ 'x-public-api-secret': 'gateway-secret-of-at-least-32-characters' })]);
  await db.query('SELECT check_account_access()'); checks++;
  const publicDesk = (await db.query('SELECT get_link_shared_desk($1) AS desk', [desk])).rows[0].desk;
  assert.equal(publicDesk.title, 'Desk');
  for (const key of ['content_signature', 'future_secret', 'pending_revocation_url']) assert.ok(!JSON.stringify(publicDesk).includes(key)); checks++;
  await assert.rejects(db.query('SELECT claim_photo_revocations()'), /permission denied/); checks++;
  await assert.rejects(db.query("SELECT configure_public_api_gateway('attacker')"), /permission denied/); checks++;
  await db.exec(`RESET ROLE; SET test.role = 'authenticated'; SET test.session = 'inactive'; SET ROLE authenticated`);
  await assert.rejects(db.query('SELECT check_account_access()'), /ACCOUNT_ACCESS_REVOKED/); checks++;
  await db.exec('RESET ROLE');

  await db.query("UPDATE desks SET visibility='private' WHERE id=$1", [desk]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM account_security.photo_revocation_jobs')).rows[0].count, 1); checks++;
  await db.exec('SET ROLE service_role');
  const job = (await db.query('SELECT * FROM claim_photo_revocations(1000)')).rows[0];
  assert.ok(job.lease_token); checks++;
  assert.equal((await db.query('SELECT count(*)::int AS count FROM claim_photo_revocations(10)')).rows[0].count, 0); checks++;
  await assert.rejects(db.query('SELECT commit_photo_revocation($1,$2,false)', [job.id, job.lease_token]), /REVOCATION_COPY_NOT_READY/); checks++;
  assert.equal((await db.query('SELECT commit_photo_revocation($1,$2,true) AS used', [job.id, job.lease_token])).rows[0].used, true); checks++;
  assert.equal((await db.query('SELECT commit_photo_revocation($1,$2,false) AS used', [job.id, job.lease_token])).rows[0].used, true); checks++;
  await assert.rejects(db.query('SELECT commit_photo_revocation($1,gen_random_uuid(),true)', [job.id]), /REVOCATION_LEASE_LOST/); checks++;
  await db.exec('RESET ROLE');
  const photo = (await db.query('SELECT * FROM desk_photos')).rows[0];
  assert.equal(photo.image_url, job.new_url);
  await stored(job.new_url);
  assert.equal(photo.pending_revocation_url, old); checks++;
  const snapshot = (await db.query('SELECT share_snapshot FROM desks')).rows[0].share_snapshot;
  assert.equal(snapshot.plan.images[0], job.new_url);
  assert.equal(snapshot.plan.nested.thumb, job.new_url.replace('.jpg', '_thumb.jpg')); checks++;
  await db.exec('SET ROLE service_role');
  await db.query('SELECT finish_photo_revocation($1,$2)', [job.id, job.lease_token]);
  await db.exec('RESET ROLE');
  await db.query('UPDATE desk_photos SET pending_revocation_url = null');
  await db.query("UPDATE desks SET visibility='unlisted' WHERE id=$1", [desk]);
  await db.query("SELECT set_config('test.uid',$1,false)", [owner]);
  await db.query('SELECT reissue_unlisted_desk_link($1)', [desk]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM account_security.photo_revocation_jobs')).rows[0].count, 1); checks++;
  const pending = (await db.query('SELECT * FROM claim_photo_revocations(10)')).rows[0];
  await db.query('UPDATE desk_photos SET image_url=$1', [job.new_url.replace(/[^/]+$/, 'client.jpg')]);
  await stored(job.new_url.replace(/[^/]+$/, 'client.jpg'));
  assert.equal((await db.query('SELECT commit_photo_revocation($1,$2,true) AS used', [pending.id, pending.lease_token])).rows[0].used, false); checks++;
  await db.query('SELECT finish_photo_revocation($1,$2)', [pending.id, pending.lease_token]);
  await db.query('SELECT reissue_unlisted_desk_link($1)', [desk]);
  const repeated = (await db.query('SELECT * FROM account_security.photo_revocation_jobs')).rows;
  assert.ok(repeated.some((item) => item.old_url.endsWith('/client.jpg'))); checks++;
  await db.query('DELETE FROM desks WHERE id=$1', [desk]);
  const jobs = (await db.query('SELECT * FROM account_security.photo_revocation_jobs')).rows;
  assert.ok(jobs.length > 0 && jobs.every((item) => item.preserve_photo === false)); checks++;

  // 印からのジョブの水増し（security-recheck-2026-10-15 の queueAmplification）を止める
  await db.exec('DELETE FROM account_security.photo_revocation_jobs');
  const deskB = 'aaaaaaaa-bbbb-4ccc-dddd-ffffffffffff';
  const base = old.replace(desk, deskB).replace(/[^/]+$/, '');
  const jobCount = async () => (await db.query('SELECT count(*)::int AS count FROM account_security.photo_revocation_jobs')).rows[0].count;
  await db.query('INSERT INTO desks (id,user_id,visibility,title,share_snapshot) VALUES ($1,$2,$3,$4,$5)', [deskB, owner, 'public', 'B', {}]);
  const photoB = (await db.query('INSERT INTO desk_photos (desk_id,image_url,sort_order) VALUES ($1,$2,0) RETURNING id', [deskB, `${base}real.jpg`])).rows[0].id;
  await stored(`${base}real.jpg`);
  for (let i = 0; i < 5; i++) {
    await assert.rejects(db.query('UPDATE desk_photos SET pending_revocation_url=$1 WHERE id=$2', [`${base}missing-${i}.jpg`, photoB]), /PHOTO_REVOCATION_MARKER_INVALID/);
  }
  assert.equal(await jobCount(), 0); checks++;
  await assert.rejects(db.query('INSERT INTO desk_photos (desk_id,image_url,pending_revocation_url) VALUES ($1,$2,$3)', [deskB, `${base}real.jpg`, `${base}other.jpg`]), /PHOTO_REVOCATION_MARKER_INVALID/); checks++;
  // 形だけ正しい架空の画像に差し替えて印を立てても、実体が無ければ積まない
  for (let i = 0; i < 5; i++) {
    await db.query('UPDATE desk_photos SET image_url=$1, pending_revocation_url=NULL WHERE id=$2', [`${base}fake-${i}.jpg`, photoB]);
    await db.query('UPDATE desk_photos SET pending_revocation_url=image_url WHERE id=$1', [photoB]);
  }
  assert.equal(await jobCount(), 0); checks++;
  // アプリの差し替え（今の URL に印→新しい URL へ替えて旧 URL を印に→印を消す）は通り、実体のある画像は積む。
  // 実体のある画像を差し替え続けても、写真1枚あたりの未処理は2件で止まる
  for (let i = 0; i < 5; i++) {
    const current = `${base}rotate-${i}.jpg`, next = `${base}rotate-${i + 1}.jpg`;
    await stored(current);
    await db.query('UPDATE desk_photos SET image_url=$1, pending_revocation_url=NULL WHERE id=$2', [current, photoB]);
    await db.query('UPDATE desk_photos SET image_url=$1, pending_revocation_url=$1 WHERE id=$2 AND image_url=$1', [current, photoB]);
    await db.query('UPDATE desk_photos SET image_url=$1, pending_revocation_url=$2 WHERE id=$3 AND image_url=$2', [next, current, photoB]);
    await db.query('UPDATE desk_photos SET pending_revocation_url=NULL WHERE id=$1', [photoB]);
  }
  assert.equal(await jobCount(), 2); checks++;
  // 非公開化の経路は写真1枚あたりの上限で落とさない
  await stored(`${base}rotate-5.jpg`);
  await db.query("UPDATE desks SET visibility='private' WHERE id=$1", [deskB]);
  assert.ok((await db.query('SELECT 1 FROM account_security.photo_revocation_jobs WHERE old_url=$1', [`${base}rotate-5.jpg`])).rows.length === 1); checks++;

  // ジョブの多い所有者がいても、他の所有者のジョブが同じ回に取り出される
  const other = '99999999-2222-3333-4444-555555555555', deskC = 'cccccccc-bbbb-4ccc-dddd-eeeeeeeeeeee';
  const otherUrl = old.replace(owner, other).replace(desk, deskC);
  await db.query('INSERT INTO desks (id,user_id,visibility,title,share_snapshot) VALUES ($1,$2,$3,$4,$5)', [deskC, other, 'unlisted', 'C', {}]);
  await db.query('INSERT INTO desk_photos (desk_id,image_url,sort_order) VALUES ($1,$2,0)', [deskC, otherUrl]);
  await stored(otherUrl);
  await db.query("UPDATE desks SET visibility='private' WHERE id=$1", [deskC]);
  await db.exec('SET ROLE service_role');
  const firstRound = (await db.query('SELECT * FROM claim_photo_revocations(2)')).rows;
  assert.deepEqual(new Set(firstRound.map((item) => item.owner_id)), new Set([owner, other])); checks++;
  // 失敗した（終えずにリースが切れた）ジョブは、試行ごとに間を倍に空けて取り直す
  const leaseMinutes = (row) => Math.round((new Date(row.leased_until) - Date.now()) / 60000);
  assert.equal(leaseMinutes(firstRound[0]), 5);
  await db.exec('RESET ROLE');
  await db.query("UPDATE account_security.photo_revocation_jobs SET leased_until = now() - interval '1 second' WHERE id=$1", [firstRound[0].id]);
  await db.exec('SET ROLE service_role');
  const retried = (await db.query('SELECT * FROM claim_photo_revocations(10)')).rows.find((item) => item.id === firstRound[0].id);
  assert.equal(retried.attempts, 2);
  assert.equal(leaseMinutes(retried), 10); checks++;
  await db.exec('RESET ROLE');
  console.log(`SQL security checks passed: ${checks}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await db.close(); }
