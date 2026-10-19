import { ReactNode } from 'react'
import { LayoutChangeEvent, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native'
import { useApp } from '../../context/AppContext'
import { Button } from '../atoms/Button'
import { useSpotlightTarget } from '../../context/SpotlightContext'

type Props = {
  title: string
  onPress: () => void
  variant?: 'primary' | 'secondary'
  disabled?: boolean
  loading?: boolean
  absolute?: boolean
  accessibilityLabel?: string
  accessibilityHint?: string
  children?: ReactNode
  note?: ReactNode
  showGuide?: boolean
  onLayout?: (event: LayoutChangeEvent) => void
  style?: StyleProp<ViewStyle>
  messageStyle?: StyleProp<TextStyle>
}

/** 作成フローで共通の、補足＋主操作を置く下部バー。各画面の保存・遷移処理は呼び元に残す。 */
export function SetupActionFooter({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  absolute,
  accessibilityLabel,
  accessibilityHint,
  children,
  note,
  showGuide,
  onLayout,
  style,
  messageStyle,
}: Props) {
  const { colors } = useApp()
  const spotlightRef = useSpotlightTarget('setup-action')
  const footerRef = useSpotlightTarget('setup-footer')

  return (
    <View
      ref={showGuide ? footerRef : undefined}
      collapsable={false}
      style={[
        styles.footer,
        absolute && styles.absolute,
        { backgroundColor: colors.card, borderTopColor: colors.border },
        style,
      ]}
      onLayout={onLayout}
    >
      {children}
      <View ref={showGuide ? spotlightRef : undefined} collapsable={false}>
        <Button
          title={title}
          variant={variant}
          onPress={onPress}
          disabled={disabled}
          loading={loading}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          style={styles.button}
        />
      </View>
      {note != null && <Text style={[styles.note, { color: colors.textMuted }, messageStyle]}>{note}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  absolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
  },
  button: { width: '100%' },
  note: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
})
