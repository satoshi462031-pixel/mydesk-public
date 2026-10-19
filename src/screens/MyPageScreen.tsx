// マイページ — プロフィールと、投稿・保存・所有ガジェットをタブで束ねる。
//
// 設定は右上のメニューへ退避した。以前はここが設定の入口リストで、いいね・保存が
// 「デスク機能」グループの2行として設定項目に埋まっていた。自分の持ち物を見るのと
// アプリの設定を変えるのは別の用事なので、前者をタブへ引き上げている。
//
// プロフィールとタブバーは各タブの一覧の ListHeaderComponent として渡す。
// ヘッダーごと画面に固定すると、ガジェットが数十点あるときに上部の 1/3 が
// 常に埋まったままになるので、プロフィールはスクロールで流し、タブバーだけを
// 上端に残す。一覧の中に入るタブバーは高さを確保するための透明な控えで、
// 実体は全ペインに共通の stickyTabBar 側。一覧から届く scrollY で位置を合わせ、
// プロフィールの高さぶん流れたところで止める。
//
// 一度開いたタブはマウントしたまま display で出し分ける。出し入れすると
// 各タブの useFocusEffect が毎回走り、タブを行き来するだけでサーバー取得が
// 繰り返され、そのたびヘッダーの下でスピナーが点滅していた。
// 読み込むのは表示中のタブだけなので、埋め込み側には active を渡す。
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Easing,
  InteractionManager,
  LayoutChangeEvent,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { AppIcon } from '../components/atoms/AppIcon'
import { HeaderButtonGroup, HeaderIconButton } from '../components/atoms/HeaderIconButton'
import { COACH_SCREEN, CoachAnchor, CoachStep, CoachScope, useCoachMarks } from '../hooks/useCoachMarks'
import { AuthorAvatar } from '../components/atoms/AuthorAvatar'
import { TabUnderline } from '../components/atoms/TabUnderline'
import { HistoryScopeSwitch } from '../components/molecules/HistoryScopeSwitch'
import { ListSkeleton } from '../components/molecules/ListSkeleton'
import { ReactionScopeSwitch } from '../components/molecules/ReactionScopeSwitch'
import { ProfileEditSheet } from '../components/organisms/ProfileEditSheet'
import { useApp } from '../context/AppContext'
import { hapticSelection } from '../utils/haptics'
import { useAuth } from '../context/AuthContext'
import { useGadgets } from '../hooks/useGadgets'
import { useEntitlement } from '../hooks/useEntitlement'
import { usePlans } from '../hooks/usePlans'
import { MyPageScrollIndicatorContext, useStickyBarBottom } from '../hooks/useMyPageScrollIndicator'
import { getPublicNickname } from '../utils/publicNickname'
import { listFollowedUserIds } from '../services/userFollows'
import { ICONS, MCIconName, TAB_ICONS } from '../constants/icons'
import { UI_METRICS } from '../constants/ui'
import { BookmarkListScreen } from './BookmarkListScreen'
import { GadgetLibraryHeaderPlaceholder, GadgetLibraryScreen } from './GadgetLibraryScreen'
import { isOwnedGadget } from '../utils/gadgetStats'
import { PublishedDeskListScreen } from './PublishedDeskListScreen'
import { ViewHistoryListScreen } from './ViewHistoryListScreen'
import { MyPageNavigation } from '../navigation/screenProps'
import { MainTabsParamList } from '../types'
import { ScrollSyncRequest, synchronizedTabOffset } from '../utils/collapsibleTabScroll'

type TabKey = 'published' | 'favorites' | 'gadgets' | 'history'

const TABS: { key: TabKey; ja: string; en: string; icon: MCIconName }[] = [
  // 自分のデスク全部（未公開を含む）。公開したかは行のバッジ（公開中・URL限定・未公開）で見分ける。
  // 以前は公開したデスクだけを「投稿」と呼んでいたが、投稿はデスクの一部でしかなく、
  // 「投稿」と「デスク」を別物のように数えていた
  { key: 'published',  ja: 'デスク',     en: 'Desks',      icon: 'view-grid-outline' },
  // 見たデスク。保存は「残すと決めたもの」、履歴は「決める前に通り過ぎたもの」で、
  // 保存し忘れたデスクへ戻る道がこれまで無かった。端末にだけ持つ（utils/viewHistory.ts）
  { key: 'history',    ja: '履歴', en: 'History', icon: ICONS.history },
  // 保存だけを並べる。いいねは「押した印」であって後で見に来る一覧ではないので、
  // ここで保存と並べると2つの違いを説明できないまま見せることになる
  { key: 'favorites',  ja: '保存',       en: 'Saved',      icon: 'bookmark-outline' },
  { key: 'gadgets',    ja: '機材', en: 'Gear', icon: TAB_ICONS.gadgets },
]

