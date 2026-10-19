import { ReactNode } from 'react'
import { useApp } from '../../context/AppContext'
import { UI_METRICS } from '../../constants/ui'
import { FullSwipeRow } from './FullSwipeRow'

/**
 * 保存の解除。左へ引ききると外れ、呼ぶ側が「元に戻す」を出す。
 * 外すのは自分用の印なので、裏の色は削除の赤ではなく chip にする。
 */
export function SavedSwipeRow({ label, disabled, radius = UI_METRICS.controlRadius, onRemove, children }: {
  label: string
  disabled?: boolean
  radius?: number
  onRemove: () => void
  children: ReactNode
}) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  return (
    <FullSwipeRow
      card
      enabled={!disabled}
      actionLabel={ja ? '保存を解除' : 'Unsave'}
      actionAccessibilityLabel={ja ? `${label}の保存を解除` : `Remove ${label} from saved`}
      actionIcon="bookmark-remove-outline"
      actionColor={C.chip}
      actionContentColor={C.text}
      radius={radius}
      onCommit={onRemove}
    >
      {children}
    </FullSwipeRow>
  )
}
