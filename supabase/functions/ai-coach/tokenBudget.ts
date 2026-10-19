export interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function actualTokenCount(usage: AnthropicUsage | undefined): number | null {
  if (!usage || !Number.isInteger(usage.input_tokens) || !Number.isInteger(usage.output_tokens)) return null
  const cacheCreation = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  if (!Number.isInteger(cacheCreation) || !Number.isInteger(cacheRead)) return null
  if (usage.input_tokens! < 0 || usage.output_tokens! < 0 || cacheCreation < 0 || cacheRead < 0) return null
  const total = usage.input_tokens! + usage.output_tokens! + cacheCreation + cacheRead
  return Number.isSafeInteger(total) ? total : null
}

export function inputTokenCount(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const inputTokens = (value as { input_tokens?: unknown }).input_tokens
  return Number.isInteger(inputTokens) && Number(inputTokens) >= 0 ? Number(inputTokens) : null
}