// 「？」で順に指す。いま開いているタブの中身を先に、プロフィールの説明を後に出す。
// 画面に見えていない対象（0件のときの行・スクロールで隠れたプロフィール）の説明は飛ばされる
const MY_PAGE_TAB_COACH: Record<TabKey, CoachStep[]> = {
  published: [
    { target: 'mypage-desk', title: { ja: '自分のデスク', en: 'Your desks' }, ja: '自分のデスクが、公開していないものも含めて並びます。タップで詳細を開きます。', en: 'All your desks, including ones you have not published. Tap to open one.' },
    { target: 'mypage-desk-publish', title: { ja: '公開の状態', en: 'Visibility' }, emphasis: { ja: ['公開中', 'URL限定', '更新あり'], en: ['Public', 'unlisted', 'Update'] }, pad: 4, ja: '「公開中」はみんなのデスクに載り、「URL限定」はリンクを知っている人だけが開けます。「更新あり」は、編集した内容がまだ公開ページに出ていない印です。', en: 'Public desks appear in Explore; unlisted desks open only with the link. Update means your edits are not on the public page yet.' },
    { target: 'mypage-desk-own', title: { ja: 'スワイプ・長押し', en: 'Swipe and hold' }, emphasis: { ja: ['右へスワイプ', '左へスワイプ', '長押し'], en: ['Swipe right', 'Swipe left', 'Hold'] }, ja: '・右へスワイプ：ピン留め・複製\n・左へスワイプ：削除\n・長押し：名前を変える', en: '• Swipe right: pin or duplicate\n• Swipe left: delete\n• Hold: rename' },
    { target: 'mypage-desk-action', title: { ja: '公開・共有', en: 'Publish and share' }, pad: 4, ja: 'デスクを公開したり、リンクを共有したりできます。', en: 'Publish or share a link from here.' },
    { target: 'mypage-new-desk', title: { ja: 'デスクを作る', en: 'Create a desk' }, pad: 4, ja: '新しいデスクはここから作れます。マイデスクのタブへ移って作成を始めます。', en: 'Create a new desk here. It opens the MyDesk tab to start.' },
    { target: 'mypage-desk-empty', title: { ja: '最初のデスク', en: 'Your first desk' }, pad: 4, ja: 'ここから最初のデスクを作ります。作ったデスクがここに並びます。', en: 'Create your first desk here. It will appear in this list.' },
  ],
  history: [
    { target: 'history-scope', title: { ja: '履歴の種類', en: 'History type' }, pad: 4, ja: '見たデスクと、拍手したデスクを切り替えます。', en: 'Switch between desks you viewed and desks you applauded.' },
    { target: 'history-card', title: { ja: 'デスクを開く', en: 'Open a desk' }, ja: 'タップでデスクを開きます。見たデスクの履歴は、この端末にだけ残ります。', en: 'Tap to open a desk. Your viewing history stays on this device only.' },
    { target: 'history-empty', title: { ja: '閲覧履歴', en: 'Viewing history' }, pad: 4, ja: 'みんなのデスクで開いたデスクが、ここに残ります。', en: 'Desks you open in Explore will show up here.' },
  ],
  favorites: [
    { target: 'saved-scope', title: { ja: '保存の種類', en: 'Saved item type' }, pad: 4, ja: '保存したデスクと、保存したガジェットを切り替えます。', en: 'Switch between saved desks and saved gadgets.' },
    { target: 'saved-brand-add', title: { ja: 'ブランドを追加', en: 'Add a brand' }, ja: 'ブランドを検索して、お気に入りに追加できます。機材を保存していないブランドも追加できます。', en: 'Search for brands to add to favorites, including brands with no saved gear.' },
    { target: 'saved-brand-favorites', title: { ja: 'お気に入りのブランド', en: 'Favorite brands' }, ja: 'お気に入りのブランドです。タップすると、そのブランドの商品一覧を開きます。', en: 'Tap a favorite brand to browse its products.' },
    { target: 'saved-brand-filter', title: { ja: 'ブランドで絞り込む', en: 'Filter by brand' }, ja: '保存した機材をブランド別に絞り込みます。選択中のブランドをもう一度押すと解除します。', en: 'Filter saved gear by brand. Tap the selected brand again to clear the filter.' },
    { target: 'saved-brand-actions', title: { ja: 'ブランドの操作', en: 'Brand actions' }, ja: '選んだブランドをお気に入りに追加・解除したり、そのブランドの商品一覧を開いたりできます。', en: 'Add or remove the selected brand from favorites, or browse its products.' },
    { target: 'saved-card', title: { ja: '保存したデスク', en: 'Saved desks' }, ja: '公開デスクの「保存」で残したデスクです。更新されると投稿者名の横に「更新」が付きます。', en: 'Desks you saved from public desks. “Updated” appears beside the author when they change.' },
    { target: 'saved-card-action', title: { ja: '保存を解除', en: 'Remove from Saved' }, pad: 4, ja: '青いブックマークを押すと枠だけになり、少しして一覧から外れます。消える前にもう一度押すと取り消せます。', en: 'Tap the blue bookmark to remove the desk from Saved. Tap again before it disappears to undo.' },
    { target: 'saved-empty', title: { ja: 'デスクを保存', en: 'Save a desk' }, pad: 4, ja: '公開デスクの「保存」を押すと、ここで見返せます。', en: 'Tap Save on a public desk to keep it here.' },
    { target: 'saved-gear', title: { ja: '保存した機材', en: 'Saved gear' }, ja: '保存した機材です。タップで保存元のデスクを開きます。保存元が非公開や削除済みの場合は開けません。', en: 'Saved gear. Tap to open its source desk. Private or deleted source desks cannot be opened.' },
    { target: 'saved-gear-remove', title: { ja: '保存を解除', en: 'Remove from Saved' }, emphasis: { ja: ['左へ引ききる', '持ち物の削除ではありません'], en: ['swipe the row all the way left', 'does not delete your owned gear'] }, pad: 4, ja: 'このボタンか、行を左へ引ききると保存を解除します。直後に出る「元に戻す」で戻せます。持ち物の削除ではありません。', en: 'Use this button or swipe the row all the way left to remove it from Saved. Tap Undo right after to bring it back. This does not delete your owned gear.' },
    { target: 'saved-gear-empty', title: { ja: '機材を保存', en: 'Save gear' }, ja: '公開デスクで機材の詳細を開き、保存するとここに並びます。', en: 'Open gear details on a public desk and save it to find it here.' },
  ],
  gadgets: [
    { target: 'gear-add', title: { ja: '機材を登録', en: 'Register gear' }, pad: 4, ja: '持っている機材はここから登録します。デスクに置いていない物も登録できます。', en: 'Register the gear you own here, including items not on any desk.' },
    { target: 'gear-search', title: { ja: '持ち物を検索', en: 'Search owned gear' }, pad: 4, ja: '商品名・メモ・ジャンル名で探せます。', en: 'Search by name, note, or category.' },
    { target: 'gear-stats', title: { ja: '持ち物の統計', en: 'Inventory statistics' }, pad: 4, ja: '持ち物全体の購入総額、ジャンル別の点数、購入年ごとの内訳を見られます。', en: 'See totals for all your owned gear, counts by category, and purchases by year.' },
    { target: 'gear-usage', title: { ja: '使用状況で切り替え', en: 'Filter by usage' }, pad: 4, ja: '使用中・未使用を切り替えます。以前デスクで使った機材も未使用に含み、使用したデスクと期間は残ります。未使用の機材は左スワイプで処分済みにでき、名前の横にアイコンが付きます。', en: 'Switch between in-use and unused gear. Unused includes gear previously used on a desk, keeping its desk names and usage dates. Swipe unused gear left to mark it as disposed; an icon appears beside its name.' },
    { target: 'gear-favorites', title: { ja: 'お気に入りで絞り込み', en: 'Filter favorites' }, pad: 4, ja: '「★ お気に入り」を押すと、選んだ使用状況のお気に入りだけを表示します。星はデスク詳細と共通で、各一覧の先頭に並びます。撤去しても星は残ります。', en: 'Use Favorites to filter the selected usage group. Stars are shared with desk details and favorites appear first. Retiring gear keeps its star.' },
    { target: 'gear-group', title: { ja: '持ち物のまとめ方', en: 'Group your gear' }, ja: '一覧のまとめ方を切り替えます。ブランドでまとめると、ブランドごとに機材を開いたり畳んだりできます。', en: 'Change how the list is grouped. Brand groups can be expanded or collapsed.' },
    { target: 'gear-brand-group', title: { ja: 'ブランドの機材を開く', en: 'Expand a brand' }, ja: 'タップで、このブランドの機材を表示・非表示にします。', en: 'Tap to show or hide gear in this brand group.' },
    { target: 'gear-row', title: { ja: '機材の操作', en: 'Gear actions' }, emphasis: { ja: ['タップ', '左へスワイプ', '長押し'], en: ['Tap', 'Swipe left', 'Hold'] }, ja: '・タップ：詳細（価格・購入日・端子）を開く\n・左へスワイプ：使用中は撤去、未使用は処分。削除も選べます\n・長押し：複数選択', en: '• Tap: open details such as price, purchase date, and ports\n• Swipe left: retire in-use gear or dispose of unused gear. Delete is also available\n• Hold: select several' },
    { target: 'gear-trash', title: { ja: '最近削除した機材', en: 'Recently deleted' }, emphasis: { ja: ['30日間', '履歴ごと戻せます'], en: ['30 days', 'restored with its desk history'] }, pad: 4, ja: '削除した機材は30日間ここに残り、デスクの履歴ごと戻せます。', en: 'Deleted gear stays here for 30 days and can be restored with its desk history.' },
    { target: 'gear-empty', title: { ja: '機材を登録', en: 'Register gear' }, pad: 4, ja: 'まず持っている機材を登録しましょう。', en: 'Start by registering the gear you own.' },
  ],
}

