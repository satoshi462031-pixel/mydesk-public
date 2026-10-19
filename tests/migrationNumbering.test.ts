import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import test from 'node:test'

// 版＝ファイル名先頭の数字は supabase_migrations.schema_migrations の主キー。
// 重複したまま db push すると、1本目を適用した直後に2本目で落ちて本番が
// 中途状態で止まる（061 の冒頭にその事故の記録がある）。
// 番号を選ぶのは人なので、目視ではなくここで止める。
test('マイグレーションの番号が重複していない', () => {
  const versions = new Map<string, string>()
  const duplicates: string[] = []

  for (const file of readdirSync('supabase/migrations').filter((name) => name.endsWith('.sql')).sort()) {
    const version = file.split('_')[0]
    const seen = versions.get(version)
    if (seen) duplicates.push(`${version}: ${seen} / ${file}`)
    else versions.set(version, file)
  }

  assert.deepEqual(duplicates, [])
})
