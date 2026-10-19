import * as FileSystem from 'expo-file-system/legacy'
import * as ImagePicker from 'expo-image-picker'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import { launchImageLibraryFromUserAction } from './imagePicker'
import { runtimePlanImageUri } from './planImageRefs'

// ─── プランの写真ファイル ──────────────────────────────────────────
// 写真の実体は documentDirectory/plan_images/ に置かれ、plan.images に
// そのファイル URI を保持する。プランを複製したときに URI を共有すると、
// 片方で写真を削除した瞬間に実ファイルが消え、もう片方の写真も壊れる。
// 複製時は必ず実ファイルごとコピーして、1ファイル1プランを保つ。

const DIR = FileSystem.documentDirectory + 'plan_images/'
export const PLAN_IMAGE_DIR = DIR

/** ローカルに保存された写真か（リモートURLはコピー対象外） */
function isLocalImage(uri: string): boolean {
  return uri.startsWith('file://') || uri.startsWith('/')
}

/**
 * 写真を複製先プラン専用のファイルとしてコピーし、新しい URI 配列を返す。
 * コピーに失敗した写真は、元の URI を共有せずスキップする（実体の道連れ削除を防ぐ）。
 *
 * リモートURL（共有デスクを取り込んだプランの写真＝他人のストレージ）は引き継がない。
 * 引き継ぐと、複製したデスクを公開したときに他人の写真を自分の公開ページから
 * 直リンクすることになり、相手が消せばこちらのページも壊れる。
 * 複製側の写真はユーザー自身に選び直してもらう。
 */
export async function duplicatePlanImages(images: string[], newPlanId: string): Promise<string[]> {
  // 先頭画像がサムネイルとして扱われるため、元の並び順は保つ
  const local = images.filter(isLocalImage)
  if (local.length === 0) return []

  try {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true })
  } catch {
    return []
  }

  const timestamp = Date.now()
  const result: string[] = []
  for (const [index, uri] of local.entries()) {
    const dest = `${DIR}${newPlanId}_${index}_${timestamp}_${Math.random().toString(36).slice(2, 9)}.jpg`
    try {
      await FileSystem.copyAsync({ from: uri, to: dest })
      await FileSystem.copyAsync({ from: localThumbUri(uri), to: localThumbUri(dest) }).catch(() => {})
      await FileSystem.copyAsync({ from: localMediumUri(uri), to: localMediumUri(dest) }).catch(() => {})
      result.push(dest)
    } catch {
      // コピーできなかった写真は諦める（元プランの実体を共有させない）
    }
  }
  return result
}

/** 写真1枚の実ファイルを消す。plan.images からの除去は呼び出し側が行う */
export async function deletePlanPhoto(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
  // 添えたサムネイル・中サイズも一緒に消す。残すと参照されない孤児ファイルになる
  await FileSystem.deleteAsync(localThumbUri(uri), { idempotent: true }).catch(() => {})
  await FileSystem.deleteAsync(localMediumUri(uri), { idempotent: true }).catch(() => {})
}

/**
 * プラン削除時に、そのプランの写真の実ファイルを消す。
 * これを呼ばないと plan.images から参照されなくなった写真が端末に残り続ける。
 *
 * plan.images の URI を消すだけでなく、ファイル名の `<planId>_` プレフィックスでも
 * 走査する：保存直後にアプリが落ちるなどして plan.images に載らなかった孤児ファイルも
 * ここでしか掃除する機会がないため。
 */
export async function deletePlanImages(planId: string, images: string[] = []): Promise<void> {
  for (const uri of images.filter(isLocalImage)) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
  }
  try {
    const names = await FileSystem.readDirectoryAsync(DIR)
    for (const name of names.filter((n) => n.startsWith(`${planId}_`))) {
      await FileSystem.deleteAsync(DIR + name, { idempotent: true }).catch(() => {})
    }
  } catch {
    // ディレクトリが無い（写真を一度も追加していない）場合は何もしない
  }
}

