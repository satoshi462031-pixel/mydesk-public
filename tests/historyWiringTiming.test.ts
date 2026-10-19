import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { buildDemoDesk, DEMO_DESKS } from '../src/constants/demoDesks'
import { isWirelessPortType, portColor } from '../src/constants/portTypes'
import { baseMapNodeId, computeMapLayout, MapEdge, MapLayout, MapNode, pointsToPath, pointsToRoundedPath, wavyPath } from '../src/utils/connectionMapLayout'
import { buildTimeline } from '../src/utils/deskTimeline'
import { sortEdgesForDrawing } from '../src/utils/wireStacking'
import { WIRE_LINE_WIDTH } from '../src/constants/wiring'
import { getOpeningWiringLayout } from '../src/constants/onboardingWiring'
import type { CableType, DeskPlan, Gadget } from '../src/types'

type Span = { start: number; end: number }

function loadTiming() {
  const file = 'src/components/organisms/HistoryWiringCanvas.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const names = new Set([
    'polylineLength', 'hopsFromWall', 'assignWaveSpans', 'buildWaves', 'hopOf', 'isWirelessEdge',
    'WIRE_GAP_RATIO', 'WIRE_MIN_WEIGHT', 'WIRE_REF_LEN',
    'NODE_FADE_SPAN', 'NODE_ARRIVE_AFTER', 'NODE_ARRIVE_FADE', 'NODE_ARRIVE_MIN_FADE',
    'NODE_EXIT_FADE_SPAN', 'NODE_EXIT_DELAY', 'EXIT_NODE_MAX', 'EXIT_WIRE',
    'WIRE_FADE_OUT', 'MOVE_SPAN', 'WIRE_FADE_IN', 'WIRE_START', 'NO_EXIT_WIRE_START',
    'FIRST_WIRE_START', 'WIRE_ENTER_END', 'NODE_ISOLATED_T', 'TRANSIENT_EXIT_WIRE',
    'GLOW_SPAN', 'isBadgeOnlyEdge', 'isMobileBatteryChargeEdge', 'samePath', 'pathIntersectsRect',
  ])
  const declarations = source.statements.filter(node =>
    ts.isFunctionDeclaration(node) ? names.has(node.name?.text ?? '')
      : ts.isVariableStatement(node) && node.declarationList.declarations.every(item => names.has(item.name.getText(source))))
  let enterRange: ts.VariableStatement | undefined
  let exitRange: ts.VariableStatement | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'enterRangeOf')) enterRange = node
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(source) === 'exitRangeOf')) exitRange = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(enterRange)
  assert.ok(exitRange)
  const layer = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'LayoutLayer')!
  const prepared = layer.body!.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
    .find(node => node.name.getText(source) === 'prepared')!
  assert.ok(prepared.initializer && ts.isCallExpression(prepared.initializer))
  const prepareCallback = prepared.initializer.arguments[0]
  assert.ok(ts.isArrowFunction(prepareCallback))
  const code = ts.transpileModule([
    ...declarations.map(node => node.getText(source)),
    `const nodeRange = (drawnEdges, edgeSpan, isolatedT, nodeId) => { ${enterRange.getText(source)} return enterRangeOf(nodeId) }`,
    `const nodeExitRange = (drawnEdges, exitSpan, nodeId) => { ${exitRange.getText(source)} return exitRangeOf(nodeId) }`,
    `const prepare = (layout, prevLayout, exitingNodes, exitingEdges) => {
      const C = { bgList: '#000000', textMuted: '#888888' }
      const isDark = false, animateMove = false
      const replacementPairs = new Map(), glowCableTypes = new Set()
      return (${prepareCallback.getText(source)})()
    }`,
    '({ assignWaveSpans, hopsFromWall, buildWaves, nodeRange, nodeExitRange, prepare })',
  ].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return runInNewContext(code, { isWirelessPortType, baseMapNodeId, portColor, pointsToPath, pointsToRoundedPath, wavyPath, sortEdgesForDrawing, WIRE_LINE_WIDTH }) as {
    assignWaveSpans: (waves: MapEdge[][], from: number, to: number, ready?: boolean) => Map<string, Span>
    hopsFromWall: (layout: MapLayout, edges: MapEdge[]) => Map<string, number>
    buildWaves: (edges: MapEdge[], hops: Map<string, number>, wirelessLast: boolean, farthestFirst: boolean) => MapEdge[][]
    nodeRange: (edges: MapEdge[], spans: Map<string, Span>, isolatedT: number, id: string) => [number, number]
    nodeExitRange: (edges: MapEdge[], spans: Map<string, Span>, id: string) => [number, number]
    prepare: (layout: MapLayout, previous: MapLayout | null, removedNodes: Set<string>, removedEdges: Set<string>) => {
      edges: Array<{ key: string; span: Span | null; exit: Span | null }>
      nodes: Array<{ n: MapNode; enterRange: [number, number] | null; exitRange: [number, number] | null }>
      boundaries: number[]
    }
  }
}