const MY_PAGE_PROFILE_COACH: CoachStep[] = [
  { target: 'profile', title: { ja: 'プロフィール', en: 'Profile' }, ja: 'タップで名前やアイコンを編集します。@から始まるIDを押すと、ほかの人から見える自分のページを開きます。', en: 'Tap to edit your name and icon. Tap your @ID to see your page as others do.' },
  { target: 'profile-following', title: { ja: 'フォロー中の人', en: 'People you follow' }, ja: 'タップでフォロー中の人の一覧を開きます。一覧からプロフィールの確認やフォローの解除ができます。', en: 'Open the list of people you follow to view profiles or unfollow them.' },
  { target: 'profile-counts', title: { ja: 'デスク・機材の数', en: 'Desk and gear counts' }, pad: 4, ja: 'デスクの数、そのうち公開している数（URL限定を含む）、持っている機材の数です。右端はいまのプランです。', en: 'Your desks, how many are published (including unlisted), and your owned gear. Your plan is on the right.' },
  { target: 'mypage-tabs', title: { ja: '一覧を切替', en: 'Switch lists' }, pad: 0, ja: '自分のデスク・見たデスクの履歴・保存したデスク・持っている機材を切り替えます。', en: 'Switch between your desks, viewing history, saved desks, and your gear.' },
]

// 下線の幅。タブ幅いっぱいに引くと3つ並んだときに帯に見えるので、中央に短く置く
const UNDERLINE_W = 42

