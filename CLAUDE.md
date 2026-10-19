# MyDesk

デスク環境を写真と機材リストで**共有する**（デスクツアーを載せる・人のデスクを見る）React Native アプリ。
**配線図の自動生成は、そこに付け加えた「他のデスク共有にない特徴」であって主役ではない。**
コードの大半は配線ドメインだが、それは難しいからで、製品の軸は共有にある。ストア文言・LP・告知・
画面の導線を考えるときは「配線管理アプリ」の書き方にしない（一度それで掲載文の案を丸ごと外した）。
**同じ場面で、オフィス・座席・席の予約・フリーアドレス・法人向け・社員の語も使わない**
（ストアの予約注文＝事前予約の意味の「予約」は別物で、使ってよい）。
「マイデスク」は座席予約システムの登録商標（6938866・第9/35/42類）と読みが重なり、改名せずに出す根拠は
「個人向けのデスク共有で、分野が違う」ことだけ。そちらへ寄る言葉が入ると根拠が崩れる
（経緯は `docs/release/NAME_TRADEMARK_RECORD.md`）。
App Store 未リリース・提出日は未定（Android は初回リリースでは出さない）。

## リポジトリ構成（デプロイ先が3つある）

| ディレクトリ | 中身 | デプロイ先 |
|---|---|---|
| `/`（ルート）+ `src/` | Expo / React Native アプリ本体 | EAS → App Store |
| `landing/` | Next.js 製 LP | Vercel |
| `worker/` | Cloudflare Worker（`mydesk.page`） | Cloudflare |
| `supabase/` | マイグレーション・Edge Functions | Supabase |

`worker` が `mydesk.page` のカスタムドメインを受け、LP は Vercel から**プロキシして配信**している
（`worker/src/index.ts` の `LANDING_PAGE_URL`）。LP の URL を直接変えないこと。
共有リンク `/d/:id`・`/setup`・`/desk` は App Links / Universal Links として `app.json` にも登録済みで、
worker 側とペアで動く。片方だけ変えると共有リンクが壊れる。

## コマンド

```
npx tsc --noEmit          # ★変更後は必ずこれを通す（strict + noUnusedLocals + noUnusedParameters）
npm run test:all          # ★app（node:test）+ worker（vitest）。配線を触ったら必ず
npm run check             # typecheck → lint → test:all を順に。push 前にこれ1本でよい（CI も同じ3段）
npm start                 # Expo Dev Server
npm run start:tunnel      # 実機確認。Expo公式 --tunnel は ERR_NGROK_108 で死ぬので cloudflared 経由
npx eas build -p ios --profile production
npm run feedback:pull     # アプリ内フィードバックを .feedback/ の台帳に取り込む
```

- フィードバックの振り分け・対応済みにする・リリース時の「新機能」の下書きは `/feedback`
  （`.claude/commands/feedback.md`）の手順で行う。状態は `.feedback/ledger.json` にだけ持つ。

- `worker/`：`npm run dev` / `npm run deploy` / `npm test`（vitest）／バインディング変更後は `npx wrangler types`
- `landing/`：`npm run dev` / `npm run build` / `npm run lint`
- **テストは `tests/` にある**（node:test）。`npm run test:app` で実行、
  `npm run test:typecheck` は `tests/tsconfig.json` の include に載せたファイルだけを見る
  （新しい util をテストするときは include に足す）。
- 検証の順は **`npx tsc --noEmit` → `npm run test:all` → `scripts/audit*` → 実機確認**。
  UI の見た目だけは実機でしか確かめられない（Web はレイアウトが崩れ、Alert が no-op）。
- 静的な監査（`npm run audit:*`）のうち、UI・配線・マイグレーションで通すものは下の分野別の決まりに書いてある。

## 分野別の決まり（`.claude/rules/`。該当するファイルを読んだときだけ読み込まれる）

| ファイル | 対象 | 中身 |
|---|---|---|
| `.claude/rules/ui.md` | `src/components`・`src/screens`・`src/navigation`・色や UI の定数・`design.md` | 色・アイコン・ボタン・入力欄・上部の収納・タブの約束、UI の監査、マイデスク ↔ 公開デスクの修正の突き合わせ |
| `.claude/rules/wiring.md` | 配線エンジン・配線図の配置と描画・履歴アニメ・デモデスク | 3層の切り分け、`LAYOUT_VERSION`・オンボーディングの焼き直しなど配線を触るときの必須事項 |
| `.claude/rules/supabase.md` | `supabase/` | マイグレーションの決まり・関数の実行権限の監査 |

