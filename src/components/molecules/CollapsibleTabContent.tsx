// タブの中身を、上部の収納（hooks/useCollapsibleHeader）に合わせて上へずらす箱。
// PublicDeskScreen / WiringResultScreen が共用する。組み立てを画面ごとに書くと枠の付け方が
// 食い違うので、枠とずらす箱はこの1つにまとめる。
//
// 切り取り枠が切るのは下のはみ出し（ペインは収納量ぶん背を高くしてある）だけ。
// 枠を動かさずに中身だけ上へずらすと、枠の上端より上へ出た中身が切られ、上がったタブバーとの
// 間に収納量ぶんのすき間が空く。そこから奥の写真が透け、収納しきると空白の帯になり、一覧の先頭と
// 配線図の上部がその裏に隠れていた（f7458f0 の枠と 5fcf55a のずらし方が重なって起きた）。
// 枠の上端を収納量ぶん上へ伸ばし、伸ばした所は上部とタブバーへ触れるよう素通しにする。
//
// ずらすのは中の1枚だけで、ペインの側ではない。配線と履歴のペインは display:'none' で保持して
// おり、隠れている間に transform が当たらず、表示へ戻した瞬間だけずれていない位置で出る。
import type { ComponentProps, PropsWithChildren } from 'react'
import { StyleSheet, View } from 'react-native'
import Reanimated from 'react-native-reanimated'
import { useCoachTarget } from '../../hooks/useCoachMarks'
import { DESK_CONTENT } from '../../constants/deskCoachSteps'

interface Props extends PropsWithChildren {
  collapseH: number
  /** useCollapsibleHeader の headerShiftStyle */
  shiftStyle: ComponentProps<typeof Reanimated.View>['style']
  /** useCollapsibleHeader の captureTouchDuringFling。片方の画面で渡し忘れないよう必須にしてある */
  captureTouch: () => boolean
}

export function CollapsibleTabContent({ collapseH, shiftStyle, captureTouch, children }: Props) {
  // 「？」の吹き出しで、中身の対象を切る枠と、上の写真に重なってくる面として測る
  const contentTarget = useCoachTarget(DESK_CONTENT)
  return (
    <View
      style={[styles.clip, { marginTop: -collapseH, paddingTop: collapseH }]}
      pointerEvents="box-none"
    >
      <Reanimated.View ref={contentTarget as ((node: View | null) => void) | undefined} style={[styles.fill, shiftStyle]} onStartShouldSetResponderCapture={captureTouch}>
        {children}
      </Reanimated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  clip: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
})
