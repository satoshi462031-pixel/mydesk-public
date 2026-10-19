# MyDesk App Store / Google Play 審査リスク評価

評価日：2026年8月24日  
対象バージョン：1.0.0  
対象：iOS `com.ash462031.mydesk` / Android `com.ash462031.mydesk`

## 1. 結論

今回の修正を本番へデプロイした後の総合リジェクトリスクは「中」です。主要機能に加え、アプリ内課金、購入復元、アカウント削除、UGC通報、ユーザーブロック、AIデータ送信への明示同意、AI回答通報、公開テキスト検査、ウェブ削除申請ページおよびプライバシーポリシーへの導線が実装されています。

次の4件はリポジトリ上で修正済みです。ただし、migration、Edge Function、Landingおよびアプリの本番反映前は要件を満たしません。

1. Androidの未使用録音権限をExpo設定と`blockedPermissions`で除外
2. AIへ文章・写真を送る直前の説明・同意と、AI回答専用の通報機能を追加
3. Google Play向けのウェブ削除申請ページを追加
4. UGCの公開テキスト検査、DBトリガーおよび24時間以内の通報対応手順を追加

残る主なリスクは、公開画像の自動モデレーション、ストアのプライバシー申告、本番デプロイ、実機での課金・削除・権限確認です。詳細な判断事項は`POST_FIX_NEXT_DECISIONS.md`にまとめています。

## 2. 提出前に必須の対策

### R-01 未使用の録音権限

- 重要度：重大
- 対象：Google Play、利用者の信頼
- 修正状況：`app.json`でImage Pickerのマイク権限を無効化し、`blockedPermissions`でも`android.permission.RECORD_AUDIO`を除外しました。Expoのintrospectionで生成Manifestが`tools:node="remove"`になることを確認済みです。
- リスク：コア機能と無関係な機密権限として、権限の必要性、Data safety申告、目立つ開示および同意を問われます。説明できない権限は、審査遅延または拒否の原因になります。
- 残作業：リリースAABのAndroidManifestにも録音権限がないことを確認します。
- 検証：AABを生成し、Android Studio APK Analyzerまたは`apkanalyzer manifest permissions`で録音権限が存在しないことを確認します。

### R-02 AIへの第三者提供に関する明示とAI回答の通報

- 重要度：重大
- 対象：Apple 5.1.2、Google Play AI-Generated Content policy
- 修正状況：初回送信前の専用同意画面、同意バージョンの保存、各AI回答の通報ボタン、通報理由、通報テーブル、RLSおよび安全性を強化したシステムプロンプトを追加しました。
- リスク：Appleは、個人データを第三者AIと共有する場所と利用方法の明確な開示および明示的な許可を求めています。Google Playは、生成AIアプリに、不適切なAI出力をアプリ内から通報できる機能を求めています。
- 必須対策：
  1. AIコーチの初回利用時、送信ボタンを有効にする前に次の文面を表示します。

     「AIデスクコーチでは、入力文、添付画像、デスク名・利用目的、有効にした項目（機材・仕様、配線、任意の価格・日付）を、回答生成のためAnthropicへ送信します。パスワード、本人確認書類、決済・口座情報、第三者の個人情報などは送信しないでください。詳しくはプライバシーポリシーをご確認ください。」

  2. 「同意して利用する」と「利用しない」を同じ画面で選べるようにし、同意日時とポリシーバージョンを端末またはアカウントへ保存します。
  3. AIメッセージの長押しメニューまたは各回答のメニューに「不適切な回答を報告」を追加します。
  4. 通報理由として「危険な内容」「差別・嫌がらせ」「性的な内容」「個人情報」「誤情報」「その他」を用意し、対象回答、利用者入力、モデル、時刻およびアプリバージョンを必要な範囲で送信します。
  5. サーバー側で禁止コンテンツを抑制するシステムプロンプト、入力検証および出力フィルタを追加し、通報を改善へ反映する運用を文書化します。

### R-03 Google Play用ウェブアカウント削除ページ

- 重要度：重大
- 対象：Google Play User Data / Account Deletion
- 修正状況：アプリ内の完全削除に加え、`https://mydesk.page/account-deletion/`として公開する専用ページをLandingへ追加しました。
- リスク：Google Playは、アプリ内削除経路に加え、利用者がアプリを再インストールしなくても削除を申請できるウェブリンクを要求します。Play ConsoleのData safety欄へ有効なURLを登録できない場合、公開を拒否される可能性があります。
- 掲載内容：
  - アプリ内削除手順
  - アプリを利用できない場合のメール申請手順
  - 本人確認方法
  - 削除されるデータ
  - 法令・不正防止のため保持する可能性があるデータと期間
  - 購読は別途App Store / Google Playで解約する必要があること
