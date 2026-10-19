import { useCallback, useEffect, useRef, useState } from 'react'
import { TimelineEvent } from '../utils/deskTimeline'

export type PlaybackSpeed = number
export const MIN_PLAYBACK_SPEED = 0.25
// 日ごと表示の長い歴史では2倍でも数分かかるため、上限は3倍を維持する。
export const MAX_PLAYBACK_SPEED = 3
export const PLAYBACK_SPEED_STEP = 0.05
export const PLAYBACK_SPEEDS: PlaybackSpeed[] = [0.25, 1, 1.25, 1.5, 2]

export const isPlaybackSpeed = (v: unknown): v is PlaybackSpeed =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_PLAYBACK_SPEED && v <= MAX_PLAYBACK_SPEED

// ×1 時の 1 イベントの表示尺。速度倍率で割って実尺を出す。
// 基準は「従来の 1.25 倍速」の速さ（旧 6666ms / 1.25）。
/** ×1 時の 1 イベントの表示尺。シークバーを連続的に進めるため呼び出し側にも公開する */
export const EVENT_MS = 5333

/**
 * 配線図の登場・描画アニメーションの尺（×1時）。
 * イベント尺との差（1秒）が「配線し終わった全体を眺める時間」になる。
 * IN/OUT が複数ページに分かれても、配線の演出はこの尺のまま一気に流す
 * （ページ送りはイベントの滞在時間だけを延ばす → extraHoldMs）。
 */
export const EVENT_ANIM_MS = EVENT_MS - 1000

/** IN/OUT が多くて複数ページに分かれるときの、2ページ目以降1枚あたりの表示尺（×1時） */
export const PAGE_MS = 1440

// 配線の新設・撤去もガジェットの移動も無い日（配線を持たない置物を足しただけの日など）の尺。
// この日の演出は「ガジェットがフェードインする」だけで正規化時間 0.2 あたりで終わるため、
// 通常尺のままだと残り8割が何も起きない待ち時間になる。尺そのものを詰めて次の日へ送る。
/** 静かな日の1イベントの表示尺（×1時） */
export const QUIET_EVENT_MS = 2200
/** 静かな日の演出尺（×1時）。EVENT_MS/EVENT_ANIM_MS と同じく差が「眺める時間」 */
export const QUIET_EVENT_ANIM_MS = QUIET_EVENT_MS - 1000

/**
 * 1イベントの滞在時間（×1時, ms）。extraHold はページ送りぶんの延長・静かな日の短縮。
 * 静かな日は負の hold で短縮されるので、下限を設けて日送りが暴走しないようにする。
 * 再生バーの位置を「その日の何割まで進んだか」に読み替えるときにも同じ尺を使う
 */
export const eventStayMs = (extraHold = 0) => Math.max(600, EVENT_MS + extraHold)

export interface HistoryPlayback {
  index: number
  event: TimelineEvent | undefined
  playing: boolean
  speed: PlaybackSpeed
  /** 末尾まで再生し終わった（再生ボタンで最初から再生し直す） */
  finished: boolean
  atEnd: boolean
  count: number
  /**
   * goTo（play/seek/restart）のたびに増える通し番号。同じ index への goTo
   * （例：末尾から先頭へのリプレイで index が 0→0 のまま、またはたまたま同じ index に
   * 戻る場合）でも変化するため、呼び出し側が「新しい再生インスタンスだ」と検知する
   * トリガーに使う（HistoryWiringCanvas の登場アニメのリセットキーなど）。
   */
  nonce: number
  /**
   * 今のイベントをどこから始めたか（0..1・そのイベントの滞在時間に対する割合）。
   * 再生バーを途中で離したときだけ 0 以外になり、配線図・ページ送り・バーもその位置から再開する
   */
  offset: number
  play: () => void
  /** 操作直前に再生中だったかを返す。描画前の連続操作でも最新の状態を読む */
  pause: () => boolean
  toggle: () => void
  restart: () => void
  /** 今のイベントだけを先頭から再生し、完成した図で一時停止する */
  replayEvent: () => void
  /** 指定イベントへ移動する。autoplay=true なら移動後も再生する。offset はそのイベントの途中から始める割合 */
  seek: (index: number, autoplay?: boolean, offset?: number) => void
  /** 現在の再生状態を保ったまま前後のイベントへ移動する */
  step: (delta: -1 | 1) => void
  setSpeed: (s: PlaybackSpeed) => void
}

/**
 * 歴史アニメーションの再生ヘッド。イベント配列を受け取り、index / 再生状態 /
 * 速度を管理する。実際の描画は呼び出し側（Canvas）が
 * event の変化を検知して行うため、このフックはタイミング制御に専念する。
 */
/**
 * @param speed 再生速度。モーダルを閉じても保つため、状態は呼び出し側（永続設定）が持つ
 * @param setSpeed 速度変更の通知先
 * @param extraHoldMs イベントごとの滞在時間の増減（×1時, ms）。
 *   IN/OUT が複数ページに分かれるときは正（全ページを見せ終わってから次の日へ進む）、
 *   演出が早く終わる「静かな日」は負（QUIET_EVENT_MS まで詰める）を渡す。
 */
