import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { Button } from '../atoms/Button'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { ContrastToggle } from '../atoms/ContrastToggle'
import { NumberStepper } from '../atoms/NumberStepper'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { PORT_ICONS, portIconColor } from '../../constants/portTypes'
import { useApp } from '../../context/AppContext'
import { TemplateItem } from '../../services/templateService'
import { trimInvisible } from '../../utils/truncateText'
import {
  TEMPLATE_SPEC_COUNT_FIELDS,
  TEMPLATE_SPEC_COUNT_RANGE,
  TemplateSpec,
  TemplateSpecCountField,
  templateSpecFieldPortType,
} from '../../utils/templateSpec'

interface Props {
  visible: boolean
  items: TemplateItem[]
  /** 口数を聞かない枠（商品を候補から選び、ポートが決まっている枠）のキー */
  countLockedKeys: Set<string>
  /** 「アームに載せるか」を聞く枠のキー */
  armAskedKeys: Set<string>
  /** PC の形を聞く枠のキー（まだ作っていない PC の枠） */
  formFactorKeys: Set<string>
  specFor: (item: TemplateItem) => TemplateSpec
  /** 前の段で枠に入れた商品名（枠のキー → 入力のまま） */
  productNames: Record<string, string>
  onChange: (key: string, patch: TemplateSpec) => void
  onClose: () => void
  onConfirm: () => void
  onDismissed?: () => void
  /** 下のボタンの文言。作成直前に開くときは「この内容で作成」、1台分だけ開くときは「完了」 */
  confirmLabel?: string
  /** 利用できる壁コンセントの口数。作成直前に開くときだけ一番上に出す（1台分だけ開くときは渡さない） */
  outlet?: { count: number; onChange: (count: number) => void }
}

const PC_FORM_FACTORS: { value: NonNullable<TemplateSpec['pcFormFactor']>; ja: string; en: string }[] = [
  { value: 'desktop', ja: 'デスクトップ', en: 'Desktop' },
  { value: 'laptop', ja: 'ノートPC', en: 'Laptop' },
  { value: 'mini', ja: 'ミニPC', en: 'Mini PC' },
]

const COUNT_LABELS: Record<TemplateSpecCountField, { ja: string; en: string }> = {
  usbC: { ja: 'USB-C', en: 'USB-C' },
  usbA: { ja: 'USB-A', en: 'USB-A' },
  wireless: { ja: 'ワイヤレス充電', en: 'Wireless charging pads' },
  outlets: { ja: 'コンセントの口', en: 'AC outlets' },
  hdmiInput: { ja: 'HDMI 入力', en: 'HDMI inputs' },
  displayPortInput: { ja: 'DisplayPort 入力', en: 'DisplayPort inputs' },
  videoUsbCInput: { ja: 'USB-C 映像入力', en: 'USB-C video inputs' },
  lan: { ja: 'LAN の口', en: 'LAN ports' },
}

