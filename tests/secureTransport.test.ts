import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertResponseOrigin, secureHttpUrl, SecureTransportError } from '../src/utils/secureTransport'

test('production API endpoints require HTTPS and contain no userinfo or fragment', () => {
  assert.equal(secureHttpUrl('https://project.supabase.co').origin, 'https://project.supabase.co')
  for (const url of ['http://project.supabase.co', 'http://localhost:54321', 'https://user:secret@example.com',
    'https://example.com/#token', 'file:///data', 'not-a-url']) {
    assert.throws(() => secureHttpUrl(url), SecureTransportError)
  }
})

test('development HTTP exceptions are limited to loopback hosts', () => {
  for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
    assert.equal(secureHttpUrl(url, true).protocol, 'http:')
  }
  for (const url of ['http://192.0.2.1', 'http://localhost.attacker.invalid', 'http://example.com']) {
    assert.throws(() => secureHttpUrl(url, true), SecureTransportError)
  }
})

test('responses from another origin or a downgraded connection are rejected', () => {
  const response = (url: string) => Object.defineProperty(new Response('{}'), 'url', { value: url })
  assert.doesNotThrow(() => assertResponseOrigin(response('https://api.example.com/rest/v1/desks'), 'https://api.example.com'))
  for (const url of ['https://other.example.com/rest/v1/desks', 'http://api.example.com/rest/v1/desks', 'https://api.example.com:444/rest/v1/desks']) {
    assert.throws(() => assertResponseOrigin(response(url), 'https://api.example.com'), SecureTransportError)
  }
})
