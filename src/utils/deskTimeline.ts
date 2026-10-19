import { DeskGadgetUsageMode, DeskGadgetUsagePeriod, DeskPlan, Gadget, MapConnection } from '../types'
import { buildAutoDraft } from './connectionMapLayout'
import { gadgetCategoryKey } from './customCategory'

// ─── デスク歴史タイムライン生成（純粋関数）──────────────────────────
// ガジェットの導入日(purchasedAt)・撤去日(removedAt)から、日付ごとの
// IN / OUT イベントを自動生成する。同じ日付のイベントは 1 グループにまとめる
// （同日 OUT + IN = 交換に相当するが、REPLACE 概念は持たず両方を並べて表示）。
//
// 配線は「現在の配線図をその時点の在席ガジェットで絞り込む」のではなく、
// 在席ガジェットだけを入力にして配線エンジンで作り直す。こうしないと、
// ・電源タップを買う前の時代 → タップ経由の線が消えてガジェットが電源から浮く
// ・充電器を買い替えた世代交代 → 旧充電器に繋がっていたガジェットが孤立する
// といった「線が繋がらない時代」が生まれてしまう。作り直せば、タップが無い日は
// 壁コンセントへ直結し、その日に在席している充電器へ繋ぎ直される。
//
// 責務はイベント生成と「各時点のデスク状態（在席ガジェット・有効な接続）」の
// 算出まで。再生制御・描画は含めない。

// ケーブルは配線図の線とは別に一覧で持つ持ち物で、配線図の機器ではない（配線図・構成比と同じ扱い）。
// 図の入力に残すと配置計算に入り、線の無い機器として浮く
const withoutCables = (gadgets: Gadget[]) => gadgets.filter((g) => g.category !== 'Cable')

/**
 * イベントをまとめる単位。ユーザーが再生中に切り替えられる。
 * ガジェットが多い／期間が長いデスクほど、月・年でまとめるとページ数が減って全体を掴みやすい。
 */
export type TimelineGrain = 'day' | 'month' | 'year'

export type TimelineUsageChange = { kind: 'in' | 'out' | 'mode'; date: string; gadget: Gadget; mode: DeskGadgetUsageMode }

export interface TimelineYearlyChange {
  categoryKey: string
  changeCount: number
  changes: TimelineUsageChange[]
  initialGadgets: Gadget[]
  finalGadgets: Gadget[]
}

/** まとめキー（年 YYYY ／ 月 YYYY-MM ／ 日 YYYY-MM-DD）。どれも辞書順＝時系列順 */
const grainKeyOf = (date: string, grain: TimelineGrain): string =>
  grain === 'year' ? date.slice(0, 4) : grain === 'month' ? date.slice(0, 7) : date

export interface TimelineEvent {
  /**
   * YYYY-MM-DD（キー・比較用）。月・年でまとめたときも「その期間で最後に動きがあった実日付」
   * を入れる（期間キーは入れない）。在席判定・配置解決（resolveTimelineLayout）・日付表示が
   * すべて実日付を前提にしているため、粒度を変えても壊れない。
   */
  date: string
  /**
   * この期間で最初に動きがあった実日付（日ごとなら date と同じ）。
   * 無料プランの表示制限に使う：期間の一部でも制限より前なら、その期間ごと見せない。
   */
  firstDate: string
  inGadgets: Gadget[]           // この期間に導入されたガジェット
  outGadgets: Gadget[]          // この期間に撤去されたガジェット
  modeChanges: Array<{ gadget: Gadget; mode: DeskGadgetUsageMode }>
  gadgets: Gadget[]             // この期間の処理後に在席しているガジェット
  connections: MapConnection[]  // 在席ガジェット間で有効な接続
  /**
   * 演出用：在席ガジェット＋この日に撤去されるガジェット。
   * 撤去演出のあいだも画面に居るので、当日のレイアウト計算に含める
   * （前日の座標を借りて位置補正すると、線がガジェットから浮いたり斜めに歪んだりする）
   */
  renderGadgets: Gadget[]
  /** 演出用：有効な接続＋この日にしまわれる接続（同じレイアウトで一緒にルーティングする） */
  renderConnections: MapConnection[]
  /** 再生専用の最終ページ。IN/OUT の代わりに現在のサマリーを表示する。 */
  isTodayPage?: boolean
  yearlyChanges?: TimelineYearlyChange[]
}

/** 端末のローカル日付を、タイムラインと同じ YYYY-MM-DD で返す。 */
export function localDateKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 今日から years 年前の日付キー（YYYY-MM-DD）。無料プランの歴史アニメーション表示制限に使う。 */
export function yearsAgoDateKey(years: number, from = new Date()): string {
  const d = new Date(from)
  d.setFullYear(d.getFullYear() - years)
  return localDateKey(d)
}

