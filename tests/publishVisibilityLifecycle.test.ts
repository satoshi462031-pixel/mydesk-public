import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { userErrorMessage } from '../src/utils/networkError'

const base = 'https://example.invalid/storage/v1/object/public/desk-images/'
const original = 'user/desk/original.jpg'
const variants = [original, original.replace('.jpg', '_thumb.jpg'), original.replace('.jpg', '_md.jpg')]
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function harness(options: { visibility?: string; localVisibility?: string; variants?: string[] } = {}) {
  const objects = new Set(options.variants ?? variants)
  const storage = new Map<string, string>([['@published_desk_plan', 'desk'], ['@published_visibility_plan', options.localVisibility ?? 'public']])
  const desk: any = { id: 'desk', user_id: 'user', visibility: options.visibility ?? 'public' }
  const photos: any[] = [{ id: 'photo', desk_id: 'desk', image_url: base + original, pending_revocation_url: null }]
  const state = { exists: true, authOwner: 'user', ownerAfterUpdate: '', failGetDesk: false, failCreateResponse: false, failUpdateResponse: false, failSnapshot: false, failStorageKey: '', failLocalAfterUpdate: false, failJournalRemoval: false, creates: 0, notifications: 0, failCopy: '', failRemove: false, ignoreRemove: false, failPhotoUpdate: false, failPlanPhotoUpdate: false, failDeskUpdate: false, updateGate: null as ReturnType<typeof deferred> | null, copies: 0, snapshots: 0, snapshotPhotos: [] as string[] }
  const bucket = {
    async list(folder: string, { search }: { search: string }) {
      return { data: [...objects].filter((path) => path.startsWith(folder + '/') && path.slice(folder.length + 1).includes(search)).map((path) => ({ name: path.slice(folder.length + 1) })), error: null }
    },
    async copy(from: string, to: string) {
      state.copies++
      if (state.failCopy && from.endsWith(state.failCopy)) return { error: new Error('copy failed') }
      assert.ok(objects.has(from))
      objects.add(to)
      return { error: null }
    },
    async remove(paths: string[]) {
      if (state.failRemove) return { error: new Error('remove failed') }
      if (!state.ignoreRemove) paths.forEach((path) => objects.delete(path))
      return { data: [], error: null }
    },
    getPublicUrl(path: string) { return { data: { publicUrl: base + path } } },
  }
  const supabase = {
    storage: { from: () => bucket },
    auth: { getUser: async () => ({ data: { user: { id: state.authOwner } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { public_tag: 'owner', tier: 'free' }, error: null }) }) }) }),
    rpc: async (name: string, args: any) => { assert.equal(name, 'publish_desk_snapshot'); state.snapshots++; state.snapshotPhotos = args.p_image_urls; return { error: state.failSnapshot ? new Error('snapshot failed') : null } },
    functions: { invoke: async () => { state.notifications++; return { error: null } } },
  }
  const desks = {
    getUserDesks: async () => { if (state.failGetDesk) throw new Error('offline'); return state.exists ? [{ ...desk }] : [] },
    getDesk: async () => { if (state.failGetDesk) throw new Error('offline'); return state.exists ? { ...desk } : null },
    createDesk: async (ownerId: string, input: any) => { state.creates++; state.exists = true; Object.assign(desk, { user_id: ownerId }, input); if (state.failCreateResponse) throw new Error('create response lost'); return { ...desk } },
    updateDesk: async (_id: string, patch: any) => {
      if (state.updateGate) await state.updateGate.promise
      if (state.failDeskUpdate) throw new Error('desk update failed')
      if (desk.visibility !== 'private' && patch.visibility === 'private') photos.forEach((photo) => { photo.pending_revocation_url ??= photo.image_url })
      Object.assign(desk, patch)
      if (state.ownerAfterUpdate) state.authOwner = state.ownerAfterUpdate
      if (state.failLocalAfterUpdate) state.failStorageKey = '@published_visibility_plan'
      if (state.failUpdateResponse) throw new Error('response lost')
      return { ...desk }
    },
    getDeskPhotos: async () => photos.map((photo) => ({ ...photo })),
    updateDeskPhotoUrl: async (_id: string, url: string, pending?: string | null, expected?: string) => {
      if (state.failPhotoUpdate) throw new Error('photo update failed')
      if (expected !== undefined && photos[0].image_url !== expected) throw new Error('photo changed concurrently')
      photos[0].image_url = url
      if (pending !== undefined) photos[0].pending_revocation_url = pending
    },
    getDeskDevices: async () => [], getDeskConnections: async () => [], getDeskVersions: async () => [],
  }
  const asyncStorage = {
    getItem: async (key: string) => storage.get(key) ?? null,
    removeItem: async (key: string) => { storage.delete(key) },
    setItem: async (key: string, value: string) => { if (state.failStorageKey && key.startsWith(state.failStorageKey)) throw new Error('disk failed'); storage.set(key, value) },
    getAllKeys: async () => [...storage.keys()],
    multiGet: async (keys: string[]) => keys.map((key) => [key, storage.get(key) ?? null]),
    multiSet: async (entries: [string, string][]) => { entries.forEach(([key, value]) => storage.set(key, value)) },
    multiRemove: async (keys: string[]) => { if (state.failJournalRemoval && keys.some((key) => key.startsWith('@publication_recovery:'))) throw new Error('disk failed'); keys.forEach((key) => storage.delete(key)) },
  }
  let random = 0
  let reissues = 0
  function load(path: string) {
    const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
    const exports: any = {}
    runInNewContext(source, { exports, URL, Date, Set, Map, Promise, Error, require: (id: string) => {
      if (id.includes('supabase/client')) return { supabase }
      if (id.includes('hooks/usePlans')) return { replacePlanPhotoUrl: async () => { if (state.failPlanPhotoUpdate) throw new Error('plan save failed') } }
      if (id === './storage') return media
      if (id === './imageUploadGateway') return { copyPublicImage: async (from: string, to: string) => {
        const { error } = await bucket.copy(from, to)
        if (error) throw error
      } }
      if (id === './desks') return desks
      if (id === './deskShareLinks') return { reissueUnlistedDeskUrl: async () => {
        assert.equal(photos[0].pending_revocation_url, null)
        reissues++
        photos[0].pending_revocation_url = photos[0].image_url
        return 'https://example.invalid/setup/reissued'
      } }
      if (id === '@react-native-async-storage/async-storage') return asyncStorage
      if (id === 'expo-crypto') return { randomUUID: () => `synthetic-${++random}` }
      if (id.includes('analytics')) return { analytics: { track() {} }, EVENTS: {} }
      if (id.includes('constants/plans')) return { PLAN_LIMITS: { free: { maxGrowthRecords: 0 } } }
      if (id.includes('publishRequirements')) return { publishGadgetIssue: () => null }
      if (id.includes('planWiring')) return { missingAllSelectedGadgets: () => false }
      if (id.includes('networkError')) return { isNetworkError: () => false }
      if (id.includes('deskGadgetUsage')) return { applyDeskGadgetUsage: (_plan: any, gadget: any) => gadget }
      if (id.includes('portTypeMigration')) return { normalizePlan: (plan: any) => plan }
      if (id.includes('publicContentModeration')) return { assertPublicContentAllowed() {}, collectPublicTexts: () => [] }
      if (id.includes('gadgetStats')) return { sumGadgetPrices: () => 100, sumGadgetQuantities: () => 1 }
      if (id.includes('deskAttributes')) return { deskAttributeKeys: () => [] }
      if (id.includes('brandIdentity')) return { gadgetBrandForPublish: () => ({}) }
      if (id.includes('publicContentSignature')) return { photoIdentity: (url: string) => url, publicContentSignature: () => 'synthetic' }
      if (id.includes('favoriteGadgets')) return { publishedFavoriteGadgetIds: () => [] }
      if (id.includes('truncateText')) return { trimAndTruncate: (value: string) => value }
      if (id.includes('connectionMapLayout')) return { mapSignature: () => '' }
      return {}
    } })
    return exports
  }
  const media = load('src/services/storage.ts')
  const service = load('src/services/publishService.ts')
  return { objects, storage, desk, photos, state, service, media, get reissues() { return reissues }, reload: () => load('src/services/publishService.ts') }
}

