import { createClient } from '@supabase/supabase-js'
import { sessionStorage } from './sessionStorage'
import { createTimeoutFetch } from '../utils/timeoutFetch'
import { secureHttpUrl } from '../utils/secureTransport'
import { fetch as apiFetch } from 'expo/fetch'
import { createPublicApiFetch } from '../utils/publicApiFetch'

const configuredSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!

if (!configuredSupabaseUrl || !supabaseAnon) {
  throw new Error(
    '.env に EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY を設定してください'
  )
}

export const supabaseUrl = secureHttpUrl(configuredSupabaseUrl, typeof __DEV__ !== 'undefined' && __DEV__).href.replace(/\/$/, '')
// RN標準fetchはredirect:'error'を無視するため、ネイティブでも転送を止められるExpoの実装を使う。
const transportWithTimeout = createTimeoutFetch((url, init) => apiFetch(url, {
  ...init, body: init?.body ?? undefined, signal: init?.signal ?? undefined,
}))
const timeoutFetch = createPublicApiFetch(transportWithTimeout, supabaseUrl, supabaseAnon,
  process.env.EXPO_PUBLIC_PUBLIC_API_URL ?? 'https://mydesk.page')

export const supabaseAuthStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`

/**
 * 再認証・設定更新用。本体のログイン状態を変更しない（services/auth.ts）。
 * 本体のセッションに触れず、端末にも残さない。本体でログインし直すと、ログイン後の照合
 * （store/accountDataOwner）が走るうえ、別のアカウントを選ばれたときにそちらへ切り替わる
 */
export function createEphemeralAuthClient() {
  const memory = new Map<string, string>()
  return createClient(supabaseUrl, supabaseAnon, {
    global: { fetch: timeoutFetch },
    auth: {
      storage: {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => { memory.set(key, value) },
        removeItem: (key: string) => { memory.delete(key) },
      },
      storageKey:         'mydesk-reauth',
      autoRefreshToken:   false,
      persistSession:     true,
      detectSessionInUrl: false,
      flowType:           'pkce',
    },
  })
}

// スキーマ型は付けていない。付けるなら supabase gen types で生成し直すこと
// （手書きの型定義は bookmarks・backups・ai_usage・products 等が抜けたまま
//  実スキーマから離れてしまい、付けた瞬間に全クエリが never になる）
export const supabase = createClient(supabaseUrl, supabaseAnon, {
  global: { fetch: timeoutFetch },
  auth: {
    // access / refresh トークンは OS のキーストアに置く（sessionStorage.ts 参照）。
    // AsyncStorage に平文で残すと端末バックアップや root 端末から抜き出せる。
    storage:            sessionStorage,
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,
    // OAuth（Google等）はPKCEフローを使用：モバイルで安全かつ
    // リダイレクトの ?code= を exchangeCodeForSession で確実にセッション化できる
    flowType:           'pkce',
    experimental:       { passkey: true },
  },
})
