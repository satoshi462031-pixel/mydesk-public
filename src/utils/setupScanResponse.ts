import type { GadgetCategory } from '../types'
import { trimAndTruncate } from './truncateText'

export interface SetupScanDevice {
  name: string
  category: GadgetCategory
  confidence: 'high' | 'medium' | 'low'
}

export const SETUP_SCAN_CATEGORIES: readonly GadgetCategory[] = [
  'PC', 'Monitor', 'TV', 'Projector', 'Dock', 'Hub', 'Mouse', 'Keyboard', 'Speaker',
  'Headphone', 'Earphone', 'Light', 'Webcam', 'Camera', 'Microphone', 'Storage',
  'Router', 'NetworkSwitch', 'Modem', 'GameConsole', 'CaptureDevice', 'StreamingDevice',
  'KVM', 'Printer', 'Charger', 'MobileBattery', 'AudioInterface', 'Mixer', 'Smartphone',
  'Tablet', 'PowerStrip', 'UPS', 'Controller', 'Other',
]

const categorySet = new Set<string>(SETUP_SCAN_CATEGORIES)
const CATEGORY_ALIASES: Readonly<Record<string, GadgetCategory>> = {
  laptop: 'PC',
  computer: 'PC',
  desktop: 'PC',
  display: 'Monitor',
  screen: 'Monitor',
  console: 'GameConsole',
  gameconsole: 'GameConsole',
  microphone: 'Microphone',
  mic: 'Microphone',
  pc: 'PC',
  ノートpc: 'PC',
  パソコン: 'PC',
  ディスプレイ: 'Monitor',
  モニター: 'Monitor',
  ゲーム機: 'GameConsole',
  マイク: 'Microphone',
}

function normalizeCategory(value: unknown): GadgetCategory {
  if (typeof value !== 'string') return 'Other'
  const category = value.trim()
  if (categorySet.has(category)) return category as GadgetCategory
  return CATEGORY_ALIASES[category.toLocaleLowerCase()] ?? 'Other'
}

export function parseSetupScanResponse(raw: string): SetupScanDevice[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  const parsed = JSON.parse(candidate) as { devices?: unknown }
  if (!Array.isArray(parsed.devices)) throw new Error('AI_SCAN_INVALID_RESPONSE')
  return parsed.devices.slice(0, 12).flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    const name = typeof item.name === 'string' ? trimAndTruncate(item.name, 80) : ''
    const category = normalizeCategory(item.category)
    const confidence = item.confidence === 'high' || item.confidence === 'medium'
      ? item.confidence
      : 'low'
    return name ? [{ name, category, confidence }] : []
  })
}
