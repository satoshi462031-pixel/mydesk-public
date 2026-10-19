import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const sources = [
  { region: 'JP', name: 'トバログ', domain: 'tobalog.com', api: 'https://tobalog.com/wp-json/wp/v2/posts' },
  { region: 'JP', name: 'Gadget Shot', domain: 'gadget-shot.com', api: 'https://gadget-shot.com/wp-json/wp/v2/posts' },
  { region: 'JP', name: 'デイリーガジェット', domain: 'daily-gadget.net', api: 'https://daily-gadget.net/wp-json/wp/v2/posts' },
  { region: 'JP', name: 'ウインタブ', domain: 'win-tab.net', api: 'https://win-tab.net/wp-json/wp/v2/posts' },
  { region: 'JP', name: 'makkyon web', domain: 'makkyon.com', api: 'https://www.makkyon.com/wp-json/wp/v2/posts' },
  { region: 'INTL', name: '9to5Mac', domain: '9to5mac.com', api: 'https://9to5mac.com/wp-json/wp/v2/posts' },
  { region: 'INTL', name: 'The Gadgeteer', domain: 'the-gadgeteer.com', api: 'https://the-gadgeteer.com/wp-json/wp/v2/posts' },
  { region: 'INTL', name: 'Gotta Be Mobile', domain: 'gottabemobile.com', api: 'https://www.gottabemobile.com/wp-json/wp/v2/posts' },
  { region: 'INTL', name: 'Ubergizmo', domain: 'ubergizmo.com', api: 'https://www.ubergizmo.com/wp-json/wp/v2/posts' },
  { region: 'INTL', name: 'CoolThings', domain: 'coolthings.com', api: 'https://www.coolthings.com/wp-json/wp/v2/posts' },
]

const themes = {
  desk_workspace: /(?:desk|workspace|workstation|home office|battlestation|デスク|机|作業環境|書斎|ワークスペース)/i,
  ergonomics_furniture: /(?:ergonomic|chair|standing desk|monitor arm|footrest|椅子|チェア|昇降|モニターアーム|姿勢|エルゴノミクス)/i,
  monitor_display: /(?:monitor|display|screen|モニター|ディスプレイ|画面)/i,
  keyboard_mouse: /(?:keyboard|mouse|trackpad|trackball|キーボード|マウス|トラックパッド|トラックボール)/i,
  charging_cables_docks: /(?:charg|battery|cable|dock|hub|power station|USB|充電|バッテリー|ケーブル|ドック|ハブ|電源)/i,
  audio: /(?:headphone|earphone|earbud|speaker|microphone|audio|ヘッドホン|イヤホン|スピーカー|マイク|オーディオ)/i,
  camera_creator: /(?:camera|lens|video|creator|stream|カメラ|レンズ|動画|撮影|配信|クリエイター)/i,
  mobile_tablet: /(?:iPhone|Android|smartphone|iPad|tablet|phone|スマホ|タブレット|携帯)/i,
  pc_mac: /(?:Mac|Windows|PC|laptop|computer|Chromebook|パソコン|ノートPC)/i,
  gaming: /(?:gaming|game|PlayStation|Xbox|Nintendo|Switch|ゲーミング|ゲーム)/i,
  smart_home: /(?:smart home|smart light|homekit|Alexa|Matter|スマートホーム|スマートライト|照明)/i,
  storage_organization: /(?:storage|organizer|pegboard|shelf|drawer|収納|整理|棚|引き出し|有孔ボード)/i,
  ai_software: /(?:\bAI\b|artificial intelligence|\bapps?\b|software|ChatGPT|アプリ|ソフトウェア|人工知能)/i,
  edc_bag: /(?:\bEDC\b|everyday carry|bag|backpack|wallet|ポーチ|バッグ|リュック|財布|カバンの中身|持ち物)/i,
}

