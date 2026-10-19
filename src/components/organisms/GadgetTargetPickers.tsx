// ガジェットのフォームで「相手」を選ぶ2つのピッカー。
// 詳細（GadgetDetailScreen）で使う（以前は追加画面にも同じ実装があった）。
import { useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { statusTextColor, UI_METRICS } from '../../constants/ui'
import { AppColors, useApp } from '../../context/AppContext'
import { Gadget, GadgetCategory } from '../../types'
import { gadgetGenreLabel, localizedGadgetName } from '../../utils/localizedGadgetName'
import { SelectField } from '../molecules/SelectField'

// コントローラー・イヤホン等、大元のガジェットがないと機能しない周辺機器の接続先ピッカー
// ホストになりうるカテゴリを先頭に並べて選択を速くする
const HOST_CATEGORY_ORDER: GadgetCategory[] = ['PC', 'GameConsole', 'Dock', 'Hub', 'Smartphone', 'Tablet']

export function ConnectTargetPicker({
  allGadgets, excludeId, value, onChange, colors: C, lang,
}: {
  allGadgets: Gadget[]
  excludeId?: string
  value: string | null
  onChange: (id: string | null) => void
  colors: AppColors
  lang: 'ja' | 'en'
}) {
  const candidates = allGadgets
    .filter((g) => g.id !== excludeId)
    .sort((a, b) => {
      const ia = HOST_CATEGORY_ORDER.indexOf(a.category), ib = HOST_CATEGORY_ORDER.indexOf(b.category)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
  if (candidates.length === 0) {
    return (
      <Text style={[styles.wirelessEmpty, { color: C.textMuted }]}>
        {lang === 'ja' ? 'このデスクに接続先にできるガジェットがありません' : 'No gadgets in this desk are available to connect to'}
      </Text>
    )
  }
  // 候補はデスクの台数ぶん増えるので、横スクロールのチップではなく一覧から選ぶ。
  // 商品名を入れた機材は名前がジャンルを表さないので、ジャンル名を添える
  return (
    <SelectField
      title={lang === 'ja' ? '接続先' : 'Connected to'}
      options={[
        { key: '', label: lang === 'ja' ? '自動' : 'Auto' },
        ...candidates.map((g) => ({
          key: g.id,
          label: localizedGadgetName(g, lang),
          help: gadgetGenreLabel(g, lang) || undefined,
        })),
      ]}
      value={value ?? ''}
      onChange={(id) => onChange(id || null)}
    />
  )
}

const WIRELESS_CAPABLE_CATS: GadgetCategory[] = ['Smartphone', 'Tablet', 'Smartwatch', 'Headphone', 'Earphone', 'Mouse', 'SmallDevice']

export function WirelessGadgetPicker({
  allGadgets,
  value,
  onChange,
  maxCount,
  colors: C,
  lang,
}: {
  allGadgets: Gadget[]
  value: string[]
  onChange: (ids: string[]) => void
  maxCount: number
  colors: AppColors
  lang: 'ja' | 'en'
}) {
  const { isDark, t } = useApp()
  const selectedIdsRef = useRef(value)
  selectedIdsRef.current = value
  const [openCats, setOpenCats] = useState<ReadonlySet<GadgetCategory>>(new Set())
  const grouped = WIRELESS_CAPABLE_CATS
    .map((cat) => ({ cat, gadgets: allGadgets.filter((g) => g.category === cat) }))
    .filter(({ gadgets }) => gadgets.length > 0)

  const toggle = (id: string) => {
    const current = selectedIdsRef.current
    const next = current.includes(id) ? current.filter((x) => x !== id)
      : current.length < maxCount ? [...current, id] : current
    if (next === current) return
    selectedIdsRef.current = next
    onChange(next)
  }

  if (grouped.length === 0) {
    return (
      <Text style={[styles.wirelessEmpty, { color: C.textMuted }]}>
        {lang === 'ja'
          ? 'ライブラリにワイヤレス充電対応ガジェットがありません'
          : 'No wireless-chargeable gadgets in library'}
      </Text>
    )
  }

  return (
    <View style={styles.wirelessGadgetList}>
      <Text style={[styles.wirelessCountHint, { color: C.textMuted }]}>
        {lang === 'ja'
          ? `${maxCount}台まで選択できます`
          : `You can select up to ${maxCount}`}
      </Text>
      {grouped.map(({ cat, gadgets }) => {
        // 持ち物のうち対応する機材を全部並べるので、持ち物が多いほど長くなる。ジャンルごとに畳み、
        // 閉じていても選んだ台数は見出しに出す（みんなのデスクの絞り込みのジャンルと同じ形）。
        // ジャンルが1つだけなら畳んでも短くならないので、開いたままにする
        const open = grouped.length === 1 || openCats.has(cat)
        const selectedCount = gadgets.filter((g) => value.includes(g.id)).length
        const categoryLabel = t('category.' + cat)
        return (
        <View key={cat} style={styles.wirelessCatGroup}>
          <TouchableOpacity
            style={[styles.wirelessCatHeader, { borderBottomColor: C.border }]}
            onPress={() => setOpenCats((prev) => {
              const next = new Set(prev)
              if (next.has(cat)) next.delete(cat)
              else next.add(cat)
              return next
            })}
            disabled={grouped.length === 1}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={selectedCount > 0
              ? `${categoryLabel}、${lang === 'ja' ? `${selectedCount}台選択中` : `${selectedCount} selected`}`
              : categoryLabel}
          >
            <CategoryIcon category={cat} size={13} color={categoryIconColor(cat, isDark)} />
            <Text style={[styles.wirelessCatLabel, { color: C.textSub }]}>
              {categoryLabel}
            </Text>
            {!open && selectedCount > 0 && (
              <Text style={[styles.wirelessCatSelected, { color: C.textMuted }]}>
                {lang === 'ja' ? `${selectedCount}台選択中` : `${selectedCount} selected`}
              </Text>
            )}
            {grouped.length > 1 && (
              <AppIcon name={open ? ICONS.chevronUp : ICONS.chevronDown} size={16} color={C.textMuted} />
            )}
          </TouchableOpacity>
          {open && gadgets.map((g) => {
            const on = value.includes(g.id)
            const disabled = !on && value.length >= maxCount
            return (
              <TouchableOpacity
                key={g.id}
                style={[styles.wirelessGadgetRow, { borderBottomColor: C.border, opacity: disabled ? 0.35 : 1 }]}
                onPress={() => toggle(g.id)}
                disabled={disabled}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled }}
                accessibilityLabel={localizedGadgetName(g, lang)}
                activeOpacity={disabled ? 1 : 0.7}
              >
                <View style={[styles.wirelessGadgetIcon, { backgroundColor: C.chip }]}>
                  <CategoryIcon category={g.category} pcFormFactor={g.pcFormFactor} customIcon={g.customCategory?.icon} size={16} color={categoryIconColor(g.category, isDark, undefined, g.customCategory?.color)} />
                </View>
                <Text style={[styles.wirelessGadgetName, { color: C.text }]} numberOfLines={1}>{localizedGadgetName(g, lang)}</Text>
                <AppIcon
                  name={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={20}
                  color={on ? statusTextColor('success', isDark) : C.textMuted}
                />
              </TouchableOpacity>
            )
          })}
        </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wirelessGadgetList: { marginBottom: 4 },
  wirelessCountHint: { fontSize: 12, marginBottom: 8 },
  wirelessEmpty: { fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  wirelessCatGroup: { marginBottom: 4 },
  // 押して開閉するので、押せる高さは touchMinSize を取る
  wirelessCatHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: UI_METRICS.touchMinSize, marginBottom: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  wirelessCatLabel: { fontSize: 12, fontWeight: '600', flex: 1 },
  wirelessCatSelected: { fontSize: 12 },
  wirelessGadgetRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  // アイコンの器は「幅の約1/4」（design.md）
  wirelessGadgetIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  wirelessGadgetName: { flex: 1, fontSize: 14 },
})
