# 改善候補ログ

品質・保守性の改善候補を「問題 → 仮説 → 優先度 → 実装 → 検証」の順で残す台帳。
全部を実装するための一覧ではない。見つけたものを捨てずに置き、優先度で順に拾う。

- セキュリティ観点の監査は `SECURITY_AUDIT.md`（2026-08-24）が正本。ここには重ねて書かず、
  未対応の項目だけ参照を置く。
- Priority は Impact（利用者・開発への影響）× Probability（問題になる可能性）÷ Cost（直す手間）で付ける。
- Status: `TODO` / `DOING` / `DONE` / `REJECTED`（やらないと決めたものも理由つきで残す）

---

## EI-01 配線の経路が接続の並び順で変わる

- **Problem**: `computeMapLayout` は同じ集合の接続でも、配列の並び順が違うと線の経路（折れ点）が変わる。
  ノードの位置は変わらない（`tests/mapLayoutInvariants.test.ts` で固定済み）。
  デモデスク3件中2件（ゲーミング・音楽）で再現する。線は先に並んだものから順に通り道を確保するため。
- **User impact**: 何も変えていないのに配線図の線の取り回しが変わって見える可能性がある。
  ただし現状、接続は `plan.connectionMap.connections` に保存された順で渡るため、並びが変わるのは
  手で線を足す・消すなど本人が編集したときに限られる。実害は確認していない。
- **Technical impact**: 「決定論的」の範囲が「同じ配列なら同じ結果」までで、「同じ集合なら同じ結果」ではない。
  接続の並びを変える処理（同期・並べ替え）を将来足すと、レイアウトのキャッシュは効くのに見た目が揺れる。
- **Proposed solution**: ルーティングに入る前に接続を安定した鍵（種別の優先度 → id）で並べ直す。
  ただし経路の見た目が全デスクで変わるので、`audit:layout-compare` で線の長さ・交差数が悪化しないことを
  確かめてから入れる。
- **Priority**: Low（Impact: Low / Probability: Low / Cost: Medium）
- **Status**: TODO
- **Result**: —

## EI-02 アプリ・worker・LP の3箇所の整合を CI で確かめられない

- **Problem**: `tests/siteRoutes.test.ts` の3件は worker / landing の中身を読んで、サイト自身のパスの一覧が
  3箇所で揃っているかを見る。worker / landing は非公開の submodule で、アプリの CI は取得しないため、
  CI ではこの3件を skip している（手元では走る）。
- **User impact**: LP に新しいページを足して一覧を直し忘れると、そのページが `@同名` の人のプロフィールとして
  読まれて届かなくなる。手元で `npm run check` を通さずに push した場合だけ見逃す。
- **Technical impact**: CI が緑でも3リポジトリ間のずれは保証しない。
- **Proposed solution**: worker / landing を読める fine-grained personal access token（contents: read のみ）を
  アプリのリポジトリの secret に置き、`actions/checkout` で `submodules: recursive` と `token` を渡す。
  トークンの作成と登録は本人の作業（期限切れの更新も要る）。
- **Priority**: Medium（Impact: Medium / Probability: Low / Cost: Low、ただしトークンの管理が増える）
- **Status**: TODO
- **Result**: 当面は理由つき skip で CI を通す（2026-09-30）。

## EI-03 配線図の計算が遅い（10〜30台で手元の Node でも1.5〜4秒）

- **Problem**: `computeMapLayout` の時間のほぼ全部が格子上の A* 経路探索（`routeCells`）。
  1回の図で数百回の探索・数百万回の取り出しをしている。計測と内訳は `docs/perf/layout-benchmark.md`。
- **User impact**: 実機（Hermes）は Node の数倍遅いため、現実的な規模のデスクでも図が出るまで数秒〜十数秒待つ見込み。
  ガジェットの追加や線の編集のたびに計算し直す。画面は固まらない（12ms ごとに制御を返す）が、待ちは長い。
