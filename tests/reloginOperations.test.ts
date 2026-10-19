import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { withTimeout } from '../src/utils/networkError'
import { createIntentSync } from '../src/utils/intentSync'

const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function hooks(file: string, dependencies: (id: string) => any, invoke: (module: any) => any, globals: Record<string, unknown> = {}) {
  const slots: any[] = []
  let cursor = 0
  let effects: (() => void)[] = []
  const changed = (previous: unknown[] | undefined, deps: unknown[]) => !previous || deps.some((value, i) => !Object.is(value, previous[i]))
  const react = {
    useState: (initial: any) => {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef: (initial: any) => {
      const index = cursor++
      return slots[index] ??= { current: initial }
    },
    useCallback: (callback: any, deps: unknown[]) => {
      const index = cursor++
      if (changed(slots[index]?.deps, deps)) slots[index] = { deps, callback }
      return slots[index].callback
    },
    useEffect: (run: () => (() => void) | void, deps: unknown[]) => {
      const index = cursor++
      if (changed(slots[index]?.deps, deps)) {
        const previous = slots[index]
        slots[index] = { deps }
        effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = run() })
      }
    },
  }
  const modules = new Map<string, any>()
  function load(path: string): any {
    if (modules.has(path)) return modules.get(path)
    const module = { exports: {} as any }
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(code, {
      setTimeout: () => 0, clearTimeout: () => {}, ...globals,
      module, exports: module.exports, require: (id: string) => {
        if (id === 'react') return react
        if (id === 'react-native') return globals.native ?? { AppState: { addEventListener: () => ({ remove: () => {} }) } }
        if (id.endsWith('/networkError')) return { QUICK_TIMEOUT_MS: 10, withTimeout }
        if (id === './useIntentSync') return load('src/hooks/useIntentSync.ts')
        if (id.endsWith('/intentSync')) return { createIntentSync }
        return dependencies(id)
      },
    })
    modules.set(path, module.exports)
    return module.exports
  }
  const module = load(file)
  return {
    render: () => {
      cursor = 0
      const result = invoke(module)
      const pending = effects
      effects = []
      pending.forEach(run => run())
      return result
    },
  }
}

function aiHarness(rpc: () => Promise<any>, globals: Record<string, unknown> = {}) {
  let auth: any = { user: { id: 'pro-user' }, profile: { id: 'pro-user', tier: 'pro' } }
  let read = rpc
  const hook = hooks('src/hooks/useAIUsageLimit.ts', id => {
    if (id.endsWith('/AuthContext')) return { useAuth: () => auth }
    if (id.endsWith('/supabase/client')) return { supabase: { rpc: () => read() } }
    throw new Error(id)
  }, module => module.useAIUsageLimit(), globals)
  return { ...hook, setAuth: (value: any) => { auth = value }, setRead: (value: () => Promise<any>) => { read = value } }
}

function clapHarness(send: (id: string, owner: string, liked: boolean) => Promise<void>) {
  let owner: string | undefined = 'me'
  let ids = ['desk']
  let serverLiked = false
  let countReads = 0
  const h = hooks('src/hooks/useDeskClaps.ts', id => {
    if (id.endsWith('/desks')) return {
      getLikedDeskIds: async () => ({ current: new Set(serverLiked ? ['desk'] : []) }),
      getDeskLikeCounts: async () => { countReads++; return new Map([['desk', serverLiked ? 6 : 5]]) },
      setDeskLiked: async (deskId: string, userId: string, liked: boolean) => { await send(deskId, userId, liked); serverLiked = liked },
    }
    if (id.endsWith('/analytics')) return { analytics: { track() {} }, EVENTS: {} }
    if (id.endsWith('/haptics')) return { hapticMedium() {} }
    throw new Error(id)
  }, module => module.useDeskClaps(ids, owner, 'test', () => {}))
  return { ...h, setOwner: (value: string | undefined) => { owner = value }, refresh: () => { ids = [...ids] }, get countReads() { return countReads } }
}

test('連打の中間状態の件数は読み直さず、最後の送信後にサーバーの件数へ合わせる', async () => {
  const gates = [deferred<void>(), deferred<void>()]
  let sends = 0
  const h = clapHarness(async () => { await gates[sends++].promise })
  h.render()
  await flush()
  const initialReads = h.countReads
  const state = h.render()
  await state.toggleClap('desk', () => {})
  await state.toggleClap('desk', () => {})
  gates[0].resolve()
  await flush()
  assert.equal(sends, 2)
  assert.equal(h.countReads, initialReads)
  gates[1].resolve()
  await flush()
  assert.equal(h.countReads, initialReads + 1)
  assert.equal(h.render().likeCounts.get('desk'), 5)
})

