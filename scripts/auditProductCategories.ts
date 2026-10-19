import { createClient } from '@supabase/supabase-js'
import { loadEnv } from './importRakuten'

type Product = { id: string; name: string; category: string | null; source: string | null }

const CLUSTERS: Record<string, Array<[string, RegExp]>> = {
  GameConsole: [
    ['周辺機器', /ケース|カバー|コントローラ|保護|スタンド|アダプタ|ケーブル|交換|修理|パーツ|収納|フィルム/i],
    ['ゲームソフト', /ゲームソフト|ソフト\b|HAC-P-|ELJM-|PLJM-|CERO/i],
    ['ゲーム機本体', /本体|Nintendo Switch(?: 2)?\b|PlayStation\s*[45]\b|PS[45]\b|Xbox Series/i],
  ],
  Headphone: [
    ['ヘッドセット', /ヘッドセット|マイク付き|ゲーミング/i],
    ['イヤホン', /イヤホン|イヤフォン|earbuds?|in-ear|カナル/i],
    ['ヘッドホン', /ヘッドホン|ヘッドフォン|headphones?|オーバーイヤー|モニター/i],
  ],
  Keyboard: [
    ['テンキー', /テンキー|numeric keypad|number pad/i],
    ['ゲーミング', /ゲーミング|gaming|ラピッドトリガー/i],
    ['キーボード', /キーボード|keyboard/i],
  ],
  AudioInterface: [
    ['DAW・音源ソフト', /DAW|Cubase|Ableton|音源|プラグイン|ソフトウェア/i],
    ['レコーダー', /レコーダー|録音|フィールドレコーダー/i],
    ['サウンドカード', /サウンドカード|PCIe.*audio|USBオーディオ/i],
    ['オーディオIF', /オーディオインターフェ|audio interface/i],
    ['DAC', /\bDAC\b|D\/Aコンバーター/i],
  ],
  Speaker: [
    ['サウンドバー', /サウンドバー|soundbar/i],
    ['モニタースピーカー', /モニタースピーカー|スタジオモニター/i],
    ['Bluetooth・ポータブル', /Bluetooth|ポータブル|ワイヤレススピーカー/i],
    ['パッシブ', /パッシブ|ブックシェルフ|センタースピーカー|スピーカー\s*(?:ペア|セット)/i],
  ],
  Mixer: [
    ['DJ機器', /DJ|ターンテーブル|スクラッチ|DJコントローラー/i],
    ['オーディオミキサー', /ミキサー|mixer|ミキシング/i],
  ],
  SmallDevice: [
    ['PCパーツ', /マザーボード|PCケース|電源ユニット|CPUクーラー|ケースファン|水冷|グラフィック/i],
    ['プロジェクター', /プロジェクター/i],
    ['カメラ', /デジタルカメラ|ミラーレス|一眼レフ|コンデジ/i],
    ['カードリーダー', /カードリーダー|ICカード/i],
    ['ストリーミング端末', /Fire TV|Chromecast|ストリーミング|Apple TV/i],
    ['時計・温湿度計', /時計|温度計|湿度計/i],
    ['映像アダプター', /ワイヤレスディスプレイ|Miracast|映像変換/i],
  ],
  Accessory: [
    ['保護フィルム', /保護フィルム|覗き見|プライバシーフィルター/i],
    ['スタンド', /スタンド|ホルダー/i],
    ['マイク用品', /ポップガード|ウインドスクリーン|ショックマウント/i],
    ['USB小物', /USB|冷却パッド|ノートPCクーラー/i],
    ['インテリア小物', /置物|オブジェ|インテリア/i],
  ],
  Furniture: [
    ['収納', /収納|キャビネット|ワゴン|書庫|ロッカー|棚/i],
    ['パーテーション', /パーテーション|間仕切り/i],
    ['応接・役員家具', /応接|役員|社長/i],
    ['その他備品', /スモーキング|灰皿|連結金具/i],
  ],
}

async function main(): Promise<void> {
  loadEnv()
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase の接続設定がありません')
  const db = createClient(url, key)
  const products: Product[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('id, name, category, source')
      .range(from, from + 999)
    if (error) throw new Error(`products の取得に失敗: ${error.message}`)
    products.push(...((data ?? []) as Product[]))
    if (!data || data.length < 1000) break
  }

  const categories = [...new Set(products.map((product) => product.category ?? '未分類'))]
    .map((category) => {
      const rows = products.filter((product) => (product.category ?? '未分類') === category)
      const clusters = (CLUSTERS[category] ?? []).map(([label, pattern]) => ({
        label,
        count: rows.filter((product) => pattern.test(product.name)).length,
      }))
      return {
        category,
        total: rows.length,
        preset: rows.filter((product) => product.source === 'preset').length,
        rakuten: rows.filter((product) => product.source === 'rakuten').length,
        clusters,
        samples: rows.filter((product) => product.source === 'rakuten').slice(0, 8).map((product) => product.name),
      }
    })
    .sort((a, b) => b.total - a.total)

  console.log(JSON.stringify({ total: products.length, categories }, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
