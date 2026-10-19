import assert from 'node:assert/strict'
import test from 'node:test'
import { photoIdentity, publicContentSignature, PublicContentDevice } from '../src/utils/publicContentSignature'

const device = (over: Partial<PublicContentDevice> = {}): PublicContentDevice => ({
  local_id:     'g1',
  name:         'モニター',
  category:     'monitor',
  price:        50000,
  purchased_at: '2026-01-10',
  removed_at:   null,
  ...over,
})

test('機材の並び順が違うだけでは指紋は変わらない', () => {
  const a = device()
  const b = device({ local_id: 'g2', name: 'キーボード', category: 'keyboard' })
  assert.equal(
    publicContentSignature([a, b], ['https://x/1.jpg']),
    publicContentSignature([b, a], ['https://x/1.jpg']),
  )
})

test('機材を外すと指紋が変わる', () => {
  const a = device()
  const b = device({ local_id: 'g2' })
  assert.notEqual(
    publicContentSignature([a, b], []),
    publicContentSignature([a], []),
  )
})

test('値段の直しも機材の更新として拾う（公開ページの総額が動く）', () => {
  assert.notEqual(
    publicContentSignature([device()], []),
    publicContentSignature([device({ price: 60000 })], []),
  )
})

test('写真は並べ替えただけでも指紋が変わる', () => {
  const photos = ['a.jpg', 'b.jpg']
  assert.notEqual(
    publicContentSignature([device()], photos),
    publicContentSignature([device()], [...photos].reverse()),
  )
})

// c1 の実害そのもの。plan.images はローカルパスしか持たないので公開のたびに
// 再アップロードされ、URL のファイル名（`${Date.now()}-${token}`）が毎回変わる。
// URL を材料にしていたため、何も変えていない再公開で必ず「機材更新」が出ていた
test('同じ写真を再アップロードして URL が変わっても指紋は変わらない', () => {
  const before = ['/var/mobile/Containers/A/Documents/plan_images/p1_asset9.jpg']
  const after  = ['/var/mobile/Containers/B/Documents/plan_images/p1_asset9.jpg']
  assert.equal(
    publicContentSignature([device()], before.map(photoIdentity)),
    publicContentSignature([device()], after.map(photoIdentity)),
  )
})

test('写真の同一性はファイル名だけを見る', () => {
  assert.equal(photoIdentity('/a/b/c/p1_asset9.jpg'), 'p1_asset9.jpg')
  assert.equal(
    photoIdentity('https://x.supabase.co/storage/v1/object/public/desk-images/u/d/1757-ab.jpg'),
    '1757-ab.jpg',
  )
  // 区切りが無い値はそのまま返す
  assert.equal(photoIdentity('p1_asset9.jpg'), 'p1_asset9.jpg')
})

test('写真を差し替えれば指紋が変わる', () => {
  assert.notEqual(
    publicContentSignature([device()], ['p1_asset9.jpg']),
    publicContentSignature([device()], ['p1_asset7.jpg']),
  )
})

test('撤去日を入れると指紋が変わる', () => {
  assert.notEqual(
    publicContentSignature([device()], []),
    publicContentSignature([device({ removed_at: '2026-09-01' })], []),
  )
})
