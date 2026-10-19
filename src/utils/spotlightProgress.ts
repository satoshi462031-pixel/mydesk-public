import { SPOTLIGHT_STEPS, SpotlightFeatureId, spotlightStepIndex } from '../constants/spotlightSteps'

export interface SpotlightProgress {
  version: 2
  current: SpotlightFeatureId
  completed: SpotlightFeatureId[]
  acknowledged?: SpotlightFeatureId[]
}

const FEATURE_IDS = new Set(SPOTLIGHT_STEPS.map((step) => step.key))

/**
 * v1 で保存していた数値の位置は、当時の並びを指している。
 * 現在の SPOTLIGHT_STEPS に直接あてると、あとから足したステップのぶんだけ
 * 全員が前へずれて、見終わったはずの案内をもう一度見ることになる。
 */
const LEGACY_V1_STEPS: SpotlightFeatureId[] =
  ['pick-purpose', 'pick-purpose', 'pick-purpose', 'assign-gadgets', 'assign-gadgets', 'done']

/**
 * やめた段の案内。保存された current がこれなら次の段の案内から続ける
 * （知らないキーとして捨てると、最初の案内からやり直しになる）
 */
const RETIRED_STEPS: Record<string, SpotlightFeatureId> = {
  // ジャンルの段（用途と機材の間）
  'pick-template': 'assign-gadgets',
}

export function parseSpotlightProgress(raw: string | null): SpotlightProgress | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<SpotlightProgress>
    const retired = typeof parsed.current === 'string' ? RETIRED_STEPS[parsed.current] : undefined
    const value = retired ? { ...parsed, current: retired } : parsed
    if (value.version !== 2 || !value.current || !FEATURE_IDS.has(value.current)) return null
    const currentIndex = spotlightStepIndex(value.current)
    const completedBeforeCurrent = new Set(SPOTLIGHT_STEPS.slice(0, currentIndex).map((step) => step.key))
    const completed = Array.isArray(value.completed)
      ? [...new Set(value.completed.filter(
          (key): key is SpotlightFeatureId => completedBeforeCurrent.has(key as SpotlightFeatureId),
        ))]
      : []
    const acknowledged = Array.isArray(value.acknowledged)
      ? [...new Set(value.acknowledged.filter((key): key is SpotlightFeatureId => FEATURE_IDS.has(key)))]
      : []
    return { version: 2, current: value.current, completed, ...(acknowledged.length ? { acknowledged } : {}) }
  } catch {
    return null
  }
}

export function spotlightProgressFrom(feature: SpotlightFeatureId): SpotlightProgress {
  const index = spotlightStepIndex(feature)
  return {
    version: 2,
    current: feature,
    completed: SPOTLIGHT_STEPS.slice(0, index).map((step) => step.key),
  }
}

export function resolveSpotlightResume(savedProgress: string | null, legacyStep: string | null): SpotlightProgress {
  const progress = parseSpotlightProgress(savedProgress)
  if (progress) return progress

  const parsedLegacyIndex = legacyStep === null ? 0 : Number(legacyStep)
  const legacyIndex = Number.isInteger(parsedLegacyIndex)
    ? Math.max(0, Math.min(parsedLegacyIndex, LEGACY_V1_STEPS.length - 1))
    : 0
  return spotlightProgressFrom(LEGACY_V1_STEPS[legacyIndex] ?? 'pick-purpose')
}
