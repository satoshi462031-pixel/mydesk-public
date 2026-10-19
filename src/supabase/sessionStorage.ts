import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { STORAGE_TIMEOUT_MS, withTimeout } from '../utils/networkError'

// Supabase のセッション（access token / refresh token）の保存先。
//
// AsyncStorage は平文のままアプリのデータ領域に置かれる。Android は
// android:allowBackup が既定で true なのでバックアップ経由で吸い出せるし、
// root / 脱獄済みの端末なら直接読める。refresh token を取られると
// 有効期限まで別端末からなりすませるため、OS のキーストア（Keychain /
// EncryptedSharedPreferences）に載せる expo-secure-store を使う。
//
// SecureStore は 1値あたり 2048 バイトまでという制限があり、セッション JSON は
// それを超える。分割して保存し、読み出し時に結合する。

// 2048 バイト制限はバイト数。日本語を含むメールアドレス等が入っても超えないよう、
// UTF-8 で最大3バイト/文字とみて余裕を持たせた文字数で切る。
const CHUNK_SIZE = 600

// 分割保存したときに本体キーへ書くヘッダ。生の値と衝突しないよう、
// JSON として不正な接頭辞にしておく（セッションは必ず JSON）。
const CHUNK_HEADER = 'chunks:'
const LEGACY_CHUNK_HEADER = '\0chunks:'

// チャンクは世代 a / b を交互に使う。同じキーを上書きしていた頃は、2つ目のチャンクで
// 書き込みに失敗すると「1つ目だけ新しい」状態が古いヘッダのまま読めてしまい、
// 新しい access token と前の利用者の user.id が混ざったセッションが復元された。
// 読まれていない側の世代へ全部書いてからヘッダを切り替えれば、途中で失敗しても
// ヘッダは揃った前の世代を指したままになる。
const GENERATIONS = ['a', 'b'] as const
type Generation = typeof GENERATIONS[number]
// 失敗した書き込みの残りを掃除するときに探す上限。セッションは数チャンクに収まる
const MAX_CHUNKS = 64

const useSecureStore = Platform.OS === 'ios' || Platform.OS === 'android'

/** 世代なし（null）は、世代を持つ前の版が書いた `${key}.${index}` */
function chunkKey(key: string, generation: Generation | null, index: number): string {
  return generation ? `${key}.${generation}.${index}` : `${key}.${index}`
}

type ChunkHeader = { generation: Generation | null; count: number }

function parseHeader(head: string | null): ChunkHeader | 'invalid' | null {
  const prefix = head?.startsWith(CHUNK_HEADER)
    ? CHUNK_HEADER
    : head?.startsWith(LEGACY_CHUNK_HEADER)
      ? LEGACY_CHUNK_HEADER
      : null
  if (!prefix) return null
  const body = head!.slice(prefix.length)
  const match = /^(?:([ab]):)?(\d+)$/.exec(body)
  if (!match) return 'invalid'
  const count = Number(match[2])
  if (!Number.isInteger(count) || count <= 0) return 'invalid'
  return { generation: (match[1] as Generation | undefined) ?? null, count }
}

async function readHeader(key: string): Promise<ChunkHeader | null> {
  const head = await withTimeout(SecureStore.getItemAsync(key), STORAGE_TIMEOUT_MS).catch(() => null)
  const header = parseHeader(head)
  return header === 'invalid' ? null : header
}

async function removeChunks(key: string, generation: Generation | null, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, generation, i)).catch(() => {})
  }
}

/** 数の分からない残り（失敗した書き込み）を、途切れるところまで消す */
async function removeOrphanChunks(key: string, generation: Generation): Promise<void> {
  for (let i = 0; i < MAX_CHUNKS; i++) {
    const part = await withTimeout(SecureStore.getItemAsync(chunkKey(key, generation, i)), STORAGE_TIMEOUT_MS).catch(() => null)
    if (part === null) return
    await SecureStore.deleteItemAsync(chunkKey(key, generation, i)).catch(() => {})
  }
}

