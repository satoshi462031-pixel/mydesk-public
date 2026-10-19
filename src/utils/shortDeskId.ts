// 共有URLに載せるデスクIDの短縮表現。
// UUID(36文字) の 16バイトをそのまま base64url にして 22文字にする。
// 単なる符号化なので DB に列を足す必要がなく、開くときの追加問い合わせも要らない
// （短縮IDを別に採番すると、リンクを開くたびに ID を引き直す往復が挟まる）。

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHORT_RE = /^[A-Za-z0-9_-]{22}$/

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

export function isShortDeskId(value: string): boolean {
  return SHORT_RE.test(value)
}

/** UUID → 22文字の base64url。UUID でなければそのまま返す。 */
export function encodeDeskId(uuid: string): string {
  if (!isUuid(uuid)) return uuid

  const hex = uuid.replace(/-/g, '')
  const bytes: number[] = []
  for (let i = 0; i < 32; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16))

  let out = ''
  for (let i = 0; i < 15; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63]
  }
  // 16バイトは3で割り切れないので、最後の1バイトだけ2文字（12bit中4bitは0埋め）
  const last = bytes[15]
  out += ALPHABET[(last >> 2) & 63] + ALPHABET[(last << 4) & 63]
  return out
}

/** 22文字の base64url → UUID。短縮IDでなければそのまま返す。 */
export function decodeDeskId(code: string): string {
  if (!isShortDeskId(code)) return code

  const bytes: number[] = []
  for (let i = 0; i < 20; i += 4) {
    const n =
      (ALPHABET.indexOf(code[i]) << 18) |
      (ALPHABET.indexOf(code[i + 1]) << 12) |
      (ALPHABET.indexOf(code[i + 2]) << 6) |
      ALPHABET.indexOf(code[i + 3])
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  bytes.push(((ALPHABET.indexOf(code[20]) << 2) | (ALPHABET.indexOf(code[21]) >> 4)) & 255)

  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
