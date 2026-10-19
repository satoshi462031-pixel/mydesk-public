// ─── 通信エラーの扱い ────────────────────────────────────────────
//
// オフライン時に投げられる例外は、そのまま画面に出すと日本語の画面に
// `Network request failed` のような英語の技術文が出る。何が起きたのかも、
// どうすればいいのかも伝わらないので、通信起因だけは自前の文言に置き換える。

import { localizedErrorMessage } from './localizedError'

const NETWORK_HINTS = [
  'network request failed',
  'failed to fetch',
  'network error',
  'timed out',
  'timeout',
  'econnreset',
  'enotfound',
  'socket',
  'offline',
]

/**
 * エラーから文言を取り出す。
 * Supabase（PostgrestError / StorageError）は Error ではなく { message } を持つ
 * ただのオブジェクトを返すので、instanceof だけで見ると取りこぼす。
 */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return ''
}

/**
 * 通信できていないことが原因のエラーか。
 * fetch / Supabase / OS でメッセージが揃っていないため、文字列で見るしかない。
 */
export function isNetworkError(error: unknown): boolean {
  const lower = messageOf(error).toLowerCase()
  return NETWORK_HINTS.some((hint) => lower.includes(hint))
}

/**
 * ユーザーに見せる文言を決める。
 *
 * 通信起因だけここで拾い、残りの判断は localizedErrorMessage に任せる。
 * 以前はここでも生の message を出すか決めていたが、日本語表示のときしか
 * 言語の食い違いを見ていなかったため、英語表示に日本語のまま漏れていた
 * （公開時のモデレーション文言など、サービス側は日本語で throw する）。
 *
 * messageOf を通してから渡すのは、Supabase が Error ではなく { message } の
 * ただのオブジェクトを返すため。localizedErrorMessage は Error と string しか
 * 見ないので、素通しすると取りこぼす。
 */
export function userErrorMessage(error: unknown, lang: 'ja' | 'en', fallback: string): string {
  if (isNetworkError(error)) {
    return lang === 'ja'
      ? '通信できませんでした。電波の良い場所でもう一度お試しください。'
      : 'Could not connect. Move somewhere with a better signal and try again.'
  }
  return localizedErrorMessage(messageOf(error).trim(), lang, fallback)
}

/** 写真のアップロードを伴う公開・更新用。低速回線でも打ち切りすぎない長さにする */
export const PUBLISH_TIMEOUT_MS = 60_000
/** 1行の更新だけで終わる操作用 */
export const QUICK_TIMEOUT_MS = 20_000
/** AsyncStorage の読み込みが返らないとき、起動や一覧をスピナーのまま止めない */
export const STORAGE_TIMEOUT_MS = 5_000

/**
 * 返ってこない通信を打ち切る。
 *
 * Promise の待機だけを打ち切る。通信を止める場合は AbortController も使う。
 * 保存処理は後から完了し得るため、この Promise を保存の直列キューに使わない。
 */
export function withTimeout<T>(work: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
    const onAbort = () => {
      cleanup()
      const error = new Error('Request aborted')
      error.name = 'AbortError'
      reject(signal?.reason ?? error)
    }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`operation timed out after ${ms}ms`)) }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
    if (signal?.aborted) onAbort()
  })
}
