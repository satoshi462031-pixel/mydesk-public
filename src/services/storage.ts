import * as Crypto from 'expo-crypto'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { Image } from 'react-native'
import { supabase } from '../supabase/client'
import { copyPublicImage, uploadPublicImage } from './imageUploadGateway'
import { PUBLISH_TIMEOUT_MS, QUICK_TIMEOUT_MS, withTimeout } from '../utils/networkError'

const BUCKET_PUBLIC = 'desk-images'

// バケットは public のため、/object/public/... は RLS を通らず、URL を知っていれば
// 誰でも取得できる。パスが `<user_id>/<desk_id>/<ミリ秒>.jpg` だと、公開デスクから
// user_id・desk_id・公開時刻が読める以上ほぼ推測できてしまうので、
// 推測不能なトークンをファイル名に混ぜる。
function randomToken(): string {
  return Crypto.randomUUID().replace(/-/g, '')
}

/** 公開URLから Storage 上のオブジェクトパスを取り出す。この形式でなければ null */
function storagePathFromUrl(imageUrl: string): string | null {
  try {
    const marker = `/object/public/${BUCKET_PUBLIC}/`
    const parts = new URL(imageUrl).pathname.split(marker)
    return parts.length >= 2 && parts[1] ? decodeURIComponent(parts[1]) : null
  } catch {
    return null
  }
}

const LONG_EDGE_FULL  = 1920
const LONG_EDGE_THUMB = 400
// 一覧の1列のタイル（幅 約360pt ＝ 3倍の端末で 1080px）用。サムネイル（400）では
// 2.7倍に引き伸ばされて粗く、フルサイズ（1920）では一覧を流すたびに転送が数MB単位で増える
const LONG_EDGE_MEDIUM = 1200
const QUALITY_FULL    = 0.82
const QUALITY_THUMB   = 0.80
const QUALITY_MEDIUM  = 0.80

export interface UploadImageResult {
  fullUrl:  string
  thumbUrl: string
}

/** フルサイズURL からサムネイルURLを導出する */
export function getThumbUrl(fullUrl: string): string {
  return fullUrl.replace(/\.jpg(\?.*)?$/, '_thumb.jpg')
}

/** フルサイズURL から中サイズ（長辺1200）の URL を導出する。中サイズを入れる前の写真には無い */
export function getMediumUrl(fullUrl: string): string {
  return fullUrl.replace(/\.jpg(\?.*)?$/, '_md.jpg')
}

/** デスク写真1枚ぶんの実体（フルサイズ・サムネイル・中サイズ）。消すときはまとめて消す */
export function deskImageFileUrls(fullUrl: string): string[] {
  return [fullUrl, getThumbUrl(fullUrl), getMediumUrl(fullUrl)]
}

function getOriginalDimensions(uri: string): Promise<{ width: number; height: number }> {
  return withTimeout(new Promise((resolve, reject) =>
    Image.getSize(uri, (width, height) => resolve({ width, height }), reject),
  ), QUICK_TIMEOUT_MS)
}

function readImageBuffer(uri: string): Promise<Uint8Array> {
  return withTimeout(fetch(uri).then(response => response.arrayBuffer()).then(buffer => new Uint8Array(buffer)), QUICK_TIMEOUT_MS)
}

// ─── デスク写真アップロード ────────────────────────────────────────