export function useHistoryPlayback(
  events: TimelineEvent[],
  enabled: boolean,
  speed: PlaybackSpeed,
  setSpeed: (s: PlaybackSpeed) => void,
  extraHoldMs?: number[],
): HistoryPlayback {
  const count = events.length
  const [index, setIndex] = useState(0)
  const [playing, setPlayingState] = useState(false)
  const [finished, setFinishedState] = useState(false)
  // 連続操作では再描画がまだ終わっていない場合があるため、操作時点の状態を保持する。
  const indexRef = useRef(0)
  const playingRef = useRef(false)
  const finishedRef = useRef(false)
  const activeRef = useRef(false)
  const replayOnly = useRef(false)
  activeRef.current = enabled && count > 0
  // 同じ描画内で停止→再開しても、タイマーは再設定する。Canvas のリセットキーとは分ける。
  const [playbackRevision, setPlaybackRevision] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerVersion = useRef(0)
  const clear = useCallback(() => {
    timerVersion.current++
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
  }, [])

  // 残り時間は×1の尺で持ち、操作時点までの経過だけを旧速度で差し引く。
  const timing = useRef({ token: '', startTs: 0, remainingBase: 0, speedAt: 1 as number, wasPlaying: false })
  const setPlaying = useCallback((next: boolean) => {
    if (playingRef.current === next) return
    clear()
    const T = timing.current
    const now = Date.now()
    if (T.wasPlaying) T.remainingBase = Math.max(0, T.remainingBase - (now - T.startTs) * T.speedAt)
    T.startTs = now
    T.wasPlaying = next
    playingRef.current = next
    setPlayingState(next)
    setPlaybackRevision((n) => n + 1)
  }, [clear])
  const setFinished = useCallback((next: boolean) => {
    finishedRef.current = next
    setFinishedState(next)
  }, [])
  const [nonce, setNonce] = useState(0)   // 同一 index への seek でも再トリガーさせる
  const [offset, setOffset] = useState(0)

  const goTo = useCallback((i: number, autoplay: boolean, startOffset = 0) => {
    if (!activeRef.current) return
    clear()
    replayOnly.current = false
    const clamped = Math.max(0, Math.min(count - 1, i))
    const clampedOffset = Math.max(0, Math.min(1, startOffset))
    indexRef.current = clamped
    setIndex(clamped)
    setPlaying(autoplay)
    setFinished(!autoplay && clamped === count - 1 && clampedOffset === 1)
    setOffset(clampedOffset)
    setNonce((n) => n + 1)
  }, [count, clear, setPlaying, setFinished])

  // モーダルを開く／イベントが変わったら先頭から自動再生
  useEffect(() => {
    clear()
    if (enabled && count > 0) {
      goTo(0, true)
    } else {
      setPlaying(false)
    }
    return clear
  }, [enabled, count, clear, goTo, setPlaying])

  // 進行タイマー：速度で実尺をスケール。速度変更・一時停止/再開でも
  // 「残り時間」を保ったまま測り直すので、変更が即座に反映される。
  useEffect(() => {
    clear()
    if (!enabled || count === 0) { timing.current.wasPlaying = false; return }

    const T = timing.current
    // 日・seek のいずれかが変わったら新しいイベント（満タンから）
    const token = `${index}#${nonce}`
    const now = Date.now()
    // IN/OUT のページ送りが終わるまで次の日へ進まない（hold ぶんを尺に含める）
    const fullBase = eventStayMs(extraHoldMs?.[index])

    if (token !== T.token) {
      T.token = token; T.remainingBase = fullBase * (1 - offset); T.startTs = now; T.speedAt = speed
    } else if (T.wasPlaying) {
      // 再生継続中の再評価（＝速度変更）：旧速度での経過ぶんを残りから差し引く
      T.remainingBase = Math.max(0, T.remainingBase - (now - T.startTs) * T.speedAt)
      T.startTs = now; T.speedAt = speed
    } else {
      // 一時停止からの再開：残り時間は保持したまま時計だけ入れ直す
      T.startTs = now; T.speedAt = speed
    }
    T.wasPlaying = playing
    if (!playing) return   // 一時停止：残り時間は timing.current に保持済み

    const delay = T.remainingBase / speed
    const version = timerVersion.current
    timer.current = setTimeout(() => {
      if (!activeRef.current || !playingRef.current || version !== timerVersion.current) return
      if (replayOnly.current) {
        goTo(index, false, 1)
        setFinished(false)
        return
      }
      if (index < count - 1) {
        goTo(index + 1, true)
      } else {
        setPlaying(false)   // 末尾で停止 → 次の再生ボタンで最初から
        setFinished(true)
      }
    }, delay)
    return clear
  }, [enabled, playing, playbackRevision, index, speed, nonce, offset, count, clear, goTo, extraHoldMs, setPlaying, setFinished])

  const restart = useCallback(() => goTo(0, true), [goTo])
  const replayEvent = useCallback(() => {
    if (!activeRef.current) return
    goTo(indexRef.current, true)
    replayOnly.current = true
  }, [goTo])

  // 末尾まで見終わったあとの再生ボタンは「もう一度最初から」
  const play = useCallback(() => {
    if (!activeRef.current) return
    if (finishedRef.current) { goTo(0, true); return }
    setPlaying(true)
  }, [goTo, setPlaying])

  const pause = useCallback(() => {
    const wasPlaying = playingRef.current
    setPlaying(false)
    return wasPlaying
  }, [setPlaying])
  const toggle = useCallback(() => { if (playingRef.current) pause(); else play() }, [pause, play])
  const seek = useCallback((i: number, autoplay = false, startOffset = 0) => goTo(i, autoplay, startOffset), [goTo])
  const step = useCallback((delta: -1 | 1) => {
    const next = Math.max(0, Math.min(count - 1, indexRef.current + delta))
    if (next === indexRef.current) return
    // 停止中の前後移動は、選んだ日の完成した図を表示する。
    goTo(next, playingRef.current, playingRef.current ? 0 : 1)
  }, [count, goTo])
  return {
    index,
    event: events[index],
    playing,
    speed,
    finished,
    atEnd: index >= count - 1,
    count,
    nonce,
    offset,
    play,
    pause,
    toggle,
    restart,
    replayEvent,
    seek,
    step,
    setSpeed,
  }
}
