import * as FileSystem from 'expo-file-system/legacy'
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator'
import type { ChatMessage } from '../../store/conversationStore'
import { runtimeAIImageUri } from '../../utils/planImageRefs'

const AI_IMAGE_DIR = FileSystem.documentDirectory + 'ai_conversation_images/'
const MAX_IMAGE_BASE64_CHARS = 5_500_000

const IMAGE_ATTEMPTS = [
  { maxEdge: 1568, compress: 0.8 },
  { maxEdge: 1568, compress: 0.65 },
  { maxEdge: 1280, compress: 0.65 },
  { maxEdge: 1024, compress: 0.6 },
] as const

export interface PreparedAIImage {
  uri: string
  base64: string
  type: 'image/jpeg'
}

export async function prepareAIImage(uri: string, width: number, height: number): Promise<PreparedAIImage> {
  for (const attempt of IMAGE_ATTEMPTS) {
    const maxEdge = Math.max(width, height)
    const resize = maxEdge > attempt.maxEdge
      ? width >= height ? { width: attempt.maxEdge } : { height: attempt.maxEdge }
      : null
    const processed = await manipulateAsync(
      uri,
      resize ? [{ resize }] : [],
      { compress: attempt.compress, format: SaveFormat.JPEG, base64: true },
    )
    if (processed.base64 && processed.base64.length <= MAX_IMAGE_BASE64_CHARS) {
      return { uri: processed.uri, base64: processed.base64, type: 'image/jpeg' }
    }
  }
  throw new Error('AI_IMAGE_TOO_LARGE')
}

export async function persistAIConversationImage(uri: string, messageId: string): Promise<string> {
  await FileSystem.makeDirectoryAsync(AI_IMAGE_DIR, { intermediates: true })
  const destination = `${AI_IMAGE_DIR}${messageId}.jpg`
  await FileSystem.copyAsync({ from: uri, to: destination })
  return destination
}

export async function loadAIConversationImage(uri: string): Promise<PreparedAIImage> {
  const image = await manipulateAsync(uri, [], { format: SaveFormat.JPEG, compress: 0.8, base64: true })
  if (image.base64 && image.base64.length <= MAX_IMAGE_BASE64_CHARS && Math.max(image.width, image.height) <= 1568) {
    return { uri: image.uri, base64: image.base64, type: 'image/jpeg' }
  }
  return prepareAIImage(image.uri, image.width, image.height)
}

export async function deleteAIConversationImages(messages: ChatMessage[]): Promise<void> {
  await Promise.all(messages.map(async (message) => {
    // 前のコンテナの絶対パスのまま残っている参照も、今の置き場所に読み替えて消す
    const uri = message.imageUri && runtimeAIImageUri(message.imageUri, FileSystem.documentDirectory)
    if (!uri?.startsWith(AI_IMAGE_DIR)) return
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {})
  }))
}

/**
 * 控えから戻した相談の写真を、今のアプリコンテナのパスへ置き直し、実物が無いものは外す。
 * 控えのパスは作った時点のコンテナの絶対パスで、iOS は更新でコンテナの UUID が変わる。
 * 置き直さずに見ると、同じ端末に残っている写真まで外す（デスク写真の dropMissingLocalImages と同じ）。
 * 有無を確かめられなかった写真は残す
 */
export async function dropMissingConversationImages<T extends { messages: { imageUri?: string }[] }>(
  conversations: readonly T[],
): Promise<T[]> {
  const current = (uri: string) => runtimeAIImageUri(uri, FileSystem.documentDirectory)
  return Promise.all(conversations.map(async (conversation) => {
    if (!conversation.messages.some((message) => message.imageUri)) return conversation
    const messages = await Promise.all(conversation.messages.map(async (message) => {
      if (!message.imageUri) return message
      const uri = current(message.imageUri)
      const info = await FileSystem.getInfoAsync(uri).catch(() => null)
      if (info && !info.exists) return { ...message, imageUri: undefined }
      return uri === message.imageUri ? message : { ...message, imageUri: uri }
    }))
    return messages.every((message, index) => message === conversation.messages[index]) ? conversation : { ...conversation, messages }
  }))
}

export async function deleteAllAIConversationImages(): Promise<void> {
  await FileSystem.deleteAsync(AI_IMAGE_DIR, { idempotent: true }).catch(() => {})
}
