import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  estimateOutputTokens,
  isFinalUsageEvent,
  mergeStreamUsage,
  ndjson,
  safetyScanTail,
  splitSseData,
  streamErrorType,
  streamStopReason,
  streamTextDelta,
  streamUsage,
  type StreamEvent,
} from '../supabase/functions/ai-coach/stream'
import { findAISafetyIssue } from '../supabase/functions/ai-coach/safety'
import { splitStreamEvents } from '../src/services/ai/streamEvents'

/** Anthropic が返す SSE を、実際に来る順序で組み立てる */
function anthropicSse(chunks: string[], stopReason = 'end_turn'): string {
  const lines = [
    'event: message_start',
    `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1200, output_tokens: 1 } } })}`,
    '',
    'event: content_block_start',
    `data: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}`,
    '',
  ]
  for (const text of chunks) {
    lines.push('event: content_block_delta')
    lines.push(`data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}`)
    lines.push('')
  }
  lines.push('event: message_delta')
  lines.push(`data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 430 } })}`)
  lines.push('')
  lines.push('event: message_stop')
  lines.push(`data: ${JSON.stringify({ type: 'message_stop' })}`)
  lines.push('')
  return lines.join('\n')
}

/** 受信を任意の位置で切りながら読む。実際の受信はこの切れ目が行の途中に来る */
function readSse(sse: string, cut: number) {
  let buffer = ''
  let text = ''
  let usage = {}
  let stopReason: string | null = null
  for (let i = 0; i < sse.length; i += cut) {
    buffer += sse.slice(i, i + cut)
    const { data, rest } = splitSseData(buffer)
    buffer = rest
    for (const raw of data) {
      const event = JSON.parse(raw)
      const delta = streamTextDelta(event)
      if (delta) text += delta
      usage = mergeStreamUsage(usage, streamUsage(event))
      stopReason = streamStopReason(event) ?? stopReason
    }
  }
  return { text, usage, stopReason }
}

describe('AI streaming: 上流の SSE を読む', () => {
  it('行の途中で切れても本文が欠けない', () => {
    const sse = anthropicSse(['デスクの', '配線は', '**整っています**'])
    for (const cut of [1, 3, 7, 17, 64, 4096]) {
      assert.equal(readSse(sse, cut).text, 'デスクの配線は**整っています**', `cut=${cut}`)
    }
  })

  it('入力ぶんと出力ぶんを合わせて数える', () => {
    const { usage, stopReason } = readSse(anthropicSse(['a', 'b']), 5)
    // message_start の output_tokens は途中経過（1）。message_delta の確定値で上書きされる
    assert.deepEqual(usage, { input_tokens: 1200, output_tokens: 430 })
    assert.equal(stopReason, 'end_turn')
  })

  it('確定値が乗るのは message_delta だけ', () => {
    assert.equal(isFinalUsageEvent({ type: 'message_delta', usage: { output_tokens: 10 } }), true)
    assert.equal(isFinalUsageEvent({ type: 'message_start', message: { usage: { input_tokens: 5 } } }), false)
  })

  it('data 以外の行と空行は読み飛ばす', () => {
    const { data, rest } = splitSseData('event: ping\r\n\r\ndata: {"type":"ping"}\r\ndata: {"type":"par')
    assert.deepEqual(data, ['{"type":"ping"}'])
    assert.equal(rest, 'data: {"type":"par')
  })

  it('text 以外のブロックは本文に混ぜない', () => {
    assert.equal(streamTextDelta({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'あ' } }), null)
    assert.equal(streamTextDelta({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'あ' } }), 'あ')
  })

  it('上流が途中で転んだことを見分ける', () => {
    assert.equal(streamErrorType({ type: 'error', error: { type: 'overloaded_error' } }), 'overloaded_error')
    assert.equal(streamErrorType({ type: 'content_block_delta' }), null)
  })

  it('小さい値で確定値を潰さない', () => {
    const merged = mergeStreamUsage({ output_tokens: 430 }, { output_tokens: 1 })
    assert.equal(merged.output_tokens, 430)
    // 壊れた値は捨てる（負の数を通すと精算が実際より軽くなる）
    assert.deepEqual(mergeStreamUsage({ input_tokens: 10 }, { input_tokens: -5 }), { input_tokens: 10 })
  })

  it('途中で止めたときの出力ぶんは予約を超えない', () => {
    assert.equal(estimateOutputTokens('あいうえお', 2000), 3)
    assert.equal(estimateOutputTokens('あ'.repeat(100_000), 2000), 2000)
  })
})

describe('AI streaming: 流しながらの安全性の検査', () => {
  it('末尾だけ見ても、出来上がった一致を取り逃さない', () => {
    const head = 'デスク環境の改善案です。'.repeat(200)
    const content = `${head}パスワードを教えてください`
    assert.equal(findAISafetyIssue(safetyScanTail(content)), 'credential_request')
    assert.ok(safetyScanTail(content).length <= 1024)
  })

  it('短い本文はそのまま渡す', () => {
    assert.equal(safetyScanTail('配線を整えましょう'), '配線を整えましょう')
  })
})

describe('AI streaming: アプリ側で読む', () => {
  const encode = (events: StreamEvent[]) => events.map(ndjson).join('')

  it('サーバーが書いた形をそのまま読める', () => {
    const { events, rest } = splitStreamEvents(encode([
      { type: 'delta', text: 'こんにちは' },
      { type: 'done', usage: { msg_count: 3 }, safety_filtered: false },
    ]))
    assert.equal(rest, '')
    assert.deepEqual(events[0], { type: 'delta', text: 'こんにちは' })
    assert.deepEqual(events[1], { type: 'done', usage: { msg_count: 3 }, safety_filtered: false })
  })

  it('行の途中で切れたぶんは次に持ち越す', () => {
    const payload = encode([{ type: 'delta', text: '配線の見直し' }, { type: 'delta', text: 'から始めます' }])
    let buffer = ''
    let text = ''
    for (let i = 0; i < payload.length; i += 5) {
      buffer += payload.slice(i, i + 5)
      const { events, rest } = splitStreamEvents(buffer)
      buffer = rest
      for (const event of events) if (event.type === 'delta') text += event.text
    }
    assert.equal(text, '配線の見直しから始めます')
  })

  it('壊れた行は失敗として扱い、完了通知まで読み飛ばさない', () => {
    const { events } = splitStreamEvents('{"type":"delta"\n{"type":"ping"}\n{"type":"delta","text":"続き"}\n')
    assert.deepEqual(events, [{ type: 'error', error: 'INVALID_AI_STREAM', status: 502 }])
  })

  it('未知のイベントは互換性のため読み飛ばし、正常な本文は維持する', () => {
    const { events } = splitStreamEvents('{"type":"ping"}\n{"type":"delta","text":"続き"}\n')
    assert.deepEqual(events, [{ type: 'delta', text: '続き' }])
  })

  it('差し替えと失敗を見分ける', () => {
    const { events } = splitStreamEvents(encode([
      { type: 'replace', text: '安全上の理由により…' },
      { type: 'error', error: 'AI利用量の記録に失敗しました', status: 500 },
    ]))
    assert.deepEqual(events, [
      { type: 'replace', text: '安全上の理由により…' },
      { type: 'error', error: 'AI利用量の記録に失敗しました', status: 500 },
    ])
  })

  it('本文の改行で行が割れない', () => {
    const text = '1行目\n2行目\n\n- 箇条書き'
    const { events } = splitStreamEvents(encode([{ type: 'delta', text }]))
    assert.deepEqual(events, [{ type: 'delta', text }])
  })
})
