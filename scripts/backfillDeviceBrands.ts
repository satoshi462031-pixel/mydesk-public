// 公開済み devices のブランドと別名を、現行の判定ロジックで焼き直す。
//
//   npx tsx scripts/backfillDeviceBrands.ts
//   npx tsx scripts/backfillDeviceBrands.ts --apply
//   npx tsx scripts/backfillDeviceBrands.ts --apply --delete-test-fixtures
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'
import { gadgetBrandForPublish } from '../src/utils/brandIdentity'

type DeviceRow = {
  id: string
  desk_id: string
  name: string
  brand: string | null
  brand_aliases: string[] | null
}

type ConnectionRow = {
  id: string
  desk_id: string
  from_device_id: string
  to_device_id: string
  cable_type: string
  label: string | null
}

const APPLY = process.argv.includes('--apply')
const DELETE_TEST_FIXTURES = process.argv.includes('--delete-test-fixtures')

const TEST_FIXTURES = [
  { name: 'Offset Test Mouse', brand: 'Offset' },
] as const

function sameStrings(left: string[] | null, right: string[]): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right)
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const rows: DeviceRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('devices')
      .select('id,desk_id,name,brand,brand_aliases')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`devices の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as DeviceRow[]))
    if (!data || data.length < 1000) break
  }

  const changes = rows.flatMap((row) => {
    const next = gadgetBrandForPublish(row.name)
    return row.brand === next.brand && sameStrings(row.brand_aliases, next.brand_aliases)
      ? []
      : [{ row, next }]
  })
  const testRows = rows.filter((row) => TEST_FIXTURES.some(
    (fixture) => row.name === fixture.name && row.brand === fixture.brand,
  ))
  const testIds = testRows.map((row) => row.id)
  let dependentConnections: ConnectionRow[] = []
  if (testIds.length > 0) {
    const clauses = testIds.flatMap((id) => [`from_device_id.eq.${id}`, `to_device_id.eq.${id}`])
    const { data, error } = await db
      .from('connections')
      .select('id,desk_id,from_device_id,to_device_id,cable_type,label')
      .or(clauses.join(','))
    if (error) throw new Error(`テスト機材の接続取得に失敗: ${error.message}`)
    dependentConnections = (data ?? []) as ConnectionRow[]
  }

  console.log(`公開機材 ${rows.length}件 / ブランド更新 ${changes.length}件`)
  for (const { row, next } of changes.slice(0, 30)) {
    console.log(`  ${row.name}: ${row.brand ?? '（空）'} → ${next.brand ?? '（空）'}`)
  }
  console.log(`削除対象のテスト機材 ${testRows.length}件`)
  for (const row of testRows) console.log(`  ${row.name} (${row.id}, desk ${row.desk_id})`)
  console.log(`連動削除される接続 ${dependentConnections.length}件`)

  if (!APPLY) {
    console.log('--apply を付けるとブランドを書き込む（今回は差分を出しただけ）')
    return
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `device-brand-before-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify({ changes, testRows, dependentConnections }, null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  for (const { row, next } of changes) {
    const { error } = await db
      .from('devices')
      .update({ brand: next.brand, brand_aliases: next.brand_aliases })
      .eq('id', row.id)
    if (error) throw new Error(`device ${row.id} の更新に失敗: ${error.message}`)
  }
  console.log(`ブランド更新完了: ${changes.length}件`)

  if (DELETE_TEST_FIXTURES && testRows.length > 0) {
    const { error } = await db.from('devices').delete().in('id', testIds)
    if (error) throw new Error(`テスト機材の削除に失敗: ${error.message}`)
    console.log(`テスト機材を削除: ${testRows.length}件`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
