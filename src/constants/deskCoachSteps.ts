import type { CoachStep } from '../hooks/useCoachMarks'

// デスク詳細の「？」で順に指す説明。自分のデスク（WiringResultScreen）と他人のデスク
// （PublicDeskScreen）は同じ形なので、同じ部品の説明はここで1つにする（片方だけ直る、を防ぐ）。
// 番号は渡した順に振られるので、画面の上から並べる：ヘッダー → 写真とその下の段 → タブ →
// 開いているタブの中身 → 下のバー。中身を先に出していた頃は、下の部品が 1 で上の写真が後になり、
// 番号をたどると画面を上下に行き来していた。
// 画面に見えていない対象（写真の無いデスク・閲覧専用で出ないボタン）の説明は飛ばされる

/** タブの中身の枠（CollapsibleTabContent）。スクロールで枠の外へ出た行を指さないよう、ここで切る */
export const DESK_CONTENT = 'desk-content'
const inContent = (steps: CoachStep[]): CoachStep[] => steps.map((step) => ({ within: DESK_CONTENT, ...step }))
// 写真・投稿者の段は、一覧を上へ送ると上へずれてくるタブバーと中身の裏に入る
const UNDER_CONTENT = [DESK_CONTENT, 'desk-tabs']

// 並び順と追加は一覧の下（下のバーのすぐ上）に浮いているので、行の後に置く。
// 「この構成から作る」は他人のデスクだけにあり、一覧の末尾（浮いたボタンより上）に出る
export const DESK_GADGETS_COACH: CoachStep[] = inContent([
  { target: 'desk-gadget-row-edit', title: { ja: '機材の操作', en: 'Gear actions' }, emphasis: { ja: ['タップ', '長押し', '右へスワイプ', '左へスワイプ'], en: ['Tap', 'Hold', 'Swipe right', 'Swipe left'] }, pad: 0, ja: '・タップ：詳細・このデスクのおすすめを設定\n・長押しして上下へ：並び替え\n・右へスワイプ：お気に入り（マイページと共通）\n・左へスワイプ：交換・このデスクから外す', en: '• Tap: details and desk recommendations\n• Hold and drag up or down: reorder\n• Swipe right: favorite (shared with My Page)\n• Swipe left: replace or remove from this desk' },
  { target: 'desk-gadget-row', title: { ja: '機材の詳細', en: 'Gear details' }, pad: 0, ja: 'タップで機材の詳細を開きます。', en: 'Tap to open the gear details.' },
  { target: 'desk-copy', title: { ja: 'この構成から作る', en: 'Start from this setup' }, pad: 4, ja: 'このデスクのジャンルの組み合わせと配置を下敷きに、自分の機材でデスクを作れます。', en: 'Start your own desk from this one’s categories and layout, then pick your own gear.' },
  { target: 'desk-gadget-sort', title: { ja: '並び順', en: 'Sort order' }, pad: 4, ja: '機材の並び順を切り替えます。', en: 'Change the order of the gear list.' },
  { target: 'desk-gadget-add', title: { ja: '機材を追加', en: 'Add gear' }, pad: 4, ja: 'このデスクに機材を足します。ジャンルを選んで登録します。', en: 'Add gear to this desk by choosing a category.' },
])

// 図の上に浮くボタンは、上の段（左上の凡例・右上の写真）→ 下の段（左下の全体表示・右下の再生／接続の追加）
export const DESK_WIRING_COACH: CoachStep[] = inContent([
  { target: 'map', title: { ja: '配線図の操作', en: 'Map gestures' }, emphasis: { ja: ['2本指', 'ドラッグ', 'タップ'], en: ['Pinch', 'Drag', 'Tap'] }, pad: 0, ja: '・2本指で広げる：拡大\n・ドラッグ：図を動かす\n・機材や線をタップ：詳細を見る', en: '• Pinch: zoom\n• Drag: move the map\n• Tap gear or a line: see details' },
  { target: 'map-edit', title: { ja: '機材の移動・大きさ', en: 'Move and resize gear' }, pad: 0, ja: '機材を長押ししてドラッグすると移動します。右下の角をドラッグすると大きさを変えられます。指を離すと保存されます。', en: 'Hold and drag gear to move it. Drag its bottom-right corner to resize. Changes are saved when you release.' },
  { target: 'map-legend', title: { ja: '接続の種類', en: 'Connection types' }, pad: 4, ja: '線の色は接続の種類です。開くと一覧が出て、選んだ種類の線だけを強調します。点線はBluetoothや充電時だけの接続です。', en: 'Line colors show connection types. Open the list and pick one to highlight it. Dotted lines are Bluetooth or charge-only.' },
  { target: 'map-photo', title: { ja: '写真と見比べる', en: 'Compare with photos' }, pad: 4, ja: 'デスクの写真を図の上に出して、見比べられます。', en: 'Show the desk photo over the map to compare.' },
  { target: 'map-fit', title: { ja: '図の全体を表示', en: 'Fit the map' }, pad: 4, ja: '図の全体を画面に収めます。', en: 'Fit the whole map on screen.' },
  { target: 'history-play', title: { ja: 'デスクの歴史', en: 'Desk history' }, pad: 4, ja: '導入日・撤去日の記録から、デスクの移り変わりを配線図で再生します。', en: 'Replay how the desk changed, from install and removal dates.' },
  { target: 'map-add', title: { ja: '接続を追加', en: 'Add a connection' }, pad: 4, ja: 'つなぐ2台と、つなぎ方を選んで線を足します。', en: 'Pick two pieces of gear and how they connect to add a line.' },
])

