import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPersonalizedResult } from '../src/utils/activation'
import { parseSetupScanResponse } from '../src/utils/setupScanResponse'
import type { Gadget, WiringResult } from '../src/types'

const gadget = (id: string, extra: Partial<Gadget> = {}): Gadget => ({
  id,
  name: id,
  category: 'PC',
  ports: [],
  createdAt: '2026-08-31T00:00:00.000Z',
  ...extra,
})

describe('setup flow activation', () => {
  it('does not count a template placeholder as a personalized result', () => {
    const result: WiringResult = { connections: [], requiredCables: [], warnings: ['check'] }
    assert.equal(isPersonalizedResult([gadget('a'), gadget('b', { isPlaceholder: true })], result), false)
  })

  it('counts two actual devices when the result has an actionable next step', () => {
    const result: WiringResult = { connections: [], requiredCables: [], warnings: [] }
    assert.equal(isPersonalizedResult([
      gadget('a', { portsNeedConfirmation: true }),
      gadget('b'),
    ], result), true)
  })
})

describe('setup photo response', () => {
  it('parses fenced JSON and normalizes unknown values', () => {
    const parsed = parseSetupScanResponse('```json\n{"devices":[{"name":"MacBook Pro","category":"PC","confidence":"high"},{"name":"Mystery","category":"Unknown","confidence":"certain"}]}\n```')
    assert.deepEqual(parsed, [
      { name: 'MacBook Pro', category: 'PC', confidence: 'high' },
      { name: 'Mystery', category: 'Other', confidence: 'low' },
    ])
  })

  it('rejects a response without a device array', () => {
    assert.throws(() => parseSetupScanResponse('{"message":"nope"}'), /AI_SCAN_INVALID_RESPONSE/)
  })

  it('normalizes common AI category aliases without losing the device', () => {
    assert.deepEqual(parseSetupScanResponse('{"devices":[{"name":"Laptop","category":"laptop","confidence":"medium"},{"name":"画面","category":"モニター","confidence":"high"}]}'), [
      { name: 'Laptop', category: 'PC', confidence: 'medium' },
      { name: '画面', category: 'Monitor', confidence: 'high' },
    ])
  })
})
