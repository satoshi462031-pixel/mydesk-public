---
paths:
  - "supabase/**"
---

## Supabase（マイグレーション・Edge Functions）

- 既存のマイグレーションファイルは書き換えない（新しい連番で追加する）。本番適用は確認を取る。
- **マイグレーションで関数を足したら `audit:function-grants`**（SECURITY DEFINER 関数の anon /
  authenticated への実行権限を明示したか。`REVOKE ... FROM PUBLIC` だけでは Supabase の既定の付与が残る）。
  `npm run test:all` にも同じ判定が入っている。
- **関数を置き換えたら、旧い関数の anon / authenticated への付与を外す。** 使われなくなった入口も、
  アプリから取り出した anon キーで叩ける（109 で6本外した）。`audit:function-grants` が、クライアントに
  渡したままコードからも SQL からも呼ばれていない関数を止める。
- **ダッシュボードで本番にテーブルや関数を直接作らない。** 作ったら `npm run audit:prod-surface` が
  「マイグレーションの外にある入口」として出す（2026-10-14 に出所不明のテーブルが6つ見つかった）。