- 必須設定：Play Consoleの「Data safety > Data deletion」に上記URLを登録します。

### R-04 UGCの投稿フィルタとモデレーション運用

- 重要度：高
- 対象：Apple 1.2、Google Play User Generated Content policy
- 修正状況：既存の通報・ブロックに加え、公開前のテキスト検査、クライアント迂回を拒否するDBトリガー、対応期限、重大通報の優先順位、再犯者への措置および権利侵害対応手順を追加しました。
- 残作業：公開画像の自動判定は未実装です。初期は注意表示と24時間以内の目視確認で運用し、投稿量または重大通報に応じて画像モデレーションを導入します。
- 必須対策：
  1. デスク名、説明、表示名など公開テキストへ禁止語句・URLスパム・個人情報パターンの最低限のフィルタを追加します。
  2. 公開画像へ安全性チェックを導入するか、少なくとも初回公開前に禁止コンテンツと写り込みを確認するチェック画面を追加します。
  3. 通報受領から原則24時間以内に一次確認、児童搾取・具体的脅迫・個人情報漏えいは即時非公開とする内部手順を作成します。
  4. 通報件数、理由、対象利用者、対応結果、対応日時を管理画面で確認できるようにします。
  5. 利用規約違反の削除、警告、一時停止、永久停止に関する基準を定めます。
  6. ストア審査用アカウントで、公開デスク右上のメニューから通報とブロックを確認できることをReview Notesに記載します。

## 3. 高〜中リスクの対策

### R-05 利用状況分析が初期状態で有効

- 重要度：高
- 修正状況：PostHog分析は保存済みの明示的な有効化がある場合だけ送信する初期オプトアウトへ変更しました。設定画面から任意に変更できます。
- リスク：プライバシーポリシーで説明していても、初回起動時に利用者が認識しないまま第三者分析サービスへ識別子付きデータを送信すると、Appleの明確な開示・許可要件およびGoogle Playの目立つ開示要件との整合性を問われる可能性があります。
- 推奨対策：初回起動時は分析を無効とし、用途、送信項目、PostHogの名称、停止方法を説明したうえで任意のオプトインに変更します。「許可しない」を選んでも主要機能を利用できるようにします。
- ATT：現状どおりIDFA、広告IDまたは他社サービス横断追跡を行わない場合、AppTrackingTransparencyの許可ダイアログは不要です。将来広告SDKまたはリターゲティングを追加する場合は再評価します。

### R-06 App Privacy / Data safety申告の不一致

- 重要度：高
- リスク：実装、プライバシーポリシー、App Store ConnectのPrivacy Nutrition Label、Google PlayのData safetyで項目が異なると、拒否または公開後の措置につながります。
- App Storeで申告を検討すべきデータ：
  - Contact Info > Email Address：App Functionality、ユーザーに関連付け
  - User Content > Photos or Videos：App Functionality、ユーザーに関連付け
  - User Content > Other User Content：App Functionality、ユーザーに関連付け
  - Identifiers > User ID：App Functionality / Analytics、ユーザーに関連付け
  - Purchases > Purchase History：App Functionality / Analytics、ユーザーに関連付け
  - Usage Data > Product Interaction：Analytics、ログイン中はユーザーに関連付け
  - Diagnostics > Performance Data / Other Diagnostic Data：App Functionality / Analytics。実際の送信内容に応じて選択
  - Device ID：PostHog、RevenueCat、Supabaseまたはアプリ生成端末IDのSDK仕様と実通信を確認し、デバイス単位で継続利用できる識別子を送信する場合は申告
- Tracking：他社アプリ・ウェブサイトを横断した広告追跡またはデータブローカーへの提供を行わないなら「No」。
- Google Playで申告を検討すべきデータ：Personal infoのEmail/User IDs、Photos and videos、App activity、App info and performance、Device or other IDs、Purchase history、その他ユーザー生成コンテンツ。
- 必須対策：リリース候補ビルドの実通信をプロキシで確認し、PostHog、RevenueCat、Supabase、Anthropicを含むSDK・APIのデータ項目を確定してから申告します。

### R-07 購読表示とGoogle Play向け文面

- 重要度：中
- 良い点：購入前に選択プラン、ストアから取得した価格、請求期間、主要機能、自動更新、解約方法、利用規約、プライバシーポリシーおよび購入復元が表示されています。設定画面から購読管理画面も開けます。
- 修正状況：利用規約をApple／Google共通へ更新し、購入画面のAndroid文言を「Google Playの定期購入画面で解約しない限り自動更新されます」へ変更しました。
- 確認：無料体験を設定する場合、体験期間、体験終了後の価格、請求頻度、自動更新、解約期限を購入ボタンの近くに表示します。

### R-08 アカウント削除と購読解約の分離

