// 前面で JS 駆動のアニメーション（デスクの歴史の再生）を見せている間、裏の配線図計算を止める。
//
// 計算は 12ms ごとに制御を返すが、16ms のフレームのうち残りの数 ms で再生の更新
// （SVG の線の伸び・フェーズ境界の再レンダー）が収まらないとフレームが落ちる。
// 再生中は InteractionManager の「操作中」にもならない（進捗バーはネイティブ駆動、
// 再生のクロックは rAF）ので、起動時のウォームアップや画面の先読みは待たずに走り続けていた。
// 止めるのは計算の区切りなので、開始済みの計算も次の区切りで止まり、解除後に同じ続きから再開する。
let holds = 0
let waiters: Array<() => void> = []

/** 止める。戻り値の関数で解除する（複数の利用者が重ねて止めてよい） */
export function holdBackgroundLayout(): () => void {
  holds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    if (holds > 0) return
    const resume = waiters
    waiters = []
    resume.forEach((resolve) => resolve())
  }
}

/** 止められていればその解除まで待つ Promise、止められていなければ undefined */
export function whenLayoutAllowed(): Promise<void> | undefined {
  if (holds === 0) return undefined
  return new Promise((resolve) => { waiters.push(resolve) })
}
