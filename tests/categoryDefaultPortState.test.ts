import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CATEGORY_DEFAULT_PORT_STATE,
  CATEGORY_PORT_CONFIG,
  buildPortsFromState,
  categoryDefaultPortState,
  initPortState,
  isCategoryDefaultPortState,
} from '../src/constants/portFormConfig'
import { GadgetCategory } from '../src/types'

const covered = Object.keys(CATEGORY_DEFAULT_PORT_STATE) as GadgetCategory[]

test('既定値のキーはそのカテゴリのフィールドに実在する', () => {
  for (const category of covered) {
    const fields = CATEGORY_PORT_CONFIG[category] ?? []
    for (const key of Object.keys(CATEGORY_DEFAULT_PORT_STATE[category] ?? {})) {
      assert.ok(fields.some((f) => f.key === key), `${category}.${key} に対応するフィールドが無い`)
    }
  }
})

test('既定値の型と上限がフィールド定義と噛み合っている', () => {
  for (const category of covered) {
    const fields = CATEGORY_PORT_CONFIG[category] ?? []
    for (const [key, value] of Object.entries(CATEGORY_DEFAULT_PORT_STATE[category] ?? {})) {
      const field = fields.find((f) => f.key === key)
      assert.ok(field, `${category}.${key}`)
      if (field.kind === 'stepper') {
        assert.equal(typeof value, 'number', `${category}.${key} はステッパー`)
        assert.ok((value as number) >= 1, `${category}.${key} は1以上`)
        assert.ok((value as number) <= (field.max ?? Infinity), `${category}.${key} が max 超え`)
      } else {
        assert.equal(typeof value, 'boolean', `${category}.${key} はトグル`)
      }
    }
  }
})

test('既定値からポートが1つ以上できる', () => {
  for (const category of covered) {
    const ports = buildPortsFromState(categoryDefaultPortState(category), CATEGORY_PORT_CONFIG[category] ?? [])
    assert.ok(ports.length > 0, `${category} のポートが空`)
  }
})

// 保存 → 読み直しで状態が変わると、ユーザーが何も触っていないのに
// 推定の印（portsNeedConfirmation）が勝手に落ちる
test('既定値はポートに変換して読み直しても同じ状態に戻る', () => {
  for (const category of covered) {
    const fields = CATEGORY_PORT_CONFIG[category] ?? []
    const state = categoryDefaultPortState(category)
    const restored = initPortState(buildPortsFromState(state, fields), fields)
    for (const key of Object.keys(state)) {
      assert.equal(restored[key], state[key], `${category}.${key} が往復で変わった`)
    }
  }
})

test('既定値のままなら推定と判定し、1つでも変えれば推定でなくなる', () => {
  const state = categoryDefaultPortState('Monitor')
  assert.equal(isCategoryDefaultPortState('Monitor', state), true)
  assert.equal(isCategoryDefaultPortState('Monitor', { ...state, hdmi_in: 3 }), false)
})

// 接続方式のピッカーや専用フォームが口を決めるカテゴリは既定値を持たない
test('既定値を持たないカテゴリは推定扱いしない', () => {
  assert.equal(isCategoryDefaultPortState('Mouse', categoryDefaultPortState('Mouse')), false)
  assert.equal(isCategoryDefaultPortState('Charger', {}), false)
  assert.equal(isCategoryDefaultPortState('PowerStrip', {}), false)
  assert.equal(isCategoryDefaultPortState('Keyboard', categoryDefaultPortState('Keyboard')), false)
})
