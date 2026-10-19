import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { accentIconColor, buildColors, CATEGORY_COLORS, categoryBaseColor, categoryIconColor, CUSTOM_CATEGORY_COLOR_PRESETS, compositeColor, contrastRatio, hexToOklch, isBrightWarmColor, isYellowColor, themeIconColor, themeTintBase, YELLOW_REFERENCE } from '../src/constants/colors'
import { ACCENT_PRESETS } from '../src/constants/accentColors'
import { PORT_COLORS, portColor, portTintColor } from '../src/constants/portTypes'
import { KIND_BADGE_COLORS, UI_STATUS_COLORS, UI_STATUS_ON_WARNING } from '../src/constants/ui'

const CHIP = '#F2F2F2'
const WHITE = '#FFFFFF'

describe('テーマカラーの操作アイコン', () => {
  it('選択色を敷いた chip の上でも 3:1 を確保する', () => {
    for (const isDark of [false, true]) {
      const colors = buildColors(isDark)
      for (const preset of ACCENT_PRESETS) {
        const icon = accentIconColor(preset.color, isDark)
        for (const surface of [colors.card, colors.bg, colors.chip, colors.input]) {
          for (const alpha of ['00', '10', '12', '14', '18']) {
            const background = compositeColor(preset.color + alpha, surface)
            assert.ok(contrastRatio(icon, background) >= 3, `${isDark}/${preset.key}/${surface}/${alpha}: ${icon}`)
          }
        }
      }
    }
  })

  it('補正でテーマ色の色相を変えない（オレンジだけは黄土色に濁らないよう赤へ寄せる）', () => {
    for (const preset of ACCENT_PRESETS) {
      const gap = hueGapDeg(preset.color, accentIconColor(preset.color, false))
      if (preset.key === 'orange') assert.ok(gap < 25 && hexToOklch(accentIconColor(preset.color, false)).C >= hexToOklch(preset.color).C, preset.key)
      else assert.ok(gap < 4, preset.key)
    }
  })
  it('拍手・お気に入り・Proは両モードとも見本の黄（#FFD400）で、明るい警告背景には読める黒文字を使う', () => {
    for (const isDark of [false, true]) {
      const colors = buildColors(isDark)
      assert.equal(colors.clap, YELLOW_REFERENCE)
      assert.equal(colors.favorite, YELLOW_REFERENCE)
      assert.equal(colors.pro, YELLOW_REFERENCE)
    }
    assert.equal(buildColors(false).onClap, '#FFC94A')
    assert.equal(UI_STATUS_COLORS.warning, '#FFD21A')
    assert.ok(contrastRatio(UI_STATUS_ON_WARNING, UI_STATUS_COLORS.warning) >= 4.5)
  })
})
const hueGapDeg = (a: string, b: string) => {
  const d = Math.abs(hexToOklch(a).H - hexToOklch(b).H)
  return (Math.min(d, 2 * Math.PI - d) * 180) / Math.PI
}

