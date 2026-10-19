import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { Button } from '../atoms/Button'
import { MCIconName } from '../../constants/icons'
import { AppColors } from '../../context/AppContext'
import { useCoachTarget } from '../../hooks/useCoachMarks'

interface Props {
  icon: MCIconName
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  colors: AppColors
  children?: React.ReactNode
  /** 「？」の吹き出しで次アクションのボタンを指すときの名前 */
  coachTarget?: string
}

// 全画面共通の空状態表示。アイコン・見出し・説明・次アクションのスタイルを統一する。
export function EmptyState({ icon, title, description, actionLabel, onAction, colors, children, coachTarget }: Props) {
  const actionTarget = useCoachTarget(coachTarget)
  const button = actionLabel && onAction ? (
    <Button
      title={actionLabel}
      shape="control"
      onPress={onAction}
      accessibilityLabel={actionLabel}
    />
  ) : null
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <AppIcon name={icon} size={56} color={colors.textMuted} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {!!description && <Text style={[styles.desc, { color: colors.textMuted }]}>{description}</Text>}
      {button && actionTarget ? <View ref={actionTarget} collapsable={false}>{button}</View> : button}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  // flex: 1 で余りを吸って中央に置く。余りが無いところ（内容の高さで決まる親）では
  // 今までどおり内容の高さになるので、置ける場所は狭めない
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48 },
  iconWrap: { marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  desc: { fontSize: 13, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
})
