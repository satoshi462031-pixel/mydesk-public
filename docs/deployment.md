# デプロイの現状（CI / CD）

2026-09-30 時点。**push で自動デプロイされるものは無い。** CI（自動検査）はあるが、CD（自動デプロイ）は無い。

## 一覧

| 対象 | 置き場 | デプロイの方法 | 自動か | 検査（CI） |
|---|---|---|---|---|
| アプリ本体（iOS） | App Store / TestFlight | `npx eas build -p ios --profile production` → 提出 | 手動 | `.github/workflows/ci.yml`（型検査・lint・テスト） |
| アプリの JS だけの更新（OTA） | Expo Updates（channel `production`） | `eas update`。仕組みは入っている（`expo-updates`・`runtimeVersion: fingerprint`）が、運用した記録は無い | 手動 | 同上 |
| LP（`landing/`） | Vercel（`mydesk.page` は worker 経由でプロキシ） | 手元で `npm run build` → 静的書き出しを送る → 確認してから promote | 手動 | 無し（Next.js の `npm run lint` は手元のみ） |
| Worker（`worker/`） | Cloudflare（`mydesk.page`） | `npm run deploy`（`wrangler deploy`） | 手動 | `worker/.github/workflows/ci.yml`（型検査・テスト） |
| DB（`supabase/migrations`） | Supabase | `npx supabase db push` など CLI | 手動 | `audit:function-grants`に加え、`test:db`で権限・濫用防止をPGlite上で検証 |
| Edge Functions（`supabase/functions`） | Supabase | `npx supabase functions deploy <name>` | 手動 | Denoによる全入口の型検査（`typecheck:edge`） |

検査は2026-10-16更新。DB検証は本番の適用状態やSupabase全体の結合動作を保証しません。
配布前の依存関係・旧版互換・端末確認は[品質確認・リリース対応表](release/QUALITY_GATE.md)に記録します。

## なぜ今は CD を足さないか

- **LP**：Vercel は GitHub と連携していない。LP の公開デスクのページが親リポジトリの
  `src/utils/connectionMapLayout` を読み込むため、landing リポジトリ単体では Vercel 上でビルドが通らない。
  自動化するには、この依存を解く（共有コードを LP 側へ写す／親リポジトリごと Vercel でビルドする）のが先で、
  それは CI の導入とは別の設計判断になる。
- **Worker**：`wrangler deploy` は1コマンドで終わり、手で打つ負担は小さい。自動にすると Cloudflare の
  API トークンを GitHub に置くことになり、漏れたときの影響（本番の差し替え）が大きい。
- **iOS**：EAS のビルドは有料枠を消費し、提出には審査が伴う。push のたびに走らせる性質のものではない。
- **DB**：マイグレーションは取り消しにくい。自動適用にはしない（`CLAUDE.md` でも本番適用は確認を取る扱い）。

## 手で出すときの順序

2026-10-12にruntimeVersionを`fingerprint`へ変更しました。ネイティブ構成の異なる旧ビルドへ
更新を配信しないための設定で、適用には各OSの新しいネイティブビルドが必要です。
BuildとUpdateで同じネイティブ依存・設定・Firebase設定ファイルを使ってください。

アプリが新しい公開ページの表記や API に頼っている場合は、**worker / LP / DB を先に出してから** TestFlight に上げる。
逆にすると、新しいアプリが古いサーバーに当たる時間ができる。