const timing = loadTiming()

function loadFadeRenderer() {
  const source = ts.createSourceFile('canvas.tsx', readFileSync('src/components/organisms/HistoryWiringCanvas.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let edges: ts.ArrowFunction | undefined
  let nodes: ts.ArrowFunction | undefined
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isArrowFunction(node.arguments[0])) {
      const callback = node.arguments[0]
      if (node.expression.getText(source) === 'prepared.edges.map' && callback.getText(source).includes('if (e.span')) edges = callback
      if (node.expression.getText(source) === 'prepared.nodes.map') nodes = callback
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(edges && nodes)
  const names = new Set(['PHASE_EPS', 'MOVE_SPAN', 'WIRE_FADE_OUT', 'WIRE_FADE_IN'])
  const constants = source.statements.filter(node =>
    ts.isVariableStatement(node) && node.declarationList.declarations.every(item => names.has(item.name.getText(source))))
  const phase = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'phaseAt')!
  const code = ts.transpileModule(`
    ${constants.map(node => node.getText(source)).join('\n')}
    ${phase.getText(source)}
    ((clock, edge, node, boundaries) => {
      const passed = value => phaseAt(clock, boundaries) + PHASE_EPS >= value
      const progress = { interpolate: ({ inputRange, outputRange }) => {
        const fraction = Math.max(0, Math.min(1, (clock - inputRange[0]) / (inputRange[1] - inputRange[0])))
        return outputRange[0] + (outputRange[1] - outputRange[0]) * fraction
      } }
      const drawEdge = (_edge, _path, opacity) => ({ opacity })
      return { edge: (${edges.getText(source)})(edge), node: (${nodes.getText(source)})(node) }
    })
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const jsx = (type: unknown, props: any) => ({ type, props })
  return runInNewContext(code, {
    exports: {}, require: () => ({ jsx, jsxs: jsx }), React: { Fragment: 'Fragment' },
    HistoryMotionView: 'AnimatedView', View: 'View', HistoryNode: 'HistoryNode', C: {},
    onSelectGadget: undefined, wireEasing: undefined,
  }) as (clock: number, edge: object, node: object, boundaries: number[]) => {
    edge: { opacity: number } | null
    node: { props: { style: { opacity: number } } } | null
  }
}

function node(id: string): MapNode {
  return { id, gadget: { id, name: id, category: 'PC', ports: [], createdAt: '2022-01-01' }, tier: 0, x: 0, y: 0, w: 80, h: 80, cx: 40, cy: 40, isWall: id === 'wall' }
}

function edge(id: string, from: string, to: string, length: number, cableType: CableType = 'Power'): MapEdge {
  return {
    conn: { id, fromGadgetId: from, toGadgetId: to, cableType, origin: 'auto', confirmed: true },
    from: node(from), to: node(to), points: [{ x: 0, y: 0 }, { x: length, y: 0 }],
  }
}

test('接続元に電源が届いたら、別の長い電源線を待たず映像線を引き始める', () => {
  const power = edge('pc-power', 'strip', 'pc', 120)
  const longPower = edge('monitor-power', 'strip', 'monitor', 420)
  const video = edge('video', 'pc', 'monitor', 420, 'HDMI')
  const waves = [[edge('strip-power', 'wall', 'strip', 420)], [power, longPower], [video]]
  const spans = timing.assignWaveSpans(waves, 0.12, 0.9, true)
  assert.equal(spans.get('video')!.start, spans.get('pc-power')!.end)
  assert.ok(spans.get('video')!.start < spans.get('monitor-power')!.end)
  const reversed = timing.assignWaveSpans([waves[0], [longPower, power], waves[2]], 0.12, 0.9, true)
  for (const [id, span] of spans) assert.deepEqual(reversed.get(id), span)
})

test('早く引き始めても接続元は給電線の到着に合わせて現れ、映像線開始時には表示を終える', () => {
  const edges = [edge('power', 'strip', 'pc', 120), edge('video', 'pc', 'monitor', 420, 'HDMI')]
  const spans = timing.assignWaveSpans([[edges[0]], [edges[1]]], 0.12, 0.9, true)
  const range = timing.nodeRange(edges, spans, 0.9, 'pc')
  assert.ok(range[0] > spans.get('power')!.start)
  assert.equal(range[1], spans.get('power')!.end)
  assert.equal(range[1], spans.get('video')!.start)
})

test('無線の開始と撤去の順序は、前の段が完了してからに保つ', () => {
  const power = edge('power', 'wall', 'pc', 120)
  const longPower = edge('long-power', 'wall', 'speaker', 420)
  const wireless = edge('wireless', 'pc', 'mouse', 100, 'Bluetooth')
  const spans = timing.assignWaveSpans([[power, longPower], [wireless]], 0.12, 0.9, true)
  assert.ok(spans.get('wireless')!.start > spans.get('long-power')!.end)
  const exit = timing.assignWaveSpans([[power, longPower], [edge('video', 'pc', 'monitor', 420, 'HDMI')]], 0.36, 0.48)
  assert.ok(exit.get('video')!.start > exit.get('long-power')!.end)
})

test('Bluetoothだけにつながるガジェットは、線の向きに関係なく線と同時にフェードインする', () => {
  const wireless = edge('wireless', 'pc', 'mouse', 100, 'Bluetooth')
  const spans = timing.assignWaveSpans([[wireless]], 0.12, 0.9, true)
  const { start, end } = spans.get('wireless')!
  for (const id of ['pc', 'mouse']) {
    assert.deepEqual([...timing.nodeRange([wireless], spans, 0.9, id)], [start, end])
  }
})

test('Bluetoothだけにつながるガジェットは、線の向きに関係なく線と同時にフェードアウトする', () => {
  const wireless = edge('wireless', 'pc', 'mouse', 100, 'Bluetooth')
  const spans = timing.assignWaveSpans([[wireless]], 0.36, 0.48)
  const { start, end } = spans.get('wireless')!
  for (const id of ['pc', 'mouse']) {
    assert.deepEqual([...timing.nodeExitRange([wireless], spans, id)], [start, end])
  }
})

test('同じ段のBluetooth接続は、線の長さに関係なく同じ時間をかけてフェードする', () => {
  const short = edge('short', 'pc', 'mouse', 1, 'Bluetooth')
  const long = edge('long', 'pc', 'keyboard', 420, 'Bluetooth')
  for (const [from, to] of [[0.12, 0.9], [0.36, 0.48]]) {
    const spans = timing.assignWaveSpans([[short, long]], from, to)
    assert.deepEqual(spans.get('short'), spans.get('long'))
  }
})

test('電源線も持つBluetooth機材は、導入では給電に合わせ、撤去では給電線が離れるまで残る', () => {
  const power = edge('power', 'wall', 'pc', 120)
  const wireless = edge('wireless', 'pc', 'mouse', 100, 'Bluetooth')
  const edges = [power, wireless]
  const enter = timing.assignWaveSpans([[power], [wireless]], 0.12, 0.9, true)
  const range = timing.nodeRange(edges, enter, 0.9, 'pc')
  assert.equal(range[1], enter.get('power')!.end)
  assert.ok(range[1] <= enter.get('wireless')!.start)
  const exit = timing.assignWaveSpans([[wireless], [power]], 0.36, 0.48)
  const exitRange = timing.nodeExitRange(edges, exit, 'pc')
  assert.equal(exitRange[0], exit.get('power')!.start)
  assert.ok(exitRange[0] >= exit.get('wireless')!.end)
})

test('Bluetoothの導入・撤去を途中へシークし、逆方向へ戻しても、線と機材の実際の透明度が一致する', () => {
  const render = loadFadeRenderer()
  const wireless = edge('wireless', 'pc', 'mouse', 100, 'Bluetooth')
  for (const entering of [true, false]) {
    const spans = timing.assignWaveSpans([[wireless]], entering ? 0.12 : 0.36, entering ? 0.9 : 0.48)
    const span = spans.get('wireless')!
    const range = entering
      ? timing.nodeRange([wireless], spans, 0.9, 'mouse')
      : timing.nodeExitRange([wireless], spans, 'mouse')
    const edgeRender = { fade: true, baseOpacity: 1, dFinal: 'wireless', ...(entering ? { span } : { exit: span }) }
    const nodeRender = { n: node('mouse'), atOrigin: node('mouse'), ...(entering ? { enterRange: range } : { exitRange: range }) }
    const boundaries = [...new Set([span.start, span.end, ...range])].sort((a, b) => a - b)
    for (const fraction of [-0.1, 0.5, 1.1, 0.5, -0.1, 0.5, 1.1]) {
      const clock = span.start + (span.end - span.start) * fraction
      const result = render(clock, edgeRender, nodeRender, boundaries)
      const hidden = entering ? fraction < 0 : fraction > 1
      if (hidden) {
        assert.equal(result.edge, null)
        assert.equal(result.node, null)
      } else {
        const expected = entering ? Math.min(1, fraction) : Math.min(1, 1 - fraction)
        assert.ok(Math.abs(result.edge!.opacity - expected) < 0.000001)
        assert.ok(Math.abs(result.node!.props.style.opacity - expected) < 0.000001)
      }
    }
  }
})

test('同じ月に追加・撤去したBluetooth機材は、接続を表示してから消え、巻き戻しでも復元できる', async () => {
  const pc: Gadget = { ...node('pc').gadget, purchasedAt: '2024-01-01', ports: [{ id: 'pc-bt', type: 'Bluetooth', direction: 'bidirectional', count: 1 }] }
  const mouse: Gadget = { ...node('mouse').gadget, category: 'Mouse', purchasedAt: '2024-02-01', removedAt: '2024-02-20', powerUsage: 'replaceable', ports: [{ id: 'mouse-bt', type: 'Bluetooth', direction: 'output', count: 1 }] }
  const plan: DeskPlan = { id: 'bt-history', name: 'Bluetooth', goal: 'improve_desk', selectedGadgetIds: [pc.id, mouse.id], placements: [], createdAt: '2024-01-01', updatedAt: '2024-02-20' }
  const [before, event] = buildTimeline([pc, mouse], plan, 'ja', 'month')
  const previous = await computeMapLayout(before.renderGadgets, before.renderConnections, [])
  const layout = await computeMapLayout(event.renderGadgets, event.renderConnections, [])
  const connection = event.renderConnections.find(item => item.cableType === 'Bluetooth')!
  assert.ok(connection)
  const prepared = timing.prepare(layout, previous, new Set([mouse.id]), new Set([connection.id]))
  const line = prepared.edges.find(item => item.key === connection.id)!
  const gadget = prepared.nodes.find(item => item.n.id === mouse.id)!
  assert.ok(line.span && line.exit && gadget.enterRange && gadget.exitRange)
  assert.ok(line.exit.start >= line.span.end, '導入前に撤去している')
  assert.ok(gadget.exitRange[0] >= gadget.enterRange[1])
  const render = loadFadeRenderer()
  for (const clock of [line.span.start - 0.01, (line.span.start + line.span.end) / 2, line.span.end, (line.exit.start + line.exit.end) / 2, 1, line.span.end, 1]) {
    const result = render(clock, { ...line, fade: true, baseOpacity: 1, dFinal: 'wireless' }, { ...gadget, atOrigin: gadget.n }, prepared.boundaries)
    if (clock < line.span.start || clock === 1) {
      assert.equal(result.edge, null)
      assert.equal(result.node, null)
    } else {
      const expected: number = clock === line.span.end ? 1 : 0.5
      assert.ok(Math.abs(result.edge!.opacity - expected) < 0.000001)
      assert.ok(Math.abs(result.node!.props.style.opacity - expected) < 0.000001)
    }
  }
})

for (const mobile of [false, true]) {
  test(`ワイヤレス充電の波線と機材は導入・撤去・巻き戻しで同時にフェードする（${mobile ? 'モバイルバッテリー' : '常時給電'}）`, async () => {
    const source: Gadget = {
      ...node('qi-source').gadget, category: mobile ? 'MobileBattery' : 'Charger', purchasedAt: '2024-01-01',
      ports: [
        { id: 'qi-out', type: 'wirelessCharging', direction: 'output', count: 1 },
        ...(mobile ? [] : [{ id: 'power-in', type: 'Power' as const, direction: 'input' as const, count: 1 }]),
      ],
    }
    const target: Gadget = {
      ...node('qi-target').gadget, category: 'Smartphone', purchasedAt: '2024-02-01', removedAt: '2024-02-20',
      powerUsage: mobile ? 'rechargeable' : 'continuous',
      ports: [{ id: 'qi-in', type: 'wirelessCharging', direction: 'input', count: 1 }],
    }
    const plan: DeskPlan = { id: 'qi-history', name: 'Qi', goal: 'improve_desk', selectedGadgetIds: [source.id, target.id], outletCount: mobile ? 0 : 1, outletCountVersion: 2, placements: [], createdAt: '2024-01-01', updatedAt: '2024-02-20' }
    const [before, event] = buildTimeline([source, target], plan, 'ja', 'month')
    const previous = await computeMapLayout(before.renderGadgets, before.renderConnections, [])
    const layout = await computeMapLayout(event.renderGadgets, event.renderConnections, [])
    const connection = event.renderConnections.find(item => item.cableType === 'wirelessCharging')!
    assert.ok(connection)
    const prepared = timing.prepare(layout, previous, new Set([target.id]), new Set([connection.id]))
    const line = prepared.edges.find(item => item.key === connection.id)!
    const gadget = prepared.nodes.find(item => item.n.id === target.id)!
    assert.ok(line.span && line.exit && gadget.enterRange && gadget.exitRange)
    assert.deepEqual([...gadget.enterRange], [line.span.start, line.span.end])
    assert.deepEqual([...gadget.exitRange], [line.exit.start, line.exit.end])
    assert.ok(line.exit.start >= line.span.end)
    const render = loadFadeRenderer()
    const baseOpacity = mobile ? 0.78 : 1
    for (const clock of [0, (line.span.start + line.span.end) / 2, line.span.end, (line.exit.start + line.exit.end) / 2, 1, line.span.end, 0, 1]) {
      const result = render(clock, line, { ...gadget, atOrigin: gadget.n }, prepared.boundaries)
      if (clock < line.span.start || clock === 1) {
        assert.equal(result.edge, null)
        assert.equal(result.node, null)
      } else {
        const expected: number = clock === line.span.end ? 1 : 0.5
        assert.ok(Math.abs(result.edge!.opacity - expected * baseOpacity) < 0.000001)
        assert.ok(Math.abs(result.node!.props.style.opacity - expected) < 0.000001)
      }
    }
  })
}

test('左右とも新しく置くスピーカーは、左右とペア線が同時に現れる', async () => {
  const speaker: Gadget = { ...node('speaker').gadget, category: 'Speaker', stereoPair: true,
    ports: [{ id: 'power', type: 'Power', direction: 'input', count: 1 }, { id: 'audio', type: 'Audio3_5mm', direction: 'input', count: 1 }] }
  const layout = await computeMapLayout([speaker], [{ id: 'speaker-power', fromGadgetId: 'wall', toGadgetId: speaker.id, cableType: 'Power', origin: 'auto', confirmed: true }], [])
  const prepared = timing.prepare(layout, null, new Set(), new Set())
  const pair = layout.edges.find(item => item.isPairLink)!
  assert.ok(pair)
  const left = prepared.nodes.find(item => item.n.id === pair.from.id)!.enterRange!
  const right = prepared.nodes.find(item => item.n.id === pair.to.id)!.enterRange!
  assert.deepEqual([...left], [...right])
  const span = prepared.edges.find(item => item.key === pair.conn.id)!.span!
  assert.deepEqual([span.start, span.end], [...left])
})

test('オープニングはPCへの給電到着から映像・キーボード・マウス・音声の4本を同時に同じ速度で伸ばす', () => {
  Object.assign(globalThis, { __DEV__: false })
  const layout = getOpeningWiringLayout()
  const prepared = timing.prepare(layout, null, new Set(), new Set())
  const pcPower = layout.edges.find(e => e.to.id === 'opening-pc' && e.conn.cableType === 'Power')!
  const ready = prepared.edges.find(e => e.key === pcPower.conn.id)!.span!.end
  const outgoing = layout.edges.filter(e => e.from.id === 'opening-pc')
  assert.equal(outgoing.length, 4)
  assert.deepEqual(outgoing.map(e => e.conn.cableType).sort(), ['Audio3_5mm', 'DisplayPort', 'USB_A', 'USB_C'])
  const speeds = outgoing.map(e => {
    const span = prepared.edges.find(item => item.key === e.conn.id)!.span!
    assert.equal(span.start, ready)
    const length = e.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - e.points[i].x, p.y - e.points[i].y), 0)
    return length / (span.end - span.start)
  })
  for (const speed of speeds) assert.ok(Math.abs(speed - speeds[0]) < 0.000001)
})

test('ゲーミングのデモの最初のPC導入で、PC出現直後にモニターの映像線を引き始める', async () => {
  const demo = buildDemoDesk(DEMO_DESKS.find(item => item.id === 'demo-gaming')!)
  const event = buildTimeline(demo.gadgets, demo.plan, 'ja', 'month').find(item => item.inGadgets.some(gadget => gadget.category === 'PC'))!
  const layout = await computeMapLayout(event.renderGadgets, event.renderConnections, demo.plan.placements, {}, {})
  const edges = layout.edges.filter(item => !isWirelessPortType(item.conn.cableType))
  const waves = timing.buildWaves(edges, timing.hopsFromWall(layout, edges), true, false)
  const spans = timing.assignWaveSpans(waves, 0.12, 0.9, true)
  const oldSpans = timing.assignWaveSpans(waves, 0.12, 0.9)
  const video = edges.find(item => item.from.gadget.category === 'PC' && item.to.gadget.category === 'Monitor' && item.conn.cableType !== 'Power')!
  assert.ok(video)
  const pcPower = edges.find(item => item.to.id === video.from.id && item.conn.cableType === 'Power')!
  assert.equal(spans.get(video.conn.id)!.start, spans.get(pcPower.conn.id)!.end)
  assert.ok(oldSpans.get(video.conn.id)!.start - spans.get(video.conn.id)!.start > 0.1)
  assert.equal(timing.nodeRange(edges, spans, 0.9, video.from.id)[1], spans.get(video.conn.id)!.start)
})
