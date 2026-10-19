import { PUBLISH_TIMEOUT_MS, QUICK_TIMEOUT_MS } from './networkError'
import { assertResponseOrigin, secureHttpUrl } from './secureTransport'

export function createTimeoutFetch(transport: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const allowLocalHttp = typeof __DEV__ !== 'undefined' && __DEV__
    secureHttpUrl(url, allowLocalHttp)
    const pathname = new URL(url).pathname
    const ms = pathname.startsWith('/storage/v1/') || pathname === '/functions/v1/upload-desk-image' ? PUBLISH_TIMEOUT_MS : QUICK_TIMEOUT_MS
    const controller = new AbortController()
    const external = init?.signal ?? (typeof input === 'object' && 'signal' in input ? input.signal : undefined)
    const aborted = new Error('Request aborted')
    aborted.name = 'AbortError'
    const timedOut = new Error(`operation timed out after ${ms}ms`)
    // PostgRESTの自動再試行で、期限を過ぎた通信が繰り返されるのを防ぐ。
    timedOut.name = 'AbortError'
    let rejectInterrupted!: (error: Error) => void
    const interrupted = new Promise<never>((_, reject) => { rejectInterrupted = reject })
    const onAbort = () => { controller.abort(); rejectInterrupted(aborted) }
    external?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => { controller.abort(); rejectInterrupted(timedOut) }, ms)
    try {
      if (external?.aborted) throw aborted
      const work = (async () => {
        const request = typeof input === 'object' && !(input instanceof URL) ? input : undefined
        const method = init?.method ?? request?.method ?? 'GET'
        const requestBody = init?.body !== undefined ? init.body
          : request && method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD' ? await request.blob() : undefined
        if (controller.signal.aborted) throw aborted
        const response = await transport(url, {
          ...(request ? { method: request.method, headers: request.headers } : {}),
          ...init, body: requestBody, credentials: 'omit', redirect: 'error', signal: controller.signal,
        })
        try { assertResponseOrigin(response, url, allowLocalHttp) } catch (error) {
          controller.abort()
          throw error
        }
        if (controller.signal.aborted) throw aborted
        if (method.toUpperCase() === 'HEAD' || [204, 205, 304].includes(response.status)) return response
        // RNのwhatwg-fetchはArrayBufferの本文を1バイト1文字で読み、UTF-8が化ける。BlobならUTF-8で読む。
        const responseBody = await response.blob()
        if (controller.signal.aborted) throw aborted
        return new Response(responseBody, { status: response.status, statusText: response.statusText, headers: response.headers })
      })()
      return await Promise.race([work, interrupted])
    } finally {
      clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    }
  }
}

/** SDKは本文も読み切るため、ヘッダー到着だけで通信の期限を解除しない。 */
export const timeoutFetch = createTimeoutFetch((url, init) => fetch(url, init))