// ここで元ファイルのサイズを見てはいけない。
//
// 以前は plans.ts の maxFileSizeMB で弾いていたが、引数の既定値が `isPro = false` で
// 呼び出し側（publishService）が渡していなかったため、**Pro が無料枠の 10MB で
// 判定されていた**。ピッカーは Pro の 20MB で通すので、10〜20MB の写真は
// 「追加はできたのに公開だけ何度やっても失敗する」状態になっていた。
//
// そもそもこの検証は要らない。下でどの写真も長辺 1920 / 品質 0.82 に焼き直すので、
// 元ファイルの大きさは Storage にも転送量にも影響しない。守っていたのは
// manipulateAsync のデコード代だけで、それは取り込み時（planImages.ts が長辺 3840 に
// 落とす）で足りている。上限を2箇所に置くと、また片方だけ古い値になる。
export async function uploadDeskImage(
  userId: string,
  deskId: string,
  localUri: string,
): Promise<UploadImageResult> {
  // 長辺を判定してリサイズ軸を決める
  const { width: origW, height: origH } = await getOriginalDimensions(localUri)
  const isLandscape = origW >= origH
  const resizeFull  = isLandscape ? { width: LONG_EDGE_FULL }  : { height: LONG_EDGE_FULL }
  const resizeThumb = isLandscape ? { width: LONG_EDGE_THUMB } : { height: LONG_EDGE_THUMB }
  const resizeMedium = isLandscape ? { width: LONG_EDGE_MEDIUM } : { height: LONG_EDGE_MEDIUM }

  // フルサイズ（Exif自動削除・JPEG変換）
  const full = await withTimeout(manipulateAsync(
    localUri,
    [{ resize: resizeFull }],
    { compress: QUALITY_FULL, format: SaveFormat.JPEG },
  ), PUBLISH_TIMEOUT_MS)

  // サムネイル（長辺400px）
  const thumb = await withTimeout(manipulateAsync(
    localUri,
    [{ resize: resizeThumb }],
    { compress: QUALITY_THUMB, format: SaveFormat.JPEG },
  ), PUBLISH_TIMEOUT_MS)

  const medium = await withTimeout(manipulateAsync(
    localUri,
    [{ resize: resizeMedium }],
    { compress: QUALITY_MEDIUM, format: SaveFormat.JPEG },
  ), PUBLISH_TIMEOUT_MS)

  const bucket = BUCKET_PUBLIC
  const name      = `${Date.now()}-${randomToken()}`
  const fullPath  = `${userId}/${deskId}/${name}.jpg`
  const thumbPath = `${userId}/${deskId}/${name}_thumb.jpg`
  const mediumPath = `${userId}/${deskId}/${name}_md.jpg`

  // フルサイズアップロード
  const [fullBuf, thumbBuf, mediumBuf] = await Promise.all([readImageBuffer(full.uri), readImageBuffer(thumb.uri), readImageBuffer(medium.uri)])
  await uploadPublicImage(fullPath, fullBuf)

  // サムネイルアップロード
  try { await uploadPublicImage(thumbPath, thumbBuf) } catch (error) {
    await supabase.storage.from(bucket).remove([fullPath]).catch(() => {})
    throw error
  }

  // 中サイズもサムネイルと同じく揃わなければ巻き戻す。欠けたまま公開すると、
  // その写真のタイルはフルサイズを読み続ける
  try { await uploadPublicImage(mediumPath, mediumBuf) } catch (error) {
    await supabase.storage.from(bucket).remove([fullPath, thumbPath]).catch(() => {})
    throw error
  }

  const { data: d1 } = supabase.storage.from(bucket).getPublicUrl(fullPath)
  const { data: d2 } = supabase.storage.from(bucket).getPublicUrl(thumbPath)

  return { fullUrl: d1.publicUrl, thumbUrl: d2.publicUrl }
}

// ─── アバターアップロード ──────────────────────────────────────────
// デスク写真と同じ desk-images バケットの `<user_id>/avatar/` に置く。
// 専用バケットを足しても、公開読み取り・所有者フォルダという条件は同じで、
// ポリシーを二重に持つぶん食い違う余地が増えるだけ。
// パスの `avatar/` は 059 の RPC が「本人がアップロードした画像か」を見る目印でもある。
// アイコンも全画面で開けるようにしたので、円の直径（最大 88pt ≒ 264px）では
// 足りない。画面幅いっぱいに出したときに等倍で並ぶ寸法にする。
// 1人1枚しか持たないので、増やしても Storage への影響は無視できる。
// **これより前に登録されたアイコンは 512 のまま**で、全画面では甘く見える
// （選び直せば入れ替わる。過去分の焼き直しはしない）。
const LONG_EDGE_AVATAR = 1280
const QUALITY_AVATAR   = 0.85
// 一覧に並ぶ円は 18〜24pt、いちばん大きい場所（マイページ）でも 88pt ≒ 264px。
// 全画面用の 1280 をそのまま円に流すと、タイル1枚ごとに 1280×1280 の
// デコード結果が積む。デスク写真と同じく `_thumb` を添えて、小さい枠はそちらを読む
const LONG_EDGE_AVATAR_THUMB = 320
const QUALITY_AVATAR_THUMB   = 0.8

