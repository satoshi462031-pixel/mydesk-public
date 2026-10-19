import { useFocusEffect } from '@react-navigation/native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  InteractionManager,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { AppIcon } from '../components/atoms/AppIcon'
import { SearchField } from '../components/atoms/SearchField'
import { NumberStepper } from '../components/atoms/NumberStepper'
import { GadgetCard } from '../components/molecules/GadgetCard'
import { SetupActionFooter } from '../components/molecules/SetupActionFooter'
import { SetupProgress } from '../components/molecules/SetupProgress'
import { RetryState } from '../components/molecules/RetryState'
import { useApp } from '../context/AppContext'
import { useSpotlightTarget } from '../context/SpotlightContext'
import { SetupScreenHelp } from '../components/molecules/SetupScreenHelp'
import { CoachAnchor } from '../hooks/useCoachMarks'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { DeskPlan, Gadget, PlanStackParamList } from '../types'
import { applyDeskGadgetUsage, updateDeskGadgetSelection } from '../utils/deskGadgetUsage'
import { generateWiring } from '../utils/wiringEngine'
import { hapticSelection, hapticSuccess } from '../utils/haptics'
import { buildGadgetSearchIndex, matchesGadgetSearch, normalizeGadgetSearch } from '../utils/gadgetSearch'
import { backToSetupStep } from '../navigation/setupStepNavigation'
import { analytics, EVENTS, errorProperties } from '../services/analytics'
import { saveFirstSetupDraft } from '../store/firstSetupStore'
import { UI_METRICS } from '../constants/ui'
import { ICONS } from '../constants/icons'

type Props = NativeStackScreenProps<PlanStackParamList, 'GadgetSelection'>

// 電源プレビューの再計算を待つ時間。まとめてチェックを付けていく間は計算しない
const PREVIEW_DEBOUNCE_MS = 250

