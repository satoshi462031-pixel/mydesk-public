import { useMemo, useState } from 'react'
import { useToday } from '../../hooks/useToday'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AppIcon } from '../atoms/AppIcon'
import { IconCircleButton } from '../atoms/IconCircleButton'
import { AppColors, useApp } from '../../context/AppContext'
import { useEntitlement } from '../../hooks/useEntitlement'
import { usePlans } from '../../hooks/usePlans'
import { DeskPlan, Gadget } from '../../types'
import { localDateKey, playbackTimelineSummary, usagePeriodsOf, yearsAgoDateKey } from '../../utils/deskTimeline'
import { DeskHistoryAnimationModal } from './DeskHistoryAnimationModal'
import { DeskHistoryLayoutEditModal } from './DeskHistoryLayoutEditModal'
import { DeskHistoryDemoModal } from './DeskHistoryDemoModal'
import { UI_METRICS } from '../../constants/ui'
import { ICONS } from '../../constants/icons'

interface Props {
  plan: DeskPlan
  gadgets: Gadget[]   // プランで選択中のガジェット
  colors: AppColors
  lang: 'ja' | 'en'
  /**
   * 共有デスク（他人のデスク）。プランはローカルに存在しない一時オブジェクトなので
   * 配置の編集＝保存ができない。編集ボタンを出さない。
   */
  readOnly?: boolean
  /**
   * readOnly だが自分の公開デスクを見ている。このときだけ自分の契約の範囲に絞る
   * （無料の投稿者が公開ページからマイデスク側の1年の上限を抜けられないように）。
   * 他人のデスクは全期間。082 は投稿者の契約（desks.owner_tier）で絞っていたが、
   * 誰でも課金者を抜き出せる列になるので 103 でやめた
   */
  ownDesk?: boolean
  /** 制限より前の記録を見ようとしたとき（Paywall へ誘導する） */
  onRequirePro: () => void
  compact?: boolean
  /** 投稿者行など幅の限られた場所では、再生アイコンだけを表示する */
  iconOnly?: boolean
  /** 再生の最後のページの共有（公開URLを送る）。公開URLが無いデスクでは渡さない */
  onShare?: () => void
  onRecordDate?: (gadgetId?: string) => void
}

const RECENT_HISTORY_DAYS = 90