// YYYY-MM-DD / YYYY/MM/DD / ISO 日時 → YYYY-MM-DD に正規化。無効値は null
function normalizeDate(raw?: string): string | null {
  if (!raw) return null
  const s = raw.replace(/\//g, '-').slice(0, 10)
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const y = Number(match[1]), m = Number(match[2]), d = Number(match[3])
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1] ? s : null
}

/**
 * 暦日として扱う日付文字列を得る。`YYYY-MM-DD` はそのまま返し、`createdAt` の
 * ような ISO の瞬時（`new Date().toISOString()` = UTC）は端末のタイムゾーンの
 * 暦日へ直す。先頭10文字を切ると UTC の日付になるため、JST の朝（00:00〜09:00）に
 * 登録したガジェットが年表に前日として並ぶ。
 */
export function calendarDateOf(raw?: string): string | null {
  if (!raw) return null
  if (!raw.includes('T')) return normalizeDate(raw)
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : localDateKey(parsed)
}

/**
 * ガジェットの在席期間。デスク別の利用期間があればそれを、無ければ
 * 購入日〜撤去日（購入日が無いときは登録日）を1期間として返す。
 * 年表（gadgetChronicle）も歴史アニメーションと同じ在席判定を使う。
 */
export function usagePeriodsOf(g: Gadget): DeskGadgetUsagePeriod[] {
  if (g.deskUsagePeriods !== undefined) {
    return g.deskUsagePeriods
      .flatMap((period): DeskGadgetUsagePeriod[] => {
        const startedAt = normalizeDate(period.startedAt)
        if (!startedAt) return []
        return [{ ...period, startedAt, endedAt: normalizeDate(period.endedAt) ?? undefined }]
      })
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }
  const purchasedAt = normalizeDate(g.purchasedAt)
  const startedAt = purchasedAt
    ?? (g.introducedAtUnknown || g.isCandidate ? null : calendarDateOf(g.createdAt))
  if (!startedAt) return []
  const endedAt = normalizeDate(g.removedAt) ?? undefined
  return [{
    mode: g.displayOnly ? 'decor' : 'active',
    startedAt,
    endedAt,
    ...(purchasedAt ? {} : { startedAtSource: 'registered' as const }),
  }]
}

/**
 * そのガジェットがデスクに初めて入った日。
 * 無料プランの表示制限やまとめ単位に関係なく実日付を返すので、
 * 「最長のつきあい」のように在籍の長さそのものを見せる用途に使う。
 */
export function firstUsageDate(g: Gadget): string | null {
  return usagePeriodsOf(g)[0]?.startedAt ?? null
}

function gadgetAt(g: Gadget, date: string): Gadget | null {
  const period = [...usagePeriodsOf(g)].reverse().find((item) =>
    item.startedAt <= date && (!item.endedAt || item.endedAt > date),
  )
  return period ? { ...g, displayOnly: period.mode === 'decor' } : null
}

/** 両端とケーブル種別から決まる、日をまたいで一致する接続ID */
const stableConnId = (from: string, to: string, cable: string) =>
  `hist-${[from, to].sort().join('~')}|${cable}`

function connectionsFor(gadgets: Gadget[], plan: DeskPlan, lang: 'ja' | 'en'): MapConnection[] {
  // 2in1 ケーブルの宣言は現在の配線図にしかない。当時の構成にも同じ組み合わせの線が
  // あれば、その日も1本のケーブルで繋いでいたとみなして引き当てる（履歴でも枝が束ねられる）。
  const branchByPair = new Map<string, string>()
  for (const saved of plan.connectionMap?.connections ?? []) {
    if (!saved.branchGroupId) continue
    branchByPair.set(stableConnId(saved.fromGadgetId, saved.toGadgetId, saved.cableType), saved.branchGroupId)
  }
  return gadgets.length > 0
    ? buildAutoDraft(gadgets, { ...plan, selectedGadgetIds: gadgets.map((g) => g.id) }, lang)
        .map((c) => {
          const id = stableConnId(c.fromGadgetId, c.toGadgetId, c.cableType)
          return { ...c, id, branchGroupId: branchByPair.get(id) }
        })
    : []
}

type UsageChange = TimelineUsageChange

/**
 * 利用期間から、導入・撤去・使い方の切り替えを取り出す。前の期間からそのまま続く開始・終了は動きではない。
 * until より後の日付は捨てる。月・年でまとめるとき、同じ期間に予定の撤去（未来日）が1件あると
 * 期間の代表日が未来になり、その期間に実際に起きた導入・撤去まで再生から消えていた
 */
