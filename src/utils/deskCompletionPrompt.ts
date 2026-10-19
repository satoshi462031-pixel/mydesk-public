// 全ガジェットの商品名を入れ終えたときの公開・共有案内を、デスクごとに1回だけ出す。
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = '@desk_completion_prompt_seen_v1'

async function loadSeen(): Promise<ReadonlySet<string>> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [])
  } catch {
    return new Set()
  }
}

export async function hasSeenDeskCompletionPrompt(planId: string): Promise<boolean> {
  return (await loadSeen()).has(planId)
}

/** デスクを消したときに、そのデスクの記録を消す。残すとデスクの数だけ溜まり続ける */
export async function forgetDeskCompletionPrompt(planId: string): Promise<void> {
  const seen = await loadSeen()
  if (!seen.has(planId)) return
  await AsyncStorage.setItem(KEY, JSON.stringify([...seen].filter((id) => id !== planId)))
}

export async function markDeskCompletionPromptSeen(planId: string): Promise<void> {
  const seen = await loadSeen()
  if (seen.has(planId)) return
  await AsyncStorage.setItem(KEY, JSON.stringify([...seen, planId])).catch(() => {})
}
