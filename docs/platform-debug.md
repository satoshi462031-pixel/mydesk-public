# iOS・Android差のデバッグ記録

2026-10-12。実機を操作した検証ではなく、SDK実装の確認、OS別の回帰テスト、
Expoのネイティブ設定生成と各プラットフォームのバンドル生成で確認しました。

## 修正した問題

| 問題 | 修正・確認 |
| --- | --- |
| Androidでは前景通知に`shouldPlaySound: false`を指定するとアラート表示も抑制される | Androidではチャンネルの音設定を使えるようにし、iOSの前景通知は従来どおり無音。Android専用の公開スイッチがオフなら前景表示もしない |
| Androidの通知チャンネルだけ無効でも、アプリ全体の許可がgrantedなら設定への案内が消える | `default`チャンネルのimportanceも確認し、NONEなら通知設定へ誘導する。iOSではチャンネルAPIを呼ばない |
| パスキー操作開始直後の閉じる操作が、Reactの状態反映より先に通ってしまう | 同期的な操作中refでAndroidの戻る・iOSの閉じるボタンをガードする |
| パスキー画面を非表示にしている間に操作が完了すると、再表示時もbusyのままになる | 非表示でもbusyを解除する。古い画面へ成功通知や一覧を適用しないガードは維持 |
| Androidの`/u`などのprefixがサイトの`/user`や`/setup-help`まで受け取る | `/u/`・`/d/`・`/setup/`・`/desk/`へ限定。旧形式と現行のデスクURLの正規化を確認 |
| ネイティブ依存が変わってもappVersionが同じならOTA互換性の区別がつかない | runtimeVersionをfingerprint方式へ変更。Expo SDKでiOSとAndroidの異なるruntimeVersionが解決されることを確認 |

通知とパスキー画面については、修正前に6件の回帰テストが失敗することを確認し、
修正後はすべて通過しました。パスキーの登録・署名検証・キャンセル、アカウント切替、
写真の権限、日時入力、既存の共有リンクのテストも含めて確認しています。

## 確認結果

- `npm run check`：型チェック、lint、アプリ1,776件＋Worker121件のテストが通過。
- パスキーとAndroid通知の環境変数を有効にして、iOS・Android・Webのバンドル生成が成功。
- iOSの認証URLスキーム、Associated Domains、写真・Face IDの利用説明を生成設定で確認。
- Androidの認証URLスキーム、App Links、カメラ権限の除外、通知のデフォルトチャンネルを生成設定で確認。
- Expo SDKのruntimeVersion解決APIで、両OSのfingerprintが別の値になることを確認。

## 実機で残る確認

このWindows環境ではADB・Androidエミュレーター・JavaをPATHから利用できず、iOSシミュレーターも利用できません。
APKやIPAのネイティブコンパイルと、以下の実機動作は未確認です。

1. 各OSでパスキーを登録し、Face ID／指紋・画面ロックで同じアカウントへログインする。
2. 認証中にキャンセル・戻る・アプリ切替を行い、再度操作できることを確認する。
3. Androidで通知を前景・背景・未起動から受け取り、チャンネルだけ無効にした状態でも設定への案内を確認する。
4. 写真選択のキャンセル、AndroidのActivity再生成、iOSの限定アクセスを確認する。
5. 日付の確定・取消、キーボード表示、画面端とシステムバー、Androidの戻る、iOSのスワイプを確認する。
6. 署名証明書と公開ドメインの関連付けを設定し、共有URLから起動する。

## 現在の仕様上の差

- AppleログインはiOSのみ。AndroidはGoogle・メール・パスキーを使います。
- 写真つきの共有はiOSのみで、Androidは公開URL入りの文面を共有します。
- 現行プロフィールURL`/<@ID>`はAndroidのApp Linksに含まれず、Web経由になります。
  旧形式の`/u/<@ID>`は両OSでアプリへ直接渡せます。デスクURLの現行・旧形式は対応しています。
- Androidの通知音・表示はOSのチャンネル設定、日時選択はOSの標準ダイアログに従います。

runtimeVersionとネイティブ設定の変更は、各OSの再ビルドで反映してください。
FCM・パスキーのサーバー設定と関連付けは[Android設定](android-setup.md)・[パスキー設定](passkeys-setup.md)を参照。

参考: [Expoの通知動作](https://docs.expo.dev/versions/v54.0.0/sdk/notifications/#notificationbehavior)、
[AndroidのURLマッチング](https://developer.android.com/guide/topics/manifest/data-element)、
[Expo OTA互換性](https://docs.expo.dev/eas-update/runtime-versions/#avoiding-incompatible-updates)。
