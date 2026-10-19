# Androidの設定

## 写真選択と共有リンク

Androidの写真選択はシステムのPhoto Pickerを使い、写真ライブラリ全体への許可を先に要求しません。
アプリには撮影機能がないため、ImagePickerのカメラ権限を無効化しています。

App Linksには既存の`/d`、`/setup`、`/desk`、`/u`に加えて、
現行の公開デスクURL`/<@ID>/<22文字のデスクID>`を受け取るパターンを追加しています。
ルートや規約ページなど、通常のサイトURL全体をアプリの対象にはしていません。
関連付けには、公開ドメインの`assetlinks.json`と実際の署名証明書が必要です。
パスキーと証明書の設定は[パスキー設定](passkeys-setup.md)を参照してください。

## Android通知

Android通知は準備段階です。FirebaseでAndroidアプリ`com.ash462031.mydesk`を登録し、
`google-services.json`をビルド環境に用意します。
EASではFile型の環境変数`GOOGLE_SERVICES_JSON`を使い、ローカルでは同名の環境変数にファイルパスを設定します。
`app.config.js`がこのパスをExpoの`android.googleServicesFile`へ渡します。

FCM V1用のサービスアカウント鍵はEASのPush Notification credentialsへ登録します。
サービスアカウント鍵をアプリや`google-services.json`の代わりに埋め込まないでください。

FCMを設定したネイティブビルドで、`EXPO_PUBLIC_ANDROID_PUSH_ENABLED=true`を設定します。
通知全体の`PUSH_NOTIFICATIONS_ENABLED`と、Supabaseの通知送信用スイッチも有効にする必要があります。
現在は公開スイッチをオフのままにしています。

Androidでは通知許可とトークン取得の前に`default`チャンネル（表示名MyDesk）を作成します。
設定画面からAndroidの通知設定を直接開けます。未対応のOSではアプリ設定へ戻します。
未許可の状態、許可の拒否、アカウント切替、ログアウト時の通知登録解除を実機で確認してください。

カメラ権限、App Links、FCM設定、通知のデフォルトチャンネルの変更にはネイティブ再ビルドが必要です。

参考: [Expo FCM設定](https://docs.expo.dev/push-notifications/fcm-credentials/)、
[Expo通知](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/)、
[Expo ImagePicker](https://docs.expo.dev/versions/v54.0.0/sdk/imagepicker/)。
