import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  InteractionManager,
  Modal,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AppIcon } from '../atoms/AppIcon'
import { AppColors, useApp } from '../../context/AppContext'
import { DeskPlan, Gadget } from '../../types'
import { buildTimeline, formatEventDateParts, localDateKey, TimelineEvent } from '../../utils/deskTimeline'
import { resolveHistoryLayoutInputs } from '../../utils/historyLayouts'
import { ConnectionMap } from './ConnectionMap'
import { ICONS } from '../../constants/icons'
import { UI_METRICS } from '../../constants/ui'

interface Props {
  visible: boolean
  plan: DeskPlan                 // 配置（nodeOffsets / nodeSizes / historyLayout）の保存先
  /**
   * 保存する時点の最新のデスクを受け取って次の値を返す関数で保存する（usePlans の updateWith）。
   * 開いた時点の控えから作った全体を渡すと、編集中に裏で入った保存（配線図の再計算など）を黙って消す
   */
  onUpdatePlan: (planId: string, fn: (prev: DeskPlan) => DeskPlan, options?: { awaitPersistence?: boolean }) => Promise<void> | void
  gadgets: Gadget[]              // 対象デスクのガジェット（導入日/撤去日を持つ）
  colors: AppColors
  lang: 'ja' | 'en'
  onClose: () => void
}

/**
 * その日時点で使う配置。
 * 基本はマイデスクの配線図で調整した nodeOffsets / nodeSizes。
 * その日だけ手で直してあれば historyLayout の内容で上書きする。
 */
/**
 * 歴史アニメーションの配置エディタ（マイページ →「デスクの歴史」から開く）。
 * 日付を選び、その日の配線図のノード移動・リサイズだけを行う専用ページ。
 * 再生（DeskHistoryAnimationModal）から編集機能を分離したもので、
 * 保存内容（historyLayout / nodeOffsets / nodeSizes）は再生側がそのまま読む。
 */
