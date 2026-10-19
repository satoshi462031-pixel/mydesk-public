// ノードの表示名を、与えられた幅×高さに収まる最大の文字サイズで描くためのユーティリティ。
// 配線図（ConnectionMap）と歴史アニメーション（HistoryWiringCanvas）のノードカードで共用する。

// 文字幅の概算（全角≈fontSize・半角≈0.55×fontSize）で必要行数を見積もる。
// レイアウト計算側（connectionMapLayout.ts の nodeH）が「省略が出ない箱の高さ」を
// 逆算するのにも使うため export する。
export function estimateLines(name: string, availW: number, fontSize: number): number {
  const w0 = Math.max(fontSize, availW)
  let lineW = 0, lines = 1
  for (const ch of name) {
    const cw = /[\x00-\xff]/.test(ch) ? fontSize * 0.55 : fontSize
    if (lineW + cw > w0) { lines++; lineW = cw } else lineW += cw
  }
  return lines
}

// 1行で描くことを優先して文字サイズを決める。
// fitNodeFontSize は「maxLines に収まる最大サイズ」を返すため、1行にわずかに入らない
// ラベル（既定サイズの「コンセント」など）は大きい文字のまま2行に割れてしまう。
// 1行に落とすために縮める量が ratio 以内で済むときだけ1行を採る。
export function fitNodeFontSizePreferOneLine(
  name: string,
  availW: number,
  availH: number,
  maxLines: number,
  minF = 7,
  maxF = 28,
  ratio = 0.75,
): number {
  const wrapped = fitNodeFontSize(name, availW, availH, maxLines, minF, maxF)
  if (maxLines <= 1) return wrapped
  const single = fitNodeFontSize(name, availW, availH, 1, minF, maxF)
  // minF は「収まらなくても返る」フォールバックなので、本当に1行で収まるか確かめる
  if (estimateLines(name, availW * 0.94, single) > 1) return wrapped
  return single >= wrapped * ratio ? single : wrapped
}

// 余白に収まる最大の文字サイズを探す（幅×最大行数・高さの両方に収まり「…」を出さない）
export function fitNodeFontSize(
  name: string,
  availW: number,
  availH: number,
  maxLines: number,
  minF = 7,
  maxF = 28,
): number {
  for (let f = maxF; f >= minF; f--) {
    const lines = estimateLines(name, availW * 0.94, f)   // 描画誤差ぶんの安全余白
    if (lines <= maxLines && lines * (f + 2) <= availH) return f
  }
  return minF
}
