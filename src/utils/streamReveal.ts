// 届いた回答を一定の速さで画面に出すための歩幅。通信は塊で届くので、届いたまま出すと
// 数十文字が一度に現れては止まる、を繰り返してカクつく（有名なAIアプリは一定の速さで流す）。
// 残りが多いほど歩幅を広げ、表示が通信より遅れ続けないようにする。
// 受信が終わったら、待たせないよう残りを短時間で出し切る
export function nextRevealLength(shown: number, target: string, finished: boolean): number {
  if (shown >= target.length) return target.length
  const backlog = target.length - shown
  const step = finished
    ? Math.max(12, Math.ceil(backlog / 4))
    : Math.max(2, Math.ceil(backlog / 10))
  let next = Math.min(target.length, shown + step)
  // サロゲートペアの間で切ると、絵文字が化けた字として一瞬出る
  const code = target.charCodeAt(next - 1)
  if (next < target.length && code >= 0xd800 && code <= 0xdbff) next++
  return next
}
