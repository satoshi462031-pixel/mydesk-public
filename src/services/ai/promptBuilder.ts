import type { DeskPlan, Gadget, MapConnection, PlanPurpose } from '../../types'
import { truncateChars } from '../../utils/truncateText'
import { connectionsOnDesk } from '../../utils/planWiring'
import { countsAsDevice, gadgetQuantity, isOwnedGadget, sumGadgetPrices, validGadgetPrice } from '../../utils/gadgetStats'
import { applyDeskGadgetUsage } from '../../utils/deskGadgetUsage'

export interface AIContextSelection {
  includeGear: boolean
  includeWiring: boolean
  includeFinancial: boolean
  includeDates: boolean
}

export const DEFAULT_AI_CONTEXT_SELECTION: AIContextSelection = {
  includeGear: true,
  includeWiring: true,
  includeFinancial: false,
  includeDates: false,
}

/**
 * 他人の公開デスクを送るときの項目。
 *
 * 機材と配線は公開ページに出ているものだが、価格と購入日は投稿者本人のもので、
 * その人はAIへ送ることに同意していない。既定（DEFAULT_AI_CONTEXT_SELECTION）が
 * 両方オフなので普段は通らないが、自分のデスクでオンにしたまま他人のデスクを
 * 添付すると、その設定が引き継がれて送られてしまう。画面のトグルを隠すだけでは
 * 止まらないので、組み立てに渡す直前にここで落とす。
 */
export function foreignDeskContextSelection(selection: AIContextSelection): AIContextSelection {
  return { ...selection, includeFinancial: false, includeDates: false }
}

const MAX_GADGETS = 50
const MAX_PORTS_PER_GADGET = 20
const MAX_CONNECTIONS = 100
const MAX_DESK_CONTEXT_CHARS = 30_000

const PURPOSE_LABELS: Record<PlanPurpose, { ja: string; en: string }> = {
  gaming: { ja: 'ゲーム', en: 'Gaming' },
  work: { ja: '仕事', en: 'Remote work' },
  dev: { ja: '開発・プログラミング', en: 'Software development' },
  creative: { ja: 'クリエイティブ', en: 'Creative' },
  streaming: { ja: '配信・録画', en: 'Streaming / Recording' },
  study: { ja: '学習・勉強', en: 'Study' },
  music: { ja: '音楽・DTM', en: 'Music / DTM' },
  other: { ja: 'その他', en: 'Other' },
}

