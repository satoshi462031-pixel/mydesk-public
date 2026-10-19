import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useSyncExternalStore } from 'react'
import { EXPLORE_GUIDE_KEY, ExploreGuideId, ExploreGuideProgress, parseExploreGuideProgress } from '../utils/exploreGuide'

let snapshot: ExploreGuideProgress & { loaded: boolean } = { seen: [], dismissed: false, loaded: false }
const listeners = new Set<() => void>()
let loading: Promise<void> | undefined
let writes = Promise.resolve()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const getSnapshot = () => snapshot
function publish(next: typeof snapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
}
function load() {
  loading ??= AsyncStorage.getItem(EXPLORE_GUIDE_KEY)
    .then((raw) => publish({ ...parseExploreGuideProgress(raw), loaded: true }))
    .catch(() => publish({ ...parseExploreGuideProgress(''), loaded: true }))
  return loading
}
function save(progress: ExploreGuideProgress) {
  publish({ ...progress, loaded: true })
  // 複数画面からの既読・終了の書き込みを、操作した順で保存する。
  writes = writes.then(() => AsyncStorage.setItem(EXPLORE_GUIDE_KEY, JSON.stringify(progress))).catch(() => {})
}
export function markExploreGuideSeen(id: ExploreGuideId) {
  if (!snapshot.loaded || snapshot.seen.includes(id)) return
  save({ seen: [...snapshot.seen, id], dismissed: snapshot.dismissed })
}
export function endExploreGuide() {
  if (!snapshot.loaded) return
  save({ seen: snapshot.seen, dismissed: true })
}
export function useExploreGuide() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  useEffect(() => { void load() }, [])
  return state
}
