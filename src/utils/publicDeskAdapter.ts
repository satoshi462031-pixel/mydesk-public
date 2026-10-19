import { isWirelessPortType } from '../constants/portTypes'
import { DeskWithDetails } from '../supabase/types'
import { CableType, Connection, DeskGadgetUsage, DeskPlan, Gadget, GadgetCategory, GadgetPlacement, MapConnection, Port, RequiredCable } from '../types'
import { POWER_SOURCE_IDS } from './connectionMapLayout'
import { applyDeskGadgetUsage } from './deskGadgetUsage'
import { normalizeCustomCategory } from './customCategory'
import { normalizeCableType, normalizePlan, normalizePorts, normalizePurposes } from './portTypeMigration'
import { generateWiring } from './wiringEngine'
import { objectArray, repairGadgetUsage, repairStoredGadgets } from './storedDataRepair'

// ─── 共有デスク（Supabase）→ アプリ内モデル ───────────────────────────
// 公開デスクの詳細ページを「マイデスク」と同じ構造・同じコンポーネントで
// 描画するため、リモートの行データをローカルの Gadget / DeskPlan に写す。
// 読み取り専用の表示用途のみ（保存はしない）。

interface ShareSnapshot {
  version: number
  plan: DeskPlan
  gadgets: Gadget[]
}

/**
 * share_snapshot は「公開した人の端末が書いた JSON」をそのまま読んでいる。
 * 中身が期待どおりである保証はどこにも無い（API から直接、任意の JSON を
 * 自分のデスクに書ける）。ここで型を確かめずに参照すると、壊れた1件を開いただけで
 * 例外がアプリ全体のエラー境界まで飛び、そのデスクを開いた全員がアプリごと落ちる。
 * 描画側が素で触るフィールドは、この関数を通した時点で安全な形にしておく。
 */
// 配列であることだけでなく要素も確かめる。null の1件が混ざると、配線図の組み立てで
// `c.fromGadgetId` を読んだ時点で落ちる（配列かどうかしか見ていなかった）
function sanitizeSnapshotPlan(plan: DeskPlan): DeskPlan {
  const warnings: unknown[] = Array.isArray(plan.wiringResult?.warnings) ? plan.wiringResult.warnings : []
  return {
    ...plan,
    selectedGadgetIds: (Array.isArray(plan.selectedGadgetIds) ? plan.selectedGadgetIds as unknown[] : [])
      .filter((id): id is string => typeof id === 'string'),
    purposes: normalizePurposes(plan.purposes),
    placements: objectArray<GadgetPlacement>(plan.placements),
    // 期間の並べ替えと今日の状態の判定が素で読む。壊れていると公開デスクを開いた時点で落ちる
    gadgetUsage: repairGadgetUsage(plan.gadgetUsage),
    connectionMap: plan.connectionMap && typeof plan.connectionMap === 'object'
      ? {
          ...plan.connectionMap,
          connections: objectArray<MapConnection>(plan.connectionMap.connections),
          dismissedPairs: (Array.isArray(plan.connectionMap.dismissedPairs) ? plan.connectionMap.dismissedPairs as unknown[] : [])
            .filter((pair): pair is string => typeof pair === 'string'),
        }
      : undefined,
    wiringResult: plan.wiringResult && typeof plan.wiringResult === 'object'
      ? {
          ...plan.wiringResult,
          connections:    objectArray<Connection>(plan.wiringResult.connections),
          requiredCables: objectArray<RequiredCable>(plan.wiringResult.requiredCables),
          warnings:       warnings.filter((warning): warning is string => typeof warning === 'string'),
        }
      : undefined,
  }
}

function getShareSnapshot(desk: DeskWithDetails): ShareSnapshot | null {
  const value = desk.share_snapshot
  if (!value || typeof value !== 'object') return null
  const snapshot = value as Partial<ShareSnapshot>
  if (!snapshot.plan || typeof snapshot.plan !== 'object' || !Array.isArray(snapshot.gadgets)) return null
  return {
    version: typeof snapshot.version === 'number' ? snapshot.version : 1,
    plan: sanitizeSnapshotPlan(snapshot.plan),
    // 端末の保存と同じ修復に通す。null・ID の無い1件・重複を外し、名前（表示で startsWith）・
    // ジャンル・ポート・作成日時を補う。オブジェクトかどうかだけ見ていた頃は、名前が文字列でない
    // 1台で公開デスクの画面ごと落ちた
    gadgets: repairStoredGadgets(snapshot.gadgets),
  }
}

