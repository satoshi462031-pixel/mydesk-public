import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAdminClient, loadEnv } from './importRakuten'

const NAMES = new Map<string, string>([
  ['f7679432-fa7a-440a-b92c-4f8fbdcdf732', 'Philips 32PHH6569/11 32型 HD チューナーレステレビ（別販売ページ）'],
  ['f7baa806-c9ae-4360-81e8-7509aaac34c1', 'Philips PQT6731シリーズ 32/40/43型 2K QLED チューナーレステレビ'],
  ['30436bca-92e5-4c82-be61-a07046d59aeb', 'Philips 43PUH7169/11 43型 4K チューナーレステレビ（別販売ページ2）'],
  ['9cc41122-29ab-44aa-b14f-1171649a3da7', 'Philips 50PUH7169/11 50型 4K チューナーレステレビ'],
  ['fd6fd8ca-d9af-4f4c-9eff-019ca545b0dc', 'Philips 32PHH6569/11 32型 HD チューナーレステレビ'],
  ['d2678626-6e0b-4961-80a0-5b0d5e26b952', 'Philips 40PQT6731 40型 2K QLED チューナーレステレビ'],
  ['a5081499-28c5-4de3-ba53-e134a060285a', 'Philips PUH7169シリーズ 43/50/55/65型 4K チューナーレステレビ'],
  ['3d73ec27-66d3-46ea-b023-1f74608f8444', 'Philips 43PQT6731 43型 2K QLED チューナーレステレビ'],
  ['5bc48d69-124e-46df-b836-68c6a889056a', 'Philips 43PUH7169/11 43型 4K チューナーレステレビ'],
  ['bb4e62d9-6839-4cb8-8126-0f99cb477cd2', 'Philips 43PUH7169/11 43型 4K チューナーレステレビ（別販売ページ）'],
  ['89d9d73d-ab74-4a00-acc9-905c82794e5c', 'Philips 55PUH7700/11 55型 4K チューナーレステレビ'],
  ['af990fa1-6bcb-470b-81a1-edd91bec9254', 'Philips 55MLED800/11 55型 4K Mini LED チューナーレステレビ'],
  ['8bbb21d5-af56-40e8-8e11-76c175962a70', 'Philips 65PUH7700/11 65型 4K チューナーレステレビ'],
  ['1bb87670-4f1c-45c3-8859-9b91b14305af', 'Philips 65PUH7700/11 65型 4K チューナーレステレビ（別販売ページ）'],
])

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  const ids = [...NAMES.keys()]
  const { data, error } = await db
    .from('products')
    .select('id, name, brand, category, image, source, shop_links(*)')
    .in('id', ids)
  if (error) throw new Error(`更新対象の取得に失敗: ${error.message}`)
  if (!data || data.length !== ids.length) throw new Error(`更新対象が不足しています: ${data?.length ?? 0}/${ids.length}`)
  if (data.some((product) => product.brand !== 'Philips' || product.category !== 'Monitor')) {
    throw new Error('Philipsテレビ以外の商品が更新対象に含まれています')
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = resolve(backupDir, `philips-tvs-before-name-update-${stamp}.json`)
  writeFileSync(backupPath, JSON.stringify(data, null, 2))
  console.log(`更新前バックアップ: ${backupPath}`)

  const { error: updateError } = await db.from('products').upsert(
    data.map((product) => ({
      id: product.id,
      name: NAMES.get(product.id)!,
      brand: product.brand,
      category: product.category,
      image: product.image,
      source: product.source,
    })),
    { onConflict: 'id' },
  )
  if (updateError) throw new Error(`Philipsテレビ名の更新に失敗: ${updateError.message}`)
  console.log(`${data.length}件のPhilipsテレビ名を更新しました`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
