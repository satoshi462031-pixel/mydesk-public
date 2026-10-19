import assert from 'node:assert/strict'
import { test } from 'node:test'
import { processPhotoRevocation, type RevocationJob, type RevocationStore } from '../supabase/functions/revoke-desk-photos/process'

const owner = '11111111-2222-3333-4444-555555555555', desk = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const prefix = `${owner}/${desk}/`, url = 'https://db.invalid'
const job: RevocationJob = { id: 'job', lease_token: 'lease', owner_id: owner, desk_id: desk,
  old_url: `${url}/storage/v1/object/public/desk-images/${prefix}old.jpg`,
  new_url: `${url}/storage/v1/object/public/desk-images/${prefix}new.jpg`, preserve_photo: true, committed: false }
function setup() {
  const files = new Set([`${prefix}old.jpg`, `${prefix}old_thumb.jpg`, `${prefix}old_md.jpg`])
  const operations: string[] = []
  const store: RevocationStore = {
    async list(folder) { return [...files].filter((path) => path.startsWith(folder + '/')).map((path) => path.slice(folder.length + 1)) },
    async copy(source, target) { assert.ok(files.has(source)); files.add(target); operations.push('copy') },
    async remove(paths) { paths.forEach((path) => files.delete(path)); operations.push('remove') },
    async commit(_job, ready) { assert.ok(ready); operations.push('commit'); return true },
    async finish() { operations.push('finish') },
  }
  return { files, operations, store }
}

test('server rotation copies every size, commits the new URL, then deletes old files', async () => {
  const { files, operations, store } = setup()
  await processPhotoRevocation(store, job, url)
  assert.deepEqual(operations, ['copy', 'copy', 'copy', 'commit', 'remove', 'finish'])
  assert.deepEqual([...files].sort(), [`${prefix}new.jpg`, `${prefix}new_md.jpg`, `${prefix}new_thumb.jpg`].sort())
})
test('a lost DB response leaves old files intact; a retry reuses copied files', async () => {
  const { files, store, operations } = setup()
  const commit = store.commit; store.commit = async () => { throw new Error('offline') }
  await assert.rejects(processPhotoRevocation(store, job, url), /offline/)
  assert.ok(files.has(`${prefix}old.jpg`))
  store.commit = commit
  await processPhotoRevocation(store, job, url)
  assert.equal(operations.filter((value) => value === 'copy').length, 3)
  assert.ok(!files.has(`${prefix}old.jpg`))
})
test('a concurrent client rotation keeps its URL and removes unused server copies', async () => {
  const { files, store } = setup()
  files.add(`${prefix}client.jpg`)
  store.commit = async () => false
  await processPhotoRevocation(store, job, url)
  assert.deepEqual([...files], [`${prefix}client.jpg`])
})
test('foreign hosts and paths cannot turn the revocation worker into arbitrary deletion', async () => {
  for (const old_url of [job.old_url.replace('db.invalid', 'evil.invalid'), job.old_url.replace(owner, desk), job.old_url + '?x=1']) {
    const { store, operations } = setup()
    await assert.rejects(processPhotoRevocation(store, { ...job, old_url }, url), /INVALID_REVOCATION/)
    assert.deepEqual(operations, [])
  }
})
