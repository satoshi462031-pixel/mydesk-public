import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const DOCUMENTS = 'file:///var/mobile/Containers/Data/Application/NEW/Documents/'

test('再インストールで写真ファイルが消えた場合は参照だけを外し、デスク本体と公開写真は残す', async () => {
  const images = loadPlanImages(new Set())
  const [plan] = await images.dropMissingLocalImages([{
    id: 'p1', name: 'kept', selectedGadgetIds: ['g1'],
    images: ['plan_images/p1_old.jpg', 'file:///var/mobile/Containers/Data/Application/OLD/Documents/plan_images/p1_old.jpg', 'https://example.invalid/published.jpg'],
  }])
  assert.equal(plan.id, 'p1')
  assert.equal(plan.name, 'kept')
  assert.deepEqual([...plan.selectedGadgetIds], ['g1'])
  assert.deepEqual([...plan.images], ['https://example.invalid/published.jpg'])
})

function loadPlanImages(existing: Set<string>) {
  const fileSystem = {
    documentDirectory: DOCUMENTS,
    getInfoAsync: async (uri: string) => ({ exists: existing.has(uri) }),
  }
  const load = (path: string, require: (id: string) => unknown) => {
    const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    const exports: any = {}
    runInNewContext(source, { exports, require })
    return exports
  }
  const refs = load('src/utils/planImageRefs.ts', () => ({}))
  return load('src/utils/planImages.ts', (id) => {
    if (id === 'expo-file-system/legacy') return fileSystem
    if (id === './planImageRefs') return refs
    return {}
  })
}

test('アプリ更新でコンテナが変わった端末へ控えを戻しても、残っている写真は外さない', async () => {
  const kept = `${DOCUMENTS}plan_images/p1_kept.jpg`
  const planImages = loadPlanImages(new Set([kept]))
  const [plan] = await planImages.dropMissingLocalImages([{
    id: 'p1',
    images: [
      'file:///var/mobile/Containers/Data/Application/OLD/Documents/plan_images/p1_kept.jpg',
      'file:///var/mobile/Containers/Data/Application/OLD/Documents/plan_images/p1_gone.jpg',
      'https://example.invalid/remote.jpg',
    ],
  }])
  assert.deepEqual([...plan.images], [kept, 'https://example.invalid/remote.jpg'])
})

test('写真がすべて今のコンテナにあれば、デスクをそのまま返す', async () => {
  const uri = `${DOCUMENTS}plan_images/p1_a.jpg`
  const planImages = loadPlanImages(new Set([uri]))
  const plan = { id: 'p1', images: [uri] }
  assert.equal((await planImages.dropMissingLocalImages([plan]))[0], plan)
})

function loadImageService(existing: Set<string>) {
  const fileSystem = {
    documentDirectory: DOCUMENTS,
    getInfoAsync: async (uri: string) => ({ exists: existing.has(uri) }),
  }
  const source = ts.transpileModule(readFileSync('src/services/ai/imageService.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const exports: any = {}
  const refs = (() => {
    const refsSource = ts.transpileModule(readFileSync('src/utils/planImageRefs.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
    const refsExports: any = {}
    runInNewContext(refsSource, { exports: refsExports })
    return refsExports
  })()
  runInNewContext(source, { exports, require: (id: string) => (id === 'expo-file-system/legacy' ? fileSystem : id.endsWith('/planImageRefs') ? refs : {}) })
  return exports
}

test('控えから戻した相談の写真は今のコンテナへ置き直し、実物が無いものだけ外す', async () => {
  const kept = `${DOCUMENTS}ai_conversation_images/msg_1.jpg`
  const service = loadImageService(new Set([kept]))
  const [conversation] = await service.dropMissingConversationImages([{
    id: 'c',
    messages: [
      { id: 'm1', imageUri: 'file:///var/mobile/Containers/Data/Application/OLD/Documents/ai_conversation_images/msg_1.jpg' },
      { id: 'm2', imageUri: 'file:///var/mobile/Containers/Data/Application/OLD/Documents/ai_conversation_images/msg_2.jpg' },
      { id: 'm3' },
    ],
  }])
  assert.deepEqual([...conversation.messages].map((message: any) => message.imageUri), [kept, undefined, undefined])
})
