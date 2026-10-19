import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildPhotoShareItems, PHOTO_SHARE_TARGETS, sharePhotoUris } from '../src/utils/sharePhotoItems'

const MESSAGE = 'ゲーミング\n\n#MyDeskApp #デスク環境\nhttps://mydesk.page/MyDesk/EFPGAyXMRsuqBihKydL7rw'
const photo = (n: number) => `file:///var/mobile/Documents/plan_images/${n}.jpg`

describe('share photos', () => {
  // URL を優先する。どの送り先にも文面（URL）が届く
  it('sends the message with the URL to every target', () => {
    const [text] = buildPhotoShareItems(MESSAGE, [photo(1)])
    assert.deepEqual(text.item.default, { type: 'text', content: MESSAGE })
  })

  // 写真と文面を同時に受け取ると文面を捨てる送り先がある。写真は文面が残ると確かめた送り先にだけ
  it('gives photos only to targets known to keep the message', () => {
    const [, image] = buildPhotoShareItems(MESSAGE, [photo(1)])
    assert.equal(image.item.default, null)
    for (const target of PHOTO_SHARE_TARGETS) {
      assert.deepEqual(image.item[target], { type: 'url', content: photo(1) })
    }
    assert.equal(image.item['com.burbn.instagram.shareextension'], undefined)
  })

  it('attaches at most four photos, from the first one', () => {
    const items = buildPhotoShareItems(MESSAGE, [1, 2, 3, 4, 5, 6].map(photo))
    assert.deepEqual(items.slice(1).map((item) => item.placeholderItem.content), [1, 2, 3, 4].map(photo))
  })

  // Web の URL は画像ではなくリンクとして届く
  it('only uses photos stored on the device', () => {
    assert.deepEqual(sharePhotoUris(['https://example.com/a.jpg', photo(1), undefined as unknown as string].filter(Boolean)), [photo(1)])
    assert.deepEqual(sharePhotoUris(undefined), [])
  })
})
