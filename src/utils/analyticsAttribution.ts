export const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

type UtmField = typeof UTM_FIELDS[number]

export type UtmAttribution = {
  utm_source: string
  utm_medium?: string
  utm_campaign: string
  utm_content?: string
  utm_term?: string
  captured_at: string
}

const MAX_UTM_VALUE_LENGTH = 80
const CONTROLLED_UTM_VALUE = /^[A-Za-z0-9._~-]+$/

function readControlledValue(searchParams: URLSearchParams, field: UtmField): string | undefined {
  const value = searchParams.get(field)?.trim()
  if (!value || value.length > MAX_UTM_VALUE_LENGTH || !CONTROLLED_UTM_VALUE.test(value)) return undefined
  return field === 'utm_source' || field === 'utm_medium' ? value.toLowerCase() : value
}

/** URL全体や任意パラメータを保存せず、運営側で管理するUTM値だけを抽出する。 */
export function parseUtmAttribution(url: string, capturedAt = new Date().toISOString()): UtmAttribution | null {
  try {
    const searchParams = new URL(url).searchParams
    const utm_source = readControlledValue(searchParams, 'utm_source')
    const utm_campaign = readControlledValue(searchParams, 'utm_campaign')
    if (!utm_source || !utm_campaign) return null

    const optional = Object.fromEntries(
      UTM_FIELDS
        .filter((field) => field !== 'utm_source' && field !== 'utm_campaign')
        .map((field) => [field, readControlledValue(searchParams, field)])
        .filter((entry): entry is [string, string] => entry[1] != null),
    )
    return { utm_source, utm_campaign, ...optional, captured_at: capturedAt }
  } catch {
    return null
  }
}

export function parseStoredAttribution(value: string | null): UtmAttribution | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const query = new URLSearchParams()
    for (const field of UTM_FIELDS) {
      if (typeof parsed[field] === 'string') query.set(field, parsed[field])
    }
    const capturedAt = typeof parsed.captured_at === 'string' && !Number.isNaN(Date.parse(parsed.captured_at))
      ? parsed.captured_at
      : new Date(0).toISOString()
    return parseUtmAttribution(`mydesk://attribution?${query.toString()}`, capturedAt)
  } catch {
    return null
  }
}

export function attributionProperties(
  first: UtmAttribution | null,
  last: UtmAttribution | null,
): Record<string, string> {
  const properties: Record<string, string> = {}
  for (const [prefix, attribution] of [['first', first], ['last', last]] as const) {
    if (!attribution) continue
    for (const field of UTM_FIELDS) {
      const value = attribution[field]
      if (value) properties[`${prefix}_${field}`] = value
    }
    properties[`${prefix}_attributed_at`] = attribution.captured_at
  }
  return properties
}
