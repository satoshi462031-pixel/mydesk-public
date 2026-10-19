import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as refs from '../src/utils/planImageRefs'
import * as repair from '../src/utils/storedDataRepair'

const OLD = 'file:///var/mobile/Containers/Data/Application/OLD/Documents/'
const NEW = 'file:///var/mobile/Containers/Data/Application/NEW/Documents/'

function loadStore(store: Map<string, string>, documentDirectory: string) {
  const storage = {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value) },
  }
  const source = ts.transpileModule(readFileSync('src/store/conversationStore.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const exports: any = {}
  runInNewContext(source, { exports, require: (id: string) => {
    if (id === '@react-native-async-storage/async-storage') return storage
    if (id === 'expo-file-system/legacy') return { documentDirectory }
    if (id.endsWith('/planImageRefs')) return refs
    if (id.endsWith('/storedDataRepair')) return repair
    return {}
  } })
  return exports
}

const conversation = (imageUri: string) => ({
  id: 'c', title: '相談', createdAt: '2026-10-01', updatedAt: '2026-10-01',
  messages: [{ id: 'm', role: 'user', content: '見て', createdAt: '2026-10-01', imageUri }],
})

test('AI相談の写真は相対パスで保存し、アプリ更新でコンテナが変わっても今の場所で開ける', async () => {
  const store = new Map<string, string>()
  await loadStore(store, OLD).saveConversation(conversation(`${OLD}ai_conversation_images/m.jpg`))
  assert.equal(JSON.parse(store.get('@ai_conversations_v2')!)[0].messages[0].imageUri, 'ai_conversation_images/m.jpg')
  const [read] = await loadStore(store, NEW).readConversations()
  assert.equal(read.messages[0].imageUri, `${NEW}ai_conversation_images/m.jpg`)
})

test('前の版が絶対パスで保存した写真も今のコンテナで開き、次の保存で相対パスへ移す', async () => {
  const store = new Map([['@ai_conversations_v2', JSON.stringify([conversation(`${OLD}ai_conversation_images/m.jpg`)])]])
  const updated = loadStore(store, NEW)
  const [read] = await updated.readConversations()
  assert.equal(read.messages[0].imageUri, `${NEW}ai_conversation_images/m.jpg`)
  await updated.saveConversation({ ...read, title: '更新' })
  assert.equal(JSON.parse(store.get('@ai_conversations_v2')!)[0].messages[0].imageUri, 'ai_conversation_images/m.jpg')
})

test('管理外の写真の参照は書き換えない', async () => {
  const store = new Map<string, string>()
  await loadStore(store, NEW).saveConversation(conversation('file:///tmp/picked.jpg'))
  assert.equal(JSON.parse(store.get('@ai_conversations_v2')!)[0].messages[0].imageUri, 'file:///tmp/picked.jpg')
})