async function secureGetItem(key: string): Promise<string | null> {
  const head = await withTimeout(SecureStore.getItemAsync(key), STORAGE_TIMEOUT_MS)
  if (head === null) return null
  const header = parseHeader(head)
  if (header === null) return head
  if (header === 'invalid') return null

  const parts: string[] = []
  for (let i = 0; i < header.count; i++) {
    const part = await withTimeout(SecureStore.getItemAsync(chunkKey(key, header.generation, i)), STORAGE_TIMEOUT_MS)
    // 途中が欠けている＝壊れているので、中途半端なJSONを返さず未ログイン扱いにする
    if (part === null) return null
    parts.push(part)
  }
  return parts.join('')
}

async function secureSetItem(key: string, value: string): Promise<void> {
  const previous = await readHeader(key)

  if (value.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value)
    if (previous) await removeChunks(key, previous.generation, previous.count)
    return
  }

  const chunks: string[] = []
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE))
  }
  const generation: Generation = previous?.generation === 'a' ? 'b' : 'a'
  // 前回この世代への書き込みが途中で失敗していると、今回より後ろの番号が残る
  await removeOrphanChunks(key, generation)
  for (let i = 0; i < chunks.length; i++) {
    await SecureStore.setItemAsync(chunkKey(key, generation, i), chunks[i])
  }
  // ここで初めて読み手が新しい世代を見る。これより前に失敗すれば前の世代が丸ごと残る
  await SecureStore.setItemAsync(key, `${CHUNK_HEADER}${generation}:${chunks.length}`)
  if (previous) await removeChunks(key, previous.generation, previous.count)
}

async function secureRemoveItem(key: string): Promise<void> {
  const header = await readHeader(key)
  await SecureStore.deleteItemAsync(key)
  if (header) await removeChunks(key, header.generation, header.count)
  // 失敗した書き込みの残り。ログアウト後にトークンの断片を残さない
  for (const generation of GENERATIONS) await removeOrphanChunks(key, generation)
}

/**
 * 旧バージョンで AsyncStorage に置かれたセッションを SecureStore へ移す。
 * これをやらないと、アップデートした利用者が全員ログアウトさせられる。
 * 移した後は平文のコピーを残さない。
 */
async function migrateFromAsyncStorage(key: string): Promise<string | null> {
  const legacy = await withTimeout(AsyncStorage.getItem(key), STORAGE_TIMEOUT_MS).catch(() => null)
  if (legacy === null) return null
  try {
    await secureSetItem(key, legacy)
  } catch {
    // セッショントークンを平文のまま使い続けない。移行できない端末は
    // 再ログインを要求し、旧コピーも削除する。
    await AsyncStorage.removeItem(key).catch(() => {})
    throw new Error('secure session storage is unavailable')
  }
  await AsyncStorage.removeItem(key).catch(() => {})
  return legacy
}

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!useSecureStore) return withTimeout(AsyncStorage.getItem(key), STORAGE_TIMEOUT_MS)
    try {
      const value = await secureGetItem(key)
      if (value !== null) return value
    } catch {
      // キーストアの一時的な読取失敗を「未ログイン」に変換しない。
      // 旧データがあれば移行を試し、無ければ呼び出し側へ失敗を伝える。
      const migrated = await migrateFromAsyncStorage(key)
      if (migrated !== null) return migrated
      throw new Error('secure session storage is unavailable')
    }
    return migrateFromAsyncStorage(key)
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!useSecureStore) return AsyncStorage.setItem(key, value)
    try {
      await secureSetItem(key, value)
    } catch {
      // モバイルで認証トークンを平文保存するフォールバックは作らない。
      await AsyncStorage.removeItem(key).catch(() => {})
      throw new Error('secure session storage is unavailable')
    }
  },

  async removeItem(key: string): Promise<void> {
    if (!useSecureStore) return AsyncStorage.removeItem(key)
    await Promise.all([
      AsyncStorage.removeItem(key),
      secureRemoveItem(key),
    ])
  },
}