- **Technical impact**: 事前計算（warmup）を30台で打ち切る、オンボーディングの図を焼き込む、などの回避策が
  すでに積み重なっている。計算を足すたびに遅くなる方向の圧力がある。
- **Proposed solution**:
  1. （DONE）出力を変えずに探索1回のコストを下げる → 約4割短縮
  2. （DONE）探索の量を減らす：同じマス・同じ向きで曲がりもコストも劣る状態を捨てる（`LAYOUT_VERSION` 49）
  3. （TODO）実機の `[perf] layout` ログで、Hermes 上の実時間を測って、さらに削る必要があるか決める
     （開発ビルドで配線図を開くと、`npm start` を走らせたターミナルに `[perf] layout N台 M本: Xms` が出る）
  4. （候補）最初の配線で端点の組み合わせを最大8通りすべて探索している。見つかった経路より良くなりえない
     組み合わせを打ち切る。線の形が変わる
- **Priority**: High（Impact: High / Probability: High / Cost: Medium）
- **Status**: DOING
- **Result**: 1 で約4割、2 でさらに短縮。基準値から、10台 1,555 → 484ms（69%短縮）、30台 4,159 → 1,750ms（58%）。
  1 は出力が完全一致。2 は線の形が一部変わるが、配線の監査で指摘が減り（交差・重なり・貫通が減少）、
  曲がりが 4.6% 増えた。詳細は `docs/perf/layout-benchmark.md`。

---

# 2026-09-30 技術的負債の調査（Phase 9）

調べた範囲：巨大化・重複・UI とロジックの結合・RN 依存の混在・any・エラー処理・再レンダリング・
N+1・セキュリティ（RLS・公開変数・依存の脆弱性）・変更しにくい設計。
既存の `SECURITY_AUDIT.md`（2026-08-24）の未対応項目は、状態を測り直して下に取り込んだ。

| ID | 項目 | Impact | Probability | Cost | Priority | Status |
|---|---|---|---|---|---|---|
| EI-03 | 配線図の計算が遅い | High | High | Medium | **High** | DOING |
| EI-04 | LAYOUT_VERSION の上げ忘れ・焼き直し忘れ | High | High | Low | **High** | DONE |
| EI-05 | マイデスクと公開デスクの画面が別実装で、修正が片方にだけ入る | Medium | High | High | Medium | TODO |
| EI-06 | RLS・Edge Functions の自動テストが無い | High | Low | Medium | Medium | TODO |
| EI-07 | `computeMapLayout` が約4,200行の1関数 | Medium | Medium | High | Medium | TODO |
| EI-08 | フックの依存配列の検査を29箇所で止めている | Medium | Low | Low | Low | TODO |
| EI-09 | 依存パッケージの脆弱性 | Low | Low | High | Low | TODO |
| EI-10 | `any` が66箇所 | Low | Low | Medium | Low | TODO |
| EI-11 | Auth / Subscription の Provider が毎回新しい value を渡す | Low | Low | Low | Low | TODO |
| EI-12 | 握りつぶしの catch が208箇所 | Low | Low | — | Low | REJECTED |
| EI-13 | N+1 的な DB アクセス | — | — | — | — | REJECTED（該当なし） |
| EI-14 | 共有ロジックが React Native に依存している | — | — | — | — | REJECTED（解消済み） |

## EI-04 LAYOUT_VERSION の上げ忘れ・焼き直し忘れ

- **Problem**: 配線図の計算を変えたら `LAYOUT_VERSION` を上げ、オンボーディングの図を焼き直す決まりだが、
  人の注意だけで守っていた。CLAUDE.md に「配線バグ調査で最初に疑うべき点」と書かれるほど繰り返し起きている。
- **User impact**: 上げ忘れると、端末に保存された古い配線図が出続ける（直したはずの不具合がリリース後も見える）。
  焼き忘れると、初回起動で見せる図だけが古い。
