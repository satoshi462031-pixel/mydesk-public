import { ICON_OPTICAL_OFFSETS, ICON_OPTICS_BASE_SIZE } from '../constants/iconOptics.generated'

type IconTransform = ({ translateX: number } | { translateY: number })[]

// MaterialCommunityIcons は全字形の advance width が em と同じでも、輪郭はその中央に無い。
// flex の中央寄せだけでは器の中心から外れて見えるので、字形ごとのズレぶんを打ち消す。
// 値は npm run build:icon-optics が TTF から焼いた表（24pt 基準）で、実際の字面で按分する。
export function iconOpticalOffset(name: string, size: number): { x: number; y: number } {
  const offset = ICON_OPTICAL_OFFSETS[name]
  if (!offset) return { x: 0, y: 0 }
  const scale = size / ICON_OPTICS_BASE_SIZE
  return { x: offset[0] * scale, y: offset[1] * scale }
}

// style の transform にそのまま渡せる形。ズレの無いアイコンでは空配列を返す
export function iconOpticalTransform(name: string, size: number): IconTransform {
  const { x, y } = iconOpticalOffset(name, size)
  if (x === 0 && y === 0) return []
  return [{ translateX: x }, { translateY: y }]
}
