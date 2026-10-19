import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import {
  findPublicTagIssue,
  isOfficialPublicTag,
  isValidPublicTag,
  normalizePublicTag,
  publicTagIssueFromError,
  publicTagIssueMessage,
  publicTagKey,
  publicTagSuggestions,
  RESERVED_TAGS,
} from '../src/utils/publicTag'

test('印と前後の空白だけを落とし、綴りは変えない', () => {
  assert.equal(normalizePublicTag(' @MyDesk '), 'MyDesk')
  assert.equal(normalizePublicTag('#A1B2C3'), 'A1B2C3')
  assert.equal(normalizePublicTag(null), '')
})

test('比較キーは大文字小文字を区別しない', () => {
  assert.equal(publicTagKey('@MyDesk'), publicTagKey('mydesk'))
})

// 049 で配ってある6桁16進はそのまま新しい形式に収まる（移行で値を書き換えない）
test('既存の6桁16進タグは有効なまま', () => {
  assert.ok(isValidPublicTag('A1B2C3'))
})

test('使える文字と長さ', () => {
  assert.equal(findPublicTagIssue('desk_ashford'), null)
  assert.equal(findPublicTagIssue('ab'), 'invalid')
  assert.equal(findPublicTagIssue('a'.repeat(21)), 'invalid')
  assert.equal(findPublicTagIssue('my desk'), 'invalid')
  assert.equal(findPublicTagIssue('デスク'), 'invalid')
})

// なりすましの入口。公式・運営を名乗れる綴りは大文字小文字を問わず塞ぐ
test('予約語は取れない', () => {
  assert.equal(findPublicTagIssue('MyDesk'), 'reserved')
  assert.equal(findPublicTagIssue('mydesk'), 'reserved')
  assert.equal(findPublicTagIssue('@Support'), 'reserved')
  assert.equal(findPublicTagIssue('000000'), 'reserved')
})

test('サーバーの合図を理由に読み替える', () => {
  assert.equal(publicTagIssueFromError(new Error('PUBLIC_TAG_TAKEN')), 'taken')
  assert.equal(publicTagIssueFromError(new Error('PUBLIC_TAG_RESERVED')), 'reserved')
  assert.equal(publicTagIssueFromError({ message: 'PUBLIC_TAG_RATE_LIMITED' }), 'rate_limited')
  assert.match(publicTagIssueMessage('rate_limited', 'ja'), /7日.*90日.*4回/)
  assert.equal(publicTagIssueFromError(new Error('network request failed')), null)
})

// 予約語はサーバー（060 の is_reserved_public_tag）が正本で、アプリ側は保存を押す前に
// 理由を返すための写し。片方だけ足すと「入力できるのに保存で弾かれる」か、その逆になる。
test('予約語がマイグレーションと一致する', () => {
  // 予約語を足すたびに関数を貼り直すので、最後に定義したマイグレーションと比べる
  const latest = readdirSync('supabase/migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(`supabase/migrations/${name}`, 'utf8'))
    .filter((text) => /FUNCTION public\.is_reserved_public_tag\(/.test(text))
    .at(-1)
  assert.ok(latest, 'is_reserved_public_tag を定義したマイグレーションが無い')
  const body = latest.match(/FUNCTION public\.is_reserved_public_tag\([\s\S]*?ARRAY\[([\s\S]*?)\]/)?.[1]
  assert.ok(body, 'is_reserved_public_tag の配列を読み取れなかった')
  const inSql = new Set([...body.matchAll(/'([^']+)'/g)].map((m) => m[1]))
  assert.deepEqual([...inSql].sort(), [...RESERVED_TAGS].sort())
})

// 重なったときの代案。出した候補が形式で弾かれると、押したのに保存できない
test('代案は元の綴りを残し、どれも保存できる形をしている', () => {
  const tags = publicTagSuggestions('ashford', '', 12345)
  assert.ok(tags.length >= 4)
  for (const tag of tags) {
    assert.equal(findPublicTagIssue(tag), null, tag)
    assert.ok(tag.startsWith('ashford'), tag)
  }
  assert.equal(new Set(tags.map(publicTagKey)).size, tags.length)
})

test('代案に元の @ID 自体（大文字小文字違いを含む）は入らない', () => {
  assert.ok(!publicTagSuggestions('Ashford').map(publicTagKey).includes('ashford'))
})

test('上限いっぱいの @ID でも代案は20文字に収まる', () => {
  for (const tag of publicTagSuggestions('a'.repeat(20), '', 999)) {
    assert.equal(findPublicTagIssue(tag), null, tag)
  }
})

test('綴りから何も残らなければ名前、それも無ければ user から作る', () => {
  assert.ok(publicTagSuggestions('', 'Ken 田中').every((tag) => tag.startsWith('Ken')))
  assert.ok(publicTagSuggestions('', 'たなか').every((tag) => tag.startsWith('user')))
})

test('予約語からも使える代案を作る', () => {
  const tags = publicTagSuggestions('support')
  assert.ok(tags.length > 0)
  for (const tag of tags) assert.equal(findPublicTagIssue(tag), null, tag)
})

test('公式アカウントの見分けは @MyDesk（綴りの大小・印を問わない）と旧 000000 だけ', () => {
  for (const tag of ['MyDesk', '@MyDesk', 'mydesk', '#000000', '000000']) {
    assert.equal(isOfficialPublicTag(tag), true, tag)
  }
  for (const tag of ['MyDeskFan', 'my_desk2', 'A1B2C3', '', null, undefined]) {
    assert.equal(isOfficialPublicTag(tag), false, String(tag))
  }
  // 見分けに使う @ID は、他人が名乗れない予約語でなければならない
  assert.ok(RESERVED_TAGS.has('mydesk'))
  assert.ok(RESERVED_TAGS.has('000000'))
})