export function DeskHistoryLayoutEditModal({ visible, plan, onUpdatePlan, gadgets, colors, lang, onClose }: Props) {
  const ja = lang === 'ja'
  const { isDark, reduceMotion } = useApp()
  const insets = useSafeAreaInsets()

  // プランは編集のたびに書き換わるが、タイムラインは日付・ポート構成から決まり
  // 配置には依存しないので、組み直さないよう ref 経由で最新を参照する
  const planRef = useRef(plan)
  useEffect(() => {
    planRef.current = plan
  }, [plan])

  // タイムライン構築（配線エンジンを日数ぶん回すので同期実行しない）。
  // レイアウト計算は ConnectionMap が選択中の日だけ行うため、再生側のような全日事前計算は不要
  const [events, setEvents] = useState<TimelineEvent[] | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!visible) { setEvents(null); setIndex(0); return }
    let cancelled = false
    const task = InteractionManager.runAfterInteractions(() => {
      const today = localDateKey()
      const built = buildTimeline(gadgets, planRef.current, lang, 'month', today)
      if (!cancelled) setEvents(built)
    })
    return () => { cancelled = true; task.cancel() }
  }, [visible, gadgets, lang])

  const event = events?.[index] ?? null

  // 再生と同じく、全期間で揃えた大きさで描く（揃えるには全日の大きさが要るので日ごとに解かない）
  const layoutInputs = useMemo(
    () => events ? resolveHistoryLayoutInputs(plan, events, events.at(-1)?.date).inputs : null,
    [events, plan],
  )

  // 編集用の合成プラン。id に日付を混ぜてレイアウトキャッシュを日付ごとに分ける。
  // 再生側と同じ renderGadgets/renderConnections を入力にすることで、撤去途中のガジェット・
  // しまう線も含めたノード集合になり、再生時と同じ絶対位置で編集できる
  const editPlan: DeskPlan | null = useMemo(() => {
    const eff = layoutInputs?.[index]
    if (!event || !eff) return null
    return {
      ...plan,
      id: `${plan.id}#${event.date}`,
      selectedGadgetIds: event.renderGadgets.map((g) => g.id),
      placements: plan.placements,
      connectionMap: { connections: event.renderConnections, nodeOffsets: eff.nodeOffsets, nodeSizes: eff.nodeSizes },
    }
  }, [event, layoutInputs, index, plan])

  /** その日ぶんの配置上書き（historyLayout）を保存する */
  const saveHistoryLayout = useCallback(async (
    date: string,
    patch: { nodeOffsets?: Record<string, { dx: number; dy: number }>; nodeSizes?: Record<string, { w: number; h: number }> },
  ) => {
    await onUpdatePlan(planRef.current.id, (cur) => {
      const cm = cur.connectionMap ?? { connections: [] }
      const nextPlan: DeskPlan = {
        ...cur,
        connectionMap: {
          ...cm,
          historyLayout: {
            ...(cm.historyLayout ?? {}),
            [date]: { ...(cm.historyLayout?.[date] ?? {}), ...patch },
          },
        },
        updatedAt: new Date().toISOString(),
      }
      planRef.current = nextPlan
      return nextPlan
    }, { awaitPersistence: true })
  }, [onUpdatePlan])

  /**
   * ノードの大きさ変更は「その日だけ」ではなく全期間に反映する（リサイズ＝その
   * ガジェットの表示サイズという性質のもの。日によって大きさが違うと再生が不自然）。
   * ベースの nodeSizes/nodeOffsets を更新し、過去にその日だけの上書き（historyLayout）が
   * 対象ノードに残っていれば、それに隠されて反映されない日が出ないよう合わせて消す。
   */
  const saveNodeSizesGlobal = useCallback(async (
    date: string,
    sizes: Record<string, { w: number; h: number }>,
    offsets: Record<string, { dx: number; dy: number }>,
    anchoredIds: readonly string[] = [],
  ) => {
    const cur = planRef.current
    const dayIndex = events?.findIndex((e) => e.date === date) ?? -1
    if (!events || dayIndex < 0) return
    const before = resolveHistoryLayoutInputs(cur, events, events.at(-1)?.date).inputs[dayIndex]
    // ConnectionMap からは「その日時点の効いているサイズ全部」が渡ってくるため、
    // 実際に変わったノードだけを差分で特定する。揃えた大きさも渡ってくるので、描いた値と比べる
    // （手の指定と比べると、揃えただけのノードまで手で決めた大きさとして保存してしまう）
    const changedIds = Object.keys(sizes).filter((id) => {
      const b = before.nodeSizes[id]
      const a = sizes[id]
      return !b || b.w !== a.w || b.h !== a.h
    })
    if (changedIds.length === 0) return

    const pick = <T,>(rec: Record<string, T>, ids: string[]): Record<string, T> => {
      const out: Record<string, T> = {}
      for (const id of ids) if (rec[id] !== undefined) out[id] = rec[id]
      return out
    }
    const omit = <T,>(rec: Record<string, T> | undefined, ids: string[]): Record<string, T> | undefined => {
      if (!rec) return rec
      const out: Record<string, T> = {}
      let changed = false
      for (const [k, v] of Object.entries(rec)) {
        if (ids.includes(k)) { changed = true; continue }
        out[k] = v
      }
      return changed ? out : rec
    }
    // 変わったノードの特定は画面に出ている配置で行い、書き込みは保存する時点の最新のデスクへ当てる
    await onUpdatePlan(cur.id, (latest) => {
      const latestMap = latest.connectionMap ?? { connections: [] }
      const nextHistoryLayout: NonNullable<DeskPlan['connectionMap']>['historyLayout'] = {}
      for (const [d, day] of Object.entries(latestMap.historyLayout ?? {})) {
        nextHistoryLayout[d] = {
          ...day,
          nodeSizes: omit(day.nodeSizes, changedIds),
          nodeOffsets: omit(day.nodeOffsets, changedIds),
        }
      }
      if (anchoredIds.length > 0) {
        const day = nextHistoryLayout[date] ?? {}
        nextHistoryLayout[date] = { ...day, nodeOffsets: { ...day.nodeOffsets, ...pick(offsets, [...anchoredIds]) } }
      }
      const nextPlan: DeskPlan = {
        ...latest,
        connectionMap: {
          ...latestMap,
          nodeSizes: { ...(latestMap.nodeSizes ?? {}), ...pick(sizes, changedIds) },
          nodeOffsets: { ...(latestMap.nodeOffsets ?? {}), ...pick(offsets, changedIds) },
          historyLayout: nextHistoryLayout,
        },
        updatedAt: new Date().toISOString(),
      }
      planRef.current = nextPlan
      return nextPlan
    })
  }, [events, onUpdatePlan])

  return (
    <Modal visible={visible} animationType={reduceMotion ? 'fade' : 'slide'} onRequestClose={onClose}>
      {visible && (
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.card} />
      )}

      <View style={[styles.fullscreen, { backgroundColor: colors.card }]}>
        {/* ── ヘッダー ── */}
        <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.separator }]}>
          {/* 閉じる（×）は置かない。動かした位置はその場で保存しているので、× が
              「取り消して閉じる」に見えると、押しても戻らないことに驚かれる。閉じるのは「完了」だけ */}
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
              {ja ? '歴史の配置を編集' : 'Edit History Layout'}
            </Text>
            <Text style={[styles.headerSub, { color: colors.textMuted }]} numberOfLines={1}>
              {plan.name}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={[styles.doneBtn, { backgroundColor: colors.accent }]}>
            <Text style={[styles.doneText, { color: colors.onAccent }]}>{ja ? '完了' : 'Done'}</Text>
          </TouchableOpacity>
        </View>

        {!events ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={colors.accentIcon} />
            <Text style={[styles.centerText, { color: colors.textSub }]}>
              {ja ? '歴史を読み込み中…' : 'Building history…'}
            </Text>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.centerBox}>
            <AppIcon name={ICONS.history} size={32} color={colors.textMuted} />
            <Text style={[styles.centerText, { color: colors.textSub }]}>
              {ja
                ? 'このデスクに機材がないため、編集できる歴史がありません。'
                : 'No gadgets in this desk, so there is no history to edit.'}
            </Text>
          </View>
        ) : (
          <>
            {/* ── 日付セレクタ：編集する日を選ぶ ── */}
            <View style={[styles.dateBar, { borderBottomColor: colors.separator }]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateBarContent}>
                {events.map((e, i) => {
                  const active = i === index
                  const p = formatEventDateParts(e.date)
                  return (
                    <TouchableOpacity
                      key={e.date}
                      style={[
                        styles.dateChip,
                        { borderColor: active ? colors.accentIcon : colors.border, backgroundColor: active ? colors.accent + '18' : colors.chip },
                      ]}
                      onPress={() => setIndex(i)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.dateChipYear, { color: active ? colors.accentText : colors.textMuted }]}>{p.year}</Text>
                      <Text style={[styles.dateChipDay, { color: active ? colors.accentText : colors.text }]}>{p.dayMonth}</Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            </View>

            {/* ── その日の配線図（移動・リサイズのみ許可） ── */}
            <View style={styles.canvas}>
              {event && editPlan && (
                <ConnectionMap
                  readOnly
                  layoutEditable
                  active
                  gadgets={event.renderGadgets}
                  connections={event.renderConnections}
                  plan={editPlan}
                  nodeOffsets={editPlan.connectionMap?.nodeOffsets}
                  nodeSizes={editPlan.connectionMap?.nodeSizes}
                  onNodeOffsetsChange={(offsets) => saveHistoryLayout(event.date, { nodeOffsets: offsets })}
                  onNodeSizesChange={(sizes, offsets, _ids, anchoredIds) => saveNodeSizesGlobal(event.date, sizes, offsets, anchoredIds)}
                />
              )}
            </View>

            {/* ── 操作ヒント ── */}
            <View style={[styles.hintBar, { paddingBottom: insets.bottom + 10, borderTopColor: colors.separator }]}>
              <Text style={[styles.hintText, { color: colors.textMuted }]}>
                {ja
                  ? '長押しで移動（この日だけ） / 右下の角でリサイズ（全期間に反映）'
                  : 'Hold to move (this day only) / drag the corner to resize (applies to all days)'}
              </Text>
            </View>
          </>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fullscreen: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: { flex: 1, minWidth: 0 },
  headerTitle:  { fontSize: 16, fontWeight: '800' },
  headerSub:    { fontSize: 11, fontWeight: '600', marginTop: 1 },
  doneBtn:      { borderRadius: UI_METRICS.cardRadius, paddingHorizontal: 14, paddingVertical: 6 },
  doneText:     { fontSize: 13, fontWeight: '800' },

  centerBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  centerText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },

  dateBar:        { borderBottomWidth: StyleSheet.hairlineWidth },
  dateBarContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  dateChip:       { alignItems: 'center', borderWidth: 1.5, borderRadius: UI_METRICS.controlRadius, paddingHorizontal: 12, paddingVertical: 5, minWidth: 64 },
  dateChipYear:   { fontSize: 10, fontWeight: '700' },
  dateChipDay:    { fontSize: 13, fontWeight: '800', marginTop: 1 },

  canvas: { flex: 1 },

  hintBar:  { paddingTop: 8, paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth },
  hintText: { fontSize: 11, fontWeight: '600', textAlign: 'center', lineHeight: 16 },
})
