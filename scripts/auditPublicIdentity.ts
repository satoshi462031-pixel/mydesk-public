import { createClient } from '@supabase/supabase-js'
import { createAdminClient, loadEnv } from './importRakuten'

async function loadAll(table: string, columns: string): Promise<any[]> {
  const db = createAdminClient()
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) return rows
  }
}

async function main(): Promise<void> {
  loadEnv()
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase の接続設定がありません')

  const anon = createClient(url, anonKey)
  const [profiles, desks, publicRead] = await Promise.all([
    loadAll('profiles', 'id,public_tag'),
    loadAll('desks', 'id,user_id,owner_tag'),
    anon.from('desks').select('id,owner_tag').eq('visibility', 'public').limit(1),
  ])
  if (publicRead.error) throw publicRead.error

  const tagsByUser = new Map(profiles.map((profile) => [profile.id, profile.public_tag]))
  const invalidTags = profiles.filter((profile) => !/^[A-Za-z0-9_]{3,20}$/.test(profile.public_tag ?? ''))
  // 060 の一意性は大文字小文字を区別しない。ここも同じ基準で数える
  const duplicateTags = profiles.length - new Set(profiles.map((profile) => (profile.public_tag ?? '').toLowerCase())).size
  const unmatchedDeskTags = desks.filter((desk) => desk.owner_tag !== tagsByUser.get(desk.user_id))

  console.log(JSON.stringify({
    profiles: profiles.length,
    desks: desks.length,
    invalidTags: invalidTags.length,
    duplicateTags,
    unmatchedDeskTags: unmatchedDeskTags.length,
    anonPublicSelect: 'ok',
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
