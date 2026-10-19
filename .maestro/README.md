# ネイティブE2E

`draft-restart.yaml`は、初回案内で分析を拒否し、用途を選んでからプロセスを起動し直し、作成途中の選択が戻ることを検証する。Nodeのモックを使わず、インストール済みのアプリを操作する。

## 実行条件

- 日本語設定の専用シミュレーター／エミュレーターと、インストール済みのMyDeskビルド。
- Maestro CLI。Expo Goの操作は対象外。
- 個人のデータ・ログインがない端末。`clearState: true`でこのアプリのデータを初期化する。普段使いの端末には実行しない。

```sh
maestro test --format junit --output tmp/maestro-draft-restart.xml .maestro/draft-restart.yaml
```

MacではiOS Simulator、Android環境では接続済みエミュレーターを指定する。複数端末がある場合は`maestro --device <device-id> test ...`を使う。

このシナリオは定義を追加した段階であり、2026-10-16の作業環境にはMaestro・接続端末がないため未実行。YAMLの構文検証と、端末上のシナリオ成功は別に扱う。未実行をリリース合格へ置き換えない。

## リリース前の追加確認

| 経路 | 操作と合格条件 |
|---|---|
| 新規デスクの保存 | 新規作成→機材の詳細保存→配置完了→デスク名入力→写真の設定を後回しにして完了→アプリを終了・再起動。名前・機材・配置が残り、デスクが重複しない |
| 認証と復元 | stagingの検証用アカウントでログイン→保存→空の専用端末から同じアカウントへログイン。内容が戻り、別アカウントの内容と混ざらない。手動復元の取り消しも確認する |
| 公開と非公開 | stagingで写真を含むデスクを公開→別の未ログイン端末でURLを開く→非公開へ変更。公開ページが閉じ、写真失効ジョブの完了を確認する。既に取得済みのキャッシュの回収は合格条件に含めない |

各経路で通信断・権限拒否・二重押下・OSの戻るを確認し、`docs/release/QUALITY_GATE.md`へビルド番号・端末・結果と証拠の保管先を記録する。購入・購入復元・通知はそれぞれストアSandbox／実機の検証記録を追加する。

参考：[Maestro launchApp](https://docs.maestro.dev/reference/commands-available/launchapp)、[条件付きフロー](https://docs.maestro.dev/reference/commands-available/runflow)。
