import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildAllDemoDesks } from '../src/constants/demoDesks'
import type { CableType, MapConnection } from '../src/types'
import { mapPairKey, reconcileMap } from '../src/utils/connectionMapLayout'

// ケーブルの編集（配線図で線をタップ → ケーブル種別を変える）を、
// ConnectionMap.updateCable と WiringResultScreen.handleMapChange が実際にやる手順で再現する。
// 検証は実データ（デモデスク）で行う。最小構成だと自動下書きの分岐に乗らない。

/** ConnectionMap.updateCable：自動の線は id を付け替えて manual へ昇格させる */
function updateCable(connections: MapConnection[], id: string, cable: CableType): MapConnection[] {
  return connections.map((c) => {
    if (c.id !== id) return c
    return c.origin === 'auto'
      ? { ...c, id: `map-manual-${Date.now()}`, cableType: cable, origin: 'manual' as const, confirmed: true }
      : { ...c, cableType: cable, confirmed: true }
  })
}

/** WiringResultScreen.handleMapChange：消えた線のペアを dismissedPairs へ積んでから突き合わせる */
function applyMapChange(
  prev: MapConnection[],
  next: MapConnection[],
  plan: any,
  gadgets: any[],
): { connections: MapConnection[]; dismissedPairs: string[] } {
  const nextIds = new Set(next.map((c) => c.id))
  const dismissed = new Set<string>(plan.connectionMap?.dismissedPairs ?? [])
  let deleted = false
  for (const c of prev) {
    if (!nextIds.has(c.id)) {
      deleted = true
      dismissed.add(mapPairKey(c.fromGadgetId, c.toGadgetId, c.cableType))
    }
  }
  const nextPlan = {
    ...plan,
    connectionMap: { ...plan.connectionMap, connections: next, dismissedPairs: [...dismissed] },
  }
  const connections = deleted ? reconcileMap(next, gadgets, nextPlan, 'ja') : next
  return { connections, dismissedPairs: [...dismissed] }
}

const between = (conns: MapConnection[], a: string, b: string) =>
  conns.filter((c) =>
    (c.fromGadgetId === a && c.toGadgetId === b) || (c.fromGadgetId === b && c.toGadgetId === a))

describe('ケーブルの編集', () => {
  for (const demo of buildAllDemoDesks('ja')) {
    it(`${demo.plan.name}：自動の線の種別を変えても、同じ2台の間の線が増えない`, () => {
      const gadgets = demo.gadgets
      const start = demo.plan.connectionMap?.connections ?? []
      // 種別を選び直せるのは有線の自動接続。無線・電源ソースは対象外
      const target = start.find((c) =>
        c.origin !== 'manual' && !c.wireless && c.cableType !== 'wirelessCharging'
        && !c.fromGadgetId.startsWith('__') && !c.toGadgetId.startsWith('__'))
      if (!target) return

      const other: CableType = target.cableType === 'HDMI' ? 'DisplayPort' : 'HDMI'
      const next = updateCable(start, target.id, other)
      const { connections } = applyMapChange(start, next, demo.plan, gadgets)

      const pair = between(connections, target.fromGadgetId, target.toGadgetId)
      assert.equal(
        pair.length,
        1,
        `${target.fromGadgetId}–${target.toGadgetId} は1本のはず（実際は ${pair.length} 本: `
          + `${pair.map((c) => `${c.cableType}/${c.origin}`).join(', ')}）`,
      )
      assert.equal(pair[0].cableType, other, '選んだ種別が残ること')
    })
  }
})
