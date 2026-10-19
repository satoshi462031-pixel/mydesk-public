import { secureHttpUrl } from './secureTransport'

export function createPublicApiFetch(
  fetcher: typeof globalThis.fetch, supabaseUrl: string, anonKey: string, gatewayUrl: string,
): typeof globalThis.fetch {
  const origin = new URL(supabaseUrl).origin
  const gateway = secureHttpUrl(gatewayUrl, typeof __DEV__ !== 'undefined' && __DEV__).href.replace(/\/$/, '')
  return (input, init) => {
    const request = input instanceof Request ? input : null
    const target = new URL(request?.url ?? String(input))
    const headers = new Headers(init?.headers ?? request?.headers)
    if (target.origin !== origin || !target.pathname.startsWith('/rest/v1/')
      || (headers.get('Authorization') && headers.get('Authorization') !== `Bearer ${anonKey}`)) return fetcher(input, init)
    // 公開入口にはクライアントの認証情報を渡さず、Workerが匿名権限を付与する。
    const publicHeaders = new Headers()
    for (const name of ['Accept', 'Content-Type', 'Prefer']) {
      const value = headers.get(name)
      if (value) publicHeaders.set(name, value)
    }
    const destination = `${gateway}/api/public${target.pathname}${target.search}`
    return fetcher(request ? new Request(destination, request) : destination, { ...init, headers: publicHeaders })
  }
}
