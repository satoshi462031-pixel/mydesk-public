import type { CoachStep } from '../hooks/useCoachMarks'

const inForm = (steps: CoachStep[]): CoachStep[] => steps.map(step => ({ within: 'gadget-form', ...step }))

export const GADGET_DETAIL_COACH: CoachStep[] = [
  ...inForm([
    { target: 'gadget-owned', title: { ja: '所有機材と候補', en: 'Owned gear or candidate' }, ja: '所有機材にすると持ち物の数と購入総額に含めます。候補のままなら含めません。所有機材として保存するには商品名が必要です。', en: 'Owned gear counts toward inventory and purchase totals; candidates do not. A product name is required to save gear as owned.' },
    { target: 'gadget-category', title: { ja: 'ジャンル', en: 'Category' }, ja: '機材の種類を選びます。ジャンルに合わせて、サイズ・端子・電源などの設定が切り替わります。', en: 'Choose the category. Available size, port, and power settings change with it.' },
    { target: 'gadget-product', title: { ja: '商品名', en: 'Product name' }, ja: '商品名を入力します。候補から選ぶと商品情報や端子を反映します。実物と違う場合は下の設定で直せます。', en: 'Enter a name or choose a suggestion to apply product details and ports. Correct anything that differs from your gear below.' },
    { target: 'gadget-specs', title: { ja: '機材ごとの設定', en: 'Gear specifications' }, ja: 'サイズ・PCの構成・ケーブルの種類や本数など、ジャンルごとの情報を設定します。', en: 'Set category-specific details such as dimensions, PC components, or cable type and count.' },
    { target: 'gadget-wiring-toggle', title: { ja: '配線の詳細を開く', en: 'Open wiring details' }, ja: 'タップで端子・接続先・給電の設定を開きます。実際の配線と図が違う場合は、ここを確認してください。', en: 'Open port, connection, and power settings here when the diagram differs from your wiring.' },
    { target: 'gadget-wiring-fields', title: { ja: '端子・接続・給電', en: 'Ports, connections, and power' }, ja: '実物に合わせて端子の数や接続方法、給電元を設定します。変更は保存後の配線図に反映されます。', en: 'Match port counts, connection methods, and power sources to your gear. Saving applies them to the map.' },
    { target: 'gadget-price', title: { ja: '購入金額', en: 'Purchase price' }, ja: '実際に払った1台あたりの金額です。複数台の場合は数量を掛けて集計します。商品の参考価格は変更できます。', en: 'Enter what you paid per unit. Totals multiply it by quantity. You can replace a suggested list price.' },
    { target: 'gadget-usage', title: { ja: '導入日・在籍履歴', en: 'Dates and desk history' }, ja: '導入日や、デスクで使い始めた日・外した日を記録します。金額の推移や歴史の再生に使います。終了日を消すと、そのデスクで使用中に戻ります。', en: 'Record when gear was added or removed. Dates drive value charts and history playback. Clearing an end date restores its use on that desk.' },
    { target: 'gadget-display-only', title: { ja: '使用中と飾り', en: 'In use or decor' }, ja: '飾りにすると、デスクには表示したまま配線の対象から外します。', en: 'Decor stays visible on the desk but is excluded from wiring.' },
    { target: 'gadget-notes', title: { ja: '機材のメモ', en: 'Gear notes' }, ja: '使い方や接続の補足を記録できます。デスクを公開すると、このメモも公開ページに表示されます。', en: 'Record usage or connection notes. These appear on the public page when the desk is published.' },
    { target: 'gadget-delete', title: { ja: '機材を削除', en: 'Delete gear' }, ja: '持ち物とデスクの在籍履歴から削除します。使わなくなっただけなら、持ち物一覧で撤去や処分を選んでください。', en: 'Delete the gear and its desk history. If you only stopped using it, use Retire or Dispose in your inventory.' },
  ]),
  { target: 'gadget-save', title: { ja: '変更を保存', en: 'Save changes' }, ja: 'この画面の変更をまとめて保存します。戻るだけでは確定しません。', en: 'Save all changes from this screen. Going back alone does not apply them.' },
]

export const CONNECTION_METHOD_COACH: CoachStep[] = [
  { target: 'connection-summary', title: { ja: 'ケーブルの記録', en: 'Cable records' }, ja: '物理ケーブル1本ごとに、何でつないでいるかを記録します。Bluetoothなどケーブル不要の接続は表示しません。', en: 'Record the cable used for each physical link. Wireless links that need no cable are omitted.' },
  { target: 'connection-row', title: { ja: '接続先と種類', en: 'Endpoints and cable type' }, ja: '接続する機材とケーブルの種類・本数を確認できます。枝分かれする1本のケーブルは、接続先をまとめて表示します。', en: 'See connected gear, cable type, and count. A branching cable groups its destinations in one row.' },
  { target: 'connection-included', title: { ja: '本体付属を記録', en: 'Record an included cable' }, ja: '機材に付属したケーブルを使うときに選びます。もう一度押すと解除します。変更はその場で保存され、公開デスクにも表示されます。', en: 'Select this for the cable included with a device. Tap again to clear it. Changes save immediately and appear on the public desk.' },
  { target: 'connection-clear', title: { ja: 'ケーブルの指定を解除', en: 'Clear the cable choice' }, ja: '登録されたケーブル名を押すと、その指定を外します。接続の線そのものは削除しません。変更はその場で保存されます。', en: 'Tap the assigned cable name to clear the choice. The connection remains. Changes save immediately.' },
]

