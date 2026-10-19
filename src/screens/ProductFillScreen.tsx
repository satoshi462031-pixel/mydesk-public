import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useHeaderHeight } from '@react-navigation/elements'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  findNodeHandle,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { AppIcon } from '../components/atoms/AppIcon'
import { Button } from '../components/atoms/Button'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { PRODUCT_FILL_COACH } from '../constants/gadgetCoachSteps'
import { COACH_SCREEN, CoachAnchor, CoachScope, useCoachMarks } from '../hooks/useCoachMarks'
import { CategoryIcon } from '../components/atoms/CategoryIcon'
import { PRODUCT_NAME_SUGGESTION_MAX_HEIGHT, ProductNameField } from '../components/molecules/ProductNameField'
import { ProductPickerModal } from '../components/organisms/ProductPickerModal'
import { categoryIconColor } from '../constants/icons'
import { AppColors, useApp } from '../context/AppContext'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { resolvePurchaseUrl } from '../repositories/productRepository'
import { analytics, EVENTS, trackOnce } from '../services/analytics'
import { Gadget, GadgetCategory, PlanStackParamList } from '../types'
import { localizedGadgetName } from '../utils/localizedGadgetName'
import { beginPlanReflection, endPlanReflection } from '../utils/planReflection'
import { ProductSuggestion } from '../utils/productSuggestions'
import { clearProductFillDraft, loadProductFillDraft, saveProductFillDraft } from '../store/firstSetupStore'
import { saveProductFillEntries } from '../services/productFillService'
import { trimInvisible } from '../utils/truncateText'
import { isUnfilledSlot } from '../utils/publishRequirements'
import { updateDeskGadgetSelection } from '../utils/deskGadgetUsage'
import { UI_METRICS } from '../constants/ui'

type Props = NativeStackScreenProps<PlanStackParamList, 'ProductFill'>

// ─── 商品をまとめて登録 ──────────────────────────────────────────
//
// テンプレートから作ったデスクは枠（isPlaceholder）が7〜10台並ぶ。
// 1台ずつ詳細画面を開かせると往復が台数ぶん発生するので、この画面では
// 枠だけを集めて商品名の入力に絞る。埋めなかった枠は枠のまま残る。

/**
 * 枠1つぶんの行。見出しは枠の名前（モニター２ など）のままにして、商品名は入力欄の中だけに置く。
 * 見出しごと商品名に変えると、同じ型番を2枚並べたときにどちらの枠か分からなくなる。
 */
