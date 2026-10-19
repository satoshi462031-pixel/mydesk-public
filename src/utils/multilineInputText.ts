// iOS の system font（SF Pro）の行の高さ ÷ 文字サイズ。(ascender 1950 + descender 494) / unitsPerEm 2048 で、
// UIFont.systemFont(ofSize:).lineHeight と一致する（17pt → 20.29）
const IOS_SYSTEM_FONT_LINE_HEIGHT_RATIO = (1950 + 494) / 2048

export interface MultilineInputText {
  fontSize: number
  lineHeight: number
  paddingTop: number
  paddingBottom: number
}

/**
 * 複数行の TextInput に lineHeight を付けるときの、文字の大きさ・行の高さ・上下の内側余白。
 *
 * React Native は iOS の <Text> では lineHeight の余りを字の上下に半分ずつ配って行の中央に置く
 * （RCTTextLayoutManager の RCTApplyBaselineOffset）が、<TextInput> にはこの補正が無い。
 * 余りが全部字の上に付くので、入力した文字も例文（placeholder）も行の下端へ沈む。
 * 沈む量の半分だけ上の余白を下へ回し、<Text> と同じ位置に描く（上下の余白の合計＝欄の高さは変えない）。
 *
 * 1行の欄（TextField）には lineHeight を付けない。UITextField は字の高さで上下中央に置くので補正が要らず、
 * 付けると例文だけが下へずれる。
 */
export function multilineInputText(text: MultilineInputText, platform: string): MultilineInputText {
  if (platform !== 'ios') return text
  const extra = text.lineHeight - text.fontSize * IOS_SYSTEM_FONT_LINE_HEIGHT_RATIO
  if (extra <= 0) return text
  const shift = Math.min(extra / 2, text.paddingTop)
  return {
    ...text,
    paddingTop: text.paddingTop - shift,
    paddingBottom: text.paddingBottom + shift,
  }
}
