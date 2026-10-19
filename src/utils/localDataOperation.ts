// 復元とログアウトの消去が並ぶと、消した後へ復元の書き込みが戻る。
// 書き込みは直列にし、消去を始めた時点で待機中の復元も無効にする。
let generation = 0
let queue: Promise<void> = Promise.resolve()

export function invalidateLocalDataOperations(): void {
  generation += 1
}

export function serializeLocalDataOperation<T>(
  task: (isCurrent: () => boolean) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const startedGeneration = generation
  const isCurrent = () => startedGeneration === generation && !signal?.aborted
  const run = queue.catch(() => {}).then(() => task(isCurrent))
  queue = run.then(() => undefined, () => undefined)
  return run
}
