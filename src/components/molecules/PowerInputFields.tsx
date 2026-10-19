// 給電方法と給電頻度の選択、および「配線図にどう出るか」の1行プレビュー。
// 詳細（GadgetDetailScreen）で使う。
//
// 2画面に手で書いていた頃、追加画面のプレビューにだけ dc（DCアダプター）の分岐が無く、
// ACアダプターを選ぶと「ワイヤレス充電器 ≈ このガジェット」と出ていた。
//
// children は給電頻度のあとに差し込む。詳細画面だけが持つ「充電元・挿す口」の選択が入る
import type { ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { AccordionField } from './AccordionField'
import { POWER_INPUT_OPTIONS, POWER_USAGE_OPTIONS, WIRELESS_POWER_CAPABLE } from '../../constants/gadgetFormOptions'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { AppColors } from '../../context/AppContext'
import { GadgetCategory } from '../../types'
import { NONE_POWER_ALLOWED_CATEGORIES } from '../../utils/gadgetPorts'
import type { PowerInput, PowerUsage } from '../../utils/gadgetPorts'

interface Props {
  category: GadgetCategory
  powerInput: PowerInput
  onPowerInput: (v: PowerInput) => void
  powerUsage: PowerUsage
  onPowerUsage: (v: PowerUsage) => void
  colors: AppColors
  lang: 'ja' | 'en'
  children?: ReactNode
}

export function PowerInputFields({
  category, powerInput, onPowerInput, powerUsage, onPowerUsage, colors: C, lang, children,
}: Props) {
  const wiringPreview = (): string => {
    switch (powerInput) {
      case 'none':    return lang === 'en' ? 'No power cable will be drawn in the wiring map' : '配線図に給電の配線は引かれません'
      case 'outlet':  return lang === 'en' ? 'Wiring: power strip / outlet → this gadget' : '配線図: 電源タップ・コンセント → このガジェット'
      case 'dc':      return lang === 'en' ? 'Wiring: AC adapter → DC plug on this gadget' : '配線図: ACアダプター → このガジェットのDCプラグ'
      case 'from_a':  return lang === 'en' ? 'Wiring: USB-A power source (charger etc.) → this gadget' : '配線図: USB-A給電元（充電器など） → このガジェット'
      case 'from_c':  return lang === 'en' ? 'Wiring: USB-C power source (charger etc.) → this gadget' : '配線図: USB-C給電元（充電器など） → このガジェット'
      case 'solar':   return lang === 'en' ? 'Wiring: solar panel → this gadget' : '配線図: ソーラーパネル → このガジェット'
      case 'battery': return lang === 'en' ? 'Wiring: battery → this gadget' : '配線図: 電池・バッテリー → このガジェット'
      default:        return lang === 'en' ? 'Wiring: wireless charger ≈ this gadget' : '配線図: ワイヤレス充電器 ≈ このガジェット'
    }
  }

  return (
    <>
      {/* 札が最大8個・2〜3段並び、機材詳細で一番縦に場所を取る。商品を選べば決まることが多いので、
          接続方式と同じく畳んで今の値だけ見せる。配線図にどう出るかの1行は畳んでも下に残す */}
      <AccordionField
        label={lang === 'en' ? 'Power Input' : '給電方法'}
        value={POWER_INPUT_OPTIONS.find(({ key }) => key === powerInput)?.label(lang)}
        colors={C}
      >
      <View style={styles.powerMethodGrid}>
        {POWER_INPUT_OPTIONS.filter(({ key }) =>
          (key !== 'none' || NONE_POWER_ALLOWED_CATEGORIES.includes(category)) &&
          (key !== 'wireless' || WIRELESS_POWER_CAPABLE.includes(category)) &&
          ((key !== 'solar' && key !== 'battery') || category === 'SmartHome'),
        ).map(({ key, label: labelFn, from, to, arrow }) => {
          const active = powerInput === key
          const iconColor = active ? C.accentIcon : C.textMuted
          return (
            <TouchableOpacity
              key={key}
              style={[styles.methodChip, styles.powerMethodChip, { borderColor: active ? C.accentIcon : C.border }]}
              onPress={() => onPowerInput(key)}
            >
              <View style={styles.powerIconRow}>
                <AppIcon name={from} size={22} color={iconColor} />
                {arrow && to && <>
                  <AppIcon name={ICONS.chevronRight} size={16} color={iconColor} />
                  <AppIcon name={to} size={22} color={iconColor} />
                </>}
              </View>
              <Text
                style={[styles.methodChipText, styles.powerMethodChipText, { color: active ? C.accentText : C.textMuted }]}
                numberOfLines={2}
              >
                {labelFn(lang)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
      </AccordionField>
      {powerInput !== 'none' && (
        <AccordionField
          label={lang === 'en' ? 'Power Usage' : '給電頻度'}
          value={(() => {
            const usage = POWER_USAGE_OPTIONS.find(({ key }) => key === powerUsage)
            return usage ? (lang === 'en' ? usage.en : usage.ja) : undefined
          })()}
          colors={C}
        >
          <View style={styles.powerMethodGrid}>
            {POWER_USAGE_OPTIONS.map(({ key, ja, en, icon }) => {
              const active = powerUsage === key
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.methodChip, styles.powerMethodChip, { borderColor: active ? C.accentIcon : C.border }]}
                  onPress={() => onPowerUsage(key)}
                >
                  <AppIcon name={icon} size={22} color={active ? C.accentIcon : C.textMuted} />
                  <Text style={[styles.methodChipText, styles.powerMethodChipText, { color: active ? C.accentText : C.textMuted }]} numberOfLines={2}>
                    {lang === 'en' ? en : ja}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          <Text style={[styles.powerPreview, { color: C.textMuted }]}>
            {powerUsage === 'rechargeable'
              ? (lang === 'en' ? 'Shown as a dashed charge-only route. The charging port can be shared.' : '充電時だけ点線で接続し、充電ポートをほかのガジェットと共有します')
              : powerUsage === 'replaceable'
                ? (lang === 'en' ? 'No charging route or charging port is required.' : '給電線を表示せず、充電ポートも使用しません')
                : (lang === 'en' ? 'This device continuously occupies one power port.' : '使用中は給電ポートを1口占有します')}
          </Text>
        </AccordionField>
      )}
      {children}
      {/* 選択が配線図にどう反映されるかの1行プレビュー（保存前に結果が分かる） */}
      <Text style={[styles.powerPreview, { color: C.textMuted }]}>{wiringPreview()}</Text>
    </>
  )
}

const styles = StyleSheet.create({
  powerMethodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  methodChip: { paddingVertical: 8, paddingHorizontal: 8, borderRadius: UI_METRICS.controlRadius, borderWidth: 1, alignItems: 'center', minWidth: 72 },
  powerMethodChip: { flexBasis: '31%', flexGrow: 1, maxWidth: '31.8%', height: 78, justifyContent: 'center' },
  methodChipText: { fontSize: 11, fontWeight: '500' },
  powerMethodChipText: { textAlign: 'center', lineHeight: 14 },
  powerIconRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 4 },
  powerPreview: { fontSize: 11, marginTop: 8, lineHeight: 15 },
})
