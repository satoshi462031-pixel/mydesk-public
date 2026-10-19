import { DeskPlan, PlanPurpose } from '../types'
import type { DeskCopySource } from './deskCopy'
import { CompositionPick, parseCompositionPicks } from './deskComposition'
import type { ProductSuggestion } from './productSuggestions'
import { normalizeCustomCategoryColor } from './customCategory'
import type { TemplateDetailDraft } from '../store/templateDetailDraft'

const PURPOSES = new Set<PlanPurpose>([
  'gaming',
  'work',
  'creative',
  'streaming',
  'study',
  'music',
  'other',
])

export type FirstSetupDraft = (
  | { screen: 'PurposeSelection'; purposes: PlanPurpose[]; otherPurposeLabel?: string; otherPurposeIcon?: string; otherPurposeColor?: string; intent?: 'organize' | 'plan' }
  | {
      screen: 'TemplateDetail'
      templateId: string
      purposes: PlanPurpose[]
      otherPurposeLabel?: string
      otherPurposeIcon?: string
      otherPurposeColor?: string
      copySource?: DeskCopySource
      /** 機材の段の土台のジャンルの並び。これが無いと復帰したとき枠ゼロの画面になる */
      composition?: CompositionPick[]
      intent?: 'organize' | 'plan'
      inputs?: TemplateDetailDraft
    }
  | { screen: 'GadgetSelection'; planId: string }
  | { screen: 'DeskPlacement'; planId: string }
  | { screen: 'PhotoFill'; planId: string }
  | { screen: 'WiringResult'; planId: string }
) & { createdAt?: string }

export type FirstSetupResumeNavigation =
  | { name: 'PurposeSelection'; params: { initialPurposes: PlanPurpose[]; initialOtherPurposeLabel?: string; initialOtherPurposeIcon?: string; initialOtherPurposeColor?: string; intent?: 'organize' | 'plan' } }
  | {
      name: 'TemplateDetail'
      params: {
        templateId: string
        purposes: PlanPurpose[]
        otherPurposeLabel?: string
        otherPurposeIcon?: string
        otherPurposeColor?: string
        copySource?: DeskCopySource
        composition?: CompositionPick[]
        intent?: 'organize' | 'plan'
        initialDraft?: TemplateDetailDraft
      }
    }
  | { name: 'GadgetSelection'; params: { planId: string; wizard: true } }
  | { name: 'DeskPlacement'; params: { planId: string } }
  | { name: 'PhotoFill'; params: { planId: string; fromSetup: true } }
  | { name: 'WiringResult'; params: { planId: string } }

/** 用途選択だけではデスクの内容がまだ決まっていないため、一覧の作成途中には出さない。 */
export function shouldShowSetupDraft(draft: FirstSetupDraft | null): draft is FirstSetupDraft {
  return draft !== null && draft.screen !== 'PurposeSelection'
}

/** 旧バックアップなどで再開位置がない場合は、復元された未完成デスクから補う。 */
export function resolveFirstSetupDraft(draft: FirstSetupDraft | null, plans: readonly DeskPlan[]): FirstSetupDraft | null {
  if (shouldShowSetupDraft(draft) && (!('planId' in draft) || plans.some((plan) => !plan.isShared && plan.id === draft.planId))) {
    return draft
  }
  const unfinished = plans.filter((plan) => !plan.isShared && !plan.wiringResult)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  return unfinished ? { screen: 'GadgetSelection', planId: unfinished.id, createdAt: unfinished.createdAt } : null
}

function validPurposes(value: unknown): value is PlanPurpose[] {
  return Array.isArray(value) && value.every((item) => PURPOSES.has(item as PlanPurpose))
}

function validCopySource(value: unknown): value is DeskCopySource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Partial<DeskCopySource>
  return typeof source.deskId === 'string'
    && typeof source.title === 'string'
    && typeof source.ownerName === 'string'
    && validPurposes(source.purposes)
    && Array.isArray(source.items)
    && source.items.every((item) => !!item && typeof item === 'object' && typeof item.category === 'string')
}

