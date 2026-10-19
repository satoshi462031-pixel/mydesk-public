# URL限定公開の内部実装

## 仕様

- URLを持つ人がログインなしで閲覧できる。所有者以外への編集権限は付与しない。
- 有効期限はない。公開停止・URL再発行・限定公開から他の公開範囲への変更で共有IDを失効させる。
- 端末で編集した内容は自動反映しない。既存の公開処理で保存したスナップショットを表示し、明示的な更新で反映する。内容更新だけでは共有IDを変更しない。
- 一覧・検索・公開プロフィール・公開通知には限定公開を含めない。既存のpublic限定条件を維持する。
- `UNLISTED_PUBLISH_ENABLED = false` を維持し、限定公開の選択と再発行のUIは公開しない。

## 共有リンク

`101_unlisted_share_links.sql` は `unlisted_desk_links` にランダムUUIDの共有IDを保存する。テーブルはRLSを有効にし、anon/authenticatedの直接読み書きを禁止する。共有IDをdesksの列へ追加しないため、通常公開した過去のデスク情報から限定公開のリンクを取得できない。

共有IDはランダムUUIDのバージョン位置を8にし、その形式を実デスクIDとして登録できない制約を追加する。既存アプリの実デスクIDはrandomUUIDで発行するバージョン4。共有IDの所持者による実IDの登録でリンクを別のデスクへ差し替えることを防ぎ、再発行後も旧URLを実IDとして再利用させない。

既存のUUID・短縮UUIDルートを使用する。通常公開はデスクID、限定公開は共有IDをURLへ入れる。リンク閲覧とプレビューのRPCは限定公開を共有IDでのみ解決し、実デスクIDでの閲覧を拒否する。本文の実IDを知っても再発行後の共有IDは取得できない。

所有者は実IDから現在の共有IDを取得できる。共有IDを持つ閲覧者はそのリンクを再共有できる。停止後に限定公開を再開すると新しい共有IDになる。再発行は所有者を認証し、デスク行をロックして公開範囲の変更と直列化する。

内部APIは `src/services/deskShareLinks.ts` にある。

```ts
await setPlanVisibility(planId, 'unlisted')
const url = await getDeskShareUrl(deskId, ownerTag)
const replacementUrl = await reissueUnlistedDeskUrl(deskId, ownerTag)
await unpublishDesk(deskId)
```

`setPlanVisibility` と `unpublishDesk` は `publishService.ts` の既存API。新しく作るデスクは `publishPlan` の `visibility: 'unlisted'` を使用する。再発行の応答を失った場合は、再発行を繰り返さず `getDeskShareUrl` で現在のURLを取得する。

コピー・共有・公開デスク管理からのWeb閲覧は現在の共有IDを取得する。Webの「アプリで開く」もURLの共有IDを引き継ぐ。限定公開の取得結果は先読みキャッシュへ保存しない。

## 検索掲載

Workerの `SHARED_PAGE_INDEXING_ENABLED = false` により、デスク・公開プロフィールの共有ページを `noindex, nofollow` にする。限定公開URLはサイトマップへ追加しない。静的Webページにもnoindexを設定する。

将来、通常公開ページを検索対象にするときはこの定数をtrueへ変更する。通常公開をRLSで確認できたデスクと公開プロフィールだけが対象になり、限定公開は引き続きnoindexになる。共有ページは `Cache-Control: no-store` と `Referrer-Policy: no-referrer` を返し、Workerのエラーログへ共有ID・URL・応答本文を出さない。

noindexは閲覧権限の制御ではない。URLの再共有は可能で、閲覧済みの画面・写真や外部サービスが保存したコピーは回収できない。

## 適用と確認状況

ローカルのソース実装のみ。本番DBへの適用とデプロイは未実施。

先行する100までのマイグレーションを適用したうえで101を適用し、アプリ・Web・Workerを反映する。101の適用により、既存の限定公開の実デスクIDリンクは失効するため、所有者は新しいURLを共有し直す必要がある。通常公開のURLは変わらない。

新RPCがまだないDBでは、通常公開と確認できたデスクだけ従来のURLで共有する。限定公開は失敗として扱い、実IDのリンクを発行しない。

アプリ・Web・WorkerのTypeScript型チェックは通過。差分の書式を確認した。テストは追加・実行していない。SQLの実行、実DBのRLS、実機の共有操作は未検証。

参照: [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)、[PostgreSQL UUID Functions](https://www.postgresql.org/docs/current/functions-uuid.html)。