const formats = {
  review: /(?:review|hands-on|tested|レビュー|使ってみた|実機)/i,
  guide_howto: /(?:how to|guide|tips|best way|方法|使い方|活用|比較|選び方|おすすめ)/i,
  deal_price: /(?:deal|sale|discount|coupon|price|セール|割引|クーポン|価格|特価)/i,
  personal_setup: /(?:my desk|my setup|desk tour|workspace tour|what(?:'s| is) on my desk|デスクツアー|デスク環境|買ってよかった|愛用|私の|僕の)/i,
  news_launch: /(?:launch|announc|unveil|release|new |debut|発表|発売|登場|新製品|リリース)/i,
}

const deskSignals = {
  clean_minimal_aesthetic: /(?:clean|minimal|aesthetic|cozy|beautiful|style|スッキリ|すっきり|ミニマル|おしゃれ|美しい|映え|統一感)/i,
  productivity_workflow: /(?:productiv|workflow|efficien|focus|work from home|WFH|生産性|効率|集中|仕事|在宅|ワークフロー)/i,
  compact_small_space: /(?:compact|small space|tiny|space.sav|省スペース|コンパクト|狭い|小型)/i,
  cable_management: /(?:cable management|cable tray|wire management|配線|ケーブル整理|ケーブルトレー)/i,
  modular_flexible: /(?:modular|flexible|adjustable|remix|customi[sz]|モジュール|可変|調整|カスタム|組み替え)/i,
  budget_value: /(?:budget|affordable|value|cheap|under \$|コスパ|予算|安い|円以下|価格)/i,
  ergonomics_health: /(?:ergonomic|posture|comfort|health|standing|sit.stand|姿勢|健康|快適|昇降|エルゴノミクス)/i,
  use_case_creator: /(?:creator|stream|video edit|photo edit|music production|クリエイター|配信|動画編集|写真編集|音楽制作|撮影)/i,
  use_case_gaming: /(?:gaming|game|PlayStation|Xbox|Nintendo|Switch|ゲーミング|ゲーム)/i,
  use_case_developer: /(?:developer|programming|coding|engineer|開発者|プログラミング|コーディング|エンジニア)/i,
}

const brands = {
  Apple: /\bApple\b|iPhone|iPad|\bMac(?:Book| mini| Studio| Pro)?\b/i,
  Anker: /\bAnker\b/i,
  UGREEN: /\bUGREEN\b/i,
  Belkin: /\bBelkin\b/i,
  Logitech: /\bLogitech\b|ロジクール/i,
  Keychron: /\bKeychron\b/i,
  Dell: /\bDell\b/i,
  BenQ: /\bBenQ\b/i,
  Samsung: /\bSamsung\b|Galaxy/i,
  Sony: /\bSony\b|ソニー/i,
  Bose: /\bBose\b/i,
  IKEA: /\bIKEA\b|イケア/i,
  FlexiSpot: /\bFlexiSpot\b/i,
  'Herman Miller': /Herman Miller|ハーマンミラー/i,
  Steelcase: /\bSteelcase\b/i,
  Elgato: /\bElgato\b/i,
  Grovemade: /\bGrovemade\b/i,
  Oakywood: /\bOakywood\b/i,
  Razer: /\bRazer\b/i,
  Corsair: /\bCorsair\b/i,
}

function decodeHtml(value = '') {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'MyDeskResearch/1.0 (+https://mydesk.page/; metadata research)' },
  })
  if (response.ok) return response.json()
  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 1000))
    return fetchJson(url, attempt + 1)
  }
  throw new Error(`${response.status} ${response.statusText}: ${url}`)
}

async function collect(source) {
  const rows = []
  for (let page = 1; page <= 10; page += 1) {
    const url = new URL(source.api)
    url.searchParams.set('per_page', '100')
    url.searchParams.set('page', String(page))
    url.searchParams.set('orderby', 'date')
    url.searchParams.set('order', 'desc')
    url.searchParams.set('_fields', 'id,date,link,title,excerpt')
    const posts = await fetchJson(url)
    for (const post of posts) {
      const title = decodeHtml(post.title?.rendered)
      const excerpt = decodeHtml(post.excerpt?.rendered)
      const haystack = `${title} ${excerpt}`
      rows.push({
        region: source.region,
        source: source.name,
        domain: source.domain,
        id: post.id,
        date: post.date,
        url: post.link,
        title,
        excerpt,
        themes: Object.entries(themes).filter(([, regex]) => regex.test(haystack)).map(([key]) => key),
        formats: Object.entries(formats).filter(([, regex]) => regex.test(haystack)).map(([key]) => key),
      })
    }
  }
  if (rows.length !== 1000) throw new Error(`${source.name}: expected 1000 posts, got ${rows.length}`)
  return rows
}

function countTags(rows, field, keys) {
  return Object.fromEntries(keys.map((key) => [key, rows.filter((row) => row[field].includes(key)).length]))
}

function pct(count, total) {
  return `${((count / total) * 100).toFixed(1)}%`
}

function tableForComparison(jpCounts, intlCounts, jpTotal = 5000, intlTotal = jpTotal) {
  return Object.keys(jpCounts)
    .map((key) => `| ${key} | ${jpCounts[key]} (${pct(jpCounts[key], jpTotal)}) | ${intlCounts[key]} (${pct(intlCounts[key], intlTotal)}) | ${(jpCounts[key] / jpTotal - intlCounts[key] / intlTotal >= 0 ? '+' : '') + ((jpCounts[key] / jpTotal - intlCounts[key] / intlTotal) * 100).toFixed(1)}pt |`)
    .join('\n')
}

const outputDir = path.resolve('outputs', 'gadget-blog-research-10000')
await mkdir(outputDir, { recursive: true })

const allRows = []
for (const source of sources) {
  process.stdout.write(`Collecting ${source.name}... `)
  const rows = await collect(source)
  allRows.push(...rows)
  process.stdout.write(`${rows.length}\n`)
}

