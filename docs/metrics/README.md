# 月次プロダクト実績

採用資料や事業評価で再検証できるよう、毎月同じ定義で数値と証拠ファイルを保存する。

## 情報源

- ダウンロード、製品ページ、評価、レビュー: App Store Connect
- Activation、Retention、機能利用: PostHog（分析同意者内）
- MRR、有料会員、更新、解約: RevenueCat
- クラッシュフリーセッション: Sentry
- 広告費、クリック、キャンペーン: 広告管理画面とApp Storeキャンペーン

PostHogの数値を全ダウンロード母集団として扱わない。`activationRateAmongConsented`は分析同意者内、ダウンロード数はApp Store Connectの値である。

管理画面の週次確認では、初回価値到達率・翌週再利用率・料金画面から購入への転換率を人数付きで記録する。転換率の入口は7日間の観測を終えたN日間、継続率の起点は各指標の観測を終えた直近N日分。月次スナップショットへ渡す`analytics-users`と`activated-users`は同じ入口コホートでそろえる。目的別・アプリ版・流入元の比較は同じ期間と定義で行う。

施策は一度に1つ選び、仮説・対象・Primary metric・判定期間を変更前に記録する。分析同意の拒否・解除はPostHogへ送らないため、PostHog単独で全利用者の同意率は算出できない。

App Storeの集計可能なキャンペーンリンクは次で生成する。これは広告別ダウンロードと売上の集計用で、個々のユーザーをPostHogへ結び付けるMMPではない。

```powershell
npm.cmd run metrics:campaign -- --provider-id 123456789 --campaign x_launch_2026q3 --content video_a
```

## 月次スナップショット

`npm run metrics:snapshot --`に次の値を渡す。

```powershell
npm.cmd run metrics:snapshot -- --month 2026-09 --downloads 1000 --organic-downloads 600 --analytics-users 300 --activated-users 180 --d30-eligible 120 --d30-retained 18 --subscribers-start 20 --subscribers-end 35 --new-paid-users 18 --cancelled-subscribers 3 --gross-mrr-yen 20650 --net-revenue-yen 17552 --ad-spend-yen 50000 --attributed-paid-installs 400 --attributed-new-paid-users 12 --rating 4.6 --reviews 45 --crash-free-sessions-pct 99.7 --app-store-report evidence/app-store-2026-09.csv --posthog-report evidence/posthog-2026-09.pdf --revenuecat-report evidence/revenuecat-2026-09.csv --sentry-report evidence/sentry-2026-09.pdf --ad-report evidence/x-ads-2026-09.csv
```

証拠ファイル自体に個人情報が含まれる場合はGitへ追加せず、安全な保管場所の参照だけを書く。

## 改善記録

施策ごとに[EXPERIMENT_TEMPLATE.md](./EXPERIMENT_TEMPLATE.md)をコピーし、変更前後の期間、母数、バージョン、指標定義を固定する。結果が悪かった施策も削除しない。
