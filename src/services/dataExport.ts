// 自分のデータの持ち出し。
//
// 復元（backupService）はアカウント内で閉じており、アプリを消すと手元には何も
// 残らない。ガジェットもデスクも本人が1件ずつ積んだもので、蓄積そのものが
// 使い続ける理由になっている。読める形で外に出せる道を用意する。
//
// 中身はアカウントへ自動保存しているスナップショットと同じ。書き出し専用の
// 形を別に作ると、項目が増えたときに片方だけ古くなる。
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'
import { buildBackupPayload, isPayloadEmpty, LocalDataSource } from './backupService'

export type DataExportResult = 'shared' | 'unsupported' | 'empty'

/** ファイル名は日付まで。同じ日に2回書き出すと上書きになるが、中身は共有シートへ渡した時点の写し */
function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `mydesk-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}

/**
 * ガジェット・デスク・AI相談履歴を JSON で書き出し、共有シートへ渡す。
 *
 * 写真は含まない（バックアップと同じ。端末内のパスは持ち出し先で開けない）。
 */
export async function exportUserData(source?: LocalDataSource): Promise<DataExportResult> {
  if (!(await Sharing.isAvailableAsync())) return 'unsupported'

  const payload = await buildBackupPayload(source)
  if (isPayloadEmpty(payload)) return 'empty'

  // cacheDirectory に置く。書き出したファイルを端末に溜め続ける必要は無く、
  // OS が空き容量を必要としたときに回収してよい
  const dir = FileSystem.cacheDirectory
  if (!dir) return 'unsupported'
  const uri = `${dir}${exportFileName(new Date())}`
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(payload, null, 2))

  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'MyDesk',
  })
  return 'shared'
}
