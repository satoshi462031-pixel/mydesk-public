---
paths:
  - "src/components/**/*.tsx"
  - "src/screens/**/*.tsx"
  - "src/navigation/**/*.tsx"
  - "src/hooks/useCollapsibleHeader.ts"
  - "src/utils/collapsibleHeader.ts"
  - "src/constants/{colors,ui,icons,accentColors,iconOptics.generated}.ts"
  - "design.md"
  - "scripts/audit{Colors,Icons,Radius,Spacing,HeaderButtons,IconButtons,TextFields,CollapsibleHeader}.ts"
---

## UI の約束

- **デザインは `design.md`（実装を写した iOS 準拠のトークン表）に従う。** 色・角丸・余白を独自判断で足さない。
  色は必ず `useApp().colors` から引く。`accent` は塗り、`accentText` は中立背景の上の文字、
  `onAccent` は accent 塗りの上の文字と、役割が3つに分かれている。
  ダークモードは true black `#000000`。影は使わず境界線と背景コントラストで分ける。
- **文字の濃さはサイズではなく役割で選ぶ。** `text`＝見出し・本文・入力欄の値・
  主役の数値、`textSub`＝読ませたい補足（操作ヒント・導入文）、`textMuted`＝読み飛ばして
  よいもの（補助説明・日付・単位・見出しに付随する件数・空状態）。
  同じ行に名前と件数が並ぶときは件数を落とす。`audit:colors` はコントラストの
  下限しか見ないので、濃すぎる側は検出できない。
- **アイコンは `src/constants/icons.ts` の `ICONS` / `CATEGORY_ICONS` が正本。**
  `name="pencil-outline"` のような直書きをしない（検査は `npm run audit:icons`）。
  カテゴリの絵を重複させない。配線図と一覧タイルで別カテゴリが同じ絵になる。
- **角丸と画面の横余白は `UI_METRICS` から引く**（`audit:radius` / `audit:spacing`）。
  例外は円とアイコンの器だけで、器は「幅の約1/4」の比率で書く。詳細は design.md。
- **ヘッダーのボタンは `HeaderIconButton` / `HeaderButtonGroup`（atoms）だけを使う。**
  3つのタブ内スタックは `AppStackHeader` を `header` から描画する。OSのバーボタン背景は使わず、
  押下領域44 × 44の中に `colors.chip` の円36 × 36を描く。背景とアイコンを同じ座標系で中央に置く。
  `HeaderButtonGroup` でも背景はボタンごとに描き、隣のボタンと押下領域が重なるhitSlopは足さない。
  title・動的なボタン・配色は画面のoptionsから引き継ぐ。タイトルは左右の実測ボタン幅を予約して中央に置く。
  検査は `npm run audit:header-buttons`。OSのガラスへ戻したりOSバージョンで背景を切り替えたりしない。
- **円のアイコンボタンは `IconCircleButton`（atoms）を使う。** 押せる円にアイコン1つ、を画面ごとに
  手書きすると大きさ・地の色・押せる範囲・読み上げが割れる（検査は `npm run audit:icon-buttons`）。
  器の地は `colors.chip`（ヘッダーの円と同じ）。色見本やチェックボックスのように「円そのものが中身」の
  ものは対象外。
- **1行の入力欄は `TextField`、検索欄は `SearchField`（atoms）を使う。** 高さ・枠・角丸・内部余白・
  文字サイズは部品が持つ。画面から渡す `containerStyle` は幅・余白・配置だけにし、見た目を上書きしない
  （`audit:text-fields` が検査する）。複数行の自由記入欄だけは素の `TextInput` を使ってよい。
- **`TextInput` に `lineHeight` を直接付けない。** RN は iOS の `<Text>` では lineHeight の余りを字の上下に
  分けて中央に置くが、`<TextInput>` にはこの補正が無く、余りが全部字の上に付いて例文（placeholder）が
  下へずれる（何度も起きた）。1行の欄には付けない。複数行の欄は `multilineInputText()`
  （`src/utils/multilineInputText.ts`）を通して上下の余白で補正する。`audit:text-fields` が止める。
- **器の中に置くアイコンは中心がずれる。** MaterialCommunityIcons は字形の輪郭が em の中央に無いものがあり
  （`router-network` は 24pt で 4pt 上寄り）、flex の中央寄せだけでは円の中心から外れる。
  フォントの glyf 見出しの外接矩形は xMin / yMin が 0 で壊れているので、輪郭の点から測る
  （見出しを信じていた頃は、中央にある `pause` や `plus` を 2〜3pt 押し出していた）。
  補正値は `npm run build:icon-optics` が TTF から焼いた `src/constants/iconOptics.generated.ts`。
  `AppIcon` に `centered` を付けるか、`IconCircleButton` / `HeaderIconButton` を使えば効く
  （`CategoryIcon` は常に器の中なので既定で有効）。アイコンを足したら焼き直す。
