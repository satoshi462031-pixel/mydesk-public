// 更新一覧（ベルの中身）— 保存したデスクとフォロー中の人（084）のデスクのうち、
// 前に見たときより中身が変わったもの・新しく公開されたものだけを並べる。
//
// 対象を「自分が気にしていると言ったデスク・人」に絞っているので、件数は自然に頭打ちになる。
// みんなのデスク全体の更新を流すと、知らない人のデスクで一覧が埋まって読まなくなる。
//
// 見た目は YouTube の通知一覧に合わせる（左に投稿者、中に何が起きたか、右にデスクの写真）。
// 「新しく公開」と「更新」は行の文で言い分け、節は時期（今日・今週・それ以前）で切る。
// 種類で節を分けていた頃は、同じ人の出来事が2か所に割れ、新しい順にも読めなかった。
// 何が変わったかは summarizeDeskChanges が出す（「モニターを入れ替え」まで言える）。
// 更新日だけを出しても、年に数回しか動かないデスクでは出来事にならない。
//
// 読み込みと既読の同期は useDeskUpdates が持つ。みんなのデスクの先頭に出す更新の行と
// 同じものを見るので、片方だけ既読になることがない。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { useScrollToTopOf } from '../hooks/useScrollToTopOf'
import { RefreshControl, SafeAreaView, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AppIcon } from '../components/atoms/AppIcon'
import { AuthorAvatar } from '../components/atoms/AuthorAvatar'
import { ClapMark } from '../components/atoms/ClapMark'
import { RemoteThumb } from '../components/atoms/RemoteThumb'
import { Skeleton } from '../components/atoms/Skeleton'
import { EmptyState } from '../components/molecules/EmptyState'
import { RetryState } from '../components/molecules/RetryState'
import { ICONS } from '../constants/icons'
import { UI_METRICS } from '../constants/ui'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { DeskUpdateEntry, useDeskUpdates } from '../hooks/useDeskUpdates'
import { FeedStackParamList } from '../types'
import { formatRelativeDay, parseLocalDate } from '../utils/dateFormat'
import { deskUpdateSentence } from '../utils/deskChangeSummary'
import { localizedDemoDeskName } from '../utils/localizedDemoDesk'
import { publicAuthorParts } from '../utils/publicAuthor'
import { toPhotoUrls } from '../utils/publicDeskAdapter'
import { loadReactionsSinceSeen, markReactionsSeen } from '../services/deskReactions'
import { getDeskCoverPhotos } from '../services/desks'
import { DeskReaction, newLikeReactions, reactionsCheckedAt } from '../utils/deskReactions'

type Props = NativeStackScreenProps<FeedStackParamList, 'DeskUpdates'>

type UpdateItem =
  | { kind: 'reaction'; reaction: DeskReaction }
  | { kind: 'desk'; entry: DeskUpdateEntry; at: string; showTime: boolean }

interface UpdateSection {
  key: string
  title: string
  data: UpdateItem[]
}

const AVATAR_SIZE = 44
const THUMB_WIDTH = 80

// changedAt は変更のあった日（YYYY-MM-DD）か、デスクの更新時刻（ISO）。
// 日付だけの値を new Date に渡すと UTC の0時になり、日本より西では前の日に落ちる
function changedAtIso(changedAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(changedAt)) return parseLocalDate(changedAt)?.toISOString() ?? changedAt
  return changedAt
}

function daysAgo(iso: string, now: Date): number {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return Infinity
  const day = (value: Date) => Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
  return Math.max(0, Math.round((day(now) - day(date)) / 86_400_000))
}