function SlotRow({
  gadget, value, isLast, layer, colors: C, lang, isDark,
  registerInput, onFocusChange, onChangeText, onSubmit, onSelectSuggestion, onOpenPicker, onRemove,
}: {
  gadget: Gadget
  value: string
  isLast: boolean
  /** 重なり順。上の行ほど大きい（候補の一覧を下の行に被せる）。フォーカスで変えない */
  layer: number
  colors: AppColors
  lang: 'ja' | 'en'
  isDark: boolean
  registerInput: (node: TextInput | null) => void
  onFocusChange: (focused: boolean) => void
  onChangeText: (value: string) => void
  onSubmit: () => void
  onSelectSuggestion: (suggestion: ProductSuggestion) => void
  onOpenPicker: () => void
  /** 持っていない物の枠をデスクから外す */
  onRemove: () => void
}) {
  const slotName = localizedGadgetName(gadget, lang)

  return (
    // 重なり順をフォーカスで付け替えると、iOS は行を並べ直す間に中の入力欄のフォーカスを外し、
    // 欄を選んだ瞬間にキーボードが閉じる。上の行ほど上に固定で重ねる
    <CoachAnchor id="product-fill-slot"><View style={[styles.row, { zIndex: layer, backgroundColor: C.card, borderColor: C.border }]}>
      {/* 「何を入れる枠か」を見出しにして、その下を丸ごと入力欄にする。
          アイコンを左の列に置くと、肝心の入力欄がそのぶん狭くなる */}
      <View style={styles.slotHead}>
        <View style={[styles.catIcon, { backgroundColor: C.chip }]}>
          <CategoryIcon category={gadget.category} pcFormFactor={gadget.pcFormFactor} customIcon={gadget.customCategory?.icon} size={16} color={categoryIconColor(gadget.category, isDark, undefined, gadget.customCategory?.color)} />
        </View>
        <Text style={[styles.slotName, { color: C.text }]} numberOfLines={1}>{slotName}</Text>
        {/* 投稿するのは出来上がったデスクなので、ここで買う物を探させない。
            枠が持っていない物なら外すだけ */}
        <CoachAnchor id="product-fill-remove"><TouchableOpacity
          style={[styles.slotRemove, { borderColor: C.border }]}
          onPress={onRemove}
          activeOpacity={0.7}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={lang === 'ja' ? `${slotName}をこのデスクから外す` : `Remove ${slotName} from this desk`}
        >
          <Text style={[styles.slotRemoveLabel, { color: C.textSub }]} numberOfLines={1}>
            {lang === 'ja' ? '持っていない' : "Don't own"}
          </Text>
        </TouchableOpacity></CoachAnchor>
      </View>
      <ProductNameField
        category={gadget.category}
        value={value}
        colors={C}
        lang={lang}
        onChangeText={onChangeText}
        onSelectSuggestion={onSelectSuggestion}
        onOpenPicker={onOpenPicker}
        inputRef={registerInput}
        onFocusChange={onFocusChange}
        onSubmitEditing={onSubmit}
        isLast={isLast}
        accessibilityLabel={`${slotName} ${lang === 'ja' ? '商品名' : 'product name'}`}
      />
    </View></CoachAnchor>
  )
}