function usageChangesOf(allGadgets: Gadget[], until?: string): UsageChange[] {
  const changes: UsageChange[] = []
  for (const g of allGadgets) {
    const periods = usagePeriodsOf(g)
    periods.forEach((period, index) => {
      const previous = periods[index - 1]
      const next = periods[index + 1]
      const gadget = { ...g, displayOnly: period.mode === 'decor' }
      const keep = (date: string) => until === undefined || date <= until
      if (!previous || previous.endedAt !== period.startedAt) {
        if (keep(period.startedAt)) changes.push({ kind: 'in', date: period.startedAt, gadget, mode: period.mode })
      } else if (previous.mode !== period.mode) {
        if (keep(period.startedAt)) changes.push({ kind: 'mode', date: period.startedAt, gadget, mode: period.mode })
      }
      if (period.endedAt && (!next || next.startedAt !== period.endedAt) && keep(period.endedAt)) {
        changes.push({ kind: 'out', date: period.endedAt, gadget, mode: period.mode })
      }
    })
  }
  return changes
}

/**
 * 導入日・撤去日からイベント一覧を生成する。
 * 各イベントには、その時点で在席するガジェットと、それらだけで組み直した接続を含める。
 * @param plan 配線エンジンへ渡す設定（コンセント口数・有線/無線の上書きなど）
 * @param grain まとめる単位。month / year では同じ期間の導入・撤去が1イベントに集まる
 * @param until この日より後の導入・撤去（予定）は入れない。再生は今日までしか見せない
 */
