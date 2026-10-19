import type { CustomCategory, Gadget, GadgetCategory } from '../types'

/** 自作ジャンル名の上限。ジャンル名はタイル・配線図のノードに1〜2行で出るので短く切る */
export const CUSTOM_CATEGORY_NAME_MAX = 20

export function normalizeCustomCategoryColor(raw: unknown): string | undefined {
  return typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toUpperCase() : undefined
}

/**
 * 保存データ・公開スナップショットから読んだ値を、描ける形にそろえる。
 * 公開デスクの値は他人の端末が書いた JSON なので、型が合わなければ捨てて「その他」に戻す
 */
export function normalizeCustomCategory(raw: unknown): CustomCategory | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Partial<Record<keyof CustomCategory, unknown>>
  if (typeof value.id !== 'string' || !value.id) return undefined
  if (typeof value.name !== 'string') return undefined
  const name = value.name.trim().slice(0, CUSTOM_CATEGORY_NAME_MAX)
  if (!name) return undefined
  // 名前の実在は描く側（CategoryIcon）が同梱フォントで確かめる。ここはフォントを読まずに
  // 済む形の検査だけにする（node のテストからも呼ぶため）
  const icon = typeof value.icon === 'string' && /^[a-z0-9-]{1,64}$/.test(value.icon) ? value.icon : 'shape-outline'
  const color = normalizeCustomCategoryColor(value.color)
  return { id: value.id.slice(0, 64), name, icon, ...(color ? { color } : {}) }
}

/** ガジェットの自作ジャンル。'Other' 以外に付いていても無視する（カテゴリを変えたあとの取り残し） */
export function customCategoryOf(gadget: Pick<Gadget, 'category' | 'customCategory'>): CustomCategory | undefined {
  return gadget.category === 'Other' ? gadget.customCategory : undefined
}

/** ジャンル名。各画面が t('category.' + category) を直接引くと自作ジャンルの名前が消える */
export function gadgetCategoryLabel(
  gadget: Pick<Gadget, 'category' | 'customCategory'>,
  t: (key: string) => string,
): string {
  return customCategoryOf(gadget)?.name ?? t(`category.${gadget.category}`)
}

/**
 * 一覧をジャンル別に束ねるときの鍵。自作ジャンルは同じ 'Other' でも別の節に分ける。
 * 'custom:' を付けるのは、GadgetCategory の値と衝突させないため
 */
export function gadgetCategoryKey(gadget: Pick<Gadget, 'category' | 'customCategory'>): string {
  const custom = customCategoryOf(gadget)
  return custom ? `custom:${custom.id}` : gadget.category
}

/** 束ねた節1つぶん。見出しの絵と名前はここから引く */
export interface GadgetCategoryGroup {
  key: string
  cat: GadgetCategory
  custom?: CustomCategory
  gs: Gadget[]
}

export function groupGadgetsByCategory(gadgets: readonly Gadget[]): GadgetCategoryGroup[] {
  const map = new Map<string, GadgetCategoryGroup>()
  for (const gadget of gadgets) {
    const key = gadgetCategoryKey(gadget)
    const group = map.get(key)
    if (group) group.gs.push(gadget)
    else map.set(key, { key, cat: gadget.category, custom: customCategoryOf(gadget), gs: [gadget] })
  }
  return [...map.values()]
}
