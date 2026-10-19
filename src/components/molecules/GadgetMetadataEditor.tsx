// 数量・設置／固定関係・デスクでの位置・運用モードの入力欄は廃止した（ガジェット編集の項目を絞った）。
// 保存済みの値は編集画面が読み書きだけ続けるので、その整形だけ残す
import { Gadget } from '../../types'
import { OPERATION_MODE_MAX_COUNT, OPERATION_MODE_MAX_LENGTH } from '../../constants/textLimits'
import { truncateChars } from '../../utils/truncateText'

export type MountingType = NonNullable<Gadget['mounting']>['type']

export function parseOperationModes(value: string): string[] | undefined {
  const modes = [...new Set(value.split(/[\n,、]/).map((item) => item.trim()).filter(Boolean))]
  // 個数と1つぶんの長さで止める。貼り付けで何十行も入ると、チップの段が積み上がって
  // 詳細シートがモードの一覧で埋まる（保存した値がそのまま公開ページにも出る）
  const capped = modes
    .slice(0, OPERATION_MODE_MAX_COUNT)
    .map((mode) => truncateChars(mode, OPERATION_MODE_MAX_LENGTH))
  return capped.length > 0 ? capped : undefined
}
