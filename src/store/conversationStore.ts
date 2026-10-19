import AsyncStorage from '@react-native-async-storage/async-storage'
import { truncateChars } from '../utils/truncateText'
import { repairStoredConversations } from '../utils/storedDataRepair'
import { runtimeAIImageUri, storedAIImageRef } from '../utils/planImageRefs'
import type { AIResponseStats } from '../utils/aiResponseStats'

export interface ChatMessage {
  id:        string
  role:      'user' | 'assistant'
  content:   string
  imageUri?: string   // ローカル画像URI（ユーザーメッセージのみ）
  requestId?: string  // 通信再試行時に利用枠とAPI原価を二重消費しないための冪等キー
  createdAt: string
  responseStats?: AIResponseStats
  // 送信失敗の表示専用メッセージ（API送信履歴・会話保存から除外される）
  isError?:  boolean
  // デスク分析の添付カード表示用。content にはAPIへ送る全文が入り、
  // チャット上はカード（タップで全文を展開）＋コメントだけを表示する。
  // author は他人の公開デスクを添付したときだけ入る（自分のデスクは付けない）
  planCard?: { name: string; count: number; comment?: string; author?: string }
}

export interface StoredConversation {
  id:           string
  title:        string
  messages:     ChatMessage[]
  createdAt:    string
  updatedAt:    string
}

const KEY = '@ai_conversations_v2'
let mutationQueue: Promise<void> = Promise.resolve()

// 写真の参照は Documents からの相対パスで保存する（planStore のデスク写真と同じ）。iOS は更新で
// アプリのコンテナの UUID が変わり、絶対パスのままだと過去の相談の写真が開けず、削除でも消えずに残る。
// expo-file-system は Node のテストから読めないので、使うときに読み込む
function documentDirectory(): string | null {
  return (require('expo-file-system/legacy') as typeof import('expo-file-system/legacy')).documentDirectory
}

function mapImageUris(conversations: readonly StoredConversation[], map: (uri: string) => string): StoredConversation[] {
  return conversations.map((conversation) => {
    if (!conversation.messages.some((message) => message.imageUri)) return conversation
    const messages = conversation.messages.map((message) => {
      if (!message.imageUri) return message
      const imageUri = map(message.imageUri)
      return imageUri === message.imageUri ? message : { ...message, imageUri }
    })
    return { ...conversation, messages }
  })
}

function serialize(conversations: readonly StoredConversation[]): string {
  return JSON.stringify(mapImageUris(sortConversationsByRecent(conversations), storedAIImageRef))
}

export function sortConversationsByRecent(conversations: readonly StoredConversation[]): StoredConversation[] {
  return conversations
    .map((conversation, index) => ({ conversation, index }))
    .sort((a, b) => b.conversation.updatedAt.localeCompare(a.conversation.updatedAt) || a.index - b.index)
    .map(({ conversation }) => conversation)
}

async function serializeMutation(task: () => Promise<void>): Promise<void> {
  const run = mutationQueue.catch(() => {}).then(task)
  mutationQueue = run.catch(() => {})
  await run
}

export async function flushConversationPersistence(): Promise<void> {
  await mutationQueue
}

/**
 * 読めなかったときは例外を投げる。書き込み（読んで→足して→書く）とバックアップはこちらを使う。
 * 空で返すと、次の保存が全会話をその1件だけで上書きし、控えにも0件で上がる
 */
export async function readConversations(): Promise<StoredConversation[]> {
  const raw = await AsyncStorage.getItem(KEY)
  if (!raw) return []
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('conversations are not an array')
  // 並べ替え（updatedAt.localeCompare）で1件の崩れが全件の読み書きを止めないよう、形を整えてから並べる
  const directory = documentDirectory()
  return mapImageUris(
    sortConversationsByRecent(repairStoredConversations<StoredConversation>(parsed)),
    (uri) => runtimeAIImageUri(uri, directory),
  )
}

/** 表示用。読めなければ空で見せる（書き戻しには使わないこと） */
export async function loadConversations(): Promise<StoredConversation[]> {
  try {
    return await readConversations()
  } catch {
    return []
  }
}

export async function getConversation(id: string): Promise<StoredConversation | null> {
  const list = await loadConversations()
  return list.find(c => c.id === id) ?? null
}

export async function saveConversation(conv: StoredConversation): Promise<void> {
  await serializeMutation(async () => {
    const list = await readConversations()
    const idx  = list.findIndex(c => c.id === conv.id)
    if (idx >= 0) list[idx] = conv
    else list.unshift(conv)
    await AsyncStorage.setItem(KEY, serialize(list))
  })
}

/**
 * バックアップ復元用の全置換。
 * 復元は「この端末のデータを丸ごと差し替える」操作なのでマージしない
 * （ID が衝突したときの解決規則を決められないため。デスク・ガジェットと同じ扱い）。
 */
export async function replaceConversations(conversations: readonly StoredConversation[]): Promise<void> {
  await serializeMutation(async () => {
    await AsyncStorage.setItem(KEY, serialize(conversations))
  })
}

export async function deleteConversation(id: string): Promise<void> {
  await serializeMutation(async () => {
    const list = await readConversations()
    await AsyncStorage.setItem(KEY, serialize(list.filter(c => c.id !== id)))
  })
}

export function newConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function newMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function deriveTitle(firstUserMessage: string, lang: 'ja' | 'en' = 'ja'): string {
  return truncateChars(firstUserMessage.replace(/^[*\-#]+\s*/, ''), 30) || (lang === 'ja' ? '新しいチャット' : 'New Chat')
}

export function derivePreview(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find(m => m.role === 'assistant')
  if (!last) return ''
  return truncateChars(last.content.replace(/^#+\s*/, '').replace(/\*\*/g, ''), 60)
}