UI・配線・マイグレーションの作業を、対象のファイルを読まずに進めない（読まないと決まりが読み込まれない）。

## 画面の名前（UI 表記 ↔ 実装）

ユーザーは UI に出ている日本語で話す。実装名と一致していないので、ここで引く。

| UI（ja） | UI（en） | 実装 |
|---|---|---|
| マイデスク | MyDesk | `PlanListScreen`（タブ）/ `WiringResultScreen`（同じ表題） |
| みんなのデスク | Explore | `DeskFeedScreen` |
| マイページ | — | `MyPageScreen`（プロフィール＋4タブ） |
| マイガジェット | — | `GadgetLibraryScreen`（MyPage のタブに埋め込み。単独ルートではない） |
| 統計 | Stats | `GadgetStatsScreen`（MyPageStack） |
| 更新（ベル） | Updates | `DeskUpdatesScreen`（FeedStack） |
| 公開デスク（他人の） | — | `PublicDeskScreen`（Root） |
| 配線図 | — | `WiringResultScreen` |

**`plan` はコード上の「デスク」の旧称。** `usePlans` / `planStore` / `PlanList` は
すべてデスクを指す。課金プランではない（そちらは `useEntitlement`）。
**`like` はコード上の「拍手」の旧称。** `likes` テーブル・`like_count`・`setDeskLiked`・計測の `like_toggled` は
すべて拍手を指す（095 で改名したが、導入前後の計測を1本につなぐため内部名は変えていない）。
拍手はデスクの版（`desks.clap_round_at`）ごとに送れる。仕様は `docs/like-feature-spec.md`。

## 実装の約束

- **コメントは日本語で「なぜ」を書く。** 既存コードがその流儀で書かれている。何をしているかの
  説明コメントは不要。
- ja / en の二言語対応。配線系の関数は `lang: 'ja' | 'en'` を引数で受け取る。
  表示名は `src/utils/localizedGadgetName.ts` を通す。
- コンポーネントは atoms / molecules / organisms。データ取得は `repositories/`、
  副作用付きの処理は `services/`、状態は `context/` と `store/`。

## 環境変数・秘密情報

- `EXPO_PUBLIC_*` は**アプリにバンドルされる**。`SUPABASE_SERVICE_ROLE_KEY` や
  `RAKUTEN_ACCESS_KEY` に絶対に付けない（手元スクリプト専用）。詳細は `.env.example` のコメント。
- worker の秘密は `wrangler secret put`。未設定なら `/admin` は 503 を返す設計。
- 課金は RevenueCat（`revenuecat-setup.md`）、計測は PostHog。

## 参照ドキュメント（ルート直下）

`design.md`（UI規約）/ `cables.md`（ケーブル仕様）/ `desk-tour-wiring-audit.md`（実例による配線検証）/
`revenuecat-setup.md`（課金）/ `appstore-submission.md`（審査提出）

## 提案するとき・直すとき

- 設計・UI・導線の相談では、言われた案をそのまま実装しない。
  「その案」「別の発想の案」「そもそもやらない案」を比較してから推奨を出す。
- ユーザーの「〜かも」は確定ではなく**検討依頼**として扱う。
- ただしバグ修正・明らかな不具合・「直して」と言われた作業では案を並べない。
  原因を特定して直す。判断が要るのは修正方針が2つ以上あるときだけ。
- バグを直したら、同じ原因が他の画面・他のデータ型・他のポート種別にも
  ないかを検索してから報告する。1箇所だけ直して報告しない。
## 作業の締め

- 作業を終えたら確認を取らずに `git push`（アプリ・landing・worker）と worker / landing のデプロイまで行う。
  landing の送り方は決まった手順でしか通らない（誤ると本番が 404 になった）。
  Supabase マイグレーションの本番適用と force push は対象外で、確認を取る。

## やらないこと

- 頼まれていないリファクタ・抽象化の追加
- `landing/out`・`landing/dist`・`dist/` などビルド生成物の手編集
- Supabase マイグレーションの既存ファイル書き換え（新しい連番で追加する）
- **EAS ビルドは指示があるまで実行しない。「走らせますか」と提案することもしない**