function escapePromptData(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function booleanCapability(value: boolean | undefined, ja: string, en: string, lang: 'ja' | 'en'): string | null {
  if (value == null) return null
  return `${lang === 'en' ? en : ja}: ${value ? (lang === 'en' ? 'yes' : '対応') : (lang === 'en' ? 'no' : '非対応')}`
}

function gadgetSpecs(gadget: Gadget, lang: 'ja' | 'en'): string[] {
  const specs: Array<[string, string, string | boolean | undefined]> = [
    ['型番', 'Model', gadget.model],
    ['寸法', 'Dimensions', gadget.dimensions],
    ['OS', 'OS', gadget.pcOs],
    ['CPU', 'CPU', gadget.pcCpu],
    ['GPU', 'GPU', gadget.pcGpu],
    ['RAM', 'RAM', gadget.pcRam],
    ['ストレージ', 'Storage', gadget.pcStorage ?? gadget.storageCapacity],
    ['Thunderbolt', 'Thunderbolt', gadget.pcThunderbolt],
    ['画面サイズ', 'Screen size', gadget.monitorSizeInches],
    ['解像度', 'Resolution', gadget.monitorResolution],
    ['リフレッシュレート', 'Refresh rate', gadget.monitorRefreshRateHz],
    ['バッテリー容量(mAh)', 'Battery capacity (mAh)', gadget.batteryCapacityMah],
    ['バッテリー容量(Wh)', 'Battery capacity (Wh)', gadget.batteryCapacityWh],
    ['パススルー充電', 'Pass-through charging', gadget.supportsPassThroughCharging],
    ['電源方式', 'Power usage', gadget.powerUsage],
  ]
  return specs.flatMap(([ja, en, value]) => {
    if (value == null || value === '') return []
    const rendered = typeof value === 'boolean'
      ? value ? (lang === 'en' ? 'yes' : '対応') : (lang === 'en' ? 'no' : '非対応')
      : escapePromptData(String(value))
    return [`${lang === 'en' ? en : ja}: ${rendered}`]
  })
}

function capDeskContext(value: string, lang: 'ja' | 'en'): string {
  if (value.length <= MAX_DESK_CONTEXT_CHARS) return value
  const suffix = lang === 'en'
    ? '\n...(desk data truncated to the transmission limit)\n</desk_data>'
    : '\n…（送信上限に合わせてデスク情報を省略しました）\n</desk_data>'
  return truncateChars(value, MAX_DESK_CONTEXT_CHARS - suffix.length) + suffix
}

function gadgetStatus(g: Gadget, lang: 'ja' | 'en'): string {
  return [
    g.isCandidate ? (lang === 'en' ? 'purchase candidate' : '購入候補') : g.isPlaceholder
      ? (lang === 'en' ? 'ownership recorded for an unnamed slot' : '所有として登録した未設定枠') : (lang === 'en' ? 'owned' : '所有'),
    g.isPlaceholder ? (lang === 'en' ? 'unnamed placeholder; specifications unknown' : '商品未設定の枠・仕様不明') : null,
    g.displayOnly ? (lang === 'en' ? 'decoration; no wiring needed' : '飾り・配線不要') : null,
  ].filter(Boolean).join(' / ')
}

function gadgetDates(g: Gadget, lang: 'ja' | 'en'): string {
  const periods = g.deskUsagePeriods ?? []
  const first = periods[0]
  const source = first?.startedAtSource === 'manual'
    ? (lang === 'en' ? 'manually recorded' : '手入力')
    : (lang === 'en' ? 'automatic operation date; actual date unknown' : '自動記録の操作日・実際の導入日は不明')
  const date = first?.startedAt ?? g.purchasedAt
  const introduction = date ? `${escapePromptData(date)} (${source})` : (lang === 'en' ? 'unknown / not set' : '不明・未設定')
  const history = periods.slice(0, 20).map((p) => {
    const startSource = p.startedAtSource === 'manual' ? 'manual' : 'auto'
    const endSource = p.endedAtSource === 'manual' ? 'manual' : 'auto'
    return `${escapePromptData(p.startedAt)} [${startSource}] → ${p.endedAt ? `${escapePromptData(p.endedAt)} [${endSource}]` : (lang === 'en' ? 'ongoing' : '継続中')} (${p.mode})`
  }).join('; ')
  return `${lang === 'en' ? 'Introduced' : '導入日'}: ${introduction}${history ? ` · ${lang === 'en' ? 'Desk history' : 'デスク履歴'}: ${history}` : ''}`
}

function connectionDetails(connection: MapConnection, lang: 'ja' | 'en', branchLabels: Map<string, number>, portName?: string): string {
  const route = connection.route
  const paths = {
    direct: ['直結', 'direct'], under_desk: ['デスク下', 'under desk'], cable_tray: ['ケーブルトレー', 'cable tray'],
    along_wall: ['壁沿い', 'along wall'], through_wall: ['壁内', 'through wall'], floor: ['床', 'floor'],
  } as const
  const visibility = { visible: ['露出', 'visible'], partial: ['一部露出', 'partially visible'], hidden: ['隠す', 'hidden'] } as const
  const index = lang === 'en' ? 1 : 0
  return [
    `${lang === 'en' ? 'Count' : '本数'}: ${connection.count ?? 1}`,
    connection.branchGroupId ? `${lang === 'en' ? 'Shared physical cable group' : '同じ物理ケーブルの分岐グループ'}: ${branchLabels.get(connection.branchGroupId)}` : null,
    portName ? `${lang === 'en' ? 'Source port' : '給電元ポート'}: ${escapePromptData(portName)}` : null,
    `${lang === 'en' ? 'Cable used' : '使用ケーブル'}: ${connection.cableChoice?.kind === 'included'
      ? (lang === 'en' ? 'included (user recorded)' : '付属品（ユーザー記録）')
      : connection.cableChoice?.kind === 'product' ? escapePromptData(connection.cableChoice.name) : (lang === 'en' ? 'not set' : '未設定')}`,
    route?.lengthCm != null ? `${lang === 'en' ? 'Length' : '長さ'}: ${route.lengthCm} cm` : null,
    route?.path ? `${lang === 'en' ? 'Route' : '経路'}: ${paths[route.path][index]}` : null,
    route?.visibility ? `${lang === 'en' ? 'Visibility' : '見え方'}: ${visibility[route.visibility][index]}` : null,
    route?.note ? `${lang === 'en' ? 'Route note' : '経路メモ'}: ${escapePromptData(route.note)}` : null,
  ].filter(Boolean).join(' · ')
}

export function buildPlanAnalysisMessage(
  plan: DeskPlan,
  gadgets: Gadget[],
  lang: 'ja' | 'en' = 'ja',
  selection: AIContextSelection = DEFAULT_AI_CONTEXT_SELECTION,
  // 画面と同じ通貨で渡す（AppContext の fmtPrice）。英語の人に円で渡すと、画面はドルなのに
  // AIが円で答え、金額の話が噛み合わない
  formatPrice: (jpy: number) => string = (jpy) => `¥${jpy.toLocaleString('ja-JP')}`,
  source: 'own' | 'reference' = 'own',
): string {
  if (source === 'reference') selection = foreignDeskContextSelection(selection)
  const allPlanGadgets = plan.selectedGadgetIds
    .map(id => gadgets.find(g => g.id === id))
    .filter((g): g is NonNullable<typeof g> => g != null)
    .map((g) => applyDeskGadgetUsage(plan, g))
  // ケーブルは機器として並べると「ポート未登録」の機器に見え、種類も伝わらない。
  // 種類と本数を別の欄で渡し、必要ケーブルと突き合わせられるようにする
  const deviceGadgets = allPlanGadgets.filter(countsAsDevice)
  const ownedCables = allPlanGadgets.filter((g) => !countsAsDevice(g))
  const planGadgets = deviceGadgets.slice(0, MAX_GADGETS)

  // 画面の合計と同じく 単価×数量 で、ケーブルも含める
  const total = sumGadgetPrices(allPlanGadgets)
  const ownedTotal = sumGadgetPrices(allPlanGadgets.filter(isOwnedGadget))
  const candidateTotal = sumGadgetPrices(allPlanGadgets.filter((g) => g.isCandidate))
  const placeholderTotal = sumGadgetPrices(allPlanGadgets.filter((g) => g.isPlaceholder && !g.isCandidate))
  const financialLine = (g: Gadget) => {
    if (!selection.includeFinancial) return ''
    const price = validGadgetPrice(g)
    return ` · ${lang === 'en' ? 'Recorded price' : '記録価格'}: ${price == null
      ? (lang === 'en' ? 'not set' : '未設定')
      : `${formatPrice(price)} ×${gadgetQuantity(g)} = ${formatPrice(price * gadgetQuantity(g))}`}`
  }
  const separateLines = allPlanGadgets.slice(0, MAX_GADGETS).map((g) =>
    `- ${escapePromptData(g.name)} (${gadgetStatus(g, lang)})${financialLine(g)}${selection.includeDates ? ` · ${gadgetDates(g, lang)}` : ''}`,
  ).join('\n')
  const optionalSection = !selection.includeGear && (selection.includeFinancial || selection.includeDates)
    ? `\n\n**${lang === 'en' ? 'Selected price/date records' : '選択した価格・日付情報'}:**\n${separateLines}` : ''
  const totalsSection = selection.includeFinancial
    ? `\n\n**${lang === 'en' ? 'Recorded totals (unknown prices excluded; not current market prices)' : '記録金額の内訳（価格未設定を除く・現在の販売価格ではない）'}:** ${lang === 'en' ? 'Owned' : '所有'} ${formatPrice(ownedTotal)} / ${lang === 'en' ? 'Purchase candidates' : '購入候補'} ${formatPrice(candidateTotal)} / ${lang === 'en' ? 'Unnamed placeholders' : '商品未設定の枠'} ${formatPrice(placeholderTotal)}` : ''

  const purposes = (plan.purposes ?? []).map((purpose) => purpose === 'other' && plan.otherPurposeLabel
    ? escapePromptData(plan.otherPurposeLabel) : PURPOSE_LABELS[purpose][lang]).join(', ')
  const gadgetLines = selection.includeGear && planGadgets.length > 0
    ? planGadgets.map((g) => {
        const ports = g.ports.length > 0
          ? g.ports.slice(0, MAX_PORTS_PER_GADGET).map((port) => {
              const capabilities = [
                booleanCapability(port.supportsVideo, '映像', 'Video', lang),
                booleanCapability(port.supportsPowerDelivery, 'Power Delivery', 'Power Delivery', lang),
                booleanCapability(port.supportsPoE, 'PoE', 'PoE', lang),
                booleanCapability(port.supportsDisplayConversion, '映像変換', 'Display conversion', lang),
                booleanCapability(port.powerAdapterIncluded, '専用電源アダプター', 'Dedicated power adapter', lang),
                booleanCapability(port.directAttach, '直挿し', 'Direct attach', lang),
              ].filter((value): value is string => value != null)
              return `${port.type} ${port.direction} x${port.count}${port.label ? ` (${escapePromptData(port.label)})` : ''}${capabilities.length ? ` [${capabilities.join(', ')}]` : ''}`
            }).join(', ')
          : (lang === 'en' ? 'No ports registered' : 'ポート未登録')
        const name = escapePromptData(g.name)
        const financial = financialLine(g)
        const dates = selection.includeDates
          ? ` · ${gadgetDates(g, lang)}`
          : ''
        const specs = gadgetSpecs(g, lang)
        if (lang === 'en') {
          return `- ${name} (${g.category}${g.category === 'Other' && g.customCategory ? `: ${escapePromptData(g.customCategory.name)}` : ''}) ×${gadgetQuantity(g)} [${gadgetStatus(g, lang)}]${financial}${dates}\n  Port verification: ${g.portsNeedConfirmation ? 'needs confirmation' : 'no pending-confirmation flag; manufacturer verification unknown'}\n  Ports: ${ports}${specs.length ? `\n  Specs: ${specs.join(', ')}` : ''}`
        }
        return `- ${name}（${g.category}${g.category === 'Other' && g.customCategory ? `: ${escapePromptData(g.customCategory.name)}` : ''}）×${gadgetQuantity(g)} [${gadgetStatus(g, lang)}]${financial}${dates}\n  ポート確認状況: ${g.portsNeedConfirmation ? '要確認' : '要確認フラグなし・メーカー仕様との照合状況は不明'}\n  ポート: ${ports}${specs.length ? `\n  仕様: ${specs.join('、')}` : ''}`
      }).join('\n')
    : selection.includeGear
      ? (lang === 'en' ? '(No gadgets registered)' : '（機器未登録）')
      : (lang === 'en' ? '(Not shared)' : '（送信しない）')

  const ownedCableLines = selection.includeGear && ownedCables.length > 0
    ? ownedCables.slice(0, MAX_GADGETS).map((g) => {
        const type = g.cableType ?? (lang === 'en' ? 'type not set' : '種類未設定')
        return `- ${escapePromptData(g.name)}: ${type} ×${g.cableCount ?? 1} [${gadgetStatus(g, lang)}]${financialLine(g)}${selection.includeDates ? ` · ${gadgetDates(g, lang)}` : ''}`
      }).join('\n')
    : null
  const ownedCableSection = ownedCableLines
    ? `\n\n**${lang === 'en' ? 'Registered cables (status shown per item)' : '登録ケーブル（所有・候補は各行参照）'}:**\n${ownedCableLines}`
    : ''

  const gadgetNames = new Map(allPlanGadgets.map((g) => [g.id, g.name]))
  // 外した機材との線（戻したときの復活用に保存に残る）は送らない。名前が引けず ID のまま届く
  const mapConnections = connectionsOnDesk(plan.connectionMap?.connections ?? [], plan.selectedGadgetIds)
    .slice(0, MAX_CONNECTIONS)
  const wiringConnections = connectionsOnDesk(plan.wiringResult?.connections ?? [], plan.selectedGadgetIds).slice(0, MAX_CONNECTIONS)
  const branchLabels = new Map<string, number>()
  for (const c of mapConnections) if (c.branchGroupId && !branchLabels.has(c.branchGroupId)) branchLabels.set(c.branchGroupId, branchLabels.size + 1)
  const endpointName = (id: string) => escapePromptData(gadgetNames.get(id) ?? (id === 'wall' ? (lang === 'en' ? 'Wall outlet' : '壁コンセント') : id))
  const connectionLines = !selection.includeWiring
    ? (lang === 'en' ? '(Not shared)' : '（送信しない）')
    : mapConnections.length > 0
    ? mapConnections.map((connection) => {
        const from = endpointName(connection.fromGadgetId)
        const to = endpointName(connection.toGadgetId)
        const state = connection.confirmed
          ? (lang === 'en' ? 'user edited; physical connection unverified' : 'ユーザー編集済み・実物の接続確認は不明')
          : (lang === 'en' ? 'automatic suggestion; physical connection unverified' : '自動候補・実物の接続確認は不明')
        const wireless = connection.wireless ? (lang === 'en' ? ' · wireless' : '・無線') : ''
        const charging = connection.chargingOnly ? (lang === 'en' ? ' · charging only' : '・充電時のみ') : ''
        const port = allPlanGadgets.find((g) => g.id === connection.fromGadgetId)?.ports.find((p) => p.id === connection.sourcePortId)
        return `- ${from} → ${to}: ${connection.cableType} (${state}${wireless}${charging}) · ${connectionDetails(connection, lang, branchLabels, port ? `${port.type}${port.label ? ` (${port.label})` : ''}` : connection.sourcePortId)}`
      }).join('\n')
    : wiringConnections.length > 0
      ? wiringConnections.map((connection) => {
          const from = escapePromptData(gadgetNames.get(connection.fromGadgetId) ?? connection.fromGadgetId)
          const to = escapePromptData(gadgetNames.get(connection.toGadgetId) ?? connection.toGadgetId)
          const charging = connection.chargingOnly ? (lang === 'en' ? ' · charging only' : '・充電時のみ') : ''
          return `- ${from} (${connection.fromPortType}) → ${to} (${connection.toPortType}): ${connection.cableType} ×${connection.count ?? 1}${charging} (${lang === 'en' ? 'automatic suggestion; physical connection unverified' : '自動候補・実物の接続確認は不明'})`
        }).join('\n')
      : (lang === 'en' ? '(No connections registered)' : '（接続情報なし）')

  const cableLines = selection.includeWiring && plan.wiringResult?.requiredCables.length
    ? plan.wiringResult.requiredCables.slice(0, MAX_CONNECTIONS).map((cable) => `- ${cable.cableType}: ${cable.count}${cable.chargingOnly ? (lang === 'en' ? ' (charging only)' : '（充電時のみ）') : ''}`).join('\n')
    : (lang === 'en' ? '(No required-cable calculation)' : '（必要ケーブル計算なし）')
  const warningLines = selection.includeWiring && plan.wiringResult?.warnings.length
    ? plan.wiringResult.warnings.slice(0, MAX_CONNECTIONS).map((warning) => `- ${escapePromptData(warning)}`).join('\n')
    : (lang === 'en' ? '(None)' : '（なし）')
  const gadgetHeading = selection.includeGear
    ? lang === 'en'
      ? `Gadgets (${planGadgets.reduce((n, g) => n + gadgetQuantity(g), 0)} units / ${planGadgets.length} entries${deviceGadgets.length > planGadgets.length ? ` of ${deviceGadgets.length}` : ''}${selection.includeFinancial ? ` / Total ${formatPrice(total)}` : ''})`
      : `使用機器 (${planGadgets.reduce((n, g) => n + gadgetQuantity(g), 0)}台 / ${planGadgets.length}件${deviceGadgets.length > planGadgets.length ? `/${deviceGadgets.length}件` : ''}${selection.includeFinancial ? ` / 合計 ${formatPrice(total)}` : ''})`
    : lang === 'en'
      ? `Gadgets${selection.includeFinancial ? ` (Total ${formatPrice(total)})` : ''}`
      : `使用機器${selection.includeFinancial ? `（合計 ${formatPrice(total)}）` : ''}`

  if (lang === 'en') {
    return capDeskContext(`Use this desk data to answer the user's question. If no question is provided, suggest up to three prioritized improvements.\n\n<desk_data>\n**Consultation subject:** ${source === 'reference' ? 'Another user’s public desk, for reference; do not treat this gear as owned by the consulter' : 'The consulter’s own desk'}\n**Desk:** ${escapePromptData(plan.name)}\n**Purposes:** ${purposes || 'Not set'}\n**Available wall outlets:** ${selection.includeWiring ? plan.outletCount ?? 'Not set' : 'Not shared'}\n${totalsSection}${optionalSection}\n**${gadgetHeading}:**\n${gadgetLines}${ownedCableSection}\n\n**Connections:**\n${connectionLines}\n\n**Required cables (automatic estimate, not a shopping list):**\n${cableLines}\n\n**Wiring warnings (automatic estimates):**\n${warningLines}\n</desk_data>`, lang)
  }
  return capDeskContext(`このデスク情報をもとにユーザーの質問に回答してください。質問がなければ優先順位を付けて最大3件の改善案を提案してください。\n\n<desk_data>\n**相談対象:** ${source === 'reference' ? '他の人の公開デスクを参考にした相談・相談者の所有機材ではない' : '相談者自身のデスク'}\n**デスク名:** ${escapePromptData(plan.name)}\n**デスクの用途:** ${purposes || '未設定'}\n**利用可能な壁コンセント:** ${selection.includeWiring ? plan.outletCount ?? '未設定' : '送信しない'}\n${totalsSection}${optionalSection}\n**${gadgetHeading}:**\n${gadgetLines}${ownedCableSection}\n\n**接続関係:**\n${connectionLines}\n\n**必要ケーブル（自動計算・購入が必要とは限らない）:**\n${cableLines}\n\n**配線上の警告（自動推定）:**\n${warningLines}\n</desk_data>`, lang)
}
