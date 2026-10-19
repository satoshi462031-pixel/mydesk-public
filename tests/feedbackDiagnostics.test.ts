import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  clearTrailForTest,
  recordFailure,
  recordScreen,
  snapshotTrail,
} from '../src/utils/diagnosticTrail'
import {
  Cluster,
  describeTrail,
  findRegressions,
  LedgerItem,
  parseLedger,
  regressionStatus,
} from '../scripts/feedbackLedger'

test('直前の操作は送信の何秒前かで、古い順に最大30件だけ残す', () => {
  clearTrailForTest()
  for (let i = 0; i < 35; i++) recordScreen(`Screen${i}`, 1_000 * i)
  recordFailure('wiring_generation_failed', { operation: 'regen', error_code: 'E1', message: '入力内容' }, 40_000)
  const trail = snapshotTrail(41_000)
  assert.equal(trail.length, 30)
  assert.deepEqual(trail[0], { s: 35, screen: 'Screen6' })
  assert.deepEqual(trail[29], { s: 1, failure: 'wiring_generation_failed', operation: 'regen', code: 'E1' })
  // 固定の識別子以外（自由入力が混ざりうる message 等）は持たない
  assert.ok(!JSON.stringify(trail).includes('入力内容'))
})

test('失敗イベントは解析の同意より前に端末内へ記録される', () => {
  const src = readFileSync('src/services/analytics.ts', 'utf8')
  const track = src.match(/track\(event: AnalyticsEventName[\s\S]*?\n {2}\},/)?.[0] ?? ''
  assert.ok(track.indexOf('recordFailure') >= 0 && track.indexOf('recordFailure') < track.indexOf('safe('))
})

const item = (over: Partial<LedgerItem>): LedgerItem => ({
  createdAt: '2026-10-10T00:00:00Z',
  category: 'bug',
  body: '線が消える',
  appVersion: '1.0.0',
  platform: 'ios',
  userId: 'u1',
  context: null,
  cluster: 'wire-missing',
  report: 'r.md',
  ...over,
})
const done: Cluster = {
  title: '線が消える', kind: 'bug', status: 'done', fixedAt: '2026-10-05T00:00:00Z', fixedIn: '1.0.0', commit: 'abc',
}

test('同じ版番号でも、修正より後に作られたバンドルからの報告だけを再発とみなす', () => {
  const before = item({ context: { bundle: { createdAt: '2026-10-01T00:00:00Z', embedded: false } } })
  const after = item({ context: { bundle: { createdAt: '2026-10-06T00:00:00Z', embedded: false } } })
  assert.equal(regressionStatus(before, done), 'no')
  assert.equal(regressionStatus(after, done), 'yes')
})

test('バンドルの情報が無いときは版番号で決め、同じ版なら判定しない', () => {
  assert.equal(regressionStatus(item({ appVersion: '0.9.0' }), done), 'no')
  assert.equal(regressionStatus(item({ appVersion: '1.1.0' }), done), 'yes')
  assert.equal(regressionStatus(item({ appVersion: '1.0.0' }), done), 'unknown')
  assert.equal(regressionStatus(item({}), { ...done, status: 'open' }), 'no')
})

test('再発の一覧は対応済みの束だけを見る', () => {
  const ledger = parseLedger(JSON.stringify({
    items: {
      a: item({ context: { bundle: { createdAt: '2026-10-06T00:00:00Z' } } }),
      b: item({ cluster: 'other', appVersion: '2.0.0' }),
    },
    clusters: { 'wire-missing': done, other: { title: 'x', kind: 'bug', status: 'open' } },
  }))
  assert.deepEqual(findRegressions(ledger), [{ key: 'wire-missing', yes: ['a'], unknown: [] }])
})

test('壊れた台帳は空として扱わず止める', () => {
  assert.deepEqual(parseLedger(null), { items: {}, clusters: {} })
  assert.throws(() => parseLedger('{broken'))
  assert.throws(() => parseLedger('{"items":{}}'))
})

test('添付を選ばなかった送信と、環境を持つ前の送信を区別して書く', () => {
  assert.match(describeTrail(item({ context: { os: '18.2' } })).join('\n'), /添付なし/)
  assert.match(describeTrail(item({ context: null })).join('\n'), /環境を持つ前/)
  const lines = describeTrail(item({ context: { trail: [{ s: 12, screen: 'WiringResult' }, { s: 3, failure: 'x_failed', code: 'E' }] } }))
  assert.ok(lines.some((l) => l.includes('-12秒  画面 WiringResult')))
  assert.ok(lines.some((l) => l.includes('-3秒  失敗 x_failed code=E')))
})
