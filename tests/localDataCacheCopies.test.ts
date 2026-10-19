import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const CACHE = 'file:///var/mobile/Containers/Data/Application/APP/Library/Caches/'
const DOCUMENTS = 'file:///var/mobile/Containers/Data/Application/APP/Documents/'

function load(path: string, require: (id: string) => unknown) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const exports: any = {}
  runInNewContext(source, { exports, require, Promise, Date })
  return exports
}

function fileSystem(files: Set<string>) {
  return {
    cacheDirectory: CACHE,
    documentDirectory: DOCUMENTS,
    makeDirectoryAsync: async () => {},
    copyAsync: async ({ to }: { to: string }) => { files.add(to) },
    deleteAsync: async (uri: string) => { for (const file of [...files]) if (file === uri || file.startsWith(uri)) files.delete(file) },
    readDirectoryAsync: async (dir: string) => [...files].filter(file => file.startsWith(dir) && !file.slice(dir.length).includes('/')).map(file => file.slice(dir.length)),
  }
}

function loadPlanImages(files: Set<string>, assets: any[], failCopy = false) {
  const fs = fileSystem(files)
  if (failCopy) fs.makeDirectoryAsync = async () => { throw new Error('disk full') }
  return load('src/utils/planImages.ts', (id) => {
    if (id === 'expo-file-system/legacy') return fs
    if (id === './imagePicker') return { launchImageLibraryFromUserAction: async () => ({ permissionDenied: false, result: { canceled: false, assets } }) }
    if (id === 'expo-image-manipulator') return { SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: async () => { const uri = `${CACHE}ImageManipulator/out-${files.size}.jpg`; files.add(uri); return { uri } } }
    if (id === './planImageRefs') return { runtimePlanImageUri: (uri: string) => uri }
    return {}
  })
}

test('デスクの写真を取り込んだら、ImagePicker がキャッシュへ作った原本の写しを消す', async () => {
  const picked = `${CACHE}ImagePicker/original.jpg`
  const files = new Set([picked])
  const images = loadPlanImages(files, [{ uri: picked, assetId: 'A1', width: 1000, height: 800 }])
  const result = await images.pickPlanPhotos({ planId: 'p1', existing: [], limit: 5, maxFileSizeMB: 10 })
  assert.equal(result.added.length, 1)
  assert.equal(files.has(picked), false)
  assert.equal([...files].some(file => file.startsWith(`${CACHE}ImageManipulator/`)), false)
  assert.ok([...files].some(file => file.startsWith(`${DOCUMENTS}plan_images/p1_`)))
})

test('取り込みに失敗したり上限で入れなかった写真も、キャッシュの写しを残さない', async () => {
  const kept = `${CACHE}ImagePicker/a.jpg`
  const over = `${CACHE}ImagePicker/b.jpg`
  const files = new Set([kept, over])
  const images = loadPlanImages(files, [{ uri: kept, width: 10, height: 10 }, { uri: over, width: 10, height: 10 }], true)
  await assert.rejects(images.pickPlanPhotos({ planId: 'p1', existing: [], limit: 1, maxFileSizeMB: 10 }), /disk full/)
  assert.equal(files.size, 0)
})

test('写真ライブラリの外（キャッシュ以外）を指す URI は消さない', async () => {
  const outside = `${DOCUMENTS}somewhere/photo.jpg`
  const files = new Set([outside])
  const images = loadPlanImages(files, [{ uri: outside, width: 10, height: 10 }])
  await images.pickPlanPhotos({ planId: 'p1', existing: [], limit: 1, maxFileSizeMB: 10 })
  assert.equal(files.has(outside), true)
})

test('端末のデータを消すと、写真の選択・加工の写しと書き出した JSON も消える', async () => {
  const files = new Set([
    `${DOCUMENTS}plan_images/p1_a.jpg`,
    `${CACHE}ImagePicker/original.jpg`,
    `${CACHE}ImageManipulator/resized.jpg`,
    `${CACHE}mydesk-2026-10-14.json`,
    `${CACHE}other-library-cache.bin`,
  ])
  // clearLocalUserData はここを呼ぶ（呼び出し元はログアウトと全データ削除だけ）
  await loadPlanImages(files, []).deleteAllPlanImages()
  assert.deepEqual([...files], [`${CACHE}other-library-cache.bin`])
})

test('作成途中に先に作ったガジェットの ID も、端末のデータと一緒に消す', () => {
  const keys = load('src/utils/localUserDataKeys.ts', () => ({}))
  assert.deepEqual(keys.localUserDataKeys(['@template_draft_gadget_ids', 'app_language']), ['@template_draft_gadget_ids'])
})
