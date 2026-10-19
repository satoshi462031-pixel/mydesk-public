import AsyncStorage from '@react-native-async-storage/async-storage'
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { SPOTLIGHT_STEPS, SpotlightFeatureId, SpotlightTargetId, spotlightStepIndex } from '../constants/spotlightSteps'
import { measureCoachTarget } from '../utils/coachMarkMeasurement'
import { SpotlightProgress } from '../utils/spotlightProgress'
import { analytics, EVENTS } from '../services/analytics'

// ─── スポットライト案内の状態管理 ─────────────────────────────────
// 各画面は useSpotlightTarget(id) が返す ref を対象要素に付けるだけでよい。
// 座標はステップが切り替わるたびに measureInWindow で実測する（タブ切替や
// スクロール後でもズレないようにするため、登録時の値をキャッシュしない）。
//
// コンテキストを「登録」と「進行」の2つに分けているのは、ターゲットの登録で
// 画面側を再描画させないため。ひとつにまとめると、登録 → コンテキスト更新 →
// ref を持つ画面の再描画 → 登録…… と再帰して更新回数の上限に達する。

export const SPOTLIGHT_DONE_KEY = '@spotlight_tour_done_v1'
export const TUTORIAL_SEEN_KEY = '@tutorial_seen_v1'
// 案内の途中でアプリを閉じた人が、次の起動で最初からやり直しにならないための現在位置。
// 終わり方（完了・×で閉じる）はどちらも DONE_KEY を立てるので、ここが残るのは
// 「読み終える前にアプリごと閉じた」ときだけ
export const SPOTLIGHT_PROGRESS_KEY = '@spotlight_tour_features_v2'
/** v1の通し番号をv2へ一度だけ移すために残す。新規保存には使わない。 */
export const SPOTLIGHT_STEP_KEY = '@spotlight_tour_step_v1'

export interface SpotlightRect {
  x: number
  y: number
  width: number
  height: number
}

/** View でも TouchableOpacity でも受けられるよう、必要な機能だけで型を絞る */
interface Measurable {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void
}

interface SpotlightRegistry {
  registerTarget: (id: SpotlightTargetId, node: Measurable) => void
  unregisterTarget: (id: SpotlightTargetId, node: Measurable) => void
  measureTarget: (id: SpotlightTargetId) => Promise<SpotlightRect | null>
  /** オーバーレイが、いま案内を画面に出しているかを知らせる */
  setShown: (shown: boolean) => void
}

interface SpotlightTour {
  running: boolean
  /**
   * 案内が画面に出ているか。running は作成の流れを離れて非表示になっている間も true のまま
   * （戻れば再開する）なので、「案内と重ならないよう待つ」判定はこちらを見る
   */
  shown: boolean
  stepIndex: number
  /** OKで読んだ説明。操作の完了とは分け、画面を戻っても読み直させない。 */
  acknowledged: SpotlightFeatureId[]
  acknowledge: () => void
  /** feature IDを渡すとその機能の案内から再開する。並び順を変えても保存状態は壊れない。 */
  startTour: (from?: SpotlightFeatureId, completed?: SpotlightFeatureId[], acknowledged?: SpotlightFeatureId[]) => void
  next: () => void
  /** 指定のステップへ戻す（戻るボタンで前の画面に戻ったとき用） */
  goTo: (index: number) => void
  finish: (opts?: { remember?: boolean; outcome?: 'completed' | 'skipped' }) => void
}

// 中身が入れ替わらないコンテキスト。ref を登録するだけの画面は再描画されない
const RegistryContext = createContext<SpotlightRegistry | null>(null)
const TourContext = createContext<SpotlightTour | null>(null)

