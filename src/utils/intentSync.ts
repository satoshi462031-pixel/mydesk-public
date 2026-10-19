// 押すたびに反転するボタン（いいね・保存・フォロー）の通信を、相手ごとに1本ずつ流す。
//
// 画面は押した瞬間に反転し、通信は「最後に望まれた状態」だけを追いかける。
// 以前は画面ごとに2通りの書き方が混ざっていて、どちらも連打で壊れた：
// ・通信中のタップを捨てる … 返りより前の2回目だけが消え、同じ「2回タップ」でも
//   回線の速さで結果が変わった
// ・ガード無しで毎回送る … 「付ける」「外す」が同時に飛び、届く順が入れ替わると
//   画面とサーバーが逆のまま残った
// send は「その状態にする」（何度送っても同じ結果）であること。反転を送ると、
// 画面が先行している間に意味が変わる。

type Entry = { confirmed: boolean; desired: boolean; running: boolean }

export interface IntentSyncHandlers<K> {
  /** その状態にする。すでにそうなっていても成功で返す */
  send: (key: K, value: boolean) => Promise<void>
  /** サーバーがその状態になった */
  onConfirmed?: (key: K, value: boolean) => void
  /** 連打で変わった最後の状態まで送り終えた。通信中の中間値を読み直さないために使う */
  onSettled?: (key: K, value: boolean) => void
  /** 送れなかった。value はサーバーの状態で、画面をそこへ戻す */
  onFailed: (key: K, value: boolean) => void
}

export interface IntentSync<K> {
  /**
   * 利用者が current から next へ切り替えた。
   * current をサーバーの状態として採るのは通信していない間だけ（通信中は画面が先行している）
   */
  request: (key: K, current: boolean, next: boolean) => void
  /** 通信中か。一覧の読み込みが、押す前の古い値で画面を上書きしないために使う */
  isBusy: (key: K) => boolean
}

export function createIntentSync<K>(handlers: IntentSyncHandlers<K>): IntentSync<K> {
  const entries = new Map<K, Entry>()

  const drain = async (key: K, entry: Entry) => {
    entry.running = true
    while (entry.desired !== entry.confirmed) {
      const value = entry.desired
      try {
        await handlers.send(key, value)
      } catch {
        entry.desired = entry.confirmed
        entry.running = false
        handlers.onFailed(key, entry.confirmed)
        return
      }
      entry.confirmed = value
      handlers.onConfirmed?.(key, value)
    }
    entry.running = false
    handlers.onSettled?.(key, entry.confirmed)
  }

  return {
    request(key, current, next) {
      const entry = entries.get(key)
      if (entry?.running) {
        entry.desired = next
        return
      }
      const fresh: Entry = { confirmed: current, desired: next, running: false }
      entries.set(key, fresh)
      void drain(key, fresh)
    },
    isBusy(key) {
      return entries.get(key)?.running ?? false
    },
  }
}
