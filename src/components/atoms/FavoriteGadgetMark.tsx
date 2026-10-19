import { AppIcon } from './AppIcon'
import { ICONS } from '../../constants/icons'

interface Props {
  color: string
}

export function FavoriteGadgetMark({ color }: Props) {
  return <AppIcon name={ICONS.starFilled} size={13} color={color} />
}
