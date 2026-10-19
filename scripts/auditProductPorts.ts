/**
 * 商品DBのポート構成を全カテゴリで点検する（手元PCから実行する）
 *
 *   npm run audit:ports
 *   npm run audit:ports -- --category Dock,Hub
 *
 * 件数だけでなく「予測変換で選んだあと、ユーザーがそのまま保存したら何になるか」を
 * buildGadgetPorts で再現する。保存後に**DBに無い口が増える**データは、フォームが表現できない
 * 構成を商品DBが持っているということなので、商品DB側の誤り。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GadgetCategory, Port } from '../src/types'
import { createAdminClient, loadEnv } from './importRakuten'
import { rebuildOnSave } from './productPortRules'
import { GROUPS } from './researchProductPorts'

type Row = {
  id: string
  name: string
  category: string
  source: string | null
  ports: unknown
  specs_source_url: string | null
}

function portKey(port: Port): string {
  return `${portIdentity(port)}/${port.label ?? ''}`
}

/** ラベルはフォーム側が付け直すので、口が増えたかの判定には使わない */
function portIdentity(port: Port): string {
  return [
    port.type,
    port.direction,
    port.count,
    port.directAttach ? 'direct' : '',
    port.supportsVideo === undefined ? '' : `video:${port.supportsVideo}`,
    port.supportsPowerDelivery === undefined ? '' : `pd:${port.supportsPowerDelivery}`,
    port.supportsPoE === undefined ? '' : `poe:${port.supportsPoE}`,
    port.supportsDisplayConversion === undefined ? '' : `conversion:${port.supportsDisplayConversion}`,
    port.powerAdapterIncluded === undefined ? '' : `adapter:${port.powerAdapterIncluded}`,
  ].join('/')
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
  loadEnv()
  const db = createAdminClient()
  // GROUPS.all には Monitor / MobileBattery が既に入っている。重ねると同じ商品を2回数え、
  // 要修正の件数が実際の倍に出る（Dell U2725QE 1件が2件に見えていた）。
  // GROUPS はポート調査（research）の実行単位で、監査の対象範囲とは別物。
  // ポートを持つのに GROUPS に無いカテゴリ（VRGlass・UPS・Smartwatch・Printer3D・PC・Camera）が
  // 監査から丸ごと漏れていたので、CATEGORY_PORT_CONFIG を持つ分をここで足す
  const AUDIT_ONLY_CATEGORIES: GadgetCategory[] = [
    'Keyboard', 'Monitor', 'TV', 'MobileBattery',
    'VRGlass', 'UPS', 'Smartwatch', 'Printer3D', 'PC', 'Camera',
  ]
  const categories = (argValue('--category')?.split(',').filter(Boolean) as GadgetCategory[] | undefined)
    ?? ([...new Set([...GROUPS.all, ...AUDIT_ONLY_CATEGORIES])] as GadgetCategory[])

  const summary: Array<{ category: string; 商品数: number; ポートあり: number; 割合: string; ページ確認: number; 要修正: number }> = []
  const mismatches: Array<{ id: string; category: string; name: string; stored: string; rebuilt: string }> = []
  const emptyConnection: Array<{ id: string; category: string; name: string }> = []

  for (const category of categories) {
    // Supabase の max-rows は 1000。range の終端を大きくしても 1000 件で黙って切れるため、
    // 1000 件を超えるカテゴリ（Instrument 等）が監査対象から丸ごと漏れていた
    const rows: Row[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('products')
        .select('id,name,category,source,ports,specs_source_url')
        .eq('category', category)
        .order('name')
        .range(from, from + 999)
      if (error) throw new Error(`${category} の取得に失敗: ${error.message}`)
      rows.push(...((data ?? []) as Row[]))
      if (!data || data.length < 1000) break
    }
    if (rows.length === 0) continue
    const withPorts = rows.filter((row) => Array.isArray(row.ports) && (row.ports as Port[]).length > 0)
    let broken = 0

    for (const row of withPorts) {
      const ports = row.ports as Port[]
      if (ports.some((port) => !port.type || !port.direction || !(port.count > 0))) {
        emptyConnection.push({ id: row.id, category, name: row.name })
        broken += 1
        continue
      }
      const rebuilt = rebuildOnSave(category, ports)
      const storedKeys = new Set(ports.map(portIdentity))
      // 保存で落ちる口は仕様（フォームは接続方式を1つしか持てない）。増える口だけが誤り
      const added = rebuilt.filter((port) => !storedKeys.has(portIdentity(port)))
      if (added.length > 0) {
        mismatches.push({
          id: row.id,
          category,
          name: row.name,
          stored: ports.map(portKey).join(' , '),
          rebuilt: rebuilt.map(portKey).join(' , '),
        })
        broken += 1
      }
    }

    summary.push({
      category,
      商品数: rows.length,
      ポートあり: withPorts.length,
      割合: `${Math.round(withPorts.length / rows.length * 100)}%`,
      ページ確認: withPorts.filter((row) => row.specs_source_url).length,
      要修正: broken,
    })
  }

  const backupDir = resolve(process.cwd(), '.codex-backups')
  mkdirSync(backupDir, { recursive: true })
  const outputPath = resolve(backupDir, `product-port-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outputPath, JSON.stringify({ mismatches, emptyConnection }, null, 2))

  console.table(summary)
  console.log(`保存で口が増える（フォームが表現できない構成）: ${mismatches.length}件`)
  for (const mismatch of mismatches.slice(0, 5)) {
    console.log(`  [${mismatch.category}] ${mismatch.name.slice(0, 44)}\n    DB   : ${mismatch.stored}\n    保存後: ${mismatch.rebuilt}`)
  }
  console.log(`壊れたポート定義: ${emptyConnection.length}件`)
  console.log(`詳細: ${outputPath}`)
  if (mismatches.length > 0 || emptyConnection.length > 0) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
