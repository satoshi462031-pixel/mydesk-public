import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Gadget } from '../src/types'
import { isUnfilledSlot, publishGadgetIssue } from '../src/utils/publishRequirements'

function gadget(id: string, patch: Partial<Gadget> = {}): Gadget {
  return { id, name: `機材${id}`, category: 'Monitor', ports: [], createdAt: '2026-01-01', ...patch } as Gadget
}

describe('publishGadgetIssue', () => {
  it('0台のデスクは公開できない', () => {
    assert.deepEqual(publishGadgetIssue({ selectedGadgetIds: [] }, [gadget('a')]), { kind: 'empty' })
  })

  it('全部に商品名が入っていれば公開できる', () => {
    assert.equal(publishGadgetIssue({ selectedGadgetIds: ['a', 'b'] }, [gadget('a'), gadget('b')]), null)
  })

  it('枠が1つでも残っていれば止める（件数も返す）', () => {
    const gadgets = [gadget('a'), gadget('p', { isPlaceholder: true }), gadget('e', { name: '  ' })]
    assert.deepEqual(publishGadgetIssue({ selectedGadgetIds: ['a', 'p', 'e'] }, gadgets), { kind: 'unfilled', count: 2 })
  })

  it('撤去済み・デスクに入っていない機材は数えない', () => {
    const gadgets = [gadget('a'), gadget('r', { isPlaceholder: true, removedAt: '2026-02-01' }), gadget('x', { isPlaceholder: true })]
    assert.equal(publishGadgetIssue({ selectedGadgetIds: ['a', 'r'] }, gadgets), null)
  })

  it('ケーブルしか無いデスクは0台と同じに扱う', () => {
    assert.deepEqual(publishGadgetIssue({ selectedGadgetIds: ['c'] }, [gadget('c', { category: 'Cable' })]), { kind: 'empty' })
  })
})

describe('isUnfilledSlot', () => {
  it('見えない文字だけの名前は空と同じ', () => {
    assert.equal(isUnfilledSlot(gadget('z', { name: '​' })), true)
  })
})
