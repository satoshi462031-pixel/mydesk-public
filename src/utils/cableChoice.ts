import { CableChoice } from '../types'

/**
 * つなぎ方の表示名。未設定は undefined を返す。
 *
 * 「未設定＝本体付属」と読み替えない。既定で付属と書くと、家にあった別の1本を
 * 使っている人のデスクにも「付属」と出て公開される（types/index.ts の CableChoice）。
 */
export function cableChoiceLabel(choice: CableChoice | undefined, lang: 'ja' | 'en'): string | undefined {
  if (!choice) return undefined
  if (choice.kind === 'included') return lang === 'en' ? 'Included cable' : '本体付属'
  return choice.name.trim() || undefined
}
