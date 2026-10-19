import { Platform } from 'react-native'
import type { PasskeyListItem } from '@supabase/supabase-js'
import { supabase } from '../supabase/client'
import { markSignInPending } from '../store/accountDataOwner'

export const PASSKEY_RP_ID = 'mydesk.page'
export const PASSKEYS_ENABLED = process.env.EXPO_PUBLIC_PASSKEY_ENABLED === 'true'
export type { PasskeyListItem }

function nativePasskeys(): typeof import('react-native-passkeys') | null {
  if (!PASSKEYS_ENABLED || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return null
  const version = parseFloat(String(Platform.Version))
  const minimumVersion = Platform.OS === 'ios' ? 16 : 28
  if (!Number.isFinite(version) || version < minimumVersion) return null
  try {
    // 旧ビルドとExpo Goにもログイン画面を出せるよう、ネイティブモジュールを遅延ロードする。
    const passkeys: typeof import('react-native-passkeys') = require('react-native-passkeys')
    return passkeys.isSupported() ? passkeys : null
  } catch {
    return null
  }
}

export function isPasskeySupported(): boolean {
  return nativePasskeys() !== null
}

function requirePasskeys() {
  const passkeys = nativePasskeys()
  if (!passkeys) throw new Error('PASSKEY_UNSUPPORTED')
  return passkeys
}

export async function signInWithPasskey() {
  const passkeys = requirePasskeys()
  const { data: challenge, error: startError } = await supabase.auth.passkey.startAuthentication()
  if (startError) throw startError
  if (challenge.options.rpId !== PASSKEY_RP_ID) throw new Error('PASSKEY_CONFIGURATION_ERROR')
  const credential = await passkeys.get({ ...challenge.options, extensions: undefined })
  if (!credential) throw new Error('PASSKEY_CANCELLED')
  // verifyAuthenticationはSIGNED_INを発火するので、端末データの照合予約を先に済ませる。
  await markSignInPending()
  const { data, error } = await supabase.auth.passkey.verifyAuthentication({
    challengeId: challenge.challenge_id,
    credential: { ...credential, clientExtensionResults: {} },
  })
  if (error) throw error
  if (!data.session || !data.user) throw new Error('PASSKEY_SIGN_IN_FAILED')
  return data
}

async function assertAccount(userId: string) {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  if (!user || user.id !== userId) throw new Error('AUTH_ACCOUNT_CHANGED')
  if (user.is_anonymous || !(user.email_confirmed_at || user.phone_confirmed_at)) {
    throw new Error('PASSKEY_ACCOUNT_UNCONFIRMED')
  }
}

export async function registerPasskey(userId: string) {
  const passkeys = requirePasskeys()
  await assertAccount(userId)
  const { data: challenge, error: startError } = await supabase.auth.passkey.startRegistration()
  if (startError) throw startError
  if (challenge.options.rp.id !== PASSKEY_RP_ID) throw new Error('PASSKEY_CONFIGURATION_ERROR')
  const credential = await passkeys.create({ ...challenge.options, extensions: undefined })
  if (!credential) throw new Error('PASSKEY_CANCELLED')
  await assertAccount(userId)
  const { data, error } = await supabase.auth.passkey.verifyRegistration({
    challengeId: challenge.challenge_id,
    credential: { ...credential, clientExtensionResults: {} },
  })
  if (error) throw error
  return data
}

export async function listPasskeys(userId: string): Promise<PasskeyListItem[]> {
  requirePasskeys()
  await assertAccount(userId)
  const { data, error } = await supabase.auth.passkey.list()
  if (error) throw error
  return data
}

export async function removePasskey(userId: string, passkeyId: string): Promise<void> {
  requirePasskeys()
  await assertAccount(userId)
  const { error } = await supabase.auth.passkey.delete({ passkeyId })
  if (error) throw error
}
