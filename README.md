# MyDesk

デスク環境のガジェット、価格、導入・撤去履歴を管理し、接続情報から配線図を生成・共有するExpoアプリです。公開ページ、AIコーチ、バックアップ、課金、商品リンク、UGC通報・ブロックを含みます。

## 技術構成

- アプリ: Expo SDK 54 / React Native 0.81 / React 19 / TypeScript
- ナビゲーション: React Navigation（native-stack / bottom-tabs）
- 状態・永続化: React Context、AsyncStorage、SecureStore
- バックエンド: Supabase Auth / Postgres / Storage / Edge Functions
- AIコーチ: Supabase Edge Function経由のAnthropic Messages API
- 課金: RevenueCat
- 分析: PostHog
- クラッシュ監視: Sentry
- 共有ページ・管理ダッシュボード: Cloudflare Workers / D1
- ランディングページ: Next.js / TypeScript / Tailwind CSS
- テスト: Node.js test runner、Vitest（Workers）

## 主な機能

- ガジェット登録・編集・カテゴリ別ポート構成
- デスク構成の作成、複製、削除、写真管理
- 接続可能性を考慮した配線図の自動生成と手動調整
- 導入・撤去履歴のタイムラインとアニメーション
- 公開URL、画像、ブックマーク、通報、ユーザーブロック
- AIによるデスク環境の相談
- RevenueCat連携のPro機能と利用枠管理
- ローカル／クラウドバックアップ
- 日本語・英語、ライト・ダークテーマ

## ディレクトリ

```text
src/
  components/       UI部品
  constants/        カテゴリ、ポート、プランなどの定義
  context/          認証、購読、テーマなどのアプリ状態
  hooks/            画面向けユースケース
  navigation/       ルート、タブ、画面スタック
  repositories/     商品データ取得
  screens/          画面
  services/         Supabase、分析、共有、AI、バックアップ
  store/            ローカル永続化
  utils/            配線、レイアウト、入力検証などの純粋ロジック
supabase/
  functions/        AI、Webhook、アカウント削除などのEdge Functions
  migrations/       RLS、RPC、テーブル定義
worker/             共有ページ、App Links、待機リスト、管理画面
landing/            Next.jsランディングページ
tests/              アプリの純粋ロジックテスト
```

## セットアップ

### 必要環境

- Node.js 24（CIと同じバージョン。アプリとWorkerの依存要件を満たします）
- npm
- Expo CLI / EAS CLI
- Supabase CLI（DB・Edge Functionsを扱う場合）
- Wrangler（`worker` の開発・デプロイ時）

### リポジトリの取得

`worker/` と `landing/` は別の非公開リポジトリを参照するsubmoduleです。両方へのアクセス権があるGitHubアカウントで取得します。

```bash
git clone --recurse-submodules https://github.com/satoshi462031-pixel/mydesk.git
cd mydesk
```

すでにclone済みの場合は、リポジトリのルートで次を実行します。

```bash
git submodule update --init --recursive
```

### アプリ

```powershell
npm install
npm --prefix worker install
Copy-Item .env.example .env
npm start
```

`npm run check` はWorkerのテストも実行するため、Workerの依存関係もインストールします。

実機でRevenueCatなどのネイティブモジュールを確認する場合はExpo GoではなくDevelopment Buildを使います。初回は`eas.json`の`development`プロファイルで、対象OSのビルドを作成します。

```bash
npx eas-cli login
npx eas-cli build --platform android --profile development
# iOS実機の場合は上のbuildコマンドの代わりに次を実行
npx eas-cli build --platform ios --profile development
```

ビルド完了後、EASのインストールURLを実機で開いてインストールします。iOS実機ではApple Developer Programへの登録とテスト端末の登録が必要です。端末登録はビルド時のCLIの案内に従います。

インストール後は、開発サーバーを起動して実機のDevelopment Buildから接続します。

```bash
npx expo start --dev-client
```

`npm run android` / `npm run ios` は開発サーバーを起動して対象端末へ接続するコマンドです。Development Buildの作成・インストールは行いません。ネイティブ依存関係やアプリ設定を変更した場合は、ビルドを作り直します。

