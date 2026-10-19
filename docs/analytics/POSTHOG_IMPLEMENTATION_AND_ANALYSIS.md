# mydesk_app PostHog 完全実装・分析設計書

最終更新: 2026-10-09  
対象: Expo SDK 54 / React Native 0.81 / TypeScript / `posthog-react-native` 4.49.3

## 1. 目的と計測原則

PostHogの目的は「どのユーザーが何を書いたか」を把握することではなく、初回価値到達、継続利用、機能の詰まり、課金導線、集客施策の改善判断に必要な最小限の行動を集計することである。

運用上の必須原則は次の通り。

1. 分析は初期状態で無効。設定画面で明示的に有効化した場合だけPostHogへ送る。
2. メールアドレス、氏名、自由入力本文、商品名、デスク名、URL全体、認証トークンを送らない。
3. エラーの`message`やstack traceを送らず、固定的な`error_name`、`error_code`だけ送る。
4. UTMは運営が命名したASCII値だけを受理し、任意クエリを保存しない。
5. 自動タップ収集、Session Replay、位置情報推定は使わない。
6. KPIはイベント総数ではなく原則`Unique users`で判定する。連打や再レンダーを成長と誤認しない。
7. 本番と開発は`environment`で分離し、正式なダッシュボードは`environment = production`を必須フィルターにする。
8. 同意前の初回起動・`first_item_added`・`first_result_viewed`・`first_personalized_result_viewed`・`first_public_desk_viewed`は第三者へ送らず端末内へ保留し、利用者が明示的に同意した後だけ`deferred_until_consent=true`で送る。発生日時は保持しないため、遅延送信分を順序付きファネルと継続率へ混ぜない。

分析同意者だけのデータなので、全インストール母集団の絶対値にはならない。同意導線を変えた施策では標本の変化を記録し、同意者内の傾向として解釈する。PostHog単独では拒否者を含む同意率を算出できない。

## 2. 実装構成

| ファイル | 役割 |
|---|---|
| `src/services/analytics.ts` | SDK初期化、同意、送信キュー、identify、画面・イベント送信、初回イベント、UTM保存連携 |
| `src/utils/analyticsAttribution.ts` | UTMの検証・抽出、保存値の検証、first/lastプロパティ生成 |
| `src/navigation/RootNavigator.tsx` | cold/warm Deep Linkの受信、UTM登録、画面遷移計測 |
| `src/context/AuthContext.tsx` | Supabase user IDによるidentify、ログアウト時reset、共通プロパティ更新 |
| `src/constants/plans.ts` | `EXPO_PUBLIC_POSTHOG_KEY`と`EXPO_PUBLIC_POSTHOG_HOST`の参照 |
| `tests/analyticsAttribution.test.ts` | 許可UTM、欠損、PII様文字列、長さ上限、壊れた保存値、first/lastのテスト |

### 2.1 環境変数

```dotenv
EXPO_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Project API Keyはクライアント配布を前提にした書き込み用トークンであり、管理APIのPersonal API Keyではない。Personal API Keyはアプリ、`.env`、EASの`EXPO_PUBLIC_*`へ絶対に入れない。PostHog US/EUの実際のProject hostと一致させる。

### 2.2 初期化の実際の挙動

`initAnalytics()`は多重呼び出しを1つのPromiseへまとめる。初期化前のイベントは最大100件までメモリキューへ積み、同意が無い場合は破棄する。SDKオプションは以下。

オンボーディングには任意の分析同意スイッチを表示する。初回起動後に設定画面から同意した場合も、端末内へ保留した初回起動区分と初回価値到達だけを送る。自由入力、写真、URL、正確な発生時刻は保留しない。

| オプション | 値 | 理由 |
|---|---:|---|
| `host` | 環境変数 | PostHog project regionに送る |
| `captureAppLifecycleEvents` | `false` | 自前の`app_opened`と二重計測しない |
| `defaultOptIn` | 未同意時`false` | SDK生成直後から通信を止める |
| `disableRemoteFeatureFlags` | `true` | 未使用の`/flags`通信を止める |
| `preloadFeatureFlags` | `false` | 未使用フラグを起動時取得しない |
| `sendFeatureFlagEvent` | `false` | 未使用の評価イベントを送らない |
| `disableGeoip` | `true` | IP由来の国・地域プロパティを作らない |
| Session Replay | 未指定（既定false） | 画面内容を取得しない |

ライフサイクル自動計測を止めた代わりに、`trackAppOpened()`が`first_launch`、`normal`、`update`を端末保存したアプリバージョンから判定する。オプトアウト中でもバージョンだけは端末内に保存し、後日の同意を初回インストールと誤認しない。

### 2.3 ラッパーAPI

```ts
analytics.track(EVENTS.GADGET_CREATED, { category, source })
analytics.screen('GadgetDetail')
analytics.setContext({ authenticated: true, plan_tier: 'free' })
analytics.error('backup_restore', error, { source: 'settings' })
analytics.reset()

