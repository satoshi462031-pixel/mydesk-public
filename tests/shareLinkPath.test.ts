import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isParsableLinkPath, isTrustedAppLink, normalizeShareLinkPath } from '../src/utils/shareLinkPath'
import { encodeDeskId } from '../src/utils/shortDeskId'

const uuid = '11111111-2222-4333-8444-555555555555'
const short = encodeDeskId(uuid)

describe('共有リンクのパスを画面のパスへ均す', () => {
  it('現行の共有URL（/<@ID>/<22文字>）をデスクの画面へ渡す', () => {
    assert.equal(normalizeShareLinkPath(`/desk_ashford/${short}`), `/setup/${uuid}`)
    assert.equal(normalizeShareLinkPath(`desk_ashford/${short}`), `setup/${uuid}`)
  })

  it('最短形のプロフィール（/<@ID>）を人の画面へ渡す', () => {
    assert.equal(normalizeShareLinkPath('/desk_ashford'), '/u/desk_ashford')
    // 公式アカウントは予約語だが実在する。サイト自身のパスでなければ人として読む
    assert.equal(normalizeShareLinkPath('/MyDesk'), '/u/MyDesk')
  })

  it('旧形式をそのまま同じ画面へ誘導する', () => {
    assert.equal(normalizeShareLinkPath(`setup/${short}`), `setup/${uuid}`)
    assert.equal(normalizeShareLinkPath(`setup/${uuid}`), `setup/${uuid}`)
    assert.equal(normalizeShareLinkPath(`/setup/${uuid}`), `/setup/${uuid}`)
    assert.equal(normalizeShareLinkPath(`d/${short}`), `setup/${uuid}`)
    assert.equal(normalizeShareLinkPath(`desk/${uuid}`), `setup/${uuid}`)
    assert.equal(normalizeShareLinkPath('u/desk_ashford'), 'u/desk_ashford')
  })

  it('クエリ・ハッシュを落とさない（通知の source= が消えると流入元が読めなくなる）', () => {
    assert.equal(normalizeShareLinkPath(`/desk_ashford/${short}?source=push`), `/setup/${uuid}?source=push`)
    assert.equal(normalizeShareLinkPath('/desk_ashford?utm_source=x'), '/u/desk_ashford?utm_source=x')
  })

  // ここで飲み込むと、パスワード再設定やサイト自身のページがプロフィールとして開く
  it('サイト自身のパスと、名乗りの形をしていないものは触らない', () => {
    assert.equal(normalizeShareLinkPath('auth/reset-password'), 'auth/reset-password')
    assert.equal(normalizeShareLinkPath('auth/email-change'), 'auth/email-change')
    assert.equal(normalizeShareLinkPath('auth/login'), 'auth/login')
    assert.equal(normalizeShareLinkPath('/terms'), '/terms')
    assert.equal(normalizeShareLinkPath(`/terms/${short}`), `/terms/${short}`)
    assert.equal(normalizeShareLinkPath('/ab'), '/ab')
    assert.equal(normalizeShareLinkPath('/has-hyphen'), '/has-hyphen')
    assert.equal(normalizeShareLinkPath('/desk_ashford/not-an-id'), '/desk_ashford/not-an-id')
    assert.equal(normalizeShareLinkPath(`/desk_ashford/${short}/extra`), `/desk_ashford/${short}/extra`)
    assert.equal(normalizeShareLinkPath(''), '')
  })
})

describe('外から来たリンクを解析へ渡してよいか', () => {
  it('ふつうの共有URL・通知のURL・日本語を含むクエリは通す', () => {
    assert.ok(isParsableLinkPath(`/desk_ashford/${short}`))
    assert.ok(isParsableLinkPath(`setup/${uuid}?source=push`))
    assert.ok(isParsableLinkPath('u/desk_ashford?q=%E3%83%87%E3%82%B9%E3%82%AF'))
  })

  it('壊れた % 列は通さない（React Navigation 6 の解析が固まる）', () => {
    assert.equal(isParsableLinkPath(`setup/${uuid}?x=${'%C0'.repeat(1000)}`), false)
    assert.equal(isParsableLinkPath('setup/%E3&%81%82'), false)
  })
})

it('過大な遷移URLはナビゲーション解析前に拒否する', () => {
  assert.equal(isParsableLinkPath('setup/' + uuid + '?q=' + 'x'.repeat(8192)), false)
})
it('正規ホストの前方一致で別のドメインを受け入れない', () => {
  const base = 'https://mydesk.page'
  for (const url of [
    base + '.evil.invalid/setup/' + uuid,
    base + 'MyDesk',
    base + '@evil.invalid/setup/' + uuid,
    'http://mydesk.page/setup/' + uuid,
    'javascript:alert(1)',
  ]) assert.equal(isTrustedAppLink(url, base), false, url)
  assert.equal(isTrustedAppLink(base + '/setup/' + uuid, base), true)
  assert.equal(isTrustedAppLink('mydesk://desk/' + uuid + '?tab=wiring', base), true)
})
it('クエリでパスのデスクIDやプロフィールを上書きできない', () => {
  for (const query of ['deskId=other', '%64eskId=other', 'tag=other']) {
    assert.equal(isParsableLinkPath('setup/' + uuid + '?' + query), false, query)
  }
  assert.equal(isParsableLinkPath('setup/' + uuid + '?tab=wiring&source=push'), true)
})
