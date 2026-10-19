import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPublicApiFetch } from '../src/utils/publicApiFetch'

test('anonymous database requests use the gateway without sending credentials; authenticated and Auth calls stay at Supabase', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const transport: typeof fetch = async (input, init) => { calls.push({ url: input instanceof Request ? input.url : String(input), init }); return Response.json([]) }
  const fetcher = createPublicApiFetch(transport, 'https://db.invalid', 'anon', 'https://mydesk.page')
  await fetcher('https://db.invalid/rest/v1/desks?select=id', { headers: { Authorization: 'Bearer anon', apikey: 'anon', 'X-Client-Info': 'sdk' } })
  assert.equal(calls[0].url, 'https://mydesk.page/api/public/rest/v1/desks?select=id')
  assert.equal(new Headers(calls[0].init?.headers).get('Authorization'), null)
  assert.equal(new Headers(calls[0].init?.headers).get('X-Client-Info'), null)
  await fetcher('https://db.invalid/rest/v1/desks', { headers: { Authorization: 'Bearer signed-in' } })
  await fetcher('https://db.invalid/auth/v1/token', { method: 'POST' })
  assert.equal(calls[1].url, 'https://db.invalid/rest/v1/desks')
  assert.equal(calls[2].url, 'https://db.invalid/auth/v1/token')
})