function validTemplateInputs(value: unknown, templateId: string): value is TemplateDetailDraft {
  if (!isRecord(value) || value.templateId !== templateId || value.returnPlanId !== undefined) return false
  const strings = (record: unknown) => isRecord(record) && Object.values(record).every(item => typeof item === 'string')
  const count = (item: unknown) => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 1000
  const specs = value.specEdits
  if (!count(value.outletCount) || !Array.isArray(value.extraItems) || !value.extraItems.every(item =>
    isRecord(item) && typeof item.key === 'string' && typeof item.name === 'string' && parseCompositionPicks([item]) !== null)) return false
  if (!Array.isArray(value.removedKeys) || !value.removedKeys.every(item => typeof item === 'string')) return false
  if (![value.productNames, value.productPrices, value.productDates].every(strings)
    || (value.ownedSelections !== undefined && !strings(value.ownedSelections))
    || (value.draftGadgets !== undefined && !strings(value.draftGadgets))
    || (value.registerAsOwned !== undefined && typeof value.registerAsOwned !== 'boolean')) return false
  if (!isRecord(value.productPicks) || !Object.values(value.productPicks).every(item => {
    if (!isRecord(item) || typeof item.name !== 'string') return false
    if (item.priceJpy !== undefined && (typeof item.priceJpy !== 'number' || !Number.isFinite(item.priceJpy))) return false
    return item.ports === undefined || (Array.isArray(item.ports) && item.ports.every(port =>
      isRecord(port) && typeof port.id === 'string' && typeof port.type === 'string'
      && ['input', 'output', 'bidirectional'].includes(String(port.direction)) && count(port.count)))
  })) return false
  const numeric = ['usbC', 'usbA', 'wireless', 'outlets', 'hdmiInput', 'displayPortInput', 'videoUsbCInput', 'lan', 'armHolds']
  const flags = ['stereoPair', 'hasSubwoofer', 'splitKeyboard', 'onArm']
  return isRecord(specs) && Object.values(specs).every(spec => isRecord(spec) && Object.entries(spec).every(([key, item]) =>
    numeric.includes(key) ? count(item)
      : flags.includes(key) ? typeof item === 'boolean'
      : key === 'speakerInputSide' ? item === 'L' || item === 'R'
      : key === 'pcFormFactor' && ['desktop', 'laptop', 'mini'].includes(String(item))))
}

export function parseFirstSetupDraft(raw: string | null): FirstSetupDraft | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<FirstSetupDraft>
    const otherPurposeColor = normalizeCustomCategoryColor((value as { otherPurposeColor?: unknown }).otherPurposeColor)
    const createdAt = typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))
      ? { createdAt: value.createdAt }
      : {}
    // 'TemplateList' はやめたジャンルの段の控え。用途は選んであるので、用途の段からやり直す
    const choice = value as Partial<{ screen: string; purposes: unknown; otherPurposeLabel: unknown; otherPurposeIcon: unknown; intent: 'organize' | 'plan' }>
    if (
      (choice.screen === 'PurposeSelection' || choice.screen === 'TemplateList')
      && validPurposes(choice.purposes)
      && (choice.otherPurposeLabel === undefined || typeof choice.otherPurposeLabel === 'string')
      && (choice.otherPurposeIcon === undefined || typeof choice.otherPurposeIcon === 'string')
      && (choice.intent === undefined || choice.intent === 'organize' || choice.intent === 'plan')
    ) {
      return {
        screen: 'PurposeSelection',
        ...createdAt,
        purposes: choice.purposes,
        ...(choice.otherPurposeLabel === undefined ? {} : { otherPurposeLabel: choice.otherPurposeLabel }),
        ...(choice.otherPurposeIcon === undefined ? {} : { otherPurposeIcon: choice.otherPurposeIcon }),
        ...(otherPurposeColor ? { otherPurposeColor } : {}),
        ...(choice.intent === undefined ? {} : { intent: choice.intent }),
      }
    }
    if (
      value.screen === 'TemplateDetail'
      && typeof value.templateId === 'string'
      && value.templateId.length > 0
      && validPurposes(value.purposes)
      && (value.otherPurposeLabel === undefined || typeof value.otherPurposeLabel === 'string')
      && (value.otherPurposeIcon === undefined || typeof value.otherPurposeIcon === 'string')
      && (value.copySource === undefined || validCopySource(value.copySource))
      && (value.composition === undefined || parseCompositionPicks(value.composition) !== null)
      && (value.intent === undefined || value.intent === 'organize' || value.intent === 'plan')
      && (value.inputs === undefined || validTemplateInputs(value.inputs, value.templateId))
    ) {
      return {
        screen: value.screen,
        ...createdAt,
        templateId: value.templateId,
        purposes: value.purposes,
        otherPurposeLabel: value.otherPurposeLabel,
        otherPurposeIcon: value.otherPurposeIcon,
        ...(otherPurposeColor ? { otherPurposeColor } : {}),
        copySource: value.copySource,
        ...(value.intent === undefined ? {} : { intent: value.intent }),
        ...(value.inputs === undefined ? {} : { inputs: value.inputs }),
        ...(value.composition === undefined
          ? {}
          : { composition: parseCompositionPicks(value.composition) ?? undefined }),
      }
    }
    if (
      (value.screen === 'GadgetSelection'
        || value.screen === 'DeskPlacement'
        || value.screen === 'PhotoFill'
        || value.screen === 'WiringResult')
      && typeof value.planId === 'string'
      && value.planId.length > 0
    ) {
      return { screen: value.screen, planId: value.planId, ...createdAt }
    }
  } catch {
    // 壊れたドラフトは通常の一覧開始として扱う。
  }
  return null
}

