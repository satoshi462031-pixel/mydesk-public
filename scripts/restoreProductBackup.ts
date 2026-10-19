import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chunk, createAdminClient, loadEnv } from './importRakuten'

type BackupEntry = {
  before: {
    id: string
    name: string
    brand: string | null
    category: string | null
    image: string | null
    source: string | null
  }
}

async function main(): Promise<void> {
  const relativePath = process.argv[2]
  if (!relativePath) throw new Error('復元するバックアップファイルを指定してください')
  const backupRoot = resolve(process.cwd(), '.codex-backups')
  const backupPath = resolve(process.cwd(), relativePath)
  if (!backupPath.startsWith(`${backupRoot}\\`)) throw new Error('バックアップディレクトリ外は復元できません')
  const entries = JSON.parse(readFileSync(backupPath, 'utf8')) as BackupEntry[]
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('バックアップが空です')

  loadEnv()
  const db = createAdminClient()
  for (const part of chunk(entries, 100)) {
    const { error } = await db.from('products').upsert(
      part.map(({ before }) => ({
        id: before.id,
        name: before.name,
        brand: before.brand,
        category: before.category,
        image: before.image,
        source: before.source,
      })),
      { onConflict: 'id' },
    )
    if (error) throw new Error(`復元に失敗: ${error.message}`)
  }
  console.log(`${entries.length}件を更新前の状態へ復元しました`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
