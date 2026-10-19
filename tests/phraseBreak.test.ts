import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadDefaultJapaneseParser } from 'budoux'
import { japanesePhrases, nativePhraseBreakText, phraseBreakText } from '../src/utils/phraseBreak'

const parser = loadDefaultJapaneseParser()
const samples = [
  '', '今日は天気です。', '作業環境を整えました。映像がどう変わるか、どのガジェットも試したい。',
  'MacBook ProとUSB-Cモニターを1本でつなぐ。', '机に👩‍💻と🎧を置く。',
  '<script>alert("test")</script>', '長い文章でも文字を消さずに読める。'.repeat(50),
]

test('組み込んだ日本語解析が公式BudouXと一致する', () => {
  for (const text of samples) assert.deepEqual(japanesePhrases(text), parser.parse(text))
})

test('入力した改行・空行・英数字・絵文字を表示処理で失わない', () => {
  const text = '作業環境を整える。\n\nMacBook Pro 👩‍💻\r\n映像がどう変わるか。'
  assert.equal(japanesePhrases(text).join(''), text)
  assert.equal(phraseBreakText(text).replaceAll('\u200b', ''), text)
  assert.equal(nativePhraseBreakText(text).replace(/[\u200b\u2060]/g, ''), text)
  for (const emoji of ['🎧', '👩‍💻', '🇯🇵', '👍🏽', '❤️']) assert.equal(nativePhraseBreakText(emoji), emoji)
})

test('作業環境の語中に文節境界を入れない', () => {
  const text = phraseBreakText('作業環境を整えました。')
  assert.ok(text.includes('作業環境'))
})
