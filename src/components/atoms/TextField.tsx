import React, { forwardRef, ReactNode, useState } from 'react'
import {
  Platform,
  StyleProp,
  StyleSheet,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native'
import { UI_METRICS } from '../../constants/ui'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { inputMaxLength, toSingleLine } from '../../utils/truncateText'
import { AppIcon } from './AppIcon'

type TextFieldSize = 'default' | 'compact' | 'prominent' | 'title'
type TextFieldAppearance = 'boxed' | 'underline'

export interface TextFieldProps extends Omit<TextInputProps, 'multiline' | 'placeholderTextColor' | 'style'> {
  size?: TextFieldSize
  appearance?: TextFieldAppearance
  accentColor?: string
  invalid?: boolean
  /** 直下に候補一覧が続く間だけ、下辺を一覧へつなげる。 */
  suggestionsOpen?: boolean
  leading?: ReactNode
  trailing?: ReactNode
  onClear?: () => void
  clearAccessibilityLabel?: string
  /** 幅・余白・配置だけに使う。入力欄の見た目はこの部品が持つ。 */
  containerStyle?: StyleProp<ViewStyle>
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField({
  size = 'default',
  appearance = 'boxed',
  accentColor,
  invalid = false,
  suggestionsOpen = false,
  leading,
  trailing,
  onClear,
  clearAccessibilityLabel,
  containerStyle,
  maxLength,
  ...inputProps
}, ref) {
  const { colors: C, t } = useApp()
  const [focused, setFocused] = useState(false)
  const canClear = focused && !!inputProps.value && inputProps.editable !== false && !inputProps.readOnly && !!onClear
  // 1行の欄なので、貼り付けで入った改行・タブは空白にして受け取る（toSingleLine の注記）。
  // パスワードは打ったとおりに渡す
  const { onChangeText, secureTextEntry } = inputProps
  const handleChangeText = onChangeText && !secureTextEntry
    ? (text: string) => onChangeText(toSingleLine(text))
    : onChangeText

  return (
    <View
      style={[
        styles.container,
        appearance === 'underline' && styles.underline,
        size === 'compact' && styles.compact,
        size === 'prominent' && styles.prominent,
        size === 'title' && styles.title,
        suggestionsOpen && styles.suggestionsOpen,
        {
          backgroundColor: appearance === 'underline' ? 'transparent' : C.input,
          borderColor: invalid ? C.danger : (accentColor === C.accent ? C.accentIcon : (accentColor ?? C.inputBorder)),
        },
        containerStyle,
      ]}
    >
      {leading}
      <TextInput
        {...inputProps}
        ref={ref}
        clearButtonMode="never"
        onFocus={(event) => {
          setFocused(true)
          inputProps.onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          inputProps.onBlur?.(event)
        }}
        onChangeText={handleChangeText}
        maxLength={inputMaxLength(inputProps.value, maxLength)}
        style={[
          styles.input,
          size === 'compact' && styles.compactInput,
          size === 'prominent' && styles.prominentInput,
          size === 'title' && styles.titleInput,
          { color: C.text },
        ]}
        placeholderTextColor={C.textMuted}
        multiline={false}
      />
      {canClear && (
        <TouchableOpacity
          onPress={onClear}
          delayPressIn={0}
          onPressIn={(event) => {
            // Web でクリック時にフォーカスが外れると、onPress より先にボタンが消える。
            if (Platform.OS === 'web') event.preventDefault()
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel ?? t('a11y.clearInput')}
        >
          <AppIcon name={ICONS.clear} size={18} color={C.textMuted} />
        </TouchableOpacity>
      )}
      {trailing}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    minHeight: UI_METRICS.inputHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    paddingHorizontal: 12,
  },
  compact: {
    minHeight: UI_METRICS.compactInputHeight,
    paddingHorizontal: 8,
  },
  underline: {
    minHeight: UI_METRICS.compactInputHeight,
    borderWidth: 0,
    borderBottomWidth: 1.5,
    borderRadius: 0,
    paddingHorizontal: 0,
  },
  prominent: {
    minHeight: 48,
    paddingHorizontal: 14,
  },
  title: {
    minHeight: 48,
  },
  suggestionsOpen: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomColor: 'transparent',
  },
  input: {
    flex: 1,
    minWidth: 0,
    // 欄の高さいっぱいに伸ばす。中身から測った高さに任せると、iOS で一覧の先頭の欄だけ
    // 文字より低く測られ、「金額」の下半分が切れた（1行の欄は伸ばしても上下中央に描かれる）
    alignSelf: 'stretch',
    padding: 0,
    fontSize: 15,
  },
  compactInput: {
    fontSize: 12,
  },
  prominentInput: {
    fontSize: 17,
    fontWeight: '600',
  },
  // lineHeight は付けない。iOS の TextInput は lineHeight の余りを字の上に足すので、例文が下へずれる
  // （utils/multilineInputText.ts）
  titleInput: {
    fontSize: 20,
    fontWeight: '800',
  },
})