export function buildTimeline(
  allGadgets: Gadget[],
  plan: DeskPlan,
  lang: 'ja' | 'en' = 'ja',
  grain: TimelineGrain = 'month',
  until?: string,
): TimelineEvent[] {
  // 追加・撤去の一覧にはケーブルも載せ、図（在席・配置・配線の作り直し）からだけ外す
  const gadgets = withoutCables(allGadgets)
  // まとめキー → その期間の IN / OUT と、期間内で最後に動きがあった実日付
  const byKey = new Map<string, {
    in: Gadget[]
    out: Gadget[]
    modeChanges: Array<{ gadget: Gadget; mode: DeskGadgetUsageMode }>
    date: string
    firstDate: string
    changes: UsageChange[]
  }>()
  const bucket = (date: string) => {
    const key = grainKeyOf(date, grain)
    const b = byKey.get(key)
    if (!b) {
      const created = {
        in: [] as Gadget[],
        out: [] as Gadget[],
        modeChanges: [] as Array<{ gadget: Gadget; mode: DeskGadgetUsageMode }>,
        date,
        firstDate: date,
        changes: [] as UsageChange[],
      }
      byKey.set(key, created)
      return created
    }
    // 期間の状態は「最後に動きがあった日」で確定させる（月末や年末ではない）。
    // 期間内で導入して撤去したガジェットは、IN/OUT 一覧には出るが在席には残らない。
    if (date > b.date) b.date = date
    if (date < b.firstDate) b.firstDate = date
    return b
  }

  // 一覧の並びに使う、それぞれが起きた実日付。月・年でまとめると1つの期間に別々の日の
  // 導入・撤去が入るが、渡された機材の配列順のまま並べていて、上から日付順になっていなかった
  const inDateOf = new Map<Gadget, string>()
  const outDateOf = new Map<Gadget, string>()
  const modeDateOf = new Map<Gadget, string>()
  for (const change of usageChangesOf(allGadgets, until)) {
    const b = bucket(change.date)
    b.changes.push(change)
    if (change.kind === 'in') {
      b.in.push(change.gadget)
      inDateOf.set(change.gadget, change.date)
    } else if (change.kind === 'mode') {
      b.modeChanges.push({ gadget: change.gadget, mode: change.mode })
      modeDateOf.set(change.gadget, change.date)
    } else {
      b.out.push(change.gadget)
      outDateOf.set(change.gadget, change.date)
    }
  }
  // 同じ日のものは渡された順のまま（sort は安定）
  const byDate = (dateOf: Map<Gadget, string>) => (a: Gadget, b: Gadget) =>
    (dateOf.get(a) ?? '').localeCompare(dateOf.get(b) ?? '')
  for (const b of byKey.values()) {
    b.in.sort(byDate(inDateOf))
    b.out.sort(byDate(outDateOf))
    b.modeChanges.sort((x, y) => byDate(modeDateOf)(x.gadget, y.gadget))
  }

  const keys = [...byKey.keys()].sort()   // YYYY / YYYY-MM / YYYY-MM-DD いずれも辞書順＝時系列順
  let prevPresent: Gadget[] = []
  let prevActive: MapConnection[] = []

  return keys.map((key) => {
    const b = byKey.get(key)!
    const date = b.date

    const present = gadgets.map((g) => gadgetAt(g, date)).filter((g): g is Gadget => g !== null)
    // その日に在席しているガジェットだけで配線を組み直す（当時のデスクを再現する）
    // buildAutoDraft の連番IDは本数が変わるとずれるため、内容から決まる安定IDに振り直す。
    // これがないと、前日から続いている配線まで「新規」と見なされて毎日引き直される。
    const activeConns = connectionsFor(present, plan, lang)

    // 演出用の合算：撤去されるガジェットと「しまう線」も当日のレイアウトに含めて
    // 同じルーターで配置する（線がガジェットから浮かない・斜めに歪まない）
    const presentIds = new Set(present.map((g) => g.id))
    const activeIds = new Set(activeConns.map((c) => c.id))
    const leavingGadgets = prevPresent.filter((g) => !presentIds.has(g.id))
    const leavingConns = prevActive.filter((c) => !activeIds.has(c.id))

    // 同じ集約期間内で導入・撤去されたガジェットは、期間末の在席状態にも前イベントにも
    // 存在しない。そのままだとIN/OUT一覧にだけ現れ、図には一度も描画されないため、
    // このイベント限りの演出用状態へ含める。
    const outIds = new Set(b.out.map((g) => g.id))
    const transientCandidates = b.in.filter((g) => outIds.has(g.id) && !presentIds.has(g.id) && g.category !== 'Cable')
    const yearlyChanges: TimelineYearlyChange[] = []
    if (grain === 'year') {
      for (const categoryKey of new Set(transientCandidates.map(gadgetCategoryKey))) {
        const changes = b.changes.filter((change) => gadgetCategoryKey(change.gadget) === categoryKey)
          .sort((a, b) => a.date.localeCompare(b.date) ||
            ['out', 'mode', 'in'].indexOf(a.kind) - ['out', 'mode', 'in'].indexOf(b.kind))
        const changeCount = new Set(changes.map((change) => change.date)).size
        if (changeCount < 2 || new Set(changes.map((change) => change.gadget.id)).size < 2) continue
        yearlyChanges.push({
          categoryKey, changeCount, changes,
          initialGadgets: prevPresent.filter((g) => gadgetCategoryKey(g) === categoryKey),
          finalGadgets: present.filter((g) => gadgetCategoryKey(g) === categoryKey),
        })
      }
    }
    const summarizedCategories = new Set(yearlyChanges.map((group) => group.categoryKey))
    // 年表示では途中の機材を詳細へ畳む。元のIN/OUTは集計と日・月表示のために保持する。
    const transientGadgets = transientCandidates.filter((g) => !summarizedCategories.has(gadgetCategoryKey(g)))
    const transientIds = new Set(transientGadgets.map((g) => g.id))
    const transientState = transientGadgets.length > 0
      ? connectionsFor([...present, ...transientGadgets], plan, lang)
      : []
    const transientConns = transientState.filter((c) =>
      (transientIds.has(c.fromGadgetId) || transientIds.has(c.toGadgetId)) &&
      !activeIds.has(c.id),
    )

    prevPresent = present
    prevActive = activeConns

    return {
      date,
      firstDate: b.firstDate,
      inGadgets: b.in,
      outGadgets: b.out,
      modeChanges: b.modeChanges,
      gadgets: present,
      connections: activeConns,
      renderGadgets: [...present, ...leavingGadgets, ...transientGadgets],
      renderConnections: [...activeConns, ...leavingConns, ...transientConns],
      ...(yearlyChanges.length > 0 ? { yearlyChanges } : {}),
    }
  })
}

/**
 * 変更イベントの末尾へ、現在のデスクを俯瞰する「今日」ページを付加する。
 * @param fallbackBase 見せられる変更が1件も無いときに「今日」ページの土台にするイベント。
 *   無料プランの表示期間より前にしか変更が無いデスクはここが空になり、渡さないと
 *   ページ0枚の再生（読み込みが100%まで進んだあと何も起きない）になる。
 */
