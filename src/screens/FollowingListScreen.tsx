// フォロー中の人の一覧（084）。マイページのプロフィールの「フォロー中」から開く。
//
// 数も一覧も本人にしか見えない（084 冒頭）。ここは「誰を追っているか」を確かめて
// 外すための場所で、人気の一覧ではない。
//
// 解除しても行は消さず、ボタンを「フォロー」へ戻すだけにする。押し間違えた人が
// その場で戻せないと、相手の公開プロフィールまで探しに行くことになる。次に開いたときに消える。
//
// 通知は人ごとに切れる（096）。フォローを外すと更新一覧からも消えるので、
// 「追ってはいたいが通知までは要らない」人のために、ベルだけで止められるようにする。
//
// 名乗りは相手の公開デスクから引く。公開をやめた人・プロフィールを非公開にした人・
// ブロックした人は名前を出せないが、解除できる行としては残す（消すと外す手段が無い）。
import { useCallback, useRef, useState } from 'react'
import { useFocusEffect } from '@react-navigation/native'
import { ActivityIndicator, FlatList, RefreshControl, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AuthorAvatar } from '../components/atoms/AuthorAvatar'
import { FollowButton } from '../components/atoms/FollowButton'
import { IconCircleButton } from '../components/atoms/IconCircleButton'
import { EmptyState } from '../components/molecules/EmptyState'
import { RetryState } from '../components/molecules/RetryState'
import { ICONS } from '../constants/icons'
import { PUSH_NOTIFICATIONS_ENABLED } from '../constants/features'
import { UI_METRICS } from '../constants/ui'
import { useApp } from '../context/AppContext'
import { useAuth } from '../context/AuthContext'
import { analytics, EVENTS } from '../services/analytics'
import { getBlockedUserIds } from '../services/moderationService'
import { FollowedProfile, followUser, listFollowedProfiles, setFollowNotify, unfollowUser } from '../services/userFollows'
import { MyPageNavigation } from '../navigation/screenProps'
import { useIntentSync } from '../hooks/useIntentSync'
import { hapticSelection } from '../utils/haptics'

// styles.row の padding と同じ幅（右は通知・フォローのボタンが並ぶので広げない）
const ROW_MAIN_SLOP = { top: 10, bottom: 10, left: 14 }

