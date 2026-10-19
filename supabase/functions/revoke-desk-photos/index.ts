import { createClient } from 'npm:@supabase/supabase-js@2.108.2'
import { processPhotoRevocation, type RevocationJob, type RevocationStore } from './process.ts'

async function authorized(request: Request): Promise<boolean> {
  const expected = Deno.env.get('PHOTO_REVOCATION_SECRET') ?? ''
  if (expected.length < 32) return false
  const encoder = new TextEncoder()
  const values = await Promise.all([expected, request.headers.get('X-Photo-Revocation-Secret') ?? ''].map(
    (value) => crypto.subtle.digest('SHA-256', encoder.encode(value)),
  ))
  const a = new Uint8Array(values[0]), b = new Uint8Array(values[1])
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index]
  return difference === 0
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  if (!await authorized(request)) return new Response(null, { status: 403 })
  const url = Deno.env.get('SUPABASE_URL')!, key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) }) },
  })
  const bucket = admin.storage.from('desk-images')
  const store: RevocationStore = {
    async list(folder, search) {
      const { data, error } = await bucket.list(folder, { search, limit: 100 })
      if (error) throw error
      return (data ?? []).map((file) => file.name)
    },
    async copy(source, target) { const { error } = await bucket.copy(source, target); if (error) throw error },
    async remove(paths) { const { error } = await bucket.remove(paths); if (error) throw error },
    async commit(job, copyReady) {
      const { data, error } = await admin.rpc('commit_photo_revocation', {
        p_job_id: job.id, p_lease_token: job.lease_token, p_copy_ready: copyReady,
      })
      if (error) throw error
      return data === true
    },
    async finish(job) {
      const { error } = await admin.rpc('finish_photo_revocation', { p_job_id: job.id, p_lease_token: job.lease_token })
      if (error) throw error
    },
  }
  const { data, error } = await admin.rpc('claim_photo_revocations', { p_limit: 10 })
  if (error) return Response.json({ error: 'claim_failed' }, { status: 500 })
  let completed = 0, failed = 0
  for (const job of (data ?? []) as RevocationJob[]) {
    try { await processPhotoRevocation(store, job, url); completed++ }
    catch { failed++; console.error(JSON.stringify({ at: 'photo_revocation', jobId: job.id })) }
  }
  return Response.json({ completed, failed }, { status: failed ? 503 : 200, headers: { 'Cache-Control': 'no-store' } })
})
