import { Gadget } from '../../types'
import { armMountCategory } from '../../utils/gadgetPorts'
import { categoryIconColor } from '../../constants/icons'
import { CategoryIcon } from './CategoryIcon'

interface Props {
  gadget: Gadget
  size: number
  isDark: boolean
}

export function ArmMountIcon({ gadget, size, isDark }: Props) {
  const category = armMountCategory(gadget)
  if (!category) return null
  return <CategoryIcon category={category} size={size} color={categoryIconColor(category, isDark, '#7B1FA2')} />
}
