-- =============================================================
-- Migration 058: 公開デスクに属性キーを持たせる
--
-- 公開プロフィール（/u/<tag>）は「この人はどういうデスクを組む人か」を先に見せたいが、
-- 一覧は devices も share_snapshot も引いていない（1 ページぶんの巨大な JSON が飛ぶ）。
-- OS や PC の形態は構成から導く値なので、閲覧側からは計算できない。
--
-- owner_name（051）・owner_tag（049）と同じく、公開時に端末側で計算した結果を
-- desks へコピーする。入るのは utils/deskAttributes.ts が返す言語非依存のキー
-- （'purpose:gaming' / 'os:macOS' / 'form:laptop' など）だけで、表示名は閲覧側の
-- 言語で引き直す。ラベルを入れると ja で公開したデスクが en の閲覧者に日本語で出る。
--
-- 属性が動くのは構成か用途が変わったときだけで、それは公開の更新そのもの。
-- 051 が owner_name に作ったような updated_at の例外は要らない。
-- =============================================================

ALTER TABLE public.desks
  ADD COLUMN IF NOT EXISTS attributes TEXT[] NOT NULL DEFAULT '{}';