/** テンプレートで作成する直前に、口数と左右分割だけを実物に合わせるページ */
export function TemplateSpecSheet({ visible, items, countLockedKeys, armAskedKeys, formFactorKeys, specFor, productNames, onChange, onClose, onConfirm, onDismissed, confirmLabel, outlet }: Props) {
  const { colors: C, lang, isDark, t, reduceMotion } = useApp()
  const ja = lang === 'ja'
  const wasVisible = useRef(visible)
  useEffect(() => {
    const closed = wasVisible.current && !visible
    wasVisible.current = visible
    if (closed && Platform.OS !== 'ios') onDismissed?.()
  }, [visible, onDismissed])

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'fade' : 'slide'} presentationStyle="pageSheet" onRequestClose={onClose} onDismiss={onDismissed}>
      <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
        <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <Text style={[styles.title, { color: C.text }]}>{ja ? '実物に合わせる' : 'Match your gear'}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={[styles.lead, { color: C.textSub }]}>
            {ja
              ? '口の数と左右に分かれるかで、配線図の本数と形が変わります。わからない項目はそのままで作成できます。'
              : 'Port counts and left/right splits change the cables and shape of your wiring map. Leave anything you are unsure of as is.'}
          </Text>

          {/* 壁の口は机の上の機材とは別の「部屋の条件」だが、足りるかで電源タップの要否と線が変わる。
              機材の段に置くと商品名を入れる画面の先頭を占めていたので、実物に合わせる項目の先頭へ移した */}
          {outlet && (
            <View style={[styles.card, { backgroundColor: C.card }]}>
              <View style={styles.cardHeader}>
                <View style={[styles.cardIcon, { backgroundColor: C.chip }]}>
                  <AppIcon name="power-socket-jp" size={16} color={C.textSub} />
                </View>
                <View style={styles.cardTitleWrap}>
                  <Text style={[styles.cardTitle, { color: C.text }]}>{ja ? '壁コンセント' : 'Wall outlet'}</Text>
                  {outlet.count === 0 && (
                    <Text style={[styles.cardProduct, { color: C.textMuted }]}>
                      {ja ? 'コンセントなし。モバイルバッテリーから給電します' : 'No outlet. Power comes from a power bank.'}
                    </Text>
                  )}
                </View>
              </View>
              <View style={[styles.row, { borderTopColor: C.separator }]}>
                <RowLabel
                  icon={<AppIcon name={PORT_ICONS.Power ?? 'power-plug'} size={ROW_ICON_SIZE} color={portIconColor('Power', isDark)} centered />}
                  label={ja ? '使える口' : 'Available outlets'}
                />
                <NumberStepper
                  value={outlet.count}
                  onChange={outlet.onChange}
                  max={20}
                  size="regular"
                  accessibilityLabel={ja ? '使える壁コンセントの口' : 'Available wall outlets'}
                />
              </View>
            </View>
          )}

          {items.map((item) => {
            const spec = specFor(item)
            const countFields = countLockedKeys.has(item.key) ? [] : TEMPLATE_SPEC_COUNT_FIELDS[item.category] ?? []
            const productName = trimInvisible(productNames[item.key] ?? '')
            const armCategory = item.category === 'Monitor' ? 'MonitorArm' : 'MicArm'
            return (
              <View key={item.key} style={[styles.card, { backgroundColor: C.card }]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIcon, { backgroundColor: C.chip }]}>
                    <CategoryIcon category={item.category} pcFormFactor={item.pcFormFactor} customIcon={item.custom?.icon} size={16} color={categoryIconColor(item.category, isDark, undefined, item.custom?.color)} />
                  </View>
                  {/* 見出しは枠の名前のまま。商品名に替えると、同じ型番を2台入れたときにどちらの枠か分からない */}
                  <View style={styles.cardTitleWrap}>
                    <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={1}>{item.name}</Text>
                    {!!productName && (
                      <Text style={[styles.cardProduct, { color: C.textSub }]} numberOfLines={1}>{productName}</Text>
                    )}
                  </View>
                </View>

                {formFactorKeys.has(item.key) && (
                  <AccordionChoiceRow
                    icon={<CategoryIcon category="PC" pcFormFactor={spec.pcFormFactor ?? 'desktop'} size={ROW_ICON_SIZE} color={categoryIconColor('PC', isDark)} />}
                    label={ja ? 'PCの形' : 'PC type'}
                    options={PC_FORM_FACTORS.map((option) => ({
                      value: option.value,
                      label: ja ? option.ja : option.en,
                      icon: (color: string) => <CategoryIcon category="PC" pcFormFactor={option.value} size={18} color={color} />,
                    }))}
                    value={spec.pcFormFactor ?? 'desktop'}
                    onChange={(value) => onChange(item.key, { pcFormFactor: value })}
                  />
                )}

                {countFields.map((field) => {
                  const value = spec[field] ?? 0
                  const { min, max } = TEMPLATE_SPEC_COUNT_RANGE[field]
                  const label = ja ? COUNT_LABELS[field].ja : COUNT_LABELS[field].en
                  const portType = templateSpecFieldPortType(field)
                  return (
                    <View key={field} style={[styles.row, { borderTopColor: C.separator }]}>
                      <RowLabel
                        icon={<AppIcon name={PORT_ICONS[portType] ?? 'connection'} size={ROW_ICON_SIZE} color={portIconColor(portType, isDark)} centered />}
                        label={label}
                      />
                      <NumberStepper
                        value={value}
                        onChange={(next) => onChange(item.key, { [field]: next })}
                        min={min}
                        max={max}
                        size="regular"
                        accessibilityLabel={`${item.name} ${label}`}
                      />
                    </View>
                  )
                })}

                {item.category === 'Speaker' && (
                  <>
                    <ToggleRow
                      icon={<AppIcon name={ICONS.speakerPair} size={ROW_ICON_SIZE} color={categoryIconColor('Speaker', isDark)} centered />}
                      label={ja ? '2台セット（L/R）' : '2-unit stereo pair (L/R)'}
                      value={!!spec.stereoPair}
                      onChange={(v) => onChange(item.key, { stereoPair: v })}
                    />
                    {/* 機材詳細の同じ欄と同じ折りたたみにそろえる */}
                    {spec.stereoPair && (
                      <AccordionChoiceRow
                        icon={<AppIcon name={PORT_ICONS.RCA ?? 'connection'} size={ROW_ICON_SIZE} color={portIconColor('RCA', isDark)} centered />}
                        label={ja ? '入力機器を接続する側' : 'Input connection side'}
                        options={(['L', 'R'] as const).map((side) => ({ value: side, label: side }))}
                        value={spec.speakerInputSide ?? 'R'}
                        onChange={(side) => onChange(item.key, { speakerInputSide: side })}
                      />
                    )}
                    <ToggleRow
                      icon={<AppIcon name={ICONS.subwoofer} size={ROW_ICON_SIZE} color={categoryIconColor('Speaker', isDark)} centered />}
                      label={ja ? 'ウーファーあり' : 'Includes a subwoofer'}
                      value={!!spec.hasSubwoofer}
                      onChange={(v) => onChange(item.key, { hasSubwoofer: v })}
                    />
                  </>
                )}

                {item.category === 'Keyboard' && (
                  <ToggleRow
                    icon={<AppIcon name={ICONS.splitKeyboard} size={ROW_ICON_SIZE} color={categoryIconColor('Keyboard', isDark)} centered />}
                    label={ja ? '左右分割キーボード（L/R）' : 'Split keyboard (L/R)'}
                    value={!!spec.splitKeyboard}
                    onChange={(v) => onChange(item.key, { splitKeyboard: v })}
                  />
                )}

                {armAskedKeys.has(item.key) && (
                  <ToggleRow
                    icon={<CategoryIcon category={armCategory} size={ROW_ICON_SIZE} color={categoryIconColor(armCategory, isDark)} />}
                    label={item.category === 'Monitor'
                      ? (ja ? 'モニターアームに載せる' : 'Mounted on a monitor arm')
                      : (ja ? 'マイクアームに載せる' : 'Mounted on a mic arm')}
                    value={!!spec.onArm}
                    onChange={(v) => onChange(item.key, { onArm: v })}
                  />
                )}
              </View>
            )
          })}
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: C.card, borderTopColor: C.border }]}>
          <Button
            title={confirmLabel ?? (ja ? 'この内容で作成' : 'Create with these details')}
            onPress={onConfirm}
            style={styles.confirm}
          />
        </View>
      </SafeAreaView>
    </Modal>
  )
}