export function DeskHistoryEntryCard({ plan, gadgets, colors, lang, readOnly = false, ownDesk = false, onRequirePro, compact = false, iconOnly = false, onShare, onRecordDate }: Props) {
  const ja = lang === 'ja'
  const { getLimit } = useEntitlement()
  const { updateWith } = usePlans()
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)

  const { historyGrain } = useApp()

  // 再生：無料プランでも開けるが、直近1年より前は見られない（モーダル側で制限）。
  // 他人のデスクは誰が見ても全期間（閲覧者の契約で範囲を変えない）。自分の公開デスクだけ
  // 自分の契約で絞り、公開ページからマイデスク側の上限を抜けられないようにする
  const yearsLimit = !readOnly || ownDesk ? getLimit('historyAnimationYears') : -1
  // 配置編集は引き続きPro限定（無料プランでは編集不可）
  const editLocked = !readOnly && yearsLimit !== -1
  // カードに出すのは「実際に再生できる範囲」。全期間の件数を出すと、無料プランで
  // 開いたときに見られる枚数と食い違う（開く前と後で数字が変わって見える）。
  // 配線を組まない軽量版で、まとめる単位・期間の制限を再生と揃えて数える
  const today = useToday()
  const cutoff = yearsLimit > 0 ? yearsAgoDateKey(yearsLimit, today) : null
  const { pageCount, firstChangeDate: first } = useMemo(
    () => playbackTimelineSummary(gadgets, historyGrain, cutoff, localDateKey(today)),
    [gadgets, historyGrain, cutoff, today],
  )

  // 無料の期間制限で短く見えているだけの歴史には、日付の追加を勧めない。
  const fullHistory = useMemo(
    () => playbackTimelineSummary(gadgets, historyGrain, null, localDateKey(today)),
    [gadgets, historyGrain, today],
  )

  if (pageCount < 1 && (compact || readOnly)) return null

  const startLabel = first ? `${first.slice(0, 4)}/${Number(first.slice(5, 7))}` : ''
  const summary = pageCount < 1
    ? (ja ? '機材の導入時期を記録すると、歩みを再生できます' : 'Record when you introduced your gear to replay its story')
    : first
    ? (ja
      ? `${startLabel} 〜 現在 ・ ${pageCount}イベント`
      : `${startLabel} – now ・ ${pageCount} events`)
    // 制限より前にしか変更が無いデスク。再生できるのは現在の構成の1ページだけ。
    // 絞るのは自分のデスクだけなので、ここに来るのは本人が見ているとき
    : (ja
      ? `現在の構成のみ ・ ${yearsLimit}年より前は Pro`
      : `Current setup only · Pro for older than ${yearsLimit}y`)

  const recentDate = new Date(today)
  recentDate.setDate(recentDate.getDate() - RECENT_HISTORY_DAYS)
  const recentCutoff = localDateKey(recentDate)
  const showDateHint = !readOnly && (fullHistory.pageCount <= 2 || (!!fullHistory.firstChangeDate && fullHistory.firstChangeDate >= recentCutoff))
  const dateGadget = gadgets.find(g => !g.isCandidate && (usagePeriodsOf(g).length === 0 || usagePeriodsOf(g).some(period => period.startedAtSource === 'registered')))
    ?? gadgets.find(g => !g.isCandidate)

  const openEdit = () => { editLocked ? onRequirePro() : setEditOpen(true) }

  const trigger = compact ? (
    <View style={[styles.compactBar, iconOnly && { borderRadius: UI_METRICS.pillRadius, flexDirection: 'row-reverse' }, { backgroundColor: colors.card + 'D9', borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.compactBtn}
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={ja ? `デスクの歴史を再生、${summary}` : `Play desk history, ${summary}`}
      >
        <AppIcon name={ICONS.history} size={18} color={colors.accentIcon} />
        {!iconOnly && <Text style={[styles.compactLabel, { color: colors.text }]}>{ja ? '歩みを再生' : 'Replay story'}</Text>}
      </TouchableOpacity>
      {!readOnly && !editLocked && (
        <TouchableOpacity
          style={[styles.compactBtn, styles.compactEdit, { borderLeftColor: colors.border }, iconOnly && { borderLeftWidth: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border }]}
          onPress={openEdit}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={ja ? '歴史画面の配置を編集' : 'Edit history layout'}
          accessibilityHint={ja
            ? '再生中に機材を表示する位置を調整します'
            : 'Adjusts where gadgets appear during playback'}
        >
          <AppIcon name={ICONS.edit} size={17} color={colors.accentIcon} />
        </TouchableOpacity>
      )}
    </View>
  ) : (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.mainRow}>
      <TouchableOpacity style={styles.playButton} onPress={() => setOpen(true)} disabled={pageCount < 1}
        activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ disabled: pageCount < 1 }}
        accessibilityLabel={ja ? `このデスクの歩みを再生、${summary}` : `Replay this desk's story, ${summary}`}>
        <View style={[styles.iconWrap, { backgroundColor: colors.accent + '18' }]}>
          <AppIcon name={ICONS.history} size={18} color={colors.accentIcon} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: colors.text }]}>
            {pageCount < 1 ? (ja ? 'デスクの歴史を残そう' : 'Start your desk story') : (ja ? 'このデスクの歩みを再生' : "Replay this desk's story")}
          </Text>
          <Text style={[styles.description, { color: colors.textSub }]}>{ja ? '機材が増え、入れ替わってきた歴史をアニメーションで' : 'Watch your gear grow and change through time'}</Text>
          <Text style={[styles.sub, { color: colors.textMuted }]}>{summary}</Text>
        </View>
      </TouchableOpacity>
        {/* 歴史の配置編集（共有デスクは保存先がないため出さない） */}
        {!readOnly && pageCount > 0 && (
          <IconCircleButton
            name={editLocked ? 'crown-outline' : ICONS.edit}
            diameter={32}
            size={17}
            color={editLocked ? colors.pro : colors.accentIcon}
            background={colors.chip}
            onPress={openEdit}
            hitSlop={6}
            accessibilityLabel={ja ? '歴史画面の配置を編集' : 'Edit history layout'}
            accessibilityHint={ja
              ? '再生中に機材を表示する位置を調整します'
              : 'Adjusts where gadgets appear during playback'}
          />
        )}
      </View>
      {showDateHint && <View style={[styles.hintArea, { borderTopColor: colors.separator }]}>
        <Text style={[styles.hint, { color: colors.textSub }]}>{ja
          ? '以前から使っている機材の導入時期を入れると、過去の歩みも残せます。'
          : 'Add when you started using older gear to include the past in your story.'}</Text>
        <View style={styles.hintActions}>
          <TouchableOpacity style={styles.hintButton} onPress={() => setDemoOpen(true)} accessibilityRole="button">
            <Text style={[styles.actionText, { color: colors.accentText }]}>{ja ? '見本を再生' : 'Play demo'}</Text>
          </TouchableOpacity>
          {onRecordDate && <TouchableOpacity style={styles.hintButton} onPress={() => onRecordDate(dateGadget?.id)} accessibilityRole="button">
            <Text style={[styles.actionText, { color: colors.accentText }]}>{dateGadget ? (ja ? '導入時期を追加' : 'Add a start date') : (ja ? '機材を登録' : 'Add gear')}</Text>
          </TouchableOpacity>}
        </View>
      </View>}
    </View>
  )

  return (
    <>
      {trigger}
      {demoOpen && <DeskHistoryDemoModal lang={lang} onClose={() => setDemoOpen(false)} />}

      {open && (
        <DeskHistoryAnimationModal
          visible
          plan={plan}
          gadgets={gadgets}
          lang={lang}
          yearsLimit={yearsLimit}
          onRequirePro={onRequirePro}
          onShare={onShare}
          onClose={() => setOpen(false)}
        />
      )}

      {editOpen && (
        <DeskHistoryLayoutEditModal
          visible
          plan={plan}
          onUpdatePlan={updateWith}
          gadgets={gadgets}
          colors={colors}
          lang={lang}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  // 配線図に重ねる形。図を隠さないよう高さは44ptに抑え、半透明の下地で線から浮かせる
  compactBar: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: UI_METRICS.panelRadius, overflow: 'hidden' },
  compactBtn: { height: UI_METRICS.touchMinSize, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12 },
  compactEdit: { minWidth: UI_METRICS.touchMinSize, borderLeftWidth: StyleSheet.hairlineWidth, paddingHorizontal: 11 },
  compactLabel: { fontSize: 13, fontWeight: '700' },
  card: {
    marginHorizontal: UI_METRICS.screenGutter,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: UI_METRICS.cardRadius,
    borderWidth: 1,
  },
  mainRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playButton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: UI_METRICS.touchMinSize },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700' },
  description: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  sub: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  hintArea: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 10 },
  hint: { fontSize: 12, lineHeight: 17 },
  hintActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hintButton: { minHeight: UI_METRICS.touchMinSize, justifyContent: 'center', paddingHorizontal: 8 },
  actionText: { fontSize: 13, fontWeight: '700' },
})
