import { DeskGadgetUsagePeriod, Gadget } from '../types'
import { usagePeriodsOf } from './deskTimeline'

// ─── デスク年表（在籍期間を時代の帯で並べる横の年表）──────────────────
// 「いつ買ったか」ではなく「いつからいつまで一緒にいたか」を横の帯で見せる。
// 統計の折れ線が“増えた量”を示すのに対し、こちらは退役したガジェットも
// 同じ画面に残す。撤去済みが消えないことがこの表の存在理由。

const MS_PER_DAY = 86_400_000

/**
 * 在籍期間。歴史アニメーションと違い、登録日(createdAt)は導入日の代わりにしない。
 * 5年使っているモニターが「登録した2ヶ月前から」のバーになると、年表が
 * 一番示したい「どれだけ一緒にいたか」を取り違えるため。
 * デスク別の利用期間はユーザーが明示したものなのでそのまま使う。
 * 代用は購入日の有無ではなく期間の印で見分ける。デスク詳細から来る機材は applyDeskGadgetUsage が
 * 登録日で代用した期間を埋めて渡すので、購入日の有無で見ていた頃は代用がそのまま帯になっていた
 */
function chroniclePeriodsOf(gadget: Gadget): DeskGadgetUsagePeriod[] {
  return usagePeriodsOf(gadget).filter((period) => period.startedAtSource !== 'registered')
}

/** YYYY-MM-DD → ローカル時刻の ms。deskTimeline が正規化済みの文字列だけを渡す前提 */
function keyToTime(key: string): number {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))).getTime()
}

export interface ChronicleSpan {
  startMs: number
  endMs: number
  /** 今も在籍中（撤去日が無い） */
  ongoing: boolean
  /** 表示窓の左端で切られた＝それ以前から続いている */
  clippedStart: boolean
}

export interface ChronicleRow {
  gadget: Gadget
  /** 表示窓に重なる期間だけ。窓の外は切り落とす */
  spans: ChronicleSpan[]
  /** 窓で切る前の実際の導入日。並び順と「◯年前から」の表示に使う */
  firstStartMs: number
  /** 窓で切る前の在籍日数の合計（複数期間は足す） */
  totalDays: number
  ongoing: boolean
}

export interface Chronicle {
  rows: ChronicleRow[]
  windowStartMs: number
  windowEndMs: number
  /** 在籍中の台数 / 退役した台数（どちらも窓の外を含む全期間） */
  activeCount: number
  retiredCount: number
  /** 表示窓より前に退役していて、行として出せなかった台数 */
  hiddenCount: number
  /** 全期間の最古の導入日。窓の外にあるときだけ「Proで全期間」を出す */
  earliestMs: number | null
  /** 購入日が無く、年表に載せられなかった台数 */
  undatedCount: number
}

export interface BuildChronicleOptions {
  /** 表示する年数。-1 = 全期間（Pro） */
  windowYears: number
  now?: Date
}