// 元ファイルのサイズは見ない。下で長辺 1280 に焼き直すので Storage にも転送量にも
// 影響せず、守っていたのはデコード代だけ。しかも以前は無料枠の 10MB で弾いていたため、
// 48MP の写真を選んで正方形に切ったあとに「10MB以下を選んでください」で落ちていた
// （切り抜きまで終わってから拒否されるので、やり直す手がかりが無い）。
export async function uploadAvatarImage(userId: string, localUri: string): Promise<string> {
  // Exif は JPEG 変換で落ちる
  const { width, height } = await getOriginalDimensions(localUri)
  const isLandscape = width >= height
  const image = await withTimeout(manipulateAsync(
    localUri,
    [{ resize: isLandscape ? { width: LONG_EDGE_AVATAR } : { height: LONG_EDGE_AVATAR } }],
    { compress: QUALITY_AVATAR, format: SaveFormat.JPEG },
  ), PUBLISH_TIMEOUT_MS)
  const thumb = await withTimeout(manipulateAsync(
    localUri,
    [{ resize: isLandscape ? { width: LONG_EDGE_AVATAR_THUMB } : { height: LONG_EDGE_AVATAR_THUMB } }],
    { compress: QUALITY_AVATAR_THUMB, format: SaveFormat.JPEG },
  ), PUBLISH_TIMEOUT_MS)

  const name = `${Date.now()}-${randomToken()}`
  const path = `${userId}/avatar/${name}.jpg`
  const thumbPath = `${userId}/avatar/${name}_thumb.jpg`

  const [buf, thumbBuf] = await Promise.all([readImageBuffer(image.uri), readImageBuffer(thumb.uri)])
  await uploadPublicImage(path, buf)

  try { await uploadPublicImage(thumbPath, thumbBuf) } catch (error) {
    // 本体だけ残すと、一覧が 1280 を読み続ける状態で固定される（uploadDeskImage と同じ理由）
    await supabase.storage.from(BUCKET_PUBLIC).remove([path]).catch(() => {})
    throw error
  }

  // DB に入れるのは本体の URL だけ。サムネは getThumbUrl で導ける
  const { data } = supabase.storage.from(BUCKET_PUBLIC).getPublicUrl(path)
  return data.publicUrl
}

/** 差し替え・削除で参照されなくなった古いアイコンを消す。失敗しても表示には影響しない */
export async function deleteAvatarImage(imageUrl: string): Promise<void> {
  await deleteDeskImage(imageUrl)
  // サムネも道連れにする。残すと参照されない孤児ファイルになる
  // （サムネを入れる前のアイコンには無いので、失敗は無視される deleteDeskImage を使う）
  await deleteDeskImage(getThumbUrl(imageUrl))
}

export async function deleteDeskImageStrict(imageUrl: string): Promise<void> {
  const path = storagePathFromUrl(imageUrl)
  if (!path) return
  const { error } = await supabase.storage.from(BUCKET_PUBLIC).remove([path])
  if (error) throw error
}

export async function deleteDeskImage(imageUrl: string): Promise<void> {
  await deleteDeskImageStrict(imageUrl).catch(() => {})
}

async function existingDeskImagePaths(imageUrl: string): Promise<string[]> {
  const path = storagePathFromUrl(imageUrl)
  if (!path) throw new Error('INVALID_DESK_IMAGE_URL')
  const folder = path.slice(0, path.lastIndexOf('/') + 1)
  if (!folder) throw new Error('INVALID_DESK_IMAGE_URL')
  const filename = path.slice(folder.length)
  const { data, error } = await supabase.storage.from(BUCKET_PUBLIC).list(folder.slice(0, -1), {
    search: filename.replace(/\.jpg$/, ''), limit: 100,
  })
  if (error) throw error
  const names = new Set((data ?? []).map((file) => file.name))
  return deskImageFileUrls(imageUrl)
    .map(storagePathFromUrl)
    .filter((candidate): candidate is string => !!candidate && names.has(candidate.slice(folder.length)))
}

export async function revokeDeskImageUrl(imageUrl: string): Promise<void> {
  const paths = await existingDeskImagePaths(imageUrl)
  if (paths.length === 0) return
  const { error } = await supabase.storage.from(BUCKET_PUBLIC).remove(paths)
  if (error) throw error
  // remove は対象行がRLSで隠れると空の成功結果を返す場合がある。
  if ((await existingDeskImagePaths(imageUrl)).length > 0) throw new Error('DESK_IMAGE_REVOCATION_FAILED')
}

/** DBへ新旧URLを記録してから旧実体を消す。通信断でも写真の参照と再試行先を失わない。 */
export async function rotateDeskImage(
  imageUrl: string,
  commitRotation: (newUrl: string) => Promise<void>,
): Promise<string> {
  const paths = await existingDeskImagePaths(imageUrl)
  const path = storagePathFromUrl(imageUrl)!
  if (!paths.includes(path)) throw new Error('DESK_IMAGE_NOT_FOUND')
  const folder = path.slice(0, path.lastIndexOf('/') + 1)
  const originalName = path.slice(folder.length).replace(/\.jpg$/, '')
  const newName = `${Date.now()}-${randomToken()}`
  const bucket = supabase.storage.from(BUCKET_PUBLIC)
  const copied: string[] = []
  try {
    for (const source of paths) {
      const target = `${folder}${newName}${source.slice(folder.length + originalName.length)}`
      await copyPublicImage(source, target)
      copied.push(target)
    }
  } catch (error) {
    if (copied.length) await bucket.remove(copied).catch(() => {})
    throw error
  }
  const { data } = bucket.getPublicUrl(`${folder}${newName}.jpg`)
  // DB更新の応答だけ失われた可能性があるため、ここからは新しい実体を巻き戻さない。
  await commitRotation(data.publicUrl)
  await revokeDeskImageUrl(imageUrl)
  return data.publicUrl
}