// 機材追加。デスク・マイページの「追加」からはジャンルの格子だけが出て、選ぶと機材詳細の入力へ進む。
// 自作ジャンルの長押しと「詳細・専門機器」への出し入れは、画面に印が無い
export const ADD_GADGET_COACH: CoachStep[] = [
  { target: 'add-gadget-start', title: { ja: '機材を登録', en: 'Add gear' }, pad: 4, ja: '押すと機材の入力画面に進みます。商品名や端子はそこで入力します。', en: 'Opens the gear form, where you enter the product name and ports.' },
  { target: 'category-tile', title: { ja: 'ジャンルを選ぶ', en: 'Choose a category' }, pad: 0, ja: 'タップすると、そのジャンルの機材の入力画面に進みます。商品名や端子はそこで入力します。', en: 'Tap to open the gear form for that category, where you enter the product name and ports.' },
  { target: 'category-custom', title: { ja: '自分で作ったジャンル', en: 'Your categories' }, emphasis: { ja: ['タップ', '長押し'], en: ['Tap', 'Hold'] }, pad: 0, ja: '・タップ：このジャンルで登録\n・長押し：名前・アイコン・色を直す', en: '• Tap: add gear in this category\n• Hold: edit its name, icon, and color' },
  { target: 'category-create', title: { ja: 'ジャンルを作る', en: 'New category' }, pad: 0, ja: '一覧に無い種類の機材は、ジャンルを自分で作って登録できます。', en: 'Create your own category for gear that is not in the list.' },
  { target: 'category-advanced', title: { ja: '詳細・専門機器', en: 'Advanced / Specialized' }, pad: 2, ja: 'あまり使わないジャンルはここに畳んであります。タップで開きます。', en: 'Less common categories are folded here. Tap to open them.' },
  { target: 'category-edit', title: { ja: 'ジャンルの振り分け', en: 'Arrange categories' }, pad: 4, ja: '押してからジャンルをタップすると、「詳細・専門機器」の枠へ出し入れできます。振り分けはこの端末に保存されます。', en: 'Tap this, then tap categories to move them in or out of Advanced / Specialized. The arrangement is saved on this device.' },
  { target: 'add-gadget-added', title: { ja: '登録した機材', en: 'Added gear' }, pad: 0, ja: '直前に登録した機材です。「詳細」で入力画面をもう一度開けます。', en: 'The gear you just added. Use Details to open its form again.' },
  { target: 'add-gadget-done', title: { ja: '登録を終える', en: 'Finish' }, pad: 0, ja: '登録を終えて戻ります。デスクを決めずに開いたときは、追加先のデスクを選べます。続けて登録するなら、戻らずにジャンルを選びます。', en: 'Finish and go back. If you opened this without a desk, you can choose where to add the gear. To add more, pick another category instead.' },
]

// 枠の行は下に重ねた保存の帯の裏へ流れるので、帯に隠れた行は指さない
const aboveSave = (steps: CoachStep[]): CoachStep[] => steps.map(step => ({ coveredBy: ['product-fill-save'], ...step }))

export const PRODUCT_FILL_COACH: CoachStep[] = [
  ...aboveSave([
    { target: 'product-fill-slot', title: { ja: '商品名を入れる枠', en: 'Product slots' }, pad: 0, ja: 'デスクに置いた機材の枠です。商品名を入力し、候補から選ぶと端子などの情報も配線図に反映します。', en: 'Each slot is gear placed on the desk. Enter its product name; choosing a suggestion also applies its ports to the map.' },
    { target: 'product-fill-remove', title: { ja: '持っていない', en: 'Don’t own' }, pad: 4, ja: '持っていない物の枠を、確認なしにこのデスクから外します。公開には、すべての枠を埋めるか外す必要があります。', en: 'Removes the slot from this desk right away, without asking. To publish, fill or remove every slot.' },
  ]),
  { target: 'product-fill-save', title: { ja: '保存', en: 'Save' }, pad: 0, ja: '入力した枠だけを保存します。空欄の枠は枠のまま残ります。保存前の入力は、次に開いたときも残っています。', en: 'Saves only the slots you filled; empty ones stay as slots. Unsaved entries are kept for next time.' },
]