export function buildChronicle(gadgets: readonly Gadget[], { windowYears, now = new Date() }: BuildChronicleOptions): Chronicle {
  const nowMs = now.getTime()

  interface Raw { gadget: Gadget; spans: ChronicleSpan[]; firstStartMs: number; totalDays: number; ongoing: boolean }
  const raws: Raw[] = []
  let undatedCount = 0

  // 同じガジェットが複数回渡ってきても1行にまとめる（デスク横断の統計で重複しうる）
  const unique = [...new Map(gadgets.map((gadget) => [gadget.id, gadget])).values()]

  for (const gadget of unique) {
    const periods = chroniclePeriodsOf(gadget)
    const spans: ChronicleSpan[] = []
    for (const period of periods) {
      const startMs = keyToTime(period.startedAt)
      // 未来日は年表に載せない（入力ミスで軸が右に伸びると全体が潰れる）
      if (startMs > nowMs) continue
      const rawEnd = period.endedAt ? keyToTime(period.endedAt) : null
      const endMs = Math.min(rawEnd ?? nowMs, nowMs)
      spans.push({ startMs, endMs: Math.max(endMs, startMs), ongoing: rawEnd == null || rawEnd > nowMs, clippedStart: false })
    }
    if (spans.length === 0) {
      undatedCount += 1
      continue
    }
    raws.push({
      gadget,
      spans,
      firstStartMs: Math.min(...spans.map((s) => s.startMs)),
      totalDays: spans.reduce((sum, s) => sum + (s.endMs - s.startMs) / MS_PER_DAY, 0),
      ongoing: spans.some((s) => s.ongoing),
    })
  }

  const earliestMs = raws.length > 0 ? Math.min(...raws.map((r) => r.firstStartMs)) : null

  if (earliestMs == null) {
    return {
      rows: [], windowStartMs: nowMs, windowEndMs: nowMs,
      activeCount: 0, retiredCount: 0, hiddenCount: 0, earliestMs: null, undatedCount,
    }
  }

  const limitMs = windowYears < 0
    ? earliestMs
    : new Date(now.getFullYear() - windowYears, now.getMonth(), now.getDate()).getTime()
  const windowStartMs = Math.max(earliestMs, limitMs)
  // 全員が同日（登録直後）だと幅0になり除算できないので、最低1日ぶんの幅を持たせる
  const windowEndMs = Math.max(nowMs, windowStartMs + MS_PER_DAY)

  const rows: ChronicleRow[] = []
  let hiddenCount = 0
  for (const raw of raws) {
    const visible = raw.spans
      .filter((span) => span.endMs >= windowStartMs)
      .map((span) => ({
        ...span,
        startMs: Math.max(span.startMs, windowStartMs),
        clippedStart: span.startMs < windowStartMs,
      }))
    if (visible.length === 0) {
      hiddenCount += 1
      continue
    }
    rows.push({ gadget: raw.gadget, spans: visible, firstStartMs: raw.firstStartMs, totalDays: raw.totalDays, ongoing: raw.ongoing })
  }
  // 古い順。年表は「最初からいる相棒」を上に置くほど積み重ねが見える
  rows.sort((a, b) => a.firstStartMs - b.firstStartMs || a.gadget.name.localeCompare(b.gadget.name))

  return {
    rows,
    windowStartMs,
    windowEndMs,
    activeCount: raws.filter((r) => r.ongoing).length,
    retiredCount: raws.filter((r) => !r.ongoing).length,
    hiddenCount,
    earliestMs,
    undatedCount,
  }
}

// ─── 横に流す年表の配置 ───────────────────────────────────────────
// 以前はカード幅に全期間を押し込み、左に名前列・右に期間列を固定していた。期間が長いほど
// 帯が細くなり、名前列が横幅の1/3を取っていた。1年を一定の幅にして横へ流し、名前は帯に書く。

/** 1年ぶんの幅。iPhone のカード内で2年弱が一度に見える */
export const CHRONICLE_PX_PER_YEAR = 180
/** 同じ段で隣り合う帯（名前を含む）の間隔 */
export const CHRONICLE_BAND_GAP = 6
/** 月の目盛りの間隔の下限。これより詰まる刻みは使わない */
const MIN_MONTH_TICK_PX = 56
const MONTH_TICK_STEPS = [1, 3, 6]
/** 窓の左端の年ラベルと、最初の1月1日の年ラベルが重なる距離 */
const START_LABEL_ROOM = 40

export interface ChronicleBandSpan {
  x: number
  width: number
  ongoing: boolean
  clippedStart: boolean
}

export interface ChronicleBand {
  row: ChronicleRow
  lane: number
  /** 名前を含めて段を占める範囲。重ならないように同じ段へ詰める */
  left: number
  right: number
  /** 名前の左端。今の線より右へはみ出す帯は、帯の右端に揃えて左へ寄せる */
  labelX: number
  labelWidth: number
  /** 帯そのもの（在籍期間）の左端と右端 */
  barLeft: number
  barRight: number
  spans: ChronicleBandSpan[]
}

export interface ChronicleTick {
  x: number
  date: Date
  grain: 'year' | 'month'
}

export interface ChronicleStrip {
  /** 時間軸の幅。右端が今 */
  timelineWidth: number
  /** 名前のはみ出しを含めた中身の幅 */
  contentWidth: number
  laneCount: number
  bands: ChronicleBand[]
  ticks: ChronicleTick[]
}

/**
 * 帯を段へ詰め、目盛りを置く。
 * minWidth は見えている幅。窓が短く1年あたりの幅では足りないときは、見えている幅まで伸ばす。
 * labelWidthOf は名前の幅（アイコンと余白を含む）。文字の実寸は描くまで測れないので見積もりを渡す
 */
