// 機材タブの「登録ケーブル」の節。
// マイデスク（WiringResultScreen）と他人のデスク（PublicDeskScreen）が共用する。
//
// 行の描き方だけ renderRow で受ける。持ち主の一覧はスワイプで外せる行、他人の一覧は
// 押すだけの行で、そこだけが違う。節の見出し・畳み方・ケーブルの2段組みは同じもの。
import type { ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { CATEGORY_COLORS, categoryIconColor, ICONS } from '../../constants/icons'
import { cableLabel, PORT_ICONS, portIconColor } from '../../constants/portTypes'
import { UI_METRICS } from '../../constants/ui'
import { AppColors } from '../../context/AppContext'
import type { CableTypeGroup } from '../../hooks/useDeskGadgetSections'
import { CableType, Gadget } from '../../types'

interface CommonProps {
  collapsed: boolean
  onToggleCollapsed: () => void
  colors: AppColors
  lang: 'ja' | 'en'
  isDark: boolean
  t: (key: string) => string
}

/** 登録ケーブルの節。「ケーブル → 種類 → 個別のケーブル」の3段 */
export function DeskCableSection({
  groups, totalCount, expandedTypes, onToggleType, renderRow, renderRows,
  collapsed, onToggleCollapsed, colors: C, lang, isDark, t,
}: CommonProps & {
  groups: CableTypeGroup[]
  totalCount: number
  expandedTypes: Set<CableType | '__unknown'>
  onToggleType: (type: CableType | '__unknown') => void
  renderRow: (gadget: Gadget) => ReactNode
  renderRows?: (gadgets: Gadget[]) => ReactNode
}) {
  const catColor = CATEGORY_COLORS.Cable ?? '#888888'
  return (
    <View style={styles.catSection}>
      <SectionHeader
        color={catColor}
        icon={<CategoryIcon category="Cable" size={18} color={categoryIconColor('Cable', isDark)} />}
        // ここに出るのはユーザーが登録したケーブルの本数。デスク一覧のバッジは
        // 配線から自動計算した必要本数で、別物なので語を分ける
        name={t('wiringResult.registeredCables')}
        count={lang === 'en' ? `${totalCount} ${totalCount === 1 ? 'cable' : 'cables'}` : `${totalCount}本`}
        label={t('wiringResult.registeredCables')}
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
        colors={C}
      />
      {!collapsed && groups.map(({ type, items, count }) => {
        const open = expandedTypes.has(type)
        const typeColor = type === '__unknown' ? C.textMuted : portIconColor(type, isDark)
        const typeName = type === '__unknown'
          ? (lang === 'ja' ? '種類未設定' : 'Unspecified')
          : cableLabel(type, lang)
        return (
          <View key={type}>
            <TouchableOpacity
              style={[styles.cableTypeRow, { borderBottomColor: C.border }]}
              onPress={() => onToggleType(type)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={typeName}
              accessibilityState={{ expanded: open }}
            >
              <AppIcon
                name={type !== '__unknown' && PORT_ICONS[type] ? PORT_ICONS[type] : 'cable-data'}
                size={17}
                color={typeColor}
              />
              <Text style={[styles.cableTypeName, { color: C.text }]} numberOfLines={1}>{typeName}</Text>
              <Text style={[styles.cableTypeCount, { color: C.textSub }]}>×{count}</Text>
              <AppIcon name={open ? ICONS.chevronDown : ICONS.chevronRight} size={16} color={C.textMuted} />
            </TouchableOpacity>
            {open && (renderRows ? renderRows(items) : items.map((g) => renderRow(g)))}
          </View>
        )
      })}
    </View>
  )
}

function SectionHeader({
  color, icon, name, count, label, collapsed, onToggle, colors: C,
}: {
  color: string
  icon: ReactNode
  name: string
  count: string
  label: string
  collapsed: boolean
  onToggle: () => void
  colors: AppColors
}) {
  return (
    <TouchableOpacity
      style={[styles.catHeader, { backgroundColor: color + '18', borderLeftColor: color }]}
      onPress={onToggle}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: !collapsed }}
    >
      <View style={[styles.catHeaderIcon, { backgroundColor: C.chip }]}>{icon}</View>
      <Text style={[styles.catHeaderName, { color: C.text }]}>{name}</Text>
      <Text style={[styles.catHeaderCount, { color: C.textMuted }]}>{count}</Text>
      <AppIcon name={collapsed ? ICONS.chevronRight : ICONS.chevronDown} size={16} color={C.textMuted} />
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  catSection: { marginBottom: 12 },
  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // 一覧は左右いっぱいに敷く（WiringResultScreen の tabContent の注記）。角を丸めると画面の端で欠けて見える
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingVertical: 8,
    borderLeftWidth: 3,
    marginBottom: 2,
  },
  // アイコンの器は「幅の約1/4」（design.md）
  catHeaderIcon: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  catHeaderName: { fontSize: 13, fontWeight: '700', flex: 1 },
  catHeaderCount: { fontSize: 12, fontWeight: '600', opacity: 0.8 },
  cableTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: UI_METRICS.screenGutter,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  cableTypeName: { fontSize: 12, fontWeight: '700', flex: 1 },
  cableTypeCount: { fontSize: 12, fontWeight: '800', flexShrink: 0 },
})
