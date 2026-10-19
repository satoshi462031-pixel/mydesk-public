# ガジェット利用統計（/admin/gadgets）

四半期ごとに公式Xで「ガジェット選びの参考情報」を発信するための、運営者向け分析。
レビューでも広告でもなく、MyDesk に記録された導入・撤去・構成・接続データを集計する。

**アプリ利用者への追加の操作・質問・同意要求は一切無い。** 公開デスクに既に含まれている
情報を集計し、公開時にスナップショット保存時刻を1つ増やすだけ。

2026-08-29 時点では母数不足で、公開できる数値はまだ無い。

---

## 表現の制約（最重要）

このデータから分かるのは「MyDesk へ**記録された**在籍期間・構成・接続」だけ。

| 言ってよい | 言ってはいけない |
|---|---|
| デスクに登録されていた期間 | 実際に使われた期間 |
| 記録上の在籍継続率 | 寿命・耐久性 |
| 公開デスク内での併用率 | 市場全体のシェア |
| 記録された接続構成 | 推奨構成 |

在籍期間を「使われた期間」に読み替えないこと。デスクに置きっぱなしの機器と
毎日使う機器が同じ数字になる。使用頻度・満足度・撤去理由・故障率は**取得していない**。

---

## 母集団

`desks.visibility = 'public'` のみ。非公開デスクの機器は DB に存在しない。
**公開する気のある人だけが入る選択バイアスがある**ので、画面にも投稿文にも明記する。

## データ源（用途ごとに違う）

| 用途 | 源 | 理由 |
|---|---|---|
| 現在のデスク構成・共在分析 | `devices` | publish 時点のスナップショット |
| 直接接続 | `connections` | 同上 |
| 在籍期間・撤去イベント・productId | `desks.share_snapshot` | ↓ |

**`devices` を在籍期間の正本にしてはいけない。**
`publishService.ts` は `selectedGadgetIds` に残っている機器だけを `p_devices` へ送るため、
デスクから外した機器は `devices` に行ごと残らない。実データでも `removed_at` は 0/86 だった。

`share_snapshot` は `{ version, snapshotCapturedAt, plan, gadgets }` で、`gadgets` は
撤去済みを含む `historyGadgets`。各要素が `deskUsagePeriods`（`{mode, startedAt, endedAt?}` の配列）と
`productId` を持つ。期間の正本は `gadgets[*].deskUsagePeriods`（`applyDeskGadgetUsage` で正規化済み）で、
`plan.gadgetUsage` は照合用。

### snapshotCapturedAt（version 3）

publish のたびに `new Date().toISOString()` を書く。**継続中の利用期間の「いつまで観測できていたか」
を確定するための唯一の値。**これが無いと在籍継続率は推測を含む。

代用が効かない理由：

- `desks.updated_at` は publish 以外に**非公開化・再公開・メタデータ更新でも変わる**
  （`unpublishPlan` は `updateDesk(visibility:'private')` を呼ぶだけ）
- `share_snapshot.plan.updatedAt` はプランの最終編集日時。編集せず再公開すると据え置かれる
- `desk_versions` は総額と台数が前回から変わらないと追加されず、保存件数上限が tier 依存
  （Pro のほうが長く残る＝系統バイアス）、fire-and-forget、非公開化・再公開では追加されない

version 2 以前の公開デスクは `snapshotCapturedAt` を持たない。**再公開されると version 3 になる**ので、
時間とともに解消する。それまでは上の2候補で計算した感度差だけを画面に出し、公開候補にはしない。

---

## 指標と計算定義

`supabase/migrations/043_gadget_insight_stats.sql` と、ゲート判定を直した `044_gadget_insight_gate_fix.sql`。

- **`admin_gadget_data_quality()`** — 母集団・snapshot 内訳・期間の内訳・停止条件の判定。
  推論を含まないので MIN_SAMPLE のゲートを掛けない