// 項目が増えて文字だけでは目で拾いにくい。配線図の凡例と同じ絵を左に置き、どの口・どの分かれ方の行かを先に読ませる
const ROW_ICON_SIZE = 18

function RowLabel({ icon, label }: { icon: ReactNode; label: string }) {
  const { colors: C } = useApp()
  return (
    <View style={styles.rowHead}>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={[styles.rowLabel, { color: C.text }]}>{label}</Text>
    </View>
  )
}

// 機材詳細の PCタイプ・接続方式と同じ折りたたみを、このシートの行の見た目（左に絵と見出し）で持つ。
// 畳んでいるときは右に今の値を出し、押すと下に札が開く。札を見出しと並べると小さい端末で
// 折り返すので、開いたときだけ下に置く
function AccordionChoiceRow<T extends string>({ icon, label, options, value, onChange }: {
  icon: ReactNode
  label: string
  options: { value: T; label: string; icon?: (color: string) => ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  const { colors: C } = useApp()
  const [open, setOpen] = useState(false)
  const currentLabel = options.find((option) => option.value === value)?.label ?? ''
  return (
    <View style={[styles.choiceRow, { borderTopColor: C.separator }]}>
      <TouchableOpacity
        style={styles.choiceHeader}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}、${currentLabel}`}
      >
        <RowLabel icon={icon} label={label} />
        {!open && <Text style={[styles.choiceValue, { color: C.textMuted }]} numberOfLines={1}>{currentLabel}</Text>}
        <AppIcon name={open ? ICONS.chevronUp : ICONS.chevronDown} size={18} color={C.textMuted} />
      </TouchableOpacity>
      {open && (
        <View style={styles.choiceOptions}>
          {options.map((option) => {
            const active = option.value === value
            const color = active ? C.accentText : C.textSub
            return (
              <TouchableOpacity
                key={option.value}
                style={[styles.choiceChip, { borderColor: active ? C.accentIcon : C.border }, active && { backgroundColor: C.accent + '18' }]}
                onPress={() => onChange(option.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${label} ${option.label}`}
              >
                {option.icon?.(color)}
                <Text style={[styles.choiceChipText, { color }]}>{option.label}</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      )}
    </View>
  )
}

