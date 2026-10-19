import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  InteractionManager,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { AppIcon } from '../components/atoms/AppIcon'
import { SetupProgress } from '../components/molecules/SetupProgress'
import { SetupActionFooter } from '../components/molecules/SetupActionFooter'
import { RetryState } from '../components/molecules/RetryState'
import { ConnectionMap, PLACEMENT_MOVE_HINT } from '../components/organisms/ConnectionMap'
import { ICONS } from '../constants/icons'
import { UI_METRICS } from '../constants/ui'
import { useApp } from '../context/AppContext'
import { useSpotlightTarget } from '../context/SpotlightContext'
import { SetupScreenHelp } from '../components/molecules/SetupScreenHelp'
import { useGadgets } from '../hooks/useGadgets'
import { usePlans } from '../hooks/usePlans'
import { analytics, EVENTS, errorProperties } from '../services/analytics'
import { backToSetupStep, openGearStep } from '../navigation/setupStepNavigation'
import { saveFirstSetupDraft } from '../store/firstSetupStore'
import { DeskPlan, MapConnection, NodeOffset, PlanStackParamList } from '../types'
import { reconcileMap } from '../utils/connectionMapLayout'
import { evictPlanLayoutCache, restorePlanLayoutCache } from '../utils/mapLayoutCache'
import { resetPlanLayout } from '../utils/planWiring'
import { applyDeskGadgetUsage } from '../utils/deskGadgetUsage'
import { hapticSuccess } from '../utils/haptics'
import { generateWiring } from '../utils/wiringEngine'

type Props = NativeStackScreenProps<PlanStackParamList, 'DeskPlacement'>

const GENERATION_STEPS = [
  { ja: '配置を保存中', en: 'Saving layout' },
  { ja: '配線を整理中', en: 'Organizing wiring' },
  { ja: '仕上げ中', en: 'Finishing up' },
] as const

// 段階の表示を描かせてから重い処理に入るための間。描画には1フレームで足りるので、
// 段階の文言がちらっと読める程度に留める（260ms×3 は作成の完了を 0.8 秒遅らせていた）
const pauseForPaint = () => new Promise<void>((resolve) => setTimeout(resolve, 80))

