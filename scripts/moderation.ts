/**
 * 運営の措置（docs/release/MODERATION_RUNBOOK.md）。service_role で 103 の admin_* 関数を呼ぶ。
 *
 *   npm run moderate -- reports                         未処理の案件（デスクごと、古い順）
 *   npm run moderate -- report-details <デスクID>         案件の通報本文（最大50件）
 *   npm run moderate -- resolve-case <デスクID> <状態> <最終通報日時> [メモ]
 *   npm run moderate -- resolve <通報ID> resolved|dismissed|reviewing [メモ]
 *   npm run moderate -- hide <デスクID> [--keep-photos]  非公開にし、本人が公開に戻せなくする
 *   npm run moderate -- unhide <デスクID>                 措置を解く（公開には戻さない。本人が公開し直す）
 *   npm run moderate -- suspend <user_id>                この人のデスクを全部非公開にし、公開を止める
 *   npm run moderate -- unsuspend <user_id>
 *
 * .env に必要なもの: EXPO_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY（手元専用。EXPO_PUBLIC_ を付けない）
 *
 * hide は既定で写真の実体も消す。desk-images は公開バケットで、非公開にしても URL を知っている人は
 * 本人のアプリが写真のパスを振り直すまで見られる（本人がアプリを開かなければいつまでも残る）。
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { secureHttpUrl } from '../src/utils/secureTransport'
import { timeoutFetch } from '../src/utils/timeoutFetch'

function loadEnv(): void {
  let raw: string
  try {
    raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    const value = m[2].trim().replace(/^["']|["']$/g, '')
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

function uuidArg(value: string | undefined, label: string): string {
  if (!value || !UUID_RE.test(value)) fail(`${label} を UUID で渡してください`)
  return value
}

loadEnv()
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) fail('.env に EXPO_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です')
const admin = createClient(secureHttpUrl(url).toString(), serviceKey, {
  auth: { persistSession: false }, global: { fetch: timeoutFetch },
})

async function removeDeskPhotos(deskId: string): Promise<number> {
  const { data: desk, error } = await admin.from('desks').select('user_id').eq('id', deskId).maybeSingle()
  if (error) throw error
  if (!desk) fail(`デスクが見つかりません: ${deskId}`)
  const folder = `${desk.user_id}/${deskId}`
  const { data: files, error: listError } = await admin.storage.from('desk-images').list(folder, { limit: 1000 })
  if (listError) throw listError
  const paths = (files ?? []).filter((file) => file.id !== null).map((file) => `${folder}/${file.name}`)
  if (paths.length > 0) {
    const { error: removeError } = await admin.storage.from('desk-images').remove(paths)
    if (removeError) throw removeError
  }
  // 行を残すと、本人のアプリが消えたファイルの振り直し（100 の pending_revocation_url）で止まり続ける
  const { error: rowError } = await admin.from('desk_photos').delete().eq('desk_id', deskId)
  if (rowError) throw rowError
  return paths.length
}

async function main(): Promise<void> {
  const [command, target, ...rest] = process.argv.slice(2)
  switch (command) {
    case 'reports': {
      const { data, error } = await admin.rpc('admin_desk_report_cases', { p_limit: 100 })
      if (error) throw error
      if (!data?.length) { console.log('未処理の通報はありません'); return }
      for (const r of data) {
        console.log(`${r.first_report_at}  desk=${r.desk_id} 「${r.desk_title ?? '（題名なし）'}」`)
        console.log(`  未処理 ${r.pending_count}件 / 確認中 ${r.reviewing_count}件 / 直近1時間 ${r.last_hour_count}件 / 登録24時間以内 ${r.new_account_count}件`)
        console.log(`  理由: ${JSON.stringify(r.reasons)} / 最終通報日時: ${r.last_report_at}`)
        if (r.burst_detected) console.log('  通報が集中しています。件数だけで措置を決めず、本文と投稿内容を確認してください。')
      }
      return
    }
    case 'report-details': {
      const deskId = uuidArg(target, 'デスクID')
      const { data, error } = await admin.from('desk_reports')
        .select('id, created_at, status, reason, note').eq('desk_id', deskId)
        .in('status', ['open', 'reviewing']).order('created_at', { ascending: true }).limit(50)
      if (error) throw error
      for (const r of data ?? []) {
        console.log(`${r.created_at} ${r.status} ${r.reason} report=${r.id}`)
        if (r.note) console.log(`  メモ: ${r.note}`)
      }
      return
    }
    case 'resolve-case': {
      const deskId = uuidArg(target, 'デスクID'), status = rest[0], before = rest[1]
      if (!['resolved', 'dismissed', 'reviewing'].includes(status) || !before || !Number.isFinite(Date.parse(before))) {
        fail('状態と、reports に表示された最終通報日時を渡してください')
      }
      const { data, error } = await admin.rpc('resolve_desk_report_case', {
        p_desk_id: deskId, p_status: status, p_before: before, p_note: rest.slice(2).join(' ') || null,
      })
      if (error) throw error
      console.log(`案件 ${deskId} の通報 ${data}件を ${status} にしました（一覧確認後の通報は対象外）`)
      return
    }
    case 'resolve': {
      const reportId = uuidArg(target, '通報ID')
      const status = rest[0]
      if (!['resolved', 'dismissed', 'reviewing'].includes(status)) fail('状態は resolved / dismissed / reviewing のどれか')
      const note = rest.slice(1).join(' ') || null
      const { error } = await admin.from('desk_reports')
        .update({ status, resolution_note: note, reviewed_at: new Date().toISOString() })
        .eq('id', reportId)
      if (error) throw error
      console.log(`通報 ${reportId} を ${status} にしました`)
      return
    }
    case 'hide': {
      const deskId = uuidArg(target, 'デスクID')
      const { error } = await admin.rpc('admin_set_desk_hidden', { p_desk_id: deskId, p_hidden: true })
      if (error) throw error
      console.log(`デスク ${deskId} を非公開にし、本人が公開に戻せないようにしました`)
      if (!rest.includes('--keep-photos')) {
        const removed = await removeDeskPhotos(deskId)
        console.log(`写真のファイルを ${removed} 件消しました`)
      }
      return
    }
    case 'unhide': {
      const deskId = uuidArg(target, 'デスクID')
      const { error } = await admin.rpc('admin_set_desk_hidden', { p_desk_id: deskId, p_hidden: false })
      if (error) throw error
      console.log(`デスク ${deskId} の措置を解きました（公開は本人が行う）`)
      return
    }
    case 'suspend':
    case 'unsuspend': {
      const userId = uuidArg(target, 'user_id')
      const { data, error } = await admin.rpc('admin_set_publishing_suspended', { p_user_id: userId, p_suspended: command === 'suspend' })
      if (error) throw error
      console.log(command === 'suspend'
        ? `${userId} の公開を止め、デスク ${data} 件を非公開にしました。写真の URL をすぐ失効させたいデスクは hide を使う`
        : `${userId} の公開停止を解きました`)
      return
    }
    default:
      fail('使い方: npm run moderate -- reports | report-details <デスクID> | resolve-case <デスクID> <状態> <最終通報日時> [メモ] | resolve <通報ID> <状態> [メモ] | hide <デスクID> [--keep-photos] | unhide <デスクID> | suspend <user_id> | unsuspend <user_id>')
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
