import { useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { ClapMark } from '../atoms/ClapMark'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { ICONS, MCIconName } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'
import { useApp } from '../../context/AppContext'

export type HelpItem = { icon: MCIconName; ja: string; en: string; badge?: 'updateLabel' }
export type HelpSection = { id: string; ja: string; en: string; items: HelpItem[] }
type Props = {
  visible: boolean
  onDismiss: () => void
  sections: HelpSection[]
  initialSection?: string
  title?: { ja: string; en: string }
}

export function ScreenHelpSheet({ visible, onDismiss, sections, initialSection, title }: Props) {
  const { colors: C, lang } = useApp()
  const ja = lang === 'ja'
  const firstSection = initialSection ?? sections[0]?.id
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => {
    if (visible) setExpanded(firstSection ?? null)
  }, [visible, firstSection])
  return (
    <BottomSheetModal visible={visible} onDismiss={onDismiss} sheetStyle={styles.sheet}>
      <View style={[styles.header, { borderBottomColor: C.border }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: C.text }]}>{title ? title[lang] : (ja ? 'この画面の見方' : 'Understanding this screen')}</Text>
        <TouchableOpacity onPress={onDismiss} style={styles.close} accessibilityRole="button" accessibilityLabel={ja ? '閉じる' : 'Close'}>
          <AppIcon name={ICONS.close} size={22} color={C.textMuted} />
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {sections.map((section) => (
          <View key={section.id} style={[styles.section, { borderColor: C.border }]}>
            <TouchableOpacity style={styles.sectionHeader} onPress={() => setExpanded(expanded === section.id ? null : section.id)} accessibilityRole="button" accessibilityState={{ expanded: expanded === section.id }}>
              <Text style={[styles.sectionTitle, { color: C.text }]}>{ja ? section.ja : section.en}</Text>
              <AppIcon name={expanded === section.id ? ICONS.chevronDown : ICONS.chevronRight} size={20} color={C.textMuted} />
            </TouchableOpacity>
            {expanded === section.id && section.items.map((item, index) => (
              <View key={index} style={styles.item}>
                <View style={styles.symbol} accessible={false}>
                  {item.badge === 'updateLabel' ? (
                    // 一覧のタイルの日付の行に出る「新着」（DeskGridTile の discoveryUpdate）と同じ見た目
                    <Text style={[styles.updateLabel, { color: C.accentText }]}>{ja ? '新着' : 'New'}</Text>
                  ) : item.icon === ICONS.clap ? <ClapMark clapped diameter={28} color={C.textMuted} /> : <AppIcon name={item.icon} size={22} color={item.icon === ICONS.starFilled ? C.favorite : C.textMuted} />}
                </View>
                <Text style={[styles.body, { color: C.textSub }]}>{ja ? item.ja : item.en}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </BottomSheetModal>
  )
}
const styles = StyleSheet.create({
  sheet: { maxHeight: '86%', paddingHorizontal: 0, paddingBottom: 0 },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: UI_METRICS.sheetGutter, paddingRight: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: '700' },
  close: { width: UI_METRICS.touchMinSize, height: UI_METRICS.touchMinSize, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexShrink: 1 },
  content: { padding: UI_METRICS.sheetGutter, paddingBottom: UI_METRICS.sheetBottom, gap: 12 },
  section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: UI_METRICS.controlRadius },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8, minHeight: UI_METRICS.touchMinSize },
  sectionTitle: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  item: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingBottom: 16 },
  symbol: { width: 60, alignItems: 'center', paddingTop: 2 },
  body: { flex: 1, fontSize: 13, lineHeight: 21 },
  updateLabel: { fontSize: 13, lineHeight: 21, fontWeight: '700' },
})
