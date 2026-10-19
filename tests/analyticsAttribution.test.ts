import assert from 'node:assert/strict'
import test from 'node:test'
import {
  attributionProperties,
  parseStoredAttribution,
  parseUtmAttribution,
} from '../src/utils/analyticsAttribution'

test('管理対象のUTMだけを抽出する', () => {
  const result = parseUtmAttribution(
    'https://mydesk.page/setup/demo?utm_source=Twitter&utm_medium=social&utm_campaign=launch_2026q3&utm_content=profile&token=secret',
    '2026-08-24T00:00:00.000Z',
  )
  assert.deepEqual(result, {
    utm_source: 'twitter',
    utm_medium: 'social',
    utm_campaign: 'launch_2026q3',
    utm_content: 'profile',
    captured_at: '2026-08-24T00:00:00.000Z',
  })
  assert.equal('token' in (result ?? {}), false)
})

test('sourceまたはcampaignが無いURLは流入として扱わない', () => {
  assert.equal(parseUtmAttribution('mydesk://home?utm_source=twitter'), null)
  assert.equal(parseUtmAttribution('mydesk://home?utm_campaign=launch'), null)
})

test('自由文・長すぎる値を拒否してPII混入を防ぐ', () => {
  assert.equal(parseUtmAttribution('mydesk://home?utm_source=user%40example.com&utm_campaign=launch'), null)
  assert.equal(parseUtmAttribution(`mydesk://home?utm_source=twitter&utm_campaign=${'a'.repeat(81)}`), null)
})

test('壊れた保存値は破棄する', () => {
  assert.equal(parseStoredAttribution('{broken'), null)
  assert.equal(parseStoredAttribution(JSON.stringify({ utm_source: 'twitter' })), null)
})

test('first touchとlast touchのPerson Propertiesを分離する', () => {
  const first = parseUtmAttribution('mydesk://home?utm_source=twitter&utm_campaign=launch', '2026-08-01T00:00:00.000Z')
  const last = parseUtmAttribution('mydesk://home?utm_source=twitter&utm_campaign=feature_ai', '2026-08-24T00:00:00.000Z')
  assert.deepEqual(attributionProperties(first, last), {
    first_utm_source: 'twitter',
    first_utm_campaign: 'launch',
    first_attributed_at: '2026-08-01T00:00:00.000Z',
    last_utm_source: 'twitter',
    last_utm_campaign: 'feature_ai',
    last_attributed_at: '2026-08-24T00:00:00.000Z',
  })
})