export function DeskPlacementScreen({ route, navigation }: Props) {
  const layoutAreaRef = useSpotlightTarget('layout-area')
  const { planId } = route.params
  const { colors: C, lang } = useApp()
  const { gadgets, loading: gadgetsLoading, loadError: gadgetsLoadError, reload: reloadGadgets } = useGadgets()
  const { loading: plansLoading, loadError: plansLoadError, getById, updateWith, reload: reloadPlans } = usePlans()
  const plan = getById(planId)
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, NodeOffset>>(plan?.connectionMap?.nodeOffsets ?? {})
  const [generating, setGenerating] = useState(false)
  const [generationStep, setGenerationStep] = useState(0)
  const [generationError, setGenerationError] = useState(false)
  const [previewConnections, setPreviewConnections] = useState<MapConnection[] | null>(null)
  const generationInFlightRef = useRef(false)
  const offsetsSyncedRef = useRef(false)

  useEffect(() => {
    void saveFirstSetupDraft({ screen: 'DeskPlacement', planId }).catch(() => {})
  }, [planId])

  useEffect(() => {
    if (!plan || offsetsSyncedRef.current) return
    offsetsSyncedRef.current = true
    setNodeOffsets(plan.connectionMap?.nodeOffsets ?? {})
  }, [plan])

  useEffect(() => {
    if (!generating) return
    const step = GENERATION_STEPS[generationStep]
    void AccessibilityInfo.announceForAccessibility(lang === 'ja' ? step.ja : step.en)
  }, [generating, generationStep, lang])

  const selectedGadgets = useMemo(() => {
    if (!plan) return []
    return gadgets
      .filter((gadget) => plan.selectedGadgetIds.includes(gadget.id) && gadget.category !== 'Cable')
      .map((gadget) => applyDeskGadgetUsage(plan, gadget))
  }, [gadgets, plan])

  useEffect(() => {
    if (!plan || gadgetsLoading || gadgetsLoadError) return
    let cancelled = false
    const task = InteractionManager.runAfterInteractions(() => {
      const applied = gadgets.map((gadget) => applyDeskGadgetUsage(plan, gadget))
      const next = reconcileMap(plan.connectionMap?.connections ?? [], applied, plan, lang)
      if (!cancelled) setPreviewConnections(next)
    })
    return () => { cancelled = true; task.cancel() }
  }, [gadgets, gadgetsLoadError, gadgetsLoading, lang, plan])

  const previewPlan = useMemo<DeskPlan | null>(() => plan ? {
    ...plan,
    connectionMap: {
      ...plan.connectionMap,
      connections: previewConnections ?? plan.connectionMap?.connections ?? [],
      nodeOffsets,
    },
  } : null, [nodeOffsets, plan, previewConnections])

  const finishPlacement = useCallback(async (confirmedOffsets?: Record<string, NodeOffset>, openPhotos = false) => {
    if (!plan || generationInFlightRef.current || !navigation.isFocused()) return
    generationInFlightRef.current = true
    setGenerating(true)
    setGenerationError(false)
    setGenerationStep(0)
    const startedAt = Date.now()
    const finalOffsets = confirmedOffsets ?? nodeOffsets

    try {
      await pauseForPaint()
      const planWithLayout: DeskPlan = {
        ...plan,
        connectionMap: {
          ...plan.connectionMap,
          connections: plan.connectionMap?.connections ?? [],
          nodeOffsets: finalOffsets,
        },
      }

      setGenerationStep(1)
      await pauseForPaint()
      const applied = gadgets.map((gadget) => applyDeskGadgetUsage(planWithLayout, gadget))
      const wiringResult = generateWiring(applied, planWithLayout, lang)
      const connections = reconcileMap(
        plan.connectionMap?.connections ?? [],
        applied,
        planWithLayout,
        lang,
      )

      setGenerationStep(2)
      await pauseForPaint()
      await updateWith(planId, (latest) => ({
        ...latest,
        wiringResult,
        connectionMap: {
          ...latest.connectionMap,
          connections,
          nodeOffsets: finalOffsets,
        },
        updatedAt: new Date().toISOString(),
      }))
      await saveFirstSetupDraft({ screen: 'WiringResult', planId }).catch(() => {})
      analytics.track(EVENTS.WIRING_GENERATION_COMPLETED, {
        duration_ms: Date.now() - startedAt,
        gadget_count: plan.selectedGadgetIds.length,
        connection_count: wiringResult.connections.length,
        required_cable_count: wiringResult.requiredCables.reduce((sum, cable) => sum + cable.count, 0),
        warning_count: wiringResult.warnings.length,
        outlet_count: plan.outletCount ?? 2,
      })
      hapticSuccess()

      // 生成を待つ間に戻る操作で閉じていたら、replace は呼んだこの画面ではなく、その時点で一番上の
      // 画面を置き換える。マイデスク一覧が配線図に置き換わると戻り先が無くなり、一覧へ戻れなくなっていた。
      // 保存と作成途中の記録は済んでいるので、続きは一覧から開ける。上に別の画面が積まれて裏に
      // 残っている場合に覆いが出たまま操作できなくならないよう、生成中の表示も戻す
      if (!navigation.isFocused()) {
        setGenerating(false)
        generationInFlightRef.current = false
        return
      }
      if (openPhotos || (plan.images?.length ?? 0) === 0) {
        navigation.replace('PhotoFill', { planId, fromSetup: true })
      } else {
        navigation.replace('WiringResult', { planId })
      }
    } catch (error) {
      analytics.track(EVENTS.WIRING_GENERATION_FAILED, {
        duration_ms: Date.now() - startedAt,
        gadget_count: plan.selectedGadgetIds.length,
        ...errorProperties(error),
      })
      setGenerationError(true)
    } finally {
      setGenerating(false)
      generationInFlightRef.current = false
    }
  }, [gadgets, lang, navigation, nodeOffsets, plan, planId, updateWith])

  // 図が描けなくなったときの「配置と配線をリセット」（WiringResultScreen と同じ中身）。
  // この画面は位置を手元の state で持つので、そちらも空にする
  const handleResetLayout = useCallback(async () => {
    evictPlanLayoutCache(planId)
    restorePlanLayoutCache(planId)
    setNodeOffsets({})
    await updateWith(planId, (prev) => resetPlanLayout(prev, gadgets, lang))
  }, [gadgets, lang, planId, updateWith])

  const handleConfirmPlacement = useCallback((_rewired: boolean, offsets?: Record<string, NodeOffset>) => {
    void finishPlacement(offsets)
  }, [finishPlacement])

  const handleProgressStep = useCallback((step: 0 | 1 | 2 | 3) => {
    if (step === 0) backToSetupStep(navigation, 'PurposeSelection', {
      initialPurposes: plan?.purposes ?? [],
      initialOtherPurposeLabel: plan?.otherPurposeLabel,
      initialOtherPurposeIcon: plan?.otherPurposeIcon,
      initialOtherPurposeColor: plan?.otherPurposeColor,
      returnPlanId: planId,
      resume: { step: 2, name: 'DeskPlacement', params: { planId } } as const,
    })
    if (step === 1 && plan) openGearStep(navigation, plan, gadgets, 'back')
    if (step === 3) void finishPlacement(undefined, true)
  }, [finishPlacement, gadgets, navigation, plan, planId])

  const loading = plansLoading || gadgetsLoading
  const loadError = plansLoadError || gadgetsLoadError
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.centered, { backgroundColor: C.bgList }]}>
        <ActivityIndicator color={C.accentIcon} />
        <Text style={[styles.loadingText, { color: C.textMuted }]}>
          {lang === 'ja' ? '配置を準備しています' : 'Preparing the layout'}
        </Text>
      </SafeAreaView>
    )
  }
  if (loadError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
        <RetryState
          message={lang === 'ja' ? '配置を読み込めませんでした。' : 'Could not load the layout.'}
          onRetry={() => { void reloadPlans(); reloadGadgets() }}
        />
      </SafeAreaView>
    )
  }
  if (!plan || !previewPlan) {
    return (
      <SafeAreaView style={[styles.container, styles.centered, { backgroundColor: C.bgList }]}>
        <Text style={[styles.loadingText, { color: C.textMuted }]}>
          {lang === 'ja' ? 'デスクが見つかりません' : 'Desk not found'}
        </Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
      <SetupScreenHelp>
      <SetupProgress current={2} onStepPress={handleProgressStep} />
      <View style={[styles.intro, { backgroundColor: C.card, borderBottomColor: C.border }]}>
        <Text style={[styles.title, { color: C.text }]}>
          {lang === 'ja' ? '実際のデスクに近づける' : 'Match your real desk'}
        </Text>
        {/* 操作の説明は配線図の帯（完了ボタンの上）と同じ文言を使う */}
        <Text style={[styles.description, { color: C.textSub }]}>
          {lang === 'ja'
            ? `${PLACEMENT_MOVE_HINT.ja}。あとから配線図でも直せます。`
            : `${PLACEMENT_MOVE_HINT.en}. You can change it later in the wiring map.`}
        </Text>
      </View>

      <View ref={layoutAreaRef} collapsable={false} style={styles.map}>
        {previewConnections == null ? (
          <View style={[styles.centered, styles.mapLoading]}>
            <ActivityIndicator color={C.accentIcon} />
            <Text style={[styles.loadingText, { color: C.textMuted }]}>
              {lang === 'ja' ? '配置を準備しています' : 'Preparing the layout'}
            </Text>
          </View>
        ) : (
          <ConnectionMap
            active
            gadgets={selectedGadgets}
            connections={previewConnections}
            plan={previewPlan}
            readOnly={false}
            nodeOffsets={nodeOffsets}
            onNodeOffsetsChange={setNodeOffsets}
            nodeSizes={plan.connectionMap?.nodeSizes}
            placementMode
            placementConfirmLabel={lang === 'ja' ? '完了' : 'Done'}
            onConfirmPlacement={handleConfirmPlacement}
            onResetLayout={handleResetLayout}
          />
        )}
        {previewConnections !== null && selectedGadgets.length === 0 && (
          <SetupActionFooter
            showGuide
            absolute
            title={lang === 'ja' ? '完了' : 'Done'}
            onPress={() => { void finishPlacement() }}
            note={lang === 'ja' ? '配置する機材がないため、このまま次へ進めます。' : 'No gear needs arranging. Continue to the next step.'}
          />
        )}
        {generationError && (
          <View style={[styles.errorBanner, { backgroundColor: C.card, borderColor: C.danger }]} accessibilityRole="alert">
            <AppIcon name="alert-circle-outline" size={18} color={C.danger} />
            <Text style={[styles.errorText, { color: C.danger }]}>
              {lang === 'ja' ? '生成できませんでした。配置を残したまま再試行できます。' : 'Could not generate your desk. Your layout is preserved.'}
            </Text>
          </View>
        )}
      </View>

      {generating && (
        <View
          style={[styles.generatingOverlay, { backgroundColor: C.bgList }]}
          accessibilityViewIsModal
          accessibilityRole="progressbar"
          accessibilityLabel={lang === 'ja' ? 'マイデスクを生成中' : 'Creating your desk'}
        >
          <View style={[styles.generationIcon, { backgroundColor: C.accent + '18' }]}>
            <AppIcon name="desk" size={38} color={C.accentIcon} centered />
          </View>
          <Text style={[styles.generatingTitle, { color: C.text }]}>
            {lang === 'ja' ? 'マイデスクを生成中…' : 'Creating your desk…'}
          </Text>
          <Text style={[styles.generatingDescription, { color: C.textMuted }]}>
            {lang === 'ja' ? 'このまま少しお待ちください' : 'This will only take a moment'}
          </Text>
          <View style={styles.steps}>
            {GENERATION_STEPS.map((step, index) => {
              const done = index < generationStep
              const active = index === generationStep
              return (
                <View key={step.en} style={styles.stepRow}>
                  <View style={[styles.stepIcon, { borderColor: done || active ? C.accentIcon : C.border, backgroundColor: done ? C.accent : C.card }]}>
                    {done
                      ? <AppIcon name={ICONS.check} size={14} color={C.onAccent} centered />
                      : active
                        ? <ActivityIndicator size="small" color={C.accentIcon} />
                        : null}
                  </View>
                  <Text style={[styles.stepText, { color: done || active ? C.text : C.textMuted }]}>
                    {lang === 'ja' ? step.ja : step.en}
                  </Text>
                </View>
              )
            })}
          </View>
        </View>
      )}
      </SetupScreenHelp>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 13, fontWeight: '600' },
  intro: {
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18, lineHeight: 25, fontWeight: '800' },
  description: { marginTop: 3, fontSize: 12, lineHeight: 18 },
  map: { flex: 1 },
  mapLoading: { flex: 1 },
  errorBanner: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: UI_METRICS.panelRadius,
    borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  generatingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  generationIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  generatingTitle: { fontSize: 22, lineHeight: 30, fontWeight: '800', textAlign: 'center' },
  generatingDescription: { marginTop: 6, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  steps: { alignSelf: 'stretch', maxWidth: 260, marginTop: 28, gap: 14 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
})