export function GadgetSelectionScreen({ route, navigation }: Props) {
  const gearInputsRef = useSpotlightTarget('gear-inputs')
  const { planId, wizard = false } = route.params
  const { gadgets, deletedGadgets, loading: gLoading, loadError: gLoadError, reload } = useGadgets()
  const { getById, updateWith } = usePlans()

  const { colors, t, lang } = useApp()
  const plan = getById(planId)
  const deletedGadgetIds = useMemo(() => new Set(deletedGadgets.map((gadget) => gadget.id)), [deletedGadgets])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 0 = コンセントのない環境（カフェ・出先など）。通常構成の既定は2口
  const [outletCount, setOutletCount] = useState(2)
  const [generating, setGenerating] = useState(false)
  const [generationError, setGenerationError] = useState(false)
  // 下の帯はエラー文が出ると背が伸びる。固定の下余白だと、伸びた分だけ一覧の最後が帯の下に潜る
  const [footerH, setFooterH] = useState(0)
  const generationInFlightRef = useRef(false)

  useEffect(() => {
    if (!wizard) return
    void saveFirstSetupDraft({ screen: 'GadgetSelection', planId }).catch(() => {})
  }, [planId, wizard])

  // usePlans は非同期ロードなので plan が null → non-null になったとき一度だけ同期する
  const syncedRef = useRef(false)
  const knownPlanGadgetIdsRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    // 読めていない間は同期しない。空のまま同期すると選択が全部外れ、再試行で読めた
    // ガジェットが「この画面で新しく登録したもの」に見えて全部チェックされる
    if (!plan || gLoading || gLoadError || syncedRef.current) return
    syncedRef.current = true
    const eligibleIds = new Set(gadgets.map((g) => g.id))
    knownPlanGadgetIdsRef.current = new Set(plan.selectedGadgetIds)
    setSelected(new Set(plan.selectedGadgetIds.filter((id) => eligibleIds.has(id))))
    setOutletCount(Math.max(0, plan.outletCount ?? 2))
  }, [plan, gadgets, gLoading, gLoadError])

  // 登録処理がこのデスクへ追加した機材だけを選ぶ。共有ライブラリの増加だけでは登録元を判別できない。
  useEffect(() => {
    const known = knownPlanGadgetIdsRef.current
    if (!known || !plan || gLoading || gLoadError) return
    const eligibleIds = new Set(gadgets.map((gadget) => gadget.id))
    const added = plan.selectedGadgetIds.filter((id) => !known.has(id) && eligibleIds.has(id))
    knownPlanGadgetIdsRef.current = new Set(plan.selectedGadgetIds.filter((id) => known.has(id) || eligibleIds.has(id)))
    if (added.length === 0) return
    setSelected((prev) => new Set([...prev, ...added]))
  }, [gadgets, plan, gLoading, gLoadError])

  // 画面フォーカス時にガジェット一覧を最新化（別タブで追加した商品を反映）
  useFocusEffect(
    useCallback(() => {
      reload()
    }, [reload])
  )

  const toggle = (id: string) => {
    hapticSelection()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // GadgetCard の React.memo を効かせるため、行ごとに新規関数を作らない
  const toggleGadget = useCallback((g: Gadget) => toggle(g.id), [])

  // 検索：商品名・メモ・カテゴリ名にマッチしたものだけ表示する。
  // 選択状態は検索で絞っても保持される（絞り込みは表示だけの操作）
  const [search, setSearch] = useState('')
  const searchIndex = useMemo(
    () => buildGadgetSearchIndex(gadgets, (category) => t('category.' + category)),
    [gadgets, t],
  )
  const visibleGadgets = useMemo(() => {
    const q = normalizeGadgetSearch(search)
    if (!q) return gadgets
    return gadgets.filter((g) => matchesGadgetSearch(searchIndex, g.id, q))
  }, [gadgets, search, searchIndex])

  // 検索で絞り込んでいるときは、表示中のガジェットだけを対象に全選択／解除する
  const allSelected = visibleGadgets.length > 0 && visibleGadgets.every((g) => selected.has(g.id))
  const toggleAll = () => {
    if (visibleGadgets.length > 0) hapticSelection()
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) visibleGadgets.forEach((g) => next.delete(g.id))
      else visibleGadgets.forEach((g) => next.add(g.id))
      return next
    })
  }

  // 電源まわりの注意書きプレビュー。
  // generateWiring は同期実行で重く、レンダリング中に走らせるとチェックを1つ
  // 付けるたびに JS スレッドが止まってタップの反応が落ちる。連打を吸収してから
  // 操作の合間に計算し、結果だけを state で受け取る。
  // plan は依存に入れない（レンダーごとに参照が変わりうるため）。実際に効くのは
  // 選択内容・口数・言語で、いずれも下の依存に含まれている。
  const planRef = useRef(plan)
  planRef.current = plan
  const selectedKey = useMemo(() => Array.from(selected).sort().join(','), [selected])
  const [powerWarnings, setPowerWarnings] = useState<string[]>([])
  useEffect(() => {
    if (!planRef.current || selected.size === 0) { setPowerWarnings([]); return }
    let cancelled = false
    let task: { cancel: () => void } | null = null
    const timer = setTimeout(() => {
      task = InteractionManager.runAfterInteractions(() => {
        const p = planRef.current
        if (cancelled || !p) return
        const previewPlan = {
          ...p,
          selectedGadgetIds: Array.from(selected),
          outletCount,
        }
        const preview = generateWiring(gadgets.map((g) => applyDeskGadgetUsage(previewPlan, g)), previewPlan, lang)
        // 口数の警告（デュアル電源 ×2 等）は給電元の名前しか入らない。「OAタップ」のように
        // 名前に電源の語が無いと落ちるので、文面の「口を N つ使う」でも拾う
        const powerTerms = lang === 'ja'
          ? /(給電|電源|充電器|コンセント|口を\d+つ使う)/
          : /(power|charger|outlet|plugs on)/i
        if (!cancelled) setPowerWarnings(preview.warnings.filter((warning) => powerTerms.test(warning)))
      })
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
      task?.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gadgets, lang, outletCount, planId, selectedKey])

  const handleNext = async () => {
    if (!plan || generationInFlightRef.current) return
    generationInFlightRef.current = true
    setGenerating(true)
    setGenerationError(false)
    const startedAt = Date.now()
    try {
      // ボタンのローディング表示が描画されるのを待ってから重い計算を始める
      await new Promise((r) => setTimeout(r, 0))
      // ゴミ箱内の項目は一覧へ出さないが、30日以内の復元で在籍履歴も戻せるよう
      // この画面を保存しても plan 側の参照は保持する
      const visibleSelectedIds = Array.from(selected)
      // 画面を開いた時点のデスクから組み立てて丸ごと保存すると、そのあいだに裏で入った保存
      // （配線図の再計算など）を黙って消す。保存する時点の最新のデスクに選択だけを当てる
      const withSelection = (prev: DeskPlan): DeskPlan => {
        const retainedDeletedIds = prev.selectedGadgetIds.filter((id) => deletedGadgetIds.has(id))
        return {
          ...updateDeskGadgetSelection(prev, [...retainedDeletedIds, ...visibleSelectedIds], gadgets),
          outletCount,
          outletCountVersion: 2 as const,
          updatedAt: new Date().toISOString(),
        }
      }
      const saved: { plan?: DeskPlan } = {}
      if (wizard) {
        await updateWith(planId, (prev) => (saved.plan = withSelection(prev)))
        if (!saved.plan) throw new Error('PLAN_NOT_FOUND')
        await saveFirstSetupDraft({ screen: 'DeskPlacement', planId }).catch(() => {})
        // 保存を待つ間に戻る操作で離れていたら、作成の続きへ連れ戻さない（続きは一覧から開ける）
        if (!navigation.isFocused()) return
        const root = navigation.getState().routes[0]
        navigation.reset({
          index: 1,
          routes: [{ name: root.name, key: root.key, params: root.params }, { name: 'DeskPlacement', params: { planId } }],
        })
        return
      }
      await updateWith(planId, (prev) => {
        const next = withSelection(prev)
        return (saved.plan = { ...next, wiringResult: generateWiring(gadgets.map((g) => applyDeskGadgetUsage(next, g)), next, lang) })
      })
      const updatedPlan = saved.plan
      const result = updatedPlan?.wiringResult
      if (!updatedPlan || !result) throw new Error('PLAN_NOT_FOUND')
      analytics.track(EVENTS.WIRING_GENERATION_COMPLETED, {
        duration_ms: Date.now() - startedAt,
        gadget_count: visibleSelectedIds.length,
        connection_count: result.connections.length,
        required_cable_count: result.requiredCables.reduce((sum, cable) => sum + cable.count, 0),
        warning_count: result.warnings.length,
        outlet_count: outletCount,
      })
      hapticSuccess()
      // デスク作成はここで完了。ウィザードの途中画面（利用目的・構成一覧・ガジェット選択）を
      // 残すと配線図の戻るボタンが途中画面に戻ってしまうので、開いた一覧の上に積み直す。
      // 写真が1枚も無いデスクだけ写真の段を挟む（テンプレート経路と同じ扱い）。
      // 既にあるデスクの構成を編集し直した場合は寄り道させない
      const needsPhotos = (updatedPlan.images?.length ?? 0) === 0
      // 保存を待つ間に戻る操作で離れていたら、作ったデスクへ連れ戻さない（デスクは一覧から開ける）
      if (!navigation.isFocused()) return
      const root = navigation.getState().routes[0]
      navigation.reset({
        index: 1,
        routes: [
          { name: root.name, key: root.key, params: root.params },
          needsPhotos
            ? { name: 'PhotoFill', params: { planId, fromSetup: true } }
            : { name: 'WiringResult', params: { planId } },
        ],
      })
    } catch (error) {
      analytics.track(EVENTS.WIRING_GENERATION_FAILED, {
        duration_ms: Date.now() - startedAt,
        gadget_count: selected.size,
        ...errorProperties(error),
      })
      setGenerationError(true)
    } finally {
      generationInFlightRef.current = false
      setGenerating(false)
    }
  }

  if (gLoading) return (
    <SafeAreaView style={[styles.container, styles.loadingState, { backgroundColor: colors.bgList }]}>
      <ActivityIndicator color={colors.accentIcon} />
      <Text style={[styles.loadingText, { color: colors.textMuted }]}>
        {lang === 'ja' ? 'ガジェットを読み込んでいます' : 'Loading your gadgets'}
      </Text>
    </SafeAreaView>
  )

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgList }]}>
      <SetupScreenHelp>
      {/* 進捗バーはデスク作成の流れで来たときだけ。既存デスクのガジェットを選び直す
          ときにも出すと、終わっている工程をやり直しているように見える */}
      {wizard && <SetupProgress current={1}
        onStepPress={(step) => {
          if (step === 0) backToSetupStep(navigation, 'PurposeSelection', {
            initialPurposes: plan?.purposes ?? [],
            initialOtherPurposeLabel: plan?.otherPurposeLabel,
            initialOtherPurposeIcon: plan?.otherPurposeIcon,
            initialOtherPurposeColor: plan?.otherPurposeColor,
            returnPlanId: planId,
            resume: { step: 1, name: 'GadgetSelection', params: { planId, wizard: true } } as const,
          })
          if (step === 2) void handleNext()
        }}
        canNavigate={(step) => step <= 2}
      />}
      <View ref={gearInputsRef} collapsable={false} style={styles.container}>
      <FlatList
        data={visibleGadgets}
        keyExtractor={(g) => g.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <CoachAnchor id="setup-select-gear"><View><GadgetCard
            gadget={item}
            checked={selected.has(item.id)}
            onToggle={toggleGadget}
          /></View></CoachAnchor>
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.lead}>
              <Text style={[styles.leadTitle, { color: colors.text }]}>
                {lang === 'ja' ? 'このデスクで使う機材' : 'Gear used on this desk'}
              </Text>
              <Text style={[styles.leadText, { color: colors.textMuted }]}>
                {lang === 'ja' ? '選んだ機材とコンセント数から配線図を作ります。' : 'The wiring map uses your selected gear and outlet count.'}
              </Text>
            </View>
            {/* 利用できる壁コンセント口数 */}
            <CoachAnchor id="setup-outlets"><View style={[styles.outletRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <View style={styles.outletLeft}>
                <AppIcon name="power-socket-jp" size={18} color={colors.textSub} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.outletLabel, { color: colors.textSub }]}>{t('gadgetSel.wallOutlet')}</Text>
                  {outletCount === 0 && (
                    <Text style={[styles.outletNote, { color: colors.textMuted }]}>
                      {lang === 'ja' ? 'コンセントなし（モバイルバッテリー前提）' : 'No outlet (power bank only)'}
                    </Text>
                  )}
                </View>
              </View>
              <NumberStepper
                value={outletCount}
                onChange={setOutletCount}
                max={20}
                size="regular"
                accessibilityLabel={t('gadgetSel.wallOutlet')}
              />
            </View></CoachAnchor>

            {powerWarnings.length > 0 && (
              <View style={[
                styles.powerWarning,
                { backgroundColor: colors.danger + '12', borderColor: colors.danger + '66' },
              ]}>
                <AppIcon name="alert-circle-outline" size={20} color={colors.danger} />
                <View style={styles.powerWarningBody}>
                  <Text style={[styles.powerWarningTitle, { color: colors.danger }]}>
                    {lang === 'ja' ? '給電経路を確認してください' : 'Check the power route'}
                  </Text>
                  {powerWarnings.map((warning, index) => (
                    <Text key={`${warning}-${index}`} style={[styles.powerWarningText, { color: colors.textSub }]}>
                      ・{warning}
                    </Text>
                  ))}
                </View>
              </View>
            )}

            {/* 検索（登録数が増えると目当てのガジェットを探しづらくなるため） */}
            {gadgets.length > 0 && (
              <SearchField
                  containerStyle={styles.searchBar}
                  placeholder={t('common.search')}
                  value={search}
                  onChangeText={setSearch}
                  accessibilityLabel={lang === 'ja' ? 'ガジェットを検索' : 'Search gadgets'}
                  onClear={() => setSearch('')}
                  clearAccessibilityLabel={t('a11y.clearSearch')}
              />
            )}

            {/* ヒント + 新規追加 + 全選択 */}
            <View style={styles.listHeader}>
              <Text style={[styles.hint, { color: colors.textMuted }]}>{t('gadgetSel.hint')}</Text>
              <View style={styles.headerBtns}>
                <TouchableOpacity
                  style={[styles.addNewBtn, { borderColor: colors.accentIcon }]}
                  onPress={() => navigation.navigate('AddGadget', { planId })}
                  accessibilityRole="button"
                  accessibilityLabel={lang === 'ja' ? '新しいガジェットを登録' : 'Add a new gadget'}
                >
                  <AppIcon name={ICONS.add} size={14} color={colors.accentText} />
                  <Text style={[styles.addNewText, { color: colors.accentText }]}>{lang === 'ja' ? '新規作成' : 'Create new'}</Text>
                </TouchableOpacity>
                {gadgets.length > 0 && (
                  <TouchableOpacity style={[styles.selectAllBtn, { borderColor: colors.border }]} onPress={toggleAll} accessibilityRole="button" accessibilityLabel={allSelected ? t('gadgetSel.deselectAll') : t('gadgetSel.selectAll')}>
                    <Text style={[styles.selectAllText, { color: colors.textSub }]}>
                      {allSelected ? t('gadgetSel.deselectAll') : t('gadgetSel.selectAll')}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          // 読めなかったのを「未登録」と見せない（登録を促すと、読めない間は保存を止めているので失敗する）
          gLoadError ? (
            <RetryState
              message={lang === 'ja' ? 'ガジェットを読み込めませんでした。' : 'Could not load your gadgets.'}
              onRetry={reload}
            />
          ) : search.trim() ? (
            <View style={styles.empty}>
              <AppIcon name="magnify-close" size={36} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('gadgetLib.noMatch')}</Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>{t('gadgetSel.emptyText')}</Text>
              <TouchableOpacity
                style={[styles.emptyAddBtn, { backgroundColor: colors.accent }]}
                onPress={() => navigation.navigate('AddGadget', { planId })}
                accessibilityRole="button"
                accessibilityLabel={lang === 'ja' ? 'ガジェットを登録する' : 'Add a gadget'}
              >
                <AppIcon name={ICONS.add} size={16} color={colors.onAccent} />
                <Text style={[styles.emptyAddText, { color: colors.onAccent }]}>{lang === 'ja' ? 'ガジェットを登録する' : 'Add a gadget'}</Text>
              </TouchableOpacity>
            </View>
          )
        }
        contentContainerStyle={[styles.list, footerH > 0 && { paddingBottom: footerH + 16 }]}
        // 下部バーは一覧に重ねてあるので、右端のスクロールバーもその上で止める（無いと末尾で裏に潜る）
        scrollIndicatorInsets={{ bottom: footerH }}
      />
      </View>

      <SetupActionFooter
        showGuide
        absolute
        title={t('gadgetSel.nextBtn')}
        disabled={selected.size === 0 || generating}
        loading={generating}
        onPress={handleNext}
        onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
      >
        {/* 横並びの外に置く。同じ行に入れると文が幅を取り、再試行に押す「次へ」が画面外へ押し出される */}
        {generationError && (
          <Text style={[styles.generationError, { color: colors.danger }]} accessibilityRole="alert">
            {lang === 'ja' ? '配線図を作成できませんでした。選択内容を残したまま再試行できます。' : 'Could not create the wiring map. Your selection is still here.'}
          </Text>
        )}
        <Text style={[styles.selectedCount, { color: colors.textSub }]}>{t('gadgetSel.selectedCount', { n: selected.size })}</Text>
      </SetupActionFooter>
      </SetupScreenHelp>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingState: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, fontWeight: '600' },
  lead: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  leadTitle: { fontSize: 19, fontWeight: '800', lineHeight: 26 },
  leadText: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  generationError: { fontSize: 12, lineHeight: 17, textAlign: 'center', marginBottom: 8 },
  list: { paddingTop: 0, paddingBottom: 100 },
  outletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  outletLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  outletLabel: { fontSize: 14, fontWeight: '500' },
  outletNote: { fontSize: 11, marginTop: 2 },
  powerWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: UI_METRICS.panelRadius,
    padding: 12,
  },
  powerWarningBody: { flex: 1, gap: 4 },
  powerWarningTitle: { fontSize: 13, fontWeight: '700' },
  powerWarningText: { fontSize: 12, lineHeight: 17 },
  searchBar: {
    marginHorizontal: 16,
    marginTop: 12,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  hint: { fontSize: 13, flexShrink: 1 },
  headerBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addNewBtn: { minHeight: UI_METRICS.touchMinSize, flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderRadius: UI_METRICS.controlRadius, paddingHorizontal: 10 },
  addNewText: { fontSize: 13, fontWeight: '600' },
  selectAllBtn: {
    borderRadius: UI_METRICS.controlRadius,
    borderWidth: 1,
    minHeight: UI_METRICS.touchMinSize,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectAllText: { fontSize: 13, fontWeight: '600' },
  empty: { padding: 40, alignItems: 'center', gap: 16 },
  emptyText: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  emptyAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 12, borderRadius: UI_METRICS.controlRadius },
  emptyAddText: { fontSize: 14, fontWeight: '700' },
  selectedCount: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
})