- **Technical impact**: 「直したのに直っていない」の調査に時間を取られる。
- **Proposed solution**: デモデスクの配線図の出力の指紋を版と組にして `tests/fixtures/layoutSignature.json` に記録する。
  出力が変わったのに版が同じなら `npm run build:onboarding-wiring` が焼かずに止まり、
  焼き直していなければ `tests/layoutVersionGuard.test.ts` が落ちる（CI でも走る）。
- **Priority**: High
- **Status**: DONE
- **Result**: わざと出力を変えて確かめた。版を据え置くとテスト2件が落ち、焼き直しは拒否される。
  版を上げると焼き直せて、テストも通る。Linux の CI でも Windows と同じ指紋になる。
  デメリット：デモデスクのデータだけを変えた場合も版を上げることになる（端末のキャッシュが一度作り直されるだけ）。

## EI-05 マイデスクと公開デスクの画面が別実装

- **Problem**: `WiringResultScreen`（3,474行・useState 55）と `PublicDeskScreen`（1,758行）は同じ形の画面だが
  実装が別々。CLAUDE.md に「片方にだけ入った修正が何度も残っている」とある。上部の収納は
  `useCollapsibleHeader` へ寄せて解消済みで、残りは写真プレビュー・機材一覧・履歴タブ。
- **User impact**: 自分のデスクでは直った表示の不具合が、他人のデスクでは残る。
- **Technical impact**: 修正のたびに2画面を読んで判断する手間。見落とすと上の不具合になる。
- **Proposed solution**: 一度に分割しない。不具合を直すついでに、その役割の部分だけを共通の部品へ移す
  （上部の収納で取ったやり方）。移したら `audit:collapsible-header` のような検査で戻りを止める。
- **Priority**: Medium（発生頻度は高いが、一括の分割はコストと退行の危険が大きい）
- **Status**: TODO

## EI-06 RLS・Edge Functions の自動テストが無い

- **Problem**: RLS の方針はマイグレーションの読み合わせでしか確かめていない。自動テストは関数の実行権限
  （`audit:function-grants`）だけ。Edge Functions（ai-coach / delete-account / notify-followers / revenuecat-webhook）
  にもテストが無い（`SECURITY_AUDIT.md` M-06）。
- **User impact**: 誤った方針が入ると、他人の非公開デスクや持ち物が読める・消せる。起きたときの影響が最も大きい。
- **Technical impact**: マイグレーションを足すたびに手で読み合わせる必要がある。
- **Proposed solution**: ローカルの Supabase（`supabase start`、Docker が要る）に全マイグレーションを当て、
  匿名 / 本人 / 他人の3者で主要テーブルの読み書きを試す表を1本作る。CI で回すかは実行時間を見て決める。
- **Priority**: Medium（Impact は High。今の方針は監査で問題なしとされ、Probability は Low）
- **Status**: TODO

## EI-07 `computeMapLayout` が約4,200行の1関数

- **Problem**: 配置・格子・経路探索・交差の補修が1つの非同期関数の中の入れ子の関数で、外から段階ごとに呼べない。
- **User impact**: 直接は無い。
- **Technical impact**: 段階ごとのテストが書けない（テストは出力の性質で見るしかない＝EI-04 / 不変条件テスト）。
  性能改善も入れ子の中を触ることになる。
- **Proposed solution**: 一括で分けない。EI-03 の次の段（探索量を減らす）で `routeCells` 周りを触るときに、
  格子と経路探索だけを純粋な関数として外へ出し、そこに単体テストを付ける。
- **Priority**: Medium
- **Status**: TODO

## EI-08 フックの依存配列の検査を29箇所で止めている

- **Problem**: `react-hooks/exhaustive-deps` を `eslint-disable` で29箇所止めている。1つずつが「古い値を掴んだまま」の候補。
- **User impact**: 起きると「更新したのに画面が変わらない」。今のところ報告は無い。
- **Proposed solution**: 次に各画面を触るとき、その画面の分だけ理由を読み、意図したものにはコメントを残す。
- **Priority**: Low
- **Status**: TODO