export const DESK_PHOTO_COACH: CoachStep[] = [
  { target: 'desk-photo', title: { ja: '写真を見る', en: 'View photos' }, pad: 0, coveredBy: UNDER_CONTENT, ja: '写真は左右にめくれます。タップすると拡大します。', en: 'Swipe through photos. Tap one to enlarge it.' },
]

// 写真の下の段に置いた再生ボタン（自分のデスク・他人のデスク）。閲覧専用のデスクでは配線図の上にあり、DESK_WIRING_COACH 側で指す
const DESK_HISTORY_COACH: CoachStep[] = [
  { target: 'history-play', title: { ja: 'デスクの歴史', en: 'Desk history' }, pad: 4, coveredBy: UNDER_CONTENT, ja: '導入日・撤去日の記録から、デスクの移り変わりを配線図で再生します。', en: 'Replay how the desk changed, from install and removal dates.' },
]

export const DESK_TABS_COACH: CoachStep[] = [
  { target: 'desk-tabs', title: { ja: '表示を切替', en: 'Switch views' }, pad: 0, ja: '機材の一覧・配線図・履歴と分析を切り替えます。', en: 'Switch between the gear list, wiring map, and history and insights.' },
]

// 持ち主だけが使える操作。共有されたデスク（閲覧専用）では出さない
export const DESK_OWNER_TOP_COACH: CoachStep[] = [
  { target: 'desk-edit', title: { ja: 'デスクを編集', en: 'Edit this desk' }, pad: 2, header: true, ja: '名前・用途・ひとこと・写真を編集します。✓で保存します。', en: 'Edit the name, purposes, note, and photos. Save with ✓.' },
  ...DESK_PHOTO_COACH,
  ...DESK_HISTORY_COACH,
]

export const DESK_OWNER_FOOTER_COACH: CoachStep[] = [
  { target: 'desk-publish', title: { ja: '公開・更新', en: 'Publish and update' }, pad: 4, ja: '公開の状態を確かめ、公開・共有の設定を変えます。公開後に編集すると、このボタンが「公開ページを更新」に変わります。', en: 'Publishing status and settings. After you edit a published desk, this becomes Update public page.' },
  { target: 'desk-ai', title: { ja: 'AIに相談', en: 'Ask the AI coach' }, pad: 4, ja: 'このデスクについて、AIコーチに相談できます。', en: 'Ask the AI coach about this desk.' },
  { target: 'desk-share', title: { ja: 'リンクを共有', en: 'Share a link' }, pad: 4, ja: '公開ページのリンクを共有します。まだ公開していなければ、公開の手続きに進みます。', en: 'Share the public page link. If the desk is not published yet, this starts publishing.' },
]

// 他人のデスクだけにある操作
export const PUBLIC_DESK_TOP_COACH: CoachStep[] = [
  { target: 'desk-report', title: { ja: '報告・ブロック', en: 'Report and block' }, pad: 4, header: true, ja: '問題のあるデスクを報告したり、投稿者をブロックしたりできます。', en: 'Report this desk or block its author here.' },
  ...DESK_PHOTO_COACH,
  { target: 'desk-author', title: { ja: '投稿者', en: 'Author' }, pad: 4, coveredBy: UNDER_CONTENT, ja: 'タップすると投稿者のプロフィールを開きます。', en: 'Tap to open the author’s profile.' },
  { target: 'desk-follow', title: { ja: '投稿者をフォロー', en: 'Follow the author' }, pad: 4, coveredBy: UNDER_CONTENT, ja: 'フォローすると、この人のデスクの更新がベルに届きます。', en: 'Follow this author to get their desk updates under the bell.' },
  ...DESK_HISTORY_COACH,
]

export const PUBLIC_DESK_FOOTER_COACH: CoachStep[] = [
  { target: 'desk-clap', title: { ja: '拍手する', en: 'Applaud' }, pad: 4, ja: '気に入ったら拍手で伝えられます。もう一度押すと取り消せます。デスクが更新されると、また拍手できます。', en: 'Applaud to show you like this desk. Tap again to undo. You can applaud again after the desk is updated.' },
  { target: 'desk-clap-own', title: { ja: '届いた拍手', en: 'Received applause' }, pad: 4, ja: 'このデスクに届いた拍手の数です。', en: 'Applause this desk has received.' },
  { target: 'desk-save', title: { ja: 'あとで見返す', en: 'Save for later' }, emphasis: { ja: ['デスクのコピーではありません'], en: ['does not copy the desk'] }, pad: 4, ja: '保存すると、マイページの「保存」で見返せます。デスクのコピーではありません。', en: 'Save it to find it again in My Page → Saved. It does not copy the desk.' },
  { target: 'desk-ai', title: { ja: 'AIに相談', en: 'Ask the AI coach' }, pad: 4, ja: 'このデスクについて、AIコーチに相談できます。', en: 'Ask the AI coach about this desk.' },
  { target: 'desk-share', title: { ja: 'リンクを共有', en: 'Share a link' }, pad: 4, ja: 'このデスクのリンクを共有します。', en: 'Share a link to this desk.' },
]
