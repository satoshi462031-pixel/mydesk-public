import React, { forwardRef } from 'react'
import { TextInput } from 'react-native'
import { ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { AppIcon } from './AppIcon'
import { TextField, TextFieldProps } from './TextField'

export type SearchFieldProps = Omit<
  TextFieldProps,
  'leading' | 'size' | 'appearance' | 'accentColor' | 'invalid' | 'suggestionsOpen'
>

export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField(props, ref) {
  const { colors: C } = useApp()

  return (
    <TextField
      {...props}
      ref={ref}
      leading={<AppIcon name={ICONS.search} size={18} color={C.textMuted} />}
      returnKeyType={props.returnKeyType ?? 'search'}
      autoCapitalize={props.autoCapitalize ?? 'none'}
      autoCorrect={props.autoCorrect ?? false}
    />
  )
})
