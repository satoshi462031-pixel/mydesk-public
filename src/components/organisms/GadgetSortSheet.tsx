import { CATEGORY_SELECTION_ORDER } from '../../constants/categoryOrder'
import { AppColors, Lang } from '../../context/AppContext'
import { Gadget } from '../../types'
import { ChoiceSheet } from './ChoiceSheet'

export type GadgetSortKey = 'manual' | 'createdAt' | 'purchasedAt' | 'name' | 'category' | 'price_desc' | 'price_asc'

export const GADGET_SORT_OPTIONS: { key: GadgetSortKey; labelKey: string; helpJa?: string; helpEn?: string }[] = [
  { key: 'manual', labelKey: 'wiringResult.sortManual', helpJa: '商品を長押しして上下にドラッグ', helpEn: 'Hold an item and drag it up or down' },
  { key: 'createdAt', labelKey: 'wiringResult.sortCreatedAt', helpJa: 'このアプリに追加した新しいガジェットから表示', helpEn: 'Shows gadgets most recently added here' },
  { key: 'purchasedAt', labelKey: 'wiringResult.sortPurchasedAt', helpJa: '購入日が新しいガジェットから表示', helpEn: 'Shows gadgets with the newest purchase date first' },
  { key: 'name', labelKey: 'wiringResult.sortName' },
  { key: 'category', labelKey: 'wiringResult.sortCategory' },
  { key: 'price_desc', labelKey: 'wiringResult.sortPriceDesc' },
  { key: 'price_asc', labelKey: 'wiringResult.sortPriceAsc' },
]

export function compareGadgets(a: Gadget, b: Gadget, key: GadgetSortKey, lang: Lang): number {
  switch (key) {
    case 'manual': return 0
    case 'purchasedAt': return (b.purchasedAt ?? b.createdAt).localeCompare(a.purchasedAt ?? a.createdAt)
    case 'name': return a.name.localeCompare(b.name, lang === 'en' ? 'en' : 'ja')
    case 'category': {
      const categoryOrder = CATEGORY_SELECTION_ORDER.indexOf(a.category) - CATEGORY_SELECTION_ORDER.indexOf(b.category)
      return categoryOrder || a.name.localeCompare(b.name, lang === 'en' ? 'en' : 'ja')
    }
    case 'price_desc': return (b.price ?? -1) - (a.price ?? -1)
    case 'price_asc': return (a.price ?? Infinity) - (b.price ?? Infinity)
    default: return b.createdAt.localeCompare(a.createdAt)
  }
}

interface Props {
  visible: boolean
  value: GadgetSortKey
  onSelect: (key: GadgetSortKey) => void
  onClose: () => void
  colors: AppColors
  lang: Lang
  t: (key: string, vars?: Record<string, string | number>) => string
  allowManual?: boolean
}

export function GadgetSortSheet({ visible, value, onSelect, onClose, colors, lang, t, allowManual = false }: Props) {
  return (
    <ChoiceSheet
      visible={visible}
      title={lang === 'en' ? 'Sort gadgets' : '並び順'}
      closeLabel={lang === 'en' ? 'Close sort choices' : '並び順の選択を閉じる'}
      options={GADGET_SORT_OPTIONS.filter((option) => allowManual || option.key !== 'manual').map((option) => ({
        key: option.key,
        label: t(option.labelKey),
        help: lang === 'en' ? option.helpEn : option.helpJa,
      }))}
      value={value}
      onSelect={onSelect}
      onClose={onClose}
      colors={colors}
    />
  )
}
