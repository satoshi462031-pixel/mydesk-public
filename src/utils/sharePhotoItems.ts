import type { ShareOptions } from 'react-native-share'

// ─── 共有シートに写真を一緒に渡すときの中身 ─────────────────────────────
// services/shareService.ts から使う。ネイティブの部品に触れないので node のテストから呼べる

// ライブラリの型の出口に無いので、共有オプションの型から取り出す
type ActivityItemSource = NonNullable<ShareOptions['activityItemSources']>[number]

/** X が1投稿に付けられる画像の上限 */
export const SHARE_PHOTO_LIMIT = 4

/**
 * 写真を一緒に渡してもURL入りの文面が残ると分かっている送り先（iOS の共有先 ID）。
 * それ以外の送り先には写真を渡さず、文面（URL）だけにする。URL を優先するため。
 * 写真と文面を同時に受け取ると文面を捨てる・別送にするアプリがある（Instagram は写真だけ、
 * LINE は分かれることがある）。そこで写真を渡すと、見た人がデスクに辿り着けない。
 * 送り先を増やすときは、実機で「写真と文面が1つの投稿に入る」ことを確かめてから足す
 */
export const PHOTO_SHARE_TARGETS = [
  'com.atebits.Tweetie2.ShareExtension', // X
  'message', // メッセージ
  'mail', // メール
] as const

/**
 * 渡す写真を選ぶ。端末内のファイルだけを先頭から上限まで。
 * Web の URL を渡すと、送り先には画像ではなくリンクとして届く
 */
export function sharePhotoUris(photoUris: readonly string[] | undefined): string[] {
  return (photoUris ?? []).filter((uri) => uri.startsWith('file://')).slice(0, SHARE_PHOTO_LIMIT)
}

/**
 * 写真を付けるときの共有シートの中身。文面はすべての送り先へ、写真は PHOTO_SHARE_TARGETS にだけ渡す。
 * 送り先ごとに中身を決める仕組み（UIActivityItemSource）は react-native-share の iOS 実装に頼る。
 * 送り先の ID で引けなければ default が使われ、null はその送り先に渡さない
 */
export function buildPhotoShareItems(message: string, photoUris: readonly string[]): ActivityItemSource[] {
  return [
    { placeholderItem: { type: 'text', content: message }, item: { default: { type: 'text', content: message } } },
    ...sharePhotoUris(photoUris).map((uri): ActivityItemSource => ({
      placeholderItem: { type: 'url', content: uri },
      item: {
        default: null,
        ...Object.fromEntries(PHOTO_SHARE_TARGETS.map((target) => [target, { type: 'url', content: uri }])),
      },
    })),
  ]
}