export function ProductFillScreen({ route, navigation }: Props) {
  // キーボードを避ける量はウィンドウの上端から測られる。渡さないと、入力欄の下端が
  // ヘッダーの高さぶんキーボードに隠れる
  const headerHeight = useHeaderHeight()
  const { planId } = route.params
  const { colors: C, lang, isDark } = useApp()
  const coach = useCoachMarks()
  const { target: coachTarget, open: openCoach } = coach
  const openHelp = useCallback(() => { void openCoach(PRODUCT_FILL_COACH) }, [openCoach])
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => (
      <HeaderIconButton name="help-circle-outline" color={C.text} onPress={openHelp}
        accessibilityLabel={lang === 'ja' ? 'この画面の見方' : 'Understanding this screen'} />
    ) })
  }, [navigation, C.text, lang, openHelp])
  const { gadgets, updateMany, loading } = useGadgets()
  const { getById, updateWith } = usePlans()

  const plan = getById(planId)
  // 並びはテンプレートのスロット順（PC → モニター …）。gadgets の追加順ではなく
  // プランの選択順に合わせると、配線図と同じ読み口になる
  const targets = useMemo(() => {
    if (!plan) return []
    const byId = new Map(gadgets.map((g) => [g.id, g]))
    return plan.selectedGadgetIds
      .map((id) => byId.get(id))
      .filter((g): g is Gadget => !!g && isUnfilledSlot(g))
  }, [gadgets, plan])

  const [values, setValues] = useState<Record<string, string>>({})
  const draftLoadedRef = useRef(false)
  const [picked, setPicked] = useState<Record<string, ProductSuggestion>>({})
  const [pickerFor, setPickerFor] = useState<Gadget | null>(null)
  const inputRefs = useRef<Map<string, TextInput>>(new Map())
  const scrollRef = useRef<ScrollView>(null)
  const [focusedGadgetId, setFocusedGadgetId] = useState<string | null>(null)
  // 閉じるアニメーションの間もジャンルを保つ。null に戻した瞬間に別ジャンルへ
  // 切り替えると、閉じ際に候補が消えたリストが見えてしまう
  const lastPickerCategoryRef = useRef<GadgetCategory>('Other')
  const [saving, setSaving] = useState(false)
  // 下の帯は保存エラー等で背が伸びる。固定の下余白だと、伸びた分だけ一覧の最後が帯の下に潜る
  const [footerH, setFooterH] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const saveInFlightRef = useRef(false)
  // 保存（applyProductToGadget）と同じく見えない文字も落として数える。trim() だけで数えると、
  // 見えない文字だけの枠で保存ボタンが押せて、押しても何も起きない
  const filledCount = targets.filter((g) => trimInvisible(values[g.id] ?? '') !== '').length

  useEffect(() => {
    if (!focusedGadgetId) return
    const timer = setTimeout(() => {
      const input = inputRefs.current.get(focusedGadgetId)
      const handle = input ? findNodeHandle(input) : null
      if (handle) {
        scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
          handle,
          PRODUCT_NAME_SUGGESTION_MAX_HEIGHT + 12,
          true,
        )
      }
    }, Platform.OS === 'ios' ? 300 : 100)
    return () => clearTimeout(timer)
  }, [focusedGadgetId])

  // 保存が済んで下書きを消したあとは書き戻さない
  const draftSettledRef = useRef(false)
  const latestDraftRef = useRef({ values, picked })
  latestDraftRef.current = { values, picked }

  useEffect(() => {
    let active = true
    void loadProductFillDraft(planId).then((draft) => {
      if (!active) return
      // 読み込みを待つ間に打った枠は、打った方を残す。丸ごと差し替えると、開いた直後の入力が下書きで消える
      setValues((prev) => ({ ...draft.values, ...prev }))
      setPicked((prev) => ({ ...draft.picked, ...prev }))
      draftLoadedRef.current = true
    })
    return () => { active = false }
  }, [planId])

  useEffect(() => {
    if (!draftLoadedRef.current) return
    const timer = setTimeout(() => {
      void saveProductFillDraft(planId, { values, picked }).catch(() => {})
    }, 250)
    return () => clearTimeout(timer)
  }, [planId, values, picked])

  // 打ってすぐ戻ると、上の間引きのタイマーごと捨てられて最後の入力が残らない。離れるときは待たずに書く
  useEffect(() => () => {
    if (!draftLoadedRef.current || draftSettledRef.current) return
    void saveProductFillDraft(planId, latestDraftRef.current).catch(() => {})
  }, [planId])

  const handleSelectSuggestion = (gadget: Gadget, suggestion: ProductSuggestion) => {
    analytics.track(EVENTS.PRODUCT_SUGGESTION_SELECTED, {
      category: gadget.category,
      has_product_id: !!suggestion.productId,
      product_id: suggestion.productId,
      selection_source: 'picker',
      placement: 'product_fill',
    })
    setValues((prev) => ({ ...prev, [gadget.id]: suggestion.name }))
    setPicked((prev) => ({ ...prev, [gadget.id]: suggestion }))
  }

  // 公開には全部の枠に商品名が要る（publishRequirements）。用途から自動で置かれた枠には
  // 持っていない物も混ざるので、埋める以外の抜け道をここに置かないと行き止まりになる。
  // デスクから外すだけでガジェットは残る（機材タブのスワイプと同じ操作）ので、確認は挟まない
  const removeSlot = (gadget: Gadget) => {
    setValues((prev) => {
      const next = { ...prev }
      delete next[gadget.id]
      return next
    })
    setPicked((prev) => {
      if (!prev[gadget.id]) return prev
      const next = { ...prev }
      delete next[gadget.id]
      return next
    })
    void updateWith(planId, (p) => ({
      ...updateDeskGadgetSelection(p, p.selectedGadgetIds.filter((id) => id !== gadget.id), gadgets),
      updatedAt: new Date().toISOString(),
    }))
  }

  const handleSave = async () => {
    if (saveInFlightRef.current || !navigation.isFocused()) return
    const entries = targets.flatMap((gadget) => {
      // 切り詰めはしない（applyProductToGadget が切る）。ここで切ると、長い候補名が下の
      // picked との一致判定に落ちて、候補のポート・価格が黙って捨てられる
      const name = trimInvisible(values[gadget.id] ?? '')
      if (name === '') return []
      // 候補を選んだあとに名前を書き換えていたら、その候補のポート・価格は当てにしない
      const suggestion = picked[gadget.id]?.name === name ? picked[gadget.id] : undefined
      return [{ gadget, name, suggestion }]
    })
    if (entries.length === 0) return

    saveInFlightRef.current = true
    setSaving(true)
    setSaveError(null)
    beginPlanReflection(planId)
    try {
      await saveProductFillEntries(entries, {
        resolveUrl: ({ name, suggestion }) => suggestion
          ? resolvePurchaseUrl(
              { name, productId: suggestion.productId },
              { country: lang === 'en' ? 'US' : 'JP' },
            )
          : Promise.resolve(null),
        updateMany,
        clearDraft: () => {
          draftSettledRef.current = true
          return clearProductFillDraft(planId)
        },
        trackFirstItem: (count) => trackOnce(EVENTS.FIRST_ITEM_ADDED, { source: 'product_fill', count }),
      })
      // 保存を待つ間に戻る操作で閉じていたら、ここで戻ると前の画面まで閉じる
      // （goBack は呼んだ画面ではなく、その時点で一番上の画面を閉じる）
      if (navigation.isFocused()) navigation.goBack()
    } catch (error) {
      analytics.error('product_fill_save', error)
      setSaveError(lang === 'ja'
        ? '商品の登録に失敗しました。入力内容は残っています。もう一度お試しください。'
        : 'Could not save products. Your entries are still here. Please try again.')
    } finally {
      endPlanReflection(planId)
      saveInFlightRef.current = false
      setSaving(false)
    }
  }

  if (loading) return (
    <SafeAreaView style={[styles.container, styles.loadingState, { backgroundColor: C.bgList }]}>
      <ActivityIndicator color={C.accentIcon} />
      <Text style={[styles.loadingText, { color: C.textMuted }]}>
        {lang === 'ja' ? '未登録の商品を確認しています' : 'Checking missing products'}
      </Text>
    </SafeAreaView>
  )

  return (
    <SafeAreaView ref={coachTarget(COACH_SCREEN)} style={[styles.container, { backgroundColor: C.bgList }]}>
      <CoachScope coach={coach}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={headerHeight}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: (footerH > 0 ? footerH + 16 : 100) + (focusedGadgetId ? PRODUCT_NAME_SUGGESTION_MAX_HEIGHT + 16 : 0) },
          ]}
          // 下部バーは一覧に重ねてあるので、右端のスクロールバーもその上で止める（無いと末尾で裏に潜る）。
          // 全部入れ終えるとバーごと消えるが、測った高さは残るので出ているときだけ引く
          scrollIndicatorInsets={{ bottom: targets.length > 0 ? footerH : 0 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          <Text style={[styles.leadTitle, { color: C.text }]}>
            {lang === 'ja' ? '商品をまとめて登録' : 'Add products together'}
          </Text>
          <Text style={[styles.hint, { color: C.textMuted }]}>
            {lang === 'ja'
              ? `${targets.length}件の商品名が未登録です。入力すると端子情報を配線図に反映します。公開前にすべて入力するか、持っていない物を外してください。`
              : `${targets.length} product ${targets.length === 1 ? 'name is' : 'names are'} missing. Add them to update wiring from their ports. Fill all before publishing or remove gear you don't own.`}
          </Text>

          {targets.length === 0 && (
            <View style={styles.emptyWrap}>
              <AppIcon name="check-circle-outline" size={40} color={C.success} />
              <Text style={[styles.emptyText, { color: C.textMuted }]}>
                {lang === 'ja' ? 'すべての枠に商品が登録されています' : 'Every slot already has a product'}
              </Text>
              <TouchableOpacity style={[styles.emptyDoneBtn, { borderColor: C.border }]} onPress={() => navigation.goBack()} accessibilityRole="button">
                <Text style={[styles.emptyDoneText, { color: C.textSub }]}>{lang === 'ja' ? '戻る' : 'Go back'}</Text>
              </TouchableOpacity>
            </View>
          )}

          {targets.map((g, index) => (
            <SlotRow
              key={g.id}
              gadget={g}
              value={values[g.id] ?? ''}
              isLast={index === targets.length - 1}
              layer={targets.length - index}
              colors={C}
              lang={lang}
              isDark={isDark}
              registerInput={(node) => {
                if (node) inputRefs.current.set(g.id, node)
                else inputRefs.current.delete(g.id)
              }}
              onFocusChange={(focused) => setFocusedGadgetId((current) => (
                focused ? g.id : current === g.id ? null : current
              ))}
              onChangeText={(v) => setValues((prev) => ({ ...prev, [g.id]: v }))}
              onSubmit={() => {
                const next = targets[index + 1]
                if (next) inputRefs.current.get(next.id)?.focus()
              }}
              onSelectSuggestion={(suggestion) => handleSelectSuggestion(g, suggestion)}
              onOpenPicker={() => { lastPickerCategoryRef.current = g.category; setPickerFor(g) }}
              onRemove={() => removeSlot(g)}
            />
          ))}
        </ScrollView>

        {targets.length > 0 && (
          <View ref={coachTarget('product-fill-save')} style={[styles.footer, { backgroundColor: C.card, borderTopColor: C.border }]} onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}>
            {saveError && (
              <Text
                style={[styles.saveError, { color: C.danger }]}
                accessibilityRole="alert"
              >
                {saveError}
              </Text>
            )}
            <Button
              title={
                filledCount > 0
                  ? (lang === 'ja' ? `${filledCount}件を保存` : `Save ${filledCount}`)
                  : (lang === 'ja' ? '保存' : 'Save')
              }
              onPress={handleSave}
              disabled={filledCount === 0 || saving}
              loading={saving}
              style={styles.saveBtn}
            />
          </View>
        )}
      </KeyboardAvoidingView>
      </CoachScope>
      {coach.overlay}

      <ProductPickerModal
        visible={pickerFor !== null}
        category={pickerFor?.category ?? lastPickerCategoryRef.current}
        onClose={() => setPickerFor(null)}
        onSelect={(suggestion) => {
          if (pickerFor) handleSelectSuggestion(pickerFor, suggestion)
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingState: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, fontWeight: '600' },
  scroll: { padding: UI_METRICS.screenGutter, paddingBottom: 100 },
  leadTitle: { fontSize: 20, fontWeight: '800', lineHeight: 27, marginBottom: 3 },
  hint: { fontSize: 13, marginBottom: 16, lineHeight: 19 },
  emptyWrap: { alignItems: 'center', gap: 10, paddingVertical: 48 },
  emptyText: { fontSize: 14, textAlign: 'center' },
  emptyDoneBtn: { minHeight: UI_METRICS.touchMinSize, minWidth: 120, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: UI_METRICS.controlRadius, marginTop: 6 },
  emptyDoneText: { fontSize: 14, fontWeight: '600' },
  // 枠は7〜10台並ぶので、1画面に入る数を優先して余白を詰める。
  // 入力欄自体の高さ（44＝タップ領域の下限）は削らない
  row: {
    gap: 8,
    borderRadius: UI_METRICS.panelRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
    marginBottom: 6,
  },
  // 行頭のカテゴリ色チップ
  catIcon: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slotName: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  slotRemove: { borderWidth: 1, borderRadius: 13, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 'auto' },
  slotRemoveLabel: { fontSize: 11, fontWeight: '700' },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveError: { fontSize: 13, lineHeight: 18, marginBottom: 10, textAlign: 'center' },
  saveBtn: { width: '100%' },
})
