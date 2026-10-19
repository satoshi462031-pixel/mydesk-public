# ガジェット利用統計 Phase B: 日付精度と共有スナップショット v3

## 目的

ガジェット利用期間の日付を「実際の導入・撤去日」として扱える範囲を明示し、継続中期間の打ち切り日を再現可能にする。日付の由来や観測終了時点を復元できないデータは、管理者向け参考値と外部公開可能な正式指標に分ける。

この設計の実装はアプリ本体の変更を伴うため、App Store 審査提出後に着手する。Phase B 着手前には型、保存処理、履歴編集 UI、共有スナップショット生成・読込、集計処理を変更しない。

## 現状の制約

- `updateDeskGadgetSelection` は選択解除時に `endedAt = changedAt` を保存する。これは操作日であり、実際の撤去日とは限らない。後日まとめて整理すると複数機器に同じ日が付く。
- `DeskUsageHistoryEditor` では日付を手入力できるが、保存後は自動入力値とユーザーが確認・修正した値を区別できない。
- `share_snapshot` に観測時点がない。終了日のない継続中期間をいつ打ち切って集計したか確定できず、同じスナップショットから同じ生存時間を再計算できない。

## 決定 1: 利用期間に日付の出所を保存する

`DeskGadgetUsagePeriod` に次の任意フィールドを追加する。

```ts
export type DeskGadgetUsageDateSource = 'auto' | 'manual'

export interface DeskGadgetUsagePeriod {
  mode: DeskGadgetUsageMode
  startedAt: string
  startedAtSource?: DeskGadgetUsageDateSource
  endedAt?: string
  endedAtSource?: DeskGadgetUsageDateSource
}
```

意味は次のとおりとする。

- `auto`: 選択追加・解除などのアプリ操作時に、アプリが操作日を設定した。物理的な導入日・撤去日が確認済みであることは意味しない。
- `manual`: ユーザーが履歴編集 UI でその日付を新規入力、または明示的に変更した。ユーザー申告値であり、外部証憑による検証済みを意味しない。
- フィールド欠落: 旧データで出所不明。永続化する列挙値に `unknown` は追加せず、欠落を後方互換上の不明値として扱う。

保存規則は以下に固定する。

1. 選択追加で新しい期間を作る場合、`startedAtSource = 'auto'` とする。
2. 選択解除で継続中期間を閉じる場合、`endedAtSource = 'auto'` とする。
3. 同日中の選択解除を取り消して `endedAt` を消す場合、`endedAtSource` も同時に消す。
4. 履歴編集 UI で新規入力した日付、または既存値から変更した日付だけを `manual` にする。画面を開いて値を変えずに保存しただけでは、既存の `auto` または欠落を `manual` に昇格させない。
5. 日付を消す場合は対応する source も消す。`endedAt` がない期間に `endedAtSource` だけを残さない。
6. 期間の mode だけを変更しても日付 source は変更しない。

### 既存データと後方互換

- 既存の `periods`、および `introducedAt` / `removedAt` や Gadget の日付から生成される旧形式期間は、source 欠落のまま読み込む。根拠なく `auto` または `manual` へ一括補完しない。
- source フィールドは任意とし、旧クライアントが保存した JSON と旧 `share_snapshot` を引き続き読めるようにする。
- 新クライアントは新規・変更した日付にだけ source を保存する。既存期間の無関係な編集や正規化で source を失わない。
- `introducedAt` / `removedAt` は現行の後方互換用途を維持するが、統計上の出所判定には使わない。判定元は各 period の source とする。
- source が欠落した日付は表示・タイムライン用途には従来どおり利用できるが、正式指標では「出所不明」として除外または別集計する。

## 決定 2: `share_snapshot` を version 3 にする

新規公開・再公開時の形式を次に変更する。

```ts
interface ShareSnapshotV3 {
  version: 3
  snapshotCapturedAt: string
  plan: DeskPlan
  gadgets: Gadget[]
}
```

