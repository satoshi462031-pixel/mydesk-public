import { CableType, DeskPlan, PlanPurpose, Port, PortType } from '../types'
import { determineCableType, MAX_CABLE_COUNT } from '../constants/portTypes'

// ─── 旧 PortType の正規化（読み込み時に適用）───────────────────────────
// Thunderbolt は世代（3 / 4 / 5）で配線の可否が実質変わらないため 'Thunderbolt' 1本に統合した。
// マグネット給電（Apple Pencil の吸着給電）もケーブルの要らない非接触給電で
// ワイヤレス充電と扱いが変わらないため 'wirelessCharging' に寄せた。
// 保存済みデータには旧 type が残るので、書き戻さずに読み込み時だけ寄せる
// （保存データを壊さないので、問題が出ても巻き戻せる）。

const LEGACY_TYPES: Record<string, PortType> = {
  Thunderbolt3: 'Thunderbolt',
  Thunderbolt4: 'Thunderbolt',
  MagneticCharging: 'wirelessCharging',
}

// 統合で同じ type が並びうるもの。direction ごとに1つへ畳む対象
const MERGE_TARGETS: PortType[] = ['Thunderbolt', 'wirelessCharging']

/**
 * 廃止した PortType。寄せ先が無いものは読み込み時に取り除く。
 * 残したままだと PORT_LABELS に無い型としてラベルが undefined になる。
 * Trackball はフォーム・プリセット・自動生成のどこからも作られたことがなく、
 * トラックボールは Mouse カテゴリで表現するため型としては不要だった。
 */
const REMOVED_TYPES = new Set<string>(['Trackball'])

export function normalizePortType(type: PortType): PortType {
  return LEGACY_TYPES[type as string] ?? type
}

export function normalizeCableType(type: CableType, from?: PortType, to?: PortType): CableType {
  if (from && to) return determineCableType(normalizePortType(from), normalizePortType(to))
  return LEGACY_TYPES[type as string] ?? type
}

/**
 * ポート配列を正規化する。
 * TB3 と TB4 を両方持っていたガジェットは統合後に同じ type が2つ並ぶため、
 * 統合対象に限って direction ごとに1つへまとめる（本数は合算）。
 * まとめないと initPortState が先頭の1件しか拾わず、編集画面で本数が減って見える。
 */
/**
 * 1台の中で口の ID が重ならないようにする。重なった口は、keep が真の口を元の ID のまま残し、
 * それ以外を空いている `p{n}` へ振り直す。
 *
 * 編集画面の保存は、フォームが作る口を毎回 p1… で振り直す一方、フォームで表せない口を元の ID の
 * まま引き継ぐので、2つの採番がぶつかっていた（プリセット 679件中 42件）。口の ID は音声出力の
 * 残数や給電の挿し口の識別子に使っており、重なると2つの口が1つとして数えられる
 */
export function withUniquePortIds(ports: Port[], keep: (port: Port) => boolean = () => false): Port[] {
  const counts = new Map<string, number>()
  for (const port of ports) counts.set(port.id, (counts.get(port.id) ?? 0) + 1)
  if (![...counts.values()].some((n) => n > 1)) return ports
  const used = new Set<string>()
  const kept = new Set<Port>()
  for (const port of ports) {
    if (keep(port) && !used.has(port.id)) { used.add(port.id); kept.add(port) }
  }
  let next = 1
  return ports.map((port) => {
    if (kept.has(port)) return port
    if (!used.has(port.id)) { used.add(port.id); return port }
    while (used.has(`p${next}`)) next++
    const id = `p${next}`
    used.add(id)
    return { ...port, id }
  })
}

export function normalizePorts(ports: Port[]): Port[] {
  // 以前の保存で重なった ID が残っているデータを、読み込むたびに直す（書き戻さない）
  ports = withUniquePortIds(ports)
  let changed = false
  if (ports.some((port) => REMOVED_TYPES.has(port.type as string))) {
    ports = ports.filter((port) => !REMOVED_TYPES.has(port.type as string))
    changed = true
  }
  const normalized = ports.map((port) => {
    if (port.type === 'EthernetPoE') {
      changed = true
      return {
        ...port,
        type: 'Ethernet' as const,
        supportsPoE: true,
        label: port.label ?? (port.direction === 'output' ? 'Ethernet PoE 出力' : 'Ethernet PoE 入力'),
      }
    }
    const type = normalizePortType(port.type)
    if (type === port.type) return port
    changed = true
    return { ...port, type }
  })
  if (!changed) return ports

  const merged: Port[] = []
  const indexByKey = new Map<string, number>()
  for (const port of normalized) {
    if (!MERGE_TARGETS.includes(port.type)) { merged.push(port); continue }
    const key = `${port.type}|${port.direction}`
    const at = indexByKey.get(key)
    if (at === undefined) {
      indexByKey.set(key, merged.length)
      merged.push(port)
      continue
    }
    const kept = merged[at]
    merged[at] = {
      ...kept,
      count: kept.count + port.count,
      supportsVideo: kept.supportsVideo || port.supportsVideo,
      label: kept.label ?? port.label,
    }
  }
  return merged
}