const byRegion = {
  JP: allRows.filter((row) => row.region === 'JP'),
  INTL: allRows.filter((row) => row.region === 'INTL'),
}
const themeKeys = Object.keys(themes)
const formatKeys = Object.keys(formats)
const themeCounts = {
  JP: countTags(byRegion.JP, 'themes', themeKeys),
  INTL: countTags(byRegion.INTL, 'themes', themeKeys),
}
const formatCounts = {
  JP: countTags(byRegion.JP, 'formats', formatKeys),
  INTL: countTags(byRegion.INTL, 'formats', formatKeys),
}
const sourceStats = sources.map((source) => {
  const rows = allRows.filter((row) => row.source === source.name)
  return {
    ...source,
    count: rows.length,
    from: rows.at(-1)?.date,
    to: rows.at(0)?.date,
    deskWorkspace: rows.filter((row) => row.themes.includes('desk_workspace')).length,
    personalSetup: rows.filter((row) => row.formats.includes('personal_setup')).length,
  }
})

const deskRows = allRows.filter((row) => row.themes.includes('desk_workspace'))
const deskSignalCounts = Object.fromEntries(Object.entries(byRegion).map(([region, rows]) => {
  const relevant = rows.filter((row) => row.themes.includes('desk_workspace'))
  return [region, Object.fromEntries(Object.entries(deskSignals).map(([key, regex]) => [key, relevant.filter((row) => regex.test(`${row.title} ${row.excerpt}`)).length]))]
}))
const brandCountsInDesk = Object.fromEntries(Object.entries(byRegion).map(([region, rows]) => {
  const relevant = rows.filter((row) => row.themes.includes('desk_workspace'))
  return [region, Object.fromEntries(Object.entries(brands).map(([key, regex]) => [key, relevant.filter((row) => regex.test(`${row.title} ${row.excerpt}`)).length]))]
}))
const analysis = {
  generatedAt: new Date().toISOString(),
  methodology: 'Each of 10 WordPress gadget publications contributed its 1,000 most recent public posts. Classification uses title and excerpt keyword rules; famous-creator case studies are separate qualitative evidence.',
  total: allRows.length,
  regionTotals: { JP: byRegion.JP.length, INTL: byRegion.INTL.length },
  sources: sourceStats,
  themeCounts,
  formatCounts,
  deskWorkspaceCount: { JP: deskRows.filter((row) => row.region === 'JP').length, INTL: deskRows.filter((row) => row.region === 'INTL').length },
  deskSignalCounts,
  brandCountsInDesk,
}

await writeFile(path.join(outputDir, 'articles.ndjson'), allRows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8')
await writeFile(path.join(outputDir, 'analysis.json'), JSON.stringify(analysis, null, 2) + '\n', 'utf8')

const sourceTable = sourceStats.map((s) => `| ${s.region} | ${s.name} | ${s.count} | ${s.from.slice(0, 10)}〜${s.to.slice(0, 10)} | ${s.deskWorkspace} | ${s.personalSetup} |`).join('\n')
const report = `# ガジェット系ブログ10,000記事 日英比較（定量編）

生成日時: ${analysis.generatedAt}

## 調査設計

- 日本5媒体・海外5媒体から、公開WordPress APIで各1,000記事、合計10,000記事を取得。
- 日本5,000件、海外5,000件で件数を揃えた。
- 定量分類はタイトルと抜粋に対する再現可能なキーワード判定。本文を1万本すべて精読した結果ではない。
- 著名クリエイターの本文・動画事例は、この定量結果とは分けて評価する。

## 媒体と期間

| 地域 | 媒体 | 件数 | 対象期間 | デスク系 | 個人セットアップ系 |
|---|---|---:|---|---:|---:|
${sourceTable}

## テーマ比較

| テーマ | 日本（n=5,000） | 海外（n=5,000） | 日本−海外 |
|---|---:|---:|---:|
${tableForComparison(themeCounts.JP, themeCounts.INTL)}

## 記事形式比較

| 形式 | 日本（n=5,000） | 海外（n=5,000） | 日本−海外 |
|---|---:|---:|---:|
${tableForComparison(formatCounts.JP, formatCounts.INTL)}

## デスク関連記事の訴求比較

母数は日本${analysis.deskWorkspaceCount.JP}件、海外${analysis.deskWorkspaceCount.INTL}件。

| 訴求 | 日本 | 海外 | 日本−海外 |
|---|---:|---:|---:|
${tableForComparison(deskSignalCounts.JP, deskSignalCounts.INTL, analysis.deskWorkspaceCount.JP, analysis.deskWorkspaceCount.INTL)}

## デスク関連記事のブランド出現

| ブランド | 日本 | 海外 |
|---|---:|---:|
${Object.keys(brands).map((key) => `| ${key} | ${brandCountsInDesk.JP[key]} | ${brandCountsInDesk.INTL[key]} |`).join('\n')}

## データ

- \`articles.ndjson\`: 10,000記事の出典、タイトル、抜粋、分類
- \`analysis.json\`: 集計値と媒体別期間
`
await writeFile(path.join(outputDir, 'quantitative-report.md'), report, 'utf8')
console.log(`Wrote ${allRows.length} rows to ${outputDir}`)