// ヘッドセットはヘッドホンへ統合した。統合前に公開されたデスクには 'Headset' が
// 残っていて、そのままだとラベルもアイコンも色も引けず、名前だけの箱になる
function normalizeCategory(raw: unknown): GadgetCategory {
  if (raw === 'Headset') return 'Headphone'
  return (raw as GadgetCategory) ?? 'Other'
}

export function toGadgets(desk: DeskWithDetails): Gadget[] {
  const snapshot = getShareSnapshot(desk)
  if (snapshot) {
    return snapshot.gadgets.map((g) => ({
      ...g,
      category: normalizeCategory(g.category),
      // 自作ジャンル。投稿者の端末が書いた値なので、形を確かめてから描く（壊れていれば「その他」）
      customCategory: normalizeCustomCategory(g.customCategory),
      ports: normalizePorts(Array.isArray(g.ports) ? g.ports : []),
    }))
  }
  return (desk.devices ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    category: normalizeCategory(d.category),
    // ports は JSON カラム。壊れていても配線図が落ちないよう配列以外は空にする
    ports: normalizePorts(Array.isArray(d.ports) ? (d.ports as Port[]) : []),
    price: d.price ?? undefined,
    // 「デスクの歴史」のイベント生成に使う。列が無い旧データは null → undefined
    purchasedAt: d.purchased_at ?? undefined,
    removedAt: d.removed_at ?? undefined,
    createdAt: d.created_at,
  }))
}

/** DB に保存されたガジェット間の接続（コンセントは含まれない） */
function toDeviceConnections(desk: DeskWithDetails): MapConnection[] {
  return (desk.connections ?? []).map((c) => ({
    id: c.id,
    fromGadgetId: c.from_device_id,
    toGadgetId: c.to_device_id,
    cableType: normalizeCableType(c.cable_type as CableType),
    // 公開デスクの配線は確定済みとして扱う（自動下書きの再生成対象にしない）
    origin: 'manual' as const,
    confirmed: true,
    wireless: isWirelessPortType(c.cable_type),
    // 列が無い旧データ・旧クライアントの公開分は null → undefined（束ねずに描く）
    branchGroupId: c.branch_group_id ?? undefined,
    // 本数（077）。1本の線は undefined のままにして「×1」を描かない
    count: (c.cable_count ?? 1) > 1 ? c.cable_count ?? undefined : undefined,
    // つなぎ方（076）。申告が無い線は undefined のままにして、閲覧側で「未設定」とも書かない
    cableChoice: c.cable_choice === 'included'
      ? { kind: 'included' as const }
      : c.cable_choice === 'product' && c.cable_name
        ? { kind: 'product' as const, name: c.cable_name, productId: c.cable_product_id ?? undefined }
        : undefined,
  }))
}

/**
 * コンセント（wall）・ソーラー・電池はデバイス実体を持たない仮想ノードで、
 * connections.from_device_id が devices への FK のため DB に保存できない。
 * マイデスクと同じ配線エンジンから決定論的に再構築することで、
 * 共有側でも電源ソースのノードと電源配線が同じ構造で描画される。
 */
function buildPowerSourceConnections(gadgets: Gadget[], plan: DeskPlan): MapConnection[] {
  const ids = new Set(plan.selectedGadgetIds)
  return generateWiring(gadgets, plan).connections
    .filter((c) => POWER_SOURCE_IDS.has(c.fromGadgetId) && ids.has(c.toGadgetId))
    .map((c, i) => ({
      id: `map-power-${i}`,
      fromGadgetId: c.fromGadgetId,
      toGadgetId: c.toGadgetId,
      cableType: c.cableType,
      chargingOnly: c.chargingOnly,
      origin: 'auto' as const,
      confirmed: true,
    }))
}

