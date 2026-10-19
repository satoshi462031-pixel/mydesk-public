import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync('src/utils/imagePicker.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

function picker(os: string, granted: boolean) {
  const calls: string[] = []
  const result = { canceled: false, assets: [{ uri: 'content://selected-photo' }] }
  const module = { exports: {} as any }
  runInNewContext(code, { module, exports: module.exports, require: (id: string) => {
    if (id === 'react-native') return { Platform: { OS: os } }
    if (id === 'expo-image-picker') return {
      requestMediaLibraryPermissionsAsync: async () => { calls.push('permissions'); return { granted } },
      launchImageLibraryAsync: async () => { calls.push('picker'); return result },
    }
    throw new Error(id)
  } })
  return { launch: module.exports.launchImageLibraryFromUserAction, calls, result }
}

test('Androidでは写真全体の権限を拒否されていても、選択した写真をシステムピッカーから受け取る', async () => {
  const h = picker('android', false)
  assert.equal((await h.launch({ mediaTypes: ['images'] })).result, h.result)
  assert.deepEqual(h.calls, ['picker'])
})

test('iOSの既存の許可拒否と写真選択の経路を維持する', async () => {
  const denied = picker('ios', false)
  assert.equal((await denied.launch({})).permissionDenied, true)
  assert.deepEqual(denied.calls, ['permissions'])
  const allowed = picker('ios', true)
  assert.equal((await allowed.launch({})).result, allowed.result)
  assert.deepEqual(allowed.calls, ['permissions', 'picker'])
})