test('サーバーの写真失効を端末へ同期してから限定公開リンクを再発行し、繰り返しても直前の写真URLを失効する', async () => {
  const h = harness({ visibility: 'unlisted' })
  const serverPath = 'user/desk/server.jpg'
  h.objects.clear()
  for (const path of [serverPath, serverPath.replace('.jpg', '_thumb.jpg'), serverPath.replace('.jpg', '_md.jpg')]) h.objects.add(path)
  h.photos[0].image_url = base + serverPath
  h.photos[0].pending_revocation_url = base + original
  const first = await h.service.reissueUnlistedLink('desk', 'owner', 'plan')
  assert.equal(h.reissues, 1)
  assert.equal(first.photoUrls.get(base + original), h.photos[0].image_url)
  assert.ok(!h.objects.has(serverPath))
  const previous = h.photos[0].image_url
  await h.service.reissueUnlistedLink('desk', 'owner', 'plan')
  assert.equal(h.reissues, 2)
  assert.notEqual(h.photos[0].image_url, previous)
  assert.ok(!h.objects.has(previous.slice(base.length)))
})

test('前回の写真失効を同期できない間は限定公開リンクを再発行しない', async () => {
  const h = harness({ visibility: 'unlisted' })
  h.photos[0].pending_revocation_url = h.photos[0].image_url
  h.state.failRemove = true
  await assert.rejects(h.service.reissueUnlistedLink('desk', 'owner', 'plan'), /remove failed/)
  assert.equal(h.reissues, 0)
})

