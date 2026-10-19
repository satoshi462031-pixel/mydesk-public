import AsyncStorage from '@react-native-async-storage/async-storage'

export const AI_HISTORY_ENABLED_KEY = '@ai_history_enabled'

export async function isAIHistoryEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(AI_HISTORY_ENABLED_KEY).catch(() => null)) !== 'false'
}

export async function setAIHistoryEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(AI_HISTORY_ENABLED_KEY, enabled ? 'true' : 'false')
}
