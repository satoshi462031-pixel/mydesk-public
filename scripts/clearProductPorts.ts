/**
 * products.ports を消す／更新前の状態へ戻す（手元PCから実行する）
 *
 *   npx tsx scripts/clearProductPorts.ts --id <uuid>,<uuid>            # dry-run
 *   npx tsx scripts/clearProductPorts.ts --id <uuid> --apply           # 指定した商品のポートを消す
 *   npx tsx scripts/clearProductPorts.ts --file .codex-backups/product-ports-before-update-....json --apply
 *
 * updateProductPorts.ts / updateKeyboardProductPorts.ts が書き込み前に残すバックアップは
 * 「更新した商品の更新前の姿」なので、--file に渡せばその一括更新だけを巻き戻せる。
 * restoreProductBackup.ts は name / brand / category しか戻さないため、ports はこちらを使う。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'

type BackupRow = { id: string; name?: string; ports?: unknown }

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  loadEnv()
  const apply = process.argv.includes('--apply')
  const file = argValue('--file')
  const ids = argValue('--id')?.split(',').filter(Boolean) ?? []

  const targets: BackupRow[] = file
    ? (JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) as BackupRow[])
    : ids.map((id) => ({ id }))
  if (targets.length === 0) throw new Error('--id か --file を指定してください')
  // 再分類のバックアップ（category / is_suggestable の記録）を渡すと、
  // ports を持たない = 全件を空にする、という意味になってしまう。実際に一度やらかしている
  if (file && !targets.some((target) => 'ports' in target)) {
    throw new Error(`このファイルは ports を持っていません（${file}）。ports のバックアップは product-ports-before-update-*.json です`)
  }

  const db = createAdminClient()
  console.log(`対象: ${targets.length}件（${file ? 'バックアップの状態へ戻す' : 'ports を空にする'}）`)
  if (!apply) {
    for (const target of targets.slice(0, 10)) {
      console.log(`  ${target.id} ${target.name ?? ''}`.trim())
    }
    console.log('dry-run: 書き込みなし（--apply で反映）')
    return
  }

  let done = 0
  for (const target of targets) {
    // バックアップ由来なら更新前の値（多くは null）に戻し、--id 指定なら空にする
    const ports = file ? (target.ports ?? null) : null
    const { error } = await db.from('products').update({ ports }).eq('id', target.id)
    if (error) throw new Error(`${target.id} の更新に失敗: ${error.message}`)
    done += 1
    if (done % 200 === 0) console.log(`  ${done}/${targets.length}`)
  }
  console.log(`${done}件のポートを戻しました`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
