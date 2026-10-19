import { ComponentType, createElement } from 'react'
import type { TextProps } from 'react-native'

// react-native の Text の差し替え（metro.config.js が、RN 本体の Text を読みに来た要求をここへ回す）。
//
// iOS の「テキストサイズ」を大きくしている人の端末では、文字だけが拡大されて、数値で決めた
// 高さ・幅（1行ぶんに固定した説明文、幅の決まったボタン）は拡大されず、文字が切れていた。
// 上限を全体にかける。1.2 は「大きめ」の段（×1.118 / ×1.235）までをほぼそのまま通す値。
//
// 画面ごとに maxFontSizeMultiplier を書くと必ず漏れ、React 19 は関数コンポーネントの
// defaultProps を読まない。新アーキテクチャでは倍率がネイティブの対応表で決まるので、
// JS から倍率そのものを差し替える口も無い。
// 呼び出し側が maxFontSizeMultiplier を渡したときはそちらが勝つ。
export const MAX_FONT_SIZE_MULTIPLIER = 1.2

// 'react-native' から読むと、このファイル自身へ回されて自分を包むことになる。本体は直接読む
const RNText: ComponentType<TextProps> = require('react-native/Libraries/Text/Text').default

function Text(props: TextProps) {
  return createElement(RNText, { maxFontSizeMultiplier: MAX_FONT_SIZE_MULTIPLIER, ...props })
}
Text.displayName = 'Text'

export default Text