### 環境変数

`EXPO_PUBLIC_*` はアプリバンドルへ含まれます。秘密値を設定してはいけません。Supabase anon key、RevenueCat public SDK key、PostHog project keyは公開クライアント識別子として扱い、権限はRLS・Webhook・サーバー側認証で制限します。

| 変数 | 用途 | 秘密 |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase URL | いいえ |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | いいえ |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat iOS SDK | いいえ |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | RevenueCat Android SDK | いいえ |
| `EXPO_PUBLIC_POSTHOG_KEY` | PostHog client key | いいえ |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry公開DSN | いいえ |
| `EXPO_PUBLIC_PASSKEY_ENABLED` | iOS・Androidパスキーの公開スイッチ。[設定手順](docs/passkeys-setup.md) | いいえ |
| `EXPO_PUBLIC_ANDROID_PUSH_ENABLED` | FCM設定後のAndroid通知の公開スイッチ。[Android設定](docs/android-setup.md) | いいえ |
| `GOOGLE_SERVICES_JSON` | AndroidのFirebase設定ファイルのパス（EASではFile型） | いいえ |
| `SUPABASE_SERVICE_ROLE_KEY` | 管理スクリプト | **はい** |
| `RAKUTEN_ACCESS_KEY` | 商品取り込みスクリプト | **はい** |

`SUPABASE_SERVICE_ROLE_KEY` などのサーバー用秘密値はモバイルコードから参照しません。本番値はCIのSecretまたは各サービスのSecret管理へ保存してください。

