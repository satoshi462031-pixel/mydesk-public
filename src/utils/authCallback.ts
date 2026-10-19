export function matchesAuthCallback(url: string, expected: string): boolean {
  if (url.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(url)) return false
  try { decodeURIComponent(url) } catch { return false }
  return url.split(/[?#]/, 1)[0] === expected
}

export function authCallbackCode(url: string, expected: string): string | null {
  if (!matchesAuthCallback(url, expected)) return null
  const withoutFragment = url.split('#', 1)[0]
  const queryStart = withoutFragment.indexOf('?')
  const query = queryStart < 0 ? '' : withoutFragment.slice(queryStart + 1)
  let code: string | null = null
  for (const pair of query.split('&')) {
    const cut = pair.indexOf('=')
    const key = decodeURIComponent((cut < 0 ? pair : pair.slice(0, cut)).replace(/\+/g, ' '))
    if (key === 'error' || key === 'error_code' || key === 'error_description') return null
    if (key !== 'code') continue
    if (code !== null) return null
    code = decodeURIComponent((cut < 0 ? '' : pair.slice(cut + 1)).replace(/\+/g, ' '))
    if (!code || code.length > 2048 || /[\u0000-\u0020\u007f]/.test(code)) return null
  }
  return code
}
