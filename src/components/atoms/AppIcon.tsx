// ルートから読むと未使用の18ファミリー（約2.7MB）のフォントまでアセットに含まれるため、
// 使うファミリーだけをサブパスで直接読む
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { StyleProp, TextStyle } from 'react-native'
import { MCIconName } from '../../constants/icons'
import { iconOpticalTransform } from '../../utils/iconOptics'

interface Props {
  name:   MCIconName
  size?:  number
  color?: string
  // アイコンは実体が <Text> なので TextStyle を受ける。
  // TextStyle は ViewStyle を継承しているため、従来の指定はそのまま通る
  style?: StyleProp<TextStyle>
  // 円や角丸の器の中央に置くとき。字形の輪郭は em の中央に無いので、
  // flex の中央寄せだけでは中心から外れて見える（iconOptics の注記）。
  // 文章の行に混ぜるときは付けない（隣の文字との間隔が変わる）
  centered?: boolean
}

// アプリ全体で使う型安全な MaterialCommunityIcons ラッパー
export function AppIcon({ name, size = 24, color = '#000', style, centered }: Props) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={color}
      // 補正を先に置き、呼び出し元の style から上書きできるようにする
      style={centered ? [centeredStyle(name, size), style] : style}
    />
  )
}

// 器の中に置くときは、字形の補正に加えて箱の大きさと行の高さを数値で固定する。
// 実体は <Text> で、iOS では高さをフォントのメトリクスが決めるため、固定しないと
// 初回と再レンダリング後で高さが変わり、器の中央寄せの結果として下へずれる
// （開いた直後だけ中央に見える。HeaderIconButton / IconCircleButton と同じ理由）。
// このフォントは字送り幅も行の高さも em と同じなので、固定しても配置は変わらない
function centeredStyle(name: MCIconName, size: number): TextStyle {
  return {
    width: size,
    height: size,
    lineHeight: size,
    textAlign: 'center',
    includeFontPadding: false,
    padding: 0,
    margin: 0,
    transform: iconOpticalTransform(name, size),
  }
}
