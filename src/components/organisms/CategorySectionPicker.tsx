import { Alert } from '../../utils/alert'
import { ReactNode, useEffect, useRef, useState } from 'react'
import {
  Dimensions,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native'
import { CATEGORY_SECTIONS, CATEGORY_SELECTION_ORDER } from '../../constants/categoryOrder'
import { categoryIconColor, ICONS } from '../../constants/icons'
import { useApp } from '../../context/AppContext'
import { useCustomCategories } from '../../hooks/useCustomCategories'
import { CustomCategory, GadgetCategory } from '../../types'
import { AppIcon } from '../atoms/AppIcon'
import { CategoryIcon } from '../atoms/CategoryIcon'
import { IconCircleButton } from '../atoms/IconCircleButton'
import { PRESS_INTERACTION, UI_METRICS } from '../../constants/ui'
import { CustomCategoryEditor } from './CustomCategoryEditor'
import { hapticMedium } from '../../utils/haptics'
import { CoachAnchor } from '../../hooks/useCoachMarks'

const SCREEN_W = Dimensions.get('window').width

interface Props {
  /** grid = 全画面モーダル向けのタイル、list = ボトムシート向けの行 */
  layout: 'grid' | 'list'
  /** 選択中カテゴリ。あればハイライトし、「詳細・専門機器」枠にあるときは開いた状態で始める */
  selected?: GadgetCategory
  /**
   * 複数選べる画面で選択中のジャンル（デスク作成のジャンルの段で使っていた。今は呼び出し元が無い）。
   * 渡すと札の役割がチェックボックスになり、selected は見ない
   */
  selectedSet?: ReadonlySet<GadgetCategory>
  /** 一覧に出さないジャンル。選ばせる意味がないもの（ケーブルなど）を外す */
  hiddenCategories?: readonly GadgetCategory[]
  /** 一覧の先頭に差し込む内容。画面上部に固定すると、選択で高さが変わったとき札がずれる */
  header?: ReactNode
  onSelect: (cat: GadgetCategory) => void
  /**
   * 自作ジャンルを選んだとき。渡した画面にだけ「自分で作ったジャンル」の節と作る入口が出る。
   * 作った直後もこれを呼ぶ（作ってからもう一度探して押させない）
   */
  onSelectCustom?: (custom: CustomCategory) => void
  /** 選択中の自作ジャンル（1つ選ぶ画面）。これがあるときは selected を渡さない */
  selectedCustomId?: string
  /** 選択中の自作ジャンル（複数選ぶ画面） */
  selectedCustomIds?: ReadonlySet<string>
  /**
   * 複数選ぶ画面で、選んだ札ごとの台数。渡すと選んだ札に −／＋ が出る（grid のみ）。
   * 載っていないジャンルは1台として扱う
   */
  quantities?: ReadonlyMap<GadgetCategory, number>
  onChangeQuantity?: (cat: GadgetCategory, quantity: number) => void
  /** 自作ジャンルの台数。キーは自作ジャンルの id */
  customQuantities?: ReadonlyMap<string, number>
  onChangeCustomQuantity?: (custom: CustomCategory, quantity: number) => void
  maxQuantity?: number
  contentContainerStyle?: StyleProp<ViewStyle>
}

const QUANTITY_BUTTON_DIAMETER = 22

/**
 * ジャンル選択の一覧。セクション分けと「詳細・専門機器」枠の折りたたみを持ち、
 * 編集モードではタップでジャンルを枠へ出し入れできる（振り分けは端末に保存される）。
 */
export function CategorySectionPicker({
  layout, selected, selectedSet, hiddenCategories, header, onSelect, onSelectCustom, selectedCustomId, selectedCustomIds,
  quantities, onChangeQuantity, customQuantities, onChangeCustomQuantity, maxQuantity = 8, contentContainerStyle,
}: Props) {
  const { colors: C, t, lang, isDark, isAdvancedCategory, toggleAdvancedCategory, resetAdvancedCategories } = useApp()
  const { categories: customCategories } = useCustomCategories()
  // undefined = 閉じている、null = 新しく作る、値 = その自作ジャンルを直す
  const [customEditor, setCustomEditor] = useState<CustomCategory | null | undefined>(undefined)
  // 複数選択では、畳んだ枠の中に選択済みが隠れていると「選んだはずのものが見えない」になる
  const [showAdvanced, setShowAdvanced] = useState(() => selectedSet
    ? [...selectedSet].some(isAdvancedCategory)
    : selected != null && isAdvancedCategory(selected))
  const [editing, setEditing] = useState(false)
  const editingRef = useRef(false)
  const resetConfirmationRef = useRef<object | null>(null)
  const resettingRef = useRef(false)
  const saveErrorVisibleRef = useRef(false)
  useEffect(() => () => { resetConfirmationRef.current = null }, [])
  const longPressedCustomIdRef = useRef<string | null>(null)
  const multi = !!selectedSet
  const hidden = new Set(hiddenCategories ?? [])

  // 編集中に枠が閉じていると出し入れの結果が見えないので、開いたままにする
  const advancedOpen = showAdvanced || editing
  const isGrid = layout === 'grid'

  const handlePress = (cat: GadgetCategory) => {
    if (resetConfirmationRef.current || resettingRef.current) return
    if (editingRef.current) void toggleAdvancedCategory(cat).catch(showSaveError)
    else onSelect(cat)
  }

  const showSaveError = () => {
    if (saveErrorVisibleRef.current) return
    saveErrorVisibleRef.current = true
    const close = () => { saveErrorVisibleRef.current = false }
    Alert.alert(lang === 'ja' ? '保存できませんでした' : 'Could not save',
      lang === 'ja' ? 'もう一度お試しください。' : 'Please try again.',
      [{ text: 'OK', onPress: close }], { onDismiss: close })
  }

  const handleReset = () => {
    if (!editingRef.current || resetConfirmationRef.current || resettingRef.current) return
    const ticket = {}
    resetConfirmationRef.current = ticket
    const cancel = () => { if (resetConfirmationRef.current === ticket) resetConfirmationRef.current = null }
    Alert.alert(t('catPicker.reset'), t('catPicker.resetConfirm'), [
      { text: t('common.cancel'), style: 'cancel', onPress: cancel },
      { text: t('catPicker.reset'), onPress: () => {
        if (resetConfirmationRef.current !== ticket) return
        resetConfirmationRef.current = null
        resettingRef.current = true
        void resetAdvancedCategories().catch(showSaveError).finally(() => { resettingRef.current = false })
      } },
    ], { onDismiss: cancel })
  }

  const toggleEditing = () => {
    if (resetConfirmationRef.current || resettingRef.current) return
    editingRef.current = !editingRef.current
    setEditing(editingRef.current)
  }

  // 2台目以降があるときだけ、チェックの代わりに台数を出す
  const selectedBadge = (quantity: number) => quantity > 1
    ? (
      <View style={[styles.quantityBadge, { backgroundColor: C.accent }]}>
        <Text style={[styles.quantityBadgeText, { color: C.onAccent }]}>×{quantity}</Text>
      </View>
    )
    : <AppIcon name="check-circle" size={isGrid ? 13 : 18} color={C.accentIcon} />

  // 選んだ札のアイコンの左右に −／＋ を置く。札の下へ段を足すと、選ぶたびにその行だけ
  // 背が伸びて下の札がずれる（押そうとした札が指の下から逃げる）
  const renderIconRow = (icon: ReactNode, name: string, quantity: number, onChange: ((quantity: number) => void) | null) => {
    if (!onChange) return icon
    const button = (kind: 'subtract' | 'add') => {
      const disabled = kind === 'subtract' ? quantity <= 1 : quantity >= maxQuantity
      return (
        <IconCircleButton
          name={ICONS[kind]}
          diameter={QUANTITY_BUTTON_DIAMETER}
          color={disabled ? C.textMuted : C.accentText}
          background={C.card}
          borderColor={C.border}
          disabled={disabled}
          hitSlop={8}
          onPress={() => onChange(quantity + (kind === 'add' ? 1 : -1))}
          accessibilityLabel={lang === 'ja'
            ? `${name}を1台${kind === 'add' ? '増やす' : '減らす'}`
            : `${kind === 'add' ? 'Add' : 'Remove'} one ${name}`}
        />
      )
    }
    return (
      <View style={styles.quantityRow}>
        {button('subtract')}
        {icon}
        {button('add')}
      </View>
    )
  }

  const quantityLabel = (name: string, quantity: number) => quantity > 1
    ? (lang === 'ja' ? `${name} ${quantity}台` : `${name}, ${quantity}`)
    : name

  const renderItem = (cat: GadgetCategory) => {
    const isSelected = !editing && (selectedSet ? selectedSet.has(cat) : selected === cat)
    const inAdvanced = isAdvancedCategory(cat)
    const quantity = quantities?.get(cat) ?? 1
    const badge = editing
      ? <AppIcon name={inAdvanced ? 'plus-circle' : 'minus-circle'} size={isGrid ? 15 : 19} color={inAdvanced ? C.accentIcon : C.danger} />
      : isSelected ? selectedBadge(quantity) : null

    if (!isGrid) {
      return (
        <CoachAnchor key={cat} id="category-tile"><TouchableOpacity
          accessibilityRole={multi && !editing ? 'checkbox' : 'button'}
          accessibilityState={multi && !editing ? { checked: isSelected } : { selected: isSelected }}
          style={[styles.row, { borderBottomColor: C.border }]}
          onPress={() => handlePress(cat)}
          activeOpacity={0.7}
        >
          <CategoryIcon category={cat} size={20} color={categoryIconColor(cat, isDark)} />
          <Text style={[styles.rowText, { color: isSelected ? C.accentText : C.text }]}>{t('category.' + cat)}</Text>
          {badge}
        </TouchableOpacity></CoachAnchor>
      )
    }

    const name = t('category.' + cat)
    return (
      <CoachAnchor key={cat} id="category-tile"><TouchableOpacity
        accessibilityRole={multi && !editing ? 'checkbox' : 'button'}
        accessibilityLabel={isSelected ? quantityLabel(name, quantity) : name}
        accessibilityState={multi && !editing ? { checked: isSelected } : { selected: isSelected }}
        style={[styles.gridItem, { backgroundColor: isSelected ? C.accent + '18' : C.chip, borderColor: isSelected ? C.accentIcon : C.border }]}
        onPress={() => handlePress(cat)}
        activeOpacity={0.7}
      >
        {renderIconRow(
          <View style={[styles.gridIconWrap, { backgroundColor: C.chip }]}>
            <CategoryIcon category={cat} size={26} color={categoryIconColor(cat, isDark)} />
          </View>,
          name,
          quantity,
          isSelected && onChangeQuantity ? (next) => onChangeQuantity(cat, next) : null,
        )}
        <Text style={[styles.gridLabel, { color: isSelected ? C.accentText : C.text }]} numberOfLines={2}>
          {t('category.' + cat)}
        </Text>
        {badge != null && <View style={styles.gridBadge}>{badge}</View>}
      </TouchableOpacity></CoachAnchor>
    )
  }

  const renderGroup = (cats: readonly GadgetCategory[]) => (
    isGrid ? <View style={styles.grid}>{cats.map(renderItem)}</View> : <>{cats.map(renderItem)}</>
  )

  // 自作ジャンルの札。編集モードと長押しでは直す画面を開く（選ぶ操作と取り違えないよう、タップは選ぶだけ）
  const renderCustomItem = (custom: CustomCategory) => {
    const isSelected = !editing && (selectedCustomIds ? selectedCustomIds.has(custom.id) : selectedCustomId === custom.id)
    const press = () => (editingRef.current ? setCustomEditor(custom) : onSelectCustom?.(custom))
    const guardedPress = () => {
      if (longPressedCustomIdRef.current === custom.id) {
        longPressedCustomIdRef.current = null
        return
      }
      press()
    }
    const longPress = () => {
      longPressedCustomIdRef.current = custom.id
      hapticMedium()
      setCustomEditor(custom)
    }
    const quantity = customQuantities?.get(custom.id) ?? 1
    const badge = editing
      ? <AppIcon name={ICONS.edit} size={isGrid ? 14 : 18} color={C.accentText} />
      : isSelected ? selectedBadge(quantity) : null
    const a11y = {
      accessibilityRole: (multi && !editing ? 'checkbox' : 'button') as 'checkbox' | 'button',
      accessibilityLabel: isSelected ? quantityLabel(custom.name, quantity) : custom.name,
      accessibilityState: multi && !editing ? { checked: isSelected } : { selected: isSelected },
      accessibilityHint: lang === 'ja' ? '長押しで編集' : 'Long press to edit',
    }
    const iconColor = categoryIconColor('Other', isDark, undefined, custom.color)
    if (!isGrid) {
      return (
        <CoachAnchor key={custom.id} id="category-custom"><TouchableOpacity {...a11y} style={[styles.row, { borderBottomColor: C.border }]}
          onPressIn={() => { longPressedCustomIdRef.current = null }}
          onPress={guardedPress} onLongPress={longPress} delayLongPress={PRESS_INTERACTION.longPressDelay} activeOpacity={0.7}>
          <CategoryIcon category="Other" customIcon={custom.icon} size={20} color={iconColor} />
          <Text style={[styles.rowText, { color: isSelected ? C.accentText : C.text }]}>{custom.name}</Text>
          {badge}
        </TouchableOpacity></CoachAnchor>
      )
    }
    return (
      <CoachAnchor key={custom.id} id="category-custom"><TouchableOpacity {...a11y}
        style={[styles.gridItem, { backgroundColor: isSelected ? C.accent + '18' : C.chip, borderColor: isSelected ? C.accentIcon : C.border }]}
        onPressIn={() => { longPressedCustomIdRef.current = null }}
        onPress={guardedPress} onLongPress={longPress} delayLongPress={PRESS_INTERACTION.longPressDelay} activeOpacity={0.7}>
        {renderIconRow(
          <View style={[styles.gridIconWrap, { backgroundColor: C.chip }]}>
            <CategoryIcon category="Other" customIcon={custom.icon} size={26} color={iconColor} />
          </View>,
          custom.name,
          quantity,
          isSelected && onChangeCustomQuantity ? (next) => onChangeCustomQuantity(custom, next) : null,
        )}
        <Text style={[styles.gridLabel, { color: isSelected ? C.accentText : C.text }]} numberOfLines={2}>{custom.name}</Text>
        {badge != null && <View style={styles.gridBadge}>{badge}</View>}
      </TouchableOpacity></CoachAnchor>
    )
  }

  const createLabel = lang === 'ja' ? 'ジャンルを作る' : 'New category'
  const renderCreateItem = () => isGrid ? (
    <CoachAnchor key="__create" id="category-create"><TouchableOpacity accessibilityRole="button" accessibilityLabel={createLabel}
      style={[styles.gridItem, styles.createItem, { borderColor: C.border }]}
      onPress={() => setCustomEditor(null)} activeOpacity={0.7}>
      <View style={[styles.gridIconWrap, { backgroundColor: C.accent + '18' }]}>
        <AppIcon name={ICONS.add} size={24} color={C.accentText} centered />
      </View>
      <Text style={[styles.gridLabel, { color: C.accentText }]} numberOfLines={2}>{createLabel}</Text>
    </TouchableOpacity></CoachAnchor>
  ) : (
    <CoachAnchor key="__create" id="category-create"><TouchableOpacity accessibilityRole="button" style={[styles.row, { borderBottomColor: C.border }]}
      onPress={() => setCustomEditor(null)} activeOpacity={0.7}>
      <AppIcon name={ICONS.add} size={20} color={C.accentText} />
      <Text style={[styles.rowText, { color: C.accentText }]}>{createLabel}</Text>
    </TouchableOpacity></CoachAnchor>
  )

  const headerStyle = isGrid ? styles.gridSectionHeader : styles.listSectionHeader
  const advancedCats = CATEGORY_SELECTION_ORDER.filter((c) => isAdvancedCategory(c) && !hidden.has(c))

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[isGrid ? styles.gridScroll : styles.listScroll, contentContainerStyle]}
    >
      {header}
      {CATEGORY_SECTIONS.map((section) => {
        const cats = section.cats.filter((c) => !isAdvancedCategory(c) && !hidden.has(c))
        if (cats.length === 0) return null
        return (
          <View key={section.title}>
            <Text style={[headerStyle, { color: C.textSub }]}>{lang === 'en' ? section.titleEn : section.title}</Text>
            {renderGroup(cats)}
          </View>
        )
      })}

      {/* 一覧に無い物（アプリが知らないジャンル）を自分で足す入口。
          詳細・専門機器の枠より上に置く。畳んだ枠の下にあると、無いと思って探すのをやめる */}
      {onSelectCustom && (
        <View>
          <Text style={[headerStyle, { color: C.textSub }]}>{lang === 'ja' ? '自分で作ったジャンル' : 'Your categories'}</Text>
          {isGrid
            ? <View style={styles.grid}>{customCategories.map(renderCustomItem)}{renderCreateItem()}</View>
            : <>{customCategories.map(renderCustomItem)}{renderCreateItem()}</>}
        </View>
      )}

      <View style={[styles.advancedHeader, isGrid ? styles.advancedHeaderGrid : styles.advancedHeaderList]}>
        <CoachAnchor id="category-advanced"><TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
          style={styles.advancedHeaderMain}
          onPress={() => { if (!editingRef.current) setShowAdvanced((v) => !v) }}
          activeOpacity={0.7}
          disabled={editing}
        >
          <Text style={[headerStyle, styles.advancedTitle, { color: C.textSub }]}>{t('catPicker.advanced')}</Text>
          {!editing && <AppIcon name={advancedOpen ? ICONS.chevronUp : ICONS.chevronDown} size={20} color={C.textSub} />}
        </TouchableOpacity></CoachAnchor>
        <CoachAnchor id="category-edit"><TouchableOpacity accessibilityRole="button" onPress={toggleEditing} hitSlop={10} activeOpacity={0.7}>
          <Text style={[styles.editBtn, { color: C.accentText }]}>{editing ? t('common.done') : t('common.edit')}</Text>
        </TouchableOpacity></CoachAnchor>
      </View>

      {editing && (
        <Text style={[styles.hint, isGrid ? styles.hintGrid : styles.hintList, { color: C.textMuted }]}>
          {t('catPicker.editHint')}
        </Text>
      )}

      {advancedOpen && renderGroup(advancedCats)}

      {editing && (
        <TouchableOpacity accessibilityRole="button" style={styles.resetBtn} onPress={handleReset} activeOpacity={0.7}>
          <Text style={[styles.resetText, { color: C.textSub }]}>{t('catPicker.reset')}</Text>
        </TouchableOpacity>
      )}

      {onSelectCustom && (
        <CustomCategoryEditor
          visible={customEditor !== undefined}
          editing={customEditor}
          onClose={() => setCustomEditor(undefined)}
          onSaved={(saved) => {
            const created = customEditor === null
            setCustomEditor(undefined)
            if (created) onSelectCustom(saved)
          }}
        />
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  gridScroll: { paddingHorizontal: UI_METRICS.screenGutter, paddingBottom: 40 },
  listScroll: { paddingBottom: 12 },

  gridSectionHeader: { fontSize: 13, fontWeight: '700', marginTop: 22, marginBottom: 10, marginLeft: 2 },
  listSectionHeader: { fontSize: 11, fontWeight: '600', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridItem: {
    width: (SCREEN_W - 32 - 16) / 3,
    borderRadius: UI_METRICS.controlRadius,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 4,
    position: 'relative',
  },
  gridIconWrap: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  gridLabel: { fontSize: 10, fontWeight: '500', textAlign: 'center' },
  gridBadge: { position: 'absolute', top: 4, right: 4 },
  quantityRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quantityBadge: { minWidth: 18, height: 16, paddingHorizontal: 4, borderRadius: UI_METRICS.pillRadius, alignItems: 'center', justifyContent: 'center' },
  quantityBadgeText: { fontSize: 10, fontWeight: '800' },
  createItem: { backgroundColor: 'transparent', borderStyle: 'dashed' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { fontSize: 14, fontWeight: '500', flex: 1 },

  advancedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  advancedHeaderGrid: { marginTop: 22, marginBottom: 10, marginRight: 2 },
  advancedHeaderList: { paddingRight: 16, paddingTop: 14, paddingBottom: 6 },
  advancedHeaderMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  advancedTitle: { marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 },
  editBtn: { fontSize: 13, fontWeight: '700' },

  hint: { fontSize: 11, lineHeight: 16 },
  hintGrid: { marginBottom: 10, marginLeft: 2 },
  hintList: { paddingHorizontal: 16, paddingBottom: 8 },

  resetBtn: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 20 },
  resetText: { fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
})