test('公開停止は全サイズの旧URLを消し、新しい写真参照を保持する', async () => {
  const h = harness()
  await h.service.unpublishPlan('plan')
  assert.equal(h.desk.visibility, 'private')
  assert.equal(h.storage.get('@published_visibility_plan'), 'private')
  for (const old of variants) assert.ok(!h.objects.has(old))
  assert.ok(h.objects.has(h.photos[0].image_url.slice(base.length)))
  assert.equal(h.photos[0].pending_revocation_url, null)
  assert.equal(h.objects.size, 3)
})

for (const failedVariant of ['original.jpg', 'original_thumb.jpg', 'original_md.jpg']) {
  test(`${failedVariant} の複製失敗を成功扱いせず、元の写真を失わず再試行する`, async () => {
    const h = harness()
    h.state.failCopy = failedVariant
    await assert.rejects(h.service.unpublishPlan('plan'), /PHOTO_REVOCATION_INCOMPLETE/)
    assert.equal(h.desk.visibility, 'private')
    assert.equal(h.photos[0].image_url, base + original)
    assert.equal(h.photos[0].pending_revocation_url, base + original)
    variants.forEach((old) => assert.ok(h.objects.has(old)))
    h.state.failCopy = ''
    await h.service.unpublishPlan('plan')
    variants.forEach((old) => assert.ok(!h.objects.has(old)))
  })
}

test('旧写真の削除失敗後はDBに記録した旧URLを使い、再複製せず再試行する', async () => {
  const h = harness()
  h.state.failRemove = true
  await assert.rejects(h.service.unpublishPlan('plan'), /PHOTO_REVOCATION_INCOMPLETE/)
  assert.notEqual(h.photos[0].image_url, base + original)
  assert.equal(h.photos[0].pending_revocation_url, base + original)
  const copies = h.state.copies
  h.state.failRemove = false
  await h.service.unpublishPlan('plan')
  assert.equal(h.state.copies, copies)
  assert.equal(h.photos[0].pending_revocation_url, null)
  variants.forEach((old) => assert.ok(!h.objects.has(old)))
})

test('削除APIが成功を返しても旧ファイルが残れば公開停止未完了にする', async () => {
  const h = harness()
  h.state.ignoreRemove = true
  await assert.rejects(h.service.unpublishPlan('plan'), /PHOTO_REVOCATION_INCOMPLETE/)
  assert.equal(h.photos[0].pending_revocation_url, base + original)
})

test('派生画像のない旧写真も公開停止できる', async () => {
  const h = harness({ variants: [original] })
  await h.service.unpublishPlan('plan')
  assert.equal(h.objects.size, 1)
  assert.ok(!h.objects.has(original))
})

test('写真DBの更新に失敗した場合は元写真を削除しない', async () => {
  const h = harness()
  await assert.rejects(h.media.rotateDeskImage(base + original, async () => { throw new Error('DB failed') }), /DB failed/)
  variants.forEach((old) => assert.ok(h.objects.has(old)))
})