- 重要度：中
- 良い点：削除確認画面で、アカウント削除だけでは購読が解約されないことを説明しています。関連するSupabaseデータ、公開デスク、写真、端末データの削除も実装されています。
- 対策：削除確認画面に「購読を管理」ボタンを追加し、購読中の利用者がストア管理画面を開いた後に削除へ進めるようにします。削除後も課金が継続し得ることを、利用規約、プライバシーポリシー、ウェブ削除ページで同じ表現にします。

### R-09 審査用アカウントとバックエンド

- 重要度：中
- リスク：Appleはログイン機能があるアプリに、期限切れにならないデモアカウントまたは完全なデモモードを求めます。AI、公開、課金同期またはバックエンドが審査中に使えない場合、Guideline 2.1で拒否される可能性があります。
- 必須対策：
  - メール確認済みの審査専用アカウントを用意
  - 2要素認証、ワンタイムパスワード、地域制限を無効化
  - 公開デスク、通報、ブロック、AI、バックアップを確認できるサンプルデータを登録
  - Pro機能の確認方法をReview Notesへ記載
  - Supabase、AI Edge Function、RevenueCat Webhook、公開ページを審査期間中稼働

### R-10 写真と公開情報

- 重要度：中
- 良い点：iOSの写真ライブラリ使用目的は、デスク写真の保存という機能と一致しています。
- 対策：AI画像添付と公開写真について、選択直前に「人物、住所、画面などの個人情報を含めない」旨を表示します。App Privacy / Data safetyでは写真の収集を申告します。写真への位置情報メタデータがアップロード前に除去されることも実機で確認します。

### R-11 アフィリエイト表示

- 重要度：中
- 良い点：商品リンクの近くに、アフィリエイト広告を含み報酬を得る場合がある旨を表示しています。デジタル機能ではなく物理商品の販売ページへリンクしています。
- 対策：すべての商品リンク画面で、スクロールや折りたたみの外に隠れない位置へ「広告」「PR」または現在の説明文を表示します。掲載順やAI提案が報酬で変わらないという説明は、実際のロジックがそうである場合にのみ維持します。価格・在庫の最新性を保証しない旨も表示します。

## 4. 低リスクだが確認が必要な項目

### R-12 Sign in with Apple

- iOSでApple Sign Inが設定されています。Google、Facebookなど他社ログインを同等の主要認証方法として提供する場合も、Apple Sign Inを同等に利用できる状態を維持します。

### R-13 暗号化申告

- `ITSAppUsesNonExemptEncryption: false`が設定されています。HTTPS、OS標準暗号、認証SDKのみを利用し、独自暗号または規制対象となる暗号機能を追加していないことをリリースごとに確認します。

### R-14 最小機能と完成度

- アプリは十分なネイティブ機能を持ち、単なるウェブサイトラッパーではありません。
- リリース候補ビルドで、オフライン、低速回線、画像権限拒否、購入キャンセル、購入復元、バックエンド障害、空データ、アカウント削除を実機確認します。
- ストア掲載画像に未実装機能、固定価格、ランキング表現または誤認を招くAI性能の断定を含めないでください。

### R-15 年齢区分

- UGCおよびAI機能があるため、ストアの年齢区分質問へ正確に回答します。
- 性的・暴力的コンテンツを禁止し、フィルタ・通報・削除を運用する前提で、実際の表示可能性に基づいて頻度を回答します。
- 子ども向けカテゴリとして申請しないことを推奨します。

### R-16 サポート情報

- AppleのSupport URLは、実際の連絡先へ到達できる必要があります。`https://mydesk.page/`にメールアドレスだけでなく、法令上必要な正式所在地および電話番号、または適法な開示請求方法を分かりやすく掲載します。
- プライバシーポリシー、利用規約、アカウント削除ページが、ログインなし・Cookie同意なしで閲覧できることを確認します。

## 5. 提出用プライバシー申告の作業表

| データ | 取得 | 利用目的 | ユーザー関連付け | 外部処理先 | 確認事項 |
|---|---|---|---|---|---|
| メールアドレス | あり | 認証・連絡 | あり | Supabase、認証事業者 | 分析へ送らない |
| 内部ユーザーID | あり | 認証・機能・分析・課金 | あり | Supabase、PostHog、RevenueCat | Apple/Googleとも申告 |
| デスク・機器情報 | 機能によりあり | 記録・公開・バックアップ・AI | あり | Supabase、Anthropic | ローカルのみの場合との差を説明 |
| 写真 | 任意 | 記録・公開・AI | あり | Supabase、Anthropic | 位置メタデータ確認 |
| AI入力 | 任意 | 回答生成 | あり | Anthropic | 初回明示同意を追加 |
| 購読情報 | あり | 権利付与・復元 | あり | Apple/Google、RevenueCat、Supabase | 決済カード情報は取得しない |
| 操作・画面履歴 | 同意時 | 分析・改善 | ログイン中はあり | PostHog | 初期オプトインへ変更推奨 |
| 診断情報 | あり | 障害・安全性 | 状況による | Supabase、PostHog、Cloudflare等 | SDK実通信を確認 |
| 広告ID | なし | 使用しない | なし | なし | SDK追加時に再評価 |
| 正確な位置情報 | なし | 使用しない | なし | なし | 権限を追加しない |
| 音声 | なし | 使用しない | なし | なし | RECORD_AUDIOを削除 |

