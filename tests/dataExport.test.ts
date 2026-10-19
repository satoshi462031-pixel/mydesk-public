import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function exporter(payload: unknown) {
  const files = new Map<string, string>()
  const shared: string[] = []
  const backupCode = ts.transpileModule(readFileSync('src/services/backupService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const backup = { exports: {} as any }
  runInNewContext(backupCode, { module: backup, exports: backup.exports, require: () => ({}), Date })
  const module = { exports: {} as any }
  const code = ts.transpileModule(readFileSync('src/services/dataExport.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    module, exports: module.exports, Date,
    require: (id: string) => {
      if (id === './backupService') return { buildBackupPayload: async () => payload, isPayloadEmpty: backup.exports.isPayloadEmpty }
      if (id === 'expo-file-system/legacy') return { cacheDirectory: 'file:///cache/', writeAsStringAsync: async (uri: string, text: string) => { files.set(uri, text) } }
      if (id === 'expo-sharing') return { isAvailableAsync: async () => true, shareAsync: async (uri: string) => { shared.push(uri) } }
      throw new Error(`Unexpected module ${id}`)
    },
  })
  return { run: module.exports.exportUserData as () => Promise<string>, files, shared }
}

for (const [name, values] of [
  ['AI相談のみ', { aiConversations: [{ id: 'chat', messages: [{ content: 'あ'.repeat(1500000) }] }] }],
  ['フォルダのみ', { folders: [{ id: 'folder', name: '棚' }] }],
  ['ガジェットのみ', { gadgets: [{ id: 'gadget' }] }],
  ['デスクのみ', { plans: [{ id: 'desk' }] }],
  ['閲覧履歴のみ', { viewHistory: [{ deskId: 'desk', viewedAt: '2026-10-19T00:00:00Z' }] }],
] as const) {
  test(`${name}でも空と判定せず、容量制限なしでJSONを書き出す`, async () => {
    const payload = Object.assign({ app: 'MyDesk', version: 6, gadgets: [], folders: [], plans: [], aiConversations: [] }, values)
    const h = exporter(payload)
    assert.equal(await h.run(), 'shared')
    assert.equal(h.shared.length, 1)
    assert.deepEqual(JSON.parse(h.files.get(h.shared[0])!), payload)
  })
}

test('書き出せるデータがないときはファイルと共有シートを作らない', async () => {
  const h = exporter({ gadgets: [], folders: [], plans: [], aiConversations: [] })
  assert.equal(await h.run(), 'empty')
  assert.equal(h.files.size, 0)
  assert.equal(h.shared.length, 0)
})
