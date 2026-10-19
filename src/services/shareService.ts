import * as Clipboard from 'expo-clipboard'
// expo-clipboard が未インストールの場合は以下を代わりに使用:
// import Clipboard from '@react-native-clipboard/clipboard'
// その場合 setStringAsync → setString に変更すること
import { Platform, Share } from 'react-native'
import { buildPhotoShareItems, sharePhotoUris } from '../utils/sharePhotoItems'
import { buildPublicProfileUrl, buildPublicUrl } from '../constants/plans'
import { SHARE_HASHTAGS } from '../constants/share'
import { analytics, EVENTS } from './analytics'
import { hapticLight } from '../utils/haptics'
import { getDeskShareIdentifier, getDeskShareUrl } from './deskShareLinks'
import { copyWebText } from '../utils/webClipboard'

export interface DeskShareInfo {
  deskId:      string
  deskName:    string
  /**
   * 計測にだけ使う。手元に機材が無いデスク（別の端末で公開した・他人のデスク）では分からないので省く。
   * 0 で埋めると「0円・0台のデスクが共有された」として集計される
   */
  totalPrice?:  number
  deviceCount?: number
  /** 投稿者の @ID。共有URLに載せて、末尾を削るとプロフィールに着く形にする */
  ownerTag?:   string | null
  /**
   * 一緒に貼るデスクの写真（端末内のファイル）。先頭から4枚まで使う（utils/sharePhotoItems）。
   * 自分のデスクだけ渡す。他人のデスクの写真を自分の投稿の画像として貼らせない
   * （他人のデスクはリンクカードが投稿者の写真を出す）
   */
  photoUris?:  string[]
}

/**
 * 共有シートに流し込む文面。「デスク名 →（空行）→ ハッシュタグ → 公開URL」の順。
 * デスク名の下を1行空けて、名前だけが見出しとして読めるようにする。
 * URL は末尾に置く（X などがリンクカードを作るとき、後ろに文が続かない方が確実）。
 * 金額や台数は載せない。
 */
export function buildShareMessage(
  deskName: string,
  shareIdentifier: string,
  lang: 'ja' | 'en',
  ownerTag?: string | null,
): string {
  const body = `${SHARE_HASHTAGS[lang]}\n${buildPublicUrl(shareIdentifier, ownerTag)}`
  // 名前のない（あるいは空白だけの）デスクで先頭に空行ができないよう、名前と空行ごと落とす
  const name = deskName.trim()
  return name ? `${name}\n\n${body}` : body
}

/**
 * 写真つきで共有シートを開く。共有したら true、閉じただけなら false。
 * react-native-share はネイティブの部品なので、入っていない開発ビルドでは読み込みで落ちる。
 * そのときは null を返し、呼び出し側がリンクだけの共有に切り替える
 */
async function openPhotoShare(message: string, photoUris: readonly string[]): Promise<boolean | null> {
  let RNShare: typeof import('react-native-share').default
  try {
    RNShare = (require('react-native-share') as typeof import('react-native-share')).default
  } catch {
    return null
  }
  const result = await RNShare.open({ activityItemSources: buildPhotoShareItems(message, photoUris), failOnCancel: false })
  return !!result.success && !result.dismissedAction
}

/**
 * 共有シートを開く。公開URL入りの文面を必ず渡し、自分のデスクの写真があれば
 * 文面が残る送り先にだけ一緒に渡す（iOS のみ。Android は初回リリースで出さないのでリンクだけ）
 */
export async function shareDesk(info: DeskShareInfo, lang: 'ja' | 'en' = 'ja'): Promise<void> {
  const deskName = info.deskName.trim()
  const shareId = await getDeskShareIdentifier(info.deskId)
  const message = buildShareMessage(deskName, shareId, lang, info.ownerTag)
  const photos = Platform.OS === 'ios' ? sharePhotoUris(info.photoUris) : []

  if (Platform.OS === 'web') {
    const url = buildPublicUrl(shareId, info.ownerTag)
    let shared = false
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: deskName || 'MyDesk', text: message })
        shared = true
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
      }
    }
    if (!shared) {
      const copied = await copyWebText(url)
      const { showMessage } = await import('../utils/confirmation')
      if (!copied) {
        showMessage(lang === 'ja' ? 'リンクをコピーできませんでした' : 'Could not copy the link',
          `${lang === 'ja' ? '次のURLを選択してコピーしてください。' : 'Select and copy the URL below.'}\n${url}`)
        throw new Error('Clipboard write failed')
      }
      showMessage(lang === 'ja' ? 'リンクをコピーしました' : 'Link copied', url)
    }
    analytics.track(EVENTS.DESK_SHARED, { format: 'link', method: shared ? 'share' : 'copy',
      ...(info.totalPrice != null ? { totalPrice: info.totalPrice } : {}),
      ...(info.deviceCount != null ? { deviceCount: info.deviceCount } : {}),
    })
    return
  }

  const photoShared = photos.length > 0 ? await openPhotoShare(message, photos) : null
  // シェアシートをキャンセルした場合は記録しない（以前は呼び出し前に無条件で
  // 記録していたため、キャンセルしても共有したことになっていた）
  const shared = photoShared ?? (await Share.share({ title: deskName || 'MyDesk', message })).action === Share.sharedAction
  if (shared) {
    analytics.track(EVENTS.DESK_SHARED, {
      format: photoShared === null ? 'link' : 'link_photos',
      ...(photoShared === null ? {} : { photoCount: photos.length }),
      ...(info.totalPrice != null ? { totalPrice: info.totalPrice } : {}),
      ...(info.deviceCount != null ? { deviceCount: info.deviceCount } : {}),
    })
  }
}

/** URLだけクリップボードにコピー */
export async function copyPublicUrl(deskId: string, ownerTag?: string | null): Promise<string> {
  const url = await getDeskShareUrl(deskId, ownerTag)
  if (!await (Platform.OS === 'web' ? copyWebText(url) : Clipboard.setStringAsync(url))) throw new Error('Clipboard write failed')
  hapticLight()
  analytics.track(EVENTS.SHARE_CARD_COPIED)
  return url
}

/** 公開プロフィール（人単位）のURLをコピーする */
export async function copyPublicProfileUrl(tag: string): Promise<void> {
  const url = buildPublicProfileUrl(tag)
  if (!await (Platform.OS === 'web' ? copyWebText(url) : Clipboard.setStringAsync(url))) throw new Error('Clipboard write failed')
  hapticLight()
}

/**
 * 成長率を計算する（最初のバージョンと最新を比較）
 * total_price ベース。初期値がゼロの場合は undefined を返す。
 */
