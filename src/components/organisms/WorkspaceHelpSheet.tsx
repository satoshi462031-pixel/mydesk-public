import { ICONS, TAB_ICONS } from '../../constants/icons'
import { BRANDS_ENABLED } from '../../constants/features'
import { HelpSection, ScreenHelpSheet } from './ScreenHelpSheet'

export type WorkspaceHelpContext = 'my-desks' | 'my-page' | 'inventory' | 'desk-detail' | 'wiring' | 'insights' | 'inventory-stats' | 'history-playback' | 'all'
type Props = {
  visible: boolean
  onDismiss: () => void
  context: WorkspaceHelpContext
  initialSection?: string
  readOnly?: boolean
}

export function WorkspaceHelpSheet({ visible, onDismiss, context, initialSection, readOnly = false }: Props) {
  const desks: HelpSection[] = [
    { id: 'desks-create', ja: 'デスクを作る・続きから開く', en: 'Create or continue a desk', items: [
      { icon: ICONS.add, ja: '「新しいデスク」から用途を選び、使う機材と配置・写真を登録します。作成途中のデスクは「作成を続ける」で再開できます。', en: 'Choose New desk, then register its purpose, gear, layout, and photos. Continue an unfinished desk with Continue setup.' },
      { icon: TAB_ICONS.plan, ja: '写真やデスク名をタップすると詳細を開きます。詳細の「機材」「配線」「履歴・分析」で、構成・接続・変化を確認できます。', en: 'Tap a photo or desk name to open details. Gear, Wiring, and Insights show its setup, connections, and changes.' },
    ] },
    { id: 'desks-organize', ja: '名前・ピン留め・複製・削除', en: 'Names, pins, copies, and deletion', items: [
      { icon: 'gesture-swipe-horizontal', ja: 'カードを右へ大きく引いて離すとピン留めを付け外しできます。短くスワイプするとピン留め・複製のボタンが開きます。左へスワイプすると削除を選べます。', en: 'Pull a desk card farther right and release to pin or unpin it. A shorter swipe opens Pin and Duplicate buttons. Swipe left for Delete.' },
      { icon: 'pin', ja: 'ピン留めすると一覧の上に置けます。作成途中とピン留めを優先し、その後は更新順に並びます。デスク名はカードの長押しや詳細の編集から変更できます。', en: 'Pinned desks stay near the top. Unfinished and pinned desks come first, then recently updated desks. Rename a desk by holding its card or editing its details.' },
    ] },
  ]
  const myPage: HelpSection[] = [
    { id: 'mypage-desks', ja: 'プロフィールとデスク', en: 'Profile and desks', items: [
      { icon: ICONS.account, ja: 'プロフィールをタップすると表示名などを編集できます。「デスク」には自分のデスクが並び、「公開中」「URL限定」「未公開」で公開範囲を確認できます。', en: 'Tap your profile to edit it. Desks lists your own desks, with Public, Unlisted, or Private indicating their visibility.' },
      { icon: TAB_ICONS.gadgets, ja: '「機材」は持ち物の一覧です。デスクに置いていない機材もここで管理できます。', en: 'Gear is your inventory, including items that are not in a desk.' },
    ] },
    { id: 'mypage-history', ja: '閲覧したデスクの履歴', en: 'Recently viewed desks', items: [
      { icon: ICONS.history, ja: 'マイページの「履歴」は、開いた公開デスクを見返す一覧です。この端末に記録され、デスクの機材構成の歴史とは別の履歴です。', en: 'History lists public desks you opened on this device. This is browsing history, separate from the history of your desk’s gear.' },
    ] },
    { id: 'mypage-saved', ja: '保存したデスク', en: 'Saved desks', items: [
      { icon: 'gesture-swipe-horizontal', ja: '保存したデスク・機材は、右へ引いて離すと保存を解除できます。', en: 'Pull a saved desk or gadget right and release to remove it from Saved.' },
      { icon: 'bookmark-outline', ja: '「保存」は、公開デスクでブックマークしたデスクを見返す場所です。保存にはログインが必要です。自分のデスクの作成や機材の登録はマイデスク・機材から行えます。', en: 'Saved holds public desks you bookmarked. Sign in to save desks. Create your own desks in MyDesk and register items in Gear.' },
    ] },
  ]
  const inventory: HelpSection[] = [
    { id: 'inventory-find', ja: '機材を追加・探す', en: 'Add and find gear', items: [
      { icon: ICONS.add, ja: '「追加」から持ち物を登録します。行をタップすると詳細を開き、商品名・価格・購入日・端子などを確認・編集できます。', en: 'Use Add to register an item. Tap a row to view its details and edit its name, price, purchase date, and ports.' },
      { icon: 'magnify', ja: '検索と「ガジェット別」「ジャンル別」で一覧を整理できます。「デスクで未使用」は、現在どのデスクにも置いていない機材です。', en: 'Use search and By gadget or By category to organize the list. Not used in any desk means the item is not currently placed in a desk.' },
      { icon: ICONS.stats, ja: '検索欄の横の統計ボタンで、持ち物全体の購入総額・点数・購入年別の内訳を確認できます。', en: 'The stats button beside search shows purchase amounts, item counts, and purchases by year for your whole inventory.' },
    ] },
    { id: 'inventory-organize', ja: '撤去・削除・複数選択', en: 'Retiring, deleting, and selecting items', items: [
      { icon: ICONS.starFilled, ja: '機材を右へ引いて離すと、お気に入りの星を付け外しできます。振動が切り替えられる距離を知らせます。', en: 'Pull an item right and release to favorite or unfavorite it. A vibration marks the distance needed to switch.' },
      { icon: 'gesture-swipe-horizontal', ja: '行を左へスワイプすると撤去・削除を選べます。撤去はデスクから外して持ち物と履歴を残します。削除した項目は「最近削除した項目」で30日間復元できます。', en: 'Swipe a row left for Retire or Delete. Retiring removes it from desks while keeping the item and its history. Deleted items can be restored from Recently Deleted for 30 days.' },
      { icon: 'gesture-tap-hold', ja: '機材を長押しすると複数選択に入ります。対象を選び、下のバーで操作できます。選択を終えると通常の一覧へ戻ります。', en: 'Hold an item to enter selection mode. Select items and use the bottom bar, then end selection to return to the list.' },
    ] },
  ]
  const deskDetail: HelpSection[] = [
    { id: 'desk-edit', ja: '機材・写真・デスク情報', en: 'Gear, photos, and desk details', items: [
      { icon: TAB_ICONS.gadgets, ja: '「機材」にはこのデスクに置くものを登録します。機材の行をタップすると詳細を開けます。', en: 'Gear lists the items placed in this desk. Tap a row for details.' },
      ...(!readOnly ? [
        { icon: ICONS.edit, ja: '右上の編集からデスク名・説明・用途を変更し、チェックで保存します。機材の追加や、このデスクから外す操作は「機材」で行えます。', en: 'Use Edit at the top right to change the name, description, and purposes, then save with the check mark. Add or remove desk items in Gear.' },
        { icon: ICONS.image, ja: '写真をタップすると拡大して見られます。写真の追加・変更はデスク詳細の写真の操作から行えます。', en: 'Tap a photo for a larger preview. Add or change photos using the photo controls in desk details.' },
      ] : []),
    ] },
    ...(!readOnly ? [{ id: 'desk-publish', ja: '公開・URL限定・共有', en: 'Publishing and sharing', items: [
      { icon: ICONS.share, ja: '公開範囲は「公開」「URL限定」から選べます。公開したデスクはみんなのデスクで見つけられ、URL限定はリンクを知っている人が開けます。', en: 'Choose Public or Unlisted visibility. Public desks can be discovered in Explore. Unlisted desks can be opened by anyone with the link.' },
      { icon: 'autorenew' as const, ja: '自分のデスクを編集した後は「公開ページを更新」で公開内容へ反映します。共有から公開デスクのリンクを渡せます。', en: 'After editing your desk, use Update public page to refresh its published version. Share provides its public link.' },
    ] }] : []),
  ]
  const wiring: HelpSection[] = [
    { id: 'wiring-view', ja: '配線図の操作', en: 'Using the wiring map', items: [
      { icon: 'gesture-pinch', ja: '図を拡大・縮小したり、背景をドラッグして移動できます。「全体」で図を画面に収められます。機材や線をタップすると詳細を確認できます。', en: 'Zoom the map and drag its background to pan. Fit shows the whole map. Tap an item or line for details.' },
      { icon: ICONS.image, ja: '写真を登録していると「写真」で表示できます。「歴史」で構成の変化を再生できます。', en: 'Photos appears when the desk has registered photos. History plays the changes in its setup.' },
      ...(!readOnly ? [{ icon: ICONS.edit, ja: '機材をタップして接続する操作を選び、相手の機材をタップすると接続を追加できます。線の詳細で接続方法や本数を変更できます。', en: 'Tap an item, choose the connection action, then tap another item to connect them. Edit connection types or cable counts in a line’s details.' }] : []),
    ] },
    { id: 'wiring-legend', ja: '線・凡例の意味', en: 'Lines and the legend', items: [
      { icon: 'vector-polyline', ja: '線の色は接続規格の違いを表します。左上の「配線」を開くと凡例が出て、種類を選ぶとその線を強調できます。', en: 'Line colors distinguish connection standards. Open Wiring at the top left for the legend, then select a standard to highlight its lines.' },
      { icon: ICONS.info, ja: 'Bluetoothや充電時のみの接続は点線で表します。図は登録した情報をもとにした構成図なので、実際の端子やつなぎ方と照らし合わせて確認できます。', en: 'Bluetooth and charge-only connections use dotted lines. The diagram uses your registered data; compare it with your actual ports and connections.' },
    ] },
  ]
  const insights: HelpSection[] = [
    { id: 'insights-history', ja: 'デスクの履歴を残す', en: 'Recording desk history', items: [
      { icon: ICONS.history, ja: '導入日・撤去日などの記録から、デスクの構成がいつ変わったかを表示します。「歴史」から各時点の配線図を再生できます。', en: 'Install and removal dates show when your desk’s setup changed. History plays the wiring map at each point.' },
      { icon: ICONS.calendar, ja: '購入日は機材を買った日、導入日はそのデスクで使い始めた日です。それぞれの記録を入力すると、購入の推移とデスクの歴史を振り返れます。', en: 'The purchase date is when you bought an item; the install date is when it entered that desk. Record both to review purchases and desk history.' },
    ] },
    { id: 'insights-amounts', ja: '構成金額・累計・台数の意味', en: 'Setup value, cumulative value, and counts', items: [
      { icon: ICONS.stats, ja: '現在の構成金額は、今このデスクにある機材の登録価格×数量の合計です。ケーブル代も含み、価格未入力のものは金額に加算しません。', en: 'Current setup value adds registered price × quantity for the items currently in this desk, including cables. Items without a price do not add to the amount.' },
      { icon: ICONS.history, ja: 'これまでの累計は、履歴に残っている機材を重複させず、登録価格×数量を合計したものです。現在構成外は、そのうち今の構成から外れた機材の金額です。', en: 'Cumulative value adds registered price × quantity for unique items retained in the desk’s history. Outside setup is the amount for those no longer in its current setup.' },
      { icon: TAB_ICONS.gadgets, ja: '台数は数量を反映し、ケーブルを除いて数えます。平均価格は、価格入力済みの機材の金額をその台数で割った値です。', en: 'Device counts include quantities and exclude cables. Average price is the amount for priced devices divided by their device count.' },
    ] },
    { id: 'insights-charts', ja: '購入の推移・分析の見方', en: 'Reading purchase trends and analysis', items: [
      { icon: ICONS.calendar, ja: '購入の推移は、購入日を入力した機材を対象に集計します。購入日未入力の機材は時期別の推移に入りません。', en: 'Purchase trends use items with purchase dates. Undated items are excluded from time-based trends.' },
      { icon: ICONS.stats, ja: '「詳しい分析」を開くと、ジャンル・価格帯・登録されている配線などの内訳を見られます。数値は入力した機材と接続情報から集計しています。', en: 'Open detailed analysis for breakdowns by category, price range, and registered wiring. Values use the gear and connections you registered.' },
    ] },
  ]
  const stats: HelpSection[] = [
    { id: 'inventory-amounts', ja: '持ち物の購入総額・点数', en: 'Inventory amounts and counts', items: [
      { icon: ICONS.stats, ja: '購入総額は持ち物全体の登録価格×数量の合計です。デスクで未使用の機材やケーブルも含み、価格未入力のものは金額に加算しません。', en: 'Total purchase amount adds registered price × quantity across your inventory, including unused items and cables. Items without a price do not add to the amount.' },
      { icon: TAB_ICONS.gadgets, ja: '総点数は数量を含めた持ち物の数です。価格未入力は、登録価格がない持ち物の点数です。', en: 'Items counts all inventory quantities. No price counts the quantities of items without a registered price.' },
    ] },
    { id: 'inventory-breakdown', ja: BRANDS_ENABLED ? 'ジャンル・ブランド・購入年' : 'ジャンル・購入年', en: BRANDS_ENABLED ? 'Categories, brands, and purchase years' : 'Categories and purchase years', items: [
      { icon: ICONS.stats, ja: 'ジャンル別に点数と登録金額を表示します。棒の長さは点数を比べる目安です。', en: 'Category breakdowns show item counts and registered amounts. Bar lengths compare counts.' },
      ...(BRANDS_ENABLED ? [{ icon: ICONS.stats, ja: 'ブランド別にも点数と金額を表示します。ブランドは登録した商品名から判定します。', en: 'Brand breakdowns also show counts and amounts. Brands are inferred from registered item names.' }] : []),
      { icon: ICONS.calendar, ja: '購入年別は購入日を入力した持ち物が対象です。日付未入力の点数は、その下に別に表示します。', en: 'Purchases by year uses items with purchase dates. Undated item counts are shown separately below.' },
    ] },
  ]
  const playback: HelpSection[] = [
    { id: 'history-playback', ja: '歴史の再生・停止・移動', en: 'Playing and navigating history', items: [
      { icon: 'gesture-tap', ja: '図の中央をタップすると再生・停止、左右をタップすると前後の時点へ移動します。長押ししている間は一時停止します。', en: 'Tap the middle of the map to play or pause, or the left and right sides to move between events. Hold to pause temporarily.' },
      { icon: ICONS.history, ja: '下の再生ボタンや進捗の操作でも、再生・停止や見たい時点への移動ができます。一時停止中は機材をタップして詳細を確認できます。', en: 'Use the bottom playback and progress controls to play, pause, or move to another point. While paused, tap an item for details.' },
      { icon: 'tune-variant', ja: '再生設定では速度や日・月・年のまとめ方を変更できます。導入日・撤去日の記録をもとに再生します。', en: 'Playback settings changes speed and grouping by day, month, or year. Playback uses recorded install and removal dates.' },
    ] },
  ]
  const sections = {
    'my-desks': desks,
    'my-page': myPage,
    inventory,
    'desk-detail': [...deskDetail, ...wiring, ...insights],
    wiring: [...wiring, ...insights],
    insights,
    'inventory-stats': stats,
    'history-playback': playback,
    all: [...desks, ...myPage, ...inventory, ...deskDetail, ...wiring, ...insights, ...stats, ...playback],
  }[context]
  return <ScreenHelpSheet visible={visible} onDismiss={onDismiss} sections={sections} initialSection={initialSection} title={context === 'all' ? { ja: 'マイデスク・機材の使い方', en: 'Using MyDesk and gear' } : undefined} />
}
