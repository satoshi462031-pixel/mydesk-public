import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { AppColors } from '../../context/AppContext'
import { usePlans } from '../../hooks/usePlans'
import { DeskPlan, Gadget } from '../../types'
import { applyDeskGadgetUsage } from '../../utils/deskGadgetUsage'
import { DeskHistoryAnimationModal } from './DeskHistoryAnimationModal'
import { DeskHistoryLayoutEditModal } from './DeskHistoryLayoutEditModal'
import { BottomSheetModal } from '../molecules/BottomSheetModal'
import { UI_METRICS } from '../../constants/ui'

interface Props {
  visible: boolean            // プラン選択シートを開くか
  plans: DeskPlan[]
  gadgets: Gadget[]           // ライブラリ全体のガジェット
  colors: AppColors
  lang: 'ja' | 'en'
  /** 'play' = 歴史アニメーションを再生 / 'edit' = 歴史の配置を編集 */
  mode?: 'play' | 'edit'
  /** 再生モードで遡って見られる年数（-1 = 無制限）。無料プランは直近1年のみ */
  yearsLimit?: number
  /** 制限より前の記録を見ようとしたときに Paywall へ誘導する */
  onRequirePro?: () => void
  onClose: () => void
}

/**
 * 「デスクの歴史」の入口。
 * ① 対象のデスク（プラン）を選ぶボトムシート（スライドイン）
 * ② 選んだデスクのガジェット・接続を、再生（DeskHistoryAnimationModal）または
 *    配置エディタ（DeskHistoryLayoutEditModal）へ渡す
 */
export function DeskHistoryLauncher({ visible, plans, gadgets, colors, lang, mode = 'play', yearsLimit = -1, onRequirePro, onClose }: Props) {
  const ja = lang === 'ja'
  const { updateWith: updatePlanWith } = usePlans()
  const [playPlanId, setPlayPlanId] = useState<string | null>(null)

  // シートを閉じたら選択状態もリセット
  useEffect(() => { if (!visible) setPlayPlanId(null) }, [visible])

  const playPlan = plans.find((p) => p.id === playPlanId) ?? null

  const playGadgets = useMemo(
    () => (playPlan
      ? gadgets
          .filter((g) => playPlan.selectedGadgetIds.includes(g.id) || playPlan.gadgetUsage?.[g.id] != null)
          .map((g) => applyDeskGadgetUsage(playPlan, g))
      : []),
    [playPlan, gadgets],
  )

  return (
    <>
      <BottomSheetModal visible={visible && !playPlan} onDismiss={onClose} sheetStyle={styles.sheet}>
          <Text style={[styles.title, { color: colors.text }]}>
            {mode === 'edit'
              ? (ja ? '編集するデスクを選択' : 'Choose a desk to edit')
              : (ja ? '再生するデスクを選択' : 'Choose a desk to play')}
          </Text>

          {plans.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textMuted }]}>
              {ja ? 'デスクがありません。マイデスクから作成してください。' : 'No desks yet. Create one from MyDesk.'}
            </Text>
          ) : (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {plans.map((p) => (
                <PlanRow
                  key={p.id}
                  plan={p}
                  count={gadgets.filter((g) => p.selectedGadgetIds.includes(g.id)).length}
                  colors={colors}
                  ja={ja}
                  mode={mode}
                  onPress={() => setPlayPlanId(p.id)}
                />
              ))}
            </ScrollView>
          )}

          <TouchableOpacity style={[styles.cancel, { backgroundColor: colors.chip }]} onPress={onClose}>
            <Text style={[styles.cancelText, { color: colors.text }]}>{ja ? 'キャンセル' : 'Cancel'}</Text>
          </TouchableOpacity>
      </BottomSheetModal>

      {playPlan && (mode === 'edit' ? (
        <DeskHistoryLayoutEditModal
          visible
          plan={playPlan}
          onUpdatePlan={updatePlanWith}
          gadgets={playGadgets}
          colors={colors}
          lang={lang}
          onClose={() => { setPlayPlanId(null); onClose() }}
        />
      ) : (
        <DeskHistoryAnimationModal
          visible
          plan={playPlan}
          gadgets={playGadgets}
          lang={lang}
          yearsLimit={yearsLimit}
          onRequirePro={onRequirePro}
          onClose={() => { setPlayPlanId(null); onClose() }}
        />
      ))}
    </>
  )
}

function PlanRow({ plan, count, colors, ja, mode, onPress }: {
  plan: DeskPlan; count: number; colors: AppColors; ja: boolean; mode: 'play' | 'edit'; onPress: () => void
}) {
  return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: colors.separator }]}
        onPress={onPress}
        activeOpacity={0.75}
      >
        <View style={[styles.rowIcon, { backgroundColor: colors.accent + '18' }]}>
          <AppIcon name="desk" size={18} color={colors.accentIcon} />
        </View>
        <View style={styles.rowInfo}>
          <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>{plan.name}</Text>
          <Text style={[styles.rowMeta, { color: colors.textMuted }]}>
            {ja ? `${count}点の機材` : `${count} ${count === 1 ? 'gadget' : 'gadgets'}`}
          </Text>
        </View>
        <AppIcon name={mode === 'edit' ? 'pencil-circle-outline' : 'play-circle-outline'} size={22} color={colors.accentIcon} />
      </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  sheet: {
    gap: 14, maxHeight: '72%',
  },
  title:  { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  empty:  { fontSize: 13, textAlign: 'center', paddingVertical: 28, lineHeight: 19 },
  list:   { flexGrow: 0 },

  row:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 15, fontWeight: '700' },
  rowMeta: { fontSize: 12, marginTop: 1 },

  cancel:     { alignItems: 'center', borderRadius: UI_METRICS.panelRadius, paddingVertical: 13 },
  cancelText: { fontSize: 14, fontWeight: '700' },
})
