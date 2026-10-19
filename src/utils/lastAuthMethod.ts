import AsyncStorage from '@react-native-async-storage/async-storage'

// 前回ログインに使った方法。ログイン画面で「どのボタンを押せばいいか」を示すために持つ。
//
// 同じアカウントでも Apple と Google とメールでは別のユーザーになる。どれで入ったかを
// 覚えていないと、別の方法で入り直して「デスクが消えた」に見える（中身は前のアカウントにある）。
//
// 覚えるのは方法だけで、メールアドレスや誰かを特定できる値は持たない。端末内にだけ置く。
const KEY = '@last_auth_method'

export type AuthMethod = 'email' | 'google' | 'apple' | 'passkey'

function parse(value: string | null): AuthMethod | null {
  return value === 'email' || value === 'google' || value === 'apple' || value === 'passkey' ? value : null
}

export async function rememberAuthMethod(method: AuthMethod): Promise<void> {
  await AsyncStorage.setItem(KEY, method).catch(() => {})
}

export async function getLastAuthMethod(): Promise<AuthMethod | null> {
  return parse(await AsyncStorage.getItem(KEY).catch(() => null))
}

/**
 * 忘れるのはアカウントを消したときだけ。ログアウトでは残す
 * （また入るときの目印であって、ログイン中かどうかとは別の情報）。
 */
export async function forgetAuthMethod(): Promise<void> {
  await AsyncStorage.removeItem(KEY).catch(() => {})
}