- `snapshotCapturedAt` はスナップショット内容を組み立てた時点の UTC ISO 8601 日時とする。例: `2026-08-29T03:45:12.345Z`。
- 1 回の公開処理では最初に一度だけ値を生成し、その処理中の全保存箇所で同じ値を使う。公開完了後に保存された v3 を、その公開時点の観測スナップショットとみなす。
- KM 集計では `snapshotCapturedAt` を対象デスクの観測終了時点とし、`endedAt` のない期間をこの時点で右打ち切りする。日単位への変換ルールとタイムゾーンは集計処理側で固定し、結果メタデータにも残す。
- 読込側は version 1、2、3 を受け入れる。version 1 / 2 または version 欠落データでは `snapshotCapturedAt` を未取得として扱い、`desks.updated_at` などで黙って補完しない。
- v3 への更新は再公開時に行う。既存 `share_snapshot` の一括書換えや推定時刻によるバックフィルはしない。
- JSON 内の形式変更であり、本設計段階では migration を追加しない。実装時に DB 制約が必要と判断した場合は、App Store 審査提出後の別変更として扱う。

## 指標の区分

### 両方の導入後に可能になる分析

- `manual` と `auto` を分けた導入日・撤去日分布、および source 構成比
- source 別、利用 mode 別、ガジェットカテゴリ別の利用期間分布
- v3 スナップショット時点で継続中の期間を右打ち切りにした Kaplan–Meier（KM）推定
- 手入力日だけに絞った KM と、自動日を含む KM の感度分析
- 実撤去日候補ではなく操作日に集中した同日大量撤去の検出と、集計への影響診断
- 同一データ・同一 `snapshotCapturedAt` からの再現可能な集計

`startedAtSource` / `endedAtSource` は日付の由来を表し、日付の正しさそのものを保証しない。したがって `manual` と `auto` を混ぜた結果は、混在条件を明記した参考値として扱う。

### 導入前、または片方しか導入されていない間は正式に出さない指標

- 出所別の導入・撤去傾向
- 「実際の撤去日」に基づくと表現した平均・中央値・分位点
- 観測終了時点を必要とする継続中期間込みの KM 曲線、KM 中央値、一定期間継続率
- source 不明の旧データを source 既知データと同品質として混ぜた比較
- `plan.updatedAt` または `desks.updated_at` を打ち切り日として作った外部公開用の利用期間指標

件数、現時点の構成、終了済み期間だけの単純記述統計は算出できる。ただし期間選択バイアスと日付出所不明を明記し、KM や母集団の継続率の代替とはしない。

## KM 参考値と `publication_ready`

集計結果には少なくとも `publication_ready: boolean`、除外理由、対象件数、イベント件数、打ち切り件数、source 別件数、対象 snapshot version を残す。

正式な X 投稿用 KM は、次をすべて満たす場合だけ `publication_ready = true` とする。

1. 対象が version 3 の `share_snapshot` で、有効な `snapshotCapturedAt` を持つ。
2. 各観測の `startedAtSource` が既知である。
3. 終了イベントとして扱う観測は `endedAtSource` が既知である。
4. 日付順序が妥当で、開始日が観測終了日を超えず、終了日が開始日より前でない。
5. 掲載時に対象範囲、source の採用条件、母数、イベント数、打ち切り数、集計基準日を明示できる。

`manual` のみを採用した推定を正式な「利用期間」KM の標準とする。`auto` を含む推定は操作日ベースであることを明記した感度分析または KM 参考値とし、単独では `publication_ready = true` にしない。

`snapshotCapturedAt` のない既存データは、正式な X 投稿用 KM に使用しない。`plan.updatedAt` や `desks.updated_at` を観測終了日の代理にした推定は、管理者向け診断値に限定し、常に `publication_ready = false` とする。これらの推定値には `censoring_time_source` を付け、`snapshotCapturedAt` を使った値と混同しない。

管理者向け診断では、次の階層を区別する。

- `publication_ready`: v3 の確定した観測時点と、正式採用条件を満たす source 既知の日付だけを使用
- `reference`: v3 だが `auto` を含む、または source 条件を緩めた参考値
- `diagnostic_estimate`: v1 / v2 に対して `plan.updatedAt` や `desks.updated_at` を推定打ち切り日に使う内部診断値

階層をまたいだ値の結合や、`diagnostic_estimate` から `publication_ready` への自動昇格は行わない。

## 着手順序

App Store 審査提出後、次の順で実装する。

1. `DeskGadgetUsagePeriod` と履歴編集 draft に source を追加し、自動操作・手入力・取消時の保存規則をテストする。
2. 既存データの source 欠落を維持したまま読込・再保存できる後方互換テストを追加する。
3. `share_snapshot` v3 と `snapshotCapturedAt` を公開・読込処理へ追加し、v1 / v2 / v3 の互換テストを追加する。
4. 集計処理に品質階層と `publication_ready` 判定を実装し、推定打ち切り日が外部公開経路へ流れないことをテストする。