test('未失効の写真がある間は再公開せず、失効完了後にURL限定へ戻せる', async () => {
  const h = harness()
  h.state.failRemove = true
  await assert.rejects(h.service.unpublishPlan('plan'))
  await assert.rejects(h.service.republishPlan('plan', 'unlisted'))
  assert.equal(h.desk.visibility, 'private')
  h.state.failRemove = false
  await h.service.republishPlan('plan', 'unlisted')
  assert.equal(h.desk.visibility, 'unlisted')
  assert.equal(h.storage.get('@published_visibility_plan'), 'unlisted')
  assert.equal(h.photos[0].pending_revocation_url, null)
})

test('見え方の切替をタイムアウト後に再試行しても重ねず、別の切替は拒否する', async () => {
  const h = harness()
  h.state.updateGate = deferred()
  const first = h.service.setPlanVisibility('plan', 'unlisted')
  await new Promise((done) => setImmediate(done))
  const same = h.service.setPlanVisibility('plan', 'unlisted')
  await assert.rejects(h.service.unpublishPlan('plan'), /PUBLISH_IN_PROGRESS/)
  h.state.updateGate.resolve()
  await Promise.all([first, same])
  assert.equal(h.desk.visibility, 'unlisted')
})

const plan = { id: 'plan', name: 'synthetic desk', selectedGadgetIds: ['gadget'], createdAt: '2026-01-01', images: [] }
const gadgets = [{ id: 'gadget', name: 'synthetic gadget', category: 'Monitor', ports: [] }]

for (const visibility of ['public', 'unlisted', 'private']) {
  test(`再インストール後に公開先の対応表がなくても、${visibility}の既存ページを引き継ぐ`, async () => {
    const h = harness({ visibility })
    h.desk.share_snapshot = { plan, gadgets }
    h.storage.clear()
    await h.service.restorePublishedPlanLinks('user', ['plan'])
    assert.equal(h.storage.get('@published_desk_plan'), 'desk')
    assert.equal(h.storage.get('@published_visibility_plan'), visibility)
    assert.equal(h.state.creates, 0)
    if (visibility === 'private') {
      await assert.rejects(h.service.publishPlan(plan, gadgets, 'user'), /DESK_NOT_PUBLIC/)
      assert.equal(h.desk.visibility, 'private')
    } else {
      h.storage.clear()
      assert.equal(await h.service.publishPlan(plan, gadgets, 'user'), 'desk')
      assert.equal(h.state.creates, 0)
      assert.equal(h.desk.visibility, visibility)
    }
  })
}

test('対応表を失った端末でサーバーを確認できなければ、公開ページを推測で新規作成しない', async () => {
  const h = harness()
  h.storage.clear()
  h.state.failGetDesk = true
  await assert.rejects(h.service.publishPlan(plan, gadgets, 'user'), /offline/)
  assert.equal(h.state.creates, 0)
  assert.equal(h.storage.has('@published_desk_plan'), false)
})

test('公開先の読み込み中にアカウントが変わったら、元のアカウントの紐付けを書き戻さない', async () => {
  const h = harness()
  h.storage.clear()
  h.desk.share_snapshot = { plan, gadgets }
  h.state.authOwner = 'other-user'
  await assert.rejects(h.service.restorePublishedPlanLinks('user', ['plan']), /PUBLICATION_OWNER_CHANGED/)
  assert.equal(h.storage.size, 0)
})

const journalKey = '@publication_recovery:user:plan:plan'

test('初回のURL限定公開はprivateから同じIDで完成し、通知や通常公開へ変換しない', async () => {
  const h = harness()
  h.storage.clear(); h.state.exists = false
  const id = await h.service.publishPlan(plan, gadgets, 'user', [], { visibility: 'unlisted' })
  assert.equal(h.state.creates, 1)
  assert.equal(h.state.notifications, 0)
  assert.equal(h.desk.id, id)
  assert.equal(h.desk.visibility, 'unlisted')
  assert.equal(h.storage.get('@published_visibility_plan'), 'unlisted')
  assert.ok(h.desk.share_snapshot.publicationAttemptId)
  assert.ok(!h.storage.has(journalKey))
})

