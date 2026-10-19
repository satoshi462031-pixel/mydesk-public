// BudouX の解析アルゴリズム（Copyright 2021 Google LLC, Apache-2.0）。
// 日本語モデルだけを使い、DOM と他言語の辞書をアプリに含めない。
import { BUDOUX_JA_MODEL } from '../constants/budouxJaModel.generated'

const baseScore = -0.5 * Object.values(BUDOUX_JA_MODEL)
  .flatMap((group) => Object.values(group)).reduce((sum, score) => sum + score, 0)
const features = [
  ['UW1', -3, -2], ['UW2', -2, -1], ['UW3', -1, 0],
  ['UW4', 0, 1], ['UW5', 1, 2], ['UW6', 2, 3],
  ['BW1', -2, 0], ['BW2', -1, 1], ['BW3', 0, 2],
  ['TW1', -3, 0], ['TW2', -2, 1], ['TW3', -1, 2], ['TW4', 0, 3],
] as const

export function japanesePhrases(text: string): string[] {
  if (!text) return []
  const result: string[] = []
  // 入力した改行を解析の境界にする。隣の行の文字で文節が変わるのを防ぐ。
  for (const part of text.split(/(\r\n|\r|\n)/)) {
    if (!part) continue
    if (/^[\r\n]+$/.test(part)) { result.push(part); continue }
    let start = 0
    for (let i = 1; i < part.length; i++) {
      let score = baseScore
      for (const [group, from, to] of features) {
        score += BUDOUX_JA_MODEL[group]?.[part.substring(i + from, i + to)] ?? 0
      }
      if (score > 0) { result.push(part.slice(start, i)); start = i }
    }
    result.push(part.slice(start))
  }
  return result
}

/** 表示だけに使う。保存する文字列には区切り文字を入れない。 */
export function phraseBreakText(text: string): string {
  return japanesePhrases(text).join('\u200b')
}

/** Native の Text には keep-all が無いので、文節の内部だけ改行を抑える。 */
export function nativePhraseBreakText(text: string): string {
  return japanesePhrases(text).map((phrase) =>
    /^[\r\n]+$/.test(phrase) ? phrase : phrase.replace(/([\p{L}\p{N}\p{P}])(?=[\p{L}\p{N}\p{P}])/gu, '$1\u2060')
  ).join('\u200b')
}