## 6. リリース前チェックリスト

### アプリ実装

- [ ] Androidの`RECORD_AUDIO`権限を削除した
- [ ] AI初回利用前にAnthropicへの送信項目・目的を表示し、任意同意を取得する
- [ ] AI回答をアプリ内から通報できる
- [ ] 公開テキストの最低限のフィルタを実装した
- [ ] 通報を確認・処理できる運用担当と管理手段がある
- [ ] 設定からアカウントを完全削除できる
- [ ] アカウント削除前に購読管理画面を開ける
- [ ] 設定から購読管理と購入復元を実行できる
- [ ] 分析の初回同意または明確な事前説明を実装した
- [ ] 権限拒否、オフライン、購入キャンセル、API障害でクラッシュしない

### ウェブ・法務

- [ ] `https://mydesk.page/terms/`を新しい利用規約全文へ更新した
- [ ] `https://mydesk.page/privacy/`を新しいプライバシーポリシー全文へ更新した
- [ ] `https://mydesk.page/account-deletion/`を公開した
- [ ] 3ページがログインなしで閲覧できる
- [ ] サポートページに連絡先を掲載した
- [ ] 通報対応基準と記録保持手順を内部文書化した
- [ ] 商品リンクのすべてに広告表示がある

### App Store Connect

- [ ] App PrivacyをSDK・APIの実通信と一致させた
- [ ] Privacy Policy URLとSupport URLを登録した
- [ ] 自動更新購読の商品名、期間、価格、機能を正確に設定した
- [ ] Review NotesへUGC、AI、購読、アフィリエイトの確認方法を記載した
- [ ] 期限切れにならない審査用アカウントを登録した
- [ ] AI、公開、通報、ブロック、Pro機能を審査できる状態にした
- [ ] 年齢区分をUGC・AIの実態に合わせた
- [ ] スクリーンショットと説明文が現行機能だけを示している

### Google Play Console

- [ ] Data safetyをSDK・APIの実通信と一致させた
- [ ] Privacy Policy URLを登録した
- [ ] Data deletion URLへ専用削除ページを登録した
- [ ] App accessへ審査用アカウントと手順を登録した
- [ ] Adsで「広告あり／なし」を実態に合わせた。アフィリエイトリンクの扱いも最新のConsole説明を確認した
- [ ] AI-generated content、UGC、Content ratingの質問へ正確に回答した
- [ ] 定期購入の価格、請求頻度、自動更新および解約導線を確認した
- [ ] AABの権限一覧に不要な機密権限がない

## 7. 公式確認資料

- Apple App Review Guidelines：https://developer.apple.com/app-store/review/guidelines/
- Apple アカウント削除：https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Apple App Privacy Details：https://developer.apple.com/app-store/app-privacy-details/
- Apple App Store Connectメタデータ：https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/
- Google Play Account Deletion：https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play Data safety：https://support.google.com/googleplay/android-developer/answer/10787469
- Google Play AI-Generated Content：https://support.google.com/googleplay/android-developer/answer/13985936
- Google Play UGC moderation：https://support.google.com/googleplay/android-developer/answer/12923286
- Google Play Subscriptions：https://support.google.com/googleplay/android-developer/answer/9900533
- Google Play Store listing：https://support.google.com/googleplay/android-developer/answer/9859152
- 個人情報保護委員会 個人情報保護法ガイドライン：https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/
- 消費者庁 消費者契約法：https://www.caa.go.jp/policies/policy/consumer_system/consumer_contract_act/
- 消費者庁 景品表示法：https://www.caa.go.jp/policies/policy/representation/fair_labeling/

## 8. 法務上の最終確認

本書は現在のソースコードと公開情報に基づく実務文案および審査対策であり、弁護士による個別の法律意見ではありません。日本国外へ配信する場合、GDPR、UK GDPR、CCPA/CPRA、COPPA、各国の消費者保護法、AI規制、税務およびデジタルサービス規制について、配信国を決めたうえで追加確認が必要です。

特に、実名・住所・電話番号、事業形態、配信国、実際のサーバーリージョン、各委託先との契約、保存期間および通報運用担当者はソースコードだけでは確定できません。公開前に運営者が事実確認し、事実と異なる記載を修正してください。
