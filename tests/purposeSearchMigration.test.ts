import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/068_rank_public_desk_search_by_purpose.sql', 'utf8')
// 実際に本番へ載っている関数は 070 のもの。068 はスコア順の出どころとして残る
const compound = readFileSync(
  'supabase/migrations/070_search_compound_query_and_purpose_filter.sql',
  'utf8',
)

test('用途の名前・関連語・その他の自由入力を検索する', () => {
  assert.match(migration, /WHEN 'creative' THEN ARRAY\[[^\]]*'制作'[^\]]*'動画編集'/)
  assert.match(migration, /WHEN 'trading' THEN ARRAY\[[^\]]*'投資'[^\]]*'株式投資'[^\]]*'資産運用'/)
  assert.match(migration, /d\.share_snapshot->'plan'->>'otherPurposeLabel'/)
  assert.match(migration, /strpos\(d\.other_purpose, token\.term\) > 0/)
})

test('用途一致を一般の本文一致より上位にする', () => {
  const order = migration.slice(migration.indexOf('ORDER BY'))
  assert.match(order, /d\.other_purpose = p\.query THEN 5/)
  assert.match(order, /lower\(alias\.value\) = p\.query/)
  assert.match(order, /END DESC,[\s\S]*d\.updated_at DESC/)
})

test('複合語の検索語から辞書の語を拾う（ゲーミング環境 → ゲーミング）', () => {
  // 辞書側だけ逆向きの包含を許す。1文字の語まで許すと何にでも当たるので2文字以上
  assert.match(compound, /strpos\(p_token, lower\(alias\.value\)\) > 0/)
  assert.match(compound, /char_length\(alias\.value\) >= 2/)
  assert.match(compound, /WHEN 'gaming' THEN ARRAY\[[^\]]*'ゲーミング'/)
})

test('自由文は片方向のまま照合する', () => {
  // タイトル・説明・投稿者名に逆向きを許すと、短い語で無関係なデスクが混ざる
  for (const column of ['d.title', "coalesce(d.description, '')", "coalesce(d.owner_name, '')"]) {
    assert.ok(compound.includes(`strpos(lower(${column}), token.term) > 0`))
  }
  assert.ok(!compound.includes('search_alias_matches(ARRAY[d.title]'))
})

test('用途チップは辞書を通さず保存値そのもので絞る', () => {
  assert.match(compound, /p_purpose IS NULL OR d\.purposes @> ARRAY\[p_purpose\]/)
  assert.match(compound, /p_purpose TEXT DEFAULT NULL/)
})

test('機材カテゴリの辞書も用途と同じ関数に切り出す', () => {
  assert.match(compound, /CREATE OR REPLACE FUNCTION public\.device_category_search_aliases/)
  assert.match(compound, /public\.device_category_search_aliases\(device\.category\), token\.term\)/)
})