/**
 * 実物が端末に無いローカル写真を plan.images から外す（バックアップの復元用）。
 * 有無を確かめられなかった写真は残す。消えていないものまで外すと、実物が
 * どのデスクからも参照されない孤児になる。
 *
 * 控えの写真パスは、控えを作った時点のコンテナの絶対パス。iOS はアプリの更新でコンテナの
 * UUID が変わるので、そのまま有無を見ると、同じ端末に実物が残っている写真まで外してしまう。
 * 今のコンテナのパスへ置き直してから確かめる
 */
export async function dropMissingLocalImages<T extends { images?: string[] }>(plans: readonly T[]): Promise<T[]> {
  return Promise.all(plans.map(async (plan) => {
    if (!plan.images) return plan
    const images = plan.images.map((uri) => runtimePlanImageUri(uri, FileSystem.documentDirectory))
    const kept: string[] = []
    for (const uri of images) {
      if (!isLocalImage(uri)) { kept.push(uri); continue }
      const info = await FileSystem.getInfoAsync(uri).catch(() => null)
      if (!info || info.exists) kept.push(uri)
    }
    const original = plan.images
    return kept.length === original.length && kept.every((uri, index) => uri === original[index])
      ? plan : { ...plan, images: kept }
  }))
}

/**
 * ログアウト・全データ削除時に、全プランの写真をまとめて消す。
 * キャッシュに残る写しも一緒に消す。写真の選択（ImagePicker）と加工（ImageManipulator）の
 * 出力には元の写真や公開用に縮めた写真が、データの書き出しには全デスクの JSON が入っていて、
 * OS が空き容量の都合で消すまで残る
 */
export async function deleteAllPlanImages(): Promise<void> {
  const cache = FileSystem.cacheDirectory
  const exports = cache
    ? await FileSystem.readDirectoryAsync(cache)
      .then((names) => names.filter((name) => /^mydesk-\d{4}-\d{2}-\d{2}\.json$/.test(name)))
      .catch(() => [] as string[])
    : []
  const cached = cache ? ['ImagePicker/', 'ImageManipulator/', ...exports].map((name) => cache + name) : []
  await Promise.all([DIR, ...cached].map((uri) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})))
}

// ─── 写真を選んで取り込む ──────────────────────────────────────────
// 配線図の画面と写真追加の画面（PhotoFill）の両方から呼ぶ。
// 保存先のファイル名は `<planId>_<key>.jpg` で、deletePlanImages の
// プレフィックス走査と対になっている。ここを画面側で組み立てると、
// 命名規則が2か所に分かれてデスク削除時の掃除から漏れる。

export interface PickPlanPhotosResult {
  added: string[]
  /** 上限サイズ超過で入れなかった枚数 */
  oversized: number
  /** すでに同じ写真がこのデスクにある */
  duplicate: number
  failed: number
  /** フォトライブラリの許可が無い。案内は呼び出し側が出す */
  permissionDenied: boolean
}

const EMPTY_RESULT: PickPlanPhotosResult = {
  added: [], oversized: 0, duplicate: 0, failed: 0, permissionDenied: false,
}

// ─── 取り込み時のリサイズ ──────────────────────────────────────────
//
// カメラロールの原本をそのままコピーすると、48MP の写真は1枚 10〜25MB になる。
// 上限まで入れると端末に 200MB 以上残るうえ、公開時の uploadDeskImage が
// 原本のサイズで弾いていたため「追加はできたのに公開できない」状態を作っていた。
//
// 長辺 3840 にしてから置く。公開時にアップロードするのは長辺 1920 なので
// 表示にはこれで足りるが、**あえて 1920 まで落とさない**。端末に残るのが
// アップロード後と同じ寸法だと、あとから高解像度で公開したくなっても
// 遡れなくなる（原本はカメラロールにしか無く、どの写真だったかは辿れない）。
// 拡大表示は MAX_SCALE=5 なので、3840 あれば 5 倍でも 1.6 倍の引き伸ばしに収まる。
const IMPORT_LONG_EDGE = 3840
// 端末に置くのは「原本の代わり」で、公開時にもう一度 JPEG へ焼き直される。
// 二重の再圧縮で劣化が重なるので、こちら側は高めにする
const IMPORT_QUALITY = 0.9

