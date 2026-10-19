import { Alert } from '../utils/alert'
// 公開プロフィール — ある投稿者の公開デスクを並べる。
//
// これが無い間、フィードで良いデスクを見つけてもその人の他のデスクへ辿れず、
// 獲得の導線がそこで切れていた。`public_tag`（049 で全員に振ってあり、060 から
// 本人が決める @ID）を URL にして、mydesk.page/u/<tag> で外からも開けるようにする。
//
// 並べるのはマイページのデスクタブと同じ1列のタイル（写真 16:9・共有は本文側）。
// 自分のマイページと他人のプロフィールで同じデスクの見え方が違うと、同じ「デスク1件」に
// 見えなくなる。投稿者は上のヘッダーで一度名乗るので、タイルごとの投稿者は出さない
// （全部同じ人になって情報量がゼロ）。
//
// ブロック済みユーザーのプロフィールは中身を出さない。フィードでは伏せているのに
// URL を直接開くと読めてしまうと、ブロックの意味が無くなる。
//
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useToday } from '../hooks/useToday'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { AuthorAvatar } from '../components/atoms/AuthorAvatar'
import { FollowButton } from '../components/atoms/FollowButton'
import { IconCircleButton } from '../components/atoms/IconCircleButton'
import { HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { useAuth } from '../context/AuthContext'
import { useUserFollow } from '../hooks/useUserFollow'
import { PUSH_NOTIFICATIONS_ENABLED } from '../constants/features'
import { PhotoViewerModal } from '../components/organisms/PhotoViewerModal'
import { DeskGridTile } from '../components/molecules/DeskGridTile'
import { EmptyState } from '../components/molecules/EmptyState'
import { RetryState } from '../components/molecules/RetryState'
import { useApp } from '../context/AppContext'
import { listPublicDesksByTag, PublicDeskListItem } from '../services/desks'
import { blockUser, getBlockedUserIds, unblockUser } from '../services/moderationService'
import { shareDesk } from '../services/shareService'
import { PlanPurpose, PublicStackParamList } from '../types'
import { formatDate } from '../utils/dateFormat'
import { localizedDemoDeskName } from '../utils/localizedDemoDesk'
import { publicDeskUpdateBadge } from '../utils/publicDeskFeed'
import { normalizePublicTag } from '../utils/publicTag'
import { formatPublicAuthor } from '../utils/publicAuthor'
import { localizedErrorMessage } from '../utils/localizedError'
import { promptLogin } from '../utils/promptLogin'
import { ICONS } from '../constants/icons'
import { UI_METRICS } from '../constants/ui'

type Props = NativeStackScreenProps<PublicStackParamList, 'PublicProfile'>

export function PublicProfileScreen({ route, navigation }: Props) {
  useToday()
  const { colors: C, t, lang, isDark, fmtPrice } = useApp()
  const ja = lang === 'ja'
  const tag = normalizePublicTag(route.params?.tag)

  const [items, setItems] = useState<PublicDeskListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [desks, blockedIds] = await Promise.all([
      listPublicDesksByTag(tag),
      getBlockedUserIds(),
    ])
    // 投稿者は1人なので、1件でもブロック対象なら全部そう
    const isBlocked = desks.length > 0 && blockedIds.has(desks[0].user_id)
    setBlocked(isBlocked)
    // ブロック中もメニューの解除先を保持する。画面に出す一覧とプロフィールは下で隠す。
    setItems(desks)
  }, [tag])

  const reload = useCallback(() => {
    setLoadError(false)
    setLoading(true)
    load().catch(() => setLoadError(true)).finally(() => setLoading(false))
  }, [load])

  useEffect(reload, [reload])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    setLoadError(false)
    load().catch(() => setLoadError(true)).finally(() => setRefreshing(false))
  }, [load])

  // タイルは memo なので、行ごとに新しい関数を渡さない
  // デスク → 持ち主 → 別のデスク、と辿ると下に PublicDesk が残っている。navigate だと
  // そこまで pop して戻るアニメになり、前のデスクの画面に params だけ差し替わる。
  // 連打で2枚積まないよう、前面から外れた2回目は捨てる（PublicDesk の openAnotherPublicDesk と同じ）
  const openDesk = useCallback((deskId: string) => {
    if (!navigation.isFocused()) return
    navigation.push('PublicDesk', { deskId, source: 'public_profile' })
  }, [navigation])

  // 共有シートを開いている間の2回目は捨てる（公開デスク画面の共有と同じ）
  const shareInFlightRef = useRef(false)
  const shareById = useCallback((deskId: string) => {
    const desk = items.find((item) => item.id === deskId)
    if (!desk || shareInFlightRef.current) return
    shareInFlightRef.current = true
    void shareDesk({
      deskId: desk.id,
      deskName: localizedDemoDeskName(desk.id, desk.title, lang),
      ownerTag: desk.owner_tag,
      // 台数は一覧に載っていないので省く（0 で埋めると 0台として集計される）
      totalPrice: desk.total_price,
    }, lang)
      // 共有シートを閉じただけでも失敗として返るので、何も出さない
      .catch(() => {})
      .finally(() => { shareInFlightRef.current = false })
  }, [items, lang])

  const ownerName = items[0]?.owner_name ?? ''
  // URL に打たれた綴りではなく、本人が決めた綴りで名乗らせる（照合は大文字小文字を問わない）
  const ownerTag = items[0]?.owner_tag || tag

  // フォローは user_id で持つ（タグは本人が変えられる）。公開デスクが1件も引けない人は
  // user_id が分からず、フォローしても更新に届くものが無いのでボタンを出さない
  const { user } = useAuth()
  const ownerId = items[0]?.user_id ?? null
  const canFollow = !!ownerId && !blocked && user?.id !== ownerId
  const { following, toggle: toggleFollow, notify, toggleNotify } = useUserFollow(canFollow ? ownerId : null, navigation, 'public_profile')

  const handleBlock = useCallback(() => {
    if (!ownerId || user?.id === ownerId) return
    if (!user) {
      promptLogin(navigation, lang, ja ? 'ブロックするにはログインしてください' : 'Please log in to block users.')
      return
    }
    if (blocked) {
      unblockUser(ownerId)
        .then(reload)
        .catch((error: unknown) => Alert.alert(ja ? 'エラー' : 'Error', localizedErrorMessage(error, lang, ja ? '解除できませんでした。' : 'Could not unblock.')))
      return
    }
    Alert.alert(
      ja ? 'このユーザーをブロック' : 'Block this user',
      ja ? 'ブロックすると、この人が公開したデスクは表示されなくなります。' : 'You will no longer see desks published by this user.',
      [
        { text: ja ? 'キャンセル' : 'Cancel', style: 'cancel' },
        {
          text: ja ? 'ブロック' : 'Block', style: 'destructive',
          onPress: async () => {
            try {
              await blockUser(ownerId, formatPublicAuthor(ownerName, ownerTag) || null)
              setBlocked(true)
            } catch (error: unknown) {
              Alert.alert(ja ? 'エラー' : 'Error', localizedErrorMessage(error, lang, ja ? 'ブロックできませんでした。' : 'Could not block this user.'))
            }
          },
        },
      ],
    )
  }, [ownerId, user, navigation, lang, ja, blocked, reload, ownerName, ownerTag])

  const openUserMenu = useCallback(() => {
    Alert.alert(
      ja ? 'このユーザーについて' : 'About this user',
      formatPublicAuthor(ownerName, ownerTag),
      [
        {
          text: blocked ? (ja ? 'ブロックを解除' : 'Unblock') : (ja ? 'ユーザーをブロック' : 'Block user'),
          style: blocked ? 'default' : 'destructive', onPress: handleBlock,
        },
        { text: ja ? '閉じる' : 'Close', style: 'cancel' },
      ],
    )
  }, [ja, ownerName, ownerTag, blocked, handleBlock])

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: !loading && !loadError && ownerId && user?.id !== ownerId ? () => (
        <HeaderIconButton
          name="dots-horizontal"
          color={C.text}
          onPress={openUserMenu}
          accessibilityLabel={ja ? 'このユーザーについて' : 'About this user'}
        />
      ) : undefined,
    })
  }, [navigation, loading, loadError, ownerId, user?.id, C.text, ja, openUserMenu])

  const header = (
    <View style={[styles.profileSection, { backgroundColor: C.bg }]}>
      <View style={styles.profileTopRow}>
        {/* 文字アイコンには拡大するものが無いので、写真のときだけ押せるようにする */}
        <TouchableOpacity
          onPress={() => setAvatarPreview(items[0]?.owner_avatar_url ?? null)}
          disabled={!items[0]?.owner_avatar_url}
          activeOpacity={0.75}
          accessibilityRole={items[0]?.owner_avatar_url ? 'button' : 'image'}
          accessibilityLabel={items[0]?.owner_avatar_url
            ? (ja ? 'アイコンの写真を大きく表示' : 'View icon photo full screen')
            : undefined}
        >
          <AuthorAvatar name={ownerName} tag={ownerTag} imageUrl={items[0]?.owner_avatar_url} size={76} />
        </TouchableOpacity>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: ownerName ? C.text : C.textMuted }]} numberOfLines={1}>
            {ownerName || (ja ? '名前未設定' : 'No name')}
          </Text>
          <Text style={[styles.profileTag, { color: C.textMuted }]} numberOfLines={1}>@{ownerTag}</Text>
          <Text style={[styles.profileCount, { color: C.textMuted }]} numberOfLines={1}>
            {ja ? `公開デスク ${items.length}` : `${items.length} public desk${items.length === 1 ? '' : 's'}`}
          </Text>
        </View>
        {/* フォロー中なら、この人の通知だけを切れるベルを横に置く（096）。フォロー中の一覧と同じ形 */}
        {PUSH_NOTIFICATIONS_ENABLED && canFollow && following && (
          <IconCircleButton
            name={notify ? ICONS.bell : ICONS.bellOff}
            color={notify ? C.accentText : C.textMuted}
            diameter={36}
            background={C.chip}
            onPress={toggleNotify}
            accessibilityLabel={notify
              ? (ja ? 'この人の通知をオフにする' : 'Turn off notifications for this person')
              : (ja ? 'この人の通知をオンにする' : 'Turn on notifications for this person')}
          />
        )}
        {canFollow && (
          <FollowButton following={following} onPress={toggleFollow} colors={C} lang={lang} name={ownerName} />
        )}
      </View>
    </View>
  )

  const empty = loading ? (
    <View style={styles.stateWrap}><ActivityIndicator size="small" color={C.accentIcon} /></View>
  ) : loadError ? (
    <RetryState
      message={ja ? 'デスクを読み込めませんでした。' : 'Could not load these desks.'}
      onRetry={reload}
    />
  ) : blocked ? (
    <EmptyState
      icon="account-cancel-outline"
      title={ja ? 'ブロック中のユーザーです' : 'You blocked this user'}
      description={ja
        ? 'ブロックを解除すると、この人の公開デスクをまた見られます'
        : 'Unblock them to see their public desks again.'}
      colors={C}
    />
  ) : (
    <EmptyState
      icon={ICONS.publish}
      title={ja ? '公開デスクがありません' : 'No public desks'}
      description={ja
        ? 'この人はまだデスクを公開していないか、公開を取り消しているか、まとめて見せない設定にしています'
        : 'This person has not published a desk, has unpublished them, or does not list them together.'}
      colors={C}
    />
  )

  return (
    <>
    <FlatList
      style={{ backgroundColor: C.bgList }}
      data={blocked ? [] : items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={blocked ? null : header}
      ListHeaderComponentStyle={styles.headerBleed}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.textMuted} colors={[C.textMuted]} progressBackgroundColor={C.card} />}
      contentContainerStyle={blocked || items.length === 0 ? styles.emptyContent : styles.listContent}
      renderItem={({ item }) => {
        const photo = [...(item.desk_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]
        return (
          <DeskGridTile
            id={item.id}
            title={localizedDemoDeskName(item.id, item.title, lang)}
            photoUri={photo?.image_url}
            purposes={item.purposes as PlanPurpose[] | undefined}
            meta={formatDate(new Date(item.updated_at), lang)}
            updatedLabel={publicDeskUpdateBadge(item, lang)}
            lang={lang}
            fmtPrice={fmtPrice}
            colors={C}
            isDark={isDark}
            onPress={openDesk}
            widePhoto
            actionIcon={ICONS.share}
            actionLabel={t('a11y.shareDesk')}
            onAction={shareById}
          />
        )
      }}
      ListEmptyComponent={empty}
    />
    <PhotoViewerModal
      uri={avatarPreview}
      lang={lang}
      onClose={() => setAvatarPreview(null)}
      label={ja ? 'アイコンの写真' : 'Icon photo'}
    />
    </>
  )
}

const styles = StyleSheet.create({
  // 下は空けない。listContent の gap がヘッダーと最初のタイルの間にも入る
  headerBleed: { marginHorizontal: -UI_METRICS.screenGutter, marginTop: -UI_METRICS.screenGutter, marginBottom: 0 },
  // 左右はマイページのプロフィール（20）と揃える。同じ部品が画面で違う位置に来ないように
  profileSection: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
  },
  profileTopRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  profileInfo: { flex: 1, minWidth: 0 },
  profileName: { fontSize: 20, fontWeight: '700' },
  profileTag: { fontSize: 13, lineHeight: 18, fontWeight: '400', marginTop: 4 },
  profileCount: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 8 },
  stateWrap: { paddingVertical: 48, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: UI_METRICS.screenGutter, gap: 12 },
  emptyContent: { flexGrow: 1, padding: UI_METRICS.screenGutter },
})
