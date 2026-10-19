import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ALL_PRODUCT_PRESETS } from '../src/constants/gadgetPresets'
import { extractProductModel, prioritizeProductIdentity } from '../src/utils/productName'

type ProductRow = {
  id: string
  name: string | null
  brand: string | null
  category: string | null
  source: string | null
}

function loadEnvFile(): void {
  const raw = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match || process.env[match[1]] !== undefined) continue
    process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
}

function invalidName(name: unknown): boolean {
  if (typeof name !== 'string' || !name.trim()) return true
  return /^(?:undefined|null|商品名|名称未設定|未設定)$/i.test(name.trim())
}

const MODEL_EXPECTED_CATEGORIES = new Set([
  'PC', 'Monitor', 'Storage', 'Printer', 'Printer3D', 'Mouse', 'Keyboard', 'PenTablet',
  'Hub', 'Dock', 'PowerStrip', 'KVM', 'UPS', 'Webcam', 'Headphone', 'Earphone',
  'Speaker', 'Router', 'Modem', 'GameConsole', 'MobileBattery', 'Charger', 'Smartphone',
  'Tablet', 'Smartwatch', 'AudioInterface', 'Mixer', 'Microphone', 'HeadphoneAmp',
  'Amplifier', 'CaptureDevice', 'Controller', 'VRGlass', 'SmartHome', 'Projector',
  'PCPartCPU', 'PCPartGPU', 'PCPartMemory', 'PCPartStorage',
])

async function main(): Promise<void> {
  const localInvalid = ALL_PRODUCT_PRESETS.filter((product) => invalidName(product.name))
  const localReordered = ALL_PRODUCT_PRESETS.filter((product) => {
    const typed = product as typeof product & { brand?: string }
    return prioritizeProductIdentity(product.name, typed.brand) !== product.name.trim()
  })

  loadEnvFile()
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase の接続設定がありません')
  const db = createClient(url, key)

  const rows: ProductRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id, name, brand, category, source')
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    rows.push(...((data ?? []) as ProductRow[]))
    if (!data || data.length < 1000) break
  }

  const remoteInvalid = rows.filter((product) => invalidName(product.name))
  const missingBrand = rows.filter((product) => !product.brand?.trim())
  const brandNotFirst = rows.filter((product) => {
    if (!product.name || !product.brand) return false
    return !product.name.toLocaleLowerCase().startsWith(product.brand.toLocaleLowerCase())
  })
  const reordered = rows.filter((product) => {
    if (!product.name) return false
    return prioritizeProductIdentity(product.name, product.brand ?? undefined) !== product.name.trim()
  })
  const nameLength48 = rows.filter((product) => [...(product.name ?? '')].length === 48)
  const nameLength40To48 = rows.filter((product) => {
    const length = [...(product.name ?? '')].length
    return length >= 40 && length <= 48
  })
  const modelExpected = rows.filter((product) => MODEL_EXPECTED_CATEGORIES.has(product.category ?? ''))
  const missingModel = modelExpected.filter((product) => !extractProductModel(product.name ?? ''))
  const truncatedMissingModel = missingModel.filter((product) => [...(product.name ?? '')].length === 48)
  const categoryModelAudit = [...MODEL_EXPECTED_CATEGORIES]
    .map((category) => {
      const products = modelExpected.filter((product) => product.category === category)
      const missing = products.filter((product) => !extractProductModel(product.name ?? ''))
      const truncated = missing.filter((product) => [...(product.name ?? '')].length === 48)
      return { category, total: products.length, missing: missing.length, truncated: truncated.length }
    })
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.missing - a.missing)
  const sourceCounts = Object.fromEntries(
    [...new Set(rows.map((product) => product.source ?? 'unknown'))]
      .sort()
      .map((source) => [source, rows.filter((product) => (product.source ?? 'unknown') === source).length]),
  )

  console.log(JSON.stringify({
    local: {
      total: ALL_PRODUCT_PRESETS.length,
      invalidNames: localInvalid.length,
      reorderedWithStoredBrand: localReordered.length,
    },
    database: {
      total: rows.length,
      sourceCounts,
      invalidNames: remoteInvalid.length,
      missingBrand: missingBrand.length,
      brandNotFirst: brandNotFirst.length,
      reorderable: reordered.length,
      nameLength48: nameLength48.length,
      nameLength40To48: nameLength40To48.length,
      modelExpected: modelExpected.length,
      missingModel: missingModel.length,
      truncatedMissingModel: truncatedMissingModel.length,
      categoryModelAudit,
      missingModelSamples: missingModel.slice(0, 20).map((product) => ({
        category: product.category,
        name: product.name,
        brand: product.brand,
      })),
      invalidSamples: remoteInvalid.slice(0, 10).map((product) => product.name),
      brandNotFirstSamples: brandNotFirst.slice(0, 10).map((product) => ({
        name: product.name,
        brand: product.brand,
      })),
      reorderSamples: reordered.slice(0, 10).map((product) => ({
        before: product.name,
        after: prioritizeProductIdentity(product.name ?? '', product.brand ?? undefined),
      })),
    },
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
