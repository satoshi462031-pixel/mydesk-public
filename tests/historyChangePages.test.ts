import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import type { TimelineEvent } from '../src/utils/deskTimeline'
import type { Gadget } from '../src/types'
import { historyChangePageCount, isBulkHistoryChange } from '../src/utils/historyPresentation'
import { buildTimeline, appendTodayPage } from '../src/utils/deskTimeline'
import { gadgetCategoryKey } from '../src/utils/customCategory'
import { historyChangeLabel, historyYearlyChangeLabel } from '../src/utils/historyPresentation'
import { buildHistoryReplacementLayoutPlan } from '../src/utils/historyReplacement'
import type { DeskPlan } from '../src/types'

const file = 'src/components/organisms/DeskHistoryAnimationModal.tsx'
const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const pagesFunction = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'pagesOf')!
const panelNames = new Set(['bulkChange', 'pages', 'items', 'bulkRows', 'rows', 'panelH', 'panelBorder'])
let panelBlock: ts.Block | undefined
function visit(node: ts.Node) {
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(source) === 'bulkChange')) {
    assert.ok(ts.isBlock(node.parent))
    panelBlock = node.parent
  }
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(panelBlock)
const panelDeclarations = panelBlock.statements.filter((node) =>
  ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => panelNames.has(item.name.getText(source))))
  .map((node) => node.getText(source))