// 廃止した用途。型から消しても、保存済みのデスク・公開済みのスナップショット・
// desks.purposes の列には残り続ける。そのまま描くと名前も色も引けない空のバッジになる
const RETIRED_PURPOSES = new Set<string>(['trading'])

/** デスクの用途から廃止したものを落とす。読み込み時だけで、保存データは書き換えない */
export function normalizePurposes(value: unknown): PlanPurpose[] {
  return Array.isArray(value)
    ? value.filter((p): p is PlanPurpose => typeof p === 'string' && !RETIRED_PURPOSES.has(p))
    : []
}

/**
 * プランに保存された配線結果・配線図の PortType を正規化する。
 * dismissedPairs はキー文字列の末尾に cableType を埋め込んでいるため
 * （`${idA}~${idB}|${cableType}`）、ここも直さないと
 * ユーザーが破棄した自動下書きが復活する。
 */
export function normalizePlan(plan: DeskPlan): DeskPlan {
  // デスクテーマ機能を廃止したため、旧端末・旧共有データに残る値もここで落とす。
  // plan をそのまま spread すると、型から消しても JSON には残り続ける。
  const {
    themes: _legacyThemes,
    otherThemeLabel: _legacyOtherThemeLabel,
    ...themeFreePlan
  } = plan as DeskPlan & { themes?: unknown; otherThemeLabel?: unknown }
  // 用途を選んでいないデスクに空の配列を書き足さないよう、未設定はそのまま通す
  const purposes = plan.purposes === undefined ? undefined : normalizePurposes(plan.purposes)
  const outletCount = plan.outletCountVersion === 2
    ? Math.max(0, plan.outletCount ?? (plan.templateId === 'mobile-work' ? 1 : 2))
    : plan.outletCount === 0
      ? 0
      : plan.templateId === 'mobile-work' ? 1 : 2
  const wiringResult = plan.wiringResult
    ? {
        ...plan.wiringResult,
        connections: plan.wiringResult.connections.map((c) => ({
          ...c,
          fromPortType: normalizePortType(c.fromPortType),
          toPortType: normalizePortType(c.toPortType),
          cableType: normalizeCableType(c.cableType, c.fromPortType, c.toPortType),
        })),
        requiredCables: mergeRequiredCables(plan.wiringResult.requiredCables),
      }
    : plan.wiringResult

  const map = plan.connectionMap
  const connectionMap = map
    ? {
        ...map,
        connections: dedupeMapConnections(
          map.connections.map((c) => ({ ...c, cableType: normalizeCableType(c.cableType) })),
        ),
        ...(map.dismissedPairs
          ? { dismissedPairs: Array.from(new Set(map.dismissedPairs.map(normalizeDismissedPair))) }
          : {}),
      }
    : map

  return { ...themeFreePlan, purposes, outletCount, outletCountVersion: 2, wiringResult, connectionMap }
}

function mergeRequiredCables(cables: { cableType: CableType; count: number }[]) {
  const totals = new Map<CableType, number>()
  for (const cable of cables) {
    const type = normalizeCableType(cable.cableType)
    totals.set(type, (totals.get(type) ?? 0) + cable.count)
  }
  return Array.from(totals.entries()).map(([cableType, count]) => ({ cableType, count }))
}

/**
 * 同じ組み合わせの線は1本に畳み、本数（count）に足す。
 *
 * 畳むのは `pairKey(from, to, cableType)` を前提にした引き継ぎ（reconcileMap・
 * dismissedPairs・2in1 の宣言）が同じキーの線を区別できないため。
 * **以前はここで捨てていた。** ステレオの L/R を手で2本引くと、次にプランを
 * 読んだ時点で片方が申告ごと黙って消えていた。本数として残す。
 */
function dedupeMapConnections<T extends {
  fromGadgetId: string
  toGadgetId: string
  cableType: CableType
  count?: number
}>(connections: T[]): T[] {
  const byKey = new Map<string, T>()
  const order: string[] = []
  for (const c of connections) {
    const key = [c.fromGadgetId, c.toGadgetId].sort().join('~') + '|' + c.cableType
    const kept = byKey.get(key)
    if (!kept) {
      byKey.set(key, c)
      order.push(key)
      continue
    }
    byKey.set(key, { ...kept, count: Math.min(MAX_CABLE_COUNT, (kept.count ?? 1) + (c.count ?? 1)) })
  }
  return order.map((key) => byKey.get(key)!)
}

function normalizeDismissedPair(pair: string): string {
  const at = pair.lastIndexOf('|')
  if (at < 0) return pair
  return pair.slice(0, at + 1) + normalizeCableType(pair.slice(at + 1) as CableType)
}