## EI-09 依存パッケージの脆弱性（`SECURITY_AUDIT.md` H-02 の測り直し）

- **Problem**: 2026-09-30 の `npm audit`。アプリ：High 1 / Moderate 10（本番依存では High 1 = `image-size`）。
  worker：High 5 / Moderate 2（本番依存は 0）。landing：High 1 / Moderate 1（`postcss`）。
- **User impact**: 小さい。`image-size` と `postcss` はビルド時に使うもので、アプリや配信されるページの中では動かない。
- **Proposed solution**: 次の Expo SDK の更新（別ブランチ・実機での回帰確認つき）でまとめて上げる。単独では上げない。
  Dependabot は、Expo の依存は揃えて上げる必要があり、1つずつの PR が通らないので今は入れない。
- **Priority**: Low
- **Status**: TODO

## EI-10〜EI-14

- **EI-10 `any` が66箇所（2026-08 の監査時は約116）**：多くはナビゲーションの型。画面を触るときに直す。Low / TODO。
- **EI-11 Provider の value**：`AuthContext` / `SubscriptionContext` は毎回新しいオブジェクトを渡す。
  ただし Provider はアプリの根元にあり、自分の状態が変わったとき以外は描き直されないので、実害は小さい。Low / TODO。
- **EI-12 握りつぶしの catch が208箇所**：`usePlans` / `useGadgets` などで多いのは、保存の順番待ちの鎖が途中の失敗で
  切れないようにするためのもの。失敗は別の経路（`reportFailure`）で画面へ返しているので、数だけでは問題と言えない。REJECTED。
- **EI-13 N+1**：DB アクセスは `services/` にまとまっていて、一覧で1件ずつ問い合わせる箇所は無かった。
  ループ内の逐次処理は写真（最大4枚）・デスク（上限あり）の後片付けだけ。REJECTED（該当なし）。
- **EI-14 共有ロジックの RN 依存**：LP が読む `connectionMapLayout` と `categoryLabels` から、React Native 専用の
  パッケージには辿り着かない（esbuild の依存解析で確認）。LP が Vercel 上で単体ビルドできないのは、
  親リポジトリの `src/` を相対パスで読んでいるため（`docs/deployment.md`）。REJECTED（解消済み）。

### 監査で確認して問題なしとしたもの

- すべてのテーブルで RLS が有効（マイグレーションを走査）。
- `EXPO_PUBLIC_*`（アプリに同梱される値）に秘密鍵は無い。service role や楽天の鍵はスクリプト側だけ。
- Sentry の DSN は EAS の production 環境変数に登録済み（`.env` には無いが、ビルドには入る）。

## EI-15 配線エンジンのカテゴリ × ポートの組み合わせテスト

- **Problem**: `wiringEngine` の判定は実例（デモデスク・監査スクリプトのシナリオ）で確かめているが、
  カテゴリとポートの組み合わせを系統立てて試すテストは無い（README の「優先して追加するテスト」1）。
- **User impact**: 珍しい組み合わせで、繋がるはずの機器が繋がらない・ありえないケーブルを勧める。
- **Proposed solution**: `audit:connectivity` などの監査スクリプトが既に総当たりに近いことをしている。
  新しいテストを書く前に、その監査を CI で走らせられる時間か測り、走らせられるならテストへ昇格させる。
- **Priority**: Medium
- **Status**: TODO

## EI-16 画面の操作テスト・公開ページの E2E

- **Problem**: 画面の保存・破棄・オフライン操作、公開ページと待機リストを通しで試すテストが無い（README の 4・5）。
- **User impact**: 画面の退行は実機確認でしか見つからない。
- **Proposed solution**: 今は入れない。React Native の画面テストは Expo 54 / RN 0.81 と組む設定コストが高く、
  画面の割れの多くは静的監査と実機確認で拾えている。画面の退行が実際に続けて起きたら、その画面から入れる。
- **Priority**: Low
- **Status**: TODO