test('拍手フックの実際の送信と件数再取得も、連打の最後の状態に揃う', async () => {
  const first = deferred<void>()
  const writes: boolean[] = []
  const h = clapHarness(async (_id, _owner, liked) => { writes.push(liked); if (writes.length === 1) await first.promise })
  h.render()
  await flush()
  const state = h.render()
  await state.toggleClap('desk', () => {})
  await state.toggleClap('desk', () => {})
  assert.equal(h.render().likedIds.has('desk'), false)
  assert.equal(h.render().likeCounts.get('desk'), 5)
  first.resolve()
  await flush()
  assert.deepEqual(writes, [true, false])
  assert.equal(h.render().likedIds.has('desk'), false)
  assert.equal(h.render().likeCounts.get('desk'), 5)
})

test('前のアカウントの送信待ちの拍手を、再ログイン先へ送らない', async () => {
  const first = deferred<void>()
  const owners: string[] = []
  const h = clapHarness(async (_id, owner) => { owners.push(owner); await first.promise })
  h.render()
  await flush()
  const old = h.render()
  await old.toggleClap('desk', () => {})
  await old.toggleClap('desk', () => {})
  h.setOwner('new-user')
  h.render()
  await flush()
  first.resolve()
  await flush()
  assert.deepEqual(owners, ['me'])
  assert.equal(h.render().likedIds.has('desk'), false)
  await old.toggleClap('desk', () => {})
  assert.deepEqual(owners, ['me'])
})
const usage = (pro: boolean, tokens = 0, limit = 150_000) => ({ data: [{ is_pro: pro, msg_count: 30, photo_count: 5, token_count: tokens, token_limit: pro ? limit : 0 }], error: null })

test('AIの週間枠はUTC月曜0時をまたぐと更新し、バックグラウンドからの復帰でも取り直す', async () => {
  for (const resume of [false, true]) {
    let now = Date.parse('2026-10-11T23:59:00Z')
    let count = 150_000
    let reads = 0
    let onActive = () => {}
    let timer: (() => void) | undefined
    const h = aiHarness(async () => { reads++; return usage(true, count) }, {
      Date: class extends Date {
        constructor(value?: any) { super(value ?? now) }
        static now() { return now }
      },
      setTimeout: (callback: () => void, delay: number) => {
        assert.ok(delay > 0)
        timer = callback
        return 1
      },
      native: { AppState: { addEventListener: (_event: string, callback: (state: string) => void) => {
        onActive = () => callback('active')
        return { remove: () => {} }
      } } },
    })
    h.render()
    await flush()
    assert.equal(h.render().usedRatio, 1)
    assert.equal(h.render().canUse, false)
    onActive()
    await flush()
    assert.equal(reads, 1, '週の境界前の復帰では取り直さない')
    count = 0
    now = Date.parse('2026-10-12T00:00:00Z')
    if (resume) onActive()
    else timer!()
    assert.equal(h.render().loaded, false)
    await flush()
    assert.equal(h.render().usedRatio, 0)
    assert.equal(h.render().canUse, true)
    assert.equal(reads, 2)
    assert.equal(h.render().resetDate.toISOString(), '2026-10-19T00:00:00.000Z')
  }
})

test('AI枠の通信例外・無応答でも待機を解除し、Proは再試行して入力を再開できる', async () => {
  for (const read of [async () => { throw new Error('offline') }, () => new Promise<any>(() => {})]) {
    const h = aiHarness(read)
    assert.equal(h.render().loaded, false)
    await new Promise(resolve => setTimeout(resolve, 20))
    const fallback = h.render()
    assert.equal(fallback.loaded, true)
    assert.equal(fallback.isPro, true)
    assert.equal(fallback.canUse, true)
    h.setRead(async () => usage(true, 150_000))
    await fallback.refresh()
    assert.equal(h.render().canUse, false)
  }
})

