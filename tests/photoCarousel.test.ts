import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { clampPhotoIndex, photoIndexFromOffset } from '../src/utils/photoCarousel'

test('写真番号を実在する範囲へ収める', () => {
  assert.equal(clampPhotoIndex(-1, 3), 0)
  assert.equal(clampPhotoIndex(1, 3), 1)
  assert.equal(clampPhotoIndex(8, 3), 2)
  assert.equal(clampPhotoIndex(Number.NaN, 3), 0)
  assert.equal(clampPhotoIndex(2, 0), 0)
})

test('先頭と末尾のバウンス中も範囲外の写真番号を返さない', () => {
  assert.equal(photoIndexFromOffset(-180, 400, 4), 0)
  assert.equal(photoIndexFromOffset(400, 400, 4), 1)
  assert.equal(photoIndexFromOffset(1900, 400, 4), 3)
})

test('表示幅が未確定でも先頭へ安全に戻す', () => {
  assert.equal(photoIndexFromOffset(400, 0, 4), 0)
})

function screenCallback(name: string, bindings: Record<string, unknown>) {
  const file = 'src/screens/WiringResultScreen.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) initializer = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(initializer)
  return runInNewContext(ts.transpileModule(`(${initializer.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, bindings) as (...args: any[]) => any
}

test('写真の選択・保存に失敗したら理由を表示し、追加ボタンからやり直せる', async () => {
  for (const phase of ['picker', 'save']) {
    const lock = { current: false }
    const alerts: string[] = []
    let busy = false
    let fails = true
    let saves = 0
    const pick = screenCallback('pickImage', {
      addedPhotoUris: { current: new Set() },
      photoPickerInFlightRef: lock, atPhotoLimit: false, planId: 'desk', images: [], maxPhotos: 3, maxFileSizeMB: 10, lang: 'ja',
      setPickingPhotos: (value: boolean) => { busy = value },
      pickPlanPhotos: async () => {
        if (fails && phase === 'picker') throw new Error('picker failed')
        return { added: ['photo.jpg'] }
      },
      updateWith: async () => { if (fails) throw new Error('save failed'); saves++ },
      planPhotoSkipMessage: () => null,
      userErrorMessage: (error: Error) => error.message,
      Alert: { alert: (title: string) => alerts.push(title) },
    })
    await pick()
    assert.equal(busy, false)
    assert.equal(lock.current, false)
    assert.equal(saves, 0)
    assert.deepEqual(alerts, ['写真を追加できませんでした'])
    fails = false
    await pick()
    assert.equal(saves, 1)
    assert.equal(busy, false)
  }
})

test('表紙変更は最新の写真を残して保存し、成功時だけ表示位置と完了通知を更新する', async () => {
  for (const fails of [false, true]) {
    let saved = { images: ['first.jpg', 'second.jpg', 'added-while-editing.jpg'], name: 'desk' }
    let index = 1
    const notices: string[] = []
    const alerts: string[] = []
    const setCover = screenCallback('setCoverImage', {
      planId: 'desk', lang: 'ja',
      updateWith: async (_id: string, update: (plan: typeof saved) => typeof saved) => {
        if (fails) throw new Error('save failed')
        saved = update(saved)
      },
      setPreviewVisibleIdx: (value: number) => { index = value },
      setSavedToast: (value: string) => notices.push(value),
      userErrorMessage: (error: Error) => error.message,
      Alert: { alert: (title: string) => alerts.push(title) },
    })
    setCover('second.jpg')
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(saved.name, 'desk')
    assert.equal(saved.images.join(','), fails ? 'first.jpg,second.jpg,added-while-editing.jpg' : 'second.jpg,first.jpg,added-while-editing.jpg')
    assert.equal(index, fails ? 1 : 0)
    assert.deepEqual(notices, fails ? [] : ['表紙を変更しました'])
    assert.deepEqual(alerts, fails ? ['表紙を変更できませんでした'] : [])
  }
})