const code = ts.transpileModule(`
  ${pagesFunction.getText(source)}
  function panelOf(event, page) {
    ${panelDeclarations.join('\n')}
    return { rows, height: panelH + panelBorder }
  }
  ({ pagesOf, panelOf })
`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const { pagesOf, panelOf } = runInNewContext(code, {
  PAGE_SIZE: 4, ROW_H: 44, DOTS_H: 18, StyleSheet: { hairlineWidth: 1 },
  cableTypesFor: () => [], isBulkHistoryChange, gadgetCategoryKey,
}) as {
  pagesOf: (event: TimelineEvent) => { kind: string; gadget: Gadget }[][]
  panelOf: (event: TimelineEvent, page: number) => { rows: number; height: number }
}

function eventOf(added: number, removed: number, modes = 0): TimelineEvent {
  const gadget = (id: string): Gadget => ({ id, name: id, category: 'Plant', ports: [], createdAt: '2024-01-01' })
  return {
    inGadgets: Array.from({ length: added }, (_, i) => gadget(`in-${i}`)),
    outGadgets: Array.from({ length: removed }, (_, i) => gadget(`out-${i}`)),
    modeChanges: Array.from({ length: modes }, (_, i) => ({ gadget: gadget(`mode-${i}`), mode: 'decor' })),
  } as TimelineEvent
}

test('撤去と導入を同じページに詰め、再生時間に使うページ数も一致する', () => {
  for (let added = 0; added <= 12; added++) {
    for (let removed = 0; removed <= 12; removed++) {
      const event = eventOf(added, removed)
      const pages = pagesOf(event)
      assert.equal(pages.length, historyChangePageCount(added, removed, 4))
      if (isBulkHistoryChange(added, removed)) continue
      assert.deepEqual(Array.from(pages.flat(), (item) => item.gadget.id), [
        ...event.outGadgets.map((item) => item.id), ...event.inGadgets.map((item) => item.id),
      ])
      assert.ok(pages.every((page) => page.length <= 4))
    }
  }
  assert.deepEqual(Array.from(pagesOf(eventOf(1, 1))[0], (item) => item.kind), ['OUT', 'IN'])
})

test('使用方法の変更も同じページに含め、種別をまたいでも欠落しない', () => {
  const pages = pagesOf(eventOf(2, 1, 2))
  assert.deepEqual(Array.from(pages, (page) => Array.from(page, (item) => item.gadget.id)), [
    ['out-0', 'mode-0', 'mode-1', 'in-0'], ['in-1'],
  ])
})

test('複数ページの末尾が1件なら1段に縮み、撤去1件でも4段を確保しない', () => {
  assert.equal(panelOf(eventOf(0, 1), 0).height, 45)
  const event = eventOf(0, 5)
  assert.equal(panelOf(event, 0).height, 195)
  assert.equal(panelOf(event, 1).rows, 1)
  assert.equal(panelOf(event, 1).height, 63)
  assert.equal(panelOf(eventOf(1, 1), 0).height, 89)
  assert.equal(panelOf(eventOf(0, 0), 0).height, 0)
  assert.equal(panelOf(eventOf(20, 1), 0).height, 89)
})

const yearlyGadget = (id: string, purchasedAt: string, removedAt?: string): Gadget => ({
  id, name: id, category: 'Monitor', ports: [], purchasedAt, removedAt, createdAt: purchasedAt,
})
const yearlyGear = () => [
  yearlyGadget('A', '2023-01-01', '2024-03-01'),
  yearlyGadget('B', '2024-03-01', '2024-09-01'),
  yearlyGadget('C', '2024-09-01'),
]
const yearlyPlan = { id: 'yearly', selectedGadgetIds: [], placements: [] } as unknown as DeskPlan

test('年内のA→B→Cは1行に畳み、2回の変更の実日付と元の導入・撤去を保持する', () => {
  const event = buildTimeline(yearlyGear().reverse(), yearlyPlan, 'ja', 'year')[1]
  assert.deepEqual(event.gadgets.map((g) => g.id), ['C'])
  assert.deepEqual(event.renderGadgets.map((g) => g.id), ['C', 'A'])
  assert.deepEqual(event.inGadgets.map((g) => g.id), ['B', 'C'])
  assert.deepEqual(event.outGadgets.map((g) => g.id), ['A', 'B'])
  const group = event.yearlyChanges![0]
  assert.equal(group.changeCount, 2)
  assert.deepEqual(group.initialGadgets.map((g) => g.id), ['A'])
  assert.deepEqual(group.finalGadgets.map((g) => g.id), ['C'])
  assert.deepEqual(group.changes.map((change) => `${change.date} ${change.kind} ${change.gadget.id}`), [
    '2024-03-01 out A', '2024-03-01 in B', '2024-09-01 out B', '2024-09-01 in C',
  ])
  assert.equal(historyChangeLabel(event, 'ja'), '年内に2回変更')
  assert.equal(historyChangeLabel(event, 'en'), '2 changes this year')
  assert.deepEqual(Array.from(pagesOf(event).flat(), (row) => `${row.kind}:${row.gadget.id}`), ['SUMMARY:C'])
  assert.equal(panelOf(event, 0).height, 45)
  const replacement = buildHistoryReplacementLayoutPlan(event.inGadgets, event.outGadgets,
    event.connections, event.renderGadgets, event.renderConnections)
  assert.deepEqual([...replacement.pairs], [['C', 'A']])
  assert.equal(appendTodayPage([event], '2024-12-31')[1].yearlyChanges, undefined)
})

test('日・月表示では途中の機材を畳まず、同日の交換や一時的な1機材も従来どおり表示する', () => {
  const gear = yearlyGear()
  for (const grain of ['day', 'month'] as const) {
    const events = buildTimeline(gear, yearlyPlan, 'ja', grain)
    assert.ok(events.every((event) => !event.yearlyChanges))
    assert.ok(events.some((event) => event.gadgets.some((g) => g.id === 'B')))
  }
  const sameDay = [yearlyGadget('A', '2023-01-01', '2024-03-01'),
    yearlyGadget('B', '2024-03-01', '2024-03-01'), yearlyGadget('C', '2024-03-01')]
  assert.equal(buildTimeline(sameDay, yearlyPlan, 'ja', 'year')[1].yearlyChanges, undefined)
  assert.equal(buildTimeline([yearlyGadget('A', '2024-03-01', '2024-09-01')], yearlyPlan, 'ja', 'year')[0].yearlyChanges, undefined)
})

test('他ジャンルの変更は残し、まとめ行と合わせて4行ずつページ送りする', () => {
  const gear = [...yearlyGear(), ...Array.from({ length: 4 }, (_, i): Gadget => ({
    ...yearlyGadget(`other-${i}`, '2024-08-01'), category: 'DeskPad',
  }))]
  const event = buildTimeline(gear, yearlyPlan, 'ja', 'year')[1]
  assert.equal(pagesOf(event).length, 2)
  assert.equal(panelOf(event, 0).rows, 4)
  assert.equal(panelOf(event, 1).rows, 1)
  assert.equal(pagesOf(event)[1][0].kind, 'SUMMARY')
  const bulkGear = [...yearlyGear(), ...Array.from({ length: 13 }, (_, i): Gadget => ({
    ...yearlyGadget(`other-${i}`, '2024-08-01'), category: 'DeskPad',
  }))]
  const bulkEvent = buildTimeline(bulkGear, yearlyPlan, 'ja', 'year')[1]
  assert.equal(pagesOf(bulkEvent).length, 1)
  assert.equal(panelOf(bulkEvent, 0).rows, 2)
  assert.equal(pagesOf(bulkEvent)[0][1].kind, 'SUMMARY')
})

test('年末に残らない変更や元の機材への復帰も、途中を省略しつつ詳細に残す', () => {
  const gear = yearlyGear()
  gear[2].removedAt = '2024-11-01'
  const event = buildTimeline(gear, yearlyPlan, 'ja', 'year')[1]
  assert.deepEqual(event.yearlyChanges![0].finalGadgets, [])
  assert.equal(event.yearlyChanges![0].changeCount, 3)
  assert.deepEqual(event.renderGadgets.map((g) => g.id), ['A'])
  assert.equal(pagesOf(event).flat().length, 1)
  const returned: Gadget = { ...gear[0], deskUsagePeriods: [
    { mode: 'active', startedAt: '2023-01-01', endedAt: '2024-03-01' },
    { mode: 'active', startedAt: '2024-09-01' },
  ] }
  const resumed = buildTimeline([returned, gear[1]], yearlyPlan, 'ja', 'year')[1]
  assert.deepEqual(resumed.renderGadgets.map((g) => g.id), ['A'])
  assert.deepEqual(resumed.yearlyChanges![0].finalGadgets.map((g) => g.id), ['A'])
})

test('自作ジャンルを混ぜず、未来の変更はまとめの回数や詳細へ含めない', () => {
  const gear = yearlyGear().map((g): Gadget => ({ ...g, category: 'Other',
    customCategory: { id: 'custom-a', name: '独自A', icon: 'shape-outline' } }))
  const different: Gadget = { ...yearlyGadget('different', '2024-04-01'), category: 'Other',
    customCategory: { id: 'custom-b', name: '独自B', icon: 'shape-outline' } }
  const event = buildTimeline([...gear, different], yearlyPlan, 'ja', 'year')[1]
  assert.equal(event.yearlyChanges?.length, 1)
  assert.equal(event.yearlyChanges![0].categoryKey, 'custom:custom-a')
  assert.equal(pagesOf(event).flat().length, 2)
  const until = buildTimeline(gear, yearlyPlan, 'ja', 'year', '2024-06-01')[1]
  assert.equal(until.yearlyChanges, undefined)
  assert.deepEqual(until.gadgets.map((g) => g.id), ['B'])
})

test('まとめ行のタップは該当する履歴を開き、閉じると元が再生中だった場合だけ再開する', () => {
  const group = buildTimeline(yearlyGear(), yearlyPlan, 'ja', 'year')[1].yearlyChanges![0]
  let rowExpression: ts.Expression | undefined
  const callbacks = new Map<string, ts.Expression>()
  function find(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'items.map') rowExpression = node.arguments[0]
    if (ts.isVariableDeclaration(node) && ['openYearlyInfo', 'closeInfo'].includes(node.name.getText(source)) && node.initializer) {
      callbacks.set(node.name.getText(source), node.initializer)
    }
    ts.forEachChild(node, find)
  }
  find(source)
  assert.ok(rowExpression)
  function evaluate(expression: ts.Expression, bindings: Record<string, unknown>): any {
    const code = ts.transpileModule(`(${expression.getText(source)})`, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText
    const jsx = (type: string, props: any) => ({ type, props })
    return runInNewContext(code, { exports: {}, require: () => ({ jsx, jsxs: jsx }),
      useCallback: (fn: unknown) => fn, ...bindings })
  }
  function textOf(node: any): string {
    if (Array.isArray(node)) return node.map(textOf).join('')
    return node?.props ? textOf(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  }
  for (const lang of ['ja', 'en'] as const) for (const playing of [false, true]) {
    let pauses = 0, plays = 0
    let opened: unknown = null
    const resumeAfterInfo = { current: false }
    const bindings = { playing, resumeAfterInfo, setYearlyInfo: (value: unknown) => { opened = value },
      setInfoGadget: () => {}, pb: { pause: () => { pauses++ }, play: () => { plays++ } } }
    const openYearlyInfo = evaluate(callbacks.get('openYearlyInfo')!, bindings)
    const closeInfo = evaluate(callbacks.get('closeInfo')!, bindings)
    const rowOf = evaluate(rowExpression, {
      lang, ja: lang === 'ja', colors: {}, styles: {}, ICONS: {}, openYearlyInfo, historyYearlyChangeLabel,
      localizedGadgetName: (g: Gadget) => g.name, customCategoryOf: () => undefined,
      CATEGORY_LABELS: { Monitor: 'モニター' }, CATEGORY_LABELS_EN: { Monitor: 'Monitor' },
      TouchableOpacity: 'TouchableOpacity', View: 'View', Text: 'Text', AppIcon: 'AppIcon',
    })
    const row = rowOf({ kind: 'SUMMARY', summary: group, gadget: group.finalGadgets[0] })
    assert.equal(row.props.accessibilityRole, 'button')
    assert.ok(textOf(row).includes(historyYearlyChangeLabel(group, lang)))
    assert.ok(textOf(row).includes('C'))
    row.props.onPress()
    assert.equal(opened, group)
    assert.equal(pauses, 1)
    closeInfo()
    assert.equal(opened, null)
    assert.equal(plays, playing ? 1 : 0)
  }
})
