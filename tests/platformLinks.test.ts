import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { normalizeShareLinkPath } from '../src/utils/shareLinkPath'

const config = JSON.parse(readFileSync('app.json', 'utf8')).expo
type LinkData = { host: string; scheme: string; pathPrefix?: string; pathPattern?: string }
const filters = config.android.intentFilters.flatMap((filter: { data: LinkData[] }) => filter.data) as LinkData[]

function androidReceives(url: string): boolean {
  const { hostname, protocol, pathname } = new URL(url)
  return filters.some(data => data.host === hostname && data.scheme === protocol.slice(0, -1)
    && (data.pathPrefix ? pathname.startsWith(data.pathPrefix)
      // この設定のsimple globは「任意の段/固定長の文字列」で、.*直後は区切りの/。
      : data.pathPattern ? new RegExp(`^${data.pathPattern}$`).test(pathname) : true))
}

test('Androidはサイトの/userを奪わず、既存プロフィールとデスクのリンクを受け取る', () => {
  for (const path of ['/user', '/user/guide', '/terms', '/privacy', '/setup-help', '/desk-guide']) {
    assert.equal(androidReceives(`https://mydesk.page${path}`), false, path)
  }
  for (const path of ['/u/desk_ashford', '/setup/11111111-2222-3333-4444-555555555555', '/d/1234567890123456789012']) {
    assert.equal(androidReceives(`https://mydesk.page${path}`), true, path)
  }
  assert.equal(androidReceives('https://other.example/u/desk_ashford'), false)
})

test('Androidが受け取る現行デスクリンクもiOSと同じ画面パスへ正規化する', () => {
  const url = 'https://mydesk.page/desk_ashford/ERERESIiMzNERFVVVVVVVQ'
  assert.equal(androidReceives(url), true)
  assert.equal(androidReceives(`${url.slice(0, -1)}`), false)
  assert.equal(androidReceives(`${url}/extra`), false)
  assert.equal(normalizeShareLinkPath(new URL(url).pathname), '/setup/11111111-2222-3333-4444-555555555555')
})
