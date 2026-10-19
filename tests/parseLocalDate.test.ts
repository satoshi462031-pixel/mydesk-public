// UTC より西のタイムゾーンで日付が1日巻き戻らないことを見る。
// deskUsageDates.test.ts が Asia/Tokyo（正のオフセット）を見ているのと対で、
// こちらは負のオフセットを固定する。両方を見ないと「日付だけの文字列を
// new Date() に渡すと UTC 00:00 になる」バグがどちらかのTZで素通りする。
process.env.TZ = 'America/New_York'

import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDate, parseLocalDate } from '../src/utils/dateFormat'

test('保存値の暦日が、負のオフセットでもそのまま読み戻る', () => {
  const parsed = parseLocalDate('2026-09-12')
  assert.ok(parsed)
  assert.equal(parsed.getFullYear(), 2026)
  assert.equal(parsed.getMonth() + 1, 9)
  assert.equal(parsed.getDate(), 12)
  // 日付ピッカーを開いて確定しただけで値が変わらないこと（往復して同値）
  assert.equal(formatDate(parsed, 'ja'), '2026/09/12')
  assert.equal(formatDate(parsed, 'en'), '09/12/2026')
})

test('new Date() に日付だけの文字列を渡すと前日になる（退行の見張り）', () => {
  // この差が無くなった＝実装が UTC 解釈に戻っている、という意味になる
  assert.equal(new Date('2026-09-12').getDate(), 11)
  assert.equal(parseLocalDate('2026-09-12')!.getDate(), 12)
})

test('YYYY/MM/DD と YYYY-MM も受ける（日の省略は1日扱い）', () => {
  assert.equal(formatDate(parseLocalDate('2026/03/08')!, 'ja'), '2026/03/08')
  const month = parseLocalDate('2026-03')
  assert.ok(month)
  assert.equal(month.getDate(), 1)
  assert.equal(month.getMonth() + 1, 3)
})

test('実在しない日付と空値は null', () => {
  assert.equal(parseLocalDate('2026-02-30'), null)
  assert.equal(parseLocalDate('not a date'), null)
  assert.equal(parseLocalDate(''), null)
  assert.equal(parseLocalDate(undefined), null)
})

test('夏時間の切り替わり日も、その日の暦日として読める', () => {
  // 2026-03-08 は America/New_York の DST 開始日（02:00 が飛ぶ）。
  // 00:00 は存在するので日付は保たれる
  const dst = parseLocalDate('2026-03-08')
  assert.ok(dst)
  assert.equal(dst.getDate(), 8)
  assert.equal(formatDate(dst, 'en'), '03/08/2026')
})
