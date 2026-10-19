import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { handleImageUpload, type ImageUploadStore } from './handler.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-image-path',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

Deno.serve(async (request) => {
  const reply = (response: Response) => {
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(CORS)) headers.set(name, value)
    return new Response(response.body, { status: response.status, headers })
  }
  if (request.method === 'OPTIONS') return reply(new Response(null, { status: 204 }))
  if (request.method !== 'POST') return reply(new Response(null, { status: 405 }))
  const authorization = request.headers.get('Authorization') ?? ''
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(new Response(null, { status: 401 }))
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const transport: typeof fetch = (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  try {
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization }, fetch: transport } })
    const { data: identity, error: authError } = await client.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
    if (authError || !identity.user) return reply(new Response(null, { status: 401 }))
    const { error: accessError } = await client.rpc('check_account_access')
    if (accessError) return reply(new Response(null, { status: accessError.code === 'PT401' ? 401 : 503 }))
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport } })
    const bucket = admin.storage.from('desk-images')
    const store: ImageUploadStore = {
      async ownsDesk(deskId, userId) {
        const { data, error } = await admin.from('desks').select('id').eq('id', deskId).eq('user_id', userId).maybeSingle()
        if (error) throw error
        return !!data
      },
      async reserve(userId, bytes) {
        const { error } = await admin.rpc('reserve_image_upload', { p_user_id: userId, p_bytes: bytes })
        if (error) throw new Error(error.message === 'IMAGE_UPLOAD_RATE_LIMITED' ? error.message : 'IMAGE_UPLOAD_UNAVAILABLE')
      },
      async upload(path, bytes) {
        const { error } = await bucket.upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '60', upsert: false })
        if (error) throw error
      },
      async copy(source, target) { const { error } = await bucket.copy(source, target); if (error) throw error },
      async imageSize(source) {
        const { data, error } = await bucket.info(source)
        if (error) throw error
        return data.size ?? 0
      },
    }
    return reply(await handleImageUpload(request, identity.user.id, store))
  } catch { return reply(Response.json({ error: 'IMAGE_UPLOAD_UNAVAILABLE' }, { status: 503 })) }
})
