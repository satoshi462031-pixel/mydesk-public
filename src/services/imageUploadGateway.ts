import { supabase } from '../supabase/client'
import { PUBLISH_TIMEOUT_MS, withTimeout } from '../utils/networkError'

export async function uploadPublicImage(path: string, bytes: Uint8Array): Promise<void> {
  await invokeImageGateway(bytes.slice().buffer, { 'Content-Type': 'image/jpeg', 'X-Image-Path': path })
}

export async function copyPublicImage(source: string, target: string): Promise<void> {
  await invokeImageGateway({ source, target }, { 'Content-Type': 'application/json' })
}

async function invokeImageGateway(body: ArrayBuffer | { source: string; target: string }, headers: Record<string, string>): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS)
  try {
    const { data, error, response } = await withTimeout(supabase.functions.invoke('upload-desk-image', { body, headers, signal: controller.signal }), PUBLISH_TIMEOUT_MS)
    if (error) {
      if (response?.status === 429) throw new Error('IMAGE_UPLOAD_RATE_LIMITED')
      throw error
    }
    if (data?.ok !== true) throw new Error('IMAGE_UPLOAD_UNCONFIRMED')
  } finally { clearTimeout(timeout) }
}
