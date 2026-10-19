import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateRequestBody, validRequestId, type ApiMessage } from '../supabase/functions/ai-coach/validation'
import { reserveUsage, usageWithoutKinds, type UsageRow } from '../supabase/functions/ai-coach/usage'
import { findAISafetyIssue } from '../supabase/functions/ai-coach/safety'
import { actualTokenCount, inputTokenCount } from '../supabase/functions/ai-coach/tokenBudget'

const usage = (overrides: Partial<UsageRow> = {}): UsageRow => ({
  allowed: true,
  msg_count: 1,
  photo_count: 0,
  msg_limit: 30,
  photo_limit: 5,
  ...overrides,
})

describe('AI Edge request validation', () => {
  it('requires a UUID v4 request id', () => {
    assert.equal(validRequestId('7d9ac4ae-92f4-4cf8-87d1-020d93c2c254'), true)
    assert.equal(validRequestId('not-a-request-id'), false)
  })

  it('rejects images in assistant messages', () => {
    const messages: ApiMessage[] = [
      { role: 'user', content: 'start' },
      { role: 'assistant', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/' } }] },
      { role: 'user', content: 'end' },
    ]
    assert.match(validateRequestBody(messages) ?? '', /userメッセージ/)
  })

  it('rejects a mismatched or malformed image payload', () => {
    const messages: ApiMessage[] = [{
      role: 'user',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '/9j/' } }],
    }]
    assert.equal(validateRequestBody(messages), '画像データが不正です')
  })

  it('accepts a matching image signature in a user message', () => {
    const messages: ApiMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: '画像を分析してください' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/AAAA' } },
      ],
    }]
    assert.equal(validateRequestBody(messages), null)
  })
})

describe('AI usage reservation', () => {
  it('rejects a zero service allowance before any generation can start', async () => {
    const consumed: string[] = []
    const result = await reserveUsage(
      false,
      async (kind) => {
        consumed.push(kind)
        return usage({ allowed: false, msg_count: 0, msg_limit: 0, photo_limit: 0 })
      },
      async () => {},
    )
    assert.equal(result.allowed, false)
    assert.deepEqual(consumed, ['msg'])
    assert.equal(result.usage.msg_limit, 0)
  })

  it('consumes photo then message for an image request', async () => {
    const consumed: string[] = []
    const result = await reserveUsage(
      true,
      async (kind) => { consumed.push(kind); return usage({ photo_count: kind === 'photo' ? 1 : 1 }) },
      async () => {},
    )
    assert.equal(result.allowed, true)
    assert.deepEqual(consumed, ['photo', 'msg'])
  })

  it('refunds the photo slot when the message limit is reached', async () => {
    const refunded: string[] = []
    const result = await reserveUsage(
      true,
      async (kind) => kind === 'photo'
        ? usage({ photo_count: 1 })
        : usage({ allowed: false, msg_count: 30, photo_count: 1 }),
      async (kind) => { refunded.push(kind) },
    )
    assert.equal(result.allowed, false)
    assert.deepEqual(refunded, ['photo'])
    assert.equal(result.usage.photo_count, 0)
  })

  it('refunds reserved usage when consumption fails midway', async () => {
    const refunded: string[] = []
    await assert.rejects(() => reserveUsage(
      true,
      async (kind) => {
        if (kind === 'msg') throw new Error('database unavailable')
        return usage({ photo_count: 1 })
      },
      async (kind) => { refunded.push(kind) },
    ))
    assert.deepEqual(refunded, ['photo'])
  })

  it('subtracts only the refunded kinds from the returned counts', () => {
    const row = usage({ msg_count: 5, photo_count: 2 })
    assert.deepEqual(
      [usageWithoutKinds(row, ['photo', 'msg']).msg_count, usageWithoutKinds(row, ['photo', 'msg']).photo_count],
      [4, 1],
    )
    assert.equal(usageWithoutKinds(row, ['msg']).photo_count, 2)
    assert.equal(usageWithoutKinds(usage({ msg_count: 0 }), ['msg']).msg_count, 0)
  })
})

describe('AI response safety filter', () => {
  it('blocks explicit credential requests and electrical safety bypasses', () => {
    assert.equal(findAISafetyIssue('確認のためパスワードを送ってください。'), 'credential_request')
    assert.equal(findAISafetyIssue('ヒューズをバイパスしてください。'), 'electrical_bypass')
  })

  it('does not block ordinary safety warnings', () => {
    assert.equal(findAISafetyIssue('ヒューズはバイパスせず、メーカー仕様を確認してください。'), null)
  })

  // デスク環境の相談で普通に出る文。一致すると回答全体が差し替わるので、ここで止めてはいけない
  it('does not block setup instructions for the user’s own devices', () => {
    assert.equal(findAISafetyIssue('ルーターの管理画面を開き、Wi-Fi のパスワードを入力してください。'), null)
    assert.equal(findAISafetyIssue('Open the router settings and enter the Wi-Fi password printed on the label.'), null)
  })

  it('does not block English warnings that tell the user not to bypass safety', () => {
    assert.equal(findAISafetyIssue('Do not remove the ground pin from the plug.'), null)
    assert.equal(findAISafetyIssue('Never bypass the fuse; check the manufacturer specs instead.'), null)
  })

  it('does not treat audio ground loop advice as a safety bypass', () => {
    assert.equal(findAISafetyIssue('To remove ground loop hum, add a ground loop isolator between the PC and the speakers.'), null)
  })

  it('still blocks requests to share credentials in the chat and English bypass instructions', () => {
    assert.equal(findAISafetyIssue('このチャットにパスワードを入力してください。'), 'credential_request')
    assert.equal(findAISafetyIssue('Please send me your password so I can check the account.'), 'credential_request')
    assert.equal(findAISafetyIssue('Remove the ground pin so the plug fits the outlet.'), 'electrical_bypass')
    assert.equal(findAISafetyIssue('Bypass the fuse to get more power.'), 'electrical_bypass')
    assert.equal(findAISafetyIssue('Do not remove the fuse, remove the ground pin instead.'), 'electrical_bypass')
  })
})

describe('AI token budget accounting', () => {
  it('counts input, output, and cache token fields', () => {
    assert.equal(actualTokenCount({
      input_tokens: 120,
      output_tokens: 30,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 10,
    }), 180)
  })

  it('rejects malformed provider usage', () => {
    assert.equal(actualTokenCount({ input_tokens: 10 }), null)
    assert.equal(actualTokenCount({ input_tokens: -1, output_tokens: 2 }), null)
    assert.equal(inputTokenCount({ input_tokens: 42 }), 42)
    assert.equal(inputTokenCount({ input_tokens: 1.5 }), null)
  })
})