/**
 * 公開デスクの表示に必要な一式。画面（PublicDeskScreen）と起動時のウォームアップが
 * 同じ導出を使うための入口。別々に組み立てると配線図キャッシュのキーがずれ、
 * 温めたレイアウトが使われないまま開くたびに再計算になる。
 */
export interface PublicDeskModel {
  plan: DeskPlan
  /** 撤去済みを含む全ガジェット（デスクの歴史に使う） */
  historyGadgets: Gadget[]
  /** 現役のガジェット */
  selectedGadgets: Gadget[]
  /** 配線図のノードにするガジェット（ケーブルは線なのでノードにしない） */
  nonCableGadgets: Gadget[]
}

export function toPublicDeskModel(desk: DeskWithDetails): PublicDeskModel {
  const plan = toDeskPlan(desk)
  const historyGadgets = toGadgets(desk).map((g) => applyDeskGadgetUsage(plan, g))
  const selectedGadgets = historyGadgets.filter((g) => plan.selectedGadgetIds.includes(g.id))
  return {
    plan,
    historyGadgets,
    selectedGadgets,
    nonCableGadgets: selectedGadgets.filter((g) => g.category !== 'Cable'),
  }
}

/**
 * 公開デスクの利用期間（いつ入れて、いつ外したか）。変化サマリー用。
 * 配線まで組み立てる toDeskPlan は一覧のタイル1枚には重すぎるので、
 * スナップショットの gadgetUsage だけを取り出す。
 */
export function toGadgetUsage(desk: DeskWithDetails): Record<string, DeskGadgetUsage> | undefined {
  return getShareSnapshot(desk)?.plan.gadgetUsage
}

export function toPhotoUrls(desk: DeskWithDetails): string[] {
  return [...(desk.desk_photos ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => p.image_url)
}

export function toDeskPlan(desk: DeskWithDetails): DeskPlan {
  const gadgets = toGadgets(desk)
  const snapshot = getShareSnapshot(desk)
  if (snapshot) {
    const gadgetIds = new Set(gadgets.map((g) => g.id))
    const snapshotPlan: DeskPlan = {
      ...normalizePlan(snapshot.plan),
      id: desk.id,
      name: desk.title,
      // ひとことも名前と同じく列を正にする。スナップショット側は型の保証が無く、
      // 文字列でない値が入っていると表示の trim() で落ちる
      description: desk.description?.trim() || undefined,
      // desks.purposes は列に入ったままの値。スナップショットを通らないので、ここでも落とす
      purposes: normalizePurposes(desk.purposes?.length > 0 ? desk.purposes : snapshot.plan.purposes ?? []),
      selectedGadgetIds: snapshot.plan.selectedGadgetIds.filter((id) => gadgetIds.has(id)),
      images: toPhotoUrls(desk),
      isShared: true,
      createdAt: desk.created_at,
      updatedAt: desk.updated_at,
    }
    if (snapshotPlan.connectionMap) return snapshotPlan

    const legacyConnections = toDeviceConnections(desk)
    return {
      ...snapshotPlan,
      connectionMap: {
        connections: [
          ...buildPowerSourceConnections(gadgets, snapshotPlan),
          ...legacyConnections,
        ],
      },
    }
  }
  const base: DeskPlan = {
    id: desk.id,
    name: desk.title,
    description: desk.description?.trim() || undefined,
    goal: 'first_setup',
    purposes: normalizePurposes(desk.purposes),
    selectedGadgetIds: gadgets.map((g) => g.id),
    placements: [],
    isShared: true,
    images: toPhotoUrls(desk),
    connectionMap: { connections: toDeviceConnections(desk) },
    createdAt: desk.created_at,
    updatedAt: desk.updated_at,
  }
  // 電源ソースからの配線を足して、マイデスクと同じ配線図の構造にする
  return {
    ...base,
    connectionMap: {
      ...base.connectionMap,
      connections: [
        ...buildPowerSourceConnections(gadgets, base),
        ...(base.connectionMap?.connections ?? []),
      ],
    },
  }
}
