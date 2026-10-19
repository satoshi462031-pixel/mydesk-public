import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const migration = readFileSync('supabase/migrations/066_gadget_bookmarks.sql', 'utf8')

// 「〜が無いこと」を確かめる検査は、コメントを外した実行される SQL に対して行う。
// このファイルは当初案（gadget_likes・UNIQUE (user_id, desk_id, gadget_id)）を
// なぜ捨てたかを本文に書いてあるので、素の全文に doesNotMatch を当てると
// 解説の文字列に当たって落ちる
const sql = migration
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

test('欲しいものリストは本人しか読めない', () => {
  assert.match(migration, /ALTER TABLE public\.gadget_bookmarks ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /gadget_bookmarks_select_own[\s\S]*?auth\.uid\(\) = user_id/)
  assert.match(migration, /REVOKE ALL ON public\.gadget_bookmarks FROM anon/)
})

test('ガジェット単位のいいねは作らない', () => {
  assert.doesNotMatch(sql, /gadget_likes/)
})

// 当初案の UNIQUE (user_id, desk_id, gadget_id) だと、同じマウスを3人のデスクから
// 保存したときに欲しいものリストに3行並ぶ
test('同一性は商品単位で、デスクごとに重複しない', () => {
  assert.match(
    migration,
    /CREATE UNIQUE INDEX[\s\S]*?gadget_bookmarks_user_product_idx[\s\S]*?\(user_id, product_id\)[\s\S]*?WHERE product_id IS NOT NULL/,
  )
  // 商品マスタを引けなかったものは名前＋カテゴリで畳む
  assert.match(
    migration,
    /CREATE UNIQUE INDEX[\s\S]*?gadget_bookmarks_user_name_idx[\s\S]*?lower\(gadget_name\), lower\(gadget_category\)[\s\S]*?WHERE product_id IS NULL/,
  )
  assert.doesNotMatch(sql, /UNIQUE \(user_id, desk_id, gadget_id\)/)
})

// 出典より長生きしなければ、相手が非公開にしただけで自分の欲しいものが消える
test('出典のデスクが消えても行は残る', () => {
  assert.match(migration, /desk_id\s+UUID REFERENCES public\.desks\(id\) ON DELETE SET NULL/)
  assert.doesNotMatch(sql, /desks\(id\) ON DELETE CASCADE/)
})

// 自分の持ち物の画面から「欲しい」を押す経路のために、出典なしの保存を通す。
// 出典を付けるときだけ公開デスクを要求する（非公開デスクを辿れる穴にしない）
test('出典なしの保存は通し、出典を付けるなら公開デスクだけ', () => {
  assert.match(migration, /gadget_bookmarks_insert_own[\s\S]*?desk_id IS NULL OR EXISTS/)
  assert.match(migration, /gadget_bookmarks_insert_own[\s\S]*?desks\.visibility = 'public'/)
  assert.doesNotMatch(sql, /desks\.user_id <> auth\.uid\(\)/)
})