test('FreeからProへの反映時にAI枠取得が失敗しても、古いFree判定で入力を封鎖しない', async () => {
  const h = aiHarness(async () => usage(false))
  h.setAuth({ user: { id: 'same' }, profile: { id: 'same', tier: 'free' } })
  h.render()
  await flush()
  assert.equal(h.render().isPro, false)
  h.setRead(async () => { throw new Error('offline') })
  h.setAuth({ user: { id: 'same' }, profile: { id: 'same', tier: 'pro' } })
  assert.equal(h.render().loaded, false)
  await flush()
  assert.equal(h.render().loaded, true)
  assert.equal(h.render().canUse, true)
})

test('再ログイン先に前のアカウントの使い切ったAI枠・遅い応答を引き継がない', async () => {
  const h = aiHarness(async () => usage(true, 150_000))
  h.render()
  await flush()
  const old = h.render()
  assert.equal(old.canUse, false)
  const response = deferred<any>()
  h.setRead(() => response.promise)
  const pending = old.refresh()
  h.setAuth({ user: { id: 'new' }, profile: { id: 'new', tier: 'pro' } })
  h.setRead(async () => { throw new Error('offline') })
  h.render()
  await flush()
  old.applyUsage({ isPro: false, msgCount: 30, photoCount: 5, tokenCount: 150_000, tokenLimit: 0 })
  await old.refresh()
  response.resolve(usage(false, 150_000))
  await pending
  const current = h.render()
  assert.equal(current.loaded, true)
  assert.equal(current.isPro, true)
  assert.equal(current.usedRatio, 0)
  assert.equal(current.canUse, true)
})

test('AI送信で返った新しい利用量を、送信前に開始した枠取得で巻き戻さない', async () => {
  const response = deferred<any>()
  const h = aiHarness(() => response.promise)
  h.render()
  h.render().applyUsage({ isPro: true, msgCount: 30, photoCount: 5, tokenCount: 150_000, tokenLimit: 150_000 })
  response.resolve(usage(true, 0))
  await flush()
  const current = h.render()
  assert.equal(current.loaded, true)
  assert.equal(current.canUse, false)
  assert.equal(current.canUsePhoto, false)
})

test('本人以外の古いProプロフィールはAIの暫定権限に使わない', async () => {
  const h = aiHarness(async () => { throw new Error('offline') })
  h.setAuth({ user: { id: 'new' }, profile: { id: 'old', tier: 'pro' } })
  h.render()
  await flush()
  assert.equal(h.render().loaded, true)
  assert.equal(h.render().isPro, false)
  assert.equal(h.render().canUse, false)
})

test('認証トークン更新だけでは確認済みのAI利用量を消さず、再取得も増やさない', async () => {
  let reads = 0
  const h = aiHarness(async () => { reads++; return usage(true, 150_000) })
  h.render()
  await flush()
  h.setAuth({ user: { id: 'pro-user', token: 'renewed' }, profile: { id: 'pro-user', tier: 'pro' } })
  const current = h.render()
  assert.equal(current.loaded, true)
  assert.equal(current.usedRatio, 1)
  assert.equal(current.canUse, false)
  assert.equal(reads, 1)
})

test('文章と写真はサーバーの共通トークン枠で判定し、旧回数カウンターでは止めない', async () => {
  const h = aiHarness(async () => usage(true, 119_999, 200_000))
  h.render()
  await flush()
  let current = h.render()
  assert.equal(current.tokenLimit, 200_000)
  assert.equal(current.tokenCount, 119_999)
  assert.equal(current.canUse, true)
  assert.equal(current.canUsePhoto, true)
  assert.equal(await current.consume(), true)
  assert.equal(await current.consumePhoto(), true)
  assert.equal(current.nearLimit, false)

  current.applyUsage({ isPro: true, msgCount: 300, photoCount: 50, tokenCount: 160_000, tokenLimit: 200_000 })
  current = h.render()
  assert.equal(current.usedRatio, 0.8)
  assert.equal(current.nearLimit, true)
  assert.equal(current.canUse, true)

  current.applyUsage({ isPro: true, msgCount: 301, photoCount: 51, tokenCount: 200_000, tokenLimit: 200_000 })
  current = h.render()
  assert.equal(current.usedRatio, 1)
  assert.equal(current.nearLimit, false)
  assert.equal(current.canUse, false)
  assert.equal(current.canUsePhoto, false)
  assert.equal(await current.consume(), false)
  assert.equal(await current.consumePhoto(), false)
})

