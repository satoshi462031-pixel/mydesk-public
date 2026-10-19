import { Alert } from '../../utils/alert'
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../../hooks/useToday'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  Animated,
  Easing,
  InteractionManager,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import Reanimated, { Easing as LayoutEasing, LinearTransition } from 'react-native-reanimated'
import { analytics } from '../../services/analytics'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppIcon } from '../atoms/AppIcon'
import { SegmentedControl } from '../atoms/SegmentedControl'
import { IconCircleButton } from '../atoms/IconCircleButton'
import { ContrastToggle } from '../atoms/ContrastToggle'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { PlaybackSpeedControl } from '../molecules/PlaybackSpeedControl'
import { notifyTutorialInteraction } from '../molecules/TutorialBubble'
import { CoachStep, useCoachMarks } from '../../hooks/useCoachMarks'
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../../constants/categoryLabels'
import { customCategoryOf, gadgetCategoryKey } from '../../utils/customCategory'
import { categoryIconColor, ICONS, MCIconName, categoryBaseColor } from '../../constants/icons'
import { cableLabel, cableSortRank, portIconColor } from '../../constants/portTypes'
import { AppColors, useApp } from '../../context/AppContext'
import { CableType, DeskPlan, Gadget } from '../../types'
import { MapLayout, MapLayoutCancelled } from '../../utils/connectionMapLayout'
import { LAYOUT_VERSION } from '../../utils/mapLayoutCache'
import { historyLayoutCache } from '../../utils/historyLayoutCache'
import { computeHistoryLayouts } from '../../utils/historyLayouts'
import {
  appendTodayPage,
  buildTimeline,
  firstUsageDate,
  formatEventDateParts,
  localDateKey,
  TimelineEvent,
  TimelineGrain,
  TimelineYearlyChange,
  yearsAgoDateKey,
} from '../../utils/deskTimeline'
import {
  EVENT_ANIM_MS,
  EVENT_MS,
  eventStayMs,
  PAGE_MS,
  QUIET_EVENT_ANIM_MS,
  QUIET_EVENT_MS,
  useHistoryPlayback,
} from '../../hooks/useHistoryPlayback'
import { HistoryWiringCanvas } from './HistoryWiringCanvas'
import { localizedGadgetMemo, localizedGadgetName, gadgetGenreLabel } from '../../utils/localizedGadgetName'
import { countsAsDevice, sumGadgetPrices, validGadgetPrice } from '../../utils/gadgetStats'
import { historyChangeLabel, historyYearlyChangeLabel, isBulkHistoryChange } from '../../utils/historyPresentation'
import { LruCache } from '../../utils/lruCache'
import { holdBackgroundLayout } from '../../utils/layoutHold'
import { scrubClock, scrubPage, scrubPosition } from '../../utils/historyScrub'
import { buildHistoryReplacementPairs } from '../../utils/historyReplacement'
import { KIND_BADGE_COLORS, statusTextColor, UI_METRICS } from '../../constants/ui'

// 操作ガイドは下部の常設コントロールに合わせて作り直したので、既読キーも切り直す
const ONBOARDING_KEY = 'desk_history_controls_seen_v2'
const MAX_SEGMENTED_EVENTS = 24

// IN/OUT は1画面あたりこの件数まで。これを超えると複数ページに分けて順に見せる
const PAGE_SIZE = 4
const ROW_H = 44
const IN_BADGE_BG = KIND_BADGE_COLORS.in
const OUT_BADGE_BG = KIND_BADGE_COLORS.out
const INOUT_BADGE_TEXT = KIND_BADGE_COLORS.text
// IN/OUT の行に並べるケーブル種別の数。行の幅に収まるのはこのくらいまで
const INOUT_CABLE_MAX = 3
const DOTS_H = 18
// 常設ヘッダーの高さ。配線図はこの下から始まり、日付バッジもこの位置を基準に置く
const TOP_BAR_H = 48
// 月日のスロット表示の行高（この高さぶん上下にスライドする）
const DATE_SLOT_H = 26
const HUD_SIDE_MARGIN = 16
// 日付・金額バッジを配線図の上端から少し浮かせる。避けてもらう矩形にもこのぶんを足す
const HUD_TOP_MARGIN = 10
// シーク中に出す日付の吹き出し幅（中身の実測はせず固定幅で中央寄せする）
const SEEK_BUBBLE_W = 220
const QUICK_SPEEDS = [0.5, 1, 1.5, 2, 3]
const SEEK_KNOB = 14
// シークのタップ領域。上側が吹き出しの居場所、下端 PROGRESS_TRACK_BOTTOM の上に線が乗る
const PROGRESS_HIT_H = 64
const PROGRESS_TRACK_BOTTOM = 8
// 月日の入れ替えは、配線図が直前の日から現在の日へフェードアウト／フェードインする
// タイミング（HistoryWiringCanvas の PREV_FADE / BASE_IN あたり）に合わせる。
// 演出尺に対する比率で指定するので、再生速度を変えてもズレない。
const SLOT_DELAY_RATIO = 0.28
const SLOT_DURATION_RATIO = 0.22

type EventItem = { kind: 'IN' | 'OUT' | 'ACTIVE' | 'DECOR' | 'SUMMARY'; gadget: Gadget; cableTypes: CableType[]; summary?: TimelineYearlyChange; bulkGadgets?: Gadget[] }
type OnboardingState = 'checking' | 'show' | 'done'

/** 2つの日付キーの隔たりを「◯年◯か月」で表す。31日未満は日数のまま出す */
function spanLabel(fromDate: string, toDate: string, lang: 'ja' | 'en'): string {
  const first = new Date(`${fromDate}T00:00:00`)
  const last = new Date(`${toDate}T00:00:00`)
  const days = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86_400_000))
  if (days < 31) return lang === 'ja' ? `${days}日` : `${days} day${days === 1 ? '' : 's'}`
  const months = Math.max(0, (last.getFullYear() - first.getFullYear()) * 12 + last.getMonth() - first.getMonth())
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (lang === 'en') {
    if (years === 0) return `${Math.max(1, rest)} month${rest === 1 ? '' : 's'}`
    if (rest === 0) return `${years} year${years === 1 ? '' : 's'}`
    return `${years}y ${rest}m`
  }
  if (years === 0) return `${Math.max(1, rest)}か月`
  if (rest === 0) return `${years}年`
  return `${years}年${rest}か月`
}

function historyDurationLabel(events: TimelineEvent[], lang: 'ja' | 'en'): string {
  const last = events[events.length - 1]
  if (!last) return lang === 'ja' ? '1日' : '1 day'
  // ページ数で測ると、無料プランの表示期間で「今日」1ページだけに切り詰められたデスクが
  // 4年使っていても「1日」になる。longestPartner と同じく在籍期間の実日付から測る
  const since = last.gadgets.reduce<string | null>((oldest, gadget) => {
    const at = firstUsageDate(gadget)
    if (!at) return oldest
    return oldest && oldest <= at ? oldest : at
  }, null) ?? events[0]?.date
  if (!since) return lang === 'ja' ? '1日' : '1 day'
  return spanLabel(since, last.date, lang)
}

// まとめる単位。主操作を圧迫しないよう再生設定シートにまとめる
const GRAINS: TimelineGrain[] = ['day', 'month', 'year']
const grainLabel = (g: TimelineGrain, lang: 'ja' | 'en'): string =>
  lang === 'ja'
    ? (g === 'day' ? '日' : g === 'month' ? '月' : '年')
    : (g === 'day' ? 'D' : g === 'month' ? 'M' : 'Y')
const grainAccessibilityLabel = (g: TimelineGrain, lang: 'ja' | 'en'): string =>
  lang === 'ja'
    ? (g === 'day' ? '日ごとにまとめる' : g === 'month' ? '月ごとにまとめる' : '年ごとにまとめる')
    : (g === 'day' ? 'Group by day' : g === 'month' ? 'Group by month' : 'Group by year')

/** シークバーのつまみに出す、そのイベントの日付ラベル */
function seekDateLabel(e: TimelineEvent | undefined, grain: TimelineGrain, lang: 'ja' | 'en'): string {
  if (!e) return ''
  if (e.isTodayPage) return lang === 'ja' ? '今日' : 'Today'
  const [y, m, d] = e.date.split('-').map(Number)
  if (grain === 'year') return String(y)
  if (lang === 'ja') return grain === 'month' ? `${y}年${m}月` : `${y}/${m}/${d}`
  const { year, dayMonth } = formatEventDateParts(e.date, grain)
  return dayMonth ? `${dayMonth} ${year}` : year
}

function cableTypesFor(e: TimelineEvent, gadget: Gadget): CableType[] {
  const connections = e.renderConnections
  return [...new Set(
    connections
      .filter((c) => c.fromGadgetId === gadget.id || c.toGadgetId === gadget.id)
      .map((c) => c.cableType),
  )]
    // 先頭の数種類だけ出して残りは「+N」に畳むので、保存された線の順だと何が見えるかが
    // まちまちになる。ほかのケーブルの一覧と同じ種類の順にする
    .sort((a, b) => cableSortRank(a) - cableSortRank(b))
}

/** 撤去・使用方法の変更・導入の順に、種別をまたいで4件ずつ表示する。 */
function pagesOf(e: TimelineEvent): EventItem[][] {
  if (e.isTodayPage) return [[]]
  if (!e.yearlyChanges?.length && isBulkHistoryChange(e.inGadgets.length, e.outGadgets.length) && e.modeChanges.length === 0) return [[]]
  const summarized = new Set(e.yearlyChanges?.map((group) => group.categoryKey))
  const visible = (g: Gadget) => !summarized.has(gadgetCategoryKey(g))
  const out = e.outGadgets.filter(visible).map((g) => ({ kind: 'OUT' as const, gadget: g, cableTypes: cableTypesFor(e, g) }))
  const modes = e.modeChanges.filter(({ gadget }) => visible(gadget)).map(({ gadget, mode }) => ({
    kind: (mode === 'decor' ? 'DECOR' : 'ACTIVE') as 'DECOR' | 'ACTIVE',
    gadget,
    cableTypes: cableTypesFor(e, gadget),
  }))
  const inn = e.inGadgets.filter(visible).map((g) => ({ kind: 'IN' as const, gadget: g, cableTypes: cableTypesFor(e, g) }))
  const summaries = (e.yearlyChanges ?? []).map((summary) => ({
    kind: 'SUMMARY' as const, gadget: summary.finalGadgets[0] ?? summary.changes[0].gadget, cableTypes: [], summary,
  }))
  const bulk = summaries.length > 0 && modes.length === 0 && isBulkHistoryChange(inn.length, out.length)
  const items: EventItem[] = bulk
    ? [
      ...(out.length > 0 ? [{ ...out[0], bulkGadgets: out.map((item) => item.gadget) }] : []),
      ...(inn.length > 0 ? [{ ...inn[0], bulkGadgets: inn.map((item) => item.gadget) }] : []),
      ...summaries,
    ]
    : [...out, ...modes, ...inn, ...summaries]
  const chunks: EventItem[][] = []
  for (let i = 0; i < items.length; i += PAGE_SIZE) chunks.push(items.slice(i, i + PAGE_SIZE))
  return chunks.length > 0 ? chunks : [[]]
}

/**
 * 一度に大量に入れ替えた日のまとめ行。ケーブルは「台」で数えず本数で添える
 * （画面の他の「N台」もケーブルを数えない）
 */
function bulkChangeLabel(items: Gadget[], kind: 'in' | 'out', ja: boolean): string {
  const devices = items.filter(countsAsDevice).length
  const cables = items.reduce((sum, g) => sum + (countsAsDevice(g) ? 0 : g.cableCount ?? 1), 0)
  const verbJa = kind === 'in' ? '導入' : '撤去'
  const verbEn = kind === 'in' ? 'introduced' : 'removed'
  if (ja) {
    const parts = [devices > 0 ? `${devices}台` : null, cables > 0 ? `ケーブル${cables}本` : null].filter(Boolean)
    return `${parts.join('・')}を${verbJa}`
  }
  const parts = [devices > 0 ? `${devices} item${devices === 1 ? '' : 's'}` : null, cables > 0 ? `${cables} cable${cables === 1 ? '' : 's'}` : null].filter(Boolean)
  return `${parts.join(' + ')} ${verbEn}`
}

/** この日に買った・替えたケーブルの種類。配線図で同じ種類の線を光らせる（「今日」ページは除く） */
function addedCableTypesOf(e: TimelineEvent | undefined): Set<CableType> {
  if (!e || e.isTodayPage) return new Set()
  return new Set(e.inGadgets.flatMap((g) => (g.category === 'Cable' && g.cableType ? [g.cableType] : [])))
}

/**
 * 配線の新設・撤去もガジェットの移動も無い「静かな日」か。
 * この日の演出は新しいガジェットがフェードインするだけで早々に終わるため、
 * 尺を詰めて次の日へ送る（QUIET_EVENT_MS / QUIET_EVENT_ANIM_MS）。
 * 判定は HistoryWiringCanvas の演出条件と揃える：新規はレイアウト差分、撤去はイベント差分で見る
 * （撤去されるガジェット・配線は「しまう」演出のため当日のレイアウトにも残っている）。
 */
function isQuietEvent(
  events: TimelineEvent[],
  layouts: MapLayout[],
  index: number,
  animateMove: boolean,
  pageCount: number,
): boolean {
  const e = events[index]
  const prev = events[index - 1]
  const layout = layouts[index]
  const prevLayout = layouts[index - 1]
  if (!e || !prev || !layout || !prevLayout) return false  // 先頭は歴史の始まり。通常尺で見せる
  if (e.isTodayPage) return false                          // 最終ページは俯瞰を見せる時間が要る
  if (pageCount > 1) return false                          // ページ送りがある日は通常尺のまま

  // ケーブルを買った日は線を光らせるので、尺を詰めない
  if (addedCableTypesOf(e).size > 0) return false
  // 撤去（ガジェット・配線）があれば「しまう」演出が入る
  if (e.renderGadgets.length !== e.gadgets.length) return false
  const currConnIds = new Set(e.connections.map((c) => c.id))
  if (prev.connections.some((c) => !currConnIds.has(c.id))) return false

  // 新設配線。コンセント接続やペアリンクは event.connections に無くレイアウトで生まれるので、
  // 前日レイアウトとの差分で見る（canvas 側の新規判定と同じ）
  const prevEdgeIds = new Set(prevLayout.edges.map((edge) => edge.conn.id))
  if (layout.edges.some((edge) => !prevEdgeIds.has(edge.conn.id))) return false

  if (animateMove) {
    const prevById = new Map(prevLayout.nodes.map((n) => [n.id, n]))
    for (const n of layout.nodes) {
      const p = prevById.get(n.id)
      if (p && (p.x !== n.x || p.y !== n.y)) return false
    }
  }
  return true
}


interface Props {
  visible: boolean
  plan: DeskPlan                 // 配置（nodeOffsets / nodeSizes / historyLayout）の保存先
  gadgets: Gadget[]              // 対象デスクのガジェット（導入日/撤去日を持つ）
  lang: 'ja' | 'en'
  /** 遡って見られる年数（-1 = 無制限）。無料プランは直近1年のみに制限する */
  yearsLimit?: number
  /** 制限より前の記録を見ようとしたときに Paywall へ誘導する */
  onRequirePro?: () => void
  /**
   * 最後のページの共有。デスクの共有ボタンと同じく公開URLを送る。
   * 公開URLを持たないデスク（未公開・非公開）では渡さない＝ボタンを出さない
   */
  onShare?: () => void
  onClose: () => void
}

