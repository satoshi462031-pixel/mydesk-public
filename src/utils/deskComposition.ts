import { defaultZoneForCategory } from '../constants/categoryZones'
import { DEFAULT_CATEGORY_ORDER } from '../constants/categoryOrder'
import { PURPOSE_GADGETS } from '../constants/purposeGadgets'
import { normalizeCustomCategory } from './customCategory'
import type { CustomCategory, DeskPlan, Gadget, GadgetCategory, PlanPurpose } from '../types'
import type { DeskTemplate, TemplateSlot } from '../types/template'

// ─── 自分で選んだ構成 ────────────────────────────────────────────────
//
// 用途から作ったジャンルの並びを、他人のデスクを写すとき（deskCopy.ts）と同じやり方で
// 1台1枠のテンプレートに見立てる。こうすると機材の段以降の画面・入力の控え・
// 作成処理（applyTemplate）に手を入れずに済む。
// 以前はこの並びをジャンルの段（用途の次）で選ばせていたが、機材の段でジャンルを
// 足す・外す・実物に合わせるができるので、段ごとやめた。

export type PcFormFactor = NonNullable<TemplateSlot['pcFormFactor']>

/** 機材の段の枠1つぶんのジャンル */
export interface CompositionPick {
  category: GadgetCategory
  /** PC のみ。ノートかデスクトップかで図の形も置き場所も変わる */
  pcFormFactor?: PcFormFactor
  /** モニターのみ。null はスタンド、数値はアーム枠の通し番号（0始まり）。 */
  monitorArmIndex?: number | null
  /** マイクのみ。null はスタンド、数値はアーム枠の通し番号（0始まり）。 */
  micArmIndex?: number | null
  armHolds?: number
  /** 自作ジャンル。category は 'Other' */
  custom?: CustomCategory
}

const COMPOSITION_TEMPLATE_PREFIX = 'composition-'

/** ケーブルは選ばせない。必要な線は配線図が引き、本数も自動で数える（テンプレートと同じ扱い） */
export const COMPOSITION_HIDDEN_CATEGORIES: readonly GadgetCategory[] = ['Cable', 'MonitorArm', 'MicArm']

/**
 * 用途に関わらず最初からチェックを入れておくジャンル。
 * 空の一覧から始めると「何を選べばいいか」から考えさせることになるので、
 * 大半のデスクにあるものを既定で入れ、要らないものを外してもらう。
 */
const BASE_CATEGORIES: readonly GadgetCategory[] = [
  'PC', 'Monitor', 'Keyboard', 'Mouse', 'Desk', 'Chair', 'PowerStrip', 'Charger',
]

const CATEGORY_ORDER = new Map(DEFAULT_CATEGORY_ORDER.map((category, index) => [category, index]))

function sortByCategoryOrder(categories: Iterable<GadgetCategory>): GadgetCategory[] {
  return [...categories].sort(
    (a, b) => (CATEGORY_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) - (CATEGORY_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER),
  )
}

/** 用途から作る初期チェック */
export function defaultCompositionCategories(purposes: readonly PlanPurpose[]): GadgetCategory[] {
  const picked = new Set<GadgetCategory>(BASE_CATEGORIES)
  purposes.forEach((purpose) => {
    PURPOSE_GADGETS[purpose]?.forEach((definition) => picked.add(definition.category))
  })
  COMPOSITION_HIDDEN_CATEGORIES.forEach((category) => picked.delete(category))
  return sortByCategoryOrder(picked)
}

/**
 * 用途を選んで「次へ」を押したときの機材の段の土台。用途に関わらない既定のジャンルを1台ずつ。
 * 用途のぶんは機材の段（TemplateDetail）が用途から枠を足す。土台に混ぜると、用途を選び直したとき
 * 並びが変わって枠の key と入力の控えがずれる（compositionTemplateId の注記）。
 * モニター・マイクはアームの有無を決めずに渡す（決めると「実物に合わせる」でアームを聞かなくなる）
 */
export function baseCompositionPicks(): CompositionPick[] {
  return defaultCompositionCategories([]).map((category): CompositionPick =>
    category === 'PC' ? { category, pcFormFactor: 'desktop' } : { category })
}

/** ガイドでは、配線図の価値が分かる最小構成を最初から用意する。 */
export function tutorialCompositionPicks(purposes: readonly PlanPurpose[]): CompositionPick[] {
  return [
    { category: 'PC', pcFormFactor: purposes.includes('gaming') ? 'desktop' : 'laptop' },
    { category: 'Monitor' },
    { category: 'PowerStrip' },
  ]
}