// ─── ストリップ用のローカルサムネイル ──────────────────────────────
//
// React Native の Image は、ローカルファイルを表示枠に合わせて間引いてくれない。
// 高さ80のサムネ列に長辺3840の画像を10枚並べると、デコード結果がそのまま
// メモリに積む。公開デスク側（RemoteThumb）が長辺400のサムネを読んでいるのと
// 同じことを手元でもやる。
//
// 名前は `<マスタのファイル名>_thumb.jpg`。deletePlanImages の `<planId>_`
// 前置き走査に自然に入るので、デスクを消したときの掃除は既存のままで届く。
// **無いときはマスタで代替できるようにしておく**（取り込み時に生成に失敗した
// 写真、この仕組みより前に取り込んだ写真が必ず存在する）。
const LOCAL_THUMB_LONG_EDGE = 400
const LOCAL_THUMB_QUALITY = 0.8

/** マスタの URI から、その写真のローカルサムネイルの URI を導く */
export function localThumbUri(uri: string): string {
  return uri.replace(/\.jpg$/i, '_thumb.jpg')
}

// 一覧の1列のタイル用の中サイズ（公開側の getMediumUrl と同じ長辺・同じ名前の付け方）。
// サムネイルと同じく、無いとき（これより前に取り込んだ写真）は表示側がサムネイルへ落とす。
// マスタ（長辺3840）へは落とさない：一覧に並べるとデコード結果がそのまま積む
const LOCAL_MEDIUM_LONG_EDGE = 1200
const LOCAL_MEDIUM_QUALITY = 0.8

/** マスタの URI から、その写真のローカル中サイズの URI を導く */
export function localMediumUri(uri: string): string {
  return uri.replace(/\.jpg$/i, '_md.jpg')
}

/**
 * 選ばれた写真を、リサイズしてから dest へ置く。
 * 長辺が上限以下（寸法が読めない場合も含む）のものは、余計な再圧縮をせずそのままコピーする。
 */
async function importPhotoTo(asset: ImagePicker.ImagePickerAsset, dest: string): Promise<void> {
  const width  = asset.width  ?? 0
  const height = asset.height ?? 0
  const longEdge = Math.max(width, height)
  if (longEdge <= IMPORT_LONG_EDGE) {
    await FileSystem.copyAsync({ from: asset.uri, to: dest })
    return
  }
  const resize = width >= height ? { width: IMPORT_LONG_EDGE } : { height: IMPORT_LONG_EDGE }
  const resized = await manipulateAsync(
    asset.uri,
    [{ resize }],
    { compress: IMPORT_QUALITY, format: SaveFormat.JPEG },
  )
  await FileSystem.copyAsync({ from: resized.uri, to: dest })
  // manipulateAsync の出力はキャッシュに残る。放っておくと取り込んだぶんだけ二重に食う
  await FileSystem.deleteAsync(resized.uri, { idempotent: true }).catch(() => {})
}

/**
 * サムネイルを添えて置く。失敗しても取り込みそのものは成立させる
 * （表示側はサムネイルが無ければマスタへ落ちる）。
 */
async function writeLocalThumb(asset: ImagePicker.ImagePickerAsset, dest: string): Promise<void> {
  await writeLocalVariant(asset, localThumbUri(dest), LOCAL_THUMB_LONG_EDGE, LOCAL_THUMB_QUALITY)
}

/** 中サイズを添えて置く。サムネイルと同じく、失敗しても取り込みは成立させる */
async function writeLocalMedium(asset: ImagePicker.ImagePickerAsset, dest: string): Promise<void> {
  await writeLocalVariant(asset, localMediumUri(dest), LOCAL_MEDIUM_LONG_EDGE, LOCAL_MEDIUM_QUALITY)
}

async function writeLocalVariant(
  asset: ImagePicker.ImagePickerAsset,
  to: string,
  longEdge: number,
  quality: number,
): Promise<void> {
  const width  = asset.width  ?? 0
  const height = asset.height ?? 0
  const resize = width >= height || width === 0
    ? { width: longEdge }
    : { height: longEdge }
  const out = await manipulateAsync(
    asset.uri,
    [{ resize }],
    { compress: quality, format: SaveFormat.JPEG },
  )
  await FileSystem.copyAsync({ from: out.uri, to })
  await FileSystem.deleteAsync(out.uri, { idempotent: true }).catch(() => {})
}

