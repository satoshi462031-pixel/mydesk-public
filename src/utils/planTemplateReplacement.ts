import { DeskPlan, Gadget } from '../types'
import { updateDeskGadgetSelection } from './deskGadgetUsage'

export function replacePlanTemplate(previous: DeskPlan, next: DeskPlan, gadgets: Gadget[]): DeskPlan {
  const withUsage = updateDeskGadgetSelection(previous, next.selectedGadgetIds, gadgets)
  // 機材の顔ぶれが同じなら、配置の段で手直しした位置と大きさは残す。
  // 作成の途中で機材の段を開いて何も変えずに進んだだけで、配置がやり直しになっていた
  const sameGadgets = previous.selectedGadgetIds.length === next.selectedGadgetIds.length
    && next.selectedGadgetIds.every((id) => previous.selectedGadgetIds.includes(id))
  return {
    ...withUsage,
    purposes: next.purposes,
    otherPurposeLabel: next.otherPurposeLabel,
    otherPurposeIcon: next.otherPurposeIcon,
    otherPurposeColor: next.otherPurposeColor,
    templateId: next.templateId,
    placements: next.placements,
    wiredOverrides: next.wiredOverrides,
    monitorArmAssignments: next.monitorArmAssignments,
    micArmAssignments: next.micArmAssignments,
    outletCount: next.outletCount,
    outletCountVersion: next.outletCountVersion,
    wiringResult: undefined,
    // 線は捨てない。「つなぎ方」（どの1本を使っているか）・手で引いた線・非表示にした線は
    // 本人が入れたもので、自動では作り直せない。配置の画面の reconcileMap が、残る機材の組の
    // 分を接続元・接続先・種別で引き継ぎ、機材一覧から消えた相手の線を落とす。
    // 顔ぶれが変わったときは、手で動かした位置と大きさだけ捨てる（この後の画面で配置を決め直すため）
    connectionMap: previous.connectionMap
      ? sameGadgets ? previous.connectionMap : { ...previous.connectionMap, nodeOffsets: undefined, nodeSizes: undefined }
      : undefined,
    updatedAt: new Date().toISOString(),
  }
}
