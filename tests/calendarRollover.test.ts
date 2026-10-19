import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { Gadget } from '../src/types'
import { parseDateInput, parseLocalDate, formatStoredDate } from '../src/utils/dateFormat'
import { localDateKey, playbackTimelineSummary } from '../src/utils/deskTimeline'
import { groupHistoryByDay } from '../src/utils/historyPeriod'
import { buildChronicle } from '../src/utils/gadgetChronicle'
import * as gadgetStats from '../src/utils/gadgetStats'

function memoValue(file: string, name: string, bindings: Record<string, any>) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let initializer: ts.Expression | undefined
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && (node.name.getText(source) === name ||
      (ts.isObjectBindingPattern(node.name) && node.name.elements.some((element) => element.name.getText(source) === name)))) {
      initializer = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(initializer, name)
  const code = ts.transpileModule(`(${initializer.getText(source)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  let cached: { deps: unknown[]; value: any } | undefined
  return () => runInNewContext(code, {
    ...bindings,
    useMemo: (create: () => any, deps: unknown[]) => {
      if (!cached || deps.some((dep, index) => !Object.is(dep, cached!.deps[index]))) {
        cached = { deps, value: create() }
      }
      return cached.value
    },
  })
}

function gadget(id: string, purchasedAt: string): Gadget {
  return { id, name: id, category: 'Monitor', ports: [], purchasedAt, price: 100, createdAt: `${purchasedAt}T00:00:00Z` }
}

test('詳細とテンプレートの選択上限が、画面を開いたまま年をまたいでも1年先になる', () => {
  for (const [file, variable] of [
    ['src/screens/GadgetDetailScreen.tsx', 'maxGadgetDate'],
    ['src/screens/TemplateDetailScreen.tsx', 'maxIntroductionDate'],
  ]) {
    const context = { today: new Date(2026, 11, 31) }
    const read = memoValue(file, variable, context)
    assert.equal(localDateKey(read()), '2027-12-31')
    context.today = new Date(2027, 0, 1)
    assert.equal(localDateKey(read()), '2028-01-01')
  }
})

test('導入予定日の判定はUTCとの日付差に影響されず、翌日には予定の表示を解除する', () => {
  const previousZone = process.env.TZ
  try {
    for (const zone of ['Asia/Tokyo', 'America/Los_Angeles']) {
      process.env.TZ = zone
      const context = { purchasedAt: '2026/10/08', lang: 'ja', today: new Date(2026, 9, 8), parseDateInput, localDateKey }
      const read = memoValue('src/screens/GadgetDetailScreen.tsx', 'isFutureDate', context)
      assert.equal(read(), false, zone)
      context.purchasedAt = '2026/10/09'
      assert.equal(read(), true, zone)
      context.today = new Date(2026, 9, 9)
      assert.equal(read(), false, zone)
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ
    else process.env.TZ = previousZone
  }
})

test('入力済みの交換日が今日になったら、未来日のエラーを再判定する', () => {
  const context = {
    today: new Date(2026, 9, 8), lang: 'ja', parsedReplacementDate: '2026-10-09',
    replacementSource: gadget('old', '2026-01-01'), replacementTarget: gadget('new', '2026-10-09'),
    localDateKey, formatStoredDate,
  }
  const read = memoValue('src/screens/WiringResultScreen.tsx', 'replacementDateError', context)
  assert.equal(read(), '未来の日付は指定できません')
  context.today = new Date(2026, 9, 9)
  assert.equal(read(), undefined)
})

test('履歴データを再取得しなくても、日付またぎで今日の見出しが昨日になる', () => {
  const context = {
    displayMode: 'grid', scope: 'viewed', historyLimit: 100,
    today: new Date(2026, 9, 8), lang: 'ja', groupHistoryByDay,
    items: [{ at: new Date(2026, 9, 8, 12).toISOString(), desk: { id: 'desk' } }],
  }
  const read = memoValue('src/screens/ViewHistoryListScreen.tsx', 'rows', context)
  assert.equal(read()[0].label, '今日')
  context.today = new Date(2026, 9, 9)
  assert.equal(read()[0].label, '昨日')
})

test('今年の集計と未来の機材の除外が、年越しで再計算される', () => {
  const devices = [gadget('last-year', '2026-12-31'), gadget('next-year', '2027-01-01')]
  const context = {
    ...gadgetStats, today: new Date(2026, 11, 31), devices, connections: [], pricedDevices: devices,
    pricedCount: 2, parseLocalDate, isWirelessPortType: () => false, isWirelessPowerPort: () => false,
    requiresPhysicalCable: () => true,
  }
  const read = memoValue('src/components/organisms/GadgetStatsPanel.tsx', 'detail', context)
  assert.equal(read().datedCount, 1)
  assert.equal(read().thisYearCount, 1)
  assert.equal(read().newest.gadget.id, 'last-year')
  context.today = new Date(2027, 0, 1)
  assert.equal(read().datedCount, 2)
  assert.equal(read().thisYearCount, 1)
  assert.equal(read().thisYearTotal, 100)
  assert.equal(read().newest.gadget.id, 'next-year')
})

test('年表の在籍期間が、機材の編集なしに翌日へ伸びる', () => {
  const context = { today: new Date(2026, 9, 8), gadgets: [gadget('monitor', '2026-10-07')], windowYears: -1, buildChronicle }
  const read = memoValue('src/components/organisms/DeskChronicleCard.tsx', 'chronicle', context)
  assert.equal(read().rows[0].totalDays, 1)
  context.today = new Date(2026, 9, 9)
  assert.equal(read().rows[0].totalDays, 2)
})

test('歴史カードの件数が、予定の導入日になったら更新される', () => {
  const context = {
    today: new Date(2026, 9, 8), gadgets: [gadget('tomorrow', '2026-10-09')],
    historyGrain: 'day', cutoff: null, localDateKey, playbackTimelineSummary,
  }
  const read = memoValue('src/components/organisms/DeskHistoryEntryCard.tsx', 'pageCount', context)
  assert.equal(read().pageCount, 0)
  context.today = new Date(2026, 9, 9)
  assert.equal(read().pageCount, 2)
})

test('成長グラフは月をまたぐと表示月と今日までの購入分を更新する', () => {
  const file = 'src/components/organisms/GadgetStatsPanel.tsx'
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'growthTrend')
  assert.ok(declaration)
  const code = ts.transpileModule(`(${declaration.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const growthTrend = runInNewContext(code, { ...gadgetStats, parseLocalDate, TREND_MONTHS: 12 })
  const context = {
    today: new Date(2026, 8, 30), sourceGadgets: [gadget('september', '2026-09-30'), gadget('october', '2026-10-01')],
    growthTrend,
  }
  const read = memoValue(file, 'trendPoints', context)
  assert.equal(read().at(-1).month, 9)
  assert.equal(read().at(-1).count, 1)
  context.today = new Date(2026, 9, 1)
  assert.equal(read().at(-1).month, 10)
  assert.equal(read().at(-1).count, 2)
})
