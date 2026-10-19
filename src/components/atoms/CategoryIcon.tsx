import { StyleProp, ViewStyle } from 'react-native'
import { CATEGORY_ICONS, ICONS, MCIconName } from '../../constants/icons'
import { isIconName } from '../../constants/customCategoryIcons'
import { AppIcon } from './AppIcon'
import { GameConsoleIcon } from './GameConsoleIcon'
import { EquipmentCategoryIcon } from './EquipmentCategoryIcon'
import { deskCategoryIcon } from '../../constants/deskCategoryIcons'
import { DeskAccessoryIcon } from './DeskAccessoryIcon'

interface Props {
  category: string
  pcFormFactor?: 'desktop' | 'laptop' | 'mini'
  size?: number
  color?: string
  style?: StyleProp<ViewStyle>
  // カテゴリの絵は必ず器（タイル・ノード・行の左）の中に置くので、既定で中心に寄せる。
  // 文章の行に混ぜるときだけ false にする
  centered?: boolean
  /** 自作ジャンルの絵。渡されていればカテゴリの絵より優先する（category は 'Other'） */
  customIcon?: string
}

export function CategoryIcon({ category, pcFormFactor, size = 24, color = '#000', style, centered = true, customIcon }: Props) {
  if (customIcon && category === 'Other' && deskCategoryIcon(customIcon)) {
    return <DeskAccessoryIcon name={customIcon} size={size} color={color} />
  }
  if (customIcon && category === 'Other' && isIconName(customIcon)) {
    return <AppIcon name={customIcon} size={size} color={color} style={style} centered={centered} />
  }
  if (category === 'GameConsole') {
    return <GameConsoleIcon size={size} color={color} />
  }
  if (
    category === 'MonitorArm' || category === 'MicArm' || category === 'Tripod' || category === 'HeadphoneAmp'
    || category === 'Dock' || category === 'Hub' || category === 'KVM' || category === 'NetworkSwitch'
    || category === 'MousePad' || category === 'DeskPad'
  ) {
    return <EquipmentCategoryIcon kind={category} size={size} color={color} />
  }
  if (category === 'PC') {
    if (pcFormFactor === 'mini') return <EquipmentCategoryIcon kind="MiniPC" size={size} color={color} />
    return <AppIcon name={pcFormFactor === 'laptop' ? 'laptop' : 'desktop-tower'} size={size} color={color} style={style} centered={centered} />
  }
  // category はカテゴリ以外（未知の文字列）でも呼ばれるので、引けなければ既定の絵に落とす。
  // CATEGORY_ICONS の値は MCIconName なので、名前の型はここで保たれる
  const iconName: MCIconName = CATEGORY_ICONS[category] ?? ICONS.package
  return <AppIcon name={iconName} size={size} color={color} style={style} centered={centered} />
}
