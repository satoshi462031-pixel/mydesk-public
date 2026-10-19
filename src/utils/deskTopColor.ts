import type { DeskTopColor } from '../types'

/**
 * デスクの天板の色。写真の印象を決めるのに、名前からしか分からなかった。
 * 文字ではなく選ぶだけにする（手入力の欄は書かれず、表記もばらつく）
 */
export const DESK_TOP_COLOR_OPTIONS: readonly { key: DeskTopColor; ja: string; en: string }[] = [
  { key: 'white', ja: 'ホワイト', en: 'White' },
  { key: 'black', ja: 'ブラック', en: 'Black' },
  { key: 'gray', ja: 'グレー', en: 'Gray' },
  { key: 'natural_wood', ja: '木目（明るめ）', en: 'Light wood' },
  { key: 'dark_wood', ja: '木目（濃いめ）', en: 'Dark wood' },
  { key: 'other', ja: 'その他', en: 'Other' },
]

/** 公開データ由来の値も通るので、知らない値は出さない */
export function deskTopColorLabel(value: unknown, lang: 'ja' | 'en'): string | undefined {
  const option = DESK_TOP_COLOR_OPTIONS.find((item) => item.key === value)
  return option ? option[lang] : undefined
}
