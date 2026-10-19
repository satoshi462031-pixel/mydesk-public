import { useEffect, useMemo, useState } from 'react'
import { useToday } from '../../hooks/useToday'
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { Button } from '../atoms/Button'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { SearchField } from '../atoms/SearchField'
import { TextField } from '../atoms/TextField'
import { ContrastToggle } from '../atoms/ContrastToggle'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { DateField } from '../molecules/DateField'
import { ICONS, categoryIconColor } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { Gadget } from '../../types'
import { gadgetGenreLabel, gadgetTitle } from '../../utils/localizedGadgetName'
import { sanitizeNumericInput } from '../../utils/numericInput'
import { matchesSearchTerms, normalizeGadgetSearch, searchTerms } from '../../utils/gadgetSearch'

type Colors = {
  card: string
  bgList: string
  chip: string
  border: string
  input: string
  inputBorder: string
  text: string
  textSub: string
  textMuted: string
  accent: string
  accentIcon: string
  accentText: string
  onAccent: string
  danger: string
}

type Props = {
  visible: boolean
  source: Gadget | null
  target: Gadget | null
  candidates: Gadget[]
  exchangeDate: string
  dateError?: string
  price: string
  priceError?: string
  supportArmName?: string
  supportKind?: 'monitor' | 'microphone'
  inheritSupportArm: boolean
  relatedSettingCount: number
  inheritRelatedSettings: boolean
  saving: boolean
  colors: Colors
  isDark: boolean
  lang: 'ja' | 'en'
  onClose: () => void
  onSelect: (gadget: Gadget) => void
  onBack: () => void
  onRegisterNew: () => void
  onChangeDate: (value: string) => void
  onChangePrice: (value: string) => void
  onChangeInheritSupportArm: (value: boolean) => void
  onChangeInheritRelatedSettings: (value: boolean) => void
  onConfirm: () => void
}

