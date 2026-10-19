import type { DeskGadgetUsage, DeskGadgetUsagePeriod, DeskPlan, Gadget, GadgetFolder } from '../types'

// ─── 端末に保存した一覧を、壊れた1件ごと読めなくしないための修復 ──────────────
//
// 保存データは旧バージョン・書き込み途中の終了・バックアップ復元など、どこからでも崩れうる。
// 1件でも形が崩れていると、描画側が素で触るフィールド（ports.map / selectedGadgetIds.includes /
// updatedAt.localeCompare など）で例外が出て、その種類のデータを使う全画面が落ちる。
// さらに書き込み（読んで→直して→書く）も同じ所で落ちるので、以後1件も保存できなくなる。
//
// ここでは「使えない1件（オブジェクトでない・ID が無い）は外し、欠けた配列・文字列は空で補う」
// だけを行う。中身の意味（移行・正規化）は各 store の担当で、ここでは扱わない。

type Loose = Record<string, unknown>

function isRecord(value: unknown): value is Loose {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasId(value: unknown): value is Loose & { id: string } {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** 配列でなければ空、要素はオブジェクトだけ残す。null の1件で `item.field` を読む側が落ちないようにする */
export function objectArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(isRecord) as T[]) : []
}

/** ID が重複していたら先頭を残す。同じ ID が2件あると、編集・削除がどちらに効くか決まらない */
function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}

export function repairStoredGadgets(items: readonly unknown[]): Gadget[] {
  return uniqueById(items.filter(hasId).map((raw) => {
    const gadget = raw as unknown as Gadget
    // createdAt は一覧の並べ替え（localeCompare）で素で使う。欠けた1台があると読み込みそのものが
    // 例外で失敗扱いになり、全ガジェットが出ず保存も止まる
    const needsRepair = !isCleanObjectArray(raw.ports) || typeof raw.name !== 'string' || typeof raw.category !== 'string'
      || typeof raw.createdAt !== 'string'
    if (!needsRepair) return gadget
    return {
      ...gadget,
      name: typeof raw.name === 'string' ? raw.name : '',
      category: (typeof raw.category === 'string' ? raw.category : 'Other') as Gadget['category'],
      ports: objectArray(raw.ports),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    }
  }))
}

function isCleanStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isCleanObjectArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isRecord)
}

/** 利用期間がそのまま読める形か。毎回作り直さないよう、崩れているときだけ repairGadgetUsage を通す */
function isCleanGadgetUsage(value: unknown): boolean {
  if (!isRecord(value)) return false
  return Object.values(value).every((usage) => isRecord(usage)
    && (usage.periods === undefined || (Array.isArray(usage.periods)
      && usage.periods.every((period) => isRecord(period) && typeof period.startedAt === 'string'))))
}

