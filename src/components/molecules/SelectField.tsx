import { useState } from 'react'
import { StyleProp, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native'
import { useApp } from '../../context/AppContext'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { AppIcon } from '../atoms/AppIcon'
import { ChoiceSheet, ChoiceSheetOption } from '../organisms/ChoiceSheet'

interface Props<K extends string> {
  /** シートの見出しと読み上げに使う（欄の上の見出しは画面側が持つ） */
  title: string
  options: readonly ChoiceSheetOption<K>[]
  value: K
  onChange: (key: K) => void
  /** 幅・余白・配置だけを渡す。見た目は TextField と同じにそろえる */
  style?: StyleProp<ViewStyle>
}

// フォームの「選択肢から1つ選ぶ」欄（iOS のポップアップボタンにあたる）。今の値を入力欄と同じ枠で見せ、
// 押すと選択肢のシートを開く。機材の一覧や位置（18 通り）を横スクロールのチップに並べていた頃は、
// 画面の外にある選択肢に気づけず、今どれを選んでいるかも枠の色でしか読めなかった
export function SelectField<K extends string>({ title, options, value, onChange, style }: Props<K>) {
  const { colors: C, lang } = useApp()
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.key === value)
  return (
    <>
      <TouchableOpacity
        style={[styles.field, { backgroundColor: C.input, borderColor: open ? C.accentIcon : C.inputBorder }, style]}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${title}：${current?.label ?? ''}`}
        accessibilityHint={lang === 'en' ? 'Opens the choices' : '選択肢を開きます'}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[styles.value, { color: C.text }]} numberOfLines={1}>{current?.label ?? ''}</Text>
        {!!current?.help && (
          <Text style={[styles.help, { color: C.textMuted }]} numberOfLines={1}>{current.help}</Text>
        )}
        <AppIcon name={ICONS.chevronDown} size={18} color={C.textMuted} />
      </TouchableOpacity>
      <ChoiceSheet
        visible={open}
        title={title}
        closeLabel={lang === 'en' ? `Close ${title}` : `${title}の選択を閉じる`}
        options={options}
        value={value}
        onSelect={onChange}
        onClose={() => setOpen(false)}
        colors={C}
      />
    </>
  )
}

const styles = StyleSheet.create({
  field: {
    minHeight: UI_METRICS.inputHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: UI_METRICS.controlRadius,
    paddingHorizontal: 12,
  },
  value: { flexShrink: 1, fontSize: 15 },
  help: { flex: 1, minWidth: 0, fontSize: 12 },
})
