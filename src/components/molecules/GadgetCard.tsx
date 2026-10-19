import React from 'react'
import { GestureResponderEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { CATEGORY_LABELS, CATEGORY_LABELS_EN } from '../../constants/categoryLabels'
import { customCategoryOf } from '../../utils/customCategory'
import { ICONS, categoryBaseColor, categoryIconColor } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { Gadget, GadgetCategory } from '../../types'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { FavoriteGadgetMark } from '../atoms/FavoriteGadgetMark'
import { PRESS_INTERACTION, UI_METRICS } from '../../constants/ui'
import { localizedGadgetName } from '../../utils/localizedGadgetName'
import { notOwnedBadge } from '../../utils/gadgetStats'
import { useLongPressGuard } from '../../hooks/useLongPressGuard'


interface Props {
  gadget: Gadget
  // 対象を引数で受け取る形にして、呼び出し側が useCallback で安定した関数を
  // 渡せるようにする（毎行インライン関数だと React.memo が効かないため）
  onPress?: (gadget: Gadget) => void
  onLongPress?: (gadget: Gadget) => void
  checked?: boolean
  onToggle?: (gadget: Gadget) => void
  interactive?: boolean
  // マイガジェット一覧用。2行目を所属プラン名にし、商品名が未入力の行（テンプレートで
  // 作られた枠のまま）は1行目をジャンル名にする。「商品名未設定」はデスクの機材タブと同じく出さない。
  // 1行目を「商品名未設定」にすると、作成直後の持ち物が全行同じ見出しになって見分けが付かない
  planLabel?: string
  usagePeriodLabel?: string
  // 撤去済み（どのデスクにも今は無く、在籍していた記録が残っている）。
  // 持ち物としては残しているので一覧からは消さず、見た目で区別できるようにする
  retired?: boolean
  favorite?: boolean
}

function getPortSummary(gadget: Gadget, lang?: 'ja' | 'en'): string | null {
  const sum = (type: string, dir?: string) =>
    gadget.ports
      .filter((p) => p.type === type && (dir == null || p.direction === dir))
      .reduce((s, p) => s + p.count, 0)

  switch (gadget.category as GadgetCategory) {
    case 'TV':
    case 'Projector':
    case 'Monitor': {
      const hdmi = sum('HDMI')
      const dp   = sum('DisplayPort')
      const usbc = sum('USB_C')
      const parts = [
        hdmi  && `HDMI×${hdmi}`,
        dp    && `DP×${dp}`,
        usbc  && `C×${usbc}`,
      ].filter(Boolean)
      return parts.join('  ') || null
    }
    case 'Charger': {
      const usbC = sum('USB_C', 'output')
      const usbA = sum('USB_A', 'output')
      const parts = [
        usbC   && `C×${usbC}`,
        usbA   && `A×${usbA}`,
      ].filter(Boolean)
      return parts.join('  ') || null
    }
    case 'Hub':
    case 'Dock': {
      const usbC = sum('USB_C')
      const usbA = sum('USB_A')
      const hdmi = sum('HDMI')
      const dp   = sum('DisplayPort')
      const parts = [
        usbC && `C×${usbC}`,
        usbA && `A×${usbA}`,
        hdmi && `HDMI×${hdmi}`,
        dp   && `DP×${dp}`,
      ].filter(Boolean)
      return parts.join('  ') || null
    }
    case 'PowerStrip': {
      const outlets = sum('Power', 'output')
      return outlets ? (lang === 'en' ? `${outlets} AC outlet${outlets > 1 ? 's' : ''}` : `コンセント×${outlets}`) : null
    }
    default:
      return null
  }
}

// 一覧は数十件になりうるので、親の再レンダーで全行が作り直されないよう memo 化する
export const GadgetCard = React.memo(function GadgetCard({ gadget, onPress, onLongPress, checked, onToggle, interactive = true, planLabel, usagePeriodLabel, retired, favorite }: Props) {
  const isSelectable = onToggle !== undefined
  const { colors, isDark, lang } = useApp()
  const { accent } = colors
  const catColor    = categoryBaseColor(gadget.category, gadget.customCategory?.color, '#757575')
  // 中立面向けの補正なので、アイコンの背景にもカテゴリ色を重ねない。
  const iconColor   = categoryIconColor(gadget.category, isDark, undefined, gadget.customCategory?.color)
  const portSummary = getPortSummary(gadget, lang)
  const displayName = localizedGadgetName(gadget, lang)
  const categoryLabel = customCategoryOf(gadget)?.name ?? (lang === 'en' ? CATEGORY_LABELS_EN : CATEGORY_LABELS)[gadget.category]

  // テンプレートの枠のまま（isPlaceholder）＝ name はジャンル名なので商品名としては未入力扱い。
  // 枠を編集して名前を空で保存した場合も同じ
  const unnamed = planLabel !== undefined && (!!gadget.isPlaceholder || !gadget.name.trim())
  // 「商品名未設定」は印でも出さない（デスクの機材タブと揃える）。候補の印だけ残す
  const notOwned = unnamed && !gadget.isCandidate ? undefined : notOwnedBadge(gadget, lang)

  // 購入日はガジェット選択時とマイガジェット一覧で右下に出す
  const showPurchasedAt = usagePeriodLabel === undefined && (isSelectable || planLabel !== undefined) && !!gadget.purchasedAt
  const showUnknownDate = usagePeriodLabel === undefined && (isSelectable || planLabel !== undefined) && !showPurchasedAt && gadget.introducedAtUnknown
  const guardedPress = useLongPressGuard<GestureResponderEvent>(
    () => (isSelectable ? onToggle?.(gadget) : onPress?.(gadget)),
    onLongPress ? () => onLongPress(gadget) : undefined,
  )

  const checkedBg = accent + '18'

  return (
    <TouchableOpacity
      style={[styles.card, {
        backgroundColor: colors.card,
        borderColor:     isSelectable ? (checked ? colors.accentIcon : colors.border) : 'transparent',
      }]}
      onPressIn={guardedPress.beginPress}
      onPress={guardedPress.onPress}
      onLongPress={guardedPress.onLongPress}
      delayLongPress={PRESS_INTERACTION.longPressDelay}
      disabled={!interactive}
      activeOpacity={0.8}
      accessibilityRole={interactive ? (isSelectable ? 'checkbox' : 'button') : undefined}
      accessibilityLabel={`${displayName || (lang === 'en' ? 'Gadget with no product name' : '商品名未設定のガジェット')}${favorite ? (lang === 'en' ? ', favorite' : '、お気に入り') : ''}${gadget.disposedAt ? (lang === 'en' ? ', disposed' : '、処分済み') : ''}${usagePeriodLabel !== undefined ? `、${planLabel ?? ''}、${usagePeriodLabel}` : ''}`}
      accessibilityHint={onLongPress ? (lang === 'en' ? 'Press and hold to select multiple items' : '長押しすると複数選択できます') : undefined}
      accessibilityState={isSelectable ? { checked: !!checked } : undefined}
    >
      {/* リストの地へ直接重ねると日付が薄くなるため、card の上に選択色を敷く。 */}
      {isSelectable && checked && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: checkedBg, borderRadius: UI_METRICS.cardRadius }]} />
      )}
      <View style={styles.row}>
        <View style={[styles.iconWrap, { backgroundColor: colors.chip }]}>
          <CategoryIcon category={gadget.category} pcFormFactor={gadget.pcFormFactor} customIcon={gadget.customCategory?.icon} size={22} color={iconColor} />
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: retired ? colors.textMuted : colors.text }]}>
              {unnamed ? categoryLabel : displayName}
            </Text>
            {favorite && <FavoriteGadgetMark color={colors.favorite} />}
            {!!gadget.disposedAt && (
              <View style={[styles.displayBadge, styles.disposedBadge, { backgroundColor: colors.chip }]}>
                <AppIcon name="package-variant-closed-remove" size={14} color={colors.textMuted} />
                <Text style={[styles.displayBadgeText, { color: colors.textMuted }]}>{lang === 'en' ? 'Disposed' : '処分済み'}</Text>
              </View>
            )}
            {retired && (
              // 「飾り」がカテゴリ色なのに対しこちらは中立色。状態が消えていることを
              // 色で示すので、カテゴリの識別色と取り違えられないようにする
              <View style={[styles.displayBadge, { backgroundColor: colors.chip }]}>
                <Text style={[styles.displayBadgeText, { color: colors.textMuted }]}>
                  {lang === 'en' ? 'Retired' : '撤去済み'}
                </Text>
              </View>
            )}
            {notOwned && (
              <View style={[styles.displayBadge, { backgroundColor: colors.chip }]}>
                <Text style={[styles.displayBadgeText, { color: colors.textSub }]}>
                  {notOwned}
                </Text>
              </View>
            )}
            {gadget.displayOnly && (
              <View style={[styles.displayBadge, { backgroundColor: catColor + '22' }]}>
                <Text style={[styles.displayBadgeText, { color: colors.text }]}>
                  {lang === 'en' ? 'Decor' : '飾り'}
                </Text>
              </View>
            )}
          </View>
          {/* 右下の購入日と重ならないよう、日付があるぶんだけ右を空けて省略させる */}
          <Text
            style={[styles.brand, showPurchasedAt && styles.brandWithDate, showUnknownDate && { paddingRight: lang === 'en' ? 90 : 62 }, { color: colors.textMuted }]}
            numberOfLines={1}
          >
            {planLabel !== undefined && usagePeriodLabel === undefined
              ? planLabel
              :`${categoryLabel}${portSummary ? `  ${portSummary}` : ''}`}
          </Text>
        </View>

        {isSelectable && (
          <View style={[styles.checkbox, !checked && { borderColor: colors.inputBorder }, checked && { borderColor: accent, backgroundColor: accent }]}>
            {checked && <AppIcon name={ICONS.check} size={14} color={colors.onAccent} centered />}
          </View>
        )}
      </View>
      {usagePeriodLabel !== undefined && (
        <View style={styles.usageFooter}>
          <Text style={[styles.usageDesks, { color: colors.textMuted }]} numberOfLines={1}>{planLabel}</Text>
          {!!usagePeriodLabel && <Text style={[styles.usagePeriod, { color: colors.textMuted }]}>{usagePeriodLabel}</Text>}
        </View>
      )}
      {showPurchasedAt ? (
        <Text style={[styles.purchasedAt, { color: colors.textMuted }]} pointerEvents="none">{gadget.purchasedAt}</Text>
      ) : showUnknownDate ? (
        <Text style={[styles.purchasedAt, { color: colors.textMuted }]} pointerEvents="none">{lang === 'en' ? 'Start date not set' : '導入日未設定'}</Text>
      ) : null}
    </TouchableOpacity>
  )
})

const styles = StyleSheet.create({
  card: {
    borderRadius: UI_METRICS.cardRadius,   // PlanList/Statistics のカードと統一
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 6,
    borderWidth: 1.5,
  },
  row:      { flexDirection: 'row', alignItems: 'center' },
  iconWrap: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 8, flexShrink: 0 },
  info:     { flex: 1 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name:     { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  displayBadge:     { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  disposedBadge:    { flexDirection: 'row', alignItems: 'center', gap: 3 },
  displayBadgeText: { fontSize: 10, fontWeight: '700' },
  brand:    { fontSize: 12, marginTop: 1 },
  brandWithDate: { paddingRight: 62 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  purchasedAt: { fontSize: 10, position: 'absolute', bottom: 6, right: 10 },
  usageFooter: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 8 },
  usageDesks: { flex: 1, minWidth: 0, fontSize: 10 },
  usagePeriod: { flexShrink: 1, maxWidth: '65%', fontSize: 10, textAlign: 'right' },
})