test('BIGINTの文字列表現で利用量を取得でき、欠けた利用量では確認済みの値を消さない', async () => {
  const h = aiHarness(async () => ({ data: [{ is_pro: true, token_count: '160000', token_limit: '200000' }], error: null }))
  h.render()
  await flush()
  let current = h.render()
  assert.equal(current.usedRatio, 0.8)
  current.applyUsage({ isPro: true, msgCount: 30, photoCount: 5, tokenCount: null, tokenLimit: null })
  current = h.render()
  assert.equal(current.tokenCount, 160_000)
  assert.equal(current.tokenLimit, 200_000)
  h.setRead(async () => ({ data: [{ is_pro: true, token_count: null, token_limit: null }], error: null }))
  await current.refresh()
  current = h.render()
  assert.equal(current.tokenCount, 160_000)
  assert.equal(current.tokenLimit, 200_000)
  assert.equal(current.nearLimit, true)
})

function followHarness(read: (user: string) => Promise<any>) {
  let auth: any = { user: { id: 'me' } }
  let query = read
  const sends: string[] = []
  const h = hooks('src/hooks/useUserFollow.ts', id => {
    if (id.endsWith('/AuthContext')) return { useAuth: () => auth }
    if (id.endsWith('/AppContext')) return { useApp: () => ({ lang: 'ja' }) }
    if (id.endsWith('/userFollows')) return {
      getFollowState: (user: string) => query(user),
      followUser: async (user: string) => { sends.push(`${user}:follow`) },
      unfollowUser: async (user: string) => { sends.push(`${user}:unfollow`) },
      setFollowNotify: async (user: string) => { sends.push(`${user}:notify`) },
    }
    if (id.endsWith('/haptics')) return { hapticLight() {}, hapticSelection() {} }
    if (id.endsWith('/analytics')) return { analytics: { track() {} }, EVENTS: {} }
    if (id.endsWith('/pushNotifications')) return { registerPushToken: async () => {} }
    if (id.endsWith('/promptLogin')) return { promptLogin() {} }
    throw new Error(id)
  }, module => module.useUserFollow('author', {}, 'public_profile'))
  return { ...h, sends, setAuth: (value: any) => { auth = value }, setRead: (value: typeof read) => { query = value } }
}

test('再ログイン直後のフォロー状態取得に失敗しても、次のタップで再取得して操作できる', async () => {
  for (const read of [async () => { throw new Error('offline') }, () => new Promise<any>(() => {})]) {
    const h = followHarness(read)
    h.render()
    await new Promise(resolve => setTimeout(resolve, 20))
    h.setRead(async () => ({ following: true, notify: false }))
    await h.render().toggle()
    assert.equal(h.render().following, false)
    assert.deepEqual(h.sends, ['me:unfollow'])
  }
})

test('フォロー初回取得中のタップは同じ問い合わせを待ち、結果に従って一度だけ操作する', async () => {
  const response = deferred<any>()
  let reads = 0
  const h = followHarness(async () => { reads++; return response.promise })
  h.render()
  const tapping = h.render().toggle()
  response.resolve({ following: false, notify: true })
  await tapping
  assert.equal(reads, 1)
  assert.equal(h.render().following, true)
  assert.deepEqual(h.sends, ['me:follow'])
})

test('フォロー読込中にアカウントを替えたら、古いタップと通知操作を新しい本人へ送らない', async () => {
  const response = deferred<any>()
  const h = followHarness(() => response.promise)
  h.render()
  const old = h.render()
  const tapping = old.toggle()
  h.setRead(async () => ({ following: false, notify: true }))
  h.setAuth({ user: { id: 'new' } })
  h.render()
  await flush()
  response.resolve({ following: true, notify: false })
  await tapping
  await old.toggle()
  old.toggleNotify()
  assert.equal(h.render().following, false)
  assert.deepEqual(h.sends, [])
  await h.render().toggle()
  assert.deepEqual(h.sends, ['new:follow'])
})

test('トークン更新時はフォロー送信中の表示を戻さず、連打の最終状態を送る', async () => {
  const h = followHarness(async () => ({ following: false, notify: true }))
  h.render()
  await flush()
  const first = h.render()
  void first.toggle()
  h.setAuth({ user: { id: 'me', token: 'renewed' } })
  assert.equal(h.render().following, true)
  await h.render().toggle()
  await flush()
  assert.equal(h.render().following, false)
  assert.deepEqual(h.sends, ['me:follow', 'me:unfollow'])
})
