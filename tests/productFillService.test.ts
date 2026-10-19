import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { saveProductFillEntries } from '../src/services/productFillService'
import { Gadget } from '../src/types'

const placeholder = (id: string): Gadget => ({
  id,
  name: 'PC',
  category: 'PC',
  ports: [],
  isPlaceholder: true,
  createdAt: '2026-01-01T00:00:00.000Z',
})

describe('ProductFill transaction', () => {
  it('updates all gadgets once, then clears the draft and tracks completion', async () => {
    const calls: string[] = []
    let saved: Gadget[] = []
    const count = await saveProductFillEntries([
      { gadget: placeholder('a'), name: 'Mac mini' },
      { gadget: placeholder('b'), name: 'Gaming PC' },
    ], {
      resolveUrl: async ({ gadget }) => {
        calls.push(`resolve:${gadget.id}`)
        return gadget.id === 'a' ? 'https://example.com/a' : null
      },
      updateMany: async (gadgets) => {
        calls.push('updateMany')
        saved = gadgets
      },
      clearDraft: async () => { calls.push('clearDraft') },
      trackFirstItem: async (updatedCount) => { calls.push(`track:${updatedCount}`) },
    })

    assert.equal(count, 2)
    assert.deepEqual(calls, ['resolve:a', 'resolve:b', 'updateMany', 'clearDraft', 'track:2'])
    assert.deepEqual(saved.map(({ name, isPlaceholder }) => ({ name, isPlaceholder })), [
      { name: 'Mac mini', isPlaceholder: undefined },
      { name: 'Gaming PC', isPlaceholder: undefined },
    ])
  })

  it('does not clear the draft or track success when the bulk update fails', async () => {
    let cleared = false
    let tracked = false
    await assert.rejects(
      saveProductFillEntries([{ gadget: placeholder('a'), name: 'Mac mini' }], {
        resolveUrl: async () => null,
        updateMany: async () => { throw new Error('disk full') },
        clearDraft: async () => { cleared = true },
        trackFirstItem: () => { tracked = true },
      }),
      /disk full/,
    )
    assert.equal(cleared, false)
    assert.equal(tracked, false)
  })

  it('continues without a URL and tolerates draft cleanup failure after a successful save', async () => {
    let updated = false
    let tracked = false
    await saveProductFillEntries([{ gadget: placeholder('a'), name: 'Mac mini' }], {
      resolveUrl: async () => { throw new Error('offline') },
      updateMany: async () => { updated = true },
      clearDraft: async () => { throw new Error('cleanup failed') },
      trackFirstItem: () => { tracked = true },
    })
    assert.equal(updated, true)
    assert.equal(tracked, true)
  })
})