await trackOnce(EVENTS.FIRST_ITEM_ADDED, { source: 'add_gadget' })
await recordAttributionFromUrl(incomingUrl)
```

`track()`のイベント名は`EVENTS`の値だけを受け取る。新しいイベントは定数へ追加してから送る。プロパティの追加時は本書の辞書も同じPRで更新する。

### 2.4 identifyと匿名イベント統合

- 未ログイン時はPostHogが生成した匿名distinct IDで送る。
- Supabase session確定後に、メールではなく`session.user.id`で`identify()`する。
- 初回UTMは`$set_once`、直近UTMは`$set`でPerson Propertiesへ反映する。
- ログアウトでは`reset()`し、次の利用者へdistinct IDとPerson Propertiesを引き継がない。
- オプトアウト時は自前の送信を即時停止し、`reset()`→`optOut()`の順で止める。拒否・解除イベントは送信しない。

## 3. 共通プロパティ辞書

全カスタムイベントと手動screenイベントに次を付与する。

| プロパティ | 型 | 例 | 用途 |
|---|---|---|---|
| `platform` | string | `ios` | OS別比較 |
| `platform_version` | string | `18.6` | OS固有不具合 |
| `locale` | string | `ja-JP` | UI言語・地域傾向。氏名等ではない |
| `timezone` | string | `Asia/Tokyo` | 日次集計解釈 |
| `environment` | enum | `production` | 開発データ除外 |
| `app_version` | string | `1.0.0` | リリース比較 |
| `session_id` | string | ランダム値 | 同一起動内の系列分析 |
| `authenticated` | boolean | `true` | ゲスト／ログイン比較 |
| `plan_tier` | enum | `guest`, `free`, `pro` | プラン比較 |
| `first_utm_*` | string | `twitter` | 初回獲得チャネル。存在時のみ |
| `last_utm_*` | string | `feature_ai` | 直近接点。存在時のみ |
| `deferred_until_consent` | boolean | `true` | 同意前に端末内で到達し、同意後に送信した初回イベント。存在時のみ |

禁止プロパティ名: `email`, `name`, `desk_name`, `product_name`, `query`, `message`, `stack`, `url`, `token`, `access_token`, `refresh_token`, `description`, `feedback_body`。検索では`query_length`、フィードバックでは`body_length`だけを使う。

## 4. カスタムイベント設計

### 4.1 Acquisition・起動・認証・オンボーディング

| イベント名 | 発生トリガー | 仕込む画面／層 | カスタムプロパティ | 主な分析 |
|---|---|---|---|---|
| `attribution_captured` | UTM付きDeep Linkを受理 | RootNavigator | `touch_type`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | X施策の入口数 |
| `deep_link_opened` | 対象Deep Linkを開く | RootNavigator | `link_kind`, `cold_start` | 共有／復元リンク流入 |
| `app_opened` | 初期化後の起動1回 | analytics service | `launch_kind`, `previous_version?` | DAU、初回、更新後利用 |
| `app_ready` | ナビゲーション表示可能 | RootNavigator | `duration_ms`, `state`等の実装済み値 | 起動体験 |
| `auth_attempted` | 認証ボタン押下 | Login | `auth_method`, `auth_mode` | 認証開始率 |
| `auth_succeeded` | 認証API成功 | Login | `auth_method`, `auth_mode` | 認証完了率 |
| `auth_failed` | 認証API失敗 | Login | `auth_method`, `auth_mode`, `error_name`, `error_code?` | 認証障害 |
| `auth_signed_in` | sessionが未ログインからログインへ | AuthContext | 共通のみ | session遷移 |
| `auth_signed_out` | sessionがログインから未ログインへ | AuthContext | 共通のみ | 離脱／共有端末保護 |
| `password_reset_requested` | リセットメール要求成功 | Login | `auth_method` | 回復需要 |
| `onboarding_started` | 同意選択後に利用目的を選んで開始 | Onboarding | `destination`, `measurement_start=after_consent` | 同意後に観測できるファネル母数 |
| `onboarding_intro_completed` | 紹介ステップ完了 | Onboarding | `selected_*`など非自由入力の選択値 | 初期説明の通過 |
| `onboarding_completed` | 初期設定完了 | Onboarding | 選択値、所要時間等の実装済み値 | 初期設定完了率 |

### 4.2 Activation・デスク・ガジェット・配線

| イベント名 | 発生トリガー | 仕込む画面／層 | カスタムプロパティ | 主な分析 |
|---|---|---|---|---|
| `gadget_entry_started` | 登録フォーム開始 | AddGadget | `source`, `category?` | 登録開始 |
| `gadget_entry_abandoned` | 保存前に離脱 | AddGadget | `source`, `stage`, `has_*` | 入力詰まり |
| `gadget_created` | 1台保存完了 | useGadgets | `category`, `source`, 接続情報の集計値 | コア利用 |
| `gadget_updated` | 編集保存完了 | useGadgets | `category`, `source`, `bulk?` | メンテナンス利用 |
| `gadget_deleted` | 削除確定 | useGadgets | `category?`, `deleted_count?`, `bulk` | 整理行動 |
| `first_item_added` | 端末で初めて1台追加 | AddGadget / ProductFill | `source`, `category?`, `count?` | Activation中間点 |
| `product_search_completed` | 商品候補検索成功 | suggestion hook | `query_length`, `result_count`, `category`, `source` | 検索品質 |
| `product_search_failed` | 商品候補検索失敗 | suggestion hook | `query_length`, `category`, `error_name`, `error_code?` | 検索障害 |
| `product_suggestion_selected` | 候補選択 | 商品入力各画面 | `placement`, `category`, `rank?`, `has_url?` | 候補有用性 |
| `affiliate_url_resolved` | 商品リンク解決成功 | Add/Edit Gadget | `source`, `link_host`, `link_type` | 商品マスタ品質 |
| `affiliate_url_resolution_failed` | 解決失敗 | Add/Edit Gadget | `source`, エラー分類 | 商品マスタ欠損 |
| `desk_created` | デスク保存完了 | usePlans | `purpose`, `gadget_count`, `source`等 | コアオブジェクト作成 |
| `desk_opened` | 保存済みデスクを開く | PlanList | `source`, `gadget_count`等 | 再利用 |
| `desk_updated` | 構成・価格等を更新 | usePlans | `update_kind`, `gadget_count`等 | 継続的価値 |
| `desk_deleted` | デスク削除確定 | usePlans | 必要最小限 | 削除率 |
| `wiring_generation_completed` | 配線図生成成功 | GadgetSelection | `gadget_count`, `connection_count`, `purpose`等 | コア成果 |
| `wiring_generation_failed` | 配線図生成失敗 | GadgetSelection | 入力件数、エラー分類 | 生成品質 |
| `first_result_viewed` | 本人の実機2台以上で初めて配線結果を表示 | WiringResult | `gadget_count`, `connection_count`等 | 作成者のActivation |
| `first_personalized_result_viewed` | 同上 | WiringResult | 同上 | 本人の機器による到達の明示 |
| `first_public_desk_viewed` | 他人の公開デスクを初めて表示 | PublicDesk | `source` | 閲覧者の継続率起点。端末ごとに1回 |
| `growth_recorded` | 公開デスクの成長履歴保存 | publish service | `change_kind`, 集計値 | 長期利用 |

### 4.3 Sharing・コミュニティ・収益化・運用

| イベント名 | 発生トリガー | 仕込む画面／層 | カスタムプロパティ | 主な分析 |
|---|---|---|---|---|
| `desk_visibility_changed` | private/public切替成功 | publish service | `visibility`, `is_republish?` | 公開転換 |
| `desk_shared` | OS共有シート起動 | share service | `placement`, 公開状態等 | 共有意向 |
| `share_card_url_copied` | 共有URLコピー | share service | 共通のみ | URL共有 |
| `public_page_viewed` | 公開デスク表示 | PublicDesk | `source`, 所有者か否か等 | コミュニティ閲覧 |
| `bookmark_toggled` | ブックマーク変更 | PublicDesk / BookmarkList | `bookmarked`, `placement` | 保存価値 |
| `like_toggled` | 拍手（旧いいね）の変更。095 以降は版ごとに送れる | DeskFeed / PublicDesk | `liked`, `placement`, `repeat`（前の版にも拍手していたか・095 以降） | 共有への反応 |
| `affiliate_link_displayed` | 購入リンク表示 | 商品詳細各所 | `placement`, `link_host`, `link_type`, `category` | アフィリエイト露出 |
| `affiliate_link_opened` | 外部購入リンクを開く | 商品詳細各所 | 同上 | 送客CTR |
| `affiliate_link_open_failed` | 外部URL起動失敗 | 商品詳細各所 | 同上、エラー分類 | 送客障害 |
| `paywall_viewed` | Paywall表示 | Paywall | `reason`, `placement`, `current_tier` | 課金関心 |
| `paywall_plan_selected` | 月／年プラン選択 | Paywall | `reason`, `plan_id` | 商品選好 |
| `purchase_started` | Store購入開始 | Paywall | `reason`, `plan_id`, `product_id` | 決済開始 |
| `paywall_purchased` | entitlement確認済み | Paywall | `reason`, `plan_id`, `product_id` | 課金CV |
| `purchase_cancelled` | OS決済をユーザー取消 | Paywall | `reason`, `plan_id` | 意図的取消 |
| `purchase_failed` | 購入失敗 | Paywall | `reason`, `plan_id`, エラー分類 | 決済障害 |
| `purchase_entitlement_missing` | 決済成功後entitlementなし | Paywall | `product_id`, `reason` | RevenueCat設定監視 |
| `tier_mismatch_detected` | RevenueCatとprofile tier不一致 | SubscriptionContext | 両側tier | Webhook監視 |
| `paywall_dismissed` | 購入せず閉じる | Paywall | `reason` | Paywall離脱 |
| `purchase_restore_started` | 復元開始 | Paywall | 共通のみ | 復元需要 |
| `purchase_restored` | entitlement復元成功 | Paywall | `product_id?` | 復元成功率 |
| `purchase_restore_empty` | 正常終了だが対象なし | Paywall | 共通のみ | 「失敗」との分離 |
| `purchase_restore_failed` | 復元処理失敗 | Paywall | エラー分類 | Store障害 |
| `plan_limit_hit` | 制限により操作を実際に停止 | 各機能 | `limit_key`, `current`, `max`, `placement` | Paywall契機優先度 |
| `ai_feature_used` | AI回答取得成功 | AI Coach | `feature`, `plan_tier`, 件数・時間の集計値 | AI価値／原価判断 |
| `feedback_submitted` | 送信成功 | feedback service | `category`, `body_length` | VOC量。本文は禁止 |
| `feedback_failed` | 送信失敗 | feedback service | `category`, エラー分類 | フィードバック障害 |
| `review_prompt_opened` | ストア評価URLを開く | Settings | `placement` | レビュー導線 |
| `backup_completed` | バックアップ成功 | backup service | `source`, 件数、所要時間等 | 保全機能利用 |
| `backup_restored` | 復元成功 | backup service | `source`, 件数等 | 復元利用 |
| `data_exported` | エクスポート成功 | Settings | `format`, 件数等 | データ可搬性 |
| `operation_completed` | 名前付き汎用処理成功 | service/context | `operation`と安全な集計値 | 運用監視 |
| `operation_failed` | 名前付き汎用処理失敗 | service/context | `operation`, `error_name`, `error_code?` | 障害監視 |
| `analytics_consent_changed` | 分析を有効化 | analytics service | `consent=true` | 有効化件数。拒否者を含む同意率は算出できない |

公開URL、desk ID、認証URLそのものは送らない。

## 5. PostHog側のSchema管理

1. Data management → Eventsで上表のイベントに日本語descriptionを設定する。
2. Event ownerをProduct、課金系はProduct + Engineeringにする。
3. 機密になり得る禁止プロパティをProperty definitionsにも明記する。
4. 新規イベント追加は`noun_verb`のsnake_case。既存イベント名のrenameは時系列を分断するので行わない。
5. `environment=development`は本番dashboardから除外する。
6. 週1回、Activityで未知イベント名、未知プロパティ、極端なcardinalityを確認する。
7. イベント保存期間とPerson削除手順をプライバシーポリシー、社内手順と一致させる。

推奨Actions:

- `meaningful_return`: `desk_opened OR gadget_created OR gadget_updated OR wiring_generation_completed OR ai_feature_used`
- `activation`: `first_result_viewed`
- `commercial_intent`: `affiliate_link_opened OR paywall_viewed`
- `purchase_success`: `paywall_purchased`

## 6. Funnel設計

### 6.1 オンボーディング離脱ファネル

PostHog → Product Analytics → New insight → Funnelで作成する。

| 設定 | 値 |
|---|---|
| Insight名 | `F01 Onboarding → First Value` |
| Counting | Unique users |
| Order | Ordered（途中の別操作を許容） |
| Conversion window | 7 days |
| Step 1 | `onboarding_started`, filter `measurement_start = after_consent` |
| Step 2 | `onboarding_completed`（入口と同じ`destination`） |
| Step 3（作成） | `first_result_viewed`（`destination = current / planning`） |
| Step 3（閲覧） | `public_page_viewed`, filter `is_own_desk = false`（`destination = explore`） |
| Global filter | `environment = production`, `deferred_until_consent != true`（未設定も許容） |
| Breakdown 1 | `platform` |
| Breakdown 2 | `app_version` |
| Breakdown 3 | `first_utm_campaign` |

Step 1は同意後に観測できる入口であり、インストール数や説明画面の閲覧人数ではない。同意前の離脱はこのファネルで評価できない。Storeのダウンロード数と同意者内の到達人数は母集団が異なるため、割り算して全利用者のActivation率にしない。

見る順番:

1. `started → onboarding_completed`低下: 初期設定保存や遷移のエラーを確認。
2. 作成目的の`completed → first_result_viewed`低下: 登録、テンプレート、自分の機器への置換、生成エラーを確認。
3. 閲覧目的の`completed → public_page_viewed`低下: 一覧から詳細を開く導線を確認。

テンプレート経由で機器追加を飛ばせるため、`first_item_added`は必須ステップにしない。説明画面の改善理由は利用者の聞き取りで補う。

### 6.2 Activation品質ファネル

| 設定 | 値 |
|---|---|
| Insight名 | `F02 Gadget Entry → Wiring Result` |
| Steps | `gadget_entry_started` → `gadget_created`（`bulk != true`） |
| Window | 7 days |
| Counting | Unique users |
| Breakdown | `source`, `platform`, `app_version` |
| Exclusion | `gadget_entry_abandoned`をStep 1と2の間で除外せず、別トレンドで原因を見る |

### 6.3 Paywallファネル

| 設定 | 値 |
|---|---|
| Insight名 | `F03 Paywall → Entitlement` |
| Steps | `paywall_viewed` → `purchase_started` → `paywall_purchased` |
| Window | 7 days |
| Counting | Unique users |
| Breakdown | `reason`（表示・購入開始・購入完了で同じ値） |
| Exclusion insight | `purchase_cancelled`, `purchase_failed`, `purchase_entitlement_missing`を個別Trend化 |

`purchase_started → paywall_purchased`が落ちた場合は訴求よりStore／RevenueCatを先に調べる。`purchase_entitlement_missing`または`tier_mismatch_detected`が1件でも出たらアラート対象にする。

`plan_limit_hit`と`paywall_plan_selected`は任意の経路なので必須ステップにしない。上限到達や失敗・取消・復元は直近期間の参考値として転換率と区別する。

### 6.5 管理画面の集計期間

`worker/src/behaviorMetrics.ts`が順序付き集計を生成する。選択期間をN日とすると、入口は現在からN+7日前以上、7日前未満。各利用者のその期間の最初の入口から7日以内に同じ人が順番に進んだかを`windowFunnel`で判定する。タイムスタンプはミリ秒精度を保持し、別の操作は途中に挟まってよい。遅延送信イベントは除外する。

目的・料金画面のreason・リンクのplacement別では各区分内の最初の入口を使う。区分を横断した人数を単純合計しない。Activation全体は利用者を重複排除する。アフィリエイト全体の率は設置箇所ごとの人数を合算した率で、全体のユニークユーザーCTRではない。

新しい入口定義が収集されてから7日間は成熟したActivationの母数がない。旧`onboarding_started`（説明画面表示）は新しいファネルへ混ぜない。日次アクティブ・エラー・操作件数は通常の直近N日であり、ファネルの入口期間とは異なる。

### 6.4 X流入ファネル

| 設定 | 値 |
|---|---|
| Insight名 | `F04 X → Activation` |
| Filter | `first_utm_source = twitter`, `environment = production` |
| Steps | `attribution_captured` → `onboarding_completed`（既存ユーザーでは任意）→ `first_item_added` → `first_result_viewed` → `desk_shared` |
| Alternative existing-user funnel | `attribution_captured` → `public_page_viewed` → `bookmark_toggled` |
| Breakdown | `utm_campaign`, 次に`utm_content` |
| Window | 7 days |

新規と既存を同じファネルで混ぜない。`app_opened.launch_kind`または`first_result_viewed`到達済みコホートで分ける。

## 7. Retentionとコホート

### 7.1 「戻ってきた」の定義

経営向けの到達確認は`app_opened`、プロダクト価値の継続確認は`meaningful_return`を使う。通知・リンク誤タップでも起動は増えるため、主要KPIは後者。

| Insight | Start event | Return event | 設定 |
|---|---|---|---|
| `R01 Activated user app return` | `first_result_viewed` | `app_opened` | First-time retention, Daily, Unique users |
| `R02 Activated user meaningful return` | `first_result_viewed` | Action `meaningful_return` | First-time retention, Daily, Unique users |
| `R03 X-acquired meaningful return` | `first_result_viewed` | Action `meaningful_return` | `first_utm_source=twitter`でfilter |

R01〜R03のStart eventには`deferred_until_consent != true`（未設定も許容）を付ける。遅延送信分は送信日時が起点になり、到達日とずれるため。

日本語の「2日目」は初日を1日目とするなら翌日で、PostHog上はDay 1（D1）。「7日目」は同じ数え方ならDay 6となる。チーム内の混乱を避け、本プロジェクトでは以下の表記に固定する。

- `D1 / 翌日継続`: activation日の翌暦日にreturn。
- `D7 / 7日後継続`: activation日から7日後の暦日にreturn。
- 経営資料に「2日目」「7日目」だけを書かない。

Retention calculationはまずRelative retentionを使い、指定日のセルを読む。週1利用が自然な機能には`On or after`も併記するが、Exact dayと混ぜない。

管理画面はUTCの暦日で集計する。起点は全履歴で最初の`first_result_viewed`（作成）または`first_public_desk_viewed`（閲覧）。遅延送信された起点を持つ人は除外人数へ計上する。期間外の古い起点を期間内の再送で置き換えない。

D1/D7/D30は対象の暦日が終了した直近N日分の起点を分母にする。起点からの暦日差はそれぞれ`2 <= age < N+2`、`8 <= age < N+8`、`31 <= age < N+31`。翌週再利用は7〜13日後に1回以上戻った人の割合で、`14 <= age < N+14`が対象。30日表示でもD30の分母が存在するよう指標ごとに起点期間をずらす。作成者のreturnは`meaningful_return`、閲覧者は他人の`public_page_viewed`とする。率と対象人数、直近N+31日分の遅延送信の除外人数を併記する。

新規追加した閲覧イベントの初回は計測導入後に初めて観測した到達であり、導入前の閲覧履歴は遡及しない。

### 7.2 保存コホート

| コホート名 | 条件 | 用途 |
|---|---|---|
| `C Activated` | `first_result_viewed`をever実行 | アクティブ価値到達者 |
| `C Activated last 30d` | 過去30日で`first_result_viewed`または`wiring_generation_completed` | 現行UX評価 |
| `C X first-touch` | Person `first_utm_source = twitter` | X獲得の長期比較 |
| `C X launch campaign` | `first_utm_source=twitter AND first_utm_campaign=launch_2026q3` | ローンチ施策 |
| `C Limit hit no purchase` | 30日内`plan_limit_hit`あり、`paywall_purchased`なし | 価格・機能境界調査 |
| `C Pro active` | Person `plan_tier=pro`かつ30日内meaningful_return | 有料継続利用者 |

Personの`plan_tier`は現状イベント共通プロパティが中心である。動的Person Propertyとして常に最新tierを使う分析が必要なら、SubscriptionContextのtier確定時に`analytics.identify(userId, { plan_tier })`を追加する。過去イベント時点のtierを分析する場合はEvent Propertyを使う。

## 8. Dashboard設計

### 8.1 `D01 Executive Product Health`

| Tile | Insight | 表示 |
|---|---|---|
| Activated users | `first_result_viewed` Unique users | Weekly number |
| Meaningful WAU | Action `meaningful_return` Unique users | Weekly trend |
| D1/D7 retention | `R02` | Retention table |
| Activation funnel | `F01` | Funnel |
| Paid conversions | `paywall_purchased` Unique users | Weekly trend |
| X activated users | `first_result_viewed`, first source twitter | Weekly trend |

期間はLast 90 days、dashboard filterは`environment=production`。週次会議では前週比だけでなく4週移動平均を見る。

### 8.2 `D02 Onboarding & Activation`

- `F01 Onboarding → First Value`
- `F02 Gadget Entry → Wiring Result`
- `gadget_entry_abandoned`を`stage`でbreakdown
- `wiring_generation_failed / wiring_generation_completed`の比率
- `product_search_completed`の平均`result_count`
- `first_result_viewed`までのtime-to-convert

### 8.3 `D03 Monetization & Reliability`

- `F03 Paywall → Entitlement`
- `plan_limit_hit` Unique users by `limit_key`
- Paywall view→purchase CVR by `reason`
- `purchase_cancelled`, `purchase_failed`, `purchase_entitlement_missing`
- `tier_mismatch_detected`
- Affiliate `displayed → opened` Funnel by `placement`と`link_type`

Alerts:

- `purchase_entitlement_missing > 0` over 1 hour。
- `tier_mismatch_detected > 0` over 1 hour。
- `purchase_failed`が直近7日同曜日平均の3倍。
- `wiring_generation_failed / completed > 5%`。

### 8.4 `D04 Acquisition — X`

- `attribution_captured` Unique users by `utm_campaign`。
- `F04 X → Activation`。
- X first-touchのD1/D7 meaningful retention。
- `utm_content`別`public_page_viewed → bookmark/fork`。
- `utm_campaign`別`paywall_purchased`。
- first-touchとlast-touchを並べ、認知施策と再訪施策を区別。

低母数で`utm_content`まで分解すると個人が推測できるため、表示・共有は最低10 unique usersを目安にする。

## 9. X（@mydesk_app）UTM設計

### 9.1 命名規則

| Parameter | 固定／規則 | 例 |
|---|---|---|
| `utm_source` | Xは常に`twitter`。`x`, `X`, `Twitter`を混在させない | `twitter` |
| `utm_medium` | オーガニックは`social`、広告は`paid_social` | `social` |
| `utm_campaign` | 目的＋期間。ASCII snake_case、80字以内 | `launch_2026q3`, `feature_ai_2026q3` |
| `utm_content` | 掲載面＋creative識別子 | `profile`, `pinned_post_a`, `post_20260824_a` |
| `utm_term` | オーガニックでは省略。広告キーワードも管理slugだけ | `desk_setup` |

投稿本文、ユーザー名、メール、自由入力をUTMへ入れない。campaign名は途中で変更せず、変更が必要なら新campaignを切る。

### 9.2 コピーして使うURL

プロフィール:

```text
https://mydesk.page/?utm_source=twitter&utm_medium=social&utm_campaign=always_on_2026&utm_content=profile
```

ローンチ固定ポスト:

```text
https://mydesk.page/?utm_source=twitter&utm_medium=social&utm_campaign=launch_2026q3&utm_content=pinned_post_a
```

公開デスク紹介（インストール済み端末ではUniversal/App Linkでアプリへ入る）:

```text
https://mydesk.page/setup/REPLACE_DESK_ID?utm_source=twitter&utm_medium=social&utm_campaign=desk_showcase_2026q3&utm_content=post_20260824_a
```

広告:

```text
https://mydesk.page/?utm_source=twitter&utm_medium=paid_social&utm_campaign=acq_wiring_2026q3&utm_content=video_a&utm_term=desk_setup
```

### 9.3 実装された紐付け

1. RootNavigatorがcold startの`Linking.getInitialURL()`とwarm startの`url`イベントを受ける。
2. `recordAttributionFromUrl()`が`utm_source`と`utm_campaign`を必須として抽出する。
3. 値はASCII英数字と`._~-`のみ、各80文字以下。URL全体や他のqueryは捨てる。
4. 端末のfirst touchは初回だけ保存、last touchはUTMリンクを開くたび更新する。
5. `attribution_captured`へ現在接点を送る。
6. 以後のイベントへ`first_utm_*`と`last_utm_*`を共通プロパティとして添付する。
7. ログイン後はfirstを`$set_once`、lastを`$set`でPersonへ保存する。

Person Propertyはユーザーの「現在状態」を絞る用途、Event Propertyはイベント発生時点のスナップショットとして使う。購入イベントを分析する際は購入時イベントの`first_utm_campaign`を優先する。

### 9.4 重要な限界: Store installをまたぐ計測

UTM付きリンクを押した後にApp Store / Google Playで新規インストールすると、通常は最初のアプリ起動URLへ元のUTMが自動で戻らない。現実装で確実に計測できるのは次の2つ。

- インストール済み利用者が`/setup/...`のUniversal Link / App Linkからアプリを開く場合。
- Web landing自体にも同じPostHog projectを導入し、匿名Web行動を計測する場合。ただしWeb匿名IDと新規アプリIDは自動では同一人物にならない。

installをまたぐ確定的なattributionが必要なら、次のいずれかを別途導入する。

1. 推奨: AppsFlyer / Adjust / Branch等のdeferred deep link対応MMP。ATT、Google Play Install Referrer、同意表示、プライバシーポリシーを同時設計する。
2. 自前handoff: landingで短命・ランダムなattribution tokenを発行し、Store遷移後にアプリで回収する。ただしiOSで汎用的に確実な回収はできず、fingerprintingは行わない。

現状のデータを「X経由インストール数」と呼ばず、「アプリが受理したX UTM付きDeep Link数」と呼ぶ。

## 10. QA・リリース手順

### 10.1 ローカル自動検査

```powershell
npx.cmd tsc --noEmit
npm.cmd run test:app
```

### 10.2 実機確認

1. 分析OFFでアプリを起動し、PostHog Live Eventsにイベントが出ないこと。
2. オンボーディングまたは設定で分析ONにし、`analytics_consent_changed=true`と、保留されていた`app_opened.launch_kind=first_launch`が1件出ること。
3. 分析OFFのまま初回配線図まで到達してからONにした場合、`first_item_added`と`first_result_viewed`が`deferred_until_consent=true`で各1件だけ出ること。
4. 次のURLをNotes等から開く。

```text
https://mydesk.page/setup/VALID_DESK_ID?utm_source=twitter&utm_medium=social&utm_campaign=qa_2026q3&utm_content=ios_a
```

5. `attribution_captured`にURLやdesk IDがなく、許可UTMだけがあること。
6. 次の通常イベントに`first_utm_campaign=qa_2026q3`と`last_utm_campaign=qa_2026q3`があること。
7. 別campaignのリンクを開き、firstが維持されlastだけ変わること。
8. ログイン後、Personのfirst/lastが正しいこと。
9. ログアウトし、次アカウントのdistinct IDが前アカウントと分離すること。
10. 分析OFFへ戻した後にイベントが増えないこと。
11. Android App LinkとiOS Universal Linkを別々に確認する。

PostHog toolbarやLive Eventsで本番確認する場合、QA端末のeventに`environment=production`が付く。本番KPIへ混ぜないよう`utm_campaign=qa_*`を除外するか、検証後にテストPersonを削除する。

## 11. 週次の意思決定ルール

1. 毎週同じ曜日にD01を確認し、率と母数、同意導線の変更有無を記録する。同意率は拒否者を含む母数が別途得られる場合だけ記録する。
2. 最大離脱ステップを1つ選び、仮説を1つだけ実装する。
3. primary metricをファネルCVR、guardrailをクラッシュ、処理失敗、D1 retentionにする。
4. リリース前後を`app_version`で比較し、最低1週間または必要サンプルまで結論を急がない。
5. 改善しなければ戻せる単位で変更する。イベント定義自体を途中で変えない。
6. X施策はcampaign単位、creativeはcontent単位で判断する。10人未満の細分化は結論を出さない。

## 12. 実装後に考えること（優先順）

### P0 — リリース前

- PostHogのData processing regionと`EXPO_PUBLIC_POSTHOG_HOST`を照合する。
- Privacy Policyの分析項目にPostHog、取得イベント、UTM、オプトアウト、保存期間、国外移転を反映する。
- iOS Privacy Manifest / App Privacy、Google Play Data safetyの申告を実挙動と一致させる。
- 実機でOFF時ゼロ送信、first/last UTM、resetを確認する。
- Dashboardの全tileへ`environment=production`を付ける。

### P1 — データが2〜4週間貯まった後

- `F01`最大離脱だけを改善し、`app_version`で前後比較する。
- `gadget_entry_abandoned.stage`の上位1箇所を短縮する。
- `plan_limit_hit.limit_key`ごとのPaywall CVRから、上限制・訴求順を決める。
- Xのprofile/pinned/個別postを`utm_content`で比較し、勝ちcreativeへ集中する。

### P2 — 規模拡大時

- 新規install attributionが事業判断に必須になった時点でMMPを評価する。それまでは追加SDKを増やさない。
- PostHog reverse proxyはtracking blocker対策の必要性と、独自ドメイン経由にする法務説明を比較して決める。
- Feature FlagsやExperimentsを使う段階でのみ`disableRemoteFeatureFlags`を見直す。
- Warehouse export、データ保持期間、削除依頼の自動化を整備する。

## 13. 参考資料

- PostHog React Native SDK: https://posthog.com/docs/libraries/react-native
- Funnels: https://posthog.com/docs/product-analytics/funnels
- Retention: https://posthog.com/docs/product-analytics/retention
- Dashboards: https://posthog.com/docs/product-analytics/dashboards
- Person properties: https://posthog.com/docs/product-analytics/person-properties
