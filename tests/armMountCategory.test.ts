import assert from 'node:assert/strict'
import test from 'node:test'
import { armMountCategory } from '../src/utils/gadgetPorts'
import { Gadget } from '../src/types'

function mounted(type?: 'MonitorArm' | 'MicArm'): Gadget {
  return {
    id: 'mounted', name: 'mounted', category: 'Microphone', createdAt: '2026-01-01',
    ports: type ? [{ type, direction: 'input', count: 1 }] : [],
  } as Gadget
}

test('実際のアームポートでバッジのカテゴリを決める', () => {
  assert.equal(armMountCategory(mounted('MonitorArm')), 'MonitorArm')
  assert.equal(armMountCategory(mounted('MicArm')), 'MicArm')
  assert.equal(armMountCategory(mounted()), null)
})

test('アーム本体の出力ポートには装着バッジを出さない', () => {
  const arm = {
    id: 'arm', name: 'arm', category: 'MonitorArm', createdAt: '2026-01-01',
    ports: [{ type: 'MonitorArm', direction: 'output', count: 1 }],
  } as Gadget

  assert.equal(armMountCategory(arm), null)
})