export function MyPageScreen({ navigation }: { navigation: MyPageNavigation }) {
  const { colors: C, lang, reduceMotion } = useApp()
  const { user, profile } = useAuth()
  const { plans } = usePlans()
  const { gadgets } = useGadgets()
  const ownedCount = gadgets.filter(isOwnedGadget).length
  const { isPro } = useEntitlement()
  const ja = lang === 'ja'
  // プロフィールはタブの帯と同じカードの色にし、上の1つの塊として下の一覧（bgList）と分ける。
  // 土台の色のままだと一覧と同じ色で、帯だけが浮いて見えた
  const PROFILE_BG = C.card
  const PROFILE_TEXT = C.text
  const PROFILE_MUTED = C.textMuted

  const [tab, setTab] = useState<TabKey>('published')
  const requestedTabRef = useRef(tab)
  requestedTabRef.current = tab
  // 描画前に同じタブへ戻る連打でも、表示予約を更新する。
  const [tabRequestVersion, setTabRequestVersion] = useState(0)
  // 一度でも開いたタブだけをマウントする。最初から3つ作ると、
  // ガジェットタブ（スワイプ行・LayoutAnimation を持つ）の分だけ初回表示が遅れる
  const [mounted, setMounted] = useState<TabKey[]>(['published'])
  const mountedRef = useRef(mounted)
  mountedRef.current = mounted
  // 実際に出しているペイン。tab は「押された先」で、初めて開くタブでは
  // マウントが1フレーム遅れるぶんだけ両者がずれる（selectTab の注記を参照）
  const [visibleTab, setVisibleTab] = useState<TabKey>('published')
  const tabContentProgress = useRef(new Animated.Value(0)).current
  const previousVisibleTab = useRef(visibleTab)
  useLayoutEffect(() => {
    const previous = previousVisibleTab.current
    previousVisibleTab.current = visibleTab
    if (reduceMotion || previous === visibleTab) { tabContentProgress.setValue(0); return }
    const nextIndex = TABS.findIndex(({ key }) => key === visibleTab)
    const previousIndex = TABS.findIndex(({ key }) => key === previous)
    tabContentProgress.setValue(nextIndex > previousIndex ? 1 : -1)
    const animation = Animated.timing(tabContentProgress, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    })
    animation.start()
    return () => animation.stop()
  }, [visibleTab, reduceMotion, tabContentProgress])
  const tabContentStyle = useMemo(() => ({
    opacity: tabContentProgress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
    transform: [{ translateX: tabContentProgress.interpolate({ inputRange: [-1, 1], outputRange: [-14, 14] }) }],
  }), [tabContentProgress])
  const coach = useCoachMarks()
  const { open: openCoach, target: coachTarget } = coach
  const visibleTabRef = useRef(visibleTab)
  visibleTabRef.current = visibleTab
  const openHelp = useCallback(() => {
    // 一覧とプロフィールは、上へ送ると固定のタブバーの裏へ入る
    void openCoach([...MY_PAGE_TAB_COACH[visibleTabRef.current], ...MY_PAGE_PROFILE_COACH]
      .map((step) => step.target === 'mypage-tabs' ? step : { coveredBy: ['mypage-tabs'], ...step }))
  }, [openCoach])
  useLayoutEffect(() => {
    navigation.setOptions({ headerRight: () => (
      <HeaderButtonGroup>
        <HeaderIconButton name={ICONS.settings} color={C.text} onPress={() => navigation.navigate('Settings')} accessibilityLabel={ja ? '設定' : 'Settings'} />
        <HeaderIconButton name="help-circle-outline" color={C.text} onPress={openHelp} accessibilityLabel={ja ? 'この画面の見方' : 'Understanding this screen'} />
      </HeaderButtonGroup>
    ) })
  }, [navigation, C.text, ja, openHelp])
  const [nickname, setNickname] = useState('')
  const [editingProfile, setEditingProfile] = useState(false)
  const [deskCount, setDeskCount] = useState(plans.length)
  const [publishedCount, setPublishedCount] = useState(0)
  // タブは display で出し分けるだけでスクロール位置をそれぞれ保つので、
  // 固定タブバーの追従もタブごとに別の値で持つ
  const scrollYs = useRef<Record<TabKey, Animated.Value>>({
    published: new Animated.Value(0),
    favorites: new Animated.Value(0),
    gadgets: new Animated.Value(0),
    history: new Animated.Value(0),
  }).current
  const scrollOffsetsRef = useRef<Record<TabKey, number>>({ published: 0, favorites: 0, gadgets: 0, history: 0 })
  const scrollRequestIdRef = useRef(0)
  const [scrollSync, setScrollSync] = useState<{ key: TabKey; request: ScrollSyncRequest } | null>(null)
  const [tabBarWidth, setTabBarWidth] = useState(0)
  const [tabBarHeight, setTabBarHeight] = useState(0)
  const [profileHeight, setProfileHeight] = useState(0)
  const [paneHeight, setPaneHeight] = useState(0)
  const minimumContentHeight = paneHeight > 0 && profileHeight > 0
    ? paneHeight + profileHeight
    : undefined
  useEffect(() => {
    const listeners = TABS.map(({ key }) => ({
      value: scrollYs[key],
      id: scrollYs[key].addListener(({ value }) => {
        scrollOffsetsRef.current[key] = Math.max(0, value)
      }),
    }))
    return () => listeners.forEach(({ value, id }) => value.removeListener(id))
  }, [scrollYs])
  // 3つのペインが同じ header を描くので onLayout も最大3回走る。隠れている
  // ペイン（display: none）が高さ0を返した場合にそれを採用すると、
  // renderStickyTabBar が全タブで null になって固定タブバーごと消える
  const onProfileLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height
    if (h <= 0) return
    setProfileHeight((prev) => (Math.abs(prev - h) < 0.5 ? prev : h))
  }, [])

  useFocusEffect(useCallback(() => {
    let active = true
    getPublicNickname().then((name) => { if (active) setNickname(name) }).catch(() => {})
    return () => { active = false }
  }, []))

  // フォロー中の数は本人にしか見えない（084）。他所でフォローして戻ってきたときに合わせる
  const [followingCount, setFollowingCount] = useState<number | null>(null)
  useFocusEffect(useCallback(() => {
    if (!user) { setFollowingCount(null); return }
    let active = true
    listFollowedUserIds(user.id)
      .then((ids) => { if (active) setFollowingCount(ids.length) })
      .catch(() => {})
    return () => { active = false }
  }, [user]))

  const openFollowing = useCallback(() => {
    if (navigation.isFocused()) navigation.navigate('FollowingList')
  }, [navigation])

  // 初めて開くタブは、マウントを描画のあとへ送る。同じコミットで下線の切り替えと
  // タブの中身のマウントを両方やると、ガジェットタブ（全ガジェット×全デスクの
  // 突き合わせを初回レンダーで回す）の計算が終わるまで下線が動かない。
  // WiringResultScreen の配線タブ・情報タブが先に同じ手当てをしている。
  //
  // 送っている間は、行き先のタブの骨組み（プロフィール＋仮の一覧）を出す。
  // 前のタブを出したままにしていた頃は、下線は「ガジェット」なのに中身はデスクの一覧、
  // という食い違いがガジェットタブの初回計算のあいだ見えていた。何も出さないと、
  // ペインは display: none で出し分けているので3つとも消えて画面が真っ白になる
  // 押してから本物のペインが出るまでの実測。遅延マウントは「コストを消す」のではなく
  // 「初回表示からタブ操作へ移す」最適化なので、移した先が測れないと重くなっても気づけない
  const tabTapAtRef = useRef(0)
  const selectTab = useCallback((key: TabKey) => {
    const previous = requestedTabRef.current
    if (key === previous) return
    requestedTabRef.current = key
    setTabRequestVersion((version) => version + 1)
    if (__DEV__) tabTapAtRef.current = Date.now()
    // 中身のマウントは遅らせてあるので、押した瞬間に返せるのは下線と触覚だけ
    hapticSelection()
    if (profileHeight > 0) {
      const offset = synchronizedTabOffset(
        scrollOffsetsRef.current[previous],
        scrollOffsetsRef.current[key],
        profileHeight,
      )
      scrollOffsetsRef.current[key] = offset
      // 実体のリストが追従する前の1フレームも、固定タブバーだけ先に跳ねないよう揃える。
      scrollYs[key].setValue(offset)
      setScrollSync({ key, request: { id: ++scrollRequestIdRef.current, offset } })
    }
    setTab(key)
    // マウント済みの遷移先は、非表示のままスクロール位置を直してから次フレームで出す。
    // 表示と scrollTo を同じコミットにすると、端末によって補正前の1フレームが見える。
    if (mountedRef.current.includes(key)) return
    setVisibleTab(key)
    InteractionManager.runAfterInteractions(() => {
      setMounted((prev) => (prev.includes(key) ? prev : [...prev, key]))
    })
  }, [profileHeight, scrollYs])

  useEffect(() => {
    if (tab === visibleTab || !mounted.includes(tab)) return
    const frame = requestAnimationFrame(() => {
      // 予約から実行までの連打で、古いタブを表示しない。
      setVisibleTab(requestedTabRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [mounted, tab, visibleTab, tabRequestVersion])

  // 下のマイページを押し直すと、1回目は一覧の先頭へ（useScrollToTopOf）、先頭にいるときは
  // デスクのタブへ戻す。押した時点の位置で決めるので、先頭へ戻すスクロールとは重ならない
  const tabPressStateRef = useRef({ tab, visibleTab, selectTab })
  tabPressStateRef.current = { tab, visibleTab, selectTab }
  useEffect(() => {
    const tabs = navigation.getParent<BottomTabNavigationProp<MainTabsParamList>>()
    if (!tabs) return
    return tabs.addListener('tabPress', (event) => {
      // 上に別の画面が積まれているときはスタックを戻すだけにする（popToTopOnTabPress）
      if (event.defaultPrevented || !navigation.isFocused()) return
      const { tab: current, visibleTab: shown, selectTab: select } = tabPressStateRef.current
      if (current === 'published' || scrollOffsetsRef.current[shown] > 1) return
      select('published')
    })
  }, [navigation])

  useEffect(() => {
    if (!__DEV__ || tabTapAtRef.current === 0 || !mounted.includes(visibleTab)) return
    console.log(`[perf] mypage tab "${visibleTab}": ${Date.now() - tabTapAtRef.current}ms`)
    tabTapAtRef.current = 0
  }, [visibleTab, mounted])

  // 右上メニューの設定は一覧（ハブ）へ。ここから基本設定へ直行させると、外観・データ管理・
  // ログアウトを含む他のセクションに辿り着く手段がアプリ内から無くなる
  const openSettings = useCallback(() => {
    if (!navigation.isFocused()) return
    navigation.navigate('Settings')
  }, [navigation])

  // プロフィールそのものをタップしたら、設定を経由せず編集シートをこの上に開く。
  // 設定のアカウント一覧へ送っていた間は、そこでもう一度押さないと名前を変えられなかった
  const openProfileEditor = useCallback(() => setEditingProfile(true), [])

  // 現在のプラン。Paywall への導線は22箇所あるが、すべて上限に当たったときの
  // 受け身の入口で、自分から契約したい人の経路が設定の中（4タップ）しか無かった
  const openPlan = useCallback(() => {
    if (!navigation.isFocused()) return
    // Pro の解約・変更はストア側でしか行えないので、設定のプランカードへ送る
    if (isPro) { openSettings(); return }
    navigation.navigate('Paywall', { reason: 'manual' })
  }, [isPro, navigation, openSettings])

  // タップで自分の公開プロフィール（他人に見えている面）を開く
  const openMyProfile = useCallback((tag: string) => {
    if (!navigation.isFocused()) return
    navigation.navigate('PublicProfile', { tag })
  }, [navigation])

  const tabBar = useMemo(() => (
    <View
      style={[styles.tabBar, { backgroundColor: C.card, borderTopColor: C.border, borderBottomColor: C.border }]}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout
        setTabBarWidth((prev) => Math.abs(prev - width) < 0.5 ? prev : width)
        if (height > 0) setTabBarHeight((prev) => Math.abs(prev - height) < 0.5 ? prev : height)
      }}
    >
      {TABS.map((tb) => {
        const selected = tab === tb.key
        // 選択中のアイコンとラベルは本文色。アイコンは塗りに替えず線のまま
        // 色だけ変える（塗りと線が混ざると、3つのうち1つだけ絵の太さが違って見える）
        const tint = selected ? C.text : C.textMuted
        return (
          <TouchableOpacity
            key={tb.key}
            style={styles.tab}
            onPress={() => selectTab(tb.key)}
            accessibilityRole="tab"
            accessibilityLabel={ja ? tb.ja : tb.en}
            accessibilityState={{ selected }}
          >
            <AppIcon name={tb.icon} size={24} color={tint} />
            <Text style={[styles.tabText, selected && styles.tabTextSelected, { color: tint }]} numberOfLines={1}>
              {ja ? tb.ja : tb.en}
            </Text>
          </TouchableOpacity>
        )
      })}
      {/* 下線は visibleTab ではなく tab（押された先）を追う。中身のマウントを待つと、
          遅延マウントで押した瞬間から下線が動かず、そこが遅く感じる原因そのものになる */}
      <TabUnderline
        count={TABS.length}
        index={TABS.findIndex((tb) => tb.key === tab)}
        barWidth={tabBarWidth}
        color={C.accentIcon}
        width={UNDERLINE_W}
        bottom={-StyleSheet.hairlineWidth}
      />
    </View>
  ), [C, ja, tab, selectTab, tabBarWidth])

  const header = useMemo(() => (
    <View>
      <View style={[styles.profileSection, { backgroundColor: PROFILE_BG }]} onLayout={onProfileLayout}>
        {/* フォロー中は件数行に入らないので、アバター行の右端に置く。独立した行にしていた頃は
            右寄せの1項目のために1行ぶんの高さを使っていて、そのぶんアバターと名前を小さくしていた */}
        <View style={styles.profileTopRow}>
          {/* プロフィールそのものを編集の入口にする。歯車まで行かないと名前を変えられないと
              「未設定」のまま放置され、公開ページの投稿者名が空のままになる */}
          <CoachAnchor id="profile">
          <TouchableOpacity
            style={styles.profileEditArea}
            onPress={openProfileEditor}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={ja ? 'プロフィールを編集' : 'Edit profile'}
          >
            <AuthorAvatar name={nickname} tag={profile?.public_tag} imageUrl={profile?.public_avatar_url} size={76} />
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, { color: nickname ? PROFILE_TEXT : PROFILE_MUTED }]} numberOfLines={1}>
                {nickname || (ja ? '名前を設定' : 'Add your name')}
              </Text>
              {!!profile?.public_tag && (
                <Text
                  style={[styles.profileTag, { color: PROFILE_MUTED }]}
                  numberOfLines={1}
                  suppressHighlighting
                  onPress={(event) => {
                    event.stopPropagation()
                    openMyProfile(profile.public_tag as string)
                  }}
                  accessibilityRole="link"
                  accessibilityLabel={ja ? '自分の公開プロフィールを見る' : 'View my public profile'}
                >
                  @{profile.public_tag}
                </Text>
              )}
            </View>
          </TouchableOpacity>
          </CoachAnchor>
          {followingCount !== null && (
            <CoachAnchor id="profile-following"><TouchableOpacity
              style={styles.followingItem}
              onPress={openFollowing}
              hitSlop={12}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={ja ? `フォロー中 ${followingCount}人。一覧を開きます` : `Following ${followingCount}. Opens the list`}
            >
              <Text style={[styles.profileCountValue, { color: PROFILE_TEXT }]}>{followingCount}</Text>
              <Text style={[styles.profileCountLabel, { color: PROFILE_TEXT }]}>{ja ? 'フォロー中' : 'Following'}</Text>
              <AppIcon name={ICONS.chevronRight} size={16} color={PROFILE_MUTED} />
            </TouchableOpacity></CoachAnchor>
          )}
        </View>
        <CoachAnchor id="profile-counts">
        <View style={styles.profileCountsRow}>
          {/* 公開はデスクの内訳なので、デスクの右に置く（URL限定も含めた数） */}
          <View style={styles.profileCountItem}>
            <Text style={[styles.profileCountValue, { color: PROFILE_TEXT }]}>{deskCount}</Text>
            <Text style={[styles.profileCountLabel, { color: PROFILE_TEXT }]}>{ja ? 'デスク' : 'Desks'}</Text>
          </View>
          <View style={[styles.countSeparator, { backgroundColor: C.border }]} />
          <View style={styles.profileCountItem}>
            <Text style={[styles.profileCountValue, { color: PROFILE_TEXT }]}>{publishedCount}</Text>
            <Text style={[styles.profileCountLabel, { color: PROFILE_TEXT }]}>{ja ? '公開' : 'Published'}</Text>
          </View>
          <View style={[styles.countSeparator, { backgroundColor: C.border }]} />
          <View style={styles.profileCountItem}>
            <Text style={[styles.profileCountValue, { color: PROFILE_TEXT }]}>{ownedCount}</Text>
            <Text style={[styles.profileCountLabel, { color: PROFILE_TEXT }]}>{ja ? '所有機材' : 'Owned gear'}</Text>
          </View>
          <TouchableOpacity
            style={[styles.planChip, { borderColor: isPro ? PROFILE_TEXT : PROFILE_MUTED }]}
            onPress={openPlan}
            hitSlop={8}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={isPro
              ? (ja ? 'Pro プラン。設定を開きます' : 'Pro plan. Opens settings')
              : (ja ? 'Free プラン。Pro の案内を開きます' : 'Free plan. Opens Pro details')}
          >
            <AppIcon name="crown-outline" size={14} color={isPro ? C.pro : PROFILE_MUTED} />
            <Text style={[styles.planChipText, { color: isPro ? PROFILE_TEXT : PROFILE_MUTED }]}>
              {isPro ? 'Pro' : 'Free'}
            </Text>
          </TouchableOpacity>
        </View>
        </CoachAnchor>
      </View>

      {/* 実体は全ペインに共通の固定タブバー側。ここは同じものを透明で置いて
          高さだけを合わせる（読み上げが二重にならないよう a11y からも外す） */}
      <View
        style={styles.tabBarSpacer}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {tabBar}
      </View>
    </View>
  ), [C.border, C.pro, PROFILE_BG, PROFILE_MUTED, PROFILE_TEXT, ja, followingCount, openFollowing, nickname, profile, deskCount, ownedCount, publishedCount, tabBar, onProfileLayout, openProfileEditor, openMyProfile, isPro, openPlan])

  // スクロールバーが動く範囲の上端を、重ねたタブの帯の下端に合わせる（useMyPageScrollIndicator の注記）
  const stickyBarBottom = useStickyBarBottom(scrollYs[visibleTab], scrollOffsetsRef.current[visibleTab], profileHeight, tabBarHeight)
  const scrollIndicatorInsets = useMemo(() => ({ top: stickyBarBottom }), [stickyBarBottom])

  // 一覧の中の控えと同じ位置に重ね、プロフィールの高さぶん流れたら上端で止める。
  const renderStickyTabBar = useCallback((key: TabKey) => {
    if (profileHeight <= 0) return null
    const y = scrollYs[key]
    return (
      <Animated.View
        ref={coachTarget('mypage-tabs') as (node: View | null) => void}
        style={[styles.stickyTabBar, {
          transform: [{
            translateY: y.interpolate({
              inputRange: [0, profileHeight],
              outputRange: [profileHeight, 0],
              extrapolateRight: 'clamp',
            }),
          }],
        }]}
      >
        {tabBar}
      </Animated.View>
    )
  }, [profileHeight, scrollYs, tabBar, coachTarget])

  return (
    <SafeAreaView
      ref={coachTarget(COACH_SCREEN)}
      style={[styles.container, { backgroundColor: PROFILE_BG }]}
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height
        if (height > 0) setPaneHeight((prev) => Math.abs(prev - height) < 0.5 ? prev : height)
      }}
    >
      <CoachScope coach={coach}>
      <MyPageScrollIndicatorContext.Provider value={tabBarHeight > 0 ? scrollIndicatorInsets : undefined}>
      <View style={styles.pane}>
      {mounted.includes('published') && (
        <CoachScope coach={coach} enabled={visibleTab === 'published'}>
        <Animated.View style={[styles.pane, visibleTab === 'published' ? tabContentStyle : styles.paneHidden]} {...hiddenPaneProps(visibleTab !== 'published')}>
          <PublishedDeskListScreen
            navigation={navigation}
            headerSlot={header}
            userId={user?.id ?? null}
            active={tab === 'published'}
            scrollY={scrollYs.published}
            scrollSyncRequest={scrollSync?.key === 'published' ? scrollSync.request : undefined}
            minimumContentHeight={minimumContentHeight}
            onDeskCountChange={setDeskCount}
            onCountChange={setPublishedCount}
          />
        </Animated.View>
        </CoachScope>
      )}
      {mounted.includes('favorites') && (
        <CoachScope coach={coach} enabled={visibleTab === 'favorites'}>
        <Animated.View style={[styles.pane, visibleTab === 'favorites' ? tabContentStyle : styles.paneHidden]} {...hiddenPaneProps(visibleTab !== 'favorites')}>
          <BookmarkListScreen
            navigation={navigation}
            headerSlot={header}
            embedded
            active={tab === 'favorites'}
            scrollY={scrollYs.favorites}
            scrollSyncRequest={scrollSync?.key === 'favorites' ? scrollSync.request : undefined}
            minimumContentHeight={minimumContentHeight}
            headerCollapseDistance={profileHeight}
          />
        </Animated.View>
        </CoachScope>
      )}
      {mounted.includes('gadgets') && (
        <CoachScope coach={coach} enabled={visibleTab === 'gadgets'}>
        <Animated.View style={[styles.pane, visibleTab === 'gadgets' ? tabContentStyle : styles.paneHidden]} {...hiddenPaneProps(visibleTab !== 'gadgets')}>
          <GadgetLibraryScreen
            navigation={navigation}
            headerSlot={header}
            embedded
            active={tab === 'gadgets'}
            onOpenStats={() => navigation.navigate('GadgetStats')}
            scrollY={scrollYs.gadgets}
            scrollSyncRequest={scrollSync?.key === 'gadgets' ? scrollSync.request : undefined}
            minimumContentHeight={minimumContentHeight}
          />
        </Animated.View>
        </CoachScope>
      )}
      {mounted.includes('history') && (
        <CoachScope coach={coach} enabled={visibleTab === 'history'}>
        <Animated.View style={[styles.pane, visibleTab === 'history' ? tabContentStyle : styles.paneHidden]} {...hiddenPaneProps(visibleTab !== 'history')}>
          <ViewHistoryListScreen
            navigation={navigation}
            headerSlot={header}
            active={tab === 'history'}
            scrollY={scrollYs.history}
            scrollSyncRequest={scrollSync?.key === 'history' ? scrollSync.request : undefined}
            minimumContentHeight={minimumContentHeight}
          />
        </Animated.View>
        </CoachScope>
      )}
      {/* 行き先のタブをマウントするまでの骨組み（selectTab の注記）。
          スクロール位置は新しいタブと同じ先頭から始まる */}
      {!mounted.includes(visibleTab) && (
        <Animated.View style={[styles.pane, tabContentStyle]}>
          <ScrollView
            scrollEnabled={false}
            style={{ backgroundColor: C.bgList }}
            contentOffset={{
              x: 0,
              y: scrollSync?.key === visibleTab ? scrollSync.request.offset : 0,
            }}
            contentContainerStyle={minimumContentHeight ? { minHeight: minimumContentHeight } : undefined}
          >
            {header}
            {/* 各タブの実物と同じ形（デスク＝16:9 のタイル、保存・履歴＝2列のタイル、ガジェット＝行）。
                保存・履歴の切り替えとガジェットの検索欄も先に出す。無いと、本物に替わった瞬間に
                それが割り込んで一覧が一段下へずれる。押しても本物が出るまでは何もしない */}
            {visibleTab === 'published'
              ? <ListSkeleton count={2} variant="card" widePhoto />
              : visibleTab === 'favorites' || visibleTab === 'history'
                ? (
                  <View pointerEvents="none" style={styles.skeletonScope}>
                    {visibleTab === 'favorites'
                      ? <ReactionScopeSwitch value="desks" onChange={() => {}} colors={C} lang={lang} />
                      : <HistoryScopeSwitch value="viewed" onChange={() => {}} lang={lang} />}
                    <ListSkeleton count={4} variant="card" columns={2} gap={10} inset="horizontal" />
                  </View>
                )
                : (
                  <View pointerEvents="none">
                    <GadgetLibraryHeaderPlaceholder ownedCount={ownedCount} showStats />
                    <ListSkeleton count={5} inset="horizontal" />
                  </View>
                )}
          </ScrollView>
        </Animated.View>
      )}
      {/* 仮表示から一覧へ切り替えるときも下線を再マウントせず、移動中の位置を保つ。 */}
      {renderStickyTabBar(visibleTab)}
      </View>
      </MyPageScrollIndicatorContext.Provider>
      </CoachScope>
      {coach.overlay}
      <ProfileEditSheet
        visible={editingProfile}
        onClose={() => setEditingProfile(false)}
        onSaved={setNickname}
        onOpenPublicProfile={openMyProfile}
      />
    </SafeAreaView>
  )
}

