# Sentryクラッシュ収集

## 必須設定

- `EXPO_PUBLIC_SENTRY_DSN`: Sentry ProjectのClient Key（DSN）
- `SENTRY_ORG`: Organization slug
- `SENTRY_PROJECT`: Project slug
- `SENTRY_AUTH_TOKEN`: EASのSensitive secret。ソースマップ送信権限だけを付与する

DSNが無い場合、SDKは初期化されるがイベント送信は無効になる。本番だけ送信し、開発ビルドは送らない。

## 取得範囲

- JavaScript未処理例外
- React Error Boundary
- iOS / Androidネイティブクラッシュ
- クラッシュフリーセッション
- App version、Expo Update ID、Runtime version

氏名、メール、内部ユーザーID、HTTP request、画面キャプチャ、View hierarchy、例外メッセージ、Breadcrumb dataは送らない。Performance tracingとSession Replayも無効。

## リリース確認

1. SentryのReact Native Projectを作る。
2. EAS production environmentへ4つの値を登録する。
3. Release Buildを作り、ソースマップアップロード成功をビルドログで確認する。
4. 内部テスト用ビルドで意図的な例外を1回発生させる。
5. Sentryでstack trace、release、Expo Update ID、クラッシュフリーセッションを確認する。
6. テストIssueを解決済みにし、本番アラートを設定する。

OTA更新後はSentryのソースマップもアップロードする。Expo公式手順に従い、`eas update`後に`sentry-expo-upload-sourcemaps`を実行する。