test('公開から限定公開、公開、非公開、限定公開へ切り替えてもデスクIDを維持する', async () => {
  const h = harness()
  await h.service.setPlanVisibility('plan', 'unlisted')
  await h.service.setPlanVisibility('plan', 'public')
  await h.service.unpublishPlan('plan')
  await h.service.republishPlan('plan', 'unlisted')
  assert.equal(h.storage.get('@published_desk_plan'), 'desk')
  assert.equal(h.desk.visibility, 'unlisted')
  assert.equal(h.state.creates, 0)
})

test('見え方の書き込み後に応答だけ失われても実際の限定公開を確認して成功にする', async () => {
  const h = harness()
  h.state.failUpdateResponse = true
  await h.service.setPlanVisibility('plan', 'unlisted')
  assert.equal(h.storage.get('@published_visibility_plan'), 'unlisted')
  assert.ok(!h.storage.has(journalKey))
})

test('公開内容の最終保存後に応答だけ失われても試行IDが一致した場合だけ成功にする', async () => {
  const h = harness()
  h.state.failUpdateResponse = true
  await h.service.publishPlan(plan, gadgets, 'user', [], { visibility: 'unlisted' })
  assert.equal(h.desk.visibility, 'unlisted')
  assert.ok(!h.storage.has(journalKey))
})

test('新規作成の応答が失われた後は再起動して同じ行を引き継ぎ、重複デスクを作らない', async () => {
  const h = harness()
  h.storage.clear(); h.state.exists = false; h.state.failCreateResponse = true
  await assert.rejects(h.service.publishPlan(plan, gadgets, 'user', [], { visibility: 'unlisted' }), /create response lost/)
  const id = h.desk.id
  assert.equal(h.desk.visibility, 'private')
  h.state.failCreateResponse = false
  const recovered = h.reload()
  const [result] = await recovered.recoverPendingPublications('plan')
  assert.equal(result.status, 'retry_required')
  assert.equal(h.storage.get('@published_desk_plan'), id)
  await recovered.publishPlan(plan, gadgets, 'user', [], { visibility: 'unlisted' })
  assert.equal(h.desk.id, id)
  assert.equal(h.state.creates, 1)
  assert.equal(h.desk.visibility, 'unlisted')
})

test('端末の保存失敗後は復旧記録を保持し、再起動後にサーバーの限定公開へ合わせる', async () => {
  const h = harness()
  h.state.failLocalAfterUpdate = true
  await assert.rejects(h.service.setPlanVisibility('plan', 'unlisted'), /disk failed/)
  assert.equal(h.desk.visibility, 'unlisted')
  assert.ok(h.storage.has(journalKey))
  h.state.failStorageKey = ''
  const [result] = await h.reload().recoverPendingPublications('plan')
  assert.equal(result.status, 'recovered')
  assert.equal(h.storage.get('@published_visibility_plan'), 'unlisted')
  assert.ok(!h.storage.has(journalKey))
})

test('写真削除の失敗は再起動後に旧URLの失効から再開し、限定公開へ勝手に戻さない', async () => {
  const h = harness({ visibility: 'unlisted', localVisibility: 'unlisted' })
  h.state.failRemove = true
  await assert.rejects(h.service.unpublishPlan('plan'), /PHOTO_REVOCATION_INCOMPLETE/)
  const copies = h.state.copies
  h.state.failRemove = false
  const [result] = await h.reload().recoverPendingPublications('plan')
  assert.equal(result.status, 'recovered')
  assert.equal(h.state.copies, copies)
  assert.equal(h.desk.visibility, 'private')
  variants.forEach((path) => assert.ok(!h.objects.has(path)))
})

test('通信できない復旧は実際の状態を推測せず、記録と直前の表示を保持する', async () => {
  const h = harness()
  h.state.failDeskUpdate = true
  await assert.rejects(h.service.setPlanVisibility('plan', 'unlisted'))
  h.state.failGetDesk = true
  const [result] = await h.reload().recoverPendingPublications('plan')
  assert.equal(result.status, 'unknown')
  assert.equal(result.visibility, null)
  assert.equal(h.storage.get('@published_visibility_plan'), 'public')
  assert.ok(h.storage.has(journalKey))
})

