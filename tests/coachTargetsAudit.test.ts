import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { auditCoachTargets } from '../scripts/auditCoachTargets'

test('すべての？の説明が、画面に登録された対象を指している', () => {
  assert.deepEqual(auditCoachTargets().missing.map(ref => ref.id), [])
})

test('登録の無い対象・一覧枠を見つけ、定数・三項・coachKey の組み立てで登録したものは通す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'coach-targets-'))
  try {
    writeFileSync(join(dir, 'steps.ts'), [
      "import type { CoachStep } from './hooks'",
      "const LIST = 'list-frame'",
      'export const SCREEN_COACH: CoachStep[] = [',
      "  { target: 'real', within: LIST, ja: '', en: '' },",
      "  { target: 'card-action', coveredBy: ['tabs'], ja: '', en: '' },",
      "  { target: 'ghost', within: 'missing-frame', ja: '', en: '' },",
      ']',
    ].join('\n'))
    writeFileSync(join(dir, 'Screen.tsx'), [
      "const LIST = 'list-frame'",
      'export function Screen({ on }: { on: boolean }) {',
      "  const tile = useCoachTarget(coachKey && `${coachKey}-action`)",
      '  return <View ref={coachTarget(LIST)}>',
      "    <View ref={coachTarget(on ? 'real' : 'other')} />",
      '    <Tile coachKey="card" />',
      '    <CoachAnchor id="tabs"><View /></CoachAnchor>',
      '  </View>',
      '}',
    ].join('\n'))
    assert.deepEqual(auditCoachTargets(dir).missing.map(ref => ref.id).sort(), ['ghost', 'missing-frame'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
