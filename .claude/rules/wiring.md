---
paths:
  - "src/utils/{wiringEngine,connectionMapLayout,mapLayoutCache,mapWarmup,planWiring,layoutHold}.ts"
  - "src/utils/history*.ts"
  - "src/constants/{portTypes,demoDesks,deskTemplates,onboardingWiring.generated}.ts"
  - "src/components/organisms/{ConnectionMap,HistoryWiringCanvas,DeskHistoryAnimationModal,DeskHistoryLayoutEditModal}.tsx"
  - "src/components/atoms/MapNodeLabel.tsx"
  - "scripts/{layoutFingerprint,benchLayout,buildOnboardingWiring,auditMapLayout,compareMapLayoutMetrics,fuzzManualLayout,auditHostConnectivity,auditPowerStrips,auditDeskTourWiring}.ts"
  - "tests/*{ayout,iring,istory}*.ts"
---

## 配線ドメイン（このアプリの心臓部・バグの大半がここ）

3段構成。どの層の問題かを切り分けてから直す。

1. **`src/utils/wiringEngine.ts` — 論理**
   どの機器とどの機器を何のケーブルで繋ぐかを決める。ポートは `PortType × direction` の
   組で残数を管理し、消費したら減る（`bidirectional` は input/output 双方から使える）。
   互換表は `src/constants/portTypes.ts`。
2. **`src/utils/connectionMapLayout.ts` — 配置とルーティング**（3,500行超・最大のファイル）
   ノード寸法はカテゴリごとの実物シルエット比で決まる（路線図の駅記号の発想）。
   `computeMapLayout()` が配置＋エッジ経路を**決定論的に**計算する。
   `buildAutoDraft()` が自動下書き、`reconcileMap()` が手動編集と自動生成の突き合わせ。
3. **`src/components/organisms/ConnectionMap.tsx` — 描画**（SVG）
   履歴再生は `HistoryWiringCanvas.tsx` / `DeskHistoryAnimationModal.tsx` が別経路で描く。
   **配線ロジックを直したら履歴アニメ側も確認する。**両方に効くバグが多い。

### 配線を触るときの必須事項

- **`src/utils/mapLayoutCache.ts` の `LAYOUT_VERSION` を上げる。**
  レイアウト計算を変えたのにここを上げないと、古い結果がキャッシュから返って
  「直したのに直っていない」現象になる。配線バグ調査で最初に疑うべき点。
- `computeMapLayout` は同期処理を 12ms ごとに `yieldToEventLoop()` で切って UI を止めない設計。
  ここに重い処理を足すと画面が固まる（過去に実際に起きている）。
- 線の重なり・交差は**症状であって原因ではない**。ルーティングの後処理で押し込む修正は
  別のデスク構成で再発する。`generateWiring` が返した接続そのものが妥当かを先に確認する。
- 検証は最小構成ではなく `src/constants/demoDesks.ts` / `deskTemplates.ts` の実データで行う。
- **`npm run build:onboarding-wiring` を打ち直す。** オンボーディングは起動を遅くしないため、
  デモデスクの配線図を事前計算した `src/constants/onboardingWiring.generated.ts` を読むだけにしている。
  焼き直さないと、初回起動で見せる図だけが古いレイアウトのまま残る（開発ビルドでは警告が出る）。
  この2つは `tests/layoutVersionGuard.test.ts` が見ている。出力が変わったのに版が同じだと焼き直しが止まり、
  焼き直していないとテストが落ちる（デモデスクのデータだけを変えたときも出る。そのときも版を上げてよい）。
- 出力を変えずに速くする変更は、`scripts/layoutFingerprint.ts` で前後の出力が一致することを確かめる。
  性能の計測は `npm run bench:layout`（記録は `docs/perf/layout-benchmark.md`）。
- 静的な監査は `audit:connectivity` / `audit:power-strip` など connectivity 系を通す。