test('書き込み前の失敗は復旧で自動公開せず、実際の状態と再試行必要を返す', async () => {
  const h = harness({ visibility: 'private', localVisibility: 'private' })
  h.state.failDeskUpdate = true
  await assert.rejects(h.service.setPlanVisibility('plan', 'unlisted'))
  const [result] = await h.reload().recoverPendingPublications('plan')
  assert.equal(result.status, 'retry_required')
  assert.equal(result.visibility, 'private')
  assert.equal(h.desk.visibility, 'private')
})

test('公開中の内容更新が途中で失敗した場合、公開範囲が同じだけで完了扱いにしない', async () => {
  const h = harness({ visibility: 'unlisted', localVisibility: 'unlisted' })
  h.state.failSnapshot = true
  await assert.rejects(h.service.publishPlan(plan, gadgets, 'user', [], { visibility: 'unlisted' }), /snapshot failed/)
  const [result] = await h.reload().recoverPendingPublications('plan')
  assert.equal(result.visibility, 'unlisted')
  assert.equal(result.status, 'retry_required')
  assert.ok(h.storage.has(journalKey))
})

test('タイムアウト後も進行中の切替には復旧処理を重ねない', async () => {
  const h = harness()
  h.state.updateGate = deferred()
  const work = h.service.setPlanVisibility('plan', 'unlisted')
  await new Promise((done) => setImmediate(done))
  const [result] = await h.service.recoverPendingPublications('plan')
  assert.equal(result.status, 'in_flight')
  h.state.updateGate.resolve()
  await work
})

test('別アカウントの未完了操作は読み直してもサーバーや端末へ反映しない', async () => {
  const h = harness()
  h.state.failDeskUpdate = true
  await assert.rejects(h.service.setPlanVisibility('plan', 'unlisted'))
  h.state.authOwner = 'other'
  assert.equal((await h.reload().recoverPendingPublications()).length, 0)
  assert.ok(h.storage.has(journalKey))
  assert.equal(h.storage.get('@published_visibility_plan'), 'public')
})

test('復旧記録を先に保存できない場合は公開範囲を書き換えない', async () => {
  const h = harness()
  h.state.failStorageKey = '@publication_recovery:'
  await assert.rejects(h.service.setPlanVisibility('plan', 'unlisted'), /disk failed/)
  assert.equal(h.desk.visibility, 'public')
})

test('完了した操作の記録削除が失敗しても成功とし、次の復旧で消す', async () => {
  const h = harness()
  h.state.failJournalRemoval = true
  await h.service.setPlanVisibility('plan', 'unlisted')
  assert.ok(h.storage.has(journalKey))
  h.state.failJournalRemoval = false
  await h.reload().recoverPendingPublications('plan')
  assert.ok(!h.storage.has(journalKey))
})

test('更新の最終保存が失敗したときは、まだ公開ページが参照する旧写真を削除しない', async () => {
  const h = harness()
  h.state.failDeskUpdate = true
  await assert.rejects(h.service.publishPlan(plan, gadgets, 'user', [], { visibility: 'unlisted' }))
  variants.forEach((path) => assert.ok(h.objects.has(path)))
})

test('復旧記録は公開リンクのバックアップへ含めない', async () => {
  const h = harness()
  h.state.failDeskUpdate = true
  await assert.rejects(h.service.setPlanVisibility('plan', 'unlisted'))
  const exported = await h.service.exportPublishLinks()
  assert.ok(h.storage.has(journalKey))
  assert.ok(!(journalKey in exported))
})

test('端末にないデスクも復旧でき、公開範囲をアカウント単位で照合する', async () => {
  const h = harness()
  h.storage.clear()
  h.state.failDeskUpdate = true
  await assert.rejects(h.service.setDeskVisibility('desk', 'unlisted'))
  const key = '@publication_recovery:user:desk:desk'
  assert.ok(h.storage.has(key))
  h.state.failDeskUpdate = false
  h.desk.visibility = 'unlisted'
  const [result] = await h.reload().recoverPendingPublications()
  assert.equal(result.status, 'recovered')
  assert.equal(result.planId, null)
  assert.ok(!h.storage.has(key))
})