export function firstSetupResumeNavigation(draft: FirstSetupDraft): FirstSetupResumeNavigation {
  switch (draft.screen) {
    case 'PurposeSelection':
      return {
        name: 'PurposeSelection',
        params: {
          initialPurposes: draft.purposes,
          ...(draft.otherPurposeLabel === undefined ? {} : { initialOtherPurposeLabel: draft.otherPurposeLabel }),
          ...(draft.otherPurposeIcon === undefined ? {} : { initialOtherPurposeIcon: draft.otherPurposeIcon }),
          ...(draft.otherPurposeColor === undefined ? {} : { initialOtherPurposeColor: draft.otherPurposeColor }),
          ...(draft.intent === undefined ? {} : { intent: draft.intent }),
        },
      }
    case 'TemplateDetail':
      return {
        name: 'TemplateDetail',
        params: {
          templateId: draft.templateId,
          purposes: draft.purposes,
          otherPurposeLabel: draft.otherPurposeLabel,
          otherPurposeIcon: draft.otherPurposeIcon,
          ...(draft.otherPurposeColor === undefined ? {} : { otherPurposeColor: draft.otherPurposeColor }),
          copySource: draft.copySource,
          composition: draft.composition,
          ...(draft.intent === undefined ? {} : { intent: draft.intent }),
          ...(draft.inputs === undefined ? {} : { initialDraft: draft.inputs }),
        },
      }
    case 'GadgetSelection':
      return { name: 'GadgetSelection', params: { planId: draft.planId, wizard: true } }
    case 'DeskPlacement':
      return { name: 'DeskPlacement', params: { planId: draft.planId } }
    case 'PhotoFill':
      return { name: 'PhotoFill', params: { planId: draft.planId, fromSetup: true } }
    case 'WiringResult':
      return { name: 'WiringResult', params: { planId: draft.planId } }
  }
}

/**
 * 商品をまとめて登録（ProductFill）の下書き。商品名だけでなく、一覧・予測変換で選んだ商品も持つ。
 * 名前だけ控えていた頃は、戻って開き直すと手入力の扱いになり、端子・価格・購入リンクが付かなかった
 */
export interface ProductFillDraft {
  values: Record<string, string>
  picked: Record<string, ProductSuggestion>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const stringEntries = (value: unknown): Record<string, string> =>
  isRecord(value)
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {}

export function parseProductFillDraft(raw: string | null): ProductFillDraft {
  const empty: ProductFillDraft = { values: {}, picked: {} }
  if (!raw) return empty
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return empty
    // 旧形式は { 枠の id: 商品名 } の平たい表
    if (!isRecord(value.values)) return { values: stringEntries(value), picked: {} }
    const picked = isRecord(value.picked)
      ? Object.fromEntries(Object.entries(value.picked).filter((entry): entry is [string, ProductSuggestion] => {
          const suggestion = entry[1]
          return isRecord(suggestion) && typeof suggestion.name === 'string' &&
            (suggestion.ports === undefined || Array.isArray(suggestion.ports))
        }))
      : {}
    return { values: stringEntries(value.values), picked }
  } catch {
    return empty
  }
}