- **`admin_gadget_tenure_by_category(p_censor_source)`** — カプラン・マイヤー。
  既定は `'captured'`（`snapshotCapturedAt`）。`'plan'` / `'desk'` は旧データ用の代用
  - 観測単位は**初回 active 期間**（`period_index = 1`）。decor と再導入は含めない
  - `endedAt` があればイベント、無ければ右打ち切り
  - **打ち切り観測も打ち切り時点まではリスク集合に含める**（`days >= t`）
  - `S(t) = Π(1 - d_i/n_i)`。中央値は S(t) が初めて 0.5 以下になる時点、到達しなければ「未到達」
  - 異常値（開始欠損・逆転・未来日・20年超）は除外し、件数を返す
  - `censor_exact` で「継続中の観測すべてで最終観測日時を確定できたか」を返す
- **`admin_gadget_cooccurrence()`** — 同じデスクに登録されているカテゴリペア。源は `devices`
- **`admin_gadget_connections()`** — 直接つながっているカテゴリペア。源は `connections`。無向に正規化
- **`admin_gadget_tenure_by_price_band(p_censor_source)`** — 価格帯クロス（打ち切り込みの単純中央値なので参考値）

判定はすべて**ユニーク所有者数**で行う。`MIN_SAMPLE = 30`、未満は `ready: false`。

### 公開してよい条件

Worker（`gadgetInsights.ts`）が `publicationReady` を返す。true になるのは
**`ready` かつ `censor_exact` のカテゴリが1つ以上あるとき**だけ。
該当カテゴリだけが X 投稿候補に入り、行に `*` が付いたカテゴリ（最終観測日時が不明な観測を含む）は
公開候補にしない。共在率・接続構成は打ち切り日時に依存しないので、サンプル条件だけで判定する。

### 撤去日の精度

`updateDeskGadgetSelection` が入れる `endedAt` は**操作日**であって実際の撤去日ではない。
まとめて整理した日に一斉に同じ撤去日が付くため、KM の event time に系統誤差が乗る。
`DeskGadgetUsagePeriod.startedAtSource` / `endedAtSource`（`'auto' | 'manual'`、未設定は `'auto'`）で
手入力と区別し、データ品質に `ended_at_auto` / `ended_at_manual` として件数を出す。

---

## 運用手順

### 初回セットアップ

```
# CLI は devDependency にある（グローバル install は不要）。プロジェクトはリンク済み。
npx supabase db push --dry-run   # 何が適用されるか先に確認する
npx supabase db push             # 適用（本人が実行）

cd worker && npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

集計 RPC は `service_role` にのみ GRANT してあるため anon キーでは叩けない（029 の方針を維持）。
未設定のあいだ `/admin/gadgets` は 503 を返し、他のページには影響しない。

### 定期確認

```
npm run audit:public-desks
```

`/admin/gadgets` と同じ RPC を叩く読み取り専用スクリプト。停止条件の判定まで出す。
出力に `user_id` / `desk_id` / デスク名 / ガジェット名は含まれない。

### 検証

```
npx tsc --noEmit
npm run test:all
cd worker && npm run dev   # /admin/gadgets を目視
```

KM の境界値は `supabase/tests/043_tenure_boundaries.test.sql`（ローカル/ブランチDBで手動実行、
`BEGIN 〜 ROLLBACK`）。全件イベント／全件打ち切り／中央値未到達／29人と30人／
decor・再導入・Cable 除外／snapshotCapturedAt の有無を固定している。

---

## 2026-08-29 時点の状況

Step 0 監査の結果、停止条件に該当している。

- 公開デスク 6 件 / ユニーク所有者 3 人（実質テストデータ）
- `share_snapshot` は全件 version 1（期間履歴・productId を持たない）
- 終了済み active 期間 0 件

**設計の欠陥ではない。** 撤去イベントの記録機構は `updateDeskGadgetSelection` に既にあり、
デスクから外した時点で `endedAt` を書き込む。0 件なのは本番の公開デスクが
この仕組み以前に publish されたものだけだから。次の publish で version 3 になる。

再開の条件：ユニーク所有者 30 人以上／終了済み active 期間が存在する／
期間の観測が1件以上あり、そのすべてに `snapshotCapturedAt` がある
（044 で「観測0件なら条件を満たしていない」に直した。観測が無い状態を
「条件クリア」と表示すると、母数が育ったかの確認に使えなくなるため）。最短でもストア公開後6か月以降。
初回の四半期発信は継続率ではなく共在率・構成比から始める。