export async function pickPlanPhotos({ planId, existing, limit, maxFileSizeMB }: {
  planId: string
  existing: readonly string[]
  /** あと何枚入れられるか（プランの上限 − 現在の枚数） */
  limit: number
  maxFileSizeMB: number
}): Promise<PickPlanPhotosResult> {
  if (limit <= 0) return EMPTY_RESULT

  const launch = await launchImageLibraryFromUserAction({
    mediaTypes: ['images'],
    quality: 0.8,
    allowsMultipleSelection: true,
    selectionLimit: limit,
    orderedSelection: true,
  })
  if (launch.permissionDenied) return { ...EMPTY_RESULT, permissionDenied: true }
  const picked = launch.result
  if (picked.canceled || picked.assets.length === 0) return EMPTY_RESULT
  try {
    return await importPickedPhotos(picked.assets, { planId, existing, limit, maxFileSizeMB })
  } finally {
    // ImagePicker は選んだ写真を、元の画質・撮影位置などの付いたままキャッシュへ複製する。
    // 取り込み後に残すと、デスクや写真を消しても端末に原本の写しが残り続ける
    await Promise.all(picked.assets.map((asset) => deletePickerCopy(asset.uri)))
  }
}

async function deletePickerCopy(uri: string): Promise<void> {
  const cache = FileSystem.cacheDirectory
  if (!cache || !uri.startsWith(cache)) return
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
}

async function importPickedPhotos(
  assets: ImagePicker.ImagePickerAsset[],
  { planId, existing, limit, maxFileSizeMB }: { planId: string; existing: readonly string[]; limit: number; maxFileSizeMB: number },
): Promise<PickPlanPhotosResult> {
  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true })

  const result: PickPlanPhotosResult = { ...EMPTY_RESULT, added: [] }
  const batchKey = Date.now()

  for (const [index, asset] of assets.slice(0, limit).entries()) {
    if (asset.fileSize && asset.fileSize > maxFileSizeMB * 1024 * 1024) {
      result.oversized += 1
      continue
    }

    // assetId（iOS PHAsset ID）を使って同じ写真を一意に識別し、同一プラン内の重複を防ぐ。
    // ファイル名にプランIDを含め、別プランの写真を削除しても影響しないようにする。
    const fileKey = asset.assetId
      ? asset.assetId.replace(/[^a-zA-Z0-9]/g, '_')
      : `${batchKey}_${index}`
    const dest = `${DIR}${planId}_${fileKey}.jpg`
    if (existing.includes(dest) || result.added.includes(dest)) {
      result.duplicate += 1
      continue
    }

    try {
      await importPhotoTo(asset, dest)
      // サムネイル・中サイズは表示を軽くするためだけのもの。作れなくても写真は追加する
      await writeLocalThumb(asset, dest).catch(() => {})
      await writeLocalMedium(asset, dest).catch(() => {})
      result.added.push(dest)
    } catch {
      result.failed += 1
    }
  }

  return result
}

/** 入れられなかった写真の理由。1枚も落ちていなければ null */
export function planPhotoSkipMessage(
  result: PickPlanPhotosResult,
  maxFileSizeMB: number,
  lang: 'ja' | 'en',
): string | null {
  const { oversized, duplicate, failed } = result
  if (oversized + duplicate + failed === 0) return null
  const reasons = lang === 'en'
    ? [
        oversized > 0 ? `${oversized} over ${maxFileSizeMB}MB` : '',
        duplicate > 0 ? `${duplicate} already added` : '',
        failed > 0 ? `${failed} could not be saved` : '',
      ]
    : [
        oversized > 0 ? `${oversized}枚が${maxFileSizeMB}MB超過` : '',
        duplicate > 0 ? `${duplicate}枚が登録済み` : '',
        failed > 0 ? `${failed}枚を保存できませんでした` : '',
      ]
  return reasons.filter(Boolean).join(lang === 'en' ? ', ' : '、')
}
