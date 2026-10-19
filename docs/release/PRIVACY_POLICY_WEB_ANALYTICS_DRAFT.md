# プライバシーポリシー追記案：ウェブサイトの利用状況の計測（下書き）

2026-10-15 作成。**2026-10-15 に本文（`landing/lib/legal.tsx` の ja・en と `docs/release/PRIVACY_POLICY_JA.md`）へ反映済み。** 残りは下の「計測を始める手順」の 2 以降。

## なぜ追記が要るか

- アプリの計測は「設定で有効にした人だけ」（オプトイン）。今のポリシーもそう書いてある。
- Web（LP・公開デスク・みんなのデスク・プロフィール）の計測は、同意を取らずに送る（オプトアウト型）。
  アプリと扱いが違うので、Web の分をはっきり分けて書く。書かないと、「同意した場合だけ」という今の記載と食い違う。
- Web の計測は Cookie もローカルストレージも使わず、ページを開くたびに作り直す乱数しか持たない。
  通信は自分のドメイン（mydesk.page/api/events）へ送り、運営者のサーバー（Cloudflare Workers）が
  IP アドレス・端末の情報を落としてから PostHog へ渡す。ブラウザから PostHog へ直接は送らない。
- 送るのは `worker/src/webEvents.ts` の `EVENTS` に書いた項目だけ。ポリシーの列挙はこの表と一致させる。

| イベント | 中身 |
|---|---|
| `web_page_viewed` | ページの種類（LP・公開デスク・プロフィール・みんなのデスク・規約類）、公開デスクの ID、言語、画面幅の区分（スマホ／PC）、参照元のホスト名（入ってきた最初の1枚だけ）、URL の utm_source・utm_medium・utm_campaign |
| `web_app_link_tapped` | 押した導線の置き場所（例：public_desk_clap）、行き先の区分（アプリ・App Store・リリース通知）、上と同じページの情報 |
| `web_desk_shared` | 共有の方法（共有シート・リンクのコピー）、上と同じページの情報 |

送らないもの：IP アドレス、地域、User-Agent、Cookie、URL の全体、参照元のパスと検索語、検索窓に入れた語、メールアドレス、プロフィールの ID。
ブラウザが GPC（Global Privacy Control）か Do Not Track を出しているときは送らない。

## 反映する場所

### 1. Web 版（`landing/lib/legal.tsx` の ja「3. 利用状況の分析と送信の停止」の末尾に段落を足す）

> ウェブサイト（mydesk.page。公開デスク、プロフィール、みんなのデスクを含みます）では、サイトの改善と、アプリへの案内がどれだけ使われているかの把握のため、閲覧したページの種類、公開デスクのID、表示言語、画面幅の区分（スマートフォンまたはパソコン）、参照元のドメイン名、URLに含まれる流入元の指定（utm_source等）、アプリ・App Store・リリース通知への案内および共有ボタンが押されたことを記録し、運営者のサーバーを経由してアクセス解析サービス（PostHog）へ送信します。
>
> この記録にはCookieおよびブラウザのローカルストレージを使用しません。記録をまとめるための識別子は、ページを開くたびに新しく作る乱数で、保存せず、利用者個人やアカウントとは結び付けません。IPアドレス、地域情報、ブラウザの種類などの接続元の情報は、運営者のサーバーで取り除いてから送信します。検索欄に入力した語句、参照元ページのURLの全体およびメールアドレスは送信しません。
>
> ブラウザでGlobal Privacy ControlまたはDo Not Trackを有効にしている場合、この記録は送信しません。

同じ節の見出し直後の段落（「本アプリは、利用者が設定画面で明示的に有効にした場合に限り…」）は**アプリの話**なので、頭に「アプリでは、」と足して、Web の段落と取り違えないようにする。

「5. 外部サービスの利用」の一覧の1行を差し替える：

- 変更前：`利用状況の分析（PostHog）`
- 変更後：`利用状況の分析（PostHog。アプリは設定で有効にした場合のみ、ウェブサイトは3.に記載の範囲）`

同じ節の Cookie の段落（「関連ウェブサイトは、テーマ設定等のためローカルストレージを利用し…」）の後に1文足す：

> ウェブサイトの利用状況の記録には、Cookieおよびローカルストレージを使用しません。

### 2. Web 版の英語（`landing/lib/legal.tsx` の en「3. Usage analytics and how to turn it off」）

> On our website (mydesk.page, including public desks, profiles, and Explore), we record the type of page viewed, the public desk ID, the display language, a screen-size category (phone or computer), the referring domain name, campaign parameters in the URL (such as utm_source), and whether links to the App, the App Store, launch updates, or the share button were used. We send this record through our own server to PostHog to improve the website and understand how often people move from the website to the App.
>
> This record uses no cookies and no browser local storage. The identifier that groups events is a random value created each time a page is opened; it is not stored and is never linked to you or to an account. Our server removes your IP address, location, browser type, and other connection details before sending. We do not send search terms you type, full referring URLs, or email addresses.
>
> If your browser has Global Privacy Control or Do Not Track enabled, this record is not sent.

見出し直後の段落の頭に "In the App, " を足す。外部サービスの一覧は
`Usage analytics (PostHog; in the App only when enabled in Settings, and on the website as described in section 3)` に差し替える。

### 3. 原本（`docs/release/PRIVACY_POLICY_JA.md`）

- 3.6 の末尾に「#### ウェブサイトでの利用状況の記録」として、上の 1. の3段落と同じ内容を足す。
- 5. Cookie の2項の後に「3. ウェブサイトの利用状況の記録には、Cookieおよびローカルストレージを使用しません。」を足し、以降の番号を繰り下げる。
- 7. の PostHog の用途を「利用状況分析（アプリは利用者が有効にした場合のみ。ウェブサイトは3.6に記載の範囲）、品質改善およびエラー傾向の把握」にし、主な情報に「ウェブサイトでは、ページを開くたびに変わる乱数の識別子、閲覧したページの種類および案内リンクの利用」を足す。

### 4. 最終更新日

`landing/lib/legal.tsx` の `LAST_UPDATED` を反映した日に替える。

## 計測を始める手順（ポリシーを公開した後）

1. 上の追記を本文に反映し、landing をデプロイする。
2. PostHog のプロジェクトトークン（`phc_…`。アプリの `EXPO_PUBLIC_POSTHOG_KEY` と同じプロジェクト）を worker に入れる：
   `cd worker && npx wrangler secret put POSTHOG_PROJECT_TOKEN`
   入れるまでは `/api/events` が 503 を返し、何も送らない。
3. PostHog で `platform = web` のイベントが届いているかを確かめる。

App Store の置き場所ごとの計測（`ct`）は別の作業：`landing/lib/site.ts` の `APP_STORE_PROVIDER_ID` に、
App Store Connect のプロバイダ ID を入れる（空のうちは ct を付けても数えられない）。ストアに出る段階（`RELEASE_PHASE` が
preorder 以降）まではリンク自体がリリース通知へ向くので、それまでに入れておけばよい。
