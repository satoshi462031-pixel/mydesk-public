export class SecureTransportError extends Error {
  constructor() {
    super('Secure HTTPS connection required')
    // SDKに再試行させても安全な接続先にはならないため、その場で中断する。
    this.name = 'AbortError'
  }
}

export function secureHttpUrl(value: string, allowLocalHttp = false): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new SecureTransportError() }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((!url.hostname || url.username || url.password || url.hash)
    || (url.protocol !== 'https:' && !(allowLocalHttp && local && url.protocol === 'http:'))) {
    throw new SecureTransportError()
  }
  return url
}

export function assertResponseOrigin(response: Response, expectedUrl: string, allowLocalHttp = false): void {
  if (!response.url) return
  const actual = secureHttpUrl(response.url, allowLocalHttp)
  if (actual.origin !== secureHttpUrl(expectedUrl, allowLocalHttp).origin) throw new SecureTransportError()
}
