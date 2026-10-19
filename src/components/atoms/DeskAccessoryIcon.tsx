import Svg, { Path } from 'react-native-svg'
import { deskCategoryIcon } from '../../constants/deskCategoryIcons'

export function DeskAccessoryIcon({ name, size = 24, color }: { name: string; size?: number; color: string }) {
  const icon = deskCategoryIcon(name)
  if (!icon) return null
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={icon.path} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}