export function appendTodayPage(
  events: TimelineEvent[],
  today = localDateKey(),
  fallbackBase?: TimelineEvent,
): TimelineEvent[] {
  const elapsedEvents = events.filter((event) => event.date <= today)
  const last = elapsedEvents[elapsedEvents.length - 1] ?? fallbackBase
  if (!last) return elapsedEvents

  // 今日が最後の変更イベントと同じ日でも、IN/OUTページとまとめページは必ず別ページにする。
  // 1ページにまとめると、その日に導入・撤去した内容が画面から消えてしまう。
  // 構成・配線は最後の変更イベントのものをそのまま使う（配線エンジンで組み直さない）。
  // 組み直すと入力の微差で配線が変わりうるため、最終ページで図が引き直されて見える。
  // renderGadgets/renderConnections は撤去演出ぶんを引き継がず、在席分だけにする。
  return [
    ...elapsedEvents,
    {
      date: today,
      firstDate: today,
      inGadgets: [],
      outGadgets: [],
      modeChanges: [],
      gadgets: last.gadgets,
      connections: last.connections,
      renderGadgets: last.gadgets,
      renderConnections: last.connections,
      isTodayPage: true,
    },
  ]
}

/**
 * その日の配置を、当日手動上書き → 過去最新スナップショット → 現在配置の順で解決する。
 * 現在配置は、過去を推測できる「最後の構成変更日以降」にだけフォールバックする。
 * ただし今の手動サイズ（nodeSizes）は日付によらず全期間に当てる。歴史の配置エディタは大きさを
 * 全期間に反映する約束で nodeSizes に書くが、最後の変更日より前の日にしか当てていなかった頃は、
 * 縮めても過去の日の自動の大きさで全期間が揃えられ、再生では元の大きさのままだった。
 */
export function resolveTimelineLayout(plan: DeskPlan, date: string, lastChangeDate?: string) {
  const cm = plan.connectionMap
  const snapshotDate = Object.keys(cm?.layoutSnapshots ?? {})
    .filter((key) => key <= date)
    .sort()
    .at(-1)
  const snapshot = snapshotDate ? cm?.layoutSnapshots?.[snapshotDate] : undefined
  const useCurrent = !snapshot && !!lastChangeDate && date >= lastChangeDate
  const baseOffsets = snapshot?.nodeOffsets ?? (useCurrent ? cm?.nodeOffsets ?? {} : {})
  const baseSizes = snapshot?.nodeSizes ?? {}
  const manual = cm?.historyLayout?.[date]
  return {
    nodeOffsets: { ...baseOffsets, ...(manual?.nodeOffsets ?? {}) },
    nodeSizes: { ...baseSizes, ...(manual?.nodeSizes ?? {}), ...(cm?.nodeSizes ?? {}) },
  }
}

export interface PlaybackTimelineSummary {
  /** 再生するページ数（「今日」ページ込み）。0 なら再生できる記録が無い */
  pageCount: number
  /** 見せられる変更のうち最初の実日付。期間の制限より前にしか変更が無ければ null（「今日」だけの再生） */
  firstChangeDate: string | null
}

/**
 * 再生のページ数と始まりを、配線を組まずに軽量に求める（履歴カードの「◯年◯月 〜 現在 ・ N イベント」）。
 * まとめる単位・未来日の扱い・期間の制限・「今日」ページの付け方を再生（computeDeskHistory）と揃える。
 * 日ごとに数えていた頃は、月ごとに再生するデスクでカードの件数と開いたときのページ数が食い違った
 * @param cutoff 無料プランの表示制限の日付キー。再生と同じく期間の最初の動きで判定する
 */
export function playbackTimelineSummary(
  gadgets: Gadget[],
  grain: TimelineGrain,
  cutoff: string | null,
  today = localDateKey(),
): PlaybackTimelineSummary {
  const firstByKey = new Map<string, string>()
  for (const change of usageChangesOf(gadgets, today)) {
    const key = grainKeyOf(change.date, grain)
    const first = firstByKey.get(key)
    if (!first || change.date < first) firstByKey.set(key, change.date)
  }
  if (firstByKey.size === 0) return { pageCount: 0, firstChangeDate: null }
  const visible = [...firstByKey.values()].filter((date) => !cutoff || date >= cutoff).sort()
  return { pageCount: visible.length + 1, firstChangeDate: visible[0] ?? null }
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * 配線図の左上に2行で表示する日付。まとめる単位に合わせて粒度を落とす。
 *   day   → 2027 / 1 Dec
 *   month → 2027 / Dec
 *   year  → 2027（2行目なし）
 */
export function formatEventDateParts(
  date: string,
  grain: TimelineGrain = 'month',
): { year: string; dayMonth: string | null } {
  const [y, m, d] = date.split('-').map(Number)
  if (grain === 'year') return { year: String(y), dayMonth: null }
  const month = String(MONTHS_EN[m - 1] ?? m)
  return { year: String(y), dayMonth: grain === 'month' ? month : `${d} ${month}` }
}