export type Prepared = {
  events: TimelineEvent[]
  layouts: MapLayout[]
  truncated: boolean
  /** 期間の制限で見せない最後の時点。最初のページの増減の基準にする */
  before?: TimelineEvent
}

// 一度計算した歴史（イベント＋各日の配線図レイアウト）をプラン×まとめ単位ごとに保持し、
// 2回目以降は読み込み待ちなしで開けるようにする。
// 入力（導入日・撤去日・接続・配置）が変わっていたら作り直す。
// 単位ごとに別エントリにするので、日 ⇄ 月 ⇄ 年 を行き来しても再計算は最初の1回だけで済む。
const preparedCache = new LruCache<string, { fp: string; value: Prepared }>(9)
const cacheKeyOf = (planId: string, grain: TimelineGrain) => `${planId}#${grain}`

// 配線は日付・ポート構成から決まるので、指紋も同じ入力から作る
function fingerprintOf(plan: DeskPlan, gadgets: Gadget[], yearsLimit: number, lang: 'ja' | 'en'): string {
  return [
    LAYOUT_VERSION, historyLayoutCache.revision, lang,
    JSON.stringify(gadgets),
    [...plan.selectedGadgetIds].sort().join(','),
    plan.templateId ?? '',
    plan.outletCount ?? '',
    (plan.wiredOverrides ?? []).join(','),
    JSON.stringify(plan.connectionMap?.dismissedPairs ?? []),
    // 配線図の線から読んでいるもの。2in1 の宣言は各日の線に引き当て（deskTimeline）、
    // 前回の挿し口（sourcePortId）と本数の申告（count）はエンジンの口の割り当てに効く。
    // 取り回し等は読まないので入れない
    (plan.connectionMap?.connections ?? [])
      .filter((c) => c.branchGroupId || c.sourcePortId || (c.count ?? 1) > 1)
      .map((c) => `${c.fromGadgetId}>${c.toGadgetId}|${c.cableType}|${c.branchGroupId ?? ''}|${c.sourcePortId ?? ''}|${c.count ?? ''}|${c.countSource ?? ''}|${c.wireless ? 'w' : ''}`)
      .sort()
      .join(','),
    // どのアームに載せるか。ガジェット側には受け口の有無しか残らず、アームの入れ替えが指紋に出ない
    JSON.stringify(plan.monitorArmAssignments ?? {}),
    JSON.stringify(plan.micArmAssignments ?? {}),
    JSON.stringify(plan.placements ?? []),
    JSON.stringify(plan.connectionMap?.nodeOffsets ?? {}),
    JSON.stringify(plan.connectionMap?.nodeSizes ?? {}),
    JSON.stringify(plan.connectionMap?.layoutSnapshots ?? {}),
    JSON.stringify(plan.connectionMap?.historyLayout ?? {}),
    localDateKey(),
    yearsLimit,
  ].join('#')
}

/**
 * 計算済みの歴史を同期で取り出す。無ければ null（＝これから計算が必要）。
 * 起動時ウォームアップ済み・2回目以降はこれが当たるので、読み込み表示を挟まずに開ける。
 */
export function cachedDeskHistory(
  plan: DeskPlan,
  gadgets: Gadget[],
  yearsLimit: number,
  grain: TimelineGrain = 'month',
  lang: 'ja' | 'en' = 'ja',
): Prepared | null {
  const hit = preparedCache.get(cacheKeyOf(plan.id, grain))
  return hit && hit.fp === fingerprintOf(plan, gadgets, yearsLimit, lang) ? hit.value : null
}

type HistoryHooks = { onProgress?: (ratio: number) => void; cancelled?: () => boolean }
type HistoryJob = { fp: string; promise: Promise<Prepared | null>; consumers: Set<HistoryHooks>; progress: number }
// 計算中の歴史。公開デスクの詳細画面が裏で始めた計算に、あとから開いた再生画面が相乗りする。
// 別々に計算すると、同じ重いレイアウト計算が同時に2本走って画面が詰まる
const historyJobs = new Map<string, HistoryJob>()

/**
 * タイムラインと各日の配線図レイアウトを作ってキャッシュへ入れる。
 * モーダル本体・公開デスクの詳細画面の裏読み込み・起動時ウォームアップで共用する。
 * 1イベントごとにイベントループへ制御を返すので、途中で画面操作が詰まらない。
 *
 * 呼び出し元がすべて cancelled を返したら（＝画面を閉じたら）計算を止め、途中の結果は捨てる。
 * cancelled を渡さない呼び出し（起動時ウォームアップ）がいる間は止めない
 */
export async function prepareDeskHistory(
  plan: DeskPlan,
  gadgets: Gadget[],
  lang: 'ja' | 'en',
  yearsLimit: number,
  grain: TimelineGrain = 'month',
  hooks?: HistoryHooks,
): Promise<Prepared | null> {
  const fp = fingerprintOf(plan, gadgets, yearsLimit, lang)
  const key = cacheKeyOf(plan.id, grain)
  const hit = preparedCache.get(key)
  if (hit && hit.fp === fp) return hit.value

  const consumer: HistoryHooks = { onProgress: hooks?.onProgress, cancelled: hooks?.cancelled }
  let job = historyJobs.get(key)
  if (!job || job.fp !== fp) {
    // 計算は最初の await までは同期で進むので、利用者を先に登録しておく。
    // 空のまま始めると最初の判定で「全員が手を引いた」とみなされ、即座に止まる
    const created: HistoryJob = { fp, promise: Promise.resolve(null), consumers: new Set([consumer]), progress: 0 }
    created.promise = computeDeskHistory(plan, gadgets, lang, yearsLimit, grain, fp, key, {
      cancelled: () => [...created.consumers].every((c) => c.cancelled?.() === true),
      onProgress: (ratio) => {
        created.progress = ratio
        created.consumers.forEach((c) => { if (!c.cancelled?.()) c.onProgress?.(ratio) })
      },
    }).catch((error: unknown) => {
      // 止めた（全員が手を引いた）ときの例外は失敗ではない。途中の結果は持たずに捨てる
      if (error instanceof MapLayoutCancelled) return null
      throw error
    }).finally(() => {
      if (historyJobs.get(key) === created) historyJobs.delete(key)
    })
    historyJobs.set(key, created)
    job = created
  }
  job.consumers.add(consumer)
  // 途中から相乗りした再生画面の％を、0 からではなく今の進み具合から始める
  if (job.progress > 0) consumer.onProgress?.(job.progress)
  let value: Prepared | null
  try {
    value = await job.promise
  } finally {
    job.consumers.delete(consumer)
  }
  if (consumer.cancelled?.()) return null
  // 計算が null で終わるのは止めたときだけ。閉じた画面の計算が止まる直前に相乗りした
  // （閉じてすぐ同じデスクを開き直した）ときは、自分はまだ要るので作り直す
  if (value === null) return prepareDeskHistory(plan, gadgets, lang, yearsLimit, grain, hooks)
  return value
}

async function computeDeskHistory(
  plan: DeskPlan,
  gadgets: Gadget[],
  lang: 'ja' | 'en',
  yearsLimit: number,
  grain: TimelineGrain,
  fp: string,
  key: string,
  hooks: Required<HistoryHooks>,
): Promise<Prepared | null> {
  const today = localDateKey()
  // 再生は今日までしか見せない。予定の撤去（未来日）を入れたまま月・年でまとめると、
  // その期間の代表日が未来になって期間ごと落ち、「今日」ページも前の期間の構成になる
  const changeEventsFull = buildTimeline(gadgets, plan, lang, grain, today)
  // 最終変更日は無料プランの表示制限とは無関係に、常に全期間から求める
  // （「今日」ページのレイアウト再利用判定に使うため）
  const lastChangeDate = changeEventsFull.at(-1)?.date
  const cutoff = yearsLimit > 0 ? yearsAgoDateKey(yearsLimit) : null
  // 判定は期間の開始日で行う。月・年でまとめているとき代表日（期間の最終日）で判定すると、
  // 制限より前の導入・撤去を含む期間まで丸ごと見えてしまう
  const changeEvents = cutoff ? changeEventsFull.filter((item) => item.firstDate >= cutoff) : changeEventsFull
  const truncated = cutoff !== null && changeEvents.length < changeEventsFull.length
  // 制限で切り落とした最後の状態。表示期間より前にしか変更が無いデスクは changeEvents が空になるので、
  // これを土台に「今日」ページだけは出す（再生が0ページにならないように）。
  // 最初のページの金額の増減もこれと比べる（0 と比べると、前からある機材まで増えたことになる）
  const before = cutoff ? changeEventsFull.filter((item) => item.firstDate < cutoff).at(-1) : undefined
  const events = appendTodayPage(changeEvents, today, before)
  const layouts = await computeHistoryLayouts(plan, events, lastChangeDate, grain, hooks)
  if (!layouts) return null
  const value: Prepared = { events, layouts, truncated, before }
  preparedCache.set(key, { fp, value })
  return value
}

// Pro限定：導入日・撤去日から自動生成したタイムラインを再生し、
// イベントごとに配線図を変化させる「デスクの歴史アニメーション」。
// UI はショート／ストーリー風：中央タップで再生、左右タップで前後移動、長押しで一時停止する。
// 配置の編集はマイページ →「歴史の配置を編集」（DeskHistoryLayoutEditModal）に分離した。
// 「？」で順に指す。図の上の触り方は見た目に出ていないので、最初に図そのものを指して言う
const PLAYBACK_COACH: CoachStep[] = [
  { target: 'pb-canvas', title: { ja: '再生中の図の操作', en: 'Playback gestures' }, emphasis: { ja: ['真ん中をタップ', '左右をタップ', '押している間'], en: ['Tap the middle', 'the sides', 'Hold to pause'] }, pad: 0, ja: '図の真ん中をタップで再生・一時停止、左右をタップで前後の時点へ移ります。押している間は止まります。止めている間は、機材をタップして詳細を見られます。', en: 'Tap the middle of the map to play or pause, or the sides to step back and forward. Hold to pause. While paused, tap gear for details.' },
  { target: 'pb-items', title: { ja: '機材の変更一覧', en: 'Gear changes' }, emphasis: { ja: ['＋は導入', '−は撤去', 'タップすると詳細'], en: ['+ means added', '− means removed', 'Tap a named row'] }, pad: 4, ja: '＋は導入、−は撤去、飾・使は使い方の変更です。機材名と配線の種類を確認でき、機材名の行をタップすると詳細を開きます。4件を超えると自動でページが切り替わり、変更が多い日は件数でまとめます。年表示で同じジャンルを何度も入れ替えた場合は「年内に○回変更」にまとめ、その行から日付順の履歴を確認できます。', en: '+ means added, − means removed, and the other marks indicate usage changes. Each row shows the gear name and connection types. Tap a named row for details. More than four changes cycle through pages; large changes are summarized as counts. In yearly view, repeated changes in one category are grouped into a count. Tap that row to see the dated history.' },
  { target: 'pb-progress', title: { ja: '時点を選ぶ', en: 'Choose a point in time' }, pad: 4, ja: 'なぞると、見たい時点へ移れます。区切りは1つずつの変化です。', en: 'Drag along the bar to jump to any point. Each segment is one change.' },
  { target: 'pb-controls', title: { ja: '再生・前後へ移動', en: 'Playback controls' }, pad: 4, ja: '前の時点・再生・次の時点です。', en: 'Previous, play, and next.' },
  { target: 'pb-settings', title: { ja: '速さと集計単位', en: 'Speed and grouping' }, pad: 2, ja: '再生の速さや、日・月・年ごとのまとめ方を変えられます。再生は導入日・撤去日の記録から作ります。', en: 'Change the speed and whether changes are grouped by day, month, or year. Playback uses install and removal dates.' },
]