export function DeskUpdatesScreen({ navigation }: Props) {
  const { colors: C, lang } = useApp()
  const { user } = useAuth()
  const ja = lang === 'ja'

  const listRef = useRef<SectionList<UpdateItem, UpdateSection>>(null)
  useScrollToTopOf(() => listRef.current)

  // ベルを押して来た画面なので、点は読み込めた時点で消す
  const { entries, loading, loadError, reload, markOpened } = useDeskUpdates({
    userId: user?.id,
    enabled: true,
    clearBell: true,
    placement: 'desk_updates',
  })

  // 自分のデスクに付いた拍手（086・旧いいね）。拍手は「いいと思った」印なので投稿者に届ける。
  // 1件ずつではなくデスクごとにまとめる（人気のデスクほど一覧が埋まるのを防ぐ）。
  // 誰が押したかは出さない。見せたら既読にし、次に開いたときは新しく付いた分だけが並ぶ
  const [reactions, setReactions] = useState<DeskReaction[]>([])
  // 拍手の行にも自分のデスクの写真を置く。更新の行と右端が揃わないと、そこだけ設定画面の行に見えた
  const [reactionCovers, setReactionCovers] = useState<Record<string, string>>({})
  const loadReactions = useCallback(async () => {
    if (!user) { setReactions([]); return }
    try {
      const all = await loadReactionsSinceSeen()
      const fresh = newLikeReactions(all)
      setReactions(fresh)
      const checkedAt = reactionsCheckedAt(all)
      if (checkedAt) await markReactionsSeen(checkedAt)
      // 写真は飾りなので、取れなければ写真なしの器で並べる
      getDeskCoverPhotos(fresh.map((reaction) => reaction.deskId)).then(setReactionCovers, () => {})
    } catch {
      // 取れなくても更新の一覧は出す。反応は次に開いたときに並ぶ（既読にしていない）
    }
  }, [user])
  useFocusEffect(useCallback(() => { void loadReactions() }, [loadReactions]))

  // 開いた行は次の読み込みで一覧から落ちる。それまでの間も未読の点だけは消し、
  // どこまで見たかを一覧のまま分かるようにする
  const [openedIds, setOpenedIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => { setOpenedIds(new Set()) }, [entries])

  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([reload(), loadReactions()])
    setRefreshing(false)
  }, [reload, loadReactions])

  const handleOpen = useCallback((deskId: string) => {
    // 連打の2回目は捨てる（同じデスクが2枚積まれる）
    if (!navigation.isFocused()) return
    markOpened(deskId)
    setOpenedIds((prev) => prev.has(deskId) ? prev : new Set(prev).add(deskId))
    navigation.push('PublicDesk', { deskId, source: 'desk_updates' })
  }, [markOpened, navigation])

  const sections = useMemo<UpdateSection[]>(() => {
    const now = new Date()
    const today: UpdateItem[] = []
    const week: UpdateItem[] = []
    const older: UpdateItem[] = []
    for (const entry of entries) {
      const at = changedAtIso(entry.changedAt)
      const days = daysAgo(at, now)
      const bucket = days === 0 ? today : days < 7 ? week : older
      // 「今日」の節で行ごとに「今日」と言うのは見出しの繰り返し（変化は日付までしか持たない）
      bucket.push({ kind: 'desk', entry, at, showTime: days > 0 })
    }
    return [
      // 自分のデスクへの拍手は、人のデスクの更新より自分に関わるので先頭に置く（YouTube の「重要」の位置）
      { key: 'reactions', title: ja ? 'あなたのデスクへの反応' : 'Reactions to your desks', data: reactions.map((reaction): UpdateItem => ({ kind: 'reaction', reaction })) },
      { key: 'today', title: ja ? '今日' : 'Today', data: today },
      { key: 'week', title: ja ? '今週' : 'This week', data: week },
      { key: 'older', title: ja ? 'それ以前' : 'Earlier', data: older },
    ].filter((section) => section.data.length > 0)
  }, [entries, reactions, ja])

  const [showLoadingPlaceholder, setShowLoadingPlaceholder] = useState(false)
  useEffect(() => {
    if (!loading) { setShowLoadingPlaceholder(false); return }
    // 通知をすぐに取得できるときは、灰色の仮カードだけが一瞬出るのを防ぐ。
    const timer = setTimeout(() => setShowLoadingPlaceholder(true), 200)
    return () => clearTimeout(timer)
  }, [loading])

  const empty = loading ? (
    showLoadingPlaceholder ? <UpdatesSkeleton /> : null
  ) : loadError ? (
    <RetryState
      message={ja ? '更新を読み込めませんでした。' : 'Could not load updates.'}
      onRetry={reload}
    />
  ) : user ? (
    <EmptyState
      icon={ICONS.bell}
      title={ja ? '新しい更新はありません' : 'No new updates'}
      description={ja
        ? '保存・フォロー中のデスクの更新や、新しい公開デスク、あなたのデスクへの拍手がここに届きます'
        : 'Updates to saved or followed desks, new public desks, and applause on your desks appear here.'}
      colors={C}
    />
  ) : (
    <EmptyState
      icon={ICONS.bell}
      title={ja ? 'ログインすると使えます' : 'Sign in to use updates'}
      description={ja
        ? '保存はアカウントに記録されるため、ログインが必要です'
        : 'Saved desks are stored on your account, so logging in is required.'}
      colors={C}
    />
  )

  const renderThumb = (photoUri: string | undefined) => photoUri ? (
    <RemoteThumb uri={photoUri} style={styles.thumb} fallbackLabel={ja ? '写真を読み込めません' : 'Photo unavailable'} />
  ) : (
    <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: C.chip }]}>
      <AppIcon name="desk" size={24} color={C.textMuted} />
    </View>
  )

  const renderReaction = (reaction: DeskReaction) => {
    const title = reaction.title || (ja ? 'あなたのデスク' : 'Your desk')
    const body = ja
      ? `に拍手が${reaction.newLikeCount}件届きました`
      : ` got ${reaction.newLikeCount} new applause`
    // 拍手は版ごとに送れる（095）。最後の更新にどれだけ届いたかが、更新した人への反響になる
    const tally = reaction.roundLikeCount > 0
      ? (ja
        ? `この更新に${reaction.roundLikeCount}件 · 合計 ${reaction.likeCount}`
        : `${reaction.roundLikeCount} on this update · ${reaction.likeCount} total`)
      : (ja ? `合計 ${reaction.likeCount}` : `${reaction.likeCount} total`)
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.isFocused() && navigation.push('PublicDesk', { deskId: reaction.deskId, source: 'desk_updates' })}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={[ja ? '未読' : 'Unread', `${title}${body}`, tally].join(ja ? '、' : ', ')}
      >
        {/* 見せた時点で既読にしているので、反応の行はいつも未読として点を付ける */}
        <View style={[styles.unreadDot, { backgroundColor: C.accent }]} />
        <View style={[styles.avatarSlot, { backgroundColor: C.chip }]}>
          <ClapMark clapped diameter={AVATAR_SIZE} color={C.textMuted} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.message, { color: C.text }]} numberOfLines={3}>
            <Text style={styles.lead}>{title}</Text>{body}
          </Text>
          <Text style={[styles.meta, { color: C.textMuted }]} numberOfLines={1}>{tally}</Text>
        </View>
        {renderThumb(reactionCovers[reaction.deskId])}
      </TouchableOpacity>
    )
  }

  const renderDesk = (entry: DeskUpdateEntry, at: string, showTime: boolean) => {
    const { desk } = entry
    const title = localizedDemoDeskName(desk.id, desk.title, lang)
    const author = publicAuthorParts(desk.owner_name, desk.owner_tag)
    const sentence = deskUpdateSentence(
      { author: author.name || author.tag, title, isNew: entry.isNew, changes: entry.changes },
      lang,
    )
    const meta = [sentence.more, showTime ? formatRelativeDay(at, lang) : null].filter(Boolean).join(' · ')
    const unread = !openedIds.has(desk.id)
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => handleOpen(desk.id)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={[unread ? (ja ? '未読' : 'Unread') : null, `${sentence.lead}${sentence.body}`, meta].filter(Boolean).join(ja ? '、' : ', ')}
      >
        <View style={[styles.unreadDot, unread && { backgroundColor: C.accent }]} />
        <AuthorAvatar name={desk.owner_name} tag={desk.owner_tag} imageUrl={desk.owner_avatar_url} size={AVATAR_SIZE} />
        <View style={styles.body}>
          <Text style={[styles.message, { color: C.text }]} numberOfLines={3}>
            {!!sentence.lead && <Text style={styles.lead}>{sentence.lead}</Text>}{sentence.body}
          </Text>
          {!!meta && (
            <Text style={[styles.meta, { color: C.textMuted }]} numberOfLines={1}>{meta}</Text>
          )}
        </View>
        {renderThumb(toPhotoUrls(desk)[0])}
      </TouchableOpacity>
    )
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(item) => item.kind === 'reaction' ? `reaction:${item.reaction.deskId}` : `desk:${item.entry.desk.id}`}
        // 読み込み中の骨組みは実物の行と同じ並べ方なので、一覧と同じ余白に置く
        contentContainerStyle={sections.length === 0 && !loading ? styles.emptyContent : styles.listContent}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.textMuted} colors={[C.textMuted]} progressBackgroundColor={C.card} />
        }
        renderSectionHeader={({ section }) => (
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: C.textSub }]}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => item.kind === 'reaction' ? renderReaction(item.reaction) : renderDesk(item.entry, item.at, item.showTime)}
        ListEmptyComponent={empty}
      />
    </SafeAreaView>
  )
}