// 隠れたタブは触れず、読み上げにも出さない（透明なだけで画面には残っている）
function hiddenPaneProps(hidden: boolean) {
  return hidden
    ? { pointerEvents: 'none' as const, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const }
    : {}
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  // 隠すタブは透明にして後ろへ重ねる。アンマウントするとスクロール位置と取得済みの一覧が毎回消える。
  // display: 'none' で畳んでいた頃は、新アーキテクチャがその間ネイティブのビューを外して作り直すので、
  // 行の横スワイプ（Gesture Handler は最初のビューに付いたまま）が別のタブから戻ると効かなくなった。
  // 隠れた一覧も画面に残るので、各一覧は scrollsToTop を出ているタブだけにする（iOS は複数あると
  // ステータスバーのタップで先頭へ戻さない）
  pane: { flex: 1 },
  paneHidden: { ...StyleSheet.absoluteFillObject, opacity: 0, zIndex: -1 },
  // 切り替えと最初のタイルの間。本物の一覧では contentContainer の gap（10）が持つ
  skeletonScope: { gap: 10 },

  // 上端はステータスバーのすぐ下から始める（SafeAreaView がその高さぶん下げている）。
  // 22 空けていた頃は、帯の上 1/4 が何も無いまま残っていた
  profileSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileEditArea: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  profileInfo: { flex: 1, minWidth: 0 },
  profileName: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  profileTag: { flexShrink: 1, fontSize: 14, lineHeight: 19, fontWeight: '400', marginTop: 2 },
  followingItem: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  profileCountsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  profileCountItem: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  profileCountValue: { fontSize: 18, fontWeight: '800' },
  profileCountLabel: { fontSize: 13, fontWeight: '500' },
  countSeparator: { width: StyleSheet.hairlineWidth, height: 17, marginHorizontal: 10 },
  // 件数の並びの右端。押せる高さは 32 + hitSlop 8 で 48
  planChip: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    minHeight: 28,
    borderRadius: UI_METRICS.pillRadius,
    borderWidth: StyleSheet.hairlineWidth,
  },
  planChipText: { fontSize: 12, fontWeight: '800' },

  stickyTabBar: { position: 'absolute', left: 0, right: 0, top: 0 },
  tabBarSpacer: { opacity: 0 },
  // 上の角は丸めない。プロフィールと同じ色でつながっているので、丸めると角の外に一覧の色が覗く
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, paddingTop: 12, paddingBottom: 10 },
  tabText: { fontSize: 11, fontWeight: '500' },
  tabTextSelected: { fontWeight: '700' },
})
