export function extractSuggestedProductName(content: string): string | null {
  const match = content.match(/(?:^|\n)(?:商品候補|Product candidate)\s*[:：]\s*\*\*([^*\n]{2,80})\*\*/i)
  return match?.[1]?.trim() || null
}