- **上部を一覧のスクロールで畳む画面（`PublicDeskScreen` / `WiringResultScreen`）は、仕組みを
  `useCollapsibleHeader` と `CollapsibleTabContent` にだけ置く。** 画面側に上部の位置・切り取り枠・
  位置戻しを書き直さない（`audit:collapsible-header` が止める）。以前は2画面に手で書いて
  「同一に保つこと」とコメントで頼み、片方にだけ入った修正（切り取り枠・一覧末尾の余白）で
  写真が透ける・空白の帯・末尾に届かない、が画面ごとに起きた。収納は transform だけで動かし、
  高さを毎フレーム変える方式にしない（ガタつく）。判定は `utils/collapsibleHeader.ts` に置いてテストする。
  この仕組みを直したら実機で**両画面の機材・履歴タブ**について、上部から縦に動かす／一覧の末尾まで行く／
  配線タブと行き来して位置と上部が戻る／写真を拡大したままサムネで替えて左右にめくれる、を確かめる。
- **タブの初回マウントは、押されたフレームから外す。** 下線の切り替えと、そのタブの中身の
  マウントを同じコミットに乗せると、中身の初回レンダーが終わるまで下線が動かず「反応が遅い」
  になる。`setTab` は即時、マウントは `InteractionManager.runAfterInteractions` に送る。
  先例は `WiringResultScreen` / `PublicDeskScreen` / `MyPageScreen`。
  **ペインを `display: none` で出し分けている画面では、押された先（`tab`）と出しているペイン
  （`visibleTab`）を分ける。** 分けずに遅延させると、行き先が未マウントの一瞬だけ全ペインが
  隠れて画面が真っ白になる。遅延マウントはコストを消すのではなく初回表示からタブ操作へ移す
  最適化なので、移した先の応答も必ず測る（`[perf] mypage tab` が実測を出す）。

## UI を触ったときの監査

- 静的な監査は `npm run audit:colors`（コントラスト）/ `audit:icons`（アイコンの直書き）/
  `audit:radius`（角丸）/ `audit:spacing`（画面の横余白）/ `audit:header-buttons` /
  `audit:icon-buttons`（円のアイコンボタンの手書き）/
  `audit:text-fields`（1行入力欄・検索欄の手書きと見た目の上書き）/
  `audit:collapsible-header`（デスク詳細・マイデスクの上部の収納）/
  `audit:coach-targets`（「？」の説明が指す対象 ID が画面に登録されているか。`test:app` でも走る）。
  **UI を触ったら colors / icons / radius / spacing の4本**を通す。
  「？」の説明や `coachTarget` / `CoachAnchor` を触ったら `coach-targets` も通す。
  デスク詳細・マイデスク（配線図の画面）の上部・タブ・写真プレビューを触ったら `collapsible-header` も通す。
- **保存・生成・通信を待った後に画面を動かす処理を書いたら `npm run audit:nav-after-await` を通す。**
  React Navigation 6 の goBack / replace は呼んだ画面ではなく、その時点で一番上の画面に効く。
  待つ間に戻られると別の画面を閉じる・置き換える（配置の生成中に戻るとマイデスク一覧が配線図に
  置き換わって戻れなくなった）。`if (!navigation.isFocused()) return` で守る。

## 画面を直すとき

- **マイデスク（`WiringResultScreen`）を直したら、他人のデスク（`PublicDeskScreen`）にも
  同じ修正が要るかを必ず検討し、要る・要らないとその理由を報告に書く。** 2画面は同じ形
  （上部の写真・機材／配線／履歴・分析のタブ・写真プレビュー）だが実装は別々で、片方にだけ入った
  修正が何度も残っている（上部の収納・一覧の読み上げ情報）。共通部品（`ConnectionMap` /
  `PinchZoomImage` / `useCollapsibleHeader` など）の中で直したなら両方に効く。画面側で直したなら
  もう片方の同じ役割の箇所を読んで判断する。持ち主だけの機能（編集・削除・公開・つなぎ方）は対象外。
  ガジェット詳細も同じ関係（`GadgetDetailSheet` ↔ `SharedGadgetDetailModal`）。
- UI の一貫性を機械的に走査したときは、**スタイル名で役割を判断しない**。
  `title` が見出しとは限らず（折りたたみパネルのラベルだった）、`label` がフォームの
  ラベルとも限らない。候補を絞るまでは走査でよいが、直す前に必ず該当箇所の JSX を読む。
  同じ理由で「同名スタイルの値が違う」は割れとは限らない
  （`input` の paddingVertical 10/12 は枠あり・枠なしの区別で正しかった）。
