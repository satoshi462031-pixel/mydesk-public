# iOS・Androidパスキーログイン

設定 → 基本設定 → パスキーから、ログイン中のアカウントにパスキーを登録します。
登録後はログイン画面の「パスキーでログイン」で同じアカウントに戻れます。
登録済みパスキーの一覧と登録解除も設定画面で行えます。解除には確認が必要で、
端末のパスワード管理サービスに保存された資格情報は削除しません。

対象はiOS 16以降、Android 9以降（API 28以降）のDevelopment Build／配布ビルドです。
AndroidではCredential Managerとパスワード管理サービスを使います。
画面ロックと、利用可能なパスキー管理サービス（Google Password Managerなど）が必要です。
Expo Go、古いネイティブビルド、未対応OS、Webにはパスキーの操作を表示しません。
各OSの既存の認証方法は引き続き利用できます。

## Supabaseの設定

Supabase Dashboard → Authentication → Passkeysで次を設定します。

| 設定 | 値 |
| --- | --- |
| Enable Passkey authentication | オン |
| Relying Party Display Name | `MyDesk` |
| Relying Party ID | `mydesk.page` |
| Relying Party Origins | `https://mydesk.page`と、Androidの署名証明書から作るapp origin（後述） |

RP IDは登録後に変更しないでください。変更すると既存のパスキーが使えなくなります。
別のRP IDで運用済みの場合は設定を上書きせず移行を検討してください。
SupabaseのパスキーAPIは実験的機能です。既存の`supabase-js`は対応しており、
クライアントで`experimental: { passkey: true }`を指定しています。
独自のDBテーブルや秘密鍵のアプリへの保存は不要です。

## Androidのドメイン関連付け

共有ページWorkerの`/.well-known/assetlinks.json`が次の関係を配信します。

- `delegate_permission/common.handle_all_urls`（App Links）
- `delegate_permission/common.get_login_creds`（パスワード・パスキーの共有）

Workerの既存設定`ANDROID_SHA256_FINGERPRINT`に、実際に端末へインストールするアプリの
署名証明書のSHA-256フィンガープリントを設定します。複数の証明書はカンマ区切りで指定できます。
Google Play配布版はPlay Consoleのアプリ署名鍵の証明書を使います。アップロード鍵とは別です。
EASの開発／内部配布ビルドを試す場合は、そのビルドに使う署名証明書も追加してください。
証明書自体や秘密鍵をアプリへ埋め込む必要はありません。

同じ証明書のSHA-256を、区切りなしの32バイトからbase64url（パディングなし）へ変換して、
`android:apk-key-hash:`を付けた値もSupabaseのRelying Party Originsへ追加します。
次のコマンドの引数には、証明書の完全なSHA-256フィンガープリントを渡してください。

```bash
node -e "const hex=process.argv[1].replace(/:/g,''); if(!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Expected a full SHA-256 fingerprint'); console.log('android:apk-key-hash:'+Buffer.from(hex,'hex').toString('base64url'))" "実際のSHA-256フィンガープリント"
```

`https://mydesk.page`はiOS用に残し、Androidの開発・配布で使う署名ごとのoriginを追加します。
Supabaseの許可originは最大5件です。不要な署名やワイルドカードは追加しません。
関連付けは`https://mydesk.page/.well-known/assetlinks.json`から、リダイレクトなしの
HTTP 200・`Content-Type: application/json`で取得できる必要があります。
Workerの変更を公開した後、関連付けのキャッシュが残る場合はアプリを再インストールして確認してください。

Expo SDK 54の既存Android設定はcompileSdk 36なので、追加のビルド設定プラグインは不要です。

## iOSの関連付けと各OSのビルド

`app.json`の`webcredentials:mydesk.page`と、共有ページWorkerの
`/.well-known/apple-app-site-association`にある`webcredentials.apps`を利用します。
公開中のAASAに正しいApple Team IDと`com.ash462031.mydesk`が含まれていることを確認してください。

Supabaseと各OSのドメイン関連付けの準備後、ビルド時の環境変数に次を設定します。

```dotenv
EXPO_PUBLIC_PASSKEY_ENABLED=true
```

`react-native-passkeys`を追加しているため、対象OSのネイティブビルドを作り直します。

```bash
npx eas-cli build --platform ios --profile development
npx eas-cli build --platform android --profile development
```

既存ビルドへのOTA Updateだけではネイティブモジュールは追加されません。
runtimeVersionは`fingerprint`方式で、ネイティブ構成の違うビルドとUpdateを分離します。
各OSの新しいネイティブビルドが必要で、BuildとUpdateには同じネイティブ依存・設定を使ってください。
公開前は`EXPO_PUBLIC_PASSKEY_ENABLED=false`または未設定にして入口を非表示にできます。

## 実機確認

1. Apple・Google・メールのいずれかで確認済みアカウントへログインする。
2. 設定からパスキーを登録し、認証をキャンセルした場合にも登録成功にならないことを確認する。
3. ログアウト後、メール・パスワードを入力せずパスキーで同じアカウントへログインする。
4. 設定から登録解除し、そのパスキーがログインに使えなくなることを確認する。
5. 未対応端末・古いビルド・Expo Goで既存の認証を利用できることを確認する。
6. Androidでは指紋認証／画面ロック、キャンセル、パスキー未登録、管理サービス未設定を確認する。
7. 開発ビルドとGoogle Play配布版の両方で、証明書に対応するoriginで認証できることを確認する。

参考: [Supabase Passkeys](https://supabase.com/docs/guides/auth/passkeys)、
[react-native-passkeys](https://github.com/peterferguson/react-native-passkeys)、
[Android Digital Asset Links](https://developer.android.com/identity/credential-manager/prerequisites)。
