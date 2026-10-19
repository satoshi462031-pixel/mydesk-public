import type { PlanPurpose } from '../types'
import { categoryIconColor, themeIconColor, themeTintBase } from './colors'
import { normalizeCustomCategoryColor } from '../utils/customCategory'

export const PURPOSE_COLORS: Record<PlanPurpose, string> = {
  gaming:    '#7B68EE',
  work:      '#3498DB',
  dev:       '#14B8A6',
  creative:  '#E67E22',
  streaming: '#E74C3C',
  study:     '#27AE60',
  music:     '#9B59B6',
  other:     '#7F8C8D',
}

/**
 * 目的の色を引く。共有デスクの purposes は Supabase の値を検証せず PlanPurpose[] へ
 * キャストしているだけなので、新しいバージョンで公開されたデスクを開くと未知のキーが来うる。
 * その場合 PURPOSE_COLORS[p] が undefined になり、"undefined22" のような無効な色文字列に
 * なってバッジが描画されなくなるため、必ずこの関数経由で引く。
 */
export function purposeColor(purpose: PlanPurpose, otherColor?: string): string {
  if (purpose === 'other') return normalizeCustomCategoryColor(otherColor) ?? PURPOSE_COLORS.other
  return PURPOSE_COLORS[purpose] ?? PURPOSE_COLORS.other
}

/**
 * 用途色を「アイコン・枠線として描く色」に補正して引く。
 *
 * 生の PURPOSE_COLORS はライトの面の上で dev 2.49 / creative 2.85 / study 2.87 しかなく、
 * 意味を持つ非テキストUI の 3:1 に届かない。カテゴリ色と同じ themeIconColor に通して、
 * 足りない色だけ届く最小量だけ動かす（色相は保つので用途の見分けは変わらない）。
 * **文字色には使わない。** 4.5:1 には届かないので、ラベルは text / textMuted で書く。
 */
export function purposeIconColor(purpose: PlanPurpose, isDark: boolean, otherColor?: string): string {
  if (purpose === 'other' && normalizeCustomCategoryColor(otherColor)) {
    return categoryIconColor('Other', isDark, PURPOSE_COLORS.other, otherColor)
  }
  return themeIconColor(purposeColor(purpose), isDark)
}

/**
 * 用途のチップ・タイルの地と枠に敷く色のもと。ライトは補正前の色を使う。
 * 補正後の色（暗い色）を薄く敷くと、地まで茶色っぽくくすんで「ライトだけ暗い」と見える。
 * 補正前のほうが明るいので、その上の絵（purposeIconColor）のコントラストはむしろ上がる。
 * ダークは補正後の色（明るく持ち上げた色）で今のまま。
 */
export function purposeTintColor(purpose: PlanPurpose, isDark: boolean, otherColor?: string): string {
  if (purpose === 'other' && normalizeCustomCategoryColor(otherColor)) return purposeColor(purpose, otherColor)
  return themeTintBase(purposeColor(purpose), isDark)
}