test('別所有者のデスクへ切り替わっていた場合は復旧の状態を保存しない', async () => {
  const h = harness()
  h.state.failDeskUpdate = true
  await assert.rejects(h.service.setPlanVisibility('plan', 'unlisted'))
  h.desk.user_id = 'other'
  h.desk.visibility = 'unlisted'
  const [result] = await h.reload().recoverPendingPublications()
  assert.equal(result.status, 'unknown')
  assert.equal(h.storage.get('@published_visibility_plan'), 'public')
  assert.ok(h.storage.has(journalKey))
})
test('写真失効が完了した後の端末保存失敗は写真未失効と区別し、記録から復旧する', async () => {
  const h = harness()
  h.state.failLocalAfterUpdate = true
  const error = await h.service.unpublishPlan('plan').catch((cause: unknown) => cause)
  assert.match(error.message, /disk failed/)
  assert.equal(h.service.isPhotoRevocationIncomplete(error), false)
  assert.equal(h.photos[0].pending_revocation_url, null)
  h.state.failStorageKey = ''
  const [result] = await h.reload().recoverPendingPublications('plan')
  assert.equal(result.status, 'recovered')
  assert.equal(result.visibility, 'private')
})


test('失効記録のDB列が未適用なら、非公開の写真失効を復旧済みにしない', async () => {
  const h = harness()
  h.state.failRemove = true
  await assert.rejects(h.service.unpublishPlan('plan'))
  delete h.photos[0].pending_revocation_url
  h.state.failRemove = false
  const [result] = await h.reload().recoverPendingPublications('plan')
  assert.equal(result.visibility, 'private')
  assert.equal(result.status, 'unknown')
  assert.ok(h.storage.has(journalKey))
})


test('処理中にアカウントが変わった場合は前ユーザーの公開状態を端末へ書き戻さない', async () => {
  const h = harness()
  h.state.ownerAfterUpdate = 'other'
  await assert.rejects(h.service.setPlanVisibility('plan', 'unlisted'), /PUBLICATION_OWNER_CHANGED/)
  assert.equal(h.desk.visibility, 'unlisted')
  assert.equal(h.storage.get('@published_visibility_plan'), 'public')
  assert.equal((await h.service.recoverPendingPublications()).length, 0)
})

test('別端末で非公開にしたデスクを更新操作で再公開しない', async () => {
  const h = harness({ visibility: 'private', localVisibility: 'public' })
  await assert.rejects(h.service.publishPlan(plan, gadgets, 'user'), /DESK_NOT_PUBLIC/)
  assert.equal(h.state.snapshots, 0)
  assert.equal(h.desk.visibility, 'private')
  assert.equal(h.storage.get('@published_visibility_plan'), 'private')
})

test('端末の写真参照の保存失敗後は旧写真を残し、次の再試行で失効できる', async () => {
  const h = harness()
  h.state.failPlanPhotoUpdate = true
  await assert.rejects(h.service.unpublishPlan('plan'), /PHOTO_REVOCATION_INCOMPLETE/)
  variants.forEach((old) => assert.ok(h.objects.has(old)))
  assert.equal(h.photos[0].pending_revocation_url, base + original)
  h.state.failPlanPhotoUpdate = false
  await h.service.unpublishPlan('plan')
  variants.forEach((old) => assert.ok(!h.objects.has(old)))
})

test('失効の再試行を伴う再公開でも、呼び出し時点の古い写真URLを落とさない', async () => {
  const h = harness()
  h.state.failRemove = true
  await assert.rejects(h.service.unpublishPlan('plan'))
  h.state.failRemove = false
  await h.service.publishPlan({ ...plan, images: [base + original] }, gadgets, 'user', [base + original], { visibility: 'public' })
  assert.equal(h.state.snapshotPhotos.length, 1)
  assert.equal(h.state.snapshotPhotos[0], h.photos[0].image_url)
})

test('Undo用に取り消し前のURL限定と移動後の写真URLを返す', async () => {
  const h = harness({ visibility: 'unlisted', localVisibility: 'public' })
  let previous: any
  let replacement: any
  await h.service.unpublishPlan('plan', (visibility: any, replacements: any) => { previous = visibility; replacement = replacements.get(base + original) })
  assert.equal(previous, 'unlisted')
  assert.equal(replacement, h.photos[0].image_url)
  assert.notEqual(replacement, base + original)
  await h.service.republishPlan('plan', previous)
  assert.equal(h.desk.visibility, 'unlisted')
})

