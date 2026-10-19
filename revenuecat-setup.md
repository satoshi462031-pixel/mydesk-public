# RevenueCat 導入手順（MyDesk）

**iOS は 2026-08-14 に構築・実機検証まで完了済み。** この文書は実際に通った手順の記録であり、
Android を追加するときの手順書でもある。Android 未着手の箇所は「未実施」と明記している。

## 固定値

| 項目 | 値 |
|---|---|
| RevenueCat Project | `a26d2638` (https://app.revenuecat.com/projects/a26d2638/overview) |
| Bundle ID / package | `com.ash462031.mydesk`（iOS/Android 共通） |
| Entitlement | `pro`（コードと Webhook が直書き。**変更不可**） |
| Offering | `default`（プロジェクト作成時に自動生成されたものを流用） |
| Supabase project ref | `zewoyfbbhchvbmrzlosj` |
| 商品ID | `com.ash462031.mydesk.pro.monthly` / `com.ash462031.mydesk.pro.yearly` |
| 価格 | 月額 ¥590 / 年額 ¥5,900（月あたり ¥492・約17%off） |
| 無料トライアル | **なし**（後述の判断を参照） |

Paywall は自前実装。`react-native-purchases-ui`（ノーコード Paywall）は使わない。
Lifetime プランは作らない（Paywall UI が月額/年額の2タブ固定）。

### 無料トライアルを設けていない理由

年額は「月額を選ばせるための比較対象（アンカー）」として置いている。
トライアルという最も強い誘因を、買わせたい側ではない年額に付けるのは目的と矛盾するため、
一度作った導入オファー（1週間無料）を削除した。アプリ側の文言も削除済み。

復活させたくなったら:
1. App Store Connect の年額 → サブスクリプション価格 → 導入オファーを追加
2. [plans.ts](src/constants/plans.ts) の年額に `trialJa: '7日間の無料体験つき'` / `trialEn: '7-day free trial'` を戻す

これだけで Paywall のボタン・タブのバッジ・比較カードの3箇所が同時に復活する（すべて `trialJa` の有無で分岐）。
**片方だけ変えると表示と実態がズレて審査対象になる。必ず両方揃える。**

---

## 1. ストアに商品を登録する

RevenueCat は商品を作れない。**必ずストア側が先**。

### 1-1. App Store Connect（完了済み）

> UI の名称は改定されることがある。見つからない場合は1階層上のメニューを探す。

#### (0) 有料App契約を確認する ← 最初にやる

Apple Developer Program（年会費）への加入とは**別の契約**。これが有効でないと、
商品を作っても永遠に「準備完了」にならず、Sandbox 購入も失敗する。

App Store Connect → **ビジネス**（旧「契約/税金/口座情報」）→ **有料App**（Paid Apps）で
ステータスが **有効** であることを確認する。未完なら「契約に同意」「銀行口座」「納税フォーム」の3つを埋める。
反映に1〜2営業日かかることがある。

**ここが未完のまま先に進むと、後の工程が全部「原因不明で動かない」に化ける。**

#### (1) サブスクリプショングループ

アプリを選択 → 左メニュー **収益化** → **サブスクリプション** → グループを作成。

- 参照名: `MyDesk Pro`
- グループID: `22297029`
- ローカリゼーション（**必須**。空だと提出できない）:
  | 言語 | グループ表示名 | アプリ表示オプション |
  |---|---|---|
  | 日本語 | `MyDesk Pro` | アプリ名を使用 |
  | 英語（米国） | `MyDesk Pro` | アプリ名を使用 |

**月額と年額は必ずこの1グループに入れる。** 別グループにすると「両方契約中」が発生して二重課金になる。

#### (2) サブスクリプション2件

| レベル | 参照名 | 製品ID | 期間 | 価格 |
|---|---|---|---|---|
| 1 | `MyDesk Pro Annual` | `com.ash462031.mydesk.pro.yearly` | 1年 | ¥5,900 |
| 1 | `MyDesk Pro Monthly` | `com.ash462031.mydesk.pro.monthly` | 1ヶ月 | ¥590 |

**製品IDは作成後に変更できず、削除しても同じIDを再利用できない。** タイプミスに注意。

**レベルは両方とも 1（同一レベル）**。App Store Connect のレベル編集UIは、行を縦にドラッグしても
番号が分かれずに同一レベルへ吸い込まれることがある。分離できなくても実害は小さいので深追いしない:

| 構成 | 月額→年額の切替 |
|---|---|
| 同一レベル（現状） | クロスグレード＝次の更新日に切替。重複課金なし |
| 年額が上位レベル（理想） | 即時アップグレード＋日割り返金 |
| 月額が上位レベル | 年額への変更がダウングレード扱い。**最も不自然なので避ける** |

各サブスクのローカリゼーション（日英とも必須。説明は**45文字以内**）:

| 商品 | 言語 | 表示名 | 説明 |
|---|---|---|---|
| 月額 | 日本語 | `MyDesk Pro（月額）` | `デスク無制限・AIコーチ・デスク履歴無制限が使えます` |
| 月額 | 英語 | `MyDesk Pro Monthly` | `Unlimited desks, AI coach, and full history.` |
| 年額 | 日本語 | `MyDesk Pro（年額）` | `年額プラン。月額より約17%お得です` |
| 年額 | 英語 | `MyDesk Pro Yearly` | `Yearly plan. Save about 17% vs monthly.` |

**ファミリー共有はオフ**。オンにすると1契約で最大6人が Pro になり、収益が最大1/6になる。

#### (3) 価格と通貨について

日本を基準に設定すると、他174地域は自動換算される。ユーザーには**各自のストアフロントの通貨**で表示される
（日本のテスターには ¥590、米国ユーザーには $ 建て）。RevenueCat ダッシュボードが米ドル表示なのは集計の都合。

アプリ側は [usePlanPricing.ts](src/hooks/usePlanPricing.ts) が `product.priceString`（ストアが返す現地通貨）を
優先し、取得失敗時だけ [plans.ts](src/constants/plans.ts) の固定値へフォールバックする。
**`subJa` / `subEn`（「月あたり ¥492（2ヶ月分お得）」など）はストア価格で上書きされない固定テキスト**なので、
価格を変えたら必ずここも直す。

#### (4) 審査用スクリーンショット（必須）

各サブスクの「審査に関する情報 → スクリーンショット」に1枚ずつ。**Paywall 画面**を撮る
（設定画面のプランモーダルではなく、その先の購入画面）。

**価格・購入ボタン・購入復元・自動更新の説明・利用規約/プライバシーポリシーのリンクが
1枚に収まるようにスクロール位置を調整する。** これらはガイドライン 3.1.2 の開示要件そのもので、
写っていれば審査員が確認しやすい。

- Monthly には「Pro 月額」タブの画像
- Annual には「Pro 年間」タブの画像

#### (5) 提出

サブスクは**初回だけアプリのバージョンと一緒に審査**される。
アプリのバージョン画面の「App内課金」セクションで2件を**添付**してから提出する。
添付を忘れると審査対象にならず、アプリだけ通ってサブスクが取り残される。

2回目以降（価格変更など）はアプリと独立して審査される。

なお **審査提出前でも Sandbox テストはできる**（ステータス「提出準備中」で商品は取得できる）。
順序は「商品作成 → RevenueCat 接続 → ビルド → Sandbox 購入 → スクショ → 提出」でよい。

### 1-2. Google Play Console（未実施）

iOS のみで先行ローンチしたため未着手。Android を追加するときは:

1. アプリを**内部テストトラックに1度アップロード**する（署名済み AAB）。これをやらないと定期購入を作れない
2. 収益化 → 定期購入 → 作成
   | 商品ID（サブスクID） | 基本プランID | 期間 |
   |---|---|---|
   | `com.ash462031.mydesk.pro.monthly` | `monthly` | P1M |
   | `com.ash462031.mydesk.pro.yearly` | `yearly` | P1Y |
3. 基本プランを**「有効」にする**（作っただけでは配信されない）
4. `.env` と EAS に `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` を追加（現在は空。空のままなら
   [SubscriptionContext](src/context/SubscriptionContext.tsx) が何もせず free で抜けるので iOS には影響しない）

> Android の商品識別子は SDK 上では `com.ash462031.mydesk.pro.monthly:monthly` のように
> `サブスクID:基本プランID` で返り、`.env` の商品IDと完全一致しない。
> [src/utils/purchasePackages.ts](src/utils/purchasePackages.ts) が `:` の手前だけを比較しているので、
> `.env` には**サブスクIDだけ**を入れれば良い。この対処が無いと Android で購入が一切通らない。

---

## 2. RevenueCat ダッシュボード

### 2-1. Apps を接続

**iOS**（Project settings → Apps → + New → App Store）

| 項目 | 値 |
|---|---|
| App name | `MyDesk` |
| Bundle ID | `com.ash462031.mydesk` |
| Custom URL Scheme | `mydesk`（入力できなくても問題ない。ノーコード Paywall 用） |
| **In-app purchase key (P8)** | **必須**（下記） |
| App-specific shared secret | 空でよい（Legacy 扱いになった） |

**P8 キーの取得は間違えやすい。** App Store Connect → **ユーザーとアクセス** → **統合** →
**「App内課金」**タブ → 「アプリ内購入キーを生成」。

- 同じ画面の「App Store Connect API」タブは**別物**。そちらで作ると `AuthKey_XXXX.p8` が
  ダウンロードされ、RevenueCat が要求する `SubscriptionKey_XXXX.p8` と種類が違って弾かれる
- ダウンロードは**一度きり**。紛失したら作り直し（10個まで作成可）
- **`react-native-purchases` 10.x は StoreKit 2 を使うため、このキーが無いと購入が記録されず、
  課金したのに Pro にならない**

**Android**（未実施）
- Package: `com.ash462031.mydesk`
- Service Account credentials JSON: Google Cloud でサービスアカウント作成 → JSON鍵 →
  Play Console のユーザーと権限で「財務データの閲覧」「注文と定期購入の管理」を付与 → RevenueCat にアップロード
- **権限が Play 側に反映されるまで最大36時間**かかることがある。早めに着手する

### 2-2. Products

Products → 対象アプリの「Add products」→ 手入力（App Store Connect API キーを繋いでいないとインポートは使えない）。

| Identifier | Display name | Type |
|---|---|---|
| `com.ash462031.mydesk.pro.monthly` | `Pro Monthly` | Subscription |
| `com.ash462031.mydesk.pro.yearly` | `Pro Yearly` | Subscription |

**Store Status が `Could not check` でも正常**。商品を審査に出すまで RevenueCat から状態を照会できないだけで、
Sandbox では問題なく取得できる。

### 2-3. Entitlements

プロジェクト作成時から `pro` が存在している（Test Store の商品が2件ぶら下がっている）。
**これに App Store の2商品を Attach する**。計4件になれば正しい。Test Store の2件は残してよい。

> `pro` 以外にすると [SubscriptionContext.tsx](src/context/SubscriptionContext.tsx) の `RC_ENTITLEMENT_PRO` と
> [revenuecat-webhook/index.ts](supabase/functions/revenuecat-webhook/index.ts) の `ENTITLEMENT_PRO` の両方が空振りし、
> **課金が通っているのに free のまま**という最もデバッグしづらい壊れ方をする。

### 2-4. Offerings

**Entitlements と Offerings は別メニュー。** 名前も似ていて画面構成もそっくりなので取り違えやすい。
判別は **REST API Identifier の接頭辞** — `entl...` なら Entitlement、`ofrng...` なら Offering。

`default`（`ofrng...`）はプロジェクト作成時に自動生成されていて、`$rc_monthly` / `$rc_annual` の
2パッケージに Test Store の商品が入っている。**新規作成しようとすると "already exists" で弾かれる**ので、
既存のものを Actions → Edit で編集する。

| パッケージ | Description | MyDesk に紐付ける商品 |
|---|---|---|
| `$rc_monthly` (Monthly) | `Monthly` | `Pro Monthly` |
| `$rc_annual` (Annual) | `Annual` | `Pro Yearly` |

Test Store 側は `No product` のままでよい。

**編集後は必ず保存する。** 商品を選んだだけで離脱すると反映されず、アプリ側は
`There is an issue with your configuration ... there are no App Store products registered` で購入不能になる。
一覧に戻ったとき各パッケージに `Pro Monthly` / `Pro Yearly` が表示されていれば成功。

**パッケージ識別子は標準の `$rc_monthly` / `$rc_annual` を使う。** カスタム文字列にすると `packageType` が
`CUSTOM` になり、[purchasePackages.ts](src/utils/purchasePackages.ts) の「商品IDで引けなければ
packageType で引き直す」フォールバックが効かなくなる。

Offering が **Current** になっていることも確認する（アプリは `offerings.current` しか見ない。
identifier の文字列自体は参照していないので名前は何でもよい）。

---

## 3. Supabase Webhook

課金状態の**正本は `profiles.tier`**。クライアントの CustomerInfo は端末ローカルの状態でしかなく、
AI 利用枠のようにサーバーが判断する機能は `profiles.tier` を見る（[useAIUsageLimit](src/hooks/useAIUsageLimit.ts)）。
これを書き換えられるのは Webhook だけなので、**必ず設定する**。

```bash
# マイグレーション（019 / 023）が未適用なら先に流す
npx supabase db push

npx supabase secrets set REVENUECAT_WEBHOOK_SECRET='<長いランダム文字列>'
# Webhook はイベントを合図にして、REST API で今の権利を取り直す（delete-account と同じ v1 のシークレットキー）。
# 未設定だと全イベントが 500 になる
npx supabase secrets set REVENUECAT_SECRET_API_KEY='sk_...'
npx supabase functions deploy revenuecat-webhook --no-verify-jwt
# Webhook の遅れ・不達と、イベントの出ない復元を、アプリから取り直させる口。JWT の検証は既定のまま
npx supabase functions deploy sync-subscription
```

`sync-subscription` はアプリが「RevenueCat では Pro なのにサーバーが Free」に気づいたとき
（購入・復元の 4.5 秒後、起動時の食い違い、AI コーチの「購入を反映しています」）に呼ぶ。
Webhook と同じ `fetchProState`（Sandbox の許可リストも同じ）で今の権利を取り、DB と違うときだけ
書き直して `subscription_events` に `APP_SYNC` として残す。管理画面の「アプリからの取り直し」が
購入の数に比べて多ければ、Webhook が届いていない。

tier はイベントの種類からは決めない。支払いの猶予期間中は `BILLING_ISSUE` と `CANCELLATION` が
届くが権利は続いており、Android の一時停止も期間の終わりまでは使える。イベントだけで判断すると
これらを free に落とすので、`GET /v1/subscribers/{id}` の `entitlements.pro`（猶予の期限を含む）を正本にしている。

### 購読の移し替え（TRANSFER）と AI の利用回数

購入の復元で購読が別のアカウントへ移ると、RevenueCat は `TRANSFER` を送り、Webhook が移行元の
Pro を外して移行先に付ける（どちらへ移すかはダッシュボードの Restore behavior の設定で決まる。
既定は新しいアカウントへ移す）。AI の回数・写真の回数・トークン予算は利用者×週で数えているので、
移し先が今週の枠をまっさらから使えると、1つの購読をアカウントの間で行き来させるだけで枠を
アカウントの数だけ使える。

そのため `TRANSFER` のとき、Webhook が移行元の今週の消費を移行先へ足す
（119 `carry_ai_usage_on_transfer`。イベントごとに一度だけ適用し、記録は `ai_usage_transfers`）。
枠はアカウントではなく購読についていく。残る抜け道は次の2つで、どちらも枠を増やすには
大きな手間がかかる。

- 移行元のアカウントを削除してから移す（移行元の顧客 ID が引けないので持ち越せない）。
  削除するとデスクも消えるので、毎週の手口にはならない
- Webhook が届く前に、アプリの取り直し（`sync-subscription`）で先に Pro になった移行先で使った分。
  届いた時点で足し合わせるので、その週の残りは止まる

ダッシュボードの Restore behavior を「Transfer if there are no active subscriptions」にすれば、
有効な購読がある間は移せなくなり、この手口自体が起きない。ただしアカウントを作り直した人が
購読を引き継げなくなるので、今は既定のまま、回数の持ち越しで対処している。

`--no-verify-jwt` は必須。RevenueCat は Authorization ヘッダに JWT ではなく固定文字列を入れて送るため、
Supabase の JWT 検証を通すと全リクエストが 401 になる。代わりに関数内で共有シークレットを検証している。

`Docker is not running` の警告は無視してよい（バンドル不要でアップロードされる）。

RevenueCat 側（Integrations → Webhooks → + New）:

| 項目 | 値 |
|---|---|
| Webhook name | `Supabase profiles.tier` |
| Webhook URL | `https://zewoyfbbhchvbmrzlosj.supabase.co/functions/v1/revenuecat-webhook` |
| Authorization header value | `secrets set` した文字列と**完全一致**（`Bearer ` は付けない） |
| Environment | **Both**（Production + Sandbox） |
| App / Event type | All |
| Paywall events | **オフ**（自前 Paywall なので発生しない） |

### 疎通確認

ダッシュボードの「Send test event」は結果が表示されないことがある。curl で直接叩くほうが確実:

```bash
# 200 + {"ok":true,"ignored":"event_type"} が返れば正常
curl -s -w "\nHTTP %{http_code}\n" -X POST \
  "https://zewoyfbbhchvbmrzlosj.supabase.co/functions/v1/revenuecat-webhook" \
  -H "Authorization: <シークレット>" -H "Content-Type: application/json" \
  -d '{"event":{"type":"TEST"}}'

# 誤ったシークレットで 401 になることも確認しておく
```

`supabase functions logs` は CLI 2.109 には存在しない。ログはダッシュボードで見る:
https://supabase.com/dashboard/project/zewoyfbbhchvbmrzlosj/functions

### Sandbox 購入を tier に反映させる（本番でも `true` のまま）

```bash
npx supabase secrets set REVENUECAT_ALLOW_SANDBOX=true
npx supabase functions deploy revenuecat-webhook --no-verify-jwt
```

**リリース後も消さない。** App Store の審査員の購入は Sandbox 環境で行われる。未設定だと
Sandbox イベントは `{"ok":true,"ignored":"sandbox"}` で弾かれ、審査員が Pro を買っても
サーバー判定の機能（AIコーチ）が「Proプラン限定」のまま解放されず、審査で落ちる。
Sandbox の購入ができるのは TestFlight・審査・開発ビルドだけで、ストア版の購入は
すべて Production 環境になるので、本番の tier が一般ユーザーの Sandbox 購入で書き換わることは無い。
（2026-08-31 時点で `true` が設定されている）

**TestFlight の購読は無料。** `true` のままだと、TestFlight を入れた人は誰でも本番の Pro（AIコーチの費用）になる。
絞るときは Sandbox の権利を数えるアカウントを列挙する（2026-10-11 の監査で追加）:

```bash
npx supabase secrets set REVENUECAT_SANDBOX_USER_IDS='<審査用デモアカウントのuser_id>,<自分のuser_id>'
npx supabase functions deploy revenuecat-webhook --no-verify-jwt
```

- 設定すると、Sandbox の権利はリストの人だけ Pro になる（`REVENUECAT_ALLOW_SANDBOX` より優先）。
  本番のイベントで取り直したときに混ざって返る Sandbox の権利も同じ判定で外す。
- 審査員が自分で作ったアカウントで買うと解放されない。設定するなら、審査メモにデモアカウントで
  確認してもらうよう書く。審査中はリストを空にしておく運用でもよい。

`npx supabase secrets list` は値ではなく SHA-256 ダイジェストを返すため、目視では判断できない。
候補文字列のハッシュと突き合わせて確かめる（`true` は `b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b`）:

```bash
printf 'true' | sha256sum
```

無効のままでもテストできること: Paywall 表示・購入フロー・entitlement 付与・アプリ内の Pro 表示・復元。
無効だと確認できないのは `profiles.tier` を見る機能（AI 利用枠など）だけ。必要なときだけ一時的に戻し、
**公開前に必ず `unset` して再デプロイする**。

---

## 4. 鍵をアプリに渡す

RevenueCat → Project settings → **API keys** の **Public SDK Key**（`appl_` 始まり）を使う。
Secret API key は不要（Webhook は共有シークレット方式、REST API v2 も未使用）。

`.env`:

```
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_xxxxxxxxxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=
EXPO_PUBLIC_REVENUECAT_MONTHLY_PRODUCT_ID=com.ash462031.mydesk.pro.monthly
EXPO_PUBLIC_REVENUECAT_YEARLY_PRODUCT_ID=com.ash462031.mydesk.pro.yearly
```

### EAS Build にも渡す（登録済み）

`.env` は EAS Build のサーバーに送られない。`EXPO_PUBLIC_*` はビルド時にバンドルへ焼き込まれるので、
**登録を忘れると本番ビルドだけキーが空になり、Paywall が無反応になる**。

```bash
npx eas env:create --name EXPO_PUBLIC_REVENUECAT_IOS_API_KEY --value appl_xxx \
  --visibility plaintext --environment production --environment preview --environment development
```

`npx eas env:list --environment production` で確認。
現在 production に入っているもの: RevenueCat 3件 / Supabase 2件 / PostHog 1件。

**Metro も `.env` を起動時にしか読まない。** キーを追加したら Metro を再起動する。

---

## 5. ビルドとテスト

`react-native-purchases` はネイティブモジュールなので **Expo Go では動かない**。
[metro.config.js](metro.config.js) が未インストール時にスタブへ差し替える仕組みを持つが、
インストール済みなので本物が使われる。

### この環境では preview ビルドを使う

**development build + Metro は Windows 環境で繋がらない。**

- LAN 接続: Windows Firewall が 8081 を塞ぐ。`New-NetFirewallRule` には管理者権限が必要
- tunnel: ngrok が古いポート（8082）に転送していたり、複数の Metro が同時起動していたりで安定しない
- 端末は接続に失敗しても**キャッシュ済みバンドルで起動してしまう**ため、
  「アプリは動いているのにコード変更が反映されていない」状態に気付きにくい

```bash
npx eas build --profile preview --platform ios
```

preview は JS がバンドル済みなので Metro が要らず、実際の配布物に近い。
1回15〜30分かかるので、**変更をまとめてから回す**。

### Metro が使えない環境でのデバッグ

端末側のログが見られないので、原因を**アプリの画面に出す**のが有効だった。
[SubscriptionContext](src/context/SubscriptionContext.tsx) の `lastError`（`setup: ...` /
`getOfferings: ...` / `no packages (...)` を保持）はその名残で、いまも残してある。
再び詰まったら Paywall のエラー表示に一時的に埋め込む。

### iOS Sandbox テスト

1. App Store Connect → **ユーザーとアクセス** → **Sandbox** → テスターを追加
   - **`+` エイリアスは避け、単純なアドレスにする**（`sandbox-tester@example.com` のような形式。`+2` 形式では
     サインインに失敗した）
   - 地域は日本
2. iPhone の 設定 → **デベロッパ** → **Sandbox Apple Account** でサインイン
   （設定 → App Store の一番下にも同じ項目が出ることがある。**一度も課金アプリを起動していないと表示されない**）
3. **2ファクタ認証のメール確認を求められる。** テスター用アドレスが実在しないとコードを受け取れず詰む。
   「他のメールアドレスを使用する」から**受信できるアドレス**（`yourname+sb1@example.com` など
   Gmail のエイリアス）を指定すれば通る
4. Sandbox では月額が5分・年額が1時間に短縮され、自動更新が6回繰り返されてから停止する

### 検証済みの確認項目

1. Paywall に現地通貨の実価格が出る（`¥590` / `¥5,900`）。`$3.99` のままなら Offering が取れていない
2. 購入 → 「Proにアップグレードしました」→ プランカードが Pro になる
3. RevenueCat の Overview に Active Subscription と取引が出る
4. **Supabase の `profiles.tier` が `pro` に変わる**（Webhook が効いている最終証拠）

`profiles` の確認は REST API が早い:

```bash
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2)
curl -s "https://zewoyfbbhchvbmrzlosj.supabase.co/rest/v1/profiles?select=id,tier,tier_updated_at&order=created_at.desc&limit=3" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

`updated_at` カラムは無い（`created_at` / `tier_updated_at`）。

---

## 6. 審査要件まわり（対応済み）

ガイドライン 3.1.2 が Paywall に求めるもの。すべて [PaywallScreen](src/screens/PaywallScreen.tsx) に実装済み:

- [x] 価格と期間（`priceString` で現地通貨）
- [x] 自動更新であること、更新条件（期間終了24時間前まで）、解約方法
- [x] 購入の復元
- [x] **利用規約・プライバシーポリシーへのリンク**（`TERMS_URL` / `PRIVACY_URL`）

規約・ポリシーは **公開サイト（https://mydesk.page/terms/ ・ /privacy/）を正本にしている**。
アプリ内に本文を持つと改訂のたびに再提出が必要になり、内容がサイト側とズレるため
（実際、アプリ内の英語版に「No data is sent to external servers」という虚偽記載が残っていた）。
[SettingsScreen](src/screens/SettingsScreen.tsx) の規約・ポリシー項目も同じ URL を開く。

**LP を更新したら必ずデプロイする。** アプリが参照するのは本番サイトの内容:

```bash
cd landing && npx vercel --prod
```

規約には課金条項（第4条 有料プラン）を入れてある — 料金の所在、App Store アカウントへの課金、
24時間前までの自動更新解除、解約後も期間終了まで利用可、返金は App Store 規定、価格変更時の事前告知。

---

## 7. リリース前チェック

- [x] `BILLING_UNLOCKED = false`（[SubscriptionContext.tsx:32](src/context/SubscriptionContext.tsx#L32)）
- [x] **`REVENUECAT_ALLOW_SANDBOX=true` を残す**（unset しない。審査員の Sandbox 購入を反映するため。上の「Sandbox 購入を tier に反映させる」参照）
- [ ] **`REVENUECAT_SECRET_API_KEY` を設定して Webhook を再デプロイ**（権利を REST API で取り直す作りに変えたため）
      2026-09-12 時点で未設定。**アカウント削除（delete-account）もこれが無いと全員 503 で失敗する**
      （アプリ内のアカウント削除は審査の必須要件 5.1.1(v)）。RevenueCat → Project settings → API keys →
      シークレットキーを **V1** で発行する（コードは `/v1/subscribers` を叩く）
- [ ] **Sign in with Apple の失効用に `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_CLIENT_ID` / `APPLE_PRIVATE_KEY`**
      を設定する。2026-09-12 時点で未設定で、Apple でログインした人はアカウントを削除できない。
      `APPLE_CLIENT_ID` はバンドルID `com.ash462031.mydesk`、Team ID は `CMC5X2S76P`。
      鍵は Apple Developer → Keys で「Sign in with Apple」を有効にして作る（.p8 は一度しかダウンロードできない）。
      中身は1行につなげて登録してよい（ヘッダーと空白は関数側で取り除く）
- [ ] App Store Connect の **Billing Grace Period（支払いの猶予期間）** を有効にするか決める。
      有効にしても Webhook は猶予中を pro として扱う（`grace_period_expires_date` を見る）
- [ ] サンドボックス検証で `pro` にしたテストアカウントの `profiles.tier` を `free` に戻す
- [x] Paywall に規約・プライバシーポリシーのリンクがある
- [x] 「購入を復元する」がある（Paywall と**設定のトップ**の2箇所。審査員は設定を見る）
- [x] ストアのトライアル設定とアプリの表示が一致（どちらも**なし**）
- [x] 「プロトタイプのため実際の決済は発生しません」等の虚偽表記を全削除
- [x] LP の価格表記を実価格に更新してデプロイ
- [ ] **RevenueCat → Project settings → Sandbox testing access を変える前に、審査員の購入まで止める設定でないかを確認する**
      （審査は Sandbox で購入する。止めると審査員が Pro を解放できない。ドキュメントで挙動を確認できていない）
- [ ] App Store Connect の App内課金がアプリのバージョンに**添付**されている

---

## トラブルシュート

| 症状 | 原因 |
|---|---|
| Paywall で「購入できません」 | Offering が空。下の3行を順に疑う |
| └ `no App Store products registered` | Offering のパッケージに商品を紐付けたが**保存していない** |
| └ `packages=0` かつエラーなし | Offering が Current でない / API キー未設定 |
| └ 価格が `$3.99` のまま | 同上（実価格が取れずフォールバック表示） |
| 購入は通るが free のまま | Entitlement identifier が `pro` でない、または商品が未アタッチ |
| StoreKit 2 で購入が記録されない | **In-App Purchase Key (P8) が未設定**、または API キーと取り違えた |
| 購入後もサーバー機能（AI枠）が Free | Webhook 未設定・401、または `ignored: "sandbox"`。`sync-subscription` が未デプロイだと取り直しも効かない |
| Webhook が全部 401 | `--no-verify-jwt` なしでデプロイ、または Authorization の文字列が不一致 |
| Webhook が 500 `server misconfigured` / 502 `failed to fetch subscriber` | `REVENUECAT_SECRET_API_KEY` が未設定、または v1 のシークレットキーではない |
| Webhook が `ignored: "sandbox"` | 仕様どおり。Sandbox で tier を動かすなら `REVENUECAT_ALLOW_SANDBOX=true` |
| Webhook が `ignored: "anonymous_app_user_id"` | 未ログインで購入した。ログイン後にエイリアスが張られ次のイベントで解決される |
| Webhook が `ignored: "unknown_customer"` | 顧客 ID が `profiles.rc_customer_id` に無い。107 より前の、利用者 ID を顧客 ID にしていた購入はこれになる。アプリで復元すると新しい顧客 ID へ移る |
| コード変更が端末に反映されない | Metro に繋がらず**キャッシュ済みバンドルで起動している**。preview ビルドで確認する |
| Sandbox アカウントにサインインできない | `+` エイリアスを避ける / パスワード再設定 / 2FA のコード受信先を実在アドレスにする |
| Android で "Item not found"（将来） | 内部テストトラックに未配信、または基本プランが無効 |
