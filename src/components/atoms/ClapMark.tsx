import { View } from 'react-native'
import { AppIcon } from './AppIcon'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'

// 円の器に対する手の字面の比
const ICON_RATIO = 0.62

/**
 * 拍手済みは器の丸を黄色で塗り、手を暗くする（X のハートが輪郭から塗りに変わるのと同じ役割）。
 * hand-clap には塗りと輪郭の2種類が無く、手の色だけでは黄が白い面で 3:1 に届かず、
 * ダークでは灰色の手と明度が近くて見分けにくかった。塗った面の大きさで色以外の手がかりを作る。
 *
 * 拍手前も同じ大きさの器を取り、押した瞬間に横の件数・ラベルがずれないようにする。
 * 押せる部品ではない（押す範囲は呼び出し側のボタンが持つ）
 */
export function ClapMark({ clapped, diameter, color }: {
  clapped: boolean
  diameter: number
  /** 拍手前の手の色 */
  color: string
}) {
  const { colors: C } = useApp()
  return (
    <View
      style={{
        width: diameter,
        height: diameter,
        borderRadius: diameter / 2,
        backgroundColor: clapped ? C.clap : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <AppIcon name={ICONS.clap} size={Math.round(diameter * ICON_RATIO)} color={clapped ? C.onClapFill : color} centered />
    </View>
  )
}