export function GadgetReplacementModal({
  visible,
  source,
  target,
  candidates,
  exchangeDate,
  dateError,
  price,
  priceError,
  supportArmName,
  supportKind,
  inheritSupportArm,
  relatedSettingCount,
  inheritRelatedSettings,
  saving,
  colors: C,
  isDark,
  lang,
  onClose,
  onSelect,
  onBack,
  onRegisterNew,
  onChangeDate,
  onChangePrice,
  onChangeInheritSupportArm,
  onChangeInheritRelatedSettings,
  onConfirm,
}: Props) {
  const [query, setQuery] = useState('')
  const today = useToday()
  useEffect(() => {
    if (visible) setQuery('')
  }, [visible, source?.id])

  const filtered = useMemo(() => {
    // マイガジェットの検索と同じ当て方（全角・半角、空白・改行の混ざり、語の順番を問わない）
    const terms = searchTerms(normalizeGadgetSearch(query))
    if (terms.length === 0) return candidates
    return candidates.filter((gadget) => matchesSearchTerms(normalizeGadgetSearch(gadgetTitle(gadget, lang)), terms))
  }, [candidates, lang, query])

  if (!source) return null

  const title = lang === 'en' ? 'Replace gadget' : '商品を交換'
  const sourceName = gadgetTitle(source, lang)

  return (
    <BottomSheetModal visible={visible} onDismiss={onClose} sheetStyle={styles.sheet} avoidKeyboard>
          <View style={[styles.header, { borderBottomColor: C.border }]}>
            {target ? (
              <TouchableOpacity onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={lang === 'en' ? 'Back to gadget selection' : '交換する商品の選択へ戻る'}>
                <AppIcon name={ICONS.chevronLeft} size={24} color={C.text} />
              </TouchableOpacity>
            ) : <View style={styles.headerSpacer} />}
            <Text style={[styles.title, { color: C.text }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={lang === 'en' ? 'Close' : '閉じる'}>
              <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
            </TouchableOpacity>
          </View>

          {target ? (
            <ScrollView contentContainerStyle={styles.confirmContent} keyboardShouldPersistTaps="handled">
              <Text style={[styles.lead, { color: C.textMuted }]}>
                {lang === 'en' ? 'Confirm the replacement details.' : '交換内容を確認してください。'}
              </Text>
              <View style={styles.swapRow}>
                <GadgetCard gadget={source} colors={C} isDark={isDark} lang={lang} />
                <AppIcon name="arrow-right" size={22} color={C.textMuted} />
                <GadgetCard gadget={target} colors={C} isDark={isDark} lang={lang} />
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: C.text }]}>{lang === 'en' ? 'Introduced to this desk' : 'このデスクへの導入日'}</Text>
                <DateField
                  invalid={!!dateError}
                  value={exchangeDate}
                  onChange={onChangeDate}
                  clearable={false}
                  // 未来の日付は入れ替えに使えない（WiringResultScreen の検証と同じ）
                  maximumDate={today}
                  label={lang === 'en' ? 'Introduced to this desk' : 'このデスクへの導入日'}
                />
                {!!dateError && <Text style={[styles.error, { color: C.danger }]}>{dateError}</Text>}
                <Text style={[styles.fieldNote, { color: C.textMuted }]}>
                  {lang === 'en'
                    ? 'The previous gadget will be retired on the same date.'
                    : '交換前の機材も同じ日付で引退になります'}
                </Text>
              </View>

              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: C.text }]}>{lang === 'en' ? 'Price (USD)' : '金額（円）'}</Text>
                <TextField
                  invalid={!!priceError}
                  value={price}
                  onChangeText={(value) => onChangePrice(sanitizeNumericInput(value))}
                  placeholder={lang === 'en' ? 'e.g. 299.99' : '例：49,800'}
                  keyboardType="decimal-pad"
                  maxLength={14}
                  accessibilityLabel={lang === 'en' ? 'Gadget price in US dollars' : '商品の金額（円）'}
                />
                {!!priceError && <Text style={[styles.error, { color: C.danger }]}>{priceError}</Text>}
                <Text style={[styles.fieldNote, { color: C.textMuted }]}>
                  {lang === 'en'
                    ? 'This updates the gadget price everywhere it is used.'
                    : 'この商品の金額として、ほかのデスクにも反映されます'}
                </Text>
              </View>

              <View style={[styles.inheritBox, { backgroundColor: C.bgList }]}>
                <InfoLine text={lang === 'en' ? 'Keep the current position' : '現在の配置を引き継ぐ'} color={C.text} accent={C.accentIcon} />
                <InfoLine text={lang === 'en' ? 'Recalculate wiring for the new ports' : '新商品の端子に合わせて配線を再計算'} color={C.text} accent={C.accentIcon} />
              </View>

              {!!supportArmName && (
                <View style={[styles.armOption, { borderColor: C.border }]}>
                  <View style={styles.armOptionText}>
                    <Text style={[styles.armOptionTitle, { color: C.text }]}>
                      {supportKind === 'microphone'
                        ? (lang === 'en' ? 'Keep microphone arm' : 'マイクアームを引き継ぐ')
                        : (lang === 'en' ? 'Keep monitor arm' : 'モニターアームを引き継ぐ')}
                    </Text>
                    <Text style={[styles.armOptionNote, { color: C.textMuted }]} numberOfLines={2}>
                      {inheritSupportArm
                        ? supportArmName
                        : supportKind === 'microphone'
                          ? (lang === 'en' ? 'The new microphone will use its stand.' : '新しいマイクはスタンド使用になります')
                          : (lang === 'en' ? 'The new monitor will use its stand.' : '新しいモニターはスタンド使用になります')}
                    </Text>
                  </View>
                  <ContrastToggle
                    value={inheritSupportArm}
                    onValueChange={onChangeInheritSupportArm}
                    colors={C}
                    accessibilityLabel={supportKind === 'microphone'
                      ? (lang === 'en' ? 'Keep microphone arm' : 'マイクアームを引き継ぐ')
                      : (lang === 'en' ? 'Keep monitor arm' : 'モニターアームを引き継ぐ')}
                  />
                </View>
              )}

              {relatedSettingCount > 0 && (
                <View style={[styles.armOption, { borderColor: C.border }]}>
                  <View style={styles.armOptionText}>
                    <Text style={[styles.armOptionTitle, { color: C.text }]}>
                      {lang === 'en' ? 'Keep attached-device settings' : '取り付け・接続設定を引き継ぐ'}
                    </Text>
                    <Text style={[styles.armOptionNote, { color: C.textMuted }]} numberOfLines={2}>
                      {inheritRelatedSettings
                        ? (lang === 'en' ? `${relatedSettingCount} settings will move on this desk.` : `このデスクの設定${relatedSettingCount}件を交換先へ移します`)
                        : (lang === 'en' ? 'The new gadget will use its own settings.' : '交換先の商品自身の設定を使用します')}
                    </Text>
                  </View>
                  <ContrastToggle
                    value={inheritRelatedSettings}
                    onValueChange={onChangeInheritRelatedSettings}
                    colors={C}
                    accessibilityLabel={lang === 'en' ? 'Keep attached-device settings' : '取り付け・接続設定を引き継ぐ'}
                  />
                </View>
              )}

              <Button
                title={lang === 'en' ? 'Replace' : '交換する'}
                leading={<AppIcon name="swap-horizontal" size={20} color={C.onAccent} />}
                shape="control"
                onPress={onConfirm}
                disabled={!!dateError || !!priceError || saving}
                loading={saving}
              />
            </ScrollView>
          ) : (
            <View style={styles.pickContent}>
              <Text style={[styles.lead, { color: C.textMuted }]}>
                {lang === 'en' ? `Choose a replacement for “${sourceName}”.` : `「${sourceName}」と交換する商品を選びます。`}
              </Text>
              <TouchableOpacity
                style={[styles.registerButton, { borderColor: C.accentIcon, backgroundColor: C.accent + '12' }]}
                onPress={onRegisterNew}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <View style={[styles.registerIcon, { backgroundColor: C.accent }]}>
                  <AppIcon name={ICONS.add} size={18} color={C.onAccent} />
                </View>
                <View style={styles.registerText}>
                  <Text style={[styles.registerTitle, { color: C.accentText }]}>{lang === 'en' ? 'Register a new product' : '新しい商品を登録'}</Text>
                  <Text style={[styles.registerNote, { color: C.textMuted }]}>{lang === 'en' ? 'Return here after registration' : '登録後に交換確認へ戻ります'}</Text>
                </View>
                <AppIcon name={ICONS.chevronRight} size={20} color={C.accentIcon} />
              </TouchableOpacity>

              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: C.text }]}>{lang === 'en' ? 'Choose from My Gadgets' : 'マイガジェットから選ぶ'}</Text>
                <Text style={[styles.count, { color: C.textMuted }]}>{candidates.length}</Text>
              </View>
              {candidates.length > 6 && (
                <SearchField
                    containerStyle={styles.search}
                    value={query}
                    onChangeText={setQuery}
                    placeholder={lang === 'en' ? 'Search gadgets' : '商品を検索'}
                />
              )}
              <ScrollView style={styles.candidateList} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {filtered.map((gadget) => (
                  <TouchableOpacity
                    key={gadget.id}
                    style={[styles.candidateRow, { borderBottomColor: C.border }]}
                    onPress={() => onSelect(gadget)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                  >
                    <View style={[styles.categoryIcon, { backgroundColor: C.chip }]}>
                      <CategoryIcon
                        category={gadget.category}
                        pcFormFactor={gadget.pcFormFactor}
                        customIcon={gadget.customCategory?.icon}
                        size={18}
                        color={categoryIconColor(gadget.category, isDark, undefined, gadget.customCategory?.color)}
                      />
                    </View>
                    <View style={styles.candidateText}>
                      <Text style={[styles.candidateName, { color: C.text }]} numberOfLines={2}>{gadgetTitle(gadget, lang)}</Text>
                      {!!gadgetGenreLabel(gadget, lang) && (
                        <Text style={[styles.genre, { color: C.textMuted }]} numberOfLines={1}>{gadgetGenreLabel(gadget, lang)}</Text>
                      )}
                    </View>
                    <AppIcon name={ICONS.chevronRight} size={18} color={C.textMuted} />
                  </TouchableOpacity>
                ))}
                {filtered.length === 0 && (
                  <View style={styles.empty}>
                    <Text style={[styles.emptyText, { color: C.textMuted }]}>
                      {lang === 'en' ? 'No registered replacements found.' : '交換できる登録済み商品がありません'}
                    </Text>
                  </View>
                )}
              </ScrollView>
            </View>
          )}
    </BottomSheetModal>
  )
}