describe('ジャンル色の白黒モード', () => {
  it('自作ジャンルの自由色を区別して描き、極端な白黒も両モードで見えるよう補正する', () => {
    const samples = [...CUSTOM_CATEGORY_COLOR_PRESETS.map((preset) => preset.color), '#000000', '#FFFFFF', '#FFFF00', '#000080', '#BD538A']
    for (const base of samples) {
      assert.equal(categoryBaseColor('Other', base), base)
      for (const isDark of [false, true]) {
        const icon = categoryIconColor('Other', isDark, undefined, base)
        // 黄は白い面で 3:1 に届かないのを承知で #FFD400 に揃える（auditColors の免除）
        if (isYellowColor(base)) {
          assert.equal(icon, YELLOW_REFERENCE)
          continue
        }
        if (isBrightWarmColor(base) && isDark) {
          assert.equal(icon, base)
          continue
        }
        assert.ok(contrastRatio(icon, isDark ? '#3A3A3C' : CHIP) >= 3, `${base}/${isDark}: ${icon}`)
        const tinted = compositeColor(base + (isDark ? '38' : '22'), isDark ? '#3A3A3C' : CHIP)
        assert.ok(contrastRatio(icon, tinted) >= 3, `${base}/${isDark}/tinted: ${icon}`)
      }
    }
    assert.notEqual(categoryIconColor('Other', false, undefined, '#E53935'), categoryIconColor('Other', false, undefined, '#2196F3'))
    assert.equal(categoryBaseColor('PC', '#FFFFFF'), CATEGORY_COLORS.PC)
    assert.equal(categoryBaseColor('Other', '<script>'), CATEGORY_COLORS.Other)
    assert.equal(categoryBaseColor('Other', '#ECC600'), '#FFD21A')
    assert.equal(categoryBaseColor('Other', '#96B82A'), '#A3E635')
  })
  it('ジャンルごとの濃淡を保ち、元の暗い色を一律に明るくしない', () => {
    assert.equal(categoryIconColor('PC', false), '#B71C1C')
    assert.equal(categoryIconColor('Headphone', false), '#0D47A1')
    assert.ok(hexToOklch(categoryIconColor('PC', false)).L < hexToOklch(categoryIconColor('StreamingDevice', false)).L)
    assert.ok(hexToOklch(categoryIconColor('Headphone', false)).L < hexToOklch(categoryIconColor('Instrument', false)).L)
  })

  it('黄は両モードとも #FFD400、ライムはダークで明るい色を保ち、ライトは縁取りなしで 3:1 に届く鮮やかな色にする', () => {
    for (const category of Object.keys(CATEGORY_COLORS)) {
      const light = categoryIconColor(category, false)
      const dark = categoryIconColor(category, true)
      if (isYellowColor(CATEGORY_COLORS[category])) {
        assert.equal(light, YELLOW_REFERENCE, category)
        assert.equal(dark, YELLOW_REFERENCE, category)
        assert.ok(contrastRatio(dark, compositeColor(CATEGORY_COLORS[category] + '38', '#3A3A3C')) >= 3, `${category} on dark tint`)
        continue
      }
      if (isBrightWarmColor(CATEGORY_COLORS[category])) {
        assert.equal(dark, CATEGORY_COLORS[category], category)
        assert.ok(contrastRatio(dark, compositeColor(CATEGORY_COLORS[category] + '38', '#3A3A3C')) >= 3, `${category} on dark tint`)
        assert.ok(contrastRatio(light, CHIP) >= 3, `${category} ${light} on light`)
        assert.ok(contrastRatio(light, compositeColor(CATEGORY_COLORS[category] + '22', CHIP)) >= 3, `${category} ${light} on light tint`)
        assert.ok(hueGapDeg(CATEGORY_COLORS[category], light) <= 21, `${category} ${light} hue`)
        continue
      }
      assert.ok(contrastRatio(light, CHIP) >= 3, `${category} on light`)
      assert.ok(contrastRatio(dark, '#3A3A3C') >= 3, `${category} on dark`)
      // 読めるかは、色を薄く敷いた器の上でも見る（実装はそちらでも 3:1 を守る）
      const darkTinted = compositeColor(CATEGORY_COLORS[category] + '38', '#3A3A3C')
      const readableOnDark = Math.min(contrastRatio(light, '#3A3A3C'), contrastRatio(light, darkTinted)) >= 3
      assert.ok(contrastRatio(dark, darkTinted) >= 3, `${category} on dark tint`)
      if (readableOnDark) assert.equal(dark, light, category)
      else if (hexToOklch(light).C >= 0.03) assert.ok(hueGapDeg(light, dark) < 4, category)
    }
  })
})