export function SpotlightProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [acknowledged, setAcknowledged] = useState<SpotlightFeatureId[]>([])
  const [shown, setShown] = useState(false)
  const completedRef = useRef(new Set<SpotlightFeatureId>())
  // 同じ id を複数の画面が同時に持つ（作成の各段が積み重なって、それぞれ SetupProgress を出す）。
  // 1枠だと、上の画面が外れたときに下で生きている画面の登録まで消え、戻った先で測れなくなっていた。
  // 登録順に並べ、外すときは自分だけを抜き、測るのは最後に載った（＝いちばん上の画面の）もの
  const targets = useRef(new Map<SpotlightTargetId, Measurable[]>())
  const storageQueueRef = useRef(Promise.resolve())

  // 開始直後に完了するなど、保存操作が短時間に重なっても古いremoveが新しいdoneを
  // 後から消さないよう、ガイド関連のAsyncStorage更新は必ず呼出順に直列化する。
  const enqueueStorage = useCallback((work: () => Promise<unknown>) => {
    storageQueueRef.current = storageQueueRef.current
      .catch(() => {})
      .then(async () => { await work() })
      .catch((error: unknown) => { analytics.error('save_spotlight_progress', error) })
  }, [])

  const registry = useMemo<SpotlightRegistry>(
    () => ({
      registerTarget: (id, node) => {
        const list = (targets.current.get(id) ?? []).filter((n) => n !== node)
        targets.current.set(id, [...list, node])
      },
      unregisterTarget: (id, node) => {
        const list = (targets.current.get(id) ?? []).filter((n) => n !== node)
        if (list.length > 0) targets.current.set(id, list)
        else targets.current.delete(id)
      },
      measureTarget: (id) => measureCoachTarget(targets.current.get(id)?.at(-1)),
      setShown,
    }),
    [],
  )

  const startTour = useCallback((from: SpotlightFeatureId = 'pick-purpose', completed: SpotlightFeatureId[] = [], read: SpotlightFeatureId[] = []) => {
    completedRef.current = new Set(completed)
    setAcknowledged(read)
    setStepIndex(spotlightStepIndex(from))
    setRunning(true)
    analytics.track(EVENTS.TUTORIAL_STARTED, { start_step: from, resumed: completed.length > 0 })
    // 旧ガイドの既読も消す。手動で再開したあと途中終了した場合、旧キーが残っていると
    // 次回起動時に新しい進捗があっても再開されない。
    enqueueStorage(() => AsyncStorage.multiRemove([SPOTLIGHT_DONE_KEY, TUTORIAL_SEEN_KEY]))
  }, [enqueueStorage])

  // 進んだ位置を残す。再開時に対象の画面から離れていても、オーバーレイ側が
  // recoverSpotlightStepForRoute でいまの画面の案内へ復帰するので、位置だけ保てばよい
  useEffect(() => {
    if (!running) return
    const current = SPOTLIGHT_STEPS[stepIndex]?.key
    if (!current) return
    const progress: SpotlightProgress = {
      version: 2,
      current,
      completed: [...completedRef.current],
      ...(acknowledged.length ? { acknowledged } : {}),
    }
    enqueueStorage(() => AsyncStorage.setItem(SPOTLIGHT_PROGRESS_KEY, JSON.stringify(progress)))
  }, [running, stepIndex, acknowledged, enqueueStorage])

  useEffect(() => {
    if (!running) return
    analytics.track(EVENTS.TUTORIAL_STEP_VIEWED, {
      step: SPOTLIGHT_STEPS[stepIndex]?.key,
      step_number: stepIndex + 1,
      step_count: SPOTLIGHT_STEPS.length,
    })
  }, [running, stepIndex])

  const acknowledge = useCallback(() => {
    const key = SPOTLIGHT_STEPS[stepIndex]?.key
    if (running && key) setAcknowledged((previous) => previous.includes(key) ? previous : [...previous, key])
  }, [running, stepIndex])

  const next = useCallback(() => {
    setStepIndex((i) => {
      const current = SPOTLIGHT_STEPS[i]?.key
      if (current) completedRef.current.add(current)
      return Math.min(i + 1, SPOTLIGHT_STEPS.length - 1)
    })
  }, [])

  const goTo = useCallback((index: number) => {
    const target = Math.max(0, Math.min(index, SPOTLIGHT_STEPS.length - 1))
    completedRef.current = new Set(SPOTLIGHT_STEPS.slice(0, target).map((step) => step.key))
    setStepIndex(target)
  }, [])

  const finish = useCallback(({ remember = true, outcome = 'completed' }: { remember?: boolean; outcome?: 'completed' | 'skipped' } = {}) => {
    analytics.track(
      outcome === 'completed' ? EVENTS.TUTORIAL_COMPLETED : EVENTS.TUTORIAL_SKIPPED,
      {
        last_step: SPOTLIGHT_STEPS[stepIndex]?.key,
        completed_steps: outcome === 'completed'
          ? Math.min(completedRef.current.size + 1, SPOTLIGHT_STEPS.length)
          : completedRef.current.size,
      },
    )
    setRunning(false)
    setStepIndex(0)
    setAcknowledged([])
    completedRef.current.clear()
    enqueueStorage(async () => {
      await AsyncStorage.multiRemove([SPOTLIGHT_PROGRESS_KEY, SPOTLIGHT_STEP_KEY])
      if (remember) await AsyncStorage.setItem(SPOTLIGHT_DONE_KEY, '1')
    })
  }, [enqueueStorage, stepIndex])

  const tour = useMemo<SpotlightTour>(
    () => ({ running, shown, stepIndex, acknowledged, acknowledge, startTour, next, goTo, finish }),
    [running, shown, stepIndex, acknowledged, acknowledge, startTour, next, goTo, finish],
  )

  return (
    <RegistryContext.Provider value={registry}>
      <TourContext.Provider value={tour}>{children}</TourContext.Provider>
    </RegistryContext.Provider>
  )
}

export function useSpotlight(): SpotlightTour {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error('useSpotlight must be used inside SpotlightProvider')
  return ctx
}

export function useSpotlightRegistry(): SpotlightRegistry {
  const ctx = useContext(RegistryContext)
  if (!ctx) throw new Error('useSpotlightRegistry must be used inside SpotlightProvider')
  return ctx
}

/**
 * 対象要素に付ける ref を返す。案内を出さない画面でも安全に使えるよう、
 * Provider の外では何もしない ref を返す。
 */
export function useSpotlightTarget(id: SpotlightTargetId) {
  const registry = useContext(RegistryContext)
  // 外れるときの ref には null しか来ないので、自分が載せた要素を控えておいて抜く
  const current = useRef<Measurable | null>(null)
  return useCallback(
    (node: Measurable | null) => {
      if (current.current) registry?.unregisterTarget(id, current.current)
      current.current = node
      if (node) registry?.registerTarget(id, node)
    },
    [registry, id],
  )
}