export function FollowingListScreen({ navigation }: { navigation: MyPageNavigation }) {
  const { colors: C, lang } = useApp()
  const { user } = useAuth()
  const ja = lang === 'ja'

  const [items, setItems] = useState<FollowedProfile[]>([])
  // 解除した相手。行は残してボタンだけ戻す
  const [unfollowed, setUnfollowed] = useState<ReadonlySet<string>>(() => new Set())
  // 連打の2回目は再描画より先に届きうる。押した時点の状態は描画を待たずにここから読む
  const unfollowedRef = useRef<ReadonlySet<string>>(unfollowed)
  unfollowedRef.current = unfollowed
  const apply = useCallback((followeeId: string, following: boolean) => {
    const toggled = (prev: ReadonlySet<string>) => {
      const next = new Set(prev)
      if (following) next.delete(followeeId)
      else next.add(followeeId)
      return next
    }
    unfollowedRef.current = toggled(unfollowedRef.current)
    setUnfollowed(toggled)
  }, [])
  // 押すたびに反転し、通信は最後の状態だけを送る（utils/intentSync）
  const sync = useIntentSync<string>({
    send: async (followeeId, following) => {
      if (!user) throw new Error('signed out')
      if (following) await followUser(user.id, followeeId)
      else await unfollowUser(user.id, followeeId)
    },
    onConfirmed: (_, following) =>
      analytics.track(EVENTS.USER_FOLLOW_TOGGLED, { followed: following, placement: 'following_list' }),
    onFailed: apply,
  })

  // 通知を切っている相手。フォローと同じく押すたびに反転し、通信は最後の状態だけを送る
  const [muted, setMuted] = useState<ReadonlySet<string>>(() => new Set())
  const mutedRef = useRef<ReadonlySet<string>>(muted)
  mutedRef.current = muted
  const applyNotify = useCallback((followeeId: string, notify: boolean) => {
    const toggled = (prev: ReadonlySet<string>) => {
      const next = new Set(prev)
      if (notify) next.delete(followeeId)
      else next.add(followeeId)
      return next
    }
    mutedRef.current = toggled(mutedRef.current)
    setMuted(toggled)
  }, [])
  const notifySync = useIntentSync<string>({
    send: async (followeeId, notify) => {
      if (!user) throw new Error('signed out')
      await setFollowNotify(user.id, followeeId, notify)
    },
    onFailed: applyNotify,
  })

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const load = useCallback(async () => {
    if (!user) { setItems([]); return }
    const [profiles, blockedIds] = await Promise.all([
      listFollowedProfiles(user.id),
      getBlockedUserIds(),
    ])
    setItems(profiles.map((profile) => (
      blockedIds.has(profile.userId) ? { ...profile, name: null, tag: null, avatarUrl: null } : profile
    )))
    // 送信中の相手は押した後の表示を残す。一覧は送信が届く前の状態で返りうる
    const pending = new Set([...unfollowedRef.current].filter((id) => sync.isBusy(id)))
    unfollowedRef.current = pending
    setUnfollowed(pending)
    const nextMuted = new Set(profiles
      .filter((profile) => notifySync.isBusy(profile.userId) ? mutedRef.current.has(profile.userId) : !profile.notify)
      .map((profile) => profile.userId))
    mutedRef.current = nextMuted
    setMuted(nextMuted)
  }, [user, sync, notifySync])

  const reload = useCallback(() => {
    setLoadError(false)
    load().catch(() => setLoadError(true)).finally(() => setLoading(false))
  }, [load])

  useFocusEffect(reload)

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setLoadError(false)
    load().catch(() => setLoadError(true)).finally(() => setRefreshing(false))
  }, [load])

  const toggle = useCallback((followeeId: string) => {
    if (!user) return
    const wasFollowing = !unfollowedRef.current.has(followeeId)
    hapticSelection()
    apply(followeeId, !wasFollowing)
    sync.request(followeeId, wasFollowing, !wasFollowing)
  }, [user, apply, sync])

  const toggleNotify = useCallback((followeeId: string) => {
    if (!user) return
    const wasOn = !mutedRef.current.has(followeeId)
    hapticSelection()
    applyNotify(followeeId, !wasOn)
    notifySync.request(followeeId, wasOn, !wasOn)
  }, [user, applyNotify, notifySync])

  const empty = loading ? (
    <View style={styles.stateWrap}><ActivityIndicator size="small" color={C.accentIcon} /></View>
  ) : loadError ? (
    <RetryState
      message={ja ? 'フォロー中の人を読み込めませんでした。' : 'Could not load the people you follow.'}
      onRetry={reload}
    />
  ) : (
    <EmptyState
      icon={ICONS.follow}
      title={ja ? 'フォローしている人はいません' : 'You are not following anyone'}
      description={ja
        ? 'フォローした人の新しい公開デスクは、更新（ベル）に届きます'
        : 'New public desks from people you follow appear in Updates.'}
      colors={C}
    />
  )

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: C.bgList }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={items.length === 0 ? styles.emptyContent : styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.textMuted} colors={[C.textMuted]} progressBackgroundColor={C.card} />}
        renderItem={({ item }) => {
          const viewable = !!item.tag
          return (
            <View style={[styles.row, { backgroundColor: C.card }]}>
              <TouchableOpacity
                style={styles.rowMain}
                // カードの上下・左の余白（styles.row の padding）まで押せる範囲にする。
                // 押せるのが中のアバターと名前だけで、カードの縁を押しても開かなかった
                hitSlop={ROW_MAIN_SLOP}
                onPress={() => item.tag && navigation.isFocused() && navigation.navigate('PublicProfile', { tag: item.tag })}
                disabled={!viewable}
                activeOpacity={0.7}
                accessibilityRole={viewable ? 'button' : undefined}
                accessibilityLabel={viewable
                  ? (ja ? `${item.name ?? item.tag} のプロフィールを見る` : `View ${item.name ?? item.tag}'s profile`)
                  : undefined}
              >
                <AuthorAvatar name={item.name ?? ''} tag={item.tag} imageUrl={item.avatarUrl} size={44} />
                <View style={styles.nameWrap}>
                  <Text style={[styles.name, { color: viewable ? C.text : C.textMuted }]} numberOfLines={1}>
                    {viewable ? (item.name || (ja ? '名前未設定' : 'No name')) : (ja ? '表示できないユーザー' : 'Unavailable user')}
                  </Text>
                  {/* 見られない人への説明（23文字）は1行に入らないので2行まで */}
                  <Text style={[styles.tag, { color: C.textMuted }]} numberOfLines={viewable ? 1 : 2}>
                    {viewable
                      ? `@${item.tag}`
                      : (ja ? '公開デスクが無いか、プロフィールが見られません' : 'No public desks or profile is hidden')}
                  </Text>
                </View>
              </TouchableOpacity>
              {/* 外した相手には出さない。通知の行はフォローの行に付いていて、外すと一緒に消える */}
              {PUSH_NOTIFICATIONS_ENABLED && !unfollowed.has(item.userId) && (
                <IconCircleButton
                  name={muted.has(item.userId) ? ICONS.bellOff : ICONS.bell}
                  color={muted.has(item.userId) ? C.textMuted : C.accentText}
                  diameter={36}
                  background={C.chip}
                  onPress={() => toggleNotify(item.userId)}
                  accessibilityLabel={muted.has(item.userId)
                    ? (ja ? `${item.name ?? item.tag ?? ''} の通知をオンにする` : `Turn on notifications for ${item.name ?? item.tag ?? ''}`)
                    : (ja ? `${item.name ?? item.tag ?? ''} の通知をオフにする` : `Turn off notifications for ${item.name ?? item.tag ?? ''}`)}
                />
              )}
              <FollowButton
                following={!unfollowed.has(item.userId)}
                onPress={() => toggle(item.userId)}
                colors={C}
                lang={lang}
                compact
                name={item.name}
              />
            </View>
          )
        }}
        ListEmptyComponent={empty}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  stateWrap: { paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: UI_METRICS.screenGutter, gap: 8 },
  emptyContent: { flexGrow: 1, padding: UI_METRICS.screenGutter },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: UI_METRICS.cardRadius,
  },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameWrap: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '700' },
  tag: { fontSize: 12, marginTop: 2 },
})
