import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeGadgetOrder, moveGadgetId, orderGadgetsByIds } from '../src/utils/gadgetOrder'

describe('custom desk gadget order', () => {
  it('moves an item in either direction without changing the other items', () => {
    const ids = ['monitor', 'keyboard', 'mouse', 'lamp']
    assert.deepEqual(moveGadgetId(ids, 0, 3), ['keyboard', 'mouse', 'lamp', 'monitor'])
    assert.deepEqual(moveGadgetId(ids, 3, 0), ['lamp', 'monitor', 'keyboard', 'mouse'])
    assert.deepEqual(moveGadgetId(ids, 1, 1), ids)
    assert.deepEqual(ids, ['monitor', 'keyboard', 'mouse', 'lamp'])
  })

  it('restores the saved order and puts newly added items after existing items', () => {
    const items = [{ id: 'mouse' }, { id: 'new-lamp' }, { id: 'keyboard' }, { id: 'monitor' }]
    assert.deepEqual(orderGadgetsByIds(items, ['monitor', 'keyboard', 'mouse']).map((g) => g.id), ['monitor', 'keyboard', 'mouse', 'new-lamp'])
    assert.equal(items[0].id, 'mouse')
  })

  it('reorders one genre while preserving the positions of other genres', () => {
    const current = ['monitor', 'speaker-l', 'keyboard', 'speaker-r', 'mouse']
    assert.deepEqual(mergeGadgetOrder(current, ['speaker-r', 'speaker-l'], current), ['monitor', 'speaker-r', 'keyboard', 'speaker-l', 'mouse'])
  })

  it('keeps concurrent additions and removes stale items when saving a drag', () => {
    assert.deepEqual(
      mergeGadgetOrder(['monitor', 'keyboard', 'mouse'], ['mouse', 'monitor', 'keyboard'], ['monitor', 'mouse', 'new-lamp']),
      ['mouse', 'monitor', 'new-lamp'],
    )
  })

  it('keeps each selected item once even if a saved order contains duplicates', () => {
    assert.deepEqual(mergeGadgetOrder(['monitor', 'monitor', 'removed'], ['mouse', 'mouse', 'monitor'], ['monitor', 'mouse']), ['mouse', 'monitor'])
  })
})