export function layoutChronicleStrip(
  chronicle: Pick<Chronicle, 'rows' | 'windowStartMs' | 'windowEndMs'>,
  { minWidth, labelWidthOf }: { minWidth: number; labelWidthOf: (row: ChronicleRow) => number },
): ChronicleStrip {
  const { rows, windowStartMs, windowEndMs } = chronicle
  const spanMs = Math.max(1, windowEndMs - windowStartMs)
  const natural = (spanMs / (365.25 * MS_PER_DAY)) * CHRONICLE_PX_PER_YEAR
  const timelineWidth = Math.max(minWidth, natural)
  const xOf = (ms: number) => ((ms - windowStartMs) / spanMs) * timelineWidth

  // 古い順（buildChronicle の並び）に、空いている一番上の段へ置く。長く在籍している機材ほど上に残る
  const laneRights: number[] = []
  let contentWidth = timelineWidth
  const bands: ChronicleBand[] = rows.map((row) => {
    const spans = row.spans.map((span) => {
      const x = xOf(span.startMs)
      return { x, width: Math.max(4, xOf(span.endMs) - x), ongoing: span.ongoing, clippedStart: span.clippedStart }
    })
    const barLeft = spans[0].x
    const barRight = Math.max(...spans.map((span) => span.x + span.width))
    const labelWidth = labelWidthOf(row)
    const labelX = barLeft + labelWidth <= timelineWidth ? barLeft : Math.max(0, Math.min(barLeft, barRight - labelWidth))
    const left = Math.min(barLeft, labelX)
    const right = Math.max(barRight, labelX + labelWidth)
    let lane = laneRights.findIndex((laneRight) => laneRight + CHRONICLE_BAND_GAP <= left)
    if (lane < 0) {
      lane = laneRights.length
      laneRights.push(right)
    } else {
      laneRights[lane] = right
    }
    contentWidth = Math.max(contentWidth, right)
    return { row, lane, left, right, labelX, labelWidth, barLeft, barRight, spans }
  })

  return { timelineWidth, contentWidth, laneCount: laneRights.length, bands, ticks: buildTicks(windowStartMs, windowEndMs, xOf, timelineWidth / (spanMs / MS_PER_DAY)) }
}

function buildTicks(startMs: number, endMs: number, xOf: (ms: number) => number, pxPerDay: number): ChronicleTick[] {
  const ticks: ChronicleTick[] = []
  const start = new Date(startMs)
  const monthPx = pxPerDay * 30.4375
  const step = MONTH_TICK_STEPS.find((candidate) => candidate * monthPx >= MIN_MONTH_TICK_PX)

  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  if (cursor.getTime() < startMs) cursor.setMonth(cursor.getMonth() + 1)
  while (cursor.getTime() <= endMs) {
    const month = cursor.getMonth()
    if (month === 0) ticks.push({ x: xOf(cursor.getTime()), date: new Date(cursor), grain: 'year' })
    else if (step != null && month % step === 0) ticks.push({ x: xOf(cursor.getTime()), date: new Date(cursor), grain: 'month' })
    cursor.setMonth(month + 1)
  }
  // 窓が1月1日をまたがないと、どの年の月なのかが画面のどこにも出ない
  const firstYear = ticks.find((tick) => tick.grain === 'year')
  if (!firstYear || firstYear.x > START_LABEL_ROOM) {
    ticks.unshift({ x: 0, date: start, grain: 'year' })
    // 左端の年ラベルと重なる月ラベルは外す
    return ticks.filter((tick, index) => index === 0 || tick.grain === 'year' || tick.x > START_LABEL_ROOM)
  }
  return ticks
}

/**
 * 1行の文字の幅の見積もり。全角は字の大きさ、半角はその6割で数える。
 * 実寸より短く見積もっても、描く側で numberOfLines と幅を固定して省略するので隣の帯へは重ならない
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let width = 0
  for (const char of text) {
    width += (char.codePointAt(0) ?? 0) >= 0x2e80 ? fontSize : fontSize * 0.6
  }
  return width
}

/** 在籍日数を「3年2ヶ月」「8ヶ月」「12日」の粒度で表す */
export function formatChronicleDuration(days: number, lang: 'ja' | 'en'): string {
  const ja = lang === 'ja'
  const whole = Math.max(0, Math.floor(days))
  // 平均月長で年を割ると 365日が「11ヶ月」になるので、年は 365 日で先に切り出す
  const years = Math.floor(whole / 365)
  const rest = Math.floor((whole - years * 365) / 30.4375)
  if (years === 0) {
    if (rest < 1) return ja ? `${Math.max(1, whole)}日` : `${Math.max(1, whole)}d`
    return ja ? `${rest}ヶ月` : `${rest}mo`
  }
  if (ja) return rest ? `${years}年${rest}ヶ月` : `${years}年`
  return rest ? `${years}y ${rest}m` : `${years}y`
}