/**
 * 選んだ内容を表す短い id。
 * 機材の段の入力の控え（templateDetailDraft）はこの id で照合するので、並びが変わったら
 * 別の id になる必要がある。枠の key（`${枠の位置}-${何台目}`）は並びが変われば
 * 別の枠を指すため、古い控えを引き継ぐと外した枠・入れた商品名が別の枠へずれる。
 */
export function compositionTemplateId(picks: readonly CompositionPick[]): string {
  const signature = picks.map((pick) => `${pick.category}:${pick.pcFormFactor ?? ''}${pick.monitorArmIndex !== undefined ? `:monitorArm=${pick.monitorArmIndex}` : ''}${pick.micArmIndex !== undefined ? `:micArm=${pick.micArmIndex}` : ''}${pick.armHolds !== undefined ? `:holds=${pick.armHolds}` : ''}${pick.custom ? `:custom=${pick.custom.id}` : ''}`).join('|')
  // FNV-1a。衝突しても起きるのは「古い控えが残る」だけなので、短さを優先する
  let hash = 0x811c9dc5
  for (let i = 0; i < signature.length; i += 1) {
    hash ^= signature.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${COMPOSITION_TEMPLATE_PREFIX}${hash.toString(16).padStart(8, '0')}`
}

/** 選んだジャンルの並びを1台1枠のテンプレートに見立てる */
export function compositionTemplate(
  picks: readonly CompositionPick[],
  options: { nameJa: string; nameEn: string; purposes?: PlanPurpose[] },
): DeskTemplate {
  return {
    id: compositionTemplateId(picks),
    nameJa: options.nameJa,
    nameEn: options.nameEn,
    descJa: '',
    descEn: '',
    icon: 'view-grid-outline',
    color: '#6366F1',
    slots: picks.map((pick) => ({
      category: pick.category,
      pcFormFactor: pick.pcFormFactor,
      monitorArmIndex: pick.monitorArmIndex,
      micArmIndex: pick.micArmIndex,
      armHolds: pick.armHolds,
      custom: pick.custom,
      zone: defaultZoneForCategory(pick.category, pick.pcFormFactor),
    })),
    purposes: options.purposes,
    // 充電器は既定のチェック（BASE_CATEGORIES）に入れてあり、外すのも本人の判断。
    // テンプレートの共通ルールで足すと、外した充電器が作成時に戻ってくる
    autoCharger: false,
    source: 'user',
  }
}

/**
 * 作ったデスクの名前。テンプレートから作ると構成名（「シングルモニター」など）が
 * そのまま名前になっていたので、自分で選んだときは用途から付ける。
 */
const PURPOSE_DESK_NAME: Record<PlanPurpose, { ja: string; en: string }> = {
  gaming:    { ja: 'ゲーミングデスク',       en: 'Gaming Desk' },
  work:      { ja: 'ワークデスク',           en: 'Work Desk' },
  dev:       { ja: '開発デスク',             en: 'Dev Desk' },
  creative:  { ja: 'クリエイティブデスク',   en: 'Creative Desk' },
  streaming: { ja: '配信デスク',             en: 'Streaming Desk' },
  study:     { ja: '勉強デスク',             en: 'Study Desk' },
  music:     { ja: '音楽デスク',             en: 'Music Desk' },
  other:     { ja: 'マイデスク',             en: 'My Desk' },
}

/** compositionTemplate に渡す名前。用途「その他」に呼び名を付けていればそれを使う */
export function compositionNames(
  purposes: PlanPurpose[],
  otherPurposeLabel?: string,
): { nameJa: string; nameEn: string; purposes: PlanPurpose[] } {
  const main = purposes[0]
  if (main === 'other' && otherPurposeLabel) {
    return { nameJa: otherPurposeLabel, nameEn: otherPurposeLabel, purposes }
  }
  const name = PURPOSE_DESK_NAME[main] ?? PURPOSE_DESK_NAME.other
  return { nameJa: name.ja, nameEn: name.en, purposes }
}

/**
 * 作成済みのデスクを、ジャンルの並び（composition）の形に戻す。
 *
 * 配置・写真の段から進捗バーで機材の段へ戻ると、作成時の並び（composition）は手元に無い。
 * 今のデスクの機材から組み直し、普段の機材の段（TemplateDetail）を同じ形で開けるようにする。
 * 並びは配線図の並び順にそろえる（枠の key が並びで決まるため）
 */
export function compositionFromPlan(
  plan: Pick<DeskPlan, 'selectedGadgetIds' | 'monitorArmAssignments' | 'micArmAssignments'>,
  gadgets: readonly Gadget[],
): CompositionPick[] {
  const byId = new Map(gadgets.map((gadget) => [gadget.id, gadget]))
  const selected = plan.selectedGadgetIds
    .map((id) => byId.get(id))
    .filter((gadget): gadget is Gadget => !!gadget && !gadget.deletedAt && gadget.category !== 'Cable' && KNOWN_CATEGORIES.has(gadget.category))
  const ordered = [...selected].sort((a, b) =>
    (CATEGORY_ORDER.get(a.category) ?? Number.MAX_SAFE_INTEGER) - (CATEGORY_ORDER.get(b.category) ?? Number.MAX_SAFE_INTEGER))
  const monitorArms = ordered.filter((gadget) => gadget.category === 'MonitorArm')
  const micArms = ordered.filter((gadget) => gadget.category === 'MicArm')
  const monitorArmIndex = new Map(monitorArms.map((arm, index) => [arm.id, index]))
  const micArmIndex = new Map(micArms.map((arm, index) => [arm.id, index]))
  return ordered.map((gadget): CompositionPick => {
    if (gadget.category === 'PC') return { category: 'PC', pcFormFactor: gadget.pcFormFactor ?? 'desktop' }
    if (gadget.category === 'MonitorArm') {
      const holds = gadget.ports
        .filter((port) => port.type === 'MonitorArm' && port.direction === 'output')
        .reduce((sum, port) => sum + port.count, 0)
      return { category: 'MonitorArm', armHolds: Math.min(8, Math.max(1, holds)) }
    }
    if (gadget.category === 'MicArm') {
      const holds = gadget.ports
        .filter((port) => port.type === 'MicArm' && port.direction === 'output')
        .reduce((sum, port) => sum + port.count, 0)
      return { category: 'MicArm', armHolds: Math.min(8, Math.max(1, holds)) }
    }
    if (gadget.category === 'Monitor') {
      const armId = plan.monitorArmAssignments?.[gadget.id]
      return { category: 'Monitor', monitorArmIndex: armId ? monitorArmIndex.get(armId) ?? null : null }
    }
    if (gadget.category === 'Microphone') {
      const armId = plan.micArmAssignments?.[gadget.id]
      return { category: 'Microphone', micArmIndex: armId ? micArmIndex.get(armId) ?? null : null }
    }
    if (gadget.category === 'Other' && gadget.customCategory) return { category: 'Other', custom: gadget.customCategory }
    return { category: gadget.category }
  })
}

const PC_FORM_FACTORS: readonly PcFormFactor[] = ['desktop', 'laptop', 'mini']
const KNOWN_CATEGORIES = new Set<string>(DEFAULT_CATEGORY_ORDER)

/** 中断復帰の控え・画面遷移のパラメータから読み戻すときの検証 */
export function parseCompositionPicks(value: unknown): CompositionPick[] | null {
  if (!Array.isArray(value)) return null
  const picks: CompositionPick[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const { category, pcFormFactor, monitorArmIndex, micArmIndex, armHolds, custom: rawCustom } = entry as Partial<CompositionPick>
    if (typeof category !== 'string' || !KNOWN_CATEGORIES.has(category)) return null
    if (pcFormFactor !== undefined && !PC_FORM_FACTORS.includes(pcFormFactor)) return null
    if (monitorArmIndex !== undefined && (category !== 'Monitor' || (monitorArmIndex !== null && (!Number.isInteger(monitorArmIndex) || monitorArmIndex < 0)))) return null
    if (micArmIndex !== undefined && (category !== 'Microphone' || (micArmIndex !== null && (!Number.isInteger(micArmIndex) || micArmIndex < 0)))) return null
    if (armHolds !== undefined && ((category !== 'MonitorArm' && category !== 'MicArm') || !Number.isInteger(armHolds) || armHolds < 1 || armHolds > 8)) return null
    const custom = rawCustom === undefined ? undefined : normalizeCustomCategory(rawCustom)
    if (rawCustom !== undefined && (!custom || category !== 'Other')) return null
    picks.push({ category: category as GadgetCategory,
      ...(pcFormFactor !== undefined ? { pcFormFactor } : {}),
      ...(monitorArmIndex !== undefined ? { monitorArmIndex } : {}),
      ...(micArmIndex !== undefined ? { micArmIndex } : {}),
      ...(armHolds !== undefined ? { armHolds } : {}),
      ...(custom ? { custom } : {}),
    })
  }
  const monitorArms = picks.filter((pick) => pick.category === 'MonitorArm')
  const micArms = picks.filter((pick) => pick.category === 'MicArm')
  if (picks.some((pick) => pick.monitorArmIndex != null && pick.monitorArmIndex >= monitorArms.length)) return null
  if (picks.some((pick) => pick.micArmIndex != null && pick.micArmIndex >= micArms.length)) return null
  if (monitorArms.some((arm, index) => picks.filter((pick) => pick.monitorArmIndex === index).length > (arm.armHolds ?? 1))) return null
  if (micArms.some((arm, index) => picks.filter((pick) => pick.micArmIndex === index).length > (arm.armHolds ?? 1))) return null
  return picks
}
