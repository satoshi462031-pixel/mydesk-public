import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { isPublicTagSegment, SITE_PATH_SEGMENTS } from '../src/constants/siteRoutes'

// 共有URLが /<@ID>/<デスクID>、プロフィールが /<@ID> になったので、URL の1段目は
// 「人の名乗り」と「サイト自身のページ」が同じ場所を分け合っている。
// この一覧が実態から遅れると、LP の新しいページが誰かのプロフィールとして読まれて
// 届かなくなる。3箇所（アプリ・worker・LP）がずれていないかをここで縛る。

/** @ID として名乗れる形。これに当てはまらないパスはそもそも人と衝突しない */
const TAG_SHAPE = /^[A-Za-z0-9_]{3,20}$/

// worker / landing は非公開の submodule で、CI（.github/workflows/ci.yml）は取得しない。
// 無いときに落とすと CI が常に赤くなり、無いのに通すと検査したように見えるので、理由つきで skip にする。
// 手元（submodule が揃っている）では必ず走る
const skipWithout = (path: string) =>
  existsSync(path) ? false : `${path} が無い（submodule を取得していない環境）`

describe('サイト自身のパス', () => {
  it('worker の写しと一致する', { skip: skipWithout('worker/src/index.ts') }, () => {
    const source = readFileSync('worker/src/index.ts', 'utf8')
    const body = source.match(/export const SITE_PATH_SEGMENTS = \[([\s\S]*?)\]/)?.[1]
    assert.ok(body, 'worker の SITE_PATH_SEGMENTS を読み取れなかった')
    const inWorker = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1])
    assert.deepEqual(inWorker.sort(), [...SITE_PATH_SEGMENTS].sort())
  })

  it('LP（landing/app）のページを全部覆っている', { skip: skipWithout('landing/app') }, () => {
    const routes = readdirSync('landing/app', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // Next.js の括弧付きディレクトリ（グループ）はURLに出ない
      .filter((name) => !name.startsWith('(') && !name.startsWith('_'))
    assert.ok(routes.length > 0, 'landing/app のページを1つも読めなかった')
    for (const route of routes) {
      // 人の名乗りと衝突しない綴り（- や . を含む）は一覧に無くてもよい
      if (!TAG_SHAPE.test(route)) continue
      assert.ok(
        SITE_PATH_SEGMENTS.includes(route as (typeof SITE_PATH_SEGMENTS)[number]),
        `LP の /${route} が SITE_PATH_SEGMENTS に無い。足さないと @${route} を名乗った人のプロフィールとして読まれる`,
      )
    }
  })

  it('LP の静的ファイルの置き場も覆っている', { skip: skipWithout('landing/public') }, () => {
    const dirs = readdirSync('landing/public', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    for (const dir of dirs) {
      if (!TAG_SHAPE.test(dir)) continue
      assert.ok(
        SITE_PATH_SEGMENTS.includes(dir as (typeof SITE_PATH_SEGMENTS)[number]),
        `landing/public/${dir} が SITE_PATH_SEGMENTS に無い`,
      )
    }
  })
})

describe('1段目を人の名乗りとして読んでよいか', () => {
  it('サイト自身のパスは読まない（綴りの大小は問わない）', () => {
    assert.equal(isPublicTagSegment('terms'), false)
    assert.equal(isPublicTagSegment('Terms'), false)
    assert.equal(isPublicTagSegment('setup'), false)
    assert.equal(isPublicTagSegment('about'), false)
    assert.equal(isPublicTagSegment('explore-desks'), false)
    assert.equal(isPublicTagSegment('explore'), false)
  })

  // 予約語で切ると、実在する公式アカウントのプロフィールが開けなくなる
  it('予約語でも実在する @ID は読む', () => {
    assert.equal(isPublicTagSegment('MyDesk'), true)
    assert.equal(isPublicTagSegment('000000'), true)
    assert.equal(isPublicTagSegment('support'), true)
  })

  it('名乗りの形でないものは読まない', () => {
    assert.equal(isPublicTagSegment('ab'), false)
    assert.equal(isPublicTagSegment('a'.repeat(21)), false)
    assert.equal(isPublicTagSegment('has-hyphen'), false)
    assert.equal(isPublicTagSegment('robots.txt'), false)
    assert.equal(isPublicTagSegment(''), false)
  })
})
