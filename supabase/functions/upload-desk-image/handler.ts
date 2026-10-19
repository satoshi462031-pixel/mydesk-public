export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface ImageUploadStore {
  ownsDesk(deskId: string, userId: string): Promise<boolean>
  reserve(userId: string, bytes: number): Promise<void>
  upload(path: string, bytes: Uint8Array): Promise<void>
  copy(source: string, target: string): Promise<void>
  imageSize(source: string): Promise<number>
}

function imagePath(value: unknown, userId: string): string {
  if (typeof value !== 'string' || value.length > 250) throw new Error('INVALID_IMAGE_UPLOAD')
  const parts = value.split('/')
  if (parts.length !== 3 || parts[0] !== userId
    || !/^(?:avatar|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.test(parts[1])
    || !/^[A-Za-z0-9_-]+\.jpg$/.test(parts[2])) throw new Error('INVALID_IMAGE_UPLOAD')
  return value
}

async function readBounded(request: Request, limit: number): Promise<Uint8Array> {
  const length = request.headers.get('Content-Length')
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error('IMAGE_TOO_LARGE')
  const reader = request.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('IMAGE_UPLOAD_UNAVAILABLE')), 20_000)
  })
  if (reader) try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline])
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('IMAGE_TOO_LARGE')
      chunks.push(value)
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error }
  finally { clearTimeout(timer) }
  else clearTimeout(timer)
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

export async function handleImageUpload(request: Request, userId: string, store: ImageUploadStore): Promise<Response> {
  try {
    const type = request.headers.get('Content-Type')?.split(';')[0]
    if (type === 'application/json') {
      const body = JSON.parse(new TextDecoder().decode(await readBounded(request, 2048))) as { source?: unknown; target?: unknown }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('INVALID_IMAGE_UPLOAD')
      const source = imagePath(body.source, userId), target = imagePath(body.target, userId)
      if (source === target || source.split('/')[1] !== target.split('/')[1]) throw new Error('INVALID_IMAGE_UPLOAD')
      const folder = target.split('/')[1]
      if (folder !== 'avatar' && !await store.ownsDesk(folder, userId)) throw new Error('INVALID_IMAGE_UPLOAD')
      const size = await store.imageSize(source)
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_IMAGE_BYTES) throw new Error('INVALID_IMAGE_UPLOAD')
      // コピー元のサイズは並行した差し替えで変わるため、バケットの最大サイズを予算に取る。
      await store.reserve(userId, MAX_IMAGE_BYTES)
      await store.copy(source, target)
    } else {
      if (type !== 'image/jpeg') throw new Error('INVALID_IMAGE_UPLOAD')
      const path = imagePath(request.headers.get('X-Image-Path'), userId)
      const folder = path.split('/')[1]
      if (folder !== 'avatar' && !await store.ownsDesk(folder, userId)) throw new Error('INVALID_IMAGE_UPLOAD')
      const bytes = await readBounded(request, MAX_IMAGE_BYTES)
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('INVALID_IMAGE_UPLOAD')
      await store.reserve(userId, bytes.length)
      await store.upload(path, bytes)
    }
    return Response.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const status = message === 'IMAGE_UPLOAD_RATE_LIMITED' ? 429 : message === 'IMAGE_TOO_LARGE' ? 413
      : message === 'INVALID_IMAGE_UPLOAD' || error instanceof SyntaxError ? 400 : 503
    return Response.json({ error: status === 503 ? 'IMAGE_UPLOAD_UNAVAILABLE' : status === 400 ? 'INVALID_IMAGE_UPLOAD' : message }, { status })
  }
}
