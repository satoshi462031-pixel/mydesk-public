import Svg, { Path } from 'react-native-svg'

interface Props {
  size: number
  color: string
}

// Generic handheld console icon (Switch-inspired silhouette, no trademark)
// Shape: horizontal rounded rect body with screen hole + asymmetric stick holes
export function GameConsoleIcon({ size, color }: Props) {
  const d = [
    // Outer body (clockwise): x=1 y=5.5 w=22 h=13 rx=4
    'M5,5.5 H19 A4,4 0 0 1 23,9.5 V14.5 A4,4 0 0 1 19,18.5 H5 A4,4 0 0 1 1,14.5 V9.5 A4,4 0 0 1 5,5.5 Z',
    // Screen hole (counter-clockwise): x=7 y=7.5 w=10 h=9 rx=1
    'M8,7.5 A1,1 0 0 0 7,8.5 V15.5 A1,1 0 0 0 8,16.5 H16 A1,1 0 0 0 17,15.5 V8.5 A1,1 0 0 0 16,7.5 Z',
    // Left stick hole (cx=3.5 cy=10 r=1.5) — upper left joycon
    'M5,10 A1.5,1.5 0 1 0 2,10 A1.5,1.5 0 1 0 5,10 Z',
    // Right stick hole (cx=20.5 cy=14 r=1.5) — lower right joycon (Switch asymmetric layout)
    'M22,14 A1.5,1.5 0 1 0 19,14 A1.5,1.5 0 1 0 22,14 Z',
  ].join(' ')

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d} fill={color} fillRule="evenodd" />
    </Svg>
  )
}