// ライトのアイコン色は、白い面で見分けられる 3:1 まで暗くしつつ、色味（色相・彩度）を保つ。
// RGB を黒へ寄せる以前の方式は、淡い色を灰色に、黄色をオリーブ色に濁らせ、
// ダークと並べるとライトだけ暗くくすんで見えた
describe('ライトのアイコン色の補正', () => {
  const entries = Object.entries(CATEGORY_COLORS)

  it('縁取りに頼らず、色そのものが chip・白い面の上で 3:1 に届く（黄は #FFD400 で免除）', () => {
    for (const [name, base] of entries) {
      const color = themeIconColor(base, false)
      if (isYellowColor(base)) {
        assert.equal(color, YELLOW_REFERENCE, name)
        continue
      }
      assert.ok(contrastRatio(color, CHIP) >= 3, `${name} ${color} on chip`)
      assert.ok(contrastRatio(color, WHITE) >= 3, `${name} ${color} on white`)
    }
  })

  it('もともと届いている色は動かさない', () => {
    for (const [name, base] of entries) {
      if (contrastRatio(base, CHIP) >= 3) assert.equal(themeIconColor(base, false), base, name)
    }
  })

  it('色相を保つ（黄色がオリーブ色へ、水色が灰色へずれない）', () => {
    for (const [name, base] of entries) {
      const color = themeIconColor(base, false)
      if (color === base || hexToOklch(base).C < 0.03) continue   // 無彩色に近い色は色相が定まらない
      if (isYellowColor(base)) continue   // 黄は #FFD400 に揃える
      // 明るいオレンジだけは、濁らないよう 10° 赤へ寄せる
      if (isBrightWarmColor(base)) {
        assert.ok(hueGapDeg(base, color) <= 11, `${name} ${base} → ${color}`)
        continue
      }
      assert.ok(hueGapDeg(base, color) < 4, `${name} ${base} → ${color} 色相差 ${hueGapDeg(base, color).toFixed(1)}°`)
    }
  })

  it('彩度を保つ：暗くしても元の彩度の大半を残す（鮮やかな色は濁らない）', () => {
    // 色域の都合で削れるのは明度を下げたときの超過ぶんだけ。淡い色は暗くすると彩度が上がることもある
    for (const name of ['Smartwatch', 'Instrument', 'Mixer']) {
      const base = CATEGORY_COLORS[name as keyof typeof CATEGORY_COLORS]
      const before = hexToOklch(base).C
      const after = hexToOklch(themeIconColor(base, false)).C
      assert.ok(after >= before * 0.55, `${name} 彩度 ${before.toFixed(3)} → ${after.toFixed(3)}`)
    }
    // 黄は暗くしない（以前の方式はオリーブ色 #a48937、3:1 に合わせると金〜からし色になった）
    assert.equal(themeIconColor(CATEGORY_COLORS.Cable, false), YELLOW_REFERENCE)
    assert.ok(hexToOklch(themeIconColor(CATEGORY_COLORS.Instrument, false)).C > hexToOklch('#768d9e').C)
  })

  it('ライトの配線は縁取りなしで、線自体が 3:1 に届く（黄の線は #FFD400 で免除）', () => {
    for (const type of Object.keys(PORT_COLORS)) {
      const color = portColor(type as never, false)
      assert.ok(contrastRatio(color, CHIP) >= 3 || color === '#000000' || color === YELLOW_REFERENCE, `${type} ${color}`)
    }
  })

  it('器・チップの地のもとは、ライトは補正前・ダークは補正後の色', () => {
    const base = CATEGORY_COLORS.PowerStrip
    assert.equal(themeTintBase(base, false), base)
    assert.equal(themeTintBase(base, true), themeIconColor(base, true))
    // 黄色の USB-C は、地のもとは元の色、線は #FFD400
    assert.equal(portTintColor('USB_C', false), PORT_COLORS.USB_C)
    assert.equal(portColor('USB_C', false), YELLOW_REFERENCE)
    assert.equal(portTintColor('USB_C', true), portColor('USB_C', true))
    // ケーブルの種類（USB_A_to_C など）は元の口の色を引く
    assert.equal(portTintColor('USB_A_to_C' as never, false), PORT_COLORS.USB_A)
  })

  it('黄は #FFD400、オレンジはダークで基準色を保ち、ほかの色の持ち上げ方は変えない', () => {
    assert.equal(themeIconColor('#FFC107', true), YELLOW_REFERENCE)
    assert.equal(themeIconColor('#FFA000', true), '#FFA000')
    assert.equal(themeIconColor(CATEGORY_COLORS.Instrument, true), '#cee7fc')
  })
})

describe('導入・撤去・IN/OUT・飾り・使用中の印', () => {
  it('塗りの上の文字が 4.5:1 以上で読め、種類ごとに塗りが違う', () => {
    const { text, ...fills } = KIND_BADGE_COLORS
    for (const [kind, fill] of Object.entries(fills)) assert.ok(contrastRatio(text, fill) >= 4.5, kind)
    assert.equal(new Set(Object.values(fills)).size, Object.keys(fills).length)
  })
})
