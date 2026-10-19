import Svg, { Circle, Line, Path, Rect } from 'react-native-svg'

interface Props {
  kind:
    | 'MonitorArm'
    | 'MicArm'
    | 'Tripod'
    | 'MiniPC'
    | 'HeadphoneAmp'
    | 'Dock'
    | 'Hub'
    | 'KVM'
    | 'NetworkSwitch'
    | 'MousePad'
    | 'DeskPad'
  size: number
  color: string
}

export function EquipmentCategoryIcon({ kind, size, color }: Props) {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {kind === 'MonitorArm' && (
        <>
          <Circle cx={5.5} cy={8} r={3.1} fill="none" {...stroke} />
          <Path d="M8.1 6.3 15.5 4M8.5 8.8l7-2.3M4.6 11l4.8 7M7 10.2l5.5 7.8M3 19h11" fill="none" {...stroke} />
          <Rect x={15.5} y={2.5} width={6.5} height={6.5} rx={0.8} fill="none" {...stroke} />
          <Circle cx={17.3} cy={4.3} r={0.65} fill={color} />
          <Circle cx={20.2} cy={4.3} r={0.65} fill={color} />
          <Circle cx={17.3} cy={7.2} r={0.65} fill={color} />
          <Circle cx={20.2} cy={7.2} r={0.65} fill={color} />
        </>
      )}
      {kind === 'MicArm' && (
        <>
          <Path d="m6.2 8.7 1.4-2 5.8 4.1-1.4 2zM11.6 10.6l1.7 2 5.7-4.8-1.7-2zM16.9 7.2l2.5-.3 1.4 10.8-2.5.3z" fill={color} />
          <Circle cx={12.5} cy={11.7} r={1.7} fill={color} />
          <Circle cx={18.2} cy={7.2} r={1.7} fill={color} />
          <Rect x={2.5} y={2} width={5.5} height={9} rx={2.75} fill={color} />
          <Path d="M4.2 10h2.1v3H4.2zM15 17h7v2h-2v2h2v2h-5v-2h1v-2h-3z" fill={color} />
        </>
      )}
      {kind === 'Tripod' && (
        <>
          <Rect x={7} y={3} width={10} height={5} rx={1} fill="none" {...stroke} />
          <Line x1={12} y1={8} x2={12} y2={13} {...stroke} />
          <Path d="M12 12 4 21M12 12l8 9M12 12v9" fill="none" {...stroke} />
        </>
      )}
      {kind === 'MiniPC' && (
        <Path
          d="M5 4h14a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm1 3v2h9V7H6Zm0 4v2h9v-2H6Zm0 4v2h4v-2H6Zm11 1a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z"
          fill={color}
          fillRule="evenodd"
        />
      )}
      {kind === 'HeadphoneAmp' && (
        <>
          <Path d="M3 11V9a9 9 0 0 1 18 0v2h-3V9A6 6 0 0 0 6 9v2H3Z" fill={color} />
          <Rect x={2.5} y={9.5} width={4.5} height={6.5} rx={1.5} fill={color} />
          <Rect x={17} y={9.5} width={4.5} height={6.5} rx={1.5} fill={color} />
          <Path
            d="M7 14h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Zm2.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm4.5.5V19h6v-1.5h-6Z"
            fill={color}
            fillRule="evenodd"
          />
        </>
      )}
      {kind === 'Dock' && (
        <>
          <Path d="M5 2h14a2 2 0 0 1 2 2v9H3V4a2 2 0 0 1 2-2Zm1 2v7h12V4H6Z" fill={color} fillRule="evenodd" />
          <Path
            d="M2 13h20v5a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-5Zm3 3v2h3v-2H5Zm5 0v2h3v-2h-3Zm6 0v2h3v-2h-3Z"
            fill={color}
            fillRule="evenodd"
          />
        </>
      )}
      {kind === 'Hub' && (
        <>
          <Path d="M1 10h7v4H1zM2 9h2v6H2z" fill={color} />
          <Path
            d="M8 5h11a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8V5Zm3 3v2h7V8h-7Zm0 4v2h7v-2h-7Zm0 4v1.5h4V16h-4Z"
            fill={color}
            fillRule="evenodd"
          />
        </>
      )}
      {kind === 'KVM' && (
        <>
          <Path d="M1 2h9v7H1V2Zm2 2v3h5V4H3Zm11-2h9v7h-9V2Zm2 2v3h5V4h-5Z" fill={color} fillRule="evenodd" />
          <Path d="M5 8h2v4H5zM17 8h2v4h-2z" fill={color} />
          <Path
            d="M4 12h16a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Zm2 3v2h3v-2H6Zm5 0v2h3v-2h-3Zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
            fill={color}
            fillRule="evenodd"
          />
        </>
      )}
      {kind === 'NetworkSwitch' && (
        <Path
          d="M4 5h16a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Zm1 4v4h3V9H5Zm5 0v4h3V9h-3Zm5 0v4h3V9h-3Zm5 0v2h1V9h-1ZM5 15v1h6v-1H5Z"
          fill={color}
          fillRule="evenodd"
        />
      )}
      {kind === 'MousePad' && (
        <>
          <Path d="M2 3h20v18H2V3Zm2 2v14h16V5H4Z" fill={color} fillRule="evenodd" />
          <Path d="M12 6a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0v-4a4 4 0 0 1 4-4Zm-.75 1.5v3h1.5v-3h-1.5Z" fill={color} fillRule="evenodd" />
        </>
      )}
      {kind === 'DeskPad' && (
        <>
          <Path d="M1 5h22v14H1V5Zm2 2v10h18V7H3Z" fill={color} fillRule="evenodd" />
          <Path d="M4 9h11v6H4zM18 9a2 2 0 0 1 2 2v2a2 2 0 0 1-4 0v-2a2 2 0 0 1 2-2Z" fill={color} />
        </>
      )}
    </Svg>
  )
}
