# 上部アイコンボタンの配置ルール

2026-10-03更新。旧版のiOSバーボタン対策を、アプリが描く共通ヘッダーへ置き換えた。

## 現在の構成

`RootNavigator` の3つのタブ内スタックは、native-stackの `header` から `AppStackHeader` を描画する。画面遷移はnative-stackが担当し、ヘッダーの背景・円・アイコンはReact NativeのViewで描く。

iOS 26のバーボタン背景に子Viewの角丸を指定しても、見える背景の形は制御できなかった。背景とアイコンの描画系を統一して、OS背景との座標差をなくした。

| 要素 | 寸法・役割 |
| --- | --- |
| `HeaderIconButton` の押下領域 | `UI_METRICS.headerSlotSize`：44 × 44 |
| 見える円 | `UI_METRICS.headerActionSize`：36 × 36、半径18 |
| 円の地 | OSバージョンによらず `colors.chip` |
| アイコン | 通常22、戻る25。円と同じ親Viewで中央寄せ |
| `HeaderButtonGroup` | 44ptスロットを6pt間隔で並べる。背景は各ボタンが描く |
| タイトル | 左右のボタン幅を実測し、大きい方の幅を両側に予約。長いタイトルは1行で省略 |
| 上の余白 | Safe Areaのtopを明示して、native-stackのヘッダー高さContextに実測高さを返す |

## 実装ルール

- ヘッダーには `HeaderIconButton` / `HeaderButtonGroup` を使う。
- `AppStackHeader` を通す。OSのバーボタン背景とアプリの円を重ねない。
- 背景の描画をOSバージョンで切り替えない。
- 44ptの押下領域があるためhitSlopを足さない。隣接ボタンの領域を重ねない。
- アイコンのwidth / height / lineHeightをsizeと同値で固定する。
- 字形補正は `iconOptics` の値をiconBoxに一度だけ適用する。`AppIcon centered` を重ねない。
- 写真で見えたずれを画面ごとのmarginやtranslateYに置き換えない。
- 動的なtitle、headerLeft、headerRight、背景色・文字色は画面のnavigation optionsから引き継ぐ。

## 検証

`npm run audit:header-buttons` は、共通ヘッダーの接続、共通ボタンの使用、円と押下領域の寸法、OS依存の背景分岐やhitSlopへの逆戻りを検査する。

ブラウザーの部品検証で、幅320 / 390 / 430、長い日英タイトル、ボタン0 / 1 / 2個、戻る、テーマ変更、ボタン消去・再表示を確認した。円36 × 36、押下領域44 × 44、タイトルの中央・ボタンとの非重複、戻る・設定・ヘルプのコールバックを確認済み。

iOS実機の描画・VoiceOver・戻るスワイプ・遷移中の表示は別途実機確認が必要。ブラウザーでの成功をiOS実機確認済みとは扱わない。

[写真の計測と設計の記録](docs/header-button-geometry-design.md)
