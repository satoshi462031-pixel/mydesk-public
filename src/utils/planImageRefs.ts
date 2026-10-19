const PLAN_IMAGE_PREFIX = 'plan_images/'
// AI相談に添付した写真（services/ai/imageService.ts）。置き場所が違うだけで、壊れ方はデスクの写真と同じ
const AI_IMAGE_PREFIX = 'ai_conversation_images/'

function safeRelativePath(value: string): boolean {
  return value.length > 0
    && !value.startsWith('/')
    && !value.split('/').some((part) => part === '' || part === '.' || part === '..')
}

function storedRef(uri: string, prefix: string): string {
  if (/^https?:\/\//i.test(uri)) return uri
  const normalized = uri.replace(/\\/g, '/')
  if (normalized.startsWith(prefix)) {
    const relative = normalized.slice(prefix.length)
    return safeRelativePath(relative) ? `${prefix}${relative}` : uri
  }

  const marker = normalized.indexOf(`/${prefix}`)
  if (marker < 0) return uri
  const relative = normalized.slice(marker + prefix.length + 1)
  return safeRelativePath(relative) ? `${prefix}${relative}` : uri
}

function runtimeUri(uri: string, documentDirectory: string | null, prefix: string): string {
  if (!documentDirectory) return uri
  const stored = storedRef(uri, prefix)
  if (!stored.startsWith(prefix)) return uri
  const relative = stored.slice(prefix.length)
  if (!safeRelativePath(relative)) return uri
  return `${documentDirectory.replace(/\/?$/, '/')}${stored}`
}

/**
 * AsyncStorage へ保存する写真参照。
 *
 * iOS の Documents より前にあるコンテナ UUID は更新時に変わり得るため、
 * アプリ管理下の写真は `plan_images/...` だけを保存する。HTTP URL と、管理外の
 * ローカル URI は勝手に書き換えない。
 */
export function storedPlanImageRef(uri: string): string {
  return storedRef(uri, PLAN_IMAGE_PREFIX)
}

/** 保存用の相対参照を、現在のアプリコンテナにある file URI へ戻す。 */
export function runtimePlanImageUri(uri: string, documentDirectory: string | null): string {
  return runtimeUri(uri, documentDirectory, PLAN_IMAGE_PREFIX)
}

/** AI相談の写真の保存用の参照（`ai_conversation_images/...`）。理由は storedPlanImageRef と同じ */
export function storedAIImageRef(uri: string): string {
  return storedRef(uri, AI_IMAGE_PREFIX)
}

/** AI相談の写真の保存用の参照を、現在のアプリコンテナにある file URI へ戻す */
export function runtimeAIImageUri(uri: string, documentDirectory: string | null): string {
  return runtimeUri(uri, documentDirectory, AI_IMAGE_PREFIX)
}
