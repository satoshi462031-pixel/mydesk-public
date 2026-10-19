import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { DeskPlan, Gadget, NodeOffset } from '../src/types'
import { computeMapLayout, type MapNode } from '../src/utils/connectionMapLayout'
import { nearestPlacement, overlappingPlacementIds, placementOverlaps, resolvePlacementDrag, resolvePlacementResize } from '../src/utils/placementGesture'

const rect = (id: string, x: number, y = 100, w = 100, h = 100) => ({ id, x, y, w, h })
const gadget = (id: string): Gadget => ({ id, name: id, category: 'PC', ports: [], createdAt: '2026-10-16' })
const file = 'src/components/organisms/ConnectionMap.tsx'
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const offsetHelper = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === 'offsetAfterMove')!
const offsetAfterMove = runInNewContext(ts.transpileModule(`(${offsetHelper.getText(source)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText) as (prev: NodeOffset, node: MapNode, dx: number, dy: number) => NodeOffset

test('完全に重なる整列候補には吸着せず、近くの空き位置を整数座標で返す', () => {
  const node = rect('a', 100, 100, 80), peer = rect('b', 300)
  const drag = resolvePlacementDrag(node, [peer], 198, 0, 6)
  assert.equal(drag.dx, 198)
  assert.equal(drag.guideX, null)
  const target = nearestPlacement(node, [peer], node.x + drag.dx, node.y + drag.dy)!
  assert.ok(target)
  assert.equal(placementOverlaps({ ...node, ...target }, peer, 12), false)
  assert.ok(Number.isInteger(target.x) && Number.isInteger(target.y))
  assert.ok(Math.hypot(target.x - 298, target.y - 100) <= 96)
  assert.deepEqual(peer, rect('b', 300))
})

test('密集した場所では遠くへ自動補正せず、明示的な解消操作には広い探索範囲を使える', () => {
  const node = rect('a', 100), peers = [rect('cover', 200, 28, 320, 320), rect('right', 532, 28, 100, 320)]
  assert.equal(nearestPlacement(node, peers, 350, 130), null)
  const target = nearestPlacement(node, peers, 350, 130, 600)!
  assert.ok(target)
  assert.ok(peers.every(peer => !placementOverlaps({ ...node, ...target }, peer, 12)))
})

test('リサイズは隣の機材との余白で止まり、同じ要求から同じ確定サイズを得る', () => {
  const nodes = [rect('a', 100), rect('b', 300)]
  const preview = resolvePlacementResize(nodes, ['a'], 240, 100)
  assert.equal(preview.limited, true)
  assert.ok(preview.w <= 188 && preview.w >= 187)
  assert.equal(preview.h, 100)
  assert.equal(placementOverlaps({ ...nodes[0], ...preview }, nodes[1], 12), false)
  assert.deepEqual(resolvePlacementResize(nodes, ['a'], 240, 100), preview)
  assert.deepEqual(resolvePlacementResize(nodes, ['a'], 80, 80), { w: 80, h: 80, limited: false })
})

test('左右ペアのリサイズは反対側の隣接機材とペア同士の重なりも検査する', () => {
  const nodes = [rect('left', 100), rect('right', 300), rect('peer', 450)]
  const size = resolvePlacementResize(nodes, ['right', 'left'], 240, 140)
  const resized = nodes.map(node => node.id === 'peer' ? node : { ...node, ...size })
  assert.equal(size.limited, true)
  assert.equal(overlappingPlacementIds(resized).size, 0)
  assert.equal(resized[0].w, resized[1].w)
  assert.ok(size.w <= 138)
})

test('既存の重なりは検出するだけで変更せず、リサイズで縮めることはできる', () => {
  const nodes = [rect('hidden', 100), rect('front', 100), rect('other', 400)]
  const before = structuredClone(nodes)
  assert.deepEqual([...overlappingPlacementIds(nodes)], ['hidden', 'front'])
  assert.deepEqual(nodes, before)
  assert.equal(resolvePlacementResize(nodes, ['hidden'], 80, 80).limited, false)
  const size = resolvePlacementResize(nodes, ['hidden'], 200, 200)
  assert.equal(size.w, 100)
  assert.equal(size.h, 100)
})

test('自動退避済みのカードを動かしても、表示位置を基準に保存し、周囲を動かさない', async () => {
  const gadgets = [gadget('a'), gadget('b')]
  const base = await computeMapLayout(gadgets, [], [], {}, {})
  const a = base.nodes.find(node => node.id === 'a')!, b = base.nodes.find(node => node.id === 'b')!
  const originalOffsets: Record<string, NodeOffset> = { a: { bx: a.x, by: a.y, dx: b.x - a.x, dy: 0 } }
  const before = await computeMapLayout(gadgets, [], [], originalOffsets, {})
  const pushed = before.nodes.find(node => node.id === 'b')!
  assert.notEqual(pushed.x, pushed.baseX)
  for (const id of ['a', 'b']) {
    const offsets: Record<string, NodeOffset> = {}
    for (const node of before.nodes) offsets[node.id] = offsetAfterMove(originalOffsets[node.id] ?? { dx: 0, dy: 0 }, node, 0, node.id === id ? 220 : 0)
    const after = await computeMapLayout(gadgets, [], [], offsets, {})
    for (const node of before.nodes) {
      const saved = after.nodes.find(next => next.id === node.id)!
      assert.equal(saved.x, node.x)
      assert.equal(saved.y, node.y + (node.id === id ? 220 : 0))
    }
    assert.equal(overlappingPlacementIds(after.nodes).size, 0)
  }
})

test('リサイズで自動配置の基準が変わっても、保存後の位置と寸法はプレビューと一致する', async () => {
  const gadgets = [gadget('a'), gadget('b')]
  const before = await computeMapLayout(gadgets, [], [], {}, {})
  const a = before.nodes.find(node => node.id === 'a')!
  const size = resolvePlacementResize(before.nodes, ['a'], a.w + 100, a.h + 40)
  const offsets = Object.fromEntries(before.nodes.map(node => [node.id, offsetAfterMove({ dx: 0, dy: 0 }, node, 0, 0)]))
  const after = await computeMapLayout(gadgets, [], [], offsets, { a: { w: size.w, h: size.h } })
  for (const node of before.nodes) {
    const saved = after.nodes.find(next => next.id === node.id)!
    assert.equal(saved.x, node.x)
    assert.equal(saved.y, node.y)
  }
  assert.equal(after.nodes.find(node => node.id === 'a')!.w, size.w)
  assert.equal(overlappingPlacementIds(after.nodes).size, 0)
})

test('履歴のリサイズ時は編集中の日の周囲を固定し、別の日の周囲の配置を上書きしない', async () => {
  const source = ts.createSourceFile('History.tsx', readFileSync('src/components/organisms/DeskHistoryLayoutEditModal.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let save: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'saveNodeSizesGlobal') save = (node.initializer as ts.CallExpression).arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(save)
  const date = '2026-10-16', otherDate = '2026-10-15'
  const planRef = { current: {
    id: 'desk', connectionMap: {
      connections: [], nodeOffsets: { b: { dx: 5, dy: 0 } },
      historyLayout: { [otherDate]: { nodeOffsets: { b: { dx: 9, dy: 0 } } } },
    },
  } as unknown as DeskPlan }
  const callback = runInNewContext(ts.transpileModule(`(${save.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    planRef, events: [{ date }],
    resolveHistoryLayoutInputs: () => ({ inputs: [{ nodeSizes: { a: { w: 100, h: 100 }, b: { w: 100, h: 100 } } }] }),
    onUpdatePlan: async (_id: string, mutate: (plan: DeskPlan) => DeskPlan) => { planRef.current = mutate(planRef.current) },
  }) as (date: string, sizes: Record<string, { w: number; h: number }>, offsets: Record<string, NodeOffset>, ids: string[]) => Promise<void>
  await callback(date, { a: { w: 120, h: 100 }, b: { w: 100, h: 100 } }, { a: { dx: 0, dy: 0 }, b: { dx: 30, dy: 0 } }, ['a', 'b'])
  assert.equal(planRef.current.connectionMap!.historyLayout![date].nodeOffsets!.b.dx, 30)
  assert.equal(planRef.current.connectionMap!.historyLayout![otherDate].nodeOffsets!.b.dx, 9)
  assert.equal(planRef.current.connectionMap!.nodeOffsets!.b.dx, 5)
})