export function DeskHistoryAnimationModal({ visible, plan, gadgets, lang, yearsLimit = -1, onRequirePro, onShare, onClose }: Props) {
  const today = useToday()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const ja = lang === 'ja'
  // 名前のないデスクでヘッダーが空欄にならないようにする
  const deskTitle = plan.name.trim() || (ja ? 'デスク' : 'Desk')
  const {
    colors, isDark, fmtPrice, reduceMotion, historyNodeMorph, setHistoryNodeMorph,
    historyGrain, setHistoryGrain, historySpeed, setHistorySpeed, historyShowInOut, setHistoryShowInOut,
    withOpacity,
  } = useApp()
  const inColor = statusTextColor('success', isDark)
  const outColor = statusTextColor('danger', isDark)
  const insets = useSafeAreaInsets()

  // IN/OUT をタップしたときのガジェット情報。開いている間は再生を止める
  const [infoGadget, setInfoGadget] = useState<Gadget | null>(null)
  const [yearlyInfo, setYearlyInfo] = useState<TimelineYearlyChange | null>(null)
  const resumeAfterInfo = useRef(false)

  // タイムライン構築と各イベントの配線図レイアウト計算（computeMapLayout は A* ルーティングを
  // 含み、ガジェットが多いと重い）は同期実行すると開いた瞬間に画面が固まる。
  // モーダルを開いた後の空き時間に計算し、それまではローディングを表示する。
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  // 読み込みの進捗（0..1）。レイアウト計算はイベント数に比例して長くなるため％で見せる
  const [prepProgress, setPrepProgress] = useState(0)
  const contentOpacity = useRef(new Animated.Value(0)).current
  const [presented, setPresented] = useState(false)
  useEffect(() => { if (!visible) setPresented(false) }, [visible])

  useEffect(() => {
    if (!visible) { setPrepared(null); return }

    // 計算済みなら読み込み表示を挟まずそのまま開く（起動時ウォームアップ済み・2回目以降）。
    // InteractionManager も待たない：待つと1フレーム以上ローディングが見えてしまう。
    const cached = cachedDeskHistory(plan, gadgets, yearsLimit, historyGrain, lang)
    if (cached) {
      setPrepProgress(1)
      contentOpacity.setValue(1)
      setPrepared(cached)
      return
    }

    let cancelled = false
    setPrepared(null)
    setPrepProgress(0)
    contentOpacity.setValue(0)

    const task = InteractionManager.runAfterInteractions(() => {
      // 1イベントずつ計算し、合間にUIへ制御を返して％表示を進める
      void (async () => {
        await new Promise((r) => setTimeout(r, 0))
        if (cancelled) return
        const value = await prepareDeskHistory(plan, gadgets, lang, yearsLimit, historyGrain, {
          onProgress: setPrepProgress,
          cancelled: () => cancelled,
        })
        if (!value || cancelled) return
        setPrepProgress(1)
        setPrepared(value)
      })().catch((error: unknown) => {
        // 1日分の構成が壊れていると計算が投げる。非同期なので境界に届かず、準備中の％のまま
        // 閉じる以外の操作が無くなる。理由を伝えて閉じる（デスクの他の画面はそのまま使える）
        if (cancelled) return
        analytics.error('desk_history_prepare', error)
        // 閉じるのは OK を押してから。先に閉じると、このシートの上に出した Alert が iOS では
        // シートと一緒に閉じられ、理由が読めないまま消えていた
        Alert.alert(
          lang === 'ja' ? 'デスクの歴史を再生できませんでした' : 'Could not play the desk history',
          undefined,
          [{ text: 'OK', onPress: () => onCloseRef.current() }],
        )
      })
    })
    return () => {
      cancelled = true
      task.cancel()
    }
  }, [visible, plan, gadgets, lang, yearsLimit, historyGrain, contentOpacity, today])

  // 再生を見せている間は、裏の配線図計算（起動時のウォームアップ・画面の先読み・後ろの画面の配線図）を
  // 止める。再生は JS 駆動なので、裏の計算とフレームを取り合ってカクつく。全画面なので裏の結果を待つ画面は無い。
  // 準備中（prepared が無い間）は自分の計算が要るので止めない
  useEffect(() => {
    if (!visible || !prepared) return
    return holdBackgroundLayout()
  }, [visible, prepared])

  useEffect(() => {
    if (!prepared || !presented) return
    const animation = Animated.timing(contentOpacity,{ toValue: 1, duration: reduceMotion ? 1 : 320, useNativeDriver: true })
    animation.start()
    return () => animation.stop()
  }, [prepared, presented, contentOpacity, reduceMotion])

  // ?? [] をそのまま書くと未読込のあいだ毎レンダー別の配列になり、これを依存に持つ
  // 下の useMemo / useCallback（イベント尺・ページ送り・共有文面など）が全部作り直される
  const events    = useMemo(() => prepared?.events ?? [], [prepared])
  const layouts   = useMemo(() => prepared?.layouts ?? [], [prepared])
  const truncated = prepared?.truncated ?? false

  // 初回だけ操作ヒントを出す。確認中も再生を始めず、先頭イベントを取りこぼさない。
  const [onboardingState, setOnboardingState] = useState<OnboardingState>('checking')
  useEffect(() => {
    if (!visible) { setOnboardingState('checking'); return }
    let cancelled = false
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((seen) => { if (!cancelled) setOnboardingState(seen ? 'done' : 'show') })
      .catch(() => { if (!cancelled) setOnboardingState('show') })
    return () => { cancelled = true }
  }, [visible])

  // ガジェットの移動モーフを行うか。静かな日の判定（移動があるか）を canvas と揃えるために使う
  const animateMove = historyNodeMorph && !reduceMotion

  // ±の一覧を隠しているとき（配線図の全画面表示）はページ送りが起きない。
  // 見せる中身が無いのにページぶん待たせないよう、ページ数は 1 として扱う
  const pageCountOf = useCallback((i: number) => {
    const e = events[i]
    if (!e || !historyShowInOut) return 1
    return pagesOf(e).length
  }, [events, historyShowInOut])

  const quietEvents = useMemo(
    () => events.map((_, i) => isQuietEvent(events, layouts, i, animateMove, pageCountOf(i))),
    [events, layouts, animateMove, pageCountOf],
  )

  // 演出が早々に終わる日は尺を詰める：
  //   静かな日（配線の出入り・ガジェットの移動が無い）と、動きを減らす設定（演出自体を飛ばす）。
  // 「動きを減らす」ONで通常尺のままだと、演出0秒の静止画を毎日5秒眺めることになる。
  const isShortEvent = useCallback(
    (i: number) => reduceMotion || quietEvents[i] === true,
    [reduceMotion, quietEvents],
  )
  const baseMsOf = useCallback(
    (i: number) => (isShortEvent(i) ? QUIET_EVENT_MS : EVENT_MS),
    [isShortEvent],
  )

  // 全ページ見せ終わるまで次の日へ進まない（正の hold）。
  // 尺を詰める日はそのぶんを負の hold で渡す（ページ送りぶんとは加算になる）
  const extraHoldMs = useMemo(
    () => events.map((_, i) => baseMsOf(i) - EVENT_MS + (pageCountOf(i) - 1) * PAGE_MS),
    [events, baseMsOf, pageCountOf],
  )

  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  // キャッシュ済みでも、表示と計測の前に時計を進めると先頭の登場演出が画面外で終わる。
  const playbackReady = visible && presented && canvasSize.w > 0 && canvasSize.h > 0
  const pb = useHistoryPlayback(
    events,
    playbackReady && prepared !== null && onboardingState === 'done',
    historySpeed,
    setHistorySpeed,
    extraHoldMs,
  )
  const { index, event, playing, speed, finished, count, nonce, offset } = pb
  // この日の演出尺（×1時）。詰めた日は配線図・日付・金額の演出が同じ比率のまま
  // 短くなる（滞在時間 QUIET_EVENT_MS の内側で収まる）
  const animMsOf = useCallback(
    (i: number) => (isShortEvent(i) ? QUIET_EVENT_ANIM_MS : EVENT_ANIM_MS),
    [isShortEvent],
  )
  const eventAnimMs = animMsOf(index)
  const layoutTransition = useMemo(
    () => reduceMotion ? undefined : LinearTransition
      .duration((eventAnimMs / speed) * SLOT_DURATION_RATIO)
      .easing(LayoutEasing.out(LayoutEasing.cubic)),
    [reduceMotion, eventAnimMs, speed],
  )
  // その日の滞在時間に対する経過割合 f を、配線図の演出尺に対する経過割合へ読み替える。
  // 演出は日の頭から始まり、滞在時間より短い尺で終わる（残りは眺める時間・ページ送り）
  const clockAt = useCallback(
    (i: number, f: number) => scrubClock(f, eventStayMs(extraHoldMs[i]), animMsOf(i)),
    [extraHoldMs, animMsOf],
  )

  const canvasSizesByIndex = useRef(new Map<number, { w: number; h: number }>())
  // ±一覧の表示を切り替えると配線図の表示領域の高さが変わる。記録済みの実測サイズは
  // 切り替え前の高さなので捨てる（カメラの開始画角に使われ、次の日で画が飛ぶ）
  useEffect(() => { canvasSizesByIndex.current.clear() }, [historyShowInOut])
  const [dateBadgeSize, setDateBadgeSize] = useState({ w: 0, h: 0 })
  const [priceBadgeSize, setPriceBadgeSize] = useState({ w: 0, h: 0 })
  const hudSizesByIndex = useRef(new Map<number, { date: { w: number; h: number }; price: { w: number; h: number } }>())
  useEffect(() => {
    const stored = hudSizesByIndex.current.get(index) ?? { date: dateBadgeSize, price: priceBadgeSize }
    hudSizesByIndex.current.set(index, {
      date: {
        w: Math.max(stored.date.w, dateBadgeSize.w),
        h: Math.max(stored.date.h, dateBadgeSize.h),
      },
      price: {
        w: Math.max(stored.price.w, priceBadgeSize.w),
        h: Math.max(stored.price.h, priceBadgeSize.h),
      },
    })
  }, [index, dateBadgeSize, priceBadgeSize])
  // 設定シートを開いているあいだは再生を止める（情報シートと同じ扱い）
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [quickSpeedOpen, setQuickSpeedOpen] = useState(false)
  const resumeAfterSettings = useRef(false)
  const coach = useCoachMarks()
  const { open: openCoach, target: coachTarget } = coach
  const helpOpen = coach.active
  const resumeAfterHelp = useRef(false)
  const closeCoach = coach.close
  useEffect(() => {
    if (!visible) {
      closeCoach()
      resumeAfterHelp.current = false
    }
  }, [visible, closeCoach])
  // 粒度変更で履歴が再構築されると playback が先頭から再初期化される。
  // 設定シートを開いたまま裏で再生が始まらないよう、再初期化後も停止を保つ。
  useEffect(() => {
    if ((settingsOpen || helpOpen || yearlyInfo !== null) && playing) pb.pause()
  }, [settingsOpen, helpOpen, yearlyInfo, playing, pb])
  const [centerFeedbackIcon, setCenterFeedbackIcon] = useState<'play' | 'pause' | null>(null)
  const centerFeedbackOpacity = useRef(new Animated.Value(0)).current
  const centerFeedbackAnim = useRef<Animated.CompositeAnimation | null>(null)

  const dismissOnboarding = useCallback(() => {
    setOnboardingState('done')
    void AsyncStorage.setItem(ONBOARDING_KEY, '1').catch(() => {})
  }, [])

  useEffect(() => {
    if (!visible) setSettingsOpen(false)
    setQuickSpeedOpen(false)
  }, [visible, events])

  const showCenterFeedback = useCallback((icon: 'play' | 'pause') => {
    centerFeedbackAnim.current?.stop()
    setCenterFeedbackIcon(icon)
    centerFeedbackOpacity.setValue(1)
    const anim = Animated.sequence([
      Animated.delay(90),
      Animated.timing(centerFeedbackOpacity, { toValue: 0, duration: reduceMotion ? 1 : 180, useNativeDriver: true }),
    ])
    centerFeedbackAnim.current = anim
    anim.start(({ finished: completed }) => { if (completed) setCenterFeedbackIcon(null) })
  }, [centerFeedbackOpacity, reduceMotion])
  useEffect(() => () => centerFeedbackAnim.current?.stop(), [])

  const handleToggle = useCallback((showFeedback = true) => {
    setQuickSpeedOpen(false)
    if (showFeedback) showCenterFeedback(playing ? 'pause' : 'play')
    pb.toggle()
  }, [pb, playing, showCenterFeedback])
  const handleStep = useCallback((delta: -1 | 1) => {
    setQuickSpeedOpen(false)
    pb.step(delta)
  }, [pb])
  // 最後まで見終わったあとの配線図タップは何もしない。出来上がった図を眺めながら
  // 線やガジェットを触っただけで最初から再生し直されてしまうため、リプレイは
  // まとめページと下部バーの明示的なボタンだけに任せる。
  const handleCanvasTap = useCallback(() => {
    if (finished) return
    handleToggle(true)
  }, [finished, handleToggle])

  // 長押しは一時停止し、指を離したら長押し前が再生中だった場合だけ再開する。
  // release 直後に発火する onPress は抑止し、長押しとタップを二重実行しない。
  const holdTriggered = useRef(false)
  const resumeAfterHold = useRef(false)
  const holdResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (holdResetTimer.current) clearTimeout(holdResetTimer.current) }, [])
  const handleLongPress = useCallback(() => {
    holdTriggered.current = true
    resumeAfterHold.current = playing
    pb.pause()
  }, [playing, pb])
  const handleGestureRelease = useCallback(() => {
    if (!holdTriggered.current) return
    if (resumeAfterHold.current) pb.play()
    resumeAfterHold.current = false
    holdResetTimer.current = setTimeout(() => { holdTriggered.current = false }, 0)
  }, [pb])
  const runTapAction = useCallback((action: () => void) => {
    if (holdTriggered.current) {
      holdTriggered.current = false
      return
    }
    action()
  }, [])

  // 情報を開いたら再生を停止し、閉じたら（元が再生中だったときだけ）再開する
  const openInfo = useCallback((g: Gadget) => {
    resumeAfterInfo.current = playing
    pb.pause()
    setInfoGadget(g)
  }, [playing, pb])

  const openYearlyInfo = useCallback((group: TimelineYearlyChange) => {
    resumeAfterInfo.current = playing
    pb.pause()
    setYearlyInfo(group)
  }, [playing, pb])

  const closeInfo = useCallback(() => {
    setInfoGadget(null)
    setYearlyInfo(null)
    if (resumeAfterInfo.current) pb.play()
    resumeAfterInfo.current = false
  }, [pb])

  useEffect(() => {
    if (!visible) {
      setInfoGadget(null)
      setYearlyInfo(null)
      resumeAfterInfo.current = false
    }
  }, [visible])

  const openSettings = useCallback(() => {
    setQuickSpeedOpen(false)
    resumeAfterSettings.current = playing
    pb.pause()
    setSettingsOpen(true)
  }, [playing, pb])
  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    if (resumeAfterSettings.current) pb.play()
    resumeAfterSettings.current = false
  }, [pb])

  const openHelp = useCallback(() => {
    resumeAfterHelp.current = playing
    pb.pause()
    void openCoach(PLAYBACK_COACH)
  }, [playing, pb, openCoach])
  // 吹き出しを閉じたら、開く前に再生していたときだけ続きから再生する
  const wasHelpOpen = useRef(false)
  useEffect(() => {
    if (wasHelpOpen.current && !helpOpen && resumeAfterHelp.current) pb.play()
    if (wasHelpOpen.current && !helpOpen) resumeAfterHelp.current = false
    wasHelpOpen.current = helpOpen
  }, [helpOpen, pb])

  // 進捗値はIN/OUTページ送りと下部バーで共有する。一時停止・速度変更後も同じ時点から再開する。
  //
  // バーの描画は transform（useNativeDriver）で UI スレッドに任せ、JS 側は Animated.Value を
  // 一切読まない。addListener を張ると再生中ずっと毎フレーム JS コールバックが走り、
  // 配線図の演出とスレッドを食い合う。経過を知りたい場面（ページ送りの再開位置・
  // 一時停止からの残り時間）は、進行中の区間と開始時刻から readProgress() で算出する。
  const progress = useRef(new Animated.Value(0)).current
  const playhead = useRef({ value: 0, from: 0, to: 0, startTs: 0, durMs: 0, running: false })
  const readProgress = useCallback(() => {
    const p = playhead.current
    if (!p.running) return p.value
    if (p.durMs <= 0) return p.to
    const ratio = Math.min(1, (Date.now() - p.startTs) / p.durMs)
    return p.from + (p.to - p.from) * ratio
  }, [])
  const setProgress = useCallback((v: number) => {
    playhead.current = { value: v, from: v, to: v, startTs: 0, durMs: 0, running: false }
    progress.setValue(v)
  }, [progress])
  const lastPlaybackKeyRef = useRef('')
  const scrubRatioRef = useRef<number | null>(null)

  // ─── IN/OUT のページ送り ───
  // その日の経過割合 f（ページ送りを含む滞在時間に対する割合）の時点で見せるページ
  // 1ページ目は配線図の演出と同じ尺（詰める日は縮んでいる）
  const pageAt = useCallback(
    (i: number, f: number) => scrubPage(f, pageCountOf(i), baseMsOf(i), PAGE_MS),
    [pageCountOf, baseMsOf],
  )
  const [page, setPage] = useState(0)
  const pagePlaybackKey = `${index}-${nonce}`
  const pagePlaybackKeyRef = useRef(pagePlaybackKey)
  // 1イベントだけの履歴ではリプレイしても index が0のままなので、再生nonceまで見て
  // コミット前に開始位置のページへ戻す。useEffectだけだと前回の最終ページが1フレーム表示される。
  // 開始位置は通常は頭（1ページ目）、再生バーで日の途中へ動かしたときはその位置のページ
  if (pagePlaybackKeyRef.current !== pagePlaybackKey) {
    pagePlaybackKeyRef.current = pagePlaybackKey
    const startPage = pageAt(index, offset)
    if (page !== startPage) setPage(startPage)
  }
  useEffect(() => {
    if (!playing || !event) return
    const pages = pageCountOf(index)
    if (pages <= 1) return
    const baseMs = baseMsOf(index)
    const totalMs = baseMs + (pages - 1) * PAGE_MS
    const isFreshEvent = lastPlaybackKeyRef.current !== pagePlaybackKey
    const elapsedRatio = isFreshEvent
      ? offset
      : Math.max(0, Math.min(1, readProgress() * count - index))
    const elapsedBase = elapsedRatio * totalMs
    const currentPage = pageAt(index, elapsedRatio)
    setPage((previous) => previous === currentPage ? previous : currentPage)

    // 2ページ目以降は PAGE_MS ごとに送る。
    // 再開時は既に経過した境界を飛ばし、残り時間だけを待つ。
    const timers = Array.from({ length: pages - 1 }, (_, i) => {
      const nextPage = i + 1
      const remainingBase = baseMs + i * PAGE_MS - elapsedBase
      return remainingBase > 0
        ? setTimeout(() => setPage(nextPage), remainingBase / speed)
        : null
    }).filter((timer): timer is ReturnType<typeof setTimeout> => timer !== null)
    return () => timers.forEach(clearTimeout)
  }, [index, nonce, offset, playing, speed, event, count, pagePlaybackKey, baseMsOf, pageCountOf, pageAt, readProgress])

  // ─── 進捗バー：イベント単位ではなく連続的に進む（ショートの再生バー） ───
  useEffect(() => {
    if (!prepared || count === 0) return
    // イベントが変わった瞬間はそのイベントの開始位置（通常は先頭、再生バーで動かしたときはその位置）へ合わせる
    const playbackKey = `${index}-${nonce}`
    if (lastPlaybackKeyRef.current !== playbackKey) {
      lastPlaybackKeyRef.current = playbackKey
      // 日をまたいだ seek の描画より、指が先の位置へ進んでいることがある。
      if (scrubRatioRef.current === null) setProgress((index + offset) / count)
    }
    if (!playing || scrubRatioRef.current !== null) return
    const current = readProgress()
    const target = (index + 1) / count
    // 一時停止から再開したときは残り時間ぶんだけ動かす
    const remaining = Math.max(0, (target - current) * count)
    const totalMs = eventStayMs(extraHoldMs[index])
    const duration = (totalMs / speed) * remaining
    playhead.current = { value: current, from: current, to: target, startTs: Date.now(), durMs: duration, running: true }
    const anim = Animated.timing(progress, {
      toValue: target,
      duration,
      // 等速。既定の inOut イージングだとバーが加速・減速して見えるうえ、
      // 経過時間からの逆算（readProgress）とも合わなくなる
      easing: Easing.linear,
      useNativeDriver: true,
    })
    anim.start()
    return () => {
      anim.stop()
      playhead.current = { ...playhead.current, value: readProgress(), running: false }
    }
  }, [prepared, count, index, nonce, offset, playing, speed, progress, extraHoldMs, readProgress, setProgress])

  // ─── 再生バーのドラッグ：配線図を指の位置に追随させる ───
  // 位置（0..1）を「何日目」と「その日の経過割合」に分け、日をまたいだら日を切り替え、
  // 同じ日の中では配線図の進行位置だけを動かす（モーダルは再レンダーしない）。
  // 左へ動かせば配線図も巻き戻る
  const canvasSeek = useRef<((x: number) => void) | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const scrubSeekNonceRef = useRef<number | null>(null)
  useEffect(() => {
    if (visible && prepared) return
    scrubRatioRef.current = null
    scrubSeekNonceRef.current = null
    setScrubbing(false)
  }, [visible, prepared])
  const startScrub = useCallback(() => {
    if (!visible || !prepared || count === 0) return false
    setQuickSpeedOpen(false)
    const resume = pb.pause()
    scrubRatioRef.current = readProgress()
    setProgress(scrubRatioRef.current)
    setScrubbing(true)
    return resume
  }, [visible, prepared, count, pb, readProgress, setProgress])
  const scrubTo = useCallback((ratio: number) => {
    if (!visible || !prepared || scrubRatioRef.current === null) return
    scrubRatioRef.current = ratio
    setProgress(ratio)
    const { index: i, offset: f } = scrubPosition(ratio, count)
    if (i !== index || scrubSeekNonceRef.current === nonce) {
      // 日をまたいだ：その日の途中から描き直す（開始位置はキャンバス・ページ・バーが offset から読む）
      // 元の日に戻っても、未描画の seek が残る間はその開始位置を更新する。
      scrubSeekNonceRef.current = nonce
      pb.seek(i, false, f)
      return
    }
    canvasSeek.current?.(clockAt(i, f))
    const nextPage = pageAt(i, f)
    setPage((previous) => (previous === nextPage ? previous : nextPage))
  }, [visible, prepared, count, index, nonce, pb, clockAt, pageAt, setProgress])
  const finishScrub = useCallback((ratio: number, resume: boolean) => {
    if (!visible || !prepared || scrubRatioRef.current === null) return
    const { index: i, offset: f } = scrubPosition(ratio, count)
    scrubRatioRef.current = null
    setProgress(ratio)
    setScrubbing(false)
    scrubSeekNonceRef.current = nonce
    pb.seek(i, resume && !(i === count - 1 && f === 1), f)
  }, [visible, prepared, count, nonce, pb, setProgress])

  const layout = layouts[index]
  // 直前レイアウトはカメラ補間と「前日位置 → 当日位置」へのガジェット移動モーフに使う
  const prevLayout = index > 0 ? layouts[index - 1] : null
  const storedCurrentHud = hudSizesByIndex.current.get(index)
  const reservedDateSize = storedCurrentHud?.date ?? dateBadgeSize
  const reservedPriceSize = storedCurrentHud?.price ?? priceBadgeSize
  const currentHudRects = [
    reservedDateSize.w > 0 ? { x: HUD_SIDE_MARGIN, y: 0, w: reservedDateSize.w, h: reservedDateSize.h + HUD_TOP_MARGIN } : null,
    reservedPriceSize.w > 0 ? { x: Math.max(0, canvasSize.w - HUD_SIDE_MARGIN - reservedPriceSize.w), y: 0, w: reservedPriceSize.w, h: reservedPriceSize.h + HUD_TOP_MARGIN } : null,
  ].filter((rect): rect is { x: number; y: number; w: number; h: number } => rect !== null)
  const prevHudSizes = index > 0 ? hudSizesByIndex.current.get(index - 1) : undefined
  const prevViewport = index > 0 ? canvasSizesByIndex.current.get(index - 1) : undefined
  const prevHudRects = prevViewport && prevHudSizes
    ? [
        { x: HUD_SIDE_MARGIN, y: 0, w: prevHudSizes.date.w, h: prevHudSizes.date.h + HUD_TOP_MARGIN },
        { x: Math.max(0, prevViewport.w - HUD_SIDE_MARGIN - prevHudSizes.price.w), y: 0, w: prevHudSizes.price.w, h: prevHudSizes.price.h + HUD_TOP_MARGIN },
      ]
    : undefined

  // その時点の資産評価額（在席ガジェットの価格合計）と、直前のイベントからの増減。
  // renderGadgets は撤去演出中のガジェットも含むため、金額の集計には使わず gadgets（在席分のみ）を使う
  const totalOf = (e: TimelineEvent) => sumGadgetPrices(e.gadgets)
  const priceTotal = event ? totalOf(event) : 0
  const previousEvent = index > 0 ? events[index - 1] : prepared?.before
  const priceDiff = event ? priceTotal - (previousEvent ? totalOf(previousEvent) : 0) : 0

  // 左上の日付バッジ。まとめる単位に合わせて「日→月→年」と粒度を落とす
  const dateParts = event
    ? formatEventDateParts(event.date, historyGrain)
    : { year: '', dayMonth: null }

  // シーク中のつまみに出す日付。どこへ飛ぶのか分からないまま指を離す状態を無くす
  const seekLabelOf = useCallback(
    (i: number) => seekDateLabel(events[i], historyGrain, lang),
    [events, historyGrain, lang],
  )
  const seekDetailOf = useCallback((i: number) => historyChangeLabel(events[i], lang), [events, lang])
  const milestones = useMemo(() => events.flatMap((item, i) =>
    !item.isTodayPage && (item.inGadgets.length || item.outGadgets.length || item.modeChanges.length) ? [i] : []), [events])

  const summary = useMemo(() => {
    const unique = [...new Map(events.flatMap((item) => item.inGadgets).map((g) => [g.id, g])).values()]
    const finalGadgets = events[events.length - 1]?.gadgets ?? []

    // 単品の最高額。台数ぶんを掛けると「まとめ買い」が1点ものに勝ってしまい、
    // 「一番高い買い物」として指したいものからずれる
    const topPurchase = unique.reduce<{ gadget: Gadget; price: number } | null>((best, gadget) => {
      const price = validGadgetPrice(gadget)
      if (price === null || price <= 0) return best
      return best && best.price >= price ? best : { gadget, price }
    }, null)

    // 今も在席しているガジェットのうち、いちばん早く入ってきたもの。
    // 表示中のイベントから拾うと、無料プランの直近1年制限で「4年使っている機器が1年」に
    // なってしまうため、在籍期間の実日付を直接見る
    const longestPartner = finalGadgets.reduce<{ gadget: Gadget; since: string } | null>((best, gadget) => {
      const since = firstUsageDate(gadget)
      if (!since) return best
      return best && best.since <= since ? best : { gadget, since }
    }, null)
    const lastDate = events[events.length - 1]?.date

    return {
      duration: historyDurationLabel(events, lang),
      introducedTotal: sumGadgetPrices(unique),
      topPurchase,
      longestPartner: longestPartner && lastDate
        ? { gadget: longestPartner.gadget, span: spanLabel(longestPartner.since, lastDate, lang) }
        : null,
    }
  }, [events, lang])

  const restartFromSummary = useCallback(() => {
    pb.restart()
  }, [pb])

  // 撤去される要素。当日のレイアウトにも「しまう演出のため」含まれているので、
  // レイアウト差分では判別できない（新規は canvas 側が前日レイアウトとの差分で判定する）
  const diff = useMemo(() => {
    const prev = index > 0 ? events[index - 1] : null
    const currConnIds = new Set((event?.connections ?? []).map((c) => c.id))
    const currGadgetIds = new Set((event?.gadgets ?? []).map((g) => g.id))
    return {
      exitingEdgeIds: new Set((prev?.connections ?? []).filter((c) => !currConnIds.has(c.id)).map((c) => c.id)),
      exitingNodeIds: new Set((event?.renderGadgets ?? []).filter((g) => !currGadgetIds.has(g.id)).map((g) => g.id)),
      replacementPairs: event
        ? buildHistoryReplacementPairs(
          event.inGadgets.filter((g) => event.renderGadgets.some((item) => item.id === g.id)),
          event.outGadgets.filter((g) => event.renderGadgets.some((item) => item.id === g.id)),
          event.renderConnections,
        )
        : new Map<string, string>(),
      glowCableTypes: addedCableTypesOf(event),
    }
  }, [events, event, index])

  return (
    // 全画面の1ページなので、iOS の全画面表示と同じく下から出す（写真の拡大のような重ね表示ではない）
    // iOS の fullScreen は背後のルートを外し、表示中の外観変更通知が届かなくなる。
    <Modal visible={visible} animationType={reduceMotion ? 'fade' : 'slide'} presentationStyle="overFullScreen" onRequestClose={onClose} onShow={() => setPresented(true)}>
      {/* ステータスバーの文字色を背景に合わせる（白背景に白文字で消える問題の修正） */}
      {visible && (
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bgList} />
      )}

      {/* 地は配線図（HistoryWiringCanvas の viewport）と同じ bgList に揃える。
          card にすると配線図との境目に段差が出る（ライト #FFF↔#F2F2F7 / ダーク #2C2C2E↔#000） */}
      <View style={[styles.fullscreen, { backgroundColor: colors.bgList }]} onTouchStart={notifyTutorialInteraction} onPointerDown={notifyTutorialInteraction}>
        {!prepared ? (
          <View style={styles.centerBox}>
            <Text style={[styles.loadingTitle, { color: colors.text }]} numberOfLines={2}>{deskTitle}</Text>
            <Text style={[styles.centerText, { color: colors.textSub }]}>
              {ja ? '歴史を組み立てています' : 'Building history'}
            </Text>
            {/* 進捗バー：イベント（日付）1件ぶんのレイアウト計算が終わるごとに進む */}
            <View style={[styles.loadingTrack, { backgroundColor: colors.chip }]}>
              <View style={[styles.loadingFill, { backgroundColor: colors.accent, width: `${Math.round(prepProgress * 100)}%` }]} />
            </View>
            <Text style={[styles.loadingPercent, { color: colors.textMuted }]}>{Math.round(prepProgress * 100)}%</Text>
            <TouchableOpacity
              style={[styles.loadingClose, { top: insets.top + 8, backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={ja ? '閉じる' : 'Close'}
            >
              <AppIcon name={ICONS.close} size={20} color={colors.text} />
            </TouchableOpacity>
          </View>
        ) : count === 0 ? (
          <View style={styles.centerBox}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.chip }]}>
              <AppIcon name={ICONS.history} size={30} color={colors.textMuted} centered />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {ja ? '再生できる歴史がありません' : 'No history to play'}
            </Text>
            <Text style={[styles.centerText, { color: colors.textSub }]}>
              {ja
                ? 'このデスクに機材がありません。\n機材に導入日を設定すると、より正確な歴史になります。'
                : 'No gadgets in this desk to build a history from.\nSet install dates on gadgets for a more accurate history.'}
            </Text>
            <TouchableOpacity style={[styles.closeBtnWide, { backgroundColor: colors.accent }]} onPress={onClose} activeOpacity={0.85}>
              <Text style={[styles.closeBtnWideText, { color: colors.onAccent }]}>{ja ? '閉じる' : 'Close'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Animated.View style={{ opacity: contentOpacity, flex: 1 }}>
            {/* ── プレイヤー面：画面の端まで使う ── */}
            <View style={styles.player}>
              {/* ヘッダーは常設。以前は再生中に出入りしていて、そのたびに画面がガタついていた */}
              <View style={[styles.header, { paddingTop: insets.top, minHeight: insets.top + TOP_BAR_H, borderBottomColor: colors.separator }]}>
                <TouchableOpacity
                  style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={onClose}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={ja ? '閉じる' : 'Close'}
                >
                  <AppIcon name={ICONS.close} size={19} color={colors.text} />
                </TouchableOpacity>
                <View style={styles.headerTitleBox}>
                  <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{deskTitle}</Text>
                  <Text style={[styles.headerSub, { color: colors.textMuted }]} numberOfLines={1}>
                    {ja ? 'デスクの歴史' : 'Desk History'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={openHelp}
                  accessibilityRole="button"
                  accessibilityLabel={ja ? '歴史の操作方法' : 'History playback help'}
                >
                  <AppIcon name="help-circle-outline" size={18} color={colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  ref={coachTarget('pb-settings')}
                  style={[styles.headerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={openSettings}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={ja ? '再生設定' : 'Playback settings'}
                >
                  <AppIcon name="tune-variant" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              <Reanimated.View
                layout={layoutTransition}
                style={styles.canvasWrap}
                onLayout={(e) => {
                  const w = Math.round(e.nativeEvent.layout.width)
                  const h = Math.round(e.nativeEvent.layout.height)
                  canvasSizesByIndex.current.set(index, { w, h })
                  // onLayout が 2px 単位で往復（例 570↔568）すると setState→再レンダーが多発し、
                  // JS駆動（useNativeDriver:false）の登場アニメ t が枯渇して止まる → 配線・ガジェットが
                  // 途中で消える。微小な揺れは無視して canvasSize を安定させる。
                  setCanvasSize((prev) =>
                    Math.abs(prev.w - w) <= 2 && Math.abs(prev.h - h) <= 2 ? prev : { w, h },
                  )
                }}
              >
                <View ref={coachTarget('pb-canvas')} style={styles.canvasWrap} collapsable={false}>
                {/* ストーリー型操作。配線図領域だけを対象にし、下部の情報行や進捗操作と競合させない。
                    配線図より **先に** 置いて下に敷く：一時停止中はガジェットが指を受け取り、
                    それ以外の場所を触ったときだけここへ抜ける（配線図側は box-none）。 */}
                <View style={styles.gestureLayer}>
                  <Pressable
                    style={styles.gestureSide}
                    delayLongPress={280}
                    onLongPress={handleLongPress}
                    onPressOut={handleGestureRelease}
                    onPress={() => runTapAction(() => handleStep(-1))}
                  />
                  <Pressable
                    style={styles.gestureCenter}
                    delayLongPress={280}
                    onLongPress={handleLongPress}
                    onPressOut={handleGestureRelease}
                    onPress={() => runTapAction(handleCanvasTap)}
                  />
                  <Pressable
                    style={styles.gestureSide}
                    delayLongPress={280}
                    onLongPress={handleLongPress}
                    onPressOut={handleGestureRelease}
                    onPress={() => runTapAction(() => handleStep(1))}
                  />
                </View>

                {layout && canvasSize.w > 0 ? (
                  <HistoryWiringCanvas
                    layout={layout}
                    prevLayout={prevLayout}
                    animKey={`${index}-${nonce}`}
                    durationMs={eventAnimMs / speed}
                    startAt={clockAt(index, offset)}
                    frozen={scrubbing || !playing}
                    seekRef={canvasSeek}
                    morph={animateMove}
                    reduceMotion={reduceMotion}
                    width={canvasSize.w}
                    height={canvasSize.h}
                    prevViewport={prevViewport}
                    hudRects={currentHudRects}
                    prevHudRects={prevHudRects}
                    colors={colors}
                    overview={event?.isTodayPage}
                    exitingNodeIds={diff.exitingNodeIds}
                    exitingEdgeIds={diff.exitingEdgeIds}
                    replacementPairs={diff.replacementPairs}
                    glowCableTypes={diff.glowCableTypes}
                    // 一時停止中だけガジェットを押せる。再生中に渡すとストーリー操作を潰すうえ、
                    // MOVE フェーズではノードが動いていて押した先が別のガジェットになる
                    onSelectGadget={playing ? undefined : openInfo}
                  />
                ) : null}
                </View>
              </Reanimated.View>

              {/* ── IN/OUT 表示エリア（配線図の下。タップでガジェット情報） ── */}
              {event && (() => {
                if (event.isTodayPage) {
                  return (
                    <View style={[styles.todayPanel, { borderTopColor: colors.separator }]}>
                      <View style={styles.todayHeader}>
                        <Text style={[styles.todayTitle, { color: colors.text }]} numberOfLines={1}>
                          {ja ? 'ここまでの歩み' : 'The story so far'}
                        </Text>
                        <View style={[styles.todayDurationChip, { backgroundColor: colors.chip }]}>
                          <Text style={[styles.todayDuration, { color: colors.textSub }]} numberOfLines={1}>
                            {summary.duration}{truncated ? (ja ? '（直近1年）' : ' · last 1 yr') : ''}
                          </Text>
                        </View>
                      </View>
                      {/* 「これまでの累計」だけを主役にする。同じ大きさのタイルを4枚並べると
                          視線の落とし所が無く、直前まで動いていた配線図の下では読み飛ばされる。
                          台数は数えない。マウスもデスクも同じ「1」になり、積み上げの実感と合わない */}
                      {/* 価格未入力のデスクでは「¥0」を主役に据えても意味が無いので、記録行だけにする */}
                      {summary.introducedTotal > 0 && (
                      <RiseIn delayMs={reduceMotion ? 0 : 120} reduceMotion={reduceMotion} ready={playbackReady}>
                        <View style={[styles.summaryHero, {
                          backgroundColor: withOpacity(colors.accent, 24),
                          borderColor: withOpacity(colors.accentIcon, 64),
                        }]}>
                          <CountUpValue
                            value={summary.introducedTotal}
                            format={fmtPrice}
                            delayMs={reduceMotion ? 0 : 260}
                            reduceMotion={reduceMotion}
                            ready={playbackReady}
                            // 主役の数値は text。オレンジを敷いた面の上なので、
                            // どこが山場かは面の色が示している
                            style={[styles.summaryHeroValue, { color: colors.text }]}
                          />
                          <Text style={[styles.summaryHeroLabel, { color: colors.textSub }]} numberOfLines={1}>
                            {ja ? 'これまでの累計' : 'Cumulative'}
                          </Text>
                        </View>
                      </RiseIn>
                      )}
                      {/* 記録は「金額」と「年数」だけで組む。どちらも機器の大小に関わらず比べられる */}
                      {summary.topPurchase && (
                        <RiseIn delayMs={reduceMotion ? 0 : 320} reduceMotion={reduceMotion} ready={playbackReady}>
                          <SummaryRecord
                            label={ja ? '一番高い買い物' : 'Biggest buy'}
                            gadget={summary.topPurchase.gadget}
                            value={fmtPrice(summary.topPurchase.price)}
                            colors={colors}
                            isDark={isDark}
                            lang={lang}
                          />
                        </RiseIn>
                      )}
                      {summary.longestPartner && (
                        <RiseIn delayMs={reduceMotion ? 0 : 420} reduceMotion={reduceMotion} ready={playbackReady}>
                          <SummaryRecord
                            label={ja ? '最長のつきあい' : 'Longest running'}
                            gadget={summary.longestPartner.gadget}
                            value={summary.longestPartner.span}
                            colors={colors}
                            isDark={isDark}
                            lang={lang}
                          />
                        </RiseIn>
                      )}
                      <View style={styles.summaryActions}>
                        <TouchableOpacity
                          style={[styles.summarySecondaryBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                          onPress={restartFromSummary}
                          activeOpacity={0.8}
                          accessibilityRole="button"
                          accessibilityLabel={ja ? '最初から再生' : 'Replay from the beginning'}
                        >
                          <AppIcon name="replay" size={17} color={colors.text} />
                          <Text style={[styles.summarySecondaryText, { color: colors.text }]}>
                            {ja ? '最初から再生' : 'Replay from start'}
                          </Text>
                        </TouchableOpacity>
                        {onShare && (
                          <TouchableOpacity
                            style={[styles.summaryPrimaryBtn, { backgroundColor: colors.accent }]}
                            onPress={onShare}
                            activeOpacity={0.85}
                            accessibilityRole="button"
                            accessibilityLabel={ja ? 'デスクのリンクを共有' : 'Share the desk link'}
                          >
                            <AppIcon name={ICONS.share} size={17} color={colors.onAccent} />
                            <Text style={[styles.summarySecondaryText, { color: colors.onAccent }]}>{ja ? '共有' : 'Share'}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  )
                }
                // ±の一覧を隠しているとき（配線図の全画面表示）は、その高さを配線図に回す
                if (!historyShowInOut) return null
                const bulkChange = !event.yearlyChanges?.length && isBulkHistoryChange(event.inGadgets.length, event.outGadgets.length) && event.modeChanges.length === 0
                const pages = pagesOf(event)
                const items = pages[Math.min(page, pages.length - 1)] ?? []
                const bulkRows = Number(event.outGadgets.length > 0) + Number(event.inGadgets.length > 0)
                const rows = bulkChange ? bulkRows : items.length
                const panelH = rows * ROW_H + (pages.length > 1 ? DOTS_H : 0)
                const panelBorder = rows > 0 ? StyleSheet.hairlineWidth : 0
                return (
                  // height は境界線を含む（RN は border-box）ので、区切り線ぶんを足さないと
                  // 一番上の行が 1px 欠ける
                  <Reanimated.View layout={layoutTransition} style={[styles.inoutPanel, { height: panelH + panelBorder, borderTopWidth: panelBorder, borderTopColor: colors.separator }]}>
                    <View ref={coachTarget('pb-items')} collapsable={false}>
                    {bulkChange && event.outGadgets.length > 0 && (
                      <View style={styles.inoutRow}>
                        <View style={[styles.inoutBadge, { backgroundColor: OUT_BADGE_BG }]}>
                          <Text style={[styles.inoutBadgeText, { color: INOUT_BADGE_TEXT }]}>−</Text>
                        </View>
                        <Text style={[styles.inoutName, { color: colors.text }]}>
                          {bulkChangeLabel(event.outGadgets, 'out', ja)}
                        </Text>
                      </View>
                    )}
                    {bulkChange && event.inGadgets.length > 0 && (
                      <View style={styles.inoutRow}>
                        <View style={[styles.inoutBadge, { backgroundColor: IN_BADGE_BG }]}>
                          <Text style={[styles.inoutBadgeText, { color: INOUT_BADGE_TEXT }]}>+</Text>
                        </View>
                        <Text style={[styles.inoutName, { color: colors.text }]}>
                          {bulkChangeLabel(event.inGadgets, 'in', ja)}
                        </Text>
                      </View>
                    )}
                    {!bulkChange && <PageFade swapKey={`${index}-${nonce}-${page}`} reduceMotion={reduceMotion} ready={playbackReady}>
                    {items.map((it) => {
                      if (it.bulkGadgets) return (
                        <View key={`bulk-${it.kind}`} style={styles.inoutRow}>
                          <View style={[styles.inoutBadge, { backgroundColor: it.kind === 'IN' ? IN_BADGE_BG : OUT_BADGE_BG }]}>
                            <Text style={[styles.inoutBadgeText, { color: INOUT_BADGE_TEXT }]}>{it.kind === 'IN' ? '+' : '−'}</Text>
                          </View>
                          <Text style={[styles.inoutName, { color: colors.text }]}>
                            {bulkChangeLabel(it.bulkGadgets, it.kind === 'IN' ? 'in' : 'out', ja)}
                          </Text>
                        </View>
                      )
                      if (it.summary) {
                        const group = it.summary
                        const label = historyYearlyChangeLabel(group, lang)
                        const genre = customCategoryOf(it.gadget)?.name ?? (ja ? CATEGORY_LABELS : CATEGORY_LABELS_EN)[it.gadget.category] ?? it.gadget.category
                        return (
                          <TouchableOpacity key={`summary-${group.categoryKey}`} style={styles.inoutRow}
                            onPress={() => openYearlyInfo(group)} activeOpacity={0.7}
                            accessibilityRole="button" accessibilityLabel={`${genre} ${label}`}>
                            <View style={[styles.inoutBadge, { backgroundColor: colors.chip }]}>
                              <AppIcon name="history" size={18} color={colors.textMuted} />
                            </View>
                            <View style={styles.inoutDetails}>
                              <Text style={[styles.inoutName, { color: colors.text }]} numberOfLines={1}>
                                {genre} · {label}
                              </Text>
                              <Text style={[styles.inoutCableText, { color: colors.textMuted }]} numberOfLines={1}>
                                {group.finalGadgets.length > 0
                                  ? `${ja ? '最後の構成' : 'Final setup'}: ${group.finalGadgets.map((g) => localizedGadgetName(g, lang)).join(' / ')}`
                                  : (ja ? '最後の構成では未使用' : 'Not in the final setup')}
                              </Text>
                            </View>
                            <AppIcon name={ICONS.info} size={16} color={colors.textMuted} />
                          </TouchableOpacity>
                        )
                      }
                      const statusBackground = it.kind === 'IN'
                        ? IN_BADGE_BG
                        : it.kind === 'OUT'
                          ? OUT_BADGE_BG
                          : it.kind === 'DECOR' ? KIND_BADGE_COLORS.decor : KIND_BADGE_COLORS.active
                      // 飾・使は日本語の1文字。英語では文字を当てず、色と形で分ける（D / U では意味が伝わらない）
                      const statusMark = it.kind === 'IN' ? '+' : it.kind === 'OUT' ? '−' : it.kind === 'DECOR' ? (ja ? '飾' : '◇') : (ja ? '使' : '•')
                      return (
                      <TouchableOpacity
                        key={it.kind + it.gadget.id}
                        style={styles.inoutRow}
                        onPress={() => openInfo(it.gadget)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.inoutBadge, { backgroundColor: statusBackground }]}>
                          <Text style={[styles.inoutBadgeText, { color: INOUT_BADGE_TEXT }]}>{statusMark}</Text>
                        </View>
                        {/* ジャンル（カテゴリ）アイコン */}
                        <View style={[styles.inoutCatIcon, { backgroundColor: colors.chip }]}>
                          <CategoryIcon
                            category={it.gadget.category}
                            pcFormFactor={it.gadget.pcFormFactor}
                            customIcon={it.gadget.customCategory?.icon}
                            size={14}
                            color={categoryIconColor(it.gadget.category, isDark, undefined, it.gadget.customCategory?.color)}
                          />
                        </View>
                        <View style={styles.inoutDetails}>
                          {/* 行の高さは決まっているので、ジャンル名は同じ行の頭に添える。長い商品名の方を省略させる */}
                          <Text style={[styles.inoutName, { color: colors.text }]} numberOfLines={1}>
                            {!!gadgetGenreLabel(it.gadget, lang) && (
                              <Text style={{ color: colors.textMuted }}>{`${gadgetGenreLabel(it.gadget, lang)}  `}</Text>
                            )}
                            {localizedGadgetName(it.gadget, lang)}
                          </Text>
                          {it.kind === 'DECOR' || it.kind === 'ACTIVE' ? (
                            <Text style={[styles.inoutCableText, { color: colors.textMuted }]}>
                              {it.kind === 'DECOR'
                                ? (ja ? '飾りに変更' : 'Changed to decor')
                                : (ja ? '使用を再開' : 'Returned to active use')}
                            </Text>
                          ) : it.cableTypes.length > 0 ? (
                            // 行の高さが固定なので折り返せない。PC・ドックは種別が多く、並べきると右端で
                            // 文字の途中から切れていた。3つまで出して残りは件数に畳み、それでも長い名前は「…」にする
                            <View style={styles.inoutCableRow}>
                              {it.cableTypes.slice(0, INOUT_CABLE_MAX).map((type) => (
                                <View key={type} style={styles.inoutCableItem}>
                                  <View style={[styles.inoutCableDot, { backgroundColor: portIconColor(type, isDark) }]} />
                                  <Text style={[styles.inoutCableText, styles.inoutCableLabel, { color: colors.textMuted }]} numberOfLines={1}>{cableLabel(type, lang)}</Text>
                                </View>
                              ))}
                              {it.cableTypes.length > INOUT_CABLE_MAX && (
                                <Text style={[styles.inoutCableText, { color: colors.textMuted }]}>
                                  {`+${it.cableTypes.length - INOUT_CABLE_MAX}`}
                                </Text>
                              )}
                            </View>
                          ) : (
                            <Text style={[styles.inoutCableText, { color: colors.textMuted }]}>
                              {ja ? '配線なし' : 'No connection'}
                            </Text>
                          )}
                        </View>
                        <AppIcon name={ICONS.info} size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                    )})}
                    </PageFade>}
                    {pages.length > 1 && (
                      <View style={styles.pageDots}>
                        {pages.map((_, i) => (
                          <View
                            key={i}
                            style={[
                              styles.pageDot,
                              i === page && styles.pageDotActive,
                              { backgroundColor: i === page ? colors.accent : colors.border },
                            ]}
                          />
                        ))}
                      </View>
                    )}
                    </View>
                  </Reanimated.View>
                )
              })()}

              {/* 日付：配線図の左上に常時表示。月日はスロットのように入れ替わる */}
              {event && (
                <>
                  <Reanimated.View
                    layout={layoutTransition}
                    style={[styles.dateBadge, {
                      top: insets.top + TOP_BAR_H + HUD_TOP_MARGIN,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    }]}
                    pointerEvents="none"
                    onLayout={(e) => {
                      const { width: w, height: h } = e.nativeEvent.layout
                      const next = { w: Math.ceil(w), h: Math.ceil(h) }
                      setDateBadgeSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
                      const stored = hudSizesByIndex.current.get(index) ?? { date: next, price: priceBadgeSize }
                      hudSizesByIndex.current.set(index, {
                        ...stored,
                        date: { w: Math.max(stored.date.w, next.w), h: Math.max(stored.date.h, next.h) },
                      })
                    }}
                  >
                    {/* 幅は内容準拠にする（金額バッジと同じ）。年の実測幅に押し込めると
                        "28 Sep" のような月日が年より広い日に切れる。adjustsFontSizeToFit は
                        iOS 専用なので、Android では縮まずそのまま欠けてしまう。
                        年ごとにまとめているときは月日の行そのものが無いので、
                        年を主役の大きさにしてスロットで入れ替える（他の粒度と動きを揃える） */}
                    {dateParts.dayMonth === null ? (
                      <SlotText
                        value={dateParts.year}
                        height={DATE_SLOT_H}
                        textStyle={[styles.dateDayText, { color: colors.text }]}
                        delayMs={reduceMotion ? 0 : (eventAnimMs / speed) * SLOT_DELAY_RATIO}
                        durationMs={reduceMotion ? 1 : (eventAnimMs / speed) * SLOT_DURATION_RATIO}
                      />
                    ) : (
                      <>
                        {/* 年は月日の上に小さく置く。年は日ごとの再生でめったに変わらない */}
                        <Text style={[styles.dateYearText, { color: colors.textMuted }]}>{dateParts.year}</Text>
                        <SlotText
                          value={dateParts.dayMonth}
                          height={DATE_SLOT_H}
                          textStyle={[styles.dateDayText, { color: colors.text }]}
                          delayMs={reduceMotion ? 0 : (eventAnimMs / speed) * SLOT_DELAY_RATIO}
                          durationMs={reduceMotion ? 1 : (eventAnimMs / speed) * SLOT_DURATION_RATIO}
                        />
                      </>
                    )}
                  </Reanimated.View>

                  {/* 金額：配線図の右上に常時表示。直前のイベントからの増減も色付きで表示する。
                      幅は内容準拠（固定しない）：実測幅でバッジ幅を固定すると、計測用テキスト自体が
                      固定済みの幅で切り詰めて計測されるため幅が二度と広がらず、金額が伸びた日に
                      合計も±行も切れて見えなくなる */}
                  <Reanimated.View
                    layout={layoutTransition}
                    style={[styles.priceBadge, {
                      top: insets.top + TOP_BAR_H + HUD_TOP_MARGIN,
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    }]}
                    pointerEvents="none"
                    onLayout={(e) => {
                      const { width: w, height: h } = e.nativeEvent.layout
                      const next = { w: Math.ceil(w), h: Math.ceil(h) }
                      setPriceBadgeSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next))
                      const stored = hudSizesByIndex.current.get(index) ?? { date: dateBadgeSize, price: next }
                      hudSizesByIndex.current.set(index, {
                        ...stored,
                        price: { w: Math.max(stored.price.w, next.w), h: Math.max(stored.price.h, next.h) },
                      })
                    }}
                  >
                    <SlotText
                      value={fmtPrice(priceTotal)}
                      height={DATE_SLOT_H}
                      textStyle={[styles.priceDayText, { color: colors.text }]}
                      delayMs={reduceMotion ? 0 : (eventAnimMs / speed) * SLOT_DELAY_RATIO}
                      durationMs={reduceMotion ? 1 : (eventAnimMs / speed) * SLOT_DURATION_RATIO}
                    />
                    <SlotText
                      value={priceDiff === 0 ? '±0' : `${priceDiff > 0 ? '+' : '-'}${fmtPrice(Math.abs(priceDiff))}`}
                      height={20}
                      textStyle={[
                        styles.priceDiffText,
                        { color: priceDiff > 0 ? inColor : priceDiff < 0 ? outColor : colors.textMuted },
                      ]}
                      delayMs={reduceMotion ? 0 : (eventAnimMs / speed) * SLOT_DELAY_RATIO}
                      durationMs={reduceMotion ? 1 : (eventAnimMs / speed) * SLOT_DURATION_RATIO}
                    />
                  </Reanimated.View>
                </>
              )}

              {/* ── 常設コントロール ── */}
              <View style={[styles.controlBar, { borderTopColor: colors.separator, paddingBottom: insets.bottom + 10 }]}>
                {truncated && onRequirePro && (
                  <TouchableOpacity
                    style={[styles.upsellRow, { marginTop: 6, backgroundColor: withOpacity(colors.accent, 24), borderColor: withOpacity(colors.accentIcon, 64) }]}
                    onPress={() => { onClose(); onRequirePro() }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={ja ? 'Proプランで1年より前の歴史を見る' : 'View history older than 1 year with Pro'}
                  >
                    <AppIcon name="crown-outline" size={15} color={colors.pro} />
                    <Text style={[styles.upsellRowText, { color: colors.accentText }]}>
                      {ja ? '1年より前の歴史はProプランで見られます' : 'See history older than 1 year with Pro'}
                    </Text>
                    <AppIcon name={ICONS.chevronRight} size={16} color={colors.accentText} />
                  </TouchableOpacity>
                )}
                <View ref={coachTarget('pb-progress')} collapsable={false}>
                <ProgressBar
                  progress={progress}
                  count={count}
                  index={index}
                  accent={colors.accent}
                  // 地（bgList）とほぼ同色の chip では溝が見えないので border を使う
                  trackColor={colors.border}
                  knobBorder={colors.bgList}
                  separatorColor={colors.bgList}
                  bubbleBg={colors.card}
                  bubbleBorder={colors.border}
                  bubbleText={colors.text}
                  labelOf={seekLabelOf}
                  detailOf={seekDetailOf}
                  milestones={milestones}
                  onScrubStart={startScrub}
                  onScrub={scrubTo}
                  onScrubEnd={finishScrub}
                />
                {!scrubbing && <Text pointerEvents="none" style={[styles.progressCounter, { color: colors.textMuted }]}>{index + 1}/{count}</Text>}
                </View>

                <View style={styles.controlRow}>
                  <TouchableOpacity
                    style={styles.controlSide}
                    onPress={() => setQuickSpeedOpen(open => !open)}
                    onLongPress={openSettings}
                    accessibilityRole="button"
                    accessibilityLabel={ja ? `再生速度 ${speed}倍` : `Playback speed ${speed}x`}
                    accessibilityHint={ja ? 'タップで速度を選択、長押しで細かく調整' : 'Tap to choose a speed, hold for fine adjustment'}
                    accessibilityState={{ expanded: quickSpeedOpen }}
                  >
                    <Text style={[styles.quickSpeedText, { color: colors.text }]}>{speed}×</Text>
                    <AppIcon name={quickSpeedOpen ? ICONS.chevronDown : ICONS.chevronUp} size={12} color={colors.textMuted} />
                  </TouchableOpacity>
                  <View ref={coachTarget('pb-controls')} style={styles.controlMain}>
                    <TouchableOpacity
                      onPress={() => handleStep(-1)}
                      disabled={index === 0}
                      hitSlop={{ top: 4, bottom: 4 }}
                      style={styles.stepBtn}
                      accessibilityRole="button"
                      accessibilityLabel={ja ? '前へ' : 'Previous'}
                    >
                      <AppIcon name="skip-previous" size={22} color={index === 0 ? colors.textMuted : colors.text} />
                    </TouchableOpacity>
                    <IconCircleButton
                      name={finished ? 'replay' : playing ? 'pause' : 'play'}
                      diameter={40}
                      size={20}
                      color={colors.onAccent}
                      background={colors.accent}
                      style={styles.playBtn}
                      onPress={() => handleToggle(false)}
                      hitSlop={2}
                      accessibilityLabel={finished
                        ? (ja ? '最初から再生' : 'Replay from the beginning')
                        : playing
                          ? (ja ? '一時停止' : 'Pause')
                          : (ja ? '再生' : 'Play')}
                    />
                    <TouchableOpacity
                      onPress={() => handleStep(1)}
                      disabled={index >= count - 1}
                      hitSlop={{ top: 4, bottom: 4 }}
                      style={styles.stepBtn}
                      accessibilityRole="button"
                      accessibilityLabel={ja ? '次へ' : 'Next'}
                    >
                      <AppIcon name="skip-next" size={22} color={index >= count - 1 ? colors.textMuted : colors.text} />
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.controlSide}
                    onPress={() => { setQuickSpeedOpen(false); pb.replayEvent() }}
                    disabled={event?.isTodayPage === true}
                    accessibilityRole="button"
                    accessibilityLabel={ja ? 'この変化をもう一度' : 'Replay this change'}
                    accessibilityHint={ja ? 'この区間の終わりで一時停止します' : 'Pauses at the end of this event'}
                    accessibilityState={{ disabled: event?.isTodayPage === true }}
                  >
                    <AppIcon name="replay" size={21} color={event?.isTodayPage ? colors.textMuted : colors.text} />
                    <Text style={[styles.counterText, { color: colors.textMuted }]}>{ja ? 'この変化' : 'This change'}</Text>
                  </TouchableOpacity>
                  {quickSpeedOpen && (
                    <View style={[styles.quickSpeedMenu, { backgroundColor: colors.card, borderColor: colors.border }]} accessibilityRole="radiogroup" accessibilityLabel={ja ? '再生速度' : 'Playback speed'}>
                      {QUICK_SPEEDS.map(value => (
                        <TouchableOpacity key={value}
                          style={[styles.quickSpeedOption, { backgroundColor: speed === value ? colors.accent : colors.chip }]}
                          onPress={() => { pb.setSpeed(value); setQuickSpeedOpen(false) }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: speed === value }}
                          accessibilityLabel={ja ? `${value}倍` : `${value}x`}
                        >
                          <Text style={[styles.quickSpeedText, { color: speed === value ? colors.onAccent : colors.text }]}>{value}×</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {/* 中央は操作結果だけを短く表示。操作本体は下部バーに常設する。 */}
              {centerFeedbackIcon && onboardingState !== 'show' && (
                <Animated.View
                  style={[styles.centerFeedback, { opacity: centerFeedbackOpacity, backgroundColor: colors.card, borderColor: colors.border }]}
                  pointerEvents="none"
                >
                  <AppIcon name={centerFeedbackIcon} size={28} color={colors.text} centered />
                </Animated.View>
              )}

              {/* 初回だけ表示する操作ガイド。確認後に再生を開始する */}
              {onboardingState === 'show' && (
                <Pressable style={styles.onboardingOverlay} onPress={dismissOnboarding}>
                  <View style={[styles.onboardingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.onboardingTitle, { color: colors.text }]}>
                      {ja ? 'デスクの歴史' : 'Desk History'}
                    </Text>
                    <Text style={[styles.onboardingLead, { color: colors.textSub }]}>
                      {ja
                        ? '導入日と撤去日から、配線図が育っていく様子を再生します。'
                        : 'Watch your wiring grow, built from install and removal dates.'}
                    </Text>
                    <View style={styles.onboardingHints}>
                      <OnboardingHint
                        icon="gesture-tap"
                        text={ja ? '画面の中央をタップで再生・停止' : 'Tap the middle to play or pause'}
                        colors={colors}
                      />
                      <OnboardingHint
                        icon="gesture-swipe-horizontal"
                        text={ja ? '左右をタップで前後の日へ' : 'Tap left or right to step between days'}
                        colors={colors}
                      />
                      <OnboardingHint
                        icon="gesture-tap-hold"
                        text={ja ? '長押ししているあいだは一時停止' : 'Press and hold to pause'}
                        colors={colors}
                      />
                    </View>
                    <View style={[styles.onboardingStartBtn, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.onboardingStartText, { color: colors.onAccent }]}>
                        {ja ? 'タップして開始' : 'Tap to start'}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              )}
            </View>
          </Animated.View>
        )}
      </View>

      <BottomSheetModal visible={yearlyInfo !== null} onDismiss={closeInfo} sheetStyle={[styles.sheet, styles.speedSheet]}>
        {yearlyInfo && <>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>
              {yearlyInfo.changes[0].date.slice(0, 4)} · {historyYearlyChangeLabel(yearlyInfo, lang)}
            </Text>
            <TouchableOpacity onPress={closeInfo} hitSlop={12} accessibilityRole="button" accessibilityLabel={ja ? '閉じる' : 'Close'}>
              <AppIcon name={ICONS.close} size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <Text style={[styles.sheetToggleSub, { color: colors.textMuted }]}>
            {ja ? '同じ日の導入・撤去・使い方の変更を1回と数えています。' : 'Additions, removals and usage changes on the same date count as one change.'}
          </Text>
          <ScrollView nestedScrollEnabled style={styles.yearlyHistoryScroll} contentContainerStyle={styles.speedSheetContent}>
            {yearlyInfo.initialGadgets.length > 0 && <InfoRow label={ja ? '年初の構成' : 'At the start of the year'}
              value={yearlyInfo.initialGadgets.map((g) => localizedGadgetName(g, lang)).join(' / ')} colors={colors} />}
            {yearlyInfo.changes.map((change, i) => (
              <InfoRow key={`${change.date}-${change.kind}-${change.gadget.id}-${i}`}
                label={`${change.date}\n${change.kind === 'in' ? (ja ? '導入' : 'Added') : change.kind === 'out' ? (ja ? '撤去' : 'Removed') : change.mode === 'decor' ? (ja ? '飾りに変更' : 'Changed to decor') : (ja ? '使用を再開' : 'Active use')}`}
                value={localizedGadgetName(change.gadget, lang)} colors={colors} />
            ))}
            <InfoRow label={ja ? '最後の構成' : 'Final setup'} colors={colors}
              value={yearlyInfo.finalGadgets.map((g) => localizedGadgetName(g, lang)).join(' / ') || (ja ? '未使用' : 'Not in use')} />
          </ScrollView>
        </>}
      </BottomSheetModal>

      {/* ── ガジェット情報シート（開いている間は再生停止） ── */}
      <BottomSheetModal visible={infoGadget !== null} onDismiss={closeInfo} sheetStyle={styles.sheet}>
          {infoGadget && (
            <>
              <View style={styles.infoHeader}>
                <View style={[styles.infoCatIcon, { backgroundColor: (categoryBaseColor(infoGadget.category, infoGadget.customCategory?.color, '#888888')) + '22' }]}>
                  <CategoryIcon category={infoGadget.category} pcFormFactor={infoGadget.pcFormFactor} customIcon={infoGadget.customCategory?.icon} size={24} color={categoryIconColor(infoGadget.category, isDark, undefined, infoGadget.customCategory?.color)} />
                </View>
                <Text style={[styles.infoName, { color: colors.text }]} numberOfLines={2}>{localizedGadgetName(infoGadget, lang)}</Text>
                <TouchableOpacity onPress={closeInfo} hitSlop={12} accessibilityRole="button" accessibilityLabel={ja ? '閉じる' : 'Close'}>
                  <AppIcon name={ICONS.close} size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <InfoRow
                label={ja ? 'ジャンル' : 'Category'}
                value={customCategoryOf(infoGadget)?.name ?? (ja ? CATEGORY_LABELS : CATEGORY_LABELS_EN)[infoGadget.category] ?? infoGadget.category}
                colors={colors}
              />
              {infoGadget.model ? <InfoRow label={ja ? '型番' : 'Model'} value={infoGadget.model} colors={colors} /> : null}
              {infoGadget.price != null ? <InfoRow label={ja ? '購入価格' : 'Price'} value={fmtPrice(infoGadget.price)} colors={colors} /> : null}
              {infoGadget.purchasedAt ? <InfoRow label={ja ? '導入日' : 'Added'} value={infoGadget.purchasedAt} colors={colors} /> : null}
              {infoGadget.removedAt ? <InfoRow label={ja ? '撤去日' : 'Removed'} value={infoGadget.removedAt} colors={colors} /> : null}
              {/* メモは最大1000文字。2行で切ると続きを読む場所がこのシートに無いので、
                  全文を出してシートの中だけスクロールさせる */}
              {infoGadget.memo ? (
                <View style={[styles.infoMemo, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.infoLabel, { color: colors.textMuted }]}>{ja ? 'メモ' : 'Notes'}</Text>
                  {/* 本文は右端まで流れるので、スクロールバーのぶん空けないと行末の字に重なる */}
                  <ScrollView style={styles.infoMemoScroll} contentContainerStyle={styles.infoMemoContent} nestedScrollEnabled>
                    <Text style={[styles.infoMemoText, { color: colors.text }]}>
                      {localizedGadgetMemo(infoGadget, lang) ?? infoGadget.memo}
                    </Text>
                  </ScrollView>
                </View>
              ) : null}
            </>
          )}
      </BottomSheetModal>

      {/* ── 再生設定シート ── */}
      <BottomSheetModal visible={settingsOpen} onDismiss={closeSettings} sheetStyle={[styles.sheet, styles.speedSheet]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>{ja ? '再生設定' : 'Playback settings'}</Text>
            <TouchableOpacity onPress={closeSettings} hitSlop={12} accessibilityRole="button" accessibilityLabel={ja ? '閉じる' : 'Close'}>
              <AppIcon name={ICONS.close} size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.speedSheetContent}
          >
          <Text style={[styles.sheetSectionLabel, { color: colors.textMuted }]}>
            {ja ? 'まとめる単位' : 'Group history by'}
          </Text>
          <SegmentedControl
            options={GRAINS.map((g) => ({ key: g, label: grainLabel(g, lang), accessibilityLabel: grainAccessibilityLabel(g, lang) }))}
            value={historyGrain}
            onChange={(g) => { if (g !== historyGrain) void setHistoryGrain(g) }}
            style={styles.sheetSegment}
            accessibilityLabel={ja ? 'まとめる単位' : 'Group history by'}
          />

          <Text style={[styles.sheetSectionLabel, { color: colors.textMuted }]}>{ja ? '再生速度' : 'Speed'}</Text>
          <PlaybackSpeedControl value={speed} onChange={pb.setSpeed} />

          {/* 導入・撤去（±）の一覧を出すか。OFF で配線図を全画面表示にする */}
          <View style={[styles.sheetToggleRow, { borderTopColor: colors.separator }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetRowText, { color: colors.text }]}>
                {ja ? '導入・撤去の一覧' : 'Added / removed list'}
              </Text>
              <Text style={[styles.sheetToggleSub, { color: colors.textMuted }]}>
                {ja ? 'OFFで配線図を全画面表示' : 'Off: show wiring full screen'}
              </Text>
            </View>
            <ContrastToggle
              value={historyShowInOut}
              onValueChange={(on) => { void setHistoryShowInOut(on) }}
              colors={colors}
              accessibilityLabel={ja ? '導入・撤去の一覧' : 'Added / removed list'}
            />
          </View>

          {/* ガジェットの滑らか移動 ON/OFF（OFF なら各日の配置へ瞬時に切り替わる） */}
          <View style={[styles.sheetToggleRow, { borderTopColor: colors.separator }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetRowText, { color: colors.text }]}>
                {ja ? '機材の滑らか移動' : 'Smooth gadget movement'}
              </Text>
              <Text style={[styles.sheetToggleSub, { color: colors.textMuted }]}>
                {ja ? 'OFFで各日の配置へ瞬時に切り替え' : 'Off: snap to each day’s layout'}
              </Text>
            </View>
            <ContrastToggle
              value={historyNodeMorph}
              onValueChange={setHistoryNodeMorph}
              colors={colors}
              disabled={reduceMotion}
              accessibilityLabel={ja ? '機材の滑らか移動' : 'Smooth gadget movement'}
            />
          </View>

          </ScrollView>
      </BottomSheetModal>
      {coach.overlay}
    </Modal>
  )
}


/**
 * スロットのように値が入れ替わるテキスト。
 * 前の値は下へスライドしながら消え、新しい値が上から降りてくる。
 */
function SlotText({ value, height, width, textStyle, delayMs, durationMs, minimumFontScale = 0.5 }: {
  value: string; height: number; width?: number; textStyle: any; delayMs: number; durationMs: number; minimumFontScale?: number
}) {
  const [pair, setPair] = useState<{ prev: string | null; curr: string }>({ prev: null, curr: value })
  const [reservedWidth, setReservedWidth] = useState<number | null>(null)
  const currentWidth = useRef(0)
  const a = useRef(new Animated.Value(1)).current
  // 遅延・尺は最新値を使う（速度変更に追従させる）
  const timing = useRef({ delayMs, durationMs })
  timing.current = { delayMs, durationMs }

  useEffect(() => {
    if (pair.curr === value) return
    if (!width && currentWidth.current > 0) {
      setReservedWidth((previous) => Math.max(previous ?? 0, currentWidth.current))
    }
    setPair({ prev: pair.curr, curr: value })
    a.setValue(0)
    const animation = Animated.timing(a, {
      toValue: 1,
      // 配線図が入れ替わるタイミングまで待ってから、前の月日を送り出す
      delay: timing.current.delayMs,
      duration: timing.current.durationMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    animation.start(({ finished }) => {
      if (!finished) return
      setPair((latest) => latest.curr === value ? { prev: null, curr: latest.curr } : latest)
      setReservedWidth(null)
    })
    return () => animation.stop()
    // pair.curr は value が変わった瞬間の退場値としてだけ読む。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, a])

  const enterY = a.interpolate({ inputRange: [0, 1], outputRange: [-height, 0] })
  const exitY  = a.interpolate({ inputRange: [0, 1], outputRange: [0, height] })
  const exitOp = a.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })

  // 年の横幅が決まるまでは幅指定しない（0 幅で潰れないように）
  const fit = width && width > 0 ? { width, adjustsFontSizeToFit: true, minimumFontScale } : {}

  return (
    <View style={{ height, width: width && width > 0 ? width : undefined, minWidth: !width ? reservedWidth ?? undefined : undefined, overflow: 'hidden', justifyContent: 'center' }}>
      {pair.prev !== null && (
        <Animated.Text
          style={[textStyle, styles.slotPrev, { opacity: exitOp, transform: [{ translateY: exitY }] }]}
          numberOfLines={1}
          ellipsizeMode="clip"
          {...fit}
        >
          {pair.prev}
        </Animated.Text>
      )}
      <Animated.Text
        style={[textStyle, { opacity: a, transform: [{ translateY: enterY }] }]}
        numberOfLines={1}
        ellipsizeMode="clip"
        onLayout={(event) => { currentWidth.current = Math.ceil(event.nativeEvent.layout.width) }}
        {...fit}
      >
        {pair.curr}
      </Animated.Text>
    </View>
  )
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: AppColors }) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: colors.text }]} numberOfLines={2}>{value}</Text>
    </View>
  )
}

/**
 * 最終ページの記録行。「一番高い買い物」「最長のつきあい」のように、
 * 数字だけでは意味が立たないものを機器名とセットで見せる
 */
function SummaryRecord({ label, gadget, value, colors, isDark, lang }: {
  label: string; gadget: Gadget; value: string; colors: AppColors; isDark: boolean; lang: 'ja' | 'en'
}) {
  return (
    <View style={[styles.summaryRecord, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <CategoryIcon category={gadget.category} pcFormFactor={gadget.pcFormFactor} customIcon={gadget.customCategory?.icon} size={22} color={categoryIconColor(gadget.category, isDark, undefined, gadget.customCategory?.color)} />
      <View style={styles.summaryRecordBody}>
        {/* 見出しが商品名だとジャンルが絵だけになるので、記録の名前の行にジャンル名を添える */}
        <Text style={[styles.summaryRecordLabel, { color: colors.textMuted }]} numberOfLines={1}>
          {gadgetGenreLabel(gadget, lang) ? `${label}  ·  ${gadgetGenreLabel(gadget, lang)}` : label}
        </Text>
        <Text style={[styles.summaryRecordName, { color: colors.text }]} numberOfLines={1}>
          {localizedGadgetName(gadget, lang)}
        </Text>
      </View>
      <Text style={[styles.summaryRecordValue, { color: colors.text }]} numberOfLines={1}>{value}</Text>
    </View>
  )
}

/**
 * 0 から目標値まで数え上げるテキスト。
 * 最終ページは配線図が動き終わった直後なので、止まった数字のまま出すと動→静の落差で読み飛ばされる。
 * 桁幅の揺れで隣の文字が跳ねないよう、スタイル側で tabular-nums を当てている前提。
 */
function CountUpValue({ value, format, style, delayMs, reduceMotion, ready = true }: {
  value: number; format: (n: number) => string; style: any; delayMs: number; reduceMotion: boolean; ready?: boolean
}) {
  const [shown, setShown] = useState(value)
  const a = useRef(new Animated.Value(1)).current
  const animatedValue = useRef<number | null>(null)

  useEffect(() => {
    if (!ready) return
    const changed = animatedValue.current !== value
    animatedValue.current = value
    if (reduceMotion || value <= 0 || !changed) { setShown(value); a.setValue(1); return }
    setShown(0)
    a.setValue(0)
    const id = a.addListener(({ value: t }) => setShown(Math.round(value * t)))
    const anim = Animated.timing(a, {
      toValue: 1,
      duration: 900,
      delay: delayMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    })
    anim.start(({ finished }) => { if (finished) setShown(value) })
    return () => {
      anim.stop()
      a.removeListener(id)
    }
  }, [value, delayMs, reduceMotion, a, ready])

  return (
    <Text style={style} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
      {format(shown)}
    </Text>
  )
}

/** 最終ページの要素を順に立ち上げる。全部同時に出すと、どれから読めばいいのか分からない */
function RiseIn({ delayMs, reduceMotion, children, ready = true }: { delayMs: number; reduceMotion: boolean; children: ReactNode; ready?: boolean }) {
  const a = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current

  useEffect(() => {
    if (!ready) return
    if (reduceMotion) { a.setValue(1); return }
    const anim = Animated.timing(a, {
      toValue: 1,
      duration: 320,
      delay: delayMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [a, delayMs, reduceMotion, ready])

  return (
    <Animated.View style={{ opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      {children}
    </Animated.View>
  )
}

/** 初回ガイドの1行 */
function OnboardingHint({ icon, text, colors }: { icon: MCIconName; text: string; colors: AppColors }) {
  return (
    <View style={styles.onboardingHintItem}>
      <View style={[styles.onboardingHintIcon, { backgroundColor: colors.chip }]}>
        <AppIcon name={icon} size={18} color={colors.text} />
      </View>
      <Text style={[styles.onboardingHintText, { color: colors.textSub }]}>{text}</Text>
    </View>
  )
}

/**
 * IN/OUT のページが切り替わるときに中身を短くフェードさせる。
 * 差し替えが一瞬すぎて「ページが変わった」と気づけないのを補う。
 */
function PageFade({ swapKey, reduceMotion, children, ready = true }: { swapKey: string; reduceMotion: boolean; children: ReactNode; ready?: boolean }) {
  const a = useRef(new Animated.Value(1)).current
  const previousPage = useRef<string | null>(null)
  useEffect(() => {
    if (!ready) return
    const changed = previousPage.current !== swapKey
    previousPage.current = swapKey
    if (reduceMotion || !changed) { a.setValue(1); return }
    a.setValue(0)
    const anim = Animated.timing(a, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true })
    anim.start()
    return () => anim.stop()
  }, [swapKey, reduceMotion, a, ready])
  return <Animated.View style={{ opacity: a }}>{children}</Animated.View>
}

/**
 * ストーリー型の進捗バー。全体は単一 Animated.Value のまま動かし、静的な区切り線だけ
 * 重ねるため、イベント数ぶんのアニメーションを作らない。
 * ドラッグ中は位置（0..1）を1フレームに1回だけ onScrub へ渡し、配線図を指に追随させる。
 * 指を離したらその位置で onScrubEnd を1回呼ぶ。
 */
function ProgressBar({
  progress, count, index, accent, trackColor, knobBorder, separatorColor,
  bubbleBg, bubbleBorder, bubbleText, labelOf, detailOf, milestones, onScrubStart, onScrub, onScrubEnd,
}: {
  progress: Animated.Value
  count: number
  index: number
  accent: string
  trackColor: string
  knobBorder: string
  separatorColor: string
  bubbleBg: string
  bubbleBorder: string
  bubbleText: string
  labelOf: (i: number) => string
  detailOf: (i: number) => string
  milestones: number[]
  onScrubStart: () => boolean
  onScrub: (ratio: number) => void
  onScrubEnd: (ratio: number, resume: boolean) => void
}) {
  const widthRef = useRef(0)
  const [trackWidth, setTrackWidth] = useState(0)
  // ドラッグ中だけ state を更新する。この間は再生が止まっている（onScrubStart が pause する）ので、
  // 毎フレームの再レンダーが配線図の演出とスレッドを食い合うことはない。
  const [scrub, setScrub] = useState<{ x: number; index: number } | null>(null)
  const pendingRatio = useRef(0)
  const resumeAfterScrub = useRef(false)
  // 指の移動はフレームより細かく届く。配線図の位置合わせ（日をまたぐと図の作り直し）は
  // 1フレームに1回で足りるので、最後の位置だけを次のフレームで渡す
  const scrubFrame = useRef<number | null>(null)
  const dragging = useRef(false)
  useEffect(() => () => {
    dragging.current = false
    if (scrubFrame.current !== null) cancelAnimationFrame(scrubFrame.current)
  }, [])
  // PanResponder は初回レンダーで一度だけ生成されるため、最新値は ref 経由で読む。
  const latest = useRef({ count, progress, onScrubStart, onScrub, onScrubEnd })
  latest.current = { count, progress, onScrubStart, onScrub, onScrubEnd }
  const canScrub = () => widthRef.current > 0 && latest.current.count > 0
  const preview = (x: number) => {
    if (!dragging.current) return
    const w = widthRef.current
    const { count: c, progress: value } = latest.current
    if (w <= 0 || c <= 0) return
    const clampedX = Math.max(0, Math.min(w, x))
    const ratio = clampedX / w
    pendingRatio.current = ratio
    value.setValue(ratio)
    setScrub({ x: clampedX, index: Math.min(c - 1, Math.floor(ratio * c)) })
    if (scrubFrame.current === null) {
      scrubFrame.current = requestAnimationFrame(() => {
        scrubFrame.current = null
        latest.current.onScrub(pendingRatio.current)
      })
    }
  }
  const commitPending = () => {
    if (!dragging.current) return
    dragging.current = false
    if (scrubFrame.current !== null) {
      cancelAnimationFrame(scrubFrame.current)
      scrubFrame.current = null
    }
    setScrub(null)
    latest.current.onScrubEnd(pendingRatio.current, resumeAfterScrub.current)
  }
  const commit = (x: number) => {
    preview(x)
    commitPending()
  }
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: canScrub,
      onMoveShouldSetPanResponder: canScrub,
      onPanResponderGrant: (e) => {
        if (!canScrub()) return
        dragging.current = true
        latest.current.progress.stopAnimation()
        resumeAfterScrub.current = latest.current.onScrubStart()
        preview(e.nativeEvent.locationX)
      },
      onPanResponderMove: (e) => preview(e.nativeEvent.locationX),
      onPanResponderRelease: (e) => commit(e.nativeEvent.locationX),
      onPanResponderTerminate: commitPending,
    }),
  ).current

  // 幅（%）ではなく scaleX で伸ばす。width をアニメーションすると毎フレーム Yoga の
  // レイアウト計算が走り、しかも useNativeDriver が使えないため再生中ずっと JS スレッドを
  // 削り続ける（配線図の演出と食い合う）。transform なら UI スレッドだけで完結する。
  const fillScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' })
  // つまみも同じ Animated.Value から translateX で動かす（UIスレッド完結）
  const knobX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, trackWidth)], extrapolate: 'clamp' })
  const scrubbing = scrub !== null
  const bubbleWidth = Math.min(SEEK_BUBBLE_W, trackWidth)
  const bubbleLeft = scrub
    ? Math.max(0, Math.min(Math.max(0, trackWidth - bubbleWidth), scrub.x - bubbleWidth / 2))
    : 0
  const bubbleLabel = scrub ? labelOf(scrub.index) : labelOf(index)

  return (
    <View
      style={styles.progressHit}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width
        widthRef.current = w
        setTrackWidth((prev) => (Math.abs(prev - w) <= 1 ? prev : w))
      }}
      {...responder.panHandlers}
    >
      {scrubbing && (
        <View
          style={[styles.seekBubble, { left: bubbleLeft, width: bubbleWidth, backgroundColor: bubbleBg, borderColor: bubbleBorder }]}
          pointerEvents="none"
        >
          <Text style={[styles.seekBubbleText, { color: bubbleText }]} numberOfLines={1}>{bubbleLabel}</Text>
          <Text style={[styles.seekDetailText, { color: bubbleText }]} numberOfLines={2}>{detailOf(scrub.index)}</Text>
        </View>
      )}
      {/* 触れた位置は外枠（progressHit）基準で読む。塗りは scaleX で縮めてあり、その上に指が乗ると
          locationX が縮める前の座標で返って、つまみが右端へ飛ぶ（区切り線の上だと先頭へ飛ぶ） */}
      <View
        style={[styles.progressTrack, { backgroundColor: trackColor }, scrubbing && styles.progressTrackExpanded]}
        pointerEvents="none"
      >
        <Animated.View style={[styles.progressFill, { backgroundColor: accent, transform: [{ scaleX: fillScale }] }]} />
        {count > 1 && count <= MAX_SEGMENTED_EVENTS && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {Array.from({ length: count - 1 }, (_, i) => (
              <View
                key={i}
                style={[styles.progressSeparator, { backgroundColor: separatorColor, left: `${((i + 1) / count) * 100}%` }]}
              />
            ))}
          </View>
        )}
      </View>
      {milestones.reduce<number[]>((shown, i) => {
        if (!shown.length || (i - shown[shown.length - 1]) * trackWidth / count >= 10) shown.push(i)
        return shown
      }, []).map(i => (
        <View key={i} pointerEvents="none" style={[styles.progressMilestone, { left: `${(i / count) * 100}%`, backgroundColor: accent }]} />
      ))}
      {/* つまみ。以前は無く、細い線をどこまで掴めば良いのか分からなかった。
          translateX と scale は同じ transform 配列に入れる（別々に書くと後勝ちで片方が消える） */}
      <Animated.View
        style={[
          styles.seekKnob,
          {
            backgroundColor: accent,
            borderColor: knobBorder,
            transform: [{ translateX: knobX }, { scale: scrubbing ? 1.3 : 1 }],
          },
        ]}
        pointerEvents="none"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1 },

  centerBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  centerText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  loadingTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  loadingPercent: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  loadingClose: {
    position: 'absolute', right: 16,
    width: UI_METRICS.headerActionSize, height: UI_METRICS.headerActionSize,
    borderRadius: UI_METRICS.headerActionSize / 2, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  loadingTrack: { width: 220, height: 6, borderRadius: 3, overflow: 'hidden' },
  loadingFill:  { height: '100%', borderRadius: 3 },
  emptyIcon:    { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  emptyTitle:   { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  closeBtnWide: { borderRadius: UI_METRICS.pillRadius, minHeight: UI_METRICS.buttonHeight, justifyContent: 'center', paddingHorizontal: 32, marginTop: 8 },
  closeBtnWideText: { fontSize: 15, fontWeight: '700' },

  player:     { flex: 1 },
  canvasWrap: { flex: 1 },
  gestureLayer:  { ...StyleSheet.absoluteFillObject, flexDirection: 'row' },
  gestureSide:   { flex: 1 },
  gestureCenter: { flex: 2 },

  // ヘッダー（常設）
  // 高さは「セーフエリア + TOP_BAR_H」になる。日付バッジもこの値を基準に配置しているので、
  // ここの余白を変えるときは TOP_BAR_H と揃えること
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: UI_METRICS.headerActionSize, height: UI_METRICS.headerActionSize,
    borderRadius: UI_METRICS.headerActionSize / 2, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitleBox: { flex: 1, minWidth: 0, alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700' },
  headerSub:   { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginTop: 1, textTransform: 'uppercase' },

  // 日付（配線図の左上に常時表示）
  dateBadge:     { position: 'absolute', left: 16, borderRadius: UI_METRICS.chipRadius, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 6 },
  dateYearText:  { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, lineHeight: 15 },
  dateDayText:   { fontSize: 21, fontWeight: '800', letterSpacing: 0.2, lineHeight: 26 },
  slotPrev:      { position: 'absolute', left: 0, right: 0 },

  // 金額（配線図の右上に常時表示）。幅は内容準拠。日付バッジと重ならないよう上限だけ設ける
  priceBadge:    { position: 'absolute', right: 16, borderRadius: UI_METRICS.chipRadius, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'flex-end', maxWidth: '48%' },
  priceDayText:  { fontSize: 19, fontWeight: '800', letterSpacing: 0.2, lineHeight: 26, textAlign: 'right' },
  priceDiffText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.1, lineHeight: 16, textAlign: 'right' },

  // タップ時だけ短く出す中央フィードバック
  centerFeedback: { position: 'absolute', left: '50%', top: '50%', marginLeft: -27, marginTop: -27, width: 54, height: 54, borderRadius: 27, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', zIndex: 12 },

  // IN/OUT 表示エリア（配線図の下に高さを確保）
  inoutPanel:     { paddingHorizontal: 16, justifyContent: 'flex-end', overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth },
  inoutRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, height: ROW_H },
  // ＋/− の一文字バッジは円。同じ画面の playBtn・pageDot・emptyIcon と同じ扱い
  inoutBadge:     { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  inoutBadgeText: { fontSize: 17, fontWeight: '900', lineHeight: 20 },
  inoutCatIcon:   { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  inoutDetails:   { flex: 1, minWidth: 0 },
  inoutName:      { fontSize: 14, fontWeight: '600' },
  inoutCableRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden' },
  inoutCableItem: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  inoutCableLabel: { flexShrink: 1 },
  inoutCableDot:  { width: 6, height: 6, borderRadius: 3 },
  inoutCableText: { fontSize: 10, fontWeight: '600' },
  pageDots:       { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, height: DOTS_H },
  pageDot:        { width: 6, height: 6, borderRadius: 3 },
  pageDotActive:  { width: 14 },

  // 下部の常設コントロール
  controlBar:   { paddingHorizontal: 16, paddingTop: 4, borderTopWidth: StyleSheet.hairlineWidth },
  controlRow:   { position: 'relative', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  controlMain:  { flexDirection: 'row', alignItems: 'center', gap: 2 },
  stepBtn:      { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  playBtn:      { marginHorizontal: 2 },
  controlSide: { minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 2 },
  counterText: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  progressCounter: { position: 'absolute', top: 6, right: 0, fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  quickSpeedText: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  quickSpeedMenu: { position: 'absolute', left: 0, bottom: 54, flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 6, borderRadius: UI_METRICS.chipRadius, borderWidth: StyleSheet.hairlineWidth, zIndex: 20 },
  quickSpeedOption: { minWidth: 44, minHeight: 44, borderRadius: UI_METRICS.chipRadius, justifyContent: 'center', alignItems: 'center' },
  // まとめる単位のセグメント

  // 進捗バー。吹き出しは親からはみ出すと Android で切られるため、
  // タップ領域の中に吹き出しぶんの高さを確保しておく（PROGRESS_HIT_H の上側）
  progressHit:           { alignSelf: 'stretch', justifyContent: 'flex-end', height: PROGRESS_HIT_H, paddingBottom: PROGRESS_TRACK_BOTTOM },
  progressTrack:         { height: 4, borderRadius: UI_METRICS.pillRadius, overflow: 'hidden' },
  progressTrackExpanded: { height: 6, borderRadius: UI_METRICS.pillRadius },
  // scaleX で伸ばすので、幅は常に満杯にして左端を軸に縮める
  progressFill:          { height: '100%', width: '100%', transformOrigin: 'left' },
  progressSeparator:     { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1 },
  seekKnob:              {
    position: 'absolute',
    top: PROGRESS_HIT_H - PROGRESS_TRACK_BOTTOM - 2 - SEEK_KNOB / 2,
    left: -SEEK_KNOB / 2,
    width: SEEK_KNOB, height: SEEK_KNOB, borderRadius: SEEK_KNOB / 2, borderWidth: 2,
  },
  seekBubble:            { position: 'absolute', top: 0, width: SEEK_BUBBLE_W, borderRadius: UI_METRICS.chipRadius, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 4 },
  seekBubbleText:        { fontSize: 12, fontWeight: '800', lineHeight: 15, textAlign: 'center' },
  seekDetailText:        { fontSize: 11, lineHeight: 14, textAlign: 'center', paddingHorizontal: 6 },
  progressMilestone:     { position: 'absolute', bottom: 0, width: 3, height: 3, borderRadius: 2, marginLeft: -1.5 },

  // 初回操作ガイド
  onboardingOverlay:  { ...StyleSheet.absoluteFillObject, zIndex: 30, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  onboardingCard:     { width: '100%', maxWidth: 380, borderRadius: UI_METRICS.cardRadius, borderWidth: StyleSheet.hairlineWidth, padding: 20, gap: 10 },
  onboardingTitle:    { fontSize: 20, fontWeight: '800' },
  onboardingLead:     { fontSize: 13, lineHeight: 19 },
  onboardingHints:    { gap: 12, marginTop: 6 },
  onboardingHintItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  onboardingHintIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  onboardingHintText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  onboardingStartBtn: { marginTop: 10, borderRadius: UI_METRICS.pillRadius, minHeight: UI_METRICS.buttonHeight, alignItems: 'center', justifyContent: 'center' },
  onboardingStartText:{ fontSize: 15, fontWeight: '800' },

  // 最終「今日」ページのサマリー
  todayPanel:           { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  todayHeader:          { flexDirection: 'row', alignItems: 'center', gap: 10 },
  todayTitle:           { flex: 1, fontSize: 17, fontWeight: '800' },
  todayDurationChip:    { borderRadius: UI_METRICS.chipRadius, paddingHorizontal: 9, paddingVertical: 4, maxWidth: '52%' },
  todayDuration:        { fontSize: 12, fontWeight: '700' },
  upsellRow:            { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: UI_METRICS.controlRadius, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 8 },
  upsellRowText:        { flex: 1, fontSize: 12, fontWeight: '700' },
  summaryHero:          { borderRadius: UI_METRICS.controlRadius, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center' },
  summaryHeroValue:     { width: '100%', fontSize: 34, fontWeight: '900', textAlign: 'center', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  summaryHeroLabel:     { fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  summaryRecord:        { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: UI_METRICS.controlRadius, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingVertical: 9 },
  summaryRecordBody:    { flex: 1, minWidth: 0 },
  summaryRecordLabel:   { fontSize: 11, fontWeight: '700' },
  summaryRecordName:    { fontSize: 14, fontWeight: '800', marginTop: 1 },
  summaryRecordValue:   { fontSize: 15, fontWeight: '900', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  summaryActions:       { flexDirection: 'row', gap: 10 },
  summarySecondaryBtn:  { flex: 1, minHeight: UI_METRICS.touchMinSize, borderRadius: UI_METRICS.pillRadius, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  summaryPrimaryBtn:    { flex: 1, minHeight: UI_METRICS.touchMinSize, borderRadius: UI_METRICS.pillRadius, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  summarySecondaryText: { fontSize: 14, fontWeight: '800' },

  // 再生設定シート
  // 下余白は他のシートと同じ sheetBottom。safe-area を足していた頃は、ここだけ
  // ホームインジケータから 58 離れて浮いて見えた
  sheet:       { gap: 4 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  sheetTitle:  { fontSize: 17, fontWeight: '800' },
  sheetSectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 },
  sheetRowText:{ fontSize: 15, fontWeight: '600' },
  sheetToggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth },
  // 行数が多い。画面を覆い尽くさないよう上限を設けて中身をスクロールさせる
  speedSheet: { maxHeight: '86%' },
  speedSheetContent: { paddingBottom: 4 },
  sheetToggleSub: { fontSize: 12, marginTop: 2 },
  sheetSegment:  { alignSelf: 'stretch', marginBottom: 16 },

  // ガジェット情報シート
  infoHeader:  { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  infoCatIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  infoName:    { flex: 1, fontSize: 17, fontWeight: '800' },
  infoRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLabel:   { fontSize: 13 },
  infoValue:   { flex: 1, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  infoMemo:    { gap: 6, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  // 長いメモでもシートが画面の上まで伸びないよう、メモの欄だけ高さを抑えてスクロールさせる
  infoMemoScroll: { maxHeight: 180 },
  yearlyHistoryScroll: { maxHeight: 420 },
  infoMemoContent: { paddingRight: 8 },
  infoMemoText: { fontSize: 14, lineHeight: 20 },
})
