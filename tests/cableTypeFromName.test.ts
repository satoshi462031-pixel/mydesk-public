import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CABLE_PRESETS } from '../src/constants/gadgetPresets'
import { cableTypeFromName } from '../src/utils/cableTypeFromName'

describe('商品名からケーブル種別を読む', () => {
  it('アプリが出すケーブル候補は全件読み取れる', () => {
    const unread = CABLE_PRESETS
      .map((preset) => ({ name: preset.name, type: cableTypeFromName(preset.name) }))
      .filter((row) => !row.type)
    assert.deepEqual(unread, [], `読み取れない候補がある: ${unread.map((r) => r.name).join(' / ')}`)
  })

  const cases: [string, string][] = [
    // 変換ケーブルは単独端子より先に当てる（HDMI の規則が先に当たると USB-C 側が消える）
    ['Ugreen USB-C to HDMI 変換ケーブル 2m', 'USB_C_to_HDMI'],
    ['USB-C & DisplayPort ケーブル 1.8m', 'USB_C_to_DisplayPort'],
    ['DisplayPort to HDMI 変換ケーブル', 'DisplayPort_to_HDMI'],
    ['HDMI - DVI 変換ケーブル 2m', 'HDMI_to_DVI'],
    ['Anker USB-C & USB-A ケーブル 0.9m', 'USB_A_to_C'],
    ['Apple USB-C – Lightning ケーブル 1m', 'USB_C_to_Lightning'],
    // 単独端子
    ['Belkin HDMI 2.1 ケーブル 2m', 'HDMI'],
    ['CableMatters DisplayPort 1.4 ケーブル 1.8m', 'DisplayPort'],
    ['Anker Thunderbolt 4 ケーブル 0.7m', 'Thunderbolt'],
    ['Anker USB-C & USB-C ケーブル 2m', 'USB_C'],
    ['ELECOM スリム LAN ケーブル Cat6A 1m', 'Ethernet'],
    ['mogami 2549 XLR マイクケーブル 3m', 'XLR'],
    ['audio-technica ステレオミニケーブル 1m', 'Audio3_5mm'],
    ['光デジタルケーブル 1.5m', 'OpticalAudio'],
    ['メガネケーブル 1.5m', 'Power'],
    // 全角・大文字・記号ゆれ
    ['ＵＳＢ－Ｃ ケーブル', 'USB_C'],
    ['HDMIケーブル', 'HDMI'],
  ]
  for (const [name, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      assert.equal(cableTypeFromName(name), expected)
    })
  }

  it('端子が書かれていない名前では推定しない（誤った種別を入れない）', () => {
    for (const name of ['ケーブル 2m', 'Anker 3in1 ケーブル', '', 'マグネットケーブルホルダー']) {
      assert.equal(cableTypeFromName(name), undefined, name)
    }
  })
})
