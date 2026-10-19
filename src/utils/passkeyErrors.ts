import { localizedErrorMessage } from './localizedError'

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) return ''
  const value = error as { code?: unknown; message?: unknown }
  if (value.code === 'Passkey Get' || value.code === 'Passkey Create') {
    // Androidのネイティブモジュールはコードを共用し、原因をmessageで返す。
    const reasons: Record<string, string> = {
      UserCancelled: 'PASSKEY_CANCELLED',
      NoCredentials: 'webauthn_credential_not_found',
      NotSupported: 'PASSKEY_UNSUPPORTED',
      NotConfigured: 'PASSKEY_PROVIDER_UNAVAILABLE',
      Interrupted: 'PASSKEY_INTERRUPTED',
    }
    return typeof value.message === 'string' ? reasons[value.message] ?? 'PASSKEY_NATIVE_FAILED' : 'PASSKEY_NATIVE_FAILED'
  }
  return typeof value.code === 'string' ? value.code : typeof value.message === 'string' ? value.message : ''
}

export function isPasskeyCancelled(error: unknown): boolean {
  return ['PASSKEY_CANCELLED', 'ERR_USER_CANCELLED', 'ERR_REQUEST_CANCELED'].includes(errorCode(error))
}

export function passkeyErrorMessage(error: unknown, lang: 'ja' | 'en'): string {
  const messages: Record<string, readonly [string, string]> = {
    PASSKEY_UNSUPPORTED: ['この端末ではパスキーを利用できません。別の方法でログインしてください。', 'Passkeys are unavailable on this device. Use another sign-in method.'],
    PASSKEY_CONFIGURATION_ERROR: ['パスキーを利用できません。別の方法でログインしてください。', 'Passkeys are unavailable. Use another sign-in method.'],
    passkey_disabled: ['パスキーを利用できません。別の方法でログインしてください。', 'Passkeys are unavailable. Use another sign-in method.'],
    PASSKEY_ACCOUNT_UNCONFIRMED: ['メールアドレスの確認を完了してから、パスキーを登録してください。', 'Confirm your email address before registering a passkey.'],
    AUTH_ACCOUNT_CHANGED: ['アカウントが変わりました。現在のアカウントでやり直してください。', 'Your account changed. Try again with the current account.'],
    webauthn_credential_exists: ['このパスキーは登録済みです。', 'This passkey is already registered.'],
    too_many_passkeys: ['登録できるパスキーの上限に達しました。', 'You have reached the passkey limit.'],
    webauthn_credential_not_found: ['登録済みのパスキーが見つかりません。別の方法でログインしてください。', 'No registered passkey was found. Use another sign-in method.'],
    webauthn_challenge_expired: ['確認の有効期限が切れました。もう一度お試しください。', 'The request expired. Try again.'],
    ERR_BIOMETRIC: ['端末の設定でFace IDまたはTouch IDを有効にしてください。', 'Enable Face ID or Touch ID in your device settings.'],
    ERR_NOT_CONFIGURED: ['パスキーを利用できません。別の方法でログインしてください。', 'Passkeys are unavailable. Use another sign-in method.'],
    ERR_PASSKEY_REQUEST_FAILED: ['パスキーを利用できませんでした。登録済みのパスキーを確認するか、別の方法でログインしてください。', 'Could not use a passkey. Check your saved passkeys or use another sign-in method.'],
    PASSKEY_PROVIDER_UNAVAILABLE: ['端末のパスワード管理サービスと画面ロックの設定を確認してください。別の方法でもログインできます。', 'Check your password manager and screen lock settings. You can also use another sign-in method.'],
    PASSKEY_INTERRUPTED: ['パスキーの操作が中断されました。もう一度お試しください。', 'The passkey request was interrupted. Try again.'],
    PASSKEY_NATIVE_FAILED: ['パスキーを利用できませんでした。別の方法でログインするか、もう一度お試しください。', 'Could not use a passkey. Try again or use another sign-in method.'],
  }
  const translation = messages[errorCode(error)]
  return translation?.[lang === 'ja' ? 0 : 1] ?? localizedErrorMessage(error, lang,
    lang === 'ja' ? 'パスキーの操作に失敗しました。もう一度お試しください。' : 'The passkey request failed. Try again.')
}
