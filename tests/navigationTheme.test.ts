import assert from 'node:assert/strict'
import test from 'node:test'
import { buildColors } from '../src/constants/colors'
import { buildNavigationTheme } from '../src/navigation/navigationTheme'

// 既定のライトテーマ（@react-navigation/native の DefaultTheme）の地と面。
// ダークモードでこれが一つでも残ると、画面が地を塗っていない所だけ白く見える
const LIGHT_DEFAULTS = ['rgb(242, 242, 242)', 'rgb(255, 255, 255)', '#F2F2F2', '#FFFFFF']

test('ダークモードではナビゲーションが描く地と面が黒系になる', () => {
  const colors = buildColors(true)
  const theme = buildNavigationTheme(colors, true)
  assert.equal(theme.dark, true)
  assert.equal(theme.colors.background, colors.bg)
  assert.equal(theme.colors.card, colors.header)
  for (const key of ['background', 'card'] as const) {
    const value = theme.colors[key]
    assert.ok(!LIGHT_DEFAULTS.includes(value) && !LIGHT_DEFAULTS.includes(value.toUpperCase()), `${key} が明るい既定色のまま`)
  }
})

test('ライトモードでは配色の正本（AppColors）の地と面をそのまま使う', () => {
  const colors = buildColors(false)
  const theme = buildNavigationTheme(colors, false)
  assert.equal(theme.dark, false)
  assert.equal(theme.colors.background, colors.bg)
  assert.equal(theme.colors.card, colors.header)
  assert.equal(theme.colors.text, colors.text)
})
