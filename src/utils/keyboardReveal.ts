// 押した入力欄をキーボードの上へ出すスクロール量の判定（hooks/useKeyboardReveal）。
// React Native には依存させない（tests/keyboardReveal.test.ts が node で直接確かめる）。

export interface RevealInput {
  /** 入力欄の画面上の上端・高さ */
  fieldY: number
  fieldHeight: number
  /** スクロール領域の画面上の上端・高さ */
  scrollY: number
  scrollHeight: number
  /** キーボードの上端（画面座標） */
  keyboardY: number
  /** スクロール領域の下端に重なっている物の高さ（絶対配置の下部バーなど） */
  bottomInset: number
  /** 欄の上下に空けておく余白 */
  margin: number
}

/**
 * 今のスクロール位置から足す量。動かさなくてよいときは 0。
 *
 * RN の scrollResponderScrollNativeHandleToKeyboard はスクロール領域の上端が画面の上端にある前提で
 * 計算し、見えている欄でも必ず動かす。ヘッダーの下にある画面では足りずに隠れたままになり、
 * 見えている欄を押しても一覧が跳ねる。隠れているときだけ、隠れている分だけ送る
 */
export function keyboardRevealDelta(i: RevealInput): number {
  const visibleTop = i.scrollY
  const visibleBottom = Math.min(i.keyboardY, i.scrollY + i.scrollHeight) - i.bottomInset
  const fieldTop = i.fieldY - i.margin
  const fieldBottom = i.fieldY + i.fieldHeight + i.margin
  if (fieldBottom <= visibleBottom) return 0
  // 見える高さより背の高い欄（複数行の説明欄）は、下端に合わせると書き出しの行が上へ消える。上端を優先する
  const byBottom = fieldBottom - visibleBottom
  const byTop = fieldTop - visibleTop
  return Math.max(0, Math.min(byBottom, byTop))
}
