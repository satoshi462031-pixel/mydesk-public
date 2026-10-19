import { ICONS, MCIconName } from '../../constants/icons'
import { HelpSection, ScreenHelpSheet } from './ScreenHelpSheet'

type Props = {
  visible: boolean
  onDismiss: () => void
  context: 'feed' | 'detail' | 'all'
  hasPhotos?: boolean
  hasGear?: boolean
  ownDesk?: boolean
  unlisted?: boolean
  profileOpenable?: boolean
  hasPurposes?: boolean
}

export function ExploreHelpSheet({ visible, onDismiss, context, hasPhotos = true, hasGear = true, ownDesk = false, unlisted = false, profileOpenable = true, hasPurposes = true }: Props) {
  const feed: HelpSection[] = [
    { id: 'feed-search', ja: '探し方', en: 'Finding desks', items: [
      { icon: 'magnify', ja: '検索欄ではデスク・機材・ユーザーを探せます。「すべて」「デスク」「ユーザー」は、探す対象の切り替えです。', en: 'Search for desks, gear, or people. All, Desks, and People change what you search for.' },
      { icon: 'filter-variant', ja: '絞り込みでは用途や機材のジャンルを選べます。ボタンの点は絞り込み中の印です。条件のチップを外すか、リセットで解除できます。', en: 'Filter by purpose or gear category. A dot on the filter button means a filter is active. Remove a chip or reset to clear it.' },
      { icon: 'clock-outline', ja: '「最近のデスク」は最近更新された公開デスクです。検索結果の終わりを示す見出しより下には、近いものやおすすめが続きます。', en: 'Recent desks are recently updated public desks. Below the end of search results, you may find related suggestions.' },
    ] },
    { id: 'feed-cards', ja: 'カードの表示', en: 'Reading desk cards', items: [
      { icon: ICONS.image, ja: '写真かデスク名をタップすると詳細を開きます。カードの投稿者名やアイコンからもデスク詳細へ進めます。', en: 'Tap a photo, desk name, or author on a desk card to open the desk.' },
      { icon: 'controller-classic', ja: '用途のアイコンは、ゲーム・仕事などの使い方を表します。一覧ではデスクと一緒に表示される印です。', en: 'Purpose icons describe uses such as gaming or work. On cards, they are labels for the desk.' },
      { icon: 'calendar-clock', ja: '投稿者名の横の「3日前」などは、その公開デスクが最後に更新されてからの時間です。', en: 'The time beside the author, such as “3d ago”, shows when the public desk was last updated.' },
      { icon: 'circle', badge: 'updateLabel', ja: '投稿者名の横の「新着」は公開から7日以内でまだ開いていないデスク、「更新」は前に開いたときから変わったデスクの印です。', en: '“New” beside the author marks a desk published within seven days that you have not opened. “Updated” marks one that changed since you last opened it.' },
      { icon: ICONS.clap, ja: '拍手の数字は累計の拍手数です。閲覧数・保存数・人数ではありません。', en: 'The applause number is cumulative applause, rather than views, saves, or a count of people.' },
    ] },
    { id: 'feed-lists', ja: '機材・ユーザーの一覧', en: 'Gear and people lists', items: [
      { icon: 'package-variant-closed', ja: '機材の横の件数は、その機材を使っている公開デスクの数です。機材の行をタップすると、使っているデスクを絞り込めます。', en: 'The desk count beside gear is the number of public desks using it. Tap the gear row to find those desks.' },
      { icon: 'account-outline', ja: 'ユーザーの数字は、その人の公開デスク数です。ユーザーの行をタップするとプロフィールを開きます。', en: 'A person’s count is their number of public desks. Tap their row to open their profile.' },
    ] },
    { id: 'feed-updates', ja: '更新のお知らせ', en: 'Update notifications', items: [
      { icon: ICONS.bell, ja: 'ベルから、保存したデスク・フォロー中の人の更新と、自分のデスクへの拍手を見られます。ベルやタブの点は、新しいお知らせがある印です。', en: 'The bell shows updates to saved desks, desks from people you follow, and applause on your desks. A dot on the bell or tab means new notifications.' },
    ] },
  ]
  const detail: HelpSection[] = [
    { id: 'detail-views', ja: '写真・機材・配線・履歴', en: 'Photos, gear, wiring, and history', items: [
      ...(hasPhotos ? [{ icon: ICONS.image, ja: '写真をタップすると拡大して見られます。', en: 'Tap a photo to open a larger preview.' }] : []),
      ...(hasPurposes ? [{ icon: 'controller-classic' as MCIconName, ja: '用途のアイコンをタップすると、ゲーム・仕事などのラベルを確認できます。', en: 'Tap a purpose icon to see its label, such as gaming or work.' }] : []),
      ...(hasGear ? [{ icon: 'package-variant-closed' as MCIconName, ja: '「機材」には、このデスクで使われているものが並びます。機材の行をタップすると詳細を開きます。', en: 'Gear lists what is used on this desk. Tap a gadget row for details.' }] : []),
      { icon: 'vector-polyline', ja: '「配線」は登録された接続を図で表示します。拡大・縮小や移動、全体表示で見渡せます。図の凡例で線や印の意味を確認できます。', en: 'Wiring maps the registered connections. Zoom, pan, or fit the map to view it, and use the legend to understand lines and symbols.' },
      { icon: 'chart-timeline-variant', ja: '「履歴・分析」は登録された機材の変化や集計です。記録されている範囲の履歴を見られます。', en: 'Insights shows recorded gear changes and summaries. History covers the data that has been registered.' },
    ] },
    ...(!unlisted ? [{ id: 'detail-actions', ja: '保存と拍手', en: 'Saving and applause', items: [
      ...(!ownDesk ? [{ icon: 'bookmark-outline' as MCIconName, ja: '「保存」はブックマークです。マイページの「保存」で見返せます。ダウンロードや自分のデスクへのコピーではありません。保存するにはログインが必要です。', en: 'Save bookmarks this desk in My Page → Saved. It does not download or copy the desk. Sign in to save.' }] : []),
      { icon: ICONS.clap, ja: ownDesk ? '数字は、このデスクに届いた累計の拍手数です。' : '「拍手」は投稿者に気に入ったことを伝えます。もう一度押すと取り消せます。デスクが更新されると、再び拍手できます。操作にはログインが必要です。', en: ownDesk ? 'The number is cumulative applause received by this desk.' : 'Applause tells the author you like their desk. Tap again to remove it. After the desk is updated, you can applaud again. Sign in to applaud.' },
    ] }] : []),
    { id: 'detail-author', ja: ownDesk ? '共有' : '投稿者・共有・自分のデスク作り', en: ownDesk ? 'Sharing' : 'Author, sharing, and creating your desk', items: [
      ...(!ownDesk && profileOpenable ? [{ icon: 'account-outline' as MCIconName, ja: '投稿者名からプロフィールを開けます。フォローすると、その人のデスクの更新を追えます。保存・拍手・フォローは必要なときだけ使えます。', en: 'Open the author’s profile from their name. Follow to keep up with their desk updates. Saving, applause, and following are optional.' }] : []),
      { icon: ICONS.share, ja: '「共有」から、このデスクのリンクを共有できます。', en: 'Share lets you share a link to this desk.' },
      ...(!ownDesk && hasGear ? [{ icon: ICONS.copy, ja: '「このデスクを参考に作る」は、ジャンルの組み合わせや配置を参考にして、自分の機材でデスクを作ります。機材一覧の下に入口があります。', en: 'Use this desk as a starting point copies its category combination and layout, then you select your own gear. Find it below the gear list.' }] : []),
    ] },
  ]
  const sections = context === 'feed' ? feed : context === 'detail' ? detail : [...feed, ...detail]
  return <ScreenHelpSheet visible={visible} onDismiss={onDismiss} sections={sections} initialSection={context === 'detail' ? 'detail-views' : 'feed-search'} />
}