export function repairStoredPlans(items: readonly unknown[]): DeskPlan[] {
  return uniqueById(items.filter(hasId).map((raw) => {
    const plan = raw as unknown as DeskPlan
    // 配線と利用期間は、配線図・歴史・年表が要素の項目（c.fromGadgetId / period.startedAt）を素で読む。
    // 配列でない・null の1件が混ざっていると、そのデスクを開いた時点で落ちる
    const map = isRecord(raw.connectionMap) ? raw.connectionMap : null
    const wiring = isRecord(raw.wiringResult) ? raw.wiringResult : null
    const brokenMap = raw.connectionMap !== undefined && (!map || !isCleanObjectArray(map.connections)
      || (map.dismissedPairs !== undefined && !isCleanStringArray(map.dismissedPairs)))
    const brokenWiring = raw.wiringResult !== undefined && (!wiring || !isCleanObjectArray(wiring.connections)
      || !isCleanObjectArray(wiring.requiredCables) || !isCleanStringArray(wiring.warnings))
    const brokenUsage = raw.gadgetUsage !== undefined && !isCleanGadgetUsage(raw.gadgetUsage)
    // createdAt / updatedAt はデスク一覧の並べ替え（localeCompare）で素で使い、欠けると一覧ごと落ちる
    const needsRepair = !isCleanStringArray(raw.selectedGadgetIds) || !isCleanObjectArray(raw.placements)
      || typeof raw.name !== 'string'
      || typeof raw.createdAt !== 'string' || typeof raw.updatedAt !== 'string'
      || (raw.purposes !== undefined && !isCleanStringArray(raw.purposes))
      || (raw.images !== undefined && !isCleanStringArray(raw.images))
      || brokenMap || brokenWiring || brokenUsage
    if (!needsRepair) return plan
    const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : ''
    return {
      ...plan,
      ...(brokenMap
        ? { connectionMap: map ? {
            ...(map as unknown as NonNullable<DeskPlan['connectionMap']>),
            connections: objectArray(map.connections),
            ...(map.dismissedPairs !== undefined ? { dismissedPairs: stringArray(map.dismissedPairs) } : {}),
          } : undefined }
        : {}),
      ...(brokenWiring
        ? {
            wiringResult: wiring
              ? {
                  ...(wiring as unknown as NonNullable<DeskPlan['wiringResult']>),
                  connections: objectArray(wiring.connections),
                  requiredCables: objectArray(wiring.requiredCables),
                  warnings: stringArray(wiring.warnings),
                }
              : undefined,
          }
        : {}),
      ...(brokenUsage ? { gadgetUsage: repairGadgetUsage(raw.gadgetUsage) } : {}),
      name: typeof raw.name === 'string' ? raw.name : '',
      createdAt,
      // 最後に触った時刻が無ければ作った時刻で並べる（どちらも無ければ末尾）
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt,
      selectedGadgetIds: stringArray(raw.selectedGadgetIds),
      placements: objectArray(raw.placements),
      purposes: raw.purposes === undefined ? undefined : stringArray(raw.purposes) as DeskPlan['purposes'],
      images: raw.images === undefined ? undefined : stringArray(raw.images),
    }
  }))
}

export function repairStoredFolders(items: readonly unknown[]): GadgetFolder[] {
  return uniqueById(items.filter(hasId).map((raw) => ({
    ...(raw as unknown as GadgetFolder),
    name: typeof raw.name === 'string' ? raw.name : '',
  })))
}

/** AI相談の履歴。並べ替えに updatedAt、表示に messages を素で使う */
export function repairStoredConversations<T extends { id: string; updatedAt: string; messages: unknown[] }>(
  items: readonly unknown[],
): T[] {
  return uniqueById(items.filter(hasId).map((raw) => ({
    ...(raw as unknown as T),
    title: typeof raw.title === 'string' ? raw.title : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    // 本文は一覧のプレビューで文字列として加工する。文字列でない発言は表示できないので外す
    messages: objectArray<Loose>(raw.messages).filter((message) => typeof message.content === 'string'),
  })))
}

/**
 * デスクでの利用期間（gadgetUsage）。期間は並べ替え（startedAt.localeCompare）と
 * 今日の状態の判定で素で使うので、開始日の無い期間・配列でない periods は落とす
 */
export function repairGadgetUsage(value: unknown): Record<string, DeskGadgetUsage> | undefined {
  if (!isRecord(value)) return undefined
  const repaired: Record<string, DeskGadgetUsage> = {}
  for (const [gadgetId, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue
    const usage: DeskGadgetUsage = {}
    if (typeof raw.introducedAt === 'string') usage.introducedAt = raw.introducedAt
    if (typeof raw.removedAt === 'string') usage.removedAt = raw.removedAt
    if (raw.periods !== undefined) {
      usage.periods = objectArray<Loose>(raw.periods)
        .filter((period) => typeof period.startedAt === 'string' && (period.mode === 'active' || period.mode === 'decor'))
        .map((period) => ({
          ...(period as unknown as DeskGadgetUsagePeriod),
          endedAt: typeof period.endedAt === 'string' ? period.endedAt : undefined,
        }))
    }
    repaired[gadgetId] = usage
  }
  return repaired
}
