// デスクの寸法（幅・奥行き・高さ／昇降の範囲）と昇降の切り替え。
// 詳細（GadgetDetailScreen）で使う（登録画面は商品を選ぶだけになり、入力欄はここにだけある）。
// 昇降を切るときに高さの入力と電源の取り方まで戻すのは、電動昇降だけがコンセントを使うため。
// この後始末を2画面に手で書いていた頃の食い違いを避けて、ここ1か所に置く。
import { StyleSheet, Text, View } from 'react-native'
import { ToggleRow } from './GadgetFormRows'
import { AppColors } from '../../context/AppContext'
import type { PowerInput } from '../../utils/gadgetPorts'
import { sanitizeNumericInput } from '../../utils/numericInput'
import { TextField } from '../atoms/TextField'

interface Props {
  width: string
  depth: string
  height: string
  heightMin: string
  heightMax: string
  adjustable: boolean
  electric: boolean
  onWidth: (v: string) => void
  onDepth: (v: string) => void
  onHeight: (v: string) => void
  onHeightMin: (v: string) => void
  onHeightMax: (v: string) => void
  onAdjustable: (v: boolean) => void
  onElectric: (v: boolean) => void
  /** 電動昇降の切り替えに合わせて電源の取り方も動かす */
  onPowerInput: (v: PowerInput) => void
  colors: AppColors
  lang: 'ja' | 'en'
  unitLabel: string
  /** 昇降の切り替えを出すか。アクセサリーなど、寸法だけ聞く場所では出さない */
  showAdjustable?: boolean
}

export function DeskDimensionFields({
  width, depth, height, heightMin, heightMax, adjustable, electric,
  onWidth, onDepth, onHeight, onHeightMin, onHeightMax, onAdjustable, onElectric, onPowerInput,
  colors: C, lang, unitLabel, showAdjustable = true,
}: Props) {
  const cell = (label: string, value: string, onChange: (v: string) => void, keyboard: 'decimal-pad' | 'numeric') => (
    <View key={label} style={styles.dimCell}>
      <Text style={[styles.dimCellLabel, { color: C.textSub }]}>{label}</Text>
      <TextField
          placeholder="0"
          value={value}
          onChangeText={(v) => onChange(sanitizeNumericInput(v))}
          keyboardType={keyboard}
          trailing={<Text style={[styles.dimUnit, { color: C.textMuted }]}>{unitLabel}</Text>}
      />
    </View>
  )

  return (
    <>
      <View style={styles.dimRow}>
        {cell(lang === 'en' ? 'Width' : '幅', width, onWidth, 'decimal-pad')}
        {cell(lang === 'en' ? 'Depth' : '奥行き', depth, onDepth, 'decimal-pad')}
      </View>
      <View style={[styles.dimRow, { marginTop: 8 }]}>
        {adjustable ? (
          <>
            {cell(lang === 'en' ? 'Min Height' : '高さ (最低)', heightMin, onHeightMin, 'numeric')}
            {cell(lang === 'en' ? 'Max Height' : '高さ (最高)', heightMax, onHeightMax, 'numeric')}
          </>
        ) : (
          <>
            {cell(lang === 'en' ? 'Height' : '高さ', height, onHeight, 'decimal-pad')}
            {/* 1列だけのときも幅を半分に保つための空枠 */}
            <View style={styles.dimCell} />
          </>
        )}
      </View>
      {showAdjustable && (
      <ToggleRow
        label={lang === 'en' ? 'Height-adjustable' : '昇降機能あり'}
        value={adjustable}
        onChange={(v) => {
          onAdjustable(v)
          if (v) onHeight('')
          else { onElectric(false); onPowerInput('none') }
        }}
        colors={C}
      />
      )}
      {showAdjustable && adjustable && (
        <ToggleRow
          label={lang === 'en' ? 'Electric lift' : '電動昇降'}
          value={electric}
          onChange={(v) => { onElectric(v); onPowerInput(v ? 'outlet' : 'none') }}
          colors={C}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  dimRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  dimCell: { flex: 1 },
  dimCellLabel: { fontSize: 12, marginBottom: 4 },
  dimUnit: { fontSize: 13, fontWeight: '500', marginLeft: 3 },
})
