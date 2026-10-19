import AsyncStorage from '@react-native-async-storage/async-storage'

const AI_DATA_CONSENT_KEY = '@ai_data_consent'
const AI_DATA_CONSENT_VERSION = '2026-08-24'

export async function hasAIDataConsent(): Promise<boolean> {
  return (await AsyncStorage.getItem(AI_DATA_CONSENT_KEY).catch(() => null)) === AI_DATA_CONSENT_VERSION
}

export async function grantAIDataConsent(): Promise<void> {
  await AsyncStorage.setItem(AI_DATA_CONSENT_KEY, AI_DATA_CONSENT_VERSION)
}