function ToggleRow({ icon, label, value, onChange }: { icon: ReactNode; label: string; value: boolean; onChange: (v: boolean) => void }) {
  const { colors: C } = useApp()
  return (
    <View style={[styles.row, { borderTopColor: C.separator }]}>
      <RowLabel icon={icon} label={label} />
      <ContrastToggle value={value} onValueChange={onChange} colors={C} accessibilityLabel={label} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontWeight: '700', flex: 1 },
  scroll: { padding: UI_METRICS.screenGutter, paddingBottom: 40 },
  lead: { fontSize: 12, lineHeight: 18, marginBottom: 14 },
  card: { borderRadius: UI_METRICS.cardRadius, paddingHorizontal: 14, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  cardIcon: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  cardTitleWrap: { flex: 1, gap: 1 },
  cardTitle: { fontSize: 14, fontWeight: '600' },
  cardProduct: { fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 52,
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  // 見出しの下に札を置く PC の形の行は縦並びなので、flex: 1（基準 0）だと高さが潰れる。伸び縮みだけ許す
  rowHead: { flexGrow: 1, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowIcon: { width: 22, alignItems: 'center' },
  rowLabel: { flex: 1, fontSize: 14 },
  // L/R の2択は見出しと同じ行の右端に置く。押せる幅は 1 つあたり touchMinSize を確保する
  choiceRow: { borderTopWidth: StyleSheet.hairlineWidth },
  choiceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingVertical: 4 },
  choiceValue: { fontSize: 14, flexShrink: 0 },
  choiceOptions: { flexDirection: 'row', gap: 8, paddingBottom: 12 },
  choiceChip: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: UI_METRICS.controlRadius,
    borderWidth: 1,
  },
  choiceChipText: { fontSize: 12, fontWeight: '500' },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  confirm: { width: '100%' },
})