Edge Functionsで使う主なSecret:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`（任意。未設定時はEdge Function内の既定モデル）
- `AI_MAX_TOKENS`（任意。256〜4000、未設定時は2000）
- `SUPABASE_SERVICE_ROLE_KEY`
- `REVENUECAT_WEBHOOK_SECRET`
- `REVENUECAT_ALLOW_SANDBOX`（TestFlight・App Store審査・Sandbox購入を同じSupabaseへ反映する環境では`true`）
- `REVENUECAT_SANDBOX_USER_IDS`（任意。カンマ区切りの user_id。設定するとSandboxの権利はこの人たちだけProになる。`revenuecat-setup.md` 参照）
- `REVENUECAT_SECRET_API_KEY`（アカウント削除用）
- `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_CLIENT_ID` / `APPLE_PRIVATE_KEY`

EAS Build / Updateで使うSentry設定:

- `SENTRY_AUTH_TOKEN`（Sensitive secret、ソースマップ送信用）
- `SENTRY_ORG` / `SENTRY_PROJECT`

Cloudflare Workerで使う主なSecret:

- `POSTHOG_API_KEY`
- `DASHBOARD_TOKEN`
- `SUPABASE_ANON_KEY`
- `TURNSTILE_SECRET_KEY`
- `WAITLIST_RATE_LIMIT_SECRET`（32バイト以上のランダム値）
- `PUBLIC_API_SECRET`（匿名Data APIのWorker経由を検証するSecret）
- `PHOTO_REVOCATION_SECRET`（Workerと写真失効Edge Functionの間のSecret）

ランディングページには公開値`NEXT_PUBLIC_TURNSTILE_SITE_KEY`を設定します。
匿名API・写真失効・CSPの更新は、[WEB対策の適用手順](docs/audits/web-security-implementation-2026-10-15.md)に従ってWorker・Web・アプリ・DBをまとめて反映します。

@ID・拍手・画像予算・通報集約・閲覧の重複抑制は、[追加の濫用防止対策と切り替え手順](docs/audits/abuse-protection-implementation-2026-10-15.md)を参照してください。画像の直接保存を閉じる119は対応アプリの配布後に適用します。

値をソース、`wrangler.jsonc`、EAS設定へ直接書かず、Supabase Secretsまたは`wrangler secret put`で設定します。

## 開発コマンド

```bash
npm start                 # Expo開発サーバー
npm run web               # Web版
npm run check             # 型チェック → lint → 全テスト（push 前はこれ1本）
npm run typecheck         # アプリ本体の型チェック（npx tsc --noEmit）
npm run typecheck:edge    # Edge Functions全入口の型チェック（Deno 2.9.6が必要）
npm run lint              # ESLint
npm run test:app          # アプリのユニットテスト
npm run test:typecheck    # テストを含む型チェック
npm run test:all          # アプリ・DB・Workerの全テスト
npm run test:db           # PGlite上のDB権限・濫用防止検証（本番接続なし）
npm run bench:layout      # 配線図生成の性能計測（-- --stress で 50〜200台も）
npm audit                 # 依存関係監査
```

型チェックとlintは`App.tsx`も対象にします。DB検証の依存は`npm ci`でそろい、CIでも実行します。
Edge Functionsの型チェックはDenoの型とモジュール解決を使うため、アプリ側とは分けてCIで実行します。
端末での操作確認と配布順序は[品質確認・リリース対応表](docs/release/QUALITY_GATE.md)、
ネイティブE2Eの実行条件は[Maestroの手順](.maestro/README.md)を参照してください。

Worker:

```bash
npm --prefix worker install
npm --prefix worker run dev
npm --prefix worker test -- --run
npm --prefix worker run cf-typegen
```

Landing:

```bash
npm --prefix landing install
npm --prefix landing run dev
npm --prefix landing run lint
npm --prefix landing run build
```

## Supabase

スキーマは2段構えです。`supabase/schema.sql` が土台（`profiles` / `desks` / `desk_photos` / `devices` / `connections` と RLS・Storage Policy）、`supabase/migrations/` がその上への差分です。`migrations/001` は `desks(id)` を外部キーで参照しますが `desks` を作らないため、新しいプロジェクトでは `schema.sql` を先に適用しないと `supabase db push` が失敗します。

```
1. supabase/schema.sql を Supabase Dashboard の SQL Editor に貼って実行（初回のみ）
2. supabase db push でマイグレーションを番号順に適用
```

`schema.sql` の `CREATE POLICY` は `DROP POLICY IF EXISTS` を伴わないため、適用済みの環境に流し直すとエラーになります。`migrations/` へ番号付きで取り込まないのはこのためです。スキーマ変更は常に新しい連番のマイグレーションで行い、`schema.sql` は初期状態の記録として据え置きます。

マイグレーションは番号順に適用します。RLSを無効化した状態でクライアント公開キーを使わないでください。`SECURITY DEFINER` 関数は次を必須条件とします。

- `SET search_path = public` または空の固定search path
- `auth.uid()` による所有権検証
- `REVOKE ... FROM PUBLIC, anon, authenticated` と必要ロールへの明示的な`GRANT`
- service role専用RPCをクライアントから実行できないこと

Edge Functionsの例:

```bash
supabase db push
supabase functions deploy ai-coach
supabase functions deploy delete-account
supabase functions deploy revenuecat-webhook --no-verify-jwt
```

RevenueCat Webhookを更新するときは、`042_subscription_event_history.sql`を含むマイグレーションを先に適用します。WebhookはJWTではなく共有Secretを検証するため、`--no-verify-jwt` が必要です。Secret未設定時は関数がfail closedになります。
TestFlightとApp Store審査の購入は`SANDBOX`として届くため、本番アプリと同じSupabaseでサーバー側Pro機能まで検証する場合は`REVENUECAT_ALLOW_SANDBOX=true`を設定します。Sandbox利用者を本番データから分離する場合は、RevenueCat/Supabaseの環境を分けます。

waitlistを有効化する場合は、Turnstile widgetの許可ホストに`mydesk.page`とVercelの本番ホストを登録し、次を適用します。

```bash
npx wrangler d1 execute mydesk-waitlist --remote --file worker/schema/waitlist_003_rate_limits.sql
npx wrangler secret put TURNSTILE_SECRET_KEY --config worker/wrangler.jsonc
npx wrangler secret put WAITLIST_RATE_LIMIT_SECRET --config worker/wrangler.jsonc
```

管理画面は`/admin/login`でトークンをPOSTし、署名済みセッションCookieへ交換します。URLの`?token=`は受け付けません。

## セキュリティ設計

- セッションはiOS Keychain／Android Keystoreを使うSecureStoreへ分割保存
- OAuthとパスワード再設定はPKCEを使用
- 公開DB操作はRLS、所有権検証済みRPC、service role専用関数で分離
- AI APIキーとRevenueCat Webhook処理はクライアントへ配布しない
- 外部URLはHTTP(S)だけを許可し、ユーザー情報付きURLを拒否
- 公開メタデータはHTMLエスケープし、画像URLの保存先ホストを制限
- アカウント削除はJWTから対象ユーザーを確定し、RevenueCatの顧客削除とApple連携解除まで行う

詳細と残存リスクは[SECURITY_AUDIT.md](./SECURITY_AUDIT.md)を参照してください。

## テスト方針

純粋ロジックはNode.js test runnerで境界値と破損データを検証します。WorkerはVitestでルーティング、CORS、認証、秘密値非露出、外部API失敗を検証します。

優先して追加するテスト（優先度と状態は `docs/engineering-improvements.md` で管理する）:

1. 配線エンジンのカテゴリ・ポート組み合わせプロパティテスト
2. Supabase RLSのローカル統合テスト
3. Edge Functionsの認証、本文上限、上流タイムアウトテスト
4. React Native画面の保存・破棄・オフライン操作テスト
5. 公開ページと待機リストのE2Eテスト

## 品質の仕組み

入れた理由はどれも「壊れたものが利用者に届く前に止める」ため。道具を増やすこと自体は目的にしない。

| 仕組み | 止めるもの | 場所 |
|---|---|---|
| CI（GitHub Actions） | push / Pull Request のたびに、型・lint・テストが通らない変更。手元にだけあるファイルに頼ったコード | `.github/workflows/ci.yml`（worker は worker リポジトリの同名ファイル） |
| `npm run check` | CI と同じ3段を手元で。push 前にこれ1本 | `package.json` |
| 配線図の不変条件テスト | どんなレイアウト調整でも起きてはいけない壊れ方（線・ガジェットが消える、重なる、同じ入力で結果が変わる）。座標そのものは固定しない | `tests/mapLayoutInvariants.test.ts` |
| `LAYOUT_VERSION` の番人 | 配線図の計算を変えたのに版を上げない・オンボーディングを焼き直さない（端末に古い図が残る） | `tests/layoutVersionGuard.test.ts` |
| 性能計測 | 「速そう」で書き換えること。改善は計測 → 原因の特定 → 変更 → 再計測の順で、結果を記録する | `npm run bench:layout` / `docs/perf/layout-benchmark.md` |
| 出力の指紋 | 見た目を変えないはずの変更（高速化など）で、実は線の形が変わること | `scripts/layoutFingerprint.ts` |
| 静的監査 | デザインの約束（色・アイコン・角丸・余白など）の割れ | `npm run audit:*` |
| 改善候補ログ | 見つけた問題を捨てずに置き、優先度（Impact × Probability ÷ Cost）の順に拾う | `docs/engineering-improvements.md` |

デプロイの現状（CI はあるが CD は無い、とその理由）は `docs/deployment.md`、セキュリティ観点の監査は `SECURITY_AUDIT.md`。

## デプロイ前チェック

```bash
npm run check
npm audit
npm --prefix landing run lint
npm --prefix landing run build
npm --prefix worker run cf-typegen
```

- `.env`、`.dev.vars`、service role keyがGit管理されていない
- RevenueCat Webhook Secretと本番／Sandbox設定が正しい
- Sentry DSNとEASの`SENTRY_AUTH_TOKEN`を設定し、Release Buildのテスト例外がsymbolicateされる
- Supabase RLSとStorage Policyを本番で確認した
- Cloudflare WorkerのSecretとD1 bindingが設定済み
- EASのproduction channelとアプリバージョンを確認した
- 依存関係監査のHigh以上を評価・記録した

## ライセンス

非公開プロジェクトです。ライセンスを追加するまでは再配布・二次利用を許諾しません。