// 読み込み中の骨組み。実物の行（左に丸、中に文、右に 4:3 の写真）と同じ寸法で敷く。
// デスクのカードの形で出していた頃は、一覧が出た瞬間に行の高さも横の並びも丸ごと入れ替わった
function UpdatesSkeleton() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Skeleton width={64} height={18} radius={4} style={styles.skeletonSectionTitle} />
      {[0, 1, 2].map((key) => (
        <View key={key} style={styles.row}>
          <Skeleton width={AVATAR_SIZE} height={AVATAR_SIZE} radius={AVATAR_SIZE / 2} />
          <View style={styles.body}>
            <Skeleton width="92%" height={14} radius={4} style={styles.skeletonMessageLine} />
            <Skeleton width="64%" height={14} radius={4} style={styles.skeletonMessageLine} />
            <Skeleton width="36%" height={12} radius={4} style={styles.skeletonMetaLine} />
          </View>
          <Skeleton width={THUMB_WIDTH} height={(THUMB_WIDTH * 3) / 4} radius={UI_METRICS.controlRadius} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // 行は器に入れず背景へ直に並べる（YouTube の通知と同じ）
  listContent: { paddingTop: 4, paddingBottom: UI_METRICS.screenGutter },
  emptyContent: { flexGrow: 1, padding: UI_METRICS.screenGutter },
  sectionTitle: {
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingTop: 16,
    paddingBottom: 6,
    fontSize: 15,
    fontWeight: '700',
  },
  // 横の余白は他の一覧と同じ。未読の点はその余白の中に置き、投稿者の丸を節の見出しと揃える
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: UI_METRICS.screenGutter,
    paddingVertical: 10,
  },
  unreadDot: {
    position: 'absolute',
    left: (UI_METRICS.screenGutter - 6) / 2,
    top: 10 + AVATAR_SIZE / 2 - 3,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  avatarSlot: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, overflow: 'hidden' },
  body: { flex: 1, minWidth: 0, gap: 3 },
  message: { fontSize: 15, lineHeight: 20 },
  lead: { fontWeight: '600' },
  meta: { fontSize: 13 },
  // デスクの写真は一覧のタイルと同じ 4:3。16:9 の横長にすると文の幅が削られて2行で切れた
  thumb: { width: THUMB_WIDTH, aspectRatio: 4 / 3, borderRadius: UI_METRICS.controlRadius },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  // 節の見出し（sectionTitle：上 16・下 6・15pt）と同じ場所を取る
  skeletonSectionTitle: { marginHorizontal: UI_METRICS.screenGutter, marginTop: 16, marginBottom: 6 },
  // 本文の1行（lineHeight 20）・メタ（13pt）の高さに収める
  skeletonMessageLine: { marginVertical: 3 },
  skeletonMetaLine: { marginVertical: 2 },
})
