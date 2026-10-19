// マイページの履歴・保存のタイルの拍手（hooks/useDeskClaps）。みんなのデスクにあった守りが
// 後から足したこちらに無く、件数がサーバーとずれていた。React を起こさず、押したときの関数だけを取り出して確かめる
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createIntentSync } from '../src/utils/intentSync'

const file = 'src/hooks/useDeskClaps.ts'
const noop = () => {}

function extract(name: string, bindings: Record<string, unknown>, path = file) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: ts.Node | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer
      && ts.isCallExpression(node.initializer)) found = node.initializer.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(found, name)
  const module = { exports: undefined as any }
  const code = ts.transpileModule(`module.exports = (${found.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { module, Promise, Map, Set, Math, ...bindings })
  return module.exports
}

function setup(options: { known: boolean; serverClapped: boolean; checkFails?: boolean; read?: () => Promise<any>; send?: (liked: boolean) => Promise<void> }) {
  const sent: boolean[] = []
  const counts = new Map([['d', 5]])
  const likedIdsRef = { current: new Set<string>() }
  const tapSeqRef = { current: new Map<string, number>() }
  let reconciled = 0
  const bindings: Record<string, any> = {
    userId: 'me', placement: 'test', onSignedOut: noop,
    currentUserRef: { current: 'me' },
    checkingRef: { current: new Map<string, Promise<boolean>>() },
    knownRef: { current: new Set(options.known ? ['d'] : []) },
    likedIdsRef,
    tapSeqRef,
    tapSeq: (id: string) => tapSeqRef.current.get(id) ?? 0,
    updateLiked: (change: (prev: Set<string>) => Set<string>) => { likedIdsRef.current = change(likedIdsRef.current) },
    setLikeCounts: (change: (prev: Map<string, number>) => Map<string, number>) => {
      const next = change(counts)
      for (const [key, value] of next) counts.set(key, value)
    },
    getLikedDeskIds: async () => {
      if (options.read) return options.read()
      if (options.checkFails) throw new Error('offline')
      return { current: new Set(options.serverClapped ? ['d'] : []), before: new Set() }
    },
    hapticMedium: noop,
    analytics: { track: noop }, EVENTS: {},
    reconcileCount: () => { reconciled++ },
  }
  bindings.applyLiked = extract('applyLiked', bindings)
  bindings.readClap = extract('readClap', bindings)
  const target = { deskId: 'd', userId: 'me' }
  bindings.targetFor = () => target
  bindings.likeSync = createIntentSync<typeof target>({
    send: async (_target, value) => { sent.push(value); await options.send?.(value) },
    onSettled: () => bindings.reconcileCount(),
    onFailed: (_target, value) => { bindings.applyLiked('d', value); bindings.reconcileCount() },
  })
  const toggle = extract('toggleClap', bindings)
  return { toggle, sent, counts, likedIdsRef, bindings, get reconciled() { return reconciled } }
}

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

test('拍手済みか分からないデスクは先に引き、拍手済みなら取り消しを送る', async () => {
  const s = setup({ known: false, serverClapped: true })
  await s.toggle('d', noop)
  await flush()
  assert.deepEqual(s.sent, [false])
  assert.equal(s.likedIdsRef.current.has('d'), false)
  assert.equal(s.counts.get('d'), 4)
})

test('拍手済みかを引けなければ、反転も送信もしない', async () => {
  const s = setup({ known: false, serverClapped: true, checkFails: true })
  await s.toggle('d', noop)
  await flush()
  assert.deepEqual(s.sent, [])
  assert.equal(s.counts.get('d'), 5)
})

test('送り終えたら件数をサーバーと合わせ直す', async () => {
  const s = setup({ known: true, serverClapped: false })
  await s.toggle('d', noop)
  await flush()
  assert.deepEqual(s.sent, [true])
  assert.equal(s.counts.get('d'), 6)
  assert.equal(s.reconciled, 1)
})

for (const taps of [2, 3, 6, 7]) {
  test(`送信中に${taps}回押しても表示と件数を毎回反転し、最後の状態を直列に送る`, async () => {
    const writes: ReturnType<typeof deferred<void>>[] = []
    const s = setup({ known: true, serverClapped: false, send: () => {
      const pending = deferred<void>()
      writes.push(pending)
      return pending.promise
    } })
    for (let i = 0; i < taps; i++) {
      await s.toggle('d', noop)
      assert.equal(s.likedIdsRef.current.has('d'), i % 2 === 0)
      assert.equal(s.counts.get('d'), i % 2 === 0 ? 6 : 5)
    }
    assert.deepEqual(s.sent, [true])
    writes[0].resolve()
    await flush()
    if (taps % 2 === 0) {
      assert.deepEqual(s.sent, [true, false])
      writes[1].resolve()
      await flush()
    }
    assert.equal(s.sent.at(-1), taps % 2 === 1)
    assert.equal(s.likedIdsRef.current.has('d'), taps % 2 === 1)
  })
}

test('状態取得中の連打も捨てず、問い合わせを共有して押した回数どおりに反転する', async () => {
  const state = deferred<any>()
  let reads = 0
  const s = setup({ known: false, serverClapped: true, read: () => { reads++; return state.promise } })
  const taps = [s.toggle('d', noop), s.toggle('d', noop), s.toggle('d', noop)]
  assert.equal(reads, 1)
  state.resolve({ current: new Set(['d']) })
  await Promise.all(taps)
  await flush()
  assert.equal(s.likedIdsRef.current.has('d'), false)
  assert.equal(s.counts.get('d'), 4)
  assert.equal(s.sent.at(-1), false)
})

test('送信失敗では最後に確認できた状態と件数に戻し、再度押して再試行できる', async () => {
  const pending = deferred<void>()
  let failed = false
  const s = setup({ known: true, serverClapped: false, send: () => failed ? Promise.resolve() : pending.promise })
  await s.toggle('d', noop)
  await s.toggle('d', noop)
  await s.toggle('d', noop)
  assert.equal(s.counts.get('d'), 6)
  pending.reject(new Error('offline'))
  await flush()
  assert.equal(s.likedIdsRef.current.has('d'), false)
  assert.equal(s.counts.get('d'), 5)
  failed = true
  await s.toggle('d', noop)
  await flush()
  assert.equal(s.likedIdsRef.current.has('d'), true)
})

test('状態の確認中に別アカウントへ切り替えたら、古いタップで反転・送信しない', async () => {
  const state = deferred<any>()
  const s = setup({ known: false, serverClapped: false, read: () => state.promise })
  const tap = s.toggle('d', noop)
  s.bindings.currentUserRef.current = 'new-user'
  state.resolve({ current: new Set() })
  await tap
  assert.deepEqual(s.sent, [])
  assert.equal(s.counts.get('d'), 5)
})

for (const screen of ['DeskFeedScreen', 'PublicDeskScreen']) {
  for (const taps of [2, 3]) {
    test(`${screen}: 初回確認中に${taps}回押した結果をすべて反映する`, async () => {
      const path = `src/screens/${screen}.tsx`
      const gate = deferred<any>()
      const sent: boolean[] = []
      let reads = 0
      let count = 5
      const bindings: Record<string, any> = {
        user: { id: 'me' }, deskId: 'd', ja: true, lang: 'ja', navigation: {},
        clapUserRef: { current: 'me' }, clapContext: 'me:d', clapContextRef: { current: 'me:d' },
        likedIdsRef: { current: new Set<string>() }, likedRef: { current: false },
        likeCheckingRef: { current: screen === 'DeskFeedScreen' ? new Set() : false },
        likeReadsRef: { current: new Map() }, likeReadRef: { current: null },
        likeKnownRef: { current: false }, askedLikeIdsRef: { current: new Set() },
        clappedBeforeRef: { current: new Set() }, clapSeqRef: { current: new Map() }, likeGenRef: { current: 0 },
        getLikedDeskIds: () => { reads++; return gate.promise },
        getDeskClapState: () => { reads++; return gate.promise },
        setLiked: noop, setLikedIds: noop, applyClappedBefore: noop,
        setLikeCount: (update: (value: number) => number) => { count = update(count) },
        setLikeCounts: (update: (value: Map<string, number>) => Map<string, number>) => { count = update(new Map([['d', count]])).get('d')! },
        setClapBurstKey: noop, hapticMedium: noop,
      }
      bindings.applyLiked = extract('applyLiked', bindings, path)
      if (screen === 'DeskFeedScreen') bindings.bumpLikeCount = extract('bumpLikeCount', bindings, path)
      bindings.likeSync = createIntentSync<string>({ send: async (_id, value) => { sent.push(value) }, onFailed: noop })
      bindings.readClap = extract('readClap', bindings, path)
      const toggle = extract('handleToggleLike', bindings, path)
      const pending = Array.from({ length: taps }, () => screen === 'DeskFeedScreen' ? toggle('d', noop) : toggle())
      assert.equal(reads, 1)
      gate.resolve({ current: new Set(['d']), before: new Set(), clapped: true, clappedBefore: false })
      await Promise.all(pending)
      await flush()
      const liked = screen === 'DeskFeedScreen' ? bindings.likedIdsRef.current.has('d') : bindings.likedRef.current
      assert.equal(liked, taps % 2 === 0)
      assert.equal(count, taps % 2 === 0 ? 5 : 4)
      assert.equal(sent.at(-1), taps % 2 === 0)
    })
  }
}