test('URL限定のサーバー状態を更新操作で維持する', async () => {
  const h = harness({ visibility: 'unlisted', localVisibility: 'public' })
  await h.service.publishPlan(plan, gadgets, 'user')
  assert.equal(h.desk.visibility, 'unlisted')
  assert.equal(h.storage.get('@published_visibility_plan'), 'unlisted')
})

test('公開済みデスクの最後の更新失敗で端末だけ非公開表示にしない', async () => {
  const h = harness()
  h.state.failDeskUpdate = true
  await assert.rejects(h.service.publishPlan(plan, gadgets, 'user'), /desk update failed/)
  assert.equal(h.desk.visibility, 'public')
  assert.equal(h.storage.get('@published_visibility_plan'), 'public')
})

test('写真の失効未完了はデスクがまだ公開中という説明に置き換えない', () => {
  assert.match(userErrorMessage(new Error('PHOTO_REVOCATION_INCOMPLETE'), 'ja', ''), /公開ページは停止しました/)
  assert.match(userErrorMessage(new Error('DESK_NOT_PUBLIC'), 'en', ''), /private/)
})

function plansHarness() {
  let saved: any[] = [{ id: 'plan', images: ['file:///local.jpg', 'remote-a', 'remote-b'], name: 'kept', updatedAt: 'kept-date' }]
  const state = { saves: 0, fail: false }
  const exports: any = {}
  const source = ts.transpileModule(readFileSync('src/hooks/usePlans.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText
  runInNewContext(source, { exports, Set, Promise, Error, require: (id: string) => {
    if (id.includes('planStore')) return {
      loadPlans: async () => JSON.parse(JSON.stringify(saved)),
      savePlans: async (plans: any[]) => { state.saves++; if (state.fail) throw new Error('disk failed'); saved = JSON.parse(JSON.stringify(plans)) },
    }
    if (id.includes('analytics')) return { analytics: { error() {} } }
    if (id.includes('networkError')) return { withTimeout: (work: any) => work }
    return {}
  } })
  return { service: exports, state, saved: () => saved }
}

test('公開写真のURL更新はローカル写真・名前・日時を保持し、並行する別写真の更新を落とさない', async () => {
  const h = plansHarness()
  await Promise.all([
    h.service.replacePlanPhotoUrl('plan', 'remote-a', 'new-a'),
    h.service.replacePlanPhotoUrl('plan', 'remote-b', 'new-b'),
  ])
  assert.deepEqual(h.saved()[0], { id: 'plan', images: ['file:///local.jpg', 'new-a', 'new-b'], name: 'kept', updatedAt: 'kept-date' })
})

test('端末に旧公開URLがない場合は写真失効のために端末データを書き直さない', async () => {
  const h = plansHarness()
  await h.service.replacePlanPhotoUrl('plan', 'not-used', 'replacement')
  assert.equal(h.state.saves, 0)
})

test('端末の写真参照を書けない場合は失敗を返し、成功した次の保存で更新する', async () => {
  const h = plansHarness()
  h.state.fail = true
  await assert.rejects(h.service.replacePlanPhotoUrl('plan', 'remote-a', 'new-a'), /disk failed/)
  assert.equal(h.saved()[0].images[1], 'remote-a')
  h.state.fail = false
  await h.service.replacePlanPhotoUrl('plan', 'remote-a', 'new-a')
  assert.equal(h.saved()[0].images[1], 'new-a')
})

test('古い世代の控えを復元しても、残るデスクは端末に今ある公開の対応を3キーまとめて残す', async () => {
  const h = harness()
  h.storage.set('@published_signature_plan', 'current-signature')
  h.storage.set('@published_desk_gone', 'gone-desk')
  await h.service.importPublishLinks({
    '@published_desk_plan': 'old-desk', '@published_signature_plan': 'old-signature',
    '@published_desk_other': 'other-desk', '@published_visibility_other': 'unlisted',
  }, { keepCurrentFor: ['plan', 'other', 'unpublished'] })
  assert.deepEqual(Object.fromEntries([...h.storage].sort()), {
    '@published_desk_other': 'other-desk', '@published_desk_plan': 'desk',
    '@published_signature_plan': 'current-signature', '@published_visibility_other': 'unlisted',
    '@published_visibility_plan': 'public',
  })
})