function GadgetCard({ gadget, colors: C, isDark, lang }: { gadget: Gadget; colors: Colors; isDark: boolean; lang: 'ja' | 'en' }) {
  return (
    <View style={[styles.gadgetCard, { backgroundColor: C.bgList, borderColor: C.border }]}>
      <CategoryIcon
        category={gadget.category}
        pcFormFactor={gadget.pcFormFactor}
        customIcon={gadget.customCategory?.icon}
        size={24}
        color={categoryIconColor(gadget.category, isDark, undefined, gadget.customCategory?.color)}
      />
      <Text style={[styles.gadgetCardName, { color: C.text }]} numberOfLines={3}>{gadgetTitle(gadget, lang)}</Text>
      {!!gadgetGenreLabel(gadget, lang) && (
        <Text style={[styles.genre, styles.gadgetCardGenre, { color: C.textMuted }]} numberOfLines={1}>{gadgetGenreLabel(gadget, lang)}</Text>
      )}
    </View>
  )
}

function InfoLine({ text, color, accent }: { text: string; color: string; accent: string }) {
  return (
    <View style={styles.infoLine}>
      <AppIcon name="check-circle-outline" size={18} color={accent} />
      <Text style={[styles.infoText, { color }]}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: { maxHeight: '86%', paddingHorizontal: 0 },
  header: { minHeight: 56, paddingHorizontal: UI_METRICS.sheetGutter, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSpacer: { width: 24 },
  title: { fontSize: 17, fontWeight: '800' },
  pickContent: { paddingHorizontal: UI_METRICS.screenGutter, paddingTop: 16 },
  confirmContent: { padding: UI_METRICS.screenGutter, gap: 18 },
  lead: { fontSize: 13, lineHeight: 19 },
  registerButton: { minHeight: 64, marginTop: 16, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: UI_METRICS.panelRadius, flexDirection: 'row', alignItems: 'center', gap: 10 },
  registerIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  registerText: { flex: 1 },
  registerTitle: { fontSize: 14, fontWeight: '800' },
  registerNote: { fontSize: 11, marginTop: 2 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '800', flex: 1 },
  count: { fontSize: 12, fontWeight: '700' },
  search: { marginBottom: 4 },
  candidateList: { maxHeight: 330 },
  candidateRow: { minHeight: 58, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 10 },
  categoryIcon: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  candidateText: { flex: 1, minWidth: 0 },
  candidateName: { fontSize: 14, lineHeight: 19, fontWeight: '600' },
  // 見出しが商品名になるとジャンルが絵だけになるので、名前の下に添える
  genre: { fontSize: 12, marginTop: 1 },
  gadgetCardGenre: { textAlign: 'center' },
  empty: { minHeight: 100, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 13 },
  swapRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  gadgetCard: { flex: 1, minHeight: 112, borderWidth: 1, borderRadius: UI_METRICS.panelRadius, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 9 },
  gadgetCardName: { fontSize: 13, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  field: { gap: 7 },
  fieldLabel: { fontSize: 13, fontWeight: '700' },
  error: { fontSize: 12, lineHeight: 17 },
  fieldNote: { fontSize: 11, lineHeight: 16 },
  inheritBox: { borderRadius: UI_METRICS.panelRadius, padding: 13, gap: 10 },
  infoLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  armOption: { minHeight: 62, borderWidth: 1, borderRadius: UI_METRICS.panelRadius, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  armOptionText: { flex: 1 },
  armOptionTitle: { fontSize: 13, fontWeight: '700' },
  armOptionNote: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  disabled: { opacity: 0.45 },
})
